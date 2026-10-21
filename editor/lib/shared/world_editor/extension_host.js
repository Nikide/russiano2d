// ===========================================================================
// World Editor: хост расширений (декларативные contribution-точки).
//
// Источник — единый реестр SDK: createExtensionHost(app) из sdk/lib/extensions.js
// (app.extensions). Он читает native extension list (built-in/user/project) и
// регистрирует contributions без патчинга DOM и приватного состояния.
//
// Ожидаемая форма contribution (все поля необязательны кроме id/class):
//   entityDefinitions: {id, class, label|name, kind, fields[], defaults{}, brush?}
//   worldTools:        {id, label|name, tool?, op?, args?, argsFrom?}
//   inspectors:        {id, label, section}
//   validators:        {id, label, code, severity?, message?}
//   buildSteps:        {id, label, op?, args?}
//   agentCommands:     {id, label, description?, op, args?}
//   menus/toolbar:     {id, label, command, args?}
//   panels:            {id, label, fields?}
//   worldOverlays:     {id, label, visible?, shapes:[point|line|rect]}
//
// Всё, что расширение объявляет, редактор только показывает и вызывает через
// публичные ops; никакой произвольный код расширения не исполняется в UI.
// ===========================================================================

export const BASE_ENTITY_CLASSES = [
    { id: 'base.point', class: 'point', label: 'Точка', fields: ['kind', 'x', 'y', 'h', 'target', 'tags'] },
    { id: 'base.brush', class: 'brush', label: 'Brush-сущность', fields: ['kind', 'brush', 'target', 'tags'] },
    { id: 'base.volume', class: 'volume', label: 'Объём', fields: ['kind', 'brush', 'target', 'tags'] },
    { id: 'base.marker', class: 'marker', label: 'Маркер', fields: ['kind', 'x', 'y', 'h', 'tags'] },
];

// Точки, которые читает редактор. Остальные reestr-точки игнорируются.
export const CONTRIBUTION_KINDS = [
    'entityDefinitions', 'worldTools', 'inspectors', 'validators', 'buildSteps',
    'agentCommands', 'menus', 'toolbar', 'panels', 'worldOverlays', 'contextActions',
];

function rawList(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.extensions)) return raw.extensions;
    if (Array.isArray(raw.items)) return raw.items;
    if (typeof raw === 'object') {
        return Object.keys(raw)
            .filter((key) => raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key]))
            .map((key) => Object.assign({ id: key }, raw[key]));
    }
    return [];
}

function normalizeItem(kind, raw, extension) {
    if (!raw || typeof raw !== 'object') return null;
    const item = Object.assign({}, raw);
    item.id = String(item.id || item.class || '');
    if (!item.id) return null;
    if (!item.label) item.label = String(item.name || item.title || item.id);
    if (!item.extension) item.extension = extension || null;
    if (kind === 'entityDefinitions') {
        if (!item.class) item.class = item.id;
        if (!Array.isArray(item.fields)) item.fields = ['kind', 'x', 'y', 'h'];
    }
    return item;
}

export function createWorldExtensionHost(app) {
    const state = { scanned: [], diagnostics: [] };

    function registry() {
        return app && app.extensions && typeof app.extensions.list === 'function' ? app.extensions : null;
    }

    function list(kind) {
        const reg = registry();
        const out = [];
        const seen = new Set();
        if (reg) {
            let items = [];
            try { items = reg.list(kind) || []; } catch (e) { items = []; }
            for (const raw of items) {
                const item = normalizeItem(kind, raw, raw && raw.extension);
                if (!item || seen.has(item.id)) continue;
                seen.add(item.id);
                out.push(item);
            }
        } else {
            // Запасной путь, если реестр ещё не подключён к app: принять
            // декларативный снимок app.extensions напрямую.
            const raw = app ? app.extensions : null;
            const source = raw && !Array.isArray(raw) ? (raw.contributes || raw) : raw;
            const items = source && source[kind] ? source[kind] : [];
            for (const value of (Array.isArray(items) ? items : [])) {
                const item = normalizeItem(kind, value, null);
                if (!item || seen.has(item.id)) continue;
                seen.add(item.id);
                out.push(item);
            }
        }
        return out;
    }

    function entities() {
        const out = BASE_ENTITY_CLASSES.map((v) => Object.assign({}, v));
        const seen = new Set(out.map((v) => v.id));
        for (const def of list('entityDefinitions')) {
            if (seen.has(def.id)) continue;
            seen.add(def.id);
            out.push(def);
        }
        return out;
    }

    function ids() {
        const reg = registry();
        if (reg && typeof reg.extensions === 'function') {
            return (reg.extensions() || []).map((e) => String(e && e.id)).filter(Boolean).sort();
        }
        const raw = rawList(app ? app.extensions : null);
        return raw.map((e) => String(e && e.id)).filter(Boolean).sort();
    }

    function diagnostics() {
        const reg = registry();
        if (reg && typeof reg.diagnostics === 'function') {
            try { return reg.diagnostics() || []; } catch (e) { return []; }
        }
        return state.diagnostics.slice();
    }

    function snapshot() {
        const contributions = {};
        for (const kind of CONTRIBUTION_KINDS) contributions[kind] = list(kind).length;
        return { extensions: ids(), contributions: contributions, diagnostics: diagnostics().map((d) => ({ code: d.code, severity: d.severity, message: d.message })) };
    }

    function findCommand(name) {
        for (const cmd of list('agentCommands')) {
            if (String(cmd.id) === String(name) || String(cmd.name) === String(name)) return cmd;
        }
        return null;
    }

    return {
        state, list, entities, ids, diagnostics, snapshot, findCommand,
        entityDefinitions: entities,
        worldTools: () => list('worldTools'),
        inspectors: () => list('inspectors'),
        validators: () => list('validators'),
        buildSteps: () => list('buildSteps'),
        agentCommands: () => list('agentCommands'),
        menus: () => list('menus'),
        toolbar: () => list('toolbar'),
        panels: () => list('panels'),
        overlays: () => list('worldOverlays'),
        contextActions: () => list('contextActions'),
    };
}
