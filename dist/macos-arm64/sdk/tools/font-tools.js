// ===========================================================================
// Font / Text Tools — шрифты и текстовые стили `$.font` (формат `*.fonts.json`,
// sdk/lib/kinds/fonts.js). Предпросмотр — настоящий текст движка: стили
// объявляет сам `$.font.define`, строки — узлы `<text>` с `.textStyle(имя)`,
// шрифты грузит `$.font.load`. Ширину строки считает `$.font.measure`.
// ===========================================================================

import { openStudio } from '../lib/studio_host.js';
import * as K from '../lib/kinds/fonts.js';
import { escapeHtml, joinPath } from '../lib/model.js';
import { button, fieldRow, parseNum, isObj } from '../lib/kit.js';
import { projectRoot } from './tilemap-studio.js';

export const standalone = true;

const PV = 'sdkpv-';
const abs = (h, p) => (/^([A-Za-z]:[\\/]|\/)/.test(p) ? p : joinPath(projectRoot(h.app, h.session.path), p));
const names = (h) => Object.keys(h.model.styles || {});
const curName = (h) => names(h)[h.sel];

function mount(h) {
    unmount(h);
    const $ = h.$, e = h.ext, m = h.model;
    e.defined = []; e.loaded = []; e.nodes = [];
    for (const f of m.fonts || []) {
        try {
            if ($.font.load(PV + f.name, abs(h, f.path))) e.loaded.push(PV + f.name);
            else h.note('warning', 'SDK_FONTS_LOAD', 'Движок не загрузил шрифт «' + f.name + '» из ' + f.path);
        } catch (err) { h.note('error', 'SDK_FONTS_RUNTIME', String(err && err.message ? err.message : err)); }
    }
    const rename = (n) => (n === 'default' ? 'default' : PV + n);
    for (const name of names(h)) {
        const spec = JSON.parse(JSON.stringify(m.styles[name]));
        if (spec.base) spec.base = rename(spec.base);
        if (spec.font && spec.font !== 'default') spec.font = PV + spec.font;
        $.font.define(rename(name), spec);
        e.defined.push(rename(name));
    }
    const r = h.rect();
    let y = r.y + 36;
    names(h).forEach((name, i) => {
        const st = $.font.get(rename(name)) || {};
        const node = $('<text>', { text: e.sample, size: st.size || 20 }).at(r.x + 24, y).appendTo($.world);
        $.font.apply(node, rename(name));
        e.nodes.push({ node, name, y, h: (st.size || 20) * (st.lineHeight || 1.25) });
        y += (st.size || 20) * (st.lineHeight || 1.25) + 18;
    });
}

function unmount(h) {
    const $ = h.$, e = h.ext;
    for (const n of e.nodes || []) n.node.remove();
    for (const n of e.defined || []) $.font.remove(n);
    e.nodes = []; e.defined = []; e.loaded = [];
}

