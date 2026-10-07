// ===========================================================================
// Атласы: импорт спрайтовых листов из JSON — $.atlas
//
// Зачем. До этого лист резался только равномерной сеткой (`cols × rows × cw ×
// ch`): если художник отдал атлас с разными прямоугольниками, кадры приходилось
// вырезать руками по одному. Здесь данные атласа читаются как есть.
//
// Поддерживаются три распространённых формата (по содержимому, не по имени):
//   * Aseprite (Export Sprite Sheet → JSON): `frames` + `meta.frameTags`;
//   * TexturePacker / LibGDX: `frames[].frame{x,y,w,h}` + `filename`;
//   * простой свой: `frames` — объект «имя → {x,y,w,h}» без обёрток.
//
//   const sheet = $.atlas.load('art/hero.json');
//   $('#hero').sprite(sheet.frame('idle_0'));
//   $.anim.clip('idle', { frames: sheet.tag('idle') });   // массив имён кадров
//
// Модуль ничего не грузит сам: JSON читается движком (`$.fs.readJSON`) или
// передаётся объектом — поэтому всё ядро проверяется юнит-тестом без движка.
// ===========================================================================

import { ctx } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть: разбор и классификация
// ---------------------------------------------------------------------------

/** Кадр атласа в едином виде. */
export function normalizeFrame(name, raw) {
    if (!raw) return null;
    // Aseprite: { frame: {x,y,w,h}, ... }
    const box = raw.frame && typeof raw.frame === 'object' ? raw.frame : raw;
    const x = Number(box.x);
    const y = Number(box.y);
    const w = Number(box.w !== undefined ? box.w : box.width);
    const h = Number(box.h !== undefined ? box.h : box.height);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    return {
        name: String(name !== undefined && name !== null ? name : (raw.filename || '')),
        x, y, w, h,
        // Длительность кадра в мс (Aseprite кладёт её у кадров тегов).
        duration: Number(raw.duration) > 0 ? Number(raw.duration) : 0,
        rotated: !!box.rotated || !!raw.rotated,
        trimmed: !!raw.trimmed,
    };
}

/**
 * Разбирает данные атласа в { frames, tags, meta }.
 * Формат определяется по содержимому: массив/объект `frames` и наличие тегов.
 */
