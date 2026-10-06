// ===========================================================================
// Машина состояний: $.state — FSM для узлов и игры в целом.
//
// Отличие от $.anim.stateMachine: там машина управляет КЛИПАМИ (какая
// анимация играет), здесь — смысловыми состояниями игры: idle → run → air →
// land. Они спокойно сосуществуют на одном узле: `.stateMachine()` про клипы,
// `.fsm('hero')` про логику.
//
//   $.ready(() => {
//     $.state.create({
//       name: 'hero',
//       initial: 'idle',
//       states: {
//         idle: { on: { jump: 'air', move: { target: 'run', guard: (m) => m.data.moving } } },
//         run:  { on: { stop: 'idle', jump: 'air' } },
//         air:  { initial: 'jump', states: {                       // составное
//           jump: { on: { land: 'fall' } },                        // цель относительно
//           fall: { on: { land: 'idle' } },                        // родителя — air.fall
//         } },
//       },
//     });
//     $('#hero').fsm('hero');
//     $('#hero').fsmSend('jump');
//   });
//
// Имя метода узла — `.fsm()`, а не `.state()`: `.state()`, `.states()`,
// `.toState()`, `.stateMachine()` и `.stateTime()` уже заняты анимацией
// (см. _CONTRACT.md §5), переопределять их нельзя.
//
// Вся чистая логика графа (нормализация спецификации, поиск перехода,
// планирование входа/выхода) экспортируется наружу — её проверяет qjs без
// движка. Модуль не обращается к engine на верхнем уровне.
// ===========================================================================

import { ctx, query, def } from './core.js';

/** Поля, которые модуль понимает в описании состояния; остальные — опечатка. */
const STATE_KEYS = new Set(['enter', 'exit', 'update', 'on', 'initial', 'states', 'label', 'tags']);

/** Все машины, созданные через $.state.create — их обходит tickState. */
const machines = new Set();

// ---------------------------------------------------------------------------
// Чистые функции графа
// ---------------------------------------------------------------------------

function reportStateError(message) {
    // Вне движка ctx.log всё ещё существует (core.js), но engine может быть
    // заглушкой — поэтому на всякий случай не даём логированию сломать логику.
    try {
        ctx.log(message);
    } catch (ignored) {
        // логировать некуда — молчим, но работу не прерываем
    }
}

function callSafely(fn, machine, args, what) {
    try {
        return fn(machine, ...args);
    } catch (error) {
        reportStateError(`$.state: ошибка в ${what}: ${error}`);
        return undefined;
    }
}

/**
 * Есть ли такое состояние (принимает 'air.jump' или ['air','jump']).
 * Вложенные состояния лежат в def.states, поэтому спуск идёт через него —
 * иначе 'air.jump' искался бы как поле самого 'air'.
 */
export function stateExists(states, name) {
    const parts = Array.isArray(name) ? name : String(name).split('.');
    let map = states;
    for (const part of parts) {
        if (!map || typeof map !== 'object') return false;
        if (!Object.prototype.hasOwnProperty.call(map, part)) return false;
        const def = map[part];
        if (!def || typeof def !== 'object') return false;
        map = def.states;
    }
    return true;
}

/** Плоский список имён состояний, включая вложенные: ['idle', 'air', 'air.jump']. */
export function flatStateNames(states, prefix) {
    const out = [];
    const head = prefix ? prefix + '.' : '';
    for (const key of Object.keys(states || {})) {
        out.push(head + key);
        const child = states[key] && states[key].states;
        if (child) out.push(...flatStateNames(child, head + key));
    }
    return out;
}

/** Путь до состояния: 'air.jump' → ['air','jump']. Бросает с подсказкой. */
export function statePathOf(states, name) {
    const full = String(name === undefined || name === null ? '' : name).trim();
    if (!full) {
        throw new Error('$.state: пустое имя состояния — нужно, например, "idle" или "air.jump"');
    }
    if (!stateExists(states, full)) {
        throw new Error(`$.state: нет состояния "${full}" — доступны: ${flatStateNames(states).join(', ')}`);
    }
    return full.split('.');
}

