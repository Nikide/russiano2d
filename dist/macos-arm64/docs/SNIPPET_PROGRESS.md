# Прогресс системы сниппетов

Чек-лист по [SNIPPET_SYSTEM_PROJECT.md](SNIPPET_SYSTEM_PROJECT.md). Ветка
`snippets-system`. Статусы: ✅ закрыто · 🟡 в работе (частично) · ⬜ осталось.

## Сводка

| Раздел | Статус |
|---|---|
| §20.1 baseline (schema 2, `editor.graph`, API schema) | ✅ было до работы |
| §20.2 матрица 500 ID и API gaps | ✅ `58e89db` ([SNIPPET_MATRIX.md](SNIPPET_MATRIX.md); пробелы — предварительно по пространствам $, уточняются при реализации) |
| §20.3 контракты: manifest, поля, слоты, ID, `editor.snippets`, ownership, коды SNIP | ✅ `a3200d5` (миграция данных пакетов — ✅ `snippet update`, native tests и Editor dry-run/apply) |
| §20.4 C/$ API | ✅ `$.updateFor` (`eb84756`), `.damage(…, type)`/`.damageFilter`/`damaged` (`0ecf60a1`), `.flip()` чтение (`038690a1`), фикс `$.camera.isOnScreen` (`451d6721`); подтверждённые пробелы закрыты; 500 requires разрешены по schema |
| §20.5 native r2d: scan/validate/catalog/diff/transaction/migration/recovery | ✅ native scan/validate/catalog/generate/update/rollback/restore; миграции проверены |
| §20.6 Editor: каталог, Inspector, Save/Run | ✅ каталог/Inspector/authoring/preview/update/ownership/undo/redo; реальный RmlUi dogfood |
| §20.7 500 пакетов | ✅ 500 из 500; §12 нормализован (`e959d519`): 19 дублей → недостающие механики (`78788f54`); пробелов «вне каталога» нет |
| §20.8–11 dogfood, полный прогон, доки со скриншотами, DoD | ✅ snippet suites; ⚠ известный внешний api_docs_test, подробная приёмка — [SNIPPET_ACCEPTANCE.md](SNIPPET_ACCEPTANCE.md) |

## Сделано (коммиты)

