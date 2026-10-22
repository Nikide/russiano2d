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
    // GigaChat/GigaCode (Сбер): «Authorization key» из кабинета обменивается на токен (30 мин).
    gigachat: {
        label: 'GigaChat', protocol: 'gigachat', auth: 'oauth', base: 'https://gigachat.devices.sberbank.ru/api/v1', model: 'GigaChat-2',
        oauthUrl: 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth', scope: 'GIGACHAT_API_PERS',
    },
};

export const SYSTEM_PROMPT = [
    'Ты — агент внутри Editor движка Russiano2D (2D/2.5D, один бинарник r2d, игровой API — `$`).',
    'Сначала ищи в документации (docs_search / docs_show) и проверяй имена `$`-API, потом пиши код.',
    'Не выдумывай методы `$`: сомневаешься — docs_search.',
    'После правки .js запускай r2d_lint, после правки проекта — r2d_validate, исправляй диагностику.',
    'Пути — относительно корня проекта. Отвечай по-русски, коротко.',
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

// events: { text(t), tool(name,input), result(name,out), error(msg) } — все необязательные.
// Куски документации по вопросу → текст для подкладывания к сообщению (экономит
// ходы docs_search). Источник — `r2d docs context` (BM25); сюда же встанет
// поиск по эмбеддингам, когда появится модель: контракт — async (text) → [{path,line,text}].
export async function docContext(host, question, limit) {
    const res = await host.tool(['docs', 'context', String(question), '--limit', String(limit || 4)]);
    const chunks = res && res.json && res.json.ok ? res.json.chunks : [];
    return chunks.map((c) => '[' + c.path + ':' + c.line + ']\n' + String(c.text).slice(0, 900)).join('\n---\n');
}

export function createAgent({ config, transport, tools, system, confirm, events, context }) {
    const ev = events || {};
    const byName = new Map(tools.map((t) => [t.name, t]));
    const state = { messages: [], running: false, stop: false };

    async function runTool(block) {
        const tool = byName.get(block.name);
        if (!tool) return { text: 'нет такого инструмента: ' + block.name, error: true };
        if (tool.mutating && confirm && !(await confirm(tool.name, block.input))) {
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
        try {
            for (let step = 0; step < limit; step++) {
                if (state.stop) { if (ev.error) ev.error('остановлено'); return; }
                const reply = await callModel(config, transport, system || SYSTEM_PROMPT, state.messages, tools);
                if (!reply.blocks.length) { if (ev.error) ev.error('модель вернула пустой ответ'); return; }
                state.messages.push({ role: 'assistant', content: reply.blocks });
                for (const b of reply.blocks) if (b.type === 'text' && ev.text) ev.text(b.text);
                const calls = reply.blocks.filter((b) => b.type === 'tool_use');
                if (!calls.length) return;
                const results = [];
                for (const call of calls) {
                    if (ev.tool) ev.tool(call.name, call.input);
                    const r = await runTool(call);
                    if (ev.result) ev.result(call.name, r.text);
                    results.push({ type: 'tool_result', tool_use_id: call.id, content: r.text, is_error: r.error });
                }
                state.messages.push({ role: 'user', content: results });
            }
            if (ev.error) ev.error('достигнут лимит шагов (' + limit + ')');
        } finally { state.running = false; }
    }

    return { state, send, stop() { state.stop = true; }, reset() { state.messages.length = 0; } };
}

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
        { name: 'write_file', description: 'Создать или перезаписать файл проекта (требует подтверждения).', mutating: true,
          schema: obj({ path: str('относительный путь'), content: str('полное содержимое') }),
          run: async (a) => { const p = safeRel(a.path); host.writeText(p, String(a.content)); return 'записано ' + p; } },
        { name: 'r2d_lint', description: 'r2d lint по файлу .js проекта; вернёт диагностики.',
          schema: obj({ path: str('относительный путь .js') }),
          run: async (a) => JSON.stringify((await host.tool(['lint', host.abs(safeRel(a.path)), '--json'])).json) },
        { name: 'r2d_validate', description: 'r2d validate по проекту; вернёт диагностики.', schema: obj({}),
          run: async () => JSON.stringify((await host.tool(['validate', host.abs('')])).json) },
    ];
}
