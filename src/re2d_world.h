#pragma once
#include "bsp.h"
#include "re2d_math.h"
#include <stdint.h>

// Specialised RE2D authoring primitives, never a triangle mesh.
typedef struct { float x1,y1,x2,y2,bottom,top; uint32_t color; } R2DWorldWall;
typedef struct { float x,y,w,h,bottom,top; uint32_t floor_color,ceiling_color; float floor_a,floor_b,ceiling_a,ceiling_b; } R2DWorldSpan;
// Topology is XY only. Span references remain indices into the native table.
typedef struct { float x,y,w,h; int first_span,span_count; } R2DWorldCell;
typedef struct { float bottom,top; } R2DWorldOpening;
typedef struct {
    int cell_a,cell_b,first_opening,opening_count;
    float ax,ay,bx,by;
    bool closed;
} R2DWorldPortal;
enum { R2D_WORLD_WALL, R2D_WORLD_FLOOR, R2D_WORLD_CEILING };
typedef struct { int kind,primitive,cell,span; } R2DWorldSurface;
// An independent XY cell BSP; straddling cells remain candidate refs on nodes.
// Cells may stack free intervals, but their XY interiors are disjoint.
typedef struct { float split; int axis,front,back,first_ref,ref_count; } R2DWorldCellNode;
typedef struct { int surface,span,actor; } R2DWorldPixelOwner;
enum { R2D_WORLD_DEBUG_FINAL,R2D_WORLD_DEBUG_CELL,R2D_WORLD_DEBUG_SPAN,R2D_WORLD_DEBUG_DEPTH,
       R2D_WORLD_DEBUG_OWNER,R2D_WORLD_DEBUG_LIGHT_LEVEL,R2D_WORLD_DEBUG_LIGHT_COUNT,R2D_WORLD_DEBUG_NORMAL,R2D_WORLD_DEBUG_EMISSIVE,
       R2D_WORLD_DEBUG_BSP,R2D_WORLD_DEBUG_PORTALS,R2D_WORLD_DEBUG_SHADOW,R2D_WORLD_DEBUG_OVERDRAW };
typedef struct { float left,top,right,bottom; } R2DWorldWindow;
typedef struct {
    int *spans,*surfaces,*queue;
    uint8_t *span_seen,*surface_seen,*queued;
    R2DWorldWindow *windows,*surface_windows;
    int span_count,surface_count,capacity_spans,capacity_surfaces;
    int portals_tested,cells_visible;
    int *node_parents,*cell_nodes;
    uint8_t *node_active;
    int capacity_nodes,capacity_cells,bsp_nodes_visited;
    const R2DWorldCellNode *indexed_nodes;
    uint64_t indexed_revision;
} R2DWorldVisibility;
#define R2D_WORLD_MAX_MATERIALS 64
enum { R2D_WORLD_MASKED,R2D_WORLD_OPAQUE,R2D_WORLD_TRANSLUCENT,R2D_WORLD_ADDITIVE };
typedef struct { uint8_t *pixels; int width,height; } R2DWorldTexture;
typedef struct {
    R2DWorldTexture albedo,normal,emissive;
    float emissive_strength,u_scale,v_scale,opacity;
    int blend;
    char name[64];
    bool used,world_uv,linear;
} R2DWorldMaterial;
#define R2D_WORLD_MAX_LIGHTS 128
#define R2D_WORLD_MAX_DECALS 128
typedef struct {int surface,material;float u,v,w,h,remaining;unsigned generation;bool active;} R2DWorldDecal;
#define R2D_WORLD_LIGHTS_PER_SPAN 16
#define R2D_WORLD_MAX_SHADOWS 16
typedef struct { float level,r,g,b,fog_density,fog_start,fog_r,fog_g,fog_b; } R2DWorldSpanLight;
typedef struct { float x,y,h,radius,intensity,r,g,b; bool active,shadow,is_static; unsigned generation;
    float remaining,age,flicker_min,flicker_max,flicker_rate;uint32_t flicker_seed; } R2DWorldLight;
