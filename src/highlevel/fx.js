// ===========================================================================
// VFX своими руками: $.fx — ленты, молнии, ударные волны, поля сил, juice.
//
// Никаких сторонних библиотек: всё рисуется тем же батчем, что и спрайты
// (`$.gfx.push.triangle/line/ring/circle`), поэтому лишних draw call'ов не
// появляется, а эффекты попадают в тот же кадр, что и сцена.
//
// Как это работает по кадру:
//   * tickFx(dt) — двигает времена жизни, тянет точки лент за целями;
//   * drawFx()   — вызывается из render.js в момент сборки батча (хук
//     ctx.gfx._fxFlush): раньше нельзя, позже — батч уже отправлен.
//
// Случайность берётся из fxRandom() (core.js): при --seed и фиксированном шаге
// картинка воспроизводима, в отличие от Math.random().
// ===========================================================================

import { engine } from './native.js';
import { ctx, query, packColor, withAlpha, fxRandom } from './core.js';
import { installHits, tickHits } from './hits.js';

const state = {
    trails: [],
    bolts: [],
    waves: [],
    fields: [],
    pulses: [],     // вспышки в точке: круг с затуханием
    flashes: [],    // вспышки экрана: прямоугольник на весь вид
};

// Поля сил видны частицам: particles.js читает этот же массив.
ctx.fx_fields = state.fields;

// `$` нужен хит-стопу (через $.time) и частицам hits.js; drawFx зовётся из
// рендера, где `$` не передают, поэтому ссылку держим здесь.
let api = null;
let hits_installed = false;

// Базовый визуальный объект (без r2dvfx) и хуки подсистемы `$.vfx`.
// Обратных импортов нет: vfx.js импортирует fx.js, а не наоборот, — иначе
// получился бы цикл модулей. Хуки ставятся из installVfx.
let base_api = null;
let extra_tick = null;
let extra_reset = null;

//: Подписаться на кадр VFX-слоя (вызывается из tickFx, до частиц).
export function onFxTick(fn) { extra_tick = typeof fn === 'function' ? fn : null; }
//: Подписаться на сброс (смена сцены): resetFx чистит и состояние r2dvfx.
export function onFxReset(fn) { extra_reset = typeof fn === 'function' ? fn : null; }


function clamp01(v) {
    return v < 0 ? 0 : (v > 1 ? 1 : v);
}

