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
- Публикация ещё не выполнена: следующий шаг — финальный запуск скрипта,
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
