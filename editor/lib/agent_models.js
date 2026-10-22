// ===========================================================================
// Модели агента: какие провайдеры подключены, их адрес/модель/ключ и активный выбор.
// Хранилище общее для вкладки «Модели» (editor/studios/models.js) и панели «Агент».
//
// На диск (agent.local.json рядом с state.local.json, в .gitignore) пишутся: активный провайдер,
// адрес и модель каждого, свои провайдеры, шаги и маскот. Ключ — только если для провайдера
// включено «запомнить на этом компьютере» (по умолчанию ключи живут в памяти Editor).
// ===========================================================================

import { PROVIDERS, testConnection } from './agent_harness.js';

const FILE = 'agent.local.json';
const PROTOCOLS = { openai: 'OpenAI Chat Completions', anthropic: 'Anthropic Messages' };
export const PROTOCOL_LABELS = PROTOCOLS;

// Короткие пояснения встроенных провайдеров для списка.
const DESCRIPTIONS = {
    anthropic: 'Claude, Messages API', openai: 'llama-server, Ollama, LM Studio и другие', opencode: 'подписка OpenCode Go, много моделей',
    deepseek: 'deepseek-flash, v4-pro', inception: 'Mercury, диффузионная модель', yandex: 'Yandex Cloud, ключ Api-Key', gigachat: 'Сбер, токен по ключу авторизации',
};
// Провайдеры, которым ключ не обязателен (локальные серверы).
const KEYLESS = new Set(['openai']);

export function validCustomId(id, taken) {
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(String(id || ''))) return 'ID: строчные латинские буквы, цифры и «-», начинается с буквы (2–32 символа)';
    if (taken && taken.includes(id)) return 'провайдер «' + id + '» уже есть';
    return '';
}

export function httpTransport($) {
    return (url, opts) => (opts.method === 'GET' ? $.http.get(url, { headers: opts.headers, timeout: opts.timeout, ca: opts.ca }) : $.http.post(url, opts.body, { headers: opts.headers, timeout: opts.timeout, ca: opts.ca })).then((res) => {
        let json = null;
        try { json = res.json(); } catch (_) { json = null; }
        return { ok: res.ok, status: res.status, json, text: res.body };
    });
}

