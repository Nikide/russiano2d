# Недостающие возможности SDK

Обновлено 2026-10-15. Этот документ — очередь дальнейшей реализации SDK.
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

1. **Проверить поставку SDK — запланировано.** Запустить установленный пакет
   вне рабочего дерева на macOS, Linux и Windows: `r2d-sdk` рядом с движком,
   шаблоны, запуск и сборка проекта без checkout. Наличие настроек сборки не
   доказывает работу пакета.
2. **Завершить редактирование студий данных — запланировано.** Graph editor
   кривых, выбор элемента кликом в предпросмотре RmlUi Studio, drag-ресайз
   фигур коллизии и drag зон акустики (числовые поля уже есть); редактор
   террейнов и анимации тайлов в Tilemap (автотайл есть); подбор кернинга и
   жирный/курсив стилем во Font Tools — ограничение движка
   (`docs/highlevel/font.md` §6).
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
| SDK packaging | Platform packages carry `r2d-sdk`, `sdk/`, templates and `sdk_tools.json`; unpack/create/run/build verified by `sdk_package_test.py`. | Fresh installed bundle on macOS/Linux/Windows outside the development tree. | Installed bundle runs the CLI and GUI without checkout; explicit errors when the engine or backend is missing. |
| Data studios | Seven Classic 2D studios on one RmlUi host; canonical JSON writes; JS ↔ C validation parity (`sdk_data_parity_test.py`). | Graph editor, click-to-select in RmlUi preview, drag-resize for collision shapes and audio zones, tilemap terrain/animation. | Edits are visible in the real runtime preview; saved files are ordinary JSON read by `$`; numeric fields remain as fallback. |
| Batch/automation | `r2d-sdk batch` validates assets from a manifest; the native agent client forwards all 19 engine protocol commands. | More job operations only when a 2D need appears; unknown operations must stay structured errors. | Manifest runs without Python/Node; per-job diagnostics; machine report equals stdout. |

Keep this table current after verification. A passing generic suite does not prove
untested platform packaging or all studio interactions. Detailed commands,
evidence, failures and remaining risks belong in SDK_HANDOFF.md.
