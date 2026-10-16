// ===========================================================================
// Клипы анимации — $.clip (пункт H11 отчёта BASHNYA)
//
// Зачем: движок принимал только линейный индекс кадра на ОДНОМ листе, поэтому
// игра собирала клипы сама — резала регионы, следила за fps, повторами и
// пивотом, а клип с кадрами на двух листах приходилось склеивать в один лист
// (у BASHNYA это `data.js:27-120`). Клип делает это ресурсом:
//
//   $.clip.define('walk', {
//       frames: [{ src: 'art/hero.png', x: 0, y: 0, w: 32, h: 48 },
//                { src: 'art/hero_extra.png', x: 64, y: 0, w: 32, h: 48 }],
//       fps: 12, loop: true, pivot: [0.5, 1],
//   });
//   $('#hero').animate({ clip: 'walk' });   // или .animate('walk')
//
// Кадры могут быть на РАЗНЫХ листах: регион разрешается в спрайт и кладётся в
// массив кадров — движку всё равно, откуда кадр.
//
// Пивот клипа двигает только точку вращения (как `.pivot()`), размер узла НЕ
// меняется: граница с пунктом H10 (`.frames()` перезаписывает размер) остаётся
// прежней, `fit: true` сознательно не делаем.
// ===========================================================================

import { ctx, regionSprite, resolveSprite } from './core.js';

const clips = new Map();

/** Кадр клипа: спрайт-число или регион { src, x, y, w, h }. */
function clipFrame(value) {
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object') {
        if (typeof value.sprite === 'number') return value.sprite;
        if (value.src) {
            return regionSprite(value.src, Number(value.x) || 0, Number(value.y) || 0,
                                Number(value.w) || 0, Number(value.h) || 0);
        }
    }
    return -1;
}

function clipPivot(value) {
    if (Array.isArray(value)) return [Number(value[0]), Number(value[1])];
    if (value && typeof value === 'object') return [Number(value.x), Number(value.y)];
    return null;
}

/**
 * Подсистема `$.clip`: именованные клипы анимации.
 */
export function installClip($) {
    const api = {
        /**
         * Объявить клип: `$.clip.define('walk', { frames, fps, loop, pivot })`.
         *
         * `frames` — массив спрайтов (числа) или регионов `{src,x,y,w,h}`;
         * регионы могут быть с РАЗНЫХ листов. `fps` — кадров в секунду (12 по
         * умолчанию), `loop` — повторять ли (да), `pivot` — точка вращения в
         * долях кадра (`[0.5, 1]` — «ноги»), размер узла не меняет.
         */
        define(name, spec) {
            const id = String(name);
            const o = spec && typeof spec === 'object' ? spec : {};
            const list = Array.isArray(o.frames) ? o.frames : [];
            if (!list.length) {
                ctx.log(`$.clip.define("${id}"): нужен непустой frames (спрайты или регионы)`);
                return null;
            }
            const frames = list.map(clipFrame).filter((id2) => id2 >= 0);
            if (!frames.length) {
                ctx.log(`$.clip.define("${id}"): ни один кадр не разрешился в спрайт`);
                return null;
            }
            const fps = Number(o.fps);
            // Обработчики клипа — САХАР над событиями узла: при применении клипа
            // они подписываются на `anim:end`/`anim:frame` того же узла. Второго
            // механизма «клип доиграл» не заводим: два пути разъедутся.
            const handlers = {
                end: typeof o.onEnd === 'function' ? o.onEnd : null,
                frame: typeof o.onFrame === 'function' ? o.onFrame : null,
            };
            const clip = {
                name: id,
                frames: frames,
                fps: Number.isFinite(fps) && fps > 0 ? fps : 12,
                loop: o.loop !== false,
                pivot: clipPivot(o.pivot),
                duration: frames.length / (Number.isFinite(fps) && fps > 0 ? fps : 12),
                skipped: list.length - frames.length,
                onEnd: handlers.end,
                onFrame: handlers.frame,
            };
            clips.set(id, clip);
            return clip;
        },

        /** Описание клипа (копия) или null. */
        get(name) {
            const clip = clips.get(String(name));
            if (!clip) return null;
            return Object.assign({}, clip, { frames: clip.frames.slice(),
                                             pivot: clip.pivot ? clip.pivot.slice() : null });
        },

        /** Имена клипов. */
        list() { return [...clips.keys()].sort(); },

        /** Убрать клип: `true`, если он был. */
        remove(name) { return clips.delete(String(name)); },

        /** Внутреннее: клип как есть (для `.animate`), без копий. */
        _raw(name) { return clips.get(String(name)) || null; },
    };
    ctx._clip = api;
    $.clip = api;
    return api;
}
