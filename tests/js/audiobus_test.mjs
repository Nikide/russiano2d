// ===========================================================================
// Юнит-тесты аудио-шин ($.audio) без движка.
//
// Проверяем то, что не требует реального микшера: чистые функции effectiveGain
// и panAndGain, жизненный цикл handle'ов (нет утечек) и пересчёт громкости
// каналов при смене шины. Микшер подменяется фейком globalThis.engine.audio.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/audiobus_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { installAudiobus, tickAudiobus, effectiveGain, panAndGain }
    from '../../src/highlevel/audiobus.js';
import { tickTweens } from '../../src/highlevel/tween.js';

// ---------------------------------------------------------------------------
// Фейковый микшер: каналы-записи, которые реально помнят громкость и эффект
// ---------------------------------------------------------------------------

let next_channel = 0;
let master = 1;
const tracks = new Map();

globalThis.engine.audio = {
    load() { return 1; },
    play(id, volume, pan, loops) {
        const ch = next_channel++;
        tracks.set(ch, { volume: volume, pan: pan, loops: loops, effect: 'none', params: [] });
        return ch;
    },
    stop(ch) { tracks.delete(ch); },
    stopAll() { tracks.clear(); },
    playing(ch) { return tracks.has(ch); },
    activeChannels() { return tracks.size; },
    setChannelVolume(ch, v) { const t = tracks.get(ch); if (t) t.volume = v; },
    channelVolume(ch) { const t = tracks.get(ch); return t ? t.volume : 0; },
    setChannelPan(ch, p) { const t = tracks.get(ch); if (t) t.pan = p; },
    channelPan(ch) { const t = tracks.get(ch); return t ? t.pan : 0; },
    setChannelEffect(ch, kind, p1, p2) {
        const t = tracks.get(ch);
        if (t) { t.effect = kind; t.params = [p1, p2]; }
        return true;
    },
    channelEffect(ch) { const t = tracks.get(ch); return t ? t.effect : 'none'; },
    effectCount() { return 3; },
    effectName(i) { return ['none', 'lowpass', 'echo'][i]; },
    getMasterVolume() { return master; },
    setMasterVolume(v) { master = v; },
    setSfxVolume() {},
    setMusicVolume() {},
};

/** Минимальный $: installAudiobus нужен только $.sound. */
function makeApi(playImpl) {
    const api = {
        sound: {
            play(what, opts) {
                const o = opts || {};
                if (playImpl) return playImpl(what, o);
                return globalThis.engine.audio.play(1, o.volume, o.pan, o.loop ? 1 : 0);
            },
            volume(v) {
                if (v === undefined) return globalThis.engine.audio.getMasterVolume();
                globalThis.engine.audio.setMasterVolume(v);
                return api.sound;
            },
            stopAll(ms) { globalThis.engine.audio.stopAll(ms); },
            sfxVolume() {},
            musicVolume() {},
        },
    };
    return api;
}

function fresh($) {
    installAudiobus($);
    tracks.clear();
    return $.audio;
}

// ---------------------------------------------------------------------------
// effectiveGain: цепочка родителей, mute, solo
// ---------------------------------------------------------------------------

test('effectiveGain перемножает громкости по цепочке родителей', () => {
    const map = new Map([
        ['master', { volume: 0.5, muted: false, solo: false, parent: null }],
        ['music', { volume: 0.5, muted: false, solo: false, parent: 'master' }],
        ['ui', { volume: 0.5, muted: false, solo: false, parent: 'music' }],
    ]);
    near(effectiveGain(map, 'ui'), 0.125);
    near(effectiveGain(map, 'music'), 0.25);
    near(effectiveGain(map, 'master'), 0.5);
});

test('effectiveGain без шины master считает её единицей', () => {
    const buses = { music: { volume: 0.5, parent: 'master' }, ui: { volume: 0.5, parent: 'music' } };
    near(effectiveGain(buses, 'ui'), 0.25);
    near(effectiveGain(buses, 'unknown'), 1);
});

