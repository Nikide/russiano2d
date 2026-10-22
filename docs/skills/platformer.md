# Навык: платформер

Скелет: герой (`<player>`) + твёрдые платформы (`<wall>`) + цель + опасность. Движение — кирпичик, не код.

## 1. Каркас

```js
$.ready(($) => {
    $.gfx.color('#141824');
    $.world.gravity(0, 1800).bounds(0, 0, 1280, 720);   // bounds — невидимые стены по краям
    $('<wall>', { id: 'ground' }).at(0, 680).size(1280, 40).color('#3a4a3a').appendTo($.world);
    $('<wall>', { id: 'p1' }).at(300, 560).size(200, 24).color('#5a6a5a').appendTo($.world);
    $('<player>', { id: 'hero' }).at(100, 600).size(26, 30).color('#e07040')
        .controls({ axis: 'both', coyote: 100, jumpBuffer: 120 }).collision(26, 30).appendTo($.world);
});
```

Затем `snippet_apply kit.platformer-core` на `object:hero` (движение + здоровье + камера). Для «чувства»: `movement.coyote-jump`,
`movement.jump-buffer` (ввод прощает ошибки), по замыслу — `movement.double-jump`, `movement.dash`, `movement.wall-jump`.

## 2. Числа уровня (при гравитации 1800 и стандартном прыжке)

Проверь прыжок `playtest`-ом, а не на глаз: зажми `D`, `tap: "Space"`, подожди кадры, `eval` позиции героя — это и есть твой реальный
размах прыжка. Строй уровень **с запасом 15–20%** от измеренного:

* максимальная высота шага между платформами — 70–80% высоты прыжка;
* максимальный разрыв — 70–80% дальности прыжка (скорость × время полёта);
* зона безопасности под пропастью: край уровня должен убивать/возвращать (`world.level-exit`, `health.death`), а не держать героя.

## 3. Что обычно нужно сверх движения

| Цель | Кирпичик |
|---|---|
| Монеты / предметы | `interact.pickup`, `item.currency`; событие `collect` на герое |
| Шипы, лава, пила | `interact.hazard`, `world.moving-hazard` |
| Движущиеся и односторонние платформы | `movement.platform-ride`, `world.one-way-platform` |
| Контрольные точки и респаун | `kit.platformer-checkpoint` |
| Враги | `ai.waypoint-patrol` (ходит туда-обратно), `ai.chase`, `ai.melee-attack`; урон — `health.damage-types`, неуязвимость — `health.invulnerability` |
| Босс | `kit.boss-platformer` (`ai.boss-phases`, `ai.boss-telegraph`) |
| Выход с уровня | `world.level-exit`, затем `ui.result-screen` |

## 4. Рецепт проверки

```
playtest steps: [
  { hold: ["D"], frames: 90 }, { eval: "JSON.stringify($('#hero').pos())" },   // идёт вправо
  { tap: "Space", frames: 30 }, { eval: "JSON.stringify($('#hero').pos())" }   // прыгает (y уменьшился)
]
```

Типичные поломки: герой падает сквозь пол (платформа — `<sprite>`, а не `<wall>`); улетает за экран (нет `bounds`);
нет прыжка (не подключено движение); кадр пустой (нет `appendTo($.world)`).

## 5. Порядок наполнения

Один экран с чёткой целью → 3–5 платформ с нарастанием сложности → враг/опасность → цель → контрольная точка → второй экран.
Первый платформер должен проходиться за минуту; усложнять — потом.
