// ===========================================================================
// Tilemap Studio — редактор тайлкарты (формат `*.tilemap.json`, sdk/lib/kinds/
// tilemap.js). Редактирует конкретный тип данных, а не игру: слои, рисование,
// заливка, непроходимость, автотайл.
//
// Предпросмотр — настоящий тег `<tilemap>` (`$.tilemap`) с теми же параметрами,
// что прочтёт игра: `$('<tilemap>', $.fs.readJSON(файл))`. Тайлсет в палитре
// рисует тот же рантайм. Инструменты: кисть (ЛКМ), ластик, заливка, прямоугольник;
// ПКМ — пипетка, СКМ — панорама, колесо — масштаб. Правка мазка — один шаг undo.
// ===========================================================================

import { openStudio } from '../lib/studio_host.js';
import * as K from '../lib/kinds/tilemap.js';
import { escapeHtml, joinPath, dirOf } from '../lib/model.js';
import { button, fieldRow, pairRow, parseNum, isNum } from '../lib/kit.js';

export const standalone = true;

const TOOLS = [['brush', 'Кисть'], ['erase', 'Ластик'], ['fill', 'Заливка'], ['rect', 'Область']];
const ZOOMS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8];
const PAL = { w: 270, pad: 10 };

const layerOf = (h) => (h.model && h.model.layers[h.sel] ? h.model.layers[h.sel] : null);

/** Корень, от которого рантайм читает `src`: каталог проекта, иначе каталог файла. */
export function projectRoot(app, file) {
    const p = app.state.project;
    return p && file.startsWith(p.abs + '/') ? p.abs : dirOf(file);
}

function absSrc(h, src) {
    if (!src) return '';
    return /^([A-Za-z]:[\\/]|\/)/.test(src) ? src : joinPath(projectRoot(h.app, h.session.path), src);
}

function geometry(h) {
    const l = layerOf(h) || h.model.layers[0];
    const z = h.ext.zoom, t = h.model.tile || 32;
    const w = l.data[0].length, hh = l.data.length;
    const r = h.rect();
    const cx = r.x + (r.w - (h.ext.palette ? PAL.w + PAL.pad : 0)) / 2 + h.ext.panX;
    const cy = r.y + r.h / 2 + h.ext.panY;
    return { w, h: hh, tile: t, z, cx, cy, left: cx - (w * t * z) / 2, top: cy - (hh * t * z) / 2 };
}

function cellAt(h, px, py) {
    const g = geometry(h);
    const x = Math.floor((px - g.left) / (g.tile * g.z));
    const y = Math.floor((py - g.top) / (g.tile * g.z));
    return { x, y, ok: x >= 0 && y >= 0 && x < g.w && y < g.h };
}

function previewOpts(h) {
    const o = JSON.parse(JSON.stringify(h.model));
    o.src = absSrc(h, o.src);
    delete o.autotile;
    return o;
}

function mountMap(h) {
    unmountMap(h);
    if (!h.model || !h.model.src) return;
    try {
        const node = h.$('<tilemap>', previewOpts(h)).appendTo(h.$.world);
        if (h.model.autotile) node.autotile(h.model.autotile);
        h.ext.node = node;
        h.ext.tex = h.$.gfx.textureSize(absSrc(h, h.model.src));
        if (!h.ext.tex || h.ext.tex[0] <= 0) {
            h.ext.tex = null;
            h.note('warning', 'SDK_TILEMAP_SRC_MISSING', 'Не удалось загрузить тайлсет «' + h.model.src + '» относительно ' + projectRoot(h.app, h.session.path));
        }
    } catch (e) {
        h.ext.node = null;
        h.note('error', 'SDK_TILEMAP_RUNTIME', 'Рантайм отклонил параметры карты: ' + (e && e.message ? e.message : e));
    }
}

function unmountMap(h) {
    if (h.ext.node) { h.ext.node.remove(); h.ext.node = null; }
}

