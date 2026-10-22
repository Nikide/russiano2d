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
import { RU_ROOT_CA_PEM } from './ru_root_ca.js';

export const PROVIDERS = {
    anthropic: { label: 'Anthropic', protocol: 'anthropic', auth: 'x-api-key', base: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' },
    openai: { label: 'OpenAI-совм.', protocol: 'openai', auth: 'bearer', base: 'http://localhost:8080/v1', model: 'local' },
    // YandexGPT через OpenAI-совместимый эндпоинт Yandex Cloud: ключ сервисного аккаунта
    // (`Api-Key`) или IAM-токен (`Bearer`: начните ключ с `Bearer `); модель — gpt://<id каталога>/yandexgpt/latest.
    yandex: { label: 'YandexGPT', protocol: 'openai', auth: 'api-key', base: 'https://llm.api.cloud.yandex.net/v1', model: 'gpt://<id-каталога>/yandexgpt/latest' },
    // OpenCode Go (подписка): OpenAI-протокол chat/completions; список моделей — GET {base}/models.
    // Часть моделей каталога говорит по /responses или /messages — для них нужны «OpenAI-совм.»/«Anthropic» с другим адресом.
    opencode: { label: 'OpenCode Go', protocol: 'openai', auth: 'bearer', base: 'https://opencode.ai/zen/go/v1', model: 'kimi-k2.7-code', sessionHeader: 'x-opencode-session' },
    deepseek: { label: 'DeepSeek', protocol: 'openai', auth: 'bearer', base: 'https://api.deepseek.com', model: 'deepseek-flash' },
    // GigaChat/GigaCode (Сбер): «Authorization key» из кабинета обменивается на токен (30 мин).
    gigachat: {
        label: 'GigaChat', protocol: 'gigachat', auth: 'oauth', base: 'https://api.giga.chat/v1', model: 'GigaChat-2',
        oauthUrl: 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth', scope: 'GIGACHAT_API_PERS', ca: RU_ROOT_CA_PEM,
        compactPrompt: true,
        // GigaChat уверенно вызывает функции, пока их немного: остальные доступны через r2d_cli.
        toolSubset: ['plan', 'list_files', 'read_file', 'write_file', 'edit_file', 'search_project', 'api_lookup', 'snippet_find', 'snippet_apply', 'skill_load', 'r2d_lint', 'r2d_validate', 'run_check', 'playtest', 'screenshot_check', 'pixel_art', 'generate_sound', 'undo_edit'],
    },
};

export const SYSTEM_PROMPT = [
    'Ты — агент внутри Editor движка Russiano2D (2D/2.5D, один бинарник r2d, игровой API — `$`). Отвечай по-русски, коротко. Действуй, а не исследуй: 3–5 вызовов инструментов на простую задачу.',
    'Правила: только публичный `$` API; не пиши второй движок, ECS, свой scene graph/event bus/менеджеры. Имя `$.…`, в котором не уверен, проверь api_lookup один раз (не гадай именами).',
    'ГОТОВОЕ ПОВЕДЕНИЕ (движение, прыжок, AI, способности, камера, UI) НЕ ПИШИ КОДОМ: snippet_find → snippet_apply. Наборы `kit.*` (например kit.platformer-core: движение+здоровье+камера) подключают сразу несколько кирпичиков — предпочитай их; искать достаточно 2–3 раза, потом действуй. Не вызывай `r2d_cli snippet catalog` — это 500 кирпичиков, используй snippet_find с одним словом.',
    'Объект, к которому цепляется кирпичик, создай в коде с `id`, затем snippet_apply с owner "object:<id>".',
    'Шпаргалка (проверенные идиомы): `$.ready(($) => { $.gfx.color("#141824"); $.world.gravity(0, 1800).bounds(0, 0, 1280, 720); … });` (bounds ставит невидимые стены по краям — без них герой улетает за уровень) (в `$.ready`: сцены `$.scene.add("level", ($) => { … })` и запуск `$.scene.load("level")`).',
    'Объекты для кирпичиков создавай с ЛИТЕРАЛЬНЫМ id (`id: "coin1"`), не в цикле с id из строки — граф их иначе не увидит. ФИЗИКА ЕСТЬ ТОЛЬКО У ВИДОВ УЗЛОВ: герой — `$("<player>", { id: "hero" }).at(200, 300).size(26, 30).color("#e07040").controls({ axis: "both", coyote: 100, jumpBuffer: 120 }).collision(26, 30).appendTo($.world)`;',
    'земля и платформы — ТВЁРДЫЕ `$("<wall>", { id: "p1" }).at(x, y).size(200, 24).color("#5a6a5a").appendTo($.world)` (голый `<sprite>` — просто картинка: без гравитации и столкновений, герой пройдёт сквозь); монета — `$("<sprite>", { id: "coin1" }).at(x, y).size(18, 18).color("#ffd040")` + кирпичик interact.pickup;',
    'текст: `const label = $("<text>", { text: "Счёт: 0", size: 32 }).at(40, 40).appendTo($.world); label.text("Счёт: 1")` (так обновляется); кирпичик interact.pickup шлёт на герое событие `collect` с `{ value }`: `hero.on("collect", (e) => { score += e.value || 1; label.text("Счёт: " + score); })`; картинка: создай `<sprite>` и передай в `src` путь к существующему PNG. Импорт сгенерированных кирпичиков добавляет их генератор — сам его не пиши.',
    'Вид от первого лица / 2.5D (бумер-шутер): НОВЫЙ API `$.re2dWorld` — `docs_show highlevel/re2d` (карта Hammer .re2dmap → `r2d world-compile <карта> --renderer` → собранный .re2dworld; `const world = $.re2dWorld.load(worldPath).backend("gpu"); const ctrl = world.controller({ radius: 14, height: 56, eye: 48, step: 9 }); ctrl.place(x, y, 0); $.render(() => world.render(view, 640, 360));`, где `view = { x, y, h, yaw, pitch, fov, near }` обновляется из ctrl и мыши). НЕ используй `.kind(Re2D)`/`$.camera.kind` — это legacy. Не оборачивай вызовы в try/catch (ошибки должны быть видны). После изменения сцены вызови screenshot_check: `КАДР ПУСТОЙ` — игра не работает, найди причину.',
    'Инструменты: search_project (grep по файлам) и read_file со start/end вместо чтения целиком; для длинных задач начни с plan и обновляй его; при неоднозначной задаче спроси ask_user (кнопки вариантов); для проверки игры playtest (ввод + eval состояния: позиция героя, счёт, подбор предметов; grid:true — ASCII-карта кадра); ошибочную правку откати undo_edit.',
    'Правка: edit_file (точечно) или write_file (новый файл); после записи .js lint уже запущен — исправь замечания. В конце r2d_validate; при изменении логики — run_check. Не повторяй проверки без правок.',
    'Проект обычно уже открыт (project_info/list_files) — работай в нём; new_project нужен только если проекта нет. Игра целиком: код → кирпичики → ресурсы в студиях. Студии и вкладки: tabs/open_tab/studio_ops/studio_state/studio_edit/studio_op/studio_save (карты .re2dmap в Hammer: brush.create, entity.create, element.create…; после серии правок validate и studio_save). Остальное — r2d_cli (atlas-grid, world-compile, project-set…).',
    'НАВЫКИ — справочники «как делать»: skill_list, затем skill_load перед незнакомой работой: engine-basics (идиомы и ловушки `$`), generate-sound (звуки), game-workflow (игра целиком), genre-kits (жанр → набор kit.*), platformer, top-down-action, fps-2-5d, rpg-systems, story-dialogue, enemy-ai, level-design, game-feel, audio, ui-hud, save-progress, playtest-qa, pixel-art. Нужен спрайт/тайл, а готовой картинки нет — загрузи pixel-art и нарисуй pixel_art (ASCII-срез покажет результат), затем укажи созданный файл в `.sprite(path)`. Нужен звуковой эффект — загрузи generate-sound и вызови generate_sound (слова или пресет → WAV; монета, выстрел, взрыв, прыжок, удар, бонус, клик); музыку создать нельзя — только существующие файлы.',
    'Пути — относительно корня проекта. Сначала list_files/read_file, потом пиши.',
].join('\n');

// GigaChat на длинном системном промпте перестаёт вызывать функции и пишет вызовы текстом («write_file(path=…)»), а на коротком
// (проверено на 6 задачах из 6) вызывает их исправно. Поэтому для него промпт сжат, а правила движка лежат в навыках (skill_load).
export const SYSTEM_PROMPT_COMPACT = 'Ты — агент внутри редактора игрового движка Russiano2D. Отвечай по-русски, коротко. Любое действие с проектом выполняй вызовом функции, а не описанием в тексте; вызывай по одной функции за ответ и жди результата. Перед работой над кодом игры вызови skill_load engine-basics, перед другой незнакомой работой — skill_load (список — skill_list). `$`-API проверяй функцией api_lookup; готовое поведение ищи функцией snippet_find и подключай snippet_apply. Пути — относительно корня проекта.';

export function toolSpecs(tools) {
    return tools.map((t) => ({ name: t.name, description: t.description, schema: t.schema }));
}

// Служебные поля блоков истории (`_compact` и т.п.) наружу не отдаём: API отвергает незнакомые ключи.
function publicBlocks(messages) {
    return messages.map((m) => (typeof m.content === 'string' ? m : {
        role: m.role,
        content: m.content.map((b) => Object.fromEntries(Object.entries(b).filter(([k]) => !k.startsWith('_')))),
    }));
}

// Anthropic: system и определения инструментов — неизменный префикс, его помечаем для prompt caching
// (повторные запросы читают префикс из кэша: быстрее и дешевле); так же — хвост истории.
function anthropicBody(cfg, system, messages, tools) {
    const msgs = publicBlocks(messages);
    const last = msgs[msgs.length - 1];
    if (cfg.cache !== false && last && Array.isArray(last.content) && last.content.length) {
        last.content[last.content.length - 1] = { ...last.content[last.content.length - 1], cache_control: { type: 'ephemeral' } };
    }
    const defs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
    if (cfg.cache !== false && defs.length) defs[defs.length - 1] = { ...defs[defs.length - 1], cache_control: { type: 'ephemeral' } };
    return {
        model: cfg.model, max_tokens: cfg.maxTokens || 4096,
        system: cfg.cache !== false ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system,
        messages: msgs,
        ...(defs.length ? { tools: defs } : {}),
    };
}

// Расход токенов из ответа API → { input, output, cached }: единый вид для всех протоколов.
export function usageOf(data) {
    const u = data && data.usage;
    if (!u) return null;
    const input = (u.input_tokens ?? u.prompt_tokens ?? 0) + (u.cache_creation_input_tokens || 0);
    const cached = u.cache_read_input_tokens ?? u.prompt_cache_hit_tokens ?? (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) ?? 0;
    return { input: input + (u.cache_read_input_tokens || 0), output: u.output_tokens ?? u.completion_tokens ?? 0, cached };
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
        ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } })) } : {}),
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
        body: 'scope=' + (cfg.scope || spec.scope), timeout: cfg.timeout || 30000, ca: cfg.ca || spec.ca,
    });
    const data = res.json;
    if (!res.ok || !data || !data.access_token) {
        const why = data && (data.message || data.error);
        throw new Error('GigaChat: не удалось получить токен (' + (why === undefined || why === null ? 'HTTP ' + res.status : (typeof why === 'string' ? why : JSON.stringify(why))).slice(0, 200) + ')');
    }
    cfg._token = { value: data.access_token, exp: Number(data.expires_at) || t + 25 * 60000 };
    return data.access_token;
}

