// ===========================================================================
// r2dvfx: $.vfx — своя VFX-библиотека (то, что ВИДНО).
//
// Разделение пространств (task-69, §F docs/VFX_ROADMAP.md):
//   * что слышно → `$.sfx` (sfx.js);
//   * что видно  → `$.vfx` (этот модуль, r2dvfx).
//
// Эффект — ДЕКЛАРАТИВНАЯ спека слоями во времени, а не один вызов:
//
//   $.vfx.define('hit.spark', {
//       duration: 0.35, seed: 'hit', budget: { particles: 120, light: 1 },
//       layers: [
//           { at: 0.00, use: 'particles.burst', params: { count: 24, speed: [80, 220] } },
//           { at: 0.00, use: 'fx.flash',        params: { color: '#fff3c4', ms: 90 } },
//           { at: 0.00, use: 'fx.hitStop',      params: { ms: 40 } },
//       ],
//   });
//   const h = $.vfx.play('hit.spark', { at: [x, y] });
//   h.stop(); h.seek(0.2); h.setRate(0.5); h.query();
//
// `use:` — только существующие примитивы движка (список — primitives()):
// particles.preset, particles.burst, fx.flash, fx.shake, fx.hitStop,
// fx.shockwave, fx.lightning, fx.pulse, fx.ribbon, fx.trail, fx.attractor,
// light.emitter, sound.playBank, shader.<имя>, layers.fadeTo, clip.<имя>.
//
// Правила:
//   * спека — ЧИСТЫЕ данные (функций внутри нет: R2D_VFX_NOT_DATA);
//   * неизвестный `use` — громкая ошибка R2D_VFX_UNKNOWN_PRIMITIVE со списком;
//   * время эффекта идёт ИГРОВЫМ dt ($.time.delta): пауза и hit-stop его
//     останавливают, как и мир;
//   * детерминизм по seed: свой rng на эффект, hash/число выборок в query();
//   * бюджет частиц/света общий: при упоре эффект деградирует (degraded), а не
//     исчезает молча.
//
// Никаких новых нативных загрузчиков: load()/loadAll() читают JSON через
// `$.fs` (модуль store.js), как и остальные данные движка.
// ===========================================================================

import { ctx, query, makeRandom } from './core.js';
import { installVisualBase, onFxTick, onFxReset } from './fx.js';

// ---------------------------------------------------------------------------
// Примитивы
// ---------------------------------------------------------------------------

/** Базовые (фиксированные) имена `use:`. */
const BASE_PRIMITIVES = [
    'particles.preset', 'particles.burst',
    'fx.flash', 'fx.shake', 'fx.hitStop', 'fx.shockwave', 'fx.lightning',
    'fx.pulse', 'fx.ribbon', 'fx.trail', 'fx.attractor',
    'light.emitter', 'sound.playBank', 'layers.fadeTo',
];

/** Семейства с именем в хвосте: `shader.<имя>`, `clip.<имя>`. */
const NAMED_PRIMITIVES = ['shader.', 'clip.'];

/** Потолки бюджета по умолчанию: частицы считаются резервом на эффект. */
const DEFAULT_BUDGET = { particles: 512, light: 16 };

/** Полный список для primitives() и текста ошибки. */
export function vfxPrimitives() {
    return BASE_PRIMITIVES.concat(['shader.<имя>', 'clip.<имя>']);
}

let api = null;
//: Публичный объект `$.vfx` (ставится installVfx): слой применяет примитивы
//: через него, а не через замыкание — playInternal живёт на уровне модуля.
let full_api = null;
function root() { return api || ctx.$ || null; }

// ---------------------------------------------------------------------------
// Ошибки: код + путь + список допустимого (никакой тишины)
// ---------------------------------------------------------------------------

function makeError(code, message, path, extra) {
    const err = new Error(message);
    err.code = code;
    err.path = path || '';
    if (extra) {
        if (extra.allowed !== undefined) err.allowed = extra.allowed;
        if (extra.data !== undefined) err.data = extra.data;
    }
    return err;
}

function reportDiag(err) {
    const $ = root();
    const debug = $ && $.debug;
    if (debug && typeof debug.reportError === 'function') {
        debug.reportError('$.vfx', err.message, {
            code: err.code || 'R2D_VFX_ERROR',
            subsystem: 'vfx',
            recoverable: err.fatal !== true,
            jsonPath: err.path || null,
            data: { allowed: err.allowed === undefined ? null : err.allowed },
        });
    } else if (ctx.log) {
        ctx.log('$: ' + err.message);
    }
}

function fail(code, message, path, extra) {
    const err = makeError(code, message, path, extra);
    reportDiag(err);
    throw err;
}

function warnOnce(key, message, code, path) {
    if (warned[key]) return;
    warned[key] = true;
    const err = makeError(code || 'R2D_VFX_WARNING', message, path);
    reportDiag(err);
}

const warned = Object.create(null);

// ---------------------------------------------------------------------------
// Спека: чистые данные
// ---------------------------------------------------------------------------

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Глубокая копия данных спеки. Функции, символы и не-конечные числа
 * отклоняются: спека должна пережить JSON и не тащить замыканий.
 */
function cloneData(value, path) {
    const kind = typeof value;
    if (value === null || value === undefined) return value;
    if (kind === 'function' || kind === 'symbol' || kind === 'bigint') {
        fail('R2D_VFX_NOT_DATA',
             `$.vfx: ${path}: спека — чистые данные, ${kind === 'function' ? 'функция' : kind} недопустим` +
             ' (эффект должен переживать JSON и не держать замыканий)',
             path);
    }
    if (kind === 'number') {
        if (!Number.isFinite(value)) {
            fail('R2D_VFX_NOT_DATA', `$.vfx: ${path}: не-конечное число недопустимо`, path);
        }
        return value;
    }
    if (kind === 'string' || kind === 'boolean') return value;
    if (Array.isArray(value)) {
        return value.map((item, i) => cloneData(item, `${path}[${i}]`));
    }
    if (isPlainObject(value)) {
        const out = {};
        for (const key of Object.keys(value)) {
            if (value[key] === undefined) continue;
            out[key] = cloneData(value[key], `${path}.${key}`);
        }
        return out;
    }
    fail('R2D_VFX_NOT_DATA',
         `$.vfx: ${path}: допустимы объекты, массивы, числа, строки и булевы`, path);
}

function numberField(raw, path, fallback) {
    if (raw === undefined || raw === null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        fail('R2D_VFX_BAD_SPEC', `$.vfx: ${path}: нужно число, получено ${JSON.stringify(raw)}`,
             path);
    }
    return n;
}

