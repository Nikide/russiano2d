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

Hint/skip are compiler tool materials. A hint brush touching a generated portal
now emits a concrete `R2D_WALL_TOOL_HINT`-only barrier marker exactly on that
portal; runtime visibility cuts VIEW traversal through it and exposes
`visibility.hintMarkers / hintPortalsTested / hintPortalsCut` counters. The
barrier is view-only (no render/collision/ray/acoustic bits), so it reduces
portal/region work without changing gameplay. This is not full BSP hint-plane
insertion; `skip` remains metadata (see docs/RE2D_BRUSH_AUTHORING.md).

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
* pinned/visible-demand items (`pinned`/`demand` flags) outrank ordinary
  payloads: they are promoted without the ordinary promote budget, are never
  demoted or evicted, and form the soft residency cap when they alone exceed a
  budget;
* `0` upload budget means "no upload this frame"; residency budget `0` means
  unlimited. The public `world.streamConfig()` maps `0` to unlimited for all of
  its fields (new API only; legacy `regionConfig`/`regionBudget` keep the old
  contract);
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

### GPU upload/evict wiring (task-12)

The SDL_GPU world pass now consumes the cache instead of eagerly uploading every
material texture at init:

* stream ids `material*4+slot` (kind TEXTURE, slot 0=albedo/1=normal/2=emissive)
  map to `WorldGPU.textures[material][slot]`;
* RESIDENT/EVICTABLE -> create the real SDL_GPU texture once and count
  `gpuStreamUploads/Bytes`; UNLOADED -> `r2d_texture_free` and count
  `gpuStreamEvictions`;
* a visible material is demand-loaded so a visible surface never samples white
  while its region is still PRELOAD; hidden materials still follow the cache;
* atlas residency gates `ActorGPU` uploads (stable `stream_id`, kind ATLAS);
  non-resident atlases release the GPU frame texture and are skipped; the
  matching contact/ground shadow is suppressed (`groundShadowsSuppressed`) so a
  shadow is never left without its sprite;
* `r2d_world_stream_set_hook()` is installed by the GPU owner and counts every
  residency transition (`gpuStreamTransitions`), so loaders/uploaders do not
  need to poll the cache.

Remaining honest limitation: this is deterministic incremental residency, not
async disk I/O; placement/eviction is real on SDL_GPU, disk loading still uses
the existing loader. EVICTABLE copies stay GPU-resident for visual continuity
until the cache actually evicts them (UNLOADED).

### Visible-demand atlas residency + diagnostics (BASHNYA 1.2.11 report)

BASHNYA reported visible flat-atlas sprites disappearing while their contact
shadows remained, with `streamEvictions` every frame and only 82/138 atlases
resident. Root cause on the engine side: atlas residency had no visible-demand
input and no public budget/pin/diagnostic surface, and atlas stream ids were the
registration array index, so unregister/re-register churn could leave stale
residency state for a different atlas. Fixed additively:

* **stable atlas stream ids** (`next_atlas_stream_id`, `R2DWorldAtlasActor.stream_id`)
  and removal of the stream item on `world.remove(node)`; the GPU actor gate and
  the cache now agree even when the atlas registry shifts down;
* **visible demand** is derived natively every frame from the previous frame's
  visible atlas actors (no per-frame JS calls): those items are demand-pinned,
  force-promoted ahead of preload/distant payloads, touched for LRU and never
  evicted. If the pinned set exceeds `residentBytes`/`residentItems` it stays
  resident as a reported soft cap (`over_budget_bytes/items`);
* **grounding gate**: a visible atlas that is not RESIDENT/EVICTABLE is not drawn
  (existing GPU gate) and its contact/ground card is skipped as well;
* **diagnostics**: bounded native warning ring
  (`R2D_WORLD_STREAM_WARNING_LIMIT` = 64, one entry per atlas episode: path,
  bytes, cell/grid, image size, node id, state, eviction reason, frame) plus
  cumulative counters in `world.info()`;
