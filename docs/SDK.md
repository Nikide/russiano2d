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
| `re2d-info <character.json\|png>` | Re2DSprite: PNG v2, части ↔ кости, статистика карт, проверка |
| `re2d-debug <character.json\|png> --mode m --out f.png [--scale N]` | Re2DSprite: отладочный вид карт поверхности |
| `re2d-sample <character.json\|png> --x mx --y my` | Re2DSprite: один отсчёт (ID, XYZ, покрытие, владелец) |
| `bake-re2d <модель.glb\|.gltf\|.vrm> --type prop\|character --output каталог [--uv auto\|existing] [--origin center\|feet] [--size 1024\|2048\|4096] [--scale S] [--name n] [--style s] [--first-id N] [--expression имя]` | Re2D Baker: GLB/glTF → Re2DSprite |
| `world-compile <f.re2dmap> [--output f.compiled.json]` | карта → описание настоящего `$.re2d.world` |
| `world-info <f.re2dmap>` | compile/validation без записи результата |
| `batch <manifest.batch.json> [--output report.json]` | пакет bake-re2d / validate, ошибки отдельных jobs не прерывают пакет |
| `agent <session.agent.json> [--engine путь] [--output report.json]` | нативный клиент исходного агентского протокола движка |
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

## 6. Re2DSprite Studio

`sdk/tools/re2dsprite-studio.js` + `sdk/ui/re2d_studio.rml`: открывается на
`*.character.json` ([RE2DSPRITE_JSON.md](RE2DSPRITE_JSON.md)). SDK **не меняет
семантику формата** и **не синтезирует спрайт сам**: изображение даёт настоящий
рантайм (`$.re2dSprite.from`), карты PNG v2 декодирует нативный `r2d-sdk`.

| Вкладка | Что делает | Откуда данные |
|---|---|---|
| Вид | узел рантайма: ракурс yaw −180…180 / pitch −75…75 (поля и перетаскивание мышью), клипы, эмоции, варианты, стиль anime/pixel, тело/голова, пауза | `$.re2dSprite.*`, `info()` |
| Поверхность | виды карт: материал, ID части, владелец (кость), X, Y, Z, покрытие, группа материала, перекрытие; отсчёт под курсором (ID, кость, XYZ, покрытие) | `r2d-sdk re2d-debug`, `re2d-sample` |
| Скелет | кости (pivot/portraitPivot), часть → кость, сокеты, проекция; undo/redo | `*.character.json` |
| Клипы и варианты | добавление/правка/удаление clips, emotions, variants, equipment; ключи клипа и переход по времени; preview экипировки | существующие JSON definitions и настоящий runtime |

Сохранение пишет файл **тем же отступом**, что у исходника (у файлов демо роундтрип
побайтно равен оригиналу), поэтому diff показывает только правки. После сохранения
узел читает файл с диска и следит за ним (`.re2dHotReload()`): правка снаружи
подхватывается рантаймом без перезапуска. Ошибка рантайма на невалидной модели
показывается диагностикой `SDK_RE2D_RUNTIME` рядом с фактами нативной проверки.

Нативные команды ([§4](#4-cli-r2d-sdk)): `re2d-info <character.json|png>` (PNG v2, части
и кости, статистика карт, проверка), `re2d-debug --mode … --out f.png [--scale N]`,
`re2d-sample --x mx --y my`. Раскладка PNG — [RE2DSPRITE_V2.md](RE2DSPRITE_V2.md) и
[RE2DSPRITE_MATH.md](RE2DSPRITE_MATH.md) §2: ID (0,768), глубина (256,768), покрытие
(512,768), XY (768,768) — по 256×192 отсчётов, адреса умножаются на `size/1024`.

Что проверяет `validate` для `*.character.json` (стабильные коды `SDK_RE2D_*`):

| Область | Коды |
|---|---|
| описание | `ROOT`, `VERSION`, `ATLAS`, `STYLE`, `RIG`, `NAME`, `BONE_DUPLICATE`, `BONE_PARENT`, `VECTOR`, `PART_ID`, `PART_BONE`, `PART_FLAG`, `SELECTOR`, `GROUP`, `JOINT`, `CONTROL`, `PROJECTION`, `SOCKET`, `DEFAULTS`, `EMOTION` |
| анимации | `ANIM_ROOT`, `ANIM_MISSING`, `ANIM_CLIP`, `ANIM_TRACK`, `ANIM_DUPLICATE`, `ANIM_INTERPOLATION`, `ANIM_KEYS`, `ANIM_KEY_TIME`, `ANIM_KEY_ORDER`, `ANIM_KEY_VALUE` |
| связи | `EQUIPMENT`, `EQUIPMENT_SOCKET`, `EQUIPMENT_MISSING`, `VARIANT_MISSING` |
| PNG v2 | `ATLAS_MISSING`, `PNG_FORMAT`, `PNG_SIZE`, `PNG_HEADER`, `PNG_BLD_WITHOUT_SUB`, `MAP_EMPTY`, `MAP_ID_RANGE`, `MAP_ALPHA` |
| поверхность (предупреждения, только факты) | `ID_UNDECLARED`, `PART_EMPTY`, `HOLE`, `SEAM` (скачок XYZ > 6 между соседями одной части), `ISOLATED`, `STALE_ID` |

**Паритет с рантаймом.** QuickJS в инструментах SDK запрещён, поэтому правила
`validateRotDefinition`/`validateRotAnimations` продублированы в C. Тест
`tests/agent/sdk_re2d_parity_test.py` прогоняет 82 правки описания через оба
валидатора, и решения «принять/отвергнуть» должны совпасть.

Авторский редактор сохраняет записи в существующих разделах JSON. При первой правке
внешнего клипа копирует все клипы в inline `animations`, сохраняя исходный внешний
файл. `variants[group][key]` указывает на PNG донора; `equipment[key]` — на описание
модели и существующий сокет. Изменения имеют undo/redo. Клик по ключу ставит время
реального runtime (`re2dSeek`); SDK не рассчитывает позу вторым алгоритмом.
Правка карт поверхности и графический редактор кривых пока не реализованы.

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
   в 0..1, наложения развёртки считаются и сообщаются). `Re2D Optimized` — **не реализован**
   (`SDK_BAKE_UV_MODE_UNSUPPORTED`).
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

