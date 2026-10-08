# SDK Handoff

Last updated: 2026-10-08 (Europe/Moscow)

Спецификация: [Следующая цель SDK AGENT.md](Следующая%20цель%20SDK%20AGENT.md).
Фактическое состояние SDK — [docs/SDK.md](docs/SDK.md). Аудит — [SDK_AUDIT.md](SDK_AUDIT.md).

## Статус фаз

| Фаза | Статус | Коммит/заметка |
|---|---|---|
| 0 Audit | IMPLEMENTED | SDK_AUDIT.md |
| 1 SDK Shell | IMPLEMENTED | оболочка `sdk/`, реестр `sdk_tools.json`, бэкенд `r2d-sdk`, мост `$.sdk` |
| 2 Classic 2D slice | NOT STARTED | |
| 3 Re2DSprite Studio | NOT STARTED | |
| 4 Re2D Baker MVP | NOT STARTED | |
| 5 Character / VRM | NOT STARTED | |
| 6 Re2D World Studio | NOT STARTED | |
| 7 Automation / Batch | NOT STARTED | |

## Что проверено (Phase 1)

- `cmake --build build` зелёная; `python3 tools/run_tests.py`: 96 ok, 0 fail, 0 skip
  (до работы `highlevel_perf_test` один раз падал — перфоманс-порог Debug, потом проходил).
- `build/_deps/quickjs-build/qjs tests/js/*_test.mjs` — все; `build/sdk/native/r2d_sdk_core_test` (ASan/UBSan).
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

## Известные ограничения / не сделано

- ImGui-оверлей (`src/debug_ui.*`) НЕ удалён. Текст сцены уже рисуется без ImGui
  (`engine.drawText`, stb_truetype), поэтому удаление должно быть проще, чем предполагал аудит, —
  но это отдельная работа (main.c, CMake, tests, docs).
- Нативный агентский C-клиент (паритет всех команд протокола) — Phase 7.
- `highlevel_perf_test` чувствителен к нагрузке машины (не связан с SDK).

## Следующий шаг

Phase 2: Sprite Studio / Animation: форматы — существующий atlas JSON (`$.atlas`) и клипы
`$.anim.define`; валидаторы `sprite.atlas`, `animation` в `sdk/native` (регистрируются в
`sdk_validate.c`), экраны `sdk/tools/*.js` + RML, регистрация в `sdk_tools.json`.
