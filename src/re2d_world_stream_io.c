#include "re2d_world_stream_io.h"

#include <stdlib.h>
#include <string.h>

static bool valid_kind(int kind)
{
    return kind >= 0 && kind < R2D_STREAM_IO_KIND_COUNT;
}

static void clear_queue_slot(R2DWorldStreamIO *io, int slot)
{
    const int n = io->load_count;
    for (int i = 0; i < n; i++) {
        if (io->load_queue[i] == slot) {
            memmove(io->load_queue + i, io->load_queue + i + 1,
                    (size_t)(n - i - 1) * sizeof(int));
            io->load_count--;
            return;
        }
    }
    const int u = io->unload_count;
    for (int i = 0; i < u; i++) {
        if (io->unload_queue[i] == slot) {
            memmove(io->unload_queue + i, io->unload_queue + i + 1,
                    (size_t)(u - i - 1) * sizeof(int));
            io->unload_count--;
            return;
        }
    }
}

// Load queue is priority-ordered; equal priorities keep insertion order.
static bool queue_load(R2DWorldStreamIO *io, int slot)
{
    if (!io || io->load_count >= io->capacity) return false;
    const R2DWorldStreamIOPayload *item = &io->payloads[slot];
    int position = io->load_count;
    while (position > 0) {
        const int previous = io->load_queue[position - 1];
        const R2DWorldStreamIOPayload *other = &io->payloads[previous];
        if (other->priority >= item->priority) break;
        io->load_queue[position] = io->load_queue[position - 1];
        position--;
    }
    io->load_queue[position] = slot;
    io->load_count++;
    return true;
}

static bool queue_unload(R2DWorldStreamIO *io, int slot)
{
    if (!io || io->unload_count >= io->capacity) return false;
    io->unload_queue[io->unload_count++] = slot;
    return true;
}

bool r2d_world_stream_io_init(R2DWorldStreamIO *io, int capacity)
{
    if (!io || capacity <= 0 || capacity > R2D_WORLD_STREAM_IO_MAX_PAYLOADS) return false;
    memset(io, 0, sizeof *io);
    io->payloads = (R2DWorldStreamIOPayload *)calloc((size_t)capacity, sizeof *io->payloads);
    io->load_queue = (int *)calloc((size_t)capacity, sizeof *io->load_queue);
    io->unload_queue = (int *)calloc((size_t)capacity, sizeof *io->unload_queue);
    if (!io->payloads || !io->load_queue || !io->unload_queue) {
        free(io->payloads); free(io->load_queue); free(io->unload_queue);
        memset(io, 0, sizeof *io);
        return false;
    }
    io->capacity = capacity;
    io->generation = 1;
    return true;
}

void r2d_world_stream_io_free(R2DWorldStreamIO *io)
{
    if (!io) return;
    free(io->payloads);
    free(io->load_queue);
    free(io->unload_queue);
    memset(io, 0, sizeof *io);
}

void r2d_world_stream_io_set_callbacks(R2DWorldStreamIO *io,
                                       R2DWorldStreamIOReadFn read, void *read_user,
                                       R2DWorldStreamIOEvictFn evict, void *evict_user)
{
    if (!io) return;
    io->read = read;
    io->read_user = read_user;
    io->evict = evict;
    io->evict_user = evict_user;
}

void r2d_world_stream_io_set_allocator(R2DWorldStreamIO *io,
                                       R2DWorldStreamIOAllocFn alloc, void *alloc_user)
{
    if (!io) return;
    io->alloc = alloc;
    io->alloc_user = alloc_user;
}

int r2d_world_stream_io_find(const R2DWorldStreamIO *io, int region, int kind)
{
    if (!io || region < 0 || !valid_kind(kind)) return -1;
    for (int i = 0; i < io->count; i++)
        if (io->payloads[i].region == region && io->payloads[i].kind == kind) return i;
    return -1;
}

