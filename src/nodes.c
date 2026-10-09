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

// Без слияния a*b+c в FMA: компилятор на arm64 делает это по умолчанию, а
// QuickJS считает раздельно — и твин или позиция на экране расходились бы с
// прежним JS-путём в последнем знаке (тест «C против JS» это ловит).
#if defined(__clang__)
#pragma clang fp contract(off)
#elif defined(__GNUC__)
#pragma GCC optimize("fp-contract=off")
#elif defined(_MSC_VER)
#pragma fp_contract(off)
#endif

#include "font.h"
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
    X(tint_timer) X(_scr_x) X(_scr_y) X(_scr_frame) X(_rk)                         \
    X(class_list) X(tr) X(controls) X(trigger) X(anim) X(__clip) X(parallax_factor)   \
    X(shake_amount) X(iframes) X(_fx)                                              \
    X(text) X(size) X(font) X(align) X(_tm_text) X(_tm_size) X(_tm_family)       \
    X(age) X(life) X(end_size) X(t) X(v) X(_uk)                                   \
    X(_anchor) X(anchorLeft) X(anchorTop) X(anchorRight) X(anchorBottom)           \
    X(offsetLeft) X(offsetTop) X(offsetRight) X(offsetBottom) X(themeName)         \
    X(_style) X(_styleStates)

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
    // UI-теги со своими отрисовщиками (registerUINodeRenderer) и атомы
    // встроенных тегов, которые UI-проход рисует сам.
    JSAtom ui_special[64];
    int    ui_special_count;
    int    ui_version;
    JSAtom tag_ui_label, tag_ui_panel;
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

// Как рисуется узел по тегу: общий путь, особый (JS) или текст (C).
// Кэш на узле — `_rk` = версия набора * 4 + вид, чтобы атом тега не искать
// каждый кадр.
enum { RK_PLAIN = 0, RK_SPECIAL = 1, RK_TEXT = 2 };

static int render_kind(JSContext *ctx, JSValueConst node)
{
    const double rk = num_prop(ctx, node, A._rk);
    if (rk == rk && (int)(rk / 4) == A.special_version) return (int)rk & 3;
    JSValue tag = prop(ctx, node, A.tag);
    int kind = RK_PLAIN;
    if (JS_IsString(tag)) {
        const JSAtom atom = JS_ValueToAtom(ctx, tag);
        if (atom == A.text) {
            kind = RK_TEXT;
        } else {
            for (int i = 0; i < A.special_count; ++i) {
                if (A.special[i] == atom) { kind = RK_SPECIAL; break; }
            }
        }
        JS_FreeAtom(ctx, atom);
    }
    JS_FreeValue(ctx, tag);
    set_num(ctx, node, A._rk, (double)(A.special_version * 4 + kind));
    return kind;
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

// Нужен ли узлу JS-путь (см. drawWorldNodeClipped/Inner). Текст рисует C,
// но тень/контур/шейдер ему не нужны: в JS у текста своя ветка без них.
static bool needs_js(JSContext *ctx, JSValueConst node, int rk)
{
    JSValue kind = prop(ctx, node, A.kind);
    const bool plain_kind = JS_IsStrictEqual(ctx, kind, A.str_2d);
    JS_FreeValue(ctx, kind);
    if (!plain_kind) return true;
    if (rk == RK_SPECIAL) return true;
    if (attrs_truthy(ctx, node, A.clip)) return true;
    if (rk == RK_TEXT) return num_prop(ctx, node, A.shake_timer) > 0;
    if (truthy_prop(ctx, node, A.shadow) || truthy_prop(ctx, node, A.outline) ||
        truthy_prop(ctx, node, A.nine_slice)) return true;
    if (num_prop(ctx, node, A.shake_timer) > 0) return true;
    JSValue shader = prop(ctx, node, A.shader_name);
    const bool fx = JS_ToBool(ctx, shader) > 0 && !JS_IsStrictEqual(ctx, shader, A.str_none);
    JS_FreeValue(ctx, shader);
    return fx;
}

// nodeFontFamily(): attrs.font ближайшего узла по цепочке родителей или NULL.
// Вызывающий освобождает строку JS_FreeCString.
static const char *font_family(JSContext *ctx, JSValueConst node)
{
    JSValue cur = JS_DupValue(ctx, node);
    const char *out = NULL;
    for (int guard = 0; JS_IsObject(cur) && guard < 4096; ++guard) {
        JSValue attrs = prop(ctx, cur, A.attrs);
        if (JS_IsObject(attrs)) {
            JSValue family = prop(ctx, attrs, A.font);
            if (JS_ToBool(ctx, family) > 0) out = JS_ToCString(ctx, family);
            JS_FreeValue(ctx, family);
        }
        JS_FreeValue(ctx, attrs);
        if (out) break;
        JSValue parent = prop(ctx, cur, A.parent_node);
        JS_FreeValue(ctx, cur);
        cur = parent;
    }
    JS_FreeValue(ctx, cur);
    return out;
}

// syncTextBounds(): габарит текста по шрифту, пересчёт только при смене
// текста, кегля или семейства (поля _tm_* общие с JS-путём).
static void sync_text_bounds(JSContext *ctx, JSValueConst node, JSValueConst text)
{
    double size = num_prop(ctx, node, A.size);
    if (!isfinite(size)) size = 20;
    const char *family = font_family(ctx, node);
    JSValue family_v = JS_NewString(ctx, family ? family : "");
    JSValue size_v = JS_NewFloat64(ctx, size);
    JSValue c_text = prop(ctx, node, A._tm_text);
    JSValue c_size = prop(ctx, node, A._tm_size);
    JSValue c_family = prop(ctx, node, A._tm_family);
    const bool same = JS_IsStrictEqual(ctx, c_text, text) && JS_IsStrictEqual(ctx, c_size, size_v) &&
                      JS_IsStrictEqual(ctx, c_family, family_v);
    JS_FreeValue(ctx, c_text);
    JS_FreeValue(ctx, c_size);
    JS_FreeValue(ctx, c_family);
    if (!same) {
        JS_SetProperty(ctx, node, A._tm_text, JS_DupValue(ctx, text));
        JS_SetProperty(ctx, node, A._tm_size, JS_DupValue(ctx, size_v));
        JS_SetProperty(ctx, node, A._tm_family, JS_DupValue(ctx, family_v));
        const char *str = JS_ToCString(ctx, text);
        float w = 0.0f, h = 0.0f;
        if (str) {
            r2d_font_measure(str, (float)size, family ? family : "", &w, &h);
            JS_FreeCString(ctx, str);
        }
        set_num(ctx, node, A.w, (double)w);
        set_num(ctx, node, A.h, (double)h);
    }
    JS_FreeValue(ctx, family_v);
    JS_FreeValue(ctx, size_v);
    if (family) JS_FreeCString(ctx, family);
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
    if (!P || pn < 19 || !xf || !col || !blend || !fx || !clip) {
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
    double drawn = 0, texts = 0;

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

        const int rk = render_kind(ctx, node);
        if (needs_js(ctx, node, rk)) {
            JSValue args[2] = { node, JS_NewInt32(ctx, count) };
            JSValue r = JS_Call(ctx, cb, JS_UNDEFINED, 2, args);
            JS_FreeValue(ctx, node);
            if (JS_IsException(r)) return r;
            JS_ToInt32(ctx, &count, r);
            JS_FreeValue(ctx, r);
            continue;
        }

        // Текст: габарит считается до отсечения (у <text> нет спрайта).
        JSValue text = JS_UNDEFINED;
        if (rk == RK_TEXT) {
            text = prop(ctx, node, A.text);
            if (JS_ToBool(ctx, text) > 0) sync_text_bounds(ctx, node, text);
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
                JS_FreeValue(ctx, text);
                JS_FreeValue(ctx, node);
                continue;
            }
        }
        drawn += 1;

        if (rk == RK_TEXT) {
            // _queueTextScaled(): строка сразу уходит в батч глифов.
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

            int align = R2D_TEXT_ALIGN_LEFT;
            JSValue attrs = prop(ctx, node, A.attrs);
            JSValue align_v = JS_IsObject(attrs) ? prop(ctx, attrs, A.align) : JS_UNDEFINED;
            if (JS_ToBool(ctx, align_v) > 0) {
                const char *a = JS_ToCString(ctx, align_v);
                if (a && SDL_strcmp(a, "center") == 0) align = R2D_TEXT_ALIGN_CENTER;
                else if (a && SDL_strcmp(a, "right") == 0) align = R2D_TEXT_ALIGN_RIGHT;
                if (a) JS_FreeCString(ctx, a);
            }
            JS_FreeValue(ctx, align_v);
            JS_FreeValue(ctx, attrs);

            const char *family = font_family(ctx, node);
            const char *str = JS_ToCString(ctx, text);
            double angle = num_prop(ctx, node, A.angle);
            if (!(angle == angle) || angle == 0) angle = 0;
            const double scale = zsize > 0 ? zsize : 1;
            if (str) {
                r2d_font_draw(str, (float)tx, (float)ty, (float)num_prop(ctx, node, A.size), color,
                              align, family, (float)angle, (float)scale);
                JS_FreeCString(ctx, str);
            } else {
                JS_FreeValue(ctx, JS_GetException(ctx));
            }
            if (family) JS_FreeCString(ctx, family);
            texts += 1;
            JS_FreeValue(ctx, text);
            JS_FreeValue(ctx, node);
            continue;
        }

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
    P[18] = texts;
    return JS_NewInt32(ctx, count);
}


// ---------------------------------------------------------------------------
// Простые твины — tweenProps()/tickTweens() из tween.js
// ---------------------------------------------------------------------------
//
// `.tween({x, alpha}, ms, ease)`, `.moveTo`, `.fadeTo`, `.scaleTo`,
// `.rotateTo`: числа, встроенная плавность, свойство узла. Такой твин целиком
// живёт здесь: состояние, плавность и запись в узел (x/y — вместе с телом, как
// moveToX/moveToY). JS только создаёт его и разрешает Promise по id, когда C
// сообщает о завершении. Свою функцию плавности и запись в attrs ведёт
// прежний JS-путь.

enum {
    TP_X, TP_Y, TP_ALPHA, TP_ANGLE, TP_SCALE, TP_SCALE_X, TP_SCALE_Y, TP_W, TP_H, TP_VALUE,
};

#define R2D_TWEEN_KEYS 8

typedef struct {
    JSValue node;
    double from[R2D_TWEEN_KEYS], to[R2D_TWEEN_KEYS];
    uint8_t prop[R2D_TWEEN_KEYS];
    int keys;
    double ms, t;
    int ease;
    int id;
    bool paused;
} NativeTween;

static NativeTween *tweens;
static int tween_count, tween_cap, tween_next_id = 1;
static JSAtom atom_value;

// EASES из tween.js, один в один (QuickJS считает Math.pow/sin/cos тем же libm).
static double ease_out_bounce(double t)
{
    const double n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }
    if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }
    t -= 2.625 / d1;
    return n1 * t * t + 0.984375;
}

