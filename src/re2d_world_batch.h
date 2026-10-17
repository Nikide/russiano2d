#pragma once
// ===========================================================================
// Re2D World: static batching data path (P4, GPU-independent half).
//
// Visible surfaces and actor cards are grouped deterministically by
// (material, blend, light policy, atlas). The result is a flat, packed
// instance array that is already in std430/SSBO layout plus a group table.
// The GPU renderer can upload both buffers verbatim; this module never talks to
// SDL_GPU and performs no draw calls, so draw attribution stays in the
// existing renderer.
//
// Contract
// --------
// * `R2DWorldBatchInstance` is exactly 32 bytes, eight uint32 fields, natural
//   std430 alignment. Arrays are tightly packed, no padding.
// * Instances are sorted by group key (material, blend, light policy, atlas)
//   ascending; within a group the original submission order is preserved.
//   `r2d_world_batch_build()` is deterministic for identical input.
// * `R2DWorldBatchGroup.first/count` index into the instance array. A group is
//   one bind: `saved_binds = instances - groups` (every instance after the
//   first in a group avoids a bind).
// * Caller owns all buffers. No allocation, no globals, no GPU state.
//
// Instance flags (`R2DWorldBatchInstance.flags`):
//   bits 0..3  kind: 0 surface, 1 actor card, 2 sky/other
//   bits 4..7  blend: 0 opaque, 1 masked, 2 translucent, 3 additive
//   bit 8      sky/panorama instance
//   bit 9      emissive/unlit material
//   bit 10     shadow-casting policy
// The renderer may use the remaining bits for its own per-instance flags; the
// key fields are duplicated as explicit uint32 fields.
// ===========================================================================
#include "re2d_world.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define R2D_WORLD_BATCH_INSTANCE_BYTES 32

enum {
    R2D_WORLD_BATCH_KIND_SURFACE = 0,
    R2D_WORLD_BATCH_KIND_ACTOR = 1,
    R2D_WORLD_BATCH_KIND_SKY = 2
};

enum {
    R2D_WORLD_BATCH_LIGHT_UNLIT = 0,
    R2D_WORLD_BATCH_LIGHT_STATIC = 1,
    R2D_WORLD_BATCH_LIGHT_DYNAMIC = 2
};

// One submission candidate (caller fills these from visibility/actors).
typedef struct {
    int surface;       // world surface id, or actor/sky id
    int span;          // owning span, -1 when not applicable
    int material;      // material slot, -1 = default
    int blend;         // R2D_WORLD_* blend
    int light_policy;  // R2D_WORLD_BATCH_LIGHT_*
    int atlas;         // atlas/directional id, -1 = none
    int kind;          // R2D_WORLD_BATCH_KIND_*
    uint32_t tint;     // packed RGBA8
    uint32_t aux;      // caller data (actor index, frame, light mask…)
} R2DWorldBatchItem;

// Packed SSBO-ready instance (32 bytes).
typedef struct {
    uint32_t surface;
    uint32_t span;
    uint32_t material;
    uint32_t flags;
    uint32_t tint;
    uint32_t aux;
    uint32_t light;
    uint32_t atlas;     // atlas/directional id, 0xffffffff = none
} R2DWorldBatchInstance;

typedef struct {
    uint32_t material;
    uint32_t blend;
    uint32_t light_policy;
    uint32_t atlas;
    uint32_t first;
    uint32_t count;
} R2DWorldBatchGroup;

typedef struct {
    int groups, instances, saved_binds;
    int surfaces, actors, skies;
    int overflow;        // 1 when caller capacity was insufficient
} R2DWorldBatchStats;

typedef struct {
    R2DWorldBatchItem *items;
    int item_count, item_capacity;
} R2DWorldBatchScratch;

typedef struct {
    R2DWorldBatchGroup *groups;
    int group_capacity;
    R2DWorldBatchInstance *instances;
    int instance_capacity;
} R2DWorldBatchBuffers;

// Initialize one item with normalized values (negative ids -> -1, kind/blend
// clamped to the documented ranges). NULL is a no-op.
void r2d_world_batch_item(R2DWorldBatchItem *item, int kind, int surface, int span,
                          int material, int blend, int light_policy, int atlas,
                          uint32_t tint, uint32_t aux);

// Stable sort key helper: packs material/blend/light/atlas into one uint32 with
// two-way mixing, useful for diagnostics. Deterministic, no global state.
uint32_t r2d_world_batch_key(int material, int blend, int light_policy, int atlas);

// Convert the visible surface list from R2DWorldVisibility into batch items.
// Writes at most `capacity` items in visibility order and returns the total
// count (may exceed capacity). `stats` (optional) is filled with per-kind
// counts and overflow. Material/blend/light policy are read from the world:
// surface material slot, blend, emissive/sky => UNLIT, otherwise baked vs
// dynamic light policy.
int r2d_world_batch_from_visibility(const R2DRe2dWorld *world,
                                    const R2DWorldVisibility *visibility,
                                    R2DWorldBatchItem *items, int capacity,
                                    R2DWorldBatchStats *stats);

// Group + pack items into SSBO-ready arrays. Returns total instances required
// (may exceed instance_capacity); writes the nearest capacity subset and as
// many fully-formed groups as fit. stats->overflow is set when truncated.
// groups/instances may be NULL only when their capacity is 0.
int r2d_world_batch_build(const R2DWorldBatchItem *items, int item_count,
                          const R2DWorldBatchBuffers *buffers,
                          R2DWorldBatchStats *stats);

// Convenience: allocate nothing, build directly from visibility using a
// caller-owned scratch item array. Returns the total instance count, or -1 for
// invalid input. Used by the runtime hook and native tests.
int r2d_world_batch_visibility(const R2DRe2dWorld *world,
                               const R2DWorldVisibility *visibility,
                               R2DWorldBatchScratch *scratch,
                               const R2DWorldBatchBuffers *buffers,
                               R2DWorldBatchStats *stats);
