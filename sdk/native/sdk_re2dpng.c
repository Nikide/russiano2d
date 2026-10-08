// ===========================================================================
// PNG v2 Re2DSprite: чтение карт поверхности, статистика, отладочные виды.
// Раскладка — docs/RE2DSPRITE_V2.md и RE2DSPRITE_MATH.md §2:
//
//   ID (0,768)  глубина (256,768)  покрытие (512,768)  XY (768,768)  — по 256×192
//   заголовок (0..4, 960): R2D / ROT / v2, SUB, BLD
//
// Все адреса — рабочей сетки 1024×1024, умножаются на k = размер/1024.
// ===========================================================================
#include "sdk_re2d.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SEAM_DELTA 6.0f        // скачок координат между соседями одной части (единицы модели)

static const char *const k_mode_names[RE2D_MODE_COUNT] = {
    "material", "part", "owner", "x", "y", "z", "coverage", "group", "overlap",
};

const char *re2d_mode_name(int mode)
{
    return mode >= 0 && mode < RE2D_MODE_COUNT ? k_mode_names[mode] : "?";
}

int re2d_mode_from_name(const char *name)
{
    for (int i = 0; i < RE2D_MODE_COUNT; ++i) if (strcmp(name, k_mode_names[i]) == 0) return i;
    return -1;
}

// ---------------------------------------------------------------------------
// Открытие и доступ
// ---------------------------------------------------------------------------
static const uint8_t *cell(const Re2dPng *p, int bx, int by)
{
    return p->px + ((size_t)by * (size_t)p->k * (size_t)p->w + (size_t)bx * (size_t)p->k) * 4;
}

static bool rgba_is(const uint8_t *p, int r, int g, int b, int a)
{
    return p[0] == r && p[1] == g && p[2] == b && p[3] == a;
}

bool re2d_png_open(const char *path, Re2dPng *png)
{
    memset(png, 0, sizeof *png);
    png->px = sdk_image_load_rgba(path, &png->w, &png->h);
    if (!png->px) return false;
    png->size_ok = png->w == png->h && (png->w == 1024 || png->w == 2048 || png->w == 3072 || png->w == 4096);
    png->k = png->size_ok ? png->w / 1024 : 0;
    if (png->size_ok) {
        png->header_ok = rgba_is(cell(png, 0, 960), 82, 50, 68, 255) && rgba_is(cell(png, 1, 960), 82, 79, 84, 255) &&
                         rgba_is(cell(png, 2, 960), 2, 4, 4, 255);
        png->sub = rgba_is(cell(png, 3, 960), 83, 85, 66, 255);
        png->bld = rgba_is(cell(png, 4, 960), 66, 76, 68, 255);
    }
    return true;
}

void re2d_png_close(Re2dPng *png)
{
    sdk_image_free(png->px);
    memset(png, 0, sizeof *png);
}

void re2d_sample(const Re2dPng *png, int mx, int my, Re2dSample *s)
{
    memset(s, 0, sizeof *s);
    s->mx = mx;
    s->my = my;
    if (!png->size_ok || mx < 0 || my < 0 || mx >= RE2D_MAP_W || my >= RE2D_MAP_H) return;
    const uint8_t *id = cell(png, 0 + mx, 768 + my);
    const uint8_t *dp = cell(png, 256 + mx, 768 + my);
    const uint8_t *cv = cell(png, 512 + mx, 768 + my);
    const uint8_t *xy = cell(png, 768 + mx, 768 + my);
    s->id = id[0];
    s->group = png->sub ? id[1] : 0;
    s->id2 = png->bld ? id[2] : 0;
    s->coverage = cv[0];
    s->alpha_ok = id[3] == 255 && dp[3] == 255 && cv[3] == 255 && xy[3] == 255;
    s->x = (xy[0] - 128) / 4.0f + (png->sub ? (xy[2] >> 4) / 64.0f : 0.0f);
    s->y = (xy[1] - 128) / 2.0f + (png->sub ? (xy[2] & 15) / 32.0f : 0.0f);
    s->z = (dp[0] - 128) / 4.0f + (png->sub ? (dp[1] / 17) / 64.0f : 0.0f);

    // Цвет — среднее непрозрачных texel блока 4×4 рабочей сетки.
    const int block = 4 * png->k;
    long r = 0, g = 0, b = 0, n = 0;
    for (int y = 0; y < block; ++y) {
        const uint8_t *row = png->px + ((size_t)(my * block + y) * (size_t)png->w + (size_t)mx * block) * 4;
        for (int x = 0; x < block; ++x) {
            if (row[x * 4 + 3] < 128) continue;
            r += row[x * 4]; g += row[x * 4 + 1]; b += row[x * 4 + 2]; ++n;
        }
    }
    if (n) {
        s->r = (uint8_t)(r / n); s->g = (uint8_t)(g / n); s->b = (uint8_t)(b / n); s->a = 255;
    }
}


