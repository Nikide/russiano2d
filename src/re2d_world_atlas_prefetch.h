#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// Deterministic async atlas PNG prefetch (Re2D World).
//
// WHY: registering many atlases does synchronous file reads on the frame that
// registers them. This module reads the raw PNG bytes ahead of time in one
// worker thread so registration can skip the synchronous read when the bytes
// are already in memory.
//
// HARD CONTRACT
// * The worker performs FILE I/O ONLY (stdio). No SDL, QuickJS or GPU calls are
//   made off the main thread — this is exactly the class of unsafe cross-thread
//   usage that crashed the GPU profiler (BASHNYA 2026-10-18).
// * PNG decoding stays on the main thread (SDL_image). The prefetch layer only
//   supplies the exact bytes the synchronous reader would have read.
// * Prefetch never changes rendered pixels, frame content, ordering or
//   warnings: if the bytes are not READY at registration time the caller uses
//   the synchronous path, and if the file changed after the prefetch the stale
//   entry is rejected. Async completion timing therefore cannot affect a frame.
// * Default is OFF; enabling/disabling and clearing is explicit.
//
// THREADING: request/provide/take/poll/clear/info and the entry accessors are
// main-thread only. The worker owns queue/done lists under `mutex`; the main
// thread owns `entries` and the byte accounting.

// Bounds. Overridable only so the native unit test can exercise limits on tiny
// inputs; production uses the defaults below.
#ifndef R2D_ATLAS_PREFETCH_MAX_ENTRIES
#define R2D_ATLAS_PREFETCH_MAX_ENTRIES 64
#endif
#ifndef R2D_ATLAS_PREFETCH_MAX_PENDING_BYTES
#define R2D_ATLAS_PREFETCH_MAX_PENDING_BYTES (256u * 1024u * 1024u)
#endif
#ifndef R2D_ATLAS_PREFETCH_MAX_FILE_BYTES
#define R2D_ATLAS_PREFETCH_MAX_FILE_BYTES (64u * 1024u * 1024u)
#endif
#define R2D_ATLAS_PREFETCH_PATH_MAX 4096
#define R2D_ATLAS_PREFETCH_ERROR_MAX 192

typedef enum {
    R2D_ATLAS_PREFETCH_PENDING = 0,   // queued or being read by the worker
    R2D_ATLAS_PREFETCH_READY = 1,     // bytes in memory, waiting for registration
    R2D_ATLAS_PREFETCH_FAILED = 2,    // missing/changed/unreadable; sync fallback
    R2D_ATLAS_PREFETCH_CONSUMED = 3   // bytes were taken by a registration
} R2DAtlasPrefetchState;

// ---------------------------------------------------------------------------
// SDL: the struct is embedded in R2DWorldRuntime, so the thread/mutex/cond
// declarations are needed. This module never calls SDL_GPU.
// ---------------------------------------------------------------------------
#include <SDL3/SDL.h>

typedef struct R2DAtlasPrefetchJob {
    int token;
    uint32_t epoch;
    size_t expected;
    uint8_t *data;
    size_t size;
    double read_ms;               // time the worker spent reading this file
    bool ok;
    char *canonical;                  // owned by the job (worker reads it)
    char error[R2D_ATLAS_PREFETCH_ERROR_MAX];
    struct R2DAtlasPrefetchJob *next;
} R2DAtlasPrefetchJob;

// One main-thread record shown by world.atlasPrefetchInfo(). Kept after the
// entry is consumed/failed (diagnostics history) until clear/shutdown.
typedef struct {
    char *authored;               // owned (NULL after clear)
    char *canonical;              // owned resolved path (cache key)
    int token;
    int state;                    // R2DAtlasPrefetchState
    size_t bytes;                 // bytes prefetched (0 after clear)
    int64_t mtime_ns;             // file stamp at request (-1 for payload bytes)
    uint32_t epoch;
    char error[R2D_ATLAS_PREFETCH_ERROR_MAX];
    uint8_t *data;                // READY bytes, owned here; transferred by take()
} R2DAtlasPrefetchEntry;

