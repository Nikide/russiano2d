// ===========================================================================
// Re2DSprite Studio — просмотр, проверка и правка модели Re2DSprite
// (docs/SDK.md §9). Открывает `*.character.json` (+ PNG v2 и анимации рядом).
//
// Три вкладки:
//   Вид         — НАСТОЯЩИЙ рантайм: узел `$.re2dSprite.from(...)`, ракурс yaw/pitch
//                 мышью и числами, движения, эмоции, варианты, стиль, hot reload;
//   Поверхность — отладочные виды карт PNG v2 (материал, часть, владелец, X/Y/Z,
//                 покрытие, группа, перекрытие), отсчёт под курсором. Карты
//                 декодирует нативный r2d-sdk: SDK НЕ синтезирует спрайт сам;
//   Скелет      — кости, pivot, принадлежность частей, сокеты, проекция.
//
// Семантику формата студия не меняет: правит поля и пишет файл тем же
// отступом. Диагностика — только факты: нативный `validate` и ошибки рантайма.
// ===========================================================================

import * as R from '../lib/re2d_model.js';
import { createHistory } from '../lib/history.js';
import { fitZoom } from '../lib/atlas_model.js';
import { escapeHtml, dirOf, joinPath } from '../lib/model.js';
import * as views from '../lib/views.js';

const DOC = 'sdk/ui/re2d_studio.rml';
const MODES = [
    ['final', 'Итог (рантайм)'], ['material', 'Материал'], ['part', 'ID части'], ['owner', 'Владелец (кость)'],
    ['x', 'X'], ['y', 'Y'], ['z', 'Глубина Z'], ['coverage', 'Покрытие'], ['group', 'Группа материала'], ['overlap', 'Перекрытие'],
];
const DEBUG_SCALE = 3;
let singleton = null;
let cacheCounter = 0;

export async function open(app, args) {
    if (!singleton) singleton = createStudio(app);
    return singleton.openAsset(args.assetAbs || args.asset || null);
}

