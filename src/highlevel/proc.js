// ===========================================================================
// Процедурный пиксель-арт — $.proc
//
// Спрайты не рисуют руками: их ВЫРАЩИВАЮТ из сида. Порт идей из audm-neko
// (districts_art.gd — атлас улицы, машин и промзоны) и из общего подхода
// «палитра → силуэт → детали → свет».
//
//   const art = $.proc.define('hero', {
//       w: 16, h: 24, seed: 7,
//       palette: 'wasteland',
//       parts: ['head', 'torso', 'arms', 'legs'],
//       dirs: 4,                 // столько кадров по направлениям
//   });
//   const data = $.proc.render(art);   // RGBA-пиксели
//   $.proc.toSprite(art);              // спрайт в движке
//   $.proc.sheet('hero', { w: 16, h: 24, cols: 4 });   // спрайт-лист
//
// Что перенесено:
//   * палитры с рампами (тень/свет) — цвет не «случайный», а из рампы;
//   * силуэт по частям тела с пропорциями (голова, торс, руки, ноги);
//   * детали: пояс, ремни, сумки, капюшон, разгрузка — по шансу и по сиду;
//   * свет сверху слева: верхние пиксели светлее, нижние темнее;
//   * варианты (dir) — зеркало и оттенки, а не отдельные рисунки.
//
// Ядро (createArt, renderArt, палитры) не касается движка: это массивы
// пикселей, поэтому всё проверяется юнит-тестом (tests/js/proc_test.mjs).
// ===========================================================================

import { engine } from './native.js';
import { ctx } from './core.js';

// ---------------------------------------------------------------------------
// Чистая часть: палитры
// ---------------------------------------------------------------------------

/**
 * Палитра — это НЕ набор цветов, а рампы: на каждый материал несколько
 * оттенков от тени к свету. Художник-процедурист берёт из рампы, а не
 * выдумывает цвет, иначе спрайт выглядит случайным.
 */
export const PALETTES = {
    wasteland: {
        skin: ['#6b4a35', '#8a6144', '#a97a55', '#c69a70'],
        cloth: ['#3a3a2e', '#4e4e3c', '#63634c', '#7a7a5e'],
        leather: ['#3b2a1d', '#54402c', '#6d543a', '#8a6c4c'],
        metal: ['#3c4046', '#565c64', '#737b85', '#9aa3ae'],
        dark: ['#14140f', '#1e1e16', '#2a2a20', '#3a3a2e'],
        accent: ['#7a2f1d', '#9c4026', '#c05532', '#d97a52'],
    },
    city: {
        skin: ['#7d5a44', '#9c7355', '#b98f6f', '#d6ad8c'],
        cloth: ['#2a3440', '#3a4654', '#4c5a6b', '#63738a'],
        leather: ['#2f2a26', '#453e38', '#5d544c', '#7a6f64'],
        metal: ['#4a4f56', '#636a73', '#828a95', '#a6aeb9'],
        dark: ['#101418', '#1a2027', '#252d36', '#333d48'],
        accent: ['#1d4a6b', '#26618a', '#3179ab', '#4a97cc'],
    },
    forest: {
        skin: ['#6f5138', '#8e6a4b', '#ad8863', '#c9a880'],
        cloth: ['#2d3a26', '#3d4e33', '#506642', '#667e55'],
        leather: ['#332a1c', '#4b3e2a', '#63533a', '#7d6a4b'],
        metal: ['#3f4442', '#575e5c', '#737b78', '#98a09c'],
        dark: ['#0e1410', '#17201a', '#222d24', '#303d31'],
        accent: ['#6b5a1d', '#8a7526', '#a89030', '#c6ac45'],
    },
};

/** Палитра по имени; неизвестная — wasteland (игра не должна падать). */
export function palette(name) {
    const key = String(name || 'wasteland');
    return PALETTES[key] || PALETTES.wasteland;
}

// ---------------------------------------------------------------------------
// Чистая часть: случайность
// ---------------------------------------------------------------------------

