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
// ---------------------------------------------------------------------------
// Обратная кинематика (IK)
//
// Прямая задача — «по углам найти конец» — уже есть в pose(). Обратная: «дай
// такие углы, чтобы конец цепочки попал в ЦЕЛЬ» — нужна для ступни на
// неровном полу, руки на рукояти, взгляда на игрока.
//
// Две функции, потому что задачи разные:
//   * для ДВУХ костей есть точное решение (закон косинусов) — быстрое и
//     предсказуемое, с выбором стороны сгиба;
//   * для цепочки любой длины — CCD (покоординатный спуск): итеративно
//     доворачиваем каждую кость, чтобы конец смотрел на цель. Не всегда
//     оптимально, но сходится и не взрывается.
// ---------------------------------------------------------------------------

/**
 * IK для ДВУХ костей: точное решение (закон косинусов).
 *
 * `len1`, `len2` — длины; `bend` — сторона сгиба: `+1`/`-1` (по умолчанию +1).
 *
 * Если цель дальше вытянутой руки, кости вытягиваются в сторону цели, а
 * `reached` = false: игра видит, что не дотянулись, и решает сама (обычно —
 * подвинуть тело). Молча «прилипать» к цели нельзя: это выглядит как рывок.
 *
 * Возвращает `{ a1, a2, elbow, reached }` — АБСОЛЮТНЫЕ углы костей, позицию
 * локтя и признак достижимости.
 */
export function solveTwoBoneIK(startX, startY, len1, len2, targetX, targetY, bend) {
    const dx = targetX - startX;
    const dy = targetY - startY;
    const dist = Math.hypot(dx, dy);
    const reach_max = len1 + len2;
    const reach_min = Math.abs(len1 - len2);
    const base = Math.atan2(dy, dx);
    const side = bend < 0 ? -1 : 1;

    // Цель вне досягаемости: тянемся максимально в её сторону.
    if (dist >= reach_max || len1 <= 0 || len2 <= 0) {
        return { a1: base, a2: base, elbow: {
            x: startX + Math.cos(base) * len1,
            y: startY + Math.sin(base) * len1,
        }, reached: dist <= reach_max };
    }
    // Цель слишком близко: кости складываются, и угол считается по минимуму.
    const reach = Math.max(reach_min + 1e-6, dist);
    const cos_a = (len1 * len1 + reach * reach - len2 * len2) / (2 * len1 * reach);
    const a1_off = Math.acos(Math.max(-1, Math.min(1, cos_a)));
    const a1 = base + side * a1_off;
    const elbow = { x: startX + Math.cos(a1) * len1, y: startY + Math.sin(a1) * len1 };
    const a2 = Math.atan2(targetY - elbow.y, targetX - elbow.x);
    return { a1, a2, elbow, reached: true };
}

/**
 * IK для цепочки любой длины — FABRIK (прямые и обратные проходы по позициям).
 *
 * ПОЧЕМУ НЕ CCD. Я сначала написал CCD (доворачивать каждую кость, чтобы конец
 * смотрел на цель) — и он застревал намертво на КОЛЛИНЕАРНОМ старте: если все
 * кости уже вытянуты в сторону цели, `toTip` и `toGoal` совпадают, поворот
 * выходит нулевым, и цепочка не двигается, хотя конец не дотянулся. Тест это
 * поймал сразу (промах не менялся вовсе). FABRIK работает с ПОЗИЦИЯМИ суставов
 * и такой конфигурации не боится.
 *
 * `lengths` — длины костей от начала к концу; `opts.iterations` — проходов
 * (по умолчанию 12); `opts.tolerance` — достаточный промах (по умолчанию 0.5).
 *
 * Возвращает `{ angles, reached, distance }`: `angles` — АБСОЛЮТНЫЕ углы.
 */
