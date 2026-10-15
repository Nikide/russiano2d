# Russiano2D SDK

Статус документа: описывает **фактическое** состояние SDK (не цель). Целевая
архитектура и законы — спецификация «Следующая цель SDK AGENT.md»: она снята с
текущей документации и лежит в `к удалению.md` (и в истории Git);
проверки — [SDK_VERIFICATION.md](SDK_VERIFICATION.md); журнал работы —
[SDK_HANDOFF.md](../SDK_HANDOFF.md).

Недостающие возможности и критерии их приёмки —
[SDK_IMPLEMENTATION_GAPS.md](SDK_IMPLEMENTATION_GAPS.md).

```text
GAME = CODE + DATA          SDK = R2D-приложение + инструменты для CODE + DATA
```

SDK не владеет игрой: проекты и ассеты остаются обычными файлами, а игра
запускается без SDK.

## 1. Состав

| Часть | Где | Что это |
|---|---|---|
| Приложение SDK | [`sdk/`](../sdk) | обычный проект R2D: `project.json`, `main.js`, RmlUi-документы `sdk/ui/*.rml`. Запуск: `./build/russiano2d --game sdk` или скриптом [`./run_sdk.sh`](../run_sdk.sh) |
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
  "tools": [ { "id": "sprite-studio", "name": "Sprite Studio",
               "description": "…", "last_updated": "2026-10-08T17:00:00+03:00",
               "entry": "sprite-studio", "binary": "build/r2d-sdk",
               "category": "classic-2d", "assets": ["*.atlas.json"] } ] }
