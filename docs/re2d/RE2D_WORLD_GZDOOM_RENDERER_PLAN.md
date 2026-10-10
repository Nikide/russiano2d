# Re2D World Renderer

# Большой план переосмысления GZDoom-рендера без превращения Russiano2D в 3D-движок

**Проект:** Russiano2D / Re2D World\
**Референс поведения:** Doom / GZDoom\
**Реализация:** новая, native C + SDL3/SDL_GPU\
**Публичный API:** только `$`\
**Статус:** архитектурная конституция + implementation plan + acceptance
gates

------------------------------------------------------------------------

# 0. Цель

Нужен современный Re2D World renderer, который берёт у GZDoom правильные
уроки: BSP-видимость, sector/area lighting, fake contrast, dynamic
lights, brightmaps/emissive, fog, portals, multi-height world,
sprite/world lighting, culling и удобную отладку --- но **не переносит
код GZDoom и не превращает Russiano2D в generic 3D engine**.

Формула:

``` text
наблюдаем GZDoom
        ↓
описываем требуемое поведение
        ↓
──────── CLEAN BOUNDARY ────────
        ↓
проектируем решение из законов Re2D
        ↓
пишем своё на C + SDL_GPU
        ↓
наружу отдаём только `$`
```

Мы не делаем порт GZDoom. Мы делаем **GZDoom-inspired Re2D renderer**.

------------------------------------------------------------------------

# 1. АБСОЛЮТНЫЙ ЗАКОН --- Re2D WORLD ОСТАЁТСЯ 2D

Правильная модель:

``` text
2D spatial map
    +
BSP in XY
    +
height / VerticalSpans
    +
constrained surfaces
    +
portals
    +
Re2DSprite
        ↓
Re2D projection
        ↓
depth/composition
        ↓
lighting
        ↓
ordinary 2D frame
```

Разрешённые world primitives:

``` text
Re2DCell
VerticalSpan
Re2DPortal
WallSurface
FloorSurface
CeilingSurface
SlopeSurface
BillboardSurface
Re2DSprite
```

Запрещено вводить как основу мира:

``` text
GenericMesh
MeshRenderer
SceneNode3D
ModelComponent
TransformComponent
EntityComponentSystem
ArbitraryTriangleWorld
Generic3DPhysics
```

GPU использовать можно и нужно. Внутренние triangles для rasterization
допустимы. **GPU triangles не являются world model.**

------------------------------------------------------------------------

# 2. АБСОЛЮТНЫЙ ЗАКОН --- `$` СНАРУЖИ, C ВНУТРИ

Пользователь должен видеть примерно это:

``` js
const world = $.re2dWorld.load('maps/factory.re2dworld');

world.lighting({
    mode: 'classic',
    dynamic: true,
    shadows: true
});

const alarm = $('<light#alarm>')
    .at(22, 8)
    .height(2.4)
    .color('#ff2020')
    .radius(10)
    .intensity(1.2);
```

Но hot path обязан быть:

``` text
JS `$`
  │ create/configure/query
  ▼
QuickJS binding
  ▼
native C
  ├── BSP
  ├── visibility
  ├── portals
  ├── spans
  ├── projection
  ├── light culling
  ├── shadows
  ├── batching
  ├── GPU buffers
  └── SDL_GPU
          ↓
       2D frame
```

**JS отвечает за orchestration. C отвечает за renderer.**

Запрещено:

``` js
for (const wall of world.walls) {
    for (const light of world.lights) {
        // NO: renderer loop in JS
    }
}
```

Запрещено:

``` js
world.onRender(() => {
    bsp.traverse();
    buildWalls();
    uploadBuffers();
});
```

------------------------------------------------------------------------

# 3. GATE 0 --- ЛИЦЕНЗИОННАЯ / CLEAN-ROOM ГРАНИЦА

До реализации создать:

``` text
docs/re2d/GZDOOM_REFERENCE_RULES.md
docs/re2d/RE2D_RENDERER_BEHAVIOR.md
```

Правила:

1.  GZDoom --- reference implementation результата.
2.  GZDoom source --- не кодовая база Russiano2D.
3.  Не копировать C/C++.
4.  Не переводить C++ → C строка-в-строку.
5.  Не копировать GLSL.
6.  Не копировать lookup tables и magic constants без независимого
    вывода.
7.  Не копировать комментарии.
8.  Не копировать структуры данных один-в-один.
9.  Не копировать assets.
10. Сначала формулировать наблюдаемое требование, потом проектировать
    Re2D-native решение.

Рекомендуемая схема:

``` text
AGENT A — REFERENCE ANALYST
    ↓
RE2D_RENDERER_BEHAVIOR.md
    ↓
──────── CLEAN BOUNDARY ────────
    ↓
AGENT B — IMPLEMENTER
    ↓
NEW Re2D C IMPLEMENTATION
```

Если агент один --- он сначала обязан сделать behavior spec и не
использовать исходник GZDoom как шаблон реализации.

**PASS:** behavior spec существует; в repo нет GZDoom
source/shaders/assets; Re2D implementation объясняется собственной
математикой и data model.\
**FAIL:** «переписал класс на C», «перевёл shader», «поменял имена».

> Инженерная оговорка: это не юридическое заключение. Репозиторий GZDoom
> объявлен GPLv3; отдельные файлы могут содержать иные notices. Для
> Russiano2D безопасное внутреннее правило --- исходный код GZDoom
> только reference, не источник переносимой реализации.

------------------------------------------------------------------------

# 4. КАРТА РЕФЕРЕНСОВ GZDOOM

Главный repository:

https://github.com/ZDoom/gzdoom

License:

https://github.com/ZDoom/gzdoom/blob/master/LICENSE

Rendering root:

https://github.com/ZDoom/gzdoom/tree/master/src/rendering

Hardware renderer:

https://github.com/ZDoom/gzdoom/tree/master/src/rendering/hwrenderer

Hardware scene:

https://github.com/ZDoom/gzdoom/tree/master/src/rendering/hwrenderer/scene

Software renderer:

https://github.com/ZDoom/gzdoom/tree/master/src/rendering/swrenderer