/** Описание состояния по пути (['air','jump']) или null. */
export function defAtPath(states, path) {
    let def = null;
    let node = states;
    for (const part of path) {
        if (!node || typeof node !== 'object') return null;
        def = node[part];
        if (!def) return null;
        node = def.states;
    }
    return def || null;
}

/** Цель перехода из записи on: строка, entry.target или null (динамическая). */
function staticTarget(entry) {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const target = entry.target;
        if (typeof target === 'string') return target;
    }
    return null;
}

/**
 * Куда ведёт цель перехода. Сначала имя ищется от корня ('air.fall'), затем —
 * среди соседей исходного состояния ('fall' из 'air.jump' → 'air.fall').
 * Бросает с перечнем доступных состояний: опечатка в переходе должна падать
 * на старте, а не в бою.
 */
export function resolveTransitionTarget(states, scope, target) {
    const wanted = String(target).trim();
    if (!wanted) throw new Error('$.state: пустая цель перехода — укажите имя состояния');
    if (stateExists(states, wanted)) return wanted.split('.');
    const parent = scope.slice(0, -1);
    const relative = parent.concat(wanted.split('.'));
    if (stateExists(states, relative)) return relative;
    throw new Error(`$.state: переход в неизвестное состояние "${wanted}" (из "${scope.join('.')}") — доступны: ${flatStateNames(states).join(', ')}`);
}

/**
 * Составное состояние: если у цели есть вложенные states, автоматически
 * входим в её initial (и так до листа). Так 'air' с initial 'jump' — это
 * сразу 'air.jump'.
 */
export function descendToLeaf(states, path) {
    const out = path.slice();
    for (let guard = 0; guard < 32; guard++) {
        const def = defAtPath(states, out);
        if (!def || !def.states) break;
        const names = Object.keys(def.states);
        const initial = def.initial === undefined ? names[0] : String(def.initial);
        for (const part of initial.split('.')) out.push(part);
        if (!stateExists(states, out)) {
            throw new Error(`$.state: initial "${initial}" у "${path.join('.')}" не существует — доступны: ${flatStateNames(def.states).join(', ')}`);
        }
    }
    return out;
}

/** Активно ли состояние: точное совпадение или предок активного листа. */
export function pathHas(path, name) {
    const joined = path.join('.');
    const wanted = String(name);
    return joined === wanted || joined.startsWith(wanted + '.');
}

/** Что выйдет и что войдёт при переходе: exit — от листа к корню, enter — наоборот. */
export function enterExitPlan(fromPath, toPath) {
    let common = 0;
    while (common < fromPath.length && common < toPath.length && fromPath[common] === toPath[common]) common++;
    return {
        common,
        exit: fromPath.slice(common).reverse(),
        enter: toPath.slice(common),
    };
}

/**
 * Переход по событию. Ищем обработчик от активного листа вверх по составным
 * состояниям: событие, которое не обработал 'air.jump', может обработать 'air'.
 * Возвращает { source, scope, entry, event, wildcard } или null.
 */
export function findTransition(states, path, event) {
    const key = String(event);
    for (let i = path.length - 1; i >= 0; i--) {
        const scope = path.slice(0, i + 1);
        const def_ = defAtPath(states, scope);
        const table = def_ ? def_.on : null;
        if (!table) continue;
        if (Object.prototype.hasOwnProperty.call(table, key)) {
            return { source: scope.join('.'), scope, entry: table[key], event: key, wildcard: false };
        }
        if (Object.prototype.hasOwnProperty.call(table, '*')) {
            return { source: scope.join('.'), scope, entry: table['*'], event: key, wildcard: true };
        }
    }
    return null;
}

