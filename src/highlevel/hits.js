// ===========================================================================
// Хит-фидбек: $.hits и $.hitFx — «ощущение удара» одной строкой.
//
// Задача модуля: из события контакта (`hit`/`collide`) получить полный набор
// откликов, не расписывая каждый эффект в игре:
//
//   * искры/брызги частиц в точке контакта;
//   * вспышка тона на пострадавшем узле;
//   * вспышка экрана на сильном ударе;
//   * тряска камеры;
//   * hit-stop ($.time.freeze) и замедление ($.time.slow);
//   * отдача (impulse телу Box2D или сдвиг узлу без тела);
//   * squash & stretch спрайта по направлению удара.
//
// Одна строка в игре:
//
//   $('#enemy').on('hit', $.hitFx);                    // пресет по умолчанию
//   $.hits.on('.enemy', 'crit');                       // пресет-имя
//   $.hits.on('.enemy', { hitStop: 90, knockback: 300 });
//
// Настройки — данные: опции-объект перекрывает пресет, пресет перекрывает
// умолчания. Ничего не «магического»: если опция не задана, эффект просто не
// вызывается (например, нет `knockback` — нет импульса).
//
// Детерминизм: случайность частиц берётся из rng эмиттера (зерно узла),
// отдача и squash — чистая математика от направления удара, поэтому при
// `--seed` и `--fixed-dt` повтор одного и того же боя даёт один и тот же мир.
// ===========================================================================

import { engine } from './native.js';
import { ctx, query, def, packColor, liveNodes } from './core.js';
import { flashNode } from './tween.js';

// ---------------------------------------------------------------------------
// Пресеты: данные, а не код
// ---------------------------------------------------------------------------

/** Базовые умолчания всех эффектов. Пресеты и опции перекрывают их. */
const DEFAULTS = {
    // Частицы: имя пресета particles.js + перекрытия.
    particles: {
        preset: 'sparks', amount: 14, one_shot: true,
        speed: [80, 260], lifetime: [120, 300], size: [2, 5],
        spread: 360, direction: 0, max_particles: 48,
    },
    // Вспышка тона на узле.
    flash: { color: '#ffffff', ms: 90 },
    // Вспышка всего экрана (fx.flash).
    screen: { color: '#ffffff', ms: 70, alpha: 0.35 },
    shake: 3,            // тряска камеры, амплитуда в пикселях
    shakeMs: 140,
    hitStop: 60,         // мс полной заморозки игрового времени
    slow: 0,             // мс замедления (0 — не замедлять)
    slowScale: 0.3,
    knockback: 0,        // импульс (тело) или сдвиг в пикселях (узел без тела)
    squash: 0.22,        // амплитуда squash & stretch (0 — не сжимать)
    squashMs: 180,
    // Имя звука для $.sound.play. Умолчание пустое: пресет не угадывает,
    // какие ассеты есть у игры, — иначе каждый удар писал бы в лог
    // «не удалось загрузить звук».
    sound: '',
    cooldown: 0,         // мс: не чаще одного хит-фидбека на цель
    target: 'self',      // кому достаётся фидбек: 'self' (узел события) | 'other'
};

const PRESETS = {
    // Умолчание для `$('#enemy').on('hit', $.hitFx)`: заметно, но не орёт.
    // Вспышки экрана здесь нет — она для crit/death: иначе каждый контакт
    // заливал бы кадр.
    hit: {
        screen: null, shake: 3, shakeMs: 140, hitStop: 60,
        knockback: 120, squash: 0.22, squashMs: 180,
    },
    crit: {
        particles: { amount: 26, speed: [140, 420], size: [3, 7], max_particles: 64 },
        flash: { color: '#fff3c4', ms: 130 },
        screen: { color: '#fff6d0', ms: 110, alpha: 0.55 },
        shake: 7, shakeMs: 220, hitStop: 110, knockback: 260,
        squash: 0.35, squashMs: 240,
    },
    block: {
        particles: { preset: 'sparks', amount: 8, speed: [60, 180], max_particles: 24 },
        flash: { color: '#bfe6ff', ms: 80 },
        screen: { color: '#cfeaff', ms: 60, alpha: 0.25 },
        shake: 2, hitStop: 40, knockback: 60, squash: 0.12,
    },
    death: {
        particles: { preset: 'explosion', amount: 42, max_particles: 96 },
        flash: { color: '#ffd9a0', ms: 150 },
        screen: { color: '#ffd9a0', ms: 140, alpha: 0.5 },
        shake: 9, shakeMs: 260, hitStop: 90, knockback: 240,
        squash: 0.4, squashMs: 260,
    },
    land: {
        particles: { preset: 'dust', amount: 12, max_particles: 32 },
        flash: null, screen: null, shake: 2, shakeMs: 90,
        hitStop: 30, knockback: 0, squash: 0.28, squashMs: 140,
    },
};

