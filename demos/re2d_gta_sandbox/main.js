// ===========================================================================
// GTA-подобный top-down sandbox для Russiano2D.
//
// Два сценария:
//   city    — Re2D World: улицы/тротуары/трава/здания с surface tags,
//             top-down камера, машины, пешеходы, столкновения, урон, миссия.
//   plain2d — тот же транспорт/персонаж/оружие без Re2D (обычные узлы + Box2D).
//
// Вся игровая логика — публичный `$` API и JS-сэмплы из ./lib. Никакого
// engine.*, ECS, второго scene graph или 3D.
// ===========================================================================
'use strict';

const SCENES = [
    './scene_city.js',
    './scene_plain.js',
];

$.ready(async ($) => {
    $.gfx.color('#101216');
    $.sound.volume(0.7);
    for (const path of SCENES) {
        try {
            const module = await import(path);
            if (typeof module.default === 'function') module.default($);
            else $.log(`sandbox ${path}: нет экспорта install($) — пропускаю`);
        } catch (error) {
            $.log(`sandbox ${path} не загрузился: ${error}`);
        }
    }
    const start = $.startScene || 're2d_gta_sandbox_city';
    if ($.scene.has(start)) $.scene.load(start, { transition: 'none' });
    else $.log(`sandbox: сцена "${start}" не зарегистрирована`);
});
