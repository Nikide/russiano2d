// ===========================================================================
// Юнит-тесты §41 (multi-target tracks), §10 (маркеры/окна) и §6 (часы)
// анимационного плеера — без движка, на qjs.
//
// Проверяем схему дорожек, разрешение target/binding до play, адаптеры
// подсистем (shape.enabled, emitter, light, RmlUi, audio handle), audio cue с
// огибающей на своём handle, method-действия без eval, policy маркеров при
// seek/loop/skip, gameplay-окна, домены часов simulation/presentation и
// совместимость со старым форматом дорожек.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/anim_tracks_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { Node, Wrapper, wrapOne, ctx } from '../../src/highlevel/core.js';
import { engine } from '../../src/highlevel/native.js';
import { installAnim } from '../../src/highlevel/anim.js';
import {
    installAnimPlayer, advancePlayer, tickAnimPlayer,
    normalizeTimeline, normalizeTimelineTrack, normalizeEvent, normalizePolicy,
    markerAllowed, markerId, resolveTrackTarget, registerBinding, bindingNames,
    getBinding, blendTrackEntries, trackValueAt, timelineTrackValuesAt,
    initialTrackValue, playerStepMs, registerAction, boolOf, sameValue,
} from '../../src/highlevel/animplayer.js';

const $ = {};
installAnim($);
installAnimPlayer($);
const A = $.anim;

// Node.emit() в ядре рассылает ещё и глобальные подписки через ctx.$;
// в реальном движке $ уже создан, в юнит-тесте подставляем заглушку.
ctx.$ = { _dispatchGlobal: () => {} };

const logs = [];
const real_log = ctx.log;
ctx.log = (m) => { logs.push(String(m)); };
function clearLogs() { logs.length = 0; }
function logged(re) { return logs.some((m) => re.test(m)); }

let uid = 0;
function makeNode(tag, x, y, id) {
    uid++;
    const node = new Node(tag || 'rect', { id: id || 'n' + uid });
    node.x = x === undefined ? 0 : x;
    node.y = y === undefined ? 0 : y;
    return node;
}

function attach(parent, child) {
    child.parent_node = parent;
    parent.child_nodes.push(child);
    return child;
}

let puid = 0;
function makePlayer(root) {
    puid++;
    const player = A.player('t' + puid);
    if (root) player.target(root);
    return player;
}

function makeClip(name, spec) {
    A.clip(name, spec);
    return A.clipGet(name);
}

/** Сброс подсистем-заглушек после теста, который их подменял. */
function resetStubs() {
    ctx.audio = undefined;
    ctx.sound = undefined;
    ctx.ui = undefined;
    ctx.time = undefined;
    engine.audio = undefined;
    engine.setShapeEnabled = undefined;
    engine.setBodyEnabled = undefined;
}

// --- Схема дорожек ----------------------------------------------------------

test('схема §41: target/binding/id/mode выводятся из объявления', () => {
    const tl = normalizeTimeline('multi', {
        duration: 1000,
        tracks: [
            { type: 'rotation', target: 'weapon', keys: [{ t: 0, v: 0 }, { t: 1000, v: 1 }] },
            { type: 'visible', target: 'weapon', keys: [{ t: 0, v: true }, { t: 500, v: false }] },
            { type: 'shape', binding: 'shape.enabled', target: 'sensor', shape: 2,
              keys: [{ t: 0, v: true }, { t: 200, v: false }] },
            { type: 'light', binding: 'light.intensity', target: 'muzzle',
              keys: [{ t: 0, v: 0 }, { t: 100, v: 3 }] },
            { type: 'emitter', target: 'smoke', keys: [{ t: 0, v: false }, { t: 100, v: true }] },
            { type: 'ui', doc: 'ui/hud.rml', element: '#fade', property: 'opacity',
              keys: [{ t: 0, v: 0 }, { t: 300, v: 1 }] },
            { type: 'audio', at: 120, resource: 'shot.ogg', bus: 'sfx', gain: 0.5 },
            { type: 'method', at: 120, name: 'camera.shake', data: { intensity: 5 } },
            { type: 'event', at: 200, name: 'hit', window: 'attack', windowPhase: 'open' },
        ],
    });
    eq(tl.tracks.length, 6, 'шесть property-дорожек');
    eq(tl.cues.length, 2, 'audio и method — cue-дорожки');
    eq(tl.events.length, 1, 'маркер-событие');

    const rot = tl.tracks[0];
    eq(rot.binding, 'transform');
    eq(rot.channel, 'rotation');
    eq(rot.id, 'transform.rotation@weapon');
    eq(rot.target, 'weapon');
    eq(rot.mode, 'apply');
    eq(rot.storeKey, 'transform.rotation@weapon');

    const vis = tl.tracks[1];
    eq(vis.binding, 'visible');
    eq(vis.id, 'visible@weapon');
    eq(vis.mode, 'change', 'дискретное поле обновляется по изменению');

    const shape = tl.tracks[2];
    eq(shape.binding, 'shape.enabled');
    eq(shape.props.shape, 2);
    eq(shape.mode, 'change');

    const light = tl.tracks[3];
    eq(light.binding, 'light.intensity');
    eq(light.mode, 'apply');

    eq(tl.tracks[4].binding, 'emitter.emitting');
    const ui = tl.tracks[5];
    eq(ui.binding, 'ui.style');
    eq(ui.props.doc, 'ui/hud.rml');
    eq(ui.props.element, '#fade');
    eq(ui.props.property, 'opacity');

    eq(tl.cues[0].kind, 'audio');
    eq(tl.cues[0].audio.resource, 'shot.ogg');
    eq(tl.cues[0].audio.bus, 'sfx');
    eq(tl.cues[0].audio.gain, 0.5);
    eq(tl.cues[1].kind, 'method');
    eq(tl.cues[1].action, 'camera.shake');
    eq(tl.events[0].window, 'attack');
    eq(tl.events[0].windowPhase, 'open');
    eq(tl.events[0].id, 'hit@200');
});

