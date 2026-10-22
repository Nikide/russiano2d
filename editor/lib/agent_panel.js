// Панель «Агент»: правая боковая панель Editor — чат, подключение, подтверждение действий.
// Логика цикла — agent_harness.js; здесь только RmlUi-обвязка. Ключ API живёт
// только в памяти процесса: на диск и в project.json он не попадает.

import { createAgent, editorTools, studioTools, snippetTools, interactTools, docContext, undoEdits } from './agent_harness.js';
import { httpTransport } from './agent_models.js';
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
    pixel_art: ['brush', 'Рисую спрайт'], generate_sound: ['volume_up', 'Генерирую звук'], pixel_preview: ['image', 'Просмотр спрайта'], skill_list: ['school', 'Навыки'], skill_load: ['school', 'Навык'],
};

const SUGGESTIONS = [
    'Собери простой платформер: сцена, герой с управлением, платформы, монеты и счёт',
    'Найди готовые кирпичики для врага, который преследует игрока, и подключи их',
    'Проверь проект: validate, lint и прогон игры, исправь найденные проблемы',
    'Собери карту из трёх комнат в Hammer и скомпилируй её',
];

const kfmt = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
const short = (t, n) => { const x = String(t === undefined || t === null ? '' : t).replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };

function argSummary(name, input) {
    const i = input || {};
    if (name === 'snippet_apply') return short((i.package || '?') + ' · ' + (i.owner || '?'), 54);
    if (name === 'r2d_cli') return short((Array.isArray(i.args) ? i.args : []).join(' '), 54);
    if (name === 'studio_op') return short((i.op || '?') + (i.args ? ' ' + JSON.stringify(i.args) : ''), 54);
    for (const k of ['query', 'name', 'page', 'path', 'package', 'op', 'owner', 'scene']) if (i[k]) return short(i[k], 54);
    return short(JSON.stringify(i) === '{}' ? '' : JSON.stringify(i), 54);
}

const SESSION_FILE = '.r2d-agent.json';   // беседа с агентом: лежит в проекте, чтобы продолжить с того же места
const SESSION_MAX_BYTES = 1500000;