// Подложка карты и палитры — обычные узлы <rect> ниже слоя карты: примитивы $.gfx.draw рисуются
// поверх сцены и закрыли бы тайлы, поэтому фон делает сцена, а поверх идут только линии и подсветка.
function ensureDeco(h) {
    const $ = h.$, e = h.ext;
    if (!e.deco) {
        const mk = (color, layer) => $('<rect>').color(color).layer(layer).size(1, 1).appendTo($.world);
        e.deco = { frame: mk('#232b3d', -6), bg: mk('#0b0e14', -5), palFrame: mk('#0f131c', -6), palBg: mk('#0b0e14', -5), pal: null, palSrc: null };
    }
    return e.deco;
}

function removeDeco(h) {
    const d = h.ext.deco;
    if (!d) return;
    for (const k of ['frame', 'bg', 'palFrame', 'palBg', 'pal']) if (d[k]) d[k].remove();
    h.ext.deco = null;
}

function syncNode(h, g, pal) {
    const e = h.ext, d = ensureDeco(h), t = g.tile * g.z;
    if (e.node) {
        e.node.at(g.cx, g.cy).scale(g.z);
        e.node.visible(!e.idView);
    }
    d.frame.at(g.cx, g.cy).size(g.w * t + 4, g.h * t + 4);
    d.bg.at(g.cx, g.cy).size(g.w * t, g.h * t);
    const showPal = !!(pal && e.tex);
    d.palFrame.visible(showPal);
    d.palBg.visible(showPal);
    if (d.pal) d.pal.visible(showPal);
    if (!showPal) return;
    const src = absSrc(h, h.model.src);
    if (!d.pal || d.palSrc !== src) {
        if (d.pal) d.pal.remove();
        d.pal = h.$('<sprite>', { src }).appendTo(h.$.world);
        d.palSrc = src;
    }
    const k = Math.min(pal.w / e.tex[0], pal.h / e.tex[1]);
    const w = e.tex[0] * k, hh = e.tex[1] * k;
    e.palBox = { x: pal.x, y: pal.y, w, h: hh, k };
    d.pal.at(pal.x + w / 2, pal.y + hh / 2).size(w, hh);
    d.palBg.at(pal.x + w / 2, pal.y + hh / 2).size(w, hh);
    d.palFrame.at(pal.x + w / 2, pal.y + hh / 2).size(w + 12, hh + 12);
}

function idColor(id) {
    if (!id) return null;
    const hue = (id * 47) % 360;
    // HSL → RGB (насыщенность 0.55, светлота 0.5): различимые цвета id для режима без картинки.
    const c = 0.55, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = 0.5 - c / 2;
    const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
    return 'rgb(' + Math.round((r + m) * 255) + ',' + Math.round((g + m) * 255) + ',' + Math.round((b + m) * 255) + ')';
}

function solidSet(h, layer) {
    const s = layer.solid !== undefined ? layer.solid : h.model.solid;
    return s === true ? 'all' : (Array.isArray(s) ? new Set(s) : null);
}

function palRect(h) {
    const r = h.rect();
    return { x: r.x + r.w - PAL.w - PAL.pad, y: r.y + PAL.pad, w: PAL.w, h: Math.min(r.h - PAL.pad * 2, 300) };
}

