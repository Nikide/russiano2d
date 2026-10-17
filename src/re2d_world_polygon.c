#include "re2d_world_polygon.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#define POLY_EPS ((double)R2D_WORLD_POLYGON_EPSILON)
#define POLY_MAX R2D_WORLD_POLYGON_MAX_POINTS

// ---------------------------------------------------------------------------
// Basic geometry (double internally, float at the API boundary).
// ---------------------------------------------------------------------------

static bool point_finite(const R2DWorldPoint *p)
{
    return p && isfinite(p->x) && isfinite(p->y);
}

static bool point_near(const R2DWorldPoint *a, const R2DWorldPoint *b,
                       double epsilon)
{
    double dx = (double)a->x - (double)b->x;
    double dy = (double)a->y - (double)b->y;
    return dx * dx + dy * dy <= epsilon * epsilon;
}

static double cross3(const R2DWorldPoint *a, const R2DWorldPoint *b,
                     const R2DWorldPoint *c)
{
    return ((double)b->x - a->x) * ((double)c->y - a->y) -
           ((double)b->y - a->y) * ((double)c->x - a->x);
}

static double ring_area2(const R2DWorldPoint *points, int count)
{
    double sum = 0.0;
    for (int i = 0; i < count; i++) {
        const R2DWorldPoint *a = &points[i];
        const R2DWorldPoint *b = &points[(i + 1) % count];
        sum += (double)a->x * b->y - (double)b->x * a->y;
    }
    return sum;
}

static bool ring_all_finite(const R2DWorldPoint *points, int count)
{
    for (int i = 0; i < count; i++)
        if (!point_finite(&points[i])) return false;
    return true;
}

static bool on_segment(const R2DWorldPoint *a, const R2DWorldPoint *b,
                       const R2DWorldPoint *p)
{
    if (fabs(cross3(a, b, p)) > POLY_EPS) return false;
    double minx = fmin((double)a->x, (double)b->x) - POLY_EPS;
    double maxx = fmax((double)a->x, (double)b->x) + POLY_EPS;
    double miny = fmin((double)a->y, (double)b->y) - POLY_EPS;
    double maxy = fmax((double)a->y, (double)b->y) + POLY_EPS;
    return (double)p->x >= minx && (double)p->x <= maxx &&
           (double)p->y >= miny && (double)p->y <= maxy;
}

// Inclusive segment touch: straddling, endpoint touch, or collinear overlap.
static bool segments_touch(const R2DWorldPoint *a, const R2DWorldPoint *b,
                           const R2DWorldPoint *c, const R2DWorldPoint *d)
{
    double o1 = cross3(a, b, c);
    double o2 = cross3(a, b, d);
    double o3 = cross3(c, d, a);
    double o4 = cross3(c, d, b);
    bool straddle_ab = (o1 > POLY_EPS && o2 < -POLY_EPS) ||
                       (o1 < -POLY_EPS && o2 > POLY_EPS);
    bool straddle_cd = (o3 > POLY_EPS && o4 < -POLY_EPS) ||
                       (o3 < -POLY_EPS && o4 > POLY_EPS);
    if (straddle_ab && straddle_cd) return true;
    if (fabs(o1) <= POLY_EPS && on_segment(a, b, c)) return true;
    if (fabs(o2) <= POLY_EPS && on_segment(a, b, d)) return true;
    if (fabs(o3) <= POLY_EPS && on_segment(c, d, a)) return true;
    if (fabs(o4) <= POLY_EPS && on_segment(c, d, b)) return true;
    return false;
}

static bool ring_self_intersects(const R2DWorldPoint *points, int count)
{
    for (int i = 0; i < count; i++) {
        const R2DWorldPoint *a = &points[i];
        const R2DWorldPoint *b = &points[(i + 1) % count];
        for (int j = i + 1; j < count; j++) {
            if (j == i + 1) continue;                    // adjacent edges
            if (i == 0 && j == count - 1) continue;      // closing adjacency
            const R2DWorldPoint *c = &points[j];
            const R2DWorldPoint *d = &points[(j + 1) % count];
            if (segments_touch(a, b, c, d)) return true;
        }
    }
    return false;
}

