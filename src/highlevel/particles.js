// ===========================================================================
// CPU-частицы: тег <particles> — аналог CPUParticles2D из Godot 4.
//
// Эмиттер живёт целиком в JS: своё состояние (пул частиц, накопитель эмиссии,
// генератор случайных чисел) хранится в WeakMap по узлу, а рисование идёт
// через общий батч $.gfx.push.sprite. C про частицы не знает, поэтому модуль
// не требует ни одного нового метода у движка.
//
// Что важно помнить при чтении:
//   * частицы НЕ тела физики — это точки в мире/локальной системе узла;
//   * в режиме local (по умолчанию) смещения частиц хранятся относительно
//     узла и поворачиваются вместе с ним при отрисовке; в global — абсолютные
//     мировые координаты, узел на них больше не влияет;
//   * при заданном seed вся последовательность детерминирована (makeRandom).
//
// Контракт модуля: installParticles($) и tickParticles(dt).
// Чистые функции (sampleRamp, buildRamp, buildParams, spawnParticle,
// stepParticle) экспортируются наружу — их гоняет qjs-харнесс без движка.
// ===========================================================================

import { ctx, Node, TAGS, wrapOne, def, packColor, withAlpha,
         resolveSprite, makeRandom, nodesByTag } from './core.js';
import { registerNodeRenderer } from './render.js';

// Предел батча спрайтов движка (см. render.js). Один эмиттер не должен
// выбирать его целиком, иначе частицы других систем молча исчезнут, поэтому
// рисуем не больше своей доли.
const MAX_DRAW_PER_EMITTER = 4096;
const MAX_PARTICLES_HARD = 16384;

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Рампы (кривые) параметров
//
// Рампа — массив стопов [{ t, value }] либо [{ t, color }], отсортированный
// по t. buildRamp переводит их в числовой вид заранее (один раз при создании
// эмиттера), чтобы в кадре не звать packColor на каждую частицу.
// ---------------------------------------------------------------------------

function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }

function num(value, def) {
    if (value === undefined || value === null || value === '') return def;
    const v = Number(value);
    return Number.isFinite(v) ? v : def;
}

/** Число из стопа скалярной рампы: поддерживаем value/alpha/size/v. */
function stopValue(stop) {
    if (stop.value !== undefined) return num(stop.value, 0);
    if (stop.alpha !== undefined) return num(stop.alpha, 0);
    if (stop.size !== undefined) return num(stop.size, 0);
    if (stop.v !== undefined) return num(stop.v, 0);
    return 0;
}

/** Линейная интерполяция двух упакованных RGBA. */
function lerpColor(a, b, k) {
    if (a === b) return a;
    const ar = a & 0xff, ag = (a >>> 8) & 0xff, ab = (a >>> 16) & 0xff, aa = (a >>> 24) & 0xff;
    const br = b & 0xff, bg = (b >>> 8) & 0xff, bb = (b >>> 16) & 0xff, ba = (b >>> 24) & 0xff;
    return engine.rgba(
        Math.round(ar + (br - ar) * k),
        Math.round(ag + (bg - ag) * k),
        Math.round(ab + (bb - ab) * k),
        Math.round(aa + (ba - aa) * k));
}

/**
 * Готовит числовую рампу из стопов. kind: 'color' — стопы {t, color},
 * 'value' — {t, value|alpha|size}. Возвращает массив с признаком .color.
 */
export function buildRamp(stops, kind) {
    if (!Array.isArray(stops) || stops.length === 0) return null;
    const out = [];
    for (const stop of stops) {
        if (!stop) continue;
        const t = clamp01(num(stop.t, 0));
        const v = kind === 'color' ? packColor(stop.color !== undefined ? stop.color : stop.value)
                                   : stopValue(stop);
        out.push({ t, v });
    }
    if (out.length === 0) return null;
    out.sort((a, b) => a.t - b.t);
    out.color = kind === 'color';
    return out;
}