test('mute глушит шину и всех её потомков', () => {
    const buses = { music: { volume: 0.5, muted: true, parent: 'master' }, ui: { volume: 0.5, parent: 'music' } };
    eq(effectiveGain(buses, 'music'), 0);
    eq(effectiveGain(buses, 'ui'), 0);
    buses.music.muted = false;
    near(effectiveGain(buses, 'ui'), 0.25);
});

test('solo оставляет слышимыми solo-шину, её потомков и предков', () => {
    const buses = {
        group: { volume: 1, parent: 'master' },
        music: { volume: 1, parent: 'group', solo: true },
        ui: { volume: 0.5, parent: 'music' },
        ambient: { volume: 0.5, parent: 'master' },
    };
    near(effectiveGain(buses, 'music'), 1);
    near(effectiveGain(buses, 'ui'), 0.5);      // потомок solo слышен
    near(effectiveGain(buses, 'group'), 1);     // предок solo слышен (путь к мастеру)
    eq(effectiveGain(buses, 'ambient'), 0);     // посторонняя шина заглушена
});

test('цикл родителей не вешает расчёт', () => {
    const buses = { a: { volume: 0.5, parent: 'b' }, b: { volume: 0.5, parent: 'a' } };
    truthy(effectiveGain(buses, 'a') >= 0);
});

// ---------------------------------------------------------------------------
// panAndGain: затухание и панорама
// ---------------------------------------------------------------------------

test('panAndGain даёт полную громкость у слушателя', () => {
    const pg = panAndGain({ x: 0, y: 0 }, { x: 0, y: 0 }, { max: 700 });
    near(pg.gain, 1);
    near(pg.pan, 0);
});

test('panAndGain затухает линейно с расстоянием', () => {
    const pg = panAndGain({ x: 0, y: 0 }, { x: 0, y: 350 }, { max: 700 });
    near(pg.gain, 0.5);
    near(pg.dist, 350);
    near(pg.pan, 0);
});

test('panAndGain разводит источник влево и вправо', () => {
    const right = panAndGain({ x: 0, y: 0 }, { x: 350, y: 0 }, { max: 700 });
    near(right.pan, 1);
    const left = panAndGain({ x: 0, y: 0 }, { x: -350, y: 0 }, { max: 700 });
    near(left.pan, -1);
});

test('panAndGain за границей слышимости даёт тишину', () => {
    eq(panAndGain({ x: 0, y: 0 }, { x: 0, y: 800 }, { max: 700 }).gain, 0);
    eq(panAndGain({ x: 0, y: 0 }, { x: 800, y: 0 }, 700).gain, 0);
});

// ---------------------------------------------------------------------------
// Пространство имён и жизненный цикл handle'ов
// ---------------------------------------------------------------------------

test('installAudiobus создаёт весь обязательный API', () => {
    const A = fresh(makeApi());
    for (const name of ['bus', 'buses', 'remove', 'clear', 'volume', 'mute', 'solo',
                        'effect', 'effects', 'play', 'playAt', 'listener',
                        'handles', 'stopBus', 'stopAll', 'masterVolume',
                        'sfxVolume', 'musicVolume', 'fadeBus', 'fadeHandle']) {
        eq(typeof A[name], 'function', 'нет $.audio.' + name);
    }
});

test('play без шины маршрутизируется в sfx', () => {
    const A = fresh(makeApi());
    const h = A.play('tone.ogg');
    eq(h.bus, 'sfx');
    truthy(h.channel >= 0);
    h.stop();
});

test('громкость handle = личная × эффективная громкость шины', () => {
    const A = fresh(makeApi());
    A.bus('music', { volume: 0.5 });
    const h = A.play('tone.ogg', { bus: 'music', volume: 0.8 });
    near(globalThis.engine.audio.channelVolume(h.channel), 0.4);
    A.volume('music', 0.25);
    near(globalThis.engine.audio.channelVolume(h.channel), 0.2);
    h.volume(1);
    near(globalThis.engine.audio.channelVolume(h.channel), 0.25);
    h.stop();
});

