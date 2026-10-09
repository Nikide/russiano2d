# SDK Handoff

Last updated: 2026-10-09 (Europe/Moscow).

Спецификация: [Следующая цель SDK AGENT.md](Следующая%20цель%20SDK%20AGENT.md).
Фактическое поведение и команды — [docs/SDK.md](docs/SDK.md).
Исходный аудит — [SDK_AUDIT.md](SDK_AUDIT.md); текущие доказательства —
[docs/SDK_VERIFICATION.md](docs/SDK_VERIFICATION.md).

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
спецификации остаются отдельными задачами: tilemap/particles/collision/RmlUi editors,
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
[REPOSITORY_REVIEW](docs/REPOSITORY_REVIEW.md).