**GUI** `sdk/tools/re2d-baker.js` + `sdk/ui/baker.rml`: Prop/Character, выбранное выражение VRM, Auto/Existing UV, размер PNG,
Feet/центр, масштаб, панель *Coordinate Fit* (диапазоны X/Y/Z, ✓), отчёт, диагностика,
превью — запечённая модель вращается настоящим `$.re2dSprite`, кнопка «Открыть результат в
Re2DSprite Studio». GUI вызывает тот же `bake-re2d`, поэтому PNG побайтно совпадает с CLI.

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

Что НЕ сделано (честно): Weapon/Environment, Re2D Optimized UV, сравнение «источник ↔ Re2D» и метрика различия (§39–40
спецификации), FBX/OBJ. Качество: плоские карты по оси
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

Экран `re2d-world-studio` открывает `*.re2dmap` / `*.re2dmap.json`. Это JSON исходник,
а результат `world-compile` — описание для существующего `$.re2d.world`.
План XY и высотный разрез показывают выбор синхронно. Доступны добавление/удаление,
свойства JSON, перемещение выбранного объекта с сеткой, split/join коллинеарных стен,
undo/redo (Ctrl+Z / Ctrl+Shift+Z), палитра цветов, сохранение, compile и validation.
Диагностика ведёт к объекту; preview использует настоящий native World, камера
редактируется полями XY/eye/yaw/pitch. Данные проекта остаются обычными файлами.

Карта содержит version:1, name, cells, walls, portals, stairs, slopes. Cells задают
rect:[x,y,w,h] и spans:[{bottom,top,floorColor,ceilingColor}]; стены — from/to XY,
bottom/top/color. Лестницы раскрываются в соседние cells и вертикальные стены;
уклон — в указанное число ступенчатых segments. Порталы проверяются и вырезают
проёмы стен. PVS — консервативная portal-reachability в отчёте с runtimeUsed:false:
движок пока не применяет этот PVS для отсечения. Непрерывная поверхность уклона,
произвольные polygon cells и spatial PVS не реализованы.

Обязательная регрессия `sdk_world_test.py` проверяет два проходимых spans на
одинаковых XY: полы 0 и 160, разные support/blocked/ray результаты и независимое
редактирование этажей в `sdk_world_studio_test.py`.

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
CI вызывает SDK native tests, CLI, expression regression, batch manifest и
паритет всех 19 команд агента; сохраняет машинные отчёты артефактами.

## 11. Состояние фаз

| Фаза | Статус по acceptance §60–67 | Проверка |
|---|---|---|
| 0 Audit | IMPLEMENTED | SDK_AUDIT.md, последующий аудит SDK_VERIFICATION.md |
| 1 Shell | IMPLEMENTED | sdk_shell_test, sdk_cli_test |
| 2 Classic 2D vertical slice | IMPLEMENTED | sdk_classic2d_test |
| 3 Re2DSprite Studio | IMPLEMENTED | sdk_re2dsprite_test, sdk_author_test, sdk_re2d_parity_test |
| 4 Baker MVP Prop | IMPLEMENTED | sdk_baker_test, реальные BoxTextured/Duck/Lantern |
| 5 Character / VRM | IMPLEMENTED по acceptance | sdk_character_test, sdk_expression_test, реальный Seed-san |
| 6 World Studio | IMPLEMENTED по acceptance | sdk_world_test, sdk_world_studio_test; same-XY/different-height |
| 7 Automation / Batch | IMPLEMENTED | sdk_automation_test, CI manifest и workflow |

Это закрытие перечисленных вертикальных срезов, а не всех желательных инструментов
большой спецификации. Tilemap/particles/collision/RmlUi Studio, Weapon/Environment,
FBX/OBJ, optimized UV, сравнение с исходным 3D, рисование поверхности и graph editor
пока не реализованы. Legacy ImGui-оверлей движка сохранён; UI SDK — RmlUi.
Процедурный walk, ступенчатые slopes, консервативный PVS и упрощение MToon описаны
выше и не выдаются за авторскую анимацию, continuous slopes или lighting shader.

## 12. Запуск и поставка

Текущий SDK запускается из исходного checkout: `cmake --build build`, затем
`./build/russiano2d --game sdk`. Нативный CLI — `build/r2d-sdk`. Хостовый
CMake собирает его автоматически; в Emscripten этот target не включается.
Опубликованные `dist/` 0.1.22 не содержат завершённый SDK.
`tools/release.py` пока упаковывает engine/game/assets, а не SDK-приложение.
Проверенная упаковка SDK остаётся в [TASKS.md](TASKS.md) §5.