test('типы-синонимы binding-имён: shape.enabled/light.intensity/ui.style', () => {
    const tl = normalizeTimeline('alias', {
        duration: 100,
        tracks: [
            { type: 'shape.enabled', target: 's', keys: [{ t: 0, v: true }] },
            { type: 'light.intensity', target: 'l', keys: [{ t: 0, v: 2 }] },
            { type: 'ui.style', doc: 'd.rml', element: '#x', keys: [{ t: 0, v: 1 }] },
        ],
    });
    eq(tl.tracks[0].binding, 'shape.enabled');
    eq(tl.tracks[1].binding, 'light.intensity');
    eq(tl.tracks[2].binding, 'ui.style');
});

test('старый формат дорожек сохраняет id/ключи и значения', () => {
    const tl = normalizeTimeline('legacy', {
        duration: 100,
        tracks: [
            { type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 100, v: 0 }] },
            { type: 'value', name: 'stamina', attr: true, keys: [{ t: 0, v: 10 }] },
            { type: 'position', axis: 'x', keys: [{ t: 0, v: 0 }] },
        ],
    });
    eq(tl.tracks[0].id, 'alpha');
    eq(tl.tracks[0].storeKey, 'alpha');
    truthy(tl.tracks[0].legacy);
    eq(tl.tracks[1].id, 'stamina');
    eq(tl.tracks[1].storeKey, 'stamina');
    eq(tl.tracks[1].binding, 'attr');
    eq(tl.tracks[2].id, 'x');
});

test('normalizeEvent: kind damage → необратимый, policy по умолчанию', () => {
    const ev = normalizeEvent({ at: 100, name: 'hit', kind: 'damage' }, 1000);
    eq(ev.irreversible, true);
    eq(ev.policy.seek, 'skip');
    eq(ev.policy.loop, 'fire');
    eq(ev.policy.explicit, false);
    const ev2 = normalizeEvent({ at: 50, name: 'vfx', policy: { seek: 'fire' } }, 1000);
    eq(ev2.irreversible, false);
    eq(ev2.policy.explicit, true);
    eq(markerId(ev2), 'vfx@50');
});

test('markerAllowed: seek уважает policy и необратимость', () => {
    const plain = normalizeEvent({ at: 10, name: 'a' }, 100);
    truthy(markerAllowed(plain, 'seek', { fire: true }), 'обычное событие доигрывается');
    falsy(markerAllowed(plain, 'restore', { fire: true }), 'restore по умолчанию только состояние');
    const explicitSkip = normalizeEvent({ at: 10, name: 'b', policy: { seek: 'skip' } }, 100);
    falsy(markerAllowed(explicitSkip, 'seek', { fire: true }), 'явный skip при seek');
    const explicitFire = normalizeEvent({ at: 10, name: 'c', policy: { seek: 'fire' } }, 100);
    truthy(markerAllowed(explicitFire, 'seek', { fire: true }));
    const damage = normalizeEvent({ at: 10, name: 'd', kind: 'damage', policy: { seek: 'fire' } }, 100);
    falsy(markerAllowed(damage, 'seek', { fire: true }), 'урон на seek не наносится');
    truthy(markerAllowed(damage, 'seek', { fire: true, irreversible: true }), 'урон только по явному разрешению');
    truthy(markerAllowed(damage, 'normal', null), 'в обычном ходе урон срабатывает');
});

// --- Целевые пути -----------------------------------------------------------

test('resolveTrackTarget: корень, #id, путь по детям, промах', () => {
    const root = makeNode('rect', 0, 0, 'root-path');
    const weapon = makeNode('rect', 0, 0, 'weapon');
    attach(root, weapon);
    const barrel = makeNode('rect', 0, 0, 'barrel-path');
    barrel.attrs.name = 'barrel';
    attach(weapon, barrel);

    eq(resolveTrackTarget(root, null).node, root);
    eq(resolveTrackTarget(root, '#weapon').node, weapon);
    eq(resolveTrackTarget(root, 'weapon').node, weapon);
    eq(resolveTrackTarget(root, 'weapon/barrel').node, barrel);
    eq(resolveTrackTarget(root, 'weapon/barrel').id, '#barrel-path', 'id узла важнее пути');
    eq(resolveTrackTarget(root, 'weapon/weapon').node, null, 'путь идёт только вглубь');
    eq(resolveTrackTarget(root, 'weapon/missing').node, null);
    eq(resolveTrackTarget(root, 'weapon').path, 'weapon');
});

// --- Применение к нескольким целям -------------------------------------------

