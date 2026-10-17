#include "re2d_world_polywall.h"

#include <math.h>

// Pure PolyWallGroup math. No allocation, no globals, no clocks: every result
// depends only on the arguments, so collision/timeline replays are repeatable.

#define R2D_POLYWALL_PI 3.14159265358979323846
#define R2D_POLYWALL_TAU 6.283185307179586476925286766559

static bool finite3f(float a, float b, float c)
{
    return isfinite(a) && isfinite(b) && isfinite(c);
}

static bool finite_transform(const R2DWorldPolyWallTransform *t)
{
    return t && finite3f(t->tx, t->ty, t->rotation) &&
           isfinite(t->pivot_x) && isfinite(t->pivot_y);
}

static bool finite_segment(const R2DWorldPolyWallSegment *s)
{
    return s && finite3f(s->x1, s->y1, s->x2) &&
           finite3f(s->y2, s->bottom, s->top);
}

static bool segments_valid(const R2DWorldPolyWallSegment *segments, int count)
{
    if (!segments || count <= 0) return false;
    for (int i = 0; i < count; ++i) {
        if (!finite_segment(&segments[i])) return false;
    }
    return true;
}

// Normalize to (-pi, pi]; keeps +pi instead of folding it to -pi.
static double normalize_angle(double angle)
{
    angle = fmod(angle, R2D_POLYWALL_TAU);
    if (angle > R2D_POLYWALL_PI) angle -= R2D_POLYWALL_TAU;
    else if (angle <= -R2D_POLYWALL_PI) angle += R2D_POLYWALL_TAU;
    if (angle == 0.0) angle = 0.0; // collapse -0.0
    return angle;
}

void r2d_world_polywall_transform_point(const R2DWorldPolyWallTransform *transform,
                                        float x, float y, float *out_x, float *out_y)
{
    if (!transform || !out_x || !out_y) return;
    if (!finite_transform(transform) || !isfinite(x) || !isfinite(y)) return;

    double angle = fmod((double)transform->rotation, R2D_POLYWALL_TAU);
    double c = cos(angle);
    double s = sin(angle);
    double dx = (double)x - (double)transform->pivot_x;
    double dy = (double)y - (double)transform->pivot_y;
    double rx = dx * c - dy * s;
    double ry = dx * s + dy * c;

    *out_x = (float)((double)transform->pivot_x + (double)transform->tx + rx);
    *out_y = (float)((double)transform->pivot_y + (double)transform->ty + ry);
}

bool r2d_world_polywall_apply(const R2DWorldPolyWallTransform *transform,
                              const R2DWorldPolyWallSegment *segments, int count,
                              R2DWorldPolyWallSegment *out)
{
    if (!transform || !segments || !out || count <= 0) return false;
    if (!finite_transform(transform)) return false;
    if (!segments_valid(segments, count)) return false;

    for (int i = 0; i < count; ++i) {
        const R2DWorldPolyWallSegment *src = &segments[i];
        float x1, y1, x2, y2;
        float bottom = src->bottom;
        float top = src->top;
        // transform_point validates again; the inputs are known finite here.
        r2d_world_polywall_transform_point(transform, src->x1, src->y1, &x1, &y1);
        r2d_world_polywall_transform_point(transform, src->x2, src->y2, &x2, &y2);
        out[i].x1 = x1;
        out[i].y1 = y1;
        out[i].x2 = x2;
        out[i].y2 = y2;
        out[i].bottom = bottom; // heights are constrained and never transformed
        out[i].top = top;
    }
    return true;
}

bool r2d_world_polywall_bounds(const R2DWorldPolyWallSegment *segments, int count,
                               float *minx, float *miny, float *maxx, float *maxy)
{
    if (!segments || !minx || !miny || !maxx || !maxy) return false;
    if (!segments_valid(segments, count)) return false;

    double lo_x = (double)segments[0].x1;
    double lo_y = (double)segments[0].y1;
    double hi_x = lo_x;
    double hi_y = lo_y;
    for (int i = 0; i < count; ++i) {
        const R2DWorldPolyWallSegment *s = &segments[i];
        double xs[2] = {(double)s->x1, (double)s->x2};
        double ys[2] = {(double)s->y1, (double)s->y2};
        for (int k = 0; k < 2; ++k) {
            if (xs[k] < lo_x) lo_x = xs[k];
            if (xs[k] > hi_x) hi_x = xs[k];
            if (ys[k] < lo_y) lo_y = ys[k];
            if (ys[k] > hi_y) hi_y = ys[k];
        }
    }

    *minx = (float)lo_x;
    *miny = (float)lo_y;
    *maxx = (float)hi_x;
    *maxy = (float)hi_y;
    return true;
}

