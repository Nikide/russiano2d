#include "rotsprite3.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define PI 3.14159265358979323846

static double now_ms(void)
{
    struct timespec ts;
    timespec_get(&ts, TIME_UTC);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1e6;
}

void r2d_rot3_default_light(R3Light *l)
{
    const float key[3] = { -.45f, -.55f, .70f }, fill[3] = { .75f, .15f, .45f };
    float kl = sqrtf(key[0] * key[0] + key[1] * key[1] + key[2] * key[2]), fl = sqrtf(fill[0] * fill[0] + fill[1] * fill[1] + fill[2] * fill[2]);
    for (int i = 0; i < 3; ++i) { l->key_dir[i] = key[i] / kl; l->fill_dir[i] = fill[i] / fl; l->tint[i] = 1; }
    const float kc[3] = { 1.05f, 1.0f, .93f }, fc[3] = { .26f, .32f, .42f }, sk[3] = { .30f, .33f, .40f }, gr[3] = { .10f, .09f, .08f };
    memcpy(l->key_col, kc, sizeof kc);
    memcpy(l->fill_col, fc, sizeof fc);
    memcpy(l->sky, sk, sizeof sk);
    memcpy(l->ground, gr, sizeof gr);
    l->rim = .18f;
    l->spec = 1;
    l->shine = 36;
}

// ---------------------------------------------------------------------------
// Декодирование контейнера
// ---------------------------------------------------------------------------
bool r2d_rot3_header(const uint8_t *px, int w, int h, int stride)
{
    (void)stride;
    if (!px || w < 8 || h < 2) return false;
    return px[0] == 82 && px[1] == 50 && px[2] == 68 && px[3] == 255 && px[4] == 82 && px[5] == 79 && px[6] == 84 && px[7] == 255 &&
           px[8] == 3 && px[9] == 0 && px[10] == 0 && px[11] == 255;
}

static int cmp_float(const void *a, const void *b) { const float x = *(const float *)a, y = *(const float *)b; return x < y ? -1 : x > y; }

static float median_spacing(const R3Level *L, const int *grid)
{
    float samples[4096];
    int ns = 0;
    const int step = L->n > 4096 ? L->n / 4096 : 1;
    for (int y = 0; y < L->h && ns < 4096; ++y) for (int x = 0; x + 1 < L->w && ns < 4096; ++x) {
        const int a = grid[y * L->w + x], b = grid[y * L->w + x + 1];
        if (a < 0 || b < 0 || (a % step)) continue;
        const float *p = L->pos + a * 3, *q = L->pos + b * 3;
        samples[ns++] = sqrtf((p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]) + (p[2] - q[2]) * (p[2] - q[2]));
    }
    if (!ns) return 1;
    qsort(samples, (size_t)ns, sizeof(float), cmp_float);
    const float m = samples[ns / 2];
    return m > 1e-6f ? m : 1e-6f;
}

#define R3_BLOCK 16
static bool build_quads(R3Level *L, const int *grid)
{
    L->spacing = median_spacing(L, grid);
    const float limit = L->spacing * 5.0f, limit2 = limit * limit;
    const int bw = (L->w + R3_BLOCK - 1) / R3_BLOCK, bh = (L->h + R3_BLOCK - 1) / R3_BLOCK;
    L->nblocks = bw * bh;
    L->block = (uint32_t *)calloc((size_t)L->nblocks + 1, sizeof(uint32_t));
    if (!L->block) return false;
    int count = 0;
    for (int pass = 0; pass < 2; ++pass) {
        if (pass) {
            L->quad = (uint32_t *)malloc((size_t)(count ? count : 1) * 16);
            if (!L->quad) return false;
        }
        int q = 0;
        for (int by = 0; by < bh; ++by) for (int bx = 0; bx < bw; ++bx) {
            if (pass) L->block[by * bw + bx] = (uint32_t)q;
            const int ye = by * R3_BLOCK + R3_BLOCK < L->h - 1 ? by * R3_BLOCK + R3_BLOCK : L->h - 1;
            const int xe = bx * R3_BLOCK + R3_BLOCK < L->w - 1 ? bx * R3_BLOCK + R3_BLOCK : L->w - 1;
            for (int y = by * R3_BLOCK; y < ye; ++y) for (int x = bx * R3_BLOCK; x < xe; ++x) {
                const int a = grid[y * L->w + x], b = grid[y * L->w + x + 1], c = grid[(y + 1) * L->w + x], d = grid[(y + 1) * L->w + x + 1];
                if (a < 0 || b < 0 || c < 0 || d < 0) continue;
                const int ids[4] = { a, b, c, d };
                bool ok = true;
                for (int e = 0; e < 4 && ok; ++e) {
                    const int i = ids[e], j = ids[(e == 0 || e == 3) ? 1 : (e == 1 ? 3 : 0)];
                    const float *p = L->pos + i * 3, *r = L->pos + j * 3;
                    const float dx = p[0] - r[0], dy = p[1] - r[1], dz = p[2] - r[2];
                    if (dx * dx + dy * dy + dz * dz > limit2) ok = false;
                }
                if (!ok) continue;
                if (pass) memcpy(L->quad + (size_t)q * 4, ids, 16);
                ++q;
            }
        }
        if (!pass) count = q;
        else { L->nq = q; L->block[L->nblocks] = (uint32_t)q; }
    }
    return true;
}