const DEF = {
    id: 'tilemap-studio',
    title: 'Tilemap Studio',
    leftTitle: 'СЛОИ',
    kind: K,

    count(h) { return h.model.layers.length; },

    left(h) {
        return '<div class="list grow">' + h.model.layers.map((l, i) => {
            const sz = K.size(l);
            return '<div class="row' + (i === h.sel ? ' sel' : '') + '" data-key="' + i + '"><span class="row-name">' + escapeHtml(l.name || 'слой ' + i) +
                '</span><span class="row-dir">' + sz.w + '×' + sz.h + ' · depth ' + (l.depth === undefined ? 0 : l.depth) + '</span></div>';
        }).join('') + '</div>';
    },

    tools(h) {
        let html = TOOLS.map(([k, t]) => button('tool:' + k, t, h.ext.tool === k ? 'on' : '')).join('');
        html += button('grid', 'Сетка', h.ext.grid ? 'on' : '') + button('solid', 'Коллизии', h.ext.showSolid ? 'on' : '') +
            button('idview', 'Режим id', h.ext.idView ? 'on' : '') + button('palette', 'Палитра', h.ext.palette ? 'on' : '') +
            button('zoomout', '−', '') + button('zoomin', '+', '') + button('fit', 'Вписать', '');
        return html;
    },

    right(h) {
        const m = h.model, l = layerOf(h) || m.layers[0];
        const sz = K.size(l);
        const ids = Array.isArray(m.solid) ? m.solid.join(', ') : (m.solid === true ? 'все' : '');
        let html = '<h4>КИСТЬ</h4>' + fieldRow({ id: 'tm-brush', label: 'Тайл id', value: h.ext.brush, hint: '0 — пусто; id = номер ячейки тайлсета + 1' }) +
            '<div class="field-row"><button class="btn small" data-key="brush">Выбрать</button></div>' +
            '<h4>КАРТА</h4>' + fieldRow({ id: 'tm-src', label: 'Тайлсет', value: m.src, hint: 'путь от корня проекта' }) +
            pairRow('Тайл / колонки', 'tm-tile', m.tile, 'tm-cols', m.cols === undefined ? '' : m.cols) +
            fieldRow({ id: 'tm-solid', label: 'Твёрдые id', value: ids, hint: 'через запятую или «все»' }) +
            '<div class="field-row"><button class="btn small" data-key="map">Применить</button></div>' +
            '<h4>СЛОЙ</h4>' + fieldRow({ id: 'tm-lname', label: 'Имя', value: l.name || '' }) +
            fieldRow({ id: 'tm-depth', label: 'depth', value: l.depth === undefined ? 0 : l.depth }) +
            pairRow('Размер Ш, В', 'tm-w', sz.w, 'tm-h', sz.h) +
            '<div class="field-row"><button class="btn small" data-key="layer">Применить слой</button>' +
            '<button class="btn small" data-key="addlayer">+ Слой</button>' +
            '<button class="btn small danger" data-key="rmlayer">Удалить</button></div>' +
            '<div class="field-row">' + button('up', 'Выше', 'small') + button('down', 'Ниже', 'small') + '</div>' +
            '<h4>АВТОТАЙЛ</h4><div class="field-row">' +
            button('auto:off', 'Выкл', 'small' + (!m.autotile ? ' on' : '')) + button('auto:bit16', 'bit16', 'small' + (m.autotile && m.autotile.mode === 'bit16' ? ' on' : '')) +
            button('auto:blob47', 'blob47', 'small' + (m.autotile && m.autotile.mode === 'blob47' ? ' on' : '')) + '</div>' +
            '<div class="hint">Автотайл применяет игра: <span class="mono">$(\'#level\').autotile(file.autotile)</span>; предпросмотр делает то же.</div>';
        const cap = h.ext.tex ? K.tilesetCapacity(m, h.ext.tex[0], h.ext.tex[1]) : 0;
        html += '<div class="hint">Использован id до ' + K.maxUsedId(m) + (cap ? ' · в тайлсете ' + cap + ' ячеек' : '') + '</div>';
        if (cap && K.maxUsedId(m) > cap && !m.autotile) html += '<div class="card-note">Есть id больше размера тайлсета — такие тайлы рантайм не нарисует.</div>';
        html += '<h4>ИСПОЛЬЗОВАНИЕ В ИГРЕ</h4><div class="log">' + escapeHtml(K.snippet(h.session.path.split('/').pop())) + '</div>';
        return html;
    },

    onLeft(h, key) { h.select(parseInt(key, 10)); },

    onTool(h, key) {
        const a = api(h);
        if (key.startsWith('tool:')) a.setTool(key.slice(5));
        else if (key === 'grid') { h.ext.grid = !h.ext.grid; h.renderAll(); }
        else if (key === 'solid') { h.ext.showSolid = !h.ext.showSolid; h.renderAll(); }
        else if (key === 'idview') { h.ext.idView = !h.ext.idView; h.renderAll(); }
        else if (key === 'palette') { h.ext.palette = !h.ext.palette; h.renderAll(); }
        else if (key === 'zoomin') a.zoom(1);
        else if (key === 'zoomout') a.zoom(-1);
        else if (key === 'fit') a.fit();
    },

    onRight(h, key) {
        const a = api(h), d = h.doc;
        if (key === 'brush') a.setBrush(d.value('tm-brush'));
        else if (key === 'map') a.setMap({ src: d.value('tm-src'), tile: d.value('tm-tile'), cols: d.value('tm-cols'), solid: d.value('tm-solid') });
        else if (key === 'layer') a.setLayer(h.sel, { name: d.value('tm-lname'), depth: d.value('tm-depth'), w: d.value('tm-w'), h: d.value('tm-h') });
        else if (key === 'addlayer') a.addLayer();
        else if (key === 'rmlayer') a.removeLayer(h.sel);
        else if (key === 'up') a.moveLayer(h.sel, h.sel - 1);
        else if (key === 'down') a.moveLayer(h.sel, h.sel + 1);
        else if (key.startsWith('auto:')) a.setAutotile(key.slice(5));
    },

    mount(h) {
        Object.assign(h.ext, { tool: 'brush', brush: 1, grid: true, showSolid: false, idView: false, palette: true, zoom: 1, panX: 0, panY: 0, stroke: null, rectDrag: null, hover: null, tex: null, needFit: true });
        mountMap(h);
    },

    unmount(h) { unmountMap(h); removeDeco(h); h.doc.html('ds-overlay', ''); },

    changed(h) { mountMap(h); h.ext.dirtyOverlay = true; },

    tick(h) { frame(h); },

    hud(h) {
        const hv = h.ext.hover;
        const l = layerOf(h);
        const parts = [TOOLS.find((t) => t[0] === h.ext.tool)[1], '×' + h.ext.zoom, 'кисть ' + h.ext.brush];
        if (hv && hv.ok && l) parts.push('(' + hv.x + ', ' + hv.y + ') id ' + l.data[hv.y][hv.x]);
        return parts.join(' · ');
    },

    snapshot(h) {
        const l = layerOf(h);
        return {
            layers: h.model ? h.model.layers.length : 0, layer: h.sel, tool: h.ext.tool, brush: h.ext.brush, zoom: h.ext.zoom,
            size: l ? K.size(l) : null, node: !!h.ext.node, tileset: h.ext.tex ? { w: h.ext.tex[0], h: h.ext.tex[1] } : null,
        };
    },

    api(h) { return api(h); },
};

