#include "re2d_math.h"

#include <math.h>
#include <string.h>

// Вершина в системе камеры: right — вправо, up — вверх, depth — вдоль взгляда.
typedef struct {
    float right, up, depth;
    float u, v, r, g, b;
} ViewVert;

static float clampf(float x, float lo, float hi)
{
    return x < lo ? lo : (x > hi ? hi : x);
}

void r2d_re2d_view_set(R2DRe2dView *v, float x, float y, float eye,
                       float yaw, float pitch, float fov,
                       float width, float height)
{
    if (!v) return;
    v->x = x;
    v->y = y;
    v->eye = eye;
    v->yaw = yaw;
    // Взгляд строго вверх/вниз вырожден (depth не зависит от горизонтали),
    // поэтому наклон держим в открытом интервале.
    v->pitch = clampf(pitch, -1.5533f, 1.5533f);   // ±89°
    v->fov = clampf(fov, 0.05f, 3.0f);
    v->width = width > 1.0f ? width : 1.0f;
    v->height = height > 1.0f ? height : 1.0f;
    v->near_plane = 4.0f;
    v->fog_far = 0.0f;
    v->fog_min = 1.0f;
    v->cos_yaw = cosf(yaw);
    v->sin_yaw = sinf(yaw);
    v->cos_pitch = cosf(v->pitch);
    v->sin_pitch = sinf(v->pitch);
    v->focal = (v->height * 0.5f) / tanf(v->fov * 0.5f);
}

void r2d_re2d_view_fog(R2DRe2dView *v, float fog_far, float fog_min)
{
    if (!v) return;
    v->fog_far = fog_far > 0.0f ? fog_far : 0.0f;
    v->fog_min = clampf(fog_min, 0.0f, 1.0f);
}

// Мировая точка → система камеры (поворот на yaw вокруг вертикали, затем на pitch).
static void to_view(const R2DRe2dView *v, float wx, float wy, float wz, ViewVert *out)
{
    const float dx = wx - v->x;
    const float dy = wy - v->y;
    const float up = wz - v->eye;
    const float forward = dx * v->cos_yaw + dy * v->sin_yaw;
    out->right = -dx * v->sin_yaw + dy * v->cos_yaw;
    out->depth = forward * v->cos_pitch + up * v->sin_pitch;
    out->up = up * v->cos_pitch - forward * v->sin_pitch;
}

bool r2d_re2d_project(const R2DRe2dView *v, float wx, float wy, float wz, float out[4])
{
    out[0] = out[1] = out[3] = 0.0f;
    out[2] = -1.0f;
    if (!v || !isfinite(wx) || !isfinite(wy) || !isfinite(wz)) return false;
    ViewVert p;
    to_view(v, wx, wy, wz, &p);
    if (p.depth < v->near_plane) return false;
    const float k = v->focal / p.depth;
    out[0] = v->width * 0.5f + p.right * k;
    out[1] = v->height * 0.5f - p.up * k;
    out[2] = 1.0f - v->near_plane / p.depth;
    out[3] = k;
    return true;
}

bool r2d_re2d_unproject(const R2DRe2dView *v, float sx, float sy, float plane_z, float out[2])
{
    out[0] = out[1] = 0.0f;
    if (!v || !isfinite(sx) || !isfinite(sy) || !isfinite(plane_z)) return false;
    // Луч в системе камеры: depth = 1, right/up из пикселя. Обратный поворот —
    // транспонированный: сначала pitch, потом yaw.
    const float right = (sx - v->width * 0.5f) / v->focal;
    const float up_v = -(sy - v->height * 0.5f) / v->focal;
    const float forward = v->cos_pitch - up_v * v->sin_pitch;
    const float up = v->sin_pitch + up_v * v->cos_pitch;
    const float dx = forward * v->cos_yaw - right * v->sin_yaw;
    const float dy = forward * v->sin_yaw + right * v->cos_yaw;
    if (fabsf(up) < 1e-6f) return false;
    const float t = (plane_z - v->eye) / up;
    if (!(t > 0.0f)) return false;
    out[0] = v->x + dx * t;
    out[1] = v->y + dy * t;
    return true;
}

int r2d_re2d_project_points(const R2DRe2dView *v, const float *in, int count, float *out)
{
    if (!v || !in || !out || count <= 0) return 0;
    int visible = 0;
    for (int i = 0; i < count; ++i) {
        if (r2d_re2d_project(v, in[i * 3], in[i * 3 + 1], in[i * 3 + 2], out + i * 4)) ++visible;
    }
    return visible;
}