// GigaChat принимает `functions`; результат функции обязан быть JSON-строкой.
// GigaChat отвергает схему, где у type:'object' нет `properties` (422 «Field 'properties.x.properties' is missing»),
// а у type:'array' нет `items`: добавляем пустые описания рекурсивно, не меняя исходные схемы инструментов.
export function gigachatSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    if (Array.isArray(schema)) return schema.map(gigachatSchema);
    const out = {};
    for (const [k, v] of Object.entries(schema)) out[k] = k === 'properties' && v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([n, x]) => [n, gigachatSchema(x)])) : (k === 'items' ? gigachatSchema(v) : v);
    // В одном публичном инструменте редактора args принимает object | array. GigaChat валидирует type строго как строку;
    // object достаточно: модель может передать именованные параметры, а локальный обработчик по-прежнему принимает оба вида.
    if (Array.isArray(out.type) && out.type.length) out.type = out.type.includes('object') ? 'object' : out.type[0];
    if (out.type === 'object' && !out.properties) out.properties = {};
    if (out.type === 'array' && !out.items) out.items = { type: 'string' };
    return out;
}

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
            if (call) {
                msg.function_call = { name: call.name, arguments: call.input || {} };
                // Без functions_state_id GigaChat не связывает результат с вызовом и повторяет тот же вызов по кругу.
                if (call._fsid) msg.functions_state_id = call._fsid;
            }
            out.push(msg);
        } else {
            for (const b of m.content) if (b.type === 'tool_result') out.push({ role: 'function', name: names.get(b.tool_use_id) || 'tool', content: JSON.stringify({ result: b.content }) });
        }
    }
    return {
        model: cfg.model, messages: out, max_tokens: cfg.maxTokens || 4096,
        ...(tools.length ? { functions: tools.map((t) => ({ name: t.name, description: t.description, parameters: gigachatSchema(t.schema) })), function_call: 'auto' } : {}),
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
    const res = await transport(url, { headers, body: JSON.stringify(body), timeout: cfg.timeout || 120000, ca: protocol === 'gigachat' ? (cfg.ca || spec.ca) : cfg.ca });
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
            blocks.push({ type: 'tool_use', id: 'gc_' + (++giga_seq), name: m.function_call.name, input: input || {}, ...(m.functions_state_id ? { _fsid: m.functions_state_id } : {}) });
        }
        return { blocks, stop: data.choices && data.choices[0] && data.choices[0].finish_reason, usage: usageOf(data) };
    }
    if (protocol === 'anthropic') {
        return { blocks: (data.content || []).filter((b) => b.type === 'text' || b.type === 'tool_use'), stop: data.stop_reason, usage: usageOf(data) };
    }
    const msg = data.choices && data.choices[0] && data.choices[0].message || {};
    const blocks = [];
    if (msg.content) blocks.push({ type: 'text', text: msg.content });
    for (const c of msg.tool_calls || []) {
        let input = {};
        try { input = JSON.parse(c.function.arguments || '{}'); } catch (_) { input = { _raw: c.function.arguments }; }
        blocks.push({ type: 'tool_use', id: c.id, name: c.function.name, input });
    }
    return { blocks, stop: data.choices && data.choices[0] && data.choices[0].finish_reason, usage: usageOf(data) };
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

