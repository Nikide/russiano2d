// ===========================================================================
// Нативные проходы кадра по узлам $ — см. nodes.h.
//
// Каждая функция повторяет ровно ту математику, что была в JS (ссылки на
// исходные функции — в комментариях): поведение $ не меняется, меняется только
// цена прохода. Где JS-проход вызывал обработчики событий посреди цикла
// (mouseenter, hit, …), C-проход «возобновляемый»: он останавливается на узле с
// событием, JS рассылает событие и продолжает с того же места. Так обработчик
// по-прежнему видит мир в том состоянии, в каком видел раньше.
// ===========================================================================

#include "nodes.h"

#include "physics.h"
#include "r2d.h"
#include "script.h"

#include <SDL3/SDL.h>
#include <math.h>
#include <stdlib.h>

// ---------------------------------------------------------------------------
// Атомы полей узла
// ---------------------------------------------------------------------------

#define R2D_NODE_ATOMS(X)                                                            \
    X(x) X(y) X(w) X(h) X(angle) X(scale_x) X(scale_y) X(alpha) X(visible) X(layer) \
    X(depth) X(uid) X(parent_node) X(depth_relative) X(removed) X(attrs) X(ui)      \
    X(body) X(cur_hp) X(_hp_seen) X(_vis_seen) X(picked) X(hovered) X(_drop_queued)  \
    X(kind) X(tag) X(clip) X(shadow) X(outline) X(nine_slice) X(shake_timer)         \
    X(pivot_x) X(pivot_y) X(shader_name) X(blend_mode) X(sprite) X(color) X(tint)    \
    X(tint_timer) X(_scr_x) X(_scr_y) X(_scr_frame) X(_rk)

typedef struct {
#define R2D_DECL_ATOM(name) JSAtom name;
    R2D_NODE_ATOMS(R2D_DECL_ATOM)
#undef R2D_DECL_ATOM
    JSValue str_2d;       // '2d' — вид обычного узла
    JSValue str_none;     // 'none' — шейдер выключен
    JSValue blend_names[4];
    // Теги, которые рисует не общий путь: text/circle/light и отрисовщики
    // модулей (registerNodeRenderer). Версия меняется при каждой замене
    // набора — по ней узел перепроверяет закэшированный признак `_rk`.
    JSAtom special[64];
    int    special_count;
    int    special_version;
    bool   ready;
} R2DNodeAtoms;

// Один рантайм QuickJS на процесс; при hot reload рантайм пересоздаётся и
// install вызывается заново — старые атомы принадлежали уничтоженному рантайму.
static R2DNodeAtoms A;

static inline JSValue prop(JSContext *ctx, JSValueConst obj, JSAtom atom)
{
    return JS_GetProperty(ctx, obj, atom);
}

// Number(v) без исключений: так JS-код читал эти поля (`node.w * …`).
static inline double to_num(JSContext *ctx, JSValue v)
{
    const int tag = JS_VALUE_GET_NORM_TAG(v);
    if (tag == JS_TAG_INT) return (double)JS_VALUE_GET_INT(v);
    if (tag == JS_TAG_FLOAT64) return JS_VALUE_GET_FLOAT64(v);
    if (tag == JS_TAG_UNDEFINED) return NAN;
    if (tag == JS_TAG_NULL) return 0.0;
    if (tag == JS_TAG_BOOL) return JS_VALUE_GET_BOOL(v) ? 1.0 : 0.0;
    double d = NAN;
    if (JS_ToFloat64(ctx, &d, v) < 0) {
        JS_FreeValue(ctx, JS_GetException(ctx));
        d = NAN;
    }
    return d;
}

static inline double num_prop(JSContext *ctx, JSValueConst obj, JSAtom atom)
{
    JSValue v = prop(ctx, obj, atom);
    const double d = to_num(ctx, v);
    JS_FreeValue(ctx, v);
    return d;
}

// Истинность значения по правилам JS (`if (node.shadow)`).
static inline bool truthy_prop(JSContext *ctx, JSValueConst obj, JSAtom atom)
{
    JSValue v = prop(ctx, obj, atom);
    const int b = JS_ToBool(ctx, v);
    JS_FreeValue(ctx, v);
    return b > 0;
}

// `node.visible === false` — строго ложь, как в inheritedVisible().
static inline bool strictly_false(JSContext *ctx, JSValueConst obj, JSAtom atom)
{
    JSValue v = prop(ctx, obj, atom);
    const bool r = JS_VALUE_GET_NORM_TAG(v) == JS_TAG_BOOL && !JS_VALUE_GET_BOOL(v);
    JS_FreeValue(ctx, v);
    return r;
}

