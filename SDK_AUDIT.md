# SDK_AUDIT — Phase 0 (2026-10-08)

Аудит репозитория перед разработкой Russiano2D SDK
([Следующая цель SDK AGENT.md](Следующая%20цель%20SDK%20AGENT.md) §60, §78).
Статусы по §7: IMPLEMENTED / PARTIAL / STUB / PLANNED / NOT STARTED.

**Исторический снимок Phase 0.** Таблица ниже не является текущим статусом SDK.
Последующий аудит и закрытие фаз: [SDK_HANDOFF.md](SDK_HANDOFF.md),
[docs/SDK_VERIFICATION.md](docs/SDK_VERIFICATION.md). Утверждение ниже о зависимости
текста сцены от ImGui было ошибочным: текущий `text.c` рисует через stb_truetype.
Устаревший путь `src/highlevel/re2dsprite.js` следует читать как `rotsprite.js`,
где зарегистрировано публичное имя Re2DSprite.
Всё ниже проверено чтением кода и запусками на HEAD `7b41d4f`.

## 0. Базовое состояние

| Проверка | Результат |
|---|---|
| `git status` до работы | изменён только spec-файл; новый `SDK_HANDOFF.md` (документы, код не тронут) |
| `cmake --build build` | зелёная (macOS, clang, Debug-сборка в `build/`) |
| `python3 tools/run_tests.py` | 94 агентских теста: ok 93, fail 1 (`highlevel_perf_test` — падает до правок, перфоманс-порог Debug-сборки), skip 0, 215 с |
| Незавершённая чужая работа | не найдена: RotSprite → Re2DSprite и Re2D World уже закоммичены |

## 1. Таблица подсистем

| Subsystem | State | Reusable | Missing | Risks |
|---|---|---|---|---|
| RmlUi | IMPLEMENTED (`src/gui.cpp`, `$.ui.doc`, `engine.ui.*`) | документы `.rml/.rcss`, события, `loadMarkup`; DevTools уже на нём (`src/highlevel/devtools.js`) | custom-element для нативной отрисовки — только в плане (DEVTOOLS §5); нет файловых диалогов | проверять, что `$.ui.doc` в агентском режиме отдаёт структуру (нужно для тестов SDK) |
| Dear ImGui | IMPLEMENTED как legacy (`src/debug_ui.cpp/.h`, `main.c`, `R2D_ENABLE_IMGUI`, `cmake/Dependencies.cmake`) | — | удалить/заменить на RmlUi (§4 spec) | **текст сцены (`engine.drawText`) рисуется через ImGui background draw list**; `text.c` без ImGui деградирует до оценки ширины. Удаление затрагивает текст → отдельная фаза, не блокирует SDK |
| `$` API | IMPLEMENTED (71 подсистема, ~44k строк JS, `src/nodes.c` — горячие проходы) | `$.fs` (read/write/list/exists/remove, запись «рядом с игрой»), `$.resource`, `$.atlas`, `$.anim`, `$.tilemap`, `$.particles`, `$.re2dSprite`, `$.re2d.world`, `$.agent`, `$.test`, `$.expect` | spawn процессов, список каталогов с метаданными (mtime/размер) | `engine.*` скрыт от игры: SDK обязан использовать только `$` |
| Агентский протокол | IMPLEMENTED (`src/agent.c`, `docs/AGENT_API.md`: ping/frames/step/state/query/inspect/profile/eval/reload/key/mouse/text/screenshot/quit) | клиент `tools/agent_client.py` (Python — **нельзя** как SDK-инструмент) | нативный C-клиент и SDK-операции через протокол | паритет по каждой команде нужно проверять тестом |
| Форматы: атлас/спрайт | IMPLEMENTED: `$.atlas` читает Aseprite / TexturePacker / «свой простой» JSON (frames, tags) | формат «свой простой» + `meta.image` | pivot в кадре — сверить с `docs/highlevel/sprite.md` | не изобретать новый sprite-format (§12) |
| Форматы: анимация | IMPLEMENTED: `$.anim.define` (клипы, tracks, events), `$.anim.player`, atlas-теги → `{frames,fps,loop}` | spec клипа как JSON-данные | загрузчик `*.anim.json` с диска (`$.fs.readJSON` + `define` — делается в SDK/играх) | — |
| Форматы: tilemap | IMPLEMENTED API (`$.tilemap`, слои, autotile, solid); **файла-формата нет** (данные задаются в коде) | поля `opts` (`src,tile,cols,rows,data,solid,legend,layers`) | on-disk JSON, отображаемый 1:1 в `opts` | формат должен быть тонкой JSON-формой существующего `opts`, не новой моделью |
| Форматы: particles | IMPLEMENTED API (`$.particles`, `preset`, параметры эмиттера) | параметры эмиттера — готовая схема | on-disk JSON пресета | — |
| Re2DSprite | IMPLEMENTED/PARTIAL (`src/rotsprite*.c`, `src/highlevel/re2dsprite.js`, PNG v2 + `*.character.json` v1, клипы, сокеты, equip, hot reload, `info()`) | формат описан в `docs/RE2DSPRITE_JSON.md`, `RE2DSPRITE_V2.md`; валидатор есть только в JS-рантайме и Python-инструментах | C-валидатор формата без движка; debug-режимы Surface (Part ID/X/Y/Z/Depth/Coverage/Owner) | карты ID/depth/coverage/XYZ лежат в самом PNG v2 → debug-просмотр можно строить чтением PNG, без второго рендерера |
| Python-инструменты Re2DSprite | IMPLEMENTED (`tools/compile_rotsprite.py`, `make_rotsprite_v2.py`, `build_rotsprite_assets.py`) | алгоритм surface→PNG v2 как референс | для SDK заменить на C (§1.5) | старые Python-инструменты остаются как есть (не SDK) |
| Re2D World | PARTIAL (`src/re2d_world.c`: стены, прямоугольные cells с несколькими spans, BSP по XY, `support/blocked/ray/render`) | JS `$.re2d.world(description)`; тесты `tests/re2d/world_test.c`, `tests/agent/highlevel_re2d_bsp_world_test.py` | **порталы, PVS, slopes, stairs в runtime отсутствуют**; cells только прямоугольные | Phase 6 нельзя заявлять «PVS в runtime». Порталы/PVS возможны как compile-time данные и диагностики. Runtime архитектура объявлена нестабильной (RE2D_WORLD_AUDIT) |
| Baker/импорт 3D | NOT STARTED | `src/json.c` (R2dJson), stb (`r2d_stb`: stb_image/stb_image_write доступны) | GLB/glTF, VRM, surface sampling, запись PNG v2 | PNG v2 имеет жёсткую раскладку (RE2DSPRITE_V2.md) — baker обязан попасть в неё |
| Билд/пакет | IMPLEMENTED (`src/build.c`, `russiano2d build`, `docs/BUILD.md`, `tools/r2d_pack.c`) | CLI `russiano2d build` | — | — |
| Hot reload | IMPLEMENTED (`reload`, `--no-hot-reload`, `.re2dHotReload()`, опрос mtime) | использовать как есть | — | — |
| Тесты | IMPLEMENTED: `tests/js` (qjs), `tests/agent` (Python-раннер), C-цели в CMake, стражи доков | — | тесты SDK (C-набор + агентские) | Python — только в тестовой обвязке репозитория, не в поставляемых инструментах |
| SDK (launcher, `sdk_tools.json`, инструменты) | **NOT STARTED** (`demos/launcher.js` — лаунчер демо, не SDK) | `demos/launcher.js`/`.rml` как образец RmlUi-экрана | всё | см. решения ниже |

