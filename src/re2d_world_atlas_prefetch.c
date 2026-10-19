// Deterministic async atlas PNG prefetch — implementation.
//
// See re2d_world_atlas_prefetch.h for the contract. In short:
//   * main thread queues "read these bytes" requests;
//   * one worker thread does stdio only (no SDL/QuickJS/GPU off-thread);
//   * main thread polls completed reads and registration takes the bytes when
//     they are READY, otherwise the caller uses the existing synchronous read.

#include "re2d_world_atlas_prefetch.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static void copy_error(char *dst, size_t size, const char *text)
{
    if (!dst || !size) return;
    SDL_snprintf(dst, size, "%s", text ? text : "");
}

// --- job lists (protected by pf->mutex) ------------------------------------

static void queue_push(R2DAtlasPrefetch *pf, R2DAtlasPrefetchJob *job)
{
    job->next = NULL;
    if (pf->queue_tail) pf->queue_tail->next = job;
    else pf->queue_head = job;
    pf->queue_tail = job;
}

static R2DAtlasPrefetchJob *queue_pop(R2DAtlasPrefetch *pf)
{
    R2DAtlasPrefetchJob *job = pf->queue_head;
    if (!job) return NULL;
    pf->queue_head = job->next;
    if (!pf->queue_head) pf->queue_tail = NULL;
    job->next = NULL;
    return job;
}

static void done_push(R2DAtlasPrefetch *pf, R2DAtlasPrefetchJob *job)
{
    job->next = NULL;
    if (pf->done_tail) pf->done_tail->next = job;
    else pf->done_head = job;
    pf->done_tail = job;
}

static R2DAtlasPrefetchJob *done_pop(R2DAtlasPrefetch *pf)
{
    R2DAtlasPrefetchJob *job = pf->done_head;
    if (!job) return NULL;
    pf->done_head = job->next;
    if (!pf->done_head) pf->done_tail = NULL;
    job->next = NULL;
    return job;
}

static void job_free(R2DAtlasPrefetchJob *job)
{
    if (!job) return;
    free(job->data);
    free(job->canonical);
    free(job);
}

// --- worker: FILE I/O ONLY (stdio) -----------------------------------------

static double now_ms_portable(void)
{
    struct timespec ts;
    if (timespec_get(&ts, TIME_UTC) != TIME_UTC) return 0.0;
    return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1e6;
}

static bool read_file_bytes(const char *path, size_t limit, uint8_t **out,
                            size_t *out_size, char *error, size_t error_size)
{
    *out = NULL;
    *out_size = 0;
    FILE *file = fopen(path, "rb");
    if (!file) {
        SDL_snprintf(error, error_size, "cannot open %s", path);
        return false;
    }
    if (fseek(file, 0, SEEK_END) != 0) {
        fclose(file);
        SDL_snprintf(error, error_size, "cannot seek %s", path);
        return false;
    }
    const long length = ftell(file);
    if (length < 0) {
        fclose(file);
        SDL_snprintf(error, error_size, "cannot size %s", path);
        return false;
    }
    if ((unsigned long long)length > (unsigned long long)limit) {
        fclose(file);
        SDL_snprintf(error, error_size, "file exceeds prefetch limit (%ld bytes)", length);
        return false;
    }
    if (fseek(file, 0, SEEK_SET) != 0) {
        fclose(file);
        SDL_snprintf(error, error_size, "cannot rewind %s", path);
        return false;
    }
    const size_t size = (size_t)length;
    uint8_t *data = (uint8_t *)malloc(size ? size : 1u);
    if (!data) {
        fclose(file);
        SDL_snprintf(error, error_size, "out of memory (%lu bytes)", (unsigned long)size);
        return false;
    }
    const size_t got = size ? fread(data, 1u, size, file) : 0u;
    fclose(file);
    if (got != size) {
        free(data);
        SDL_snprintf(error, error_size, "short read on %s", path);
        return false;
    }
    *out = data;
    *out_size = size;
    return true;
}

