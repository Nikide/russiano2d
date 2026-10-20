#include "re2d_world_atlas.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

static float clampf(float v, float lo, float hi)
{
    if (!isfinite(v)) return lo;
    return v < lo ? lo : (v > hi ? hi : v);
}

static int clampi(int v, int lo, int hi)
{
    return v < lo ? lo : (v > hi ? hi : v);
}

float r2d_world_atlas_relative_yaw(float facing, float camera_to_actor_x, float camera_to_actor_y)
{
    if (!isfinite(facing) || !isfinite(camera_to_actor_x) || !isfinite(camera_to_actor_y)) return 0;
    // actor->camera vector; degenerate input means "facing the camera".
    const float ax = -camera_to_actor_x, ay = -camera_to_actor_y;
    if (fabsf(ax) < 1e-6f && fabsf(ay) < 1e-6f) return 0;
    const float fx = cosf(facing), fy = sinf(facing);
    const float cross = ax * fy - ay * fx;
    const float dot = ax * fx + ay * fy;
    if (fabsf(cross) < 1e-6f && fabsf(dot) < 1e-6f) return 0;
    return atan2f(cross, dot);
}

int r2d_world_atlas_direction(float relative_yaw, int directions, bool mirror, bool *flip)
{
    if (flip) *flip = false;
    if (directions <= R2D_WORLD_ATLAS_DIRECTIONS_MIN) return 0;
    if (directions > R2D_WORLD_ATLAS_DIRECTIONS_MAX) directions = R2D_WORLD_ATLAS_DIRECTIONS_MAX;
    if (!isfinite(relative_yaw)) return 0;
    float angle = relative_yaw;
    while (angle > 3.14159265358979323846f) angle -= 6.28318530717958647692f;
    while (angle < -3.14159265358979323846f) angle += 6.28318530717958647692f;
    if (mirror) {
        const float sector = (directions > 1) ? 3.14159265358979323846f / (float)(directions - 1) : 3.14159265358979323846f;
        const float magnitude = fabsf(angle);
        int index = (int)floorf(magnitude / sector + 0.5f);
        index = clampi(index, 0, directions - 1);
        if (flip) *flip = angle < 0;
        return index;
    }
    const float sector = 6.28318530717958647692f / (float)directions;
    int index = (int)floorf((angle + sector * 0.5f) / sector);
    index %= directions;
    if (index < 0) index += directions;
    return index;
}

int r2d_world_atlas_column(bool explicit, int column, int columns,
                           float relative_yaw, int directions, bool mirror,
                           bool *flip)
{
    if (flip) *flip = false;
    if (!explicit) return r2d_world_atlas_direction(relative_yaw, directions, mirror, flip);
    if (columns < 1) columns = 1;
    return clampi(column, 0, columns - 1);
}

void r2d_world_atlas_cell(int column, int row, int columns, int rows,
                          int cell_w, int cell_h,
                          int *x, int *y, int *w, int *h)
{
    if (columns < 1) columns = 1;
    if (rows < 1) rows = 1;
    if (cell_w < R2D_WORLD_ATLAS_CELL_MIN) cell_w = R2D_WORLD_ATLAS_CELL_MIN;
    if (cell_h < R2D_WORLD_ATLAS_CELL_MIN) cell_h = R2D_WORLD_ATLAS_CELL_MIN;
    column = clampi(column, 0, columns - 1);
    row = clampi(row, 0, rows - 1);
    if (x) *x = column * cell_w;
    if (y) *y = row * cell_h;
    if (w) *w = cell_w;
    if (h) *h = cell_h;
}

void r2d_world_atlas_pivot(int pivot, float custom_x, float custom_y,
                           float *out_x, float *out_y)
{
    float px = 0.5f, py = 1.0f;
    switch (pivot) {
    case R2D_WORLD_ATLAS_PIVOT_CENTER: px = 0.5f; py = 0.5f; break;
    case R2D_WORLD_ATLAS_PIVOT_FEET:
    case R2D_WORLD_ATLAS_PIVOT_BOTTOM_CENTER: px = 0.5f; py = 1.0f; break;
    case R2D_WORLD_ATLAS_PIVOT_CUSTOM: px = clampf(custom_x, 0, 1); py = clampf(custom_y, 0, 1); break;
    default: px = 0.5f; py = 1.0f; break;
    }
    if (out_x) *out_x = px;
    if (out_y) *out_y = py;
}

