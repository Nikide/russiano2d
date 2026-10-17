#include "re2d_world_stream.h"
#include "re2d_world_region.h"

#include <stdlib.h>
#include <string.h>

static bool valid_kind(int kind)
{
    return kind >= 0 && kind < R2D_WORLD_STREAM_KIND_COUNT;
}

static bool valid_state(int state)
{
    return state >= R2D_STREAM_UNLOADED && state <= R2D_STREAM_EVICTABLE;
}

static void stream_transition(R2DStreamCache *cache, R2DStreamItem *item, R2DStreamState next)
{
    const R2DStreamState previous = item->state;
    if (previous == next) return;
    item->state = next;
    if (cache->hook) cache->hook(cache->hook_user, item->id, item->kind, previous, next);
}

void r2d_world_stream_set_hook(R2DStreamCache *cache, R2DStreamHook hook, void *user)
{
    if (!cache) return;
    cache->hook = hook;
    cache->hook_user = user;
}

bool r2d_world_stream_init(R2DStreamCache *cache, int capacity)
{
    if (!cache || capacity <= 0 || capacity > R2D_WORLD_STREAM_MAX_ITEMS) return false;
    memset(cache, 0, sizeof *cache);
    cache->items = (R2DStreamItem *)calloc((size_t)capacity, sizeof *cache->items);
    if (!cache->items) return false;
    cache->capacity = capacity;
    return true;
}

void r2d_world_stream_free(R2DStreamCache *cache)
{
    if (!cache) return;
    free(cache->items);
    memset(cache, 0, sizeof *cache);
}

int r2d_world_stream_find(const R2DStreamCache *cache, int id, int kind)
{
    if (!cache || !valid_kind(kind)) return -1;
    for (int i = 0; i < cache->count; i++)
        if (cache->items[i].id == id && cache->items[i].kind == kind) return i;
    return -1;
}

int r2d_world_stream_register(R2DStreamCache *cache, int id, int kind, int region,
                              uint64_t bytes, int priority)
{
    if (!cache || !valid_kind(kind) || region < -1) return -1;
    const int existing = r2d_world_stream_find(cache, id, kind);
    if (existing >= 0) {
        R2DStreamItem *item = &cache->items[existing];
        item->region = region;
        item->bytes = bytes;
        item->priority = priority;
        return existing;
    }
    if (cache->count >= cache->capacity) return -1;
    const int slot = cache->count++;
    cache->items[slot] = (R2DStreamItem){
        .id = id, .kind = kind, .region = region, .priority = priority,
        .bytes = bytes, .state = R2D_STREAM_UNLOADED, .last_used = 0,
        .dirty = false,
    };
    return slot;
}

bool r2d_world_stream_mark(R2DStreamCache *cache, int id, int kind, R2DStreamState state)
{
    if (!cache || !valid_state((int)state)) return false;
    const int slot = r2d_world_stream_find(cache, id, kind);
    if (slot < 0) return false;
    R2DStreamItem *item = &cache->items[slot];
    stream_transition(cache, item, state);
    if (state == R2D_STREAM_RESIDENT) item->dirty = true;
    if (state == R2D_STREAM_UNLOADED) item->dirty = false;
    return true;
}

bool r2d_world_stream_touch(R2DStreamCache *cache, int id, int kind, uint64_t frame)
{
    if (!cache) return false;
    const int slot = r2d_world_stream_find(cache, id, kind);
    if (slot < 0) return false;
    cache->items[slot].last_used = frame;
    return true;
}

R2DStreamState r2d_world_stream_state(const R2DStreamCache *cache, int id, int kind)
{
    const int slot = r2d_world_stream_find(cache, id, kind);
    return slot < 0 ? R2D_STREAM_UNLOADED : cache->items[slot].state;
}

const char *r2d_world_stream_kind_name(int kind)
{
    switch (kind) {
    case R2D_STREAM_BSP: return "bsp";
    case R2D_STREAM_SURFACES: return "surfaces";
    case R2D_STREAM_MATERIAL: return "material";
    case R2D_STREAM_TEXTURE: return "texture";
    case R2D_STREAM_ATLAS: return "atlas";
    case R2D_STREAM_LIGHT: return "light";
    case R2D_STREAM_DECAL: return "decal";
    case R2D_STREAM_NAV: return "nav";
    default: return "unknown";
    }
}

static bool item_wanted(const R2DStreamItem *item, const uint8_t *region_states,
                        int region_count, bool *active)
{
    *active = false;
    if (!region_states || item->region < 0) {
        *active = true;
        return true;
    }
    if (item->region >= region_count) return false;
    const uint8_t state = region_states[item->region];
    if (state == R2D_WORLD_REGION_ACTIVE) {
        *active = true;
        return true;
    }
    return state == R2D_WORLD_REGION_PRELOADING ||
           state == R2D_WORLD_REGION_RESIDENT;
}

static uint64_t resident_bytes_of(const R2DStreamCache *cache)
{
    uint64_t bytes = 0;
    for (int i = 0; i < cache->count; i++) {
        const R2DStreamItem *item = &cache->items[i];
        if (item->state == R2D_STREAM_RESIDENT || item->state == R2D_STREAM_EVICTABLE)
            bytes += item->bytes;
    }
    return bytes;
}

static int resident_count_of(const R2DStreamCache *cache)
{
    int count = 0;
    for (int i = 0; i < cache->count; i++)
        if (cache->items[i].state == R2D_STREAM_RESIDENT ||
            cache->items[i].state == R2D_STREAM_EVICTABLE)
            count++;
    return count;
}

