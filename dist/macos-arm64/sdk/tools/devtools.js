// ===========================================================================
// DevTools — инспектор запущенной игры (docs/SDK.md §8, спецификация §18).
//
// Не редактор сцены: только чтение. Студия запускает игру headless и
// детерминированно (`fixed-dt`, seed) нативным клиентом исходного агентского
// протокола (`r2d-sdk agent`) и показывает ответы `state`, `query`, `profile`,
// скриншот. Сущности описывает игровой `$.agent` — те же понятия `$`, что у
// человека, игры и агента; второй реализации поиска нет.
// ===========================================================================

import { escapeHtml, joinPath, dirOf, absolutePath } from '../lib/model.js';
import * as views from '../lib/views.js';

export const standalone = true;

const DOC = 'sdk/ui/devtools.rml';
const CMDS = [['state', 'state — снимок мира'], ['query', 'query — сущности по селектору'], ['profile', 'profile — профиль кадра'], ['screenshot', 'screenshot — кадр']];

let singleton = null;

export async function open(app, args) {
    if (!singleton) singleton = create(app);
    return singleton.openProject(args.projectAbs || (app.state.project ? app.state.project.abs : ''));
}

/** Сессия протокола из полей формы: чистая функция (проверяется qjs-тестом). */
export function buildSession(f) {
    const requests = [{ cmd: 'ping' }];
    let extra = [];
    if (f.extra && String(f.extra).trim()) {
        extra = JSON.parse(f.extra);
        if (!Array.isArray(extra) || !extra.every((r) => r && typeof r === 'object' && typeof r.cmd === 'string')) throw new Error('Свои команды — массив объектов с полем cmd');
        if (extra.some((r) => r.cmd === 'quit')) throw new Error('quit не нужен: сессию завершает клиент сам');
    }
    for (const r of extra) requests.push(r);
    const frames = Math.max(0, Math.min(100000, parseInt(f.frames, 10) || 0));
    if (frames > 0) requests.push({ cmd: 'step', frames });
    if (f.cmds.state) requests.push({ cmd: 'state' });
    if (f.cmds.query) requests.push({ cmd: 'query', sel: f.sel || '*', limit: Math.max(0, parseInt(f.limit, 10) || 0) });
    if (f.cmds.profile) requests.push({ cmd: 'profile', sel: f.sel || '*' });
    if (f.cmds.screenshot) requests.push({ cmd: 'screenshot', path: f.shot });
    const session = { version: 1, game: f.game, seed: Math.max(0, parseInt(f.seed, 10) || 0), timeoutMs: 60000, requests };
    if (f.scene) session.scene = f.scene;
    return session;
}