static void lerp_vert(const ViewVert *a, const ViewVert *b, float t, ViewVert *out)
{
    out->right = a->right + (b->right - a->right) * t;
    out->up = a->up + (b->up - a->up) * t;
    out->depth = a->depth + (b->depth - a->depth) * t;
    out->u = a->u + (b->u - a->u) * t;
    out->v = a->v + (b->v - a->v) * t;
    out->r = a->r + (b->r - a->r) * t;
    out->g = a->g + (b->g - a->g) * t;
    out->b = a->b + (b->b - a->b) * t;
}

// Отсечение выпуклого многоугольника плоскостью depth >= near (Сазерленд — Ходжман).
// poly — до 3 вершин на входе; результат — до 4 вершин.
static int clip_near(const ViewVert *poly, int n, float near_plane, ViewVert *out)
{
    int m = 0;
    for (int i = 0; i < n; ++i) {
        const ViewVert *a = &poly[i];
        const ViewVert *b = &poly[(i + 1) % n];
        const bool a_in = a->depth >= near_plane;
        const bool b_in = b->depth >= near_plane;
        if (a_in) out[m++] = *a;
        if (a_in != b_in) {
            const float t = (near_plane - a->depth) / (b->depth - a->depth);
            lerp_vert(a, b, t, &out[m]);
            out[m].depth = near_plane;   // без накопленной погрешности
            ++m;
        }
    }
    return m;
}

// Вершина камеры → вершина меша для submitMesh: экран, глубина 0..1, цвет с туманом.
static void emit_vert(const R2DRe2dView *v, const ViewVert *p, float *dst)
{
    const float k = v->focal / p->depth;
    float shade = 1.0f;
    if (v->fog_far > 0.0f) shade = clampf(1.0f - p->depth / v->fog_far, v->fog_min, 1.0f);
    dst[0] = v->width * 0.5f + p->right * k;
    dst[1] = v->height * 0.5f - p->up * k;
    dst[2] = clampf(1.0f - v->near_plane / p->depth, 0.0f, 1.0f);
    dst[3] = p->u;
    dst[4] = p->v;
    dst[5] = p->r * shade;
    dst[6] = p->g * shade;
    dst[7] = p->b * shade;
}

int r2d_re2d_mesh(const R2DRe2dView *v, const float *in, int count,
                  float *out, int out_cap_verts, unsigned flags,
                  R2DRe2dStats *stats)
{
    R2DRe2dStats local;
    R2DRe2dStats *st = stats ? stats : &local;
    memset(st, 0, sizeof *st);
    if (!v || !in || !out || count < 3 || out_cap_verts < 3) return 0;

    int written = 0;
    for (int i = 0; i + 2 < count; i += 3) {
        ++st->tris_in;

        ViewVert tri[3];
        bool finite = true;
        int behind = 0;
        for (int k = 0; k < 3; ++k) {
            const float *s = in + (size_t)(i + k) * 8;
            for (int c = 0; c < 8; ++c) {
                if (!isfinite(s[c])) finite = false;
            }
            if (!finite) break;
            to_view(v, s[0], s[1], s[2], &tri[k]);
            tri[k].u = s[3];
            tri[k].v = s[4];
            tri[k].r = s[5];
            tri[k].g = s[6];
            tri[k].b = s[7];
            if (tri[k].depth < v->near_plane) ++behind;
        }
        if (!finite) { ++st->invalid; continue; }
        if (behind == 3) { ++st->behind; continue; }

        ViewVert poly[4];
        int n = 3;
        if (behind > 0) {
            n = clip_near(tri, 3, v->near_plane, poly);
            ++st->clipped;
            if (n < 3) { ++st->behind; continue; }
        } else {
            memcpy(poly, tri, sizeof tri);
        }

        // Отбраковка по обходу: площадь первой тройки в экранных координатах.
        if (flags & R2D_RE2D_CULL_BACK) {
            float p0[8], p1[8], p2[8];
            emit_vert(v, &poly[0], p0);
            emit_vert(v, &poly[1], p1);
            emit_vert(v, &poly[2], p2);
            const float area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
            if (area <= 0.0f) { ++st->culled; continue; }
        }

        const int tris = n - 2;
        if (written + tris * 3 > out_cap_verts) { ++st->overflow; continue; }
        for (int t = 0; t < tris; ++t) {
            emit_vert(v, &poly[0], out + (size_t)written * 8);
            emit_vert(v, &poly[t + 1], out + (size_t)(written + 1) * 8);
            emit_vert(v, &poly[t + 2], out + (size_t)(written + 2) * 8);
            written += 3;
            ++st->tris_out;
        }
    }
    return written;
}