static void level_free(R3Level *L)
{
    free(L->pos); free(L->nrm); free(L->rgb); free(L->spec); free(L->bone); free(L->wt); free(L->quad); free(L->block);
    memset(L, 0, sizeof *L);
}

void r2d_rot3_free(R3Model *m)
{
    if (!m) return;
    for (int i = 0; i < R3_MAX_LEVELS; ++i) level_free(&m->lv[i]);
    memset(m, 0, sizeof *m);
}

static bool alloc_level(R3Level *L, int n)
{
    L->n = n;
    L->pos = (float *)malloc((size_t)n * 12);
    L->nrm = (int8_t *)malloc((size_t)n * 3);
    L->rgb = (uint8_t *)malloc((size_t)n * 3);
    L->spec = (uint8_t *)malloc((size_t)n);
    L->bone = (uint8_t *)malloc((size_t)n * 4);
    L->wt = (uint8_t *)malloc((size_t)n * 4);
    return L->pos && L->nrm && L->rgb && L->spec && L->bone && L->wt;
}

static void top4(const int *ids, const float *ws, int cnt, uint8_t bone[4], uint8_t wt[4])
{
    memset(bone, 0, 4);
    memset(wt, 0, 4);
    bool taken[16] = { 0 };
    float total = 0;
    int pick[4] = { -1, -1, -1, -1 };
    for (int q = 0; q < 4; ++q) {
        int best = -1;
        for (int j = 0; j < cnt; ++j) if (!taken[j] && (best < 0 || ws[j] > ws[best])) best = j;
        if (best < 0) break;
        taken[best] = true;
        pick[q] = best;
        total += ws[best];
    }
    if (total < 1e-9f) { bone[0] = 1; wt[0] = 255; return; }
    int sum = 0, strongest = 0;
    for (int q = 0; q < 4; ++q) {
        if (pick[q] < 0) continue;
        bone[q] = (uint8_t)ids[pick[q]];
        wt[q] = (uint8_t)fminf(255.0f, ws[pick[q]] / total * 255.0f + .5f);
        sum += wt[q];
        if (wt[q] > wt[strongest]) strongest = q;
    }
    wt[strongest] = (uint8_t)(wt[strongest] + (255 - sum));
}

