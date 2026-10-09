// ===========================================================================
// Parallax Tools — канвас-слои и параллакс `$.layers` (формат `*.layers.json`,
// sdk/lib/kinds/layers.js). Предпросмотр — настоящие слои рантайма: тянете
// мышью по окну просмотра (или включаете автопрокрутку) — камера двигается, а
// слои отстают от неё с заданными коэффициентами, как в игре.
// ===========================================================================

import { openStudio } from '../lib/studio_host.js';
import * as K from '../lib/kinds/layers.js';
import { escapeHtml, joinPath } from '../lib/model.js';
import { button, fieldRow, pairRow, parseNum, parseBool } from '../lib/kit.js';
import { projectRoot } from './tilemap-studio.js';

export const standalone = true;

const cur = (h) => (h.model && h.model.layers[h.sel] ? h.model.layers[h.sel] : null);
const abs = (h, p) => (/^([A-Za-z]:[\\/]|\/)/.test(p) ? p : joinPath(projectRoot(h.app, h.session.path), p));

function center(h) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of h.model.layers) for (const s of l.sprites || []) {
        x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
    }
    return Number.isFinite(x0) ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : { x: 0, y: 0 };
}

function mount(h) {
    unmount(h);
    const $ = h.$, e = h.ext;
    e.base = center(h);
    applyCamera(h);   // якорь параллакса берётся по камере в момент создания узлов
    e.names = [];
    for (const l of h.model.layers) {
        // Слой с повторным именем рантайм заводит поверх прежнего (прежний теряется в реестре), поэтому
        // в предпросмотре такой слой пропускается; сам файл предупреждает SDK_LAYERS_DUPLICATE_NAME.
        if (e.names.indexOf('sdkpv:' + l.name) >= 0) continue;
        try {
            const name = 'sdkpv:' + l.name;
            const opts = Object.assign({}, l, { name });
            delete opts.sprites;
            const layer = $.layers.create(opts);
            for (const s of l.sprites || []) {
                const n = $('<sprite>', { src: abs(h, s.src) }).at(s.x, s.y);
                if (s.w && s.h) n.size(s.w, s.h);
                n.appendTo(layer);
            }
            e.names.push(name);
        } catch (err) {
            h.note('error', 'SDK_LAYERS_RUNTIME', 'Слой «' + l.name + '» отклонён рантаймом: ' + (err && err.message ? err.message : err));
        }
    }
    const m = h.model.modulate;
    if (m) $.layers.modulate(m.color, m.alpha);
}

function unmount(h) {
    const $ = h.$, e = h.ext;
    for (const n of e.names || []) $.layers.remove(n);
    e.names = [];
    $.layers.modulate(null);
}

function applyCamera(h) {
    const $ = h.$, e = h.ext, r = h.rect(), win = $.gfx.size();
    const ox = r.w > 0 ? win.w / 2 - (r.x + r.w / 2) : 0, oy = r.h > 0 ? win.h / 2 - (r.y + r.h / 2) : 0;
    $.camera.at(e.base.x + e.panX + ox, e.base.y + e.panY + oy).zoom(1);
}

