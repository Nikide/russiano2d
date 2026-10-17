#include "re2d_world_atlas.h"
#include <math.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

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
