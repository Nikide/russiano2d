// ===========================================================================
// Юнит-тесты анимационного плеера ($.anim.player) без движка.
//
// Проверяем ровно то, что легко сломать: выборку ключей между ними и на
// границах, плавности, режимы once/loop/pingpong, события «ровно один раз»,
// перемотку, скорость, паузу, микширование двух клипов, произвольные
// value-дорожки и то, что модуль дополняет $.anim, а не заменяет её.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/animplayer_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { Node, wrapOne, ctx } from '../../src/highlevel/core.js';
import { installAnim } from '../../src/highlevel/anim.js';
import {
    installAnimPlayer, tickAnimPlayer, advancePlayer,
    normalizeTimeline, normalizeTimelineTrack, normalizeTimelineKeys,
    trackType, canonicalKeyValue, sampleKeysAt, playheadState, spriteFrameAt,
    timelineValuesAt, eventsBetweenTimes, blendValues, writeTrackValue,
    unpackRgba, packRgba, lerpValue, cloneValue, resolveTarget, playerEase,
} from '../../src/highlevel/animplayer.js';

// $.anim ставится как в движке (сначала anim.js), затем дополняется плеером:
// так тест ловит и случайную подмену существующих методов.
const $ = {};
installAnim($);
installAnimPlayer($);
const A = $.anim;

// Node.emit() в ядре рассылает ещё и глобальные подписки через ctx.$;
// в реальном движке $ уже создан, в юнит-тесте подставляем заглушку.
ctx.$ = { _dispatchGlobal: () => {} };

let uid = 0;
/** Свежий узел со своим id — тесты не мешают друг другу. */
function makeNode(tag, x, y) {
    uid++;
    const node = new Node(tag || 'rect', { id: 'n' + uid });
    node.x = x === undefined ? 0 : x;
    node.y = y === undefined ? 0 : y;
    return node;
}

/** Свой плеер под тест: чужие часы и подписки не влияют. */
let player_uid = 0;
function makePlayer(node) {
    player_uid++;
    const player = A.player('t' + player_uid);
    if (node) player.target(node);
    return player;
}

// --- Чистые функции: объявление клипа ---------------------------------------

test('normalizeTimeline разбирает объявление и сортирует события по времени', () => {
    const clip = normalizeTimeline('probe', {
        duration: 1000,
        loop: 'loop',
        speed: 2,
        tracks: [
            { type: 'alpha', keys: [{ t: 1000, v: 0 }, { t: 0, v: 1 }] },
            { type: 'value', name: 'stamina', keys: [{ t: 0, v: 10 }, { t: 1000, v: 20 }] },
        ],
        events: [{ at: 900, name: 'late' }, { at: 100, name: 'early' }],
    });
    eq(clip.name, 'probe');
    eq(clip.duration, 1000);
    eq(clip.loop, 'loop');
    eq(clip.speed, 2);
    eq(clip.tracks.length, 2);
    eq(clip.events[0].name, 'early');
    eq(clip.events[1].name, 'late');
    // Ключи отсортированы по времени, а не по порядку в объявлении.
    eq(clip.tracks[0].keys[0].t, 0);
    near(clip.tracks[0].keys[0].v, 1);
    eq(clip.tracks[0].key, 'alpha');
    eq(clip.tracks[1].key, 'stamina');
});

test('normalizeTimeline отвергает клип без duration и с неверным loop', () => {
    let threw = 0;
    try { normalizeTimeline('bad', { tracks: [] }); } catch (e) { threw++; truthy(/duration/.test(e.message)); }
    try { normalizeTimeline('bad', { duration: 100, loop: 'backwards' }); } catch (e) { threw++; truthy(/loop/.test(e.message)); }
    eq(threw, 2);
});