function validateStates(states, scope, root) {
    // root — всё дерево состояний: цель перехода ищется и от корня, и среди
    // соседей, поэтому на вложенном уровне нужен именно он, а не подкарта.
    const top = root || states;
    const where = scope.length ? `states.${scope.join('.')}.states` : 'states';
    if (!states || typeof states !== 'object' || Array.isArray(states)) {
        throw new Error(`$.state: ${where} должен быть объектом { имя: { … } } — например { idle: {}, run: {} }`);
    }
    const names = Object.keys(states);
    if (!names.length) throw new Error(`$.state: ${where} пуст — нужно хотя бы одно состояние`);

    for (const name of names) {
        const def_ = states[name];
        if (!def_ || typeof def_ !== 'object' || Array.isArray(def_)) {
            throw new Error(`$.state: состояние "${scope.concat(name).join('.')}" должно быть объектом — например { enter(m) {}, on: { jump: 'air' } }`);
        }
        for (const key of Object.keys(def_)) {
            if (!STATE_KEYS.has(key)) {
                reportStateError(`$.state: неизвестное поле "${key}" у состояния "${scope.concat(name).join('.')}" — понимаю: ${Array.from(STATE_KEYS).join(', ')}`);
            }
        }
        for (const hook of ['enter', 'exit', 'update']) {
            if (def_[hook] !== undefined && typeof def_[hook] !== 'function') {
                throw new Error(`$.state: ${hook} у состояния "${scope.concat(name).join('.')}" должен быть функцией`);
            }
        }
        if (def_.on !== undefined) {
            if (!def_.on || typeof def_.on !== 'object' || Array.isArray(def_.on)) {
                throw new Error(`$.state: on у состояния "${scope.concat(name).join('.')}" должен быть объектом { событие: цель }`);
            }
            for (const event of Object.keys(def_.on)) {
                const entry = def_.on[event];
                const target = staticTarget(entry);
                if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
                    if (typeof entry.target !== 'string' && typeof entry.target !== 'function') {
                        throw new Error(`$.state: переход "${event}" у "${scope.concat(name).join('.')}" без цели — укажите { target: 'idle', guard } или функцию`);
                    }
                    if (entry.guard !== undefined && typeof entry.guard !== 'function') {
                        throw new Error(`$.state: guard перехода "${event}" у "${scope.concat(name).join('.')}" должен быть функцией`);
                    }
                    if (entry.action !== undefined && typeof entry.action !== 'function') {
                        throw new Error(`$.state: action перехода "${event}" у "${scope.concat(name).join('.')}" должен быть функцией`);
                    }
                } else if (typeof entry !== 'string' && typeof entry !== 'function') {
                    throw new Error(`$.state: переход "${event}" у "${scope.concat(name).join('.')}" должен быть строкой, функцией или { target, guard, action }`);
                }
                // Статические цели проверяем сразу: опечатка падает на старте.
                if (target !== null) resolveTransitionTarget(top, scope.concat(name), target);
            }
        }
        if (def_.states !== undefined) {
            validateStates(def_.states, scope.concat(name), top);
            statePathOf(def_.states, def_.initial === undefined ? Object.keys(def_.states)[0] : def_.initial);
        } else if (def_.initial !== undefined) {
            throw new Error(`$.state: у "${scope.concat(name).join('.')}" задан initial, но нет вложенных states`);
        }
    }
}

/**
 * Проверяет и канонизирует спецификацию машины:
 * { initial, states, history, historyLimit }. Бросает с подсказкой на любой
 * опечатке — спецификация проверяется один раз при создании машины.
 */
export function normalizeStateSpec(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
        throw new Error('$.state: нужен объект { initial, states } — например $.state.create({ initial: "idle", states: { idle: {} } })');
    }
    if (!spec.states) {
        throw new Error('$.state: нет поля states — $.state.create({ initial: "idle", states: { idle: { on: { jump: "air" } } } })');
    }
    validateStates(spec.states, []);
    const initial = spec.initial === undefined ? Object.keys(spec.states)[0] : String(spec.initial);
    statePathOf(spec.states, initial);
    const limit = Number(spec.historyLimit);
    return {
        initial,
        states: spec.states,
        history: spec.history !== false,
        historyLimit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 64,
    };
}

// ---------------------------------------------------------------------------
// Машина
// ---------------------------------------------------------------------------