// ---------------------------------------------------------------------------
// Чистая часть (её проверяет юнит-тест)
// ---------------------------------------------------------------------------

/** Слияние «умолчания → пресет → опции» в один плоский объект. */
export function mergeSpec(presets, name, opts) {
    const out = {};
    for (const key of Object.keys(DEFAULTS)) {
        const base = DEFAULTS[key];
        out[key] = (base && typeof base === 'object' && !Array.isArray(base))
            ? Object.assign({}, base) : base;
    }
    // Без имени работает пресет `hit`: `$.hitFx(info)` — та самая одна строка.
    const layers = [presets[name === undefined || name === null ? 'hit' : name], opts];
    for (const layer of layers) {
        if (!layer) continue;
        for (const key of Object.keys(layer)) {
            const v = layer[key];
            if (v === undefined) continue;
            const base = out[key];
            out[key] = (v && typeof v === 'object' && !Array.isArray(v) &&
                        base && typeof base === 'object' && !Array.isArray(base))
                ? Object.assign({}, base, v) : v;
        }
    }
    return out;
}

/**
 * Данные события движка: обработчик получает объект `{ self, data, … }`, а
 * точка контакта и `other` лежат в `event.data`. Функция принимает и «сырой»
 * payload (`dispatchContacts` кладёт x/y прямо в него) — тогда вернётся он сам.
 */
export function payloadOf(what) {
    if (what && typeof what === 'object' && what.data && typeof what.data === 'object') {
        return what.data;
    }
    return what;
}

/** Узел из узла или обёртки; `null` — если это не узел. */
export function unwrapNode(value) {
    if (!value) return null;
    if (value.nodes && value.nodes.length) return value.nodes[0];
    if (value.x !== undefined || value.body !== undefined) return value;
    return null;
}

/**
 * §9-ответ damage request, а не узел: у него есть `accepted`/`applied` и
 * устойчивый `target_id`. Нужен, чтобы `$.hits.play(response)` работал прямо по
 * ответу — собирать `{ x, y, self }` руками игра не обязана.
 */
export function isDamageResponse(what) {
    return !!(what && typeof what === 'object'
              && what.accepted !== undefined && what.applied !== undefined
              && what.target_id !== undefined && what.nodes === undefined
              && what.body === undefined);
}

/** Узел по устойчивому логическому id (`nid`) — презентации хватает перебора. */
export function nodeByNid(nid) {
    if (nid === undefined || nid === null) return null;
    const key = String(nid);
    const nodes = liveNodes();
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].nid === key) return nodes[i];
    }
    return null;
}

/**
 * Точка контакта из того, что дали: событие, узел, обёртка, селектор, §9-ответ
 * или функция. `null` — точку взять неоткуда.
 */
export function resolvePoint(what) {
    if (!what) return null;
    if (typeof what === 'string') {
        const n = query(what)[0];
        return n ? { x: n.x, y: n.y } : null;
    }
    if (typeof what === 'function') return resolvePoint(what());
    const p = payloadOf(what);
    if (p && typeof p.x === 'number' && typeof p.y === 'number') {
        return { x: p.x, y: p.y };
    }
    const n = unwrapNode(what);
    return n ? { x: n.x, y: n.y } : null;
}

