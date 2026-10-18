// ===========================================================================
// missions.js — миссии как ДАННЫЕ и hooks поверх существующих подсистем.
//
// Никакого C-mission framework: этапы собираются из того, что уже есть в $:
//   * зоны/чекпоинты — `$.triggers.zone` (enter/leave, detect);
//   * события — `$.signal.on/emit`;
//   * таймеры — собственный `update(dt)` (игровое время, детерминизм);
//   * состояние — `$.save.set/get` (ключ `gta.missions` по умолчанию).
//
//   import { createMissions, deliveryMission } from './lib/missions.js';
//   const missions = createMissions($, { player: '#hero' });
//   missions.define(deliveryMission({
//       id: 'pizza', title: 'Доставка',
//       pickup:  { x: 200, y: 120, w: 80, h: 80 },
//       dropoff: { x: 900, y: 500, w: 90, h: 90 },
//       cargo: 'pizza', timeLimit: 90,
//       onComplete: (ctx) => $.emit('hud:mission', { text: 'Доставлено!' }),
//   }));
//   missions.accept('pizza');
//   // в кадре: missions.update(dt);
//
// Статусы: locked | available | active | done | failed. `accept` — взять.
// Определение миссии — чистые данные + необязательные функции-hooks; функции
// живут только в коде игры, в JSON их не кладут.
// ===========================================================================

const SAVE_VERSION = 1;

function pointZone(zone) {
    if (!zone) throw new TypeError('missions: у зоны этапа нужны x/y/w/h');
    const x = Number(zone.x), y = Number(zone.y);
    const w = Number(zone.w), h = Number(zone.h);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
        throw new RangeError('missions: зона этапа должна иметь конечные x/y и w/h > 0');
    }
    return { x, y, w, h };
}

function normalizeStage(stage, index) {
    if (!stage || typeof stage !== 'object') throw new TypeError(`missions: этап ${index} — не объект`);
    const kind = stage.kind || (stage.zone ? 'zone' : (stage.signal || stage.event ? 'event' : (stage.counter ? 'counter' : 'zone')));
    const out = { ...stage, kind, id: stage.id === undefined ? `stage${index}` : String(stage.id) };
    if (kind === 'zone' || kind === 'deliver') out.zone = pointZone(stage.zone);
    if (kind === 'event' && !stage.signal && !stage.event) throw new TypeError('missions: этап event без signal/event');
    if (kind === 'counter') {
        if (!stage.counter) throw new TypeError('missions: этап counter без имени счётчика');
        out.count = Math.max(1, Math.trunc(Number(stage.count) || 1));
    }
    out.requires = (stage.requires || []).map(String);
    out.set = stage.set && typeof stage.set === 'object' ? { ...stage.set } : null;
    out.clear = Array.isArray(stage.clear) ? stage.clear.map(String) : null;
    return out;
}

function normalizeDefinition(def) {
    if (!def || typeof def !== 'object') throw new TypeError('missions.define: нужен объект описания');
    if (typeof def.id !== 'string' || !def.id) throw new TypeError('missions.define: id строкой обязателен');
    const stages = (def.stages || []).map(normalizeStage);
    if (!stages.length) throw new TypeError(`missions.define("${def.id}"): нужен хотя бы один этап`);
    return {
        ...def,
        id: def.id,
        title: def.title || def.id,
        stages,
        autoAccept: def.autoAccept === true,
        repeatable: def.repeatable === true,
        timeLimit: Number(def.timeLimit) > 0 ? Number(def.timeLimit) : 0,
        startSignal: def.startSignal || def.signal || null,
    };
}