const DEF = {
    id: 'font-tools',
    title: 'Font / Text Tools',
    leftTitle: 'СТИЛИ',
    kind: K,

    count(h) { return names(h).length; },

    left(h) {
        const list = names(h);
        let html = list.length ? '<div class="list grow">' + list.map((n, i) => {
            const st = h.model.styles[n];
            return '<div class="row' + (i === h.sel ? ' sel' : '') + '" data-key="' + i + '"><span class="row-name">' + escapeHtml(n) + '</span><span class="row-dir">' +
                (st.size || '—') + 'px' + (st.base ? ' · base ' + escapeHtml(st.base) : '') + '</span></div>';
        }).join('') + '</div>' : '<p class="empty">Стилей нет.</p>';
        html += '<h4>ШРИФТЫ</h4>';
        const fonts = h.model.fonts || [];
        html += fonts.length ? '<div class="list short">' + fonts.map((f, i) =>
            '<div class="row" data-key="font:' + i + '"><span class="row-name">' + escapeHtml(f.name) + '</span><span class="row-dir">' + escapeHtml(f.path.split('/').pop()) + ' · × убрать</span></div>').join('') + '</div>'
            : '<p class="empty">Своих шрифтов нет: работает шрифт движка по умолчанию.</p>';
        return html;
    },

    tools(h) {
        return button('add', '+ Стиль', '') + button('del', 'Удалить стиль', 'danger') + button('dup', 'Копия', '');
    },

    right(h) {
        const n = curName(h), st = n ? h.model.styles[n] : null;
        let html = '<h4>ОБРАЗЕЦ ТЕКСТА</h4>' + fieldRow({ id: 'ft-sample', label: 'Текст', value: h.ext.sample }) +
            '<div class="field-row"><button class="btn small" data-key="sample">Показать</button></div><h4>СТИЛЬ</h4>';
        if (!st) html += '<p class="empty">Выберите стиль слева.</p>';
        else {
            html += fieldRow({ id: 'ft-name', label: 'Имя', value: n }) + fieldRow({ id: 'ft-size', label: 'size', value: st.size === undefined ? '' : st.size }) +
                fieldRow({ id: 'ft-color', label: 'color', value: st.color || '' }) +
                '<div class="field-row">' + K.ALIGNS.map((a) => button('align:' + a, a, 'small' + (st.align === a ? ' on' : ''))).join('') + '</div>' +
                fieldRow({ id: 'ft-lh', label: 'lineHeight', value: st.lineHeight === undefined ? '' : st.lineHeight }) +
                fieldRow({ id: 'ft-base', label: 'base', value: st.base || '', hint: 'имя родительского стиля' }) +
                fieldRow({ id: 'ft-font', label: 'font', value: st.font || '', hint: 'семейство из списка шрифтов' }) +
                '<div class="field-row"><button class="btn small primary" data-key="apply">Применить</button></div>';
            const r = K.resolve(h.model.styles, n);
            html += '<div class="hint">Итог (default → base → стиль): ' + escapeHtml(JSON.stringify(r)) + '</div>';
            const dn = n === 'default' ? 'default' : PV + n;
            const w = h.$.font.measure ? h.$.font.measure(h.ext.sample, dn) : 0;
            if (w) html += '<div class="hint">Ширина образца: ' + Math.round(w) + ' px</div>';
        }
        html += '<h4>ДОБАВИТЬ ШРИФТ</h4>' + fieldRow({ id: 'ft-fname', label: 'Имя', value: '' }) + fieldRow({ id: 'ft-fpath', label: 'Файл', value: '', hint: '.ttf / .otf от корня проекта' }) +
            '<div class="field-row"><button class="btn small" data-key="addfont">+ Шрифт</button></div>' +
            '<h4>ИСПОЛЬЗОВАНИЕ В ИГРЕ</h4><div class="log">' + escapeHtml(K.snippet(h.session.path.split('/').pop())) + '</div>';
        return html;
    },

    onLeft(h, key) {
        if (String(key).startsWith('font:')) api(h).removeFont(parseInt(String(key).slice(5), 10));
        else h.select(parseInt(key, 10));
    },

    onTool(h, key) {
        const a = api(h);
        if (key === 'add') a.addStyle();
        else if (key === 'del') a.removeStyle(curName(h));
        else if (key === 'dup') a.duplicateStyle(curName(h));
    },

    onRight(h, key) {
        const a = api(h);
        if (key === 'sample') a.setSample(h.doc.value('ft-sample'));
        else if (key === 'apply') a.applyForm();
        else if (key.startsWith('align:')) a.setStyle(curName(h), { align: key.slice(6) });
        else if (key === 'addfont') a.addFont(h.doc.value('ft-fname'), h.doc.value('ft-fpath'));
    },

    mount(h) { h.ext.sample = 'Съешь ещё этих мягких французских булок — The quick brown fox 0123'; mount(h); },
    unmount(h) { unmount(h); h.doc.html('ds-overlay', ''); },
    changed(h) { mount(h); },

    tick(h) {
        const $ = h.$, e = h.ext, r = h.rect();
        // Подсветка выбранного стиля — рамка вокруг его строки (примитив поверх сцены).
        const sel = e.nodes.find((n) => n.name === curName(h));
        if (sel) $.gfx.draw.line(r.x + 8, sel.y - 4, r.x + 8, sel.y + sel.h + 2, '#ff5a3c', 3);
    },

    hud(h) {
        const n = curName(h);
        const fam = (h.ext.loaded || []).length;
        return (n ? 'стиль «' + n + '» · ' : '') + 'шрифтов загружено ' + fam + ' · текст рисует настоящий рантайм';
    },

    snapshot(h) { return { styles: names(h).length, fonts: h.model && h.model.fonts ? h.model.fonts.length : 0, runtimeStyles: (h.ext.defined || []).length, loaded: (h.ext.loaded || []).length, sample: h.ext.sample }; },
    api(h) { return api(h); },
};

