# Приёмка системы сниппетов — §19

2026-10-21, ветка `snippets-system`. Изменения: `f207821a`, `441a1e7a`,
`206831bb`, `e357eea8`, `806b3d45`, `88c70d40`.

**28 пунктов подтверждены; 1 пункт имеет известное внешнее исключение.**
Формально весь §19 не объявляется полностью зелёным: общий JS regression содержит
оговорённое владельцем падение `api_docs_test.mjs`. Посторонние изменения не исправлялись.

| № | Пункт §19 | Статус | Доказательство |
|---|---|---|---|
| 1 | В Editor доступны ровно 500 уникальных встроенных package IDs. | ✅ | catalog strict + Editor catalog count; 500 unique IDs |
| 2 | Каждый имеет manifest, Inspector schema, JS source, dependencies, example, docs и passing package test. | ✅ | 500 package fixtures, 420 sources, 9210 field cases; kits are dependency-only |
| 3 | Все kits раскрываются до полного набора пакетов; нет заглушек и дублированных runtime-сущностей. | ✅ | all kits generated in catalog suite, dependencies/slots checked by native backend |
| 4 | Русский поиск и фильтры проверены на полном каталоге. | ✅ | editor_snippets_ux_test + category filter in editor_snippets_test |
| 5 | Behavior и kit создаются и проверяются через Editor package authoring. | ✅ | Editor behavior/kit authoring and backend validation (50 checks) |
| 6 | Player, NPC, weapon, pickup, trigger и kit создаются командами Editor. | ✅ | Editor genre projects + generic entity/add backend; NPC enemy and weapon kits exercised |
| 7 | Inspector настраивает параметры, ресурсы, анимацию, звук, slots и dependencies. | ✅ | Inspector fields/assets/slots/dependency composition; visibleIf and native invalid values |
| 8 | Ни один обязательный сценарий не требует вручную хардкодить поведение в main.js. | ✅ | 7 genre compositions generated through Editor; no authored gameplay in main.js |
| 9 | Generated JS видим, читаем, проходит lint и запускается настоящим runtime. | ✅ | catalog lint authored/generated, validate and actual runtime |
| 10 | Передача в ручное владение сохраняет результат и показывает владельца каждого файла. | ✅ | Editor own code/generator, unchanged bytes, file owner display |
| 11 | Заполнена API gap matrix для каждого из 500 пакетов. | ✅ | matrix.json: all 500 rows, version/scenario/source/API/runtime/compatibility/checks |
| 12 | Все подтверждённые общие возможности реализованы в C и/или публичном $ API. | ✅ | updateFor, typed damage, flip, camera fixes; no unresolved schema symbols |
| 13 | Schema, typings, generated docs, examples и API tests синхронны. | ✅ | doc_claims, doc_coverage, api_docs_sync, canonical api_docs_pipeline check PASS |
| 14 | Удаление узла/смена сцены не оставляют callbacks, timers и subscriptions. | ✅ | removal/respawn/scene reattach assertions plus full catalog cleanup |
| 15 | Игровые пакеты не обращаются к engine.* или внутреннему native API. | ✅ | native SNIP101/102/103/104 checks and source lint |
| 16 | Нет ECS, второго scene graph, нового event bus, loader, physics/audio abstraction или UI toolkit. | ✅ | ordinary $ nodes; last world-UI portrait/veil replaced with RmlUi/native transition |
| 17 | Multiplayer использует высокоуровневый $.net. | ✅ | net.ready-check real ENet host/client + replication, no low-level access |
| 18 | Native performance pass оправдан измерением и regression. | ✅ | Apple M4 benchmark 500/2000; no native behavior move justified |
| 19 | project.json открывается, сохраняется и мигрирует без потери неизвестных полей. | ✅ | snippets_test and sdk_snippet_migration_test, unknown fields/backup/restore |
| 20 | Package locks закреплены; update показывает diff и поддерживает rollback. | ✅ | pinned versions, native update dry-run/apply in Editor, rollback |
| 21 | Повторная генерация детерминирована; generated/user conflict никогда не переписывается молча. | ✅ | byte determinism and external conflict/recovery assertions |
| 22 | Диагностика со стабильными кодами совпадает в Editor, CLI и agent. | ✅ | Editor calls the same native snippet commands and renders SNIP locations |
| 23 | Focus, resize, scroll, undo/redo, save/reopen, conflict и recovery прошли dogfood. | ✅ | real RmlUi key/text/wheel, two sizes, 50 Editor assertions, screenshots |
| 24 | Старые проекты и API regression suites работают либо имеют проверенную миграцию. | ⚠ известное внешнее исключение | canonical sync and snippet migration PASS; full QuickJS suite has known external api_docs_test failure |
| 25 | Через Editor полностью создаются и запускаются Platformer, Witch, top-down action, VN с выборами/концовками, JRPG battle, roguelike run и authoritative co-op. | ✅ | 7 Editor projects: controls, VN choice/ending/save, JRPG turn/damage, seeded run; same co-op kit built through Editor; real host/client authority, spawn and hp replication |
| 26 | xmake, r2d lint, validate, tests и Build проходят на проектах-примерах. | ✅ | xmake catalog/regression targets; lint/validate/Build on all 7 genre projects |
| 27 | Один бинарник r2d включает игру, Editor, CLI и backend; второй SDK не требуется. | ✅ | single xmake r2d: Editor, game, CLI and native backend used in acceptance |
| 28 | Документация и реальные screenshots соответствуют реализации. | ✅ | SNIPPETS.md, matrix, progress, benchmark JSON and actual Editor/runtime screenshots |
| 29 | Нет невыполненных функций, открытых API gaps или отложенного «добавить в следующей версии». | ✅ | no deferred snippet/API gaps found in this acceptance; external exception recorded in row 24 |

## Повторение

```sh
xmake build -y -j 8 r2d
export R2D_BINARY="$PWD/build/macosx/arm64/release/r2d"
xmake test snippets_tests/catalog
xmake test snippets_regression_tests/contracts
xmake test js_tests/js # known api_docs_test.mjs failure
python3 scripts/api_docs_pipeline.py check
python3 scripts/snippet_matrix.py --check
```

Путь binary берётся из текущей xmake-конфигурации; обе snippet test targets сами
используют targetfile(), без обращения к старому build/r2d. Локальный OpenSSL 3
linker override и условия замера записаны в SNIPPET_PROGRESS.md и benchmarks/snippets.md.

## Границы доказательств

Каждый пакет прошёл schema/API/resource/lint/runtime checks; семантические assertions
проверяют разделы и жанровые композиции. Это не обещание отсутствия любых будущих
игровых ошибок. Скриншот или отсутствие runtime error сами по себе не подменяют
функциональную проверку: VN/JRPG и сетевой ready-check были исправлены именно после
новых assertions. Полный набор всех старых игр вручную не переигрывался.

Проверки выполнены в рабочем дереве с исходными посторонними изменениями. Их
влияние нельзя приписывать коммитам сниппетов; известное исключение оставлено явно.