/**
 * Машина состояний. Чистая: не знает ни про $, ни про движок, поэтому её
 * проверяет qjs. Узел к ней привязывает слой $.state (attach).
 *
 * Состояние — путь активных состояний: ['air', 'jump']. is('air') истинно и
 * для вложенного 'air.jump'; current() отдаёт лист.
 */
export function createMachine(spec, hooks) {
    const conf = normalizeStateSpec(spec);
    const hook = hooks || {};

    const machine = {
        name: spec && spec.name !== undefined && spec.name !== null ? String(spec.name) : null,
        spec: conf,
        data: spec && spec.data && typeof spec.data === 'object' ? spec.data : {},
        alive: true,
    };

    let path = [];
    let time_in_state = 0;
    let time_total = 0;
    let node = null;

    const history = [];       // имена листьев по порядку входа (последний — текущий)
    const journal = [];       // { from, to, event } — полная картина переходов
    const enter_hooks = new Map();
    const exit_hooks = new Map();
    const change_hooks = [];

    function fireHooks(table, name, context) {
        // Сначала хук конкретного состояния, потом общий '*': частное важнее.
        const list = (table.get(name) || []).concat(table.get('*') || []);
        for (const fn of list) {
            callSafely(fn, machine, [name, context.event, context.data], `хук состояния "${name}"`);
        }
    }

    /** Вход в целевой путь: выход — от листа к корню, вход — от корня к листу. */
    function enterPath(target, context) {
        const full = descendToLeaf(conf.states, target);
        const plan = enterExitPlan(path, full);
        // Переход в то же состояние перезапускает его (exit → enter): иначе
        // «сбросить» состояние (например, начать атаку заново) было бы нечем.
        const restart = plan.exit.length === 0 && plan.enter.length === 0 && path.length > 0;
        const exit_count = restart ? path.length : plan.exit.length;
        const enter_from = restart ? 0 : plan.common;
        const enter_count = restart ? full.length : plan.enter.length;
        const from = path.length ? path.join('.') : null;
        const to = full.join('.');

        // scope — полный путь состояния: 'air.jump', а не просто 'jump'.
        for (let i = 0; i < exit_count; i++) {
            const scope = path.slice(0, path.length - i);
            const name = scope.join('.');
            const def_ = defAtPath(conf.states, scope);
            if (def_ && typeof def_.exit === 'function') {
                callSafely(def_.exit, machine, [context.data, context.event], `exit состояния "${name}"`);
            }
            fireHooks(exit_hooks, name, context);
        }

        path = full;
        time_in_state = 0;

        for (let i = 0; i < enter_count; i++) {
            const scope = full.slice(0, enter_from + i + 1);
            const name = scope.join('.');
            const def_ = defAtPath(conf.states, scope);
            if (def_ && typeof def_.enter === 'function') {
                callSafely(def_.enter, machine, [context.data, context.event], `enter состояния "${name}"`);
            }
            fireHooks(enter_hooks, name, context);
        }

        if (conf.history) {
            history.push(to);
            if (history.length > conf.historyLimit) history.shift();
            journal.push({ from, to, event: context.event === undefined ? null : context.event });
            if (journal.length > conf.historyLimit) journal.shift();
        }

        for (const fn of change_hooks.slice()) {
            callSafely(fn, machine, [from, to, context.event], 'обработчик перехода');
        }
    }

    /** Разбор записи on без побочных эффектов: цель, guard, action. */
    function inspect(found, event, data) {
        const entry = found.entry;
        let target = null;
        let guard = null;
        let action = null;
        if (typeof entry === 'string') {
            target = entry;
        } else if (typeof entry === 'function') {
            target = callSafely(entry, machine, [data, event], `переход "${event}"`);
        } else if (entry && typeof entry === 'object') {
            target = entry.target;
            guard = entry.guard || null;
            action = entry.action || null;
        }
        if (typeof target === 'function') {
            target = callSafely(target, machine, [data, event], `цель перехода "${event}"`);
        }
        if (target === false || target === null || target === undefined) {
            return { ok: false, reason: 'отказ' };
        }
        if (guard) {
            let passed = false;
            try {
                passed = !!guard(machine, data);
            } catch (error) {
                reportStateError(`$.state: ошибка в guard перехода "${event}": ${error}`);
                return { ok: false, reason: 'guard' };
            }
            if (!passed) return { ok: false, reason: 'guard' };
        }
        return { ok: true, targetPath: resolveTransitionTarget(conf.states, found.scope, target), action };
    }

    machine.send = function (event, data) {
        if (!machine.alive) return false;
        const found = findTransition(conf.states, path, event);
        if (!found) return false;
        const event_name = String(event);
        const plan = inspect(found, event_name, data);
        if (!plan.ok) return false;
        if (typeof plan.action === 'function') {
            callSafely(plan.action, machine, [data, event_name], `action перехода "${event_name}"`);
        }
        enterPath(plan.targetPath, { event: event_name, data });
        return true;
    };

    /** Можно ли перейти по событию: те же guard'ы, но без побочных эффектов. */
    machine.can = function (event, data) {
        if (!machine.alive) return false;
        const found = findTransition(conf.states, path, event);
        if (!found) return false;
        return inspect(found, String(event), data).ok;
    };

    /** Принудительный переход без события (в том числе в состояние-предок). */
    machine.set = function (name, data) {
        if (!machine.alive) return false;
        enterPath(statePathOf(conf.states, name), { event: null, data });
        return true;
    };

    machine.is = function (name) { return pathHas(path, name); };
    machine.has = function (name) { return stateExists(conf.states, name); };
    // Полное имя листа ('air.jump'), а не короткое: так его можно отдать
    // обратно в set()/is() и записать в историю без догадок.
    machine.current = function () { return path.length ? path.join('.') : null; };
    machine.path = function () { return path.slice(); };
    machine.states = function () { return flatStateNames(conf.states); };

    /** События, доступные прямо сейчас (с учётом составных состояний). */
    machine.events = function () {
        const out = [];
        for (let i = 0; i < path.length; i++) {
            const def_ = defAtPath(conf.states, path.slice(0, i + 1));
            if (!def_ || !def_.on) continue;
            for (const key of Object.keys(def_.on)) if (out.indexOf(key) < 0) out.push(key);
        }
        return out;
    };

    machine.history = function () { return history.slice(); };
    machine.transitions = function () { return journal.map((r) => ({ from: r.from, to: r.to, event: r.event })); };
    machine.previous = function () { return history.length >= 2 ? history[history.length - 2] : null; };
    machine.back = function (data) {
        const prev = machine.previous();
        return prev === null ? false : machine.set(prev, data);
    };

    machine.onEnter = function (name, fn) {
        addHook(enter_hooks, name, fn);
        return machine;
    };
    machine.onExit = function (name, fn) {
        addHook(exit_hooks, name, fn);
        return machine;
    };
    /** fn(machine, from, to, event) — после каждого перехода. */
    machine.onTransition = function (fn) {
        if (typeof fn !== 'function') {
            throw new Error('$.state: onTransition ждёт функцию — machine.onTransition((m, from, to) => …)');
        }
        change_hooks.push(fn);
        return machine;
    };

    /** Секунды, прожитые в текущем листе / в машине целиком. */
    machine.time = function () { return time_in_state; };
    machine.totalTime = function () { return time_total; };

    /**
     * Шаг машины: update активных состояний от корня к листу, затем
     * hooks.onUpdate (если он передан в createMachine).
     */
    machine.update = function (dt) {
        if (!machine.alive) return 0;
        const step = Number(dt) || 0;
        time_in_state += step;
        time_total += step;
        let called = 0;
        for (let i = 0; i < path.length; i++) {
            const def_ = defAtPath(conf.states, path.slice(0, i + 1));
            if (def_ && typeof def_.update === 'function') {
                callSafely(def_.update, machine, [step], `update состояния "${path.slice(0, i + 1).join('.')}"`);
                called++;
            }
        }
        if (typeof hook.onUpdate === 'function') {
            callSafely(hook.onUpdate, machine, [step], 'update машины');
        }
        return called;
    };

    machine.attach = function (target) {
        const found = resolveNode(target);
        if (!found) {
            reportStateError('$.state: .fsm(...) — узел не найден; передайте узел, обёртку или селектор');
            return machine;
        }
        if (node && node !== found) detachFrom(node, machine);
        node = found;
        found.attrs.fsm = machine;
        return machine;
    };

    machine.detach = function () {
        if (node) detachFrom(node, machine);
        node = null;
        return machine;
    };

    machine.node = function () { return node; };

    machine.destroy = function () {
        if (!machine.alive) return false;
        machine.alive = false;
        machine.detach();
        machines.delete(machine);
        return true;
    };

    machine.toString = () => `machine(${machine.name || 'без имени'}): ${machine.current()}`;
    // Машина ссылается на узел только замыканием, поэтому циклов в ней нет;
    // toJSON нужен, чтобы агент и $.store видели осмысленную сводку, а не
    // список методов.
    machine.toJSON = () => ({
        name: machine.name,
        current: machine.current(),
        path: machine.path(),
        data: machine.data,
    });

    enterPath([conf.initial], { event: null, data: undefined });
    return machine;
}