/** Детерминированный генератор (тот же xorshift с размешиванием, что в рейде). */
export function makeRandom(seed) {
    let state = (Math.floor(Number(seed) || 1) >>> 0) || 1;
    state ^= state >>> 16; state = Math.imul(state, 0x7feb352d) >>> 0;
    state ^= state >>> 15; state = Math.imul(state, 0x846ca68b) >>> 0;
    state ^= state >>> 16;
    if (state === 0) state = 0x9e3779b9;
    const next = () => {
        state ^= state << 13; state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5; state >>>= 0;
        return state / 4294967296;
    };
    return {
        next,
        int(lo, hi) {
            const a = Math.ceil(lo);
            const b = Math.floor(hi);
            return a + Math.floor(next() * (b - a + 1));
        },
        range(lo, hi) { return lo + next() * (hi - lo); },
        pick(list) { return list.length ? list[Math.floor(next() * list.length) % list.length] : null; },
        chance(p) { return next() < p; },
    };
}

// ---------------------------------------------------------------------------
// Чистая часть: цвет и холст
// ---------------------------------------------------------------------------

/** `#rgb`/`#rrggbb`/`#rrggbbaa` → `[r, g, b, a]`. */
export function parseColor(text) {
    const s = String(text || '').trim().replace(/^#/, '');
    if (s.length === 3 || s.length === 4) {
        const out = [];
        for (const ch of s) out.push(parseInt(ch + ch, 16));
        while (out.length < 4) out.push(255);
        return out;
    }
    if (s.length === 6 || s.length === 8) {
        const out = [
            parseInt(s.slice(0, 2), 16),
            parseInt(s.slice(2, 4), 16),
            parseInt(s.slice(4, 6), 16),
            s.length === 8 ? parseInt(s.slice(6, 8), 16) : 255,
        ];
        return out.map((v) => (Number.isFinite(v) ? v : 0));
    }
    return [0, 0, 0, 255];
}

/** Оттенок по шагу рампы: 0 — тень, `steps - 1` — свет. */
export function rampColor(ramp, step) {
    const list = Array.isArray(ramp) && ramp.length ? ramp : ['#000000'];
    const index = Math.max(0, Math.min(list.length - 1, Math.floor(Number(step) || 0)));
    return parseColor(list[index]);
}

/** Пустой холст: RGBA, всё прозрачно. */
export function createCanvas(w, h) {
    const width = Math.max(1, Math.floor(Number(w) || 1));
    const height = Math.max(1, Math.floor(Number(h) || 1));
    return { w: width, h: height, data: new Uint8Array(width * height * 4) };
}

/** Поставить пиксель (с отсечением по краям). */
export function putPixel(canvas, x, y, rgba) {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= canvas.w || py >= canvas.h) return false;
    const at = (py * canvas.w + px) * 4;
    const c = rgba.length === 4 ? rgba : parseColor(rgba);
    canvas.data[at] = c[0];
    canvas.data[at + 1] = c[1];
    canvas.data[at + 2] = c[2];
    canvas.data[at + 3] = c[3] === undefined ? 255 : c[3];
    return true;
}

/** Прочитать пиксель: `[r, g, b, a]`. */
export function getPixel(canvas, x, y) {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= canvas.w || py >= canvas.h) return [0, 0, 0, 0];
    const at = (py * canvas.w + px) * 4;
    return [canvas.data[at], canvas.data[at + 1], canvas.data[at + 2], canvas.data[at + 3]];
}

/** Сколько непрозрачных пикселей. */
export function opaqueCount(canvas) {
    let count = 0;
    for (let i = 3; i < canvas.data.length; i += 4) if (canvas.data[i] > 0) count++;
    return count;
}

/** Прямоугольник (заливка). */
export function fillRect(canvas, x, y, w, h, rgba) {
    for (let j = 0; j < h; ++j) for (let i = 0; i < w; ++i) putPixel(canvas, x + i, y + j, rgba);
}

/** Эллипс (заливка): x, y — центр. */
export function fillEllipse(canvas, cx, cy, rx, ry, rgba) {
    const r = Math.max(1, Math.floor(rx));
    const s = Math.max(1, Math.floor(ry));
    for (let y = -s; y <= s; ++y) {
        for (let x = -r; x <= r; ++x) {
            if ((x * x) / (r * r) + (y * y) / (s * s) <= 1) putPixel(canvas, cx + x, cy + y, rgba);
        }
    }
}

