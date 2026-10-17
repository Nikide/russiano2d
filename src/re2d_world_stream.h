#pragma once
// ===========================================================================
// Re2D: huge-world residency/streaming cache (R-04 P1, roadmap 72/73/105-107).
//
// Pure C, caller-owned storage, no globals. The module is the deterministic
// bookkeeping half of streaming: it decides which region payloads (BSP,
// surfaces, materials, textures, atlases, lights, decals, nav) are resident,
// which are being preloaded, which are evictable, and how many bytes may be
// promoted/uploaded per frame. Actual disk I/O and GPU work belong to the
// platform/runtime owner: a RESIDENT + !dirty item is the permission to sample
// it, a dirty item is one pending upload.
//
// This is honest incremental residency, not a fake async loader:
//   * PRELOADING/ACTIVE region payloads are promoted toward RESIDENT at a
//     bounded item rate;
//   * PENDING uploads consume a byte/item budget per frame;
//   * over-budget resident items are evicted LRU-first, never from ACTIVE
//     regions;
//   * texture/atlas items use the same state machine, so residency queries and
//     metrics are uniform.
// ===========================================================================
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define R2D_WORLD_STREAM_MAX_ITEMS 65536
#define R2D_WORLD_STREAM_KIND_COUNT 8

typedef enum {
    R2D_STREAM_BSP = 0,
    R2D_STREAM_SURFACES,
    R2D_STREAM_MATERIAL,
    R2D_STREAM_TEXTURE,
    R2D_STREAM_ATLAS,
    R2D_STREAM_LIGHT,
    R2D_STREAM_DECAL,
    R2D_STREAM_NAV
} R2DStreamKind;

typedef enum {
    R2D_STREAM_UNLOADED = 0,
    R2D_STREAM_PRELOAD,
    R2D_STREAM_RESIDENT,
    R2D_STREAM_EVICTABLE
} R2DStreamState;

typedef struct {
    int id;                 // caller-owned stable asset/payload id
    int kind;               // R2DStreamKind
    int region;             // owning region, or -1 for global payloads
    int priority;           // higher first; deterministic tie-break by slot
    uint64_t bytes;         // payload size (GPU upload accounting)
    R2DStreamState state;
    uint64_t last_used;     // frame stamp for LRU eviction
    bool dirty;             // RESIDENT but not yet uploaded
} R2DStreamItem;

// Transition hook: called synchronously for every state change (including
// explicit mark()). The GPU/loader owner uses it to start/stop real uploads.
typedef void (*R2DStreamHook)(void *user, int id, int kind,
                              R2DStreamState from, R2DStreamState to);

typedef struct {
    R2DStreamItem *items;
    int count, capacity;
    R2DStreamHook hook;
    void *hook_user;
} R2DStreamCache;

typedef struct {
    uint64_t resident_budget_bytes; // 0 = unlimited residency
    uint64_t upload_budget_bytes;   // per update() call
    int promote_budget_items;       // PRELOAD->RESIDENT per update()
    int upload_budget_items;        // uploads per update()
    int max_resident_items;         // 0 = unlimited
} R2DStreamBudget;

typedef struct {
    int promoted, demoted, evicted, uploads, deferred_uploads;
    uint64_t upload_bytes;
    uint64_t resident_bytes;
    int resident, preload, evictable, unloaded;
    int textures_resident, atlases_resident;
} R2DStreamStats;

// Allocates `capacity` slots. Returns false on invalid input/OOM.
bool r2d_world_stream_init(R2DStreamCache *cache, int capacity);
void r2d_world_stream_free(R2DStreamCache *cache);

// Registers or returns an existing (id,kind) slot. Returns -1 on invalid input
// or when the cache is full.
int r2d_world_stream_register(R2DStreamCache *cache, int id, int kind, int region,
                              uint64_t bytes, int priority);
int r2d_world_stream_find(const R2DStreamCache *cache, int id, int kind);
// Explicit residency request (textures/atlases/runtime config). Unloading
// clears dirty. Returns false for invalid handles.
bool r2d_world_stream_mark(R2DStreamCache *cache, int id, int kind, R2DStreamState state);
// Marks recent use for LRU. Returns false for unknown assets.
bool r2d_world_stream_touch(R2DStreamCache *cache, int id, int kind, uint64_t frame);
// Installs/clears the transition hook. Pass NULL to clear.
void r2d_world_stream_set_hook(R2DStreamCache *cache, R2DStreamHook hook, void *user);
R2DStreamState r2d_world_stream_state(const R2DStreamCache *cache, int id, int kind);
const char *r2d_world_stream_kind_name(int kind);

// Advances residency for one frame. `region_states` uses R2DWorldRegionState
// values (0 UNLOADED .. 5 SLEEPING); a NULL array or region<0 treats items as
// global (always requested RESIDENT). Bounded, deterministic, allocation-free.
// Returns the number of state transitions (promotions+demotions+evictions).
int r2d_world_stream_update(R2DStreamCache *cache, const uint8_t *region_states,
                            int region_count, const R2DStreamBudget *budget,
                            uint64_t frame, R2DStreamStats *stats);