static inline bool strictly_true(JSContext *ctx, JSValueConst obj, JSAtom atom)
{
    JSValue v = prop(ctx, obj, atom);
    const bool r = JS_VALUE_GET_NORM_TAG(v) == JS_TAG_BOOL && JS_VALUE_GET_BOOL(v);
    JS_FreeValue(ctx, v);
    return r;
}

static inline void set_num(JSContext *ctx, JSValueConst obj, JSAtom atom, double d)
{
    JS_SetProperty(ctx, obj, atom, JS_NewFloat64(ctx, d));
}

// `node.attrs && node.attrs.<key>` истинно.
static bool attrs_truthy(JSContext *ctx, JSValueConst node, JSAtom key)
{
    JSValue attrs = prop(ctx, node, A.attrs);
    bool r = false;
    if (JS_IsObject(attrs)) r = truthy_prop(ctx, attrs, key);
    JS_FreeValue(ctx, attrs);
    return r;
}

// JS-массив → длина (0 для не-массива).
static uint32_t list_length(JSContext *ctx, JSValueConst list)
{
    int64_t len = 0;
    if (!JS_IsObject(list) || JS_GetLength(ctx, list, &len) < 0) return 0;
    return len > 0 ? (uint32_t)len : 0;
}

// Float64Array параметров прохода: указатель на данные и длина.
static double *f64_args(JSContext *ctx, JSValueConst v, size_t *count)
{
    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, v, &off, &len, &bpe);
    if (JS_IsException(ab)) return NULL;
    size_t size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, ab);
    JS_FreeValue(ctx, ab);
    if (!base || bpe != 8) return NULL;
    *count = len / 8;
    return (double *)(base + off);
}

// Произвольный типизированный массив: указатель, число элементов, размер элемента.
static void *typed_args(JSContext *ctx, JSValueConst v, size_t *count, size_t elem)
{
    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, v, &off, &len, &bpe);
    if (JS_IsException(ab)) return NULL;
    size_t size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, ab);
    JS_FreeValue(ctx, ab);
    if (!base || bpe != elem) return NULL;
    *count = len / elem;
    return base + off;
}

// ---------------------------------------------------------------------------
// engine.nodes.specialTags(['text', 'circle', …]) — теги не для общего пути
// ---------------------------------------------------------------------------

static JSValue js_special_tags(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    for (int i = 0; i < A.special_count; ++i) JS_FreeAtom(ctx, A.special[i]);
    A.special_count = 0;
    if (argc >= 1) {
        const uint32_t n = list_length(ctx, argv[0]);
        for (uint32_t i = 0; i < n && A.special_count < (int)SDL_arraysize(A.special); ++i) {
            JSValue v = JS_GetPropertyUint32(ctx, argv[0], i);
            if (JS_IsString(v)) A.special[A.special_count++] = JS_ValueToAtom(ctx, v);
            JS_FreeValue(ctx, v);
        }
    }
    A.special_version++;
    return JS_UNDEFINED;
}

// Рисуется ли узел НЕ общим путём из-за тега. Кэш на узле — `_rk`:
// версия набора * 2 + признак, чтобы атом тега не искать каждый кадр.
static bool special_tag(JSContext *ctx, JSValueConst node)
{
    const double rk = num_prop(ctx, node, A._rk);
    if (rk == rk && (int)(rk / 2) == A.special_version) return ((int)rk & 1) != 0;
    JSValue tag = prop(ctx, node, A.tag);
    bool special = false;
    if (JS_IsString(tag)) {
        const JSAtom atom = JS_ValueToAtom(ctx, tag);
        for (int i = 0; i < A.special_count; ++i) {
            if (A.special[i] == atom) { special = true; break; }
        }
        JS_FreeAtom(ctx, atom);
    }
    JS_FreeValue(ctx, tag);
    set_num(ctx, node, A._rk, (double)(A.special_version * 2 + (special ? 1 : 0)));
    return special;
}

// ---------------------------------------------------------------------------
// engine.nodes.syncBodies(list) — world.sync: трансформы тел → узлы
// ---------------------------------------------------------------------------

