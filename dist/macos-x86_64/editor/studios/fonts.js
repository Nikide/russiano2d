// ===========================================================================
// Fonts — студия Editor для `*.fonts.json` (формат и resolve — sdk/lib/kinds/fonts.js).
// Центр — образец: каждый стиль рисуется настоящим `<text>` через `$.font`,
// клик по строке выбирает стиль. Справа — поля стиля (base/font — списком),
// слева — стили, объявленные шрифты и .ttf/.otf проекта (`r2d assets`).
//
// Стили и шрифты превью регистрируются под префиксом вкладки, поэтому две
// вкладки и сам Editor не делят имена; `default` файла тоже идёт с префиксом,
// а наследование «default → base → стиль» повторяет K.resolve.
// ===========================================================================

import * as K from '../lib/shared/kinds/fonts.js';
import { createWorkspace, button } from '../lib/asset_workspace.js';
import { esc, FILTERS, pickProjectFile } from '../lib/studio_kit.js';

export const meta = { id: 'fonts', title: 'Шрифты', icon: 'text_fields', match: (p) => /\.fonts\.json$/i.test(p) };

const FONT_FILE = /\.(ttf|otf)$/i;
const SAMPLE = 'Съешь ещё этих мягких французских булок — The quick brown fox 0123';
const NAME_RE = /^[A-Za-z0-9_\-]{1,48}$/;

