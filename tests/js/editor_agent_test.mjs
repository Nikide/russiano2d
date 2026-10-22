// Юнит-тесты мини-харнеса агента Editor (editor/lib/agent_harness.js): без сети.
import { test, eq as strictEq, truthy, finish } from './_harness.mjs';
const eq = (a, b, m) => strictEq(JSON.stringify(a), JSON.stringify(b), m);
// Харнесс синхронный: async-тело ждём здесь, итог отдаём ему.
async function atest(name, fn) {
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    test(name, () => { if (err) throw err; });
}
import { createAgent, callModel, safeRel, editorTools, docContext, gigachatToken, PROVIDERS } from '../../editor/lib/agent_harness.js';

const scripted = (replies, seen) => async (url, opts) => {
    seen.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: replies.shift() };
};
const anth = (...content) => ({ content, stop_reason: 'end_turn' });
const toolsOf = (log, over) => [
    { name: 'echo', description: 'e', schema: { type: 'object', properties: {} }, run: async (a) => { log.push(a); return 'эхо:' + a.x; } },
    { name: 'wr', description: 'w', mutating: true, schema: { type: 'object', properties: {} }, run: async () => { log.push('WRITE'); return 'ok'; } },
    ...(over || []),
];

await atest('anthropic: цикл tool_use → tool_result → текст', async () => {
    const seen = [], log = [], texts = [];
    const agent = createAgent({
        config: { provider: 'anthropic', base: 'https://x', model: 'm', key: 'K' },
        transport: scripted([anth({ type: 'tool_use', id: 't1', name: 'echo', input: { x: 5 } }), anth({ type: 'text', text: 'готово' })], seen),
        tools: toolsOf(log), events: { text: (t) => texts.push(t) },
    });
    await agent.send('привет');
    eq(texts, ['готово']);
    eq(seen[0].url, 'https://x/v1/messages');
    eq(seen[0].headers['x-api-key'], 'K');
    const last = seen[1].body.messages.at(-1);
    eq(last.content[0].type, 'tool_result');
    eq(last.content[0].content, 'эхо:5');
});

await atest('openai: tool_calls переводятся и обратно', async () => {
    const seen = [], log = [];
    const reply1 = { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'echo', arguments: '{"x":7}' } }] }, finish_reason: 'tool_calls' }] };
    const reply2 = { choices: [{ message: { content: 'ок' }, finish_reason: 'stop' }] };
    const agent = createAgent({
        config: { provider: 'openai', base: 'http://h/v1', model: 'm' },
        transport: scripted([reply1, reply2], seen), tools: toolsOf(log),
    });
    await agent.send('?');
    eq(seen[0].url, 'http://h/v1/chat/completions');
    eq(seen[0].headers.authorization, undefined);
    const msgs = seen[1].body.messages;
    eq(msgs.at(-1).role, 'tool');
    eq(msgs.at(-1).content, 'эхо:7');
    eq(msgs.at(-2).tool_calls[0].function.arguments, '{"x":7}');
});

await atest('запись требует подтверждения; отказ не вызывает инструмент', async () => {
    const log = [];
    const call = () => anth({ type: 'tool_use', id: 'w', name: 'wr', input: {} });
    const agent = createAgent({
        config: { provider: 'anthropic', base: 'https://x', model: 'm' },
        transport: scripted([call(), anth({ type: 'text', text: 'ладно' })], []), tools: toolsOf(log),
        confirm: async () => false,
    });
    await agent.send('пиши');
    eq(log, []);
    const res = agent.state.messages.find((m) => Array.isArray(m.content) && m.content[0].type === 'tool_result');
    truthy(res.content[0].is_error);
});

await atest('лимит шагов и ошибка модели', async () => {
    const errs = [];
    const loop = () => anth({ type: 'tool_use', id: 'a', name: 'echo', input: {} });
    const agent = createAgent({
        config: { provider: 'anthropic', base: 'https://x', model: 'm', maxSteps: 2 },
        transport: scripted([loop(), loop(), loop()], []), tools: toolsOf([]), events: { error: (m) => errs.push(m) },
    });
    await agent.send('цикл');
    truthy(errs[0].includes('лимит'));
    let msg = '';
    try { await callModel({ provider: 'anthropic', base: 'https://x' }, async () => ({ ok: false, status: 401, json: { error: { message: 'bad key' } } }), 's', [], []); }
    catch (e) { msg = e.message; }
    truthy(msg.includes('bad key'));
});

test('safeRel отсекает выход из проекта', () => {
    eq(safeRel('./a/b.js'), 'a/b.js');
    for (const bad of ['/etc/passwd', '../x', 'a/../../x', '.git/config', 'C:\\x', '']) {
        let threw = false;
        try { safeRel(bad); } catch (_) { threw = true; }
        truthy(threw, bad);
    }
});