export function createStudio(app) {
    const $ = app.$;
    const doc = $.ui.doc(DOC);
    const s = {
        active: false, path: null, dir: null,
        def: null, indent: 2, newline: true, history: null, anim: null,
        tab: 'view', mode: 'final', author: null, equipmentNode: null,
        node: null, nodeError: null, fromFile: false,
        yaw: 0, pitch: 0, size: 0, motion: null, emotion: null, style: 'anime', body: true, playing: true,
        debug: null,                 // { node, path, key, cell, x, y }
        sample: null, samplePending: false, sampleAt: 0, lastSample: null,
        boneSel: null, socketSel: null,
        diagnostics: [], backendDiags: [], notes: [], press: null, mouse: { x: 0, y: 0 }, dirtyPreview: false, needFit: false,
    };
    let wired = false;

    const slot = () => doc.rect('rs-viewport') || { x: 0, y: 0, w: 0, h: 0 };
    const D = () => s.def;

    // --- Диагностика --------------------------------------------------------------
    // Факты нативной проверки + факты рантайма (его исключения) + отказы правок.
    function composeDiag() {
        const list = s.backendDiags.concat(s.notes);
        if (s.nodeError) {
            list.push({ code: 'SDK_RE2D_RUNTIME', severity: 'error', asset: s.path, location: null,
                        message: 'Рантайм не принял модель: ' + s.nodeError, details: null });
        }
        s.diagnostics = list;
        doc.html('rs-diag', views.diagRows(list));
    }
    function setDiag(list) {
        s.backendDiags = list || [];
        composeDiag();
    }
    function note(severity, code, message, details) {
        s.notes.push({ code, severity, asset: s.path, location: null, message, details: details || null });
        composeDiag();
    }

    // --- Черновик: нативные команды читают файл, а правки ещё в памяти -----------------------
    async function withDraft(fn) {
        const draft = joinPath(s.dir, '.r2d-sdk-draft.character.json');
        if (!$.fs.write(draft, R.serializeCharacter(s.def, s.indent, s.newline))) {
            note('error', 'SDK_WRITE_FAILED', 'Не удалось записать черновик ' + draft);
            return null;
        }
        try {
            return await fn(draft);
        } finally {
            $.fs.remove(draft);
        }
    }

    async function validate() {
        if (!s.def) return { ok: false, diagnostics: [] };
        const r = await withDraft((draft) => app.backend(['validate', draft], 'проверяю модель'));
        if (!r || !r.json) return { ok: false, diagnostics: s.diagnostics };
        // Адрес диагностики — настоящий файл, а не черновик.
        const list = (r.json.diagnostics || []).map((d) => Object.assign({}, d, { asset: d.asset && d.asset.includes('.r2d-sdk-draft') ? s.path : d.asset }));
        s.notes = [];           // свежая проверка вытесняет прежние отказы правок
        setDiag(list);
        app.setStatus(r.json.ok ? 'проверка: ошибок нет' : 'проверка: есть ошибки', r.json.ok ? '' : 'fail');
        return { ok: !!r.json.ok, diagnostics: s.diagnostics };
    }

    // --- Открытие -------------------------------------------------------------------------------
    async function openAsset(abs) {
        if (!abs || !abs.endsWith('.character.json')) {
            throw new Error('Re2DSprite Studio: выберите файл *.character.json (описание модели Re2DSprite)');
        }
        const text = $.fs.readText(abs);
        if (text === null || text === undefined) throw new Error('не удалось прочитать ' + abs);
        const parsed = R.parseCharacter(text);
        s.path = abs;
        s.dir = dirOf(abs);
        s.def = parsed.def;
        s.indent = parsed.indent;
        s.newline = parsed.newline;
        s.history = createHistory(s.def);
        s.style = s.def.style || 'anime';
        s.body = !s.def.defaults || s.def.defaults.body !== false;
        s.yaw = 0; s.pitch = 0; s.motion = null; s.emotion = null; s.playing = true;
        s.boneSel = null; s.socketSel = null; s.author = null;
        loadAnimations();
        s.active = true;
        s.tab = 'view';
        s.mode = 'final';
        if (app.doc) app.doc.hide();
        doc.show();
        wire();
        const size = $.gfx.size();
        $.camera.at(size.w / 2, size.h / 2).zoom(1);
        app.setStatus('Re2DSprite Studio: ' + abs.split('/').pop(), '');
        s.notes = [];
        s.nodeError = null;
        setDiag([]);
        s.dirtyPreview = true;
        renderAll();
        // Проверка на диске — при открытии, чтобы автор сразу видел факты о файле.
        await validateDisk();
        return { id: 're2dsprite-studio', studio: api };
    }

    function loadAnimations() {
        s.anim = null;
        const a = s.def.animations;
        if (typeof a === 'string') {
            const path = absPath(a);
            s.anim = $.fs.readJSON(path, null);
        } else if (a && typeof a === 'object') {
            s.anim = a;
        }
    }

    function absPath(p) {
        return R.absolutize({ atlas: p }, s.dir).atlas;
    }

    async function validateDisk() {
        const r = await app.backend(['validate', s.path], 'проверяю модель');
        s.notes = [];
        if (r.json) setDiag(r.json.diagnostics || []);
        return r;
    }

    function close() {
        s.active = false;
        killPreview();
        killDebug();
        doc.hide();
        if (app.doc) app.doc.show();
        app.closeTool();
    }

    // --- Предпросмотр: настоящий рантайм -------------------------------------------------------------
    function killPreview() {
        if (s.equipmentNode) { try { s.equipmentNode.remove(); } catch(e) {} s.equipmentNode=null; }
        if (s.node) { try { $(s.node).remove(); } catch (e) { /* узел уже убран */ } s.node = null; }
    }

    function previewSize() {
        const r = slot();
        return Math.max(64, Math.min(r.w, r.h) - 40) * (s.size || 1);
    }

    function buildPreview(fromFile) {
        killPreview();
        s.nodeError = null;
        s.fromFile = !!fromFile;
        if (!s.def) return;
        try {
            const source = fromFile ? s.path : R.absolutize(s.def, s.dir);
            const r = slot();
            const sz = previewSize();
            const node = $.re2dSprite.from(source, { id: 'sdk-re2d' }).at(r.x + r.w / 2, r.y + r.h / 2).size(sz, sz);
            node.re2dHotReload(!!fromFile);
            if (s.style !== (s.def.style || 'anime') || s.style !== 'anime') node.re2dStyle(s.style);
            node.re2dRig({ body: s.body });
            if (s.motion) {
                try { node.re2dMotion(s.motion, s.playing ? 1 : 0); } catch (e) { s.motion = null; }
            }
            if (s.emotion) {
                try { node.re2dEmotion(s.emotion); } catch (e) { s.emotion = null; }
            }
            node.re2dPose(s.yaw, s.pitch);
            s.node = node.get(0);
        } catch (e) {
            s.nodeError = e && e.message ? e.message : String(e);
        }
        composeDiag();
    }

    function applyPose(yaw, pitch) {
        const p = R.normalizePose(Number(yaw), Number(pitch));
        s.yaw = p.yaw;
        s.pitch = p.pitch;
        if (s.node) $(s.node).re2dPose(s.yaw, s.pitch);
        doc.setValue('v-yaw', String(Math.round(s.yaw * 10) / 10));
        doc.setValue('v-pitch', String(Math.round(s.pitch * 10) / 10));
        doc.text('rs-hud', escapeHtml(hudText()));
        return p;
    }

    function setMotion(name) {
        s.motion = name;
        if (s.node) {
            try { $(s.node).re2dMotion(name, s.playing ? 1 : 0); } catch (e) { note('error', 'SDK_RE2D_RUNTIME', e.message); }
        }
        renderLeftView();
        return s.motion;
    }

    function setEmotion(name) {
        s.emotion = name;
        if (s.node) {
            try { $(s.node).re2dEmotion(name); } catch (e) { note('error', 'SDK_RE2D_RUNTIME', e.message); }
        }
        renderLeftView();
        return s.emotion;
    }

    function setVariant(group, key) {
        if (!s.node) return false;
        try { $(s.node).re2dVariant(group, key); return true; } catch (e) { note('error', 'SDK_RE2D_RUNTIME', e.message); return false; }
    }

    function setStyle(style) {
        s.style = style === 'pixel' ? 'pixel' : 'anime';
        if (s.node) { try { $(s.node).re2dStyle(s.style); } catch (e) { note('error', 'SDK_RE2D_RUNTIME', e.message); } }
        renderRight();
        return s.style;
    }

    function setBody(on) {
        s.body = !!on;
        if (s.node) $(s.node).re2dRig({ body: s.body });
        renderRight();
        return s.body;
    }

    function setPlaying(on) {
        s.playing = !!on;
        if (s.node && s.motion) { try { $(s.node).re2dMotion(s.motion, s.playing ? 1 : 0); } catch (e) { /* клип удалён */ } }
        renderRight();
        return s.playing;
    }

    // --- Поверхность -------------------------------------------------------------------------------------
    function killDebug() {
        if (s.debug) {
            try { $(s.debug.node).remove(); } catch (e) { /* уже убран */ }
            try { $.resource.free(s.debug.key); } catch (e) { /* ресурс не был загружен */ }
            s.debug = null;
        }
    }

    async function showMode(mode) {
        if (!MODES.some((m) => m[0] === mode)) return false;
        s.mode = mode;
        s.sample = null;
        killDebug();
        if (mode === 'final') {
            s.dirtyPreview = true;
            renderAll();
            return true;
        }
        const out = joinPath($.fs.basePath() || '', 'build/sdk_cache/surface.' + mode + '.' + (++cacheCounter) + '.png');
        const r = await withDraft((draft) => app.backend(['re2d-debug', draft, '--mode', mode, '--out', out, '--scale', String(DEBUG_SCALE)], 'вид «' + mode + '»'));
        if (!r || !r.json || !r.json.ok) {
            setDiag(r && r.json ? r.json.diagnostics : s.diagnostics);
            note('error', 'SDK_RE2D_DEBUG', 'Не удалось построить вид «' + mode + '» — см. диагностику');
            return false;
        }
        const key = 'sdk-surface:' + out;
        $.resource.define(key, { kind: 'texture', path: out });
        $.resource.load(key);
        const node = $('<sprite>', { id: 'sdk-surface', src: out }).appendTo($.world).get(0);
        s.debug = { node, path: out, key, w: r.json.w, h: r.json.h, cell: DEBUG_SCALE, x: 0, y: 0 };
        layoutDebug();
        renderAll();
        return true;
    }

    function layoutDebug() {
        if (!s.debug) return;
        const r = slot();
        const z = fitZoom(s.debug.w, s.debug.h, Math.max(1, r.w - 40), Math.max(1, r.h - 40));
        const w = s.debug.w * z, h = s.debug.h * z;
        s.debug.cell = DEBUG_SCALE * z;
        s.debug.x = r.x + (r.w - w) / 2;
        s.debug.y = r.y + (r.h - h) / 2;
        $(s.debug.node).at(s.debug.x + w / 2, s.debug.y + h / 2).size(w, h);
    }

    async function inspect(mx, my) {
        const r = await withDraft((draft) => app.backend(['re2d-sample', draft, '--x', String(mx), '--y', String(my)], 'отсчёт'));
        if (r && r.json && r.json.ok) {
            s.sample = r.json.sample;
            s.lastSample = s.sample;
            doc.text('rs-sample', escapeHtml(R.describeSample(s.sample)));
        }
        return s.sample;
    }

    // --- Правки (undo/redo) ----------------------------------------------------------------------------------
    function run(label, fn) {
        if (!s.history) return null;
        try {
            const result = s.history.run(label, fn);
            loadAnimations();
            s.dirtyPreview = true;
            renderAll();
            return result;
        } catch (e) {
            note('error', 'SDK_EDIT_REJECTED', e && e.message ? e.message : String(e));
            app.setStatus('правка отклонена: ' + (e && e.message ? e.message : e), 'fail');
            return null;
        }
    }

    const ops = {
        setAuthor(category, name, value) {
            if (!['clips','emotions','variants','equipment'].includes(category)) throw new Error('Неизвестный раздел');
            if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('Запись должна быть JSON-объектом');
            if (!name || ['__proto__','constructor','prototype'].includes(name)) throw new Error('Нужно безопасное имя');
            return run(category + ' «' + name + '»', d => {
                let target;
                if (category === 'clips') {
                    if (typeof d.animations === 'string' || !d.animations) d.animations = JSON.parse(JSON.stringify(s.anim || {version:1,clips:{}}));
                    target = d.animations.clips;
                } else target = d[category] || (d[category] = {});
                if (value === null) delete target[name];
                else target[name] = JSON.parse(JSON.stringify(value));
            });
        },
        setBonePivot(name, pivot, portrait) { return run('pivot «' + name + '»', (d) => R.setBonePivot(d, name, pivot, portrait)); },
        setPartBone(id, bone) { return run('часть ' + id, (d) => R.setPartBone(d, id, bone)); },
        setProjection(key, value) { return run('проекция', (d) => R.setProjection(d, key, value)); },
        setSocket(name, patch) { return run('сокет «' + name + '»', (d) => R.setSocket(d, name, patch)); },
        setStyle(style) { return run('стиль', (d) => R.setStyle(d, style)); },
        undo() { const l = s.history && s.history.undo(); if (l) { loadAnimations(); s.dirtyPreview = true; renderAll(); } return l; },
        redo() { const l = s.history && s.history.redo(); if (l) { loadAnimations(); s.dirtyPreview = true; renderAll(); } return l; },
    };

    async function save() {
        if (!s.def) return { ok: false, diagnostics: [] };
        const text = R.serializeCharacter(s.def, s.indent, s.newline);
        if (!$.fs.write(s.path, text)) {
            note('error', 'SDK_WRITE_FAILED', 'Не удалось записать ' + s.path);
            return { ok: false, diagnostics: s.diagnostics };
        }
        s.history.markSaved();
        const r = await validateDisk();
        s.dirtyPreview = true;
        s.saved = true;
        renderAll();
        app.setStatus(r.json && r.json.ok ? 'сохранено: ' + s.path.split('/').pop() : 'сохранено, но есть ошибки проверки', r.json && r.json.ok ? '' : 'fail');
        return { ok: !!(r.json && r.json.ok), diagnostics: s.diagnostics };
    }

    // --- Выбор в списках -------------------------------------------------------------------------------------
    function selectBone(name) {
        s.boneSel = name && R.findBone(s.def, name) ? name : null;
        renderRig();
        return s.boneSel;
    }

    function selectSocket(name) {
        s.socketSel = name;
        renderRig();
        return s.socketSel;
    }

    // --- Отрисовка интерфейса ----------------------------------------------------------------------------------
    function hudText() {
        if (s.tab === 'view') {
            return 'yaw ' + Math.round(s.yaw) + ' · pitch ' + Math.round(s.pitch) + ' · ' + s.style + (s.motion ? ' · ' + s.motion : '') +
                (s.nodeError ? ' · ОШИБКА РАНТАЙМА' : '');
        }
        if (s.tab === 'surface') return 'вид: ' + s.mode + (s.lastSample ? ' · ' + R.describeSample(s.lastSample) : '');
        return 'скелет: ' + (s.boneSel || 'кость не выбрана');
    }

    function renderTop() {
        doc.text('rs-file', escapeHtml(s.path || '—'));
        doc.text('rs-dirty', s.history && s.history.dirty() ? '• есть несохранённые правки' : '');
        doc.cls('rs-undo', 'off', !(s.history && s.history.canUndo()));
        doc.cls('rs-redo', 'off', !(s.history && s.history.canRedo()));
        for (const t of ['view', 'surface', 'rig', 'author']) {
            doc.cls('rs-tab-' + t, 'on', s.tab === t);
            doc.style('rs-left-' + t, 'display', s.tab === t ? 'block' : 'none');
            doc.style('rs-right-' + t, 'display', s.tab === t ? 'block' : 'none');
        }
    }

    function listHtml(items, current, prefix) {
        if (!items.length) return '<p class="empty">Нет.</p>';
        return items.map((n, i) => '<div id="' + prefix + '-' + i + '" class="row' + (n === current ? ' sel' : '') + '" data-key="' + escapeHtml(n) +
            '"><span class="row-name">' + escapeHtml(n) + '</span></div>').join('');
    }

    function renderLeftView() {
        const d = D();
        if (!d) return;
        doc.html('rs-motions', listHtml(R.clipNames(s.anim), s.motion, 'mo'));
        doc.html('rs-emotions', listHtml(['neutral'].concat(R.emotionNames(d)), s.emotion, 'em'));
        const variants = [];
        for (const [group, keys] of Object.entries(d.variants || {})) for (const key of Object.keys(keys)) variants.push(group + '/' + key);
        doc.html('rs-variants', listHtml(variants, null, 'va'));
    }

    function renderRight() {
        doc.cls('v-style-anime', 'on', s.style === 'anime');
        doc.cls('v-style-pixel', 'on', s.style === 'pixel');
        doc.cls('v-body', 'on', s.body);
        doc.cls('v-play', 'on', s.playing);
        doc.text('v-play', s.playing ? 'играет' : 'пауза');
        let info = '—';
        if (s.node) {
            const i = $.re2dSprite.info(s.node);
            if (i) info = 'v' + i.version + ' · ' + i.style + ' · ' + i.width + ' px растр · ' + (i.surfaceSamples || '?') + ' отсчётов · перезагрузок ' + i.reloads +
                (i.reloadError ? ' · ОШИБКА: ' + i.reloadError : '') + (i.hotReload ? ' · hot reload' : '');
        } else if (s.nodeError) {
            info = 'Рантайм: ' + s.nodeError;
        }
        doc.text('rs-info', escapeHtml(info));
    }

    function renderModes() {
        doc.html('rs-modes', MODES.map(([key, label]) => '<div id="md-' + key + '" class="row' + (key === s.mode ? ' sel' : '') + '" data-key="' + key +
            '"><span class="row-name">' + escapeHtml(label) + '</span></div>').join(''));
        const d = D();
        const parts = d && d.rig && d.rig.parts ? d.rig.parts : [];
        doc.html('rs-parts', parts.length ? parts.map((p) => '<div class="row"><span class="row-name">ID ' + p.id + '</span><span class="row-dir">' + escapeHtml(p.bone) +
            (p.selector ? ' · ' + escapeHtml(p.selector) : '') + '</span></div>').join('') : '<p class="empty">Частей нет.</p>');
    }

    function renderRig() {
        const d = D();
        if (!d) return;
        const bones = R.boneList(d);
        doc.html('rs-bones', bones.map((b) => '<div id="bn-' + b.index + '" class="row' + (b.name === s.boneSel ? ' sel' : '') + '" data-key="' + escapeHtml(b.name) +
            '" style="padding-left:' + (8 + b.depth * 14) + 'px;"><span class="row-name">' + escapeHtml(b.name) + '</span><span class="row-dir">' + R.partsOf(d, b.name).length + ' ч.</span></div>').join(''));
        const sockets = ((d.rig && d.rig.sockets) || []).map((k) => k.name);
        doc.html('rs-sockets', listHtml(sockets, s.socketSel, 'sk'));
        const bone = s.boneSel ? R.findBone(d, s.boneSel) : null;
        const set = (id, v) => doc.setValue(id, v === null || v === undefined ? '' : String(v));
        set('b-name', bone ? bone.name : '');
        for (let i = 0; i < 3; i++) {
            set('b-p' + 'xyz'[i], bone && bone.pivot ? bone.pivot[i] : '');
            set('b-q' + 'xyz'[i], bone && bone.portraitPivot ? bone.portraitPivot[i] : '');
        }
        doc.html('rs-bone-parts', bone ? (R.partsOf(d, bone.name).map((p) => '<div class="row"><span class="row-name">ID ' + p.id + '</span></div>').join('') || '<p class="empty">У кости нет частей.</p>') : '<p class="empty">Выберите кость.</p>');
        const socket = s.socketSel ? ((d.rig && d.rig.sockets) || []).find((k) => k.name === s.socketSel) : null;
        set('k-name', socket ? socket.name : '');
        for (let i = 0; i < 3; i++) {
            set('k-p' + 'xyz'[i], socket && socket.point ? socket.point[i] : '');
            set('k-r' + 'xyz'[i], socket && socket.rotation ? socket.rotation[i] : '');
        }
        set('j-body', d.projection && d.projection.bodyScale !== undefined ? d.projection.bodyScale : '');
        set('j-portrait', d.projection && d.projection.portraitScale !== undefined ? d.projection.portraitScale : '');
    }

    function renderAll() {
        renderTop();
        renderLeftView();
        renderModes();
        renderRig();
        renderRight();
        renderAuthor();
        doc.text('rs-hud', escapeHtml(hudText()));
    }

    function selectAuthor(category, name) {
        s.author={category,name};doc.setValue('a-category',category);doc.setValue('a-name',name);
        const value=category==='clips' ? s.anim?.clips?.[name] : s.def?.[category]?.[name];
        doc.setValue('a-json', JSON.stringify(value || {},null,2));
        if(category==='clips'){if(s.dirtyPreview){buildPreview(false);s.dirtyPreview=false;}setMotion(name);}
        renderAuthor();return value;
    }
    function renderAuthor() {
        if(!s.def)return;
        doc.html('rs-author-list',['clips','emotions','variants','equipment'].map(category=>'<h4>'+category+'</h4>'+Object.keys(category==='clips'?s.anim?.clips||{}:s.def[category]||{}).map(name=>'<div class="row" data-key="'+escapeHtml(category+':'+name)+'">'+escapeHtml(name)+'</div>').join('')).join(''));
        const clip=s.author?.category==='clips'?s.anim?.clips?.[s.author.name]:null;
        doc.html('rs-timeline',clip?(Array.isArray(clip.tracks)?clip.tracks:[]).filter(t=>t&&typeof t==='object').map(t=>'<div class="kv">'+escapeHtml(t.target+' · '+t.channel)+'</div>'+(Array.isArray(t.keys)?t.keys:[]).filter(k=>Array.isArray(k)&&Number.isFinite(k[0])).map(k=>'<button class="btn small" data-key="'+k[0]+'">'+k[0]+'s · '+escapeHtml(String(k[1]))+'</button>').join('')).join(''):'Выберите клип. Клик по ключу ставит время runtime.');
    }
    function seek(time) { if(!Number.isFinite(time)||time<0)throw new Error('Время должно быть >= 0');setPlaying(false);if(s.node)$(s.node).re2dSeek(time);return time; }
    function previewAuthor() {
        if(!s.author)return false;
        if(s.dirtyPreview){buildPreview(false);s.dirtyPreview=false;}
        if(!s.node)return false;
        const {category,name}=s.author;
        if(category==='clips')setMotion(name);
        if(category==='emotions')setEmotion(name);
        if(category==='variants'){const key=Object.keys(s.def.variants[name]||{})[0];if(key)return setVariant(name,key);return false;}
        if(category==='equipment'){
            if(s.equipmentNode)s.equipmentNode.remove();s.equipmentNode=$.re2dSprite.equip($(s.node),name);
            const pose=s.def.equipment[name].pose;if(pose)setMotion(pose);
        }
        return true;
    }

    // --- Кадр и мышь -----------------------------------------------------------------------------------------------
    function tick() {
        if (!s.active) return;
        const r = slot();
        if (r.w <= 0) return;
        if (s.dirtyPreview && (s.tab === 'view' || s.tab === 'author') && s.mode === 'final') {
            s.dirtyPreview = false;
            // Чистое состояние — читаем сам файл (hot reload включён); есть правки — предпросмотр из памяти.
            buildPreview(!(s.history && s.history.dirty()));
            renderRight();
            doc.text('rs-hud', escapeHtml(hudText()));
        }
        if (s.node) {
            const sz = previewSize();
            $(s.node).at(r.x + r.w / 2, r.y + r.h / 2).size(sz, sz);
            if (s.saved) { s.saved = false; renderRight(); }
        }
        if (s.debug) layoutDebug();
        pointer(r);
    }

    function pointer(r) {
        const m = $.input.mouse();
        const inside = m.x >= r.x && m.x < r.x + r.w && m.y >= r.y && m.y < r.y + r.h;
        const moved = m.x !== s.mouse.x || m.y !== s.mouse.y;
        s.mouse = { x: m.x, y: m.y };
        if (s.tab === 'view') {
            const wheel = $.input.wheel().y;
            if (inside && wheel !== 0) { s.size = Math.max(0.3, Math.min(2.5, (s.size || 1) * (wheel > 0 ? 1.1 : 1 / 1.1))); }
            if (inside && $.input.mousePressed('left')) s.press = { x: m.x, y: m.y, yaw: s.yaw, pitch: s.pitch };
            if (s.press) {
                if ($.input.mouseDown('left')) {
                    if (moved) applyPose(s.press.yaw + (m.x - s.press.x) * 0.6, s.press.pitch - (m.y - s.press.y) * 0.6);
                } else {
                    s.press = null;
                }
            }
        } else if (s.tab === 'surface' && s.debug && inside && moved) {
            const hit = R.sampleAt(s.debug, m.x, m.y);
            const now = Date.now ? Date.now() : 0;
            if (hit && !s.samplePending && (hit.mx !== (s.sampleAt && s.sampleAt.mx) || hit.my !== (s.sampleAt && s.sampleAt.my))) {
                s.sampleAt = hit;
                s.samplePending = true;
                inspect(hit.mx, hit.my).then(() => { s.samplePending = false; doc.text('rs-hud', escapeHtml(hudText())); });
            }
        }
    }

    // --- Подписки ---------------------------------------------------------------------------------------------------
    function setTab(tab) {
        if (!['view', 'surface', 'rig', 'author'].includes(tab)) return false;
        s.tab = tab;
        if (tab === 'view' || tab === 'author') {
            killDebug();
            s.mode = 'final';
            s.dirtyPreview = true;
        } else {
            killPreview();                    // чужие картинки в окне просмотра не нужны
            if (tab === 'surface') showMode(s.mode === 'final' ? 'material' : s.mode);
        }
        renderAll();
        return true;
    }

    function num(id) {
        const v = String(doc.value(id) || '').trim().replace(',', '.');
        return v === '' ? NaN : Number(v);
    }

    function wire() {
        if (wired) return;
        wired = true;
        doc.on('rs-tab-author','click',()=>setTab('author'));
        doc.on('rs-author-list','click',(id,ev,key)=>{const n=key.indexOf(':');if(n>0)selectAuthor(key.slice(0,n),key.slice(n+1));});
        doc.on('a-apply','click',()=>{try{ops.setAuthor(doc.value('a-category'),doc.value('a-name'),JSON.parse(doc.value('a-json')));selectAuthor(doc.value('a-category'),doc.value('a-name'));}catch(e){note('error','SDK_EDIT_REJECTED',e.message);}});
        doc.on('a-remove','click',()=>{try{ops.setAuthor(doc.value('a-category'),doc.value('a-name'),null);}catch(e){note('error','SDK_EDIT_REJECTED',e.message);}});
        doc.on('a-preview','click',()=>{try{previewAuthor();}catch(e){note('error','SDK_RE2D_RUNTIME',e.message);}});
        doc.on('a-seek','click',()=>{try{seek(Number(doc.value('a-time')));}catch(e){note('error','SDK_EDIT_REJECTED',e.message);}});
        doc.on('rs-timeline','click',(id,ev,key)=>{if(key!==''){try{seek(Number(key));doc.setValue('a-time',key);}catch(e){note('error','SDK_EDIT_REJECTED',e.message);}}});
        doc.on('rs-back', 'click', () => close());
        doc.on('rs-save', 'click', () => save());
        doc.on('rs-undo', 'click', () => ops.undo());
        doc.on('rs-redo', 'click', () => ops.redo());
        doc.on('rs-validate', 'click', () => validate());
        doc.on('rs-tab-view', 'click', () => setTab('view'));
        doc.on('rs-tab-surface', 'click', () => setTab('surface'));
        doc.on('rs-tab-rig', 'click', () => setTab('rig'));

        doc.on('rs-motions', 'click', (id, ev, key) => { if (key) setMotion(key); });
        doc.on('rs-emotions', 'click', (id, ev, key) => { if (key) setEmotion(key); });
        doc.on('rs-variants', 'click', (id, ev, key) => { if (key) { const [g, k] = key.split('/'); setVariant(g, k); } });
        doc.on('v-apply', 'click', () => applyPose(num('v-yaw') || 0, num('v-pitch') || 0));
        doc.on('v-reset', 'click', () => { s.size = 1; applyPose(0, 0); });
        doc.on('v-style-anime', 'click', () => setStyle('anime'));
        doc.on('v-style-pixel', 'click', () => setStyle('pixel'));
        doc.on('v-body', 'click', () => setBody(!s.body));
        doc.on('v-play', 'click', () => setPlaying(!s.playing));

        doc.on('rs-modes', 'click', (id, ev, key) => { if (key) showMode(key); });

        doc.on('rs-bones', 'click', (id, ev, key) => { if (key) selectBone(key); });
        doc.on('rs-sockets', 'click', (id, ev, key) => { if (key) selectSocket(key); });
        doc.on('b-apply', 'click', () => {
            if (!s.boneSel) return;
            const p = [num('b-px'), num('b-py'), num('b-pz')];
            const q = [num('b-qx'), num('b-qy'), num('b-qz')];
            const hasQ = q.every((n) => !Number.isNaN(n));
            ops.setBonePivot(s.boneSel, p, hasQ ? q : null);
        });
        doc.on('p-apply', 'click', () => ops.setPartBone(num('p-id'), String(doc.value('p-bone') || '').trim()));
        doc.on('k-apply', 'click', () => {
            if (!s.socketSel) return;
            ops.setSocket(s.socketSel, { point: [num('k-px'), num('k-py'), num('k-pz')], rotation: [num('k-rx'), num('k-ry'), num('k-rz')] });
        });
        doc.on('j-apply', 'click', () => {
            const b = num('j-body'), p = num('j-portrait');
            if (!Number.isNaN(b)) ops.setProjection('bodyScale', b);
            if (!Number.isNaN(p)) ops.setProjection('portraitScale', p);
        });
    }

    const api = {
        state: s, ops,
        openAsset, close, save, validate, setTab, showMode, inspect,
        applyPose, setMotion, setEmotion, setVariant, setStyle, setBody, setPlaying,
        selectBone, selectSocket, buildPreview, selectAuthor, previewAuthor, seek,
        get def() { return s.def; },
        snapshot() {
            const info = s.node ? $.re2dSprite.info(s.node) : null;
            return {
                active: s.active, file: s.path, tab: s.tab, mode: s.mode,
                yaw: s.yaw, pitch: s.pitch, style: s.style, body: s.body, playing: s.playing,
                motion: s.motion, emotion: s.emotion,
                node: !!s.node, nodeError: s.nodeError,
                runtime: info ? { version: info.version, style: info.style, width: info.width, reloads: info.reloads, reloadError: info.reloadError, hotReload: info.hotReload } : null,
                dirty: s.history ? s.history.dirty() : false,
                canUndo: s.history ? s.history.canUndo() : false,
                canRedo: s.history ? s.history.canRedo() : false,
                boneSel: s.boneSel, sample: s.lastSample,
                clips: R.clipNames(s.anim),
                codes: s.diagnostics.map((d) => d.code),
            };
        },
        renderAll,
    };

    app.studios = app.studios || {};
    app.studios.re2d = api;
    $.update(() => { tick(); });
    return api;
}
