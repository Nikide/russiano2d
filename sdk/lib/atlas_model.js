// ===========================================================================
// Модель атласа спрайтов для Sprite Studio и Animation Studio.
//
// Формат — Aseprite-совместимый JSON, который уже читает `$.atlas`
// (src/highlevel/atlas.js): `frames`, `meta.image`, `meta.frameTags`,
// `meta.slices`. Нового формата нет: пивот кадра хранится слайсом с именем
// кадра (так его читает `sheet.slice(name)`), тег-анимация — frameTags, а то,
// чего рантайм не знает (`meta.custom`, `loop`), он игнорирует.
//
// Модуль чистый — ни движка, ни UI (tests/js/sdk_atlas_model_test.mjs).
// `serializeAtlas` обязан писать те же байты, что и C-функция
// `sdk_atlas_canonical` (sdk/native/sdk_atlas.c): это проверяет агентский
// тест через `r2d-sdk atlas-format`.
// ===========================================================================

const FRAME_BOX_KNOWN = ['x', 'y', 'w', 'h'];
const META_KNOWN = ['app', 'version', 'image', 'size', 'frameTags', 'slices', 'custom'];
const TAG_KNOWN = ['name', 'from', 'to', 'direction', 'loop'];
const DEFAULT_DURATION = 100;

// ---------------------------------------------------------------------------
// Числа и компактный JSON (как C: sdk_json_put_compact)
// ---------------------------------------------------------------------------

/** Число так, как его печатает C (`%lld` для целых, `%.10g` для дробных). */
export function fmtNum(n) {
    if (!Number.isFinite(n)) return '0';
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
    return String(parseFloat(n.toPrecision(10)));
}

export function compact(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number') return fmtNum(value);
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(compact).join(', ') + ']';
    const parts = [];
    for (const key of Object.keys(value)) parts.push(JSON.stringify(key) + ': ' + compact(value[key]));
    return '{' + parts.join(', ') + '}';
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const round3 = (n) => Math.round(n * 1000) / 1000;

function pickExtra(obj, known) {
    const extra = {};
    for (const key of Object.keys(obj || {})) if (!known.includes(key)) extra[key] = clone(obj[key]);
    return extra;
}

// ---------------------------------------------------------------------------
// Разбор
// ---------------------------------------------------------------------------

function readBox(box) {
    const w = box.w !== undefined ? box.w : box.width;
    const h = box.h !== undefined ? box.h : box.height;
    return { x: Number(box.x), y: Number(box.y), w: Number(w), h: Number(h) };
}

/**
 * JSON → модель. Бросает Error с понятным текстом, если файл — не атлас с
 * frames-объектом (массивный вид TexturePacker Studio не переписывает).
 */
export function parseAtlasDoc(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('корень атласа должен быть объектом');
    if (!json.frames || typeof json.frames !== 'object' || Array.isArray(json.frames)) {
        throw new Error('нужен атлас с frames-объектом (имя → кадр); массивный вид TexturePacker не редактируется');
    }
    const meta = json.meta && typeof json.meta === 'object' ? json.meta : {};
    const doc = {
        meta: pickExtra(meta, META_KNOWN),
        app: meta.app === undefined ? null : meta.app,
        version: meta.version === undefined ? null : meta.version,
        image: typeof meta.image === 'string' ? meta.image : '',
        size: meta.size && typeof meta.size === 'object' ? { w: Number(meta.size.w), h: Number(meta.size.h) } : null,
        hasMeta: !!json.meta,
        frames: [],
        tags: [],
        slices: [],
        custom: meta.custom !== undefined ? clone(meta.custom) : null,
        hadTags: Array.isArray(meta.frameTags),
        hadSlices: Array.isArray(meta.slices),
        root: pickExtra(json, ['meta', 'frames']),
    };

    const names = Object.keys(json.frames);
    for (const name of names) {
        const entry = json.frames[name];
        const wrapped = entry && typeof entry.frame === 'object' && entry.frame !== null;
        const box = wrapped ? entry.frame : entry;
        const rect = readBox(box || {});
        if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) throw new Error('кадр «' + name + '»: нужны числа x, y, w, h');
        const boxKnown = wrapped ? FRAME_BOX_KNOWN.concat(['width', 'height']) : null;
        doc.frames.push({
            name,
            x: rect.x, y: rect.y, w: rect.w, h: rect.h,
            duration: entry && Number.isFinite(Number(entry.duration)) ? Number(entry.duration) : null,
            pivot: null,
            boxExtra: wrapped ? pickExtra(box, boxKnown) : {},
            extra: wrapped ? pickExtra(entry, ['frame', 'duration'])
                           : pickExtra(entry, FRAME_BOX_KNOWN.concat(['width', 'height', 'duration'])),
        });
    }

    for (const t of Array.isArray(meta.frameTags) ? meta.frameTags : []) {
        doc.tags.push({
            name: String(t.name),
            from: Number(t.from), to: Number(t.to),
            direction: t.direction === undefined ? null : String(t.direction),
            loop: t.loop === undefined ? null : !!t.loop,
            extra: pickExtra(t, TAG_KNOWN),
        });
    }

    // Слайсы: «один ключ, имя кадра, рамка совпадает с кадром» — это пивот
    // кадра; остальное (части тела, привязки) хранится как есть.
    for (const s of Array.isArray(meta.slices) ? meta.slices : []) {
        const frame = doc.frames.find((f) => f.name === s.name);
        const key = Array.isArray(s.keys) && s.keys.length === 1 ? s.keys[0] : null;
        const idx = frame ? doc.frames.indexOf(frame) : -1;
        const matches = key && frame && key.bounds && Number(key.frame) === idx &&
            Number(key.bounds.x) === frame.x && Number(key.bounds.y) === frame.y &&
            Number(key.bounds.w) === frame.w && Number(key.bounds.h) === frame.h &&
            key.pivot && Object.keys(s).every((k) => k === 'name' || k === 'keys') &&
            Object.keys(key).every((k) => k === 'frame' || k === 'bounds' || k === 'pivot');
        if (matches && !frame.pivot) {
            frame.pivot = { x: round3(Number(key.pivot.x) - frame.x), y: round3(Number(key.pivot.y) - frame.y) };
        } else {
            doc.slices.push(clone(s));
        }
    }
    return doc;
}

