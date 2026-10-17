# Re2D debug views, budgets and profiling

## Native debug view enum

`world.debug.view(name)` switches the native reference view. The enum is
authored in C (`R2D_WORLD_DEBUG_*`); legacy values are unchanged and new views
are append-only:

```
final  cell-id  span-id  depth  owner  light-level
dynamic-light-count  normal  emissive  bsp  portals  shadow-mask  overdraw
region  active-region  pvs  vis-cluster  areaportal  occluder
distant-lod  sprite-lod  material-variation  ao-lite  vfx-budget
```

The new views are real native overlays (`src/re2d_world_debug_overlay.*`,
called by the runtime after the CPU/GPU reference frame is composed). They use
only constrained 2D primitives: projected region/cell/impostor/actor rectangles,
portal/occluder lines and per-owner material/AO pixel tints. FINAL and all
legacy views are untouched (even at the byte level).

| view | draws |
|---|---|
| `region` | region grid bounds outlines (colour per col/row) |
| `active-region` | region fills: green active, cyan preload/resident, dark other |
| `pvs` | region fills from the current region PVS (cyan visible, red culled) |
| `vis-cluster` | cell fills coloured by vis-cluster index in the current region |
| `areaportal` | authored areaportal segments (red closed, cyan open), floor+upper line |
| `occluder` | compiler occluder segments (floor+upper line) |
| `distant-lod` | visible region impostor cards (green near, blue far) |
| `sprite-lod` | actor LOD bounds (cyan near → blue far by `lod_config` bands) |
| `material-variation` | per-pixel deterministic material/surface tint |
| `ao-lite` | per-span height-gap AO (brighter/open, dark/low ceiling) |
| `vfx-budget` | bars: particles, decals, lights, visible actors, active regions, stream uploads |

```js
world.debug.views();     // all names above
world.debug.features();  // [{name, status:'ready'|'counter'}]
world.debug.supported('occluder'); // true
```

`world.debug.visibility()` still returns the visible span/surface arrays.
Counter-only features remain `sky-layers` and `texture-residency`.

## Profiler fields already exposed

`world.info()` includes the roadmap §127 counters that exist natively:
`regionVisible/regionActive/regionPreload/regionResident/regionCulled`,
surface counters (`visibleSurfaces`, `gpuDrawsSpan`, `gpuMaterialBatches`), sprite
counters (`atlasSprites`, `visibleAtlasSprites`), `lightsCulled` through
`lightsAfterCull`, `particlesCulled` through VFX info, `decalCount`,
`skyMs`, `postMs` in `visual.renderTime`, plus `visibilityMs`, `surfaceMs`,
`actorMs`, `compositionMs`, `uploadMs`, `frameMs`.

Real CPU-clock region split (no fabricated GPU timestamps):

| field | meaning |
|---|---|
| `regionLoadMs` | region grid build/ensure (first frame / rebuild) |
| `regionVisibilityMs` | PVS + occluder + cluster + active/preload ring selection |
| `regionStreamMs` | residency state update (`r2d_world_stream_update`) |
| `regionStreamIoMs` | budgeted payload load/unload tick (`R2DWorldStreamIO`) |

Missing native measurements are reported as absent, not invented.

## Material inspector

`world.debug.material(nameOrIndex)` (native `materialInfo`) returns
`{index,name,blend,opacity,uScale,vScale,emissiveStrength,worldUV,linear,
albedo{width,height},normal{...},emissive{...},surfaceCount,variation{tintR,
tintG,tintB,uvU,uvV}}`; `world.debug.materials()` lists the used bank.
`world.info().materialCount` and `world.info().materialList` mirror it;
`world.info().materials` stays the legacy material count for compatibility.

## Budgets

`world.debug.budgets()` returns the orientation ranges from roadmap §124–125:

| metric | range | unit |
|---|---|---|
| `regionsActive` | 0..9 | regions |
| `regionsPreload` | 16..25 | regions |
| `spritesVisible` | 100..300 | sprites |
| `particlesAlive` | 1000..3000 | particles |
| `decals` | 64..256 | decals |
| `lightsRelevant` | 8..16 | lights |
| `shadowedLights` | 2..6 | lights |

`world.debug.budget()` (or `budget(info)`) returns rows:

```js
{ metric, measured, min, max, unit, status: 'ok'|'under'|'over'|'unavailable', pass }
```

`pass` means "measured and does not exceed the ceiling". `under` is a fact about
the measured scene, not a failure: a small lab may legitimately load fewer than
16 preload regions. `over` is the regression signal.

`tests/agent/re2d_budget_test.py` measures the bench lab (`actors_100`,
`particles_2000`), the renderer lab (64 decals, 12 relevant lights, 2 shadow
lights, material/span batching) and the open-world lab (active/preload regions).

## Render regression

`tests/agent/re2d_render_regression_test.py` captures deterministic GPU frames
of the visual lab and the VFX lab, then compares them with reference PNGs under
`tests/agent/reference/` using per-channel tolerance and a changed-pixel
fraction, not byte equality. Refresh references deliberately:

```bash
python3 tests/agent/re2d_render_regression_test.py --update
```

The acceptance lab (`demos/re2d_visual_lab`, scene `re2d_visual_lab`) adds the
dense HUD/debug probe `globalThis.visualLab` and its own capture/feature test:

```bash
python3 tests/agent/re2d_visual_lab_acceptance_test.py --update
python3 tests/agent/re2d_visual_lab_acceptance_test.py
```

It stores `re2d_visual_lab.png` plus `visual_lab_<feature>_{before,after}.png`
for material variation, bevel/AO, fog/haze, sky layers, emissive/bloom and VFX.
BASHNYA BEFORE/AFTER evidence (start bridge, shot, VFX) is captured from the
unchanged bundled BASHNYA runtime by
`tests/agent/bashnya_visual_refs_test.py` into `tests/agent/reference/bashnya/`.

## Hooks still needed (owned by renderer/streaming tasks)

- texture-residency overlay (counter only today; the stream cache would need to
  expose per-region texture ids to the overlay);
- shadow-map consumption of `R2D_WALL_SHADOW` and audio occlusion of
  `R2D_WALL_ACOUSTIC` (these are compiler policy bits today).
