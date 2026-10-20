// Compatibility entry for the old SDK shell. Hammer's controller and document
// lifecycle live in editor/studios/hammer.js; there is one implementation.
import { create } from '../../editor/studios/hammer.js';

export const standalone = true;
let singleton = null;
export async function open(app, args) {
    if (!singleton) singleton = createEditor(app);
    return singleton.open(args || {});
}

export function createEditor(app) {
    const $ = app.$;
    let inst = null;
    const host = {
        $, document: null,
        root: () => app.projectRoot || (app.state.project && app.state.project.abs) || $.fs.basePath(),
        backend: (...args) => app.backend(...args),
        run: (opts) => app.runProject(opts),
        stop: () => app.stopProject && app.stopProject(),
        extensions: app.extensions,
        typing: () => $.ui.typing(),
        status: (text, kind) => app.setStatus && app.setStatus(text, kind === 'err' ? 'fail' : kind),
        changed: () => {},
        closeTab: () => api.close(),
        openWith: (path, id) => id === 'hammer' ? api.open({ assetAbs: path }) : app.openTool(id, { assetAbs: path }),
    };
    const api = {
        id: 'world-editor',
        async open(args) {
            if (inst) inst.close();
            host.document = $.ui.doc((app.layouts && app.layouts.world) || 'sdk/ui/world_editor.rml');
            inst = create(host);
            await inst.open(args.assetAbs || args.asset || null);
            if (app.doc) app.doc.hide();
            inst.doc.on('we-open-re2d-world','click',()=>app.openTool('re2d-world-studio',{assetAbs:inst.session.state.path}));
            inst.doc.on('we-new', 'click', () => {
                inst.session.newMap(); inst.selection.clear(); inst.state.fitted = false; inst.render();
            });
            inst.doc.show(); inst.onActive(true);
            if (app.recovery) app.recovery.watch(inst.session.state.path, inst.map, inst.session.state.history, () => inst.render());
            app.studios.world = api;
            return { id: 'world-editor', world: api };
        },
        close() {
            if (inst) inst.close();
            if (app.doc) app.doc.show();
            app.closeTool();
            return true;
        },
        snapshot() {
            const snap = inst.snapshot();
            snap.map=Object.fromEntries(['brushes','entities','paths','visgroups'].map(key=>[key,snap.map[key]]));
            delete snap.preview; // Existing SDK agent contract stays stable.
            return snap;
        },
    };
    for (const name of ['state', 'active', 'session', 'map', 'selection', 'viewports', 'extensions', 'ops']) {
        Object.defineProperty(api, name, { get: () => inst && inst[name] });
    }
    Object.defineProperty(api, 'commands', { get: () => inst && inst.operationCommands });
    for (const name of ['select', 'focusSelection', 'setTool', 'render', 'setStatus', 'note', 'diagnostics', 'capabilities',
        'createBrush', 'deleteSelection', 'duplicateSelection', 'moveSelection', 'resizeSelection', 'setGrid',
        'setFaceMaterial', 'setTags', 'createEntity', 'connectPath', 'setPathFields', 'validate', 'compile',
        'buildAndRun', 'setWorld', 'createPath', 'addPathNode', 'movePathNode', 'deletePathNode', 'ensureVisgroup',
        'setVisgroupState', 'applyInspector', 'vertexMove', 'clip', 'rotateSelection', 'runExtensionCommand']) {
        api[name] = (...args) => inst[name](...args);
    }
    api.save = () => inst.ops.save();
    api.capabilities = () => Object.assign({}, inst.capabilities(), { snapshot: 'studios.world.snapshot()' });
    $.update((dt) => {
        if (!inst || !inst.active) return;
        const mod = $.input.ctrlDown() || $.input.down('cmd') || $.input.down('rcmd');
        if (mod && !$.ui.typing()) {
            if ($.input.pressed('z')) { if ($.input.shiftDown()) inst.redo(); else inst.undo(); }
            if ($.input.pressed('y')) inst.redo();
            if ($.input.pressed('s')) inst.save();
        }
        inst.update(dt);
    });
    return api;
}