test('normalizeTimelineKeys: t в миллисекундах, зажим границ, канонизация значений', () => {
    const keys = normalizeTimelineKeys(
        [{ t: 50, v: 5 }, { t: -20, v: 1 }, { t: 99999, v: 9 }], 1000, 'alpha', {},
    );
    eq(keys.length, 3);
    eq(keys[0].t, 0);
    eq(keys[1].t, 50);
    eq(keys[2].t, 1000);

    const pos = normalizeTimelineKeys([{ t: 0, v: { x: 1, y: 2 } }], 1000, 'position', {});
    near(pos[0].v.x, 1);
    near(pos[0].v.y, 2);
    const scale = normalizeTimelineKeys([{ t: 0, v: 3 }], 1000, 'scale', {});
    near(scale[0].v.x, 3);
    near(scale[0].v.y, 3);
    const color = normalizeTimelineKeys([{ t: 0, v: '#ff0000' }], 1000, 'color', {});
    eq(color[0].v.length, 4);
    eq(color[0].v[0], 255);
    eq(color[0].v[1], 0);
    eq(color[0].v[3], 255);
});

test('trackType понимает синонимы, prop и ключи-события', () => {
    eq(trackType({ type: 'angle' }), 'rotation');
    eq(trackType({ type: 'opacity' }), 'alpha');
    eq(trackType({ prop: 'scale_x' }), 'value');
    eq(trackType({ prop: 'x' }), 'position');
    eq(trackType({ prop: 'alpha' }), 'alpha');
    eq(trackType({ keys: [{ t: 0, v: 1 }] }), 'value');
    eq(trackType({ keys: [{ t: 0, name: 'step' }] }), 'event');

    let threw = false;
    try { trackType({ type: 'velocity' }); } catch (e) { threw = /неизвестный type/.test(e.message); }
    truthy(threw, 'неизвестный type должен падать с подсказкой');
});

test('normalizeTimelineTrack разворачивает ключи-события в общий список событий', () => {
    const clip = normalizeTimeline('evt', {
        duration: 500,
        tracks: [
            { type: 'event', keys: [{ t: 100, name: 'a' }, { t: 400, name: 'b', call: () => {} }] },
            { prop: 'hp', keys: [{ t: 0, v: 10 }, { t: 500, v: 0 }] },
        ],
    });
    eq(clip.tracks.length, 1);
    eq(clip.tracks[0].key, 'hp');
    truthy(clip.tracks[0].attr, 'prop-дорожка по умолчанию пишет в node.attrs');
    eq(clip.events.length, 2);
    eq(clip.events[0].name, 'a');
    eq(clip.events[1].name, 'b');
    truthy(typeof clip.events[1].call === 'function', 'call сохранён');
});

// --- Чистые функции: выборка значений ---------------------------------------

test('sampleKeysAt линейно интерполирует между ключами и точен на ключах', () => {
    const keys = normalizeTimelineKeys([{ t: 0, v: 0 }, { t: 1000, v: 100 }], 1000, 'alpha', {});
    near(sampleKeysAt(keys, 0), 0);
    near(sampleKeysAt(keys, 250), 25);
    near(sampleKeysAt(keys, 500), 50);
    near(sampleKeysAt(keys, 1000), 100);
});

test('sampleKeysAt держит значение за границами диапазона ключей', () => {
    const keys = normalizeTimelineKeys([{ t: 200, v: 10 }, { t: 800, v: 20 }], 1000, 'alpha', {});
    near(sampleKeysAt(keys, -5000), 10);
    near(sampleKeysAt(keys, 0), 10);
    near(sampleKeysAt(keys, 500), 15);
    near(sampleKeysAt(keys, 5000), 20);
    eq(sampleKeysAt([], 500), 0);
});

test('sampleKeysAt уважает easing: ключ-назначение и ключ-источник', () => {
    const onArrive = normalizeTimelineKeys(
        [{ t: 0, v: 0 }, { t: 1000, v: 100, ease: 'quadIn' }], 1000, 'alpha', {},
    );
    near(sampleKeysAt(onArrive, 500), 25);
    const onLeave = normalizeTimelineKeys(
        [{ t: 0, v: 0, ease: 'quadOut' }, { t: 1000, v: 100 }], 1000, 'alpha', {},
    );
    near(sampleKeysAt(onLeave, 500), 75);
    // Кривые общие с твинами: quadIn(0.5) = 0.25.
    near(playerEase('quadIn')(0.5), 0.25);
    near(playerEase(undefined)(0.5), 0.5);
});

