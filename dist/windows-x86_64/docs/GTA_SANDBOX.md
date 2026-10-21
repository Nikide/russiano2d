# GTA-подобный top-down sandbox: что уже есть и что добавлено

Документ описывает работу по плану
`RUSSIANO2D_GTA_FEATURE_ROADMAP_FOR_DEEPSEEK.md`: городской top-down sandbox
(пешеходы, транспорт, оружие, трафик, миссии) на существующем Russiano2D, **без**
переноса Carnage3D, без ECS/3D и без второго scene graph. Игровая логика — только
через публичный `$` API; нативные добавления сделаны лишь там, где был реальный
пробел (теги поверхностей), остальное — переиспользуемые JS-сэмплы в демо.
В примерах `R2D_BINARY` задаётся по [инструкции проверок](TESTING.md).

## Аудит: есть / частично / отсутствует

| Возможность | Статус | Где |
|---|---|---|
| Публичный `$` API, узлы, жизненный цикл | **есть** | `src/highlevel/api.js`, `docs/HIGH_LEVEL_API.md` |
| Linecast/raycast со structured hit, маски, shape cast | **есть** | `$.world.raycast/raycastAll/castShape/bodyAt/bodiesIn/lineOfSight` (`src/highlevel/world.js`) |
| Re2D-геометрия в запросах: surface/span/cell/material | **есть** | `$.re2dWorld.trace/traceAll` (`src/re2d_world_trace.c`, `src/highlevel/re2d.js`) |
| Surface material/terrain policy, именованные поверхности | **частично** | `surface.terrain/material/sky`; произвольных пользовательских тегов не было |
| Теги поверхностей + `groundAt` с однозначным multi-floor правилом | **добавлено** | P0.1: author JSON `span.tags`, `world.groundAt`, `surface.tags/hasTag/tag`; bake/SDK round-trip; brush-карты пробрасывают `tags`/`ceilingTags` через `sdk_brush` |
| Runtime-теги переживают save/load | **добавлено** | `re2d-save` v2: секция `surfaceTags`, `world.saveState()/loadState()`; v1 saves совместимы и не стирают живые теги |
| Roof fade / per-surface alpha | **добавлено** | `world.surface(i).fade(a)` (0..1), CPU/GPU parity; демо-city фейдит крыши под игроком |
| Произвольный поворот 2D-спрайта (угол/pivot/scale/nearest) CPU+GPU | **есть, проверено** | `node.angle`, `pushSprite`, P0.3 тест |
| Машина: force/torque, масса, drag, тормоз, поворот, ручник, grip | **добавлено (JS над Box2D)** | `demos/re2d_gta_sandbox/lib/vehicle.js`, P0.4 |
| Общий урон/hitscan/projectile/AoE, события с источником/точкой | **добавлено (сэмпл над `$.world`/`$.health`)** | `lib/combat.js`, P0.5 |
| Stable handles/ownership/lifetime для streamed-объектов | **добавлено (сэмпл)** | `lib/ownership.js`, P0.6 |
| Сиденья, enter/exit, input lock | **добавлено (сэмпл)** | `lib/seats.js`, P1.1 |
| Композиция персонажа (idle/walk/run/shoot/hit/stun/dead) | **добавлено (сэмпл)** | `lib/character.js`, P1.2 |
| Population/traffic генерация около игрока, фильтры | **добавлено (сэмпл)** | `lib/population.js`, P1.3 |
| Road/walk graph (полосы, one-way, speed, intersections, parking) | **добавлено (сэмпл)** | `lib/roadgraph.js`, P1.4 |
| AI/навигационные примитивы (patrol/follow/flee/driveTo) | **добавлено (сэмпл над `$.nav`)** | `lib/ai.js`, P1.5 |
| Зоны/статусы/события анимации/миссии | **частично + сэмпл** | `$.zone`, `$.signal`, `$.flow`, `$.quest`, `$.save`; `lib/missions.js` |
| P2: декали, VFX/audio emitters, camera follow, debug overlays | **сэмплы** | `lib/polish.js`; существующие `$.particles/$.vfx/$.sound/$.camera/devtools` |
| Roof fade в Re2D | **добавлено** | `surface.fade()` — per-surface alpha, не материал; демо-city плавно прячет крыши под игроком, alpha 1 байт-в-байт равна прежнему кадру |

