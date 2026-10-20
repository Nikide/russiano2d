// Compatibility adapter for the old SDK shell. The controller is shared with
// Editor tabs; narrative execution remains in $.story / $.dialog.
import { create } from '../../editor/studios/narrative.js';

export const standalone = true;
let singleton = null;
export async function open(app, args) {
    if (!singleton) singleton = createLegacy(app);
    return singleton.open(args || {});
}

function createLegacy(app) {
    const $ = app.$;
    let inst = null, warned = false;
    const root = () => app.projectRoot || (app.state.project && app.state.project.abs) || $.fs.basePath();
    const panel = {
        async open(args) {
            if (inst) inst.close();
            inst = create({ $, document: $.ui.doc('sdk/ui/vn_maker.rml'), root,
                backend: (...args) => app.backend(...args), typing: () => $.ui.typing(), changed: () => {},
                status: (text, kind) => app.setStatus(text, kind === 'err' ? 'fail' : kind),
                openWith: (path, id) => id === 'narrative' ? panel.open({ assetAbs: path }) : app.openTool(id, { assetAbs: path, asset: path }),
                preview: () => inst.doc.hide(), closeTab: () => panel.close() });
            await inst.open(args.assetAbs || args.asset || null);
            inst.onActive(true); inst.doc.show();
            if (app.doc) app.doc.hide();
            app.studios['vn-maker'] = panel; warned = false;
            return panel;
        },
        close() {
            if (inst && inst.dirty() && !warned) { warned = true; app.setStatus('Не сохранено: закройте ещё раз для отмены правок', 'fail'); return false; }
            if (inst) inst.close();
            if (app.doc) app.doc.show();
            app.closeTool(); return true;
        },
        get state() { return inst && inst.state; },
        commands: () => inst.ops.listCommands(),
        preview: () => inst.preview(), diagnostics: () => inst.diagnostics(), snapshot: () => inst.snapshot(),
        save: () => inst.save(), undo: () => inst.undo(), redo: () => inst.redo(),
        render: () => inst.render(), stopPreview: () => inst.stopPreview(),
        listScenes: () => inst.state.scenes.slice(), listSpeakers: () => inst.state.speakers.slice(),
        listLabels: () => inst.ops.listCommands().filter((c) => c.kind === 'label').map((c) => c.text),
        listThemes: () => inst.state.themes.slice(),
    };
    for (const name of ['setSource', 'openScene', 'newScene', 'validate', 'select', 'insert', 'delete', 'move', 'duplicate',
        'search', 'playScene', 'playFromHere', 'saveSpeakers', 'selectSpeaker', 'saveCharacter', 'findAssets', 'pickAsset']) {
        panel[name] = (...args) => inst.ops[name](...args);
    }
    panel.update = () => inst.ops.applyInspector();
    $.update((dt) => {
        if (!inst || !inst.state.active) return;
        if (inst.state.preview) {
            if ($.input.rawPressed('escape') || !inst.previewRunning()) { inst.stopPreview(); inst.doc.show(); }
            return;
        }
        const mod = $.input.ctrlDown() || $.input.down('cmd') || $.input.down('rcmd');
        if (mod && !$.ui.typing()) {
            if ($.input.pressed('s')) inst.save();
            if ($.input.pressed('z')) { if ($.input.shiftDown()) inst.redo(); else inst.undo(); }
            if ($.input.pressed('y')) inst.redo();
        }
        inst.update(dt);
    });
    return panel;
}
