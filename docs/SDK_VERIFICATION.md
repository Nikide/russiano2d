# SDK: проверка после передачи от Claude

Дата: 2026-10-08, macOS arm64, clang, CMake Release. Исходный HEAD: `1c754c3`.
Полный исходный аудит — [SDK_AUDIT.md](../SDK_AUDIT.md), итог фаз —
[SDK_HANDOFF.md](../SDK_HANDOFF.md), команды — [SDK.md](SDK.md).

## Автоматические проверки

- Сборка `cmake --build build --parallel 4` прошла.
- Полный `python3 tools/run_tests.py`: **106 ok, 0 fail, 0 skip**, 249.9 с.
  Это 106 наборов, а не 106 отдельных assertions.
- После последних изменений повторены восемь SDK-наборов: CLI, author, automation, baker,
  character, expression, world, world studio — **8 ok, 0 fail, 0 skip**.
  Последующие регрессии expression проверены отдельно (10 assertions).
- Все **91** файла `tests/js/*_test.mjs` прошли через bundled qjs.
- `build/sdk/native/r2d_sdk_core_test`: **100 ok, 0 FAIL**.
- Нативные json, crypto, payload, reverb, audio_fx, profile, bsp, rotsprite,
  re2d, re2d_world test executables прошли. Их targets используют имеющиеся
  sanitizer настройки CMake; это не заявление о полном instrumented engine build.
- Дополнительно весь C SDK собран отдельно с ASan/UBSan (включая библиотечные
  исходники) и прошёл batch/agent parity, dense/sparse expressions и world с 600
  сегментами без sanitizer ошибок. Логи `codex_sdk_sanitize_*.log`.
- CI batch manifest `tests/fixtures/sdk/ci.batch.json` локально прошёл: validation
  world/character + prop/character bake. Внешний GitHub CI здесь не запускался.

Логи находятся в игнорируемом `build/`: `codex_all_tests.log`,
`codex_changed_tests.log`, `codex_final_build.log`, `codex_native_tests.log`,
`codex_sdk_core.log`, `codex_js_tests.log`, `codex_expression_test.log`.

## Новые регрессии

- World: неправильные типы коллекций, дробные steps, неверный dir, потолок ниже
  пола сгенерированной ступени, id с кавычкой/backslash, сбой записи output,
  кромка из 600 стен; сохранён compiler/runtime parity и room-over-room.
- World Studio: открытие из реестра, геометрия двух видов, кнопка native compile,
  настоящая опора верхнего этажа, split/undo/redo/join, изменение span,
  сохранение/recompile/dispose.
- Author: добавление clips с сохранением предыдущих внешних клипов, timeline seek,
  эмоция, PNG variant, attached equipment, undo/redo, сохранение и native validate;
  preview проверяется на отсутствие runtime error diagnostics.
- Expressions: dense/sparse morph дают одинаковый PNG и отличаются от neutral,
  неверные sparse indices и nonfinite morph отклоняются, mapping полный,
  unknown expression отклоняется, KHR texCoord override учитывается до выбора UV.
- Automation: ошибочный job не прерывает следующие; stdout/report идентичны;
  сбой записи и повторный/алиасный output отражаются в статусе. Проверены все
  **19** команд `src/agent.c`; ответы совпадают с Python клиентом после удаления
  автоматически скрываемого им id. Profile/state проверены по структуре/ok:
  измеренные profiler времена двух процессов не объявляются побайтно равными.
  RmlUi кнопка возвращает тот же native batch report.

## Реальные внешние источники

Модели скачаны только для локальной проверки в `build/sdk_external`; они не входят
в репозиторий или SDK пакет. URL ниже — реальные источники проверки, SHA256 позволяет
проверить, что повторный запуск использует те же байты.

| Источник | SHA256 |
|---|---|
| [Seed-san.vrm](https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/Seed-san/vrm/Seed-san.vrm), 10,917,800 bytes | `624d0d554bc205bbdc33e22a68a2c3c20edebb3e573011ead8878a65e5329b23` |
| [BoxTextured.glb](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/BoxTextured/glTF-Binary/BoxTextured.glb), 5,956 bytes | `b510eca2e2ef33f62f9ed57d6e7ce2d10ebb2bdebc4a8e59d347719ba81abdf4` |
| [Duck.glb](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Duck/glTF-Binary/Duck.glb), 120,484 bytes | `65bf938f54d6073e619e76e007820bbf980cdc3dc0daec0d94830ffc4ae54ab5` |
| [Lantern.glb](https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Lantern/glTF-Binary/Lantern.glb), 9,564,264 bytes | `a79458c4b02d695187a952f23a63b8bf278e7bc3d316a3c2a314f2d6974181f1` |