bool r2d_rot3_decode(const uint8_t *px, int w, int h, int stride, R3Model *out)
{
    if (!out) return false;
    memset(out, 0, sizeof *out);
    if (!r2d_rot3_header(px, w, h, stride)) return false;
    const int W = px[12] << 8 | px[13], H = px[14] << 8 | px[15], cols = px[16], layers = px[17], extent = px[20] << 8 | px[21];
    if (W < 64 || H < 64 || W > 4096 || H > 4096 || cols < 1 || layers < 6 || extent < 16 || extent > 250) return false;
    const int rows = (layers + cols - 1) / cols;
    if (w < cols * W || h < 1 + rows * H) return false;
#define PX(layer, x, y) (px + (size_t)(1 + ((layer) / cols) * H + (y)) * stride + (size_t)(((layer) % cols) * W + (x)) * 4)
    int *grid = (int *)malloc((size_t)W * H * sizeof(int));
    if (!grid) return false;
    int n = 0;
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) grid[y * W + x] = PX(1, x, y)[3] == 255 ? n++ : -1;
    R3Level *L = &out->lv[0];
    L->w = W;
    L->h = H;
    if (!n || !alloc_level(L, n)) { free(grid); r2d_rot3_free(out); return false; }
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
        const int i = grid[y * W + x];
        if (i < 0) continue;
        const uint8_t *hi = PX(1, x, y), *lo = PX(2, x, y), *al = PX(0, x, y), *nm = PX(3, x, y), *bo = PX(4, x, y), *wt = PX(5, x, y);
        for (int c = 0; c < 3; ++c) {
            L->pos[i * 3 + c] = ((hi[c] << 8) | lo[c]) / 256.0f - 128.0f;
            L->rgb[i * 3 + c] = al[c];
            const float v = nm[c] / 255.0f * 2.0f - 1.0f;
            L->nrm[i * 3 + c] = (int8_t)lrintf(fmaxf(-1, fminf(1, v)) * 127.0f);
        }
        L->spec[i] = nm[3];
        int total = 0;
        for (int q = 0; q < 4; ++q) { L->bone[i * 4 + q] = (uint8_t)(bo[q] + 1); L->wt[i * 4 + q] = wt[q]; total += wt[q]; }
        if (!total) { L->bone[i * 4] = 1; L->wt[i * 4] = 255; }
    }
#undef PX
    if (!build_quads(L, grid)) { free(grid); r2d_rot3_free(out); return false; }
    out->levels = 1;
    out->extent = extent;
    out->grid_w = W;
    out->grid_h = H;
    out->vertices = n;
    // пирамида: каждый уровень вдвое грубее, чтобы мелкие спрайты не платили за полную плотность
    int *cur = grid;
    while (out->levels < R3_MAX_LEVELS) {
        const R3Level *s = &out->lv[out->levels - 1];
        R3Level *d = &out->lv[out->levels];
        d->w = s->w / 2;
        d->h = s->h / 2;
        if (d->w < 32 || d->h < 32) break;
        int *ng = (int *)malloc((size_t)d->w * d->h * sizeof(int));
        if (!ng) break;
        int cnt = 0;
        for (int y = 0; y < d->h; ++y) for (int x = 0; x < d->w; ++x) {
            bool any = false;
            for (int k = 0; k < 4 && !any; ++k) any = cur[(y * 2 + (k >> 1)) * s->w + x * 2 + (k & 1)] >= 0;
            ng[y * d->w + x] = any ? cnt++ : -1;
        }
        if (!cnt || !alloc_level(d, cnt)) { free(ng); level_free(d); break; }
        for (int y = 0; y < d->h; ++y) for (int x = 0; x < d->w; ++x) {
            const int di = ng[y * d->w + x];
            if (di < 0) continue;
            float p[3] = { 0, 0, 0 }, nn[3] = { 0, 0, 0 }, c[3] = { 0, 0, 0 }, sp = 0;
            int cntc = 0, ids[16], na = 0;
            float ws[16];
            for (int k = 0; k < 4; ++k) {
                const int si = cur[(y * 2 + (k >> 1)) * s->w + x * 2 + (k & 1)];
                if (si < 0) continue;
                ++cntc;
                for (int t = 0; t < 3; ++t) { p[t] += s->pos[si * 3 + t]; nn[t] += s->nrm[si * 3 + t]; c[t] += s->rgb[si * 3 + t]; }
                sp += s->spec[si];
                for (int q = 0; q < 4; ++q) {
                    if (!s->wt[si * 4 + q]) continue;
                    int slot = -1;
                    for (int j = 0; j < na; ++j) if (ids[j] == s->bone[si * 4 + q]) { slot = j; break; }
                    if (slot < 0 && na < 16) { slot = na++; ids[slot] = s->bone[si * 4 + q]; ws[slot] = 0; }
                    if (slot >= 0) ws[slot] += s->wt[si * 4 + q];
                }
            }
            const float inv = 1.0f / (float)cntc, nl = sqrtf(nn[0] * nn[0] + nn[1] * nn[1] + nn[2] * nn[2]);
            for (int t = 0; t < 3; ++t) {
                d->pos[di * 3 + t] = p[t] * inv;
                d->rgb[di * 3 + t] = (uint8_t)(c[t] * inv + .5f);
                d->nrm[di * 3 + t] = nl > 1e-6f ? (int8_t)lrintf(nn[t] / nl * 127.0f) : 0;
            }
            d->spec[di] = (uint8_t)(sp * inv + .5f);
            top4(ids, ws, na, d->bone + di * 4, d->wt + di * 4);
        }
        if (!build_quads(d, ng)) { free(ng); level_free(d); break; }
        if (cur != grid) free(cur);
        cur = ng;
        ++out->levels;
    }
    if (cur != grid) free(cur);
    free(grid);
    return true;
}

