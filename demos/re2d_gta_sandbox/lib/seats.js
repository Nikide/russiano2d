// ===========================================================================
// GTA-sandbox: сиденья машины, вход/выход, input lock, безопасный eject (P1.1).
//
// Композиция, не наследование: машина — АБСТРАКТНЫЙ объект
//
//   { node, seats?, seatsData? }
//
// где `node` — узел `$` (кузов), `seatsData` — якоря
// `{ x, y, side?, door? , yaw? }` в локальных координатах кузова (x = вперёд),
// `seats` — число мест, если якоря не заданы. Менеджер не знает, как ездит
// машина (`lib/vehicle.js`), и не редактирует её.
//
// Что использует движок, а не дублирует:
//   * привязку пассажира к узлу — `.appendTo(vehicle.node)` (при выходе —
//     обратно в мир/прежнего родителя);
//   * запрет ввода на время посадки — `$.input.lock('vehicle', 'seats')`
//     (по умолчанию advisory: машину ведут те же клавиши, E должен читаться;
//     `hardLock: true` — жёсткий вариант, гасящий down/pressed/released);
//   * анимацию/состояние пассажира — если передан объект с `seat/unseat`
//     (например lib/character.js), менеджер вызывает их; узлу — ничего не
//     навязывает.
//
// Схема двери: `door: 'left'|'right'` (по умолчанию 'right'); выход смещает
// пассажира на `ejectOffset` перпендикулярно кузову. `side` — ряд
// ('front'|'rear') для выбора свободного места.
//
// Уничтожение машины с пассажирами: движок `Node.destroy()` рекурсивно
// уничтожает детей, ПОСЛЕ чего шлёт 'remove' — события «до» нет. Поэтому
// менеджер ставит на время жизни машины защитную обёртку `node.destroy`,
// которая сначала всех высаживает, затем вызывает оригинал. Это игровой JS,
// C не правится; см. docs/gta/seats.md (ограничение и отчёт движку).
//
//   const seats = createSeats($);
//   seats.enter(vehicle, hero, { seat: 0 });        // водитель
//   seats.enter(vehicle, ped, { side: 'rear' });    // пассажир
//   seats.update(1 / 60);                           // синк позиций
//   seats.exit(hero);                               // вышел, input отпущен
//   $('#car').remove();                             // пассажиры высажены сами
// ===========================================================================

const EPS = 1e-9;
const DEFAULT_SEAT_SPACING = 28;

function isNode(value) {
    return !!(value && typeof value === 'object' && typeof value.tag === 'string'
        && typeof value.nid === 'string');
}

function isWrapper(value) {
    return !!(value && typeof value === 'object' && Array.isArray(value.nodes));
}

function nodeOf($, what) {
    if (!what) return null;
    if (isNode(what)) return what;
    if (isWrapper(what)) return what.nodes[0] || null;
    if (typeof what === 'string') return $(what).get(0) || null;
    return null;
}

function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/** Пассажир — узел или адаптер `{node, seat(), unseat()}`. */
function passengerNode(passenger) {
    if (!passenger) return null;
    if (isNode(passenger)) return passenger;
    if (passenger.node && isNode(passenger.node)) return passenger.node;
    return null;
}

function isPassengerLike(value) {
    return !!(value && (isNode(value) || (value.node && isNode(value.node))));
}

/** Объект машины из `{node,seatsData}` или прямо из узла/обёртки/селектора. */
function vehicleOf($, vehicle) {
    if (!vehicle) return null;
    if (isNode(vehicle.node)) return vehicle;
    const node = nodeOf($, vehicle);
    if (!node) return null;
    return { node };
}

function normalizeAnchor(raw) {
    const a = raw || {};
    return {
        x: num(a.x, 0),
        y: num(a.y, 0),
        side: a.side === undefined ? 'front' : String(a.side),
        door: a.door === undefined ? 'right' : String(a.door),
        yaw: num(a.yaw, 0),
    };
}

