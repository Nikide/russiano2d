// ===========================================================================
// Нативные проверки форматов студий данных (docs/SDK.md §8):
//   *.tilemap.json, *.particles.json, *.collision.json, *.layers.json,
//   *.fonts.json, *.audio.json, *.input.json, *.rml, *.rcss
//
// Правила и коды повторяют чистые модули sdk/lib/kinds/*.js и
// sdk/lib/rml_model.js: QuickJS в инструментах запрещён, поэтому проверка
// продублирована в C, а паритет «принять/отвергнуть и коды» держит
// tests/agent/sdk_data_parity_test.py на корпусе правок. Тексты сообщений
// краткие; значимы code, severity и location.
// ===========================================================================
#include "sdk.h"

#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Помощники
// ---------------------------------------------------------------------------
typedef struct Ctx {
    SdkReport *rep;
    const char *asset;
    const char *prefix;
} Ctx;

static void emit(const Ctx *c, SdkSeverity sev, const char *suffix, const char *loc, const char *fmt, ...)
{
    char code[96];
    snprintf(code, sizeof code, "%s%s", c->prefix, suffix);
    va_list ap;
    va_start(ap, fmt);
    sdk_diagv(c->rep, sev, code, c->asset, loc, NULL, fmt, ap);
    va_end(ap);
}

static bool is_obj(const R2dJson *v) { return v && v->type == R2D_JSON_OBJ; }
static bool is_arr(const R2dJson *v) { return v && v->type == R2D_JSON_ARR; }
static bool is_str(const R2dJson *v) { return v && v->type == R2D_JSON_STR; }
static bool is_bool(const R2dJson *v) { return v && v->type == R2D_JSON_BOOL; }
static bool is_num(const R2dJson *v) { return v && v->type == R2D_JSON_NUM && isfinite(v->number); }
static bool is_int(const R2dJson *v) { return is_num(v) && floor(v->number) == v->number; }
static bool int_in(const R2dJson *v, double lo, double hi) { return is_int(v) && v->number >= lo && v->number <= hi; }
static bool num_in(const R2dJson *v, double lo, double hi) { return is_num(v) && v->number >= lo && v->number <= hi; }
static bool nonempty_str(const R2dJson *v) { return is_str(v) && v->string && v->string[0]; }

static const R2dJson *field(const R2dJson *o, const char *k) { return r2d_json_get(o, k); }