int r2d_world_stream_io_add(R2DWorldStreamIO *io, int region, int kind,
                            uint64_t bytes, void *payload, const void *source,
                            int priority)
{
    if (!io || region < 0 || !valid_kind(kind)) return -1;
    const int existing = r2d_world_stream_io_find(io, region, kind);
    if (existing >= 0) {
        R2DWorldStreamIOPayload *item = &io->payloads[existing];
        if (item->state == R2D_WORLD_IO_UNLOADED) {
            item->bytes = bytes;
            item->payload = payload;
            item->source = source;
            item->priority = priority;
        }
        return existing;
    }
    if (io->count >= io->capacity) return -1;
    const int slot = io->count++;
    io->payloads[slot] = (R2DWorldStreamIOPayload){
        .region = region, .kind = kind, .priority = priority,
        .bytes = bytes, .payload = payload, .source = source,
        .state = R2D_WORLD_IO_UNLOADED, .token = io->generation++,
    };
    return slot;
}

static int acquire_slot(R2DWorldStreamIO *io, int slot)
{
    R2DWorldStreamIOPayload *item = &io->payloads[slot];
    if (item->refcount < 2147483647) item->refcount++;
    item->last_used = io->frame;
    if (item->state == R2D_WORLD_IO_UNLOADED) {
        item->state = R2D_WORLD_IO_QUEUED_LOAD;
        if (!queue_load(io, slot)) item->state = R2D_WORLD_IO_UNLOADED;
    } else if (item->state == R2D_WORLD_IO_EVICTABLE) {
        item->state = R2D_WORLD_IO_QUEUED_LOAD;
        if (!queue_load(io, slot)) item->state = R2D_WORLD_IO_EVICTABLE;
    } else if (item->state == R2D_WORLD_IO_QUEUED_UNLOAD) {
        // Keep the stale unload entry; tick() skips entries whose state moved
        // back to a load state.
        item->state = R2D_WORLD_IO_QUEUED_LOAD;
        if (!queue_load(io, slot)) item->state = R2D_WORLD_IO_EVICTABLE;
    }
    return slot;
}

int r2d_world_stream_io_acquire(R2DWorldStreamIO *io, int region, int kind,
                                unsigned *token)
{
    if (!io) return -1;
    const int slot = r2d_world_stream_io_find(io, region, kind);
    if (slot < 0) return -1;
    acquire_slot(io, slot);
    io->acquired++;
    if (token) *token = io->payloads[slot].token;
    return slot;
}

bool r2d_world_stream_io_release(R2DWorldStreamIO *io, int region, int kind)
{
    const int slot = r2d_world_stream_io_find(io, region, kind);
    if (slot < 0) return false;
    R2DWorldStreamIOPayload *item = &io->payloads[slot];
    if (item->refcount <= 0) return false;
    item->refcount--;
    io->released++;
    item->last_used = io->frame;
    if (item->refcount == 0 && !item->required && item->state == R2D_WORLD_IO_RESIDENT) {
        item->state = R2D_WORLD_IO_EVICTABLE;
        if (!queue_unload(io, slot)) { /* retried by set_required/tick scan */ }
    }
    return true;
}

bool r2d_world_stream_io_set_required(R2DWorldStreamIO *io, const uint8_t *required,
                                      int region_count)
{
    if (!io || !required || region_count < 0) return false;
    for (int i = 0; i < io->count; i++) {
        R2DWorldStreamIOPayload *item = &io->payloads[i];
        const bool want = item->region < region_count && required[item->region] != 0;
        item->required = want;
        if (want) {
            if (item->state == R2D_WORLD_IO_UNLOADED ||
                item->state == R2D_WORLD_IO_EVICTABLE ||
                item->state == R2D_WORLD_IO_QUEUED_UNLOAD) {
                item->state = R2D_WORLD_IO_QUEUED_LOAD;
                if (!queue_load(io, i)) item->state = R2D_WORLD_IO_EVICTABLE;
            }
        } else if (item->refcount == 0) {
            if (item->state == R2D_WORLD_IO_RESIDENT) {
                item->state = R2D_WORLD_IO_EVICTABLE;
                if (!queue_unload(io, i)) { /* tick's fallback scan handles it */ }
            } else if (item->state == R2D_WORLD_IO_QUEUED_LOAD) {
                item->state = R2D_WORLD_IO_UNLOADED;
                clear_queue_slot(io, i);
            }
        }
    }
    return true;
}

