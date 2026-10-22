// Юнит-тесты мини-харнеса агента Editor (editor/lib/agent_harness.js): без сети.
import { test, eq as strictEq, truthy, finish } from './_harness.mjs';
const eq = (a, b, m) => strictEq(JSON.stringify(a), JSON.stringify(b), m);
// Харнесс синхронный: async-тело ждём здесь, итог отдаём ему.
async function atest(name, fn) {
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    test(name, () => { if (err) throw err; });
}
import { createModelStore, validCustomId } from '../../editor/lib/agent_models.js';
import { trimHistory, usageOf, numberLines, grepProject, undoEdits, interactTools } from '../../editor/lib/agent_harness.js';
import { createMascot, mascotFrames } from '../../editor/lib/agent_mascot.js';
import { testConnection, snippetTools, fieldLine, snippetLine, studioTools, listOps, bindArgs, mergePatch, paramNames, compact, createAgent, callModel, safeRel, editorTools, docContext, gigachatToken, gigachatSchema, PROVIDERS, SYSTEM_PROMPT, SYSTEM_PROMPT_COMPACT } from '../../editor/lib/agent_harness.js';

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

await atest('editorTools: write_file/read_file через host, mutating только у записи/правки', async () => {
    const files = new Map();
    const tools = editorTools({
        tool: async () => ({ json: { ok: true, text: 'T' } }), abs: (p) => '/p/' + p,
        exists: (p) => files.has(p), readText: (p) => files.get(p), writeText: (p, c) => files.set(p, c), list: () => [...files.keys()],
    });
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    eq(await by.write_file.run({ path: 'a.js', content: 'x' }), 'записано a.js\nlint: чисто');
    eq(await by.read_file.run({ path: 'a.js' }), 'x');
    eq(await by.list_files.run({}), 'a.js');
    eq(await by.docs_show.run({ page: 'ui' }), 'T');
    eq(tools.filter((t) => t.mutating === true).map((t) => t.name), ['write_file', 'edit_file', 'delete_file', 'move_file', 'undo_edit', 'pixel_art', 'generate_sound']);
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
    PROVIDERS.gigachat.toolSubset.push('echo');
    const agent = createAgent({ config: { provider: 'gigachat', base: PROVIDERS.gigachat.base, model: 'GigaChat-2', key: 'Qkxh' },
        transport, tools: toolsOf(log), events: { text: (t) => texts.push(t) } });
    await agent.send('привет');
    PROVIDERS.gigachat.toolSubset.pop();
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
    // набор функций для GigaChat сужен: всё в подмножестве существует среди инструментов Editor
    truthy(PROVIDERS.gigachat.toolSubset.includes('write_file') && !PROVIDERS.gigachat.toolSubset.includes('studio_op'));
});

await atest('GigaChat: ошибка токена понятна, срок токена учитывается', async () => {
    let msg = '';
    try { await gigachatToken({ key: 'x' }, async () => ({ ok: false, status: 401, json: { message: 'bad creds' } })); } catch (e) { msg = e.message; }
    truthy(msg.includes('bad creds'));
    const cfg = { key: 'k', _token: { value: 'OLD', exp: 1000 } };
    eq(await gigachatToken(cfg, async () => ({ ok: true, json: { access_token: 'NEW', expires_at: 999999 } }), 5000), 'NEW');
});

await atest('edit_file: точечная замена, неоднозначность и отсутствие фрагмента — ошибки; lint-замечания в ответе', async () => {
    const files = new Map([['a.js', 'let a = 1;\nlet b = 1;\n']]);
    const tools = editorTools({
        tool: async (args) => args[0] === 'lint' ? { json: { diagnostics: [{ code: 'R2D001', message: 'нет такого API' }] } } : { json: {} },
        abs: (p) => '/p/' + p, exists: (p) => files.has(p), readText: (p) => files.get(p), writeText: (p, c) => files.set(p, c), list: () => [],
    });
    const edit = tools.find((t) => t.name === 'edit_file');
    const out = await edit.run({ path: 'a.js', old_string: 'let a = 1;', new_string: 'let a = 2;' });
    truthy(out.includes('изменено a.js') && out.includes('R2D001'));
    eq(files.get('a.js'), 'let a = 2;\nlet b = 1;\n');
    for (const bad of [{ old_string: 'let' }, { old_string: 'нет такого' }, { old_string: '' }]) {
        let threw = false;
        try { await edit.run({ path: 'a.js', new_string: 'x', ...bad }); } catch (_) { threw = true; }
        truthy(threw, JSON.stringify(bad));
    }
    eq(files.get('a.js'), 'let a = 2;\nlet b = 1;\n', 'неудачные правки файл не меняют');
});

await atest('api_lookup: найдено и «такого API нет»', async () => {
    const mk = (r) => editorTools({ tool: async () => ({ json: r }), abs: (p) => p, exists: () => false, readText: () => '', writeText: () => {}, list: () => [] }).find((t) => t.name === 'api_lookup');
    const hit = await mk({ ok: true, exact: true, count: 1, entries: [{ path: '$.scene.add', kind: 'function', args: ['arg0', 'arg1'], description: 'Регистрирует сцену' }] }).run({ name: '$.scene.add' });
    truthy(hit.includes('$.scene.add [function](arg0, arg1)'));
    const miss = await mk({ ok: true, exact: false, count: 0, entries: [] }).run({ name: '$.scene.nope' });
    truthy(miss.includes('не существует'));
});

test('compact: старые длинные результаты сворачиваются, свежие и короткие — нет', () => {
    const big = 'x'.repeat(2000);
    const msgs = [];
    for (let i = 0; i < 4; i++) msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'i' + i, content: i === 1 ? 'коротко' : big }] });
    compact(msgs, 2);
    truthy(msgs[0].content[0].content.length < 400);
    eq(msgs[1].content[0].content, 'коротко');
    eq(msgs[2].content[0].content.length, 2000);
    eq(msgs[3].content[0].content.length, 2000);
});

await atest('studio-инструменты: вкладки, состояние, операции карты и именованные операции', async () => {
    const applied = [];
    const api = {
        id: 'hammer', map: { brushes: [{ id: 'b1' }] }, snapshot: () => ({ dirty: false }), diagnostics: () => [],
        session: { apply: async (op, args) => { applied.push([op, args]); return { ok: true }; } },
        ops: { validate: async () => ({ ok: true, errors: 0 }), createBrush: async () => { throw new Error('не в списке'); } },
        render() {}, save: async () => ({ ok: true }),
    };
    const tools = Object.fromEntries(studioTools({
        tabs: () => [{ path: 'a.re2dmap', studio: 'hammer', active: true }], openTab: async () => {},
        studioApi: (p) => (p === '' || p === 'a.re2dmap') ? api : null,
    }).map((t) => [t.name, t]));
    truthy(JSON.parse(await tools.tabs.run({}))[0].studio === 'hammer');
    truthy(JSON.parse(await tools.studio_state.run({})).data.brushes.length === 1);
    eq(JSON.parse(await tools.studio_state.run({ section: 'brushes' })).length, 1);
    await tools.studio_op.run({ op: 'brush.create', args: { rect: [0, 0, 16, 16] } });
    eq(applied[0][0], 'brush.create');
    truthy((await tools.studio_op.run({ op: 'validate', args: [] })).includes('"ok":true'));
    for (const bad of [{ op: 'createBrush' }, { op: 'nope' }]) {
        let threw = false;
        try { await tools.studio_op.run(bad); } catch (_) { threw = true; }
        truthy(threw, bad.op);
    }
    let missing = '';
    try { await tools.studio_state.run({ path: 'other.re2dmap' }); } catch (e) { missing = e.message; }
    truthy(missing.includes('не открыта'));
    eq(JSON.parse(await tools.studio_save.run({})).ok, true);
    eq(Object.values(tools).filter((t) => t.mutating).map((t) => t.name), ['studio_edit', 'studio_op', 'studio_save']);
});

