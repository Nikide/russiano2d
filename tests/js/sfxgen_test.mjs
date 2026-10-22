// Юнит-тесты $.sfxgen без движка: разбор описаний, проверка полей, кэш по содержимому, play/bank.
import { test, eq, truthy, falsy, finish } from './_harness.mjs';
import { FIELDS, hashText, canonical, checkOverrides, createSfxgen } from '../../src/highlevel/sfxgen.js';

const base = () => Object.assign({ wave: 'square', seed: 1 }, Object.fromEntries(FIELDS.map((f) => [f, 0.25])));

function fakeNative(log) {
    return {
        presets: () => ['coin', 'jump'],
        defaults: base,
        preset: (name, seed) => (['coin', 'jump'].includes(name) ? Object.assign(base(), { seed, freq: name === 'coin' ? 0.7 : 0.4 }) : null),
        text: (words, seed) => (/монет/.test(words) ? { preset: 'coin', params: Object.assign(base(), { seed, freq: 0.7 }) } : null),
        mutate: (p, seed, amount) => Object.assign({}, p, { freq: p.freq + amount }),
        render: (p, path) => { log.push(['render', path, p.freq]); return { samples: 100, seconds: 0.01, peak: 0.5, rms: 0.2, clipped: 0, pitchHz: 440, path }; },
    };
}

function make() {
    const log = [], files = new Set();
    const api = {
        fs: { exists: (p) => files.has(p) },
        sound: { play: (p, o) => { log.push(['play', p, o]); return 3; } },
        sfx: { bank: (name, list) => { log.push(['bank', name, list]); return name; } },
    };
    const native = fakeNative(log);
    const render = native.render;
    native.render = (p, path) => { const r = render(p, path); if (path) files.add(path); return r; };
    return { sfx: createSfxgen(api, () => native), log, files };
}

test('hashText и canonical: стабильны и зависят от содержимого', () => {
    eq(hashText('abc'), hashText('abc'));
    truthy(hashText('abc') !== hashText('abd'));
    eq(hashText('').length, 8);
    eq(canonical(base()), canonical(base()));
    truthy(canonical(base()) !== canonical(Object.assign(base(), { freq: 0.9 })));
    eq(canonical(Object.assign(base(), { extra: 5 })), canonical(base()), 'лишние ключи не влияют на хеш');
});

test('checkOverrides: неизвестное поле и не число — ошибка с кодом', () => {
    eq(JSON.stringify(checkOverrides({ freq: 0.5, wave: 'sine', seed: 4 }, 'x')), '{"freq":0.5,"wave":"sine","seed":4}');
    let e1, e2, e3;
    try { checkOverrides({ frequency: 1 }, 'x'); } catch (e) { e1 = e; }
    try { checkOverrides({ freq: '1' }, 'x'); } catch (e) { e2 = e; }
    try { checkOverrides({ wave: 'triangle' }, 'x'); } catch (e) { e3 = e; }
    eq(e1.code, 'R2D_SFXGEN_BAD_FIELD'); truthy(e1.message.includes('frequency'));
    eq(e2.code, 'R2D_SFXGEN_BAD_FIELD');
    eq(e3.code, 'R2D_SFXGEN_BAD_FIELD');
});

test('resolve: пресет, слова, объект с переопределениями', () => {
    const { sfx } = make();
    eq(sfx.resolve('coin', 5).freq, 0.7);
    eq(sfx.resolve('Звук монеты', 2).seed, 2);
    const o = sfx.resolve({ preset: 'jump', seed: 9, decay: 0.1 });
    eq(o.freq, 0.4); eq(o.seed, 9); eq(o.decay, 0.1);
    eq(sfx.resolve({ freq: 0.9 }).freq, 0.9, 'без preset — от значений по умолчанию');
    let err;
    try { sfx.resolve('неведомое'); } catch (e) { err = e; }
    eq(err.code, 'R2D_SFXGEN_UNKNOWN'); truthy(err.message.includes('coin'));
    try { sfx.resolve({ preset: 'nope' }); err = null; } catch (e) { err = e; }
    eq(err.code, 'R2D_SFXGEN_UNKNOWN');
    try { sfx.resolve(42); err = null; } catch (e) { err = e; }
    eq(err.code, 'R2D_SFXGEN_UNKNOWN');
});

test('make: файл по хешу дескриптора, повторный вызов берёт кэш', () => {
    const { sfx, log } = make();
    const a = sfx.make('coin'), b = sfx.make('coin'), c = sfx.make('jump');
    eq(a, b); truthy(a !== c);
    truthy(/^sfxgen_cache\/sfx_[0-9a-f]{8}\.wav$/.test(a));
    eq(log.filter((l) => l[0] === 'render').length, 2, 'coin отрендерен один раз');
    sfx.cacheDir('cache/x/');
    truthy(sfx.make('coin').startsWith('cache/x/sfx_'));
});

test('play и bank: идут через $.sound.play и $.sfx.bank', () => {
    const { sfx, log } = make();
    eq(sfx.play('coin', { volume: 0.5 }), 3);
    const played = log.find((l) => l[0] === 'play');
    eq(played[2].volume, 0.5);
    eq(sfx.bank('step', ['coin', { preset: 'jump', seed: 2 }]), 'step');
    const bank = log.find((l) => l[0] === 'bank');
    eq(bank[2].length, 2);
    let err;
    try { sfx.bank('x', []); } catch (e) { err = e; }
    eq(err.code, 'R2D_SFXGEN_UNKNOWN');
});

test('без движка (engine.sfxgen нет) — понятная ошибка', () => {
    const sfx = createSfxgen({}, () => null);
    let err;
    try { sfx.presets(); } catch (e) { err = e; }
    eq(err.code, 'R2D_SFXGEN_UNAVAILABLE');
});

finish();
