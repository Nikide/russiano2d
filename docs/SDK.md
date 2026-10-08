# Russiano2D SDK

Статус документа: описывает **фактическое** состояние SDK (не цель). Целевая
архитектура и законы — [Следующая цель SDK AGENT.md](../Следующая%20цель%20SDK%20AGENT.md);
аудит репозитория — [SDK_AUDIT.md](../SDK_AUDIT.md); передача работы между
сессиями — [SDK_HANDOFF.md](../SDK_HANDOFF.md).

```text
GAME = CODE + DATA          SDK = R2D-приложение + инструменты для CODE + DATA
```

SDK не владеет игрой: проекты и ассеты остаются обычными файлами, а игра
запускается без SDK.

## 1. Состав

| Часть | Где | Что это |
|---|---|---|
| Приложение SDK | [`sdk/`](../sdk) | обычный проект R2D: `project.json`, `main.js`, RmlUi-документы `sdk/ui/*.rml`. Запуск: `./build/russiano2d --game sdk` |
| Реестр компонентов | [`sdk_tools.json`](../sdk_tools.json) | единственный список инструментов; launcher строит каталог по нему |
| Нативный бэкенд | [`sdk/native/`](../sdk/native) | C-бинарник `r2d-sdk` (`build/r2d-sdk`) без Python/Node.js/shell |
| Мост GUI → бэкенд | `$.sdk` ([highlevel/sdk.md](highlevel/sdk.md)) | включается `"toolHost": true` в `project.json` |
| Тесты | `tests/sdk/`, `tests/js/sdk*_test.mjs`, `tests/agent/sdk_*_test.py` | C, qjs и агентские |

## 2. Принципы (кратко)

* **UI только RmlUi.** Оболочка SDK — `sdk/ui/shell.rml` + `shell.rcss`.
* **Один код для GUI, CLI и агента.** Кнопка вызывает операцию
  `$.sdkApp.<имя>()`; тот же вызов доступен агенту через `eval`. Тяжёлая работа
  выполняется в `r2d-sdk`, поэтому GUI и CLI не расходятся.
* **Диагностика только фактами**, со стабильными кодами:
  `{ code, severity, asset, location, message, details }`,
  `severity` ∈ `info | warning | error | fatal`.
* **Существующие форматы.** Новых «ассет-баз» нет: тип ассета выводится из
  имени файла, инструмент — из шаблонов `assets` реестра.

## 3. Реестр `sdk_tools.json`

```json
{ "schema_version": 1,
  "tools": [ { "id": "world-studio", "name": "Re2D World Studio",
               "description": "…", "last_updated": "2026-10-08T17:00:00+03:00",
               "entry": "world-studio", "binary": "build/r2d-sdk",
               "category": "re2d", "assets": ["*.re2dmap"] } ] }
```

* `id` — `a-z`, `0-9`, `-`; уникален; `last_updated` — ISO 8601 **с часовым
  поясом**; `entry` — экран (`sdk/tools/<entry>.js`) либо встроенный
  (`launcher`, `asset-browser`, `diagnostics`);
* `assets` — шаблоны имён файлов (`*` и `?`, без учёта регистра): так Asset
  Browser выбирает инструмент для файла;
* `binary` — необязательный относительный путь к нативному бинарнику.

Неверная `schema_version` и некорректные записи **не пропускаются молча**:
запись остаётся в списке с `valid:false`, причина — в диагностике
(`SDK_REGISTRY_SCHEMA_VERSION`, `SDK_REGISTRY_DATE`, `SDK_REGISTRY_ID`,
`SDK_REGISTRY_DUPLICATE_ID`, `SDK_REGISTRY_FIELD`, `SDK_REGISTRY_BINARY_PATH`,
`SDK_REGISTRY_BINARY_MISSING`, `SDK_REGISTRY_ENTRY`).

## 4. CLI `r2d-sdk`

Каждая команда печатает **один JSON-объект**; код выхода: `0` — ok, `1` —
операция выполнена, но в данных есть ошибки, `2` — неверное использование.

| Команда | Что делает |
|---|---|
| `version`, `commands` | версия, список команд и типов, которые умеет проверять `validate` |
| `tools [--registry f]` | реестр с проверкой схемы |
| `assets <каталог> [--registry f]` | ассеты по реальной файловой структуре: путь, тип, размер, mtime, инструмент |
| `project <каталог>` | `project.json` и `main.js`: название, версия, размер окна |
| `projects <каталог>` | проекты (каталоги с `project.json`) под каталогом |
| `validate <файл> [--type t]` | проверка ассета, структурная диагностика |
| `atlas-grid <png> --out f.atlas.json (--cell WxH \| --cols N --rows N) [--prefix p] [--duration мс] [--tags idle:0-3,…]` | атлас сеткой из картинки |
| `atlas-format <f.atlas.json> [--write] [--text]` | привести к каноническому виду |
| `atlas-info <f.atlas.json>` | кадры, теги, слайсы, картинка + проверка |
| `run <каталог> [--scene s] [--frames N] [--headless] [--engine путь]` | запуск игры движком |
| `build <каталог> --out f [--entry main.js] [--encrypt\|--no-encrypt]` | сборка в один файл (`russiano2d build`) |

Явный `--engine` не подменяется молча: нет файла → `SDK_ENGINE_NOT_FOUND`.

## 5. Classic 2D: Sprite Studio и Animation Studio

Данные — **существующий формат**, который уже читает `$.atlas`
([highlevel/atlas.md](highlevel/atlas.md)): Aseprite-совместимый JSON
`*.atlas.json`. Нового формата SDK не вводит.