static double ease_eval(int id, double t)
{
    switch (id) {
    case 0: return t;                                                            // linear
    case 1: case 4: return t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2;     // ease, easeInOut
    case 2: case 8: return t * t;                                                // easeIn, easeInQuad
    case 3: case 9: return 1 - (1 - t) * (1 - t);                                // easeOut, easeOutQuad
    case 5: return t * t * t;                                                    // easeInCubic
    case 6: return 1 - pow(1 - t, 3);                                            // easeOutCubic
    case 7: return t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2;         // easeInOutCubic
    case 10: return t * t * t * t;                                               // easeInQuart
    case 11: return 1 - pow(1 - t, 4);                                           // easeOutQuart
    case 12: return 2.70158 * t * t * t - 1.70158 * t * t;                       // easeInBack
    case 13: return 1 + 2.70158 * pow(t - 1, 3) + 1.70158 * pow(t - 1, 2);       // easeOutBack
    case 14:                                                                     // easeInOutBack
        return t < 0.5
            ? (pow(2 * t, 2) * (7.189819 * t - 2.5949095)) / 2
            : (pow(2 * t - 2, 2) * (3.5949095 * (t * 2 - 2) + 2.5949095) + 2) / 2;
    case 15:                                                                     // easeOutElastic
        return t == 0 ? 0 : t == 1 ? 1
            : pow(2, -10 * t) * sin((t * 10 - 0.75) * ((2 * M_PI) / 3)) + 1;
    case 16:                                                                     // easeInElastic
        return t == 0 ? 0 : t == 1 ? 1
            : -pow(2, 10 * t - 10) * sin((t * 10 - 10.75) * ((2 * M_PI) / 3));
    case 17: return ease_out_bounce(t);                                          // easeOutBounce
    case 18: return 1 - ease_out_bounce(1 - t);                                  // easeInBounce
    case 19: return 1 - cos((t * M_PI) / 2);                                     // easeInSine
    case 20: return sin((t * M_PI) / 2);                                         // easeOutSine
    case 21: return t < 1 ? 0 : 1;                                               // step
    default: return t;
    }
}

// Запись свойства — writeProp() из tween.js.
static void tween_write(JSContext *ctx, JSValueConst node, int prop, double v)
{
    switch (prop) {
    case TP_X: case TP_Y: {
        R2DScript *s = (R2DScript *)JS_GetContextOpaque(ctx);
        const double body = num_prop(ctx, node, A.body);
        if (body >= 0 && s && s->physics) {
            // moveToX/moveToY: вторая координата и угол — из трансформов тела.
            const int id = (int)body;
            if (id < R2D_MAX_BODIES) {
                const float *t = s->physics->transforms;
                const float x = prop == TP_X ? (float)v : t[id * 3];
                const float y = prop == TP_Y ? (float)v : t[id * 3 + 1];
                r2d_physics_set_position(s->physics, id, x, y, t[id * 3 + 2]);
            }
        }
        set_num(ctx, node, prop == TP_X ? A.x : A.y, v);
        return;
    }
    case TP_ALPHA: set_num(ctx, node, A.alpha, v); return;
    case TP_ANGLE: set_num(ctx, node, A.angle, v); return;
    case TP_SCALE: set_num(ctx, node, A.scale_x, v); set_num(ctx, node, A.scale_y, v); return;
    case TP_SCALE_X: set_num(ctx, node, A.scale_x, v); return;
    case TP_SCALE_Y: set_num(ctx, node, A.scale_y, v); return;
    case TP_W: set_num(ctx, node, A.w, v); return;
    case TP_H: set_num(ctx, node, A.h, v); return;
    case TP_VALUE: set_num(ctx, node, atom_value, v); return;
    default: return;
    }
}

// engine.nodes.tweenAdd(node, props, from, to, ms, ease) → id.
static JSValue js_tween_add(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 6 || !JS_IsObject(argv[0])) return JS_ThrowTypeError(ctx, "nodes.tweenAdd(node, props, from, to, ms, ease)");
    const uint32_t keys = list_length(ctx, argv[1]);
    if (keys == 0 || keys > R2D_TWEEN_KEYS) return JS_ThrowRangeError(ctx, "nodes.tweenAdd: 1..8 свойств");
    if (tween_count == tween_cap) {
        const int cap = tween_cap ? tween_cap * 2 : 64;
        NativeTween *grown = (NativeTween *)SDL_realloc(tweens, sizeof(NativeTween) * (size_t)cap);
        if (!grown) return JS_ThrowOutOfMemory(ctx);
        tweens = grown;
        tween_cap = cap;
    }
    NativeTween *tw = &tweens[tween_count];
    SDL_zerop(tw);
    for (uint32_t k = 0; k < keys; ++k) {
        JSValue p = JS_GetPropertyUint32(ctx, argv[1], k);
        JSValue a = JS_GetPropertyUint32(ctx, argv[2], k);
        JSValue b = JS_GetPropertyUint32(ctx, argv[3], k);
        int32_t code = 0;
        JS_ToInt32(ctx, &code, p);
        tw->prop[k] = (uint8_t)code;
        tw->from[k] = to_num(ctx, a);
        tw->to[k] = to_num(ctx, b);
        JS_FreeValue(ctx, p);
        JS_FreeValue(ctx, a);
        JS_FreeValue(ctx, b);
    }
    tw->keys = (int)keys;
    tw->ms = to_num(ctx, argv[4]);
    int32_t ease = 0;
    JS_ToInt32(ctx, &ease, argv[5]);
    tw->ease = ease;
    tw->node = JS_DupValue(ctx, argv[0]);
    tw->id = tween_next_id++;
    tween_count++;
    return JS_NewInt32(ctx, tw->id);
}