/** persist: { read() → object|null, write(object) }; в тестах — подставной. */
export function createModelStore(persist) {
    const builtin = Object.keys(PROVIDERS).filter((id) => !PROVIDERS[id].custom);
    const st = { active: 'anthropic', profiles: {}, custom: [], maxSteps: 24, mascotOn: true, autoApprove: false, listeners: [] };

    const defaults = (id) => ({ base: PROVIDERS[id].base, model: PROVIDERS[id].model, key: '', remember: false, folder: '', models: [], modelsAt: 0 });
    const profile = (id) => {
        if (!PROVIDERS[id]) throw new Error('нет провайдера «' + id + '»');
        if (!st.profiles[id]) st.profiles[id] = defaults(id);
        return st.profiles[id];
    };
    const notify = () => { for (const f of st.listeners) { try { f(); } catch (_) { /* слушатель не должен ломать хранилище */ } } };

    function register(def) {
        PROVIDERS[def.id] = { label: def.label, protocol: def.protocol, auth: def.protocol === 'anthropic' ? 'x-api-key' : 'bearer', base: def.base, model: def.model, custom: true };
    }

    function load() {
        let data = null;
        try { data = persist.read(); } catch (_) { data = null; }
        if (!data || typeof data !== 'object') return;
        for (const c of Array.isArray(data.custom) ? data.custom : []) {
            if (c && !validCustomId(c.id, builtin) && PROTOCOLS[c.protocol]) { st.custom.push({ id: c.id, label: String(c.label || c.id), protocol: c.protocol, base: String(c.base || ''), model: String(c.model || '') }); register(st.custom[st.custom.length - 1]); }
        }
        const profiles = data.profiles && typeof data.profiles === 'object' ? data.profiles : {};
        for (const id of Object.keys(profiles)) {
            if (!PROVIDERS[id] || !profiles[id] || typeof profiles[id] !== 'object') continue;
            const p = profile(id), src = profiles[id];
            if (typeof src.base === 'string' && src.base) p.base = src.base;
            if (typeof src.model === 'string' && src.model) p.model = src.model;
            if (typeof src.folder === 'string') p.folder = src.folder;
            if (Array.isArray(src.models)) { p.models = src.models.filter((m) => typeof m === 'string').slice(0, 200); p.modelsAt = Number(src.modelsAt) || 0; }
            if (src.remember === true) { p.remember = true; if (typeof src.key === 'string') p.key = src.key; }
        }
        // файл первой версии: один активный провайдер без профилей
        if (data.version === 1 && PROVIDERS[data.provider] && !profiles[data.provider]) {
            const p = profile(data.provider);
            if (typeof data.base === 'string' && data.base) p.base = data.base;
            if (typeof data.model === 'string' && data.model) p.model = data.model;
        }
        if (PROVIDERS[data.provider || data.active]) st.active = data.provider || data.active;
        if (data.maxSteps >= 1 && data.maxSteps <= 100) st.maxSteps = data.maxSteps | 0;
        if (typeof data.mascotOn === 'boolean') st.mascotOn = data.mascotOn;
        if (typeof data.autoApprove === 'boolean') st.autoApprove = data.autoApprove;
    }

    function save() {
        const profiles = {};
        for (const id of Object.keys(st.profiles)) {
            const p = st.profiles[id];
            profiles[id] = { base: p.base, model: p.model, remember: !!p.remember, ...(p.models.length ? { models: p.models, modelsAt: p.modelsAt } : {}), ...(p.folder ? { folder: p.folder } : {}), ...(p.remember && p.key ? { key: p.key } : {}) };
        }
        try { persist.write({ version: 2, active: st.active, profiles, custom: st.custom, maxSteps: st.maxSteps, mascotOn: st.mascotOn, autoApprove: st.autoApprove }); } catch (_) { /* настройки не критичны */ }
    }

    const api = {
        state: st,
        load,
        save,
        onChange(f) { st.listeners.push(f); },
        profile,
        spec: (id) => PROVIDERS[id],
        describe: (id) => (PROVIDERS[id].custom ? PROTOCOLS[PROVIDERS[id].protocol] : DESCRIPTIONS[id] || ''),
        /** Подключён ли провайдер: есть ключ или он не нужен. */
        configured(id) { const p = profile(id); return !!p.key || KEYLESS.has(id); },
        /** Список для интерфейса. */
        list() {
            return Object.keys(PROVIDERS).map((id) => ({ id, label: PROVIDERS[id].label, desc: api.describe(id), custom: !!PROVIDERS[id].custom, configured: api.configured(id), active: st.active === id, model: profile(id).model }));
        },
        /** Конфиг для createAgent / testConnection. */
        cfg() {
            const p = profile(st.active);
            const c = { provider: st.active, base: p.base, model: p.model, key: p.key, folder: p.folder, maxSteps: st.maxSteps, ...(PROVIDERS[st.active].custom ? { protocol: PROVIDERS[st.active].protocol, auth: PROVIDERS[st.active].auth } : {}) };
            // токен GigaChat кэшируется в профиле, а не в одноразовом конфиге
            Object.defineProperty(c, '_token', { get: () => p._token || null, set: (v) => { p._token = v; }, enumerable: false });
            return c;
        },
        set(id, patch) {
            const p = profile(id);
            for (const k of ['base', 'model', 'key', 'folder']) if (patch[k] !== undefined) { const v = String(patch[k]).trim(); if (k === 'key' && v !== p.key) p._token = null; p[k] = v; }
            if (patch.remember !== undefined) p.remember = !!patch.remember;
            save(); notify();
        },
        /** Список моделей провайдера: запросить, сохранить в профиле (и в agent.local.json). */
        async refreshModels(id, transport, now) {
            const list = await api.models(id, transport);
            const p = profile(id);
            p.models = list; p.modelsAt = (now || Date.now());
            save(); notify();
            return list;
        },
        /** Нужно ли обновлять список: ключ есть, список пуст или старше суток; GigaChat список не отдаёт. */
        needsModels(id, now) {
            const p = profile(id);
            if (PROVIDERS[id].protocol === 'gigachat' || !api.configured(id)) return false;
            return !p.models.length || ((now || Date.now()) - p.modelsAt) > 86400000;
        },
        activate(id) { profile(id); st.active = id; save(); notify(); },
        setBehavior({ maxSteps, mascotOn, autoApprove }) {
            if (maxSteps !== undefined) { const n = parseInt(maxSteps, 10); if (n >= 1 && n <= 100) st.maxSteps = n; }
            if (mascotOn !== undefined) st.mascotOn = !!mascotOn;
            if (autoApprove !== undefined) st.autoApprove = !!autoApprove;
            save(); notify();
        },
        addCustom(def) {
            const bad = validCustomId(def.id, Object.keys(PROVIDERS));
            if (bad) throw new Error(bad);
            if (!PROTOCOLS[def.protocol]) throw new Error('протокол: ' + Object.keys(PROTOCOLS).join(' | '));
            if (!/^https?:\/\/\S+$/.test(String(def.base || ''))) throw new Error('адрес API: http(s)://…');
            const c = { id: def.id, label: String(def.label || '').trim() || def.id, protocol: def.protocol, base: String(def.base).trim().replace(/\/+$/, ''), model: String(def.model || '').trim() };
            st.custom.push(c); register(c); profile(c.id);
            save(); notify();
            return c;
        },
        removeCustom(id) {
            const i = st.custom.findIndex((c) => c.id === id);
            if (i < 0) throw new Error('«' + id + '» — не свой провайдер');
            st.custom.splice(i, 1); delete PROVIDERS[id]; delete st.profiles[id];
            if (st.active === id) st.active = 'anthropic';
            save(); notify();
        },
        /** Проверка подключения активной или указанной настройки. */
        async test(id, transport) {
            const prev = st.active;
            st.active = id;
            const cfg = api.cfg();
            st.active = prev;
            return testConnection(cfg, transport);
        },
        /** Список моделей провайдера (GET {base}/models) → [id]. */
        async models(id, transport) {
            const cfg = (() => { const prev = st.active; st.active = id; const c = api.cfg(); st.active = prev; return c; })();
            const spec = PROVIDERS[id];
            const base = String(cfg.base || '').replace(/\/+$/, '');
            if (spec.protocol === 'gigachat') throw new Error('для GigaChat список моделей не запрашивается: введите GigaChat-2, GigaChat-2-Pro или GigaChat-2-Max');
            const headers = spec.protocol === 'anthropic' ? { 'x-api-key': cfg.key || '', 'anthropic-version': '2023-06-01' } : (cfg.key ? { authorization: /^Bearer\s/i.test(cfg.key) ? cfg.key : (spec.auth === 'api-key' ? 'Api-Key ' + cfg.key : 'Bearer ' + cfg.key) } : {});
            const url = spec.protocol === 'anthropic' ? base + '/v1/models' : base + '/models';
            const res = await transport(url, { headers, method: 'GET', timeout: 20000 });
            const list = res && res.json && (res.json.data || res.json.models);
            if (!res.ok || !Array.isArray(list)) throw new Error('провайдер не отдал список моделей (HTTP ' + (res && res.status) + ')');
            return list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean).slice(0, 200);
        },
    };
    return api;
}