bool r2d_world_atlas_placement(int cell_w, int cell_h, float pivot_x, float pivot_y,
                               int *side, int *dest_x, int *dest_y,
                               float *pivot_sx, float *pivot_sy)
{
    if (cell_w < R2D_WORLD_ATLAS_CELL_MIN || cell_h < R2D_WORLD_ATLAS_CELL_MIN) return false;
    if (cell_w > R2D_WORLD_ATLAS_CELL_MAX || cell_h > R2D_WORLD_ATLAS_CELL_MAX) return false;
    if (!isfinite(pivot_x) || !isfinite(pivot_y)) return false;
    const int s = cell_w > cell_h ? cell_w : cell_h;
    const float px = clampf(pivot_x, 0, 1) * (float)cell_w;
    const float py = clampf(pivot_y, 0, 1) * (float)cell_h;
    int dx = (int)floorf((float)s * 0.5f - px + 0.5f);
    int dy = (int)floorf((float)s - py + 0.5f);
    dx = clampi(dx, 0, s - cell_w);
    dy = clampi(dy, 0, s - cell_h);
    if (side) *side = s;
    if (dest_x) *dest_x = dx;
    if (dest_y) *dest_y = dy;
    if (pivot_sx) *pivot_sx = (float)dx + px;
    if (pivot_sy) *pivot_sy = (float)dy + py;
    return true;
}

