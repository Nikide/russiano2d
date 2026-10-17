# Re2D P0 — план исполнения до 16:00 MSK

Исполнитель: Team Lead + subagents. Источник: `RE2D_BOOMER_SHOOTER_TECH_ROADMAP.md`,
проходы P0-A…P0-H (§87–§107, §123). Правило приёмки: каждая новая фича
обязана быть доступна через `$` high-level API и покрыта тестом.

## Статус на входе (13:57)

| Проход | Статус | Где |
|---|---|---|
| P0-A native world sprite / atlas | готово, закоммичено `fbcc5cd` | `src/re2d_world_atlas.*`, `world.sprite`, демо `re2d_boomer_lab` |
| P0-B trace + hit proxy | готово, закоммичено `8bbf25d` | `src/re2d_world_trace.*`, `world.hit/trace/traceAll`, JS-тест |
| P0-C controller | готово | `src/re2d_world_controller.*`, `world.controller`, демо-probe |
| P0-D semantic IDs | готово | bake v3/v4 + `r2d_world_find_*`, `world.find*`, карта testroom переcобрана |
| P0-E movers | готово с ограничением | `src/re2d_world_mover.*`, `world.mover`, span+portal |
| P0-F triggers | готово | `src/re2d_world_trigger.*`, `world.trigger*`, `$.on/$.emit` |
| P0-G viewmodel/VFX | готово | `src/highlevel/re2d_viewmodel.js`, `$.re2dViewmodel`, `$.re2dFeel` |
| P0-H native gate | готово | `r2d_check` + CTest: 124 теста за ~3.5 с |

## Таймлайн

* **до 14:20** — fallback-коммит P0-B (уже), `r2d_check`, каркас `$` API для
  controller/mover/semantic, план в `docs/re2d/`.
* **14:20–15:10** — приёмка ядер от subagents: Unity-тесты в CMake, интеграция
  в runtime + `$` API, демо-проверка на `re2d_boomer_lab`/`re2d_testroom`.
* **15:10–15:40** — movers/triggers: минимальный нативный timeline + `$`
  события; недостающее честно записать в ограничения.
* **15:40–15:55** — полный локальный прогон (`ci_verify`, doc/API guards,
  agent-тесты затронутых демо), релизный билд, коммит и отчёт.
* **16:00** — финальный ответ с тем, что вошло, что осталось и почему.

## Правила на проход

1. Никаких generic mesh/3D/ECS — только Re2D constrained primitives.
2. Новый `$`-символ: реализация → Unity/JS-тест → документация → демо.
3. C-тесты только Unity, без новых Python-тестов логики.
4. Каждый subagent создаёт только свои файлы; CMake и `$`-обёртку подключает
   Lead, чтобы не было конфликтов записи.
5. Незавершённое не заявляется готовым: ограничения — в docs и отчёте.

## Итог на 14:12 MSK

Все восемь проходов имеют реализацию, `$`-API, тесты и документацию:

| Что | Проверка |
|---|---|
| P0-A atlas world sprite | `r2d_re2d_atlas_test` (16), `re2d_boomer_lab_test` |
| P0-B trace + hit proxy | `r2d_world_trace_test` (8), `re2d_world_api_test` |
| P0-C controller | `r2d_world_controller_test` (14), lab-probe |
| P0-D semantic IDs | `r2d_re2d_semantic_test`, lab `findProbe` |
| P0-E movers | `r2d_world_mover_test` (11), lab-probe |
| P0-F triggers | `r2d_world_trigger_test` (9), lab-probe через `$.on` |
| P0-G viewmodel | `re2d_viewmodel_test.mjs` (11) |
| P0-H gate | `r2d_check`: 124/124 pass за 3.5 с |

Честные ограничения этого прохода (записаны и в docs):
* P0-E: портал пока бинарный (нет smooth open fraction), нет passenger carry
  и crush-detection на уровне controller — следующий шаг P0-E/P1.
* P0-D: у сегодняшних `.re2dmap` нет authored id у spans/openings, поэтому
  `findSpan` вернёт null на реальной карте (движок/загрузчик готовы).
* P0-C: нет mover carry/crusher, поддержка потолка point-based (ограничение
  world API).
* P0-G: helper screen-space; камера/FOV остаются у игры, загрузки текстур нет.

## P1 progress

| Pass | Status | Proof |
|---|---|---|
| P1-A smooth portals | done | `r2d_re2d_portal_test` (7), agent dust2 |
| P1-B passenger carry / crusher | done | controller 16 tests, mover blocking |
| P1-C particles + VFX core | done | `r2d_world_particle_test` (15), CPU+GPU agent pixels |
| P1-D nav graph | done | `r2d_world_nav_test` (13), dust2 path 25 spans |
| P1-E automap | done | `r2d_world_automap_test` (8), lab probe |
| P1-F map metadata/spawns | done | `r2d_world_metadata_test` (9), SDK passthrough, lab probe |
| P1-G terrain/liquids | next | — |
| P1-H save/load state | next | — |
| P1-I reverb zones / voice virtualization | next | — |

## P2 progress

| Item | Status | Proof |
|---|---|---|
| animated materials + scroll/emissive | runtime + `$` API | material_anim 10 tests, agent screenshot diff |
| material animation core | done | `r2d_world_material_anim_test` |
| volumetric sprites (box/cross/slice) | core done, render integration next | `r2d_world_volume_test` (10) |
| mirror/sky/link portals | math core done, renderer next | `r2d_world_portal_visual_test` (11) |
| postprocess / color grade | next | — |
| box impostor / slice-stack rendering | next | — |

## P3 progress

| Item | Status |
|---|---|
| multi-zone boss hit proxies | done: `world.hit({zones})`, trace zone/multiplier |
| breakables + event | done (P1 core + runtime) |
| conveyors | data + `conveyorMotion` gameplay tick |
| rotating polywalls | done: runtime groups + demo + agent trace/pixel test |
| polygon cells | done: compiler rect-tiling + boundary walls, agent test |

## P4 progress

| Item | Status |
|---|---|
| capabilities + profiler | done |
| aim assist / controller feels / quality presets | done |
| benchmark lab + baseline numbers | done (`docs/RE2D_WORLD_PERF.md`) |
| debug overlay data + draw layer | done: `world.debug.draw`, demo, agent test |
| determinism audit | done (`re2d_determinism_test.py`) |
| sky portal | done: visibility window + `world.portalSky`, agent pixel test |
| mirror portal render pass | pending (math core готов) |
| rotating polywalls runtime | pending (math core готов) |
| polygon cells compiler tiling | pending (authoring core готов) |

