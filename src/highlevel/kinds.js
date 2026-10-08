// ===========================================================================
// Виды узла — `.kind()`, `$.kinds`, константа `Re2D`.
//
// Вид (kind) говорит, КАК смотреть на узел и камеру. Мир остаётся плоским:
// позиция, размер, тело, слои и события — это 2D-поля узла. Вид лишь решает,
// кто и как узел рисует, и расширяет смысл нескольких методов (см. таблицу
// «метод × вид» в docs/RE2D.md).
//
//   $('<npc>').at(500, 400).kind(Re2D);   // узел живёт в 2.5D
//   $('<npc>').at(300, 400);              // kind не указан — обычный 2D
//   $('#bob').kind();                     // → '2d'
//   $('#bob').kind(null);                 // вернуть 2D
//
// ПРАВИЛО «НОЛЬ СТОИМОСТИ ДЛЯ 2D». У каждого узла вид — строка, по умолчанию
// '2d'. Единственная плата за механизм в горячем пути рендера — одно сравнение
// `node.kind !== '2d'` (см. render.js). Если для вида не зарегистрирован
// отрисовщик, узел рисуется как обычный 2D-узел: незнакомый или «пустой» вид
// ничего не ломает.
//
// Вид — данные, а не класс: строка в узле и запись в реестре. Поэтому он
// переживает prefab/сохранение/inspect, а игровой код обходится без new,
// extends и this.
// ===========================================================================

import { ctx, def } from './core.js';

/** Вид по умолчанию: обычный 2D-узел. */
export const KIND_2D = '2d';

/** Вид 2.5D (Re2D): значение константы `Re2D`. */
export const KIND_RE2D = 're2d';

/** Реестр видов: имя → описание `{ name, title }`. */
const kinds = new Map();

/** Отрисовщики видов: имя → `fn(node, cam) → true, если нарисовал`. */
const renderers = new Map();

/**
 * Зарегистрировать вид. Повторная регистрация того же имени обновляет описание
 * (нужно горячей перезагрузке: модуль ставится заново).
 */
export function registerKind(name, spec) {
    if (typeof name !== 'string' || name.length === 0) {
        throw new TypeError('$.kinds.register: нужно имя вида — непустая строка');
    }
    const key = name.trim().toLowerCase();
    if (key !== name) {
        throw new TypeError(`$.kinds.register: имя вида пишется строчными буквами без пробелов: '${key}'`);
    }
    const desc = spec && typeof spec === 'object' ? spec : {};
    kinds.set(key, { name: key, title: String(desc.title || key) });
    return key;
}

/** Есть ли такой вид в реестре. */
export function hasKind(name) {
    return kinds.has(name);
}

/** Имена видов в порядке регистрации. */
export function kindNames() {
    return [...kinds.keys()];
}

/**
 * Привести значение к имени вида. `null`, `undefined`, `''` и `false` — это
 * вид по умолчанию; неизвестное имя — ошибка с подсказкой, какие бывают.
 */
export function normalizeKind(value) {
    if (value === null || value === undefined || value === '' || value === false) return KIND_2D;
    if (typeof value !== 'string' || !kinds.has(value)) {
        throw new TypeError(`.kind(${JSON.stringify(value)}): неизвестный вид; доступны: ${kindNames().join(', ')}`);
    }
    return value;
}

/**
 * Назначить отрисовщик виду: `fn(node, cam)` рисует узел и возвращает `true`;
 * `false` значит «этот узел вид не берёт» — рисует обычный 2D-путь.
 */
export function registerKindRenderer(kind, fn) {
    if (typeof fn !== 'function') {
        throw new TypeError('registerKindRenderer: вторым аргументом нужна функция (node, cam) → bool');
    }
    if (!kinds.has(kind)) {
        throw new TypeError(`registerKindRenderer: вид '${kind}' не зарегистрирован — сначала $.kinds.register`);
    }
    renderers.set(kind, fn);
}