test('sampleKeysAt не смешивает компоненты вектора и каналы цвета', () => {
    const pos = normalizeTimelineKeys(
        [{ t: 0, v: { x: 0, y: 100 } }, { t: 1000, v: { x: 50, y: 0 } }], 1000, 'position', {},
    );
    const mid = sampleKeysAt(pos, 500);
    near(mid.x, 25);
    near(mid.y, 50);

    const color = normalizeTimelineKeys(
        [{ t: 0, v: '#000000' }, { t: 1000, v: '#ffffff' }], 1000, 'color', {},
    );
    const pale = sampleKeysAt(color, 500);
    near(pale[0], 127.5);
    near(pale[1], 127.5);
    near(pale[2], 127.5);
    near(pale[3], 255);
    // Ключи клипа не портятся выборкой.
    eq(color[0].v[0], 0);
});

test('playheadState: once упирается в конец, loop — пила, pingpong — треугольник', () => {
    near(playheadState(250, 1000, 'once').position, 250);
    truthy(playheadState(1000, 1000, 'once').ended);
    eq(playheadState(5000, 1000, 'once').position, 1000);

    near(playheadState(1250, 1000, 'loop').position, 250);
    eq(playheadState(1250, 1000, 'loop').cycle, 1);
    falsy(playheadState(1250, 1000, 'loop').ended);

    near(playheadState(1500, 1000, 'pingpong').position, 500);
    near(playheadState(2000, 1000, 'pingpong').position, 0);
    near(playheadState(2500, 1000, 'pingpong').position, 500);
    falsy(playheadState(99999, 1000, 'pingpong').ended);
});

test('spriteFrameAt: ключи-индексы, fps по кругу и режим once', () => {
    const byKeys = normalizeTimelineTrack(
        { type: 'sprite', keys: [{ t: 0, v: 0 }, { t: 1000, v: 5 }] }, 1000, 'c',
    );
    eq(spriteFrameAt(byKeys, 0, 8), 0);
    eq(spriteFrameAt(byKeys, 500, 8), 3);          // round(2.5) = 3
    eq(spriteFrameAt(byKeys, 1000, 8), 5);
    eq(spriteFrameAt(byKeys, 1000, 4), 3);         // кадров меньше — зажимаем

    const byFps = normalizeTimelineTrack({ type: 'sprite', fps: 10, from: 2, to: 5 }, 1000, 'c');
    eq(spriteFrameAt(byFps, 0, 8), 2);
    eq(spriteFrameAt(byFps, 200, 8), 4);
    eq(spriteFrameAt(byFps, 500, 8), 3);           // 4 кадра по кругу: 2 + (5 % 4)
    const once = normalizeTimelineTrack({ type: 'sprite', fps: 10, from: 0, to: 3, once: true }, 1000, 'c');
    eq(spriteFrameAt(once, 5000, 8), 3);           // без зацикливания — последний кадр

    // Кадров у узла нет — индекс всё равно считается (полезно для отладки).
    eq(spriteFrameAt(byKeys, 1000, 0), 5);
});

test('timelineValuesAt отдаёт значения всех типов дорожек', () => {
    const clip = normalizeTimeline('all', {
        duration: 1000,
        tracks: [
            { type: 'position', keys: [{ t: 0, v: { x: 0, y: 0 } }, { t: 1000, v: { x: 100, y: 50 } }] },
            { type: 'scale', keys: [{ t: 0, v: 1 }, { t: 1000, v: 2 }] },
            { type: 'rotation', keys: [{ t: 0, v: 0 }, { t: 1000, v: 3.14 }] },
            { type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1000, v: 0.5 }] },
            { type: 'color', keys: [{ t: 0, v: '#000000' }, { t: 1000, v: '#ffffff' }] },
            { type: 'sprite', fps: 10, from: 0, to: 3 },
            { type: 'value', name: 'stamina', keys: [{ t: 0, v: 100 }, { t: 1000, v: 0 }] },
        ],
    });
    const v = timelineValuesAt(clip, 500, 8);
    near(v.position.x, 50);
    near(v.position.y, 25);
    near(v.scale.x, 1.5);
    near(v.rotation, 1.57);
    near(v.alpha, 0.75);
    near(v.color[0], 127.5);
    eq(v.sprite.frame, 1);
    near(v.stamina, 50);
});

