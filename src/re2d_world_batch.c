#include "re2d_world_batch.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

_Static_assert(sizeof(R2DWorldBatchInstance) == R2D_WORLD_BATCH_INSTANCE_BYTES,
               "batch instance must stay 32 bytes for std430/SSBO upload");

static int clamp_int(int value, int lo, int hi)
{
    return value < lo ? lo : (value > hi ? hi : value);
}

static uint32_t blend_of(int blend)
{
    return (uint32_t)(blend >= R2D_WORLD_MASKED && blend <= R2D_WORLD_ADDITIVE ? blend : R2D_WORLD_OPAQUE);
}

void r2d_world_batch_item(R2DWorldBatchItem *item, int kind, int surface, int span,
                          int material, int blend, int light_policy, int atlas,
                          uint32_t tint, uint32_t aux)
{
    if (!item) return;
    item->kind = clamp_int(kind, 0, R2D_WORLD_BATCH_KIND_SKY);
    item->surface = surface >= 0 ? surface : -1;
    item->span = span >= 0 ? span : -1;
    item->material = material >= 0 ? material : -1;
    item->blend = clamp_int(blend, R2D_WORLD_OPAQUE, R2D_WORLD_ADDITIVE);
    item->light_policy = clamp_int(light_policy, R2D_WORLD_BATCH_LIGHT_UNLIT,
                                   R2D_WORLD_BATCH_LIGHT_DYNAMIC);
    item->atlas = atlas >= 0 ? atlas : -1;
    item->tint = tint;
    item->aux = aux;
}

static uint32_t mix32(uint32_t h)
{
    h ^= h >> 16;
    h *= 0x7feb352du;
    h ^= h >> 15;
    h *= 0x846ca68bu;
    h ^= h >> 16;
    return h;
}

uint32_t r2d_world_batch_key(int material, int blend, int light_policy, int atlas)
{
    uint32_t h = 0x9e3779b9u;
    h = mix32(h ^ (uint32_t)(material + 1));
    h = mix32(h ^ ((uint32_t)clamp_int(blend, 0, 4) * 0x85ebca6bu + 0x27d4eb2fu));
    h = mix32(h ^ (uint32_t)(light_policy + 1) * 0x165667b1u);
    h = mix32(h ^ (uint32_t)(atlas + 1) * 0xc2b2ae35u);
    return h;
}

static uint32_t instance_blend(const R2DWorldBatchInstance *instance)
{
    return (instance->flags >> 4) & 0xfu;
}

static int compare_instances(const void *lhs, const void *rhs)
{
    const R2DWorldBatchInstance *a = (const R2DWorldBatchInstance *)lhs;
    const R2DWorldBatchInstance *b = (const R2DWorldBatchInstance *)rhs;
#define CMP(field) do { if (a->field < b->field) return -1; if (a->field > b->field) return 1; } while (0)
    CMP(material);
    uint32_t ablend = instance_blend(a), bblend = instance_blend(b);
    if (ablend < bblend) return -1;
    if (ablend > bblend) return 1;
    CMP(light);
    CMP(atlas);
    // aux is the caller's stable submission index: it is the first tie-break so
    // a GPU draw list keeps its original order inside one group.
    CMP(aux);
    CMP(flags);
    CMP(surface);
    CMP(span);
    CMP(tint);
#undef CMP
    return 0;
}

static bool same_group(const R2DWorldBatchInstance *a, const R2DWorldBatchInstance *b)
{
    return a->material == b->material && instance_blend(a) == instance_blend(b) &&
           a->light == b->light && a->atlas == b->atlas;
}

static bool same_item_key(const R2DWorldBatchItem *a, const R2DWorldBatchItem *b)
{
    return a->material == b->material && a->blend == b->blend &&
           a->light_policy == b->light_policy && a->atlas == b->atlas;
}

// Counting mode (no instance storage): the full group count is still required
// for info/benchmarks, so distinct keys are counted without allocation.
static int count_distinct_item_keys(const R2DWorldBatchItem *items, int item_count)
{
    int total = 0;
    for (int i = 0; i < item_count; ++i) {
        bool seen = false;
        for (int j = 0; j < i; ++j) if (same_item_key(&items[i], &items[j])) { seen = true; break; }
        if (!seen) total++;
    }
    return total;
}

static uint32_t surface_tint(const R2DRe2dWorld *world, int surface)
{
    const R2DWorldSurface *desc = r2d_world_surface(world, surface);
    if (!desc) return 0xffffffffu;
    if (desc->kind == R2D_WORLD_WALL) {
        if (desc->primitive >= 0 && desc->primitive < world->wall_count)
            return world->walls[desc->primitive].color;
        return 0xffffffffu;
    }
    if (desc->span >= 0 && desc->span < world->span_count) {
        const R2DWorldSpan *span = &world->spans[desc->span];
        return desc->kind == R2D_WORLD_CEILING ? span->ceiling_color : span->floor_color;
    }
    return 0xffffffffu;
}

static int surface_light_policy(const R2DRe2dWorld *world, int surface, int material)
{
    if (world->surface_sky && surface >= 0 && surface < world->surface_count && world->surface_sky[surface])
        return R2D_WORLD_BATCH_LIGHT_UNLIT;
    if (material >= 0 && material < world->material_count &&
        world->materials[material].emissive_strength > 0.0f)
        return R2D_WORLD_BATCH_LIGHT_UNLIT;
    return world->baked_lighting ? R2D_WORLD_BATCH_LIGHT_STATIC : R2D_WORLD_BATCH_LIGHT_DYNAMIC;
}

