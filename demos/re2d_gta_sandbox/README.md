# Re2D GTA-like sandbox

Два сценария на публичном `$` API:

| Сцена | Что внутри |
|---|---|
| `re2d_gta_sandbox_city` | Re2D World: улицы/тротуары/трава/здания с surface tags, top-down камера, машины, пешеходы, трафик, урон, миссия, HUD |
| `re2d_gta_sandbox_plain` | тот же транспорт/персонаж/оружие **без Re2D** — обычные узлы и Box2D |

```bash
./build/russiano2d --game demos/re2d_gta_sandbox --scene re2d_gta_sandbox_city
./build/russiano2d --game demos/re2d_gta_sandbox --scene re2d_gta_sandbox_plain
```

## Управление (city)

| клавиши | действие |
|---|---|
| `WASD` / стрелки | пешком/в машине: газ, тормоз, руль |
| `E` | сесть в машину / выйти |
| `Space` | ручник |
| ЛКМ | выстрел из текущего оружия |
| `Tab` | карта/отладка (если доступно) |
| `F1` | оверлей движка |

HUD: скорость, здоровье, патроны, число пешеходов/машин, текущая миссия.

Город использует новые возможности движка: surface tags (road/sidewalk/grass/
park/no_spawn) в brush- и explicit-картах, `groundAt`-фильтры спавна, runtime
теги в save (`world.saveState/loadState`) и per-surface `surface(i).fade()` —
крыши зданий плавно проявляются, когда игрок под ними.

## Где что лежит

```
lib/vehicle.js      машина над Box2D + surface grip из Re2D tags
lib/vehicle_view.js повёрнутый спрайт машины (plain 2D)
lib/combat.js       hitscan/projectile/AoE, damage payload, события
lib/ownership.js    persistent/temporary/mission + stable handles
lib/character.js    композиция locomotion/facing/shoot/hit/dead
lib/seats.js        сиденья, enter/exit, input lock, безопасный eject
lib/roadgraph.js    дороги/полосы/one-way/speed/парковки
lib/population.js   стриминг пешеходов/машин около игрока
lib/ai.js           patrol/follow/flee/driveTo поверх $.nav/roadgraph
lib/missions.js     миссии на триггерах/сигналах/$.save
lib/polish.js       декали, VFX/audio, camera follow, debug overlays
lib/hud.js          RmlUi-узлы HUD (сцена city)
```

Полное описание и аудит — `docs/GTA_SANDBOX.md` и `docs/gta/*.md`.
