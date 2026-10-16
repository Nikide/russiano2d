// ===========================================================================
// Пример §31-4 Спецификации: «Generated rooms».
//
// Самостоятельный проект движка: `--game demos/roguerooms`. Кроме `$` ничего
// не импортируется. Проверка — tests/agent/roguerooms_test.py.
// ===========================================================================

import install from './index.js';

$.ready(($) => {
    $.gfx.color('#0b1017');
    install($);
    $.scene.load('roguerooms', { transition: 'none' });
});