## 2. Решения для реализации (проверяемые, без изменения философии)

1. **Раскладка.** SDK-приложение = обычный R2D-проект `sdk/` (`project.json`, `main.js`,
   `ui/*.rml|rcss`, экраны инструментов `sdk/tools/*.js`). Нативный бэкенд — `sdk/native/*.c`,
   один бинарник `r2d-sdk` (цель CMake), тесты `tests/sdk/`. Реестр — `sdk_tools.json` в корне.
2. **C-бэкенд, без внешних runtime.** `r2d-sdk` = CLI с JSON-выходом: `tools`, `assets`,
   `validate`, `run`, `build`, `bake-re2d`, `world`, `agent`. Использует `src/json.c` и stb.
3. **Мост GUI → бэкенд.** SDK-приложению нужно запускать `r2d-sdk` и игру. Публичного `$`
   способа порождать процессы нет (и для игр он не нужен). Решение: узкий **tool host** —
   `$.sdk.run(args)` — включается только флагом проекта (`"toolHost": true` в `project.json`),
   запускает только соседний бинарник `r2d-sdk` с массивом аргументов (без shell),
   возвращает разобранный JSON. Это документируется открыто, не секретный API.
   Требует правки `src/` (гейт доков) — делается в Phase 1.
4. **Форматы — только существующие.** Sprite = «свой простой» atlas JSON (`$.atlas`), анимация =
   spec клипа `$.anim.define` (`*.anim.json`), tilemap/particles = JSON-форма `opts`,
   Re2DSprite = `*.character.json` + PNG v2 (+ `animations.json`), World = `*.re2dmap` (source) →
   `$.re2d.world(description)` (compiled). Новые поля — с `version` и миграцией.
5. **Re2D World честно.** Порталы и PVS считаются компилятором как данные + диагностики и
   помечаются PARTIAL: runtime их не использует.
6. **ImGui.** Удаление — отдельная работа с заменой текстового пути; не смешивать с SDK-фазами.
   Фиксируется в `SDK_HANDOFF.md`.

## 3. План Phase 1 (минимальный)

`sdk_tools.json` → `r2d-sdk tools|assets|run|build|validate` → `$.sdk` tool host → RmlUi-оболочка
(Projects, Asset Browser, Tools из реестра с диагностикой, Run/Build, Docs, Diagnostics) →
тесты (C + агентский) → документы.
