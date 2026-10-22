# Навык: top-down экшен и шутер сверху

Вид сверху: гравитации нет (`$.world.gravity(0, 0)`), герой двигается по осям, стреляет в сторону курсора.

## 1. Каркас

```js
$.ready(($) => {
    $.gfx.color('#10141c');
    $.world.gravity(0, 0).bounds(0, 0, 1280, 720);
    $('<player>', { id: 'hero' }).at(640, 360).size(24, 24).color('#e07040')
        .controls({ axis: 'both' }).collision(24, 24).appendTo($.world);
});
```

Затем `kit.top-down-shooter` (движение сверху + камера + здоровье + оружие) на `object:hero`. Вариации:
`kit.twin-stick-arena` (левый стик ходит, правый целится), `kit.arena-survival` (волны), `kit.bullet-heaven` (авто-стрельба + опыт),
`kit.project-top-down-action` (почти целая игра: оружие, задания, меню, сохранение).

## 2. Оружие

| Тип | Кирпичик |
|---|---|
| Мгновенное попадание | `weapon.hitscan`, `weapon.sniper` |
| Снаряды | `weapon.projectile`, `weapon.spread`, `weapon.shotgun`, `weapon.rocket`, `weapon.grenade`, `weapon.boomerang` |
| Очередь, авто | `weapon.auto`, `weapon.burst` |
| Ближний бой | `weapon.melee` |
| Патроны и перезарядка | `weapon.ammo`, `weapon.reload`, смена — `weapon.weapon-switch`, панель — `ui.weapon-panel` |

`weapon.base` — общая основа, обычно приходит через набор. Выбери 2–3 оружия с разной ролью (быстрое слабое, медленное сильное,
взрывное по группе) — этого достаточно для интереса.

## 3. Враги и волны

* Один тип врага — `ai.chase` + `ai.melee-attack` (бежит и бьёт); стрелок — `ai.ranged-attack`; ходит по маршруту — `ai.waypoint-patrol`.
* Волны — `ai.wave-director` (+ `ai.spawner` для точек появления, `world.spawn-points`). Каждая следующая волна: больше врагов
  или новый тип, но не оба сразу.
* Враг без награды скучен: `economy.loot-table`, `item.drop`, `progression.xp`.
* Направление взгляда и реакцию на попадание делают `health.hit-flash`, `health.knockback-reaction`.

## 4. Проверка

```
playtest: hold ["D"] 60 кадров → eval позиции; tap по кнопке выстрела → eval числа врагов/здоровья;
screenshot_check grid:true — видно героя, врагов, пули.
```

Частые ошибки: враги проходят сквозь героя (нет `collision`); стрельба «не попадает» (оружие смотрит не в сторону курсора —
проверь привязку цели в наборе, не изобретай поворот кодом); на экране один пятно-герой (нет камеры `camera.follow`).

## 5. Сочность

После того как стрелять можно: `skill_load game-feel` (вспышка попадания, тряска, частицы), `audio` (выстрел, попадание), HUD — `ui-hud`.
