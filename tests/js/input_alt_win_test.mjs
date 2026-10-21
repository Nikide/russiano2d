// altDown() на платформах, где SDL называет клавишу «Alt» (Windows/Linux).
// Отдельный файл: scancodeOf кэширует имена на время жизни модуля.
import { test, eq, finish } from './_harness.mjs';
import { altDown } from '../../src/highlevel/input.js';

const held = new Set();
engine.scancode = (name) => ({ 'Left Alt': 342, 'Right Alt': 346 })[name] || 0;
engine.keyDown = (code) => held.has(code);

test('Alt keeps working where the key is called Alt', () => {
    eq(altDown(), false);
    held.add(346);
    eq(altDown(), true);
});

finish();
