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
| R-01 | grounding/edges/material (task-2) | particle-core | in_progress |
| R-02 | haze/grime/AO/bloom/sky layers (task-2) | particle-core | in_progress |
| R-03 | VFX pack/cards/trails/distortion (task-4) | viewmodel-core | done: 11 native, 53 bundles, 143 CTest; renderer pass for cards/trails pending |
| R-04 | regions/PVS/streaming/LOD (task-3) | nav-core | in_progress |
| R-05 | brushes/tool materials/compiler #5 (task-3) | nav-core | in_progress |
| R-06 | distant scene/sky boundary #6 (task-3) | nav-core | in_progress |

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
