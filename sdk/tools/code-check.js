// Code Check / API browser panel: thin GUI over native r2d-sdk doctor/lint/
// validate and the generated API schema. No second linter/validator in JS.
import { escapeHtml } from '../../editor/lib/shared/model.js';

let singleton;
export const standalone = true;

export async function open(app, args) {
    if (!singleton) singleton = create(app);
    return singleton.open(args || {});
}

function create(app) {
    const $ = app.$, doc = $.ui.doc('sdk/ui/code_check.rml');
    const s = { active: false, busy: false, project: 'game', tab: 'doctor', report: null };

    function render() {
        const json = s.report ? JSON.stringify(s.report, null, 2) : 'Нажмите «Doctor», «Lint» или «Validate».';
        doc.text('cc-report', json);
        const ok = s.report && s.report.ok !== false;
        doc.text('cc-state', s.report ? (ok ? 'готово' : 'есть ошибки') : '');
        const diags = (s.report && s.report.diagnostics) || [];
        doc.html('cc-diag', diags.map(d => '<div class="diag diag-err">' +
            escapeHtml(String(d.code || '')) + ' ' + escapeHtml(String(d.message || '')) + '</div>').join(''));
        doc.cls('cc-diag', 'diag-empty', diags.length === 0);
    }

    async function run(args, label) {
        if (s.busy) return null;
        s.busy = true;
        try {
            doc.text('cc-state', 'выполняю…');
            const r = await app.backend(args, label);
            s.report = r.json;
            render();
            return s.report;
        } catch (e) {
            doc.text('cc-state', 'ошибка: ' + e.message);
            return null;
        } finally {
            s.busy = false;
        }
    }

    function api() {
        s.tab = 'api';
        const text = $.fs.readText('api.schema.json');
        s.report = null;
        doc.text('cc-report', text ? text.slice(0, 20000) : 'api.schema.json не найден: выполните r2d-sdk api generate');
        doc.text('cc-state', text ? 'schema загружена' : 'нет schema');
        doc.html('cc-diag', '');
    }
    function doctor() { s.tab = 'doctor'; return run(['doctor', '--project', s.project], 'SDK Doctor'); }
    function lint() { s.tab = 'lint'; return run(['lint', s.project], 'SDK Lint'); }
    function validate() { s.tab = 'validate'; return run(['validate', s.project], 'SDK Validate'); }

    function openOpts(args) {
        s.active = true;
        if (args && args.project) s.project = String(args.project);
        else if (app.state && app.state.project && app.state.project.abs) s.project = app.state.project.abs;
        if (app.doc) app.doc.hide();
        doc.show();
        doc.setValue('cc-project', s.project);
        render();
        return panel;
    }
    function close() { s.active = false; doc.hide(); app.closeTool(); }

    doc.on('cc-back', 'click', close);
    doc.on('cc-doctor', 'click', doctor);
    doc.on('cc-lint', 'click', lint);
    doc.on('cc-validate', 'click', validate);
    doc.on('cc-api', 'click', api);
    doc.on('cc-project', 'change', () => { s.project = String(doc.value('cc-project') || 'game'); });

    const panel = {
        state: s, open: openOpts, close, doctor, lint, validate, api,
        snapshot() { return { active: s.active, busy: s.busy, project: s.project, tab: s.tab, report: s.report }; },
    };
    app.studios['code-check'] = panel;
    app.studios['api-browser'] = panel;
    return panel;
}
