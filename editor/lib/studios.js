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
const ALIASES = { 'sprite-studio': 'atlas', 'animation-studio': 'atlas' };

const STUDIOS = [
    {
        id: 'world-editor',
        title: 'Hammer',
        match: (p) => /\.re2dmap(\.json)?$/i.test(p),
        module: '../../sdk/tools/world-editor.js',
        doc: 'ui/hammer.rml',              // раскладка Editor, id те же, что у SDK
        // Клавиши, которые студия обрабатывает сама (Editor их на её вкладке не трогает).
        ownKeys: ['s', 'z', 'y', 'f5'],
        summary: (snap) => snap ? [
            ['Состояние', snap.dirty ? 'изменён, не сохранён' : 'сохранён'],
            ['Инструмент', snap.tool || '—'],
            ['Выделение', snap.selection && snap.selection.ids.length ? snap.selection.kind + ': ' + snap.selection.ids.join(', ') : 'нет'],
            ['Карта', snap.map ? 'brushes ' + snap.map.brushes + ' · entities ' + snap.map.entities + ' · paths ' + snap.map.paths + ' · visgroups ' + snap.map.visgroups : '—'],
        ] : [],
    },
    {
        id: 'vn-maker',
        title: 'Narrative',
        match: (p) => /\.(scene|story)$/i.test(p),
        module: '../../sdk/tools/vn-narrative.js',
        doc: 'ui/vn_maker.rml',
        ownKeys: ['s', 'z'],
        // Play проигрывает $.story узлами <ui.*> в проходе сцены — под RmlUi:
        // на время проигрывания документы Editor скрываются (fullPreview).
        fullPreview: ['vnm-play', 'vnm-from'],
        wire(doc, api) {
            doc.on('vnm-add-choice', 'click', () => api.insert('choice'));
            doc.on('vnm-add-jump', 'click', () => api.insert('flow'));
            doc.on('vnm-add-label', 'click', () => api.insert('label'));
            doc.on('vnm-add-image', 'click', () => api.insert('image'));
        },
        summary: (snap) => snap ? [
            ['Состояние', snap.dirty ? 'изменён, не сохранён' : 'сохранён'],
            ['Команд', String(snap.commandCount)],
            ['Выбрана', snap.selectedCommand >= 0 ? '#' + (snap.selectedCommand + 1) : 'нет'],
            ['Проверка', snap.validation ? ((snap.validation.diagnostics || []).length + ' сообщений') : 'не запускалась'],
        ] : [],
    },
    {
        id: 'sprite-mesh-studio',
        title: 'SpriteMesh',
        // Не по умолчанию: .atlas.json открывает Sprite; SpriteMesh — «Открыть как».
        match: () => false,
        also: (p) => /\.(atlas\.json|png)$/i.test(p),
        module: '../../sdk/tools/sprite-mesh-studio.js',
        doc: 'ui/sprite_mesh.rml',
        // dirty студии — «cache нужно перепечь», а не несохранённые правки файла.
        trackDirty: false,
        summary: (snap) => snap ? [
            ['Кадров', String(snap.frames)],
            ['Анимации', (snap.animations || []).join(', ') || '—'],
            ['Cache', snap.dirty ? 'нужен bake' : 'актуален'],
        ] : [],
    },
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
    sdkStudio('re2d-world-studio', 'Re2D World', () => false, 'sdk/ui/world_studio.rml', 'ws-back',
        { also: (p) => /\.re2dmap(\.json)?$/i.test(p) }),
    dataStudio('tilemap-studio', 'Tilemap', /\.tilemap\.json$/i),
    dataStudio('particle-studio', 'Particles', /\.particles\.json$/i),
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
        layouts: { world: 'ui/hammer.rml', vn: 'ui/vn_maker.rml', vnPreview: true, spriteMesh: 'ui/sprite_mesh.rml', spriteMeshThumbs: true },
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
            status: (text, kind) => editor.setStatus(text, kind || ''),
            log: (text) => editor.log(text),
            changed: () => editor.changed(tab),
            openWith: (path, id) => editor.openWith(path, id),
            typing: () => editor.typing(),
        };
    }

    async function open(tab) {
        const studio = tab.studio;
        if (studio.native) {
            const inst = studio.module.create(nativeHost(tab));
            tab.inst = inst;
            try { await inst.open(tab.abs); }
            catch (e) { if (inst.close) inst.close(); tab.inst = null; throw e; }
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
        if (!tab || !tab.api) return;
        if (tab.inst) { tab.inst.close(); tab.inst = null; tab.api = null; return; }
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
    async function save(tab) { return tab && tab.inst && tab.inst.save ? tab.inst.save() : false; }
    function undo(tab) { return tab && tab.inst && tab.inst.undo ? tab.inst.undo() : false; }
    function redo(tab) { return tab && tab.inst && tab.inst.redo ? tab.inst.redo() : false; }
    function commands(tab) { return tab && tab.inst && tab.inst.commands ? tab.inst.commands() : []; }

    return { open, setActive, place, close, snapshot, diagnostics, front, summary, show, update, save, undo, redo, commands, studioFor, studioById, studiosFor };
}