export function createMissions($, options = {}) {
    if (typeof $ !== 'function') throw new TypeError('missions: нужен публичный $');
    const opts = options || {};
    const saveKey = opts.saveKey || 'gta.missions';
    const persist = opts.persist !== false;
    const playerSelector = opts.player || '#player';
    const definitions = new Map();
    const states = new Map();       // id -> state
    const savedUnknown = new Map(); // id -> saved state, если определение придут позже
    const hooks = new Map();        // 'start'|'stage'|'complete'|'fail' -> [fn]
    const listeners = new Map();    // id -> [unsub]
    let disposed = false;

    function ensureAlive() {
        if (disposed) throw new Error('missions: объект уже освобождён (dispose)');
    }

    function emitLocal(name, payload) {
        for (const fn of (hooks.get(name) || []).slice()) {
            try { fn(payload, payload.ctx); } catch (e) { /* код игры */ }
        }
    }

    function signal(name, payload) {
        if (typeof $.signal?.emit === 'function') $.signal.emit(name, payload);
        if (typeof $.emit === 'function') $.emit(name, payload);
    }

    function stateOf(id) {
        return states.get(String(id)) || null;
    }

    function makeState(id) {
        return {
            id,
            status: 'available',
            stageIndex: -1,
            data: {},          // флаги миссии (cargo и т.п.)
            counters: {},      // счётчики этапов
            elapsed: 0,
            stageElapsed: 0,
            remaining: 0,
            failures: 0,
            completedAt: null,
        };
    }

    function snapshotState(state) {
        return {
            status: state.status,
            stage: state.stageIndex,
            elapsed: state.elapsed,
            remaining: state.remaining,
            data: { ...state.data },
            counters: { ...state.counters },
        };
    }

    function saveToStore() {
        if (!persist || typeof $.save?.set !== 'function') return false;
        const missions = {};
        for (const [id, state] of states) {
            if (state.status === 'locked' || state.status === 'available') continue;
            missions[id] = snapshotState(state);
        }
        try {
            $.save.set(saveKey, { version: SAVE_VERSION, missions, flags: {} });
            return true;
        } catch (e) {
            return false;
        }
    }

    function loadFromStore() {
        if (typeof $.save?.get !== 'function') return 0;
        const stored = $.save.get(saveKey);
        if (!stored || typeof stored !== 'object' || stored.version !== SAVE_VERSION) return 0;
        return load(stored);
    }

    function load(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') throw new TypeError('missions.load: нужен снимок');
        const data = snapshot.missions || {};
        let restored = 0;
        for (const [id, saved] of Object.entries(data)) {
            if (!saved || typeof saved !== 'object') continue;
            const def = definitions.get(id);
            if (!def) { savedUnknown.set(id, saved); continue; }
            restoreState(def, saved);
            restored++;
        }
        return restored;
    }

    function restoreState(def, saved) {
        const state = states.get(def.id) || makeState(def.id);
        state.status = ['active', 'done', 'failed'].includes(saved.status) ? saved.status : 'active';
        state.stageIndex = Number.isInteger(saved.stage) ? saved.stage : 0;
        state.elapsed = Number(saved.elapsed) || 0;
        state.remaining = Number(saved.remaining) || (def.timeLimit > 0 ? def.timeLimit : 0);
        state.data = saved.data && typeof saved.data === 'object' ? { ...saved.data } : {};
        state.counters = saved.counters && typeof saved.counters === 'object' ? { ...saved.counters } : {};
        states.set(def.id, state);
        if (state.status === 'active') setupStage(def, state, state.stageIndex);
        return state;
    }

    function clearListeners(id) {
        const list = listeners.get(id);
        if (!list) return;
        for (const un of list.splice(0)) { try { un(); } catch (e) { /* уже снят */ } }
        listeners.delete(id);
    }

    function listen(id, un) {
        if (!listeners.has(id)) listeners.set(id, []);
        listeners.get(id).push(un);
    }

    function fail(def, state, reason) {
        if (state.status !== 'active') return false;
        state.status = 'failed';
        state.failures++;
        clearListeners(def.id);
        const ctx = context(def, state);
        emitLocal('fail', { id: def.id, reason, ctx });
        if (typeof def.onFail === 'function') { try { def.onFail(ctx, reason); } catch (e) { /* код игры */ } }
        signal('mission:failed', { id: def.id, reason, state: snapshotState(state) });
        saveToStore();
        return true;
    }

    function complete(def, state) {
        if (state.status !== 'active') return false;
        state.status = 'done';
        state.completedAt = state.elapsed;
        clearListeners(def.id);
        const ctx = context(def, state);
        emitLocal('complete', { id: def.id, ctx });
        if (typeof def.onComplete === 'function') { try { def.onComplete(ctx); } catch (e) { /* код игры */ } }
        signal('mission:complete', { id: def.id, title: def.title, state: snapshotState(state) });
        saveToStore();
        return true;
    }

    function context(def, state) {
        const stage = def.stages[state.stageIndex] || null;
        return {
            id: def.id,
            title: def.title,
            stage: stage ? stage.id : null,
            stageIndex: state.stageIndex,
            stages: def.stages.length,
            data: state.data,
            counters: state.counters,
            elapsed: state.elapsed,
            remaining: state.remaining,
            mission: def,
            state,
        };
    }

    function advance(def, state, event) {
        if (state.status !== 'active') return false;
        const stage = def.stages[state.stageIndex];
        if (!stage) return false;
        if (stage.requires && stage.requires.length) {
            for (const flag of stage.requires) {
                if (!state.data[flag]) return false;
            }
        }
        // Выполнено: hooks, флаги, следующий этап.
        if (stage.clear) for (const key of stage.clear) delete state.data[key];
        if (typeof stage.onEnter === 'function') {
            try { stage.onEnter(context(def, state), event || null); } catch (e) { /* код игры */ }
        }
        if (stage.set) for (const [key, value] of Object.entries(stage.set)) state.data[key] = value;
        emitLocal('stage', { id: def.id, stage: stage.id, index: state.stageIndex });
        if (typeof def.onStage === 'function') {
            try { def.onStage(context(def, state), stage.id, event || null); } catch (e) { /* код игры */ }
        }
        signal('mission:stage', { id: def.id, stage: stage.id, index: state.stageIndex });
        state.stageIndex++;
        state.stageElapsed = 0;
        if (state.stageIndex >= def.stages.length) {
            restoreStageTimer(def, state);
            return complete(def, state);
        }
        restoreStageTimer(def, state);
        setupStage(def, state, state.stageIndex);
        saveToStore();
        return true;
    }

    function restoreStageTimer(def, state) {
        const stage = def.stages[state.stageIndex];
        state.stageRemaining = stage && Number(stage.timeLimit) > 0 ? Number(stage.timeLimit) : 0;
    }

    function setupStage(def, state, index) {
        const stage = def.stages[index];
        if (!stage) return;
        state.stageElapsed = 0;
        restoreStageTimer(def, state);
        if (stage.kind === 'zone' || stage.kind === 'deliver') {
            if (typeof $.triggers?.zone !== 'function') throw new Error('missions: нужен $.triggers.zone для зон этапов');
            const zone = $.triggers.zone({
                x: stage.zone.x, y: stage.zone.y, w: stage.zone.w, h: stage.zone.h,
                id: `${def.id}:${stage.id}`,
                class: 'mission-zone',
                // visible:false в triggers ВЫКЛЮЧАЕТ зону; невидимость — alpha 0.
                visible: true, color: '#ffe36a', alpha: 0,
                detect: stage.detect || playerSelector,
                once: false,
                parent: $.world,
                onEnter: () => onStageEvent(def, state, stage, 'zone'),
            });
            listen(def.id, () => { if (zone && typeof zone.remove === 'function') zone.remove(); });
        } else if (stage.kind === 'event') {
            const name = String(stage.signal || stage.event);
            if (typeof $.signal?.on === 'function') {
                const handler = (payload) => {
                    let ok = true;
                    if (typeof stage.match === 'function') { try { ok = !!stage.match(payload); } catch (e) { ok = false; } }
                    else if (stage.match !== undefined && stage.match !== null) ok = String(stage.match) === String(payload);
                    if (ok) onStageEvent(def, state, stage, 'event', payload);
                };
                $.signal.on(name, handler);
                listen(def.id, () => { if (typeof $.signal?.off === 'function') $.signal.off(name, handler); });
            }
        } else if (stage.kind === 'counter') {
            state.counters[stage.counter] = state.counters[stage.counter] || 0;
        }
        if (def.__zoneDebug && stage.kind === 'zone') def.__zoneDebug.push(stage.id);
    }

    function onStageEvent(def, state, stage, source, payload) {
        if (state.status !== 'active' || def.stages[state.stageIndex] !== stage) return false;
        if (stage.requires && stage.requires.length) {
            for (const flag of stage.requires) if (!state.data[flag]) return false;
        }
        return advance(def, state, { source, payload });
    }

    function stageZoneContains(def, state, point) {
        const stage = def.stages[state.stageIndex];
        if (!stage || (stage.kind !== 'zone' && stage.kind !== 'deliver') || !stage.zone) return false;
        const p = point;
        const z = stage.zone;
        return p.x >= z.x - z.w / 2 && p.x <= z.x + z.w / 2 &&
               p.y >= z.y - z.h / 2 && p.y <= z.y + z.h / 2;
    }

    const missions = {
        define(def) {
            ensureAlive();
            const normalized = normalizeDefinition(def);
            if (definitions.has(normalized.id)) {
                throw new Error(`missions.define: миссия "${normalized.id}" уже определена`);
            }
            definitions.set(normalized.id, normalized);
            states.set(normalized.id, makeState(normalized.id));
            if (normalized.autoAccept === true) missions.accept(normalized.id);
            if (savedUnknown.has(normalized.id)) {
                const saved = savedUnknown.get(normalized.id);
                savedUnknown.delete(normalized.id);
                restoreState(normalized, saved);
            }
            return normalized;
        },

        def(id) { return definitions.get(String(id)) || null; },
        definitions() { return Array.from(definitions.values()); },
        status(id) { const s = stateOf(id); return s ? s.status : 'locked'; },
        state(id) { const s = stateOf(id); return s ? snapshotState(s) : null; },
        active() { return Array.from(states.values()).filter((s) => s.status === 'active').map((s) => s.id); },
        isReady(id) { const def = definitions.get(String(id)); const s = stateOf(id); return !!(def && s && s.status === 'active' && s.stageIndex >= def.stages.length - 1); },

        accept(id) {
            ensureAlive();
            const def = definitions.get(String(id));
            if (!def) throw new Error(`missions.accept: неизвестная миссия "${id}"`);
            const state = states.get(def.id);
            if (state.status === 'active') return false;
            if (state.status === 'done' && !def.repeatable) return false;
            state.status = 'active';
            state.stageIndex = 0;
            state.data = {};
            state.counters = {};
            state.elapsed = 0;
            state.failures = 0;
            state.completedAt = null;
            state.stageElapsed = 0;
            clearListeners(def.id);
            setupStage(def, state, 0);
            const ctx = context(def, state);
            emitLocal('start', { id: def.id, ctx });
            if (typeof def.onStart === 'function') { try { def.onStart(ctx); } catch (e) { /* код игры */ } }
            signal('mission:started', { id: def.id, title: def.title });
            saveToStore();
            return true;
        },

        abort(id, reason = 'aborted') {
            const def = definitions.get(String(id));
            const state = stateOf(id);
            if (!def || !state || state.status !== 'active') return false;
            return fail(def, state, reason);
        },
        fail: (id, reason = 'failed') => missions.abort(id, reason),

        update(dt) {
            ensureAlive();
            const step = Number(dt);
            if (!Number.isFinite(step) || step < 0) throw new RangeError('missions.update: dt должен быть конечным >= 0');
            for (const [id, state] of states) {
                if (state.status !== 'active') continue;
                const def = definitions.get(id);
                if (!def) continue;
                state.elapsed += step;
                state.stageElapsed += step;
                if (def.timeLimit > 0) {
                    state.remaining = def.timeLimit - state.elapsed;
                    if (state.remaining <= 0) { fail(def, state, 'timeout'); continue; }
                }
                const stage = def.stages[state.stageIndex];
                if (!stage) { complete(def, state); continue; }
                if (stage.timeLimit > 0) {
                    state.stageRemaining = stage.timeLimit - state.stageElapsed;
                    if (state.stageRemaining <= 0) { fail(def, state, 'stage-timeout'); continue; }
                }
                // timer-этап: сам завершается по времени.
                if (stage.kind === 'timer' && Number(stage.after) > 0 && state.stageElapsed >= Number(stage.after)) {
                    onStageEvent(def, state, stage, 'timer');
                }
                // Автопроверка зоны (когда игрок телепортирован/вошёл до accept):
                // те же данные, что у trigger; повторный вход уже не сработает.
                if ((stage.kind === 'zone' || stage.kind === 'deliver') && stage.autoCheck === true) {
                    let node = null;
                    try { node = $(playerSelector).get(0); } catch (e) { node = null; }
                    if (node && stageZoneContains(def, state, { x: node.x, y: node.y })) {
                        onStageEvent(def, state, stage, 'zone-auto');
                    }
                }
            }
            return missions.active();
        },

        /** Счётчики миссий: `counter('kills', 1)` → сколько накоплено. */
        counter(name, delta = 1) {
            ensureAlive();
            const key = String(name);
            let best = 0;
            for (const [id, state] of states) {
                if (state.status !== 'active') continue;
                const def = definitions.get(id);
                if (!def) continue;
                const stage = def.stages[state.stageIndex];
                if (!stage || stage.kind !== 'counter' || stage.counter !== key) continue;
                state.counters[key] = (state.counters[key] || 0) + Number(delta || 0);
                if (state.counters[key] >= stage.count) onStageEvent(def, state, stage, 'counter');
                best = Math.max(best, state.counters[key]);
            }
            return best;
        },

        /** Флаг данных во всех активных миссиях: `flag('cargo', true)`. */
        flag(name, value = true) {
            for (const state of states.values()) if (state.status === 'active') state.data[String(name)] = value;
            return missions;
        },
        hasFlag(name) {
            for (const state of states.values()) if (state.status === 'active' && state.data[String(name)] !== undefined) return true;
            return false;
        },
        data(name) {
            const out = {};
            for (const state of states.values()) if (state.data[String(name)] !== undefined) out[state.id] = state.data[String(name)];
            return out;
        },

        on(name, fn) {
            if (typeof fn !== 'function') throw new TypeError('missions.on: нужен обработчик');
            const key = String(name);
            if (!hooks.has(key)) hooks.set(key, []);
            hooks.get(key).push(fn);
            return missions;
        },
        off(name, fn) {
            const list = hooks.get(String(name));
            if (!list) return missions;
            if (!fn) hooks.delete(String(name));
            else hooks.set(String(name), list.filter((h) => h !== fn));
            return missions;
        },

        save() {
            const out = { version: SAVE_VERSION, missions: {}, flags: {} };
            for (const [id, state] of states) {
                if (state.status === 'locked' || state.status === 'available') continue;
                out.missions[id] = snapshotState(state);
            }
            return out;
        },
        load,
        saveToStore,
        loadFromStore,

        reset() {
            for (const [id, state] of states) {
                clearListeners(id);
                const fresh = makeState(id);
                const def = definitions.get(id);
                if (def && def.autoAccept) { states.set(id, fresh); missions.accept(id); }
                else states.set(id, fresh);
            }
            return missions;
        },

        dispose() {
            for (const id of Array.from(states.keys())) clearListeners(id);
            disposed = true;
        },
    };

    // Автозагрузка — только явно (иначе сцена «оживает» сама по себе).
    if (opts.autoLoad === true) loadFromStore();
    const externalUnsubs = [];
    if (typeof opts.onEvent === 'function' && typeof $.signal?.on === 'function') {
        // Хук на все сигналы — для HUD/логов; пользователь сам решает, что слушать.
        const handler = (e) => { try { opts.onEvent('complete', e); } catch (_) { /* код игры */ } };
        $.signal.on('mission:complete', handler);
        externalUnsubs.push(() => { if (typeof $.signal?.off === 'function') $.signal.off('mission:complete', handler); });
    }
    const baseDispose = missions.dispose;
    missions.dispose = () => {
        for (const un of externalUnsubs.splice(0)) { try { un(); } catch (e) { /* снят */ } }
        baseDispose();
    };
    return missions;
}

