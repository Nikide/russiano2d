// ===========================================================================
// Игра по умолчанию: меню и платформер на высокоуровневом API $.
//
// Запуск:
//   ./build/russiano2d                 # эта игра
//   ./build/russiano2d --scene platformer   # сразу уровень
//
// Движок вызывает экспортированные onUpdate/onRender только если игра их
// экспортирует. Здесь их нет: кадром управляет сам $ (см. $.ready/$.update).
// ===========================================================================

import installMenu from './scenes/menu.js';
import installLevel from './scenes/platformer.js';

$.ready(($) => {
    $.gfx.color('#141824');          // фон кадра
    $.sound.volume(0.8);
    $.scene.transition('fade', 220);

    installMenu($);
    installLevel($);

    // Прогресс сохраняется на диск между запусками.
    $.store.file('save.json').load();
    $.store.autoSave(30000);

    $.scene.load(engine.startScene === 'platformer' ? 'platformer' : 'menu',
                 { transition: 'none' });
});