/** Значение рампы в точке t (число или упакованный цвет). */
function rampAt(ramp, t) {
    if (!ramp || ramp.length === 0) return 0;
    const tt = clamp01(t);
    const first = ramp[0];
    if (tt <= first.t) return first.v;
    const last = ramp[ramp.length - 1];
    if (tt >= last.t) return last.v;
    for (let i = 1; i < ramp.length; i++) {
        const b = ramp[i];
        if (tt <= b.t) {
            const a = ramp[i - 1];
            const span = b.t - a.t;
            const k = span > 1e-9 ? (tt - a.t) / span : 0;
            return ramp.color ? lerpColor(a.v, b.v, k) : a.v + (b.v - a.v) * k;
        }
    }
    return last.v;
}

/**
 * Значение рампы в точке t. Для стопов с полем color возвращает упакованный
 * RGBA (цвета интерполируются по каналам), иначе — число.
 */
export function sampleRamp(stops, t) {
    if (!Array.isArray(stops) || stops.length === 0) return 0;
    const is_color = stops.some((s) => s && s.color !== undefined);
    return rampAt(buildRamp(stops, is_color ? 'color' : 'value'), t);
}

// ---------------------------------------------------------------------------
// Разбор параметров
// ---------------------------------------------------------------------------

/** Диапазон [min, max]: число → [v, v], [a, b] → отсортировано. */
function pair(value, dmin, dmax) {
    if (Array.isArray(value)) {
        const a = num(value[0], dmin);
        const b = value.length > 1 ? num(value[1], a) : a;
        return a <= b ? [a, b] : [b, a];
    }
    if (value !== undefined && value !== null) {
        const v = num(value, dmin);
        return [v, v];
    }
    return [dmin, dmax];
}

/** Гравитация частиц: число — вниз по Y, [x, y] или {x, y}. */
function gravityOf(value) {
    if (Array.isArray(value)) return { x: num(value[0], 0), y: num(value[1], 0) };
    if (value && typeof value === 'object') return { x: num(value.x, 0), y: num(value.y, 0) };
    if (typeof value === 'number') return { x: 0, y: value };
    return { x: 0, y: 0 };
}

function toBurst(value) {
    if (value === undefined || value === null || value === false) return [];
    const list = Array.isArray(value) ? value : [value];
    const out = [];
    for (const item of list) {
        const n = Math.floor(num(item, 0));
        if (n > 0) out.push(n);
    }
    return out;
}

function zoneOf(spec) {
    const z = spec.emit_zone;
    let shape = 'point';
    let w = 0, h = 0, radius = 0;
    if (typeof z === 'string') {
        shape = z;
    } else if (z && typeof z === 'object') {
        shape = z.shape || z.type || (z.radius !== undefined || z.r !== undefined ? 'circle'
            : (z.w !== undefined || z.h !== undefined ? 'rect' : 'point'));
        w = num(z.w, 0);
        h = num(z.h, 0);
        radius = num(z.radius !== undefined ? z.radius : z.r, 0);
    }
    w = num(spec.emit_zone_w, w);
    h = num(spec.emit_zone_h, h);
    radius = num(spec.emit_zone_radius, radius);
    if (shape !== 'rect' && shape !== 'circle') shape = 'point';
    return { shape, w: Math.max(0, w), h: Math.max(0, h), radius: Math.max(0, radius) };
}

let blend_warned = false;

/**
 * Сырой набор опций → нормализованные параметры эмиттера. Чистая функция:
 * не трогает узлы и не грузит текстуры — её гоняет qjs-харнесс напрямую.
 */