static int sign_with_epsilon(double value)
{
    if (value > POLY_EPS) return 1;
    if (value < -POLY_EPS) return -1;
    return 0;
}

static bool fail(char *error, size_t error_size, const char *message)
{
    if (error && error_size) snprintf(error, error_size, "%s", message);
    return false;
}

static int fail_count(char *error, size_t error_size, const char *message)
{
    fail(error, error_size, message);
    return -1;
}

// ---------------------------------------------------------------------------
// Winding / validation
// ---------------------------------------------------------------------------

int r2d_world_polygon_winding(const R2DWorldPoint *points, int point_count)
{
    if (!points || point_count < 3 || point_count > POLY_MAX) return 0;
    if (!ring_all_finite(points, point_count)) return 0;
    return sign_with_epsilon(ring_area2(points, point_count));
}

bool r2d_world_polygon_valid(const R2DWorldPoint *points, int point_count,
                             char *error, size_t error_size)
{
    if (error && error_size) error[0] = 0;
    if (!points) return fail(error, error_size, "polygon: null point array");
    if (point_count < 3 || point_count > POLY_MAX)
        return fail(error, error_size, "polygon: point count outside 3..1024");
    for (int i = 0; i < point_count; i++)
        if (!point_finite(&points[i]))
            return fail(error, error_size, "polygon: non-finite coordinate");
    for (int i = 0; i < point_count; i++) {
        int next = (i + 1) % point_count;
        if (point_near(&points[i], &points[next], POLY_EPS))
            return fail(error, error_size, "polygon: duplicate consecutive vertex");
    }
    if (sign_with_epsilon(ring_area2(points, point_count)) == 0)
        return fail(error, error_size, "polygon: degenerate zero-area ring");
    if (ring_self_intersects(points, point_count))
        return fail(error, error_size, "polygon: self-intersection");
    return true;
}

// ---------------------------------------------------------------------------
// Cleaning and ear clipping
// ---------------------------------------------------------------------------

// Removes consecutive duplicates and redundant collinear vertices. Returns the
// remaining count (may be < 3 for a degenerate input).
static int clean_ring(const R2DWorldPoint *source, int count,
                      R2DWorldPoint *out)
{
    int n = 0;
    for (int i = 0; i < count; i++) {
        if (n == 0 || !point_near(&out[n - 1], &source[i], POLY_EPS))
            out[n++] = source[i];
    }
    while (n > 1 && point_near(&out[0], &out[n - 1], POLY_EPS)) n--;

    bool changed = true;
    while (changed && n >= 3) {
        changed = false;
        for (int i = 0; i < n; i++) {
            int prev = (i + n - 1) % n;
            int next = (i + 1) % n;
            double cr = cross3(&out[prev], &out[i], &out[next]);
            double dx1 = (double)out[i].x - out[prev].x;
            double dy1 = (double)out[i].y - out[prev].y;
            double dx2 = (double)out[next].x - out[i].x;
            double dy2 = (double)out[next].y - out[i].y;
            double dot = dx1 * dx2 + dy1 * dy2;
            // Same-direction collinear continuation: the middle point is
            // redundant regardless of its distance from the neighbours.
            if (fabs(cr) <= POLY_EPS && dot > 0.0) {
                for (int k = i; k < n - 1; k++) out[k] = out[k + 1];
                n--;
                changed = true;
                break;
            }
        }
    }
    return n;
}

static void reverse_ring(R2DWorldPoint *points, int count)
{
    for (int i = 0, j = count - 1; i < j; i++, j--) {
        R2DWorldPoint tmp = points[i];
        points[i] = points[j];
        points[j] = tmp;
    }
}