/** Отрисовщик вида или `undefined`. Горячий путь рендера: одна проверка Map. */
export function kindRenderer(kind) {
    return renderers.get(kind);
}

/** Проходы видов: имя → `{ begin(cam), end(cam) }` для камеры этого вида. */
const passes = new Map();

/**
 * Назначить виду проход мира. Если камера имеет этот вид, render.js не рисует
 * 2D-мир, а вызывает `begin(cam)`, рисует узлы ЭТОГО вида (2D-узлы в таком
 * проходе пропускаются) и вызывает `end(cam)`.
 */
export function registerKindPass(kind, pass) {
    if (!pass || typeof pass.begin !== 'function' || typeof pass.end !== 'function') {
        throw new TypeError('registerKindPass: нужен объект { begin(cam), end(cam) }');
    }
    if (!kinds.has(kind)) {
        throw new TypeError(`registerKindPass: вид '${kind}' не зарегистрирован — сначала $.kinds.register`);
    }
    passes.set(kind, pass);
}

/** Проход вида или `undefined`. */
export function kindPass(kind) {
    return passes.get(kind);
}

/** Вид узла строкой; узел без поля (заглушка в тесте) считается 2D. */
export function kindOf(node) {
    return node && typeof node.kind === 'string' ? node.kind : KIND_2D;
}

export function installKinds($) {
    registerKind(KIND_2D, { title: 'Обычный 2D' });
    registerKind(KIND_RE2D, { title: 'Re2D: 2.5D поверх того же мира' });

    // Константа Re2D: канонически $.Re2D, плюс глобальное имя — чтобы читалось
    // `.kind(Re2D)`. Строка, а не объект: переживает JSON, prefab и inspect.
    ctx.normalizeKind = normalizeKind;   // для Node.set('kind'): core.js не импортирует kinds.js
    $.Re2D = KIND_RE2D;
    if (!('Re2D' in globalThis)) {
        Object.defineProperty(globalThis, 'Re2D', { value: KIND_RE2D, enumerable: false });
    }

    $.kinds = {
        TwoD: KIND_2D,
        Re2D: KIND_RE2D,
        /** Зарегистрировать новый вид (для расширений движка). */
        register: registerKind,
        has: hasKind,
        /** Назначить виду отрисовщик `fn(node, cam) → bool` (true — узел нарисован). */
        renderer: registerKindRenderer,
        /** Назначить виду проход мира `{ begin(cam), end(cam) }` для камеры этого вида. */
        pass: registerKindPass,
        /** Описание видов структурой: имя, заголовок, есть ли отрисовщик, сколько узлов. */
        list() {
            const counts = new Map();
            for (const node of ctx.nodes) {
                if (!node || node.removed) continue;
                const kind = kindOf(node);
                counts.set(kind, (counts.get(kind) || 0) + 1);
            }
            return kindNames().map((name) => ({
                name,
                title: kinds.get(name).title,
                renderer: renderers.has(name),
                nodes: counts.get(name) || 0,
            }));
        },
        /** Вид первого узла по селектору, узлу или обёртке; `null`, если узла нет. */
        of(target) {
            const first = $(target).get(0);
            return first ? kindOf(first) : null;
        },
        normalize: normalizeKind,
    };

    /**
     * Вид узла. Без аргументов — чтение (вид первого узла, '2d' для пустой
     * выборки); с аргументом — назначить всем узлам обёртки. `null` возвращает
     * 2D. Вид не двигает узел и не трогает тело: меняется только то, как узел
     * рисуется и как читаются методы с различиями (docs/RE2D.md §5).
     */
    def('kind', function (value) {
        if (value === undefined) return this.nodes.length ? kindOf(this.nodes[0]) : KIND_2D;
        const kind = normalizeKind(value);
        return this.eachNode((_, node) => { node.kind = kind; });
    });
}
