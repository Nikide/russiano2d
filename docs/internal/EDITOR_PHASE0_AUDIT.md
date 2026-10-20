# Russiano2D Editor — Этап 0: аудит фактического состояния

Дата: 2026-10-20. Checkout: `main`, HEAD `04302a0` («тест v1.3.2»), рабочее дерево чистое.
Основание: ТЗ `RUSSIANO2D_EDITOR_TZ.md` (Этап 0). Документ внутренний, кода не меняет.

## 1. Что есть сейчас (факты из исходников)

| Область | Факт | Где |
|---|---|---|
| Бинарники | Три: `russiano2d` (движок), `r2d-sdk` (нативный CLI backend), `russiano2d-sdk` (лаунчер = `russiano2d --game sdk`) + macOS app bundle. Релиз кладёт все три. | `CMakeLists.txt:133`, `sdk/native/CMakeLists.txt:53-70`, `src/sdk_launcher.c`, `tools/release.py:384-389,783-840` |
| Backend | Статическая библиотека `r2d_sdk_core` (28 файлов, ~19 тыс. строк C) уже отделена от `main()`; `sdk_main.c` — только таблица из 35 команд. | `sdk/native/sdk_main.c:25-60` |
| Вывод backend | Команды печатают JSON прямо в stdout (~900 вызовов `puts/printf/fwrite`) и возвращают код выхода. In-process вызов без перехвата stdout невозможен без массовой правки. | `grep -c puts sdk/native/*.c` |
| Мост GUI→backend | `$.sdk.tool([...])` порождает **процесс** `r2d-sdk` рядом с движком (`SDL_CreateProcess`), поток читает stdout, JSON берётся из последней строки. Разрешён только при `"toolHost": true`. | `src/sdk_host.c:166-222`, `src/highlevel/sdk.js` |
| Запуск игры из SDK | `$.sdk.launch` порождает процесс самого движка (`r2d_self_executable_path`). | `src/sdk_host.c:166` |
| Глаголы движка | У `russiano2d` уже есть режим-глагол `build` (собирает игру) и флаги `--game/--scene/--headless/--agent/--dump-api/--fixed-dt/--seed/--record/--replay/...`. | `src/main.c:731-860`, `src/build.c` |
| Проект | Вход всегда `<game>/main.js`; `project.json` = title/version/width/height/`toolHost`. `--scene` → `engine.startScene`. | `src/project.c:97-101`, `src/main.c:870-910` |
| Сцены | `$.scene` в JS (`installScene`, комнаты `installSceneRooms`), сцены регистрирует код. | `src/highlevel/scene.js:999,2420` |
| SDK оболочка | `sdk/app.js` (790 стр.) + `sdk/ui/shell.rml`: навигация экранами (projects/assets/tools/templates/run/engines/docs), не вкладками. | `sdk/app.js:295-345` |
| Студии | Каждая студия — **свой RmlUi-документ**: при открытии `app.doc.hide(); doc.show()`, «Назад» возвращает оболочку. Одновременно открыта одна студия. | `sdk/lib/studio_host.js:199-225`, `sdk/tools/world-editor.js:41` |
| Реестр | `sdk_tools.json`: 21 запись (3 внутренних экрана + 18 модулей `sdk/tools/*.js`), у каждой `assets` glob → открытие по типу файла уже есть (`openAsset`). | `sdk_tools.json`, `sdk/app.js:381` |
| Редактор JS | **Отсутствует.** `code-check` показывает JSON doctor/lint/validate, кода не редактирует. В движке нет custom-элемента редактора кода; есть только RmlUi `<textarea>`. | `sdk/tools/code-check.js`, `src/gui.cpp` |
| Hammer | `world-editor`: 4 вьюпорта (Top/Front/Side ортопроекции — RmlUi div'ы с абсолютными координатами; 3D — настоящий runtime world через `renderToSprite`), 10 инструментов `select, block, move, resize, rotate, vertex, clip, face, entity, path`, visgroups, undo/redo, native `world-edit`. | `sdk/tools/world-editor.js:23`, `sdk/lib/world_editor/*`, `sdk/native/sdk_world_edit.c` |
| VN Maker | Модель команд `say/narration/label/choice/raw`, сериализация в строки `.scene`, валидация через native `story`. | `sdk/lib/vn_maker.js:85-88,258-261`, `sdk/native/sdk_story.c` |
| SpriteMesh V1 | Студия + native `sprite-mesh-bake` (PNG/atlas, все кадры). | `sdk/tools/sprite-mesh-studio.js`, `sdk/native/sdk_sprite_mesh.c` |
| Шаблоны | `blank`, `platformer`, `tilemap-room`, `ui-menu`. | `sdk/templates/` |
| Версия | CMake `1.3.2`; `docs/SDK_VERIFICATION.md:11` всё ещё пишет `1.3.1`. | |

## 2. Расхождения ТЗ ↔ код (влияют на дизайн)

1. **Сборка игры уже есть.** `r2d-sdk build` → `russiano2d build` делает **один исполняемый файл** (копия движка + зашифрованный груз байткода/ассетов, `src/build.c`). ТЗ говорит «не обещать executable export». Предлагаю: сохранить существующую сборку (она реальна и тестируется `sdk_package_test.py`), в Editor назвать её как есть; ничего нового не обещать. Последствие встраивания Editor в движок: собранная игра несёт код Editor в бинарнике (UI-файлов `sdk/` в грузе нет) — размер, не поведение.
2. **Один бинарник.** Минимальный путь без переписывания 900 точек вывода: слинковать `r2d_sdk_core` в `russiano2d` и добавить глагол `russiano2d sdk <команда> ...` (как уже существующий `build`). Мост `$.sdk.tool` начинает порождать *тот же* исполняемый файл с префиксом `sdk` вместо `r2d-sdk`. GUI/CLI/agent идут через одну таблицу команд. `r2d-sdk` остаётся тонкой обёрткой до перевода всех вызывающих (тесты, `tools/*.py`, доки), затем убирается из поставки. In-process (без процесса) — отдельный следующий шаг, только если замер покажет нужду.
3. **Редактора кода нет.** Требование «реальное редактирование, search/undo/line-column, не textarea» означает новый нативный RmlUi custom-элемент (C++: буфер, курсор, выделение, подсветка, undo). Это крупнейшая новая работа ТЗ — нужно решение владельца (см. §5).
4. **Студии — полноэкранные документы.** Вкладки ТЗ реализуемы без переписывания: оболочка держит рамку (top bar, sidebar, inspector, bottom panel), а документ студии позиционируется в центральную область и показывается/скрывается при смене вкладки. Но у каждой студии сейчас **свои** toolbar/inspector/diagnostics — внутренний layout сохраняется, общий Inspector/Problems для студий подключаются постепенно.
5. **Константа 2 PHILOSOPHY «редактора сцен нет»** — ТЗ её соблюдает (Editor = IDE + resource studios, не scene editor). Конфликта нет, но в `PHILOSOPHY.md`/`SDK.md` надо переформулировать «SDK — отдельное приложение» после фактического перехода.
6. **project.json v2 и `startScene`.** Сейчас стартовую сцену выбирает только `--scene`. Индексация `scenes`/`roles` для навигации runtime не трогает; чтение `startScene` из манифеста — единственная возможная runtime-правка, и она не обязательна (Run может передавать `--scene`).
7. **Макеты vs код** (проверено grep'ом):
   - Hammer: в коде 10 инструментов, есть `rotate` (на макете нет — сохранить); «Snap to Angle» в `world-editor.js` нет — не показывать.
   - SpriteMesh: backend знает только `depth`, `alpha-threshold`, `units-per-pixel`, `pivot-x/y`, `--check` (`sdk_sprite_mesh.c:64-66`). «Generate LOD», «Merge vertices», выбор освещения «Studio» — **нет**; не показывать.
   - VN: шаблоны команд `say, narration, choice, label, flow (goto), image, sound, wait, raw` (`vn_maker.js:266`); фон = `image …`, отдельного «Background» kind нет — в UI можно подписать `image` как фон, формат не менять.

## 3. Таблица сохранения функций

Риск: Н — низкий (перенос рамки), С — нужна адаптация хоста, В — новая работа или потеря при ошибке.

| Функция | Код | Формат / backend | Тесты | Место в Editor | Риск |
|---|---|---|---|---|---|
| Project launcher, recent/open/new | `sdk/app.js` (projects), `sdk/lib/splash.js` | `state.local.json`; native `projects`, `project`, `new` | `sdk_shell_test`, `sdk_splash_test`, `tests/js/sdk_app_test` | Project Manager | Н |
| Asset Browser | `sdk/app.js` (assets), `model.js` | native `assets` | `sdk_shell_test` | Project tree + фильтры | С (дерево вместо списка) |
| Code Check / doctor / lint | `sdk/tools/code-check.js` | native `doctor/lint/validate`, `api.schema.json` | `sdk_cli_test`, `sdk_tools_panels_test` | Problems + Palette | Н |
| JS-редактор | — | — | — | Code tab | **В (нет)** |
| API Browser | `sdk/tools/api-browser.js` | native `api` | `sdk_tools_panels_test` | Help/API panel | Н |
| Sprite Studio | `sprite-studio.js`, `atlas_session.js`, `atlas_model.js` | `*.atlas.json`; native `atlas-*` | `sdk_classic2d_test`, `tests/js/sdk_atlas_model_test` | Atlas tab | С |
| Animation Studio | `animation-studio.js` (общая `atlas_session`) | `*.atlas.json` tags | `sdk_classic2d_test` | View того же atlas-документа | С |
| SpriteMesh V1 | `sprite-mesh-studio.js` | native `sprite-mesh-bake` | `sdk_sprite_mesh_test`, `sprite_mesh_demo_test`, C `r2d_sprite_mesh_test` | SpriteMesh tab | С |
| Tilemap/Particles/Collision/Parallax/Font/Audio/Input | `*-studio.js`/`*-tools.js` на `studio_host.js` + `data_studio.rml` | JSON `version:1`; JS `lib/kinds/*` = C `sdk_data.c` | `sdk_studios_test`, `sdk_data_parity_test`, `tests/js/sdk_kinds_test` | Вкладки по типу файла | С (один хост — переносится разом) |
| RmlUi Studio | `rmlui-studio.js`, `rml_model.js` | `.rml/.rcss`; native `dialog` | `tests/js/sdk_rml_test` | RML/RCSS tab | С |
| VN Maker | `vn-narrative.js`, `lib/vn_maker.js` | `story/*.scene`; native `story` | `vn_narrative_validation_test`, `tests/js/vn_narrative_test` | Narrative tab | С |
| Re2D World Studio | `re2d-world-studio.js` | native `world info/compile` | `sdk_world_studio_test` | Map commands | С |
| Hammer | `world-editor.js`, `lib/world_editor/*` | `.re2dmap`; native `world-edit` | `world_editor_test`, C `r2d_sdk_brush_test` и др. | Full Hammer workspace | **В** (самый сложный layout; 4 вьюпорта завязаны на абсолютные rect документа) |
| DevTools | `devtools.js` | runtime `$.devtools` | `sdk_tools_panels_test` | Debug/Console | С |
| Automation/batch/agent | `automation.js` | native `batch`, `agent` | `sdk_automation_test`, ctest `r2d_sdk_batch` | Commands/Automation | Н |
| Extensions | `lib/extensions.js` | native `extension`, `tool` | `sdk_extensions_test` | Tools/Extensions | Н |
| Templates | app (templates) | native `templates/new` | `sdk_shell_test` | New Project | Н |
| Recovery | `lib/recovery.js`, `recovery.rml` | `.r2d-*` черновики | `sdk_recovery_test` | Lifecycle вкладок | С |
| Run/Stop/Debug | app (run) | `$.sdk.launch`, native `run` | `sdk_runtime_ui_test` | Toolbar F5/Shift+F5 | Н |
| Build/Package | app (run) | native `build` → `russiano2d build` | `sdk_package_test` | Build pane | Н |

## 4. Предлагаемый порядок (уточнение фаз ТЗ)

ТЗ ставит Hammer (Этап 2) раньше одного бинарника (Этап 3). Предлагаю поменять: **один бинарник — первым**, потому что это механическая, хорошо проверяемая правка (глагол `sdk` + замена пути в `sdk_host.c`), снимающая риск для всех последующих этапов, а Hammer — самый рискованный перенос UI.

1. **1a. Один бинарник**: `r2d_sdk_core` в `russiano2d`, глагол `russiano2d sdk …`, мост на self-exec, `r2d-sdk` — обёртка; тест паритета JSON `r2d-sdk X` == `russiano2d sdk X`.
2. **1b. Shell**: рамка RmlUi (toolbar, activity rail, дерево, вкладки, Inspector, Problems/Output/Build, status), Quick Open/Palette, Run/Stop; одна студия (data-студия на `studio_host` — переносится разом семь) во вкладке.
3. **2. Код**: решение §5.
4. **3. Hammer, VN, SpriteMesh, Sprite/Animation** — по одному.
5. **4. project.json v2**, **5. Package/docs**.

## 5. Решения, нужные от владельца

1. Редактор кода: нативный RmlUi custom-элемент (C++, крупная работа) **или** первая версия = просмотр + diagnostics + «открыть во внешнем редакторе» с hot reload.
2. Порядок: один бинарник до Hammer (рекомендую) или как в ТЗ.
3. Существующий `build` (один исполняемый файл) — оставить как Build/Package Editor'а (рекомендую).

## 6. Проверки на чистом HEAD (до любых правок)

- `cmake --build build -j 8` — успех; `r2d-sdk version` → `1.3.2`, 16 валидаторов; `r2d-sdk validate game --json` → 0 ошибок.
- `tests/agent/sdk_cli_test.py`, `world_editor_test.py`, `sdk_sprite_mesh_test.py`, `vn_narrative_validation_test.py` — зелёные.
- `tests/agent/sdk_shell_test.py` — **2 провала до правок**: «кнопка поиска фильтрует каталог по типу файла», «счётчик поиска показывает число результатов». По правилам — блокер для этапа 1b (shell), разобрать первым.
- `tests/agent/sdk_package_test.py` — падает: нет `build/Russiano2D SDK.app` (цель `russiano2d-sdk-app` не входит в обычную сборку). Окружение, не код; при переходе на один бинарник тест переписывается.
- `tests/doc_claims_test.py`, `tests/doc_coverage_test.py` — зелёные.

## 7. Не проверено

Визуально UI не открывался. Установленный пакет вне checkout не запускался. Windows/Linux не проверялись. 
