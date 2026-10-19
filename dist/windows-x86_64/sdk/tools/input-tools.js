// ===========================================================================
// Input Tools — действия и раскладка `$.input` (формат `*.input.json`,
// sdk/lib/kinds/input.js). Предпросмотр — настоящий `$.input`: действия
// привязываются к рантайму SDK (`$.input.bind`), а тестер показывает, какие
// из них сейчас нажаты. Клавишу можно назначить нажатием.
// ===========================================================================

import { openStudio } from '../lib/studio_host.js';
import * as K from '../lib/kinds/input.js';
import { escapeHtml } from '../lib/model.js';
import { button, fieldRow, parseNum } from '../lib/kit.js';

const KEY_ALIASES = { ' ': 'space', return: 'enter', 'left shift': 'leftshift', 'right shift': 'rightshift', 'left ctrl': 'leftctrl',
    'right ctrl': 'rightctrl', 'left alt': 'leftalt', 'right alt': 'rightalt', 'page up': 'pageup', 'page down': 'pagedown', 'caps lock': 'capslock' };

/** Имя клавиши от `$.input.on('key')` → человеческое имя файла: «Space» → «space». */
export function humanKey(name) {
    const n = String(name || '').toLowerCase();
    return KEY_ALIASES[n] || n.replace(/\s+/g, '');
}

function names(h) { return h.model ? Object.keys(h.model.actions || {}) : []; }
function curName(h) { return names(h)[h.sel]; }

const DEF = {
    id: 'input-tools',
    title: 'Input Tools',
    leftTitle: 'ДЕЙСТВИЯ',
    kind: K,

    count(h) { return names(h).length; },

    left(h) {
        const list = names(h);
        if (!list.length) return '<p class="empty">Действий нет: «+ Действие».</p>';
        return '<div class="list grow">' + list.map((n, i) =>
            '<div id="act-row-' + i + '" class="row' + (i === h.sel ? ' sel' : '') + '" data-key="' + i + '"><span class="row-name">' + escapeHtml(n) +
            '</span><span class="row-dir">' + escapeHtml((h.model.actions[n] || []).join(', ')) + '</span></div>').join('') + '</div>';
    },

    tools(h) {
        return button('add', '+ Действие', '') + button('remove', 'Удалить', 'danger') +
            button('capture', h.ext.capturing ? 'Нажмите клавишу…' : 'Назначить нажатием', h.ext.capturing ? 'on' : '') +
            button('apply', 'Привязать к рантайму', h.ext.live ? 'on' : '');
    },

    right(h) {
        const name = curName(h);
        let html = fieldRow({ id: 'in-dead', label: 'Мёртвая зона', value: h.model.deadzone === undefined ? '' : h.model.deadzone, hint: 'Стики геймпада: значения меньше порога считаются нулём' }) +
            '<div class="field-row"><button class="btn small" data-key="deadzone">Применить зону</button></div>';
        if (name === undefined) return html + '<div class="hint">Выберите действие слева.</div>';
        const keys = h.model.actions[name] || [];
        html += '<h4>ДЕЙСТВИЕ</h4>' + fieldRow({ id: 'in-name', label: 'Имя', value: name }) +
            '<div class="field-row"><button class="btn small" data-key="rename">Переименовать</button></div><h4>КЛАВИШИ</h4>';
        html += keys.length ? '<div class="list short">' + keys.map((k, i) =>
            '<div class="row" data-key="rmkey:' + i + '"><span class="row-name">' + escapeHtml(k) + '</span>' +
            (K.keyKnown(k) ? '' : '<span class="row-dir">неизвестная</span>') + '<span class="row-dir">× убрать</span></div>').join('') + '</div>'
            : '<p class="empty">Клавиш нет.</p>';
        html += fieldRow({ id: 'in-key', label: 'Клавиша', value: '', hint: 'например: space, w, left, gamepad.a, mouse.left' }) +
            '<div class="field-row"><button class="btn small" data-key="addkey">Добавить клавишу</button></div>';
        return html;
    },

    onLeft(h, key) { h.select(parseInt(key, 10)); },

    onTool(h, key) {
        if (key === 'add') api(h).addAction();
        else if (key === 'remove') api(h).removeAction(curName(h));
        else if (key === 'capture') api(h).capture(!h.ext.capturing);
        else if (key === 'apply') api(h).bindRuntime(!h.ext.live);
    },

    onRight(h, key) {
        const name = curName(h);
        if (key === 'deadzone') api(h).setDeadzone(h.doc.value('in-dead'));
        else if (key === 'rename') api(h).renameAction(name, h.doc.value('in-name'));
        else if (key === 'addkey') api(h).addKey(name, h.doc.value('in-key'));
        else if (key.startsWith('rmkey:')) api(h).removeKey(name, parseInt(key.slice(6), 10));
    },

    mount(h) {
        h.ext.saved = h.$.input.bindings();
        h.ext.lit = {};
        h.ext.keyHandler = (e) => {
            if (!h.ext.capturing || !e.pressed) return;
            const name = curName(h);
            const key = humanKey(e.key);
            if (name !== undefined && key) {
                api(h).addKey(name, key);
                h.ext.capturing = false;
                h.renderAll();
            }
        };
        h.$.input.on('key', h.ext.keyHandler);
        api(h).bindRuntime(true);
    },

    unmount(h) {
        const $ = h.$;
        if (h.ext.keyHandler) $.input.off('key', h.ext.keyHandler);
        // Вернуть привязки рантайма SDK такими, какими они были до студии.
        for (const a of Object.keys($.input.bindings())) $.input.unbind(a);
        for (const a of Object.keys(h.ext.saved || {})) $.input.bind(a, h.ext.saved[a]);
        h.doc.html('ds-overlay', '');
    },

    changed(h) {
        if (h.ext.live) api(h).bindRuntime(true);
        overlay(h);
    },

    selected(h) { overlay(h); },

    tick(h) {
        const $ = h.$;
        if (!h.ext.live) return;
        const list = names(h);
        let any = false;
        list.forEach((n, i) => {
            const down = $.input.down(n);
            if (h.ext.lit[n] !== down) {
                h.ext.lit[n] = down;
                h.doc.cls('tile-' + i, 'lit', down);
                h.doc.cls('act-row-' + i, 'lit', down);
            }
            any = any || down;
        });
        h.ext.anyDown = any;
    },

    hud(h) {
        return h.ext.capturing ? 'нажмите клавишу, мышь или кнопку геймпада — она добавится к действию «' + curName(h) + '»'
            : h.ext.live ? 'тестер: нажимайте клавиши — действия подсвечиваются' : 'привязка к рантайму выключена';
    },

    snapshot(h) {
        return { actions: names(h).length, live: !!h.ext.live, capturing: !!h.ext.capturing, bound: Object.keys(h.$.input.bindings()).length,
            lit: Object.keys(h.ext.lit || {}).filter((n) => h.ext.lit[n]) };
    },

    api(h) { return api(h); },
};

