// Мини-харнес агента для Editor: цикл «модель → инструменты → модель».
//
// Модуль чистый: сеть и инструменты приходят снаружи (createAgent), поэтому его
// проверяет tests/js/editor_agent_test.mjs без сети. Два протокола:
//   anthropic — Messages API (tool_use / tool_result);
//   openai    — chat/completions (tool_calls), подходит и для локальных
//               серверов (llama-server, Ollama, LM Studio).
// Внутри история хранится в формате блоков Anthropic; для openai она
// переводится на лету.

// protocol: anthropic | openai | gigachat. auth: как ключ уходит в запрос
// (bearer — `Authorization: Bearer`, api-key — `Authorization: Api-Key`,
// x-api-key — заголовок Anthropic, oauth — сначала обмен на токен).
export const PROVIDERS = {
    anthropic: { label: 'Anthropic', protocol: 'anthropic', auth: 'x-api-key', base: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' },
    openai: { label: 'OpenAI-совм.', protocol: 'openai', auth: 'bearer', base: 'http://localhost:8080/v1', model: 'local' },
    // YandexGPT через OpenAI-совместимый эндпоинт Yandex Cloud: ключ сервисного аккаунта
    // (`Api-Key`) или IAM-токен (`Bearer`: начните ключ с `Bearer `); модель — gpt://<id каталога>/yandexgpt/latest.
    yandex: { label: 'YandexGPT', protocol: 'openai', auth: 'api-key', base: 'https://llm.api.cloud.yandex.net/v1', model: 'gpt://<id-каталога>/yandexgpt/latest' },
    // OpenCode Go (подписка): OpenAI-протокол chat/completions; список моделей — GET {base}/models.
    // Часть моделей каталога говорит по /responses или /messages — для них нужны «OpenAI-совм.»/«Anthropic» с другим адресом.
    opencode: { label: 'OpenCode Go', protocol: 'openai', auth: 'bearer', base: 'https://opencode.ai/zen/go/v1', model: 'kimi-k2.7-code', sessionHeader: 'x-opencode-session' },
    deepseek: { label: 'DeepSeek', protocol: 'openai', auth: 'bearer', base: 'https://api.deepseek.com', model: 'deepseek-chat' },
    // GigaChat/GigaCode (Сбер): «Authorization key» из кабинета обменивается на токен (30 мин).
    gigachat: {
        label: 'GigaChat', protocol: 'gigachat', auth: 'oauth', base: 'https://gigachat.devices.sberbank.ru/api/v1', model: 'GigaChat-2',
        oauthUrl: 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth', scope: 'GIGACHAT_API_PERS',
    },
};

export const SYSTEM_PROMPT = [
    'Ты — агент внутри Editor движка Russiano2D (2D/2.5D, один бинарник r2d, игровой API — `$`). Отвечай по-русски, коротко. Действуй, а не исследуй: 3–5 вызовов инструментов на простую задачу.',
    'Правила: только публичный `$` API; не пиши второй движок, ECS, свой scene graph/event bus/менеджеры. Имя `$.…`, в котором не уверен, проверь api_lookup один раз (не гадай именами).',
    'ГОТОВОЕ ПОВЕДЕНИЕ (движение, прыжок, AI, способности, камера, UI) НЕ ПИШИ КОДОМ: snippet_find → snippet_apply. Не вызывай `r2d_cli snippet catalog` — это 500 кирпичиков, используй snippet_find с одним словом.',
    'Объект, к которому цепляется кирпичик, создай в коде с `id`, затем snippet_apply с owner "object:<id>".',
    'Шпаргалка (проверенные идиомы): `$.ready(($) => { $.gfx.color("#141824"); $.world.gravity(0, 1800); $("<player>", { id: "hero" }).at(200, 300).appendTo($.world); $.camera.follow("#hero"); });` — ',
    'текст: `$("<text>", { text: "Очки", size: 32 }).at(640, 40).appendTo($.world)`; картинка: `$("<sprite>", { src: "assets/a.png", w: 64, h: 64 })`; сцены: `$.scene.add("level", ($) => { … })` и запуск `$.scene.load("level")` (внутри `$.ready`). Строку `import "./generated/snippets/index.js"` добавляет генератор кирпичиков — сам её не пиши.',
    'Правка: edit_file (точечно) или write_file (новый файл); после записи .js lint уже запущен — исправь замечания. В конце r2d_validate; при изменении логики — run_check. Не повторяй проверки без правок.',
    'Игра целиком: editor_op new_project (шаблон blank) → код → кирпичики → ресурсы в студиях. Студии и вкладки: tabs/open_tab/studio_ops/studio_state/studio_edit/studio_op/studio_save (карты .re2dmap в Hammer: brush.create, entity.create, element.create…; после серии правок validate и studio_save). Остальное — r2d_cli (atlas-grid, world-compile, project-set…).',
    'Пути — относительно корня проекта. Сначала list_files/read_file, потом пиши.',
].join('\n');

export function toolSpecs(tools) {
    return tools.map((t) => ({ name: t.name, description: t.description, schema: t.schema }));
}

function anthropicBody(cfg, system, messages, tools) {
    return {
        model: cfg.model, max_tokens: cfg.maxTokens || 4096, system, messages,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })),
    };
}