// ---------------------------------------------------------------------------
// Сериализация (канонический вид — как в C)
// ---------------------------------------------------------------------------

function boxText(f) {
    const parts = ['"x": ' + fmtNum(f.x), '"y": ' + fmtNum(f.y), '"w": ' + fmtNum(f.w), '"h": ' + fmtNum(f.h)];
    for (const key of Object.keys(f.boxExtra || {})) parts.push(JSON.stringify(key) + ': ' + compact(f.boxExtra[key]));
    return '{' + parts.join(', ') + '}';
}

function frameText(f) {
    const parts = ['"frame": ' + boxText(f)];
    if (f.duration !== null && f.duration !== undefined) parts.push('"duration": ' + fmtNum(f.duration));
    for (const key of Object.keys(f.extra || {})) parts.push(JSON.stringify(key) + ': ' + compact(f.extra[key]));
    return '{' + parts.join(', ') + '}';
}

function tagText(t) {
    const parts = ['"name": ' + JSON.stringify(t.name), '"from": ' + fmtNum(t.from), '"to": ' + fmtNum(t.to)];
    if (t.direction !== null && t.direction !== undefined) parts.push('"direction": ' + JSON.stringify(t.direction));
    if (t.loop !== null && t.loop !== undefined) parts.push('"loop": ' + (t.loop ? 'true' : 'false'));
    for (const key of Object.keys(t.extra || {})) parts.push(JSON.stringify(key) + ': ' + compact(t.extra[key]));
    return '{' + parts.join(', ') + '}';
}

