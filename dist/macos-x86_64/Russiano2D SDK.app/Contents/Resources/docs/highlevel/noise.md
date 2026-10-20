# `$.noise` — комплект шумов для миров, текстур и тайлмапов

Набор шумов и фракталов поверх [FastNoiseLite](../../third_party/fastnoise_lite)
(Jordan Peck, MIT): OpenSimplex2, OpenSimplex2S, Perlin, Value, ValueCubic,
Cellular (Worley) с метриками расстояния и типами возврата, фракталы
fBm/Ridged/PingPong, domain warp. 2D и 3D. Числа считает апстрим — мы не
переписывали алгоритмы, поэтому значения совпадают с его эталоном (см. §7).

Это отдельное пространство имён рядом с [`$.random`](random.md): там — генератор
случайных чисел и «наш» замороженный simplex/value-шум v1, здесь — полноценный
комплект источников для генерации. Существующие `$.random.noise1D/noise2D/
simplex2D/noise` не изменились.

```js
// Рельеф: фрактальный шум, зерно — из сессии (--seed)
for (let x = 0; x < 100; x++)
    height[x] = $.noise.fbm(x * 0.05, 0, { octaves: 5, frequency: 0.02 });

// Поле 256×256 одним вызовом и сразу в текстуру
const pixels = $.noise.fieldRGBA({ w: 256, h: 256, source: 'cellular',
                                   frequency: 0.02, seed: 7 });
const id = engine.textureFromPixels(256, 256, pixels);

// Прямо в тайлмап: значения [-1,1] → пороги биомов
const field = $.noise.field({ w: 128, h: 128, source: 'simplex2',
                              fractal: 'fbm', octaves: 4, frequency: 0.03 });
const tile = field[j * 128 + i] > 0.35 ? 'rock' : 'grass';
```

## 1. Зерно

Правило то же, что у остальных шумов движка:

* **без `seed`** берётся зерно сессии — `--seed` на старте или `$.random.seed(n)`
  в рантайме. Разный `--seed` — разный мир, один и тот же — побитово одинаковый;
* **явный `seed`** в параметрах побеждает всегда и не зависит от сессии.

```js
$.noise.simplex2(3.5, -1.25);                 // зерно сессии
$.noise.simplex2(3.5, -1.25, { seed: 4242 }); // всегда одно и то же
$.random.seed(999);                           // меняет и $.noise по умолчанию
```

## 2. Источники

| Имя | Что это |
|---|---|
| `simplex2` | OpenSimplex2 — базовый симплекс, меньше осевых артефактов, чем у Perlin |
| `simplex2S` | OpenSimplex2S — сглаженный вариант (мягче переходы) |
| `perlin` | классический Perlin |
| `value` | value noise (решётка с интерполяцией) |
| `cubic` | ValueCubic — value noise с кубической интерполяцией |
| `cellular` | Worley (ячейки), метрика и тип возврата настраиваются |

Поштучные обёртки: `$.noise.simplex2(x, y, opts)`, `$.noise.simplex2S`,
`$.noise.perlin`, `$.noise.value`, `$.noise.cubic`, `$.noise.cellular`.
Для 3D — `$.noise.point3(x, y, z, opts)`.

Список доступных имён в рантайме: `$.noise.sources()`.

## 3. Фракталы

`fractal: 'fbm' | 'ridged' | 'pingpong'` накладывается на любой источник:

```js
$.noise.fbm(x, y, { octaves: 5, lacunarity: 2, gain: 0.5 });
$.noise.ridged(x, y, { octaves: 4, gain: 0.4 });
$.noise.pingpong(x, y, { pingPongStrength: 3 });
```

| Параметр | Смысл | Умолчание |
|---|---|---|
| `octaves` | число октав, 1..12 | 3 |
| `lacunarity` | во сколько раз растёт частота каждой октавы | 2 |
| `gain` | во сколько раз падает амплитуда, 0..1 | 0.5 |
| `weightedStrength` | ослабление октав по предыдущей, 0..1 | 0 |
| `pingPongStrength` | жёсткость pingpong, 0..100 | 2 |

`$.noise.fractals()` — список режимов.

Списки допустимых значений в рантайме: `$.noise.warpTypes()`,
`$.noise.warpFractals()`, `$.noise.rotations()` (повороты осей для 3D:
`none`, `improveXY`, `improveXZ`).

## 4. Domain warp

Сдвигает координаты до выборки шума — так получаются «измятые» берега,
облака и русла рек.

```js
const warped = $.noise.create({ warpType: 'simplex2', warpAmp: 1.5 });
const p = warped.warp2(x, y);            // [x', y'] — только сдвиг
const v = warped.warped2(x, y);          // сдвиг + шум в сдвинутой точке

$.noise.warped(x, y, { warpAmp: 2 });    // то же одной строкой
$.noise.domainWarp(x, y, { warpAmp: 2 }); // только сдвиг

// 3D-варианты — для объёмов и слоёв
$.noise.domainWarp3(x, y, z, { warpAmp: 2 });
$.noise.warped3(x, y, z, { warpAmp: 2 });
```

| Параметр | Смысл | Умолчание |
|---|---|---|
| `warpType` | `simplex2`, `simplex2Reduced`, `basicGrid` | `simplex2` |
| `warpAmp` | амплитуда сдвига | 1 |
| `warpFractal` | `none`, `progressive`, `independent` | `none` |
| `warpOctaves`, `warpLacunarity`, `warpGain` | параметры фрактального warp | 3, 2, 0.5 |