// engine.nodes.tweenStep(ms) → массив id завершённых (в порядке tickTweens:
// от последнего добавленного к первому) или null, если ничего не кончилось.
static JSValue js_tween_step(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (tween_count == 0 || argc < 1) return JS_NULL;
    const double ms = to_num(ctx, argv[0]);
    JSValue done = JS_NULL;
    uint32_t done_len = 0;
    for (int i = tween_count - 1; i >= 0; --i) {
        NativeTween *tw = &tweens[i];
        if (tw->paused) continue;
        tw->t += ms;
        double p = tw->t / tw->ms;
        if (!(p < 1)) p = p != p ? p : 1;   // Math.min(1, NaN) → NaN, как в JS
        const double e = ease_eval(tw->ease, p);
        for (int k = 0; k < tw->keys; ++k) {
            tween_write(ctx, tw->node, tw->prop[k], tw->from[k] + (tw->to[k] - tw->from[k]) * e);
        }
        if (p >= 1) {
            if (JS_IsNull(done)) done = JS_NewArray(ctx);
            JS_SetPropertyUint32(ctx, done, done_len++, JS_NewInt32(ctx, tw->id));
            JS_FreeValue(ctx, tw->node);
            // Порядок важен (обход с конца): сдвигаем хвост, как splice.
            SDL_memmove(&tweens[i], &tweens[i + 1], sizeof(NativeTween) * (size_t)(tween_count - i - 1));
            tween_count--;
        }
    }
    return done;
}

static bool same_node(JSValueConst a, JSValueConst b)
{
    return JS_IsObject(a) && JS_IsObject(b) && JS_VALUE_GET_PTR(a) == JS_VALUE_GET_PTR(b);
}

// engine.nodes.tweenClear(node) → id снятых твинов узла (с конца, как
// clearNodeTweens) или null.
static JSValue js_tween_clear(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 1 || tween_count == 0) return JS_NULL;
    JSValue out = JS_NULL;
    uint32_t len = 0;
    for (int i = tween_count - 1; i >= 0; --i) {
        if (!same_node(tweens[i].node, argv[0])) continue;
        if (JS_IsNull(out)) out = JS_NewArray(ctx);
        JS_SetPropertyUint32(ctx, out, len++, JS_NewInt32(ctx, tweens[i].id));
        JS_FreeValue(ctx, tweens[i].node);
        SDL_memmove(&tweens[i], &tweens[i + 1], sizeof(NativeTween) * (size_t)(tween_count - i - 1));
        tween_count--;
    }
    return out;
}

// engine.nodes.tweenPause(node | null, paused) — pauseNodeTweens().
static JSValue js_tween_pause(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 2) return JS_UNDEFINED;
    const bool paused = JS_ToBool(ctx, argv[1]) > 0;
    const bool all = !JS_ToBool(ctx, argv[0]);
    for (int i = 0; i < tween_count; ++i) {
        if (all || same_node(tweens[i].node, argv[0])) tweens[i].paused = paused;
    }
    return JS_UNDEFINED;
}

static JSValue js_tween_count(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    return JS_NewInt32(ctx, tween_count);
}

static void tweens_release(JSContext *ctx)
{
    for (int i = 0; i < tween_count; ++i) JS_FreeValue(ctx, tweens[i].node);
    tween_count = 0;
}

// ---------------------------------------------------------------------------
// engine.nodes.tickEffects(nodes, dt) — tickEffects() из tween.js
// ---------------------------------------------------------------------------
//
// Таймеры тряски, вспышки и неуязвимости. Возвращает, у скольких узлов эффект
// ещё жив — по этому счётчику JS-тик выходит на первой строке.

static JSValue js_tick_effects(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 2) return JS_NewInt32(ctx, 0);
    const double dt = to_num(ctx, argv[1]);
    const uint32_t n = list_length(ctx, argv[0]);
    int32_t live = 0;
    for (uint32_t i = 0; i < n; ++i) {
        JSValue node = JS_GetPropertyUint32(ctx, argv[0], i);
        if (!JS_IsObject(node)) { JS_FreeValue(ctx, node); continue; }
        double shake = num_prop(ctx, node, A.shake_timer);
        if (shake > 0) {
            shake -= dt;
            if (shake <= 0) {
                shake = 0;
                set_num(ctx, node, A.shake_amount, 0);
            }
            set_num(ctx, node, A.shake_timer, shake);
        }
        double tint = num_prop(ctx, node, A.tint_timer);
        if (tint > 0) {
            tint -= dt;
            if (tint <= 0) {
                tint = 0;
                JS_SetProperty(ctx, node, A.tint, JS_NULL);
            }
            set_num(ctx, node, A.tint_timer, tint);
        }
        double iframes = num_prop(ctx, node, A.iframes);
        if (iframes > 0) {
            iframes -= dt;
            set_num(ctx, node, A.iframes, iframes);
        }
        if (shake > 0 || tint > 0 || iframes > 0) live++;
        else if (strictly_true(ctx, node, A._fx)) JS_SetProperty(ctx, node, A._fx, JS_FALSE);
        JS_FreeValue(ctx, node);
    }
    return JS_NewInt32(ctx, live);
}

// ---------------------------------------------------------------------------
// Ядра модулей: тайлы и частицы прямо в буферы батча render.js
// ---------------------------------------------------------------------------
//
// Модуль (tilemap.js, particles.js) раньше звал $.gfx.push.sprite на каждый
// тайл и каждую частицу. Здесь та же математика и та же запись в буферы
// xf/col/blend/fx/clip_of, что делает pushSprite() (при выключенном view —
// а в проходе мира он выключен всегда).

typedef struct {
    float *xf;
    uint32_t *col;
    uint8_t *blend;
    int32_t *fx;
    int16_t *clip;
    size_t cap;
} Batch;

// argv[0..4] — xf, col, blend, fx, clip_of; cap — MAX_SPRITES.
static bool batch_bind(JSContext *ctx, JSValueConst *argv, double cap, Batch *b)
{
    size_t xn = 0, cn = 0, bn = 0, fn = 0, kn = 0;
    b->xf = (float *)typed_args(ctx, argv[0], &xn, 4);
    b->col = (uint32_t *)typed_args(ctx, argv[1], &cn, 4);
    b->blend = (uint8_t *)typed_args(ctx, argv[2], &bn, 1);
    b->fx = (int32_t *)typed_args(ctx, argv[3], &fn, 4);
    b->clip = (int16_t *)typed_args(ctx, argv[4], &kn, 2);
    if (!b->xf || !b->col || !b->blend || !b->fx || !b->clip) return false;
    size_t c = cap > 0 ? (size_t)cap : 0;
    if (c > xn / 6) c = xn / 6;
    if (c > cn) c = cn;
    if (c > bn) c = bn;
    if (c > fn) c = fn;
    if (c > kn) c = kn;
    b->cap = c;
    return true;
}