function sliceText(s) {
    const parts = ['"name": ' + JSON.stringify(s.name)];
    if (s.color !== undefined) parts.push('"color": ' + compact(s.color));
    if (s.keys !== undefined) {
        const keys = s.keys.map((k) => {
            const kp = [];
            if (k.frame !== undefined) kp.push('"frame": ' + compact(k.frame));
            if (k.bounds !== undefined) {
                const b = k.bounds;
                const bp = [];
                for (const key of ['x', 'y', 'w', 'h']) if (b[key] !== undefined) bp.push('"' + key + '": ' + compact(b[key]));
                for (const key of Object.keys(b)) if (!['x', 'y', 'w', 'h', 'width', 'height'].includes(key)) bp.push(JSON.stringify(key) + ': ' + compact(b[key]));
                kp.push('"bounds": {' + bp.join(', ') + '}');
            }
            if (k.pivot !== undefined) kp.push('"pivot": ' + compact(k.pivot));
            for (const key of Object.keys(k)) if (!['frame', 'bounds', 'pivot'].includes(key)) kp.push(JSON.stringify(key) + ': ' + compact(k[key]));
            return '{' + kp.join(', ') + '}';
        });
        parts.push('"keys": [' + keys.join(', ') + ']');
    }
    for (const key of Object.keys(s)) if (!['name', 'color', 'keys'].includes(key)) parts.push(JSON.stringify(key) + ': ' + compact(s[key]));
    return '{' + parts.join(', ') + '}';
}

function linesText(indent, items) {
    if (items.length === 0) return '[]';
    return '[\n' + items.map((t) => indent + '  ' + t).join(',\n') + '\n' + indent + ']';
}

/** Слайсы для записи: пивоты кадров (по порядку кадров), затем прочие. */
function buildSlices(doc) {
    const out = [];
    doc.frames.forEach((f, i) => {
        if (!f.pivot) return;
        out.push({
            name: f.name,
            keys: [{ frame: i, bounds: { x: f.x, y: f.y, w: f.w, h: f.h }, pivot: { x: round3(f.x + f.pivot.x), y: round3(f.y + f.pivot.y) } }],
        });
    });
    for (const s of doc.slices) out.push(s);
    return out;
}

export function serializeAtlas(doc) {
    const meta = [];
    const add = (key, text) => meta.push('    "' + key + '": ' + text);
    if (doc.app !== null && doc.app !== undefined) add('app', compact(doc.app));
    if (doc.version !== null && doc.version !== undefined) add('version', compact(doc.version));
    if (doc.image) add('image', JSON.stringify(doc.image));
    if (doc.size) add('size', '{"w": ' + fmtNum(doc.size.w) + ', "h": ' + fmtNum(doc.size.h) + '}');
    if (doc.tags.length || doc.hadTags) add('frameTags', linesText('    ', doc.tags.map(tagText)));
    const slices = buildSlices(doc);
    if (slices.length || doc.hadSlices) add('slices', linesText('    ', slices.map(sliceText)));
    if (doc.custom !== null && doc.custom !== undefined) add('custom', compact(doc.custom));
    for (const key of Object.keys(doc.meta)) meta.push('    ' + JSON.stringify(key) + ': ' + compact(doc.meta[key]));

    const lines = [];
    if (meta.length) lines.push('  "meta": {\n' + meta.join(',\n') + '\n  }');
    else if (doc.hasMeta) lines.push('  "meta": {}');
    lines.push('  "frames": ' + (doc.frames.length === 0 ? '{}' :
        '{\n' + doc.frames.map((f) => '    ' + JSON.stringify(f.name) + ': ' + frameText(f)).join(',\n') + '\n  }'));
    for (const key of Object.keys(doc.root)) lines.push('  ' + JSON.stringify(key) + ': ' + compact(doc.root[key]));
    return '{\n' + lines.join(',\n') + '\n}\n';
}

// ---------------------------------------------------------------------------
// Создание
// ---------------------------------------------------------------------------

export function newAtlasDoc(image, size) {
    return {
        meta: {}, app: 'r2d-sdk', version: null, image: image || '', size: size || null, hasMeta: true,
        frames: [], tags: [], slices: [], custom: null, hadTags: false, hadSlices: false, root: {},
    };
}

// ---------------------------------------------------------------------------
// Операции (изменяют модель на месте; ошибка — Error с понятным текстом)
// ---------------------------------------------------------------------------

function frameIndex(doc, i) {
    if (!Number.isInteger(i) || i < 0 || i >= doc.frames.length) throw new Error('нет кадра с номером ' + i);
    return doc.frames[i];
}