function normalizeBudget(raw, layers) {
    if (raw === undefined || raw === null) {
        // Без явного бюджета оцениваем по слоям: иначе счётчик частиц врал бы.
        let particles = 0;
        let light = 0;
        for (const layer of layers || []) {
            if (layer.use === 'particles.burst') {
                particles += Math.max(1, Math.floor(Number(layer.params.count
                                        !== undefined ? layer.params.count
                                        : (layer.params.amount !== undefined ? layer.params.amount : 12)) || 12));
            } else if (layer.use === 'particles.preset') {
                particles += Math.max(1, Math.floor(Number(layer.params.amount !== undefined
                                        ? layer.params.amount : 32) || 32));
            } else if (layer.use === 'light.emitter') {
                light += 1;
            }
        }
        return { particles, light };
    }
    if (!isPlainObject(raw)) {
        fail('R2D_VFX_BAD_SPEC', '$.vfx: spec.budget: нужен объект { particles, light }',
             'spec.budget');
    }
    const particles = numberField(raw.particles, 'spec.budget.particles', 0);
    const light = numberField(raw.light, 'spec.budget.light', 0);
    if (particles < 0 || light < 0) {
        fail('R2D_VFX_BAD_SPEC', '$.vfx: spec.budget: значения не могут быть отрицательными',
             'spec.budget');
    }
    return { particles: Math.floor(particles), light: Math.floor(light) };
}

function unknownPrimitive(use, path) {
    const allowed = vfxPrimitives();
    fail('R2D_VFX_UNKNOWN_PRIMITIVE',
         `$.vfx: ${path}: неизвестный примитив use: "${use}". Допустимые: ${allowed.join(', ')}`,
         path, { allowed });
}

function checkUse(use, path) {
    if (BASE_PRIMITIVES.indexOf(use) >= 0) return;
    if (typeof use === 'string' && use.indexOf('shader.') === 0 && use.length > 7) return;
    if (typeof use === 'string' && use.indexOf('clip.') === 0 && use.length > 5) return;
    unknownPrimitive(use, path);
}

function normalizeLayer(raw, index, duration) {
    const path = `spec.layers[${index}]`;
    if (!isPlainObject(raw)) {
        fail('R2D_VFX_BAD_SPEC', `$.vfx: ${path}: нужен объект { at, use, params }`, path);
    }
    const at = numberField(raw.at, `${path}.at`, undefined);
    if (at === undefined) {
        fail('R2D_VFX_BAD_SPEC', `$.vfx: ${path}.at: нужен момент слоя в секундах`, `${path}.at`);
    }
    if (at < 0) {
        fail('R2D_VFX_BAD_SPEC', `$.vfx: ${path}.at: отрицательное время слоя`, `${path}.at`);
    }
    if (at > duration + 1e-9) {
        fail('R2D_VFX_BAD_SPEC',
             `$.vfx: ${path}.at (${at}) больше duration (${duration}) — слой никогда не сработает`,
             `${path}.at`);
    }
    const use = raw.use;
    if (typeof use !== 'string' || use.trim() === '') {
        fail('R2D_VFX_BAD_SPEC', `$.vfx: ${path}.use: нужна строка-примитив`, `${path}.use`);
    }
    const clean_use = use.trim();
    checkUse(clean_use, `${path}.use`);
    let params = {};
    if (raw.params !== undefined) {
        if (!isPlainObject(raw.params)) {
            fail('R2D_VFX_BAD_SPEC',
                 `$.vfx: ${path}.params: нужен объект параметров, получено ${JSON.stringify(raw.params)}`,
                 `${path}.params`);
        }
        params = cloneData(raw.params, `${path}.params`);
    }
    return { at, use: clean_use, params, fired: false };
}

/** Проверить и нормализовать спеку; возвращает новую чистую структуру. */
function normalizeSpec(spec, where) {
    if (!isPlainObject(spec)) {
        fail('R2D_VFX_BAD_SPEC',
             `$.vfx: ${where}: спека должна быть объектом { duration, seed, budget, layers }`,
             where);
    }
    const duration = numberField(spec.duration, `${where}.duration`, undefined);
    if (duration === undefined) {
        fail('R2D_VFX_BAD_SPEC', `$.vfx: ${where}.duration: нужна длительность эффекта в секундах`,
             `${where}.duration`);
    }
    if (duration <= 0) {
        fail('R2D_VFX_BAD_SPEC', `$.vfx: ${where}.duration: должна быть > 0`, `${where}.duration`);
    }
    let seed = '';
    if (spec.seed !== undefined) {
        if (typeof spec.seed !== 'string' && typeof spec.seed !== 'number') {
            fail('R2D_VFX_BAD_SPEC', `$.vfx: ${where}.seed: нужна строка или число`,
                 `${where}.seed`);
        }
        seed = spec.seed;
    }
    if (!Array.isArray(spec.layers)) {
        fail('R2D_VFX_BAD_SPEC', `$.vfx: ${where}.layers: нужен массив слоёв`,
             `${where}.layers`);
    }
    const layers = spec.layers.map((layer, i) => normalizeLayer(layer, i, duration));
    const budget = normalizeBudget(spec.budget, layers);
    return { duration, seed, budget, layers };
}

/** Спека по имени или объекту; неизвестное имя — со списком известных. */
function resolveSpec(nameOrSpec, where) {
    if (typeof nameOrSpec === 'string') {
        const found = registry.get(nameOrSpec);
        if (!found) {
            const names = [...registry.keys()].sort();
            fail('R2D_VFX_UNKNOWN_EFFECT',
                 `$.vfx: ${where}: нет эффекта "${nameOrSpec}". Известные: ${names.join(', ')}`,
                 where, { allowed: names });
        }
        return cloneSpec(found);
    }
    return normalizeSpec(nameOrSpec, where || 'spec');
}

function cloneSpec(spec) {
    return cloneData(spec, 'spec');
}

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

const state = {
    registry: new Map(),
    effects: [],
    budget: { particles: DEFAULT_BUDGET.particles, light: DEFAULT_BUDGET.light },
    used: { particles: 0, light: 0 },
    cumulative: { played: 0, degraded: 0, skipped: 0 },
    next_id: 1,
};

//: Реестр вынесен наружу, чтобы resolveSpec видел его до installVfx.
const registry = state.registry;

// ---------------------------------------------------------------------------
// RNG и hash (детерминизм)
// ---------------------------------------------------------------------------

function seedHash(seed) {
    const text = String(seed === undefined || seed === null ? '' : seed);
    let h = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i) & 0xff;
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

function mixHash(hash, value) {
    return (Math.imul(hash ^ (value >>> 0), 16777619) + 0x9e3779b9) >>> 0;
}

// ---------------------------------------------------------------------------
// Точки и origin
// ---------------------------------------------------------------------------

function pointOf(what) {
    if (!what) return null;
    if (typeof what === 'string') {
        const n = query(what)[0];
        return n ? { x: n.x, y: n.y } : null;
    }
    if (typeof what === 'function') {
        try { return pointOf(what()); } catch (e) { return null; }
    }
    if (what.nodes) {
        const n = what.nodes[0];
        return n ? { x: n.x, y: n.y } : null;
    }
    if (what.tag) return { x: what.x, y: what.y };
    if (Array.isArray(what)) return { x: Number(what[0]), y: Number(what[1]) };
    if (typeof what.x === 'number' && typeof what.y === 'number') {
        return { x: what.x, y: what.y };
    }
    return null;
}