// ---------------------------------------------------------------------------
// Чистая часть: тело по частям
// ---------------------------------------------------------------------------

/**
 * Пропорции тела: их немного, и они задаются долями высоты. Так разные
 * персонажи отличаются силуэтом, а не только цветом.
 */
export const BUILDS = {
    normal: { head: 0.22, torso: 0.36, legs: 0.42, armWidth: 2, shoulder: 0.42 },
    heavy: { head: 0.20, torso: 0.42, legs: 0.38, armWidth: 3, shoulder: 0.52 },
    thin: { head: 0.24, torso: 0.32, legs: 0.44, armWidth: 2, shoulder: 0.34 },
    child: { head: 0.30, torso: 0.32, legs: 0.38, armWidth: 2, shoulder: 0.36 },
};

/** Нормализовать описание спрайта. */
export function normalizeArt(raw) {
    if (!raw) return null;
    const w = Math.max(4, Math.floor(Number(raw.w) || 16));
    const h = Math.max(4, Math.floor(Number(raw.h) || 24));
    const build = BUILDS[String(raw.build || 'normal')] || BUILDS.normal;
    return {
        id: String(raw.id || 'art'),
        w, h,
        seed: Math.floor(Number(raw.seed) || 1),
        palette: String(raw.palette || 'wasteland'),
        build: String(raw.build || 'normal'),
        proportions: build,
        // Что рисуем: части тела, детали и что несёт в руках.
        parts: Array.isArray(raw.parts) ? raw.parts.map(String) : ['head', 'torso', 'arms', 'legs'],
        gear: Array.isArray(raw.gear) ? raw.gear.map(String) : ['belt', 'straps', 'pouch'],
        hold: raw.hold === undefined ? '' : String(raw.hold),
        dirs: Math.max(1, Math.floor(Number(raw.dirs) || 1)),
        // Свет: сдвиг рампы вверх для верхних пикселей.
        light: raw.light === false ? false : true,
        outline: raw.outline === false ? false : true,
    };
}

/**
 * Нарисовать персонажа: силуэт по частям, затем детали, затем свет.
 * Возвращает холст.
 */