static bool ring_convex_ccw(const R2DWorldPoint *points, int count)
{
    for (int i = 0; i < count; i++) {
        int prev = (i + count - 1) % count;
        int next = (i + 1) % count;
        if (cross3(&points[prev], &points[i], &points[next]) < -POLY_EPS)
            return false;
    }
    return true;
}

static bool point_in_triangle_ccw(const R2DWorldPoint *a,
                                  const R2DWorldPoint *b,
                                  const R2DWorldPoint *c,
                                  const R2DWorldPoint *p)
{
    return cross3(a, b, p) >= -POLY_EPS &&
           cross3(b, c, p) >= -POLY_EPS &&
           cross3(c, a, p) >= -POLY_EPS;
}

// Ear clipping of a CCW simple ring. Writes triangles into rings/out_points in
// deterministic order and returns the part count, or -1 if no ear is found.
static int clip_ears(const R2DWorldPoint *points, int count,
                     R2DWorldPolygon *rings, R2DWorldPoint *out_points)
{
    int index[POLY_MAX];
    for (int i = 0; i < count; i++) index[i] = i;

    int remaining = count;
    int parts = 0;
    int written = 0;
    while (remaining > 3) {
        bool found = false;
        for (int i = 0; i < remaining; i++) {
            int prev = (i + remaining - 1) % remaining;
            int next = (i + 1) % remaining;
            const R2DWorldPoint *a = &points[index[prev]];
            const R2DWorldPoint *b = &points[index[i]];
            const R2DWorldPoint *c = &points[index[next]];
            if (cross3(a, b, c) <= POLY_EPS) continue; // reflex or collinear
            bool ear = true;
            for (int j = 0; j < remaining; j++) {
                if (j == prev || j == i || j == next) continue;
                if (point_in_triangle_ccw(a, b, c, &points[index[j]])) {
                    ear = false;
                    break;
                }
            }
            if (!ear) continue;

            rings[parts++] = (R2DWorldPolygon){written, 3};
            out_points[written++] = *a;
            out_points[written++] = *b;
            out_points[written++] = *c;
            for (int k = i; k < remaining - 1; k++) index[k] = index[k + 1];
            remaining--;
            found = true;
            break;
        }
        if (!found) return -1;
    }

    rings[parts++] = (R2DWorldPolygon){written, 3};
    out_points[written++] = points[index[0]];
    out_points[written++] = points[index[1]];
    out_points[written++] = points[index[2]];
    return parts;
}

// ---------------------------------------------------------------------------
// Decomposition
// ---------------------------------------------------------------------------

int r2d_world_polygon_decompose(const R2DWorldPoint *points, int point_count,
                                R2DWorldPolygon *rings, int ring_capacity,
                                R2DWorldPoint *out_points, int point_capacity,
                                int *out_point_count,
                                char *error, size_t error_size)
{
    if (out_point_count) *out_point_count = 0;
    if (error && error_size) error[0] = 0;
    if (!points) return fail_count(error, error_size, "polygon: null point array");
    if (point_count < 3 || point_count > POLY_MAX)
        return fail_count(error, error_size, "polygon: point count outside 3..1024");
    if (ring_capacity < 0 || point_capacity < 0)
        return fail_count(error, error_size, "polygon: negative capacity");
    if ((ring_capacity > 0 && !rings) ||
        (point_capacity > 0 && !out_points))
        return fail_count(error, error_size, "polygon: null output buffer");

    R2DWorldPoint clean[POLY_MAX];
    int count = clean_ring(points, point_count, clean);
    if (count < 3)
        return fail_count(error, error_size, "polygon: degenerate after cleanup");
    if (!ring_all_finite(clean, count))
        return fail_count(error, error_size, "polygon: non-finite coordinate");
    if (sign_with_epsilon(ring_area2(clean, count)) == 0)
        return fail_count(error, error_size, "polygon: degenerate zero-area ring");
    if (ring_self_intersects(clean, count))
        return fail_count(error, error_size, "polygon: self-intersection");

    if (sign_with_epsilon(ring_area2(clean, count)) < 0)
        reverse_ring(clean, count);

    R2DWorldPolygon temp_rings[POLY_MAX];
    R2DWorldPoint temp_points[3 * POLY_MAX];
    int parts;
    int required_points;
    if (ring_convex_ccw(clean, count)) {
        temp_rings[0] = (R2DWorldPolygon){0, count};
        for (int i = 0; i < count; i++) temp_points[i] = clean[i];
        parts = 1;
        required_points = count;
    } else {
        parts = clip_ears(clean, count, temp_rings, temp_points);
        if (parts < 0)
            return fail_count(error, error_size, "polygon: ear clipping failed");
        required_points = 3 * parts;
    }

    if (out_point_count) *out_point_count = required_points;
    bool fits = ring_capacity >= parts && point_capacity >= required_points &&
                rings && out_points;
    if (!fits) return parts;

    for (int i = 0; i < parts; i++) rings[i] = temp_rings[i];
    for (int i = 0; i < required_points; i++) out_points[i] = temp_points[i];
    return parts;
}