typedef struct {
    bool enabled;                 // explicit game request
    bool worker;                  // worker thread alive
    bool stopping;
    SDL_Thread *thread;
    SDL_Mutex *mutex;
    SDL_Condition *cond;
    R2DAtlasPrefetchJob *queue_head, *queue_tail;   // under mutex
    R2DAtlasPrefetchJob *done_head, *done_tail;     // under mutex
    R2DAtlasPrefetchEntry entries[R2D_ATLAS_PREFETCH_MAX_ENTRIES];
    int entry_count;
    int pending;                  // queued + running entries
    size_t pending_bytes;         // reserved bytes for queued + running
    size_t ready_bytes;           // bytes held by READY entries
    uint32_t epoch;               // bumped by clear; stale jobs are discarded
    int next_token;
    uint64_t requested_total;     // accepted prefetch requests
    uint64_t consumed_total;      // successful take() calls
    uint64_t failed_total;
    uint64_t bytes_read_total;    // bytes successfully read by the worker
    double read_ms_total;         // wall time the worker spent reading files
    char error[R2D_ATLAS_PREFETCH_ERROR_MAX]; // module-level diagnostic
} R2DAtlasPrefetch;

typedef struct {
    bool enabled;
    bool worker;
    int pending, ready, consumed, failed, entries;
    size_t bytes_pending, bytes_ready, limit_bytes;
    uint64_t requested, consumed_total, failed_total, bytes_read;
    double read_ms;
    const char *error;            // "" when none
} R2DAtlasPrefetchInfo;

typedef struct {
    const char *path;             // authored path (diagnostics)
    int token;
    int state;                    // R2DAtlasPrefetchState
    size_t bytes;
    const char *error;
} R2DAtlasPrefetchEntryInfo;

// Zero-initialised state is valid ("disabled, no worker"). init() is explicit
// reset for tests/embedding; shutdown() joins the worker and frees every byte.
void r2d_atlas_prefetch_init(R2DAtlasPrefetch *pf, bool enabled);
void r2d_atlas_prefetch_shutdown(R2DAtlasPrefetch *pf);

// Enables/disables prefetch. Disabling cancels pending reads, drops ready bytes
// and joins the worker. Returns the resulting enabled flag.
bool r2d_atlas_prefetch_set_enabled(R2DAtlasPrefetch *pf, bool enabled);
bool r2d_atlas_prefetch_enabled(const R2DAtlasPrefetch *pf);

// Queue an async read of `canonical` (already resolved absolute/VFS path).
// `expected_size` < 0 means the file is already known to be missing.
// Returns a positive token, or 0 when disabled/already pending-or-ready/limit.
// A missing file still gets a token whose state is FAILED (never throws).
int r2d_atlas_prefetch_request(R2DAtlasPrefetch *pf, const char *authored,
                               const char *canonical, int64_t expected_size,
                               int64_t mtime_ns);

// Register bytes that are already in memory (packed payload): copies them on
// the main thread and creates a READY entry immediately. Same return contract.
int r2d_atlas_prefetch_provide(R2DAtlasPrefetch *pf, const char *authored,
                               const char *canonical, const uint8_t *bytes,
                               size_t size);

// Main thread: move worker-completed jobs into entries/accounting.
void r2d_atlas_prefetch_poll(R2DAtlasPrefetch *pf);

// Take the READY bytes for `canonical`. On success the caller owns the buffer
// (free() it) and the entry becomes CONSUMED; returns false otherwise. A stale
// prefetch (file size/mtime changed since request) is rejected and the caller
// must use the synchronous read path.
bool r2d_atlas_prefetch_take(R2DAtlasPrefetch *pf, const char *canonical,
                             uint8_t **bytes, size_t *size);

// Cancel pending reads, drop ready bytes and forget entries. Byte accounting
// and the lifetime counters are preserved; info() keeps working.
void r2d_atlas_prefetch_clear(R2DAtlasPrefetch *pf);

void r2d_atlas_prefetch_info(const R2DAtlasPrefetch *pf, R2DAtlasPrefetchInfo *out);
int  r2d_atlas_prefetch_entry_count(const R2DAtlasPrefetch *pf);
bool r2d_atlas_prefetch_entry_at(const R2DAtlasPrefetch *pf, int index,
                                 R2DAtlasPrefetchEntryInfo *out);
