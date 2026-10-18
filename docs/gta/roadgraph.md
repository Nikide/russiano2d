# Road/walk graph — `lib/roadgraph.js`

Лёгкий декларативный граф дорог и тротуаров для городской сцены. Это **данные +
чистая геометрия** в JS, а не новая навигационная подсистема движка: никакого
NavMesh, `engine.*`, ECS и глобальных менеджеров. Для обхода Box2D-геометрии
по-прежнему используется `$.nav` ([../highlevel/nav.md](../highlevel/nav.md));
roadgraph отвечает на вопросы «где дорога/полоса/парковка/спавн» и «как проехать
по карте».

## 1. Зачем

- полосы с направлением, `oneWay`, `speedLimit`, `intersection`;
- парковки и точки спавна (машины/пешеходы);
- маршрут по дорогам (`route`) и путь вдоль одной дороги (`pathAlong`);
- отдельный лёгкий пешеходный граф или семплированные sidewalk-зоны;
- точки спавна с фильтром по surface tags (`sidewalk`/`no_spawn`/`road`).

Используется демо-сценой (`scene_city.js`), population/ai (см.
[traffic.md](traffic.md), [ai.md](ai.md)) и debug-оверлеем из
[polish.md](polish.md).

## 2. Данные

```js
import { createRoadGraph } from './lib/roadgraph.js';

const graph = createRoadGraph({
    // Можно задать узлы явно — тогда дороги ссылаются на них.
    nodes: [{ id: 'a', x: 0, y: 0, intersection: true }],

    roads: [
        // Вариант 1: полилиния. Промежуточные узлы создаются сами.
        { id: 'main.ew', points: [[0, 300], [1200, 300]],
          lanes: 2, laneOffset: 24, speedLimit: 240,
          parking: true, spawns: true },

        // Вариант 2: from/to (id или точка) + via:[[x,y],…].
        { id: 'main.ns', from: 'a', to: { x: 300, y: 900 },
          lanes: 1, oneWay: true, speedLimit: 120 },
    ],

    // Пешеходный граф: зона-сетка, явные узлы/рёбра или маршрут-полилиния.
    walk: {
        zones: [{ x: 0, y: 340, w: 1200, h: 40, spacing: 48, tags: ['sidewalk'] }],
        // nodes: [{ id: 'w0', x: 0, y: 360 }],
        // edges: [['w0', 'w1']],
        // routes: [{ id: 'sidewalk.left', points: [[0, 360], [1200, 360]] }],
    },

    // Точки уровня карты (как в lib/citymap.js): kind pedestrian|ped|car|vehicle.
    spawns: [{ id: 'ped1', kind: 'pedestrian', x: 100, y: 360 }],
    parking: [{ x: 700, y: 300, angle: 0 }],
});
```

Поля дороги:

| Поле | По умолчанию | Смысл |
|---|---|---|
| `id` | авто | стабильный id |
| `points` / `from`+`to`+`via` | — | геометрия (нужна хотя бы одна форма) |
| `lanes` | 2 | число полос; при `width` выводится из ширины |
| `laneWidth` / `laneOffset` | 32 | ширина полосы (citymap задаёт `laneOffset: 24`) |
| `width` | `lanes*laneWidth` | полная ширина |
| `oneWay` | `false` | движение только от начала к концу |
| `speedLimit` | 120 px/s | скоростной лимит (используется `route.duration` и AI) |
| `parking` | `false` | `true` — автопарковка по обочинам, массив — явные точки |
| `parkingSpacing` / `parkingOffset` | 72 / `width/2+12` | шаг и отступ автопарковки |
| `spawns` | `false` | `true` — точка спавна на каждой полосе каждого сегмента, массив — явные |
| `tags` | `[]` | теги, которые попадают в точки спавна |

Точка спавна: `{ id, x, y, angle, kind:'car'|'ped', lane, tags, road, source }`.
Автопарковка даёт `kind:'car'`, `tags:['parking']`.

## 3. Авто-пересечения

Если две дороги описаны полилиниями и геометрически пересекаются, но не имеют
общего author-узла (типичный «крест» из `lib/citymap.js`), `load()` вставляет
общий узел `ix:<roadA>|<roadB>@x,y` в обе дороги (`autoIntersections !== false`).
Без этого `route()` не умеет поворачивать. Узел помечается
`intersection: true` (`markIntersections` считает degree > 2).

## 4. Методы

