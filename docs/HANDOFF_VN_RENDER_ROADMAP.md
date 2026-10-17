# HANDOFF — VN + Re2D Render Roadmap

**Задача:** выполнить `/Users/nikitademcev/Downloads/RUSSIANO2D_VN_AND_RE2D_RENDER_ROADMAP.md`
(разделы VN-01..03, R-01..R-06, issue #5 brush authoring, issue #6 sky/clip boundary).
**Ветка:** main. **Handoff ведётся только для этой задачи.**

## Правила
- Движок остаётся 2D/2.5D: только constrained Re2D primitives. Никаких Mesh3D/Node3D/Scene3D.
- Hot path — native C; JS не обходит surfaces/спрайты.
- Public `$` API + tests + docs. Native C tests — Unity; не плодить Python-тесты для core.
- `r2d-sdk` остаётся единственным backend CLI/GUI/agent; runtime не зависит от SDK.
- Каждый коммит: `r2d_check`, `api check`, lint/validate/doctor, docs guards.

## Task board
| id | scope | owner | status |
|---|---|---|---|
| VN-01..03 | dialog/view/theme/IR/linter (task-1) | trace-core | done: 13 qjs, 15 native |
| VN-02 | speaker/expression/theme stack/skip/input lock (task-1) | trace-core | in_progress |
| VN-03 | Narrative IR/story/save/backlog/linter (task-1) | trace-core | in_progress |
| R-01 | grounding/edges/material (task-2) | particle-core | done: 13 native, 32% pixels changed |
| R-02 | haze/grime/AO/bloom/sky layers (task-2) | particle-core | done: sky layers/sun/moon/haze/bevel/AO |
| R-03 | VFX pack/cards/trails/distortion (task-4) | viewmodel-core | done: 11 native, 53 bundles, 143 CTest; renderer pass for cards/trails pending |
| R-04 | regions/PVS/streaming/LOD (task-3) | nav-core | done: runtime region info wired by Lead |
| R-05 | brushes/tool materials/compiler #5 (task-3) | nav-core | done: 23 native tests, BASHNYA l02 0.05s |
| R-06 | distant scene/sky boundary #6 (task-3) | nav-core | done: sky policy wall bits + docs |

## Integration gates
- `cmake --build build -j 8 && cmake --build build --target r2d_check -j 8`
- `python3 tools/ci_verify.py --build-dir build`
- `r2d-sdk story validate` / `dialog validate` (new)
- BASHNYA repro + bsp/play slices.


## Acceptance matrix (roadmap)
| roadmap | deliverable | verification |
|---|---|---|
| VN 14-24 | dialog logic/view split, semantic roles, custom RML/RCSS, font | qjs custom theme test; no hardcoded DOM ids |
| VN 10-13,25-26 | speaker/expression/portrait slots, active speaker, theme stack | agent test + inspector fields |
| VN 29-36 | input.lock, skip, save/resume, backlog, read/unread, voice, prefetch | agent test; no lost gameplay commits |
| VN 37-39 | story linter, dialog validator, narrative inspector | `r2d-sdk story validate`, `dialog validate`, agent snapshot |
| R-01 43-48 | grounding: contact/blob/foot AO/floor tint/edges/material variation/bevel/corner AO | screenshot + toggle tests |
| R-02 49-58 | contact lighting, height fog, haze, shafts, bloom, decals, detail, liquid | screenshot/benchmark + counters |
| R-03 59-68 | postprocess, distortion, sky panorama/cards/disc/distant/portal/surface | sky test scene |
| R-04 69-90 | regions, active/preload, streaming, PVS, areaportals, LODs | huge-world benchmark; stable save/IDs |
| R-05 91-107 | brushes/tool materials/entities/stages/warnings/residency (#5) | brush fixture compile; BASHNYA l02 backward compat |
| R-06 118-120 | distant scene, sky profiles, region impostors (#6) | sky boundary test + docs |
| R-03VFX 108-116 | VFX pack, cards, trails, collision modes, light budget | per-effect agent test + counters |

## Current status log
- 2026-10-17: tasks assigned (VN→trace-core, render→particle-core, world/compiler→nav-core, VFX→viewmodel-core). Handoff created.

## Completed
### R-03 VFX (task-4)
- `src/re2d_world_vfx.h/.c`: 32 trails, cards, distortion, temp-light budget, FX bundle parser.
- `particle` collision modes none/floor/wall/bounce/despawn; `world.vfx*` API + info counters.
- 53 procedural effects under `assets/vfx/`, demo `demos/re2d_vfx_lab`.
- Tests: 11 native, agent 53/53 bundles; r2d_check 143; ci_verify green.
- Limits: cards/trails/distortion simulated+budgeted but exotic renderer pass not wired (renderer task owns GPU); decals need used material; point/probe collisions.

## Completed
### VN-01..03 (task-1)
- `dialog_view.js` semantic roles/data-dialog-role, slots, state classes, hot reload last-valid fallback; `dialog_theme.js` builtin/custom RML+RCSS, CSS vars, themes/stack.
- `dialog.js`: speaker registry/expressions, auto/skip/backlog/read/voice/prefetch/save-restore, input lock, world mode, inspect; old API preserved.
- `story.js`: Narrative IR compiler, all speech through `$.dialog`; timeline/cutscene share it.
- native `r2d-sdk story validate` and `dialog validate`.
- Tests: 13 qjs, 15 native SDK; r2d_check 143, ci_verify/docs guards green.
- Limits: RmlUi pixels not screenshot-verified in qjs (recording backend); default RML has 6 choice slots; input.lock advisory; RCSS syntax checked by RmlUi at load.

## Completed
### R-01/R-02 + VFX GPU pass (task-2)
- `re2d_world_render_features.*`: deterministic grounding/fog/variation/AO/sky/liquid model + quality presets.
- GPU shader/pass: contact shadow/foot AO/floor tint, edge feather/outline/grime, material variation/bevel/corner AO, height fog/haze, sky panorama+4 parallax cards+sun/moon, VFX cards/trails/distortion depth-tested.
- Counters: `gpuDrawsGround`, `gpuDrawsVfx`, `info.visual.*`; attribution exact.
- Tests: 13 native, 2 agent; r2d_check 146; ci_verify/docs green.
- Metrics: lab 26 draws low/high, 32.33% pixels changed; VFX card 1 draw, trail 3; bench worstcase 4.91ms/1287 draws.
- Limits: medium/high are GPU-reference; CPU shares grounding; contact card screen-space; sky reuses one panorama; refraction remains post; BASHNYA bench blocked by concurrent world loader regression.

### R-04..R-06 + #5/#6 (task-3)
- Brush compiler: rectilinear footprint, solid-height subtraction, merged sectors, exposed walls/portals, tool materials, point/brush entities, stage report/warnings; `r2d-sdk world compile|info|validate [--renderer] [--pvs] [--region-size N]`; old author files/baked RDW1–RDW4 load unchanged.
- Sky/clip boundary: `R2DWall.flags` policy bits RENDER/COLLIDE/RAY/SHADOW/ACOUSTIC/SKY/OCCLUDER, `R2D_WALL_SKY` = no surface but collision/ray stay; areaportal marker; RDW5.
- Regions: `re2d_world_region` grid, coarse PVS, active/preload, streaming contract, LOD, region-local coords; runtime now builds it lazily and exposes `world.info().regions` fields.
- Tests: region 9, brush 6, world_tools 5, SDK compile 3; r2d_check 147; ci_verify green.
- Limits: async residency/upload budget no; occluder/hint not full BSP planes; brush must be rectilinear; GPU shadow map/audio don't yet consume SHADOW/ACOUSTIC bits; BASHNYA active working maps were regenerated by an external test run and restored from git (play slice green; BSP >400-cell assertion depends on external map version).

## Final integration (task-5) — 2026-10-17

### Commits
- `a267d37` VN: dialog/view/theme split, Narrative IR, native story/dialog linters.
- `5289878` Re2D: grounding/edges/material/lighting/sky + VFX + runtime region info.
- `b886dc1` Re2D: brush compiler, wall policy, sky boundary, region PVS.
- `34da746` site: publish VN/Re2D docs.
- Handoff commits: `3818628`, `cb5d919`, `07eb446`, `1b4e7b0`, `3f02a40`, `b9d395f`, `a39168a`.

### Final gates
- `cmake --build build -j 8`: OK.
- `r2d_check`: **147/147** (native Unity incl. ASan/UBSan + qjs + SDK batch).
- `tools/ci_verify.py --build-dir build`: exit 0 (api/doctor/lint/validate/recipes).
- docs guards: doc_claims/doc_coverage/api_docs_sync/api_freeze/site_prune all pass.
- `site/build-doc.py`: 118 documents; VN/Re2D group in sidebar/sitemap.
- BASHNYA with integrated runtime: `repro_engine_limits.py` — save 4097 OK, scene enter `R2D_SCENE_ENTER`, WAV 44.1/48 kHz = 1.0 s; `play_slice.py` FINAL complete. `bsp_slice_verify.py` stops at its external-map assertion `cells>400` because BASHNYA working maps were restored to git HEAD (357 cells); this is not an engine error. An earlier regeneration produced 711 cells with overlapping XY cells, which the runtime correctly rejects (invalid authoring, not a valid map).
- Runtime regions on BASHNYA l01 (git HEAD): 26 regions, current 23, active 6, preload 5, culled 15, exposed via `world.info().regions`.

### Honest remaining gaps (not claimed done)
- Roadmap optional P5 items (16-direction ultra sprites, complex distant city cards, weather stacking, etc.) are not implemented.
- Brush authoring is rectilinear only; no holes/arbitrary CSG/vertex editor; brush entities are metadata and moving brushes still use the mover API.
- Region streaming is a state/permission contract; BSP/surface/texture residency and async upload budget are not implemented.
- GPU shadow map does not yet consume `R2D_WALL_SHADOW`; audio occlusion does not yet consume `R2D_WALL_ACOUSTIC`; hints/occluders are compiler markers, not full BSP split/occluder PVS.
- VFX cards/trails/distortion render in the new pass, but screen-space refraction remains postprocess; decals require a used material.
- VN default RML ships 6 choice slots; RmlUi pixel output is validated by the engine agent path, qjs tests use a recording backend.

## Wave 2 — закрыть остаток roadmap (2026-10-17)
| id | scope | owner |
|---|---|---|
| task-6 | R-04 full: streaming/residency/LOD/occluders/impostors | controller-core |
| task-7 | renderer P4/P5: shafts/ambient/reflection/bloom/decals2/distortion/sky profiles/weather/ultra sprites | semantic-core |
| task-8 | R-05 full: polygon/holes/CSG brushes, entities, tool policy metadata | mover-core |
| task-9 | VN DoD gaps + debug views/render regression/budgets | trigger-core |
| task-10 | integration/gates/handoff | lead |

Правило: новые файлы и скоупы не пересекаются; конфликты решает Lead.

### task-9 — VN DoD gaps + render QA (trigger-core, no commit)
- VN: real `$.sound` voice playback, actual `$.resource`/`$.sound` prefetch, dictionary `$.i18n.lookup()`, `choiceSlots`/`choiceTemplate` (1..64), hard input lock (`{hard:true}`), narrative DevTools tab.
- Theme: `ui/dialog/bashnya.rml` + `.rcss` (black/dark-red, 8 choice slots, custom font), pixel test `tests/agent/vn_bashnya_theme_test.py`.
- QA: `docs/RE2D_DEBUG_VIEWS.md`, `world.debug.views/features/budget`, test `tests/agent/re2d_budget_test.py`; render regression `tests/agent/re2d_render_regression_test.py` + `tests/agent/reference/*.png`.
- Tests: `tests/js/vn_gaps_test.mjs` (13) + agent BASHNYA/budget/render tests; `r2d-sdk dialog validate ui/dialog/bashnya.rml` OK (8 choices, 0 errors).
- Limits: region/PVS/areaportal/occluder/LOD debug *views* need new native enum values (counter-only today); hard lock gates only `$.input`, not direct `engine.keyDown` readers.
- Acceptance lab (task-21): `demos/re2d_visual_lab` (scene `re2d_visual_lab`) now exists with 50 enemies / 150 props / ~1.2k particles / 40+ decals / 12 lights (4 shadowed) / sky+weather+shafts / 11 VFX bundles. References: `tests/agent/reference/re2d_visual_lab.png`, `visual_lab_<feature>_{before,after}.png`; BASHNYA refs under `tests/agent/reference/bashnya/` with scripts `re2d_visual_lab_acceptance_test.py` and `bashnya_visual_refs_test.py`. Testroom map lacks a compiler region grid, so `impostorCount` is 0 there (openworld lab: 25); `regionConfig/regionLod` is still exercised.

## Wave 2 complete (2026-10-17)
- task-6 R-04 full: stream cache/residency budgets, cluster+occluder PVS, region-local/render origin, LOD wiring, impostors; native 23 tests + huge-world agent test.
- task-7 renderer P4/P5: sky profiles/weather/layers, shafts, ambient/AO field bake, detail layers, decals 2.0 model, bloom/reflection/heat math+CPU refs, 16-dir helper, batching/residency counters, regression tests.
- task-8 brush: convex polygon, rect holes, Z-CSG subtract, brush entities, entity map, warnings; 11 brush + 3 entity + 3 compile tests.
- task-9 VN gaps/QA: real voice/prefetch/i18n lookup, dynamic choices, hard lock, BASHNYA RML/RCSS theme, narrative DevTools, render regression references, budgets/debug catalogue.
- Lead hooks: GPU impostor draw pass, SHADOW policy in shadow chunks, ACOUSTIC policy in audio occlusion, runtime region info, site docs.
- Final gates: r2d_check 157/157; ci_verify green; docs guards/site green; BASHNYA repro+play green.

### Remaining honest limits after wave 2
- Bloom/reflection/heat have math+CPU references but final screen composite needs a scene-colour target in the forward pass; `world.post` remains the screen path.
- Ambient/AO field and detail layers are baked/validated but not uploaded to forward shader uniforms.
- Decals 2.0 model is not yet fed by the 128-slot world decal JSON authoring pool.
- Static batching/residency are accounting/hooks; GPU submission still per-surface.
- Per-layer sky textures/distant city art need authored assets (procedural fallbacks exist).
- Stream texture/atlas residency is deterministic budget bookkeeping; real GPU uploads/evictions and LOD light/decal GPU consumers still need renderer wiring.
- Brush: convex polygons, axis-aligned rect holes, Z-interval CSG only; no arbitrary boolean/vertex editor.
- Shadow map/audio now consume SHADOW/ACOUSTIC bits; hint planes still compiler-only, occluders are conservative region samples.
- Region-local rendering is exposed and impostors draw; moving all forward geometry to region-local origin is not done.

## Wave 3 — final renderer/streaming integration (2026-10-17)
- task-11: GPU post pass (bloom/reflection/heat), ambient 4x4/detail upload, decals 2.0 authoring, high/ultra gating; native 158/158, agent post/decals green.
- task-12: real texture/atlas residency upload/evict, render-origin uniforms+shadows, GPU light/decal LOD, stream counters; huge-world agent green.
- Lead: GPU impostor pass, SHADOW shadow filter, ACOUSTIC audio occlusion, advanced visuals gated to high/ultra for CPU parity.
- Final native gates: 158/158; ci_verify/docs/site green.
- Known red agent parity tests (not native): `re2d_world_renderer_test.py` 6 comparisons (moving floor/shadow, upper normal/emissive/fog/shadow, lower shadow, transparent actor depth, additive flash, legacy decal) and `dust2` now green after low/medium gating. These compare wave-2 GPU-only visual features against the simpler CPU reference; features are gated high/ultra but legacy parity still fails in some scenes. Not claimed as fixed.
- Remaining exact limits: independent per-layer sky textures need authored assets; static batching needs SSBO/instancing (documented); hint planes compiler-only; GPU upload is real for textures/atlases but BSP/surface payloads remain resident.

## Wave 4 — CPU/GPU parity fixed
- task-13 particle-core: 6 failures fixed without weakening tests: (1) shadow cache now stays in world coordinates and the fragment shader adds renderOrigin (3 shadow failures); (2) translucent/additive pipelines reset depth compare to LESS_OR_EQUAL after mirror/overdraw (3 transparency/decal failures). `re2d_world_renderer_test` 55/55; renderer/dust2/P4/visual/VFX agent suites green; native 158/158; ci/docs green.

## task-17 — roadmap coverage audit + acceptance checker (trigger-core, no commit)

Tools:
- `tools/roadmap_coverage.py --check|--json|--write`: 0..153 matrix, evidence
  groups, mandatory red count, TODO/stub source audit, docs generator.
- `docs/ROADMAP_COVERAGE.md`: full 154-section matrix + VN/R/P0..P5 map +
  DoD 146–148 evidence + prioritized red gaps + acceptance snapshot.
- `tests/agent/roadmap_acceptance_test.py`: asserts 154 ids, no done-without-
  evidence, known open areas not marked done, docs matrix complete.

Final audit snapshot (after task-15/18/19/20 integrated):
- build PASS; r2d_check **166/166**, 22.15 s (baseline grew from 163 with concurrent tests); ci_verify PASS; site build PASS;
  doc_claims/doc_coverage/api_docs_sync/api_freeze/site_prune PASS.
- coverage: 154/154 mapped; done 121, partial 16, deferred 1, policy 11, meta 5;
  **16 mandatory red gaps**; **0 literal TODO/stub/simulated markers** in the
  audited modules.
- agent acceptance subset (`tools/run_tests.py` with 15 named acceptance tests):
  **15/15 ok, 0 fail, 0 skip, 65.4 s** — renderer, dust2, huge-world,
  render P4/post/visual, VFX pack/pass, budget, batching, BASHNYA theme, VN
  validation, DevTools pick/render, roadmap acceptance. Full `tools/run_tests.py`
  was stopped after it wedged on `audio_hrtf_test`; that is recorded as an
  environmental timeout, not claimed green.
- render regression references were refreshed after visual review of the final
  frame; re-run is 0.0000% on both labs.
- BASHNYA packaged runtime `repro_engine_limits.py`: exit 0 but `large_save`
  returns `InternalError: state serialization failed`; the same script pointed
  at `build/russiano2d` succeeds with 4097 spans. `play_slice.py`: `FINAL
  complete` (key/MAP2/seal/checkpoint/boss victory).
- Stale test fixed during audit: `tests/agent/devtools_pick_test.py` expected
  five inspector sections; task-9 added Narrative, so it now asserts six and
  checks the Narrative tab.

DoD 146–148:
- **146 VN — done**: custom RML/font/layout (`ui/dialog/bashnya.*`), choices,
  keyboard/gamepad, skip/auto/backlog/save, timeline/cutscene share `$.dialog`,
  no story-owned UI; pixel agent test green.
- **147 Render P0 — done (task-21)**: acceptance visual lab
  `demos/re2d_visual_lab` with 50 enemies/150 props/~1.2k particles/decals/
  12 lights/sky/weather/shafts/VFX; deterministic `re2d_visual_lab.png` and
  feature before/after refs; BASHNYA start/shot/VFX refs under
  `tests/agent/reference/bashnya/`. Region impostor counter is 0 on the testroom
  map (no compiler region grid); openworld lab reports 25, so the runtime
  contract is covered there.
- **148 Huge world — done (task-26)**: 2x/4x tiled map-size benchmark with a
  fixed active/preload ring keeps renderer cost flat (GPU draws 3->3, visible
  surfaces 7->7, frameMs 0.092->0.106 ms, regions 13->52) and AI/nav/controller
  survive unload/preload crossings with master-world fallback; save/load keeps
  map hash `b95815af707fc882` and semantic cell 0 across a full reload. Evidence:
  `tests/agent/re2d_huge_scaling_test.py`,
  `tests/agent/results/re2d_huge_scaling_report.json`, `.../huge_scaling.csv`.

Prioritized red list (15): 90, 93, 96, 103, 104, 117, 126, 127, 128, 131,
136, 137, 141, 144, 147.

## task-25 — Scene-W crossover + native test layout (trigger-core, no commit)

Scene-W acceptance:
- `tests/agent/scene_w_crossover_test.py` (30 checks) runs on
  `tests/fixtures/within` and builds a real Re2D testroom in-engine: W is a
  native world sprite lit by a Re2D light at a projected screen point.
- Chain asserted end-to-end: player input walks into `world.trigger` enter →
  `$.cutscene` takes input and moves camera → Re2D view looks at W → BASHNYA
  RML/RCSS/font dialog opens (`choiceSlots=8`, `view=rml`) → expression
  neutral→angry → continuous environmental particles stay alive → choice
  commits `$.store` + emits `sceneW.commit` → native `vanish` FX bundle spawns
  (1 card) → W removed (`visibleAtlasSprites 1→0`) → cutscene/dialog close →
  `$.input.taken()` false → Left input moves the hero again. Screenshots
  `build/scene_w_before.png` / `scene_w_after.png` differ by 58.85% of pixels.
- No fake method-presence passes; every step checks engine state/counters.

Native test layout (§131):
- Chosen safe route: documented compatibility layout, files remain flat.
  `tools/test_layout_check.py` maps every tracked `tests/re2d/*.c` to proposed
  roadmap subsystem dirs, checks file→CMake and CMake→file in both directions.
- `tests/re2d/LAYOUT.md` generated mapping (44 tracked, 44 CMake-wired, 47
  CMake references). Untracked new tests (`debug_views_test.c`,
  `sky_leak_test.c`, `volume_entity_test.c`) are warnings until their owners
  wire them.
- `tests/agent/native_test_layout_test.py` (20 checks) enforces the mapping;
  no `tests/CMakeLists.txt` move was needed, so `r2d_check` stays green (166/166 after concurrent tests landed).

Coverage matrix: §131 and §141 are now `done`; mandatory red gaps **16→14**.

## task-28 — independent full-suite QA + accepted state (2026-10-18, no commit)

Independent acceptance run on the stable tree after tasks 21/24 finished. Tests/docs/tools only; no source edits.

### Gates
| Gate | Result |
|---|---|
| `cmake --build build -j 8` | PASS |
| `r2d_check` | **166/166 PASS**, 12.45 s |
| `tools/ci_verify.py --build-dir build` | PASS (runtime/api/schema/typings/docs/project/lint, 4052 names) |
| `doc_claims` / `doc_coverage` / `api_docs_sync` / `api_freeze` / `site_prune` | PASS (3210 names; freeze holds) |
| `site/build-doc.py` | PASS, 119 documents / 7 images |
| `tools/roadmap_coverage.py --check` | PASS: 154 sections; done 124, partial 13, deferred 1, policy 11, meta 5; **14 mandatory red gaps**; 0 literal TODO/stub markers |

### Full agent suite (`tools/run_tests.py`, R2D_TEST_TIMEOUT=180)
**293 tests: 290 ok, 1 fail, 2 skip; 910.8 s.** All acceptance groups green:
- renderer: `re2d_world_renderer_test` 55/55, `re2d_render_p4_test`, `re2d_render_visual_features_test`,
  `re2d_render_regression_test`, `re2d_render_vfx_pass_test`, `re2d_visual_lab_acceptance_test`;
- BASHNYA/render refs: `bashnya_visual_refs_test`, `scene_w_crossover_test`;
- dust2: `re2d_dust2_test`, `re2d_dust2_props_audio_test`;
- huge world: `re2d_huge_world_test`, `re2d_huge_scaling_test`;
- roadmap: `roadmap_acceptance_test`.

**Fail (deterministic, product gap, not flaky):** `sdk_studios_test`.
Stale `REQUIRED_TOOLS` list was updated from 15 to the 18 entries in `sdk_tools.json`
(`code-check`, `api-browser`, `vn-narrative`), which fixes that assertion. The remaining
failure is real: registry entry `vn-narrative` has **no `sdk/tools/vn-narrative.js` screen**.
The test's screen-existence assertion is intentionally not weakened; the SDK needs the
tool screen (or registry/menu contract change) before this test can be green.

**Skip (expected, not green):** `re2d_dust2_annex_test` (missing `bake-re2d` SDK command —
3D authoring intentionally cut) and `re2d_v3_test` (missing `convert-re2d3`). Both are
environmental/capability skips, recorded by the runner as non-success.

**Flaky/environmental:** BASHNYA `play_slice.py` run 1 failed during level1→level2
transition (`приложение остановилось во время прогона кадров`); run 2 reached
`FINAL complete` when run alone. Run 1 was executed concurrently with
`bsp_slice_verify.py` against the same packaged runtime/game directory, so the failure
is attributed to concurrent BASHNYA agent processes (resource/file contention), not a
reproducible engine bug; it is still recorded as a non-green run.

### BASHNYA packaged runtime vs repo build (root cause)
- BASHNYA `runtime/russiano2d` is **byte-identical** to `dist/macos-arm64/russiano2d`
  (sha256 `b71844713bf5da1a9e357b9775d0200945b70af4bf5187a1bb57f1c93b97a16f`), mtime 17:38.
- `dist/RELEASE_NOTES_1.2.5.md` is the 17:38 release; its packaged binary predates
  the save-limit fix `a38856b` (20:08, spans/portals 4096 → 65536, typed validation).
- Repro: packaged runtime `repro_engine_limits.py` returns
  `InternalError: Re2D World: state serialization failed` for 4097 spans (old 4096
  save validator); `build/russiano2d` returns `error: null` for the same input.
  WAV durations 1.0 s for 44.1/48 kHz and scene-enter diagnostics pass on both.
- **Release packaging must be rebuilt after `a38856b` (e.g. 1.2.6) and repackaged into
  dist/BASHNYA.** No BASHNYA files were modified by this audit.

### BASHNYA acceptance
- `repro_engine_limits.py` (packaged): exit 0, save discrepancy as above.
- `repro_engine_limits.py` save 4097 via repo build: **PASS** (`error:null`).
- `bsp_slice_verify.py` (packaged): PASS — BSP architecture, bridge spawn, checkpoint,
  scene enter, audio balance, shot audibility, chamber/reload, abyss death, restart,
  second BSP map, diagnostics.
- `play_slice.py` (packaged): 1 fail / 1 pass, `FINAL complete` on rerun (flaky as above).

### Accepted state
- VN DoD §146: accepted (agent pixel/theme/VN tests green).
- Render P0 §147: accepted (visual lab + before/after refs + BASHNYA refs green).
- Huge world §148: accepted (2x/4x flat-cost benchmark + streaming-boundary AI/nav/save).
- Open: **14 mandatory roadmap red sections**, `sdk_studios_test` missing `vn-narrative`
  screen, two expected 3D-authoring skips, stale dist package. These are the exact items
  not claimed green.

## FINAL closure (2026-10-18)
- Roadmap coverage: **154/154 sections mapped, 138 done, 5 meta, 11 policy, 0 mandatory red gaps, 0 TODO/stub hits** (`tools/roadmap_coverage.py --check`).
- Native: **166/166**; ci_verify exit 0; docs guards/site (119 docs) green.
- Agent full suite: 293 tests (290 ok, 1 fail `sdk_studios_test` root = missing vn-narrative screen, 2 expected 3D-authoring skips). `sdk/tools/vn-narrative.js` added; `sdk_studios_test` now passes standalone. Skips remain intentional (`bake-re2d`/`convert-re2d3` 3D authoring cut).
- Renderer: CPU/GPU parity 55/55; P4/P5, VFX, visual lab 50 enemies/150 props/1292 particles/12 lights+4 shadow/11 bundles, BEFORE/AFTER refs, BASHNYA bridge/shot/VFX refs.
- GPU static batching: real per-group SSBO/instancing (23 logical → 4 group draws), fallback + logical attribution; Metal binding fixer idempotent.
- Huge world: 1x/2x/4x scaling flat draws; payload stream IO unload/reload; AI/nav boundary; save/load semantic IDs.
- Brush: hint/occluder markers, polygon/rect-hole/multi-solid Z-CSG, vertex move/split, fog/water/areaportal concrete mappings, exterior flood-fill sky leak.
- VN: DoD §146 complete; scene-W crossover 30 checks; BASHNYA theme/RML pixel tests.
- BASHNYA: repro PASS (repo build), play_slice FINAL complete; packaged BASHNYA runtime is old 1.2.5 from `e4085c1` predating save fix `a38856b` → next dist rebuild/1.2.6 required.
- Remaining known environmental note: full suite 2 intentional skips; no mandatory roadmap red gaps.
