// ===========================================================================
// Демо-проект Russiano2D.
//
// Точка входа: подключает модули демо и открывает меню-лаунчер. Каждый модуль
// демо экспортирует install($) и регистрирует свою сцену; всё остальное (мир,
// камера, звук, сохранения, отладка) уже есть в $.
//
// Запуск:
//   ./build/russiano2d --game demos
//   ./build/russiano2d --game demos --scene shooter25d
//
// Добавить своё демо: положить demos/имя/index.js с экспортом install($)
// и дописать строку в MODULES — кнопка в меню появится сама.
//
// Импорт динамический и через try: одно сломанное демо не должно лишать
// пользователя остальных — в меню просто не появится его кнопка, а причина
// уйдёт в журнал.
// ===========================================================================

const MODULES = [
    './launcher.js',
    './platformer/index.js',
    './shooter25d/index.js',
    './gallery/index.js',
    './arena/index.js',
    './physics/index.js',
    './bsp/index.js',
    './light/index.js',
];

$.ready(async ($) => {
    // Общие настройки демо-проекта.
    $.gfx.color('#0e1420');
    $.sound.volume(0.8);
    $.scene.transition('fade', 250);

    for (const path of MODULES) {
        try {
            const module = await import(path);
            if (typeof module.default !== 'function') {
                $.log(`демо ${path}: нет экспорта install($) — пропускаю`);
                continue;
            }
            module.default($);
        } catch (e) {
            $.log(`демо ${path} не загрузилось: ${e}`);
        }
    }

    // --scene <имя> открывает демо сразу, минуя меню (нужно тестам и агенту).
    const start = engine.startScene || 'launcher';
    if (!$.scene.has(start)) {
        $.log(`сцена "${start}" не зарегистрирована — открываю меню`);
        $.scene.load('launcher', { transition: 'none' });
        return;
    }
    $.scene.load(start, { transition: 'none' });
});