int r2d_world_stream_update(R2DStreamCache *cache, const uint8_t *region_states,
                            int region_count, const R2DStreamBudget *budget,
                            uint64_t frame, R2DStreamStats *stats)
{
    if (!cache || cache->count < 0 || cache->count > cache->capacity ||
        region_count < 0) return -1;
    R2DStreamBudget defaults = {0};
    if (!budget) budget = &defaults;

    R2DStreamStats local = {0};
    int transitions = 0;
    uint64_t upload_bytes = 0;
    int uploads = 0, promote_budget = budget->promote_budget_items;
    if (promote_budget < 0) promote_budget = 0;

    // 1. Demote payloads whose region no longer requests residency. ACTIVE
    //    payloads are never demoted here.
    for (int i = 0; i < cache->count; i++) {
        R2DStreamItem *item = &cache->items[i];
        bool active = false;
        const bool wanted = item_wanted(item, region_states, region_count, &active);
        if ((item->state == R2D_STREAM_RESIDENT || item->state == R2D_STREAM_PRELOAD) &&
            !wanted && !active) {
            stream_transition(cache, item, R2D_STREAM_EVICTABLE);
            local.demoted++;
            transitions++;
        }
    }

    // 2. Promote wanted payloads within the per-frame item budget. Selection is
    //    (priority desc, older last_used, lower slot) so results are stable.
    for (int promoted = 0; promoted < promote_budget; promoted++) {
        int best = -1;
        for (int i = 0; i < cache->count; i++) {
            const R2DStreamItem *item = &cache->items[i];
            bool active = false;
            if (!item_wanted(item, region_states, region_count, &active)) continue;
            if (item->state != R2D_STREAM_UNLOADED &&
                item->state != R2D_STREAM_PRELOAD &&
                item->state != R2D_STREAM_EVICTABLE) continue;
            if (best < 0) { best = i; continue; }
            const R2DStreamItem *other = &cache->items[best];
            if (item->priority > other->priority ||
                (item->priority == other->priority && item->last_used < other->last_used))
                best = i;
        }
        if (best < 0) break;
        R2DStreamItem *item = &cache->items[best];
        stream_transition(cache, item, R2D_STREAM_RESIDENT);
        item->dirty = true;
        item->last_used = frame;
        local.promoted++;
        transitions++;
    }

    // 3. Upload RESIDENT dirty payloads within the byte/item upload budget.
    for (int i = 0; i < cache->count; i++) {
        R2DStreamItem *item = &cache->items[i];
        if (item->state != R2D_STREAM_RESIDENT || !item->dirty) continue;
        // 0 means "no uploads this frame" for both budgets: a streaming frame
        // that runs out of budget must never silently upload everything.
        if (budget->upload_budget_items <= 0 || uploads >= budget->upload_budget_items) {
            local.deferred_uploads++;
            continue;
        }
        if (upload_bytes + item->bytes > budget->upload_budget_bytes) {
            local.deferred_uploads++;
            continue;
        }
        item->dirty = false;
        uploads++;
        upload_bytes += item->bytes;
    }
    local.uploads = uploads;
    local.upload_bytes = upload_bytes;

    // 4. Evict non-active payloads LRU-first until both residency limits hold.
    uint64_t resident_bytes = resident_bytes_of(cache);
    int resident_count = resident_count_of(cache);
    for (;;) {
        const bool over_bytes = budget->resident_budget_bytes > 0 &&
                                resident_bytes > budget->resident_budget_bytes;
        const bool over_items = budget->max_resident_items > 0 &&
                                resident_count > budget->max_resident_items;
        if (!over_bytes && !over_items) break;
        int victim = -1;
        for (int i = 0; i < cache->count; i++) {
            const R2DStreamItem *item = &cache->items[i];
            bool active = false;
            (void)item_wanted(item, region_states, region_count, &active);
            if (active) continue;
            if (item->state != R2D_STREAM_EVICTABLE &&
                item->state != R2D_STREAM_RESIDENT) continue;
            if (victim < 0) { victim = i; continue; }
            const R2DStreamItem *other = &cache->items[victim];
            // Prefer EVICTABLE over RESIDENT, then oldest use, then slot.
            const int item_rank = item->state == R2D_STREAM_EVICTABLE ? 0 : 1;
            const int other_rank = other->state == R2D_STREAM_EVICTABLE ? 0 : 1;
            if (item_rank < other_rank ||
                (item_rank == other_rank && item->last_used < other->last_used))
                victim = i;
        }
        if (victim < 0) break;
        R2DStreamItem *item = &cache->items[victim];
        resident_bytes -= item->bytes;
        resident_count--;
        stream_transition(cache, item, R2D_STREAM_UNLOADED);
        item->dirty = false;
        local.evicted++;
        transitions++;
    }

    // 5. Final counters.
    local.resident_bytes = resident_bytes_of(cache);
    for (int i = 0; i < cache->count; i++) {
        const R2DStreamItem *item = &cache->items[i];
        switch (item->state) {
        case R2D_STREAM_RESIDENT:
            local.resident++;
            if (item->kind == R2D_STREAM_TEXTURE) local.textures_resident++;
            if (item->kind == R2D_STREAM_ATLAS) local.atlases_resident++;
            break;
        case R2D_STREAM_PRELOAD: local.preload++; break;
        case R2D_STREAM_EVICTABLE: local.evictable++; break;
        default: local.unloaded++; break;
        }
    }
    if (stats) *stats = local;
    return transitions;
}