static int surface_blend(const R2DRe2dWorld *world, int surface, int material)
{
    if (material >= 0 && material < world->material_count) return world->materials[material].blend;
    return r2d_world_surface_blend(world, surface);
}

int r2d_world_batch_from_visibility(const R2DRe2dWorld *world,
                                    const R2DWorldVisibility *visibility,
                                    R2DWorldBatchItem *items, int capacity,
                                    R2DWorldBatchStats *stats)
{
    if (!world || !visibility || capacity < 0 || (capacity > 0 && !items)) return -1;
    int total = visibility->surface_count;
    int written = total < capacity ? total : capacity;
    if (stats) {
        memset(stats, 0, sizeof *stats);
        stats->surfaces = total;
        stats->overflow = written < total ? 1 : 0;
    }
    for (int i = 0; i < written; ++i) {
        int surface = visibility->surfaces[i];
        int material = world->surface_materials && surface >= 0 && surface < world->surface_count
            ? world->surface_materials[surface] : -1;
        int blend = surface_blend(world, surface, material);
        int light = surface_light_policy(world, surface, material);
        int span = -1;
        const R2DWorldSurface *desc = r2d_world_surface(world, surface);
        if (desc) span = desc->span;
        r2d_world_batch_item(&items[i], R2D_WORLD_BATCH_KIND_SURFACE, surface, span,
                             material, blend, light, -1, surface_tint(world, surface), 0);
    }
    return total;
}

int r2d_world_batch_build(const R2DWorldBatchItem *items, int item_count,
                          const R2DWorldBatchBuffers *buffers,
                          R2DWorldBatchStats *stats)
{
    if (item_count < 0 || (item_count > 0 && !items)) return -1;
    if (!buffers) return -1;
    if (buffers->instance_capacity < 0 || buffers->group_capacity < 0) return -1;
    if (buffers->instance_capacity > 0 && !buffers->instances) return -1;
    if (buffers->group_capacity > 0 && !buffers->groups) return -1;

    int written = item_count < buffers->instance_capacity ? item_count : buffers->instance_capacity;
    for (int i = 0; i < written; ++i) {
        const R2DWorldBatchItem *item = &items[i];
        R2DWorldBatchInstance *out = &buffers->instances[i];
        out->surface = (uint32_t)(item->surface >= 0 ? item->surface : -1);
        out->span = (uint32_t)(item->span >= 0 ? item->span : -1);
        out->material = (uint32_t)(item->material >= 0 ? item->material : -1);
        out->flags = (uint32_t)clamp_int(item->kind, 0, R2D_WORLD_BATCH_KIND_SKY)
            | (blend_of(item->blend) << 4)
            | (item->light_policy == R2D_WORLD_BATCH_LIGHT_UNLIT ? (1u << 9) : 0u);
        out->tint = item->tint;
        out->aux = item->aux;
        out->light = (uint32_t)clamp_int(item->light_policy, 0, R2D_WORLD_BATCH_LIGHT_DYNAMIC);
        out->atlas = (uint32_t)(item->atlas >= 0 ? item->atlas : -1);
    }
    if (written > 1) qsort(buffers->instances, (size_t)written, sizeof *buffers->instances,
                           compare_instances);

    int group_total = 0, group_written = 0;
    bool counting = written < item_count;
    if (written > 0) {
        int start = 0;
        for (int i = 1; i <= written; ++i) {
            if (i < written && same_group(&buffers->instances[start], &buffers->instances[i])) continue;
            int count = i - start;
            if (group_written < buffers->group_capacity) {
                R2DWorldBatchGroup *group = &buffers->groups[group_written++];
                const R2DWorldBatchInstance *first = &buffers->instances[start];
                group->material = first->material;
                group->blend = instance_blend(first);
                group->light_policy = first->light;
                group->atlas = first->atlas;
                group->first = (uint32_t)start;
                group->count = (uint32_t)count;
            }
            group_total++;
            start = i;
        }
    }
    if (counting) group_total = count_distinct_item_keys(items, item_count);

    if (stats) {
        memset(stats, 0, sizeof *stats);
        stats->instances = item_count;
        stats->groups = group_total;
        stats->saved_binds = item_count > group_total ? item_count - group_total : 0;
        stats->overflow = (written < item_count || group_total > group_written) ? 1 : 0;
        for (int i = 0; i < item_count; ++i) {
            if (items[i].kind == R2D_WORLD_BATCH_KIND_ACTOR) stats->actors++;
            else if (items[i].kind == R2D_WORLD_BATCH_KIND_SKY) stats->skies++;
            else stats->surfaces++;
        }
    }
    return item_count;
}

int r2d_world_batch_visibility(const R2DRe2dWorld *world,
                               const R2DWorldVisibility *visibility,
                               R2DWorldBatchScratch *scratch,
                               const R2DWorldBatchBuffers *buffers,
                               R2DWorldBatchStats *stats)
{
    if (!scratch || scratch->item_capacity < 0 ||
        (scratch->item_capacity > 0 && !scratch->items)) return -1;
    R2DWorldBatchStats surface_stats;
    int total = r2d_world_batch_from_visibility(world, visibility, scratch->items,
                                                scratch->item_capacity,
                                                stats ? &surface_stats : NULL);
    if (total < 0) return -1;
    scratch->item_count = total < scratch->item_capacity ? total : scratch->item_capacity;
    int built = r2d_world_batch_build(scratch->items, scratch->item_count, buffers,
                                      stats ? stats : NULL);
    if (built < 0) return -1;
    if (stats) {
        stats->instances = total;          // truncation reports the required count
        stats->saved_binds = total > stats->groups ? total - stats->groups : 0;
        if (surface_stats.overflow) stats->overflow = 1;
    }
    return total;
}
