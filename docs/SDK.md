# Russiano2D SDK

Статус документа: описывает **фактическое** состояние SDK (не цель). Целевая
архитектура и законы — спецификация «Следующая цель SDK AGENT.md»: она снята с
текущей документации и удалена из репозитория, текст доступен только в истории
Git (`git log --diff-filter=D -- "к удалению.md"`, файл удалён после f70762a).

Как проверяется то, что здесь написано, — в `docs/TESTING.md` (гейты и тесты,
в том числе по этому документу). Внутренние журналы работы над SDK и очередь
незакрытых возможностей в поставку не входят — они живут только в репозитории
движка.

> Практический гайд по новому tooling: [SDK_AGENT_TOOLING.md](SDK_AGENT_TOOLING.md).
> Generated API reference: [docs/api/API_REFERENCE.md](api/API_REFERENCE.md).
> Рецепты: [docs/recipes/README.md](recipes/README.md).

```text
GAME = CODE + DATA          SDK = R2D-приложение + инструменты для CODE + DATA
```

SDK не владеет игрой: проекты и ассеты остаются обычными файлами, а игра
запускается без SDK.

## 1. Состав

| Часть | Где | Что это |
|---|---|---|
| Приложение SDK | [`sdk/`](../sdk) | обычный проект R2D: `project.json`, `main.js`, RmlUi-документы `sdk/ui/*.rml`. Запуск: кликабельный `russiano2d-sdk` (двойной клик), `build-xmake/.../release/russiano2d --game sdk` или [`./run_sdk.sh`](../run_sdk.sh) |
| Реестр компонентов | [`sdk_tools.json`](../sdk_tools.json) | единственный список инструментов; launcher строит каталог по нему |
| Нативный бэкенд | [`sdk/native/`](../sdk/native) | C-бинарник `r2d-sdk` (`build/r2d-sdk`) без Python/Node.js/shell |
| Мост GUI → бэкенд | `$.sdk` ([highlevel/sdk.md](highlevel/sdk.md)) | включается `"toolHost": true` в `project.json` |
| Расширения | [`sdk/native/sdk_extension.c`](../sdk/native/sdk_extension.c), [`sdk/lib/extensions.js`](../sdk/lib/extensions.js) | discovery манифестов, merged effective registry, JS contribution host; контракт — [SDK_EXTENSIONS.md](SDK_EXTENSIONS.md) |
| Тесты | `tests/sdk/`, `tests/js/sdk*_test.mjs`, `tests/agent/sdk_*_test.py` | C, qjs и агентские |

## 1.1 Сплэш SDK (вшит в бинарник)

Пока SDK загружает реестр инструментов, расширения и версию backend, окно
показывает сплэш: картинку, название «КОМПЛЕКТ ДЛЯ РАЗРАБОТКИ (SDK)»,
текущий этап и прогрессбар. Это обычный RmlUi-документ, но его ассеты вшиты в
`russiano2d` на этапе сборки:

```text
sdk/assets/splash.jpg   \
sdk/ui/splash.rml        +--> tools/r2d_embed_assets.c --> generated/r2d_splash_data.h
sdk/ui/splash.rcss      /                                   (байты в бинарнике)
```

`cmake/Splash.cmake` генерирует заголовок, `src/gui.cpp` отдаёт эти пути из
памяти до обращения к диску. Поэтому сплэш работает и в поставке без каталога
`sdk/` рядом с бинарником; внешних файлов для него не нужно. Правка картинки/
разметки — это правка файлов-исходников и пересборка движка (как у иконок).

Прогресс не таймер: `sdk/lib/splash.js` получает этапы от `sdk/app.js`
(shell → реестр инструментов → расширения → версия backend). Минимальное время
показа 0.9 с — при быстром старте сплэш не мигает; после `ready` документ
скрывается и не мешает оболочке.

```bash
python3 tests/agent/sdk_splash_test.py   # живой движок + проверка без файлов на диске
```
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

