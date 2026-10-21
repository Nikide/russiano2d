# Форматы данных: состав полей и честные границы

Это не новая схема проекта и не единый «формат всего». Каждый документ игры
маленький и связывается с другими обычными resource references; prefab остаётся
источником описания узлов. Раздел соответствует §33
[спецификации производственной готовности](PRODUCTION_READINESS.md): там
перечислен **минимальный состав данных**, здесь — где это поле живёт в коде и
что из него проверено.

Проверяется машиной: [tests/format_extensions_test.py](../tests/format_extensions_test.py)
сверяет таблицу с кодом и сообщает, если обещание разошлось с реализацией.

| Данные | Поле | Где живёт | Что проверено |
|---|---|---|---|
| **Atlas** | `duration` (длительность кадра) | `src/highlevel/atlas.js` | чтение и применение в проигрывании |
| | `trimmed` + trim-геометрия | `atlas.js` | снимок кадра отдаёт обрезанный регион |
| | `pivot` | `atlas.js` | `pivotLx/pivotLy` — смещение относительно кадра |
| | `page` (несколько страниц) | — | **не реализовано**: атлас одного листа с несколькими ИСТОЧНИКАМИ есть (`sources` в тайлмапе, §42), страниц нет |
| **Animation** | маркеры, окна, named targets, `clock` | `src/highlevel/animplayer.js` | `tests/agent/highlevel_animtracks_test.py` |
| **Collision** | роль формы, owner, слои/маски, one-way | `core.js` (области) + `tilemap.js` (дескриптор тайла) | `highlevel_transforms_test.py`, `highlevel_tile_geometry_test.py` |
| **Room/prefab** | стабильные ID (`nid`), children, данные детей | `src/highlevel/prefab.js` | round-trip `prefab.save/apply`, `highlevel_prefab_test.py` |
| **Save** | schema/content версии, состояние по `nid`, RNG | `src/highlevel/save.js` | `save_restore_test.py` (68 проверок) |
| **Replay** | build/content hashes, `dt`, checkpoints | `src/highlevel/replay.js` | `highlevel_replay_test.py`, `replay_cli_test.py` |
| **Light masks** | слои источников + маска получателя | `src/render.c` + `src/highlevel/render.js` | §20.1: `.lightLayer(bits)` у источника, `.lightMask(bits)` у узла, `$.gfx.light.maskPath()`; `light_receiver_mask_test.py` (22) |
| **Material** | normal/emissive/lit | `src/highlevel/render.js` | данные полные; попиксельный свет по normal-карте — ОБЪЯВЛЕННЫЙ fallback (`$.gfx.normalPath()`, §20.2), см. `node_normal_map_test.py` |
| **Music** | stems, loop, transport | `src/highlevel/audio.js`, `audiobus.js` | §25 в работе у исполнителя |
| **Input** | actions/contexts, bindings, device policy, capture | `src/highlevel/input.js` | `highlevel_input_contexts_test.py` (25), `tests/js/input_contexts_test.mjs` (10) |
| **Validation report** | code, severity, path, nodeId | `src/highlevel/diag.js` | `highlevel_diag_test.py`, `tests/js/diag_test.mjs` |

## Правила, которые нельзя нарушать

1. **Единого гигантского формата проекта нет** и не появится: небольшие
   документы связываются ссылками на ресурсы.
2. **Prefab — источник описания узлов.** Ни один другой формат не описывает
   дерево узлов заново.
3. **Данные открыты и пригодны для diff**: игра и примеры держат данные в
   читаемом JSON и ASCII-картах; бинарные blob'ы для ревью непригодны.
4. **Незаявленное остаётся незаявленным.** Если поля нет в коде, оно не
   попадает в обещания профиля — тест печатает его как «ждёт», а не «ок».

## project.json (минимальный и schema_version 2)

`project.json` — манифест запуска и граф проекта для Editor, а не база данных:
правило 1 выше в силе. Полное описание — [PROJECT_JSON.md](PROJECT_JSON.md).
Разбор: `src/project.c`; проверка: `sdk/native/sdk_validate.c`; индексатор графа:
`sdk/native/sdk_project_graph.c`.

```json
{
  "schema_version": 2,
  "project": {"name": "Неоновый курьер", "version": "1.0.0"},
  "runtime": {"entry": "main.js", "start_scene": "menu",
              "window": {"title": "Неоновый курьер", "width": 960, "height": 640}},
  "editor": {"graph": {"…": "строит r2d project-index"}}
}
```

| Поле | Значение |
|---|---|
| `schema_version` | `2`; нет поля — минимальный манифест (`title`, `width`, `height`, `version`, `toolHost`), читается как раньше |
| `runtime.entry` | точка входа (по умолчанию `main.js`); её берут и запуск `--game`, и `build` без `--entry` |
| `runtime.start_scene` | сцена при запуске без `--scene`; попадает в `$.startScene`. `--scene` старше |
| `runtime.window` | `title`, `width`, `height`, `fullscreen` |
| `editor.graph` | сохранённый граф проекта; рантайм его не читает |

Коды `r2d validate` (`R2D201`–`R2D210`, `--json`) и `r2d project-index` /
`project-set` / `migrate-project` — в [PROJECT_JSON.md](PROJECT_JSON.md) §2 и §4.
Прежний `"format": 2` с `entry`/`scenes`/`roles` больше не читается:
`r2d migrate-project` переводит его в schema 2.