static int SDLCALL prefetch_worker(void *user)
{
    R2DAtlasPrefetch *pf = (R2DAtlasPrefetch *)user;
    for (;;) {
        SDL_LockMutex(pf->mutex);
        while (!pf->stopping && !pf->queue_head)
            SDL_WaitCondition(pf->cond, pf->mutex);
        if (pf->stopping) {
            SDL_UnlockMutex(pf->mutex);
            break;
        }
        R2DAtlasPrefetchJob *job = queue_pop(pf);
        SDL_UnlockMutex(pf->mutex);
        if (!job) continue;

        uint8_t *data = NULL;
        size_t size = 0;
        char error[R2D_ATLAS_PREFETCH_ERROR_MAX] = {0};
        const double read_start = now_ms_portable();
        const bool ok = read_file_bytes(job->canonical, R2D_ATLAS_PREFETCH_MAX_FILE_BYTES,
                                        &data, &size, error, sizeof error);
        job->read_ms = now_ms_portable() - read_start;

        SDL_LockMutex(pf->mutex);
        if (pf->stopping || job->epoch != pf->epoch) {
            // Cancelled/cleared while reading: discard, never touch entries.
            free(data);
            job_free(job);
            SDL_UnlockMutex(pf->mutex);
            continue;
        }
        job->data = ok ? data : NULL;
        job->size = ok ? size : 0;
        job->ok = ok;
        copy_error(job->error, sizeof job->error, ok ? "" : error);
        done_push(pf, job);
        SDL_UnlockMutex(pf->mutex);
    }
    return 0;
}

// --- entry helpers (main thread) -------------------------------------------

// Tokens are positive; 0 is reserved for "already/limit/disabled". A
// zero-initialised state (valid for an embedded runtime) starts at 1 here.
static int take_token(R2DAtlasPrefetch *pf)
{
    if (pf->next_token < 1) pf->next_token = 1;
    return pf->next_token++;
}

static R2DAtlasPrefetchEntry *find_entry(R2DAtlasPrefetch *pf, const char *canonical)
{
    if (!pf || !canonical) return NULL;
    for (int i = 0; i < pf->entry_count; i++)
        if (SDL_strcmp(pf->entries[i].canonical, canonical) == 0) return &pf->entries[i];
    return NULL;
}

static R2DAtlasPrefetchEntry *entry_slot(R2DAtlasPrefetch *pf)
{
    if (pf->entry_count < R2D_ATLAS_PREFETCH_MAX_ENTRIES) return &pf->entries[pf->entry_count++];
    // Reuse a finished record: history is diagnostics-only.
    for (int i = 0; i < pf->entry_count; i++) {
        if (pf->entries[i].state == R2D_ATLAS_PREFETCH_FAILED ||
            pf->entries[i].state == R2D_ATLAS_PREFETCH_CONSUMED)
            return &pf->entries[i];
    }
    return NULL;
}

static bool entry_set_paths(R2DAtlasPrefetchEntry *entry, const char *authored,
                            const char *canonical)
{
    const size_t c = canonical ? strlen(canonical) : 0;
    if (c == 0 || c >= R2D_ATLAS_PREFETCH_PATH_MAX) return false;
    entry->canonical = SDL_strdup(canonical);
    entry->authored = SDL_strdup(authored ? authored : canonical);
    if (!entry->canonical || !entry->authored) {
        free(entry->canonical);
        free(entry->authored);
        entry->canonical = entry->authored = NULL;
        return false;
    }
    return true;
}

// Entry is FAILED/READY/CONSUMED with no persisted bytes after this returns.
static void entry_reset(R2DAtlasPrefetchEntry *entry)
{
    free(entry->data);
    free(entry->authored);
    free(entry->canonical);
    memset(entry, 0, sizeof *entry);
    entry->mtime_ns = -1;
}

// Drops a main-thread record that was never committed (path/OOM failure).
static void entry_abort(R2DAtlasPrefetch *pf, R2DAtlasPrefetchEntry *entry)
{
    const int idx = (int)(entry - pf->entries);
    if (idx < 0 || idx >= pf->entry_count) return;
    entry_reset(entry);
    if (idx != pf->entry_count - 1) {
        pf->entries[idx] = pf->entries[pf->entry_count - 1];
        memset(&pf->entries[pf->entry_count - 1], 0, sizeof pf->entries[0]);
        pf->entries[pf->entry_count - 1].mtime_ns = -1;
    }
    pf->entry_count--;
}