function seatDataOf(vehicle) {
    const raw = vehicle.seatsData !== undefined ? vehicle.seatsData : vehicle.seats;
    if (Array.isArray(raw)) return raw.map(normalizeAnchor);
    let count = 1;
    if (typeof raw === 'number') count = Math.max(0, Math.floor(raw));
    else if (raw && typeof raw === 'object' && typeof raw.count === 'number') {
        count = Math.max(0, Math.floor(raw.count));
    }
    const spacing = num(vehicle.seatSpacing, DEFAULT_SEAT_SPACING);
    const anchors = [];
    for (let i = 0; i < count; i++) {
        // 0 — водитель в центре; далее пары «слева/справа» позади.
        const offset = i === 0 ? 0 : Math.ceil(i / 2) * spacing * (i % 2 === 1 ? -1 : 1);
        anchors.push(normalizeAnchor({ x: offset, y: 0, side: i <= 1 ? 'front' : 'rear' }));
    }
    return anchors;
}

function rotated(node, anchor) {
    const angle = num(node.angle, 0) + num(anchor.yaw, 0);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
        x: node.x + anchor.x * cos - anchor.y * sin,
        y: node.y + anchor.x * sin + anchor.y * cos,
    };
}

function exitPoint(node, anchor, ejectOffset) {
    const world = rotated(node, anchor);
    const angle = num(node.angle, 0) + num(anchor.yaw, 0);
    // Локальная нормаль +Y; 'left' — противоположная сторона.
    const sign = anchor.door === 'left' ? -1 : 1;
    return {
        x: world.x - Math.sin(angle) * ejectOffset * sign,
        y: world.y + Math.cos(angle) * ejectOffset * sign,
    };
}