Условия Seed-san — в [официальном README](https://github.com/vrm-c/vrm-specification/blob/master/samples/Seed-san/README.md).
Условия/атрибуция Khronos samples — в [каталоге моделей](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models).
Перед включением внешних моделей в собственную поставку читайте соответствующие
licenses; эта проверка их не распространяет.

```bash
build/r2d-sdk bake-re2d build/sdk_external/Seed-san.vrm --type character --origin feet --output build/sdk_seed
build/r2d-sdk bake-re2d build/sdk_external/Seed-san.vrm --type character --origin feet --expression happy --name Seed-happy --output build/sdk_seed_happy
build/r2d-sdk bake-re2d build/sdk_external/Duck.glb --output build/sdk_real_props/Duck
```

Seed-san: **45,058 triangles, 51 humanoid bones, 10 Re2D parts**. Неоднозначных
треугольников 1,098 (около 2.4%); пары явно показаны. Neutral и happy bake успешны.
Все три GLB prop bake успешны, без error/warning diagnostics. Проверка реального
VRM не означает универсальную совместимость со всеми экспортёрами VRoid.

## Визуальная проверка настоящего runtime

Проверены снимки, а не только размеры PNG:

- `build/codex-world-studio.png`: дерево, XY plan, высотный разрез, свойства и
  runtime view; после осмотра исправлена нулевая ширина панели свойств.
- `build/sdk_author/author.png`: авторские записи и прикреплённая копия животного;
  после осмотра исправлен преждевременный запуск нового клипа на старом узле.
- `build/sdk_automation/gui.png`: manifest и native JSON report в RmlUi.
- `build/codex_real_props.png`: BoxTextured, Duck, Lantern при yaw35/pitch15,
  модель загружена только из PNG/JSON. На Duck заметны просветы surface sampling;
  BoxTextured имеет швы, Lantern читается как столб с подвешенным фонарём.
- `build/codex_seed_rest_0.png`, `codex_seed_rest_90.png`, `codex_seed_walk.png`:
  нейтральный Seed-san и движение на разных ракурсах. Robo-arm относится к
  отдельному skinned mesh модели, а не дубликату, созданному SDK. На поверхностях
  остаются просветы/швы аппроксимации. Runtime validation сообщает 107 hole samples.
- `build/codex_seed_happy.png`: PNG happy подключён донором группы head обычным
  `re2dVariant`, исходный VRM не используется runtime.

Это visual QA импорта/редактирования MVP, а не обещание отсутствия швов у любого
skinned персонажа. Dominant rigid ownership не является полноценной skin деформацией;
PVS пока не используется runtime, slopes ступенчатые, walk процедурный, MToon освещение
не воспроизводится. Эти границы сохранены в документации фаз, а не спрятаны зелёной сборкой.

## Студии данных, тема и OBJ (2026-10-09)

Проверено на macOS arm64 (Metal), сборка `cmake --build build`:

| Что | Команда | Результат |
|---|---|---|
| Полный набор агентских тестов | `python3 tools/run_tests.py` | 109 тестов; единственные два падения (`sdk_character_test` — строка с «→», `sdk_classic2d_test` — гонка hot reload с черновиком) исправлены и перепроверены |
| Студии, оболочка, шаблоны, движки, запуск, пакет (настоящей мышью) | `python3 tests/agent/sdk_studios_test.py` | проходит |
| Мышь агента → RmlUi | `python3 tests/agent/ui_virtual_mouse_test.py` | проходит |
| Паритет проверок JS ↔ C | `python3 tests/agent/sdk_data_parity_test.py` | 2912 файлов, 0 расхождений (первый прогон нашёл 2 неточности JS, исправлены) |
| Импорт OBJ | `python3 tests/agent/sdk_obj_test.py` | проходит |
| Чистая логика | `qjs -m tests/js/sdk_kinds_test.mjs`, `sdk_rml_test.mjs`, все 95 `tests/js/*_test.mjs` | проходят |
| C | `build/sdk/native/r2d_sdk_core_test` и тесты `build/tests/r2d_*_test` | проходят |

Визуально проверено скриншотами агента (`build/sdkshots/`): оболочка (проекты, ассеты, каталог, шаблоны, запуск,
сборки, документация) и все новые студии; старые студии (Re2DSprite, World, Baker) после смены темы читаются и
не перекрывают окно просмотра. Не проверялось: другие ОС и GPU-бэкенды, окно меньше 1100×700, Retina
(RmlUi-интерфейсы на `px` при HIGH_PIXEL_DENSITY рисуются в физических пикселях — свойство движка, не SDK), удалённый GitHub CI
(шаг «SDK data studios, OBJ import and UI mouse» добавлен в `.github/workflows/build.yml`, но не запускался).

## Источник документации и сайт

`docs/` и корневые SDK документы — исходники; `site/doc/` — генерируемая копия.
При локальной пересборке обнаружены битые ссылки: builder исключал internal/NATIVE,
SDK_AUDIT/HANDOFF/spec и не декодировал `%20` в названиях. Исправлен существующий
`site/build-doc.py` и сайт пересобран без загрузки на сервер. `site/` полностью
игнорируется Git согласно существующей политике; локальная правка builder остаётся
там, исходные SDK документы и этот отчёт сохраняются в репозитории.
