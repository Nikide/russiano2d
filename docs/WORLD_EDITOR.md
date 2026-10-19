# Universal World Editor

Status: implemented (P1/P2 + Hammer geometry/entities/paths/build; см. «Границы»).

World Editor — Hammer-like инструмент авторинга карт Russiano2D. Он не является
ни Blender, ни Unity-подобным scene editor, ни ECS-редактором и не содержит
жанровых допущений: он редактирует brushes, faces, vertices, entities, paths,
volumes, markers, materials, surface tags, visgroups, world properties и
выполняет build/validation.

```text
*.re2dmap  --world-edit-->  *.re2dmap        (авторинг, единственный источник)
*.re2dmap  --world compile--> *.re2dworld    (native bake)
*.re2dworld --> Russiano2D runtime
```

Другого «редакторского» формата нет. Карта остаётся обычным JSON-файлом
`*.re2dmap`; компилятор/валидатор — тот же нативный код, что у CLI и runtime.

## 1. Запуск

```bash
./build/russiano2d --game sdk          # SDK GUI → инструмент world-editor
./run_sdk.sh                           # то же через скрипт
r2d-sdk tool info world-editor         # из CLI
```

Инструмент зарегистрирован в `sdk_tools.json` (`id: world-editor`, assets
`*.re2dmap`). Без выбранного файла создаётся новая карта (standalone).

## 2. Раскладка и управление

```text
+-----------------------+-----------------------+
|       TOP / XY        |       3D CAMERA       |
+-----------------------+-----------------------+
|      FRONT / XZ       |       SIDE / YZ       |
+-----------------------+-----------------------+
меню · toolbar · tool palette · object tree · inspector · status · diag
```

* Сетка: 1, 2, 4, 8, 16, 32, 64, 128, 256; переключение `[`/`]`, snap вкл/выкл,
  текущий размер — в статус-баре.
* Ортогональные вьюпорты: pan (средняя/правая кнопка или Space+drag), zoom
  (колесо), frame selection, maximize/restore 4-view.
* Инструменты: Select (brush/face/vertex/entity/path, box/multi-select),
  Block/Brush (drag footprint + высота во Front/Side или числом), Move, Resize,
  Rotate, Vertex, Clip, Face, Entity, Path.
* 3D-вьюпорт: WASD fly, RMB look, выбор brush/face, настоящий runtime preview
  `$.re2dWorld` (CPU/GPU, свет, `world.debug.view`: final/depth/owner/light/
  normal/emissive/bsp/portals/region/pvs/occluder). Отдельного wireframe-режима
  в публичном API `$.re2dWorld` нет — второго renderer'а редактор не строит.
* Undo/redo: одна логическая правка = один шаг, общий для GUI и агента;
  Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. Dirty-флаг и явное сохранение.
* F5 = Build & Run. Меню Build: Validate, Compile, Run, Build & Run.

## 3. Native backend операций

Каждая правка — один вызов `r2d-sdk world-edit`. GUI, CLI и агент используют
одну реализацию; геометрия (выпуклость, holes, clip, vertex) проверяется
нативным `sdk_brush_*`.

```text
r2d-sdk world-edit <file.re2dmap> --op <op> [--args JSON] [--out <file>]
```

`--out` пишет канонический `.re2dmap`; без `--out` результат карты
возвращается в `data`. Ответ:

```json
{"ok":true,"file":"maps/a.re2dmap","op":"brush.create","changed":true,
 "result":{"ids":["brush_1"]},"errors":0,"warnings":0,"diagnostics":[]}
```

| op | args | result |
|---|---|---|
| `brush.create` | `rect`/`polygon`, `bottom`, `top`, `tool`, цвета, `tags`, `holes`, `subtract` | `ids` |
| `brush.delete` | `ids` | — |
| `brush.duplicate` | `ids`, `dx`, `dy`, `dz` | `ids` |
| `brush.move` | `ids`, `dx`, `dy`, `dz` | — |
| `brush.set` | `ids`, `patch` (footprint/height/tool/colors/tags/visgroup) | — |
| `brush.vertex.move` | `id`, `vertex`, `x`, `y` | `id`, `vertex` |
| `brush.clip` | `id`, `axis` x/y, `coordinate`, `keep` front/back/both | `ids` |
| `face.set` | `id`, `face` side/floor/ceiling, `material`, `tags` | `id`, `face` |
| `world.set` | поля world-конверта | — |
| `entity.create/set/delete` | generic данные; неизвестные поля сохраняются | `id` |
| `path.create/path.set/path.node.*` | `nodes`, `loop`, `oneWay`, `fields` (metadata) | `id`, `index` |
| `visgroup.ensure/state` | `name`, `visible`, `locked` | `id` |
| `noop` | — | `{}` (probe/canonical write) |

