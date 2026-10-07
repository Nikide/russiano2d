#include "rotsprite_math.h"
#include <math.h>
#include <stddef.h>
#include <string.h>

#define PI 3.14159265358979323846
typedef struct Vec { double x, y, z; } Vec;

bool r2d_rotsprite_layout(int w, int h, int *cell)
{
    if (w != h || w % 8 != 0 || w < 64 || w > 2048) return false;
    if (cell) *cell = w / 8;
    return true;
}

bool r2d_rotsprite_angles(double yaw, double pitch, double *oy, double *op)
{
    if (!isfinite(yaw) || !isfinite(pitch)) return false;
    double y = fmod(yaw, 360.0);
    if (y >= 180) y -= 360;
    if (y < -180) y += 360;
    *oy = y == 0 ? 0 : y;
    *op = fmax(-75, fmin(75, pitch));
    return true;
}

// Обратный поворот: сначала отменяем pitch, затем yaw.
static Vec inverse(Vec p, double cy, double sy, double cp, double sp)
{
    const double y = cp * p.y + sp * p.z;
    const double z = -sp * p.y + cp * p.z;
    return (Vec){cy * p.x - sy * z, y, sy * p.x + cy * z};
}

static Vec point(Vec o, Vec d, double t)
{
    return (Vec){o.x + d.x * t, o.y + d.y * t, o.z + d.z * t};
}

static bool head_hit(Vec o, Vec d, double *t)
{
    const Vec a = {o.x / 14, o.y / 18, o.z / 12};
    const Vec b = {d.x / 14, d.y / 18, d.z / 12};
    const double aa = b.x*b.x + b.y*b.y + b.z*b.z;
    const double bb = a.x*b.x + a.y*b.y + a.z*b.z;
    const double cc = a.x*a.x + a.y*a.y + a.z*a.z - 1;
    const double disc = bb*bb - aa*cc;
    if (disc < 0) return false;
    *t = (-bb - sqrt(disc)) / aa;
    return *t >= 0;
}

// Пересечение выпуклой призмы через полуплоскости, без вершинного меша.
static bool plane(Vec o, Vec d, Vec n, double c, double *lo, double *hi)
{
    const double p = n.x*o.x + n.y*o.y + n.z*o.z - c;
    const double v = n.x*d.x + n.y*d.y + n.z*d.z;
    if (fabs(v) < 1e-12) return p <= 0;
    const double t = -p / v;
    if (v < 0) *lo = fmax(*lo, t); else *hi = fmin(*hi, t);
    return *lo <= *hi;
}

static bool ear_hit(Vec o, Vec d, int side, double *t)
{
    o.x *= side; d.x *= side;
    const double x[3] = {-16, -13, -5}, y[3] = {-15, -29, -17};
    double lo = 0, hi = 200;
    for (int i = 0; i < 3; ++i) {
        const int j = (i + 1) % 3;
        const Vec n = {y[j] - y[i], x[i] - x[j], 0};
        if (!plane(o, d, n, n.x*x[i] + n.y*y[i], &lo, &hi)) return false;
    }
    if (!plane(o, d, (Vec){0,0,1}, 3, &lo, &hi) ||
        !plane(o, d, (Vec){0,0,-1}, 3, &lo, &hi)) return false;
    *t = lo;
    return true;
}

static int texel(double u, int size)
{
    int i = (int)floor(u * size);
    return i < 0 ? 0 : (i >= size ? size - 1 : i);
}

static const uint8_t *sample(const uint8_t *atlas, int stride, int n,
                              Vec p, int part)
{
    int x, y;
    if (part == 0) {
        double u = 0.5 + atan2(p.x / 14, p.z / 12) / (2*PI);
        u -= floor(u);
        const double v = acos(fmax(-1, fmin(1, -p.y / 18))) / PI;
        x = texel(u, 4*n); y = texel(v, 2*n);
    } else {
        const double px = part == 1 ? p.x : -p.x;
        x = (part == 1 ? 4 : 5)*n + texel((px + 16) / 11, n);
        y = (p.z < 0 ? n : 0) + texel((p.y + 29) / 14, n);
    }
    return atlas + (size_t)y * (size_t)stride + (size_t)x * 4;
}

bool r2d_rotsprite_raster(const uint8_t *atlas, int w, int h, int stride,
                          double yaw, double pitch, uint8_t *out)
{
    int n;
    if (!atlas || !out || !r2d_rotsprite_layout(w, h, &n) || stride < w*4 ||
        !r2d_rotsprite_angles(yaw, pitch, &yaw, &pitch)) return false;
    const double a = yaw * PI/180, b = pitch * PI/180;
    const double cy = cos(a), sy = sin(a), cp = cos(b), sp = sin(b);
    const Vec d = inverse((Vec){0,0,-1}, cy,sy,cp,sp);
    memset(out, 0, R2D_ROTSPRITE_SIZE * R2D_ROTSPRITE_SIZE * 4);
    for (int y = 0; y < R2D_ROTSPRITE_SIZE; ++y) {
        for (int x = 0; x < R2D_ROTSPRITE_SIZE; ++x) {
            const Vec o = inverse((Vec){x + 0.5 - 32, y + 0.5 - 32, 100}, cy,sy,cp,sp);
            double nearest = 201;
            const uint8_t *color = NULL;
            for (int part = 0; part < 3; ++part) {
                double t;
                const bool hit = part == 0 ? head_hit(o,d,&t) : ear_hit(o,d,part == 1 ? 1 : -1,&t);
                if (!hit || t >= nearest) continue;
                const uint8_t *c = sample(atlas,stride,n,point(o,d,t),part);
                if (c[3] == 0) continue;
                color = c; nearest = t;
            }
            if (color) memcpy(out + (y * R2D_ROTSPRITE_SIZE + x)*4, color, 4);
        }
    }
    return true;
}