function addHook(table, name, fn) {
    if (typeof fn !== 'function') {
        throw new Error('$.state: onEnter/onExit ждёт функцию — machine.onEnter("air", (m) => …)');
    }
    const key = name === undefined || name === null ? '*' : String(name);
    if (!table.has(key)) table.set(key, []);
    table.get(key).push(fn);
}

/** Машина ли это (а не узел и не что-то ещё). */
export function isMachine(value) {
    return !!(value && typeof value === 'object' && typeof value.send === 'function'
        && typeof value.current === 'function' && typeof value.spec === 'object' && value.spec);
}

/** Узел по узлу, обёртке или селектору — общий разбор для слоя $.state. */
function resolveNode(target) {
    if (!target) return null;
    if (target.nodes) return target.nodes[0] || null;
    if (typeof target === 'string') return query(target)[0] || null;
    return target;
}

function detachFrom(node, machine) {
    if (node && node.attrs && node.attrs.fsm === machine) delete node.attrs.fsm;
}

function stateByName(name) {
    const key = String(name);
    for (const machine of machines) if (machine.name === key) return machine;
    return null;
}

function registeredNames() {
    const names = [];
    for (const machine of machines) if (machine.name) names.push(machine.name);
    return names.length ? names.join(', ') : 'нет';
}