static JSValue js_sync_bodies(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
    if (!s || !s->physics || argc < 1) return JS_UNDEFINED;
    const R2DPhysics *p = s->physics;
    const uint32_t n = list_length(ctx, argv[0]);
    for (uint32_t i = 0; i < n; ++i) {
        JSValue node = JS_GetPropertyUint32(ctx, argv[0], i);
        if (!JS_IsObject(node) || truthy_prop(ctx, node, A.removed)) { JS_FreeValue(ctx, node); continue; }
        const double body = num_prop(ctx, node, A.body);
        if (!(body >= 0)) { JS_FreeValue(ctx, node); continue; }
        const int id = (int)body;
        if (!r2d_physics_is_alive(p, id)) {
            JS_SetProperty(ctx, node, A.body, JS_NewInt32(ctx, -1));
            JS_FreeValue(ctx, node);
            continue;
        }
        set_num(ctx, node, A.x, (double)p->transforms[id * 3]);
        set_num(ctx, node, A.y, (double)p->transforms[id * 3 + 1]);
        set_num(ctx, node, A.angle, (double)p->transforms[id * 3 + 2]);
        JS_FreeValue(ctx, node);
    }
    return JS_UNDEFINED;
}

// ---------------------------------------------------------------------------
// engine.nodes.worldEvents(list, start, out) — worldEvents() из world.js
// ---------------------------------------------------------------------------
//
// Ищет с `start` первый узел, у которого есть событие, обновляет у него
// `_hp_seen`/`_vis_seen` и возвращает его индекс; -1 — событий нет до конца.
// out (Float64Array): [0] прошлое hp, [1] текущее hp, [2] видимость:
// 0 — не менялась, 1 — show, 2 — hide.

static JSValue js_world_events(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 3) return JS_NewInt32(ctx, -1);
    size_t out_n = 0;
    double *out = f64_args(ctx, argv[2], &out_n);
    if (!out || out_n < 3) return JS_ThrowTypeError(ctx, "nodes.worldEvents: out — Float64Array(3)");
    const uint32_t n = list_length(ctx, argv[0]);
    int32_t start = 0;
    JS_ToInt32(ctx, &start, argv[1]);
    for (uint32_t i = start > 0 ? (uint32_t)start : 0; i < n; ++i) {
        JSValue node = JS_GetPropertyUint32(ctx, argv[0], i);
        if (!JS_IsObject(node)) { JS_FreeValue(ctx, node); continue; }
        JSValue was_v = prop(ctx, node, A._hp_seen);
        JSValue hp_v = prop(ctx, node, A.cur_hp);
        if (JS_IsUndefined(was_v)) {
            // Узел впервые попал в обход: запоминаем состояние без событий.
            JS_SetProperty(ctx, node, A._hp_seen, JS_DupValue(ctx, hp_v));
            JS_SetProperty(ctx, node, A._vis_seen, prop(ctx, node, A.visible));
            JS_FreeValue(ctx, hp_v);
            JS_FreeValue(ctx, node);
            continue;
        }
        const double was = to_num(ctx, was_v);
        const double now = to_num(ctx, hp_v);
        JS_FreeValue(ctx, was_v);

        JSValue vis = prop(ctx, node, A.visible);
        JSValue vis_seen = prop(ctx, node, A._vis_seen);
        const bool vis_changed = !JS_IsStrictEqual(ctx, vis_seen, vis);
        JS_FreeValue(ctx, vis_seen);

        // Те же сравнения, что в JS: события hit/heal/death/respawn.
        const bool hp_event = now < was || now > was || (was > 0 && now <= 0) || (was <= 0 && now > 0);
        if (!hp_event && !vis_changed) {
            JS_SetProperty(ctx, node, A._hp_seen, hp_v);   // владение переходит
            JS_FreeValue(ctx, vis);
            JS_FreeValue(ctx, node);
            continue;
        }
        out[0] = was;
        out[1] = now;
        out[2] = vis_changed ? (JS_ToBool(ctx, vis) > 0 ? 1.0 : 2.0) : 0.0;
        if (vis_changed) JS_SetProperty(ctx, node, A._vis_seen, JS_DupValue(ctx, vis));
        JS_SetProperty(ctx, node, A._hp_seen, hp_v);
        JS_FreeValue(ctx, vis);
        JS_FreeValue(ctx, node);
        return JS_NewInt32(ctx, (int32_t)i);
    }
    return JS_NewInt32(ctx, -1);
}

// ---------------------------------------------------------------------------
// engine.nodes.hover(list, start, P) — tickWorldHover() из api.js
// ---------------------------------------------------------------------------
//
// P (Float64Array): [0] mx, [1] my, [2] zoom половин размера, [3] cam.x,
// [4] cam.y, [5] half_w, [6] half_h, [7] shake_x, [8] shake_y, [9] кадр,
// [10] zoom позиции, [11] top_score (состояние), [12] индекс верхнего (состояние).
// Возвращает индекс узла, у которого сменилось попадание (attrs.picked и
// hovered уже записаны) — JS рассылает mouseenter/mouseleave и продолжает;
// -1 — проход завершён.