Состав реестра (20 компонентов, каждый ровно один раз; тест `sdk_studios_test.py` сверяет его с
наличием экранов): оболочка — `launcher`, `asset-browser`; бэкенд — `r2d-sdk`;
Classic 2D — `sprite-studio`, `animation-studio`, `tilemap-studio`, `particle-studio`,
`collision-tools`, `parallax-tools`, `font-tools`, `audio-tools`, `input-tools`, `rmlui-studio`;
Re2D — `re2d-world-studio`, `world-editor`; отладка — `devtools`, `code-check`, `api-browser`;
автоматизация — `automation`; готовые решения — `vn-narrative` (Visual Novel Maker). Экран, которому нужен файл (`assets` в
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
| `validate [каталог] [--project dir] [--type t]` | проект (project.json/main.js/asset refs/lint) или отдельный ассет |
| `api dump [--game dir] [--engine path]` | machine-readable снимок публичного `$` API из живого runtime |
| `api check [--schema f]` | структурная проверка снимка + свежесть `api.schema.json` |
| `api generate [--out-dir dir]` | записать `api.schema.json` и `russiano2d.d.ts` из runtime metadata |
| `lint [путь] [--schema f]` | API-aware линтер JS: `R2D001/002/004/014`, `--json` |
| `docs generate` | generated `docs/api/API_REFERENCE.md` из runtime metadata |
| `doctor [--project dir]` | health check: runtime/metadata/schema/typings/docs/project/lint |
| `help` | псевдоним `commands` |
| `atlas-grid <png> --out f.atlas.json (--cell WxH \| --cols N --rows N) [--prefix p] [--duration мс] [--tags idle:0-3,…]` | атлас сеткой из картинки |
| `atlas-format <f.atlas.json> [--write] [--text]` | привести к каноническому виду |
| `atlas-info <f.atlas.json>` | кадры, теги, слайсы, картинка + проверка |
| `sprite-mesh-bake <sprite.png|sprite.atlas.json> [--depth N --alpha-threshold N --units-per-pixel N --pivot-x N --pivot-y N --out cache]` | bake mesh-cache для каждого кадра атласа |
| `world compile <f.re2dmap> [--renderer] [--pvs] [--region-size N] [--output f.re2dworld]` | Re2D World: brush/cell authoring → baked мир; stage report, region grid, coarse PVS; `--pvs` добавляет legacy portal-reachability report |
| `world info <f.re2dmap>` | то же без записи: статистика/порталы/регионы/проверка карты |
| `world validate <f.re2dmap>` | компиляция в память + диагностика без записи |
| `world-edit <f.re2dmap> --op op [--args json] [--out f]` | правка карты как операция backend (brush/face/world/entity/path/visgroup); те же native-правила геометрии, что у компилятора — один backend для GUI World Editor и агента ([WORLD_EDITOR.md](WORLD_EDITOR.md)) |
| `extension list\|info <id>\|validate [path]` | расширения SDK: discovery built-in/user/project, манифесты, `sdk_api`, дубликаты ([SDK_EXTENSIONS.md](SDK_EXTENSIONS.md)) |
| `tool list\|info <id>\|validate <path>\|run <id>\|install <path>\|uninstall <id>` | standalone SDK-инструменты и contributed tools; тот же loader/registry, что у расширений |
| `world-compile <f.re2dmap> [--renderer] [--pvs] [--region-size N] [--output f.re2dworld]` | legacy alias `world compile` |
| `world-info <f.re2dmap>` | legacy alias `world info` |
| `story validate <каталог|файл> [--assets-root dir]` | VN: `*.scene` → duplicate labels, unknown goto, unreachable branches, goto cycles, speakers/expressions (`speakers.json`), assets, theme, i18n keys |
| `dialog validate <file.rml>` | VN: `<rml>` root, semantic `data-dialog-role` (root/text/choices), balanced tags, linked RCSS, `@font-face` files |
| `deps <проект\|deps.json> [--check\|--record] [--json]` | граф зависимостей ассетов: что устарело по содержимому, служебный кэш `.r2d/cache/assets.json` (§4.1) |
| `batch <manifest.batch.json> [--output report.json]` | пакетная проверка (`validate`), ошибки отдельных jobs не прерывают пакет |
| `agent <session.agent.json> [--engine путь] [--output report.json]` | нативный клиент исходного агентского протокола движка |
| `templates [--root sdk/templates]` | шаблоны проектов (`sdk/templates/<id>/template.json`): имя, описание, число файлов |
| `new <шаблон> <каталог> [--name «Имя»] [--root sdk/templates]` | создать проект копированием файлов шаблона; `{{name}}` в текстовых файлах заменяется именем; непустой каталог не перезаписывается (`SDK_DEST_EXISTS`) |
| `engines [--engine путь]` | найденные сборки движка `russiano2d` (рядом с `r2d-sdk`, `dist/*`, `R2D_ENGINE`) и используемая |
| `run <каталог> [--scene s] [--frames N] [--headless] [--engine путь]` | запуск игры движком |
| `build <каталог> --out f [--entry main.js] [--encrypt\|--no-encrypt]` | сборка в один файл (`russiano2d build`); каталог результата создаётся |

`validate <проект>` и `lint` ищут `api.schema.json` в таком порядке:
явный `--schema`, каталог проекта, cwd, каталог `r2d-sdk` и два уровня выше него.
Поэтому установленный пакет проверяет проект из любого каталога, а явный
`--schema` не подменяется: нет файла — структурная `SDK_LINT_SCHEMA` с этим
путём. `run` и `build` передают движку абсолютный путь проекта: относительный
путь считается от cwd (движок резолвит `--game` от своего базового каталога,
поэтому раньше относительный запуск из пакета искал игру рядом с бинарником).

Явный `--engine` не подменяется молча: нет файла → `SDK_ENGINE_NOT_FOUND`.

### 4.1. Граф зависимостей ассетов

`r2d-sdk deps <проект|deps.json> [--check|--record] [--json]` отвечает, что
устарело, и **ничего не собирает сам**: бейкер остаётся тем инструментом,
который пишет выходы (`atlas-grid`, импортёр проекта и т. п.). Второго build
system и закрытой ассет-базы нет — источники, выходы и манифест остаются
обычными файлами, игра запускается без SDK.

Манифест `deps.json` (рядом с `project.json`; `--project dir` переопределяет
корень, от которого считаются пути и кэш):

```json
{ "version": 1, "nodes": [
  { "source": "art/hero.png",
    "deps": ["art/palette.json"],
    "outputs": ["build/hero.atlas.json"],
    "baker": "atlas-grid",
    "version": 1,
    "options": { "cell": "32x32" } }
] }
```

* `source` — вход узла (файл); `deps` — файлы, которые бейкер читает кроме
  источника; `outputs` — сгенерированные файлы; `baker` + `version` +
  `options` — identity повара (любой JSON в `options`).
* `deps` может ссылаться на `source` **или** на `outputs` другого узла: тогда
  устаревание идёт по графу. Смена источника помечает устаревшими только его
  зависимых (транзитивно); независимые узлы остаются `up_to_date`.
* Истина — **содержимое**: FNV-1a 64 источника/зависимостей/выходов (тот же
  алгоритм, что в движке). `mtime` пишется в кэш справочно и сам по себе
  устаревания не вызывает. Пропавший выход — stale (`output_missing`),
  изменённый вручную — `output_changed`; правка `baker`/`version`/`options` —
  `baker_changed`/`version_changed`/`options_changed`.
* Пути в манифесте — только относительные, без `.`, `..`, `//`, `\\` и диска:
  иначе `SDK_DEPS_PATH`; для существующих файлов дополнительно сверяется
  реальный путь (симлинк не выводит за каталог проекта).
* Цикл зависимостей — `SDK_DEPS_CYCLE`, отсутствующий источник/зависимость —
  `SDK_DEPS_SOURCE_MISSING`/`SDK_DEPS_DEP_MISSING`; это ошибки, а не stale.

Кэш `.r2d/cache/assets.json` — **служебный**: в git не нужен, runtime его не
читает никогда, Asset Browser его не показывает (каталоги с `.` пропускаются).
Он хранит по узлу: путь источника, хеш содержимого, `mtime`, размер, список
`deps`/`outputs` с их хешами, `baker`, `baker_version` и `options`; сверху —
`version` и версия `r2d-sdk`. Потеря или порча кэша — предупреждение
`SDK_DEPS_CACHE` и «все узлы stale» (`not_recorded`), а не молчаливая
пересборка. Устаревшую версию кэша SDK тоже не толкует молча.

Режимы: `--check` (по умолчанию) только читает; `--record` пишет снимок
текущего состояния (после успешного бейка) атомарно и только когда нет ошибок —
иначе кэш не создаётся; `--json` добавляет `nodes` с состоянием каждого узла.
Ответ — один JSON-объект:

```json
{"ok":false,"version":1,"mode":"check","manifest":"…/deps.json",
 "project":"…","cache":"…/.r2d/cache/assets.json",
 "nodes_total":3,"up_to_date":2,"stale_count":1,
 "stale":[{"source":"art/hero.png","outputs":["build/hero.atlas.json"],
           "deps":["art/palette.json"],"reason":"source_changed",
           "reasons":["source_changed"]}],
 "recorded":false,"errors":0,"warnings":0,"infos":0,
 "diagnostics":[]}
```

Коды выхода: `0` — всё актуально (или запись удалась), `1` — есть stale или
ошибки данных, `2` — неверное использование. В режиме записи
`up_to_date`/`stale` относятся к записанному снимку, а сколько узлов изменилось
до записи — в `stale_before_record`. Коды диагностики: `SDK_DEPS_MANIFEST`,
`_VERSION`, `_NODES`, `_NODE`, `_PATH`, `_DUPLICATE`, `_DUPLICATE_OUTPUT`,
`_SOURCE_MISSING`, `_DEP_MISSING`, `_CYCLE`, `_CACHE`, `_CACHE_WRITE`,
`_EMPTY`, `_MEMORY`.

Проект без `deps.json` — структурная ошибка `SDK_DEPS_MANIFEST`, а не «всё
актуально». Проверка: `tests/sdk/deps_test.c` (`r2d_sdk_deps_test`) — запись,
`up_to_date`, устаревание только зависимых (включая транзитивное), отсутствующая
зависимость, стабильность хеша/кэша и запрет выхода за каталог проекта.

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
SDK native tests, CLI, batch manifest, паритет команд агента и JS ↔ C студий
данных, мышь агента и сами студии проверяются локальными тестами
(`tests/agent/sdk_studios_test.py` и др.); в CI/CD входят Unity-тесты через
`ctest`, а не Python-набор. Машинные отчёты сохраняются артефактами локально.

## 8. Состояние фаз

| Фаза | Статус по acceptance §60–67 | Проверка |
|---|---|---|
| 0 Audit | IMPLEMENTED | внутренние журналы аудита SDK (в поставку не входят) |
| 1 Shell | IMPLEMENTED | sdk_shell_test, sdk_cli_test |
| 2 Classic 2D vertical slice | IMPLEMENTED | sdk_classic2d_test |
| 3 Студии данных Classic 2D | IMPLEMENTED | sdk_studios_test, sdk_data_parity_test |
| 4 Automation / Batch | IMPLEMENTED | sdk_automation_test, CI manifest и workflow |

Инкрементальная сборка ассетов — `r2d-sdk deps` (§4.1): манифест
`deps.json`, служебный кэш `.r2d/cache/assets.json`, устаревание по содержимому;
проверка — `tests/sdk/deps_test.c` / `r2d_sdk_deps_test`.

Это закрытие перечисленных вертикальных срезов. Все компоненты реестра
открываются (Re2D World Studio — §9; Tilemap, Particle, Collision/Physics,
Parallax, Font/Text, Audio, Input, RmlUi Studio, DevTools — §11–§14).
Полировка §15: Particle Studio правит рампы графом RmlUi (`pp-graph`: точки
тянутся, добавляются и удаляются; JSON тот же `color_ramp`/`alpha_ramp`/
`size_ramp`, числовые поля остаются запасным путём); RmlUi Studio выбирает
элемент кликом в предпросмотре по настоящему `layoutRect` (`ops.pickAt`, только
элементы с `id`); Collision Tools тянет ручки углов box и правый край circle
(`w`/`h`/`radius`); Audio Tools двигает существующие зоны акустики мышью
(числовые поля главные). Чистая логика правок — `tests/js/sdk_studio_curves_test.mjs`.
Террейны и покадровая анимация тайлов правятся в Tilemap Studio (§11) теми же
обычными полями JSON. Не реализован кернинг Font Tools (ограничение движка).
ImGui удалён; весь UI и runtime диагностика — RmlUi.

## 9. Re2D World Studio

`sdk/tools/re2d-world-studio.js` + `sdk/ui/world_studio.rml` (+ `world_studio.rcss`,
`standalone: true`) — RmlUi-редактор исходника `.re2dmap` / `.re2dmap.json` из
реестра (`id: re2d-world-studio`, `category: re2d`, assets `*.re2dmap`,
`*.re2dmap.json`). Открывается из Launcher и из Asset Browser на выбранной карте;
без файла создаёт новую в памяти (сохранение — по кнопке). Модель правок —
`sdk/lib/world_model.js`: секции `cells`, `walls`, `portals`, `stairs`,
`slopes`, `lights` и существующая история SDK (`sdk/lib/history.js`).

Раскладка: слева дерево объектов и кнопки создания (cell/spans, стена, портал,
лестница, уклон, свет) с полем шага сетки; в центре **план XY** (прямоугольники
cell/stair/slope, отрезки стен и порталов, точки света) и **высотный разрез X**
(spans по `bottom`/`top`); под ними окно runtime preview и переключатели
`Вид: <debug>`, `CPU/GPU`, `Свет`; справа JSON-свойства выбранного объекта,
split/join стен, камера preview, список цветов поверхностей и PNG-материалы.

Операции (одна и та же операция у кнопки, агента и теста):

* выбор объекта в дереве/плане (`state.selection`), перенос мышью по сетке
  (`move(key, i, dx, dy)`, шаг из поля «Сетка перемещения»);
* `addCell/addWall/addPortal/addStair/addSlope/addLight` (кнопки `ws-add-*`),
  `delete` выбранного, правка JSON через «Применить свойства»
  (`replace(key, i, value)`; невалидный JSON — диагностика, модель не меняется);
* `splitWall` (пополам, новый id) и `joinWalls` (только коллинеарные стены с
  одинаковыми `bottom`/`top`/`color`; иначе ошибка без молчаливой правки);
* undo/redo каждой команды (`ws-undo`/`ws-redo`, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z),
  Ctrl/Cmd+S — сохранение; dirty-метка и recovery (`sdk/lib/recovery.js`);
* `compile(write=true)` пишет рядом с картой черновик
  `.r2d-sdk-world-draft.re2dmap` и вызывает **нативный** backend
  `r2d-sdk world compile <draft> --renderer --output <карта>.re2dworld`, затем
  удаляет черновик. `compile(false)`/кнопка «Обновить preview» вызывает
  `r2d-sdk world info <draft> --renderer` (то же без записи). Второго
  валидатора/компилятора в JS нет: диагностики и `stats` — из JSON backend,
  `ws-diag` кликабелен и выбирает объект по `location.section/index`;
* успешный JSON становится **настоящим** runtime-миром:
  `$.re2dWorld.fromJSON(JSON.stringify(json.world))`, отрисовка
  `renderToSprite` в окне preview. Переключатели вызывают
  `world.backend('gpu'|'cpu')`, `world.debug.view(<view>)` (final, cell/span-id,
  depth, owner, light-level, normal, emissive, bsp, portals, shadow-mask,
  overdraw, region/active-region/pvs, occluder, LOD, material-variation, ao-lite,
  vfx-budget) и `world.lighting(...)`;
* PNG-материал: `previewMaterial({name, surfaces:[id...], albedo, normal,
  emissive})` вызывает `world.material(name, options)` и
  `world.surface(id).material(name)` — альбедо/normal/emissive грузятся
  нативными ресурсами preview, это authoring-настройка, не сериализация в
  `.re2dworld`.

Ошибки — структурные диагностики со стабильными кодами: `SDK_WORLD_EDIT`,
`SDK_WORLD_PARSE`, `SDK_WORLD_READ`, `SDK_WORLD_PREVIEW`, `SDK_WORLD_MATERIAL`,
`SDK_WRITE_FAILED` плюс нативные `SDK_WORLD_*` (например `SDK_WORLD_SPAN_HEIGHT`).
Никаких молчаливых fallback'ов: при отказе компиляции старый preview освобождается,
а не выдаётся за новый.

Агент и тесты: `$.sdkApp.openTool('re2d-world-studio', {assetAbs})`, снимок —
`state.sdk.studios.world` (`active`, `path`, `dirty`, `selection`, `busy`,
`preview`, `stats`, `codes`, `data`), методы `select`, `add`, `save`,
`compile`, `previewMaterial`, `operation`, `close`. Проверки:
`tests/agent/sdk_world_studio_test.py` (экран → native compile → runtime
preview → split/join/undo/redo/свойства → свет/backend/материалы → закрытие) и
`tests/agent/sdk_studios_test.py` (запись в реестре и наличие экрана).

Ограничения: редактор правит клеточные секции; `brushes`, `world`-конверт и
`entities` сохраняются в файле без изменений, но не показываются в дереве и не
редактируются (для них — `r2d-sdk world compile` и
[RE2D_BRUSH_AUTHORING.md](RE2D_BRUSH_AUTHORING.md)); высотный разрез рисует
spans скомпилированной карты после compile, до этого — исходные `rect`/`spans`.

## 10. Запуск и поставка

SDK — обычный проект движка. Сборка и запуск из checkout:

```bash
xmake f -p macosx -a arm64 -m release -o build-xmake/macos-arm64
xmake build -y
./build-xmake/macos-arm64/macosx/arm64/release/russiano2d --game sdk
```

Нативный CLI — `r2d-sdk` в том же каталоге `release/`; Xmake собирает его
автоматически. В Emscripten этот target не включается. В релизном пакете
рядом лежит `russiano2d-sdk` и `sdk/`.

Для запуска двойным кликом есть отдельный бинарник **`russiano2d-sdk`**
(Windows — `russiano2d-sdk.exe`): он находит `sdk/project.json` рядом с собой
или вверх по дереву, переходит в каталог SDK и запускает
`russiano2d --game sdk`. Пакет SDK содержит этот файл в корне, поэтому
«нажал на бинарник — открылся SDK» работает без терминала и shell-скриптов.
Аргументы пробрасываются: `russiano2d-sdk --headless --frames 60`; явный
`--game` пользователя имеет приоритет.

Короткий путь — [`./run_sdk.sh`](../run_sdk.sh): находит бинарник Xmake-сборки
(`R2D_BINARY` → `build-xmake/macos-<arch>/**/release/russiano2d` → старые
каталоги `build/`), при необходимости собирает (`--build`, `NO_BUILD=1`
отключает), проверяет `r2d-sdk` рядом с движком и запускает `--game sdk`
**из корня репозитория** — от каталога запуска зависят `sdk_tools.json` и
`sdk/state.local.json`. Свои флаги
движка передаются дальше как есть:

```bash
./run_sdk.sh                        # открыть SDK
./run_sdk.sh --stats                # с покадровой статистикой
./run_sdk.sh --headless --seconds 5 # дымовой прогон без окна
JOBS=4 ./run_sdk.sh --build         # пересобрать и открыть
```

### 10.1. Проверка поставки (macOS arm64, 2026-10-20)

Пакет пересобран из текущего дерева штатным инструментом, без тега и
публикации: `python3 tools/release.py --platform macos-arm64 --skip-tests
--skip-tag --force --yes`. Распакованный архив проверен **вне checkout**:
`VERSION` 1.3.0, контрольные суммы 465/465, `tools/ci_package_check.py` — OK;
`r2d-sdk version` = 1.3.0 и команда `deps` в списке; `validate` проекта по
абсолютному пути из `/tmp` (и с `--schema` перед позиционным), `deps
--record/--check`, `build` и `run` с относительным каталогом, `doctor` в корне
поставки — все проверки true. Известное ограничение движка: запуск из
каталога без `game/main.js` завершается SIGABRT после лимита `--frames`
(backtrace и причина — `SDK_IMPLEMENTATION_GAPS.md`, п. 1).

## 11. Студии данных Classic 2D

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
| Tilemap Studio | `*.tilemap.json` | `$('<tilemap>', $.fs.readJSON(f)).at(x, y).appendTo($.world)` | узел `<tilemap>` с теми же параметрами, `autotile`/террейн, покадровая анимация, палитра тайлсета |
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
  (`bit16`/`blob47`/`terrain` + `terrain`), `terrains{ имя → { mode, base, border, solid,
  transitions } }`, `animations[{ tile, frames[id], fps | interval, random, offset, layer }]`,
  `layers[{ name, depth, solid, data[][] }]` (до 16 слоёв, ряды одной длины, id 0..65535).
  Инструменты: кисть, ластик, заливка, область; ПКМ — пипетка, СКМ — панорама, колесо —
  масштаб; мазок — один шаг undo. «ТЕРРЕЙН» задаёт наборы и кнопкой «Красить» включает
  `mode: "terrain"`; «АНИМАЦИЯ ТАЙЛОВ» задаёт кадры явными id, fps и слой. Предпросмотр —
  настоящий `<tilemap>`, анимация идёт из `tickTilemap` (пауза/fixed-dt действуют). Режим
  «id» рисует цветные клетки, когда тайлсет не нужен. Коды `SDK_TILEMAP_*`: `FIELD, NO_SRC,
  AUTOTILE, TERRAIN, ANIM, LAYERS, LAYER, DATA, SHAPE, SIZE, TILE_ID, EMPTY_LAYER,
  DUPLICATE_NAME`.
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
у Audio нет редактирования зон мышью и записи звука; у Collision нет drag-ресайза; Font Tools не
подбирает кернинг и не умеет жирный/курсив стилем — это ограничение движка
(`docs/highlevel/font.md` §6).

API для агента: `$.sdkApp.studios['tilemap-studio'].ops` (`paint`, `fillRect`, `fillAt`, `setMap`,
`setTerrain`, `paintTerrain`, `removeTerrain`, `setAnimation`, `removeAnimation`, `addLayer`, …), аналогично `particle-studio`, `collision-tools`, `parallax-tools`, `font-tools`,
`audio-tools`, `input-tools`; общее — `$.sdkApp.studios['<id>'].undo/redo/save/validate/select`
(методы самой студии, не её `ops`), снимок —
`state.sdk.studios.<id>`.

## 11.1. Панели проверки §29: тот же backend, что CLI

Все девять инструментов §29 (Sprite, Animation, Tilemap, Particle, Collision,
Parallax, Font, Audio, Input, RmlUi, DevTools, Automation) имеют в панели две
кнопки — «Проверить» и «Проверить в игре» — и они не содержат своей логики
проверок. Единый помощник `sdk/lib/panel_check.js`:

* **`validate()`** вызывает `app.backend(['validate', path])` — тот же нативный
  валидатор, что `r2d-sdk validate`, и показывает его структурные диагностики
  (code/severity/location/message) без подмены. Поэтому коды панели **равны**
  кодам CLI на том же файле (`tests/agent/sdk_tools_panels_test.py` сравнивает
  их по каждому инструменту; корректный ассет — «ошибок 0», сломанный — коды CLI);
* **`preview()`** записывает путь preview. Файл не копируется и не ищется в базе
  проекта: тем же путём его читает игра, поэтому `previewPath === validatedPath`
  (в снимке — `previewMatchesValidated`);
* **`report()`** — сводка/import report инструмента: числа по данным и короткие
  предупреждения, которые человек читает рядом с диагностиками;
* **`snapshot()`** — `panel` в снимке студии: `validatedPath`, `previewPath`,
  `previewMatchesValidated`, `codes`, `errors`, `warnings`, `checks`, `report`.

| Инструмент | Сводка/import report панели |
|---|---|
| Sprite Studio | кадры, trim, sockets, страницы, image, расхождения material albedo/normal |
| Animation Studio | теги-клипы: диапазоны (окна), разрывы/пересечения, длительность и fps, цикл/one-shot, прерывание preview |
| Tilemap Studio | слои и их роли, occlusion-слои, тайлы, сетка, chunk budget, связи комнат, invalid geometry |
| Particle Studio | space/clock, trails, бюджет (amount/max/rate), seed для replay, one-shot, lifetime |
| Collision Tools | фигуры, роли, masks, one-way, площадь footprint, поддержка «по низу» |
| Parallax Tools | слои, спрайты, parallax-слои, порядок depth |
| Font Tools | шрифты, стили, семейства |
| Audio Tools | шины, звуки, маршруты по шинам, stems/transport, voice-лимиты, отсутствующие файлы |
| Input Tools | действия, клавиши, контексты, конфликты клавиш, gamepad/disconnect-тесты |
| RmlUi Studio | элементы, id, фокусируемые элементы (навигация), ссылки и их разрешение, отсутствующие стили, длинные строки (переполнение под перевод) |
| DevTools | scoped lifecycle сессии, число validation reports, фикстуры приёмки |
| Automation | операция, задания манифеста и их `op`, статус прогона |

Undo/redo остаётся у документа: проверка и preview не сбрасывают историю
(проверяется тестом для студий с документом). Запись нескольких зависимых файлов
идёт через save → `validate` каждого файла (RmlUi Studio пишет документ и стили
только при «Сохранить»); атомарность ограничена порядком «сначала файл, потом
проверка» — при ошибке файл уже записан, и панель показывает коды.

Публичные вызовы (человек и агент — одно и то же):

| Вызов | Что делает |
|---|---|
| `$.sdkApp.studios['<id>'].validate()` | проверка текущего файла нативным backend, возвращает `{ok, diagnostics, codes, path, report}` |
| `$.sdkApp.studios['<id>'].preview()` | preview-ссылка на runtime тем же путём (`{ok, path}`) |
| `$.sdkApp.studios['<id>'].report()` | сводка/import report (чистые данные) |
| `$.sdkApp.studios['<id>'].snapshot().panel` | что проверялось, что показал preview, коды и отчёт |
| `$.sdkApp.studios['animation'].interrupt()` | прерывание preview-анимации (кадр фиксируется) |
| `$.sdkApp.studios['devtools'].validateSession()` | записать `.agent.json` сессии и проверить его |
| `$.sdkApp.studios['rmlui-studio'].previewRun()` | «Проверить в игре» для документа RmlUi |

Чего в панелях нет (честно): запуск игры прямо из каждой студии (preview — это
ссылка на тот же файл; запуск делает кнопка оболочки/DevTools), редактирование
зон Audio мышью и drag-ресайз Collision (не изменилось с §11), а у DevTools и
Automation нет документа с undo/redo — там история не ведётся by design.

## 12. RmlUi Studio

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

## 13. DevTools

`sdk/tools/devtools.js` + `sdk/ui/devtools.rml` — инспектор **запущенной игры**, только чтение
(спецификация §18). Студия собирает сессию исходного агентского протокола и запускает её нативным
`r2d-sdk agent`: игра идёт headless и детерминированно (`fixed-dt`, seed). Показывает `state`,
сущности по селектору `$` (`query`), профиль кадра (`profile`) и скриншот кадра игры; свои команды
(JSON-массив) выполняются перед опросом. Сессию можно сохранить в `*.agent.json` и повторить в
Automation. Описание сущностей даёт игровой `$.agent` — те же понятия `$`, что у человека и агента;
второй реализации поиска нет. Это не scene editor: ничего не пишется в данные игры.

## 14. Шаблоны, сборки движка, запуск, отладка, пакет

Экраны оболочки по §9 спецификации: **Шаблоны** (`r2d-sdk templates` / `new`; поставляются `blank`,
`platformer`, `tilemap-room`, `ui-menu` в `sdk/templates/`; созданный проект открывается сразу и в
SDK не нуждается), **Сборки движка** (`r2d-sdk engines`; показывает, какой бинарник используется),
**Запуск и сборка**: Run, **Debug** (запуск со статистикой кадра `--stats`), Build (один файл) и
**Package** (тот же файл без шифрования). Операции: `$.sdkApp.createFromTemplate`,
`loadEngines`, `debugProject`, `packageProject`.

## 15. Оформление и поведение интерфейса

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
шаблоны, движки, запуск/пакет — настоящей мышью), `tests/agent/sdk_world_studio_test.py`
(Re2D World Studio → native compile → runtime preview), `tests/agent/ui_virtual_mouse_test.py` (движок).

