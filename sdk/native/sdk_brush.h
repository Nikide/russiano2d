#pragma once
// ===========================================================================
// Re2D SDK: Hammer-like brush authoring -> native constrained world.
//
// Brushes are AUTHORING INPUT ONLY. The compiler turns solid prisms inside an
// explicit world envelope into the rectangular cell/span/wall/portal tables the
// Re2D runtime already understands. It never emits a polygon mesh and does not
// add a second geometry format to the runtime.
//
// A brush is a convex footprint (rectangle or convex polygon), optionally with
// axis-aligned holes, plus a floor and ceiling height. `subtract` brushes are
// negative CSG volumes: their XY footprint (minus holes is not allowed on
// subtract) removes the brush's Z interval from every positive solid it
// overlaps. Compile is deterministic: unique coordinate refinement, row/column
// merge, wall merge, stable portal ordering.
//
// Tool materials change only the policy and compiler role of the brush:
//
//   solid/none   default solid prism, visible collision surface
//   nodraw       solid; render=off, collision/ray on
//   clip         solid; collision only (no render, no ray/shadow)
//   enemyclip    solid; collision only (same runtime policy as clip)
//   playerclip   solid; collision only (same runtime policy as clip)
//   sky          solid; no wall surface, sky boundary flags, no shadow/acoustic
//   occluder     non-solid visibility blocker marker (ray on, collision off)
//   hint         emits a view-only barrier wall on every touched portal
//   skip         compiler-only metadata, never emitted as geometry
//   trigger      brush entity volume, never emitted as world geometry
//   areaportal   marks generated portals on its footprint as areaportals
//
// The free space is [world.bottom..world.top] minus the union of solid brush
// height intervals for each XY grid rectangle. Adjacent grid rectangles with
// identical free intervals are merged into one cell. Exposed solid faces become
// walls; every free interval shared by two merged cells becomes a portal whose
// openings are the overlapping free height intervals.
//
// The caller owns all output arrays; sdk_brush_output_free() releases them.
// Compilation allocates scratch arrays internally and is deterministic.
// ===========================================================================
#include "re2d_world_terrain.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define SDK_BRUSH_MAX_POINTS 64
#define SDK_BRUSH_MAX_HOLES 8
#define SDK_BRUSH_MAX_ID 64
#define SDK_BRUSH_MAX_COLOR 40
// User surface tag bounds. Kept byte-identical to the native runtime's
// R2D_WORLD_TAG_MAX / R2D_WORLD_TAG_LENGTH (sdk_brush.c asserts this) so a
// brush-authored tag table can be forwarded without a second limit.
#define SDK_BRUSH_TAG_MAX 32
#define SDK_BRUSH_TAG_LENGTH 32

// Owned-by-value tag list used by brush authoring/output (no allocation).
typedef struct {
    unsigned char count;
    char names[SDK_BRUSH_TAG_MAX][SDK_BRUSH_TAG_LENGTH+1];
} SdkBrushTags;

typedef enum {
    SDK_BRUSH_TOOL_NONE = 0,
    SDK_BRUSH_TOOL_NODRAW,
    SDK_BRUSH_TOOL_SKY,
    SDK_BRUSH_TOOL_HINT,
    SDK_BRUSH_TOOL_SKIP,
    SDK_BRUSH_TOOL_TRIGGER,
    SDK_BRUSH_TOOL_AREAPORTAL,
    SDK_BRUSH_TOOL_CLIP,
    SDK_BRUSH_TOOL_ENEMYCLIP,
    SDK_BRUSH_TOOL_PLAYERCLIP,
    SDK_BRUSH_TOOL_OCCLUDER
} SdkBrushTool;

typedef struct {
    float x, y;
} SdkBrushPoint;

// Rectilinear (axis-aligned) hole inside a positive solid brush footprint.
typedef struct {
    float x, y, w, h;
} SdkBrushHole;

typedef struct {
    char id[SDK_BRUSH_MAX_ID];
    SdkBrushTool tool;
    bool solid;                       // participates in solid subtraction
    bool carve;                       // same as solid today; kept explicit
    bool subtract;                    // CSG: this solid removes volume from solids
    SdkBrushPoint ring[SDK_BRUSH_MAX_POINTS];
    int ring_count;
    int hole_count;                   // rectilinear holes cut out of this solid
    SdkBrushHole holes[SDK_BRUSH_MAX_HOLES];
    float bottom, top;
    char side_color[SDK_BRUSH_MAX_COLOR];
    char floor_color[SDK_BRUSH_MAX_COLOR];
    char ceiling_color[SDK_BRUSH_MAX_COLOR];
    char visgroup[SDK_BRUSH_MAX_ID];
    uint16_t wall_flags;              // 0 = legacy default policy
    SdkBrushTags tags;                // floor surface tags when this brush owns the floor
    SdkBrushTags ceiling_tags;        // ceiling surface tags when this brush owns the ceiling
} SdkBrushSpec;

typedef struct {
    float x, y, w, h;
    float bottom, top;
    char floor_color[SDK_BRUSH_MAX_COLOR];
    char ceiling_color[SDK_BRUSH_MAX_COLOR];
    char side_color[SDK_BRUSH_MAX_COLOR];
    uint16_t boundary_flags;          // sky/clip policy for the outer envelope
    SdkBrushTags tags;                // floor tags for spans bounded by the envelope
    SdkBrushTags ceiling_tags;        // ceiling tags for spans bounded by the envelope
} SdkBrushBounds;

typedef struct {
    float x, y, w, h;
    char owner[96];
    int first_span, span_count;
} SdkBrushCell;

