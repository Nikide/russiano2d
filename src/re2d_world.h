#pragma once
#include "bsp.h"
#include "re2d_math.h"
#include "re2d_world_metadata.h"
#include "re2d_world_render_features.h"
#include <stdint.h>

// Specialised RE2D authoring primitives, never a triangle mesh.
// Wall tool policy bits. `flags == 0` means the legacy default (every policy
// enabled), so old author data, old baked maps and positional initializers stay
// valid without changes. Non-zero flags are authored by the brush compiler and
// travel through JSON/bake format v5.
enum {
    R2D_WALL_RENDER   = 1u << 0,
    R2D_WALL_COLLIDE  = 1u << 1,
    R2D_WALL_RAY      = 1u << 2, // gameplay hitscan + native shadow/light rays
    R2D_WALL_SHADOW   = 1u << 3, // reserved query policy for renderer shadow passes
    R2D_WALL_ACOUSTIC = 1u << 4, // reserved query policy for audio occlusion
    R2D_WALL_SKY      = 1u << 5, // sky/clip boundary: no wall surface, collision stays
    R2D_WALL_OCCLUDER = 1u << 6, // visibility blocker only
    R2D_WALL_TOOL_HINT = 1u << 7,
    R2D_WALL_TOOL_SKIP = 1u << 8
};
#define R2D_WALL_DEFAULT_POLICY (R2D_WALL_RENDER|R2D_WALL_COLLIDE|R2D_WALL_RAY|R2D_WALL_SHADOW|R2D_WALL_ACOUSTIC)
typedef struct { float x1,y1,x2,y2,bottom,top; uint32_t color; uint16_t flags; } R2DWorldWall;
// Effective policy bits; zero flags select the legacy all-on default.
static inline uint16_t r2d_world_wall_bits(const R2DWorldWall *wall)
{ return wall && wall->flags ? wall->flags : (uint16_t)R2D_WALL_DEFAULT_POLICY; }
static inline bool r2d_world_wall_renders(const R2DWorldWall *wall)
{ return (r2d_world_wall_bits(wall) & R2D_WALL_RENDER) != 0; }
static inline bool r2d_world_wall_collides(const R2DWorldWall *wall)
{ return (r2d_world_wall_bits(wall) & R2D_WALL_COLLIDE) != 0; }
static inline bool r2d_world_wall_blocks_ray(const R2DWorldWall *wall)
{ return (r2d_world_wall_bits(wall) & R2D_WALL_RAY) != 0; }
typedef struct { float x,y,w,h,bottom,top; uint32_t floor_color,ceiling_color; float floor_a,floor_b,ceiling_a,ceiling_b; } R2DWorldSpan;
// Topology is XY only. Span references remain indices into the native table.
typedef struct { float x,y,w,h; int first_span,span_count; } R2DWorldCell;
typedef struct { float bottom,top; } R2DWorldOpening;
typedef struct {
    int cell_a,cell_b,first_opening,opening_count;
    float ax,ay,bx,by;
    bool closed;
    // Portal 2.0: smooth open fraction 0..1. `closed` stays the binary view
    // (fraction<=0); effective openings clip their top to
    // bottom + fraction*(top-bottom), so doors/lifts can animate continuously
    // while collision, visibility and light use the same clipped interval.
    float open_fraction;
    // P2 sky portal: visibility treats it as a window to the panorama sky; no
    // traversal into the far cell, so the opening shows the sky background.
    bool sky;
    // P2 mirror portal: no traversal into the far cell; a scissored reflected
    // world pass fills the portal window.
    bool mirror;
    // Brush compiler marker: this portal is an areaportal. Runtime/region PVS
    // treats it exactly like any other portal but uses the marker for streaming,
    // diagnostics and areaportal-specific culling.
    bool area_portal;
} R2DWorldPortal;
enum { R2D_WORLD_WALL, R2D_WORLD_FLOOR, R2D_WORLD_CEILING };
typedef struct { int kind,primitive,cell,span; } R2DWorldSurface;
// An independent XY cell BSP; straddling cells remain candidate refs on nodes.
// Cells may stack free intervals, but their XY interiors are disjoint.
typedef struct { float split; int axis,front,back,first_ref,ref_count; } R2DWorldCellNode;
typedef struct { int surface,span,actor; } R2DWorldPixelOwner;
enum { R2D_WORLD_DEBUG_FINAL,R2D_WORLD_DEBUG_CELL,R2D_WORLD_DEBUG_SPAN,R2D_WORLD_DEBUG_DEPTH,
       R2D_WORLD_DEBUG_OWNER,R2D_WORLD_DEBUG_LIGHT_LEVEL,R2D_WORLD_DEBUG_LIGHT_COUNT,R2D_WORLD_DEBUG_NORMAL,R2D_WORLD_DEBUG_EMISSIVE,
       R2D_WORLD_DEBUG_BSP,R2D_WORLD_DEBUG_PORTALS,R2D_WORLD_DEBUG_SHADOW,R2D_WORLD_DEBUG_OVERDRAW,
       // R-04/P4 native debug overlays (append-only; legacy values unchanged).
       R2D_WORLD_DEBUG_REGION,R2D_WORLD_DEBUG_ACTIVE_REGION,R2D_WORLD_DEBUG_PVS,
       R2D_WORLD_DEBUG_VISCLUSTER,R2D_WORLD_DEBUG_AREAPORTAL,R2D_WORLD_DEBUG_OCCLUDER,
       R2D_WORLD_DEBUG_DISTANT_LOD,R2D_WORLD_DEBUG_SPRITE_LOD,
       R2D_WORLD_DEBUG_MATERIAL_VARIATION,R2D_WORLD_DEBUG_AO,R2D_WORLD_DEBUG_VFX_BUDGET,
       R2D_WORLD_DEBUG_COUNT };