## 16. Проверка созданием игры (2026-10-09)

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

Полная сверка философии и большого гайдлайна — во внутреннем журнале проверок
(в поставку не входит); публичная сторона — `docs/PHILOSOPHY.md` и гейты
`tests/doc_claims_test.py`, `tests/doc_coverage_test.py`.

## 17. Завершение рабочего процесса (2026-10-09)

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
доказательства — во внутренних журналах движка (в поставку не входят).

### Типы валидаторов

`r2d-sdk validate <файл>` определяет тип по суффиксу; явный `--type` важнее.
Реестр (sdk/native/sdk_validate.c):

| Тип | Суффикс | Что проверяет |
|---|---|---|
| `project` | `project.json` | ширину/высоту, строки title/version, наличие `main.js` рядом |
| `sdk.registry` | `sdk_tools.json` | реестр инструментов |
| `sdk.manifest` | `.batch.json` | `version: 1`, `jobs[]`, `op: validate` и непустой `source` |

## 18. Расширения SDK и standalone-инструменты

SDK расширяется без правки `sdk/`, `sdk/tools/` и `sdk_tools.json`: манифест
(`extension.json` / `tool.json`) объявляет namespaced id, `sdk_api`,
permissions и contribution-точки, а код расширения регистрирует поведение через
`ctx.sdk.register*`. Effective registry = built-in + user + project; дубликаты
и несовместимый `sdk_api` отключают только виновника, SDK продолжает работать.

Полный контракт, каталоги, CLI, коды диагностики и пример:
[SDK_EXTENSIONS.md](SDK_EXTENSIONS.md). Проверка:
`python3 tests/agent/sdk_extensions_test.py`.

## 19. Universal World Editor

`world-editor` — Hammer-like авторский инструмент поверх `.re2dmap`: четыре
вьюпорта (Top/Front/Side/3D), сетка и snap, brush/face/vertex/clip/entity/path,
visgroups, inspector, undo/redo, validate/compile/Build & Run. Геометрия и
компиляция остаются нативными (`world-edit`, `world compile`), GUI и агент
вызывают одни операции `$.sdkApp.studios.world.ops`.

Подробности: [WORLD_EDITOR.md](WORLD_EDITOR.md).

