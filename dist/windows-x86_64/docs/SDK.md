# Russiano2D SDK

Статус документа: описывает **фактическое** состояние SDK (не цель). Целевая
архитектура и законы — спецификация «Следующая цель SDK AGENT.md»: она снята с
текущей документации и лежит в `к удалению.md` (и в истории Git);
проверки — [SDK_VERIFICATION.md](SDK_VERIFICATION.md); журнал работы —
[SDK_HANDOFF.md](../SDK_HANDOFF.md).

Недостающие возможности, текущие доработки Re2D и критерии их приёмки —
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

Состав реестра (18 компонентов, каждый ровно один раз; тест `sdk_studios_test.py` сверяет его со
спецификацией §8 и наличием экранов): оболочка — `launcher`, `asset-browser`; бэкенд — `r2d-sdk`;
Classic 2D — `sprite-studio`, `animation-studio`, `tilemap-studio`, `particle-studio`,
`collision-tools`, `parallax-tools`, `font-tools`, `audio-tools`, `input-tools`, `rmlui-studio`;
отладка — `devtools`; Re2D — `re2dsprite-studio`, `re2d-baker`, `re2d-world-studio`; автоматизация —
`automation`. Экран, которому нужен файл (`assets` в записи), без файла ведёт в Asset Browser с
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
| `re2d-info <character.json\|png> [--model описание.json]` | Re2DSprite: карты PNG v2 **или контейнер v3** — части/кости, статистика, материалы и проверка |
| `re2d-debug <character.json\|png> --mode m --out f.png [--scale 1..16] [--model описание.json]` | Re2DSprite: отладочный вид поверхности (по умолчанию `--scale 3`, у крупной сетки v3 — `1`). Карты v2: `material part owner x y z coverage group overlap`; контейнер v3: `material normal gloss owner weight coverage x y z` |
| `re2d-sample <character.json\|png> --x mx --y my [--model описание.json]` | Re2DSprite: один отсчёт карты v2 (ID, XYZ, покрытие, владелец) или тексель v3 (цвет, позиция, нормаль, блеск, кости с весами) |
| `re2d3-paint <png\|character.json> --edits правки.json [--out путь.png] [--model описание.json]` | Re2DSprite v3: правка сетки текселей (кость, блеск, цвет) и запись контейнера; без `--out` пишет на месте, при ошибке любой операции файл не трогает |
| `convert-re2d3 <v2.png> [--character x.character.json] [--output каталог] [--name имя] [--density 2..12] [--raster 128..2048]` | апгрейд Re2DSprite v2 → контейнер v3 |
| `bake-re2d3 <модель.fbx\|.glb\|.gltf\|.obj> --output каталог [--name имя] [--grid 512..2048] [--extent N] [--scale S] [--fit 0.94] [--clips имя=клип[:l],…] [--fps 30] [--eye x,y,z] [--raster N] [--cull] [--motion-lod 0..4] [--detail 0.25..8]` | Re2D Baker v3: модель → плотный контейнер v3 + клипы скелета |
| `bake-re2d <модель.glb\|.gltf\|.vrm\|.obj\|.fbx> --type prop\|character\|weapon\|environment --output каталог [--uv auto\|existing\|optimized] [--origin center\|feet] [--size 1024\|2048\|4096] [--scale S] [--name n] [--style s] [--first-id N] [--expression имя]` | Re2D Baker: GLB/glTF → Re2DSprite |
| `animation-import <motion.fbx> --rig character.json --output animations.json [--clip name] [--stack name] [--fps 30] [--seam .2]` | FBX humanoid motion → существующий rig Re2DSprite |
| `world-compile <f.re2dmap> [--renderer] [--output f.re2dworld]` | --renderer: native baked $.re2dWorld; без флага: legacy $.re2d.world output |
| `world-info <f.re2dmap>` | compile/validation без записи результата |
| `batch <manifest.batch.json> [--output report.json]` | пакет bake-re2d / validate, ошибки отдельных jobs не прерывают пакет |
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

## 6. Re2DSprite Studio

`sdk/tools/re2dsprite-studio.js` + `sdk/ui/re2d_studio.rml`: открывается на
`*.character.json` ([RE2DSPRITE_JSON.md](RE2DSPRITE_JSON.md)). SDK **не меняет
семантику формата** и **не синтезирует спрайт сам**: изображение даёт настоящий
рантайм (`$.re2dSprite.from`), а поверхность декодирует нативный `r2d-sdk` —
у карт v2 это карты 256×192, у контейнера v3 плотная сетка текселей
([RE2DSPRITE_V3.md](RE2DSPRITE_V3.md)). Версию контейнера называет бэкенд
(`re2d-info` → `format`), студия её не угадывает.