test('mute шины мгновенно обнуляет громкость живого канала', () => {
    const A = fresh(makeApi());
    A.bus('music', { volume: 1 });
    const h = A.play('tone.ogg', { bus: 'music', volume: 0.8 });
    A.mute('music', true);
    near(globalThis.engine.audio.channelVolume(h.channel), 0);
    A.mute('music', false);
    near(globalThis.engine.audio.channelVolume(h.channel), 0.8);
    h.stop();
});

test('stop убирает handle из списка — утечки нет', () => {
    const A = fresh(makeApi());
    const a = A.play('one.ogg');
    const b = A.play('two.ogg');
    eq(A.handles().length, 2);
    a.stop();
    eq(A.handles().length, 1);
    b.stop(120);
    eq(A.handles().length, 0);
    eq(globalThis.engine.audio.activeChannels(), 0);
});

test('доигранный движком звук вычищается из handles по тику', () => {
    const A = fresh(makeApi());
    const h = A.play('one.ogg');
    eq(A.handles().length, 1);
    globalThis.engine.audio.stop(h.channel);   // движок освободил канал сам
    tickAudiobus(0.016);
    eq(A.handles().length, 0);
});

test('stopBus гасит звуки шины и её потомков', () => {
    const A = fresh(makeApi());
    A.bus('music', { volume: 1 });
    A.bus('ui', { volume: 1, parent: 'music' });
    A.bus('other', { volume: 1 });
    A.play('m.ogg', { bus: 'music' });
    A.play('u.ogg', { bus: 'ui' });
    A.play('o.ogg', { bus: 'other' });
    eq(A.handles().length, 3);
    A.stopBus('music', 0);
    eq(A.handles().length, 1);
    eq(A.handles()[0].bus, 'other');
    A.stopAll(0);
    eq(A.handles().length, 0);
});

test('remove шины переподчиняет детей и пересчитывает громкость', () => {
    const A = fresh(makeApi());
    A.bus('group', { volume: 0.5 });
    A.bus('child', { volume: 0.5, parent: 'group' });
    const h = A.play('c.ogg', { bus: 'child', volume: 1 });
    near(globalThis.engine.audio.channelVolume(h.channel), 0.25);
    A.remove('group');
    near(globalThis.engine.audio.channelVolume(h.channel), 0.5);  // child ушёл к master
    h.stop();
});

test('clear снимает шины и останавливает звуки', () => {
    const A = fresh(makeApi());
    A.bus('music', { volume: 0.5 });
    A.play('m.ogg', { bus: 'music' });
    A.clear();
    eq(A.buses().length, 0);
    eq(A.handles().length, 0);
});

// ---------------------------------------------------------------------------
// Эффекты
// ---------------------------------------------------------------------------

test('effects() отдаёт список из движка', () => {
    const A = fresh(makeApi());
    const names = A.effects().join(',');
    eq(names, 'none,lowpass,echo');
});

test('эффект шины накладывается на её живые каналы', () => {
    const A = fresh(makeApi());
    A.bus('echoBus', { effect: 'echo', effectParams: { delay: 120, feedback: 0.4 } });
    const h = A.play('e.ogg', { bus: 'echoBus' });
    eq(globalThis.engine.audio.channelEffect(h.channel), 'echo');
    A.effect('echoBus', 'lowpass', { freq: 900 });
    eq(globalThis.engine.audio.channelEffect(h.channel), 'lowpass');
    h.effect('none');
    eq(globalThis.engine.audio.channelEffect(h.channel), 'none');
    A.effect('echoBus', 'echo', { delay: 50 });   // личный эффект handle не перебиваем
    eq(globalThis.engine.audio.channelEffect(h.channel), 'none');
    h.stop();
});