function pointOf(what) {
    if (!what) return null;
    if (typeof what === 'string') {
        const n = query(what)[0];
        return n ? { x: n.x, y: n.y } : null;
    }
    if (what.nodes) {
        const n = what.nodes[0];
        return n ? { x: n.x, y: n.y } : null;
    }
    if (what.tag) return { x: what.x, y: what.y };
    if (Array.isArray(what)) return { x: what[0], y: what[1] };
    if (typeof what.x === 'number') return { x: what.x, y: what.y };
    if (typeof what === 'function') return pointOf(what());
    return null;
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

export function installVisualBase($) {
    if (base_api) {
        api = $;
        return base_api;
    }
    const fx = {
        /**
         * Лента за целью: `$.vfx.trail('#hero', { ms: 350, width: 10 })`.
         * Цель — селектор, узел, обёртка или функция, возвращающая точку.
         */
        trail(target, opts) {
            const o = trailOpts(opts);
            const t = { target, o, points: [], dead: false };
            const p = pointOf(target);
            if (p) t.points.push({ x: p.x, y: p.y, t: 0 });
            state.trails.push(t);
            return {
                stop() { t.dead = true; return this; },
                options(next) { Object.assign(t.o, trailOpts(next)); return this; },
                points() { return t.points.length; },
            };
        },

        /** Разовая лента по готовым точкам: трассер, след клинка, дуга. */
        ribbon(points, opts) {
            const o = trailOpts(Object.assign({ ms: 220, once: true }, opts));
            const pts = [].concat(points || []).map((p) => {
                const q = pointOf(p);
                return q ? { x: q.x, y: q.y, t: 0 } : null;
            }).filter(Boolean);
            if (pts.length < 2) return null;
            const t = { target: null, o, points: pts, dead: false, once: true };
            state.trails.push(t);
            return { stop() { t.dead = true; return this; } };
        },

        /**
         * Полоса из готовых точек прямо в батч кадра (низкий уровень лент):
         * `$.vfx.pushRibbon([[0, 0], [40, 20]], { width: 6, color: '#8fd8ff' })`.
         *
         * Раньше это была внутренняя функция рисования; наружу она вынесена
         * потому, что играм нужен «след клинка» без жизненного цикла ленты
         * (его считает сама игра). Возвращает `$.vfx` для цепочки.
         */
        pushRibbon(points, opts) {
            const o = Object.assign({ width: 8, color: '#8fd8ff', blend: 'add', alpha: 1 },
                                    opts);
            const pts = [].concat(points || []).map((p) => pointOf(p)).filter(Boolean);
            pushRibbon(pts, o, 1);
            return fx;
        },

        /** Молния между точками: сегменты с дрожанием, опционально ветви. */
        lightning(from, to, opts) {
            const o = Object.assign({
                life: 110, segments: 9, jitter: 16, width: 3,
                color: '#cfe9ff', blend: 'add', branches: 2, glow: true,
            }, opts);
            const a = pointOf(from);
            const b = pointOf(to);
            if (!a || !b) return null;
            const bolt = {
                pts: jagged(a, b, o.segments, o.jitter),
                branches: [],
                t: 0, o,
            };
            for (let i = 0; i < o.branches; i++) {
                const at = bolt.pts[2 + Math.floor(fxRandom() * Math.max(1, bolt.pts.length - 4))];
                if (!at) continue;
                const len = 40 + fxRandom() * 90;
                const ang = Math.atan2(b.y - a.y, b.x - a.x) + (fxRandom() < 0.5 ? 1 : -1) * (0.6 + fxRandom() * 0.8);
                bolt.branches.push(jagged(at, { x: at.x + Math.cos(ang) * len, y: at.y + Math.sin(ang) * len },
                                          Math.max(3, o.segments - 4), o.jitter * 0.7));
            }
            state.bolts.push(bolt);
            return { stop() { bolt.t = bolt.o.life; return this; } };
        },

        /** Ударная волна: расширяющееся кольцо. */
        shockwave(x, y, opts) {
            const o = Object.assign({
                radius: 140, ms: 320, width: 6, color: '#ffffff',
                blend: 'add', ease: 'out',
            }, opts);
            const p = pointOf({ x, y });
            const w = { x: p.x, y: p.y, t: 0, o };
            state.waves.push(w);
            return { stop() { w.t = w.o.ms; return this; } };
        },

        /**
         * Вспышка в точке: круг, гаснущий за ms. Для удара по узлу обычно
         * нужен `.flash()` (подмена тона) — это разные эффекты.
         */
        pulse(x, y, opts) {
            const o = Object.assign({ radius: 60, ms: 140, color: '#ffffff', blend: 'add' }, opts);
            const p = pointOf({ x, y });
            const u = { x: p.x, y: p.y, t: 0, o };
            state.pulses.push(u);
            return { stop() { u.t = u.o.ms; return this; } };
        },

        /**
         * Вспышка ЭКРАНА: `$.vfx.flash('#ffffff', { ms: 90, alpha: 0.7 })`.
         *
         * Принимает `(color)`, `(color, ms)` и `(color, opts)` — короткая форма
         * с числом нужна катсценам (`cutscene.js` пока зовёт `$.fx.flash(color, ms)`).
         *
         * Заливка идёт поверх сцены в момент сборки кадра, камеру не сдвигает и
         * на паузе времени живёт: `$.time.freeze()` её не гасит — вспышка на
         * удар обязана быть видна, пока мир замер.
         *
         * Возвращает ручку `{ stop() }`. Одновременных вспышек не больше
         * четырёх: пятая вытесняет самую старую, иначе экран уходит в белый.
         */
        flash(color, opts) {
            const o = typeof opts === 'number' ? { ms: opts } : Object.assign({}, opts);
            const spec = Object.assign({
                ms: 160, alpha: 0.75, color: color === undefined ? '#ffffff' : color,
                blend: 'add', ease: 'out',
            }, o);
            const f = { t: 0, o: spec };
            state.flashes.push(f);
            if (state.flashes.length > 4) state.flashes.shift();
            return { stop() { f.t = f.o.ms; return this; } };
        },

        /** Сколько миллисекунд осталось самой длинной вспышке экрана. */
        flashLeft() {
            let left = 0;
            for (const f of state.flashes) left = Math.max(left, f.o.ms - f.t);
            return left;
        },

        /**
         * Поле сил: притяжение и вихрь. Действует на частицы `$.particles`,
         * пока живёт. Подходит и для гранат, и для схлопывания чёрной дыры.
         */
        attractor(x, y, opts) {
            const o = Object.assign({
                radius: 320, strength: 900, swirl: 0.6, life: 1200,
                visual: true, color: '#101018', edge: '#5a3df0',
            }, opts);
            const p = pointOf({ x, y });
            const f = { x: p.x, y: p.y, radius: o.radius, strength: o.strength, swirl: o.swirl, t: 0, o };
            state.fields.push(f);
            return {
                move(nx, ny) { const q = pointOf({ x: nx, y: ny }); f.x = q.x; f.y = q.y; return this; },
                set(next) { Object.assign(f.o, next); f.radius = f.o.radius; f.strength = f.o.strength; return this; },
                stop() { f.t = f.o.life; return this; },
            };
        },

        /** Готовый «удар»: волна + тряска камеры + микро-стоп кадра. */
        impact(x, y, opts) {
            const o = Object.assign({ radius: 130, shake: 5, shakeMs: 160, hitStop: 0 }, opts);
            fx.shockwave(x, y, { radius: o.radius, ms: o.ms || 300, width: o.width || 6, color: o.color || '#ffffff' });
            if (o.shake && $.camera && $.camera.shake) $.camera.shake(o.shake, o.shakeMs);
            if (o.hitStop > 0) fx.hitStop(o.hitStop);
            return fx;
        },

        /**
         * Hit-stop: короткая остановка игрового мира на удар.
         *
         * `$.vfx.hitStop(ms)` — полная заморозка (`$.time.freeze`), `scale` —
         * замедление до этой доли скорости (`$.time.slow`). Длительность
         * считается по времени кадра, поэтому при `--fixed-dt` она
         * детерминирована, а при масштабе 0 не «залипает» навсегда.
         * Вложенные вызовы не складываются и не портят `$.time.scale()`.
         */
        hitStop(ms, scale) {
            const time = timeApi();
            const ms_value = ms === undefined ? 70 : Number(ms);
            if (!time) return fx;
            if (scale === undefined || scale <= 0) time.freeze(ms_value);
            else time.slow(ms_value, scale);
            return fx;
        },

        /** Сколько чего сейчас живо — для отладки и тестов. */
        stats() {
            return {
                trails: state.trails.length,
                bolts: state.bolts.length,
                waves: state.waves.length,
                fields: state.fields.length,
                pulses: state.pulses.length,
                flashes: state.flashes.length,
            };
        },

        /** Убрать всё (смена сцены, рестарт). */
        clear() {
            state.trails.length = 0;
            state.bolts.length = 0;
            state.waves.length = 0;
            state.fields.length = 0;
            state.pulses.length = 0;
            state.flashes.length = 0;
            return fx;
        },
    };

    api = $;
    base_api = fx;
    ctx.fx = fx;
    // Рисуем в момент сборки кадра: батч живёт только внутри _render().
    ctx.gfx._fxFlush = drawFx;
    return fx;
}

/**
 * Старое имя `$.fx` — работающий алиас на `$.vfx` на один минор.
 *
 * Каждый метод forward'ит в `$.vfx` и при ПЕРВОМ вызове конкретного сырого
 * имени (`$.fx.flash`, `$.fx.shockwave`, …) пишет одно дедуплицированное
 * предупреждение `R2D_FX_DEPRECATED` с заменой. Дедупликация — по сырому
 * имени, а не по тексту: сто вызовов `$.fx.flash` дают одну запись.
 *
 * `installVfx` ставится раньше (api.js), поэтому алиас всегда смотрит на
 * полное визуальное пространство; если vfx.js почему-то не подключён,
 * алиас продолжает работать поверх базового объекта (юнит-тесты fx.js).
 */
export function installFx($) {
    const base = installVisualBase($);
    const full = ($ && $.vfx) || ctx.vfx || base;
    const legacy = makeLegacyAlias(full, base);

    $.fx = legacy;
    // Внутренние подсистемы (hits.js, cutscene.js читают $.fx, но hits.js —
    // ctx.fx) должны звать новое имя без предупреждений.
    ctx.fx = full;

    // --- Хит-фидбек -------------------------------------------------------
    // hits.js ставится ЗДЕСЬ, а не в api.js: fx.js — уже подключённая
    // подсистема, и её установщик/тик — мои файлы. Так у интегратора не
    // появляется второй писатель api.js, а порядок «частицы → fx → удары»
    // держится сам. Установка идемпотентна: повторный installFx не ставит
    // подсистему второй раз.
    if (!hits_installed) {
        hits_installed = true;
        installHits($);
    }
    return legacy;
}

//: Старое имя → новое имя. Ровно таблица F1 docs/VFX_ROADMAP.md.
const LEGACY_METHODS = [
    'trail', 'ribbon', 'pushRibbon', 'lightning', 'shockwave', 'pulse',
    'flash', 'flashLeft', 'attractor', 'impact', 'hitStop', 'stats', 'clear',
];

/** Сырые имена, о которых уже предупредили (ключ — `$.fx.<имя>`). */
const legacy_warned = new Set();

function makeLegacyAlias(full, base) {
    const alias = {};
    for (const name of LEGACY_METHODS) {
        alias[name] = function () {
            const raw = '$.fx.' + name;
            const target = (full && typeof full[name] === 'function') ? full : base;
            if (!legacy_warned.has(raw)) {
                legacy_warned.add(raw);
                warnLegacy(raw, '$.vfx.' + name);
            }
            const value = target[name].apply(target, arguments);
            // Старый `impact`/`hitStop`/`clear` возвращали сам `$.fx` для
            // цепочки. Сохраняем это: возвращаем алиас, а не `$.vfx`.
            if (value === full || value === base) return alias;
            return value;
        };
    }
    // Поверхность алиаса — ровно старые методы: ни одного лишнего имени,
    // чтобы не появилось «второго API» рядом с $.vfx.
    return alias;
}

function warnLegacy(raw, target) {
    const message = `${raw} устарело: используйте ${target} — старое имя работает до следующего минора`;
    const $ = ctx.$;
    const debug = $ && $.debug;
    if (debug && typeof debug.reportError === 'function') {
        debug.reportError(raw, message, {
            code: 'R2D_FX_DEPRECATED', subsystem: 'fx', recoverable: true,
            data: { raw, target },
        });
    } else {
        ctx.log('$: ' + message);
    }
}

/** Время для hit-stop: сначала ядро времени, потом $.time (юнит-тесты). */
function timeApi() {
    if (ctx.time && typeof ctx.time.freeze === 'function') return ctx.time;
    if (api && api.time && typeof api.time.freeze === 'function') return api.time;
    return null;
}

function trailOpts(opts) {
    const o = Object.assign({
        ms: 320, width: 8, color: '#8fd8ff', blend: 'add',
        minStep: 3, alpha: 1, once: false,
    }, opts);
    return o;
}

// ---------------------------------------------------------------------------
// Геометрия
// ---------------------------------------------------------------------------

/** Ломаная с дрожанием: середина гуляет, концы закреплены. */
function jagged(a, b, segments, jitter) {
    const pts = [];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const n = Math.max(2, segments | 0);
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const off = (i === 0 || i === n) ? 0 : (fxRandom() * 2 - 1) * jitter;
        pts.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off });
    }
    return pts;
}

