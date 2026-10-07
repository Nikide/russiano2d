// ===========================================================================
// Меш со скелетом — $.mesh
//
// Псевдо-3D персонаж из частей-квадов: вершины деформируются скелетом, а
// z-буфер разбирается с самопересечениями частей. Это вторая половина §4.1
// (первая — текстура и UV в `engine.submitMesh`, см. depth.md §4).
//
//   const rig = $.mesh.skeleton({
//       root: { length: 0, angle: 0 },
//       arm:  { parent: 'root', length: 30, angle: 0 },
//   });
//   const part = $.mesh.part({
//       texture: tex,                       // id текстуры (необязательно)
//       verts: [0,0, 30,0, 30,10, 0,10],    // x,y в локальных координатах
//       uv:    [0,0, 1,0, 1,1, 0,1],
//       tris:  [0,1,2, 0,2,3],
//       bones: ['arm','arm','arm','arm'],   // по одной кости на вершину
//   });
//   $.mesh.draw(part, rig.pose({ arm: 0.6 }));   // → число вершин
//
// ПОЧЕМУ CPU. Вершинный шейдер движка без юниформ-буферов: проекцию и
// деформацию считает JS. Это осознанно (см. §4 TASKS) — GPU-математика не
// нужна, а `submitMesh` уже принимает готовые клип-координаты.
//
// БЕЗ АЛЛОКАЦИЙ В КАДРЕ. Деформированный меш пишется в ПЕРЕИСПОЛЬЗУЕМЫЙ
// Float32Array, который растёт только при нехватке места: перф-отчёт показал
// цену объектов на кадр, а персонажей на экране бывает десяток.
// ===========================================================================

import { ctx, engineOf } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть: скелет и деформация
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

/** Привести угол к (-π, π]: так повороты накапливаются без «накрутки». */
export function normalizeAngle(a) {
    let x = Number(a) || 0;
    x = x % TAU;
    if (x > Math.PI) x -= TAU;
    if (x <= -Math.PI) x += TAU;
    return x;
}

/**
 * Описание скелета: `{ имя: { parent?, length?, angle?, x?, y? } }`.
 *
 * Кость — это «угол + длина»: своя позиция относительно родителя и свой
 * поворот. Мировые позиции считаются сложением по дереву, поэтому анимация
 * задаёт ОДИН угол на кость, а не координаты.
 *
 * Возвращает объект с `bones()` (имена в порядке родителей), `pose(angles)` и
 * `rest()`.
 */
export function createSkeleton(spec) {
    const raw = spec && typeof spec === 'object' ? spec : {};
    const names = Object.keys(raw);
    // Порядок: родитель раньше ребёнка. Иначе мировые позиции считались бы по
    // ещё не посчитанному родителю — а это молчаливая ошибка в картинке.
    const order = [];
    const pending = names.slice();
    while (pending.length) {
        const before = pending.length;
        for (let i = pending.length - 1; i >= 0; --i) {
            const name = pending[i];
            const parent = raw[name] && raw[name].parent;
            if (!parent || order.includes(parent)) {
                order.push(name);
                pending.splice(i, 1);
            }
        }
        if (pending.length === before) {
            // Цикл или битый родитель: не крутимся вечно, берём как есть.
            ctx.log('$.mesh.skeleton: циклические родители, беру порядок как дан');
            order.push(...pending.splice(0));
        }
    }

    const bone = (name) => raw[name] || {};
    const restAngle = (name) => Number(bone(name).angle) || 0;
    const restLen = (name) => {
        const L = Number(bone(name).length);
        return Number.isFinite(L) ? L : 0;
    };

    /**
     * Мировые позы костей для набора углов.
     *
     * `angles` — добавочный поворот на кость (не «мировой» угол): так анимация
     * описывает движение сустава, а не абсолютную ориентацию. Возвращает
     * `{ имя: { x, y, angle } }` — позиция НАЧАЛА кости и её мировой угол.
     */
    function pose(angles) {
        const add = angles && typeof angles === 'object' ? angles : {};
        const out = Object.create(null);
        for (const name of order) {
            const b = bone(name);
            const parent = b.parent && out[b.parent] ? out[b.parent] : null;
            const local = restAngle(name) + (Number(add[name]) || 0);
            const px = parent ? parent.x : (Number(b.x) || 0);
            const py = parent ? parent.y : (Number(b.y) || 0);
            const pangle = parent ? parent.angle : 0;
            const angle = parent ? normalizeAngle(pangle + local) : local;
            // Кость растёт от начала родителя в его направлении: так получается
            // «цепочка», и ребёнок сам оказывается на конце родителя.
            const x = parent ? parent.x + Math.cos(parent.angle) * restLen(b.parent)
                             : px;
            const y = parent ? parent.y + Math.sin(parent.angle) * restLen(b.parent)
                             : py;
            out[name] = { x, y, angle };
        }
        return out;
    }

    return {
        names: order.slice(),
        bones() { return order.slice(); },
        spec() { return raw; },
        rest() { return pose({}); },
        pose,
        /** Конец кости: удобно вешать дочернюю часть без угадывания длины. */
        tip(poseObj, name) {
            const p = poseObj && poseObj[name];
            if (!p) return null;
            const L = restLen(name);
            return { x: p.x + Math.cos(p.angle) * L, y: p.y + Math.sin(p.angle) * L };
        },
    };
}

