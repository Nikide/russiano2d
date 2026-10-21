# Editor: исходный baseline для дорожной карты

Дата проверки: 2026-10-21. Целевая платформа: macOS arm64. Исходники уже были
изменены до начала этой проверки; это не чистая ветка и нельзя приписывать всю
разницу текущей сессии.

## Проверенные факты

| Область | Реализация/проверка | Состояние на baseline |
|---|---|---|
| Один бинарник | `r2d` запускает Editor и CLI; native tools собираются из `sdk/native/` | Xmake build проходит; проверка каталога Editor для глубоко вложенного Xmake-пути выявила ограничение и исправлена в текущей работе |
| Project Manager | `editor/app.js`, `r2d templates/new`; `editor_project_manager_test.py`, `editor_project_v2_test.py` | По решению пользователя каталог шаблонов содержит только `blank`; прочие жанровые демо остаются в `demos/` и открываются как существующие проекты |
| Документы и вкладки | `createCodeModel`, студии с отдельным экземпляром на вкладку; `editor_save_test.py`, `editor_external_change_test.py`, `editor_asset_conflict_test.py` | Save All, явные Save/Discard/Cancel и Reload/Overwrite/Cancel для кода и общих JSON-студий проверяются headless agent-сценариями; отказ записи оставляет документ dirty |
| Код и навигация | `code_model.js`, `code_view.js`, `api_language.js`, `openPalette`; `editor_palette_test.py`, `editor_json_syntax_test.py` | Quick Open/Command Palette, JS document outline и Shift+F12 literal project search проверяются горячими клавишами, fuzzy-фильтром, кликом по объявлению и переходом к результату; обычные JSON-вкладки валидируются native backend по несохранённому draft; outline ограничен функциями, классами и простыми bindings одного файла; IME candidate popup и семантическое межфайловое разрешение остаются ограничениями |
| Студии ресурсов | `editor/studios/`; отдельные agent-тесты для Atlas, Audio, Collision, Fonts, Input, Narrative, Parallax, Particles, RmlUi, SpriteMesh, Tilemap, Hammer и Re2DSprite | Реализованы разные workflow; Atlas проверяет draft до записи; Audio и Tilemap имеют типизированные авторинг-поля для эффектов/террейнов/анимаций; полная живая приёмка каждого ресурса не подтверждена |
| Problems / Output | `allProblems`, `validateProject`, Run/Build в `editor/app.js` | Ошибки validate/линта идут в Problems; timestamp/source history и фильтры проверены; Build Output показывает native список упакованных файлов и сводку размеров. Визуальный фокус, scrollbar и очень длинные журналы требуют GUI-проверки |
| Шаблоны | В `templates/` и bundled Editor оставлен только `blank` | CLI и Project Manager registry test требуют точное множество `{blank}` |
| Сквозные проекты | В `demos/` есть `platformer`, `shooter_witch`, `re2d_boomer_lab`, `re2d_dust2` и другие; Editor-созданные проекты хранятся отдельно | Backend Create/Validate/Run/Build/packaged Run подтверждён для Platformer, Witch и старого шаблона VN; новый платформер и `rusya-love-vn` созданы из blank через Editor и проверены runtime-агентом; Dust2 остаётся открываемым demo/Hammer проектом |
| Extensions | Native discovery в `r2d`, общий lifecycle в `editor/lib/shared/extensions.js`, интеграция Hammer | Agent test подтверждает project discovery, failure rollback, undoable runtime callbacks, point/line/rect overlays и runtime validators на замороженном снимке карты |
| Output | timestamped Run/Build/Editor history, source filters и bounded retained history в `editor/app.js` | `editor_output_test.py` проверяет источники, ISO-время, фильтры и сохранение Run/успешного Build после ошибки следующей сборки; визуальная прокрутка и фокус требуют GUI-прохода |
| Agent sessions | активный `.agent.json` запускается командой палитры через native `r2d agent`; отчёт и ответы видны в Output, backend diagnostics — в Problems | `editor_agent_session_test.py` проверяет ready/responses, успех и runtime-отказ; ручная проверка просмотра артефактов остаётся открытой |

## Сопоставление с этапами дорожной карты

Статус относится к подтверждённым критериям, а не к наличию соответствующего
файла. Agent-сценарии взаимодействуют с настоящим Editor/RmlUi и runtime, но
не проверяют физический ввод ОС, системные окна и полный ручной осмотр.