test('один клип управляет героем, оружием, светом и видимостью', () => {
    const hero = makeNode('rect', 0, 0, 'hero-multi');
    const weapon = makeNode('rect', 0, 0, 'weapon');
    attach(hero, weapon);
    const muzzle = makeNode('light', 0, 0, 'muzzle');
    attach(weapon, muzzle);

    makeClip('attack-multi', {
        duration: 400,
        tracks: [
            { type: 'rotation', target: 'weapon', keys: [{ t: 0, v: 0 }, { t: 400, v: 1.5 }] },
            { type: 'visible', target: 'weapon', keys: [{ t: 0, v: true }, { t: 200, v: false }] },
            { type: 'light.intensity', target: 'weapon/muzzle', keys: [{ t: 0, v: 0 }, { t: 400, v: 3 }] },
            { type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 400, v: 0.5 }] },
        ],
    });
    const player = makePlayer(hero);
    player.play('attack-multi');
    const binds = player.bindings();
    eq(binds.length, 4, 'все четыре дорожки разрешены до play');
    eq(binds[0].target, '#weapon');
    eq(binds[2].target, '#muzzle');

    advancePlayer(player, 200);
    near(weapon.angle, 0.75, 1e-9);
    eq(weapon.visible, false, 'видимость оружия переключилась');
    near(muzzle.intensity, 1.5, 1e-9);
    near(hero.alpha, 0.75, 1e-9);
    player.stop();
});

test('target ищется один раз до play, а не селектором каждый кадр', () => {
    const hero = makeNode('rect');
    const weapon = makeNode('rect');
    weapon.id = 'weapon';
    attach(hero, weapon);
    makeClip('once-resolve', {
        duration: 100,
        tracks: [{ type: 'alpha', target: 'weapon', keys: [{ t: 0, v: 0 }, { t: 100, v: 1 }] }],
    });
    const player = makePlayer(hero);
    player.play('once-resolve');
    // Цель убрали из-под корня: разрешённый handle продолжает писать в узел.
    hero.child_nodes.length = 0;
    weapon.parent_node = null;
    advancePlayer(player, 50);
    near(weapon.alpha, 0.5, 1e-9);
    player.stop();
});

test('пропавшая цель: дорожка пропускается, кадр не падает', () => {
    const hero = makeNode('rect');
    makeClip('missing-target', {
        duration: 100,
        tracks: [
            { type: 'alpha', target: 'nope', keys: [{ t: 0, v: 1 }] },
            { type: 'alpha', keys: [{ t: 0, v: 0.5 }] },
        ],
    });
    clearLogs();
    const player = makePlayer(hero);
    player.play('missing-target');
    truthy(logged(/цель "nope"/), 'в журнале сказано о пропавшей цели');
    eq(player.bindings().length, 1, 'осталась только дорожка корня');
    near(hero.alpha, 0.5, 1e-9);
    player.stop();
});

test('дискретное состояние enum через зарегистрированный binding', () => {
    registerBinding('test.variant', {
        kind: 'discrete',
        resolve: () => ({ log: [] }),
        apply: (handle, value) => { handle.log.push(String(value)); },
    });
    truthy(bindingNames().indexOf('test.variant') >= 0);
    const node = makeNode('rect');
    makeClip('enum-clip', {
        duration: 300,
        tracks: [{ type: 'bool', binding: 'test.variant',
                   keys: [{ t: 0, v: 'idle' }, { t: 200, v: 'run' }] }],
    });
    const player = makePlayer(node);
    player.play('enum-clip');
    advancePlayer(player, 100);
    advancePlayer(player, 150);
    eq(A.player(player.name).value('test.variant'), 'run');
    player.stop();
});

// --- Адаптеры физики/эмиттера/RmlUi -----------------------------------------

test('shape.enabled идёт командой движка, а не записью поля', () => {
    const calls = [];
    engine.setShapeEnabled = (body, shape, flag) => { calls.push([body, shape, flag]); };
    const node = makeNode('rect');
    node.body = 7;
    makeClip('shape-clip', {
        duration: 200,
        tracks: [{ type: 'shape', binding: 'shape.enabled', target: '.', shape: 2,
                   keys: [{ t: 0, v: true }, { t: 100, v: false }] }],
    });
    const player = makePlayer(node);
    player.play('shape-clip');
    advancePlayer(player, 50);
    advancePlayer(player, 100);
    eq(calls.length, 2, 'две смены состояния');
    eq(calls[0][0], 7);
    eq(calls[0][1], 2);
    eq(calls[0][2], true);
    eq(calls[1][2], false);
    player.stop();
    resetStubs();
});

test('shape.enabled без per-shape гейта не трогает тело с чужими формами', () => {
    const bodyCalls = [];
    engine.setBodyEnabled = (body, flag) => { bodyCalls.push([body, flag]); };
    const node = makeNode('rect');
    node.body = 4;
    makeClip('shape-index', {
        duration: 100,
        tracks: [{ type: 'shape', binding: 'shape.enabled', shape: 1,
                   keys: [{ t: 0, v: false }] }],
    });
    clearLogs();
    const player = makePlayer(node);
    player.play('shape-index');
    advancePlayer(player, 50);
    eq(bodyCalls.length, 0, 'per-shape индекс без гейта не выключает всё тело');
    truthy(logged(/setShapeEnabled/), 'в журнале сказано о причине');
    player.stop();
    resetStubs();
});

test('shape.enabled без индекса использует безопасную команду тела', () => {
    const bodyCalls = [];
    engine.setBodyEnabled = (body, flag) => { bodyCalls.push([body, flag]); };
    const node = makeNode('rect');
    node.body = 9;
    makeClip('shape-body', {
        duration: 100,
        tracks: [{ type: 'shape', binding: 'shape.enabled', keys: [{ t: 0, v: false }] }],
    });
    const player = makePlayer(node);
    player.play('shape-body');
    advancePlayer(player, 50);
    eq(bodyCalls.length, 1);
    eq(bodyCalls[0][0], 9);
    eq(bodyCalls[0][1], false);
    player.stop();
    resetStubs();
});