typedef struct { float left,top,right,bottom; } R2DWorldWindow;
typedef struct {
    int *spans,*surfaces,*queue;
    uint8_t *span_seen,*surface_seen,*queued;
    R2DWorldWindow *windows,*surface_windows;
    int span_count,surface_count,capacity_spans,capacity_surfaces;
    int portals_tested,portals_conservative,cells_visible;
    int *node_parents,*cell_nodes;
    uint8_t *node_active;
    int capacity_nodes,capacity_cells,bsp_nodes_visited;
    const R2DWorldCellNode *indexed_nodes;
    uint64_t indexed_revision;
    // Compiler hint/occluder consumer: per-cell occluder reject bitmap used by
    // the BSP/portal traversal when an authored occluder chain exists.
    uint8_t *cell_filter;
    int capacity_filter_cells;
    // Hierarchical visibility counters filled by the filtered entry point:
    // cells rejected before local portal/BSP work, plus region rejections the
    // runtime already knows (0 when called directly).
    int culled_regions, culled_cells, cell_rejections;
    // Authored hint/occluder visibility counters (0 on legacy maps).
    int hint_markers, skip_markers, occluder_segments;
    int hint_portals_tested, hint_portals_cut;
    int occluder_cells_tested, occluder_cells_cut;
} R2DWorldVisibility;
#define R2D_WORLD_MAX_MATERIALS 64
enum { R2D_WORLD_MASKED,R2D_WORLD_OPAQUE,R2D_WORLD_TRANSLUCENT,R2D_WORLD_ADDITIVE };
typedef struct { uint8_t *pixels; int width,height; } R2DWorldTexture;
typedef struct {
    R2DWorldTexture albedo,normal,emissive;
    float emissive_strength,u_scale,v_scale,opacity;
    // P2 runtime animation state (material anim timeline writes these).
    float anim_u,anim_v,anim_emissive;
    int blend;
    char name[64];
    bool used,world_uv,linear;
} R2DWorldMaterial;
#define R2D_WORLD_MAX_LIGHTS 128
#define R2D_WORLD_MAX_DECALS 128
// Decals 2.0: lifetime/fade/rotation/scale. max_life<=0 keeps legacy decals
// (no fade, deterministic variation) byte-compatible.
typedef struct {int surface,material;float u,v,w,h,remaining;float max_life,rotation,scale,fade_in,fade_out;unsigned generation;bool active;} R2DWorldDecal;
#define R2D_WORLD_LIGHTS_PER_SPAN 16
#define R2D_WORLD_MAX_SHADOWS 16
typedef struct { float level,r,g,b,fog_density,fog_start,fog_r,fog_g,fog_b; } R2DWorldSpanLight;
typedef struct { float x,y,h,radius,intensity,r,g,b; bool active,shadow,is_static; unsigned generation;
    float remaining,age,flicker_min,flicker_max,flicker_rate;uint32_t flicker_seed; } R2DWorldLight;
