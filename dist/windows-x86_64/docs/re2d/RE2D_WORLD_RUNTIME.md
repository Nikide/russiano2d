# Re2D World: полный контракт native runtime

Редакция 2026-10-10. Public entry — `$.re2dWorld`. Обучающий пример: [World guide](../RE2D_WORLD_GUIDE.md); compact signatures: [API](../highlevel/re2d.md); character integration: [Re2DSprite World](RE2DSPRITE_WORLD.md); data/bake: [formats](RE2D_WORLD_FORMAT.md). Это контракт текущего кода, не перечень желаемых возможностей исходного плана.

## Authority и путь кадра

World owns rectangular XY cells/BSP, free spans, portals и constrained wall/floor/ceiling planes. Slope — height equation plane. C owns topology/visibility/materials/light lists/shadow caches, списками ссылок на узлы со спрайтами, очередями кадра и ресурсами. Public `$` отвечает за configuration/gameplay orchestration. Native runtime может читать registered node properties; это не JS wall×light renderer loop.

GPU FINAL: selected constrained surfaces → SDL_GPU color/owner/depth targets → sample-depth спрайты → decals/transparency → ordinary 2D output texture. Completed frame копируется непосредственно, без readback. Diagnostics могут читать private depth/owner и выполнять CPU visualization. CPU reference самостоятельно синтезирует RGBA/depth, stamps спрайты/decals/transparency и uploads обычную texture. Оба идут через existing R2D composition; direct Vulkan/OpenGL backend не добавлен.

[Topology source](../../src/re2d_world_topology.c), [visibility](../../src/re2d_world_visibility.c), [нативная композиция спрайтов](../../src/re2d_world_runtime.c), [GPU](../../src/re2d_world_gpu.c), [shader](../../shaders/world.frag.glsl), [bindings](../../src/re2d.c), [public wrapper](../../src/highlevel/re2d.js).

## Создание, camera и render

`load(path)` читает через public $.fs.readText; invalid/missing JSON бросает error. `fromJSON(text)` принимает native author/baked JSON string. Author input строит topology в C, baked imports validated tables. CPU — default backend нового wrapper; `.backend('gpu')` выбирает SDL_GPU. `info().backend` использует labels `cpu-reference`/`gpu-reference` — это diagnostic labels, аргументы backend остаются cpu/gpu.

```js
const world=$.re2dWorld.load('maps/room.re2dworld').backend('gpu');
world.camera({x:20,y:30,h:48,yaw:0,pitch:0,fov:70,near:4});
$.render(() => world.render(null,400,240));
```

Camera defaults: x=y=0; h=view.h ?? view.eye ??48; yaw=pitch=0; fov=70°, near=4. Yaw0=+X, positive pitch looks up. FOV vertical, focal=(height/2)/tan(fov/2). Wrapper принимает degrees, native math radians. Camera replaces fields, не partial patch; меняйте собственный view object или передавайте все нужные поля. Orthographic: projection='orthographic', orthoHeight default400; other projection labels выбирают perspective. Near>0, FOV input between0/180; native view дополнительно clamps math conventions.

`render(view=null,width=320,height=180)` настраивает camera при non-null view, synthesizes и fullscreen draws, возвращает sprite ID. `renderToSprite` делает ту же synthesis без fullscreen draw. Dimensions integer1..1024. Это size native target, не окно и не разрешение атласа спрайта. `render` может масштабировать результат на окно. Возвращаемый sprite — принадлежащий world ресурс; не храните ID после dispose/resize как независимый asset.

`world.add(target)` register Re2DSprite roots once; target поддерживается existing `$` selector/wrapper/node/array resolution. Attachments имеют native mirror. `remove(target)` unregister; ordinary hide не unregister. Registry удерживает nodes, dispose releases references, не удаляя их sprite resources. Узлы без rot_sprite не формируют изображения для кадра World; add — не generic entity renderer. Resolved sample depth доступна для anime; pixel/v1 используют fallback image depth. Поля узла со спрайтом и поддерживаемые ограничения — [sprite integration](RE2DSPRITE_WORLD.md).

## Queries и boundaries

`cellAt(x,y)` returns index/null. `spanAt(x,y,h)` returns global span index/null. XY intervals half-open `[x,x+w)`/`[y,y+h)`, free height floor-inclusive/ceiling-exclusive, включая slopes. Высота центра изображения определяет выбор span.