export function create(host) {
    const $ = host.$;
    const styles = (w) => (w.data.styles && typeof w.data.styles === 'object' ? w.data.styles : {});
    const names = (w) => Object.keys(styles(w));
    const curName = (w) => names(w)[w.selected];
    const fonts = (w) => (Array.isArray(w.data.fonts) ? w.data.fonts : []);
    const pv = (w, n) => '__editor_ft' + w.doc.id + '_' + n;

    function uniqueName(w, base) {
        let n = base, i = 1;
        while (styles(w)[n]) n = base + (++i);
        return n;
    }
    function selectName(w, n) { const i = names(w).indexOf(n); if (i >= 0) w.select(i); }

    function addStyle(w, name) {
        const n = uniqueName(w, name || 'style');
        w.edit('Стиль «' + n + '»', (m) => { m.styles = m.styles || {}; m.styles[n] = { size: 20, color: '#ffffff', align: 'left' }; });
        selectName(w, n);
        return n;
    }
    function duplicate(w) {
        const from = curName(w);
        if (from === undefined) return null;
        const n = uniqueName(w, from + '_copy');
        w.edit('Копия «' + from + '»', (m) => { m.styles[n] = JSON.parse(JSON.stringify(m.styles[from])); });
        selectName(w, n);
        return n;
    }
    // Переименование сохраняет порядок ключей и переписывает base у наследников.
    function rename(m, from, to) {
        if (from === to) return;
        if (!NAME_RE.test(to)) throw new Error('Имя стиля: латиница, цифры, «_», «-»');
        if (m.styles[to]) throw new Error('Стиль «' + to + '» уже есть');
        const out = {};
        for (const k of Object.keys(m.styles)) {
            const s = m.styles[k];
            if (s && s.base === from) s.base = to;
            out[k === from ? to : k] = s;
        }
        m.styles = out;
    }
    function addFont(w, path) {
        const file = String(path).split('/').pop().replace(FONT_FILE, '');
        let n = file.replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 48) || 'font', i = 1;
        const base = n;
        while (fonts(w).some((f) => f.name === n)) n = base + (++i);
        w.edit('Шрифт «' + n + '»', (m) => { m.fonts = m.fonts || []; m.fonts.push({ name: n, path }); });
        return n;
    }

    // Определения превью: тот же resolve, что у K (default → base → стиль), под префиксом.
    function defineAll(w) {
        const e = w.ext, all = styles(w);
        for (const f of fonts(w)) {
            try {
                if ($.font.load(pv(w, f.name), w.path(f.path))) e.loaded.push(f.name);
                else e.fontErrors.push(f.name);
            } catch (err) { e.fontErrors.push(f.name); }
        }
        for (const n of names(w)) {
            const spec = JSON.parse(JSON.stringify(all[n] || {}));
            if (spec.base) spec.base = pv(w, spec.base);
            else if (n !== 'default' && all.default) spec.base = pv(w, 'default');
            if (spec.font && spec.font !== 'default') spec.font = pv(w, spec.font);
            $.font.define(pv(w, n), spec);
            e.defined.push(pv(w, n));
        }
    }

    function layoutSpecimen(w) {
        const r = w.rect(), e = w.ext;
        if (!r) return;
        let y = r.y + 28 - e.scroll;
        e.lines = names(w).map((n) => {
            const st = $.font.get(pv(w, n)) || {}, size = st.size || 20, h = size * (st.lineHeight || 1.25);
            const line = { name: n, y, h: h + 18, size };
            y += h + 26;
            return line;
        });
        e.contentH = y + e.scroll - r.y;
    }

    function bottom(w) {
        const n = curName(w), e = w.ext;
        let html = '<div class="ft-bottom"><div class="st-field"><label>Образец</label><input id="ft-sample" class="st-in" type="text" value="' + esc(e.sample) + '"/>' + button('sample', 'Показать') + '</div>';
        if (n !== undefined) {
            const r = K.resolve(styles(w), n), width = $.font.measure(e.sample, pv(w, n));
            const chain = ['default'].concat(K.chain(styles(w), n).reverse()).filter((x, i, a) => a.indexOf(x) === i);
            html += '<div class="ft-facts"><span class="st-label">Цепочка</span>' + esc(chain.map((x) => x === 'default' ? 'По умолчанию' : x).join(' > ')) +
                '<span class="st-label">Итог</span>' + esc(r.size + 'px · ' + r.color + ' · ' + r.align + ' · ×' + r.lineHeight + (r.font ? ' · ' + r.font : '')) +
                '<span class="st-label">Ширина образца</span>' + Math.round(width || 0) + ' px</div>';
        }
        return html + '</div>';
    }

    const def = {
        kind: K, title: 'Шрифты', listTitle: 'Стили',
        init(w) {
            Object.assign(w.ext, { sample: SAMPLE, nodes: [], defined: [], loaded: [], fontErrors: [], lines: [], scroll: 0, contentH: 0, files: null });
            w.doc.cls('aw-bottom', 'ft-bottom-host', true);
            host.backend(['assets', host.root()]).then((r) => {
                const list = r.json && Array.isArray(r.json.entries) ? r.json.entries : [];
                w.ext.files = list.map((x) => x.path).filter((p) => FONT_FILE.test(p)).sort();
                w.render();
            }).catch(() => { w.ext.files = []; w.render(); });
        },
        items: (w) => names(w).map((n) => { const s = styles(w)[n] || {}; return { label: n, detail: (s.size || '—') + 'px' + (s.base ? ' · base ' + s.base : '') + (s.font ? ' · ' + s.font : '') }; }),
        target: (w) => (curName(w) === undefined ? null : styles(w)[curName(w)]),
        fields: (w) => {
            const n = curName(w), others = names(w).filter((x) => x !== n);
            return [
                { key: '__name', label: 'Имя' },
                { key: 'size', label: 'Размер, px', number: true, optional: true },
                { key: 'color', label: 'Цвет', optional: true },
                { key: 'align', label: 'Выравнивание', options: K.ALIGNS, optional: true },
                { key: 'lineHeight', label: 'Высота строки', number: true, optional: true },
                { key: 'base', label: 'Основа', options: others, optional: true },
                { key: 'font', label: 'Файл шрифта', options: ['default'].concat(fonts(w).map((f) => f.name)), optional: true },
            ];
        },
        selected(w) { const n = curName(w); if (n !== undefined) w.doc.setValue('f-__name', n); },
        apply(w, m, patch) {
            const from = curName(w), to = String(patch.__name || '').trim();
            delete patch.__name;
            w.patch(m.styles[from], patch);
            if (to && to !== from) { rename(m, from, to); w.ext.pendingSelect = to; }
        },
        tools: () => button('style:add', '+ Стиль') + button('style:dup', 'Копия') + button('style:del', 'Удалить стиль'),
        library(w) {
            const e = w.ext;
            let html = '<span class="st-h">Шрифты файла</span>';
            html += fonts(w).length ? fonts(w).map((f, i) => '<div class="st-row" data-key="font:del:' + i + '">' + esc(f.name) + '<span class="st-sub">' + esc(String(f.path).split('/').pop()) +
                (e.fontErrors.includes(f.name) ? ' · не загрузился' : '') + ' · убрать</span></div>').join('') : '<span class="st-note">Своих нет — работает шрифт движка.</span>';
            html += '<span class="st-h">Файлы шрифтов проекта</span>' + button('font:pick', '+ Шрифт из файла…');
            if (e.files === null) html += '<span class="st-note">Читаю r2d assets…</span>';
            else if (!e.files.length) html += '<span class="st-note">В проекте нет .ttf/.otf.</span>';
            else html += e.files.map((p) => '<div class="st-row" data-key="font:add:' + esc(p) + '">+ ' + esc(p.split('/').pop()) + '<span class="st-sub">' + esc(p) + '</span></div>').join('');
            return html + '<span class="st-h">В игре</span><div class="pt-code">' + esc(K.snippet(String(w.file.state.path).split('/').pop())) + '</div>';
        },
        bottom,
        content(w) {
            // Подписи строк образца (RmlUi поверх холста); сам текст — рантайм.
            const k = $.window.pixels().w / $.window.size().w, r = w.rect();
            if (!r) return '';
            return (w.ext.lines || []).map((l, i) => '<div class="ft-tag' + (i === w.selected ? ' on' : '') + '" style="top:' + Math.round((l.y - r.y - 18) * k) + 'px;">' + esc(l.name) + '</div>').join('');
        },
        action(w, key) {
            if (key === 'style:add') addStyle(w);
            else if (key === 'style:dup') duplicate(w);
            else if (key === 'style:del') { const n = curName(w); if (n !== undefined) w.edit('Удалить «' + n + '»', (m) => { delete m.styles[n]; }); }
            else if (key === 'sample') { w.ext.sample = String(w.doc.value('ft-sample') || ''); w.rebuild(); w.render(); }
            else if (key.startsWith('font:del:')) { const i = Number(key.slice(9)); w.edit('Убрать шрифт', (m) => { m.fonts.splice(i, 1); }); }
            else if (key.startsWith('font:add:')) addFont(w, key.slice(9));
            else if (key === 'font:pick') pickProjectFile(w.$, w.host.root(), { title: 'Выберите шрифт', filters: FILTERS.font }).then((r) => {
                if (r.error) w.fail('EDITOR_ASSET_FILE', r.error); else if (r.rel) addFont(w, r.rel);
            });
        },
        preview(w) {
            const e = w.ext;
            e.nodes = []; e.defined = []; e.loaded = []; e.fontErrors = [];
            if (e.pendingSelect) { selectName(w, e.pendingSelect); e.pendingSelect = null; }
            defineAll(w);
            layoutSpecimen(w);
            const r = w.rect();
            for (const l of e.lines) {
                const node = $('<text>', { text: e.sample, size: l.size }).at(r ? r.x + 24 : 0, l.y).appendTo($.world);
                $.font.apply(node, pv(w, l.name));
                e.nodes.push(node); w.nodes.push(node);
            }
            w.render();
        },
        release(w) {
            for (const n of w.ext.defined || []) $.font.remove(n);
            w.ext.defined = []; w.ext.nodes = [];
        },
        deactivate() {},
        update(w) {
            const e = w.ext, p = w.point();
            if (!p) return;
            const r = p.r;
            if (p.inside && !host.typing()) {
                const wheel = $.input.wheel().y;
                if (wheel) {
                    e.scroll = Math.max(0, Math.min(Math.max(0, e.contentH - r.h + 20), e.scroll - wheel * 40));
                    w.rebuild();
                }
                if ($.input.mousePressed('left')) {
                    const m = $.input.mouse(), i = e.lines.findIndex((l) => m.y >= l.y - 18 && m.y < l.y - 18 + l.h + 8);
                    if (i >= 0 && i !== w.selected) w.select(i);
                }
            }
            // Текст за пределами холста прячем: панели Editor непрозрачны, но низ холста — нет.
            e.nodes.forEach((n, i) => { const l = e.lines[i]; if (l) n.visible(l.y >= r.y && l.y + l.h - 18 <= r.y + r.h); });
            const l = e.lines[w.selected];
            if (l && l.y >= r.y && l.y < r.y + r.h) $.gfx.draw.line(r.x + 10, Math.max(r.y, l.y - 14), r.x + 10, Math.min(r.y + r.h, l.y + l.h - 14), '#ff5a3c', 3);
        },
        hud: (w) => K.summary(w.data) + ' · загружено шрифтов ' + w.ext.loaded.length + ' · текст рисует рантайм; колесо — прокрутка, клик — выбрать стиль',
        ops: (w) => ({
            addStyle: (name) => addStyle(w, name),
            duplicate: () => duplicate(w),
            addFont: (path) => addFont(w, path),
            setSample: (text) => { w.ext.sample = String(text); w.rebuild(); return w.ext.sample; },
            measure: (name) => $.font.measure(w.ext.sample, pv(w, name)),
            runtimeStyle: (name) => $.font.get(pv(w, name)),
            lineY: (name) => { const l = w.ext.lines.find((x) => x.name === name); return l ? l.y : null; },
            files: () => w.ext.files,
        }),
        snapshot: (w) => ({ styles: names(w).length, fonts: fonts(w).length, runtimeStyles: w.ext.defined.length, loaded: w.ext.loaded.length, sample: w.ext.sample }),
    };
    return createWorkspace(host, def);
}