// ---------------------------------------------------------------------------
// Рисование
// ---------------------------------------------------------------------------
typedef struct Frame {
    const R3Model *model;
    const R3Level *lv;
    const R3Light *light;
    R3Work *work;
    const R2DRotRig *rig;
    int M, size, ss;
    double P[256][12];                  // кость → экранная матрица (xy в px внутреннего буфера, z — глубина)
    float Nm[256][9];                   // кость → поворот нормали в пространство вида
    bool hidden[256];
    float key[3], fill[3], half[3];
    int band_h, bands;
    float depth_scale;
    uint8_t *out;
    float *sample_depth;
} Frame;

static void task_transform(void *vctx, int index)
{
    Frame *F = (Frame *)vctx;
    const R3Level *L = F->lv;
    R3Work *W = F->work;
    const int chunk = 8192, i0 = index * chunk, i1 = i0 + chunk < L->n ? i0 + chunk : L->n;
    const float c0 = F->M * .5f;
    for (int i = i0; i < i1; ++i) {
        const uint8_t *b = L->bone + i * 4, *w = L->wt + i * 4;
        const float *p = L->pos + i * 3;
        float sx = 0, sy = 0, sz = 0, nx = 0, ny = 0, nz = 0;
        const float ix = L->nrm[i * 3] / 127.0f, iy = L->nrm[i * 3 + 1] / 127.0f, iz = L->nrm[i * 3 + 2] / 127.0f;
        for (int q = 0; q < 4 && w[q]; ++q) {
            const double *m = F->P[b[q]];
            const float *r = F->Nm[b[q]];
            const float k = w[q] / 255.0f;
            sx += k * (float)(m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3]);
            sy += k * (float)(m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7]);
            sz += k * (float)(m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]);
            nx += k * (r[0] * ix + r[1] * iy + r[2] * iz);
            ny += k * (r[3] * ix + r[4] * iy + r[5] * iz);
            nz += k * (r[6] * ix + r[7] * iy + r[8] * iz);
        }
        const float nl = sqrtf(nx * nx + ny * ny + nz * nz);
        if (nl > 1e-9f) { nx /= nl; ny /= nl; nz /= nl; }
        W->vx[i] = c0 + sx;
        W->vy[i] = c0 + sy;
        W->vz[i] = sz;
        W->vn[i * 3] = nx; W->vn[i * 3 + 1] = ny; W->vn[i * 3 + 2] = nz;
        const float r = L->rgb[i * 3] / 255.0f, g = L->rgb[i * 3 + 1] / 255.0f, bl = L->rgb[i * 3 + 2] / 255.0f;
        W->vc[i * 3] = r * r; W->vc[i * 3 + 1] = g * g; W->vc[i * 3 + 2] = bl * bl;
        W->vs[i] = L->spec[i] / 255.0f;
        W->vhide[i] = F->hidden[b[0]];
    }
}