test('paramNames/bindArgs: позиционные и именованные аргументы', () => {
    eq(paramNames((x, y) => 0), ['x', 'y']);
    eq(paramNames(async function f(a, b = 2) { return 0; }), ['a', 'b']);
    eq(paramNames({ paint(x, y, id) { return 0; } }.paint), ['x', 'y', 'id']);
    const paint = (x, y, id) => 0;
    eq(bindArgs(paint, { y: 2, id: 7, x: 1 }), [1, 2, 7]);
    eq(bindArgs(paint, [4, 5, 6]), [4, 5, 6]);
    const one = (spec) => 0;
    eq(bindArgs(one, { a: 1 }), [{ a: 1 }]);
    eq(bindArgs(paint, undefined), []);
});

test('mergePatch: слияние, замена массивов, null удаляет, прототип не трогается', () => {
    const doc = { a: { b: 1, c: 2 }, list: [1, 2, 3], gone: 1 };
    mergePatch(doc, { a: { b: 5 }, list: [9], gone: null, add: { x: 1 }, __proto__: { polluted: 1 } });
    eq(doc, { a: { b: 5, c: 2 }, list: [9], add: { x: 1 } });
    eq({}.polluted, undefined);
});

await atest('студии ассетов: studio_ops, studio_edit через историю, studio_op по именам параметров', async () => {
    const data = { layers: [{ data: [[0, 0]] }], terrains: {} };
    const edits = [];
    const api = {
        id: 'tilemap', state: { data },
        ops: {
            edit(label, fn) { edits.push(label); return fn(data) !== false; }, model: () => data,
            paint: (x, y, id) => { data.layers[0].data[y][x] = id; return true; }, select: 5,
        },
        render() {}, save: async () => ({ ok: true }),
    };
    const tools = Object.fromEntries(studioTools({ tabs: () => [], openTab: async () => {}, studioApi: () => api }).map((t) => [t.name, t]));
    const ops = JSON.parse(await tools.studio_ops.run({}));
    eq(ops.ops.map((o) => o.name), ['paint']);
    eq(ops.ops[0].params, ['x', 'y', 'id']);
    eq(ops.edit, true);
    await tools.studio_op.run({ op: 'paint', args: { x: 1, y: 0, id: 7 } });
    eq(data.layers[0].data, [[0, 7]]);
    await tools.studio_edit.run({ patch: { terrains: { grass: { id: 1 } } }, label: 'Террейн' });
    eq(data.terrains, { grass: { id: 1 } });
    eq(edits, ['Террейн']);
    let blocked = '';
    try { await tools.studio_op.run({ op: 'model' }); } catch (e) { blocked = e.message; }
    truthy(blocked.includes('неизвестная операция'));
    let noedit = '';
    api.ops.edit = undefined;
    try { await tools.studio_edit.run({ patch: {} }); } catch (e) { noedit = e.message; }
    truthy(noedit.includes('не принимает патчи'));
});

await atest('откат агента отменяет правки студии: только реально изменившие документ', async () => {
    const data = { layers: [{ data: [[0, 0]] }] };
    const stack = [];
    const api = {
        id: 'tilemap', state: { data },
        ops: {
            edit(label, fn) { const prev = JSON.stringify(data); fn(data); stack.push(prev); return true; },
            paint: (x, y, id) => { stack.push(JSON.stringify(data)); data.layers[0].data[y][x] = id; return true; },
            check: () => ({ ok: true }),
        },
        undo() { const prev = stack.pop(); if (prev === undefined) return false; for (const k of Object.keys(data)) delete data[k]; Object.assign(data, JSON.parse(prev)); return true; },
        render() {},
    };
    const history = [];
    const tools = Object.fromEntries(studioTools({ tabs: () => [], openTab: async () => {}, studioApi: () => api, pushStep: (st) => history.push(st) }).map((t) => [t.name, t]));
    await tools.studio_op.run({ op: 'paint', args: { x: 0, y: 0, id: 5 } });
    await tools.studio_op.run({ op: 'check', args: [] });
    await tools.studio_edit.run({ patch: { note: 'x' } });
    eq(history.length, 2, 'check ничего не менял — шага в истории нет');
    const done = undoEdits(history, {}, 2);
    eq(done.length, 2);
    truthy(done[0].includes('отменена правка студии: studio_edit'));
    eq(data.layers[0].data, [[0, 0]]);
    eq(data.note, undefined);
});

await atest('compact: старые записанные тексты в вызовах инструментов сворачиваются, свежие остаются', async () => {
    const big = 'x'.repeat(2000);
    const msgs = [{ role: 'user', content: 'задача' }];
    for (let i = 0; i < 5; i++) {
        msgs.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'u' + i, name: 'write_file', input: { path: 'f' + i, content: big } }] });
        msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u' + i, content: 'ok' }] });
    }
    compact(msgs, 2);
    const uses = msgs.filter((m) => m.role === 'assistant').map((m) => m.content[0].input);
    truthy(uses[0].content.length < 300 && uses[0].content.includes('2000 симв.'));
    eq(uses[0].path, 'f0');
    eq(uses[4].content.length, 2000);
    eq(uses[3].content.length, 2000);
});

await atest('ленивый набор инструментов: редкие группы подключаются по задаче, навыку или tools_more', async () => {
    const mk = (name) => ({ name, description: name, schema: { type: 'object', properties: {} }, run: async () => 'ок' });
    const toolset = ['read_file', 'pixel_art', 'generate_sound', 'studio_op', 'tabs', 'skill_load'].map(mk);
    const seenTools = [];
    const reply = (blocks) => ({ ok: true, status: 200, json: { content: blocks, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } });
    const run = async (task, scripted) => {
        seenTools.length = 0;
        const q = scripted.slice();
        const transport = async (url, opts) => { seenTools.push(JSON.parse(opts.body).tools.map((t) => t.name)); return reply(q.shift()); };
        const agent = createAgent({ config: { provider: 'anthropic', base: 'x', model: 'm', key: 'k', maxSteps: 6 }, transport, tools: toolset });
        await agent.send(task);
        return seenTools.map((n) => n.join(','));
    };
    const plain = await run('поправь main.js', [[{ type: 'text', text: 'ок' }]]);
    truthy(!plain[0].includes('pixel_art') && !plain[0].includes('studio_op') && plain[0].includes('tools_more'));
    const sprite = await run('нарисуй спрайт монеты', [[{ type: 'text', text: 'ок' }]]);
    truthy(sprite[0].includes('pixel_art') && sprite[0].includes('generate_sound') && !sprite[0].includes('studio_op'));
    const more = await run('сделай игру', [[{ type: 'tool_use', id: 'a', name: 'tools_more', input: { group: 'studio' } }], [{ type: 'text', text: 'ок' }]]);
    truthy(!more[0].includes('studio_op') && more[1].includes('studio_op') && more[1].includes('tabs'));
    const viaSkill = await run('сделай игру', [[{ type: 'tool_use', id: 'a', name: 'skill_load', input: { name: 'pixel-art' } }], [{ type: 'text', text: 'ок' }]]);
    truthy(!viaSkill[0].includes('pixel_art') && viaSkill[1].includes('pixel_art'));
});