// ---------------------------------------------------------------------------
// Статистика и проверки
// ---------------------------------------------------------------------------
void re2d_stats(const Re2dPng *png, Re2dStats *st)
{
    memset(st, 0, sizeof *st);
    st->first_hole[0] = st->first_hole[1] = -1;
    st->first_isolated[0] = st->first_isolated[1] = -1;
    st->first_seam[0] = st->first_seam[1] = -1;
    st->first_bad_id[0] = st->first_bad_id[1] = -1;
    if (!png->size_ok) return;

    Re2dSample *grid = (Re2dSample *)calloc((size_t)RE2D_MAP_W * RE2D_MAP_H, sizeof *grid);
    if (!grid) return;
    for (int my = 0; my < RE2D_MAP_H; ++my) {
        for (int mx = 0; mx < RE2D_MAP_W; ++mx) {
            Re2dSample *s = &grid[my * RE2D_MAP_W + mx];
            re2d_sample(png, mx, my, s);
            if (s->coverage == 255 || s->coverage == 128) {
                if (s->coverage == 128) st->anchors++;
                else st->active++;
                if (!s->alpha_ok) st->bad_alpha++;
                if (s->coverage == 255) {
                    if (s->id < 1 || s->id > 254) {
                        if (st->bad_id++ == 0) { st->first_bad_id[0] = mx; st->first_bad_id[1] = my; }
                    } else {
                        st->per_id[s->id]++;
                    }
                }
            } else if (s->id != 0) {
                st->stale_id++;
            }
        }
    }

    // Фронтальная проекция: сколько отсчётов попадает в одну ячейку 1×1 модели.
    static int cells[64 * 128];
    memset(cells, 0, sizeof cells);

    for (int my = 0; my < RE2D_MAP_H; ++my) {
        for (int mx = 0; mx < RE2D_MAP_W; ++mx) {
            const Re2dSample *s = &grid[my * RE2D_MAP_W + mx];
            const bool act = s->coverage == 255;
            int neighbours = 0;
            const int dx[4] = { 1, -1, 0, 0 }, dy[4] = { 0, 0, 1, -1 };
            for (int d = 0; d < 4; ++d) {
                const int nx = mx + dx[d], ny = my + dy[d];
                if (nx < 0 || ny < 0 || nx >= RE2D_MAP_W || ny >= RE2D_MAP_H) continue;
                if (grid[ny * RE2D_MAP_W + nx].coverage == 255) ++neighbours;
            }
            if (act) {
                if (neighbours == 0) {
                    if (st->isolated++ == 0) { st->first_isolated[0] = mx; st->first_isolated[1] = my; }
                }
                const int cx = (int)floorf(s->x + 32.0f), cy = (int)floorf(s->y + 64.0f);
                if (cx >= 0 && cx < 64 && cy >= 0 && cy < 128) {
                    const int n = ++cells[cy * 64 + cx];
                    if (n > st->overlap_max) st->overlap_max = n;
                }
                // Скачок между соседями одной части вправо и вниз.
                for (int d = 0; d < 2; ++d) {
                    const int nx = mx + (d == 0), ny = my + (d == 1);
                    if (nx >= RE2D_MAP_W || ny >= RE2D_MAP_H) continue;
                    const Re2dSample *o = &grid[ny * RE2D_MAP_W + nx];
                    if (o->coverage != 255 || o->id != s->id) continue;
                    if (fabsf(o->x - s->x) > SEAM_DELTA || fabsf(o->y - s->y) > SEAM_DELTA || fabsf(o->z - s->z) > SEAM_DELTA) {
                        if (st->seams++ == 0) { st->first_seam[0] = mx; st->first_seam[1] = my; }
                    }
                }
            } else if (s->coverage == 0 && neighbours >= 3) {
                if (st->holes++ == 0) { st->first_hole[0] = mx; st->first_hole[1] = my; }
            }
        }
    }
    free(grid);
}

