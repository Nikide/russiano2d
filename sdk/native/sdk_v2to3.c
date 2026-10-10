// r2d-sdk convert-re2d3: Re2DSprite v2 (карты 256×192 + атлас 4096) → плотный v3 (docs/RE2DSPRITE_V3.md).
//
// v2 хранит поверхность редкой сеткой управляющих точек (одна на блок 4×4 рабочей сетки 1024) и цвет в атласе.
// Конвертер берёт ту же геометрию, но каждую ячейку между четырьмя соседними точками дробит на d×d текселей:
// позиция — билинейно по четырём углам, кости — билинейно по частям углов (с учётом второй кости BLD),
// цвет — прямо из атласа (без кэша 5×5), нормали — по градиенту позиций. Развёртка и рисунок остаются авторскими.
#include "sdk.h"
#include "sdk_bake.h"
#include "rotsprite_math.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define V2_COLS 3
#define V2_LAYERS 6

typedef struct V3Out {
    int W, H;
    float *pos;          // 3 на тексель
    float *nrm;
    uint8_t *rgb;        // 4 на тексель (a=255 — тексель есть)
    uint8_t *bone, *wt;  // 4 на тексель
} V3Out;

static uint16_t enc16_v(float v)
{
    const float q = (v + 128.0f) * 256.0f;
    return (uint16_t)fminf(65535.0f, fmaxf(0.0f, q + .5f));
}

static bool write_v3(const V3Out *o, int extent, const char *path)
{
    const int W = o->W, H = o->H, PW = W * V2_COLS, PH = 1 + ((V2_LAYERS + V2_COLS - 1) / V2_COLS) * H;
    uint8_t *png = (uint8_t *)calloc((size_t)PW * PH, 4);
    if (!png) return false;
    const uint8_t head[7][4] = { { 82, 50, 68, 255 }, { 82, 79, 84, 255 }, { 3, 0, 0, 255 },
                                 { (uint8_t)(W >> 8), (uint8_t)W, (uint8_t)(H >> 8), (uint8_t)H },
                                 { V2_COLS, V2_LAYERS, 0, 0 }, { (uint8_t)(extent >> 8), (uint8_t)extent, 0, 0 }, { 0, 0, 0, 0 } };
    memcpy(png, head, sizeof head);
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
        const size_t i = (size_t)y * W + x;
        if (o->rgb[i * 4 + 3] != 255) continue;
        uint8_t *px[V2_LAYERS];
        for (int l = 0; l < V2_LAYERS; ++l) px[l] = png + ((size_t)(1 + (l / V2_COLS) * H + y) * PW + (l % V2_COLS) * W + x) * 4;
        memcpy(px[0], o->rgb + i * 4, 4);
        for (int c = 0; c < 3; ++c) {
            const uint16_t q = enc16_v(o->pos[i * 3 + c]);
            px[1][c] = (uint8_t)(q >> 8);
            px[2][c] = (uint8_t)q;
            px[3][c] = (uint8_t)fminf(255, fmaxf(0, (o->nrm[i * 3 + c] * .5f + .5f) * 255 + .5f));
        }
        px[1][3] = px[2][3] = 255;
        px[3][3] = 0;                     // блеск: у anime-материалов его нет
        memcpy(px[4], o->bone + i * 4, 4);
        memcpy(px[5], o->wt + i * 4, 4);
    }
    const bool ok = sdk_image_write_png(path, png, PW, PH);
    free(png);
    return ok;
}

static void add_weight(int *ids, float *ws, int *n, int id, float w)
{
    if (id <= 0 || w <= 0) return;
    for (int i = 0; i < *n; ++i) if (ids[i] == id) { ws[i] += w; return; }
    if (*n < 16) { ids[*n] = id; ws[*n] = w; ++*n; }
}

