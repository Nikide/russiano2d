# Re2D Huge World Foundation (R-04)

Status: native region module `src/re2d_world_region.c/.h`, compiler region
partition and coarse PVS, Unity tests. The runtime never builds one giant BSP
for the whole map.

## Hierarchy

```text
World
  -> region grid (R2DWorldRegionSet)
       -> region (cell CSR + portal incidence + adjacency)
            -> local cells / spans / portals (existing R2DRe2dWorld)
                 -> surfaces / sprites
```

The region module is independent of the renderer. It consumes plain cell rects
and portal links, so the map compiler builds the same partition before a runtime
world exists and the runtime can rebuild it from a loaded `R2DRe2dWorld`.

## Region grid and build

`r2d_world_region_build(cells, cell_count, portals, portal_count,
region_size, &set, error, size)`:

* deterministic row-major partition; cells are assigned by footprint centre;
* per-region cell CSR, portal incidence and deduplicated region adjacency;
* coarse PVS bitset per region (region reachability over open portals).

Caller-provided storage; a sizing call (all arrays NULL, capacities 0) returns
the required region count and `pvs_words`. Required capacities are documented in
the header. Build uses temporary integer work arrays only.

## Region states and streaming

```text
UNLOADED -> METADATA -> PRELOADING -> RESIDENT -> ACTIVE
ACTIVE/SLEEPING -> UNLOADED
```

* `r2d_world_region_update_active(set, center, active_ring, preload_ring, ...)`
  marks the current ring `ACTIVE`, the preload ring `PRELOADING` (or keeps an
  already `RESIDENT` region), PVS-visible distant regions `SLEEPING`, the rest
  `UNLOADED`. It writes active/preload lists and metrics.
* `r2d_world_region_stream(set, states, capacity, budget)` advances
  `PRELOADING -> RESIDENT` and `SLEEPING -> UNLOADED` with a per-frame budget.
  This is the streaming contract: the caller owns BSP/surface/material payloads;
  the state transition is the permission to load/evict them.

## Coarse PVS, areaportals, hints, occluders

* Coarse PVS is region reachability over portals whose `closed` flag is false.
  Closed doors and areaportals cut whole region branches; `r2d_world_region_rebuild_pvs()`
  is called after dynamic state changes.
* Areaportal brushes mark generated portal edges (`area_portal` bit in
  `R2DWorldPortal`). The compiler reports marked/bad areaportals.
* Hint brushes are compiler-only visibility splits; the compiler warns when a
  hint touches no portal (`SDK_WORLD_USELESS_HINT`).
* Occluder brushes are counted as visibility blocker markers; full occluder
  rasterization is not part of this pass.

## LOD

`r2d_world_region_lod(distance, &lod)` returns a plain policy value:

| distance | sprite dirs | animation fps | lights | particles | impostor |
|---|---|---|---|---|---|
| <= 600 | 16 | 60 | yes | 100% | no |
| <= 1500 | 8 | 15 | yes | 100% | no |
| <= 3000 | 4 | 8 | no | 50% | yes |
| <= 6000 | 1 | 5 | no | 20% | yes |
| > 6000 | hidden | hidden | no | 0% | yes |

The caller feeds existing sprite/light/particle budgets; no new graph or ECS.

## Large coordinates

`r2d_world_region_local(set, region, world_x, world_y, &lx, &ly)` subtracts the
region centre. Renderer transforms can use region-local floats while gameplay
continues to use world XY. Double-precision internal conversion is left to the
caller where needed; the module itself never accumulates world-space deltas.

## Runtime integration

`R2DWorldRuntime` now builds the same region partition lazily from loaded
`R2DRe2dWorld` cells/portals (512-unit default grid, doubled until the grid fits
the module cap), refreshes the active/preload ring each frame around the camera,
and advances the streaming state machine with a budget of 2. `world.info()`
exposes `regionCount`, `regionCurrent`, `regionActive`, `regionPreload`,
`regionResident`, `regionUnloaded`, `regionCulled`, `regionPvsEdges` and a
`regions` object (`count/columns/rows/size/current/active/preload/resident/culled/activeList`).

The partition is rebuilt when cell/portal counts change; the renderer is not
required to use it yet, so existing maps keep the same local BSP/portal path.
The compiler's `--region-size` metadata is diagnostic; runtime uses the
deterministic default unless the caller builds its own `R2DWorldRegionSet`.

## Compiler metrics

`r2d-sdk world compile map.re2dmap --renderer --region-size N` emits:

* `stats.regions`, `regionColumns`, `regionRows`, `pvsEdges`;
* `compiler.regionGrid` and `compiler.regionCells[]` in `.re2dworld`;
* `stageReport` with load/compile/region timings.

BASHNYA legacy `l02.re2dmap` compiles with 639 cells, 1173 portals, 57 regions,
3192 coarse PVS edges and 0 errors in ~0.05 s wall time on the test machine.

## Tests

* `tests/re2d/region_test.c` (9 Unity tests): grid/partition, sizing, PVS open
  and closed, areaportal isolation, active/preload rings, streaming budget,
  local coordinates, LOD, determinism, invalid arguments.
* `r2d_check` runs them under ASan/UBSan in the standard build.

## Limits

* Runtime region info is wired, but region streaming is a state/permission
  contract: BSP/surface/material payloads are still resident, no async loader.
  Compiler `--region-size` is not fed back into runtime (default 512).
* No asynchronous disk I/O or texture/atlas residency budget is implemented;
  `r2d_world_region_stream()` is the permission/state contract, not a loader.
* Full occluder PVS and hierarchical BSP PVS beyond coarse region reachability
  are not claimed. Local BSP/portal visibility still runs after the region
  reject stage.