function offsetPoint(origin, value, fallback) {
    const p = pointOf(value);
    if (p) return { x: origin.x + p.x, y: origin.y + p.y };
    if (fallback) return { x: origin.x + fallback[0], y: origin.y + fallback[1] };
    return { x: origin.x, y: origin.y };
}

function effectOrigin(effect) {
    if (effect.follow) {
        const p = pointOf(effect.follow);
        if (p) effect.origin = p;
    }
    return effect.origin;
}

// ---------------------------------------------------------------------------
// Применение одного слоя
// ---------------------------------------------------------------------------

function addHandle(effect, handle) {
    if (handle) effect.handles.push(handle);
    return handle;
}

function particleScale(effect) {
    const need = Math.max(1, effect.spec.budget.particles);
    return Math.max(0, effect.budget.particles) / need;
}

function spawnParticles(effect, params, count, mode) {
    const $ = root();
    const particles = $ && $.particles;
    if (!$ || typeof $ !== 'function' || !particles) {
        warnOnce('particles', '$.vfx: частиц нет (модуль particles.js не установлен)',
                 'R2D_VFX_NO_PARTICLES');
        return null;
    }
    const preset_name = params.preset || 'sparks';
    const base = typeof particles.preset === 'function'
        ? particles.preset(preset_name, null) : {};
    const spec = Object.assign({}, base, params, {
        one_shot: mode !== 'preset',
        emitting: mode === 'preset',
        local: false,
        amount: count,
        max_particles: Math.max(count, Math.floor(Number(params.max_particles) || count * 2)),
    });
    delete spec.count;
    delete spec.class;
    const cls = params.class ? ' ' + String(params.class) : '';
    const node = $('<particles>', Object.assign({}, spec, {
        id: `__vfx_${effect.id}_p${effect.emitters}`,
        class: 'vfx-emitter' + cls,
    }));
    if (!node || typeof node.appendTo !== 'function') return null;
    const o = effectOrigin(effect);
    if (typeof node.at === 'function') node.at(o.x, o.y);
    node.appendTo($.world);
    if (mode === 'burst') {
        if (typeof node.restart === 'function') node.restart();
        else if (typeof node.burst === 'function') node.burst(count);
    }
    return node;
}

function makeLight(effect, params) {
    const $ = root();
    if (!$ || typeof $ !== 'function') return null;
    const o = effectOrigin(effect);
    const base_intensity = Number(params.intensity === undefined ? 1 : params.intensity);
    const node = $('<light>', {
        id: `__vfx_${effect.id}_l${effect.lights}`,
        class: 'vfx-light',
        radius: Number(params.radius === undefined ? 120 : params.radius),
        color: params.color === undefined ? '#ffcc88' : params.color,
        intensity: base_intensity,
        falloff: Number(params.falloff === undefined ? 2 : params.falloff),
    });
    if (!node || typeof node.appendTo !== 'function') return null;
    if (typeof node.at === 'function') node.at(o.x, o.y);
    node.appendTo($.world);
    const flick = params.flicker && isPlainObject(params.flicker) ? params.flicker : null;
    return {
        node,
        base_intensity,
        hz: flick ? Number(flick.hz) || 0 : 0,
        depth: flick ? Math.max(0, Number(flick.depth) || 0) : 0,
    };
}

