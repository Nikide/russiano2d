// ===========================================================================
// Несколько камер в одном кадре: сплитскрин и второй вид.
//
// ЗАЧЕМ И КАК. Движок рисует в один проход и одну цель: сциссора и смены
// viewport в проходе нет, а «камера в текстуру» для каждой камеры стоила бы
// по цели из бюджета 256 текстур. Но регион экрана выражается ПРОЕКЦИЕЙ:
// если взять камеру с зумом `k` и центром `c`, её кадр займёт прямоугольник
// шириной `W/k` и высотой `H/k` вокруг `c`. Значит сплитскрин не требует ни
// сциссора, ни отдельных целей — достаточно пересчитать (x, y, zoom) так,
// чтобы кадр лёг в нужный прямоугольник.
//
// Камеры рисуются в ОДИН батч кадра, по порядку. Регионы не пересекаются,
// поэтому поздняя камера просто ложится поверх. Плата — узлы проходят N раз:
// при сплитскрине это неизбежно и предсказуемо.
//
// Что НЕ делается: разная пост-обработка на камеру, разный свет на камеру,
// отдельная цель на камеру. Это требует проходов и целей и сознательно не
// поддерживается (см. docs/highlevel/camera.md §1.2).
// ===========================================================================

import { ctx, engineOf, query } from './core.js';

// Вторичные камеры: имя → состояние. Основная (одна) живёт в camera.js и
// остаётся «главной» для $.camera: сплитскрин её не подменяет.
const extra = new Map();

// Порядок отрисовки. Основная камера идёт в списке обычным именем.
let order = [];

// PIP («картинка в картинке»): камера ПОВЕРХ основного кадра в своём
// прямоугольнике. Одна штука на игру — зеркало заднего вида, второй вид,
// обзорная миникарта.
let pip = null;



function num(value, fallback) {
    const v = Number(value);
    return Number.isFinite(v) ? v : fallback;
}

/**
 * Раскладка регионов для `count` камер: массив `{ x, y, w, h }` в пикселях
 * окна. 1 — весь экран, 2 — половины по горизонтали, 4 — квадраты 2×2,
 * остальные — колонки (для 3 — три вертикальные полосы).
 */
export function splitLayout(count, width, height) {
    const n = Math.max(1, Math.floor(num(count, 1)));
    const w = Math.max(1, num(width, 1));
    const h = Math.max(1, num(height, 1));
    if (n === 1) return [{ x: 0, y: 0, w, h }];
    if (n === 2) {
        return [{ x: 0, y: 0, w: w / 2, h },
                { x: w / 2, y: 0, w: w / 2, h }];
    }
    if (n === 4) {
        const hw = w / 2, hh = h / 2;
        return [{ x: 0, y: 0, w: hw, h: hh },
                { x: hw, y: 0, w: hw, h: hh },
                { x: 0, y: hh, w: hw, h: hh },
                { x: hw, y: hh, w: hw, h: hh }];
    }
    // Общий случай: вертикальные полосы.
    const out = [];
    for (let i = 0; i < n; ++i) out.push({ x: i * w / n, y: 0, w: w / n, h });
    return out;
}

/**
 * Камера, чей кадр ровно накрывает регион `r`.
 *
 * Вывод: точка мира `c` (центр камеры) должна попасть в центр региона, а
 * масштаб равен `w_региона / W`, откуда `zoom = W / w_региона`. Позицию
 * пересчитываем обратно из желаемого центра экрана — это и есть вся
 * «мультикамерность»: отдельная цель не нужна.
 */
export function regionCamera(cam, r, width, height) {
    const W = Math.max(1, num(width, 1));
    const H = Math.max(1, num(height, 1));
    const zoom = W / Math.max(1, num(r.w, W));
    const cx = r.x + r.w / 2;             // куда регион должен попасть на экране
    const cy = r.y + r.h / 2;
    // Сдвиг считаем от центра КАДРА к центру РЕГИОНА и ВЫЧИТАЕМ его из позиции:
    // камера ставит свою точку в центр кадра, значит, чтобы точка осталась
    // на месте, саму камеру надо отодвинуть в противоположную сторону.
    //
    // Была ошибка знака: сдвиг прибавлялся, и спрайт уезжал на
    // (region.x − region.w/2, region.y − region.h/2) — вчетверо мимо.
    const dx = (cx - W / 2) / zoom;
    const dy = (cy - H / 2) / zoom;
    return {
        x: num(cam.x, 0) - dx,
        y: num(cam.y, 0) - dy,
        zoom,
        rotation: num(cam.rotation, 0),
        shake_x: num(cam.shake_x, 0),
        shake_y: num(cam.shake_y, 0),
        // Прозрачность прохода и отказ от фона — для камеры ПОВЕРХ основного
        // кадра (картинка в картинке); задаются через `add(..., { alpha, bg })`.
        alpha: cam.alpha === undefined ? 1 : cam.alpha,
        bg: cam.bg,
        // РЕГИОН едет в `_region`; `w`/`h` — размер КАДРА, как у главной
        // камеры. Путать их нельзя: `w`/`h` читает setView как центр кадра.
        _region: { ...r },
        w: W,
        h: H,
    };
}