static void closest_point_on_segment(double px, double py,
                                     double ax, double ay, double bx, double by,
                                     double *cx, double *cy)
{
    double ex = bx - ax;
    double ey = by - ay;
    double len2 = ex * ex + ey * ey;
    if (len2 <= 0.0) {
        *cx = ax;
        *cy = ay;
        return;
    }
    double u = ((px - ax) * ex + (py - ay) * ey) / len2;
    if (u < 0.0) u = 0.0;
    if (u > 1.0) u = 1.0;
    *cx = ax + ex * u;
    *cy = ay + ey * u;
}

static void overlap_normal(double from_x, double from_y, double ax, double ay,
                           double bx, double by, double mx, double my,
                           double *nx, double *ny)
{
    double cx, cy;
    closest_point_on_segment(from_x, from_y, ax, ay, bx, by, &cx, &cy);
    double dx = from_x - cx;
    double dy = from_y - cy;
    double len = sqrt(dx * dx + dy * dy);
    if (len > 1e-12) {
        *nx = dx / len;
        *ny = dy / len;
        return;
    }
    // The center starts exactly on the segment: push opposite to motion.
    double mlen = sqrt(mx * mx + my * my);
    if (mlen > 1e-12) {
        *nx = -mx / mlen;
        *ny = -my / mlen;
    } else {
        *nx = 0.0;
        *ny = 1.0;
    }
}

// Consider one candidate entry time; keeps the earliest valid hit.
static void consider_hit(double t, int segment_index,
                         double nx, double ny,
                         double *best_t, int *best_segment,
                         double *best_nx, double *best_ny)
{
    if (t < 0.0 || t > 1.0) return;
    if (t >= *best_t) return; // strict: first segment wins exact ties
    *best_t = t;
    *best_segment = segment_index;
    *best_nx = nx;
    *best_ny = ny;
}

