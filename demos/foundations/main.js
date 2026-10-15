// ===========================================================================
// Пример §31-1 Спецификации: «Platform foundations».
//
// Самостоятельный проект движка: `--game demos/foundations`. Кроме `$` ничего
// не импортируется. Проверка — tests/agent/foundations_test.py.
// ===========================================================================

import install from './index.js';

$.ready(($) => {
    $.gfx.color('#121826');
    install($);
    $.scene.load('foundations', { transition: 'none' });
});