static inline void batch_push(const Batch *b, int32_t *count, double sprite, double x, double y,
                              double w, double h, double angle, uint32_t color, uint8_t blend,
                              int16_t clip)
{
    if ((size_t)*count >= b->cap || !(sprite >= 0)) return;
    const size_t o = (size_t)*count * 6;
    b->xf[o] = (float)sprite;
    b->xf[o + 1] = (float)x;
    b->xf[o + 2] = (float)y;
    b->xf[o + 3] = (float)w;
    b->xf[o + 4] = (float)h;
    b->xf[o + 5] = (float)angle;
    b->col[*count] = color;
    b->blend[*count] = blend;
    b->fx[*count] = 0;
    b->clip[*count] = clip;
    (*count)++;
}

// engine.nodes.drawTiles(data, frames, G, xf, col, blend, fx, clip, count)
// G: [0] x0, [1] y0, [2] x1, [3] y1, [4] ширина слоя в клетках, [5] ox,
// [6] oy, [7] tile_w, [8] tile_h, [9] цвет, [10] режим смешивания,
// [11] текущая обрезка, [12] ёмкость буфера.
static JSValue js_draw_tiles(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 9) return JS_ThrowTypeError(ctx, "nodes.drawTiles: 9 аргументов");
    size_t gn = 0;
    double *G = f64_args(ctx, argv[2], &gn);
    Batch b;
    if (!G || gn < 13 || !batch_bind(ctx, argv + 3, G[12], &b)) {
        return JS_ThrowTypeError(ctx, "nodes.drawTiles: неверные аргументы");
    }
    int32_t count = 0;
    JS_ToInt32(ctx, &count, argv[8]);
    const int x0 = (int)G[0], y0 = (int)G[1], x1 = (int)G[2], y1 = (int)G[3];
    const int64_t lw = (int64_t)G[4];
    const double ox = G[5], oy = G[6], tw = G[7], th = G[8];
    const uint32_t color = (uint32_t)(int64_t)G[9];
    const uint8_t blend = (uint8_t)G[10];
    const int16_t clip = (int16_t)G[11];
    const uint32_t frame_count = list_length(ctx, argv[1]);
    for (int ty = y0; ty <= y1; ++ty) {
        const int64_t row = (int64_t)ty * lw;
        const double sy = oy + (ty + 0.5) * th;
        for (int tx = x0; tx <= x1; ++tx) {
            JSValue idv = JS_GetPropertyInt64(ctx, argv[0], row + tx);
            const double id = to_num(ctx, idv);
            JS_FreeValue(ctx, idv);
            if (id <= 0) continue;                       // 0 и <0 — пусто
            // frames[id - 1]: только целый индекс внутри массива, иначе undefined.
            const double fi = id - 1;
            if (!(fi >= 0) || fi != floor(fi) || fi >= (double)frame_count) continue;
            JSValue sv = JS_GetPropertyUint32(ctx, argv[1], (uint32_t)fi);
            const bool missing = JS_IsUndefined(sv);
            const double sprite = to_num(ctx, sv);
            JS_FreeValue(ctx, sv);
            if (missing || sprite < 0) continue;
            batch_push(&b, &count, sprite, ox + (tx + 0.5) * tw, sy, tw, th, 0, color, blend, clip);
        }
    }
    return JS_NewInt32(ctx, count);
}

// rampAt() из particles.js: ramp — массив {t, v} (отсортирован) с флагом
// .color, либо null.
static inline uint32_t lerp_color(uint32_t a, uint32_t b, double k)
{
    if (a == b) return a;
    const double ch[4][2] = {
        { (double)(a & 0xff), (double)(b & 0xff) },
        { (double)((a >> 8) & 0xff), (double)((b >> 8) & 0xff) },
        { (double)((a >> 16) & 0xff), (double)((b >> 16) & 0xff) },
        { (double)((a >> 24) & 0xff), (double)((b >> 24) & 0xff) },
    };
    uint32_t out = 0;
    for (int i = 0; i < 4; ++i) {
        // Math.round → engine.rgba (ToInt32 и младший байт).
        const double v = floor(ch[i][0] + (ch[i][1] - ch[i][0]) * k + 0.5);
        out |= (uint32_t)(uint8_t)(int32_t)v << (8 * i);
    }
    return out;
}

typedef struct { double t; double v; } RampStop;

typedef struct {
    RampStop stops[16];
    int count;
    bool color;
    bool present;
} Ramp;

static void ramp_read(JSContext *ctx, JSValueConst value, Ramp *r)
{
    r->count = 0;
    r->color = false;
    r->present = JS_IsArray(value);
    if (!r->present) return;
    const uint32_t n = list_length(ctx, value);
    for (uint32_t i = 0; i < n && r->count < (int)SDL_arraysize(r->stops); ++i) {
        JSValue stop = JS_GetPropertyUint32(ctx, value, i);
        r->stops[r->count].t = num_prop(ctx, stop, A.t);
        JSValue v = prop(ctx, stop, A.v);
        r->stops[r->count].v = to_num(ctx, v);
        JS_FreeValue(ctx, v);
        JS_FreeValue(ctx, stop);
        r->count++;
    }
    r->color = truthy_prop(ctx, value, A.color);
}

static double ramp_at(const Ramp *r, double t)
{
    if (!r->present || r->count == 0) return 0;
    const double tt = t < 0 ? 0 : (t > 1 ? 1 : t);
    if (tt <= r->stops[0].t) return r->stops[0].v;
    if (tt >= r->stops[r->count - 1].t) return r->stops[r->count - 1].v;
    for (int i = 1; i < r->count; ++i) {
        if (tt <= r->stops[i].t) {
            const RampStop *a = &r->stops[i - 1], *b = &r->stops[i];
            const double span = b->t - a->t;
            const double k = span > 1e-9 ? (tt - a->t) / span : 0;
            if (r->color) {
                return (double)(int32_t)lerp_color((uint32_t)(int64_t)a->v, (uint32_t)(int64_t)b->v, k);
            }
            return a->v + (b->v - a->v) * k;
        }
    }
    return r->stops[r->count - 1].v;
}

// engine.nodes.drawParticles(parts, rampColor, rampAlpha, rampSize, G,
//                            xf, col, blend, fx, clip, count)
// G: [0] zoom, [1] cam.w, [2] cam.h, [3] cam.x, [4] cam.y, [5] shake_x,
// [6] shake_y, [7] спрайт, [8] alpha узла, [9] локальные координаты,
// [10] node.x, [11] node.y, [12] node.angle, [13] режим смешивания,
// [14] обрезка, [15] ёмкость буфера, [16] предел частиц на эмиттер.
// Ramp-ы не длиннее 16 стопов; длиннее — JS-путь (решает particles.js).
static JSValue js_draw_particles(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 11) return JS_ThrowTypeError(ctx, "nodes.drawParticles: 11 аргументов");
    size_t gn = 0;
    double *G = f64_args(ctx, argv[4], &gn);
    Batch b;
    if (!G || gn < 17 || !batch_bind(ctx, argv + 5, G[15], &b)) {
        return JS_ThrowTypeError(ctx, "nodes.drawParticles: неверные аргументы");
    }
    int32_t count = 0;
    JS_ToInt32(ctx, &count, argv[10]);
    Ramp rc, ra, rs;
    ramp_read(ctx, argv[1], &rc);
    ramp_read(ctx, argv[2], &ra);
    ramp_read(ctx, argv[3], &rs);

    const double zoom = G[0], cw = G[1], ch = G[2], cx = G[3], cy = G[4];
    const double shx = G[5], shy = G[6], sprite = G[7], alpha_base = G[8];
    const bool local = G[9] != 0;
    const double nx = G[10], ny = G[11], nangle = G[12];
    const uint8_t blend = (uint8_t)G[13];
    const int16_t clip = (int16_t)G[14];
    const double max_draw = G[16];
    const double cs = local ? cos(nangle) : 1, sn = local ? sin(nangle) : 0;

    const uint32_t n = list_length(ctx, argv[0]);
    double drawn = 0;
    for (uint32_t i = 0; i < n && drawn < max_draw; ++i) {
        JSValue p = JS_GetPropertyUint32(ctx, argv[0], i);
        const double px = num_prop(ctx, p, A.x), py = num_prop(ctx, p, A.y);
        double wx, wy;
        if (local) {
            wx = nx + px * cs - py * sn;
            wy = ny + px * sn + py * cs;
        } else {
            wx = px;
            wy = py;
        }
        const double sx = (wx - cx) * zoom + cw / 2 + shx;
        const double sy = (wy - cy) * zoom + ch / 2 + shy;
        if (sx < -64 || sx > cw + 64 || sy < -64 || sy > ch + 64) { JS_FreeValue(ctx, p); continue; }

        const double age = num_prop(ctx, p, A.age), life = num_prop(ctx, p, A.life);
        const double ratio = life > 0 ? age / life : 1;
        double world_size;
        if (rs.present) world_size = ramp_at(&rs, ratio);
        else {
            const double size = num_prop(ctx, p, A.size), end = num_prop(ctx, p, A.end_size);
            world_size = size + (end - size) * ratio;
        }
        uint32_t color = (uint32_t)(int64_t)ramp_at(&rc, ratio);
        color = with_alpha(color, ramp_at(&ra, ratio) * alpha_base);
        const double pa = num_prop(ctx, p, A.angle);
        const double angle = local ? pa + nangle : pa;
        // push.sprite: angle || 0.
        batch_push(&b, &count, sprite, sx, sy, world_size * zoom, world_size * zoom,
                   angle == angle && angle != 0 ? angle : 0, color, blend, clip);
        drawn += 1;
        JS_FreeValue(ctx, p);
    }
    return JS_NewInt32(ctx, count);
}

