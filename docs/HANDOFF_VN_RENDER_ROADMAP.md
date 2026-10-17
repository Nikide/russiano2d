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
