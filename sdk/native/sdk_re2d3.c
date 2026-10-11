// ===========================================================================
// Re2DSprite v3: чтение плотного контейнера и правка сетки текселей.
//
// Раскладка (docs/RE2DSPRITE_V3.md, запись — sdk/native/sdk_bake3.c, чтение
// ядра — src/rotsprite3.c):
//
//   PNG: W·cols × (1 + ряды·H), ряды = ceil(layers/cols)
//   строка 0: «R2D» «ROT» (3,0,0) | W (16 бит BE) | H | cols | layers | … | extent
//   слой 0 — цвет, 1 — позиция hi, 2 — позиция lo, 3 — нормаль (A = блеск),
//   4 — кости (id−1), 5 — веса 0…255. alpha слоя позиции 255 — тексель есть.
//
// Заголовок при записи НЕ пересобирается: меняются только пиксели слоёв, а
// строка 0 остаётся байт в байт как в исходном файле — так контейнер, собранный
// любой версией baker'а, переживает правку без потери полей.
// ===========================================================================
#include "sdk_re2d3.h"
#include "sdk_re2d.h"

#include <SDL3/SDL.h>

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define RE2D3_MAX_DIM      8192     // предел размера отладочного вида
#define RE2D3_MAX_PIXELS   (64 * 1024 * 1024)
#define RE2D3_MAX_OPS      1024
#define RE2D3_MAX_RECTS    16384

// ---------------------------------------------------------------------------
// Доступ к пикселям
// ---------------------------------------------------------------------------
static uint8_t *at(const Re2d3Png *p, int layer, int x, int y)
{
    const int row = 1 + (layer / p->cols) * p->th + y;
    const int col = (layer % p->cols) * p->tw + x;
    return p->px + ((size_t)row * (size_t)p->w + (size_t)col) * 4;
}

static bool layer_live(const uint8_t *pos_hi) { return pos_hi[3] == 255; }

// ---------------------------------------------------------------------------
// Открытие
// ---------------------------------------------------------------------------
static void parse_header(Re2d3Png *png)
{
    const uint8_t *h = png->px;
    png->header_ok = h[0] == 82 && h[1] == 50 && h[2] == 68 && h[3] == 255 &&
                     h[4] == 82 && h[5] == 79 && h[6] == 84 && h[7] == 255 &&
                     h[8] == 3 && h[9] == 0 && h[10] == 0 && h[11] == 255;
    if (!png->header_ok) return;
    png->tw = (h[12] << 8) | h[13];
    png->th = (h[14] << 8) | h[15];
    png->cols = h[16];
    png->layers = h[17];
    png->extent = (h[20] << 8) | h[21];
    const int rows = png->cols > 0 ? (png->layers + png->cols - 1) / png->cols : 0;
    // Числом слоёв размер не ограничивается: ядро принимает любое layers >= 6
    // (src/rotsprite3.c), поэтому лишние слои — отдельная диагностика, а не
    // «размеры не совпадают».
    png->size_ok = png->tw >= 64 && png->th >= 64 && png->tw <= RE2D3_MAX_GRID && png->th <= RE2D3_MAX_GRID &&
                   png->cols >= 1 && png->layers >= RE2D3_LAYERS &&
                   png->extent >= 16 && png->extent <= 250 && rows > 0 &&
                   png->w == png->cols * png->tw && png->h == 1 + rows * png->th;
    png->editable = png->size_ok && png->layers == RE2D3_LAYERS;
}

bool re2d3_open_mem(uint8_t *pixels, int w, int h, Re2d3Png *png)
{
    memset(png, 0, sizeof *png);
    if (!pixels || w < 8 || h < 2) { sdk_image_free(pixels); return false; }
    png->px = pixels;
    png->w = w;
    png->h = h;
    parse_header(png);
    return true;
}

bool re2d3_open(const char *path, Re2d3Png *png)
{
    int w = 0, h = 0;
    uint8_t *px = sdk_image_load_rgba(path, &w, &h);
    if (!px) { memset(png, 0, sizeof *png); return false; }
    return re2d3_open_mem(px, w, h, png);
}

void re2d3_close(Re2d3Png *png)
{
    sdk_image_free(png->px);
    memset(png, 0, sizeof *png);
}

