// ===========================================================================
// Модель описания Re2DSprite (`*.character.json`) для Re2DSprite Studio.
//
// Студия не меняет семантику формата (docs/RE2DSPRITE_JSON.md): она читает
// JSON как есть, правит отдельные поля и пишет обратно ТЕМ ЖЕ отступом, чтобы
// `git diff` показывал только правки. Правила допустимости — в нативном
// `r2d-sdk validate` и в самом рантайме; здесь только проверки, нужные, чтобы
// не записать заведомо мусорное значение (конечные числа, существующие кости).
//
// Модуль чистый: ни движка, ни UI (tests/js/sdk_re2d_model_test.mjs).
// ===========================================================================

const clone = (v) => JSON.parse(JSON.stringify(v));
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6);

/** Отступ исходного файла: по первой строке с отступом; по умолчанию 2 пробела. */
export function detectIndent(text) {
    const m = /\n([ \t]+)\S/.exec(String(text));
    if (!m) return 2;
    return m[1].includes('\t') ? '\t' : m[1].length;
}

export function parseCharacter(text) {
    const def = JSON.parse(text);
    if (!def || typeof def !== 'object' || Array.isArray(def)) throw new Error('описание должно быть объектом');
    return { def, indent: detectIndent(text), newline: String(text).endsWith('\n') };
}

export function serializeCharacter(def, indent = 2, newline = true) {
    return JSON.stringify(def, null, indent) + (newline ? '\n' : '');
}

/** Все пути описания → абсолютные (для `$.re2dSprite.from(объект)`: у объекта нет «своего» каталога). */
export function absolutize(def, dir) {
    const out = clone(def);
    const abs = (p) => {
        if (typeof p !== 'string' || !p) return p;
        if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) return p;
        const parts = String(dir).split('/');
        for (const seg of p.split('/')) {
            if (seg === '..') { if (parts.length > 1) parts.pop(); } else if (seg && seg !== '.') parts.push(seg);
        }
        return parts.join('/');
    };
    out.atlas = abs(out.atlas);
    if (typeof out.animations === 'string') out.animations = abs(out.animations);
    if (typeof out.surface === 'string') out.surface = abs(out.surface);
    for (const group of Object.values(out.variants || {})) {
        for (const key of Object.keys(group)) group[key] = abs(group[key]);
    }
    for (const eq of Object.values(out.equipment || {})) if (eq && eq.model) eq.model = abs(eq.model);
    return out;
}

/** Кости с глубиной вложенности — для дерева. */
export function boneList(def) {
    const bones = (def.rig && def.rig.bones) || [];
    const depth = {};
    return bones.map((b, index) => {
        depth[b.name] = b.parent ? (depth[b.parent] || 0) + 1 : 0;
        return { name: b.name, parent: b.parent || null, depth: depth[b.name], index, pivot: b.pivot || [0, 0, 0], portraitPivot: b.portraitPivot || null };
    });
}

export function findBone(def, name) {
    return ((def.rig && def.rig.bones) || []).find((b) => b.name === name) || null;
}

export function partsOf(def, boneName) {
    return ((def.rig && def.rig.parts) || []).filter((p) => p.bone === boneName);
}

export function clipNames(anim) {
    return anim && anim.clips && typeof anim.clips === 'object' ? Object.keys(anim.clips) : [];
}

export function emotionNames(def) {
    return Object.keys(def.emotions || {});
}

// ---------------------------------------------------------------------------
// Операции правки (меняют def на месте)
// ---------------------------------------------------------------------------
function need(def, name) {
    const bone = findBone(def, name);
    if (!bone) throw new Error('нет кости «' + name + '»');
    return bone;
}

export function setBonePivot(def, name, pivot, portraitPivot) {
    const bone = need(def, name);
    if (pivot !== undefined) {
        if (!isVec3(pivot)) throw new Error('pivot — три конечных числа');
        bone.pivot = pivot.slice();
    }
    if (portraitPivot !== undefined) {
        if (portraitPivot === null) delete bone.portraitPivot;
        else if (!isVec3(portraitPivot)) throw new Error('portraitPivot — три конечных числа');
        else bone.portraitPivot = portraitPivot.slice();
    }
}

export function setPartBone(def, id, boneName) {
    need(def, boneName);
    const part = ((def.rig && def.rig.parts) || []).find((p) => p.id === id);
    if (!part) throw new Error('нет части с id ' + id);
    part.bone = boneName;
}

export function setProjection(def, key, value) {
    if (!['bodyScale', 'portraitScale'].includes(key)) throw new Error('projection: bodyScale или portraitScale');
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 8) throw new Error(key + ' — число в (0, 8]');
    def.projection = def.projection || {};
    def.projection[key] = value;
}

export function setSocket(def, name, patch) {
    const socket = ((def.rig && def.rig.sockets) || []).find((s) => s.name === name);
    if (!socket) throw new Error('нет сокета «' + name + '»');
    for (const key of ['point', 'rotation']) {
        if (patch[key] === undefined) continue;
        if (!isVec3(patch[key])) throw new Error(key + ' — три конечных числа');
        socket[key] = patch[key].slice();
    }
}

export function setStyle(def, style) {
    if (!['anime', 'pixel'].includes(style)) throw new Error('style: anime или pixel');
    def.style = style;
}

