#include "re2d_world_hint.h"

#include <math.h>
#include <stdio.h>

#define HINT_EPS 1e-3f

static bool finite_wall(const R2DWorldWall *wall)
{
    return isfinite(wall->x1) && isfinite(wall->y1) &&
           isfinite(wall->x2) && isfinite(wall->y2) &&
           isfinite(wall->bottom) && isfinite(wall->top);
}

static bool wall_has_hint(const R2DWorldWall *wall)
{
    return wall->flags && (wall->flags & R2D_WALL_TOOL_HINT) != 0;
}

static bool wall_has_skip(const R2DWorldWall *wall)
{
    return wall->flags && (wall->flags & R2D_WALL_TOOL_SKIP) != 0;
}

static bool wall_has_occluder(const R2DWorldWall *wall)
{
    return wall->flags && (wall->flags & R2D_WALL_OCCLUDER) != 0;
}

static bool wall_segment_valid(const R2DWorldWall *wall)
{
    if (!finite_wall(wall)) return false;
    const float dx = wall->x2 - wall->x1, dy = wall->y2 - wall->y1;
    return dx * dx + dy * dy > HINT_EPS * HINT_EPS;
}

void r2d_world_hint_counts(const R2DRe2dWorld *world, int *hint_markers,
                           int *skip_markers, int *occluder_segments)
{
    int hints = 0, skips = 0, occluders = 0;
    if (world && world->walls) {
        for (int i = 0; i < world->wall_count; i++) {
            const R2DWorldWall *wall = &world->walls[i];
            if (wall_has_hint(wall) && wall_segment_valid(wall)) hints++;
            if (wall_has_skip(wall)) skips++;
            if (wall_has_occluder(wall) && wall_segment_valid(wall)) occluders++;
        }
    }
    if (hint_markers) *hint_markers = hints;
    if (skip_markers) *skip_markers = skips;
    if (occluder_segments) *occluder_segments = occluders;
}

static bool fail(char *error, size_t size, const char *message)
{
    if (error && size) snprintf(error, size, "%s", message);
    return false;
}

bool r2d_world_hint_cache_build(const R2DRe2dWorld *world, R2DWorldHintCache *cache,
                                char *error, size_t error_size)
{
    if (error && error_size) error[0] = 0;
    if (!world || !cache)
        return fail(error, error_size, "hint cache: missing world/cache");
    if (cache->barrier_capacity < 0 || cache->occluder_capacity < 0 ||
        (cache->barrier_capacity > 0 && !cache->barriers) ||
        (cache->occluder_capacity > 0 && !cache->occluders))
        return fail(error, error_size, "hint cache: invalid output buffers");

    int hints = 0, skips = 0, occluders = 0;
    r2d_world_hint_counts(world, &hints, &skips, &occluders);
    if (cache->barrier_capacity < hints || cache->occluder_capacity < occluders) {
        // Never leave a stale usable cache after a failed rebuild.
        cache->barrier_count = 0;
        cache->occluder_count = 0;
        cache->hint_markers = hints;
        cache->skip_markers = skips;
        cache->world = NULL;
        cache->topology_revision = 0;
        return fail(error, error_size, "hint cache: insufficient capacity");
    }

    cache->barrier_count = 0;
    cache->occluder_count = 0;
    cache->hint_markers = hints;
    cache->skip_markers = skips;
    cache->topology_revision = world->topology_revision;
    cache->world = world;

    for (int i = 0; i < world->wall_count; i++) {
        const R2DWorldWall *wall = &world->walls[i];
        if (wall_has_hint(wall) && wall_segment_valid(wall)) {
            R2DWorldHintBarrier *barrier = &cache->barriers[cache->barrier_count++];
            barrier->x1 = wall->x1; barrier->y1 = wall->y1;
            barrier->x2 = wall->x2; barrier->y2 = wall->y2;
            barrier->bottom = wall->bottom; barrier->top = wall->top;
            barrier->wall = i;
        }
        if (wall_has_occluder(wall) && wall_segment_valid(wall)) {
            R2DWorldOccluder *segment = &cache->occluders[cache->occluder_count++];
            segment->x1 = wall->x1; segment->y1 = wall->y1;
            segment->x2 = wall->x2; segment->y2 = wall->y2;
        }
    }
    return true;
}