BSP:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_bsp.cpp

Clipper:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_clipper.cpp

Walls:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_walls.cpp

Flats:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_flats.cpp

Lighting:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_lighting.cpp

Dynamic light data:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/hw_dynlightdata.cpp

Sprite lighting:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_spritelight.cpp

Sprites:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_sprites.cpp

Portals:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_portal.cpp

Draw lists:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_drawlist.cpp

Fake-flat compatibility/history:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_fakeflat.cpp

Decals:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_decal.cpp

Sky:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_sky.cpp

Software scene flow:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/swrenderer/scene/r_scene.cpp

Главный material fragment shader --- **только feature inventory, НЕ
копировать**:

https://github.com/ZDoom/gzdoom/blob/master/wadsrc/static/shaders/glsl/main.fp

UDMF/ZDoom spec:

https://github.com/ZDoom/gzdoom/blob/master/specs/udmf_zdoom.txt

Map data / 3D-floor structures --- **смотреть как предупреждение о
compatibility complexity**:

https://github.com/ZDoom/gzdoom/blob/master/wadsrc/static/zscript/mapdata.zs

Wiki:

https://zdoom.org/wiki/

Правило для каждой ссылки:

> Смотреть **какую проблему решает система и какое поведение получает
> игрок**. Не переносить реализацию.

------------------------------------------------------------------------

# 5. GATE 1 --- NATIVE WORLD CORE

Пример направления C-структур, не обязательный ABI:

``` c
typedef struct R2DWorldPoint {
    float x, y, h;
} R2DWorldPoint;

typedef struct R2DWallSurface {
    float ax, ay;
    float bx, by;
    float bottom, top;
    uint32_t material_id;
    uint32_t flags;
} R2DWallSurface;

typedef struct R2DVerticalSpan {
    float bottom, top;
    uint32_t floor_surface;
    uint32_t ceiling_surface;
    float light_level;
    uint32_t light_rgb;
} R2DVerticalSpan;

typedef struct R2DCell {
    uint32_t first_span, span_count;
    uint32_t first_surface, surface_count;
    uint32_t first_portal, portal_count;
} R2DCell;
```

BSP делит только XY:

``` text
L(P) = nx*x + ny*y - d
FRONT / BACK / ON
```

Height живёт в leaf/cell:

``` text
BSP leaf
   ↓
Re2DCell
   ├── polygon2D
   ├── spans[]
   ├── portals[]
   └── surfaces[]
```

**PASS:** C умеет load world, cellAt(x,y), spanAt(x,y,h), BSP traversal
и surface enumeration. JS в этих вычислениях не участвует.

------------------------------------------------------------------------

# 6. GATE 2 --- CAMERA / PROJECTION

``` c
typedef struct R2DWorldCamera {
    float x, y, h;
    float yaw, pitch;
    float fov;
    float near_plane;
} R2DWorldCamera;
```

Для точки `P=(x,y,h)` и камеры `C=(cx,cy,ch)`:

``` text
D = P - C

x' = cos(yaw)*Dx - sin(yaw)*Dy
z' = sin(yaw)*Dx + cos(yaw)*Dy
y' = Dh

y'' = cos(pitch)*y' - sin(pitch)*z'
z'' = sin(pitch)*y' + cos(pitch)*z'

s = focal / z''
screenX = centerX + x'*s
screenY = centerY - y''*s
```

Публично:

``` js
$.re2dWorld.camera({
    x: 12, y: 8, h: 1.65,
    yaw: 90, pitch: -4, fov: 90
});
```

**PASS:** FPS, oblique и top-down-ish camera используют одну карту;
камера native; generic Camera3D node не появился.

------------------------------------------------------------------------

# 7. GATE 3 --- BSP VISIBILITY + CLIPPING

GZDoom reference: `hw_bsp.cpp`, `hw_clipper.cpp`.

Re2D flow:

``` text
camera
  ↓
BSP near-side traversal
  ↓
cell candidate
  ↓
portal/angular clipping
  ↓
VerticalSpan visibility
  ↓
visible surface queue
```

Frame scratch native:

``` c
typedef struct R2DVisibilityFrame {
    uint32_t *visible_cells;
    uint32_t visible_cell_count;
    uint32_t *visible_spans;
    uint32_t visible_span_count;
    uint32_t *visible_surfaces;
    uint32_t visible_surface_count;
} R2DVisibilityFrame;
```

Не отдавать эти массивы JS каждый frame. Debug snapshot разрешён:

``` js
console.log($.re2dWorld.debug.visibility());
```

**PASS:** на карте 100+ cells renderer submits только реально видимый
subset; JS CPU не растёт с количеством world surfaces.

------------------------------------------------------------------------

# 8. GATE 4 --- CONSTRAINED SURFACES

Renderer знает:

``` text
WALL
FLOOR
CEILING
SLOPE
BILLBOARD
RE2D_SPRITE
```

Wall authoritative representation:

``` text
A(x,y) → B(x,y)
bottom
top
material
```

Допустимо внутри GPU:

``` text
WallSurface → 2 internal triangles → rasterizer
```

Недопустимо:

``` text
world → generic mesh conversion → потеря BSP/span semantics
```

Slope может быть:

``` text
h(x,y) = a*x + b*y + c
```

**PASS:** walls/floors/ceilings/slopes, perspective-correct textures,
clipping, depth; наружу нет generic mesh API.

------------------------------------------------------------------------

# 9. GATE 5 --- CLASSIC LIGHTING

Сначала сделать красивую сцену **без dynamic lights**.

``` c
typedef struct R2DSpanLight {
    float level;
    float r, g, b;
    float fog_density;
    float fog_r, fog_g, fog_b;
} R2DSpanLight;
```

Собственная модель:

``` text
texture
  × span light
  × orientation contrast
  × distance attenuation
  = classic Re2D lighting
```

Не копировать Doom/GZDoom COLORMAP tables или light equations.

Сделать собственную функцию:

``` c
float r2d_classic_light_curve(float level, float distance);
```

Пример независимого fake contrast:

``` c
float r2d_wall_orientation_bias(float nx, float ny)
{
    float axis = fabsf(nx) - fabsf(ny);
    return 1.0f + axis * 0.06f;
}
```