* **public API** (`world.streamInfo/streamConfig/atlasPin/streamWarnings/
  takeStreamWarnings`, see `docs/highlevel/re2d.md`). Path pins are sticky: a `world.atlasPin(path,true)` issued before the atlas
  registers is kept in a bounded 64-path pending set (`streamInfo().pinsPending/
  pinPaths`) and applied on registration, so streamed populations do not warn on
  their first visible frame. `streamInfo().atlases`
  reports per-atlas `path/bytes/state/pinned/demandPinned/refs/visibleRefs/
  lastEvictFrame/reason`; `streamConfig` sets budgets (`0` = unlimited) and
  `atlasPin(pathOrId,on)` protects an authored PNG path or atlas id.

Measured acceptance (`tests/agent/re2d_atlas_residency_test.py`, generated game
under `build/`, 50 atlas sprites × 1024×1024 PNG = 200 MiB decoded accounting,
4 MiB / 4-item residency budget, 4 promotions/frame):

* first frame: 46/50 visible atlases not resident, 8 actor draws, 46 suppressed
  ground cards, structured `R2D_ATLAS_NOT_RESIDENT` errors naming path+node;
* frame 2+: visible demand promotes all 50, `visibleAtlasBlocked=0`,
  `overBudget=1`, 50 demand pins, 100/50 actor draws (base + span-filtered pair);
* 300 fixed-dt frames with camera motion and per-frame shot events: 0 blocked
  frames, 0 suppressed shadows, no visible sprite lost, pinned non-visible
  atlas stays resident;
* `streamConfig({residentBytes:0, residentItems:0})`: no evictions,
  `overBudget=0`, `streamInfo` reports budgets as 0;
* native cache coverage: `tests/re2d/stream_residency_test.c` (6 Unity tests:
  pin beats LRU, visible-demand soft cap, eviction preference/reason, budget 0
  unlimited, deterministic promotion order, unregister/invalid input).

### Shared decoded pixels (path dedup) and atlas sets (1.2.12)

`world.sprite` decoded RGBA is now shared per unique canonical PNG path
(app/VFS-resolved) inside a refcounted image cache (`src/re2d_world_atlas.c`):

* one RGBA buffer per unique path and cache generation, regardless of how many
  registrations reference it or how their grid/cell/pivot metadata differs;
  tiled sets share per tile path;
* refcount release on `world.remove`, `r2d_world_atlas_unregister`, scene
  dispose and reload; the buffer is freed only when the last registration goes.
  Hot reload/`reloadJSON` bumps the cache generation: new registrations decode
  the file again while live actors keep their (still referenced) buffer;
* stream accounting stays unique: the first registration accounting a shared
  image owns its `stream_bytes`, aliases count 0, and ownership transfers to a
  surviving registration on unregister. `residentBytes` therefore does not
  double-count shared pixels;
* diagnostics: `streamInfo().decodedUniqueBytes` (live decoded bytes),
  `decodedSavedBytes` (bytes avoided by sharing), `dedupHits`, and per-atlas
  `sharedRefs`/`pixelBytes`/`streamBytes`. `world.info().atlasesResident`
  remains the per-registration residency count.

Measured (`tests/agent/re2d_atlas_tiling_test.py`): 100 sprites on one
2048×2048 PNG → decodedUniqueBytes 16 MiB (one buffer) instead of 1.6 GiB,
decodedSavedBytes 1.55 GiB, dedupHits 99, 100 sharedRefs, sum of streamBytes
16 MiB, no residency warnings; a distinct 256×256 path stays separate.

Atlas sets (logical sheet >4096) are an authoring feature, see
`docs/highlevel/re2d.md`:

```js
world.sprite(node, {
  atlas: { files: ['a.png','b.png','c.png'],
           tile: { width: 2048, height: 2048, columns: 3, rows: 1 } },
  columns: 48, rows: 1, directions: 1, cell: { w: 128, h: 128 },
});
```

`files` is row-major and must be exactly `tile.columns*tile.rows`; every tile is
exactly `tile.width×tile.height` (≤4096 per side); the logical sheet may be up
to 65536 per side and a single cell may straddle tile boundaries. The C crop
handles tiling with identical flip/pivot/blend/masking; the GPU still receives
one cropped frame, so no shader change. Invalid/ragged tile sets and single PNGs
>4096 are typed errors (`RangeError`), never silent fallbacks.
`streamInfo().atlases[].path` for a tiled registration is the joined tile list
(`'a.png+b.png+...'`), with the full list in `tiles`; `atlasPin(path)` matches a
tiled registration when any of its tile paths match.

