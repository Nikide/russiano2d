// ===========================================================================
// BSP-дерево из игры: $.world.bsp — порядок отрезков «от дальних к ближним».
//
// Низкоуровневые вызовы `engine.bsp.*` были единственной подсистемой движка,
// не обёрнутой в `$`: их потребитель (демо `bsp`) писал их руками, а игра не
// могла получить корректный порядок отрисовки наклонной геометрии.
//
// Подсистема тонкая: она переводит данные в форму, удобную игре (объекты
// `{ x1, y1, x2, y2, tag }` вместо плоского массива), и оставляет дерево
// живым между кадрами — построение дорогое, обход дешёвый.
//
//   $.world.bsp.build($.world.bsp.fromLines(walls));
//   const order = $.world.bsp.order(cam.pos());     // [{ index, ...segment }]
//   for (const s of order) $.gfx.draw.line(s.x1, s.y1, s.x2, s.y2, '#8899aa');
//   $.world.bsp.clear();                            // в onExit сцены
//
// Отрезки — это стены, бордюры, любые препятствия: порядок нужен, когда
// геометрия перестаёт быть регулярной сеткой (для сеточного рейкастера дерево
// только мешает). Спрайты дерево не упорядочивает — их сортируют по
// расстоянию до наблюдателя (см. internal/NATIVE.md §13).
// ===========================================================================

import { engine } from './native.js';
import { ctx, query } from './core.js';

/** Плоский массив отрезков (stride 4) → список объектов. */
export function segmentsFromFlat(flat) {
    const out = [];
    if (!flat) return out;
    const n = Math.floor(flat.length / 4);
    for (let i = 0; i < n; ++i) {
        const o = i * 4;
        out.push({ x1: flat[o], y1: flat[o + 1], x2: flat[o + 2], y2: flat[o + 3] });
    }
    return out;
}

/**
 * Отрезки в плоский массив для engine.bsp.build (stride 5: x1,y1,x2,y2,метка).
 * Принимает: массив объектов `{x1,y1,x2,y2}` или `[x1,y1,x2,y2]`, или линии
 * вида `[[x1,y1],[x2,y2]]`.
 */
export function segmentsToFlat(list, tagOf) {
    if (!list || !list.length) return new Float32Array(0);
    const out = new Float32Array(list.length * 5);
    for (let i = 0; i < list.length; ++i) {
        const s = list[i];
        let x1, y1, x2, y2, tag = i;
        if (Array.isArray(s) && s.length === 4) {
            [x1, y1, x2, y2] = s;
        } else if (Array.isArray(s) && s.length === 2) {
            x1 = s[0].x !== undefined ? s[0].x : s[0][0];
            y1 = s[0].y !== undefined ? s[0].y : s[0][1];
            x2 = s[1].x !== undefined ? s[1].x : s[1][0];
            y2 = s[1].y !== undefined ? s[1].y : s[1][1];
        } else if (s) {
            x1 = s.x1; y1 = s.y1; x2 = s.x2; y2 = s.y2;
            if (s.tag !== undefined) tag = s.tag;
        }
        const o = i * 5;
        out[o] = Number(x1) || 0;
        out[o + 1] = Number(y1) || 0;
        out[o + 2] = Number(x2) || 0;
        out[o + 3] = Number(y2) || 0;
        out[o + 4] = typeof tagOf === 'function' ? tagOf(s, i) : tag;
    }
    return out;
}

/** Обёртка над engine.bsp.* с человеческими формами данных. */
export function installBsp($) {
    const bsp = {
        /** Есть ли построенное дерево. */
        ready() {
            return !!(engine.bsp && engine.bsp.count() > 0);
        },

        /** Построить дерево: $.world.bsp.build([[x1,y1,x2,y2], …]) → bool. */
        build(segments, opts) {
            if (typeof engine.bsp === 'undefined' || !engine.bsp) return false;
            const flat = segments instanceof Float32Array
                ? segments
                : segmentsToFlat(segments, opts && opts.tag);
            if (!flat.length) {
                ctx.log('$.world.bsp.build: нужны отрезки (массив или Float32Array)');
                return false;
            }
            return !!engine.bsp.build(flat);
        },

        /** Освободить дерево: в onExit сцены, которой оно больше не нужно. */
        clear() {
            if (typeof engine.bsp !== 'undefined' && engine.bsp) engine.bsp.clear();
        },

        /** Сколько отрезков в дереве (с учётом порождённых разрезанием). */
        count() { return engine.bsp ? engine.bsp.count() : 0; },
        nodes() { return engine.bsp ? engine.bsp.nodes() : 0; },
        depth() { return engine.bsp ? engine.bsp.depth() : 0; },

        /** Отрезок по индексу: { index, x1, y1, x2, y2, tag, split } | null. */
        segment(index) {
            if (!engine.bsp) return null;
            const raw = engine.bsp.segment(index | 0);
            if (!raw) return null;
            return {
                index: index | 0,
                x1: raw[0], y1: raw[1], x2: raw[2], y2: raw[3],
                tag: raw[4], split: !!raw[5],
            };
        },

        /**
         * Порядок отрисовки из точки наблюдателя: от дальних к ближним.
         * `from` — `{x, y}`, узел, обёртка или селектор; `opts.near` — обратный
         * порядок. Возвращает массив отрезков (или пустой массив).
         */
        order(from, opts) {
            if (!engine.bsp) return [];
            const p = resolvePoint(from);
            const far = !(opts && opts.near);
            const idx = engine.bsp.order(p.x, p.y, far);
            if (!idx) return [];
            const out = new Array(idx.length);
            for (let i = 0; i < idx.length; ++i) out[i] = bsp.segment(idx[i]);
            return out;
        },

        /** Индексы без разбора в объекты (когда нужен только порядок). */
        indices(from, opts) {
            if (!engine.bsp) return [];
            const p = resolvePoint(from);
            return engine.bsp.order(p.x, p.y, !(opts && opts.near)) || [];
        },
    };

    // Прячем под $.world: порядок отрисовки — свойство мира, как raycast.
    if (ctx.world) ctx.world.bsp = bsp;
    return bsp;
}

/** Точка из узла, обёртки, селектора, `{x,y}` или `[x, y]`. */
function resolvePoint(target) {
    if (!target) return { x: 0, y: 0 };
    if (typeof target === 'string') {
        const node = query(target)[0];
        return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
    }
    if (target.nodes) {
        const node = target.nodes[0];
        return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
    }
    if (target.tag) return { x: target.x, y: target.y };
    if (Array.isArray(target)) return { x: Number(target[0]) || 0, y: Number(target[1]) || 0 };
    return { x: Number(target.x) || 0, y: Number(target.y) || 0 };
}