export function buildParams(spec) {
    const s = spec || {};
    const p = {};

    p.amount = Math.max(1, Math.floor(num(s.amount, 32)));
    const cap = num(s.max_particles, Math.min(4096, Math.max(p.amount * 4, 256)));
    p.max_particles = Math.max(1, Math.min(MAX_PARTICLES_HARD, Math.floor(cap)));
    if (p.amount > p.max_particles) p.amount = p.max_particles;

    const life = pair(s.lifetime, 1000, 1000);
    p.life_min = Math.max(0.001, life[0] / 1000);
    p.life_max = Math.max(p.life_min, life[1] / 1000);

    const speed = pair(s.speed, 100, 100);
    p.speed_min = speed[0];
    p.speed_max = speed[1];

    p.direction = num(s.direction, 0);        // градусы, 0 — вправо (+X)
    p.spread = Math.max(0, num(s.spread, 0)); // полный угол разброса, градусы
    p.gravity = gravityOf(s.gravity);

    const angle = pair(s.angle, 0, 0);
    p.angle_min = angle[0];
    p.angle_max = angle[1];
    const av = pair(s.angular_velocity, 0, 0);
    p.av_min = av[0];
    p.av_max = av[1];

    const size = pair(s.size, 8, 8);
    p.size_min = size[0];
    p.size_max = size[1];
    p.has_end_size = s.end_size !== undefined && s.end_size !== null;
    const es = p.has_end_size ? pair(s.end_size, p.size_min, p.size_max) : [p.size_min, p.size_max];
    p.end_size_min = es[0];
    p.end_size_max = es[1];

    p.ramp_size = Array.isArray(s.size_ramp) && s.size_ramp.length > 0
        ? buildRamp(s.size_ramp, 'value') : null;

    const base_color = s.color !== undefined ? s.color : '#ffffff';
    let color_stops = s.color_ramp;
    if (!Array.isArray(color_stops) || color_stops.length === 0) {
        const end = s.end_color !== undefined ? s.end_color : base_color;
        color_stops = [{ t: 0, color: base_color }, { t: 1, color: end }];
    }
    p.ramp_color = buildRamp(color_stops, 'color') || buildRamp([{ t: 0, color: base_color }], 'color');

    let alpha_stops = s.alpha_ramp;
    if (!Array.isArray(alpha_stops) || alpha_stops.length === 0) {
        alpha_stops = [{ t: 0, value: 1 }, { t: 1, value: 1 }];
    }
    p.ramp_alpha = buildRamp(alpha_stops, 'value') || buildRamp([{ t: 0, value: 1 }], 'value');

    p.damping = Math.max(0, num(s.damping, 0));
    p.local = !(s.global === true) && s.local !== false;
    p.one_shot = !!s.one_shot;
    p.emitting = s.emitting !== false;
    p.burst = toBurst(s.burst);

    if (s.rate !== undefined && s.rate !== null) {
        p.rate = Math.max(0, num(s.rate, 0));
    } else if (s.interval !== undefined && s.interval !== null) {
        const interval = num(s.interval, 0);
        p.rate = interval > 0 ? 1000 / interval : 0;
    } else {
        // По умолчанию успеваем полностью обновить пул за среднее время жизни.
        const avg = (p.life_min + p.life_max) / 2;
        p.rate = avg > 0 ? p.amount / avg : 0;
    }

    p.emit_zone = zoneOf(s);
    p.seed = s.seed !== undefined && s.seed !== null ? (num(s.seed, 0) >>> 0) : 0;
    p.texture = s.texture !== undefined ? s.texture : s.src;
    p.alpha = Math.max(0, num(s.alpha, 1));

    // Суб-эмиттер: залп другого эффекта из точки, где умерла частица
    // (искры → дым → пепел). Глубина ровно один уровень, чтобы не было
    // бесконечной цепочки; живёт в отдельном узле-эмиттере.
    if (s.on_death !== undefined && s.on_death !== null) p.sub = s.on_death;
    else if (s.onDeath !== undefined && s.onDeath !== null) p.sub = s.onDeath;
    else if (s.sub !== undefined && s.sub !== null) p.sub = s.sub;

    // Режимы смешивания конвейер не умеет (см. .blend() в api.js): ругаемся
    // один раз на процесс, чтобы не спамить в журнал каждый кадр.
    if (s.blend !== undefined && !blend_warned) {
        blend_warned = true;
        ctx.log(`$: <particles>.blend("${s.blend}") — конвейер движка рисует только обычным альфа-смешиванием; режим проигнорирован`);
    }

    return p;
}

// ---------------------------------------------------------------------------
// Частица
// ---------------------------------------------------------------------------

function zoneOffset(zone, rng) {
    if (zone.shape === 'rect') {
        return [rng.range(-zone.w / 2, zone.w / 2), rng.range(-zone.h / 2, zone.h / 2)];
    }
    if (zone.shape === 'circle') {
        const a = rng.range(0, Math.PI * 2);
        const r = zone.radius * Math.sqrt(rng.next());
        return [Math.cos(a) * r, Math.sin(a) * r];
    }
    return [0, 0];
}