test('emitter.emitting использует существующий setter эмиттера', () => {
    const seen = [];
    Wrapper.prototype.emitting = function (flag) {
        seen.push([this.nodes[0].id, flag]);
        return this;
    };
    const node = makeNode('particles');
    makeClip('emit-clip', {
        duration: 200,
        tracks: [{ type: 'emitter', keys: [{ t: 0, v: false }, { t: 100, v: true }] }],
    });
    const player = makePlayer(node);
    player.play('emit-clip');
    advancePlayer(player, 150);
    eq(seen.length, 2, 'начальное состояние и смена');
    eq(seen[0][1], false);
    eq(seen[1][1], true);
    player.stop();
    delete Wrapper.prototype.emitting;
});

test('emitter.position пишет позицию узла-эмиттера', () => {
    const node = makeNode('particles', 0, 0, 'emit-pos-node');
    makeClip('emit-pos', {
        duration: 100,
        tracks: [{ type: 'emitter', binding: 'emitter.position',
                   keys: [{ t: 0, v: { x: 0, y: 0 } }, { t: 100, v: { x: 40, y: -20 } }] }],
    });
    const player = makePlayer(node);
    player.play('emit-pos');
    advancePlayer(player, 50);
    near(node.x, 20);
    near(node.y, -10);
    player.stop();
});

test('light.intensity и light.radius пишутся в узел света', () => {
    const node = makeNode('light');
    makeClip('light-clip', {
        duration: 100,
        tracks: [
            { type: 'light', binding: 'light.intensity', keys: [{ t: 0, v: 0 }, { t: 100, v: 4 }] },
            { type: 'light', binding: 'light.radius', keys: [{ t: 0, v: 100 }, { t: 100, v: 300 }] },
        ],
    });
    const player = makePlayer(node);
    player.play('light-clip');
    advancePlayer(player, 25);
    near(node.intensity, 1);
    near(node.radius, 150);
    player.stop();
});

test('ui.style и ui.value идут через документ RmlUi', () => {
    const style_calls = [];
    const value_calls = [];
    const doc = {
        style(element, property, value) { style_calls.push([element, property, value]); return doc; },
        setValue(element, value) { value_calls.push([element, String(value)]); return doc; },
    };
    ctx.ui = { doc: (path) => doc };
    const node = makeNode('rect');
    makeClip('ui-clip', {
        duration: 300,
        tracks: [
            { type: 'ui', doc: 'ui/hud.rml', element: '#fade', property: 'opacity',
              keys: [{ t: 0, v: 0 }, { t: 300, v: 1 }] },
            { type: 'ui', binding: 'ui.value', doc: 'ui/hud.rml', element: '#lives',
              keys: [{ t: 0, v: 3 }, { t: 300, v: 1 }] },
        ],
    });
    const player = makePlayer(node);
    player.play('ui-clip');
    advancePlayer(player, 150);
    eq(style_calls.length >= 1, true);
    eq(style_calls[0][0], '#fade');
    eq(style_calls[0][1], 'opacity');
    near(style_calls[style_calls.length - 1][2], 0.5, 1e-6);
    eq(value_calls[value_calls.length - 1][1], '2', 'ui.value приводится к строке');
    player.stop();
    resetStubs();
});

// --- Audio cues --------------------------------------------------------------

function audioStub() {
    const played = [];
    ctx.audio = {
        play(resource, opts) {
            const h = {
                resource, opts,
                vol: opts.volume,
                stopped: 0,
                volume(v) {
                    if (v === undefined) return h.vol;
                    h.vol = v;
                    return h;
                },
                stop() { h.stopped++; return h; },
            };
            played.push(h);
            return h;
        },
    };
    return played;
}

test('audio cue: resource/bus/gain и огибающая на своём handle', () => {
    const played = audioStub();
    const node = makeNode('rect');
    makeClip('sfx-clip', {
        duration: 1000,
        tracks: [{
            type: 'audio', at: 0, resource: 'shot.ogg', bus: 'weapon', gain: 0.5,
            envelope: [{ t: 0, v: 1 }, { t: 1000, v: 0 }],
        }],
    });
    const player = makePlayer(node);
    player.play('sfx-clip');
    advancePlayer(player, 500);
    eq(played.length, 1, 'звук запущен один раз');
    eq(played[0].resource, 'shot.ogg');
    eq(played[0].opts.bus, 'weapon');
    eq(played[0].opts.volume, 0.5, 'базовая громкость из gain');
    near(played[0].vol, 0.25, 1e-6, 'огибающая множит громкость своего handle');
    player.stop();
    resetStubs();
});

test('audio cue: length гасит только свой handle', () => {
    const played = audioStub();
    const node = makeNode('rect');
    makeClip('sfx-length', {
        duration: 1000,
        tracks: [
            { type: 'audio', at: 0, resource: 'a.ogg', length: 100 },
            { type: 'audio', at: 0, resource: 'b.ogg' },
        ],
    });
    const player = makePlayer(node);
    player.play('sfx-length');
    advancePlayer(player, 200);
    eq(played.length, 2);
    eq(played[0].stopped, 1, 'короткий звук погашен по length');
    eq(played[1].stopped, 0, 'долгий звук не тронут');
    player.stop();
    resetStubs();
});

