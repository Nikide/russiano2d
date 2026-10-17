#include "sdk_brush.h"

#include "re2d_world.h"
#include "re2d_world_polygon.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define BRUSH_EPS 1e-4f
#define BRUSH_MAX_INTERVALS 16
#define BRUSH_MAX_TILES 16384

typedef struct {
    float lo, hi;
    int owner;
} BrushInterval;

typedef struct {
    float lo, hi;
    int floor_owner;
    int ceiling_owner;
} BrushFreeSpan;

typedef struct {
    int used;
    int span_count;
    BrushFreeSpan spans[BRUSH_MAX_INTERVALS];
    int solid_count;
    BrushInterval solids[BRUSH_MAX_INTERVALS];
    int x0, x1, y0, y1; // coordinate indices, x1>x0, y1>y0
} BrushTile;

typedef struct {
    float x0, x1, y0, y1;
    int tile;
    int used;
} BrushCellRec;

static void set_error(char *error, size_t size, const char *message)
{
    if (error && size) snprintf(error, size, "%s", message);
}

static void copy_text(char *dst, size_t size, const char *src)
{
    if (!dst || !size) return;
    if (!src) src = "";
    snprintf(dst, size, "%s", src);
}

bool sdk_brush_tool_parse(const char *name, SdkBrushTool *out)
{
    if (!name || !out) return false;
    static const struct { const char *name; SdkBrushTool tool; } table[] = {
        {"nodraw", SDK_BRUSH_TOOL_NODRAW},
        {"sky", SDK_BRUSH_TOOL_SKY},
        {"hint", SDK_BRUSH_TOOL_HINT},
        {"skip", SDK_BRUSH_TOOL_SKIP},
        {"trigger", SDK_BRUSH_TOOL_TRIGGER},
        {"areaportal", SDK_BRUSH_TOOL_AREAPORTAL},
        {"clip", SDK_BRUSH_TOOL_CLIP},
        {"enemyclip", SDK_BRUSH_TOOL_ENEMYCLIP},
        {"playerclip", SDK_BRUSH_TOOL_PLAYERCLIP},
        {"occluder", SDK_BRUSH_TOOL_OCCLUDER},
        {"solid", SDK_BRUSH_TOOL_NONE},
    };
    for (size_t i = 0; i < sizeof table / sizeof table[0]; i++) {
        if (!strcmp(name, table[i].name)) {
            *out = table[i].tool;
            return true;
        }
    }
    return false;
}

const char *sdk_brush_tool_name(SdkBrushTool tool)
{
    switch (tool) {
        case SDK_BRUSH_TOOL_NODRAW: return "nodraw";
        case SDK_BRUSH_TOOL_SKY: return "sky";
        case SDK_BRUSH_TOOL_HINT: return "hint";
        case SDK_BRUSH_TOOL_SKIP: return "skip";
        case SDK_BRUSH_TOOL_TRIGGER: return "trigger";
        case SDK_BRUSH_TOOL_AREAPORTAL: return "areaportal";
        case SDK_BRUSH_TOOL_CLIP: return "clip";
        case SDK_BRUSH_TOOL_ENEMYCLIP: return "enemyclip";
        case SDK_BRUSH_TOOL_PLAYERCLIP: return "playerclip";
        case SDK_BRUSH_TOOL_OCCLUDER: return "occluder";
        default: return "solid";
    }
}

uint16_t sdk_brush_tool_flags(SdkBrushTool tool)
{
    switch (tool) {
        case SDK_BRUSH_TOOL_NODRAW:
            return (uint16_t)(R2D_WALL_COLLIDE | R2D_WALL_RAY |
                              R2D_WALL_SHADOW | R2D_WALL_ACOUSTIC);
        case SDK_BRUSH_TOOL_SKY:
            return (uint16_t)(R2D_WALL_COLLIDE | R2D_WALL_RAY | R2D_WALL_SKY);
        case SDK_BRUSH_TOOL_CLIP:
        case SDK_BRUSH_TOOL_ENEMYCLIP:
        case SDK_BRUSH_TOOL_PLAYERCLIP:
            return (uint16_t)R2D_WALL_COLLIDE;
        case SDK_BRUSH_TOOL_OCCLUDER:
            return (uint16_t)(R2D_WALL_RAY | R2D_WALL_OCCLUDER);
        default:
            return 0; // legacy default policy
    }
}