- `eb84756` — `$.updateFor(node, fn)`: подписка узла, авто-снятие при удалении, disposer; schema/typings/reference/каталог Editor; тест `tests/agent/update_for_test.py`.
- `a3200d5` — `sdk/native/sdk_snippets.c`: `r2d snippet catalog|validate|check|add|set|remove|update|generate`; `editor.snippets` в project.json schema 2 и в `r2d validate`; генератор `generated/snippets/` (vendored пакеты, привязка к узлу по id, хеш тела → SNIP120, транзакционная запись, одна строка подключения в `runtime.entry`); атомарная запись project.json + `.bak`; `docs/SNIPPETS.md`; фикстура и `tests/agent/snippets_test.py`.
- `e4b9566` — панель «Кирпичики» в Editor (`editor/lib/snippets_panel.js`): каталог с поиском, выбор объекта графа, формы полей, отключение/удаление, генерация и конфликт; фикс индексатора графа («//» в путях); `tests/agent/editor_snippets_test.py`.
- `58e89db` — матрица 500 ID: `scripts/snippet_matrix.py` → `docs/SNIPPET_MATRIX.md`, `snippets/matrix.json`; проверка в тесте каталога.
- `5dd6ff3` — `snippet entity` (объект из Editor, origin graph, создание через `$`), `snippet new` (автор пакета проекта); кнопки в панели; индексатор не учитывает generated дважды.
- `c94beb2` — weapon.base/hitscan/projectile/melee, trigger.base, kit.top-down-shooter; `tests/agent/snippets_combat_test.py`.
- `841a104` — `snippet own code|generator`, `snippet rollback`; владелец каждого файла; Build-проверка.
- `99b7b92` — разделы A, B (34 пакета); исправлен `.fadeOut().remove()` в доках.
- `0ecf60a1` — `$ API`: `.damage(amount, source, type)`, `.damageFilter`, событие `damaged`.
- `038690a1` — `$ API`: `.flip()` без аргументов возвращает `{ x, y }`.
- `43b7f251` — разделы C, D, E (46 пакетов).
- `451d6721` — фикс `$.camera.isOnScreen` для обёртки.
- `f0f995d4` — SNIP103: вызовы `$.…` сверяются с `requires`; зарезервированные id полей.
- `e05e96c5` — разделы F–J (99 пакетов).
- `f1ba8e06` — разделы K–N (80 пакетов): задания, диалоги и сюжет, головоломки, мир.
- `6d19f8bd` — SNIP104: вызов несуществующего `$.…`.
- `8ff448c3` — разделы O–Q (56): камера, экран, анимация, звук, обратная связь.
- `d68c0897` — разделы R, S (40): HUD на RmlUi (`$.ui.markup`), сохранения, настройки, доступность, локализация.
- `d79c46c2` — якорь `#__snippets` для владельца project; SNIP083/SNIP084; раскрытие наборов.
- `94d0c06b` — разделы T, U (сеть на `$.net`) и V–Y (77 наборов): каталог 500/500.
- `e959d519` — нормализация §12 по решению владельца: 19 дублей заменены механиками.
- `78788f54` — 19 новых механик, наборы без пробелов, `tests/agent/snippets_mechanics_test.py`.
- `c8b3c5fc` — декларативные миграции значений пакетов (`snippet update`, SNIP146).
- `65304d95` — 7 жанровых проектов через Editor, скриншоты `docs/snippets/images/`.
- `26ca907f` — замер и оптимизации производительности (`docs/benchmarks/snippets.md`).
- `abb4bcbc` — фильтр категорий и многошаговая отмена/повтор в панели (`r2d snippet restore`).
- `2613cbf` — ID по разделу 12, 22 пакета, `tests/agent/snippets_catalog_test.py` (все пакеты в настоящем runtime).

## Осталось по §19 Definition of Done

### Каталог и пакеты
- [x] ровно 500 уникальных встроенных ID (500/500, §12 нормализован)
- [x] у каждого: manifest, схема Inspector, JS, зависимости, example, README, тест — для всех 500
- [x] kits раскрываются в состав (kit.platformer-core, kit.platformer-combat, kit.top-down-shooter)
- [x] русский поиск и фильтр категорий на полном каталоге
- [x] package authoring: `snippet new` + «Создать пакет» в панели (kit — через CLI `--kind kit --deps`)

### Пользовательский процесс
- [x] Player/NPC/weapon/pickup/trigger/kit командами Editor (объект — «Новый объект», поведение — каталог)
- [x] Inspector: числа, enum, bool, цвет, vec2, ресурсы (asset picker списком файлов), slots, зависимости
- [x] поведение не хардкодится в main.js (одна строка подключения)
- [x] generated JS видим, проходит lint, запускается runtime
- [x] передача в code-authored из UI и показ владельца каждого файла

### C/$ API и архитектура
- [x] API gap matrix на 500 пакетов (предварительная; уточняется по мере реализации)
- [x] прочие подтверждённые API-изменения; незакрытых requires/schema gaps нет
- [x] удаление узла снимает подписки `$.updateFor` и привязки generated (отдельный тест смены сцены и respawn — ✅ snippets_sections_test.py)
- [x] пакеты не обращаются к `engine.*` (SNIP101)
- [x] без ECS/второго графа/event bus
- [x] multiplayer-пакеты на `$.net`; Editor co-op project → два peers, authority/health replication, readiness/disconnect
- [x] performance pass с замером (`26ca907f`; в C не нужно)

### Надёжность и проекты
- [x] неизвестные поля project.json сохраняются; запись атомарная
- [x] catalog_lock; `snippet update` показывает изменения
- [x] rollback project.json (`snippet rollback`), recovery ручной версии generated (`*.r2d-user`)
- [x] детерминизм; конфликт ручной правки не перезаписывается молча
- [x] одни коды SNIP в CLI/Editor/агенте
- [x] dogfood UX: реальный focus/text/Tab/resize/scroll, undo/redo, conflict/recovery, reopen — ✅
- [x] жанровые проекты целиком через Editor (`65304d95`)
- [x] Build: generated и только использованные пакеты в поставке
- [x] документация со скриншотами `docs/snippets/images/`

## Известные проблемы вне работы

- `tests/js/api_docs_test.mjs` падает: незакоммиченный `scripts/generate_api_docs_catalog.py` кладёт в каталог `engine.*`.
- В коммиты `eb84756`/`a3200d5` попали уже лежавшие незакоммиченными правки `api.schema.json`, `russiano2d.d.ts`, `sdk_validate.c` (runtime.multiplayer) и `sdk_project_graph.c`.

## Итог и повторение

Полный список **29 пунктов §19** со статусом и доказательством —
[SNIPPET_ACCEPTANCE.md](SNIPPET_ACCEPTANCE.md): 28 подтверждены, один содержит
известное внешнее исключение (`api_docs_test.mjs`). Новых отложенных функций
сниппетов не оставлено. Чужие незакоммиченные изменения сохранены.

```sh
xmake build -y -j 8 r2d
export R2D_BINARY="$PWD/build/macosx/arm64/release/r2d"
xmake test snippets_tests/catalog
xmake test snippets_regression_tests/contracts
python3 scripts/snippet_matrix.py --check
python3 scripts/api_docs_pipeline.py check
```

Обе xmake test targets получают фактический путь текущего r2d сами. Путь Python
выше относится к локальной конфигурации этой приёмки. Main не переключался,
push не выполнялся. Ниже сохранена история шагов с результатами проверок.

## Приёмка 2026-10-21 — продолжение

- Кэш цели доведён с 67 до 81 пакета: 14 `nearPress` helpers получают `sel`
  экземпляра; после удаления цели селектор разрешается заново.
- `snippets_mechanics_test.py` прошёл после изменения (включая farming.crop).
- Полный каталог запущен через новую цель `xmake test snippets_tests/catalog`;
  результат будет записан следующим шагом.
- В рабочем дереве обнаружено много посторонних изменений; в коммиты этой
  приёмки включаются только перечисленные изменения сниппетов.
- Локальная проблема сборки: libcurl из кэша требует OpenSSL 3, автоматически
  выбран OpenSSL 4. Рабочая настройка: `xmake f --ldflags='/opt/homebrew/opt/openssl@3/lib/libssl.dylib /opt/homebrew/opt/openssl@3/lib/libcrypto.dylib'`.
  После неё текущий бинарник — `build/macosx/arm64/release/r2d`;
  для Python-проверок явно задавать `R2D_BINARY`.

### Шаг 2: каталог и функциональные контракты

- `xmake test -v snippets_tests/catalog`: **PASS**, 500 пакетов, 290.893 с.
  Цель использует фактический `targetfile()` текущей xmake-сборки.
- Новый `tests/sdk_snippet_boundaries_test.py`: **PASS**, 500 пакетов,
  1278 полей, 9210 случаев (границы, null, неверные типы, enum, vec2, списки,
  цвета). Каждый неверный случай проверяется отдельно native validator.
- Новый `tests/agent/snippets_sections_test.py`: **PASS**; наблюдаемое поведение
  A/B/D–U дополняет combat/mechanics/genres: движение, регенерация, NPC,
  respawn цели двери, inventory, деньги, XP/cooldown, задания, story,
  последовательности, тайники, fade, animation, combo, HUD, save/settings,
  host ready и replicated health; смена сцены снимает глобальные подписки,
  возвращение устанавливает одну подписку.
- Найден и исправлен `net.ready-check`: playerCount включает хоста; готовность
  требуется от `n-1` клиентов, минимум сравнивается с `n`. Disconnect удаляет
  готовность отключившегося peer.
- `snippets_test.py`: **PASS**. Общий повторяемый запуск новых и существующих
  suites: `xmake test snippets_regression_tests/contracts` (после UI шага).

### Шаг 3: Editor и dogfood

- `xmake test snippets_regression_tests/contracts`: **PASS**, 29.659 с;
  includes boundaries/migration/runtime sections/network/mechanics/combat/Editor/UX.
- `editor_snippets_test.py`: **49 checks PASS**: behavior и kit authoring,
  preview исходника до/после без записи, обновление pinned version через
  dry-run/apply, visibleIf, native отказ неверного vec2, ownership, внешний
  generated conflict/recovery, undo/redo/rollback и reopen.
- `editor_snippets_ux_test.py`: **PASS**, реальные RmlUi text/key/wheel events,
  русский поиск без потери фокуса, Tab → категории, scroll 500 записей,
  resize 960×640/1440×900. Снимки `acceptance-search.png` и
  `acceptance-catalog-scroll.png` сняты из текущего Editor.
- Исправления UX: поиск обновляет только результаты; форма автора свёрнута,
  kit создаётся с составом; Inspector показывает группы/visibleIf/слоты/состав;
  меняется только поле события, bool default не запускает ложную запись;
  неверный vec2 не превращается в 0; JSON-списки сохраняют внутренние запятые.
- Ввод агента раньше доставлял RmlUi только мышь. В существующий SDL event
  path добавлены virtual key/text: UI догфуд проверяет реальные события вместо
  подмены контролов. Нового UI/backend не добавлено.
- `r2d lint snippets`: **PASS**, 420 JS sources, без диагностик.
- Повторный `xmake test snippets_tests/catalog`: **PASS**, 500 пакетов,
  101.976 с, включая явный lint authored/generated JS, validate и runtime.
- QuickJS `tests/js/snippets_panel_test.mjs`: **PASS**, конверсия полей,
  JSON списки с запятыми, ошибочные vec2 и выбор ресурсов.
- Required docs: doc_claims/doc_coverage/api_docs_sync — **PASS**.
  Общий JS run: 129/130 PASS; единственное падение — известный
  `api_docs_test.mjs` из постороннего generated API каталога, файлы не менялись.

### Шаг 4: усиление приёмки жанров

- Genre fixtures дополнены настройкой полей **через Inspector Editor**, lint и
  Build для каждого из семи проектов, проверкой движения Platformer/Witch/top-down,
  выбора VN → хорошая концовка + save history, очереди JRPG и урона по противнику,
  seeded маршрута roguelike и сохранения run.
- Новые assertions обнаружили ошибки, которых не показывал smoke:
  шесть пакетов ожидали `e.data` от `$.dialog.on`, хотя API передаёт payload
  напрямую. Исправлены dialogue.action/choice/portrait, story.choice-history,
  ui.dialogue-box и accessibility.subtitle; глобальные $.on остаются с e.data.
- JRPG kit не инициализировал hp (stats.derived выставлял только maxHp), очередь
  пропускала героя как погибшего. В `kit.jrpg-turn-battle` добавлен health.base.
- Повторный VN/JRPG с этими assertions, lint, validate, Build и снимками:
  **PASS**. `snippet_matrix.py` обновил состав JRPG, 500/500 сохранено.
- Genre acceptance включён в `snippets_regression_tests/contracts`.

### Шаг 5: архитектура, resource validation, полная API-матрица

- Найдены последние два `ui: true` world-элемента в игровых пакетах:
  dialogue.portrait и story.scene-transition. Портрет теперь RmlUi image,
  переход сцены использует штатный `$.scene.load` transition; затемнение story
  использует RmlUi и owner-scoped update с disposer.
- `snippets_sections_test.py`: **PASS** с настоящим portrait image, именем
  говорящего в RmlUi dialogue box, субтитрами и сменой сцены через пакет.
- Этот fixture выявил ложный R2D100 для строк вида `speaker=face.png`.
  Общий native project validator теперь проверяет RHS такой ссылки; отдельный
  отрицательный случай подтверждает R2D100 для действительно отсутствующего
  `bell=missing-sound.ogg`. Существующие пути с '=' сначала проверяются целиком.
- Матрица всех 500 строк теперь содержит version/scenario/source/examples/
  package tests/runtime contract/change/compatibility/checks, а не только
  предварительные API namespaces. `requires` сверяются с текущей schema;
  незакрытых schema gaps нет. Требуемые проверки и их результаты различаются:
  конкретные результаты этой приёмки перечислены в этом progress.
- Повторный performance pass: 500 — 1.899 мс snippets против 1.718 мс manual;
  2000 — 5.903 против 5.707 мс, ошибок 0. Metadata и сырые результаты —
  `docs/benchmarks/snippets-acceptance.json`; C-перенос не требуется.

### Шаг 6: версии поставляемых исправлений

23 изменённых встроенных пакета подняты с 1.0.0 до **1.0.1** с отдельным
changelog в README. Это делает исправления явными для pinned проектов через
`snippet update`/Editor dry-run; схемы полей совместимы, миграция значений не
требуется. Матрица версий обновлена. Неизменённые пакеты не переверсионированы.

## Итоговая фиксация приёмки

- Полный повторный каталог через xmake после функциональных исправлений:
  **PASS, 500/500, 99.089 с**. После patch version bump отдельно повторены
  strict catalog и актуальность matrix — PASS.
- Общий snippet regression через xmake, включая семь жанров с lint/validate/
  Build: **PASS, 61.167 с**. После усиления кооперативного fixture отдельно
  подтверждён PASS проекта `kit.project-coop-adventure`, собранного через
  настоящий Editor: два peers, spawn, запрет клиентского урона, hp от хоста
  реплицируется клиенту, readiness/start и cleanup disconnect.
- Genre fixtures повторены с `--shots`: **PASS**, все семь проектов. Снимки
  текущего Editor/runtime обновлены; никаких макетов.
- Полный QuickJS regression: **130/131 PASS**; единственный failure — известный
  `tests/js/api_docs_test.mjs`. Canonical `api_docs_pipeline.py check` — PASS.
- Требуемые doc_claims/doc_coverage/api_docs_sync — PASS, 4111 имён покрыто.
- Полная приёмка по каждому пункту — [SNIPPET_ACCEPTANCE.md](SNIPPET_ACCEPTANCE.md).
  **28 ✅ / 1 ⚠**, исключение относится к общему внешнему regression; поэтому
  весь §19 безусловно зелёным не объявлен. Исходное ТЗ не переписано под результат.
- Работа выполнена в `snippets-system`; main не переключался; чужие исходники не редактировались и не
  включались в коммиты; push не выполнялся. Новых отложенных функций сниппетов не оставлено.

- Финальная визуальная проверка preview нашла незагруженный CSS font-family
  `monospace`: исходник занимал пустую строку. Заменён на штатный Roboto Mono;
  добавлен regression на высоту видимого исходника. Финальный Editor run:
  **50 checks PASS**, четыре дополнительных реальных screenshot (Inspector,
  preview с читаемым кодом, authoring, conflict). QuickJS parser test PASS.