static JSValue js_hover(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 3) return JS_NewInt32(ctx, -1);
    size_t pn = 0;
    double *P = f64_args(ctx, argv[2], &pn);
    if (!P || pn < 13) return JS_ThrowTypeError(ctx, "nodes.hover: P — Float64Array(13)");
    const uint32_t n = list_length(ctx, argv[0]);
    int32_t start = 0;
    JS_ToInt32(ctx, &start, argv[1]);
    const double mx = P[0], my = P[1], zoom = P[2];
    for (uint32_t i = start > 0 ? (uint32_t)start : 0; i < n; ++i) {
        JSValue node = JS_GetPropertyUint32(ctx, argv[0], i);
        if (!JS_IsObject(node)) { JS_FreeValue(ctx, node); continue; }
        JSValue attrs = prop(ctx, node, A.attrs);
        if (JS_IsObject(attrs) && truthy_prop(ctx, attrs, A.ui)) goto next;
        if (!truthy_prop(ctx, node, A.visible)) goto next;
        {
            const double alpha = num_prop(ctx, node, A.alpha);
            if (alpha <= 0) goto next;
            const double w = num_prop(ctx, node, A.w), h = num_prop(ctx, node, A.h);
            if (w <= 0 || h <= 0) goto next;

            // nodeScreenPos(): у параллакс-узла — позиция до сдвига этого кадра.
            double sx = num_prop(ctx, node, A.x), sy = num_prop(ctx, node, A.y);
            const double scr_frame = num_prop(ctx, node, A._scr_frame);
            if (scr_frame == scr_frame && scr_frame == P[9]) {
                sx = num_prop(ctx, node, A._scr_x);
                sy = num_prop(ctx, node, A._scr_y);
            }
            const double px = (sx - P[3]) * P[10] + P[5] + P[7];
            const double py = (sy - P[4]) * P[10] + P[6] + P[8];

            JSValue scx = prop(ctx, node, A.scale_x), scy = prop(ctx, node, A.scale_y);
            const double kx = JS_IsUndefined(scx) ? 1.0 : to_num(ctx, scx);
            const double ky = JS_IsUndefined(scy) ? 1.0 : to_num(ctx, scy);
            JS_FreeValue(ctx, scx);
            JS_FreeValue(ctx, scy);
            const double hw = fabs(w * kx * zoom) / 2.0;
            const double hh = fabs(h * ky * zoom) / 2.0;
            const bool inside = !truthy_prop(ctx, node, A._drop_queued) &&
                                fabs(mx - px) <= hw && fabs(my - py) <= hh;

            JSValue picked = JS_IsObject(attrs) ? prop(ctx, attrs, A.picked) : JS_UNDEFINED;
            const bool same = JS_VALUE_GET_NORM_TAG(picked) == JS_TAG_BOOL &&
                              (bool)JS_VALUE_GET_BOOL(picked) == inside;
            JS_FreeValue(ctx, picked);

            if (inside) {
                // Верхний — позже в порядке отрисовки: layer, depth, y узла.
                const double layer = num_prop(ctx, node, A.layer);
                const double depth = num_prop(ctx, node, A.depth);
                const double score = (layer == layer && layer != 0 ? layer : 0) * 1e6 +
                                     (depth == depth && depth != 0 ? depth : 0) * 1e3 +
                                     num_prop(ctx, node, A.y);
                if (score >= P[11]) { P[11] = score; P[12] = (double)i; }
            }
            if (!same) {
                if (JS_IsObject(attrs)) JS_SetProperty(ctx, attrs, A.picked, JS_NewBool(ctx, inside));
                JS_SetProperty(ctx, node, A.hovered, JS_NewBool(ctx, inside));
                JS_FreeValue(ctx, attrs);
                JS_FreeValue(ctx, node);
                return JS_NewInt32(ctx, (int32_t)i);
            }
        }
    next:
        JS_FreeValue(ctx, attrs);
        JS_FreeValue(ctx, node);
    }
    return JS_NewInt32(ctx, -1);
}

// ---------------------------------------------------------------------------
// Сортировка мира — sortedNodes() из render.js
// ---------------------------------------------------------------------------