function overlay(h) {
    const list = names(h);
    if (!h.ext.live) { h.doc.html('ds-overlay', '<div class="tester"><p class="empty">Привязка к рантайму выключена.</p></div>'); return; }
    h.doc.html('ds-overlay', '<div class="tester"><h4>ТЕСТЕР ВВОДА — $.input.down(действие)</h4>' + list.map((n, i) =>
        '<div id="tile-' + i + '" class="tile"><span class="tile-name">' + escapeHtml(n) + '</span><span class="tile-keys">' +
        escapeHtml((h.model.actions[n] || []).join(' · ')) + '</span></div>').join('') + '</div>');
    h.ext.lit = {};
}

function api(h) {
    const $ = h.$;
    return {
        addAction(name) {
            const base = name || 'action';
            let n = base, i = 1;
            while (h.model.actions[n]) n = base + (++i);
            h.run('действие «' + n + '»', (m) => { m.actions[n] = ['space']; });
            h.select(names(h).indexOf(n));
            return n;
        },
        removeAction(name) {
            if (name === undefined) return false;
            return h.run('удаление «' + name + '»', (m) => { delete m.actions[name]; }) !== null;
        },
        renameAction(name, to) {
            const next = String(to || '').trim();
            if (name === undefined || !next || next === name) return false;
            return h.run('переименование «' + name + '»', (m) => {
                if (m.actions[next]) throw new Error('Действие «' + next + '» уже есть');
                const out = {};
                for (const k of Object.keys(m.actions)) out[k === name ? next : k] = m.actions[k];
                m.actions = out;
            }) !== null;
        },
        addKey(name, key) {
            const k = humanKey(key);
            if (name === undefined || !k) return false;
            return h.run('клавиша «' + k + '»', (m) => {
                const list = m.actions[name];
                if (list.indexOf(k) < 0) list.push(k);
            }) !== null;
        },
        removeKey(name, i) {
            return h.run('убрать клавишу', (m) => {
                const list = m.actions[name];
                if (list.length <= 1) throw new Error('У действия должна остаться хотя бы одна клавиша');
                list.splice(i, 1);
            }) !== null;
        },
        setDeadzone(text) {
            const v = parseNum(text);
            return h.run('мёртвая зона', (m) => {
                if (v === null) { delete m.deadzone; return; }
                if (Number.isNaN(v) || v < 0 || v > 1) throw new Error('Мёртвая зона — число 0..1');
                m.deadzone = v;
            }) !== null;
        },
        capture(on) {
            h.ext.capturing = !!on && curName(h) !== undefined;
            h.renderAll();
            return h.ext.capturing;
        },
        /** Привязать (или снять) действия файла к настоящему `$.input` — тестер читает его же. */
        bindRuntime(on) {
            for (const a of Object.keys($.input.bindings())) $.input.unbind(a);
            h.ext.live = !!on;
            if (on) {
                for (const a of names(h)) $.input.bind(a, h.model.actions[a]);
                if (h.model.deadzone !== undefined) $.input.deadzone(h.model.deadzone);
            } else {
                for (const a of Object.keys(h.ext.saved || {})) $.input.bind(a, h.ext.saved[a]);
            }
            overlay(h);
            h.renderAll();
            return h.ext.live;
        },
        names: () => names(h),
    };
}

export const standalone = true;

export async function open(app, args) {
    return openStudio(app, DEF, args);
}