/**
 * Инициализирует частицу p по параметрам. ox/oy — начало координат (0 для
 * локального режима, позиция узла для глобального), rot — поворот узла.
 */
function resetParticle(p, params, rng, ox, oy, rot) {
    const dir = (params.direction + rng.range(-params.spread / 2, params.spread / 2)) * DEG + rot;
    const speed = rng.range(params.speed_min, params.speed_max);
    p.vx = Math.cos(dir) * speed;
    p.vy = Math.sin(dir) * speed;

    const [zx, zy] = zoneOffset(params.emit_zone, rng);
    p.x = ox + zx;
    p.y = oy + zy;

    p.age = 0;
    p.dead = false;
    p.life = Math.max(0.001, rng.range(params.life_min, params.life_max));
    p.size = rng.range(params.size_min, params.size_max);
    p.end_size = params.has_end_size ? rng.range(params.end_size_min, params.end_size_max) : p.size;
    p.angle = rng.range(params.angle_min, params.angle_max) * DEG + rot;
    p.av = rng.range(params.av_min, params.av_max) * DEG;
    return p;
}

/** Новая частица по параметрам. rng — makeRandom(seed). */
export function spawnParticle(params, rng) {
    return resetParticle({}, params, rng, 0, 0, 0);
}

/**
 * Шаг частицы за dt секунд. Меняет p и возвращает его же.
 * p.age/p.life — в секундах; при исчерпании жизни ставит p.dead.
 */
export function stepParticle(p, dt, params) {
    if (p.dead) return p;
    p.age += dt;
    if (p.age >= p.life) {
        p.age = p.life;
        p.dead = true;
        return p;
    }
    const g = params.gravity;
    p.vx += g.x * dt;
    p.vy += g.y * dt;

    // Поля сил из $.fx.attractor (притяжение и вихрь). Частицы — единственное,
    // что здесь двигается, поэтому и «чёрная дыра» тянет именно их: физика
    // тел живёт в Box2D и тянется силами через $.world.
    const fields = ctx.fx_fields;
    if (fields && fields.length) {
        for (let i = 0; i < fields.length; i++) {
            const f = fields[i];
            const dx = f.x - p.x;
            const dy = f.y - p.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > f.radius * f.radius || d2 < 1.0) continue;
            const d = Math.sqrt(d2);
            const falloff = 1 - d / f.radius;
            // Делим на расстояние: у центра не должно быть бесконечности.
            const k = f.strength * falloff * dt / Math.max(16, d);
            p.vx += dx * k;
            p.vy += dy * k;
            if (f.swirl) {
                p.vx += -dy * f.swirl * k;
                p.vy += dx * f.swirl * k;
            }
        }
    }

    if (params.damping > 0) {
        const f = Math.exp(-params.damping * dt);
        p.vx *= f;
        p.vy *= f;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.angle += p.av * dt;
    return p;
}

// ---------------------------------------------------------------------------
// Состояние эмиттера
// ---------------------------------------------------------------------------

const states = new WeakMap();

function sumBurst(params) {
    let total = 0;
    for (const n of params.burst) total += n;
    return total;
}

function createState(node, params) {
    return {
        params,
        rng: makeRandom(params.seed || (node.uid >>> 0) || 1),
        parts: [],            // живые частицы, плотно [0, n)
        free: [],             // пул переиспользуемых объектов — без аллокаций в кадре
        emit_acc: 0,          // накопитель непрерывной эмиссии
        emitting: params.emitting,
        pending_burst: 0,
        local: params.local,
        sprite: -1,
        has_texture: false,
        base_color: 0,
        overrides: {},
    };
}

/** Опции узла + частичные обновления .params() → сырой spec. */
function specOf(node, st) {
    const spec = Object.assign({}, node.attrs, st ? st.overrides : null);
    if (spec.color === undefined) spec.color = node.color;
    spec.alpha = node.alpha;
    return spec;
}

function ensureState(node) {
    let st = states.get(node);
    if (st) return st;

    const params = buildParams(specOf(node, null));
    params.seed = params.seed || (node.uid >>> 0);
    st = createState(node, params);
    st.pending_burst = (params.one_shot ? params.amount : 0) + sumBurst(params);
    st.base_color = node.color;
    if (params.texture !== undefined && params.texture !== null && params.texture !== false) {
        st.has_texture = true;
        st.sprite = resolveSprite(params.texture);
    }
    states.set(node, st);
    return st;
}

