# Re2D debug views, budgets and profiling

## Native debug view enum

`world.debug.view(name)` switches the native GPU reference view. The enum is
authored in C (`R2D_WORLD_DEBUG_*`) and currently supports exactly these names:

```
final  cell-id  span-id  depth  owner  light-level
dynamic-light-count  normal  emissive  bsp  portals  shadow-mask  overdraw
```

`world.debug.view('regions')` is **not** accepted: drawing region bounds,
areaportal lines, occluder planes, LOD tints or AO buffers needs new enum values
plus a renderer pass. The JS catalogue is honest about that:

```js
world.debug.views();     // native enum names that can be selected now
world.debug.features();  // [{name, status:'ready'|'counter'}] incl. unsupported views
world.debug.supported('occluder'); // false
```

Counter-only features: `regions`, `active-regions`, `pvs`, `vis-clusters`,
`areaportal`, `occluder`, `distant-lod`, `sprite-lod`,
`material-variation`, `ao-lite`, `sky-layers`, `texture-residency`.
Their numbers come from `world.info()` / `world.visibility()`:
`regionCount/regionCurrent/regionActive/regionPreload/regionResident/regionCulled/
regionPvsEdges`, `cellsRejected`, `surfacesRejected`, `visibleCells`,
`visibleSpans`, `visibleSurfaces`, `portalsTested`, `bspNodesVisited`,
`visibleAtlasSprites`, `atlasSprites`, `visual.ao*`, `visual.materialVariation*`,
`visual.vfx*`, `lightsAfterCull`, `shadowedLights`.

`world.debug.visibility()` returns the visible span/surface index arrays, which
is the data a PVS/occluder overlay would draw.

## Profiler fields already exposed

`world.info()` includes the roadmap §127 counters that exist natively:
`regionVisible/regionActive/regionPreload/regionResident/regionCulled`,
surface counters (`visibleSurfaces`, `gpuDrawsSpan`, `gpuMaterialBatches`), sprite
counters (`atlasSprites`, `visibleAtlasSprites`), `lightsCulled` through
`lightsAfterCull`, `particlesCulled` through VFX info, `decalCount`,
`skyMs`, `postMs` in `visual.renderTime`, plus `visibilityMs`, `surfaceMs`,
`actorMs`, `compositionMs`, `uploadMs`, `frameMs`.

Missing native measurements are reported as absent, not invented.

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
of the visual lab (renderer-lab fallback while `demos/re2d_visual_lab` is still
landing) and the VFX lab, then compares them with reference PNGs under
`tests/agent/reference/` using per-channel tolerance and a changed-pixel
fraction, not byte equality. Refresh references deliberately:

```bash
python3 tests/agent/re2d_render_regression_test.py --update
```

## Hooks still needed (owned by renderer/streaming tasks)

- native enum values and draw passes for region bounds, active/preload regions,
  PVS edges, areaportal/occluder overlays, distant/sprite LOD, material
  variation, AO-lite and texture residency;
- a per-metric profiler aggregate for `regionStreamMs`/`regionUploadBytes` once
  async residency exists;
- shadow-map consumption of `R2D_WALL_SHADOW` and audio occlusion of
  `R2D_WALL_ACOUSTIC` (these are compiler policy bits today).
