# Tooling Editor and agents: API metadata, lint, validate, doctor

Единый backend для разработчика, Editor и ИИ-агентов — **`r2d`**. Runtime
остаётся источником истины для публичного `$ API`; отдельного CLI бинарника SDK
нет.

```text
$ API (runtime) → api dump → api.schema.json / russiano2d.d.ts / API reference
                                   ↓
                              lint / validate / doctor
```

## Быстрый старт

```bash
"$R2D_BINARY" doctor                 # здоровье runtime/API/schema/typings/docs/project
"$R2D_BINARY" api dump               # machine-readable снимок $ API
"$R2D_BINARY" lint game              # API-aware проверка игровых скриптов
"$R2D_BINARY" validate game          # project.json, main.js, ссылки на ассеты
"$R2D_BINARY" api generate           # schema + typings + docs из runtime metadata
"$R2D_BINARY" docs generate          # только docs/api/API_REFERENCE.md
```

Все команды печатают один JSON-объект; `--json` принимается для
совместимости с GUI/CI/агентами. Код выхода: `0` — ok, `1` — диагностика,
`2` — неверное использование.

## API metadata

`api dump` запускает runtime в режиме `--dump-api`: тот обходит живой `$` и
доступную агентам часть `engine.*` после загрузки скриптов. Внутренний ENet-мост
не попадает в схему: игровая сеть доступна только через `$.net`. В снимок входят:

* `path`, `kind` (`function/object/number/string/boolean/array/null`);
* для функций — `arity`, `args[{name,type}]`, `returns`;
* для описанных публичных методов — русское `description` и пояснения аргументов;
* для констант — детерминированное `value` (плавающие значения вроде
  `engine.time`, `$.startScene`, `$.ctx.*` намеренно не записываются);
* методы selector-обёртки (`$.selection.*`) и node-обёртки (`$.fn.*`).

Снимок детерминирован и пригоден для `git diff`/CI. Каталог описаний собирается
из таблиц и поясняющих абзацев `docs/highlevel/*.md`, JSDoc около методов
`src/highlevel/*.js`, проверенных вручную описаний
`docs/highlevel/api_symbol_descriptions.json` и явных аннотаций
`documentApiMethod()` / `documentApiSymbol()`; локализованные
имена API и `$.fn` получают описания соответствующих canonical-методов.
Результат встраивается в JS bundle `r2d`, а реестр не становится enumerable
частью `$`. Описания добавляются постепенно; покрытие видно по полю
`description` в схеме. `api.schema.json` также содержит граф узлов и связей
namespace → member, argument → type и method → return type. `api check`
сравнивает весь сгенерированный schema-граф и документацию с runtime.

После правок `$` API, high-level docs, JSDoc или описаний запустите единый
workflow. Он дважды собирает embedding runtime при необходимости, обновляет
schema/typings/reference и каталог Editor, затем проверяет результат:

```bash
xmake api_docs
```

Для CI и локальной read-only проверки после сборки:

```bash
R2D_BINARY=build-xmake/macos-arm64/macosx/arm64/release/r2d \
  python3 scripts/api_docs_pipeline.py check
```

Команда `check` сравнивает Editor-каталог с его генератором, schema с runtime,
typings и API reference с runtime и запускает проверку покрытия API описаниями.
Она не переписывает файлы. CI выполняет эту проверку на собранном Linux-бинарнике;
docs quality job отдельно проверяет актуальность Editor-каталога.

```bash
"$R2D_BINARY" api check --game game
```

## Generated artifacts

`api generate` пишет:

| Файл | Что это |
|---|---|
| `api.schema.json` | актуальная генерируемая схема для lint/CI/GUI; не фиксирует допустимое развитие API |
| `russiano2d.d.ts` | TypeScript declarations (tooling layer, игра остаётся JS) |
| `docs/api/API_REFERENCE.md` | generated reference по namespaces/методам/константам с описаниями там, где они добавлены |

Все три файла имеют заголовок `GENERATED FILE — DO NOT EDIT MANUALLY`.
Меняется только runtime `$ API`; затем `api generate`. `doctor` и CI проверяют,
что артефакты не устарели.

