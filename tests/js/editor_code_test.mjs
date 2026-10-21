// Regression coverage for the code editor's document model and JS assistance.
import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { lineDiff } from '../../editor/lib/line_diff.js';
import { createCodeModel } from '../../editor/lib/code_model.js';
import {
    apiCompletionContext, callContext, completeApiSymbols, localSymbolItems, paramHintFor, snippetItems, javascriptDocumentSymbols, nodeApiCompletionContext,
    nodeApiPathAt, publicApiSymbols,
} from '../../editor/lib/api_language.js';
import { bracketPairs, createApiHighlightContext, foldingRanges, highlightApiTokens, matchingBracket, tokenizeLine } from '../../editor/lib/highlight.js';

test('multiline edits, undo and redo preserve the document and caret', () => {
    const m = createCodeModel('const hero = $();');
    m.setCaret({ line: 0, col: 17 });
    truthy(m.insert('\nhero.spriteMesh(true);'));
    eq(m.lineCount(), 2);
    eq(m.lines[1], 'hero.spriteMesh(true);');
    truthy(m.undo());
    eq(m.text(), 'const hero = $();');
    truthy(m.redo());
    eq(m.lines[1], 'hero.spriteMesh(true);');
});

test('selection replacement is one undoable edit', () => {
    const m = createCodeModel('alpha beta');
    m.setCaret({ line: 0, col: 0 });
    m.setCaret({ line: 0, col: 5 }, true);
    eq(m.selectedText(), 'alpha');
    truthy(m.insert('hero'));
    eq(m.text(), 'hero beta');
    truthy(m.undo());
    eq(m.text(), 'alpha beta');
});

test('typing a pair wraps the selection and keeps its contents selected', () => {
    const m = createCodeModel('hero');
    m.setCaret({ line: 0, col: 0 });
    m.setCaret({ line: 0, col: 4 }, true);
    truthy(m.wrapSelection('(', ')'));
    eq(m.text(), '(hero)');
    eq(m.selectedText(), 'hero');
    truthy(m.undo());
    eq(m.text(), 'hero');
});

test('backspace removes an empty auto-paired delimiter and undo restores it', () => {
    const m = createCodeModel('()');
    m.setCaret({ line: 0, col: 1 });
    truthy(m.backspace());
    eq(m.text(), '');
    truthy(m.undo());
    eq(m.text(), '()');
});

test('Enter inside an auto-paired brace creates an indented block', () => {
    const m = createCodeModel('if (ok) {}');
    m.setCaret({ line: 0, col: 9 });
    truthy(m.newline());
    eq(m.text(), 'if (ok) {\n\t\n}');
    eq(m.caret.line, 1);
    eq(m.caret.col, 1);
});

test('word navigation treats Cyrillic identifiers as words', () => {
    const m = createCodeModel('привет мир');
    m.setCaret({ line: 0, col: 6 });
    m.move('wordRight');
    eq(m.caret.col, 10);
    m.move('wordLeft');
    eq(m.caret.col, 7);
});

test('duplicate, move and delete line commands are undoable', () => {
    const m = createCodeModel('one\ntwo\nthree');
    m.setCaret({ line: 1, col: 3 });
    truthy(m.moveLines(-1));
    eq(m.text(), 'two\none\nthree');
    eq(m.caret.line, 0);
    truthy(m.undo());
    eq(m.text(), 'one\ntwo\nthree');
    truthy(m.duplicateLines(1));
    eq(m.text(), 'one\ntwo\ntwo\nthree');
    truthy(m.deleteLine());
    eq(m.text(), 'one\ntwo\nthree');
});

test('search, replace-all and goto stay consistent', () => {
    const m = createCodeModel('hero.id = 1;\nhero.id = 2;');
    eq(m.findAll('hero').length, 2);
    eq(m.replaceAll('hero', 'avatar'), 2);
    eq(m.text(), 'avatar.id = 1;\navatar.id = 2;');
    m.goto(2, 99);
    eq(m.caret.line, 1);
    eq(m.caret.col, m.lines[1].length);
});