test('eventsBetweenTimes: ровно один раз в интервале и повтор каждый цикл', () => {
    const events = [{ at: 500, name: 'step' }];
    eq(eventsBetweenTimes(events, 0, 499, 1000, 'loop').length, 0);
    eq(eventsBetweenTimes(events, 0, 500, 1000, 'loop').length, 1);
    // Время уже прошло событие — повторно оно не срабатывает.
    eq(eventsBetweenTimes(events, 500, 1000, 1000, 'loop').length, 0);
    // Следующий цикл — снова один раз.
    eq(eventsBetweenTimes(events, 1000, 1500, 1000, 'loop').length, 1);
    // Лагающий кадр накрыл два с половиной цикла — три срабатывания (500/1500/2500).
    eq(eventsBetweenTimes(events, 0, 2500, 1000, 'loop').length, 3);
    // once: только первый проход.
    eq(eventsBetweenTimes(events, 0, 2500, 1000, 'once').length, 1);
    eq(eventsBetweenTimes([{ at: 0, name: 'boot' }], -1, 0, 1000, 'once').length, 1);
});

// --- Чистые функции: микширование -------------------------------------------

test('blendValues смешивает по весам и нормирует дорожку одного клипа', () => {
    const a = { values: { alpha: 1, pos: { x: 0, y: 0 } }, weight: 1 };
    const b = { values: { alpha: 0, pos: { x: 100, y: 50 } }, weight: 1 };
    const half = blendValues([a, b]);
    near(half.alpha, 0.5);
    near(half.pos.x, 50);
    near(half.pos.y, 25);

    const onlyA = blendValues([a, { values: { other: 7 }, weight: 1 }]);
    near(onlyA.alpha, 1, 1e-9, 'дорожка только одного клипа не делится на два');

    const weighted = blendValues([{ values: { alpha: 1 }, weight: 3 }, { values: { alpha: 0 }, weight: 1 }]);
    near(weighted.alpha, 0.75);
    eq(blendValues([]).alpha, undefined);
});

test('blendValues берёт дискретный кадр спрайта у клипа с большим весом', () => {
    const a = { values: { sprite: { frame: 0 }, alpha: 1 }, weight: 0.6 };
    const b = { values: { sprite: { frame: 5 }, alpha: 0 }, weight: 0.4 };
    const merged = blendValues([a, b], ['sprite']);
    eq(merged.sprite.frame, 0);
    near(merged.alpha, 0.6);
    const flipped = blendValues([{ values: { sprite: { frame: 0 } }, weight: 0.1 },
                                  { values: { sprite: { frame: 5 } }, weight: 0.9 }], ['sprite']);
    eq(flipped.sprite.frame, 5);
});

test('packRgba/unpackRgba и lerpValue обратимы и не портят вход', () => {
    const rgba = unpackRgba(packRgba([10, 20, 30, 40]));
    eq(rgba[0], 10);
    eq(rgba[1], 20);
    eq(rgba[2], 30);
    eq(rgba[3], 40);
    const source = { x: 1, y: 2 };
    const copy = cloneValue(source);
    copy.x = 99;
    eq(source.x, 1, 'cloneValue не мутирует оригинал');
    const mixed = lerpValue([0, 100], [100, 0], 0.5);
    near(mixed[0], 50);
    near(mixed[1], 50);
});

// --- Плеер ------------------------------------------------------------------