// Проверка подключения: один короткий запрос без инструментов. → { ok, ms, text } | { ok:false, error }.
export async function testConnection(config, transport, now) {
    const clock = now || (() => Date.now());
    const t0 = clock();
    const cfg = { ...config, maxTokens: 16, timeout: 30000 };
    try {
        const r = await callModel(cfg, transport, 'Отвечай одним словом.', [{ role: 'user', content: 'Скажи: ок' }], []);
        const text = r.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        return { ok: true, ms: clock() - t0, text: text.slice(0, 60) };
    } catch (e) {
        return { ok: false, error: String(e && e.message || e).slice(0, 240) };
    }
}

// Контекст не безразмерный: если история длиннее maxChars, отбрасываем самые старые пары
// «ответ модели → результаты инструментов» (целиком — связка tool_use/tool_result не рвётся), первое
// сообщение (задача) остаётся с пометкой. Возвращает число отброшенных сообщений.
export function trimHistory(messages, maxChars) {
    const size = (m) => JSON.stringify(m).length;
    let total = messages.reduce((n, m) => n + size(m), 0);
    let dropped = 0;
    // сообщения: [user0, assistant, user(результаты), assistant, user, …] — режем с индекса 1 парами
    while (total > maxChars && messages.length > 3 && messages[1].role === 'assistant') {
        const pair = messages[2] && messages[2].role === 'user' ? 2 : 1;
        for (let k = 0; k < pair; k++) total -= size(messages[1 + k]);
        messages.splice(1, pair);
        dropped += pair;
    }
    if (dropped) {
        const first = messages[0];
        const note = '\n\n[Ранние шаги диалога (' + dropped + ' сообщ.) сокращены для экономии контекста; при необходимости перечитай файлы.]';
        if (typeof first.content === 'string') { if (!first.content.includes('Ранние шаги диалога')) first.content += note; else first.content = first.content.replace(/\(\d+ сообщ\.\)/, '(' + dropped + '+ сообщ.)'); }
    }
    return dropped;
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
    const subset = (PROVIDERS[config.provider] || {}).toolSubset;
    const offered = subset ? tools.filter((t) => subset.includes(t.name)) : tools;
    const state = { messages: [], running: false, stop: false, usage: { input: 0, output: 0, cached: 0, calls: 0 } };

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
        let idle = 0, announced = 0, textCalls = 0;
        try {
            for (let step = 0; step < limit; step++) {
                if (state.stop) { if (ev.error) ev.error('остановлено'); return; }
                compact(state.messages, config.keepResults || 6);
                trimHistory(state.messages, config.maxContextChars || 150000);
                const reply = await callModel(config, transport, system || ((PROVIDERS[config.provider] || {}).compactPrompt ? SYSTEM_PROMPT_COMPACT : SYSTEM_PROMPT), state.messages, offered);
                state.usage.calls++;
                if (reply.usage) {
                    state.usage.input += reply.usage.input; state.usage.output += reply.usage.output; state.usage.cached += reply.usage.cached;
                    if (ev.usage) ev.usage(reply.usage, state.usage);
                }
                if (!reply.blocks.length) { if (ev.error) ev.error('модель вернула пустой ответ'); return; }
                state.messages.push({ role: 'assistant', content: reply.blocks });
                for (const b of reply.blocks) if (b.type === 'text' && ev.text) ev.text(b.text);
                const calls = reply.blocks.filter((b) => b.type === 'tool_use');
                if (!calls.length) {
                    // Слабые модели пишут «теперь применю…» и останавливаются: просим вызвать инструмент.
                    const said = reply.blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
                    // Модели с function-calling «вслепую» (GigaChat) иногда пишут вызов ТЕКСТОМ: `write_file(path=…)` или `read_file "x"`.
                    const names = tools.map((t) => t.name).filter((n) => /^\w+$/.test(n));
                    const textual = names.length && new RegExp('^\\s*(?:' + names.join('|') + ')\\b\\s*[({"\\w]', 'm').test(said);
                    if (textual && textCalls < 3) {
                        textCalls++;
                        state.messages.push({ role: 'user', content: 'Ты написал вызов функции текстом — он не выполнен, ничего не изменилось. Вызывай функции по одной за ответ: сейчас вызови только первую нужную функцию (не пиши её имя и аргументы в ответе), остальное сделаешь после результата.' });
                        continue;
                    }
                    if (announced < 2 && !/\?\s*$/.test(said.trim()) && /(теперь|сейчас|далее|приступаю|применю|применяю|запишу|создам|сделаю|добавлю|напишу|следующ)/i.test(said.slice(-200))) {
                        announced++;
                        state.messages.push({ role: 'user', content: 'Ты описал действие, но не вызвал инструмент — ничего не изменилось. Вызови нужный инструмент сейчас (snippet_apply, write_file или edit_file).' });
                        continue;
                    }
                    return;
                }
                // Независимые read-only вызовы из одного ответа идут параллельно (быстрее на шаге); правки, подтверждения
                // и инструменты с общими файлами (serial) — по одному, в порядке модели. Порядок результатов сохраняется.
                const results = new Array(calls.length);
                let acted = false;
                const serial = (call) => {
                    const t = byName.get(call.name);
                    return !t || t.serial || (typeof t.mutating === 'function' ? t.mutating(call.input || {}) : !!t.mutating);
                };
                const exec = async (k) => {
                    const call = calls[k];
                    if (ev.tool) ev.tool(call.name, call.input, call.id);
                    const r = await runTool(call);
                    if (ev.result) ev.result(call.name, r.text, r.error, call.id);
                    const t = byName.get(call.name);
                    if (t && !r.error && (typeof t.mutating === 'function' ? t.mutating(call.input || {}) : t.mutating)) acted = true;
                    results[k] = { type: 'tool_result', tool_use_id: call.id, content: r.text, is_error: r.error };
                };
                for (let k = 0; k < calls.length;) {
                    if (serial(calls[k])) { await exec(k); k++; continue; }
                    let e = k;
                    while (e < calls.length && !serial(calls[e])) e++;
                    await Promise.all(calls.slice(k, e).map((_, d) => exec(k + d)));
                    k = e;
                }
                // Слабые модели застревают в разведке: после нескольких шагов без единой правки подталкиваем к действию.
                idle = acted ? 0 : idle + 1;
                if (idle >= (config.nudgeAfter || 4) && idle % (config.nudgeAfter || 4) === 0) {
                    results.push({ type: 'text', text: idle >= 2 * (config.nudgeAfter || 4)
                        ? 'СТОП ПОИСКУ. В следующем ответе обязательно вызови snippet_apply (подходящий найденный кирпичик/набор) или write_file/edit_file. Больше никаких snippet_find, docs_search, api_lookup.'
                        : 'Хватит исследовать: ты уже ' + idle + ' шагов ничего не меняешь. Действуй сейчас: примени найденный кирпичик (snippet_apply) или напиши код (write_file/edit_file), затем r2d_validate.' });
                }
                state.messages.push({ role: 'user', content: results });
            }
            if (ev.limit) ev.limit(limit); else if (ev.error) ev.error('достигнут лимит шагов (' + limit + ')');
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
          run: async (a) => {
              const api = need(a.path);
              // перед записью на диск — снимок файла документа (откат через undo_edit / кнопку ↶)
              if (host.remember) { try { const f = a.path ? safeRel(a.path) : ((host.tabs().find((t) => t.active) || {}).path); if (f) host.remember(f); } catch (_) { /* без снимка */ } }
              const r = await api.save();
              return JSON.stringify(r === undefined ? { ok: true } : r).slice(0, 1500);
          } },
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
              const query = String(a.query);
              const find = async (q) => {
                  const r = (await host.tool(['snippet', 'catalog', '--project', host.abs(''), '--query', q, '--fields'])).json;
                  return r && r.ok ? { total: r.total, list: (r.packages || []).filter((x) => x.valid !== false) } : { error: r };
              };
              const first = await find(query);
              if (first.error) return JSON.stringify(first.error);
              const hits = new Map();
              for (const p of first.list) hits.set(p.id, { p, n: 2 });
              if (!first.list.length) {
                  // «ui.score», «platformer movement»: ищем по словам и сводим совпадения
                  const tokens = [...new Set(query.split(/[\s._\-\/,]+/).filter((t) => t.length >= 3))].slice(0, 4);
                  for (const t of tokens) for (const p of (await find(t)).list || []) { const h = hits.get(p.id) || { p, n: 0 }; h.n++; hits.set(p.id, h); }
              }
              const pk = [...hits.values()].sort((x, y) => y.n - x.n || (y.p.id.startsWith('kit.') ? 1 : 0) - (x.p.id.startsWith('kit.') ? 1 : 0)).map((h) => h.p);
              if (!pk.length) return 'ничего не найдено по «' + query + '» (всего кирпичиков: ' + first.total + '). Попробуйте другое слово, часть id (movement, ai, ability, ui, camera, kit) или тег.';
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
              // Снимок для отката: project.json, точка входа и уже сгенерированные файлы — одним шагом истории.
              const snap = [];
              if (host.history && host.exists && host.readText) {
                  let entry = 'main.js';
                  try { entry = JSON.parse(host.readText('project.json')).runtime.entry || 'main.js'; } catch (_) { /* по умолчанию */ }
                  for (const p of new Set(['project.json', entry, ...(host.list ? host.list().filter((f) => f.startsWith('generated/')) : [])])) if (host.exists(p)) snap.push(snapshotFile(host, p));
              }
              const commit = (gen) => {
                  if (!host.history || !snap.length) return;
                  for (const f of (gen && gen.files) || []) if (f.path && !snap.some((x) => x.path === f.path)) snap.push({ path: f.path, before: null });
                  host.history.push({ items: snap });
              };
              await run(['project-index', proj, '--write']);
              const add = await run(['snippet', 'add', proj, pkg, '--owner', owner]);
              if (!add.ok && !(add.diagnostics || []).some((d) => d.code === 'SNIP145' || /уже/.test(d.message || ''))) {
                  const notFound = (add.diagnostics || []).some((d) => d.code === 'SNIP060');
                  return 'не добавлено:\n' + brief(add).join('\n') + (notFound ? '\nГраф видит только объекты с ЛИТЕРАЛЬНЫМ id в коде (`id: "coin1"`); id из цикла или шаблонной строки ("coin"+i) он не находит. Создай объект с литеральным id или не используй кирпичик для него (логика в коде, например в $.onUpdate). Не пытайся чинить индекс вручную.' : '');
              }
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
              commit(gen);
              if (!gen.ok) return 'экземпляр ' + inst + ' добавлен, генерация не удалась:\n' + brief(gen).join('\n');
              return 'готово: ' + ((add.added || [inst]).join(', ')) + '; файлов сгенерировано: ' + (gen.files || []).length + (brief(gen).length ? '\n' + brief(gen).join('\n') : '');
          } },
    ];
}