Коэффициенты подобрать визуальными тестами, а не брать из GZDoom.

Публично:

``` js
$.re2dWorld.lighting({
    mode: 'classic',
    distanceFade: true,
    orientationContrast: true
});
```

**PASS:** сцена уже объёмная и читаемая только на span light +
distance + orientation.

------------------------------------------------------------------------

# 10. GATE 6 --- MATERIAL SYSTEM

GZDoom `main.fp` смотреть только как список возможностей. Re2D shader
написать с нуля.

``` c
typedef struct R2DMaterial {
    R2DTextureHandle albedo;
    R2DTextureHandle normal;
    R2DTextureHandle emissive;
    float emissive_strength;
    uint32_t flags;
} R2DMaterial;
```

V1:

``` text
required: albedo
optional: emissive
optional: normal
```

Classic:

``` text
albedo × classic light
```

Lit:

``` text
albedo × (span + dynamic) + emissive
```

Normal-aware:

``` text
albedo × lighting(normal) + emissive
```

`$`:

``` js
$.re2dWorld.material('brick', {
    albedo: 'brick.png',
    normal: 'brick_n.png',
    emissive: 'brick_e.png'
});
```

**PASS:** material without normal map has cheaper path; никакого JS
shader callback.

------------------------------------------------------------------------

# 11. GATE 7 --- EMISSIVE / BRIGHT

``` text
lit = albedo * light
final = lit + emissive * strength
```

Emissive appearance и world light --- разные понятия:

``` js
$.re2dWorld.material('red-lamp', {
    albedo: 'lamp.png',
    emissive: 'lamp_e.png',
    emissiveStrength: 1.8
});

$('<light>')
    .at(20, 12)
    .height(2.1)
    .color('#ff3018')
    .radius(7);
```

**PASS:** emissive виден в темноте и не обязан создавать dynamic light.

------------------------------------------------------------------------

# 12. GATE 8 --- DYNAMIC LIGHTS ТОЛЬКО В C

``` c
typedef struct R2DLight {
    float x, y, h;
    float radius;
    float intensity;
    float r, g, b;
    uint32_t flags;
    uint32_t cell_hint;
} R2DLight;
```

Публично:

``` js
const flash = $('<light>')
    .at(player.x, player.y)
    .height(player.eyeHeight)
    .radius(6)
    .intensity(2.0)
    .color('#ffb060')
    .life(0.06);
```

JS не делает affected-cell search, radius tests, portal traversal,
surface pairing, GPU upload loops.

Re2D culling:

``` text
light
  ↓
cellAt(light.xy)
  ↓
BSP/portal propagation
  ↓
affected cells
  ↓
affected spans
  ↓
affected surfaces
```

Budgets:

``` text
max visible lights
max lights per cell/span
max shadowed lights
```

**PASS:** stress scene 128 lights; большая часть culled; JS profiler не
показывает renderer loops.

------------------------------------------------------------------------

# 13. GATE 9 --- Re2D SHADOWS

Не копировать GZDoom shadow implementation.

Начать с Re2D-native wall occlusion.

``` text
        LIGHT
          *
         / \
        /   \
       A─────B   wall
        \     \
         \     \ shadow region
```

C знает:

``` text
light (x,y,h)
wall A/B
wall.bottom/top
receiver span
```

Height test определяет, блокирует ли wall свет на нужной высоте.

Внутренняя реализация может быть:

-   analytic;
-   projected polygons;
-   low-res shadow mask;
-   screen-space mask.

Выбрать после benchmark, а не по моде.

Quality:

``` text
none / fast / quality
```

`$` может задавать quality, но не implementation.

**PASS:** дверь меняет тень; верхний span учитывается; 16 shadowed
lights укладываются в budget.

------------------------------------------------------------------------

# 14. GATE 10 --- FOG

``` text
fogFactor = f(projectedDepth, spanFogDensity)
final = mix(fogColor, litColor, fogFactor)
```

``` js
$.re2dWorld.span('basement').fog({
    color: '#26322b',
    density: 0.035,
    start: 4
});
```

**PASS:** разные spans имеют разный fog; Re2DSprite получает совместимый
fog.

------------------------------------------------------------------------

# 15. GATE 11 --- PORTALS

Reference: `hw_portal.cpp`, но модель своя.

``` c
typedef struct R2DPortalOpening {
    float bottom, top;
} R2DPortalOpening;

typedef struct R2DPortal {
    uint32_t cell_a, cell_b;
    float ax, ay, bx, by;
    uint32_t first_opening;
    uint16_t opening_count;
    uint32_t flags;
} R2DPortal;
```

Один XY boundary может иметь несколько openings:

``` text
same XY
├── opening 0: h 0..3
├── solid:     h 3..6
└── opening 1: h 6..9
```

**PASS:** room-over-room; multiple openings; visibility/light/collision
используют одну authoritative geometry.

------------------------------------------------------------------------

# 16. GATE 12 --- Re2DSprite В ТОМ ЖЕ СВЕТЕ

``` text
Re2DSprite
  ↓
world position
  ↓
cell/span
  ↓
span ambient
  + relevant dynamic lights
  ↓
Re2DSprite synthesis/composition
  ↓
world depth
```

Никакого JS per-frame glue:

``` js
// NO
pig.onEveryFrame(() => {
    const lights = world.getLights(...);
    pig.setLighting(lights);
});
```

Нормально:

``` js
const pig = $.re2dSprite
    .from('pig.character.json', {id:'pig-01'})
    .at(14, 22)
    .re2dMotion('idle');
```

World integration native.

**PASS:** свинья входит из тёмной комнаты в красную; muzzle flash
освещает actor + weapon + wall + floor; JS frame loop отсутствует.

------------------------------------------------------------------------

# 17. GATE 13 --- DEPTH / OWNER COMPOSITOR

Минимум:

``` text
color buffer
depth buffer
optional owner/category buffer
```

World surfaces и Re2DSprite используют одну depth convention после
projection.

**PASS:** actor за стеной скрывается; мост закрывает actor снизу с
правильного угла; transparent path документирован.