// --- Кадр: мышь, рисование мазка, сетка и палитра через $.gfx.draw ---------------------------------------------------
function frame(h) {
    const $ = h.$, p = h.ptr, e = h.ext;
    if (!h.model) return;
    if (e.needFit && h.rect().w > 0) { api(h).fit(); e.needFit = false; }
    const g = geometry(h);
    const pal = e.palette && e.tex ? palRect(h) : null;
    const inPal = pal && p.x >= pal.x && p.x < pal.x + pal.w && p.y >= pal.y && p.y < pal.y + pal.h;

    // Колесо: масштаб; средняя кнопка: панорама.
    if (p.inside && p.wheel !== 0 && !inPal) api(h).zoom(p.wheel > 0 ? 1 : -1);
    if (p.middle && (p.dx || p.dy)) { e.panX += p.dx; e.panY += p.dy; }

    const cell = p.inside && !inPal ? cellAt(h, p.x, p.y) : null;
    e.hover = cell;
    const l = layerOf(h);

    if (inPal && p.pressed) {
        const id = paletteId(h, pal, p.x, p.y);
        if (id) { e.brush = id; if (e.tool === 'erase') e.tool = 'brush'; h.renderAll(); }
    }

    if (cell && l) {
        if (p.right && !e.rightLatch) {
            e.rightLatch = true;
            if (cell.ok) { e.brush = l.data[cell.y][cell.x]; h.renderAll(); }
        }
        if (!p.right) e.rightLatch = false;

        if (p.pressed && cell.ok) {
            if (e.tool === 'fill') api(h).fillAt(cell.x, cell.y);
            else if (e.tool === 'rect') e.rectDrag = { x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y };
            else e.stroke = new Map();
        }
        if (p.down && e.stroke && cell.ok) {
            const id = e.tool === 'erase' ? 0 : e.brush;
            const key = cell.x + ',' + cell.y;
            if (!e.stroke.has(key) && l.data[cell.y][cell.x] !== id) {
                e.stroke.set(key, id);
                if (e.node) e.node.setTile(cell.x, cell.y, id, h.sel);   // мгновенный отклик; в модель — при отпускании
            }
        }
        if (p.down && e.rectDrag) {
            e.rectDrag.x1 = Math.max(0, Math.min(g.w - 1, cell.x));
            e.rectDrag.y1 = Math.max(0, Math.min(g.h - 1, cell.y));
        }
    }
    if (p.released) {
        if (e.stroke && e.stroke.size) {
            const stroke = e.stroke;
            e.stroke = null;
            api(h).commitStroke(stroke);
        } else e.stroke = null;
        if (e.rectDrag) {
            const r = e.rectDrag;
            e.rectDrag = null;
            api(h).fillRect(r.x0, r.y0, r.x1, r.y1, e.tool === 'erase' ? 0 : e.brush);
        }
    }

    syncNode(h, g, pal);
    draw(h, g, pal);
    const key = [e.tool, e.zoom, e.brush, cell ? cell.x + ',' + cell.y : ''].join('|');
    if (key !== e.hudKey) { e.hudKey = key; h.hud(); }
}

