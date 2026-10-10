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

