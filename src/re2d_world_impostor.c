#include "re2d_world_impostor.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static bool fail(char *error, size_t size, const char *message)
{
    if (error && size) snprintf(error, size, "%s", message);
    return false;
}

int r2d_world_impostors_build(const R2DWorldRegionSet *regions,
                              const R2DWorldCell *cells, int cell_count,
                              const R2DWorldSpan *spans, int span_count,
                              R2DWorldImpostorSet *out, char *error, size_t error_size)
{
    if (error && error_size) error[0] = 0;
    if (!out) return -1;
    if (!regions || !regions->regions || regions->region_count <= 0)
        return fail(error, error_size, "impostors: missing region set") ? -1 : -1;
    if (!cells || cell_count <= 0 || !spans || span_count <= 0)
        return fail(error, error_size, "impostors: missing world geometry") ? -1 : -1;
    const int count = regions->region_count;
    out->count = count;
    if (!out->items || out->capacity < count) return count;

    for (int r = 0; r < count; r++) {
        R2DWorldImpostor *card = &out->items[r];
        memset(card, 0, sizeof *card);
        card->region = r;
        const R2DWorldRegion *region = &regions->regions[r];
        float minx = INFINITY, miny = INFINITY;
        float maxx = -INFINITY, maxy = -INFINITY;
        float bottom = INFINITY, top = -INFINITY;
        double red = 0, green = 0, blue = 0;
        int colour_samples = 0, span_total = 0;
        for (int k = 0; k < region->cell_count; k++) {
            const int cell_index = regions->region_cells[region->first_cell + k];
            if (cell_index < 0 || cell_index >= cell_count) continue;
            const R2DWorldCell *cell = &cells[cell_index];
            minx = fminf(minx, cell->x);
            miny = fminf(miny, cell->y);
            maxx = fmaxf(maxx, cell->x + cell->w);
            maxy = fmaxf(maxy, cell->y + cell->h);
            card->cells++;
            for (int j = 0; j < cell->span_count; j++) {
                const int span_index = cell->first_span + j;
                if (span_index < 0 || span_index >= span_count) continue;
                const R2DWorldSpan *span = &spans[span_index];
                const float cx = span->x + span->w * 0.5f;
                const float cy = span->y + span->h * 0.5f;
                const float floor_height = r2d_world_floor_height(span, cx, cy);
                const float ceiling_height = r2d_world_ceiling_height(span, cx, cy);
                if (!isfinite(floor_height) || !isfinite(ceiling_height)) continue;
                bottom = fminf(bottom, floor_height);
                top = fmaxf(top, ceiling_height);
                red += (double)(span->floor_color & 255u);
                green += (double)((span->floor_color >> 8) & 255u);
                blue += (double)((span->floor_color >> 16) & 255u);
                colour_samples++;
                span_total++;
            }
        }
        if (card->cells <= 0 || span_total <= 0 ||
            !(maxx > minx) || !(maxy > miny) || !(top > bottom))
            continue;
        card->valid = true;
        card->spans = span_total;
        card->cx = (minx + maxx) * 0.5f;
        card->cy = (miny + maxy) * 0.5f;
        card->width = maxx - minx;
        card->height = maxy - miny;
        card->bottom = bottom;
        card->top = top;
        if (colour_samples > 0) {
            const unsigned rr = (unsigned)lrint(red / colour_samples);
            const unsigned gg = (unsigned)lrint(green / colour_samples);
            const unsigned bb = (unsigned)lrint(blue / colour_samples);
            card->color = (rr > 255 ? 255 : rr) | ((gg > 255 ? 255 : gg) << 8) |
                          ((bb > 255 ? 255 : bb) << 16);
        } else {
            card->color = 0x808080u;
        }
        if (!r2d_world_region_local(regions, r, card->cx, card->cy,
                                    &card->local_x, &card->local_y))
            card->valid = false;
    }
    return count;
}

void r2d_world_impostors_free(R2DWorldImpostorSet *set)
{
    if (!set) return;
    free(set->items);
    memset(set, 0, sizeof *set);
}

int r2d_world_impostors_collect(const R2DWorldImpostorSet *set,
                                const R2DWorldRegionSet *regions, int from_region,
                                const R2DWorldOccluder *occluders, int occluder_count,
                                float camera_x, float camera_y,
                                float min_distance, float max_distance,
                                R2DWorldImpostor *out, int capacity)
{
    if (!set || !set->items || !regions || from_region < 0 ||
        from_region >= regions->region_count || capacity < 0 ||
        (capacity > 0 && !out) || !isfinite(camera_x) || !isfinite(camera_y) ||
        !isfinite(min_distance) || !isfinite(max_distance) ||
        max_distance < min_distance)
        return -1;
    int total = 0, written = 0;
    for (int r = 0; r < set->count; r++) {
        const R2DWorldImpostor *card = &set->items[r];
        if (!card->valid || card->region < 0 || card->region >= regions->region_count)
            continue;
        if (card->region == from_region) continue; // current region uses local BSP
        if (!r2d_world_region_visible(regions, from_region, card->region)) continue;
        if (r2d_world_region_occluded(regions, card->region, occluders,
                                      occluder_count, camera_x, camera_y))
            continue;
        const float dx = card->cx - camera_x, dy = card->cy - camera_y;
        const float distance = sqrtf(dx * dx + dy * dy);
        if (!isfinite(distance) || distance < min_distance || distance > max_distance)
            continue;
        total++;
        if (written >= capacity) continue;
        R2DWorldImpostor copy = *card;
        copy.distance = distance;
        // Nearest-first insertion; deterministic for equal distances.
        int at = written;
        while (at > 0 && out[at - 1].distance > copy.distance) {
            out[at] = out[at - 1];
            at--;
        }
        out[at] = copy;
        written++;
    }
    return total;
}