function rebuild(node, st) {
    const params = buildParams(specOf(node, st));
    params.seed = params.seed || (node.uid >>> 0);
    st.params = params;
    st.local = params.local;
    st.base_color = node.color;
    if (params.texture !== undefined && params.texture !== null && params.texture !== false) {
        st.has_texture = true;
        st.sprite = resolveSprite(params.texture);
    }
    return st;
}

function clearEmitter(st) {
    for (const p of st.parts) st.free.push(p);
    st.parts.length = 0;
}

function spawnInto(st, node) {
    const params = st.params;
    if (st.parts.length >= params.max_particles) return null;
    const p = st.free.pop() || {};
    let ox = 0, oy = 0, rot = 0;
    if (!st.local) {
        ox = node.x;
        oy = node.y;
        rot = node.angle;
    }
    resetParticle(p, params, st.rng, ox, oy, rot);
    st.parts.push(p);
    return p;
}

function emitBurst(st, node, count) {
    const room = st.params.max_particles - st.parts.length;
    const n = Math.min(Math.floor(count), Math.max(0, room));
    for (let i = 0; i < n; i++) spawnInto(st, node);
    return n;
}

/**
 * Узел-суб-эмиттер для этого эмиттера: создаётся один раз и живёт ребёнком
 * родителя (тогда remove() уносит и его). Сам он не эмитит — только бьёт
 * залпом из точки смерти частицы.
 */
function subNodeFor(st, node) {
    if (st.sub_node) return st.sub_node;
    if (!st.params.sub) return null;

    const spec = Object.assign({}, st.params.sub);
    spec.one_shot = true;
    spec.amount = 0;
    spec.rate = 0;
    delete spec.sub;
    delete spec.on_death;
    delete spec.onDeath;

    const sub = new Node('particles', spec);
    // Node, а не обёртка: цепные методы (appendTo/at) живут в api.js, поэтому
    // привязываем вручную — так remove() родителя уносит и суб-эмиттер.
    sub.parent_node = node;
    node.child_nodes.push(sub);
    st.sub_node = sub;
    return sub;
}

/** Частица умерла — из её точки бьёт залп суб-эффекта. */
function emitSub(st, node, p) {
    const spec = st.params.sub;
    if (!spec) return;
    const amount = Math.max(1, Math.floor(num(spec.amount, 2)));

    let wx = p.x;
    let wy = p.y;
    if (st.local) {
        const cos = Math.cos(node.angle);
        const sin = Math.sin(node.angle);
        wx = node.x + p.x * cos - p.y * sin;
        wy = node.y + p.x * sin + p.y * cos;
    }

    const sub = subNodeFor(st, node);
    if (!sub) return;
    sub.moveToX(wx);
    sub.moveToY(wy);
    emitBurst(states.get(sub) || ensureState(sub), sub, amount);
}

function tickEmitter(node, dt) {
    const st = ensureState(node);

    // .color() меняет только поле узла — подхватываем, если цвет не задан
    // сырым атрибутом (тогда его читает specOf).
    if (node.attrs.color === undefined && node.color !== st.base_color) rebuild(node, st);

    if (st.pending_burst > 0) {
        emitBurst(st, node, st.pending_burst);
        st.pending_burst = 0;
        if (st.params.one_shot) st.emitting = false;
    }

    const params = st.params;
    if (st.emitting && !params.one_shot) {
        const limit = Math.min(params.amount, params.max_particles);
        if (st.parts.length >= limit) {
            st.emit_acc = 0;
        } else {
            st.emit_acc += params.rate * dt;
            if (st.emit_acc > 64) st.emit_acc = 64;   // защита от «долга» эмиссии
            while (st.emit_acc >= 1 && st.parts.length < limit) {
                st.emit_acc -= 1;
                spawnInto(st, node);
            }
        }
    }

    const parts = st.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
        stepParticle(parts[i], dt, params);
        if (parts[i].dead) {
            const dead = parts[i];
            // Суб-эмиттер бьёт из точки смерти, пока частица ещё цела в памяти.
            emitSub(st, node, dead);
            const last = parts.pop();
            if (i < parts.length) parts[i] = last;
            st.free.push(dead);
        }
    }
}