function applyLayer(effect, layer) {
    const params = layer.params || {};
    const origin = effectOrigin(effect);
    const use = layer.use;

    // Детерминизм: seed эффекта влияет на выборки слоя, hash виден в query().
    const draw = effect.rng.next();
    effect.draws++;
    effect.hash = mixHash(effect.hash, Math.floor(draw * 1e9));
    effect.hash = mixHash(effect.hash, effect.fired * 131 + layer.at * 1000);

    if (use === 'particles.burst' || use === 'particles.preset') {
        const want = Math.max(1, Math.floor(Number(
            params.count !== undefined ? params.count
                : (params.amount !== undefined ? params.amount : 12)) || 12));
        const allowed = Math.max(0, Math.min(want,
            effect.budget.particles - effect.particles_used));
        if (allowed <= 0) {
            state.cumulative.skipped++;
            return;
        }
        effect.particles_used += allowed;
        const node = spawnParticles(effect, params, allowed,
                                    use === 'particles.preset' ? 'preset' : 'burst');
        if (node) {
            effect.emitters++;
            addHandle(effect, {
                stop() { if (typeof node.stop === 'function') node.stop(); },
                remove() { if (typeof node.remove === 'function') node.remove(); },
            });
        } else {
            state.cumulative.skipped++;
        }
        return;
    }

    if (use === 'fx.flash') {
        const h = effect.full.flash(params.color === undefined ? '#ffffff' : params.color, params);
        addHandle(effect, h && h.stop ? h : null);
        return;
    }

    if (use === 'fx.shake') {
        const $ = root();
        if ($ && $.camera && typeof $.camera.shake === 'function') {
            $.camera.shake(Number(params.amp === undefined ? params.intensity : params.amp) || 0,
                           Number(params.ms === undefined ? 120 : params.ms) || 0);
        }
        return;
    }

    if (use === 'fx.hitStop') {
        effect.full.hitStop(Number(params.ms === undefined ? 60 : params.ms),
                            params.scale === undefined ? undefined : Number(params.scale));
        return;
    }

    if (use === 'fx.shockwave' || use === 'fx.pulse') {
        const p = offsetPoint(origin, params.at !== undefined ? params.at : null, [0, 0]);
        const args = Object.assign({}, params);
        delete args.at;
        const h = effect.full[use === 'fx.shockwave' ? 'shockwave' : 'pulse'](p.x, p.y, args);
        addHandle(effect, h && h.stop ? h : null);
        return;
    }

    if (use === 'fx.lightning') {
        const from = offsetPoint(origin, params.from !== undefined ? params.from : null, [0, 0]);
        const to = offsetPoint(origin, params.to !== undefined ? params.to : null, [60, 0]);
        const h = effect.full.lightning(from, to, params);
        addHandle(effect, h && h.stop ? h : null);
        return;
    }

    if (use === 'fx.ribbon') {
        let points = params.points;
        if (!Array.isArray(points)) {
            points = [params.from !== undefined ? params.from : [0, 0],
                      params.to !== undefined ? params.to : [40, 0]];
        }
        const world = points.map((p) => offsetPoint(origin, p, [0, 0]));
        if (world.length < 2) {
            state.cumulative.skipped++;
            return;
        }
        const args = Object.assign({}, params);
        delete args.points;
        delete args.from;
        delete args.to;
        const h = effect.full.ribbon(world, args);
        addHandle(effect, h && h.stop ? h : null);
        return;
    }

    if (use === 'fx.trail') {
        const target = params.target !== undefined ? params.target
            : (effect.follow || effect.origin_what);
        if (!target) {
            warnOnce('trail.target', '$.vfx: fx.trail без цели — укажите params.target ' +
                     'или play(..., { follow })', 'R2D_VFX_NEEDS_TARGET');
            state.cumulative.skipped++;
            return;
        }
        const h = effect.full.trail(target, params);
        addHandle(effect, h && h.stop ? h : null);
        return;
    }

    if (use === 'fx.attractor') {
        const h = effect.full.attractor(origin.x, origin.y, params);
        addHandle(effect, h && h.stop ? h : null);
        return;
    }

    if (use === 'light.emitter') {
        if (effect.lights_used >= effect.budget.light) {
            state.cumulative.skipped++;
            return;
        }
        effect.lights_used++;
        const light = makeLight(effect, params);
        if (!light) {
            state.cumulative.skipped++;
            return;
        }
        effect.light_nodes.push(light);
        effect.lights++;
        return;
    }

    if (use === 'sound.playBank') {
        const $ = root();
        const sfx = $ && $.sfx;
        if (!sfx || typeof sfx.playBank !== 'function') {
            warnOnce('sfx', '$.vfx: sound.playBank — $.sfx нет (модуль sfx.js не установлен)',
                     'R2D_VFX_NO_SFX');
            state.cumulative.skipped++;
            return;
        }
        const bank = params.bank === undefined ? params.name : params.bank;
        if (bank === undefined || bank === null || bank === '') {
            fail('R2D_VFX_BAD_SPEC', '$.vfx: sound.playBank: нужен params.bank',
                 'spec.layers.use.params.bank');
        }
        const played = sfx.playBank(String(bank), params);
        if (played === null) state.cumulative.skipped++;
        return;
    }

    if (use.indexOf('shader.') === 0) {
        const name = use.slice('shader.'.length);
        const $ = root();
        const gfx = $ && $.gfx;
        const presets = gfx && typeof gfx.postPresets === 'function' ? gfx.postPresets() : [];
        const user = gfx && typeof gfx.userShaders === 'function' ? gfx.userShaders() : [];
        if (presets.indexOf(name) >= 0 && typeof gfx.postPreset === 'function') {
            gfx.postPreset(name, params);
            return;
        }
        if (user.indexOf(name) >= 0 && effect.target_node &&
            typeof effect.target_node.shader === 'function') {
            effect.target_node.shader(name, params);
            return;
        }
        warnOnce('shader.' + name,
                 `$.vfx: shader.${name}: нет такого пост-пресета/пользовательского шейдера — ` +
                 `есть: ${presets.concat(user).join(', ') || '(ни одного)'}`,
                 'R2D_VFX_UNKNOWN_SHADER');
        state.cumulative.skipped++;
        return;
    }

    if (use === 'layers.fadeTo') {
        const $ = root();
        const layers = $ && $.layers;
        if (!layers || typeof layers.fadeTo !== 'function') {
            warnOnce('layers', '$.vfx: layers.fadeTo — $.layers нет', 'R2D_VFX_NO_LAYERS');
            state.cumulative.skipped++;
            return;
        }
        const ms = params.ms === undefined ? Math.round(effect.spec.duration * 1000) : Number(params.ms);
        layers.fadeTo(params.color === undefined ? '#000000' : params.color,
                      params.alpha === undefined ? 1 : Number(params.alpha), ms);
        return;
    }

    if (use.indexOf('clip.') === 0) {
        const name = use.slice('clip.'.length);
        const $ = root();
        const clips = $ && $.clip;
        if (!clips || typeof clips.get !== 'function') {
            fail('R2D_VFX_UNKNOWN_CLIP', '$.vfx: clip.<имя> — $.clip нет (модуль clip.js не установлен)',
                 'spec.layers.use');
        }
        const clip = clips.get(name);
        if (!clip) {
            const names = typeof clips.list === 'function' ? clips.list() : [];
            fail('R2D_VFX_UNKNOWN_CLIP',
                 `$.vfx: нет клипа "${name}". Известные: ${names.join(', ') || '(ни одного)'}`,
                 'spec.layers.use', { allowed: names });
        }
        const node = $('<sprite>', {
            id: `__vfx_${effect.id}_c${effect.clips}`,
            class: 'vfx-clip' + (params.class ? ' ' + String(params.class) : ''),
        });
        if (!node || typeof node.appendTo !== 'function') {
            state.cumulative.skipped++;
            return;
        }
        const o = effectOrigin(effect);
        if (typeof node.at === 'function') node.at(o.x, o.y);
        if (params.scale !== undefined && typeof node.scale === 'function') node.scale(params.scale);
        if (typeof node.animate === 'function') node.animate(name);
        node.appendTo($.world);
        effect.clips++;
        addHandle(effect, {
            remove() { if (typeof node.remove === 'function') node.remove(); },
        });
        return;
    }

    // Сюда попасть нельзя: checkUse отклонил бы неизвестное имя раньше.
    unknownPrimitive(use, 'spec.layers.use');
}

// ---------------------------------------------------------------------------
// Жизненный цикл эффекта
// ---------------------------------------------------------------------------

function releaseBudget(effect) {
    state.used.particles = Math.max(0, state.used.particles - effect.budget.particles);
    state.used.light = Math.max(0, state.used.light - effect.budget.light);
}

function finishEffect(effect, why) {
    if (!effect.active) return;
    effect.active = false;
    effect.end_reason = why || 'end';
    for (let i = effect.handles.length - 1; i >= 0; i--) {
        const h = effect.handles[i];
        try {
            if (typeof h === 'function') h();
            else if (h && typeof h.remove === 'function') h.remove();
            else if (h && typeof h.stop === 'function') h.stop();
        } catch (e) { /* уборка не должна ронять кадр */ }
    }
    effect.handles.length = 0;
    for (const light of effect.light_nodes) {
        try { if (light.node && typeof light.node.remove === 'function') light.node.remove(); }
        catch (e) { /* уже удалён */ }
    }
    effect.light_nodes.length = 0;
    releaseBudget(effect);
    const at = state.effects.indexOf(effect);
    if (at >= 0) state.effects.splice(at, 1);
}

function fireDue(effect, t) {
    for (const layer of effect.layers) {
        if (layer.fired) continue;
        if (layer.at <= t + 1e-9) {
            layer.fired = true;
            effect.fired++;
            applyLayer(effect, layer);
        }
    }
}

function makeHandle(effect) {
    return {
        stop() { finishEffect(effect, 'stop'); return this; },
        seek(seconds) {
            const t = Math.max(0, Math.min(effect.spec.duration, Number(seconds) || 0));
            effect.t = t;
            // Перемотка вперёд не проигрывает пропущенные слои (для предпросмотра
            // честнее показать «здесь они уже прошли»); назад — снова вооружает.
            effect.fired = 0;
            for (const layer of effect.layers) {
                layer.fired = layer.at <= t + 1e-9;
                if (layer.fired) effect.fired++;
            }
            return this;
        },
        setRate(rate) {
            const n = Number(rate);
            if (!Number.isFinite(n) || n <= 0) {
                warnOnce('rate', `$.vfx: setRate(${rate}) — нужна положительная скорость`,
                         'R2D_VFX_BAD_SPEC');
                return this;
            }
            effect.rate = n;
            return this;
        },
        query() {
            return {
                id: effect.id,
                name: effect.name,
                time: effect.t,
                progress: effect.spec.duration > 0
                    ? Math.min(1, effect.t / effect.spec.duration) : 1,
                duration: effect.spec.duration,
                rate: effect.rate,
                active: effect.active,
                seed: effect.seed,
                draws: effect.draws,
                hash: effect.hash,
                degraded: effect.degraded,
                fired: effect.fired,
                layers: effect.layers.length,
                end_reason: effect.end_reason || null,
            };
        },
    };
}