test('API completion recognizes direct $ namespace paths', () => {
    const context = apiCompletionContext('$.world.gra', 12);
    truthy(context);
    eq(context.base, '$.world');
    eq(context.member, 'gra');
});

test('node API completion follows wrapped variables and simple aliases', () => {
    const source = [
        "const hero = $('<sprite>', { id: 'hero' }).size(32, 32);",
        'const avatar = hero;',
        'avatar.spriteMesh(true);',
    ].join('\n');
    const context = nodeApiCompletionContext('avatar.spr', 10, source);
    truthy(context);
    eq(context.base, '$.fn');
    eq(context.member, 'spr');

    const path = nodeApiPathAt(source.split('\n'), { line: 2, col: 8 });
    eq(path, '$.fn.spriteMesh');
});

test('node methods come from the embedded documentation catalog', () => {
    const symbols = publicApiSymbols({ __r2dApiDocs: {
        '$.fn.spriteMesh': { kind: 'function', description: 'Управляет SpriteMesh.' },
        '$.fn.size': { kind: 'function', description: 'Задаёт размер.' },
        '$.fn._internal': { kind: 'function' },
    } });
    const items = completeApiSymbols(symbols, { base: '$.fn', member: 'sprite' }, 16);
    eq(items.length, 1);
    eq(items[0].name, 'spriteMesh');
    eq(items[0].metadata.description, 'Управляет SpriteMesh.');
    falsy(nodeApiCompletionContext('const text = "hero.";', 18, ''));
});

test('matching brackets ignore strings and comments and work across lines', () => {
    const pairs = bracketPairs([
        'const text = "{ ignored }"; // )',
        'if (ready) {',
        '  call([1, 2]);',
        '}',
    ], 'js');
    const other = matchingBracket(pairs, { line: 1, col: 12 });
    truthy(other);
    eq(other.line, 3);
    eq(other.col, 0);
    falsy(pairs.has('0:13'));
});

test('folding ranges include only multi-line code braces', () => {
    const lines = ['const text = "{";', 'if (ready) {', '  call();', '}'];
    const ranges = foldingRanges(lines, bracketPairs(lines, 'js'));
    eq(ranges.get(1), 3);
    falsy(ranges.has(0));
});

test('semantic API colors identify node creation, creation methods, and deletion methods', () => {
    const symbols = [
        { path: '$.world', metadata: { kind: 'namespace' } },
        { path: '$.world.add', metadata: { kind: 'function' } },
        { path: '$.fn.appendTo', metadata: { kind: 'function' } },
        { path: '$.fn.remove', metadata: { kind: 'function' } },
    ];
    const lines = ["const hero = $('<player>').appendTo($.world);", 'hero.remove();'];
    const context = createApiHighlightContext(symbols, lines);
    const colored = lines.map((line) => highlightApiTokens(tokenizeLine(line, 'js').tokens, line, context));
    eq(colored[0].find((token) => token.text === '<player>').cls, 'tk-api-create');
    eq(colored[0].find((token) => token.text === '$').cls, 'tk-api-root');
    eq(colored[0].find((token) => token.text === 'world').cls, 'tk-api-namespace');
    eq(colored[0].find((token) => token.text === 'appendTo').cls, 'tk-api-create');
    eq(colored[1].find((token) => token.text === 'remove').cls, 'tk-api-delete');
});

test('document symbol outline lists simple declarations and ignores comments and strings', () => {
    const symbols = javascriptDocumentSymbols([
        '// function fake() {}',
        'const label = "class hidden {}";',
        'function start() {',
        '  const hero = $("player");',
        '}',
        'class WorldState {}',
    ]);
    eq(symbols.map((item) => item.name).join(','), 'label,start,hero,WorldState');
    eq(symbols[2].line, 3);
    eq(symbols[0].kind, 'const');
});