function openaiMessages(system, messages) {
    const out = [{ role: 'system', content: system }];
    for (const m of messages) {
        if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
        if (m.role === 'assistant') {
            const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
            const calls = m.content.filter((b) => b.type === 'tool_use').map((b) => ({
                id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
            }));
            const msg = { role: 'assistant', content: text || null };
            if (calls.length) msg.tool_calls = calls;
            out.push(msg);
        } else {
            for (const b of m.content) {
                if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content });
                else if (b.type === 'text') out.push({ role: 'user', content: b.text });
            }
        }
    }
    return out;
}

function openaiBody(cfg, system, messages, tools) {
    return {
        model: cfg.model, max_tokens: cfg.maxTokens || 4096, messages: openaiMessages(system, messages),
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })),
    };
}

function uuid4() {
    const h = '0123456789abcdef';
    let out = '';
    for (let i = 0; i < 36; i++) {
        if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
        else if (i === 14) out += '4';
        else if (i === 19) out += h[8 + Math.floor(Math.random() * 4)];
        else out += h[Math.floor(Math.random() * 16)];
    }
    return out;
}

// GigaChat: обмен ключа авторизации на токен; токен кэшируется в cfg._token до истечения.
export async function gigachatToken(cfg, transport, now) {
    const t = now === undefined ? Date.now() : now;
    if (cfg._token && cfg._token.exp - 60000 > t) return cfg._token.value;
    const spec = PROVIDERS.gigachat;
    const key = String(cfg.key || '').replace(/^Basic\s+/i, '');
    const res = await transport(cfg.oauthUrl || spec.oauthUrl, {
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', rquid: uuid4(), authorization: 'Basic ' + key },
        body: 'scope=' + (cfg.scope || spec.scope), timeout: cfg.timeout || 30000,
    });
    const data = res.json;
    if (!res.ok || !data || !data.access_token) {
        throw new Error('GigaChat: не удалось получить токен (' + String(data && (data.message || data.error) || res.status).slice(0, 200) + ')');
    }
    cfg._token = { value: data.access_token, exp: Number(data.expires_at) || t + 25 * 60000 };
    return data.access_token;
}

// GigaChat принимает `functions`; результат функции обязан быть JSON-строкой.
function gigachatBody(cfg, system, messages, tools) {
    const names = new Map();
    for (const m of messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_use') names.set(b.id, b.name);
    const out = [{ role: 'system', content: system }];
    for (const m of messages) {
        if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
        if (m.role === 'assistant') {
            const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
            const call = m.content.find((b) => b.type === 'tool_use');
            const msg = { role: 'assistant', content: text };
            if (call) msg.function_call = { name: call.name, arguments: call.input || {} };
            out.push(msg);
        } else {
            for (const b of m.content) if (b.type === 'tool_result') out.push({ role: 'function', name: names.get(b.tool_use_id) || 'tool', content: JSON.stringify({ result: b.content }) });
        }
    }
    return {
        model: cfg.model, messages: out, max_tokens: cfg.maxTokens || 4096,
        functions: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.schema })), function_call: 'auto',
    };
}

let giga_seq = 0;

// Запрос к модели → { blocks: [{type:'text'|'tool_use',…}], stop }.
export async function callModel(cfg, transport, system, messages, tools) {
    const base = String(cfg.base || '').replace(/\/+$/, '');
    const spec = PROVIDERS[cfg.provider] || {};
    const protocol = cfg.protocol || spec.protocol || (cfg.provider === 'anthropic' ? 'anthropic' : 'openai');
    const auth = cfg.auth || spec.auth || (protocol === 'anthropic' ? 'x-api-key' : 'bearer');
    let url, headers, body;
    if (protocol === 'gigachat') {
        url = base + '/chat/completions';
        headers = { 'content-type': 'application/json', authorization: 'Bearer ' + await gigachatToken(cfg, transport) };
        body = gigachatBody(cfg, system, messages, tools);
    } else if (protocol === 'anthropic') {
        url = base + '/v1/messages';
        headers = { 'content-type': 'application/json', 'x-api-key': cfg.key || '', 'anthropic-version': '2023-06-01' };
        body = anthropicBody(cfg, system, messages, tools);
    } else {
        url = base + '/chat/completions';
        headers = { 'content-type': 'application/json' };
        if (cfg.key) headers.authorization = auth === 'api-key' && !/^Bearer\s/i.test(cfg.key) ? 'Api-Key ' + cfg.key : (/^Bearer\s/i.test(cfg.key) ? cfg.key : 'Bearer ' + cfg.key);
        if (cfg.folder) headers['x-folder-id'] = cfg.folder;
        // Шлюзы с маршрутизацией по сессии (OpenCode Go): один id на всю беседу.
        if (spec.sessionHeader) headers[spec.sessionHeader] = cfg._session || (cfg._session = uuid4());
        body = openaiBody(cfg, system, messages, tools);
    }
    const res = await transport(url, { headers, body: JSON.stringify(body), timeout: cfg.timeout || 120000 });
    const data = res.json;
    if (!res.ok || !data) {
        const detail = data && (data.error && (data.error.message || data.error)) || res.text || ('HTTP ' + res.status);
        throw new Error('модель вернула ошибку: ' + String(detail).slice(0, 300));
    }
    if (protocol === 'gigachat') {
        const m = data.choices && data.choices[0] && data.choices[0].message || {};
        const blocks = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        if (m.function_call && m.function_call.name) {
            let input = m.function_call.arguments;
            if (typeof input === 'string') { try { input = JSON.parse(input); } catch (_) { input = { _raw: input }; } }
            blocks.push({ type: 'tool_use', id: 'gc_' + (++giga_seq), name: m.function_call.name, input: input || {} });
        }
        return { blocks, stop: data.choices && data.choices[0] && data.choices[0].finish_reason };
    }
    if (protocol === 'anthropic') {
        return { blocks: (data.content || []).filter((b) => b.type === 'text' || b.type === 'tool_use'), stop: data.stop_reason };
    }
    const msg = data.choices && data.choices[0] && data.choices[0].message || {};
    const blocks = [];
    if (msg.content) blocks.push({ type: 'text', text: msg.content });
    for (const c of msg.tool_calls || []) {
        let input = {};
        try { input = JSON.parse(c.function.arguments || '{}'); } catch (_) { input = { _raw: c.function.arguments }; }
        blocks.push({ type: 'tool_use', id: c.id, name: c.function.name, input });
    }
    return { blocks, stop: data.choices && data.choices[0] && data.choices[0].finish_reason };
}

