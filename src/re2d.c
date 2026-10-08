// ===========================================================================
// Re2D: JS-обвязка нативной проекции (engine.re2d.*).
//
// Математика лежит в re2d_math.c и проверяется офлайн; здесь только мост:
// типизированные массивы в обе стороны и отправка готового меша в рендер.
// Вид хранится один на процесс — как и один кадр: JS ставит его раз за кадр
// (engine.re2d.view), дальше projects/mesh работают по нему.
// ===========================================================================
#include "re2d.h"
#include "re2d_math.h"
#include "script.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

static R2DRe2dView g_view;
static R2DRe2dStats g_stats;
static bool g_view_ready;
static float *g_scratch;
static int g_scratch_cap;   // в вершинах (по 8 float)
static int g_meshes, g_mesh_verts;

// Предел выходного буфера меша, вершины (32 МБ): дальше треугольники отбрасываются
// и считаются в stats.overflow.
#define R2D_RE2D_MAX_VERTS (1 << 20)

static void ensure_view(void)
{
    if (g_view_ready) return;
    r2d_re2d_view_set(&g_view, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.2f, 1280.0f, 720.0f);
    g_view_ready = true;
}

static double num_arg(JSContext *ctx, int argc, JSValueConst *argv, int idx, double def)
{
    if (idx >= argc) return def;
    double v = def;
    if (JS_ToFloat64(ctx, &v, argv[idx]) < 0) return def;
    return v;
}

// Указатель на данные Float32Array. Возвращает ArrayBuffer-обёртку, которую
// нужно освободить; nfloats — сколько float доступно.
static JSValue f32_view(JSContext *ctx, JSValueConst arr, float **data, size_t *nfloats)
{
    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, arr, &off, &len, &bpe);
    if (JS_IsException(ab)) {
        // Движковое «not a TypedArray» ничего не подсказывает: заменяем своим.
        JS_FreeValue(ctx, JS_GetException(ctx));
        return JS_ThrowTypeError(ctx, "Re2D: нужен Float32Array, а передан другой тип (обычный массив не подходит)");
    }
    size_t size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, ab);
    if (!base || bpe != sizeof(float)) {
        JS_FreeValue(ctx, ab);
        return JS_ThrowTypeError(ctx, "Re2D: нужен Float32Array");
    }
    *data = (float *)(base + off);
    *nfloats = len / sizeof(float);
    return ab;
}

// engine.re2d.view(x, y, eye, yaw, pitch, fov, fogFar?, fogMin?) → true.
// Углы в радианах; размер кадра берётся у рендера — тот же, что у submitMesh.
static JSValue js_view(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    R2DScript *s = JS_GetContextOpaque(ctx);
    if (argc < 6) {
        return JS_ThrowTypeError(ctx, "re2d.view(x, y, eye, yaw, pitch, fov, fogFar?, fogMin?)");
    }
    const double x = num_arg(ctx, argc, argv, 0, 0), y = num_arg(ctx, argc, argv, 1, 0);
    const double eye = num_arg(ctx, argc, argv, 2, 0), yaw = num_arg(ctx, argc, argv, 3, 0);
    const double pitch = num_arg(ctx, argc, argv, 4, 0), fov = num_arg(ctx, argc, argv, 5, 1.2);
    if (!isfinite(x) || !isfinite(y) || !isfinite(eye) || !isfinite(yaw) || !isfinite(pitch) || !isfinite(fov)) {
        return JS_ThrowRangeError(ctx, "re2d.view: все аргументы должны быть конечными числами");
    }
    const float w = (s && s->renderer && s->renderer->screen_w > 0) ? (float)s->renderer->screen_w : 1280.0f;
    const float h = (s && s->renderer && s->renderer->screen_h > 0) ? (float)s->renderer->screen_h : 720.0f;
    r2d_re2d_view_set(&g_view, (float)x, (float)y, (float)eye, (float)yaw, (float)pitch, (float)fov, w, h);
    r2d_re2d_view_fog(&g_view, (float)num_arg(ctx, argc, argv, 6, 0.0), (float)num_arg(ctx, argc, argv, 7, 0.25));
    g_view_ready = true;
    return JS_TRUE;
}

