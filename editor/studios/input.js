// ===========================================================================
// Input — студия Editor для `*.input.json` (формат — sdk/lib/kinds/input.js).
//
// Центр — тестер: плитка на действие, подсвечивается по настоящему
// `$.input.down(действие)` после `$.input.bind` из файла; клавиши, которые
// делят два действия, помечены как конфликт. Снизу — клавиши выбранного
// действия: убрать, добавить по имени или «Назначить нажатием» (следующая
// клавиша). Бинды Editor/игры сохраняются при входе и возвращаются на выходе.
// ===========================================================================

import * as K from '../lib/shared/kinds/input.js';
import { createWorkspace, button } from '../lib/asset_workspace.js';
import { esc } from '../lib/studio_kit.js';

export const meta = { id: 'input', title: 'Input', icon: 'sports_esports', match: (p) => /\.input\.json$/i.test(p) };

const ACTION_RE = /^[A-Za-z0-9_\-]{1,48}$/;
const KEY_ALIASES = { ' ': 'space', return: 'enter', 'left shift': 'leftshift', 'right shift': 'rightshift', 'left ctrl': 'leftctrl',
    'right ctrl': 'rightctrl', 'left alt': 'leftalt', 'right alt': 'rightalt', 'page up': 'pageup', 'page down': 'pagedown', 'caps lock': 'capslock' };

/** Имя клавиши от `$.input.on('key')` → имя файла: «Space» → «space». */
export function humanKey(name) {
    const n = String(name || '').toLowerCase();
    return KEY_ALIASES[n] || n.replace(/\s+/g, '');
}

/** Клавиша → действия, которые её используют (только где их больше одного). */
export function conflicts(actions) {
    const owners = new Map();
    for (const a of Object.keys(actions || {})) for (const k of actions[a] || []) {
        const key = String(k).toLowerCase();
        if (!owners.has(key)) owners.set(key, []);
        if (!owners.get(key).includes(a)) owners.get(key).push(a);
    }
    const out = {};
    for (const [k, list] of owners) if (list.length > 1) out[k] = list;
    return out;
}