| Этап | Подтверждено | Открытый критерий |
|---|---|---|
| 0. Baseline | macOS arm64 Xmake build; lint и validate чистые; матрица областей и field notes актуализированы | OS-level интерактивная проверка Editor |
| 1. Документы | Save/Save All, dirty close, запись с ошибкой, конфликт, Reload/Overwrite/Cancel; все 26 Editor agent-тестов проходят последовательно | физический ввод и переходы вкладок в нативном окне |
| 2. Project Manager | открытие/создание, recent, project v2, Validate, Run, Build и ошибки структуры; Re2D template удалён по запросу пользователя | системный выбор каталога и ручной полный путь |
| 3. Код | JSON draft diagnostics; JS editing/outline/search/API help; Narrative/RmlUi validate; IME-модель покрыта unit-тестами | реальная раскладка/IME candidate window и OS focus; межфайловый semantic resolver ограничен явно |
| 4. Поиск и команды | 14 palette checks, поиск по проекту и переход к строке | физические горячие клавиши и фокус нативного окна |
| 5. Platformer | Project Manager test создаёт шаблон, вносит/исправляет ошибку, запускает и собирает запускаемый пакет | повтор того же пути физическими действиями пользователя |
| 6. Студии данных | agent suites для профильных студий, общая история, draft validation, Undo/Redo, preview и конфликтные записи | системная GUI-приёмка каждой используемой студии |
| 7. Witch | Project Manager test проверяет меню, боевую сцену, пакет и запуск пакета | физический GUI-проход |
| 8. VN | Narrative test (50) проверяет dirty preview, остановку/возврат, ссылки, Save и конфликты; Project Manager проверяет запуск/пакет | физический GUI-проход |
| 9. Re2D boomer | снят с плана по прямому запросу пользователя; Dust2 остаётся demo и открывается в Hammer | не предлагать жанровый шаблон без нового запроса |
| 10. Диагностика | Problems/Output, timestamps/filters, native agent-session и структурированные ошибки покрыты тестами | ручной просмотр Output, фокуса и перехода из каждой диагностики |
| 11. Ассеты | native asset picker workflow, превью поддерживаемых ресурсов и package validation покрыты тестами | системные file/folder dialogs требуют OS-level проверки |
| 12. Run/Preview | Run/Stop повторяется без потери вкладки; Narrative и Hammer используют runtime preview и освобождают ресурсы | физический fullscreen/focus round-trip |
| 13. Поставка | пакеты Platformer, Witch, VN и прежний Re2D candidate запускались на macOS arm64; штатные package-only candidates macOS arm64, macOS x86_64, Windows x86_64 и Linux x86_64 прошли `ci_package_check.py` с единственным `r2d`/`r2d.exe` и встроенным `editor/` | после отзыва Re2D template больше не является продуктовым путём; игровые Run/Build на macOS x86_64/Windows не проверялись |
| 14. Единый backend | `r2d` обслуживает Editor/CLI/agent; Xmake имеет одну цель; release check запрещает старые бинарные имена; `sdk_cli_test.py`, `world_edit_cli_test.py` и JS/C parity теперь запускаются с `R2D_BINARY`; `sdk_extensions_test.py` покрывает compatibility host | Старые `sdk/` UI-модели и `$.sdk` bridge остаются source-level compatibility для legacy-проектов и тестов; они не входят в текущий release-пакет и не заменяют `editor/` |
| 15. Extensions | 28 проверок discovery, namespace, rollback, validators и Hammer contributions | ручная проверка extension workflow в нативном окне |
| 16. Полировка/платформы | Xmake macOS arm64/x86_64, Windows x86_64 cross-build и Ubuntu 24.04 Linux x86_64 builds; CLI, validator, JS/C parity и package gates проходят на macOS архитектурах; Windows и Linux package gates проходят; одна проверка layout/resizing и arm64 окно | OS GUI/focus, физические клавиши/IME и scrollbar; Windows runtime; полноценные game workflows на x86_64 |

## Команды, выполненные в этой проверке