test('installAnimPlayer дополняет $.anim и не затирает методы anim.js', () => {
    eq(typeof A.define, 'function', '$.anim.define из anim.js на месте');
    eq(typeof A.get, 'function');
    eq(typeof A.list, 'function');
    eq(typeof A.clear, 'function');
    eq(typeof A.clip, 'function', '$.anim.clip добавлен плеером');
    eq(typeof A.player, 'function');
    eq(typeof A.play, 'function');
    const other = {};
    installAnimPlayer(other);
    eq(typeof other.anim.clip, 'function', 'модуль ставится и на пустой $');
});

test('play применяет нулевой кадр, tick двигает значения и часы', () => {
    A.clip('walk', {
        duration: 1000,
        loop: 'loop',
        tracks: [
            { type: 'position', keys: [{ t: 0, v: { x: 0, y: 0 } }, { t: 1000, v: { x: 100, y: 40 } }] },
            { type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1000, v: 0 }] },
        ],
    });
    const node = makeNode('rect');
    const player = makePlayer(node);
    player.play('walk');
    truthy(player.playing());
    near(node.x, 0);
    near(node.alpha, 1);
    eq(player.clip(), 'walk');
    near(player.time(), 0);

    tickAnimPlayer(0.25);
    near(node.x, 25);
    near(node.y, 10);
    near(node.alpha, 0.75);
    near(player.time(), 250);
    near(player.total(), 250);
    player.stop();
    falsy(player.playing());
});

test('once-клип завершается сам: finished, onEnd, конечный кадр', () => {
    A.clip('open', {
        duration: 400,
        tracks: [{ type: 'rotation', keys: [{ t: 0, v: 0 }, { t: 400, v: 1.5 }] }],
    });
    const node = makeNode('rect');
    const player = makePlayer(node);
    let finished = 0;
    let ends = 0;
    player.on('finished', () => { finished++; });
    player.play('open', { onEnd: () => { ends++; } });
    tickAnimPlayer(0.2);
    near(node.angle, 0.75);
    truthy(player.playing());
    tickAnimPlayer(0.3);
    falsy(player.playing(), 'once-клип остановился');
    eq(finished, 1);
    eq(ends, 1);
    near(node.angle, 1.5, 1e-9, 'конечное значение применено до остановки');
    tickAnimPlayer(0.5);
    eq(finished, 1, 'после конца событий больше нет');
});

test('loop-клип не завершается и начинает проход заново', () => {
    A.clip('spin', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ type: 'rotation', keys: [{ t: 0, v: 0 }, { t: 1000, v: 10 }] }],
    });
    const node = makeNode('rect');
    const player = makePlayer(node);
    player.play('spin');
    tickAnimPlayer(1.25);
    truthy(player.playing());
    near(node.angle, 2.5, 1e-6, 'второй проход: 250 мс от начала');
    near(player.time(), 250);
    near(player.total(), 1250);
    player.stop();
});

test('speed ускоряет часы; отрицательная скорость отвергается', () => {
    A.clip('fast', {
        duration: 1000,
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 0 }, { t: 1000, v: 100 }] }],
    });
    const node = makeNode('rect');
    const player = makePlayer(node);
    player.play('fast');
    player.speed(2);
    eq(player.speed(), 2);
    tickAnimPlayer(0.25);              // 500 мс клипа при скорости 2
    near(node.alpha, 50);
    player.speed(-1);
    eq(player.speed(), 2, 'отрицательная скорость не принимается');
    player.stop();
});

test('loop(false) превращает loop-клип в одноразовый', () => {
    A.clip('toggle', {
        duration: 200,
        loop: 'loop',
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 200, v: 0 }] }],
    });
    const node = makeNode('rect');
    const player = makePlayer(node);
    player.play('toggle');
    player.loop(false);
    eq(player.loop(), 'once');
    tickAnimPlayer(0.3);
    falsy(player.playing(), 'клип доиграл один раз');
    player.loop('loop');
    player.play('toggle', { restart: true });
    tickAnimPlayer(0.3);
    truthy(player.playing(), 'loop вернулся');
    player.stop();
});

