// Панель «Агент»: правая боковая панель Editor — чат, подключение, подтверждение действий.
// Логика цикла — agent_harness.js; здесь только RmlUi-обвязка. Ключ API живёт
// только в памяти процесса: на диск и в project.json он не попадает.

import { PROVIDERS, createAgent, editorTools, studioTools, snippetTools, interactTools, docContext, testConnection, undoEdits } from './agent_harness.js';
import { createMascot } from './agent_mascot.js';
import { esc as escRml } from './studio_kit.js';

// RmlUi считает `{{`/`}}` в тексте выражением привязки данных (JSON с вложенными
// объектами ломал разметку): разделяем парные скобки невидимым пробелом.
const esc = (t) => escRml(t).replace(/\{(?=\{)/g, '{\u200b').replace(/\}(?=\})/g, '}\u200b');

// Иконка и подпись инструмента в журнале.
const TOOL_UI = {
    docs_search: ['search', 'Поиск в документации'], docs_show: ['menu_book', 'Страница документации'], api_lookup: ['functions', 'Проверка API'],
    list_files: ['folder_open', 'Файлы проекта'], read_file: ['description', 'Чтение файла'], write_file: ['edit_document', 'Запись файла'],
    edit_file: ['edit', 'Правка файла'], r2d_validate: ['fact_check', 'Проверка проекта'], r2d_lint: ['rule', 'Линт'],
    run_check: ['play_arrow', 'Прогон игры'], screenshot_check: ['photo_camera', 'Проверка кадра'], project_info: ['info', 'О проекте'],
    r2d_cli: ['terminal', 'Команда r2d'], tabs: ['tab', 'Вкладки'], open_tab: ['tab', 'Открыть вкладку'], studio_ops: ['widgets', 'Операции студии'],
    studio_state: ['widgets', 'Состояние студии'], studio_edit: ['tune', 'Правка студии'], studio_op: ['construction', 'Операция студии'],
    studio_save: ['save', 'Сохранение студии'], editor_op: ['build', 'Операция Editor'], snippet_find: ['extension', 'Поиск кирпичика'],
    snippet_apply: ['extension', 'Кирпичик'], search_project: ['manage_search', 'Поиск по проекту'], delete_file: ['delete', 'Удаление файла'],
    move_file: ['drive_file_move', 'Перемещение файла'], undo_edit: ['undo', 'Откат правок'], playtest: ['sports_esports', 'Плейтест игры'],
    plan: ['checklist', 'План'], ask_user: ['help', 'Вопрос'],
};

const SUGGESTIONS = [
    'Собери простой платформер: сцена, герой с управлением, платформы, монеты и счёт',
    'Найди готовые кирпичики для врага, который преследует игрока, и подключи их',
    'Проверь проект: validate, lint и прогон игры, исправь найденные проблемы',
    'Собери карту из трёх комнат в Hammer и скомпилируй её',
];

const short = (t, n) => { const x = String(t === undefined || t === null ? '' : t).replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };

function argSummary(name, input) {
    const i = input || {};
    if (name === 'snippet_apply') return short((i.package || '?') + ' · ' + (i.owner || '?'), 54);
    if (name === 'r2d_cli') return short((Array.isArray(i.args) ? i.args : []).join(' '), 54);
    if (name === 'studio_op') return short((i.op || '?') + (i.args ? ' ' + JSON.stringify(i.args) : ''), 54);
    for (const k of ['query', 'name', 'page', 'path', 'package', 'op', 'owner', 'scene']) if (i[k]) return short(i[k], 54);
    return short(JSON.stringify(i) === '{}' ? '' : JSON.stringify(i), 54);
}