typedef struct {int *spans,count,capacity;} R2DWorldLightLinks;
typedef struct {int id;float depth;} R2DWorldSortItem;
typedef struct { bool enabled,dynamic,shadows,orientation; float distance_scale,orientation_strength; } R2DWorldLighting;
typedef struct {
    R2DBsp bsp;
    R2DWorldWall *walls;
    R2DWorldSpan *spans;
    int wall_count,span_count;
    R2DWorldCell *cells;
    R2DWorldPortal *portals;
    R2DWorldOpening *openings;
    R2DWorldSurface *surfaces;
    R2DWorldCellNode *cell_nodes;
    R2DWorldTexture sky;
    uint32_t sky_color;
    float sky_yaw; // radians, panorama rotation only
    uint64_t topology_revision;
    uint8_t *surface_sky;
    int cell_count,portal_count,opening_count,surface_count,cell_node_count,cell_root;
    int *span_cells,*cell_refs,*wall_portals;
    int *span_wall_offsets,*span_wall_refs,*cell_portal_offsets,*cell_portal_refs;
    R2DWorldSpanLight *span_lights;
    R2DWorldLight lights[R2D_WORLD_MAX_LIGHTS];
    R2DWorldLightLinks light_links[R2D_WORLD_MAX_LIGHTS];
    uint32_t *span_light_masks;
    uint8_t *span_light_candidates,*light_seen,*light_touched_flags;
    int *light_queue,*light_touched,light_seen_count,light_touched_count,light_updates;
    uint8_t light_dirty_slots[R2D_WORLD_MAX_LIGHTS];
    bool light_full_dirty;
    bool baked_lighting,authored_lighting;
    R2DWorldDecal decals[R2D_WORLD_MAX_DECALS];
    int decal_count;
    uint8_t shadow_mask[R2D_WORLD_MAX_LIGHTS];
    uint64_t shadow_geometry_revision[R2D_WORLD_MAX_LIGHTS];
    R2DWorldLighting lighting;
    uint8_t *span_light_counts;
    int *span_light_refs;
    bool light_dirty,cell_rays_complete;
    int light_count,light_pairs,light_overflow;
    R2DWorldMaterial materials[R2D_WORLD_MAX_MATERIALS];
    int *surface_materials,material_count;
    uint64_t geometry_revision;
    int *wall_openings,*opening_spans_a,*opening_spans_b;
    bool baked_topology;
    R2DWorldSortItem *sort_items;int *transparent_ids;int sort_capacity;
} R2DRe2dWorld;
typedef struct { float t,x,y,height; int wall,span; bool ceiling; uint32_t color; } R2DWorldHit;

// Zero-initialise before first build; failed build leaves the old world intact.
bool r2d_world_build(R2DRe2dWorld *, const R2DWorldWall *, int, const R2DWorldSpan *, int);
void r2d_world_free(R2DRe2dWorld *);
// Highest support not above feet + step and with sufficient headroom.
int r2d_world_support(const R2DRe2dWorld *, float x,float y,float feet,float height,float step);
bool r2d_world_blocked(const R2DRe2dWorld *, float x,float y,float radius,float bottom,float top);
// Parametric ray: origin + direction*t, with explicit near/far. XY BSP traversal.
bool r2d_world_ray(const R2DRe2dWorld *, const float origin[3],const float direction[3],float near_t,float far_t,R2DWorldHit *);
// Final ordinary RGBA8 image plus PRIVATE synthesis depth; no GPU world geometry.
// ortho_height>0 selects orthographic projection; otherwise perspective.
void r2d_world_frame(const R2DRe2dWorld *, const R2DRe2dView *,int w,int h,uint8_t *rgba,float *depth,float ortho_height);
// Compose an already synthesised ordinary 2D sprite at projected depth.
void r2d_world_stamp(const R2DRe2dView *,int w,int h,uint8_t *rgba,float *depth,
                     const uint8_t *sprite,int size,float x,float y,float bottom,float width,float height,float ortho_height);

// Same screen coverage as stamp; permits deferring off-screen sprite synthesis.
bool r2d_world_sprite_visible(const R2DRe2dView *,int w,int h,float x,float y,float bottom,float width,float height,float ortho_height);

// Explicit topology build, preserving the old world on all failures.
bool r2d_world_build_cells(R2DRe2dWorld *,const R2DWorldWall *,int,
    const R2DWorldSpan *,int,const R2DWorldCell *,int,
    const R2DWorldPortal *,int,const R2DWorldOpening *,int,char *,size_t);
// Version 1 .re2dworld JSON, decoded/validated in native C (never renderer JS).
bool r2d_world_load_json(R2DRe2dWorld *,const char *,char *,size_t);
int r2d_world_cell_at(const R2DRe2dWorld *,float,float);
int r2d_world_span_at(const R2DRe2dWorld *,float,float,float);
// Cell BSP near-first traversal. Returns required count; writes at most capacity.
int r2d_world_cells_order(const R2DRe2dWorld *,float,float,int *,int);
const R2DWorldSurface *r2d_world_surface(const R2DRe2dWorld *,int);
// Opening admits an interval only if both adjacent free spans contain it.
bool r2d_world_portal_passes(const R2DRe2dWorld *,int,float,float);
bool r2d_world_portal_set_closed(R2DRe2dWorld *,int,bool);
bool r2d_world_opening_between(const R2DWorldSpan *,const R2DWorldSpan *,const R2DWorldPortal *,const R2DWorldOpening *,R2DWorldOpening *);
bool r2d_world_span_set_heights(R2DRe2dWorld *,int,float,float);
bool r2d_world_wall_opening(const R2DRe2dWorld *,int,R2DWorldOpening *);
bool r2d_world_wall_solid(const R2DRe2dWorld *,int,float,float);

