# Недостающие возможности SDK

Обновлено 2026-10-20. Этот документ — очередь дальнейшей реализации SDK.
[SDK_HANDOFF.md](../SDK_HANDOFF.md) хранит изменения, команды, результаты и
ошибки; здесь хранится то, что ещё нужно сделать, и условия приёмки.
Статусы: **проверено**, **в работе**, **запланировано**. Наличие исходников
или красивого кадра само по себе не переводит пункт в «проверено».

Архитектурные условия: [PHILOSOPHY.md](PHILOSOPHY.md),
[ARCHITECTURE.md](ARCHITECTURE.md),
[AGENT_IMPLEMENTATION_RULES.md](AGENT_IMPLEMENTATION_RULES.md).
Расширяем существующие нативные модули через C → `$`; игровой код и данные
остаются открытыми файлами. SDK авторит 2D-данные (атласы, тайлкарты, слои,
частицы, коллизии, шрифты, звук, ввод, RmlUi-разметку) и не вводит ни
обязательный project format, ни второй scene graph. Любой новый интерфейс SDK
делается на RmlUi. 3D-авторинг (Re2DSprite/Baker/FBX/Re2D World) из SDK вырезан
вместе с конвейером RE2D и сюда не возвращается.

## Ближайший порядок работ

1. **Проверить поставку SDK — macOS arm64 пересобрана и проверена;
   Linux и Windows остаются.** Пакет собран из текущего дерева штатным
   инструментом (без тега, публикации и push):

   ```bash
   python3 tools/release.py --platform macos-arm64 --skip-tests --skip-tag --force --yes
   # build-release → dist/macos-arm64 + dist/russiano2d-v1.3.0-macos-arm64.tar.gz
   # финальный архив (после --package-only --build-dir build-release):
   # SHA256 70b8d74c19f21205f5bae34d0b179c282f2774cb726337e2f6ee288288eb1ab5
   ```

   Распакован вне checkout: `VERSION` 1.3.0, `shasum -a 256 -c` — 465/465 OK,
   `tools/ci_package_check.py --platform macos-arm64` — OK (все обязательные
   файлы, нет мусора). Из `/tmp` проверены: `version` = 1.3.0 (31 команда,
   `deps` есть), `commands/tools/templates/new/project`, `validate` проекта по
   абсолютному пути и с `--schema` перед позиционным, `deps --record/--check`,
   `build` с относительным проектом (файл 11.8 МБ), `doctor` — все 7 проверок
   true (project без `R2D100`).

   Исправлено в этом проходе (`sdk/`): схема для `validate/lint/doctor`
   ищется от `--schema`, каталога проекта, cwd и каталога `r2d-sdk` (и выше) —
   `sdk_schema_resolve`; явный `--schema` не подменяется и входит в
   `takes_value`; `run/build` делают путь проекта абсолютным (`sdk_abs_path`),
   иначе движок искал игру от своего каталога; `R2D100` устранён удалением
   висячего поля `audio` в `game_vn/voice/segments.json` (метаданные
   нарезки, в репозитории этого wav нет и он не нужен); `tools/vn_voice_slice.py`
   больше не пишет это поле (Follow-up закрыт).

   Engine-level SIGABRT после `--frames` **исправлен** (Lead, src/app.c):
   если cwd не содержит `game/main.js`, движок падал на выходе
   (`SDL_Quit → SDL_QuitFilesystem → free → abort`,
   `POINTER_BEING_FREED_WAS_NOT_ALLOCATED`). Причина — `SDL_GetBasePath()`
   возвращает `const char*`, которым владеет SDL, а `r2d_app_shutdown`
   освобождал его как свой. Теперь путь заимствованный
   (`base_path_owned = false`). Проверено: запуск из `/tmp` с абсолютным
   `--game` и `--frames 3` → exit 0. Лаунчер не прячет код
   (`src/sdk_launcher.c:152-155`).
   Остаётся: Linux/Windows-прогон установленного пакета.
