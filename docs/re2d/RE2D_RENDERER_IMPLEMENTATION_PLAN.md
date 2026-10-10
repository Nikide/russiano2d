# Re2D renderer implementation plan

Дата: 2026-10-09. Baseline HEAD: 8011294, v0.1.27. Пользователь явно согласовал весь план и native implementation. Исходный полный план хранится рядом в RE2D_WORLD_GZDOOM_RENDERER_PLAN.md; его gates обязательны, таблица ниже задаёт порядок, не отменяет их.

## Live audit and reuse

| Existing artifact | Reuse | Gap / migration constraint |
| --- | --- | --- |
| src/re2d_world.c/.h | transactional build/free; wall/span queries; CPU ray reference; private depth and stamp | rectangular free spans, no runtime cell/portal topology, no textured surfaces/lighting |
| src/bsp.c/.h | XY splits and complete traversal, fragment user tags | wall-segment tree is not cell-leaf graph; tail guarantees completeness, not painter order |
| src/re2d_math.c/.h | native view/project/unproject and near clipping | preserve +X yaw and vertical FOV; legacy generic mesh path is not world architecture |
| src/re2d.c | QuickJS opaque WorldHandle and dispose/finalizer, validation patterns | world_frame currently owns render orchestration; extract it to native world renderer service, bindings only convert/call |
| src/highlevel/re2d.js:518 | legacy public $.re2d.world compatibility | render currently walks entities/attachments, prepares poses, builds arrays per frame; new native registrations must remove this work |
| src/rotsprite.c and src/highlevel/rotsprite.js | existing Re2DSprite synthesis/attachments | exact per-sample depth and shared lighting need separate implementation and tests |
| src/render.c/.h | SDL_GPU device, texture upload, render target, 2D batch/postprocess conventions | existing generic mesh submission MUST NOT become authoritative world model; current affine mesh UV path cannot prove perspective correctness |
| sdk/native/sdk_world.c | native .re2dmap validator, stack checks, openings, diagnostics and CLI | compiled walls/cells feed legacy runtime; PVS reports runtimeUsed:false; slopes become steps |
| SDK World Studio / RmlUi | existing data editor and native tool contract | preview new native format after runtime correctness; no second editor or ImGui |

Initial worktree contains unrelated modifications .gitattributes, SDK_HANDOFF.md and tools/help_train/. MUST preserve them. No root AGENTS.md was found by repository file inventory; dist platform instructions do not govern source work.

## Execution sequence and gates

| Phase | Concrete deliverable | Required pass evidence |
| --- | --- | --- |
| 0 | reference rules, behavior spec, audit, staged plan | review of the documents; reference observation limits explicit; approval before core |
| 1 | extend existing native core with explicit Cell/Span/Portal/Surface tables; versioned loader; native cellAt/spanAt/surface enumeration; retain legacy adapter | C same-XY two floors, boundary/invalid refs/overlap tests, transactional failure and ownership; compiler/runtime round trip |
| 2 | XY BSP cell references; native visibility scratch; bounded portal windows; cell/span/BSP/portal debug counters | 100+ cell map, cycles, disconnected/closed/open/multiple height openings; conservative reference comparison |
| 3 | native constrained surface queue → SDL_GPU offscreen 2D target; walls/floors/ceilings/continuous slopes, perspective-correct UV and shared depth | unlit lab, near clipping/UV/depth fixtures, both cameras; preserve CPU reference and existing demos |
| 4 | independent classic RGB span/orientation/distance shader equations | native curve tests and approved light-free visual lab; record coefficient provenance |
| 5 | native material handles/albedo/emissive/optional normals; opaque/masked queues | emissive darkness, tangent basis, cheaper unlit/no-normal paths, material batching/debug |
| 6 | bounded native light handles, cell/span/portal/radius culling, GPU light upload | 128-light stress, open/closed/height/radius tests, relevant pairs counters; no JS light loops |
| 7 | benchmark analytic vs mask shadow candidate; implement selected height-aware wall AND solid-floor occlusion | door, upper lamp/solid floor/opening regressions; 16 shadow candidates with recorded cost |
| 8 | per-span fog shared with actor path | monotone depth and distinct-span tests; fog corridor golden |
| 9 | native actor registration and pose/attachment integration; compatible lighting and sample depth | same-XY upper/lower actor, wall/bridge occlusion, muzzle actor+weapon+wall+floor, no JS per-frame packing |
| 10 | doors/lifts, local dirty topology/light/shadow/GPU invalidation | one operation synchronizes collision/visibility/light/shadow; reopen and hot reload regressions |
| 11 | complete native debug buffers, counters and timings; transparency, sky and bounded surface decals | all specified views, two translucent layers, pool overflow; JS only queries snapshots |
| 12 | measured arenas/caches/static-light associations/batching/hot reload | stress A/B/C, cold/warm timings and memory, unchanged reference/goldens; atomic compiled output publication |
| 13 | $.re2dWorld wrapper polish, handles/queries/quality docs | public-only sample, legacy $.re2d.world regressions, native lifetime/invalid arguments |
| 14 | existing SDK compiler/Studio material/light/topology previews and version diagnostics | CLI round trip, rejection of incompatible format, RmlUi UI verification |
| 15 | all mandatory source gates and final lab acceptance | 17 final checks, six deterministic cameras, stress A/B/C, full relevant native/JS/agent checks, provenance report |