function create(app) {
    const $ = app.$;
    const doc = $.ui.doc(DOC);
    const s = {
        active: false, game: '', cmds: { state: true, query: true, profile: true, screenshot: true }, busy: false, report: null,
        entities: [], selected: -1, profile: null, stateObj: null, shotPath: null, node: null, counter: 0, shotInfo: null, diagnostics: [], wired: false,
    };
    const rect = () => doc.rect('dt-view') || { x: 0, y: 0, w: 0, h: 0 };
    const val = (id) => String(doc.value(id) || '').trim();

    function openProject(abs) {
        s.active = true;
        s.game = abs || '';
        wire();
        if (app.doc) app.doc.hide();
        doc.show();
        $.gfx.color('#0b0e14');
        const size = $.gfx.size();
        $.camera.at(size.w / 2, size.h / 2).zoom(1);   // мир = экран: скриншот игры — обычный узел <sprite>
        doc.setValue('dt-game', s.game);
        renderCmds();
        renderAll();
        app.setStatus('DevTools', '');
        return { id: 'devtools', studio: api };
    }

    function close() {
        killShot();
        s.active = false;
        doc.hide();
        if (app.doc) app.doc.show();
        app.closeTool();
    }

    function killShot() { if (s.node) { s.node.remove(); s.node = null; } }

    function form() {
        return {
            game: absolutePath($.fs.basePath(), val('dt-game')), scene: val('dt-scene'), seed: val('dt-seed'), frames: val('dt-frames'),
            sel: val('dt-sel'), limit: val('dt-limit'), cmds: Object.assign({}, s.cmds), extra: String(doc.value('dt-extra') || ''),
            shot: joinPath($.fs.basePath() || '.', 'build/sdk_devtools/shot-' + (++s.counter) + '.png'),
        };
    }

    function fail(code, message) {
        s.diagnostics = [{ code, severity: 'error', asset: null, location: null, message, details: null }];
        renderAll();
        doc.text('dt-state', escapeHtml('ошибка: ' + message));
    }

    async function run() {
        if (s.busy) return null;
        const f = form();
        if (!f.game) { fail('SDK_USAGE', 'Укажите каталог игры'); return null; }
        let session;
        try { session = buildSession(f); } catch (e) { fail('SDK_DEVTOOLS_SESSION', e && e.message ? e.message : String(e)); return null; }
        $.fs.write(joinPath(dirOf(f.shot), '.keep'), '');      // каталог для скриншота
        const file = joinPath($.fs.basePath() || '.', 'build/sdk_devtools/session.agent.json');
        if (!$.fs.write(file, JSON.stringify(session, null, 2))) { fail('SDK_WRITE_FAILED', 'Не удалось записать ' + file); return null; }
        s.busy = true;
        doc.text('dt-state', 'игра запущена, опрашиваю…');
        const r = await app.backend(['agent', file], 'DevTools: опрос игры');
        s.busy = false;
        s.report = r.json;
        ingest(r.json, f);
        renderAll();
        return r.json;
    }

    /** Разложить ответы протокола по панелям. */
    function ingest(json, f) {
        s.entities = []; s.profile = null; s.stateObj = null; s.selected = -1; s.shotInfo = null;
        s.diagnostics = json && json.diagnostics ? json.diagnostics : [];
        const responses = json && json.responses ? json.responses : [];
        for (const r of responses) {
            if (r.state !== undefined) s.stateObj = { state: r.state, frame: r.frame, time: r.time };
            if (Array.isArray(r.nodes)) s.entities = r.nodes;
            if (r.profile) s.profile = r.profile;
            if (r.path && r.width) s.shotInfo = r;
        }
        killShot();
        if (s.shotInfo && $.fs.exists(s.shotInfo.path)) {
            s.shotPath = s.shotInfo.path;
            s.node = $('<sprite>', { src: s.shotPath }).appendTo($.world);
        }
        doc.text('dt-state', escapeHtml(json && json.ok ? 'готово: ответов ' + responses.length + (s.entities.length ? ', сущностей ' + s.entities.length : '') : 'есть ошибки (см. диагностику)'));
    }

    function nodeLabel(n) { return (n.tag || '?') + (n.id ? '#' + n.id : '') + (n.class ? '.' + String(n.class).split(/\s+/).join('.') : (n.classes && n.classes.length ? '.' + n.classes.join('.') : '')); }

    function renderCmds() {
        doc.html('dt-cmds', CMDS.map(([k, t]) => '<div class="field-row"><button class="btn small' + (s.cmds[k] ? ' on' : '') + '" data-key="' + k + '">' + escapeHtml(t) + '</button></div>').join(''));
    }

    function kv(obj) {
        return Object.keys(obj).map((k) => {
            const v = obj[k];
            return '<div class="kv"><span class="k">' + escapeHtml(k) + '</span><span class="v">' + escapeHtml(typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)) + '</span></div>';
        }).join('');
    }

    function renderAll() {
        if (!s.active) return;
        doc.html('dt-entities', s.entities.length ? '<div class="list grow">' + s.entities.map((n, i) =>
            '<div class="row' + (i === s.selected ? ' sel' : '') + '" data-key="' + i + '"><span class="row-name">' + escapeHtml(nodeLabel(n)) + '</span><span class="row-dir">' +
            (n.x !== undefined ? Math.round(n.x) + ', ' + Math.round(n.y) : '') + (n.hp !== undefined ? ' · hp ' + n.hp : '') + '</span></div>').join('') + '</div>' : '<p class="empty">Нет данных: запустите опрос.</p>');
        const n = s.entities[s.selected];
        doc.html('dt-node', n ? kv(n) + '<div class="hint">Селектор для кода: <span class="mono">' + escapeHtml(n.id ? '#' + n.id : nodeLabel(n)) + '</span></div>' : '<p class="empty">Выберите сущность.</p>');
        let prof = '<p class="empty">Нет данных.</p>';
        if (s.profile) {
            const fr = s.profile.frame || {};
            prof = kv({ 'сущностей по селектору': s.profile.count, тел: s.profile.bodies, 'кадр, мс': fr.frame_ms === undefined ? '—' : Number(fr.frame_ms).toFixed(2) });
            const zones = (fr.zones || []).filter((z) => z.valid !== false).sort((a, b) => b.ms - a.ms).slice(0, 8);
            prof += zones.map((z) => '<div class="kv"><span class="k">' + escapeHtml(z.name) + '</span><span class="v">' + Number(z.ms).toFixed(3) + ' мс</span></div>').join('');
        }
        doc.html('dt-profile', prof);
        doc.text('dt-log', escapeHtml(s.report ? JSON.stringify(s.report.responses || s.report, null, 1).slice(0, 6000) : ''));
        placeShot();
        doc.text('dt-hud', escapeHtml(s.shotInfo ? 'кадр игры ' + s.shotInfo.width + '×' + s.shotInfo.height + ' · ' + (s.stateObj ? 'кадр ' + s.stateObj.frame : '') : 'скриншот появится после запуска'));
    }

    function placeShot() {
        if (!s.node || !s.shotInfo) return;
        const r = rect();
        if (r.w <= 0) return;
        const k = Math.min((r.w - 24) / s.shotInfo.width, (r.h - 24) / s.shotInfo.height, 1);
        s.node.at(r.x + r.w / 2, r.y + r.h / 2).size(s.shotInfo.width * k, s.shotInfo.height * k);
    }

    async function saveSession() {
        const f = form();
        try {
            const session = buildSession(f);
            const proj = app.state.project;
            const out = joinPath(proj ? proj.abs : ($.fs.basePath() || '.'), 'devtools.agent.json');
            if (!$.fs.write(out, JSON.stringify(session, null, 2))) throw new Error('Не удалось записать ' + out);
            doc.text('dt-state', escapeHtml('сессия сохранена: ' + out + ' (запускается в Automation)'));
            return out;
        } catch (e) { fail('SDK_DEVTOOLS_SESSION', e && e.message ? e.message : String(e)); return null; }
    }

    function wire() {
        if (s.wired) return;
        s.wired = true;
        doc.on('dt-back', 'click', () => close());
        doc.on('dt-run', 'click', () => run());
        doc.on('dt-save', 'click', () => saveSession());
        doc.on('dt-cmds', 'click', (id, ev, key) => { if (key) { s.cmds[key] = !s.cmds[key]; renderCmds(); } });
        doc.on('dt-entities', 'click', (id, ev, key) => { if (key !== '' && key !== undefined) { s.selected = parseInt(key, 10); renderAll(); } });
    }

    $.update(() => { if (s.active) placeShot(); });

    const api = {
        state: s, openProject, close, run, saveSession,
        select(i) { s.selected = i; renderAll(); return s.selected; },
        toggle(cmd) { s.cmds[cmd] = !s.cmds[cmd]; renderCmds(); return s.cmds[cmd]; },
        snapshot() {
            return {
                active: s.active, busy: s.busy, game: s.game, ok: s.report ? !!s.report.ok : null, entities: s.entities.length, selected: s.selected,
                frame: s.stateObj ? s.stateObj.frame : null, profile: !!s.profile, screenshot: !!s.node, codes: s.diagnostics.map((d) => d.code),
            };
        },
    };
    app.studios = app.studios || {};
    app.studios.devtools = api;
    return api;
}
