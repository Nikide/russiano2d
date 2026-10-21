# SDK: проверенное состояние и ограничения

> Историческая проверка отдельной SDK-сборки до миграции на Xmake. Её команды
> и результаты не относятся к текущей конфигурации. Текущие build/package
> gates описаны в [BUILD.md](BUILD.md), [TESTING.md](TESTING.md) и
> [RELEASING.md](RELEASING.md).

Сверка 2026-10-20, macOS arm64, ветка `main`, сборка `build`
(RelWithDebInfo). Команды и возможности — [SDK.md](SDK.md),
очередь работ — [SDK_IMPLEMENTATION_GAPS.md](SDK_IMPLEMENTATION_GAPS.md),
журнал и история проверок — [SDK_HANDOFF.md](../SDK_HANDOFF.md).

## Автоматические проверки (фактический вывод этой сверки)

- `cmake --build build --target r2d-sdk r2d_sdk_core_test --parallel 4` — успех;
  `r2d-sdk version` отвечает `1.3.1`, в соответствии с `CMakeLists.txt`.
- `build/sdk/native/r2d_sdk_core_test` — **9/9 групп, 0 сбоев**.
- SDK agent-интеграционные тесты — **13/13 ok, 660 проверок**: `sdk_automation_test`,
  `sdk_classic2d_test`, `sdk_cli_test`, `sdk_data_parity_test`,
  `sdk_extensions_test`, `sdk_package_test`, `sdk_recovery_test`,
  `sdk_runtime_ui_test`, `sdk_shell_test`, `sdk_splash_test`, `sdk_studios_test`,
  `sdk_tools_panels_test`, `sdk_world_studio_test`.
- `./build/r2d-sdk lint` для всех изменённых SDK JS-файлов — без диагностик;
  `tests/js/sdk_app_test.mjs` — 14/14 проверок, включая показ/скрытие
  диагностической панели.
- `./build/r2d-sdk validate sdk --json` — ошибок нет; одно предупреждение
  `SDK_TILEMAP_NO_SRC` в шаблоне `sdk/templates/tilemap-room/level.tilemap.json`.
- Пользовательский путь GUI: `sdk_shell_test` проверяет поиск по расширению,
  фильтрацию/сброс списка, открытие проекта, ассеты, справку, запуск и сборку.
  Также проверяет скрытие пустых результатов, короткие имена недавних проектов
  и сворачивание/раскрытие нижней панели диагностики. `sdk_package_test`
  проверяет распакованный пакет и игру без checkout.
- Дополнительные end-to-end проверки: `world_editor_test` (69 проверок) и
  `vn_narrative_validation_test` (15 проверок). Итого **15/15 сценариев, 740
  проверок** в этих прогонах. Code Check проверен кликами по Doctor/Lint/Validate,
  API Browser — загрузкой schema; VN Maker — загрузкой модели сцены и native
  validation.
- В `world_editor_test.py` итог `FAILURES: 0` ошибочно классифицировался
  `tools/run_tests.py` как провал (раннер считает любой вывод с префиксом `FAIL`
  ошибкой). Маркер переименован в `ASSERTION_FAILURES`; повторный прогон — ok.

Это число проверок конкретных сценариев, а не доказательство выполнения всего
большого гайдлайна. Логи — `build/test_*.log`, машинные отчёты SDK — в `build/`.

## Что покрыто

- Оболочка SDK и реестр (`sdk_tools.json`, 20 компонентов):
  `sdk_shell_test.py`, `sdk_cli_test.py`, `sdk_package_test.py`.
- Classic 2D (Sprite/Animation Studio, атласы): `sdk_classic2d_test.py`.
- Студии данных (Tilemap, Particle, Collision, Parallax, Font, Audio, Input,
  RmlUi Studio) и паритет JS ↔ C проверок: `sdk_studios_test.py`,
  `sdk_data_parity_test.py`. Проверены создание и сохранение файлов, изменение
  моделей мышью и командами редактора, undo/redo, preview и нативная проверка.
  Пустые нижние панели диагностики скрыты во всех студиях; сообщения появляются
  при ошибках.
- Упаковка SDK, распаковка, CLI/GUI и сборка проекта без checkout:
  `sdk_package_test.py`.
- Batch (`validate`) и нативный клиент агентского протокола (19 команд):
  `sdk_automation_test.py`, манифест `tests/fixtures/sdk/ci.batch.json`.
- Recovery студий: `sdk_recovery_test.py`.
- Re2D World Studio и World Editor, запуск экранов и операции world backend:
  `sdk_world_studio_test.py`, `world_editor_test.py`.
- Visual Novel Maker: `vn_narrative_validation_test.py`; Code Check и API
  Browser — интерактивно проверены в живом SDK.
- Реестр расширений и splash экрана: `sdk_extensions_test.py`,
  `sdk_splash_test.py`.

## Ограничения

- SDK предназначен для 2D/2.5D. Re2D World редактирует ограниченную карту
  XY BSP с высотными интервалами; это не универсальный 3D-редактор. Авторинг
  пространственных спрайтов и импорт 3D-моделей (Baker/FBX/OBJ/VRM/glTF,
  v2→v3) в SDK отсутствуют.
- Graph editor кривых, click-to-select в предпросмотре RmlUi Studio (элементы
  с id), drag-ресайз фигур коллизии, drag зон акустики и редактор террейнов/
  анимации тайлов в Tilemap — реализованы (2026-10-20); числовые поля остаются
  точным fallback. Font weight/style доступны для RmlUi-текста через
  `$.font.load(..., { weight, style })`; кастомный `$.gfx.text` остаётся
  одноатласным и bold/italic не подделывает.
- Установленный пакет проверен вне рабочего дерева на macOS arm64 (2026-10-20:
  checksums, CLI/templates/new/validate/run/build/doctor). Linux/Windows в этом
  проходе только собраны кросс-сборкой; запуск на целевой ОС не выполнялся.
- macOS append codesign выдавал strict validation warning: локальный запуск
  работает, пригодная для распространения подпись игры не подтверждена.
- Удалённый CI и Release assets подтверждаются только фактическим GitHub run;
  результаты публикации записываются отдельно в handoff.
