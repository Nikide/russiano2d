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

bool r2d_world_stream_pin_set_limit(R2DStreamPinSet *set, int limit)
{
    if (!set || limit < 0 || limit > R2D_WORLD_STREAM_PIN_PATH_MAX_LIMIT) return false;
    if (limit > 0 && set->count > limit) return false;  // never silently drop pins
    set->limit = limit;
    set->configured = true;
    return true;
}

bool r2d_world_stream_pin_path(R2DStreamPinSet *set, const char *path, bool pinned)
{
    if (!set) return false;
    if (!path || !path[0]) return false;
    const size_t length = strlen(path);
    if (length >= R2D_WORLD_STREAM_PIN_PATH_MAX) return false;
    int existing = -1;
    for (int i = 0; i < set->count; i++)
        if (set->paths[i] && strcmp(set->paths[i], path) == 0) { existing = i; break; }
    if (!pinned) {
        if (existing < 0) return true;  // removing an absent path is a no-op
        free(set->paths[existing]);
        if (existing < set->count - 1)
            memmove(set->paths + existing, set->paths + existing + 1,
                    (size_t)(set->count - existing - 1) * sizeof *set->paths);
        set->count--;
        set->paths[set->count] = NULL;
        return true;
    }
    if (existing >= 0) return true;  // idempotent
    const int effective_limit = set->configured ? set->limit
                                                : R2D_WORLD_STREAM_PIN_PATH_DEFAULT;
    if (effective_limit > 0 && set->count >= effective_limit) return false;
    if (set->count >= R2D_WORLD_STREAM_PIN_PATH_MAX_LIMIT) return false;
    if (set->count >= set->capacity) {
        int capacity = set->capacity ? set->capacity * 2 : 8;
        if (effective_limit > 0 && capacity > effective_limit) capacity = effective_limit;
        if (capacity > R2D_WORLD_STREAM_PIN_PATH_MAX_LIMIT)
            capacity = R2D_WORLD_STREAM_PIN_PATH_MAX_LIMIT;
        if (capacity <= set->count) capacity = set->count + 1;
        char **paths = (char **)realloc(set->paths,
                                        (size_t)capacity * sizeof *paths);
        if (!paths) return false;
        set->paths = paths;
        set->capacity = capacity;
    }
    char *copy = (char *)malloc(length + 1);
    if (!copy) return false;
    memcpy(copy, path, length + 1);
    set->paths[set->count++] = copy;
    return true;
}

bool r2d_world_stream_path_pinned(const R2DStreamPinSet *set, const char *path)
{
    if (!set || !path || !path[0]) return false;
    for (int i = 0; i < set->count; i++)
        if (set->paths[i] && strcmp(set->paths[i], path) == 0) return true;
    return false;
}

int r2d_world_stream_pin_path_count(const R2DStreamPinSet *set)
{
    return set ? set->count : 0;
}

void r2d_world_stream_pin_set_free(R2DStreamPinSet *set)
{
    if (!set) return;
    for (int i = 0; i < set->count; i++) free(set->paths[i]);
    free(set->paths);
    memset(set, 0, sizeof *set);
}

bool r2d_world_stream_pin(R2DStreamCache *cache, int id, int kind, bool pinned)
{
    if (!cache || !valid_kind(kind)) return false;
    const int slot = r2d_world_stream_find(cache, id, kind);
    if (slot < 0) return false;
    cache->items[slot].pinned = pinned;
    return true;
}

bool r2d_world_stream_demand(R2DStreamCache *cache, int id, int kind, bool demand)
{
    if (!cache || !valid_kind(kind)) return false;
    const int slot = r2d_world_stream_find(cache, id, kind);
    if (slot < 0) return false;
    cache->items[slot].demand = demand;
    return true;
}

bool r2d_world_stream_refs(R2DStreamCache *cache, int id, int kind,
                           int refs, int visible_refs)
{
    if (!cache || !valid_kind(kind) || refs < 0 || visible_refs < 0) return false;
    const int slot = r2d_world_stream_find(cache, id, kind);
    if (slot < 0) return false;
    R2DStreamItem *item = &cache->items[slot];
    item->refs = refs;
    item->visible_refs = visible_refs > refs ? refs : visible_refs;
    return true;
}

bool r2d_world_stream_unregister(R2DStreamCache *cache, int id, int kind)
{
    if (!cache || !valid_kind(kind)) return false;
    const int slot = r2d_world_stream_find(cache, id, kind);
    if (slot < 0) return false;
    if (slot < cache->count - 1)
        memmove(cache->items + slot, cache->items + slot + 1,
                (size_t)(cache->count - slot - 1) * sizeof *cache->items);
    cache->count--;
    memset(cache->items + cache->count, 0, sizeof *cache->items);
    return true;
}

