// ===========================================================================
// Вид редактора кода в RmlUi: рисует только видимые строки (абсолютные div'ы
// в #code-lines), каретку, выделение, подсветку поиска и подчёркивания
// диагностик. Ввод — через $.input (без <textarea>): текст, клавиши с
// автоповтором, мышь (щелчок, двойной щелчок, протяжка), колесо.
//
// Координаты: RmlUi живёт в пикселях swapchain, $.input.mouse() — в
// логических точках окна; scale() переводит одно в другое.
// ===========================================================================

import { lineDiff } from './line_diff.js';
import { splitLines } from './code_model.js';
import { tokenizeLine, lineToRml, lineStates, lineDepths, colorBrackets, bracketPairs, foldingRanges, matchingBracket, escapeRml, createApiHighlightContext, highlightApiTokens } from './highlight.js';
import { apiCompletionContext, nodeApiCompletionContext, completeApiSymbols, jsCompletionContext, completeJavaScriptSymbols, paramHintFor, snippetItems, localSymbolItems } from './api_language.js';

const LINE_H = 20;
const TOP = 24;        // высота строки хлебных крошек над кодом
const MAP_LH = 3;      // высота строки на мини-карте
const TABW = 4;    // ширина символа табуляции в колонках
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
        lastClick: { t: -1, line: -1, col: -1, n: 0 },
        lineClip: null,        // текст, скопированный как целая строка (вставка — над текущей)
        foldLineCount: -1,
        pendingFolds: null,
        depths: [],
        base: null,            // строки сохранённой версии (для маркеров изменений)
        diff: null, diffVersion: -1, diffTime: 0,
        filePath: '', crumbKey: '',
        stickyRows: 0,
        map: { top: 0, h: 0 },
        drag: null,            // перетаскивание ползунка / мини-карты
        hoverDiag: null,
        paramHint: null, paramMarkup: null,
        menu: null,            // контекстное меню: { items }
        opts: { whitespace: false, sticky: true },
        findOpts: { caseSensitive: false, wholeWord: false, regex: false },
        onChange: null,        // колбэк: правка документа
        onCaret: null,         // колбэк: каретка сдвинулась
        onGoto: null,          // Cmd/Ctrl+щелчок: перейти к определению в позиции
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

    // Колонка символа (индекс) -> экранная колонка с учётом табов, и обратно.
    function vcol(line, col) {
        const s = v.model.lines[line];
        if (s === undefined || s.indexOf('\t') < 0) return col;
        let x = 0;
        for (let i = 0; i < col; i++) x += i < s.length && s[i] === '\t' ? TABW - (x % TABW) : 1;
        return x;
    }
    function colAt(line, vc) {
        const s = v.model.lines[line] || '';
        if (s.indexOf('\t') < 0) return Math.min(s.length, Math.max(0, Math.round(vc)));
        let x = 0;
        for (let i = 0; i < s.length; i++) {
            const w = s[i] === '\t' ? TABW - (x % TABW) : 1;
            if (vc < x + w / 2) return i;
            x += w;
        }
        return s.length;
    }
    function expandTabs(tokens) {
        let x = 0;
        return tokens.map((t) => {
            if (t.text.indexOf('\t') < 0) { x += t.text.length; return t; }
            let out = '';
            for (const ch of t.text) {
                if (ch === '\t') { const w = TABW - (x % TABW); out += ' '.repeat(w); x += w; }
                else { out += ch; x++; }
            }
            return Object.assign({}, t, { text: out });
        });
    }

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
        v.completion = null; v.hoverPos = null; v.hoverApiPath = ''; v.paramHint = null; v.hoverDiag = null; closeMenu();
        v.diff = null; v.diffVersion = -1; v.crumbKey = ''; v.depths = [];
        v.statesVersion = -1; v.apiHighlightVersion = -1; v.bracketsVersion = -1; v.visibleVersion = -2;
        v.foldRanges.clear(); v.visibleDocLines = [];
        v.collapsedFolds.clear(); v.foldLineCount = -1;
        v.dirty = true;
    }

    function ensureCaretVisible() {
        if (!v.model) return;
        const c = v.model.caret, rows = visibleLines();
        revealLine(c.line);
        const row = visibleRowForLine(c.line);
        if (row < v.scrollTop + v.stickyRows) v.scrollTop = Math.max(0, row - v.stickyRows);
        else if (row >= v.scrollTop + rows) v.scrollTop = row - rows + 1;
        const r = textRect(), cw = v.charW || measure();
        if (r && cw) {
            const x = vcol(c.line, c.col) * cw;
            if (x < v.scrollLeft) v.scrollLeft = Math.max(0, x - cw * 4);
            else if (x > v.scrollLeft + r.w - cw * 2) v.scrollLeft = x - r.w + cw * 6;
        }
        v.dirty = true;
    }

    function clampScroll() {
        rebuildVisibleDocLines();
        // Можно прокрутить так, что последняя строка поднимется на середину окна (как в VS Code).
        const max = Math.max(0, v.visibleDocLines.length - Math.ceil(visibleLines() / 2));
        v.scrollTop = Math.max(0, Math.min(max, v.scrollTop));
        v.scrollLeft = Math.max(0, v.scrollLeft);
    }

    // --- отрисовка ----------------------------------------------------------

    // Отступ строки в колонках; у пустой строки — по ближайшим непустым (направляющие без разрывов).
    function indentOf(lines, i) {
        const lead = (s) => { let n = 0; for (const ch of s) { if (ch === ' ') n++; else if (ch === '\t') n += 4; else break; } return n; };
        if (lines[i].trim()) return lead(lines[i]);
        let up = i - 1, down = i + 1;
        while (up >= 0 && i - up < 60 && !lines[up].trim()) up--;
        while (down < lines.length && down - i < 60 && !lines[down].trim()) down++;
        const a = up >= 0 ? lead(lines[up]) : 0, b = down < lines.length ? lead(lines[down]) : 0;
        return Math.min(a, b);
    }

    // Слово для подсветки одинаковых: выделенное целиком слово либо слово под кареткой.
    function occurrenceWord(m, sel) {
        if (sel) {
            if (sel.from.line !== sel.to.line) return '';
            const w = m.wordAt(sel.from);
            return w && w.from === sel.from.col && w.to === sel.to.col ? w.text : '';
        }
        const w = m.wordAt(m.caret);
        return w && w.text.length > 1 ? w.text : '';
    }


    // Токены строки для отрисовки: подсветка языка, API `$`, цветные скобки, табы/пробелы.
    function tokensFor(i) {
        const lines = v.model.lines;
        let tokens = tokenizeLine(lines[i], v.lang, v.states[i]).tokens;
        if (v.lang === 'js') tokens = highlightApiTokens(tokens, lines[i], v.apiHighlightContext);
        if (v.lang === 'js' || v.lang === 'json' || v.lang === 'css') tokens = colorBrackets(tokens, v.depths[i] || 0);
        if (v.opts.whitespace) return decorateWhitespace(tokens);
        return lines[i].indexOf('\t') >= 0 ? expandTabs(tokens) : tokens;
    }

    // Режим «показывать пробелы»: точки и стрелка табуляции, ширина сохраняется.
    function decorateWhitespace(tokens) {
        const out = [];
        let x = 0;
        for (const t of tokens) {
            let run = '', plain = '';
            const flush = () => { if (plain) out.push(Object.assign({}, t, { text: plain })); plain = ''; };
            for (const ch of t.text) {
                if (ch === ' ') { flush(); out.push({ cls: 'tk-ws', text: '·' }); x++; }
                else if (ch === '\t') {
                    flush();
                    const w = TABW - (x % TABW);
                    out.push({ cls: 'tk-ws', text: '»' + ' '.repeat(w - 1) });
                    x += w;
                } else { plain += ch; x++; }
            }
            flush();
            void run;
        }
        return out;
    }

    // Начала блоков `{…}`, охватывающих строку (по возрастанию).
    function enclosingScopes(line) {
        const list = [];
        for (const [start, end] of v.foldRanges) if (start < line && end >= line) list.push(start);
        return list.sort((a, b) => a - b);
    }

    function scopeName(text) {
        const t = String(text).trim().replace(/\{\s*$/, '').trim();
        let r = /(?:function\*?|class)\s+([\w$]+)/.exec(t);
        if (r) return r[1];
        r = /^(?:export\s+)?(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?([\w$]+)\s*\(/.exec(t);
        if (r && !/^(if|for|while|switch|catch|else|return|function)$/.test(r[1])) return r[1] + '()';
        r = /^(?:export\s+)?(?:const|let|var)\s+([\w$]+)/.exec(t);
        if (r) return r[1];
        r = /^([\w$."']+)\s*[:=]/.exec(t);
        if (r) return r[1];
        return t.length > 28 ? t.slice(0, 28) + '...' : t;
    }

    function updateDiff(m) {
        if (!v.base) { v.diff = null; return; }
        if (v.diffVersion === m.version) return;
        const t = $.time.realNow();
        // Пересчёт не чаще 5 раз в секунду: LCS на больших правках дорог.
        if (v.diff && t - v.diffTime < 0.2) { v.dirty = true; return; }
        v.diff = lineDiff(v.base, m.lines);
        v.diffVersion = m.version;
        v.diffTime = t;
    }

    function renderCrumbs(caret, m) {
        const key = v.filePath + '|' + caret.line + '|' + m.version + '|' + v.foldRanges.size;
        if (v.crumbKey === key) return;
        v.crumbKey = key;
        const sep = '<span class="crumb-sep">' + ($.ui.icon('chevron_right') || '>') + '</span>';
        const parts = String(v.filePath || '').split('/').filter(Boolean).map((p) => '<span class="crumb">' + escapeRml(p) + '</span>');
        for (const start of enclosingScopes(caret.line).concat(m.lines[caret.line] && v.foldRanges.has(caret.line) ? [caret.line] : [])) {
            parts.push('<span class="crumb" data-key="crumb:' + start + '">' + escapeRml(scopeName(m.lines[start])) + '</span>');
        }
        doc.html('crumbs', parts.join(sep));
    }

    // Мини-карта: по строке на 3 px; рисуется только видимый её кусок.
    function renderMap(m, vis) {
        const r = doc.rect('code-map');
        if (!r || r.h <= 0) return;
        const total = v.visibleDocLines.length;
        const full = total * MAP_LH, maxScroll = Math.max(0, total - vis);
        const mapTop = full > r.h ? (full - r.h) * (maxScroll > 0 ? v.scrollTop / maxScroll : 0) : 0;
        v.map = { top: mapTop, h: r.h };
        const first = Math.floor(mapTop / MAP_LH), last = Math.min(total - 1, Math.ceil((mapTop + r.h) / MAP_LH));
        let html = '';
        for (let row = first; row <= last; row++) {
            const s = m.lines[v.visibleDocLines[row]];
            const t = s.trim();
            if (!t) continue;
            let lead = 0;
            for (const ch of s) { if (ch === '\t') lead += 4; else if (ch === ' ') lead++; else break; }
            const x = Math.min(60, lead * 2) + 4;
            const w = Math.max(2, Math.min(84 - x, Math.round(t.length * 1.1)));
            const comment = t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
            html += '<div class="' + (comment ? 'mm-c' : 'mm-l') + '" style="top: ' + Math.round(row * MAP_LH - mapTop) + 'px; left: ' + x + 'px; width: ' + w + 'px;"></div>';
        }
        const mark = (line, cls) => {
            const row = visibleRowForLine(line);
            if (v.visibleDocLines[row] !== line) return '';
            const y = Math.round(row * MAP_LH - mapTop);
            return y < -3 || y > r.h ? '' : '<div class="mm-m ' + cls + '" style="top: ' + y + 'px;"></div>';
        };
        for (const d of v.diags) html += mark(d.line - 1, d.severity === 'error' ? 'mm-e' : 'mm-w');
        for (const h of v.find.hits) html += mark(h.line, 'mm-f');
        doc.html('code-map-lines', html);
        doc.style('code-map-slider', 'top', Math.round(v.scrollTop * MAP_LH - mapTop) + 'px');
        doc.style('code-map-slider', 'height', Math.max(6, Math.min(r.h, Math.round(vis * MAP_LH))) + 'px');
    }

    function render() {
        if (!v.model || !v.dirty) return;
        v.dirty = false;
        const cw = v.charW || measure() || 8;
        const m = v.model, lines = m.lines;
        const codeViewport = textRect();
        const lineViewportWidth = codeViewport ? Math.max(0, codeViewport.w - 18) : 782;
        if (v.statesVersion !== m.version) {
            v.states = lineStates(lines, v.lang);
            v.depths = lineDepths(lines, v.lang);
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
            // Правка внутри строки сохраняет свёрнутые блоки; смена числа строк сдвигает их — сбрасываем.
            if (v.foldLineCount !== lines.length) v.collapsedFolds.clear();
            else for (const start of [...v.collapsedFolds]) if (!v.foldRanges.has(start)) v.collapsedFolds.delete(start);
            v.foldLineCount = lines.length;
            if (v.pendingFolds) {
                for (const start of v.pendingFolds) if (v.foldRanges.has(start)) v.collapsedFolds.add(start);
                v.pendingFolds = null;
            }
            v.visibleVersion = -1;
        }
        clampScroll();
        updateDiff(m);
        const first = Math.floor(v.scrollTop);
        const rows = visibleLines() + 1;
        const offY = -(v.scrollTop - first) * LINE_H;
        const caret = m.caret, cursors = m.cursors;
        // Закреплённые строки охватывающих блоков (sticky scroll): до трёх, пока верхняя строка внутри блока.
        let scopes = [];
        if (v.opts.sticky && v.scrollTop > 0) {
            // Первая строка под закреплёнными: берём наименьшее n, при котором её блоков не больше n.
            for (let n = 0; n <= 3; n++) {
                const top = v.visibleDocLines[first + n];
                const list = top === undefined ? [] : enclosingScopes(top).slice(-3);
                if (list.length <= n) { scopes = list; break; }
            }
        }
        v.stickyRows = scopes.length;
        const sels = [];
        for (const c of cursors) {
            if (!c.anchor || (c.anchor.line === c.caret.line && c.anchor.col === c.caret.col)) continue;
            const back = c.anchor.line > c.caret.line || (c.anchor.line === c.caret.line && c.anchor.col > c.caret.col);
            sels.push(back ? { from: c.caret, to: c.anchor } : { from: c.anchor, to: c.caret });
        }
        const bracketOther = matchingBracket(v.brackets, caret);
        const bracketHere = bracketOther
            ? (v.brackets.has(caret.line + ':' + caret.col) ? caret : { line: caret.line, col: caret.col - 1 })
            : null;
        const diagByLine = new Map();
        for (const d of v.diags) {
            const prev = diagByLine.get(d.line - 1);
            if (!prev || (d.severity === 'error' && prev.severity !== 'error')) diagByLine.set(d.line - 1, d);
        }
        const occ = sels.length > 1 ? '' : occurrenceWord(m, sels[0] || null);
        const lastRow = Math.min(v.visibleDocLines.length - 1, first + rows);
        const occHits = occ ? m.findInLines(occ, { caseSensitive: true, wholeWord: true },
            v.visibleDocLines[first] || 0, v.visibleDocLines[lastRow] || 0) : [];
        const occByLine = new Map();
        for (const h of occHits) {
            if (!occByLine.has(h.line)) occByLine.set(h.line, []);
            occByLine.get(h.line).push(h);
        }
        const showOcc = occHits.length > 1 || (occHits.length === 1 && sels.length === 1);
        let gutter = '', text = '', under = '';
        for (let r = 0; r < rows; r++) {
            const i = v.visibleDocLines[first + r];
            if (i === undefined) break;
            const y = Math.round(offY + r * LINE_H);
            const diag = diagByLine.get(i), sev = diag && diag.severity;
            const lnCls = 'ln' + (i === caret.line ? ' cur' : '') + (sev === 'error' ? ' err' : sev ? ' warn' : '');
            const foldEnd = v.foldRanges.get(i);
            const mark = v.diff && v.diff.marks.get(i);
            gutter += '<div class="' + lnCls + '" data-key="ln:' + i + '" style="top: ' + y + 'px;">' + (foldEnd
                ? '<span class="fold-toggle" data-key="fold:' + i + '">' + ($.ui.icon(v.collapsedFolds.has(i) ? 'chevron_right' : 'expand_more') || '') + '</span>'
                : '') + (i + 1) + '</div>' +
                (mark ? '<div class="gm gm-' + mark + '" style="top: ' + y + 'px;"></div>' : '') +
                (v.diff && v.diff.deleted.has(i) ? '<div class="gm gm-del" style="top: ' + (y - 1) + 'px;"></div>' : '');
            const tokens = tokensFor(i);
            text += '<div class="cl" style="top: ' + y + 'px; left: ' + (-Math.round(v.scrollLeft)) + 'px; width: ' +
                Math.ceil(lineViewportWidth + v.scrollLeft) + 'px;">' + lineToRml(tokens) +
                (v.collapsedFolds.has(i) ? '<span class="fold-placeholder"> ... ' + (foldEnd - i) + ' lines</span>' : '') + '</div>';
            if (i === caret.line && !sels.length && cursors.length === 1) under += '<div class="cur-line" style="top: ' + y + 'px;"></div>';
            const levels = Math.floor(indentOf(lines, i) / 4);
            for (let g = 0; g < levels; g++) {
                const gx = Math.round(g * 4 * cw - v.scrollLeft);
                if (gx >= 0) under += '<div class="indent-guide" style="top: ' + y + 'px; left: ' + gx + 'px;"></div>';
            }
            if (showOcc && occByLine.has(i)) {
                for (const h of occByLine.get(i)) under += rect('occ-rect', y, i, h.col, h.col + h.len, cw);
            }
            if (bracketHere && bracketOther) {
                if (bracketHere.line === i) under += rect('bracket-match', y, i, bracketHere.col, bracketHere.col + 1, cw);
                if (bracketOther.line === i) under += rect('bracket-match', y, i, bracketOther.col, bracketOther.col + 1, cw);
            }
            for (const sl of sels) {
                if (i < sl.from.line || i > sl.to.line) continue;
                const a = i === sl.from.line ? sl.from.col : 0;
                const b = i === sl.to.line ? sl.to.col : lines[i].length + 1;
                under += rect('sel-rect', y, i, a, b, cw);
            }
            if (sev) {
                const a = Math.max(0, (diag.col || 1) - 1);
                const b = Math.max(a + 1, wordEnd(lines[i], a));
                under += '<div class="diag-line' + (sev === 'error' ? '' : ' warn') + '" style="top: ' + (y + 18) + 'px; left: ' +
                    Math.round(vcol(i, a) * cw - v.scrollLeft) + 'px; width: ' + Math.round((vcol(i, b) - vcol(i, a)) * cw) + 'px;"></div>';
            }
        }
        for (const h of v.find.hits) {
            const row = visibleRowForLine(h.line);
            if (v.visibleDocLines[row] !== h.line || row < first || row >= first + rows) continue;
            under += rect('find-rect', Math.round(offY + (row - first) * LINE_H), h.line, h.col, h.col + h.len, cw);
        }
        doc.html('code-gutter', gutter);
        doc.html('code-lines', text);
        doc.html('code-under', under);
        const caretRow = visibleRowForLine(caret.line);
        const cy = Math.round(offY + (caretRow - first) * LINE_H) + 1;
        const caretVisible = v.visibleDocLines[caretRow] === caret.line && caretRow >= first && caretRow < first + rows;
        doc.style('caret', 'top', cy + 'px');
        doc.style('caret', 'left', Math.round(vcol(caret.line, caret.col) * cw - v.scrollLeft) + 'px');
        doc.cls('caret', 'hidden', !caretVisible);
        let extra = '';
        for (const c of cursors) {
            if (c.primary) continue;
            const row = visibleRowForLine(c.caret.line);
            if (v.visibleDocLines[row] !== c.caret.line || row < first || row >= first + rows) continue;
            extra += '<div class="xcaret" style="top: ' + (Math.round(offY + (row - first) * LINE_H) + 1) + 'px; left: ' +
                Math.round(vcol(c.caret.line, c.caret.col) * cw - v.scrollLeft) + 'px;"></div>';
        }
        doc.html('carets-extra', extra);
        const ime = v.focused ? $.input.ime() : { text: '', start: 0 };
        const imeText = ime && typeof ime.text === 'string' ? ime.text : '';
        doc.text('ime-preview', imeText);
        doc.style('ime-preview', 'top', cy + 'px');
        doc.style('ime-preview', 'left', Math.round(vcol(caret.line, caret.col) * cw - v.scrollLeft) + 'px');
        doc.cls('ime-preview', 'hidden', !imeText || !caretVisible);
        if (v.focused && $.input.textInputArea) {
            const rect = doc.rect('caret'), k = scale();
            if (rect) $.input.textInputArea(rect.x / k, rect.y / k, Math.max(1, rect.w / k), Math.max(1, rect.h / k), 0);
        }
        // Вертикальная полоса: ползунок можно тянуть, щелчок по дорожке прыгает.
        const r = textRect();
        if (r) {
            const total = Math.max(v.visibleDocLines.length, 1), vis = visibleLines();
            const h = Math.max(24, r.h * Math.min(1, vis / total));
            const maxScroll = Math.max(1, total - Math.ceil(vis / 2));
            const top = (r.h - h) * (total > vis ? Math.min(1, v.scrollTop / maxScroll) : 0);
            doc.style('code-vscroll', 'top', (TOP + Math.round(Math.min(r.h - h, top))) + 'px');
            doc.style('code-vscroll', 'height', Math.round(h) + 'px');
            doc.cls('code-vscroll', 'hidden', total <= vis);
        }
        // Закреплённые строки блоков.
        if (scopes.length) {
            let html = '';
            scopes.forEach((line, idx) => {
                html += '<div class="sticky-row" data-key="sticky:' + line + '" style="top: ' + (idx * LINE_H) + 'px;">' +
                    '<span class="sticky-ln" data-key="sticky:' + line + '">' + (line + 1) + '</span>' +
                    '<div class="sticky-code" data-key="sticky:' + line + '"><div style="margin-left: ' + (-Math.round(v.scrollLeft)) + 'px;">' +
                    lineToRml(tokensFor(line)) + '</div></div></div>';
            });
            doc.html('code-sticky', html);
            doc.style('code-sticky', 'height', (scopes.length * LINE_H + 1) + 'px');
        }
        doc.cls('code-sticky', 'hidden', !scopes.length);
        renderCrumbs(caret, m);
        renderMap(m, visibleLines());
        renderCompletion();
        renderHoverHelp();
        renderParamHint();
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
        const x = 64 + Math.round(vcol(caret.line, caret.col) * cw - v.scrollLeft);
        const y = Math.round((visibleRowForLine(caret.line) - v.scrollTop) * LINE_H + LINE_H) + TOP;
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
        let help = v.hoverHelp;
        if (v.hoverDiag) {
            const d = v.hoverDiag;
            help = { path: (d.severity === 'error' ? 'Ошибка' : 'Предупреждение') + (d.code ? ' ' + d.code : ''),
                metadata: { signature: '', description: d.message || '' }, isDiag: true };
        }
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
        doc.style('api-hover', 'border-color', help.isDiag ? '#8a3a3a' : '#536071');
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
        let items = context.mode === 'js'
            ? completeJavaScriptSymbols(context, null, 16)
            : completeApiSymbols(v.apiSymbols, context, 16);
        if (context.mode === 'js' && context.target === 'global') {
            // Объявления этого файла и сниппеты — выше стандартных глобалов.
            const known = new Set();
            items = [...snippetItems(context.member, 3), ...localSymbolItems(v.model.lines, context.member, 8), ...items]
                .filter((item) => !known.has(item.path) && known.add(item.path)).slice(0, 16);
        }
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

    // Вставка сниппета: отступ строк по текущей строке, каретка на `$0`.
    function insertSnippet(body) {
        const m = v.model, line = m.lines[m.caret.line];
        const indent = (/^[\t ]*/.exec(line) || [''])[0];
        const text = body.split('\n').map((row, i) => (i ? indent + row : row)).join('\n');
        const at = text.indexOf('$0');
        const clean = text.replace('$0', '');
        const start = m.selection() ? m.selection().from : m.caret;
        m.insert(clean);
        if (at >= 0) {
            const before = clean.slice(0, at).split('\n');
            const line0 = start.line + before.length - 1;
            const col0 = before.length === 1 ? start.col + before[0].length : before[before.length - 1].length;
            m.setCaret({ line: line0, col: col0 });
        }
    }

    function acceptCompletion(index) {
        const c = v.completion;
        if (!c || !c.items.length) return false;
        const item = c.items[Math.max(0, Math.min(c.items.length - 1, index === undefined ? c.selected : index))];
        const caret = v.model.caret;
        v.model.setCaret({ line: caret.line, col: c.context.fromCol });
        v.model.setCaret(caret, true);
        if (item.snippet) insertSnippet(item.snippet);
        else v.model.insert((c.context.insertPrefix || '') + item.name);
        v.completion = null;
        v.dirty = true;
        ensureCaretVisible();
        if (v.onChange) v.onChange();
        if (v.onCaret) v.onCaret();
        return true;
    }

    function rect(cls, y, line, a, b, cw) {
        const va = vcol(line, a), vb = b > v.model.lines[line].length ? vcol(line, v.model.lines[line].length) + (b - v.model.lines[line].length) : vcol(line, b);
        return '<div class="' + cls + '" style="top: ' + y + 'px; left: ' + Math.round(va * cw - v.scrollLeft) +
            'px; width: ' + Math.max(2, Math.round((vb - va) * cw)) + 'px;"></div>';
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
        return { line, col: colAt(line, x / cw) };
    }

    function mouseInside() {
        const r = doc.rect('code');
        if (!r) return false;
        const k = scale(), mouse = $.input.mouse();
        const x = mouse.x * k, y = mouse.y * k;
        return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    }

    function inside(r) {
        if (!r) return false;
        const k = scale(), mouse = $.input.mouse();
        const x = mouse.x * k, y = mouse.y * k;
        return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    }

    // Область под мышью: map | vscroll | crumbs | text.
    function region() {
        if (inside(doc.rect('code-map'))) return 'map';
        if (inside(doc.rect('crumbs'))) return 'crumbs';
        const tr = textRect();
        if (tr && v.visibleDocLines.length > visibleLines()) {
            const k = scale(), mouse = $.input.mouse();
            const x = mouse.x * k, y = mouse.y * k;
            if (x >= tr.x + tr.w - 14 && x < tr.x + tr.w && y >= tr.y && y < tr.y + tr.h) return 'vscroll';
        }
        return 'text';
    }

    function scrollFromMap(grab) {
        const r = doc.rect('code-map');
        if (!r) return;
        const k = scale(), my = $.input.mouse().y * k - r.y;
        const row = (my + v.map.top) / MAP_LH;
        v.scrollTop = row - visibleLines() / 2;
        clampScroll();
        v.dirty = true;
        void grab;
    }

    function scrollFromBar(grab) {
        const tr = textRect(), th = doc.rect('code-vscroll');
        if (!tr || !th) return;
        const total = v.visibleDocLines.length, vis = visibleLines();
        const maxScroll = Math.max(1, total - Math.ceil(vis / 2));
        const k = scale(), my = $.input.mouse().y * k - tr.y;
        const range = Math.max(1, tr.h - th.h);
        v.scrollTop = ((my - grab) / range) * maxScroll;
        clampScroll();
        v.dirty = true;
    }

    function closeMenu() { if (v.menu) { v.menu = null; doc.cls('code-menu', 'hidden', true); } }

    // Нажатие внутри области кода (зовёт app по событию mousedown).
    function mouseDown() {
        closeMenu();
        const where = region();
        if (where === 'map') { v.drag = { kind: 'map', grab: 0 }; scrollFromMap(0); return; }
        if (where === 'vscroll') {
            const th = doc.rect('code-vscroll'), k = scale(), my = $.input.mouse().y * k;
            const onThumb = th && my >= th.y && my < th.y + th.h;
            v.drag = { kind: 'vscroll', grab: onThumb ? my - th.y : (th ? th.h / 2 : 12) };
            if (!onThumb) scrollFromBar(v.drag.grab);
            return;
        }
        if (where === 'crumbs') return;
        const p = posFromMouse();
        if (!p) return;
        v.completion = null;
        if ($.input.altDown() && !$.input.shiftDown()) {
            // Alt+щелчок — ещё один курсор.
            v.model.addCursor(p);
            v.dragging = false; v.blinkT = 0; v.dirty = true;
            if (v.onCaret) v.onCaret();
            return;
        }
        if ((primary()) && v.onGoto) { v.model.setCaret(p); v.dragging = false; v.dirty = true; v.onGoto(p); return; }
        const t = $.time.realNow();
        const again = t - v.lastClick.t < 0.4 && p.line === v.lastClick.line && Math.abs(p.col - v.lastClick.col) <= 1;
        const n = again ? v.lastClick.n + 1 : 1;
        v.lastClick = { t, line: p.line, col: p.col, n };
        if (n === 2) { v.model.selectWord(p); v.dragging = false; }
        else if (n >= 3) { v.model.setCaret(p); v.model.selectLine(); v.dragging = false; v.lastClick.n = 0; }
        else { v.model.setCaret(p, $.input.shiftDown()); v.dragging = true; }
        v.blinkT = 0;
        v.dirty = true;
        refreshParamHint();
        if (v.onCaret) v.onCaret();
    }

    // Щелчок по номеру строки выделяет её (протяжка по гаттеру не нужна).
    function selectLineAt(line) {
        if (!v.model || line < 0 || line >= v.model.lineCount()) return;
        v.model.setCaret({ line, col: 0 });
        v.model.selectLine();
        v.blinkT = 0; v.dirty = true;
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
        if ($.input.pressed('escape') && m.hasMultiCursor) { m.clearExtraCursors(); moved = true; }
        else if ($.input.pressed('escape') && v.paramHint) { v.paramHint = null; v.dirty = true; }
        if ($.input.pressed('f12') && !shift && actions.gotoDefinition) actions.gotoDefinition();
        if ($.input.pressed('f2') && actions.rename) actions.rename();
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
                // Без выделения копируется / вырезается вся строка (как в VS Code).
                const whole = !m.selection();
                const s = whole ? m.lines[m.caret.line] + '\n' : m.selectedText();
                $.input.setClipboard(s);
                v.lineClip = whole ? s : null;
                if ($.input.pressed('x')) edit(whole ? m.deleteLine() : m.insert(''));
            }
            if ($.input.pressed('v')) {
                const s = $.input.clipboard();
                if (s) {
                    // Строка, скопированная целиком, вставляется над текущей, каретка остаётся в своей колонке.
                    if (s === v.lineClip && !m.selection() && !m.hasMultiCursor) {
                        const col = m.caret.col;
                        m.setCaret({ line: m.caret.line, col: 0 });
                        edit(m.insert(s));
                        m.setCaret({ line: m.caret.line, col });
                    } else edit(m.paste(s));
                }
            }
            if ($.input.pressed('z')) { edit(shift ? m.redo() : m.undo()); }
            if ($.input.pressed('y')) edit(m.redo());
            if ($.input.pressed('slash')) { edit(toggleComment(m)); }
            if (!shift && $.input.pressed('l')) { m.selectLine(); moved = true; }
            if ($.input.pressed('[')) edit(m.tab(true));
            if ($.input.pressed(']')) edit(m.tab(false));
            if ($.input.pressed('d')) { m.addNextOccurrence(); moved = true; }
            if (shift && $.input.pressed('l')) { m.selectAllOccurrences(); moved = true; }
            if (shift && $.input.pressed('k')) edit(m.deleteLine());
            if ($.input.pressed('f') && !alt && actions.find) actions.find();
            if (($.input.pressed('h') && !cmd) || ($.input.pressed('f') && alt)) { if (actions.replace) actions.replace(); }
            if ($.input.pressed('g') && actions.gotoLine) actions.gotoLine();
        }

        if (alt && mod) {
            // Cmd+Alt+↑/↓ — курсор строкой выше / ниже.
            lineMoveHandled = $.input.down('up') || $.input.down('down');
            if ($.input.pressed('up') || $.input.pressed('down')) {
                m.addCursorVertical($.input.pressed('up') ? -1 : 1);
                moved = true;
            }
        }
        if (alt && shift && !mod && $.input.pressed('f') && actions.format) actions.format();
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
            const closers = { ')': '(', ']': '[', '}': '{' };
            const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
            const isQuote = typed === '"' || typed === "'" || typed === '`';
            const code = v.lang !== 'text';
            const line = m.lines[m.caret.line], prev = line[m.caret.col - 1], next = line[m.caret.col];
            if (typed.length === 1 && code && pairs[typed] && m.selection()) {
                edit(m.wrapSelection(typed, pairs[typed]));
            } else if (typed.length === 1 && code && (closers[typed] || isQuote) && next === typed && !m.selection()) {
                // Закрывающий символ поверх уже стоящего — шаг вправо, а не дубль.
                m.move('right'); moved = true;
            } else if (typed.length === 1 && code && pairs[typed] &&
                       (!next || /[\s;:.,=}\])>]/.test(next)) && !(isQuote && prev && /[\w$]/.test(prev))) {
                edit(m.insert(typed + pairs[typed])); m.move('left');
            } else {
                if (typed.length === 1 && closers[typed]) m.outdentBeforeClose();
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
            case 'backspace': edit(cmd ? m.deleteToLineStart() : alt ? m.deleteWord(false) : m.backspace()); break;
            case 'delete': edit(alt ? m.deleteWord(true) : m.del()); break;
            case 'enter': edit(mod ? m.insertLine(shift) : m.newline()); break;
            case 'tab': edit(m.tab(shift)); break;
            default: break;
            }
        }
        if ($.input.pressed('home')) { m.move(mod ? 'docStart' : 'home', shift); moved = true; }
        if ($.input.pressed('end')) { m.move(mod ? 'docEnd' : 'end', shift); moved = true; }

        if (changed || moved || typed) refreshParamHint();
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
        const marks = v.lang === 'js' ? ['//'] : v.lang === 'css' ? ['/*', '*/'] : v.lang === 'markup' ? ['<!--', '-->'] : null;
        return marks ? m.toggleLineComment(marks[0], marks[1]) : false;
    }

    // Диагностика под позицией (строка и слово, на которое она указывает).
    function diagAt(p) {
        const line = v.model.lines[p.line];
        for (const d of v.diags) {
            if (d.line - 1 !== p.line) continue;
            const a = Math.max(0, (d.col || 1) - 1), b = Math.max(a + 1, wordEnd(line, a));
            if (p.col >= a && p.col <= b) return d;
        }
        return null;
    }

    // --- контекстное меню --------------------------------------------------------

    function menuItems() {
        const m = v.model, has = !!m.selection();
        const items = [
            { label: 'Вырезать', keys: 'Cmd+X', run: () => { $.input.setClipboard(has ? m.selectedText() : m.lines[m.caret.line] + '\n'); v.lineClip = has ? null : m.lines[m.caret.line] + '\n'; changedBy(has ? m.insert('') : m.deleteLine()); } },
            { label: 'Копировать', keys: 'Cmd+C', run: () => { $.input.setClipboard(has ? m.selectedText() : m.lines[m.caret.line] + '\n'); v.lineClip = has ? null : m.lines[m.caret.line] + '\n'; } },
            { label: 'Вставить', keys: 'Cmd+V', run: () => { const t = $.input.clipboard(); if (t) changedBy(m.paste(t)); } },
            { label: 'Выделить всё', keys: 'Cmd+A', run: () => m.selectAll() },
        ];
        const extra = (v.actions && v.actions.menu) || [];
        if (extra.length) items.push({ sep: true }, ...extra);
        return items;
    }

    function openMenu() {
        const p = posFromMouse();
        if (p && !v.model.selection()) v.model.setCaret(p);
        v.menu = { items: menuItems() };
        const r = doc.rect('code'), k = scale(), mouse = $.input.mouse();
        const rows = v.menu.items.length;
        const height = v.menu.items.reduce((n, it) => n + (it.sep ? 9 : 26), 8);
        const x = Math.max(4, Math.min(mouse.x * k - r.x, r.w - 254));
        const y = Math.max(4, Math.min(mouse.y * k - r.y, r.h - height - 4));
        doc.html('code-menu', v.menu.items.map((it, i) => it.sep ? '<div class="cm-sep"></div>'
            : '<div class="cm-item" data-key="menu:' + i + '"><span data-key="menu:' + i + '">' + escapeRml(it.label) + '</span><span class="cm-keys" data-key="menu:' + i + '">' + escapeRml(it.keys || '') + '</span></div>').join(''));
        doc.style('code-menu', 'left', Math.round(x) + 'px');
        doc.style('code-menu', 'top', Math.round(y) + 'px');
        doc.cls('code-menu', 'hidden', false);
        void rows;
        v.dirty = true;
    }

    function menuClick(index) {
        const item = v.menu && v.menu.items[index];
        closeMenu();
        if (!item || !item.run) return;
        item.run();
        v.blinkT = 0; v.dirty = true;
        ensureCaretVisible();
        if (v.onChange) v.onChange();
        if (v.onCaret) v.onCaret();
    }

    function changedBy(ok) { if (ok && v.onChange) v.onChange(); }

    // --- подсказка параметров -------------------------------------------------------

    function refreshParamHint() {
        if (!v.model || v.lang !== 'js') { v.paramHint = null; return; }
        const m = v.model, c = m.caret;
        const source = m.lines.join('\n');
        let offset = c.col;
        for (let i = 0; i < c.line; i++) offset += m.lines[i].length + 1;
        const next = paramHintFor(source, offset, v.apiSymbols);
        const same = JSON.stringify(next) === JSON.stringify(v.paramHint);
        v.paramHint = next;
        if (!same) { v.paramMarkup = null; v.dirty = true; }
    }

    function renderParamHint() {
        const h = v.paramHint;
        if (!h || !v.model) { doc.cls('param-hint', 'hidden', true); return; }
        const r = doc.rect('code'), cw = v.charW || measure() || 8;
        if (!r) return;
        const c = v.model.caret, row = visibleRowForLine(c.line);
        const y = Math.round((row - v.scrollTop) * LINE_H) + TOP;
        const x = 64 + Math.round(vcol(c.line, c.col) * cw - v.scrollLeft);
        const markup = h.parts.map((part, i) => i === h.active ? '<span class="ph-active">' + escapeRml(part) + '</span>' : escapeRml(part)).join(escapeRml(', ')) +
            (h.doc ? '<span class="ph-doc">' + escapeRml(h.doc) + '</span>' : '');
        if (v.paramMarkup !== markup) { v.paramMarkup = markup; doc.html('param-hint', '<span>' + escapeRml(h.name) + '(</span>' + markup + '<span>)' + escapeRml(h.ret ? ' → ' + h.ret : '') + '</span>'); }
        const top = y - 4 - (h.doc ? 46 : 28);
        doc.style('param-hint', 'left', Math.max(8, Math.min(x, r.w - 580)) + 'px');
        doc.style('param-hint', 'top', Math.max(TOP + 2, top < TOP ? y + LINE_H + 2 : top) + 'px');
        doc.cls('param-hint', 'hidden', false);
    }

    // --- кадр ------------------------------------------------------------------

    function update(dt, focused, actions) {
        if (!v.model) return;
        if (v.focused !== focused) { v.focused = focused; v.dirty = true; }
        const ime = focused ? $.input.ime() : { text: '' };
        const imeText = ime && typeof ime.text === 'string' ? ime.text : '';
        if (imeText !== v.imeText) { v.imeText = imeText; v.dirty = true; }
        v.actions = actions || {};
        if (focused) handleKeys(dt, v.actions);
        if (v.drag) {
            if ($.input.mouseDown('left')) { if (v.drag.kind === 'map') scrollFromMap(); else scrollFromBar(v.drag.grab); }
            else v.drag = null;
        }
        if ($.input.mousePressed('right') && mouseInside() && region() === 'text') openMenu();
        else if (v.menu && $.input.mousePressed('left') && !inside(doc.rect('code-menu'))) closeMenu();
        if (v.menu && $.input.pressed('escape')) closeMenu();
        if (v.dragging) {
            if ($.input.mouseDown('left')) {
                // Выделение мышью за краем области прокручивает документ, даже если мышь неподвижна.
                const r = textRect();
                if (r) {
                    const k = scale(), mouse = $.input.mouse();
                    const my = mouse.y * k - r.y, mx = mouse.x * k - r.x;
                    const dy = my < 0 ? my : my > r.h ? my - r.h : 0;
                    const dx = mx < 0 ? mx : mx > r.w ? mx - r.w : 0;
                    if (dy) v.scrollTop += Math.sign(dy) * Math.min(40, 3 + Math.abs(dy) / LINE_H * 6) * dt;
                    if (dx) v.scrollLeft += Math.sign(dx) * Math.min(1200, 120 + Math.abs(dx) * 6) * dt;
                    if (dy || dx) { clampScroll(); v.dirty = true; }
                }
                const p = posFromMouse();
                if (p) {
                    const c = v.model.caret;
                    if (p.line !== c.line || p.col !== c.col) {
                        v.model.setCaret(p, true);
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
        if (mouseInside() && !overHoverCard && region() === 'text' && !v.menu && !v.drag) {
            const p = posFromMouse();
            if (p && (!v.hoverPos || p.line !== v.hoverPos.line || p.col !== v.hoverPos.col)) {
                v.hoverPos = p;
                v.hoverDiag = diagAt(p);
                v.dirty = true;
                if (v.onHover) v.onHover(p);
            }
        } else if (v.hoverPos) {
            v.hoverPos = null;
            v.hoverDiag = null; v.dirty = true;
            if (v.onHover) v.onHover(null);
        }
        if (mouseInside() && !v.menu) {
            const w = $.input.wheel();
            if (w && (w.y || w.x)) {
                // Shift + колесо — горизонтальная прокрутка.
                if ($.input.shiftDown() && !w.x) v.scrollLeft -= w.y * 30;
                else v.scrollTop -= w.y * 3;
                if (w.x) v.scrollLeft -= w.x * 30;
                v.dirty = true;
            }
        }
        // Мигание каретки (только в фокусе).
        v.blinkT += dt;
        const on = !focused || (v.blinkT % 1.06) < 0.53;
        doc.cls('caret', 'blink', !on);
        doc.cls('carets-extra', 'blink', !on);
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
        selectLineAt,
        toggleComment() { if (!v.model) return false; const ok = toggleComment(v.model); changedBy(ok); return ok; },
        gotoLine(line) { if (!v.model) return; v.model.setCaret({ line, col: 0 }); ensureCaretVisible(); if (v.onCaret) v.onCaret(); },
        menuClick,
        setBase(text) { v.base = typeof text === 'string' ? splitLines(text) : null; v.diffVersion = -1; v.diff = null; v.dirty = true; },
        setFilePath(path) { v.filePath = path || ''; v.crumbKey = ''; v.dirty = true; },
        setOption(name, value) { if (name in v.opts) { v.opts[name] = !!value; v.dirty = true; } },
        getOption(name) { return !!v.opts[name]; },
        getViewState() {
            if (!v.model) return null;
            const c = v.model.caret, a = v.model.anchor;
            return { scrollTop: v.scrollTop, scrollLeft: v.scrollLeft, folds: [...v.collapsedFolds], caret: c, anchor: a };
        },
        restoreViewState(st) {
            if (!st || !v.model) return;
            v.pendingFolds = st.folds && st.folds.length ? st.folds.slice() : null;
            if (st.caret) {
                if (st.anchor) { v.model.setCaret(st.anchor); v.model.setCaret(st.caret, true); }
                else v.model.setCaret(st.caret);
            }
            v.scrollTop = st.scrollTop || 0; v.scrollLeft = st.scrollLeft || 0;
            v.visibleVersion = -1; v.dirty = true;
        },
        wordAtCaret() { return v.model ? v.model.wordAt(v.model.caret) : null; },
        chooseCompletion(index) { if (v.completion) { v.completion.selected = index; acceptCompletion(index); } },
        setHoverHelp(path, metadata) { v.hoverHelp = path && metadata ? { path, metadata } : null; v.dirty = true; },
        setFind(query, opts) {
            if (opts) v.findOpts = Object.assign({}, v.findOpts, opts);
            v.find.query = query;
            v.find.hits = v.model ? v.model.findAll(query, v.findOpts) : [];
            v.dirty = true;
            return v.find.hits.length;
        },
        findOptions() { return Object.assign({}, v.findOpts); },
        visibleLines,
        get model() { return v.model; },
        escape: escapeRml,
    };
}
