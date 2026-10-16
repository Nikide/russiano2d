# Пример: Generated rooms (§31-4)

Вертикальный срез процедурной генерации на чистом `$`: комната строится по
seed, проверяется до публикации, бюджет генерации виден числом, а checkpoint
возвращает пройденную комнату и прогресс. Относится к разделу §31
«Документация и вертикальные примеры» и последовательности §49
[спецификации производственной готовности](https://github.com/Nikide/russiano2d/blob/main/docs/PRODUCTION_READINESS.md).

## Запуск

```bash
./build/russiano2d --game demos/roguerooms
python3 tools/run_tests.py roguerooms_test                       # автоматическая приёмка
R2D_BINARY=build-2d/russiano2d python3 tools/run_tests.py roguerooms_test
```

Клавиши: **R** — новая комната, **C** — checkpoint, **V** — restore,
**P** — следующий профиль.

## Конвейер

```
seed -> layout (simplex2d §43) -> чистка одиночных клеток -> группировка
платформ -> placement (поток generation) -> validation -> publish
```

| Шаг | Как | Что проверяется |
|---|---|---|
| Layout | `$.random.noise({ algorithm: 'simplex2d', seed, frequency: 0.18 })` + порог профиля; границы комнаты и двери — данные | шум — чистая функция координат, от `$.task` не зависит |
| Опасность | второй источник `simplex2d` с другим seed, `fbm2D(..., { octaves: 4 })` на клетку | спавн не в опасной зоне |
| Чистка | одиночная твёрдая клетка без ортогональных соседей убирается | нет «висящих» кубиков |
| Платформы | горизонтальные серии клеток → один `<wall>` на платформу | число платформ одинаково при одном seed |
| Placement | `$.random.stream('generation')`: порядок вызовов задан индексом платформы | бюджет `$.task` не меняет результат |
| Validation (§24) | свободный спавн, запас высоты 2, опора снизу, достижимость выхода `$.grid.flood`, доля свободного места, квадраты 2×2, опасная зона | отказ с причиной до публикации; retry с derived seed, затем отказ |
| Publish | узлы комнаты создаются только целиком | во время генерации мир не меняется |
| Checkpoint (§14/§26) | `$.save.slot().save()` (разделы run/room, `nid`), в слоте — seed/derived seed/hash/прогресс | restore возвращает ту же комнату; дрейф hash'а — отказ |

## Что показывает числом

Демо печатает в HUD и отдаёт в `$.rooms.stats()`:

* `hash` и `platforms` — идентичность комнаты;
* `steps` / `maxSteps` — сколько шагов конвейера сделано и потолок;
* `frames`, `maxStepsPerFrame` — на сколько кадров `$.task` порезал работу;
* `ticks` / `maxTicks` — тики симуляции (§44, `$.time.duration`);
* `attempt` / `attemptSeeds` / `attemptLog` — retry с derived seed и причины
  отказов;
* `budget` — заявленный бюджет мс/кадр;
* `abandoned` — сколько генераций отменено (например, restore во время
  генерации).

```js
$.rooms.start(42, { budget: 2, maxSteps: 8721, maxTicks: 240, profile: 'standard' });
$.rooms.stats();          // { status, hash, platforms, steps, frames, ticks, … }
$.rooms.verify(42, 'standard');   // hash комнаты из seed без публикации
$.rooms.checkpoint('room');       // слот с комнатой и прогрессом
$.rooms.restore('room');          // вернуть ту же комнату; дрейф → отказ
```

## Эталоны

`tests/fixtures/roguerooms/expected.json` — hash/платформы/шаги трёх комнат
(`standard` seed 42, `dense` seed 7, `standard` seed 7 с retry) и причины
отказов. Пересборка:

```bash
python3 tests/fixtures/roguerooms/gen_expected.py > tests/fixtures/roguerooms/expected.json
```

## Файлы

| Файл | Что |
|---|---|
| `main.js` | точка входа проекта |
| `index.js` | конвейер генерации, validation, бюджеты, checkpoints, HUD |
| `project.json` | имя окна и размер |

## Ограничения

* Комната — не тайлмап: каждая платформа становится отдельным `<wall>`.
  Массовые тайлы и частичная коллизия клетки — §42/§23.
* «Опасная зона» — пример правила из карты `fbm2D`; это демонстрация
  validation, а не модель урона.
* Reachability консервативна: проверяется связность свободных клеток
  (`$.grid.flood`), а не прыжковый конверт конкретного контроллера (§24
  оставляет это отдельным helper'ом).
* Бюджет `$.task` — миллисекунды на кадр, а не гарантия: кадр может уйти за
  бюджет на один шаг. Лимиты `maxSteps`/`maxTicks` — жёсткие и проверяются
  в демо.
* Профиль `broken` намеренно непригоден (порог выше диапазона шума) — он
  показывает отказ, retry и отсутствие публикации.