function api(h) {
    const v = (id) => h.doc.value(id), num = (t) => parseNum(t);
    return {
        setSample(text) { h.ext.sample = String(text || ''); mount(h); h.renderAll(); return h.ext.sample; },
        addStyle(name) {
            let base = name || 'style', n = base, i = 1;
            while (h.model.styles[n]) n = base + (++i);
            h.run('стиль «' + n + '»', (m) => { m.styles[n] = { size: 20, color: '#ffffff', align: 'left' }; });
            h.select(names(h).indexOf(n));
            return n;
        },
        removeStyle(name) { return name !== undefined && h.run('удаление «' + name + '»', (m) => { delete m.styles[name]; }) !== null; },
        duplicateStyle(name) {
            if (name === undefined) return null;
            let n = name + '_copy', i = 1;
            while (h.model.styles[n]) n = name + '_copy' + (++i);
            h.run('копия «' + name + '»', (m) => { m.styles[n] = JSON.parse(JSON.stringify(m.styles[name])); });
            h.select(names(h).indexOf(n));
            return n;
        },
        /** Частичная правка стиля; `null` убирает поле. */
        setStyle(name, patch) {
            return h.run('стиль «' + name + '»', (m) => {
                const s = m.styles[name];
                if (!s) throw new Error('Нет стиля «' + name + '»');
                for (const k of Object.keys(patch)) { if (patch[k] === null) delete s[k]; else s[k] = patch[k]; }
            }) !== null;
        },
        renameStyle(from, to) {
            return h.run('переименование', (m) => {
                if (!m.styles[from]) throw new Error('Нет стиля «' + from + '»');
                if (m.styles[to]) throw new Error('Стиль «' + to + '» уже есть');
                const out = {};
                for (const k of Object.keys(m.styles)) {
                    const s = m.styles[k];
                    if (s.base === from) s.base = to;
                    out[k === from ? to : k] = s;
                }
                m.styles = out;
            }) !== null;
        },
        applyForm() {
            const name = curName(h);
            if (name === undefined) return false;
            const to = String(v('ft-name') || '').trim();
            return h.run('стиль «' + name + '»', (m) => {
                const s = m.styles[name];
                const size = num(v('ft-size')), lh = num(v('ft-lh'));
                if (Number.isNaN(size) || Number.isNaN(lh)) throw new Error('size и lineHeight — числа');
                if (size === null) delete s.size; else s.size = size;
                if (lh === null) delete s.lineHeight; else s.lineHeight = lh;
                for (const [k, id] of [['color', 'ft-color'], ['base', 'ft-base'], ['font', 'ft-font']]) {
                    const t = String(v(id) || '').trim();
                    if (t) s[k] = t; else delete s[k];
                }
                if (to && to !== name) {
                    if (m.styles[to]) throw new Error('Стиль «' + to + '» уже есть');
                    const out = {};
                    for (const k of Object.keys(m.styles)) { if (m.styles[k].base === name) m.styles[k].base = to; out[k === name ? to : k] = m.styles[k]; }
                    m.styles = out;
                }
            }) !== null;
        },
        addFont(name, path) {
            const n = String(name || '').trim(), p = String(path || '').trim();
            return h.run('шрифт «' + n + '»', (m) => {
                if (!n || !p) throw new Error('Укажите имя и путь к шрифту');
                m.fonts = m.fonts || [];
                m.fonts.push({ name: n, path: p });
            }) !== null;
        },
        removeFont(i) { return h.run('удаление шрифта', (m) => { m.fonts.splice(i, 1); }) !== null; },
        measure(name, text) { return h.$.font.measure(text === undefined ? h.ext.sample : text, name === 'default' ? 'default' : PV + name); },
        resolved(name) { return K.resolve(h.model.styles, name); },
    };
}

export async function open(app, args) {
    return openStudio(app, DEF, args);
}