`support(x,y,feet,bodyHeight,step=0)` → `{span,height,ceiling}` или null. Выбирает самый высокий достижимый пол при достаточном headroom; bodyHeight>0, step≥0. Это point support, не footprint. `blocked(x,y,radius,bottom,top)` → boolean, статический circle×height против wall geometry/portal closure; не sweep и не полный outside-cell/vertical collision solver. Для controller дополнительно проверяйте support, подшаги и footprint probes.

`ray(from,to)` uses `{x,y,height}` endpoints, returns nearest `{fraction,x,y,height,wall,span,ceiling}`/null. Wall/span fields описывают primitive type; не предполагайте, что оба valid одновременно. Baked import использует complete primitive fallback, пока cell-ray coverage не доказана.

`lightAt(x,y,h)` → `{r,g,b,level}`/null. Level = mean RGB. Это native deterministic approximation с ambient/relevant dynamic contributions, zero normal/depth query convention, без framebuffer. Emissive texture/fog/postprocess perceived brightness не входит в этот gameplay query. Значения света могут превышать1; final color clamp происходит позже.

`surface(id)` → snapshot `{kind,primitive,cell,span}` + material(name)/sky(enabled=true). kind wall0/floor1/ceiling2. Wall ownership fields могут быть -1. При invalid id null. Canonical IDs действуют только для данного topology/index domain, setters сохраняют id, не semantic tag. `span(id).info()` возвращает light/fog metadata, не геометрию span.

## Lighting defaults и порядок

```js
world.lighting({mode:'classic',enabled:true,dynamic:true,shadows:true,
  orientationContrast:true,orientationStrength:.06,distanceScale:.001});
world.span(0).lighting({level:.35,color:'#ffffff'}).fog({density:.002,start:100,color:'#263044'});
```

`world.lighting` полная configuration, mode only classic. Public wrapper defaults при omitted fields: enabled=true, dynamic=false, shadows=false, orientationContrast=true, orientationStrength=.06, distanceScale=0. Эти defaults отличаются от authored JSON config: dynamic=true, distanceScale=.001. Передавайте значения явно при switch. Span light/fog setters partial; span info fields: level/r/g/b/fogDensity/fogStart/fogR/fogG/fogB. Level0..1, RGB0..1, density/start≥0. OrientationStrength0..1, distanceScale≥0.

Собственная classic модель: base=level*(1+strength*(abs(nx)-abs(ny)))/(1+max(0,depth)*distanceScale), если orientation enabled. Dynamic contribution внутри radius: intensity*flicker*(1-distance/radius)^2*normalResponse*shadowVisibility, с RGB light. NormalResponse = max(0,dot(normal,lightDirection)), либо1 при query zero normal. Shadow ray учитывает wall segment heights и solid floor/ceiling planes.

Material order: albedo×classic/direct normal-aware lighting → emissive×strength → fog → transparent composition → existing postprocess. Fog visibility=exp(-density*max(0,depth-start)). Это независимые Re2D equations, не COLORMAP tables/GLSL GZDoom.

## Dynamic light handles

`world.light(options)` creates native generation handle. Defaults x/y/h=0, radius100, intensity1, white, shadowfalse. Radius>0≤1e6, intensity0..100; finite values. Methods at(x,y), height(h), radius(r), intensity(v), color(c), shadow(bool), life(seconds), flicker({min,max,rate,seed}), info(), remove(). Config methods chain; remove возвращаемое значение не является world handle.

Info fields x/y/h/radius/intensity/r/g/b/shadow/remaining/flickerMin/flickerMax/flickerRate/flickerSeed. Life0 постоянный, положительный истекает через native game dt. После remove/expiry поколения защищают от stale accesses. Flicker defaults min=.5,max=1,rate=9,seed=42; min≥0,max≥min≤100,rate0..1000. Native deterministic visual state не требует Math.random callbacks.

128 lights total,16 selected references/span,16 shadow candidates. All128 eligible candidates сохранены masks, selected deterministic native slot order; при remove next slot продвигается. Это budget policy, не highest-brightness ranking. Sparse per-light reached-span lists repair only dirty lights/touched span rows. Portal/lift changes invalidate intersecting light volumes. Shadow cache хранит per-light local chunks, но atlas repack/upload выполняется целиком при изменении участвующего chunk.

