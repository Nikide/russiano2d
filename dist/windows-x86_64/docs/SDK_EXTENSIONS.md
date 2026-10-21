# SDK Extensions

Status: partial — native discovery, manifest validation, merged registry and
CLI operations are in `r2d`; the shared JS contribution host is connected to
Editor Hammer for World Tools, entity definitions, menu/toolbar actions,
panels, inspectors, context actions, world overlays, validators, build steps, and
agent commands.
Validator contributions currently add declared diagnostic metadata; they do
not run arbitrary extension code.

Расширения — механизм добавления инструмента, панели, сущности, валидатора или
команды агента без изменения backend. Native discovery доступен через `r2d`.
JS contributions активирует общий host из `editor/lib/shared/extensions.js`.
Editor передаёт поддержанные World contribution points в Hammer. Overlay можно
включать и выключать; его shape-данные рисуются в ортопроекциях карты.

```text
GAME       = CODE + DATA
EDITOR      = R2D APPLICATION + AUTHORING CAPABILITIES
EDITOR TOOL = CODE + DATA
EXTENSION  = CODE + DATA
```

Никакого второго runtime, renderer'а, scene graph, event bus или UI-тулкита:
расширение — обычный модуль R2D-приложения и RmlUi-интерфейс.

## 1. Effective registry

Итоговый реестр инструментов детерминированно собирается из трёх источников:

```text
built-in (sdk_tools.json)  +  user расширения  +  project расширения
                          =  effective tool registry
```

Порядок discovery: **built-in → user → project**, внутри каталога — по имени
подкаталога. `sdk_tools.json` остаётся собственностью движка; расширения
никогда в него не пишут и не переопределяют его записи молча. Дубликат
namespaced-id отключает вторую запись с `SDK_EXTENSION_DUPLICATE_ID`.

## 2. Где лежат расширения и инструменты

| Scope | Каталог | Владелец |
|---|---|---|
| built-in | `<r2d>/sdk/extensions/<id>/` + записи `sdk_tools.json` | движок |
| user | платформенный конфиг-путь: `.../russiano2d/sdk/extensions/<id>/` (на macOS — `~/Library/Application Support/russiano2d/sdk/extensions`) | пользователь |
| project | `<project>/sdk_extensions/<id>/` | проект, коммитится вместе с ним |

Project-расширения живут рядом с игрой, переживают обновление Russiano2D и не
копируются в исходники движка. Для тестов/CI у CLI есть переопределения
`--user-extensions <dir>` и `--builtin-extensions <dir>`.

В каталоге расширения ищется первый из файлов `extension.json`, `tool.json`,
`manifest.json`.

## 3. Манифест

```json
{
  "schema_version": 1,
  "id": "author.world-tools",
  "name": "World Tools",
  "description": "Дополнительные инструменты мира",
  "version": "1.0.0",
  "sdk_api": 1,
  "entry": "main.js",
  "permissions": ["project.read", "world.edit"],
  "contributes": {
    "tools": [{ "id": "author.world-tools.panel", "name": "Panel", "entry": "main.js" }],
    "menus": [{ "id": "author.world-tools.generate", "label": "Generate" }],
    "toolbar": [], "panels": [], "inspectors": [],
    "entityDefinitions": [{ "class": "author.spawn", "base": "point", "category": "Author" }],
    "worldTools": [], "worldOverlays": [], "validators": [],
    "buildSteps": [], "agentCommands": [], "contextActions": []
  }
}
```

Правила:

* `id` — **namespaced**: минимум одна точка, сегменты из `a-z0-9-`,
  начинаются с буквы/цифры (`author.world-tools`, `studio.dialogue`).
* `sdk_api` — целое, независимое от версии движка. Сейчас поддерживается
  `sdk_api = 1`. Несовпадение — `SDK_EXTENSION_API_MISMATCH`, расширение
  отключается, остальные инструменты работают.
* `entry` — JS-модуль относительно каталога расширения; должен существовать.
* `permissions` — резерв под будущую песочницу (`group.action`). Права
  декларируются с первого дня, чтобы ужесточение не потребовало менять
  формат манифеста.
* `contributes` — только массивы объектов; у каждого элемента обязателен
  `id` (у `entityDefinitions` — `class`). Ошибки —
  `SDK_EXTENSION_CONTRIBUTION_INVALID`.

### Runtime validators

Валидатор может объявить `run(map)` при регистрации через
`registerValidator`. Hammer вызывает его во время Validate с глубоко
замороженной JSON-копией карты. Callback возвращает массив до 256 объектов
диагностики (`code`, `severity` — `error`/`warning`/`info`, `message`,
`asset`, `location`, `details`). Исключение, неверный формат результата или
превышение лимита создаёт `SDK_EXTENSION_RUN_FAILED`; остальные валидаторы
продолжают выполняться. Валидатор не может менять текущую карту.