test('audio cue: policy seek skip/fire и loop', () => {
    const played = audioStub();
    const node = makeNode('rect');
    makeClip('sfx-policy', {
        duration: 1000,
        loop: 'loop',
        tracks: [{
            type: 'audio', at: 500, resource: 'c.ogg',
            policy: { seek: 'skip', loop: 'once' },
        }],
    });
    const player = makePlayer(node);
    player.play('sfx-policy');
    player.seek(900, { fire: true });
    eq(played.length, 0, 'явный seek: skip не переигрывает звук');
    player.seek(400);
    advancePlayer(player, 200);       // 400 → 600, пересечение 500
    eq(played.length, 1, 'обычный ход запускает cue');
    advancePlayer(player, 1000);      // второй проход
    eq(played.length, 1, 'policy loop: once не повторяет на проходе');
    player.stop();
    eq(played[0].stopped >= 1, true, 'stop плеера гасит cue слоя');
    resetStubs();
});

test('audio cue: loop по умолчанию повторяется на каждом проходе', () => {
    const played = audioStub();
    const node = makeNode('rect');
    makeClip('sfx-loop', {
        duration: 200,
        loop: 'loop',
        tracks: [{ type: 'audio', at: 0, resource: 'd.ogg' }],
    });
    const player = makePlayer(node);
    player.play('sfx-loop');
    advancePlayer(player, 150);
    advancePlayer(player, 150);   // второй проход
    truthy(played.length >= 2, 'cue повторяется по циклу');
    player.stop();
    resetStubs();
});

test('audio cue без $.audio падает на $.sound и меняет громкость канала', () => {
    const channel_volume = [];
    ctx.sound = {
        play: () => 3,
        stop: () => {},
        playing: () => true,
        seek: () => true,
    };
    engine.audio = { setChannelVolume: (ch, v) => { channel_volume.push([ch, v]); } };
    const node = makeNode('rect');
    makeClip('sfx-sound', {
        duration: 1000,
        tracks: [{ type: 'audio', at: 0, resource: 'e.ogg', gain: 1,
                   envelope: [{ t: 0, v: 1 }, { t: 1000, v: 0 }] }],
    });
    const player = makePlayer(node);
    player.play('sfx-sound');
    advancePlayer(player, 500);
    truthy(channel_volume.length >= 1);
    eq(channel_volume[channel_volume.length - 1][0], 3);
    near(channel_volume[channel_volume.length - 1][1], 0.5, 1e-6);
    player.stop();
    resetStubs();
});

// --- Method tracks и действия ------------------------------------------------

test('method-дорожка зовёт зарегистрированное действие ровно один раз', () => {
    const calls = [];
    A.action('test.boom', (payload) => { calls.push(payload); });
    const node = makeNode('rect');
    makeClip('method-clip', {
        duration: 300,
        tracks: [{ type: 'method', at: 100, name: 'test.boom', data: { power: 7 } }],
    });
    const node_events = [];
    node.on('test.boom', (p) => { node_events.push([p.name, p.data.data.power]); });
    const player = makePlayer(node);
    player.play('method-clip');
    advancePlayer(player, 50);
    eq(calls.length, 0);
    advancePlayer(player, 100);
    eq(calls.length, 1);
    eq(calls[0].data.power, 7);
    eq(calls[0].at, 100);
    eq(node_events.length, 1, 'узел-корень получил emit под именем действия');
    eq(node_events[0][0], 'test.boom');
    eq(node_events[0][1], 7);
    advancePlayer(player, 100);
    eq(calls.length, 1, 'повторно не вызывается');
    player.stop();
});

test('hit-stop не повторяет damage и не мешает presentation-слою', () => {
    const node = makeNode('rect');
    makeClip('hitstop-clip', {
        duration: 500,
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 1 }] }],
        events: [{ at: 100, name: 'hit', kind: 'damage' }],
    });
    const player = makePlayer(node);
    let hits = 0;
    player.on('hit', () => { hits++; });
    player.play('hitstop-clip');
    ctx.time = { rawDelta: () => 1 / 60, delta: () => 0 };
    for (let i = 0; i < 12; i++) advancePlayer(player, 0);   // hit-stop: dt = 0
    eq(hits, 0, 'на заморозке урон не наносится');
    near(player.total(), 0);
    advancePlayer(player, 150);
    eq(hits, 1, 'после заморозки урон ровно один');
    advancePlayer(player, 200);
    eq(hits, 1, 'повторного урона нет');
    // presentation-плеер продолжает жить на том же нулевом dt
    const fx = makePlayer(node);
    fx.clock('presentation');
    fx.play('hitstop-clip');
    advancePlayer(fx, 0);
    truthy(fx.total() > 0, 'presentation идёт сквозь hit-stop');
    player.stop();
    fx.stop();
    resetStubs();
});

test('незарегистрированное действие не роняет кадр и попадает в журнал', () => {
    const node = makeNode('rect');
    makeClip('method-missing', {
        duration: 100,
        tracks: [{ type: 'method', at: 0, name: 'test.nowhere' }],
    });
    clearLogs();
    const player = makePlayer(node);
    player.play('method-missing');
    advancePlayer(player, 50);
    truthy(logged(/test\.nowhere/), 'сказано, что действие не зарегистрировано');
    player.stop();
});

test('встроенное действие camera.shake зовёт камеру', () => {
    const shakes = [];
    ctx.camera = { shake: (intensity, ms) => { shakes.push([intensity, ms]); } };
    const node = makeNode('rect');
    makeClip('camera-cue', {
        duration: 100,
        tracks: [{ type: 'method', at: 0, name: 'camera.shake', data: { intensity: 6, ms: 120 } }],
    });
    const player = makePlayer(node);
    player.play('camera-cue');
    eq(shakes.length, 1);
    eq(shakes[0][0], 6);
    eq(shakes[0][1], 120);
    player.stop();
    ctx.camera = undefined;
});