int re2d_container_version(const char *path, Re2d3Png *png)
{
    // Заголовок v3 лежит в пикселях изображения, а не в байтах PNG-файла,
    // поэтому версия определяется после декодирования — один раз на команду.
    if (!re2d3_open(path, png)) return 0;
    if (png->header_ok) return 3;
    re2d3_close(png);
    return 2;
}

// ---------------------------------------------------------------------------
// Отсчёт
// ---------------------------------------------------------------------------
void re2d3_sample(const Re2d3Png *png, int x, int y, Re2d3Sample *s)
{
    memset(s, 0, sizeof *s);
    s->x = x;
    s->y = y;
    if (!png->px || !png->size_ok || x < 0 || y < 0 || x >= png->tw || y >= png->th) return;
    const uint8_t *hi = at(png, 1, x, y), *lo = at(png, 2, x, y), *rgb = at(png, 0, x, y);
    const uint8_t *nrm = at(png, 3, x, y), *bon = at(png, 4, x, y), *wt = at(png, 5, x, y);
    s->live = layer_live(hi);
    memcpy(s->rgba, rgb, 4);
    float pos[3], n[3];
    for (int c = 0; c < 3; ++c) {
        pos[c] = ((hi[c] << 8) | lo[c]) / 256.0f - 128.0f;
        n[c] = nrm[c] / 255.0f * 2.0f - 1.0f;
    }
    s->px = pos[0]; s->py = pos[1]; s->pz = pos[2];
    s->nx = n[0]; s->ny = n[1]; s->nz = n[2];
    s->gloss = nrm[3];
    // Веса — как в данных. Нулевая сумма не подменяется здесь: подстановку
    // («кость 1, вес 255») делает рантайм (src/rotsprite3.c), а SDK сообщает
    // факт — иначе `zero_weights` никогда бы не срабатывал, а гистограмма
    // костей получала бы кость, которой в контейнере нет.
    for (int q = 0; q < 4; ++q) { s->bones[q] = bon[q] + 1; s->weights[q] = wt[q]; }
}

// ---------------------------------------------------------------------------
// Статистика
// ---------------------------------------------------------------------------
void re2d3_stats(const Re2d3Png *png, Re2d3Stats *st)
{
    memset(st, 0, sizeof *st);
    st->first_isolated[0] = st->first_isolated[1] = -1;
    st->gloss_min = 256;
    for (int c = 0; c < 3; ++c) { st->pos_min[c] = 1e9f; st->pos_max[c] = -1e9f; }
    if (!png->px || !png->size_ok) return;

    Re2d3Sample s;
    long gloss_sum = 0;
    for (int y = 0; y < png->th; ++y) {
        for (int x = 0; x < png->tw; ++x) {
            re2d3_sample(png, x, y, &s);
            st->slots++;
            if (!s.live) continue;
            st->live++;
            if (s.rgba[3] != 255) st->bad_color_alpha++;
            const uint8_t *hi = at(png, 1, x, y), *lo = at(png, 2, x, y);
            if (hi[3] != 255 || lo[3] != 255) st->bad_position_alpha++;
            const float len2 = s.nx * s.nx + s.ny * s.ny + s.nz * s.nz;
            if (len2 < 1e-4f) st->bad_normal++;
            // Кость и веса — по сырым байтам слоя: тексель с нулевой суммой
            // остаётся фактом «кость не задана», а не фантомной костью 1.
            const uint8_t *bo = at(png, 4, x, y), *wraw = at(png, 5, x, y);
            int best = 0, total = 0;
            for (int q = 0; q < 4; ++q) {
                total += wraw[q];
                if (wraw[q] > wraw[best]) best = q;
            }
            if (total == 0) {
                st->zero_weights++;
            } else {
                if (total != 255) st->bad_weights++;
                const int bone = bo[best] + 1;
                if (bone >= 1 && bone <= 255) {
                    if (st->bone_texels[bone]++ == 0) st->bones_used++;
                    st->bone_weight[bone] += wraw[best];
                }
            }
            if (s.gloss < st->gloss_min) st->gloss_min = s.gloss;
            if (s.gloss > st->gloss_max) st->gloss_max = s.gloss;
            gloss_sum += s.gloss;
            const float pos[3] = { s.px, s.py, s.pz };
            for (int c = 0; c < 3; ++c) {
                if (pos[c] < st->pos_min[c]) st->pos_min[c] = pos[c];
                if (pos[c] > st->pos_max[c]) st->pos_max[c] = pos[c];
            }
            int neighbours = 0;
            const int dx[4] = { 1, -1, 0, 0 }, dy[4] = { 0, 0, 1, -1 };
            for (int d = 0; d < 4; ++d) {
                const int nx = x + dx[d], ny = y + dy[d];
                if (nx < 0 || ny < 0 || nx >= png->tw || ny >= png->th) continue;
                if (layer_live(at(png, 1, nx, ny))) neighbours++;
            }
            if (!neighbours && st->isolated++ == 0) { st->first_isolated[0] = x; st->first_isolated[1] = y; }
        }
    }
    if (!st->live) {
        st->gloss_min = st->gloss_max = 0;
        for (int c = 0; c < 3; ++c) { st->pos_min[c] = st->pos_max[c] = 0; }
    }
    st->gloss_mean = st->live ? (double)gloss_sum / st->live : 0.0;
}

