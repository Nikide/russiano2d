import { test, eq, truthy, finish } from './_harness.mjs';
import * as M from '../../sdk/lib/vn_model.js';
import { createHistory } from '../../sdk/lib/history.js';

const source = '# canon\r\n\r\n:start\r\n  w (smirk): Привет!\r\n- Да {trust += 1} -> yes\r\ncustom data\r\n:yes\r\nend';
test('source round trip preserves CRLF, comments, unknown rows and missing EOF newline', () => {
    eq(M.lines(source).map((r) => r.text + r.eol).join(''), source);
    eq(JSON.stringify(M.commands(source).map((c) => c.kind)), JSON.stringify(['label', 'say', 'choice', 'raw', 'label', 'end']));
    eq(M.commands(source)[1].line, 4);
});
test('no-op Apply retains authored whitespace byte for byte', () => {
    const c = M.parseLine('  w   (smirk):  Hello  ');
    eq(M.patchLine(c, { kind: c.kind, speaker: c.speaker, expr: c.expr, text: c.text }), c.raw);
});
test('say inspector keeps speaker and expression, choice keeps flag commits', () => {
    eq(M.patchLine(M.parseLine(' w (smirk): old'), { text: 'new', speaker: 'n' }), ' n (smirk): new');
    eq(M.patchLine(M.parseLine('- Old {trust += 1, seen = 1} -> yes'), { text: 'New', goto: 'next' }), '- New {trust += 1, seen = 1} -> next');
});
test('asset edit preserves image timing and raw override wins', () => {
    const c = M.parseLine('image art/old.png 0.75');
    eq(M.patchLine(c, { asset: 'art/new.png' }), 'image art/new.png 0.75');
    eq(M.patchLine(c, { raw: 'fade out 1', text: 'ignored' }), 'fade out 1');
});
test('all runtime command families remain editable as source rows', () => {
    for (const s of ['@free', '@theme custom', '~ text', ':x', 'bubble w: text', 'set a = 1', 'if a -> end', 'goto end', 'wait 1', 'end', 'camera w 1', 'move w +2', 'face w left', 'anim w idle', 'ai w on', 'image off', 'fade in 1', 'sound a.wav', 'objective x', 'music x.ogg']) {
        const c = M.commands(s)[0];
        truthy(c && c.raw === s, s);
        eq(M.patchLine(c, {}), s);
    }
});
test('insert and delete preserve neighboring bytes and trailing newline policy', () => {
    const text = 'a\r\nb';
    eq(M.editSource(text, 'insert', 1, 'new'), 'a\r\nnew\r\nb');
    eq(M.editSource(text, 'insert', 2, 'new'), 'a\r\nb\r\nnew');
    eq(M.editSource('a\nb\n', 'insert', 2, 'c'), 'a\nb\nc\n');
    eq(M.editSource(source, 'delete', 5), source.replace('custom data\r\n', ''));
});
test('move retains EOF newline and history restores saved-state dirty', () => {
    const model = { source };
    const h = createHistory(model);
    h.run('move', () => { model.source = M.editSource(model.source, 'move', 3, 5); });
    truthy(h.dirty());
    truthy(!model.source.endsWith('\n'));
    h.undo(); eq(model.source, source); eq(h.dirty(), false);
    h.redo(); truthy(h.dirty());
});
finish();