## Material bank, transparency, sky, decals

`material(name,{albedo,normal?,emissive?,emissiveStrength=1,uScale=1/64,vScale=1/64,blend='masked',opacity=1})` owns independent RGBA PNG copies. name<64bytes, max64materials, texture width/height1..2048. Установка того же имени заменяет material. Optional channels можно опустить; albedo обязателен. Missing/invalid PNG rejects config. Normal tangent basis выводится из wall direction/plane, topology не меняется. Без normal map normal sampling path не нужен.

`surface(id).material(name)` assigns registered bank entry. Default masked cuts coverage alpha<128. Opaque/masked write depth; translucent/additive center-sorted far-to-near после непрозрачного мира и спрайтов, stable ID ties, preserve opaque owner/depth. OIT и exact intersecting transparency не реализованы. Opacity0..1. Shadows geometry-based, без per-texel alpha transmission. Adjacent texture sets share sampler bindings without reordering geometry; это не объединение всех surfaces в один draw.

`sky({texture?,color?})`: panorama/color background; default color white. `surface(ceilingId).sky(true)` только для ceiling; исключает visual ceiling sample, сохраняя support/headroom/gameplay bounds. Не giant sphere mesh.

`decal({surface,material,u=0,v=0,width=16,height=16,life=0})` → native handle `{remove()}`. Max128. Positive rectangle, native lifetime; target opaque/masked, not sky/translucent/additive. Wall UV — distance along segment и height относительно wall bottom; floor/ceiling UV — position относительно cell origin. Material uScale/vScale применяет texture repeat. Decal shared shading сохраняет base depth/owner; independent color не наследует wall tint. Handle generation rejects stale removes.

## Изменение геометрии

`portalClosed(id,boolean)` меняет binary state, derived closure wall, collision/rays/visibility/light propagation/shadow invalidation. Один portal закрывает все свои openings. API smooth fraction door.open отсутствует. `span(id).heights(bottom,top)` transactionally changes valid interval; prevents overlap/headroom/portal ownership conflicts. Runtime slope boundary edits с portal adjacency отвергаются; гарантированный lift use — flat spans. Static slopes supported. Движение passengers, falling/jumping и столкновения игровых узлов не выполняются автоматически.

## Перезагрузка и жизненный цикл

`reloadJSON(text)`/`reload(path)` transactionally replace world geometry; error оставляет previous world. `reload(path)` читает указанный файл, не меняя watch target автоматически. `watch(path)` enables native file watcher, watch('') отключает. load enables watch только при engine hot reload. Interval .35s на native update boundaries; invalid edit fills reloadError, successful replace increments reloadCount.

Спрайт roots, material/sky bank и dynamic lamps сохраняются. Incoming authored static lighting заменяет old authored static lamps/ambient; dynamic handles сохраняют slot/generation. Pool exhaustion rejects replacement до swap. Script span ambient сохраняется только без нового authored lighting и matching span domain. Indexed surface settings — только matching wall/span/cell domains. Изменение domain деактивирует decals. Совпадение counts не означает semantic совпадение объектов: игра должна reassociate indices после authoring changes.

Material textures можно перечитать повторным material(name,options); отдельного автоматического material-file watch контракта нет. Character asset hot reload принадлежит existing Re2DSprite wrapper. Compiled file publishing atomic; authored/baked schemas — [formats](RE2D_WORLD_FORMAT.md).

`dispose()` idempotent, subsequent world operations throw disposed-resource errors. Reentrant render/registry mutations во время frame отвергаются. World output sprite/resources недействительны после disposal. Light/decal handles привязаны к своему world, их нельзя переносить между instances.

## Диагностика и полный profiler snapshot

`debug.view(name)` chooses one of13 native modes; `debug.renderStats()` = info(); `debug.visibility()` returns last-frame spans/surfaces arrays, не cells и не direct GPU queues.

| View | Что показывает |
| --- | --- |
| final | обычный shaded output |
| cell-id / span-id | ownership current sample |
| bsp | реальный native owner node |
| portals | near-clipped portal windows overlay |
| depth / owner | projected sample depth / primitive ownership |
| light-level / dynamic-light-count | native light response / selected references |
| shadow-mask | shadow visibility для eligible lights |
| normal | sampled tangent-space material normal |
| emissive | emissive contribution до fog |
| overdraw | actual covered GPU fragments including light/decal passes, saturates255 |