Standalone-инструмент — это тот же манифест, но с именем `tool.json` и без
(или с пустым) `contributes`:

```json
{
  "schema_version": 1,
  "id": "author.my-tool",
  "name": "My Tool",
  "version": "1.0.0",
  "sdk_api": 1,
  "entry": "main.js",
  "window": { "width": 1280, "height": 800 }
}
```

## World overlays в Hammer

World overlay — декларативная аннотация без собственного UI или renderer.
Contribution задаёт visible (по умолчанию true) и до 256 shapes:

    {
      "id": "author.spawn-guide",
      "label": "Spawn guide",
      "shapes": [
        { "kind": "point", "position": [64, 96, 0], "label": "Spawn", "color": "#ff8855" },
        { "kind": "line", "from": [0, 0, 0], "to": [128, 128, 32], "color": "#66ddaa" },
        { "kind": "rect", "min": [160, 32, 0], "max": [288, 160, 48], "label": "Area", "color": "#7799ff" }
      ]
    }

Position arrays use numeric [x, y] or [x, y, z] values; rect min/max are
opposite corners. Hammer projects shapes into Top/XY, Front/XZ, and Side/YZ.
Unsupported shape kinds and invalid coordinates are ignored, invalid colors
use a safe default, and escaped labels are limited to 256 characters.

## 4. Contribution points и общий JS-хост

Декларативные `contributes` попадают в единый реестр хоста
(`editor/lib/shared/extensions.js`, также используемый legacy shell). Код расширения получает контекст и регистрирует
поведение только через документированные функции:

```js
export function activate(ctx) {
    ctx.sdk.registerPanel({ id: 'author.world-tools.panel', title: 'Tools' });
    ctx.sdk.registerWorldTool({ id: 'author.world-tools.bevel', run(opts) { /* ... */ } });
    ctx.sdk.registerValidator({ id: 'author.world-tools.grid', run(map) { return []; } });
    ctx.sdk.registerAgentCommand({ id: 'author.world-tools.generate', run(args) { /* ... */ } });
    return { ok: true };
}
```

Доступные функции: `registerMenu`, `registerToolbar`, `registerPanel`,
`registerInspectorSection`, `registerEntityType`, `registerWorldTool`,
`registerWorldOverlay`, `registerValidator`, `registerBuildStep`,
`registerAgentCommand`, `registerContextAction`, плюс `register(kind, item)`.
Контекст: `{ $, app, sdk, manifest }`.

Hammer вызывает runtime `run(options)` у World Tool, menu, toolbar и panel
contributions, inspector sections и context actions. Inspector `fields` задаёт
поля ввода как строки либо объекты `{id, label, value}`; callback получает их
значения. Context actions показываются при выбранном объекте. В `options`
передаются объявленные `args`, снимок выделения `{kind, ids}` и
`apply(op, args)`, который выполняет операцию через сессию Hammer и её историю
Undo. Ошибка или `{ok:false, message}` показывается как
`SDK_EXTENSION_RUN_FAILED`; callback не получает DOM или изменяемую модель
карты.

Правила:

* никакого monkey-patching DOM/приватных методов — только эти точки;
* одинаковый `id` в одной точке — `SDK_EXTENSION_DUPLICATE_ID`, вторая запись
  отклоняется;
* если расширение добавляет кнопку, тот же функционал обязателен как
  программная операция (agent parity);
* UI — только RmlUi; Qt/ImGui/Electron/native widgets запрещены.

### Модули вне каталога игры

Обычные модули движка адресуются от каталога игры. Для расширений есть
отдельное пространство имён: `sdk-ext/<extension-id>/<путь>`. Хост вызывает
`$.sdk.moduleRoot(id, root)` (одна операция, общая для GUI/CLI/agent), после
чего `import('sdk-ext/<id>/main.js')` читает файл из каталога расширения —
где бы он ни лежал. Ошибка разрешения — `R2D_MODULE_EXTENSION`.

## 5. CLI (native backend `r2d`)

```text
r2d extension list   [--project DIR] [--registry FILE] [--user-extensions DIR] [--builtin-extensions DIR]
r2d extension info   <id|path> [...]
r2d extension validate [path] [...]
r2d tool list        [...]
r2d tool info        <id|path> [...]
r2d tool validate    <path>
r2d tool run         <id|path> [--project DIR] [--headless] [--frames N]
r2d tool install     <path> [--user-extensions DIR]
r2d tool uninstall   <id>   [--user-extensions DIR]
```