// engine.re2d.project(points, out, count?) → число видимых точек.
// points — Float32Array stride 3 (x, y, z), out — Float32Array stride 4
// (sx, sy, z01, scale). Невидимая точка: z01 = -1, scale = 0.
static JSValue js_project(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    if (argc < 2) return JS_ThrowTypeError(ctx, "re2d.project(points: Float32Array, out: Float32Array, count?)");
    ensure_view();
    float *in = NULL, *out = NULL;
    size_t n_in = 0, n_out = 0;
    JSValue a = f32_view(ctx, argv[0], &in, &n_in);
    if (JS_IsException(a)) return a;
    JSValue b = f32_view(ctx, argv[1], &out, &n_out);
    if (JS_IsException(b)) { JS_FreeValue(ctx, a); return b; }
    size_t count = n_in / 3;
    if (n_out / 4 < count) count = n_out / 4;
    if (argc >= 3) {
        const double want = num_arg(ctx, argc, argv, 2, (double)count);
        if (want >= 0 && (size_t)want < count) count = (size_t)want;
    }
    const int visible = r2d_re2d_project_points(&g_view, in, (int)count, out);
    JS_FreeValue(ctx, a);
    JS_FreeValue(ctx, b);
    return JS_NewInt32(ctx, visible);
}

// engine.re2d.unproject(sx, sy, z?) → [x, y] | null.
// Пиксель → точка мира на плоскости высоты z (по умолчанию пол): тот же вид,
// что поставил view(). null — луч не попадает в плоскость (небо, параллель).
static JSValue js_unproject(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    if (argc < 2) return JS_ThrowTypeError(ctx, "re2d.unproject(sx, sy, z?)");
    ensure_view();
    float out[2];
    if (!r2d_re2d_unproject(&g_view, (float)num_arg(ctx, argc, argv, 0, 0), (float)num_arg(ctx, argc, argv, 1, 0),
                            (float)num_arg(ctx, argc, argv, 2, 0), out)) {
        return JS_NULL;
    }
    JSValue arr = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, arr, 0, JS_NewFloat64(ctx, out[0]));
    JS_SetPropertyUint32(ctx, arr, 1, JS_NewFloat64(ctx, out[1]));
    return arr;
}

static void set_num(JSContext *ctx, JSValue obj, const char *key, double v);

// engine.re2d.sprite(id) → { texture, u0, v0, u1, v1, w, h } | null.
// Откуда брать текстуру и её прямоугольник для меша: так граням и стенам
// задаётся обычный .sprite('путь.png'), а не отдельный «атрибут текстуры».
static JSValue js_sprite(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    R2DScript *s = JS_GetContextOpaque(ctx);
    const int id = (int)num_arg(ctx, argc, argv, 0, -1);
    if (!s || !s->renderer || !r2d_sprite_alive(s->renderer, id)) return JS_NULL;
    const R2DSprite *sp = &s->renderer->sprites[id];
    JSValue o = JS_NewObject(ctx);
    set_num(ctx, o, "texture", sp->texture);
    set_num(ctx, o, "u0", sp->u0);
    set_num(ctx, o, "v0", sp->v0);
    set_num(ctx, o, "u1", sp->u1);
    set_num(ctx, o, "v1", sp->v1);
    set_num(ctx, o, "w", sp->width);
    set_num(ctx, o, "h", sp->height);
    return o;
}