- `xmake build -y -j 8 r2d` — успешно.
- Linux CI-equivalent: `xmake f -y -p linux -a x86_64 -m release -o build-xmake/linux-x86_64` и `xmake build -y -j 4 r2d` — успешно; `xmake test -y -j 8` — 66/66 прошли (включая ASan/UBSan и 127 JS suites). Linux-only edge case на точном касании пола устранён; тесты Hammer brush/automap теперь освобождают выходные данные.
- Linux `r2d version`, `commands --json`, `lint game --json` и `validate game --json` прошли; `release.py --package-only` candidate прошёл `ci_package_check.py` (836 записей, единственный `r2d`) во временном каталоге `/tmp`, без записи в `dist/`.
- `r2d templates` — после решения оставить только пустой шаблон найден ровно `blank`.
- `r2d lint editor/app.js` — успешно.
- `r2d validate editor` — успешно, 0 ошибок и предупреждений.
- `tests/doc_claims_test.py`, `tests/doc_coverage_test.py`, `tests/api_docs_sync_test.py` — успешно после добавления страниц и теста для модулей справки API.
- `tests/agent/editor_save_test.py` — 17 проверок: Save/Save All для кода и студий, имена конфликтующих документов в статусе/Output, открытие вкладки с выбором версии, Run после сохранения, три явных действия при dirty close, Save по Enter, отмена по Escape и отказ записи без потери вкладки/исходника.
- `tests/agent/editor_external_change_test.py` — 8 проверок: Save обнаруживает внешнюю версию, Cancel сохраняет обе версии, Reload заменяет буфер, явный Overwrite записывает свою версию, удаление файла требует отдельного решения.
- `tests/agent/editor_asset_conflict_test.py` — 12 проверок: общий JSON-документ показывает Reload/Overwrite/Cancel, повторно сверяет диск перед действием, сохраняет dirty при отказе и воссоздаёт удалённый ассет только по явному Overwrite; реальный RmlUi-кадр диалога осмотрен.
- `tests/agent/editor_atlas_conflict_test.py` — 11 проверок: Atlas отклоняет невалидный draft до записи, предлагает Reload/Overwrite/Cancel, сохраняет изменения при Cancel, перепроверяет диск перед повторной записью и создаёт нарезку как одну undoable правку.
- `tests/agent/editor_audio_test.py` — 24 проверки: Audio effect params типизированы, проверяются диапазоны и Undo/Redo, неизвестные ключи сохраняются; проверяются runtime mixer/playback, parent-bus rename/remove и акустические зоны.
- `tests/agent/editor_tilemap_test.py` — 24 проверки: structured terrain/autotile/animation authoring на той же модели, что использует runtime preview; также кисти, stroke undo, слои, Save draft и отсутствие записи до Save.
- `tests/agent/editor_tilemap_test.py` — 24 проверки: brushes, strokes, rectangle, layers, runtime preview; structured terrain/autotile/animation authoring, validation, Undo/Redo и отсутствие записи до Save.
- `tests/agent/editor_rmlui_test.py` — 27 проверок: validate общего набора RML/RCSS на черновиках до записи, история, превью, конфликт связанного стиля и Reload/Overwrite/Cancel, rollback комплекта при отказе RCSS-записи и повторный Save.
- `tests/agent/editor_project_manager_test.py` — 26 проверок: единственная карточка Blank, Create/Validate/Run/Build, запуск пакета, open-project ошибки и project search.
- `tests/agent/editor_template_registry_test.py` проверяет, что CLI и Project Manager показывают только `blank`.
- `tests/agent/re2d_dust2_hammer_test.py` — Hammer открывает копию существующего Dust2 demo без жанрового шаблона; проверяет четыре вида, Validate, native cell edit/undo, compile/preview и освобождение preview.
- `tests/agent/re2d_dust2_annex_test.py` — 48 проверок успешно; annex traversal, positional audio, оружие, зомби, урон, смерть и restart; screenshot files выключены по умолчанию.
- `tests/agent/editor_extensions_test.py` — 28 проверок успешно; discovery, failure rollback, все поддержанные Hammer contribution points, readonly runtime validators, согласованная ошибка Validate/Problems и undoable callbacks.
- `tests/agent/sdk_extensions_test.py` — native CLI и legacy shell compatibility host проходят на едином `r2d`.
- `xmake test -y -j 8` — 66/66 targets прошли; JS runner внутри прогона — 127/127 наборов.
- На свежей macOS arm64 сборке после удаления Re2D template прошли `editor_project_manager_test.py` (44), `editor_template_registry_test.py`, `editor_save_test.py` (17), `editor_file_dialogs_test.py` (9) и `re2d_dust2_hammer_test.py` (9). Ранее также прошли `editor_hammer_test.py` (43) и 13 тестов для остальных resource studios, Hammer cell-world и project v2.
- `tests/agent/editor_palette_test.py` — 14 проверок: Quick Open/Command Palette, Ctrl+Shift+O outline, переход кликом к координате объявления и Shift+F12 literal project search.
- `tests/agent/editor_output_test.py` — Output gate включает содержимое build-сводки: список scripts/assets и итоговые размеры пакета.
- `tests/agent/editor_run_stop_test.py` — 9 проверок: изменение кода до/после Run, автоматическое сохранение перед запуском, успешный статус намеренного Stop, повторный цикл Run/Stop сохраняет последующую правку и оставляет активный документ доступным.
- `tests/agent/editor_output_test.py` — 9 проверок: timestamp/source для Validate, Build и Run, состав и размеры пакета в Build Output, фильтры Output и сохранение записей после неудачной повторной сборки.
- `tests/agent/editor_agent_session_test.py` — 6 проверок: запуск native agent session из Command Palette, сохранение ready/response-структуры и различение успешного сценария от запроса, отклонённого runtime.
- `tests/agent/editor_json_syntax_test.py` — 7 проверок: native syntax diagnostic для обычной JSON-вкладки, проверка несохранённого draft, защита существующего файла с кандидатным именем, очистка ошибки после правки и запись исходника только по Save.
- Последовательный запуск всех 26 `tests/agent/editor_*_test.py` завершился успешно; Hammer и Narrative выполняют явный Discard при закрытии dirty-вкладки. JSON syntax и Extensions tests сохраняют и восстанавливают `state.local.json`, чтобы не добавлять временные проекты в Recent.
- `tests/js/api_docs_test.mjs` через Xmake-пакет QuickJS — 3 проверки успешно.
- Stage 14 audit: `xmake.lua` собирает только `r2d`; Editor запускается из `editor/`; `tools/ci_package_check.py` запрещает `r2d-sdk`, `russiano2d-sdk` и их Windows-варианты в поставке. Общие `sdk/native/` команды входят в `r2d`, а shared data models используются Editor; legacy `sdk/` shell и `$.sdk` compatibility host сохраняются для старых project/test consumers и не упаковываются как отдельное приложение.
- `release.py --package-only` создал временные macOS arm64 и x86_64 package candidates из отдельных Xmake builds; `ci_package_check.py` подтвердил один `r2d`, `editor/`, templates, schema и отсутствие прежнего SDK.app. Существующие архивы `dist/` не менялись.
- macOS x86_64: Xmake build прошёл; `r2d version`, CLI, world-edit, `sdk_data_parity_test.py` (2912 файлов), `sdk_validation_test.py`, `sdk_preview_parity_test.py` и package gate прошли под Rosetta. OS-level GUI и полноформатный Run/Build на этой архитектуре не проверялись.
- Windows x86_64: Xmake MinGW build прошёл; штатный `release.py --package-only` candidate прошёл `ci_package_check.py` как пакет с одним `r2d.exe`. Windows runtime/Editor не запускались на macOS. Ubuntu 24.04 x86_64 native Xmake build прошёл в Linux container как в базовом output, так и с CI-путём `build-xmake/linux-x86_64/linux/x86_64/release/r2d`; `version`, `commands --json`, `lint game --json`, `validate game --json` и `xmake test` (66/66) завершились успешно. Linux `release.py --package-only` candidate во временном каталоге прошёл `ci_package_check.py`: один `r2d`, встроенные `editor/`/templates/schema, 836 архивных записей и без лишнего backend. Для воспроизводимости исправлены Linux FreeType multiarch lookup в RmlUi recipe, SDL3 dependency discovery в image/mixer/net recipes, stale cross-host host-tool reuse и список Linux CI shader-tool dependencies. OS-level GUI-ввод и IME пока не подтверждены.
- Исправлен legacy-test drift: `sdk_cli_test.py`, CLI world-edit, JS/C data parity, studio/automation/Re2D CLI scenarios теперь принимают `R2D_BINARY`; прямой CLI contract проверяет `version.name == "r2d"`. `sdk_cli_test.py`, `world_edit_cli_test.py` и `sdk_data_parity_test.py` прошли на единой Xmake-сборке; паритет проверил 2912 файлов без расхождений.

Локальный macOS arm64 `.app` открыл Project Manager и был пересобран из текущей
Xmake-сборки. В видимом 1440×900 окне агентские SDL-события прошли выбор
Platformer, создание проекта, Run и Stop; проверены Output, возврат к тому же
`main.js` и успешный статус намеренной остановки. Resize и scrollbar были
проверены ранее (EFN-035). Unicode-клавиатурное событие в code editor дошло
до документа и включило dirty-state; имя проекта в проходе задавалось через UI
document API. IME и системный folder dialog остаются непроверенными.
macOS Accessibility видит только внешнее окно. Подробности записаны в
[`EDITOR_FIELD_NOTES.md`](EDITOR_FIELD_NOTES.md).

Полный журнал наблюдений: [`EDITOR_FIELD_NOTES.md`](EDITOR_FIELD_NOTES.md).
