// ===========================================================================
// Вид редактора кода в RmlUi: рисует только видимые строки (абсолютные div'ы
// в #code-lines), каретку, выделение, подсветку поиска и подчёркивания
// диагностик. Ввод — через $.input (без <textarea>): текст, клавиши с
// автоповтором, мышь (щелчок, двойной щелчок, протяжка), колесо.
//
// Координаты: RmlUi живёт в пикселях swapchain, $.input.mouse() — в
// логических точках окна; scale() переводит одно в другое.
// ===========================================================================

import { tokenizeLine, lineToRml, lineStates, bracketPairs, foldingRanges, matchingBracket, escapeRml, createApiHighlightContext, highlightApiTokens } from './highlight.js';
import { apiCompletionContext, nodeApiCompletionContext, completeApiSymbols, jsCompletionContext, completeJavaScriptSymbols } from './api_language.js';

const LINE_H = 20;
const REPEAT_DELAY = 0.42;
const REPEAT_RATE = 0.035;
const REPEAT_KEYS = ['left', 'right', 'up', 'down', 'backspace', 'delete', 'enter', 'pageup', 'pagedown', 'tab'];

export function createCodeView($, doc, apiSymbols) {
    const v = {
        model: null,
        lang: 'text',
        scrollTop: 0,          // строк (может быть дробным)
        scrollLeft: 0,         // пикселей
        charW: 0,
        dirty: true,
        statesVersion: -1,
        states: [],
        apiHighlightVersion: -1,
        apiHighlightContext: null,
        bracketsVersion: -1,
        brackets: new Map(),
        foldRanges: new Map(),
        collapsedFolds: new Set(),
        visibleDocLines: [],
        visibleVersion: -1,
        diags: [],             // [{ line(1), col(1), severity }]
        find: { query: '', hits: [] },
        apiSymbols: apiSymbols || [],
        completion: null,
        completionArrowDown: { up: false, down: false },
        hoverHelp: null,
        hoverMarkup: null,
        hoverPos: null,
        hoverApiPath: '',
        held: null,            // { key, t, next }
        dragging: false,
        focused: false,
        imeText: '',
        blinkT: 0,
        lastClick: { t: -1, line: -1, col: -1 },
        onChange: null,        // колбэк: правка документа
        onCaret: null,         // колбэк: каретка сдвинулась
        onHover: null,         // позиция мыши над кодом; null — курсор вне редактора
    };

    function scale() {
        const px = $.window.pixels(), pt = $.window.size();
        return pt && pt.w ? px.w / pt.w : 1;
    }

    function measure() {
        const r = doc.rect('code-measure');
        if (r && r.w > 0) v.charW = r.w / 100;
        return v.charW;
    }

    function textRect() { return doc.rect('code-text'); }

    function visibleLines() {
        const r = textRect();
        return r ? Math.max(1, Math.floor(r.h / LINE_H)) : 30;
    }

    function rebuildVisibleDocLines() {
        if (v.visibleVersion === v.bracketsVersion) return;
        const out = [];
        for (let line = 0; line < v.model.lineCount(); line++) {
            out.push(line);
            const end = v.collapsedFolds.has(line) ? v.foldRanges.get(line) : 0;
            if (end > line) line = end;
        }
        v.visibleDocLines = out;
        v.visibleVersion = v.bracketsVersion;
    }

    function visibleRowForLine(line) {
        rebuildVisibleDocLines();
        let lo = 0, hi = v.visibleDocLines.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1, value = v.visibleDocLines[mid];
            if (value === line) return mid;
            if (value < line) lo = mid + 1;
            else hi = mid - 1;
        }
        return Math.max(0, hi);
    }

    function revealLine(line) {
        let changed = false;
        for (const start of v.collapsedFolds) {
            const end = v.foldRanges.get(start);
            if (line > start && line <= end) { v.collapsedFolds.delete(start); changed = true; }
        }
        if (changed) {
            v.visibleVersion = -1;
            rebuildVisibleDocLines();
            v.dirty = true;
        }
    }

    function setModel(model, lang) {
        v.model = model;
        v.lang = lang || 'text';
        v.scrollTop = 0; v.scrollLeft = 0;
        v.completion = null; v.hoverPos = null; v.hoverApiPath = '';
        v.statesVersion = -1; v.apiHighlightVersion = -1; v.bracketsVersion = -1; v.visibleVersion = -2;
        v.foldRanges.clear(); v.visibleDocLines = [];
        v.collapsedFolds.clear();
        v.dirty = true;
    }

    function ensureCaretVisible() {
        if (!v.model) return;
        const c = v.model.caret, rows = visibleLines();
        revealLine(c.line);
        const row = visibleRowForLine(c.line);
        if (row < v.scrollTop) v.scrollTop = row;
        else if (row >= v.scrollTop + rows) v.scrollTop = row - rows + 1;
        const r = textRect(), cw = v.charW || measure();
        if (r && cw) {
            const x = c.col * cw;
            if (x < v.scrollLeft) v.scrollLeft = Math.max(0, x - cw * 4);
            else if (x > v.scrollLeft + r.w - cw * 2) v.scrollLeft = x - r.w + cw * 6;
        }
        v.dirty = true;
    }

    function clampScroll() {
        rebuildVisibleDocLines();
        const max = Math.max(0, v.visibleDocLines.length - visibleLines());
        v.scrollTop = Math.max(0, Math.min(max, v.scrollTop));
        v.scrollLeft = Math.max(0, v.scrollLeft);
    }

    // --- отрисовка ----------------------------------------------------------

    function render() {
        if (!v.model || !v.dirty) return;
        v.dirty = false;
        const cw = v.charW || measure() || 8;
        const m = v.model, lines = m.lines;
        const codeViewport = textRect();
        const lineViewportWidth = codeViewport ? Math.max(0, codeViewport.w - 18) : 782;
        if (v.statesVersion !== m.version) {
            v.states = lineStates(lines, v.lang);
            v.statesVersion = m.version;
        }
        if (v.apiHighlightVersion !== m.version) {
            v.apiHighlightContext = createApiHighlightContext(v.apiSymbols, lines);
            v.apiHighlightVersion = m.version;
        }
        if (v.bracketsVersion !== m.version) {
            v.brackets = bracketPairs(lines, v.lang);
            v.bracketsVersion = m.version;
            v.foldRanges = foldingRanges(lines, v.brackets);
            v.collapsedFolds.clear();
            v.visibleVersion = -1;
        }
        clampScroll();
        const first = Math.floor(v.scrollTop);
        const rows = visibleLines() + 1;
        const offY = -(v.scrollTop - first) * LINE_H;
        const caret = m.caret, sel = m.selection();
        const bracketOther = matchingBracket(v.brackets, caret);
        const bracketHere = bracketOther
            ? (v.brackets.has(caret.line + ':' + caret.col) ? caret : { line: caret.line, col: caret.col - 1 })
            : null;
        const diagByLine = new Map();
        for (const d of v.diags) {
            const prev = diagByLine.get(d.line - 1);
            if (!prev || d.severity === 'error') diagByLine.set(d.line - 1, d.severity);
        }
        let gutter = '', text = '', under = '';
        for (let r = 0; r < rows; r++) {
            const i = v.visibleDocLines[first + r];
            if (i === undefined) break;
            const y = Math.round(offY + r * LINE_H);
            const sev = diagByLine.get(i);
            const lnCls = 'ln' + (i === caret.line ? ' cur' : '') + (sev === 'error' ? ' err' : sev ? ' warn' : '');
            const foldEnd = v.foldRanges.get(i);
            gutter += '<div class="' + lnCls + '" style="top: ' + y + 'px;">' + (foldEnd
                ? '<span class="fold-toggle" data-key="fold:' + i + '">' + (v.collapsedFolds.has(i) ? '›' : '⌄') + '</span>'
                : '') + (i + 1) + '</div>';
            let tokens = tokenizeLine(lines[i], v.lang, v.states[i]).tokens;
            if (v.lang === 'js') tokens = highlightApiTokens(tokens, lines[i], v.apiHighlightContext);
            text += '<div class="cl" style="top: ' + y + 'px; left: ' + (-Math.round(v.scrollLeft)) + 'px; width: ' +
                Math.ceil(lineViewportWidth + v.scrollLeft) + 'px;">' + lineToRml(tokens) +
                (v.collapsedFolds.has(i) ? '<span class="fold-placeholder"> … ' + (foldEnd - i) + ' lines</span>' : '') + '</div>';
            if (i === caret.line && !sel) under += '<div class="cur-line" style="top: ' + y + 'px;"></div>';
            if (bracketHere && bracketOther) {
                if (bracketHere.line === i) under += rect('bracket-match', y, bracketHere.col, bracketHere.col + 1, cw);
                if (bracketOther.line === i) under += rect('bracket-match', y, bracketOther.col, bracketOther.col + 1, cw);
            }
            if (sel && i >= sel.from.line && i <= sel.to.line) {
                const a = i === sel.from.line ? sel.from.col : 0;
                const b = i === sel.to.line ? sel.to.col : lines[i].length + 1;
                under += rect('sel-rect', y, a, b, cw);
            }
            if (sev) {
                const d = v.diags.find((q) => q.line - 1 === i);
                const a = Math.max(0, (d.col || 1) - 1);
                const b = Math.max(a + 1, wordEnd(lines[i], a));
                under += '<div class="diag-line' + (sev === 'error' ? '' : ' warn') + '" style="top: ' + (y + 18) + 'px; left: ' +
                    Math.round(a * cw - v.scrollLeft) + 'px; width: ' + Math.round((b - a) * cw) + 'px;"></div>';
            }
        }
        for (const h of v.find.hits) {
            const row = visibleRowForLine(h.line);
            if (v.visibleDocLines[row] !== h.line || row < first || row >= first + rows) continue;
            under += rect('find-rect', Math.round(offY + (row - first) * LINE_H), h.col, h.col + h.len, cw);
        }
        doc.html('code-gutter', gutter);
        doc.html('code-lines', text);
        doc.html('code-under', under);
        const caretRow = visibleRowForLine(caret.line);
        const cy = Math.round(offY + (caretRow - first) * LINE_H) + 1;
        doc.style('caret', 'top', cy + 'px');
        doc.style('caret', 'left', Math.round(caret.col * cw - v.scrollLeft) + 'px');
        doc.cls('caret', 'hidden', v.visibleDocLines[caretRow] !== caret.line || caretRow < first || caretRow >= first + rows);
        const ime = v.focused ? $.input.ime() : { text: '', start: 0 };
        const imeText = ime && typeof ime.text === 'string' ? ime.text : '';
        doc.text('ime-preview', imeText);
        doc.style('ime-preview', 'top', cy + 'px');
        doc.style('ime-preview', 'left', Math.round(caret.col * cw - v.scrollLeft) + 'px');
        doc.cls('ime-preview', 'hidden', !imeText || v.visibleDocLines[caretRow] !== caret.line || caretRow < first || caretRow >= first + rows);
        if (v.focused && $.input.textInputArea) {
            const rect = doc.rect('caret'), k = scale();
            if (rect) $.input.textInputArea(rect.x / k, rect.y / k, Math.max(1, rect.w / k), Math.max(1, rect.h / k), 0);
        }
        // Полоса прокрутки — индикатор положения (прокрутка колесом/кареткой).
        const r = textRect();
        if (r) {
            const total = Math.max(v.visibleDocLines.length, 1), vis = visibleLines();
            const h = Math.max(24, r.h * Math.min(1, vis / total));
            const top = (r.h - h) * (total > vis ? v.scrollTop / Math.max(1, total - vis) : 0);
            doc.style('code-vscroll', 'top', Math.round(Math.min(r.h - h, top)) + 'px');
            doc.style('code-vscroll', 'height', Math.round(h) + 'px');
            doc.cls('code-vscroll', 'hidden', total <= vis);
        }
        renderCompletion();
        renderHoverHelp();
    }

    function renderCompletion() {
        const c = v.completion;
        if (!c || !c.items.length) {
            v.completionArrowDown.up = v.completionArrowDown.down = false;
            doc.cls('code-completion', 'hidden', true);
            return;
        }
        const r = doc.rect('code'), cw = v.charW || measure() || 8;
        const caret = v.model.caret;
        const x = 64 + Math.round(caret.col * cw - v.scrollLeft);
        const y = Math.round((visibleRowForLine(caret.line) - v.scrollTop) * LINE_H + LINE_H);
        const width = r ? Math.max(1, Math.min(640, r.w - 16)) : 640;
        const popupHeight = Math.min(416, c.items.length * 26 + 2);
        const left = r ? Math.max(8, Math.min(x, r.w - width - 8)) : x;
        const visibleHeight = r ? Math.min(popupHeight, Math.max(0, r.h - 8)) : popupHeight;
        const below = r ? Math.max(0, r.h - y - 4) : popupHeight;
        const above = Math.max(0, y - LINE_H - 4);
        const top = r
            ? (below >= visibleHeight || below >= above
                ? Math.max(4, Math.min(y, r.h - visibleHeight - 4))
                : Math.max(4, y - visibleHeight - LINE_H))
            : y;
        doc.style('code-completion', 'left', left + 'px');
        doc.style('code-completion', 'top', top + 'px');
        doc.style('code-completion', 'width', width + 'px');
        doc.style('code-completion', 'max-height', visibleHeight + 'px');
        const markup = c.items.map((item, i) => {
            const meta = item.metadata || {};
            const args = Array.isArray(meta.args) ? meta.args : [];
            const signature = meta.signature || (meta.kind === 'function' ? '(' + args.map((arg) => arg.name || 'arg').join(', ') + ')' : (meta.type || ''));
            return '<div id="completion-item-' + i + '" class="api-completion-item" data-key="completion:' + i + '">' +
                '<span class="api-completion-name">' + escapeRml(item.name) + '</span>' +
                '<span class="api-completion-signature">' + escapeRml(signature) + '</span>' +
                '<span class="api-completion-desc">' + escapeRml(meta.description || item.path) + '</span></div>';
        }).join('');
        // Updating the code viewport (caret blink, diagnostics, scroll) must
        // not replace the popup's DOM every frame: doing so loses its active
        // row and keyboard focus in RmlUi.
        if (v.completionMarkup !== markup) {
            v.completionMarkup = markup;
            doc.html('code-completion', markup);
        }
        doc.cls('code-completion', 'hidden', false);
        for (let i = 0; i < c.items.length; i++)
            doc.cls('completion-item-' + i, 'selected', i === c.selected);
    }

    function renderHoverHelp() {
        const help = v.hoverHelp;
        if (!help || !help.path || !help.metadata) {
            doc.cls('api-hover', 'hidden', true);
            return;
        }
        const r = doc.rect('code'), k = scale(), mouse = $.input.mouse();
        if (!r || r.w < 180 || r.h < 72) { doc.cls('api-hover', 'hidden', true); return; }
        const width = Math.max(1, Math.min(520, r.w - 16));
        const args = Array.isArray(help.metadata.args) ? help.metadata.args : [];
        const signature = help.metadata.signature || (help.metadata.kind === 'function'
            ? '(' + args.map((arg) => (arg.name || 'arg') + ': ' + (arg.type || 'any')).join(', ') + ') → ' + (help.metadata.returns || 'any')
            : (help.metadata.type || help.metadata.kind || 'API'));
        const description = help.metadata.description || '';
        const charsPerLine = Math.max(18, Math.floor((width - 24) / 7));
        const estimatedLines = Math.max(1, Math.ceil(description.length / charsPerLine));
        const height = Math.min(r.h - 8, 58 + estimatedLines * 18);
        const mouseX = mouse.x * k - r.x, mouseY = mouse.y * k - r.y;
        const x = Math.max(8, Math.min(Math.round(mouseX), r.w - width - 8));
        let y = Math.round(mouseY - height - 12);
        if (y < 4) y = Math.round(mouseY + 20);
        y = Math.max(4, Math.min(y, r.h - height - 4));
        doc.style('api-hover', 'left', x + 'px');
        doc.style('api-hover', 'top', Math.max(4, y) + 'px');
        doc.style('api-hover', 'width', width + 'px');
        doc.style('api-hover', 'background-color', '#20242b');
        doc.style('api-hover', 'border-color', '#536071');
        const markup = '<span class="api-hover-title">' + escapeRml(help.path) + '</span>' +
            '<span class="api-hover-signature">' + escapeRml(signature) + '</span>' +
            (description ? '<span class="api-hover-description">' + escapeRml(description) + '</span>' : '');
        if (v.hoverMarkup !== markup) {
            v.hoverMarkup = markup;
            doc.html('api-hover', markup);
        }
        doc.cls('api-hover', 'hidden', false);
    }

    function refreshCompletion(force, manual) {
        if (!v.model) { v.completion = null; return; }
        const caret = v.model.caret, line = v.model.lines[caret.line];
        const source = v.model.lines.join('\n');
        const offset = v.model.lines.slice(0, caret.line).reduce((n, row) => n + row.length + 1, 0) + caret.col;
        const sourcePrefix = source.slice(0, offset);
        const apiContext = apiCompletionContext(line, caret.col) ||
            nodeApiCompletionContext(line, caret.col, sourcePrefix);
        const context = apiContext || jsCompletionContext(source, offset, manual);
        if (!context || (!force && !v.completion)) {
            v.completion = null;
            doc.cls('code-completion', 'hidden', true);
            return;
        }
        const items = context.mode === 'js'
            ? completeJavaScriptSymbols(context, null, 16)
            : completeApiSymbols(v.apiSymbols, context, 16);
        const old = v.completion;
        const sameItems = old && old.items.length === items.length &&
            old.items.every((item, i) => item.path === items[i].path);
        if (old && old.context.fromCol === context.fromCol &&
            old.context.insertPrefix === context.insertPrefix && sameItems) return;
        const selectedPath = old && old.items[old.selected] && old.items[old.selected].path;
        let selected = selectedPath ? items.findIndex((item) => item.path === selectedPath) : -1;
        if (selected < 0) selected = 0;
        v.completion = items.length ? { context, items, selected } : null;
        v.completionMarkup = null;
        v.dirty = true;
        if (!v.completion) doc.cls('code-completion', 'hidden', true);
    }

    function acceptCompletion(index) {
        const c = v.completion;
        if (!c || !c.items.length) return false;
        const item = c.items[Math.max(0, Math.min(c.items.length - 1, index === undefined ? c.selected : index))];
        const caret = v.model.caret;
        v.model.setCaret({ line: caret.line, col: c.context.fromCol });
        v.model.setCaret(caret, true);
        v.model.insert((c.context.insertPrefix || '') + item.name);
        v.completion = null;
        v.dirty = true;
        ensureCaretVisible();
        if (v.onChange) v.onChange();
        if (v.onCaret) v.onCaret();
        return true;
    }

    function rect(cls, y, a, b, cw) {
        return '<div class="' + cls + '" style="top: ' + y + 'px; left: ' + Math.round(a * cw - v.scrollLeft) +
            'px; width: ' + Math.max(2, Math.round((b - a) * cw)) + 'px;"></div>';
    }

    function wordEnd(s, a) {
        let b = a;
        while (b < s.length && /[\w$]/.test(s[b])) b++;
        return b;
    }

    // --- мышь -----------------------------------------------------------------

    function posFromMouse() {
        const r = textRect();
        if (!r || !v.model) return null;
        const k = scale(), mouse = $.input.mouse();
        const x = mouse.x * k - r.x + v.scrollLeft, y = mouse.y * k - r.y;
        const cw = v.charW || measure() || 8;
        rebuildVisibleDocLines();
        const row = Math.max(0, Math.min(v.visibleDocLines.length - 1, Math.floor(v.scrollTop + y / LINE_H)));
        const line = v.visibleDocLines[row] || 0;
        return { line, col: Math.max(0, Math.round(x / cw)) };
    }

    function mouseInside() {
        const r = doc.rect('code');
        if (!r) return false;
        const k = scale(), mouse = $.input.mouse();
        const x = mouse.x * k, y = mouse.y * k;
        return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    }

    // Нажатие внутри области кода (зовёт app по событию mousedown).
    function mouseDown() {
        const p = posFromMouse();
        if (!p) return;
        v.completion = null;
        const t = $.time.realNow();
        const dbl = t - v.lastClick.t < 0.35 && p.line === v.lastClick.line && Math.abs(p.col - v.lastClick.col) <= 1;
        v.lastClick = { t, line: p.line, col: p.col };
        if (dbl) { v.model.selectWord(p); v.dragging = false; }
        else { v.model.setCaret(p, $.input.shiftDown()); v.dragging = true; }
        v.blinkT = 0;
        v.dirty = true;
        if (v.onCaret) v.onCaret();
    }

    function toggleFoldAt(line) {
        if (!v.foldRanges.has(line)) return false;
        const end = v.foldRanges.get(line), caret = v.model.caret;
        if (v.collapsedFolds.has(line)) v.collapsedFolds.delete(line);
        else {
            v.collapsedFolds.add(line);
            if (caret.line > line && caret.line <= end) v.model.setCaret({ line, col: 0 });
        }
        v.visibleVersion = -1;
        rebuildVisibleDocLines();
        ensureCaretVisible();
        v.dirty = true;
        render();
        if (v.onCaret) v.onCaret();
        return true;
    }

    // --- клавиатура ---------------------------------------------------------------

    function primary() { return $.input.down('cmd') || $.input.down('rcmd') || $.input.ctrlDown(); }

    // Нажатие с автоповтором: true в кадр нажатия и затем каждые REPEAT_RATE.
    function fired(key, dt) {
        if ($.input.pressed(key)) { v.held = { key, t: 0, next: REPEAT_DELAY }; return true; }
        if (v.held && v.held.key === key) {
            if (!$.input.down(key)) { v.held = null; return false; }
            v.held.t += dt;
            if (v.held.t >= v.held.next) { v.held.next += REPEAT_RATE; return true; }
        }
        return false;
    }

    function handleKeys(dt, actions) {
        const m = v.model;
        if (!m) return;
        const shift = $.input.shiftDown(), alt = $.input.altDown();
        const cmd = $.input.down('cmd') || $.input.down('rcmd');
        const mod = primary();
        let changed = false, moved = false;
        let lineMoveHandled = false;
        const edit = (ok) => { if (ok) changed = true; };

        if (v.completion) {
            // The UI/game input layer can consume directional presses before
            // Editor polls them. Read raw held state and detect this menu's own
            // edges so completion navigation remains independent.
            const up = $.input.rawDown('up'), down = $.input.rawDown('down');
            const upPressed = up && !v.completionArrowDown.up;
            const downPressed = down && !v.completionArrowDown.down;
            v.completionArrowDown.up = up;
            v.completionArrowDown.down = down;
            if (upPressed || downPressed) {
                const delta = upPressed ? -1 : 1;
                v.completion.selected = (v.completion.selected + delta + v.completion.items.length) % v.completion.items.length;
                v.dirty = true;
                render();
                return;
            }
            if ($.input.pressed('enter') || $.input.pressed('tab')) { acceptCompletion(); return; }
            if ($.input.pressed('escape')) { v.completion = null; v.dirty = true; render(); return; }
        }
        const forceCompletion = $.input.pressed('space') &&
            (($.input.ctrlDown() && !cmd) || (cmd && shift));

        if (mod && shift && $.input.pressed('backslash')) {
            const other = matchingBracket(v.brackets, m.caret);
            if (other) { m.setCaret(other); moved = true; }
        }

        // Буквенные сочетания (без автоповтора).
        if (mod) {
            if ($.input.pressed('a')) { m.selectAll(); moved = true; }
            if ($.input.pressed('c') || $.input.pressed('x')) {
                const s = m.selectedText() || (m.lines[m.caret.line] + '\n');
                $.input.setClipboard(s);
                if ($.input.pressed('x')) {
                    if (m.selection()) edit(m.insert(''));
                    else { m.setCaret({ line: m.caret.line, col: 0 }); m.move('down', true); if (m.selection()) edit(m.insert('')); else { m.move('end', true); edit(m.insert('')); } }
                }
            }
            if ($.input.pressed('v')) { const s = $.input.clipboard(); if (s) edit(m.insert(s)); }
            if ($.input.pressed('z')) { edit(shift ? m.redo() : m.undo()); }
            if ($.input.pressed('y')) edit(m.redo());
            if ($.input.pressed('slash')) { edit(toggleComment(m)); }
            if ($.input.pressed('d')) { selectNextOccurrence(m); moved = true; }
            if (shift && $.input.pressed('k')) edit(m.deleteLine());
            if ($.input.pressed('f') && actions.find) actions.find();
            if ($.input.pressed('g') && actions.gotoLine) actions.gotoLine();
        }

        if (alt && !mod) {
            lineMoveHandled = $.input.down('up') || $.input.down('down');
            if ($.input.pressed('up') || $.input.pressed('down')) {
                const direction = $.input.pressed('up') ? -1 : 1;
                edit(shift ? m.duplicateLines(direction) : m.moveLines(direction));
                moved = true;
            }
        }

        // Ввод текста: без Cmd/Ctrl (иначе Cmd+S напечатал бы «s»).
        const typed = $.input.text();
        if (typed && !mod) {
            const auto = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
            if (typed.length === 1 && auto[typed] && v.lang !== 'text') {
                const next = m.lines[m.caret.line][m.caret.col];
                if (m.selection()) edit(m.wrapSelection(typed, auto[typed]));
                else if ((typed === ')' || typed === ']' || typed === '}') && next === typed) m.move('right');
                else { edit(m.insert(typed + auto[typed])); m.move('left'); }
            } else if (typed.length === 1 && (typed === ')' || typed === ']' || typed === '}') &&
                       m.lines[m.caret.line][m.caret.col] === typed && !m.selection()) {
                m.move('right'); moved = true;
            } else {
                edit(m.insert(typed));
            }
        }

        for (const key of REPEAT_KEYS) {
            if (lineMoveHandled && (key === 'up' || key === 'down')) continue;
            if (!fired(key, dt)) continue;
            const word = alt || ($.input.ctrlDown() && !cmd);
            switch (key) {
            case 'left': m.move(cmd ? 'home' : word ? 'wordLeft' : 'left', shift); moved = true; break;
            case 'right': m.move(cmd ? 'end' : word ? 'wordRight' : 'right', shift); moved = true; break;
            case 'up': m.move(cmd ? 'docStart' : 'up', shift); moved = true; break;
            case 'down': m.move(cmd ? 'docEnd' : 'down', shift); moved = true; break;
            case 'pageup': m.move('pageUp', shift, visibleLines()); moved = true; break;
            case 'pagedown': m.move('pageDown', shift, visibleLines()); moved = true; break;
            case 'backspace': edit(m.backspace()); break;
            case 'delete': edit(m.del()); break;
            case 'enter': if (!mod) edit(m.newline()); break;
            case 'tab': edit(m.tab(shift)); break;
            default: break;
            }
        }
        if ($.input.pressed('home')) { m.move(mod ? 'docStart' : 'home', shift); moved = true; }
        if ($.input.pressed('end')) { m.move(mod ? 'docEnd' : 'end', shift); moved = true; }

        if (changed || moved) {
            v.blinkT = 0;
            ensureCaretVisible();
            if (changed) v.hoverPos = null;
            if (changed && v.onChange) v.onChange();
            if (v.onCaret) v.onCaret();
        }
        // Re-evaluate after every typed character so the list can start at `$`,
        // appear after `.`, and keep filtering even when a previous prefix had
        // no matches.
        if (forceCompletion || typed || (v.completion && (changed || moved))) {
            refreshCompletion(forceCompletion || !!typed || !!v.completion, forceCompletion);
            if (!v.completion) v.completionArrowDown.up = v.completionArrowDown.down = false;
        }
    }

    function toggleComment(m) {
        const prefix = v.lang === 'js' ? '//' : v.lang === 'css' ? null : null;
        if (!prefix) return false;
        const sel = m.selection();
        const first = sel ? sel.from.line : m.caret.line;
        const last = sel ? (sel.to.col === 0 && sel.to.line > first ? sel.to.line - 1 : sel.to.line) : m.caret.line;
        const lines = m.lines.slice(first, last + 1);
        const all = lines.every((s) => /^\s*\/\//.test(s) || !s.trim());
        const out = lines.map((s) => all ? s.replace(/^(\s*)\/\/ ?/, '$1') : (s.trim() ? s.replace(/^(\s*)/, '$1// ') : s));
        m.setCaret({ line: first, col: 0 });
        m.setCaret({ line: last, col: m.lines[last].length }, true);
        return m.insert(out.join('\n'));
    }

    function selectNextOccurrence(m) {
        const s = m.selectedText();
        if (!s) { m.selectWord(m.caret); return; }
        m.findNext(s, false, true);
    }

    // --- кадр ------------------------------------------------------------------

    function update(dt, focused, actions) {
        if (!v.model) return;
        if (v.focused !== focused) { v.focused = focused; v.dirty = true; }
        const ime = focused ? $.input.ime() : { text: '' };
        const imeText = ime && typeof ime.text === 'string' ? ime.text : '';
        if (imeText !== v.imeText) { v.imeText = imeText; v.dirty = true; }
        if (focused) handleKeys(dt, actions || {});
        if (v.dragging) {
            if ($.input.mouseDown('left')) {
                const p = posFromMouse();
                if (p) {
                    const c = v.model.caret;
                    if (p.line !== c.line || p.col !== c.col) {
                        v.model.setCaret(p, true);
                        // Протяжка за край — прокрутка.
                        const rows = visibleLines();
                        const row = visibleRowForLine(p.line);
                        if (row <= v.scrollTop) v.scrollTop = Math.max(0, v.scrollTop - 1);
                        else if (row >= v.scrollTop + rows - 1) v.scrollTop += 1;
                        v.dirty = true;
                        if (v.onCaret) v.onCaret();
                    }
                }
            } else v.dragging = false;
        }
        const hoverRect = doc.rect('api-hover');
        const k = scale(), mouse = $.input.mouse();
        const overHoverCard = hoverRect && v.hoverHelp &&
            mouse.x * k >= hoverRect.x && mouse.x * k < hoverRect.x + hoverRect.w &&
            mouse.y * k >= hoverRect.y && mouse.y * k < hoverRect.y + hoverRect.h;
        if (mouseInside() && !overHoverCard) {
            const p = posFromMouse();
            if (p && (!v.hoverPos || p.line !== v.hoverPos.line || p.col !== v.hoverPos.col)) {
                v.hoverPos = p;
                if (v.onHover) v.onHover(p);
            }
            const w = $.input.wheel();
            if (w && (w.y || w.x)) {
                v.scrollTop -= w.y * 3;
                if (w.x) v.scrollLeft -= w.x * 30;
                v.dirty = true;
            }
        } else if (v.hoverPos) {
            v.hoverPos = null;
            if (v.onHover) v.onHover(null);
        }
        // Мигание каретки (только в фокусе).
        v.blinkT += dt;
        const on = !focused || (v.blinkT % 1.06) < 0.53;
        doc.cls('caret', 'blink', !on);
        render();
    }

    return {
        state: v,
        setModel,
        render() { v.dirty = true; render(); },
        invalidate() { v.dirty = true; },
        update,
        mouseDown,
        ensureCaretVisible,
        setDiagnostics(list) { v.diags = list || []; v.dirty = true; },
        acceptCompletion,
        toggleFoldAt,
        chooseCompletion(index) { if (v.completion) { v.completion.selected = index; acceptCompletion(index); } },
        setHoverHelp(path, metadata) { v.hoverHelp = path && metadata ? { path, metadata } : null; v.dirty = true; },
        setFind(query) { v.find.query = query; v.find.hits = v.model ? v.model.findAll(query) : []; v.dirty = true; return v.find.hits.length; },
        visibleLines,
        get model() { return v.model; },
        escape: escapeRml,
    };
}