// ---------------------------------------------------------------------------
// Позиционное звучание и слушатель
// ---------------------------------------------------------------------------

test('playAt считает панораму и затухание от слушателя', () => {
    const A = fresh(makeApi());
    A.listener(0, 0);
    const h = A.playAt('p.ogg', 350, 0, { volume: 1, falloff: { max: 700 } });
    near(h.pan(), 1);
    near(h.volume(), 0.5);
    h.stop();

    const far = A.playAt('p.ogg', 0, 900, { volume: 1, falloff: { max: 700 } });
    near(far.volume(), 0);
    far.stop();
});

test('play с opts.at ведёт себя как playAt', () => {
    const A = fresh(makeApi());
    A.listener(0, 0);
    const h = A.play('p.ogg', { at: [-350, 0], volume: 1, falloff: { max: 700 } });
    near(h.pan(), -1);
    near(h.volume(), 0.5);
    h.stop();
});

// ---------------------------------------------------------------------------
// Прокси к $.sound и затухания
// ---------------------------------------------------------------------------

test('masterVolume проксирует общую громкость', () => {
    const A = fresh(makeApi());
    A.masterVolume(0.3);
    near(A.masterVolume(), 0.3);
    near(globalThis.engine.audio.getMasterVolume(), 0.3);
});

test('fadeBus меняет громкость шины постепенно', () => {
    const A = fresh(makeApi());
    A.bus('music', { volume: 1 });
    A.fadeBus('music', 0, 200);
    tickTweens(1 / 60);
    tickAudiobus(1 / 60);
    const mid = A.volume('music');
    truthy(mid < 1 && mid > 0, 'громкость ещё не ноль');
    for (let i = 0; i < 40; i++) { tickTweens(1 / 60); tickAudiobus(1 / 60); }
    near(A.volume('music'), 0, 1e-6);
});

test('fadeBus с нулевой длительностью применяется сразу', () => {
    const A = fresh(makeApi());
    A.bus('music', { volume: 1 });
    A.fadeBus('music', 0.25, 0);
    near(A.volume('music'), 0.25);
});

test('переиспользованный движком канал не оставляет двойной handle', () => {
    const $ = makeApi((what, o) => {
        tracks.set(5, { volume: o.volume, pan: o.pan, effect: 'none', params: [] });
        return 5;
    });
    const A = fresh($);
    const a = A.play('one.ogg');
    const b = A.play('two.ogg');
    eq(A.handles().length, 1, 'старый handle с тем же каналом снят');
    eq(A.handles()[0], b);
    a.stop();
    eq(A.handles().length, 1, 'stop старого handle не задел новый');
    b.stop();
    eq(A.handles().length, 0);
});

// ---------------------------------------------------------------------------
// Настоящие шины: группы микшера и 3D-позиция
// ---------------------------------------------------------------------------

/** Добавляет моку методы групп/3D — как у движка с MIX_CreateGroup. */
function addGroupApi() {
    const groups = new Map();
    let next_group = 1;
    const assigned = new Map();
    const spatial = new Map();
    globalThis.engine.audio.group = (name) => {
        if (!groups.has(name)) groups.set(name, next_group++);
        return groups.get(name);
    };
    globalThis.engine.audio.groupCount = () => groups.size;
    globalThis.engine.audio.setChannelGroup = (ch, g) => { assigned.set(ch, g); return true; };
    globalThis.engine.audio.setGroupEffect = (g, kind, p1, p2) => { groups.set('fx:' + g, { kind, p1, p2 }); return true; };
    globalThis.engine.audio.groupEffect = (g) => { const r = groups.get('fx:' + g); return r ? r.kind : 'none'; };
    globalThis.engine.audio.setChannel3D = (ch, x, y, z, on) => { spatial.set(ch, { x, y, z, on }); return true; };
    return { groups, assigned, spatial };
}