export function renderArt(art, dir) {
    const spec = art && art.proportions ? art : normalizeArt(art);
    if (!spec) return createCanvas(8, 8);
    const pal = palette(spec.palette);
    // Сид НЕ зависит от направления: рисунок один, а направление — это зеркало
    // (и, если понадобится, оттенок). Иначе «вид сзади» оказывался другим
    // персонажем — нашлось тестом, который сравнивал с зеркалом переднего.
    const random = makeRandom(spec.seed);
    const canvas = createCanvas(spec.w, spec.h);
    const p = spec.proportions;

    const headH = Math.max(2, Math.round(spec.h * p.head));
    const torsoH = Math.max(2, Math.round(spec.h * p.torso));
    const legsH = Math.max(2, spec.h - headH - torsoH);
    const cx = Math.floor(spec.w / 2);
    const top = 0;

    const has = (part) => spec.parts.indexOf(part) >= 0;
    const rampOf = (name) => pal[name] || pal.cloth;

    // --- Голова ---
    if (has('head')) {
        const hw = Math.max(2, Math.round(spec.w * 0.34));
        const hy = top;
        fillEllipse(canvas, cx, hy + Math.floor(headH / 2), Math.floor(hw / 2), Math.floor(headH / 2),
                    rampColor(rampOf('skin'), 2));
        // Волосы: верхняя треть, тень вместо света.
        if (random.chance(0.7)) {
            const hair = rampColor(rampOf('dark'), 1);
            for (let y = 0; y < Math.max(1, Math.floor(headH / 3)); ++y) {
                for (let x = -Math.floor(hw / 2); x <= Math.floor(hw / 2); ++x) {
                    putPixel(canvas, cx + x, hy + y, hair);
                }
            }
        }
    }

    // --- Торс ---
    const torsoY = headH;
    if (has('torso')) {
        const shoulder = Math.max(2, Math.round(spec.w * p.shoulder));
        const waist = Math.max(2, Math.round(shoulder * 0.8));
        for (let y = 0; y < torsoH; ++y) {
            const t = torsoH > 1 ? y / (torsoH - 1) : 0;
            const half = Math.round((shoulder + (waist - shoulder) * t) / 2);
            const wear = random.chance(0.5) ? 'cloth' : 'leather';
            for (let x = -half; x <= half; ++x) {
                putPixel(canvas, cx + x, torsoY + y, rampColor(rampOf(wear), 2));
            }
        }
    }

    // --- Руки ---
    if (has('arms')) {
        const shoulder = Math.max(2, Math.round(spec.w * p.shoulder));
        const armW = Math.max(1, spec.proportions.armWidth);
        const armH = Math.round(torsoH * 0.85);
        for (let y = 0; y < armH; ++y) {
            for (let i = 0; i < armW; ++i) {
                putPixel(canvas, cx - Math.floor(shoulder / 2) - i, torsoY + y, rampColor(rampOf('cloth'), 1));
                putPixel(canvas, cx + Math.floor(shoulder / 2) + i, torsoY + y, rampColor(rampOf('cloth'), 1));
            }
        }
    }

    // --- Ноги ---
    if (has('legs')) {
        const legsY = torsoY + torsoH;
        const legW = Math.max(1, Math.floor(spec.w / 5));
        const gap = Math.max(1, Math.floor(spec.w / 8));
        for (let y = 0; y < legsH; ++y) {
            for (let i = 0; i < legW; ++i) {
                putPixel(canvas, cx - gap - i, legsY + y, rampColor(rampOf('cloth'), 1));
                putPixel(canvas, cx + gap + i - 1, legsY + y, rampColor(rampOf('cloth'), 1));
            }
        }
        // Обувь — тёмная полоса внизу.
        if (legsH > 2) {
            for (let i = 0; i < legW + 1; ++i) {
                putPixel(canvas, cx - gap - i, legsY + legsH - 1, rampColor(rampOf('dark'), 0));
                putPixel(canvas, cx + gap + i - 1, legsY + legsH - 1, rampColor(rampOf('dark'), 0));
            }
        }
    }

    // --- Детали ---
    for (const item of spec.gear) {
        if (item === 'belt' && has('torso')) {
            const y = torsoY + torsoH - 1;
            for (let x = 0; x < spec.w; ++x) {
                const c = getPixel(canvas, x, y);
                if (c[3] > 0) putPixel(canvas, x, y, rampColor(rampOf('leather'), 0));
            }
        } else if (item === 'straps' && has('torso')) {
            const x = cx - Math.max(1, Math.round(spec.w * 0.12));
            for (let y = torsoY; y < torsoY + torsoH; ++y) {
                if (getPixel(canvas, x, y)[3] > 0) putPixel(canvas, x, y, rampColor(rampOf('dark'), 2));
            }
        } else if (item === 'pouch') {
            if (random.chance(0.7)) {
                const y = Math.min(spec.h - 2, torsoY + torsoH - 2);
                const x = cx + Math.max(1, Math.round(spec.w * 0.2));
                fillRect(canvas, x, y, 2, 2, rampColor(rampOf('leather'), 2));
            }
        } else if (item === 'hood' && has('head')) {
            const hairline = Math.max(1, Math.floor(headH / 2));
            fillRect(canvas, cx - Math.max(2, Math.round(spec.w * 0.2)), 0,
                     Math.max(4, Math.round(spec.w * 0.4)), hairline, rampColor(rampOf('cloth'), 1));
        } else if (item === 'vest' && has('torso')) {
            const x0 = cx - Math.max(1, Math.round(spec.w * 0.18));
            fillRect(canvas, x0, torsoY, Math.max(2, Math.round(spec.w * 0.36)), torsoH, rampColor(rampOf('dark'), 1));
        } else if (item === 'gas' && has('head')) {
            const y = Math.floor(headH / 2);
            fillRect(canvas, cx - 1, y, 3, 2, rampColor(rampOf('metal'), 2));
        }
    }

    // --- Что несёт в руках ---
    if (spec.hold === 'rifle') {
        const y = torsoY + Math.max(1, Math.floor(torsoH / 2));
        fillRect(canvas, cx - Math.floor(spec.w / 2), y, Math.floor(spec.w * 0.9), 2, rampColor(rampOf('dark'), 0));
    } else if (spec.hold === 'bag') {
        fillRect(canvas, cx + Math.max(2, Math.round(spec.w * 0.3)), torsoY, 3, Math.max(3, Math.round(torsoH * 0.6)),
                 rampColor(rampOf('leather'), 1));
    }

    // --- Свет сверху слева и контур ---
    if (spec.light) applyLight(canvas, pal);
    if (spec.outline) applyOutline(canvas, pal);

    // --- Поворот: чётные кадры — как есть, нечётные — зеркало ---
    const turn = Math.floor(Number(dir) || 0);
    if (turn % 2 === 1) return mirrorCanvas(canvas);
    return canvas;
}