static void store_bones(V3Out *o, size_t i, int *ids, float *ws, int n)
{
    int pick[4] = { -1, -1, -1, -1 };
    for (int q = 0; q < 4; ++q) {
        float best = 0;
        for (int j = 0; j < n; ++j) {
            bool taken = false;
            for (int t = 0; t < q; ++t) taken |= pick[t] == j;
            if (!taken && ws[j] > best) { best = ws[j]; pick[q] = j; }
        }
    }
    float total = 0;
    for (int q = 0; q < 4; ++q) if (pick[q] >= 0) total += ws[pick[q]];
    if (total <= 0) return;
    int sum = 0, first = -1;
    for (int q = 0; q < 4; ++q) {
        if (pick[q] < 0) continue;
        const int w = (int)lrintf(ws[pick[q]] / total * 255.0f);
        o->bone[i * 4 + q] = (uint8_t)(ids[pick[q]] - 1);
        o->wt[i * 4 + q] = (uint8_t)w;
        sum += w;
        if (first < 0) first = q;
    }
    o->wt[i * 4 + first] = (uint8_t)(o->wt[i * 4 + first] + (255 - sum));
}

// Цвет блока атласа: среднее по непрозрачным пикселям. false — блок пуст.
static bool atlas_color(const uint8_t *a, int stride, int x0, int y0, int span, uint8_t out[4])
{
    int sum[3] = { 0 }, n = 0;
    for (int yy = 0; yy < span; ++yy) for (int xx = 0; xx < span; ++xx) {
        const uint8_t *c = a + (size_t)(y0 + yy) * stride + (size_t)(x0 + xx) * 4;
        if (c[3] != 255) continue;
        for (int j = 0; j < 3; ++j) sum[j] += c[j];
        ++n;
    }
    if (!n) return false;
    for (int j = 0; j < 3; ++j) out[j] = (uint8_t)((sum[j] + n / 2) / n);
    out[3] = 255;
    return true;
}

static void compute_normals(V3Out *o, float max_edge)
{
    const int W = o->W, H = o->H;
    const size_t N = (size_t)W * H;
    float *raw = (float *)calloc(N * 3, sizeof(float));
    if (!raw) return;
#define OK(x, y) ((x) >= 0 && (y) >= 0 && (x) < W && (y) < H && o->rgb[((size_t)(y) * W + (x)) * 4 + 3] == 255)
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
        if (!OK(x, y)) continue;
        const float *p = o->pos + ((size_t)y * W + x) * 3;
        float dx[3] = { 0, 0, 0 }, dy[3] = { 0, 0, 0 };
        bool hx = false, hy = false;
        for (int s = -1; s <= 1; s += 2) {
            if (OK(x + s, y)) {
                const float *q = o->pos + ((size_t)y * W + x + s) * 3;
                const float d = hypotf(hypotf(q[0] - p[0], q[1] - p[1]), q[2] - p[2]);
                if (d < max_edge) { for (int c = 0; c < 3; ++c) dx[c] += s * (q[c] - p[c]); hx = true; }
            }
            if (OK(x, y + s)) {
                const float *q = o->pos + ((size_t)(y + s) * W + x) * 3;
                const float d = hypotf(hypotf(q[0] - p[0], q[1] - p[1]), q[2] - p[2]);
                if (d < max_edge) { for (int c = 0; c < 3; ++c) dy[c] += s * (q[c] - p[c]); hy = true; }
            }
        }
        float n[3] = { dx[1] * dy[2] - dx[2] * dy[1], dx[2] * dy[0] - dx[0] * dy[2], dx[0] * dy[1] - dx[1] * dy[0] };
        const float l = sqrtf(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
        if (!hx || !hy || l < 1e-9f) { n[0] = 0; n[1] = 0; n[2] = 1; }
        else for (int c = 0; c < 3; ++c) n[c] /= l;
        memcpy(raw + ((size_t)y * W + x) * 3, n, sizeof n);
    }
    // сглаживание: два прохода 3×3 по соседям с похожей нормалью и близкой позицией
    float *tmp = (float *)malloc(N * 3 * sizeof(float));
    for (int pass = 0; pass < 2 && tmp; ++pass) {
        for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
            if (!OK(x, y)) continue;
            const size_t i = (size_t)y * W + x;
            float acc[3] = { 0, 0, 0 };
            for (int j = -1; j <= 1; ++j) for (int k = -1; k <= 1; ++k) {
                if (!OK(x + k, y + j)) continue;
                const size_t t = (size_t)(y + j) * W + x + k;
                const float *q = o->pos + t * 3, *p = o->pos + i * 3;
                if (hypotf(hypotf(q[0] - p[0], q[1] - p[1]), q[2] - p[2]) > max_edge * 2) continue;
                const float *nn = raw + t * 3, *n0 = raw + i * 3;
                if (nn[0] * n0[0] + nn[1] * n0[1] + nn[2] * n0[2] < .3f) continue;
                for (int c = 0; c < 3; ++c) acc[c] += nn[c];
            }
            const float l = sqrtf(acc[0] * acc[0] + acc[1] * acc[1] + acc[2] * acc[2]);
            for (int c = 0; c < 3; ++c) tmp[i * 3 + c] = l > 1e-9f ? acc[c] / l : raw[i * 3 + c];
        }
        memcpy(raw, tmp, N * 3 * sizeof(float));
    }
    free(tmp);
    memcpy(o->nrm, raw, N * 3 * sizeof(float));
