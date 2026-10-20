# AI/navigation primitives — `lib/ai.js`

Набор скриптовых контроллеров движения поверх существующих подсистем:
`.velocity()`/`.at()` узлов, `$.nav` (сетка/навмеш) и `lib/roadgraph.js`.
Никаких `CivilianAI`/`PoliceAI` в движке: конкретное поведение (гражданин,
полиция, бандит) остаётся данными/кодом игры.

## 1. Создание

```js
import { createAI } from './lib/ai.js';

const ai = createAI($, {
    roadGraph: graph,      // для driveTo/маршрутов
    nav: true,             // разрешить $.nav.path, если передан grid/mesh
    grid: navGrid,         // либо mesh: navMesh
    h: 0,                  // высота для surface-tags-запросов (если нужны)
    zoneDetect: '#player', // по умолчанию detect зон
    speed: 80, accel: 900, // умолчания контроллеров
});

const ped = ai.controller($('<npc>', { id: 'ped1' }).at(120, 80)
    .size(18, 36).appendTo($.world), { speed: 70 });
ped.patrolTo([{ x: 300, y: 80 }, { x: 300, y: 220 }], { loop: true });

// сцена тикает сама: никакого глобального менеджера
$.update((dt) => ped.update(dt));
```

Узел с телом (`node.body >= 0`) ведётся через `node.velocity(vx,vy)` — физика
Box2D везёт; узел без тела — через `.at(x + vx*dt, y + vy*dt)`. Угол — обычный
`node.angle` (для Re2D-атласа — существующие `sprite_col`/`sprite_row`).

## 2. Команды контроллера

| Вызов | Поведение |
|---|---|
| `moveTo(target, opts)` | идти к точке/узлу/селектору; `opts.direct`, `speed`, `arrive`, `useNav` |
| `patrolTo(points, {loop,wait,speed})` | обойти точки по порядку; `loop` зацикливает, `wait` — пауза на точке, сек |
| `follow(target, {stopDistance,keep,speed})` | преследование: останавливается на `stopDistance` |
| `fleeFrom(target, {radius,speed})` | уходить от угрозы, пока расстояние < `radius` (по умолчанию 260) |
| `lookAt(target)` | развернуться к цели, стоять |
| `stop()` | остановить и обнулить скорость |
| `driveTo(target, {vehicle,speed})` | маршрут `roadgraph.route(kind:'road')`, движение по waypoint'ам |
| `update(dt)` | кадровый шаг (dt секунды) |
| `state()` | `{mode,status,x,y,pathPoints,pathIndex,route,blocked,error,wait,facing}` |
| `path()` | текущие waypoint'ы |
| `isMoving()` | не `idle` |
| `on(name, fn)` / `off(name, fn)` | локальные события `arrive`/`blocked` |
| `onStimulus(fn)` | подписка на `$.on('stimulus')` и `node.on('stimulus')` |
| `dispose()` | снять подписки, остановить |

Типичный порядок: сцена получает `driveTo`/`patrolTo`, затем каждый кадр зовёт
`update(dt)`. Статус `arrive`/`blocked` приходит событием и виден в `state()`.

## 3. Маршруты

- `driveTo` — `roadGraph.route(from, to, {kind:'road'})`. Цель скорости —
  `min(opts.speed, route.length / route.duration)` (т.е. с учётом speedLimit);
  waypoint считается пройденным на `waypoint` px; водителю отдаются
  `vehicle.control({throttle,brake,steer,handbrake}, dt)` (интерфейс
  `lib/vehicle.js`), поэтому контроллер не дублирует физику машины.
- `moveTo`/`patrolTo` — при `nav:true` и переданных `grid`/`mesh` используется
  `$.nav.path`/`$.nav.meshPath` (существующий A*); если путь не найден —
  событие `blocked` и (по умолчанию) прямой fallback. Никакого нового паттера.
- `follow`/`fleeFrom` — steering к/от цели (Arrive/Seek/Flee), без NavMesh:
  локальный обход — забота `$.nav`, если игре нужно.

## 4. Стимулы

```js
ai.stimulus({ type: 'gunshot', x: 400, y: 300, radius: 600, source: shooter });
// → $.emit('stimulus', {type,x,y,radius,strength,source})

ped.onStimulus((s) => {
    if (s.type === 'gunshot' && s.radius > 200) ped.fleeFrom({ x: s.x, y: s.y });
});
```

`onStimulus` подписывается на глобальную шину `$.on('stimulus')` **и** на
`node.on('stimulus')`; `dispose()` снимает обе подписки. Это данные события, а
не встроенная реакция: что делать — решает игра.

## 5. Зоны (named Area/Zone)

```js
const z = ai.zone({
    name: 'market', x: 500, y: 300, w: 240, h: 160,
    detect: '#player',
    onEnter: (node) => $.log('вошёл'),
    onLeave: (node) => $.log('вышел'),
    signal: 'zone.market',   // → $.signal.emit('zone.market:enter'|':leave')
});
z.inside('#player');   // bool
z.remove();
```

Зона — существующий `<trigger>` (`$.triggers.zone`), а не новая подсистема.
Важно: `visible:false` в `<trigger>` **выключает** зону; невидимость —
`alpha:0` (ai.zone делает это сам). `ai.zones()` / `ai.zoneOf(name)` — список.

## 6. Границы

- контроллер ведёт **один** узел; нет глобального реестра агентов и
  автоматического тика — это делает сцена;
- тела с физикой ведёт Box2D; на стену агент упирается, но объезд — через
  `$.nav` + `useNav`, а не «магическое» локальное избегание;
- `follow`/`flee` не строят маршрут (прямой steering); для города с домами
  используйте `moveTo(..., {useNav:true})` или `driveTo`;
- конкретных состояний (wanted, police, диалоги) здесь нет — это код игры.

## 7. Проверка

`tests/agent/re2d_gta_roadgraph_test.py` (раздел AI): moveTo/patrolTo/follow/
fleeFrom/lookAt/stop, подписка на stimulus, enter зоны, driveTo поверх
roadgraph с `vehicle.control`.
