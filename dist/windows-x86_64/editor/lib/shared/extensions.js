// ===========================================================================
// Единый JS-хост расширений для Editor и legacy SDK shell (docs/SDK_EXTENSIONS.md).
//
// Native discovery/манифесты/merged registry живут в sdk/native/sdk_extension.c.
// Здесь — только JS-сторона: динамический импорт entry расширения через
// зарегистрированный корень модулей ($.sdk.moduleRoot) и ЕДИНЫЙ реестр
// contribution-точек. Расширение не патчит DOM и приватное состояние: оно
// получает декларативные register*-функции и контекст { $, app, sdk, manifest }.
//
// Ошибка одного расширения изолирована: SDK_EXTENSION_INIT_FAILED + остальные
// инструменты продолжают работать (failure isolation, §29).
//
// Форма снимка extension из native (extension list / tools):
//   { id, name, version, scope, root, manifest, sdk_api, valid, enabled,
//     standalone, permissions[], contributes{tools,menus,…}, toolIds[],
//     module, contributesJson }
// ===========================================================================

// contribution-точка → ключ в state.registries
const KINDS = {
    menus: 'menus',
    toolbar: 'toolbar',
    panels: 'panels',
    inspectors: 'inspectors',
    entityDefinitions: 'entityDefinitions',
    worldTools: 'worldTools',
    worldOverlays: 'worldOverlays',
    validators: 'validators',
    buildSteps: 'buildSteps',
    agentCommands: 'agentCommands',
    contextActions: 'contextActions',
};

const KIND_API = {
    menus: 'registerMenu',
    toolbar: 'registerToolbar',
    panels: 'registerPanel',
    inspectors: 'registerInspectorSection',
    entityDefinitions: 'registerEntityType',
    worldTools: 'registerWorldTool',
    worldOverlays: 'registerWorldOverlay',
    validators: 'registerValidator',
    buildSteps: 'registerBuildStep',
    agentCommands: 'registerAgentCommand',
    contextActions: 'registerContextAction',
};