await atest('хранилище моделей: профили, свои провайдеры, запоминание ключа, список моделей', async () => {
    let disk = null;
    const mk = () => createModelStore({ read: () => disk && JSON.parse(JSON.stringify(disk)), write: (o) => { disk = JSON.parse(JSON.stringify(o)); } });
    const m = mk(); m.load();
    eq(m.state.active, 'anthropic');
    eq(m.configured('anthropic'), false);
    eq(m.configured('openai'), true, 'локальному серверу ключ не нужен');
    m.set('deepseek', { key: 'KEY1', model: 'deepseek-v4-pro' });
    m.activate('deepseek');
    eq(m.cfg().provider, 'deepseek'); eq(m.cfg().model, 'deepseek-v4-pro'); eq(m.cfg().key, 'KEY1');
    truthy(!JSON.stringify(disk).includes('KEY1'), 'ключ по умолчанию на диск не пишется');
    m.set('deepseek', { remember: true });
    truthy(JSON.stringify(disk).includes('KEY1'), 'с «запомнить» ключ пишется');
    const c = m.addCustom({ id: 'my-gw', label: 'Мой шлюз', protocol: 'anthropic', base: 'https://gw.example/', model: 'm1' });
    eq(c.base, 'https://gw.example'); eq(PROVIDERS['my-gw'].auth, 'x-api-key');
    m.activate('my-gw');
    eq(m.cfg().protocol, 'anthropic');
    let bad = ''; try { m.addCustom({ id: 'my-gw', protocol: 'openai', base: 'https://x' }); } catch (e) { bad = e.message; }
    truthy(bad.includes('уже есть'));
    truthy(validCustomId('Bad ID').length > 0 && validCustomId('ok-1', []) === '');
    // новый «запуск»: настройки вернулись, свой провайдер зарегистрирован, ключ без «запомнить» пропал
    delete PROVIDERS['my-gw'];
    const m2 = mk(); m2.load();
    eq(m2.state.active, 'my-gw'); truthy(!!PROVIDERS['my-gw']); eq(m2.profile('deepseek').key, 'KEY1');
    m2.set('deepseek', { remember: false });
    const m3 = mk(); m3.load();
    eq(m3.profile('deepseek').key, '');
    // список моделей запрашивается и сохраняется
    m3.set('opencode', { key: 'K' });
    let url = '';
    const transport = async (u, o) => { url = u; return { ok: true, status: 200, json: { data: [{ id: 'a-free' }, { id: 'b' }] } }; };
    eq(m3.needsModels('opencode', 1000), true);
    eq(await m3.refreshModels('opencode', transport, 1000), ['a-free', 'b']);
    eq(url, 'https://opencode.ai/zen/go/v1/models');
    eq(m3.needsModels('opencode', 2000), false);
    eq(m3.needsModels('opencode', 1000 + 90000000), true, 'через сутки — снова');
    eq(m3.needsModels('gigachat', 1000), false);
    const m4 = mk(); m4.load();
    eq(m4.profile('opencode').models, ['a-free', 'b']);
    m4.removeCustom('my-gw');
    eq(m4.state.active, 'anthropic'); truthy(!PROVIDERS['my-gw']);
});

await atest('r2d_cli: чтение без подтверждения, запись — с подтверждением; editor_op', async () => {
    const calls = [];
    const host = { tool: async (a) => { calls.push(a); return { output: 'ok' }; }, abs: (p) => p, exists: () => false, readText: () => '', writeText: () => {}, list: () => [] };
    const cli = editorTools(host).find((t) => t.name === 'r2d_cli');
    const mut = (args) => cli.mutating({ args });
    eq(mut(['docs', 'list']), false);
    eq(mut(['validate', 'p']), false);
    eq(mut(['snippet', 'catalog']), false);
    eq(mut(['snippet', 'add', 'p']), true);
    eq(mut(['atlas-grid', 'x.png']), true);
    eq(mut(['validate', 'p', '--write']), true);
    eq(mut(['project-set', 'p', 'a=1']), true);
    eq(await cli.run({ args: ['templates'] }), 'ok');
    eq(calls[0], ['templates']);
    let bad = '';
    try { await cli.run({ args: [] }); } catch (e) { bad = e.message; }
    truthy(bad.includes('непустой'));
    const done = [];
    const eo = studioTools({ tabs: () => [], openTab: async () => {}, studioApi: () => null, editorOp: async (op, args) => { done.push([op, args]); return 'сделано'; } }).find((t) => t.name === 'editor_op');
    eq(await eo.run({ op: 'new_project', args: { template: 'blank', dir: '/tmp/g', name: 'G' } }), 'сделано');
    eq(done[0][0], 'new_project');
    let unknown = '';
    try { await eo.run({ op: 'format_disk' }); } catch (e) { unknown = e.message; }
    truthy(unknown.includes('неизвестная'));
});

test('fieldLine/snippetLine: компактное описание кирпичика', () => {
    eq(fieldLine({ id: 'speed', type: 'number', default: 220, min: 0, max: 900 }), 'speed:number=220[0..900]');
    eq(fieldLine({ id: 'keys', type: 'enum', options: ['wasd', 'arrows'], default: 'wasd' }), 'keys:wasd|arrows="wasd"');
    const line = snippetLine({ id: 'ability.area-effect', title: 'Эффект', description: 'Урон по площади', targets: ['node'], dependencies: [{ id: 'ability.base' }], fields: [{ id: 'radius', type: 'number', default: 80 }] });
    truthy(line.startsWith('ability.area-effect — Эффект: Урон по площади [node] +зависит: ability.base'));
    truthy(line.includes('поля: radius:number=80'));
});

await atest('snippet_find/snippet_apply: поиск, добавление, значения, генерация', async () => {
    const calls = [];
    const host = {
        abs: (p) => '/proj' + (p ? '/' + p : ''),
        tool: async (a) => {
            calls.push(a);
            if (a[1] === 'catalog') return { json: { ok: true, total: 500, packages: [{ id: 'movement.platformer', title: 'Движение платформера', description: 'Бег и прыжок', targets: ['node'], valid: true, fields: [{ id: 'speed', type: 'number', default: 220 }] }] } };
            if (a[1] === 'add') return { json: { ok: true, added: ['snippet:hero:movement.platformer'] } };
            if (a[1] === 'set') return { json: { ok: true } };
            if (a[1] === 'generate') return { json: { ok: true, files: [{ path: 'a' }, { path: 'b' }] } };
            return { json: { ok: true } };
        },
    };
    const tools = Object.fromEntries(snippetTools(host).map((t) => [t.name, t]));
    const found = await tools.snippet_find.run({ query: 'прыж' });
    truthy(found.includes('movement.platformer — Движение платформера') && found.includes('speed:number=220'));
    eq(calls[0].slice(0, 3), ['snippet', 'catalog', '--project']);
    const done = await tools.snippet_apply.run({ owner: 'object:hero', package: 'movement.platformer', values: { speed: 300, keys: 'arrows' } });
    truthy(done.startsWith('готово: snippet:hero:movement.platformer') && done.includes('файлов сгенерировано: 2'));
    const setCall = calls.find((c) => c[1] === 'set');
    eq(setCall.slice(3), ['snippet:hero:movement.platformer', 'speed=300', 'keys="arrows"']);
    eq(calls[0][0], 'snippet');
    truthy(calls.some((c) => c[0] === 'project-index'), 'граф обновляется перед добавлением');
    eq(tools.snippet_apply.mutating, true);
    eq(tools.snippet_find.mutating, undefined);
    const bad = snippetTools({ abs: (p) => p, tool: async (a) => ({ json: a[1] === 'add' ? { ok: false, diagnostics: [{ code: 'SNIP060', severity: 'error', message: 'owner не найден' }] } : { ok: true } }) });
    const badText = await bad[1].run({ owner: 'object:x', package: 'p' });
    truthy(badText.includes('SNIP060: owner не найден') && badText.includes('ЛИТЕРАЛЬНЫМ id'));
    const none = snippetTools({ abs: (p) => p, tool: async () => ({ json: { ok: true, total: 500, packages: [] } }) });
    truthy((await none[0].run({ query: 'zzz' })).includes('ничего не найдено'));
});