------------------------------------------------------------------------

# 18. GATE 14 --- SDL_GPU, НИКАКОГО ВТОРОГО BACKEND

``` text
Re2D World C
   ↓
SDL_GPU buffers/textures/pipelines
   ↓
Re2D shaders
   ↓
2D render target
   ↓
existing R2D composition
```

Не создавать OpenGL-only/Vulkan-only параллельный renderer.

GZDoom GLSL не копировать. Сначала написать Re2D shader spec, потом
shader с нуля.

**PASS:** gameplay JS не знает о GPU pipelines/buffers.

------------------------------------------------------------------------

# 19. GATE 15 --- NATIVE BATCHING

``` text
BSP visibility
   ↓
visible handles
   ↓
native queue builder
   ↓
opaque
masked
transparent
Re2DSprite
   ↓
GPU submit
```

Debug API:

``` js
console.log($.re2dWorld.debug.renderStats());
```

Пример результата:

``` json
{
  "visibleCells": 18,
  "visibleSurfaces": 412,
  "culledSurfaces": 2381,
  "drawCalls": 37,
  "dynamicLights": 24,
  "lightsAfterCull": 8,
  "shadowedLights": 3
}
```

------------------------------------------------------------------------

# 20. GATE 16 --- TRANSPARENCY

Категории:

``` text
OPAQUE
MASKED
TRANSLUCENT
ADDITIVE
```

Не решать OIT в v1. Определить стабильный ordering.

Тесты: решётка, окно, дым, additive flash, actor за/перед окном, два
translucent слоя.

------------------------------------------------------------------------

# 21. GATE 17 --- SKY

Reference: `hw_sky.cpp`.

Re2D sky --- специальный background surface, а не giant 3D sphere mesh.

V1 достаточно texture/color/panorama-like backdrop, подходящего текущей
projection.

------------------------------------------------------------------------

# 22. GATE 18 --- DECALS

Reference: `hw_decal.cpp`.

Re2D decal:

``` text
target WallSurface
+ local surface position
+ size
+ texture
+ lifetime
```

``` js
$('<decal>', {texture:'bullet-hole.png'})
    .onSurface(hit.surface)
    .atUV(hit.u, hit.v);
```

Native pool, bounded count, no JS frame maintenance.

------------------------------------------------------------------------

# 23. GATE 19 --- MOVING WORLD

Doors/lifts меняют authoritative Re2D data.

``` text
Door → portal/wall state
Lift → span floor height
Moving platform → constrained span/surface state
```

Dirty flags локальные:

``` text
visibility
collision
lighting
shadow cache
GPU geometry
```

``` js
$('<door#red>').open(0.7);
```

**PASS:** одна операция меняет visual + collision + portal visibility +
light propagation без пяти JS callbacks.

------------------------------------------------------------------------

# 24. GATE 20 --- STATIC LIGHT ASSOCIATIONS

Compiler может заранее посчитать:

``` text
static light → candidate cells
static light → candidate spans/surfaces
```

Runtime комбинирует static + dynamic lists.

Не делать GI baker до необходимости.

------------------------------------------------------------------------

# 25. GATE 21 --- OPTIONAL NORMAL MAPS

Wall tangent basis выводится из направления стены и vertical axis.
Floor/ceiling basis известен из surface equation.

Normal map улучшает lighting, **не меняя topology**.

**PASS:** material без normal дешевле; никакой imported mesh tangent
requirement.

------------------------------------------------------------------------

# 26. GATE 22 --- НИКАКОГО PBR ДО 1.0

Не нужны сейчас:

``` text
metallic workflow
SSR
reflection probes
realtime GI
ray tracing
volumetric raymarching
virtual geometry
```

Сначала довести classic + dynamic + shadow + emissive + fog + normal.

------------------------------------------------------------------------

# 27. GATE 23 --- PUBLIC `$` API

Хорошо:

``` js
const world = $.re2dWorld.load('factory.re2dworld');
world.lighting({mode:'classic', dynamic:true, shadows:true});

const light = $('<light>')
    .at(4, 7)
    .height(2)
    .color('#ff8844')
    .radius(8);
```

Плохо:

``` js
const pipeline = $.gpu.createPipeline(...);
world.onRender(() => renderer.submit(...));
```

JS wrappers --- handles к native objects. Не дублировать authoritative
world state в JS.

------------------------------------------------------------------------

# 28. GATE 24 --- C API ПОД `$`

Пример внутреннего API:

``` c
R2DWorldHandle r2d_world_load(const char *path);
void r2d_world_destroy(R2DWorldHandle world);
void r2d_world_set_camera(R2DWorldHandle world, const R2DWorldCamera *camera);
R2DLightHandle r2d_world_light_create(R2DWorldHandle world, const R2DLightDesc *desc);
void r2d_world_light_update(R2DWorldHandle world, R2DLightHandle light, const R2DLightDesc *desc);
void r2d_world_light_destroy(R2DWorldHandle world, R2DLightHandle light);
void r2d_world_render(R2DWorldHandle world, R2DRenderContext *ctx);
```

Binding только parse/validate/convert/call/return. Renderer logic в
binding запрещена.

------------------------------------------------------------------------

# 29. GATE 25 --- НИКАКОГО ECS

`$('<light>')` не означает LightComponent.

Не делать:

``` text
Entity
 ├── TransformComponent
 ├── LightComponent
 └── RenderComponent
```

Существующая `$` node/tag/wrapper philosophy остаётся.

------------------------------------------------------------------------

# 30. GATE 26 --- DEBUG VIEWS

Обязательные:

``` text
FINAL
CELL_ID
SPAN_ID
BSP
PORTALS
DEPTH
OWNER
LIGHT_LEVEL
DYNAMIC_LIGHT_COUNT
SHADOW_MASK
NORMAL
EMISSIVE
OVERDRAW
```

``` js
$.re2dWorld.debug.view('cell-id');
```

Все debug buffers native.

------------------------------------------------------------------------

# 31. GATE 27 --- PROFILING

Native counters:

``` text
frame_ms
visibility_ms
surface_build_ms
light_cull_ms
shadow_ms
gpu_submit_ms
bsp_nodes_visited
cells_visible
cells_rejected
spans_visible
surfaces_visible
surfaces_rejected
lights_total
lights_visible
light_surface_pairs
shadowed_lights
draw_calls
internal_triangles
re2dsprites_visible
```

`internal_triangles` --- GPU metric, не world model.

------------------------------------------------------------------------

# 32. GATE 28 --- PERFORMANCE STRESS

``` text
Scene A:
  100 cells
  1,000 surfaces
  16 visible cells
  8 dynamic lights
  10 Re2DSprites

Scene B:
  500 cells
  8,000 surfaces
  30 visible cells
  64 dynamic lights total
  12 relevant lights
  30 Re2DSprites

Scene C:
  room-over-room factory
  128 dynamic lights total
  16 shadow candidates
  50 Re2DSprites
```

Критерий: cost зависит прежде всего от visible/relevant set, не от
полного размера карты.

------------------------------------------------------------------------

# 33. GATE 29 --- RENDER LAB

Создать `demos/re2d_world_renderer_lab/`:

1.  светлая комната;
2.  тёмная;
3.  красная;
4.  коридор;
5.  дверь;
6.  лестница;
7.  верхний этаж;
8.  room-over-room;
9.  мост;
10. slope;
11. окно;
12. fog room;
13. emissive wall;
14. normal-mapped wall;
15. 16 dynamic lights;
16. moving light;
17. muzzle flash;
18. 3+ Re2DSprite;
19. actor сверху и снизу в одинаковом XY;
20. transparent surface.

------------------------------------------------------------------------

# 34. GATE 30 --- VISUAL REFERENCE NOTES

Для каждой GZDoom-фичи заводить карточку:

``` text
FEATURE:

GZDoom observation:
    что видит игрок

Re2D requirement:
    какое поведение нам нужно

Re2D implementation concept:
    как это выражается через Cell/Span/Portal/Surface

Difference:
    чем Re2D намеренно отличается

License hygiene:
    source/shader/constants/assets not copied
```

Пример bright surface:

``` text
Observation:
    выбранные части материала остаются яркими в тёмной сцене.

Requirement:
    emissive pixels имеют независимый вклад.

Re2D:
    optional emissive texture + native shader.

Not copied:
    GZDoom shader body/uniform layout/constants.
```

------------------------------------------------------------------------

# 35. GATE 31 --- ВОПРОСЫ АГЕНТА ПРИ ЧТЕНИИ GZDOOM

Разрешённые вопросы:

``` text
1. Какую проблему решает файл?
2. Какое наблюдаемое поведение получается?
3. Какие концептуальные входы/выходы?
4. Что является Doom compatibility baggage?
5. Что Re2D вообще не нужно?
6. Как решить это через Cell/Span/Portal?
```

Запрещённые:

``` text
какую функцию скопировать?
какой struct перенести?
какие constants взять?
как перевести C++ на C?
```

------------------------------------------------------------------------

# 36. GATE 32 --- SOFTWARE RENDERER КАК НАПОМИНАНИЕ О 2D

Reference:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/swrenderer/scene/r_scene.cpp

Смотреть flow visibility → walls → planes → masked/translucent →
portals. Не копировать код.

Главный урок: hardware path может быть современным, но world model не
обязан становиться generic 3D.

------------------------------------------------------------------------

# 37. GATE 33 --- UDMF КАК FEATURE CHECKLIST

Reference:

https://github.com/ZDoom/gzdoom/blob/master/specs/udmf_zdoom.txt

Использовать для вопроса «какие возможности map authors реально ценят?»
--- per-side light, plane/surface properties, portals, slopes,
transforms, fog и т.д.

`.re2dmap` не становится UDMF clone.

``` text
UDMF feature
   ↓
нужна ли нам возможность?
   ↓
если да — как естественно выразить её в Re2D?
```

------------------------------------------------------------------------

# 38. GATE 34 --- 3D FLOORS НЕ КОПИРУЕМ

Reference complexity:

https://github.com/ZDoom/gzdoom/blob/master/wadsrc/static/zscript/mapdata.zs

Вывод:

``` text
GZDoom compatibility 3D floor
        ≠
Re2D VerticalSpan
```

У нас:

``` text
Cell
 ├── Span 0 {0..3}
 ├── Span 1 {5..8}
 └── Span 2 {10..13}
```

Это базовая модель, а не hack/special.

------------------------------------------------------------------------

# 39. GATE 35 --- LIGHTING ORDER

Зафиксировать и тестировать собственный порядок:

``` text
albedo
  ↓
span/classic light
  ↓
orientation contrast
  ↓
dynamic direct lights
  ↓
shadow visibility
  ↓
optional normal response
  ↓
emissive
  ↓
fog
  ↓
transparency/composition
  ↓
postprocess
```

Не обязаны повторять GZDoom order.

------------------------------------------------------------------------

# 40. GATE 36 --- LIGHT НЕ РАВНО JS THINKER

Для декоративного flicker:

``` js
light.flicker({
    min: 0.5,
    max: 1.0,
    rate: 9,
    seed: 42
});
```

Native C обновляет deterministic visual state.

Не создавать сотни:

``` js
light.onFrame(() => light.intensity(Math.random()));
```

------------------------------------------------------------------------

# 41. GATE 37 --- DETERMINISM

GPU brightness не является gameplay authority.

Если AI нужен уровень света:

``` js
const level = $.world.lightAt(x, y, h);
```

C возвращает deterministic gameplay approximation.

Renderer и gameplay lighting могут использовать общие данные, но
gameplay не читает пиксели framebuffer.

------------------------------------------------------------------------

# 42. GATE 38 --- WORLD QUERY API

Допустимые coarse queries:

``` js
$.world.raycast(...)
$.world.cellAt(x, y)
$.world.spanAt(x, y, h)
$.world.lightAt(x, y, h)
$.world.surfaceAt(...)
```

Не раскрывать:

``` text
internalBspNodes
gpuVertices
lightClusters
renderQueues
```

------------------------------------------------------------------------

# 43. GATE 39 --- COMPILER / BAKER