function draw(h, g, pal) {
    const $ = h.$, e = h.ext, l = layerOf(h);
    const r = h.rect();
    const t = g.tile * g.z;
    // Режим id: цветные клетки (диагностика данных, когда тайлсет не нужен или не загрузился).
    if (e.idView || !e.node) {
        for (let y = 0; y < l.data.length; y++) {
            for (let x = 0; x < l.data[0].length; x++) {
                const c = idColor(l.data[y][x]);
                if (c) $.gfx.draw.rect(g.left + x * t, g.top + y * t, t, t, c);
            }
        }
    }
    if (e.showSolid) {
        const solid = solidSet(h, l);
        if (solid) {
            for (let y = 0; y < l.data.length; y++) {
                for (let x = 0; x < l.data[0].length; x++) {
                    const id = l.data[y][x];
                    if (id && (solid === 'all' || solid.has(id))) $.gfx.draw.rect(g.left + x * t, g.top + y * t, t, t, 'rgba(255,90,60,0.38)');
                }
            }
        }
    }
    if (e.grid && t >= 6) {
        for (let x = 0; x <= g.w; x++) $.gfx.draw.line(g.left + x * t, g.top, g.left + x * t, g.top + g.h * t, 'rgba(255,255,255,0.10)', 1);
        for (let y = 0; y <= g.h; y++) $.gfx.draw.line(g.left, g.top + y * t, g.left + g.w * t, g.top + y * t, 'rgba(255,255,255,0.10)', 1);
    }
    // Тайлы текущего мазка (контур) и наведение.
    if (e.stroke) for (const key of e.stroke.keys()) {
        const [x, y] = key.split(',').map(Number);
        $.gfx.draw.rect(g.left + x * t, g.top + y * t, t, t, 'rgba(255,176,58,0.25)');
    }
    if (e.rectDrag) {
        const q = e.rectDrag;
        const x0 = Math.min(q.x0, q.x1), y0 = Math.min(q.y0, q.y1), x1 = Math.max(q.x0, q.x1), y1 = Math.max(q.y0, q.y1);
        $.gfx.draw.rect(g.left + x0 * t, g.top + y0 * t, (x1 - x0 + 1) * t, (y1 - y0 + 1) * t, 'rgba(74,217,145,0.28)');
    }
    if (e.hover && e.hover.ok) $.gfx.draw.rect(g.left + e.hover.x * t, g.top + e.hover.y * t, t, t, 'rgba(255,255,255,0.18)');
    // Палитра: тот же тайлсет, что у карты (узел <sprite> рисует рантайм); здесь только сетка и подсветка кисти.
    if (pal && e.tex && e.palBox) {
        const b = e.palBox;
        const cols = h.model.cols || Math.floor(e.tex[0] / h.model.tile);
        const cw = h.model.tile * b.k;
        const brush = e.brush - 1;
        if (brush >= 0) {
            const bx = b.x + (brush % cols) * cw, by = b.y + Math.floor(brush / cols) * cw;
            $.gfx.draw.rect(bx, by, cw, cw, 'rgba(255,90,60,0.35)');
        }
        for (let c = 0; c <= cols && c * cw <= b.w + 0.5; c++) $.gfx.draw.line(b.x + c * cw, b.y, b.x + c * cw, b.y + b.h, 'rgba(255,255,255,0.12)', 1);
        for (let y = 0; y * cw <= b.h + 0.5; y++) $.gfx.draw.line(b.x, b.y + y * cw, b.x + Math.min(b.w, cols * cw), b.y + y * cw, 'rgba(255,255,255,0.12)', 1);
    }
}