// Старые результаты инструментов (кроме последних keep) заменяются кратким следом:
// длинные чтения файлов не оплачиваются токенами на каждом следующем шаге.
export function compact(messages, keep) {
    const slots = [];
    for (const m of messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_result') slots.push(b);
    for (const b of slots.slice(0, Math.max(0, slots.length - keep))) {
        if (!b._compact && String(b.content).length > 300) {
            b.content = String(b.content).slice(0, 200) + '\n… [результат свёрнут, ' + String(b.content).length + ' симв.; перечитайте при необходимости]';
            b._compact = true;
        }
    }
}

// events: { text(t), tool(name,input), result(name,out), error(msg) } — все необязательные.
// Куски документации по вопросу → текст для подкладывания к сообщению (экономит
// ходы docs_search). Источник — `r2d docs context` (BM25); сюда же встанет
// поиск по эмбеддингам, когда появится модель: контракт — async (text) → [{path,line,text}].
export async function docContext(host, question, limit) {
    const res = await host.tool(['docs', 'context', String(question), '--limit', String(limit || 4)]);
    const chunks = res && res.json && res.json.ok ? res.json.chunks : [];
    return chunks.map((c) => '[' + (c.kind === 'snippet' ? 'кирпичик → snippet_apply ' : c.kind === 'api' ? 'api ' : '') + c.path + ':' + c.line + ']\n' + String(c.text).slice(0, 900)).join('\n---\n');
}

export function createAgent({ config, transport, tools, system, confirm, events, context }) {
    const ev = events || {};
    const byName = new Map(tools.map((t) => [t.name, t]));
    const state = { messages: [], running: false, stop: false };

    async function runTool(block) {
        const tool = byName.get(block.name);
        if (!tool) return { text: 'нет такого инструмента: ' + block.name, error: true };
        const mut = typeof tool.mutating === 'function' ? tool.mutating(block.input || {}) : tool.mutating;
        if (mut && confirm && !(await confirm(tool.name, block.input))) {
            return { text: 'пользователь отклонил действие', error: true };
        }
        try {
            const out = await tool.run(block.input || {});
            return { text: String(out === undefined ? '' : out).slice(0, config.maxToolOutput || 12000), error: false };
        } catch (e) {
            return { text: 'ошибка инструмента: ' + (e && e.message || e), error: true };
        }
    }

    async function send(userText) {
        if (state.running) throw new Error('агент уже работает');
        state.running = true; state.stop = false;
        let content = String(userText);
        if (context) {
            let ctx = '';
            try { ctx = await context(content); } catch (_) { ctx = ''; }
            if (ctx) content = 'Возможно относящееся к вопросу (из документации движка; если мало — docs_search):\n' + ctx + '\n\nВопрос: ' + content;
        }
        state.messages.push({ role: 'user', content });
        const limit = config.maxSteps || 12;
        let idle = 0;
        try {
            for (let step = 0; step < limit; step++) {
                if (state.stop) { if (ev.error) ev.error('остановлено'); return; }
                compact(state.messages, config.keepResults || 6);
                const reply = await callModel(config, transport, system || SYSTEM_PROMPT, state.messages, tools);
                if (!reply.blocks.length) { if (ev.error) ev.error('модель вернула пустой ответ'); return; }
                state.messages.push({ role: 'assistant', content: reply.blocks });
                for (const b of reply.blocks) if (b.type === 'text' && ev.text) ev.text(b.text);
                const calls = reply.blocks.filter((b) => b.type === 'tool_use');
                if (!calls.length) return;
                const results = [];
                let acted = false;
                for (const call of calls) {
                    if (ev.tool) ev.tool(call.name, call.input);
                    const r = await runTool(call);
                    if (ev.result) ev.result(call.name, r.text);
                    const t = byName.get(call.name);
                    if (t && !r.error && (typeof t.mutating === 'function' ? t.mutating(call.input || {}) : t.mutating)) acted = true;
                    results.push({ type: 'tool_result', tool_use_id: call.id, content: r.text, is_error: r.error });
                }
                // Слабые модели застревают в разведке: после нескольких шагов без единой правки подталкиваем к действию.
                idle = acted ? 0 : idle + 1;
                if (idle >= (config.nudgeAfter || 4) && idle % (config.nudgeAfter || 4) === 0) {
                    results.push({ type: 'text', text: 'Хватит исследовать: ты уже ' + idle + ' шагов ничего не меняешь. Действуй сейчас: найди кирпичик (snippet_find) или напиши код (write_file/edit_file), затем r2d_validate. Не вызывай больше docs_search/api_lookup подряд.' });
                }
                state.messages.push({ role: 'user', content: results });
            }
            if (ev.error) ev.error('достигнут лимит шагов (' + limit + ')');
        } finally { state.running = false; }
    }

    return { state, send, stop() { state.stop = true; }, reset() { state.messages.length = 0; } };
}

// Вкладки и студии. Единый контракт для ВСЕХ студий Editor:
//   * studio_ops    — какие операции у студии есть (имена и параметры);
//   * studio_state  — состояние и данные документа (для Hammer — карта);
//   * studio_edit   — правка документа JSON-патчем (merge patch) через историю студии;
//   * studio_op     — именованная операция студии или world-edit для Hammer;
//   * studio_save   — сохранение.
// Hammer (.re2dmap) принимает операции native `world-edit` через сессию карты —
// с общей историей Undo, диагностикой и перерисовкой.
const WORLD_OPS = [
    'brush.create {rect:[x,y,w,h]|polygon:[[x,y],…], bottom, top, id?, tool?, tags?}',
    'brush.set / brush.move / brush.delete / brush.duplicate / brush.clip / brush.vertex.move {id,…}',
    'face.set {brush, face:"side|floor|ceiling", material?, color?, tags?}',
    'entity.create {kind:"light|…", x, y, h?, id?, angle?, tags?} / entity.set / entity.delete {id}',
    'element.create {section:"cells|walls|portals|stairs|slopes|lights", value:{id, rect:[x,y,w,h], spans:[{bottom,top}], …}} / element.replace / element.move / element.delete',
    'world.set {patch:{w,h,regionSize,boundary,floorColor,…}} / visgroup.ensure / visgroup.state',
];
// Операции, которые агенту звать нельзя: внутренние хуки и ручки, принимающие функции.
const OP_BLOCK = new Set(['model', 'M', 'edit', 'browse', 'runExtensionCommand', 'open', 'close']);

// Имена параметров функции по её тексту: (a, b) => … / function f(a, {b}) {…}.
export function paramNames(fn) {
    const src = Function.prototype.toString.call(fn);
    const m = /^(?:async\s*)?(?:function\*?\s*[\w$]*\s*)?\(([^)]*)\)/.exec(src) || /^(?:async\s*)?([\w$]+)\s*=>/.exec(src) || /^[\w$]+\s*\(([^)]*)\)/.exec(src);
    if (!m) return [];
    return m[1].split(',').map((x) => x.trim().replace(/\s*=.*$/, '').replace(/^\.\.\./, '')).filter(Boolean);
}