static bool barrier_matches_portal(const R2DWorldHintBarrier *barrier,
                                   const R2DWorldPortal *portal)
{
    const bool portal_vertical = fabsf(portal->ax - portal->bx) <= HINT_EPS;
    const bool wall_vertical = fabsf(barrier->x1 - barrier->x2) <= HINT_EPS;
    if (portal_vertical != wall_vertical) return false;
    if (portal_vertical) {
        if (fabsf(barrier->x1 - portal->ax) > HINT_EPS) return false;
        if (fminf(barrier->y1, barrier->y2) >= fmaxf(portal->ay, portal->by) - HINT_EPS)
            return false;
        if (fmaxf(barrier->y1, barrier->y2) <= fminf(portal->ay, portal->by) + HINT_EPS)
            return false;
    } else {
        if (fabsf(barrier->y1 - portal->ay) > HINT_EPS) return false;
        if (fminf(barrier->x1, barrier->x2) >= fmaxf(portal->ax, portal->bx) - HINT_EPS)
            return false;
        if (fmaxf(barrier->x1, barrier->x2) <= fminf(portal->ax, portal->bx) + HINT_EPS)
            return false;
    }
    return true;
}

bool r2d_world_hint_rebuild_needed(const R2DWorldHintCache *cache,
                                   const R2DRe2dWorld *world)
{
    if (!cache || !world) return true;
    return cache->world != world ||
           cache->topology_revision != world->topology_revision;
}

bool r2d_world_hint_portal_blocked(const R2DWorldHintCache *cache,
                                   const R2DRe2dWorld *world,
                                   const R2DWorldPortal *portal)
{
    if (!world || !portal) return false;
    if (cache && cache->world == world &&
        cache->topology_revision == world->topology_revision) {
        for (int i = 0; i < cache->barrier_count; i++)
            if (barrier_matches_portal(&cache->barriers[i], portal)) return true;
        return false;
    }
    // Cache missing/stale: preserve the previous bounded legacy scan.
    for (int i = 0; i < world->wall_count; i++) {
        const R2DWorldWall *wall = &world->walls[i];
        if (!wall_has_hint(wall) || !finite_wall(wall)) continue;
        R2DWorldHintBarrier barrier = {
            wall->x1, wall->y1, wall->x2, wall->y2,
            wall->bottom, wall->top, i
        };
        if (barrier_matches_portal(&barrier, portal)) return true;
    }
    return false;
}

static float orient(float ax, float ay, float bx, float by, float cx, float cy)
{
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

static bool segments_cross(float ax, float ay, float bx, float by,
                           float cx, float cy, float dx, float dy)
{
    const float o1 = orient(ax, ay, bx, by, cx, cy);
    const float o2 = orient(ax, ay, bx, by, dx, dy);
    const float o3 = orient(cx, cy, dx, dy, ax, ay);
    const float o4 = orient(cx, cy, dx, dy, bx, by);
    return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
           ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

static bool point_hidden(float camera_x, float camera_y, float px, float py,
                         const R2DWorldOccluder *segments, int count)
{
    for (int i = 0; i < count; i++) {
        const R2DWorldOccluder *s = &segments[i];
        if (segments_cross(camera_x, camera_y, px, py,
                           s->x1, s->y1, s->x2, s->y2))
            return true;
    }
    return false;
}

bool r2d_world_hint_cell_occluded(const R2DWorldHintCache *cache,
                                  float x, float y, float w, float h,
                                  float camera_x, float camera_y)
{
    if (!cache || cache->occluder_count <= 0 || !cache->occluders) return false;
    if (!isfinite(x) || !isfinite(y) || !isfinite(w) || !isfinite(h) ||
        !isfinite(camera_x) || !isfinite(camera_y) || w <= 0.0f || h <= 0.0f)
        return false;
    if (camera_x >= x && camera_x <= x + w && camera_y >= y && camera_y <= y + h)
        return false;
    const float points[5][2] = {
        {x, y}, {x + w, y}, {x, y + h}, {x + w, y + h},
        {x + w * 0.5f, y + h * 0.5f}
    };
    for (int p = 0; p < 5; p++)
        if (!point_hidden(camera_x, camera_y, points[p][0], points[p][1],
                          cache->occluders, cache->occluder_count))
            return false;
    return true;
}