Sticky path pins are capped by `streamConfig({pinLimit})` (default 64, `0` =
unlimited up to 4096). Lowering below the current pending count is rejected with
`RangeError`; `streamInfo().pinLimit/pinsPending/pinPaths` expose the state.

Limits: residency is deterministic incremental bookkeeping, not async disk I/O;
the decoded cache is world-local (not shared across independent worlds), and hot
reload keeps old buffers alive for actors that were not re-registered.

### Async atlas prefetch (deterministic contract, 1.2.13)

Optional layer that hides PNG **file reads** behind one worker thread. Default
OFF; enabling never changes pixels, frame content, ordering or warnings.

```js
world.atlasAsync(true);                       // getter without an argument
world.atlasPrefetch('atlas/imp.png');         // token > 0, 0 = already/limit
const p = world.atlasPrefetchInfo();
// { enabled, workers, pending, ready, consumed, failed, entries,
//   bytesPending, bytesReady, limitBytes, requested, consumedTotal,
//   failedTotal, bytesRead, readMs, error,
//   paths: [{path, token, state, bytes, error}] }
world.atlasPrefetchClear();
```

Contract:

* the worker performs **file I/O only** (stdio). PNG decode stays on the main
  thread via SDL_image; no SDL/QuickJS/GPU calls happen off-thread (same class
  of bug as the 2026-10-18 Metal profiler crash);
* `world.sprite`/atlas sets look up the exact canonical path before the
  synchronous read. `ready` → the same bytes are decoded and the entry becomes
  `consumed`; `pending`/`failed`/absent → the existing synchronous read path
  runs (identical bytes, identical output), then the shared dedup cache applies
  as usual;
* a file whose size/mtime changed after the prefetch is rejected and read
  synchronously — stale bytes never replace a frame;
* missing/corrupt PNG: the prefetch record reports `state:'failed'` with the
  error; registration fails exactly as it does without prefetch (no new
  warnings, no silently wrong image);
* async completion timing cannot affect a frame — that is why `pending` is not
  waited on during registration.

Bounds: 64 entries, 256 MiB total pending+ready bytes, 64 MiB per file.
`atlasPrefetch` returns `0` for already-pending/ready, disabled, or exceeded
budget (diagnostic in `info.error`); a packed payload (VFS) file is already in
memory and is provided as `ready` without a thread.

Lifecycle: worker is created lazily on the first `atlasPrefetch`, stopped by
`atlasAsync(false)`/shutdown, joined by `world.dispose`/`re2d` shutdown; buffers
are freed on consume/clear/dispose. `atlasPrefetchInfo()` keeps working after
clear/disable. Dedup/tiling/residency accounting (`streamInfo`) is unchanged.

Measured (see `tests/agent/re2d_atlas_prefetch_test.py`): generated game, four
distinct atlas PNGs registered with prefetch off vs prefetch on+ready produce
byte-identical screenshots; prefetch not ready falls back with identical output;
120 moving-camera frames identical; registration time and the file bytes
avoided are reported, and only the synchronous file read time is saved (decode
and GPU work are unchanged).

### True payload streaming/residency (task-15)

`src/re2d_world_stream_io.c/.h` moves real per-region payload bytes, not just
bookkeeping. One descriptor per (region, kind):

```text
cells / walls / spans / surfaces / materials / nav
UNLOADED <-> QUEUED_LOAD -> LOADING -> RESIDENT <-> EVICTABLE -> QUEUED_UNLOAD -> UNLOADED
```

* `r2d_world_stream_io_add()` registers caller-owned source/destination buffers;
* `acquire/release` are refcount pins; `set_required()` is the active/preload ring
  contract: required payloads load and stay resident, dropping the requirement
  queues an unload;
* every `tick()` copies at most `load_budget_bytes`/`load_budget_items` and frees
  at most `unload_budget_items`/`unload_budget_bytes`, so a region crossing is
  sliced over frames instead of copying a whole region in one frame;