export function solveChainIK(startX, startY, lengths, targetX, targetY, opts) {
    const o = opts || {};
    const n = Array.isArray(lengths) ? lengths.length : 0;
    if (n === 0) return { angles: [], reached: false, distance: Infinity };
    const iterations = Number.isFinite(Number(o.iterations)) ? Math.max(1, Number(o.iterations)) : 12;
    const tolerance = Number.isFinite(Number(o.tolerance)) ? Math.max(0, Number(o.tolerance)) : 0.5;
    const total = lengths.reduce((sum, L) => sum + (Number(L) || 0), 0);

    let distance = Math.hypot(targetX - startX, targetY - startY);

    // Цель дальше вытянутой цепочки: вытягиваем её в сторону цели. Это не
    // «неудача алгоритма», а честный ответ: reached = false, а игра решает,
    // подвинуть тело или нет.
    if (distance >= total) {
        const a = Math.atan2(targetY - startY, targetX - startX);
        const angles = new Array(n).fill(a);
        return { angles, reached: false, distance: distance - total };
    }
    if (distance <= 1e-9) {
        // Цель в самом начале: цепочка должна сложиться — складываем пополам.
        const angles = new Array(n).fill(0);
        for (let i = 0; i < n; i++) angles[i] = (i % 2 ? Math.PI : 0);
        return { angles, reached: true, distance: 0 };
    }

    // Начальная раскладка: цепочка вытянута в сторону цели.
    const px = new Array(n + 1);
    const py = new Array(n + 1);
    const dir = Math.atan2(targetY - startY, targetX - startX);
    px[0] = startX; py[0] = startY;
    for (let i = 0; i < n; i++) {
        px[i + 1] = px[i] + Math.cos(dir) * lengths[i];
        py[i + 1] = py[i] + Math.sin(dir) * lengths[i];
    }

    for (let it = 0; it < iterations; it++) {
        // Обратный проход: конец в цель, тянем суставы назад.
        px[n] = targetX;
        py[n] = targetY;
        for (let i = n - 1; i >= 0; i--) {
            let dx = px[i] - px[i + 1];
            let dy = py[i] - py[i + 1];
            let len = Math.hypot(dx, dy);
            if (len < 1e-9) { dx = 1; dy = 0; len = 1; }
            px[i] = px[i + 1] + (dx / len) * lengths[i];
            py[i] = py[i + 1] + (dy / len) * lengths[i];
        }
        // Прямой проход: начало на месте, тянем суставы вперёд.
        px[0] = startX;
        py[0] = startY;
        for (let i = 0; i < n; i++) {
            let dx = px[i + 1] - px[i];
            let dy = py[i + 1] - py[i];
            let len = Math.hypot(dx, dy);
            if (len < 1e-9) { dx = Math.cos(dir); dy = Math.sin(dir); len = 1; }
            px[i + 1] = px[i] + (dx / len) * lengths[i];
            py[i + 1] = py[i] + (dy / len) * lengths[i];
        }
        distance = Math.hypot(targetX - px[n], targetY - py[n]);
        if (distance <= tolerance) break;
    }

    const angles = new Array(n);
    for (let i = 0; i < n; i++) {
        angles[i] = Math.atan2(py[i + 1] - py[i], px[i + 1] - px[i]);
    }
    return { angles, reached: distance <= tolerance, distance };
}

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
         * Обратная кинематика: `$.mesh.ik(rig, angles, target, { chain })`.
         *
         * Двигает ЦЕПОЧКУ костей так, чтобы её конец попал в цель: ступня на
         * неровном полу, рука на рукояти, взгляд на игрока.
         *
         * ```js
         * const rig = $.mesh.skeleton({
         *     leg1: { x: 100, y: 100, length: 40 },
         *     leg2: { parent: 'leg1', length: 40 },
         * });
         * const solved = $.mesh.ik(rig, {}, { x: 130, y: 170 },
         *                          { chain: ['leg1', 'leg2'] });
         * $.mesh.draw(shin, solved.angles, rig);   // нога достала до пола
         * ```
         *
         * `chain` — имена от корня цепочки к концу (обязателен).
         * `opts.bend` — сторона сгиба для двух костей (+1/-1).
         * `opts.iterations`, `opts.tolerance` — для длинных цепочек.
         *
         * Возвращает `{ angles, reached, distance, tip }`: `angles` — готовый
         * объект ДОБАВОЧНЫХ углов для `rig.pose()`/`$.mesh.draw()`, `tip` —
         * куда встал конец.
         */
        ik(rig, angles, target, opts) {
            const o = opts || {};
            const chain = Array.isArray(o.chain) ? o.chain.slice() : [];
            if (!rig || !chain.length) {
                ctx.log('$.mesh.ik: нужен скелет и opts.chain (имена костей)');
                return null;
            }
            const spec = typeof rig.spec === 'function' ? rig.spec() : {};
            const pose_now = rig.pose(angles || {});
            const head = pose_now[chain[0]];
            if (!head) {
                ctx.log(`$.mesh.ik: кости "${chain[0]}" нет в скелете`);
                return null;
            }

            const lengths = chain.map((name) => {
                const L = Number((spec[name] || {}).length);
                return Number.isFinite(L) ? L : 0;
            });
            const goal = { x: Number(target.x) || 0, y: Number(target.y) || 0 };

            // Две кости — точное решение; длиннее — CCD.
            let abs;
            let reached;
            if (chain.length === 2) {
                const r = solveTwoBoneIK(head.x, head.y, lengths[0], lengths[1],
                                         goal.x, goal.y, o.bend);
                abs = [r.a1, r.a2];
                reached = r.reached;
            } else {
                const r = solveChainIK(head.x, head.y, lengths, goal.x, goal.y, o);
                abs = r.angles;
                reached = r.reached;
            }

            // Абсолютные углы → ДОБАВОЧНЫЕ для pose(): pose складывает угол с
            // мировым углом родителя и углом покоя кости.
            const out = {};
            for (let i = 0; i < chain.length; i++) {
                const name = chain[i];
                const b = spec[name] || {};
                const parent_name = b.parent;
                const rest_local = Number(b.angle) || 0;
                let parent_abs = 0;
                if (i > 0 && parent_name === chain[i - 1]) {
                    parent_abs = abs[i - 1];        // родитель — предыдущая кость цепочки
                } else if (parent_name && pose_now[parent_name]) {
                    parent_abs = pose_now[parent_name].angle;   // родитель вне цепочки
                }
                out[name] = normalizeAngle(abs[i] - parent_abs - rest_local);
            }

            // Куда встал конец: считаем по РЕШЁННЫМ углам, а не по цели — иначе
            // игра не увидит, что нога не дотянулась, и «прилипнет» картинкой.
            const last = chain[chain.length - 1];
            const solved_pose = rig.pose(out);
            const tip = typeof rig.tip === 'function' ? rig.tip(solved_pose, last) : null;
            const distance = tip ? Math.hypot(goal.x - tip.x, goal.y - tip.y) : Infinity;
            return { angles: out, reached, distance, tip };
        },

        /**
         * Часть прямо из СЛАЙСА Aseprite: `$.mesh.fromSlice(sheet, 'hand', frame?)`.
         *
         * Aseprite хранит в слайсе прямоугольник И **пивот** — именно это нужно
         * для вращения части: пивот становится началом координат части, поэтому
         * `$.mesh.draw` крутит её вокруг сустава, а не вокруг угла картинки.
         *
         * `sheet` — атлас из `$.atlas`; `frame` — номер кадра в листе (у слайса
         * ключи по кадрам). UV берутся из кадра атласа.
         *
         * `opts`: `bone` (кость для всех вершин), `bones` (по вершине), `depth`,
         * `texture` (по умолчанию — текстура атласа).
         */
        fromSlice(sheet, slice_name, frame, opts) {
            if (!sheet || typeof sheet.slice !== 'function') {
                ctx.log('$.mesh.fromSlice: нужен атлас из $.atlas');
                return null;
            }
            const sl = sheet.slice(slice_name, frame);
            if (!sl) {
                ctx.log(`$.mesh.fromSlice: слайса "${slice_name}" нет в атласе`);
                return null;
            }
            const names = typeof sheet.frames === 'function' ? sheet.frames() : [];
            const frame_name = names[sl.frame] !== undefined ? names[sl.frame] : names[0];
            const info = typeof sheet.info === 'function' ? sheet.info(frame_name) : null;
            if (!info) {
                ctx.log(`$.mesh.fromSlice: кадра "${frame_name}" нет в атласе`);
                return null;
            }
            const size = typeof sheet.size === 'function' ? sheet.size() : [1, 1];
            const sw = size[0] > 0 ? size[0] : 1;
            const sh = size[1] > 0 ? size[1] : 1;
            const u0 = info.x / sw, v0 = info.y / sh;
            const u1 = (info.x + info.w) / sw, v1 = (info.y + info.h) / sh;

            // Пивот — начало координат части: тогда вращение идёт вокруг него.
            const x0 = -sl.pivotLx, y0 = -sl.pivotLy;
            const x1 = x0 + sl.w, y1 = y0 + sl.h;

            const o = opts || {};
            const bones = o.bones
                ? o.bones
                : (o.bone ? [o.bone, o.bone, o.bone, o.bone] : null);
            const spec = {
                verts: [x0, y0, x1, y0, x1, y1, x0, y1],
                uv: [u0, v0, u1, v0, u1, v1, u0, v1],
                tris: [0, 1, 2, 0, 2, 3],
                texture: o.texture === undefined
                    ? (sheet.texture === undefined ? -1 : sheet.texture)
                    : Number(o.texture),
                depth: o.depth,
            };
            if (bones) spec.bones = bones;
            const part = createPart(spec);
            part.slice = { name: String(slice_name), frame: sl.frame };
            part.pivot = { x: sl.pivotLx, y: sl.pivotLy };
            return part;
        },

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
