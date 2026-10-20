// ===========================================================================
// Студии во вкладках Editor. Существующие инструменты sdk/tools/*.js не
// переписываются: Editor даёт им тот же объект `app`, что давала оболочка SDK
// (backend → `r2d <команда>`, запуск игры, статус), и вписывает их RmlUi-документ
// в центральную область (doc.place). Пока вкладка не активна, документ скрыт,
// а студия поставлена на паузу (её кадровый ввод не работает).
// ===========================================================================

// Студия SDK со своей разметкой (sdk/ui/*.rml): Editor только вписывает её
// документ во вкладку и прячет кнопку «К SDK». Визуальные макеты Editor есть
// у Hammer, VN, SpriteMesh и Re2DSprite; остальные — в исходном виде.
function sdkStudio(id, title, match, doc, back, extra) {
    return Object.assign({ id, title, match, module: '../../sdk/tools/' + id + '.js', doc, hideIds: [back] }, extra || {});
}
const DATA = 'sdk/ui/data_studio.rml';
const dataStudio = (id, title, re) => sdkStudio(id, title, (p) => re.test(p), DATA, 'ds-back', { group: 'data', ownKeys: ['s', 'z', 'y'] });

import { nativeFor, nativeById, nativeAlso } from '../studios/index.js';

// Старые id студий SDK, которые заменили студии Editor.
const ALIASES = { 'sprite-studio': 'atlas', 'animation-studio': 'atlas', 'world-editor': 'hammer', 're2d-world-studio': 'hammer', 'vn-maker': 'narrative', 'vn-narrative': 'narrative', 'sprite-mesh-studio': 'sprite-mesh', 'tilemap-studio': 'tilemap', 'particle-studio': 'particles' };

const STUDIOS = [
    {
        id: 're2dsprite-studio',
        title: 'Re2DSprite',
        match: (p) => /\.character\.json$/i.test(p),
        module: '../studios/re2dsprite.js',
        doc: 'ui/re2dsprite.rml',
        ownKeys: ['s'],
        summary: (snap) => snap ? [
            ['Состояние', snap.dirty ? 'изменён, не сохранён' : 'сохранён'],
            ['Клип', snap.motion || '—'],
            ['Экипировка', snap.equipped.join(', ') || 'нет'],
        ] : [],
    },
    dataStudio('collision-tools', 'Collision', /\.collision\.json$/i),
    dataStudio('parallax-tools', 'Parallax', /\.layers\.json$/i),
    dataStudio('font-tools', 'Fonts', /\.fonts\.json$/i),
    dataStudio('audio-tools', 'Audio', /\.audio\.json$/i),
    dataStudio('input-tools', 'Input', /\.input\.json$/i),
    sdkStudio('rmlui-studio', 'RmlUi', (p) => /\.(rml|rcss)$/i.test(p), 'sdk/ui/rmlui_studio.rml', 'rm-back',
        { ownKeys: ['s', 'z', 'y'] }),
];

// Студии Editor (editor/studios) впереди старых модулей SDK.
export function studioFor(path) {
    return nativeFor(path) || STUDIOS.find((st) => st.match(String(path || ''))) || null;
}

export function studioById(id) {
    const key = ALIASES[id] || id;
    return nativeById(key) || STUDIOS.find((st) => st.id === key) || null;
}

// Студии, в которых можно открыть файл (по умолчанию первой — основная).
export function studiosFor(path) {
    const p = String(path || '');
    return nativeAlso(p).concat(STUDIOS.filter((st) => st.match(p) || (st.also && st.also(p))));
}