// effectiveDepth(): глубина с учётом родителя у узлов с depth_relative.
static double effective_depth(JSContext *ctx, JSValueConst node)
{
    if (!strictly_true(ctx, node, A.depth_relative)) {
        const double d = num_prop(ctx, node, A.depth);
        return d == d ? d : 0.0;   // Number(node.depth) || 0
    }
    double depth = 0;
    JSValue cur = JS_DupValue(ctx, node);
    for (int guard = 0; JS_IsObject(cur) && guard < 4096; ++guard) {
        const double d = num_prop(ctx, cur, A.depth);
        if (d == d) depth += d;
        if (!strictly_true(ctx, cur, A.depth_relative)) break;
        JSValue parent = prop(ctx, cur, A.parent_node);
        JS_FreeValue(ctx, cur);
        cur = parent;
    }
    JS_FreeValue(ctx, cur);
    return depth;
}

typedef struct { double layer, key, uid; uint32_t index; } SortKey;

// compareByLayer / compareByY: layer, затем глубина (или y), затем uid.
// Числовая разность, как в JS-компараторе: `a.layer - b.layer`.
static int cmp_keys(const SortKey *a, const SortKey *b)
{
    if (a->layer != b->layer) { const double d = a->layer - b->layer; return d < 0 ? -1 : (d > 0 ? 1 : 0); }
    if (a->key != b->key) { const double d = a->key - b->key; return d < 0 ? -1 : (d > 0 ? 1 : 0); }
    const double d = a->uid - b->uid;
    if (d < 0) return -1;
    if (d > 0) return 1;
    return a->index < b->index ? -1 : (a->index > b->index ? 1 : 0);   // стабильность
}

static int cmp_keys_q(const void *a, const void *b) { return cmp_keys((const SortKey *)a, (const SortKey *)b); }

static SortKey *sort_buf;
static uint32_t sort_cap;

static bool read_keys(JSContext *ctx, JSValueConst list, uint32_t n, bool by_y)
{
    if (n > sort_cap) {
        SortKey *grown = (SortKey *)SDL_realloc(sort_buf, sizeof(SortKey) * n);
        if (!grown) return false;
        sort_buf = grown;
        sort_cap = n;
    }
    for (uint32_t i = 0; i < n; ++i) {
        JSValue node = JS_GetPropertyUint32(ctx, list, i);
        SortKey *k = &sort_buf[i];
        k->index = i;
        if (JS_IsObject(node)) {
            k->layer = num_prop(ctx, node, A.layer);
            k->key = by_y ? num_prop(ctx, node, A.y) : effective_depth(ctx, node);
            k->uid = num_prop(ctx, node, A.uid);
        } else {
            k->layer = k->key = k->uid = 0;
        }
        JS_FreeValue(ctx, node);
    }
    return true;
}

// engine.nodes.sortWorld(list, mode) — mode 'y' или иначе 'layer'.
// Если массив уже упорядочен — ничего не пишет и возвращает false
// (кэш sortedNodes остаётся годным); иначе сортирует на месте → true.
static JSValue js_sort_world(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 1) return JS_FALSE;
    bool by_y = false;
    if (argc >= 2 && JS_IsString(argv[1])) {
        const char *mode = JS_ToCString(ctx, argv[1]);
        by_y = mode && mode[0] == 'y' && mode[1] == 0;
        JS_FreeCString(ctx, mode);
    }
    const uint32_t n = list_length(ctx, argv[0]);
    if (n < 2) return JS_FALSE;
    if (!read_keys(ctx, argv[0], n, by_y)) return JS_ThrowOutOfMemory(ctx);

    bool ordered = true;
    for (uint32_t i = 1; i < n; ++i) {
        if (cmp_keys(&sort_buf[i - 1], &sort_buf[i]) > 0) { ordered = false; break; }
    }
    if (ordered) return JS_FALSE;

    qsort(sort_buf, n, sizeof(SortKey), cmp_keys_q);
    // Перестановка: собрать узлы в новом порядке и записать обратно.
    JSValue *tmp = (JSValue *)SDL_malloc(sizeof(JSValue) * n);
    if (!tmp) return JS_ThrowOutOfMemory(ctx);
    for (uint32_t i = 0; i < n; ++i) tmp[i] = JS_GetPropertyUint32(ctx, argv[0], sort_buf[i].index);
    for (uint32_t i = 0; i < n; ++i) JS_SetPropertyUint32(ctx, argv[0], i, tmp[i]);   // владение переходит
    SDL_free(tmp);
    return JS_TRUE;
}