// ---------------------------------------------------------------------------
// Отладочный вид
// ---------------------------------------------------------------------------
static const char *const k_mode_names[RE2D3_MODE_COUNT] = {
    "material", "normal", "gloss", "owner", "weight", "coverage", "x", "y", "z",
};

const char *re2d3_mode_name(int mode) { return mode >= 0 && mode < RE2D3_MODE_COUNT ? k_mode_names[mode] : "?"; }

int re2d3_mode_from_name(const char *name)
{
    for (int i = 0; i < RE2D3_MODE_COUNT; ++i) if (strcmp(name, k_mode_names[i]) == 0) return i;
    return -1;
}

uint8_t *re2d3_debug_image(const Re2d3Png *png, int mode, int scale, int *out_w, int *out_h)
{
    if (!png->px || !png->size_ok || mode < 0 || mode >= RE2D3_MODE_COUNT || scale < 1 || scale > 16) return NULL;
    const int w = png->tw * scale, h = png->th * scale;
    if (w > RE2D3_MAX_DIM || h > RE2D3_MAX_DIM || (long)w * h > RE2D3_MAX_PIXELS) return NULL;
    uint8_t *img = (uint8_t *)malloc((size_t)w * h * 4);
    if (!img) return NULL;
    Re2d3Sample s;
    for (int y = 0; y < png->th; ++y) {
        for (int x = 0; x < png->tw; ++x) {
            re2d3_sample(png, x, y, &s);
            uint8_t c[4] = { 16, 20, 30, 255 };
            if ((x / 4 + y / 4) & 1) { c[0] = 22; c[1] = 27; c[2] = 40; }
            if (s.live) {
                int best = 0, weight_sum = 0;
                for (int q = 0; q < 4; ++q) {
                    weight_sum += s.weights[q];
                    if (s.weights[q] > s.weights[best]) best = q;
                }
                switch (mode) {
                case RE2D3_MODE_MATERIAL: c[0] = s.rgba[0]; c[1] = s.rgba[1]; c[2] = s.rgba[2]; break;
                case RE2D3_MODE_NORMAL:
                    c[0] = (uint8_t)(fminf(255.0f, fmaxf(0.0f, (s.nx * 0.5f + 0.5f) * 255.0f + 0.5f)));
                    c[1] = (uint8_t)(fminf(255.0f, fmaxf(0.0f, (s.ny * 0.5f + 0.5f) * 255.0f + 0.5f)));
                    c[2] = (uint8_t)(fminf(255.0f, fmaxf(0.0f, (s.nz * 0.5f + 0.5f) * 255.0f + 0.5f)));
                    break;
                case RE2D3_MODE_GLOSS: re2d_ramp(s.gloss / 255.0f, c); break;
                case RE2D3_MODE_OWNER:
                    // Нулевая сумма весов — кость не задана: серый, а не цвет
                    // случайной кости из байта слоя.
                    if (weight_sum > 0) re2d_hsv((float)(s.bones[best] * 47 + 10), 0.7f, 0.95f, c);
                    else { c[0] = 70; c[1] = 70; c[2] = 80; }
                    break;
                case RE2D3_MODE_WEIGHT: re2d_ramp(s.weights[best] / 255.0f, c); break;
                case RE2D3_MODE_COVERAGE: c[0] = c[1] = c[2] = 240; break;
                case RE2D3_MODE_X: re2d_ramp((s.px + 128.0f) / 256.0f, c); break;
                case RE2D3_MODE_Y: re2d_ramp((s.py + 128.0f) / 256.0f, c); break;
                case RE2D3_MODE_Z: re2d_ramp((s.pz + 128.0f) / 256.0f, c); break;
                }
            } else if (mode == RE2D3_MODE_COVERAGE) {
                c[0] = c[1] = c[2] = 48;
            }
            for (int dy = 0; dy < scale; ++dy) {
                uint8_t *row = img + ((size_t)(y * scale + dy) * w + (size_t)x * scale) * 4;
                for (int dx = 0; dx < scale; ++dx) memcpy(row + dx * 4, c, 4);
            }
        }
    }
    *out_w = w;
    *out_h = h;
    return img;
}

