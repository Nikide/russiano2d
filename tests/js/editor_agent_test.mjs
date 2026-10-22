// Юнит-тесты мини-харнеса агента Editor (editor/lib/agent_harness.js): без сети.
import { test, eq as strictEq, truthy, finish } from './_harness.mjs';
const eq = (a, b, m) => strictEq(JSON.stringify(a), JSON.stringify(b), m);
// Харнесс синхронный: async-тело ждём здесь, итог отдаём ему.
async function atest(name, fn) {
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    test(name, () => { if (err) throw err; });
}
import { snippetTools, fieldLine, snippetLine, studioTools, listOps, bindArgs, mergePatch, paramNames, compact, createAgent, callModel, safeRel, editorTools, docContext, gigachatToken, PROVIDERS } from '../../editor/lib/agent_harness.js';

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
    eq(tools.filter((t) => t.mutating === true).map((t) => t.name), ['write_file', 'edit_file']);
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
    truthy((await bad[1].run({ owner: 'object:x', package: 'p' })).includes('SNIP060: owner не найден'));
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

finish();
