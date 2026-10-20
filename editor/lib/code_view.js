// ===========================================================================
// Вид редактора кода в RmlUi: рисует только видимые строки (абсолютные div'ы
// в #code-lines), каретку, выделение, подсветку поиска и подчёркивания
// диагностик. Ввод — через $.input (без <textarea>): текст, клавиши с
// автоповтором, мышь (щелчок, двойной щелчок, протяжка), колесо.
//
// Координаты: RmlUi живёт в пикселях swapchain, $.input.mouse() — в
// логических точках окна; scale() переводит одно в другое.
// ===========================================================================

import { tokenizeLine, lineToRml, lineStates, escapeRml } from './highlight.js';

const LINE_H = 20;
const REPEAT_DELAY = 0.42;
const REPEAT_RATE = 0.035;
const REPEAT_KEYS = ['left', 'right', 'up', 'down', 'backspace', 'delete', 'enter', 'pageup', 'pagedown', 'tab'];

export function createCodeView($, doc) {
    const v = {
        model: null,
        lang: 'text',
        scrollTop: 0,          // строк (может быть дробным)
        scrollLeft: 0,         // пикселей
        charW: 0,
        dirty: true,
        statesVersion: -1,
        states: [],
        diags: [],             // [{ line(1), col(1), severity }]
        find: { query: '', hits: [] },
        held: null,            // { key, t, next }
        dragging: false,
        blinkT: 0,
        lastClick: { t: -1, line: -1, col: -1 },
        onChange: null,        // колбэк: правка документа
        onCaret: null,         // колбэк: каретка сдвинулась
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

    function setModel(model, lang) {
        v.model = model;
        v.lang = lang || 'text';
        v.scrollTop = 0; v.scrollLeft = 0;
        v.statesVersion = -1;
        v.dirty = true;
    }

    function ensureCaretVisible() {
        if (!v.model) return;
        const c = v.model.caret, rows = visibleLines();
        if (c.line < v.scrollTop) v.scrollTop = c.line;
        else if (c.line >= v.scrollTop + rows) v.scrollTop = c.line - rows + 1;
        const r = textRect(), cw = v.charW || measure();
        if (r && cw) {
            const x = c.col * cw;
            if (x < v.scrollLeft) v.scrollLeft = Math.max(0, x - cw * 4);
            else if (x > v.scrollLeft + r.w - cw * 2) v.scrollLeft = x - r.w + cw * 6;
        }
        v.dirty = true;
    }

    function clampScroll() {
        const max = Math.max(0, v.model.lineCount() - Math.floor(visibleLines() / 2));
        v.scrollTop = Math.max(0, Math.min(max, v.scrollTop));
        v.scrollLeft = Math.max(0, v.scrollLeft);
    }

    // --- отрисовка ----------------------------------------------------------

    function render() {
        if (!v.model || !v.dirty) return;
        v.dirty = false;
        const cw = v.charW || measure() || 8;
        const m = v.model, lines = m.lines;
        if (v.statesVersion !== m.version) {
            v.states = lineStates(lines, v.lang);
            v.statesVersion = m.version;
        }
        clampScroll();
        const first = Math.floor(v.scrollTop);
        const rows = visibleLines() + 1;
        const offY = -(v.scrollTop - first) * LINE_H;
        const caret = m.caret, sel = m.selection();
        const diagByLine = new Map();
        for (const d of v.diags) {
            const prev = diagByLine.get(d.line - 1);
            if (!prev || d.severity === 'error') diagByLine.set(d.line - 1, d.severity);
        }
        let gutter = '', text = '', under = '';
        for (let r = 0; r < rows; r++) {
            const i = first + r;
            if (i >= lines.length) break;
            const y = Math.round(offY + r * LINE_H);
            const sev = diagByLine.get(i);
            const lnCls = 'ln' + (i === caret.line ? ' cur' : '') + (sev === 'error' ? ' err' : sev ? ' warn' : '');
            gutter += '<div class="' + lnCls + '" style="top: ' + y + 'px;">' + (i + 1) + '</div>';
            const tokens = tokenizeLine(lines[i], v.lang, v.states[i]).tokens;
            text += '<div class="cl" style="top: ' + y + 'px; left: ' + (-Math.round(v.scrollLeft)) + 'px;">' + lineToRml(tokens) + '</div>';
            if (i === caret.line && !sel) under += '<div class="cur-line" style="top: ' + y + 'px;"></div>';
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
            if (h.line < first || h.line >= first + rows) continue;
            under += rect('find-rect', Math.round(offY + (h.line - first) * LINE_H), h.col, h.col + h.len, cw);
        }
        doc.html('code-gutter', gutter);
        doc.html('code-lines', text);
        doc.html('code-under', under);
        const cy = Math.round(offY + (caret.line - first) * LINE_H) + 1;
        doc.style('caret', 'top', cy + 'px');
        doc.style('caret', 'left', Math.round(caret.col * cw - v.scrollLeft) + 'px');
        doc.cls('caret', 'hidden', caret.line < first || caret.line >= first + rows);
        // Полоса прокрутки — индикатор положения (прокрутка колесом/кареткой).
        const r = textRect();
        if (r) {
            const total = Math.max(lines.length, 1), vis = visibleLines();
            const h = Math.max(24, r.h * Math.min(1, vis / total));
            const top = (r.h - h) * (total > vis ? v.scrollTop / Math.max(1, total - vis / 2) : 0);
            doc.style('code-vscroll', 'top', Math.round(Math.min(r.h - h, top)) + 'px');
            doc.style('code-vscroll', 'height', Math.round(h) + 'px');
            doc.cls('code-vscroll', 'hidden', total <= vis);
        }
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
        const line = Math.floor(v.scrollTop + y / LINE_H);
        return { line: Math.max(0, Math.min(v.model.lineCount() - 1, line)), col: Math.max(0, Math.round(x / cw)) };
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
        const t = $.time.realNow();
        const dbl = t - v.lastClick.t < 0.35 && p.line === v.lastClick.line && Math.abs(p.col - v.lastClick.col) <= 1;
        v.lastClick = { t, line: p.line, col: p.col };
        if (dbl) { v.model.selectWord(p); v.dragging = false; }
        else { v.model.setCaret(p, $.input.shiftDown()); v.dragging = true; }
        v.blinkT = 0;
        v.dirty = true;
        if (v.onCaret) v.onCaret();
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
        const edit = (ok) => { if (ok) changed = true; };

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
            if ($.input.pressed('f') && actions.find) actions.find();
            if ($.input.pressed('g') && actions.gotoLine) actions.gotoLine();
        }

        // Ввод текста: без Cmd/Ctrl (иначе Cmd+S напечатал бы «s»).
        const typed = $.input.text();
        if (typed && !mod) {
            const auto = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
            if (typed.length === 1 && auto[typed] && !m.selection() && v.lang !== 'text') {
                const next = m.lines[m.caret.line][m.caret.col];
                if ((typed === ')' || typed === ']' || typed === '}') && next === typed) m.move('right');
                else { edit(m.insert(typed + auto[typed])); m.move('left'); }
            } else if (typed.length === 1 && (typed === ')' || typed === ']' || typed === '}') &&
                       m.lines[m.caret.line][m.caret.col] === typed && !m.selection()) {
                m.move('right'); moved = true;
            } else {
                edit(m.insert(typed));
            }
        }

        for (const key of REPEAT_KEYS) {
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
            if (changed && v.onChange) v.onChange();
            if (v.onCaret) v.onCaret();
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
                        if (p.line <= v.scrollTop) v.scrollTop = Math.max(0, v.scrollTop - 1);
                        else if (p.line >= v.scrollTop + rows - 1) v.scrollTop += 1;
                        v.dirty = true;
                        if (v.onCaret) v.onCaret();
                    }
                }
            } else v.dragging = false;
        }
        if (mouseInside()) {
            const w = $.input.wheel();
            if (w && (w.y || w.x)) {
                v.scrollTop -= w.y * 3;
                if (w.x) v.scrollLeft -= w.x * 30;
                v.dirty = true;
            }
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
        setFind(query) { v.find.query = query; v.find.hits = v.model ? v.model.findAll(query) : []; v.dirty = true; return v.find.hits.length; },
        visibleLines,
        get model() { return v.model; },
        escape: escapeRml,
    };
}