const DEF = {
    id: 'parallax-tools',
    title: 'Parallax Tools',
    leftTitle: 'СЛОИ',
    kind: K,

    count(h) { return h.model.layers.length; },

    left(h) {
        return '<div class="list grow">' + h.model.layers.map((l, i) =>
            '<div class="row' + (i === h.sel ? ' sel' : '') + '" data-key="' + i + '"><span class="row-name">' + escapeHtml(l.name || 'слой ' + i) +
            '</span><span class="row-dir">order ' + (l.order === undefined ? 1 : l.order) + ' · ×' + (l.parallax === undefined ? '—' : l.parallax) +
            ' · ' + (l.sprites ? l.sprites.length : 0) + ' спр.</span></div>').join('') + '</div>';
    },

    tools(h) {
        return button('add', '+ Слой', '') + button('del', 'Удалить', 'danger') + button('up', 'Выше', '') + button('down', 'Ниже', '') +
            button('auto', 'Автопрокрутка', h.ext.auto ? 'on' : '') + button('home', 'В начало', '');
    },

    right(h) {
        const l = cur(h), m = h.model.modulate || {};
        let html = '<h4>СЛОЙ</h4>';
        if (l) {
            html += fieldRow({ id: 'pl-name', label: 'name', value: l.name || '' }) +
                pairRow('order, parallax', 'pl-order', l.order === undefined ? '' : l.order, 'pl-par', l.parallax === undefined ? '' : l.parallax) +
                fieldRow({ id: 'pl-mod', label: 'modulate', value: l.modulate || '', hint: 'оттенок слоя, например #0a1430aa' }) +
                '<div class="field-row">' + button('vis', l.visible === false ? 'скрыт' : 'виден', 'small' + (l.visible === false ? '' : ' on')) +
                '<button class="btn small primary" data-key="apply">Применить</button></div>' +
                '<h4>СПРАЙТЫ СЛОЯ</h4>';
            const sp = l.sprites || [];
            html += sp.length ? '<div class="list short">' + sp.map((s, i) =>
                '<div class="row" data-key="rm:' + i + '"><span class="row-name">' + escapeHtml(s.src.split('/').pop()) + '</span><span class="row-dir">' + s.x + ', ' + s.y +
                (s.w ? ' · ' + s.w + '×' + s.h : '') + ' · × убрать</span></div>').join('') + '</div>' : '<p class="empty">Спрайтов нет.</p>';
            html += fieldRow({ id: 'pl-src', label: 'src', value: '', hint: 'путь от корня проекта, например assets/mountains.png' }) +
                pairRow('x, y', 'pl-x', 0, 'pl-y', 0) + pairRow('w, h', 'pl-w', '', 'pl-h', '') +
                fieldRow({ id: 'pl-count', label: 'копий', value: 1, hint: 'ряд из N копий вплотную по x (слой не тайлится сам)' }) +
                '<div class="field-row"><button class="btn small" data-key="addsprite">+ Спрайт</button></div>';
        } else html += '<p class="empty">Выберите слой.</p>';
        html += '<h4>ОБЩИЙ ОТТЕНОК</h4>' + pairRow('цвет, alpha', 'pl-mcolor', m.color || '', 'pl-malpha', m.alpha === undefined ? '' : m.alpha) +
            '<div class="field-row"><button class="btn small" data-key="mod">Применить оттенок</button></div>' +
            '<h4>ИСПОЛЬЗОВАНИЕ В ИГРЕ</h4><div class="log">' + escapeHtml(K.snippet(h.session.path.split('/').pop())) + '</div>';
        return html;
    },

    onLeft(h, key) { h.select(parseInt(key, 10)); },

    onTool(h, key) {
        const a = api(h);
        if (key === 'add') a.addLayer();
        else if (key === 'del') a.removeLayer(h.sel);
        else if (key === 'up') a.moveLayer(h.sel, h.sel + 1);
        else if (key === 'down') a.moveLayer(h.sel, h.sel - 1);
        else if (key === 'auto') { h.ext.auto = !h.ext.auto; h.renderAll(); }
        else if (key === 'home') { h.ext.panX = 0; h.ext.panY = 0; }
    },

    onRight(h, key) {
        const a = api(h);
        if (key === 'apply') a.applyForm();
        else if (key === 'vis') a.setLayer(h.sel, { visible: cur(h).visible === false ? true : false });
        else if (key === 'addsprite') a.addSpriteForm();
        else if (key.startsWith('rm:')) a.removeSprite(h.sel, parseInt(key.slice(3), 10));
        else if (key === 'mod') a.setModulate(h.doc.value('pl-mcolor'), h.doc.value('pl-malpha'));
    },

    mount(h) { Object.assign(h.ext, { panX: 0, panY: 0, auto: false, base: { x: 0, y: 0 }, names: [], t: 0 }); mount(h); },
    unmount(h) {
        unmount(h);
        const win = h.$.gfx.size();
        h.$.camera.at(win.w / 2, win.h / 2).zoom(1);
        h.doc.html('ds-overlay', '');
    },
    changed(h) { mount(h); },

    tick(h) {
        const e = h.ext, p = h.ptr;
        if (p.inside && p.down && (p.dx || p.dy)) { e.panX -= p.dx; e.panY -= p.dy; }
        if (e.auto) { e.t += h.$.time.delta(); e.panX = Math.sin(e.t * 0.6) * 500; }
        applyCamera(h);
        if (h.$.time.frame() % 6 === 0) h.hud();
    },

    hud(h) { return 'камера ' + Math.round(h.ext.base.x + h.ext.panX) + ', ' + Math.round(h.ext.base.y + h.ext.panY) + ' · тяните мышью — слои отстают по parallax'; },

    snapshot(h) { return { layers: h.model ? h.model.layers.length : 0, selected: h.sel, runtimeLayers: (h.ext.names || []).length, pan: { x: h.ext.panX, y: h.ext.panY }, auto: !!h.ext.auto }; },
    api(h) { return api(h); },
};