| Вкладка | Что делает | Откуда данные |
|---|---|---|
| Вид | узел рантайма: ракурс yaw −180…180 / pitch −75…75 (поля и перетаскивание мышью), клипы, эмоции, варианты, стиль anime/pixel, тело/голова, пауза | `$.re2dSprite.*`, `info()` |
| Поверхность | карты v2: материал, ID части, владелец (кость), X, Y, Z, покрытие, группа материала, перекрытие. Контейнер v3: цвет, нормаль, блеск, кость, вес кости, покрытие, X, Y, Z; отсчёт/тексель под курсором | `r2d-sdk re2d-debug`, `re2d-sample` |
| Сетка | редактор сетки текселей **контейнера v3**: кисть по кости, блеску или цвету, размер кисти, масштаб и сдвиг вида, undo/redo, «Сохранить PNG»; у карт v2 вкладка честно отказывает (`SDK_RE2D3_ONLY`) | `r2d-sdk re2d3-paint`, `re2d-debug`, `re2d-sample` |
| Скелет | кости (pivot/portraitPivot), часть → кость, сокеты, проекция; undo/redo | `*.character.json` |
| Клипы и варианты | добавление/правка/удаление clips, emotions, variants, equipment; ключи клипа и переход по времени; preview экипировки | существующие JSON definitions и настоящий runtime |

Сохранение пишет файл **тем же отступом**, что у исходника (у файлов демо роундтрип
побайтно равен оригиналу), поэтому diff показывает только правки. После сохранения
узел читает файл с диска и следит за ним (`.re2dHotReload()`): правка снаружи
подхватывается рантаймом без перезапуска. Ошибка рантайма на невалидной модели
показывается диагностикой `SDK_RE2D_RUNTIME` рядом с фактами нативной проверки.