/**
 * Узел, которому достаётся фидбек. `pick`: `'self'` — узел, на котором
 * сработал обработчик (по умолчанию), `'other'` — второй участник контакта.
 *
 * §9-ответ адресует цель устойчивым `nid`, а не ссылкой на узел: ответ уходит в
 * JSON, и держать в нём узел нельзя.
 */
export function resolveNode(what, pick) {
    if (!what) return null;
    if (typeof what === 'string') return query(what)[0] || null;
    const p = payloadOf(what);
    if (isDamageResponse(p)) {
        return nodeByNid(p.targetNodeId !== undefined ? p.targetNodeId : p.target_id);
    }
    const is_event = p !== what;
    const emitting = unwrapNode(is_event ? what.self : (p && p.self));
    const other = unwrapNode(p && p.other);
    if (is_event || (p && (p.self !== undefined || p.other !== undefined))) {
        // Игру интересует тот, на кого подписались, а не пуля, что прилетела.
        return pick === 'other' ? (other || emitting) : (emitting || other);
    }
    return unwrapNode(what);
}

/**
 * Направление удара: от источника к цели. Сначала — вектор между узлами
 * события (он не зависит от того, в каком порядке Box2D отдал пару), затем
 * нормаль контакта, затем запасное направление.
 */
export function hitDirection(info, target, fallback) {
    const p = payloadOf(info);
    const other = unwrapNode(p && (p.other || p.self));
    if (target && other && other !== target) {
        const dx = target.x - other.x;
        const dy = target.y - other.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-6) return { x: dx / len, y: dy / len };
    }
    if (p && (Number(p.nx) || Number(p.ny))) {
        const len = Math.hypot(Number(p.nx), Number(p.ny)) || 1;
        return { x: Number(p.nx) / len, y: Number(p.ny) / len };
    }
    const f = fallback || { x: 0, y: -1 };
    return { x: f.x, y: f.y };
}

/**
 * Множители squash & stretch: `(1 - s, 1 + s * stretch)`. Горизонтальный удар
 * сжимает по X и растягивает по Y, вертикальный — наоборот.
 */
export function squashFactors(amplitude, horizontal, stretch) {
    const s = Math.max(0, Math.min(0.9, Number(amplitude) || 0));
    const k = 1 + s * (Number(stretch) || 0);
    const sq = 1 - s;
    return horizontal ? { x: sq, y: k } : { x: k, y: sq };
}

/** Огибающая squash: 0 в начале и в конце, 1 в середине — узел вернётся сам. */
export function squashEnvelope(progress) {
    const p = progress < 0 ? 0 : (progress > 1 ? 1 : progress);
    return Math.sin(Math.PI * p);
}

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

const state = {
    presets: Object.assign({}, PRESETS),
    // Активные таймлайны: squash и сдвиг узла без тела.
    tweens: [],
    // Пул эмиттеров: удара много, узлов должно быть мало.
    emitters: [],
    next_emitter: 0,
    plays: 0,
    // §21: настройки «меньше вспышек и тряски». Это НЕ выключатель боя: урон,
    // события и счётчики остаются теми же, меняется только presentation.
    // Храним здесь, а не в $.store, чтобы модуль работал и без хранилища; игра
    // может переопределить через $.hits.reduced({...}) или положить значения в
    // $.store('hits.reduced') один раз при старте.
    reduced: { flash: false, shake: false, particles: false, factor: 0.25 },
};

// `$` нужен частицам и $.world. Ставится в installHits: модуль обязан
// импортироваться без движка (юнит-тесты qjs).
let api = null;

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