// --- Маркеры, окна, завершение ----------------------------------------------

test('маркер окна открывает и закрывает gameplay-окно', () => {
    const node = makeNode('rect');
    makeClip('window-clip', {
        duration: 400,
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 400, v: 1 }] }],
        events: [
            { at: 100, name: 'attack-open', window: 'attack', windowPhase: 'open' },
            { at: 300, name: 'attack-close', window: 'attack', windowPhase: 'close' },
        ],
    });
    const player = makePlayer(node);
    const seen = [];
    player.on('window', (p) => { seen.push([p.window.name, p.window.open]); });
    player.play('window-clip');
    advancePlayer(player, 150);
    truthy(player.window('attack'), 'окно открыто');
    advancePlayer(player, 200);
    falsy(player.window('attack'), 'окно закрыто');
    eq(seen.length, 2);
    player.stop();
});

test('прерывание закрывает окно атаки', () => {
    const node = makeNode('rect');
    makeClip('window-interrupt', {
        duration: 400,
        events: [{ at: 0, name: 'open', window: 'attack', windowPhase: 'open' }],
    });
    const player = makePlayer(node);
    player.play('window-interrupt');
    truthy(player.window('attack'));
    player.interrupt();
    falsy(player.window('attack'));
});

test('loop + policy loop: once — маркер ровно один раз за всё время', () => {
    const node = makeNode('rect');
    makeClip('once-marker', {
        duration: 100,
        loop: 'loop',
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 1 }] }],
        events: [{ at: 50, name: 'boot', policy: { loop: 'once' } }],
    });
    const player = makePlayer(node);
    let hits = 0;
    player.on('boot', () => { hits++; });
    player.play('once-marker');
    advancePlayer(player, 60);
    advancePlayer(player, 100);
    advancePlayer(player, 100);
    eq(hits, 1, 'маркер с loop: once сработал один раз');
    player.stop();
});

test('seek предпросмотра не наносит урон, но пересчитывает состояние', () => {
    const node = makeNode('rect');
    makeClip('damage-clip', {
        duration: 500,
        tracks: [{ type: 'visible', keys: [{ t: 0, v: true }, { t: 400, v: false }] }],
        events: [
            { at: 200, name: 'hit', kind: 'damage' },
            { at: 300, name: 'flash', kind: 'vfx' },
        ],
    });
    const player = makePlayer(node);
    let damage = 0;
    let flash = 0;
    player.on('hit', () => { damage++; });
    player.on('flash', () => { flash++; });
    player.play('damage-clip');
    player.seek(450, { fire: true });
    eq(damage, 0, 'урон на seek не нанесён');
    eq(flash, 1, 'простой vfx-маркер доигран');
    eq(node.visible, false, 'дискретное состояние пересчитано на новой позиции');
    player.stop();
});

test('skip без fire не проигрывает cue, restore — только состояние', () => {
    const played = audioStub();
    const node = makeNode('rect');
    makeClip('skip-clip', {
        duration: 500,
        tracks: [
            { type: 'visible', keys: [{ t: 0, v: true }, { t: 100, v: false }] },
            { type: 'audio', at: 200, resource: 'f.ogg' },
        ],
    });
    const player = makePlayer(node);
    player.play('skip-clip');
    player.skip(300);
    eq(played.length, 0, 'skip не проигрывает звук');
    eq(node.visible, false, 'дискретное состояние пересчитано');
    player.restore(10);
    eq(node.visible, true);
    player.stop();
    resetStubs();
});

test('конец клипа приходит ровно один раз и продолжает flow', () => {
    const node = makeNode('rect');
    makeClip('flow-part', {
        duration: 100,
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 100, v: 0 }] }],
    });
    const player = makePlayer(node);
    let done = 0;
    let ends = 0;
    player.on('finished', () => { done++; });
    player.play('flow-part', { onEnd: () => { ends++; } });
    advancePlayer(player, 150);
    advancePlayer(player, 150);
    eq(done, 1, 'finished один раз');
    eq(ends, 1, 'onEnd один раз');
    falsy(player.playing());
});

test('идемпотентный play-same сохранён, restart сбрасывает время', () => {
    const node = makeNode('rect');
    makeClip('same-clip', {
        duration: 400,
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 400, v: 0 }] }],
    });
    const player = makePlayer(node);
    player.play('same-clip');
    advancePlayer(player, 100);
    const t1 = player.total();
    player.play('same-clip');
    eq(player.total(), t1, 'play-same не сбрасывает часы');
    player.play('same-clip', { restart: true });
    eq(player.total(), 0, 'restart сбрасывает часы');
    player.stop();
});

// --- Сброс/начальная поза ----------------------------------------------------

test('reset задаёт известные значения дорожек', () => {
    const node = makeNode('rect', 50, 60);
    makeClip('reset-clip', {
        duration: 400,
        tracks: [
            { type: 'position', keys: [{ t: 0, v: { x: 0, y: 0 } }, { t: 400, v: { x: 100, y: 0 } }] },
            { type: 'visible', keys: [{ t: 0, v: true }, { t: 200, v: false }] },
            { type: 'light', binding: 'light.intensity', initial: 2, keys: [{ t: 0, v: 0 }] },
        ],
    });
    const player = makePlayer(node);
    player.play('reset-clip');
    advancePlayer(player, 300);
    eq(node.visible, false);
    player.reset();
    near(node.x, 0, 1e-9, 'позиция вернулась к первому ключу');
    near(node.y, 0, 1e-9);
    eq(node.visible, true, 'видимость вернулась к первому ключу');
    near(node.intensity, 2, 1e-9, 'initial перекрывает первый ключ');
    player.stop();
});