/** Список камер для прохода кадра: главная, затем вторичные по порядку. */
export function viewCams(cam) {
    if (!extra.size) return [cam];
    // PIP следит за узлом в МИРОВЫХ координатах: подтягиваем его до прохода.
    syncPip();
    const W = engineOf() ? engineOf().width : 0;
    const H = engineOf() ? engineOf().height : 0;
    const out = [];
    const named = order.length ? order : ['', ...extra.keys()];
    for (const name of named) {
        if (!name) { const c = { ...cam }; c._name = ''; c._rect = null; out.push(c); continue; }
        const view = extra.get(name);
        if (!view) continue;
        const c = regionCamera(view, view.rect, W, H);
        c._name = name;
        c._rect = view.rect ? { ...view.rect } : null;
        out.push(c);
    }
    // Главной в списке могло не оказаться (пользователь задал порядок) —
    // тогда добавляем её первой: без неё сплитскрин потерял бы камеру игрока.
    if (!named.includes('')) {
        const c = { ...cam };
        c._name = '';
        c._rect = null;
        out.unshift(c);
    }
    return out;
}

/**
 * Подтянуть PIP к узлу, за которым он следит. Координаты МИРОВЫЕ; узел берём из
 * общего реестра, чтобы отрисовка не зависела от сцены.
 */
function syncPip() {
    if (!pip || pip.at === null) return;
    const view = extra.get('pip');
    if (!view) return;
    let x = null, y = null;
    if (typeof pip.at === 'object' && pip.at !== null) {
        x = num(pip.at.x, null);
        y = num(pip.at.y, null);
    } else {
        // query() отдаёт МАССИВ узлов, а не узел.
        const found = query(pip.at);
        const node = Array.isArray(found) ? found[0] : found;
        if (node) { x = num(node.x, null); y = num(node.y, null); }
    }
    if (x === null || y === null) return;
    view.x = x;
    view.y = y;
}

/** Текущее состояние главной камеры — без обращения к $.camera из модуля. */
let primary = () => ({ x: 0, y: 0, zoom: 1, rotation: 0, shake_x: 0, shake_y: 0 });

/** Камера сообщает модулю, как её прочитать (ставит camera.js при установке). */
export function setPrimaryCameraSource(fn) { if (typeof fn === 'function') primary = fn; }