// --- worker lifecycle -------------------------------------------------------

static void stop_worker(R2DAtlasPrefetch *pf)
{
    if (!pf) return;
    if (pf->thread) {
        SDL_LockMutex(pf->mutex);
        pf->stopping = true;
        SDL_BroadcastCondition(pf->cond);
        SDL_UnlockMutex(pf->mutex);
        SDL_WaitThread(pf->thread, NULL);
        pf->thread = NULL;
    }
    pf->worker = false;
    pf->stopping = false;
}

static bool ensure_worker(R2DAtlasPrefetch *pf)
{
    if (!pf) return false;
    if (pf->worker) return true;
    if (!pf->mutex) {
        pf->mutex = SDL_CreateMutex();
        pf->cond = SDL_CreateCondition();
        if (!pf->mutex || !pf->cond) {
            if (pf->mutex) { SDL_DestroyMutex(pf->mutex); pf->mutex = NULL; }
            if (pf->cond) { SDL_DestroyCondition(pf->cond); pf->cond = NULL; }
            copy_error(pf->error, sizeof pf->error,
                       "failed to create prefetch thread primitives");
            return false;
        }
    }
    pf->stopping = false;
    pf->thread = SDL_CreateThread(prefetch_worker, "r2d_atlas_prefetch", pf);
    if (!pf->thread) {
        copy_error(pf->error, sizeof pf->error,
                   "failed to start prefetch worker; prefetch unavailable");
        return false;
    }
    pf->worker = true;
    pf->error[0] = 0;
    return true;
}

// --- public API -------------------------------------------------------------

void r2d_atlas_prefetch_init(R2DAtlasPrefetch *pf, bool enabled)
{
    if (!pf) return;
    memset(pf, 0, sizeof *pf);
    pf->enabled = enabled;
    pf->next_token = 1;
    pf->epoch = 1;
}

void r2d_atlas_prefetch_shutdown(R2DAtlasPrefetch *pf)
{
    if (!pf) return;
    stop_worker(pf);
    if (pf->mutex) {
        SDL_LockMutex(pf->mutex);
        R2DAtlasPrefetchJob *job;
        while ((job = queue_pop(pf)) != NULL) job_free(job);
        while ((job = done_pop(pf)) != NULL) job_free(job);
        SDL_UnlockMutex(pf->mutex);
        SDL_DestroyCondition(pf->cond);
        SDL_DestroyMutex(pf->mutex);
        pf->cond = NULL;
        pf->mutex = NULL;
    }
    for (int i = 0; i < pf->entry_count; i++) entry_reset(&pf->entries[i]);
    pf->entry_count = 0;
    pf->pending = 0;
    pf->pending_bytes = 0;
    pf->ready_bytes = 0;
    pf->enabled = false;
    pf->error[0] = 0;
}

bool r2d_atlas_prefetch_set_enabled(R2DAtlasPrefetch *pf, bool enabled)
{
    if (!pf) return false;
    if (!enabled) {
        r2d_atlas_prefetch_clear(pf);
        stop_worker(pf);
        pf->enabled = false;
        return false;
    }
    pf->enabled = true;
    pf->error[0] = 0;
    return true;
}

bool r2d_atlas_prefetch_enabled(const R2DAtlasPrefetch *pf)
{
    return pf ? pf->enabled : false;
}

static int add_failed_entry(R2DAtlasPrefetch *pf, const char *authored,
                            const char *canonical, const char *message)
{
    R2DAtlasPrefetchEntry *entry = entry_slot(pf);
    if (!entry) return 0;
    entry_reset(entry);
    if (!entry_set_paths(entry, authored, canonical)) {
        entry_abort(pf, entry);
        copy_error(pf->error, sizeof pf->error, "prefetch path too long");
        return 0;
    }
    entry->token = take_token(pf);
    entry->state = R2D_ATLAS_PREFETCH_FAILED;
    entry->epoch = pf->epoch;
    copy_error(entry->error, sizeof entry->error, message);
    pf->failed_total++;
    return entry->token;
}