test('dirty flag returns to clean when undo reaches the saved state', () => {
    const m = createCodeModel('a');
    m.setCaret({ line: 0, col: 1 });
    m.insert('b');
    m.markSaved();
    falsy(m.dirty);
    m.insert('c');
    truthy(m.dirty);
    m.undo();
    falsy(m.dirty);
    m.undo();
    truthy(m.dirty);
    m.redo();
    falsy(m.dirty);
});

test('typing right after save does not merge into the saved undo step', () => {
    const m = createCodeModel('');
    m.insert('x');
    m.markSaved();
    m.insert('y');
    truthy(m.dirty);
    m.undo();
    eq(m.text(), 'x');
    falsy(m.dirty);
});

test('a run of Backspace is a single undo step', () => {
    const m = createCodeModel('hello');
    m.setCaret({ line: 0, col: 5 });
    m.backspace(); m.backspace(); m.backspace();
    eq(m.text(), 'he');
    truthy(m.undo());
    eq(m.text(), 'hello');
    eq(m.caret.col, 5);
    falsy(m.canUndo());
});

test('Tab aligns to the next tab stop and Shift+Tab keeps the selection', () => {
    const m = createCodeModel('ab');
    m.setCaret({ line: 0, col: 2 });
    m.tab(false);
    eq(m.text(), 'ab\t');
    const b = createCodeModel('one\n\ttwo\nthree');
    b.setCaret({ line: 1, col: 4 });
    b.tab(true);
    eq(b.text(), 'one\ntwo\nthree');
    eq(b.caret.col, 3);
    falsy(b.selection());
    const c = createCodeModel('a\nb');
    c.setCaret({ line: 0, col: 1 });
    c.setCaret({ line: 1, col: 1 }, true);
    c.tab(false);
    eq(c.text(), '\ta\n\tb');
    eq(c.selection().from.col, 2);
    eq(c.selection().to.col, 2);
});

test('copy line down moves the caret to the copy, copy up keeps it on top', () => {
    const m = createCodeModel('a\nb');
    m.setCaret({ line: 0, col: 1 });
    m.duplicateLines(1);
    eq(m.text(), 'a\na\nb');
    eq(m.caret.line, 1);
    const u = createCodeModel('a\nb');
    u.setCaret({ line: 1, col: 1 });
    u.duplicateLines(-1);
    eq(u.text(), 'a\nb\nb');
    eq(u.caret.line, 1);
});

test('line comment toggling keeps the selection and indents at the block minimum', () => {
    const m = createCodeModel('  a\n    b\n\n  c');
    m.setCaret({ line: 0, col: 0 });
    m.setCaret({ line: 3, col: 3 }, true);
    truthy(m.toggleLineComment('//'));
    eq(m.text(), '  // a\n  //   b\n\n  // c');
    truthy(m.selection());
    truthy(m.toggleLineComment('//'));
    eq(m.text(), '  a\n    b\n\n  c');
    const css = createCodeModel('a {}');
    css.toggleLineComment('/*', '*/');
    eq(css.text(), '/* a {} */');
    css.toggleLineComment('/*', '*/');
    eq(css.text(), 'a {}');
});

test('search options: whole word, regex with groups, replace-next', () => {
    const m = createCodeModel('hero heroes Hero\nhero');
    eq(m.findAll('hero', { wholeWord: true }).length, 3);
    eq(m.findAll('hero', { wholeWord: true, caseSensitive: true }).length, 2);
    eq(m.findAll('(', { regex: true }).length, 0);
    truthy(m.findError);
    const r = createCodeModel('a1 b22');
    eq(r.replaceAll('([a-z])(\\d+)', '$2$1', { regex: true }), 2);
    eq(r.text(), '1a 22b');
    const n = createCodeModel('x x x');
    n.findNext('x');
    n.replaceNext('x', 'y');
    eq(n.text(), 'y x x');
    eq(n.selectedText(), 'x');
});