| Вызов | Результат |
|---|---|
| `graph.info()` | количества узлов/дорог/сегментов/walk/parking/spawns/intersection |
| `graph.node(id)` / `graph.road(id)` | узел/дорога или `null` |
| `graph.nodesList()` / `roadsList()` / `walkNodesList()` | массивы |
| `graph.nearestRoad(x,y,{maxDistance,lane})` | `{road,segment,x,y,t,distance,angle,speedLimit,oneWay,lanes,laneOffset,lanePoint,direction}` или `null` |
| `graph.nearestNode(x,y,{maxDistance})` | `{node,distance}` |
| `graph.nearestWalkNode(x,y)` | `{node,distance}` |
| `graph.route(from,to,opts)` | маршрут или `null` (см. §5) |
| `graph.pathAlong(roadId,opts)` | точки вдоль дороги в полосе (см. §6) |
| `graph.spawnPoints(opts)` | отфильтрованные точки спавна (см. §7) |
| `graph.tagsAt(x,y,{h,world,tags})` | `{tags,declared,live,ambiguous,error,surface}` |
| `graph.setWorld(world,{h})` | включить чтение surface tags через `world.groundAt` |
| `graph.debugLines()` | линии полос для debug-оверлея |
| `graph.walkPoints()` | точки пешеходного графа |

Чистые функции тоже экспортируются: `asPoint`, `distance`, `pointSegment`,
`segmentCross`, `laneCenter`, `pointOnSegment`, `loadRoadGraph`, а также
`markIntersections(graph)`.

## 5. `route(from, to, opts)`

`from`/`to` — id узла либо точка `{x,y}` (точка притягивается к ближайшему узлу;
сама точка остаётся концом маршрута, `exact:false` это отключает).

```js
const r = graph.route({ x: 10, y: 300 }, { x: 900, y: 700 });
// {
//   kind:'road', nodes:['main.ew#0','ix:…','main.ns#1'],
//   points:[{x,y},…], length, duration,
//   legs:[{roadId,speedLimit,length,oneWay},…], from, to
// }
```

- `opts.kind:'walk'` — маршрут по пешеходному графу (ребра неориентированные,
  скорость `opts.walkSpeed`, по умолчанию 64 px/s);
- `duration` = сумма `leg.length / leg.speedLimit` (+ точные «хвосты» от/до
  точки); для walk — `length / walkSpeed`;
- Dijkstra по **направленным** рёбрам: для `oneWay`-дороги обратный маршрут —
  `null`, а не «примерно туда же»;
- tie-break детерминирован (порядок узлов), два одинаковых вызова дают
  побайтово одинаковый JSON;
- ошибки данных — исключения: неизвестный id узла/дороги, битая точка.

## 6. `pathAlong(roadId, opts)`

`{ start:0, end:1, lane:0, direction:1, step:32 }` → точки с шагом не больше
`step`. `start`/`end` — доли длины дороги; `lane` — индекс полосы
(`laneCenter`); `direction:-1` разворачивает порядок точек. Для `oneWay`
обратное направление — осознанный обход правила: решение остаётся за
вызывающим.

## 7. Точки спавна и surface tags

```js
graph.setWorld(re2dWorld, { h: 0 });   // опционально: feature-detect groundAt
const peds = graph.spawnPoints({
    kind: 'ped',                      // 'car' | 'ped' | 'any'
    tags: ['sidewalk'],               // нужны ВСЕ
    excludeTags: ['no_spawn'],        // не должно быть НИ ОДНОГО (по умолчанию no_spawn)
    near: player.pos(), maxDistance: 800, minDistance: 80,
    limit: 32,
});
```

Теги берутся из объявленных данных точки **и** «живых» surface tags, если у
мира есть `groundAt` (контракт P0.1:
`world.groundAt(x,y,{h}) -> {cell,span,surface,height,tags:[...]} | null`).
`world.groundAt` без `h` на многоэтажной XY бросает `RangeError` — `tagsAt`
возвращает `ambiguous:true, error` и **не выдумывает** теги. Без `groundAt`
работают только объявленные теги; фильтр по отсутствующему обязательному тегу
точку отбрасывает.

## 8. Интеграция с `lib/citymap.js`

`buildCity()` уже отдаёт совместимые поля: `roads` (полилинии с `laneOffset`),
`walk` (массив маршрутов-полилиний), `spawns`, `parking`. Достаточно:

```js
const city = buildCity();
const graph = createRoadGraph({ roads: city.roads, walk: city.walk,
                                spawns: city.spawns, parking: city.parking });
graph.setWorld(world, { h: 0 });   // citymap — Re2D с тегами
```

## 9. Ограничения

- это граф **дорожек/полос**, а не NavMesh: препятствия/дома не учитываются;
  обход геометрии — `$.nav` (см. ai.md);
- полосы — геометрические центры, без поворотных карманов/стрелок и
  светофоров: светофоры/полиция остаются игровыми модулями/данными;
- `route` — кратчайший по расстоянию; пробки/приоритеты не моделируются;
- поверхностные теги читаются точечно (`groundAt`), без кеша: для отладочного
  оверлея это нормально, для сотен запросов в кадре — кешируйте в игре.

## 10. Проверка

`tests/agent/re2d_gta_roadgraph_test.py` — маршруты/one-way/скорость/полосы/
парковки/спавны, walk-граф, объявленные и живые теги, авто-пересечения,
детерминизм, ошибки данных и AI-smoke поверх графа.