export function createAgentPanel($, doc, host) {
    const icon = (n) => $.ui.icon(n) || '';
    const st = {
        cfg: { provider: 'anthropic', base: PROVIDERS.anthropic.base, model: PROVIDERS.anthropic.model, key: '', folder: '', maxSteps: 24 },
        log: [], agent: null, pending: null, busy: false, open: false, cfgOpen: false, expanded: new Set(), scrollPending: 0, warmed: false,
        mascot: createMascot(), mascotOn: true, mcKey: '', testing: false, plan: [], asking: null, history: null,
    };

    function transport(url, opts) {
        return $.http.post(url, opts.body, { headers: opts.headers, timeout: opts.timeout }).then((res) => {
            let json = null;
            try { json = res.json(); } catch (_) { json = null; }
            return { ok: res.ok, status: res.status, json, text: res.body };
        });
    }

    function push(entry) {
        st.log.push(entry);
        if (st.log.length > 400) st.log.splice(0, st.log.length - 400);
        st.scrollPending = 3;
        render();
    }

    function confirm(name, input) {
        return new Promise((resolve) => {
            st.pending = { name, input, resolve };
            st.scrollPending = 3;
            st.mascot.waiting(); applyMascot();
            render();
        });
    }

    function build() {
        // Корень проекта берётся при каждом вызове: new_project/open_project меняют его на ходу.
        const root = () => { const p = host.project(); if (!p) throw new Error('проект не открыт'); return p.abs; };
        const abs = (p) => (p ? root() + '/' + p : root());
        const tools = editorTools({
            tool: host.tool, abs,
            exists: (p) => $.fs.exists(root() + '/' + p),
            readText: (p) => $.fs.readText(root() + '/' + p),
            writeText: (p, c) => { $.fs.write(root() + '/' + p, c); host.changed(p); },
            remove: (p) => { $.fs.remove(root() + '/' + p); host.changed(p); },
            afterUndo: (p) => host.changed(p),
            list: () => host.files(),
        });
        st.history = tools.history;
        st.fsHost = { exists: (p) => $.fs.exists(root() + '/' + p), writeText: (p, c) => { $.fs.write(root() + '/' + p, c); host.changed(p); }, remove: (p) => { $.fs.remove(root() + '/' + p); host.changed(p); }, afterUndo: (p) => host.changed(p) };
        const interact = interactTools({
            setPlan: (items) => { st.plan = items; render(); },
            ask: (question, options) => new Promise((resolve) => { st.asking = { question, options, resolve }; st.scrollPending = 3; st.mascot.asking(); applyMascot(); render(); }),
        });
        st.agent = createAgent({
            config: st.cfg, transport, tools: tools.concat(studioTools(host), snippetTools({ tool: host.tool, abs }), interact), confirm,
            context: (q) => docContext(host, q, 4),
            events: {
                text: (t) => { st.mascot.talk(); applyMascot(); push({ kind: 'bot', text: t }); },
                tool: (name, input) => { st.mascot.tool(name); applyMascot(); push({ kind: 'tool', name, input, status: 'run' }); },
                result: (name, out, isErr) => {
                    for (let i = st.log.length - 1; i >= 0; i--) {
                        const e = st.log[i];
                        if (e.kind === 'tool' && e.status === 'run' && e.name === name) { e.status = isErr ? 'err' : 'ok'; e.result = String(out); break; }
                    }
                    render();
                },
                error: (m) => { st.mascot.failure('Не получилось…'); applyMascot(); push({ kind: 'err', text: m }); },
            },
        });
    }

    function readFields() {
        st.cfg.base = String(doc.value('ag-base') || '').trim();
        st.cfg.model = String(doc.value('ag-model') || '').trim();
        const key = String(doc.value('ag-key') || '').trim();
        if (key !== st.cfg.key) st.cfg._token = null;   // новый ключ — новый токен
        st.cfg.key = key;
        const steps = parseInt(String(doc.value('ag-steps') || ''), 10);
        if (steps >= 1 && steps <= 100) st.cfg.maxSteps = steps;
    }

    async function send() {
        const text = String(doc.value('ag-input') || '').trim();
        if (!text || st.busy) return;
        readFields();
        if (!host.project()) { push({ kind: 'err', text: 'Сначала откройте проект.' }); return; }
        if (PROVIDERS[st.cfg.provider].auth !== 'bearer' && !st.cfg.key) {
            push({ kind: 'err', text: 'Нужен API-ключ: он вводится на вкладке «Настройки агента».' }); host.showSettings(); return;
        }
        if (!st.agent) build();
        doc.setValue('ag-input', '');
        push({ kind: 'user', text });
        st.busy = true; st.mascot.wake(); st.mascot.thinking(); applyMascot(); render();
        let failed = false;
        try { await st.agent.send(text); }
        catch (e) { failed = true; push({ kind: 'err', text: e && e.message || String(e) }); }
        finally {
            st.busy = false; st.pending = null;
            for (const e of st.log) if (e.status === 'run') e.status = 'err';
            const lastErr = st.log.length && st.log[st.log.length - 1].kind === 'err';
            if (failed || lastErr) st.mascot.failure('Что-то пошло не так…'); else st.mascot.success();
            applyMascot(); st.scrollPending = 3; render();
        }
    }

    function answer(ok) {
        const p = st.pending;
        if (!p) return;
        st.pending = null;
        p.resolve(ok);
        if (ok) { st.mascot.thinking(); applyMascot(); }
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

    // Первый запрос к встроенной модели строит индекс корпуса (~минута, один раз):
    // прогреваем при первом показе панели, чтобы первый вопрос не ждал.
    function warm() {
        if (st.warmed) return;
        st.warmed = true;
        try { Promise.resolve($.sdk.tool(['docs', 'context', 'прогрев', '--limit', '1', '--quiet'])).catch(() => {}); } catch (_) { /* без прогрева */ }
    }

    function askCard() {
        const p = st.pending;
        if (!p) return '';
        const i = p.input || {};
        let title = 'Нужно подтверждение', body = '';
        const code = (t, cls) => '<span class="' + cls + '">' + esc(short(t, 700)) + '</span>';
        switch (p.name) {
        case 'write_file': title = 'Записать файл'; body = '<b>' + esc(i.path || '?') + '</b> · ' + String(String(i.content || '').length) + ' симв.' + code(String(i.content || '').split('\n').slice(0, 8).join('\n'), 'ask-code'); break;
        case 'edit_file': title = 'Изменить файл'; body = '<b>' + esc(i.path || '?') + '</b>' + code(i.old_string || '', 'ask-del') + code(i.new_string || '', 'ask-add'); break;
        case 'studio_op': title = 'Операция студии'; body = '<b>' + esc(i.op || '?') + '</b>' + code(JSON.stringify(i.args || {}), 'ask-code'); break;
        case 'studio_edit': title = 'Правка документа студии'; body = code(JSON.stringify(i.patch || {}), 'ask-code'); break;
        case 'studio_save': title = 'Сохранить документ студии'; body = '<b>' + esc(i.path || 'активная вкладка') + '</b>'; break;
        case 'editor_op': title = 'Операция Editor'; body = '<b>' + esc(i.op || '?') + '</b>' + code(JSON.stringify(i.args || {}), 'ask-code'); break;
        case 'delete_file': title = 'Удалить файл'; body = '<b>' + esc(i.path || '?') + '</b>'; break;
        case 'move_file': title = 'Переместить файл'; body = '<b>' + esc(i.from || '?') + '</b> → <b>' + esc(i.to || '?') + '</b>'; break;
        case 'undo_edit': title = 'Откатить правки агента'; body = 'шагов: ' + esc(i.count || 1); break;
        case 'r2d_cli': title = 'Команда r2d'; body = code('r2d ' + (Array.isArray(i.args) ? i.args.join(' ') : ''), 'ask-code'); break;
        case 'snippet_apply': title = 'Подключить кирпичик'; body = '<b>' + esc(i.package || '?') + '</b> → <b>' + esc(i.owner || '?') + '</b>' + (i.values ? code(JSON.stringify(i.values), 'ask-code') : ''); break;
        default: body = '<b>' + esc(p.name) + '</b>' + code(JSON.stringify(i), 'ask-code');
        }
        return '<span class="ask-head">' + icon('shield') + ' ' + esc(title) + '</span><div class="ask-body">' + body + '</div>' +
            '<div class="ask-btns"><span id="ag-yes" class="ask-yes">Разрешить</span><span id="ag-no" class="ask-no">Отклонить</span></div>';
    }

    function planHtml() {
        if (!st.plan.length) return '';
        const done = st.plan.filter((x) => x.status === 'done').length;
        return '<span class="plan-head">План · ' + done + ' из ' + st.plan.length + '</span>' + st.plan.map((x) =>
            '<div class="plan-row ' + x.status + '"><span class="plan-ic">' + icon(x.status === 'done' ? 'check_circle' : x.status === 'doing' ? 'play_circle' : 'radio_button_unchecked') + '</span><span>' + esc(x.text) + '</span></div>').join('');
    }

    function askQuestionCard() {
        const q = st.asking;
        return '<span class="ask-head">' + icon('help') + ' Вопрос агента</span><span class="ask-q">' + esc(q.question) + '</span><div class="ask-opts">' +
            q.options.map((o, i) => '<span id="ag-opt-' + i + '" class="ask-opt">' + esc(o) + '</span>').join('') + '</div>';
    }

    function answerAsk(i) {
        const q = st.asking;
        if (!q) return;
        st.asking = null;
        const text = i === null ? null : q.options[i];
        if (text !== null) push({ kind: 'user', text });
        q.resolve(text);
        st.mascot.thinking(); applyMascot();
        render();
    }

    function logHtml() {
        if (!st.log.length) {
            return '<div class="ag-empty"><span class="ag-empty-ic">' + icon('smart_toy') + '</span><span class="ag-empty-h">Чем помочь?</span>' +
                '<span class="ag-empty-p">Агент ищет в документации и кирпичиках, читает и правит файлы проекта, работает со студиями и проверяет результат. Изменения — только с вашего подтверждения.</span>' +
                SUGGESTIONS.map((t, n) => '<div class="ag-sug" data-key="sug:' + n + '">' + esc(t) + '</div>').join('') + '</div>';
        }
        let out = '', tools = '';
        const flush = () => { if (tools) { out += '<div class="ag-tools">' + tools + '</div>'; tools = ''; } };
        st.log.forEach((e, idx) => {
            if (e.kind === 'tool') {
                const ui = TOOL_UI[e.name] || ['build', e.name];
                const stIcon = e.status === 'ok' ? icon('check_circle') : e.status === 'err' ? icon('error') : icon('more_horiz');
                tools += '<div class="agt" data-key="tool:' + idx + '"><span class="agt-ic">' + icon(ui[0]) + '</span><span class="agt-name">' + esc(ui[1]) + '</span>' +
                    '<span class="agt-arg">' + esc(argSummary(e.name, e.input)) + '</span><span class="agt-st ' + e.status + '">' + stIcon + '</span></div>';
                if (st.expanded.has(idx) && e.result !== undefined) tools += '<span class="agt-res">' + esc(short(e.result, 900)) + '</span>';
                return;
            }
            flush();
            if (e.kind === 'user') out += '<div class="agm"><span class="ag-ub">' + esc(e.text) + '</span></div>';
            else if (e.kind === 'note') out += '<span class="ag-note">' + esc(e.text) + '</span>';
            else if (e.kind === 'bot') out += '<div class="agm agm-bot"><span class="ag-av"></span><span class="ag-bt">' + esc(e.text) + '</span></div>';
            else out += '<span class="ag-errbox">' + esc(e.text) + '</span>';
        });
        flush();
        if (st.busy && !st.pending) out += '<span class="ag-working">Агент работает…</span>';
        return out;
    }

    // Применить состояние маскота к DOM: большой персонаж, реплика и иконка на вкладке «Агент».
    function applyMascot() {
        const m = st.mascot.state;
        const cls = 'mc-' + m.frame.replace(/_/g, '-');
        const key = cls + '|' + m.bubble + '|' + st.mascotOn;
        if (key === st.mcKey) return;
        st.mcKey = key;
        doc.attr('mc', 'class', cls);
        doc.text('mc-bubble', esc(m.bubble));
        doc.cls('mc-bubble', 'hidden', !m.bubble || !st.mascotOn);
        doc.cls('ag-side', 'off', !st.mascotOn);
        // на вкладке — маленький «крабик»: во время работы показывает текущий кадр, в покое — улыбка
        doc.attr('bt-agent-mc', 'class', st.busy || st.pending || m.mode === 'success' || m.mode === 'failure' ? cls : 'mc-idle-0');
    }

    function render() {
        const provider = PROVIDERS[st.cfg.provider];
        if (st.cfgOpen) {
            for (const id of Object.keys(PROVIDERS)) doc.cls('ag-prov-' + id, 'on', st.cfg.provider === id);
            doc.text('cfg-mascot', st.mascotOn ? 'Маскот: вкл' : 'Маскот: выкл');
            doc.cls('cfg-mascot', 'on', st.mascotOn);
        }
        if (!st.open) return;
        warm();
        const needKey = provider.auth !== 'bearer' && !String(doc.value('ag-key') || st.cfg.key).trim();
        const pill = st.asking ? ['wait', 'Ждёт ответа'] : st.pending ? ['wait', 'Ждёт подтверждения'] : st.busy ? ['busy', 'Работает'] : needKey ? ['need', 'Нужен ключ'] : ['', 'Готов'];
        doc.text('ag-state', pill[1]);
        for (const c of ['busy', 'wait', 'need']) doc.cls('ag-state', c, pill[0] === c);
        doc.text('ag-model-chip', esc(provider.label + ' · ' + (st.cfg.model || provider.model) + '  ›'));
        doc.cls('ag-send', 'hidden', st.busy);
        doc.cls('ag-stop', 'hidden', !st.busy);
        doc.html('ag-log', logHtml());
        doc.cls('ag-plan', 'hidden', !st.plan.length);
        doc.html('ag-plan', planHtml());
        doc.cls('ag-undo', 'disabled', !(st.history && st.history.length));
        doc.cls('ag-ask', 'hidden', !st.pending && !st.asking);
        doc.html('ag-ask', st.asking ? askQuestionCard() : askCard());
        if (st.pending) { doc.on('ag-yes', 'click', () => answer(true)); doc.on('ag-no', 'click', () => answer(false)); }
        if (st.asking) st.asking.options.forEach((_, i) => doc.on('ag-opt-' + i, 'click', () => answerAsk(i)));
        applyMascot();
    }

    async function runTest() {
        if (st.testing) return;
        readFields();
        st.testing = true;
        doc.cls('cfg-result', 'ok', false); doc.cls('cfg-result', 'err', false);
        doc.text('cfg-result', 'Проверяю…');
        const r = await testConnection(st.cfg, transport);
        st.testing = false;
        doc.cls('cfg-result', 'ok', r.ok); doc.cls('cfg-result', 'err', !r.ok);
        doc.text('cfg-result', esc(r.ok ? 'Подключение работает · ' + r.ms + ' мс · ответ: «' + r.text + '»' : r.error));
        if (r.ok) { st.mascot.success(); } else { st.mascot.failure('Не подключилась…'); }
        applyMascot();
    }

    function wire() {
        doc.text('ag-clear', icon('add_comment')); doc.text('ag-undo', icon('undo'));
        for (const id of Object.keys(PROVIDERS)) doc.on('ag-prov-' + id, 'click', () => setProvider(id));
        doc.on('ag-send', 'click', () => { st.mascot.wake(); send(); });
        doc.on('ag-stop', 'click', () => { if (st.agent) st.agent.stop(); if (st.asking) answerAsk(null); answer(false); });
        doc.on('ag-clear', 'click', () => { st.log.length = 0; st.expanded.clear(); st.agent = null; st.pending = null; st.plan = []; if (st.asking) { st.asking.resolve(null); st.asking = null; } render(); });
        doc.on('ag-undo', 'click', () => {
            if (!st.history || !st.history.length || st.busy) return;
            const done = undoEdits(st.history, st.fsHost, 1);
            push({ kind: 'note', text: 'Откат: ' + (done.join('; ') || 'нечего откатывать') });
        });
        doc.on('ag-model-chip', 'click', () => host.showSettings());
        doc.on('cfg-test', 'click', () => { runTest(); });
        doc.on('cfg-done', 'click', () => { readFields(); host.showChat(); });
        doc.on('cfg-mascot', 'click', () => { st.mascotOn = !st.mascotOn; st.mcKey = ''; render(); applyMascot(); });
        doc.on('mc', 'click', () => { st.mascot.poke(); applyMascot(); });
        doc.on('ag-log', 'click', (_id, _ev, key) => {
            if (!key) return;
            if (key.startsWith('tool:')) { const n = Number(key.slice(5)); if (st.expanded.has(n)) st.expanded.delete(n); else st.expanded.add(n); render(); }
            else if (key.startsWith('sug:')) { doc.setValue('ag-input', SUGGESTIONS[Number(key.slice(4))] || ''); doc.focus('ag-input'); }
        });
        doc.setValue('ag-base', st.cfg.base); doc.setValue('ag-model', st.cfg.model); doc.setValue('ag-steps', String(st.cfg.maxSteps));
        applyMascot();
    }

    const api = {
        render, wire, state: st,
        // Вызывается Editor при смене вкладки нижней панели: чат и/или настройки видны.
        setOpen(chat, cfg) {
            const was = st.open + '|' + st.cfgOpen;
            st.open = !!chat; st.cfgOpen = !!cfg;
            if (was === st.open + '|' + st.cfgOpen) return;
            if (st.open) st.scrollPending = 3;
            render();
        },
        // Раз в кадр: маскот, автопрокрутка вниз (после раскладки новой разметки) и Ctrl/⌘+Enter в поле ввода.
        tick(primaryDown, dt) {
            if (st.mascot.tick(dt || 1 / 60, st.busy || !!st.pending)) applyMascot();
            if (!st.open) return;
            if (st.scrollPending > 0 && --st.scrollPending === 0) doc.scroll('ag-log');
            if (primaryDown && $.ui.typing() && $.input.pressed('enter')) send();
        },
    };
    return api;
}