export function installViewports($) {
    const api = {
        /**
         * Завести вторичную камеру: `$.camera.add('p2')`. Возвращает имя или
         * null. Регион можно задать явно: `{ x, y, w, h }`.
         */
        add(name, opts) {
            const key = name === undefined || name === null ? '' : String(name);
            if (!key) { ctx.log('$.camera.add: нужно имя'); return null; }
            const o = opts || {};
            const W = engineOf() ? engineOf().width : 800;
            const H = engineOf() ? engineOf().height : 600;
            const view = {
                x: num(o.x, W / 2), y: num(o.y, H / 2),
                zoom: Math.max(0.01, num(o.zoom, 1)),
                rotation: num(o.rotation, 0),
                shake_x: 0, shake_y: 0,
                rect: o.rect ? { ...o.rect } : null,
                follow: o.follow === undefined ? null : o.follow,
            };
            extra.set(key, view);
            if (!order.includes(key)) order.push(key);
            return key;
        },

        /** Убрать вторичную камеру. */
        remove(name) {
            const key = String(name);
            const had = extra.delete(key);
            order = order.filter((n) => n !== key);
            return had;
        },

        /** Список вторичных камер. */
        list() { return Array.from(extra.keys()); },

        /** Сколько камер рисуется (главная + вторичные). */
        count() { return 1 + extra.size; },

        /**
         * Включить сплитскрин на `count` камер: регионы разложатся сами
         * (`splitLayout`), камеры получат имена `p2`, `p3`, … Имена и их
         * состояние НЕ сбрасываются, если камера уже была.
         */
        split(count, opts) {
            const n = Math.max(1, Math.floor(num(count, 1)));
            const W = engineOf() ? engineOf().width : 800;
            const H = engineOf() ? engineOf().height : 600;
            const layout = splitLayout(n, W, H);
            const wanted = [];
            for (let i = 1; i < n; ++i) {
                const key = 'p' + (i + 1);
                wanted.push(key);
                if (!extra.has(key)) {
                    api.add(key, { x: W / 2, y: H / 2 });
                }
                extra.get(key).rect = layout[i];
            }
            // Лишние вторичные камеры уходят: иначе после split(2) на экране
            // остался бы хвост от прошлого split(4).
            for (const key of Array.from(extra.keys())) {
                if (!wanted.includes(key)) api.remove(key);
            }
            order = ['', ...wanted];
            return api.count();
        },

        /** Точка, куда смотрит вторичная камера. */
        at(name, x, y) {
            const view = extra.get(String(name));
            if (!view) return null;
            if (x === undefined) return { x: view.x, y: view.y };
            view.x = num(x, view.x);
            view.y = num(y, view.y);
            return { x: view.x, y: view.y };
        },

        /** Зум вторичной камеры. */
        zoom(name, value) {
            const view = extra.get(String(name));
            if (!view) return null;
            if (value === undefined) return view.zoom;
            view.zoom = Math.max(0.01, num(value, view.zoom));
            return view.zoom;
        },

        /** Явный регион вторичной камеры: `$.camera.region('p2', {x,y,w,h})`. */
        region(name, rect) {
            const view = extra.get(String(name));
            if (!view) return null;
            if (rect === undefined) return view.rect ? { ...view.rect } : null;
            view.rect = rect ? { ...rect } : null;
            return view.rect ? { ...view.rect } : null;
        },

        /**
         * Снимок раскладки: что и где рисуется в этом кадре.
         *
         * Читаем ИМЯ и РЕГИОН из тех же объектов, которые ушли в отрисовку
         * (`viewCams` их помечает), а не пересчитываем: пересчёт по имени
         * разошёлся с реальностью — PIP рисовался в своём прямоугольнике, а
         * `views()` показывал половину окна.
         */
        describe() {
            const W = engineOf() ? engineOf().width : 0;
            const H = engineOf() ? engineOf().height : 0;
            return viewCams(primary()).map((c, i) => ({
                name: c._name || '',
                x: c.x, y: c.y, zoom: c.zoom,
                rect: c._rect || (i === 0 ? { x: 0, y: 0, w: W, h: H } : null),
            }));
        },

        // Внутренние: их зовёт render.js и камера.
        _extra: extra,
        _layout: splitLayout,
        _regionCamera: regionCamera,
        _viewCams: viewCams,
        /**
         * Картинка в картинке: `$.camera.pip({x, y, w, h}, opts?)` рисует
         * вторую камеру поверх основного кадра в указанном прямоугольнике.
         *
         * Это «камера в текстуру» без отдельной цели: регион выражен проекцией
         * (зум + центр), а прозрачность и отказ от фона делают кадр наложением,
         * а не заливкой.
         *
         * `opts`: `at` (узел или `{x, y}` — за кем следить), `zoom`, `alpha`
         * (по умолчанию 0.9), `bg` (по умолчанию false).
         */
        pip(rect, opts) {
            if (!rect) return pip ? { ...pip.rect } : null;
            const o = opts || {};
            const W = engineOf() ? engineOf().width : 800;
            const H = engineOf() ? engineOf().height : 600;
            pip = {
                rect: { x: num(rect.x, 0), y: num(rect.y, 0),
                        w: Math.max(8, num(rect.w, W / 4)),
                        h: Math.max(8, num(rect.h, H / 4)) },
                at: o.at === undefined ? null : o.at,
                zoom: o.zoom === undefined ? 1 : Math.max(0.01, num(o.zoom, 1)),
                alpha: o.alpha === undefined ? 0.9 : Math.max(0, Math.min(1, num(o.alpha, 0.9))),
                bg: o.bg === undefined ? false : !!o.bg,
            };
            if (!extra.has('pip')) api.add('pip', { x: W / 2, y: H / 2 });
            const view = extra.get('pip');
            view.rect = { ...pip.rect };
            view.zoom = pip.zoom;
            view.alpha = pip.alpha;
            view.bg = pip.bg;
            // PIP идёт ПОСЛЕДНИМ: он рисуется поверх остальных камер.
            order = order.filter((n) => n !== 'pip');
            order.push('pip');
            syncPip();
            return { ...pip.rect };
        },

        /** Убрать PIP. */
        pipClear() {
            if (!pip) return false;
            pip = null;
            api.remove('pip');
            return true;
        },

        /** Настроенный PIP: прямоугольник, зум, прозрачность, за кем следит. */
        pipInfo() {
            return pip ? { ...pip.rect, zoom: pip.zoom, alpha: pip.alpha, bg: pip.bg,
                           at: pip.at === null ? null : String(pip.at) } : null;
        },

        /**
         * Миникарта: PIP за узлом, без фона, с обзорным зумом.
         *
         * ```js
         * $.camera.minimap({ x: 620, y: 20, w: 200, h: 150 },
         *                  { at: '#hero', zoom: 0.6 });
         * ```
         */
        minimap(rect, opts) {
            const o = opts || {};
            return api.pip(rect, { at: o.at, zoom: o.zoom === undefined ? 0.6 : o.zoom,
                                   alpha: o.alpha === undefined ? 0.85 : o.alpha,
                                   bg: o.bg === undefined ? false : o.bg });
        },

        _reset() { extra.clear(); order = []; pip = null; },
    };
    return api;
}
