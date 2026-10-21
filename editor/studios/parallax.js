// ===========================================================================
// Parallax — студия Editor для `*.layers.json` (формат — sdk/lib/kinds/layers.js).
// Предпросмотр — настоящие слои `$.layers.create` со спрайтами, камера едет
// мышью или автопрокруткой, слои отстают по своему parallax, как в игре.
//
// Слева — слои, снизу — спрайты выбранного слоя и общий оттенок, в библиотеке —
// картинки проекта (клик ставит спрайт в центр вида). Спрайт в превью можно
// выбрать и перетащить: экранная позиция считается так же, как у `$.layers`
// (смещение = (камера − камера при создании) × (1 − parallax)).
// ===========================================================================

import * as K from '../lib/shared/kinds/layers.js';
import { createWorkspace, button } from '../lib/asset_workspace.js';
import { esc, numberOf, FILTERS, pickProjectFile } from '../lib/studio_kit.js';

export const meta = { id: 'parallax', title: 'Parallax', icon: 'layers', match: (p) => /\.layers\.json$/i.test(p) };

const IMAGE = /\.(png|jpe?g|webp|bmp)$/i;
const clone = (v) => JSON.parse(JSON.stringify(v));

export function create(host) {
    const $ = host.$;
    const layers = (w) => (Array.isArray(w.data.layers) ? w.data.layers : []);
    const cur = (w) => layers(w)[w.selected] || null;
    const sprites = (w) => { const l = cur(w); return l && Array.isArray(l.sprites) ? l.sprites : []; };
    const factor = (l) => (typeof l.parallax === 'number' ? l.parallax : 1);

    // Камера: центр мира (cx, cy) встаёт в центр холста.
    function camera(w) {
        const r = w.rect(), win = $.gfx.size(), e = w.ext;
        const ox = r && r.w > 0 ? win.w / 2 - (r.x + r.w / 2) : 0, oy = r && r.h > 0 ? win.h / 2 - (r.y + r.h / 2) : 0;
        return { x: e.base.x + e.panX + ox, y: e.base.y + e.panY + oy, win };
    }
    function baseOf(w) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const l of layers(w)) for (const s of l.sprites || []) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); }
        return Number.isFinite(x0) ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : { x: 0, y: 0 };
    }
    function spriteSize(w, s) {
        if (s.w && s.h) return { w: s.w, h: s.h };
        try { const t = $.gfx.textureSize(w.path(s.src)); if (t && t[0]) return { w: t[0], h: t[1] }; } catch (_) { /* нет картинки — рамка по умолчанию */ }
        return { w: 32, h: 32 };
    }
    // Экранный прямоугольник спрайта слоя l при текущей камере.
    // Смещение берём у живого узла ($.layers.offset); без узла — та же формула вручную.
    function screenRect(w, l, s, node) {
        const c = camera(w), c0 = w.ext.cam0 || c, k = 1 - factor(l), z = spriteSize(w, s);
        const off = node ? $.layers.offset(node) : { x: (c.x - c0.x) * k, y: (c.y - c0.y) * k };
        const vx = s.x + off.x, vy = s.y + off.y;
        const x = vx - c.x + c.win.w / 2, y = vy - c.y + c.win.h / 2;
        return { x: x - z.w / 2, y: y - z.h / 2, w: z.w, h: z.h, cx: x, cy: y };
    }

    function addLayer(w, name) {
        let i = -1;
        w.edit('Слой', (m) => { i = K.newLayer(m, name); });
        if (i >= 0) w.select(i);
        return i;
    }
    function moveLayer(w, to) {
        const i = w.selected, list = layers(w);
        if (to < 0 || to >= list.length || to === i) return false;
        const ok = w.edit('Порядок слоя', (m) => {
            const a = m.layers[i], b = m.layers[to];
            const oa = a.order === undefined ? 1 : a.order, ob = b.order === undefined ? 1 : b.order;
            a.order = ob === oa ? ob + (to > i ? 1 : -1) : ob; b.order = oa;
            m.layers.splice(i, 1); m.layers.splice(to, 0, a);
        });
        if (ok) w.select(to);
        return ok;
    }
    function addSprite(w, sprite, count) {
        if (!cur(w)) return false;
        const n = Math.max(1, Math.min(K.MAX_SPRITES, count || 1)), li = w.selected;
        const ok = w.edit('Спрайт', (m) => {
            const l = m.layers[li];
            l.sprites = l.sprites || [];
            if (l.sprites.length + n > K.MAX_SPRITES) throw new Error('В слое не больше ' + K.MAX_SPRITES + ' спрайтов');
            for (let k = 0; k < n; k++) l.sprites.push(Object.assign({}, sprite, { x: sprite.x + (sprite.w || 0) * k }));
        });
        if (ok) w.ext.sprite = sprites(w).length - 1;
        return ok;
    }
    // Картинка из библиотеки — в центр видимой части выбранного слоя.
    function placeImage(w, rel) {
        const l = cur(w);
        if (!l) throw new Error('Сначала выберите слой');
        const c = camera(w), c0 = w.ext.cam0 || c, k = 1 - factor(l);
        const r = w.rect();
        const sx = r ? r.x + r.w / 2 : c.win.w / 2, sy = r ? r.y + r.h / 2 : c.win.h / 2;
        const x = Math.round(sx + c.x - c.win.w / 2 - (c.x - c0.x) * k), y = Math.round(sy + c.y - c.win.h / 2 - (c.y - c0.y) * k);
        return addSprite(w, { src: rel, x, y });
    }

    function bottom(w) {
        const l = cur(w), list = sprites(w), si = w.ext.sprite, s = list[si], m = w.data.modulate || {};
        let html = '<div class="px-bottom"><div class="px-col">';
        html += '<span class="st-h first">Спрайты слоя' + (l ? ' «' + esc(l.name) + '»' : '') + '</span><div class="px-list">';
        html += list.length ? list.map((sp, i) => '<div class="st-row' + (i === si ? ' sel' : '') + '" data-key="sprite:' + i + '">' + esc(String(sp.src).split('/').pop()) +
            '<span class="st-sub">' + sp.x + ', ' + sp.y + (sp.w ? ' · ' + sp.w + '×' + sp.h : '') + '</span></div>').join('') : '<span class="st-empty">Нет спрайтов: картинка из библиотеки слева или поле ниже.</span>';
        html += '</div></div><div class="px-col">';
        if (s) {
            html += '<span class="st-h first">Спрайт</span>' +
                '<div class="st-field"><label>src</label><input id="px-src" class="st-in" type="text" value="' + esc(s.src) + '"/>' + button('sprite:src', '…') + '</div>' +
                '<div class="st-field"><label>x, y</label><input id="px-x" class="st-in" type="text" value="' + esc(s.x) + '"/><input id="px-y" class="st-in" type="text" value="' + esc(s.y) + '"/></div>' +
                '<div class="st-field"><label>w, h</label><input id="px-w" class="st-in" type="text" value="' + esc(s.w === undefined ? '' : s.w) + '"/><input id="px-h" class="st-in" type="text" value="' + esc(s.h === undefined ? '' : s.h) + '"/></div>' +
                '<div class="st-btns">' + button('sprite:apply', 'Применить') + button('sprite:del', 'Удалить') + button('sprite:row', 'Ряд ×') + '<input id="px-count" class="st-in px-n" type="text" value="3"/></div>';
        } else html += '<span class="st-note">Выберите спрайт в списке или в превью.</span>';
        html += '<span class="st-h">Общий оттенок</span><div class="st-field"><label>цвет, alpha</label><input id="px-mcolor" class="st-in" type="text" value="' + esc(m.color || '') + '"/><input id="px-malpha" class="st-in" type="text" value="' + esc(m.alpha === undefined ? '' : m.alpha) + '"/>' + button('modulate', 'OK') + '</div>';
        return html + '</div></div>';
    }

    function applySprite(w) {
        const s = sprites(w)[w.ext.sprite];
        if (!s) return false;
        const src = String(w.doc.value('px-src') || '').trim(), x = numberOf(w.doc, 'px-x'), y = numberOf(w.doc, 'px-y');
        const sw = numberOf(w.doc, 'px-w'), sh = numberOf(w.doc, 'px-h');
        if (!src) throw new Error('Укажите путь к картинке');
        if (x === null || y === null) throw new Error('x и y — числа');
        if ((sw === null) !== (sh === null) || (sw !== null && (sw <= 0 || sh <= 0))) throw new Error('w и h — оба пустые или оба > 0');
        const li = w.selected, si = w.ext.sprite;
        return w.edit('Спрайт', (m) => {
            const t = m.layers[li].sprites[si];
            t.src = src; t.x = x; t.y = y;
            if (sw === null) { delete t.w; delete t.h; } else { t.w = sw; t.h = sh; }
        });
    }

    const def = {
        kind: K, title: 'Parallax', listTitle: 'Слои',
        init(w) {
            Object.assign(w.ext, { panX: 0, panY: 0, auto: false, t: 0, base: baseOf(w), names: [], sprite: -1, drag: null, images: null, cam0: null, nodes: [] });
            w.doc.cls('aw-bottom', 'px-bottom-host', true);
            host.backend(['assets', host.root()]).then((r) => {
                const list = r.json && Array.isArray(r.json.entries) ? r.json.entries : [];
                w.ext.images = list.map((e) => e.path).filter((p) => IMAGE.test(p)).sort();
                w.render();
            }).catch(() => { w.ext.images = []; w.render(); });
        },
        items: (w) => layers(w).map((l, i) => ({ label: l.name || 'слой ' + i,
            detail: 'order ' + (l.order === undefined ? 1 : l.order) + ' · ×' + (l.parallax === undefined ? '—' : l.parallax) + ' · ' + (l.sprites ? l.sprites.length : 0) + ' спр.' + (l.visible === false ? ' · скрыт' : '') })),
        target: cur,
        fields: () => [
            { key: 'name', label: 'Имя' },
            { key: 'order', label: 'order', number: true, optional: true },
            { key: 'parallax', label: 'parallax', number: true, optional: true },
            { key: 'modulate', label: 'оттенок', optional: true },
            { key: 'visible', label: 'visible', bool: true, options: ['true', 'false'], optional: true },
        ],
        tools: (w) => button('auto', 'Автопрокрутка', w.ext.auto) + button('home', 'В начало'),
        actions: () => button('layer:add', '+ Слой') + button('layer:up', 'Выше') + button('layer:down', 'Ниже') + button('layer:del', 'Удалить'),
        library(w) {
            let html = '<span class="st-h">Картинки проекта</span>' + button('image:pick', '+ Спрайт из файла…');
            if (w.ext.images === null) return html + '<span class="st-note">Читаю r2d assets…</span>';
            if (!w.ext.images.length) return html + '<span class="st-note">В проекте нет картинок.</span>';
            html += '<div class="px-images">' + w.ext.images.map((p) => '<div class="st-row px-img" data-key="image:' + esc(p) + '"><img src="' + esc(w.path(p)) + '"/>' + esc(p.split('/').pop()) + '</div>').join('') + '</div>';
            return html + '<span class="st-note">Клик — спрайт в центр вида выбранного слоя.</span><span class="st-h">В игре</span><div class="pt-code">' + esc(K.snippet(String(w.file.state.path).split('/').pop())) + '</div>';
        },
        bottom,
        selected(w) { if (w.ext.sprite >= sprites(w).length) w.ext.sprite = sprites(w).length - 1; },
        action(w, key) {
            const e = w.ext;
            if (key === 'image:pick' || key === 'sprite:src') {
                const sp = sprites(w)[e.sprite];
                pickProjectFile(w.$, w.host.root(), { title: 'Выберите картинку', filters: FILTERS.image, path: key === 'sprite:src' && sp ? w.path(sp.src) : '' }).then((r) => {
                    if (r.error) { w.fail('EDITOR_ASSET_FILE', r.error); return; }
                    if (!r.rel) return;
                    if (key === 'image:pick') { try { placeImage(w, r.rel); } catch (err) { w.fail('EDITOR_ASSET_ACTION', err.message); } return; }
                    w.doc.setValue('px-src', r.rel);
                    try { applySprite(w); } catch (err) { w.fail('EDITOR_ASSET_FIELD', err.message); }
                });
            }
            else if (key === 'auto') { e.auto = !e.auto; w.render(); }
            else if (key === 'home') { e.panX = 0; e.panY = 0; e.t = 0; }
            else if (key === 'layer:add') addLayer(w);
            else if (key === 'layer:del') { if (layers(w).length <= 1) throw new Error('Нужен хотя бы один слой'); const i = w.selected; w.edit('Удалить слой', (m) => { m.layers.splice(i, 1); }); }
            else if (key === 'layer:up') moveLayer(w, w.selected - 1);
            else if (key === 'layer:down') moveLayer(w, w.selected + 1);
            else if (key.startsWith('image:')) placeImage(w, key.slice(6));
            else if (key.startsWith('sprite:') && /^\d+$/.test(key.slice(7))) { e.sprite = Number(key.slice(7)); w.render(); }
            else if (key === 'sprite:apply') applySprite(w);
            else if (key === 'sprite:del') { const li = w.selected, si = e.sprite; if (sprites(w)[si]) w.edit('Удалить спрайт', (m) => { m.layers[li].sprites.splice(si, 1); }); }
            else if (key === 'sprite:row') {
                const s = sprites(w)[e.sprite], n = Number(w.doc.value('px-count'));
                if (!s) return;
                if (!Number.isInteger(n) || n < 1) throw new Error('Число копий — целое ≥ 1');
                const width = s.w || spriteSize(w, s).w;
                addSprite(w, { src: s.src, x: s.x + width, y: s.y, ...(s.w ? { w: s.w, h: s.h } : {}) }, n);
            } else if (key === 'modulate') {
                const c = String(w.doc.value('px-mcolor') || '').trim(), a = numberOf(w.doc, 'px-malpha');
                w.edit('Оттенок', (m) => { if (!c) delete m.modulate; else m.modulate = a === null ? { color: c } : { color: c, alpha: a }; });
            }
        },
        // Настоящие слои игры. Якорь параллакса — камера в момент создания (cam0).
        preview(w) {
            const e = w.ext, c = camera(w);
            $.camera.at(c.x, c.y).zoom(1);
            e.cam0 = { x: c.x, y: c.y };
            e.names = []; e.nodes = [];
            const prefix = '__editor_px' + w.doc.id + ':';
            for (const l of layers(w)) {
                const name = prefix + l.name;
                if (e.names.includes(name)) continue;
                try {
                    const opts = Object.assign({}, l, { name });
                    delete opts.sprites;
                    const layer = $.layers.create(opts), li = layers(w).indexOf(l);
                    e.nodes[li] = (l.sprites || []).map((s) => {
                        const n = $('<sprite>', { src: w.path(s.src) }).at(s.x, s.y);
                        if (s.w && s.h) n.size(s.w, s.h);
                        return n.appendTo(layer);
                    });
                    e.names.push(name);
                } catch (err) {
                    w.fail('SDK_LAYERS_RUNTIME', 'Слой «' + l.name + '» отклонён рантаймом: ' + (err && err.message ? err.message : err));
                }
            }
            const m = w.data.modulate;
            if (m) $.layers.modulate(m.color, m.alpha);
        },
        release(w) {
            for (const n of w.ext.names || []) $.layers.remove(n);
            w.ext.names = []; w.ext.nodes = [];
            $.layers.modulate(null);
        },
        deactivate(w) { w.ext.drag = null; },
        update(w, dt) {
            const e = w.ext, p = w.point();
            if (!p) return;
            const m = $.input.mouse(), pressed = $.input.mousePressed('left'), down = $.input.mouseDown('left');
            if (pressed && p.inside && !host.typing() && !w.file.state.busy) {
                // Сверху вниз по порядку отрисовки: сначала ближние слои.
                const order = layers(w).map((l, i) => ({ l, i })).filter((x) => x.l.visible !== false).sort((a, b) => (b.l.order || 0) - (a.l.order || 0));
                let hit = null;
                for (const { l, i } of order) {
                    const list = l.sprites || [];
                    for (let k = list.length - 1; k >= 0 && !hit; k--) {
                        const r = screenRect(w, l, list[k], nodeOf(w, i, k));
                        if (m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h) hit = { li: i, si: k };
                    }
                    if (hit) break;
                }
                if (hit) {
                    if (hit.li !== w.selected) w.select(hit.li);
                    e.sprite = hit.si; w.render();
                    const s = sprites(w)[hit.si];
                    e.drag = { mode: 'sprite', li: hit.li, si: hit.si, start: clone(s), mx: m.x, my: m.y, moved: false };
                } else e.drag = { mode: 'pan', mx: m.x, my: m.y, px: e.panX, py: e.panY };
            }
            if (e.drag && down) {
                const d = e.drag;
                if (d.mode === 'pan') { e.panX = d.px - (m.x - d.mx); e.panY = d.py - (m.y - d.my); }
                else {
                    const s = layers(w)[d.li].sprites[d.si], nx = Math.round(d.start.x + m.x - d.mx), ny = Math.round(d.start.y + m.y - d.my);
                    if (nx !== s.x || ny !== s.y) { s.x = nx; s.y = ny; d.moved = true; }
                }
            }
            if (e.drag && !down) {
                const d = e.drag;
                e.drag = null;
                if (d.mode === 'sprite' && d.moved) {
                    const end = clone(layers(w)[d.li].sprites[d.si]);
                    layers(w)[d.li].sprites[d.si] = d.start;
                    w.edit('Сдвиг спрайта', (mm) => { mm.layers[d.li].sprites[d.si] = end; });
                }
            }
            if (e.auto) { e.t += dt || 0; e.panX = Math.sin(e.t * 0.6) * 500; }
            const c = camera(w);
            $.camera.at(c.x, c.y).zoom(1);
            // Живой спрайт во время протяжки двигаем без пересборки слоёв.
            const l = cur(w), s = sprites(w)[e.sprite];
            if (l && s) {
                const r = screenRect(w, l, s, nodeOf(w, w.selected, e.sprite)), clip = p.r;
                const x0 = Math.max(r.x, clip.x), y0 = Math.max(r.y, clip.y), x1 = Math.min(r.x + r.w, clip.x + clip.w), y1 = Math.min(r.y + r.h, clip.y + clip.h);
                if (x1 > x0 && y1 > y0) {
                    // $.gfx.draw — экранные координаты (docs/highlevel/fx.md), камера на них не влияет.
                    const col = '#ff5a3c';
                    $.gfx.draw.line(x0, y0, x1, y0, col, 2); $.gfx.draw.line(x1, y0, x1, y1, col, 2);
                    $.gfx.draw.line(x1, y1, x0, y1, col, 2); $.gfx.draw.line(x0, y1, x0, y0, col, 2);
                }
            }
            if (e.drag && e.drag.mode === 'sprite' && e.drag.moved) syncDragged(w);
        },
        hud: (w) => K.summary(w.data) + ' · камера ' + Math.round(camera(w).x) + ', ' + Math.round(camera(w).y) + ' · тяните фон — камера, спрайт — сдвиг',
        ops: (w) => ({
            addLayer: (name) => addLayer(w, name),
            addSprite: (sprite, count) => addSprite(w, sprite, count),
            placeImage: (rel) => placeImage(w, rel),
            selectSprite: (i) => { w.ext.sprite = i; w.render(); return i; },
            screenRect: (li, si) => { const l = layers(w)[li]; return l && l.sprites && l.sprites[si] ? screenRect(w, l, l.sprites[si], nodeOf(w, li, si)) : null; },
            pan: (x, y) => { w.ext.panX = x; w.ext.panY = y; },
            images: () => w.ext.images,
            runtimeLayers: () => (w.ext.names || []).length,
        }),
        snapshot: (w) => ({ layers: layers(w).length, runtimeLayers: (w.ext.names || []).length, sprite: w.ext.sprite, pan: { x: w.ext.panX, y: w.ext.panY }, auto: w.ext.auto }),
    };

    const nodeOf = (w, li, si) => (w.ext.nodes && w.ext.nodes[li] ? w.ext.nodes[li][si] || null : null);
    // Протягиваемый спрайт: двигаем его живой узел, не пересобирая слои.
    function syncDragged(w) {
        const d = w.ext.drag, s = layers(w)[d.li].sprites[d.si], n = nodeOf(w, d.li, d.si);
        if (n) n.at(s.x, s.y);
    }

    return createWorkspace(host, def);
}
