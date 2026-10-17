#pragma once
// ===========================================================================
// Re2D: pure C save-game serialization core (P1-H, roadmap sections 44/65/78.9).
//
// Standalone by design: this file depends only on <stdbool.h>/<stdint.h> and
// src/json.c for parsing. It never includes or touches R2DRe2dWorld, movers or
// triggers, owns no globals and is not a third-party format.
//
// Identity rule: authored semantic ids are carried where the authoring side has
// them (span/portal ids, trigger ids). Runtime-owned numeric handles (span,
// portal and mover indices) are stored only inside this explicitly versioned
// snapshot; they are never treated as eternal identity. A loader must resolve
// semantic ids first and only then fall back to snapshot indices for the exact
// map version guarded by r2d_world_save_map_hash().
//
// Format: one JSON object, magic/format string "re2d-save", integer version 1.
//     {"format":"re2d-save","version":1,
//      "spans":[{"span":0,"id":"hall","bottom":0,"top":10}],
//      "portals":[{"portal":0,"id":"gate","open_fraction":1,"closed":false}],
//      "movers":[{"type":0,"span":3,"portal":-1,"from":0,"to":4,
//                 "position":2,"fraction":0.5,"speed":2,"wait":1,
//                 "timer":0,"phase":1,"direction":1,
//                 "auto_return":true,"blocking":false}],
//      "triggers":[{"id":"gate.use","type":1,"fire_count":0,
//                   "enabled":true,"once":true,"armed":false,"timer":0}]}
//
// Counts are bounded by the runtime topology limit (spans/portals 65536;
// movers 256, triggers 512), ids are
// bounded to 63 bytes plus NUL, duplicate trigger ids are rejected, all numbers
// must be finite and |v| <= 1e8. Errors are ASCII.
//
// Reading is transactional: on failure every owned array is freed and the
// output struct is zeroed. Writing never allocates. Both are deterministic.
// ===========================================================================
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define R2D_WORLD_SAVE_FORMAT "re2d-save"
#define R2D_WORLD_SAVE_VERSION 1

#define R2D_WORLD_SAVE_MAX_SPANS 65536
#define R2D_WORLD_SAVE_MAX_PORTALS 65536
#define R2D_WORLD_SAVE_MAX_MOVERS 256
#define R2D_WORLD_SAVE_MAX_TRIGGERS 512
#define R2D_WORLD_SAVE_ID_CAP 64   // 63 usable bytes plus NUL
#define R2D_WORLD_SAVE_MAX_VALUE 1.0e8f

typedef struct {
    int span;                 // runtime span handle inside this snapshot
    float bottom,top;         // saved runtime height plane
    char id[R2D_WORLD_SAVE_ID_CAP]; // authored semantic id, may be empty
} R2DWorldSavedSpan;

typedef struct {
    int portal;               // runtime portal handle inside this snapshot
    float open_fraction;      // 0..1 smooth portal state
    bool closed;              // binary collision/visibility view
    bool sky;                 // P2 sky portal flag
    bool mirror;              // P2 mirror portal flag
    char id[R2D_WORLD_SAVE_ID_CAP]; // authored semantic id, may be empty
} R2DWorldSavedPortal;

typedef struct {
    int type,span,portal;     // mover type; target span and/or portal (-1 = unset)
    float from,to,position,fraction,speed,wait,timer;
    int phase,direction;
    bool auto_return,blocking;
} R2DWorldSavedMover;

typedef struct {
    char id[R2D_WORLD_SAVE_ID_CAP]; // required, unique semantic event name
    int type;
    int fire_count;
    bool enabled,once,armed;
    float timer;
} R2DWorldSavedTrigger;

typedef struct {
    R2DWorldSavedSpan *spans;
    int span_count;
    R2DWorldSavedPortal *portals;
    int portal_count;
    R2DWorldSavedMover *movers;
    int mover_count;
    R2DWorldSavedTrigger *triggers;
    int trigger_count;
} R2DWorldSaveState;

// Writes canonical, versioned JSON. Returns the required byte count excluding
// the NUL terminator (snprintf semantics): at most cap-1 bytes plus NUL are
// written, and cap==0 performs a capacity query (out may be NULL there).
// Returns -1 for NULL/invalid state. Never allocates.
int r2d_world_save_write(const R2DWorldSaveState *state,char *out,size_t cap);

// Parses and validates a save. Allocates the owned arrays on success. On any
// failure (bad/missing version, corrupt JSON, invalid field, duplicate trigger
// id, oversized count/string) it writes an ASCII error, frees the output and
// zeroes it. Query-only; no globals.
// Validate an in-memory state before writing. Same checks as the writer; on
// failure `error` describes the exact count/field (ASCII, NUL-terminated).
bool r2d_world_save_validate(const R2DWorldSaveState *state,char *error,size_t error_size);

bool r2d_world_save_read(const char *text,R2DWorldSaveState *out,char *error,size_t error_size);

// Frees owned arrays and zeroes the struct. Safe on NULL/partially filled state.
void r2d_world_save_free(R2DWorldSaveState *state);

// Map identity guard: stable 64-bit FNV-1a hash over map id, map version and the
// native topology hash. Use it to reject a save whose map semantic version or
// numeric topology changed. NULL strings are treated as empty. Allocation-free.
uint64_t r2d_world_save_map_hash(const char *map_id,const char *version,uint64_t topology_hash);