await atest('OpenCode Go: Bearer и один x-opencode-session на всю беседу', async () => {
    const seen = [];
    const ok = () => ({ choices: [{ message: { content: 'да' }, finish_reason: 'stop' }] });
    const cfg = { provider: 'opencode', base: PROVIDERS.opencode.base, model: 'glm-5.2', key: 'oc_test' };
    const agent = createAgent({ config: cfg, transport: scripted([ok(), ok()], seen), tools: toolsOf([]) });
    await agent.send('раз');
    await agent.send('два');
    eq(seen[0].url, 'https://opencode.ai/zen/go/v1/chat/completions');
    eq(seen[0].headers.authorization, 'Bearer oc_test');
    truthy(/^[0-9a-f-]{36}$/.test(seen[0].headers['x-opencode-session']));
    eq(seen[1].headers['x-opencode-session'], seen[0].headers['x-opencode-session']);
});

await atest('подталкивание: после серии шагов без правок в ответ добавляется напоминание, правка сбрасывает счётчик', async () => {
    const seen = [];
    const peek = () => anth({ type: 'tool_use', id: 'p' + seen.length, name: 'echo', input: { x: 1 } });
    const write = () => anth({ type: 'tool_use', id: 'w', name: 'wr', input: {} });
    const agent = createAgent({
        config: { provider: 'anthropic', base: 'https://x', model: 'm', nudgeAfter: 3, maxSteps: 10 },
        transport: scripted([peek(), peek(), peek(), write(), peek(), anth({ type: 'text', text: 'ок' })], seen), tools: toolsOf([]), confirm: async () => true,
    });
    await agent.send('?');
    const lastUser = (i) => seen[i].body.messages.at(-1).content;
    eq(lastUser(2).some((b) => b.type === 'text'), false);
    eq(lastUser(3).some((b) => b.type === 'text' && b.text.includes('Хватит исследовать')), true);
    eq(lastUser(4).some((b) => b.type === 'text'), false, 'после правки напоминания нет');
});

await atest('объявил действие без вызова инструмента — агента просят вызвать; итоговый ответ не трогается', async () => {
    const seen = [], log = [];
    const agent = createAgent({
        config: { provider: 'anthropic', base: 'https://x', model: 'm' },
        transport: scripted([anth({ type: 'text', text: 'Код написан. Теперь применю кирпичики.' }),
            anth({ type: 'tool_use', id: 'e1', name: 'echo', input: { x: 1 } }), anth({ type: 'text', text: 'Готово, всё применено.' })], seen),
        tools: toolsOf(log),
    });
    await agent.send('сделай');
    eq(log, [{ x: 1 }]);
    truthy(String(seen[1].body.messages.at(-1).content).includes('не вызвал инструмент'));
    const plain = [];
    const a2 = createAgent({ config: { provider: 'anthropic', base: 'https://x', model: 'm' }, transport: scripted([anth({ type: 'text', text: 'Это объект сцены.' })], plain), tools: toolsOf([]) });
    await a2.send('что такое узел?');
    eq(plain.length, 1, 'обычный ответ без лишних запросов');
});

await atest('screenshot_check: сессия агента, снимок и статистика; пустой кадр помечается', async () => {
    const files = new Map(), calls = [];
    const mk = (stats) => editorTools({
        tool: async (a) => { calls.push(a); return a[0] === 'image-stats' ? { json: stats } : { json: { ok: true } }; },
        abs: (p) => '/proj' + (p ? '/' + p : ''), exists: () => false, readText: () => '', writeText: (p, c) => files.set(p, c), list: () => [],
    }).find((t) => t.name === 'screenshot_check');
    const blank = await mk({ ok: true, blank: true, background: '#07090d', meanLuma: 8 }).run({ frames: 30, hold: ['W'] });
    truthy(blank.startsWith('КАДР ПУСТОЙ'));
    const session = JSON.parse(files.get('.r2d-check/session.json'));
    eq(session.requests.map((r) => r.cmd), ['keys', 'step', 'screenshot', 'quit']);
    eq(session.requests[1].frames, 30);
    eq(session.game, '/proj');
    eq(calls[0][0], 'agent');
    eq(calls[1], ['image-stats', '/proj/.r2d-check/frame.png']);
    const ok = await mk({ ok: true, blank: false, distinctColors: 900 }).run({});
    truthy(ok.startsWith('кадр не пустой'));
    const none = await mk({ ok: false }).run({});
    truthy(none.startsWith('снимок не получен'));
});

test('маскот: инструмент → кадры и реплика, успех/ошибка держатся и возвращаются в покой, сон и клик', () => {
    const m = createMascot();
    eq(m.state.mode, 'idle');
    m.tool('write_file');
    eq(m.state.mode, 'tool:write');
    eq(m.state.bubble, 'Пишу код…');
    truthy(['act_0', 'act_1'].includes(m.state.frame));
    m.tick(0.3, true);
    eq(m.state.mode, 'tool:write', 'пока агент занят — остаёмся в роли');
    m.tool('r2d_validate');
    eq(m.state.bubble, 'Проверяю…');
    m.waiting();
    eq(m.state.mode, 'waiting');
    m.success();
    eq(m.state.bubble, 'Готово!');
    m.tick(2, false);
    eq(m.state.mode, 'success', 'успех держится несколько секунд');
    m.tick(3, false);
    eq(m.state.mode, 'idle', 'потом возвращается в покой');
    m.failure('Ошибка ключа');
    eq(m.state.bubble, 'Ошибка ключа');
    m.tick(6, false);
    eq(m.state.mode, 'idle');
    m.tick(50, false);
    truthy(m.state.sleeping && m.state.frame === 'fx_6', 'после долгого покоя засыпает');
    m.wake();
    eq(m.state.sleeping, false);
    m.poke();
    eq(m.state.mode, 'poke');
    truthy(m.state.bubble.length > 0);
    const known = new Set(['idle', 'walk', 'run', 'crab', 'act', 'emo', 'ico'].flatMap((k) => []));
    const f = mascotFrames();
    for (const spec of Object.values(f.tools)) truthy(spec[0].every((n) => /^(act|emo|crab|idle|fx|misc)_\d+$/.test(n)));
    void known;
});

