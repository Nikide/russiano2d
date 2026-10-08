# SDK Handoff

Last updated: 2026-10-09 (Europe/Moscow)

Спецификация: [Следующая цель SDK AGENT.md](Следующая%20цель%20SDK%20AGENT.md).
Фактическое состояние SDK — [docs/SDK.md](docs/SDK.md). Аудит — [SDK_AUDIT.md](SDK_AUDIT.md).

## Статус фаз

| Фаза | Статус | Коммит/заметка |
|---|---|---|
| 0 Audit | IMPLEMENTED | SDK_AUDIT.md |
| 1 SDK Shell | IMPLEMENTED | оболочка `sdk/`, реестр `sdk_tools.json`, бэкенд `r2d-sdk`, мост `$.sdk` |
| 2 Classic 2D slice | IMPLEMENTED | Sprite Studio + Animation Studio на атласе `*.atlas.json` |
| 3 Re2DSprite Studio | IMPLEMENTED (срез) | просмотр рантаймом, виды карт, скелет, проверка; редакторы клипов/мимики/вариантов/экипировки — NOT STARTED |
| 4 Re2D Baker MVP | IMPLEMENTED (Prop) | `sdk_gltf.c`, `sdk_bake.c`, GUI `re2d-baker`; Character/VRM/Weapon/Env NOT STARTED |
| 5 Character / VRM | PARTIAL (проверено на синтетическом VRM) | `sdk_char.c`, скины в `sdk_gltf.c`, `--type character`; нет: реальный VRoid-файл, лицо/выражения в PNG, материалы MToon, ручная правка владения |
| 6 Re2D World Studio | NOT STARTED | |
| 7 Automation / Batch | NOT STARTED | |

## Что проверено (Phase 1–2)

- `cmake --build build` зелёная; `python3 tools/run_tests.py`: 100 ok, 0 fail, 0 skip
  (до работы `highlevel_perf_test` один раз падал — перфоманс-порог Debug, потом проходил).
- `build/_deps/quickjs-build/qjs tests/js/*_test.mjs` — все; `build/sdk/native/r2d_sdk_core_test` (ASan/UBSan).
- Phase 2: `tests/agent/sdk_classic2d_test.py` (SDK-процесс правит файлы, отдельный headless-процесс
  игры перезапускается сам по `*.atlas.json`), `tests/js/sdk_atlas_model_test.mjs`, атлас-тесты в
  `sdk_core_test.c` и `sdk_cli_test.py`. Паритет формата: байты JS-сериализатора == `atlas-format` (C).
- Новые: `tests/sdk/sdk_core_test.c`, `tests/js/sdk_test.mjs`, `tests/js/sdk_app_test.mjs`,
  `tests/agent/sdk_cli_test.py`, `tests/agent/sdk_shell_test.py`.

## Архитектурные решения

- SDK = обычный проект R2D `sdk/` (RmlUi, `$`). Нативный бэкенд `sdk/native` → `build/r2d-sdk`
  (C11 + SDL3 + `src/json.c`, без внешних runtime). Python — только тестовая обвязка репозитория.
- Мост `$.sdk` (`src/sdk_host.c`, `src/highlevel/sdk.js`) включается `"toolHost": true`; запускает
  только `r2d-sdk` и сам движок, массив аргументов, фоновый поток читает вывод. Открыто описан
  (docs/highlevel/sdk.md) — это не скрытый второй API.
- Расширена RmlUi-интеграция (законно по §4 спецификации): `getValue/setValue/getText/getAttr/
  setAttr/rect/click`, колбэк `ui.on` получает `targetKey, targetId` (делегирование списков).
- Агент и человек: каждая кнопка = операция `$.sdkApp.*`; снимок в `state.sdk`.

## Phase 2: решения

- Формат — Aseprite-совместимый `*.atlas.json`, который уже читает `$.atlas`; новый формат не вводился.
  Анимация = тег `meta.frameTags`; пивот кадра = слайс с именем кадра; `meta.custom` и `loop` рантайм игнорирует.
- Движок: hot reload (`src/script.c`, `r2d__scan_cb`) следит и за `*.atlas.json`. В агентском режиме
  hot reload по-прежнему выключен (`main.c`: `!opt_agent`), поэтому тест гоняет игру обычным headless-процессом.
- `$.gfx.draw.sprite` НЕЛЬЗЯ вызывать из `$.render`/`$.update` для постоянной картинки: батч `pushSprite`
  сбрасывается в начале кадра (в статистике это не видно, если рисовать и `rect`). Студии рисуют
  картинку узлом `<sprite>` при камере в центре окна; `$.gfx.draw.line/rect` (очередь `draw_calls`) работают.
- Корневые документы RmlUi студий без фона у `body`: область просмотра прозрачна, сквозь неё видна сцена.
- Нет в Phase 2: tilemap/particles/collision/RmlUi Studio, события клипов (рантайм-спрайты их не умеют).

## Phase 3: решения

- Изображение модели рисует НАСТОЯЩИЙ рантайм (`$.re2dSprite.from`); SDK декодирует карты PNG v2 в C
  (`sdk_re2dpng.c`) только для проверки и отладочных видов (PNG вида 768×576 в `build/sdk_cache/`).
