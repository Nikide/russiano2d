# GTA sandbox: урон, hitscan, снаряды, AoE — `lib/combat.js`

Игровой слой над существующими примитивами `$`. Новых систем урона, запросов
или событий не заводит:

| Нужно | Что используется |
|---|---|
| луч/цели/препятствия | `$.world.raycastAll`, `$.world.raycast`, `$.world.castShape` |
| область | `$.world.bodyAt`, `$.world.bodiesIn` |
| здоровье | `$(узел).hp()/health()/damage()` (`node.cur_hp/max_hp`, iframes — в `.damage()`) |
| импульс | `$(узел).applyImpulse(x, y)` |
| события | узел `damaged`/`death`, глобальный `$.emit('damage')` |
| презентация | остаётся игре: `$.hits`, `$.vfx`, `$.particles`, `$.sound` |

```js
import { createCombat } from './lib/combat.js';

const combat = createCombat($);
$.update((dt) => combat.update(dt));          // шаг снарядов

combat.hitscan({ from: '#hero', to: mouse, amount: 20, type: 'bullet',
                 source: '#hero', mask: 0x2, wallMask: 0x1 });
combat.aoe({ point: blast, radius: 120, amount: 45, type: 'explosion' });
const shot = combat.projectile({ from: '#hero', angle: aim, speed: 700,
                                 amount: 12, type: 'bullet',
                                 mask: 0x2, wallMask: 0x1, lifetime: 2500 });
```

## Payload урона

Один и тот же объект приходит в `payload` результата, в событие узла
`damaged` (`e.data`) и в глобальное `$.on('damage', (e) => e.data)`:

| Поле | Значение |
|---|---|
| `amount` | запрошенный урон (в вызовах принимается и `damage:` как синоним) |
| `type` | строка игры: `bullet`, `explosion`, `melee`, `vehicle`… (по умолчанию `generic`/`bullet`) |
| `source` | узел-источник или `null` |
| `subject` | узел-цель |
| `point` | `{x,y}` точки контакта (`null`, если её нет) |
| `impulse` | `{x,y}` или `null` |
| `radius` | радиус AoE, `0` у hitscan/снаряда |
| `sourceNid`, `subjectNid` | логические ID для JSON/трассировки |
| `applied`, `hpBefore`, `hpAfter`, `dead`, `reason` | факт применения (после) |

Смерть: узел получает `death` (`$('#n').on('death', (e) => e.data)`).
Глобальный `$.on('death', …)` получает это же событие через обычную рассылку
`node.emit()` — **второй** `$.emit('death')` не нужен и дал бы двойную доставку.

## Что важно в семантике

* **Один хит на цель за выстрел.** Даже при `pierce: true`/`maxHits` цель
  попадает не больше одного раза; дедупликация по `nid`.
* **Стена останавливает.** `mask` — слои целей, `wallMask` — слои препятствий
  (`0` = все слои). Цель обязана быть живым узлом с `max_hp > 0` (см.
  `combat.targetable`), иначе она считается препятствием. Труп (hp `0`)
  блокирует луч — при необходимости фильтруйте маской/`targetable`.
* **Порядок детерминирован** (доля луча, затем `nid`); AoE сортируется по
  дистанции, урон — `amount × (1 - distance/radius)` (`falloff:'none'` — без
  спада), минимум 1.
* **Дистанции считаются до прямоугольника узла**, как его видит
  `$.world.raycastAll`; тонкие/круглые формы — приближение.
* `$.world.bodiesIn(x, y, w, h)` — прямоугольник с **центром** `(x, y)`
  (обёртка над `engine.queryBox`); AoE передаёт центр и полный размер.
* `stopAtWall: false` отключает проверку препятствий; не-узловая статическая
  геометрия ловится `$.world.raycast` (если у неё нет узла).

## Снаряд

`projectile(opts)` создаёт узел `<bullet>` (CCD, без гравитации), сам двигает
его по `speed × dt` и каждый шаг делает тот же запрос, что hitscan
(`radius > 0` — ещё `castShape`). Дескриптор:
`{node, direction, hit, wall, dead, reason, alive(), update(dt), remove(reason)}`.
`reason`: `hit|wall|lifetime|range|destroyed|removed|clear`. При `radius > 0`
свип объёма может остановить снаряд раньше — точка ставится на препятствие, но
`result.wall.node` есть только у узловой стены.

## Границы

* Нет зон/хитбоксов и множителей по частям тела — это `$.combat` и игра.
* Нет friendly-fire/команд/иммунитета сверх `node.iframes` — политика игры.
* Нет миссий, полиции, декалей и звука — подписчики на `damage`/`death`.
* Импульс — в единицах Box2D (как `applyImpulse`), не «сила взрыва».
* AoE видит только узлы с телами (`bodyAt/bodiesIn`); узлы без тела в неё не
  попадают.

Проверки: `python3 tests/agent/re2d_gta_combat_test.py` (попадание, промах,
стена, маски, порядок, pierce, payload/события, смерть, AoE, снаряд/время
жизни/дальность).