await atest('testConnection: успех со временем ответа и понятная ошибка', async () => {
    const ok = await testConnection({ provider: 'anthropic', base: 'https://x', model: 'm', key: 'k' },
        async () => ({ ok: true, status: 200, json: { content: [{ type: 'text', text: 'ок' }] } }), (() => { let t = 0; return () => (t += 40); })());
    eq(ok.ok, true);
    eq(ok.text, 'ок');
    eq(ok.ms, 40);
    const seen = [];
    await testConnection({ provider: 'openai', base: 'http://h/v1', model: 'm' }, async (url, o) => { seen.push(JSON.parse(o.body)); return { ok: true, json: { choices: [{ message: { content: 'ок' } }] } }; });
    eq('tools' in seen[0], false, 'без инструментов поле tools не отправляется');
    const bad = await testConnection({ provider: 'anthropic', base: 'https://x', model: 'm', key: 'bad' },
        async () => ({ ok: false, status: 401, json: { error: { message: 'invalid x-api-key' } } }));
    eq(bad.ok, false);
    truthy(bad.error.includes('invalid x-api-key'));
});

const memHost = (files, extra) => ({
    tool: async () => ({ json: { ok: true } }), abs: (p) => '/p' + (p ? '/' + p : ''), exists: (p) => files.has(p), readText: (p) => files.get(p),
    writeText: (p, c) => files.set(p, c), remove: (p) => files.delete(p), list: () => [...files.keys()], ...(extra || {}),
});

await atest('файловые инструменты: диапазоны строк, список с фильтрами, grep, документация по частям', async () => {
    const files = new Map([['main.js', 'a\nb\nneedle here\nd\ne'], ['maps/l.re2dmap', '{"needle":1}'], ['assets/x.png', 'бинарь needle'], ['readme.md', 'Needle в докe']]);
    const T = Object.fromEntries(editorTools(memHost(files, { tool: async (a) => a[0] === 'docs' ? { json: { ok: true, text: Array.from({ length: 50 }, (_, i) => 'строка ' + (i + 1)).join('\n') } } : { json: {} } })).map((t) => [t.name, t]));
    const n = numberLines('a\nb\nc\nd', 2, 3);
    eq([n.from, n.to, n.total], [2, 3, 4]);
    truthy(n.text.startsWith('2│b'));
    truthy((await T.read_file.run({ path: 'main.js', start: 2, end: 3 })).includes('3│needle here'));
    eq(await T.read_file.run({ path: 'main.js' }), 'a\nb\nneedle here\nd\ne');
    eq((await T.list_files.run({ ext: '.js' })), 'main.js');
    eq((await T.list_files.run({ prefix: 'maps/' })), 'maps/l.re2dmap');
    const g = await T.search_project.run({ query: 'NEEDLE' });
    truthy(g.includes('main.js:3: needle here') && g.includes('maps/l.re2dmap:1:') && g.includes('readme.md:1:') && !g.includes('x.png'), 'двоичное пропускается, регистр не важен');
    truthy((await T.search_project.run({ query: 'need\\w+', regex: true, prefix: 'main' })).includes('main.js:3'));
    truthy((await T.search_project.run({ query: 'zzz' })).startsWith('совпадений нет'));
    const part = await T.docs_show.run({ page: 'x', start: 10, lines: 3 });
    eq(part, 'строка 10\nстрока 11\nстрока 12');
    eq(grepProject(memHost(files), { query: 'needle', max: 1 }).truncated, true);
});

await atest('правки откатываются: write/edit/delete/move и undo_edit; без remove перемещение недоступно', async () => {
    const files = new Map([['a.js', 'один'], ['b.js', 'два']]);
    const tools = editorTools(memHost(files));
    const T = Object.fromEntries(tools.map((t) => [t.name, t]));
    await T.write_file.run({ path: 'new.js', content: 'x' });
    await T.edit_file.run({ path: 'a.js', old_string: 'один', new_string: 'ОДИН' });
    await T.delete_file.run({ path: 'b.js' });
    await T.move_file.run({ from: 'a.js', to: 'c.js' });
    eq([...files.keys()].sort(), ['c.js', 'new.js']);
    eq(files.get('c.js'), 'ОДИН');
    eq(tools.history.length, 4, 'write, edit, delete и move (move — один шаг из двух файлов)');
    truthy((await T.undo_edit.run({ count: 5 })).includes('восстановлен a.js'));
    eq([...files.keys()].sort(), ['a.js', 'b.js']);
    eq(files.get('a.js'), 'один');
    eq(files.get('b.js'), 'два');
    eq(await T.undo_edit.run({}), 'откатывать нечего');
    let blocked = '';
    const noRemove = Object.fromEntries(editorTools({ ...memHost(new Map([['a.js', 'x']])), remove: undefined }).map((t) => [t.name, t]));
    try { await noRemove.delete_file.run({ path: 'a.js' }); } catch (e) { blocked = e.message; }
    truthy(blocked.includes('недоступно'));
    eq(undoEdits([], memHost(new Map()), 1), []);
});

await atest('plan и ask_user: чеклист уходит в панель, вопрос ждёт ответ и возвращает его', async () => {
    let plan = null;
    const T = Object.fromEntries(interactTools({ setPlan: (p) => { plan = p; }, ask: async (q, o) => (o.includes('Платформер') ? 'Платформер' : null) }).map((t) => [t.name, t]));
    const r = await T.plan.run({ items: [{ text: 'Сцена', status: 'done' }, { text: 'Враги', status: 'doing' }, { text: 'HUD', status: 'мусор' }] });
    truthy(r.includes('1/3'));
    eq(plan.map((x) => x.status), ['done', 'doing', 'pending']);
    eq(await T.ask_user.run({ question: 'Какой жанр?', options: ['Платформер', 'Шутер'] }), 'ответ пользователя: Платформер');
    eq(await T.ask_user.run({ question: 'Точно?' }), 'пользователь не ответил', 'без совпавших вариантов отвечает null → не ответил');
    let none = '';
    try { await Object.fromEntries(interactTools({}).map((t) => [t.name, t])).ask_user.run({ question: 'x' }); } catch (e) { none = e.message; }
    truthy(none.includes('недоступны'));
});

await atest('playtest: сценарий превращается в сессию r2d agent, eval-результаты сопоставляются по шагам', async () => {
    const files = new Map(), calls = [];
    const T = Object.fromEntries(editorTools(memHost(files, {
        tool: async (a) => {
            calls.push(a);
            if (a[0] === 'agent') return { json: { ok: true, completed: 7, failed: 0, responses: [{ ok: true }, { ok: true }, { ok: true }, { ok: true, result: '{"x":5}' }, { ok: true }, { ok: false, error: 'boom' }, { ok: true }, { ok: true }] } };
            if (a[0] === 'image-stats') return { json: { ok: true, blank: false, meanLuma: 30, distinctColors: 50, nonBackgroundFraction: 0.4, grid: ['..##', '....'] } };
            return { json: { ok: true } };
        } })).map((t) => [t.name, t]));
    const out = JSON.parse(await T.playtest.run({ grid: true, steps: [{ hold: ['D'], frames: 30 }, { eval: '1+1' }, { tap: 'Space', frames: 5 }, { eval: 'x.y' }] }));
    const session = JSON.parse(files.get('.r2d-check/playtest.json'));
    eq(session.requests.map((r) => r.cmd), ['keys', 'step', 'eval', 'key', 'step', 'eval', 'screenshot', 'quit']);
    eq(out.evals[0].result, undefined, 'ответ на соседний запрос не подставляется');
    eq(out.frames, 35);
    eq(out.frame, 'кадр не пустой');
    eq(out.ascii, ['..##', '....']);
    eq(calls.find((c) => c[0] === 'image-stats').slice(2), ['--grid', '48x18']);
    let long = '';
    try { await T.playtest.run({ steps: [{ frames: 600 }, { frames: 600 }, { frames: 600 }, { frames: 600 }, { frames: 600 }, { frames: 600 }] }); } catch (e) { long = e.message; }
    truthy(long.includes('слишком длинный'));
});