export function listOps(api) {
    const out = [];
    const ops = api && api.ops;
    if (api && typeof api.capabilities === 'function') {
        try { for (const o of api.capabilities().operations || []) out.push({ name: o.name, args: o.args }); } catch (_) { /* без схемы */ }
    }
    if (ops && typeof ops === 'object') {
        const known = new Set(out.map((o) => o.name));
        for (const name of Object.keys(ops)) {
            if (OP_BLOCK.has(name) || typeof ops[name] !== 'function' || known.has(name)) continue;
            out.push({ name, params: paramNames(ops[name]) });
        }
    }
    return out;
}

// Аргументы вызова: массив — позиционно; объект — по именам параметров (или одним объектом).
export function bindArgs(fn, args) {
    if (Array.isArray(args)) return args;
    if (args === undefined || args === null) return [];
    if (typeof args !== 'object') return [args];
    const names = paramNames(fn);
    if (names.length <= 1 || names.some((n) => n.startsWith('{') || n.startsWith('['))) return [args];
    const hit = names.some((n) => Object.prototype.hasOwnProperty.call(args, n));
    return hit ? names.map((n) => args[n]) : [args];
}

// JSON merge patch (RFC 7386); массивы заменяются целиком, null удаляет ключ.
export function mergePatch(target, patch) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
    const base = target !== null && typeof target === 'object' && !Array.isArray(target) ? target : {};
    for (const key of Object.keys(patch)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        if (patch[key] === null) delete base[key];
        else base[key] = mergePatch(base[key], patch[key]);
    }
    return base;
}

