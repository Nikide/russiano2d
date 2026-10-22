// ===========================================================================
// r2d pixel-art <spec.json> — рисование пиксель-арта для агентов и скриптов.
//
// Спецификация (JSON):
//   base     — существующий PNG для правки (иначе новый холст: size или размер по rows/frames)
//   size     — [w, h] нового холста (1..512)
//   palette  — { "k": "#111111", "g": "#33aa77", ".": null }   ключ — один символ; null — прозрачный
//   rows     — ["..kkkk..", ...]  строки-пиксели: символ из палитры задаёт цвет, остальные — «не трогать»
//   at       — [x, y] смещение rows
//   frames   — [ { "rows": [...] }, ... ] или [[...], ...]: кадры в один ряд (лист)
//   ops      — операции (см. apply_op): set, rect, line, ellipse, fill, replace, flip, mirror, shift, outline, clear
//   scale    — целое 1..16: итоговый PNG увеличивается без сглаживания
//   out      — куда записать PNG (необязательно: без out — только «чтение» холста)
//   preview  — путь второго PNG с крупным увеличением для показа человеку (previewScale: 1..32)
//
// Ответ — JSON: размеры, ascii (холст символами палитры: «видит» модель без зрения), legend, opaque.
// Цвет в ops.c: символ палитры ("k") или "#rrggbb"/"#rrggbbaa"/"#rgb"; "transparent" — стирание.
// ===========================================================================
#include "sdk.h"
#include "json.h"

#include <SDL3/SDL.h>
#include <ctype.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

typedef struct { uint8_t r, g, b, a; } Px;
typedef struct { char key; Px c; } PalEntry;

#define PX_MAX_SIZE 512
#define PX_MAX_PAL 64

typedef struct {
    Px *cv;
    int w, h;
    PalEntry pal[PX_MAX_PAL];
    int npal;
} Canvas;

static int fail(const char *code, const char *msg)
{
    R2dSb out; r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"ok\":false,\"code\":");
    r2d_sb_put_json_string(&out, code);
    r2d_sb_puts(&out, ",\"message\":");
    r2d_sb_put_json_string(&out, msg);
    r2d_sb_putc(&out, '}');
    printf("%s\n", out.data);
    r2d_sb_free(&out);
    return 2;
}