function checkRect(r) {
    for (const key of ['x', 'y', 'w', 'h']) {
        if (!Number.isFinite(r[key])) throw new Error('координата ' + key + ' должна быть числом');
    }
    if (r.w < 1 || r.h < 1) throw new Error('размер кадра должен быть не меньше 1×1');
    if (r.x < 0 || r.y < 0) throw new Error('кадр не может начинаться левее или выше картинки');
}

export function uniqueName(doc, base) {
    const taken = new Set(doc.frames.map((f) => f.name));
    if (!taken.has(base)) return base;
    let n = 1;
    while (taken.has(base + '_' + n)) n++;
    return base + '_' + n;
}

export function baseName(doc) {
    const file = String(doc.image || 'frame').split('/').pop().replace(/\.[^.]+$/, '');
    return file || 'frame';
}

export function addFrame(doc, rect, name) {
    const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
    checkRect(r);
    if (doc.size && (r.x + r.w > doc.size.w || r.y + r.h > doc.size.h)) {
        throw new Error('кадр выходит за пределы картинки ' + doc.size.w + '×' + doc.size.h);
    }
    const last = doc.frames[doc.frames.length - 1];
    const frame = {
        name: name ? String(name) : uniqueName(doc, baseName(doc) + '_' + doc.frames.length),
        x: r.x, y: r.y, w: r.w, h: r.h,
        duration: last && last.duration !== null ? last.duration : DEFAULT_DURATION,
        pivot: null, boxExtra: {}, extra: {},
    };
    if (doc.frames.some((f) => f.name === frame.name)) throw new Error('кадр «' + frame.name + '» уже есть');
    doc.frames.push(frame);
    return doc.frames.length - 1;
}

export function removeFrame(doc, i) {
    frameIndex(doc, i);
    doc.frames.splice(i, 1);
    const tags = [];
    for (const t of doc.tags) {
        const tag = Object.assign({}, t);
        if (i < tag.from) { tag.from--; tag.to--; }
        else if (i <= tag.to) { tag.to--; if (tag.to < tag.from) continue; }
        tags.push(tag);
    }
    doc.tags = tags;
    const slices = [];
    for (const s of doc.slices) {
        const keys = [];
        for (const k of s.keys || []) {
            const frame = Number(k.frame);
            if (frame === i) continue;
            keys.push(frame > i ? Object.assign({}, k, { frame: frame - 1 }) : k);
        }
        if (keys.length) slices.push(Object.assign({}, s, { keys }));
    }
    doc.slices = slices;
}

export function renameFrame(doc, i, name) {
    const frame = frameIndex(doc, i);
    const next = String(name || '').trim();
    if (!next) throw new Error('имя кадра не может быть пустым');
    if (doc.frames.some((f, k) => k !== i && f.name === next)) throw new Error('кадр «' + next + '» уже есть');
    frame.name = next;
}

export function setRect(doc, i, rect) {
    const frame = frameIndex(doc, i);
    const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
    checkRect(r);
    if (doc.size && (r.x + r.w > doc.size.w || r.y + r.h > doc.size.h)) {
        throw new Error('кадр выходит за пределы картинки ' + doc.size.w + '×' + doc.size.h);
    }
    Object.assign(frame, r);
}

/** Пивот — локальные пиксели от левого верхнего угла кадра; null — убрать. */
export function setPivot(doc, i, pivot) {
    const frame = frameIndex(doc, i);
    if (pivot === null) { frame.pivot = null; return; }
    if (!Number.isFinite(pivot.x) || !Number.isFinite(pivot.y)) throw new Error('пивот: нужны числа x и y');
    frame.pivot = { x: round3(pivot.x), y: round3(pivot.y) };
}

export function setDuration(doc, i, ms) {
    const frame = frameIndex(doc, i);
    if (ms === null) { frame.duration = null; return; }
    if (!Number.isFinite(ms) || ms < 1 || ms > 600000) throw new Error('длительность кадра — число от 1 до 600000 мс');
    frame.duration = Math.round(ms);
}