* `read` callback (file/mapped memory), `evict` callback (free caller copy) and
  optional `alloc` callback (fresh destination for a reload) are exposed; the
  module never starts a thread itself. Deterministic incremental execution is
  the async contract; a worker backend can share the same descriptors/queues.
* tokens change on every UNLOADED transition so a stale pointer can be rejected
  without dereferencing freed memory.

Runtime integration (`R2DWorldRuntime.stream_io`): after regions are built the
runtime allocates index packets per region/kind (cells, unique incident walls,
spans, surface ids, material ids, nav placeholder) and registers them. Each
frame after `update_active()` it derives the required mask from
ACTIVE/PRELOADING/RESIDENT states, calls `set_required()` and ticks with a
64 KiB / 8-item load and unload budget. Unloaded packets are actually freed and
reloaded on return. Master `R2DRe2dWorld` arrays remain the correctness fallback
for collision, trace, visibility, render, nav and audio, so an unloaded region
can never leave a dangling pointer in those systems; queries outside the
resident ring still work exactly as before.

`world.info()` exposes: `streamIoPayloads`, `streamIoResidentPayloads`,
`streamIoLoadingPayloads`, `streamIoQueuedLoad/Unload`,
`streamIoResidentBytes`, `streamIoLoadBytes/UnloadBytes`,
`streamIoLoads/Unloads`, `streamIoTotalBytes`, `streamIoMaxTickBytes` (peak
bytes in one tick) and the configured budgets `streamIoLoadBudgetBytes /
streamIoUnloadBudgetBytes`. `regions` also carries `payloads`,
`payloadResident`, `payloadResidentBytes`, `payloadLoads`, `payloadUnloads`.

Measured on the shipped openworld lab (25 regions): 150 payload packets
(25*6), 48 resident in the active/preload ring (8 regions), 1080 resident bytes;
crossing to region 24 unloads 48 packets and keeps the destination 24 resident
(4 regions); returning reloads them; peak tick movement 540 bytes against a
65536-byte budget. Native `tests/re2d/stream_io_test.c` (8 tests) additionally
covers slices, priority order, refcount pinning, unload budgets, stale tokens,
read failure, determinism and required-toggle unload/reload.

Task-15 limits: no worker thread or real filesystem read is started (the
callbacks are the integration point); BSP/surface/material/nav master arrays
still exist for correctness fallback, so the memory saved is the per-region
packets, not the whole world; nav fragments are a registered placeholder until
the nav split lands; GPU texture/atlas upload/evict remains owned by the renderer
stream cache/hook from task-12.

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

GPU consumption (task-12):

* light masks are rebuilt per draw by `r2d_world_region_lod_select_lights()`;
  lights outside the configured band are dropped from the shader light arrays,
  shadow slots are capped by `max_shadow_lights` (`gpuLightsCulled`);
* decals are skipped when their owning cell is outside `cell_allowed` and by the
  distance decal percentage (`gpuDecalsCulled`);
* atlas direction selection re-quantizes to the LOD direction count
  (`gpuSpriteDirReduced`), while animation FPS caps already defer pose/crop work;
* impostors and particles use the same LOD policy as the CPU budgets.

Counters: `lodHiddenActors`, `lodThrottledActors`, `lodHiddenAtlas`,
`lodCulledLights`, `lodCulledParticles`, `lodCulledDecals`, `audioRegionCulled`,
plus GPU-side `gpuLightsCulled`, `gpuDecalsCulled`, `gpuSpriteDirReduced`.

Config: `r2d_world_region_lod_config()` (native) with validated monotonic bands.

## Distant impostors

`src/re2d_world_impostor.c/.h` bakes one vertical silhouette card per occupied
region from its cells/spans: world centre, region-local centre, width/height,
bottom/top, average floor tint, cell/span counts. Collection is
nearest-first and skips the current region, PVS-invisible regions, occluded
regions and cards beyond `max_distance`.

### Near-band gate (BASHNYA 1.2.6 fix)

A card must never be emitted inside the region-LOD near band: that region is
still drawn by the local renderer, and a coarse card on top of it produces the
duplicate/torn silhouette the reporter saw on a small map with default 512-unit
regions. The runtime derives the collector's `min_distance` from the policy with
`r2d_world_region_impostor_min_distance(config)`:

* `near_distance > 0` -> cards are rejected closer than the near band
  (default 600; BASHNYA `regionLod(8000, ...)` rejects everything within 8000);
* `near_distance == 0` -> no near gate, only reachable by an explicit
  `world.regionLod(0, ...)` or a native config with `near_distance = 0`;
* `max_distance` still follows `hidden_distance` (default 6000), so the card
  range is `[near, hidden]`.

The gate keeps cards out of the band where the local renderer draws the region
at full detail; beyond the band they remain the intended additive distant
stand-ins. `world.regionConfig(8192,1,2)` collapses a
small map to one region, so the existing current-region skip alone already
yields zero cards; that is a configuration outcome, not the fix. Native coverage:
`tests/re2d/impostor_lod_policy_test.c` (gate follows the near band; cards inside
the band suppressed, cards beyond it kept, ungated collect = old 1.2.6 output).

Renderer-facing API:

* native: `r2d_world_visible_impostors(runtime, &count)` and the
  `world.info().visibleImpostors / impostorCount` counters;
* JS: `world.impostors()` returns the cards with `region,x,y,localX,localY,
  width,height,bottom,top,color,distance,cells,spans`.

GPU implementation: `region_impostors_draw()` draws each card as one
depth-tested, alpha-blended vertical quad before local actors; `gpuImpostorsDrawn`
counts them. Cards use the region-local centres/colours from the native bake.

## Large coordinates / region-local rendering

`r2d_world_region_render_origin()` returns the current region centre, and
`r2d_world_region_local()` converts world XY to region-local XY. The runtime
exposes `renderOriginX/Y/Region` in `world.info().regions` and
`world.regionLocal(x,y)`.

The SDL_GPU pass subtracts that origin from every world-space uniform: camera
eye, wall/span shape, span bounds, light positions and the baked ambient-field
rectangle; the shadow geometry buffer is shifted on upload and the shadow cache
key includes the origin. CPU/visibility/trace/save stay in world coordinates.
`gpuOriginX/Y` and `gpuRenderOriginActive` expose the active shift.

Boundary test: moving the camera 12 units across a region edge in the compiled
openworld lab changes the origin but keeps the frame continuous (mean channel
difference 0.06/255, 921600 lit pixels, no black frame).
`world.regionLod(near,mid,far,impostor,hidden)` exists for deterministic
culling tests. Gameplay, trace/blocked/support and save IDs stay in world
coordinates. No double accumulation is performed in the region module.

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

### Runtime hint/skip/occluder consumer (task-20)

`src/re2d_world_hint.c/.h` is the runtime-side counterpart of the compiler
markers. It reads only authored wall metadata, never the compiler internals:

| source marker | runtime meaning |
|---|---|
| `R2D_WALL_TOOL_HINT` zero-policy wall on a portal edge | cuts view traversal through that portal; collision/rays/render unchanged |
| `R2D_WALL_TOOL_SKIP` | compiler-only; counted and ignored at runtime |
| `R2D_WALL_OCCLUDER` wall segment | conservative coarse cell/region occlusion |

Contract: the compiler emits one hint marker exactly on the portal plane/range
and one occluder segment per authored occluder wall; both are ordinary
`R2DWorldWall` entries, so existing JSON/RDW5 bake carries them without a new
format. If compiler markers are absent (legacy maps), caches are empty and
behaviour/counters are unchanged.

Caller-owned cache (no allocation at query time):

```c
int hints, skips, occluders;
r2d_world_hint_counts(&world, &hints, &skips, &occluders);
R2DWorldHintBarrier barriers[hints];
R2DWorldOccluder segments[occluders];
R2DWorldHintCache cache = { .barriers=barriers, .barrier_capacity=hints,
                            .occluders=segments, .occluder_capacity=occluders };
r2d_world_hint_cache_build(&world, &cache, err, sizeof err);
r2d_world_visibility_filtered_ex(&world, &view, ortho, &vis,
                                 cell_allowed, &cache);
```

`r2d_world_visibility_filtered()` is unchanged and uses the legacy NULL-cache
path. The `_ex` variant adds:

* per-portal hint barrier cut before traversal, counted in
  `vis.hint_portals_tested` / `vis.hint_portals_cut`;
