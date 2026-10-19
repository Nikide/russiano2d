# Re2D VFX library (R-03)

Native VFX data + fixed pools on top of the existing Re2D particle pool. This is
a constrained 2.5D feature: world cards, screen cards, pooled trails, temporary
lights, decals, distortion hooks and particle collision modes. It is **not** a
particle-node system, an ECS, a mesh renderer or a fluid simulation.

Sources: `src/re2d_world_vfx.c/.h`, particle collision fields in
`src/re2d_world_particle.c/.h`, `$` bridge in `src/highlevel/re2d.js`, native
methods in `src/re2d.c`.

## API

The library is reached from a `world` handle (`$.re2dWorld.load(...)` or the
legacy `$.re2d.world(...)` wrapper):

| Call | Contract |
|---|---|
| `world.vfx.define(name, jsonText)` | parse one FX bundle into the native registry; atomic, `TypeError` on invalid JSON/field |
| `world.vfx.defined(name)` | whether the bundle name is registered |
| `world.vfx.spawn(name, at)` | spawn one bundle; `at = {x,y,h,dx,dy,dz,seed}`; returns counters/feedback |
| `world.vfx.info()` | live counters and budgets for this world |
| `world.vfx.debug()` | `info()` + particle budget + registered bundle names |
| `world.vfx.clear()` | drop live cards/trails/lights/decals; keep definitions |
| `world.vfx.lightBudget(n?)` | set/get the temp-light budget (0..16) |

`spawn` result:

```js
{
  particles, cards, trails, lights, decals, distortion,
  shake, flashMs, flashColor, sound
}
```

`shake`, `flash` and `sound` are **data**: the game decides whether to call
`$.re2dFeel`, `$.vfx.flash` or `$.sound`. The engine never owns camera feel or
audio playback here.

## FX bundle format

Bundles are plain JSON (same shape as high-level `world.fxDefine`, extended with
cards/trails/collision). One file can define one bundle; the game reads it through
the existing asset pipeline and calls `world.vfx.define`:

```js
const text = $.fs.readText('assets/vfx/combat/muzzle_flash.json');
world.vfx.define('muzzle_flash', text);
world.vfx.spawn('muzzle_flash', { x, y, h, dx, dy, dz: -0.2, seed: 7 });
```

```json
{
  "particles": [
    { "count": 6, "life": 0.12, "size": 6, "endSize": 0, "color": "#ffd080",
      "blend": "additive", "mode": "billboard",
      "speed": 180, "spread": 60, "dirH": 0.2,
      "collision": "bounce", "bounce": 0.4, "radius": 1 }
  ],
  "cards": [
    { "kind": "ring", "life": 0.25, "size": 20, "endSize": 120,
      "color": "#ffd0a0", "blend": "additive", "distortion": "shockwave" }
  ],
  "trail": { "life": 0.3, "width": 6, "color": "#ffffff",
             "spacing": 0.02, "speed": 80 },
  "light": { "radius": 200, "intensity": 2, "color": "#ffb060",
             "life": 0.1, "priority": 3, "shadow": false },
  "decal": { "material": 0, "width": 16, "height": 16, "life": 12 },
  "sound": "sfx/impact.ogg",
  "shake": 0.2,
  "flash": { "color": "#fff0c0", "ms": 60 }
}
```

Fields:

* **particles** (max 4 presets, up to 4096 per preset): `count`, `life`, `size`,
  `endSize`, `alpha`, `endAlpha`, `color`, `blend` = masked/translucent/additive,
  `mode` = screen/billboard/axis/floor, `gravity`, `drag`, `speed`, `spread`,
  `dirX/dirY/dirZ` (or `dirH`), `frame/frames`, `collision` =
  none/floor/wall/bounce/despawn, `bounce` 0..1, `radius` >= 0.
* **cards** (max 4): `kind` = sprite/streak/ring/flash/decal/light_pulse;
  `mode` = billboard/screen/axis/floor; life/size/endSize/alpha/endAlpha/width,
  color, blend, rotation/spin, frame/frames, optional `distortion` =
  heat/shockwave/magic.
* **trail**: one template, pooled with 8 points; `spacing` is seconds between
  recorded points.