int r2d_atlas_prefetch_request(R2DAtlasPrefetch *pf, const char *authored,
                               const char *canonical, int64_t expected_size,
                               int64_t mtime_ns)
{
    if (!pf || !canonical || !canonical[0]) return 0;
    if (!pf->enabled) return 0;
    if (strlen(canonical) >= R2D_ATLAS_PREFETCH_PATH_MAX ||
        (authored && strlen(authored) >= R2D_ATLAS_PREFETCH_PATH_MAX)) {
        copy_error(pf->error, sizeof pf->error, "prefetch path too long");
        return 0;
    }
    R2DAtlasPrefetchEntry *existing = find_entry(pf, canonical);
    if (existing && (existing->state == R2D_ATLAS_PREFETCH_PENDING ||
                     existing->state == R2D_ATLAS_PREFETCH_READY))
        return 0;   // already prefetched/pending: explicit token 0
    if (expected_size < 0) {
        return add_failed_entry(pf, authored, canonical, "file not found");
    }
    if ((uint64_t)expected_size > (uint64_t)R2D_ATLAS_PREFETCH_MAX_FILE_BYTES) {
        return add_failed_entry(pf, authored, canonical,
                                "file exceeds prefetch per-file limit");
    }
    if ((uint64_t)pf->pending_bytes + (uint64_t)pf->ready_bytes +
            (uint64_t)expected_size > (uint64_t)R2D_ATLAS_PREFETCH_MAX_PENDING_BYTES) {
        copy_error(pf->error, sizeof pf->error,
                   "prefetch byte budget exhausted (pending bytes limit)");
        return 0;
    }
    if (!ensure_worker(pf)) return 0;

    R2DAtlasPrefetchEntry *entry = entry_slot(pf);
    if (!entry) {
        copy_error(pf->error, sizeof pf->error, "prefetch entry budget exhausted");
        return 0;
    }
    entry_reset(entry);
    if (!entry_set_paths(entry, authored, canonical)) {
        entry_abort(pf, entry);
        copy_error(pf->error, sizeof pf->error, "prefetch path too long");
        return 0;
    }
    R2DAtlasPrefetchJob *job = (R2DAtlasPrefetchJob *)calloc(1, sizeof *job);
    if (!job) {
        entry_abort(pf, entry);
        copy_error(pf->error, sizeof pf->error, "out of memory for prefetch job");
        return 0;
    }
    job->canonical = SDL_strdup(canonical);
    if (!job->canonical) {
        free(job);
        entry_abort(pf, entry);
        copy_error(pf->error, sizeof pf->error, "out of memory for prefetch path");
        return 0;
    }
    entry->token = take_token(pf);
    entry->state = R2D_ATLAS_PREFETCH_PENDING;
    entry->mtime_ns = mtime_ns;
    entry->epoch = pf->epoch;
    copy_error(entry->error, sizeof entry->error, "");
    job->token = entry->token;
    job->epoch = pf->epoch;
    job->expected = (size_t)expected_size;

    SDL_LockMutex(pf->mutex);
    queue_push(pf, job);
    SDL_BroadcastCondition(pf->cond);
    SDL_UnlockMutex(pf->mutex);

    pf->pending++;
    pf->pending_bytes += (size_t)expected_size;
    pf->requested_total++;
    return entry->token;
}