## Lint

`r2d lint [путь]` — детерминированный сканер JS, который понимает `$ API`,
а не только синтаксис. Он не style police и не заменяет тесты.

Стабильные коды:

| Код | Значение |
|---|---|
| `R2D001` | неизвестный метод/API (с подсказкой ближайшего имени) |
| `R2D004` | неверное количество аргументов |
| `R2D014` | неверный тип свойства |

```bash
"$R2D_BINARY" lint game/main.js
"$R2D_BINARY" lint game --json
```

Пример: `$("player").att(1)` → `R2D001 Unknown method "att"; did you mean "at"?`

Линтер не ругается на игровые namespace'ы и приватные `_`-имена: диагностика
появляется только если родительский namespace известен как публичный.

## Validate

`r2d validate [каталог]` проверяет проект перед запуском/build:

* `project.json` (`R2D200`), наличие `main.js`; schema 2 — `runtime.*`, граф и
  его актуальность (`R2D201`–`R2D210`, см. [PROJECT_JSON.md](PROJECT_JSON.md));
* ссылки на ассеты в JS/RML/RCSS/JSON (`R2D100`);
* известные ассеты через те же валидаторы, что CLI (`atlas/tilemap/audio/
  input/rmlui/re2dmap/...`);
* линтер JS API (диагностики `R2D001/004/014`).

`validate <файл>` по-прежнему проверяет один ассет; `--project dir` — проект.

## Doctor

`r2d doctor [--project dir]` — один health check для CI/агента/Editor:

```text
runtime, api_metadata, schema, typings, docs, project, lint
```

`ok:true` только если все checks зелёные. В CI используется вместе с
`api check`, `lint`, `validate` и `tools/sdk_recipes_check.py`.

## Editor

Editor вызывает **native** `r2d doctor/lint/validate` и показывает диагностики
в Problems. Второго линтера или валидатора в JS нет.

## Recipes

`docs/recipes/README.md` — 18 коротких рецептов (player, enemy, weapon,
projectile, door, pickup, trigger, checkpoint, camera, dialogue, inventory,
save, platformer, top-down shooter, UI, audio, tilemap, particles). Каждый
JS-блок проверяется через `r2d lint` (`tools/sdk_recipes_check.py`).

## CI

Проектный gate запускает Xmake tests, проверки API/docs и адресные проверки
Editor из [TESTING.md](TESTING.md). `tools/ci_verify.py` относился к старой
отдельной сборке и удалён.

```text
api check → schema freshness → lint/validate → doc tests → xmake tests
```

CI падает, если metadata сломана, generated artifacts устарели или рецепт
использует несуществующий API.

## Расширения и World Editor

Агент видит расширения и авторские операции без чтения исходников SDK:

```bash
"$R2D_BINARY" extension list --project game      # built-in + user + project, enabled/valid
"$R2D_BINARY" tool list                          # merged effective registry (source/module)
"$R2D_BINARY" world-edit map.re2dmap --op noop   # тот же backend, что у GUI
```

```js
$.editorApp.extensions.snapshot();                   // loaded, extensions, contributions, diagnostics
$.editorApp.activeTab().inst.extensions.worldTools(); // World Tools in active Hammer tab
$.editorApp.activeTab().inst.snapshot();               // file/dirty/tool/grid/selection/map
$.editorApp.activeTab().inst.ops.createBrush(/* ... */);
```

Hammer вызывает world contributions через единый host; каждая операция
расширения — зарегистрированную программную функцию (agent parity). Ошибки —
структурные `SDK_EXTENSION_*` / `SDK_TOOL_*` / `SDK_WORLD_EDIT_*`;
сломанное расширение не отключает остальные команды.

## Ограничения

* Metadata структурная: `arity/args/returns/kind`; содержательные
  `description/since/deprecated` пока не заполняются registry.
* Lint — сканер, не полный JS AST; проверка событий (`R2D022`) — следующий шаг.
* GUI-панель минимальная: doctor/lint/validate/schema, без отдельного
  визуального дерева API; UI consumers меню/панелей extension пока не добавлены.
