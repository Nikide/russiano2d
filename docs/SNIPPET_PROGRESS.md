# Прогресс системы сниппетов

Чек-лист по [SNIPPET_SYSTEM_PROJECT.md](SNIPPET_SYSTEM_PROJECT.md). Ветка
`snippets-system`. Статусы: ✅ закрыто · 🟡 в работе (частично) · ⬜ осталось.

## Сводка

| Раздел | Статус |
|---|---|
| §20.1 baseline (schema 2, `editor.graph`, API schema) | ✅ было до работы |
| §20.2 матрица 500 ID и API gaps | ✅ `58e89db` ([SNIPPET_MATRIX.md](SNIPPET_MATRIX.md); пробелы — предварительно по пространствам $, уточняются при реализации) |
| §20.3 контракты: manifest, поля, слоты, ID, `editor.snippets`, ownership, коды SNIP | ✅ `a3200d5` (миграция данных пакетов — 🟡 только `snippet update`) |
| §20.4 C/$ API | 🟡 `$.updateFor` (`eb84756`), `.damage(…, type)`/`.damageFilter`/`damaged` (`0ecf60a1`), `.flip()` чтение (`038690a1`), фикс `$.camera.isOnScreen` (`451d6721`); пробелы закрываются по мере реализации пакетов |
| §20.5 native r2d: scan/validate/catalog/diff/transaction/migration/recovery | 🟡 `a3200d5`, `5dd6ff3`, `841a104` (entity/new/own/rollback; миграции значений между версиями пакета — ⬜) |
| §20.6 Editor: каталог, Inspector, Save/Run | 🟡 `e4b9566`, `5dd6ff3`, `841a104` (нет: фильтр категорий, undo/redo панели) |
| §20.7 500 пакетов | 🟡 207 из 500 (`99b7b92`, `43b7f251`, `e05e96c5`); разделы A–J закрыты |
| §20.8–11 dogfood, полный прогон, доки со скриншотами, DoD | ⬜ |

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
- `2613cbf` — ID по разделу 12, 22 пакета, `tests/agent/snippets_catalog_test.py` (все пакеты в настоящем runtime).

## Осталось по §19 Definition of Done

### Каталог и пакеты
- [ ] ровно 500 уникальных встроенных ID (сейчас 207)
- [x] у каждого: manifest, схема Inspector, JS, зависимости, example, README, тест — для имеющихся 207
- [x] kits раскрываются в состав (kit.platformer-core, kit.platformer-combat, kit.top-down-shooter)
- [ ] русский поиск/фильтры на полном каталоге (поиск есть; фильтры по категории в UI — нет)
- [x] package authoring: `snippet new` + «Создать пакет» в панели (kit — через CLI `--kind kit --deps`)

### Пользовательский процесс
- [x] Player/NPC/weapon/pickup/trigger/kit командами Editor (объект — «Новый объект», поведение — каталог)
- [x] Inspector: числа, enum, bool, цвет, vec2, ресурсы (asset picker списком файлов), slots, зависимости
- [x] поведение не хардкодится в main.js (одна строка подключения)
- [x] generated JS видим, проходит lint, запускается runtime
- [x] передача в code-authored из UI и показ владельца каждого файла

### C/$ API и архитектура
- [x] API gap matrix на 500 пакетов (предварительная; уточняется по мере реализации)
- [ ] прочие подтверждённые API-изменения
- [x] удаление узла снимает подписки `$.updateFor` и привязки generated (смена сцены — покрыта через удаление узлов; отдельный тест ⬜)
- [x] пакеты не обращаются к `engine.*` (SNIP101)
- [x] без ECS/второго графа/event bus
- [ ] multiplayer-пакеты на `$.net`
- [ ] native performance pass с замером

### Надёжность и проекты
- [x] неизвестные поля project.json сохраняются; запись атомарная
- [x] catalog_lock; `snippet update` показывает изменения
- [x] rollback project.json (`snippet rollback`), recovery ручной версии generated (`*.r2d-user`)
- [x] детерминизм; конфликт ручной правки не перезаписывается молча
- [x] одни коды SNIP в CLI/Editor/агенте
- [ ] dogfood UX (focus, resize, undo/redo в панели)
- [ ] жанровые проекты целиком через Editor (Platformer, Witch, top-down, VN, JRPG, roguelike, co-op)
- [x] Build: generated и только использованные пакеты в поставке
- [ ] документация со скриншотами `docs/snippets/images/`

## Известные проблемы вне работы

- `tests/js/api_docs_test.mjs` падает: незакоммиченный `scripts/generate_api_docs_catalog.py` кладёт в каталог `engine.*`.
- В коммиты `eb84756`/`a3200d5` попали уже лежавшие незакоммиченными правки `api.schema.json`, `russiano2d.d.ts`, `sdk_validate.c` (runtime.multiplayer) и `sdk_project_graph.c`.