#undef OK
    free(raw);
}

static bool convert(const char *src, const char *character, const char *out_dir, const char *name, int d, int raster, SdkReport *rep, R2dSb *report)
{
    int w = 0, h = 0;
    uint8_t *a = sdk_image_load_rgba(src, &w, &h);
    if (!a) { sdk_diag(rep, SDK_ERROR, "SDK_BAKE_FORMAT", src, NULL, NULL, "PNG не прочитан"); return false; }
    const int stride = w * 4;
    R2DRotAtlas base = { 0 };
    if (w != h || w % 1024 || !r2d_rotsprite_v2_decode(a, w, h, stride, &base)) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_FORMAT", src, NULL, NULL, "Это не Re2DSprite v2 (нужен квадрат 1024·k с заголовком R2D/ROT/v2)");
        sdk_image_free(a);
        return false;
    }
    const int k = w / 1024, cell = 4 * k;
    int *grid = (int *)malloc(256 * 192 * sizeof(int));
    V3Out o = { 256 * d, 192 * d, 0, 0, 0, 0, 0 };
    const size_t N = (size_t)o.W * o.H;
    o.pos = (float *)calloc(N * 3, sizeof(float));
    o.nrm = (float *)calloc(N * 3, sizeof(float));
    o.rgb = (uint8_t *)calloc(N * 4, 1);
    o.bone = (uint8_t *)calloc(N * 4, 1);
    o.wt = (uint8_t *)calloc(N * 4, 1);
    if (!grid || !o.pos || !o.nrm || !o.rgb || !o.bone || !o.wt) { sdk_diag(rep, SDK_ERROR, "SDK_BAKE_WRITE_FAILED", src, NULL, NULL, "Нет памяти"); return false; }
    int n = 0;
    for (int y = 0; y < 192; ++y) for (int x = 0; x < 256; ++x) {
        const uint8_t *id = a + (size_t)(768 + y) * k * stride + (size_t)x * k * 4;
        grid[y * 256 + x] = (id[512 * k * 4] && id[512 * k * 4 + 3]) ? n++ : -1;
    }
    const int span = cell / d > 0 ? cell / d : 1;
    long texels = 0, cells = 0;
    for (int y = 0; y < 192; ++y) for (int x = 0; x < 256; ++x) {
        const int gi = grid[y * 256 + x];
        if (gi < 0) continue;
        const R2DRotPoint *p = &base.points[gi];
        const int right = x < 255 ? grid[y * 256 + x + 1] : -1, down = y < 191 ? grid[(y + 1) * 256 + x] : -1,
                  diag = x < 255 && y < 191 ? grid[(y + 1) * 256 + x + 1] : -1;
        bool continuous = right >= 0 && down >= 0 && diag >= 0;
        const int idx[4] = { gi, right, down, diag };
        if (continuous) for (int j = 1; j < 4; ++j) {
            const R2DRotPoint *q = &base.points[idx[j]];
            if (p->group != q->group || fabsf(q->x - p->x) > 3 || fabsf(q->y - p->y) > 3 || fabsf(q->z - p->z) > 3) continuous = false;
        }
        bool ribbon = false;
        if (!continuous && p->part >= 32 && right >= 0) {
            const R2DRotPoint *r = &base.points[right];
            ribbon = r->part == p->part && fabsf(r->x - p->x) < 3 && fabsf(r->y - p->y) < 1 && fabsf(r->z - p->z) < 3;
        }
        if (!continuous && !ribbon) continue;
        ++cells;
        for (int ty = 0; ty < d; ++ty) for (int tx = 0; tx < d; ++tx) {
            uint8_t col[4];
            if (!atlas_color(a, stride, x * cell + tx * span, y * cell + ty * span, span, col)) continue;
            const float u = (tx + .5f) / d, v = (ty + .5f) / d;
            const size_t i = (size_t)(y * d + ty) * o.W + x * d + tx;
            int ids[16];
            float ws[16];
            int nid = 0;
            if (continuous) {
                const float bw[4] = { (1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v };
                for (int j = 0; j < 4; ++j) {
                    const R2DRotPoint *q = &base.points[idx[j]];
                    o.pos[i * 3] += q->x * bw[j];
                    o.pos[i * 3 + 1] += q->y * bw[j];
                    o.pos[i * 3 + 2] += q->z * bw[j];
                    const float bl = q->blend_part && q->blend_weight ? q->blend_weight / 255.0f : 0;
                    add_weight(ids, ws, &nid, q->part, bw[j] * (1 - bl));
                    add_weight(ids, ws, &nid, q->blend_part, bw[j] * bl);
                }
            } else {
                const R2DRotPoint *r = &base.points[right];
                o.pos[i * 3] = p->x + (r->x - p->x) * u;
                o.pos[i * 3 + 1] = p->y + (r->y - p->y) * u + .24f * (v - .5f);
                o.pos[i * 3 + 2] = p->z + (r->z - p->z) * u;
                add_weight(ids, ws, &nid, p->part, 1);
            }
            memcpy(o.rgb + i * 4, col, 4);
            store_bones(&o, i, ids, ws, nid);
            ++texels;
        }
    }
    if (!texels) {
        sdk_diag(rep, SDK_ERROR, "SDK_BAKE_NO_MESH", src, NULL, NULL, "Нет ни одной непрерывной ячейки поверхности");
        return false;
    }
    compute_normals(&o, 1.0f * 8.0f / d + 1.0f);
    char path[1100], base_path[1100];
    sdk_join(out_dir, name, base_path, sizeof base_path);
    snprintf(path, sizeof path, "%s.png", base_path);
    bool ok = write_v3(&o, 128, path);
    if (!ok) sdk_diag(rep, SDK_ERROR, "SDK_BAKE_WRITE_FAILED", path, NULL, NULL, "Не удалось записать PNG");
    char json_path[1100] = "";
    if (ok && character) {
        size_t sz = 0;
        char *text = sdk_read_file(character, &sz);
        char err[200];
        R2dJson *root = text ? r2d_json_parse(text, err, sizeof err) : NULL;
        if (!root) { sdk_diag(rep, SDK_ERROR, "SDK_BAKE_FORMAT", character, NULL, NULL, "character.json не разобран"); ok = false; }
        else {
            // тот же JSON, но атлас — v3; сменные варианты (hair/costume) остаются только у v2
            R2dSb sb;
            r2d_sb_init(&sb);
            r2d_sb_putc(&sb, '{');
            bool first = true;
            for (int i = 0; i < root->count; ++i) {
                if (!strcmp(root->keys[i], "variants") || !strcmp(root->keys[i], "projection")) continue;
                if (!first) r2d_sb_puts(&sb, ", ");
                first = false;
                r2d_sb_put_json_string(&sb, root->keys[i]);
                r2d_sb_puts(&sb, ": ");
                if (!strcmp(root->keys[i], "atlas")) {
                    char rel[300];
                    snprintf(rel, sizeof rel, "%s.png", name);
                    r2d_sb_put_json_string(&sb, rel);
                } else sdk_json_put_compact(&sb, root->items[i]);
            }
            // проекция: поля исходника + размер синтеза v3
            const R2dJson *proj = r2d_json_get(root, "projection");
            r2d_sb_printf(&sb, "%s\"projection\": {", first ? "" : ", ");
            bool pfirst = true;
            for (int i = 0; proj && proj->type == R2D_JSON_OBJ && i < proj->count; ++i) {
                if (raster && !strcmp(proj->keys[i], "raster")) continue;
                if (!pfirst) r2d_sb_puts(&sb, ", ");
                pfirst = false;
                r2d_sb_put_json_string(&sb, proj->keys[i]);
                r2d_sb_puts(&sb, ": ");
                sdk_json_put_compact(&sb, proj->items[i]);
            }
            if (raster) r2d_sb_printf(&sb, "%s\"raster\": %d", pfirst ? "" : ", ", raster);
            r2d_sb_puts(&sb, "}}\n");
            snprintf(json_path, sizeof json_path, "%s.character.json", base_path);
            ok = sdk_write_file(json_path, sb.data, sb.len);
            if (!ok) sdk_diag(rep, SDK_ERROR, "SDK_BAKE_WRITE_FAILED", json_path, NULL, NULL, "Не удалось записать character.json");
            r2d_sb_free(&sb);
            r2d_json_free(root);
        }
        free(text);
    }
    r2d_sb_printf(report, "{\"success\":%s,\"ok\":%s,\"format\":\"v3\",\"from\":\"v2\",\"grid\":[%d,%d],\"density\":%d,\"cells\":%ld,\"texels\":%ld,\"files\":{\"png\":", ok ? "true" : "false", ok ? "true" : "false", o.W, o.H, d, cells, texels);
    r2d_sb_put_json_string(report, path);
    r2d_sb_puts(report, ",\"character\":");
    r2d_sb_put_json_string(report, json_path);
    r2d_sb_puts(report, "}}\n");
    free(grid); free(o.pos); free(o.nrm); free(o.rgb); free(o.bone); free(o.wt);
    r2d_rotsprite_v2_free(&base);
    sdk_image_free(a);
    return ok;
}

