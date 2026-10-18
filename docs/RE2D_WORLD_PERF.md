# Re2D World: производительность и измерения

Редакция 2026-10-10. Текущий renderer — native C + SDL_GPU. GPU world raster и CPU Re2DSprite pose synthesis — разные части кадра. Исторический отчёт прежнего CPU World сохранён отдельно; он не описывает новый renderer.

## Финальный static stress

Provenance: Apple M4, macOS27.0.1 arm64, AppleClang Release, SDL_GPU Metal, native400×240, seed7, warmup8/sample20. Sprite nodes static; initial synthesis unlimited, poseStep0. GPU completion fence waited; FINAL output без framebuffer readback. Modified checkout baseline HEAD8011294b01330420ec12c903dfd9041834a6ecfe, binarySHA256 `6ebf56e995b3f68329c35c8993913dfbf0c96968762103ff2451c2524ff7364c`. Full recorded report: [JSON](re2d/RE2D_RENDERER_BENCHMARK.json).

| Сцена | Visible / total cells | Visible surfaces | Relevant / total lights | Видимые / все спрайты | Warm median ms | Cold frame ms |
| --- | --- | --- | --- | --- | --- | --- |
| A | 16 / 100 | 166 | 8 / 8 | 9 / 10 | 1.056667 | 144.995750 |
| B | 30 / 500 | 486 | 12 / 64 | 29 / 30 | 1.733438 | 444.015333 |
| C room-over-room | 16 / 80 | 167 | 16 / 128 | 15 / 50 | 1.659104 | 254.589333 |

Первичный синтез ракурсов спрайтов: A126.580250/B411.129250/C232.270042ms. Warm static cache не включает постоянную animation resynthesis. Это native world frame time с fence, не displayed FPS и не whole application frame budget. Scene C содержит16 shadow candidates. Полные totals/surfaces/stages/parameters сохранены в JSON, не выводятся из таблицы приблизительно.

BSP visits23/34/29; draws302/1044/314; adjacent sampler batches10/30/16. Binding batches не означают столько же draw calls. GPU draws — specialized fullscreen triangles, не generic scene triangles.

GPU texture payloads A21,562,376/B63,505,416/C34,145,288bytes; buffer/download payloads A1,922,048/B1,922,048/C1,947,424bytes. Эти resident payload categories исключают allocator/driver/temporary/shared resources; их нельзя называть total VRAM/process memory.

## Анимированные персонажи

Earlier unbudgeted animated GPU stress в том же ходе работ дал A135.863/B433.309/C227.574ms; CPU pose synthesis занимала примерно131/421/219ms. Эти значения исторические для recorded промежуточного build, не fresh measurement финального binary. Они объясняют, почему нельзя подменять animated throughput static warm цифрами.

Default `world.quality({poseBudget:1,poseStep:3})` ограничивает dirty synthesis и распределяет её round robin. Спрайт, синтез которого отложен, использует готовый ракурс, animation clocks продолжаются. Budget0 unlimited; step0 unquantized. Снижение pose refresh — visual quality tradeoff, не бесплатное ускорение. Attachment candidates тоже потребляют budget.

## Что оптимизировано

Native visibility следует reachable spans/portal windows и active near-first XY BSP branches. Light masks/per-light reached-span lists ремонтируют dirty links, не пересканируют все cells на unchanged frame. Baked topology/static associations избегают authoring build при compiled startup.

Retained scratch: visibility/frame/light/touched/sort buffers, shared anime supersampling arena. GPU-кэш спрайтов использует монотонный ID экземпляра, ревизию и размер; повторное использование адреса памяти не вызывает коллизии кэша. Shadow chunks local per-light invalidation; atlas repacks/uploads whole after relevant change. Adjacent equal material samplers reused without geometry order changes. Эти оптимизации сохраняют constrained authoritative model.

## Воспроизвести

Из checkout после Release build, на свободной машине:

```sh
python3 tools/bench_re2d_world_renderer.py --backend gpu --frames 20 --output build/re2d_world_renderer_gpu_benchmark.json
python3 tools/bench_re2d_world_renderer.py --backend cpu --frames 20 --output build/re2d_world_renderer_cpu_benchmark.json
```

Script drives agent protocol; measured workload reports native counters, not Python loop execution. Output captures machine/commit/working-tree/binary digest/resolution/quality/cold frame/warm stages. Benchmark tool currently hashes build/russiano2d; для сопоставимого прогона используйте этот binary и не задавайте другой agent binary через environment. LoadWallMs и ColdAgentStepWallMs включают transport; они отличны от frameMs.

```js
world.profile({gpuWait:true});
world.quality({poseBudget:0,poseStep:0});
const sample=world.info(); // читать после фактического render/frame
```

GPU timing fields — CPU wall/cache construction/submission/fence wait, не hardware timestamp. FrameMs без gpuWait не ждёт GPU. Debug capture/readback дороже FINAL; измеряйте выбранный mode явно. Не меняйте golden baseline ради performance результата.

## Что пока не подтверждено

Hosted Linux/Vulkan run, fresh Web/WASM build, arbitrary animated50 actor60FPS и другие hardware/resolutions не подтверждены этим benchmark. CPU/GPU parity и local correctness checks не заменяют platform performance measurements. Диагностика и полный profiler snapshot — в [runtime reference](re2d/RE2D_WORLD_RUNTIME.md#диагностика-и-полный-profiler-snapshot). Отчёты о реализации и аудите приёмки — внутренние документы движка, в поставку SDK не входят.

## P4 benchmark lab: native numbers (2026-10-17)

Сцена: `demos/re2d_bench_lab`, сценарий `re2dBench.apply(...)`,
`world.profile({gpuWait:true})` (frameMs включает ожидание GPU fence),
RelWithDebInfo, macOS arm64, Metal, window 1280×720, world frame 640×360.
Числа — один прогон `tests/agent/re2d_bench_lab_test.py`; это baseline, не
обещание: перед изменением renderer'а гоняйте тот же сценарий.

| Сценарий | actors | lights | particles | draws | frameMs | visibilityMs | surfaceMs |
|---|---:|---:|---:|---:|---:|---:|---:|
| base | 0 | 4 | 0 | 24 | 0.88 | 0.0005 | 0.88 |
| actors_100 | 100 | 4 | 0 | 186 | 1.32 | 0.001 | 1.30 |
| lights_32 | 0 | 36 | 0 | 24 | 0.84 | 0.0009 | 0.84 |
| particles_2000 | 0 | 4 | 2000 | 1048 | 2.97 | 0.001 | 2.96 |
| portals (dust2) | 0 | 35 | 0 | 88 | 0.59 | 0.0075 | 0.58 |
| movers (dust2) | 0 | 35 | 0 | 171 | 0.92 | 0.019 | 0.90 |
| worstcase | 100 | 36 | 2048 | 1210 | 3.86 | 0.001 | 3.83 |

Читать так: particle/actor draw submission доминирует в worstcase; visibility
и actor synthesis — доли миллисекунды. GPU-числа здесь — время ожидания
fence на этой машине, а не гарантированный бюджет BASHNYA (§76 roadmap).

## BASHNYA issue #2: wall->span incidence cache (2026-10-17)

`surface_draw` раньше для каждой видимой стены перебирала **все** видимые
spans (`O(walls × spans)`), и это был единственный суперлинейный этап кадра.
Теперь `WorldGPU` один раз на `topology_revision` строит обратный индекс
`wall -> incident spans` (из `span_wall_refs`) и проверяет `span_seen`.

Замер на `BASHNYA level1` (960×540, headless, 120 кадров, `bashnya.benchmark`):

| | до | после |
|---|---:|---:|
| gpuDraws | 10 531 | 10 531 |
| frameMs p50 | 12.37 | **2.53** |
| frameMs p95 | 13.04 | **3.02** |
| surfaceMs | 11.15 | **1.94** |
| visibleSurfaces / spans | 2192 / 653 | 2192 / 653 |

Кадр до/после побайтово совпал (0 отличий), т.е. это CPU-оптимизация, не
изменение видимой геометрии. `world.info()` теперь отдаёт разбивку
`gpuDrawsBase/gpuDrawsSpan/gpuDrawsActor/gpuDrawsOther` (на старте BASHNYA:
1527 base / 8471 span / 532 actor / 1 other = 10531).

Дополнительно `set_scissor` возвращает false при пустом пересечении с active
clip rect: surface/actor/decal draws с нулевым scissor больше не отправляются
(важно для mirror-прохода). Причина высокого `frameMs` в отчёте BASHNYA
подтверждена как CPU incidence scan, а не число draw call'ов.

## R-01/R-02 visual pass (2026-10-17)

Workload: `demos/re2d_world_renderer_lab`, GPU reference, 1280×720 output
(400×240 world frame), 30 warm frames, `world.profile({gpuWait:true})`.
Current working tree, macOS arm64 / Metal, RelWithDebInfo. Numbers are a single
run and vary with machine load; they prove the pass does not add geometry.

| Tier | draws | frameMs median | frameMs p95 | changed pixels vs low |
|---|---:|---:|---:|---:|
| low (legacy + grounding) | 26 | 12.33 | 12.63 | — |
| high (all R-01/R-02) | 26 | 12.33 | 12.59 | 32.33% |

Visual features are shader uniforms/instructions only: no extra draw calls, and
the frame is dominated by the existing actor readback/composition on this lab.
Per-feature counters are in `world.info().visual` (contactShadows, footAo,
edgeActors, variedSurfaces, bevelSurfaces, fogSurfaces, hazeSurfaces,
liquidSurfaces, skyLayers, celestialDiscs, ...).

VFX pass (`tests/agent/re2d_render_vfx_pass_test.py`, same lab): one live card
adds `gpuDrawsVfx=1`; a live boss aura trail adds 3 trail segment draws
(`vfxTrailDraws=3`). Attribution stayed exact:
`Base+Span+Actor+Other+Ground+Vfx == gpuDraws` (50 == 50 in the trail run).
VFX draw submission is therefore bounded by live cards/trail segments, not by
registered bundle count.

`demos/re2d_bench_lab` current run (same build, GPU wait):

| Scenario | draws | frameMs |
|---|---:|---:|
| base | 24 | 0.88 |
| actors_100 | 263 | 1.64 |
| lights_32 | 24 | 1.31 |
| particles_2000 | 1048 | 3.57 |
| portals (dust2) | 88 | 0.62 |
| movers (dust2) | 143 | 0.77 |
| worstcase | 1287 | 4.91 |

BASHNYA level1 before/after could not be measured in this working tree: the
current in-flight world/region task makes the native map loader reject the
BASHNYA `.re2dworld` with `invalid wall/span geometry (-1)`, and the scripted
intro chain does not reach `level1` through the agent. Re-run the numbers above
plus the BASHNYA script after that integration lands; do not read the lab table
as a BASHNYA budget.

## P4/P5 renderer counters (task-7)

`info.visual` adds: `shafts` (additive light-shaft cards drawn), `weatherCards`,
`distantCards`, `ambientSamples`, `detailSamples`, `decals2`, `batchDraws`,
`batchBatches`, `batchSaved`, `residentTextures`, `uploadBytes`.

Native budgets are explicit and deterministic:

* light shafts: 0-8 cards/frame (`shaft_budget`, quality low 0 / medium 4 /
  high 6 / ultra 8);
* weather: <=96 cards per weather layer, <=8 stacked layers (hard cap), so the
  worst case is bounded at 768 procedural quads; high density defaults to 0.30
  and ultra to 0.55, which yields 28/52 cards for the shipped profiles;
* distant cards: 0-4 per frame;
* decals 2.0: constant 256-slot model (existing world decal pool stays 128);
* batching: consecutive material/blend/light/atlas keys coalesce, `batchSaved`
  counts avoided draw calls;
* residency: byte budget + per-frame upload byte budget; admission is
  deterministic (fits or queued as pending).

The CPU post references are O(w*h) plus a separable box blur and are used only
by the native regression harness, not in the frame loop.

## Final composite (task-11)

Adds one fullscreen post draw per FINAL frame (`postPasses`) plus a separate
post colour/owner/depth target (about 8 bytes/px extra GPU texture memory, now
included in `gpuTexturePayloadBytes`). Bloom-lite is 8 texture taps; heat uses
two extra depth taps only when enabled; reflection uses one mirrored colour tap
only on floor pixels. Debug views and the CPU backend do not run the composite.

## CPU/GPU parity fixes (2026-10-17, task-13)

Two root causes explained the six remaining
`tests/agent/re2d_world_renderer_test.py` failures. Both were implementation
divergences, not test tolerance:

1. **Shadow lookup in render-origin space.** After wave-3 added region-local
   render origin, the shadow cache upload rewrote wall XY starting at
   `header + 1 + i*2` (off by one; the first wall stayed unshifted and wall
   heights were shifted), while the shader compared shifted light/origin
   positions against the partially shifted cache. Three failures followed:
   moving floor/riser, upper height-aware shadows, lower wall/floor occlusion.
   Fix: shadow geometry now stays in **world coordinates**; the fragment shader
   adds `u.renderOrigin.xy` before `occluded()`. The upload rewrite and its
   per-origin chunk inconsistency are gone.
2. **Translucent/additive depth compare was ALWAYS.** The mirror/overdraw
   pipelines set `COMPAREOP_ALWAYS`, and translucent/additive pipelines were
   created afterwards without resetting it. Translucent glass and additive
   flashes therefore painted over nearer actors/decals regardless of depth:
   actor-between-glass, additive flash and bounded-decal parity failed. Fix:
   set `COMPAREOP_LESS_OR_EQUAL` before creating the translucent/additive
   pipelines (their depth test/write flags were already correct).

Evidence after the fixes (same build):
- `re2d_world_renderer_test.py`: **55 checks, exit 0** (6 failures before).
- `re2d_dust2_test.py`, `re2d_render_p4_test.py`,
  `re2d_render_visual_features_test.py`, `re2d_render_vfx_pass_test.py`: green.
- `r2d_check`: **158/158**; `ci_verify` and docs/API guards: green.

Files touched: `src/re2d_world_gpu.c`, `shaders/world.frag.glsl`.

## Static batching data path (P4)

`src/re2d_world_batch.c/.h` builds the deterministic batch plan used by the
renderer owner. It never submits draws; the existing `gpuDraws*` attribution is
unchanged.

Per frame the runtime rebuilds the plan from `R2DWorldVisibility`:

* groups key = `(material, blend, light_policy, atlas)`;
* group order = ascending key; ties broken deterministically by kind, surface,
  span, aux and tint;
* instances are packed as eight `uint32` fields (32 bytes, std430), groups as
  six `uint32` fields;
* counters: `groups`, `instances`, `saved_binds = instances - groups`,
  `surfaces/actors/skies`, `overflow`.

`world.batchInfo()` returns the current counters plus the GPU contract; the
same counters are exposed in `world.info().visual.staticBatch*`. Measurement:
`tests/agent/re2d_batch_info_test.py` on `demos/re2d_world_renderer_lab`.

## Region profiler split (task-22)

`world.info()` now exposes real CPU-clock region phases, measured with
`SDL_GetPerformanceCounter` in `r2d_world_regions_frame`:

* `regionLoadMs` — region grid ensure/build (normally 0 after the first frame);
* `regionVisibilityMs` — PVS, occluder/cluster culling and active/preload ring;
* `regionStreamMs` — residency state update (`r2d_world_stream_update`);
* `regionStreamIoMs` — budgeted payload load/unload tick (`R2DWorldStreamIO`).

Measured on `demos/re2d_world_renderer_lab` (GPU, 640 px): visibility
~0.0007 ms, stream ~0.001 ms, stream IO ~0.0004 ms per frame; values are
sub-microsecond at this map size. Debug overlays add one CPU pass over the
RGBA frame only while a debug view is active; FINAL frames are untouched.

### GPU batching measurement

`demos/re2d_world_renderer_lab`, medium quality, 2 visible cells: logical
surface draws 23 (11 base + 12 span variants) → 4 GPU group draws, 19 saved
draws, 23 SSBO instances. The image matches the per-surface path (parity suite
green); the only deliberate delta is a ≤5e-7 span-rank depth bias needed to keep
equal-depth wall span variants deterministic inside one instanced draw.

Commands:

```bash
python3 tests/agent/re2d_batch_gpu_test.py        # reduction + fallback
python3 tests/agent/re2d_world_renderer_test.py   # CPU/GPU parity
```

Fallback: `world.batchGpu(false)`; overdraw and non-final debug views always use
the per-surface path so debug attribution stays inspectable.

## BASHNYA issue #2 re-measure (1.2.7, 2026-10-18, task-3)

Workload: external BASHNYA `level1` through the read-only mirror
(`/tmp/bashnya-engine`, no game/engine source edits), agent-driven, world frame
960x540, GPU-reference backend, fixed start camera unless stated. Numbers from
the shared working tree, one machine (Apple arm64/Metal), medians unless noted;
they are directional, not a tag baseline and not a cross-machine threshold.
The world tier was set explicitly (`world.renderQuality('high')`); since 1.2.7
`world.quality({poseBudget})` no longer selects the visual tier.

### Draw attribution and CPU stages

| metric | value |
|---|---:|
| visible cells / spans / surfaces | 314 / 653 / 2192 |
| regions / cells allowed | 37 / 463 |
| `gpuDraws` (logical) | 10315 = 1527 base + 8471 span + 177 actor + 103 other + 37 ground |
| actual batched GPU groups | 8 |
| `staticBatchInstances` / `staticBatchSavedBinds` | 2192 / 2184 |
| CPU `frameMs` p50 (60 frames, no gpuWait) | 9.7 ms |
| `visibilityMs` p50 | 6.3 ms |
| `surfaceMs` p50 (submit/record wall) | 3.3 ms |
| `lightCullMs` / `actorMs` p50 | 0.17 / 0.03 ms |
| lights after cull / shadowed | 6 / 2 |
| reporter 1.2.6 comparison | 10987 draws / 12.4 ms frameMs p50 |

`gpuDraws*` is a **logical attribution** counter, not the number of GPU
submissions: 2192 logical surface draws are coalesced into 8 instanced groups by
the static batch plan (`batchGpu(false)` raises material binds 29 -> 992 with no
frameMs gain). Camera motion confirms the cost tracks visible surfaces, not map
size: open view `yaw -60` = 16.3 ms / 10312 logical draws; closed view `yaw 120`
= 0.44 ms / 58.

### Real GPU fence wait is separate

With `world.profile({gpuWait:true})` the same frame reports
`gpuCompletionWaitMs` ~109-115 ms at **low, medium and high** tier (CPU
`frameMs` stays ~9-10 ms). The reporter's 12.4 ms `frameMs` is CPU wall time and
must not be read as GPU time or FPS. The cause is **not proven**; a real GPU
timestamp method is required before calling it a GPU cost or an engine defect.
Control: the same `world.profile({gpuWait:true})` method on the small renderer
lab (`tools/bench_re2d_world_renderer.py --backend gpu --frames 20`, 400x240)
gives frame medians A 2.12 / B 5.37 / C 3.23 ms (166 / 486 / 167 visible
surfaces). The fence wait is therefore workload-specific (2192 surfaces at
960x540), not a constant harness/headless overhead, but its exact cost split
remains unproven.

### Safe reductions investigated

* fully-open portal-closure surfaces: 0 exposed as separate removable surfaces
  through `world.surface()`; baked closure geometry goes through the normal
  wall-solidity test, so there is no safe "skip open closure" filter to add;
* redundant selected surfaces: the 2192 logical surfaces are already batched
  into 8 groups; reducing the logical count would not reduce submissions;
* light x surface passes: only 6 lights survive culling (2 shadowed) and
  `lightCullMs` is 0.17 ms;
* batching: already active; turning it off does not improve frame time.

No draw-call reduction was shipped: none was measured to be both safe and
beneficial. The remaining CPU cost is the local portal-walk/visibility stage, and
the GPU fence wait needs a timestamp-based profile before any change is claimed
as a GPU speedup.

## Impostor near-band gate (BASHNYA 1.2.6, 2026-10-18, task-3)

The runtime used to pass `min_distance = 0` to `r2d_world_impostors_collect()`
regardless of the region-LOD near band, so a region already drawn by the local
renderer also emitted a coarse silhouette card. The runtime now derives the
collector gate from the policy
(`r2d_world_region_impostor_min_distance()`): the configured near distance when
positive, `0` only for an explicit `near_distance = 0` request.

Measured on BASHNYA `level1` (37 regions, 960x540, HIGH tier):

| LOD request | regions | visible impostor cards | nearest card |
|---|---:|---:|---:|
| default (`near = 600`) | 37 | 33 | d = 743 |
| explicit `regionLod(0, ...)` (old 1.2.6 behaviour) | 37 | 36 (3 inside the band) | d = 345 |
| `regionLod(8000, ...)` | 37 | 0 | - |
| `near = 8000` + `regionConfig(8192,1,2)` | 1 | 0 (no distant region) | - |

Acceptance: no card is emitted inside the near band, cards beyond it stay
visible, and an explicit near band of 0 reproduces the old ungated list. Native
coverage: `tests/re2d/impostor_lod_policy_test.c` (2 Unity tests, ctest target
`r2d_world_impostor_lod_policy_test`).

## Guardian atlas pop-in (BASHNYA correction, 1.2.7, task-3)

The reporter's corrected repro (early GPU frame after a test teleport omits the
Guardian, 45 warm frames show it) was re-run and explained without a renderer
defect:

* BASHNYA `level2` calls `regionConfig(8192,1,2)`, so the whole level is **one**
  region (`regionCount = 1`, `regionCellsAllowed = 343`); region streaming cannot
  be the cause.
* the runtime registers **157 atlas stream items**; promotion is budgeted to 16
  items/frame. At the repro's early frame (~frame 6 of scene lifetime) only
  **84/157** atlases are resident; `atlasesResident` reaches 157 by ~frame 15.
* warmed start (30 frames) then the same teleport: `gpuDrawsActor = 29` on
  **frame 1** (Guardian present).
* gradual approach 672 -> 1472 over 160 frames: `atlasesResident = 157` from
  step 0 and `gpuDrawsActor = 29` throughout; at spawn the steady 55 visible
  sprites settle from 153 to 277 actor draws while the item promotion ramp runs.

Conclusion: the early-frame pop-in is the scene-start residency ramp (bounded by
the 16-items/frame promotion budget), not a teleport-only or GPU-only failure.
A normal walk-in cannot reach the Guardian arena before its atlas is resident.
No engine fix was shipped and no player-facing blocker is claimed; if the
startup ramp ever needs to be shorter, the safe direction is demand-prioritising
visible atlases, which needs its own evidence and budget design.
