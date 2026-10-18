// ===========================================================================
// GTA-sandbox: персонаж как КОМПОЗИЦИЯ функций, не жанровый класс (P1.2).
//
// Никакой иерархии и `class`: контроллер — замыкание над узлом `$`, которое
// складывает существующие примитивы движка:
//   * движение — `$(node).velocity()` для тела Box2D или `.at()` для узла без
//     тела; ввод — `$.input.vec()/down()` (жёсткие input-lock'и уважаются);
//   * направление — `node.angle` (обычный 2D) или `node.sprite_col` для
//     направленного атласа Re2D; кадр — `node.sprite_row`;
//   * анимация — необязательные хуки: `$.anim.player(...).play(clip)` или
//     карта строк/кадров через `sprite_row` (без новых систем анимации);
//   * урон — подписка на событие узла `damaged` из lib/combat.js (payload →
//     состояние `hit`/`dead`); зоны/броня остаются `$.combat` и игрой.
//
// Состояния: idle | walk | run | shoot | hit | stunned | dead.
//
//   const hero = createCharacter($, {
//       node: '#hero', speed: 130, runSpeed: 240, sprite: { columns: 16 },
//       rows: { idle: 0, walk: 0, run: 0, shoot: 1, hit: 2, dead: 3 },
//       canControl: () => !game.cutscene,
//       onSeat: (info) => log(info ? 'в машине' : 'пешком'),
//   });
//   $.update((dt) => hero.update(dt));
//   hero.shoot({ angle: 0 });
//   $('#hero').on('damaged', (e) => hero.hit(e.data));   // уже по умолчанию
//
// Посадка — не обязанность персонажа: seats.js вызывает `seat(info)` /
// `unseat(reason)`, а `canControl()` в это время false.
// ===========================================================================

/** Состояния персонажа — стабильный список для тестов и HUD. */
export const STATES = ['idle', 'walk', 'run', 'shoot', 'hit', 'stunned', 'dead'];

const EPS = 1e-6;

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

function normalize(x, y) {
    const len = Math.hypot(x, y);
    if (len <= EPS) return { x: 0, y: 0, length: 0 };
    return { x: x / len, y: y / len, length: len };
}

/** Колонка направленного атласа из угла: 0 = +X, по часовой стрелке. */
export function directionColumn(angle, columns, offset) {
    const count = Math.max(1, Math.floor(num(columns, 1)));
    const turn = (2 * Math.PI) / count;
    const a = num(angle, 0) + num(offset, 0);
    let index = Math.round(a / turn) % count;
    if (index < 0) index += count;
    return index;
}