// ---------------------------------------------------------------------------
// Проверка контейнера
// ---------------------------------------------------------------------------
void re2d3_validate_png(const char *path, const Re2d3Png *png, const Re2d3Stats *st, SdkReport *rep)
{
    if (!png->header_ok) {
        sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_HEADER", path, NULL, NULL,
                 "Нет заголовка Re2DSprite v3 («R2D» «ROT» (3,0,0) в начале контейнера)");
        return;
    }
    if (!png->size_ok) {
        char d[160];
        snprintf(d, sizeof d, "{\"png\":[%d,%d],\"grid\":[%d,%d],\"cols\":%d,\"layers\":%d,\"extent\":%d}",
                 png->w, png->h, png->tw, png->th, png->cols, png->layers, png->extent);
        sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_SIZE", path, NULL, d,
                 "Размеры контейнера не совпадают с заголовком: PNG %dx%d, сетка %dx%d, колонок %d, слоёв %d, extent %d",
                 png->w, png->h, png->tw, png->th, png->cols, png->layers, png->extent);
        return;
    }
    if (!st->live) {
        sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_EMPTY", path, NULL, NULL,
                 "Сетка пуста: контейнер требует хотя бы один тексель с alpha слоя позиции 255");
        return;
    }
    if (st->zero_weights) {
        char d[64];
        snprintf(d, sizeof d, "{\"count\":%d}", st->zero_weights);
        sdk_diag(rep, SDK_INFO, "SDK_RE2D3_WEIGHT_ZERO", path, NULL, d,
                 "%d живых текселей с нулевой суммой весов: кость в данных не задана (рантайм подставляет кость 1 с весом 255)", st->zero_weights);
    }
    if (st->bad_weights) {
        char d[64];
        snprintf(d, sizeof d, "{\"count\":%d}", st->bad_weights);
        sdk_diag(rep, SDK_WARNING, "SDK_RE2D3_WEIGHT_SUM", path, NULL, d,
                 "%d живых текселей с суммой весов не 255", st->bad_weights);
    }
    if (st->bad_normal) {
        char d[64];
        snprintf(d, sizeof d, "{\"count\":%d}", st->bad_normal);
        sdk_diag(rep, SDK_WARNING, "SDK_RE2D3_NORMAL", path, NULL, d,
                 "%d живых текселей с нулевой нормалью (нет освещения синтеза)", st->bad_normal);
    }
    if (st->bad_color_alpha) {
        char d[64];
        snprintf(d, sizeof d, "{\"count\":%d}", st->bad_color_alpha);
        sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_COLOR_ALPHA", path, NULL, d,
                 "%d живых текселей, у которых alpha слоя цвета не 255", st->bad_color_alpha);
    }
    if (st->bad_position_alpha) {
        char d[64];
        snprintf(d, sizeof d, "{\"count\":%d}", st->bad_position_alpha);
        sdk_diag(rep, SDK_INFO, "SDK_RE2D3_POSITION_ALPHA", path, NULL, d,
                 "%d живых текселей со служебной alpha слоёв позиции не 255", st->bad_position_alpha);
    }
    if (st->isolated) {
        char d[96];
        snprintf(d, sizeof d, "{\"count\":%d,\"first\":[%d,%d]}", st->isolated, st->first_isolated[0], st->first_isolated[1]);
        sdk_diag(rep, SDK_INFO, "SDK_RE2D3_ISOLATED", path, NULL, d,
                 "%d изолированных текселей без живых соседей (первый: [%d,%d])", st->isolated,
                 st->first_isolated[0], st->first_isolated[1]);
    }
    if (png->layers != RE2D3_LAYERS) {
        char d[64];
        snprintf(d, sizeof d, "{\"layers\":%d}", png->layers);
        sdk_diag(rep, SDK_WARNING, "SDK_RE2D3_LAYERS", path, NULL, d,
                 "Слоёв %d, а не %d: контейнер читается, но правка сетки для него не поддержана", png->layers, RE2D3_LAYERS);
    }
}