const EDITOR_OPS = {
    new_project: 'создать проект из шаблона и открыть: {template:"blank", dir:"абсолютный путь", name}',
    open_project: 'открыть проект: {dir}',
    run: 'запустить игру в окне Editor', stop: 'остановить игру',
    validate: 'r2d validate проекта', build: 'собрать пакет игры: {outDir}', reindex: 'пересчитать граф проекта',
    create_script: 'создать пустой game.js', create_tilemap: 'создать level.tilemap.json', create_narrative: 'создать сюжетную сцену',
};

export function studioTools(host) {
    const str = (description) => ({ type: 'string', description });
    const obj = (props, required) => ({ type: 'object', properties: props, required: required === undefined ? Object.keys(props) : required });
    const need = (path) => {
        const api = host.studioApi(path ? safeRel(path) : '');
        if (!api) throw new Error(path ? 'вкладка «' + path + '» не открыта как студия (open_tab)' : 'активная вкладка — не студия');
        return api;
    };
    const docData = (api) => (api.map !== undefined ? api.map : api.state && api.state.data !== undefined ? api.state.data : null);
    const tools = [
        { name: 'tabs', description: 'Открытые вкладки Editor: путь, студия (code, hammer, atlas, tilemap, narrative, particles, audio…), несохранённые правки, активная.', schema: obj({}),
          run: async () => JSON.stringify(host.tabs()) },
        { name: 'open_tab', description: 'Открыть файл проекта во вкладке (карта .re2dmap → Hammer, атлас → Atlas, *.tilemap.json → Tilemap и т.д.) и сделать активной.',
          schema: obj({ path: str('относительный путь') }),
          run: async (a) => { await host.openTab(safeRel(a.path)); return JSON.stringify(host.tabs().filter((t) => t.active)); } },
        { name: 'studio_ops', description: 'Операции студии вкладки: имена и параметры. Вызывай перед первым studio_op в новой студии.',
          schema: obj({ path: str('путь вкладки; пусто — активная') }, []),
          run: async (a) => {
              const api = need(a.path);
              return JSON.stringify({ studio: api.id, ops: listOps(api), edit: !!(api.ops && typeof api.ops.edit === 'function'),
                  worldOps: api.session && api.session.apply ? WORLD_OPS : undefined });
          } },
        { name: 'studio_state', description: 'Состояние и данные документа студии: выделение, диагностика, для Hammer — карта, для остальных — JSON документа. section — один верхнеуровневый ключ целиком (лимит ~12000 символов), иначе общий обзор (~6000).',
          schema: obj({ path: str('путь вкладки; пусто — активная'), section: str('ключ данных целиком') }, []),
          run: async (a) => {
              const api = need(a.path);
              const data = docData(api);
              if (a.section) {
                  if (data === null || typeof data !== 'object' || !(a.section in data)) throw new Error('нет раздела «' + a.section + '»; есть: ' + (data ? Object.keys(data).join(', ') : '—'));
                  return JSON.stringify(data[a.section]).slice(0, 12000);
              }
              const out = { studio: api.id, snapshot: typeof api.snapshot === 'function' ? api.snapshot() : null };
              if (api.diagnostics) { try { out.diagnostics = api.diagnostics().slice(0, 12); } catch (_) { /* нет диагностики */ } }
              if (data !== null) out.data = data;
              return JSON.stringify(out).slice(0, 6000);
          } },
        { name: 'studio_edit', mutating: true,
          description: 'Правка документа студии JSON-патчем (RFC 7386: объекты сливаются, массивы заменяются целиком, null удаляет ключ) через историю студии — работает в студиях ассетов (tilemap, particles, audio, collision, parallax, fonts, input…). Требует подтверждения.',
          schema: obj({ patch: { type: 'object', description: 'merge patch' }, path: str('путь вкладки; пусто — активная'), label: str('подпись шага в истории') }, ['patch']),
          run: async (a) => {
              const api = need(a.path);
              if (!api.ops || typeof api.ops.edit !== 'function') throw new Error('студия ' + api.id + ' не принимает патчи — используйте studio_op (см. studio_ops) или edit_file');
              const ok = api.ops.edit(String(a.label || 'Агент'), (m) => { mergePatch(m, a.patch); return true; });
              if (ok === false) throw new Error('студия отклонила правку (проверьте studio_state → diagnostics)');
              return 'правка применена';
          } },
        { name: 'studio_op', mutating: true,
          description: 'Операция студии (список — studio_ops; требует подтверждения). Именованные: args — объект по именам параметров или массив позиционных. Hammer: ещё операции world-edit с точкой в имени (args — объект): ' +
              WORLD_OPS.join('; ') + '. Координаты — единицы карты, сетка обычно 16. После серии правок вызови validate.',
          schema: obj({ op: str('имя операции'), args: { type: ['object', 'array'], description: 'аргументы' }, path: str('путь вкладки; пусто — активная') }, ['op']),
          run: async (a) => {
              const api = need(a.path);
              const op = String(a.op);
              let result;
              if (op.includes('.')) {
                  if (!api.session || typeof api.session.apply !== 'function') throw new Error('эта студия не принимает операции world-edit: ' + op);
                  result = await api.session.apply(op, a.args && !Array.isArray(a.args) ? a.args : {});
              } else {
                  const names = listOps(api).map((o) => o.name);
                  if (!names.includes(op) || !api.ops || typeof api.ops[op] !== 'function') throw new Error('неизвестная операция «' + op + '», доступны: ' + names.join(', '));
                  result = await api.ops[op](...bindArgs(api.ops[op], a.args));
              }
              if (api.render) api.render();
              return JSON.stringify(result === undefined ? { ok: true } : result).slice(0, 3000);
          } },
        { name: 'studio_save', mutating: true, description: 'Сохранить документ студии на диск (требует подтверждения).',
          schema: obj({ path: str('путь вкладки; пусто — активная') }, []),
          run: async (a) => { const r = await need(a.path).save(); return JSON.stringify(r === undefined ? { ok: true } : r).slice(0, 1500); } },
    ];
    if (host.editorOp) {
        tools.push({ name: 'editor_op', mutating: true,
            description: 'Операции самого Editor (требует подтверждения): ' + Object.keys(EDITOR_OPS).map((k) => k + ' — ' + EDITOR_OPS[k]).join('; ') +
                '. Игру целиком начинай с new_project (шаблон blank), дальше — файлы, студии, validate, run_check.',
            schema: obj({ op: { type: 'string', enum: Object.keys(EDITOR_OPS) }, args: { type: 'object', description: 'аргументы операции' } }, ['op']),
            run: async (a) => {
                if (!EDITOR_OPS[a.op]) throw new Error('неизвестная операция Editor «' + a.op + '»: ' + Object.keys(EDITOR_OPS).join(', '));
                return String(await host.editorOp(a.op, a.args || {}));
            } });
    }
    return tools;
}