static bool point_in_ring(const SdkBrushPoint *ring, int count, float x, float y)
{
    bool inside = false;
    for (int i = 0, j = count - 1; i < count; j = i++) {
        const float xi = ring[i].x, yi = ring[i].y;
        const float xj = ring[j].x, yj = ring[j].y;
        if (((yi > y) != (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi))
            inside = !inside;
    }
    return inside;
}

static bool point_on_ring_edge(const SdkBrushPoint *ring, int count,
                               float x, float y)
{
    for (int i = 0; i < count; i++) {
        const SdkBrushPoint *a = &ring[i];
        const SdkBrushPoint *b = &ring[(i + 1) % count];
        const float dx = b->x - a->x, dy = b->y - a->y;
        const float len2 = dx * dx + dy * dy;
        float t = len2 > 0.0f ? ((x - a->x) * dx + (y - a->y) * dy) / len2 : 0.0f;
        if (t < 0.0f) t = 0.0f;
        if (t > 1.0f) t = 1.0f;
        const float px = a->x + t * dx - x, py = a->y + t * dy - y;
        if (px * px + py * py <= BRUSH_EPS * BRUSH_EPS) return true;
    }
    return false;
}

// Inclusive containment is used for tool brushes that sit exactly on a portal
// boundary (areaportal/hint), where the midpoint lies on the ring edge.
static bool ring_contains_inclusive(const SdkBrushPoint *ring, int count,
                                    float x, float y)
{
    return point_in_ring(ring, count, x, y) ||
           point_on_ring_edge(ring, count, x, y);
}

static bool ring_rectilinear(const SdkBrushPoint *ring, int count)
{
    for (int i = 0; i < count; i++) {
        const SdkBrushPoint *a = &ring[i];
        const SdkBrushPoint *b = &ring[(i + 1) % count];
        if (fabsf(a->x - b->x) > BRUSH_EPS && fabsf(a->y - b->y) > BRUSH_EPS)
            return false;
    }
    return true;
}

static int float_compare(const void *a, const void *b)
{
    const float x = *(const float *)a, y = *(const float *)b;
    return x < y ? -1 : x > y ? 1 : 0;
}

static int interval_compare(const void *a, const void *b)
{
    const BrushInterval *x = (const BrushInterval *)a;
    const BrushInterval *y = (const BrushInterval *)b;
    if (x->lo != y->lo) return x->lo < y->lo ? -1 : 1;
    return x->hi < y->hi ? -1 : x->hi > y->hi ? 1 : 0;
}

static bool spans_equal(const BrushFreeSpan *a, const BrushFreeSpan *b)
{
    return fabsf(a->lo - b->lo) <= BRUSH_EPS &&
           fabsf(a->hi - b->hi) <= BRUSH_EPS &&
           a->floor_owner == b->floor_owner &&
           a->ceiling_owner == b->ceiling_owner;
}

static bool tiles_same_spans(const BrushTile *a, const BrushTile *b)
{
    if (a->span_count != b->span_count) return false;
    for (int i = 0; i < a->span_count; i++)
        if (!spans_equal(&a->spans[i], &b->spans[i])) return false;
    return true;
}

static bool brush_covers_interval(const BrushTile *tile, float lo, float hi)
{
    for (int i = 0; i < tile->solid_count; i++)
        if (tile->solids[i].lo <= lo + BRUSH_EPS &&
            tile->solids[i].hi >= hi - BRUSH_EPS)
            return true;
    return false;
}

static bool append_output(void **array, int *count, int *capacity, size_t item,
                          const void *value)
{
    if (*count == *capacity) {
        const int next = *capacity ? *capacity * 2 : 64;
        void *grown = realloc(*array, (size_t)next * item);
        if (!grown) return false;
        *array = grown;
        *capacity = next;
    }
    memcpy((char *)(*array) + (size_t)(*count) * item, value, item);
    (*count)++;
    return true;
}

void sdk_brush_output_free(SdkBrushOutput *out)
{
    if (!out) return;
    free(out->cells);
    free(out->spans);
    free(out->walls);
    free(out->portals);
    free(out->openings);
    memset(out, 0, sizeof *out);
}

// Builds the free-space tile grid. Returns false on invalid input.
static bool build_tiles(const SdkBrushSpec *brushes, int brush_count,
                        const SdkBrushBounds *bounds,
                        float *xs, int nx, float *ys, int ny,
                        BrushTile *tiles, char *error, size_t error_size)
{
    const int tx = nx - 1, ty = ny - 1;
    for (int iy = 0; iy < ty; iy++) {
        for (int ix = 0; ix < tx; ix++) {
            BrushTile *tile = &tiles[iy * tx + ix];
            memset(tile, 0, sizeof *tile);
            tile->x0 = ix; tile->x1 = ix + 1;
            tile->y0 = iy; tile->y1 = iy + 1;
            const float cx = (xs[ix] + xs[ix + 1]) * 0.5f;
            const float cy = (ys[iy] + ys[iy + 1]) * 0.5f;
            BrushInterval raw[BRUSH_MAX_INTERVALS];
            int raw_count = 0;
            for (int b = 0; b < brush_count; b++) {
                const SdkBrushSpec *brush = &brushes[b];
                if (!brush->solid || !point_in_ring(brush->ring, brush->ring_count, cx, cy))
                    continue;
                float lo = fmaxf(brush->bottom, bounds->bottom);
                float hi = fminf(brush->top, bounds->top);
                if (hi <= lo + BRUSH_EPS) continue;
                if (raw_count == BRUSH_MAX_INTERVALS) {
                    set_error(error, error_size, "brush grid: too many overlapping solids in one tile");
                    return false;
                }
                raw[raw_count++] = (BrushInterval){lo, hi, b};
            }
            qsort(raw, (size_t)raw_count, sizeof(BrushInterval), interval_compare);
            for (int i = 0; i < raw_count; i++) {
                if (tile->solid_count &&
                    raw[i].lo <= tile->solids[tile->solid_count - 1].hi + BRUSH_EPS) {
                    if (raw[i].hi > tile->solids[tile->solid_count - 1].hi)
                        tile->solids[tile->solid_count - 1].hi = raw[i].hi;
                    // Keep the later brush as the face writer; deterministic.
                    tile->solids[tile->solid_count - 1].owner = raw[i].owner;
                } else {
                    if (tile->solid_count == BRUSH_MAX_INTERVALS) {
                        set_error(error, error_size, "brush grid: too many solid intervals in one tile");
                        return false;
                    }
                    tile->solids[tile->solid_count++] = raw[i];
                }
            }

            float cursor = bounds->bottom;
            for (int i = 0; i < tile->solid_count; i++) {
                const float lo = tile->solids[i].lo, hi = tile->solids[i].hi;
                if (lo > cursor + BRUSH_EPS) {
                    if (tile->span_count == BRUSH_MAX_INTERVALS) {
                        set_error(error, error_size, "brush grid: too many free intervals in one tile");
                        return false;
                    }
                    BrushFreeSpan span = {cursor, lo, -1, -1};
                    for (int k = 0; k < tile->solid_count; k++)
                        if (fabsf(tile->solids[k].hi - cursor) <= BRUSH_EPS)
                            span.floor_owner = tile->solids[k].owner;
                    for (int k = 0; k < tile->solid_count; k++)
                        if (fabsf(tile->solids[k].lo - lo) <= BRUSH_EPS)
                            span.ceiling_owner = tile->solids[k].owner;
                    tile->spans[tile->span_count++] = span;
                }
                if (hi > cursor) cursor = hi;
            }
            if (cursor < bounds->top - BRUSH_EPS) {
                if (tile->span_count == BRUSH_MAX_INTERVALS) {
                    set_error(error, error_size, "brush grid: too many free intervals in one tile");
                    return false;
                }
                BrushFreeSpan span = {cursor, bounds->top, -1, -1};
                for (int k = 0; k < tile->solid_count; k++)
                    if (fabsf(tile->solids[k].hi - cursor) <= BRUSH_EPS)
                        span.floor_owner = tile->solids[k].owner;
                tile->spans[tile->span_count++] = span;
            }
        }
    }
    return true;
}

static bool rect_overlaps_tool(const SdkBrushSpec *brushes, int brush_count,
                               SdkBrushTool tool, float x0, float y0,
                               float x1, float y1)
{
    for (int i = 0; i < brush_count; i++) {
        if (brushes[i].tool != tool) continue;
        float minx = INFINITY, miny = INFINITY, maxx = -INFINITY, maxy = -INFINITY;
        for (int p = 0; p < brushes[i].ring_count; p++) {
            minx = fminf(minx, brushes[i].ring[p].x);
            miny = fminf(miny, brushes[i].ring[p].y);
            maxx = fmaxf(maxx, brushes[i].ring[p].x);
            maxy = fmaxf(maxy, brushes[i].ring[p].y);
        }
        if (x0 < maxx - BRUSH_EPS && minx < x1 - BRUSH_EPS &&
            y0 < maxy - BRUSH_EPS && miny < y1 - BRUSH_EPS)
            return true;
    }
    return false;
}

static bool merge_barrier(const SdkBrushSpec *brushes, int brush_count,
                          float x0, float y0, float x1, float y1)
{
    return rect_overlaps_tool(brushes, brush_count, SDK_BRUSH_TOOL_AREAPORTAL,
                              x0, y0, x1, y1) ||
           rect_overlaps_tool(brushes, brush_count, SDK_BRUSH_TOOL_HINT,
                              x0, y0, x1, y1);
}

static int find_merge_above(BrushTile *tiles, const BrushCellRec *cells, int cell_count,
                            int tile_count, int tx, int self,
                            const SdkBrushSpec *brushes, int brush_count)
{
    const BrushCellRec *a = &cells[self];
    const BrushTile *ta = &tiles[a->tile];
    for (int j = 0; j < cell_count; j++) {
        if (j == self || cells[j].used) continue;
        const BrushCellRec *b = &cells[j];
        if (fabsf(a->x0 - b->x0) > BRUSH_EPS || fabsf(a->x1 - b->x1) > BRUSH_EPS) continue;
        if (fabsf(a->y1 - b->y0) > BRUSH_EPS) continue;
        if (merge_barrier(brushes, brush_count, a->x0, a->y0, a->x1, b->y1)) continue;
        const BrushTile *tb = &tiles[b->tile];
        if (tiles_same_spans(ta, tb)) return j;
    }
    (void)tile_count; (void)tx;
    return -1;
}

static int find_merge_right(BrushTile *tiles, const BrushCellRec *cells, int cell_count,
                            int tx, int self, int row,
                            const SdkBrushSpec *brushes, int brush_count)
{
    const BrushCellRec *a = &cells[self];
    const BrushTile *ta = &tiles[a->tile];
    for (int j = 0; j < cell_count; j++) {
        if (j == self || cells[j].used) continue;
        const BrushCellRec *b = &cells[j];
        if (b->tile / tx != row) continue;
        if (fabsf(a->y0 - b->y0) > BRUSH_EPS || fabsf(a->y1 - b->y1) > BRUSH_EPS) continue;
        if (fabsf(a->x1 - b->x0) > BRUSH_EPS) continue;
        if (merge_barrier(brushes, brush_count, a->x0, a->y0, b->x1, a->y1)) continue;
        const BrushTile *tb = &tiles[b->tile];
        if (tiles_same_spans(ta, tb)) return j;
    }
    return -1;
}

// The generic append helper uses a capacity pointer; keep brush capacities local.
typedef struct {
    int cell_cap, span_cap, wall_cap, portal_cap, opening_cap;
} BrushCaps;

static bool push_cell(SdkBrushOutput *out, BrushCaps *caps, const SdkBrushCell *item)
{
    return append_output((void **)&out->cells, &out->cell_count, &caps->cell_cap,
                         sizeof *item, item);
}
static bool push_span(SdkBrushOutput *out, BrushCaps *caps, const SdkBrushSpan *item)
{
    return append_output((void **)&out->spans, &out->span_count, &caps->span_cap,
                         sizeof *item, item);
}
static bool push_wall(SdkBrushOutput *out, BrushCaps *caps, const SdkBrushWall *item)
{
    return append_output((void **)&out->walls, &out->wall_count, &caps->wall_cap,
                         sizeof *item, item);
}
static bool push_portal(SdkBrushOutput *out, BrushCaps *caps, const SdkBrushPortal *item)
{
    return append_output((void **)&out->portals, &out->portal_count, &caps->portal_cap,
                         sizeof *item, item);
}
static bool push_opening(SdkBrushOutput *out, BrushCaps *caps, const SdkBrushOpening *item)
{
    return append_output((void **)&out->openings, &out->opening_count,
                         &caps->opening_cap, sizeof *item, item);
}

static int wall_compare(const void *a, const void *b)
{
    const SdkBrushWall *x = (const SdkBrushWall *)a;
    const SdkBrushWall *y = (const SdkBrushWall *)b;
    const bool xv = fabsf(x->x1 - x->x2) <= BRUSH_EPS;
    const bool yv = fabsf(y->y1 - y->y2) <= BRUSH_EPS;
    if (xv != yv) return xv ? -1 : 1;
    if (xv) {
        if (x->x1 != y->x1) return x->x1 < y->x1 ? -1 : 1;
        if (x->bottom != y->bottom) return x->bottom < y->bottom ? -1 : 1;
        if (x->top != y->top) return x->top < y->top ? -1 : 1;
        if (x->flags != y->flags) return x->flags < y->flags ? -1 : 1;
        if (strcmp(x->color, y->color)) return strcmp(x->color, y->color);
        if (x->y1 != y->y1) return x->y1 < y->y1 ? -1 : 1;
        return x->y2 < y->y2 ? -1 : x->y2 > y->y2 ? 1 : 0;
    }
    if (x->y1 != y->y1) return x->y1 < y->y1 ? -1 : 1;
    if (x->bottom != y->bottom) return x->bottom < y->bottom ? -1 : 1;
    if (x->top != y->top) return x->top < y->top ? -1 : 1;
    if (x->flags != y->flags) return x->flags < y->flags ? -1 : 1;
    if (strcmp(x->color, y->color)) return strcmp(x->color, y->color);
    if (x->x1 != y->x1) return x->x1 < y->x1 ? -1 : 1;
    return x->x2 < y->x2 ? -1 : x->x2 > y->x2 ? 1 : 0;
}

// Merges collinear contiguous wall segments with identical policy/material.
static void merge_walls(SdkBrushOutput *out)
{
    if (out->wall_count < 2) return;
    qsort(out->walls, (size_t)out->wall_count, sizeof(SdkBrushWall), wall_compare);
    int write = 0;
    for (int read = 0; read < out->wall_count; read++) {
        SdkBrushWall *w = &out->walls[read];
        const bool vertical = fabsf(w->x1 - w->x2) <= BRUSH_EPS;
        if (write) {
            SdkBrushWall *last = &out->walls[write - 1];
            const bool last_vertical = fabsf(last->x1 - last->x2) <= BRUSH_EPS;
            const bool same_plane = vertical
                ? (last_vertical && fabsf(last->x1 - w->x1) <= BRUSH_EPS)
                : (!last_vertical && fabsf(last->y1 - w->y1) <= BRUSH_EPS);
            const bool same_policy = last->flags == w->flags &&
                                     fabsf(last->bottom - w->bottom) <= BRUSH_EPS &&
                                     fabsf(last->top - w->top) <= BRUSH_EPS &&
                                     !strcmp(last->color, w->color);
            const bool contiguous = vertical
                ? fabsf(last->y2 - w->y1) <= BRUSH_EPS
                : fabsf(last->x2 - w->x1) <= BRUSH_EPS;
            if (same_plane && same_policy && contiguous) {
                if (vertical) { last->y2 = w->y2; }
                else { last->x2 = w->x2; }
                continue;
            }
        }
        if (write != read) out->walls[write] = *w;
        write++;
    }
    out->wall_count = write;
}

bool sdk_brush_compile(const SdkBrushSpec *brushes, int brush_count,
                       const SdkBrushBounds *bounds,
                       SdkBrushOutput *out, SdkBrushStats *stats,
                       char *error, size_t error_size)
{
    if (error && error_size) error[0] = 0;
    if (!out) return false;
    memset(out, 0, sizeof *out);
    if (stats) memset(stats, 0, sizeof *stats);
    if (!bounds || !(bounds->w > 0) || !(bounds->h > 0) ||
        !(bounds->top > bounds->bottom) || !isfinite(bounds->x) ||
        !isfinite(bounds->y) || !isfinite(bounds->w) || !isfinite(bounds->h) ||
        !isfinite(bounds->bottom) || !isfinite(bounds->top)) {
        set_error(error, error_size, "brush compiler: invalid world bounds");
        return false;
    }
    if (brush_count < 0 || (brush_count && !brushes)) {
        set_error(error, error_size, "brush compiler: invalid brush array");
        return false;
    }
    for (int i = 0; i < brush_count; i++) {
        const SdkBrushSpec *b = &brushes[i];
        if (b->ring_count < 3 || b->ring_count > SDK_BRUSH_MAX_POINTS ||
            !ring_rectilinear(b->ring, b->ring_count) ||
            !(b->top > b->bottom)) {
            char message[160];
            snprintf(message, sizeof message,
                     "brush «%s»: need a rectilinear ring of 3..64 points and top > bottom",
                     b->id);
            set_error(error, error_size, message);
            return false;
        }
        R2DWorldPoint ring[SDK_BRUSH_MAX_POINTS];
        for (int p = 0; p < b->ring_count; p++) {
            ring[p].x = b->ring[p].x;
            ring[p].y = b->ring[p].y;
        }
        char poly_error[128] = {0};
        if (!r2d_world_polygon_valid(ring, b->ring_count, poly_error,
                                     sizeof poly_error)) {
            char message[224];
            snprintf(message, sizeof message, "brush «%s»: %s", b->id, poly_error);
            set_error(error, error_size, message);
            return false;
        }
    }

    // Unique coordinate sets from the envelope and every brush vertex.
    const int max_coords = brush_count * SDK_BRUSH_MAX_POINTS * 2 + 4;
    float *coords_x = (float *)malloc((size_t)max_coords * sizeof(float));
    float *coords_y = (float *)malloc((size_t)max_coords * sizeof(float));
    if (!coords_x || !coords_y) {
        free(coords_x); free(coords_y);
        set_error(error, error_size, "brush compiler: out of memory");
        return false;
    }
    int nx = 0, ny = 0;
    coords_x[nx++] = bounds->x;
    coords_x[nx++] = bounds->x + bounds->w;
    coords_y[ny++] = bounds->y;
    coords_y[ny++] = bounds->y + bounds->h;
    for (int i = 0; i < brush_count; i++) {
        for (int p = 0; p < brushes[i].ring_count; p++) {
            coords_x[nx++] = brushes[i].ring[p].x;
            coords_y[ny++] = brushes[i].ring[p].y;
        }
    }
    qsort(coords_x, (size_t)nx, sizeof(float), float_compare);
    qsort(coords_y, (size_t)ny, sizeof(float), float_compare);
    int ux = 0, uy = 0;
    for (int i = 0; i < nx; i++)
        if (!ux || fabsf(coords_x[i] - coords_x[ux - 1]) > BRUSH_EPS)
            coords_x[ux++] = coords_x[i];
    for (int i = 0; i < ny; i++)
        if (!uy || fabsf(coords_y[i] - coords_y[uy - 1]) > BRUSH_EPS)
            coords_y[uy++] = coords_y[i];
    nx = ux; ny = uy;
    if (nx < 2 || ny < 2 || (long long)(nx - 1) * (ny - 1) > BRUSH_MAX_TILES) {
        free(coords_x); free(coords_y);
        set_error(error, error_size, "brush compiler: too many XY partitions; simplify brushes or region size");
        return false;
    }

    BrushTile *tiles = (BrushTile *)calloc((size_t)(nx - 1) * (size_t)(ny - 1),
                                           sizeof(BrushTile));
    if (!tiles) {
        free(coords_x); free(coords_y);
        set_error(error, error_size, "brush compiler: out of memory");
        return false;
    }
    if (!build_tiles(brushes, brush_count, bounds, coords_x, nx, coords_y, ny,
                     tiles, error, error_size)) {
        free(coords_x); free(coords_y); free(tiles);
        return false;
    }

    const int tx = nx - 1, ty = ny - 1;
    BrushCellRec *cells = (BrushCellRec *)calloc((size_t)tx * (size_t)ty,
                                                 sizeof(BrushCellRec));
    if (!cells) {
        free(coords_x); free(coords_y); free(tiles);
        set_error(error, error_size, "brush compiler: out of memory");
        return false;
    }
    int cell_count = 0;
    for (int i = 0; i < tx * ty; i++) {
        if (!tiles[i].span_count) continue;
        cells[cell_count++] = (BrushCellRec){
            coords_x[tiles[i].x0], coords_x[tiles[i].x1],
            coords_y[tiles[i].y0], coords_y[tiles[i].y1], i, 0
        };
    }

    // Deterministic merge: rows first, then vertical chains.
    for (int row = 0; row < ty; row++) {
        for (int i = 0; i < cell_count; i++) {
            if (cells[i].used || cells[i].tile / tx != row) continue;
            for (;;) {
                const int j = find_merge_right(tiles, cells, cell_count, tx, i, row, brushes, brush_count);
                if (j < 0) break;
                cells[i].x1 = cells[j].x1;
                cells[j].used = 1;
            }
        }
    }
    bool changed = true;
    while (changed) {
        changed = false;
        for (int i = 0; i < cell_count; i++) {
            if (cells[i].used) continue;
            for (;;) {
                const int j = find_merge_above(tiles, cells, cell_count,
                                               tx * ty, tx, i, brushes, brush_count);
                if (j < 0) break;
                cells[i].y1 = cells[j].y1;
                cells[j].used = 1;
                changed = true;
            }
        }
    }

    BrushCaps caps = {0};
    int emitted_cells = 0;
    for (int i = 0; i < cell_count; i++) {
        if (cells[i].used) continue;
        const BrushTile *tile = &tiles[cells[i].tile];
        SdkBrushCell cell;
        memset(&cell, 0, sizeof cell);
        cell.x = cells[i].x0;
        cell.y = cells[i].y0;
        cell.w = cells[i].x1 - cells[i].x0;
        cell.h = cells[i].y1 - cells[i].y0;
        cell.first_span = out->span_count;
        cell.span_count = tile->span_count;
        snprintf(cell.owner, sizeof cell.owner, "brush.cell%d", i);
        if (!push_cell(out, &caps, &cell)) goto oom;
        for (int s = 0; s < tile->span_count; s++) {
            SdkBrushSpan span;
            memset(&span, 0, sizeof span);
            span.cell = out->cell_count - 1;
            span.bottom = tile->spans[s].lo;
            span.top = tile->spans[s].hi;
            if (tile->spans[s].floor_owner >= 0)
                copy_text(span.floor_color, sizeof span.floor_color,
                          brushes[tile->spans[s].floor_owner].floor_color);
            else
                copy_text(span.floor_color, sizeof span.floor_color,
                          bounds->floor_color);
            if (tile->spans[s].ceiling_owner >= 0)
                copy_text(span.ceiling_color, sizeof span.ceiling_color,
                          brushes[tile->spans[s].ceiling_owner].ceiling_color);
            else
                copy_text(span.ceiling_color, sizeof span.ceiling_color,
                          bounds->ceiling_color);
            if (!push_span(out, &caps, &span)) goto oom;
        }
        emitted_cells++;
    }

    // Envelope walls: the sky/clip boundary contract. They seal the world and
    // never render as ordinary wall surfaces when boundary_flags says sky.
    {
        const uint16_t flags = bounds->boundary_flags;
        SdkBrushWall w[4];
        memset(w, 0, sizeof w);
        for (int i = 0; i < 4; i++) {
            copy_text(w[i].color, sizeof w[i].color, bounds->side_color);
            w[i].flags = flags;
            snprintf(w[i].id, sizeof w[i].id, "brush.boundary%d", i);
            w[i].bottom = bounds->bottom;
            w[i].top = bounds->top;
        }
        w[0].x1 = w[0].x2 = bounds->x;
        w[0].y1 = bounds->y; w[0].y2 = bounds->y + bounds->h;
        w[1].x1 = w[1].x2 = bounds->x + bounds->w;
        w[1].y1 = bounds->y; w[1].y2 = bounds->y + bounds->h;
        w[2].y1 = w[2].y2 = bounds->y;
        w[2].x1 = bounds->x; w[2].x2 = bounds->x + bounds->w;
        w[3].y1 = w[3].y2 = bounds->y + bounds->h;
        w[3].x1 = bounds->x; w[3].x2 = bounds->x + bounds->w;
        for (int i = 0; i < 4; i++)
            if (!push_wall(out, &caps, &w[i])) goto oom;
    }

    // Exposed solid faces between neighbouring grid tiles.
    for (int iy = 0; iy < ty; iy++) {
        for (int ix = 0; ix < tx; ix++) {
            const BrushTile *tile = &tiles[iy * tx + ix];
            if (!tile->solid_count) continue;
            const int neighbours[4] = {
                ix > 0 ? iy * tx + ix - 1 : -1,
                ix + 1 < tx ? iy * tx + ix + 1 : -1,
                iy > 0 ? (iy - 1) * tx + ix : -1,
                iy + 1 < ty ? (iy + 1) * tx + ix : -1
            };
            for (int side = 0; side < 4; side++) {
                const int n = neighbours[side];
                if (n < 0) continue;
                const BrushTile *other = &tiles[n];
                for (int s = 0; s < tile->solid_count; s++) {
                    const BrushInterval *solid = &tile->solids[s];
                    if (brush_covers_interval(other, solid->lo, solid->hi)) continue;
                    const SdkBrushSpec *owner = &brushes[solid->owner];
                    SdkBrushWall wall;
                    memset(&wall, 0, sizeof wall);
                    snprintf(wall.id, sizeof wall.id, "brush.face%d_%d_%d",
                             iy * tx + ix, side, s);
                    wall.bottom = solid->lo;
                    wall.top = solid->hi;
                    copy_text(wall.color, sizeof wall.color, owner->side_color);
                    wall.flags = owner->wall_flags;
                    if (side == 0) {
                        wall.x1 = wall.x2 = coords_x[ix];
                        wall.y1 = coords_y[iy]; wall.y2 = coords_y[iy + 1];
                    } else if (side == 1) {
                        wall.x1 = wall.x2 = coords_x[ix + 1];
                        wall.y1 = coords_y[iy]; wall.y2 = coords_y[iy + 1];
                    } else if (side == 2) {
                        wall.y1 = wall.y2 = coords_y[iy];
                        wall.x1 = coords_x[ix]; wall.x2 = coords_x[ix + 1];
                    } else {
                        wall.y1 = wall.y2 = coords_y[iy + 1];
                        wall.x1 = coords_x[ix]; wall.x2 = coords_x[ix + 1];
                    }
                    if (!push_wall(out, &caps, &wall)) goto oom;
                }
            }
        }
    }
    merge_walls(out);

    // Portals between merged cells sharing an edge.
    for (int a = 0; a < out->cell_count; a++) {
        for (int b = a + 1; b < out->cell_count; b++) {
            const SdkBrushCell *ca = &out->cells[a];
            const SdkBrushCell *cb = &out->cells[b];
            bool vertical = false, horizontal = false;
            float coord = 0, lo = 0, hi = 0;
            if (fabsf(ca->x + ca->w - cb->x) <= BRUSH_EPS ||
                fabsf(cb->x + cb->w - ca->x) <= BRUSH_EPS) {
                lo = fmaxf(ca->y, cb->y);
                hi = fminf(ca->y + ca->h, cb->y + cb->h);
                if (hi - lo > BRUSH_EPS) {
                    vertical = true;
                    coord = fabsf(ca->x + ca->w - cb->x) <= BRUSH_EPS
                          ? cb->x : ca->x;
                }
            }
            if (!vertical &&
                (fabsf(ca->y + ca->h - cb->y) <= BRUSH_EPS ||
                 fabsf(cb->y + cb->h - ca->y) <= BRUSH_EPS)) {
                lo = fmaxf(ca->x, cb->x);
                hi = fminf(ca->x + ca->w, cb->x + cb->w);
                if (hi - lo > BRUSH_EPS) {
                    horizontal = true;
                    coord = fabsf(ca->y + ca->h - cb->y) <= BRUSH_EPS
                          ? cb->y : ca->y;
                }
            }
            if (!vertical && !horizontal) continue;

            SdkBrushOpening openings[BRUSH_MAX_INTERVALS];
            int opening_count = 0;
            const int sa_first = out->cells[a].first_span;
            const int sb_first = out->cells[b].first_span;
            for (int i = 0; i < ca->span_count; i++) {
                const SdkBrushSpan *sa = &out->spans[sa_first + i];
                for (int j = 0; j < cb->span_count; j++) {
                    const SdkBrushSpan *sb = &out->spans[sb_first + j];
                    const float olo = fmaxf(sa->bottom, sb->bottom);
                    const float ohi = fminf(sa->top, sb->top);
                    if (ohi <= olo + BRUSH_EPS) continue;
                    bool merged = false;
                    for (int k = 0; k < opening_count; k++) {
                        if (olo <= openings[k].top + BRUSH_EPS &&
                            ohi >= openings[k].bottom - BRUSH_EPS) {
                            if (olo < openings[k].bottom) openings[k].bottom = olo;
                            if (ohi > openings[k].top) openings[k].top = ohi;
                            merged = true;
                            break;
                        }
                    }
                    if (!merged && opening_count < BRUSH_MAX_INTERVALS)
                        openings[opening_count++] = (SdkBrushOpening){olo, ohi};
                }
            }
            if (!opening_count) continue;
            // Sort/coalesce openings deterministically.
            for (int i = 0; i < opening_count; i++)
                for (int j = i + 1; j < opening_count; j++)
                    if (openings[j].bottom < openings[i].bottom) {
                        SdkBrushOpening tmp = openings[i];
                        openings[i] = openings[j]; openings[j] = tmp;
                    }
            int coalesced = 0;
            for (int i = 0; i < opening_count; i++) {
                if (coalesced && openings[i].bottom <= openings[coalesced - 1].top + BRUSH_EPS) {
                    if (openings[i].top > openings[coalesced - 1].top)
                        openings[coalesced - 1].top = openings[i].top;
                } else {
                    openings[coalesced++] = openings[i];
                }
            }
            opening_count = coalesced;
            const float mx = vertical ? coord : (lo + hi) * 0.5f;
            const float my = vertical ? (lo + hi) * 0.5f : coord;
            bool area = false;
            for (int i = 0; i < brush_count; i++) {
                if (brushes[i].tool != SDK_BRUSH_TOOL_AREAPORTAL) continue;
                if (ring_contains_inclusive(brushes[i].ring, brushes[i].ring_count, mx, my))
                    area = true;
            }
            SdkBrushPortal portal;
            memset(&portal, 0, sizeof portal);
            snprintf(portal.id, sizeof portal.id, "brush.portal%d_%d", a, b);
            portal.cell_a = a; portal.cell_b = b;
            portal.first_opening = out->opening_count;
            portal.opening_count = opening_count;
            portal.area_portal = area;
            if (vertical) {
                portal.ax = portal.bx = coord;
                portal.ay = lo; portal.by = hi;
            } else {
                portal.ay = portal.by = coord;
                portal.ax = lo; portal.bx = hi;
            }
            if (!push_portal(out, &caps, &portal)) goto oom;
            for (int i = 0; i < opening_count; i++)
                if (!push_opening(out, &caps, &openings[i])) goto oom;
        }
    }

    if (stats) {
        stats->brushes = brush_count;
        for (int i = 0; i < brush_count; i++) {
            if (brushes[i].solid) stats->solids++;
            if (brushes[i].tool != SDK_BRUSH_TOOL_NONE) stats->tool_brushes++;
            if (brushes[i].tool == SDK_BRUSH_TOOL_AREAPORTAL) stats->areaportal_brushes++;
            if (brushes[i].tool == SDK_BRUSH_TOOL_HINT) stats->hint_brushes++;
            if (brushes[i].tool == SDK_BRUSH_TOOL_OCCLUDER) stats->occluder_brushes++;
        }
        stats->cells = out->cell_count;
        stats->spans = out->span_count;
        stats->walls = out->wall_count;
        stats->portals = out->portal_count;
        stats->openings = out->opening_count;
        stats->merged_cells = cell_count - emitted_cells;
        for (int i = 0; i < out->portal_count; i++)
            if (out->portals[i].area_portal) stats->areaportal_edges++;
        for (int i = 0; i < brush_count; i++) {
            if (brushes[i].tool != SDK_BRUSH_TOOL_HINT) continue;
            for (int p = 0; p < out->portal_count; p++) {
                const SdkBrushPortal *portal = &out->portals[p];
                const float mx = (portal->ax + portal->bx) * 0.5f;
                const float my = (portal->ay + portal->by) * 0.5f;
                if (ring_contains_inclusive(brushes[i].ring, brushes[i].ring_count, mx, my)) {
                    stats->hint_edges++;
                    break;
                }
            }
        }
    }
    free(coords_x);
    free(coords_y);
    free(tiles);
    free(cells);
    return true;

oom:
    free(coords_x);
    free(coords_y);
    free(tiles);
    free(cells);
    sdk_brush_output_free(out);
    set_error(error, error_size, "brush compiler: out of memory");
    return false;
}
