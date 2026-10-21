// Regression coverage for the code editor's document model and JS assistance.
import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { createCodeModel } from '../../editor/lib/code_model.js';
import {
    apiCompletionContext, completeApiSymbols, javascriptDocumentSymbols, nodeApiCompletionContext,
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
    eq(m.text(), 'if (ok) {\n    \n}');
    eq(m.caret.line, 1);
    eq(m.caret.col, 4);
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

finish();