// engine.nodes.collectWorld(nodes, out) — узлы мира без удалённых и ui:
// пишет в out (JS-массив) и возвращает число.
static JSValue js_collect_world(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 2) return JS_NewInt32(ctx, 0);
    const uint32_t n = list_length(ctx, argv[0]);
    uint32_t w = 0;
    for (uint32_t i = 0; i < n; ++i) {
        JSValue node = JS_GetPropertyUint32(ctx, argv[0], i);
        if (!JS_IsObject(node) || truthy_prop(ctx, node, A.removed) || attrs_truthy(ctx, node, A.ui)) {
            JS_FreeValue(ctx, node);
            continue;
        }
        JS_SetPropertyUint32(ctx, argv[1], w++, node);
    }
    JS_SetLength(ctx, argv[1], w);
    return JS_NewInt32(ctx, (int32_t)w);
}

// ---------------------------------------------------------------------------
// engine.nodes.drawWorld(list, P, xf, col, blend, fx, clip, count, cb)
// ---------------------------------------------------------------------------
//
// Проход мира одной камерой — drawWorldPassInner() + drawWorldNode() из
// render.js. Обычный узел (спрайт/прямоугольник без тени, контура,
// nine-slice, шейдера, обрезки, тряски и не особого вида/тега) пишется прямо
// в буферы батча. Остальное рисует JS: `cb(node, count)` возвращает новый
// count. Порядок отрисовки сохраняется — узлы идут строго по списку.
//
// P (Float64Array): [0] cam.x, [1] cam.y, [2] zoom позиции (zoom||1),
// [3] zoom размера (cam.zoom), [4] поворот, [5] центр x, [6] центр y,
// [7] shake_x, [8] shake_y, [9] ширина отсечения, [10] высота отсечения,
// [11] отсечение вкл, [12] прозрачность прохода, [13] белый спрайт,
// [14] режим смешивания по умолчанию, [15] текущая обрезка, [16] ёмкость
// буфера, [17] выход: сколько узлов нарисовано (общий путь).

enum { BLEND_ALPHA = 0, BLEND_ADD, BLEND_MULTIPLY, BLEND_NONE };

static uint8_t blend_of(JSContext *ctx, JSValueConst node, uint8_t fallback)
{
    JSValue v = prop(ctx, node, A.blend_mode);
    uint8_t id = fallback;
    if (JS_IsString(v)) {
        id = 0;   // неизвестное имя → alpha, как blendId()
        for (int i = 0; i < 4; ++i) {
            if (JS_IsStrictEqual(ctx, v, A.blend_names[i])) { id = (uint8_t)i; break; }
        }
    } else if (!JS_IsUndefined(v) && !JS_IsNull(v)) {
        id = 0;
    }
    JS_FreeValue(ctx, v);
    return id;
}

// withAlpha(): альфа ЗАМЕНЯЕТ байт цвета, а не умножается.
static inline uint32_t with_alpha(uint32_t packed, double alpha)
{
    double a = floor(alpha * 255.0 + 0.5);
    if (!(a >= 0)) a = 0;
    if (a > 255) a = 255;
    const uint32_t ai = (uint32_t)a;
    if (((packed >> 24) & 0xffu) == ai) return packed;
    return (packed & 0x00ffffffu) | (ai << 24);
}

static inline uint32_t to_u32(JSContext *ctx, JSValue v)
{
    int32_t i = 0;
    if (JS_VALUE_GET_NORM_TAG(v) == JS_TAG_INT) return (uint32_t)JS_VALUE_GET_INT(v);
    if (JS_ToInt32(ctx, &i, v) < 0) { JS_FreeValue(ctx, JS_GetException(ctx)); return 0; }
    return (uint32_t)i;
}

// Нужен ли узлу JS-путь (см. drawWorldNodeClipped/Inner).
static bool needs_js(JSContext *ctx, JSValueConst node)
{
    JSValue kind = prop(ctx, node, A.kind);
    const bool plain_kind = JS_IsStrictEqual(ctx, kind, A.str_2d);
    JS_FreeValue(ctx, kind);
    if (!plain_kind) return true;
    if (special_tag(ctx, node)) return true;
    if (attrs_truthy(ctx, node, A.clip)) return true;
    if (truthy_prop(ctx, node, A.shadow) || truthy_prop(ctx, node, A.outline) ||
        truthy_prop(ctx, node, A.nine_slice)) return true;
    if (num_prop(ctx, node, A.shake_timer) > 0) return true;
    JSValue shader = prop(ctx, node, A.shader_name);
    const bool fx = JS_ToBool(ctx, shader) > 0 && !JS_IsStrictEqual(ctx, shader, A.str_none);
    JS_FreeValue(ctx, shader);
    return fx;
}

