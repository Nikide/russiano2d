// Фикстура теста аудио-шин (tests/agent/highlevel_audiobus_test.py).
//
// Строит маленькое дерево шин и публикует отчёт для агента. Звук может быть
// выключен в сборке — тест не требует реального устройства, только чтобы
// $.audio работал как логика и не бросал исключений.
$.ready(() => {
    $.world.color('#101820').bounds(0, 0, 640, 360);

    $.audio.bus('music', { volume: 0.5 });
    $.audio.bus('ui', { volume: 0.5, parent: 'music' });
    $.audio.bus('ambient', { volume: 0.25, effect: 'lowpass', effectParams: { freq: 900 } });
    $.audio.listener(0, 0);
});

// Отчёт собирается в одном месте: так тесту не приходится знать детали игры.
globalThis.audiobusReport = () => {
    const buses = $.audio.buses();
    const names = buses.map((b) => b.name).sort();
    return {
        names: names,
        music: $.audio.volume('music'),
        ui: $.audio.volume('ui'),
        ui_gain: $.audio.gain('ui'),
        music_gain: $.audio.gain('music'),
        ambient_gain: $.audio.gain('ambient'),
        ui_muted: $.audio.mute('ui'),
        ambient_effect: $.audio.effect('ambient'),
        effects: $.audio.effects(),
        handles: $.audio.handles().length,
        listener: $.audio.listener(),
    };
};