``` text
.re2dmap
   ↓
validator
   ↓
BSP build
   ↓
cells
   ↓
VerticalSpans
   ↓
portals
   ↓
surface tables
   ↓
visibility data
   ↓
static light associations
   ↓
.re2dworld
```

Runtime не делает тяжёлый authoring build при каждом запуске.

------------------------------------------------------------------------

# 44. GATE 40 --- НИКАКОГО GZDOOM COMPAT LAYER В RUNTIME

Renderer не обязан запускать WAD/UDMF.

Если позже появится importer:

``` text
WAD/UDMF
   ↓ authoring converter
Re2D representation
   ↓
Re2D runtime
```

Doom-specific data после bake исчезает.

------------------------------------------------------------------------

# 45. GATE 41 --- POSTPROCESS

После готового 2D framebuffer разрешены:

``` text
color grading
gamma/contrast
CRT/pixel filters
damage flash
underwater tint
simple bloom
```

Postprocess не меняет world architecture.

------------------------------------------------------------------------

# 46. GATE 42 --- BLOOM ПОСЛЕ EMISSIVE

``` text
high luminance/emissive
   ↓
low-res extraction
   ↓
blur
   ↓
add to final frame
```

Bloom не используется для маскировки плохого lighting.

------------------------------------------------------------------------

# 47. GATE 43 --- SHADOW CACHE

После correctness:

``` text
static light + static walls → cached shadow data
```

Moving door invalidates только локально затронутые lights/regions.

------------------------------------------------------------------------

# 48. GATE 44 --- PORTAL LIGHT PROPAGATION

``` text
light cell
   ↓
portal graph
   ↓
vertical opening test
   ↓
radius/distance
   ↓
neighbor cell
```

Красная лампа не светит через solid wall, начинает светить через
открытую дверь и перестаёт после закрытия.

------------------------------------------------------------------------

# 49. GATE 45 --- C UNIT TESTS

Минимум:

``` text
light outside radius → reject
closed portal → reject
open portal → allow
height outside opening → reject
span overlap → allow
emissive survives darkness
fog increases with depth
wall blocks light at matching height
wall does not block unrelated height span
```

------------------------------------------------------------------------

# 50. GATE 46 --- GOLDEN IMAGE TESTS

Deterministic cameras:

``` text
camera_01_corridor
camera_02_multifloor
camera_03_red_light
camera_04_fog
camera_05_shadow
camera_06_sprite_occlusion
```

CI сравнивает golden images с tolerance. Изменение картинки требует
осознанного approval.

------------------------------------------------------------------------

# 51. GATE 47 --- JS API TESTS

``` js
const light = $('<light>').at(1, 2).height(3);
light.radius(5);
light.color('#ff0000');
assert(light.info().radius === 5);
light.remove();
```

Renderer math/performance тестируется native tests, не JS benchmark
loops.

------------------------------------------------------------------------

# 52. GATE 48 --- MEMORY OWNERSHIP

``` text
World owns:
  BSP
  cells
  spans
  portals
  surfaces
  materials
  static refs

Frame arena owns:
  visibility lists
  light lists
  temporary shadow data
  draw queues
```

Никакого malloc/free на каждую пару light×wall каждый frame.

------------------------------------------------------------------------

# 53. GATE 49 --- HOT RELOAD

Можно hot reload material textures, normal/emissive и compiled map
output там, где безопасно. Но runtime не превращается в editor DB.

------------------------------------------------------------------------

# 54. GATE 50 --- ERRORS НА ЯЗЫКЕ Re2D

Хорошо:

``` text
Re2D World: portal 17 references missing cell 8
Re2D World: span 4 has top <= bottom
Re2D World: overlapping solid spans in cell 12
```

Плохо:

``` text
mesh node invalid
component transform failed
```

------------------------------------------------------------------------

# 55. GATE 51 --- RENDERER 1.0 SCOPE

Обязательно:

``` text
[ ] BSP XY visibility
[ ] Re2DCell
[ ] VerticalSpan
[ ] multiple spans same XY
[ ] portals
[ ] room-over-room
[ ] walls/floors/ceilings/slopes
[ ] depth/composition

[ ] classic span light
[ ] colored span light
[ ] orientation contrast
[ ] distance attenuation
[ ] dynamic colored lights
[ ] native light culling
[ ] portal-aware propagation
[ ] Re2D shadows

[ ] albedo
[ ] emissive
[ ] optional normal maps
[ ] fog

[ ] Re2DSprite lighting
[ ] Re2DSprite occlusion

[ ] debug views
[ ] native profiler
[ ] render lab
[ ] golden images
[ ] public `$`
[ ] C hot paths
[ ] SDL_GPU
```

Не 1.0:

``` text
[ ] PBR
[ ] SSR
[ ] realtime GI
[ ] ray tracing
[ ] volumetric raymarching
[ ] arbitrary world meshes
```

------------------------------------------------------------------------

# 56. GATE 52 --- ФАЗЫ РЕАЛИЗАЦИИ

## PHASE 0 --- Reference audit

Изучить текущий Russiano2D, GZDoom только как reference, написать
behavior spec. **Никакого implementation до spec.**

## PHASE 1 --- Native world data

Cell/Span/Portal/Surface/loader. Gate: C tests.

## PHASE 2 --- BSP visibility

XY BSP, traversal, clipping. Gate: BSP/cell debug view.

## PHASE 3 --- Surface projection

Walls/floors/ceilings/slopes/depth. Gate: render lab без света.

## PHASE 4 --- Classic lighting

Span/color/distance/orientation. Gate: сцена читается без dynamic
lights.

## PHASE 5 --- Materials

Albedo/emissive/normal. Gate: batching + material debug.

## PHASE 6 --- Dynamic lights

Native handles, cell/span culling, GPU data. Gate: 128-light stress.

## PHASE 7 --- Shadows

Height-aware Re2D occluders. Gate: door + multi-floor shadow tests.

## PHASE 8 --- Fog

Per-span + sprite fog. Gate: portal/fog test.

## PHASE 9 --- Re2DSprite integration

Lighting/depth. Gate: pig corridor test.

## PHASE 10 --- Moving world