- Валидатор описания в C зеркалит `validateRotDefinition/Animations`; паритет — `tests/agent/sdk_re2d_parity_test.py`
  (82 правки). При изменении правил рантайма обновлять оба и расширять корпус.
- Правка движка: `relativeAsset` в `src/highlevel/rotsprite.js` сохраняет ведущий «/» (модели по абсолютному пути).
- Сохранение пишет файл тем же отступом (`detectIndent`); у файлов демо роундтрип побайтно равен исходнику.
- Нет: редактор клипов (timeline), мимики, вариантов, экипировки; вид «Occlusion» из спеки реализован как «Перекрытие»
  (счётчик отсчётов на ячейку фронтальной проекции) — это не настоящая окклюзия рантайма.

## Phase 4: решения

- Baker = `sdk/native/sdk_gltf.c` (разбор) + `sdk_bake.c` (оси, вписывание, раскладка, растеризация, запись) —
  одна функция `bk_bake` для CLI и GUI; отчёт всегда собирается (`res->report_json`), на диск пишется при успехе.
- Auto Unwrap = 6 плоских карт по доминирующей оси нормали + плотная упаковка (двоичный поиск шага отсчёта).
  Просветы на косых гранях и швы между картами — известное ограничение (`SDK_BAKE_LOW_DENSITY` предупреждает).
- Y-ось: glTF вверх → Re2D вниз; «feet» = низ (max Y) в 0, допустимая высота 64 ед.
- Тестовые GLB генерируются Python-скриптом (одноразовый dev-инструмент, результат закоммичен в `tests/fixtures/sdk/props/`).
- Не сделано: Character/Weapon/Environment, VRM, skin→part ownership, Re2D Optimized, source-vs-Re2D, batch.

## Phase 5: решения

- Character = `sdk/native/sdk_char.c` (humanoid → 10 костей Re2D, владение, rig/клипы/отчёт) поверх `bk_bake`;
  загрузчик glTF теперь читает узлы (мировые матрицы), `skins` (inverseBind), JOINTS_0/WEIGHTS_0 и VRM 0.x/1.0.
- Геометрия скинится позой файла: вершина = Σ w·(world(joint)·IBM)·v. Для Prop скин даёт ту же позу, но кости не переносятся.
- Владение: треугольник → кость Re2D с наибольшей суммой весов; «неоднозначным» считается треугольник, у которого лучшая кость
  набрала < 70% веса. Счётчик и пары костей — в отчёте и в `SDK_BAKE_SKIN_AMBIGUOUS` (warning при > 5%). Сустав без humanoid-предка → root
  (`SDK_BAKE_JOINT_UNMAPPED`); негуманоидный GLB как character — отказ `SDK_BAKE_CHARACTER_NO_HUMANOID`, а не угадывание.
- Left/Right в именах костей Re2D = сторона X (X<0 — Left, как у Russi), а не VRM-имя: у VRM 1.0 «left» стоит на +X. VRM 0.x
  разворачивается на 180° вокруг Y; результат побайтно равен VRM 1.0 (тест).
- Выражения VRM (blendshape) не запекаются: отчёт даёт сопоставление happy/angry/sad/surprised/relaxed→neutral/blink→sleepy, остальное — `null`.
- Клипы `spin` и `walk` процедурные (маятник рук/ног) — не авторская анимация. Анимации модели не переносятся.
- Фикстуры VRM синтетические: `tests/fixtures/sdk/make_vrm_fixtures.py` (тестовая обвязка). Реальный файл VRoid/VRM Studio НЕ проверялся.

## Известные ограничения / не сделано

- ImGui-оверлей (`src/debug_ui.*`) НЕ удалён. Текст сцены уже рисуется без ImGui
  (`engine.drawText`, stb_truetype), поэтому удаление должно быть проще, чем предполагал аудит, —
  но это отдельная работа (main.c, CMake, tests, docs).
- Нативный агентский C-клиент (паритет всех команд протокола) — Phase 7.
- `highlevel_perf_test` чувствителен к нагрузке машины (не связан с SDK).

## Следующий шаг

Phase 6: Re2D World Studio (карта 2D: стены, cells, height spans, порталы, лестницы/уклоны, compile, validate, preview; тест room-over-room;
рантайм `re2d_world.c` порталов/PVS/slopes не имеет — это данные и диагностика компилятора, PARTIAL). Далее Phase 7.

(Выполнено в Phase 5, оставлено для истории) Character / VRM. Разбор VRM (glTF + расширения VRM 0.x `extensions.VRM` и VRMC_vrm 1.0): humanoid-кости →
rig Re2D (Auto Re2D Character: head/torso/arms/legs/hair/clothes), skin weights → владение частями по доминирующей кости
(`owner = argmax weight`) с отчётом о неоднозначности (§36), expressions → emotions, материалы. Скелет: нужен разбор
`skins` (joints/inverseBindMatrices) и JOINTS_0/WEIGHTS_0 в `sdk_gltf.c`. Реальный VRM в репозитории не лежит —
сгенерировать синтетический VRM (как props) и описать честно, что настоящий VRoid-файл не проверялся.