R2DWorldStreamIOState r2d_world_stream_io_state(const R2DWorldStreamIO *io,
                                                int region, int kind)
{
    const int slot = r2d_world_stream_io_find(io, region, kind);
    return slot < 0 ? R2D_WORLD_IO_UNLOADED : io->payloads[slot].state;
}

const void *r2d_world_stream_io_payload(const R2DWorldStreamIO *io, int region, int kind)
{
    const int slot = r2d_world_stream_io_find(io, region, kind);
    if (slot < 0 || io->payloads[slot].state != R2D_WORLD_IO_RESIDENT) return NULL;
    return io->payloads[slot].payload;
}

unsigned r2d_world_stream_io_token(const R2DWorldStreamIO *io, int region, int kind)
{
    const int slot = r2d_world_stream_io_find(io, region, kind);
    return slot < 0 ? 0u : io->payloads[slot].token;
}

const char *r2d_world_stream_io_kind_name(int kind)
{
    switch (kind) {
    case R2D_STREAM_IO_CELLS: return "cells";
    case R2D_STREAM_IO_WALLS: return "walls";
    case R2D_STREAM_IO_SPANS: return "spans";
    case R2D_STREAM_IO_SURFACES: return "surfaces";
    case R2D_STREAM_IO_MATERIALS: return "materials";
    case R2D_STREAM_IO_NAV: return "nav";
    default: return "unknown";
    }
}

static void stats_scan(const R2DWorldStreamIO *io, R2DWorldStreamIOStats *stats)
{
    R2DWorldStreamIOStats out = *stats;
    out.queued_load = io->load_count;
    out.queued_unload = io->unload_count;
    out.loading = 0;
    out.resident = out.evictable = out.unloaded = 0;
    out.resident_bytes = 0;
    for (int i = 0; i < io->count; i++) {
        const R2DWorldStreamIOPayload *item = &io->payloads[i];
        switch (item->state) {
        case R2D_WORLD_IO_LOADING: out.loading++; break;
        case R2D_WORLD_IO_RESIDENT:
            out.resident++;
            out.resident_bytes += item->bytes;
            break;
        case R2D_WORLD_IO_EVICTABLE:
        case R2D_WORLD_IO_QUEUED_UNLOAD:
            out.evictable++;
            out.resident_bytes += item->bytes;
            break;
        default: out.unloaded++; break;
        }
    }
    *stats = out;
}

