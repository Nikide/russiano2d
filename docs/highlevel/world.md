# Мир — `$.world`

Мир владеет реестром узлов и синхронизацией с физикой: раз в кадр позиции тел
из C перекладываются в узлы, а удалённые тела убираются. Здесь же поиск,
лучи, границы и порядок отрисовки.

```js
$.world.gravity(0, 900).color('#1a1d24').bounds(0, 0, 4000, 800);
const hit = $.world.raycast({ x: 0, y: 0 }, { x: 300, y: 0 }, { mask: LAYER_SOLID });
$.world.spawn('#enemy', { x: 800, y: 200, body: 'dynamic' });
$.world.sort((a, b) => a.y - b.y);          // порядок отрисовки по глубине
```

---

## 1. Мир и физика

| Вызов | Смысл |
|---|---|
| `gravity(x, y?)` / `color(c)` / `bounds(x, y, w, h)` | параметры мира |
| `pause()` / `resume()` / `freeze()` / `thaw()` / `isPaused()` | остановка физики |
| `timeScale(value?)` / `getTimeScale()` | скорость мира |
| `spawn(node, opts)` / `all()` / `count()` | создание и перечисление |
| `sync(dt)` | перенести трансформы из физики (движок зовёт сам) |
| `bodyAt(x, y, opts?)` / `bodiesIn(x, y, w, h, opts?)` | поиск тел |
| `contacts()` | события контакта за кадр |

## 2. Лучи и формы

| Вызов | Смысл |
|---|---|
| `raycast(from, to, opts?)` | первый луч |
| `raycastAll(from, to, opts?)` | все пересечения |
| `castShape(spec, from, to, opts?)` | фигурный свип (луч «толщиной») |
| `lineOfSight(from, to, opts?)` | есть ли прямая видимость |
| `particlesAt(x, y)` / `particlesIn(x, y, w, h)` | частицы под точкой и в прямоугольнике |

## 3. Соединения (joints)

| Вызов | Смысл |
|---|---|
| `joint(a, b, opts)` | создать соединение; возвращает id |
| `destroyJoint(id)` / `joint(id)` / `jointAlive(id)` / `jointCount()` | управление |

Пока поддержаны не все виды: revolute, distance, weld, prismatic, wheel, pulley,
gear, mouse (см. `docs/TASKS.md` P2 для оставшихся).

## 4. Порядок и слои

| Вызов | Смысл |
|---|---|
| `sort(fn)` / `sortWith(...)` | порядок отрисовки |
| `background(color)` / `getBackground()` / `clearBackground()` | фон |
| `query(selector)` | поиск узлов (то же, что `$(...)`) |

`$.world.bsp` — порядок отрезков «от дальних к ближним» (см. [bsp.md](bsp.md)),
`$.world.ignoreBodies` — тела, которых не касается мир.

## 5. Ограничения

* **CCD не включён**: быстрые тела проскакивают тонкие стены (`docs/TASKS.md` §1.3);
* **события контакта теряются на подшагах**: движок копит их за кадр, но при
  нескольких подшагах часть теряется (`docs/TASKS.md` §0.4);
* **BSP не упорядочивает спрайты**: только отрезки; спрайты сортируются по
  расстоянию (`sort`);
* **сетка навигации отдельно**: `$.nav` строит свой граф, `$.world` его не знает.
