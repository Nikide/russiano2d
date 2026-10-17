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
| VN-01..03 | dialog/view/theme/IR/linter (task-1) | trace-core | in_progress |
| VN-02 | speaker/expression/theme stack/skip/input lock (task-1) | trace-core | in_progress |
| VN-03 | Narrative IR/story/save/backlog/linter (task-1) | trace-core | in_progress |
| R-01 | grounding/edges/material (task-2) | particle-core | in_progress |
| R-02 | haze/grime/AO/bloom/sky layers (task-2) | particle-core | in_progress |
| R-03 | VFX pack/cards/trails/distortion (task-4) | viewmodel-core | in_progress |
| R-04 | regions/PVS/streaming/LOD (task-3) | nav-core | in_progress |
| R-05 | brushes/tool materials/compiler #5 (task-3) | nav-core | in_progress |
| R-06 | distant scene/sky boundary #6 (task-3) | nav-core | in_progress |

## Integration gates
- `cmake --build build -j 8 && cmake --build build --target r2d_check -j 8`
- `python3 tools/ci_verify.py --build-dir build`
- `r2d-sdk story validate` / `dialog validate` (new)
- BASHNYA repro + bsp/play slices.