// Кирпичики (snippets): 500 готовых поведений. Агент берёт их вместо кода с нуля —
// быстрее и в разы меньше токенов. Оба инструмента — тонкие обёртки над `r2d snippet`.
export function fieldLine(f) {
    let t = f.type || 'any';
    if (f.type === 'enum' && Array.isArray(f.options)) t = f.options.join('|');
    const range = f.min !== undefined || f.max !== undefined ? '[' + (f.min !== undefined ? f.min : '') + '..' + (f.max !== undefined ? f.max : '') + ']' : '';
    const def = f.default !== undefined ? '=' + JSON.stringify(f.default) : '';
    return f.id + ':' + t + def + range + (f.required ? '!' : '');
}

export function snippetLine(pkg) {
    const deps = (pkg.dependencies || []).map((d) => d.id).filter(Boolean);
    const fields = (pkg.fields || []).map(fieldLine).join(', ');
    const target = (pkg.targets || []).join('/');
    return pkg.id + ' — ' + pkg.title + (pkg.description ? ': ' + String(pkg.description).slice(0, 140) : '') +
        (target ? ' [' + target + ']' : '') + (deps.length ? ' +зависит: ' + deps.join(', ') : '') + (fields ? '\n    поля: ' + fields : '');
}

export function snippetTools(host) {
    const str = (description) => ({ type: 'string', description });
    return [
        { name: 'snippet_find', description: 'Найти готовые кирпичики (поведения: движение, AI, способности, UI, камера…) по слову из названия, описания или тега (по-русски или по-английски: «прыж», «platformer», «ai.chase»). Показывает поля настройки. ПРЕЖДЕ чем писать поведение кодом — ищи здесь.',
          schema: { type: 'object', properties: { query: str('слово/часть id'), limit: { type: 'number', description: 'сколько вернуть, по умолчанию 6' } }, required: ['query'] },
          run: async (a) => {
              const limit = Math.min(15, Math.max(1, Number(a.limit) || 6));
              const r = (await host.tool(['snippet', 'catalog', '--project', host.abs(''), '--query', String(a.query), '--fields'])).json;
              if (!r || !r.ok) return JSON.stringify(r);
              const pk = (r.packages || []).filter((x) => x.valid !== false);
              if (!pk.length) return 'ничего не найдено по «' + a.query + '» (всего кирпичиков: ' + r.total + '). Попробуйте другое слово, часть id (movement, ai, ability, ui) или тег.';
              return pk.slice(0, limit).map(snippetLine).join('\n') + (pk.length > limit ? '\n… ещё ' + (pk.length - limit) + ' — уточните запрос' : '');
          } },
        { name: 'snippet_apply', mutating: true,
          description: 'Подключить кирпичик к объекту и сгенерировать код (требует подтверждения): граф проекта обновляется, зависимости добавляются сами, значения полей задаются values. Объект должен быть создан в коде с `id` (например `$("<sprite>", { id: "hero" })`); owner = "object:hero" или "project".',
          schema: { type: 'object', properties: { owner: str('object:<id> или project'), package: str('id кирпичика, например movement.platformer'),
              values: { type: 'object', description: 'значения полей, например {"speed":300}' }, links: { type: 'object', description: 'ссылки, например {"target":"object:boss"}' } }, required: ['owner', 'package'] },
          run: async (a) => {
              const proj = host.abs(''), owner = String(a.owner), pkg = String(a.package);
              const run = async (args) => (await host.tool(args)).json || {};
              const brief = (r) => (r.diagnostics || []).filter((d) => d.severity !== 'info').slice(0, 6).map((d) => d.code + ': ' + d.message);
              await run(['project-index', proj, '--write']);
              const add = await run(['snippet', 'add', proj, pkg, '--owner', owner]);
              if (!add.ok && !(add.diagnostics || []).some((d) => d.code === 'SNIP145' || /уже/.test(d.message || ''))) return 'не добавлено:\n' + brief(add).join('\n');
              const ownerName = owner.replace(/^object:/, '').replace(/^project$/, 'project');
              const inst = ((add.added || []).find((id) => id.endsWith(':' + pkg))) || 'snippet:' + ownerName + ':' + pkg;
              const pairs = [];
              for (const [k, v] of Object.entries(a.values || {})) pairs.push(k + '=' + JSON.stringify(v));
              for (const [k, v] of Object.entries(a.links || {})) pairs.push('links.' + k + '=' + JSON.stringify(v));
              if (pairs.length) {
                  const set = await run(['snippet', 'set', proj, inst, ...pairs]);
                  if (!set.ok) return 'экземпляр добавлен (' + inst + '), но значения не применены:\n' + brief(set).join('\n');
              }
              const gen = await run(['snippet', 'generate', proj, '--write']);
              if (!gen.ok) return 'экземпляр ' + inst + ' добавлен, генерация не удалась:\n' + brief(gen).join('\n');
              return 'готово: ' + ((add.added || [inst]).join(', ')) + '; файлов сгенерировано: ' + (gen.files || []).length + (brief(gen).length ? '\n' + brief(gen).join('\n') : '');
          } },
    ];
}