function playInternal(spec, opts, name) {
    const o = opts || {};
    const duration = spec.duration;
    const seed = o.seed !== undefined ? o.seed : spec.seed;
    if (typeof seed !== 'string' && typeof seed !== 'number') {
        fail('R2D_VFX_BAD_SPEC', '$.vfx: play opts.seed: нужна строка или число', 'opts.seed');
    }
    let rate = o.rate === undefined ? 1 : Number(o.rate);
    if (!Number.isFinite(rate) || rate <= 0) {
        fail('R2D_VFX_BAD_SPEC', '$.vfx: play opts.rate: нужна положительная скорость', 'opts.rate');
    }

    const origin_what = o.at !== undefined ? o.at : (o.parent !== undefined ? o.parent : null);
    const origin = pointOf(origin_what) || { x: 0, y: 0 };
    let follow = null;
    if (o.follow === true) follow = origin_what;
    else if (o.follow !== undefined && o.follow !== null) follow = o.follow;

    const need = spec.budget;
    const free_p = Math.max(0, state.budget.particles - state.used.particles);
    const free_l = Math.max(0, state.budget.light - state.used.light);
    const alloc_p = Math.min(need.particles, free_p);
    const alloc_l = Math.min(need.light, free_l);
    const degraded = alloc_p < need.particles || alloc_l < need.light;

    const effect = {
        id: state.next_id++,
        name: name || (typeof o.name === 'string' ? o.name : 'spawn'),
        spec,
        layers: spec.layers.map((layer) => Object.assign({}, layer, { fired: false })),
        t: 0,
        rate,
        seed,
        rng: makeRandom(seedHash(seed)),
        hash: seedHash(seed) ^ 0x9e3779b9,
        draws: 0,
        fired: 0,
        active: true,
        origin,
        origin_what,
        follow,
        target_node: (function () {
            if (origin_what && origin_what.nodes) return origin_what.nodes[0] || null;
            if (origin_what && origin_what.tag) return origin_what;
            return null;
        })(),
        budget: { particles: alloc_p, light: alloc_l },
        requested: { particles: need.particles, light: need.light },
        particles_used: 0,
        lights_used: 0,
        emitters: 0,
        lights: 0,
        clips: 0,
        handles: [],
        light_nodes: [],
        full: null,
        degraded,
        end_reason: null,
    };
    effect.full = full_api;
    state.used.particles += alloc_p;
    state.used.light += alloc_l;
    if (degraded) state.cumulative.degraded++;
    state.cumulative.played++;
    state.effects.push(effect);
    // Слои at=0 срабатывают в момент вызова, а не на следующем кадре: вспышка
    // удара должна быть в том же кадре, что и удар.
    fireDue(effect, 0);
    const handle = makeHandle(effect);
    effect.handle = handle;
    return handle;
}

// ---------------------------------------------------------------------------
// Кадр
// ---------------------------------------------------------------------------

function tickVfx(raw_dt) {
    if (state.effects.length === 0) return;
    const time = ctx.time;
    let dt = time && typeof time.delta === 'function'
        ? Number(time.delta()) : (Number(raw_dt) || 0);
    if (!(dt > 0)) return;
    for (let i = state.effects.length - 1; i >= 0; i--) {
        const effect = state.effects[i];
        if (!effect || !effect.active) continue;
        effect.t += dt * effect.rate;
        const origin = effectOrigin(effect);
        // Мерцание света — по игровому времени эффекта.
        for (const light of effect.light_nodes) {
            if (!light.node || !(light.hz > 0) || light.base_intensity <= 0) continue;
            const k = 1 + light.depth * Math.sin(2 * Math.PI * light.hz * effect.t
                                                 + Number(light.node.x || 0) * 0.01);
            light.node.intensity = Math.max(0, Math.min(2, light.base_intensity * k));
        }
        fireDue(effect, effect.t);
        if (effect.t >= effect.spec.duration - 1e-9) finishEffect(effect, 'end');
    }
}

function resetVfxState() {
    for (let i = state.effects.length - 1; i >= 0; i--) {
        finishEffect(state.effects[i], 'scene');
    }
    state.effects.length = 0;
    state.used.particles = 0;
    state.used.light = 0;
    state.cumulative.played = 0;
    state.cumulative.degraded = 0;
    state.cumulative.skipped = 0;
}

// ---------------------------------------------------------------------------
// Реестр и файлы
// ---------------------------------------------------------------------------

function defineInternal(name, spec) {
    if (typeof name !== 'string' || name.trim() === '') {
        fail('R2D_VFX_BAD_SPEC', '$.vfx.define: нужно непустое имя эффекта', 'name');
    }
    const normalized = normalizeSpec(spec, name);
    registry.set(name, normalized);
    return cloneSpec(normalized);
}

function readJSON(path) {
    const $ = root();
    const fs = $ && ($.fs || ctx.fs);
    if (!fs || typeof fs.readJSON !== 'function') {
        fail('R2D_VFX_LOAD_FAILED',
             '$.vfx: нет $.fs — читать файлы нечем (модуль store.js не установлен)',
             String(path));
    }
    let data = null;
    try {
        data = fs.readJSON(path, null);
    } catch (e) {
        fail('R2D_VFX_LOAD_FAILED',
             `$.vfx: не удалось прочитать ${path}: ${e && e.message ? e.message : e}`,
             String(path));
    }
    if (data === null || data === undefined) {
        fail('R2D_VFX_LOAD_FAILED', `$.vfx: файл ${path} не найден или пуст`, String(path));
    }
    return data;
}