static JSValue js_draw_world(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 9) return JS_ThrowTypeError(ctx, "nodes.drawWorld: 9 аргументов");
    size_t pn = 0, xn = 0, cn = 0, bn = 0, fn = 0, kn = 0;
    double *P = f64_args(ctx, argv[1], &pn);
    float *xf = (float *)typed_args(ctx, argv[2], &xn, 4);
    uint32_t *col = (uint32_t *)typed_args(ctx, argv[3], &cn, 4);
    uint8_t *blend = (uint8_t *)typed_args(ctx, argv[4], &bn, 1);
    int32_t *fx = (int32_t *)typed_args(ctx, argv[5], &fn, 4);
    int16_t *clip = (int16_t *)typed_args(ctx, argv[6], &kn, 2);
    if (!P || pn < 18 || !xf || !col || !blend || !fx || !clip) {
        return JS_ThrowTypeError(ctx, "nodes.drawWorld: неверные буферы батча");
    }
    int32_t count = 0;
    JS_ToInt32(ctx, &count, argv[7]);
    JSValueConst cb = argv[8];

    size_t cap = (size_t)P[16];
    if (cap > xn / 6) cap = xn / 6;
    if (cap > cn) cap = cn;
    if (cap > bn) cap = bn;
    if (cap > fn) cap = fn;
    if (cap > kn) cap = kn;

    const double cam_x = P[0], cam_y = P[1], zpos = P[2], zsize = P[3], rot = P[4];
    const double cx = P[5], cy = P[6], shx = P[7], shy = P[8];
    const double cull_w = P[9], cull_h = P[10];
    const bool culling = P[11] != 0;
    const double pass_alpha = P[12];
    const double white = P[13];
    const uint8_t default_blend = (uint8_t)P[14];
    const int16_t clip_cur = (int16_t)P[15];
    const double rc = cos(rot), rs = sin(rot);
    double drawn = 0;

    const uint32_t n = list_length(ctx, argv[0]);
    for (uint32_t i = 0; i < n; ++i) {
        JSValue node = JS_GetPropertyUint32(ctx, argv[0], i);
        if (!JS_IsObject(node)) { JS_FreeValue(ctx, node); continue; }

        // inheritedVisible / inheritedAlpha по цепочке родителей.
        bool visible = true;
        double eff_alpha = 1.0;
        JSValue cur = JS_DupValue(ctx, node);
        for (int guard = 0; JS_IsObject(cur) && guard < 4096; ++guard) {
            if (strictly_false(ctx, cur, A.visible)) { visible = false; break; }
            JSValue parent = prop(ctx, cur, A.parent_node);
            JS_FreeValue(ctx, cur);
            cur = parent;
        }
        JS_FreeValue(ctx, cur);
        if (!visible) { JS_FreeValue(ctx, node); continue; }
        cur = JS_DupValue(ctx, node);
        for (int guard = 0; JS_IsObject(cur) && guard < 4096; ++guard) {
            const double a = num_prop(ctx, cur, A.alpha);
            if (isfinite(a)) eff_alpha *= a;
            if (eff_alpha <= 0) break;
            JSValue parent = prop(ctx, cur, A.parent_node);
            JS_FreeValue(ctx, cur);
            cur = parent;
        }
        JS_FreeValue(ctx, cur);
        if (eff_alpha <= 0) { JS_FreeValue(ctx, node); continue; }

        if (needs_js(ctx, node)) {
            JSValue args[2] = { node, JS_NewInt32(ctx, count) };
            JSValue r = JS_Call(ctx, cb, JS_UNDEFINED, 2, args);
            JS_FreeValue(ctx, node);
            if (JS_IsException(r)) return r;
            JS_ToInt32(ctx, &count, r);
            JS_FreeValue(ctx, r);
            continue;
        }

        // nodeTransform(): та же математика кадра, что frameViewPoint().
        const double x = num_prop(ctx, node, A.x), y = num_prop(ctx, node, A.y);
        const double dx = (x - cam_x) * zpos, dy = (y - cam_y) * zpos;
        double tx, ty;
        if (rot == 0) { tx = dx + cx; ty = dy + cy; }
        else { tx = dx * rc - dy * rs + cx; ty = dx * rs + dy * rc + cy; }
        tx += shx;
        ty += shy;
        const double tw = num_prop(ctx, node, A.w) * num_prop(ctx, node, A.scale_x) * zsize;
        const double th = num_prop(ctx, node, A.h) * num_prop(ctx, node, A.scale_y) * zsize;

        // applyPivot(): центр квада уезжает на (0.5 − pivot) размера.
        JSValue pvx = prop(ctx, node, A.pivot_x), pvy = prop(ctx, node, A.pivot_y);
        const double pivot_x = JS_IsUndefined(pvx) ? 0.5 : to_num(ctx, pvx);
        const double pivot_y = JS_IsUndefined(pvy) ? 0.5 : to_num(ctx, pvy);
        JS_FreeValue(ctx, pvx);
        JS_FreeValue(ctx, pvy);
        if (!(pivot_x == 0.5 && pivot_y == 0.5)) {
            tx += (0.5 - pivot_x) * tw;
            ty += (0.5 - pivot_y) * th;
        }

        if (culling) {
            if (tx + fabs(tw) < -64 || tx - fabs(tw) > cull_w + 64 ||
                ty + fabs(th) < -64 || ty - fabs(th) > cull_h + 64) {
                JS_FreeValue(ctx, node);
                continue;
            }
        }
        drawn += 1;

        double sprite = num_prop(ctx, node, A.sprite);
        if (!(sprite >= 0)) sprite = white;

        // baseColor(): временный цвет вспышки, затем альфа узла и прохода.
        uint32_t color;
        JSValue tint = prop(ctx, node, A.tint);
        if (JS_ToBool(ctx, tint) > 0 && num_prop(ctx, node, A.tint_timer) > 0) {
            color = to_u32(ctx, tint);
        } else {
            JSValue c = prop(ctx, node, A.color);
            color = to_u32(ctx, c);
            JS_FreeValue(ctx, c);
        }
        JS_FreeValue(ctx, tint);
        if (eff_alpha < 1) color = with_alpha(color, eff_alpha);
        if (pass_alpha < 1) color = with_alpha(color, pass_alpha);

        if ((size_t)count < cap && sprite >= 0) {
            const size_t o = (size_t)count * 6;
            xf[o] = (float)sprite;
            xf[o + 1] = (float)tx;
            xf[o + 2] = (float)ty;
            xf[o + 3] = (float)tw;
            xf[o + 4] = (float)th;
            xf[o + 5] = (float)num_prop(ctx, node, A.angle);
            col[count] = color;
            blend[count] = blend_of(ctx, node, default_blend);
            fx[count] = 0;
            clip[count] = clip_cur;
            count++;
        }
        JS_FreeValue(ctx, node);
    }
    P[17] = drawn;
    return JS_NewInt32(ctx, count);
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