test('pause/resume останавливают и продолжают часы', () => {
    A.clip('pause-probe', {
        duration: 1000,
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 0 }, { t: 1000, v: 100 }] }],
    });
    const node = makeNode('rect');
    const player = makePlayer(node);
    player.play('pause-probe');
    tickAnimPlayer(0.25);
    player.pause();
    truthy(player.paused());
    tickAnimPlayer(0.5);
    near(node.alpha, 25, 1e-6, 'на паузе время стоит');
    truthy(player.playing(), 'на паузе клип ещё не завершён');
    player.resume();
    tickAnimPlayer(0.25);
    near(node.alpha, 50);
    player.stop();
});

test('seek перематывает: события — только по opts.fire', () => {
    A.clip('seek-probe', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 0 }, { t: 1000, v: 100 }] }],
        events: [{ at: 600, name: 'mid' }],
    });
    const node = makeNode('rect');
    const player = makePlayer(node);
    let hits = 0;
    player.on('mid', () => { hits++; });
    player.play('seek-probe');
    player.seek(900, { fire: true });
    near(node.alpha, 90);
    eq(hits, 1, 'seek с fire: true догоняет пропущенное событие');
    player.seek(750);
    near(node.alpha, 75);
    eq(hits, 1, 'простой seek события не вызывает');
    player.seek(100);                  // назад — тоже прыжок без событий
    near(node.alpha, 10);
    eq(hits, 1);
    player.stop();
});

test('события клипа приходят ровно один раз, включая at: 0 и вызов call', () => {
    let called = 0;
    A.clip('evt-run', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1000, v: 1 }] }],
        events: [
            { at: 0, name: 'boot' },
            { at: 500, name: 'step', data: { n: 7 }, call: () => { called++; } },
        ],
    });
    const node = makeNode('rect');
    const player = makePlayer(node);
    const seen = [];
    player.on('boot', () => seen.push('boot'));
    player.on('step', (e) => seen.push('step:' + e.data.n));
    player.on('event', (e) => seen.push('any:' + e.name));
    player.play('evt-run');
    eq(seen.join(','), 'any:boot,boot', 'at: 0 срабатывает сразу при play');
    tickAnimPlayer(0.6);
    eq(seen.join(','), 'any:boot,boot,any:step,step:7', 'событие ровно один раз');
    tickAnimPlayer(0.6);               // 1200 мс: событие 500 позади, новое — 1500
    eq(seen.length, 6, 'повторилось только событие цикла (at: 0)');
    tickAnimPlayer(0.4);               // 1600 мс: второй проход, событие 1500
    eq(seen.length, 8);
    eq(seen[seen.length - 1], 'step:7');
    eq(called, 2, 'call дёрнулся по разу за проход');
    player.stop();
});

test('stop отменяет события, off() и возвращённая функция отписывают', () => {
    A.clip('cancel', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1000, v: 1 }] }],
        events: [{ at: 100, name: 'tick100' }],
    });
    const node = makeNode('rect');
    const player = makePlayer(node);
    let hits = 0;
    const unsubscribe = player.on('tick100', () => { hits++; });
    player.play('cancel');
    tickAnimPlayer(0.2);
    eq(hits, 1);
    player.stop();
    eq(player.values().alpha, undefined, 'stop очищает значения');
    tickAnimPlayer(1.5);
    eq(hits, 1, 'после stop события не приходят');
    player.play('cancel', { restart: true });
    unsubscribe();
    tickAnimPlayer(0.2);
    eq(hits, 1, 'отписка сняла обработчик');
    player.on('tick100', () => { hits++; });
    player.off('tick100');
    player.play('cancel', { restart: true });
    tickAnimPlayer(0.2);
    eq(hits, 1, 'off() снял все обработчики события');
    player.stop();
});

test('пустой клип не роняет плеер: время идёт, значений нет', () => {
    A.clip('empty', { duration: 300, loop: 'loop', tracks: [] });
    const node = makeNode('rect');
    const player = makePlayer(node);
    player.play('empty');
    truthy(player.playing());
    tickAnimPlayer(0.15);
    near(player.time(), 150);
    near(player.total(), 150);
    eq(Object.keys(player.values()).length, 0);
    eq(player.value('нет-такого', -1), -1);
    player.stop();
});