/** Тегу нужны подряд идущие кадры: после перестановки диапазоны пересчитываются по именам. */
export function moveFrame(doc, from, to) {
    frameIndex(doc, from);
    if (!Number.isInteger(to) || to < 0 || to >= doc.frames.length) throw new Error('нет позиции ' + to);
    if (from === to) return;
    const names = doc.tags.map((t) => doc.frames.slice(t.from, t.to + 1).map((f) => f.name));
    const [frame] = doc.frames.splice(from, 1);
    doc.frames.splice(to, 0, frame);
    const pos = (name) => doc.frames.findIndex((f) => f.name === name);
    const tags = doc.tags.map((t, k) => {
        const idx = names[k].map(pos).sort((a, b) => a - b);
        for (let n = 1; n < idx.length; n++) {
            if (idx[n] !== idx[n - 1] + 1) throw new Error('перестановка разрывает тег «' + t.name + '»: кадры тега должны идти подряд');
        }
        return Object.assign({}, t, { from: idx[0], to: idx[idx.length - 1] });
    });
    const slices = doc.slices.map((s) => s);   // слайсы-«части» привязаны к номерам кадров листа — не трогаем
    doc.tags = tags;
    doc.slices = slices;
}

export function addTag(doc, tag) {
    const t = {
        name: String(tag.name || '').trim(),
        from: Number(tag.from), to: Number(tag.to),
        direction: tag.direction || 'forward',
        loop: tag.loop === undefined ? true : !!tag.loop,
        extra: {},
    };
    if (!t.name) throw new Error('имя тега не может быть пустым');
    if (doc.tags.some((x) => x.name === t.name)) throw new Error('тег «' + t.name + '» уже есть');
    checkTagRange(doc, t);
    doc.tags.push(t);
    doc.hadTags = true;
    return doc.tags.length - 1;
}

function checkTagRange(doc, t) {
    if (!Number.isInteger(t.from) || !Number.isInteger(t.to) || t.from < 0 || t.to < t.from || t.to >= doc.frames.length) {
        throw new Error('тег «' + t.name + '»: диапазон ' + t.from + '..' + t.to + ' вне кадров 0..' + (doc.frames.length - 1));
    }
    if (!['forward', 'reverse', 'pingpong'].includes(t.direction)) throw new Error('direction — forward, reverse или pingpong');
}

export function updateTag(doc, i, patch) {
    if (!Number.isInteger(i) || i < 0 || i >= doc.tags.length) throw new Error('нет тега с номером ' + i);
    const next = Object.assign({}, doc.tags[i]);
    for (const key of ['name', 'from', 'to', 'direction', 'loop']) if (patch[key] !== undefined) next[key] = patch[key];
    next.name = String(next.name).trim();
    next.from = Number(next.from);
    next.to = Number(next.to);
    next.loop = !!next.loop;
    if (!next.name) throw new Error('имя тега не может быть пустым');
    if (doc.tags.some((x, k) => k !== i && x.name === next.name)) throw new Error('тег «' + next.name + '» уже есть');
    checkTagRange(doc, next);
    doc.tags[i] = next;
}

export function removeTag(doc, i) {
    if (!Number.isInteger(i) || i < 0 || i >= doc.tags.length) throw new Error('нет тега с номером ' + i);
    doc.tags.splice(i, 1);
}

/** Длительность всех кадров тега разом (удобно: рантайм читает длительность по первому кадру). */
export function setTagDuration(doc, i, ms) {
    const t = doc.tags[i];
    if (!t) throw new Error('нет тега с номером ' + i);
    for (let k = t.from; k <= t.to; k++) setDuration(doc, k, ms);
}

export function setCustom(doc, key, value) {
    const k = String(key || '').trim();
    if (!k) throw new Error('ключ метаданных не может быть пустым');
    if (value === null || value === undefined || value === '') {
        if (doc.custom) delete doc.custom[k];
        if (doc.custom && Object.keys(doc.custom).length === 0) doc.custom = null;
        return;
    }
    doc.custom = doc.custom || {};
    doc.custom[k] = String(value);
}

// ---------------------------------------------------------------------------
// Геометрия и поиск
// ---------------------------------------------------------------------------