export function parseAtlas(data) {
    const out = { frames: [], tags: {}, meta: {}, format: 'unknown' };
    if (!data || typeof data !== 'object') return out;

    const raw_frames = data.frames;
    if (Array.isArray(raw_frames)) {
        // TexturePacker / LibGDX: массив с filename.
        out.format = 'array';
        for (const entry of raw_frames) {
            const frame = normalizeFrame(entry && entry.filename, entry);
            if (frame) out.frames.push(frame);
        }
    } else if (raw_frames && typeof raw_frames === 'object') {
        // Aseprite (объект) или простой свой формат.
        out.format = data.meta ? 'aseprite' : 'map';
        for (const name of Object.keys(raw_frames)) {
            const frame = normalizeFrame(name, raw_frames[name]);
            if (frame) out.frames.push(frame);
        }
    }

    // Теги Aseprite: имя → кадры в порядке листа.
    const tags = data.meta && Array.isArray(data.meta.frameTags) ? data.meta.frameTags : null;
    if (tags) {
        for (const tag of tags) {
            const name = String((tag && tag.name) || '').trim();
            if (!name) continue;
            const from = Number(tag.from);
            const to = Number(tag.to);
            if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
            const list = [];
            const lo = Math.min(from, to);
            const hi = Math.max(from, to);
            // frameTags ссылаются на НОМЕРА кадров (по порядку листа), а не на
            // имена: собираем по индексам уже разобранных кадров.
            for (let i = lo; i <= hi && i < out.frames.length; ++i) list.push(out.frames[i].name);
            if (tag.direction === 'reverse') list.reverse();
            out.tags[name] = list;
        }
        if (data.meta.size) out.meta.size = { w: Number(data.meta.size.w), h: Number(data.meta.size.h) };
        if (data.meta.image) out.meta.image = String(data.meta.image);
        if (data.meta.scale !== undefined) out.meta.scale = String(data.meta.scale);
    }

    // Слайсы Aseprite: у каждого ключа прямоугольник и ПИВОТ. Пивот в JSON
    // задан в координатах спрайта, поэтому храним и абсолютный, и локальный
    // (от левого верхнего угла слайса) — второй нужен для вращения части.
    const slices = data.meta && Array.isArray(data.meta.slices) ? data.meta.slices : null;
    if (slices) {
        out.slices = {};
        for (const slice of slices) {
            const name = String((slice && slice.name) || '').trim();
            if (!name) continue;
            const keys = Array.isArray(slice.keys) ? slice.keys : [];
            const list = [];
            for (const key of keys) {
                const b = key && key.bounds;
                if (!b) continue;
                const w = Number(b.w);
                const h = Number(b.h);
                if (!(w > 0) || !(h > 0)) continue;
                const x = Number(b.x) || 0;
                const y = Number(b.y) || 0;
                const pv = key.pivot || {};
                const px = Number.isFinite(Number(pv.x)) ? Number(pv.x) : x + w / 2;
                const py = Number.isFinite(Number(pv.y)) ? Number(pv.y) : y + h / 2;
                list.push({
                    frame: Number(key.frame) || 0,
                    x, y, w, h,
                    pivotX: px, pivotY: py,
                    // Локальный пивот: сколько пикселей от левого верхнего угла.
                    pivotLx: px - x, pivotLy: py - y,
                });
            }
            if (list.length) {
                list.sort((a, b) => a.frame - b.frame);
                out.slices[name] = list;
            }
        }
    }

    // Свой формат может нести теги отдельным полем.
    if (!tags && data.tags && typeof data.tags === 'object') {
        for (const name of Object.keys(data.tags)) {
            const value = data.tags[name];
            if (Array.isArray(value)) out.tags[String(name)] = value.map(String);
        }
    }

    out.meta.image = out.meta.image || (typeof data.image === 'string' ? data.image : null);
    return out;
}