test('play с reset применяет начальную позу сразу', () => {
    const node = makeNode('rect');
    node.alpha = 0.1;
    node.visible = false;
    makeClip('reset-on-play', {
        duration: 200,
        tracks: [
            { type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 200, v: 0 }] },
            { type: 'visible', keys: [{ t: 0, v: true }, { t: 200, v: false }] },
        ],
    });
    const player = makePlayer(node);
    player.play('reset-on-play', { reset: true });
    near(node.alpha, 1, 1e-9);
    eq(node.visible, true);
    player.stop();
});

// --- Часы (§6) ---------------------------------------------------------------

test('clock: simulation по умолчанию, presentation читает сырое время', () => {
    const node = makeNode('rect');
    makeClip('clock-clip', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 0 }, { t: 1000, v: 100 }] }],
    });
    const sim = makePlayer(node);
    eq(sim.clock(), 'simulation');
    sim.play('clock-clip');
    advancePlayer(sim, 100);
    near(sim.total(), 100, 1e-9);

    ctx.time = { rawDelta: () => 1 / 60, delta: () => 0 };
    const pres_node = makeNode('rect');
    const pres = makePlayer(pres_node);
    pres.clock('presentation');
    pres.play('clock-clip');
    advancePlayer(pres, 0);       // игровой dt нулевой: пауза/hit-stop
    near(pres.total(), 1000 / 60, 1e-6, 'presentation идёт на паузе');
    eq(sim.clock(), 'simulation');
    sim.stop();
    pres.stop();
    resetStubs();
});

test('clock: клип может запросить presentation, явный выбор игрока важнее', () => {
    const node = makeNode('rect');
    makeClip('clock-spec', {
        duration: 100,
        clock: 'presentation',
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 0 }, { t: 100, v: 1 }] }],
    });
    const player = makePlayer(node);
    player.play('clock-spec');
    eq(player.clock(), 'presentation');
    player.stop();
    player.clock('simulation');
    player.play('clock-spec');
    eq(player.clock(), 'simulation', 'явный clock игрока не перетирается клипом');
    player.stop();
});

test('tickAnimPlayer тикает presentation-плееры при нулевом dt', () => {
    A.stopAll();
    const node = makeNode('rect');
    makeClip('clock-tick', {
        duration: 1000,
        loop: 'loop',
        tracks: [{ type: 'alpha', keys: [{ t: 0, v: 0 }, { t: 1000, v: 100 }] }],
    });
    ctx.time = { rawDelta: () => 1 / 60, delta: () => 0 };
    const player = makePlayer(node);
    player.clock('presentation');
    player.play('clock-tick');
    tickAnimPlayer(0);
    truthy(player.total() > 0, 'часы сдвинулись без игрового dt');
    player.stop();
    resetStubs();
});

test('playerStepMs: presentation без $.time падает на переданный dt', () => {
    const node = makeNode('rect');
    const player = makePlayer(node);
    player.clock('presentation');
    eq(playerStepMs(player, 16), 16);
    eq(playerStepMs(makePlayer(node), 16), 16);
});

// --- JSON, микширование мультицелей, чистые функции ---------------------------

test('сериализованный JSON воспроизводится без ручных frame-callback', () => {
    const json = JSON.stringify({
        clips: {
            'json-attack': {
                duration: 300,
                tracks: [
                    { type: 'alpha', keys: [{ t: 0, v: 1 }, { t: 300, v: 0 }] },
                    { type: 'method', at: 100, name: 'test.boom', data: { from: 'json' } },
                    { type: 'audio', at: 0, resource: 'json.ogg', gain: 0.4 },
                ],
                events: [{ at: 200, name: 'json-hit' }],
            },
        },
    });
    const calls = [];
    A.action('test.boom', (p) => { calls.push(p.data.from); });
    const played = audioStub();
    clearLogs();
    A.load(json);
    truthy(A.clips().indexOf('json-attack') >= 0);
    const node = makeNode('rect');
    const player = makePlayer(node);
    let hit = 0;
    player.on('json-hit', () => { hit++; });
    player.play('json-attack');
    advancePlayer(player, 250);
    eq(hit, 1, 'маркер из JSON сработал');
    eq(calls.length, 1, 'method из JSON вызван');
    eq(calls[0], 'json');
    eq(played.length, 1, 'audio cue из JSON запущен');
    near(node.alpha, 1 - 250 / 300, 1e-6);
    player.stop();
    resetStubs();
});

test('blendTrackEntries смешивает непрерывные и выбирает дискретные', () => {
    const merged = blendTrackEntries([
        { id: 'a', value: 0, weight: 1 },
        { id: 'a', value: 100, weight: 1 },
        { id: 'v', value: true, weight: 0.4 },
        { id: 'v', value: false, weight: 0.6 },
    ], new Set(['v']));
    near(merged.get('a').value, 50);
    eq(merged.get('v').value, false, 'дискретное — у большего веса');
});