export function createSeats($, opts) {
    const config = opts || {};
    const lockName = config.lockName === undefined ? 'vehicle' : String(config.lockName);
    const ejectOffset = Math.max(0, num(config.ejectOffset, 24));
    // По умолчанию лок ДОБРОВОЛЬНЫЙ (advisory): посадка не должна гасить те же
    // клавиши, которыми игра ведёт машину и выходит из неё (`$.input.vec`,
    // `$.input.pressed('e')`). Жёсткий режим — явный opts.hardLock для сцен,
    // где ввод забирают полностью; он гасит down/pressed/released у ВСЕХ.
    const hardLock = config.hardLock === true;
    /** node кузова → состояние */
    const states = new Map();

    function stateOf(vehicle) {
        const v = vehicleOf($, vehicle);
        if (!v) return null;
        const node = v.node;
        if (!node || node.removed) return null;
        let state = states.get(node);
        if (!state) {
            state = {
                node,
                vehicle: v,
                seats: seatDataOf(v).map((anchor, index) => ({
                    index, anchor, occupant: null,
                })),
                guard: null,
                originalDestroy: null,
                deathHandler: null,
                destroying: false,
            };
            states.set(node, state);
            installGuard(state);
        }
        return state;
    }

    function installGuard(state) {
        if (state.guard) return;
        const node = state.node;
        state.originalDestroy = node.destroy;
        const wrapper = function () {
            // Сначала высадка (дети ещё живы), потом настоящий destroy().
            if (!state.destroying) {
                state.destroying = true;
                try { ejectAllState(state, 'vehicle_destroyed'); }
                finally { state.destroying = false; }
            }
            return state.originalDestroy.apply(this, arguments);
        };
        node.destroy = wrapper;
        state.guard = wrapper;
        // Смерть по здоровью (combat.js шлёт узлу 'death') — тоже безопасный
        // выход, ещё до удаления узла игрой.
        state.deathHandler = () => {
            if (!state.destroying) ejectAllState(state, 'vehicle_destroyed');
        };
        node.on('death', state.deathHandler);
    }

    function releaseGuard(state) {
        const node = state.node;
        if (state.deathHandler) {
            node.off('death', state.deathHandler);
            state.deathHandler = null;
        }
        if (state.guard && node.destroy === state.guard) {
            node.destroy = state.originalDestroy;
        }
        state.guard = null;
    }

    function records(state) {
        return state.seats.filter((seat) => seat.occupant !== null);
    }

    function recordOfPassenger(passenger) {
        const node = passengerNode(passenger);
        if (!node) return null;
        for (const state of states.values()) {
            for (const seat of state.seats) {
                if (seat.occupant && seat.occupant.node === node) {
                    return { state, seat, record: seat.occupant };
                }
            }
        }
        return null;
    }

    function seatInfo(state, seat) {
        const world = rotated(state.node, seat.anchor);
        return {
            index: seat.index,
            x: seat.anchor.x,
            y: seat.anchor.y,
            side: seat.anchor.side,
            door: seat.anchor.door,
            worldX: world.x,
            worldY: world.y,
            passenger: seat.occupant ? seat.occupant.node : null,
        };
    }

    /**
     * Посадить пассажира. `opts`: `{seat, index, side, door, lock, onEnter}`.
     * Возврат: `{ok, reason?, vehicle, seat, node}`; reason —
     * 'destroyed_vehicle'|'passenger_seated'|'seat_taken'|'no_free_seat'.
     */
    function enter(vehicle, passenger, options) {
        const o = options || {};
        const node = passengerNode(passenger);
        if (!node) return { ok: false, reason: 'missing_passenger' };
        const state = stateOf(vehicle);
        if (!state) return { ok: false, reason: 'destroyed_vehicle' };
        if (node.removed) return { ok: false, reason: 'missing_passenger' };
        if (recordOfPassenger(passenger)) {
            return { ok: false, reason: 'passenger_seated', vehicle: state.vehicle };
        }
        const seats = state.seats;
        let seat = null;
        if (typeof o.seat === 'number' || typeof o.index === 'number') {
            const index = Math.floor(num(o.seat !== undefined ? o.seat : o.index, -1));
            const found = seats[index];
            if (found) {
                if (found.occupant) return { ok: false, reason: 'seat_taken', seat: found.index };
                seat = found;
            }
        } else if (o.side !== undefined || o.door !== undefined) {
            seat = seats.find((item) => !item.occupant
                && (o.side === undefined || item.anchor.side === o.side)
                && (o.door === undefined || item.anchor.door === o.door)) || null;
        } else {
            seat = seats.find((item) => !item.occupant) || null;
        }
        if (!seat) return { ok: false, reason: 'no_free_seat' };

        const parent = node.parent_node || null;
        // Привязка к кузову: узел становится ребёнком машины. Позицию ведёт
        // update(), потому что дочерние координаты в обычном 2D — мировые.
        $(node).appendTo(state.node);
        const world = rotated(state.node, seat.anchor);
        $(node).at(world.x, world.y);
        let token = null;
        if (o.lock !== false) {
            token = $.input.lock(lockName, 'seats', { hard: hardLock });
        }
        const record = { vehicle: state.vehicle, node, passenger, seat, token, parent };
        seat.occupant = record;
        if (passenger && typeof passenger.seat === 'function') {
            try {
                passenger.seat({ vehicle: state.vehicle, seat: seatInfo(state, seat), index: seat.index });
            } catch (error) {
                $.log(`seats: пассажир seat() бросил: ${error}`);
            }
        }
        const info = Object.assign({
            vehicle: state.vehicle, passenger, node, lock: token,
        }, seatInfo(state, seat));
        if (typeof config.onEnter === 'function') config.onEnter(info);
        if (typeof o.onEnter === 'function') o.onEnter(info);
        return Object.assign({ ok: true }, info);
    }

    function ejectRecord(state, seat, reason) {
        const record = seat.occupant;
        if (!record) return null;
        seat.occupant = null;
        const node = record.node;
        if (record.token && typeof record.token.release === 'function'
            && (typeof record.token.active !== 'function' || record.token.active())) {
            record.token.release(reason);
        }
        const point = exitPoint(state.node, seat.anchor, ejectOffset);
        if (record.passenger && typeof record.passenger.unseat === 'function') {
            try { record.passenger.unseat(reason); }
            catch (error) { $.log(`seats: пассажир unseat() бросил: ${error}`); }
        }
        if (!node.removed) {
            // Прежний родитель не должен быть самой машиной: в момент
            // destroy() ребёнка уничтожат сразу после высадки.
            const parent = record.parent && !record.parent.removed
                && record.parent !== state.node ? record.parent : null;
            if (parent) $(node).appendTo(parent);
            else $(node).appendTo($.world);
            $(node).at(point.x, point.y);
        }
        return {
            vehicle: record.vehicle, passenger: record.passenger, node,
            seat: seat.index, index: seat.index, reason,
            x: point.x, y: point.y,
        };
    }

    function ejectAllState(state, reason, callback) {
        const out = [];
        for (const seat of state.seats) {
            if (!seat.occupant) continue;
            const info = ejectRecord(state, seat, reason);
            if (info) {
                out.push(info);
                if (typeof config.onEject === 'function') config.onEject(info);
                if (typeof callback === 'function') callback(info);
            }
        }
        return out;
    }

    /** Высадить пассажира: `exit(passenger, opts?)` или `exit(vehicle, passenger)`. */
    function exit(a, b, c) {
        let vehicle = null;
        let passenger = null;
        let o = {};
        // Формы вызова:
        //   exit(passenger[, opts | reason])
        //   exit(vehicle, passenger[, opts | reason])
        if (isPassengerLike(a) && (b === undefined || typeof b === 'string'
            || (b && !isPassengerLike(b)))) {
            passenger = a;
            o = typeof b === 'string' ? { reason: b } : (b || {});
        } else {
            vehicle = a;
            passenger = b;
            o = typeof c === 'string' ? { reason: c } : (c || {});
        }
        let found = null;
        if (vehicle) {
            const state = stateOf(vehicle);
            if (!state) return { ok: false, reason: 'destroyed_vehicle' };
            const node = passengerNode(passenger);
            const seat = state.seats.find((item) => item.occupant
                && (item.occupant.node === node
                    || (o.seat !== undefined && item.index === o.seat)));
            if (seat) found = { state, seat };
        } else {
            const hit = recordOfPassenger(passenger);
            if (hit) found = { state: hit.state, seat: hit.seat };
        }
        if (!found) return { ok: false, reason: 'not_seated' };
        const info = ejectRecord(found.state, found.seat, o.reason || 'manual');
        if (info && typeof o.onExit === 'function') o.onExit(info);
        return Object.assign({ ok: true }, info);
    }

    function exitAll(vehicle, reason) {
        const state = stateOf(vehicle);
        if (!state) return [];
        return ejectAllState(state, reason || 'manual');
    }

    /** Освободить машину: высадить всех, снять guard/подписку. */
    function release(vehicle) {
        const v = vehicleOf($, vehicle);
        if (!v) return false;
        const state = states.get(v.node);
        if (!state) return false;
        ejectAllState(state, 'release');
        releaseGuard(state);
        states.delete(state.node);
        return true;
    }

    /** Кадровый шаг: синхронизация мест и страховка от разрушенной машины. */
    function update(dt) {
        for (const state of Array.from(states.values())) {
            const node = state.node;
            if (!node || node.removed) {
                ejectAllState(state, 'vehicle_destroyed');
                releaseGuard(state);
                states.delete(state.node);
                continue;
            }
            for (const seat of state.seats) {
                const record = seat.occupant;
                if (!record) continue;
                if (!record.node || record.node.removed) {
                    // Пассажира убили/удалили отдельно — снять запись и lock.
                    seat.occupant = null;
                    if (record.token && typeof record.token.active === 'function'
                        && record.token.active()) record.token.release('passenger_removed');
                    continue;
                }
                const world = rotated(node, seat.anchor);
                $(record.node).at(world.x, world.y);
            }
            if (typeof config.onUpdate === 'function') config.onUpdate(state, dt);
        }
    }

    /** Сиденья машины с занятостью (копия, для HUD/тестов). */
    function seatsOf(vehicle) {
        const state = stateOf(vehicle);
        if (!state) return [];
        return state.seats.map((seat) => seatInfo(state, seat));
    }

    function occupants(vehicle) {
        const state = stateOf(vehicle);
        if (!state) return [];
        return records(state).map((seat) => seatInfo(state, seat));
    }

    function seatOf(passenger) {
        const hit = recordOfPassenger(passenger);
        if (!hit) return null;
        return Object.assign({ vehicle: hit.state.vehicle }, seatInfo(hit.state, hit.seat));
    }

    const seats = {
        enter,
        exit,
        exitAll,
        release,
        update,
        seats: seatsOf,
        occupants,
        seatOf,
        isSeated(passenger) { return !!recordOfPassenger(passenger); },
        freeSeats(vehicle) {
            const state = stateOf(vehicle);
            return state ? state.seats.filter((seat) => !seat.occupant).length : 0;
        },
        /** Высадить всех и снять состояния (смена сцены/рестарт). */
        clear(reason) {
            for (const state of Array.from(states.values())) {
                ejectAllState(state, reason || 'clear');
                releaseGuard(state);
            }
            states.clear();
            return true;
        },
        /** Сколько машин под управлением менеджера. */
        count() { return states.size; },
        /** Внутренний guard — для теста «до destroy() высаживает». */
        _hasGuard(vehicle) {
            const v = vehicleOf($, vehicle);
            const state = v ? states.get(v.node) : null;
            return !!(state && state.guard);
        },
    };
    return seats;
}

export default createSeats;