int r2d_world_stream_io_tick(R2DWorldStreamIO *io, const R2DWorldStreamIOBudget *budget,
                             uint64_t frame, R2DWorldStreamIOStats *stats)
{
    if (!io || io->count < 0 || io->count > io->capacity) return -1;
    R2DWorldStreamIOBudget defaults = {0};
    if (!budget) budget = &defaults;
    if (budget->load_budget_bytes == 0 && budget->unload_budget_bytes == 0 &&
        budget->load_budget_items == 0 && budget->unload_budget_items == 0) {
        if (stats) memset(stats, 0, sizeof *stats);
        return 0;
    }
    io->frame = frame;
    R2DWorldStreamIOStats local;
    memset(&local, 0, sizeof local);
    int transitions = 0;
    uint64_t unloaded_bytes = 0;
    int unload_items = 0;

    // 1. Unload (free) payloads first; the callback releases the caller copy.
    //    A single oversized payload is allowed per tick to avoid deadlock; free
    //    itself is O(1) memory work, so this cannot copy-hitch a frame.
    while (io->unload_count > 0 && budget->unload_budget_items > 0 &&
           budget->unload_budget_bytes > 0 &&
           unload_items < budget->unload_budget_items) {
        const int slot = io->unload_queue[0];
        R2DWorldStreamIOPayload *item = &io->payloads[slot];
        if (item->state != R2D_WORLD_IO_QUEUED_UNLOAD && item->state != R2D_WORLD_IO_EVICTABLE) {
            memmove(io->unload_queue, io->unload_queue + 1,
                    (size_t)(io->unload_count - 1) * sizeof(int));
            io->unload_count--;
            continue;
        }
        if (item->refcount > 0 || item->required) {
            item->state = R2D_WORLD_IO_RESIDENT;
            memmove(io->unload_queue, io->unload_queue + 1,
                    (size_t)(io->unload_count - 1) * sizeof(int));
            io->unload_count--;
            transitions++;
            continue;
        }
        if (budget->unload_budget_bytes > 0 && unload_items > 0 &&
            item->bytes > budget->unload_budget_bytes - unloaded_bytes) {
            local.deferred_unloads++;
            break;
        }
        memmove(io->unload_queue, io->unload_queue + 1,
                (size_t)(io->unload_count - 1) * sizeof(int));
        io->unload_count--;
        if (io->evict) io->evict(io->evict_user, item->region, item->kind,
                                 item->payload, item->bytes);
        item->payload = NULL;
        item->copied = 0;
        item->state = R2D_WORLD_IO_UNLOADED;
        item->token = io->generation++;
        unloaded_bytes += item->bytes;
        local.unloads++;
        unload_items++;
        transitions++;
    }

    // 2. Budgeted load slices. One payload may span many ticks; the byte and
    //    item budgets bound every tick, so region crossing never copies a whole
    //    region payload in one frame.
    uint64_t load_bytes = 0;
    int advanced_items = 0;
    while (io->load_count > 0) {
        if (budget->load_budget_bytes == 0 || budget->load_budget_items <= 0) break;
        if (advanced_items >= budget->load_budget_items) break;
        const int slot = io->load_queue[0];
        R2DWorldStreamIOPayload *item = &io->payloads[slot];
        if (item->state == R2D_WORLD_IO_UNLOADED) {
            clear_queue_slot(io, slot);
            continue;
        }
        if (item->state == R2D_WORLD_IO_QUEUED_LOAD) {
            item->state = R2D_WORLD_IO_LOADING;
            item->copied = 0;
            local.loads_started++;
            transitions++;
            if (item->bytes > 0 && !item->payload && io->alloc)
                item->payload = io->alloc(io->alloc_user, item->region, item->kind,
                                          item->bytes);
            if (item->bytes == 0) {
                item->state = R2D_WORLD_IO_RESIDENT;
                item->token = io->generation++;
                local.loads_completed++;
                clear_queue_slot(io, slot);
                advanced_items++;
                transitions++;
                continue;
            }
        }
        if (item->state != R2D_WORLD_IO_LOADING) {
            clear_queue_slot(io, slot);
            continue;
        }
        const uint64_t remaining_budget = budget->load_budget_bytes - load_bytes;
        if (remaining_budget == 0) break;
        uint64_t need = item->bytes - item->copied;
        uint64_t chunk = need < remaining_budget ? need : remaining_budget;
        if (chunk > 0xffffffffu) chunk = 0xffffffffu;
        const bool ok = chunk == 0 ? true :
            (io->read ? io->read(io->read_user, item->region, item->kind,
                                 item->payload, item->source,
                                 item->copied, (uint32_t)chunk)
                      : (item->source && item->payload
                             ? (memcpy((uint8_t *)item->payload + item->copied,
                                       (const uint8_t *)item->source + item->copied,
                                       (size_t)chunk), true)
                             : false));
        if (!ok) {
            local.read_failures++;
            item->state = R2D_WORLD_IO_UNLOADED;
            item->copied = 0;
            item->token = io->generation++;
            clear_queue_slot(io, slot);
            advanced_items++;
            transitions++;
            continue;
        }
        item->copied += chunk;
        load_bytes += chunk;
        local.bytes_loaded += chunk;
        advanced_items++;
        if (item->copied >= item->bytes) {
            item->state = R2D_WORLD_IO_RESIDENT;
            item->token = io->generation++;
            item->last_used = frame;
            local.loads_completed++;
            clear_queue_slot(io, slot);
            transitions++;
            if (!item->required && item->refcount == 0) {
                item->state = R2D_WORLD_IO_EVICTABLE;
                if (queue_unload(io, slot)) transitions++;
            }
        }
    }
    local.bytes_unloaded = unloaded_bytes;
    local.max_tick_bytes = load_bytes; // this tick only; caller verifies <= budget
    local.acquired = (int)io->acquired;
    local.released = (int)io->released;
    stats_scan(io, &local);
    if (stats) *stats = local;
    return transitions;
}
