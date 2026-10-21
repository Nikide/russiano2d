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
const SPACES = '    ';

// Отступ в проекте — только табы: четыре пробела в начале строки запрещены и
// превращаются в таб при сохранении (normalizeIndent).
const INDENT = '\t';
const isWordCharacter = (ch) => !!ch && /[\w$Ѐ-ӿ]/.test(ch);

import { reindentLines, indentColumns } from './format.js';

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
        extra: [],             // дополнительные курсоры: { caret, anchor, goalCol }
        inMulti: false,
        group: 0,              // номер пакетной правки (один шаг undo на все курсоры)
        savedRec: null,        // запись undo на момент сохранения (null — пустая история)
        undoStack: [],
        redoStack: [],
    };
    const TAB = INDENT;

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
        if (m.extra.length && !m.inMulti) m.extra = [];
        from = clamp(from); to = clamp(to);
        if (comparePos(from, to) > 0) { const t = from; from = to; to = t; }
        const removed = textRange(from, to);
        if (removed === text) return false;
        const caretBefore = clonePos(m.caret), anchorBefore = m.anchor ? clonePos(m.anchor) : null;
        const end = rawReplace(from, to, text);
        const t = now();
        const last = m.undoStack[m.undoStack.length - 1];
        const fresh = !m.inMulti && last && !last.group && last !== m.savedRec && t - last.time < MERGE_MS && last.kind === kind;
        const mergeType = fresh && kind === 'type' && removed === '' && !/\n/.test(text) &&
            !/\n/.test(last.text) && comparePos(last.end, from) === 0;
        // Серия Backspace / Delete — один шаг undo (как в VS Code).
        const oneLine = fresh && kind === 'delete' && text === '' && last.text === '' &&
            !/\n/.test(removed) && !/\n/.test(last.removed);
        const mergeBack = oneLine && comparePos(last.from, to) === 0;
        const mergeFwd = oneLine && comparePos(last.from, from) === 0;
        if (mergeType) {
            last.text += text;
            last.end = end;
            last.time = t;
        } else if (mergeBack) {
            last.removed = removed + last.removed;
            last.from = from;
            last.end = from;
            last.time = t;
        } else if (mergeFwd) {
            last.removed += removed;
            last.time = t;
        } else {
            m.undoStack.push({ from, removed, text, end, kind: kind || 'edit', time: t,
                               caretBefore, anchorBefore, group: m.inMulti ? m.group : 0 });
            if (m.undoStack.length > 2000) m.undoStack.shift();
        }
        m.redoStack.length = 0;
        m.caret = end;
        m.anchor = null;
        m.goalCol = null;
        return true;
    }

    // Заменяет строки first..last результатом fn(line) -> { text, map(col) }.
    // Каретка и якорь переезжают через map, так что выделение сохраняется.
    function transformLines(first, last, fn, kind) {
        const caret = clonePos(m.caret), anchor = m.anchor ? clonePos(m.anchor) : null;
        const results = [];
        for (let i = first; i <= last; i++) results.push(fn(m.lines[i], i));
        const changed = edit({ line: first, col: 0 }, { line: last, col: m.lines[last].length },
            results.map((r) => r.text).join('\n'), kind);
        const remap = (p) => (p.line < first || p.line > last) ? p
            : { line: p.line, col: Math.max(0, results[p.line - first].map(p.col)) };
        m.caret = clamp(remap(caret));
        m.anchor = anchor ? clamp(remap(anchor)) : null;
        m.goalCol = null;
        return changed;
    }

    // Одинаково разобранные параметры поиска: boolean = caseSensitive (старый API).
    function findOptions(o) {
        if (o && typeof o === 'object') return { caseSensitive: !!o.caseSensitive, wholeWord: !!o.wholeWord, regex: !!o.regex };
        return { caseSensitive: !!o, wholeWord: false, regex: false };
    }

    function hitsInLines(query, o, first, last) {
        m.findError = '';
        if (!query) return [];
        const out = [];
        let re = null;
        if (o.regex) {
            try { re = new RegExp(query, o.caseSensitive ? 'g' : 'gi'); }
            catch (e) { m.findError = String(e && e.message || e); return []; }
        }
        const q = o.caseSensitive ? query : query.toLowerCase();
        for (let i = Math.max(0, first); i <= Math.min(last, m.lines.length - 1); i++) {
            const line = m.lines[i];
            const boundary = (a, b) => !o.wholeWord || (!isWordCharacter(line[a - 1]) && !isWordCharacter(line[b]));
            if (re) {
                re.lastIndex = 0;
                let r;
                while ((r = re.exec(line))) {
                    if (r[0] === '') { re.lastIndex++; continue; }
                    if (boundary(r.index, r.index + r[0].length)) out.push({ line: i, col: r.index, len: r[0].length, match: r });
                }
            } else {
                const hay = o.caseSensitive ? line : line.toLowerCase();
                let at = hay.indexOf(q);
                while (at >= 0) {
                    if (boundary(at, at + q.length)) out.push({ line: i, col: at, len: q.length });
                    at = hay.indexOf(q, at + Math.max(1, q.length));
                }
            }
        }
        return out;
    }

    function expandReplacement(text, hit) {
        if (!hit.match) return text;
        return text.replace(/\$(\d+|&|\$)/g, (all, g) => g === '$' ? '$' : g === '&' ? hit.match[0] : (hit.match[+g] === undefined ? all : hit.match[+g]));
    }

    // --- несколько курсоров ----------------------------------------------------

    function docLength() {
        let n = m.lines.length - 1;
        for (const s of m.lines) n += s.length;
        return n;
    }
    function posToOff(p, offs) { return offs[p.line] + p.col; }
    function offToPos(off, offs) {
        let lo = 0, hi = offs.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (offs[mid] <= off) lo = mid; else hi = mid - 1;
        }
        return { line: lo, col: Math.min(m.lines[lo].length, off - offs[lo]) };
    }
    const startOff = (c) => (c.anchor === null ? c.caret : Math.min(c.caret, c.anchor));

    // Выполняет op для каждого курсора сверху вниз по убыванию позиции — правки внизу
    // не сдвигают курсоры выше; уже обработанные сдвигаются на разницу длины.
    // Все правки — один шаг undo (group).
    function multi(op) {
        const offs = lineOffsets();
        const cs = [{ caret: m.caret, anchor: m.anchor, goalCol: m.goalCol, primary: true },
            ...m.extra.map((c) => Object.assign({ primary: false }, c))]
            .map((c) => ({ caret: posToOff(c.caret, offs), anchor: c.anchor ? posToOff(c.anchor, offs) : null,
                goalCol: c.goalCol, primary: c.primary }));
        cs.sort((a, b) => startOff(b) - startOff(a));
        const before = m.version;
        m.group++;
        m.inMulti = true;
        m.extra = [];
        const done = [];
        try {
            for (const c of cs) {
                const now = lineOffsets();
                m.caret = offToPos(c.caret, now);
                m.anchor = c.anchor === null ? null : offToPos(c.anchor, now);
                m.goalCol = c.goalCol;
                const len = docLength();
                op();
                const delta = docLength() - len;
                for (const d of done) { d.caret += delta; if (d.anchor !== null) d.anchor += delta; }
                const after = lineOffsets();
                done.push({ caret: posToOff(m.caret, after), anchor: m.anchor ? posToOff(m.anchor, after) : null,
                    goalCol: m.goalCol, primary: c.primary });
            }
        } finally { m.inMulti = false; }
        const offsNow = lineOffsets();
        const seen = new Set(), keep = [];
        for (const d of done.sort((a, b) => startOff(a) - startOff(b))) {
            const key = d.caret + ':' + d.anchor;
            if (!seen.has(key)) { seen.add(key); keep.push(d); }
        }
        const primary = keep.find((d) => d.primary) || keep[0];
        const toCursor = (d) => ({ caret: offToPos(d.caret, offsNow), anchor: d.anchor === null ? null : offToPos(d.anchor, offsNow), goalCol: d.goalCol });
        const main = toCursor(primary);
        m.caret = main.caret; m.anchor = main.anchor; m.goalCol = main.goalCol;
        m.extra = keep.filter((d) => d !== primary).map(toCursor);
        return m.version !== before;
    }

    // Все курсоры по возрастанию позиции: [{ caret, anchor, primary }].
    function allCursors() {
        const list = [{ caret: clonePos(m.caret), anchor: m.anchor ? clonePos(m.anchor) : null, primary: true },
            ...m.extra.map((c) => ({ caret: clonePos(c.caret), anchor: c.anchor ? clonePos(c.anchor) : null, primary: false }))];
        return list.sort((a, b) => comparePos(a.anchor && comparePos(a.anchor, a.caret) < 0 ? a.anchor : a.caret,
            b.anchor && comparePos(b.anchor, b.caret) < 0 ? b.anchor : b.caret));
    }

    // --- публичный API ----------------------------------------------------

    const api = {
        get lines() { return m.lines; },
        get caret() { return clonePos(m.caret); },
        get anchor() { return m.anchor ? clonePos(m.anchor) : null; },
        get version() { return m.version; },
        get indentUnit() { return TAB; },
        get dirty() { return (m.undoStack[m.undoStack.length - 1] || null) !== m.savedRec; },
        lineCount() { return m.lines.length; },
        get cursors() { return allCursors(); },
        get hasMultiCursor() { return m.extra.length > 0; },
        clearExtraCursors() { m.extra = []; },

        // Alt+клик: ещё один курсор в позиции.
        addCursor(pos) {
            const p = clamp(pos);
            if (allCursors().some((c) => comparePos(c.caret, p) === 0)) return false;
            m.extra.push({ caret: clonePos(m.caret), anchor: m.anchor ? clonePos(m.anchor) : null, goalCol: m.goalCol });
            m.caret = p; m.anchor = null; m.goalCol = null;
            return true;
        },

        // Cmd+Alt+↑/↓: курсор на строку выше / ниже крайнего.
        addCursorVertical(direction) {
            const list = allCursors();
            const edge = direction < 0 ? list[0] : list[list.length - 1];
            const line = edge.caret.line + direction;
            if (line < 0 || line >= m.lines.length) return false;
            const goal = (edge.primary && m.goalCol !== null) ? m.goalCol : edge.caret.col;
            return api.addCursor({ line, col: Math.min(goal, m.lines[line].length) }) && ((m.goalCol = goal), true);
        },

        // Cmd+D: выделить слово, затем добавлять следующие вхождения курсорами.
        addNextOccurrence() {
            const sel = selection();
            if (!sel) { api.selectWord(m.caret); return true; }
            if (sel.from.line !== sel.to.line) return false;
            const text = textRange(sel.from, sel.to);
            const w = api.wordAt(sel.from);
            const whole = !!w && w.from === sel.from.col && w.to === sel.to.col;
            const all = api.findAll(text, { caseSensitive: true, wholeWord: whole });
            if (!all.length) return false;
            const taken = allCursors();
            const lastCursor = taken[taken.length - 1];
            const after = lastCursor.anchor && comparePos(lastCursor.anchor, lastCursor.caret) > 0 ? lastCursor.anchor : lastCursor.caret;
            const used = (h) => taken.some((c) => c.anchor && comparePos(c.anchor, c.caret) !== 0 &&
                comparePos(c.anchor, c.caret) < 0 ? comparePos(c.anchor, h) === 0 : comparePos(c.caret, { line: h.line, col: h.col + h.len }) === 0);
            const order = all.filter((h) => comparePos(h, after) >= 0).concat(all.filter((h) => comparePos(h, after) < 0));
            const hit = order.find((h) => !used(h));
            if (!hit) return false;
            m.extra.push({ caret: clonePos(m.caret), anchor: clonePos(m.anchor), goalCol: null });
            m.anchor = { line: hit.line, col: hit.col };
            m.caret = { line: hit.line, col: hit.col + hit.len };
            m.goalCol = null;
            return true;
        },

        // Cmd+Shift+L: курсоры на всех вхождениях выделенного (или текущего) слова.
        selectAllOccurrences() {
            const sel = selection();
            const word = sel ? { text: textRange(sel.from, sel.to) } : api.wordAt(m.caret);
            if (!word || !word.text || /\n/.test(word.text)) return false;
            const hits = api.findAll(word.text, { caseSensitive: true, wholeWord: !sel });
            if (!hits.length) return false;
            const last = hits[hits.length - 1];
            m.extra = hits.slice(0, -1).map((h) => ({ caret: { line: h.line, col: h.col + h.len }, anchor: { line: h.line, col: h.col }, goalCol: null }));
            m.anchor = { line: last.line, col: last.col };
            m.caret = { line: last.line, col: last.col + last.len };
            m.goalCol = null;
            return true;
        },
        text() { return m.lines.join('\n'); },
        selection,
        selectedText() {
            if (m.extra.length) {
                return allCursors().filter((c) => c.anchor && comparePos(c.anchor, c.caret) !== 0)
                    .map((c) => comparePos(c.anchor, c.caret) < 0 ? textRange(c.anchor, c.caret) : textRange(c.caret, c.anchor)).join('\n');
            }
            const s = selection(); return s ? textRange(s.from, s.to) : '';
        },
        canUndo() { return m.undoStack.length > 0; },
        canRedo() { return m.redoStack.length > 0; },
        markSaved() { m.savedRec = m.undoStack[m.undoStack.length - 1] || null; },

        setText(text) {
            m.extra = [];
            m.lines = splitLines(text);
            m.caret = clamp(m.caret); m.anchor = null;
            m.undoStack.length = 0; m.redoStack.length = 0;
            m.version++; m.savedRec = null;
        },

        setCaret(pos, extend) {
            m.extra = [];
            const p = clamp(pos);
            if (extend) { if (!m.anchor) m.anchor = clonePos(m.caret); }
            else m.anchor = null;
            m.caret = p;
            m.goalCol = null;
        },

        selectAll() {
            m.extra = [];
            m.anchor = { line: 0, col: 0 };
            const last = m.lines.length - 1;
            m.caret = { line: last, col: m.lines[last].length };
        },

        // Слово под позицией (двойной щелчок).
        selectWord(pos) {
            m.extra = [];
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
            const closer = { '{': '}', '(': ')', '[': ']' }[before[before.length - 1]];
            if (!selection() && extra && closer && line.slice(m.caret.col).startsWith(closer)) {
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
            // Копия вниз — каретка уходит на копию; копия вверх — остаётся на верхней (новой) строке.
            const shift = direction < 0 ? 0 : block.length;
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
            if (sel && !shift && sel.from.line === sel.to.line) return api.insert(TAB);
            const { first, last } = selectedLineRange();
            return transformLines(first, last, (s) => {
                if (!shift) return s ? { text: TAB + s, map: (c) => (c > 0 ? c + TAB.length : c) } : { text: s, map: (c) => c };
                const cut = (s.match(/^( {1,4}|\t)/) || [''])[0].length;
                return { text: s.slice(cut), map: (c) => c - cut };
            }, 'indent');
        },

        // Ведущие пробелы -> табы: каждые четыре пробела (в смеси с табами тоже) дают один таб,
        // остаток меньше четырёх остаётся выравниванием. Одна правка, выделение сохраняется.
        normalizeIndent() {
            const lead = (s) => /^[ \t]*/.exec(s)[0];
            const fix = (ws) => { let n = 0; for (const ch of ws) n += ch === '\t' ? 4 - (n % 4) : 1; return '\t'.repeat(Math.floor(n / 4)) + ' '.repeat(n % 4); };
            if (!m.lines.some((s) => lead(s) !== fix(lead(s)))) return false;
            return transformLines(0, m.lines.length - 1, (s) => {
                const ws = lead(s), out = fix(ws);
                if (ws === out) return { text: s, map: (c) => c };
                return { text: out + s.slice(ws.length), map: (c) => (c >= ws.length ? c - ws.length + out.length : Math.min(c, out.length)) };
            }, 'indent');
        },

        // Приводит строки к новому списку той же длины (форматирование); выделение сохраняется.
        replaceLines(newLines, kind) {
            if (newLines.length !== m.lines.length) return false;
            return transformLines(0, m.lines.length - 1, (s, i) => {
                const next = newLines[i];
                const a = /^[\t ]*/.exec(s)[0].length, b = /^[\t ]*/.exec(next)[0].length;
                return { text: next, map: (c) => (c >= a ? c - a + b : Math.min(c, b)) };
            }, kind || 'format');
        },

        // Форматирование отступов по глубине скобок (Shift+Alt+F).
        format(lang) { return api.replaceLines(reindentLines(m.lines, lang), 'format'); },

        // Подготовка к сохранению: пробельный отступ → табы, хвостовые пробелы, пустая строка в конце.
        normalizeForSave() {
            let changed = api.normalizeIndent();
            if (m.lines.some((s) => /[ \t]+$/.test(s))) {
                changed = transformLines(0, m.lines.length - 1, (s) => {
                    const t = s.replace(/[ \t]+$/, '');
                    return { text: t, map: (c) => Math.min(c, t.length) };
                }, 'format') || changed;
            }
            const last = m.lines.length - 1;
            if (m.lines[last] !== '') {
                const end = { line: last, col: m.lines[last].length };
                const caret = clonePos(m.caret), anchor = m.anchor ? clonePos(m.anchor) : null;
                edit(end, end, '\n', 'format');
                m.caret = caret; m.anchor = anchor;
                changed = true;
            }
            return changed;
        },

        // Вставка с подгонкой отступа многострочного текста под строку курсора.
        paste(text) {
            const parts = splitLines(text);
            if (parts.length < 2 || m.extra.length) return api.insert(text);
            const c = m.caret, row = m.lines[c.line], head = row.slice(0, c.col);
            const sel = selection();
            const atIndent = /^[\t ]*$/.test(head);
            const own = (/^[\t ]*/.exec(row) || [''])[0];
            const target = atIndent ? head : own + (/[{([]\s*$/.test(head) ? TAB : '');
            const body = atIndent ? parts : parts.slice(1);
            const widths = body.filter((x) => x.trim()).map((x) => indentColumns(/^[\t ]*/.exec(x)[0]));
            if (!widths.length) return api.insert(text);
            const base = Math.min(...widths);
            const rebase = (x) => {
                if (!x.trim()) return '';
                const cols = indentColumns(/^[\t ]*/.exec(x)[0]) - base;
                return target + '\t'.repeat(Math.floor(cols / 4)) + ' '.repeat(cols % 4) + x.trim();
            };
            const out = atIndent
                ? [(sel ? '' : '') + rebase(parts[0]).slice(head.length) , ...parts.slice(1).map(rebase)]
                : [parts[0], ...parts.slice(1).map(rebase)];
            return api.insert(out.join('\n'));
        },

        // Закомментировать / раскомментировать строки; open/close — маркеры языка.
        toggleLineComment(open, close) {
            if (!open) return false;
            const { first, last } = selectedLineRange();
            const body = m.lines.slice(first, last + 1).filter((s) => s.trim());
            if (!body.length) return false;
            const isOn = (s) => { const t = s.trim(); return t.startsWith(open) && (!close || t.endsWith(close)); };
            const all = body.every(isOn);
            const indent = Math.min(...body.map((s) => s.length - s.trimStart().length));
            return transformLines(first, last, (s) => {
                if (!s.trim()) return { text: s, map: (c) => c };
                if (all) {
                    const a = s.length - s.trimStart().length;
                    let rest = s.slice(a + open.length);
                    const gap = rest.startsWith(' ') ? 1 : 0;
                    rest = rest.slice(gap);
                    if (close) rest = rest.replace(new RegExp(' ?' + close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), '');
                    return { text: s.slice(0, a) + rest, map: (c) => (c > a ? Math.max(a, c - open.length - gap) : c) };
                }
                const text = s.slice(0, indent) + open + ' ' + s.slice(indent) + (close ? ' ' + close : '');
                return { text, map: (c) => (c >= indent ? c + open.length + 1 : c) };
            }, 'comment');
        },

        // Выделить строку целиком; повторный вызов добавляет следующую.
        selectLine() {
            m.extra = [];
            const sel = selection(), lastLine = m.lines.length - 1;
            const first = sel ? sel.from.line : m.caret.line;
            const wholeLines = sel && sel.from.col === 0 && sel.to.col === 0 && sel.to.line > sel.from.line;
            const end = wholeLines ? sel.to.line : sel ? sel.to.line : m.caret.line;
            const next = end + 1;
            m.anchor = { line: first, col: 0 };
            m.caret = next > lastLine ? { line: lastLine, col: m.lines[lastLine].length } : { line: next, col: 0 };
            m.goalCol = null;
        },

        // Cmd+Enter / Cmd+Shift+Enter: пустая строка под / над текущей с тем же отступом.
        insertLine(above) {
            const line = m.lines[m.caret.line];
            const indent = (line.match(/^\s*/) || [''])[0];
            m.anchor = null;
            if (above) {
                const at = { line: m.caret.line, col: 0 };
                edit(at, at, indent + '\n', 'edit');
                m.caret = { line: at.line, col: indent.length };
                return true;
            }
            m.caret = { line: m.caret.line, col: line.length };
            return api.newline();
        },

        deleteToLineStart() {
            const sel = selection();
            if (sel) return edit(sel.from, sel.to, '', 'edit');
            const c = m.caret;
            if (c.col === 0) return api.backspace();
            return edit({ line: c.line, col: 0 }, c, '', 'edit');
        },

        deleteWord(forward) {
            const sel = selection();
            if (sel) return edit(sel.from, sel.to, '', 'delete');
            m.anchor = clonePos(m.caret);
            api.move(forward ? 'wordRight' : 'wordLeft', true);
            const range = selection();
            m.anchor = null;
            return range ? edit(range.from, range.to, '', 'edit') : false;
        },

        // Набрана «}» / «)» / «]» в начале строки из одних пробелов — снять уровень отступа.
        outdentBeforeClose() {
            if (selection()) return false;
            const c = m.caret, head = m.lines[c.line].slice(0, c.col);
            if (!head || /\S/.test(head)) return false;
            const cut = head.endsWith('\t') ? 1 : Math.min(SPACES.length, ((head.length - 1) % SPACES.length) + 1);
            return edit({ line: c.line, col: c.col - cut }, c, '', 'edit');
        },

        // Слово под позицией: { text, from, to } либо null.
        wordAt(pos) {
            const p = clamp(pos), s = m.lines[p.line];
            let a = p.col, b = p.col;
            while (a > 0 && isWordCharacter(s[a - 1])) a--;
            while (b < s.length && isWordCharacter(s[b])) b++;
            return a === b ? null : { text: s.slice(a, b), line: p.line, from: a, to: b };
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
            const back = /^ +$/.test(head) ? ((head.length - 1) % SPACES.length) + 1 : 1;
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
                const target = c.line + delta;
                // Вверх с первой строки — в начало, вниз с последней — в конец (как в VS Code).
                if (target < 0) { m.caret = { line: 0, col: 0 }; return; }
                if (target > m.lines.length - 1) {
                    const last = m.lines.length - 1;
                    m.caret = { line: last, col: m.lines[last].length };
                    return;
                }
                m.caret = { line: target, col: Math.min(m.goalCol, m.lines[target].length) };
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
            let rec = m.undoStack.pop();
            if (!rec) return false;
            m.extra = [];
            const group = rec.group;
            for (;;) {
                rawReplace(rec.from, rec.end, rec.removed);
                m.redoStack.push(rec);
                m.caret = clonePos(rec.caretBefore);
                m.anchor = rec.anchorBefore ? clonePos(rec.anchorBefore) : null;
                const next = m.undoStack[m.undoStack.length - 1];
                if (!group || !next || next.group !== group) break;
                rec = m.undoStack.pop();
            }
            m.caret = clamp(m.caret);
            if (m.anchor) m.anchor = clamp(m.anchor);
            return true;
        },

        redo() {
            let rec = m.redoStack.pop();
            if (!rec) return false;
            m.extra = [];
            const group = rec.group;
            for (;;) {
                const removedEnd = endOf(rec.from, rec.removed);
                rec.end = rawReplace(rec.from, removedEnd, rec.text);
                m.undoStack.push(rec);
                m.caret = clonePos(rec.end);
                m.anchor = null;
                const next = m.redoStack[m.redoStack.length - 1];
                if (!group || !next || next.group !== group) break;
                rec = m.redoStack.pop();
            }
            return true;
        },

        // Поиск: все вхождения. opts — { caseSensitive, wholeWord, regex } либо
        // boolean (caseSensitive). Без учёта регистра по умолчанию.
        findAll(query, opts) { return hitsInLines(query, findOptions(opts), 0, m.lines.length - 1); },
        findInLines(query, opts, first, last) { return hitsInLines(query, findOptions(opts), first, last); },
        get findError() { return m.findError || ''; },

        // Следующее вхождение после каретки (по кругу); выделяет его.
        findNext(query, backwards, opts) {
            m.extra = [];
            const hits = api.findAll(query, opts);
            if (!hits.length) return null;
            const c = m.caret, sel = selection();
            let hit;
            if (backwards) {
                const ref = sel ? sel.from : c;
                hit = [...hits].reverse().find((h) => comparePos(h, ref) < 0) || hits[hits.length - 1];
            } else {
                hit = hits.find((h) => comparePos(h, c) >= 0 &&
                    !(sel && comparePos(h, sel.from) === 0)) || hits[0];
            }
            m.anchor = { line: hit.line, col: hit.col };
            m.caret = { line: hit.line, col: hit.col + hit.len };
            m.goalCol = null;
            return { hit, index: hits.indexOf(hit), total: hits.length };
        },

        replaceSelection(text) {
            const sel = selection();
            if (!sel) return false;
            return edit(sel.from, sel.to, text, 'edit');
        },

        // Заменить текущее совпадение (если оно выделено) и перейти к следующему.
        replaceNext(query, text, opts) {
            const sel = selection();
            if (sel) {
                const hit = api.findInLines(query, opts, sel.from.line, sel.from.line)
                    .find((h) => h.col === sel.from.col && sel.to.line === h.line && sel.to.col === h.col + h.len);
                if (hit) edit(sel.from, sel.to, expandReplacement(text, hit), 'edit');
            }
            return api.findNext(query, false, opts);
        },

        replaceAll(query, text, opts) {
            const hits = api.findAll(query, opts);
            if (!hits.length) return 0;
            // Одной правкой целиком документа: один шаг undo.
            const src = api.text();
            const out = [];
            let last = 0;
            const offsets = lineOffsets();
            for (const h of hits) {
                const at = offsets[h.line] + h.col;
                out.push(src.slice(last, at), expandReplacement(text, h));
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

    // Операции, которые выполняются на каждом курсоре.
    for (const name of ['insert', 'newline', 'backspace', 'del', 'deleteWord', 'deleteToLineStart',
        'wrapSelection', 'move', 'outdentBeforeClose']) {
        const single = api[name];
        api[name] = (...args) => (m.extra.length && !m.inMulti ? multi(() => single(...args)) : single(...args));
    }

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