/**
 * Описание части: вершины, UV, треугольники и кость на каждую вершину.
 *
 * `verts` — плоский `x, y`; `uv` — плоский `u, v`; `tris` — индексы по три;
 * `bones` — имя кости на ВЕРШИНУ (или `weights` — до двух костей на вершину
 * для мягкого сгиба).
 */
export function createPart(spec) {
    const s = spec && typeof spec === 'object' ? spec : {};
    const verts = Array.isArray(s.verts) ? s.verts.slice() : [];
    const uv = Array.isArray(s.uv) ? s.uv.slice() : [];
    const tris = Array.isArray(s.tris) ? s.tris.slice() : [];
    const n = Math.floor(verts.length / 2);
    const colors = Array.isArray(s.colors) ? s.colors.slice() : null;
    const depth = Number.isFinite(Number(s.depth)) ? Number(s.depth) : 0.5;
    const texture = s.texture === undefined ? -1 : Number(s.texture);

    // Веса: либо `bones` (одна кость, вес 1), либо `weights` — массив на
    // вершину из пар `[кость, вес]` (до двух: больше в 2D не нужно).
    let weights;
    if (Array.isArray(s.weights)) {
        weights = s.weights.map((w) => {
            const list = Array.isArray(w) ? w : [];
            const out = [];
            for (let i = 0; i + 1 < list.length && out.length < 2; i += 2) {
                out.push([String(list[i]), Number(list[i + 1]) || 0]);
            }
            return out;
        });
    } else if (Array.isArray(s.bones)) {
        weights = s.bones.map((b) => [[String(b), 1]]);
    } else {
        weights = new Array(n).fill(null).map(() => []);
    }

    return {
        verts, uv, tris, weights, colors, depth, texture,
        vertexCount: n,
        /** Есть ли у части скелет: без него деформация не нужна. */
        skinned: weights.some((w) => w.length > 0),
        spec() { return s; },
    };
}

/**
 * Деформировать часть позой в `out` (плоский `x, y, z, u, v, r, g, b`).
 *
 * Линейное смешивание: позиция вершины усредняется по костям с их весами, а
 * затем сдвигается разницей между текущей и покойной позой кости. Так вершина
 * на стыке двух костей «тянется» между ними — это и есть мягкий сгиб.
 *
 * Возвращает число записанных вершин. Ничего не аллоцирует, кроме роста `out`.
 */
export function deformPart(part, poseObj, restObj, out) {
    const n = part.vertexCount;
    const need = n * 8;
    if (out.length < need) return { buffer: out, count: 0, need };

    const verts = part.verts;
    const uv = part.uv;
    const colors = part.colors;
    const depth = part.depth;

    for (let i = 0; i < n; ++i) {
        let x = verts[i * 2];
        let y = verts[i * 2 + 1];
        const w = part.weights[i];
        if (w && w.length) {
            let dx = 0, dy = 0, total = 0;
            for (let k = 0; k < w.length; ++k) {
                const name = w[k][0];
                const weight = w[k][1];
                const cur = poseObj ? poseObj[name] : null;
                const rest = restObj ? restObj[name] : null;
                if (!cur || !rest) continue;
                total += weight;
                // Разница позы: вершина сдвигается на столько же, на сколько
                // уехало НАЧАЛО кости, и поворачивается на разницу углов.
                const da = cur.angle - rest.angle;
                const ca = Math.cos(da), sa = Math.sin(da);
                const lx = verts[i * 2] - rest.x;
                const ly = verts[i * 2 + 1] - rest.y;
                const rx = lx * ca - ly * sa + cur.x;
                const ry = lx * sa + ly * ca + cur.y;
                dx += (rx - verts[i * 2]) * weight;
                dy += (ry - verts[i * 2 + 1]) * weight;
            }
            if (total > 0.0001) {
                x += dx / total;
                y += dy / total;
            }
        }
        const o = i * 8;
        out[o] = x;
        out[o + 1] = y;
        out[o + 2] = depth;
        out[o + 3] = uv[i * 2] || 0;
        out[o + 4] = uv[i * 2 + 1] || 0;
        const c = colors ? colors[i] : null;
        if (Array.isArray(c)) {
            out[o + 5] = Number(c[0]) || 0;
            out[o + 6] = Number(c[1]) || 0;
            out[o + 7] = Number(c[2]) || 0;
        } else {
            out[o + 5] = 255;
            out[o + 6] = 255;
            out[o + 7] = 255;
        }
    }
    return { buffer: out, count: n, need };
}

