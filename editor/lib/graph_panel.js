// ===========================================================================
// Панель «Граф проекта» под редактором кода (docs/PROJECT_JSON.md §6).
//
// Документ — тот же RmlUi, что и вся оболочка Editor: карточки — div'ы,
// рёбра — осевые отрезки (RmlUi-рендерер не знает transform, поэтому диагоналей
// нет: связь рисуется «лесенкой»), масштаб — пересчётом размеров. Граф read-only:
// панель выбирает, открывает области и ведёт в код, но ничего не меняет.
// Данные и раскладка — editor/lib/shared/graph_model.js.
// ===========================================================================

import { overviewView, areaView, scenesView, resourcesView, searchGraph, locate, describe, STATUS_LABEL, CARD } from './shared/graph_model.js';
import { mousePx, inside, esc } from './studio_kit.js';

const ZOOMS = [0.5, 0.65, 0.8, 1, 1.25, 1.5];
const MIN_H = 120;
const HEAD_H = 36;
const VIEWS = [['overview', 'Обзор'], ['world', 'Мир'], ['scenes', 'Сцены'], ['resources', 'Ресурсы']];

export function createGraphPanel($, doc, host) {
    const icon = (name) => $.ui.icon(name) || '';
    const st = {
        view: { kind: 'overview', area: null }, selected: null,
        zoom: 3, pan: { x: 0, y: 0 }, collapsed: false, full: false, height: 280,
        results: [], drag: null, resize: null, wheel: 0, fitted: false, last: null, history: [],
    };

    function graph() { return host.graph(); }

    // --- вид -------------------------------------------------------------------------

    function currentView() {
        const g = graph();
        if (!g) return null;
        if (st.view.kind === 'scenes') return scenesView(g);
        if (st.view.kind === 'resources') return resourcesView(g);
        if (st.view.kind === 'area') {
            const v = areaView(g, st.view.area);
            if (v) return v;
            st.view = { kind: 'overview', area: null };
        }
        return overviewView(g);
    }

    function firstWorld() {
        const g = graph();
        return g && g.worlds.length ? g.worlds[0].key : null;
    }

    function setView(kind, area, keepHistory) {
        if (!keepHistory) st.history.push({ view: st.view, selected: st.selected });
        if (st.history.length > 50) st.history.shift();
        st.view = { kind, area: area || null };
        st.fitted = false;
        render();
    }

    function back() {
        const h = st.history.pop();
        if (!h) return false;
        st.view = h.view;
        st.selected = h.selected;
        st.fitted = false;
        render();
        return true;
    }

    function pick(key) {
        st.selected = key || null;
        host.select(st.selected);
        render(true);
    }

    /** Перейти к сущности или области (из поиска, крошек, Inspector). */
    function navigate(key) {
        const g = graph();
        if (!g) return false;
        const t = locate(g, key);
        if (!t) return false;
        const same = st.view.kind === t.view && st.view.area === (t.area || null);
        if (!same) { st.history.push({ view: st.view, selected: st.selected }); st.view = { kind: t.view, area: t.area || null }; st.fitted = false; }
        st.selected = t.select || key;
        host.select(st.selected);
        render();
        centerOn(st.selected);
        return true;
    }

    function open(node) {
        if (!node || !node.open) return false;
        setView('area', node.open);
        pick(null);
        return true;
    }

    // --- раскладка в пикселях ------------------------------------------------------------

    const Z = () => ZOOMS[st.zoom];

    function bodyRect() { return doc.rect('gp-body'); }

    function fit(view) {
        const r = bodyRect();
        if (!view || !r || !r.w || !r.h || !view.bounds.w) return;
        const k = Math.min(r.w / view.bounds.w, r.h / view.bounds.h, 1);
        let best = 0;
        for (let i = 0; i < ZOOMS.length; i++) if (ZOOMS[i] <= k + 0.001) best = i;
        best = Math.max(best, 1);   // мельче 65% текст не читается: остальное — панорамой и миникартой
        st.zoom = best;
        const z = Z();
        st.pan = { x: Math.max(0, Math.round((r.w - view.bounds.w * z) / 2)), y: 0 };
        st.fitted = true;
    }

    function centerOn(key) {
        const v = st.last, r = bodyRect();
        if (!v || !r) return;
        const n = v.nodes.find((x) => x.id === key);
        if (!n) return;
        const z = Z();
        st.pan = { x: Math.round(r.w / 2 - (n.x + n.w / 2) * z), y: Math.round(r.h / 2 - (n.y + n.h / 2) * z) };
        applyPan();
        renderMini();
    }

    function applyPan() { st.dirty = true; }

    // --- отрисовка ----------------------------------------------------------------------

    // Вид: смещение pan и размер области. Элементы рисуются сразу в координатах области и
    // отбрасываются, если выходят за её границы: RmlUi-обрезка (overflow) на части машин
    // не срабатывает, а «уехавшие» за край карточки поверх кода недопустимы.
    const V = { ox: 0, oy: 0, w: 0, h: 0 };
    const fits = (x, y, w, h) => x >= 0 && y >= 0 && x + w <= V.w && y + h <= V.h;

    const seg = (x, y, w, h, cls) => {
        x += V.ox; y += V.oy; w = Math.max(1, w); h = Math.max(1, h);
        if (!fits(x, y, w, h)) return '';
        return '<div class="gp-seg ' + cls + '" style="left: ' + Math.round(x) + 'px; top: ' + Math.round(y) + 'px; width: ' + Math.round(w) + 'px; height: ' + Math.round(h) + 'px;"></div>';
    };

    function edgeHtml(e, byId, z) {
        const a = byId.get(e.from), b = byId.get(e.to);
        if (!a || !b) return '';
        const x1 = (a.x + a.w) * z, y1 = (a.y + a.h / 2) * z, x2 = b.x * z, y2 = (b.y + b.h / 2) * z;
        const xm = x1 + (CARD.gx * z) / 2;
        const t = 'gp-e-' + e.type + (e.derived ? ' derived' : '');
        let html = seg(x1, y1 - 1, xm - x1, 2, t);
        html += seg(xm - 1, Math.min(y1, y2) - 1, 2, Math.abs(y2 - y1) + 2, t);
        html += seg(xm, y2 - 1, x2 - xm - 6 * z, 2, t);
        const ax = x2 - 14 * z + V.ox, ay = y2 - 9 * z + V.oy, as = Math.round(17 * z);
        if (fits(ax, ay, as, as)) html += '<span class="gp-arrow ' + t + '" style="left: ' + Math.round(ax) + 'px; top: ' + Math.round(ay) + 'px; font-size: ' + as + 'px;">' + icon('arrow_right') + '</span>';
        const lx = xm + 3 * z + V.ox, ly = y2 - 17 * z + V.oy, lf = Math.max(7, Math.round(10 * z));
        if (e.label && fits(lx, ly, (e.label.length * 0.62 + 1) * lf, lf + 4)) html += '<span class="gp-lbl" style="left: ' + Math.round(lx) + 'px; top: ' + Math.round(ly) + 'px; font-size: ' + lf + 'px;">' + esc(e.label) + '</span>';
        return html;
    }

    function cardHtml(n, z, sel) {
        const x = n.x * z + V.ox, y = n.y * z + V.oy, w = n.w * z, h = n.h * z;
        if (!fits(x, y, w, h)) return '';
        const fs = Math.max(7, Math.round(12 * z));
        return '<div class="gp-card k-' + n.kind + (n.root ? ' root' : '') + (sel === n.id ? ' sel' : '') + (n.missing ? ' missing' : '') + (n.dynamic ? ' dynamic' : '') +
            '" data-key="' + esc(n.id) + '" style="left: ' + Math.round(x) + 'px; top: ' + Math.round(y) + 'px; width: ' + Math.round(w) + 'px; height: ' + Math.round(h) + 'px; font-size: ' + fs + 'px;">' +
            '<span class="gp-ico">' + icon(n.icon) + '</span>' +
            '<span class="gp-txt"><span class="gp-t">' + esc(n.title) + '</span><span class="gp-s">' + esc(n.sub || '') + '</span></span>' +
            (n.badge ? '<span class="gp-badge">' + esc(n.badge) + '</span>' : '') +
            (n.open && !n.badge ? '<span class="gp-open">' + icon('chevron_right') + '</span>' : '') + '</div>';
    }

    function renderHead(view) {
        const g = graph();
        doc.html('gp-crumbs', view ? view.crumbs.map((c, i) =>
            (i ? '<span class="gp-sep">' + icon('chevron_right') + '</span>' : '') +
            '<span class="gp-crumb' + (i === view.crumbs.length - 1 ? ' last' : '') + '" data-key="crumb:' + i + '">' + esc(c.label) + '</span>').join('') : '');
        for (const [id] of VIEWS) {
            const on = id === 'world' ? st.view.kind === 'area' : st.view.kind === id;
            doc.cls('gp-view-' + id, 'on', on);
        }
        const s = host.state();
        const label = s.stale ? 'устарел' : STATUS_LABEL[g ? g.status : 'current'] || '';
        doc.text('gp-status', esc(g ? label : 'нет графа'));
        doc.cls('gp-status', 'warn', !!g && (s.stale || g.status !== 'current'));
        doc.cls('gp-status', 'bad', !g);
        doc.text('gp-warn', s.unsaved ? 'Код не сохранён · граф может быть устаревшим' : '');
        doc.cls('gp-warn', 'hidden', !s.unsaved);
        doc.text('gp-fullbtn', icon(st.full ? 'close_fullscreen' : 'open_in_full'));
    }

    function renderEmpty(g) {
        const info = host.state();
        let html = '';
        if (!g) {
            html = info.legacy
                ? '<span class="gp-empty-t">Граф хранится в project.json со schema_version 2.</span><button id="gp-migrate" class="btn primary">Перейти на schema_version 2</button>'
                : '<span class="gp-empty-t">Граф проекта ещё не построен.</span><button id="gp-index" class="btn primary">Построить связи проекта</button>';
        } else if (!g.entities.size) {
            html = '<span class="gp-empty-t">В JS проекта пока нет сцен и объектов.</span>';
        }
        doc.html('gp-empty', html);
        doc.cls('gp-empty', 'hidden', !html);
    }

    function render(light) {
        const g = graph();
        const view = currentView();
        st.last = view;
        renderHead(view);
        renderEmpty(g);
        if (!view || st.collapsed) { doc.html('gp-canvas', ''); doc.html('gp-mini', ''); return; }
        if (!st.fitted && !light) fit(view);
        const z = Z();
        const body = bodyRect();
        if (!body || !body.w || !body.h) { doc.html('gp-canvas', ''); return; }
        clampPan(view, body);
        Object.assign(V, { ox: st.pan.x, oy: st.pan.y, w: body.w, h: body.h });
        const byId = new Map(view.nodes.map((n) => [n.id, n]));
        let html = view.labels.map((l) => {
            const x = l.x * z + V.ox, y = l.y * z + V.oy, f = Math.max(8, Math.round(11 * z));
            return fits(x, y, l.text.length * 0.62 * f, f + 4) ? '<span class="gp-col" style="left: ' + Math.round(x) + 'px; top: ' + Math.round(y) + 'px; font-size: ' + f + 'px;">' + esc(l.text) + '</span>' : '';
        }).join('');
        html += view.edges.map((e) => edgeHtml(e, byId, z)).join('');
        html += view.nodes.map((n) => cardHtml(n, z, st.selected)).join('');
        doc.html('gp-canvas', html);
        renderMini();
    }

    // Содержимое нельзя утащить целиком за край: хотя бы часть остаётся в области.
    function clampPan(view, body) {
        const z = Z(), cw = view.bounds.w * z, ch = view.bounds.h * z, m = 80;
        st.pan.x = Math.round(Math.max(Math.min(0, body.w - cw) - m, Math.min(Math.max(0, body.w - cw) + m, st.pan.x)));
        st.pan.y = Math.round(Math.max(Math.min(0, body.h - ch) - m, Math.min(Math.max(0, body.h - ch) + m, st.pan.y)));
    }

    function renderMini() {
        const v = st.last, r = bodyRect();
        if (!v || !r || !v.bounds.w || st.collapsed) { doc.html('gp-mini', ''); return; }
        const W = 150, H = 86, k = Math.min(W / v.bounds.w, H / v.bounds.h);
        const z = Z();
        let html = v.nodes.map((n) => '<div class="gp-mn k-' + n.kind + '" style="left: ' + Math.round(n.x * k) + 'px; top: ' + Math.round(n.y * k) + 'px; width: ' + Math.max(2, Math.round(n.w * k)) + 'px; height: ' + Math.max(2, Math.round(n.h * k)) + 'px;"></div>').join('');
        const vx = Math.max(0, Math.min(W - 4, -st.pan.x / z * k)), vy = Math.max(0, Math.min(H - 4, -st.pan.y / z * k));
        const vw = Math.min(r.w / z * k, W - vx - 2), vh = Math.min(r.h / z * k, H - vy - 2);
        html += '<div class="gp-mv" style="left: ' + Math.round(vx) + 'px; top: ' + Math.round(vy) + 'px; width: ' + Math.max(4, Math.round(vw)) + 'px; height: ' + Math.max(4, Math.round(vh)) + 'px;"></div>';
        doc.html('gp-mini', html);
        st.miniScale = k;
    }

    function renderResults() {
        doc.html('gp-results', st.results.map((r, i) => '<div class="gp-res" data-key="res:' + i + '"><span class="gp-res-t">' + esc(r.label) + '</span><span class="gp-res-d">' + esc(r.detail || '') + '</span></div>').join(''));
        doc.cls('gp-results', 'hidden', !st.results.length);
    }

    // --- события ------------------------------------------------------------------------

    function zoomBy(delta, at) {
        const next = Math.max(0, Math.min(ZOOMS.length - 1, st.zoom + delta));
        if (next === st.zoom) return;
        const r = bodyRect(), old = Z();
        const px = at ? at.x : r.w / 2, py = at ? at.y : r.h / 2;
        const wx = (px - st.pan.x) / old, wy = (py - st.pan.y) / old;
        st.zoom = next;
        st.pan = { x: Math.round(px - wx * Z()), y: Math.round(py - wy * Z()) };
        render(true);
    }

    function bind() {
        doc.on('gp-canvas', 'click', (id, ev, key) => {
            if (st.dragMoved) return;
            if (!key) { pick(null); return; }
            pick(key);
        });
        doc.on('gp-canvas', 'dblclick', (id, ev, key) => {
            if (!key || !st.last) return;
            open(st.last.nodes.find((n) => n.id === key));
        });
        doc.on('gp-crumbs', 'click', (id, ev, key) => {
            if (!key || !key.startsWith('crumb:') || !st.last) return;
            const c = st.last.crumbs[parseInt(key.slice(6), 10)];
            if (!c) return;
            if (c.view === 'area') setView('area', c.area);
            else setView(c.view);
            if (c.select) pick(c.select);
        });
        for (const [vid] of VIEWS) {
            doc.on('gp-view-' + vid, 'click', () => {
                if (vid === 'world') { const w = firstWorld(); if (w) setView('area', w); else setView('overview'); }
                else setView(vid);
                pick(null);
            });
        }
        doc.on('gp-zoomout', 'click', () => zoomBy(-1));
        doc.on('gp-zoomin', 'click', () => zoomBy(1));
        doc.on('gp-fit', 'click', () => { st.fitted = false; render(); });
        doc.on('gp-backbtn', 'click', () => back());
        doc.on('gp-fullbtn', 'click', () => setFull(!st.full));
        doc.on('gp-reindex', 'click', () => host.reindex());
        doc.on('gp-code', 'click', () => {
            const g = graph();
            const row = g && st.selected ? describe(g, st.selected).find((r) => r[2]) : null;
            if (row) host.openSource(row[2].file, row[2].line);
        });
        doc.on('gp-empty', 'click', (id, ev, key, target) => {
            if (target === 'gp-migrate') host.migrate();
            else if (target === 'gp-index') host.reindex();
        });
        doc.on('gp-results', 'click', (id, ev, key) => {
            if (!key || !key.startsWith('res:')) return;
            const r = st.results[parseInt(key.slice(4), 10)];
            st.results = [];
            doc.setValue('gp-search', '');
            renderResults();
            if (r) navigate(r.key);
        });
    }

    function search() {
        const g = graph();
        const q = String(doc.value('gp-search') || '');
        if (q === st.query) return;
        st.query = q;
        st.results = g ? searchGraph(g, q, 12) : [];
        renderResults();
    }

    function setFull(on) { st.full = !!on; host.layout(); st.fitted = false; render(); }

    // Мышь по телу графа: перетаскивание, колесо, миникарта, ручка высоты.
    function update(dt) {
        if (st.dirty) { st.dirty = false; render(true); }
        search();
        const m = mousePx($);
        const body = bodyRect();
        // Раскладка документа догоняет показ панели через кадр: вписываем, когда размеры известны.
        if (!st.fitted && st.last && body && body.w > 0 && body.h > 0) render();
        const down = $.input.mouseDown('left');
        if (!body) return;
        const mini = doc.rect('gp-mini');
        const over = inside(m, body);
        if (over && inside(m, mini) && $.input.mousePressed('left') && st.miniScale) {
            const z = Z(), k = st.miniScale;
            st.pan = { x: Math.round(-((m.x - mini.x) / k) * z + body.w / 2), y: Math.round(-((m.y - mini.y) / k) * z + body.h / 2) };
            applyPan();
            return;
        }
        if (over) {
            const w = $.input.wheel();
            if (w && w.y && !$.ui.typing()) zoomBy(w.y > 0 ? -1 : 1, { x: m.x - body.x, y: m.y - body.y });
        }
        if (!down) { if (st.drag && st.dragMoved) { st.dragFrames = 3; } st.drag = null; }
        else if (st.drag) {
            const dx = m.x - st.drag.x, dy = m.y - st.drag.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) st.dragMoved = true;
            if (st.dragMoved) { st.pan = { x: st.drag.px + dx, y: st.drag.py + dy }; applyPan(); }
        } else if ($.input.mousePressed('left') && over && !inside(m, mini)) {
            st.drag = { x: m.x, y: m.y, px: st.pan.x, py: st.pan.y };
            st.dragMoved = false;
        }
        // click приходит в кадр отпускания: после перетаскивания глотаем его.
        if (!st.drag && st.dragMoved) { if ((st.dragFrames = (st.dragFrames || 0) - 1) <= 0) st.dragMoved = false; }
    }

    bind();
    doc.text('gp-backbtn', icon('arrow_back'));
    doc.text('gp-zoomout', icon('zoom_out'));
    doc.text('gp-zoomin', icon('zoom_in'));
    doc.text('gp-fit', icon('fit_screen'));
    doc.text('gp-code', icon('code'));
    doc.text('gp-reindex', icon('refresh'));
    doc.text('gp-fullbtn', icon('open_in_full'));
    return {
        state: st, render, update, navigate, back, setView, pick, zoomBy, setFull, fit: () => { st.fitted = false; render(); },
        head: () => renderHead(st.last), view: () => st.last, selected: () => st.selected,
        // для тестов: прямое действие над карточкой
        openNode: (key) => open(st.last && st.last.nodes.find((n) => n.id === key)),
        search: (q) => { const g = graph(); return g ? searchGraph(g, q, 12) : []; },
    };
}