// ---------------------------------------------------------------------------
// Правка сетки
// ---------------------------------------------------------------------------
// Обрезка прямоугольника по сетке. Считаем в long: координаты приходят из JSON,
// и `x + w` не должно переполнять int.
static void clamp_rect(const Re2d3Png *png, int *x, int *y, int *w, int *h)
{
    long x0 = *x, y0 = *y, x1 = (long)*x + *w, y1 = (long)*y + *h;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > png->tw) x1 = png->tw;
    if (y1 > png->th) y1 = png->th;
    if (x1 < x0) x1 = x0;
    if (y1 < y0) y1 = y0;
    *x = (int)x0;
    *y = (int)y0;
    *w = (int)(x1 - x0);
    *h = (int)(y1 - y0);
}

// Веса записываются как байты с суммой ровно 255. Метод наибольших остатков:
// округление «в лоб» + довесок первой доле (как было раньше) могло дать
// отрицательный вес (байт 255) и сумму 511 — тихая порча данных, которую потом
// ловил уже validate.
static void pack_weights(const int in[4], int weights[4])
{
    int total = 0;
    for (int q = 0; q < 4; ++q) total += in[q] > 0 ? in[q] : 0;
    memset(weights, 0, 4 * sizeof weights[0]);
    if (total <= 0) { weights[0] = 255; return; }
    int rem[4], sum = 0;
    for (int q = 0; q < 4; ++q) {
        const long scaled = in[q] > 0 ? (long)in[q] * 255 : 0;
        weights[q] = (int)(scaled / total);
        rem[q] = (int)(scaled % total);
        sum += weights[q];
    }
    for (int left = 255 - sum; left > 0; --left) {
        int best = -1;
        for (int q = 0; q < 4; ++q) {
            if (weights[q] >= 255) continue;
            if (best < 0 || rem[q] > rem[best]) best = q;
        }
        if (best < 0) break;
        weights[best]++;
        rem[best] = -1;      // каждая доля получает не больше одного остатка
    }
}

int re2d3_paint_bone(Re2d3Png *png, int x, int y, int w, int h, const int bones[4], const int weights[4])
{
    if (!png->editable) return 0;
    clamp_rect(png, &x, &y, &w, &h);
    int packed[4];
    pack_weights(weights, packed);
    uint8_t ids[4];
    for (int q = 0; q < 4; ++q) {
        const int id = bones[q];
        ids[q] = (uint8_t)(id < 1 ? 0 : id > 255 ? 254 : id - 1);
    }
    int painted = 0;
    for (int yy = y; yy < y + h; ++yy) {
        for (int xx = x; xx < x + w; ++xx) {
            if (!layer_live(at(png, 1, xx, yy))) continue;
            uint8_t *bon = at(png, 4, xx, yy), *wt = at(png, 5, xx, yy);
            for (int q = 0; q < 4; ++q) { bon[q] = ids[q]; wt[q] = (uint8_t)packed[q]; }
            painted++;
        }
    }
    return painted;
}

int re2d3_paint_gloss(Re2d3Png *png, int x, int y, int w, int h, int gloss)
{
    if (!png->editable) return 0;
    clamp_rect(png, &x, &y, &w, &h);
    if (gloss < 0) gloss = 0;
    if (gloss > 255) gloss = 255;
    int painted = 0;
    for (int yy = y; yy < y + h; ++yy) {
        for (int xx = x; xx < x + w; ++xx) {
            if (!layer_live(at(png, 1, xx, yy))) continue;
            at(png, 3, xx, yy)[3] = (uint8_t)gloss;
            painted++;
        }
    }
    return painted;
}

