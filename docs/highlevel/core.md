# Ядро — `$`, `ctx` и реестр узлов

`$` — единственная точка входа (философия в [ARCHITECTURE.md](../ARCHITECTURE.md)):
любой вызов возвращает один и тот же wrapper, поэтому работают цепочки; создание
как в HTML, поиск как в CSS.

```js
const hero = $('<player>', { id: 'hero' }).at(100, 200).appendTo($.world);
$('#hero').hp(100).speed(180);          // цепочка возвращает тот же узел
$('.enemy:alive').each((i, el) => el.flash('#f00'));
$('.enemy').within('#hero', 500);       // выборка в радиусе (нативный broadphase)
```

---

## 1. Что экспортирует модуль

| Группа | Имена |
|---|---|
| Контекст | `ctx` — общий контекст подсистем (реестр, камера, время, сети подсистем) |
| Узлы | `Node`, `Wrapper`, `wrap`, `wrapOne`, `query`, `def`, `defGet` |
| Реестр | `registryIndex`, `nodesByTag`, `nodesByClass`, `nodesWithFacet`, `facetCount`, `liveNodes`, `dropFromRegistry`, `touchRegistry`, `registryVersion`, `registrySummary`, `nativeNodes`, `wrapper_proto_ready` |
| Пакетная правка | `beginBatch`, `endBatch`, `inBatch` |
| Выборки | `registerSelector`, `compileSelector`, `TAGS` |
| Радиус | `withinRadius` — чистая фильтрация «центр в радиусе» (метод обёртки `.within()`) |
| Геометрия | `halfExtents`, `nodeBounds`, `boundsOverlap` |
| Спрайты | `dotSprite`, `resolveSprite`, `resolveSheet`, `sheetFrames`, `spriteSize`, `forgetTexture`, `textureSizeOf`, `regionSprite` |
| Цвет | `packColor`, `withAlpha` |
| Случайность | `makeRandom`, `fxRandom` |
| §39 трансформы | `isLocalSpace`, `enterLocalSpace`, `exitLocalSpace`, `resolveLocalTransforms`, `installTransformResolution`, `worldTransformOf`, `worldPointOf`, `localPointOf`, `setWorldPosition`, `setWorldAngle`, `setWorldScale`, `worldScaleOf`, `invalidateNodeTransform` |
| §40 области | `areaDefine`, `areaEnable`, `areaFind`, `areaListOf`, `areaByIndex`, `areaInfo`, `areaOwnerNode`, `areaOverlap`, `applyAreas`, `areaNativeEnabled`, `areaSync`, `areaSyncAll` |
| Прочее | `eventName`, `engineOf`, `countUiNodes` |

`engineOf()` — безопасная заглушка движка: подсистемы берут движок через неё,
поэтому API ставится и без движка (юнит-тесты).

## 2. Реестр узлов

Реестр — источник правды о живых узлах: `liveNodes()` отдаёт их списком,
`registrySummary(key, compute)` кеширует дорогие выборки до изменения реестра.
`beginBatch()`/`endBatch()` откладывают пересчёт индексов при массовой правке.

## 3. Facets

Facet — общий признак узлов (`hp`, `body`, …): `nodesWithFacet('hp')` даёт все
узлы с этим полем, не перебирая классы. Так подсистемы находят «всё живое» и
«всё с телом», не зная конкретных классов игры.

## 4. Ограничения

* **реестр линейный по узлам**: миллионы узлов не предполагаются; для больших
  миров используйте `$.raid` со стримингом чанков;
* **селекторы разбираются при каждом вызове** (кроме зарегистрированных):
  в горячем цикле держите ссылку на узел;
* **`ctx` — общий объект**: подсистемы дописывают в него свои поля, поэтому
  имена уникальны на весь API (см. `docs/highlevel/_CONTRACT.md`).

## 5. Свойства тела у узла

Тело узла настраивается цепочкой: `.body(kind)`, `.bullet(on)` (CCD),
`.gravity(on)`, `.layerBits(bits)` (слой тела) и `.mask(bits)` (с какими слоями
сталкиваться). Флаги хранятся на узле (`bullet_on`, `gravity_on`), поэтому тело,
пересозданное после смены размера, получает те же настройки.

