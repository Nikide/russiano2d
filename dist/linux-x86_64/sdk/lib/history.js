// ===========================================================================
// История правок (undo/redo) для редакторов SDK: команда = снимок «до» и
// «после» (docs/SDK.md §5). Модель — любой JSON-совместимый объект; он
// меняется на месте, поэтому ссылки на него остаются живыми.
// ===========================================================================

function replaceContents(target, source) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, source);
}

export function createHistory(doc, limit = 200) {
    const undo = [];
    const redo = [];
    let saved = JSON.stringify(doc);
    return {
        /** Выполнить правку модели как одну команду. Ошибка откатывает модель. */
        run(label, fn) {
            const before = JSON.stringify(doc);
            let result;
            try {
                result = fn(doc);
            } catch (e) {
                replaceContents(doc, JSON.parse(before));
                throw e;
            }
            const after = JSON.stringify(doc);
            if (after !== before) {
                undo.push({ label, before, after });
                if (undo.length > limit) undo.shift();
                redo.length = 0;
            }
            return result;
        },
        undo() {
            const cmd = undo.pop();
            if (!cmd) return null;
            replaceContents(doc, JSON.parse(cmd.before));
            redo.push(cmd);
            return cmd.label;
        },
        redo() {
            const cmd = redo.pop();
            if (!cmd) return null;
            replaceContents(doc, JSON.parse(cmd.after));
            undo.push(cmd);
            return cmd.label;
        },
        canUndo() { return undo.length > 0; },
        canRedo() { return redo.length > 0; },
        labels() { return { undo: undo.map((c) => c.label), redo: redo.map((c) => c.label) }; },
        markSaved() { saved = JSON.stringify(doc); },
        dirty() { return JSON.stringify(doc) !== saved; },
    };
}
