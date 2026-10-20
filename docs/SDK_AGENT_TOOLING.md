# SDK agent tooling: API metadata, lint, validate, doctor

Единый backend для разработчика, GUI SDK и ИИ-агентов — **`r2d-sdk`**. Runtime
(`russiano2d`) остаётся источником истины для публичного `$ API`: SDK не держит
второй рукописный список методов.

```text
$ API (runtime) → api dump → api.schema.json / russiano2d.d.ts / API reference
                                   ↓
                              lint / validate / doctor
```

## Быстрый старт

```bash
./r2d-sdk doctor                 # здоровье runtime/API/schema/typings/docs/project
./r2d-sdk api dump               # machine-readable снимок $ API
./r2d-sdk lint game              # API-aware проверка игровых скриптов
./r2d-sdk validate game          # project.json, main.js, ссылки на ассеты
./r2d-sdk api generate           # schema + typings + docs из runtime metadata
./r2d-sdk docs generate          # только docs/api/API_REFERENCE.md
```

Все команды печатают один JSON-объект; `--json` принимается для
совместимости с GUI/CI/агентами. Код выхода: `0` — ok, `1` — диагностика,
`2` — неверное использование.

## API metadata

`api dump` запускает runtime в режиме `--dump-api`: тот обходит живой `$` и
`engine.*` после загрузки скриптов. В снимок входят:

* `path`, `kind` (`function/object/number/string/boolean/array/null`);
* для функций — `arity`, `args[{name,type}]`, `returns`;
* для констант — детерминированное `value` (плавающие значения вроде
  `engine.time`, `$.startScene`, `$.ctx.*` намеренно не записываются);
* методы selector-обёртки (`$.selection.*`) и node-обёртки (`$.fn.*`).

Снимок детерминирован и пригоден для `git diff`/CI. `api check` проверяет
структуру и свежесть `api.schema.json`; если runtime API изменился, CI падает
до генерации.

```bash
./r2d-sdk api check --engine build/russiano2d --game game
```

## Generated artifacts

`api generate` пишет:

| Файл | Что это |
|---|---|
| `api.schema.json` | нормализованный снимок для lint/CI/GUI |
| `russiano2d.d.ts` | TypeScript declarations (tooling layer, игра остаётся JS) |
| `docs/api/API_REFERENCE.md` | generated reference по namespaces/методам/константам |

Все три файла имеют заголовок `GENERATED FILE — DO NOT EDIT MANUALLY`.
Меняется только runtime `$ API`; затем `api generate`. `doctor` и CI проверяют,
что артефакты не устарели.

## Lint

`r2d-sdk lint [путь]` — детерминированный сканер JS, который понимает `$ API`,
а не только синтаксис. Он не style police и не заменяет тесты.

Стабильные коды:

| Код | Значение |
|---|---|
| `R2D001` | неизвестный метод/API (с подсказкой ближайшего имени) |
| `R2D004` | неверное количество аргументов |
| `R2D014` | неверный тип свойства |

```bash
./r2d-sdk lint game/main.js
./r2d-sdk lint game --json
```

Пример: `$("player").att(1)` → `R2D001 Unknown method "att"; did you mean "at"?`

Линтер не ругается на игровые namespace'ы и приватные `_`-имена: диагностика
появляется только если родительский namespace известен как публичный.

## Validate

`r2d-sdk validate [каталог]` проверяет проект перед запуском/build:

* `project.json` (`R2D200`), наличие `main.js`; формат 2 — `entry`, индекс
  сцен и роли файлов (`R2D201`–`R2D206`, см. [FORMATS.md](FORMATS.md));
* ссылки на ассеты в JS/RML/RCSS/JSON (`R2D100`);
* известные ассеты через те же валидаторы, что CLI (`atlas/tilemap/audio/
  input/rmlui/re2dmap/...`);
* линтер JS API (диагностики `R2D001/004/014`).

`validate <файл>` по-прежнему проверяет один ассет; `--project dir` — проект.

## Doctor

`r2d-sdk doctor [--project dir]` — один health check для CI/агента/GUI:

```text
runtime, api_metadata, schema, typings, docs, project, lint
```

`ok:true` только если все checks зелёные. В CI используется вместе с
`api check`, `lint`, `validate` и `tools/sdk_recipes_check.py`.

## GUI

`sdk_tools.json` содержит `code-check` и `api-browser`. Оба открывают
`Code Check / API Browser` — тонкую RmlUi-панель, которая вызывает **native**
`r2d-sdk doctor/lint/validate` и показывает `api.schema.json`. Второго линтера
или валидатора в JS нет.

## Recipes

`docs/recipes/README.md` — 18 коротких рецептов (player, enemy, weapon,
projectile, door, pickup, trigger, checkpoint, camera, dialogue, inventory,
save, platformer, top-down shooter, UI, audio, tilemap, particles). Каждый
JS-блок проверяется через `r2d-sdk lint` (`tools/sdk_recipes_check.py`).

## CI

`tools/ci_verify.py` после обычных тестов запускает:

```text
api check → schema freshness
lint game
validate game
doctor
recipes lint
```

CI падает, если metadata сломана, generated artifacts устарели или рецепт
использует несуществующий API.

## Расширения и World Editor

Агент видит расширения и авторские операции без чтения исходников SDK:

```bash
./r2d-sdk extension list --project game      # built-in + user + project, enabled/valid
./r2d-sdk tool list                          # merged effective registry (source/module)
./r2d-sdk world-edit map.re2dmap --op noop   # тот же backend, что у GUI
```

```js
$.sdkApp.snapshot().extensions;              // loaded, contributions, diagnostics
$.sdkApp.studios.world.capabilities();       // operations+args, entityDefinitions, build
$.sdkApp.studios.world.snapshot();           // file/dirty/tool/grid/selection/map
$.sdkApp.studios.world.ops.createBrush(/* ... */);
```

Каждая GUI-кнопка World Editor вызывает операцию фасада, а каждая операция
расширения — зарегистрированную программную функцию (agent parity). Ошибки —
структурные `SDK_EXTENSION_*` / `SDK_TOOL_*` / `SDK_WORLD_EDIT_*`;
сломанное расширение не отключает остальные команды.

## Ограничения

* Metadata структурная: `arity/args/returns/kind`; содержательные
  `description/since/deprecated` пока не заполняются registry.
* Lint — сканер, не полный JS AST; проверка событий (`R2D022`) — следующий шаг.
* GUI-панель минимальная: doctor/lint/validate/schema, без отдельного
  визуального дерева API.