* pre-traversal occluder cell reject (`vis.occluder_cells_tested/_cut`,
  `vis.culled_cells`), applied before BSP/portal submission;
* `vis.hint_markers`, `vis.skip_markers`, `vis.occluder_segments` for agent
  debug snapshots.

Region layer: pass `cache.occluders` / `cache.occluder_count` to the existing
`r2d_world_region_occluded()` / `r2d_world_region_visible_set()` coarse pass.
Tests: `tests/re2d/hint_cache_test.c` (6 Unity tests: hint cut, skip ignored,
legacy identical, occluder cell culling with counters, coarse region culling,
determinism/invalid args).

Compiler contract status: the SDK brush compiler emits both kinds of markers.
`R2D_WALL_TOOL_HINT` barrier walls are emitted per hint-covered portal (18 on the
open-world lab map) and `R2D_WALL_SKIP` is compiler-only. `R2D_WALL_OCCLUDER`
walls are emitted one per authored occluder footprint edge with stable
`brush.occluder<index>_e<edge>` ids and zero other policy bits. On the shipped
open-world lab this gives `occluderWalls=8` (2 occluder brushes x 4 edges),
`hintWalls=18`, and the runtime reports `regionOccluderCulled=16` at the west
spawn (39 cells allowed -> 11); the native cache/visibility test additionally
checks `occluderCellsCut >= 1`. Legacy maps contain no markers, build an empty
cache and keep identical visibility/counters. Markers use the existing wall
array and RDW5 bake; no side table or runtime format change.

## Measured metrics (openworld lab, shipped `.re2dworld`)

```
regions 25, 8x8 compiler grid @ 256 (metadata honored at runtime)
coarse region PVS edges 600
vis cluster edges 702 (4 cells/cluster)
occupied cells 39, portals 65, areaportals 21
occluderWalls 8 (2 authored occluder brushes x 4 edges)
hintWalls 18; runtime regionOccluderCulled 16 at west spawn
agent region walk: regions 0,1,4,17,19,23,24; active 1..5; culled 13..21
impostor cards visible (all distant visible regions) 24 (budget <= 64)
stream simulated resident bytes 9280 (region BSP/surface payloads)
regionConfig(256,1,2,131072,2) accepted, current region preserved
frame time 0.035..0.065 ms per sampled crossing frame (openworld lab,
GPU-reference backend, this machine; not a cross-machine threshold)
```

Native test counts: region 13 (includes pure LOD light-selection), stream 5,
impostor 3, hierarchical visibility 3, hint/occluder consumer 6. Agent test:
`tests/agent/re2d_huge_world_test.py` (GPU stream upload/evict/re-upload, origin
boundary screenshots, tightened LOD light/decal culling, impostor draw count).
GPU metrics from the current lab run: `gpuStreamUploads` 1 (16 KiB texture
uploaded on the stream RESIDENT transition), `gpuTexturesResident` stays 1
across region crossings even with a 1-byte residency budget (visible materials
are demand-loaded; no per-frame upload thrash), `gpuStreamTransitions` > 0 via
the hook, `gpuLightsCulled` 1 and `gpuDecalsCulled` 1 under tight LOD bands,
`gpuImpostorsDrawn` 7/24 visible cards, render-origin boundary mean diff
0.06/255. `gpuStreamEvictions` is 0 on this fixture because the only material is
shared by visible geometry; the free-on-UNLOADED path is implemented in
`gpu_stream_sync()` and exercised by the stream state-machine tests when no
visible surface demands the payload.

## Honest limits / required hooks

* No asynchronous disk I/O: placement/promotion/upload happens incrementally
  with budgets, but scene payloads are still loaded by the existing loader.
* Texture/atlas upload is a real SDL_GPU operation on RESIDENT transitions and
  release is real on UNLOADED; EVICTABLE copies are kept for visual continuity
  until the cache actually evicts them. Shared material textures used by visible
  surfaces are demand-loaded, so their GPU eviction needs a frame where no
  visible surface uses them; BSP/surface/material/nav payloads remain runtime
  memory state (not streamed from disk).