// ---------------------------------------------------------------------------
// UI-проход: drawUINode() из render.js и очередь подписей HUD
// ---------------------------------------------------------------------------
//
// Подписи UI откладываются до конца пакета подложек (иначе подложка
// закрашивала бы текст). Очередь — здесь, в C: в неё пишут и этот проход
// (ui.label), и JS (`_queueText` кнопок, баров, виджетов) — порядок обхода
// сохраняется, а uiTextFlush() рисует всё после submitSprites.

typedef struct {
    char *text;
    char *family;
    float x, y, size, angle;
    uint32_t color;
    int align;
} UIText;

static UIText *ui_texts;
static int ui_text_count, ui_text_cap;

static char *dup_cstr(JSContext *ctx, JSValueConst v)
{
    const char *s = JS_ToCString(ctx, v);
    if (!s) { JS_FreeValue(ctx, JS_GetException(ctx)); return NULL; }
    char *out = SDL_strdup(s);
    JS_FreeCString(ctx, s);
    return out;
}

static int align_of(JSContext *ctx, JSValueConst v)
{
    int align = R2D_TEXT_ALIGN_LEFT;
    if (JS_ToBool(ctx, v) <= 0) return align;
    const char *a = JS_ToCString(ctx, v);
    if (a && SDL_strcmp(a, "center") == 0) align = R2D_TEXT_ALIGN_CENTER;
    else if (a && SDL_strcmp(a, "right") == 0) align = R2D_TEXT_ALIGN_RIGHT;
    if (a) JS_FreeCString(ctx, a);
    else JS_FreeValue(ctx, JS_GetException(ctx));
    return align;
}

static UIText *ui_text_slot(void)
{
    if (ui_text_count == ui_text_cap) {
        const int cap = ui_text_cap ? ui_text_cap * 2 : 256;
        UIText *grown = (UIText *)SDL_realloc(ui_texts, sizeof(UIText) * (size_t)cap);
        if (!grown) return NULL;
        ui_texts = grown;
        ui_text_cap = cap;
    }
    UIText *t = &ui_texts[ui_text_count++];
    SDL_zerop(t);
    return t;
}

static void ui_text_clear(void)
{
    for (int i = 0; i < ui_text_count; ++i) {
        SDL_free(ui_texts[i].text);
        SDL_free(ui_texts[i].family);
    }
    ui_text_count = 0;
}

static JSValue js_ui_text_begin(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(ctx); R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    ui_text_clear();
    return JS_UNDEFINED;
}

// engine.nodes.uiTextPush(text, x, y, size, color, align, family, angle) —
// те же преобразования аргументов, что у engine.drawText.
static JSValue js_ui_text_push(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 1) return JS_UNDEFINED;
    UIText *t = ui_text_slot();
    if (!t) return JS_ThrowOutOfMemory(ctx);
    t->text = dup_cstr(ctx, argv[0]);
    t->x = argc > 1 ? (float)to_num(ctx, argv[1]) : 0.0f;
    t->y = argc > 2 ? (float)to_num(ctx, argv[2]) : 0.0f;
    t->size = argc > 3 ? (float)to_num(ctx, argv[3]) : 18.0f;
    int32_t color = (int32_t)R2D_WHITE;
    if (argc > 4) JS_ToInt32(ctx, &color, argv[4]);
    t->color = (uint32_t)color;
    t->align = argc > 5 ? align_of(ctx, argv[5]) : R2D_TEXT_ALIGN_LEFT;
    t->family = (argc > 6 && !JS_IsUndefined(argv[6]) && !JS_IsNull(argv[6])) ? dup_cstr(ctx, argv[6]) : NULL;
    t->angle = argc > 7 ? (float)to_num(ctx, argv[7]) : 0.0f;
    return JS_UNDEFINED;
}

static JSValue js_ui_text_flush(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    const int n = ui_text_count;
    for (int i = 0; i < n; ++i) {
        const UIText *t = &ui_texts[i];
        if (t->text) r2d_font_draw(t->text, t->x, t->y, t->size, t->color, t->align, t->family, t->angle, 1.0f);
    }
    ui_text_clear();
    return JS_NewInt32(ctx, n);
}

// engine.nodes.uiTags([...]) — UI-теги со своими отрисовщиками.
static JSValue js_ui_tags(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    for (int i = 0; i < A.ui_special_count; ++i) JS_FreeAtom(ctx, A.ui_special[i]);
    A.ui_special_count = 0;
    if (argc >= 1) {
        const uint32_t n = list_length(ctx, argv[0]);
        for (uint32_t i = 0; i < n && A.ui_special_count < (int)SDL_arraysize(A.ui_special); ++i) {
            JSValue v = JS_GetPropertyUint32(ctx, argv[0], i);
            if (JS_IsString(v)) A.ui_special[A.ui_special_count++] = JS_ValueToAtom(ctx, v);
            JS_FreeValue(ctx, v);
        }
    }
    A.ui_version++;
    return JS_UNDEFINED;
}

enum { UK_JS = 0, UK_LABEL = 1, UK_PANEL = 2 };

static int ui_kind(JSContext *ctx, JSValueConst node)
{
    const double uk = num_prop(ctx, node, A._uk);
    if (uk == uk && (int)(uk / 4) == A.ui_version) return (int)uk & 3;
    JSValue tag = prop(ctx, node, A.tag);
    int kind = UK_JS;
    if (JS_IsString(tag)) {
        const JSAtom atom = JS_ValueToAtom(ctx, tag);
        bool custom = false;
        for (int i = 0; i < A.ui_special_count; ++i) if (A.ui_special[i] == atom) { custom = true; break; }
        if (!custom) {
            if (atom == A.tag_ui_label) kind = UK_LABEL;
            else if (atom == A.tag_ui_panel) kind = UK_PANEL;
        }
        JS_FreeAtom(ctx, atom);
    }
    JS_FreeValue(ctx, tag);
    set_num(ctx, node, A._uk, (double)(A.ui_version * 4 + kind));
    return kind;
}

