#include "re2d_world_trace.h"

#include <float.h>
#include <math.h>

// Pure C trace layer. No allocation, no globals, no hidden state: every answer
// depends only on the arguments, so repeated calls are bit-identical.

static bool finite3(const float v[3])
{
    return isfinite(v[0]) && isfinite(v[1]) && isfinite(v[2]);
}

static bool proxy_valid(const R2DWorldHitProxy *p)
{
    if (!p) return false;
    if (!isfinite(p->x) || !isfinite(p->y) || !isfinite(p->bottom) ||
        !isfinite(p->top) || !isfinite(p->radius)) return false;
    return p->radius > 0.0f && p->top > p->bottom;
}

// Documented rule: shifted bit OR the enum bit value itself.
static bool proxy_matches(const R2DWorldHitProxy *p, int mask)
{
    if (!p || p->category < 0) return false;
    uint32_t m = (uint32_t)mask;
    uint32_t match = m & (uint32_t)p->category;
    if (p->category < 31) match |= m & (1u << (unsigned)p->category);
    return match != 0;
}

// ---------------------------------------------------------------------------
// Static world hit, using the authoritative native ray query.
// ---------------------------------------------------------------------------
static bool world_trace_hit(const R2DRe2dWorld *world, const float from[3], const float to[3],
                            R2DWorldTraceResult *out)
{
    float direction[3] = { to[0]-from[0], to[1]-from[1], to[2]-from[2] };
    R2DWorldHit hit;
    if (!r2d_world_ray(world, from, direction, 0.0f, 1.0f, &hit)) return false;
    if (!isfinite(hit.t) || hit.t < 0.0f || hit.t > 1.0f) return false;

    out->type = R2D_WORLD_TRACE_SURFACE;
    out->fraction = hit.t;
    out->x = hit.x;
    out->y = hit.y;
    out->h = hit.height;
    out->surface = hit.wall;   // wall index, -1 for floor/ceiling
    out->span = hit.span;      // span index, -1 for wall
    out->proxy = -1;
    out->node = -1;
    out->nx = 0.0f;
    out->ny = 0.0f;

    // Walls carry an unambiguous XY direction, so expose a stable normal facing
    // the ray origin. Span planes are dominantly vertical in height; their XY
    // normal is reported as zero (documented in the header).
    if (hit.wall >= 0 && hit.wall < world->wall_count) {
        const R2DWorldWall *wall = &world->walls[hit.wall];
        float dx = wall->x2 - wall->x1, dy = wall->y2 - wall->y1;
        float length = sqrtf(dx*dx + dy*dy);
        if (length > 1e-12f) {
            float nx = -dy / length, ny = dx / length;
            float ox = from[0] - hit.x, oy = from[1] - hit.y;
            if (nx*ox + ny*oy < 0.0f) { nx = -nx; ny = -ny; }
            out->nx = nx;
            out->ny = ny;
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Exact ray vs finite vertical cylinder proxy. The XY cylinder is solved as a
// quadratic over the parametric segment; the vertical interval of the segment
// inside that XY span is then intersected with [bottom,top], and the returned
// fraction is advanced to the height entry when the ray starts outside it.
// ---------------------------------------------------------------------------
static bool proxy_trace_hit(const R2DWorldHitProxy *p, int index, const float from[3], const float to[3],
                            R2DWorldTraceResult *out)
{
    if (!proxy_valid(p)) return false;

    float fx = from[0] - p->x, fy = from[1] - p->y;
    float dx = to[0] - from[0], dy = to[1] - from[1];
    float dz = to[2] - from[2];
    float a = dx*dx + dy*dy;
    float c = fx*fx + fy*fy - p->radius*p->radius;
    float t;

    if (!(a > 1e-12f)) {
        // Degenerate segment: only a point already inside the interval hits.
        if (c > 0.0f) return false;
        if (from[2] < p->bottom || from[2] > p->top) return false;
        t = 0.0f;
    } else {
        // Broad phase: closest approach of the segment to the circle centre.
        float u = -(fx*dx + fy*dy) / a;
        if (u < 0.0f) u = 0.0f;
        if (u > 1.0f) u = 1.0f;
        float qx = fx + u*dx, qy = fy + u*dy;
        if (qx*qx + qy*qy > p->radius*p->radius) return false;

        float b = 2.0f*(fx*dx + fy*dy);
        float disc = b*b - 4.0f*a*c;
        // Tangent contact is a miss: a graze has no well-defined entry side.
        if (!(disc > 0.0f)) return false;
        float root = sqrtf(disc);
        float t0 = (-b - root) / (2.0f*a);
        float t1 = (-b + root) / (2.0f*a);
        if (t1 < 0.0f || t0 > 1.0f) return false;
        float entry = t0 < 0.0f ? 0.0f : t0;
        float exit = t1 > 1.0f ? 1.0f : t1;

        float z0 = from[2] + entry*dz, z1 = from[2] + exit*dz;
        float zlo = fminf(z0, z1), zhi = fmaxf(z0, z1);
        if (zhi < p->bottom || zlo > p->top) return false;

        t = entry;
        if (dz > 1e-12f) {
            float te = (p->bottom - from[2]) / dz;
            if (te > t) t = te;
        } else if (dz < -1e-12f) {
            float te = (p->top - from[2]) / dz;
            if (te > t) t = te;
        }
        if (t > exit) return false;
    }
    if (t < 0.0f) t = 0.0f;
    if (t > 1.0f) t = 1.0f;

    out->type = R2D_WORLD_TRACE_SPRITE;
    out->fraction = t;
    out->x = from[0] + t*dx;
    out->y = from[1] + t*dy;
    out->h = from[2] + t*dz;
    out->surface = -1;
    out->span = -1;
    out->proxy = index;
    out->node = p->node;

    // Outward radial normal at the entry point, flipped to face the origin.
    float nx = out->x - p->x, ny = out->y - p->y;
    float length = sqrtf(nx*nx + ny*ny);
    if (length > 1e-9f) {
        nx /= length; ny /= length;
    } else {
        float segment = sqrtf(dx*dx + dy*dy);
        if (segment > 1e-9f) { nx = -dx/segment; ny = -dy/segment; }
        else { nx = 0.0f; ny = 0.0f; }
    }
    float ox = from[0] - out->x, oy = from[1] - out->y;
    if (nx*ox + ny*oy < 0.0f) { nx = -nx; ny = -ny; }
    out->nx = nx;
    out->ny = ny;
    return true;
}

static bool trace_input_valid(const R2DRe2dWorld *world, const R2DWorldHitProxy *proxies, int proxy_count,
                              const float from[3], const float to[3], int ignore_proxy)
{
    if (!world || !from || !to) return false;
    if (!finite3(from) || !finite3(to)) return false;
    if (proxy_count < 0) return false;
    if (proxy_count > 0 && !proxies) return false;
    if (ignore_proxy < -1) return false;
    return true;
}

bool r2d_world_trace_ray(const R2DRe2dWorld *world, const R2DWorldHitProxy *proxies, int proxy_count,
                         const float from[3], const float to[3], int mask, int ignore_proxy,
                         R2DWorldTraceResult *out)
{
    if (!out) return false;
    if (!trace_input_valid(world, proxies, proxy_count, from, to, ignore_proxy)) return false;

    bool found = false;
    R2DWorldTraceResult best;
    if (mask & R2D_WORLD_TRACE_WORLD) {
        R2DWorldTraceResult candidate;
        if (world_trace_hit(world, from, to, &candidate)) { best = candidate; found = true; }
    }
    for (int i = 0; i < proxy_count; i++) {
        if (i == ignore_proxy) continue;
        if (!proxy_matches(&proxies[i], mask)) continue;
        R2DWorldTraceResult candidate;
        if (!proxy_trace_hit(&proxies[i], i, from, to, &candidate)) continue;
        // World is processed first, so a strict comparison keeps world before
        // sprite on an identical fraction; equal sprites keep input order.
        if (!found || candidate.fraction < best.fraction) { best = candidate; found = true; }
    }
    if (found) *out = best;
    return found;
}

// Stable near-to-far order: fraction first, world before sprite on a tie.
static bool trace_less(const R2DWorldTraceResult *a, const R2DWorldTraceResult *b)
{
    if (a->fraction < b->fraction) return true;
    if (a->fraction > b->fraction) return false;
    return a->type == R2D_WORLD_TRACE_SURFACE && b->type == R2D_WORLD_TRACE_SPRITE;
}

static void collect_insert(R2DWorldTraceResult *out, int capacity, int *written,
                           const R2DWorldTraceResult *hit)
{
    if (!out || capacity <= 0) return;
    int position = 0;
    while (position < *written && !trace_less(hit, &out[position])) position++;
    if (position >= capacity) return;
    int last = *written < capacity ? *written : capacity - 1;
    for (int j = last; j > position; j--) out[j] = out[j-1];
    out[position] = *hit;
    if (*written < capacity) (*written)++;
}

int r2d_world_trace_collect(const R2DRe2dWorld *world, const R2DWorldHitProxy *proxies, int proxy_count,
                            const float from[3], const float to[3], int mask, int ignore_proxy,
                            R2DWorldTraceResult *out, int capacity)
{
    if (capacity < 0) return -1;
    if (!trace_input_valid(world, proxies, proxy_count, from, to, ignore_proxy)) return -1;

    int total = 0, written = 0;
    if (mask & R2D_WORLD_TRACE_WORLD) {
        R2DWorldTraceResult hit;
        if (world_trace_hit(world, from, to, &hit)) {
            total++;
            collect_insert(out, capacity, &written, &hit);
        }
    }
    for (int i = 0; i < proxy_count; i++) {
        if (i == ignore_proxy) continue;
        if (!proxy_matches(&proxies[i], mask)) continue;
        R2DWorldTraceResult hit;
        if (!proxy_trace_hit(&proxies[i], i, from, to, &hit)) continue;
        total++;
        collect_insert(out, capacity, &written, &hit);
    }
    return total;
}

float r2d_world_proxy_sweep(const R2DWorldHitProxy *proxy, float from_x, float from_y, float to_x, float to_y,
                            float radius, float bottom, float top)
{
    if (!proxy_valid(proxy)) return -1.0f;
    if (!isfinite(from_x) || !isfinite(from_y) || !isfinite(to_x) || !isfinite(to_y)) return -1.0f;
    if (!isfinite(radius) || radius < 0.0f) return -1.0f;
    if (!isfinite(bottom) || !isfinite(top) || top < bottom) return -1.0f;
    if (bottom >= proxy->top || top <= proxy->bottom) return -1.0f;

    float swept = proxy->radius + radius;
    if (!(swept > 0.0f)) return -1.0f;

    float fx = from_x - proxy->x, fy = from_y - proxy->y;
    float dx = to_x - from_x, dy = to_y - from_y;
    float a = dx*dx + dy*dy;
    float c = fx*fx + fy*fy - swept*swept;

    if (!(a > 1e-12f)) return c <= 0.0f ? 0.0f : -1.0f;

    float u = -(fx*dx + fy*dy) / a;
    if (u < 0.0f) u = 0.0f;
    if (u > 1.0f) u = 1.0f;
    float qx = fx + u*dx, qy = fy + u*dy;
    if (qx*qx + qy*qy > swept*swept) return -1.0f;

    if (c <= 0.0f) return 0.0f;

    float b = 2.0f*(fx*dx + fy*dy);
    float disc = b*b - 4.0f*a*c;
    if (!(disc > 0.0f)) return -1.0f;
    float root = sqrtf(disc);
    float t0 = (-b - root) / (2.0f*a);
    float t1 = (-b + root) / (2.0f*a);
    if (t1 < 0.0f || t0 > 1.0f) return -1.0f;
    if (t0 < 0.0f) t0 = 0.0f;
    if (t0 > 1.0f) t0 = 1.0f;
    return t0;
}