// Диалог с пользователем и план задач (интерфейс даёт панель): ask_user ждёт ответ кнопкой, plan рисует чеклист.
export function interactTools(host) {
    const str = (description) => ({ type: 'string', description });
    return [
        { name: 'plan', description: 'Показать пользователю план работы и ход выполнения (чеклист в панели). items — все шаги целиком: [{text, status}], status: pending | doing | done. Обновляй по мере работы; для длинных задач (игра, карта, несколько файлов) начни с плана.',
          schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { text: str('шаг'), status: { type: 'string', enum: ['pending', 'doing', 'done'] } }, required: ['text'] } } }, required: ['items'] },
          run: async (a) => {
              if (!Array.isArray(a.items)) throw new Error('items — массив шагов');
              const items = a.items.slice(0, 20).map((x) => ({ text: String(x.text || '').slice(0, 120), status: ['pending', 'doing', 'done'].includes(x.status) ? x.status : 'pending' }));
              if (host.setPlan) host.setPlan(items);
              const done = items.filter((x) => x.status === 'done').length;
              return 'план обновлён: ' + done + '/' + items.length + ' выполнено';
          } },
        { name: 'ask_user', description: 'Задать пользователю уточняющий вопрос с вариантами ответа (кнопки) и дождаться ответа. Используй, когда задача неоднозначна (жанр, стиль, размер), вместо догадок. options — 2–5 коротких вариантов.',
          schema: { type: 'object', properties: { question: str('вопрос'), options: { type: 'array', items: { type: 'string' }, description: 'варианты ответа' } }, required: ['question'] },
          run: async (a) => {
              if (!host.ask) throw new Error('вопросы пользователю недоступны');
              const options = Array.isArray(a.options) && a.options.length ? a.options.slice(0, 5).map((x) => String(x).slice(0, 60)) : ['Да', 'Нет'];
              const answer = await host.ask(String(a.question).slice(0, 300), options);
              return answer === null || answer === undefined ? 'пользователь не ответил' : 'ответ пользователя: ' + answer;
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

// ---- утилиты файловых инструментов (экспортируются для тестов) -------------------------------------
export function numberLines(text, start, end) {
    const lines = String(text).split('\n');
    const a = Math.max(1, Math.floor(Number(start) || 1)), b = Math.min(lines.length, Math.floor(Number(end) || lines.length));
    const w = String(b).length;
    const out = [];
    for (let i = a; i <= b; i++) out.push(String(i).padStart(w, ' ') + '│' + lines[i - 1]);
    return { text: out.join('\n'), total: lines.length, from: a, to: b };
}

const TEXT_EXT = /\.(m?js|json|md|rml|rcss|txt|glsl|frag|vert|html|css|csv|yml|yaml|re2dmap|tilemap\.json|ts)$/i;

export function grepProject(host, { query, regex, prefix, ext, max }) {
    let re;
    if (regex) re = new RegExp(String(query), 'i');
    else { const q = String(query).toLowerCase(); re = { test: (line) => line.toLowerCase().includes(q) }; }
    const limit = Math.min(200, Math.max(1, Number(max) || 40));
    const hits = [];
    let scanned = 0;
    for (const f of host.list()) {
        if (prefix && !f.startsWith(prefix)) continue;
        if (ext && !f.endsWith(ext)) continue;
        if (!TEXT_EXT.test(f)) continue;
        let text;
        try { text = host.readText(f); } catch (_) { continue; }
        if (typeof text !== 'string' || text.length > 400000) continue;
        scanned++;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
                hits.push(f + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 160));
                if (hits.length >= limit) return { hits, scanned, truncated: true };
            }
        }
    }
    return { hits, scanned, truncated: false };
}