bool r2d_world_stream_set_bytes(R2DStreamCache *cache, int id, int kind, uint64_t bytes)
{
    if (!cache || !valid_kind(kind)) return false;
    const int slot = r2d_world_stream_find(cache, id, kind);
    if (slot < 0) return false;
    cache->items[slot].bytes = bytes;
    return true;
}

const char *r2d_world_stream_evict_reason_name(int reason)
{
    switch (reason) {
    case R2D_STREAM_EVICT_LRU: return "lru";
    case R2D_STREAM_EVICT_BUDGET_BYTES: return "budgetBytes";
    case R2D_STREAM_EVICT_BUDGET_ITEMS: return "budgetItems";
    case R2D_STREAM_EVICT_REMOVED: return "removed";
    default: return "none";
    }
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
    //    payloads and protected (pinned/visible-demand) items are never demoted:
    //    a visible atlas must stay RESIDENT even when its region left the ring.
    for (int i = 0; i < cache->count; i++) {
        R2DStreamItem *item = &cache->items[i];
        bool active = false;
        const bool wanted = item_wanted(item, region_states, region_count, &active);
        const bool protected = item->pinned || item->demand;
        if ((item->state == R2D_STREAM_RESIDENT || item->state == R2D_STREAM_PRELOAD) &&
            !wanted && !active && !protected) {
            stream_transition(cache, item, R2D_STREAM_EVICTABLE);
            local.demoted++;
            transitions++;
        }
    }

    // 2a. Promote all protected wanted-or-visible payloads without the ordinary
    //     item budget. Pinned/visible demand outranks preload/distant content and
    //     must not wait behind it: this is what keeps a visible atlas resident.
    for (int i = 0; i < cache->count; i++) {
        R2DStreamItem *item = &cache->items[i];
        if (!(item->pinned || item->demand)) continue;
        if (item->state != R2D_STREAM_UNLOADED &&
            item->state != R2D_STREAM_PRELOAD &&
            item->state != R2D_STREAM_EVICTABLE) continue;
        stream_transition(cache, item, R2D_STREAM_RESIDENT);
        item->dirty = true;
        item->last_used = frame;
        local.promoted++;
        transitions++;
    }

    // 2b. Promote remaining wanted payloads within the per-frame item budget.
    //     Selection is (priority desc, older last_used, lower slot) so results
    //     are stable; protected items were promoted above. When the protected
    //     soft-cap set already exceeds a budget, ordinary promotions are skipped
    //     (they would be evicted in the same update) to avoid per-frame churn.
    int deferred = 0;
    const uint64_t resident_before = resident_bytes_of(cache);
    const int resident_count_before = resident_count_of(cache);
    const bool over_before = (budget->resident_budget_bytes > 0 &&
                              resident_before > budget->resident_budget_bytes) ||
                             (budget->max_resident_items > 0 &&
                              resident_count_before > budget->max_resident_items);
    for (int promoted = 0; !over_before && promoted < promote_budget; promoted++) {
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
    for (int i = 0; i < cache->count; i++) {
        const R2DStreamItem *item = &cache->items[i];
        bool active = false;
        if (!item_wanted(item, region_states, region_count, &active)) continue;
        if (item->state == R2D_STREAM_UNLOADED || item->state == R2D_STREAM_PRELOAD)
            deferred++;
    }
    local.promote_deferred = deferred;

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

    // 4. Evict non-active, non-protected payloads LRU-first until both residency
    //    limits hold. Pinned/visible-demand items are the soft cap: when the
    //    protected set alone exceeds a budget they stay resident and the overage
    //    is reported (never evict a visible atlas to satisfy the cap).
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
            if (active || item->pinned || item->demand) continue;
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
        // No unprotected victim: only the protected soft-cap set remains.
        if (victim < 0) break;
        R2DStreamItem *item = &cache->items[victim];
        resident_bytes -= item->bytes;
        resident_count--;
        stream_transition(cache, item, R2D_STREAM_UNLOADED);
        item->dirty = false;
        item->last_evict_frame = frame;
        item->evict_reason = over_bytes ? R2D_STREAM_EVICT_BUDGET_BYTES
                                        : R2D_STREAM_EVICT_BUDGET_ITEMS;
        if (over_bytes) local.evict_budget_bytes++;
        else local.evict_budget_items++;
        local.evicted++;
        transitions++;
    }
    local.over_budget_bytes = budget->resident_budget_bytes > 0 &&
                              resident_bytes > budget->resident_budget_bytes;
    local.over_budget_items = budget->max_resident_items > 0 &&
                              resident_count > budget->max_resident_items;

    // 5. Final counters.
    local.resident_bytes = resident_bytes_of(cache);
    for (int i = 0; i < cache->count; i++) {
        const R2DStreamItem *item = &cache->items[i];
        const bool resident = item->state == R2D_STREAM_RESIDENT ||
                              item->state == R2D_STREAM_EVICTABLE;
        if ((item->pinned || item->demand) && resident) {
            local.pinned_resident++;
            local.pinned_bytes += item->bytes;
        }
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