function api(h) {
    const v = (id) => h.doc.value(id), num = (t) => parseNum(t);
    const need = (t, label) => { const n = num(t); if (n === null || Number.isNaN(n)) throw new Error(label + ' — число'); return n; };
    return {
        addLayer(name) { const i = h.run('слой', (m) => K.newLayer(m, name)); if (i !== null) h.select(i); return i; },
        removeLayer(i) { return h.run('удаление слоя', (m) => { if (m.layers.length <= 1) throw new Error('Нужен хотя бы один слой'); m.layers.splice(i, 1); }) !== null; },
        moveLayer(i, to) {
            const ok = h.run('порядок слоя', (m) => {
                if (to < 0 || to >= m.layers.length) return;
                const a = m.layers[i], b = m.layers[to];
                const oa = a.order === undefined ? 1 : a.order, ob = b.order === undefined ? 1 : b.order;
                a.order = ob === oa ? ob + (to > i ? 1 : -1) : ob; b.order = oa === ob ? oa : oa;
                m.layers.splice(i, 1); m.layers.splice(to, 0, a);
            }) !== null;
            if (ok) h.select(Math.max(0, Math.min(h.model.layers.length - 1, to)));
            return ok;
        },
        setLayer(i, patch) {
            return h.run('слой', (m) => {
                const l = m.layers[i];
                if (!l) throw new Error('Нет слоя ' + i);
                for (const k of Object.keys(patch)) { if (patch[k] === null) delete l[k]; else l[k] = patch[k]; }
            }) !== null;
        },
        applyForm() {
            return h.run('слой', (m) => {
                const l = m.layers[h.sel];
                if (!l) throw new Error('Нет слоя');
                const name = String(v('pl-name') || '').trim();
                if (!name) throw new Error('У слоя нужно имя');
                l.name = name;
                const o = num(v('pl-order')), p = num(v('pl-par'));
                if (Number.isNaN(o) || Number.isNaN(p)) throw new Error('order и parallax — числа');
                if (o === null) delete l.order; else l.order = o;
                if (p === null) delete l.parallax; else l.parallax = p;
                const mod = String(v('pl-mod') || '').trim();
                if (mod) l.modulate = mod; else delete l.modulate;
            }) !== null;
        },
        addSprite(i, sprite, count) {
            return h.run('спрайт', (m) => {
                const l = m.layers[i];
                if (!l) throw new Error('Нет слоя ' + i);
                l.sprites = l.sprites || [];
                const n = Math.max(1, Math.min(K.MAX_SPRITES, count || 1));
                for (let k = 0; k < n; k++) l.sprites.push(Object.assign({}, sprite, { x: sprite.x + (sprite.w || 0) * k }));
            }) !== null;
        },
        addSpriteForm() {
            const src = String(v('pl-src') || '').trim();
            if (!src) { h.note('error', 'SDK_EDIT_REJECTED', 'Укажите путь к картинке'); return false; }
            try {
                const s = { src, x: need(v('pl-x'), 'x'), y: need(v('pl-y'), 'y') };
                const w = num(v('pl-w')), hh = num(v('pl-h'));
                if (Number.isNaN(w) || Number.isNaN(hh)) throw new Error('w и h — числа');
                if (w !== null && hh !== null) { s.w = w; s.h = hh; }
                return this.addSprite(h.sel, s, parseInt(v('pl-count'), 10) || 1);
            } catch (e) { h.note('error', 'SDK_EDIT_REJECTED', e.message); return false; }
        },
        removeSprite(i, si) { return h.run('удаление спрайта', (m) => { m.layers[i].sprites.splice(si, 1); }) !== null; },
        setModulate(color, alpha) {
            return h.run('оттенок', (m) => {
                const c = String(color || '').trim();
                if (!c) { delete m.modulate; return; }
                const a = num(alpha);
                if (Number.isNaN(a)) throw new Error('alpha — число 0..1');
                m.modulate = a === null ? { color: c } : { color: c, alpha: a };
            }) !== null;
        },
        pan(x, y) { h.ext.panX = x; h.ext.panY = y; },
        layers: () => h.ext.names.map((n) => h.$.layers.get(n)),
    };
}

export async function open(app, args) {
    return openStudio(app, DEF, args);
}