typedef struct {int *spans,count,capacity;} R2DWorldLightLinks;
typedef struct {int id;float depth;} R2DWorldSortItem;
// Authored semantic labels. The numeric indices above stay the runtime handles.
#define R2D_WORLD_ID_MAX 63
typedef struct { char **names; int count; } R2DWorldIdTable;
// User surface tags (P0.1). Tags are authored DATA, not an engine enum: an
// arbitrary short ASCII/UTF-8 label such as "road", "sidewalk" or "no_spawn".
// They attach to derived surfaces (a span's floor is `tags`, its ceiling is
// `ceilingTags`), are per-surface owned strings and never participate in
// geometry/BSP/visibility. Runtime add/remove is additive and does not bump
// geometry_revision (reload re-reads authored data).
enum { R2D_WORLD_TAG_MAX = 32, R2D_WORLD_TAG_LENGTH = 32 };
typedef struct { char **names; int count, capacity; } R2DWorldSurfaceTags;
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
    // Per-surface fade alpha (lazy allocation, NULL = every surface alpha 1.0).
    // Render-pass-only state: setting a fade never bumps topology/geometry
    // revision or touches BSP/visibility data.
    float *surface_alpha;
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
    // Owned source name tables. Empty entries are NULL; counts parallel the
    // geometry tables. semantic_revision advances on every successful reload.
    R2DWorldIdTable cell_ids,wall_ids,span_ids,portal_ids;
    uint64_t semantic_revision;
    // Authored map metadata/spawns (P1). Owned strings; zeroed when absent.
    R2DWorldMetadata metadata;
    // Per-surface user tags; NULL when the map authors none (old maps and
    // legacy geometry-only worlds stay allocation-free/byte-identical).
    R2DWorldSurfaceTags *surface_tags;
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
// Authored semantic identity -> numeric runtime handle. Names are case-sensitive
// exact matches; unknown/NULL/empty names resolve to -1. Lookups are linear over
// the owning table, never over geometry.
int r2d_world_find_cell(const R2DRe2dWorld *,const char *);
int r2d_world_find_wall(const R2DRe2dWorld *,const char *);
int r2d_world_find_span(const R2DRe2dWorld *,const char *);
int r2d_world_find_portal(const R2DRe2dWorld *,const char *);
// Debug/read-only access; invalid indices and unnamed primitives return NULL.
const char *r2d_world_cell_id(const R2DRe2dWorld *,int);
const char *r2d_world_wall_id(const R2DRe2dWorld *,int);
const char *r2d_world_span_id(const R2DRe2dWorld *,int);
const char *r2d_world_portal_id(const R2DRe2dWorld *,int);
// Surfaces are derived, not authored: a wall owns exactly one WALL surface; a
// span owns a FLOOR and a CEILING surface. -1 when unavailable.
int r2d_world_wall_surface(const R2DRe2dWorld *,int wall);
int r2d_world_span_surface(const R2DRe2dWorld *,int span,int kind);
// --- User surface tags (P0.1) ----------------------------------------------
// Tags are owned per-surface strings. `r2d_world_tag_normalize` trims ASCII
// whitespace and rejects empty names, names longer than R2D_WORLD_TAG_LENGTH
// bytes and control bytes. Matching is case-sensitive exact. Malformed input,
// unknown tags, duplicates and missing tags are plain data: add() is idempotent
// and remove() of an absent tag is a no-op success. Only invalid surface
// handles, over-budget counts (> R2D_WORLD_TAG_MAX) or allocation failure
// return false. Runtime mutation never changes geometry/topology revisions.
bool r2d_world_tag_normalize(const char *,char *out,size_t *length);
int r2d_world_surface_tag_count(const R2DRe2dWorld *,int surface);
const char *r2d_world_surface_tag(const R2DRe2dWorld *,int surface,int index);
bool r2d_world_surface_has_tag(const R2DRe2dWorld *,int surface,const char *tag);
bool r2d_world_surface_tag_add(R2DRe2dWorld *,int surface,const char *tag);
bool r2d_world_surface_tag_remove(R2DRe2dWorld *,int surface,const char *tag);
bool r2d_world_surface_tag_set(R2DRe2dWorld *,int surface,const char *tag,bool on);
// True when at least one surface carries a tag (drives baked wire v6 only).
bool r2d_world_has_tags(const R2DRe2dWorld *);
// Exact ground/surface lookup under a world point.
// `has_height` + `height` selects the highest floor at or below that height
// (bridge over road resolves by height). When `has_height` is false and the XY
// cell has more than one stacked span the query is AMBIGUOUS: callers must pass
// h instead of silently receiving an arbitrary storey. Return codes:
//   R2D_WORLD_GROUND_OK        -> out filled, floor surface/tags available
//   R2D_WORLD_GROUND_NONE      -> no ground at/under that point (null)
//   R2D_WORLD_GROUND_AMBIGUOUS -> out->candidates stacked spans, h required
//   R2D_WORLD_GROUND_INVALID   -> non-finite x/y/h or null output
enum { R2D_WORLD_GROUND_NONE=0, R2D_WORLD_GROUND_OK=1,
       R2D_WORLD_GROUND_AMBIGUOUS=-1, R2D_WORLD_GROUND_INVALID=-2 };