function defineData(data, where) {
    const source = data && data.effects && isPlainObject(data.effects) ? data.effects : data;
    if (!isPlainObject(source)) {
        fail('R2D_VFX_BAD_SPEC',
             `$.vfx: ${where}: файл должен содержать объект "имя → спека" или { effects: {...} }`,
             where);
    }
    const out = [];
    for (const name of Object.keys(source)) {
        defineInternal(name, source[name]);
        out.push(name);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Встроенный набор: docs/VFX_ROADMAP.md §D3 (22 эффекта)
// ---------------------------------------------------------------------------

function builtinSpecs() {
    const B = (particles, light, layers, seed) => ({
        duration: 0.35, seed: seed || particles,
        budget: { particles: particles, light: light },
        layers: layers,
    });
    return {
        'hit.spark': B(120, 1, [
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'sparks', count: 24, speed: [80, 220],
                        lifetime: [120, 300], color: '#ffd27a' } },
            { at: 0.00, use: 'fx.flash', params: { color: '#fff3c4', ms: 90, alpha: 0.6 } },
            { at: 0.00, use: 'fx.hitStop', params: { ms: 40 } },
            { at: 0.00, use: 'fx.shake', params: { amp: 3, ms: 120 } },
            { at: 0.00, use: 'fx.pulse',
              params: { radius: 42, ms: 110, color: '#ffd27a' } },
            { at: 0.02, use: 'fx.ribbon',
              params: { from: [0, 0], to: [26, -18], width: 6, ms: 180, color: '#ffb46b' } },
        ], 'hit.spark'),

        'hit.metal': B(80, 1, [
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'sparks', count: 16, speed: [60, 180], color: '#cfe9ff' } },
            { at: 0.00, use: 'fx.flash', params: { color: '#dff0ff', ms: 70, alpha: 0.35 } },
            { at: 0.00, use: 'fx.pulse',
              params: { radius: 34, ms: 90, color: '#cfe9ff' } },
            { at: 0.00, use: 'fx.shake', params: { amp: 2, ms: 110 } },
            { at: 0.00, use: 'light.emitter',
              params: { radius: 120, intensity: 0.8, color: '#cfe9ff',
                        flicker: { hz: 18, depth: 0.2 } } },
            { at: 0.05, use: 'sound.playBank',
              params: { bank: 'hit.metal', pitchRange: 0.9 } },
        ], 'hit.metal'),

        'hit.soft': B(50, 0, [
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'dust', count: 10, speed: [20, 60], color: '#d8c99a' } },
            { at: 0.00, use: 'fx.pulse',
              params: { radius: 24, ms: 80, color: '#f4e2b8', alpha: 0.7 } },
        ], 'hit.soft'),

        'crit': B(200, 1, [
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'sparks', count: 30, speed: [140, 420],
                        lifetime: [140, 380], max_particles: 64, color: '#fff3c4' } },
            { at: 0.00, use: 'fx.flash', params: { color: '#fff6d0', ms: 110, alpha: 0.55 } },
            { at: 0.00, use: 'fx.shockwave',
              params: { radius: 110, ms: 260, width: 7, color: '#ffe6a8' } },
            { at: 0.00, use: 'fx.hitStop', params: { ms: 110 } },
            { at: 0.00, use: 'fx.shake', params: { amp: 7, ms: 220 } },
            { at: 0.00, use: 'light.emitter',
              params: { radius: 180, intensity: 1.2, color: '#ffe6a8',
                        flicker: { hz: 14, depth: 0.25 } } },
        ], 'crit'),

        'jump.dust': B(40, 0, [
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'dust', count: 10, speed: [10, 40], direction: 90 } },
            { at: 0.00, use: 'fx.pulse',
              params: { radius: 20, ms: 90, color: '#d8c99a', alpha: 0.5 } },
        ], 'jump.dust'),

        'land.dust': B(80, 0, [
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'dust', count: 18, speed: [30, 90], spread: 180,
                        direction: -90 } },
            { at: 0.00, use: 'fx.pulse',
              params: { radius: 34, ms: 140, color: '#d8c99a', alpha: 0.6 } },
            { at: 0.00, use: 'fx.shake', params: { amp: 2, ms: 90 } },
            { at: 0.00, use: 'fx.hitStop', params: { ms: 30 } },
        ], 'land.dust'),

        'dash.wind': B(60, 0, [
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'smoke', count: 8, speed: [40, 100], direction: 180 } },
            { at: 0.00, use: 'fx.ribbon',
              params: { from: [-30, 0], to: [10, 0], width: 10, ms: 180,
                        color: '#bfe0ff', alpha: 0.6 } },
            { at: 0.00, use: 'fx.shake', params: { amp: 1, ms: 80 } },
        ], 'dash.wind'),

        'footstep': B(20, 0, [
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'dust', count: 4, speed: [5, 20], spread: 120,
                        direction: -90 } },
            { at: 0.00, use: 'sound.playBank',
              params: { bank: 'step', pitchRange: 0.08, volume: 0.5 } },
        ], 'footstep'),

        'torch.flame': B(80, 1, [
            { at: 0.00, use: 'particles.preset',
              params: { preset: 'fire', amount: 8, max_particles: 24 } },
            { at: 0.00, use: 'light.emitter',
              params: { radius: 180, intensity: 1, color: '#ffbe73',
                        flicker: { hz: 8, depth: 0.3 } } },
        ], 'torch.flame'),

        'campfire': B(160, 1, [
            { at: 0.00, use: 'particles.preset',
              params: { preset: 'fire', amount: 14, max_particles: 48 } },
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'sparks', count: 6, speed: [20, 80], direction: -90 } },
            { at: 0.00, use: 'light.emitter',
              params: { radius: 240, intensity: 0.9, color: '#ffb46b',
                        flicker: { hz: 5, depth: 0.35 } } },
        ], 'campfire'),

        'magic.circle': B(100, 1, [
            { at: 0.00, use: 'fx.shockwave',
              params: { radius: 90, ms: 420, width: 3, color: '#c9a6ff', ease: 'linear' } },
            { at: 0.00, use: 'fx.pulse',
              params: { radius: 50, ms: 360, color: '#c9a6ff', alpha: 0.5 } },
            { at: 0.00, use: 'fx.attractor',
              params: { radius: 160, strength: 200, swirl: 1.4, life: 600,
                        visual: false } },
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'sparks', count: 18, speed: [30, 90], direction: -90,
                        color: '#c9a6ff' } },
            { at: 0.00, use: 'light.emitter',
              params: { radius: 160, intensity: 0.8, color: '#c9a6ff',
                        flicker: { hz: 6, depth: 0.2 } } },
        ], 'magic.circle'),

        'explosion': B(400, 2, [
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'explosion', count: 42, max_particles: 96 } },
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'smoke', count: 10, max_particles: 24 } },
            { at: 0.00, use: 'fx.flash', params: { color: '#ffe0a0', ms: 140, alpha: 0.5 } },
            { at: 0.00, use: 'fx.shockwave',
              params: { radius: 240, ms: 420, width: 9, color: '#ffd9a0' } },
            { at: 0.00, use: 'fx.shake', params: { amp: 8, ms: 300 } },
            { at: 0.00, use: 'fx.hitStop', params: { ms: 60 } },
            { at: 0.00, use: 'light.emitter',
              params: { radius: 280, intensity: 1.4, color: '#ffb46b',
                        flicker: { hz: 10, depth: 0.4 } } },
            { at: 0.00, use: 'light.emitter',
              params: { radius: 140, intensity: 0.8, color: '#ff7030' } },
        ], 'explosion'),

        'shockwave': B(0, 0, [
            { at: 0.00, use: 'fx.shockwave',
              params: { radius: 200, ms: 380, width: 8, color: '#ffffff' } },
            { at: 0.00, use: 'fx.pulse',
              params: { radius: 60, ms: 200, color: '#ffffff', alpha: 0.4 } },
            { at: 0.00, use: 'fx.shake', params: { amp: 3, ms: 180 } },
        ], 'shockwave'),

        'slash': B(70, 0, [
            { at: 0.00, use: 'fx.ribbon',
              params: { points: [[-40, 30], [0, -20], [40, 25]], width: 8, ms: 140,
                        color: '#ffd27f', alpha: 0.9 } },
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'sparks', count: 8, speed: [80, 180] } },
            { at: 0.00, use: 'fx.pulse',
              params: { radius: 30, ms: 80, color: '#ffd27f', alpha: 0.5 } },
            { at: 0.02, use: 'sound.playBank',
              params: { bank: 'slash', pitchRange: 0.12 } },
        ], 'slash'),

        'parry': B(50, 1, [
            { at: 0.00, use: 'fx.flash', params: { color: '#dff0ff', ms: 60, alpha: 0.3 } },
            { at: 0.00, use: 'fx.shockwave',
              params: { radius: 70, ms: 220, width: 4, color: '#bfe6ff' } },
            { at: 0.00, use: 'fx.hitStop', params: { ms: 40 } },
            { at: 0.00, use: 'fx.shake', params: { amp: 4, ms: 140 } },
            { at: 0.00, use: 'light.emitter',
              params: { radius: 100, intensity: 0.7, color: '#bfe6ff' } },
            { at: 0.00, use: 'sound.playBank',
              params: { bank: 'parry', pitchRange: 0.1 } },
        ], 'parry'),

        'fade': B(0, 0, [
            { at: 0.00, use: 'layers.fadeTo',
              params: { color: '#000000', alpha: 1, ms: 400 } },
        ], 'fade'),
        'flash.screen': B(0, 0, [
            { at: 0.00, use: 'fx.flash', params: { color: '#ffffff', ms: 140, alpha: 0.8 } },
        ], 'flash.screen'),
        'quake': B(0, 0, [
            { at: 0.00, use: 'fx.shake', params: { amp: 10, ms: 400 } },
            { at: 0.00, use: 'fx.shockwave',
              params: { radius: 120, ms: 320, width: 5, color: '#c9a6ff' } },
        ], 'quake'),
        'slowmo': B(0, 0, [
            { at: 0.00, use: 'fx.hitStop', params: { ms: 300, scale: 0.3 } },
        ], 'slowmo'),

        'pickup': B(40, 1, [
            { at: 0.00, use: 'fx.pulse',
              params: { radius: 26, ms: 140, color: '#63d6a0' } },
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'sparks', count: 10, speed: [40, 120], direction: -90,
                        color: '#63d6a0' } },
            { at: 0.00, use: 'light.emitter',
              params: { radius: 90, intensity: 0.8, color: '#63d6a0',
                        flicker: { hz: 12, depth: 0.2 } } },
            { at: 0.00, use: 'sound.playBank', params: { bank: 'pickup', pitchRange: 0.05 } },
        ], 'pickup'),

        'quest.done': B(120, 1, [
            { at: 0.00, use: 'fx.flash', params: { color: '#fff6d0', ms: 160, alpha: 0.35 } },
            { at: 0.00, use: 'fx.shockwave',
              params: { radius: 150, ms: 420, width: 6, color: '#ffd27f' } },
            { at: 0.00, use: 'particles.burst',
              params: { preset: 'sparks', count: 24, speed: [60, 180], direction: -90 } },
            { at: 0.00, use: 'light.emitter',
              params: { radius: 160, intensity: 1, color: '#ffd27f' } },
            { at: 0.00, use: 'sound.playBank', params: { bank: 'quest.done' } },
        ], 'quest.done'),

        'warning': B(0, 1, [
            { at: 0.00, use: 'fx.flash', params: { color: '#ff3b30', ms: 200, alpha: 0.28 } },
            { at: 0.00, use: 'fx.shake', params: { amp: 3, ms: 220 } },
            { at: 0.00, use: 'fx.pulse',
              params: { radius: 40, ms: 180, color: '#ff3b30', alpha: 0.6 } },
            { at: 0.00, use: 'sound.playBank', params: { bank: 'warning' } },
        ], 'warning'),
    };
}