// engine.nodes.drawUI(list, P, xf, col, blend, fx, clip, count, cb)
// P: [0] белый спрайт, [1] режим смешивания по умолчанию, [2] обрезка,
// [3] ёмкость буфера, [4] выход: сколько подписей поставлено в очередь.
static JSValue js_draw_ui(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 9) return JS_ThrowTypeError(ctx, "nodes.drawUI: 9 аргументов");
    size_t pn = 0;
    double *P = f64_args(ctx, argv[1], &pn);
    Batch b;
    if (!P || pn < 5 || !batch_bind(ctx, argv + 2, P[3], &b)) {
        return JS_ThrowTypeError(ctx, "nodes.drawUI: неверные аргументы");
    }
    int32_t count = 0;
    JS_ToInt32(ctx, &count, argv[7]);
    JSValueConst cb = argv[8];
    const double white = P[0];
    const uint8_t default_blend = (uint8_t)P[1];
    const int16_t clip = (int16_t)P[2];
    double texts = 0;

    const uint32_t n = list_length(ctx, argv[0]);
    for (uint32_t i = 0; i < n; ++i) {
        JSValue node = JS_GetPropertyUint32(ctx, argv[0], i);
        if (!JS_IsObject(node)) { JS_FreeValue(ctx, node); continue; }
        // if (!node.visible || node.alpha <= 0) return;
        if (!truthy_prop(ctx, node, A.visible)) { JS_FreeValue(ctx, node); continue; }
        const double alpha = num_prop(ctx, node, A.alpha);
        if (alpha <= 0) { JS_FreeValue(ctx, node); continue; }

        const int kind = ui_kind(ctx, node);
        JSValue color_v = prop(ctx, node, A.color);
        const int ctag = JS_VALUE_GET_NORM_TAG(color_v);
        const bool numeric = ctag == JS_TAG_INT || ctag == JS_TAG_FLOAT64;
        if (kind == UK_JS || !numeric) {
            JS_FreeValue(ctx, color_v);
            JSValue args[2] = { node, JS_NewInt32(ctx, count) };
            JSValue r = JS_Call(ctx, cb, JS_UNDEFINED, 2, args);
            JS_FreeValue(ctx, node);
            if (JS_IsException(r)) return r;
            JS_ToInt32(ctx, &count, r);
            JS_FreeValue(ctx, r);
            continue;
        }
        const uint32_t color = with_alpha(to_u32(ctx, color_v), alpha);
        JS_FreeValue(ctx, color_v);

        if (kind == UK_PANEL) {
            batch_push(&b, &count, white, num_prop(ctx, node, A.x), num_prop(ctx, node, A.y),
                       num_prop(ctx, node, A.w), num_prop(ctx, node, A.h), 0, color, default_blend, clip);
        } else {
            UIText *t = ui_text_slot();
            if (t) {
                JSValue text = prop(ctx, node, A.text);
                t->text = dup_cstr(ctx, text);
                JS_FreeValue(ctx, text);
                t->x = (float)num_prop(ctx, node, A.x);
                t->y = (float)num_prop(ctx, node, A.y);
                t->size = (float)num_prop(ctx, node, A.size);
                t->color = color;
                JSValue attrs = prop(ctx, node, A.attrs);
                JSValue align = JS_IsObject(attrs) ? prop(ctx, attrs, A.align) : JS_UNDEFINED;
                t->align = align_of(ctx, align);
                JS_FreeValue(ctx, align);
                JS_FreeValue(ctx, attrs);
                const char *family = font_family(ctx, node);
                t->family = family ? SDL_strdup(family) : NULL;
                if (family) JS_FreeCString(ctx, family);
                t->angle = 0.0f;
            }
            texts += 1;
        }
        JS_FreeValue(ctx, node);
    }
    P[4] = texts;
    return JS_NewInt32(ctx, count);
}

// ---------------------------------------------------------------------------
// engine.nodes.filterNodes(nodes, mode, tags?) — кандидаты для widgets.js
// ---------------------------------------------------------------------------
//
// Тик виджетов обходил весь реестр, чтобы найти несколько якорных узлов и
// контейнеров. Здесь тот же предикат за один нативный проход; порядок —
// порядок реестра. mode: 0 — isAnchored(), 1 — тег из `tags`,
// 2 — узел, которому нужен applyThemes() без темы по умолчанию (своя тема у
// узла или предка, свой стиль или ещё не сброшенные состояния темы).

static bool is_anchored(JSContext *ctx, JSValueConst node)
{
    JSValue a = prop(ctx, node, A.attrs);
    bool r = false;
    if (JS_IsObject(a)) {
        if (truthy_prop(ctx, a, A._anchor)) r = true;
        const JSAtom keys[8] = { A.anchorLeft, A.anchorTop, A.anchorRight, A.anchorBottom,
                                 A.offsetLeft, A.offsetTop, A.offsetRight, A.offsetBottom };
        for (int i = 0; i < 8 && !r; ++i) {
            JSValue v = prop(ctx, a, keys[i]);
            if (!JS_IsUndefined(v)) r = true;
            JS_FreeValue(ctx, v);
        }
    }
    JS_FreeValue(ctx, a);
    return r;
}

static bool needs_theme(JSContext *ctx, JSValueConst node)
{
    JSValue a = prop(ctx, node, A.attrs);
    bool r = false;
    if (JS_IsObject(a)) {
        if (truthy_prop(ctx, a, A._style)) r = true;
        if (!r) {
            JSValue st = prop(ctx, a, A._styleStates);
            r = !JS_IsUndefined(st) && !JS_IsNull(st);
            JS_FreeValue(ctx, st);
        }
    }
    JS_FreeValue(ctx, a);
    if (r) return true;
    // inheritThemeName(): attrs.themeName у узла или любого предка.
    JSValue cur = JS_DupValue(ctx, node);
    for (int guard = 0; JS_IsObject(cur) && guard < 4096 && !r; ++guard) {
        JSValue attrs = prop(ctx, cur, A.attrs);
        if (JS_IsObject(attrs)) {
            JSValue tn = prop(ctx, attrs, A.themeName);
            if (!JS_IsUndefined(tn)) r = true;
            JS_FreeValue(ctx, tn);
        }
        JS_FreeValue(ctx, attrs);
        JSValue parent = prop(ctx, cur, A.parent_node);
        JS_FreeValue(ctx, cur);
        cur = parent;
    }
    JS_FreeValue(ctx, cur);
    return r;
}

static JSValue js_filter_nodes(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 2) return JS_NewArray(ctx);
    int32_t mode = 0;
    JS_ToInt32(ctx, &mode, argv[1]);
    JSAtom tags[16];
    int tag_count = 0;
    if (mode == 1 && argc >= 3) {
        const uint32_t tn = list_length(ctx, argv[2]);
        for (uint32_t i = 0; i < tn && tag_count < 16; ++i) {
            JSValue v = JS_GetPropertyUint32(ctx, argv[2], i);
            tags[tag_count++] = JS_ValueToAtom(ctx, v);
            JS_FreeValue(ctx, v);
        }
    }
    JSValue out = JS_NewArray(ctx);
    uint32_t len = 0;
    const uint32_t n = list_length(ctx, argv[0]);
    for (uint32_t i = 0; i < n; ++i) {
        JSValue node = JS_GetPropertyUint32(ctx, argv[0], i);
        bool keep = false;
        if (JS_IsObject(node)) {
            if (mode == 0) keep = is_anchored(ctx, node);
            else if (mode == 2) keep = needs_theme(ctx, node);
            else {
                JSValue tag = prop(ctx, node, A.tag);
                if (JS_IsString(tag)) {
                    const JSAtom a = JS_ValueToAtom(ctx, tag);
                    for (int k = 0; k < tag_count; ++k) if (tags[k] == a) { keep = true; break; }
                    JS_FreeAtom(ctx, a);
                }
                JS_FreeValue(ctx, tag);
            }
        }
        if (keep) JS_SetPropertyUint32(ctx, out, len++, node);
        else JS_FreeValue(ctx, node);
    }
    for (int k = 0; k < tag_count; ++k) JS_FreeAtom(ctx, tags[k]);
    return out;
}

// ---------------------------------------------------------------------------
// engine.nodes.memory() — факты о JS-куче (JS_ComputeMemoryUsage)
// ---------------------------------------------------------------------------