Невалидная правка (concave vertex, clip вне brush'а) возвращает диагностику
`SDK_WORLD_EDIT_*`, exit code 1 и **не меняет файл** — транзакционно.

## 4. Публичный фасад

```js
const ed = $.sdkApp.studios.world;
ed.ops.createBrush({ rect: [0,0,128,128], bottom: 0, top: 128 });
ed.ops.moveSelection(16, 0, 0);
ed.ops.setGrid(16);
ed.ops.setFaceMaterial('brush_1', 'floor', '#8f8b82');
ed.ops.setTags('brush_1', ['stone']);
ed.ops.createEntity({ kind: 'example.spawn', x: 64, y: 64, h: 0 });
ed.ops.createPath([{ x: 0, y: 0 }, { x: 128, y: 0 }]);
ed.ops.ensureVisgroup('Lighting');
ed.ops.validate();
ed.ops.compile(true);
ed.ops.buildAndRun();
ed.ops.save();
```

Каждая кнопка/menu/toolbar-действие вызывает ровно эти операции; агент вызывает
их же через `$.sdkApp.studios.world.ops`. Расширения используют документированное
подмножество.

Capability discovery для агента:

```js
$.sdkApp.studios.world.capabilities();
// { editor, file, operations:[{name,args}], entityDefinitions:[], extensions:[],
//   build:['validate','compile','run','buildAndRun'], snapshot }
```

Снимок (детерминированный, компактный):

```json
{
  "active": true, "file": "maps/example.re2dmap", "dirty": true,
  "tool": "vertex", "grid": 16,
  "selection": { "kind": "brush", "ids": ["brush_12"] },
  "map": { "brushes": 42, "entities": 9, "paths": 3, "visgroups": 5 },
  "extensions": ["example.world-tools"],
  "diagnostics": { "errors": 0, "warnings": 1 }
}
```

## 5. Build workflow

| Действие | Backend |
|---|---|
| Validate | `r2d-sdk world info <map> --renderer` |
| Compile | `r2d-sdk world compile <map> --renderer --output <map>.re2dworld` |
| Run | `$.sdkApp.runProject()` (настоящий runtime) |
| Build & Run | save → validate → compile → run |

Диагностики кликабельны: выбор объекта/свойства, фокус вьюпорта. Структурные
ошибки не превращаются в console-строки.

## 6. Данные авторинга

`.re2dmap` хранит `world` (bounds, bottom/top, boundary, цвета, tags,
`regionSize`), `brushes`, `entities`, `paths`, `visgroups` и (для совместимости)
`cells/walls/portals/stairs/slopes/lights`. Неизвестные корневые ключи и
неизвестные поля объектов сохраняются при правках.

* Entity definitions — data-driven (generic bases: point/brush/volume/marker);
  ядро редактора не знает проектных классов; определения приходят из
  `sdk_extensions/*/entity_definitions/*.json` и расширений.
* Paths — generic граф узлов (add/move/connect/loop/metadata); редактор не
  знает, для чего путь используется.
* World properties: bounds/bottom/top/boundary, default floor/ceiling/side
  цвета, world/ceiling tags и `regionSize` — все редактируются через
  `world.set` (regionSize — корневое поле карты).
* Surface tags — произвольные строки проекта; неизвестные теги валидны.
* Visgroups — authoring-метаданные в самой карте, не скрытая база.

## 7. Расширение редактора

Расширение (см. [SDK_EXTENSIONS.md](SDK_EXTENSIONS.md)) может добавить в World
Editor: entity definitions, inspector sections, toolbar/menu actions, dock
panels, world tools, validators и build steps. Contribution-точки декларативны;
поведение регистрируется через `ctx.sdk.register*`. Если расширение добавило
кнопку, та же операция обязана быть доступна программно (agent parity).

`worldOverlays` реестр читает и отдаёт (`ext.overlays()`), но декларативного
формата отрисовки overlay/gizmo пока нет — это следующий шаг; остальные
contribution-точки подключены (validators идут в диагностику, buildSteps
исполняются в Build & Run, agentCommands доступны агенту).

## 8. Проверка

```bash
python3 tests/agent/world_editor_test.py     # живой движок: UI+ops+snapshot
python3 tests/agent/world_edit_cli_test.py   # CLI-контракт world-edit
./build/r2d-sdk world compile tests/fixtures/sdk/world/editor_base.re2dmap --renderer --output /tmp/a.re2dworld
python3 tests/agent/sdk_studios_test.py      # реестр инструментов
```

## 9. Границы

Ключ фасада — `$.sdkApp.studios.world`; инструменты SDK взаимоисключающие,
поэтому открытый последним World Editor перекрывает фасад Re2D World Studio
(оба используют одно имя студии; регрессии в тестах нет).

Нет ECS/scene graph/visual scripting/второго renderer'а/скрытого формата.
Полигональный mesh, sculpting, rigging и DCC-gizmo не добавляются. Материалы
поверхностей — существующий compiler contract (tool policy), а не новая
система. Runtime API не меняется: на выходе тот же `.re2dworld`.
