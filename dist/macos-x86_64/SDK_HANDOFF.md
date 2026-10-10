# SDK Handoff

Last updated: 2026-10-09 (Europe/Moscow).

Исторические записи ниже сохранены как журнал. Удалённые старые аудиты и планы
доступны в Git history, они не являются текущей документацией.

Спецификация: [Следующая цель SDK AGENT.md](Следующая%20цель%20SDK%20AGENT.md).
Фактическое поведение и команды — [docs/SDK.md](docs/SDK.md).
Текущие доказательства —
[docs/SDK_VERIFICATION.md](docs/SDK_VERIFICATION.md).


## Сессия 2026-10-09: документация, сайт и публикация — В РАБОТЕ

Прямой запрос владельца: удалить устаревшую документацию (актуальную сохранить),
обновить главную, CI на все поддерживаемые платформы и Releases, полный
build_and_push с независимым push на три хоста; запустить его в конце.

- Удалены SDK_AUDIT, GAP_ANALYSIS, VFX_PLAN, REPOSITORY_REVIEW,
  SDK_REVIEW_2026-10-09 и docs/ci-archive. Доказательства/ограничения сохранены
  в SDK_VERIFICATION и этом журнале. World audit преобразован в актуальный
  RE2D_WORLD_GUIDE. Ссылки и SDK documentation menu обновлены.
- site/build-doc читает docs заново, обновляет generated pages/sidebar/sitemap
  и llms.txt/full; private handoff/spec не публикуются как пользовательские docs.
  Устаревшие remote doc pages удаляются deploy-fast после успешной загрузки;
  незавершённое удаление сохраняется в manifest и повторяется при следующем запуске.
- Главная рассказывает о реальном SDK, VRM Baker и пакете движок+SDK;
  удалены claims ImGui и единственного файла без библиотек. Источники сайта
  теперь tracked; credentials/generated/download/play остаются ignored.
- CI: five native Release runners (macOS arm64/x86_64, Linux x86_64/aarch64,
  Windows x86_64), native+JS+SDK batch, Linux GUI, пять архивов и SHA256 в
  GitHub Release только после успеха всех jobs. Runner labels сверены с GitHub docs.
- autobuild: macOS x86_64 cross FreeType static для нужной архитектуры, SDK
  копируется и из Docker context path; отдельные Docker builder images по CPU,
  чтобы не маркировать ARM executable как Linux x86_64.
- build_and_push: defaults all five platforms; независимые pushes и verification
  трёх хостов, duplicate URL dedup, bounded push timeout, machine JSON report;
  недоступность зеркала не отменяет другие зеркала и сайт.
- Проверки: actionlint passed; bash syntax/py_compile/diff check passed;
  publish_refs_test (реальные temp bare repos с одним отказом) passed;
  site_prune_test (mock FTP, удаление только doc/, retry) passed;
  ci_verify на macOS прошёл native/93 JS/SDK batch; ci_package создаёт настоящий
  SDK архив; SDK shell 57 checks passed; doc claims/coverage/hygiene passed.
- Первый полный запуск остановлен до commit/push: macOS x86_64 нашёл
  CMake 4 incompatibility в FreeType 2.13; задан minimum policy 3.5. Локальный
  DOCKER_CONFIG скрывал buildx plugin, legacy builder взял ARM base image
  несмотря на --platform amd64. Восстановлен штатный Docker config, сборка
  явно buildx --load --platform, image architecture проверяется перед reuse.
  Версия возвращена с 0.1.27 на 0.1.26 перед повторным запуском.
- Site preparation теперь завершается ДО git add, чтобы tracked index.html
  с новой версией действительно попал в release commit.
- Упаковщик проверяет реальные ELF/Mach-O/PE headers engine И r2d-sdk;
  несовпадение с label платформы — ошибка до удаления существующего пакета.
  release_architecture_test проверил пять CPU/platform и сохранение старого
  пакета при несовпадении. Дополнительно ci_verify выполнен на свежем
  release binary macOS arm64, а не только на прежнем build/.
- agents_doc --all теперь обновляет также docs/ внутри каждого пакета,
  удаляет снятые страницы, пересчитывает внутренние/global SHA256 и пересоздаёт
  архивы. Раньше обновление AGENTS/README оставляло архив и checksums устаревшими.
  SDK_VERIFICATION сведён к текущим доказательствам; убрана история прежнего
  checkout из World guide, исправлены самоссылки удалённых VFX plan.
- В notices добавлены FreeType acknowledgement и полный FTL для bundled
  cross-build; исправлен Linux platform hint про распространение lib/.
- FTP Markdown inventory сравнивает весь remote doc/ с текущим generated
  деревом, включая старые страницы, уже исчезнувшие из deployment manifest.
  Только отсутствующие .md под doc/ идут в удаление; pending failures сохраняются.
- Фактическая FTP inventory нашла 15 устаревших страниц, в том числе старые
  ROTSPRITE/API/sound_bank страницы, которых уже не было в local manifest.
  Список: build/publish_removed_docs.txt; удаление пока ожидает финальную выгрузку.
- Native/93 JS/SDK batch проверки также прошли в обоих свежих Linux build
  containers (x86_64 и aarch64), логи publish_linux_{x86,arm}_verify.log.
- Первый release commit 8011294 / v0.1.27 отправлен в GitHub; hosted CI run
  37886338433 действительно начался (ещё не результат). Остальные pushes/сайт в работе.