typedef struct {
    int cell;
    float bottom, top;
    char floor_color[SDK_BRUSH_MAX_COLOR];
    char ceiling_color[SDK_BRUSH_MAX_COLOR];
    // Forwarded authored surface tags: floor owner (or bounds) / ceiling owner
    // (or bounds). Copied into native span `tags`/`ceilingTags` by sdk_world.
    SdkBrushTags tags;
    SdkBrushTags ceiling_tags;
} SdkBrushSpan;

typedef struct {
    char id[96];
    float x1, y1, x2, y2, bottom, top;
    char color[SDK_BRUSH_MAX_COLOR];
    uint16_t flags;
} SdkBrushWall;

typedef struct {
    float bottom, top;
} SdkBrushOpening;

typedef struct {
    char id[96];
    int cell_a, cell_b;
    float ax, ay, bx, by;
    int first_opening, opening_count;
    bool area_portal;
} SdkBrushPortal;

typedef struct {
    SdkBrushCell *cells;
    int cell_count;
    SdkBrushSpan *spans;
    int span_count;
    SdkBrushWall *walls;
    int wall_count;
    SdkBrushPortal *portals;
    int portal_count;
    SdkBrushOpening *openings;
    int opening_count;
} SdkBrushOutput;

typedef struct {
    int brushes, solids, tool_brushes;
    int cells, spans, walls, portals, openings;
    int merged_cells;
    int areaportal_brushes, areaportal_edges;
    int hint_brushes, hint_edges, hint_barriers;
    int occluder_brushes;
    int polygon_brushes, subtract_brushes, hole_brushes;
    int shadow_walls, acoustic_walls, occluder_walls;
    int entities, point_entities, brush_entities;
} SdkBrushStats;

// Compiles brushes into native cell/span/wall/portal tables.
// Returns false on invalid geometry (error gets an ASCII message). The caller
// must call sdk_brush_output_free() on both success and failure.
bool sdk_brush_compile(const SdkBrushSpec *brushes, int brush_count,
                       const SdkBrushBounds *bounds,
                       SdkBrushOutput *out, SdkBrushStats *stats,
                       char *error, size_t error_size);

void sdk_brush_output_free(SdkBrushOutput *out);

// Maps a tool name ("nodraw", "sky", ...) to enum; unknown -> NONE and false.
bool sdk_brush_tool_parse(const char *name, SdkBrushTool *out);
const char *sdk_brush_tool_name(SdkBrushTool tool);

// Policy bits for a tool material. `flags == 0` = legacy all-on default.
uint16_t sdk_brush_tool_flags(SdkBrushTool tool);

// ---- Brush entities -------------------------------------------------------
// Authoring-side brush entity reference (entity -> brush volume). Compiler maps
// it onto the EXISTING runtime contracts instead of inventing geometry:
//   door/lift/crusher/moving_wall -> world.mover (moving_wall = platform)
//   trigger/trigger_volume        -> world.trigger (enter)
//   fog_volume                    -> world.fogZone (needs span resolution)
//   water_volume                  -> liquid/volume hook (runtime API missing)
//   areaportal                    -> generated portal areaPortal metadata
// `hook` is non-empty when the runtime still needs wiring; the map itself is
// metadata only and does not mutate runtime state.
typedef struct {
    char id[SDK_BRUSH_MAX_ID];
    char kind[32];
    char brush[SDK_BRUSH_MAX_ID];
    char target[SDK_BRUSH_MAX_ID];
} SdkBrushEntityRef;

typedef struct {
    char id[SDK_BRUSH_MAX_ID];
    char kind[32];
    char brush[SDK_BRUSH_MAX_ID];
    char runtime[24];               // mover|trigger|fog|water|portal
    char api[64];                   // world.mover|world.trigger|...
    char target[SDK_BRUSH_MAX_ID];  // authored semantic target (portal/span id)
    char hook[80];                  // required runtime hook, empty when direct
    int mover_type;                 // -1 n/a, else R2DWorldMoverType value
    int trigger_type;               // -1 n/a, else enter=0
    int portal;                     // areaportal: resolved generated portal, -1
    int span_count;                 // fog/water: resolved covered spans, -1 n/a
    int terrain_kind;               // water: R2D_TERRAIN_WATER, else -1
    float fog_density, fog_start;   // fog/water preset
    float fog_r, fog_g, fog_b;
    float x, y, w, h, bottom, top;  // resolved brush volume (outer bbox)
    uint16_t flags;                 // brush wall policy bits
} SdkBrushEntityMap;

// ---- Editor-level vertex semantics ---------------------------------------
// Moves one authored vertex, keeping the brush transactional. The result must
// still be a valid convex ring; existing holes must remain fully inside it.
// Returns false with a specific ASCII message for concave/degenerate results.
bool sdk_brush_move_vertex(SdkBrushSpec *brush, int vertex, float x, float y,
                           char *error, size_t error_size);

// Splits a convex brush by an axis-aligned plane (axis 0 = X, 1 = Y) into two
// convex brushes. `coord` must be strictly inside the brush bbox. Holes are not
// supported on split input (returns 0). Output ids get "#a"/"#b" suffixes and
// all colors/policy/Z fields are preserved. Returns 2 on success, 0 on invalid
// input (error gets an ASCII reason). Splitting is deterministic.
int sdk_brush_split_axis(const SdkBrushSpec *brush, int axis, float coord,
                         SdkBrushSpec out[2], char *error, size_t error_size);

// Resolves brush entity references against authored brushes. Returns the total
// required map count (may exceed capacity), or -1 on invalid input/duplicate
// ids/references/unknown brush-entity kind. out==NULL is a count-only query.
int sdk_brush_map_entities(const SdkBrushSpec *brushes, int brush_count,
                           const SdkBrushEntityRef *entities, int entity_count,
                           SdkBrushEntityMap *out, int capacity,
                           char *error, size_t error_size);