/**
 * Готовая миссия «доставка/чекпоинт»:
 *   pickup  — войти в зону, получить груз (флаг `cargo`);
 *   dropoff — войти в зону с грузом, этап выполнен → миссия complete.
 * `cargo` — имя флага (по умолчанию 'cargo'); `set` у pickup ставит флаг.
 */
export function deliveryMission(spec = {}) {
    if (!spec.id) throw new TypeError('deliveryMission: id обязателен');
    const cargo = spec.cargo === undefined ? 'cargo' : String(spec.cargo);
    const pickup = spec.pickup;
    const dropoff = spec.dropoff;
    if (!pickup || !dropoff) throw new TypeError('deliveryMission: нужны pickup и dropoff зоны');
    return {
        id: String(spec.id),
        title: spec.title || 'Доставка',
        timeLimit: spec.timeLimit,
        repeatable: spec.repeatable === true,
        startSignal: spec.startSignal || null,
        stages: [
            { id: 'pickup', kind: 'deliver', zone: pickup, set: { [cargo]: true },
              onEnter: spec.onPickup },
            { id: 'dropoff', kind: 'deliver', zone: dropoff, requires: [cargo], clear: [cargo],
              onEnter: spec.onDropoff },
        ],
        onStart: spec.onStart,
        onStage: spec.onStage,
        onComplete: spec.onComplete,
        onFail: spec.onFail,
    };
}

/**
 * Миссия-цепочка чекпоинтов: точки `points: [{id?, x, y, w?, h?, radius?}]`
 * проходятся по порядку. `radius` переводится в зону w=h=2r.
 */
export function checkpointMission(spec = {}) {
    if (!spec.id) throw new TypeError('checkpointMission: id обязателен');
    const points = spec.points;
    if (!Array.isArray(points) || !points.length) throw new TypeError('checkpointMission: нужен массив points');
    const stages = points.map((p, i) => {
        const r = Number(p.radius) > 0 ? Number(p.radius) : 40;
        return {
            id: p.id === undefined ? `cp${i}` : String(p.id),
            kind: 'zone',
            zone: p.w !== undefined && p.h !== undefined
                ? { x: p.x, y: p.y, w: p.w, h: p.h }
                : { x: p.x, y: p.y, w: r * 2, h: r * 2 },
            once: true,
        };
    });
    return {
        id: String(spec.id),
        title: spec.title || 'Чекпоинты',
        timeLimit: spec.timeLimit,
        repeatable: spec.repeatable === true,
        stages,
        onStart: spec.onStart,
        onStage: spec.onStage,
        onComplete: spec.onComplete,
        onFail: spec.onFail,
    };
}