export function installHits($) {
    const hits = {
        /** Задать/переопределить пресет: `$.hits.preset('punch', { hitStop: 90 })`. */
        preset(name, spec) {
            if (typeof name !== 'string' || name === '') return hits;
            state.presets[name] = Object.assign({}, state.presets[name], spec || {});
            return hits;
        },

        /** Имена пресетов. */
        presets() { return Object.keys(state.presets); },

        /**
         * Уменьшить вспышки/тряску/частицы, сохранив игровые события (§21).
         *
         * ```js
         * $.hits.reduced({ flash: true, shake: true });   // включить
         * $.hits.reduced({ factor: 0.1 });                // ещё мягче
         * $.hits.reduced();                               // прочитать настройки
         * ```
         *
         * Это presentation-only: урон, событие `damage`, счётчики и knockback
         * остаются прежними — иначе «меньше вспышек» меняло бы исход боя.
         */
        reduced(opts) {
            if (opts === undefined) return Object.assign({}, state.reduced);
            if (opts === false) { state.reduced = { flash: false, shake: false, particles: false, factor: 0.25 }; return hits; }
            if (opts === true) { state.reduced = { flash: true, shake: true, particles: true, factor: 0.25 }; return hits; }
            if (typeof opts === 'object') {
                if (opts.flash !== undefined) state.reduced.flash = !!opts.flash;
                if (opts.shake !== undefined) state.reduced.shake = !!opts.shake;
                if (opts.particles !== undefined) state.reduced.particles = !!opts.particles;
                if (opts.factor !== undefined) {
                    const k = Number(opts.factor);
                    if (Number.isFinite(k) && k > 0) state.reduced.factor = Math.min(1, k);
                }
                // Ещё один способ задать настройки — через хранилище игры:
                // так они переживут перезапуск сцены и попадут в меню настроек.
                if (opts.persist && ctx.store && typeof ctx.store.set === 'function') {
                    ctx.store.set('hits.reduced', Object.assign({}, state.reduced));
                }
            }
            return hits;
        },

        /** Прочитать настройки из $.store (если игра их туда положила). */
        reducedFromStore() {
            const stored = ctx.store && typeof ctx.store.get === 'function'
                ? ctx.store.get('hits.reduced', null) : null;
            if (stored && typeof stored === 'object') hits.reduced(stored);
            return Object.assign({}, state.reduced);
        },

        /** Текст пресета после слияния с умолчаниями — для отладки и тестов. */
        spec(name, opts) { return mergeSpec(state.presets, name, opts); },

        /**
         * Главный вызов: полный хит-фидбек по событию, узлу или точке.
         *
         * `what` — событие `hit`/`collide` (`{x, y, nx, ny, self, other}`),
         * узел, обёртка, селектор или `{x, y}`. `opts` — имя пресета или
         * объект опций (см. таблицу в docs/highlevel/hits.md).
         *
         * Возвращает `{ point, target, spec }` — что именно сработало.
         *
         * ```js
         * $('#enemy').on('hit', $.hitFx);                 // одной строкой
         * $.hits.play(info, { preset: 'crit', shake: 8 });
         * $.hits.play({ x: 120, y: 80 }, 'block');
         * ```
         */
        play(what, opts) {
            const o = typeof opts === 'string' ? { preset: opts } : opts;
            let spec = mergeSpec(state.presets, o && o.preset, o);
            const point = resolvePoint(what) || (o && o.at) || null;
            // Кому достаётся фидбек. `'self'`/`'other'` — роли в событии;
            // узел или селектор — явный адрес (так делает `$.hits.on`).
            const wanted = (o && o.target !== undefined) ? o.target : 'self';
            let target;
            if (wanted === 'self' || wanted === 'other') {
                target = resolveNode(what, wanted);
            } else {
                target = unwrapNode(typeof wanted === 'string' ? query(wanted)[0] : wanted);
            }
            if (!target) target = resolveNode(what, 'self');
            // В отчётном spec адрес остаётся ролью/селектором, а не узлом:
            // узел замкнут на детей и родителя, и JSON.stringify такого
            // объекта падал бы на циклической ссылке.
            spec.target = (typeof wanted === 'string') ? wanted
                : (wanted && wanted.nodes ? 'wrapper' : (wanted ? 'node' : 'self'));
            // §21: reduced flash/shake масштабирует ТОЛЬКО presentation.
            // Спека копируется, поэтому один и тот же объект можно играть
            // многократно и с разными настройками, не задевая пресет.
            const red = state.reduced;
            if (red && (red.flash || red.shake || red.particles)) {
                const k = Number(red.factor) > 0 ? Math.min(1, Number(red.factor)) : 0.25;
                const scaled = Object.assign({}, spec);
                if (red.flash) {
                    scaled.flash = spec.flash ? Object.assign({}, spec.flash, {
                        ms: Math.round((Number(spec.flash.ms) || 90) * k),
                    }) : null;
                    scaled.screen = spec.screen ? Object.assign({}, spec.screen, {
                        ms: Math.round((Number(spec.screen.ms) || 200) * k),
                    }) : null;
                    scaled.squash = (spec.squash || 0) * k;
                }
                if (red.shake) scaled.shake = (Number(spec.shake) || 0) * k;
                if (red.particles) {
                    scaled.particles = spec.particles ? Object.assign({}, spec.particles, {
                        amount: Math.max(1, Math.round((Number(spec.particles.amount) || 1) * k)),
                    }) : null;
                }
                spec = scaled;
            }
            const now = typeof engine.time === 'number' ? engine.time : 0;
            if (spec.cooldown > 0 && target) {
                const last = target._hitfx_at;
                if (typeof last === 'number' && (now - last) * 1000 < spec.cooldown) {
                    return { point, target, spec, skipped: true };
                }
                target._hitfx_at = now;
            }

            if (point) spawnBurst(point, spec);
            const dir = (o && o.dir) ? o.dir : (target ? hitDirection(what, target) : null);
            if (target) {
                if (spec.flash) flashNode(target, packColor(spec.flash.color || '#ffffff'),
                                          Number(spec.flash.ms) || 90);
                if (spec.squash > 0) squashNode(target, {
                    amount: spec.squash, ms: spec.squashMs, dir,
                });
                if (spec.knockback) knockbackNode(target, { force: spec.knockback, dir });
            }
            if (spec.screen && ctx.fx && ctx.fx.flash) {
                ctx.fx.flash(spec.screen.color || '#ffffff', spec.screen);
            }
            if (spec.shake > 0 && ctx.camera && ctx.camera.shake) {
                ctx.camera.shake(spec.shake, spec.shakeMs);
            }
            if (spec.sound && ctx.sound && typeof ctx.sound.play === 'function') {
                try { ctx.sound.play(spec.sound); } catch (e) { /* звука нет — не повод падать */ }
            }
            // Заморозка — последней: всё, что выше, уже поставлено и переживёт
            // остановку игрового времени (VFX и камера тикают на реальном dt).
            if (spec.slow > 0 && ctx.time && ctx.time.slow) ctx.time.slow(spec.slow, spec.slowScale);
            else if (spec.hitStop > 0 && ctx.time && ctx.time.freeze) ctx.time.freeze(spec.hitStop);
            state.plays++;
            return { point, target, spec };
        },

        /**
         * Подписать узлы одним вызовом: `$.hits.on('.enemy', 'crit')`.
         * Возвращает число подписанных узлов; повторный вызов добавит вторую
         * подписку — держите его вне кадрового цикла.
         */
        on(selector, opts) {
            const o = typeof opts === 'string' ? { preset: opts } : (opts || {});
            const event = o.event || 'hit';
            const nodes = query(selector);
            for (let i = 0; i < nodes.length; i++) {
                // Цель — сам узел события (`self`): обработчик подписан на нём,
                // поэтому подставлять узел руками не нужно.
                nodes[i].on(event, (info) => { hits.play(info, o); });
            }
            return nodes.length;
        },

        /** Squash & stretch узла: `$.hits.squash('#boss', { amount: 0.3 })`. */
        squash(what, opts) {
            const node = resolveNode(what, 'other');
            return node ? squashNode(node, opts) : null;
        },

        /** Отдача узла по направлению: импульс телу или сдвиг без тела. */
        knockback(what, opts) {
            const node = resolveNode(what, 'other');
            return node ? knockbackNode(node, opts) : null;
        },

        /** Вспышка тона на узле (обёртка над `.flash()`). */
        flash(what, color, ms) {
            const node = resolveNode(what, 'other');
            if (!node) return null;
            flashNode(node, packColor(color || '#ffffff'), Number(ms) || 90);
            return node;
        },

        /** Сколько фидбеков сыграно и сколько таймлайнов живо — для отладки. */
        stats() {
            return { plays: state.plays, tweens: state.tweens.length, emitters: state.emitters.length };
        },

        /** Снять активные squash/отдачу (не трогает пресеты и пул). */
        clear() {
            state.tweens.length = 0;
            for (const e of state.emitters) {
                if (e && typeof e.stop === 'function') e.stop();
                if (e && typeof e.clear === 'function') e.clear();
            }
            return hits;
        },

        _state: state,
    };

    ctx.hits = hits;
    $.hits = hits;
    api = $;
    // Быстрый алиас для подписки: `$('#enemy').on('hit', $.hitFx)`.
    $.hitFx = function (what, opts) { return hits.play(what, opts); };

    // --- Методы узла -------------------------------------------------------
    def('squash', function (opts) {
        return eachNodeOf(this, (node) => squashNode(node, opts));
    });
    def('knockback', function (opts) {
        return eachNodeOf(this, (node) => knockbackNode(node, opts));
    });
    return hits;
}