* Known pre-existing gate: `tests/agent/re2d_dust2_test.py` CPU/GPU reference
  parity fails at wave-2 (orange hand/haze diverge before task-12): disabling
  every task-12 visual path leaves the same 32.6429518% >3 diff. Task-12 did not
  introduce this; it needs the renderer owner's GPU-visual features and the CPU
  reference to agree again.
* Light LOD now drops lights from the actual shader masks; shadow slots are
  capped. Far-band lights keep a reduced budget (8) so existing CPU/GPU
  reference parity on medium maps is not changed. Sprite direction LOD only
  applies to atlas actors (RotSprite poses use FPS/pose budgets).
* Hint/skip walls are rendered/not-rendered by authored policy bits. The brush
  compiler now emits real per-portal hint barrier markers and runtime visibility
  cuts traversal through them (`hintPortalsCut`); true BSP split-plane insertion
  is still not implemented and is documented as a limitation, not faked.
* Occluder culling is a conservative 5-sample region test, not per-pixel/GPU
  occlusion; hint barriers cut only their covered portals, not the whole BSP.
* Decal residency is counted per region but the actual decal draw call remains the
  existing global span path; the renderer should consume `lodCulledDecals` and
  `cell_allowed` to skip work.
* Region-local rendering is exposed as data (origin/local conversion); the GPU
  vertex path must use it to remove far-from-origin float precision issues.
* Largest maps are capped by the existing cell/portal limits (65536) and the
  region grid cap (4096x4096 cells of grid); larger worlds need a coarser
  `region_size` (metadata is honored).


## Scaling benchmark and gameplay-boundary acceptance (task-26)

Reproducible command:

```bash
python3 tests/agent/re2d_huge_scaling_test.py
```

It tiles the authored open-world fixture into 1x/2x/4x map-size variants
(deterministic grid copies at fixed offsets, generated under
`tests/agent/results/scaling/`), loads them through the normal
`$.re2dWorld.load()` path with a **fixed** `regionConfig(256,1,2,65536,4)`
active/preload ring, teleports to the same world anchor, and samples 24 frames.
It writes `tests/agent/results/re2d_huge_scaling_report.json` and
`tests/agent/results/huge_scaling.csv`.

| map | cells | regions | active | preload | visible surfaces | GPU draws | frameMs | visibilityMs | surfaceMs |
|---|---|---|---|---|---|---|---|---|---|
| 1x | 39 | 13 | 4 | 4 | 7 | 3 | 0.092 | 0.0046 | 0.0847 |
| 2x | 78 | 26 | 4 | 4 | 7 | 3 | 0.104 | 0.0057 | 0.0922 |
| 4x | 156 | 52 | 4 | 4 | 7 | 3 | 0.106 | 0.0051 | 0.0955 |

Tolerances asserted by the test: visible surfaces and GPU draws within 25%
(or 4 units), frameMs <= 1.5x base + 0.5 ms, visibilityMs <= 1.5x + 0.25 ms,
surfaceMs <= 1.5x + 0.5 ms, active/preload ring within +2 regions. Result: cost
stays flat while the total map grows 4x (renderer cost depends on the visible
region set, not total map size, per roadmap 123).

Gameplay boundary (dust2, `regionConfig(512,1,1,...)`): navigation graph 316
nodes and a 12-span path before crossing; the controller walks/jumps with finite
state; crossing to another room unloads old payloads (`streamIoUnloads 0 -> 24`)
while master-world fallback keeps `support`/`blocked` true and the same 12-span
nav path available for the now-unloaded area; 6 actors remain registered; the
crossing frame stays at ~0.34 ms. Save/load: `re2dOpenWorld.saveState()` taken
while payloads are unloaded, then a full `loadMap()` reload, keeps the same map
hash (`b95815af707fc882`) and semantic cell `brush.cell0 -> 0`, and
`loadState()` applies successfully; region runtime remains alive after reload.

Limits: the scaling fixture is a deterministic tiling of the authored map (not a
new giant unique map), so it proves renderer/streaming scaling rather than
authoring scale; measurements are on one machine/GPU-reference backend and are
reported as medians, not cross-machine thresholds; the gameplay boundary uses
the existing dust2 demo controller/nav/actor registries, and master arrays remain
the correctness fallback for unloaded regions (see task-15 limits).