Overdraw использует GPU даже при CPU-selected world; desktop diagnostic only. Web GPU/overdraw acceptance не заявляется. CPU reference сохраняется, но это не свидетельство свежего Web build.

| info fields | Значение |
| --- | --- |
| walls/spans/cells/portals/surfaces/segments/materials/lights/decals | resident primitive/pool counts; segments = wall BSP fragments |
| visibleCells/visibleSpans/visibleSurfaces/cellsRejected/surfacesRejected/culledSurfaces | last visibility set; rejected и culled surfaces aliases |
| bspNodesVisited/portalsTested | traversal work |
| lightSpanPairs/lightOverflow/lightUpdates | selected span references / excess candidates / dirty light updates |
| lightsAfterCull/shadowedLights | relevant visible lighting / selected shadow count |
| actors/actorCandidates/composedActors | ссылки на узлы со спрайтами / спрайты с присоединёнными изображениями в кадре / видимые изображения; имена полей сохранены для совместимости |
| posesUpdated/posesDeferred/poseBudget/poseStep | synthesis scheduler state |
| gpuDraws/drawCalls/internalTriangles/gpuMaterialBatches/gpuShadowUpdates | actual draws/aliases/fullscreen triangles/sampler batches/rebuilt chunks |
| frameMs/visibilityMs/lightCullMs/surfaceMs/actorMs/compositionMs/uploadMs | wall stage times; stage meaning differs CPU/GPU |
| shadowMs/gpuSubmitMs/gpuCompletionWaitMs/gpuWait | CPU construction/submission/fence wait configuration/result |
| cpuFramePayloadBytes/cpuMaterialPayloadBytes/gpuTexturePayloadBytes/gpuBufferPayloadBytes | explicit resident payload categories |
| bakedTopology/bakedLighting | imported precomputed data flags |
| reloadCount/reloadError | watcher/reload result |
| backend/width/height | diagnostic backend label/current native target dimensions |

Metrics относятся к last native world frame, не whole engine frame. GPU surfaceMs включает recording/render service work; CPU compositionMs включает композицию спрайтов, декалей и прозрачных поверхностей. Draw count не character mesh complexity: specialized path использует один fullscreen triangle на draw. Counters до первого frame не являются workload measurement.

`profile({gpuWait:true})` waits completion for benchmark; false default measures CPU submission without waiting GPU. shadowMs — CPU cache construction/upload recording; gpuSubmitMs — submission; gpuCompletionWaitMs — fence waiting. Hardware GPU timestamps отсутствуют. Memory payload исключает allocator/driver overhead, temporary transfer buffers, shared engine resources, Re2DSprite authoring/supersampling. Это не total process/VRAM measurement.

## Pose policy и измерения

`quality` partial update; wrapper default poseBudget=1,poseStep=3°. Budget0=unlimited, integer0..4096; step0=off,range0..45°. Dirty visible candidates synthesize round robin, deferred renders cached pose. Один спрайт с присоединённым оружием формирует несколько изображений для кадра. Sprite animation clocks остаются existing wrapper state; native world owns expensive synthesis/composition.

Static stress flushes initial poses with unlimited policy before warmup. Cold initial anime synthesis дорогая; static warm output не доказывает dynamic throughput. [Performance report](../RE2D_WORLD_PERF.md) содержит provenance и ограничения.

## Границы и evidence

Rectangular XY cells only, binary doors, no automatic entity physics/controller, center-sorted transparency, geometric shadows, conservative orthographic/outside visibility, complete imported-ray fallback; whole shadow atlas upload after local chunk change. Generic meshes/ECS/PBR/SSR/GI/ray tracing/volumetric raymarching не являются world scope. No GZDoom compatibility runtime/code/shader/asset import.

Runnable demos: parent golden lab, full acceptance child, Dust2 interpretation. Native ASan/UBSan tests, public renderer/lab/Dust2/Studio suites, six golden comparisons и A/B/C benchmark evidence сохранены в [implementation report](RE2D_RENDERER_IMPLEMENTATION_PLAN.md), [document audit](RE2D_DOCUMENT_ACCEPTANCE_AUDIT.md) и SDK_HANDOFF. Hosted CI/GZDoom runtime observations не выполнены. Документ не заменяет execution evidence.