```

* `id` — `a-z`, `0-9`, `-`; уникален; `last_updated` — ISO 8601 **с часовым
  поясом**; `entry` — экран (`sdk/tools/<entry>.js`) либо встроенный
  (`launcher`, `asset-browser`, `diagnostics`);
* `assets` — шаблоны имён файлов (`*` и `?`, без учёта регистра): так Asset
  Browser выбирает инструмент для файла;
* `binary` — необязательный относительный путь к нативному бинарнику.

Состав реестра (15 компонентов, каждый ровно один раз; тест `sdk_studios_test.py` сверяет его с
наличием экранов): оболочка — `launcher`, `asset-browser`; бэкенд — `r2d-sdk`;
Classic 2D — `sprite-studio`, `animation-studio`, `tilemap-studio`, `particle-studio`,
`collision-tools`, `parallax-tools`, `font-tools`, `audio-tools`, `input-tools`, `rmlui-studio`;
отладка — `devtools`; автоматизация — `automation`. Экран, которому нужен файл (`assets` в
записи), без файла ведёт в Asset Browser с
фильтром и подсказкой `SDK_PICK_ASSET`; студии с `export const standalone = true` открываются сразу.

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
| `batch <manifest.batch.json> [--output report.json]` | пакетная проверка (`validate`), ошибки отдельных jobs не прерывают пакет |
| `agent <session.agent.json> [--engine путь] [--output report.json]` | нативный клиент исходного агентского протокола движка |
| `templates [--root sdk/templates]` | шаблоны проектов (`sdk/templates/<id>/template.json`): имя, описание, число файлов |
| `new <шаблон> <каталог> [--name «Имя»] [--root sdk/templates]` | создать проект копированием файлов шаблона; `{{name}}` в текстовых файлах заменяется именем; непустой каталог не перезаписывается (`SDK_DEST_EXISTS`) |
| `engines [--engine путь]` | найденные сборки движка `russiano2d` (рядом с `r2d-sdk`, `dist/*`, `R2D_ENGINE`) и используемая |
| `run <каталог> [--scene s] [--frames N] [--headless] [--engine путь]` | запуск игры движком |
| `build <каталог> --out f [--entry main.js] [--encrypt\|--no-encrypt]` | сборка в один файл (`russiano2d build`); каталог результата создаётся |

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

## 7. Automation / Batch

`r2d-sdk batch manifest.batch.json --output report.json` использует тот же C
validator, что GUI. Пути source jobs относительны каталогу манифеста.

```json
{ "version": 1, "jobs": [
  { "op": "validate", "source": "proj/project.json" },
  { "op": "validate", "source": "proj/ui/menu.rml" }
] }
```

Поддержана операция `validate` (проверка ассета тем же реестром проверок, что
`r2d-sdk validate`). Пакет продолжает обработку после ошибки; выход содержит
total/succeeded/failed, warnings, jobs с исходными diagnostics/result. Код
выхода 1 при ошибке job или записи отчёта. Неизвестная операция (например,
вырезанный `bake-re2d`) — структурная ошибка `SDK_BATCH_OPERATION`, а не
молчаливый пропуск.

`r2d-sdk agent session.agent.json --output report.json` запускает движок в режиме
agent/headless/fixed-dt с seed и последовательно пересылает исходные requests.
Это клиент существующего протокола, без второго игрового API или Python runtime.
Ответы и их id сохраняются, неизвестная команда остаётся ошибкой движка; quit
допустим последним. После сессии дочерний процесс освобождается.

```json
{ "version": 1, "game": "../../sdk", "seed": 7, "timeoutMs": 30000,
  "requests": [
    { "cmd": "step", "frames": 4 },
    { "cmd": "eval", "code": "$.sdkApp.snapshot()" },
    { "cmd": "quit" }
  ] }
```

Путь game относителен сессии; scene — необязательная строка. Seed — uint32 (по умолчанию 1).
Timeout — целое число 1..600000 мс,
максимум 4096 requests/jobs. Экран `automation` сохраняет JSON и запускает
batch/agent через тот же мост, отображая машинный отчёт. Он доступен из реестра,
а API — в `$.sdkApp.studios.automation`, снимок — `state.sdk.studios.automation`.
CI вызывает SDK native tests, CLI, batch manifest,
паритет всех 19 команд агента, а также паритет JS ↔ C студий данных,
мышь агента и сами студии (шаг в `.github/workflows/build.yml`, удалённо не запускался);
сохраняет машинные отчёты артефактами.

## 8. Состояние фаз

| Фаза | Статус по acceptance §60–67 | Проверка |
|---|---|---|
| 0 Audit | IMPLEMENTED | SDK_HANDOFF.md, последующий аудит SDK_VERIFICATION.md |
| 1 Shell | IMPLEMENTED | sdk_shell_test, sdk_cli_test |
| 2 Classic 2D vertical slice | IMPLEMENTED | sdk_classic2d_test |
| 3 Студии данных Classic 2D | IMPLEMENTED | sdk_studios_test, sdk_data_parity_test |
| 4 Automation / Batch | IMPLEMENTED | sdk_automation_test, CI manifest и workflow |

Это закрытие перечисленных вертикальных срезов. Все компоненты реестра
открываются (Tilemap, Particle, Collision/Physics, Parallax,
Font/Text, Audio, Input, RmlUi Studio, DevTools — §10–§13). Не реализованы:
graph editor кривых, выбор элемента кликом в предпросмотре RmlUi Studio, drag-ресайз
фигур коллизии и drag зон акустики (числовые поля есть). ImGui удалён; весь UI и runtime диагностика — RmlUi.

## 9. Запуск и поставка

Текущий SDK запускается из исходного checkout: `cmake --build build`, затем
`./build/russiano2d --game sdk`. Нативный CLI — `build/r2d-sdk`. Хостовый
CMake собирает его автоматически; в Emscripten этот target не включается.
Опубликованные `dist/` 0.1.22 не содержат завершённый SDK.
`tools/release.py` пока упаковывает engine/game/assets, а не SDK-приложение.
Проверенная упаковка SDK остаётся в [TASKS.md](TASKS.md) §5.

Короткий путь — [`./run_sdk.sh`](../run_sdk.sh): находит бинарник движка
(`R2D_BINARY` → `build/russiano2d` → `build/nikiniki2d` → `build-release/russiano2d`),
при необходимости собирает (`--build`, `NO_BUILD=1` отключает), проверяет наличие
`build/r2d-sdk` и запускает движок с `--game sdk` **из корня репозитория** — от
каталога запуска зависят `sdk_tools.json` и `sdk/state.local.json`. Свои флаги
движка передаются дальше как есть:

```bash
./run_sdk.sh                        # открыть SDK
./run_sdk.sh --stats                # с покадровой статистикой
./run_sdk.sh --headless --seconds 5 # дымовой прогон без окна
JOBS=4 ./run_sdk.sh --build         # пересобрать и открыть
```

## 10. Студии данных Classic 2D

Семь студий работают на одном хосте (`sdk/lib/studio_host.js`, страница
`sdk/ui/data_studio.rml`): файл, undo/redo, сохранение, нативная проверка, горячие
клавиши (Ctrl+Z / Ctrl+Shift+Z / Ctrl+S), мышь над окном просмотра и кадровые хуки.
Студия — объект `def` с несколькими функциями (`left/tools/right`, `mount/unmount`,
`tick`, `api`); код студии не строит интерфейс вне RmlUi. Каждая студия открывается
**без файла** (создаёт новый по имени `*.<тип>.json`, существующий **никогда не
перезаписывается**) или на выбранном в Asset Browser.

Формат каждой студии — **JSON с `version: 1`**, содержимое которого игра читает обычным
`$.fs.readJSON`; новых «баз ассетов» нет. Файл пишется в каноническом виде
(`sdk/lib/kit.js` `canonicalJson`: массивы скаляров в строку, ряд тайлов — строка файла),
поэтому `git diff` показывает только настоящие правки. Правила проверки живут в двух
копиях — JS (`sdk/lib/kinds/*.js`, живая диагностика студии) и C (`sdk/native/sdk_data.c`,
`r2d-sdk validate`, кнопка «Проверить», агент); `tests/agent/sdk_data_parity_test.py`
прогоняет ~2900 правок базовых файлов через обе и требует одинаковых `severity:code`.

| Инструмент | Файл | Игра читает так | Предпросмотр (настоящий рантайм) |
|---|---|---|---|
| Tilemap Studio | `*.tilemap.json` | `$('<tilemap>', $.fs.readJSON(f)).at(x, y).appendTo($.world)` | узел `<tilemap>` с теми же параметрами, `autotile`, палитра тайлсета |
| Particle Studio | `*.particles.json` | `$('<particles>', $.fs.readJSON(f)).at(x, y)…` | узел `<particles>`, пресеты `$.particles.preset` |
| Collision / Physics Tools | `*.collision.json` | `for (const s of f.shapes) applyShape($('<' + (s.tag \|\| 'wall') + '>').at(s.x, s.y), s)…` | настоящие `<wall>/<trigger>/<area>`, Box2D, шары |
| Parallax Tools | `*.layers.json` | `$.layers.create(l)` и спрайты в слой | настоящие слои `$.layers`, камера |
| Font / Text Tools | `*.fonts.json` | `$.font.load`, `$.font.define` | `$.font`, текст `<text>`, `$.font.measure` |
| Audio Tools | `*.audio.json` | `$.audio.bus`, `$.audio.zone`, `$.audio.play` | `$.audio` (шины, звук, зоны) |
| Input Tools | `*.input.json` | `$.input.bind(действие, клавиши)` | `$.input.bind` + тестер `$.input.down` |

Параметры файла — **те же `opts`**, что принимают соответствующие вызовы `$`
(поэтому у `tilemap`/`particles` корень файла — сами `opts`, а `version`/`name` рантайм
складывает в attrs). Подробности форматов и диагностики:

* **tilemap**: `tile` (1..512), `src`, `cols`, `solid` (bool или id), `autotile`
  (`bit16`/`blob47`), `layers[{ name, depth, solid, data[][] }]` (до 16 слоёв, ряды одной
  длины, id 0..65535). Инструменты: кисть, ластик, заливка, область; ПКМ — пипетка, СКМ —
  панорама, колесо — масштаб; мазок — один шаг undo. Режим «id» рисует цветные клетки, когда
  тайлсет не нужен. Коды `SDK_TILEMAP_*`: `FIELD, NO_SRC, AUTOTILE, LAYERS, LAYER, DATA, SHAPE,
  SIZE, TILE_ID, EMPTY_LAYER, DUPLICATE_NAME`.
* **particles**: все параметры `docs/highlevel/particles.md` §2. Стопы рамп принимают `value` и
  именованное поле так же, как рантайм (в пресетах `{ t, value }`). Неизвестное поле — предупреждение
  `UNKNOWN_FIELD` (рантайм кладёт его в attrs). Коды: `FIELD, RANGE, RAMP, COLOR, SUBEMITTER, CAP`.
* **collision**: фигуры `box|circle|capsule|polygon` (центр `x, y`; полигон — 3..8 вершин, локальные
  пиксели), `tag` (`wall|trigger|area`), `sensor`, `oneWay`, `layerBits`, `mask`. Режим «Физика»
  создаёт из файла узлы функцией `applyShape` (она же — в документации и игре) и роняет шар:
  столкновения считает Box2D. Правки: перетаскивание с привязкой к сетке, вершины полигона,
  числовые поля. Коды: `SHAPES, SHAPE, KIND, TAG, GEOMETRY, POLYGON_POINTS, POLYGON_CONCAVE, FLAG, BITS`.
* **layers**: `layers[{ name, order, parallax 0..4, visible, modulate, sprites[{ src, x, y, w, h }] }]`,
  общий `modulate`. Слой не тайлится — «ряд копий» записывает копии спрайтов явно. Предпросмотр
  двигает камеру (мышью или автопрокруткой). Коды: `LAYERS, LAYER, NAME, PARALLAX, COLOR, SPRITES,
  SPRITE, MODULATE, NO_PARALLAX`.
* **fonts**: `fonts[{ name, path }]` (.ttf/.otf) и `styles{ имя → { size 4..512, color, align,
  lineHeight, base, font } }`; итоговый стиль — `default → base → стиль`. Коды: `FONTS, FONT, STYLES,
  STYLE, SIZE, COLOR, ALIGN, LINEHEIGHT, BASE_MISSING, FONT_MISSING, CYCLE`.
* **audio**: `buses`, `sounds`, `zones`. Эффективная громкость шины считается по цепочке родителей и
  совпадает с `$.audio.gain`. Коды: `BUSES, BUS, VOLUME, EFFECT, PARENT, CYCLE, SOUNDS, SOUND, PITCH,
  BUS_MISSING, ZONES, ZONE`.
* **input**: `actions{ имя → [клавиши] }`, `deadzone`. Клавишу можно назначить нажатием. Коды:
  `DEADZONE, ACTIONS, ACTION, KEYS, UNKNOWN_KEY, CONFLICT`.

Предпросмотр берёт ресурсы по путям от корня проекта (открытый проект или каталог файла); имена
в рантайме SDK получают префикс `sdkpv-` и убираются при закрытии студии. Ограничения (честно):
у Audio нет редактирования зон мышью и записи звука; у Collision нет drag-ресайза; у Tilemap нет
редактора террейнов и анимации тайлов (есть автотайл); Font Tools не подбирает кернинг и не
умеет жирный/курсив стилем — это ограничение движка (`docs/highlevel/font.md` §6).

API для агента: `$.sdkApp.studios['tilemap-studio'].ops` (`paint`, `fillRect`, `fillAt`, `setMap`,
`addLayer`, …), аналогично `particle-studio`, `collision-tools`, `parallax-tools`, `font-tools`,
`audio-tools`, `input-tools`; общее — `$.sdkApp.studios['<id>'].undo/redo/save/validate/select`
(методы самой студии, не её `ops`), снимок —
`state.sdk.studios.<id>`.

## 11. RmlUi Studio

`sdk/tools/rmlui-studio.js` + `sdk/ui/rmlui_studio.rml`: открывается на `*.rml` (стили берёт из
`<link type="text/rcss">`) и на `*.rcss` (ищет документ, который его подключает; нет — пример
разметки, не сохраняется). Раскладка по спецификации §17: дерево элементов | предпросмотр |
свойства, снизу RCSS. Файлы остаются обычным текстом: студия меняет только правимый фрагмент
(`sdk/lib/rml_model.js`: терпимый разбор с позициями, `setAttrs`, `setInnerText`, дублирование,
перемещение, удаление). Любая правка — команда undo/redo.

Предпросмотр — **настоящий RmlUi**: черновики документа и стилей пишутся рядом с оригиналом
(`.r2d-draft-*`, Asset Browser их не показывает), загружаются `$.ui.doc` и прижимаются к окну
просмотра; закрытие студии удаляет черновики. Сломанная разметка не загружается в предпросмотр, а
показывается диагностикой `SDK_RML_UNBALANCED` / `SDK_RML_UNCLOSED` / `SDK_RML_ROOT` /
`SDK_RCSS_BRACES` / `SDK_RCSS_COMMENT` (те же коды у `r2d-sdk validate` для `rmlui.document` и
`rmlui.style`). Не реализовано: выбор элемента кликом в предпросмотре (в RmlUi-интеграции нет
hit-test API), проверка свойств RCSS (разбор — дело RmlUi; движок пишет предупреждения в журнал).

## 12. DevTools

`sdk/tools/devtools.js` + `sdk/ui/devtools.rml` — инспектор **запущенной игры**, только чтение
(спецификация §18). Студия собирает сессию исходного агентского протокола и запускает её нативным
`r2d-sdk agent`: игра идёт headless и детерминированно (`fixed-dt`, seed). Показывает `state`,
сущности по селектору `$` (`query`), профиль кадра (`profile`) и скриншот кадра игры; свои команды
(JSON-массив) выполняются перед опросом. Сессию можно сохранить в `*.agent.json` и повторить в
Automation. Описание сущностей даёт игровой `$.agent` — те же понятия `$`, что у человека и агента;
второй реализации поиска нет. Это не scene editor: ничего не пишется в данные игры.

## 13. Шаблоны, сборки движка, запуск, отладка, пакет

Экраны оболочки по §9 спецификации: **Шаблоны** (`r2d-sdk templates` / `new`; поставляются `blank`,
`platformer`, `tilemap-room`, `ui-menu` в `sdk/templates/`; созданный проект открывается сразу и в
SDK не нуждается), **Сборки движка** (`r2d-sdk engines`; показывает, какой бинарник используется),
**Запуск и сборка**: Run, **Debug** (запуск со статистикой кадра `--stats`), Build (один файл) и
**Package** (тот же файл без шифрования). Операции: `$.sdkApp.createFromTemplate`,
`loadEngines`, `debugProject`, `packageProject`.

## 14. Оформление и поведение интерфейса

Тема SDK — `sdk/ui/theme.rcss` в палитре сайта (`site/style.css`: фон `#0b0e14`, акцент
`#ff5a3c → #ffb03a`, скругления 14/10/6), общая для оболочки (`shell.rcss`) и студий
(`studio.rcss`). Правила RmlUi, которые легко нарушить:

* **Полосам прокрутки нужны стили** (`scrollbarvertical`, `sliderbar`, …): без них RmlUi резервирует
  под полосу всю ширину контейнера с `overflow: auto`, и содержимое схлопывается до нуля — так были
  «мёртвыми» кнопки каталога инструментов. Стили заданы в `theme.rcss`; не удаляйте их.
* RCSS не поддерживает `@import`, переменные и градиентные декораторы в этом рендерере:
  `theme.rcss` подключается ссылкой `<link>` в каждом документе, цвета повторены литералами.
* Шрифт интерфейса — Open Sans: «→», «←», «●» в нём нет (используйте «»», «•»).

Нажатие мышью: виртуальная мышь агента теперь доходит до RmlUi (`r2d_app_begin_frame` отправляет
изменения позиции, кнопок и колеса подписчикам SDL-событий) — агент нажимает настоящие кнопки
интерфейса, наводит курсор и крутит списки; см. [AGENT_API.md](AGENT_API.md) §3.5 и
`tests/agent/ui_virtual_mouse_test.py`. RmlUi прокручивает плавно: после колеса положение
элементов (`rect`) меняется ещё несколько кадров.

Тесты: `tests/js/sdk_kinds_test.mjs`, `tests/js/sdk_rml_test.mjs` (чистая логика),
`tests/agent/sdk_data_parity_test.py` (JS ↔ C), `tests/agent/sdk_studios_test.py` (все студии, оболочка,
шаблоны, движки, запуск/пакет — настоящей мышью), `tests/agent/ui_virtual_mouse_test.py` (движок).

## 15. Проверка созданием игры (2026-10-09)

`games/neon-courier` — законченная небольшая аркада: шесть посылок, два движущихся
дрона, щит, таймер, пауза, победа/поражение и новый рейс. Проект создан шаблоном
blank через кнопку SDK; управление сохранено Input Tools; частицы изменены
Particle Studio с undo/redo/save. Gameplay остаётся обычным `main.js`, UI — RmlUi.
Запуск и Package проверяются через SDK, результат запускается без SDK.

Проверка выявила и устранила ошибки общего рабочего процесса: RmlUi теперь
ищет файлы выбранного `--game` перед стандартным проектом; builder включает
данные каталога точки входа также для корневого `main.js`; `$.fs.readJSON`
читает встроенный payload, шрифты RmlUi из payload сохраняют имя семейства,
обработчики кнопок подключаются также в автономной игре. Регрессии —
`highlevel_game_path_test.py` и `neon_courier_test.py`. Для автономного текста
проект явно содержит Open Sans с лицензией.

Полная сверка философии и большого гайдлайна — [SDK_VERIFICATION.md](SDK_VERIFICATION.md).

## 16. Завершение рабочего процесса (2026-10-09)

- F1 / `--overlay` / `$.debug.on()` — общая RmlUi диагностика DevTools;
  ImGui удалён из source/dependencies/build/input/render. F2 — инспектор узлов.
- Package платформы включает `r2d-sdk`, `sdk/`, шаблоны, `sdk_tools.json`,
  handoff и документацию. Backend должен лежать рядом с переданным engine binary.
  Пакет проверяется распаковкой и созданием/запуском/сборкой проекта без checkout.
- Собранная игра переносит соседний `lib/`; весь каталог игры, включая `lib/`,
  распространяется вместе. Конфликт библиотек — ошибка, без их перезаписи.
- Autosave раз в 2 секунды пишет отдельный `.r2d-recovery-<asset>.json` рядом
  с ассетом. Исходник меняется только Save. После crash студия предлагает
  restore/discard/later на RmlUi. Restore — undo-команда; изменение исходника
  после autosave показывается как конфликт. Data/atlas/RmlUi
  histories используют один recovery host. API агента:
  `$.sdkApp.recovery.snapshot()/flush()/restore(abs)/discard(abs)/offer(abs)`.

Новые регрессии: sdk_runtime_ui / sdk_package / sdk_recovery. Подробные
доказательства — SDK_HANDOFF и SDK_VERIFICATION.