static int hexv(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// "#rgb", "#rrggbb", "#rrggbbaa"; "transparent"/"none"/"" — прозрачный. false — не разобран.
static bool parse_color(const char *s, Px *out)
{
    if (!s) return false;
    if (!*s || !strcmp(s, "transparent") || !strcmp(s, "none")) { out->r = out->g = out->b = out->a = 0; return true; }
    if (*s != '#') return false;
    const size_t n = strlen(s + 1);
    int v[8];
    if (n != 3 && n != 6 && n != 8) return false;
    for (size_t i = 0; i < n; ++i) { v[i] = hexv(s[1 + i]); if (v[i] < 0) return false; }
    if (n == 3) { out->r = (uint8_t)(v[0] * 17); out->g = (uint8_t)(v[1] * 17); out->b = (uint8_t)(v[2] * 17); out->a = 255; }
    else {
        out->r = (uint8_t)(v[0] * 16 + v[1]); out->g = (uint8_t)(v[2] * 16 + v[3]); out->b = (uint8_t)(v[4] * 16 + v[5]);
        out->a = n == 8 ? (uint8_t)(v[6] * 16 + v[7]) : 255;
    }
    return true;
}

static const PalEntry *pal_find(const Canvas *c, char key)
{
    for (int i = 0; i < c->npal; ++i) if (c->pal[i].key == key) return &c->pal[i];
    return NULL;
}

// Цвет из JSON-значения: ключ палитры (один символ, найденный в ней) или hex.
static bool color_of(const Canvas *c, const R2dJson *v, Px *out)
{
    if (!v) return false;
    if (v->type == R2D_JSON_NULL) { out->r = out->g = out->b = out->a = 0; return true; }
    if (v->type != R2D_JSON_STR) return false;
    const char *s = r2d_json_str(v, "");
    if (s[0] && !s[1]) { const PalEntry *p = pal_find(c, s[0]); if (p) { *out = p->c; return true; } }
    return parse_color(s, out);
}

static Px *at(Canvas *c, int x, int y) { return (x >= 0 && y >= 0 && x < c->w && y < c->h) ? &c->cv[(size_t)y * c->w + x] : NULL; }
static bool same(Px a, Px b) { return a.r == b.r && a.g == b.g && a.b == b.b && a.a == b.a; }

static void put(Canvas *c, int x, int y, Px p) { Px *d = at(c, x, y); if (d) *d = p; }

static void draw_line(Canvas *c, int x0, int y0, int x1, int y1, Px p)
{
    const int dx = abs(x1 - x0), dy = -abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    int err = dx + dy;
    for (int guard = 0; guard < 4 * PX_MAX_SIZE; ++guard) {
        put(c, x0, y0, p);
        if (x0 == x1 && y0 == y1) break;
        const int e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
    }
}

static void flood(Canvas *c, int x, int y, Px to)
{
    Px *start = at(c, x, y);
    if (!start) return;
    const Px from = *start;
    if (same(from, to)) return;
    const size_t cap = (size_t)c->w * c->h;
    int *stack = (int *)malloc(cap * sizeof(int) * 2);
    if (!stack) return;
    size_t sp = 0;
    stack[sp++] = x; stack[sp++] = y;
    while (sp) {
        const int cy = stack[--sp], cx = stack[--sp];
        Px *d = at(c, cx, cy);
        if (!d || !same(*d, from)) continue;
        *d = to;
        if (sp + 8 > cap * 2) continue;   // защита от переполнения стека
        stack[sp++] = cx + 1; stack[sp++] = cy;
        stack[sp++] = cx - 1; stack[sp++] = cy;
        stack[sp++] = cx; stack[sp++] = cy + 1;
        stack[sp++] = cx; stack[sp++] = cy - 1;
    }
    free(stack);
}

static void draw_rows(Canvas *c, const R2dJson *rows, int ox, int oy)
{
    for (int y = 0; y < r2d_json_size(rows); ++y) {
        const char *row = r2d_json_str(r2d_json_at(rows, y), "");
        for (int x = 0; row[x]; ++x) {
            const PalEntry *p = pal_find(c, row[x]);
            if (p) put(c, ox + x, oy + y, p->c);
        }
    }
}

// Одна операция из ops. Возвращает сообщение об ошибке или NULL.
static const char *apply_op(Canvas *c, const R2dJson *op)
{
    const char *kind = r2d_json_str(r2d_json_get(op, "op"), "");
    Px col = {0, 0, 0, 255};
    const R2dJson *cj = r2d_json_get(op, "c");
    const bool has_color = cj != NULL;
    if (has_color && !color_of(c, cj, &col)) return "неизвестный цвет c (ключ палитры или #rrggbb)";
    const int x = r2d_json_int(r2d_json_get(op, "x"), 0), y = r2d_json_int(r2d_json_get(op, "y"), 0);
    if (!strcmp(kind, "set")) { if (!has_color) return "set: нужен c"; put(c, x, y, col); }
    else if (!strcmp(kind, "rect")) {
        if (!has_color) return "rect: нужен c";
        const int w = r2d_json_int(r2d_json_get(op, "w"), 1), h = r2d_json_int(r2d_json_get(op, "h"), 1);
        const bool fill = r2d_json_bool(r2d_json_get(op, "fill"), true);
        for (int j = 0; j < h; ++j)
            for (int i = 0; i < w; ++i)
                if (fill || i == 0 || j == 0 || i == w - 1 || j == h - 1) put(c, x + i, y + j, col);
    } else if (!strcmp(kind, "line")) {
        if (!has_color) return "line: нужен c";
        draw_line(c, r2d_json_int(r2d_json_get(op, "x0"), 0), r2d_json_int(r2d_json_get(op, "y0"), 0),
                  r2d_json_int(r2d_json_get(op, "x1"), 0), r2d_json_int(r2d_json_get(op, "y1"), 0), col);
    } else if (!strcmp(kind, "ellipse")) {
        if (!has_color) return "ellipse: нужен c";
        const double cx = r2d_json_num(r2d_json_get(op, "cx"), 0), cy = r2d_json_num(r2d_json_get(op, "cy"), 0);
        const double rx = r2d_json_num(r2d_json_get(op, "rx"), 1), ry = r2d_json_num(r2d_json_get(op, "ry"), 1);
        const bool fill = r2d_json_bool(r2d_json_get(op, "fill"), true);
        if (rx <= 0 || ry <= 0) return "ellipse: rx и ry должны быть > 0";
        for (int j = 0; j < c->h; ++j)
            for (int i = 0; i < c->w; ++i) {
                const double nx = (i - cx) / rx, ny = (j - cy) / ry, d = nx * nx + ny * ny;
                const double inner = fill ? 0.0 : fmax(0.0, 1.0 - 1.6 / fmin(rx, ry));
                if (d <= 1.0 && d >= inner * inner) put(c, i, j, col);
            }
    } else if (!strcmp(kind, "fill")) { if (!has_color) return "fill: нужен c"; flood(c, x, y, col); }
    else if (!strcmp(kind, "replace")) {
        Px from, to;
        if (!color_of(c, r2d_json_get(op, "from"), &from) || !color_of(c, r2d_json_get(op, "to"), &to)) return "replace: нужны from и to";
        for (size_t i = 0; i < (size_t)c->w * c->h; ++i) if (same(c->cv[i], from)) c->cv[i] = to;
    } else if (!strcmp(kind, "flip")) {
        const char *axis = r2d_json_str(r2d_json_get(op, "axis"), "h");
        for (int j = 0; j < c->h; ++j)
            for (int i = 0; i < c->w; ++i) {
                if (axis[0] == 'h' && i < c->w / 2) { Px t = *at(c, i, j); *at(c, i, j) = *at(c, c->w - 1 - i, j); *at(c, c->w - 1 - i, j) = t; }
                if (axis[0] == 'v' && j < c->h / 2) { Px t = *at(c, i, j); *at(c, i, j) = *at(c, i, c->h - 1 - j); *at(c, i, c->h - 1 - j) = t; }
            }
    } else if (!strcmp(kind, "mirror")) {
        // зеркалит левую половину на правую (axis h) или верхнюю на нижнюю (axis v): рисуй половину — получай симметрию
        const char *axis = r2d_json_str(r2d_json_get(op, "axis"), "h");
        for (int j = 0; j < c->h; ++j)
            for (int i = 0; i < c->w; ++i) {
                if (axis[0] == 'h' && i < c->w / 2) *at(c, c->w - 1 - i, j) = *at(c, i, j);
                if (axis[0] == 'v' && j < c->h / 2) *at(c, i, c->h - 1 - j) = *at(c, i, j);
            }
    } else if (!strcmp(kind, "shift")) {
        const int dx = r2d_json_int(r2d_json_get(op, "dx"), 0), dy = r2d_json_int(r2d_json_get(op, "dy"), 0);
        Px *copy = (Px *)malloc((size_t)c->w * c->h * sizeof(Px));
        if (!copy) return "нет памяти";
        memcpy(copy, c->cv, (size_t)c->w * c->h * sizeof(Px));
        for (int j = 0; j < c->h; ++j)
            for (int i = 0; i < c->w; ++i) {
                const int sx = i - dx, sy = j - dy;
                c->cv[(size_t)j * c->w + i] = (sx >= 0 && sy >= 0 && sx < c->w && sy < c->h) ? copy[(size_t)sy * c->w + sx] : (Px){0, 0, 0, 0};
            }
        free(copy);
    } else if (!strcmp(kind, "outline")) {
        if (!has_color) return "outline: нужен c";
        Px *copy = (Px *)malloc((size_t)c->w * c->h * sizeof(Px));
        if (!copy) return "нет памяти";
        memcpy(copy, c->cv, (size_t)c->w * c->h * sizeof(Px));
        for (int j = 0; j < c->h; ++j)
            for (int i = 0; i < c->w; ++i) {
                if (copy[(size_t)j * c->w + i].a >= 128) continue;
                static const int d[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
                for (int k = 0; k < 4; ++k) {
                    const int nx = i + d[k][0], ny = j + d[k][1];
                    if (nx >= 0 && ny >= 0 && nx < c->w && ny < c->h && copy[(size_t)ny * c->w + nx].a >= 128) { c->cv[(size_t)j * c->w + i] = col; break; }
                }
            }
        free(copy);
    } else if (!strcmp(kind, "clear")) memset(c->cv, 0, (size_t)c->w * c->h * sizeof(Px));
    else return "неизвестная операция (set, rect, line, ellipse, fill, replace, flip, mirror, shift, outline, clear)";
    return NULL;
}

static Px *upscale(const Px *src, int w, int h, int s)
{
    Px *dst = (Px *)malloc((size_t)w * s * h * s * sizeof(Px));
    if (!dst) return NULL;
    for (int y = 0; y < h * s; ++y)
        for (int x = 0; x < w * s; ++x) dst[(size_t)y * w * s + x] = src[(size_t)(y / s) * w + (x / s)];
    return dst;
}

static void make_parent(const char *path)
{
    char dir[2048];
    sdk_dirname(path, dir, sizeof dir);
    if (dir[0]) SDL_CreateDirectory(dir);
}

static bool write_png(const char *path, const Px *px, int w, int h)
{
    make_parent(path);
    return sdk_image_write_png(path, (const uint8_t *)px, w, h);
}

int sdk_cmd_pixel_art(const SdkArgs *a)
{
    const char *spec_path = sdk_arg_positional(a, 0);
    if (!spec_path || !spec_path[0]) return fail("SDK_USAGE", "r2d pixel-art <spec.json>");
    size_t size = 0;
    char *text = sdk_read_file(spec_path, &size);
    if (!text) return fail("SDK_PIXEL_SPEC", "не удалось прочитать спецификацию");
    char err[160];
    R2dJson *spec = r2d_json_parse(text, err, sizeof err);
    free(text);
    if (!spec || spec->type != R2D_JSON_OBJ) { r2d_json_free(spec); return fail("SDK_PIXEL_SPEC", "спецификация — не JSON-объект"); }

    Canvas c;
    memset(&c, 0, sizeof c);
    int rc = 2;
    const char *msg = NULL;

    // палитра
    const R2dJson *pal = r2d_json_get(spec, "palette");
    if (pal && pal->type == R2D_JSON_OBJ) {
        for (int i = 0; i < pal->count && c.npal < PX_MAX_PAL; ++i) {
            const char *key = pal->keys[i];
            Px p;
            const R2dJson *v = pal->items[i];
            const bool ok = v->type == R2D_JSON_NULL ? (p = (Px){0, 0, 0, 0}, true) : parse_color(r2d_json_str(v, ""), &p);
            if (!key || !key[0] || key[1] || !ok) { msg = "palette: ключ — один символ, значение — #rrggbb[aa] или null"; goto done; }
            c.pal[c.npal].key = key[0];
            c.pal[c.npal].c = p;
            ++c.npal;
        }
    }

    // холст: base | size | rows | frames
    const R2dJson *frames = r2d_json_get(spec, "frames");
    const R2dJson *rows = r2d_json_get(spec, "rows");
    const char *base = r2d_json_str(r2d_json_get(spec, "base"), "");
    int fw = 0, fh = 0, nframes = 0;
    if (base[0]) {
        int w = 0, h = 0;
        uint8_t *px = sdk_image_load_rgba(base, &w, &h);
        if (!px || w < 1 || h < 1 || w > PX_MAX_SIZE * 4 || h > PX_MAX_SIZE * 4) { if (px) sdk_image_free(px); msg = "base: не удалось прочитать PNG (или он слишком большой)"; goto done; }
        c.w = w; c.h = h;
        c.cv = (Px *)malloc((size_t)w * h * sizeof(Px));
        if (c.cv) memcpy(c.cv, px, (size_t)w * h * sizeof(Px));
        sdk_image_free(px);
    } else {
        const R2dJson *sz = r2d_json_get(spec, "size");
        if (frames && frames->type == R2D_JSON_ARR && r2d_json_size(frames) > 0) {
            nframes = r2d_json_size(frames);
            for (int f = 0; f < nframes; ++f) {
                const R2dJson *fr = r2d_json_at(frames, f);
                const R2dJson *fr_rows = fr->type == R2D_JSON_ARR ? fr : r2d_json_get(fr, "rows");
                const int h = fr_rows ? r2d_json_size(fr_rows) : 0;
                int w = 0;
                for (int y = 0; y < h; ++y) { const int l = (int)strlen(r2d_json_str(r2d_json_at(fr_rows, y), "")); if (l > w) w = l; }
                if (w > fw) fw = w;
                if (h > fh) fh = h;
            }
            if (sz && r2d_json_size(sz) == 2) { fw = r2d_json_int(r2d_json_at(sz, 0), fw); fh = r2d_json_int(r2d_json_at(sz, 1), fh); }
            c.w = fw * nframes; c.h = fh;
        } else if (sz && r2d_json_size(sz) == 2) {
            c.w = r2d_json_int(r2d_json_at(sz, 0), 0); c.h = r2d_json_int(r2d_json_at(sz, 1), 0);
        } else if (rows && rows->type == R2D_JSON_ARR) {
            c.h = r2d_json_size(rows);
            for (int y = 0; y < c.h; ++y) { const int l = (int)strlen(r2d_json_str(r2d_json_at(rows, y), "")); if (l > c.w) c.w = l; }
        }
        if (c.w < 1 || c.h < 1 || c.w > PX_MAX_SIZE || c.h > PX_MAX_SIZE) { msg = "нужен холст: base, size [w,h] (1..512), rows или frames"; goto done; }
        c.cv = (Px *)calloc((size_t)c.w * c.h, sizeof(Px));
    }
    if (!c.cv) { msg = "нет памяти под холст"; goto done; }

    if (nframes) {
        for (int f = 0; f < nframes; ++f) {
            const R2dJson *fr = r2d_json_at(frames, f);
            const R2dJson *fr_rows = fr->type == R2D_JSON_ARR ? fr : r2d_json_get(fr, "rows");
            if (fr_rows) draw_rows(&c, fr_rows, f * fw, 0);
        }
    }
    if (rows && rows->type == R2D_JSON_ARR && !nframes) {
        const R2dJson *atj = r2d_json_get(spec, "at");
        draw_rows(&c, rows, atj ? r2d_json_int(r2d_json_at(atj, 0), 0) : 0, atj ? r2d_json_int(r2d_json_at(atj, 1), 0) : 0);
    }
    const R2dJson *ops = r2d_json_get(spec, "ops");
    for (int i = 0; ops && i < r2d_json_size(ops); ++i) {
        const char *e = apply_op(&c, r2d_json_at(ops, i));
        if (e) { static char buf[200]; snprintf(buf, sizeof buf, "ops[%d]: %s", i, e); msg = buf; goto done; }
    }

    // запись
    const char *out_path = r2d_json_str(r2d_json_get(spec, "out"), "");
    const int scale = r2d_json_int(r2d_json_get(spec, "scale"), 1);
    if (scale < 1 || scale > 16) { msg = "scale: целое 1..16"; goto done; }
    if (out_path[0]) {
        Px *big = scale > 1 ? upscale(c.cv, c.w, c.h, scale) : NULL;
        const bool ok = write_png(out_path, big ? big : c.cv, c.w * scale, c.h * scale);
        free(big);
        if (!ok) { msg = "не удалось записать PNG (out)"; goto done; }
    }
    const char *prev_path = r2d_json_str(r2d_json_get(spec, "preview"), "");
    int pscale = r2d_json_int(r2d_json_get(spec, "previewScale"), 0);
    if (prev_path[0]) {
        if (pscale < 1) { const int m = c.w > c.h ? c.w : c.h; pscale = m ? 192 / m : 1; if (pscale < 1) pscale = 1; }
        if (pscale > 32) pscale = 32;
        Px *big = upscale(c.cv, c.w, c.h, pscale);
        const bool ok = big && write_png(prev_path, big, c.w * pscale, c.h * pscale);
        free(big);
        if (!ok) { msg = "не удалось записать preview"; goto done; }
    }

    // ответ: ASCII-срез холста символами палитры (или авто-алфавитом)
    {
        char auto_keys[64];
        Px auto_cols[64];
        int nauto = 0;
        static const char alphabet[] = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        R2dSb o; r2d_sb_init(&o);
        r2d_sb_printf(&o, "{\"ok\":true,\"width\":%d,\"height\":%d,\"outWidth\":%d,\"outHeight\":%d", c.w, c.h, c.w * scale, c.h * scale);
        if (nframes) r2d_sb_printf(&o, ",\"frames\":%d,\"frameWidth\":%d,\"frameHeight\":%d", nframes, fw, fh);
        if (out_path[0]) { r2d_sb_puts(&o, ",\"out\":"); r2d_sb_put_json_string(&o, out_path); }
        if (prev_path[0]) { r2d_sb_puts(&o, ",\"preview\":"); r2d_sb_put_json_string(&o, prev_path); }
        size_t opaque = 0;
        if (c.w <= 96 && c.h <= 96) r2d_sb_puts(&o, ",\"ascii\":[");
        for (int y = 0; y < c.h; ++y) {
            char line[PX_MAX_SIZE + 1];
            for (int x = 0; x < c.w && x < PX_MAX_SIZE; ++x) {
                const Px p = c.cv[(size_t)y * c.w + x];
                char ch = '.';
                if (p.a >= 128) {
                    ++opaque;
                    int best = -1; long bd = 1L << 30;
                    for (int i = 0; i < c.npal; ++i) {
                        if (c.pal[i].c.a < 128) continue;
                        const long dr = p.r - c.pal[i].c.r, dg = p.g - c.pal[i].c.g, db = p.b - c.pal[i].c.b, d = dr * dr + dg * dg + db * db;
                        if (d < bd) { bd = d; best = i; }
                    }
                    if (best >= 0 && (bd == 0 || c.npal > 0)) ch = c.pal[best].key;
                    if (c.npal == 0 || bd != 0) {
                        int k = -1;
                        for (int i = 0; i < nauto; ++i) if (same((Px){auto_cols[i].r, auto_cols[i].g, auto_cols[i].b, 255}, (Px){p.r, p.g, p.b, 255})) { k = i; break; }
                        if (k < 0 && nauto < 62) { auto_cols[nauto] = p; auto_keys[nauto] = alphabet[nauto]; k = nauto++; }
                        if (c.npal == 0) ch = k >= 0 ? auto_keys[k] : '?';
                    }
                }
                line[x] = ch;
            }
            line[c.w < PX_MAX_SIZE ? c.w : PX_MAX_SIZE] = '\0';
            if (c.w <= 96 && c.h <= 96) { if (y) r2d_sb_putc(&o, ','); r2d_sb_put_json_string(&o, line); }
        }
        if (c.w <= 96 && c.h <= 96) r2d_sb_putc(&o, ']');
        r2d_sb_printf(&o, ",\"opaque\":%zu,\"legend\":{", opaque);
        const int shown = c.npal ? c.npal : nauto;
        for (int i = 0; i < shown; ++i) {
            const Px p = c.npal ? c.pal[i].c : auto_cols[i];
            char key[2] = { c.npal ? c.pal[i].key : auto_keys[i], 0 };
            char hex[16];
            if (c.npal && p.a < 128) snprintf(hex, sizeof hex, "transparent"); else snprintf(hex, sizeof hex, "#%02x%02x%02x", p.r, p.g, p.b);
            if (i) r2d_sb_putc(&o, ',');
            r2d_sb_put_json_string(&o, key);
            r2d_sb_putc(&o, ':');
            r2d_sb_put_json_string(&o, hex);
        }
        r2d_sb_puts(&o, "}}");
        printf("%s\n", o.data);
        r2d_sb_free(&o);
        rc = 0;
    }

done:
    free(c.cv);
    r2d_json_free(spec);
    if (msg) return fail("SDK_PIXEL_SPEC", msg);
    return rc;
}