Profiling hooks and public smoke bindings SHOULD begin with their feature rather than waiting until phases 11/13. Topology includes portals in phase 1; portal correctness cannot wait until lighting. Same authoritative geometry MUST serve queries/visibility/light/collision. No wholesale new directory tree until complexity justifies splitting existing files.

## First native slice after approval

1. Define explicit cell IDs and span ownership without altering existing public primitive input.
2. Define boundary policy and test same XY/different h, outside, shared edges and gaps before fast lookup.
3. Add portal openings with references and geometry validation; retain them in versioned compiled output.
4. Add independent native cellAt/spanAt/surface enumeration and loader tests, failed replace/dispose checks.
5. Bind coarse queries and loader through existing QuickJS patterns; keep $.re2d.world working.
6. Only then attach BSP leaf candidate refs and visibility. Do not declare Gate 1 passed until all five required capabilities (load, cellAt, spanAt, traversal, enumeration) have native tests.

## Verification performed in Phase 0

Rebuilt current targets with `cmake --build build --target r2d_bsp_test r2d_re2d_world_test r2d_re2d_test -j6` (Release, AppleClang, macOS arm64). Ran all three executables successfully. These checks prove existing baseline behavior only, not new cells, portals, GPU surfaces or lighting. Full application/SDK, agent suite and visual lab have not been rerun in Phase 0. GZDoom runtime was not run; official wiki access failed, so behavioral requirements remain plan-derived.

Before each major phase MUST reread source §73 and reference rules. MUST record actual gate evidence and remaining gaps; checked boxes in source Definition of Done are target requirements, not baseline completion. No commits/releases/publication were requested.

## Implemented phases and evidence, 2026-10-10

This table describes the current native rectangular-cell implementation. The original source plan remains unchanged beside this document. Phase 0 audit above is historical baseline evidence; current validation is below and in SDK_HANDOFF.md.

| Phase | Implemented result | Evidence |
| --- | --- | --- |
| 0 | independent behavior spec and reference boundary before implementation | GZDOOM_REFERENCE_RULES.md / RE2D_RENDERER_BEHAVIOR.md; no GZDoom runtime observation claim |
| 1 | native cells/free spans/portals/surfaces, transactional author/baked loaders, coarse queries | native same-XY, invalid refs, overlap, ownership and roundtrip tests |
| 2 | near-first XY BSP active branches, retained ownership indexes, clipped portal windows | 128-cell disconnected branch test, cyclic/open/closed/height tests, BSP/portal views |
| 3 | SDL_GPU constrained exact surface intersections, UV/depth, continuous slopes, CPU reference | independent CPU ray equivalence, native surface tests and CPU/GPU parity |
| 4 | independently specified classic RGB/orientation/distance | native response tests, unlit/classic fixtures and golden corridor |
| 5 | native albedo/normal/emissive/material bank, opaque/masked/sorted translucent/additive paths | mapped-normal/emissive diagnostics, two-layer/actor/additive parity, adjacent sampler batches |
| 6 | native generation pool, sparse radius/height/portal association masks/lists, lifetimes/flicker | 128-light pool/stress, wrong-height/door/radius/overflow/promotion tests |
| 7 | wall AND height-plane analytic shadow occluders, per-light cached radius-filtered GPU chunks | solid-floor/opening/door/lift reference parity and local invalidation tests |
| 8 | native span fog shared with actor/world material shading | fog response tests, full lab and golden fog camera |
| 9 | native registration/attachment mirror, native pose budget, PNG sample depth/shared GPU depth | lower/upper pig + AK, flash output, wall/sample occlusion, deferred/fair pose tests |
| 10 | native flat lift/door state, local dirty associations/shadows, transactional reload/watch | geometry/support/collision/ray/visibility/light/parity and valid/invalid reload tests |
| 11 | all 13 native diagnostic views, actual coverage overdraw, counts/wall timings/payload memory, sky/decals | renderer integration and complete lab diagnostics, bounded decal/lifetime parity |
| 12 | reusable frame/visibility/light/sort/pose scratch, caches, sampler batching, baked static links | unchanged six goldens, native startup lightUpdates=0, cold/warm A/B/C report |
| 13 | public-$ handles, queries, backend/profile/quality/reload, examples and runtime docs | legacy and new API regressions; samples use no private engine renderer API |
| 14 | existing native SDK compiler and RmlUi Studio; continuous slopes/stair links/light/debug/PNG previews | SDK 81 and dedicated World Studio 19 checks; generic Studios 117 passed separately |
| 15 | full acceptance lab, six golden comparisons, stress/provenance, final map | lab 18, Dust2 17, renderer 55; 12 regression suites passed; local native/JS CI verification passed |