export function setDefaultMotion(def, name, clips) {
    if (name !== null && clips.length && !clips.includes(name)) throw new Error('нет клипа «' + name + '»');
    def.defaults = def.defaults || {};
    if (name === null) delete def.defaults.motion;
    else def.defaults.motion = name;
}

// ---------------------------------------------------------------------------
// Геометрия вида поверхности
// ---------------------------------------------------------------------------
export const MAP_W = 256;
export const MAP_H = 192;

/** Отсчёт карты под точкой экрана; null, если точка вне картинки.
 *  `gw`/`gh` — размер сетки: у карт v2 это 256×192, у контейнера v3 — W×H
 *  из заголовка (docs/RE2DSPRITE_V3.md). */
export function sampleAt(view, sx, sy, gw = MAP_W, gh = MAP_H) {
    const mx = Math.floor((sx - view.x) / view.cell);
    const my = Math.floor((sy - view.y) / view.cell);
    return mx >= 0 && my >= 0 && mx < gw && my < gh ? { mx, my } : null;
}

// ---------------------------------------------------------------------------
// Сетка текселей контейнера v3
// ---------------------------------------------------------------------------

/** Клетки квадратной кисти вокруг (cx, cy); всё за пределами сетки отброшено. */
export function brushCells(cx, cy, size, gw = MAP_W, gh = MAP_H) {
    const n = Math.max(1, Math.min(64, Math.floor(Number(size)) || 1));
    const half = Math.floor((n - 1) / 2);
    const out = [];
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const gx = cx - half + x, gy = cy - half + y;
            if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) out.push([gx, gy]);
        }
    }
    return out;
}

/** Клетки мазка («x,y» в наборе) → прямоугольники: горизонтальные прогоны. */
export function strokeRects(keys) {
    const rows = new Map();
    for (const key of keys || []) {
        const parts = String(key).split(',');
        const x = Number(parts[0]), y = Number(parts[1]);
        if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
        if (!rows.has(y)) rows.set(y, new Set());
        rows.get(y).add(x);
    }
    const rects = [];
    for (const y of [...rows.keys()].sort((a, b) => a - b)) {
        const xs = [...rows.get(y)].sort((a, b) => a - b);
        let start = xs[0], prev = xs[0];
        for (let i = 1; i < xs.length; i++) {
            if (xs[i] !== prev + 1) { rects.push([start, y, prev - start + 1, 1]); start = xs[i]; }
            prev = xs[i];
        }
        rects.push([start, y, prev - start + 1, 1]);
    }
    return rects;
}

/** Масштаб отладочного вида сетки: целое 1…4, чтобы картинка влезала в предел. */
export function gridScale(gw, gh, max = 1400) {
    const safe = (v) => (Number.isFinite(v) && v > 0 ? v : 1);
    const longest = Math.max(1, safe(gw), safe(gh));
    return Math.max(1, Math.min(4, Math.floor(max / longest)));
}

/** Разбор строки цвета «#rrggbb» → [r, g, b] или null. */
export function parseHexColor(text) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(text || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const fmt2 = (v) => (typeof v === 'number' && Number.isFinite(v) ? (Math.round(v * 100) / 100).toString() : '—');

/** Тексель контейнера v3 одним текстом: цвет, позиция, нормаль, блеск, кости. */
export function describeTexel(s) {
    if (!s) return '—';
    const where = '(' + s.x + ', ' + s.y + ')';
    if (!s.live) return where + ' · пусто';
    const color = Array.isArray(s.color) ? s.color : [0, 0, 0, 0];
    const pos = Array.isArray(s.position) ? s.position : [0, 0, 0];
    const nrm = Array.isArray(s.normal) ? s.normal : [0, 0, 0];
    const bones = (s.bones || []).filter((b) => b && b.weight > 0).map((b) => {
        // id слоя трактуется двумя способами (факты описания, не догадка):
        // индекс кости + 1 (bake-re2d3) или id части v2 (convert-re2d3).
        const name = b.asBone && b.bone ? b.bone + ' (кость #' + b.id + ')'
            : b.asPart && b.partBone ? 'часть ' + b.id + ' → ' + b.partBone
                : '#' + b.id + ' (не описано)';
        return name + ' ' + Math.round((b.weight / 255) * 100) + '%' + (b.dominant ? '*' : '');
    }).join(' + ') || 'кости не заданы';
    return where + ' · rgb(' + color.slice(0, 3).join(',') + ') · XYZ (' + fmt2(pos[0]) + ', ' + fmt2(pos[1]) + ', ' + fmt2(pos[2]) +
        ') · N (' + fmt2(nrm[0]) + ', ' + fmt2(nrm[1]) + ', ' + fmt2(nrm[2]) + ') · блеск ' + s.gloss + ' · ' + bones;
}

/** Нормализованные углы просмотра: yaw ±180 с заворотом, pitch ±75 (как рантайм). */
export function normalizePose(yaw, pitch) {
    const y = ((yaw % 360) + 540) % 360 - 180;
    return { yaw: y === 0 ? 0 : y, pitch: Math.max(-75, Math.min(75, pitch)) };
}

export function describeSample(s) {
    if (!s) return '—';
    const bone = s.bone ? ' · ' + s.bone : '';
    const cov = s.coverage === 255 ? 'непрозрачно' : s.coverage === 128 ? 'опора' : 'пусто';
    return 'ID ' + s.id + bone + ' · XYZ (' + s.x + ', ' + s.y + ', ' + s.z + ') · ' + cov + ' · группа ' + s.group;
}