int re2d3_paint_color(Re2d3Png *png, int x, int y, int w, int h, const uint8_t rgb[3])
{
    if (!png->editable) return 0;
    clamp_rect(png, &x, &y, &w, &h);
    int painted = 0;
    for (int yy = y; yy < y + h; ++yy) {
        for (int xx = x; xx < x + w; ++xx) {
            if (!layer_live(at(png, 1, xx, yy))) continue;
            uint8_t *c = at(png, 0, xx, yy);
            c[0] = rgb[0]; c[1] = rgb[1]; c[2] = rgb[2]; c[3] = 255;
            painted++;
        }
    }
    return painted;
}

bool re2d3_write(const Re2d3Png *png, const char *path)
{
    if (!png->px || !png->size_ok) return false;
    return sdk_image_write_png(path, png->px, png->w, png->h);
}

// ---------------------------------------------------------------------------
// Команда: применить операции к сетке и записать контейнер
//
// Файл правок (редактор «Сетка» строит его сам):
//   { "version": 1,
//     "ops": [ { "op": "bone",  "rects": [[x,y,w,h], …], "bones": [[id, вес], …] },
//              { "op": "gloss", "rects": [[x,y,w,h], …], "value": 0…255 },
//              { "op": "color", "rects": [[x,y,w,h], …], "rgb": [r, g, b] } ] }
// Прямоугольники — в клетках сетки текселей; меняются только живые тексели.
// ---------------------------------------------------------------------------
typedef struct PaintOp {
    int     kind;               // 0 bone, 1 gloss, 2 color
    int     bones[4], weights[4];
    int     gloss;
    uint8_t rgb[3];
    int     rects;              // сколько прямоугольников прочитано
} PaintOp;

static bool op_is(const R2dJson *op, const char *kind)
{
    const char *name = r2d_json_str(r2d_json_get(op, "op"), NULL);
    return name && strcmp(name, kind) == 0;
}

// Число операции: строго числовой тип, конечное, целое и в допуске. `bool`,
// строка и дробное значение — ошибка, а не молчаливый 0 или усечение.
static bool op_int(const R2dJson *v, double min, double max, double *out)
{
    if (!v || v->type != R2D_JSON_NUM) return false;
    const double n = v->number;
    if (!isfinite(n) || n < min || n > max || n != floor(n)) return false;
    if (out) *out = n;
    return true;
}

