# SDK: проверенное состояние и ограничения

Сверка 2026-10-15, macOS arm64, ветка `main`, сборка `build-sdk`
(RelWithDebInfo, клон `build/`). Команды и возможности — [SDK.md](SDK.md),
очередь работ — [SDK_IMPLEMENTATION_GAPS.md](SDK_IMPLEMENTATION_GAPS.md),
журнал и история проверок — [SDK_HANDOFF.md](../SDK_HANDOFF.md).

## Автоматические проверки (фактический вывод этой сверки)

- `cmake --build build-sdk --target r2d-sdk r2d_sdk_core_test -j 6` — успех.
- `build-sdk/sdk/native/r2d_sdk_core_test` (ASan/UBSan) — **ok 99, FAIL 0**.
- `build-sdk/r2d-sdk batch tests/fixtures/sdk/ci.batch.json --output …` —
  exit 0, `total:4, succeeded:4, failed:0`.
- `R2D_BINARY=build-sdk/russiano2d python3 tools/run_tests.py sdk_cli_test
  sdk_classic2d_test sdk_package_test` — **3/3 ok** (120 / 46 / 10 проверок).
- qjs: `sdk_app_test.mjs`, `sdk_kinds_test.mjs`, `sdk_atlas_model_test.mjs`,
  `sdk_rml_test.mjs`, `sdk_test.mjs` — «Все проверки пройдены».
- `python3 tests/doc_claims_test.py` — пройден.
- Полный agent suite в этой сверке не перезапускался: параллельно правятся
  ядро и демо-игры, а прогон SDK-тестов шёл на отдельной сборке `build-sdk`.

Это число проверок конкретных сценариев, а не доказательство выполнения всего
большого гайдлайна. Логи — `build/test_*.log`, машинные отчёты SDK — в `build/`.

## Что покрыто

- Оболочка SDK и реестр (`sdk_tools.json`, 15 компонентов: оболочка, бэкенд,
  Classic 2D, DevTools, автоматизация): `sdk_shell_test.py`, `sdk_cli_test.py`.
- Classic 2D (Sprite/Animation Studio, атласы): `sdk_classic2d_test.py`.
- Студии данных (Tilemap, Particle, Collision, Parallax, Font, Audio, Input,
  RmlUi Studio) и паритет JS ↔ C проверок: `sdk_studios_test.py`,
  `sdk_data_parity_test.py`.
- Упаковка SDK, распаковка, CLI/GUI и сборка проекта без checkout:
  `sdk_package_test.py`.
- Batch (`validate`) и нативный клиент агентского протокола (19 команд):
  `sdk_automation_test.py`, манифест `tests/fixtures/sdk/ci.batch.json`.
- Recovery студий: `sdk_recovery_test.py`.

## Ограничения

- SDK авторит только 2D-данные. 3D-авторинг (Re2DSprite/Baker/FBX/OBJ/VRM/glTF,
  Re2D World, v2→v3) из SDK вырезан: нативных 3D-загрузчиков, команд
  `re2d-*`/`bake-*`/`world-*`/`animation-import` и их экранов в реестре нет.
- Graph editor кривых, выбор элемента кликом в предпросмотре RmlUi Studio,
  drag-ресайз фигур коллизии и drag зон акустики не реализованы (числовые поля
  есть); у Tilemap нет редактора террейнов и анимации тайлов (автотайл есть).
- Проверка установленного пакета вне рабочего дерева на всех трёх платформах не
  выполнялась; подтверждена только локальная упаковка/распаковка.
- macOS append codesign выдавал strict validation warning: локальный запуск
  работает, пригодная для распространения подпись игры не подтверждена.
- Удалённый CI и Release assets подтверждаются только фактическим GitHub run;
  результаты публикации записываются отдельно в handoff.
