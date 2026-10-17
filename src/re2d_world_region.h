#pragma once
// ===========================================================================
// Re2D: huge-world region partition, streaming and coarse visibility.
//
// This is the R-04 foundation: the runtime never builds one giant BSP. Cells
// are grouped into a deterministic XY region grid; each region keeps its own
// cell list, portal incidence and coarse PVS row. Queries are pure C and work
// on caller-provided storage (build uses a temporary integer grid only).
//
// The module is independent of the renderer: it consumes plain cell rects and
// portal links, so the map compiler can feed it before a R2DRe2dWorld exists
// and the runtime can rebuild the same partition after loading a world. There
// is no 3D mesh, no ECS and no second scene graph.
//
// Region-local coordinates
// ------------------------
// r2d_world_region_local() subtracts the region centre, giving stable float
// ranges for rendering far from world origin. Gameplay still uses world XY.
//
// Visibility model
// ----------------
// Coarse PVS is region reachability over open portals: region A sees region B
// when B is reachable through portals whose closed flag is false (areaportal
// brushes are ordinary portals the runtime closes dynamically). Closed
// areaportals therefore remove whole region branches. Local BSP/portal
// visibility still runs after the region stage (hierarchical visibility):
// first reject regions, then reject cells inside surviving regions.
//
// Streaming model
// ---------------
// UNLOADED -> METADATA -> PRELOADING -> RESIDENT -> ACTIVE, and ACTIVE ->
// SLEEPING -> UNLOADED on the way out. r2d_world_region_update_active() marks
// the current region ring and preload ring; r2d_world_region_stream() advances
// PRELOADING -> RESIDENT with a per-frame budget. No payload pointers live in
// this module: the caller owns BSP/surface/material residency and uses state
// transitions as the streaming contract.
// ===========================================================================
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define R2D_WORLD_REGION_MAX_GRID 4096
#define R2D_WORLD_REGION_PVS_WORDS(n) (((n) + 63) / 64)
#define R2D_WORLD_REGION_MAX_RING 8

typedef enum {
    R2D_WORLD_REGION_UNLOADED = 0,
    R2D_WORLD_REGION_METADATA,
    R2D_WORLD_REGION_PRELOADING,
    R2D_WORLD_REGION_RESIDENT,
    R2D_WORLD_REGION_ACTIVE,
    R2D_WORLD_REGION_SLEEPING
} R2DWorldRegionState;

// Minimal inputs: an axis-aligned cell rect (runtime model) and a portal link
// between two cell indices. The compiler adapts authored cells/portals here.
typedef struct {
    float x, y, w, h;
} R2DWorldRegionCell;

typedef struct {
    int cell_a, cell_b;
    bool closed;      // door/lift/areaportal currently closed
    bool areaportal;  // compiler-marked areaportal edge (diagnostics/streaming)
} R2DWorldRegionPortal;

typedef struct {
    int col, row;                 // grid coordinates
    float x, y, w, h;             // region bounds in world XY
    int first_cell, cell_count;   // CSR into region_cells
    int first_portal, portal_count; // portals touching this region
    int first_neighbor, neighbor_count; // region adjacency
} R2DWorldRegion;

typedef struct {
    int active_count, preload_count, resident_count, sleeping_count;
    int unloaded_count, metadata_count, preloading_count;
    int visible_regions, culled_regions;
    int pvs_edges;
} R2DWorldRegionMetrics;

// Render LOD decision derived from camera distance. Kept as a plain value so
// callers can feed existing sprite/light/particle budgets without a new graph.
typedef struct {
    int sprite_directions;  // 16/8/4/1/0
    int animation_fps;      // 0 = hidden
    int light_updates;      // 0 = no dynamic updates
    int particle_percent;   // 100/50/20/0
    bool impostor;          // distant region may use a baked silhouette card
    bool hidden;
} R2DWorldRegionLod;

typedef struct {
    R2DWorldRegion *regions;
    int region_capacity;
    int *cell_region;
    int cell_region_capacity;
    int *region_cells;
    int region_cells_capacity;
    int *region_portal_offsets;
    int region_portal_offsets_capacity;
    int *region_portal_refs;
    int region_portal_refs_capacity;
    int *region_adj_offsets;
    int region_adj_offsets_capacity;
    int *region_adj_refs;
    int region_adj_refs_capacity;
    uint64_t *pvs;
    int pvs_capacity;
    int pvs_words;
    int region_count, columns, rows;
    float region_size, origin_x, origin_y;
    int cell_count, portal_count;
    R2DWorldRegionMetrics metrics;
} R2DWorldRegionSet;

// All output storage is caller-provided. A sizing call (all arrays NULL,
// capacities 0) returns the required region count and fills pvs_words.
// Otherwise the required capacities are:
//   regions                >= region_count
//   cell_region            >= cell_count
//   region_cells           >= cell_count
//   region_portal_offsets  >= region_count + 1
//   region_portal_refs     >= portal_count * 2
//   region_adj_offsets     >= region_count + 1
//   region_adj_refs        >= portal_count * 2
//   pvs                    >= region_count * pvs_words
// Returns the region count (>= 1) on valid input, or -1 on invalid arguments.
int r2d_world_region_build(const R2DWorldRegionCell *cells, int cell_count,
                           const R2DWorldRegionPortal *portals, int portal_count,
                           float region_size, R2DWorldRegionSet *out,
                           char *error, size_t error_size);

// Region containing world XY, or -1 outside the built grid.
int r2d_world_region_at(const R2DWorldRegionSet *set, float x, float y);

// Coarse region PVS query.
bool r2d_world_region_visible(const R2DWorldRegionSet *set,
                              int from_region, int to_region);

// Rebuild PVS after door/areaportal state changes. `portals` uses the current
// closed flags. Returns false on invalid handles.
bool r2d_world_region_rebuild_pvs(R2DWorldRegionSet *set,
                                  const R2DWorldRegionPortal *portals,
                                  int portal_count);

// Marks the region ring as active/preload and writes both lists (up to their
// capacities). States are written for every region. Returns active_count.
int r2d_world_region_update_active(R2DWorldRegionSet *set, int center_region,
                                   int active_radius, int preload_radius,
                                   uint8_t *states, int state_capacity,
                                   int *active, int active_capacity,
                                   int *preload, int preload_capacity);

// Advances PRELOADING -> RESIDENT for at most `budget` regions and demotes
// non-active RESIDENT/SLEEPING regions one step. Returns the number of state
// transitions performed. Deterministic row-major order.
int r2d_world_region_stream(R2DWorldRegionSet *set, uint8_t *states,
                            int state_capacity, int budget);

// world XY -> region-local XY (relative to region centre). Returns false for an
// invalid region handle.
bool r2d_world_region_local(const R2DWorldRegionSet *set, int region,
                            float world_x, float world_y,
                            float *local_x, float *local_y);

// Distance LOD. `distance` is in world units from the camera region centre.
void r2d_world_region_lod(float distance, R2DWorldRegionLod *out);