export function createCharacter($, spec) {
    const config = spec || {};
    const node = nodeOf($, config.node);
    if (!node) throw new Error('character: нужен node/селектор существующего узла');
    const wrapper = $(node);
    const speed = Math.max(0, num(config.speed, 120));
    const runSpeed = Math.max(0, num(config.runSpeed, speed * 1.9));
    const inputScheme = config.input === undefined ? 'wasd' : config.input;
    const runKey = config.runKey === undefined ? 'shift' : config.runKey;
    const rows = Object.assign({
        idle: 0, walk: 0, run: 0, shoot: 1, hit: 2, stunned: 2, dead: 3,
    }, config.rows || {});
    const sprite = config.sprite || null;
    const clip = config.clip || null;
    const playerName = config.player === undefined ? null : config.player;

    let state = 'idle';
    let previous = 'idle';
    let timer = 0;                 // сек; 0 — состояние не ограничено
    let facing = num(config.facing, 0);
    let manual = { x: 0, y: 0 };
    let inputEnabled = true;
    let seated = null;
    let dead = num(node.cur_hp, 0) <= 0 && num(node.max_hp, 0) > 0 ? true : false;
    let frameTime = 0;
    let frameIndex = 0;

    function canControl() {
        if (dead || seated) return false;
        if (state === 'stunned' || state === 'hit') return false;
        if (!inputEnabled) return false;
        if (typeof config.canControl === 'function' && !config.canControl(character)) return false;
        return true;
    }

    function applyVisual() {
        if (sprite) {
            if (sprite.columns !== undefined) node.sprite_col = directionColumn(facing, sprite.columns, sprite.offset);
            const row = rows[state] === undefined ? 0 : rows[state];
            node.sprite_row = row;
        }
        // Узел с телом по умолчанию НЕ вращаем: поворот тела повернул бы
        // коробку коллайдера. `rotate: true` — явно (круглое тело/спрайт).
        const rotate = config.rotate === true
            ? true : (config.rotate === false ? false : node.body < 0);
        if (rotate && !sprite) node.angle = facing;
        if (clip) {
            const name = clip[state];
            if (name && $.anim && typeof $.anim.player === 'function' && playerName) {
                try { $.anim.player(playerName).play(name); }
                catch (error) { /* клип ещё не объявлен — не повод падать */ }
            }
        }
    }

    function setState(name, opts) {
        const next = String(name);
        if (STATES.indexOf(next) < 0) {
            throw new RangeError(`character: неизвестное состояние "${next}" (есть ${STATES.join(', ')})`);
        }
        const o = opts || {};
        if (next === state) {
            if (o.ms !== undefined) timer = Math.max(0, num(o.ms, 0)) / 1000;
            return state;
        }
        previous = state;
        state = next;
        timer = o.ms === undefined ? 0 : Math.max(0, num(o.ms, 0)) / 1000;
        frameTime = 0;
        frameIndex = 0;
        applyVisual();
        if (typeof config.onState === 'function') config.onState(state, previous, character);
        wrapper.emit('state', { state, previous, character });
        return state;
    }

    function stop() {
        if (node.body >= 0) wrapper.velocity(0, 0);
    }

    function animateFrames(dt) {
        if (!sprite || !sprite.frames || !sprite.frames[state]) return;
        const frames = sprite.frames[state];
        if (!Array.isArray(frames) || !frames.length) return;
        const fps = Math.max(1, num(sprite.fps, 8));
        frameTime += dt;
        const step = 1 / fps;
        while (frameTime >= step) {
            frameTime -= step;
            frameIndex = (frameIndex + 1) % frames.length;
        }
        node.sprite_row = frames[frameIndex];
    }

    const character = {
        node,
        states() { return STATES.slice(); },
        state() { return state; },
        previousState() { return previous; },
        facing() { return facing; },
        isSeated() { return !!seated; },
        seatInfo() { return seated; },
        canControl,
        /** Ручной вектор движения (AI/тесты); работает при setInputEnabled(false). */
        setMove(x, y) {
            const v = normalize(num(x, 0), num(y, 0));
            manual = { x: v.x, y: v.y };
            return character;
        },
        setInputEnabled(on) {
            inputEnabled = on !== false;
            if (!inputEnabled) stop();
            return character;
        },
        /** Направление: угол (радианы) или точка/узел. */
        setFacing(value) {
            if (value && typeof value === 'object') {
                const target = value.nodes ? value.nodes[0] : value;
                if (target && typeof target.x === 'number') {
                    facing = Math.atan2(target.y - node.y, target.x - node.x);
                } else if (typeof value.x === 'number' && typeof value.y === 'number') {
                    facing = Math.atan2(value.y - node.y, value.x - node.x);
                }
            } else {
                facing = num(value, facing);
            }
            applyVisual();
            return character;
        },
        face(x, y) {
            if (typeof x === 'number' && y === undefined) return character.setFacing(x);
            facing = Math.atan2(num(y, 0) - node.y, num(x, 0) - node.x);
            applyVisual();
            return character;
        },
        shoot(opts) {
            if (dead) return false;
            const o = opts || {};
            if (o.angle !== undefined) character.setFacing(o.angle);
            else if (o.dir !== undefined) character.setFacing(Math.atan2(num(o.dir.y, 0), num(o.dir.x, 1)));
            else if (o.target !== undefined) character.setFacing(o.target);
            setState('shoot', { ms: o.ms === undefined ? num(config.shootMs, 180) : o.ms });
            return true;
        },
        /** Реакция на payload lib/combat.js (или свой объект с `dead`). */
        hit(payload) {
            if (dead) return false;
            if (payload && (payload.dead === true
                || (payload.hpAfter !== undefined && num(payload.hpAfter, 1) <= 0))) {
                character.die(payload);
                return true;
            }
            if (!seated) setState('hit', { ms: num(config.hitMs, 250) });
            return true;
        },
        stun(ms) {
            if (dead) return false;
            setState('stunned', { ms: ms === undefined ? 500 : ms });
            return true;
        },
        die(payload) {
            if (dead) return false;
            dead = true;
            stop();
            setState('dead');
            if (typeof config.onDeath === 'function') config.onDeath(payload, character);
            return true;
        },
        revive() {
            dead = false;
            state = 'idle';
            previous = 'dead';
            timer = 0;
            applyVisual();
            return character;
        },
        /** Посадка: seats.js зовёт это; `info` — `{vehicle, seat, index}`. */
        seat(info) {
            seated = info || { vehicle: null, seat: null, index: -1 };
            stop();
            setState('idle');
            if (typeof config.onSeat === 'function') config.onSeat(seated, character);
            wrapper.emit('seat', { seated, character });
            return character;
        },
        unseat(reason) {
            if (!seated) return character;
            const was = seated;
            seated = null;
            stop();
            setState('idle');
            if (typeof config.onSeat === 'function') config.onSeat(null, character);
            wrapper.emit('unseat', { reason: reason || 'manual', was, character });
            return character;
        },
        update(dt) {
            const step = Math.max(0, num(dt, 0));
            if (dead) {
                stop();
                return character;
            }
            if (timer > 0) {
                timer -= step;
                if (timer <= 0) {
                    timer = 0;
                    if (state === 'shoot' || state === 'hit' || state === 'stunned') setState('idle');
                }
            }
            if (seated) {
                stop();
                applyVisual();
                return character;
            }
            const controllable = canControl();
            let vx = 0;
            let vy = 0;
            let running = false;
            if (controllable) {
                if (config.readInput !== false) {
                    const vec = $.input.vec(inputScheme);
                    vx = num(vec.x, 0);
                    vy = num(vec.y, 0);
                    running = $.input.down(runKey) === true;
                } else {
                    vx = manual.x;
                    vy = manual.y;
                }
            }
            // Блокирующие состояния: shoot/hit/stunned не двигаются, но
            // направление и кадр обновляются (анимация/атлас).
            const blocked = state === 'shoot' || state === 'hit' || state === 'stunned';
            const move = blocked ? { x: 0, y: 0, length: 0 } : normalize(vx, vy);
            if (!controllable && !blocked && state !== 'dead') {
                // Ввод забран (катсцена/посадка): состояние покоя, но не «dead».
                if (state !== 'idle') setState('idle');
            } else if (move.length > 0) {
                facing = Math.atan2(move.y, move.x);
                setState(running ? 'run' : 'walk');
            } else if (state === 'walk' || state === 'run') {
                setState('idle');
            }
            const speedNow = running ? runSpeed : speed;
            if (node.body >= 0) {
                wrapper.velocity(move.x * speedNow, move.y * speedNow);
            } else if (move.length > 0) {
                wrapper.at(node.x + move.x * speedNow * step,
                    node.y + move.y * speedNow * step);
            }
            animateFrames(step);
            applyVisual();
            return character;
        },
        destroy() {
            if (damageHandler) wrapper.off('damaged', damageHandler);
            damageHandler = null;
            stop();
            return true;
        },
    };

    // Урон — событие узла из combat.js; подписка снимается в destroy().
    let damageHandler = null;
    if (config.damageState !== false) {
        damageHandler = (event) => character.hit(event && event.data ? event.data : event);
        wrapper.on('damaged', damageHandler);
    }
    if (dead) setState('dead');
    else applyVisual();
    return character;
}

export default createCharacter;