/** Полоса из ломаной: два треугольника на сегмент, ширина растёт к голове. */
function pushRibbon(points, o, alpha_scale) {
    const n = points.length;
    if (n < 2) return;
    for (let i = 1; i < n; i++) {
        const a = points[i - 1];
        const b = points[i];
        const t = i / (n - 1);
        const w = o.width * (0.25 + 0.75 * t);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len * w * 0.5;
        const ny = dx / len * w * 0.5;
        const color = withAlpha(packColor(o.color), clamp01(o.alpha * alpha_scale * t));
        if (!color) continue;
        ctx.gfx.push.triangle(a.x + nx, a.y + ny, a.x - nx, a.y - ny, b.x - nx, b.y - ny, color, o.blend);
        ctx.gfx.push.triangle(a.x + nx, a.y + ny, b.x - nx, b.y - ny, b.x + nx, b.y + ny, color, o.blend);
    }
}

// ---------------------------------------------------------------------------
// Кадр
// ---------------------------------------------------------------------------

export function tickFx(dt) {
    // Хит-фидбек тикает всегда — даже на нулевом dt (первый кадр) — поэтому
    // вызов стоит до раннего выхода по времени.
    tickHits(dt);
    // r2dvfx-эффекты ($.vfx) идут ИГРОВЫМ временем (пауза их останавливает),
    // поэтому берут dt сами; здесь только кадровый хук.
    if (extra_tick) extra_tick(dt);

    const ms = Number(dt) * 1000;
    if (!Number.isFinite(ms) || ms <= 0) return;

    // --- Ленты ---
    for (let i = state.trails.length - 1; i >= 0; i--) {
        const tr = state.trails[i];
        for (const p of tr.points) p.t += ms;
        while (tr.points.length && tr.points[0].t > tr.o.ms) tr.points.shift();

        if (tr.once) {
            // Разовая лента: точки стареют, новых нет.
            if (tr.points.length < 2) state.trails.splice(i, 1);
        } else {
            const p = tr.dead ? null : pointOf(tr.target);
            if (p) {
                const last = tr.points[tr.points.length - 1];
                if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= tr.o.minStep) {
                    tr.points.push({ x: p.x, y: p.y, t: 0 });
                    // Ограничитель: длинная лента на быстром объекте не должна
                    // копить тысячи точек и превращать кадр в кашу.
                    if (tr.points.length > 128) tr.points.shift();
                }
            } else if (tr.dead || tr.points.length === 0) {
                state.trails.splice(i, 1);
            }
        }
    }

    // --- Молнии ---
    for (let i = state.bolts.length - 1; i >= 0; i--) {
        const b = state.bolts[i];
        b.t += ms;
        if (b.t >= b.o.life) state.bolts.splice(i, 1);
    }

    // --- Волны ---
    for (let i = state.waves.length - 1; i >= 0; i--) {
        const w = state.waves[i];
        w.t += ms;
        if (w.t >= w.o.ms) state.waves.splice(i, 1);
    }

    // --- Вспышки в точке ---
    for (let i = state.pulses.length - 1; i >= 0; i--) {
        const u = state.pulses[i];
        u.t += ms;
        if (u.t >= u.o.ms) state.pulses.splice(i, 1);
    }

    // --- Вспышки экрана ---
    // Живут по времени кадра, а не по игровому: удар должен подсветить кадр
    // даже тогда, когда игровое время заморожено ($.time.freeze).
    for (let i = state.flashes.length - 1; i >= 0; i--) {
        const f = state.flashes[i];
        f.t += ms;
        if (f.t >= f.o.ms) state.flashes.splice(i, 1);
    }

    // --- Поля сил ---
    for (let i = state.fields.length - 1; i >= 0; i--) {
        const f = state.fields[i];
        f.t += ms;
        if (f.t >= f.o.life) state.fields.splice(i, 1);
    }
}

