// Панель «Агент» в нижней части Editor: чат + настройки + подтверждение записи.
// Логика цикла — agent_harness.js; здесь только RmlUi-обвязка. Ключ API живёт
// только в памяти процесса: на диск и в project.json он не попадает.

import { PROVIDERS, createAgent, editorTools, studioTools, snippetTools, docContext } from './agent_harness.js';
import { esc as escRml } from './studio_kit.js';

// RmlUi считает `{{`/`}}` в тексте выражением привязки данных (JSON с вложенными
// объектами ломал разметку): разделяем парные скобки невидимым пробелом.
const esc = (t) => escRml(t).replace(/\{(?=\{)/g, '{\u200b').replace(/\}(?=\})/g, '}\u200b');

export function createAgentPanel($, doc, host) {
    const st = {
        cfg: { provider: 'anthropic', base: PROVIDERS.anthropic.base, model: PROVIDERS.anthropic.model, key: '', folder: '' },
        log: [], agent: null, pending: null, busy: false,
    };

    function transport(url, opts) {
        return $.http.post(url, opts.body, { headers: opts.headers, timeout: opts.timeout }).then((res) => {
            let json = null;
            try { json = res.json(); } catch (_) { json = null; }
            return { ok: res.ok, status: res.status, json, text: res.body };
        });
    }

    function push(kind, text) {
        st.log.push({ kind, text: String(text) });
        if (st.log.length > 400) st.log.splice(0, st.log.length - 400);
        render();
    }

    function confirm(name, input) {
        return new Promise((resolve) => {
            st.pending = { name, input, resolve };
            render();
        });
    }

    function build() {
        // Корень проекта берётся при каждом вызове: new_project/open_project меняют его на ходу.
        const root = () => { const p = host.project(); if (!p) throw new Error('проект не открыт'); return p.abs; };
        const tools = editorTools({
            tool: host.tool, abs: (p) => (p ? root() + '/' + p : root()),
            exists: (p) => $.fs.exists(root() + '/' + p),
            readText: (p) => $.fs.readText(root() + '/' + p),
            writeText: (p, c) => { $.fs.write(root() + '/' + p, c); host.changed(p); },
            list: () => host.files(),
        });
        st.agent = createAgent({
            config: st.cfg, transport, tools: tools.concat(studioTools(host), snippetTools({ tool: host.tool, abs: (p) => (p ? root() + '/' + p : root()) })), confirm,
            context: (q) => docContext(host, q, 4),
            events: {
                text: (t) => push('agent', t),
                tool: (n, i) => push('tool', n + ' ' + JSON.stringify(i).slice(0, 160)),
                result: (n, o) => push('result', String(o).slice(0, 400)),
                error: (m) => push('err', m),
            },
        });
    }

    function readFields() {
        st.cfg.base = String(doc.value('ag-base') || '').trim();
        st.cfg.model = String(doc.value('ag-model') || '').trim();
        const key = String(doc.value('ag-key') || '').trim();
        if (key !== st.cfg.key) st.cfg._token = null;   // новый ключ — новый токен
        st.cfg.key = key;
    }

    async function send() {
        const text = String(doc.value('ag-input') || '').trim();
        if (!text || st.busy) return;
        if (!host.project()) { push('err', 'сначала откройте проект'); return; }
        readFields();
        if (PROVIDERS[st.cfg.provider].auth !== 'bearer' && !st.cfg.key) { push('err', 'нужен API-ключ (поле «ключ»)'); return; }
        if (!st.agent) build();
        doc.setValue('ag-input', '');
        push('user', text);
        st.busy = true; render();
        try { await st.agent.send(text); }
        catch (e) { push('err', e && e.message || String(e)); }
        finally { st.busy = false; st.pending = null; render(); }
    }

    function answer(ok) {
        const p = st.pending;
        if (!p) return;
        st.pending = null;
        p.resolve(ok);
        render();
    }

    function setProvider(id) {
        readFields();
        st.cfg.provider = id;
        st.cfg.base = PROVIDERS[id].base; st.cfg.model = PROVIDERS[id].model;
        st.agent = null;
        doc.setValue('ag-base', st.cfg.base); doc.setValue('ag-model', st.cfg.model);
        render();
    }

    function render() {
        for (const id of Object.keys(PROVIDERS)) doc.cls('ag-prov-' + id, 'on', st.cfg.provider === id);
        doc.cls('ag-send', 'disabled', st.busy);
        doc.cls('ag-stop', 'hidden', !st.busy);
        const rows = st.log.map((m) => '<div class="ag-msg ag-' + m.kind + '">' + esc(m.text) + '</div>').join('');
        const pin = st.pending && st.pending.input || {};
        const what = !st.pending ? '' : st.pending.name === 'edit_file'
            ? 'изменить <b>' + esc(pin.path || '?') + '</b> (' + String(String(pin.old_string || '').length) + ' → ' + String(String(pin.new_string || '').length) + ' симв.)'
            : st.pending.name === 'studio_op' ? 'применить в студии <b>' + esc(pin.op || '?') + '</b> ' + esc(JSON.stringify(pin.args || {}).replace(/"/g, "'").slice(0, 140))
            : st.pending.name === 'studio_edit' ? 'изменить документ студии патчем ' + esc(JSON.stringify(pin.patch || {}).replace(/"/g, "'").slice(0, 140))
            : st.pending.name === 'editor_op' ? 'выполнить в Editor <b>' + esc(pin.op || '?') + '</b> ' + esc(JSON.stringify(pin.args || {}).replace(/"/g, "'").slice(0, 120))
            : st.pending.name === 'r2d_cli' ? 'выполнить <b>r2d ' + esc((Array.isArray(pin.args) ? pin.args : []).join(' ').slice(0, 140)) + '</b>'
            : st.pending.name === 'snippet_apply' ? 'подключить кирпичик <b>' + esc(pin.package || '?') + '</b> к <b>' + esc(pin.owner || '?') + '</b> ' + esc(JSON.stringify(pin.values || {}).replace(/"/g, "'").slice(0, 100))
            : st.pending.name === 'studio_save' ? 'сохранить документ студии <b>' + esc(pin.path || 'активной вкладки') + '</b>'
            : 'записать <b>' + esc(pin.path || '?') + '</b> (' + String(String(pin.content || '').length) + ' симв.)';
        const ask = st.pending
            ? '<div class="ag-ask"><span class="ag-ask-text">Агент хочет ' + what + '</span>' +
              '<button id="ag-yes" class="out-filter on">Разрешить</button><button id="ag-no" class="out-filter">Отклонить</button></div>'
            : '';
        doc.html('ag-log', rows ? rows + ask : (ask || '<span class="empty">Спросите агента: он ищет в документации, читает файлы проекта, запускает lint/validate и пишет файлы с вашего подтверждения.</span>'));
        if (st.pending) { doc.on('ag-yes', 'click', () => answer(true)); doc.on('ag-no', 'click', () => answer(false)); }
    }

    function wire() {
        for (const id of Object.keys(PROVIDERS)) doc.on('ag-prov-' + id, 'click', () => setProvider(id));
        doc.on('ag-send', 'click', () => { send(); });
        doc.on('ag-input', 'change', () => { send(); });
        doc.on('ag-stop', 'click', () => { if (st.agent) st.agent.stop(); answer(false); });
        doc.on('ag-clear', 'click', () => { st.log.length = 0; st.agent = null; render(); });
        doc.setValue('ag-base', st.cfg.base); doc.setValue('ag-model', st.cfg.model);
    }

    return { render, wire, state: st };
}
