// ===========================================================================
// Re2D Baker (GUI) — GLB/glTF → нативный ассет Re2DSprite (docs/SDK.md §10).
//
// Тонкая оболочка над нативным `r2d-sdk bake-re2d`: вся работа (парсинг,
// вписывание, раскладка, растеризация, запись PNG v2) — один код C для GUI,
// CLI и агента. 3D нужен только здесь, на этапе импорта: результат — PNG v2 и
// `*.character.json`, runtime ничего не знает про GLB.
//
// Превью — настоящий рантайм: запечённая модель вращается обычным
// `$.re2dSprite`.
// ===========================================================================

import { escapeHtml, dirOf, joinPath, absolutePath } from '../lib/model.js';
import * as views from '../lib/views.js';

const DOC = 'sdk/ui/baker.rml';
const SIZES = [1024, 2048, 4096];
let singleton = null;

export async function open(app, args) {
    if (!singleton) singleton = createBaker(app);
    return singleton.openAsset(args.assetAbs || args.asset || null);
}

export function createBaker(app) {
    const $ = app.$;
    const doc = $.ui.doc(DOC);
    const s = {
        active: false, source: null,
        type: 'prop', uv: 'auto', size: 1024, origin: 'center',
        report: null, outDir: '', name: '', node: null, spin: true, yaw: 0, diagnostics: [],
    };
    let wired = false;

    const slot = () => doc.rect('bk-view') || { x: 0, y: 0, w: 0, h: 0 };

    function setDiag(list) {
        s.diagnostics = list || [];
        doc.html('bk-diag', views.diagRows(s.diagnostics));
    }

    async function openAsset(abs) {
        if (!abs || !/\.(glb|gltf|vrm)$/i.test(abs)) throw new Error('Re2D Baker: выберите модель .glb, .gltf или .vrm');
        s.source = abs;
        s.report = null;
        s.type = /\.vrm$/i.test(abs) ? 'character' : 'prop';
        s.name = abs.split('/').pop().replace(/\.[^.]+$/, '');
        s.outDir = joinPath(dirOf(abs), s.name);
        killNode();
        s.active = true;
        if (app.doc) app.doc.hide();
        doc.show();
        wire();
        const size = $.gfx.size();
        $.camera.at(size.w / 2, size.h / 2).zoom(1);
        doc.setValue('bk-out', s.outDir);
        doc.setValue('bk-name', s.name);
        app.setStatus('Re2D Baker: ' + abs.split('/').pop(), '');
        setDiag([]);
        render();
        return { id: 're2d-baker', baker: api };
    }

    function close() {
        s.active = false;
        killNode();
        doc.hide();
        if (app.doc) app.doc.show();
        app.closeTool();
    }

    function killNode() {
        if (s.node) { try { $(s.node).remove(); } catch (e) { /* уже убран */ } s.node = null; }
    }

    // --- Запекание -------------------------------------------------------------------------------
    function bakeArgs() {
        const args = ['bake-re2d', s.source, '--type', s.type, '--output', s.outDir, '--name', s.name,
                      '--uv', s.uv, '--size', String(s.size), '--origin', s.origin];
        const scale = parseFloat(String(doc.value('bk-scale') || '').replace(',', '.'));
        if (Number.isFinite(scale) && scale > 0) args.push('--scale', String(scale));
        return args;
    }

    async function bake() {
        if (!s.source) return null;
        s.outDir = normalize(doc.value('bk-out')) || s.outDir;
        s.name = String(doc.value('bk-name') || '').trim() || s.name;
        doc.text('bk-state', 'запекаю…');
        const r = await app.backend(bakeArgs(), 'bake ' + s.name);
        const json = r.json;
        s.report = json;
        setDiag(json ? json.diagnostics : []);
        doc.text('bk-state', json && json.ok ? 'готово' : 'не удалось');
        app.setStatus(json && json.ok ? 'bake: ' + (json.parts || 0) + ' частей, использовано ' + Math.round((json.atlasUsage || 0) * 100) + '% атласа' : 'bake не удался',
                      json && json.ok ? '' : 'fail');
        if (json && json.ok) previewResult(json.files.character);
        render();
        return json;
    }

    function normalize(p) {
        return absolutePath($.fs.basePath() || '', String(p || '').trim());
    }

    async function autoFit() {
        doc.setValue('bk-scale', '');
        return bake();
    }

    function previewResult(characterPath) {
        killNode();
        try {
            const r = slot();
            const node = $.re2dSprite.from(characterPath, { id: 'sdk-bake-preview' }).at(r.x + r.w / 2, r.y + r.h / 2).size(300, 300);
            node.re2dMotion('spin', 0);
            s.node = node.get(0);
        } catch (e) {
            s.node = null;
            s.diagnostics = s.diagnostics.concat([{ code: 'SDK_RE2D_RUNTIME', severity: 'error', asset: characterPath, location: null,
                message: 'Рантайм не принял результат: ' + (e && e.message ? e.message : e), details: null }]);
            doc.html('bk-diag', views.diagRows(s.diagnostics));
        }
    }

    async function openResult() {
        if (!s.report || !s.report.ok) return null;
        killNode();
        s.active = false;
        doc.hide();
        return app.openTool('re2dsprite-studio', { assetAbs: s.report.files.character });
    }

    // --- Интерфейс ---------------------------------------------------------------------------------
    function fitHtml() {
        const r = s.report;
        if (!r || !r.fit) return '<p class="empty">Запечь, чтобы увидеть вписывание.</p>';
        const f = r.fit;
        const row = (axis, range, limit) => {
            const ok = range[0] >= limit[0] - 1e-3 && range[1] <= limit[1] + 1e-3;
            const used = Math.round(((range[1] - range[0]) / (limit[1] - limit[0])) * 100);
            return '<div class="kv">' + axis + ' &nbsp; [' + range[0].toFixed(2) + ' … ' + range[1].toFixed(2) + '] &nbsp; ' + used + '% диапазона &nbsp; ' + (ok ? '✓' : 'ВНЕ') + '</div>';
        };
        return row('X', f.x, f.limits.x) + row('Y', f.y, f.limits.y) + row('Z', f.z, f.limits.z) +
            '<div class="kv">Scale: ' + escapeHtml(String(f.scale)) + ' · Origin: ' + escapeHtml(f.origin) + '</div>';
    }

    function reportHtml() {
        const r = s.report;
        if (!r) return '<p class="empty">Отчёта ещё нет.</p>';
        if (!r.source) return '<div class="kv">ok: ' + r.ok + '</div>';
        const ch = r.character;
        const chHtml = !ch ? '' :
            '<div class="kv">VRM ' + (ch.vrm.version ? '1.0' : '0.x') + ' · «' + escapeHtml(ch.vrm.title || '—') + '» · humanoid-костей: ' + ch.vrm.humanBones +
            (ch.vrm.rotated180 ? ' · повёрнут на 180°' : '') + '</div>' +
            '<div class="kv">Владение: ' + ch.ownership.triangles + ' треугольников, неоднозначных ' + ch.ownership.ambiguous +
            (ch.ownership.pairs.length ? ' (' + ch.ownership.pairs.map((p) => escapeHtml(p.a + '/' + p.b) + ' ' + p.triangles).join(', ') + ')' : '') + '</div>' +
            '<div class="kv">Выражения: ' + (ch.expressions.length ? ch.expressions.map((e) => escapeHtml(e.vrm) + '→' + escapeHtml(e.re2d || '—')).join(', ') : 'нет') + '</div>';
        return chHtml + '<div class="kv">Треугольников: ' + r.source.triangles + ' · материалов: ' + r.source.materials + ' · текстур: ' + r.source.textures + '</div>' +
            '<div class="kv">Частей: ' + r.parts + ' · отсчётов: ' + r.samples + ' (' + Math.round(r.atlasUsage * 1000) / 10 + '% атласа)</div>' +
            '<div class="kv">UV: ' + escapeHtml(r.uvMode) + ' · PNG ' + r.size + ' · шаг ' + (r.sampleSpacing || 0).toFixed(2) + ' ед.</div>' +
            '<div class="kv">Ошибок ' + r.errors + ' · предупреждений ' + r.warnings + '</div>' +
            (r.files && r.files.character ? '<div class="kv">' + escapeHtml(r.files.character) + '</div>' : '');
    }

    function render() {
        doc.text('bk-source', escapeHtml(s.source || '—'));
        for (const sz of SIZES) doc.cls('bk-size-' + sz, 'on', s.size === sz);
        for (const t of ['prop', 'character']) doc.cls('bk-type-' + t, 'on', s.type === t);
        doc.cls('bk-uv-auto', 'on', s.uv === 'auto');
        doc.cls('bk-uv-existing', 'on', s.uv === 'existing');
        doc.cls('bk-origin-center', 'on', s.origin === 'center');
        doc.cls('bk-origin-feet', 'on', s.origin === 'feet');
        doc.html('bk-fit', fitHtml());
        doc.html('bk-report', reportHtml());
        doc.text('bk-hud', s.report && s.report.ok ? 'готово: вращается настоящий Re2DSprite' : 'модель ещё не запечена');
    }

    function tick(dt) {
        if (!s.active || !s.node) return;
        const r = slot();
        $(s.node).at(r.x + r.w / 2, r.y + r.h / 2).size(Math.max(64, Math.min(r.w, r.h) - 40), Math.max(64, Math.min(r.w, r.h) - 40));
        if (s.spin) {
            s.yaw = (s.yaw + 40 * dt) % 360;
            $(s.node).re2dPose(s.yaw > 180 ? s.yaw - 360 : s.yaw, 12);
        }
    }

    function setOpt(key, value) {
        s[key] = value;
        render();
        return s[key];
    }

    function wire() {
        if (wired) return;
        wired = true;
        doc.on('bk-back', 'click', () => close());
        doc.on('bk-run', 'click', () => bake());
        doc.on('bk-autofit', 'click', () => autoFit());
        doc.on('bk-open', 'click', () => openResult());
        doc.on('bk-uv-auto', 'click', () => setOpt('uv', 'auto'));
        doc.on('bk-uv-existing', 'click', () => setOpt('uv', 'existing'));
        doc.on('bk-uv-opt', 'click', () => { s.uv = 'optimized'; render(); });
        for (const sz of SIZES) doc.on('bk-size-' + sz, 'click', () => setOpt('size', sz));
        doc.on('bk-origin-center', 'click', () => setOpt('origin', 'center'));
        doc.on('bk-origin-feet', 'click', () => setOpt('origin', 'feet'));
        for (const [id, type] of [['bk-type-prop', 'prop'], ['bk-type-character', 'character'], ['bk-type-weapon', 'weapon'], ['bk-type-env', 'environment']]) {
            doc.on(id, 'click', () => setOpt('type', type));
        }
    }

    const api = {
        state: s,
        openAsset, close, bake, autoFit, openResult, setOpt,
        snapshot() {
            const r = s.report;
            return {
                active: s.active, source: s.source, type: s.type, uv: s.uv, size: s.size, origin: s.origin,
                ok: r ? !!r.ok : null, parts: r ? r.parts : null, atlasUsage: r ? r.atlasUsage : null,
                fit: r ? r.fit : null, character: r && r.character ? r.character : null, codes: s.diagnostics.map((d) => d.code), preview: !!s.node,
                files: r ? r.files : null,
            };
        },
        render,
    };

    app.studios = app.studios || {};
    app.studios.baker = api;
    $.update((dt) => { tick(dt); });
    return api;
}
