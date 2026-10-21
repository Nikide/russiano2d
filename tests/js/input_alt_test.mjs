// altDown(): на macOS SDL называет Alt «Option», на остальных — «Alt».
import { test, eq, finish } from './_harness.mjs';
import { altDown, scancodeOf } from '../../src/highlevel/input.js';

const held = new Set();
function platform(names) {
    engine.scancode = (name) => names[name] || 0;
    engine.keyDown = (code) => held.has(code);
    held.clear();
}

test('Alt resolves through the Option name on macOS', () => {
    platform({ 'Left Option': 226, 'Right Option': 230 });
    eq(scancodeOf('lalt'), 226);
    eq(altDown(), false);
    held.add(226);
    eq(altDown(), true);
});

test('right Option counts as Alt too', () => {
    platform({ 'Left Option': 226, 'Right Option': 230 });
    held.add(230);
    eq(altDown(), true);
});

finish();
