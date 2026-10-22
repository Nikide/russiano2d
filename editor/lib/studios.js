// ===========================================================================
// Студии во вкладках Editor (editor/studios, каркас — studio_kit.js). Каждая
// вкладка — свой экземпляр `create(host)` со своим документом и историей.
// Editor размещает документ, зовёт update(dt) только у активной вкладки и
// ведёт сохранение, историю, Problems и палитру через контракт студии.
// ===========================================================================

import { nativeFor, nativeById, nativeAlso } from '../studios/index.js';

// Старые id студий SDK (ссылки, recents, «Открыть как…») → студии Editor.
const ALIASES = { 'sprite-studio': 'atlas', 'animation-studio': 'atlas', 'world-editor': 'hammer', 're2d-world-studio': 'hammer', 'vn-maker': 'narrative', 'vn-narrative': 'narrative', 'sprite-mesh-studio': 'sprite-mesh', 'tilemap-studio': 'tilemap', 'particle-studio': 'particles', 'collision-tools': 'collision', 'parallax-tools': 'parallax', 'font-tools': 'fonts', 'audio-tools': 'audio', 'input-tools': 'input', 're2dsprite-studio': 're2dsprite', 'rmlui-studio': 'rmlui' };

export function studioFor(path) { return nativeFor(path); }
export function studioById(id) { return nativeById(ALIASES[id] || id); }
// Студии, в которых можно открыть файл (по умолчанию первой — основная).
export function studiosFor(path) { return nativeAlso(String(path || '')); }

export function createStudioHost($, editor) {
    // Хост студии: всё, что ей можно знать о редакторе.
    let hostCounter = 0;
    function hostFor(tab) {
        return {
            $, id: ++hostCounter, models: editor.models,
            root: () => editor.projectRoot(),
            async backend(args) {
                const res = await $.sdk.tool(args);
                if (!res.json) editor.log('r2d ' + args[0] + ': backend не вернул JSON — ' + (res.error || ''));
                return { ok: res.ok, json: res.json, output: res.output };
            },
            run: (opts) => editor.run(opts),
            stop: () => editor.stop(),
            status: (text, kind) => editor.setStatus(text, kind || ''),
            log: (text) => editor.log(text),
            changed: () => editor.changed(tab),
            openWith: (path, id) => editor.openWith(path, id),
            typing: () => editor.typing(),
            preview: () => editor.fullPreview(tab),
            extensions: editor.extensions,
            graphInfo: () => editor.graphInfo(), reindex: () => editor.reindex(), migrate: () => editor.migrate(), projectChanged: () => editor.projectChanged(),
        };
    }

    async function open(tab) {
        const inst = tab.studio.module.create(hostFor(tab));
        tab.inst = inst;
        try { await inst.open(tab.abs); }
        catch (e) { if (inst.close) inst.close(); tab.inst = null; throw e; }
        if (tab.inst !== inst) return null; // вкладку закрыли, пока open() ждал
        tab.api = inst;
        return inst;
    }

    const live = (tab) => !!(tab && tab.inst && tab.api);

    function setActive(tab, on) {
        if (!live(tab)) return;
        if (on) { tab.inst.doc.show(); tab.inst.doc.front(); } else tab.inst.doc.hide();
        if (tab.inst.onActive) tab.inst.onActive(on);
    }

    function place(tab, rect) {
        if (!live(tab) || !rect) return;
        const key = rect.x + ',' + rect.y + ',' + rect.w + ',' + rect.h;
        if (tab.placed !== key) {
            tab.placed = key;
            tab.inst.doc.place(rect);
            // RmlUi пересчитает раскладку только в следующем обновлении: студия
            // читает геометрию своих элементов, поэтому layout() — через кадр.
            tab.refit = 2;
            return;
        }
        if (tab.refit > 0 && --tab.refit === 0 && tab.inst.layout) tab.inst.layout();
    }

    function close(tab) {
        if (!tab || !tab.inst) return;
        tab.inst.close();
        tab.inst = null;
        tab.api = null;
    }

    function snapshot(tab) { try { return live(tab) && tab.inst.snapshot ? tab.inst.snapshot() : null; } catch (e) { return null; } }
    function diagnostics(tab) { try { return live(tab) && tab.inst.diagnostics ? (tab.inst.diagnostics() || []) : []; } catch (e) { return []; } }
    function front(tab) { if (live(tab)) tab.inst.doc.front(); }
    function summary(tab) { return tab && tab.studio.summary ? tab.studio.summary(snapshot(tab)) : []; }
    function show(tab, on) { if (live(tab)) { if (on) tab.inst.doc.show(); else tab.inst.doc.hide(); } }
    function update(tab, dt) { if (live(tab) && tab.inst.update) tab.inst.update(dt); }
    async function save(tab) { return live(tab) && tab.inst.save ? !!(await tab.inst.save()) : false; }
    function dirty(tab) { return !!(tab && tab.inst && tab.inst.dirty && tab.inst.dirty()); }
    function undo(tab) { return live(tab) && tab.inst.undo ? tab.inst.undo() : false; }
    function redo(tab) { return live(tab) && tab.inst.redo ? tab.inst.redo() : false; }
    function commands(tab) { return live(tab) && tab.inst.commands ? tab.inst.commands() : []; }

    return { open, setActive, place, close, snapshot, diagnostics, front, summary, show, update, save, dirty, undo, redo, commands, studioFor, studioById, studiosFor };
}