function drawFx(cam) {
    if (!ctx.gfx || !ctx.gfx.push) return;

    // Отсечение по камере: эффект за экраном не должен занимать батч.
    const view = cam ? { x: cam.x, y: cam.y, r: viewRadius(cam) } : null;
    const visible = (x, y, pad) => {
        if (!view) return true;
        return Math.hypot(x - view.x, y - view.y) <= view.r + (pad || 0);
    };

    for (const tr of state.trails) {
        if (tr.points.length < 2) continue;
        if (!visible(tr.points[0].x, tr.points[0].y, 400)) continue;
        const alpha_scale = tr.once ? 1 : 1;
        pushRibbon(tr.points, tr.o, alpha_scale);
    }

    for (const b of state.bolts) {
        const k = 1 - b.t / b.o.life;
        if (k <= 0) continue;
        if (!visible(b.pts[0].x, b.pts[0].y, 300)) continue;
        const color = withAlpha(packColor(b.o.color), k);
        if (b.o.glow) {
            const glow = withAlpha(packColor(b.o.color), k * 0.25);
            for (let i = 1; i < b.pts.length; i++) {
                ctx.gfx.push.line(b.pts[i - 1].x, b.pts[i - 1].y, b.pts[i].x, b.pts[i].y,
                                  b.o.width * 3, glow);
            }
        }
        for (let i = 1; i < b.pts.length; i++) {
            ctx.gfx.push.line(b.pts[i - 1].x, b.pts[i - 1].y, b.pts[i].x, b.pts[i].y,
                              b.o.width, color);
        }
        for (const br of b.branches) {
            const dim = withAlpha(packColor(b.o.color), k * 0.7);
            for (let i = 1; i < br.length; i++) {
                ctx.gfx.push.line(br[i - 1].x, br[i - 1].y, br[i].x, br[i].y, b.o.width * 0.6, dim);
            }
        }
    }

    for (const w of state.waves) {
        const t = clamp01(w.t / w.o.ms);
        const ease = w.o.ease === 'linear' ? t : 1 - (1 - t) * (1 - t);
        const r = w.o.radius * ease;
        if (r < 1 || !visible(w.x, w.y, w.o.radius + 100)) continue;
        const k = 1 - t;
        const width = Math.max(1, w.o.width * k);
        ctx.gfx.push.ring(w.x, w.y, r, width, withAlpha(packColor(w.o.color), k * 0.9), 28);
    }

    for (const u of state.pulses) {
        const t = clamp01(u.t / u.o.ms);
        const k = 1 - t;
        if (!visible(u.x, u.y, u.o.radius + 100)) continue;
        ctx.gfx.push.circle(u.x, u.y, u.o.radius * (0.4 + 0.6 * t), withAlpha(packColor(u.o.color), k * 0.7), 20);
    }

    for (const f of state.fields) {
        if (!f.o.visual) continue;
        const t = clamp01(f.t / f.o.life);
        if (!visible(f.x, f.y, f.radius + 100)) continue;
        const k = 1 - t * 0.6;
        // Тёмная сердцевина и фиолетовый обод: у схемы «чёрной дыры» это
        // читается как воронка, даже без шейдеров.
        ctx.gfx.push.circle(f.x, f.y, f.radius * 0.16, withAlpha(packColor(f.o.color), 0.85), 24);
        ctx.gfx.push.ring(f.x, f.y, f.radius * (0.3 + 0.5 * t), 2 + 2 * k,
                          withAlpha(packColor(f.o.edge), k * 0.5), 28);
    }
    // Вспышки экрана — последними: они заливают кадр поверх остальных VFX.
    // Квадрат со стороной в диагональ вида покрывает экран при любом зуме и
    // повороте камеры; угол компенсирует поворот, чтобы заливка не «косилась».
    if (cam && state.flashes.length) {
        const zoom = Math.max(0.05, cam.zoom || 1);
        const w = (cam.w || engine.width) / zoom;
        const h = (cam.h || engine.height) / zoom;
        const side = Math.hypot(w, h) * 1.05;
        const angle = -(cam.rotation || 0);
        for (const f of state.flashes) {
            const t = clamp01(f.t / f.o.ms);
            const k = f.o.ease === 'linear' ? 1 - t : (1 - t) * (1 - t);
            const color = withAlpha(packColor(f.o.color), clamp01(f.o.alpha * k));
            if (!color) continue;
            ctx.gfx.push.sprite(engine.whiteSprite, cam.x, cam.y, side, side, angle, color, f.o.blend);
        }
    }
}

function viewRadius(cam) {
    const w = engine.width / Math.max(0.2, cam.zoom || 1);
    const h = engine.height / Math.max(0.2, cam.zoom || 1);
    return Math.hypot(w, h) * 0.5;
}

/** Сброс при смене сцены: эффекты принадлежат сцене.
 *
 * Чистит и базовое визуальное состояние, и r2dvfx-эффекты (хук `onFxReset`,
 * который ставит installVfx): scene.js импортирует только `resetFx`, поэтому
 * второй точки сброса ему знать не нужно.
 */
export function resetFx() {
    state.trails.length = 0;
    state.bolts.length = 0;
    state.waves.length = 0;
    state.fields.length = 0;
    state.pulses.length = 0;
    state.flashes.length = 0;
    if (extra_reset) extra_reset();
}

export const fxState = state;