static JSValue js_memory(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    JSMemoryUsage u;
    JS_ComputeMemoryUsage(JS_GetRuntime(ctx), &u);
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "bytes", JS_NewFloat64(ctx, (double)u.malloc_size));
    JS_SetPropertyStr(ctx, o, "used", JS_NewFloat64(ctx, (double)u.memory_used_size));
    JS_SetPropertyStr(ctx, o, "objects", JS_NewFloat64(ctx, (double)u.obj_count));
    JS_SetPropertyStr(ctx, o, "arrays", JS_NewFloat64(ctx, (double)u.array_count));
    JS_SetPropertyStr(ctx, o, "strings", JS_NewFloat64(ctx, (double)u.str_count));
    JS_SetPropertyStr(ctx, o, "atoms", JS_NewFloat64(ctx, (double)u.atom_count));
    JS_SetPropertyStr(ctx, o, "shapes", JS_NewFloat64(ctx, (double)u.shape_count));
    JS_SetPropertyStr(ctx, o, "native_tweens", JS_NewInt32(ctx, tween_count));
    return o;
}

// ---------------------------------------------------------------------------
// engine.nodes.buildIndex(nodes) — buildRegistryIndex() из core.js
// ---------------------------------------------------------------------------
//
// Один проход по реестру: все живые узлы, карты «тег → узлы» и
// «класс → узлы» (Map, порядок реестра) и срезы по признакам. Срезы — новые
// массивы на каждую перестройку: обход старого среза не ломается, если узел
// рождается или умирает посреди него. Классы узла C читает из
// `node.class_list` — массива, который ядро ведёт рядом с Set `classes`.

typedef struct { JSAtom atom; JSValue list; uint32_t len; } IndexGroup;

typedef struct {
    IndexGroup *items;
    int count, cap;
    int last;   // одноэлементный кэш: подряд обычно идут узлы одного тега/класса
} IndexGroups;

static IndexGroup *group_of(JSContext *ctx, IndexGroups *g, JSAtom atom)
{
    if (g->last >= 0 && g->items[g->last].atom == atom) return &g->items[g->last];
    for (int i = 0; i < g->count; ++i) {
        if (g->items[i].atom == atom) { g->last = i; return &g->items[i]; }
    }
    if (g->count == g->cap) {
        const int cap = g->cap ? g->cap * 2 : 16;
        IndexGroup *grown = (IndexGroup *)SDL_realloc(g->items, sizeof(IndexGroup) * (size_t)cap);
        if (!grown) return NULL;
        g->items = grown;
        g->cap = cap;
    }
    IndexGroup *it = &g->items[g->count];
    it->atom = JS_DupAtom(ctx, atom);
    it->list = JS_NewArray(ctx);
    it->len = 0;
    g->last = g->count++;
    return it;
}

static inline void push_node(JSContext *ctx, JSValue list, uint32_t *len, JSValueConst node)
{
    JS_SetPropertyUint32(ctx, list, (*len)++, JS_DupValue(ctx, node));
}

// Группы → Map (порядок групп — порядок первого появления, как в JS).
static JSValue groups_to_map(JSContext *ctx, IndexGroups *g, JSValueConst map_ctor)
{
    JSValue map = JS_CallConstructor(ctx, map_ctor, 0, NULL);
    if (JS_IsException(map)) return map;
    JSValue set = JS_GetPropertyStr(ctx, map, "set");
    for (int i = 0; i < g->count; ++i) {
        JSValue args[2] = { JS_AtomToString(ctx, g->items[i].atom), g->items[i].list };
        JSValue r = JS_Call(ctx, set, map, 2, args);
        JS_FreeValue(ctx, r);
        JS_FreeValue(ctx, args[0]);
        JS_FreeValue(ctx, g->items[i].list);
        JS_FreeAtom(ctx, g->items[i].atom);
    }
    JS_FreeValue(ctx, set);
    SDL_free(g->items);
    g->items = NULL;
    g->count = g->cap = 0;
    return map;
}

enum { F_UI, F_TR, F_CONTROLS, F_ANIM, F_CLIP, F_PARALLAX, F_ZONES, F_BODY, F_COUNT };
static const char *const facet_names[F_COUNT] = {
    "ui", "tr", "controls", "anim", "clip", "parallax", "zones", "body",
};

static JSValue js_build_index(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 1) return JS_ThrowTypeError(ctx, "nodes.buildIndex(nodes)");
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue map_ctor = JS_GetPropertyStr(ctx, global, "Map");
    JS_FreeValue(ctx, global);

    const JSAtom atom_trigger_tag = A.trigger;   // и тег, и класс, и attrs.trigger
    JSValue all = JS_NewArray(ctx);
    uint32_t all_len = 0;
    JSValue facets[F_COUNT];
    uint32_t facet_len[F_COUNT];
    for (int f = 0; f < F_COUNT; ++f) { facets[f] = JS_NewArray(ctx); facet_len[f] = 0; }
    IndexGroups tags = { NULL, 0, 0, -1 }, classes = { NULL, 0, 0, -1 };

    const uint32_t n = list_length(ctx, argv[0]);
    for (uint32_t i = 0; i < n; ++i) {
        JSValue node = JS_GetPropertyUint32(ctx, argv[0], i);
        if (!JS_IsObject(node) || truthy_prop(ctx, node, A.removed)) { JS_FreeValue(ctx, node); continue; }
        push_node(ctx, all, &all_len, node);

        JSValue tag = prop(ctx, node, A.tag);
        const JSAtom tag_atom = JS_ValueToAtom(ctx, tag);
        JS_FreeValue(ctx, tag);
        IndexGroup *tg = group_of(ctx, &tags, tag_atom);
        if (tg) push_node(ctx, tg->list, &tg->len, node);
        bool zone = tag_atom == atom_trigger_tag;
        JS_FreeAtom(ctx, tag_atom);

        JSValue cls = prop(ctx, node, A.class_list);
        const uint32_t nc = JS_IsArray(cls) ? list_length(ctx, cls) : 0;
        for (uint32_t c = 0; c < nc; ++c) {
            JSValue name = JS_GetPropertyUint32(ctx, cls, c);
            const JSAtom a = JS_ValueToAtom(ctx, name);
            JS_FreeValue(ctx, name);
            IndexGroup *cg = group_of(ctx, &classes, a);
            if (cg) push_node(ctx, cg->list, &cg->len, node);
            JS_FreeAtom(ctx, a);
        }
        JS_FreeValue(ctx, cls);

        JSValue attrs = prop(ctx, node, A.attrs);
        if (JS_IsObject(attrs)) {
            if (truthy_prop(ctx, attrs, A.ui)) push_node(ctx, facets[F_UI], &facet_len[F_UI], node);
            JSValue tr = prop(ctx, attrs, A.tr);
            if (!JS_IsUndefined(tr)) push_node(ctx, facets[F_TR], &facet_len[F_TR], node);
            JS_FreeValue(ctx, tr);
            if (truthy_prop(ctx, attrs, A.controls)) push_node(ctx, facets[F_CONTROLS], &facet_len[F_CONTROLS], node);
            if (strictly_true(ctx, attrs, A.trigger)) zone = true;
        }
        JS_FreeValue(ctx, attrs);
        if (zone) push_node(ctx, facets[F_ZONES], &facet_len[F_ZONES], node);
        if (truthy_prop(ctx, node, A.anim)) push_node(ctx, facets[F_ANIM], &facet_len[F_ANIM], node);
        if (truthy_prop(ctx, node, A.__clip)) push_node(ctx, facets[F_CLIP], &facet_len[F_CLIP], node);
        if (num_prop(ctx, node, A.body) >= 0) push_node(ctx, facets[F_BODY], &facet_len[F_BODY], node);
        JSValue px = prop(ctx, node, A.parallax_factor);
        if (!JS_IsUndefined(px) && !JS_IsNull(px)) push_node(ctx, facets[F_PARALLAX], &facet_len[F_PARALLAX], node);
        JS_FreeValue(ctx, px);
        JS_FreeValue(ctx, node);
    }

    // Зоны по классу "trigger" (третий случай isZoneNode) — после остальных,
    // как и в JS: тег <trigger> и attrs.trigger === true уже учтены.
    for (int c = 0; c < classes.count; ++c) {
        if (classes.items[c].atom != atom_trigger_tag) continue;
        JSValue list = classes.items[c].list;
        for (uint32_t i = 0; i < classes.items[c].len; ++i) {
            JSValue node = JS_GetPropertyUint32(ctx, list, i);
            JSValue tag = prop(ctx, node, A.tag);
            const JSAtom ta = JS_ValueToAtom(ctx, tag);
            JS_FreeValue(ctx, tag);
            bool skip = ta == atom_trigger_tag;
            JS_FreeAtom(ctx, ta);
            if (!skip) {
                JSValue attrs = prop(ctx, node, A.attrs);
                if (JS_IsObject(attrs) && strictly_true(ctx, attrs, A.trigger)) skip = true;
                JS_FreeValue(ctx, attrs);
            }
            if (!skip) push_node(ctx, facets[F_ZONES], &facet_len[F_ZONES], node);
            JS_FreeValue(ctx, node);
        }
    }

    JSValue out = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, out, "all", all);
    JS_SetPropertyStr(ctx, out, "by_tag", groups_to_map(ctx, &tags, map_ctor));
    JS_SetPropertyStr(ctx, out, "by_class", groups_to_map(ctx, &classes, map_ctor));
    JSValue facet_obj = JS_NewObject(ctx), counts = JS_NewObject(ctx);
    for (int f = 0; f < F_COUNT; ++f) {
        JS_SetPropertyStr(ctx, facet_obj, facet_names[f], facets[f]);
        JS_SetPropertyStr(ctx, counts, facet_names[f], JS_NewInt32(ctx, (int32_t)facet_len[f]));
    }
    JS_SetPropertyStr(ctx, out, "facets", facet_obj);
    JS_SetPropertyStr(ctx, out, "counts", counts);
    JS_FreeValue(ctx, map_ctor);
    return out;
}