test('неизвестный клип: play/blend не падают, плеер не играет', () => {
    const node = makeNode('rect');
    const player = makePlayer(node);
    player.play('нет-такого');
    falsy(player.playing());
    player.blend('нет-такого', 'тоже-нет', 0.5);
    falsy(player.playing());
    tickAnimPlayer(0.1);
    near(node.x, 0);
});

test('value-дорожка читается из плеера, attr: true пишет в node.attrs', () => {
    A.clip('stamina', {
        duration: 1000,
        loop: 'loop',
        tracks: [
            { type: 'value', name: 'energy', keys: [{ t: 0, v: 100 }, { t: 1000, v: 0 }] },
            { type: 'value', name: 'charge', attr: true, keys: [{ t: 0, v: 0 }, { t: 1000, v: 5 }] },
        ],
    });
    const node = makeNode('rect');
    const player = makePlayer(node);
    player.play('stamina');
    tickAnimPlayer(0.4);
    near(player.value('energy'), 60);
    eq($.anim.value('energy', -1), -1, 'плеер по умолчанию этим клипом не занят');
    near(node.attrs.charge, 2);
    near(player.value('charge'), 2);
    player.stop();
});

test('blend смешивает два клипа, t = 0 и t = 1 дают чистые клипы', () => {
    A.clip('idle-clip', {
        duration: 1000,
        loop: 'loop',
        tracks: [
            { type: 'alpha', keys: [{ t: 0, v: 0.2 }, { t: 1000, v: 0.2 }] },
            { type: 'position', keys: [{ t: 0, v: { x: 0, y: 0 } }, { t: 1000, v: { x: 0, y: 0 } }] },
        ],
    });
    A.clip('run-clip', {
        duration: 1000,
        loop: 'loop',
        tracks: [
            { type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1000, v: 1 }] },
            { type: 'position', keys: [{ t: 0, v: { x: 100, y: 0 } }, { t: 1000, v: { x: 100, y: 0 } }] },
        ],
    });
    const node = makeNode('rect');
    const player = makePlayer(node);
    player.blend('idle-clip', 'run-clip', 0);
    near(node.alpha, 0.2);
    near(node.x, 0);
    eq(player.clipNames().length, 2, 'оба клипа в слотах');
    player.blend('idle-clip', 'run-clip', 1);
    near(node.alpha, 1);
    near(node.x, 100);
    player.blend('idle-clip', 'run-clip', 0.25);
    near(node.alpha, 0.4);
    near(node.x, 25);
    player.stop();
    falsy(player.playing());
});

test('blend берёт кадр спрайта у клипа с большим весом', () => {
    A.clip('frames-a', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ type: 'sprite', keys: [{ t: 0, v: 0 }, { t: 1000, v: 0 }] }],
    });
    A.clip('frames-b', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ type: 'sprite', keys: [{ t: 0, v: 4 }, { t: 1000, v: 4 }] }],
    });
    const node = makeNode('sprite');
    const player = makePlayer(node);
    player.blend('frames-a', 'frames-b', 0.5);
    eq(player.value('sprite').frame, 0, 'при равных весах выигрывает первый клип');
    player.blend('frames-a', 'frames-b', 0.9);
    eq(player.value('sprite').frame, 4);
    player.stop();
});