export function createStudioHost($, editor) {
    const modules = new Map();     // id студии → модуль
    const apis = new Map();        // id студии → фасад (одна сессия на студию)
    let closing = false;

    // Тот же контракт `app`, что у sdk/app.js, — ровно то, что студии читают.
    const app = {
        $,
        doc: null,                 // Editor не прячет свой документ при открытии студии
        studios: {},
        get projectRoot() { return editor.projectRoot(); },
        recovery: null,
        extensions: null,
        async backend(args, label) {
            try {
                const res = await $.sdk.tool(args);
                if (!res.json) editor.log((label || args[0]) + ': backend не вернул JSON — ' + (res.error || ''));
                return { ok: res.ok, json: res.json, raw: res };
            } catch (e) {
                editor.log((label || args[0]) + ': ' + (e && e.message ? e.message : e));
                return { ok: false, json: null, raw: null };
            }
        },
        runProject(opts) { return editor.run(opts); },
        setStatus(text, kind) { editor.setStatus(text, kind === 'fail' ? 'err' : ''); },
        openTool(id, args) {
            const st = studioById(id);
            const path = args && (args.assetAbs || args.asset);
            if (!st || !path) { editor.setStatus('студия «' + id + '» в Editor не встроена', 'err'); return null; }
            return editor.openWith(path, id);
        },
        get state() { return { project: editor.projectRoot() ? { abs: editor.projectRoot() } : null }; },
        closeTool() { if (!closing) editor.closeStudioTab(); },
    };

    async function load(studio) {
        if (!modules.has(studio.id)) modules.set(studio.id, await import(studio.module));
        return modules.get(studio.id);
    }

    function docOf(studio) { return $.ui.doc(studio.doc); }

    // Открыть файл в студии. Одна студия — один документ, поэтому вторая карта
    // того же типа заменяет первую (так же было в SDK); Editor держит одну вкладку.
    // Хост для студии Editor: всё, что ей можно знать о редакторе.
    let hostCounter = 0;
    function nativeHost(tab) {
        return {
            $, id: ++hostCounter,
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
        };
    }

    async function open(tab) {
        const studio = tab.studio;
        if (studio.native) {
            const inst = studio.module.create(nativeHost(tab));
            tab.inst = inst;
            try { await inst.open(tab.abs); }
            catch (e) { if (inst.close) inst.close(); tab.inst = null; throw e; }
            if (tab.inst !== inst) return null; // closed while open() was pending
            tab.api = inst;
            return inst;
        }
        const mod = await load(studio);
        const res = await mod.open(app, { asset: tab.path, assetAbs: tab.abs, tool: { id: studio.id } });
        const api = res && (res.world || res.studio || res.api || res);
        apis.set(studio.id, api);
        tab.api = api;
        if (!studio.wired) {
            studio.wired = true;
            const d = docOf(studio);
            if (studio.wire) studio.wire(d, api);
            for (const id of studio.hideIds || []) d.style(id, 'display', 'none');
            for (const id of studio.fullPreview || []) d.on(id, 'click', () => editor.fullPreview(tab));
        }
        return api;
    }

    function setActive(tab, on) {
        if (!tab || !tab.api) return;
        if (tab.inst) {
            if (on) { tab.inst.doc.show(); tab.inst.doc.front(); } else tab.inst.doc.hide();
            if (tab.inst.onActive) tab.inst.onActive(on);
            return;
        }
        if (tab.api.state) tab.api.state.active = on;
        if (tab.api.onActive) tab.api.onActive(on);
        else defaultActive(tab.api, on);
        const d = docOf(tab.studio);
        if (on) { d.show(); d.front(); } else d.hide();
    }

    // Пауза студий SDK без своего хука: узел картинки (Sprite/Animation) и
    // превью студий данных (def.mount/unmount) не должны просвечивать сквозь
    // прозрачный центр другой вкладки.
    function defaultActive(api, on) {
        const st = api.state;
        if (st && st.node) { try { $(st.node).visible(on); } catch (e) { /* узел уже удалён */ } }
        const def = api.def, host = api;
        if (def && api.session) {
            try { if (on) { if (def.mount) def.mount(host); } else if (def.unmount) def.unmount(host); } catch (e) { editor.log(String(e && e.message || e)); }
        }
    }

    function place(tab, rect) {
        if (!tab || !tab.api || !rect) return;
        const key = rect.x + ',' + rect.y + ',' + rect.w + ',' + rect.h;
        if (tab.placed !== key) {
            tab.placed = key;
            (tab.inst ? tab.inst.doc : docOf(tab.studio)).place(rect);
            // RmlUi пересчитает раскладку только в следующем обновлении: студия
            // читает геометрию своих элементов, поэтому перестройка — через кадр.
            tab.refit = 2;
            return;
        }
        if (tab.refit > 0 && --tab.refit === 0) {
            if (tab.inst) { if (tab.inst.layout) tab.inst.layout(); return; }
            // Своя перерисовка либо «Вписать» (Sprite/Animation считали fit
            // по полноэкранной раскладке SDK).
            if (tab.api.render) tab.api.render();
            if (tab.api.fit) tab.api.fit();
        }
    }

    function close(tab) {
        if (!tab) return;
        if (tab.inst) { tab.inst.close(); tab.inst = null; tab.api = null; return; }
        if (!tab.api) return;
        closing = true;
        try { if (tab.api.close) tab.api.close(); } finally { closing = false; }
        // close() студии может отказать (несохранённое) — Editor уже спросил.
        if (tab.api.state) tab.api.state.active = false;
        const d = docOf(tab.studio);
        d.hide();
        d.place(null);
        apis.delete(tab.studio.id);
        tab.api = null;
    }

    function snapshot(tab) {
        try { return tab && tab.api && tab.api.snapshot ? tab.api.snapshot() : null; } catch (e) { return null; }
    }

    function diagnostics(tab) {
        try { return tab && tab.api && tab.api.diagnostics ? (tab.api.diagnostics() || []) : []; } catch (e) { return []; }
    }

    function front(tab) { if (tab && tab.api) (tab.inst ? tab.inst.doc : docOf(tab.studio)).front(); }
    function summary(tab) { return tab && tab.studio.summary ? tab.studio.summary(snapshot(tab)) : []; }
    function show(tab, on) { if (tab && tab.api) { const d = tab.inst ? tab.inst.doc : docOf(tab.studio); if (on) d.show(); else d.hide(); } }
    // Студии Editor: кадр, сохранение и история ведёт Editor.
    function update(tab, dt) { if (tab && tab.inst && tab.inst.update) tab.inst.update(dt); }
    // Студия Editor отвечает bool. Старый модуль SDK пишет файл и возвращает
    // разное (bool или {ok} проверки после записи): сохранён ли — по снимку.
    async function save(tab) {
        if (!tab) return false;
        if (tab.inst) return tab.inst.save ? !!(await tab.inst.save()) : false;
        if (!tab.api || !tab.api.save) return false;
        const r = await tab.api.save();
        const snap = snapshot(tab);
        if (snap && typeof snap.dirty === 'boolean') return !snap.dirty;
        return r === true || !!(r && r.ok);
    }
    function dirty(tab) {
        if (!tab) return false;
        if (tab.inst) return !!(tab.inst.dirty && tab.inst.dirty());
        const snap = snapshot(tab);
        return !!(snap && snap.dirty);
    }
    function undo(tab) { return tab && tab.inst && tab.inst.undo ? tab.inst.undo() : false; }
    function redo(tab) { return tab && tab.inst && tab.inst.redo ? tab.inst.redo() : false; }
    function commands(tab) { return tab && tab.inst && tab.inst.commands ? tab.inst.commands() : []; }

    return { open, setActive, place, close, snapshot, diagnostics, front, summary, show, update, save, dirty, undo, redo, commands, studioFor, studioById, studiosFor };
}