static void details_pair(R2dSb *d, const char *count_key, int count, const int first[2])
{
    r2d_sb_printf(d, "{\"%s\":%d,\"first\":", count_key, count);
    if (first[0] >= 0) r2d_sb_printf(d, "[%d,%d]}", first[0], first[1]);
    else r2d_sb_puts(d, "null}");
}

void re2d_validate_png(const char *path, const Re2dPng *png, const Re2dStats *st,
                       const bool declared[256], SdkReport *rep)
{
    if (!png->size_ok) {
        char d[96];
        snprintf(d, sizeof d, "{\"size\":[%d,%d]}", png->w, png->h);
        sdk_diag(rep, SDK_ERROR, "SDK_RE2D_PNG_SIZE", path, NULL, d,
                 "PNG %dx%d: Re2DSprite v2 — квадрат 1024/2048/3072/4096", png->w, png->h);
        return;
    }
    if (!png->header_ok) {
        sdk_diag(rep, SDK_ERROR, "SDK_RE2D_PNG_HEADER", path, NULL, NULL,
                 "Нет заголовка v2 в (0..2, 960): чисто рисовальная картинка не становится Re2DSprite — скомпилируйте карты");
        return;
    }
    if (png->bld && !png->sub) {
        sdk_diag(rep, SDK_ERROR, "SDK_RE2D_PNG_BLD_WITHOUT_SUB", path, NULL, NULL, "Маркер BLD требует SUB");
    }
    if (st->active + st->anchors == 0) {
        sdk_diag(rep, SDK_ERROR, "SDK_RE2D_MAP_EMPTY", path, NULL, NULL,
                 "Карты поверхности пусты: формат требует хотя бы один поддерживаемый отсчёт");
        return;
    }
    if (st->bad_id) {
        R2dSb d;
        r2d_sb_init(&d);
        details_pair(&d, "count", st->bad_id, st->first_bad_id);
        sdk_diag(rep, SDK_ERROR, "SDK_RE2D_MAP_ID_RANGE", path, NULL, d.data,
                 "%d активных отсчётов с ID вне 1..254 (первый: [%d,%d])", st->bad_id, st->first_bad_id[0], st->first_bad_id[1]);
        r2d_sb_free(&d);
    }
    if (st->bad_alpha) {
        char d[64];
        snprintf(d, sizeof d, "{\"count\":%d}", st->bad_alpha);
        sdk_diag(rep, SDK_ERROR, "SDK_RE2D_MAP_ALPHA", path, NULL, d,
                 "%d активных отсчётов, у которых alpha служебных карт не 255", st->bad_alpha);
    }
    if (declared) {
        R2dSb undeclared, empty;
        r2d_sb_init(&undeclared);
        r2d_sb_init(&empty);
        int nu = 0, ne = 0;
        for (int id = 1; id <= 254; ++id) {
            if (st->per_id[id] > 0 && !declared[id]) {
                r2d_sb_printf(&undeclared, "%s%d", nu++ ? "," : "", id);
            }
            if (declared[id] && st->per_id[id] == 0) {
                r2d_sb_printf(&empty, "%s%d", ne++ ? "," : "", id);
            }
        }
        if (nu) {
            R2dSb d;
            r2d_sb_init(&d);
            r2d_sb_printf(&d, "{\"ids\":[%s]}", undeclared.data);
            sdk_diag(rep, SDK_WARNING, "SDK_RE2D_ID_UNDECLARED", path, NULL, d.data,
                     "В карте есть ID, не описанные в rig.parts (они скрыты): %s", undeclared.data);
            r2d_sb_free(&d);
        }
        if (ne) {
            R2dSb d;
            r2d_sb_init(&d);
            r2d_sb_printf(&d, "{\"ids\":[%s]}", empty.data);
            sdk_diag(rep, SDK_WARNING, "SDK_RE2D_PART_EMPTY", path, NULL, d.data,
                     "Части из rig.parts без единого отсчёта в PNG: %s", empty.data);
            r2d_sb_free(&d);
        }
        r2d_sb_free(&undeclared);
        r2d_sb_free(&empty);
    }
    if (st->holes) {
        R2dSb d;
        r2d_sb_init(&d);
        details_pair(&d, "count", st->holes, st->first_hole);
        sdk_diag(rep, SDK_WARNING, "SDK_RE2D_HOLE", path, NULL, d.data,
                 "%d отсчётов-дыр (пустой отсчёт окружён активными, первый: [%d,%d])", st->holes, st->first_hole[0], st->first_hole[1]);
        r2d_sb_free(&d);
    }
    if (st->seams) {
        R2dSb d;
        r2d_sb_init(&d);
        details_pair(&d, "count", st->seams, st->first_seam);
        sdk_diag(rep, SDK_WARNING, "SDK_RE2D_SEAM", path, NULL, d.data,
                 "%d скачков XYZ больше %.0f единиц между соседями одной части (первый: [%d,%d])", st->seams, SEAM_DELTA,
                 st->first_seam[0], st->first_seam[1]);
        r2d_sb_free(&d);
    }
    if (st->isolated) {
        R2dSb d;
        r2d_sb_init(&d);
        details_pair(&d, "count", st->isolated, st->first_isolated);
        sdk_diag(rep, SDK_INFO, "SDK_RE2D_ISOLATED", path, NULL, d.data,
                 "%d изолированных отсчётов без активных соседей (первый: [%d,%d])", st->isolated,
                 st->first_isolated[0], st->first_isolated[1]);
        r2d_sb_free(&d);
    }
    if (st->stale_id) {
        char d[64];
        snprintf(d, sizeof d, "{\"count\":%d}", st->stale_id);
        sdk_diag(rep, SDK_INFO, "SDK_RE2D_STALE_ID", path, NULL, d,
                 "%d отсчётов с ID при нулевом покрытии (остатки старой развёртки)", st->stale_id);
    }
}