// ---------------------------------------------------------------------------
// Эффекты
// ---------------------------------------------------------------------------

function eachNodeOf(wrapper, fn) {
    if (wrapper && typeof wrapper.eachNode === 'function') {
        wrapper.eachNode((_, node) => fn(node));
        return wrapper;
    }
    const list = (wrapper && wrapper.nodes) || [];
    for (let i = 0; i < list.length; i++) fn(list[i]);
    return wrapper;
}

/**
 * Squash & stretch: узел сжимается по направлению удара и растягивается
 * поперёк, затем возвращается к прежним масштабам. Базовый масштаб
 * запоминается и восстанавливается точно, поэтому повторные удары не
 * «накапливают» деформацию.
 */
export function squashNode(node, opts) {
    if (!node) return null;
    const o = Object.assign({ amount: 0.25, ms: 180, stretch: 0.55, dir: null }, opts);
    const base_x = Number(node.scale_x);
    const base_y = Number(node.scale_y);
    const dir = o.dir || { x: 0, y: -1 };
    const horizontal = Math.abs(Number(dir.x) || 0) >= Math.abs(Number(dir.y) || 0);
    const timeline = {
        node, kind: 'squash', t: 0, ms: Math.max(1, Number(o.ms) || 180),
        base_x: Number.isFinite(base_x) ? base_x : 1,
        base_y: Number.isFinite(base_y) ? base_y : 1,
        amount: o.amount, stretch: o.stretch, horizontal,
    };
    state.tweens.push(timeline);
    return timeline;
}

