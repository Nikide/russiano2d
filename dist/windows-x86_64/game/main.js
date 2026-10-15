// ===========================================================================
// Игра по умолчанию: 2D-платформер «Руссиано 2D» — кампания из трёх уровней.
//
// Запуск:
//   ./build/russiano2d                      # эта игра (меню)
//   ./build/russiano2d --scene meadow       # сразу первый уровень
//   ./build/russiano2d --scene spires       # сразу третий
//
// Вся логика уровня — game/level.js, данные уровней — game/levels.js,
// кампания (меню, HUD, пауза, прогресс) — game/campaign.js. Здесь только
// точка входа: движок вызывает экспортированные onUpdate/onRender, но этой
// игре они не нужны — кадром управляет сам $ (см. $.ready/$.update).
// ===========================================================================

import { installCampaign } from './campaign.js';

$.ready(($) => {
    $.gfx.color('#101820');
    $.sound.volume(0.8);
    $.scene.transition('fade', 200);

    installCampaign($);

    // --scene meadow|caverns|spires|platformer открывает конкретный уровень;
    // проверяем по реестру сцен, а не по списку уровней: у первого уровня есть
    // второе имя 'platformer' (им пользуются внешние инструменты и тесты).
    // Незнакомое имя молча открывает меню — так запуск без --scene и опечатка
    // в имени ведут себя одинаково предсказуемо.
    const requested = $.startScene;
    const known = typeof requested === 'string' && $.scene.has(requested);
    $.scene.load(known ? requested : 'menu', { transition: 'none' });
});