int r2d_nodes_install(JSContext *ctx, JSValue engine)
{
    // Атомы прошлого рантайма умерли вместе с ним — заводим заново.
    SDL_zero(A);
#define R2D_MAKE_ATOM(name) A.name = JS_NewAtom(ctx, #name);
    R2D_NODE_ATOMS(R2D_MAKE_ATOM)
#undef R2D_MAKE_ATOM
    A.str_2d = JS_NewString(ctx, "2d");
    A.str_none = JS_NewString(ctx, "none");
    static const char *const blends[4] = { "alpha", "add", "multiply", "none" };
    for (int i = 0; i < 4; ++i) A.blend_names[i] = JS_NewString(ctx, blends[i]);
    A.special_version = 1;
    A.ready = true;

    JSValue nodes = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, nodes, "specialTags", JS_NewCFunction(ctx, js_special_tags, "specialTags", 1));
    JS_SetPropertyStr(ctx, nodes, "syncBodies", JS_NewCFunction(ctx, js_sync_bodies, "syncBodies", 1));
    JS_SetPropertyStr(ctx, nodes, "worldEvents", JS_NewCFunction(ctx, js_world_events, "worldEvents", 3));
    JS_SetPropertyStr(ctx, nodes, "hover", JS_NewCFunction(ctx, js_hover, "hover", 3));
    JS_SetPropertyStr(ctx, nodes, "sortWorld", JS_NewCFunction(ctx, js_sort_world, "sortWorld", 2));
    JS_SetPropertyStr(ctx, nodes, "collectWorld", JS_NewCFunction(ctx, js_collect_world, "collectWorld", 2));
    JS_SetPropertyStr(ctx, nodes, "drawWorld", JS_NewCFunction(ctx, js_draw_world, "drawWorld", 9));
    JS_SetPropertyStr(ctx, engine, "nodes", nodes);
    return 0;
}
