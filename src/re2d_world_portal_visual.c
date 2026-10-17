#include "re2d_world_portal_visual.h"

#include <math.h>

// Pure constrained portal math: no globals, no allocation, no hidden state.

#define R2D_PORTAL_PI 3.14159265358979323846f
#define R2D_PORTAL_TWO_PI 6.28318530717958647692f
#define R2D_PORTAL_MAX_RECURSION 4
#define R2D_PORTAL_STACK_CAP 8

// Result in [-pi, pi]. -pi is folded to +pi so the mapping is deterministic.
static float normalize_yaw(float yaw)
{
    float a = fmodf(yaw, R2D_PORTAL_TWO_PI);
    if (a > R2D_PORTAL_PI) a -= R2D_PORTAL_TWO_PI;
    else if (a <= -R2D_PORTAL_PI) a += R2D_PORTAL_TWO_PI;
    return a;
}

static bool portal_geometry_valid(const R2DWorldPortalVisual *portal)
{
    if (!portal) return false;
    if (!isfinite(portal->ax) || !isfinite(portal->ay) ||
        !isfinite(portal->bx) || !isfinite(portal->by)) return false;
    const float dx = portal->bx - portal->ax;
    const float dy = portal->by - portal->ay;
    if (!isfinite(dx) || !isfinite(dy)) return false;
    return dx != 0.0f || dy != 0.0f;
}

static int clamp_depth(int depth)
{
    if (depth < 1) return 1;
    if (depth > R2D_PORTAL_MAX_RECURSION) return R2D_PORTAL_MAX_RECURSION;
    return depth;
}

bool r2d_world_portal_reflect(const R2DWorldPortalVisual *portal,
                              float x, float y, float yaw,
                              float *out_x, float *out_y, float *out_yaw)
{
    if (!out_x || !out_y || !out_yaw) return false;
    if (!portal_geometry_valid(portal)) return false;
    if (portal->kind != R2D_PORTAL_VISUAL_MIRROR) return false;
    if (!isfinite(x) || !isfinite(y) || !isfinite(yaw)) return false;

    const float dx = portal->bx - portal->ax;
    const float dy = portal->by - portal->ay;
    const float length = hypotf(dx, dy);
    if (!(length > 0.0f) || !isfinite(length)) return false;

    // Unit normal of the mirror line.
    const float nx = -dy / length;
    const float ny = dx / length;

    // Signed distance from the point to the line, then reflect.
    const float distance = (x - portal->ax) * nx + (y - portal->ay) * ny;
    const float rx = x - 2.0f * distance * nx;
    const float ry = y - 2.0f * distance * ny;
    if (!isfinite(rx) || !isfinite(ry)) return false;

    const float segment_yaw = atan2f(dy, dx);
    const float ryaw = normalize_yaw(2.0f * segment_yaw - yaw);
    if (!isfinite(ryaw)) return false;

    *out_x = rx;
    *out_y = ry;
    *out_yaw = ryaw;
    return true;
}

bool r2d_world_portal_linked_pose(const R2DWorldPortalVisual *from,
                                  const R2DWorldPortalVisual *to,
                                  float x, float y, float yaw,
                                  float *out_x, float *out_y, float *out_yaw)
{
    if (!out_x || !out_y || !out_yaw) return false;
    if (!portal_geometry_valid(from) || !portal_geometry_valid(to)) return false;
    if (from->kind != R2D_PORTAL_VISUAL_LINK ||
        to->kind != R2D_PORTAL_VISUAL_LINK) return false;
    if (!isfinite(x) || !isfinite(y) || !isfinite(yaw)) return false;

    const float from_mx = from->ax + (from->bx - from->ax) * 0.5f;
    const float from_my = from->ay + (from->by - from->ay) * 0.5f;
    const float to_mx = to->ax + (to->bx - to->ax) * 0.5f;
    const float to_my = to->ay + (to->by - to->ay) * 0.5f;
    const float from_angle = atan2f(from->by - from->ay, from->bx - from->ax);
    const float to_angle = atan2f(to->by - to->ay, to->bx - to->ax);
    const float delta = normalize_yaw(to_angle - from_angle);
    const float rotation = to->yaw_only ? 0.0f : delta;

    const float dx = x - from_mx;
    const float dy = y - from_my;
    const float c = cosf(rotation);
    const float s = sinf(rotation);
    const float rx = to_mx + dx * c - dy * s;
    const float ry = to_my + dx * s + dy * c;
    const float ryaw = normalize_yaw(yaw + delta);
    if (!isfinite(rx) || !isfinite(ry) || !isfinite(ryaw)) return false;

    *out_x = rx;
    *out_y = ry;
    *out_yaw = ryaw;
    return true;
}

void r2d_world_portal_sky_yaw(const R2DWorldPortalVisual *portal,
                              float yaw, float *out_yaw)
{
    if (out_yaw) *out_yaw = 0.0f;
    if (!out_yaw || !portal_geometry_valid(portal)) return;
    if (portal->kind != R2D_PORTAL_VISUAL_SKY) return;
    if (!isfinite(yaw)) return;

    const float segment_yaw = atan2f(portal->by - portal->ay,
                                     portal->bx - portal->ax);
    const float mapped = normalize_yaw(yaw + segment_yaw);
    if (isfinite(mapped)) *out_yaw = mapped;
}

bool r2d_world_portal_recursion_push(R2DWorldPortalRecursion *recursion, int portal_id)
{
    if (!recursion || portal_id < 0) return false;

    recursion->max_depth = clamp_depth(recursion->max_depth);
    if (recursion->depth < 0 || recursion->depth >= R2D_PORTAL_STACK_CAP) return false;
    if (recursion->depth >= recursion->max_depth) return false;

    for (int i = 0; i < recursion->depth; i++) {
        if (recursion->stack[i] == portal_id) return false;   // cycle
    }

    recursion->stack[recursion->depth] = portal_id;
    recursion->depth++;
    return true;
}

void r2d_world_portal_recursion_pop(R2DWorldPortalRecursion *recursion)
{
    if (!recursion || recursion->depth <= 0) return;
    recursion->depth--;
    recursion->stack[recursion->depth] = -1;
}

bool r2d_world_portal_recursion_contains(const R2DWorldPortalRecursion *recursion,
                                         int portal_id)
{
    if (!recursion || portal_id < 0) return false;
    int depth = recursion->depth;
    if (depth < 0) return false;
    if (depth > R2D_PORTAL_STACK_CAP) depth = R2D_PORTAL_STACK_CAP;
    for (int i = 0; i < depth; i++) {
        if (recursion->stack[i] == portal_id) return true;
    }
    return false;
}