typedef struct { int cell,span,surface; float height; int candidates; } R2DWorldGround;
int r2d_world_ground_at(const R2DRe2dWorld *,float x,float y,int has_height,float height,R2DWorldGround *);
// Cell BSP near-first traversal. Returns required count; writes at most capacity.
int r2d_world_cells_order(const R2DRe2dWorld *,float,float,int *,int);
const R2DWorldSurface *r2d_world_surface(const R2DRe2dWorld *,int);
// Opening admits an interval only if both adjacent free spans contain it.
bool r2d_world_portal_passes(const R2DRe2dWorld *,int,float,float);
bool r2d_world_portal_set_closed(R2DRe2dWorld *,int,bool);
// Smooth portal state: fraction 0 = closed, 1 = fully open. Non-finite input is
// rejected; values outside 0..1 are clamped. Returns false on invalid handle.
bool r2d_world_portal_set_open(R2DRe2dWorld *,int,float);
bool r2d_world_portal_set_sky(R2DRe2dWorld *,int,bool);
bool r2d_world_portal_sky(const R2DRe2dWorld *,int);
bool r2d_world_portal_set_mirror(R2DRe2dWorld *,int,bool);
bool r2d_world_portal_mirror(const R2DRe2dWorld *,int);
float r2d_world_portal_open_fraction(const R2DRe2dWorld *,int);
bool r2d_world_opening_between(const R2DWorldSpan *,const R2DWorldSpan *,const R2DWorldPortal *,const R2DWorldOpening *,R2DWorldOpening *);
bool r2d_world_span_set_heights(R2DRe2dWorld *,int,float,float);
bool r2d_world_wall_opening(const R2DRe2dWorld *,int,R2DWorldOpening *);
bool r2d_world_wall_solid(const R2DRe2dWorld *,int,float,float);
// Tool-material policy for a wall. `flags == 0`/invalid handle returns the
// legacy all-on policy. Render/collision/ray bits are enforced by the native
// renderer, controller collision and ray/shadow paths; shadow/acoustic bits are
// exposed for higher-level passes (sky/clip boundary contract).
typedef struct { bool render, collision, hitscan, shadow, acoustic, sky, occluder; } R2DWorldWallPolicy;
R2DWorldWallPolicy r2d_world_wall_policy(const R2DRe2dWorld *,int);
bool r2d_world_portal_area(const R2DRe2dWorld *,int);
bool r2d_world_portal_set_area(R2DRe2dWorld *,int,bool);

// Compiler-authored volumetric entity helpers (fog/water brush entities).
// A volume is an XY rect + height interval in world space. These functions are
// the CONCRETE native consumer for the SDK entity mapping: fog/water alter the
// covered spans' span-light fog (consumed by the renderer), while gameplay
// terrain for water is resolved via r2d_world_volume_spans +
// r2d_world_span_surface(R2D_WORLD_FLOOR) and the runtime terrain API.
// r2d_world_volume_spans returns the total required count (may exceed capacity)
// or -1 on invalid arguments; out==NULL is a count-only query.
int r2d_world_volume_spans(const R2DRe2dWorld *,float x,float y,float w,float h,
                           float bottom,float top,int *out,int capacity);
// Returns the number of spans whose fog was updated, or -1 on invalid input.
// Existing span lighting is preserved; only fog fields are overwritten.
int r2d_world_apply_fog_volume(R2DRe2dWorld *,float x,float y,float w,float h,
                               float bottom,float top,float density,float start,
                               float r,float g,float b);
// Water presets the liquid tint/density into covered span fog and returns the
// updated span count (or -1). Terrain gameplay remains the runtime terrain API
// (see above); this is not a second fluid system.
int r2d_world_apply_water_volume(R2DRe2dWorld *,float x,float y,float w,float h,
                                 float bottom,float top,float density,
                                 float r,float g,float b);

void r2d_world_visibility_free(R2DWorldVisibility *);
// Conservative native portal windows. Outside-world cameras use all surfaces.
bool r2d_world_visibility(const R2DRe2dWorld *,const R2DRe2dView *,float ortho,R2DWorldVisibility *);
// Hierarchical variant: `cell_allowed` (one byte per cell, NULL = all) is the
// region/vis-cluster PVS reject set. Rejected cells never enter local portal
// traversal or BSP submission; counters land in R2DWorldVisibility.
struct R2DWorldHintCache;
bool r2d_world_visibility_filtered(const R2DRe2dWorld *,const R2DRe2dView *,float ortho,
                                   R2DWorldVisibility *,const uint8_t *cell_allowed);
