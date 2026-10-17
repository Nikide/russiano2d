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
| VN-01 | dialog/view separation, RML template, semantic roles, custom font, tests | vn-agent | pending |
| VN-02 | speaker registry, expressions, theme stack, skip contract, input lock | vn-agent | pending |
| VN-03 | Narrative IR, story compiler, save/backlog/voice/linter | vn-agent | pending |
| R-01 | grounding: contact/blob/foot AO/floor tint; sprite edges; material variation | render-agent | pending |
| R-02 | haze, grime, corner AO, bloom-lite, sky layers | render-agent | pending |
| R-03 | VFX pack, world cards, trails, distortion, impact library | render-agent | pending |
| R-04 | region grid, local BSP, PVS, streaming, LOD | world-agent | pending |
| R-05 | brushes, tool materials, entities, compile pipeline (#5) | world-agent | pending |
| R-06 | distant scene, sky profiles, region impostors (#6) | world-agent | pending |

## Integration gates
- `cmake --build build -j 8 && cmake --build build --target r2d_check -j 8`
- `python3 tools/ci_verify.py --build-dir build`
- `r2d-sdk story validate` / `dialog validate` (new)
- BASHNYA repro + bsp/play slices.
