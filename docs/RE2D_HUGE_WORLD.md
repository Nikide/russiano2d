# Re2D Huge World (R-04 full)

Status: region partition, hierarchical visibility, budgeted streaming/residency,
per-feature LOD wiring, distant impostors and region-local rendering data are
implemented and covered by native Unity tests plus an agent benchmark on the
compiled open-world lab. No mesh/3D/ECS was introduced: everything is built on
the existing constrained Re2D world (cells, spans, portals, walls, sprites,
lights, particles, decals, audio sources).

## Hierarchy

```text
World
  -> region grid / active + preload rings (R2DWorldRegionSet)
       -> vis clusters (bounded cell groups, R2DWorldClusterSet)
            -> local cells / spans / portals (existing R2DRe2dWorld)
                 -> surfaces / sprites / lights / decals
```

## Region grid and compiler metadata

`r2d_world_region_build(cells, count, portals, count, region_size, ...)` builds a
deterministic row-major partition with per-region cell CSR, portal incidence,
region adjacency and a coarse PVS bitset.

The runtime now honours the compiler's `--region-size` metadata: the JSON key
`compiler.regionGrid.size` (or a root `regionGrid.size`) is parsed by
`r2d_world_region_size_from_json()` in the same document that
`$.re2dWorld.load()` reads. The default remains 512; the grid is doubled only
when the module's hard grid cap would be exceeded. `world.regionConfig(size,
activeRing, preloadRing, uploadBytes, uploadItems)` overrides it at runtime and
rebuilds lazily.

## Hierarchical visibility (region -> cluster -> local BSP)

`r2d_world_visibility_filtered()` takes a per-cell allow mask. The runtime builds
that mask from:

1. coarse region PVS from the camera region (closed portals/areaportals cut
   whole region branches);
2. the compiler occluder wall-chain pass (`R2D_WALL_OCCLUDER`): a region is
   rejected when all five region sample points (corners + centre) are hidden by
   occluder segments from the camera (conservative coarse test);
3. vis-cluster PVS: cells inside a surviving region are rejected when the camera
   cluster cannot reach their cluster over open portals.

Local BSP/portal traversal then runs only on allowed cells, so the rejected
branches never enter surface submission. Closed areaportals cut both hierarchy
levels because region/cluster PVS and the local portal walk read the same
authored `closed` flag. PVS is rebuilt when `world.geometry_revision` changes
(door/lift/areaportal state), so the runtime never keeps a stale visibility
graph.

Counters: `visibility.culled_cells`, `visibility.cell_rejections`,
`world.info().regionCulled / regionOccluderCulled / regionClusterCulled /
regionCellsAllowed / regionCellsCulled / regionClusterEdges`.

Hint/skip are compiler tool materials: hint/skip walls do not render because the
wall policy bits say so; full BSP hint-plane splitting remains compiler work
(see docs/RE2D_BRUSH_AUTHORING.md).

## Streaming, residency and GPU upload budget

`src/re2d_world_stream.c/.h` is a deterministic, allocation-free residency cache:

```text
UNLOADED -> PRELOAD -> RESIDENT -> EVICTABLE -> UNLOADED
```

* items: BSP, surfaces, materials, textures, atlases, lights, decals, nav;
* each item has an owner region, byte size, priority, LRU stamp and dirty flag;
* ACTIVE regions request RESIDENT, PRELOADING/RESIDENT regions request PRELOAD;
  unloaded regions request EVICTABLE;
* per frame: bounded promotions (`promote_budget_items`), bounded uploads
  (`upload_budget_bytes` + `upload_budget_items`), then LRU eviction of
  non-active payloads until the resident byte/item budget holds;
* `0` upload budget means "no upload this frame"; residency budget `0` means
  unlimited;
* texture/atlas items use the same state machine, so `textureResident` /
  `atlasResident` queries share one contract.

`r2d_world_stream_set_hook()` exposes a synchronous transition hook
(`(user,id,kind,from,to)`) so the loader/GPU owner can start or stop real work
without polling. The runtime registers per-region BSP/surface payloads and merges authored
material textures plus live atlas buffers into the same cache. `world.info()`
exposes `streamUploads`, `streamUploadBytes`, `streamEvictions`,
`streamResidentBytes`, `streamPreload`, `texturesResident`, `atlasesResident`
and cumulative `streamTotalUploads / streamTotalUploadBytes /
streamTotalEvictions`.

Honest limitation: this is deterministic incremental residency, not async disk
I/O. The GPU owner must consume the contract: upload a texture/atlas when its
state becomes RESIDENT and `dirty` clears, and skip EVICTABLE/UNLOADED payloads.
No GPU/shader/sdk files were touched by this pass.

## LOD wiring

`r2d_world_region_lod_eval(distance, config, &lod)` returns one policy value
consumed by existing systems:

| band | sprite dirs | anim fps | lights | particles | decals |
|---|---|---|---|---|---|
| near | 16 | 60 | 16 | 100% | 100% |
| mid | 8 | 15 | 16 | 100% | 100% |
| far | 4 | 8 | 0 | 50% | 50% |
| impostor | 1 | 5 | 0 | 20% | 20% |
| hidden | 0 | 0 | 0 | 0% | 0% |

Runtime wiring:

* sprites (RotSprite + atlas): hidden LOD culls the sprite; animation LOD defers
  pose/crop updates to the band fps (deterministic `lod_tick` cadence);
* lights: distance policy drops lights with `light_updates == 0` and applies a
  per-band max-light and shadowed-light cap;
* particles: per-particle distance LOD culls by band percentage in both the CPU
  reference and the GPU collect path;
* decals: per-region cell/PVS + distance policy counters (`lodCulledDecals`);
* audio: sources whose region is not in the hierarchical visible set are
  virtualized/silenced without HRTF/occlusion ray cost.

Counters: `lodHiddenActors`, `lodThrottledActors`, `lodHiddenAtlas`,
`lodCulledLights`, `lodCulledParticles`, `lodCulledDecals`, `audioRegionCulled`.

Config: `r2d_world_region_lod_config()` (native) with validated monotonic bands.

## Distant impostors

`src/re2d_world_impostor.c/.h` bakes one vertical silhouette card per occupied
region from its cells/spans: world centre, region-local centre, width/height,
bottom/top, average floor tint, cell/span counts. Collection is
nearest-first and skips the current region, PVS-invisible regions, occluded
regions and cards beyond `max_distance`.

Renderer-facing API:

* native: `r2d_world_visible_impostors(runtime, &count)` and the
  `world.info().visibleImpostors / impostorCount` counters;
* JS: `world.impostors()` returns the cards with `region,x,y,localX,localY,
  width,height,bottom,top,color,distance,cells,spans`.

GPU owner hook: draw each card as one depth-tested vertical quad (textured with
a baked region silhouette atlas, or flat-tinted average colour), before local
actors, using `localX/localY` relative to the region render origin. This pass
only exposes data; no GPU code was touched.

## Large coordinates / region-local rendering

`r2d_world_region_render_origin()` returns the current region centre, and
`r2d_world_region_local()` converts world XY to region-local XY. The runtime
exposes `renderOriginX/Y/Region` in `world.info().regions` and
`world.regionLocal(x,y)`. Renderer hook: for far regions subtract the render
origin (or use `localX/localY`) before building float vertex data. Gameplay,
trace/blocked/support and save IDs stay in world coordinates. No double
accumulation is performed in the region module.

## Runtime integration

`R2DWorldRuntime` owns all of the above (lazily built from loaded
`R2DRe2dWorld` cells/portals/walls/spans). Per frame it: rebuilds portal
snapshots/PVS on geometry revision changes, computes region visibility +
occluder culling, rebuilds the cell allow mask, updates active/preload rings,
updates streaming budgets, syncs material/atlas assets and collects impostors.
`world.info().regions` includes `renderOrigin`, `clusterEdges`,
`occluderCulled`, `cellsAllowed`, `cellsCulled`, `impostors`, stream counters.

Existing save/load is unaffected: region indices are runtime snapshots, semantic
IDs and `r2d_world_save_map_hash()` remain the identity guard.

## Measured metrics (openworld lab, shipped `.re2dworld`)

```
regions 25, 8x8 compiler grid @ 256 (metadata honored at runtime)
coarse region PVS edges 600
vis cluster edges 702 (4 cells/cluster)
occupied cells 38, portals 64, areaportals 20
agent region walk: regions 0,1,4,17,19,23,24; active 1..5; culled 13..21
impostor cards visible (all distant visible regions) 24 (budget <= 64)
stream simulated resident bytes 9280 (region BSP/surface payloads)
regionConfig(256,1,2,131072,2) accepted, current region preserved
frame time 0.035..0.065 ms per sampled crossing frame (openworld lab,
GPU-reference backend, this machine; not a cross-machine threshold)
```

Native test counts: region 12, stream 5, impostor 3, hierarchical visibility 3.
Agent test: `tests/agent/re2d_huge_world_test.py`.

## Honest limits / required hooks

* No asynchronous disk I/O: residency/promotion/upload happens incrementally with
  budgets, but scene payloads are still loaded by the existing loader.
* GPU upload is accounting data only; the GPU owner must map RESIDENT+dirty items
  to real texture/atlas uploads and honour EVICTABLE eviction.
* Light LOD computes policy and counters; the existing GPU light masks still
  submit the authored visible set. The renderer must consume
  `lodCulledLights` / per-band light budgets to actually drop far lights.
* Occluder culling is a conservative 5-sample region test, not per-pixel/GPU
  occlusion; hint planes are still compiler-only visibility splits.
* Decal residency is counted per region but the actual decal draw call remains the
  existing global span path; the renderer should consume `lodCulledDecals` and
  `cell_allowed` to skip work.
* Region-local rendering is exposed as data (origin/local conversion); the GPU
  vertex path must use it to remove far-from-origin float precision issues.
* Largest maps are capped by the existing cell/portal limits (65536) and the
  region grid cap (4096x4096 cells of grid); larger worlds need a coarser
  `region_size` (metadata is honored).