| Что | Где в файле | Как читает игра |
|---|---|---|
| картинка | `meta.image` (путь от каталога JSON), `meta.size` | `$.atlas.load('hero', 'hero.atlas.json')` |
| кадр | `frames[имя] = { frame:{x,y,w,h}, duration }` | `sheet.frame(имя)`, `sheet.info(имя)` |
| анимация | тег `meta.frameTags`: `name, from, to, direction, loop` | `sheet.tagSprites(тег)`, `sheet.tagInterval(тег)`, `.frames(ids).animate({speed})` |
| пивот кадра | слайс с именем кадра в `meta.slices` (`keys[0].pivot`) | `sheet.slice(имя).pivotLx/pivotLy` |
| метаданные | `meta.custom` (рантайм игнорирует) | — |

Файл пишется в каноническом виде: **один кадр, тег и слайс — на строке**, порядок
ключей стабилен, поэтому `git diff` показывает только настоящие правки
(смена длительности тега — 4 строки). Тот же вид пишут C (`atlas-grid`,
`atlas-format`) и JS-сериализатор Studio; тест `sdk_classic2d_test.py`
проверяет, что байты совпадают.

**Sprite Studio** (`sdk/tools/sprite-studio.js`, RML `sdk/ui/sprite_studio.rml`):
открывается на `*.atlas.json` или на `*.png` (нет атласа — режим «нарезка
сеткой», делает нативный `atlas-grid`). Кадры (рамка мышью или числами),
пивот, длительность, метаданные, масштаб и панорама, сетка пикселей, undo/redo
(Ctrl+Z / Ctrl+Shift+Z), проверка черновика нативным `validate`. Картинка рисуется
обычным узлом `<sprite>` (nearest, как в игре); рамки и подписи — RmlUi поверх.

**Animation Studio** (`sdk/tools/animation-studio.js`): теги атласа как анимации —
диапазон кадров, направление, цикл, длительность. Просмотр — настоящий
рантайм: атлас разбирает `$.atlas` из того же текста, что будет записан, узел
`.frames().animate()` листает кадры кадровым шагом движка. Скорость
(0.25×…4×), пауза, шаг. Студии делят **одну сессию на файл**: правки одной
видны в другой, история общая.

Чего нет (честно): события клипов — спрайтовая анимация рантайма их не
поддерживает (события есть у `$.anim` и `$.anim.player`); `pingpong` рантайм-атлас
не разворачивает (валидатор предупреждает `SDK_ATLAS_TAG_PINGPONG`); у кадров
тега рантайм берёт интервал первого кадра (`SDK_ATLAS_DURATION_MIXED`).

**Hot reload.** Движок следит не только за `.js`, но и за `*.atlas.json` в каталоге
игры ([highlevel/script.md](highlevel/script.md)): сохранили в Studio — игра
перезапустилась и прочитала новые данные без SDK. В агентском режиме слежение
выключено (как и раньше), поэтому тест гоняет игру обычным headless-процессом.

Диагностики атласа: `SDK_ATLAS_ROOT`, `_FRAMES`, `_FRAME_RECT`, `_FRAME_BOUNDS`,
`_FRAME_FRACTIONAL`, `_DUPLICATE_FRAME`, `_IMAGE_FIELD`, `_IMAGE_MISSING`, `_IMAGE_FORMAT`,
`_SIZE_MISMATCH`, `_DURATION`, `_DURATION_MIXED`, `_ROTATED`, `_TAG`, `_TAG_RANGE`,
`_TAG_DUPLICATE`, `_TAG_FRAME`, `_TAG_PINGPONG`, `_SLICE`, `_PIVOT_OUTSIDE`,
`_FORMAT_UNSUPPORTED`, `_GRID`, `_GRID_REMAINDER` (префикс `SDK_ATLAS`).

## 6. Мост `$.sdk` и агент

Игра не может порождать процессы. Проект-инструмент включает мост флагом
`"toolHost": true` (`sdk/project.json`); тогда `$.sdk.tool([...])` запускает
`r2d-sdk`, а `$.sdk.launch([...])` — сам движок. Аргументы — массив без shell,
вывод читается фоном, кадр не блокируется.

Агент управляет SDK теми же средствами, что и игрой:

```js
await $.sdkApp.openProject('demos');      // eval в агентском режиме
$.sdkApp.snapshot()                       // и раздел sdk в ответе команды state
$.ui.doc('sdk/ui/shell.rml').click('btn-build')   // нажать элемент RmlUi
```

## 7. Состояние (IMPLEMENTED / PARTIAL / NOT STARTED)

| Возможность | Статус | Примечание |
|---|---|---|
| Phase 1: оболочка (проекты, Asset Browser, реестр, запуск, сборка, документация, диагностика) | IMPLEMENTED | `tests/agent/sdk_shell_test.py`, `sdk_cli_test.py` |
| Единый launcher по `sdk_tools.json` | IMPLEMENTED | каталог показывает name, description, last_updated |
| Phase 2: Classic 2D срез (PNG → Sprite Studio → анимация → сохранение → hot reload → игра) | IMPLEMENTED | `tests/agent/sdk_classic2d_test.py` |
| Sprite Studio, Animation Studio | IMPLEMENTED для атласа и тегов | нет: tilemap, particles, collision, RmlUi Studio, события клипов |
| Валидаторы форматов | PARTIAL | `project`, `sdk.registry`, `json`, `sprite.atlas`; остальные — по фазам |
| Редакторы и Baker | NOT STARTED на момент этого раздела | см. SDK_HANDOFF.md |
| Нативный агентский клиент | NOT STARTED | Python-клиент `tools/agent_client.py` — тестовая обвязка репозитория, не инструмент SDK |
| Удаление Dear ImGui | NOT STARTED | унаследованный оверлей остаётся (SDK_AUDIT.md) |

Когда фаза закрыта — строка меняется здесь же, в том же коммите.