Doors/lifts/dirty regions. Gate: collision/visibility/light remain
synchronized.

## PHASE 11 --- Debug/profiling

Views/timings/counters.

## PHASE 12 --- Optimization

Только после profiling: arenas, cache, batching, static-light
precompute, shadow cache.

## PHASE 13 --- `$` polish

Docs/examples. Sample game не трогает internals.

## PHASE 14 --- SDK tools

Map validation, BSP/span/light/material previews. Tools редактируют
data, не заменяют code-driven game.

## PHASE 15 --- Renderer 1.0 acceptance

Все mandatory gates + benchmarks + docs.

------------------------------------------------------------------------

# 57. ПРИМЕР ФАЙЛОВОЙ АРХИТЕКТУРЫ

Подстроить под существующий repo; existing code wins.

``` text
src/re2d_world/
  re2d_world.c/.h
  re2d_world_bsp.c/.h
  re2d_world_visibility.c/.h
  re2d_world_surface.c/.h
  re2d_world_light.c/.h
  re2d_world_shadow.c/.h
  re2d_world_material.c/.h
  re2d_world_render.c/.h
  re2d_world_debug.c/.h

src/highlevel/
  re2d_world.js   # wrapper/convenience only

shaders/
  re2d_world_...

tools/
  re2d_world_compiler/
```

Не создавать это дерево механически, если текущая архитектура Russiano2D
уже имеет подходящие места.

------------------------------------------------------------------------

# 58. ШАБЛОН «ПОДСМОТРЕТЬ → ПЕРЕСОЗДАТЬ»

Для каждой функции:

``` text
FEATURE NAME

1. Observable goal
2. GZDoom reference URL
3. Doom compatibility baggage
4. Re2D-native data model
5. Native C responsibility
6. `$` responsibility
7. GPU responsibility
8. Non-goals
9. Correctness tests
10. Performance gate
11. License hygiene statement
```

------------------------------------------------------------------------

# 59. ПРИМЕР --- DYNAMIC LIGHT

Reference:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/hw_dynlightdata.cpp

Sprite lighting:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_spritelight.cpp

Re2D:

``` text
Re2DLight
  ↓
cellAt
  ↓
portal traversal
  ↓
vertical opening
  ↓
radius
  ↓
affected spans/surfaces
```

`$`:

``` js
$('<light>').at(10,20).height(2).radius(8).color('#ff0000');
```

Не делать JS loops, GZDoom structs или copied shader functions.

------------------------------------------------------------------------

# 60. ПРИМЕР --- FAKE CONTRAST

Reference:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_lighting.cpp

UDMF side lighting:

https://github.com/ZDoom/gzdoom/blob/master/specs/udmf_zdoom.txt

Re2D: собственная deterministic orientation-bias function. Коэффициенты
--- наши, через visual tests.

------------------------------------------------------------------------

# 61. ПРИМЕР --- 3D FLOORS → VERTICAL SPANS

Reference:

https://github.com/ZDoom/gzdoom/blob/master/wadsrc/static/zscript/mapdata.zs

Не копировать compatibility machinery. Re2D first-class:

``` text
Cell
 ├── Span {0..3}
 ├── Span {5..8}
 └── Span {10..13}
```

------------------------------------------------------------------------

# 62. ПРИМЕР --- PORTAL

Reference:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_portal.cpp

Re2D:

``` text
Portal
  boundary2D
  cellA/cellB
  verticalOpenings[]
  flags
```

Visibility, collision, sound и light используют одну связь, но
собственные правила прохождения.

------------------------------------------------------------------------

# 63. ПРИМЕР --- MATERIAL SHADER

Reference только как inventory:

https://github.com/ZDoom/gzdoom/blob/master/wadsrc/static/shaders/glsl/main.fp

Сначала Re2D shader spec:

``` text
INPUT:
  UV
  albedo
  optional normal
  optional emissive
  span light
  selected dynamic lights
  fog

OUTPUT:
  color according to current R2D blending convention
```

Только потом shader с нуля.

------------------------------------------------------------------------

# 64. ПРИМЕР --- BSP

Reference:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_bsp.cpp

Re2D:

``` text
node = 2D partition line + children
leaf = Re2DCell refs
height = spans, NOT BSP dimension
```

------------------------------------------------------------------------

# 65. ПРИМЕР --- SPRITE LIGHTING

Reference:

https://github.com/ZDoom/gzdoom/blob/master/src/rendering/hwrenderer/scene/hw_spritelight.cpp

Re2D не повторяет billboard system:

``` text
Re2DSprite
  ↓
cell/span
  ↓
ambient + relevant Re2DLights
  ↓
XYZ/coverage-aware response where practical
  ↓
depth composite
```

------------------------------------------------------------------------

# 66. ЗАПРЕЩЁННЫЕ СОБЛАЗНЫ

Остановить агента при фразах:

``` text
"проще сделать mesh"
"проще взять GZDoom shader"
"проще портировать hw_bsp.cpp"
"сначала сделаем renderer на JS"
"потом вынесем в C"
"давайте ECS для lights"
"давайте SceneNode3D"
"давайте GLTF world runtime"
"давайте Vulkan напрямую"
"давайте сначала PBR"
```

Disposable math prototype допустим. Production vertical slice с первого
раза должен соблюдать:

``` text
$ → C → SDL_GPU
```

------------------------------------------------------------------------

# 67. ПРАВИЛО `$`

``` text
$ = ergonomic public API
C = authority
GPU = execution
```

`$` --- дверь пользователя, не renderer implementation.

------------------------------------------------------------------------

# 68. ПРАВИЛО JS

JS может создавать, удалять, конфигурировать, запускать gameplay events,
делать coarse queries, включать debug/quality.

JS не место для BSP traversal, wall projection, light culling, shadow
construction, draw sorting, GPU upload loops.

------------------------------------------------------------------------

# 69. ПРАВИЛО C

C владеет:

``` text
world
BSP
cells
spans
portals
surfaces
materials
lights
visibility
shadows
render queues
GPU resources
frame scratch
profiling
```

------------------------------------------------------------------------

# 70. ПРАВИЛО GPU

CPU/BSP отвечает:

``` text
что потенциально видно и что потенциально влияет?
```

GPU отвечает:

``` text
быстро нарисовать и осветить уже отобранное.
```

Не лечить brute force GPU плохую world architecture.

------------------------------------------------------------------------

# 71. DEFINITION OF DONE

``` text
ARCHITECTURE
[x] world remains Re2D
[x] no ECS
[x] no generic 3D scene
[x] no generic world meshes
[x] `$` public entry
[x] C hot paths
[x] existing SDL_GPU architecture

WORLD
[x] BSP XY
[x] cells
[x] spans
[x] portals
[x] multiple floors same XY
[x] room-over-room
[x] walls/floors/ceilings/slopes

LIGHT
[x] classic
[x] colored span
[x] fake/orientation contrast
[x] distance
[x] dynamic
[x] culling
[x] shadows
[x] emissive
[x] fog
[x] optional normals

CHARACTERS
[x] Re2DSprite lighting
[x] Re2DSprite depth
[x] muzzle flash affects actor + world

QUALITY
[x] debug views
[x] profiler
[x] render lab
[x] C tests
[x] golden images
[x] stress tests

LICENSE HYGIENE
[x] no copied GZDoom C/C++
[x] no copied GZDoom shaders
[x] no copied GZDoom assets
[x] no line-by-line translation
[x] behavior notes preserved
[x] independent Re2D design documented
```

------------------------------------------------------------------------

# 72. ФИНАЛЬНЫЙ ACCEPTANCE TEST

``` text
                UPPER FLOOR
          pig ─────────────── bridge
            \       red light
             \
============== opening =================
       stairs
          \
           \
     DARK LOWER ROOM
         pig + AK
             |
          doorway
             |
      BLUE FOG CORRIDOR
             |
        player camera
```

Обязательно:

1.  одинаковый XY имеет два spans;
2.  actor сверху и снизу;
3.  красный light сверху;
4.  solid floor блокирует свет;
5.  opening пропускает;
6.  дверь меняет visibility;
7.  дверь меняет lighting propagation;
8.  дверь меняет shadow;
9.  muzzle flash освещает нижнюю свинью;
10. normal wall реагирует;
11. emissive panel виден;
12. fog corridor работает;
13. BSP debug объясняет cells;
14. light debug показывает affected cells;
15. depth debug объясняет occlusion;
16. profiler показывает culling;
17. gameplay JS не содержит render loop.

------------------------------------------------------------------------

# 73. WORK / CODEX CONSTITUTION

Перед каждой крупной фазой перечитать:

``` text
1. Re2D World — 2D.
2. BSP делит XY.
3. Height живёт в VerticalSpans.
4. Generic 3D scene запрещена.
5. ECS запрещён.
6. Re2DSprite остаётся Re2DSprite.
7. Пользователь работает через `$`.
8. `$` вызывает native C.
9. Renderer hot paths живут в C.
10. SDL_GPU — backend, не новая философия.
11. GZDoom — reference поведения.
12. GZDoom source НЕ кодовая база Russiano2D.
13. Ничего не переводить строка-в-строку.
14. Никаких GZDoom shaders/assets.
15. Сначала correctness.
16. Потом profiling.
17. Потом optimization.
18. Любая новая система проходит gate.
```

Главный вопрос:

> Можно ли объяснить систему через 2D BSP + VerticalSpans + constrained
> surfaces + Re2D projection?

Если ответ «мы уже сделали обычный 3D mesh renderer, просто назвали его
Re2D» --- остановить работу и вернуться к последнему gate.

------------------------------------------------------------------------

# 74. ЧТО ИМЕННО МЫ БЕРЁМ У GZDOOM

Не код. Не GPL implementation. Не shaders. Не assets.

Берём список доказавших полезность идей:

``` text
Doom-like spatial visibility
sector/area lighting
fake contrast
distance lighting
dynamic colored lights
bright/emissive materials
fog
portals
multi-height behavior
sprite/world lighting integration
draw categorization
aggressive culling
debuggability
```

И прогоняем каждую через:

``` text
GZDoom idea
   ↓
behavior requirement
   ↓
Re2D-native data model
   ↓
new C implementation
   ↓
SDL_GPU
   ↓
`$` wrapper
```

------------------------------------------------------------------------

# 75. ПЕРВАЯ КОМАНДА АГЕНТУ

``` text
НЕ ПИШИ RENDERER СРАЗУ.

1. Прочитай этот документ полностью.
2. Изучи текущую архитектуру Russiano2D.
3. Найди существующие SDL_GPU/render/batch conventions.
4. Найди текущий `$` binding pattern.
5. Найди текущий Re2DSprite renderer/compositor.
6. Зафиксируй, что можно переиспользовать.
7. Создай GZDOOM_REFERENCE_RULES.md.
8. Создай RE2D_RENDERER_BEHAVIOR.md.
9. Изучай GZDoom только как reference поведения.
10. Не копируй code/shaders/assets/tables.
11. Создай implementation plan по gates.
12. Только после approval начинай native world core.

Любая renderer-функция:
    public `$`
        → binding
        → C
        → SDL_GPU

Никаких production hot paths на JS.
Никакого ECS.
Никакого generic 3D world.
```

------------------------------------------------------------------------

# 76. КОНЕЧНАЯ ФОРМУЛА

``` text
                 GZDOOM
                    │
              OBSERVE ONLY
                    │
                    ▼
          BEHAVIOR / LESSONS
                    │
          ─── CLEAN BOUNDARY ───
                    │
                    ▼
               Re2D WORLD
                    │
        2D BSP + VerticalSpans
                    │
             native C core
                    │
               SDL_GPU
                    │
             Re2D lighting
                    │
              Re2DSprite
                    │
             depth/composite
                    │
                    ▼
             ORDINARY 2D FRAME

PUBLIC GAME API:
                    $
                    │
                    ▼
               C BINDINGS
                    │
                    ▼
              NATIVE Re2D
```

**GZDoom показывает, насколько далеко можно развить Doom-подобную
модель. Russiano2D не должен становиться GZDoom-клоном. Он должен взять
эти уроки и построить из них чистый Re2D renderer.**