static inline void shade_pixel(const Frame *F, const float n_in[3], const float col[3], float spec, uint8_t *out)
{
    const R3Light *L = F->light;
    float nx = n_in[0], ny = n_in[1], nz = n_in[2];
    const float nl = sqrtf(nx * nx + ny * ny + nz * nz);
    if (nl > 1e-9f) { const float k = 1.0f / nl; nx *= k; ny *= k; nz *= k; }
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }         // обратная сторона: освещаем как лицевую
    const float hemi = .5f - .5f * ny;                     // ny<0 — нормаль смотрит вверх по экрану
    const float ndl = fmaxf(0.0f, nx * F->key[0] + ny * F->key[1] + nz * F->key[2]);
    const float ndf = fmaxf(0.0f, nx * F->fill[0] + ny * F->fill[1] + nz * F->fill[2]);
    const float rim = L->rim * (1 - nz) * (1 - nz) * (1 - nz);
    float spec_term = 0;
    if (ndl > 0 && spec > 0.02f) {
        const float ndh = nx * F->half[0] + ny * F->half[1] + nz * F->half[2];
        if (ndh > .55f) spec_term = powf(ndh, L->shine) * spec * L->spec;
    }
    for (int c = 0; c < 3; ++c) {
        const float amb = L->ground[c] + (L->sky[c] - L->ground[c]) * hemi;
        float v = col[c] * (amb + L->key_col[c] * ndl + L->fill_col[c] * ndf + rim * L->sky[c]) + spec_term * L->key_col[c] * .55f;
        v *= L->tint[c];
        out[c] = (uint8_t)(sqrtf(fminf(1.0f, fmaxf(0.0f, v))) * 255.0f + .5f);
    }
    out[3] = 255;
}

static void raster_tri(const Frame *F, int y0, int y1, int ia, int ib, int ic)
{
    const R3Work *W = F->work;
    const int M = F->M;
    float ax = W->vx[ia], ay = W->vy[ia], bx = W->vx[ib], by = W->vy[ib], cx = W->vx[ic], cy = W->vy[ic];
    float area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (fabsf(area) < 1e-7f) return;
    if (area < 0) {                                         // единая ориентация
        const int t = ib; ib = ic; ic = t;
        const float tx = bx, ty = by; bx = cx; by = cy; cx = tx; cy = ty;
        area = -area;
    }
    float minx = fminf(ax, fminf(bx, cx)), maxx = fmaxf(ax, fmaxf(bx, cx)), miny = fminf(ay, fminf(by, cy)), maxy = fmaxf(ay, fmaxf(by, cy));
    int x0 = (int)floorf(minx - .5f), x1 = (int)ceilf(maxx - .5f), ty0 = (int)floorf(miny - .5f), ty1 = (int)ceilf(maxy - .5f);
    if (x0 < 0) x0 = 0;
    if (x1 > M - 1) x1 = M - 1;
    if (ty0 < y0) ty0 = y0;
    if (ty1 > y1 - 1) ty1 = y1 - 1;
    if (x0 > x1 || ty0 > ty1) return;
    const float za = W->vz[ia], zb = W->vz[ib], zc = W->vz[ic], inv = 1.0f / area, eps = -area * 2e-5f;
    const float *na = W->vn + ia * 3, *nb = W->vn + ib * 3, *nc = W->vn + ic * 3;
    const float *ca = W->vc + ia * 3, *cb = W->vc + ib * 3, *cc = W->vc + ic * 3;
    for (int y = ty0; y <= ty1; ++y) {
        const float py = y + .5f;
        for (int x = x0; x <= x1; ++x) {
            const float px = x + .5f;
            const float wa = (cx - bx) * (py - by) - (cy - by) * (px - bx);
            const float wb = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
            const float wc = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
            if (wa < eps || wb < eps || wc < eps) continue;
            const float la = wa * inv, lb = wb * inv, lc = wc * inv;
            const float z = la * za + lb * zb + lc * zc;
            const size_t idx = (size_t)y * M + x;
            if (z <= W->depth[idx]) continue;
            W->depth[idx] = z;
            float n[3], col[3];
            for (int k = 0; k < 3; ++k) { n[k] = la * na[k] + lb * nb[k] + lc * nc[k]; col[k] = la * ca[k] + lb * cb[k] + lc * cc[k]; }
            shade_pixel(F, n, col, la * W->vs[ia] + lb * W->vs[ib] + lc * W->vs[ic], W->rgba + idx * 4);
        }
    }
}