2. **Завершить редактирование студий данных — частично сделано (2026-10-20).**
   Сделанное использует существующие модели/форматы, без второго backend.

   | Возможность | Статус | Доказательство | Минимальный фикс |
   |---|---|---|---|
   | Graph editor кривых | **СДЕЛАНО** | RmlUi-граф `pp-graph` в Particle Studio (цвет/альфа/размер), drag/add/remove, одна undo-операция; модель — `sdk/lib/kinds/particles.js`, тест `tests/js/sdk_studio_curves_test.mjs` | точки хранятся тем же JSON, числовые поля остаются fallback |
   | Клик-выбор в предпросмотре RmlUi | **СДЕЛАНО** (элементы с id) | `ops.pickAt` в `sdk/tools/rmlui-studio.js` использует настоящий `layoutRect`, выбирает самый глубокий элемент под точкой; snapshot `clickSelect/pickable` | без id элемент не адресуем — честное ограничение, поддельного hit-test нет |
   | Drag-ресайз фигур коллизии | **СДЕЛАНО** | 4 угловых handle у box и правый у circle; противоположная точка/центр фиксированы, snap по сетке, одна undo-операция; полигон — прежний drag вершин | числовые поля остаются точным fallback |
   | Drag зон акустики | **СДЕЛАНО** | клик по зоне в предпросмотре выбирает и тащит `rect.x/y` (snap), отпускание — одна undo-операция «перемещение зоны»; числовые x/y/w/h остаются точными | повторяет drag-паттерн коллизий, без второго backend |
   | Террейны Tilemap | **СДЕЛАНО** | обычный JSON `terrains:{mode,base,border,solid,transitions|tiles}`, `autotile.mode='terrain'`; валидация в `sdk/lib/kinds/tilemap.js` и `sdk/native/sdk_data.c` (parity), редактор «ТЕРРЕЙН» в Tilemap Studio, real runtime preview | рантайм применяет существующим `.autotile()`; numeric fallback сохранён |
   | Анимация тайлов | **СДЕЛАНО** | `animations:[{tile,frames,fps|interval,random,offset,layer}]` в том же JSON; валидация JS↔C; редактор «АНИМАЦИЯ ТАЙЛОВ»; рантайм листает кадры сам (time.delta, pause/scale/fixed-dt) | новые методы `$.fn.animations/.tileAnimations`; тесты `tests/js/tilemap_anim_test.mjs` |
   | Font authoring | **ЧАСТИЧНО СДЕЛАНО** | `$.font.load(name,path,{weight,style})` + `$.font.faces()` регистрируют RmlUi-лица; RCSS `font-weight/font-style` выбирает лицо; сцена `$.gfx.text` остаётся одноатласной | точная настройка table-kerning из `$` не управляется (RmlUi применяет из TTF); bold/italic для сцены не подделываются |
3. **Расширить покрытие парности JS ↔ C — запланировано.** `sdk_data_parity_test.py`
   гоняет правки базовых файлов через обе реализации проверок; новые форматы и
   поля добавлять в обе копии (`sdk/lib/kinds/*.js` и `sdk/native/sdk_data.c`)
   в одном изменении.

Для каждого нового пункта записывать: воспроизводимый пример, затронутый
существующий модуль/API, ожидаемое поведение, тест, реальный кадр или PCM
при необходимости, ограничения и результат проверки.

## Технические ограничения и критерии приёмки

| Area | Current implementation | Remaining capability | Acceptance criterion |
|---|---|---|---|
| SDK packaging | Platform packages carry `r2d-sdk`, `sdk/`, templates and `sdk_tools.json`; unpack/create/run/build verified by `sdk_package_test.py`. macOS arm64 bundle rebuilt 2026-10-20 with `tools/release.py` (no tag/publish): VERSION 1.3.0, backend 1.3.0 with `deps`, checksums 465/465, `ci_package_check.py` OK; from `/tmp` `validate/deps/run/build/doctor` verified. Engine SIGABRT at shutdown fixed (`SDL_GetBasePath` no longer freed as owned). | Linux/Windows installed run. | Installed bundle runs the CLI and GUI without checkout; explicit errors when the engine or backend are missing. |
| Data studios | Seven Classic 2D studios on one RmlUi host; canonical JSON writes; JS ↔ C validation parity (`sdk_data_parity_test.py`). Closed 2026-10-20: curve graph, RmlUi click-select (elements with id via real layoutRect), collision resize handles, audio zone drag, tilemap terrain + tile animation, RmlUi font weight/style. | Font table-kerning tuning; id-less RmlUi elements are not addressable (honest limit). | Edits are visible in the real runtime preview; saved files are ordinary JSON read by `$`; numeric fields remain as fallback. |
| Asset dependency graph | `r2d-sdk deps` reads `deps.json` and the service cache `.r2d/cache/assets.json`; FNV-1a 64 content hashes, transitive staleness, path-traversal rejection, structured `SDK_DEPS_*` diagnostics, rewritten atomic cache. Nothing is built by the command. | Bakers stay external; no job runner in the graph (a stale list is a report, not a build). | `r2d_sdk_deps_test` (Unity/ASan): record, up_to_date, only dependents stale, missing dep, hash/cache stability, path traversal; `docs/SDK.md` §4.1. |
| Batch/automation | `r2d-sdk batch` validates assets from a manifest; the native agent client forwards all 19 engine protocol commands. | More job operations only when a 2D need appears; unknown operations must stay structured errors. | Manifest runs without Python/Node; per-job diagnostics; machine report equals stdout. |

Keep this table current after verification. A passing generic suite does not prove
untested platform packaging or all studio interactions. Detailed commands,
evidence, failures and remaining risks belong in SDK_HANDOFF.md.