export function create(host) {
    const $ = host.$;
    const actions = (w) => (w.data.actions && typeof w.data.actions === 'object' ? w.data.actions : {});
    const names = (w) => Object.keys(actions(w));
    const curName = (w) => names(w)[w.selected];

    function addAction(w, name) {
        let n = name || 'action', i = 1;
        const base = n;
        while (actions(w)[n]) n = base + (++i);
        w.edit('Действие «' + n + '»', (m) => { m.actions = m.actions || {}; m.actions[n] = ['space']; });
        const at = names(w).indexOf(n);
        if (at >= 0) w.select(at);
        return n;
    }
    function addKey(w, name, key) {
        const k = humanKey(key);
        if (name === undefined || !k) return false;
        if ((actions(w)[name] || []).includes(k)) return false;
        return w.edit('Клавиша «' + k + '»', (m) => { m.actions[name].push(k); });
    }
    function removeKey(w, name, i) {
        if ((actions(w)[name] || []).length <= 1) throw new Error('У действия должна остаться хотя бы одна клавиша');
        return w.edit('Убрать клавишу', (m) => { m.actions[name].splice(i, 1); });
    }

    // --- Рантайм: бинды файла вместо текущих, на выходе — прежние ---------------
    function bindRuntime(w) {
        const e = w.ext;
        if (!e.saved) e.saved = $.input.bindings();
        if (e.savedDeadzone === undefined) e.savedDeadzone = $.input.deadzone();
        for (const a of Object.keys($.input.bindings())) $.input.unbind(a);
        for (const a of names(w)) { try { $.input.bind(a, actions(w)[a]); } catch (_) { /* битые клавиши видит validate */ } }
        if (typeof w.data.deadzone === 'number') $.input.deadzone(w.data.deadzone);
    }
    function restoreRuntime(w) {
        const e = w.ext;
        if (!e.saved) return;
        for (const a of Object.keys($.input.bindings())) $.input.unbind(a);
        for (const a of Object.keys(e.saved)) $.input.bind(a, e.saved[a]);
        if (e.savedDeadzone !== undefined) $.input.deadzone(e.savedDeadzone);
        e.saved = null; e.savedDeadzone = undefined;
    }

    function tester(w) {
        const c = conflicts(actions(w)), cur = curName(w);
        if (!names(w).length) return '<div class="in-grid"><span class="st-empty">Действий нет — «+ Действие».</span></div>';
        return '<div class="in-grid"><span class="st-h first">Тестер — $.input.down(действие)</span>' + names(w).map((n, i) =>
            '<div id="in-tile-' + i + '" class="in-tile' + (n === cur ? ' sel' : '') + (w.ext.lit[n] ? ' lit' : '') + '" data-key="pick:' + i + '"><span class="in-name">' + esc(n) + '</span><span class="in-keys">' +
            (actions(w)[n] || []).map((k) => '<span class="in-key' + (c[String(k).toLowerCase()] ? ' bad' : '') + (K.keyKnown(k) ? '' : ' unknown') + '">' + esc(k) + '</span>').join('') + '</span></div>').join('') +
            (Object.keys(c).length ? '<span class="st-h">Конфликты</span>' + Object.keys(c).map((k) => '<div class="in-conflict">' + esc(k) + ': ' + esc(c[k].join(', ')) + '</div>').join('') : '') + '</div>';
    }

    function bottom(w) {
        const n = curName(w);
        if (n === undefined) return '';
        const c = conflicts(actions(w));
        return '<div class="in-bottom"><span class="st-label">Клавиши «' + esc(n) + '»</span>' + (actions(w)[n] || []).map((k, i) =>
            '<span class="in-chip' + (c[String(k).toLowerCase()] ? ' bad' : '') + '">' + esc(k) + button('key:del:' + i, 'x') + '</span>').join('') +
            '<span class="st-sep"></span><input id="in-key" class="st-in in-new" type="text" value=""/>' + button('key:add', '+ Клавиша') +
            button('capture', w.ext.capturing ? 'Нажмите клавишу…' : 'Назначить нажатием', w.ext.capturing) + '</div>';
    }

    const def = {
        kind: K, title: 'Input', listTitle: 'Действия',
        init(w) {
            Object.assign(w.ext, { lit: {}, capturing: false, saved: null, savedDeadzone: undefined });
            w.doc.cls('aw-bottom', 'in-bottom-host', true);
            // Захват клавиши: только пока вкладка активна и включён режим назначения.
            w.ext.keyHandler = (ev) => {
                if (!w.active || !w.ext.capturing || !ev || !ev.pressed) return;
                const name = curName(w), key = humanKey(ev.key);
                w.ext.capturing = false;
                if (name !== undefined && key) addKey(w, name, key);
                w.render();
            };
            $.input.on('key', w.ext.keyHandler);
        },
        items: (w) => names(w).map((n) => ({ label: n, detail: (actions(w)[n] || []).join(' · ') })),
        target: (w) => (curName(w) === undefined ? null : { __name: curName(w) }),
        fields: () => [{ key: '__name', label: 'Имя' }],
        settings: [{ key: 'deadzone', label: 'мёртвая зона', number: true, optional: true }],
        apply(w, m, patch) {
            const from = curName(w), to = String(patch.__name || '').trim();
            if (!to || to === from) return;
            if (!ACTION_RE.test(to)) throw new Error('Имя действия: латиница, цифры, «_», «-»');
            if (m.actions[to]) throw new Error('Действие «' + to + '» уже есть');
            const out = {};
            for (const k of Object.keys(m.actions)) out[k === from ? to : k] = m.actions[k];
            m.actions = out;
        },
        tools: () => button('action:add', '+ Действие') + button('action:del', 'Удалить действие'),
        library(w) {
            return '<span class="st-h">Имена клавиш</span><span class="st-note">a–z, 0–9, f1–f24, space, enter, escape, tab, left/right/up/down, leftshift, ctrl, alt, mouse.left/right/middle, gamepad.a/b/x/y, gamepad.dpleft…</span>' +
                '<span class="st-h">В игре</span><div class="pt-code">' + esc(K.snippet(String(w.file.state.path).split('/').pop())) + '</div>';
        },
        content: tester,
        bottom,
        action(w, key) {
            const n = curName(w);
            if (key === 'action:add') addAction(w);
            else if (key === 'action:del') { if (n !== undefined) w.edit('Удалить «' + n + '»', (m) => { delete m.actions[n]; }); }
            else if (key.startsWith('pick:')) w.select(Number(key.slice(5)));
            else if (key === 'key:add') { const k = String(w.doc.value('in-key') || '').trim(); if (!k) throw new Error('Введите имя клавиши'); addKey(w, n, k); }
            else if (key.startsWith('key:del:')) removeKey(w, n, Number(key.slice(8)));
            else if (key === 'capture') { w.ext.capturing = !w.ext.capturing && n !== undefined; w.render(); }
        },
        preview(w) { bindRuntime(w); w.ext.lit = {}; },
        release() {},
        deactivate(w) { w.ext.capturing = false; restoreRuntime(w); },
        update(w) {
            const e = w.ext;
            names(w).forEach((n, i) => {
                const down = !!$.input.down(n);
                if (!!e.lit[n] !== down) { e.lit[n] = down; w.doc.cls('in-tile-' + i, 'lit', down); }
            });
        },
        hud: (w) => K.summary(w.data) + (w.ext.capturing ? ' · нажмите клавишу — она добавится к «' + curName(w) + '»' : ' · нажимайте клавиши — действия подсвечиваются'),
        ops: (w) => ({
            addAction: (name) => addAction(w, name),
            addKey: (name, key) => addKey(w, name, key),
            removeKey: (name, i) => { try { return removeKey(w, name, i); } catch (err) { w.fail('SDK_INPUT_KEYS', err.message); return false; } },
            capture: (on) => { w.ext.capturing = !!on && curName(w) !== undefined; w.render(); return w.ext.capturing; },
            lit: () => Object.keys(w.ext.lit).filter((n) => w.ext.lit[n]),
            conflicts: () => conflicts(actions(w)),
        }),
        snapshot: (w) => ({ actions: names(w).length, capturing: w.ext.capturing, bound: Object.keys($.input.bindings()).length }),
    };
    const ws = createWorkspace(host, def);
    const close = ws.close;
    ws.close = () => { $.input.off('key', ws.state.ext.keyHandler); restoreRuntime(ws.state); close(); };
    return ws;
}