// Первый проход: структура и значения. Ничего не меняет.
static bool read_ops(const char *edits_path, const R2dJson *root, const Re2d3Png *png,
                     PaintOp *ops, int cap, int *count, SdkReport *rep)
{
    const R2dJson *list = r2d_json_get(root, "ops");
    *count = 0;
    double version = 0;
    if (root->type != R2D_JSON_OBJ || !op_int(r2d_json_get(root, "version"), 0, 1e9, &version) || version != 1 ||
        !list || list->type != R2D_JSON_ARR || r2d_json_size(list) < 1) {
        sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_EDITS", edits_path, NULL, NULL,
                 "Файл правок: {\"version\":1,\"ops\":[…]}, минимум одна операция");
        return false;
    }
    if (r2d_json_size(list) > cap) {
        sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_EDITS", edits_path, NULL, NULL, "Операций больше %d", cap);
        return false;
    }
    int rects_total = 0;
    for (int i = 0; i < r2d_json_size(list); ++i) {
        const R2dJson *op = r2d_json_at(list, i);
        const R2dJson *rects = r2d_json_get(op, "rects");
        char where[64];
        snprintf(where, sizeof where, "ops[%d]", i);
        PaintOp *po = &ops[i];
        memset(po, 0, sizeof *po);
        po->weights[0] = 255;
        po->rgb[0] = po->rgb[1] = po->rgb[2] = 255;
        if (!rects || rects->type != R2D_JSON_ARR || r2d_json_size(rects) < 1) {
            sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_OP", edits_path, NULL, NULL, "%s: нужен непустой rects", where);
            return false;
        }
        if (rects_total + r2d_json_size(rects) > RE2D3_MAX_RECTS) {
            sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_RECT", edits_path, NULL, NULL, "Прямоугольников больше %d", RE2D3_MAX_RECTS);
            return false;
        }
        rects_total += r2d_json_size(rects);
        for (int r = 0; r < r2d_json_size(rects); ++r) {
            const R2dJson *rect = r2d_json_at(rects, r);
            if (!rect || rect->type != R2D_JSON_ARR || r2d_json_size(rect) != 4) {
                char w[80];
                snprintf(w, sizeof w, "%s.rects[%d]", where, r);
                sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_RECT", edits_path, NULL, NULL, "%s: [x, y, w, h]", w);
                return false;
            }
            // Координаты проверяются до приведения к int: 1e18 в JSON не должен
            // становиться неопределённым поведением.
            double rx = 0, ry = 0, rw = 0, rh = 0;
            if (!op_int(r2d_json_at(rect, 0), -1000000, 1000000, &rx) ||
                !op_int(r2d_json_at(rect, 1), -1000000, 1000000, &ry) ||
                !op_int(r2d_json_at(rect, 2), 1, 1000000, &rw) ||
                !op_int(r2d_json_at(rect, 3), 1, 1000000, &rh)) {
                char w[80];
                snprintf(w, sizeof w, "%s.rects[%d]", where, r);
                sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_RECT", edits_path, NULL, NULL,
                         "%s: целые x и y в пределах ±1000000, w и h — 1..1000000", w);
                return false;
            }
        }
        if (op_is(op, "bone")) {
            const R2dJson *bones = r2d_json_get(op, "bones");
            if (!bones || bones->type != R2D_JSON_ARR || r2d_json_size(bones) < 1 || r2d_json_size(bones) > 4) {
                sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_OP", edits_path, NULL, NULL,
                         "%s: для bone нужен массив bones из 1..4 пар [id, вес]", where);
                return false;
            }
            po->kind = 0;
            int weight_total = 0;
            for (int q = 0; q < r2d_json_size(bones); ++q) {
                const R2dJson *pair = r2d_json_at(bones, q);
                double id = 0, weight = 0;
                if (!pair || pair->type != R2D_JSON_ARR || r2d_json_size(pair) != 2 ||
                    !op_int(r2d_json_at(pair, 0), 1, 255, &id) ||
                    !op_int(r2d_json_at(pair, 1), 0, 255, &weight)) {
                    char w[80];
                    snprintf(w, sizeof w, "%s.bones[%d]", where, q);
                    sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_BONE", edits_path, NULL, NULL,
                             "%s: целые id 1..255 и вес 0..255", w);
                    return false;
                }
                po->bones[q] = (int)id;
                po->weights[q] = (int)weight;
                weight_total += (int)weight;
            }
            if (weight_total <= 0) {
                sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_BONE", edits_path, NULL, NULL,
                         "%s: сумма весов больше нуля (иначе кость не определена)", where);
                return false;
            }
        } else if (op_is(op, "gloss")) {
            double value = 0;
            if (!op_int(r2d_json_get(op, "value"), 0, 255, &value)) {
                sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_OP", edits_path, NULL, NULL, "%s: для gloss нужен целый value 0..255", where);
                return false;
            }
            po->kind = 1;
            po->gloss = (int)value;
        } else if (op_is(op, "color")) {
            const R2dJson *rgb = r2d_json_get(op, "rgb");
            if (!rgb || rgb->type != R2D_JSON_ARR || r2d_json_size(rgb) != 3) {
                sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_OP", edits_path, NULL, NULL, "%s: для color нужен rgb из трёх чисел", where);
                return false;
            }
            po->kind = 2;
            for (int c = 0; c < 3; ++c) {
                double v = 0;
                if (!op_int(r2d_json_at(rgb, c), 0, 255, &v)) {
                    sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_COLOR", edits_path, NULL, NULL,
                             "%s.rgb[%d]: целое 0..255", where, c);
                    return false;
                }
                po->rgb[c] = (uint8_t)v;
            }
        } else {
            const char *name = r2d_json_str(r2d_json_get(op, "op"), "?");
            sdk_diag(rep, SDK_ERROR, "SDK_RE2D3_OP", edits_path, NULL, NULL,
                     "%s: неизвестная операция «%s» (bone, gloss, color)", where, name);
            return false;
        }
        *count = i + 1;
    }
    (void)png;
    return true;
}