int r2d_atlas_prefetch_provide(R2DAtlasPrefetch *pf, const char *authored,
                               const char *canonical, const uint8_t *bytes,
                               size_t size)
{
    if (!pf || !canonical || !canonical[0]) return 0;
    if (size && !bytes) return 0;
    if (!pf->enabled) return 0;
    if (strlen(canonical) >= R2D_ATLAS_PREFETCH_PATH_MAX ||
        (authored && strlen(authored) >= R2D_ATLAS_PREFETCH_PATH_MAX)) {
        copy_error(pf->error, sizeof pf->error, "prefetch path too long");
        return 0;
    }
    R2DAtlasPrefetchEntry *existing = find_entry(pf, canonical);
    if (existing && (existing->state == R2D_ATLAS_PREFETCH_PENDING ||
                     existing->state == R2D_ATLAS_PREFETCH_READY))
        return 0;
    if ((uint64_t)size > (uint64_t)R2D_ATLAS_PREFETCH_MAX_FILE_BYTES) {
        return add_failed_entry(pf, authored, canonical,
                                "payload file exceeds prefetch per-file limit");
    }
    if ((uint64_t)pf->pending_bytes + (uint64_t)pf->ready_bytes + (uint64_t)size >
        (uint64_t)R2D_ATLAS_PREFETCH_MAX_PENDING_BYTES) {
        copy_error(pf->error, sizeof pf->error,
                   "prefetch byte budget exhausted (pending bytes limit)");
        return 0;
    }
    R2DAtlasPrefetchEntry *entry = entry_slot(pf);
    if (!entry) return 0;
    entry_reset(entry);
    if (!entry_set_paths(entry, authored, canonical)) {
        entry_abort(pf, entry);
        return 0;
    }
    uint8_t *copy = NULL;
    if (size) {
        copy = (uint8_t *)malloc(size);
        if (!copy) {
            entry_abort(pf, entry);
            copy_error(pf->error, sizeof pf->error, "out of memory for prefetch bytes");
            return 0;
        }
        memcpy(copy, bytes, size);
    }
    entry->token = take_token(pf);
    entry->state = R2D_ATLAS_PREFETCH_READY;
    entry->bytes = size;
    entry->mtime_ns = -1;
    entry->epoch = pf->epoch;
    entry->data = copy;
    pf->ready_bytes += size;
    pf->requested_total++;
    pf->bytes_read_total += size;
    return entry->token;
}

void r2d_atlas_prefetch_poll(R2DAtlasPrefetch *pf)
{
    if (!pf || !pf->mutex) return;
    R2DAtlasPrefetchJob *job = NULL;
    SDL_LockMutex(pf->mutex);
    while ((job = done_pop(pf)) != NULL) {
        SDL_UnlockMutex(pf->mutex);
        R2DAtlasPrefetchEntry *entry = NULL;
        for (int i = 0; i < pf->entry_count; i++)
            if (pf->entries[i].token == job->token && pf->entries[i].epoch == job->epoch) {
                entry = &pf->entries[i];
                break;
            }
        pf->read_ms_total += job->read_ms;
        if (pf->pending > 0) pf->pending--;
        if (job->expected <= pf->pending_bytes) pf->pending_bytes -= job->expected;
        else pf->pending_bytes = 0;
        if (entry) {
            if (job->ok) {
                entry->state = R2D_ATLAS_PREFETCH_READY;
                entry->bytes = job->size;
                entry->data = job->data;
                job->data = NULL;
                pf->ready_bytes += job->size;
                pf->bytes_read_total += job->size;
                copy_error(entry->error, sizeof entry->error, "");
            } else {
                entry->state = R2D_ATLAS_PREFETCH_FAILED;
                entry->bytes = 0;
                copy_error(entry->error, sizeof entry->error, job->error);
                pf->failed_total++;
            }
        }
        job_free(job);
        SDL_LockMutex(pf->mutex);
    }
    SDL_UnlockMutex(pf->mutex);
}