// ---------------------------------------------------------------------------
// Владельцы частей (id → кость)
// ---------------------------------------------------------------------------
void re2d_owners_load(const char *model_path, Re2dOwners *o)
{
    memset(o, 0, sizeof *o);
    if (!model_path) return;
    SdkReport rep;
    sdk_report_init(&rep);
    R2dJson *root = sdk_load_json(model_path, &rep);
    sdk_report_free(&rep);
    if (!root) return;
    const R2dJson *rig = r2d_json_get(root, "rig");
    const R2dJson *bones = r2d_json_get(rig, "bones");
    const R2dJson *parts = r2d_json_get(rig, "parts");
    for (int i = 0; parts && i < parts->count; ++i) {
        const R2dJson *p = parts->items[i];
        const int id = r2d_json_int(r2d_json_get(p, "id"), 0);
        if (id < 1 || id > 254) continue;
        const char *bone = r2d_json_str(r2d_json_get(p, "bone"), "");
        snprintf(o->bones[id], sizeof o->bones[id], "%s", bone);
        o->ids[o->count++ % 256] = id;
        o->declared[id] = true;
        o->bone_index[id] = 0;
        for (int b = 0; bones && b < bones->count; ++b) {
            if (strcmp(r2d_json_str(r2d_json_get(bones->items[b], "name"), ""), bone) == 0) { o->bone_index[id] = b + 1; break; }
        }
    }
    r2d_json_free(root);
}

// ---------------------------------------------------------------------------
// Отладочный вид
// ---------------------------------------------------------------------------
static void hsv(float h, float s, float v, uint8_t *out)
{
    const float c = v * s;
    const float hp = fmodf(h, 360.0f) / 60.0f;
    const float x = c * (1 - fabsf(fmodf(hp, 2) - 1));
    float r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; } else if (hp < 2) { r = x; g = c; } else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; } else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
    const float m = v - c;
    out[0] = (uint8_t)((r + m) * 255); out[1] = (uint8_t)((g + m) * 255); out[2] = (uint8_t)((b + m) * 255);
}

static void ramp(float t, uint8_t *out)
{
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    // тёмно-синий → бирюзовый → жёлтый
    const float r = t < 0.5f ? 0.05f + 0.1f * t : (t - 0.5f) * 2.0f * 0.95f + 0.1f;
    const float g = 0.1f + t * 0.85f;
    const float b = t < 0.5f ? 0.35f + t * 0.8f : 0.75f - (t - 0.5f) * 1.4f;
    out[0] = (uint8_t)(fminf(r, 1) * 255); out[1] = (uint8_t)(fminf(g, 1) * 255); out[2] = (uint8_t)(fmaxf(b, 0) * 255);
}