/**
 * Отдача: телу Box2D — импульс (`applyImpulse`), узлу без тела — сдвиг на
 * `force * 0.06` пикселей по направлению удара с затуханием. Импульс отдаёт
 * Box2D, поэтому «отпружинивание» остаётся делом физики.
 */
export function knockbackNode(node, opts) {
    if (!node) return null;
    const o = Object.assign({ force: 200, dir: null, ms: 160 }, opts);
    const dir = o.dir || { x: 0, y: -1 };
    const force = Number(o.force) || 0;
    if (!force) return null;
    if (node.body >= 0) {
        engine.applyImpulse(node.body, dir.x * force, dir.y * force);
        return { node, kind: 'impulse', force };
    }
    const dist = force * 0.06;
    const timeline = {
        node, kind: 'push', t: 0, ms: Math.max(1, Number(o.ms) || 160),
        dx: dir.x * dist, dy: dir.y * dist, moved: { x: 0, y: 0 },
    };
    state.tweens.push(timeline);
    return timeline;
}

// ---------------------------------------------------------------------------
// Частицы
// ---------------------------------------------------------------------------

/**
 * Залп частиц в точке. Эмиттеры берутся из пула (кольцо на 8 штук): удар
 * случается часто, а создавать узел на каждый удар — это мусор в реестре и
 * лишние проходы кадра.
 */