- После commit обнаружена ещё одна проблема: Git text normalization изменил
  CRLF license внутри tracked dist/, хотя архив/manifest считают исходные bytes.
  .gitattributes dist/** -text добавлен; нужен повторный выпуск, чтобы и Git
  package directories совпадали с checksum manifest. Теги не переписываются.
- Публикация ещё не завершена: следующий шаг — финальный запуск скрипта,
  затем сверка remote branch/tag, GitHub run/release assets и сайта.

## Сессия 2026-10-09: продолжение незавершённого SDK — итог проверенного среза

Запрос владельца: сверить весь гайдлайн, доделать незавершённое Claude;
всё сопровождение вести здесь. Предыдущие незакоммиченные исправления и игра сохранены.
Повторно подтверждены World/World Studio/Automation: 3/3.

- Исправлена ошибка прежнего аудита: §4 требует удаления ImGui, переходное
  правило старого UI_LAW не освобождает от этой работы. Удалены debug_ui.cpp/h,
  зависимость, CMake option/источники и обработка/отрисовка ImGui в main.
  F1 и $.debug.on/off теперь открывают общую RmlUi DevTools-панель; статистика,
  профиль, гравитация, reload; F5 работает независимо от UI сборки.
  Созданы недостающие строки узлов инспектора. Измерение текста — existing font runtime.
  Build прошёл; devtools/reload/text/courier 4/4; новый sdk_runtime_ui_test 11 проверок.
- release.py включает соседний r2d-sdk, sdk shell/lib/tools/ui/templates,
  реестр и документацию; не включает local state и native sources.
  Отсутствующий backend — ошибка до удаления старого пакета.
  Новый sdk_package_test распаковывает реальный архив, проверяет SHA256,
  CLI/tools/templates/new/run/build и GUI. Успешно 10 проверок на macOS arm64.
- Реальный тест пакетной сборки нашёл зависимость новой игры от lib/ исходного
  пакета. build.c теперь копирует соседние runtime-библиотеки вместе с игрой,
  отклоняет конфликтующий существующий файл; пакетный standalone запускается.
- Recovery реализован: отдельный .r2d-recovery-*.json, период 2 сек,
  явный RmlUi restore/discard/later и общий machine API $.sdkApp.recovery.
  Подключены data/atlas/Re2DSprite/World/RmlUi histories; crash-тест прошёл.

- Recovery подтверждён crash-тестом: 10 проверок (реальная мышь, undo/redo,
  Save удаляет recovery, исходник до Save неизменен). Existing author/studios/world 3/3.
- Обязательное source↔Re2D сравнение §39 реализовано: --compare в C baker
  создаёт 25 временных orthographic source PNG; GUI compare(yaw,pitch) показывает
  source и настоящий runtime рядом. Все 25 пар ракурсов проверены, снимок просмотрен.
- Weapon/environment presets и weighted optimized UV реализованы в существующем
  C sampler; никакого второго runtime. Grip — редактируемый origin, не угаданный
  хват; Environment — статическая деталь, не игровая сцена. Новый sdk_baker_modes_test прошёл 9 проверок.
- FBX: начата проверка C-only ufbx importer, версия 0.23.0; только SDK backend.
  Интеграция не выполнена: поддержка FBX остаётся явно открытой задачей; §29 допускает поэтапное добавление форматов. Полный прогон состояния
  (без FBX) завершён: 116/116, fail 0, skip 0, 301.3 с.

Логи: build/sdk_completion_baseline.log, sdk_completion_ui_tests.log,
sdk_completion_package_ui.log. Новые тесты: sdk_runtime_ui_test.py, sdk_package_test.py.
Документация и полная регрессия обновлены. Не публиковалось/не коммитилось.
Визуальная проверка нашла невидимый текст recovery (не был задан font-family);
исправлен общий шрифт окна. Автоматический click-тест без визуальной проверки
этого не обнаруживал. Матрица и TASKS обновлены. Исправленный dialog и читаемый профиль визуально просмотрены.

### Итоговые доказательства и оставшиеся задачи

- CMake Release configure/build: успешно; `build/sdk_completion_final_build.log`.
- Полный agent suite: **116/116**, fail 0, skip 0, 301.3 с;
  `build/sdk_completion_all_tests.log`. Включает игру (21), новый runtime UI (13),
  package (10), recovery (10), comparison (6), modes (9), прежние World/studios/batch.
- JS: **93 suites**, `build/sdk_completion_js.log`; native SDK core **100/100**,
  `build/sdk_completion_core.log`. Doc claims/coverage и `git diff --check` прошли.
- В engine binary нет экспортируемых ImGui symbols (`nm`); активная зависимость удалена.
- Локальный SDK package: `build/sdk-completed/russiano2d-macos-arm64.tar.gz`,
  checksum manifest внутри `macos-arm64/SHA256SUMS.txt` (237 файлов).
  Это локальная упаковка текущей версии 0.1.26, не опубликованный релиз.
- `build/neon-courier` пересобран текущим backend; запуск меню подтверждён.
  macOS codesign при append выдал `main executable failed strict validation`;
  локальный запуск работает, однако подпись для распространения НЕ подтверждена.
  Этот warning нельзя считать нулевым риском только из-за успешного CLI exitCode.

Полный гайдлайн не объявляется закрытым. Открыты FBX, кисти поверхностей,
графический редактор кривых, автоматическая численная метрика сравнения,
выбор элемента мышью в RmlUi preview и drag некоторых форм/зон. Существующие
World ограничения: runtime не использует PVS, slopes ступенчатые; skin — dominant
rigid ownership, walk процедурный, MToon lighting не переносится. Другие платформы,
WASM, удалённый CI и release signing не проверены. §29 позволяет поэтапные форматы;
нет утверждения о FBX-support или полном выполнении всех §0–81.

Все изменения сохранены в рабочем дереве. Следующий приоритет: исправить и
проверить macOS append signing, затем оставшиеся authoring возможности по матрице.

## Сессия 2026-10-09: повторный аудит и игра

Проверен исходный чистый HEAD `8d49e4d`. Архитектура SDK соответствует основным
законам, но полный гайдлайн реализован частично; матрица и границы —
[SDK_VERIFICATION](docs/SDK_VERIFICATION.md).

Создан `games/neon-courier`: шаблон blank кнопкой SDK, управление Input Tools,
Particle Studio (edit/undo/redo/save), Run/Package; gameplay через `$`, UI RmlUi.
Воспроизведены и исправлены реальные блокеры: `src/gui.*`/`main.c` теперь
используют общий поиск выбранного `--game`; `src/build.c` включает данные
рядом с корневым `main.js`; `src/script.c` читает JSON/exists из payload,
упакованные шрифты RmlUi сохраняют настоящее имя семейства; общий путь инициализации
подключает RmlUi callbacks также при загрузке payload. Регрессии: `highlevel_game_path_test.py`,
`neon_courier_test.py` (полный клавиатурный рейс и автономная сборка).
Исправлены описания input axis/vec, приватного engine, виртуальной мыши и
общих методов студий; актуализирован BUILD. Полный прогон 111/111 до последних
payload-исправлений; после них затронутые тесты 8/8. 93 JS suites, SDK core
100/100. Подробная последовательность и логи в отчёте.

Не проверены другие платформы и удалённый CI; исходные внешние модели заново
не скачивались. Следующий шаг: упаковка всего SDK и тест распакованного пакета.

## Сессия 2026-10-09: «SDK не рабочий, кнопки не нажимаются, нет инструментов»

**Причина мёртвых кнопок (подтверждена):** RmlUi без стилей `scrollbarvertical/sliderbar/…` не знает ширину полосы у
`overflow: auto`; при переполнении высоты он отдаёт под полосу всю ширину, и дети контейнера получают ширину 0
(каталог инструментов, списки). Клики по навигации работали — «Открыть» в карточках нет. Исправлено стилями в
`sdk/ui/theme.rcss`. Ещё: `@import` в RCSS не поддерживается (тема подключается `<link>`), градиентные
декораторы рендерер не строит (`Could not generate decorator element data`), в Open Sans нет «→ ← ●».

**Сделано (проверено тестами):**

| Что | Файлы | Проверка |
|---|---|---|
| Тема в стиле сайта, навигация по группам, Шаблоны, Сборки движка, Debug, Package | `sdk/ui/theme.rcss`, `shell.rcss`, `studio.rcss`, `shell.rml`, `sdk/app.js`, `sdk/lib/views.js` | `sdk_studios_test.py`, `sdk_shell_test.py`, `sdk_app_test.mjs` |
| Движок: мышь агента доходит до RmlUi | `src/app.c` (`r2d__app_forward_virtual_mouse`), `src/app.h` | `ui_virtual_mouse_test.py` (фикстура `tests/fixtures/uiclick`) |
| Хост студий данных + 7 студий (tilemap, particles, collision, layers, fonts, audio, input) | `sdk/lib/studio_host.js`, `data_session.js`, `kit.js`, `kinds/*.js`, `sdk/tools/*-studio.js`/`*-tools.js`, `sdk/ui/data_studio.rml` | `sdk_studios_test.py`, `sdk_kinds_test.mjs` |
| RmlUi Studio, DevTools | `sdk/tools/rmlui-studio.js`, `devtools.js`, `sdk/lib/rml_model.js`, `sdk/ui/rmlui_studio.rml`, `devtools.rml` | `sdk_studios_test.py`, `sdk_rml_test.mjs` |
| Нативные команды и валидаторы | `sdk/native/sdk_scaffold.c` (`templates`, `new`, `engines`), `sdk_data.c` (9 валидаторов), `sdk_assets.c`, `sdk_cmds.c` | `sdk_data_parity_test.py` (2912 правок, JS ↔ C, 0 расхождений), `sdk_studios_test.py` |
| Baker: импорт OBJ + MTL | `sdk/native/sdk_obj.c`, `sdk_gltf.c` (диспетчер по расширению), `sdk_tools.json` | `sdk_obj_test.py` |
| Шаблоны проектов | `sdk/templates/{blank,platformer,tilemap-room,ui-menu}` | `sdk_studios_test.py` (создание, запуск без SDK) |
| Реестр: 18 компонентов спецификации §8 | `sdk_tools.json` | `sdk_studios_test.py` (сверка и наличие экранов) |

Документация: `docs/SDK.md` §3, §4, §11, §13–§17; `docs/AGENT_API.md` §3.5; `docs/TASKS.md` §4; `CHANGELOG.md`.

**Решения, которые нельзя молча менять:** формат каждой новой студии — JSON `version: 1`, который игра читает
`$.fs.readJSON` (корень tilemap/particles — сами `opts`); существующий файл студия не перезаписывает; правила проверки
продублированы в JS и C и держатся паритет-тестом; студия без `standalone` без файла ведёт в Asset Browser.

**Не проверялось / ограничения:** окно меньше 1100×700 (раскладка рассчитана на 1360×820); Windows/Linux (проверка
только на macOS arm64); выбор элемента кликом в предпросмотре RmlUi Studio (нет hit-test API); drag-ресайз фигур
коллизии и зон акустики (числовые поля есть); SDK по-прежнему не входит в `tools/release.py` и `dist/`.

**Следующий шаг:** упаковка SDK (`r2d-sdk` + `sdk/` + `sdk_tools.json` + `sdk/templates`) в `tools/release.py` с тестом
запуска из распакованного пакета (docs/TASKS.md §5).

## Передача от Claude

Claude остановился на лимите во время Phase 6. В исходном HEAD `1c754c3`
компилятор `sdk_world.c` и world tests уже были закоммичены, но handoff ошибочно
писал NOT STARTED. Нативная сборка проходила; world test не проходил: ожидание
кода ошибки диапазона расходилось с компилятором, ray вызывался массивами вместо
объектов. До правок исходные задания и журналы Claude проверены, его файлы сохранены.

## Фазы по acceptance §60–67

| Фаза | Статус | Доказательство |
|---|---|---|
| 0 Audit | IMPLEMENTED | SDK_AUDIT + SDK_VERIFICATION |
| 1 SDK Shell | IMPLEMENTED | sdk_shell_test / sdk_cli_test |
| 2 Classic 2D slice | IMPLEMENTED | sdk_classic2d_test; исходники и hot reload игры |
| 3 Re2DSprite Studio | IMPLEMENTED | sdk_re2dsprite_test / sdk_author_test / parity |
| 4 Baker MVP Prop | IMPLEMENTED | sdk_baker_test; три реальные GLB и runtime shots |
| 5 Character / VRM | IMPLEMENTED по acceptance | Seed-san; mapping/ownership; expressions; native definitions |
| 6 World Studio | IMPLEMENTED по acceptance | RmlUi editor; compile; runtime; same-XY/different-height tests |
| 7 Automation / Batch | IMPLEMENTED | C batch/agent, RmlUi Automation, machine reports, CI workflow |

## Что добавлено и исправлено после остановки

- World Studio: дерево, план XY, высотный разрез, свойства cells/walls/portals/stairs/slopes,
  сетка и перемещение, split/join стен, undo/redo, сохранение/compile/validation,
  камера и preview настоящим `$.re2d.world`. Реестр открывает оба суффикса `.re2dmap`.
- Компилятор мира: строгие коллекции и диапазоны, steps/dir, проверка высоты
  сгенерированных ступеней, экранирование id в JSON диагностике, статус ошибки записи.
  Кромка из 600 сегментов проверяется целиком (в старом коде лимит 510 терял покрытие).
- Re2DSprite Studio: clips/emotions/variants/equipment JSON authoring, ключи timeline,
  seek реального runtime, preview прикреплённого предмета, undo/redo. Изменённые
  внешние clips копируются inline без изменения исходного animations.json.
- Baker: выбранное выражение VRM 0.x/1.0, dense/sparse POSITION morph до skinning,
  texture/color expression binds, KHR_texture_transform, видимая humanoid→Re2D mapping.
  Неверные числовые параметры/style/name и неконечные geometry/material значения
  отклоняются. Ошибка записи bake report больше не скрыта. Нативные PNG/JSON пишутся атомарно
  через временный файл и rename.
- Automation: `batch` вызывает тот же C baker/validator; после ошибочного job
  выполняет следующие. Повторные пути output, включая `./`/`..` aliases, отклоняются.
  `agent` — C-клиент исходного протокола, сохраняющий ответы/id без второго API.
- Из документации удалены противоречивые NOT STARTED и ложные будущие даты.
  Исторический аудит помечен как исторический; сайт генерируется из docs.

## Архитектурные границы

SDK — обычный R2D project на существующем `$` и RmlUi. Тяжёлая работа — C11/SDL3
в `sdk/native`, без Python/Node/shell runtime. Python используется только в тестах.
PNG v2 / character.json / animations — существующие runtime форматы.
Новых engine API, Scene Editor или второго рендерера не вводилось.

Статус IMPLEMENTED относится к acceptance фаз. Дальнейшие возможности большой
спецификации остаются отдельными задачами: расширенные операции студий,
Weapon/Environment, FBX, optimized UV, сравнение source↔Re2D, кисти поверхности,
графические кривые. Legacy ImGui в движке сохранён; весь SDK UI — RmlUi.

PVS пока данные компилятора (`runtimeUsed:false`), slopes — ступенчатая аппроксимация,
walk — процедурный клип, MToon — цвет/текстура без lighting/rim/outline. Dominant
skin ownership не заменяет полноценную деформацию: границы суставов и auto unwrap
могут иметь просветы; диагностика показывает это. Не выдавать эти ограничения
за continuous slopes, shader parity, авторскую анимацию или идеальный bake.

## Проверка и повторение

См. [SDK_VERIFICATION](docs/SDK_VERIFICATION.md): актуальные результаты, команды,
источники внешних моделей, SHA256 и визуальные наблюдения. Внешние модели и
снимки лежат в игнорируемом build; лицензированные исходники в поставку не добавлены.
CI настроен в `.github/workflows/build.yml`, удалённый GitHub запуск в этой сессии
не выполнялся.

## Контрольное сопровождение после фаз

2026-10-08: документация и философия повторно сверены; старые TASKS/GAP
очищены от закрытых пунктов, описания CI/поставки актуализированы, мусор удалён
из дерева и релизных архивов с сохранением payload и пересчётом manifests.
Повторный полный прогон: 106/106, 91 JS suite, native engine/SDK core — прошли.
Уточнение: acceptance SDK завершён в исходниках, но SDK package пока не входит
в `tools/release.py` и опубликованные снимки `dist/`. Полный итог —
[TASKS](docs/TASKS.md).

## Re2D World renderer — ongoing implementation, 2026-10-09

User approved the entire attached renderer plan and explicitly requested all phases without further approvals. Full source contract: [renderer plan](docs/re2d/RE2D_WORLD_GZDOOM_RENDERER_PLAN.md). Current API/status: [runtime](docs/re2d/RE2D_WORLD_RUNTIME.md), [implementation gates](docs/re2d/RE2D_RENDERER_IMPLEMENTATION_PLAN.md). Record subsequent work here. Renderer 1.0 is **not complete**; SDK acceptance status above does not mean renderer acceptance.

Implemented in C: rectangular XY cells with stacked free spans, native cell BSP/query/ray acceleration with completeness fallback, portal screen windows, canonical surfaces, native version-1 loader and SDK `world-compile --renderer`; continuous direct-runtime slopes, material albedo/normal/emissive, classic RGB/orientation/distance lighting, 128 generation-tagged dynamic lights with 16 references/span and 16 shadow candidates, native lifetime/flicker and per-span fog. New public path is `$.re2dWorld`; legacy world remains compatible. Registered actors use native pose/synthesis/composition rather than per-frame JS packing.

This continuation adds dedicated SDL_GPU constrained-surface shaders and offscreen targets, radius-filtered cached shadow geometry including solid floors, actual per-sample Re2DSprite depth, native attachment traversal via configuration-time child mirror, and GPU actor composition sharing the same depth/material/light/fog pass. Final GPU frames copy directly to the ordinary 2D output texture; debug frames read back native owner/depth buffers. `world.backend('cpu'|'gpu')` explicitly selects reference paths; CPU remains the default during acceptance. Metal storage-buffer binding needed an explicit build-time remap from SPIR-V binding 3 to Metal buffer 1; fixed against SDL's resource contract. Earlier GPU shadow measurements with incorrect binding are invalid.

Native `world.span(index).heights(bottom,top)` now updates floor/ceiling, support, effective portal openings, derived riser surfaces, collision, gameplay/shadow rays and GPU cache revision. Invalid overlapping moves reject transactionally. Dynamic portal-boundary slopes are currently rejected; static continuous slopes remain supported. Light association invalidation still rebuilds the bounded pool; not yet fully local dirty propagation.

Verified before the newest pose-budget changes: native ASan/UBSan world test (including 1024 accelerated/reference rays, continuous slopes, moving lift/riser and body samples independently occluding at wall depth), native Re2DSprite math, 7 legacy/new integration suites; new renderer checks include GPU/CPU material/fog/shadow/door/lift parity, registration/detach, lifetime and stale tokens. Native attachment/JSON regression and high-level Re2DSprite regression passed. GPU parity passed with direct actor composition. Subsequent changes require reruns; do not infer test completion from this entry.

Profiling correction: original CPU A/B/C 5.614/7.749/29.777 ms at 400×240 measured renderer work but excluded animation synthesis occurring earlier in JS orchestration. A fence-waited GPU animated stress subsequently measured A/B/C 135.863/433.309/227.574 ms, with actor synthesis alone 131.029/420.926/218.988 ms. These expose CPU anime synthesis cost, not slow GPU world raster. Machine Apple M4/macOS 27.0.1 arm64, modified checkout baseline 8011294; benchmark JSON records binary SHA-256. Early 1–2 ms GPU submission figures are not end-to-end results. Added projected GPU scissor bounds and explicit static-pose stress; rerun with `python3 tools/bench_re2d_world_renderer.py --backend gpu --frames 20 --output build/re2d_world_renderer_gpu_benchmark.json`. `world.profile({gpuWait:true})` waits completion for measurements. Ordinary GPU frames submit asynchronously.

Native round-robin pose budget/quantization and counters are implemented (`world.quality`, default one pose/frame, 3-degree view steps). Serial native sprite synthesis now shares one large supersampling arena per renderer and retains private final RGBA/sample-depth per handle. Latest application build passed; high-level Re2DSprite 51 checks, combat 22, new renderer 32 and JSON rig/attachment test passed after these changes. Native world/math regressions passed before the arena change. Static stress with fence wait is running; do not substitute submission-only timings. Next phase is native baked topology/BSP loading, then full debug/goldens.

Remaining gates include baked topology/BSP compiler output and continuous SDK slopes/stair portal connectivity, full debug modes and accurate material normals/emissive/shadow/overdraw views, transparent/additive surfaces and bounded decals/sky, local dirty/moving geometry completeness, hot reload, complete render lab, six deterministic goldens and final acceptance/provenance. Do not claim full 1.0. No GZDoom source/shader/assets copied. No commit/release/publication requested. Preserve unrelated worktree changes (CI/release/site/profile/SDK files included); do not revert or fold them into this task.

Continuation: fence-waited **static-pose** GPU stress after projected surface/actor scissors measured A/B/C 0.842/1.424/1.791 ms at 400×240, Apple M4, 8 warmup/20 samples. This includes GPU completion and shared-depth GPU actors, excludes animation resynthesis by explicitly setting actor motion speed to zero. Compare separately with animated timings above. Full provenance is `build/re2d_world_renderer_gpu_benchmark.json`; do not infer display frame rate or claim arbitrary animated 50-actor 60 Hz performance.

Native baker implementation is now being validated: SDK `--renderer` emits portable little-endian wire tables in a checksummed `baked` field alongside readable geometry metadata. Runtime directly imports cell BSP, span/wall and cell/portal incidence, canonical surfaces and portal ownership. It performs bounds/reference/tree/geometry/checksum validation without authoring BSP construction. Imported ray queries intentionally use a complete primitive fallback instead of claiming unverified cell-ray coverage. Checksum is integrity metadata, not an authentication mechanism. Changing compiled metadata is not authoring; rebuild `.re2dmap` to update authoritative baked tables. New native tests cover round trip, checksum corruption and a BSP cycle with recomputed checksum; tests are running, not yet claimed passed.

Philosophy check requested by user (2026-10-09): current implementation retains XY cells/BSP plus free height spans and explicit portals; constrained wall/floor/ceiling/slope primitives remain authoritative, with no public arbitrary mesh world. Heavy world/visibility/light/pose/render/bake paths are native C, public configuration remains `$`, SDK UI remains existing RmlUi, and GPU execution uses SDL_GPU. Re2DSprite retains its PNG/data-driven 2D synthesis and resolves sample depth for world occlusion. GZDoom is a behavior reference only. These boundaries are respected; this is not a claim that every acceptance gate is complete. Full BSP traversal/debug/goldens, continuous SDK slopes and other remaining gates above still require implementation and evidence. Latest baked integration rerun passed: renderer suite and SDK world suite, 2/2, no failures (SDK 81 checks); native roundtrip/corruption/tree-cycle checks also passed as recorded in the native test log.

Continuous SDK slopes/stair connectivity phase: `--renderer` now emits one plane with native floorSlope coefficients, accepts an omitted legacy segments count, validates both endpoint heights, and automatically connects generated stairs/slopes across shared edges when no authored wall blocks them. Explicit cells still require explicit portals. Default legacy stepped output is unchanged. New renderer tests verify exact intermediate native floor heights and four steps/three portals; renderer 35 checks and SDK legacy 81 checks passed.

BSP visibility phase: portal reachability marks native BSP ancestor branches; traversal visits only those branches, near side first, then submits their constrained surfaces. Immutable parent/cell ownership indexes are cached; branch marks are cleared during traversal without a full-tree frame scan. `bspNodesVisited` is public profiling evidence. Native 128-cell disconnected regression verifies fewer than 12 visited nodes, repeat-frame scratch reuse and only two local surfaces. Native world and renderer/SDK integration passed after this change. Static benchmark setup now flushes all initial actor synthesis before warmup with an explicit unlimited pose policy; earlier static numbers retain their original provenance and will be remeasured.

Additional user acceptance requirement: after renderer phases, build a runnable Dust2 reference demo as the final complete-work artifact. Include recognizable A/B sites, mid, long, short/catwalk, tunnels, doors and elevation transitions; validate native rendering, movement/support/collision, portal visibility and material/light/fog/debug behavior end to end. Use original project assets and constrained Re2D topology. Do not claim faithful geometry or finished demo from a plan or screenshot alone.

Debug/golden phase: all 13 public views now execute (final, cell-id, span-id, depth, owner, light-level, dynamic-light-count, normal, emissive, bsp, portals, shadow-mask, overdraw). NORMAL shares tangent-space decoding with native shading; EMISSIVE samples before light/fog; BSP identifies actual owner nodes; portal window overlays use native near clipping; shadow-mask traces eligible radius-filtered shadow lights. OVERDRAW explicitly uses SDL_GPU with depth disabled and additive covered-fragment counting, including lighting redraws; even CPU-selected worlds use this GPU diagnostic. Web support for this diagnostic is not claimed. Renderer integration 37 checks passed; material probe regressions passed. Six initial deterministic goldens recorded under tests/goldens/re2d_world with seed/configuration/tolerance/binary provenance. Repeat GPU capture matched all six byte-for-byte before the transparency changes. Multi-floor capture was visually inspected and corrected to actually show both stacked rooms, rather than an outside wall.

Transparency phase: native material categories masked/opaque/translucent/additive and opacity are public. Stable primitive-center far-to-near order (canonical ID ties) runs after opaque world/actors; no OIT claim. CPU and GPU blend without writing opaque depth. GPU owner target preserves opaque owners. Fixed the offscreen alpha so the ordinary 2D sprite does not blend the completed frame a second time. Tests passed: two colored translucent layers retain background, actor between layers has shared depth, additive flash preserves destination, CPU/GPU parity; renderer now 41 checks. Shadow geometry remains geometry-based rather than per-texel transparent shadow transmission. Six earlier goldens still require verification after these changes. Explicit transactional world reload is being implemented, not yet claimed verified.

World reload/SDK preview phase passed: native C file watcher checks at 0.35-second frame boundaries; valid edits replace geometry transactionally, invalid edits retain the previous world and expose reloadError. Explicit reload preserves actor roots, material/sky banks, native light generations, and indexed surface/span configuration only when the index domains match. Fixed partial light-state initialization during reload; the integration caught a frame crash before this fix. Renderer 46 checks passed, including valid/invalid watch edits. SDK World Studio now previews native baked/continuous topology through renderToSprite, in existing RmlUi; renderer/SDK studios/legacy world suites passed 44/117/81 checks before watcher changes. Same-XY authored cells merge into one native cell with stacked spans in --renderer; legacy output is preserved. Panorama/color backdrop and marked sky ceilings share CPU/GPU projection, while ceiling gameplay bounds remain authoritative. RotSprite GPU cache now uses monotone native instance identity to prevent allocator-address ABA; this newest cache change still needs regression.

Local dirty-light phase: association masks retain all 128 eligible candidates per span, selecting the lowest 16 native slots deterministically. Each light owns its reached-span list; updates/removal repair only that list and touched span rows. Portal/lift changes mark only lights whose radius intersects the changed volume. BFS scratch and touched lists are retained and cleared sparsely; no full native-cell scan per unchanged frame. Native tests passed for one updated light, a door excluding 127 remote lights, overflow priority and promotion on removal. Renderer/SDK world 49/81 checks passed after the first incremental implementation; newest sparse/topology-generation refinements still need a final rerun. Shadow geometry cache is still globally rebuilt on geometry revision; local shadow invalidation remains outstanding. BSP parent ownership now keys off topology revision, so height-only changes do not rebuild the entire tree index.

Decal phase passed: 128 native generation-checked handles, bounded UV rectangles on opaque/masked constrained surfaces, native lifetimes, shared material/light/fog shading and depth ownership. Transparent/sky base surfaces reject decal attachment explicitly. CPU/GPU decal parity, stale handles and expiry passed; native pool/UV/lifetime tests passed. The first GPU decal inherited the base wall tint; parity caught it and the pass now uses independent decal color. No generic world mesh was introduced.

2026-10-10 continuation — static lighting bake/reload: native author JSON now validates root classic configuration/static lamps and per-span RGB/fog, including generated stair/slope lighting. Wire v2 extends the native geometry/BSP/CSR payload with classic config, static/dynamic ownership, native generations/lifecycle, ambient data, all candidate masks and per-light reached-span lists. Loader validates masks/links/counts/generations and accepts geometry wire v1 compatibility. Static startup queries use imported associations with lightUpdates=0. New native tests passed for static metadata, association roundtrip, no startup rebuild and fractional wire-version rejection. Renderer integration reached 52 passing checks, including replacement of authored static color/ambient while retaining runtime dynamic handles. A test initially compared a lit sample to zero despite authored white ambient; the expectation was corrected to test the blue-minus-red contribution. No dynamic handle invalidation on successful reload.

Local shadow optimization: GPU keeps per-light radius-filtered primitive chunks keyed by topology, local changed-volume revision and lamp position/radius. Portal/lift changes increment only intersecting active lights; unchanged chunks are copied into the atlas without rescanning geometry. Global atlas upload is still repacked when any participating key changes, but geometry construction is local. Native sparse association tests and integration door/lift parity cover correctness; newest gpuShadowUpdates counters and final lab cache test are being validated. Native transparent sort items/IDs are reusable world arenas rather than frame allocations. Adjacent material sampler sets are batched without changing surface order. Profiler now exposes culling, actual draws/one fullscreen triangle per draw, material batches, shadow construction/submission/fence-wait wall times and explicit CPU/GPU payload byte categories. These are not hardware GPU timestamps or total process/driver memory; temporary upload buffers/shared actor authoring/supersampling resources are excluded.

Dust2 reference now exists under demos/re2d_dust2: inspectable .re2dmap, native baked .re2dworld, route/camera data, original sand/stone/crate/sign/minimap PNGs, public-$ gameplay and existing RmlUi HUD. 103 XY cells / 105 free spans / 157 portals / 498 canonical surfaces, three continuous ramps, two genuine same-XY mid/catwalk cells. Layout is an original Re2D interpretation of the Dust II route structure, not exact imported Valve geometry/assets or a full Counter-Strike game. Primary route context was Valve's https://www.counter-strike.net/dust2 . No external assets/code downloaded or copied. All seven actual named views render; continuous T→mid→CT→A→long→T, T→upper tunnels→B→CT and short→catwalk walks passed. The initial ramp walk failed because a radius-bearing walker crossed a riser with center-only support; gameplay now probes front/back support under its radius, using native coarse support/collision. A route test also crossed an authored crate and was corrected to follow the open pit path. Dust2 suite passed all 17 checks, including two height spans, door closure/reopen, perimeter collision and CPU/GPU tunnel parity. Screenshots under build/dust2_* are actual runtime evidence, not generated previews.

Full final lab added under demos/re2d_world_renderer_lab/acceptance while preserving the parent six-camera baseline. It supplies bright/dark/red rooms, doorway, four stair steps, upper room/solid bridge, continuous ramp, glass, fog, emissive/normal walls, sixteen authored lights plus moving/flash lamps, lower/upper pigs at identical XY, third actor and native AK attachment. Pig surface/character/PNG independently extend the existing animal template with authored pink/snouted/ear/eye patches; existing offline PNG compiler is reused. Final-lab integration passed all checks except the initial unchanged-shadow expectation: its attempted module-local moving-light switch did not disable the lamp. The demo now exposes acceptanceMoving and the test disables that public switch; final rerun is pending. Do not describe that pending run as passed.

Six original golden captures were verified again after static-light, transparency, reload, decal and local-shadow work: all six byte-identical, no re-recording. Latest material-binding/profiler refinements still require the final comparison. Existing Linux CI workflow now includes renderer, complete lab, Dust2, World Studio and tolerance-based golden comparison; only configured locally, no hosted CI run or release/publication claimed. Unrelated preexisting workflow/release/site/profile changes remain intact.

SDK World Studio now uses native compiled preview and existing RmlUi for static-light authoring/movement, native debug-view cycling, CPU/GPU selection, lighting toggle and PNG albedo/normal/emissive preview configuration. Continuous-slope hint corrected. sdk_studios 117 and sdk_world 81 checks passed after light controls; dedicated sdk_world_studio tests now include new real-element/native resource checks and are running. Renderer pose-budget/fair round-robin tests are also being run. Current runtime documentation was rewritten around actual C/SDL_GPU behavior, public APIs, baked tables, reload and measured limits; implementation-plan final evidence is pending final tests/benchmark.

Final validation, 2026-10-10: complete lab passed 18 checks, Dust2 17, dedicated World Studio 19. Pose scheduling regression now freezes animation before asserting a stationary queue drains; budget=1 and round-robin both pass. Twelve relevant agent suites passed (12/12, no fail/skip): camera22, BSP world30, legacy world30, Re2DSprite51, combat22, native84, Dust2 17, full lab18, renderer54 at that run, JSON rig/attachment smoke1, World Studio19, SDK world81. Subsequent generated-portal height correction added the 55th renderer check: authored lintels above headroom must not suppress stair portals. Regenerated full lab now has 11 portals (previously 9); its stairs/upper ramp connect natively. Latest focused run passed renderer55/lab18/Studio19/SDK81. Latest native/JS verification via tools/ci_verify.py passed all native executables (including ASan/UBSan world/RotSprite), JS suites and SDK fixture batch. Latest engine/SDK Release builds passed, with only existing duplicate linker library warnings. `git diff --check` passed. Test-generated fixture recovery artifact was removed; World Studio test now restores a preexisting recovery file or removes only its own one.

Latest six GPU golden comparisons after batching/profiler/final code changes matched every baseline byte-for-byte; no re-recording. Latest fence-waited static benchmark at native400×240, Apple M4/macOS27.0.1 arm64, seed7, warmup8/sample20, unlimited initial static pose synthesis: warm A/B/C 1.056667/1.733438/1.659104 ms. Cold native frames A/B/C 144.995750/444.015333/254.589333 ms, dominated by initial actor synthesis (126.580250/411.129250/232.270042 ms). Selected cells16/30/16, surfaces166/486/167, relevant lights8/12/16, visible actors9/29/15; total actors10/30/50. GPU texture payloads21,562,376/63,505,416/34,145,288 bytes; GPU buffer/download payloads1,922,048/1,922,048/1,947,424 bytes; BSP visits23/34/29, draws302/1044/314, adjacent material batches10/30/16. These payload counters exclude temporary/shared/driver allocations. Full machine/binary digest/modified-checkout provenance, cold counters and timings are in docs/re2d/RE2D_RENDERER_BENCHMARK.json (copied from final build report). Warm static results do not promise arbitrary many-actor animated throughput; earlier unbudgeted animated measurements and quality limitations remain documented.

Dust2 additionally launched and rendered from its own project working directory with absolute game/binary paths (not just repository cwd): actual world103 cells and screenshot build/dust2_project_cwd.png. Map README, current runtime/API/format/quality documentation, phase0–15 implementation/evidence table and final benchmark report are present. Rectangular cells, binary doors, flat-only runtime lift edits, conventional center-sorted transparency, geometric shadows, per-light local chunks with whole-atlas upload, wall/fence profiling and payload-memory scope remain explicit limits. GZDoom runtime observations and hosted CI success are not claimed. No commit/release/publication performed; unrelated existing changes preserved. All authorized implementation/verification phases have progressed through the complete native rectangular-cell renderer lab and runnable Dust2 reference artifact.

Visible Dust2 launch: final build/russiano2d --game demos/re2d_dust2 --seed 7 is running in a visible native window (session38918). Log confirms main.js loaded with update/render hooks and GPU buffers initialized, no startup errors. User requested photos/status; delivered actual native A-site and mid captures from the validated Dust2 suite. Current stage is phase15 local acceptance passed; hosted CI remains unrun and no commit/release/publication performed.

2026-10-10 document-conformance continuation: user reattached the plan and requested checking everything against documents and continuing. Reattached source is byte-identical to docs/re2d/RE2D_WORLD_GZDOOM_RENDERER_PLAN.md. Added docs/re2d/RE2D_DOCUMENT_ACCEPTANCE_AUDIT.md mapping mandatory scope and all 17 final scenario requirements to implementation/tests and explicit limits. Found actual lab mismatch with behavior contract: moving lamp was warm on lower storey. Changed it to red at upper h=208, preserving the native light pool and public demo switch. Strengthened actual-runtime acceptance with moving upper lamp identity, isolated upper red light crossing its upper portal but not lighting the lower same-XY span, and independent muzzle contribution at actor/wall/floor receivers. Retained real pig/AK framebuffer crop and lifetime checks. Final rerun passed 21/21 checks, exit0, log /tmp/re2d-document-acceptance.log. No native binary or parent golden fixture changed; no baseline replacement. Prior full renderer/native/SDK/golden/benchmark evidence remains scoped to its recorded run. GZDoom runtime observations and hosted CI remain unperformed; exact Valve geometry/full shooter remain out of scope. No commit/release/publication; unrelated work preserved.

2026-10-10 full documentation rewrite requested by user: replaced stale docs/RE2D.md, RE2D_WORLD_GUIDE.md, RE2D_WORLD_PERF.md and highlevel/re2d.md with current native renderer overview, runnable complete main.js, exact public API/defaults/limits and provenance-aware performance. Expanded docs/re2d/RE2D_WORLD_RUNTIME.md into full Russian runtime/ownership/query/lifecycle/material/light/geometry/reload/debug/profiler reference. Added RE2DSPRITE_WORLD.md, RE2D_WORLD_FORMAT.md, RE2D_MIGRATION.md and docs/re2d/README.md navigation. Preserved valid legacy room/kind/$.re2d.world contract under highlevel/re2d_legacy.md with explicit historical timing scope; old CPU report moved to re2d/RE2D_WORLD_CPU_HISTORY.md. Updated README, SDK CLI/World Studio, HIGH_LEVEL_API, internal/NATIVE, highlevel depth/mesh/Re2DSprite and existing sprite guide/JSON/v2/math pages to link current behavior and distinguish ordinary batch from native World. Removed obsolete current claims of no portals/textures/slopes/sample depth and nonexistent costume C control. Corrected anime runtime resolution512 (legacy C wrappers256), documented anime-only exported sample depth with pixel/v1 image-depth fallback, camera pose vs facing angle, existing JS character-animation orchestration vs native renderer hot paths, and source-linked sample-depth equations. Documented differing public lighting defaults vs authored config, material default masked, full-replacement camera/global lighting setters, point support/static blocked limitations, numeric-domain reload caveats and screen-space viewmodel limits. No runtime implementation or original source plan changed in this documentation turn.

Documentation execution evidence: extracted exact full main.js from World guide into build/re2d-doc-example and launched native engine; passed GPU frame counts, two stacked actors, native AK candidate, both span queries, door closure/reopen and baked source load. Exact E/O/Space callbacks passed upper/lower distinct captures, upper door collision/reopen and lower flash illumination/expiry. Actual lower.png/upper.png visually inspected. Extracted SDK JSON compiled with --renderer and runtime imported baked topology/static lighting; all four format JSON blocks parse. Documented stairs/slopes fragments compiled and native support queries verified floor16 at stair(300,60) and continuous ramp(120,320). Existing doc_claims_test.py and doc_coverage_test.py passed; balanced code fences and 461 local file/heading links across 27 inspected documentation files passed; git diff --check passed. Temporary runnable example/captures are under ignored build/, not a new permanent game/test. No native rebuild required for prose-only changes. Prior native/golden/stress results are not presented as rerun in this turn. All findings/evidence preserved here; no commit/release/publication or memory update performed.

2026-10-10 playable Dust2 FPS/NPC continuation: user requested large standing Re2DSprite NPCs, mouse FPS walking/Quake-like movement, then a 1920x1080 window and reported repeated falls and missing ramp/ledge sides with an actual screenshot. Added six standing anime mascot roots sized72x88 from existing rotsprite/russi.character.json, game-specific 120Hz acceleration/friction/air-strafe controller (ground240/run320, jump270/gravity900), mouse capture/look, Space jump, Shift run, Esc unlock, M capture, Q quit, LMB/F timed native flash and speed/ground-air HUD. Native target800x450 is scaled into configured1920x1080 window; this is not a native1920 framebuffer or exact imported Quake physics. No combat AI introduced.

Collision correction: radius-edge support on a slope was mistaken for airborne because centre floor differed by up to6.4 units; retained grounded state within the existing9-unit step allowance. Air horizontal movement now validates both feet and head in one native free span, rejects entering floor/ceiling solids, and can land on a rising floor while descending. Downward integration additionally clamps to native support if an exact-contact ray misses. Existing coarse native geometry remains authoritative; no generic physics or mesh backend added.

Geometry correction: actual frame showed a missing ramp side and sky under an adjacent raised ledge. Added close_ramp_sides.py deriving exposed solid/free intervals at shared edges from compiled topology and writing inspectable constrained author walls; regenerated native artifact/static bake.167 added wall pieces,293 authored walls,103cells/105spans/157portals/665canonical surfaces. Flat ledge sides close exactly; inclined sides use one-unit strips (<=0.8 world-unit edge deviation), continuous floor planes unchanged. This is a demo-authoring closure, not a general SDK auto-closure claim. All walls use existing sand material. Rebuilt real1920x1080 capture build/dust2_ramp_sides.png visually inspected: both reported holes closed.

Verification: final Dust2 integration37/37 checks passed, including six NPCs, actual relative mouse/Space input, ground accel/friction, air strafing, lower ceiling, all three ramps both directions with/without repeated jumps (12 real-controller routes, feet remain in free spans), solid ramp/ledge side ray hits, seven distinct native frames, prior continuous whole-map routes, sameXY storeys, door collision, outer boundary and CPU/GPU tunnel parity. Public window.size() confirmed1920x1080. Compile diagnostics0errors/0warnings. git diff --check passed. No native rebuild required for gameplay/map changes; no commit/release/publication; unrelated existing work preserved.

2026-10-10 user architecture correction and remaining ramp screenshot: reread PHILOSOPHY.md, ARCHITECTURE.md, AGENT_IMPLEMENTATION_RULES.md and highlevel/_CONTRACT.md; inspected public world.add/remove and native runtime registry/collect. Registry contains JSValue references to existing $ nodes, not a new gameplay Actor class, AI/tick/component hierarchy or entity graph. Reworked current World docs/examples to use sprites and existing $ nodes, explained render-reference ownership and existing node lifecycle; retained exact existing private bindings/profiler field names actorAdd/actorRemove/actors/actorCandidates/composedActors/actorMs with explicit compatibility explanation. No public API rename, no new entity subsystem, original supplied renderer plan and historical evidence preserved.

Second screenshot reproduced a real visibility defect at short ramp(x1200,y1410,feet24,eye72,yaw-90,pitch-15): the whole variable-height side used a rectangular portal bottom128, hiding the adjacent low region. Corrected existing native SDK generated slope-edge portals by subdivision only along varying shared edges, up to256 pieces, one-unit pieces on this map; continuous floor equations and authored portal indices unchanged. Native rectangular portal/collision/lighting contract remains. Emitted float bounds use9 significant digits:6-digit output initially rounded below strict adjacent-plane validation, caught by recompilation and repaired. Regenerated artifact now316portals/321openings/824surfaces with the previous103cells/105spans/293authored walls. Before/after actual1920x1080 captures build/dust2_ramp_view_before.png and after.png visually inspected: sky wedge replaced by neighbouring geometry.

Verification: Dust239 checks passed including new low-camera visibility and actual framebuffer pixel regression; SDK world81 checks passed, docs claim/coverage guards passed, diff check passed. Added fresh SDK compile/native-load regression to the Dust2 suite (final rerun recorded below). Only existing SDK native target rebuilt; game renderer core unchanged. No general 3D scene, ECS, second UI or physics engine introduced. No commit/release/publication; live demo relaunched on final artifact.

Final follow-up validation: Dust241/41 checks passed, exit0, including invoking the freshly built SDK and importing its newly emitted segmented-portal artifact in the game runtime. Updated the existing sprite JSON/v2/math and depth/mesh references as well to use sprite/node terminology, retaining literal API/profiler names only where required. Final live launch uses1920x1080 project configuration and regenerated artifact.

## 2026-10-10 — Dust2 club and native Re2D World positional audio

User authorized a club room with changing lamps, supplied music, distance/obstacle muffling and HRTF; explicitly requested adapting Steam Audio/Resonance to Re2D rather than importing an entire 3D system. Re-read PHILOSOPHY/ARCHITECTURE/agent implementation rules. No UE actors/scene framework, mesh scene, imported simulator, new UI toolkit or independent audio engine introduced.

Implemented C → `$` in existing audio/Re2D modules: `world.audio` / `$.re2dWorldAudio(world)`, positioned source handles (`at`, `volume`, `range`, `info`, `stop`), shared world camera listener, generation checks protecting reused mixer channels and world-specific disposal. Native frame traversal computes distance attenuation and native wall/floor/ceiling/closed-portal direct-path obstruction. Obstruction multiplies gain by .18 and sets 700 Hz low-pass (unobstructed 22 kHz). Camera-relative height/yaw/pitch feeds Steam Audio binaural effect. Coincident listener/source has a defined direction. JS validates before starting playback and setters validate before committing state.

Steam Audio SDK 4.8.1 binary dependency consumes ONLY default HRTF/context/binaural PCM APIs. No Steam Audio geometry, scene, simulator or plugin imported. `cmake/SteamAudio.cmake` pins the official archive and SHA256; SDK lives in ignored build/_deps, local SDK override supported. macOS/Linux x64/Windows x64 integration; only macOS exercised. Runtime library copied beside the main binary under lib on macOS/Linux (Windows beside exe), installed with Apache/CIPIC/bundled notices in `third_party/steam_audio`. Existing SDL_mixer cooked callback sees resampled stereo PCM; downmix→mono→HRTF stereo, fixed 512-frame adapter (~10.67 ms at 48 kHz), per-channel history reset, atomic parameter publication. Existing channel FX/raw callback retained. Explicit hrtf:false uses equal-power pan; requested unavailable HRTF throws rather than falsely claiming it.

Dust2 source + compiled data now include club entry/room east of Long/T, two native doorway portals, speaker/fixture solid walls, four animated colored lights, a Re2DSprite mascot and supplied MP3 copied from Downloads as `demos/re2d_dust2/club_loop.mp3`. 105 cells, 107 spans, 318 portals, 864 canonical surfaces. Minimap and RmlUi controls updated, key 8 visits CLUB; demo initially opens CLUB. Existing seven route cameras, Quake-inspired movement and 1920×1080 window retained. No combat AI claim.

Verified final build `russiano2d` + `r2d_audio_spatial_test` on local macOS with Steam Audio universal dylib. PCM DSP: 9/9, actual ear asymmetry, front/back/elevation response, arbitrary 73-frame callbacks vs whole-buffer equality, finite PCM, 8 kHz suppression under 700 Hz cutoff, bit-exact disabled bypass. World audio integration: 12/12 with actual MP3 playback/HRTF, distance fade, open/closed door, ceiling between heights, coincidence, Long→club passage, changing native lights, stale handle safety, updates, disposal and invalid range. Dust2 original movement/render regression: 41/41, including all ramps/routes, former sky-hole screenshot and CPU/GPU tunnel comparison. Existing native audio FX 29/29; highlevel_audiobus and highlevel_docsapi passed. Logs in /tmp/re2d-{spatial-test,world-audio-test,dust2-club-regression,audiobus-club,club-docsapi}.log. Actual native frame `build/dust2_club.png` visually inspected: colored walls/floor, mascot and speakers; initial overly dark room corrected. Build has existing script.c tautological comparison/linker duplicate library warnings, no build error.

Docs: `docs/re2d/WORLD_AUDIO.md` contains API, attenuation formula, listener convention, ownership, build/dependency and explicit limitations; links added to current world/highlevel guides, demo README updated. Current obstruction is a direct-ray authored approximation (no diffraction, reflections, reverberation/material transmission); gain smoothing is frame-dependent; default HRTF is not personalized. Headphone localization not subjectively measured. Release bundle scripts/platform distribution and hosted CI are NOT verified. No commit, release or publication. Existing unrelated dirty changes preserved.

Visible demo restarted from rebuilt binary into club; process ID recorded `/tmp/re2d-dust2-club-visible.pid`, log `/tmp/re2d-dust2-club-visible.log`, screenshot requested at two seconds `build/dust2_club_visible.png`. Check actual process/screenshot before reporting launch evidence. Task-specific prior demo PID51543 terminated for replacement.

Launch evidence confirmed: PID59921 alive, MP3 decoder reports 179.5 s, SDL mixer 48 kHz stereo, screenshot saved and inspected. Native visible drawable is 1920×1018 on this desktop (window requested 1920×1080; macOS available window area constrains height), while headless test screenshot is 1920×1080. Do not report the visible drawable as 1080 pixels tall.

Final visual tuning reduced club lamp intensity to .7–1.5 (radius600) to avoid saturated white walls. World audio integration rerun:12/12. Final headless club image inspected; visible demo restarted as PID59974 after tuning, superseding PID59921.

## Active follow-up 2026-10-10 — panorama / reported rendering bugs / Chicken Dance

User asks to maintain a document of missing features for future implementation. Added `docs/SDK_IMPLEMENTATION_GAPS.md`: separate implemented evidence, active work and future gaps, with acceptance criteria. Current panorama/UV and FBX import work MUST NOT be reported complete until their dedicated runtime tests and actual frames pass. Audio future work includes diffraction/reflections/reverb/material transmission/time-based smoothing and platform packaging. Animation future work includes generic mapping/rest-pose/twist/fingers/multi-stack/root-motion/blending. No new actor or 3D scene framework is planned.

User follow-up asks whether missing capabilities are being recorded so they can be implemented later. Added Russian execution order and status definitions to the backlog; linked it from SDK.md, SDK_VERIFICATION.md and TASKS.md, preserving dated historical verification. Current evidence: supplied EXR adapter7/7; actual CPU/GPU panorama frames and club dance frame captured; FBX import emits4.76666667s/144samples/31tracks. Dedicated panorama seam/translation, world-UV subdivision and dance loop/runtime acceptance remain pending; do not mark these complete from screenshots alone. All three supplied assets are available; no user file/approval blocks the current work. Future items require explicit fixtures/tests before completion claims, particularly other humanoid rigs and installed platform bundles.

## 2026-10-10 — requested outdoor headroom and T spawn

User requests empty space above map walls and demo startup at T. Existing sky already renders as a directional background without geometric depth; changing panorama pixels would not increase portal visibility. Authored outdoor span tops192/320 were below boundary wall tops360. Raised84 outdoor authored cells and all3 continuous slope tops to1024, expanded matching explicit outdoor portal apertures and regenerated native compiled/static-light data. Kept authored walls/floors/ramps, lower bridge spans, club/tunnel ceilings and existing gameplay door IDs. Counts remain105cells/107spans/318portals/864canonical surfaces. Demo ready now calls T SPAWN (1040,1840,eye48,yaw-90); club remains key8.

Before/after real CT-ramp frames build/dust2_ct_sky_before.png and after.png captured; build/dust2_ct_roof_headroom.png inspected at CT (600,240,48,yaw135,pitch35). Original41 Dust2 checks pass including all walking/jumping ramps, closed tunnel ceiling, doors and CPU/GPU tunnel parity. Added dedicated startup/outdoor air/closed-room bound regressions; final rerun recorded below. This is authored-map headroom, not a guarantee that all renderer defects in arbitrary maps are resolved. Existing panorama/animation broader acceptance remains in the backlog.

Final headroom acceptance44/44 passed, exit0 (/tmp/re2d-sky-headroom-final-tests.log); native compile0errors/0warnings and diff check passed. Replaced task-owned visible PID66804 with67089. Fresh actual visible frame build/dust2_t_headroom_visible.png confirms T SPAWN; native drawable1920x1018. No commit/release/publication.

Correction to previous compile summary: source compile actually emits79 SDK_WORLD_OPEN_EDGE warnings for intentional outdoor headroom above wall height360. The earlier0warnings assertion was incorrect;0errors and44/44 runtime checks remain valid. Recorded the diagnostic limitation in the backlog and demo README rather than suppressing it.

## 2026-10-10 — crate lids, player footsteps and roof-aware wind

User screenshot showed a real missing cap: authored crates consisted only of4walls. Added inspectable demo authoring tool close_crates.py: derives5footprints from existing tagged walls, partitions intersecting XY cells, raises free-span floors to crate tops, remaps/splits matching portal apertures while retaining original first152indices (including gameplay doors), appends extra/internal apertures. Existing native floors now form real textured lids and solid volumes, with native ray/support/collision/light/depth; no mesh, second scene or visual-only cap. Recompiled static-light artifact:137cells/139spans/393portals;327authored walls unchanged. Lower bridge spans and continuous ramps retained. Added crateTop material and moved B mascot outside crate footprint.

Downloaded user-selected OpenGameArt9wet snow steps by Iwan qubodup Gabovitch and wind1 by Luke.RUSTLTD; both source pages identify CC0. Original wind WAV retained;9FLAC steps converted to mono48kHz PCM and normalized (FFmpeg loudnorm I=-20,TP=-3,LRA=7). Provenance/license/processing in demos/re2d_dust2/audio/CREDITS.md. These are user-requested snow placeholder footsteps, not a material-specific sand/stone bank. Steps accumulate actual grounded horizontal movement, stride72 (running90), cycle nine variants without immediate repeat, positional feet-level HRTF/priority0. Idle, blocked movement and airborne travel do not accumulate steps. Wind loops at listener XY/height800 (volume.14/reference1000/range2000), native roofs attenuate by.18 and low-pass700Hz; outdoors22kHz. Existing audio pipeline, source lifecycle and gain smoothing reused. No diffraction/reverb claim.

Verification: original Dust2 movement/render44/44; new props/audio18/18 (all5lid ray hits,5solid/support checks, mixer HRTF wind, club/tunnel roofs, restoration outside, actual WASD footsteps, idle/air silence, real lid CPU/GPU frame agreement); club World audio12/12. Initial special test failed because held movement replaced pending jump and camera physics changed between captures; corrected test ordering/resetting camera, then passed. Actual build/dust2_crate_lid.png inspected. Compile0errors/79outdoor-headroom warnings. Logs /tmp/re2d-{crates-regression,props-audio-test,club-audio-after-props}.log. No native game code/build needed, no commit/release/publication. Visible demo restart follows.

Visible demo replaced task-owned PID67089 with67487, starts T; startup log confirms wind55.1s and music179.5s decoders plus real snapshot build/dust2_props_audio_visible.png (1920x1018). All9step PCM files verified non-silent mono48kHz. Canonical surfaces1004 (327authored walls +399opening closures +278span planes). Diff check passed.

## 2026-10-10 — close-range talking Re2DSprite NPC

User provided3 FBX motions (Talking, Standing Arguing, Walk In Circle), a9.1MB ElevenLabs Suzu MP3 and screenshots; asks for proximity-triggered monologue, capped head tracking then torso turn, several looping actions during speech, and revised RE2D title. Kept existing architecture: ordinary Re2DSprite node, SDK-time conversion to animation JSON, `$` proximity/gameplay, existing World audio and RmlUi.

Enhanced SDK `animation-import` to accept `--stack`; absent argument chooses the longest stack. Each FBX contains `Take 001`(3.33s) and `mixamo.com`; imported latter: talking5.933s/90samples, arguing20.8s/313samples, circle-walk17.367s/262samples at15Hz,31 tracks/clip. Added repeatable `demos/re2d_dust2/import_npc_animations.py`; combined animation bank preserves base idle/walk/run/blink/talk clips. Added `bodyYaw` as existing rig-control on root Y, additive to FBX channels; existing headYaw stays additive. NPC begins tracking at560 units/clear sight, head capped32°, torso turns remainder up to75°/second. At250 units she starts a one-off approach voice and RmlUi line; three clips switch every4.2s until audio ends. Audio distance/HRTF and map obstructions apply. Leaving620 rearms the encounter. MP3 is592.32s as supplied. Rebranded HUD `РУССИАНО2Д` / `ТЕСТ RE2D · МИР В ДВУХ ИЗМЕРЕНИЯХ`; project window title updated.

Agent runtime check confirms voice source playback/HRTF, caption text/visibility, imported pose, automatic talking→arguing→walkCircle cycle and controls at body yaw-58°/head yaw-32° facing player. Actual rendered frame `build/re2d_npc_conversation_final.png` was inspected after the RmlUi child-display fix: the HUD branding and monologue are legible without hiding the rest of the HUD. The importer/helper and SDK rebuild completed successfully; FBX source clips remain copied under demo `source/`, and the temporary per-clip import reports were removed after combining them into `npc.animations.json`. No broad test suite was run for this focused feature; validation was a direct Agent runtime playback and rendered-frame inspection. Restarted the visible demo from the current tree at T (PID71202); startup log confirms window title `Руссиано2Д · RE2D` and1920×1080 logical size (1920×1018 drawable). Captured and inspected initial frame `build/dust2_npc_visible.png`; `git diff --check` passed.

2026-10-10 final HUD tweak: at user request removed the NPC monologue subtitle/notification overlay while retaining the proximity voice, animation cycling and look behavior. Replaced the HUD heading and native window title with the exact text `Руссиано2Д - РЕ2Д ТЕСТ 0.2`; removed the now-unused overlay markup, style and JS updates. Updated the demo README. Relaunch the visible demo from the current tree and capture a final frame; do not remove spatial audio.