static void task_blockbox(void *vctx, int index)
{
    Frame *F = (Frame *)vctx;
    const R3Level *L = F->lv;
    R3Work *W = F->work;
    const int chunk = 128, b0 = index * chunk, b1 = b0 + chunk < L->nblocks ? b0 + chunk : L->nblocks;
    for (int b = b0; b < b1; ++b) {
        float mnx = 1e30f, mny = 1e30f, mxx = -1e30f, mxy = -1e30f;
        for (uint32_t q = L->block[b]; q < L->block[b + 1]; ++q) {
            const uint32_t *v = L->quad + (size_t)q * 4;
            for (int k = 0; k < 4; ++k) {
                const float x = W->vx[v[k]], y = W->vy[v[k]];
                if (x < mnx) mnx = x;
                if (x > mxx) mxx = x;
                if (y < mny) mny = y;
                if (y > mxy) mxy = y;
            }
        }
        float *bb = W->bb + b * 4;
        bb[0] = mnx; bb[1] = mny; bb[2] = mxx; bb[3] = mxy;
    }
}

static void task_raster(void *vctx, int index)
{
    Frame *F = (Frame *)vctx;
    const R3Level *L = F->lv;
    const R3Work *W = F->work;
    const int y0 = index * F->band_h, y1 = y0 + F->band_h < F->M ? y0 + F->band_h : F->M;
    for (int b = 0; b < L->nblocks; ++b) {
        const float *bb = W->bb + b * 4;
        if (bb[3] + .5f < y0 || bb[1] - .5f > y1 || bb[2] < -1 || bb[0] > F->M + 1) continue;
        for (uint32_t q = L->block[b]; q < L->block[b + 1]; ++q) {
            const uint32_t *v = L->quad + (size_t)q * 4;
            const float ya = W->vy[v[0]], yb = W->vy[v[1]], yc = W->vy[v[2]], yd = W->vy[v[3]];
            const float mn = fminf(fminf(ya, yb), fminf(yc, yd)), mx = fmaxf(fmaxf(ya, yb), fmaxf(yc, yd));
            if (mx + .5f < y0 || mn - .5f > y1) continue;
            if (W->vhide[v[0]] || W->vhide[v[1]] || W->vhide[v[2]] || W->vhide[v[3]]) continue;
            raster_tri(F, y0, y1, (int)v[0], (int)v[1], (int)v[2]);
            raster_tri(F, y0, y1, (int)v[1], (int)v[3], (int)v[2]);
        }
    }
}

static void task_resolve(void *vctx, int index)
{
    Frame *F = (Frame *)vctx;
    R3Work *W = F->work;
    const int size = F->size, ss = F->ss, M = F->M;
    const int rows = (size + F->bands - 1) / F->bands, y0 = index * rows, y1 = y0 + rows < size ? y0 + rows : size;
    for (int y = y0; y < y1; ++y) for (int x = 0; x < size; ++x) {
        unsigned sum[3] = { 0, 0, 0 }, alpha = 0;
        float nearest = -1e30f;
        for (int dy = 0; dy < ss; ++dy) for (int dx = 0; dx < ss; ++dx) {
            const size_t i = (size_t)(y * ss + dy) * M + x * ss + dx;
            const uint8_t *p = W->rgba + i * 4;
            if (!p[3]) continue;
            alpha += 255;
            for (int c = 0; c < 3; ++c) sum[c] += p[c];
            if (W->depth[i] > nearest) nearest = W->depth[i];
        }
        uint8_t *o = F->out + ((size_t)y * size + x) * 4;
        if (alpha) {
            const unsigned cnt = alpha / 255;
            for (int c = 0; c < 3; ++c) o[c] = (uint8_t)((sum[c] + cnt / 2) / cnt);
            o[3] = (uint8_t)(alpha / (ss * ss));
            F->sample_depth[(size_t)y * size + x] = nearest * F->depth_scale;
        } else {
            o[0] = o[1] = o[2] = o[3] = 0;
            F->sample_depth[(size_t)y * size + x] = 0;
        }
    }
}

static void run_parallel(R3Work *w, R3Task task, Frame *F, int count)
{
    if (w->parallel && count > 1) w->parallel(task, F, count);
    else for (int i = 0; i < count; ++i) task(F, i);
}

void r2d_rot3_work_free(R3Work *w)
{
    if (!w) return;
    free(w->depth); free(w->rgba); free(w->vx); free(w->vy); free(w->vz); free(w->vn); free(w->vc); free(w->vs); free(w->vhide); free(w->bb);
    R3Parallel keep = w->parallel;
    const float detail = w->detail;
    memset(w, 0, sizeof *w);
    w->parallel = keep;
    w->detail = detail;
}