Слоям можно давать имена — `$.collision` (`collision.js`): после
`$.collision.define('walls', 0x1)` работают `.layerName('walls')`,
`.maskBy('walls|enemies')` и `$.collision.mask('all|!enemies')`; список имён —
`$.collision.names()`.

## 6. Локальные трансформы (§39)

`x/y/angle/scale_x/scale_y` узла — **мировой** трансформ: их читают отрисовка,
физика и старый игровой код. В локальном режиме (`local_mode === true`) узел
хранит исходные локальные значения в `local_x/local_y/local_angle/
local_scale_x/local_scale_y`, а в тех же мировых полях лежит результат
композиции по цепочке родителей:

```
angle = angle_родителя + local_angle
scale = scale_родителя * local_scale        (знак сохраняется: flip зеркалит)
point = parent + R(angle_родителя) * (local_xy * scale_родителя)
```

Поэтому ни одна подсистема не меняется: рендер и физика читают прежние поля.
Неравномерный масштаб родителя масштабирует сдвиг по своим осям, но не даёт
shear — произвольный наклон запрещён (§39).

Экспорт (используется `api.js` и тестами без движка):

| Имя | Смысл |
|---|---|
| `isLocalSpace(node)` | включён ли у узла локальный режим |
| `enterLocalSpace(node)` / `exitLocalSpace(node)` | включить (keep-world) / выключить |
| `resolveLocalTransforms()` | кадровый пакетный проход; возвращает число изменённых |
| `installTransformResolution()` | регистрация прохода в движке (`engine.setResolveTransforms`) |
| `worldTransformOf(node, out?)` | мировой трансформ `{ x, y, angle, sx, sy }` |
| `worldPointOf(node, lx, ly)` / `localPointOf(node, wx, wy)` | точка туда/обратно |
| `setWorldPosition/setWorldAngle/setWorldScale(node, …)` | запись МИРОВОГО значения (обратная композиция) |
| `worldScaleOf(node)` | скомпонованный масштаб (для `.flip()`) |
| `invalidateNodeTransform(node)` | пометить поддерево устаревшим и пересчитать узел |

Проход идёт по списку локальных узлов (`local_nodes`), а не по реестру: в
проекте без локальных узлов он выходит на первой строке и ничего не стоит.
Поколение (`local_gen`) и поля `_t_gen`/`_t_busy` не дают считать узел дважды и
**защищают от цикла** в цепочке родителей. Если локальных узлов нет, запись
мирового трансформа не платит даже за обход детей (проверка длины списка).

Нативный проход — `engine.nodes.resolveTransforms(list, gen, cb)`; без движка
(юнит-тест qjs, `$.debug.nativePasses(false)`) работает тот же алгоритм на JS.
Движок зовёт проход в конце кадра логики и перед отрисовкой (`src/script.c`),
поэтому к следующему физическому шагу и к сборке кадра дети уже скомпонованы;
локальный ребёнок с телом ставится в мировую точку через `cb`.

## 7. Области узла (§40)

Описания областей — данные узла (`node.area_list`), нативные формы — на теле.
Экспорт: `areaDefine`, `areaEnable`, `areaFind`, `areaListOf`, `areaByIndex`,
`areaInfo`, `areaOwnerNode`, `areaOverlap`, `applyAreas` (пересборка форм после
создания тела). Внутреннее представление — compound shapes: `applyAreas` зовёт
`engine.setShape`/`engine.addShape`, а `enabled: false` реализуется нулевым
фильтром через `engine.setShapeEnabled`, поэтому gameplay от представления не
зависит (§40).

`areaOverlap` — явный геометрический запрос (`engine.shapeOverlaps`), а не
история событий: цель, уже стоящая внутри при открытии окна атаки, находится
сразу. `index` области переживает пересборку формы — дедупликация попаданий в
игре опирается на имя области и окно атаки, а не на handle.

Источник истины о состоянии области — **нативный фильтр формы**:
`engine.shapeEnabled(body, index)` читает его, а выключенную форму не возвращает
и сам запрос пересечений. Если форму переключил внешний драйвер (дорожка
`shape.enabled` §41) напрямую через `engine.setShapeEnabled`, JS-описание
подтягивается при чтении: `areaSync`/`areaSyncAll`/`areaNativeEnabled`, поэтому
`.areas()` и `.areaOverlap()` не расходятся с native-состоянием.