export function installMesh($) {
    // ДВА переиспользуемых буфера, и это важно: деформированные вершины и
    // развёрнутый по треугольникам список нельзя держать в одном — развёртка
    // перезаписала бы вершины, которые ещё читает.
    let scratch = new Float32Array(1024 * 8);   // деформированные вершины
    let flat = new Float32Array(1024 * 8);      // то же, но по треугольникам

    const api = {
        /** Описать скелет: `{ имя: { parent?, length?, angle?, x?, y? } }`. */
        skeleton(spec) { return createSkeleton(spec); },

        /** Описать часть: вершины, UV, треугольники, кости. */
        part(spec) { return createPart(spec); },

        /**
         * Нарисовать часть в позе. `pose` может быть объектом углов
         * (`{ arm: 0.6 }`) или результатом `rig.pose(...)`.
         *
         * Возвращает число вершин. Без `pose` рисуется покойная поза.
         */
        draw(part, poseOrAngles, rig, opts) {
            if (!part || !part.vertexCount || !part.tris.length) return 0;
            const o = opts || {};
            // Поза: либо уже посчитанные мировые кости, либо углы + скелет.
            let poseObj = null, restObj = null;
            if (rig) {
                const angles = poseOrAngles && typeof poseOrAngles === 'object'
                    ? poseOrAngles : {};
                poseObj = rig.pose(angles);
                restObj = rig.rest();
            } else if (poseOrAngles && poseOrAngles.__pose) {
                poseObj = poseOrAngles.__pose;
                restObj = poseOrAngles.__rest || poseOrAngles.__pose;
            }

            const need = part.vertexCount * 8;
            if (scratch.length < need) {
                let size = scratch.length;
                while (size < need) size *= 2;
                scratch = new Float32Array(size);
            }
            const r = deformPart(part, poseObj, restObj, scratch);
            if (!r.count) return 0;

            // Треугольники: у части свои индексы, а submitMesh ест вершины
            // подряд. Поэтому собираем развёрнутый список вершин по
            // треугольникам — БЕЗ промежуточных массивов объектов.
            const engine_ = engineOf();
            const tri = part.tris.length;
            if (tri % 3) return 0;
            if (flat.length < tri * 8) {
                let size = flat.length;
                while (size < tri * 8) size *= 2;
                flat = new Float32Array(size);
            }
            const outTris = flat;
            for (let i = 0; i < tri; ++i) {
                const src = part.tris[i] * 8;
                const dst = i * 8;
                outTris[dst] = scratch[src];
                outTris[dst + 1] = scratch[src + 1];
                outTris[dst + 2] = scratch[src + 2];
                outTris[dst + 3] = scratch[src + 3];
                outTris[dst + 4] = scratch[src + 4];
                outTris[dst + 5] = scratch[src + 5];
                outTris[dst + 6] = scratch[src + 6];
                outTris[dst + 7] = scratch[src + 7];
            }
            const texture = o.texture === undefined ? part.texture : Number(o.texture);
            return engine_.submitMesh(outTris, tri, texture);
        },

        /** Размеры рабочих буферов: видно, что они переиспользуются. */
        scratchSize() { return scratch.length; },
        flatSize() { return flat.length; },

        /**
         * Готовая поза как объект: `rig.pose({...})` возвращает мировые кости,
         * а `$.mesh.posed(rig, angles)` заворачивает её так, что `draw` поймёт
         * без повторного пересчёта.
         */
        posed(rig, angles) {
            return { __pose: rig.pose(angles), __rest: rig.rest() };
        },
    };
    return api;
}
