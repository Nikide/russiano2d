// ===========================================================================
// Модель текстового документа редактора кода: строки, каретка, выделение,
// правки, история undo/redo и поиск. Без UI и без движка — проверяется в qjs
// (tests/js/editor_code_model_test.mjs).
//
// Позиция — { line, col }: line от 0, col — индекс UTF-16 внутри строки.
// Правка — всегда замена диапазона [from, to) текстом: так undo хранит одну
// форму записи, а соседние набранные символы склеиваются в один шаг.
// ===========================================================================

const MERGE_MS = 800;   // ввод с паузой меньше — один шаг undo
const TAB = '    ';
const isWordCharacter = (ch) => !!ch && /[\w$Ѐ-ӿ]/.test(ch);

export function splitLines(text) {
    return String(text).replace(/\r\n?/g, '\n').split('\n');
}

export function comparePos(a, b) {
    return a.line !== b.line ? a.line - b.line : a.col - b.col;
}

function clonePos(p) { return { line: p.line, col: p.col }; }

export function createCodeModel(text, opts) {
    const options = opts || {};
    const now = options.now || (() => Date.now());
    const m = {
        lines: splitLines(text === undefined ? '' : text),
        caret: { line: 0, col: 0 },
        anchor: null,          // начало выделения; null — выделения нет
        goalCol: null,         // желаемая колонка при движении вверх/вниз
        version: 0,            // растёт на каждой правке (для перерисовки)
        savedVersion: 0,
        undoStack: [],
        redoStack: [],
    };

    // --- базовые операции -------------------------------------------------

    function clamp(p) {
        const line = Math.max(0, Math.min(m.lines.length - 1, p.line));
        const col = Math.max(0, Math.min(m.lines[line].length, p.col));
        return { line, col };
    }

    function textRange(from, to) {
        if (from.line === to.line) return m.lines[from.line].slice(from.col, to.col);
        const out = [m.lines[from.line].slice(from.col)];
        for (let i = from.line + 1; i < to.line; i++) out.push(m.lines[i]);
        out.push(m.lines[to.line].slice(0, to.col));
        return out.join('\n');
    }

    // Заменяет [from, to) на text, возвращает позицию конца вставки.
    function rawReplace(from, to, text) {
        const parts = splitLines(text);
        const head = m.lines[from.line].slice(0, from.col);
        const tail = m.lines[to.line].slice(to.col);
        const inserted = parts.slice();
        inserted[0] = head + inserted[0];
        const endLine = from.line + parts.length - 1;
        const endCol = (parts.length === 1 ? head.length : 0) + parts[parts.length - 1].length;
        inserted[inserted.length - 1] += tail;
        m.lines.splice(from.line, to.line - from.line + 1, ...inserted);
        m.version++;
        return { line: endLine, col: endCol };
    }

    function selection() {
        if (!m.anchor || comparePos(m.anchor, m.caret) === 0) return null;
        return comparePos(m.anchor, m.caret) < 0
            ? { from: clonePos(m.anchor), to: clonePos(m.caret) }
            : { from: clonePos(m.caret), to: clonePos(m.anchor) };
    }

    function selectedLineRange() {
        const sel = selection();
        const first = sel ? sel.from.line : m.caret.line;
        const last = sel && sel.to.col === 0 && sel.to.line > first ? sel.to.line - 1
            : sel ? sel.to.line : m.caret.line;
        return { first, last };
    }

    function restorePositions(caret, anchor, lineDelta) {
        m.caret = clamp({ line: caret.line + lineDelta, col: caret.col });
        m.anchor = anchor ? clamp({ line: anchor.line + lineDelta, col: anchor.col }) : null;
        m.goalCol = null;
    }

    // Правка с записью в историю. kind склеивает ввод подряд ('type'/'delete').
    function edit(from, to, text, kind) {
        from = clamp(from); to = clamp(to);
        if (comparePos(from, to) > 0) { const t = from; from = to; to = t; }
        const removed = textRange(from, to);
        if (removed === '' && text === '') return false;
        const caretBefore = clonePos(m.caret), anchorBefore = m.anchor ? clonePos(m.anchor) : null;
        const end = rawReplace(from, to, text);
        const t = now();
        const last = m.undoStack[m.undoStack.length - 1];
        const canMerge = kind && last && last.kind === kind && t - last.time < MERGE_MS &&
            kind === 'type' && removed === '' && !/\n/.test(text) && !/\n/.test(last.text) &&
            comparePos(last.end, from) === 0;
        if (canMerge) {
            last.text += text;
            last.end = end;
            last.time = t;
        } else {
            m.undoStack.push({ from, removed, text, end, kind: kind || 'edit', time: t,
                               caretBefore, anchorBefore });
            if (m.undoStack.length > 2000) m.undoStack.shift();
        }
        m.redoStack.length = 0;
        m.caret = end;
        m.anchor = null;
        m.goalCol = null;
        return true;
    }

    // --- публичный API ----------------------------------------------------

    const api = {
        get lines() { return m.lines; },
        get caret() { return clonePos(m.caret); },
        get anchor() { return m.anchor ? clonePos(m.anchor) : null; },
        get version() { return m.version; },
        get dirty() { return m.version !== m.savedVersion; },
        lineCount() { return m.lines.length; },
        text() { return m.lines.join('\n'); },
        selection,
        selectedText() { const s = selection(); return s ? textRange(s.from, s.to) : ''; },
        canUndo() { return m.undoStack.length > 0; },
        canRedo() { return m.redoStack.length > 0; },
        markSaved() { m.savedVersion = m.version; },

        setText(text) {
            m.lines = splitLines(text);
            m.caret = clamp(m.caret); m.anchor = null;
            m.undoStack.length = 0; m.redoStack.length = 0;
            m.version++; m.savedVersion = m.version;
        },

        setCaret(pos, extend) {
            const p = clamp(pos);
            if (extend) { if (!m.anchor) m.anchor = clonePos(m.caret); }
            else m.anchor = null;
            m.caret = p;
            m.goalCol = null;
        },

        selectAll() {
            m.anchor = { line: 0, col: 0 };
            const last = m.lines.length - 1;
            m.caret = { line: last, col: m.lines[last].length };
        },

        // Слово под позицией (двойной щелчок).
        selectWord(pos) {
            const p = clamp(pos), s = m.lines[p.line];
            let a = p.col, b = p.col;
            while (a > 0 && isWordCharacter(s[a - 1])) a--;
            while (b < s.length && isWordCharacter(s[b])) b++;
            m.anchor = { line: p.line, col: a };
            m.caret = { line: p.line, col: b };
        },

        insert(text) {
            const sel = selection();
            const from = sel ? sel.from : m.caret, to = sel ? sel.to : m.caret;
            return edit(from, to, text, sel ? 'edit' : 'type');
        },

        // Enter: перенос с отступом текущей строки (+1 уровень после «{([»).
        newline() {
            const line = m.lines[m.caret.line];
            const indent = (line.match(/^\s*/) || [''])[0];
            const before = line.slice(0, m.caret.col).trimEnd();
            const extra = /[{([]$/.test(before) ? TAB : '';
            if (!selection() && extra && line.slice(m.caret.col).startsWith('}')) {
                const from = clonePos(m.caret);
                const inserted = '\n' + indent + extra + '\n' + indent;
                const changed = edit(from, from, inserted, 'edit');
                m.caret = { line: from.line + 1, col: indent.length + extra.length };
                m.anchor = null;
                return changed;
            }
            return api.insert('\n' + indent + extra);
        },

        wrapSelection(open, close) {
            const sel = selection();
            if (!sel || !open || !close) return false;
            const from = clonePos(sel.from), text = textRange(sel.from, sel.to);
            const changed = edit(sel.from, sel.to, open + text + close, 'edit');
            if (!changed) return false;
            m.anchor = endOf(from, open);
            m.caret = endOf(from, open + text);
            m.goalCol = null;
            return true;
        },

        deleteLine() {
            if (selection()) return edit(selection().from, selection().to, '', 'edit');
            const line = m.caret.line, last = m.lines.length - 1;
            if (last === 0) return edit({ line: 0, col: 0 }, { line: 0, col: m.lines[0].length }, '', 'edit');
            if (line < last) return edit({ line, col: 0 }, { line: line + 1, col: 0 }, '', 'edit');
            const prev = line - 1;
            return edit({ line: prev, col: m.lines[prev].length }, { line, col: m.lines[line].length }, '', 'edit');
        },

        duplicateLines(direction) {
            const { first, last } = selectedLineRange();
            const caret = clonePos(m.caret), anchor = m.anchor ? clonePos(m.anchor) : null;
            const block = m.lines.slice(first, last + 1);
            const shift = direction < 0 ? block.length : 0;
            if (direction < 0) {
                edit({ line: first, col: 0 }, { line: first, col: 0 }, block.join('\n') + '\n', 'edit');
            } else {
                const end = { line: last, col: m.lines[last].length };
                edit(end, end, '\n' + block.join('\n'), 'edit');
            }
            restorePositions(caret, anchor, shift);
            return true;
        },

        moveLines(direction) {
            const { first, last } = selectedLineRange();
            const lineCount = m.lines.length;
            if ((direction < 0 && first === 0) || (direction > 0 && last >= lineCount - 1)) return false;
            const caret = clonePos(m.caret), anchor = m.anchor ? clonePos(m.anchor) : null;
            if (direction < 0) {
                const before = m.lines[first - 1];
                const selected = m.lines.slice(first, last + 1);
                edit({ line: first - 1, col: 0 }, { line: last, col: m.lines[last].length },
                    selected.join('\n') + '\n' + before, 'edit');
                restorePositions(caret, anchor, -1);
            } else {
                const after = m.lines[last + 1];
                const selected = m.lines.slice(first, last + 1);
                edit({ line: first, col: 0 }, { line: last + 1, col: after.length },
                    after + '\n' + selected.join('\n'), 'edit');
                restorePositions(caret, anchor, 1);
            }
            return true;
        },

        tab(shift) {
            const sel = selection();
            if (!sel && !shift) return api.insert(TAB);
            const first = sel ? sel.from.line : m.caret.line;
            const last = sel ? (sel.to.col === 0 && sel.to.line > sel.from.line ? sel.to.line - 1 : sel.to.line) : m.caret.line;
            const block = [];
            for (let i = first; i <= last; i++) {
                const s = m.lines[i];
                if (shift) block.push(s.replace(/^( {1,4}|\t)/, ''));
                else block.push(TAB + s);
            }
            const from = { line: first, col: 0 }, to = { line: last, col: m.lines[last].length };
            const changed = edit(from, to, block.join('\n'), 'indent');
            m.anchor = { line: first, col: 0 };
            m.caret = { line: last, col: m.lines[last].length };
            return changed;
        },

        backspace() {
            const sel = selection();
            if (sel) return edit(sel.from, sel.to, '', 'delete');
            const c = m.caret;
            if (c.col === 0 && c.line === 0) return false;
            if (c.col === 0) return edit({ line: c.line - 1, col: m.lines[c.line - 1].length }, c, '', 'delete');
            const line = m.lines[c.line];
            const paired = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
            if (paired[line[c.col - 1]] === line[c.col])
                return edit({ line: c.line, col: c.col - 1 }, { line: c.line, col: c.col + 1 }, '', 'delete');
            // Отступ из пробелов стирается до предыдущей позиции табуляции.
            const head = line.slice(0, c.col);
            const back = /^ +$/.test(head) ? ((head.length - 1) % TAB.length) + 1 : 1;
            return edit({ line: c.line, col: c.col - back }, c, '', 'delete');
        },

        del() {
            const sel = selection();
            if (sel) return edit(sel.from, sel.to, '', 'delete');
            const c = m.caret;
            if (c.col < m.lines[c.line].length) return edit(c, { line: c.line, col: c.col + 1 }, '', 'delete');
            if (c.line < m.lines.length - 1) return edit(c, { line: c.line + 1, col: 0 }, '', 'delete');
            return false;
        },

        // Движение каретки: dir — left/right/up/down/home/end/wordLeft/wordRight/
        // pageUp/pageDown/docStart/docEnd. extend — с Shift (выделение).
        move(dir, extend, page) {
            const sel = selection();
            if (!extend && sel && (dir === 'left' || dir === 'right')) {
                m.caret = dir === 'left' ? sel.from : sel.to;
                m.anchor = null; m.goalCol = null;
                return;
            }
            if (extend) { if (!m.anchor) m.anchor = clonePos(m.caret); }
            else m.anchor = null;
            const c = m.caret, s = m.lines[c.line];
            const vertical = (delta) => {
                if (m.goalCol === null) m.goalCol = c.col;
                const line = Math.max(0, Math.min(m.lines.length - 1, c.line + delta));
                m.caret = { line, col: Math.min(m.goalCol, m.lines[line].length) };
            };
            switch (dir) {
            case 'left':
                m.caret = c.col > 0 ? { line: c.line, col: c.col - 1 }
                    : c.line > 0 ? { line: c.line - 1, col: m.lines[c.line - 1].length } : c;
                m.goalCol = null; return;
            case 'right':
                m.caret = c.col < s.length ? { line: c.line, col: c.col + 1 }
                    : c.line < m.lines.length - 1 ? { line: c.line + 1, col: 0 } : c;
                m.goalCol = null; return;
            case 'up': vertical(-1); return;
            case 'down': vertical(1); return;
            case 'pageUp': vertical(-(page || 20)); return;
            case 'pageDown': vertical(page || 20); return;
            case 'home': {
                // Первый щелчок — к первому непробельному, второй — к колонке 0.
                const first = s.length - s.trimStart().length;
                m.caret = { line: c.line, col: c.col === first ? 0 : first };
                m.goalCol = null; return;
            }
            case 'end': m.caret = { line: c.line, col: s.length }; m.goalCol = null; return;
            case 'docStart': m.caret = { line: 0, col: 0 }; m.goalCol = null; return;
            case 'docEnd': {
                const last = m.lines.length - 1;
                m.caret = { line: last, col: m.lines[last].length }; m.goalCol = null; return;
            }
            case 'wordLeft': {
                if (c.col === 0) { api.move('left', extend); return; }
                let i = c.col;
                while (i > 0 && /\s/.test(s[i - 1])) i--;
                const word = i > 0 && isWordCharacter(s[i - 1]);
                while (i > 0 && !/\s/.test(s[i - 1]) && isWordCharacter(s[i - 1]) === word) i--;
                m.caret = { line: c.line, col: i }; m.goalCol = null; return;
            }
            case 'wordRight': {
                if (c.col === s.length) { api.move('right', extend); return; }
                let i = c.col;
                while (i < s.length && /\s/.test(s[i])) i++;
                const word = i < s.length && isWordCharacter(s[i]);
                while (i < s.length && !/\s/.test(s[i]) && isWordCharacter(s[i]) === word) i++;
                m.caret = { line: c.line, col: i }; m.goalCol = null; return;
            }
            default: return;
            }
        },

        undo() {
            const rec = m.undoStack.pop();
            if (!rec) return false;
            rawReplace(rec.from, rec.end, rec.removed);
            m.redoStack.push(rec);
            m.caret = clonePos(rec.caretBefore);
            m.anchor = rec.anchorBefore ? clonePos(rec.anchorBefore) : null;
            m.caret = clamp(m.caret);
            return true;
        },

        redo() {
            const rec = m.redoStack.pop();
            if (!rec) return false;
            const removedEnd = endOf(rec.from, rec.removed);
            rec.end = rawReplace(rec.from, removedEnd, rec.text);
            m.undoStack.push(rec);
            m.caret = clonePos(rec.end);
            m.anchor = null;
            return true;
        },

        // Поиск: все вхождения (без учёта регистра по умолчанию).
        findAll(query, caseSensitive) {
            if (!query) return [];
            const q = caseSensitive ? query : query.toLowerCase();
            const out = [];
            for (let i = 0; i < m.lines.length; i++) {
                const s = caseSensitive ? m.lines[i] : m.lines[i].toLowerCase();
                let at = s.indexOf(q);
                while (at >= 0) {
                    out.push({ line: i, col: at, len: query.length });
                    at = s.indexOf(q, at + Math.max(1, q.length));
                }
            }
            return out;
        },

        // Следующее вхождение после каретки (по кругу); выделяет его.
        findNext(query, backwards, caseSensitive) {
            const hits = api.findAll(query, caseSensitive);
            if (!hits.length) return null;
            const c = m.caret;
            let hit;
            if (backwards) {
                const sel = selection();
                const ref = sel ? sel.from : c;
                hit = [...hits].reverse().find((h) => comparePos(h, ref) < 0) || hits[hits.length - 1];
            } else {
                hit = hits.find((h) => comparePos(h, c) >= 0 &&
                    !(selection() && comparePos(h, selection().from) === 0)) || hits[0];
            }
            m.anchor = { line: hit.line, col: hit.col };
            m.caret = { line: hit.line, col: hit.col + hit.len };
            return { hit, index: hits.indexOf(hit), total: hits.length };
        },

        replaceSelection(text) {
            const sel = selection();
            if (!sel) return false;
            return edit(sel.from, sel.to, text, 'edit');
        },

        replaceAll(query, text, caseSensitive) {
            const hits = api.findAll(query, caseSensitive);
            if (!hits.length) return 0;
            // Одной правкой целиком документа: один шаг undo.
            const src = api.text();
            const out = [];
            let last = 0;
            const offsets = lineOffsets();
            for (const h of hits) {
                const at = offsets[h.line] + h.col;
                out.push(src.slice(last, at), text);
                last = at + h.len;
            }
            out.push(src.slice(last));
            const lastLine = m.lines.length - 1;
            edit({ line: 0, col: 0 }, { line: lastLine, col: m.lines[lastLine].length }, out.join(''), 'replace');
            return hits.length;
        },

        // Переход к строке (1-based, как в Problems).
        goto(line, col) {
            api.setCaret({ line: Math.max(0, (line | 0) - 1), col: Math.max(0, ((col | 0) || 1) - 1) });
        },
    };

    function endOf(from, text) {
        const parts = splitLines(text);
        return parts.length === 1
            ? { line: from.line, col: from.col + parts[0].length }
            : { line: from.line + parts.length - 1, col: parts[parts.length - 1].length };
    }

    function lineOffsets() {
        const out = new Array(m.lines.length);
        let acc = 0;
        for (let i = 0; i < m.lines.length; i++) { out[i] = acc; acc += m.lines[i].length + 1; }
        return out;
    }

    return api;
}