**Ограничение апстрима:** fractal-режим у FastNoiseLite один на объект, поэтому
`fractal` (фрактальный шум) и `warpFractal` (фрактальный warp) в одном
генераторе несовместимы — `$.noise` скажет об этом ошибкой, а не подменит одно
другим. Нужны оба — создайте два генератора:

```js
const shape = $.noise.create({ fractal: 'fbm', octaves: 5 });
const warp = $.noise.create({ warpType: 'simplex2', warpFractal: 'progressive' });
```

## 5. Cellular

```js
$.noise.cellular(x, y, { cellularDistance: 'hybrid', cellularReturn: 'distance2' });
```

| Параметр | Значения | Умолчание |
|---|---|---|
| `cellularDistance` | `euclidean`, `euclideanSq`, `manhattan`, `hybrid` | `euclideanSq` |
| `cellularReturn` | `value`, `distance`, `distance2`, `distance2Add`, `distance2Sub`, `distance2Mul`, `distance2Div` | `distance` |
| `cellJitter` | 0..2 — насколько «плывут» ячейки | 1 |

Списки: `$.noise.cellularDistances()`, `$.noise.cellularReturns()`.

## 6. Массовый путь: `field`, `field3`, `fieldRGBA`

Поштучные вызовы платят за каждый переход JS→C. Для полей (текстуры, тайлмапы,
карты высот) есть массовый путь: сетка считается в C одним вызовом.

### `$.noise.field(opts) → Float32Array`

`w`, `h` — размер; `x0`, `y0` — начало; `step` (или `stepX`/`stepY`) — шаг между
точками; остальные поля — параметры шума. Порядок построчный: значение `(i, j)`
лежит в `field[j * w + i]`.

```js
const f = $.noise.field({ w: 256, h: 256, source: 'simplex2', frequency: 0.01 });
f[0];            // то же, что $.noise.simplex2(0, 0, { frequency: 0.01 })
f[1 * 256 + 0];  // то же, что $.noise.simplex2(0, 1, ...)
```

**Числа совпадают побитово** с поштучными вызовами тех же координат — это не
«похожая формула», а та же функция апстрима (проверяется тестом).

### `$.noise.field3(opts) → Float32Array`

Слой 3D-шума при фиксированном `z` (срезы для объёма/слоёв высоты).

### `$.noise.fieldRGBA(opts) → Uint8Array`

Сразу пиксели RGBA: серый канал `round((value * 0.5 + 0.5) * 255)`, альфа 255,
зажим в 0..255. Массив годится прямо в `engine.textureFromPixels(w, h, pixels)`.

### Цена (macOS arm64, RelWithDebInfo, фикстура `bare`)

| Поле 256×256 | время |
|---|---|
| `simplex2` | 0.5 мс |
| `fbm` (5 октав) | 2.8 мс |
| `cellular` | 0.7 мс |
| те же 65 536 точек поштучно (`get2` в JS-цикле) | 22.7 мс |

Разница ×48: массовый путь не пересекает границу JS↔C на каждую точку.
Числа зависят от машины — важно соотношение, а не абсолют.

## 7. Явные генераторы и параметры

```js
const g = $.noise.create({ source: 'perlin', frequency: 0.02, seed: 7 });
g.get2(x, y);                     // поштучно
g.get3(x, y, z);
g.field({ w: 64, h: 64 });        // массово, те же параметры
g.params();                       // { source: 'perlin', seed: 7, c: {...} }
```

`create()` стоит вызвать один раз и переиспользовать: поштучные обёртки
(`$.noise.perlin(...)`) держат кэш последних 32 конфигураций, но разбор
параметров всё равно происходит на каждом вызове.

`$.noise.params(opts)` показывает, что именно уйдёт в движок: человекочитаемые
имена (`names`) и числовую конфигурацию (`c`). `$.noise.defaults()` возвращает
умолчания из C — одна копия умолчаний на движок, а не две.

Мусорные параметры отвергаются с внятной ошибкой (`frequency: 0`, `octaves: 13`,
неизвестное имя источника, конфликт `source` в имени функции и в параметрах) —
молчаливой подмены «взяли 0» нет.

## 8. Сверка с апстримом

Эталонные значения в `tests/agent/noise_set_test.py` сняты с **непатченного**
заголовка FastNoiseLite: программа
[`third_party/fastnoise_lite/reference.cpp`](../../third_party/fastnoise_lite/reference.cpp)
печатает таблицу, она и заморожена в тесте. Строка `readme_4x4` дополнительно
сверена с опубликованным тестом апстрима, `readme_warp` — совпадает точно.

Это защита от «кривого порта»: если кто-то поправит вендоренный заголовок или
фасад, тест упадёт на числах, а не на «похожести картинки».

```bash
python3 tests/agent/noise_set_test.py
c++ -O2 -std=c++17 -I third_party/fastnoise_lite \
    third_party/fastnoise_lite/reference.cpp -o /tmp/fnl_ref && /tmp/fnl_ref
```

## 9. Чего здесь нет

* **4D-шума нет** — у FastNoiseLite его нет вовсе (только 2D/3D).
* **«Настоящей» OpenSimplex из другого источника нет**: мы используем
  OpenSimplex2/2S из FastNoiseLite, а не оригинальную библиотеку Курта Спенсера.
* **GPU-шума нет**: поля считаются на CPU. Для генерации на GPU нужен свой
  шейдер (см. `shaders/`), этот модуль его не заменяет.
* **Текстуры модуль не создаёт** — он отдаёт значения и пиксели; загрузка в GPU
  остаётся за `engine.textureFromPixels` / `$.gfx`.
