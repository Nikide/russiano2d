#pragma once
// ===========================================================================
// Re2D SDK: Hammer-like brush authoring -> native constrained world.
//
// Brushes are AUTHORING INPUT ONLY. The compiler turns solid prisms inside an
// explicit world envelope into the rectangular cell/span/wall/portal tables the
// Re2D runtime already understands. It never emits a polygon mesh and does not
// add a second geometry format to the runtime.
//
// A brush is a rectilinear footprint (rectangle or axis-aligned polygon) with a
// floor and ceiling height. Tool materials change only the policy and compiler
// role of the brush:
//
//   solid/none   default solid prism, visible collision surface
//   nodraw       solid; render=off, collision/ray on
//   clip         solid; collision only (no render, no ray/shadow)
//   enemyclip    solid; collision only (same runtime policy as clip)
//   playerclip   solid; collision only (same runtime policy as clip)
//   sky          solid; no wall surface, sky boundary flags, no shadow/acoustic
//   occluder     non-solid visibility blocker marker (ray on, collision off)
//   hint/skip    compiler-only, never emitted as geometry
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
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define SDK_BRUSH_MAX_POINTS 64
#define SDK_BRUSH_MAX_ID 64
#define SDK_BRUSH_MAX_COLOR 40

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

typedef struct {
    char id[SDK_BRUSH_MAX_ID];
    SdkBrushTool tool;
    bool solid;                       // participates in solid subtraction
    bool carve;                       // same as solid today; kept explicit
    SdkBrushPoint ring[SDK_BRUSH_MAX_POINTS];
    int ring_count;
    float bottom, top;
    char side_color[SDK_BRUSH_MAX_COLOR];
    char floor_color[SDK_BRUSH_MAX_COLOR];
    char ceiling_color[SDK_BRUSH_MAX_COLOR];
    char visgroup[SDK_BRUSH_MAX_ID];
    uint16_t wall_flags;              // 0 = legacy default policy
} SdkBrushSpec;

typedef struct {
    float x, y, w, h;
    float bottom, top;
    char floor_color[SDK_BRUSH_MAX_COLOR];
    char ceiling_color[SDK_BRUSH_MAX_COLOR];
    char side_color[SDK_BRUSH_MAX_COLOR];
    uint16_t boundary_flags;          // sky/clip policy for the outer envelope
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
    int hint_brushes, hint_edges;
    int occluder_brushes;
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
