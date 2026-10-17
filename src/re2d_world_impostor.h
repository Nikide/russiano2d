#pragma once
// ===========================================================================
// Re2D: distant region impostors (R-04 P1, roadmap 80/81/120).
//
// Bakes one cheap vertical silhouette card per occupied region from the same
// constrained cells/spans the local renderer uses. No mesh, no 3D: the card is
// a world-space billboard descriptor (centre, width/height, bottom/top, average
// floor tint, distance) plus region-local coordinates for far-from-origin
// rendering. The GPU owner draws it as one textured/coloured quad per distant
// region; this module only decides what exists and what is visible.
// ===========================================================================
#include "re2d_world.h"
#include "re2d_world_region.h"
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    int region;
    float cx, cy;              // world-space centre of the occupied bounds
    float local_x, local_y;    // centre relative to the region centre
    float width, height;       // silhouette card size in world units
    float bottom, top;         // vertical extent from the region spans
    uint32_t color;            // average floor tint (0xRRGGBB)
    int cells, spans;
    float distance;            // filled by collect(), 0 in the baked set
    bool valid;
} R2DWorldImpostor;

typedef struct {
    R2DWorldImpostor *items;
    int count, capacity;
} R2DWorldImpostorSet;

// Sizing call (items NULL/capacity 0) returns the required count. Otherwise
// builds one card per occupied region, deterministic region order. Returns the
// count or -1 on invalid input.
int r2d_world_impostors_build(const R2DWorldRegionSet *regions,
                              const R2DWorldCell *cells, int cell_count,
                              const R2DWorldSpan *spans, int span_count,
                              R2DWorldImpostorSet *out, char *error, size_t error_size);

void r2d_world_impostors_free(R2DWorldImpostorSet *set);

// Collects cards for regions that are (a) PVS-visible from `from_region`,
// (b) not fully occluded, (c) farther than `min_distance` and (d) closer than
// `max_distance` from the camera. Output is nearest-first and capped at
// `capacity`; the return value is the total number of matching cards.
int r2d_world_impostors_collect(const R2DWorldImpostorSet *set,
                                const R2DWorldRegionSet *regions, int from_region,
                                const R2DWorldOccluder *occluders, int occluder_count,
                                float camera_x, float camera_y,
                                float min_distance, float max_distance,
                                R2DWorldImpostor *out, int capacity);