uint8_t *re2d_debug_image(const Re2dPng *png, int mode, const Re2dOwners *owners, int scale, int *out_w, int *out_h)
{
    if (!png->size_ok || scale < 1 || scale > 16) return NULL;
    const int w = RE2D_MAP_W * scale, h = RE2D_MAP_H * scale;
    uint8_t *img = (uint8_t *)malloc((size_t)w * h * 4);
    Re2dSample *grid = (Re2dSample *)calloc((size_t)RE2D_MAP_W * RE2D_MAP_H, sizeof *grid);
    if (!img || !grid) { free(img); free(grid); return NULL; }
    static int cells[64 * 128];
    memset(cells, 0, sizeof cells);
    for (int my = 0; my < RE2D_MAP_H; ++my) {
        for (int mx = 0; mx < RE2D_MAP_W; ++mx) {
            Re2dSample *s = &grid[my * RE2D_MAP_W + mx];
            re2d_sample(png, mx, my, s);
            if (s->coverage == 255) {
                const int cx = (int)floorf(s->x + 32.0f), cy = (int)floorf(s->y + 64.0f);
                if (cx >= 0 && cx < 64 && cy >= 0 && cy < 128) cells[cy * 64 + cx]++;
            }
        }
    }
    for (int my = 0; my < RE2D_MAP_H; ++my) {
        for (int mx = 0; mx < RE2D_MAP_W; ++mx) {
            const Re2dSample *s = &grid[my * RE2D_MAP_W + mx];
            uint8_t c[4] = { 16, 20, 30, 255 };
            if ((mx / 4 + my / 4) & 1) { c[0] = 22; c[1] = 27; c[2] = 40; }     // шахматка «ничего нет»
            const bool act = s->coverage == 255;
            switch (mode) {
            case RE2D_MODE_MATERIAL:
                if (s->a) { c[0] = s->r; c[1] = s->g; c[2] = s->b; }
                break;
            case RE2D_MODE_PART:
                if (act && s->id > 0) hsv((float)(s->id * 137), 0.65f, 0.95f, c);
                else if (act) { c[0] = 255; c[1] = 0; c[2] = 255; }
                break;
            case RE2D_MODE_OWNER:
                if (act) {
                    if (owners && s->id > 0 && owners->declared[s->id]) hsv((float)(owners->bone_index[s->id] * 47 + 10), 0.7f, 0.95f, c);
                    else { c[0] = 255; c[1] = 0; c[2] = 255; }     // владелец не описан
                }
                break;
            case RE2D_MODE_X: if (act) ramp((s->x + 32.0f) / 64.0f, c); break;
            case RE2D_MODE_Y: if (act) ramp((s->y + 64.0f) / 128.0f, c); break;
            case RE2D_MODE_Z: if (act) ramp((s->z + 32.0f) / 64.0f, c); break;
            case RE2D_MODE_COVERAGE:
                if (s->coverage == 255) { c[0] = c[1] = c[2] = 240; }
                else if (s->coverage == 128) { c[0] = c[1] = c[2] = 110; }
                break;
            case RE2D_MODE_GROUP:
                if (act) hsv((float)(s->group * 53 + 200), 0.55f, 0.9f, c);
                break;
            case RE2D_MODE_OVERLAP:
                if (act) {
                    const int cx = (int)floorf(s->x + 32.0f), cy = (int)floorf(s->y + 64.0f);
                    const int n = cx >= 0 && cx < 64 && cy >= 0 && cy < 128 ? cells[cy * 64 + cx] : 1;
                    if (n <= 1) { c[0] = 40; c[1] = 90; c[2] = 70; }
                    else if (n <= 3) { c[0] = 230; c[1] = 170; c[2] = 40; }
                    else { c[0] = 240; c[1] = 60; c[2] = 40; }
                }
                break;
            }
            for (int dy = 0; dy < scale; ++dy) {
                uint8_t *row = img + ((size_t)(my * scale + dy) * w + (size_t)mx * scale) * 4;
                for (int dx = 0; dx < scale; ++dx) memcpy(row + dx * 4, c, 4);
            }
        }
    }
    free(grid);
    *out_w = w;
    *out_h = h;
    return img;
}