## Демо

`demos/re2d_gta_sandbox` — два сценария:

* `city` — Re2D World: улицы/тротуары/трава/здания с тегами поверхностей,
  top-down камера, машины и пешеходы, столкновения, урон, миссия, HUD.
* `plain2d` — тот же транспорт/персонаж/оружие **без Re2D**, на обычных узлах и
  Box2D; доказывает, что базовые подсистемы не зависят от Re2D.

Запуск:

```bash
"$R2D_BINARY" --game demos --scene re2d_gta_sandbox_city
"$R2D_BINARY" --game demos --scene re2d_gta_sandbox_plain
```

(точные имена сцен и управление — в `demos/re2d_gta_sandbox/README.md`).

## Границы

* Нет ECS, второго scene graph, 3D rigidbody/мешей, нативного Vehicle/AI/mission
  фреймворка. Всё — данные + скрипты поверх `$` и существующих подсистем.
* Новые нативные данные (surface tags, brush tags, fade) опциональны: карты без
  них грузятся байт-в-байт как раньше; alpha 1 не меняет кадр.
* Roof fade — runtime-состояние: не пекётся в карту и не входит в save-снапшот
  (сбрасывается в 1 после reload); игра выставляет его каждый кадр. Небо
  (`surface.sky(true)`) не рисуется через surface pass — сначала `sky(false)`.
* Демо — вертикальный срез, а не GTA-клон: ассеты/код Carnage3D не переносились.


## Подробности по фичам

| Документ | Тема |
|---|---|
| [gta/vehicle.md](gta/vehicle.md) | машина, surface grip, P0.3 поворот спрайта |
| [gta/combat.md](gta/combat.md) | hitscan/projectile/AoE, damage payload, события |
| [gta/ownership.md](gta/ownership.md) | владение, stable handles, sweep |
| [gta/character.md](gta/character.md) | композиция состояний персонажа |
| [gta/seats.md](gta/seats.md) | сиденья, enter/exit, input lock, eject |
| [gta/traffic.md](gta/traffic.md) | population/streaming, теги и фильтры |
| [gta/roadgraph.md](gta/roadgraph.md) | дороги/полосы/one-way/парковки |
| [gta/ai.md](gta/ai.md) | AI-примитивы, стимулы, зоны |
| [gta/missions.md](gta/missions.md) | миссии на данных и сигналах |
| [gta/polish.md](gta/polish.md) | декали/VFX/audio/camera/debug, roof-fade audit |
| [highlevel/re2d.md](highlevel/re2d.md) | surface tags, `groundAt`, `sprite_col`, top-down камера |

Приёмочные команды:

```bash
"$R2D_BINARY" lint demos/re2d_gta_sandbox
"$R2D_BINARY" validate demos/re2d_gta_sandbox
python3 tests/agent/re2d_gta_sandbox_test.py
python3 tests/agent/re2d_gta_vehicle_test.py
python3 tests/agent/re2d_gta_combat_test.py
python3 tests/agent/re2d_gta_ownership_test.py
python3 tests/agent/re2d_gta_seats_test.py
python3 tests/agent/re2d_gta_traffic_test.py
python3 tests/agent/re2d_gta_roadgraph_test.py
python3 tests/agent/re2d_gta_missions_test.py
python3 tests/agent/re2d_surface_tags_test.py
```

Числа на текущем дереве: `ctest 169/169`, sandbox e2e 22 проверки,
libs 300 проверок суммарно (vehicle 61, combat 43, ownership 27, seats 51,
traffic 29, roadgraph 53, missions 36), surface tags 53, surface fade отдельный
агент-тест, lint/validate демо — 0 диагностик.
