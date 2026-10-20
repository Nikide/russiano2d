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

## project.json (формат 1 и 2)

`project.json` — манифест запуска, а не база проекта: правило 1 выше в силе.
Формат 2 добавляет только **индекс** — что запускать и как открывать файлы;
сами данные остаются в своих документах. Разбор: `src/project.c`, проверка:
`sdk/native/sdk_validate.c`.

```json
{
  "format": 2,
  "title": "Неоновый курьер", "version": "1.0.0", "width": 960, "height": 640,
  "entry": "main.js",
  "scenes": { "start": "menu", "list": ["menu", "level1"] },
  "roles": { "ui/hud.rml": "rmlui", "data/waves.json": "data" }
}
```

| Поле | Значение |
|---|---|
| `format` | `2`; нет поля — формат 1, файл читается как раньше |
| `entry` | точка входа относительно проекта (по умолчанию `main.js`); её берут и запуск `--game`, и `build` без `--entry` |
| `scenes.list` | сцены, которые регистрирует код через `$.scene.add('имя', …)` |
| `scenes.start` | сцена при запуске без `--scene`; попадает в `$.startScene`. `--scene` старше |
| `roles` | путь → роль: id студии Editor (`atlas`, `tilemap`, `rmlui`, `audio`, …) или `script`/`data`/`asset`. Editor открывает файл по роли; явное «Открыть как…» старше |

`r2d validate` (коды стабильны, `--json`):

| Код | Что |
|---|---|
| `R2D201` | `format` не 1/2; поля v2 в файле без `"format": 2` (предупреждение) |
| `R2D202` | `entry` вне проекта или файла нет |
| `R2D203` | `scenes` неверной формы, повтор в `list`, `start` не из `list` |
| `R2D204` | расхождение индекса и кода: сцена в `list` без `$.scene.add` или наоборот (предупреждение) |
| `R2D205` | `roles`: путь вне проекта или файла нет |
| `R2D206` | `roles`: неизвестная роль |

`r2d migrate-project [каталог] [--write]` переводит v1 → v2: сохраняет поля,
ставит `entry: "main.js"` и строит `scenes.list` из `$.scene.add`. `scenes.start`
не угадывается. Без `--write` только печатает результат. В Editor — команда
«Проект: перевести project.json на v2».