test('цель ищется по селектору, а writeTrackValue умеет спрайт и цвет', () => {
    const node = makeNode('sprite');
    const player = makePlayer();
    player.target('#n' + uid);
    eq(player.target(), node, 'селектор разрешился в узел');
    eq(resolveTarget('#нет-такого'), null);

    node.frames = [11, 22, 33];
    const spriteTrack = normalizeTimelineTrack({ type: 'sprite', keys: [{ t: 0, v: 2 }] }, 10, 'c');
    writeTrackValue(node, spriteTrack, { frame: 2 });
    eq(node.sprite, 33);
    eq(node.frame_index, 2);
    writeTrackValue(node, spriteTrack, { frame: 99 });
    eq(node.frame_index, 2, 'индекс зажимается по числу кадров');

    const colorTrack = normalizeTimelineTrack({ type: 'color', keys: [{ t: 0, v: '#ff0000' }] }, 10, 'c');
    writeTrackValue(node, colorTrack, [255, 0, 0, 255]);
    eq(unpackRgba(node.color)[0], 255);
    eq(unpackRgba(node.color)[1], 0);

    const balance = makeNode('sprite');   // без кадров
    writeTrackValue(balance, spriteTrack, { frame: 1 });
    eq(balance.sprite, -1, 'без кадров спрайт не подменяется');
});

test('цель удалена из мира — плеер останавливается сам', () => {
    A.clip('doomed', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 1000, v: 1 }] }],
    });
    const node = makeNode('rect');
    const player = makePlayer(node);
    player.play('doomed');
    tickAnimPlayer(0.1);
    truthy(player.playing());
    node.removed = true;
    tickAnimPlayer(0.1);
    falsy(player.playing(), 'плеер с удалённым узлом остановлен');
});

test('детерминизм: одинаковые dt дают одинаковые значения и события', () => {
    A.clip('det', {
        duration: 700,
        loop: 'loop',
        tracks: [
            { type: 'position', keys: [{ t: 0, v: { x: 0, y: 0 } }, { t: 700, v: { x: 70, y: 35 } }] },
            { type: 'color', keys: [{ t: 0, v: '#102030' }, { t: 700, v: '#f0e0d0' }] },
        ],
        events: [{ at: 350, name: 'beat' }],
    });
    const nodeA = makeNode('rect');
    const nodeB = makeNode('rect');
    const a = makePlayer(nodeA);
    const b = makePlayer(nodeB);
    const beatsA = [];
    const beatsB = [];
    a.on('beat', () => beatsA.push(a.total().toFixed(6)));
    b.on('beat', () => beatsB.push(b.total().toFixed(6)));
    a.play('det');
    b.play('det');
    for (let i = 0; i < 120; i++) {
        tickAnimPlayer(1 / 60);
    }
    eq(JSON.stringify(a.values()), JSON.stringify(b.values()), 'значения совпали');
    eq(beatsA.join(','), beatsB.join(','), 'моменты событий совпали');
    near(nodeA.x, nodeB.x, 1e-12);
    truthy(beatsA.length >= 3, 'события повторились на проходах');
    a.stop();
    b.stop();
});

test('два плеера живут независимо, обработчик может остановить плеер в кадре', () => {
    A.clip('pair', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 0 }, { t: 1000, v: 100 }] }],
        events: [{ at: 100, name: 'cut' }],
    });
    const nodeA = makeNode('rect');
    const nodeB = makeNode('rect');
    const a = makePlayer(nodeA);
    const b = makePlayer(nodeB);
    a.play('pair');
    b.play('pair');
    a.on('cut', () => { a.stop(); });
    tickAnimPlayer(0.2);
    falsy(a.playing(), 'плеер остановлен из своего обработчика');
    truthy(b.playing(), 'соседний плеер не задет');
    near(nodeB.alpha, 20);
    b.stop();
});

test('advancePlayer крутит ровно один плеер, не трогая остальные', () => {
    A.clip('solo', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 0 }, { t: 1000, v: 100 }] }],
    });
    const nodeA = makeNode('rect');
    const nodeB = makeNode('rect');
    const a = makePlayer(nodeA);
    const b = makePlayer(nodeB);
    a.play('solo');
    b.play('solo');
    advancePlayer(a, 200);
    near(nodeA.alpha, 20);
    near(nodeB.alpha, 0, 1e-9, 'второй плеер не сдвинулся');
    advancePlayer(a, 0);
    near(a.total(), 200, 1e-9, 'нулевой dt ничего не двигает');
    a.stop();
    b.stop();
});

finish();
