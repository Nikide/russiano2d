// ===========================================================================
// Юнит-тесты звука (qjs + tests/js/_harness.mjs).
//
// Регрессия: sound.mute(true) не запоминал текущую громкость, поэтому
// mute(false) всегда выставлял ровно 1.0 — выставленный игроком уровень
// (sound.volume(0.4)) терялся при любом приглушении.
//
// Запуск:
//   build/_deps/quickjs-build/qjs tests/js/sound_test.mjs
// ===========================================================================

import { test, eq, near, truthy, falsy, finish } from './_harness.mjs';
import { installSound } from '../../src/highlevel/sound.js';

// Мок аудио: хранит мастер-громкость, считает загрузки и проигрывания.
let master = 1;
const played = [];
const pitches = [];
engine.audio = {
    getMasterVolume: () => master,
    setMasterVolume: (v) => { master = v; },
    load: (path) => (path === 'нет.wav' ? -1 : 7),
    play: (id, volume, pan, loop) => { played.push({ id, volume, pan, loop }); return 1; },
    setChannelPitch: (channel, ratio) => { pitches.push({ channel, ratio }); },
    music: () => {}, stopMusic: () => {}, pauseMusic: () => {}, musicPlaying: () => false,
    setMusicPitch: () => {},
    stopAll: () => {}, stop: () => {}, playing: () => false, activeChannels: () => 0,
    duration: () => 0, count: () => 1,
};

const $ = {};
const sound = installSound($);

test('mute(true) глушит, mute(false) возвращает прежнюю громкость', () => {
    sound.volume(0.42);
    near(master, 0.42, 1e-6, 'громкость выставлена');
    sound.mute(true);
    near(master, 0, 1e-6, 'приглушено');
    truthy(sound.mute(), 'mute() без аргумента читает состояние');
    sound.mute(false);
    near(master, 0.42, 1e-6, 'вернулась именно прежняя громкость, а не 1.0');
    falsy(sound.mute(), 'после снятия mute состояние false');
});

test('повторный mute(true) не портит запомненную громкость', () => {
    sound.volume(0.7);
    sound.mute(true);
    sound.mute(true);
    sound.mute(false);
    near(master, 0.7, 1e-6, 'двойной mute не сбрасывает уровень');
});

test('mute(false) без предшествующего mute не роняет звук в ноль', () => {
    sound.mute(false);
    truthy(master > 0, 'громкость осталась слышимой');
});

test('play() передаёт громкость и панораму в движок', () => {
    played.length = 0;
    sound.play('hit.wav', { volume: 0.25, pan: -1, loop: true });
    eq(played.length, 1, 'один вызов play');
    near(played[0].volume, 0.25, 1e-6);
    near(played[0].pan, -1, 1e-6);
    eq(played[0].loop, 1, 'loop превращается в 1');
});

test('play() несуществующего файла возвращает -1, а не падает', () => {
    eq(sound.play('нет.wav'), -1);
});

test('play() передаёт pitch и сбрасывает его, когда параметра нет', () => {
    pitches.length = 0;
    sound.play('hit.wav', { pitch: 1.5 });
    eq(pitches.length, 1, 'pitch применён к каналу');
    near(pitches[0].ratio, 1.5, 1e-6);

    pitches.length = 0;
    sound.play('hit.wav');
    near(pitches[0].ratio, 1, 1e-6, 'без pitch канал возвращается к 1.0, а не наследует чужой');
});

finish();