/** Кадровый шаг всех эмиттеров. Вызывается из игрового цикла (api.js). */
export function tickParticles(dt) {
    if (!(dt > 0)) return;
    // Нет эмиттеров — шагу нечего делать, и прохода по реестру тоже нет:
    // срез по тегу держит индекс реестра (§5, P2 отчёта).
    const nodes = nodesByTag('particles');
    for (let i = 0; i < nodes.length; i++) tickEmitter(nodes[i], dt);
}

// ---------------------------------------------------------------------------
// Отрисовка
// ---------------------------------------------------------------------------

function renderParticles(node, t, cam) {
    const st = states.get(node);
    if (!st || st.parts.length === 0) return;

    const params = st.params;
    const zoom = cam.zoom || 1;
    const cw = cam.w, ch = cam.h;
    const cx = cam.x, cy = cam.y;
    const shx = cam.shake_x || 0;
    const shy = cam.shake_y || 0;
    const sprite = st.sprite >= 0 ? st.sprite : engine.whiteSprite;
    const alpha_base = node.alpha;
    const local = st.local;
    const cos = local ? Math.cos(node.angle) : 1;
    const sin = local ? Math.sin(node.angle) : 0;

    let drawn = 0;
    for (let i = 0; i < st.parts.length && drawn < MAX_DRAW_PER_EMITTER; i++) {
        const p = st.parts[i];
        let wx, wy;
        if (local) {
            // Смещение частицы поворачивается вместе с узлом.
            wx = node.x + p.x * cos - p.y * sin;
            wy = node.y + p.x * sin + p.y * cos;
        } else {
            wx = p.x;
            wy = p.y;
        }
        const sx = (wx - cx) * zoom + cw / 2 + shx;
        const sy = (wy - cy) * zoom + ch / 2 + shy;
        if (sx < -64 || sx > cw + 64 || sy < -64 || sy > ch + 64) continue;

        const ratio = p.life > 0 ? p.age / p.life : 1;
        const world_size = params.ramp_size
            ? rampAt(params.ramp_size, ratio)
            : p.size + (p.end_size - p.size) * ratio;
        let color = rampAt(params.ramp_color, ratio);
        color = withAlpha(color, rampAt(params.ramp_alpha, ratio) * alpha_base);
        const angle = local ? p.angle + node.angle : p.angle;
        ctx.gfx.push.sprite(sprite, sx, sy, world_size * zoom, world_size * zoom, angle, color);
        drawn++;
    }
}

// ---------------------------------------------------------------------------
// Пресеты
// ---------------------------------------------------------------------------

const PRESETS = {
    explosion: {
        one_shot: true, amount: 48, lifetime: [250, 620], speed: [120, 340],
        spread: 360, damping: 3.2, size: [6, 16], end_size: 0,
        color_ramp: [
            { t: 0, color: '#fff3b0' }, { t: 0.35, color: '#ff9a2e' },
            { t: 1, color: '#7a1f00' },
        ],
        alpha_ramp: [{ t: 0, value: 1 }, { t: 1, value: 0 }],
    },
    smoke: {
        amount: 24, lifetime: [900, 1800], speed: [10, 40], direction: -90,
        spread: 30, gravity: { x: 0, y: -18 }, damping: 0.6,
        size: [10, 24], end_size: 44,
        color_ramp: [{ t: 0, color: '#9a9a9a' }, { t: 1, color: '#2b2b2b' }],
        alpha_ramp: [{ t: 0, value: 0.55 }, { t: 1, value: 0 }],
    },
    sparks: {
        amount: 30, lifetime: [200, 500], speed: [150, 420], direction: -90,
        spread: 50, gravity: 420, size: [2, 4],
        color_ramp: [{ t: 0, color: '#fff2a8' }, { t: 1, color: '#ff5a12' }],
        alpha_ramp: [{ t: 0, value: 1 }, { t: 1, value: 0 }],
    },
    fire: {
        amount: 32, lifetime: [400, 900], speed: [20, 70], direction: -90,
        spread: 26, gravity: { x: 0, y: -45 }, size: [12, 22], end_size: 2,
        color_ramp: [
            { t: 0, color: '#fff6c2' }, { t: 0.4, color: '#ff9b1e' },
            { t: 1, color: '#c81900' },
        ],
        alpha_ramp: [{ t: 0, value: 0.95 }, { t: 1, value: 0 }],
    },
    rain: {
        amount: 120, lifetime: [700, 1200], speed: [200, 320], direction: 90,
        spread: 6, gravity: 180, size: [2, 5], end_size: [1, 2],
        emit_zone: { shape: 'rect', w: 900, h: 0 },
        color_ramp: [{ t: 0, color: '#bfe0ff' }, { t: 1, color: '#7fa8d8' }],
        alpha_ramp: [{ t: 0, value: 0.7 }, { t: 1, value: 0.25 }],
    },
    dust: {
        amount: 40, lifetime: [600, 1400], speed: [5, 26], spread: 360,
        damping: 1.6, gravity: { x: 0, y: 10 }, size: [3, 8],
        color_ramp: [{ t: 0, color: '#d8c99a' }, { t: 1, color: '#8a7b56' }],
        alpha_ramp: [{ t: 0, value: 0.8 }, { t: 1, value: 0 }],
    },
};