Native hot paths remain C, public configuration remains `$`, GPU execution remains SDL_GPU, Re2DSprite remains its data-driven PNG synthesis. No ECS, arbitrary world mesh scene, GZDoom runtime/source/shader/asset import or compatibility layer was added.

## Final validation

Document-conformance continuation: `RE2D_DOCUMENT_ACCEPTANCE_AUDIT.md` maps the mandatory scope and all 17 final scenario requirements to actual evidence. The reattached source plan is byte-identical to the preserved copy. Fixed the full lab moving lamp to red at upper-storey h=208, matching its behavior contract. The latest acceptance run passed **21 checks**, adding isolated upper-light opening/solid-floor isolation and separate muzzle actor/wall/floor receiver contributions. This lab-only change does not alter the native binary or parent golden fixture; prior results below retain their original provenance.

Release build: AppleClang, Apple M4/macOS 27.0.1 arm64. `tools/ci_verify.py --build-dir build` passed all registered native checks (including world/RotSprite ASan/UBSan), JavaScript tests and SDK fixture batch. Twelve selected agent suites passed: camera 22, BSP world 30, legacy world 30, Re2DSprite 51, combat 22, native 84, Dust2 17, complete lab 18, JSON rig/attachment smoke 1, World Studio 19, SDK world 81, renderer 54 at that run. The subsequent stair-lintel fix and final counter cleanup passed the focused renderer 55 / lab 18 / Studio 19 / SDK 81 run. Six GPU golden comparisons after final changes were byte-identical; no baseline re-recording. `git diff --check` passed.

Linux CI now runs public renderer/Studio/lab/Dust2/golden checks through SDL_GPU Vulkan/Xvfb. This is a checked-in workflow configuration, not a hosted CI success claim. No commit, release, upload or publication was requested/performed.

## Final static stress measurements

Full report: RE2D_RENDERER_BENCHMARK.json. Native 400×240, seed 7, 8 warmup / 20 measured frames, static actors, unlimited initial pose synthesis, no angle quantization. SDL_GPU Metal surfaces/shadows/sample-depth actors, FINAL without framebuffer readback, completion fence waited. Binary digest, baseline HEAD and modified-checkout provenance are in the report.

| Scene | Selected / total cells | Selected / total surfaces | Relevant / total lights | Visible / registered actors | Median frame |
| --- | --- | --- | --- | --- | --- |
| A | 16 / 100 | 166 / 1101 | 8 / 8 | 9 / 10 | 1.057 ms |
| B | 30 / 500 | 486 / 8501 | 12 / 64 | 29 / 30 | 1.733 ms |
| C | 16 / 80 | 167 / 1120 | 16 / 128 | 15 / 50 | 1.659 ms |

Each case records a cold native frame separately, including initial visible actor synthesis, and resident frame/material/GPU payload counters. Warm static results do not establish arbitrary animated-actor throughput. Earlier unbudgeted animated measurements were A/B/C 135.863/433.309/227.574 ms, mostly CPU actor resynthesis; default poseBudget=1/poseStep=3 trades pose freshness for bounded work. This limitation remains explicit. Timings are CPU wall and completion-fence measurements, not hardware GPU timestamps; memory payloads exclude driver/allocator/temporary/shared authoring overhead.

## Scope and limits

- Cells are rectangular XY polygons; arbitrary polygon authoring is not implemented. Constrained continuous planes/slopes and disjoint stacked free spans are supported.
- Orthographic/outside-world visibility is conservative complete fallback. Imported baked ray queries use complete primitive fallback rather than claiming unverified cell-ray coverage.
- Moving intervals are flat; slope-boundary motion/overlap/ownership crossing rejects. Doors currently expose binary open/closed state.
- Transparency sorts primitive centers. Intersecting transparent surfaces retain conventional sorting limits; shadows are geometry-based, without texel transmission.
- Local shadow geometry is cached per light; changed atlases are repacked/uploaded as a whole. Native material batching shares adjacent texture bindings; it does not merge all surface draw calls into one.
- Memory counters are explicit payload categories, not total process memory. GPU profiling uses submission/completion wall times. Web keeps CPU rendering; GPU overdraw is desktop-only.
- Dust2 is an original recognizable route/elevation reference, not exact Valve geometry or a complete Counter-Strike game. Its runnable route and renderer acceptance is independently tested.
- GZDoom visual behavior observations were not made; the independent behavior spec derives from the supplied plan. Reference provenance is preserved.

The completed artifact is the tested native renderer slice plus full lab and Dust2 reference within these documented limits. The source plan's target checkboxes alone were never treated as test evidence.