bool r2d_atlas_prefetch_take(R2DAtlasPrefetch *pf, const char *canonical,
                             uint8_t **bytes, size_t *size)
{
    if (bytes) *bytes = NULL;
    if (size) *size = 0;
    if (!pf || !canonical) return false;
    r2d_atlas_prefetch_poll(pf);
    R2DAtlasPrefetchEntry *entry = find_entry(pf, canonical);
    if (!entry || entry->state != R2D_ATLAS_PREFETCH_READY) return false;
    // Determinism: a file that changed after the prefetch must not be served
    // from stale bytes — fall back to the synchronous read path instead.
    if (entry->mtime_ns >= 0) {
        SDL_PathInfo info;
        if (!SDL_GetPathInfo(entry->canonical, &info) ||
            info.type != SDL_PATHTYPE_FILE ||
            (int64_t)info.size != (int64_t)entry->bytes ||
            (int64_t)info.modify_time != entry->mtime_ns) {
            free(entry->data);
            entry->data = NULL;
            if (pf->ready_bytes >= entry->bytes) pf->ready_bytes -= entry->bytes;
            else pf->ready_bytes = 0;
            entry->bytes = 0;
            entry->state = R2D_ATLAS_PREFETCH_FAILED;
            copy_error(entry->error, sizeof entry->error,
                       "file changed after prefetch; synchronous read used");
            pf->failed_total++;
            return false;
        }
    }
    if (bytes) *bytes = entry->data;
    if (size) *size = entry->bytes;
    entry->data = NULL;
    entry->state = R2D_ATLAS_PREFETCH_CONSUMED;
    if (pf->ready_bytes >= entry->bytes) pf->ready_bytes -= entry->bytes;
    else pf->ready_bytes = 0;
    pf->consumed_total++;
    return true;
}

void r2d_atlas_prefetch_clear(R2DAtlasPrefetch *pf)
{
    if (!pf) return;
    if (pf->mutex) {
        SDL_LockMutex(pf->mutex);
        pf->epoch++;   // running jobs discard their bytes on completion
        R2DAtlasPrefetchJob *job;
        while ((job = queue_pop(pf)) != NULL) job_free(job);
        while ((job = done_pop(pf)) != NULL) job_free(job);
        SDL_UnlockMutex(pf->mutex);
    }
    for (int i = 0; i < pf->entry_count; i++) entry_reset(&pf->entries[i]);
    pf->entry_count = 0;
    pf->pending = 0;
    pf->pending_bytes = 0;
    pf->ready_bytes = 0;
    pf->error[0] = 0;
}

void r2d_atlas_prefetch_info(const R2DAtlasPrefetch *pf, R2DAtlasPrefetchInfo *out)
{
    if (!out) return;
    memset(out, 0, sizeof *out);
    out->limit_bytes = (size_t)R2D_ATLAS_PREFETCH_MAX_PENDING_BYTES;
    if (!pf) return;
    out->enabled = pf->enabled;
    out->worker = pf->worker;
    out->bytes_pending = pf->pending_bytes;
    out->bytes_ready = pf->ready_bytes;
    out->requested = pf->requested_total;
    out->consumed_total = pf->consumed_total;
    out->failed_total = pf->failed_total;
    out->bytes_read = pf->bytes_read_total;
    out->read_ms = pf->read_ms_total;
    out->error = pf->error;
    out->entries = pf->entry_count;
    for (int i = 0; i < pf->entry_count; i++) {
        const R2DAtlasPrefetchEntry *entry = &pf->entries[i];
        switch (entry->state) {
        case R2D_ATLAS_PREFETCH_PENDING: out->pending++; break;
        case R2D_ATLAS_PREFETCH_READY: out->ready++; break;
        case R2D_ATLAS_PREFETCH_FAILED: out->failed++; break;
        case R2D_ATLAS_PREFETCH_CONSUMED: out->consumed++; break;
        default: break;
        }
    }
}

int r2d_atlas_prefetch_entry_count(const R2DAtlasPrefetch *pf)
{
    return pf ? pf->entry_count : 0;
}

bool r2d_atlas_prefetch_entry_at(const R2DAtlasPrefetch *pf, int index,
                                 R2DAtlasPrefetchEntryInfo *out)
{
    if (!out) return false;
    memset(out, 0, sizeof *out);
    if (!pf || index < 0 || index >= pf->entry_count) return false;
    const R2DAtlasPrefetchEntry *entry = &pf->entries[index];
    out->path = entry->authored;
    out->token = entry->token;
    out->state = entry->state;
    out->bytes = entry->bytes;
    out->error = entry->error;
    return true;
}