await atest('токены: нормализация usage трёх протоколов, суммы в агенте, prompt caching и вырезание служебных полей', async () => {
    eq(usageOf({ usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 } }), { input: 1050, output: 20, cached: 900 });
    eq(usageOf({ usage: { prompt_tokens: 500, completion_tokens: 40, prompt_cache_hit_tokens: 300 } }), { input: 500, output: 40, cached: 300 });
    eq(usageOf({ usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } } }), { input: 10, output: 2, cached: 4 });
    eq(usageOf({}), null);
    const seen = [], totals = [];
    const withUsage = (content, u) => ({ content, stop_reason: 'end_turn', usage: u });
    const agent = createAgent({
        config: { provider: 'anthropic', base: 'https://x', model: 'm' },
        transport: scripted([withUsage([{ type: 'tool_use', id: 'u1', name: 'echo', input: { x: 1 } }], { input_tokens: 100, output_tokens: 10 }),
            withUsage([{ type: 'text', text: 'ок' }], { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 100 })], seen),
        tools: toolsOf([]), events: { usage: (u, sum) => totals.push({ ...sum }) },
    });
    agent.state.messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'z', content: 'x'.repeat(500), _compact: true }] });
    await agent.send('?');
    eq(agent.state.usage, { input: 220, output: 15, cached: 100, calls: 2 });
    eq(totals.length, 2);
    const b = seen[0].body;
    truthy(Array.isArray(b.system) && b.system[0].cache_control.type === 'ephemeral', 'system помечен для кэша');
    eq(b.tools.at(-1).cache_control.type, 'ephemeral');
    truthy(!JSON.stringify(b.messages).includes('_compact'), 'служебные поля не уходят в API');
    const noCache = [];
    await createAgent({ config: { provider: 'anthropic', base: 'https://x', model: 'm', cache: false }, transport: scripted([anth({ type: 'text', text: 'ок' })], noCache), tools: toolsOf([]) }).send('?');
    eq(typeof noCache[0].body.system, 'string', 'cache:false отключает кэширование');
});

await atest('лимит шагов: событие limit вместо ошибки, а повторный send продолжает диалог', async () => {
    const seen = [], limits = [], errs = [];
    const call = (id) => anth({ type: 'tool_use', id, name: 'echo', input: { x: 1 } });
    const agent = createAgent({
        config: { provider: 'anthropic', base: 'https://x', model: 'm', maxSteps: 2 },
        transport: scripted([call('a'), call('b'), anth({ type: 'text', text: 'Готово.' })], seen), tools: toolsOf([]),
        events: { limit: (n) => limits.push(n), error: (m) => errs.push(m) },
    });
    await agent.send('долго');
    eq(limits, [2]);
    eq(errs, []);
    await agent.send('Продолжай');
    eq(seen.length, 3);
    truthy(agent.state.messages.length > 5, 'история сохранена между send');
});

await atest('параллельность: read-only вызовы одного ответа идут вместе, правки и serial — по очереди, порядок результатов сохраняется', async () => {
    const log = [];
    // таймеров в qjs нет: «медленный» инструмент ждёт, пока «быстрый» завершится (это возможно только при параллельности)
    let open;
    const gate = new Promise((r) => { open = r; });
    const mk = (name, ms, extra) => ({ name, description: 'd', schema: { type: 'object', properties: {} }, ...(extra || {}),
        run: async (a) => { log.push('start:' + a.n); if (name === 'slow') await gate; if (name === 'fast' && a.n === 2) open(); log.push('end:' + a.n); return name + a.n; } });
    const seen = [], events = [];
    const agent = createAgent({
        config: { provider: 'anthropic', base: 'https://x', model: 'm' },
        transport: scripted([anth(
            { type: 'tool_use', id: 'r1', name: 'slow', input: { n: 1 } }, { type: 'tool_use', id: 'r2', name: 'fast', input: { n: 2 } },
            { type: 'tool_use', id: 'w3', name: 'writer', input: { n: 3 } }, { type: 'tool_use', id: 's4', name: 'ser', input: { n: 4 } },
            { type: 'tool_use', id: 'r5', name: 'fast', input: { n: 5 } }), anth({ type: 'text', text: 'ок' })], seen),
        tools: [mk('slow', 40), mk('fast', 5), mk('writer', 5, { mutating: true }), mk('ser', 5, { serial: true })],
        confirm: async () => true, events: { tool: (n, i, id) => events.push('T' + id), result: (n, o, e, id) => events.push('R' + id) },
    });
    await agent.send('go');
    eq(log.slice(0, 2), ['start:1', 'start:2'], 'первые два read-only стартуют вместе');
    truthy(log.indexOf('start:3') > log.indexOf('end:1'), 'правка ждёт завершения параллельной пачки');
    truthy(log.indexOf('start:4') > log.indexOf('end:3'), 'serial идёт после правки');
    truthy(log.indexOf('start:5') > log.indexOf('end:4'), 'следующий read-only после serial');
    const res = seen[1].body.messages.at(-1).content;
    eq(res.map((r) => r.tool_use_id), ['r1', 'r2', 'w3', 's4', 'r5'], 'порядок результатов — как у вызовов');
    eq(res.map((r) => r.content), ['slow1', 'fast2', 'writer3', 'ser4', 'fast5']);
    truthy(events.includes('Rr2') && events.includes('Rr1'), 'события результата приходят с id вызова');
});

test('trimHistory: старые пары отбрасываются целиком, связка вызовов цела, задача остаётся', () => {
    const msgs = [{ role: 'user', content: 'ЗАДАЧА' }];
    for (let i = 0; i < 12; i++) {
        msgs.push({ role: 'assistant', content: [{ type: 'tool_use', id: 't' + i, name: 'x', input: { i } }] });
        msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't' + i, content: 'p'.repeat(1000) }] });
    }
    const before = msgs.length;
    const dropped = trimHistory(msgs, 6000);
    truthy(dropped > 0 && dropped % 2 === 0, 'режутся парами');
    eq(msgs.length, before - dropped);
    truthy(msgs[0].content.startsWith('ЗАДАЧА') && msgs[0].content.includes('сокращены'));
    eq(msgs[1].role, 'assistant');
    const ids = new Set();
    for (const m of msgs) for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type === 'tool_use') ids.add(b.id);
        if (b.type === 'tool_result') truthy(ids.has(b.tool_use_id), 'у результата есть вызов');
    }
    truthy(JSON.stringify(msgs).length <= 6000 + 400);
    eq(trimHistory(msgs, 1e9), 0, 'в пределах лимита ничего не трогаем');
    const short = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
    eq(trimHistory(short, 1), 0, 'короткую историю не режем');
});