static bool ensure_work(R3Work *w, int size, int ss, int nvert, int nblocks)
{
    const int M = size * ss;
    if (!w->depth || w->size != size || w->ss != ss) {
        free(w->depth); free(w->rgba);
        w->depth = (float *)malloc((size_t)M * M * sizeof(float));
        w->rgba = (uint8_t *)calloc((size_t)M * M, 4);
        if (!w->depth || !w->rgba) return false;
        for (size_t i = 0; i < (size_t)M * M; ++i) w->depth[i] = -1e30f;
        w->size = size;
        w->ss = ss;
        w->bounds[0] = w->bounds[1] = M;
        w->bounds[2] = w->bounds[3] = 0;
    }
    if (nvert > w->cap_vertices) {
        free(w->vx); free(w->vy); free(w->vz); free(w->vn); free(w->vc); free(w->vs); free(w->vhide);
        w->vx = (float *)malloc((size_t)nvert * 4); w->vy = (float *)malloc((size_t)nvert * 4); w->vz = (float *)malloc((size_t)nvert * 4);
        w->vn = (float *)malloc((size_t)nvert * 12); w->vc = (float *)malloc((size_t)nvert * 12); w->vs = (float *)malloc((size_t)nvert * 4);
        w->vhide = (uint8_t *)malloc((size_t)nvert);
        w->cap_vertices = nvert;
        if (!w->vx || !w->vy || !w->vz || !w->vn || !w->vc || !w->vs || !w->vhide) { w->cap_vertices = 0; return false; }
    }
    if (nblocks > w->cap_blocks) {
        free(w->bb);
        w->bb = (float *)malloc((size_t)nblocks * 16);
        if (!w->bb) { w->cap_blocks = 0; return false; }
        w->cap_blocks = nblocks;
    }
    return true;
}