/** Имя файла картинки для атласа: из данных или рядом с JSON. */
export function atlasImagePath(json_path, data) {
    const meta = data && data.meta && data.meta.image ? data.meta.image : null;
    const image = meta || (data && typeof data.image === 'string' ? data.image : null);
    if (image) {
        // Путь в данных относительный: считаем от каталога JSON.
        if (/^([a-z]+:)?\//i.test(image)) return image;
        const dir = String(json_path || '').replace(/[^/]*$/, '');
        return dir + image;
    }
    return String(json_path || '').replace(/\.[^.]+$/, '.png');
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

/** Загруженный атлас: кадры-спрайты по имени, теги, картинка. */
function buildSheet(name, spec, data, json_path) {
    const parsed = parseAtlas(data);
    if (!parsed.frames.length) {
        ctx.log(`$.atlas.load("${name}"): в данных нет кадров — проверьте поле frames`);
        return null;
    }
    const image = spec.src || spec.image || atlasImagePath(json_path, data);
    const texture = engine.loadTexture(image);
    if (!(texture >= 0)) {
        ctx.log(`$.atlas.load("${name}"): не удалось загрузить картинку "${image}"`);
        return null;
    }

    const sprites = {};
    for (const frame of parsed.frames) {
        if (frame.rotated) {
            ctx.log(`$.atlas.load("${name}"): кадр "${frame.name}" повёрнут в атласе — `
                  + 'такие не поддержаны, выгрузите без поворота');
            continue;
        }
        sprites[frame.name] = engine.createSprite(texture, frame.x, frame.y, frame.w, frame.h);
    }

    const sheet = {
        name,
        image,
        texture,
        format: parsed.format,
        meta: parsed.meta,

        /** Спрайт кадра по имени; -1, если такого кадра нет. */
        frame(frame_name) {
            const sprite = sprites[String(frame_name)];
            return sprite === undefined ? -1 : sprite;
        },

        /** Имена кадров по порядку атласа. */
        frames() { return parsed.frames.map((f) => f.name); },

        /** Кадр целиком: { name, x, y, w, h, duration }. */
        info(frame_name) {
            return parsed.frames.find((f) => f.name === String(frame_name)) || null;
        },

        /** Имена кадров тега (или пустой массив). */
        tag(tag_name) {
            const list = parsed.tags[String(tag_name)];
            return list ? list.slice() : [];
        },

        /** Имена тегов. */
        tags() { return Object.keys(parsed.tags); },

        /** Имена слайсов Aseprite (или пустой массив). */
        sliceNames() { return Object.keys(parsed.slices || {}); },

        /**
         * Слайс Aseprite: `{ frame, x, y, w, h, pivotX, pivotY, pivotLx, pivotLy }`.
         *
         * `frame` — номер кадра в листе (не имя). Без него берётся первый ключ.
         * Слайс — это то, где Aseprite хранит ПИВОТ и рамку части.
         * `null`, если слайса нет.
         */
        slice(slice_name, frame) {
            const list = (parsed.slices || {})[String(slice_name)];
            if (!list || !list.length) return null;
            if (frame === undefined || frame === null) return { ...list[0] };
            const f = Number(frame);
            let best = list[0];
            for (const k of list) {
                if (k.frame <= f) best = k;
                else break;
            }
            return { ...best };
        },

        /** Сколько ключей у слайса (по кадрам). */
        sliceCount(slice_name) {
            const list = (parsed.slices || {})[String(slice_name)];
            return list ? list.length : 0;
        },

        /** Массив спрайтов тега — готовый вход для `$.anim.clip`. */
        tagSprites(tag_name) {
            return sheet.tag(tag_name).map((frame_name) => sheet.frame(frame_name));
        },

        /** Длительность кадра тега в мс (0 — брать из клипа). */
        tagInterval(tag_name) {
            const list = sheet.tag(tag_name);
            if (!list.length) return 0;
            const info = sheet.info(list[0]);
            return info && info.duration ? info.duration : 0;
        },

        /** Размер картинки атласа: [ширина, высота]. */
        size() { return engine.textureSize(texture); },
    };
    return sheet;
}

export function installAtlas($) {
    const loaded = new Map();

    const atlas = {
        /**
         * Загрузить атлас: `$.atlas.load('hero', 'art/hero.json')`. Путь к
         * картинке берётся из данных (`meta.image`), его можно перебить
         * `spec.src`. Без второго аргумента используется уже прочитанный
         * `spec.data` — удобно, когда JSON пришёл по сети.
         */
        load(name, path, spec) {
            const key = String(name);
            if (loaded.has(key)) return loaded.get(key);
            let opts = spec || {};
            let json_path = path;
            if (typeof path === 'object' && path !== null) {
                opts = path;
                json_path = opts.path;
            }

            let data = opts.data;
            if (!data) {
                if (!json_path) {
                    ctx.log('$.atlas.load: нужен путь к JSON или spec.data');
                    return null;
                }
                const fs = $.fs || ctx.fs;
                if (!fs || typeof fs.readJSON !== 'function') {
                    ctx.log('$.atlas.load: нет $.fs — передайте spec.data с данными атласа');
                    return null;
                }
                data = fs.readJSON(json_path, null);
                if (!data) {
                    ctx.log(`$.atlas.load("${key}"): не удалось прочитать "${json_path}"`);
                    return null;
                }
            }

            const sheet = buildSheet(key, opts, data, json_path);
            if (!sheet) return null;
            loaded.set(key, sheet);
            return sheet;
        },

        /** Загруженный атлас по имени (или null). */
        get(name) { return loaded.get(String(name)) || null; },

        /** Имена загруженных атласов. */
        names() { return [...loaded.keys()]; },

        /** Забыть атлас (спрайты остаются у движка — их выгружает freeTexture). */
        unload(name) { return loaded.delete(String(name)); },

        /** Разобрать данные без загрузки — для отладки и тестов. */
        parse(data) { return parseAtlas(data); },

        /** Путь к картинке атласа по данным и пути JSON. */
        imagePath(json_path, data) { return atlasImagePath(json_path, data); },
    };

    $.atlas = atlas;
    return atlas;
}