export function createAgentPanel($, doc, host) {
    const icon = (n) => $.ui.icon(n) || '';
    const models = host.models;
    const st = {
        log: [], agent: null, pending: null, busy: false, open: false, expanded: new Set(), scrollPending: 0, warmed: false,
        mascot: createMascot(), mcKey: '', plan: [], asking: null, history: null, usage: { input: 0, output: 0, cached: 0, calls: 0 },
    };
    // Настройки — в общем хранилище моделей (вкладка «Модели»): панель только читает их.
    Object.defineProperty(st, 'cfg', { get: () => models.cfg() });
    Object.defineProperty(st, 'mascotOn', { get: () => models.state.mascotOn });
    let cfgSig = '';
    const sigOf = () => { const c = models.cfg(); return [c.provider, c.base, c.model, c.key, c.folder].join('|'); };

    const transport = httpTransport($);

    function push(entry) {
        st.log.push(entry);
        if (st.log.length > 400) st.log.splice(0, st.log.length - 400);
        st.scrollPending = 3;
        render();
    }

    function confirm(name, input) {
        // «Разрешать всё»: запись, студии и команды выполняются без вопроса (откат ↶ остаётся).
        if (models.state.autoApprove) return Promise.resolve(true);
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
        const history = [];
        const fsHost = {
            tool: host.tool, abs,
            exists: (p) => $.fs.exists(root() + '/' + p),
            readText: (p) => $.fs.readText(root() + '/' + p),
            writeText: (p, c) => { $.fs.write(root() + '/' + p, c); host.changed(p); },
            remove: (p) => { $.fs.remove(root() + '/' + p); host.changed(p); },
            afterUndo: (p) => host.changed(p),
            list: () => host.files(),
            history,
        };
        const tools = editorTools(fsHost);
        st.history = history;
        st.fsHost = fsHost;
        const studio = studioTools({ ...host, pushStep: (step) => { history.push(step); if (history.length > 100) history.shift(); }, remember: (p) => history.push({ items: [{ path: p, before: fsHost.exists(p) ? fsHost.readText(p) : null }] }) });
        const interact = interactTools({
            setPlan: (items) => { st.plan = items; render(); },
            ask: (question, options) => new Promise((resolve) => { st.asking = { question, options, resolve }; st.scrollPending = 3; st.mascot.asking(); applyMascot(); render(); }),
        });
        st.agent = createAgent({
            config: models.cfg(), transport, tools: tools.concat(studio, snippetTools(fsHost), interact), confirm,
            context: (q) => docContext(host, q, 4),
            events: {
                text: (t) => { st.mascot.talk(); applyMascot(); push({ kind: 'bot', text: t }); },
                tool: (name, input, id) => { st.mascot.tool(name); applyMascot(); push({ kind: 'tool', name, input, id, status: 'run' }); },
                result: (name, out, isErr, id) => {
                    for (let i = st.log.length - 1; i >= 0; i--) {
                        const e = st.log[i];
                        if (e.kind === 'tool' && e.status === 'run' && (id !== undefined ? e.id === id : e.name === name)) { e.status = isErr ? 'err' : 'ok'; e.result = String(out); break; }
                    }
                    render();
                },
                error: (m) => { st.mascot.failure('Не получилось…'); applyMascot(); push({ kind: 'err', text: m }); },
                usage: (_u, sum) => { st.usage = { ...sum }; render(); },
                limit: (n) => { st.mascot.failure('Устала… продолжим?'); applyMascot(); push({ kind: 'limit', text: 'Достигнут лимит шагов (' + n + ') — агент остановился на середине.' }); },
            },
        });
        if (st.keep) { st.agent.state.messages.push(...st.keep); st.keep = null; }
    }

    // --- беседа в проекте ---------------------------------------------------------
    function sessionPath() { const p = host.project(); return p ? p.abs + '/' + SESSION_FILE : null; }

    function saveSession() {
        const path = sessionPath();
        if (!path) return;
        try {
            const messages = st.agent ? st.agent.state.messages : (st.keep || []);
            if (!st.log.length && !messages.length) { if ($.fs.exists(path)) $.fs.remove(path); return; }
            const log = st.log.slice(-200).map((e) => (e.result ? { ...e, result: String(e.result).slice(0, 1500) } : e));
            let from = Math.max(0, messages.length - 80);
            let text;
            for (;;) {
                text = JSON.stringify({ version: 1, savedAt: Date.now(), provider: models.state.active, messages: messages.slice(from), log, plan: st.plan, usage: st.usage });
                if (text.length <= SESSION_MAX_BYTES || from >= messages.length - 2) break;
                from += Math.max(2, ((messages.length - from) / 4) | 0);
            }
            // история не должна начинаться с результата инструмента без вызова: берём с реплики пользователя
            $.fs.write(path, text);
        } catch (_) { /* беседа не критична */ }
    }

    // Загрузка беседы нового проекта: прежняя уже сохранена в конце хода.
    function switchProject(abs) {
        st.sessionFor = abs;
        st.log.length = 0; st.expanded.clear(); st.agent = null; st.keep = null; st.plan = []; st.pending = null;
        st.usage = { input: 0, output: 0, cached: 0, calls: 0 };
        if (st.asking) { st.asking.resolve(null); st.asking = null; }
        let data = null;
        try { data = $.fs.exists(abs + '/' + SESSION_FILE) ? JSON.parse($.fs.readText(abs + '/' + SESSION_FILE)) : null; } catch (_) { data = null; }
        if (data && data.version === 1 && Array.isArray(data.messages) && data.messages.length) {
            let msgs = data.messages;
            const firstUser = msgs.findIndex((m) => m.role === 'user' && (typeof m.content === 'string' || m.content.some((b) => b.type !== 'tool_result')));
            msgs = firstUser > 0 ? msgs.slice(firstUser) : msgs;
            st.keep = msgs;
            if (Array.isArray(data.log)) for (const e of data.log) st.log.push(e);
            if (Array.isArray(data.plan)) st.plan = data.plan;
            if (data.usage) st.usage = data.usage;
            st.log.push({ kind: 'bot', text: 'Беседа восстановлена — продолжаем с того места, где остановились.' });
        }
        st.scrollPending = 3;
        render();
    }

    async function send(override) {
        const text = typeof override === 'string' ? override : String(doc.value('ag-input') || '').trim();
        if (!text || st.busy) return;
        if (!host.project()) { push({ kind: 'err', text: 'Сначала откройте проект.' }); return; }
        if (!models.configured(models.state.active)) {
            push({ kind: 'err', text: 'Нужен API-ключ: введите его на вкладке «Модели».' }); host.showSettings(); return;
        }
        if (!st.agent) build();
        if (typeof override !== 'string') doc.setValue('ag-input', '');
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
            saveSession();
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
        return '<span class="plan-head">План · ' + done + ' из ' + st.plan.length + '</span><div id="ag-plan-rows">' + st.plan.map((x) =>
            '<div class="plan-row ' + x.status + '"><span class="plan-ic">' + icon(x.status === 'done' ? 'check_circle' : x.status === 'doing' ? 'play_circle' : 'radio_button_unchecked') + '</span><span>' + esc(x.text) + '</span></div>').join('') + '</div>';
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
            return '<div class="ag-empty"><span class="ag-empty-av"></span><span class="ag-empty-h">Чем помочь?</span>' +
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
                const pv = e.result !== undefined && /\[preview: ([^\]]+)\]/.exec(String(e.result));
                if (pv) tools += '<div class="agt-img"><img src="' + esc(pv[1]) + '"/></div>';
                if (st.expanded.has(idx) && e.result !== undefined) tools += '<span class="agt-res">' + esc(short(String(e.result).replace(/\[preview: [^\]]+\]/, ''), 900)) + '</span>';
                return;
            }
            flush();
            if (e.kind === 'user') out += '<div class="agm"><span class="ag-ub">' + esc(e.text) + '</span></div>';
            else if (e.kind === 'limit') out += '<div class="ag-limit"><span class="ag-limit-t">' + esc(e.text) + '</span>' + (e.used ? '' : '<span id="ag-continue-' + idx + '" class="ag-send" data-key="continue:' + idx + '">Продолжить</span>') + '</div>';
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
        doc.cls('mc', 'off', !st.mascotOn);
        // на вкладке — маленький «крабик»: во время работы показывает текущий кадр, в покое — улыбка
        doc.attr('bt-agent-mc', 'class', st.busy || st.pending || m.mode === 'success' || m.mode === 'failure' ? cls : 'mc-idle-0');
    }

    function render() {
        const provider = models.spec(models.state.active);
        const cur = models.profile(models.state.active);
        if (!st.open) return;
        warm();
        const needKey = !models.configured(models.state.active);
        const pill = st.asking ? ['wait', 'Ждёт ответа'] : st.pending ? ['wait', 'Ждёт подтверждения'] : st.busy ? ['busy', 'Работает'] : needKey ? ['need', 'Нужен ключ'] : ['', 'Готов'];
        doc.text('ag-state', pill[1]);
        for (const c of ['busy', 'wait', 'need']) doc.cls('ag-state', c, pill[0] === c);
        doc.text('ag-mode', models.state.autoApprove ? 'Разрешать всё' : 'Спрашивать');
        doc.cls('ag-mode', 'on', models.state.autoApprove);
        doc.text('ag-model-chip', esc(provider.label + ' · ' + (cur.model || provider.model) + '  ›'));
        doc.text('ag-usage', st.usage.calls ? esc('↑' + kfmt(st.usage.input) + ' ↓' + kfmt(st.usage.output) + (st.usage.cached ? ' · кэш ' + kfmt(st.usage.cached) : '')) : '');
        doc.cls('ag-send', 'hidden', st.busy);
        doc.cls('ag-stop', 'hidden', !st.busy);
        doc.html('ag-log', logHtml());
        doc.cls('ag-plan', 'hidden', !st.plan.length);
        doc.cls('ag-side', 'off', !st.plan.length);
        doc.html('ag-plan', planHtml());
        doc.cls('ag-undo', 'disabled', !(st.history && st.history.length));
        doc.cls('ag-ask', 'hidden', !st.pending && !st.asking);
        doc.html('ag-ask', st.asking ? askQuestionCard() : askCard());
        if (st.pending) { doc.on('ag-yes', 'click', () => answer(true)); doc.on('ag-no', 'click', () => answer(false)); }
        if (st.asking) st.asking.options.forEach((_, i) => doc.on('ag-opt-' + i, 'click', () => answerAsk(i)));
        applyMascot();
    }

    function wire() {
        doc.text('ag-clear', icon('add_comment')); doc.text('ag-undo', icon('undo'));
        doc.on('ag-send', 'click', () => { st.mascot.wake(); send(); });
        doc.on('ag-stop', 'click', () => { if (st.agent) st.agent.stop(); if (st.asking) answerAsk(null); answer(false); });
        doc.on('ag-clear', 'click', () => { st.log.length = 0; st.expanded.clear(); st.agent = null; st.keep = null; st.usage = { input: 0, output: 0, cached: 0, calls: 0 }; st.pending = null; st.plan = []; if (st.asking) { st.asking.resolve(null); st.asking = null; } saveSession(); render(); });
        doc.on('ag-undo', 'click', () => {
            if (!st.history || !st.history.length || st.busy) return;
            const done = undoEdits(st.history, st.fsHost, 1);
            push({ kind: 'note', text: 'Откат: ' + (done.join('; ') || 'нечего откатывать') });
        });
        doc.on('ag-model-chip', 'click', () => host.showSettings());
        doc.on('ag-gear', 'click', () => host.showSettings());
        doc.on('ag-mode', 'click', () => {
            models.setBehavior({ autoApprove: !models.state.autoApprove });
            // уже висящий вопрос при включении режима принимается сразу
            if (models.state.autoApprove && st.pending) answer(true);
        });
        doc.on('mc', 'click', () => { st.mascot.poke(); applyMascot(); });
        doc.on('ag-log', 'click', (_id, _ev, key) => {
            if (!key) return;
            if (key.startsWith('tool:')) { const n = Number(key.slice(5)); if (st.expanded.has(n)) st.expanded.delete(n); else st.expanded.add(n); render(); }
            else if (key.startsWith('continue:')) { const e = st.log[Number(key.slice(9))]; if (e && !e.used && !st.busy) { e.used = true; send('Продолжай с того места, где остановился. Заверши задачу и кратко отчитайся.'); } }
            else if (key.startsWith('sug:')) { doc.setValue('ag-input', SUGGESTIONS[Number(key.slice(4))] || ''); doc.focus('ag-input'); }
        });
        doc.text('ag-gear', icon('settings'));
        cfgSig = sigOf();
        // Смена модели/ключа во вкладке «Модели»: беседа остаётся, агент пересоздаётся с новой настройкой.
        models.onChange(() => {
            const sig = sigOf();
            if (sig !== cfgSig) { cfgSig = sig; if (st.agent) { st.keep = st.agent.state.messages.slice(); st.agent = null; } }
            st.mcKey = ''; render(); applyMascot();
        });
        applyMascot();
    }

    const api = {
        render, wire, state: st,
        // Вызывается Editor при смене вкладки нижней панели: чат и/или настройки видны.
        setOpen(chat) {
            const was = st.open;
            st.open = !!chat;
            if (was === st.open) return;
            if (st.open) st.scrollPending = 3;
            render();
        },
        // Раз в кадр: маскот, автопрокрутка вниз (после раскладки новой разметки) и Ctrl/⌘+Enter в поле ввода.
        tick(primaryDown, dt) {
            const proj = host.project();
            if (proj && st.sessionFor !== proj.abs && !st.busy) switchProject(proj.abs);
            if (st.mascot.tick(dt || 1 / 60, st.busy || !!st.pending)) applyMascot();
            if (!st.open) return;
            if (st.scrollPending > 0 && --st.scrollPending === 0 && st.log.length) doc.scroll('ag-log');   // пустой чат остаётся сверху
            if (primaryDown && $.ui.typing() && $.input.pressed('enter')) send();
        },
    };
    return api;
}