// Команды r2d, не меняющие файлы: их агент вызывает без подтверждения.
const CLI_READONLY = new Set(['version', 'commands', 'help', 'tools', 'assets', 'project', 'projects', 'validate', 'lint', 'docs', 'api', 'doctor',
    'atlas-info', 'world-info', 'deps', 'story', 'dialog', 'templates', 'engines', 'extension', 'snippet']);
const CLI_WRITE_FLAGS = new Set(['--write', '--record', '--out', '--out-dir']);

// Безопасный путь внутри проекта: без абсолютных, `..` и скрытых служебных каталогов.
export function safeRel(p) {
    const s = String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!s || s[0] === '/' || /^[A-Za-z]:/.test(s)) throw new Error('путь должен быть относительным: ' + p);
    for (const part of s.split('/')) if (part === '..' || part === '.git') throw new Error('недопустимый путь: ' + p);
    return s;
}

// Набор инструментов Editor. host: { tool(args)→{json,output}, readText, writeText, exists, list() }.
export function editorTools(host) {
    const str = (description) => ({ type: 'string', description });
    // lint после записи .js: диагностика сразу в результате — экономит отдельный шаг.
    const autoLint = async (p) => {
        if (!/\.m?js$/.test(p) || !host.abs) return '';
        try {
            const r = (await host.tool(['lint', host.abs(p), '--json'])).json;
            const d = (r && (r.diagnostics || r.problems)) || [];
            // Граф проекта (editor.graph) держим свежим: иначе validate шумит R2D206, а кирпичики не видят объекты.
            try { await host.tool(['project-index', host.abs(''), '--write']); } catch (_) { /* индекс необязателен */ }
            return d.length ? '\nlint: ' + d.length + ' замечаний:\n' + JSON.stringify(d.slice(0, 8)) : '\nlint: чисто';
        } catch (e) { return '\nlint: не запустился (' + (e && e.message || e) + ')'; }
    };
    const obj = (props, required) => ({ type: 'object', properties: props, required: required || Object.keys(props) });
    return [
        { name: 'docs_search', description: 'Поиск по встроенной документации движка (строки, содержащие запрос).',
          schema: obj({ query: str('слово или фраза') }),
          run: async (a) => JSON.stringify((await host.tool(['docs', 'search', String(a.query), '--limit', '15'])).json) },
        { name: 'docs_show', description: 'Текст страницы документации, например highlevel/ui.',
          schema: obj({ page: str('имя страницы') }),
          run: async (a) => { const r = await host.tool(['docs', 'show', String(a.page)]); return r.json && r.json.ok ? r.json.text : JSON.stringify(r.json); } },
        { name: 'list_files', description: 'Файлы проекта (относительные пути).', schema: obj({}),
          run: async () => host.list().join('\n') },
        { name: 'read_file', description: 'Прочитать файл проекта.', schema: obj({ path: str('относительный путь') }),
          run: async (a) => { const p = safeRel(a.path); if (!host.exists(p)) throw new Error('нет файла ' + p); return host.readText(p); } },
        { name: 'write_file', description: 'Создать файл или полностью заменить (требует подтверждения). Для правок существующих файлов используй edit_file. После записи .js автоматически запускается lint.', mutating: true,
          schema: obj({ path: str('относительный путь'), content: str('полное содержимое') }),
          run: async (a) => { const p = safeRel(a.path); host.writeText(p, String(a.content)); return 'записано ' + p + await autoLint(p); } },
        { name: 'edit_file', description: 'Заменить фрагмент в файле (требует подтверждения): old_string должен встретиться ровно один раз. Дёшево по токенам. После правки .js запускается lint.', mutating: true,
          schema: obj({ path: str('относительный путь'), old_string: str('точный фрагмент'), new_string: str('замена') }),
          run: async (a) => {
              const p = safeRel(a.path);
              if (!host.exists(p)) throw new Error('нет файла ' + p);
              const text = host.readText(p), old = String(a.old_string);
              if (!old) throw new Error('old_string пуст');
              const first = text.indexOf(old);
              if (first < 0) throw new Error('old_string не найден в ' + p + ' (перечитайте файл)');
              if (text.indexOf(old, first + 1) >= 0) throw new Error('old_string встречается несколько раз — добавьте контекст');
              host.writeText(p, text.slice(0, first) + String(a.new_string) + text.slice(first + old.length));
              return 'изменено ' + p + await autoLint(p);
          } },
        { name: 'api_lookup', description: 'Проверить имя `$`-API по схеме движка: есть ли метод и какие у него аргументы (точное имя, префикс или часть, например `$.scene.add` или `tween`).',
          schema: obj({ name: str('путь или его часть') }),
          run: async (a) => {
              const r = (await host.tool(['docs', 'api', String(a.name), '--limit', '8'])).json;
              if (!r || !r.ok) return JSON.stringify(r);
              if (!r.count) return 'в схеме нет «' + a.name + '». Такого `$`-API не существует — не используй; поищи docs_search.';
              return (r.exact ? '' : 'точного совпадения нет, похожие:\n') + r.entries.map((e) =>
                  e.path + ' [' + e.kind + ']' + (e.args ? '(' + e.args.join(', ') + ')' : '') + ' — ' + String(e.description).slice(0, 200)).join('\n');
          } },
        { name: 'project_info', description: 'Сведения о проекте: project.json, точка входа, сцены.', schema: obj({}),
          run: async () => JSON.stringify((await host.tool(['project', host.abs('')])).json).slice(0, 4000) },
        { name: 'run_check', description: 'Короткий headless-прогон игры (N кадров): вернёт ошибки скриптов из вывода. Запускай после изменения игровой логики.',
          schema: { type: 'object', properties: { frames: { type: 'number', description: 'кадров, по умолчанию 120' }, scene: str('сцена (необязательно)') }, required: [] },
          run: async (a) => {
              const args = ['run', host.abs(''), '--headless', '--frames', String(Math.min(600, Math.max(5, Number(a.frames) || 120)))];
              if (a.scene) args.push('--scene', String(a.scene));
              const r = await host.tool(args);
              const text = String(r.output || r.error || (r.json ? JSON.stringify(r.json) : ''));
              const bad = text.split('\n').filter((l) => /error|ошибк|exception|TypeError|ReferenceError|не найден/i.test(l));
              return bad.length ? 'ОШИБКИ:\n' + bad.slice(0, 12).join('\n') : 'прогон без ошибок (' + (args[4]) + ' кадров)';
          } },
        { name: 'r2d_cli', description: 'Любая команда r2d (список: `commands`) — тот же backend, что у Editor: snippet, atlas-grid, world-compile, story, project-set, templates, deps… args — массив слов без «r2d». Чтение выполняется сразу, команды с записью требуют подтверждения.',
          mutating: (i) => { const w = Array.isArray(i.args) ? i.args.map(String) : []; return !(CLI_READONLY.has(w[0]) && !w.some((x) => CLI_WRITE_FLAGS.has(x)) && !(w[0] === 'snippet' && !['catalog', 'validate', 'check'].includes(w[1]))); },
          schema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' }, description: 'например ["snippet","catalog"]' } }, required: ['args'] },
          run: async (a) => {
              if (!Array.isArray(a.args) || !a.args.length) throw new Error('args — непустой массив строк');
              const w = a.args.map(String);
              if (w[0] === 'snippet' && w[1] === 'catalog' && !w.includes('--query') && !w.includes('--id')) return 'Каталог целиком — 500 кирпичиков, слишком много. Используй snippet_find с одним словом (например «прыж», «ai», «ability»).';
              if (w[0] === 'docs' && w[1] === 'list' && !w.includes('--filter')) return 'Список всех страниц слишком длинный. Используй docs_search/api_lookup или `docs list --filter слово`.';
              const r = await host.tool(a.args.map(String));
              return String(r.output || (r.json ? JSON.stringify(r.json) : r.error || '')).slice(0, 8000);
          } },
        { name: 'r2d_lint', description: 'r2d lint по файлу .js проекта; вернёт диагностики.',
          schema: obj({ path: str('относительный путь .js') }),
          run: async (a) => JSON.stringify((await host.tool(['lint', host.abs(safeRel(a.path)), '--json'])).json) },
        { name: 'r2d_validate', description: 'r2d validate по проекту; вернёт диагностики.', schema: obj({}),
          run: async () => JSON.stringify((await host.tool(['validate', host.abs('')])).json) },
    ];
}