Нативные команды ([§4](#4-cli-r2d-sdk)): `re2d-info <character.json|png>` (версия
контейнера, части или кости, статистика, проверка), `re2d-debug --mode … --out f.png
[--scale N]`, `re2d-sample --x mx --y my`. Раскладка карт PNG v2 —
[RE2DSPRITE_V2.md](RE2DSPRITE_V2.md) и [RE2DSPRITE_MATH.md](RE2DSPRITE_MATH.md) §2:
ID (0,768), глубина (256,768), покрытие (512,768), XY (768,768) — по 256×192
отсчётов, адреса умножаются на `size/1024`. Контейнер v3 читается целиком: сетка
`W×H` из заголовка, шесть слоёв, alpha слоя позиции — признак живого текселя.

### Редактор сетки v3 (`re2d3-paint`)

Правка — это список операций над сеткой; файл операций читает нативный бэкенд
(**один код** для CLI, GUI и агента), ошибка в любой операции отменяет всю запись:

```json
{ "version": 1,
  "ops": [ { "op": "bone",  "rects": [[900, 700, 8, 8]], "bones": [[2, 255]] },
           { "op": "gloss", "rects": [[900, 700, 8, 8]], "value": 200 },
           { "op": "color", "rects": [[900, 700, 2, 2]], "rgb": [255, 0, 0] } ] }
```

Прямоугольники — в клетках сетки текселей; меняются только **живые** тексели
(alpha слоя позиции 255). Значения операций проверяются строго и все целые:
`x`, `y` — ±1000000, `w`, `h` — 1..1000000, `id` — 1..255, веса — 0..255
(сумма больше нуля), блеск и цвет — 0..255. Веса операции `bone` нормируются к
сумме ровно 255 методом наибольших остатков — ни один вес не «заворачивается»
и не превышает 255.
Заголовок контейнера при записи не пересобирается — строка 0 остаётся как была,
поэтому чужие поля не теряются. Студия держит правки в памяти и в
`.r2d-recovery-<имя ассета>.grid.json` (например, для `russi3.character.json` это
`.r2d-recovery-russi3.character.json.grid.json`), черновик пишет в `build/sdk_cache`, а сам PNG
меняет **только** по «Сохранить PNG» (как и требуют правила SDK: исходник меняет
один явный Save). После сохранения список правок обнуляется, а сохранённый PNG
становится новой базой: операции присваивающие, поэтому «отмена» после Save не
могла бы вернуть файл — теперь Undo/Redo всегда означают ровно неприменённую
разницу с ассетом. Узел рантайма перечитывает PNG сам (`engine.rotSpriteChanged`).

**Нулевые веса — факт данных.** У текселя может не быть ни одной кости с весом
(сумма 0). SDK так его и показывает (`weightsSum: 0`, `bones: []`), а в проверке
пишет `SDK_RE2D3_WEIGHT_ZERO` уровнем *info*: это не ошибка формата — рантайм на
таком текселе подставляет кость 1 с весом 255 (`src/rotsprite3.c`). Гистограмма
костей нулевые тексели не приписывает никому.

**Что означают идентификаторы в слое костей.** Контейнер хранит числа, а не имена,
и прочесть их можно двумя способами: как индекс кости + 1 (`rig.bones[id−1]`) и
как id части (`rig.parts[].id`). У моделей `bake-re2d3` эти номера совпадают —
части описываются как кости (`rig.parts[].id = индекс + 1`), поэтому обе
трактовки дают одно имя; `convert-re2d3` переносит id частей v2, и тогда верна
только вторая. `re2d-info` отдаёт обе трактовки как факты (`asBone`/`bone` и
`asPart`/`partBone`), студия показывает их и предлагает выбрать цель кисти из
костей и из частей. Идентификатор, который не описан ни так, ни так, отмечается
`SDK_RE2D3_ID_UNDECLARED`.

API для агента и тестов — тот же код, что у кнопок:
`$.sdkApp.studios.re2d.gridPaint(прямоугольники, 'bone'|'gloss'|'color', значение)`,
где значение — id кости для `bone`, целое 0..255 для `gloss` и строка `#rrggbb`
для `color`; `gridRender`, `gridSave`, `gridUndo`, `gridRedo`, `gridReset`,
`setGridMode`, `loadContainer`; снимок — `state.sdk.studios.re2d`
(`container.format`/`grid`, `grid.{tool,mode,brush,boneId,ops,painted,dirty,sample}`).

Что проверяет `validate` для `*.character.json` (стабильные коды `SDK_RE2D_*`):

| Область | Коды |
|---|---|
| описание | `ROOT`, `VERSION`, `ATLAS`, `STYLE`, `RIG`, `NAME`, `BONE_DUPLICATE`, `BONE_PARENT`, `VECTOR`, `PART_ID`, `PART_BONE`, `PART_FLAG`, `SELECTOR`, `GROUP`, `JOINT`, `CONTROL`, `PROJECTION`, `SOCKET`, `DEFAULTS`, `EMOTION` |
| анимации | `ANIM_ROOT`, `ANIM_MISSING`, `ANIM_CLIP`, `ANIM_TRACK`, `ANIM_DUPLICATE`, `ANIM_INTERPOLATION`, `ANIM_KEYS`, `ANIM_KEY_TIME`, `ANIM_KEY_ORDER`, `ANIM_KEY_VALUE` |
| связи | `EQUIPMENT`, `EQUIPMENT_SOCKET`, `EQUIPMENT_MISSING`, `VARIANT_MISSING` |
| PNG v2 | `ATLAS_MISSING`, `PNG_FORMAT`, `PNG_SIZE`, `PNG_HEADER`, `PNG_BLD_WITHOUT_SUB`, `MAP_EMPTY`, `MAP_ID_RANGE`, `MAP_ALPHA` |
| поверхность v2 (предупреждения, только факты) | `ID_UNDECLARED`, `PART_EMPTY`, `HOLE`, `SEAM` (скачок XYZ > 6 между соседями одной части), `ISOLATED`, `STALE_ID` |
| контейнер v3 | `HEADER`, `SIZE`, `EMPTY`, `COLOR_ALPHA` (ошибки), `WEIGHT_SUM`, `NORMAL`, `LAYERS`, `ID_UNDECLARED` (предупреждения), `WEIGHT_ZERO` (инфо: кость не задана, рантайм подставит кость 1), `POSITION_ALPHA`, `ISOLATED` (инфо) — префикс `SDK_RE2D3_` |

**Паритет с рантаймом.** QuickJS в инструментах SDK запрещён, поэтому правила
`validateRotDefinition`/`validateRotAnimations` продублированы в C. Тест
`tests/agent/sdk_re2d_parity_test.py` прогоняет 82 правки описания через оба
валидатора, и решения «принять/отвергнуть» должны совпасть.

Авторский редактор сохраняет записи в существующих разделах JSON. При первой правке
внешнего клипа копирует все клипы в inline `animations`, сохраняя исходный внешний
файл. `variants[group][key]` указывает на PNG донора; `equipment[key]` — на описание
модели и существующий сокет. Изменения имеют undo/redo. Клик по ключу ставит время
реального runtime (`re2dSeek`); SDK не рассчитывает позу вторым алгоритмом.

Чего в редакторе сетки нет (честно): кисть кладёт кость с весом 255 (частичные веса
между костями не размазываются), позиция и нормаль текселя не правятся — сетка
меняет только кость, блеск и цвет; **карты PNG v2 не редактируются вовсе** (только
чтение и отладочные виды). Графический редактор кривых по-прежнему не реализован.

## 7. Re2D Baker (Prop и Character)

**Закон:** 3D разрешён на этапе импорта и не становится архитектурой рантайма. Baker читает
GLB/glTF как *временный источник данных* и записывает нативный ассет Re2DSprite; результат
не содержит меша, рантайм не читает GLB, MeshRenderer'а нет.
Нативный SDK публикует каждый PNG/JSON через временный файл и rename: читатель
hot reload не получает недописанный файл. Это атомарность отдельного файла, а не
транзакция всего пакета ассетов.

```bash
build/r2d-sdk bake-re2d crate.glb --type prop --output assets/crate/
# → crate.png (PNG v2), crate.character.json, crate.animations.json (клип spin), crate.bake.json (отчёт)
```

Конвейер (`sdk/native/sdk_gltf.c`, `sdk_bake.c`; **один код** для CLI и GUI):

1. **Разбор** GLB / `.gltf` (+внешний `.bin`, `data:`-URI): иерархия узлов (матрицы и TRS),
   TRIANGLES/STRIP/FAN, индексы u8/u16/u32, `byteStride`, нормализованные UV,
   baseColorFactor/baseColorTexture (PNG/JPEG во встроенных и внешних изображениях), alphaMode, `KHR_texture_transform`.
2. **Оси Re2D:** X вправо, **Y вниз**, Z к зрителю; нормали зеркалятся вместе с осью.
3. **Coordinate Fit:** авто-вписывание в диапазон карт (X/Z −32…31.75, Y −64…63.5) с запасом
   2%; `--scale S` задаёт масштаб явно (выход за диапазон — ошибка `SDK_BAKE_FIT_OVERFLOW`);
   `--origin center|feet` (feet прижимает низ к Y=0, допустимая высота — 64 ед.).
4. **UV:** `auto` (Auto Unwrap) — 6 плоских карт по доминирующей оси нормали, плотная упаковка
   в 256×192 отсчётов с поиском минимального шага; `existing` — UV модели как есть (нужны UV
   в 0..1, наложения развёртки считаются и сообщаются). `optimized` — те же карты с распределением плотности по заполнению, семантической
   важности и ожидаемой проекции; ограничения швов сохраняются (§19).
5. **Растеризация** в сетку текселей (PNG 1024/2048/4096: на отсчёт приходится блок 4k×4k
   текселей цвета), цвет — baseColor × текстура (билинейно), cutout по alpha.
6. **Карты v2** (RE2DSPRITE_MATH.md §2): ID (часть = материал, `--first-id` по умолчанию 80),
   группа материала (ID.G), глубина Z и XY с дробными частями (SUB), покрытие; заголовок v2.
7. **Описание модели:** одна кость `object`, части по материалам, группы по именам материалов,
   клип `spin`; опционально стиль (`--style anime|pixel`).

Отчёт `*.bake.json` (он же ответ CLI, машинно-читаемый):
`{ success, ok, type, source{kind,triangles,materials,textures,skins,animations}, parts, atlasUsage,
samples, uvMode, size, sampleSpacing, uvOverlapTexels, fit{scale,origin,x,y,z,limits}, files{png,character,animations},
errors, warnings, infos, diagnostics }`.

Диагностика `SDK_BAKE_*`: `INPUT_MISSING`, `FORMAT`, `GLB_HEADER`, `GLB_CHUNK`, `GLTF_VERSION`,
`EXTENSION_UNSUPPORTED` (Draco, meshopt, basisu), `SPARSE_UNSUPPORTED`, `BUFFER_MISSING`, `ACCESSOR`,
`ACCESSOR_RANGE`, `INDEX_RANGE`, `NO_POSITION`, `NO_MESH`, `MODE_UNSUPPORTED`, `TEXTURE_MISSING`,
`IMAGE_FORMAT`, `TEXCOORD_UNSUPPORTED`, `TEXTURE_TRANSFORM`, `TEXTURE_NO_UV`, `SKIN_IGNORED`,
`ANIMATION_IGNORED`, `DEGENERATE`, `FIT_OVERFLOW`, `LOW_DENSITY`, `UV_MISSING`, `UV_RANGE`, `UV_OVERLAP`,
`UV_MODE_UNSUPPORTED`, `TYPE_UNSUPPORTED`, `PARTS_LIMIT`, `SIZE`, `MEMORY`, `EMPTY`, `WRITE_FAILED`.

**GUI** `sdk/tools/re2d-baker.js` + `sdk/ui/baker.rml`: Prop/Character/Weapon/Environment, выбранное выражение VRM, Auto/Existing/Optimized UV, размер PNG,
Feet/центр, масштаб, панель *Coordinate Fit* (диапазоны X/Y/Z, ✓), отчёт, диагностика,
превью — запечённая модель вращается настоящим `$.re2dSprite`, кнопка «Открыть результат в
Re2DSprite Studio». GUI вызывает тот же `bake-re2d`, поэтому PNG побайтно совпадает с CLI.

### OBJ (Prop)

`bake-re2d model.obj --type prop` читает Wavefront OBJ + MTL тем же конвейером, что GLB
(`sdk/native/sdk_obj.c`: `v`, `vt`, `f` в формах `v`, `v/vt`, `v//vn`, `v/vt/vn`, отрицательные
индексы, полигоны веером; `usemtl`/`mtllib`; MTL `Kd`, `d`/`Tr`, `map_Kd` — PNG/JPEG/BMP рядом с
моделью). Оси как у glTF (Y вверх); V текстуры OBJ идёт снизу вверх и переворачивается. Линии и
точки пропускаются с предупреждением, нормали и сглаживание игнорируются (нормали считает Baker),
остальные карты MTL не читаются. OBJ — временный источник: результат тот же PNG v2 +
`*.character.json`. Коды: `SDK_BAKE_OBJ_SYNTAX`, `INDEX_RANGE` (с номером строки), `NO_MESH`,
`MTL_MISSING`, `MATERIAL_MISSING`, `TEXTURE_MISSING`, `EXPRESSION_UNSUPPORTED`; как `--type character`
OBJ отвергается (нет humanoid). Тест `tests/agent/sdk_obj_test.py`, фикстуры —
`tests/fixtures/sdk/make_obj_fixtures.py`.

### FBX (Prop, Weapon, Character)

`bake-re2d model.fbx --type prop|weapon|character` читает ASCII/binary FBX через ufbx (`sdk/native/sdk_fbx.c`) тем же
конвейером, что GLB/OBJ: треугольники, UV, материалы, текстуры; результат — PNG v2 + `*.character.json`. Меш и кости — временный
источник, рантайм FBX не читает. Единицы приводятся к метрам, оси — как у glTF (Y вверх).

| Опция | Смысл |
| --- | --- |
| `--fbx-stack клип --fbx-time секунды` | вершины в позе клипа в заданный момент (скин считается ufbx); так запекается покадровая анимация: по вызову на кадр |
| `--pivot x,y,z` | фиксированная точка привязки (метры, Y вверх) вместо центрирования по габариту: кадры одного клипа обязаны совпадать |
| `--scale S` | единиц Re2D на метр; без неё каждый кадр вписывался бы по-своему |
| `--fbx-tint имя=#rrggbb,…` | цвет материала без базовой текстуры |
| `--fbx-ao имя=файл.png,…` | карта затенения, умножается на цвет (и текстура для материала без base color; `default=…` — для мешей без материала) |
| `--fbx-rot "Кость=rx,ry,rz;…"` | (character) локальные повороты костей поверх позы файла: A-поза для ретаргета `animation-import` |

Текстуры ищутся по пути из файла, рядом с моделью, в `textures/`, `../textures/`, `tex/` по имени файла.
`--type character`: Mixamo-кости (`mixamorig:Hips`, `LeftArm`, …) сопоставляются с humanoid, веса вершин (до 4 на вершину) и
узлы переходят в тот же персонажный baker, что у VRM; ходьба ретаргетится штатным `animation-import`. Не поддержано: blendshape
(предупреждение `SDK_BAKE_FBX_MORPH`), карты normal/specular. Диагностика: `SDK_BAKE_FBX_STACK` (нет клипа), `SDK_BAKE_FBX_BONE` (нет кости для `--fbx-rot`).
Ограничение формата: Re2DSprite v2 — облако из ≤49 152 отсчётов (карта 256×192); крупные кадры показывают блоки, это не настройка baker'а.
Тест: `tests/agent/sdk_fbx_test.py` (фикстура — `tests/fixtures/sdk/make_fbx_fixtures.py`).

### Character / VRM (Phase 5)

```bash
build/r2d-sdk bake-re2d hero.vrm --type character --output assets/hero/
# → hero.png, hero.character.json (10 костей, сокеты кистей), hero.animations.json (spin, walk), hero.bake.json
```

Конвейер поверх Prop (`sdk/native/sdk_char.c`; один код для CLI и GUI):

1. **Скин и VRM:** загрузчик читает узлы, `skins` (inverseBind), JOINTS_0/WEIGHTS_0 и расширения **VRM 0.x** (`extensions.VRM`) и **VRM 1.0**
   (`VRMC_vrm`): meta, humanoid-кости, пресеты выражений. Геометрия берётся в позе файла: Σ w·(world(joint)·IBM)·v.
   VRM 0.x (лицом к −Z) разворачивается на 180° вокруг Y; результат совпадает с VRM 1.0 побайтно.
2. **Rig Re2D (Auto Re2D Character):** humanoid → кости `root, head, arm*, forearm*, hip*, knee*` (Left = сторона X<0, как у Russi);
   pivot'ы из позиций humanoid-суставов, сокеты `handLeft/handRight` из кистей. Обязательные кости VRM: hips, head, руки и ноги до lowerArm/lowerLeg.
3. **Владение частями (skin ownership):** треугольник принадлежит кости Re2D с наибольшей суммой весов. Если лучшая кость набрала < 70%,
   треугольник считается *неоднозначным*: он достаётся доминирующей кости, а число и пары костей уходят в отчёт
   (`character.ownership.{ambiguous,pairs}`) и в `SDK_BAKE_SKIN_AMBIGUOUS` (warning при > 5%). Сустав без humanoid-предка → root.
   Негуманоидный скин как character — отказ (`SDK_BAKE_CHARACTER_NO_HUMANOID`), неполный humanoid — `SDK_BAKE_HUMANOID_INCOMPLETE` с именами костей.
4. **Результат — обычный Re2DSprite:** правится Re2DSprite Studio, рантайм VRM не читает, процедурные клипы `spin`/`walk` заменяются авторскими.
5. **Выражения:** `--expression happy` запекает выбранное VRM 0.x/1.0 выражение в отдельный ассет.
   POSITION morph (dense и sparse) применяется до skinning; поддержаны color и texture-transform binds.
   PNG можно использовать донором `variants.head.happy` в основном описании персонажа.
   Без выбора выражения сохраняется поза файла; `SDK_BAKE_EXPRESSIONS_NOT_BAKED` сообщает
   о доступном отдельном bake. Неизвестное имя — ошибка, неподдержанный материал bind — предупреждение.
6. **Материалы:** цвет и текстуры переносятся в PNG, MToon освещение/rim/outline не переносится
   (`SDK_BAKE_MATERIAL_FLATTENED`). Это преобразование материала в обычный Re2D цвет.
7. **Видимое сопоставление:** `character.mapping[]` содержит humanoid, node, re2d;
   Baker показывает таблицу вместе с количеством и парами неоднозначных треугольников.

Коды Character: `SDK_BAKE_CHARACTER_NO_HUMANOID`, `HUMANOID_INCOMPLETE`, `SKIN_AMBIGUOUS`, `JOINT_UNMAPPED`, `EXPRESSIONS_NOT_BAKED`, `SKIN_ATTRS`.
Тест `tests/agent/sdk_character_test.py` проверяет контракт на **синтетическом** VRM (`tests/fixtures/sdk/make_vrm_fixtures.py`);
реальный Seed-san VRM и три реальные GLB проверены дополнительно — [SDK_VERIFICATION.md](SDK_VERIFICATION.md).
Материалы MToon сводятся к baseColor; авторская анимация файла не переносится.

Weapon/Environment, optimized UV и сравнение «источник ↔ Re2D» реализованы (§19).
Не реализованы автоматическая метрика различия (§40) и FBX mesh baking (OBJ поддержан — ниже). FBX→Re2D skeletal-motion import доступен для Mixamo-подобного rig preset через `animation-import`. Качество: плоские карты по оси
дают просветы на косых гранях и швы между картами — это видно в диагностике (`LOW_DENSITY`)
и на проекциях; «идеального auto unwrap» baker не обещает.

## 8. Мост `$.sdk` и агент

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

## 9. Re2D World Studio

Экран `re2d-world-studio` редактирует `*.re2dmap` / `*.re2dmap.json` — source data, не runtime DB. Native compiler с `--renderer` выдаёт baked `.re2dworld` для нового `$.re2dWorld`. Preview использует этот compiled world через `renderToSprite`, а UI остаётся existing RmlUi.

```sh
build/r2d-sdk world-compile maps/room.re2dmap --renderer --output maps/room.re2dworld
```

Без флага compiler сохраняет legacy stepped output. В новом режиме BSP/cell/span/portal/surface tables и static light associations импортируются runtime без тяжёлого authoring build. XY cells rectangular; exact same-XY source rectangles объединяются в native owner с несколькими spans. Continuous slopes — одна plane; stairs дают шаги с соседними native openings. Authored walls блокируют generated links только при пересечении высоты opening.

Инструменты: synchronized XY plan/height section, добавление/удаление, JSON properties, grid move, split/join коллинеарных стен, undo/redo, save/compile/validation; author/move static lights; debug-view cycling, CPU/GPU selection, lighting toggle. PreviewMaterial задаёт имя, surface IDs и PNG albedo/normal/emissive для настоящего material bank. Это preview configuration, не новый world mesh format.

Source sections version/name/cells/walls/portals/stairs/slopes/lighting/lights. Cells используют rect:[x,y,w,h]; native loader input использует x/y/w/h. Compiler diagnostic ведёт к source object. Source PVS report и runtime BSP/portal-window visibility — разные данные; legacy runtimeUsed:false нельзя переносить как утверждение об отсутствии culling в новом renderer. Текстуры/continuous slopes/portals/sample depth уже реализованы в новом пути.

Полное описание: [World formats](re2d/RE2D_WORLD_FORMAT.md), [runtime API](highlevel/re2d.md), [migration](re2d/RE2D_MIGRATION.md). Проверки: sdk_world_test.py81, dedicated sdk_world_studio_test.py19, renderer55; latest full-lab21. Это local run evidence, не hosted CI/package publication claim. UI редактирует inspectable files; игра запускается из собственного project context без работающего SDK.

## 10. Automation / Batch

`r2d-sdk batch manifest.batch.json --output report.json` использует те же C baker и
validator, что GUI. Пути source/output jobs относительны каталогу манифеста.

```json
{ "version": 1, "jobs": [
  { "op": "validate", "source": "world.re2dmap" },
  { "op": "bake-re2d", "source": "hero.vrm", "type": "character",
    "output": "hero", "origin": "feet", "expression": "happy" }
] }
```

Baker job принимает type, name, uv, origin, size, scale, style, firstId, expression.
Пакет продолжает обработку после ошибки; выход содержит total/succeeded/failed,
warnings, jobs с исходными diagnostics/result. Код выхода 1 при ошибке job или
записи отчёта. Повторный output в одном пакете отклоняется.

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
CI вызывает SDK native tests, CLI, expression regression, batch manifest,
паритет всех 19 команд агента, а также паритет JS ↔ C студий данных, импорт OBJ,
мышь агента и сами студии (шаг в `.github/workflows/build.yml`, удалённо не запускался);
сохраняет машинные отчёты артефактами.

## 11. Состояние фаз

| Фаза | Статус по acceptance §60–67 | Проверка |
|---|---|---|
| 0 Audit | IMPLEMENTED | SDK_HANDOFF.md, последующий аудит SDK_VERIFICATION.md |
| 1 Shell | IMPLEMENTED | sdk_shell_test, sdk_cli_test |
| 2 Classic 2D vertical slice | IMPLEMENTED | sdk_classic2d_test |
| 3 Re2DSprite Studio | IMPLEMENTED | sdk_re2dsprite_test, sdk_author_test, sdk_re2d_parity_test |
| 4 Baker MVP Prop | IMPLEMENTED | sdk_baker_test, реальные BoxTextured/Duck/Lantern |
| 5 Character / VRM | IMPLEMENTED по acceptance | sdk_character_test, sdk_expression_test, реальный Seed-san |
| 6 World Studio | IMPLEMENTED по acceptance | sdk_world_test, sdk_world_studio_test; same-XY/different-height |
| 7 Automation / Batch | IMPLEMENTED | sdk_automation_test, CI manifest и workflow |

Это закрытие перечисленных вертикальных срезов. Все компоненты дерева §8 спецификации
теперь есть в реестре и открываются (Tilemap, Particle, Collision/Physics, Parallax,
Font/Text, Audio, Input, RmlUi Studio, DevTools — §13–§16). Не реализованы:
универсальный FBX-ретаргетинг, автоматическая метрика сравнения с исходным 3D,
рисование **карт PNG v2** (правится только сетка контейнера v3 — вкладка «Сетка»,
§6), graph editor кривых, выбор элемента кликом в предпросмотре RmlUi Studio, drag-ресайз
фигур коллизии и drag зон акустики (числовые поля есть). ImGui удалён; весь UI и runtime диагностика — RmlUi.
Процедурный walk, ступенчатые slopes, консервативный PVS и упрощение MToon описаны
выше и не выдаются за авторскую анимацию, continuous slopes или lighting shader.

## 12. Запуск и поставка

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

## 13. Студии данных Classic 2D

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

## 14. RmlUi Studio

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

## 15. DevTools

`sdk/tools/devtools.js` + `sdk/ui/devtools.rml` — инспектор **запущенной игры**, только чтение
(спецификация §18). Студия собирает сессию исходного агентского протокола и запускает её нативным
`r2d-sdk agent`: игра идёт headless и детерминированно (`fixed-dt`, seed). Показывает `state`,
сущности по селектору `$` (`query`), профиль кадра (`profile`) и скриншот кадра игры; свои команды
(JSON-массив) выполняются перед опросом. Сессию можно сохранить в `*.agent.json` и повторить в
Automation. Описание сущностей даёт игровой `$.agent` — те же понятия `$`, что у человека и агента;
второй реализации поиска нет. Это не scene editor: ничего не пишется в данные игры.

## 16. Шаблоны, сборки движка, запуск, отладка, пакет

Экраны оболочки по §9 спецификации: **Шаблоны** (`r2d-sdk templates` / `new`; поставляются `blank`,
`platformer`, `tilemap-room`, `ui-menu` в `sdk/templates/`; созданный проект открывается сразу и в
SDK не нуждается), **Сборки движка** (`r2d-sdk engines`; показывает, какой бинарник используется),
**Запуск и сборка**: Run, **Debug** (запуск со статистикой кадра `--stats`), Build (один файл) и
**Package** (тот же файл без шифрования). Операции: `$.sdkApp.createFromTemplate`,
`loadEngines`, `debugProject`, `packageProject`.

## 17. Оформление и поведение интерфейса

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

## 18. Проверка созданием игры (2026-10-09)

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

## 19. Завершение рабочего процесса (2026-10-09)

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
  после autosave показывается как конфликт. Data/atlas/Re2DSprite/World/RmlUi
  histories используют один recovery host. API агента:
  `$.sdkApp.recovery.snapshot()/flush()/restore(abs)/discard(abs)/offer(abs)`.
- Baker `--compare` создаёт 25 временных source PNG (yaw 0/45/90/135/180,
  pitch -45/-20/0/20/45). GUI выбирает пару: слева C source projection,
  справа настоящий `$.re2dSprite`, одинаковый масштаб и ракурс. Исходный меш
  остаётся tool-only; source PNG не является Re2D approximation.
- `--type weapon`: статическая модель и редактируемый grip socket в origin;
  автоматическое угадывание хвата не заявляется. `--type environment`: отдельная
  статическая деталь, Feet по умолчанию; это не импорт игровой сцены.
- `--uv optimized`: weighted charts по площади заполнения, важности head/face/eyes
  и фронтальной проекции. Это существующий C sampler с распределённым budget,
  без нового runtime; не обещает идеальную развёртку. Поддержан и в batch.

Новые регрессии: sdk_runtime_ui / sdk_package / sdk_recovery / sdk_comparison /
sdk_baker_modes. Подробные доказательства — SDK_HANDOFF и SDK_VERIFICATION.


## Re2DSprite v3: `bake-re2d3` и `convert-re2d3`

`r2d-sdk bake-re2d3 <модель.fbx|glb|obj> --output <каталог> [--name] [--grid 256..2048] [--extent 96] [--scale|--fit] [--pivot x,y,z]
[--fbx-tint имя=#rrggbb] [--fbx-ao имя=png] [--tiles имя=вес] [--clips имя=клип[:l]] [--fps 30]` — плотная геометрическая картинка
(`name.png`, `name.character.json`, `name.animations.json` со скин-клипами, `name.bake.json`). Формат: [RE2DSPRITE_V3.md](RE2DSPRITE_V3.md).

Опции проекции записываются в `projection` character.json (смысл полей — в [RE2DSPRITE_V3.md](RE2DSPRITE_V3.md)):
`--eye x,y,z` — камера перспективы в метрах исходной модели (для позы yaw=pitch=0), `--zoom k` → `bodyScale`, `--raster N`,
`--window x0,y0,x1,y1`, `--cull`, `--motion-lod 0..4`, `--detail 0.25..8`.

`r2d-sdk convert-re2d3 <v2.png> [--character x.character.json] [--output каталог] [--name имя] [--density 2..12] [--raster 128..2048]` — апгрейд v2→v3
без меша: ячейки управляющей сетки делятся на d×d текселей (по умолчанию 8 → сетка 2048×1536), цвет из атласа, кости по углам ячейки.