int sdk_cmd_convert_re2d3(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *source = sdk_arg_positional(a, 0);
    if (!source) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d-sdk convert-re2d3 <v2.png> --output <каталог> [--name имя] [--character файл.character.json] [--density 2..12] [--raster 128..2048]");
        sdk_report_free(&rep);
        return rc;
    }
    const char *out_dir = sdk_arg_value(a, "--output"), *name = sdk_arg_value(a, "--name"), *v;
    char dir_buf[1024], nm[128];
    if (!out_dir) { sdk_dirname(source, dir_buf, sizeof dir_buf); out_dir = dir_buf; }
    if (!name) {
        snprintf(nm, sizeof nm, "%s", sdk_basename(source));
        char *dot = strrchr(nm, '.');
        if (dot) *dot = 0;
        name = nm;
    }
    int d = 8, raster = 0;
    if ((v = sdk_arg_value(a, "--density"))) d = atoi(v);
    if ((v = sdk_arg_value(a, "--raster"))) raster = atoi(v);
    if (d < 2 || d > 12 || (raster && (raster < 128 || raster > 2048))) {
        const int rc = sdk_fail(&rep, "SDK_BAKE_OPTIONS", "--density: 2..12 текселей на ячейку управляющей сетки; --raster: 128..2048");
        sdk_report_free(&rep);
        return rc;
    }
    R2dSb report;
    r2d_sb_init(&report);
    const bool ok = convert(source, sdk_arg_value(a, "--character"), out_dir, name, d, raster, &rep, &report);
    if (!report.len) {
        sdk_report_free(&rep);
        return 1;
    }
    fputs(report.data, stdout);
    fflush(stdout);
    r2d_sb_free(&report);
    sdk_report_free(&rep);
    return ok ? 0 : 1;
}