// Same, with an optional caller-built compiler hint/occluder cache. Passing
// NULL is exactly the legacy path; authored hint markers cut portal view
// traversal and authored occluder segments conservatively reject whole cells
// before BSP/portal work. Cache must be built for the same topology revision.
bool r2d_world_visibility_filtered_ex(const R2DRe2dWorld *,const R2DRe2dView *,float ortho,
                                      R2DWorldVisibility *,const uint8_t *cell_allowed,
                                      const struct R2DWorldHintCache *hints);

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
// CPU reference frame with the R-02 atmosphere model. The runtime CPU backend
// passes its render features so MEDIUM/HIGH CPU frames use the same bounded
// height fog and haze tint as the GPU tier; LOW features leave the legacy path
// byte-identical.
void r2d_world_frame_targets_features(const R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,float,const R2DWorldVisibility *,R2DWorldPixelOwner *,const R2DWorldRenderFeatures *);
void r2d_world_stamp_targets(const R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,const uint8_t *,int,float,float,float,float,float,float,R2DWorldPixelOwner *,int);
void r2d_world_stamp_samples(const R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,const uint8_t *,const float *,int,float,float,float,float,float,float,R2DWorldPixelOwner *,int);
// Blend-aware variants used by native atlas world sprites (masked/opaque/translucent/additive).
void r2d_world_stamp_targets_ex(const R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,const uint8_t *,int,float,float,float,float,float,float,R2DWorldPixelOwner *,int,int);
void r2d_world_stamp_samples_ex(const R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,const uint8_t *,const float *,int,float,float,float,float,float,float,R2DWorldPixelOwner *,int,int);
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
// Same shading with the R-02 atmosphere model (bounded height fog + haze),
// matching shaders/world.frag.glsl. NULL features == legacy fog.
bool r2d_world_material_color_features(const R2DRe2dWorld *,int,int,uint32_t,float,float,float,float,float,const float[3],const float[3],float,const R2DWorldRenderFeatures *,uint32_t *);
int r2d_world_surface_blend(const R2DRe2dWorld *,int);
// Per-surface fade alpha: a render-pass alpha for one derived surface (a wall or
// one floor/ceiling plane), 1.0 by default. `surfaceFade`/fade() in the public
// API wraps this. Invalid reads return 1.0; invalid writes are rejected.
// alpha<1 makes an opaque/masked surface translucent for sorting and the
// transparent pass; additive materials stay additive. No revision bump.
float r2d_world_surface_alpha(const R2DRe2dWorld *,int);
bool r2d_world_surface_fade_set(R2DRe2dWorld *,int,float);
int r2d_world_transparent_order(R2DRe2dWorld *,const R2DRe2dView *,const R2DWorldVisibility *,int *);
bool r2d_world_frame_transparent(R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,float,const R2DWorldVisibility *);
void r2d_world_material_probe(const R2DRe2dWorld *,int,float,float,const float[3],const float[3],float[3],float[3]);
int r2d_world_decal_create(R2DRe2dWorld *,const R2DWorldDecal *);
bool r2d_world_decal_remove(R2DRe2dWorld *,int);
void r2d_world_decal_step(R2DRe2dWorld *,float);
// Decals 2.0 fade factor in 0..1 (1 for legacy decals without max_life).
float r2d_world_decal_alpha(const R2DWorldDecal *);
bool r2d_world_decal_color(const R2DRe2dWorld *,const R2DWorldDecal *,int,float,float,float,float,float,const float[3],const float[3],float,uint32_t *);
void r2d_world_frame_decals(const R2DRe2dWorld *,const R2DRe2dView *,int,int,uint8_t *,float *,float,const R2DWorldVisibility *,R2DWorldPixelOwner *);
void r2d_world_span_height_bounds(const R2DWorldSpan *,float *,float *);

bool r2d_world_light_visual(R2DRe2dWorld *,int,float,float,float,float,uint32_t);
void r2d_world_light_step(R2DRe2dWorld *,float);

// Resolve material UVs independently of authoring wall/cell subdivision.
void r2d_world_material_uv(const R2DRe2dWorld *,int,float,float,float,const float[3],float[3],float *,float *);

void r2d_world_texture_sample(const R2DWorldTexture *,float,float,bool,bool,uint8_t[4]);