bool r2d_world_atlas_crop(const uint8_t *atlas, int atlas_w, int atlas_h,
                          int cell_x, int cell_y, int cell_w, int cell_h, bool flip,
                          int side, int dest_x, int dest_y, uint8_t *buffer)
{
    if (!atlas || !buffer) return false;
    if (atlas_w < 1 || atlas_h < 1 || cell_w < 1 || cell_h < 1) return false;
    if (cell_x < 0 || cell_y < 0 || cell_x + cell_w > atlas_w || cell_y + cell_h > atlas_h) return false;
    if (side < 1 || side > R2D_WORLD_ATLAS_CELL_MAX || dest_x < 0 || dest_y < 0) return false;
    const int left = dest_x < 0 ? 0 : dest_x;
    const int top = dest_y < 0 ? 0 : dest_y;
    const int right = dest_x + cell_w > side ? side : dest_x + cell_w;
    const int bottom = dest_y + cell_h > side ? side : dest_y + cell_h;
    memset(buffer, 0, (size_t)side * (size_t)side * 4u);
    for (int y = top; y < bottom; y++) {
        const int cy = y - dest_y;
        if (cy < 0 || cy >= cell_h) continue;
        const uint8_t *src = atlas + ((size_t)(cell_y + cy) * (size_t)atlas_w + (size_t)cell_x) * 4u;
        uint8_t *dst = buffer + ((size_t)y * (size_t)side + (size_t)left) * 4u;
        const int count = right - left;
        if (flip) {
            for (int x = 0; x < count; x++) {
                const uint8_t *p = src + (size_t)(cell_w - 1 - (left - dest_x + x)) * 4u;
                dst[x * 4 + 0] = p[0];
                dst[x * 4 + 1] = p[1];
                dst[x * 4 + 2] = p[2];
                dst[x * 4 + 3] = p[3];
            }
        } else {
            memcpy(dst, src + (size_t)(left - dest_x) * 4u, (size_t)count * 4u);
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Shared decoded-image cache
// ---------------------------------------------------------------------------
R2DWorldAtlasImage *r2d_world_atlas_image_find(const R2DWorldAtlasImageCache *cache,
                                               const char *canonical, uint64_t generation)
{
    if (!cache || !canonical || !canonical[0]) return NULL;
    for (int i = 0; i < cache->count; i++) {
        R2DWorldAtlasImage *image = cache->items[i];
        if (!image || image->generation != generation || !image->canonical) continue;
        if (strcmp(image->canonical, canonical) == 0) return image;
    }
    return NULL;
}

R2DWorldAtlasImage *r2d_world_atlas_image_add(R2DWorldAtlasImageCache *cache,
                                              const char *canonical, const char *authored,
                                              uint8_t *pixels, int width, int height,
                                              uint64_t generation)
{
    if (!cache || !canonical || !canonical[0] || !pixels || width < 1 || height < 1)
        return NULL;
    if (cache->count >= cache->capacity) {
        const int capacity = cache->capacity ? cache->capacity * 2 : 8;
        R2DWorldAtlasImage **items =
            (R2DWorldAtlasImage **)realloc(cache->items,
                                           (size_t)capacity * sizeof *items);
        if (!items) return NULL;
        cache->items = items;
        cache->capacity = capacity;
    }
    R2DWorldAtlasImage *image = (R2DWorldAtlasImage *)calloc(1, sizeof *image);
    if (!image) return NULL;
    image->canonical = (char *)malloc(strlen(canonical) + 1);
    if (!image->canonical) { free(image); return NULL; }
    strcpy(image->canonical, canonical);
    if (authored && authored[0]) {
        image->authored = (char *)malloc(strlen(authored) + 1);
        if (!image->authored) { free(image->canonical); free(image); return NULL; }
        strcpy(image->authored, authored);
    }
    image->pixels = pixels;
    image->width = width;
    image->height = height;
    image->refs = 1;
    image->generation = generation;
    cache->items[cache->count++] = image;
    return image;
}

void r2d_world_atlas_image_release(R2DWorldAtlasImageCache *cache,
                                   R2DWorldAtlasImage *image)
{
    if (!cache || !image) return;
    int found = -1;
    for (int i = 0; i < cache->count; i++)
        if (cache->items[i] == image) { found = i; break; }
    if (found < 0) return;
    if (--image->refs > 0) return;
    free(image->pixels);
    free(image->canonical);
    free(image->authored);
    for (int i = found; i < cache->count - 1; i++)
        cache->items[i] = cache->items[i + 1];
    cache->count--;
    free(image);
}

void r2d_world_atlas_image_cache_free(R2DWorldAtlasImageCache *cache)
{
    if (!cache) return;
    for (int i = 0; i < cache->count; i++) {
        free(cache->items[i]->pixels);
        free(cache->items[i]->canonical);
        free(cache->items[i]->authored);
        free(cache->items[i]);
    }
    free(cache->items);
    memset(cache, 0, sizeof *cache);
}

uint64_t r2d_world_atlas_image_cache_bytes(const R2DWorldAtlasImageCache *cache)
{
    uint64_t bytes = 0;
    if (!cache) return 0;
    for (int i = 0; i < cache->count; i++) {
        const R2DWorldAtlasImage *image = cache->items[i];
        bytes += (uint64_t)image->width * (uint64_t)image->height * 4u;
    }
    return bytes;
}

uint64_t r2d_world_atlas_image_cache_saved(const R2DWorldAtlasImageCache *cache)
{
    uint64_t bytes = 0;
    if (!cache) return 0;
    for (int i = 0; i < cache->count; i++) {
        const R2DWorldAtlasImage *image = cache->items[i];
        if (image->refs > 1)
            bytes += (uint64_t)image->width * (uint64_t)image->height * 4u *
                     (uint64_t)(image->refs - 1);
    }
    return bytes;
}

bool r2d_world_atlas_crop_tiled(const R2DWorldAtlasTile *tiles, int tile_count,
                                int tile_columns, int tile_rows,
                                int tile_width, int tile_height,
                                int logical_w, int logical_h,
                                int cell_x, int cell_y, int cell_w, int cell_h,
                                bool flip, int side, int dest_x, int dest_y,
                                uint8_t *buffer)
{
    if (!tiles || !buffer || tile_count < 1) return false;
    if (tile_columns < 1 || tile_rows < 1 || tile_width < 1 || tile_height < 1) return false;
    if (tile_columns * tile_rows != tile_count) return false;
    if (logical_w != tile_columns * tile_width || logical_h != tile_rows * tile_height)
        return false;
    if (cell_w < 1 || cell_h < 1 || cell_x < 0 || cell_y < 0) return false;
    if (cell_x + cell_w > logical_w || cell_y + cell_h > logical_h) return false;
    if (side < 1 || side > R2D_WORLD_ATLAS_CELL_MAX || dest_x < 0 || dest_y < 0)
        return false;
    for (int i = 0; i < tile_count; i++)
        if (!tiles[i].pixels || tiles[i].width != tile_width || tiles[i].height != tile_height)
            return false;
    const int left = dest_x;
    const int top = dest_y;
    const int right = dest_x + cell_w > side ? side : dest_x + cell_w;
    const int bottom = dest_y + cell_h > side ? side : dest_y + cell_h;
    memset(buffer, 0, (size_t)side * (size_t)side * 4u);
    for (int y = top; y < bottom; y++) {
        const int cy = y - dest_y;
        if (cy < 0 || cy >= cell_h) continue;
        const int logical_y = cell_y + cy;
        const int tile_row = logical_y / tile_height;
        const int tile_y = logical_y % tile_height;
        uint8_t *dst = buffer + ((size_t)y * (size_t)side + (size_t)left) * 4u;
        for (int x = 0; x < right - left; x++) {
            const int cx = flip ? (cell_w - 1 - (left - dest_x + x))
                                : (left - dest_x + x);
            if (cx < 0 || cx >= cell_w) continue;
            const int logical_x = cell_x + cx;
            const int tile_column = logical_x / tile_width;
            const int tile_x = logical_x % tile_width;
            const int tile_index = tile_row * tile_columns + tile_column;
            const R2DWorldAtlasTile *tile = &tiles[tile_index];
            const uint8_t *src = tile->pixels + ((size_t)tile_y * (size_t)tile_width +
                                                 (size_t)tile_x) * 4u;
            dst[x * 4 + 0] = src[0];
            dst[x * 4 + 1] = src[1];
            dst[x * 4 + 2] = src[2];
            dst[x * 4 + 3] = src[3];
        }
    }
    return true;
}