test('line commands: select line, insert line, delete word', () => {
    const m = createCodeModel('  one two\nz');
    m.setCaret({ line: 0, col: 4 });
    m.selectLine();
    eq(m.selectedText(), '  one two\n');
    m.setCaret({ line: 0, col: 4 });
    m.insertLine(false);
    eq(m.text(), '  one two\n  \nz');
    eq(m.caret.line, 1);
    m.setCaret({ line: 0, col: 9 });
    m.deleteWord(false);
    eq(m.lines[0], '  one ');
    m.outdentBeforeClose();
    eq(m.lines[0], '  one ');
});

test('Up on the first line goes to column 0, Down on the last goes to the end', () => {
    const m = createCodeModel('abc\ndef');
    m.setCaret({ line: 0, col: 2 });
    m.move('up');
    eq(m.caret.col, 0);
    m.move('down'); m.move('down');
    eq(m.caret.line, 1);
    eq(m.caret.col, 3);
});

test('indentation is tabs only: Tab, Enter and Shift+Tab use \\t', () => {
    const m = createCodeModel('if (a) {\n\tb();\n}');
    eq(m.indentUnit, '\t');
    m.setCaret({ line: 0, col: 8 });
    m.newline();
    eq(m.lines[1], '\t');
    m.undo();
    m.setCaret({ line: 2, col: 0 });
    m.tab(false);
    eq(m.lines[2], '\t}');
    m.tab(true);
    eq(m.lines[2], '}');
    m.setCaret({ line: 1, col: 1 });
    m.backspace();
    eq(m.lines[1], 'b();');
});

test('normalizeIndent turns four-space indents into tabs, undoable and caret-safe', () => {
    const m = createCodeModel('a {\n    b;\n        c;\n      d;\n  e;\n}');
    m.setCaret({ line: 2, col: 9 });
    truthy(m.normalizeIndent());
    eq(m.text(), 'a {\n\tb;\n\t\tc;\n\t  d;\n  e;\n}');
    eq(m.caret.col, 3);
    falsy(m.normalizeIndent());
    truthy(m.undo());
    eq(m.lines[1], '    b;');
});

test('multi-cursor typing, backspace and undo act as one step', () => {
    const m = createCodeModel('a\nb\nc');
    m.setCaret({ line: 0, col: 1 });
    truthy(m.addCursorVertical(1));
    truthy(m.addCursorVertical(1));
    eq(m.cursors.length, 3);
    m.insert('x');
    eq(m.text(), 'ax\nbx\ncx');
    eq(m.cursors.length, 3);
    m.backspace();
    eq(m.text(), 'a\nb\nc');
    m.insert('yy');
    eq(m.text(), 'ayy\nbyy\ncyy');
    truthy(m.undo());
    eq(m.text(), 'a\nb\nc');
    falsy(m.hasMultiCursor);
    truthy(m.redo());
    eq(m.text(), 'ayy\nbyy\ncyy');
});

test('Cmd+D adds occurrences as cursors and select-all-occurrences matches whole words', () => {
    const m = createCodeModel('hero = hero + heroes;\nhero');
    m.setCaret({ line: 0, col: 1 });
    m.addNextOccurrence();
    eq(m.selectedText(), 'hero');
    m.addNextOccurrence();
    m.addNextOccurrence();
    eq(m.cursors.length, 3);
    m.insert('x');
    eq(m.text(), 'x = x + heroes;\nx'.replace('x + heroes', 'x + heroes'));
    const w = createCodeModel('a b a heroes a');
    w.setCaret({ line: 0, col: 0 });
    truthy(w.selectAllOccurrences());
    eq(w.cursors.length, 3);
});