function eachNode(wrapper, fn) {
    const nodes = wrapper && wrapper.nodes ? wrapper.nodes : [];
    for (const node of nodes) fn(node);
    return wrapper;
}

// ---------------------------------------------------------------------------
// Методы узла
// ---------------------------------------------------------------------------

function attachToNode(node, value) {
    if (value === null || value === false) {
        const current = node.attrs ? node.attrs.fsm : null;
        if (isMachine(current)) current.detach();
        return;
    }
    let machine = null;
    if (isMachine(value)) {
        machine = value;
    } else if (typeof value === 'string') {
        machine = stateByName(value);
        if (!machine) {
            reportStateError(`$.state: нет машины "${value}" — зарегистрированы: ${registeredNames()}`);
            return;
        }
    } else if (value && typeof value === 'object' && value.states) {
        machine = createMachine(value);
        machines.add(machine);
    } else {
        reportStateError('$.state: .fsm(...) принимает машину, её имя или { initial, states }');
        return;
    }
    machine.attach(node);
}

function installNodeMethods() {
    // .fsm() — геттер: имя текущего состояния (или null). .fsm(x) — привязка.
    def('fsm', function (value) {
        if (value === undefined) {
            const node = this.nodes[0];
            const machine = node && node.attrs ? node.attrs.fsm : null;
            return isMachine(machine) ? machine.current() : null;
        }
        return eachNode(this, (node) => attachToNode(node, value));
    });

    // .fsmSend('jump') — цепочный метод: результат перехода смотрите через
    // $.state.send(node, event) или machine.can(event).
    def('fsmSend', function (event, data) {
        return eachNode(this, (node) => {
            const machine = node.attrs ? node.attrs.fsm : null;
            if (!isMachine(machine)) {
                reportStateError(`$.state: у узла${node.id ? ' #' + node.id : ''} нет машины — вызовите .fsm(machine) или $.state.attach(node, machine)`);
                return;
            }
            machine.send(event, data);
        });
    });
}

