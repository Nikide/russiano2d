#pragma once
// ===========================================================================
// Re2D runtime hint / skip / occluder visibility consumer (roadmap 75-79/126).
//
// Contract with the compiler (SDK side is owned by another pass):
//   * a concrete hint barrier is authored as a zero-policy wall carrying
//     R2D_WALL_TOOL_HINT, lying exactly on a portal edge, with bottom/top equal
//     to the portal opening. It cuts VIEW traversal only; collision, hitscan,
//     light/audio rays and rendering are untouched because no other policy bit
//     is set.
//   * R2D_WALL_TOOL_SKIP is compiler-only; if a marker wall survives, the
//     runtime counts it and ignores it (skip never affects runtime visibility).
//   * an occluder is a wall carrying R2D_WALL_OCCLUDER (no render/collision/
//     ray/acoustic bits). Its XY segment is a conservative outdoor occluder.
// No side table is required: the markers are ordinary R2DWorldWall entries and
// therefore travel through existing JSON and RDW5 bake without a new format.
//
// The cache is caller-owned and allocation-free at query time:
//   int hints, skips, occluders;
//   r2d_world_hint_counts(world, &hints, &skips, &occluders);
//   R2DWorldHintBarrier barriers[hints];
//   R2DWorldOccluder segments[occluders];
//   R2DWorldHintCache cache = { .barriers=..., ... };
//   r2d_world_hint_cache_build(world, &cache, error, sizeof error);
//
// Legacy maps contain none of these markers: the cache is empty and visibility
// counters stay zero, so old worlds are byte-for-byte/behaviour identical.
// ===========================================================================
#include "re2d_world.h"
#include "re2d_world_region.h" // R2DWorldOccluder (region coarse pass)

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    float x1, y1, x2, y2;
    float bottom, top;
    int wall; // source R2DWorldWall index for diagnostics
} R2DWorldHintBarrier;

typedef struct R2DWorldHintCache {
    R2DWorldHintBarrier *barriers;
    int barrier_capacity;
    int barrier_count;
    R2DWorldOccluder *occluders;
    int occluder_capacity;
    int occluder_count;
    int hint_markers;
    int skip_markers;
    uint64_t topology_revision;
    const R2DRe2dWorld *world; // identity guard for safe reuse
} R2DWorldHintCache;

// Required marker counts (invalid/non-finite markers are ignored).
void r2d_world_hint_counts(const R2DRe2dWorld *world, int *hint_markers,
                           int *skip_markers, int *occluder_segments);

// Fills caller arrays in authored wall order (deterministic). Returns false on
// invalid arguments/insufficient capacity; on success sets counts and revision.
bool r2d_world_hint_cache_build(const R2DRe2dWorld *world, R2DWorldHintCache *cache,
                                char *error, size_t error_size);

// True when an authored hint barrier covers this portal's view plane/range.
// With cache==NULL (or a stale cache) the function scans the world walls, which
// is the pre-cache legacy path. Never mutates the world.
bool r2d_world_hint_portal_blocked(const R2DWorldHintCache *cache,
                                   const R2DRe2dWorld *world,
                                   const R2DWorldPortal *portal);

// Conservative coarse occlusion of an axis-aligned cell rect: true only when
// all five sample points (corners + centre) are hidden behind an authored
// occluder segment from the camera. A cell containing the camera is never
// occluded. Empty cache -> false.
bool r2d_world_hint_cell_occluded(const R2DWorldHintCache *cache,
                                  float x, float y, float w, float h,
                                  float camera_x, float camera_y);

bool r2d_world_hint_rebuild_needed(const R2DWorldHintCache *cache,
                                   const R2DRe2dWorld *world);