// ---------------------------------------------------------------------------
// Установка
// ---------------------------------------------------------------------------

void r2d_nodes_shutdown(JSContext *ctx)
{
    if (!A.ready || !ctx) return;
    tweens_release(ctx);
#define R2D_FREE_ATOM(name) JS_FreeAtom(ctx, A.name);
    R2D_NODE_ATOMS(R2D_FREE_ATOM)
#undef R2D_FREE_ATOM
    for (int i = 0; i < A.special_count; ++i) JS_FreeAtom(ctx, A.special[i]);
    for (int i = 0; i < A.ui_special_count; ++i) JS_FreeAtom(ctx, A.ui_special[i]);
    JS_FreeAtom(ctx, A.tag_ui_label);
    JS_FreeAtom(ctx, A.tag_ui_panel);
    ui_text_clear();
    JS_FreeAtom(ctx, atom_value);
    JS_FreeValue(ctx, A.str_2d);
    JS_FreeValue(ctx, A.str_none);
    for (int i = 0; i < 4; ++i) JS_FreeValue(ctx, A.blend_names[i]);
    SDL_zero(A);
}

int r2d_nodes_install(JSContext *ctx, JSValue engine)
{
    // Атомы прошлого рантайма умерли вместе с ним (r2d_nodes_shutdown) —
    // заводим заново. Твины прошлого рантайма там же и отпущены.
    SDL_zero(A);
    tween_count = 0;
    atom_value = JS_NewAtom(ctx, "value");
#define R2D_MAKE_ATOM(name) A.name = JS_NewAtom(ctx, #name);
    R2D_NODE_ATOMS(R2D_MAKE_ATOM)
#undef R2D_MAKE_ATOM
    A.str_2d = JS_NewString(ctx, "2d");
    A.str_none = JS_NewString(ctx, "none");
    static const char *const blends[4] = { "alpha", "add", "multiply", "none" };
    for (int i = 0; i < 4; ++i) A.blend_names[i] = JS_NewString(ctx, blends[i]);
    A.special_version = 1;
    A.ui_version = 1;
    A.tag_ui_label = JS_NewAtom(ctx, "ui.label");
    A.tag_ui_panel = JS_NewAtom(ctx, "ui.panel");
    ui_text_clear();
    A.ready = true;

    JSValue nodes = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, nodes, "specialTags", JS_NewCFunction(ctx, js_special_tags, "specialTags", 1));
    JS_SetPropertyStr(ctx, nodes, "syncBodies", JS_NewCFunction(ctx, js_sync_bodies, "syncBodies", 1));
    JS_SetPropertyStr(ctx, nodes, "worldEvents", JS_NewCFunction(ctx, js_world_events, "worldEvents", 3));
    JS_SetPropertyStr(ctx, nodes, "hover", JS_NewCFunction(ctx, js_hover, "hover", 3));
    JS_SetPropertyStr(ctx, nodes, "sortWorld", JS_NewCFunction(ctx, js_sort_world, "sortWorld", 2));
    JS_SetPropertyStr(ctx, nodes, "collectWorld", JS_NewCFunction(ctx, js_collect_world, "collectWorld", 2));
    JS_SetPropertyStr(ctx, nodes, "drawWorld", JS_NewCFunction(ctx, js_draw_world, "drawWorld", 9));
    JS_SetPropertyStr(ctx, nodes, "buildIndex", JS_NewCFunction(ctx, js_build_index, "buildIndex", 1));
    JS_SetPropertyStr(ctx, nodes, "tweenAdd", JS_NewCFunction(ctx, js_tween_add, "tweenAdd", 6));
    JS_SetPropertyStr(ctx, nodes, "tweenStep", JS_NewCFunction(ctx, js_tween_step, "tweenStep", 1));
    JS_SetPropertyStr(ctx, nodes, "tweenClear", JS_NewCFunction(ctx, js_tween_clear, "tweenClear", 1));
    JS_SetPropertyStr(ctx, nodes, "tweenPause", JS_NewCFunction(ctx, js_tween_pause, "tweenPause", 2));
    JS_SetPropertyStr(ctx, nodes, "tweenCount", JS_NewCFunction(ctx, js_tween_count, "tweenCount", 0));
    JS_SetPropertyStr(ctx, nodes, "tickEffects", JS_NewCFunction(ctx, js_tick_effects, "tickEffects", 2));
    JS_SetPropertyStr(ctx, nodes, "drawTiles", JS_NewCFunction(ctx, js_draw_tiles, "drawTiles", 9));
    JS_SetPropertyStr(ctx, nodes, "drawUI", JS_NewCFunction(ctx, js_draw_ui, "drawUI", 9));
    JS_SetPropertyStr(ctx, nodes, "filterNodes", JS_NewCFunction(ctx, js_filter_nodes, "filterNodes", 3));
    JS_SetPropertyStr(ctx, nodes, "memory", JS_NewCFunction(ctx, js_memory, "memory", 0));
    JS_SetPropertyStr(ctx, nodes, "uiTags", JS_NewCFunction(ctx, js_ui_tags, "uiTags", 1));
    JS_SetPropertyStr(ctx, nodes, "uiTextBegin", JS_NewCFunction(ctx, js_ui_text_begin, "uiTextBegin", 0));
    JS_SetPropertyStr(ctx, nodes, "uiTextPush", JS_NewCFunction(ctx, js_ui_text_push, "uiTextPush", 8));
    JS_SetPropertyStr(ctx, nodes, "uiTextFlush", JS_NewCFunction(ctx, js_ui_text_flush, "uiTextFlush", 0));
    JS_SetPropertyStr(ctx, nodes, "drawParticles", JS_NewCFunction(ctx, js_draw_particles, "drawParticles", 11));
    JS_SetPropertyStr(ctx, engine, "nodes", nodes);
    return 0;
}