`r2d tool list` отдаёт объединённый массив `tools`; `r2d extension list` отдаёт
снимок `extensions`. Записи расширений содержат `source` (`builtin` |
`user` | `project`) и `module` (`sdk-ext/...`).

`tool run` сохраняет совместимость с legacy приложениями инструментов из `sdk/`.
В текущем Editor файлы и Hammer открываются через Project/Asset tree и
специализированные студии.
`--headless --frames N` позволяет прогнать инструмент без окна (CI/агент).

`tool install` копирует каталог в user-scope; `tool uninstall` удаляет его.
Существующий id не перезаписывается (`SDK_TOOL_ALREADY_INSTALLED`).

## 6. Диагностика

Все ошибки — структурные (`code`, `severity`, `asset`, `location`,
`message`, `details`); молчаливых console-строк нет.

| Код | Когда |
|---|---|
| `SDK_EXTENSION_MANIFEST` | нет/битый манифест, обязательное поле, id/version |
| `SDK_EXTENSION_DUPLICATE_ID` | id расширения или инструмента уже занят |
| `SDK_EXTENSION_API_MISMATCH` | `sdk_api` не совпал с поддерживаемым |
| `SDK_EXTENSION_ENTRY_MISSING` | JS-модуля входа нет на диске |
| `SDK_EXTENSION_INIT_FAILED` | JS-модуль не загрузился при старте |
| `SDK_EXTENSION_RUN_FAILED` | runtime contribution завершился ошибкой или отказом |
| `SDK_EXTENSION_CONTRIBUTION_INVALID` | кривая contribution-точка |
| `SDK_EXTENSION_PERMISSION` | некорректное объявление permission |
| `SDK_EXTENSION_NOT_FOUND` | `extension info` не нашёл id/path |
| `SDK_TOOL_NOT_FOUND` | инструмента нет в effective registry |
| `SDK_TOOL_ALREADY_INSTALLED` / `SDK_TOOL_NOT_INSTALLED` | install/uninstall |
| `SDK_TOOL_ENGINE_START` / `SDK_TOOL_EXIT` | запуск инструмента движком |
| `SDK_PICK_ASSET` / `SDK_NO_TOOL_FOR_ASSET` | инструменту нужен файл |
| `R2D_MODULE_EXTENSION` | module не разрешён через `moduleRoot` |

В JS-хосте одно сломанное расширение не роняет Editor: оно помечается
`enabled=false`, его уже зарегистрированные contributions отзываются, а
диагностика остаётся в общем снимке. Другие расширения продолжают работать.

## 7. Снимок для агента

В Editor общий JS host и активный Hammer доступны агенту через:

```js
$.editorApp.extensions.snapshot();
$.editorApp.activeTab().inst.snapshot().extensions;
$.editorApp.state.extensionDiags;
```

Legacy shell сохраняет дополнительный снимок registry для совместимости:

```js
$.sdkApp.snapshot();
```

```json
{
  "extensions": {
    "loaded": true,
    "extensions": [{ "id": "author.world-tools", "scope": "project", "enabled": true, "valid": true }],
    "contributions": { "panels": 1, "entityDefinitions": 2, "worldTools": 1 },
    "diagnostics": []
  },
  "registry": {
    "tools": [{ "id": "author.world-tools.panel", "source": "project", "module": "sdk-ext/author.world-tools/main.js" }],
    "extensions": []
  }
}
```

Агент не читает исходники backend, чтобы узнать список инструментов, расширений,
contribution-точек и их состояний.

## 8. Пример и проверка

Фикстура: `tests/fixtures/sdk/extensions/` (`project`, `standalone-tool`,
`invalid-api`, `z-duplicate`, `builtin`). Тест:

```bash
python3 tests/agent/sdk_extensions_test.py
```

Он проверяет discovery, дубликаты, API mismatch, merged registry, install/
uninstall и совместимость старого shell host. `tests/agent/editor_extensions_test.py`
проверяет загрузку project extension через Editor, декларативные и runtime
contributions, вывод ошибки активации в Problems, отключение и откат
contributions сломанного расширения, а также интеграцию поддерживаемых типов
в Hammer, runtime World Tool/inspector/context callbacks через историю Hammer
и декларативные overlays во всех трёх ортопроекциях.

## 9. Границы

Hammer поддерживает World Tools, entity definitions, menu/toolbar actions,
panels, inspectors, context actions, world overlays, validators, agent commands
и build steps. Расширение не может: подменить
встроенный инструмент, писать в
`sdk_tools.json`, требовать правки `sdk/`, добавлять второй UI/renderer/
scene graph, исполнять shell-команды в обход `$.sdk`.
