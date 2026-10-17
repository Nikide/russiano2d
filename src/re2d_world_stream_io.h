#pragma once
// ===========================================================================
// Re2D: true incremental region-payload streaming/residency manager (task-15).
//
// The existing R2DStreamCache is residency bookkeeping for renderer assets. This
// module moves the actual payload bytes: per (region,payload-kind) descriptors
// with reference counts, explicitly budgeted load slices and unload operations.
// It is the deterministic incremental half of async: a caller supplies a read
// callback (file/zip/memory) and an evict callback; every tick copies at most the
// configured byte/item budget, so a region crossing cannot hitch. A future
// worker-thread backend can share the same descriptors/queues; no thread is
// started here (deterministic, testable, no globals).
//
// Payload kinds mirror the huge-world hierarchy:
//   cells/walls/spans/surfaces/materials/nav.
//
// Ownership: the caller owns `source` and `payload` buffers; this module only
// tracks them and calls the evict callback. `payload` is valid only while the
// state is RESIDENT; `token` changes on every UNLOADED transition so callers can
// reject stale pointers without dereferencing freed memory.
// ===========================================================================
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define R2D_WORLD_STREAM_IO_MAX_PAYLOADS 65536

enum {
    R2D_STREAM_IO_CELLS = 0,
    R2D_STREAM_IO_WALLS,
    R2D_STREAM_IO_SPANS,
    R2D_STREAM_IO_SURFACES,
    R2D_STREAM_IO_MATERIALS,
    R2D_STREAM_IO_NAV,
    R2D_STREAM_IO_KIND_COUNT
};

typedef enum {
    R2D_WORLD_IO_UNLOADED = 0,
    R2D_WORLD_IO_QUEUED_LOAD,
    R2D_WORLD_IO_LOADING,
    R2D_WORLD_IO_RESIDENT,
    R2D_WORLD_IO_QUEUED_UNLOAD,
    R2D_WORLD_IO_EVICTABLE
} R2DWorldStreamIOState;

typedef struct {
    int region;
    int kind;
    int refcount;              // acquire/release pins
    int priority;              // higher loads first (stable insertion order)
    uint64_t bytes;            // payload size
    uint64_t copied;           // bytes moved for the current load
    unsigned token;            // changes on every unload; stale-handle guard
    R2DWorldStreamIOState state;
    uint64_t last_used;
    void *payload;             // caller-owned destination, valid while RESIDENT
    const void *source;        // caller-owned source bytes (optional)
    bool required;             // active/preload ring demands this payload
} R2DWorldStreamIOPayload;

// Copies [offset, offset+bytes) from src into dst. Return false to fail the load.
// Called from tick(); must not block for long (the engine uses it as a bounded
// slice reader over an already-open file/memory payload).
typedef bool (*R2DWorldStreamIOReadFn)(void *user, int region, int kind,
                                       void *dst, const void *src,
                                       uint64_t offset, uint32_t bytes);

// Releases the caller's CPU/GPU copy. Called from tick() when a payload is
// evicted. After it returns, `payload` must not be used (the manager clears it).
typedef void (*R2DWorldStreamIOEvictFn)(void *user, int region, int kind,
                                        void *payload, uint64_t bytes);

// Allocates a fresh payload buffer when a load starts and the current payload
// was released by the evict callback. Returning NULL fails that load.
typedef void *(*R2DWorldStreamIOAllocFn)(void *user, int region, int kind,
                                         uint64_t bytes);

typedef struct {
    // Every field must be positive for that direction to make progress; a zero
    // byte or item budget means "no work of that kind this tick".
    uint64_t load_budget_bytes;
    uint64_t unload_budget_bytes;
    int load_budget_items;        // payloads started/advanced per tick
    int unload_budget_items;
} R2DWorldStreamIOBudget;

typedef struct {
    int loads_started, loads_completed, unloads, read_failures, deferred_unloads;
    uint64_t bytes_loaded, bytes_unloaded;
    uint64_t resident_bytes;
    uint64_t max_tick_bytes;      // bytes moved during this tick (no-hitch proof)
    int queued_load, queued_unload, loading;
    int resident, evictable, unloaded;
    int acquired, released;
} R2DWorldStreamIOStats;

typedef struct {
    R2DWorldStreamIOPayload *payloads;
    int count, capacity;
    int *load_queue;              // sorted by priority desc, insertion asc
    int load_head, load_count;
    int *unload_queue;            // FIFO
    int unload_head, unload_count;
    R2DWorldStreamIOReadFn read;
    void *read_user;
    R2DWorldStreamIOEvictFn evict;
    void *evict_user;
    R2DWorldStreamIOAllocFn alloc;
    void *alloc_user;
    uint64_t frame;
    uint64_t generation;
    uint64_t acquired, released;
} R2DWorldStreamIO;

// Allocates descriptor + queue storage. queue capacity == payload capacity.
bool r2d_world_stream_io_init(R2DWorldStreamIO *io, int capacity);
void r2d_world_stream_io_free(R2DWorldStreamIO *io);
void r2d_world_stream_io_set_callbacks(R2DWorldStreamIO *io,
                                       R2DWorldStreamIOReadFn read, void *read_user,
                                       R2DWorldStreamIOEvictFn evict, void *evict_user);
// Optional payload factory used when a reload needs a new destination buffer.
void r2d_world_stream_io_set_allocator(R2DWorldStreamIO *io,
                                       R2DWorldStreamIOAllocFn alloc, void *alloc_user);
// Registers or returns an existing (region,kind). Duplicate registration updates
// descriptor fields only while UNLOADED. Returns slot or -1.
int r2d_world_stream_io_add(R2DWorldStreamIO *io, int region, int kind,
                            uint64_t bytes, void *payload, const void *source,
                            int priority);
int r2d_world_stream_io_find(const R2DWorldStreamIO *io, int region, int kind);
const char *r2d_world_stream_io_kind_name(int kind);

// Pins a payload and requests its load. Returns slot (>=0) and the current token.
int r2d_world_stream_io_acquire(R2DWorldStreamIO *io, int region, int kind,
                                unsigned *token);
bool r2d_world_stream_io_release(R2DWorldStreamIO *io, int region, int kind);
// Ring requirement mask: one byte per region. Required payloads stay RESIDENT
// (or load) even with refcount 0; dropping the requirement makes unused payloads
// EVICTABLE and queues them for unloading.
bool r2d_world_stream_io_set_required(R2DWorldStreamIO *io, const uint8_t *required,
                                      int region_count);
R2DWorldStreamIOState r2d_world_stream_io_state(const R2DWorldStreamIO *io,
                                                int region, int kind);
// Non-NULL only when RESIDENT.
const void *r2d_world_stream_io_payload(const R2DWorldStreamIO *io, int region, int kind);
unsigned r2d_world_stream_io_token(const R2DWorldStreamIO *io, int region, int kind);

// Advances load/unload work within the per-tick budget. Returns the number of
// state transitions. Allocation-free and deterministic for identical inputs.
int r2d_world_stream_io_tick(R2DWorldStreamIO *io, const R2DWorldStreamIOBudget *budget,
                             uint64_t frame, R2DWorldStreamIOStats *stats);
