# Re2D renderer behavior contract

Дата: 2026-10-09. Статус: согласованный behavior contract; актуальный runtime и ограничения описаны в RE2D_WORLD_RUNTIME.md. Требования получены из пользовательского плана; независимые наблюдения GZDoom пока отсутствуют. MUST/SHOULD/MUST NOT являются требованиями будущей реализации, не заявлениями о готовности.

## Authoritative model

MUST: карта задаётся XY cells с 2D boundary (текущая версия поддерживает прямоугольники), свободными VerticalSpans, constrained surfaces и portals. BSP делит XY; leaf хранит cell references, height не является BSP axis. Один XY MUST различать свободные интервалы 0..3 и 6..9; промежуток между ними solid. SpanAt MUST выбирать интервал по h, support MUST отдельно учитывать feet/headroom/step.

MUST: topology принадлежит C. Compiler output сохраняет cells, spans, portal openings и surface references. Legacy wall fragments MUST NOT считаться BSP cells. Meshes, scene graph 3D, ECS и JS render callbacks MUST NOT появляться.

MUST: замена мира транзакционна; failed validation/load сохраняет старый мир. Индексы и counts проверяются до allocation/access; nonfinite geometry, invalid refs, overlapping free spans, degenerate walls и openings вне соседних spans отклоняются. Boundary policy MUST быть общей для queries, collision, visibility и lighting; предлагается half-open XY и bottom <= h < top, с отдельно определённой политикой внешней границы.

## Observable requirements and acceptance

| Feature | Re2D behavior / independent concept | Correctness and performance gate |
| --- | --- | --- |
| Visibility | Near-first XY BSP candidates; portal window clips angular and height coverage; conservative rejection only | 100+ cells; visible set smaller than total; no missing surfaces under camera turns; JS surface count does not drive render work |
| Camera | Existing native yaw/pitch conventions, perspective and orthographic views of one map | near-plane clipping, round trips, finite output, existing camera regressions |
| Surfaces | Wall = segment × height range; floor/ceiling = polygon + height equation; slope h=ax+by+c | textured wall/floor/ceiling/slope, perspective-correct UV, depth and clipped edges |
| Classic light | Albedo × span RGB/level × orientation response × monotone distance curve | scene readable without dynamic lights; deterministic axis/distance tests; coefficients recorded after visual checks |
| Materials | albedo required; independent emissive and optional normal channels | emissive survives zero light; no-normal path cheaper; missing assets handled explicitly |
| Dynamic lights | Native pool; light → cell → portal opening → span → radius candidates | radius and closed/open/wrong-height tests; 128 total lights; counters prove irrelevant lights rejected |
| Shadows | Height-aware wall/solid-plane occlusion of light-to-receiver segment | solid upper floor blocks upper lamp from lower sprite node; opening admits light; moving door changes shadow; 16 shadow candidates benchmarked |
| Fog | Per-span RGB/density/start, depth-monotone blend after emissive | two spans have distinct fog; sprite node and world receive compatible fog |
| Portals | Shared XY boundary with multiple vertical openings | 0..3 and 6..9 openings separated by solid; traversal cycle bounded; same geometry used for visibility/light/collision |
| Re2DSprite | Native world registration/pose/attachment/lighting/composition using existing character synthesis | upper/lower sprite nodes at same XY, sprite node behind wall, muzzle flash affects sprite node+weapon+wall+floor; no JS per-frame packing |
| Depth | Shared projected-depth convention for world and sprite node samples | bridge occludes lower sprite node; owner/depth debug explains sample ownership; per-sample native sprite depth verified |
| Transparency | opaque/masked/translucent/additive queues, deterministic ordering | grate/window/smoke/flash and two translucent layers; no OIT requirement |
| Moving world | Door/lift mutates authoritative opening/span state and local dirty regions | one mutation synchronizes collision, visibility, light and shadow |
| Debug | native FINAL/CELL_ID/SPAN_ID/BSP/PORTALS/DEPTH/OWNER/LIGHT_LEVEL/DYNAMIC_LIGHT_COUNT/SHADOW_MASK/NORMAL/EMISSIVE/OVERDRAW | selected views explain actual submitted set; native timings/counters are query snapshots |
| Sky / decals | background surface; decal belongs to constrained wall surface UV, bounded lifetime pool | no sphere mesh; bounded count and native lifetime |

## Projection and lighting conventions

MUST reuse R2DRe2dView convention: yaw 0 faces +X, positive pitch looks up, vertical FOV, focal=(height/2)/tan(fov/2). The sample projection in the external plan uses a different axis orientation; MUST NOT silently change existing camera API to match it. GPU depth mapping and CPU reference ray t MUST have an explicit conversion before composition.

MUST define equations before shaders. The native reference uses classic distance response `1/(1+depth*distanceScale)` and orientation response `1+strength*(abs(nx)-abs(ny))`; runtime defaults are distanceScale=0.001 and orientationStrength=0.06. These are independently authored Re2D parameters, not Doom tables. User approval covers implementation; run evidence is recorded separately in SDK_HANDOFF.md. Fog uses `exp(-density*max(0,depth-start))`. Normals are derived from constrained surface tangent basis; they do not alter topology. See RE2D_WORLD_RUNTIME.md for current material/light equations and limits.

MUST establish this order: albedo → classic/span/orientation → shadowed dynamic normal response → emissive → fog → transparency/composition → existing postprocess. Gameplay lightAt is deterministic C approximation over world data; MUST NOT read framebuffer brightness.

## Ownership, API and limits

World owns topology, materials, native light/sprite node registrations, static refs and GPU resources. Frame scratch owns visibility/light lists, shadow scratch and queues. MUST NOT allocate once per light-wall pair. MUST bound portal traversal, pools, per-span light lists and shadow candidates, with counters for overflow/fallback.

`$.re2dWorld` реализован; актуальные сигнатуры и лимиты см. RE2D_WORLD_RUNTIME.md. Existing `$.re2d.world(description)` MUST remain compatible. New wrapper handles MUST NOT own a duplicate authoritative topology. Existing generic `<light>` behavior MUST be audited before introducing world semantics, preventing regressions in ordinary 2D lighting. Renderer math MUST stay out of bindings.

## Final acceptance fixture

MUST create demos/re2d_world_renderer_lab with dark lower room, upper bridge, stairs, door, blue fog corridor, emissive panel, normal wall, moving red upper lamp and upper/lower Re2DSprites. MUST prove all 17 checks in source plan §72, deterministic six-camera golden images, stress A/B/C, and native profiling. Benchmarks MUST record hardware/OS/backend/build/commit/resolution/scene/quality/counts, CPU and GPU timings separately. No FPS promise before measurements.

MUST NOT claim Renderer 1.0 from baseline unit tests, this spec or generated images. PBR/SSR/GI/ray tracing/volumetric raymarching/arbitrary meshes are outside scope.