void r2d_world_visibility_free(R2DWorldVisibility *);
// Conservative native portal windows. Outside-world cameras use all surfaces.
bool r2d_world_visibility(const R2DRe2dWorld *,const R2DRe2dView *,float ortho,R2DWorldVisibility *);

void r2d_world_frame_visible(const R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,float,const R2DWorldVisibility *);

bool r2d_world_set_lighting(R2DRe2dWorld *,const R2DWorldLighting *);
bool r2d_world_set_span_light(R2DRe2dWorld *,int,const R2DWorldSpanLight *);
// Generation-tagged light tokens reject stale remove/update calls.
int r2d_world_light_create(R2DRe2dWorld *,const R2DWorldLight *);
bool r2d_world_light_update(R2DRe2dWorld *,int,const R2DWorldLight *);
bool r2d_world_light_remove(R2DRe2dWorld *,int);
bool r2d_world_light_rebuild(R2DRe2dWorld *);
void r2d_world_light_free(R2DRe2dWorld *);
void r2d_world_light_invalidate_box(R2DRe2dWorld *,float,float,float,float,float,float);
struct R2dJson;
bool r2d_world_span_light_json(const struct R2dJson *,R2DWorldSpanLight *);
bool r2d_world_load_lighting(R2DRe2dWorld *,const struct R2dJson *,char *,size_t);
bool r2d_world_light_valid(const R2DWorldLight *);
void r2d_world_light_sample(const R2DRe2dWorld *,int,float,float,float,float,float,float,float,float out[3]);
uint32_t r2d_world_lit_color(const R2DRe2dWorld *,int,uint32_t,float,float,float,float,float,float,float);

void r2d_world_stamp_lit(const R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,const uint8_t *,int,float,float,float,float,float,float);

void r2d_world_frame_targets(const R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,float,const R2DWorldVisibility *,R2DWorldPixelOwner *);
void r2d_world_stamp_targets(const R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,const uint8_t *,int,float,float,float,float,float,float,R2DWorldPixelOwner *,int);
void r2d_world_stamp_samples(const R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,const uint8_t *,const float *,int,float,float,float,float,float,float,R2DWorldPixelOwner *,int);
void r2d_world_debug_pixels(const R2DRe2dWorld *,const R2DRe2dView *,const R2DWorldVisibility *,float,int,int,int,uint8_t *,const float *,const R2DWorldPixelOwner *);
bool r2d_world_portal_window(const R2DRe2dView *,float,const R2DWorldPortal *,const R2DWorldOpening *,R2DWorldWindow *);

// Constrained height planes relative to the cell origin; zero coefficients preserve legacy flats.
float r2d_world_floor_height(const R2DWorldSpan *,float,float);
float r2d_world_ceiling_height(const R2DWorldSpan *,float,float);
bool r2d_world_span_opening(const R2DWorldSpan *,const R2DWorldPortal *,const R2DWorldOpening *);

void r2d_world_material_free(R2DWorldMaterial *);
// Copies independent RGBA images transactionally; caller retains input ownership.
int r2d_world_material_set(R2DRe2dWorld *,const R2DWorldMaterial *);
int r2d_world_material_find(const R2DRe2dWorld *,const char *);
bool r2d_world_surface_material(R2DRe2dWorld *,int,int);
bool r2d_world_material_color(const R2DRe2dWorld *,int,int,uint32_t,float,float,float,float,float,const float[3],const float[3],float,uint32_t *);
int r2d_world_surface_blend(const R2DRe2dWorld *,int);
int r2d_world_transparent_order(R2DRe2dWorld *,const R2DRe2dView *,const R2DWorldVisibility *,int *);
bool r2d_world_frame_transparent(R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,float,const R2DWorldVisibility *);
void r2d_world_material_probe(const R2DRe2dWorld *,int,float,float,const float[3],const float[3],float[3],float[3]);
int r2d_world_decal_create(R2DRe2dWorld *,const R2DWorldDecal *);
bool r2d_world_decal_remove(R2DRe2dWorld *,int);
void r2d_world_decal_step(R2DRe2dWorld *,float);
bool r2d_world_decal_color(const R2DRe2dWorld *,const R2DWorldDecal *,int,float,float,float,float,float,const float[3],const float[3],float,uint32_t *);
void r2d_world_frame_decals(const R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,float,const R2DWorldVisibility *,R2DWorldPixelOwner *);
void r2d_world_span_height_bounds(const R2DWorldSpan *,float *,float *);

bool r2d_world_light_visual(R2DRe2dWorld *,int,float,float,float,float,uint32_t);
void r2d_world_light_step(R2DRe2dWorld *,float);

// Resolve material UVs independently of authoring wall/cell subdivision.
void r2d_world_material_uv(const R2DRe2dWorld *,int,float,float,float,const float[3],float[3],float *,float *);

void r2d_world_texture_sample(const R2DWorldTexture *,float,float,bool,bool,uint8_t[4]);