/** Кадр под точкой текстуры: из подходящих — с наименьшей площадью; -1, если нет. */
export function frameAt(doc, x, y) {
    let best = -1;
    let bestArea = Infinity;
    doc.frames.forEach((f, i) => {
        if (x >= f.x && x < f.x + f.w && y >= f.y && y < f.y + f.h && f.w * f.h < bestArea) {
            best = i;
            bestArea = f.w * f.h;
        }
    });
    return best;
}

/** Прямоугольник по двум углам: порядок углов не важен, края — целые пиксели. */
export function rectFromPoints(x0, y0, x1, y1) {
    const left = Math.floor(Math.min(x0, x1));
    const top = Math.floor(Math.min(y0, y1));
    const right = Math.ceil(Math.max(x0, x1));
    const bottom = Math.ceil(Math.max(y0, y1));
    return { x: left, y: top, w: right - left, h: bottom - top };
}

export function clampRect(r, w, h) {
    const x = Math.max(0, Math.min(r.x, w));
    const y = Math.max(0, Math.min(r.y, h));
    return { x, y, w: Math.max(0, Math.min(r.x + r.w, w) - x), h: Math.max(0, Math.min(r.y + r.h, h) - y) };
}

/** Масштаб, при котором картинка целиком влезает в окно просмотра (целый, если можно). */
export function fitZoom(imgW, imgH, viewW, viewH) {
    if (!(imgW > 0) || !(imgH > 0) || !(viewW > 0) || !(viewH > 0)) return 1;
    const k = Math.min(viewW / imgW, viewH / imgH);
    return k >= 1 ? Math.max(1, Math.floor(k)) : Math.max(0.125, Math.round(k * 8) / 8);
}

/** Вид: центр просмотра `cx,cy` — это точка текстуры (px,py); zoom — экранных пикселей на пиксель текстуры. */
export function texToScreen(view, x, y) {
    return { x: view.cx + (x - view.px) * view.zoom, y: view.cy + (y - view.py) * view.zoom };
}

export function screenToTex(view, sx, sy) {
    return { x: view.px + (sx - view.cx) / view.zoom, y: view.py + (sy - view.cy) / view.zoom };
}

/** Что играет рантайм для тега: `$.atlas` даёт кадры по порядку и tagInterval — по первому кадру. */
export function tagPlayback(doc, tagName) {
    const t = doc.tags.find((x) => x.name === tagName);
    if (!t) return null;
    let names = doc.frames.slice(t.from, t.to + 1).map((f) => f.name);
    if (t.direction === 'reverse') names = names.slice().reverse();
    const first = doc.frames[t.from];
    const interval = first && first.duration ? first.duration : DEFAULT_DURATION;
    return { name: t.name, frames: names, interval, fps: 1000 / interval, loop: t.loop !== false };
}

// ---------------------------------------------------------------------------
// История (undo/redo): команда = снимок «до» и «после»
// ---------------------------------------------------------------------------

function replaceContents(target, source) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, source);
}

export function createHistory(doc, limit = 200) {
    const undo = [];
    const redo = [];
    let saved = JSON.stringify(doc);
    return {
        /** Выполнить правку модели как одну команду. Ошибка откатывает модель. */
        run(label, fn) {
            const before = JSON.stringify(doc);
            let result;
            try {
                result = fn(doc);
            } catch (e) {
                replaceContents(doc, JSON.parse(before));
                throw e;
            }
            const after = JSON.stringify(doc);
            if (after !== before) {
                undo.push({ label, before, after });
                if (undo.length > limit) undo.shift();
                redo.length = 0;
            }
            return result;
        },
        undo() {
            const cmd = undo.pop();
            if (!cmd) return null;
            replaceContents(doc, JSON.parse(cmd.before));
            redo.push(cmd);
            return cmd.label;
        },
        redo() {
            const cmd = redo.pop();
            if (!cmd) return null;
            replaceContents(doc, JSON.parse(cmd.after));
            undo.push(cmd);
            return cmd.label;
        },
        canUndo() { return undo.length > 0; },
        canRedo() { return redo.length > 0; },
        labels() { return { undo: undo.map((c) => c.label), redo: redo.map((c) => c.label) }; },
        markSaved() { saved = JSON.stringify(doc); },
        dirty() { return JSON.stringify(doc) !== saved; },
    };
}