// engine.re2d.mesh(verts, count?, texture?, flags?) → отправлено вершин.
// verts — Float32Array stride 8 (x, y, z, u, v, r, g, b) в МИРОВЫХ координатах.
static JSValue js_mesh(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    R2DScript *s = JS_GetContextOpaque(ctx);
    if (argc < 1) return JS_ThrowTypeError(ctx, "re2d.mesh(verts: Float32Array, count?, texture?, flags?)");
    ensure_view();
    float *in = NULL;
    size_t nfloats = 0;
    JSValue a = f32_view(ctx, argv[0], &in, &nfloats);
    if (JS_IsException(a)) return a;

    int count = (int)(nfloats / 8);
    if (argc >= 2) {
        const double want = num_arg(ctx, argc, argv, 1, (double)count);
        if (want >= 0 && want < count) count = (int)want;
    }
    count -= count % 3;
    const int texture = (int)num_arg(ctx, argc, argv, 2, -1);
    const unsigned flags = (unsigned)num_arg(ctx, argc, argv, 3, 0);

    memset(&g_stats, 0, sizeof g_stats);
    int submitted = 0;
    if (count >= 3) {
        // Запас под дробление близких крупных треугольников (re2d_math.c): буфер
        // заранее нужного размера не известен, поэтому при нехватке места считаем
        // заново с вдвое большим — вход тот же, результат детерминирован.
        int need = count * 3;
        for (;;) {
            if (need > g_scratch_cap) {
                float *grown = realloc(g_scratch, (size_t)need * 8 * sizeof(float));
                if (!grown) { JS_FreeValue(ctx, a); return JS_ThrowOutOfMemory(ctx); }
                g_scratch = grown;
                g_scratch_cap = need;
            }
            submitted = r2d_re2d_mesh(&g_view, in, count, g_scratch, g_scratch_cap, flags, &g_stats);
            if (g_stats.overflow == 0 || g_scratch_cap >= R2D_RE2D_MAX_VERTS) break;
            need = g_scratch_cap * 2;
        }
        if (submitted > 0 && s && s->renderer) {
            r2d_batch_mesh(s->renderer, g_scratch, submitted, texture);
            ++g_meshes;
            g_mesh_verts += submitted;
        }
    }
    JS_FreeValue(ctx, a);
    return JS_NewInt32(ctx, submitted);
}

static void set_num(JSContext *ctx, JSValue obj, const char *key, double v)
{
    JS_SetPropertyStr(ctx, obj, key, JS_NewFloat64(ctx, v));
}

// engine.re2d.info() → вид и счётчики последнего mesh(): факты, а не пояснения.
static JSValue js_info(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self; (void)argc; (void)argv;
    ensure_view();
    JSValue o = JS_NewObject(ctx);
    set_num(ctx, o, "x", g_view.x);
    set_num(ctx, o, "y", g_view.y);
    set_num(ctx, o, "eye", g_view.eye);
    set_num(ctx, o, "yaw", g_view.yaw);
    set_num(ctx, o, "pitch", g_view.pitch);
    set_num(ctx, o, "fov", g_view.fov);
    set_num(ctx, o, "focal", g_view.focal);
    set_num(ctx, o, "width", g_view.width);
    set_num(ctx, o, "height", g_view.height);
    set_num(ctx, o, "near", g_view.near_plane);
    set_num(ctx, o, "fogFar", g_view.fog_far);
    set_num(ctx, o, "fogMin", g_view.fog_min);
    JSValue st = JS_NewObject(ctx);
    set_num(ctx, st, "trisIn", g_stats.tris_in);
    set_num(ctx, st, "trisOut", g_stats.tris_out);
    set_num(ctx, st, "behind", g_stats.behind);
    set_num(ctx, st, "clipped", g_stats.clipped);
    set_num(ctx, st, "split", g_stats.split);
    set_num(ctx, st, "culled", g_stats.culled);
    set_num(ctx, st, "invalid", g_stats.invalid);
    set_num(ctx, st, "overflow", g_stats.overflow);
    set_num(ctx, st, "meshes", g_meshes);
    set_num(ctx, st, "meshVerts", g_mesh_verts);
    JS_SetPropertyStr(ctx, o, "stats", st);
    return o;
}

int r2d_re2d_install(JSContext *ctx, JSValue engine)
{
    JSValue re2d = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, re2d, "view", JS_NewCFunction(ctx, js_view, "view", 6));
    JS_SetPropertyStr(ctx, re2d, "project", JS_NewCFunction(ctx, js_project, "project", 2));
    JS_SetPropertyStr(ctx, re2d, "sprite", JS_NewCFunction(ctx, js_sprite, "sprite", 1));
    JS_SetPropertyStr(ctx, re2d, "unproject", JS_NewCFunction(ctx, js_unproject, "unproject", 3));
    JS_SetPropertyStr(ctx, re2d, "mesh", JS_NewCFunction(ctx, js_mesh, "mesh", 4));
    JS_SetPropertyStr(ctx, re2d, "info", JS_NewCFunction(ctx, js_info, "info", 0));
    JS_SetPropertyStr(ctx, re2d, "CULL_BACK", JS_NewInt32(ctx, R2D_RE2D_CULL_BACK));
    JS_SetPropertyStr(ctx, re2d, "NO_SPLIT", JS_NewInt32(ctx, R2D_RE2D_NO_SPLIT));
    JS_SetPropertyStr(ctx, engine, "re2d", re2d);
    return 0;
}