static int apply_op(Re2d3Png *png, const PaintOp *po, const R2dJson *op)
{
    const R2dJson *rects = r2d_json_get(op, "rects");
    int painted = 0;
    for (int r = 0; r < r2d_json_size(rects); ++r) {
        const R2dJson *rect = r2d_json_at(rects, r);
        const int x = (int)r2d_json_num(r2d_json_at(rect, 0), 0);
        const int y = (int)r2d_json_num(r2d_json_at(rect, 1), 0);
        const int w = (int)r2d_json_num(r2d_json_at(rect, 2), 0);
        const int h = (int)r2d_json_num(r2d_json_at(rect, 3), 0);
        if (po->kind == 0) painted += re2d3_paint_bone(png, x, y, w, h, po->bones, po->weights);
        else if (po->kind == 1) painted += re2d3_paint_gloss(png, x, y, w, h, po->gloss);
        else painted += re2d3_paint_color(png, x, y, w, h, po->rgb);
    }
    return painted;
}

int sdk_cmd_re2d3_paint(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *input = sdk_arg_positional(a, 0);
    const char *edits_path = sdk_arg_value(a, "--edits");
    if (!input || !edits_path) {
        const int rc = sdk_fail(&rep, "SDK_USAGE",
            "Использование: r2d-sdk re2d3-paint <png | character.json> --edits правки.json [--out путь.png] [--model описание.json]");
        sdk_report_free(&rep);
        return rc;
    }
    char png_path[2048] = "";
    const char *model = NULL;
    bool ok = re2d_resolve_inputs(a, png_path, sizeof png_path, &model, &rep);
    const char *out_path = sdk_arg_value(a, "--out");
    if (ok && (!out_path || !out_path[0])) out_path = png_path;

    Re2d3Png png;
    memset(&png, 0, sizeof png);
    if (ok && !re2d3_open(png_path, &png)) {
        sdk_diag(&rep, SDK_ERROR, "SDK_RE2D3_FORMAT", png_path, NULL, NULL, "PNG не найден или не читается: %s", png_path);
        ok = false;
    }
    if (ok && (!png.header_ok || !png.size_ok)) {
        Re2d3Stats st;
        re2d3_stats(&png, &st);
        re2d3_validate_png(png_path, &png, &st, &rep);
        ok = false;
    }
    if (ok && !png.editable) {
        char d[64];
        snprintf(d, sizeof d, "{\"layers\":%d}", png.layers);
        sdk_diag(&rep, SDK_ERROR, "SDK_RE2D3_LAYERS", png_path, NULL, d,
                 "Правка сетки поддержана только для контейнера с %d слоями (у этого %d)", RE2D3_LAYERS, png.layers);
        ok = false;
    }

    PaintOp *ops = NULL;
    int ops_count = 0, painted = 0;
    if (ok) {
        R2dJson *root = sdk_load_json(edits_path, &rep);
        if (!root) {
            ok = false;
        } else {
            ops = (PaintOp *)calloc(RE2D3_MAX_OPS, sizeof *ops);
            if (!ops) {
                sdk_diag(&rep, SDK_ERROR, "SDK_RE2D3_MEMORY", edits_path, NULL, NULL, "Не хватило памяти на операции");
                ok = false;
            } else {
                ok = read_ops(edits_path, root, &png, ops, RE2D3_MAX_OPS, &ops_count, &rep);
                for (int i = 0; ok && i < ops_count; ++i) painted += apply_op(&png, &ops[i], r2d_json_at(r2d_json_get(root, "ops"), i));
            }
            r2d_json_free(root);
        }
    }

    bool written = false;
    if (ok) {
        char dir[1024];
        sdk_dirname(out_path, dir, sizeof dir);
        if (!sdk_is_dir(dir)) SDL_CreateDirectory(dir);
        written = re2d3_write(&png, out_path);
        if (!written) sdk_diag(&rep, SDK_ERROR, "SDK_WRITE_FAILED", out_path, NULL, NULL, "Не удалось записать %s", out_path);
    }

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", written && rep.errors == 0 ? "true" : "false");
    sdk_put_kv_str(&out, "format", png.header_ok ? "v3" : NULL);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "out", written ? out_path : NULL);
    if (png.px && png.size_ok) r2d_sb_printf(&out, ",\"grid\":[%d,%d]", png.tw, png.th);
    r2d_sb_printf(&out, ",\"ops\":%d,\"painted\":%d,", ops_count, painted);
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);
    const int rc = written && rep.errors == 0 ? 0 : 1;
    free(ops);
    r2d_sb_free(&out);
    if (png.px) re2d3_close(&png);
    sdk_report_free(&rep);
    return rc;
}