await atest('откат snippet_apply и studio_save: один шаг возвращает project.json, точку входа и сгенерированное', async () => {
    const files = new Map([['project.json', '{"runtime":{"entry":"game.js"}}'], ['game.js', 'старый вход'], ['generated/a.js', 'старый ген']]);
    const history = [];
    const host = { ...memHost(files), history,
        tool: async (a) => {
            if (a[1] === 'add') { files.set('project.json', '{"runtime":{"entry":"game.js"},"editor":{"snippets":1}}'); return { json: { ok: true, added: ['snippet:h:p'] } }; }
            if (a[1] === 'generate') { files.set('game.js', 'import generated; старый вход'); files.set('generated/a.js', 'новый ген'); files.set('generated/b.js', 'второй'); return { json: { ok: true, files: [{ path: 'generated/a.js' }, { path: 'generated/b.js' }, { path: 'game.js' }] } }; }
            return { json: { ok: true } };
        } };
    const apply = snippetTools(host).find((x) => x.name === 'snippet_apply');
    truthy((await apply.run({ owner: 'object:h', package: 'p' })).startsWith('готово'));
    eq(history.length, 1, 'вся операция — один шаг истории');
    const undo = editorTools({ ...memHost(files), history }).find((x) => x.name === 'undo_edit');
    truthy((await undo.run({})).includes('удалён generated/b.js'));
    eq(files.get('project.json'), '{"runtime":{"entry":"game.js"}}');
    eq(files.get('game.js'), 'старый вход');
    eq(files.get('generated/a.js'), 'старый ген');
    eq(files.has('generated/b.js'), false, 'созданный генератором файл удалён');
    const saved = [];
    const studio = studioTools({ tabs: () => [{ path: 'a.re2dmap', active: true }], openTab: async () => {}, studioApi: () => ({ id: 'hammer', save: async () => ({ ok: true }) }), remember: (p) => saved.push(p) });
    await studio.find((x) => x.name === 'studio_save').run({});
    eq(saved, ['a.re2dmap'], 'перед сохранением документа студии снимается файл');
});

await atest('навыки и пиксель-арт: skill_list/skill_load, pixel_art (спека, защита от перезаписи, откат, атлас), pixel_preview', async () => {
    const files = new Map(), calls = [];
    const report = { ok: true, width: 12, height: 13, outWidth: 12, outHeight: 13, opaque: 124, legend: { k: '#1a1020', g: '#3fae5a' }, ascii: ['..kk..', '.kggk.'] };
    const tools = editorTools(memHost(files, { tool: async (a) => {
        calls.push(a);
        if (a[0] === 'docs' && a[1] === 'list') return { json: { ok: true, docs: [{ path: 'docs/skills/pixel-art.md', title: 'Навык: пиксель-арт' }, { path: 'docs/skills/sub/x.md', title: 'x' }] } };
        if (a[0] === 'docs' && a[1] === 'show') return { json: { ok: true, text: '# Навык\nтекст' } };
        if (a[0] === 'pixel-art') { if (files.get('.r2d-check/pixel.json').includes('"bad"')) return { json: { ok: false, message: 'ops[0]: плохо' } }; { const o = JSON.parse(files.get('.r2d-check/pixel.json')).out; if (o) files.set(o.replace('/p/', ''), 'PNG'); } return { json: { ...report, frames: JSON.parse(files.get('.r2d-check/pixel.json')).frames ? 2 : undefined } }; }
        if (a[0] === 'atlas-grid') { files.set('assets/slime.atlas.json', '{}'); return { json: { ok: true } }; }
        return { json: { ok: true } };
    } }));
    const T = Object.fromEntries(tools.map((x) => [x.name, x]));
    eq(await T.skill_list.run({}), 'pixel-art — Навык: пиксель-арт');
    eq(await T.skill_load.run({ name: 'Pixel-Art' }), '# Навык\nтекст');
    eq(calls.find((c) => c[0] === 'docs' && c[1] === 'show')[2], 'skills/pixel-art');
    let bad = '';
    try { await T.skill_load.run({ name: '../etc' }); } catch (e) { bad = e.message; }
    truthy(bad.includes('имя навыка'));
    const out = await T.pixel_art.run({ path: 'assets/hero.png', palette: { k: '#1a1020' }, rows: ['kk'] });
    console.log(out);
    truthy(out.includes('спрайт assets/hero.png 12×13') && out.includes('k=#1a1020') && out.includes('.kggk.') && /\[preview: \/p\/\.r2d-check\/preview-\d+\.png\]/.test(out));
    const spec = JSON.parse(files.get('.r2d-check/pixel.json'));
    eq(spec.out, '/p/assets/hero.png');
    truthy(spec.preview.includes('.r2d-check/preview-'));
    eq(tools.history.length, 1, 'новый файл попал в историю отката');
    let exists = '';
    try { await T.pixel_art.run({ path: 'assets/hero.png', rows: ['k'] }); } catch (e) { exists = e.message; }
    truthy(exists.includes('overwrite') && exists.includes('base'), 'существующий файл без base/overwrite не трогаем');
    const edited = await T.pixel_art.run({ path: 'assets/hero.png', base: 'assets/hero.png', ops: [{ op: 'set', x: 0, y: 0, c: 'k' }] });
    truthy(!edited.includes('откат недоступен'), 'правка через base — не перезапись');
    const over = await T.pixel_art.run({ path: 'assets/hero.png', overwrite: true, rows: ['k'] });
    truthy(over.includes('откат недоступен'), 'перезапись честно предупреждает, что откат невозможен');
    let notPng = '';
    try { await T.pixel_art.run({ path: 'assets/hero.jpg', rows: ['k'] }); } catch (e) { notPng = e.message; }
    truthy(notPng.includes('.png'));
    let err = '';
    try { await T.pixel_art.run({ path: 'assets/x.png', ops: [{ op: 'bad' }] }); } catch (e) { err = e.message; }
    truthy(err.includes('ops[0]: плохо'), 'ошибка рисования возвращается агенту как есть');
    const sheet = await T.pixel_art.run({ path: 'assets/slime.png', frames: [{ rows: ['k'] }, { rows: ['k'] }], atlas: { tags: 'idle:0-1' } });
    truthy(sheet.includes('атлас: assets/slime.atlas.json'));
    eq(calls.find((c) => c[0] === 'atlas-grid').slice(2), ['--out', '/p/assets/slime.atlas.json', '--cols', '2', '--rows', '1', '--tags', 'idle:0-1']);
    const pv = await T.pixel_preview.run({ path: 'assets/hero.png' });
    truthy(pv.includes('спрайт assets/hero.png') && pv.includes('[preview:'));
    eq(JSON.parse(files.get('.r2d-check/pixel.json')).base, '/p/assets/hero.png');
});