bool r2d_rot3_draw(const R3Model *m, double yaw, double pitch, const R2DRotRig *rig, const R3Light *light,
                   int size, R3Work *work, uint8_t *out, float *sample_depth)
{
    if (!m || !m->levels || !work || !out || !sample_depth || size < 64 || size > 2048 || !r2d_rotsprite_angles(yaw, pitch, &yaw, &pitch)) return false;
    R3Light default_light;
    if (!light) { r2d_rot3_default_light(&default_light); light = &default_light; }
    const int ss = size <= 1024 ? 2 : 1, M = size * ss;
    const double mscale = rig && rig->model ? rig->model->scale : 1.0;
    const double ppu = (double)M * mscale / m->extent;
    // уровень детализации: тексель не мельче ~0.8 внутреннего пикселя
    int level = 0;
    const double detail = work->detail > 0 ? work->detail : 1.25;
    while (level + 1 < m->levels && m->lv[level + 1].spacing * ppu / ss <= detail) ++level;
    const R3Level *L = &m->lv[level];
    // область, грязная после прошлого кадра
    if (work->depth && work->size == size && work->ss == ss) {
        const int *b = work->bounds;
        for (int y = b[1]; y < b[3]; ++y) {
            for (int x = b[0]; x < b[2]; ++x) work->depth[(size_t)y * M + x] = -1e30f;
            memset(work->rgba + ((size_t)y * M + b[0]) * 4, 0, (size_t)(b[2] - b[0]) * 4);
        }
    }
    if (!ensure_work(work, size, ss, L->n, L->nblocks)) return false;
    static Frame F_storage;       // не потокобезопасно: синтез спрайтов идёт в главном потоке
    Frame *F = &F_storage;
    memset(F, 0, sizeof *F);
    F->model = m; F->lv = L; F->light = light; F->work = work; F->rig = rig; F->M = M; F->size = size; F->ss = ss;
    F->out = out; F->sample_depth = sample_depth;
    F->depth_scale = (float)(mscale / m->extent);
    // матрицы костей: поворот вида · часть, масштаб проекции — в xy
    const double cy = cos(yaw * PI / 180), sy = sin(yaw * PI / 180), cp = cos(pitch * PI / 180), sp = sin(pitch * PI / 180);
    const double V[3][3] = { { cy, 0, sy }, { sp * sy, cp, -sp * cy }, { -cp * sy, sp, cp * cy } };
    for (int id = 1; id < 256; ++id) {
        double a[12] = { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0 };
        bool visible = true;
        if (rig && rig->model && id < 255) {
            const R2DRotPartPose *part = &rig->model->parts[id];
            if (part->defined) memcpy(a, part->matrix, sizeof a);
            if (part->defined && !part->visible) visible = false;
        }
        F->hidden[id] = !visible;
        for (int i = 0; i < 3; ++i) for (int j = 0; j < 4; ++j) {
            double v = 0;
            for (int k = 0; k < 3; ++k) v += V[i][k] * a[k * 4 + j];
            F->P[id][i * 4 + j] = i < 2 ? v * ppu : v;
        }
        for (int i = 0; i < 3; ++i) for (int j = 0; j < 3; ++j) {
            double v = 0;
            for (int k = 0; k < 3; ++k) v += V[i][k] * a[k * 4 + j];
            F->Nm[id][i * 3 + j] = (float)v;
        }
    }
    for (int i = 0; i < 3; ++i) { F->key[i] = light->key_dir[i]; F->fill[i] = light->fill_dir[i]; }
    for (int i = 0; i < 3; ++i) F->half[i] = F->key[i] + (i == 2 ? 1.0f : 0.0f);
    {
        const float hl = sqrtf(F->half[0] * F->half[0] + F->half[1] * F->half[1] + F->half[2] * F->half[2]);
        for (int i = 0; i < 3; ++i) F->half[i] /= hl > 1e-9f ? hl : 1;
    }
    F->bands = M >= 512 ? 32 : 8;
    F->band_h = (M + F->bands - 1) / F->bands;
    double t0 = now_ms();
    run_parallel(work, task_transform, F, (L->n + 8191) / 8192);
    // габарит
    int bx0 = M, by0 = M, bx1 = 0, by1 = 0;
    for (int i = 0; i < L->n; ++i) {
        if (work->vhide[i]) continue;
        const int x = (int)work->vx[i], y = (int)work->vy[i];
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
    }
    bx0 = bx0 - 2 < 0 ? 0 : bx0 - 2; by0 = by0 - 2 < 0 ? 0 : by0 - 2;
    bx1 = bx1 + 3 > M ? M : bx1 + 3; by1 = by1 + 3 > M ? M : by1 + 3;
    work->bounds[0] = bx0; work->bounds[1] = by0; work->bounds[2] = bx1 > bx0 ? bx1 : bx0; work->bounds[3] = by1 > by0 ? by1 : by0;
    run_parallel(work, task_blockbox, F, (L->nblocks + 127) / 128);
    double t1 = now_ms();
    run_parallel(work, task_raster, F, F->bands);
    double t2 = now_ms();
    F->bands = size >= 256 ? 16 : 4;
    run_parallel(work, task_resolve, F, F->bands);
    // продолжить цвет под прозрачными соседями: без тёмной каймы при линейной фильтрации
    {
        uint8_t *tmp = (uint8_t *)malloc((size_t)size * size * 4);
        if (tmp) {
            memcpy(tmp, out, (size_t)size * size * 4);
            const int ex0 = bx0 / ss > 0 ? bx0 / ss - 1 : 0, ey0 = by0 / ss > 0 ? by0 / ss - 1 : 0;
            const int ex1 = bx1 / ss + 1 < size ? bx1 / ss + 1 : size, ey1 = by1 / ss + 1 < size ? by1 / ss + 1 : size;
            for (int y = ey0; y < ey1; ++y) for (int x = ex0; x < ex1; ++x) {
                uint8_t *p = out + ((size_t)y * size + x) * 4;
                if (p[3]) continue;
                const uint8_t *best = NULL;
                for (int dy = -1; dy <= 1; ++dy) for (int dx = -1; dx <= 1; ++dx) {
                    const int sx = x + dx, sy2 = y + dy;
                    if (sx < 0 || sy2 < 0 || sx >= size || sy2 >= size) continue;
                    const uint8_t *q = tmp + ((size_t)sy2 * size + sx) * 4;
                    if (q[3] && (!best || q[3] > best[3])) best = q;
                }
                if (best) memcpy(p, best, 3);
            }
            free(tmp);
        }
    }
    double t3 = now_ms();
    work->last_level = level;
    work->last_ms[0] = t1 - t0;
    work->last_ms[1] = t2 - t1;
    work->last_ms[2] = t3 - t2;
    return true;
}