function spawnBurst(point, spec) {
    const $ = api;
    const particles = $ && $.particles;
    if (!$ || typeof $ !== 'function' || !particles || !point) return false;
    const p = spec.particles;
    if (!p || p === false) return false;
    const base = particles.preset ? particles.preset(p.preset, null) : {};
    const emitter_spec = Object.assign({}, base, p, {
        one_shot: true,
        emitting: false,
        local: false,
        amount: Math.max(1, Math.floor(Number(p.amount) || 12)),
        max_particles: Math.max(1, Math.floor(Number(p.max_particles) || 48)),
    });
    const slot = state.next_emitter++ % 8;
    let handle = state.emitters[slot];
    if (!handle) {
        const created = $('<particles>', Object.assign({}, emitter_spec, { id: `__hitfx_${slot}` }));
        if (!created || typeof created.appendTo !== 'function') return false;
        created.appendTo($.world);
        handle = created;
        state.emitters[slot] = handle;
    } else if (typeof handle.params === 'function') {
        handle.params(emitter_spec);
    }
    if (typeof handle.at === 'function') handle.at(point.x, point.y);
    if (typeof handle.restart === 'function') handle.restart();
    else if (typeof handle.burst === 'function') handle.burst(emitter_spec.amount);
    return true;
}

// ---------------------------------------------------------------------------
// Кадр
// ---------------------------------------------------------------------------

/**
 * Шаг таймлайнов хит-фидбека. Вызывается из `tickFx` (fx.js) — модуль не
 * занимает строчку в api.js.
 *
 * Деформация и отдача идут ИГРОВЫМ временем: на заморозке удара они обязаны
 * стоять вместе с миром, иначе squash «переживёт» hit-stop и удар потеряет
 * вес. Частицы и вспышки живут на реальном времени — их тикают particles.js
 * и fx.js.
 */
export function tickHits(dt) {
    if (state.tweens.length === 0) return;
    const raw = Number(dt) || 0;
    const game = (ctx.time && typeof ctx.time.delta === 'function') ? ctx.time.delta() : raw;
    if (!(game > 0)) return;
    for (let i = state.tweens.length - 1; i >= 0; i--) {
        const tw = state.tweens[i];
        tw.t += game * 1000;
        const progress = tw.ms > 0 ? Math.min(1, tw.t / tw.ms) : 1;
        if (tw.kind === 'squash') {
            const env = squashEnvelope(progress) * (tw.amount || 0);
            const f = squashFactors(env, tw.horizontal, tw.stretch);
            tw.node.scale_x = tw.base_x * f.x;
            tw.node.scale_y = tw.base_y * f.y;
        } else if (tw.kind === 'push') {
            // Сдвиг накапливается: конец ровно в dx/dy, деформации нет.
            const k = 1 - (1 - progress) * (1 - progress);
            const want_x = tw.dx * k;
            const want_y = tw.dy * k;
            tw.node.x += want_x - tw.moved.x;
            tw.node.y += want_y - tw.moved.y;
            tw.moved.x = want_x;
            tw.moved.y = want_y;
        }
        if (progress >= 1) {
            if (tw.kind === 'squash') {
                tw.node.scale_x = tw.base_x;
                tw.node.scale_y = tw.base_y;
            }
            state.tweens.splice(i, 1);
        }
    }
}

// ---------------------------------------------------------------------------
// Служебное
// ---------------------------------------------------------------------------

/**
 * Убрать хит-фидбек при смене сцены: таймлайны снимаются, эмиттеры чистой
 * водой останавливаются. Пул узлов остаётся — он переиспользуется.
 */
export function resetHits() {
    state.tweens.length = 0;
    for (const e of state.emitters) {
        if (e && typeof e.stop === 'function') e.stop();
        if (e && typeof e.clear === 'function') e.clear();
    }
}

export const hitsPresets = PRESETS;
export const hitsState = state;