//: Длительности встроенных эффектов (секунды). Частицы живут дольше кадра:
//: если эффект короче их времени жизни, finishEffect срежет хвост.
const BUILTIN_DURATIONS = {
    'hit.spark': 0.35, 'hit.metal': 0.35, 'hit.soft': 0.30, 'crit': 0.45,
    'jump.dust': 0.40, 'land.dust': 0.60, 'dash.wind': 0.35, 'footstep': 0.25,
    'torch.flame': 2.0, 'campfire': 2.5, 'magic.circle': 0.60,
    'explosion': 0.90, 'shockwave': 0.45, 'slash': 0.30, 'parry': 0.35,
    'fade': 0.50, 'flash.screen': 0.20, 'quake': 0.45, 'slowmo': 0.35,
    'pickup': 0.40, 'quest.done': 0.70, 'warning': 0.50,
};

function defineBuiltins() {
    const specs = builtinSpecs();
    for (const name of Object.keys(specs)) {
        const spec = specs[name];
        const duration = BUILTIN_DURATIONS[name];
        if (duration !== undefined) spec.duration = duration;
        defineInternal(name, spec);
    }
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

export function installVfx($) {
    api = $;
    const base = installVisualBase($);

    const vfx = {
        // --- примитивы (новые имена; $.fx — алиас поверх этого объекта) ------
        trail(target, opts) { return base.trail(target, opts); },
        ribbon(points, opts) { return base.ribbon(points, opts); },
        pushRibbon(points, opts) { return base.pushRibbon(points, opts); },
        lightning(from, to, opts) { return base.lightning(from, to, opts); },
        shockwave(x, y, opts) { return base.shockwave(x, y, opts); },
        pulse(x, y, opts) { return base.pulse(x, y, opts); },
        flash(color, opts) { return base.flash(color, opts); },
        flashLeft() { return base.flashLeft(); },
        attractor(x, y, opts) { return base.attractor(x, y, opts); },
        hitStop(ms, scale) { base.hitStop(ms, scale); return vfx; },

        /**
         * Готовый удар: волна + тряска + микро-стоп (визуальная часть).
         * Звук — по правилу «что слышно → $.sfx»: если задан opts.sound, он
         * уходит в `$.sfx.play` (пресет/банк/путь), а не играется здесь.
         */
        impact(x, y, opts) {
            const o = opts || {};
            base.impact(x, y, o);
            if (o.sound !== undefined && o.sound !== null && o.sound !== '') {
                const r = root();
                const sfx = r && r.sfx;
                if (sfx && typeof sfx.play === 'function') {
                    try { sfx.play(o.sound, o.soundOpts || o); } catch (e) { /* нет звука */ }
                }
            }
            return vfx;
        },

        /** Собрать визуальную статистику кадра (см. stats()). */
        clear() {
            for (let i = state.effects.length - 1; i >= 0; i--) {
                finishEffect(state.effects[i], 'clear');
            }
            state.effects.length = 0;
            state.used.particles = 0;
            state.used.light = 0;
            base.clear();
            return vfx;
        },

        /**
         * Сколько чего живо сейчас. К базовым счётчикам (trails/bolts/waves/
         * fields/pulses/flashes) добавляются счётчики r2dvfx:
         * `{ effects, particles, emitters, lights, clips, degraded, skipped,
         *    played, budget }`. `degraded`/`skipped` — накопленные за сцену.
         */
        stats() {
            let emitters = 0;
            let clips = 0;
            let degraded_active = 0;
            for (const e of state.effects) {
                emitters += e.emitters;
                clips += e.clips;
                if (e.degraded) degraded_active++;
            }
            return Object.assign({}, base.stats(), {
                effects: state.effects.length,
                particles: state.used.particles,
                emitters,
                lights: state.used.light,
                clips,
                degraded: state.cumulative.degraded,
                degraded_active,
                skipped: state.cumulative.skipped,
                played: state.cumulative.played,
                primitives: vfxPrimitives().length,
                budget: { particles: state.budget.particles, light: state.budget.light },
            });
        },

        /** Список допустимых имён `use:` (для инструментов и текста ошибок). */
        primitives() { return vfxPrimitives(); },

        /**
         * Потолки бюджета: `$.vfx.budget({ particles, light })`. Без аргумента
         * — чтение. Значения — неотрицательные целые; меняются на лету.
         */
        budget(value) {
            if (value === undefined) {
                return { particles: state.budget.particles, light: state.budget.light };
            }
            if (!isPlainObject(value)) {
                fail('R2D_VFX_BAD_SPEC', '$.vfx.budget: нужен объект { particles, light }',
                     'budget');
            }
            for (const key of ['particles', 'light']) {
                if (value[key] === undefined) continue;
                const n = Number(value[key]);
                if (!Number.isFinite(n) || n < 0) {
                    fail('R2D_VFX_BAD_SPEC',
                         `$.vfx.budget.${key}: нужно неотрицательное число`, `budget.${key}`);
                }
                state.budget[key] = Math.floor(n);
            }
            return { particles: state.budget.particles, light: state.budget.light };
        },

        // --- реестр ---------------------------------------------------------
        /**
         * Объявить эффект: `$.vfx.define(name, spec)`. Спека проверяется и
         * копируется; возвращается нормализованная копия (чистые данные).
         */
        define(name, spec) { return defineInternal(name, spec); },

        /** Спека по имени (глубокая копия) или null. */
        get(name) {
            const found = registry.get(String(name));
            return found ? cloneSpec(found) : null;
        },

        /** Имена эффектов (отсортированы). */
        list() { return [...registry.keys()].sort(); },

        /** Убрать эффект: true, если он был. */
        remove(name) { return registry.delete(String(name)); },

        /**
         * Собрать эффект из базы и надстройки, НЕ МУТИРУЯ базу.
         *
         * `base` — имя или спека; `patch` — частичная спека. `layers` из patch
         * ДОБАВЛЯЮТСЯ к слоям базы, `budget` сливается, остальные поля
         * перекрываются. Возвращает новую спеку (не регистрирует её).
         */
        extend(base, patch) {
            const base_spec = resolveSpec(base, 'extend.base');
            if (!isPlainObject(patch)) {
                fail('R2D_VFX_BAD_SPEC', '$.vfx.extend: patch должен быть объектом', 'patch');
            }
            const out = cloneSpec(base_spec);
            if (patch.duration !== undefined) {
                const d = Number(patch.duration);
                if (!Number.isFinite(d) || d <= 0) {
                    fail('R2D_VFX_BAD_SPEC', '$.vfx.extend: duration должна быть > 0',
                         'patch.duration');
                }
                out.duration = d;
            }
            if (patch.seed !== undefined) {
                if (typeof patch.seed !== 'string' && typeof patch.seed !== 'number') {
                    fail('R2D_VFX_BAD_SPEC', '$.vfx.extend: seed — строка или число',
                         'patch.seed');
                }
                out.seed = patch.seed;
            }
            if (patch.budget !== undefined) {
                if (!isPlainObject(patch.budget)) {
                    fail('R2D_VFX_BAD_SPEC', '$.vfx.extend: budget — объект',
                         'patch.budget');
                }
                out.budget = normalizeBudget(Object.assign({}, out.budget, patch.budget),
                                             out.layers);
            }
            if (patch.layers !== undefined) {
                if (!Array.isArray(patch.layers)) {
                    fail('R2D_VFX_BAD_SPEC', '$.vfx.extend: layers — массив', 'patch.layers');
                }
                const extra = patch.layers.map((layer, i) =>
                    normalizeLayer(layer, i, out.duration));
                out.layers = out.layers.concat(extra);
            }
            // Финальная проверка: extend не должен пропустить битую спеку.
            return normalizeSpec(out, 'extend');
        },

        // --- проигрывание ---------------------------------------------------
        /**
         * Проиграть эффект по имени или спеке. opts:
         * `{ at, parent, follow, rate, seed, name }`. Возвращает хендл
         * `{ stop, seek, setRate, query }`.
         */
        play(nameOrSpec, opts) {
            const spec = resolveSpec(nameOrSpec, 'play');
            const name = typeof nameOrSpec === 'string' ? nameOrSpec : 'spawn';
            return playInternal(spec, opts, name);
        },

        /** Разово, без регистрации: `$.vfx.spawn(node|point, spec, opts?)`. */
        spawn(what, spec, opts) {
            const normalized = normalizeSpec(spec, 'spawn');
            const o = Object.assign({}, opts, { at: what });
            return playInternal(normalized, o, 'spawn');
        },

        // --- файлы ----------------------------------------------------------
        /**
         * Загрузить эффекты из JSON: `$.vfx.load('vfx/hit.json')`. Формат —
         * объект «имя → спека» или `{ effects: {...} }`. Читается через `$.fs`,
         * без нативных загрузчиков. Возвращает имена объявленных эффектов.
         */
        load(path) {
            const data = readJSON(path);
            return defineData(data, String(path));
        },

        /**
         * Загрузить каталог: читает `<dir>/vfx.json` (манифест `{ files: [...] }`)
         * и грузит перечисленные файлы. Можно передать и массив путей.
         * Отдельного листинга каталогов в `$.fs` нет, поэтому манифест —
         * осознанный контракт, а не догадка.
         */
        loadAll(target) {
            const out = [];
            if (Array.isArray(target)) {
                for (const path of target) out.push.apply(out, vfx.load(path));
                return out;
            }
            const dir = String(target);
            const manifest = dir.replace(/\/+$/, '') + '/vfx.json';
            const data = readJSON(manifest);
            const files = data && Array.isArray(data.files) ? data.files : null;
            if (!files) {
                fail('R2D_VFX_LOAD_FAILED',
                     `$.vfx.loadAll("${dir}"): в ${manifest} нет { files: [...] }`,
                     manifest);
            }
            for (const file of files) {
                const path = String(file).indexOf('/') >= 0
                    ? String(file) : dir.replace(/\/+$/, '') + '/' + String(file);
                out.push.apply(out, vfx.load(path));
            }
            return out;
        },
    };

    ctx.vfx = vfx;
    $.vfx = vfx;
    full_api = vfx;

    // Регистрируем набор один раз (повторный installVfx не плодит эффекты).
    if (registry.size === 0) defineBuiltins();

    // Кадр и сброс — через хуки fx.js: обратного импорта нет.
    onFxTick(tickVfx);
    onFxReset(resetVfxState);
    return vfx;
}

export { tickVfx, resetVfxState };