export function createExtensionHost(app) {
    const $ = app.$;
    const state = {
        loaded: false,
        list: [],
        diagnostics: [],
        registries: {},
        modules: new Map(),
    };
    for (const kind of Object.keys(KINDS)) state.registries[kind] = new Map();
    let current = null;    // id расширения, чей activate сейчас выполняется

    function note(severity, code, message, extra) {
        const d = Object.assign({ code, severity, asset: current ? current : null,
            location: null, message, details: null }, extra || {});
        state.diagnostics.push(d);
        if (app.addDiagnostic) app.addDiagnostic(severity, code, message, extra || {});
        return d;
    }

    function itemId(kind, item) {
        if (!item || typeof item !== 'object') return '';
        return String(item.id || item.class || '');
    }

    // Одна проверка для всех точек: namespaced id, без silent override.
    function register(kind, item) {
        const map = state.registries[kind];
        if (!map) { note('error', 'SDK_EXTENSION_CONTRIBUTION_INVALID', 'Неизвестная точка расширения: ' + kind); return null; }
        if (!item || typeof item !== 'object') {
            note('error', 'SDK_EXTENSION_CONTRIBUTION_INVALID', kind + ': contribution должен быть объектом', { details: { kind } });
            return null;
        }
        const id = itemId(kind, item);
        if (!id) {
            note('error', 'SDK_EXTENSION_CONTRIBUTION_INVALID', kind + ': обязателен id (или class)', { details: { kind } });
            return null;
        }
        if (map.has(id)) {
            note('error', 'SDK_EXTENSION_DUPLICATE_ID', kind + ': id «' + id + '» уже занят — silent override запрещён', { details: { kind, id, extension: current } });
            return null;
        }
        const entry = Object.assign({}, item, { extension: current || item.extension || null, id });
        Object.freeze(entry);
        map.set(id, entry);
        return entry;
    }

    const api = {
        state,
        diagnostics() { return state.diagnostics.slice(); },
        list(kind) { const m = state.registries[kind]; return m ? [...m.values()] : []; },
        get(kind, id) { const m = state.registries[kind]; return m ? m.get(id) || null : null; },
        extensions() { return state.list.slice(); },
        snapshot() {
            const contributions = {};
            for (const kind of Object.keys(KINDS)) contributions[kind] = state.registries[kind].size;
            return {
                loaded: state.loaded,
                extensions: state.list.map((e) => ({
                    id: e.id, name: e.name, version: e.version, scope: e.scope,
                    enabled: !!e.enabled, valid: !!e.valid, standalone: !!e.standalone,
                })),
                contributions,
                diagnostics: state.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: d.message })),
            };
        },
    };
    for (const [kind, fn] of Object.entries(KIND_API)) {
        api[fn] = (item) => register(kind, item);
    }
    // Единая точка для расширений, которые регистрируют данные из кода.
    api.register = register;

    function clear() {
        for (const kind of Object.keys(KINDS)) state.registries[kind].clear();
        state.diagnostics = [];
        state.modules.clear();
        current = null;
    }

    function disableExtension(extensionId) {
        for (const kind of Object.keys(KINDS)) {
            const registry = state.registries[kind];
            for (const [id, item] of registry) {
                if (item && item.extension === extensionId) registry.delete(id);
            }
        }
        const extension = state.list.find((item) => item && item.id === extensionId);
        if (extension) extension.enabled = false;
    }

    function contributionsOf(e) {
        if (!e || !e.contributesJson) return null;
        try {
            const parsed = typeof e.contributesJson === 'string' ? JSON.parse(e.contributesJson) : e.contributesJson;
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (err) {
            note('error', 'SDK_EXTENSION_CONTRIBUTION_INVALID', 'contributes расширения «' + e.id + '» — не JSON: ' + (err && err.message ? err.message : err));
            return null;
        }
    }

    // Декларативные contributions исполняются до activate: activate может на них
    // ссылаться (например, world tool по entity definition).
    function registerDeclared(e) {
        const contributes = contributionsOf(e);
        if (!contributes) return;
        for (const kind of Object.keys(KINDS)) {
            const list = contributes[kind];
            if (!Array.isArray(list)) continue;
            for (const item of list) register(kind, item);
        }
    }

    async function activateOne(e) {
        current = e.id;
        registerDeclared(e);
        if (!e.module) { current = null; return; }
        if (!$.sdk || typeof $.sdk.moduleRoot !== 'function') {
            note('error', 'SDK_EXTENSION_INIT_FAILED', 'мост $.sdk недоступен: JS расширения не загрузить', { asset: e.id });
            current = null;
            return;
        }
        if (!$.sdk.moduleRoot(e.id, e.root)) {
            note('error', 'SDK_EXTENSION_INIT_FAILED', 'не удалось зарегистрировать корень модулей расширения', { asset: e.id, details: { root: e.root } });
            current = null;
            return;
        }
        try {
            const mod = await import(e.module);
            state.modules.set(e.id, mod);
            const activate = mod && (mod.activate || mod.default);
            if (typeof activate === 'function') {
                const result = await activate({ $, app, sdk: api, manifest: e });
                if (result && result.ok === false) {
                    throw new Error(result.message || 'activate() вернул ok=false');
                }
            }
        } catch (err) {
            const message = err && err.message ? err.message : String(err);
            disableExtension(e.id);
            note('error', 'SDK_EXTENSION_INIT_FAILED', 'расширение «' + e.id + '» не загрузилось: ' + message,
                { asset: e.id, details: { module: e.module, root: e.root } });
        } finally {
            current = null;
        }
    }

    /** Применить снимок расширений из native (tools/extension list). */
    api.apply = async function apply(list) {
        clear();
        state.list = Array.isArray(list) ? list.slice() : [];
        state.loaded = true;
        // Детерминированно: native уже отдаёт built-in → user → project.
        for (const e of state.list) {
            if (!e || !e.enabled) continue;
            await activateOne(e);
        }
        return api;
    };

    return api;
}