test('два клипа управляют одной целью: веса складываются', () => {
    const hero = makeNode('rect');
    const weapon = makeNode('rect');
    weapon.id = 'weapon';
    attach(hero, weapon);
    makeClip('pose-a', {
        duration: 1000,
        tracks: [{ type: 'rotation', target: 'weapon', keys: [{ t: 0, v: 0 }, { t: 1000, v: 0 }] }],
    });
    makeClip('pose-b', {
        duration: 1000,
        tracks: [{ type: 'rotation', target: 'weapon', keys: [{ t: 0, v: 2 }, { t: 1000, v: 2 }] }],
    });
    const player = makePlayer(hero);
    player.play('pose-a', { slot: 'a', weight: 0.25 });
    player.play('pose-b', { slot: 'b', weight: 0.75 });
    advancePlayer(player, 100);
    near(weapon.angle, 1.5, 1e-6, '0.25×0 + 0.75×2');
    player.stop();
});

test('timelineTrackValuesAt и trackValueAt: id дорожек и значения', () => {
    const tl = normalizeTimeline('pure-values', {
        duration: 100,
        tracks: [
            { type: 'position', target: 'gun', keys: [{ t: 0, v: { x: 0, y: 0 } }, { t: 100, v: { x: 10, y: 0 } }] },
            { type: 'sprite', keys: [{ t: 0, v: 0 }, { t: 100, v: 3 }] },
        ],
    });
    const list = timelineTrackValuesAt(tl, 50, 4);
    eq(list.length, 2);
    eq(list[0].id, 'transform.position@gun');
    near(list[0].value.x, 5);
    eq(list[1].id, 'sprite');
    eq(list[1].value.frame, 2);
    eq(trackValueAt(tl.tracks[1], 100, 4).frame, 3);
    eq(initialTrackValue(tl.tracks[1]).frame, 0);
});

test('boolOf и sameValue: значения ключей и режим change', () => {
    eq(boolOf(true), true);
    eq(boolOf(0), false);
    eq(boolOf('false'), false);
    eq(boolOf('run'), true);
    truthy(sameValue({ x: 1, y: 2 }, { x: 1, y: 2 }));
    falsy(sameValue({ x: 1 }, { x: 2 }));
    falsy(sameValue(1, 2));
});

test('custom binding через $.anim.bind применяется к узлу', () => {
    const seen = [];
    A.bind('test.flash', {
        resolve: (root) => (root ? { node: root } : null),
        apply: (handle, value) => { seen.push([handle.node.id, value]); handle.node.alpha = value; },
    });
    const node = makeNode('rect');
    makeClip('custom-binding', {
        duration: 100,
        tracks: [{ type: 'bool', binding: 'test.flash', keys: [{ t: 0, v: 0 }, { t: 100, v: 1 }] }],
    });
    const player = makePlayer(node);
    player.play('custom-binding');
    advancePlayer(player, 50);
    eq(seen.length, 2, 'нулевой кадр и кадр после шага');
    near(node.alpha, 0.5, 1e-9);
    player.stop();
});

test('unknown binding дорожки пропускается с записью в журнал', () => {
    const node = makeNode('rect');
    clearLogs();
    makeClip('bad-binding', {
        duration: 100,
        tracks: [{ type: 'bool', binding: 'test.nope', keys: [{ t: 0, v: true }] }],
    });
    const player = makePlayer(node);
    player.play('bad-binding');
    truthy(logged(/неизвестный binding "test\.nope"/));
    player.stop();
});

test('нормализация policy: явные фазы и defaults', () => {
    const p = normalizePolicy({ seek: 'fire', loop: 'once' }, null);
    eq(p.explicit, true);
    eq(p.seek, 'fire');
    eq(p.loop, 'once');
    eq(p.skip, 'skip');
    const d = normalizePolicy(null, null);
    eq(d.explicit, false);
    eq(d.loop, 'fire');
    eq(d.restore, 'skip');
});

test('getBinding отдаёт встроенный адаптер, bindingNames содержит минимум §41', () => {
    const names = bindingNames();
    for (const name of ['transform', 'visible', 'sprite.frame', 'sprite.clip',
        'emitter.emitting', 'emitter.position', 'shape.enabled',
        'light.intensity', 'light.radius', 'ui.style', 'ui.value', 'audio.gain',
        'value', 'attr']) {
        truthy(names.indexOf(name) >= 0, 'нет binding ' + name);
    }
    eq(getBinding('shape.enabled').kind, 'discrete');
    eq(getBinding('light.intensity').kind, 'continuous');
    eq(getBinding('value').kind, 'store');
});

test('sprite.clip выбирает именованный клип anim.js', () => {
    A.define('recoil', { duration: 100, tracks: [] });
    const node = makeNode('sprite');
    makeClip('clip-select', {
        duration: 200,
        tracks: [{ type: 'sprite', clip: true, keys: [{ t: 0, v: 'recoil' }] }],
    });
    const player = makePlayer(node);
    player.play('clip-select');
    advancePlayer(player, 50);
    eq(node.__clip && node.__clip.name, 'recoil');
    player.stop();
});

test('значения мультицелевых дорожек видны в player.values() под своим id', () => {
    const hero = makeNode('rect');
    const weapon = makeNode('rect');
    weapon.id = 'weapon';
    attach(hero, weapon);
    makeClip('values-ids', {
        duration: 100,
        tracks: [
            { type: 'alpha', keys: [{ t: 0, v: 1 }] },
            { type: 'visible', target: 'weapon', keys: [{ t: 0, v: true }] },
        ],
    });
    const player = makePlayer(hero);
    player.play('values-ids');
    advancePlayer(player, 20);
    near(player.value('alpha'), 1, 1e-9);
    eq(player.values()['visible@weapon'], true, 'дискретное видно по id дорожки');
    eq(player.value('visible@weapon'), true);
    player.stop();
});

ctx.log = real_log;
resetStubs();
finish();