test('multi-cursor Enter and vertical movement keep cursors on their lines', () => {
    const m = createCodeModel('ab\ncd');
    m.setCaret({ line: 0, col: 1 });
    m.addCursor({ line: 1, col: 1 });
    m.newline();
    eq(m.text(), 'a\nb\nc\nd');
    m.move('left');
    eq(m.cursors.length, 2);
});

test('save cleanup trims trailing whitespace, ends with a newline and converts indents', () => {
    const m = createCodeModel('a {  \n    b;   \n}');
    truthy(m.normalizeForSave());
    eq(m.text(), 'a {\n\tb;\n}\n');
    falsy(m.normalizeForSave());
});

test('format re-indents by bracket depth, switch cases and leaves templates alone', () => {
    const m = createCodeModel('function f(a) {\nif (a) {\nswitch (a) {\ncase 1:\nreturn [\n1,\n2\n];\n}\n}\n}');
    truthy(m.format('js'));
    eq(m.text(), 'function f(a) {\n\tif (a) {\n\t\tswitch (a) {\n\t\t\tcase 1:\n\t\t\t\treturn [\n\t\t\t\t\t1,\n\t\t\t\t\t2\n\t\t\t\t];\n\t\t}\n\t}\n}');
    const t = createCodeModel('const s = `a\n   b`;\n  x();');
    t.format('js');
    eq(t.text(), 'const s = `a\n   b`;\nx();');
});

test('paste re-bases multi-line text onto the caret indentation', () => {
    const m = createCodeModel('if (a) {\n\t\n}');
    m.setCaret({ line: 1, col: 1 });
    m.paste('if (b) {\n    c();\n}');
    eq(m.text(), 'if (a) {\n\tif (b) {\n\t\tc();\n\t}\n}');
});

test('line diff marks added, modified and deleted lines', () => {
    const d = lineDiff(['a', 'b', 'c', 'd'], ['a', 'B', 'c', 'x', 'y']);
    eq(d.marks.get(1), 'mod');
    eq(d.marks.get(3), 'mod');
    eq(d.marks.get(4), 'add');
    const del = lineDiff(['a', 'b', 'c'], ['a', 'c']);
    truthy(del.deleted.has(1));
    eq(lineDiff(['a'], ['a']).marks.size, 0);
});

test('call context finds the nearest open call and argument index, ignoring strings and nested literals', () => {
    const c = callContext('const a = move(hero, "x,y", {k: [1, 2]}, ');
    eq(c.callee, 'move');
    eq(c.argIndex, 3);
    falsy(callContext('if (a, '));
    falsy(callContext('move(hero)'));
    eq(callContext('$.world.add(').callee, '$.world.add');
});

test('parameter hints use local functions, documented $ API and JS built-ins', () => {
    const src = 'function speedOf(hero, factor = 2) {}\nspeedOf(a, ';
    const local = paramHintFor(src, src.length, []);
    eq(local.name, 'speedOf');
    eq(local.parts.join('|'), 'hero|factor = 2');
    eq(local.active, 1);
    const api = [{ path: '$.world.add', metadata: { kind: 'function', args: [{ name: 'node', type: 'Node' }], returns: 'Node', description: 'Добавляет.' } }];
    const hint = paramHintFor('$.world.add(', 12, api);
    eq(hint.parts[0], 'node: Node');
    eq(hint.ret, 'Node');
    const builtin = paramHintFor('Math.max(1, ', 12, []);
    truthy(builtin);
    eq(builtin.name, 'max');
    falsy(paramHintFor('unknownCall(', 12, []));
});

test('completion extras: file declarations and snippets', () => {
    const items = localSymbolItems(['function startGame() {}', 'const starter = 1;'], 'star');
    eq(items.map((i) => i.name).sort().join(','), 'startGame,starter');
    eq(snippetItems('for').map((i) => i.name).join(','), 'for,forof');
    eq(snippetItems('f').length, 0);
});

finish();
