// ===========================================================================
// Юнит-тесты акустики помещений ($.audio.zone / room).
//
// Проверяем модель, а не вызовы движка: именно от неё зависит, что выстрел в
// комнате 5×5 и в зале 20×20 звучит по-разному. Сам DSP реверберации
// проверяется C-тестом tests/audio/reverb_test.c.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/acoustics_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import {
    PX_PER_METER, MATERIALS, roomVolume, rt60, reverbForZone, zoneAt,
    installAcoustics, obstacleMuffle, acousticsState,
} from '../../src/highlevel/acoustics.js';
import { ctx } from '../../src/highlevel/core.js';

const m = (meters) => meters * PX_PER_METER;      // метры → пиксели

test('масштаб мира — 32 пикселя на метр, как у физики', () => {
    eq(PX_PER_METER, 32);
});

test('объём и площадь комнаты 5×5 при потолке 3 м', () => {
    const r = roomVolume(m(5), m(5), 3);
    eq(r.volume, 75);
    eq(r.surface, 110);      // 2·25 + 2·(5+5)·3
});

test('потолок по умолчанию — 3 м, нули не ломают объём', () => {
    eq(roomVolume(m(4), m(4), 0).volume, roomVolume(m(4), m(4), 3).volume);
});

test('RT60 растёт с размером комнаты', () => {
    const small = roomVolume(m(5), m(5), 3);
    const big = roomVolume(m(20), m(20), 3);
    const t_small = rt60(small.volume, small.surface, MATERIALS.concrete.absorption);
    const t_big = rt60(big.volume, big.surface, MATERIALS.concrete.absorption);
    truthy(t_small > 0.3 && t_small < 2.0, `маленькая комната: ${t_small.toFixed(2)} с`);
    truthy(t_big > t_small * 1.4, `зал: ${t_big.toFixed(2)} с против ${t_small.toFixed(2)} с`);
});

test('мягкие материалы глушат хвост', () => {
    const r = roomVolume(m(5), m(5), 3);
    const carpet = rt60(r.volume, r.surface, MATERIALS.carpet.absorption);
    const concrete = rt60(r.volume, r.surface, MATERIALS.concrete.absorption);
    truthy(carpet < concrete / 2, 'ковёр короче бетона минимум вдвое');
    truthy(MATERIALS.carpet.damp > MATERIALS.concrete.damp, 'ковёр глуше по верхам');
});

test('reverbForZone: зал получает и больший размер, и больше хвоста', () => {
    const small = reverbForZone({ rect: [0, 0, m(5), m(5)], height: 3, material: 'concrete' });
    const big = reverbForZone({ rect: [0, 0, m(20), m(20)], height: 3, material: 'concrete' });

    truthy(big.room > small.room + 0.15, `room: ${small.room.toFixed(2)} → ${big.room.toFixed(2)}`);
    truthy(big.wet > small.wet + 0.1, `wet: ${small.wet.toFixed(2)} → ${big.wet.toFixed(2)}`);
    truthy(small.wet >= 0.1 && big.wet <= 0.8, 'доли хвоста остаются в разумных границах');
});

test('reverbForZone: плитка звонче ковра', () => {
    const tile = reverbForZone({ rect: [0, 0, m(6), m(6)], height: 3, material: 'tile' });
    const carpet = reverbForZone({ rect: [0, 0, m(6), m(6)], height: 3, material: 'carpet' });
    truthy(tile.room > carpet.room, 'у плитки хвост длиннее');
    truthy(tile.damp < carpet.damp, 'у плитки верх не задемпфирован');
});

test('reverbForZone: wet можно задать явно', () => {
    const z = reverbForZone({ rect: [0, 0, m(5), m(5)], height: 3, material: 'concrete', wet: 0.42 });
    eq(z.wet, 0.42);
});

test('неизвестный материал не роняет расчёт', () => {
    const z = reverbForZone({ rect: [0, 0, m(5), m(5)], height: 3, material: 'нет-такого' });
    truthy(z && z.material === 'нет-такого', 'материал сохраняется как есть');
    truthy(z.room > 0, 'параметры посчитаны по умолчанию');
});

test('zoneAt: точка внутри зоны и снаружи', () => {
    const zones = new Map([
        ['hall', { rect: [0, 0, 640, 640] }],
        ['closet', { rect: [700, 0, 160, 160] }],
    ]);
    eq(zoneAt(zones, 10, 10).name, 'hall');
    eq(zoneAt(zones, 750, 50).name, 'closet');
    falsy(zoneAt(zones, 900, 900), 'мимо обеих — null');
});

test('zoneAt: поздняя зона перекрывает раннюю', () => {
    const zones = new Map([
        ['hall', { rect: [0, 0, 640, 640] }],
        ['vault', { rect: [0, 0, 100, 100] }],
    ]);
    eq(zoneAt(zones, 50, 50).name, 'vault');
});

test('границы зоны входят в зону', () => {
    const zones = new Map([['z', { rect: [100, 100, 50, 50] }]]);
    truthy(zoneAt(zones, 100, 100), 'левый верхний угол');
    truthy(zoneAt(zones, 150, 150), 'правый нижний угол');
});

// ---------------------------------------------------------------------------
// Глушение в чаще: деревья на пути звука против открытого поля
// ---------------------------------------------------------------------------

/**
 * Модуль вешает API на ctx.audio (общий контекст), поэтому готовим его и
 * вызываем installAcoustics: так тест проверяет те же методы, что игра.
 */
function audioStub() {
    ctx.audio = {};
    installAcoustics({ log: () => {} });
    return ctx.audio;
}

test('без препятствий звук не глушится', () => {
    const audio = audioStub();
    acousticsState.obstacles = [];
    eq(obstacleMuffle({ x: 0, y: 0 }, { x: 400, y: 0 }), 0);
});

test('чаща глушит: каждое дерево на пути добавляет глухости', () => {
    const audio = audioStub();
    audio.obstacles([]);
    audio.damping({ radius: 24, strength: 0.25, max: 0.9 });

    const listener = { x: 0, y: 0 };
    const source = { x: 400, y: 0 };
    eq(obstacleMuffle(listener, source), 0, 'пустой лес — чистый звук');

    audio.obstacles([{ x: 100, y: 0 }]);
    const one = obstacleMuffle(listener, source);
    near(one, 0.25, 1e-6, 'одно дерево на линии');

    audio.obstacles([{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }]);
    const three = obstacleMuffle(listener, source);
    near(three, 0.75, 1e-6, 'три дерева на линии');
    truthy(three > one, 'в чаще глуше, чем на поляне');
});

test('препятствие в стороне от луча не глушит', () => {
    const audio = audioStub();
    audio.obstacles([]);
    audio.damping({ radius: 24 });
    audio.obstacles([{ x: 200, y: 300 }]);
    eq(obstacleMuffle({ x: 0, y: 0 }, { x: 400, y: 0 }), 0, 'дерево в стороне не считается');
});

test('глухость не превышает заданный предел', () => {
    const audio = audioStub();
    audio.damping({ strength: 0.4, max: 0.5 });
    audio.obstacles([{ x: 40, y: 0 }, { x: 80, y: 0 }, { x: 120, y: 0 }, { x: 160, y: 0 }]);
    near(obstacleMuffle({ x: 0, y: 0 }, { x: 200, y: 0 }), 0.5, 1e-6);
});

test('densityAt считает деревья вокруг точки', () => {
    const audio = audioStub();
    audio.obstacles([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 400, y: 0 }]);
    eq(audio.densityAt(0, 0, 60), 2);
    eq(audio.densityAt(400, 0, 60), 1);
});

finish();