function removeGroupApi() {
    for (const name of ['group', 'groupCount', 'setChannelGroup', 'setGroupEffect',
                        'groupEffect', 'setChannel3D']) {
        delete globalThis.engine.audio[name];
    }
}

test('шина создаёт группу микшера и приписывает канал к ней', () => {
    const raw = addGroupApi();
    const A = fresh(makeApi());
    A.bus('reverbbus', { volume: 1 });
    const h = A.play('x.ogg', { bus: 'reverbbus' });
    const g = raw.groups.get('reverbbus');
    truthy(g !== undefined, 'группа создана в движке');
    eq(raw.assigned.get(h.channel), g, 'канал приписан к группе шины');
    h.stop();
    removeGroupApi();
});

test('эффект шины уходит на пост-микс группы, а не на канал', () => {
    const raw = addGroupApi();
    const A = fresh(makeApi());
    A.bus('echobus', { volume: 1 });
    A.effect('echobus', 'lowpass', { freq: 800 });
    const g = raw.groups.get('echobus');
    eq(raw.groups.get('fx:' + g).kind, 'lowpass', 'эффект поставлен группе');

    const h = A.play('y.ogg', { bus: 'echobus' });
    eq(globalThis.engine.audio.channelEffect(h.channel), 'none',
       'на канале эффекта нет — иначе обработка была бы двойной');
    h.stop();
    removeGroupApi();
});

test('личный эффект handle всё равно живёт на канале', () => {
    addGroupApi();
    const A = fresh(makeApi());
    A.bus('bus2', { volume: 1 });
    const h = A.play('z.ogg', { bus: 'bus2' });
    h.effect('echo', { delay: 90 });
    eq(globalThis.engine.audio.channelEffect(h.channel), 'echo');
    h.stop();
    removeGroupApi();
});

test('без групп в движке эффект шины остаётся на каналах (запасной путь)', () => {
    const A = fresh(makeApi());
    A.bus('bus3', { volume: 1 });
    const h = A.play('w.ogg', { bus: 'bus3' });
    A.effect('bus3', 'echo');
    eq(globalThis.engine.audio.channelEffect(h.channel), 'echo');
    h.stop();
});

test('spatial("sdl"): playAt отдаёт координаты относительно слушателя', () => {
    const raw = addGroupApi();
    const A = fresh(makeApi());
    A.listener(100, 50);
    A.spatial('sdl');
    eq(A.spatial(), 'sdl', 'режим читается');

    const h = A.playAt('p.ogg', 400, -50, { volume: 1 });
    const p = raw.spatial.get(h.channel);
    truthy(p && p.on, 'для канала включён 3D');
    eq(p.x, 300, 'x относительно слушателя');
    eq(p.y, 0, 'плоскость карты лежит в X/Z');
    eq(p.z, -100, 'y мира уходит в z');
    h.stop();

    A.spatial('js');
    eq(A.spatial(), 'js');
    removeGroupApi();
});

test('spatial: неизвестный режим не меняет текущий', () => {
    addGroupApi();
    const A = fresh(makeApi());
    A.spatial('sdl');
    A.spatial('чепуха');
    eq(A.spatial(), 'sdl');
    A.spatial('js');
    removeGroupApi();
});

// ---------------------------------------------------------------------------
// Деградация без звука в сборке
// ---------------------------------------------------------------------------

test('при мертвом звуке play возвращает handle с channel = -1', () => {
    const $ = makeApi(() => -1);
    const A = fresh($);
    const h = A.play('missing.ogg', { bus: 'music' });
    eq(h.channel, -1);
    eq(h.bus, 'music');
    eq(h.playing(), false);
    h.stop();                       // не должно бросать
    eq(A.handles().length, 0);
});

test('$.audio.play не бросает, если $.sound сломан', () => {
    const $ = { sound: { play() { throw new Error('нет микшера'); } } };
    const A = fresh($);
    const h = A.play('x.ogg');
    eq(h.channel, -1);
    h.stop();
});

finish();