await atest('generate_sound: слова/пресет → sfx-gen, защита от перезаписи, откат, предупреждения, ошибки синтезатора', async () => {
    const files = new Map(), calls = [];
    let reply = { ok: true, preset: 'jump', seconds: 0.14, peak: 0.4, rms: 0.2, clipped: 0, pitchHz: 528, envelope: ['..  ', '##. '], params: { wave: 'square', freq: 0.3, slide: 0.25, decay: 0.2, seed: 4 } };
    const tools = editorTools(memHost(files, { tool: async (a) => {
        calls.push(a);
        if (a[0] === 'sfx-gen') { if (reply.ok) files.set(JSON.parse(files.get('.r2d-check/sfx.json')).out.replace('/p/', ''), 'WAV'); return { json: reply }; }
        return { json: { ok: true } };
    } }));
    const T = Object.fromEntries(tools.map((x) => [x.name, x]));
    const out = await T.generate_sound.run({ path: 'assets/sfx/jump.wav', text: 'короткий прыжок', seed: 4 });
    const spec = JSON.parse(files.get('.r2d-check/sfx.json'));
    eq(spec.out, '/p/assets/sfx/jump.wav'); eq(spec.text, 'короткий прыжок'); eq(spec.seed, 4);
    truthy(out.includes('звук assets/sfx/jump.wav (jump, seed 4): 0.14 с') && out.includes('тон ≈ 528') && out.includes('##.') && out.includes('$.sound.play("assets/sfx/jump.wav")'));
    truthy(out.includes('wave=square') && out.includes('slide=0.25'), 'в ответе — ненулевые поля дескриптора');
    eq(tools.history.length, 1, 'новый файл — шаг истории');
    let e1 = '';
    try { await T.generate_sound.run({ path: 'assets/sfx/jump.wav', preset: 'coin' }); } catch (e) { e1 = e.message; }
    truthy(e1.includes('overwrite'), 'существующий файл не трогаем без overwrite');
    const over = await T.generate_sound.run({ path: 'assets/sfx/jump.wav', preset: 'coin', overwrite: true });
    truthy(over.includes('откат недоступен'));
    let e2 = '';
    try { await T.generate_sound.run({ path: 'assets/sfx/x.mp3', preset: 'coin' }); } catch (e) { e2 = e.message; }
    truthy(e2.includes('.wav'));
    let e3 = '';
    try { await T.generate_sound.run({ path: 'assets/sfx/y.wav' }); } catch (e) { e3 = e.message; }
    truthy(e3.includes('text'), 'без описания — подсказка');
    reply = { ...reply, clipped: 12, peak: 0.99, seconds: 0.02 };
    const warn = await T.generate_sound.run({ path: 'assets/sfx/z.wav', preset: 'hurt' });
    truthy(warn.includes('внимание') && warn.includes('clipped 12') && warn.includes('короче 50 мс'), 'срез и короткий звук — предупреждения');
    reply = { ok: false, code: 'SDK_SFX', message: 'text: не понял, какой это звук' };
    let e4 = '';
    try { await T.generate_sound.run({ path: 'assets/sfx/q.wav', text: 'абракадабра' }); } catch (e) { e4 = e.message; }
    truthy(e4.includes('не понял'), 'ошибка синтезатора возвращается агенту как есть');
    eq(files.has('assets/sfx/q.wav'), false);
});

await atest('GigaChat: схемы без properties/items и type-union нормализуются, исходные не меняются; корневой УЦ передаётся', async () => {
    const src = { type: 'object', properties: { palette: { type: 'object', description: 'p' }, frames: { type: 'array' }, rows: { type: 'array', items: { type: 'string' } }, args: { type: ['object', 'array'], description: 'a' }, nested: { type: 'object', properties: { a: { type: 'object' } } } }, required: [] };
    const fixed = gigachatSchema(src);
    strictEq(JSON.stringify(fixed.properties.palette.properties), '{}');
    strictEq(fixed.properties.frames.items.type, 'string');
    strictEq(JSON.stringify(fixed.properties.rows.items), '{"type":"string"}');
    strictEq(fixed.properties.args.type, 'object');
    strictEq(JSON.stringify(fixed.properties.nested.properties.a.properties), '{}');
    truthy(!('properties' in src.properties.palette), 'исходная схема не тронута');
    const seen = [];
    const transport = async (url, opts) => {
        seen.push({ url, ca: opts.ca });
        if (url.includes('oauth')) return { ok: true, status: 200, json: { access_token: 't', expires_at: Date.now() + 1800000 } };
        return { ok: true, status: 200, json: { choices: [{ message: { content: 'ок' }, finish_reason: 'stop' }] } };
    };
    await callModel({ provider: 'gigachat', base: PROVIDERS.gigachat.base, model: 'GigaChat-2', key: 'k' }, transport, 's', [{ role: 'user', content: 'x' }], []);
    truthy(seen.length === 2 && seen.every((r) => r.ca && r.ca.startsWith('-----BEGIN CERTIFICATE-----')), 'oauth и чат идут с корневым УЦ Минцифры');
    seen.length = 0;
    await callModel({ provider: 'anthropic', base: 'https://x', model: 'm', key: 'k', protocol: 'openai' }, transport, 's', [{ role: 'user', content: 'x' }], []);
    truthy(seen[0].ca === undefined, 'другие провайдеры идут с системным хранилищем');
});

await atest('GigaChat получает компактный системный промпт, остальные провайдеры — полный', async () => {
    truthy(SYSTEM_PROMPT_COMPACT.length < 900 && SYSTEM_PROMPT.length > 2000 && SYSTEM_PROMPT_COMPACT.includes('engine-basics'));
    const systems = [];
    const transport = async (url, opts) => {
        if (url.includes('oauth')) return { ok: true, status: 200, json: { access_token: 't', expires_at: Date.now() + 1800000 } };
        const body = JSON.parse(opts.body);
        systems.push((body.messages && body.messages[0] && body.messages[0].content) || body.system);
        return { ok: true, status: 200, json: { choices: [{ message: { content: 'ок' }, finish_reason: 'stop' }], content: [{ type: 'text', text: 'ок' }], stop_reason: 'end_turn' } };
    };
    for (const provider of ['gigachat', 'deepseek']) {
        const agent = createAgent({ config: { provider, base: PROVIDERS[provider].base, model: 'm', key: 'k' }, transport, tools: [], events: {} });
        await agent.send('привет');
    }
    strictEq(systems[0], SYSTEM_PROMPT_COMPACT);
    strictEq(systems[1], SYSTEM_PROMPT);
});

await atest('вызов функции, написанный текстом, не принимается за ответ: один пинок и настоящий вызов', async () => {
    const seen = [], log = [], texts = [];
    const agent = createAgent({
        config: { provider: 'deepseek', base: 'https://x', model: 'm', key: 'K' },
        transport: scripted([
            { choices: [{ message: { content: 'echo(x=5)\nГотово.' }, finish_reason: 'stop' }] },
            { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'echo', arguments: '{"x":5}' } }] }, finish_reason: 'tool_calls' }] },
            { choices: [{ message: { content: 'сделано' }, finish_reason: 'stop' }] },
        ], seen),
        tools: toolsOf(log), events: { text: (t) => texts.push(t) },
    });
    await agent.send('вызови echo');
    strictEq(log.length, 1, 'после пинка инструмент вызван по-настоящему');
    truthy(seen[1].body.messages.some((m) => m.role === 'user' && String(m.content).includes('по одной за ответ')), 'модели сказали, что вызов текстом не выполнен');
    strictEq(texts.at(-1), 'сделано');
});

await atest('GigaChat: functions_state_id возвращается в историю вызова и не уходит в историю как поле блока', async () => {
    const seen = [], log = [];
    const agent = createAgent({
        config: { provider: 'gigachat', base: PROVIDERS.gigachat.base, model: 'GigaChat-2', key: 'k', _token: { value: 't', exp: Date.now() + 1e6 } },
        transport: scripted([
            { choices: [{ message: { content: '', function_call: { name: 'echo', arguments: { x: 3 } }, functions_state_id: 'state-1' }, finish_reason: 'function_call' }] },
            { choices: [{ message: { content: 'готово' }, finish_reason: 'stop' }] },
        ], seen),
        tools: toolsOf(log), events: {},
    });
    await agent.send('вызови echo');
    const assistant = seen[1].body.messages.find((m) => m.role === 'assistant');
    strictEq(assistant.functions_state_id, 'state-1');
    strictEq(assistant.function_call.name, 'echo');
    const result = seen[1].body.messages.find((m) => m.role === 'function');
    strictEq(result.name, 'echo');
});

finish();