float r2d_world_polywall_sweep(const R2DWorldPolyWallSegment *segments, int count,
                               float from_x, float from_y, float to_x, float to_y,
                               float radius, R2DWorldPolyWallHit *out_hit)
{
    if (!segments || count <= 0) return -1.0f;
    if (!finite3f(from_x, from_y, to_x) || !isfinite(to_y)) return -1.0f;
    if (!isfinite(radius) || radius < 0.0f) return -1.0f;
    if (!segments_valid(segments, count)) return -1.0f;

    const double p0x = (double)from_x;
    const double p0y = (double)from_y;
    const double dx = (double)to_x - p0x;
    const double dy = (double)to_y - p0y;
    const double r = (double)radius;
    const double r2 = r * r;

    double best_t = 2.0;
    int best_segment = -1;
    double best_nx = 0.0;
    double best_ny = 1.0;

    for (int i = 0; i < count; ++i) {
        const double ax = (double)segments[i].x1;
        const double ay = (double)segments[i].y1;
        const double bx = (double)segments[i].x2;
        const double by = (double)segments[i].y2;

        // Already touching or overlapping at the start: immediate hit.
        {
            double cx, cy;
            closest_point_on_segment(p0x, p0y, ax, ay, bx, by, &cx, &cy);
            double sx = p0x - cx;
            double sy = p0y - cy;
            if (sx * sx + sy * sy <= r2) {
                double nx, ny;
                overlap_normal(p0x, p0y, ax, ay, bx, by, dx, dy, &nx, &ny);
                if (out_hit) {
                    out_hit->fraction = 0.0f;
                    out_hit->nx = (float)nx;
                    out_hit->ny = (float)ny;
                    out_hit->segment = i;
                }
                return 0.0f;
            }
        }

        const double ex = bx - ax;
        const double ey = by - ay;
        const double len2 = ex * ex + ey * ey;
        double lx = 0.0, ly = 0.0; // unit left normal of the segment
        if (len2 > 1e-24) {
            double len = sqrt(len2);
            lx = -ey / len;
            ly = ex / len;

            // Body entry: signed distance to the supporting line equals +-r.
            double f0 = (p0x - ax) * lx + (p0y - ay) * ly;
            double fd = dx * lx + dy * ly;
            if (fabs(fd) > 1e-15) {
                for (int k = 0; k < 2; ++k) {
                    double target = (k == 0) ? r : -r;
                    double t = (target - f0) / fd;
                    if (t < 0.0 || t > 1.0 || t >= best_t) continue;
                    double px = p0x + dx * t;
                    double py = p0y + dy * t;
                    double u = ((px - ax) * ex + (py - ay) * ey) / len2;
                    if (u < -1e-9 || u > 1.0 + 1e-9) continue;
                    double sign = (k == 0) ? 1.0 : -1.0;
                    if (r == 0.0) sign = (f0 >= 0.0) ? 1.0 : -1.0;
                    consider_hit(t, i, lx * sign, ly * sign,
                                 &best_t, &best_segment, &best_nx, &best_ny);
                }
            }
        }

        // Endpoint caps: the moving point vs circles of radius r at A and B.
        {
            const double axs[2] = {ax, bx};
            const double ays[2] = {ay, by};
            const double move_len2 = dx * dx + dy * dy;
            if (move_len2 > 1e-30) {
                for (int e = 0; e < 2; ++e) {
                    double rx = p0x - axs[e];
                    double ry = p0y - ays[e];
                    double bcoef = 2.0 * (rx * dx + ry * dy);
                    double ccoef = rx * rx + ry * ry - r2;
                    double disc = bcoef * bcoef - 4.0 * move_len2 * ccoef;
                    if (disc < 0.0) continue;
                    double root = sqrt(disc);
                    double t = (-bcoef - root) / (2.0 * move_len2);
                    if (t < 0.0 || t > 1.0 || t >= best_t) continue;

                    double px = p0x + dx * t;
                    double py = p0y + dy * t;
                    // Reject an interior crossing of the full endpoint circle:
                    // the capsule entry happened earlier via the body seam.
                    if (len2 > 1e-24 && r > 0.0) {
                        double u = ((px - ax) * ex + (py - ay) * ey) / len2;
                        if (u > 0.0 && u < 1.0) {
                            double f = (px - ax) * lx + (py - ay) * ly;
                            if (fabs(f) < r - 1e-9) continue;
                        }
                    }

                    double nx, ny;
                    if (r > 1e-12) {
                        nx = (px - axs[e]) / r;
                        ny = (py - ays[e]) / r;
                    } else {
                        double mlen = sqrt(move_len2);
                        nx = -dx / mlen;
                        ny = -dy / mlen;
                    }
                    consider_hit(t, i, nx, ny,
                                 &best_t, &best_segment, &best_nx, &best_ny);
                }
            }
        }
    }

    if (best_segment < 0) return -1.0f;

    if (out_hit) {
        out_hit->fraction = (float)best_t;
        out_hit->nx = (float)best_nx;
        out_hit->ny = (float)best_ny;
        out_hit->segment = best_segment;
    }
    return (float)best_t;
}

void r2d_world_polywall_lerp(const R2DWorldPolyWallTransform *from,
                             const R2DWorldPolyWallTransform *to,
                             float fraction, R2DWorldPolyWallTransform *out)
{
    if (!from || !to || !out) return;
    if (!finite_transform(from) || !finite_transform(to) || !isfinite(fraction)) return;

    double f = (double)fraction;
    if (f < 0.0) f = 0.0;
    if (f > 1.0) f = 1.0;

    double tx = (double)from->tx + ((double)to->tx - (double)from->tx) * f;
    double ty = (double)from->ty + ((double)to->ty - (double)from->ty) * f;
    double px = (double)from->pivot_x + ((double)to->pivot_x - (double)from->pivot_x) * f;
    double py = (double)from->pivot_y + ((double)to->pivot_y - (double)from->pivot_y) * f;

    // Shortest normalized arc: never spin the long way around.
    double a0 = normalize_angle((double)from->rotation);
    double a1 = normalize_angle((double)to->rotation);
    double delta = normalize_angle(a1 - a0);
    double rotation = normalize_angle(a0 + delta * f);

    out->tx = (float)tx;
    out->ty = (float)ty;
    out->rotation = (float)rotation;
    out->pivot_x = (float)px;
    out->pivot_y = (float)py;
}