// Откат правок агента. history — список шагов: { items: [{ path, before }] }; before === null — файл создан
// агентом (при откате удаляется). Один шаг может объединять несколько файлов (snippet_apply, move_file).
export function undoEdits(history, host, count) {
    const done = [];
    for (let k = 0; k < Math.max(1, count || 1) && history.length; k++) {
        const step = history.pop();
        const items = step.items || [step];
        for (const h of items.slice().reverse()) {
            if (h.before === null) { if (host.remove && host.exists(h.path)) host.remove(h.path); else host.writeText(h.path, ''); }
            else host.writeText(h.path, h.before);
            done.push((h.before === null ? 'удалён ' : 'восстановлен ') + h.path);
            if (host.afterUndo) host.afterUndo(h.path);
        }
    }
    return done;
}

// Снимок файла «до» для истории.
export const snapshotFile = (host, p) => ({ path: p, before: host.exists(p) ? host.readText(p) : null });

let previewSeq = 0;

// Текстовый отчёт о рисунке: размер, легенда палитры и ASCII-срез.
export function pixelReport(path, r, overwritten) {
    const legend = Object.entries(r.legend || {}).map(([k, v]) => k + '=' + v).join(' ');
    return 'спрайт ' + path + ' ' + r.width + '×' + r.height + (r.frames ? ' (кадров: ' + r.frames + ', кадр ' + r.frameWidth + '×' + r.frameHeight + ')' : '') +
        ', непрозрачных пикселей: ' + r.opaque + (r.outWidth !== r.width ? ', в файле ' + r.outWidth + '×' + r.outHeight : '') + (overwritten ? ' (файл перезаписан, откат недоступен)' : '') +
        '\nпалитра: ' + (legend || '—') + (r.ascii ? '\nASCII (. — прозрачно):\n' + r.ascii.join('\n') : '\n(холст большой — ASCII опущен)');
}

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
    const history = host.history || [];
    const remember = (p) => { history.push({ items: [snapshotFile(host, p)] }); if (history.length > 100) history.shift(); };
    const tools = [
        { name: 'docs_search', description: 'Поиск по встроенной документации движка (строки, содержащие запрос).',
          schema: obj({ query: str('слово или фраза') }),
          run: async (a) => JSON.stringify((await host.tool(['docs', 'search', String(a.query), '--limit', '15'])).json) },
        { name: 'docs_show', description: 'Текст страницы документации, например highlevel/ui. Длинные страницы читай частями: start — с какой строки, lines — сколько строк (по умолчанию до ~12000 символов).',
          schema: obj({ page: str('имя страницы'), start: { type: 'number', description: 'первая строка (с 1)' }, lines: { type: 'number', description: 'сколько строк' } }, ['page']),
          run: async (a) => {
              const r = await host.tool(['docs', 'show', String(a.page)]);
              if (!(r.json && r.json.ok)) return JSON.stringify(r.json);
              const all = r.json.text.split('\n');
              const from = Math.max(1, Math.floor(Number(a.start) || 1));
              let to = a.lines ? from + Math.floor(Number(a.lines)) - 1 : all.length;
              let out = all.slice(from - 1, to).join('\n');
              if (!a.lines && out.length > 12000) { out = out.slice(0, 12000); to = from - 1 + out.split('\n').length; out += '\n… [обрезано; продолжение: start=' + (to + 1) + ', всего строк ' + all.length + ']'; }
              return out;
          } },
        { name: 'list_files', description: 'Файлы проекта (относительные пути). prefix — каталог/начало пути, ext — окончание (например .js), limit — сколько вернуть (по умолчанию 200).',
          schema: obj({ prefix: str('начало пути'), ext: str('окончание, например .js'), limit: { type: 'number', description: 'максимум' } }, []),
          run: async (a) => {
              let list = host.list();
              if (a.prefix) list = list.filter((f) => f.startsWith(String(a.prefix)));
              if (a.ext) list = list.filter((f) => f.endsWith(String(a.ext)));
              const limit = Math.min(1000, Math.max(1, Number(a.limit) || 200));
              return list.slice(0, limit).join('\n') + (list.length > limit ? '\n… ещё ' + (list.length - limit) + ' файлов (уточните prefix/ext)' : '') || '(пусто)';
          } },
        { name: 'read_file', description: 'Прочитать файл проекта. Для больших файлов укажи start/end (номера строк с 1) — вернутся строки с номерами; без диапазона файл читается целиком (до ~20000 символов).',
          schema: obj({ path: str('относительный путь'), start: { type: 'number', description: 'первая строка' }, end: { type: 'number', description: 'последняя строка' } }, ['path']),
          run: async (a) => {
              const p = safeRel(a.path);
              if (!host.exists(p)) throw new Error('нет файла ' + p);
              const text = host.readText(p);
              if (a.start || a.end) { const n = numberLines(text, a.start, a.end); return p + ' [' + n.from + '–' + n.to + ' из ' + n.total + ']\n' + n.text; }
              return text.length > 20000 ? text.slice(0, 20000) + '\n… [обрезано, файл ' + text.length + ' симв.; читай по start/end или ищи через search_project]' : text;
          } },
        { name: 'search_project', description: 'Поиск текста по файлам проекта (как grep): строки path:line: текст. query — подстрока (без учёта регистра) или регулярка при regex:true; prefix/ext сужают область. Дешевле, чем читать файлы целиком.',
          schema: obj({ query: str('что искать'), regex: { type: 'boolean', description: 'query — регулярное выражение' }, prefix: str('начало пути'), ext: str('окончание пути'), max: { type: 'number', description: 'максимум совпадений (40)' } }, ['query']),
          run: async (a) => {
              const r = grepProject(host, { query: a.query, regex: a.regex, prefix: a.prefix, ext: a.ext, max: a.max });
              if (!r.hits.length) return 'совпадений нет (просмотрено файлов: ' + r.scanned + ')';
              return r.hits.join('\n') + (r.truncated ? '\n… достигнут лимит, уточните запрос' : '') + '\n[файлов просмотрено: ' + r.scanned + ']';
          } },
        { name: 'write_file', description: 'Создать файл или полностью заменить (требует подтверждения). Для правок существующих файлов используй edit_file. После записи .js автоматически запускается lint.', mutating: true,
          schema: obj({ path: str('относительный путь'), content: str('полное содержимое') }),
          run: async (a) => { const p = safeRel(a.path); remember(p); host.writeText(p, String(a.content)); return 'записано ' + p + await autoLint(p); } },
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
              remember(p);
              host.writeText(p, text.slice(0, first) + String(a.new_string) + text.slice(first + old.length));
              return 'изменено ' + p + await autoLint(p);
          } },
        { name: 'delete_file', description: 'Удалить файл проекта (требует подтверждения; откатывается через undo_edit).', mutating: true,
          schema: obj({ path: str('относительный путь') }),
          run: async (a) => { const p = safeRel(a.path); if (!host.remove) throw new Error('удаление недоступно в этом Editor'); if (!host.exists(p)) throw new Error('нет файла ' + p); remember(p); host.remove(p); return 'удалён ' + p; } },
        { name: 'move_file', description: 'Переместить/переименовать файл проекта (требует подтверждения; откатывается через undo_edit).', mutating: true,
          schema: obj({ from: str('откуда'), to: str('куда') }),
          run: async (a) => {
              const f = safeRel(a.from), t = safeRel(a.to);
              if (!host.remove) throw new Error('перемещение недоступно в этом Editor');
              if (!host.exists(f)) throw new Error('нет файла ' + f);
              if (host.exists(t)) throw new Error('файл уже есть: ' + t);
              const text = host.readText(f);
              history.push({ items: [snapshotFile(host, t), snapshotFile(host, f)] });
              host.writeText(t, text); host.remove(f);
              return 'перемещён ' + f + ' → ' + t;
          } },
        { name: 'undo_edit', description: 'Откатить последние изменения файлов, сделанные агентом (write_file/edit_file/delete_file/move_file); count — сколько шагов (по умолчанию 1).', mutating: true,
          schema: obj({ count: { type: 'number', description: 'сколько шагов откатить' } }, []),
          run: async (a) => { const done = undoEdits(history, host, a.count); return done.length ? done.join('\n') : 'откатывать нечего'; } },
        { name: 'skill_list', description: 'Список навыков — справочников «как делать» (пиксель-арт и др.), которые можно загрузить через skill_load.',
          schema: obj({}),
          run: async () => {
              const r = (await host.tool(['docs', 'list', '--filter', 'skills/'])).json;
              const docs = r && r.ok ? r.docs.filter((d) => /^docs\/skills\/[\w-]+\.md$/.test(d.path)) : [];
              return docs.length ? docs.map((d) => d.path.replace(/^docs\/skills\/|\.md$/g, '') + ' — ' + d.title).join('\n') : 'навыков нет';
          } },
        { name: 'skill_load', description: 'Загрузить навык (справочник с правилами, примерами и рабочим циклом), например `pixel-art` — как рисовать спрайты и тайлы инструментом pixel_art. Загружай, прежде чем браться за незнакомую работу.',
          schema: obj({ name: str('имя навыка из skill_list') }),
          run: async (a) => {
              const name = String(a.name || '').toLowerCase();
              if (!/^[\w-]+$/.test(name)) throw new Error('имя навыка — латиница, цифры, дефис');
              const r = await host.tool(['docs', 'show', 'skills/' + name]);
              if (!(r.json && r.json.ok)) throw new Error('нет навыка «' + name + '» (список — skill_list)');
              return r.json.text.length > 14000 ? r.json.text.slice(0, 14000) + '\n… [обрезано]' : r.json.text;
          } },
        { name: 'pixel_art', mutating: true,
          description: 'Нарисовать или поправить пиксель-арт (спрайт, тайл, лист анимации) и записать PNG в проект (требует подтверждения). Спрайт описывается текстом: palette — {"k":"#1a1020"} (ключ — один символ), rows — строки-пиксели ("..kk.."), frames — кадры анимации, size — пустой холст, ops — операции (set, rect, line, ellipse, fill, replace, flip, mirror, shift, outline, clear), base — править существующий PNG, scale — целое увеличение. Вернёт ASCII-срез результата (видно, что нарисовано) и превью для пользователя. Правила, палитры и примеры — skill_load pixel-art.',
          schema: { type: 'object', properties: {
              path: str('куда записать, например assets/hero.png'), palette: { type: 'object', description: 'символ → "#rrggbb" | null' },
              rows: { type: 'array', items: { type: 'string' }, description: 'строки-пиксели' }, frames: { type: 'array', description: 'кадры анимации: [{rows:[…]}, …]' },
              size: { type: 'array', items: { type: 'number' }, description: '[w, h] пустого холста' }, ops: { type: 'array', items: { type: 'object' }, description: 'операции рисования' },
              base: str('PNG проекта для правки (обычно тот же path)'), scale: { type: 'number', description: 'целое 1–16' },
              overwrite: { type: 'boolean', description: 'перезаписать существующий файл (откат невозможен)' },
              atlas: { type: 'object', description: 'для листа frames: создать .atlas.json, например {"tags":"idle:0-1"}' } }, required: ['path'] },
          run: async (a) => {
              const p = safeRel(a.path);
              if (!/\.png$/i.test(p)) throw new Error('path должен оканчиваться на .png');
              const existed = host.exists(p);
              if (existed && !a.overwrite && a.base !== a.path) throw new Error('файл уже есть: чтобы поправить его, укажите base:"' + p + '", чтобы заменить — overwrite:true');
              const spec = { out: host.abs(p) };
              for (const k of ['palette', 'rows', 'frames', 'size', 'ops', 'scale']) if (a[k] !== undefined) spec[k] = a[k];
              if (a.base) spec.base = host.abs(safeRel(a.base));
              const prev = '.r2d-check/preview-' + (++previewSeq) + '.png';
              spec.preview = host.abs(prev);
              const old = '.r2d-check/preview-' + (previewSeq - 3) + '.png';
              if (host.remove && host.exists(old)) { try { host.remove(old); } catch (_) { /* не критично */ } }
              host.writeText('.r2d-check/pixel.json', JSON.stringify(spec));
              const r = (await host.tool(['pixel-art', host.abs('.r2d-check/pixel.json')])).json;
              if (!r || !r.ok) throw new Error(r ? (r.message || r.code) : 'pixel-art не ответил');
              if (!existed) history.push({ items: [{ path: p, before: null }] });
              let atlasNote = '';
              if (a.atlas && r.frames) {
                  const atlasPath = p.replace(/\.png$/i, '.atlas.json');
                  const args = ['atlas-grid', host.abs(p), '--out', host.abs(atlasPath), '--cols', String(r.frames), '--rows', '1'];
                  if (a.atlas.tags) args.push('--tags', String(a.atlas.tags));
                  const ar = (await host.tool(args)).json;
                  if (ar && ar.ok !== false) { atlasNote = '\nатлас: ' + atlasPath; if (host.exists(atlasPath)) history.push({ items: [{ path: atlasPath, before: null }] }); } else atlasNote = '\nатлас не создан: ' + String(ar && ar.error || '').slice(0, 120);
              }
              return pixelReport(p, r, existed && !a.base) + atlasNote + '\n[preview: ' + host.abs(prev) + ']';
          } },
        { name: 'pixel_preview', description: 'Посмотреть существующий PNG-спрайт проекта: ASCII-срез (какие цвета где) и крупное превью. Нужен перед правкой чужого или прошлого спрайта.',
          schema: obj({ path: str('PNG проекта, например assets/hero.png') }),
          run: async (a) => {
              const p = safeRel(a.path);
              if (!host.exists(p)) throw new Error('нет файла ' + p);
              const prev = '.r2d-check/preview-' + (++previewSeq) + '.png';
              const old = '.r2d-check/preview-' + (previewSeq - 3) + '.png';
              if (host.remove && host.exists(old)) { try { host.remove(old); } catch (_) { /* не критично */ } }
              host.writeText('.r2d-check/pixel.json', JSON.stringify({ base: host.abs(p), preview: host.abs(prev) }));
              const r = (await host.tool(['pixel-art', host.abs('.r2d-check/pixel.json')])).json;
              if (!r || !r.ok) throw new Error(r ? (r.message || r.code) : 'pixel-art не ответил');
              return pixelReport(p, r, false) + '\n[preview: ' + host.abs(prev) + ']';
          } },
        { name: 'generate_sound', mutating: true,
          description: 'Сгенерировать звуковой эффект и записать WAV в проект (требует подтверждения): описание словами или пресет → дескриптор R2D SFX → процедурный синтез. text — словами («короткий высокий прыжок», «big explosion»; распознаёт монету, выстрел/лазер, взрыв, бонус, удар/урон, прыжок, клик) или preset: coin, laser, explosion, powerup, hurt, jump, blip, random. seed — другой вариант того же звука; mutate 0..1 — вариация; params — точная подстройка полей (wave: square|saw|sine|noise, freq, decay, slide…; skill_load generate-sound). Вернёт длительность, пик, высоту тона и ASCII-огибающую: по ним видно, что получилось, без слуха. Играть: `$.sound.play("assets/sfx/x.wav")`.',
          schema: { type: 'object', properties: {
              path: str('куда записать, например assets/sfx/jump.wav'), text: str('описание звука словами'), preset: str('coin | laser | explosion | powerup | hurt | jump | blip | random'),
              seed: { type: 'number', description: 'вариант звука' }, mutate: { type: 'number', description: 'случайная вариация 0..1' },
              params: { type: 'object', description: 'поля дескриптора поверх пресета: wave, attack, sustain, punch, decay, freq, minFreq, slide, deltaSlide, vibratoDepth, vibratoSpeed, changeAmount, changeSpeed, duty, dutySweep, repeat, phaserOffset, phaserSweep, lpf, lpfSweep, lpfResonance, hpf, hpfSweep, volume' },
              overwrite: { type: 'boolean', description: 'заменить существующий файл (откат невозможен)' } }, required: ['path'] },
          run: async (a) => {
              const p = safeRel(a.path);
              if (!/\.wav$/i.test(p)) throw new Error('path должен оканчиваться на .wav');
              const existed = host.exists(p);
              if (existed && !a.overwrite) throw new Error('файл уже есть: чтобы заменить, укажите overwrite:true (откат тогда невозможен) или другое имя');
              if (!a.text && !a.preset && !a.params) throw new Error('нужен text (описание словами), preset или params');
              const spec = { out: host.abs(p) };
              for (const k of ['text', 'preset', 'seed', 'mutate', 'params']) if (a[k] !== undefined) spec[k] = a[k];
              host.writeText('.r2d-check/sfx.json', JSON.stringify(spec));
              const r = (await host.tool(['sfx-gen', host.abs('.r2d-check/sfx.json')])).json;
              if (!r || !r.ok) throw new Error(r ? (r.message || r.code) : 'sfx-gen не ответил');
              if (!existed) history.push({ items: [{ path: p, before: null }] });
              const pr = r.params || {};
              const set = Object.entries(pr).filter(([k, v]) => k === 'wave' || (typeof v === 'number' && v !== 0 && k !== 'seed')).map(([k, v]) => k + '=' + v).join(' ');
              const warn = [];
              if (r.clipped > 0) warn.push('есть срез (clipped ' + r.clipped + ') — уменьши params.volume');
              if (r.seconds < 0.05) warn.push('звук короче 50 мс — увеличь sustain/decay');
              if (r.peak < 0.1) warn.push('очень тихо — подними params.volume или punch');
              return 'звук ' + p + ' (' + r.preset + ', seed ' + pr.seed + '): ' + r.seconds + ' с, пик ' + r.peak + ', rms ' + r.rms + (r.pitchHz ? ', тон ≈ ' + r.pitchHz + ' Гц' : '') + (existed ? ' (файл перезаписан, откат недоступен)' : '') +
                  '\nогибающая (слева направо — время, высота — громкость):\n' + (r.envelope || []).join('\n') +
                  '\nдескриптор: ' + set + (warn.length ? '\nвнимание: ' + warn.join('; ') : '') +
                  '\nиграть: $.sound.play("' + p + '")';
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
        { name: 'playtest', serial: true, description: 'Сыграть в игру headless по сценарию и проверить состояние: steps — список шагов, выполняются по порядку; в шаге: hold:["D"] — зажать клавиши (hold:[] — отпустить), tap:"Space" — нажать, frames:N — прокрутить кадры, eval:"JS" — вычислить выражение в игре (например `JSON.stringify($("#hero").pos())`, `$("text").text()`). В конце снимок кадра (grid:true — ASCII-карта). Так проверяют управление, подбор предметов, счёт, границы мира.',
          schema: { type: 'object', properties: { steps: { type: 'array', items: { type: 'object', properties: { hold: { type: 'array', items: { type: 'string' } }, tap: str('клавиша'), frames: { type: 'number' }, eval: str('JS-выражение') } }, description: 'шаги сценария' }, scene: str('сцена (необязательно)'), grid: { type: 'boolean', description: 'ASCII-карта итогового кадра' } }, required: ['steps'] },
          run: async (a) => {
              if (!Array.isArray(a.steps) || !a.steps.length) throw new Error('steps — непустой массив');
              const dir = '.r2d-check', shot = host.abs(dir + '/frame.png');
              const reqs = [], evals = [];
              let frames = 0;
              a.steps.slice(0, 60).forEach((st, i) => {
                  if (Array.isArray(st.hold)) reqs.push({ cmd: 'keys', hold: st.hold.map(String) });
                  if (st.tap) reqs.push({ cmd: 'key', key: String(st.tap), action: 'tap' });
                  if (st.frames) { const n = Math.min(600, Math.max(1, Math.floor(Number(st.frames)))); frames += n; reqs.push({ cmd: 'step', frames: n }); }
                  if (st.eval) { evals.push({ step: i, code: String(st.eval), req: reqs.length }); reqs.push({ cmd: 'eval', code: String(st.eval) }); }
              });
              if (frames > 3000) throw new Error('слишком длинный сценарий: ' + frames + ' кадров (максимум 3000)');
              reqs.push({ cmd: 'screenshot', path: shot }, { cmd: 'quit' });
              const session = { version: 1, game: host.abs(''), seed: 1, timeoutMs: 120000, requests: reqs };
              if (a.scene) session.scene = String(a.scene);
              host.writeText(dir + '/playtest.json', JSON.stringify(session));
              const run = await host.tool(['agent', host.abs(dir + '/playtest.json')]);
              const rep = run.json || {};
              const resp = Array.isArray(rep.responses) ? rep.responses : [];
              const out = { evals: evals.map((e) => { const r = resp[e.req]; return { step: e.step, code: e.code.slice(0, 80), result: r && r.ok ? r.result : undefined, error: r && !r.ok ? String(r.error || 'ошибка').slice(0, 160) : undefined }; }), completed: rep.completed, failed: rep.failed, frames };
              if (!rep.ok && rep.diagnostics) out.diagnostics = rep.diagnostics.slice(0, 3).map((d) => d.message).join('; ').slice(0, 300);
              const stats = (await host.tool(['image-stats', shot, ...(a.grid ? ['--grid', '48x18'] : [])])).json;
              if (stats && stats.ok) { const { grid, ...rest } = stats; out.frame = rest.blank ? 'КАДР ПУСТОЙ' : 'кадр не пустой'; out.stats = { meanLuma: rest.meanLuma, distinctColors: rest.distinctColors, nonBackgroundFraction: rest.nonBackgroundFraction }; if (grid) out.ascii = grid; }
              return JSON.stringify(out);
          } },
        { name: 'screenshot_check', serial: true, description: 'Запустить игру headless на N кадров (можно с зажатыми клавишами), снять кадр и проверить его статистикой: blank:true — кадр пустой/одноцветный (чёрный экран!), иначе яркость, число цветов, доля не-фона. Вызывай после изменения сцены/графики; blank — значит искать причину (ошибка, не вызван render, камера, нет объектов).',
          schema: { type: 'object', properties: { frames: { type: 'number', description: 'кадров до снимка, по умолчанию 120' }, hold: { type: 'array', items: { type: 'string' }, description: 'клавиши, зажатые всё время, например ["D"] или ["W"]' }, scene: str('сцена (необязательно)'), grid: { type: 'boolean', description: 'добавить ASCII-карту кадра (48×18): видно, где на экране что нарисовано' } }, required: [] },
          run: async (a) => {
              const dir = '.r2d-check', shot = host.abs(dir + '/frame.png');
              const frames = Math.min(600, Math.max(10, Number(a.frames) || 120));
              const reqs = [];
              if (Array.isArray(a.hold) && a.hold.length) reqs.push({ cmd: 'keys', hold: a.hold.map(String) });
              reqs.push({ cmd: 'step', frames }, { cmd: 'screenshot', path: shot }, { cmd: 'quit' });
              const session = { version: 1, game: host.abs(''), seed: 1, timeoutMs: 90000, requests: reqs };
              if (a.scene) session.scene = String(a.scene);
              host.writeText(dir + '/session.json', JSON.stringify(session));
              const run = await host.tool(['agent', host.abs(dir + '/session.json')]);
              const stats = (await host.tool(['image-stats', shot, ...(a.grid ? ['--grid', '48x18'] : [])])).json;
              if (!stats || !stats.ok) return 'снимок не получен: ' + String((run.json && JSON.stringify(run.json.diagnostics || run.json).slice(0, 400)) || run.error || 'нет ответа');
              const { grid, ...rest } = stats;
              return (stats.blank ? 'КАДР ПУСТОЙ (одноцветный ' + stats.background + ')' : 'кадр не пустой') + ': ' + JSON.stringify(rest) + (grid ? '\nASCII-карта кадра (. пусто → @ плотно):\n' + grid.join('\n') : '');
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
    tools.history = history;
    return tools;
}
