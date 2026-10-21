import { test, eq, finish } from './_harness.mjs';
import { ctx } from '../../src/highlevel/core.js';
import { installInput } from '../../src/highlevel/input.js';

const calls = [];
engine.ime = () => ({ text: 'にほん', start: 1 });
engine.textInputArea = (...args) => { calls.push(args); };
ctx.$ = {};
const input = installInput(ctx.$);

test('ime exposes the current composition without inserting it', () => {
    eq(JSON.stringify(input.ime()), JSON.stringify({ text: 'にほん', start: 1 }));
});

test('IME candidate area rounds coordinates and keeps a visible rectangle', () => {
    eq(input.textInputArea(12.4, 8.6, 0, 18.2, 2.7), input);
    eq(JSON.stringify(calls[0]), JSON.stringify([12, 9, 1, 18, 3]));
});

test('missing native IME hooks degrade to empty composition and no-op positioning', () => {
    const ime = engine.ime, area = engine.textInputArea;
    engine.ime = undefined; engine.textInputArea = undefined;
    eq(JSON.stringify(input.ime()), JSON.stringify({ text: '', start: 0 }));
    eq(input.textInputArea(0, 0, 1, 1, 0), input);
    engine.ime = ime; engine.textInputArea = area;
});

finish();