/**
 * Свет: у каждого непрозрачного пикселя смотрим на соседа сверху. Есть сосед —
 * пиксель в тени (нижний), нет — освещён (верхний). Просто, предсказуемо и
 * ровно то, что делает художник руками.
 */
export function applyLight(canvas, pal) {
    const colors = pal || PALETTES.wasteland;
    const data = canvas.data;
    for (let y = 0; y < canvas.h; ++y) {
        for (let x = 0; x < canvas.w; ++x) {
            const at = (y * canvas.w + x) * 4;
            if (data[at + 3] === 0) continue;
            const above = getPixel(canvas, x, y - 1);
            const below = getPixel(canvas, x, y + 1);
            let shift = 0;
            if (above[3] === 0) shift = 1;              // верхняя кромка — светлее
            else if (below[3] === 0) shift = -1;        // нижняя кромка — темнее
            if (shift === 0) continue;
            const shade = shift > 0 ? 1.18 : 0.82;
            data[at] = Math.max(0, Math.min(255, Math.round(data[at] * shade)));
            data[at + 1] = Math.max(0, Math.min(255, Math.round(data[at + 1] * shade)));
            data[at + 2] = Math.max(0, Math.min(255, Math.round(data[at + 2] * shade)));
        }
    }
    void colors;
}

/** Контур: вокруг непрозрачного пикселя, где пусто, ставим тёмный. */
export function applyOutline(canvas, pal) {
    const dark = rampColor((pal || PALETTES.wasteland).dark, 0);
    const copy = Uint8Array.from(canvas.data);
    const alphaAt = (x, y) => {
        if (x < 0 || y < 0 || x >= canvas.w || y >= canvas.h) return 0;
        return copy[(y * canvas.w + x) * 4 + 3];
    };
    for (let y = 0; y < canvas.h; ++y) {
        for (let x = 0; x < canvas.w; ++x) {
            if (alphaAt(x, y) > 0) continue;
            const near = alphaAt(x - 1, y) > 0 || alphaAt(x + 1, y) > 0
                      || alphaAt(x, y - 1) > 0 || alphaAt(x, y + 1) > 0;
            if (near) putPixel(canvas, x, y, dark);
        }
    }
}