await atest('editorTools: write_file/read_file через host, mutating только у записи', async () => {
    const files = new Map();
    const tools = editorTools({
        tool: async () => ({ json: { ok: true, text: 'T' } }), abs: (p) => '/p/' + p,
        exists: (p) => files.has(p), readText: (p) => files.get(p), writeText: (p, c) => files.set(p, c), list: () => [...files.keys()],
    });
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    eq(await by.write_file.run({ path: 'a.js', content: 'x' }), 'записано a.js');
    eq(await by.read_file.run({ path: 'a.js' }), 'x');
    eq(await by.list_files.run({}), 'a.js');
    eq(await by.docs_show.run({ page: 'ui' }), 'T');
    eq(tools.filter((t) => t.mutating).map((t) => t.name), ['write_file']);
});

await atest('контекст из доков подкладывается к вопросу, сбой поиска не мешает', async () => {
    const seen = [];
    const host = { tool: async (args) => ({ json: { ok: true, chunks: [{ path: 'docs/a.md', line: 3, text: 'про спрайты' }] } }) };
    const mk = (context) => createAgent({
        config: { provider: 'anthropic', base: 'https://x', model: 'm' },
        transport: scripted([anth({ type: 'text', text: 'ок' })], seen), tools: toolsOf([]), context,
    });
    await mk((q) => docContext(host, q, 4)).send('как рисовать?');
    const first = seen[0].body.messages[0].content;
    truthy(first.includes('[docs/a.md:3]') && first.includes('Вопрос: как рисовать?'));
    await mk(async () => { throw new Error('нет'); }).send('голый вопрос');
    eq(seen[1].body.messages[0].content, 'голый вопрос');
});

await atest('YandexGPT: Api-Key или Bearer, OpenAI-формат', async () => {
    const seen = [];
    const ok = { choices: [{ message: { content: 'да' }, finish_reason: 'stop' }] };
    const run = async (key) => {
        const agent = createAgent({ config: { provider: 'yandex', base: PROVIDERS.yandex.base, model: 'gpt://f/yandexgpt/latest', key, folder: 'b1g' },
            transport: scripted([ok], seen), tools: toolsOf([]) });
        await agent.send('?');
    };
    await run('AQVN-key');
    await run('Bearer t1.iam');
    eq(seen[0].headers.authorization, 'Api-Key AQVN-key');
    eq(seen[0].headers['x-folder-id'], 'b1g');
    eq(seen[1].headers.authorization, 'Bearer t1.iam');
    eq(seen[0].url, 'https://llm.api.cloud.yandex.net/v1/chat/completions');
});

await atest('GigaChat: OAuth-токен кэшируется, functions и function-результат', async () => {
    const calls = [];
    const replies = [
        { access_token: 'TOK', expires_at: 9e15 },
        { choices: [{ message: { content: '', function_call: { name: 'echo', arguments: { x: 3 } } }, finish_reason: 'function_call' }] },
        { choices: [{ message: { content: 'готово' }, finish_reason: 'stop' }] },
    ];
    const transport = async (url, opts) => { calls.push({ url, headers: opts.headers, body: opts.body }); return { ok: true, status: 200, json: replies.shift() }; };
    const log = [], texts = [];
    const agent = createAgent({ config: { provider: 'gigachat', base: PROVIDERS.gigachat.base, model: 'GigaChat-2', key: 'Qkxh' },
        transport, tools: toolsOf(log), events: { text: (t) => texts.push(t) } });
    await agent.send('привет');
    eq(calls[0].url, PROVIDERS.gigachat.oauthUrl);
    eq(calls[0].headers.authorization, 'Basic Qkxh');
    truthy(/^[0-9a-f-]{36}$/.test(calls[0].headers.rquid));
    eq(calls[0].body, 'scope=GIGACHAT_API_PERS');
    eq(calls[1].headers.authorization, 'Bearer TOK');
    eq(JSON.parse(calls[1].body).functions[0].name, 'echo');
    eq(log, [{ x: 3 }]);
    const second = JSON.parse(calls[2].body).messages;
    eq(second.at(-1).role, 'function');
    eq(second.at(-1).name, 'echo');
    eq(JSON.parse(second.at(-1).content).result, 'эхо:3');
    eq(second.at(-2).function_call.arguments, { x: 3 });
    eq(calls.length, 3, 'токен получен один раз');
    eq(texts, ['готово']);
});

await atest('GigaChat: ошибка токена понятна, срок токена учитывается', async () => {
    let msg = '';
    try { await gigachatToken({ key: 'x' }, async () => ({ ok: false, status: 401, json: { message: 'bad creds' } })); } catch (e) { msg = e.message; }
    truthy(msg.includes('bad creds'));
    const cfg = { key: 'k', _token: { value: 'OLD', exp: 1000 } };
    eq(await gigachatToken(cfg, async () => ({ ok: true, json: { access_token: 'NEW', expires_at: 999999 } }), 5000), 'NEW');
});

finish();