static bool name_ok(const char *s, size_t max)
{
    if (!s || !s[0] || strlen(s) > max) return false;
    for (const char *p = s; *p; ++p) {
        const bool good = (*p >= 'A' && *p <= 'Z') || (*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '_' || *p == '-';
        if (!good) return false;
    }
    return true;
}

static bool icase_eq(const char *a, const char *b)
{
    for (; *a && *b; ++a, ++b) {
        char x = *a, y = *b;
        if (x >= 'A' && x <= 'Z') x = (char)(x - 'A' + 'a');
        if (y >= 'A' && y <= 'Z') y = (char)(y - 'A' + 'a');
        if (x != y) return false;
    }
    return *a == *b;
}

static bool in_list(const char *s, const char *const *list)
{
    for (int i = 0; list[i]; ++i) if (strcmp(s, list[i]) == 0) return true;
    return false;
}

static int hexval(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// Разбор «\s*\d{1,3}\s*» для rgb()/rgba().
static const char *skip_ws(const char *p) { while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r' || *p == '\f' || *p == '\v') ++p; return p; }
static const char *digits13(const char *p)
{
    int n = 0;
    while (*p >= '0' && *p <= '9') { ++p; ++n; }
    return n >= 1 && n <= 3 ? p : NULL;
}

static bool color_ok(const R2dJson *v)
{
    if (!nonempty_str(v)) return false;
    const char *s = v->string;
    if (s[0] == '#') {
        const size_t n = strlen(s + 1);
        if (n != 3 && n != 4 && n != 6 && n != 8) return false;
        for (size_t i = 1; i <= n; ++i) if (hexval(s[i]) < 0) return false;
        return true;
    }
    if (strncmp(s, "rgb", 3) == 0) {
        const char *p = s + 3;
        if (*p == 'a') ++p;
        if (*p != '(') goto named;
        ++p;
        for (int k = 0; k < 3; ++k) {
            p = skip_ws(p);
            p = digits13(p);
            if (!p) goto named;
            p = skip_ws(p);
            if (k < 2) { if (*p != ',') goto named; ++p; }
        }
        if (*p == ',') {
            ++p;
            p = skip_ws(p);
            int n = 0;
            while ((*p >= '0' && *p <= '9') || *p == '.') { ++p; ++n; }
            if (n < 1) goto named;
            p = skip_ws(p);
        }
        if (*p != ')' || p[1] != '\0') goto named;
        return true;
    }
named:;
    static const char *const names[] = { "black", "white", "red", "green", "blue", "yellow", "orange", "purple", "gray", "grey",
        "cyan", "magenta", "pink", "brown", "transparent", NULL };
    for (int i = 0; names[i]; ++i) if (icase_eq(s, names[i])) return true;
    return false;
}

// Корень и версия — одинаковы у всех форматов.
static R2dJson *load_root(const Ctx *c, const char *path)
{
    R2dJson *root = sdk_load_json(path, c->rep);
    if (!root) return NULL;
    if (!is_obj(root)) {
        emit(c, SDK_ERROR, "_ROOT", NULL, "Корень файла должен быть JSON-объектом");
        r2d_json_free(root);
        return NULL;
    }
    const R2dJson *ver = field(root, "version");
    if (!(ver && ver->type == R2D_JSON_NUM && ver->number == 1)) {
        emit(c, SDK_ERROR, "_VERSION", "{\"field\":\"version\"}", "Поддерживается version: 1");
    }
    return root;
}

static void dup_names(const Ctx *c, const R2dJson *arr, const char *label)
{
    for (int i = 0; i < arr->count; ++i) {
        const R2dJson *a = arr->items[i];
        if (!is_obj(a) || !nonempty_str(field(a, "name"))) continue;
        for (int j = 0; j < i; ++j) {
            const R2dJson *b = arr->items[j];
            if (is_obj(b) && nonempty_str(field(b, "name")) && strcmp(field(b, "name")->string, field(a, "name")->string) == 0) {
                char loc[96];
                snprintf(loc, sizeof loc, "{\"index\":%d,\"first\":%d}", i, j);
                emit(c, SDK_WARNING, "_DUPLICATE_NAME", loc, "%s «%s» встречается повторно", label, field(a, "name")->string);
                break;
            }
        }
    }
}

static const char *obj_key_at(const R2dJson *o, int i) { return o->keys[i]; }

// ---------------------------------------------------------------------------
// tilemap
// ---------------------------------------------------------------------------
static bool solid_ok(const R2dJson *v)
{
    if (is_bool(v)) return true;
    if (!is_arr(v)) return false;
    for (int i = 0; i < v->count; ++i) if (!int_in(v->items[i], 1, 65535)) return false;
    return true;
}

void sdk_validate_tilemap(const char *path, SdkReport *rep)
{
    Ctx c = { rep, path, "SDK_TILEMAP" };
    R2dJson *root = load_root(&c, path);
    if (!root) return;
    if (!int_in(field(root, "tile"), 1, 512)) emit(&c, SDK_ERROR, "_FIELD", "{\"field\":\"tile\"}", "tile — целое 1..512");
    const R2dJson *src = field(root, "src");
    if (src && !is_str(src)) emit(&c, SDK_ERROR, "_FIELD", "{\"field\":\"src\"}", "src должен быть строкой");
    else if (!src || !src->string || !src->string[0]) emit(&c, SDK_WARNING, "_NO_SRC", "{\"field\":\"src\"}", "Тайлсет (src) не задан");
    const R2dJson *cols = field(root, "cols");
    if (cols && !int_in(cols, 1, 1024)) emit(&c, SDK_ERROR, "_FIELD", "{\"field\":\"cols\"}", "cols — целое 1..1024");
    const R2dJson *solid = field(root, "solid");
    if (solid && !solid_ok(solid)) emit(&c, SDK_ERROR, "_FIELD", "{\"field\":\"solid\"}", "solid — bool или массив id");
    const R2dJson *at = field(root, "autotile");
    if (at) {
        const R2dJson *mode = field(at, "mode"), *base = field(at, "base");
        const bool ok = is_obj(at) && is_str(mode) && (strcmp(mode->string, "bit16") == 0 || strcmp(mode->string, "blob47") == 0) && (!base || int_in(base, 1, 65535));
        if (!ok) emit(&c, SDK_ERROR, "_AUTOTILE", "{\"field\":\"autotile\"}", "autotile: { mode, base? }");
    }
    const R2dJson *layers = field(root, "layers");
    if (!is_arr(layers) || layers->count < 1 || layers->count > 16) {
        emit(&c, SDK_ERROR, "_LAYERS", "{\"field\":\"layers\"}", "layers — массив из 1..16 слоёв");
        r2d_json_free(root);
        return;
    }
    for (int li = 0; li < layers->count; ++li) {
        const R2dJson *l = layers->items[li];
        char loc[96];
        snprintf(loc, sizeof loc, "{\"layer\":%d}", li);
        if (!is_obj(l)) { emit(&c, SDK_ERROR, "_LAYER", loc, "Слой %d должен быть объектом", li); continue; }
        const R2dJson *nm = field(l, "name"), *depth = field(l, "depth"), *ls = field(l, "solid");
        if (nm && !is_str(nm)) emit(&c, SDK_ERROR, "_LAYER", loc, "name слоя — строка");
        if (depth && !is_num(depth)) emit(&c, SDK_ERROR, "_LAYER", loc, "depth слоя — число");
        if (ls && !solid_ok(ls)) emit(&c, SDK_ERROR, "_LAYER", loc, "solid слоя — bool или массив id");
        const R2dJson *data = field(l, "data");
        bool shape_ok = is_arr(data) && data->count >= 1 && data->count <= 1024;
        if (shape_ok) for (int y = 0; y < data->count; ++y) {
            const R2dJson *r = data->items[y];
            if (!(is_arr(r) && r->count >= 1 && r->count <= 1024)) { shape_ok = false; break; }
        }
        if (!shape_ok) { emit(&c, SDK_ERROR, "_DATA", loc, "data слоя %d — массив строк-массивов 1..1024", li); continue; }
        const int w = data->items[0]->count;
        bool uniform = true;
        for (int y = 0; y < data->count; ++y) if (data->items[y]->count != w) { uniform = false; break; }
        if (!uniform) { emit(&c, SDK_ERROR, "_SHAPE", loc, "Строки слоя %d разной длины", li); continue; }
        if ((double)w * data->count > 1000000.0) { emit(&c, SDK_ERROR, "_SIZE", loc, "Слой %d слишком велик", li); continue; }
        int bad = 0;
        bool any = false;
        for (int y = 0; y < data->count; ++y) for (int x = 0; x < w; ++x) {
            const R2dJson *id = data->items[y]->items[x];
            if (!int_in(id, 0, 65535)) bad++;
            else if (id->number > 0) any = true;
        }
        if (bad) emit(&c, SDK_ERROR, "_TILE_ID", loc, "Слой %d: %d тайл(ов) вне 0..65535", li, bad);
        else if (!any) emit(&c, SDK_WARNING, "_EMPTY_LAYER", loc, "Слой %d пуст", li);
    }
    dup_names(&c, layers, "Слой");
    r2d_json_free(root);
}

// ---------------------------------------------------------------------------
// particles
// ---------------------------------------------------------------------------
static bool range_ok(const R2dJson *v, double lo, bool strict)
{
#define GOOD(x) (strict ? (x) > lo : (x) >= lo)
    if (is_num(v)) return GOOD(v->number);
    return is_arr(v) && v->count == 2 && is_num(v->items[0]) && is_num(v->items[1]) &&
           GOOD(v->items[0]->number) && v->items[0]->number <= v->items[1]->number;
#undef GOOD
}

static bool pair_or_num(const R2dJson *v)
{
    if (is_num(v)) return true;
    return is_arr(v) && v->count == 2 && is_num(v->items[0]) && is_num(v->items[1]) && v->items[0]->number <= v->items[1]->number;
}

// Значение стопа как читает рантайм: color затем value; для alpha/size — value затем свой ключ.
static const R2dJson *stop_value(const R2dJson *k, const char *key)
{
    if (strcmp(key, "color") == 0) return field(k, "color") ? field(k, "color") : field(k, "value");
    return field(k, "value") ? field(k, "value") : field(k, key);
}

static bool ramp_ok(const R2dJson *v, const char *key)
{
    if (!is_arr(v) || v->count < 1 || v->count > 32) return false;
    double prev = -1;
    for (int i = 0; i < v->count; ++i) {
        const R2dJson *k = v->items[i];
        if (!is_obj(k)) return false;
        const R2dJson *t = field(k, "t");
        if (!num_in(t, 0, 1) || t->number < prev) return false;
        prev = t->number;
        const R2dJson *val = stop_value(k, key);
        if (strcmp(key, "color") == 0 && !color_ok(val)) return false;
        if (strcmp(key, "alpha") == 0 && !num_in(val, 0, 1)) return false;
        if (strcmp(key, "size") == 0 && !(is_num(val) && val->number >= 0)) return false;
    }
    return true;
}

static bool vec_ok(const R2dJson *v)
{
    if (is_num(v)) return true;
    if (is_arr(v)) return v->count == 2 && is_num(v->items[0]) && is_num(v->items[1]);
    return is_obj(v) && is_num(field(v, "x")) && is_num(field(v, "y"));
}

static const char *const k_particle_presets[] = { "explosion", "smoke", "sparks", "fire", "rain", "dust", NULL };
static const char *const k_zones[] = { "point", "rect", "circle", NULL };
static const char *const k_blends[] = { "alpha", "add", "multiply", "none", NULL };

void sdk_validate_particles(const char *path, SdkReport *rep)
{
    static const char *const known[] = { "version", "name", "emitting", "amount", "max_particles", "rate", "interval", "lifetime", "speed",
        "direction", "spread", "gravity", "angle", "angular_velocity", "size", "end_size", "size_ramp", "color", "end_color", "color_ramp",
        "alpha_ramp", "damping", "texture", "src", "local", "global", "one_shot", "burst", "emit_zone", "emit_zone_w", "emit_zone_h",
        "emit_zone_radius", "seed", "layer", "depth", "blend", "on_death", "onDeath", "sub", NULL };
    Ctx c = { rep, path, "SDK_PARTICLES" };
    R2dJson *root = load_root(&c, path);
    if (!root) return;
#define BAD(f, code, ...) do { char loc_[96]; snprintf(loc_, sizeof loc_, "{\"field\":\"%s\"}", f); emit(&c, SDK_ERROR, code, loc_, __VA_ARGS__); } while (0)
    for (int i = 0; i < root->count; ++i) {
        if (!in_list(obj_key_at(root, i), known)) {
            char loc[160];
            snprintf(loc, sizeof loc, "{\"field\":\"%s\"}", obj_key_at(root, i));
            emit(&c, SDK_WARNING, "_UNKNOWN_FIELD", loc, "Поле «%s» рантайм не читает", obj_key_at(root, i));
        }
    }
    static const char *const bools[] = { "emitting", "local", "global", "one_shot", NULL };
    for (int i = 0; bools[i]; ++i) { const R2dJson *v = field(root, bools[i]); if (v && !is_bool(v)) BAD(bools[i], "_FIELD", "%s — true/false", bools[i]); }
    const R2dJson *v;
    if ((v = field(root, "name")) && !is_str(v)) BAD("name", "_FIELD", "name — строка");
    if ((v = field(root, "amount")) && !int_in(v, 1, 16384)) BAD("amount", "_FIELD", "amount — целое 1..16384");
    if ((v = field(root, "max_particles")) && !int_in(v, 1, 16384)) BAD("max_particles", "_FIELD", "max_particles — целое 1..16384");
    if ((v = field(root, "rate")) && !num_in(v, 0.001, 100000)) BAD("rate", "_FIELD", "rate — 0.001..100000");
    if ((v = field(root, "interval")) && !num_in(v, 1, 3600000)) BAD("interval", "_FIELD", "interval — мс 1..3600000");
    if ((v = field(root, "lifetime")) && !range_ok(v, 0, true)) BAD("lifetime", "_RANGE", "lifetime — число > 0 или [min, max]");
    if ((v = field(root, "speed")) && !range_ok(v, 0, false)) BAD("speed", "_RANGE", "speed — число ≥ 0 или [min, max]");
    if ((v = field(root, "size")) && !range_ok(v, 0, true)) BAD("size", "_RANGE", "size — число > 0 или [min, max]");
    if ((v = field(root, "end_size")) && !range_ok(v, 0, false)) BAD("end_size", "_RANGE", "end_size — число ≥ 0 или [min, max]");
    static const char *const ranges[] = { "angle", "angular_velocity", NULL };
    for (int i = 0; ranges[i]; ++i) { v = field(root, ranges[i]); if (v && !pair_or_num(v)) BAD(ranges[i], "_RANGE", "%s — число или [min, max]", ranges[i]); }
    if ((v = field(root, "direction")) && !is_num(v)) BAD("direction", "_FIELD", "direction — число");
    if ((v = field(root, "spread")) && !num_in(v, 0, 360)) BAD("spread", "_FIELD", "spread — 0..360");
    if ((v = field(root, "damping")) && !num_in(v, 0, 1000)) BAD("damping", "_FIELD", "damping — 0..1000");
    if ((v = field(root, "gravity")) && !vec_ok(v)) BAD("gravity", "_FIELD", "gravity — число, [x, y] или { x, y }");
    static const char *const colors[] = { "color", "end_color", NULL };
    for (int i = 0; colors[i]; ++i) { v = field(root, colors[i]); if (v && !color_ok(v)) BAD(colors[i], "_COLOR", "%s: нераспознанный цвет", colors[i]); }
    static const char *const ramps[][2] = { { "size_ramp", "size" }, { "color_ramp", "color" }, { "alpha_ramp", "alpha" } };
    for (int i = 0; i < 3; ++i) { v = field(root, ramps[i][0]); if (v && !ramp_ok(v, ramps[i][1])) BAD(ramps[i][0], "_RAMP", "%s — рампа", ramps[i][0]); }
    if ((v = field(root, "blend")) && !(is_str(v) && in_list(v->string, k_blends))) BAD("blend", "_FIELD", "blend: alpha | add | multiply | none");
    if ((v = field(root, "emit_zone"))) {
        bool ok = false;
        if (is_str(v)) ok = in_list(v->string, k_zones);
        else if (is_obj(v)) { const R2dJson *sh = field(v, "shape"); ok = is_str(sh) && in_list(sh->string, k_zones); }
        if (!ok) BAD("emit_zone", "_FIELD", "emit_zone: point | rect | circle");
    }
    static const char *const zf[] = { "emit_zone_w", "emit_zone_h", "emit_zone_radius", NULL };
    for (int i = 0; zf[i]; ++i) { v = field(root, zf[i]); if (v && !num_in(v, 0, 100000)) BAD(zf[i], "_FIELD", "%s — 0..100000", zf[i]); }
    if ((v = field(root, "burst"))) {
        bool ok = int_in(v, 0, 16384);
        if (!ok && is_arr(v)) { ok = true; for (int i = 0; i < v->count; ++i) if (!int_in(v->items[i], 0, 16384)) { ok = false; break; } }
        if (!ok) BAD("burst", "_FIELD", "burst — целое или массив целых");
    }
    static const char *const subs[] = { "on_death", "onDeath", "sub", NULL };
    for (int i = 0; subs[i]; ++i) {
        v = field(root, subs[i]);
        if (!v) continue;
        const R2dJson *pr = is_obj(v) ? field(v, "preset") : NULL;
        if (!is_obj(v) || (pr && !(is_str(pr) && in_list(pr->string, k_particle_presets)))) BAD(subs[i], "_SUBEMITTER", "%s — объект суб-эмиттера", subs[i]);
    }
    if ((v = field(root, "seed")) && !int_in(v, 0, 4294967295.0)) BAD("seed", "_FIELD", "seed — целое 0..4294967295");
    static const char *const nums[] = { "layer", "depth", NULL };
    for (int i = 0; nums[i]; ++i) { v = field(root, nums[i]); if (v && !is_num(v)) BAD(nums[i], "_FIELD", "%s — число", nums[i]); }
    const R2dJson *mp = field(root, "max_particles"), *am = field(root, "amount");
    if (is_num(mp) && is_num(am) && mp->number < am->number) {
        emit(&c, SDK_WARNING, "_CAP", "{\"field\":\"max_particles\"}", "max_particles меньше amount");
    }
#undef BAD
    r2d_json_free(root);
}

// ---------------------------------------------------------------------------
// collision
// ---------------------------------------------------------------------------
static bool poly_convex(const R2dJson *pts)
{
    const int n = pts->count / 2;
    int sign = 0;
    for (int i = 0; i < n; ++i) {
        const double ax = pts->items[i * 2]->number, ay = pts->items[i * 2 + 1]->number;
        const double bx = pts->items[((i + 1) % n) * 2]->number, by = pts->items[((i + 1) % n) * 2 + 1]->number;
        const double cx = pts->items[((i + 2) % n) * 2]->number, cy = pts->items[((i + 2) % n) * 2 + 1]->number;
        const double cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
        if (cross != 0) {
            const int s = cross > 0 ? 1 : -1;
            if (sign && s != sign) return false;
            sign = s;
        }
    }
    return true;
}

void sdk_validate_collision(const char *path, SdkReport *rep)
{
    static const char *const tags[] = { "wall", "trigger", "area", NULL };
    static const char *const kinds[] = { "box", "circle", "capsule", "polygon", NULL };
    Ctx c = { rep, path, "SDK_COLLISION" };
    R2dJson *root = load_root(&c, path);
    if (!root) return;
    const R2dJson *shapes = field(root, "shapes");
    if (!is_arr(shapes) || shapes->count > 4096) {
        emit(&c, SDK_ERROR, "_SHAPES", "{\"field\":\"shapes\"}", "shapes — массив до 4096 фигур");
        r2d_json_free(root);
        return;
    }
    for (int i = 0; i < shapes->count; ++i) {
        const R2dJson *s = shapes->items[i];
        char loc[64];
        snprintf(loc, sizeof loc, "{\"shape\":%d}", i);
        if (!is_obj(s)) { emit(&c, SDK_ERROR, "_SHAPE", loc, "Фигура %d должна быть объектом", i); continue; }
        const R2dJson *v;
        if ((v = field(s, "name")) && !is_str(v)) emit(&c, SDK_ERROR, "_SHAPE", loc, "name — строка");
        if ((v = field(s, "tag")) && !(is_str(v) && in_list(v->string, tags))) emit(&c, SDK_ERROR, "_TAG", loc, "tag: wall | trigger | area");
        const R2dJson *shape = field(s, "shape");
        const char *kind = "box";
        if (shape) {
            if (!(is_str(shape) && in_list(shape->string, kinds))) { emit(&c, SDK_ERROR, "_KIND", loc, "shape: box | circle | capsule | polygon"); continue; }
            kind = shape->string;
        }
        if (!is_num(field(s, "x")) || !is_num(field(s, "y"))) emit(&c, SDK_ERROR, "_GEOMETRY", loc, "x и y — числа");
        const R2dJson *w = field(s, "w"), *h = field(s, "h"), *r = field(s, "radius");
        if (strcmp(kind, "box") == 0 && !(num_in(w, 0.01, 1e6) && num_in(h, 0.01, 1e6))) emit(&c, SDK_ERROR, "_GEOMETRY", loc, "box требует w > 0 и h > 0");
        if (strcmp(kind, "circle") == 0 && !num_in(r, 0.01, 1e6)) emit(&c, SDK_ERROR, "_GEOMETRY", loc, "circle требует radius > 0");
        if (strcmp(kind, "capsule") == 0 && !(num_in(r, 0.01, 1e6) && num_in(h, 0.01, 1e6))) emit(&c, SDK_ERROR, "_GEOMETRY", loc, "capsule требует radius и h > 0");
        if (strcmp(kind, "polygon") == 0) {
            const R2dJson *p = field(s, "points");
            bool ok = is_arr(p) && p->count >= 6 && p->count <= 16 && p->count % 2 == 0;
            if (ok) for (int k = 0; k < p->count; ++k) if (!is_num(p->items[k])) { ok = false; break; }
            if (!ok) emit(&c, SDK_ERROR, "_POLYGON_POINTS", loc, "points — 3..8 вершин");
            else if (!poly_convex(p)) emit(&c, SDK_WARNING, "_POLYGON_CONCAVE", loc, "полигон невыпуклый");
        }
        static const char *const flags[] = { "oneWay", "sensor", NULL };
        for (int k = 0; flags[k]; ++k) { v = field(s, flags[k]); if (v && !is_bool(v)) emit(&c, SDK_ERROR, "_FLAG", loc, "%s — true/false", flags[k]); }
        if ((v = field(s, "oneWayAngle")) && !is_num(v)) emit(&c, SDK_ERROR, "_FLAG", loc, "oneWayAngle — число");
        static const char *const bits[] = { "layerBits", "mask", NULL };
        for (int k = 0; bits[k]; ++k) { v = field(s, bits[k]); if (v && !int_in(v, 0, 4294967295.0)) emit(&c, SDK_ERROR, "_BITS", loc, "%s — целое 0..4294967295", bits[k]); }
    }
    dup_names(&c, shapes, "Фигура");
    r2d_json_free(root);
}

// ---------------------------------------------------------------------------
// layers (Parallax)
// ---------------------------------------------------------------------------
void sdk_validate_layers(const char *path, SdkReport *rep)
{
    Ctx c = { rep, path, "SDK_LAYERS" };
    R2dJson *root = load_root(&c, path);
    if (!root) return;
    const R2dJson *layers = field(root, "layers");
    if (!is_arr(layers) || layers->count < 1 || layers->count > 32) {
        emit(&c, SDK_ERROR, "_LAYERS", "{\"field\":\"layers\"}", "layers — массив из 1..32 слоёв");
        r2d_json_free(root);
        return;
    }
    for (int i = 0; i < layers->count; ++i) {
        const R2dJson *l = layers->items[i];
        char loc[64];
        snprintf(loc, sizeof loc, "{\"layer\":%d}", i);
        if (!is_obj(l)) { emit(&c, SDK_ERROR, "_LAYER", loc, "Слой %d должен быть объектом", i); continue; }
        const R2dJson *v;
        if (!nonempty_str(field(l, "name"))) emit(&c, SDK_ERROR, "_NAME", loc, "нужен непустой name");
        if ((v = field(l, "order")) && !is_num(v)) emit(&c, SDK_ERROR, "_LAYER", loc, "order — число");
        if ((v = field(l, "parallax")) && !num_in(v, 0, 4)) emit(&c, SDK_ERROR, "_PARALLAX", loc, "parallax — число 0..4");
        if ((v = field(l, "visible")) && !is_bool(v)) emit(&c, SDK_ERROR, "_LAYER", loc, "visible — true/false");
        if ((v = field(l, "modulate")) && !color_ok(v)) emit(&c, SDK_ERROR, "_COLOR", loc, "modulate: нераспознанный цвет");
        const R2dJson *sp = field(l, "sprites");
        if (sp) {
            if (!is_arr(sp) || sp->count > 256) emit(&c, SDK_ERROR, "_SPRITES", loc, "sprites — массив до 256");
            else for (int k = 0; k < sp->count; ++k) {
                const R2dJson *s = sp->items[k];
                char sl[96];
                snprintf(sl, sizeof sl, "{\"layer\":%d,\"sprite\":%d}", i, k);
                const R2dJson *w = is_obj(s) ? field(s, "w") : NULL, *h = is_obj(s) ? field(s, "h") : NULL;
                if (!is_obj(s) || !nonempty_str(field(s, "src"))) emit(&c, SDK_ERROR, "_SPRITE", sl, "нужен src");
                else if (!is_num(field(s, "x")) || !is_num(field(s, "y"))) emit(&c, SDK_ERROR, "_SPRITE", sl, "x и y — числа");
                else if ((w && !num_in(w, 0.01, 1e6)) || (h && !num_in(h, 0.01, 1e6))) emit(&c, SDK_ERROR, "_SPRITE", sl, "w и h — числа > 0");
            }
        }
        if (!field(l, "parallax")) emit(&c, SDK_WARNING, "_NO_PARALLAX", loc, "У слоя %d нет parallax", i);
    }
    const R2dJson *m = field(root, "modulate");
    if (m) {
        const R2dJson *a = is_obj(m) ? field(m, "alpha") : NULL;
        if (!is_obj(m) || !color_ok(field(m, "color")) || (a && !num_in(a, 0, 1))) emit(&c, SDK_ERROR, "_MODULATE", "{\"field\":\"modulate\"}", "modulate: { color, alpha? }");
    }
    dup_names(&c, layers, "Слой");
    r2d_json_free(root);
}

// ---------------------------------------------------------------------------
// fonts
// ---------------------------------------------------------------------------
static bool ends_ci(const char *s, const char *suf)
{
    const size_t n = strlen(s), m = strlen(suf);
    return n >= m && icase_eq(s + n - m, suf);
}

void sdk_validate_fonts(const char *path, SdkReport *rep)
{
    static const char *const aligns[] = { "left", "center", "right", NULL };
    Ctx c = { rep, path, "SDK_FONTS" };
    R2dJson *root = load_root(&c, path);
    if (!root) return;
    const R2dJson *fonts = field(root, "fonts");
    if (fonts) {
        if (!is_arr(fonts) || fonts->count > 32) emit(&c, SDK_ERROR, "_FONTS", "{\"field\":\"fonts\"}", "fonts — массив до 32 шрифтов");
        else {
            for (int i = 0; i < fonts->count; ++i) {
                const R2dJson *f = fonts->items[i];
                char loc[64];
                snprintf(loc, sizeof loc, "{\"font\":%d}", i);
                if (!is_obj(f) || !is_str(field(f, "name")) || !name_ok(field(f, "name")->string, 48)) emit(&c, SDK_ERROR, "_FONT", loc, "name из латиницы, цифр, «_», «-»");
                else if (!is_str(field(f, "path")) || !(ends_ci(field(f, "path")->string, ".ttf") || ends_ci(field(f, "path")->string, ".otf"))) emit(&c, SDK_ERROR, "_FONT", loc, "path к .ttf или .otf");
            }
            dup_names(&c, fonts, "Шрифт");
        }
    }
    const R2dJson *styles = field(root, "styles");
    if (!is_obj(styles) || styles->count > 128) {
        emit(&c, SDK_ERROR, "_STYLES", "{\"field\":\"styles\"}", "styles — объект «имя → стиль»");
        r2d_json_free(root);
        return;
    }
    for (int i = 0; i < styles->count; ++i) {
        const char *name = obj_key_at(styles, i);
        const R2dJson *s = styles->items[i];
        char loc[160];
        snprintf(loc, sizeof loc, "{\"style\":\"%s\"}", name);
        if (!name_ok(name, 48)) emit(&c, SDK_ERROR, "_STYLE", loc, "Имя стиля «%s»: латиница, цифры, «_», «-»", name);
        if (!is_obj(s)) { emit(&c, SDK_ERROR, "_STYLE", loc, "Стиль «%s» должен быть объектом", name); continue; }
        const R2dJson *v;
        if ((v = field(s, "size")) && !num_in(v, 4, 512)) emit(&c, SDK_ERROR, "_SIZE", loc, "size 4..512");
        if ((v = field(s, "color")) && !color_ok(v)) emit(&c, SDK_ERROR, "_COLOR", loc, "нераспознанный цвет");
        if ((v = field(s, "align")) && !(is_str(v) && in_list(v->string, aligns))) emit(&c, SDK_ERROR, "_ALIGN", loc, "align left | center | right");
        if ((v = field(s, "lineHeight")) && !num_in(v, 0.5, 4)) emit(&c, SDK_ERROR, "_LINEHEIGHT", loc, "lineHeight 0.5..4");
        const R2dJson *font = field(s, "font");
        if (font) {
            if (!nonempty_str(font)) emit(&c, SDK_ERROR, "_STYLE", loc, "font — имя семейства строкой");
            else if (strcmp(font->string, "default") != 0) {
                bool declared = false;
                if (is_arr(fonts)) for (int k = 0; k < fonts->count; ++k) {
                    const R2dJson *f = fonts->items[k];
                    if (is_obj(f) && is_str(field(f, "name")) && strcmp(field(f, "name")->string, font->string) == 0) { declared = true; break; }
                }
                if (!declared) emit(&c, SDK_WARNING, "_FONT_MISSING", loc, "семейство «%s» не объявлено в fonts", font->string);
            }
        }
        const R2dJson *base = field(s, "base");
        if (base) {
            if (!is_str(base)) emit(&c, SDK_ERROR, "_STYLE", loc, "base — строка");
            else if (!is_obj(field(styles, base->string))) emit(&c, SDK_WARNING, "_BASE_MISSING", loc, "база «%s» не объявлена", base->string);
            else {
                const char *seen[130];
                int n = 0;
                seen[n++] = name;
                const char *cur = base->string;
                while (cur && is_obj(field(styles, cur))) {
                    bool cyc = false;
                    for (int k = 0; k < n; ++k) if (strcmp(seen[k], cur) == 0) { cyc = true; break; }
                    if (cyc) { emit(&c, SDK_ERROR, "_CYCLE", loc, "цикл наследования через «%s»", cur); break; }
                    if (n < 129) seen[n++] = cur;
                    const R2dJson *b = field(field(styles, cur), "base");
                    cur = b && b->string ? b->string : NULL;
                    if (b && !is_str(b)) break;
                }
            }
        }
    }
    r2d_json_free(root);
}

// ---------------------------------------------------------------------------
// audio
// ---------------------------------------------------------------------------
void sdk_validate_audio(const char *path, SdkReport *rep)
{
    static const char *const effects[] = { "none", "lowpass", "highpass", "echo", "tremolo", "bitcrush", "ringmod", "reverb", NULL };
    Ctx c = { rep, path, "SDK_AUDIO" };
    R2dJson *root = load_root(&c, path);
    if (!root) return;
    const R2dJson *buses = field(root, "buses");
    const bool buses_obj = !buses || is_obj(buses);
    if (buses && !is_obj(buses)) emit(&c, SDK_ERROR, "_BUSES", "{\"field\":\"buses\"}", "buses — объект «имя → шина»");
    else if (buses) {
        for (int i = 0; i < buses->count; ++i) {
            const char *name = obj_key_at(buses, i);
            const R2dJson *b = buses->items[i];
            char loc[160];
            snprintf(loc, sizeof loc, "{\"bus\":\"%s\"}", name);
            if (!name_ok(name, 48) || strcmp(name, "master") == 0) emit(&c, SDK_ERROR, "_BUS", loc, "Имя шины «%s» недопустимо", name);
            if (!is_obj(b)) { emit(&c, SDK_ERROR, "_BUS", loc, "Шина «%s» должна быть объектом", name); continue; }
            const R2dJson *v;
            if ((v = field(b, "volume")) && !num_in(v, 0, 1)) emit(&c, SDK_ERROR, "_VOLUME", loc, "volume 0..1");
            static const char *const flags[] = { "muted", "solo", NULL };
            for (int k = 0; flags[k]; ++k) { v = field(b, flags[k]); if (v && !is_bool(v)) emit(&c, SDK_ERROR, "_BUS", loc, "%s — true/false", flags[k]); }
            if ((v = field(b, "effect")) && !(is_str(v) && in_list(v->string, effects))) emit(&c, SDK_ERROR, "_EFFECT", loc, "effect недопустим");
            if ((v = field(b, "effectParams")) && !is_obj(v)) emit(&c, SDK_ERROR, "_BUS", loc, "effectParams — объект");
            const R2dJson *parent = field(b, "parent");
            if (parent) {
                if (!is_str(parent)) emit(&c, SDK_ERROR, "_PARENT", loc, "parent — строка");
                else if (strcmp(parent->string, "master") != 0 && !is_obj(field(buses, parent->string))) emit(&c, SDK_ERROR, "_PARENT", loc, "родитель «%s» не объявлен", parent->string);
                else {
                    const char *seen[130];
                    int n = 0;
                    seen[n++] = name;
                    const char *cur = parent->string;
                    while (cur && strcmp(cur, "master") != 0 && is_obj(field(buses, cur))) {
                        bool cyc = false;
                        for (int k = 0; k < n; ++k) if (strcmp(seen[k], cur) == 0) { cyc = true; break; }
                        if (cyc) { emit(&c, SDK_ERROR, "_CYCLE", loc, "цикл родителей через «%s»", cur); break; }
                        if (n < 129) seen[n++] = cur;
                        const R2dJson *pp = field(field(buses, cur), "parent");
                        cur = pp && pp->string ? pp->string : NULL;
                        if (pp && !is_str(pp)) break;
                    }
                }
            }
        }
    }
    const R2dJson *sounds = field(root, "sounds");
    if (sounds && !is_obj(sounds)) emit(&c, SDK_ERROR, "_SOUNDS", "{\"field\":\"sounds\"}", "sounds — объект «имя → звук»");
    else if (sounds) {
        for (int i = 0; i < sounds->count; ++i) {
            const char *name = obj_key_at(sounds, i);
            const R2dJson *s = sounds->items[i];
            char loc[160];
            snprintf(loc, sizeof loc, "{\"sound\":\"%s\"}", name);
            if (!name_ok(name, 48)) emit(&c, SDK_ERROR, "_SOUND", loc, "Имя звука «%s» недопустимо", name);
            if (!is_obj(s) || !nonempty_str(field(s, "path"))) { emit(&c, SDK_ERROR, "_SOUND", loc, "Звук «%s»: нужен path", name); continue; }
            const R2dJson *v;
            if ((v = field(s, "volume")) && !num_in(v, 0, 1)) emit(&c, SDK_ERROR, "_VOLUME", loc, "volume 0..1");
            if ((v = field(s, "pitch")) && !num_in(v, 0.1, 4)) emit(&c, SDK_ERROR, "_PITCH", loc, "pitch 0.1..4");
            if ((v = field(s, "loop")) && !is_bool(v)) emit(&c, SDK_ERROR, "_SOUND", loc, "loop — true/false");
            const R2dJson *bus = field(s, "bus");
            if (bus) {
                if (!is_str(bus)) emit(&c, SDK_ERROR, "_SOUND", loc, "bus — строка");
                else if (buses_obj && !is_obj(buses ? field(buses, bus->string) : NULL) && strcmp(bus->string, "sfx") != 0 && strcmp(bus->string, "music") != 0) {
                    emit(&c, SDK_WARNING, "_BUS_MISSING", loc, "шина «%s» не объявлена", bus->string);
                }
            }
        }
    }
    const R2dJson *zones = field(root, "zones");
    if (zones) {
        if (!is_arr(zones) || zones->count > 256) emit(&c, SDK_ERROR, "_ZONES", "{\"field\":\"zones\"}", "zones — массив до 256 зон");
        else for (int i = 0; i < zones->count; ++i) {
            const R2dJson *z = zones->items[i];
            char loc[64];
            snprintf(loc, sizeof loc, "{\"zone\":%d}", i);
            if (!is_obj(z) || !nonempty_str(field(z, "name"))) { emit(&c, SDK_ERROR, "_ZONE", loc, "Зона %d: нужен name", i); continue; }
            const R2dJson *rect = field(z, "rect");
            bool ok = is_arr(rect) && rect->count == 4;
            if (ok) for (int k = 0; k < 4; ++k) if (!is_num(rect->items[k])) { ok = false; break; }
            if (ok && !(rect->items[2]->number > 0 && rect->items[3]->number > 0)) ok = false;
            if (!ok) emit(&c, SDK_ERROR, "_ZONE", loc, "rect — [x, y, w, h], w и h > 0");
            const R2dJson *v;
            if ((v = field(z, "height")) && !num_in(v, 0.1, 1000)) emit(&c, SDK_ERROR, "_ZONE", loc, "height 0.1..1000");
            if ((v = field(z, "material")) && !is_str(v)) emit(&c, SDK_ERROR, "_ZONE", loc, "material — строка");
        }
    }
    r2d_json_free(root);
}

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------
static bool key_known(const char *key)
{
    char k[96];
    size_t n = strlen(key);
    if (n >= sizeof k) return false;
    for (size_t i = 0; i <= n; ++i) k[i] = (key[i] >= 'A' && key[i] <= 'Z') ? (char)(key[i] - 'A' + 'a') : key[i];
    if (n == 1 && ((k[0] >= 'a' && k[0] <= 'z') || (k[0] >= '0' && k[0] <= '9'))) return true;
    if (k[0] == 'f' && n >= 2 && n <= 3) {
        char *end = NULL;
        const long v = strtol(k + 1, &end, 10);
        if (end && *end == '\0' && k[1] != '+' && k[1] != '-' && v >= 1 && v <= 24 && !(n == 3 && k[1] == '0')) return true;
    }
    static const char *const named[] = { "space", "enter", "return", "escape", "tab", "backspace", "left", "right", "up", "down", "leftshift",
        "rightshift", "leftctrl", "rightctrl", "leftalt", "rightalt", "delete", "insert", "home", "end", "pageup", "pagedown", "capslock",
        "mouse.left", "mouse.middle", "mouse.right",
        // псевдонимы $.input (src/highlevel/input.js ALIASES)
        "spacebar", "esc", "lshift", "rshift", "shift", "lctrl", "rctrl", "ctrl", "lalt", "ralt", "alt", "cmd", "win", "meta", "minus", "plus", "equals", "comma", "period", "slash", "backslash", "semicolon", "quote", NULL };
    if (in_list(k, named)) return true;
    if (strncmp(k, "gamepad.", 8) == 0 && n > 8) {
        for (size_t i = 8; i < n; ++i) if (!((k[i] >= 'a' && k[i] <= 'z') || (k[i] >= '0' && k[i] <= '9'))) return false;
        return true;
    }
    return false;
}

void sdk_validate_input(const char *path, SdkReport *rep)
{
    Ctx c = { rep, path, "SDK_INPUT" };
    R2dJson *root = load_root(&c, path);
    if (!root) return;
    const R2dJson *dz = field(root, "deadzone");
    if (dz && !num_in(dz, 0, 1)) emit(&c, SDK_ERROR, "_DEADZONE", "{\"field\":\"deadzone\"}", "deadzone — число 0..1");
    const R2dJson *actions = field(root, "actions");
    if (!is_obj(actions) || actions->count > 128) {
        emit(&c, SDK_ERROR, "_ACTIONS", "{\"field\":\"actions\"}", "actions — объект «действие → клавиши»");
        r2d_json_free(root);
        return;
    }
    // владелец клавиши: имя действия по строчному имени клавиши
    char owner_key[512][96];
    const char *owner_act[512];
    int owners = 0;
    for (int i = 0; i < actions->count; ++i) {
        const char *name = obj_key_at(actions, i);
        const R2dJson *keys = actions->items[i];
        char loc[160];
        snprintf(loc, sizeof loc, "{\"action\":\"%s\"}", name);
        if (!name_ok(name, 48)) emit(&c, SDK_ERROR, "_ACTION", loc, "Имя действия «%s» недопустимо", name);
        bool ok = is_arr(keys) && keys->count >= 1 && keys->count <= 16;
        if (ok) for (int k = 0; k < keys->count; ++k) if (!nonempty_str(keys->items[k])) { ok = false; break; }
        if (!ok) { emit(&c, SDK_ERROR, "_KEYS", loc, "Действие «%s»: массив из 1..16 непустых имён клавиш", name); continue; }
        for (int k = 0; k < keys->count; ++k) {
            const char *key = keys->items[k]->string;
            char lk[96];
            size_t n = strlen(key);
            if (n >= sizeof lk) n = sizeof lk - 1;
            for (size_t m = 0; m < n; ++m) lk[m] = (key[m] >= 'A' && key[m] <= 'Z') ? (char)(key[m] - 'A' + 'a') : key[m];
            lk[n] = '\0';
            if (!key_known(key)) emit(&c, SDK_WARNING, "_UNKNOWN_KEY", loc, "клавиша «%s» не в списке известных", key);
            int found = -1;
            for (int m = 0; m < owners; ++m) if (strcmp(owner_key[m], lk) == 0) { found = m; break; }
            if (found >= 0 && strcmp(owner_act[found], name) != 0) emit(&c, SDK_WARNING, "_CONFLICT", loc, "клавиша «%s» привязана к «%s» и «%s»", key, owner_act[found], name);
            else if (found < 0 && owners < 512) { snprintf(owner_key[owners], sizeof owner_key[owners], "%s", lk); owner_act[owners++] = name; }
        }
    }
    r2d_json_free(root);
}

// ---------------------------------------------------------------------------
// RML / RCSS: форма разметки (порт sdk/lib/rml_model.js: parse, checkRcss)
// ---------------------------------------------------------------------------
typedef struct RmlStack {
    char *tag[256];
    int depth;
} RmlStack;

void sdk_validate_rml(const char *path, SdkReport *rep)
{
    Ctx c = { rep, path, "SDK_RML" };
    size_t size = 0;
    char *src = sdk_read_file(path, &size);
    if (!src) { sdk_diag(rep, SDK_ERROR, "SDK_FILE_NOT_FOUND", path, NULL, NULL, "Не удалось прочитать файл"); return; }
    RmlStack st = { { 0 }, 0 };
    bool first = true, first_rml = false, has_body = false, any = false;
    const size_t n = size;
    size_t i = 0;
    const int errors_before = rep->errors;
    while (i < n) {
        const char *lt = memchr(src + i, '<', n - i);
        if (!lt) break;
        const size_t p = (size_t)(lt - src);
        if (p + 3 < n && strncmp(src + p, "<!--", 4) == 0) {
            const char *e = strstr(src + p + 4, "-->");
            if (!e) { emit(&c, SDK_ERROR, "_UNCLOSED", NULL, "Комментарий <!-- не закрыт"); break; }
            i = (size_t)(e - src) + 3;
            continue;
        }
        if (p + 1 < n && (src[p + 1] == '?' || src[p + 1] == '!')) {
            const char *e = memchr(src + p, '>', n - p);
            if (!e) break;
            i = (size_t)(e - src) + 1;
            continue;
        }
        if (p + 1 < n && src[p + 1] == '/') {
            const char *e = memchr(src + p, '>', n - p);
            if (!e) { emit(&c, SDK_ERROR, "_UNBALANCED", NULL, "Закрывающий тег без «>»"); break; }
            size_t a = p + 2, b = (size_t)(e - src);
            while (a < b && (src[a] == ' ' || src[a] == '\t' || src[a] == '\n' || src[a] == '\r')) ++a;
            while (b > a && (src[b - 1] == ' ' || src[b - 1] == '\t' || src[b - 1] == '\n' || src[b - 1] == '\r')) --b;
            char name[128];
            size_t len = b - a;
            if (len >= sizeof name) len = sizeof name - 1;
            memcpy(name, src + a, len);
            name[len] = '\0';
            if (st.depth > 0 && strcmp(st.tag[st.depth - 1], name) == 0) {
                free(st.tag[--st.depth]);
            } else {
                emit(&c, SDK_ERROR, "_UNBALANCED", NULL, "Закрывающий тег </%s> не соответствует открытому", name);
                int k = -1;
                for (int d = st.depth - 1; d >= 0; --d) if (strcmp(st.tag[d], name) == 0) { k = d; break; }
                if (k >= 0) while (st.depth > k) free(st.tag[--st.depth]);
            }
            i = (size_t)(e - src) + 1;
            continue;
        }
        // стартовый тег: «>» вне кавычек
        size_t j = p + 1;
        char quote = 0;
        while (j < n) {
            const char ch = src[j];
            if (quote) { if (ch == quote) quote = 0; }
            else if (ch == '"' || ch == '\'') quote = ch;
            else if (ch == '>') break;
            ++j;
        }
        if (j >= n) { emit(&c, SDK_ERROR, "_UNBALANCED", NULL, "Стартовый тег без «>»"); break; }
        size_t blen = j - (p + 1);
        const char *body = src + p + 1;
        const bool selfclose = blen > 0 && body[blen - 1] == '/';
        if (selfclose) blen--;
        size_t a = 0;
        while (a < blen && (body[a] == ' ' || body[a] == '\t' || body[a] == '\n' || body[a] == '\r')) ++a;
        size_t b = a;
        while (b < blen && !(body[b] == ' ' || body[b] == '\t' || body[b] == '\n' || body[b] == '\r' || body[b] == '/' || body[b] == '>')) ++b;
        if (b > a) {
            char name[128];
            size_t len = b - a;
            if (len >= sizeof name) len = sizeof name - 1;
            memcpy(name, body + a, len);
            name[len] = '\0';
            any = true;
            if (first) { first = false; first_rml = strcmp(name, "rml") == 0; }
            if (strcmp(name, "body") == 0) has_body = true;
            if (!selfclose && st.depth < 255) st.tag[st.depth++] = strdup(name);
        }
        i = j + 1;
    }
    while (st.depth > 0) {
        emit(&c, SDK_ERROR, "_UNCLOSED", NULL, "Тег <%s> не закрыт", st.tag[st.depth - 1]);
        free(st.tag[--st.depth]);
    }
    if (!any || !first_rml) emit(&c, SDK_ERROR, "_ROOT", NULL, "Корневой элемент документа должен быть <rml>");
    if (rep->errors == errors_before && !has_body) emit(&c, SDK_WARNING, "_NO_BODY", NULL, "В документе нет <body>");
    free(src);
}

void sdk_validate_rcss(const char *path, SdkReport *rep)
{
    Ctx c = { rep, path, "SDK_RCSS" };
    size_t size = 0;
    char *src = sdk_read_file(path, &size);
    if (!src) { sdk_diag(rep, SDK_ERROR, "SDK_FILE_NOT_FOUND", path, NULL, NULL, "Не удалось прочитать файл"); return; }
    int depth = 0, line = 1;
    size_t i = 0;
    while (i < size) {
        const char ch = src[i];
        if (ch == '\n') line++;
        if (ch == '/' && i + 1 < size && src[i + 1] == '*') {
            const char *e = strstr(src + i + 2, "*/");
            if (!e) {
                char loc[48];
                snprintf(loc, sizeof loc, "{\"line\":%d}", line);
                emit(&c, SDK_ERROR, "_COMMENT", loc, "Комментарий /* не закрыт (строка %d)", line);
                free(src);
                return;
            }
            for (const char *q = src + i; q < e; ++q) if (*q == '\n') line++;
            i = (size_t)(e - src) + 2;
            continue;
        }
        if (ch == '"' || ch == '\'') {
            const char q = ch;
            i++;
            while (i < size && src[i] != q && src[i] != '\n') i++;
        } else if (ch == '{') {
            depth++;
        } else if (ch == '}') {
            depth--;
            if (depth < 0) {
                char loc[48];
                snprintf(loc, sizeof loc, "{\"line\":%d}", line);
                emit(&c, SDK_ERROR, "_BRACES", loc, "Лишняя «}» в строке %d", line);
                depth = 0;
            }
        }
        i++;
    }
    if (depth > 0) {
        char loc[48];
        snprintf(loc, sizeof loc, "{\"line\":%d}", line);
        emit(&c, SDK_ERROR, "_BRACES", loc, "Не закрыто блоков «{»: %d", depth);
    }
    free(src);
}