function paletteId(h, pal, px, py) {
    const b = h.ext.palBox;
    if (!b || px < b.x || py < b.y || px >= b.x + b.w || py >= b.y + b.h) return 0;
    const cw = h.model.tile * b.k;
    const cols = h.model.cols || Math.floor(h.ext.tex[0] / h.model.tile);
    const cx = Math.floor((px - b.x) / cw), cy = Math.floor((py - b.y) / cw);
    return cx < cols ? cy * cols + cx + 1 : 0;
}

// --- Операции (кнопка человека и вызов агента — одно и то же) ----------------------------------------------------------
function api(h) {
    const num = (t) => parseNum(t);
    const ZOOM = ZOOMS;
    return {
        setTool(t) { if (TOOLS.some((x) => x[0] === t)) { h.ext.tool = t; h.renderAll(); } return h.ext.tool; },
        setBrush(text) {
            const v = num(text);
            if (v === null || Number.isNaN(v) || v < 0 || v > K.MAX_ID || Math.floor(v) !== v) { h.note('error', 'SDK_EDIT_REJECTED', 'id тайла — целое 0..' + K.MAX_ID); return h.ext.brush; }
            h.ext.brush = v;
            h.renderAll();
            return v;
        },
        zoom(dir) {
            let i = ZOOM.findIndex((z) => z >= h.ext.zoom - 1e-9);
            if (i < 0) i = ZOOM.length - 1;
            i = dir > 0 ? Math.min(ZOOM.length - 1, ZOOM[i] > h.ext.zoom + 1e-9 ? i : i + 1) : Math.max(0, i - 1);
            h.ext.zoom = ZOOM[i];
            return h.ext.zoom;
        },
        fit() {
            const l = layerOf(h) || h.model.layers[0];
            const r = h.rect();
            const availW = r.w - (h.ext.palette ? PAL.w + PAL.pad * 2 : 0) - 40, availH = r.h - 40;
            const wpx = l.data[0].length * h.model.tile, hpx = l.data.length * h.model.tile;
            const z = Math.min(availW / wpx, availH / hpx);
            h.ext.zoom = Math.max(ZOOM[0], Math.min(ZOOM[ZOOM.length - 1], Math.floor(z * 4) / 4 || ZOOM[0]));
            h.ext.panX = 0; h.ext.panY = 0;
            return h.ext.zoom;
        },
        /** Один тайл (для агента). Каждый вызов — отдельный шаг undo. */
        paint(x, y, id) {
            return h.run('тайл', () => K.setTile(layerOf(h), x, y, id)) !== null;
        },
        commitStroke(stroke) {
            const l = layerOf(h);
            if (!l) return false;
            return h.run('мазок', () => { for (const [key, id] of stroke) { const [x, y] = key.split(',').map(Number); K.setTile(l, x, y, id); } }) !== null;
        },
        fillRect(x0, y0, x1, y1, id) {
            return h.run('область', () => K.fillRect(layerOf(h), x0, y0, x1, y1, id === undefined ? h.ext.brush : id)) !== null;
        },
        fillAt(x, y, id) {
            return h.run('заливка', () => K.floodFill(layerOf(h), x, y, id === undefined ? (h.ext.tool === 'erase' ? 0 : h.ext.brush) : id)) !== null;
        },
        setMap(f) {
            return h.run('карта', (m) => {
                if (f.src !== undefined) m.src = String(f.src).trim();
                if (f.tile !== undefined) {
                    const v = num(f.tile);
                    if (v === null || Number.isNaN(v) || !(v >= 1 && v <= 512) || Math.floor(v) !== v) throw new Error('Размер тайла — целое 1..512');
                    m.tile = v;
                }
                if (f.cols !== undefined) {
                    const v = num(f.cols);
                    if (v === null) delete m.cols;
                    else if (Number.isNaN(v) || !(v >= 1 && v <= 1024) || Math.floor(v) !== v) throw new Error('Колонок тайлсета — целое 1..1024');
                    else m.cols = v;
                }
                if (f.solid !== undefined) {
                    const t = String(f.solid).trim();
                    if (t === '') delete m.solid;
                    else if (/^(все|all|true)$/i.test(t)) m.solid = true;
                    else {
                        const list = t.split(/[,\s]+/).filter(Boolean).map(Number);
                        if (!list.every((x) => Number.isInteger(x) && x >= 1 && x <= K.MAX_ID)) throw new Error('Твёрдые id — целые 1..' + K.MAX_ID + ' через запятую');
                        m.solid = list;
                    }
                }
            }) !== null;
        },
        setLayer(i, f) {
            return h.run('слой', (m) => {
                const l = m.layers[i];
                if (!l) throw new Error('Нет слоя ' + i);
                if (f.name !== undefined) { const n = String(f.name).trim(); if (n) l.name = n; else delete l.name; }
                if (f.depth !== undefined) { const v = num(f.depth); if (v === null || Number.isNaN(v)) throw new Error('depth — число'); l.depth = v; }
                if (f.w !== undefined || f.h !== undefined) {
                    const sz = K.size(l);
                    const w = f.w === undefined ? sz.w : num(f.w), hh = f.h === undefined ? sz.h : num(f.h);
                    if (w !== sz.w || hh !== sz.h) K.resize(l, w, hh);
                }
            }) !== null;
        },
        addLayer(name) { const r = h.run('новый слой', (m) => K.addLayer(m, name)); if (r !== null) h.select(r); return r; },
        removeLayer(i) { return h.run('удаление слоя', (m) => K.removeLayer(m, i)) !== null; },
        moveLayer(i, to) { const ok = h.run('порядок слоёв', (m) => K.moveLayer(m, i, to)) !== null; if (ok) h.select(Math.max(0, Math.min(h.model.layers.length - 1, to))); return ok; },
        setAutotile(mode) {
            return h.run('автотайл', (m) => {
                if (mode === 'off') delete m.autotile;
                else m.autotile = { mode, base: 1, solid: Array.isArray(m.solid) ? m.solid.slice() : [1] };
            }) !== null;
        },
        tileAt(x, y) { const l = layerOf(h); return l && K.inBounds(l, x, y) ? l.data[y][x] : null; },
        node: () => h.ext.node,
    };
}

export async function open(app, args) {
    return openStudio(app, DEF, args);
}