// ---------------------------------------------------------------------------
// Shared edges / diagnostics
// ---------------------------------------------------------------------------

int r2d_world_polygon_shared_edges(const R2DWorldPoint *a, int a_count,
                                   const R2DWorldPoint *b, int b_count,
                                   float epsilon)
{
    if (!a || !b) return -1;
    if (a_count < 3 || a_count > POLY_MAX || b_count < 3 || b_count > POLY_MAX)
        return -1;
    if (!isfinite(epsilon) || epsilon < 0.0f) return -1;
    if (!ring_all_finite(a, a_count) || !ring_all_finite(b, b_count)) return -1;

    double eps = (double)epsilon;
    int matches = 0;
    for (int i = 0; i < a_count; i++) {
        const R2DWorldPoint *a0 = &a[i];
        const R2DWorldPoint *a1 = &a[(i + 1) % a_count];
        for (int j = 0; j < b_count; j++) {
            const R2DWorldPoint *b0 = &b[j];
            const R2DWorldPoint *b1 = &b[(j + 1) % b_count];
            bool same = (point_near(a0, b0, eps) && point_near(a1, b1, eps)) ||
                        (point_near(a0, b1, eps) && point_near(a1, b0, eps));
            if (same) matches++;
        }
    }
    return matches;
}

bool r2d_world_polygon_bounds(const R2DWorldPoint *points, int point_count,
                              float *minx, float *miny,
                              float *maxx, float *maxy)
{
    if (!points || !minx || !miny || !maxx || !maxy) return false;
    if (point_count < 3 || point_count > POLY_MAX) return false;
    if (!ring_all_finite(points, point_count)) return false;

    float lo_x = points[0].x, lo_y = points[0].y;
    float hi_x = points[0].x, hi_y = points[0].y;
    for (int i = 1; i < point_count; i++) {
        if (points[i].x < lo_x) lo_x = points[i].x;
        if (points[i].y < lo_y) lo_y = points[i].y;
        if (points[i].x > hi_x) hi_x = points[i].x;
        if (points[i].y > hi_y) hi_y = points[i].y;
    }
    *minx = lo_x;
    *miny = lo_y;
    *maxx = hi_x;
    *maxy = hi_y;
    return true;
}

float r2d_world_polygon_area(const R2DWorldPoint *points, int point_count)
{
    if (!points || point_count < 3 || point_count > POLY_MAX) return 0.0f;
    if (!ring_all_finite(points, point_count)) return 0.0f;
    double area2 = ring_area2(points, point_count);
    if (area2 < 0.0) area2 = -area2;
    return (float)(area2 * 0.5);
}