function cloneSpec(spec) {
    const out = {};
    for (const key of Object.keys(spec)) {
        const v = spec[key];
        if (Array.isArray(v)) {
            out[key] = v.map((item) => (item && typeof item === 'object' ? Object.assign({}, item) : item));
        } else if (v && typeof v === 'object') {
            out[key] = Object.assign({}, v);
        } else {
            out[key] = v;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Обход ограничений ядра
//
// Node.set() раскладывает известные имена (size, speed, gravity, color) по
// полям узла и приводит значение к числу. Для <particles> те же имена — это
// параметры эмиттера, в том числе диапазоны [min, max]; Number([4, 8]) даёт
// NaN, то есть диапазон терялся бы прямо в конструкторе. Перехватываем сырые
// значения только для одного тега и только для этих имён, а в остальном
// вызываем штатный метод. Патч один на процесс, файлы ядра не правятся.
// ---------------------------------------------------------------------------

function patchNodeSet() {
    const proto = Node.prototype;
    // Метка на прототипе, а не только в модуле: при горячей перезагрузке
    // модуль вычисляется заново, и без метки патч наслаивался бы. Свойство
    // невидимое, чтобы не мешать перебору полей узла.
    if (proto.__particles_set_patched) return;
    Object.defineProperty(proto, '__particles_set_patched', {
        value: true, enumerable: false, configurable: true, writable: false,
    });
    const original = proto.set;
    const RAW_KEYS = new Set(['speed', 'size', 'gravity', 'color']);
    proto.set = function (key, value) {
        if (this.tag === 'particles' && RAW_KEYS.has(key)) {
            this.attrs[key] = value;
            if (key === 'color') this.color = packColor(value);
            return this;
        }
        return original.call(this, key, value);
    };
}

// ---------------------------------------------------------------------------
// Публичное API
// ---------------------------------------------------------------------------

function firstNode(wrapper) {
    return wrapper.nodes.length ? wrapper.nodes[0] : null;
}

/** Пройти по узлам обёртки, не завязываясь на .each() из api.js. */
function eachNode(wrapper, fn) {
    const list = wrapper.nodes;
    for (let i = 0; i < list.length; i++) fn(list[i]);
    return wrapper;
}

export function installParticles($) {
    patchNodeSet();

    // Дополняем объявленный в ядре тег, не затирая body/w/h/src.
    Object.assign(TAGS.particles, {
        color: '#ffffff', amount: 32, lifetime: 1000, speed: 100,
        emitting: true, local: true,
    });

    registerNodeRenderer('particles', renderParticles);

    // --- Пространство имён -------------------------------------------------
    $.particles = {
        /** Создать эмиттер: те же опции, что у $('<particles>', opts). */
        create(opts) { return wrapOne(new Node('particles', opts)); },

        /** Готовый набор параметров пресета; spec перекрывает поля пресета. */
        preset(name, spec) {
            const base = PRESETS[name];
            if (!base) {
                ctx.log(`$: неизвестный пресет частиц "${name}" — доступны: ${Object.keys(PRESETS).join(', ')}`);
                return spec ? cloneSpec(spec) : {};
            }
            const merged = Object.assign(cloneSpec(base), spec ? cloneSpec(spec) : null);
            return merged;
        },

        /** Список имён встроенных пресетов. */
        presets() { return Object.keys(PRESETS); },
    };

    // --- Методы узла --------------------------------------------------------
    // Обходим this.nodes напрямую, а не через .each(): это метод api.js, а
    // модуль должен работать и в qjs-харнессе, где метода ещё нет.
    def('start', function () {
        return eachNode(this, (n) => {
            if (n.tag === 'particles') ensureState(n).emitting = true;
        });
    });

    def('stop', function () {
        return eachNode(this, (n) => {
            if (n.tag !== 'particles') return;
            const st = ensureState(n);
            st.emitting = false;
            st.pending_burst = 0;   // отменяем ещё не выданный стартовый залп
        });
    });

    def('emitting', function (flag) {
        if (flag === undefined) {
            const n = firstNode(this);
            if (!n || n.tag !== 'particles') return false;
            const st = states.get(n);
            return st ? st.emitting : n.attrs.emitting !== false;
        }
        return eachNode(this, (n) => {
            if (n.tag !== 'particles') return;
            const st = ensureState(n);
            st.emitting = !!flag;
            if (!st.emitting) st.pending_burst = 0;
        });
    });

    def('isEmitting', function () {
        const n = firstNode(this);
        if (!n || n.tag !== 'particles') return false;
        const st = states.get(n);
        return st ? st.emitting : n.attrs.emitting !== false;
    });

    def('restart', function () {
        return eachNode(this, (n) => {
            if (n.tag !== 'particles') return;
            const st = ensureState(n);
            clearEmitter(st);
            st.rng = makeRandom(st.params.seed || (n.uid >>> 0) || 1);
            st.emit_acc = 0;
            st.emitting = true;
            st.pending_burst = (st.params.one_shot ? st.params.amount : 0) + sumBurst(st.params);
        });
    });

    def('burst', function (count) {
        const wanted = Math.max(0, Math.floor(num(count, 0)));
        return eachNode(this, (n) => {
            if (n.tag === 'particles') emitBurst(ensureState(n), n, wanted);
        });
    });

    def('clear', function () {
        return eachNode(this, (n) => {
            if (n.tag === 'particles') clearEmitter(ensureState(n));
        });
    });

    def('reset', function () {
        return eachNode(this, (n) => {
            if (n.tag !== 'particles') return;
            const st = ensureState(n);
            clearEmitter(st);
            st.rng = makeRandom(st.params.seed || (n.uid >>> 0) || 1);
            st.emit_acc = 0;
            st.pending_burst = (st.params.one_shot ? st.params.amount : 0) + sumBurst(st.params);
        });
    });

    def('count', function () {
        let total = 0;
        eachNode(this, (n) => {
            if (n.tag !== 'particles') return;
            const st = states.get(n);
            if (st) total += st.parts.length;
        });
        return total;
    });

    def('particleAt', function (index) {
        const n = firstNode(this);
        if (!n || n.tag !== 'particles') return null;
        const st = states.get(n);
        if (!st) return null;
        const i = Math.floor(num(index, -1));
        return i >= 0 && i < st.parts.length ? st.parts[i] : null;
    });

    /** Частичное обновление параметров эмиттера; живые частицы не трогает. */
    def('params', function (spec) {
        if (spec === undefined) {
            const n = firstNode(this);
            if (!n || n.tag !== 'particles') return null;
            return { ...ensureState(n).params };
        }
        return eachNode(this, (n) => {
            if (n.tag !== 'particles') return;
            const st = ensureState(n);
            Object.assign(st.overrides, spec);
            rebuild(n, st);
            // Явно переданный emitting уважаем; иначе .params() после .stop()
            // не должен самовольно возобновлять эмиссию.
            if (spec.emitting !== undefined) st.emitting = spec.emitting !== false;
            if (spec.seed !== undefined) st.rng = makeRandom(st.params.seed || (n.uid >>> 0) || 1);
        });
    });

    return $;
}
