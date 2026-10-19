// Recovery хранит отдельный JSON рядом с ассетом. Исходник меняет только Save.
import { dirOf, joinPath } from './model.js';

export function createRecovery(app) {
    const $ = app.$, sessions = new Map();
    let dialog = null, current = null, elapsed = 0;
    const copy = value => JSON.parse(JSON.stringify(value));
    function pathOf(path) {
        return joinPath(dirOf(path), '.r2d-recovery-' + path.split('/').pop() + '.json');
    }
    function offer(entry) {
        if (!entry.pending) return;
        current = entry;
        if (!dialog) {
            dialog = $.ui.doc('sdk/ui/recovery.rml');
            dialog.on('recovery-restore', 'click', () => restore(current.path));
            dialog.on('recovery-discard', 'click', () => discard(current.path));
            dialog.on('recovery-later', 'click', () => dialog.hide());
        }
        dialog.text('recovery-path', entry.path);
        dialog.text('recovery-warning', entry.pending.base === entry.base
            ? 'Есть несохранённые правки прошлого запуска. Исходный файл не менялся.'
            : 'Исходный файл изменился после autosave. Восстановление заменит только рабочую модель; проверьте её перед Save.');
        dialog.show();
    }
    function watch(path, doc, history, changed) {
        const previous = sessions.get(path);
        if (previous && previous.history === history) { previous.changed = changed; return previous; }
        if (previous) flush(previous);
        const recoveryPath = pathOf(path);
        const raw = $.fs.readJSON(recoveryPath, null);
        const valid = raw && raw.version === 1 && raw.asset === path && raw.doc && typeof raw.doc === 'object'
            && !Array.isArray(raw.doc) && typeof raw.base === 'string';
        if (raw && !valid) app.addDiagnostic('warning', 'SDK_RECOVERY_INVALID', 'Некорректный recovery: ' + recoveryPath);
        const entry = { path, recoveryPath, doc, history, changed, base: JSON.stringify(doc), pending: valid ? raw : null, last: null };
        sessions.set(path, entry);
        const saved = history.markSaved.bind(history);
        history.markSaved = () => { saved(); entry.base = JSON.stringify(doc); entry.pending = null; entry.last = null; $.fs.remove(recoveryPath); };
        entry.offered = false;
        return entry;
    }
    function flush(entry) {
        if (entry.pending) return true;
        if (!entry.history.dirty()) {
            if (entry.last !== null) { $.fs.remove(entry.recoveryPath); entry.last = null; }
            return true;
        }
        const text = JSON.stringify(entry.doc);
        if (entry.last === text) return true;
        const ok = $.fs.write(entry.recoveryPath, JSON.stringify({version:1,asset:entry.path,base:entry.base,doc:copy(entry.doc)}, null, 2));
        if (ok) entry.last = text;
        else app.addDiagnostic('error', 'SDK_RECOVERY_WRITE', 'Не удалось сохранить recovery: ' + entry.recoveryPath);
        return ok;
    }
    function restore(path) {
        const entry = sessions.get(path);
        if (!entry || !entry.pending) return false;
        const recovered = copy(entry.pending.doc);
        entry.history.run('Восстановить autosave', model => {
            for (const key of Object.keys(model)) delete model[key];
            Object.assign(model, recovered);
        });
        entry.pending = null; entry.last = null;
        if (entry.changed) entry.changed();
        if (dialog) dialog.hide();
        flush(entry);
        return true;
    }
    function discard(path) {
        const entry = sessions.get(path);
        if (!entry) return false;
        if ($.fs.exists(entry.recoveryPath) && !$.fs.remove(entry.recoveryPath)) return false;
        entry.pending = null; entry.last = JSON.stringify(entry.doc);
        if (dialog) dialog.hide();
        return true;
    }
    return {
        watch, restore, discard,
        offer(path) { const entry = sessions.get(path); if (entry) offer(entry); },
        flush() { let ok = true; for (const entry of sessions.values()) ok = flush(entry) && ok; return ok; },
        tick(dt) { for (const entry of sessions.values()) if (entry.pending && !entry.offered) { entry.offered = true; offer(entry); break; } elapsed += dt; if (elapsed >= 2) { elapsed = 0; this.flush(); } },
        snapshot() { return Array.from(sessions.values(), e => ({asset:e.path,path:e.recoveryPath,pending:!!e.pending,dirty:e.history.dirty()})); },
    };
}
