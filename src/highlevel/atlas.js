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

import { engine } from './native.js';
import { ctx } from './core.js';

const sprite_metadata = new Map();

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
        // Мультистраничный атлас: кадр знает свою страницу (индекс или имя).
        page: raw.page === undefined ? null : raw.page,
    };
}

/**
 * Разбирает данные атласа в { frames, tags, meta }.
 * Формат определяется по содержимому: массив/объект `frames` и наличие тегов.
 */
export function parseAtlas(data) {
    const out = { frames: [], tags: {}, meta: {}, format: 'unknown',
                  // Диагностика данных: что молча пропало и что объявлено дважды.
                  invalid_frames: [], duplicate_frames: [], duplicate_tags: [] };
    if (!data || typeof data !== 'object') return out;

    const seen = new Set();
    const pushFrame = (frame, fallback_name) => {
        if (!frame) {
            out.invalid_frames.push(String(fallback_name));
            return;
        }
        if (seen.has(frame.name)) out.duplicate_frames.push(frame.name);
        seen.add(frame.name);
        out.frames.push(frame);
    };

    const raw_frames = data.frames;
    if (Array.isArray(raw_frames)) {
        // TexturePacker / LibGDX: массив с filename.
        out.format = 'array';
        for (let i = 0; i < raw_frames.length; i++) {
            const entry = raw_frames[i];
            const name = entry && entry.filename !== undefined ? entry.filename : ('#' + i);
            pushFrame(normalizeFrame(name, entry), name);
        }
    } else if (raw_frames && typeof raw_frames === 'object') {
        // Aseprite (объект) или простой свой формат.
        out.format = data.meta ? 'aseprite' : 'map';
        for (const name of Object.keys(raw_frames)) {
            pushFrame(normalizeFrame(name, raw_frames[name]), name);
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
            // Одно имя дважды: побеждает последнее объявление — но это факт,
            // о котором обязан узнать вызывающий (§45: duplicate tag).
            if (out.tags[name] !== undefined) out.duplicate_tags.push(name);
            out.tags[name] = list;
        }
    }
    // Размер страницы, картинка и масштаб читаются и БЕЗ frameTags: они есть у
    // любого экспорта (TexturePacker/LibGDX тоже), а проверка кадров на выход
    // за страницу без meta.size невозможна.
    if (data.meta) {
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

    // Свой формат может нести теги отдельным полем. Обрабатываем его и при
    // наличии frameTags: у наборов разные имена, и терять пользовательский тег
    // из-за одного служебного поля нельзя.
    if (data.tags && typeof data.tags === 'object') {
        for (const name of Object.keys(data.tags)) {
            if (out.tags[name] !== undefined) continue;
            const value = data.tags[name];
            if (Array.isArray(value)) out.tags[String(name)] = value.map(String);
        }
    }

    out.meta.image = out.meta.image || (typeof data.image === 'string' ? data.image : null);

    // --- Политика упаковки: страницы, padding и extrusion -------------------
    // Мультистраничный атлас: `meta.pages` — список страниц (путь или
    // {image}), а кадр несёт `page`. Без pages страница одна (meta.image).
    const raw_pages = data.meta && Array.isArray(data.meta.pages) ? data.meta.pages
        : (Array.isArray(data.pages) ? data.pages : null);
    if (raw_pages) {
        out.meta.pages = raw_pages.map((page, i) => {
            if (typeof page === 'string') return { index: i, image: page, name: 'page' + i };
            const p = page || {};
            return {
                index: i,
                name: String(p.name === undefined ? 'page' + i : p.name),
                image: typeof p.image === 'string' ? p.image : null,
            };
        });
    } else {
        out.meta.pages = [{ index: 0, name: 'page0', image: out.meta.image }];
    }
    for (const frame of out.frames) {
        if (frame.page === null) frame.page = 0;
        else if (typeof frame.page === 'string') {
            const idx = out.meta.pages.findIndex((p) => p.name === frame.page);
            frame.page = idx < 0 ? 0 : idx;
        } else {
            frame.page = Math.max(0, Number(frame.page) | 0);
        }
    }

    // padding/extrusion — политика упаковщика; читается инструментами и
    // проверкой качества (см. verifyAtlas), сам рендер её не пересчитывает.
    if (data.meta) {
        if (data.meta.padding !== undefined) out.meta.padding = Number(data.meta.padding) || 0;
        if (data.meta.extrusion !== undefined) out.meta.extrusion = Number(data.meta.extrusion) || 0;
        if (data.meta.materialPages && typeof data.meta.materialPages === 'object') {
            out.meta.materialPages = data.meta.materialPages;
        }
        // Import manifest: content hash, версия импортёра, настройки, зависимости.
        if (data.meta.import && typeof data.meta.import === 'object') {
            const im = data.meta.import;
            out.meta.import = {
                version: im.version === undefined ? null : Number(im.version),
                importer: im.importer === undefined ? null : String(im.importer),
                contentHash: im.contentHash === undefined ? (im.hash === undefined ? null : String(im.hash))
                                                          : String(im.contentHash),
                settings: im.settings && typeof im.settings === 'object' ? im.settings : {},
                dependencies: Array.isArray(im.dependencies) ? im.dependencies.map(String) : [],
            };
        }
    }

    // Повёрнутые кадры — отдельным списком: молча пропускать часть кадров
    // production-клипа нельзя (см. buildSheet и verifyAtlas).
    out.rotated = out.frames.filter((f) => f.rotated).map((f) => f.name);
    return out;
}

// ---------------------------------------------------------------------------
// Ошибки атласа: структурированно
//
// Раньше описание проблемы жило только строкой в журнале: игра не могла
// отличить «нет картинки» от «нет кадров», а тест — проверить причину.
// Теперь каждая ошибка идёт и в $.debug.reportError (код/подсистема/путь), и в
// кольцо $.atlas.errors() — второе работает и без движка, в qjs-тестах.
// ---------------------------------------------------------------------------
const atlas_errors = [];
let atlas_dollar = null;      // ставится installAtlas: нужен $.debug.reportError

/** Запись диагностики атласа: кольцо ошибок + $.debug.reportError. */
function atlasReport(where, code, message, extra) {
    const entry = Object.assign({ code, message, where }, extra || {});
    atlas_errors.push(entry);
    if (atlas_errors.length > 64) atlas_errors.shift();
    const opts = Object.assign({ code, subsystem: 'atlas', fatal: false }, extra || {});
    // $.debug.reportError передаёт код/подсистему/пути в журнал диагностики.
    // ctx.reportError — запасной путь: он старее и третьего аргумента не знает.
    if (atlas_dollar && atlas_dollar.debug && typeof atlas_dollar.debug.reportError === 'function') {
        atlas_dollar.debug.reportError(where, new Error(message), opts);
    } else if (typeof ctx.reportError === 'function') {
        ctx.reportError(where, new Error(message), opts);
    } else {
        ctx.log('$.atlas (' + code + '): ' + message);
    }
    return null;
}

function atlasFail(where, code, message, extra) {
    atlasReport(where, code, message, extra);
    return null;
}

/**
 * Проверка данных атласа без загрузки: кадры, страницы, padding, теги,
 * манифест импорта. Чистая функция — годится и SDK-инструменту, и тесту.
 * Возвращает { ok, errors, warnings, frames, pages, format }.
 */
export function verifyAtlas(data, opts) {
    const o = opts || {};
    const parsed = parseAtlas(data);
    const errors = [];
    const warnings = [];
    const frames = parsed.frames;
    const pages = parsed.meta.pages || [];

    if (!frames.length) {
        errors.push({ code: 'atlas_no_frames', message: 'в данных атласа нет кадров' });
    }
    // Кадр без прямоугольника раньше просто исчезал: в листе его нет, а игра
    // узнавала об этом только по «нет кадра». Теперь это названо.
    for (const name of parsed.invalid_frames || []) {
        errors.push({ code: 'atlas_frame_invalid',
                      message: 'кадр "' + name + '" пропущен: нет прямоугольника x/y/w/h',
                      frame: name });
    }
    // Одно имя дважды — спрайты перекрыли бы друг друга (виден только последний).
    for (const name of parsed.duplicate_frames || []) {
        errors.push({ code: 'atlas_duplicate_frame',
                      message: 'кадр "' + name + '" объявлен дважды — остался бы только последний',
                      frame: name });
    }
    // Тег-дубликат: берётся последнее объявление, но это предупреждение, а не тишина.
    for (const name of parsed.duplicate_tags || []) {
        warnings.push({ code: 'atlas_duplicate_tag',
                        message: 'тег "' + name + '" объявлен дважды — взят последний' });
    }
    for (const name of parsed.rotated) {
        errors.push({ code: 'atlas_rotated_frame',
                      message: 'кадр "' + name + '" повёрнут в атласе',
                      frame: name });
    }

    const size = parsed.meta.size;
    if (size && size.w > 0 && size.h > 0) {
        for (const f of frames) {
            if (f.x < 0 || f.y < 0 || f.x + f.w > size.w || f.y + f.h > size.h) {
                errors.push({ code: 'atlas_frame_out_of_page',
                              message: 'кадр "' + f.name + '" выходит за страницу '
                                  + size.w + '×' + size.h,
                              frame: f.name });
            }
            if (f.page >= pages.length) {
                errors.push({ code: 'atlas_frame_page_missing',
                              message: 'у кадра "' + f.name + '" нет страницы ' + f.page,
                              frame: f.name });
            }
        }
        for (const page of pages) {
            if (!page.image) {
                errors.push({ code: 'atlas_page_no_image',
                              message: 'у страницы "' + page.name + '" не указан файл' });
            }
        }
    }

    // Перекрытия и padding: перекрытие — ошибка упаковки, слишком маленький
    // зазор — предупреждение (при linear-фильтрации и мипмапах сосед может
    // «протечь»; политика — padding/extrusion в упаковщике).
    const padding = parsed.meta.padding === undefined ? 0 : parsed.meta.padding;
    for (let i = 0; i < frames.length; i++) {
        for (let j = i + 1; j < frames.length; j++) {
            const a = frames[i], b = frames[j];
            if (a.page !== b.page) continue;
            const gap_x = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
            const gap_y = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
            if (gap_x < 0 && gap_y < 0) {
                errors.push({ code: 'atlas_frames_overlap',
                              message: 'кадры "' + a.name + '" и "' + b.name + '" перекрываются',
                              frames: [a.name, b.name] });
            } else {
                const want = Math.max(1, padding);
                if (gap_x < want && gap_y < want) {
                    warnings.push({ code: padding > 0 ? 'atlas_padding_small' : 'atlas_no_padding',
                                    message: 'кадры "' + a.name + '" и "' + b.name
                                        + '" стоят вплотную (padding ' + padding
                                        + ') — при linear-фильтрации и мипмапах возможна протечка',
                                    frames: [a.name, b.name] });
                }
            }
        }
    }

    if (frames.length && frames.every((f) => !f.duration)) {
        warnings.push({ code: 'atlas_no_durations',
                        message: 'ни у одного кадра нет длительности' });
    }

    // Power-of-two: не обязательна для современных GPU, но удобна для
    // стриминга и старых бэкендов — предупреждаем, а не запрещаем.
    const pot = (v) => v > 0 && (v & (v - 1)) === 0;
    if (size && size.w > 0 && size.h > 0 && !(pot(size.w) && pot(size.h))) {
        warnings.push({ code: 'atlas_page_not_pot',
                        message: 'страница ' + size.w + '×' + size.h
                            + ' не степень двойки (padding/PoT-политика упаковщика)' });
    }

    for (const tag of Object.keys(parsed.tags)) {
        for (const frame_name of parsed.tags[tag]) {
            if (!frames.some((f) => f.name === frame_name)) {
                errors.push({ code: 'atlas_tag_frame_missing',
                              message: 'тег "' + tag + '" ссылается на несуществующий кадр "'
                                  + frame_name + '"' });
            }
        }
    }

    const manifest = parsed.meta.import;
    if (manifest) {
        if (!manifest.version) {
            warnings.push({ code: 'atlas_manifest_version_missing',
                            message: 'import-манифест без версии' });
        } else if (o.manifestVersion !== undefined && manifest.version > o.manifestVersion) {
            errors.push({ code: 'atlas_manifest_version',
                          message: 'версия манифеста ' + manifest.version
                              + ' новее поддерживаемой ' + o.manifestVersion });
        }
        if (o.importer && manifest.importer && manifest.importer !== o.importer) {
            warnings.push({ code: 'atlas_importer_mismatch',
                            message: 'манифест собран импортёром "' + manifest.importer
                                + '", ожидался "' + o.importer + '"' });
        }
        if (!manifest.contentHash) {
            warnings.push({ code: 'atlas_manifest_no_hash',
                            message: 'в манифесте нет content hash — кэш не проверить' });
        }
    }

    return {
        ok: errors.length === 0,
        errors, warnings,
        frames: frames.length,
        pages: pages.length,
        format: parsed.format,
        rotated: parsed.rotated.slice(),
        manifest: manifest || null,
    };
}

/**
 * Путь ассета относительно файла-владельца (JSON атласа): абсолютные пути и
 * схемы (`http:`, `file:`) остаются как есть. Тот же принцип, что у путей
 * ресурсов (§4.2 спецификации) — никаких путей от рабочего каталога.
 */
export function resolveAssetPath(path, json_path) {
    const p = String(path || '');
    if (!p) return null;
    if (/^([a-z]+:)?\//i.test(p)) return p;
    const dir = String(json_path || '').replace(/[^/]*$/, '');
    return dir + p;
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
    const where = '$.atlas.load("' + name + '")';
    if (!parsed.frames.length) {
        return atlasFail(where, 'atlas_no_frames', 'в данных нет кадров — проверьте поле frames',
                         { jsonPath: json_path || null });
    }
    // Повёрнутые кадры: молча пропускать часть production-клипа нельзя.
    // Либо весь атлас отклоняется с точной диагностикой, либо автор явно
    // разрешает взять регионы как есть (`allowRotated: true`).
    if (parsed.rotated.length && spec.allowRotated !== true) {
        return atlasFail(where, 'atlas_rotated_frame',
                         'в атласе повёрнутые кадры (' + parsed.rotated.join(', ')
                         + ') — выгрузите без поворота или укажите allowRotated: true',
                         { jsonPath: json_path || null, data: { frames: parsed.rotated.slice() } });
    }
    if (parsed.rotated.length) {
        ctx.log(where + ': повёрнутые кадры взяты как есть (allowRotated) — '
              + parsed.rotated.join(', '));
    }
    // Два кадра с одним именем: второй спрайт перекрыл бы первый в таблице, и
    // «лишний» остался бы жить в движке без ссылки. Такой атлас отклоняем.
    if (parsed.duplicate_frames && parsed.duplicate_frames.length) {
        return atlasFail(where, 'atlas_duplicate_frame',
                         'кадры объявлены дважды: ' + parsed.duplicate_frames.join(', ')
                         + ' — имена кадров должны быть уникальны',
                         { jsonPath: json_path || null,
                           data: { frames: parsed.duplicate_frames.slice() } });
    }
    // Кадр без прямоугольника не роняет атлас, но и не исчезает молча: чиним
    // диагностику, а рабочие кадры остаются.
    if (parsed.invalid_frames && parsed.invalid_frames.length) {
        atlasReport(where, 'atlas_frame_invalid',
                    'кадры пропущены (нет прямоугольника x/y/w/h): '
                    + parsed.invalid_frames.join(', '),
                    { jsonPath: json_path || null,
                      data: { frames: parsed.invalid_frames.slice() } });
    }

    // Страницы: у каждой свой файл. Пустая/отсутствующая страница — ошибка с
    // кодом, а не пустой спрайт.
    const pages = parsed.meta.pages && parsed.meta.pages.length
        ? parsed.meta.pages : [{ index: 0, name: 'page0', image: null }];
    const images = [];
    const textures = [];
    const page_mipmaps_used = [];
    // Мипмапы разрешены только при политике упаковки с запасом.
    const pad_meta = parsed.meta.padding === undefined ? 0 : parsed.meta.padding;
    const ext_meta = parsed.meta.extrusion === undefined ? 0 : parsed.meta.extrusion;
    const mipmapsAllowed = pad_meta >= 1 && ext_meta >= 1;
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        // Путь страницы — относительно JSON атласа (как meta.image), а не
        // рабочего каталога. atlasImagePath() уже подставляет каталог JSON,
        // поэтому один и тот же путь дважды не префиксуем.
        let image = null;
        if (i === 0 && (spec.src || spec.image)) image = resolveAssetPath(spec.src || spec.image, json_path);
        else if (page.image) image = resolveAssetPath(page.image, json_path);
        else if (i === 0) image = atlasImagePath(json_path, data);
        if (!image) {
            return atlasFail(where, 'atlas_page_no_image',
                             'у страницы "' + page.name + '" не указан файл',
                             { jsonPath: json_path || null });
        }
        // Мипмапы атласа без padding/extrusion «протекают» на соседний кадр:
        // грубые уровни усредняют всю страницу. Поэтому уровни включаются
        // только при явной политике упаковки, иначе страница грузится без них
        // (на нулевом уровне полутексельный отступ уже держит край).
        let page_mipmaps = spec.mipmaps === true;
        if (page_mipmaps && !mipmapsAllowed) {
            ctx.log(where + ': страница "' + page.name + '" без padding/extrusion — '
                  + 'мипмапы выключены, чтобы кадры не «протекали» друг в друга '
                  + '(meta.padding >= 1 и meta.extrusion >= 1)');
            page_mipmaps = false;
        }
        const texture = page_mipmaps
            ? engine.loadTexture(image, { mipmaps: true })
            : engine.loadTexture(image);
        if (!(texture >= 0)) {
            return atlasFail(where, 'atlas_page_missing',
                             'не удалось загрузить страницу "' + page.name + '" ("' + image + '")',
                             { assetPath: image, jsonPath: json_path || null });
        }
        images.push(image);
        textures.push(texture);
        page_mipmaps_used.push(page_mipmaps);
    }
    if (spec.allowRotated !== true && images.length === 0) {
        return atlasFail(where, 'atlas_page_missing', 'у атласа нет ни одной страницы', {});
    }

    const sprites = {};
    const sprite_page = {};
    for (let frame_index = 0; frame_index < parsed.frames.length; frame_index++) {
        const frame = parsed.frames[frame_index];
        const page = frame.page >= 0 && frame.page < textures.length ? frame.page : 0;
        sprites[frame.name] = engine.createSprite(textures[page], frame.x, frame.y, frame.w, frame.h);
        sprite_page[frame.name] = page;
        sprite_metadata.set(sprites[frame.name], { texture: textures[page], page, frame_index,
            frame: Object.assign({}, frame), atlasPath: json_path || null, image: images[page] || null,
            spriteMesh: data.re2d && data.re2d.spriteMesh ? Object.assign({}, data.re2d.spriteMesh) : null });
    }

    const sheet = {
        name,
        image: images[0] || null,
        images,
        texture: textures[0] || -1,
        path: json_path || null,
        format: parsed.format,
        meta: parsed.meta,
        manifest: parsed.meta.import || null,
        /** Страница кадра: индекс (или -1, если кадра нет). */
        page(frame_name) {
            const page = sprite_page[String(frame_name)];
            return page === undefined ? -1 : page;
        },
        /** Описание страниц: [{ index, name, image, frames }]. */
        pages() {
            return pages.map((page, i) => ({
                index: i,
                name: page.name,
                image: images[i] || null,
                mipmaps: !!page_mipmaps_used[i],
                frames: parsed.frames.filter((f) => f.page === i).map((f) => f.name),
            }));
        },
        /** Проверка данных атласа: см. verifyAtlas. */
        verify(opts) { return verifyAtlas(data, opts); },

        /** Спрайт кадра по имени; -1, если такого кадра нет. */
        frame(frame_name) {
            const sprite = sprites[String(frame_name)];
            return sprite === undefined ? -1 : sprite;
        },

        /** Metadata used by SpriteMesh and diagnostics; animation still uses
         * the ordinary frame handle and index. */
        spriteInfo(sprite_id) {
            const info = sprite_metadata.get(Number(sprite_id));
            return info ? Object.assign({}, info, { frame: Object.assign({}, info.frame) }) : null;
        },

        /** Имена кадров по порядку атласа. */
        frames() { return parsed.frames.map((f) => f.name); },

        /**
         * Кадры, пропущенные из-за отсутствия прямоугольника: атлас собран из
         * рабочих, но о потере сказано и здесь, и в $.atlas.errors().
         */
        invalidFrames() { return (parsed.invalid_frames || []).slice(); },

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

        /**
         * Размер картинки атласа: [ширина, высота].
         *
         * Текстуру берём у самой оболочки (`this.texture`, первая страница):
         * раньше здесь стояло свободное имя `texture`, которого в области
         * видимости нет, и вызов падал с ReferenceError — при том что
         * docs/highlevel/atlas.md этот метод обещает.
         */
        size() {
            const id = this.texture !== undefined ? this.texture : (textures[0] || -1);
            if (id < 0 || typeof engine.textureSize !== 'function') return [0, 0];
            return engine.textureSize(id);
        },
    };
    return sheet;
}

/**
 * Подпись сборки атласа: всё, что влияет на созданные движком ресурсы
 * (страницы, прямоугольники кадров, мипмапы, разрешение поворотов). По ней
 * `$.atlas.load` узнаёт, что данные не изменились и спрайты можно
 * переиспользовать, а не создавать заново.
 */
function sheetSignature(spec, data, json_path) {
    const parsed = parseAtlas(data);
    return JSON.stringify({
        src: spec.src || spec.image || null,
        json: json_path || null,
        mipmaps: spec.mipmaps === true,
        allowRotated: spec.allowRotated === true,
        pages: (parsed.meta.pages || []).map((p) => p.image || null),
        frames: parsed.frames.map((f) => [f.name, f.x, f.y, f.w, f.h, f.page]),
    });
}

export function installAtlas($) {
    atlas_dollar = $;
    const loaded = new Map();
    // Сборки по имени: переживают `unload`, поэтому повторная загрузка тех же
    // данных не создаёт новых спрайтов (они в движке не освобождаются).
    const builds = new Map();

    const atlas = {
        /**
         * Загрузить атлас: `$.atlas.load('hero', 'art/hero.json')`. Путь к
         * картинке берётся из данных (`meta.image`), его можно перебить
         * `spec.src`. Без второго аргумента используется уже прочитанный
         * `spec.data` — удобно, когда JSON пришёл по сети.
         *
         * Повторный вызов с тем же именем возвращает уже собранный лист, а
         * после `unload` те же данные переиспользуют прежнюю сборку: спрайты в
         * движке не освобождаются, и цикл `unload` → `load` не растит их число.
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

            // Те же данные — та же сборка: спрайты уже созданы, повторно их
            // создавать нельзя (в движке нет freeSprite, счётчик только растёт).
            const cached = builds.get(key);
            if (cached && cached.data === data) {
                loaded.set(key, cached.sheet);
                return cached.sheet;
            }
            const signature = sheetSignature(opts, data, json_path);
            if (cached && cached.signature === signature) {
                loaded.set(key, cached.sheet);
                return cached.sheet;
            }

            const sheet = buildSheet(key, opts, data, json_path);
            if (!sheet) return null;
            builds.set(key, { signature, data, sheet });
            loaded.set(key, sheet);
            return sheet;
        },

        spriteInfo(sprite_id) {
            const info = sprite_metadata.get(Number(sprite_id));
            return info ? Object.assign({}, info, { frame: Object.assign({}, info.frame) }) : null;
        },

        /** Загруженный атлас по имени (или null). */
        get(name) { return loaded.get(String(name)) || null; },

        /** Имена загруженных атласов. */
        names() { return [...loaded.keys()]; },

        /**
         * Забыть атлас (спрайты остаются у движка — их выгружает freeTexture).
         *
         * Сборка по умолчанию сохраняется: повторная загрузка тех же данных
         * вернёт её без новых спрайтов. `{ drop: true }` выбрасывает и её.
         */
        unload(name, opts) {
            const key = String(name);
            if (opts && opts.drop === true) builds.delete(key);
            return loaded.delete(key);
        },

        /** Имена сборок, готовых к переиспользованию после unload. */
        builds() { return [...builds.keys()]; },

        /** Разобрать данные без загрузки — для отладки и тестов. */
        parse(data) { return parseAtlas(data); },

        /**
         * Проверка данных атласа без загрузки: кадры, страницы, padding,
         * теги, import-манифест. `{ ok, errors, warnings, frames, pages }`.
         */
        verify(data, opts) { return verifyAtlas(data, opts); },

        /** Кольцо структурированных ошибок атласа (работает и без движка). */
        errors() { return atlas_errors.slice(); },
        clearErrors() { atlas_errors.length = 0; return 0; },

        /** Import-манифест загруженного атласа (или null). */
        manifest(name) { return loaded.has(String(name)) ? loaded.get(String(name)).manifest : null; },

        /** Путь к картинке атласа по данным и пути JSON. */
        imagePath(json_path, data) { return atlasImagePath(json_path, data); },
    };

    $.atlas = atlas;
    return atlas;
}
