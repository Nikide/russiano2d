// ===========================================================================
// Реактивные запросы: `$.watch(селектор, { onEnter, onLeave })`.
//
// Триггеры (`<trigger>`, $.triggers) отвечают на ПЕРЕСЕЧЕНИЕ в мире; watch — на
// ВХОЖДЕНИЕ В ВЫБОРКУ: узел попал под селектор или перестал под него
// подходить (удалён, сменил класс, вышел из радиуса `within()` и т. п.).
// Это минимальные onEnter/onLeave из ROADMAP, фаза 7.
//
// Сравнение — по uid узла, поэтому пересозданный узел считается новым
// вхождением, а удалённый не путается с чужим. Кадр без наблюдателей не стоит
// ничего: tickWatch выходит на первой проверке (правило контракта: тик не
// сканирует реестр, когда подсистеме нечего делать).
// ===========================================================================

import { ctx, query, wrapOne } from './core.js';

const watchers = [];
let next_id = 1;

/**
 * Подписаться на выборку. Возвращает handle: `{ id, stop(), size(), active() }`.
 *
 * ```js
 * const w = $.watch('.enemy:dead', {
 *     onLeave: (node) => $.emit('kill', node),   // враг вышел из выборки живых
 * });
 * w.stop();
 * ```
 *
 * `handlers` — функция (то же, что `onEnter`) или объект:
 * `onEnter(node)`, `onLeave(node)`, `immediate` (вызвать onEnter для тех, кто
 * уже подходит, — по умолчанию нет: «вошёл» значит «вошёл потом»).
 */
export function installWatch($) {
    const watch = function (sel, handlers) {
        const h = typeof handlers === 'function' ? { onEnter: handlers } : (handlers || {});
        const w = {
            id: next_id++,
            sel,
            on_enter: typeof h.onEnter === 'function' ? h.onEnter : null,
            on_leave: typeof h.onLeave === 'function' ? h.onLeave : null,
            immediate: h.immediate === true,
            seen: new Map(),       // uid → последний известный узел
            first: true,
            active: true,
        };
        watchers.push(w);

        const handle = {
            id: w.id,
            /** Прекратить наблюдение (повторный вызов безопасен). */
            stop() {
                w.active = false;
                return handle;
            },
            /** Сколько узлов сейчас в выборке (по последнему тику). */
            size() { return w.seen.size; },
            /** Наблюдение ещё живо? */
            active() { return w.active; },
            /** Селектор наблюдения. */
            selector() { return w.sel; },
        };
        return handle;
    };

    /** Сколько наблюдений живо. */
    watch.count = function () {
        let n = 0;
        for (const w of watchers) if (w.active) n++;
        return n;
    };

    /** Остановить все наблюдения. */
    watch.clear = function () {
        for (const w of watchers) w.active = false;
        return watch;
    };

    /** Идентификаторы живых наблюдений — для диагностики. */
    watch.list = function () {
        return watchers.filter((w) => w.active).map((w) => ({ id: w.id, sel: w.sel, size: w.seen.size }));
    };

    ctx.watch = watch;
    $.watch = watch;
}

/**
 * Кадровый шаг: сравнить выборки с прошлым кадром и раздать вход/выход.
 * Вызывается из кадра `$` (api.js) после триггеров.
 */
export function tickWatch() {
    if (watchers.length === 0) return;

    for (let i = watchers.length - 1; i >= 0; i--) {
        const w = watchers[i];
        if (!w.active) { watchers.splice(i, 1); continue; }

        const nodes = query(w.sel);
        const current = new Set();

        for (let k = 0; k < nodes.length; k++) {
            const node = nodes[k];
            current.add(node.uid);
            if (w.seen.has(node.uid)) continue;    // уже был
            w.seen.set(node.uid, node);
            // На первом тике «уже подходящие» не считаются вошедшими, если не
            // просили immediate: иначе подписка сразу зальёт игру событиями.
            if (!w.first || w.immediate) {
                if (w.on_enter) w.on_enter(wrapOne(node));
            }
        }

        // Выход: узлы, которых в выборке больше нет. Узел мог быть удалён —
        // отдаём последнюю известную ссылку и говорим об этом в доке.
        for (const [uid, node] of w.seen) {
            if (current.has(uid)) continue;
            w.seen.delete(uid);
            if (w.on_leave) w.on_leave(wrapOne(node));
        }

        w.first = false;
    }
}