// ---------------------------------------------------------------------------
// Установка подсистемы
// ---------------------------------------------------------------------------

function getMachine(target) {
    if (!target) return null;
    if (isMachine(target)) return target;
    const node = target.attrs ? target : resolveNode(target);
    if (node && node.attrs && isMachine(node.attrs.fsm)) return node.attrs.fsm;
    if (typeof target === 'string') return stateByName(target);
    return null;
}

/**
 * Ставит $.state и методы узла .fsm()/.fsmSend(). Кадровый шаг — tickState(dt):
 * он зовёт update() активных состояний и сам отвязывает машины от удалённых
 * узлов.
 */
export function installState($) {
    $.state = {
        /**
         * Создаёт машину. spec: { name, initial, states, history, historyLimit,
         * data, node }. Машина попадает в реестр ($.state.list()) и тикает
         * вместе с кадром.
         */
        create(spec) {
            const machine = createMachine(spec);
            machines.add(machine);
            if (spec && spec.node !== undefined && spec.node !== null) machine.attach(spec.node);
            return machine;
        },

        /** Машина узла (узел, обёртка, селектор) или null. */
        get(target) { return getMachine(target); },

        /** Привязка машины к узлу. machine — машина или её имя. */
        attach(target, machine) {
            const found = isMachine(machine) ? machine : stateByName(machine);
            if (!found) {
                reportStateError(`$.state.attach: нет машины "${machine}" — зарегистрированы: ${registeredNames()}`);
                return null;
            }
            found.attach(target);
            return found;
        },

        /** Отвязывает машину от узла (сама машина продолжает жить). */
        detach(target) {
            const machine = getMachine(target);
            if (machine) machine.detach();
            return $;
        },

        /** Отправить событие: true — переход состоялся. */
        send(target, event, data) {
            const machine = getMachine(target);
            return machine ? machine.send(event, data) : false;
        },

        /** Принудительный переход без события. */
        set(target, name, data) {
            const machine = getMachine(target);
            return machine ? machine.set(name, data) : false;
        },

        /** Активно ли состояние (с учётом вложенности). */
        is(target, name) {
            const machine = getMachine(target);
            return machine ? machine.is(name) : false;
        },

        /** Возможен ли переход по событию (guard'ы проверяются). */
        can(target, event, data) {
            const machine = getMachine(target);
            return machine ? machine.can(event, data) : false;
        },

        /** Имя активного листа или null. */
        current(target) {
            const machine = getMachine(target);
            return machine ? machine.current() : null;
        },

        /** Машина по имени из spec.name. */
        byName(name) { return stateByName(name); },

        /** Все живые машины в порядке создания. */
        list() { return Array.from(machines); },

        /** Уничтожить машину (снимает привязку к узлу). */
        destroy(machine) {
            const found = isMachine(machine) ? machine : stateByName(machine);
            return found ? found.destroy() : false;
        },

        /** Уничтожить все машины — например, при смене сцены. */
        clear() {
            for (const machine of Array.from(machines)) machine.destroy();
            machines.clear();
            return $;
        },
    };

    installNodeMethods();
    return $;
}

/** Снимок реестра машин, переиспользуемый между кадрами (Array.from — аллокация
 *  на каждый кадр, docs/HIGH_LEVEL_API_PERF.md §3.3). */
const tick_machines = [];

/**
 * Шаг кадра: update() у всех машин реестра. Машины удалённых узлов
 * отвязываются, но не уничтожаются — их может держать игровой код.
 */
export function tickState(dt) {
    tick_machines.length = 0;
    for (const machine of machines) tick_machines.push(machine);
    for (let i = 0; i < tick_machines.length; i++) {
        const machine = tick_machines[i];
        if (!machine.alive) { machines.delete(machine); continue; }
        const node = machine.node();
        if (node && node.removed) machine.detach();
        machine.update(dt);
    }
    tick_machines.length = 0;
}