* **light**: temp light; budget 16 per world, deterministic priority stealing;
  `shadow` defaults to false.
* **decal**: uses existing world decal slots (128 max), requires a used material;
  zero `life` means permanent until removed.
* **flash/shake/sound**: returned as data for the game.

Malformed JSON, wrong types, out-of-range counts/colors and unknown enum names
are rejected before a bundle is stored (`TypeError` from JS; error text from C).
Registry bounds: 32 named bundles, 128 cards, 32 trails, 16 lights, 128 tracked
decals.

## Particle collision

Particle presets set `collision`:

| Mode | Behavior |
|---|---|
| `none` | original free flight |
| `floor` | clamp `h` to the support height, zero downward `vh` |
| `wall` | reject blocked XY step, test X-only/Y-only for slide |
| `bounce` | reflect the blocked axis and floor contact by `bounce` restitution |
| `despawn` | deactivate on first contact |

Collision is point/probe based (`radius` is only the wall cylinder radius), not
rigid-body physics. `world.vfx.step_particles` is called from the native world
tick with existing `support`/`blocked` queries; the same modes are unit-tested
offline with caller-provided query callbacks.

## Debug counters

`world.vfx.info()`:

```text
particlesAlive, particleCapacity, particleOverflow, particlesSpawned,
cards, cardsSpawned, trails, trailsSpawned, tempLights, lightBudget,
lightOverflow, decals, decalsSpawned, distortionCards, fxBundles,
fxSpawns, emitters
```

`world.info()` keeps the existing counters and adds flat VFX fields:
`particlesAlive`, `particleCapacity`, `particleOverflow`, `particlesSpawned`,
`emitters`, `fxBundles`, `tempLights`, `vfxLightBudget`, `vfxLightOverflow`,
`vfxDecals`, `distortionCards`, `vfxCards`, `vfxTrails`, plus `vfx` (the full
object). `world.vfx.debug().bundles` lists registered names.

## Assets

`assets/vfx/` contains the authored pack (procedural JSON, no external
downloads), 7 categories and 53 effects:

```text
combat/       muzzle_flash, shotgun_smoke, pellet_impact_stone/metal/flesh,
              blood_spray, blood_mist, blood_decal, scorch, shell_eject,
              hit_spark, hit_dust
fire/         fire_small, fire_large, ember, fire_smoke, burning_actor,
              heat_distortion, fire_light
frost/        frost_burst, ice_shards, frost_mist, frost_decal, freeze_overlay
electric/     spark, arc_card, electric_hit, pulse_light, screen_flash
acid/         acid_splash, acid_drip, acid_pool, acid_smoke, acid_decal
magic/        portal, glyph, soul, red_eye_glow, magic_mist, teleport,
              vanish, boss_aura
environment/  dust, floating_ash, fog_strip, smoke_column, falling_debris,
              dripping_water, rain, snow, wind_dust, light_shaft_dust,
              ambient_embers
```

`assets/vfx/pack.json` is the manifest (category → name/path). The lab demo
`demos/re2d_vfx_lab` loads the same files through the asset pipeline. Textures
are not required for these packs: primitives are tinted native cards/particles.

## Tests and limits

* Native Unity: `tests/re2d/vfx_test.c` (`r2d_world_vfx_test`) — bundle parse,
  cards/trails lifetimes, light budget/stealing, all particle collision modes,
  determinism, invalid input.
* Agent: `tests/agent/re2d_vfx_pack_test.py` — loads all 53 bundles through the
  demo and spawns every one; verifies counters and pool/light bounds.
* Particle regression: `tests/re2d/particle_test.c`.

Limits:

* Cards/trails/distortion are **state + renderer hook**; the native module owns
  budgets/counts and exposes data, while pixel output for exotic card shaders
  depends on the renderer feature pass. CPU/GPU particle rendering is the
  existing path.
* Decals use existing material slots; a bundle with an unused material reports
  `decals: 0` rather than creating a decal.
* `spawn` is one-shot in native code; continuous emitters remain the existing
  `world.particles.continuous` API.
* No per-frame JS node, no allocation in the step path, no generic 3D.