/** Зеркальный холст. */
export function mirrorCanvas(canvas) {
    const out = createCanvas(canvas.w, canvas.h);
    for (let y = 0; y < canvas.h; ++y) {
        for (let x = 0; x < canvas.w; ++x) {
            const from = (y * canvas.w + (canvas.w - 1 - x)) * 4;
            const to = (y * canvas.w + x) * 4;
            out.data[to] = canvas.data[from];
            out.data[to + 1] = canvas.data[from + 1];
            out.data[to + 2] = canvas.data[from + 2];
            out.data[to + 3] = canvas.data[from + 3];
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Чистая часть: реестр
// ---------------------------------------------------------------------------

export function createArtLibrary() {
    const items = new Map();
    const lib = {
        define(raw) {
            const art = normalizeArt(raw);
            if (!art) { ctx.log('$.proc.define: нужно описание'); return null; }
            items.set(art.id, art);
            return art;
        },
        get(id) { return items.get(String(id)) || null; },
        has(id) { return items.has(String(id)); },
        ids() { return [...items.keys()]; },
        list() { return [...items.values()]; },
        remove(id) { return items.delete(String(id)); },
        clear() { const n = items.size; items.clear(); return n; },
        load(data) {
            if (!data || typeof data !== 'object') return 0;
            const list = Array.isArray(data) ? data : (data.art || []);
            let count = 0;
            for (const raw of list) if (lib.define(raw)) count++;
            return count;
        },
    };
    return lib;
}

// ---------------------------------------------------------------------------
// Подсистема
// ---------------------------------------------------------------------------

export function installProc($) {
    const lib = createArtLibrary();
    const sprites = new Map();     // id → спрайт движка

    const api = {
        /** Описать процедурный спрайт. */
        define(raw) { return lib.define(raw); },
        get(id) { return lib.get(id); },
        has(id) { return lib.has(id); },
        ids() { return lib.ids(); },
        list() { return lib.list(); },
        remove(id) { return lib.remove(id); },
        clear() { const n = lib.clear(); sprites.clear(); return n; },
        load(data) { return lib.load(data); },

        /** Палитры: `$.proc.palettes()` / `$.proc.palette('city')`. */
        palette(name) { return palette(name); },
        palettes() { return Object.keys(PALETTES); },

        /** Отрисовать: холст с RGBA-пикселями. */
        render(id, dir) {
            const art = typeof id === 'object' ? id : lib.get(id);
            if (!art) { ctx.log(`$.proc.render: нет описания "${id}"`); return null; }
            return renderArt(art, dir);
        },

        /** Пиксели холста — для записи в файл или текстуру. */
        pixels(canvas) { return canvas ? canvas.data : null; },

        /**
         * Сделать спрайт движка из описания: `$.proc.toSprite('hero', dir)`.
         * Спрайт кешируется по описанию и направлению.
         */
        toSprite(id, dir) {
            const art = typeof id === 'object' ? id : lib.get(id);
            if (!art) return null;
            const key = `${art.id}:${Math.floor(Number(dir) || 0)}`;
            if (sprites.has(key)) return sprites.get(key);
            const canvas = renderArt(art, dir);
            if (!canvas) return null;
            if (typeof engine === 'undefined' || typeof engine.textureFromPixels !== 'function') {
                ctx.log('$.proc.toSprite: нужен engine.textureFromPixels (нет движка)');
                return null;
            }
            const handle = engine.textureFromPixels(canvas.w, canvas.h, canvas.data);
            if (handle === undefined || handle === null || handle < 0) return null;
            sprites.set(key, handle);
            return handle;
        },

        /**
         * Спрайт-лист: все направления в одной текстуре.
         * `$.proc.sheet('hero')` → { sprite, cols, w, h }.
         */
        sheet(id) {
            const art = typeof id === 'object' ? id : lib.get(id);
            if (!art) return null;
            const cols = Math.max(1, art.dirs);
            const canvas = createCanvas(art.w * cols, art.h);
            for (let d = 0; d < cols; ++d) {
                const frame = renderArt(art, d);
                for (let y = 0; y < art.h; ++y) {
                    for (let x = 0; x < art.w; ++x) {
                        const [r, g, b, a] = getPixel(frame, x, y);
                        putPixel(canvas, d * art.w + x, y, [r, g, b, a]);
                    }
                }
            }
            const result = { canvas, cols, w: art.w, h: art.h, colsCount: cols, sprite: null };
            if (typeof engine !== 'undefined' && typeof engine.textureFromPixels === 'function') {
                const handle = engine.textureFromPixels(canvas.w, canvas.h, canvas.data);
                if (handle !== undefined && handle !== null && handle >= 0) result.sprite = handle;
            }
            return result;
        },

        /** Чистые ядра — для тестов и своих генераторов. */
        createArtLibrary,
        normalizeArt,
        renderArt,
        createCanvas,
        putPixel,
        getPixel,
        fillRect,
        fillEllipse,
        applyLight,
        applyOutline,
        mirrorCanvas,
        parseColor,
        rampColor,
        makeRandom,
        palette,
        PALETTES,
        BUILDS,

        /** Сколько непрозрачных пикселей в отрисовке (для проверок). */
        opaque(id, dir) {
            const art = typeof id === 'object' ? id : lib.get(id);
            return art ? opaqueCount(renderArt(art, dir)) : 0;
        },
    };

    $.proc = api;
    ctx.proc = api;
    return api;
}
