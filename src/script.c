// ===========================================================================
// Скриптовый слой russiano2d.
//
// C-ядро — «хозяин», JS — «гость» (ТЗ, раздел 3). Все вызовы, которые нужны
// игровой логике, собраны в объекте globalThis.engine. Игровой код пишется
// как ES-модули: точка входа game/main.js может импортировать соседние файлы.
// ===========================================================================

#include "script.h"

#include "profile.h"

#include "icons.h"
#include "js_embed.h"

// Таблица встроенных JS-модулей ($). Определения живут в сгенерированном
// заголовке и должны включаться ровно в одну единицу трансляции.
#include "r2d_js_data.h"
#include "light.h"
#include "module_path.h"
#include "http.h"
#include "net.h"
#include "payload.h"
#include "r2d.h"
#include "text.h"
#include "font.h"

#ifdef R2D_EMBED_SCRIPTS
#include "embed.h"
#endif

#include <SDL3/SDL.h>

#include <math.h>
#include <stdio.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Вспомогательное: аргументы
// ---------------------------------------------------------------------------

static int r2d__arg_int(JSContext *ctx, int argc, JSValueConst *argv, int idx, int def)
{
    if (idx >= argc) return def;
    int32_t v = def;
    if (JS_ToInt32(ctx, &v, argv[idx]) < 0) return def;
    return (int)v;
}

static double r2d__arg_num(JSContext *ctx, int argc, JSValueConst *argv, int idx, double def)
{
    if (idx >= argc) return def;
    double v = def;
    if (JS_ToFloat64(ctx, &v, argv[idx]) < 0) return def;
    return v;
}

static bool r2d__arg_bool(JSContext *ctx, int argc, JSValueConst *argv, int idx, bool def)
{
    if (idx >= argc) return def;
    const int v = JS_ToBool(ctx, argv[idx]);
    return v < 0 ? def : (v != 0);
}

static const char *r2d__arg_str(JSContext *ctx, int argc, JSValueConst *argv, int idx)
{
    if (idx >= argc) return NULL;
    return JS_ToCString(ctx, argv[idx]);
}

// Достаёт число из объекта по имени поля.
static double r2d__obj_num(JSContext *ctx, JSValueConst obj, const char *key, double def)
{
    JSValue v = JS_GetPropertyStr(ctx, obj, key);
    double out = def;
    if (!JS_IsUndefined(v) && !JS_IsNull(v)) {
        JS_ToFloat64(ctx, &out, v);
    }
    JS_FreeValue(ctx, v);
    return out;
}

static bool r2d__obj_bool(JSContext *ctx, JSValueConst obj, const char *key, bool def)
{
    JSValue v = JS_GetPropertyStr(ctx, obj, key);
    bool out = def;
    if (!JS_IsUndefined(v) && !JS_IsNull(v)) {
        const int b = JS_ToBool(ctx, v);
        if (b >= 0) out = (b != 0);
    }
    JS_FreeValue(ctx, v);
    return out;
}

// ---------------------------------------------------------------------------
// Ошибки
// ---------------------------------------------------------------------------

static void r2d__capture_error(R2DScript *s)
{
    JSContext *ctx = s->ctx;

    JSValue exc = JS_GetException(ctx);
    const char *text = JS_ToCString(ctx, exc);

    const char *stack = NULL;
    JSValue stack_val = JS_GetPropertyStr(ctx, exc, "stack");
    if (!JS_IsUndefined(stack_val)) {
        stack = JS_ToCString(ctx, stack_val);
    }

    if (stack && *stack) {
        SDL_snprintf(s->last_error, sizeof s->last_error, "%s\n%s", text ? text : "?", stack);
    } else {
        SDL_snprintf(s->last_error, sizeof s->last_error, "%s", text ? text : "неизвестная ошибка");
    }

    R2D_ERROR("JS: %s", s->last_error);

    if (stack) JS_FreeCString(ctx, stack);
    JS_FreeValue(ctx, stack_val);
    if (text) JS_FreeCString(ctx, text);
    JS_FreeValue(ctx, exc);
}

// Запоминает ошибку в last_error и журнале, НЕ забирая исключение из ctx.
// Нужно там, где исключение бросаем мы сами: r2d__capture_error() его бы
// забрал, и в JS прилетело бы исключение без значения (QuickJS показывал
// «[uninitialized]»), а причина осталась бы только в C-журнале.
static void r2d__note_error(R2DScript *s, const char *text)
{
    SDL_snprintf(s->last_error, sizeof s->last_error, "%s", text ? text : "неизвестная ошибка");
    R2D_ERROR("JS: %s", s->last_error);
}

// ---------------------------------------------------------------------------
// Модули
//
// Имена модулей внутри движка — это пути ОТНОСИТЕЛЬНО каталога игры:
// "main.js", "lib/scene.js", "scenes/platformer.js". Благодаря этому они
// одинаковы в двух режимах:
//   * dev   — файл читается с диска как <game_dir>/<имя>;
//   * релиз — байткод берётся из таблицы r2d_embedded_modules.
//
// Отдельная ветка — встроенные модули движка (префикс "r2d/"): это исходники
// высокоуровневого API $, они всегда компилируются из текста в бинарнике и
// доступны игре в любом режиме сборки, независимо от каталога игры.
// ---------------------------------------------------------------------------

static R2DScript *r2d__script_of(JSContext *ctx)
{
    return (R2DScript *)JS_GetContextOpaque(ctx);
}

static char *r2d__module_normalize(JSContext *ctx, const char *base_name,
                                    const char *name, void *opaque)
{
    R2D_UNUSED(opaque);
    if (!name || !*name) return NULL;

    char norm[4096];
    r2d_module_path(base_name, name, norm, sizeof norm);

    // Короткий алиас: import $ from 'r2d'. Приводим к настоящему пути модуля,
    // иначе относительные импорты внутри него искались бы от корня игры.
    if (SDL_strcmp(norm, "r2d") == 0) return js_strdup(ctx, "r2d/index.js");

    return js_strdup(ctx, norm);
}

// Компилирует исходник встроенного модуля (текст уже в бинарнике).
static JSModuleDef *r2d__load_builtin_source(JSContext *ctx, R2DScript *s,
                                             const char *source, const char *name)
{
    JSValue val = JS_Eval(ctx, source, SDL_strlen(source), name,
                          JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(val)) {
        r2d__capture_error(s);
        return NULL;
    }
    // Владение ссылкой переходит рантайму.
    return (JSModuleDef *)JS_VALUE_GET_PTR(val);
}


#ifdef R2D_EMBED_SCRIPTS

// Релизный режим: исходников на диске нет, берём готовый байткод.
static const R2dEmbeddedModule *r2d__find_embedded(const char *module_name)
{
    for (int i = 0; i < r2d_embedded_module_count; ++i) {
        if (SDL_strcmp(r2d_embedded_modules[i].name, module_name) == 0) {
            return &r2d_embedded_modules[i];
        }
    }
    return NULL;
}

static JSModuleDef *r2d__module_loader(JSContext *ctx, const char *module_name, void *opaque)
{
    R2DScript *s = (R2DScript *)opaque;

    // Высокоуровневое API ($) — всегда из бинарника: у него нет файла в
    // каталоге игры, и он обязан работать в релизной сборке без скриптов.
    const R2dJsModule *builtin = r2d_js_module_find(module_name);
    if (builtin) return r2d__load_builtin_source(ctx, s, builtin->source, module_name);

    const R2dEmbeddedModule *mod = r2d__find_embedded(module_name);
    if (!mod) {
        char msg[512];
        SDL_snprintf(msg, sizeof msg, "модуль '%s' не встроен в бинарник", module_name);
        JS_ThrowReferenceError(ctx, "%s", msg);
        r2d__note_error(s, msg);
        return NULL;
    }

    JSValue val = JS_ReadObject(ctx, mod->data, mod->size, JS_READ_OBJ_BYTECODE);
    if (JS_IsException(val)) {
        r2d__capture_error(s);
        return NULL;
    }
    if (JS_VALUE_GET_TAG(val) != JS_TAG_MODULE) {
        JS_FreeValue(ctx, val);
        char msg[512];
        SDL_snprintf(msg, sizeof msg, "'%s' не является модулем", module_name);
        JS_ThrowInternalError(ctx, "%s", msg);
        r2d__note_error(s, msg);
        return NULL;
    }

    // Владение ссылкой переходит рантайму.
    return (JSModuleDef *)JS_VALUE_GET_PTR(val);
}

#else  // !R2D_EMBED_SCRIPTS

// Обычный режим: читаем .js с диска.
static JSModuleDef *r2d__module_loader(JSContext *ctx, const char *module_name, void *opaque)
{
    R2DScript *s = (R2DScript *)opaque;

    // Высокоуровневое API ($) — из бинарника (см. комментарий выше).
    const R2dJsModule *builtin = r2d_js_module_find(module_name);
    if (builtin) return r2d__load_builtin_source(ctx, s, builtin->source, module_name);

    // Собранная игра: модуль лежит в грузе байткодом — исходников рядом нет.
    const R2dPayloadFile *packed = r2d_payload_find(r2d_payload_active(), module_name);
    if (packed) {
        JSValue val = JS_ReadObject(ctx, packed->data, packed->size, JS_READ_OBJ_BYTECODE);
        if (JS_IsException(val)) {
            r2d__capture_error(s);
            return NULL;
        }
        if (JS_VALUE_GET_TAG(val) != JS_TAG_MODULE) {
            JS_FreeValue(ctx, val);
            char msg[512];
            SDL_snprintf(msg, sizeof msg, "в грузе '%s' не модуль", module_name);
            JS_ThrowInternalError(ctx, "%s", msg);
            r2d__note_error(s, msg);
            return NULL;
        }
        return (JSModuleDef *)JS_VALUE_GET_PTR(val);
    }

    char full_path[4096];
    SDL_snprintf(full_path, sizeof full_path, "%s/%s", s->game_dir, module_name);

    size_t size = 0;
    char *buf = (char *)SDL_LoadFile(full_path, &size);
    if (!buf) {
        char msg[1024];
        SDL_snprintf(msg, sizeof msg, "не удалось прочитать модуль '%s': %s",
                     full_path, SDL_GetError());
        JS_ThrowReferenceError(ctx, "%s", msg);
        r2d__note_error(s, msg);
        return NULL;
    }

    JSValue val = JS_Eval(ctx, buf, size, module_name,
                          JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    SDL_free(buf);

    if (JS_IsException(val)) {
        r2d__capture_error(s);
        return NULL;
    }

    // Владение ссылкой переходит рантайму.
    return (JSModuleDef *)JS_VALUE_GET_PTR(val);
}

#endif  // R2D_EMBED_SCRIPTS

// ---------------------------------------------------------------------------
// Биндинги: базовое
// ---------------------------------------------------------------------------

static JSValue r2d__js_log(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    char line[2048];
    size_t used = 0;
    line[0] = '\0';

    for (int i = 0; i < argc; ++i) {
        const char *part = JS_ToCString(ctx, argv[i]);
        if (part) {
            const int written = SDL_snprintf(line + used, sizeof line - used, "%s%s",
                                             i ? " " : "", part);
            if (written > 0) used += (size_t)written;
            if (used >= sizeof line) used = sizeof line - 1;
            JS_FreeCString(ctx, part);
        }
    }
    R2D_LOG("[js] %s", line);
    return JS_UNDEFINED;
}

// engine.now() — монотонное время в миллисекундах высокого разрешения.
// Нужно профайлеру и любым замерам внутри кадра: engine.time обновляется
// раз в кадр и для этого не годится.
static JSValue r2d__js_now(JSContext *ctx, JSValueConst this_val,
                           int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    static Uint64 freq = 0;
    if (!freq) freq = SDL_GetPerformanceFrequency();
    const double ms = (double)SDL_GetPerformanceCounter() * 1000.0 / (double)freq;
    return JS_NewFloat64(ctx, ms);
}

// engine.profile() — снимок профайлера: время по зонам кадра, среднее и пик.
// engine.setCursor(name) — системная форма курсора.
static JSValue r2d__js_set_cursor(JSContext *ctx, JSValueConst this_val,
                                  int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc >= 1 && !JS_IsUndefined(argv[0]) && !JS_IsNull(argv[0])) {
        const char *name = JS_ToCString(ctx, argv[0]);
        if (name) { r2d_app_cursor_set(name); JS_FreeCString(ctx, name); }
    }
    return JS_NewString(ctx, r2d_app_cursor_name());
}

// engine.cursorVisible(flag) — показать/скрыть курсор.
static JSValue r2d__js_cursor_visible(JSContext *ctx, JSValueConst this_val,
                                      int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    bool visible = SDL_ShowCursor() >= 0;
    if (argc >= 1) {
        visible = JS_ToBool(ctx, argv[0]) != 0;
        r2d_app_cursor_visible(visible);
    }
    return JS_NewBool(ctx, visible);
}

static JSValue r2d__js_profile(JSContext *ctx, JSValueConst this_val,
                               int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "frame_ms", JS_NewFloat64(ctx, r2d_prof_real_ms()));
    JS_SetPropertyStr(ctx, o, "zones_ms", JS_NewFloat64(ctx, r2d_prof_frame_ms()));
    JS_SetPropertyStr(ctx, o, "unaccounted_ms", JS_NewFloat64(ctx, r2d_prof_unaccounted_ms()));
    JS_SetPropertyStr(ctx, o, "frames", JS_NewInt32(ctx, r2d_prof_frames()));
    JS_SetPropertyStr(ctx, o, "enabled", JS_NewBool(ctx, r2d_prof_enabled()));
    // GPU-время кадра: среднее за окно, < 0 — замера нет (см. src/profile.h).
    JS_SetPropertyStr(ctx, o, "gpu_ms", JS_NewFloat64(ctx, r2d_prof_gpu_ms()));
    JS_SetPropertyStr(ctx, o, "gpu_available", JS_NewBool(ctx, r2d_prof_gpu_available()));
    JS_SetPropertyStr(ctx, o, "gpu_frames", JS_NewInt32(ctx, r2d_prof_gpu_frames()));

    // Строки: сначала CPU-зоны, затем GPU. Имена полей прежние (name/ms/peak),
    // добавлены признаки gpu и valid; массив отдаётся и как zones (старое имя),
    // и как rows — чтобы не ломать ни старые, ни новые скрипты.
    R2DProfileRow rows[R2D_PROF_ROW_MAX];
    const int count = r2d_prof_rows(rows, R2D_PROF_ROW_MAX);
    JSValue zones = JS_NewArray(ctx);
    for (int i = 0; i < count; i++) {
        JSValue row = JS_NewObject(ctx);
        JS_SetPropertyStr(ctx, row, "name", JS_NewString(ctx, rows[i].name));
        JS_SetPropertyStr(ctx, row, "ms", JS_NewFloat64(ctx, rows[i].ms));
        JS_SetPropertyStr(ctx, row, "peak", JS_NewFloat64(ctx, rows[i].peak));
        JS_SetPropertyStr(ctx, row, "gpu", JS_NewBool(ctx, rows[i].gpu));
        JS_SetPropertyStr(ctx, row, "valid", JS_NewBool(ctx, rows[i].valid));
        JS_SetPropertyUint32(ctx, zones, (uint32_t)i, row);
    }
    JS_SetPropertyStr(ctx, o, "zones", zones);
    JS_SetPropertyStr(ctx, o, "rows", JS_DupValue(ctx, zones));
    return o;
}

static JSValue r2d__js_profile_reset(JSContext *ctx, JSValueConst this_val,
                                     int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    r2d_prof_reset();
    return JS_UNDEFINED;
}

static JSValue r2d__js_profile_enabled(JSContext *ctx, JSValueConst this_val,
                                       int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc >= 1) r2d_prof_set_enabled(JS_ToBool(ctx, argv[0]) != 0);
    return JS_NewBool(ctx, r2d_prof_enabled());
}

static JSValue r2d__js_rgba(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const int r = r2d__arg_int(ctx, argc, argv, 0, 255);
    const int g = r2d__arg_int(ctx, argc, argv, 1, 255);
    const int b = r2d__arg_int(ctx, argc, argv, 2, 255);
    const int a = r2d__arg_int(ctx, argc, argv, 3, 255);
    return JS_NewInt32(ctx, (int32_t)R2D_RGBA(r, g, b, a));
}

static JSValue r2d__js_quit(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->app) s->app->quit_requested = true;
    return JS_UNDEFINED;
}

// ---------------------------------------------------------------------------
// Биндинги: ввод
// ---------------------------------------------------------------------------

static JSValue r2d__js_key_down(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const int sc = r2d__arg_int(ctx, argc, argv, 0, -1);
    return JS_NewBool(ctx, s && r2d_key_down(s->app, (SDL_Scancode)sc));
}

static JSValue r2d__js_key_pressed(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const int sc = r2d__arg_int(ctx, argc, argv, 0, -1);
    return JS_NewBool(ctx, s && r2d_key_pressed(s->app, (SDL_Scancode)sc));
}

static JSValue r2d__js_key_released(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const int sc = r2d__arg_int(ctx, argc, argv, 0, -1);
    return JS_NewBool(ctx, s && r2d_key_released(s->app, (SDL_Scancode)sc));
}

// engine.scancode("Space") → SDL-код клавиши.
static JSValue r2d__js_scancode(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const char *name = r2d__arg_str(ctx, argc, argv, 0);
    SDL_Scancode sc = SDL_SCANCODE_UNKNOWN;
    if (name) {
        sc = SDL_GetScancodeFromName(name);
        JS_FreeCString(ctx, name);
    }
    return JS_NewInt32(ctx, (int32_t)sc);
}

static JSValue r2d__js_mouse_down(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const int b = r2d__arg_int(ctx, argc, argv, 0, 1);
    return JS_NewBool(ctx, s && r2d_mouse_down(s->app, b));
}

static JSValue r2d__js_mouse_pressed(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const int b = r2d__arg_int(ctx, argc, argv, 0, 1);
    return JS_NewBool(ctx, s && r2d_mouse_pressed(s->app, b));
}

static JSValue r2d__js_pad_down(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const int b = r2d__arg_int(ctx, argc, argv, 0, 0);
    return JS_NewBool(ctx, s && r2d_pad_down(s->app, (SDL_GamepadButton)b));
}

static JSValue r2d__js_pad_axis(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const int a = r2d__arg_int(ctx, argc, argv, 0, 0);
    return JS_NewFloat64(ctx, s ? (double)r2d_pad_axis(s->app, (SDL_GamepadAxis)a) : 0.0);
}

// engine.padConnected() → bool: открыт ли геймпад. Раньше JS угадывал это по
// нажатым кнопкам и осям, и «геймпад подключён, но не тронут» считался
// отсутствующим.
static JSValue r2d__js_pad_connected(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewBool(ctx, s && r2d_pad_connected(s->app));
}

// engine.padRumble(low, high, ms) → bool. Силы 0..1; false — геймпада нет
// или он не умеет вибрировать (SDL_RumbleGamepad вернул ошибку).
static JSValue r2d__js_pad_rumble(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_FALSE;
    const float low = (float)r2d__arg_num(ctx, argc, argv, 0, 0.0);
    const float high = (float)r2d__arg_num(ctx, argc, argv, 1, 0.0);
    const uint32_t ms = (uint32_t)r2d__arg_int(ctx, argc, argv, 2, 200);
    return JS_NewBool(ctx, r2d_pad_rumble(s->app, low, high, ms));
}

// engine.padRumbleTriggers(left, right, ms) → bool: вибрация курков.
static JSValue r2d__js_pad_rumble_triggers(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_FALSE;
    const float left = (float)r2d__arg_num(ctx, argc, argv, 0, 0.0);
    const float right = (float)r2d__arg_num(ctx, argc, argv, 1, 0.0);
    const uint32_t ms = (uint32_t)r2d__arg_int(ctx, argc, argv, 2, 200);
    return JS_NewBool(ctx, r2d_pad_rumble_triggers(s->app, left, right, ms));
}

// ---------------------------------------------------------------------------
// Биндинги: ресурсы и отрисовка
// ---------------------------------------------------------------------------

static JSValue r2d__js_load_texture(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const char *rel = r2d__arg_str(ctx, argc, argv, 0);
    if (!rel || !s || !s->renderer) {
        if (rel) JS_FreeCString(ctx, rel);
        return JS_NewInt32(ctx, -1);
    }

    char full[4096];
    r2d_app_resolve_path(s->app, full, sizeof full, rel);
    JS_FreeCString(ctx, rel);

    return JS_NewInt32(ctx, r2d_texture_load(s->renderer, full));
}

// engine.textureFromPixels(w, h, pixels: Uint8Array|Uint8ClampedArray) → id.
//
// Текстура из готовых пикселей RGBA: нужна процедурному арту ($.proc) — спрайт
// выращивается в памяти и уезжает в GPU без файла. Порядок аргументов —
// (w, h, pixels), потому что размер известен игре заранее.
static JSValue r2d__js_texture_from_pixels(JSContext *ctx, JSValueConst this_val,
                                           int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->renderer) return JS_NewInt32(ctx, -1);
    const int w = r2d__arg_int(ctx, argc, argv, 0, 0);
    const int h = r2d__arg_int(ctx, argc, argv, 1, 0);
    if (w <= 0 || h <= 0) {
        JS_ThrowTypeError(ctx, "textureFromPixels(w, h, pixels)");
        return JS_EXCEPTION;
    }

    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, argc > 2 ? argv[2] : JS_UNDEFINED, &off, &len, &bpe);
    if (JS_IsException(ab)) return JS_EXCEPTION;
    size_t size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, ab);
    if (!base) {
        JS_FreeValue(ctx, ab);
        JS_ThrowTypeError(ctx, "третий аргумент должен быть Uint8Array");
        return JS_EXCEPTION;
    }
    const size_t need = (size_t)w * (size_t)h * 4u;
    if (len < need) {
        JS_FreeValue(ctx, ab);
        JS_ThrowRangeError(ctx, "пикселей меньше, чем w*h*4");
        return JS_EXCEPTION;
    }

    const int id = r2d_texture_create_rgba(s->renderer, base + off, w, h);
    JS_FreeValue(ctx, ab);
    return JS_NewInt32(ctx, id);
}

static JSValue r2d__js_texture_size(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const int id = r2d__arg_int(ctx, argc, argv, 0, -1);

    int w = 0, h = 0;
    if (s && s->renderer) r2d_texture_info(s->renderer, id, &w, &h);

    JSValue arr = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, arr, 0, JS_NewInt32(ctx, w));
    JS_SetPropertyUint32(ctx, arr, 1, JS_NewInt32(ctx, h));
    return arr;
}

static JSValue r2d__js_create_sprite(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->renderer) return JS_NewInt32(ctx, -1);

    const int tex = r2d__arg_int(ctx, argc, argv, 0, -1);
    const double sx = r2d__arg_num(ctx, argc, argv, 1, 0);
    const double sy = r2d__arg_num(ctx, argc, argv, 2, 0);
    double sw = r2d__arg_num(ctx, argc, argv, 3, 0);
    double sh = r2d__arg_num(ctx, argc, argv, 4, 0);

    if (sw <= 0.0 || sh <= 0.0) {
        int tw = 0, th = 0;
        r2d_texture_info(s->renderer, tex, &tw, &th);
        if (sw <= 0.0) sw = (double)tw;
        if (sh <= 0.0) sh = (double)th;
    }

    return JS_NewInt32(ctx, r2d_sprite_create(s->renderer, tex, (float)sx, (float)sy,
                                               (float)sw, (float)sh));
}

static JSValue r2d__js_draw_sprite(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->renderer) return JS_UNDEFINED;

    const int sprite = r2d__arg_int(ctx, argc, argv, 0, -1);
    const double x = r2d__arg_num(ctx, argc, argv, 1, 0);
    const double y = r2d__arg_num(ctx, argc, argv, 2, 0);
    double w = r2d__arg_num(ctx, argc, argv, 3, 0);
    double h = r2d__arg_num(ctx, argc, argv, 4, 0);
    const double angle = r2d__arg_num(ctx, argc, argv, 5, 0);
    const int color = r2d__arg_int(ctx, argc, argv, 6, (int)R2D_WHITE);

    if (w <= 0.0 || h <= 0.0) {
        if (r2d_sprite_alive(s->renderer, sprite)) {
            const R2DSprite *sp = &s->renderer->sprites[sprite];
            if (w <= 0.0) w = sp->width;
            if (h <= 0.0) h = sp->height;
        }
    }

    r2d_batch_add(s->renderer, sprite, (float)x, (float)y, (float)w, (float)h,
                   (float)angle, (uint32_t)color);
    return JS_UNDEFINED;
}

static JSValue r2d__js_draw_rect(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->renderer) return JS_UNDEFINED;

    const double x = r2d__arg_num(ctx, argc, argv, 0, 0);
    const double y = r2d__arg_num(ctx, argc, argv, 1, 0);
    const double w = r2d__arg_num(ctx, argc, argv, 2, 0);
    const double h = r2d__arg_num(ctx, argc, argv, 3, 0);
    const int color = r2d__arg_int(ctx, argc, argv, 4, (int)R2D_WHITE);

    r2d_batch_rect(s->renderer, (float)x, (float)y, (float)w, (float)h, (uint32_t)color);
    return JS_UNDEFINED;
}

// Главный путь отрисовки из ТЗ: один вызов на весь кадр.
static JSValue r2d__js_submit_sprites(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->renderer) return JS_NewInt32(ctx, 0);
    if (argc < 2) {
        JS_ThrowTypeError(ctx, "submitSprites(transforms: Float32Array, colors: Uint32Array, count?)");
        return JS_EXCEPTION;
    }

    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, argv[0], &off, &len, &bpe);
    if (JS_IsException(ab)) return JS_EXCEPTION;

    size_t ab_size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &ab_size, ab);
    if (!base) {
        JS_FreeValue(ctx, ab);
        JS_ThrowTypeError(ctx, "первый аргумент должен быть Float32Array");
        return JS_EXCEPTION;
    }
    const float *transforms = (const float *)(base + off);
    const size_t transform_count = len / sizeof(float);

    const uint32_t *colors = NULL;
    JSValue colors_ab = JS_UNDEFINED;
    size_t colors_len = 0;
    if (argc >= 2 && !JS_IsUndefined(argv[1]) && !JS_IsNull(argv[1])) {
        size_t coff = 0, clen = 0, cbpe = 0;
        colors_ab = JS_GetTypedArrayBuffer(ctx, argv[1], &coff, &clen, &cbpe);
        if (!JS_IsException(colors_ab)) {
            size_t csize = 0;
            uint8_t *cbase = JS_GetArrayBuffer(ctx, &csize, colors_ab);
            if (cbase) {
                colors = (const uint32_t *)(cbase + coff);
                colors_len = clen / sizeof(uint32_t);
            }
        } else {
            JS_FreeValue(ctx, colors_ab);
            colors_ab = JS_UNDEFINED;
        }
    }

    int count = (int)(transform_count / 6);
    if (argc >= 3) {
        const int requested = r2d__arg_int(ctx, argc, argv, 2, count);
        if (requested >= 0 && requested < count) count = requested;
    }
    if (colors && colors_len < (size_t)count) {
        // Цветов меньше, чем спрайтов — остальным достаётся белый.
        count = (int)colors_len;
    }

    const int drawn = r2d_batch_submit(s->renderer, transforms, colors, count);

    if (!JS_IsUndefined(colors_ab)) JS_FreeValue(ctx, colors_ab);
    JS_FreeValue(ctx, ab);
    return JS_NewInt32(ctx, drawn);
}

static JSValue r2d__js_set_clear_color(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->renderer) {
        s->renderer->clear_r = (float)r2d__arg_num(ctx, argc, argv, 0, 0.09);
        s->renderer->clear_g = (float)r2d__arg_num(ctx, argc, argv, 1, 0.10);
        s->renderer->clear_b = (float)r2d__arg_num(ctx, argc, argv, 2, 0.13);
        s->renderer->clear_a = (float)r2d__arg_num(ctx, argc, argv, 3, 1.0);
    }
    return JS_UNDEFINED;
}

// ---------------------------------------------------------------------------
// Биндинги: физика
// ---------------------------------------------------------------------------

static JSValue r2d__js_create_body(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics || argc < 1) return JS_NewInt32(ctx, -1);
    // opts разбирается через JS_GetPropertyStr: для null/undefined это бросает
    // TypeError, а хелперы исключение игнорировали — биндинг возвращал «успех»
    // с висящим в контексте исключением. Проверяем тип сами.
    if (!JS_IsObject(argv[0])) {
        return JS_ThrowTypeError(ctx, "engine.createBody: нужен объект параметров тела");
    }

    JSValueConst opts = argv[0];
    R2DBodyDesc d;
    SDL_zero(d);
    d.x = (float)r2d__obj_num(ctx, opts, "x", 0);
    d.y = (float)r2d__obj_num(ctx, opts, "y", 0);
    d.angle = (float)r2d__obj_num(ctx, opts, "angle", 0);
    d.half_w = (float)r2d__obj_num(ctx, opts, "halfW", 16);
    d.half_h = (float)r2d__obj_num(ctx, opts, "halfH", 16);
    d.type = (int)r2d__obj_num(ctx, opts, "type", R2D_BODY_STATIC);
    d.density = (float)r2d__obj_num(ctx, opts, "density", 1.0);
    d.friction = (float)r2d__obj_num(ctx, opts, "friction", 0.3);
    d.restitution = (float)r2d__obj_num(ctx, opts, "restitution", 0.0);
    d.fixed_rotation = r2d__obj_bool(ctx, opts, "fixedRotation", false);
    // CCD: быстрое тело проверяется непрерывно (пули не проскакивают стены).
    d.bullet = r2d__obj_bool(ctx, opts, "bullet", false);
    d.radius = (float)r2d__obj_num(ctx, opts, "radius", 0);
    d.poly_radius = (float)r2d__obj_num(ctx, opts, "polyRadius", 0);
    d.one_way = r2d__obj_bool(ctx, opts, "oneWay", false);
    d.one_way_angle = (float)r2d__obj_num(ctx, opts, "oneWayAngle", -1.57079633);
    d.sensor = r2d__obj_bool(ctx, opts, "sensor", false);
    d.contacts = r2d__obj_bool(ctx, opts, "contacts", false);

    // Слои и маски коллизий. Опции необязательные: если их нет вовсе, тело
    // встаёт в слой 1 и сталкивается со всеми (filter_set остаётся false).
    // Проверяем именно наличие ключа: mask = 0 — законное значение «не
    // сталкиваться ни с кем», и подменять его умолчанием нельзя.
    {
        JSValueConst keys[3] = { JS_UNDEFINED, JS_UNDEFINED, JS_UNDEFINED };
        const char *names[3] = { "layerBits", "mask", "group" };
        bool present[3] = { false, false, false };
        for (int i = 0; i < 3; ++i) {
            keys[i] = JS_GetPropertyStr(ctx, opts, names[i]);
            present[i] = !JS_IsUndefined(keys[i]) && !JS_IsNull(keys[i]);
        }
        if (present[0] || present[1] || present[2]) {
            d.filter_set = true;
            d.category_bits = present[0] ? (uint64_t)r2d__obj_num(ctx, opts, "layerBits", 1.0)
                                         : R2D_FILTER_DEFAULT_CATEGORY;
            d.mask_bits = present[1] ? (uint64_t)r2d__obj_num(ctx, opts, "mask", 0.0)
                                     : R2D_FILTER_DEFAULT_MASK;
            d.group_index = present[2] ? (int)r2d__obj_num(ctx, opts, "group", 0.0) : 0;
        }
        for (int i = 0; i < 3; ++i) JS_FreeValue(ctx, keys[i]);
    }

    // Форма задаётся строкой: читаемо в игровом коде и не требует констант.
    JSValue shape = JS_GetPropertyStr(ctx, opts, "shape");
    if (JS_IsString(shape)) {
        const char *kind = JS_ToCString(ctx, shape);
        if (kind) {
            if (SDL_strcmp(kind, "circle") == 0)       d.shape = R2D_SHAPE_CIRCLE;
            else if (SDL_strcmp(kind, "capsule") == 0) d.shape = R2D_SHAPE_CAPSULE;
            else if (SDL_strcmp(kind, "polygon") == 0) d.shape = R2D_SHAPE_POLYGON;
            JS_FreeCString(ctx, kind);
        }
    }
    JS_FreeValue(ctx, shape);

    // Полигон: плоский массив [x0,y0,x1,y1,…] в локальных пикселях.
    if (d.shape == R2D_SHAPE_POLYGON) {
        JSValue pts = JS_GetPropertyStr(ctx, opts, "points");
        if (JS_IsArray(pts)) {
            JSValue lenv = JS_GetPropertyStr(ctx, pts, "length");
            uint32_t len = 0;
            JS_ToUint32(ctx, &len, lenv);
            JS_FreeValue(ctx, lenv);
            const uint32_t cap = (uint32_t)R2D_MAX_POLY_POINTS * 2;
            if (len > cap) len = cap;
            for (uint32_t i = 0; i < len; ++i) {
                JSValue v = JS_GetPropertyUint32(ctx, pts, i);
                double n = 0.0;
                JS_ToFloat64(ctx, &n, v);
                JS_FreeValue(ctx, v);
                d.points[i] = (float)n;
            }
            d.point_count = (int)(len / 2);
        }
        JS_FreeValue(ctx, pts);
    }

    return JS_NewInt32(ctx, r2d_physics_create(s->physics, &d));
}

// engine.contacts() — события контакта за прошедший шаг: begin/end/hit с
// нормалью, точкой и скоростью сближения. Копится в C на каждом шаге.
// Когда событий нет (обычный кадр), отдаём JS_NULL: пустой массив — это
// аллокация и работа сборщика каждый кадр ни за что (см.
// docs/HIGH_LEVEL_API_PERF.md §3.3). JS-сторона проверяет на пустоту:
// dispatchContacts() выходит по !list, $.world.contacts() приводит null к [].
static JSValue r2d__js_contacts(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics) return JS_NULL;

    int n = 0;
    const R2DContactEvent *ev = r2d_physics_contacts(s->physics, &n);
    if (n == 0) return JS_NULL;

    JSValue arr = JS_NewArray(ctx);
    for (int i = 0; i < n; ++i) {
        JSValue o = JS_NewObject(ctx);
        const char *kind = ev[i].kind == R2D_CONTACT_BEGIN ? "begin"
                         : (ev[i].kind == R2D_CONTACT_END ? "end" : "hit");
        JS_SetPropertyStr(ctx, o, "kind", JS_NewString(ctx, kind));
        JS_SetPropertyStr(ctx, o, "a", JS_NewInt32(ctx, ev[i].a));
        JS_SetPropertyStr(ctx, o, "b", JS_NewInt32(ctx, ev[i].b));
        JS_SetPropertyStr(ctx, o, "nx", JS_NewFloat64(ctx, ev[i].nx));
        JS_SetPropertyStr(ctx, o, "ny", JS_NewFloat64(ctx, ev[i].ny));
        JS_SetPropertyStr(ctx, o, "x", JS_NewFloat64(ctx, ev[i].px));
        JS_SetPropertyStr(ctx, o, "y", JS_NewFloat64(ctx, ev[i].py));
        JS_SetPropertyStr(ctx, o, "speed", JS_NewFloat64(ctx, ev[i].speed));
        JS_SetPropertyUint32(ctx, arr, (uint32_t)i, o);
    }
    return arr;
}

// engine.setBodyEnabled(body, on) — включить/выключить тело: выключенное не
// сталкивается и не попадает в запросы, но остаётся живым. Так пул объектов
// переиспользует тело вместо destroyBody+createBody на каждый spawn.
static JSValue r2d__js_set_body_enabled(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->physics) {
        r2d_physics_set_enabled(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1),
                                r2d__arg_bool(ctx, argc, argv, 1, true));
    }
    return JS_UNDEFINED;
}

// engine.setBodyFilter(body, layerBits, mask, group) — слои и маски коллизий
// уже созданного тела. Возвращает false, если тела нет.
static JSValue r2d__js_set_body_filter(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics) return JS_FALSE;
    const int id = r2d__arg_int(ctx, argc, argv, 0, -1);
    const uint64_t category = (uint64_t)r2d__arg_num(ctx, argc, argv, 1, 1.0);
    const uint64_t mask = (uint64_t)r2d__arg_num(ctx, argc, argv, 2, -1.0);
    const int group = r2d__arg_int(ctx, argc, argv, 3, 0);
    return JS_NewBool(ctx, r2d_physics_set_filter(s->physics, id, category, mask, group));
}

// engine.getBodyFilter(body) → { layerBits, mask, group } или null.
static JSValue r2d__js_get_body_filter(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics) return JS_NULL;

    uint64_t category = 0, mask = 0;
    int group = 0;
    if (!r2d_physics_get_filter(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1),
                                &category, &mask, &group)) {
        return JS_NULL;
    }
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "layerBits", JS_NewFloat64(ctx, (double)category));
    JS_SetPropertyStr(ctx, obj, "mask", JS_NewFloat64(ctx, (double)mask));
    JS_SetPropertyStr(ctx, obj, "group", JS_NewInt32(ctx, group));
    return obj;
}

// engine.createJoint({ type, a, b, ax, ay, bx, by, ... }) — сустав между телами.
static JSValue r2d__js_create_joint(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics || argc < 1) return JS_NewInt32(ctx, -1);
    if (!JS_IsObject(argv[0])) {
        return JS_ThrowTypeError(ctx, "engine.createJoint: нужен объект параметров сустава");
    }

    JSValueConst opts = argv[0];
    int type = R2D_JOINT_REVOLUTE;
    JSValue tv = JS_GetPropertyStr(ctx, opts, "type");
    if (JS_IsString(tv)) {
        const char *kind = JS_ToCString(ctx, tv);
        if (kind) {
            if (SDL_strcmp(kind, "distance") == 0)       type = R2D_JOINT_DISTANCE;
            else if (SDL_strcmp(kind, "weld") == 0)      type = R2D_JOINT_WELD;
            else if (SDL_strcmp(kind, "prismatic") == 0) type = R2D_JOINT_PRISMATIC;
            else if (SDL_strcmp(kind, "wheel") == 0)     type = R2D_JOINT_WHEEL;
            else if (SDL_strcmp(kind, "revolute") == 0)  type = R2D_JOINT_REVOLUTE;
            else if (SDL_strcmp(kind, "filter") == 0)    type = R2D_JOINT_FILTER;
            else R2D_WARN("engine.createJoint: неизвестный тип \"%s\" — беру revolute", kind);
            JS_FreeCString(ctx, kind);
        }
    }
    JS_FreeValue(ctx, tv);

    // Ось сустава — для prismatic и wheel (по умолчанию вдоль X).
    {
        JSValue av = JS_GetPropertyStr(ctx, opts, "axis");
        if (JS_IsObject(av)) {
            const double ax = r2d__obj_num(ctx, av, "0", 1.0);
            const double ay = r2d__obj_num(ctx, av, "1", 0.0);
            r2d_physics_set_joint_axis(s->physics, (float)ax, (float)ay);
        } else {
            r2d_physics_set_joint_axis(s->physics, 1.0f, 0.0f);
        }
        JS_FreeValue(ctx, av);
    }

    const int id = r2d_physics_create_joint(
        s->physics, type,
        (int)r2d__obj_num(ctx, opts, "a", -1),
        (int)r2d__obj_num(ctx, opts, "b", -1),
        (float)r2d__obj_num(ctx, opts, "ax", 0), (float)r2d__obj_num(ctx, opts, "ay", 0),
        (float)r2d__obj_num(ctx, opts, "bx", 0), (float)r2d__obj_num(ctx, opts, "by", 0),
        r2d__obj_bool(ctx, opts, "collide", false),
        (float)r2d__obj_num(ctx, opts, "length", 0),
        r2d__obj_bool(ctx, opts, "limit", false),
        (float)r2d__obj_num(ctx, opts, "lower", 0),
        (float)r2d__obj_num(ctx, opts, "upper", 0),
        r2d__obj_bool(ctx, opts, "motor", false),
        (float)r2d__obj_num(ctx, opts, "motorSpeed", 0),
        (float)r2d__obj_num(ctx, opts, "maxTorque", 0));
    return JS_NewInt32(ctx, id);
}

static JSValue r2d__js_destroy_joint(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->physics) r2d_physics_destroy_joint(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1));
    return JS_UNDEFINED;
}

static JSValue r2d__js_joint_alive(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewBool(ctx, s && s->physics &&
                              r2d_physics_joint_alive(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1)));
}

static JSValue r2d__js_joint_count(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewInt32(ctx, (s && s->physics) ? r2d_physics_joint_count(s->physics) : 0);
}

static JSValue r2d__js_destroy_body(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->physics) r2d_physics_destroy(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1));
    return JS_UNDEFINED;
}

static JSValue r2d__js_body_alive(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewBool(ctx, s && s->physics &&
                              r2d_physics_is_alive(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1)));
}

// engine.bodyEnabled(body) — включено ли тело (см. engine.setBodyEnabled).
static JSValue r2d__js_body_enabled(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewBool(ctx, s && s->physics &&
                              r2d_physics_is_enabled(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1)));
}

// Zero-copy: Float32Array смотрит прямо в массив трансформов в C.
static JSValue r2d__js_get_transforms(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics || !s->transforms_valid) return JS_NULL;
    return JS_DupValue(ctx, s->transforms_array);
}

static JSValue r2d__js_set_velocity(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->physics) {
        r2d_physics_set_velocity(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1),
                                  (float)r2d__arg_num(ctx, argc, argv, 1, 0),
                                  (float)r2d__arg_num(ctx, argc, argv, 2, 0));
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_get_velocity(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    float vx = 0, vy = 0;
    if (s && s->physics) {
        r2d_physics_get_velocity(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1), &vx, &vy);
    }
    JSValue arr = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, arr, 0, JS_NewFloat64(ctx, vx));
    JS_SetPropertyUint32(ctx, arr, 1, JS_NewFloat64(ctx, vy));
    return arr;
}

static JSValue r2d__js_set_angular_velocity(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->physics) {
        r2d_physics_set_angular_velocity(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1),
                                          (float)r2d__arg_num(ctx, argc, argv, 1, 0));
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_get_angular_velocity(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const float w = (s && s->physics)
                        ? r2d_physics_get_angular_velocity(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1))
                        : 0.0f;
    return JS_NewFloat64(ctx, w);
}

static JSValue r2d__js_set_position(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->physics) {
        r2d_physics_set_position(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1),
                                  (float)r2d__arg_num(ctx, argc, argv, 1, 0),
                                  (float)r2d__arg_num(ctx, argc, argv, 2, 0),
                                  (float)r2d__arg_num(ctx, argc, argv, 3, 0));
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_apply_impulse(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->physics) {
        r2d_physics_apply_impulse(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1),
                                   (float)r2d__arg_num(ctx, argc, argv, 1, 0),
                                   (float)r2d__arg_num(ctx, argc, argv, 2, 0));
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_set_gravity(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->physics) {
        r2d_physics_set_gravity(s->physics,
                                 (float)r2d__arg_num(ctx, argc, argv, 0, 0),
                                 (float)r2d__arg_num(ctx, argc, argv, 1, -9.81));
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_get_gravity(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    float gx = 0, gy = 0;
    if (s && s->physics) r2d_physics_get_gravity(s->physics, &gx, &gy);
    JSValue arr = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, arr, 0, JS_NewFloat64(ctx, gx));
    JS_SetPropertyUint32(ctx, arr, 1, JS_NewFloat64(ctx, gy));
    return arr;
}

static JSValue r2d__js_set_awake(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->physics) {
        r2d_physics_set_awake(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1),
                               r2d__arg_bool(ctx, argc, argv, 1, true));
    }
    return JS_UNDEFINED;
}

// engine.limits() → занятость таблиц движка и их потолки.
//
// Зачем: половина лимитов не была видна игре вообще, а поведение при
// достижении разное — где-то возвращается -1, где-то бросается исключение,
// где-то событие молча теряется. Теперь игре есть что показать в отладочном
// оверлее и по чему принять решение.
static JSValue r2d__js_limits(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    JSValue o = JS_NewObject(ctx);

    const int textures = (s && s->renderer) ? r2d_texture_live_count(s->renderer) : 0;
    const int sprites = (s && s->renderer) ? s->renderer->sprite_count : 0;
    const int bodies = (s && s->physics) ? r2d_physics_live_count(s->physics) : 0;
    const int joints = (s && s->physics) ? r2d_physics_joint_count(s->physics) : 0;
    const int shaders = (s && s->renderer) ? r2d_render_user_shader_count(s->renderer) : 0;

    JS_SetPropertyStr(ctx, o, "textures", JS_NewInt32(ctx, textures));
    JS_SetPropertyStr(ctx, o, "textures_max", JS_NewInt32(ctx, R2D_MAX_TEXTURES));
    JS_SetPropertyStr(ctx, o, "sprites", JS_NewInt32(ctx, sprites));
    JS_SetPropertyStr(ctx, o, "bodies", JS_NewInt32(ctx, bodies));
    JS_SetPropertyStr(ctx, o, "bodies_max", JS_NewInt32(ctx, R2D_MAX_BODIES));
    JS_SetPropertyStr(ctx, o, "joints", JS_NewInt32(ctx, joints));
    JS_SetPropertyStr(ctx, o, "joints_max", JS_NewInt32(ctx, 64));
    JS_SetPropertyStr(ctx, o, "user_shaders", JS_NewInt32(ctx, shaders));
    JS_SetPropertyStr(ctx, o, "user_shaders_max", JS_NewInt32(ctx, R2D_MAX_USER_SHADERS));
    JS_SetPropertyStr(ctx, o, "node_fx_max", JS_NewInt32(ctx, R2D_MAX_NODE_FX));
    JS_SetPropertyStr(ctx, o, "viewports_max", JS_NewInt32(ctx, R2D_MAX_VIEWPORTS));
    JS_SetPropertyStr(ctx, o, "query_max", JS_NewInt32(ctx, R2D_MAX_QUERY));
    JS_SetPropertyStr(ctx, o, "contact_events_max", JS_NewInt32(ctx, R2D_MAX_CONTACT_EVENTS));
    JS_SetPropertyStr(ctx, o, "text_queue_max", JS_NewInt32(ctx, 2048));
    JS_SetPropertyStr(ctx, o, "ui_callbacks_max", JS_NewInt32(ctx, 256));
    JS_SetPropertyStr(ctx, o, "documents_max", JS_NewInt32(ctx, 64));
    return o;
}

// engine.submitMesh(vertices: Float32Array, count?) → число вершин.
//
// Меш псевдо-3D: 8 float на вершину — x, y (мировые пиксели экрана), z
// (глубина 0..1, ближе — меньше), u, v, r, g, b (цвет 0..1). Треугольники
// собираются своим батчем и рисуются ПЕРВЫМИ в проходе сцены: меш записывает
// глубину, и спрайты проверяются по ней — поэтому плоский спрайт не рисуется
// поверх выпуклости персонажа.
static JSValue r2d__js_submit_mesh(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->renderer) return JS_NewInt32(ctx, 0);
    if (argc < 1) {
        JS_ThrowTypeError(ctx, "submitMesh(vertices: Float32Array, count?)");
        return JS_EXCEPTION;
    }

    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, argv[0], &off, &len, &bpe);
    if (JS_IsException(ab)) return JS_EXCEPTION;
    size_t size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, ab);
    if (!base) {
        JS_FreeValue(ctx, ab);
        JS_ThrowTypeError(ctx, "первый аргумент должен быть Float32Array");
        return JS_EXCEPTION;
    }

    const int available = (int)(len / sizeof(float) / 8);
    int count = argc >= 2 ? r2d__arg_int(ctx, argc, argv, 1, available) : available;
    if (count > available) count = available;
    if (count < 0) count = 0;
    count -= count % 3;   // неполный треугольник рисовать нечем

    if (count > 0) {
        r2d_batch_mesh(s->renderer, (const float *)(base + off), count);
    }
    JS_FreeValue(ctx, ab);
    return JS_NewInt32(ctx, count);
}

// --- Сеть (транспорт SDL3_net) ---------------------------------------------
//
// Движок даёт только сокеты: поднять сервер, подключиться, отправить и принять
// датаграмму. Владение узлами, снапшоты и дельту считает $.net (src/highlevel/
// net.js) — транспорт от модели не зависит.

// engine.netHost(port) → bool — слушать порт (сервер авторитет).
static JSValue r2d__js_net_host(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const int port = r2d__arg_int(ctx, argc, argv, 0, 0);
    return JS_NewBool(ctx, r2d_net_listen(port));
}

// engine.netJoin(host, port) → bool — подключиться (клиент).
static JSValue r2d__js_net_join(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const char *host = argc > 0 ? JS_ToCString(ctx, argv[0]) : NULL;
    const int port = r2d__arg_int(ctx, argc, argv, 1, 0);
    const bool ok = r2d_net_connect(host ? host : "", port);
    if (host) JS_FreeCString(ctx, host);
    return JS_NewBool(ctx, ok);
}

// engine.netClose() → undefined; engine.netMode() → 0|1|2.
static JSValue r2d__js_net_close(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    r2d_net_close();
    return JS_UNDEFINED;
}

static JSValue r2d__js_net_mode(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    return JS_NewInt32(ctx, r2d_net_mode());
}

// engine.netStatus() → { available, mode, connected, error, address, port,
//                        sent, received, packetsSent, packetsReceived }
static JSValue r2d__js_net_status(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "available",  JS_NewBool(ctx, r2d_net_available()));
    JS_SetPropertyStr(ctx, obj, "mode",       JS_NewInt32(ctx, r2d_net_mode()));
    JS_SetPropertyStr(ctx, obj, "connected",  JS_NewBool(ctx, r2d_net_connected()));
    JS_SetPropertyStr(ctx, obj, "error",      JS_NewString(ctx, r2d_net_error()));
    JS_SetPropertyStr(ctx, obj, "address",    JS_NewString(ctx, r2d_net_local_address()));
    JS_SetPropertyStr(ctx, obj, "port",       JS_NewInt32(ctx, r2d_net_local_port()));
    JS_SetPropertyStr(ctx, obj, "sent",       JS_NewFloat64(ctx, (double)r2d_net_bytes_sent()));
    JS_SetPropertyStr(ctx, obj, "received",   JS_NewFloat64(ctx, (double)r2d_net_bytes_received()));
    JS_SetPropertyStr(ctx, obj, "packetsSent", JS_NewFloat64(ctx, (double)r2d_net_packets_sent()));
    JS_SetPropertyStr(ctx, obj, "packetsReceived", JS_NewFloat64(ctx, (double)r2d_net_packets_received()));
    return obj;
}

// engine.netSend(data: Uint8Array, to?: string, toPort?: number) → bool
//
// Отправка бинарная: снапшот сериализует $.net, транспорт возит байты.
static JSValue r2d__js_net_send(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 1) {
        JS_ThrowTypeError(ctx, "netSend(data: Uint8Array, to?, toPort?)");
        return JS_EXCEPTION;
    }
    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, argv[0], &off, &len, &bpe);
    if (JS_IsException(ab)) return JS_EXCEPTION;
    size_t size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, ab);
    if (!base) {
        JS_FreeValue(ctx, ab);
        JS_ThrowTypeError(ctx, "первый аргумент должен быть Uint8Array");
        return JS_EXCEPTION;
    }
    const char *to = argc > 1 && !JS_IsUndefined(argv[1]) && !JS_IsNull(argv[1])
        ? JS_ToCString(ctx, argv[1]) : NULL;
    const int to_port = r2d__arg_int(ctx, argc, argv, 2, 0);

    const bool ok = len > 0
        ? r2d_net_send(to, to_port, base + off, (int)len)
        : false;
    if (to) JS_FreeCString(ctx, to);
    JS_FreeValue(ctx, ab);
    return JS_NewBool(ctx, ok);
}

// Освободитель памяти пакета для JS_NewUint8Array: массив забирает владение
// буфером, и освобождать его должна та же куча, что выделила.
static void r2d__net_free_packet(JSRuntime *rt, void *opaque, void *ptr)
{
    R2D_UNUSED(rt); R2D_UNUSED(opaque);
    SDL_free(ptr);
}

// engine.netPoll() → [{ from, fromPort, data: Uint8Array }, …]
//
// Забираем все пакеты разом: игра сама решает, сколько обрабатывать за кадр.
static JSValue r2d__js_net_poll(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DNetPacket packets[32];
    SDL_zero(packets);
    const int count = r2d_net_poll(packets, 32);
    JSValue out = JS_NewArray(ctx);
    for (int i = 0; i < count; ++i) {
        JSValue item = JS_NewObject(ctx);
        JS_SetPropertyStr(ctx, item, "from",     JS_NewString(ctx, packets[i].from));
        JS_SetPropertyStr(ctx, item, "fromPort", JS_NewInt32(ctx, packets[i].from_port));
        // Отдаём Uint8Array, а не ArrayBuffer: игра читает .length и режет
        // срез, а у ArrayBuffer этого нет — в игре data приходил undefined.
        // Память пакета передаём массиву вместе с освободителем: лишней копии
        // нет, а r2d_net_free_packets её уже не трогает.
        const size_t bytes = (size_t)(packets[i].size > 0 ? packets[i].size : 0);
        JSValue buf = JS_NewUint8Array(ctx, packets[i].data, bytes,
                                       r2d__net_free_packet, NULL, false);
        packets[i].data = NULL;
        JS_SetPropertyStr(ctx, item, "data", buf);
        JS_SetPropertyUint32(ctx, out, (uint32_t)i, item);
    }
    r2d_net_free_packets(packets, count);
    return out;
}

// engine.netSimulate(lossPercent, delayMs?, seed?) — воспроизводимые потери.
static JSValue r2d__js_net_simulate(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const int loss = r2d__arg_int(ctx, argc, argv, 0, 0);
    const int delay = r2d__arg_int(ctx, argc, argv, 1, 0);
    const int seed = r2d__arg_int(ctx, argc, argv, 2, 1);
    r2d_net_simulate(loss, delay, seed);
    return JS_UNDEFINED;
}

// engine.setDepth(bool) → bool — тест глубины (z-буфер).
//
// Включён по умолчанию. Спрайты пишут z = 0, поэтому порядок отрисовки между
// ними сохраняется, а меш персонажа может закрывать собой спрайты. Выключение
// возвращает прежнее поведение и освобождает текстуру глубины — это нужно
// интерфейсу и пост-обработке, где порядок и так задан.
static JSValue r2d__js_set_depth(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->renderer) return JS_NewBool(ctx, false);
    const bool on = r2d__arg_bool(ctx, argc, argv, 0, true);
    r2d_render_set_depth(s->renderer, on);
    return JS_NewBool(ctx, r2d_render_depth(s->renderer));
}

// engine.depthInfo() → { enabled, meshCmds, meshVerts } — состояние z-буфера.
//
// Нужен не только игре, но и проверкам: конвейер меша может молча не
// создаться (например, из-за пересечения атрибутов), и без чисел это
// выглядит как «меш не рисуется».
static JSValue r2d__js_depth_info(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    JSValue obj = JS_NewObject(ctx);
    if (!s || !s->renderer) return obj;
    R2DRenderer *r = s->renderer;
    JS_SetPropertyStr(ctx, obj, "enabled",    JS_NewBool(ctx, r2d_render_depth(r)));
    JS_SetPropertyStr(ctx, obj, "texture",    JS_NewBool(ctx, r->depth_texture != NULL));
    JS_SetPropertyStr(ctx, obj, "pipeline",   JS_NewBool(ctx, r->mesh_pipelines[0] != NULL));
    JS_SetPropertyStr(ctx, obj, "meshCmds",   JS_NewInt32(ctx, r->stat_mesh_cmds));
    JS_SetPropertyStr(ctx, obj, "meshVerts",  JS_NewInt32(ctx, r->mesh_vertex_upload));
    JS_SetPropertyStr(ctx, obj, "pending",    JS_NewInt32(ctx, r->mesh_vertex_count));
    JS_SetPropertyStr(ctx, obj, "frames",     JS_NewInt32(ctx, r->stat_frames));
    JS_SetPropertyStr(ctx, obj, "meshFrames", JS_NewInt32(ctx, r->stat_mesh_frames));
    JS_SetPropertyStr(ctx, obj, "meshDraws",  JS_NewInt32(ctx, r->stat_mesh_draws));
    JS_SetPropertyStr(ctx, obj, "meshBatches",JS_NewInt32(ctx, r->mesh_batch_count));
    JS_SetPropertyStr(ctx, obj, "meshBuf",    JS_NewBool(ctx, r->mesh_buffer != NULL));
    JS_SetPropertyStr(ctx, obj, "meshDrawn",  JS_NewInt32(ctx, r->stat_mesh_draws));
    JS_SetPropertyStr(ctx, obj, "meshBuilt",  JS_NewInt32(ctx, r->stat_mesh_built));
    JS_SetPropertyStr(ctx, obj, "uploads",    JS_NewInt32(ctx, r->stat_mesh_uploads));
    JS_SetPropertyStr(ctx, obj, "blocked",    JS_NewInt32(ctx, r->stat_mesh_blocked));
    JS_SetPropertyStr(ctx, obj, "peak",        JS_NewInt32(ctx, r->stat_mesh_peak));
    JS_SetPropertyStr(ctx, obj, "revision",   JS_NewInt32(ctx, r->revision));
    return obj;
}

// engine.depth() → bool — включён ли тест глубины.
static JSValue r2d__js_get_depth(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewBool(ctx, s && s->renderer && r2d_render_depth(s->renderer));
}

// engine.setSpriteFilter(bool) → bool — фильтрация спрайтов.
//
// false (по умолчанию) — nearest: пиксель-арт без размытия. true — линейная:
// сглаженный масштаб для текста, крупных спрайтов и сильного зума. Режим
// глобальный, потому что сэмплер один на проход; смена режима разрывает
// участок отрисовки.
static JSValue r2d__js_set_sprite_filter(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->renderer) return JS_NewBool(ctx, false);
    const bool linear = r2d__arg_bool(ctx, argc, argv, 0, false);
    r2d_render_set_filter(s->renderer, linear);
    return JS_NewBool(ctx, r2d_render_filter(s->renderer));
}

// engine.spriteFilter() → bool — текущий режим фильтрации.
static JSValue r2d__js_get_sprite_filter(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->renderer) return JS_NewBool(ctx, false);
    return JS_NewBool(ctx, r2d_render_filter(s->renderer));
}

// engine.requestReload(reason?) — попросить перезапуск скриптов.
// Перезапуск случится НА ГРАНИЦЕ КАДРА (см. src/main.c), а не сейчас.
static JSValue r2d__js_request_reload(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s) return JS_FALSE;
    const char *reason = r2d__arg_str(ctx, argc, argv, 0);
    r2d_script_request_reload(s, reason ? reason : "запрос игры");
    if (reason) JS_FreeCString(ctx, reason);
    return JS_TRUE;
}

// engine.reloadPending() → bool — ждёт ли перезапуска.
static JSValue r2d__js_reload_pending(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewBool(ctx, s && s->reload_requested);
}

// engine.hotReload() → bool — следит ли движок за изменениями файлов.
static JSValue r2d__js_hot_reload(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewBool(ctx, r2d_script_hot_reload_enabled(s));
}

// engine.freeTexture(id) → bool — выгрузить текстуру и вернуть слот.
//
// Раньше выгрузки не было вовсе: картинка, ставшая ненужной, занимала слот до
// конца процесса, а лимит — 256 текстур. Теперь игре есть чем освободить
// память, и слот переиспользуется следующим loadTexture.
static JSValue r2d__js_free_texture(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->renderer) return JS_NewBool(ctx, false);
    const int id = r2d__arg_int(ctx, argc, argv, 0, -1);
    return JS_NewBool(ctx, r2d_texture_free(s->renderer, id));
}

// engine.isAwake(id) → bool — спит ли тело (Box2D усыпляет неподвижные).
// Нужен игре, чтобы не будить тела зря и не считать логику спящих.
static JSValue r2d__js_is_awake(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics) return JS_NewBool(ctx, false);
    return JS_NewBool(ctx, r2d_physics_is_awake(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1)));
}

// --- Геймпады по слотам и касания -----------------------------------------
//
// Слот 0 — «первый геймпад»: старые engine.padDown/padAxis остаются рабочими.
// Мультигеймпад нужен локальной игре вдвоём-вчетвером, касания — тач-экранам:
// SDL отдаёт пальцы отдельно от мыши, и подменять их мышью нельзя (мультитач
// так не сделать).

static int r2d__arg_pad_slot(JSContext *ctx, int argc, JSValueConst *argv, int index)
{
    return r2d__arg_int(ctx, argc, argv, index, 0);
}

static JSValue r2d__js_pad_count(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_NewInt32(ctx, 0);
    return JS_NewInt32(ctx, r2d_app_pad_count(s->app));
}

static JSValue r2d__js_pad_slots(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    return JS_NewInt32(ctx, r2d_pad_slot_count());
}

static JSValue r2d__js_pad_connected_at(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_NewBool(ctx, false);
    return JS_NewBool(ctx, r2d_app_pad_connected_at(s->app, r2d__arg_pad_slot(ctx, argc, argv, 0)));
}

static JSValue r2d__js_pad_down_at(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_NewBool(ctx, false);
    return JS_NewBool(ctx, r2d_pad_down_at(s->app, r2d__arg_pad_slot(ctx, argc, argv, 0),
                                           r2d__arg_int(ctx, argc, argv, 1, -1)));
}

static JSValue r2d__js_pad_pressed_at(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_NewBool(ctx, false);
    return JS_NewBool(ctx, r2d_pad_pressed_at(s->app, r2d__arg_pad_slot(ctx, argc, argv, 0),
                                              r2d__arg_int(ctx, argc, argv, 1, -1)));
}

static JSValue r2d__js_pad_axis_at(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_NewFloat64(ctx, 0);
    return JS_NewFloat64(ctx, r2d_pad_axis_at(s->app, r2d__arg_pad_slot(ctx, argc, argv, 0),
                                              r2d__arg_int(ctx, argc, argv, 1, -1)));
}

static JSValue r2d__js_pad_rumble_at(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_NewBool(ctx, false);
    return JS_NewBool(ctx, r2d_pad_rumble_at(s->app, r2d__arg_pad_slot(ctx, argc, argv, 0),
                                             (float)r2d__arg_num(ctx, argc, argv, 1, 0),
                                             (float)r2d__arg_num(ctx, argc, argv, 2, 0),
                                             (uint32_t)r2d__arg_num(ctx, argc, argv, 3, 200)));
}

static JSValue r2d__js_touch_count(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_NewInt32(ctx, 0);
    return JS_NewInt32(ctx, r2d_app_touch_count(s->app));
}

static JSValue r2d__js_touch(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_NULL;
    float x = 0, y = 0;
    if (!r2d_app_touch(s->app, r2d__arg_int(ctx, argc, argv, 0, 0), &x, &y)) return JS_NULL;
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "x", JS_NewFloat64(ctx, x));
    JS_SetPropertyStr(ctx, o, "y", JS_NewFloat64(ctx, y));
    return o;
}

static JSValue r2d__js_touch_delta(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_NULL;
    float dx = 0, dy = 0;
    if (!r2d_app_touch_delta(s->app, r2d__arg_int(ctx, argc, argv, 0, 0), &dx, &dy)) return JS_NULL;
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "x", JS_NewFloat64(ctx, dx));
    JS_SetPropertyStr(ctx, o, "y", JS_NewFloat64(ctx, dy));
    return o;
}

static JSValue r2d__js_touch_pressure(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_NewFloat64(ctx, 0);
    return JS_NewFloat64(ctx, r2d_app_touch_pressure(s->app, r2d__arg_int(ctx, argc, argv, 0, 0)));
}

static JSValue r2d__js_touch_down(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_NewBool(ctx, false);
    float x = 0, y = 0;
    return JS_NewBool(ctx, r2d_app_touch(s->app, r2d__arg_int(ctx, argc, argv, 0, 0), &x, &y));
}

// engine.setSleeping(body, sleeping) / engine.isSleeping(body).
//
// Выключить сон нужно там, где игра двигает тело НАПРЯМУЮ скоростью:
// проснувшееся тело Box2D усыпит снова на накопленном покое, и setVelocity
// перестанет действовать (нашлось при отладке перетаскивания).
static JSValue r2d__js_set_sleeping(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics) return JS_UNDEFINED;
    r2d_physics_set_sleeping(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1),
                             r2d__arg_bool(ctx, argc, argv, 1, true));
    return JS_UNDEFINED;
}

static JSValue r2d__js_is_sleeping(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics) return JS_NewBool(ctx, true);
    return JS_NewBool(ctx, r2d_physics_is_sleeping_enabled(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1)));
}

// engine.setBullet(id, on) / engine.isBullet(id) — CCD для тела.
//
// Быстрое тело (пуля) проверяется непрерывно: за шаг 1/60 при 1200 px/с оно
// проходит около 20 px и без CCD проскакивает тонкие стены и врагов.
static JSValue r2d__js_set_bullet(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics) return JS_UNDEFINED;
    const bool on = r2d__arg_bool(ctx, argc, argv, 1, true);
    r2d_physics_set_bullet(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1), on);
    return JS_UNDEFINED;
}

static JSValue r2d__js_is_bullet(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics) return JS_NewBool(ctx, false);
    return JS_NewBool(ctx, r2d_physics_is_bullet(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1)));
}

// engine.setGravityScale(id, scale) — множитель гравитации для тела.
static JSValue r2d__js_set_gravity_scale(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics) return JS_UNDEFINED;
    r2d_physics_set_gravity_scale(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1),
                                  (float)r2d__arg_num(ctx, argc, argv, 1, 1.0));
    return JS_UNDEFINED;
}

static JSValue r2d__js_body_mass(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const float m = (s && s->physics)
                        ? r2d_physics_get_mass(s->physics, r2d__arg_int(ctx, argc, argv, 0, -1))
                        : 0.0f;
    return JS_NewFloat64(ctx, m);
}

static JSValue r2d__js_body_count(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewInt32(ctx, (s && s->physics) ? r2d_physics_live_count(s->physics) : 0);
}

// ---------------------------------------------------------------------------
// Биндинги: игровой GUI (RmlUi)
// ---------------------------------------------------------------------------

static JSValue r2d__js_ui_load(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const char *path = r2d__arg_str(ctx, argc, argv, 0);
    int id = -1;
    if (s && s->gui && path) id = r2d_gui_load_document(s->gui, path);
    if (path) JS_FreeCString(ctx, path);
    return JS_NewInt32(ctx, id);
}

static JSValue r2d__js_ui_show(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->gui) r2d_gui_show(s->gui, r2d__arg_int(ctx, argc, argv, 0, -1));
    return JS_UNDEFINED;
}

static JSValue r2d__js_ui_hide(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->gui) r2d_gui_hide(s->gui, r2d__arg_int(ctx, argc, argv, 0, -1));
    return JS_UNDEFINED;
}

static JSValue r2d__js_ui_unload(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->gui) r2d_gui_unload(s->gui, r2d__arg_int(ctx, argc, argv, 0, -1));
    return JS_UNDEFINED;
}

static JSValue r2d__js_ui_visible(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const bool vis = (s && s->gui) && r2d_gui_document_visible(s->gui, r2d__arg_int(ctx, argc, argv, 0, -1));
    return JS_NewBool(ctx, vis);
}

static JSValue r2d__js_ui_set_text(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const int doc = r2d__arg_int(ctx, argc, argv, 0, -1);
    const char *element = r2d__arg_str(ctx, argc, argv, 1);
    const char *text = r2d__arg_str(ctx, argc, argv, 2);
    if (s && s->gui && element && text) r2d_gui_set_text(s->gui, doc, element, text);
    if (element) JS_FreeCString(ctx, element);
    if (text) JS_FreeCString(ctx, text);
    return JS_UNDEFINED;
}

static JSValue r2d__js_ui_set_html(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const int doc = r2d__arg_int(ctx, argc, argv, 0, -1);
    const char *element = r2d__arg_str(ctx, argc, argv, 1);
    const char *html = r2d__arg_str(ctx, argc, argv, 2);
    if (s && s->gui && element && html) r2d_gui_set_html(s->gui, doc, element, html);
    if (element) JS_FreeCString(ctx, element);
    if (html) JS_FreeCString(ctx, html);
    return JS_UNDEFINED;
}

static JSValue r2d__js_ui_set_class(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const int doc = r2d__arg_int(ctx, argc, argv, 0, -1);
    const char *element = r2d__arg_str(ctx, argc, argv, 1);
    const char *cls = r2d__arg_str(ctx, argc, argv, 2);
    const bool add = r2d__arg_bool(ctx, argc, argv, 3, true);
    if (s && s->gui && element && cls) r2d_gui_set_class(s->gui, doc, element, cls, add);
    if (element) JS_FreeCString(ctx, element);
    if (cls) JS_FreeCString(ctx, cls);
    return JS_UNDEFINED;
}

static JSValue r2d__js_ui_set_property(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const int doc = r2d__arg_int(ctx, argc, argv, 0, -1);
    const char *element = r2d__arg_str(ctx, argc, argv, 1);
    const char *prop = r2d__arg_str(ctx, argc, argv, 2);
    const char *value = r2d__arg_str(ctx, argc, argv, 3);
    if (s && s->gui && element && prop && value) {
        r2d_gui_set_property(s->gui, doc, element, prop, value);
    }
    if (element) JS_FreeCString(ctx, element);
    if (prop) JS_FreeCString(ctx, prop);
    if (value) JS_FreeCString(ctx, value);
    return JS_UNDEFINED;
}

static JSValue r2d__js_ui_on(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->gui) return JS_NewInt32(ctx, -1);
    if (argc < 4 || !JS_IsFunction(ctx, argv[3])) {
        JS_ThrowTypeError(ctx, "ui.on(doc, elementId, event, callback) — нужна функция");
        return JS_EXCEPTION;
    }
    if (s->callback_count >= (int)(sizeof s->callbacks / sizeof s->callbacks[0])) {
        JS_ThrowInternalError(ctx, "слишком много обработчиков UI (лимит %d)",
                              (int)(sizeof s->callbacks / sizeof s->callbacks[0]));
        return JS_EXCEPTION;
    }

    const int doc = r2d__arg_int(ctx, argc, argv, 0, -1);
    const char *element = r2d__arg_str(ctx, argc, argv, 1);
    const char *event = r2d__arg_str(ctx, argc, argv, 2);

    // Слот НЕ занимаем заранее: раньше id = callback_count++ брался до проверки
    // ok, и неудачная подписка выжигала слот вместе с JS-функцией. На 256-й
    // такой подписке движок падал с InternalError, хотя обработчиков было
    // меньше лимита. Теперь слот освобождается, если слушателя не поставили.
    const int slot = s->callback_count;
    JSValue fn = JS_DupValue(ctx, argv[3]);
    const bool ok = element && event && r2d_gui_add_listener(s->gui, doc, element, event, slot);
    if (ok) {
        s->callbacks[slot] = fn;
        s->callback_count++;
    } else {
        JS_FreeValue(ctx, fn);
    }

    if (element) JS_FreeCString(ctx, element);
    if (event) JS_FreeCString(ctx, event);

    return JS_NewInt32(ctx, ok ? slot : -1);
}

// Мост RmlUi → JS: вызывается из gui.cpp при срабатывании слушателя.
static void r2d__gui_dispatch(void *user, int callback_id, const char *element_id,
                               const char *event_name)
{
    R2DScript *s = (R2DScript *)user;
    if (!s || !s->ctx) return;
    if (callback_id < 0 || callback_id >= s->callback_count) return;

    JSContext *ctx = s->ctx;
    JSValue fn = s->callbacks[callback_id];
    if (!JS_IsFunction(ctx, fn)) return;

    JSValue args[2];
    args[0] = JS_NewString(ctx, element_id ? element_id : "");
    args[1] = JS_NewString(ctx, event_name ? event_name : "");

    JSValue ret = JS_Call(ctx, fn, JS_UNDEFINED, 2, args);
    if (JS_IsException(ret)) {
        r2d__capture_error(s);
    }
    JS_FreeValue(ctx, ret);
    JS_FreeValue(ctx, args[0]);
    JS_FreeValue(ctx, args[1]);
}

// ---------------------------------------------------------------------------
// Биндинги: звук и музыка
// ---------------------------------------------------------------------------

static JSValue r2d__js_audio_load(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const char *rel = r2d__arg_str(ctx, argc, argv, 0);
    if (!rel || !s || !s->audio) {
        if (rel) JS_FreeCString(ctx, rel);
        return JS_NewInt32(ctx, -1);
    }

    char full[4096];
    r2d_app_resolve_path(s->app, full, sizeof full, rel);
    JS_FreeCString(ctx, rel);

    return JS_NewInt32(ctx, r2d_audio_load(s->audio, full));
}

// audio.play(id, volume?, pan?, loop?) -> номер канала или -1
static JSValue r2d__js_audio_play(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->audio) return JS_NewInt32(ctx, -1);

    const int id = r2d__arg_int(ctx, argc, argv, 0, -1);
    const double volume = r2d__arg_num(ctx, argc, argv, 1, 1.0);
    const double pan = r2d__arg_num(ctx, argc, argv, 2, 0.0);
    const bool loop = r2d__arg_bool(ctx, argc, argv, 3, false);

    return JS_NewInt32(ctx, r2d_audio_play(s->audio, id,
                                            (float)volume, (float)pan, loop ? -1 : 0));
}

static JSValue r2d__js_audio_stop(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->audio) {
        r2d_audio_stop_channel(s->audio, r2d__arg_int(ctx, argc, argv, 0, -1),
                                (float)r2d__arg_num(ctx, argc, argv, 1, 0));
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_audio_stop_all(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->audio) r2d_audio_stop_all(s->audio, (float)r2d__arg_num(ctx, argc, argv, 0, 0));
    return JS_UNDEFINED;
}

static JSValue r2d__js_audio_playing(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const bool playing = (s && s->audio) &&
                         r2d_audio_channel_playing(s->audio, r2d__arg_int(ctx, argc, argv, 0, -1));
    return JS_NewBool(ctx, playing);
}

static JSValue r2d__js_audio_active(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewInt32(ctx, (s && s->audio) ? r2d_audio_active_channels(s->audio) : 0);
}

// audio.music(id, loop?, volume?, fadeMs?)
static JSValue r2d__js_audio_music(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->audio) {
        r2d_audio_play_music(s->audio, r2d__arg_int(ctx, argc, argv, 0, -1),
                              (float)r2d__arg_num(ctx, argc, argv, 2, 1.0),
                              r2d__arg_bool(ctx, argc, argv, 1, true),
                              (float)r2d__arg_num(ctx, argc, argv, 3, 0));
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_audio_stop_music(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->audio) r2d_audio_stop_music(s->audio, (float)r2d__arg_num(ctx, argc, argv, 0, 0));
    return JS_UNDEFINED;
}

static JSValue r2d__js_audio_pause_music(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->audio) r2d_audio_pause_music(s->audio, r2d__arg_bool(ctx, argc, argv, 0, true));
    return JS_UNDEFINED;
}

static JSValue r2d__js_audio_music_playing(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewBool(ctx, (s && s->audio) && r2d_audio_music_playing(s->audio));
}

static JSValue r2d__js_audio_set_master(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->audio) r2d_audio_set_master_volume(s->audio, (float)r2d__arg_num(ctx, argc, argv, 0, 1));
    return JS_UNDEFINED;
}

static JSValue r2d__js_audio_get_master(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewFloat64(ctx, (s && s->audio) ? r2d_audio_get_master_volume(s->audio) : 0.0);
}

static JSValue r2d__js_audio_set_sfx(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->audio) r2d_audio_set_sfx_volume(s->audio, (float)r2d__arg_num(ctx, argc, argv, 0, 1));
    return JS_UNDEFINED;
}

static JSValue r2d__js_audio_set_music_vol(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->audio) r2d_audio_set_music_volume(s->audio, (float)r2d__arg_num(ctx, argc, argv, 0, 0.7));
    return JS_UNDEFINED;
}

static JSValue r2d__js_audio_duration(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const double d = (s && s->audio)
                         ? r2d_audio_duration(s->audio, r2d__arg_int(ctx, argc, argv, 0, -1))
                         : -1.0;
    return JS_NewFloat64(ctx, d);
}

static JSValue r2d__js_audio_count(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewInt32(ctx, (s && s->audio) ? s->audio->sound_count : 0);
}

// --- Каналы: громкость, панорама, эффекты -----------------------------------
// Нужны высокоуровневым шинам ($.audio.bus): громкость шины должна менять
// уже играющие звуки, а не только следующие.

static JSValue r2d__js_audio_set_channel_volume(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->audio) {
        r2d_audio_set_channel_volume(s->audio, r2d__arg_int(ctx, argc, argv, 0, -1),
                                     (float)r2d__arg_num(ctx, argc, argv, 1, 0));
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_audio_channel_volume(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const float v = (s && s->audio)
                        ? r2d_audio_get_channel_volume(s->audio, r2d__arg_int(ctx, argc, argv, 0, -1))
                        : 0.0f;
    return JS_NewFloat64(ctx, (double)v);
}

static JSValue r2d__js_audio_set_channel_pan(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->audio) {
        r2d_audio_set_channel_pan(s->audio, r2d__arg_int(ctx, argc, argv, 0, -1),
                                  (float)r2d__arg_num(ctx, argc, argv, 1, 0));
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_audio_channel_pan(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const float v = (s && s->audio)
                        ? r2d_audio_get_channel_pan(s->audio, r2d__arg_int(ctx, argc, argv, 0, -1))
                        : 0.0f;
    return JS_NewFloat64(ctx, (double)v);
}

// engine.audio.setChannelReverb(channel, send, room, damp, width) — реверб-шина
// на канале: доля сигнала уходит в собственный хвост, сухой остаётся.
static JSValue r2d__js_audio_set_channel_reverb(JSContext *ctx, JSValueConst this_val,
                                                int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->audio) return JS_NewBool(ctx, false);
    return JS_NewBool(ctx, r2d_audio_set_channel_reverb(
        s->audio,
        r2d__arg_int(ctx, argc, argv, 0, -1),
        (float)r2d__arg_num(ctx, argc, argv, 1, 0.35),
        (float)r2d__arg_num(ctx, argc, argv, 2, 0.5),
        (float)r2d__arg_num(ctx, argc, argv, 3, 0.4),
        (float)r2d__arg_num(ctx, argc, argv, 4, 0.8)));
}

static JSValue r2d__js_audio_set_effect(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->audio) return JS_NewBool(ctx, false);

    const char *kind = r2d__arg_str(ctx, argc, argv, 1);
    const bool ok = r2d_audio_set_channel_effect(s->audio,
                                                 r2d__arg_int(ctx, argc, argv, 0, -1),
                                                 kind ? kind : "none",
                                                 (float)r2d__arg_num(ctx, argc, argv, 2, 0),
                                                 (float)r2d__arg_num(ctx, argc, argv, 3, 0));
    if (kind) JS_FreeCString(ctx, kind);
    return JS_NewBool(ctx, ok);
}

static JSValue r2d__js_audio_channel_effect(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const char *name = (s && s->audio)
                           ? r2d_audio_channel_effect(s->audio, r2d__arg_int(ctx, argc, argv, 0, -1))
                           : "none";
    return JS_NewString(ctx, name);
}

static JSValue r2d__js_audio_effect_count(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    return JS_NewInt32(ctx, r2d_audio_effect_count());
}

static JSValue r2d__js_audio_effect_name(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    return JS_NewString(ctx, r2d_audio_effect_name(r2d__arg_int(ctx, argc, argv, 0, 0)));
}

// --- Скорость (pitch) -------------------------------------------------------
// MIX_SetTrackFrequencyRatio: 1.0 — как записано, 2.0 — вдвое быстрее и выше.
static JSValue r2d__js_audio_set_channel_pitch(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->audio) {
        r2d_audio_set_channel_pitch(s->audio, r2d__arg_int(ctx, argc, argv, 0, -1),
                                    (float)r2d__arg_num(ctx, argc, argv, 1, 1));
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_audio_channel_pitch(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const float v = (s && s->audio)
                        ? r2d_audio_get_channel_pitch(s->audio, r2d__arg_int(ctx, argc, argv, 0, -1))
                        : 1.0f;
    return JS_NewFloat64(ctx, (double)v);
}

static JSValue r2d__js_audio_set_music_pitch(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (s && s->audio) {
        r2d_audio_set_music_pitch(s->audio, (float)r2d__arg_num(ctx, argc, argv, 0, 1));
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_audio_music_pitch(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewFloat64(ctx, s && s->audio ? (double)r2d_audio_get_music_pitch(s->audio) : 1.0);
}

// --- Реверберация помещения -------------------------------------------------
// engine.audio.setRoom(wet, room, damp, width) — одна комната на весь микс.
static JSValue r2d__js_audio_set_room(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->audio) return JS_FALSE;
    const bool on = r2d_audio_set_room(s->audio,
                                       (float)r2d__arg_num(ctx, argc, argv, 0, 0),
                                       (float)r2d__arg_num(ctx, argc, argv, 1, 0.5),
                                       (float)r2d__arg_num(ctx, argc, argv, 2, 0.5),
                                       (float)r2d__arg_num(ctx, argc, argv, 3, 1.0));
    return JS_NewBool(ctx, on);
}

static JSValue r2d__js_audio_get_room(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    float wet = 0.0f, room = 0.0f, damp = 0.0f, width = 0.0f;
    if (s && s->audio) r2d_audio_get_room(s->audio, &wet, &room, &damp, &width);

    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, o, "wet", JS_NewFloat64(ctx, (double)wet));
    JS_SetPropertyStr(ctx, o, "room", JS_NewFloat64(ctx, (double)room));
    JS_SetPropertyStr(ctx, o, "damp", JS_NewFloat64(ctx, (double)damp));
    JS_SetPropertyStr(ctx, o, "width", JS_NewFloat64(ctx, (double)width));
    return o;
}

// --- Шины и 3D --------------------------------------------------------------
// engine.audio.group(name) — группа микшера (шина): треки одной группы
// микшируются вместе, эффект шины идёт через MIX_SetGroupPostMixCallback.
static JSValue r2d__js_audio_group(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const char *name = r2d__arg_str(ctx, argc, argv, 0);
    int id = -1;
    if (s && s->audio && name) id = r2d_audio_group(s->audio, name);
    if (name) JS_FreeCString(ctx, name);
    return JS_NewInt32(ctx, id);
}

static JSValue r2d__js_audio_group_count(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewInt32(ctx, s && s->audio ? r2d_audio_group_count(s->audio) : 0);
}

static JSValue r2d__js_audio_set_channel_group(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->audio) return JS_FALSE;
    const bool ok = r2d_audio_group_assign(s->audio,
                                           r2d__arg_int(ctx, argc, argv, 0, -1),
                                           r2d__arg_int(ctx, argc, argv, 1, -1));
    return JS_NewBool(ctx, ok);
}

// engine.audio.setGroupReverb(group, send, room, damp, width) — реверб-шина
// с посылом: хвост считается для микса группы, остальные шины его не слышат.
static JSValue r2d__js_audio_set_group_reverb(JSContext *ctx, JSValueConst this_val,
                                              int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->audio) return JS_NewBool(ctx, false);
    return JS_NewBool(ctx, r2d_audio_set_group_reverb(
        s->audio,
        r2d__arg_int(ctx, argc, argv, 0, -1),
        (float)r2d__arg_num(ctx, argc, argv, 1, 0.35),
        (float)r2d__arg_num(ctx, argc, argv, 2, 0.5),
        (float)r2d__arg_num(ctx, argc, argv, 3, 0.4),
        (float)r2d__arg_num(ctx, argc, argv, 4, 0.8)));
}

static JSValue r2d__js_audio_set_group_effect(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->audio) return JS_FALSE;
    const char *kind = r2d__arg_str(ctx, argc, argv, 1);
    const bool ok = r2d_audio_set_group_effect(s->audio,
                                               r2d__arg_int(ctx, argc, argv, 0, -1),
                                               kind ? kind : "none",
                                               (float)r2d__arg_num(ctx, argc, argv, 2, 0),
                                               (float)r2d__arg_num(ctx, argc, argv, 3, 0));
    if (kind) JS_FreeCString(ctx, kind);
    return JS_NewBool(ctx, ok);
}

static JSValue r2d__js_audio_group_effect(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const char *name = (s && s->audio)
                           ? r2d_audio_group_effect(s->audio, r2d__arg_int(ctx, argc, argv, 0, -1))
                           : "none";
    return JS_NewString(ctx, name);
}

// engine.audio.setChannel3D(channel, x, y, z[, on]) — координаты ОТНОСИТЕЛЬНО
// слушателя: SDL_mixer держит слушателя в (0,0,0) и не даёт его двигать.
static JSValue r2d__js_audio_set_channel_3d(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->audio) return JS_FALSE;
    const bool on = argc > 4 ? JS_ToBool(ctx, argv[4]) == 1 : true;
    const bool ok = r2d_audio_set_channel_3d(s->audio,
                                             r2d__arg_int(ctx, argc, argv, 0, -1),
                                             (float)r2d__arg_num(ctx, argc, argv, 1, 0),
                                             (float)r2d__arg_num(ctx, argc, argv, 2, 0),
                                             (float)r2d__arg_num(ctx, argc, argv, 3, 0),
                                             on);
    return JS_NewBool(ctx, ok);
}

// --- Иконки Material Design (встроены в бинарник) ---------------------------
// engine.ui.icon("home") возвращает сам символ, его можно вклеить в любой текст
// интерфейса: RmlUi подставит глиф из запасного шрифта.

static JSValue r2d__js_ui_icon(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const char *name = r2d__arg_str(ctx, argc, argv, 0);
    if (!name) return JS_NewString(ctx, "");

    const uint32_t code = r2d_icon_code(name);
    JS_FreeCString(ctx, name);

    if (code == 0) return JS_NewString(ctx, "");

    char utf8[8];
    r2d_icon_utf8(code, utf8, sizeof utf8);
    return JS_NewString(ctx, utf8);
}

static JSValue r2d__js_ui_icon_code(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const char *name = r2d__arg_str(ctx, argc, argv, 0);
    if (!name) return JS_NewInt32(ctx, 0);

    const uint32_t code = r2d_icon_code(name);
    JS_FreeCString(ctx, name);
    return JS_NewInt32(ctx, (int32_t)code);
}

static JSValue r2d__js_ui_has_icon(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const char *name = r2d__arg_str(ctx, argc, argv, 0);
    if (!name) return JS_NewBool(ctx, false);

    const bool found = r2d_icon_exists(name);
    JS_FreeCString(ctx, name);
    return JS_NewBool(ctx, found);
}

static JSValue r2d__js_ui_icon_count(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    return JS_NewInt32(ctx, r2d_icon_total());
}

static JSValue r2d__js_ui_icon_names(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);

    const int total = r2d_icon_total();
    JSValue arr = JS_NewArray(ctx);
    for (int i = 0; i < total; ++i) {
        JS_SetPropertyUint32(ctx, arr, (uint32_t)i, JS_NewString(ctx, r2d_icon_name(i)));
    }
    return arr;
}

// ---------------------------------------------------------------------------
// Биндинги: 2D BSP-дерево
//
// Дерево строится по отрезкам (x1, y1, x2, y2, метка) и переиспользуется для
// любой позиции наблюдателя: обход даёт порядок «от дальних к ближним» за O(n)
// без сортировки. Нужно там, где геометрия не сетка: наклонные стены, комнаты
// произвольной формы, а z-буфера в пакетной отрисовке нет.
// ---------------------------------------------------------------------------

static JSValue r2d__js_bsp_build(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s) return JS_NewBool(ctx, false);
    if (argc < 1) {
        JS_ThrowTypeError(ctx, "bsp.build(segments: Float32Array) — нужен массив");
        return JS_EXCEPTION;
    }

    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, argv[0], &off, &len, &bpe);
    if (JS_IsException(ab)) return JS_EXCEPTION;

    size_t size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, ab);
    if (!base) {
        JS_FreeValue(ctx, ab);
        JS_ThrowTypeError(ctx, "первый аргумент должен быть Float32Array");
        return JS_EXCEPTION;
    }

    const float *segments = (const float *)(base + off);
    const int count = (int)(len / sizeof(float) / 5);   // stride 5

    const bool ok = r2d_bsp_build(&s->bsp, segments, count);
    JS_FreeValue(ctx, ab);
    return JS_NewBool(ctx, ok);
}

static JSValue r2d__js_bsp_clear(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    if (s) r2d_bsp_free(&s->bsp);
    return JS_UNDEFINED;
}

static JSValue r2d__js_bsp_count(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewInt32(ctx, s ? r2d_bsp_segment_count(&s->bsp) : 0);
}

static JSValue r2d__js_bsp_nodes(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewInt32(ctx, s ? r2d_bsp_node_count(&s->bsp) : 0);
}

static JSValue r2d__js_bsp_depth(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewInt32(ctx, s ? r2d_bsp_depth(&s->bsp) : 0);
}

// bsp.segment(i) -> [x1, y1, x2, y2, user, split?]
// Полезно, чтобы нарисовать результат разрезания отрезков разделителями.
static JSValue r2d__js_bsp_segment(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const int i = r2d__arg_int(ctx, argc, argv, 0, -1);

    if (!s || i < 0 || i >= s->bsp.segment_count) return JS_NULL;

    const R2DSegment *seg = &s->bsp.segments[i];
    JSValue arr = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, arr, 0, JS_NewFloat64(ctx, seg->x1));
    JS_SetPropertyUint32(ctx, arr, 1, JS_NewFloat64(ctx, seg->y1));
    JS_SetPropertyUint32(ctx, arr, 2, JS_NewFloat64(ctx, seg->x2));
    JS_SetPropertyUint32(ctx, arr, 3, JS_NewFloat64(ctx, seg->y2));
    JS_SetPropertyUint32(ctx, arr, 4, JS_NewInt32(ctx, seg->user));
    JS_SetPropertyUint32(ctx, arr, 5, JS_NewBool(ctx, seg->split));
    return arr;
}

// bsp.order(x, y, farToNear?) -> массив индексов отрезков в порядке отрисовки.
static JSValue r2d__js_bsp_order(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s) return JS_NULL;

    const double x = r2d__arg_num(ctx, argc, argv, 0, 0);
    const double y = r2d__arg_num(ctx, argc, argv, 1, 0);
    const bool far_to_near = r2d__arg_bool(ctx, argc, argv, 2, true);

    int count = 0;
    const int *order = r2d_bsp_traverse(&s->bsp, (float)x, (float)y, far_to_near, &count);
    if (!order) return JS_NULL;

    JSValue arr = JS_NewArray(ctx);
    for (int i = 0; i < count; ++i) {
        JS_SetPropertyUint32(ctx, arr, (uint32_t)i, JS_NewInt32(ctx, order[i]));
    }
    return arr;
}

// engine.submitTriangles(verts: Float32Array, count?) — произвольные
// треугольники с цветом на вершину.
//
// verts — stride 6: x, y, r, g, b, a. Координаты в пикселях логического
// экрана, цвет 0..255. count — число ВЕРШИН (кратно 3); если не задан,
// берётся весь массив. Треугольники рисуются поверх спрайтов того же кадра.
//
// Зачем отдельный путь: пакет спрайтов умеет только повёрнутые
// прямоугольники, а полигон видимости — произвольная фигура. Веер
// треугольников с цветом на вершину даёт плавный градиент без текстуры.
static JSValue r2d__js_submit_triangles(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s) return JS_NewInt32(ctx, 0);
    if (argc < 1) {
        JS_ThrowTypeError(ctx, "submitTriangles(vertices: Float32Array, count?)");
        return JS_EXCEPTION;
    }

    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, argv[0], &off, &len, &bpe);
    if (JS_IsException(ab)) return JS_EXCEPTION;

    size_t size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, ab);
    if (!base) {
        JS_FreeValue(ctx, ab);
        JS_ThrowTypeError(ctx, "первый аргумент должен быть Float32Array");
        return JS_EXCEPTION;
    }

    const int available = (int)(len / sizeof(float) / 6);
    int count = argc >= 2 ? r2d__arg_int(ctx, argc, argv, 1, available) : available;
    if (count > available) count = available;
    if (count < 0) count = 0;
    count -= count % 3;   // неполный треугольник рисовать нечем

    if (count > 0) {
        r2d_batch_triangles(s->renderer, (const float *)(base + off), count);
    }

    JS_FreeValue(ctx, ab);
    return JS_NewInt32(ctx, count);
}

// ---------------------------------------------------------------------------
// Биндинги: полигоны видимости (2D-свет и тени)
//
// engine.light.visibility(segments, ox, oy) считает полигон видимости из точки
// (ox, oy) среди отрезков-препятствий. segments — Float32Array, stride 4:
// x1, y1, x2, y2. Возвращает Float32Array вершин [x, y, x, y, ...] в порядке
// по часовой стрелке, либо null, если полигон не поместился в буфер.
//
// Пересекающиеся отрезки разрезаются внутри — можно отдавать любую геометрию.
// ---------------------------------------------------------------------------

// Копия вершин полигона в Float32Array. В QuickJS-ng нет
// JS_NewFloat32Array: собираем через ArrayBuffer, а конструктор типизированного
// массива читает argv[1] и argv[2], поэтому аргументов ровно три.
static JSValue r2d__js_float32_copy(JSContext *ctx, const float *data, int floats)
{
    if (!data || floats <= 0) return JS_NULL;

    JSValue ab = JS_NewArrayBufferCopy(ctx, (const uint8_t *)data,
                                       (size_t)floats * sizeof(float));
    if (JS_IsException(ab)) return JS_NULL;

    JSValue targs[3];
    targs[0] = ab;
    targs[1] = JS_NewInt32(ctx, 0);
    targs[2] = JS_NewInt32(ctx, floats);

    JSValue result = JS_NewTypedArray(ctx, 3, targs, JS_TYPED_ARRAY_FLOAT32);

    JS_FreeValue(ctx, targs[1]);
    JS_FreeValue(ctx, targs[2]);
    JS_FreeValue(ctx, ab);
    return result;
}

static JSValue r2d__js_light_visibility(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 3) {
        JS_ThrowTypeError(ctx, "light.visibility(segments: Float32Array, x, y)");
        return JS_EXCEPTION;
    }

    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, argv[0], &off, &len, &bpe);
    if (JS_IsException(ab)) return JS_EXCEPTION;

    size_t size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, ab);
    if (!base) {
        JS_FreeValue(ctx, ab);
        JS_ThrowTypeError(ctx, "первый аргумент должен быть Float32Array");
        return JS_EXCEPTION;
    }

    const int segment_count = (int)(len / sizeof(float) / 4);
    const float *segments = (const float *)(base + off);

    const double ox = r2d__arg_num(ctx, argc, argv, 1, 0);
    const double oy = r2d__arg_num(ctx, argc, argv, 2, 0);

    int max_points = r2d_visibility_max_points(segment_count);
    if (max_points < 16) max_points = 16;

    float *out = (float *)SDL_malloc((size_t)max_points * 2 * sizeof(float));
    if (!out) {
        JS_FreeValue(ctx, ab);
        JS_ThrowOutOfMemory(ctx);
        return JS_EXCEPTION;
    }

    const int count = r2d_visibility_polygon(segments, segment_count,
                                              (float)ox, (float)oy, out, max_points);

    JSValue result = JS_NULL;
    if (count > 0) {
        result = r2d__js_float32_copy(ctx, out, count * 2);
    }

    SDL_free(out);
    JS_FreeValue(ctx, ab);
    return result;
}

// engine.light.maxPoints(segmentCount) — сколько вершин может вернуть полигон.
// Нужно, чтобы оценить буфер заранее; сам visibility() выделяет его сам.
static JSValue r2d__js_light_max_points(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const int n = r2d__arg_int(ctx, argc, argv, 0, 0);
    return JS_NewInt32(ctx, r2d_visibility_max_points(n));
}

// engine.light.prepare(segments) — разрезает препятствия ОДИН раз и запоминает
// набор: дальше visibilityPrepared() считает полигон без O(n^2) на каждый
// вызов, а буфер оценивается линейно. Возвращает число подотрезков.
static JSValue r2d__js_light_prepare(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 1) {
        JS_ThrowTypeError(ctx, "light.prepare(segments: Float32Array)");
        return JS_EXCEPTION;
    }

    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, argv[0], &off, &len, &bpe);
    if (JS_IsException(ab)) return JS_EXCEPTION;

    size_t size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, ab);
    if (!base) {
        JS_FreeValue(ctx, ab);
        JS_ThrowTypeError(ctx, "первый аргумент должен быть Float32Array");
        return JS_EXCEPTION;
    }

    const int segment_count = (int)(len / sizeof(float) / 4);
    const int prepared = r2d_visibility_prepare((const float *)(base + off), segment_count);

    JS_FreeValue(ctx, ab);
    return JS_NewInt32(ctx, prepared);
}

// engine.light.preparedCount() — сколько подотрезков в подготовленном наборе.
static JSValue r2d__js_light_prepared_count(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2D_UNUSED(argc);
    R2D_UNUSED(argv);
    return JS_NewInt32(ctx, r2d_visibility_prepared_count());
}

// engine.light.preparedMaxPoints() — верхняя оценка вершин по набору.
static JSValue r2d__js_light_prepared_max_points(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2D_UNUSED(argc);
    R2D_UNUSED(argv);
    return JS_NewInt32(ctx, r2d_visibility_prepared_max_points());
}

// engine.light.visibilityPrepared(x, y) — полигон видимости по набору из
// prepare(). Возвращает Float32Array вершин [x, y, ...] или null.
static JSValue r2d__js_light_visibility_prepared(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const double ox = r2d__arg_num(ctx, argc, argv, 0, 0);
    const double oy = r2d__arg_num(ctx, argc, argv, 1, 0);

    int max_points = r2d_visibility_prepared_max_points();
    if (max_points < 16) max_points = 16;

    float *out = (float *)SDL_malloc((size_t)max_points * 2 * sizeof(float));
    if (!out) {
        JS_ThrowOutOfMemory(ctx);
        return JS_EXCEPTION;
    }

    const int count = r2d_visibility_polygon_prepared((float)ox, (float)oy, out, max_points);
    JSValue result = r2d__js_float32_copy(ctx, out, count * 2);

    SDL_free(out);
    return result;
}

// ---------------------------------------------------------------------------
// Регистрация API
// ---------------------------------------------------------------------------

static void r2d__set_fn(JSContext *ctx, JSValue obj, const char *name, JSCFunction *fn, int len)
{
    JS_SetPropertyStr(ctx, obj, name, JS_NewCFunction(ctx, fn, name, len));
}

// engine.setUpdate(fn) — альтернатива экспорту onUpdate из модуля.
static JSValue r2d__js_set_update(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s) return JS_UNDEFINED;
    if (argc < 1 || !JS_IsFunction(ctx, argv[0])) {
        JS_ThrowTypeError(ctx, "setUpdate(fn) — нужна функция");
        return JS_EXCEPTION;
    }
    JS_FreeValue(ctx, s->update_fn);
    s->update_fn = JS_DupValue(ctx, argv[0]);
    s->has_update = true;
    return JS_UNDEFINED;
}

// engine.setRender(fn) — альтернатива экспорту onRender из модуля.
static JSValue r2d__js_set_render(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s) return JS_UNDEFINED;
    if (argc < 1 || !JS_IsFunction(ctx, argv[0])) {
        JS_ThrowTypeError(ctx, "setRender(fn) — нужна функция");
        return JS_EXCEPTION;
    }
    JS_FreeValue(ctx, s->render_fn);
    s->render_fn = JS_DupValue(ctx, argv[0]);
    s->has_render = true;
    return JS_UNDEFINED;
}

// ---------------------------------------------------------------------------
// Биндинги: запросы к миру, файлы, текст, агент
// ---------------------------------------------------------------------------

// Общий вид результата запроса (луч и свип формы): поля одинаковые, чтобы
// $.world.raycast и $.world.castShape возвращали один и тот же дескриптор.
static JSValue r2d__hit_object(JSContext *ctx, float x, float y, float nx, float ny,
                               int body, float fraction)
{
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "hit", JS_TRUE);
    JS_SetPropertyStr(ctx, obj, "x", JS_NewFloat64(ctx, x));
    JS_SetPropertyStr(ctx, obj, "y", JS_NewFloat64(ctx, y));
    JS_SetPropertyStr(ctx, obj, "nx", JS_NewFloat64(ctx, nx));
    JS_SetPropertyStr(ctx, obj, "ny", JS_NewFloat64(ctx, ny));
    JS_SetPropertyStr(ctx, obj, "body", JS_NewInt32(ctx, body));
    JS_SetPropertyStr(ctx, obj, "fraction", JS_NewFloat64(ctx, fraction));
    return obj;
}

// engine.raycast(x1, y1, x2, y2[, ignore_ids]) →
//   { hit, x, y, nx, ny, body, fraction } | null
// ignore_ids — необязательный массив id тел, которые луч пропускает
// (например, тело стрелка): поиск продолжается за ними.
static JSValue r2d__js_raycast(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics) return JS_NULL;

    // Список игнорируемых тел ограничен: он нужен для «не считать себя» и
    // пары соседей, а не для сотен записей.
    int ignore[64];
    int ignore_count = 0;
    if (argc >= 5 && JS_IsArray(argv[4])) {
        JSValue len_val = JS_GetPropertyStr(ctx, argv[4], "length");
        int32_t len = 0;
        if (JS_ToInt32(ctx, &len, len_val) == 0) {
            for (int32_t i = 0; i < len && ignore_count < (int)(sizeof ignore / sizeof ignore[0]); ++i) {
                JSValue item = JS_GetPropertyUint32(ctx, argv[4], (uint32_t)i);
                int32_t id = -1;
                if (JS_ToInt32(ctx, &id, item) == 0 && id >= 0) ignore[ignore_count++] = (int)id;
                JS_FreeValue(ctx, item);
            }
        }
        JS_FreeValue(ctx, len_val);
    }

    R2DRayHit hit;
    // Шестой аргумент — маска слоёв: какие слои луч вообще принимает.
    // Не передан или 0 — все слои (см. r2d__query_filter в physics.c).
    const uint64_t mask = argc >= 6 ? (uint64_t)r2d__arg_num(ctx, argc, argv, 5, 0.0) : 0;
    if (!r2d_physics_raycast(s->physics,
                             (float)r2d__arg_num(ctx, argc, argv, 0, 0.0),
                             (float)r2d__arg_num(ctx, argc, argv, 1, 0.0),
                             (float)r2d__arg_num(ctx, argc, argv, 2, 0.0),
                             (float)r2d__arg_num(ctx, argc, argv, 3, 0.0),
                             ignore_count ? ignore : NULL, ignore_count,
                             mask,
                             &hit)) {
        return JS_NULL;
    }

    return r2d__hit_object(ctx, hit.x, hit.y, hit.nx, hit.ny, hit.body, hit.fraction);
}

// engine.castShape({ x1, y1, x2, y2, shape, halfW, halfH, radius, angle,
//                    ignore: [id,…], mask }) — свип формы (ShapeCast2D).
// Отличие от луча: едет объём, поэтому видно, пролезет ли персонаж в проём.
static JSValue r2d__js_cast_shape(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics || argc < 1 || !JS_IsObject(argv[0])) return JS_NULL;

    JSValueConst opts = argv[0];

    // Форма — строкой, как в createBody.
    int shape = R2D_SHAPE_BOX;
    JSValue kind = JS_GetPropertyStr(ctx, opts, "shape");
    if (JS_IsString(kind)) {
        const char *text = JS_ToCString(ctx, kind);
        if (text) {
            if (SDL_strcmp(text, "circle") == 0)       shape = R2D_SHAPE_CIRCLE;
            else if (SDL_strcmp(text, "capsule") == 0) shape = R2D_SHAPE_CAPSULE;
            JS_FreeCString(ctx, text);
        }
    }
    JS_FreeValue(ctx, kind);

    int ignore[64];
    int ignore_count = 0;
    JSValue list = JS_GetPropertyStr(ctx, opts, "ignore");
    if (JS_IsArray(list)) {
        JSValue len_val = JS_GetPropertyStr(ctx, list, "length");
        int32_t len = 0;
        if (JS_ToInt32(ctx, &len, len_val) == 0) {
            for (int32_t i = 0; i < len && ignore_count < (int)(sizeof ignore / sizeof ignore[0]); ++i) {
                JSValue item = JS_GetPropertyUint32(ctx, list, (uint32_t)i);
                int32_t id = -1;
                if (JS_ToInt32(ctx, &id, item) == 0 && id >= 0) ignore[ignore_count++] = (int)id;
                JS_FreeValue(ctx, item);
            }
        }
        JS_FreeValue(ctx, len_val);
    }
    JS_FreeValue(ctx, list);

    R2DCastShape hit;
    if (!r2d_physics_cast_shape(s->physics, shape,
                                (float)r2d__obj_num(ctx, opts, "halfW", 16.0),
                                (float)r2d__obj_num(ctx, opts, "halfH", 16.0),
                                (float)r2d__obj_num(ctx, opts, "radius", 0.0),
                                (float)r2d__obj_num(ctx, opts, "x1", 0.0),
                                (float)r2d__obj_num(ctx, opts, "y1", 0.0),
                                (float)r2d__obj_num(ctx, opts, "x2", 0.0),
                                (float)r2d__obj_num(ctx, opts, "y2", 0.0),
                                (float)r2d__obj_num(ctx, opts, "angle", 0.0),
                                ignore_count ? ignore : NULL, ignore_count,
                                (uint64_t)r2d__obj_num(ctx, opts, "mask", 0.0),
                                &hit)) {
        return JS_NULL;
    }

    return r2d__hit_object(ctx, hit.x, hit.y, hit.nx, hit.ny, hit.body, hit.fraction);
}

static JSValue r2d__ids_to_array(JSContext *ctx, const int *ids, int count)
{
    JSValue arr = JS_NewArray(ctx);
    for (int i = 0; i < count; ++i) {
        JS_SetPropertyUint32(ctx, arr, (uint32_t)i, JS_NewInt32(ctx, ids[i]));
    }
    return arr;
}

// engine.queryPoint(x, y, mask) → Int32Array идентификаторов тел
static JSValue r2d__js_query_point(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics) return JS_NewArray(ctx);

    int ids[R2D_MAX_QUERY];
    const int count = r2d_physics_query_point(s->physics,
                                              (float)r2d__arg_num(ctx, argc, argv, 0, 0.0),
                                              (float)r2d__arg_num(ctx, argc, argv, 1, 0.0),
                                              (uint64_t)r2d__arg_num(ctx, argc, argv, 2, 0.0),
                                              ids, R2D_MAX_QUERY);
    return r2d__ids_to_array(ctx, ids, count);
}

// engine.queryBox(x, y, w, h, mask) → Int32Array (x, y — центр)
static JSValue r2d__js_query_box(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->physics) return JS_NewArray(ctx);

    int ids[R2D_MAX_QUERY];
    const int count = r2d_physics_query_box(s->physics,
                                            (float)r2d__arg_num(ctx, argc, argv, 0, 0.0),
                                            (float)r2d__arg_num(ctx, argc, argv, 1, 0.0),
                                            (float)r2d__arg_num(ctx, argc, argv, 2, 0.0),
                                            (float)r2d__arg_num(ctx, argc, argv, 3, 0.0),
                                            (uint64_t)r2d__arg_num(ctx, argc, argv, 4, 0.0),
                                            ids, R2D_MAX_QUERY);
    return r2d__ids_to_array(ctx, ids, count);
}

// engine.keysPressed() / engine.keysReleased() → Int32Array скан-кодов.
// Пакетно, а не по одному: $.input.on('key') должен получать фронты нажатий,
// а обойти 512 клавиш из JS — это 512 переходов через границу языка на кадр.
static JSValue r2d__keys_event(JSContext *ctx, bool pressed)
{
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_NewArray(ctx);

    JSValue arr = JS_NewArray(ctx);
    uint32_t n = 0;
    for (int sc = 0; sc < SDL_SCANCODE_COUNT; ++sc) {
        const bool hit = pressed ? r2d_key_pressed(s->app, (SDL_Scancode)sc)
                                 : r2d_key_released(s->app, (SDL_Scancode)sc);
        if (hit) JS_SetPropertyUint32(ctx, arr, n++, JS_NewInt32(ctx, sc));
    }
    return arr;
}

static JSValue r2d__js_keys_pressed(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    return r2d__keys_event(ctx, true);
}

static JSValue r2d__js_keys_released(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    return r2d__keys_event(ctx, false);
}

// engine.keyName(scancode) → человекочитаемое имя клавиши ("Space", "A").
static JSValue r2d__js_key_name(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const int sc = r2d__arg_int(ctx, argc, argv, 0, 0);
    if (sc <= 0 || sc >= SDL_SCANCODE_COUNT) return JS_NewString(ctx, "");
    const char *name = SDL_GetScancodeName((SDL_Scancode)sc);
    return JS_NewString(ctx, name ? name : "");
}

// engine.mouseDelta() → [dx, dy] за кадр.
static JSValue r2d__js_mouse_delta(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    JSValue arr = JS_NewArray(ctx);
    if (!s || !s->app) return arr;
    JS_SetPropertyUint32(ctx, arr, 0, JS_NewFloat64(ctx, s->app->mouse_dx));
    JS_SetPropertyUint32(ctx, arr, 1, JS_NewFloat64(ctx, s->app->mouse_dy));
    return arr;
}

// engine.textInput() — символы, введённые с клавиатуры за этот кадр (UTF-8).
// Нужен <ui.input>: скан-коды не знают про раскладку и IME.
static JSValue r2d__js_text_input(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewString(ctx, (s && s->app) ? r2d_app_text_input(s->app) : "");
}

// engine.setOverlay(on) / engine.overlayVisible() — тот же оверлей, что по F1.
static R2DOverlayFn g_set_overlay = NULL;
static void *g_set_overlay_user = NULL;

void r2d_script_set_overlay_hook(R2DOverlayFn fn, void *user)
{
    g_set_overlay = fn;
    g_set_overlay_user = user;
}

static JSValue r2d__js_set_overlay(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (g_set_overlay) g_set_overlay(g_set_overlay_user, r2d__arg_bool(ctx, argc, argv, 0, true));
    return JS_UNDEFINED;
}

// engine.drawText(text, x, y, size, color, align) — текст поверх сцены.
static JSValue r2d__js_draw_text(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const char *text = r2d__arg_str(ctx, argc, argv, 0);
    if (!text) return JS_UNDEFINED;

    const float x = (float)r2d__arg_num(ctx, argc, argv, 1, 0.0);
    const float y = (float)r2d__arg_num(ctx, argc, argv, 2, 0.0);
    const float size = (float)r2d__arg_num(ctx, argc, argv, 3, 18.0);

    // argv[4] читаем только если аргумент действительно передан: выход за
    // конец argv — это чтение чужой памяти со стека вызова.
    int32_t color = (int32_t)R2D_WHITE;
    if (argc > 4) JS_ToInt32(ctx, &color, argv[4]);
    const uint32_t packed = (uint32_t)color;

    const char *align = (argc > 5) ? JS_ToCString(ctx, argv[5]) : NULL;
    int a = R2D_TEXT_ALIGN_LEFT;
    if (align) {
        if (SDL_strcmp(align, "center") == 0) a = R2D_TEXT_ALIGN_CENTER;
        else if (SDL_strcmp(align, "right") == 0) a = R2D_TEXT_ALIGN_RIGHT;
        JS_FreeCString(ctx, align);
    }
    // argv[6] — имя семейства шрифта, argv[7] — поворот в радианах.
    const char *family = (argc > 6 && !JS_IsUndefined(argv[6]) && !JS_IsNull(argv[6]))
        ? JS_ToCString(ctx, argv[6]) : NULL;
    const float angle = (float)r2d__arg_num(ctx, argc, argv, 7, 0.0);
    // argv[8] — масштаб глифов: текст в сцене растеризуется под мировой кегль,
    // а зум камеры применяется как масштаб спрайтов (см. src/font.c).
    const float scale = (float)r2d__arg_num(ctx, argc, argv, 8, 1.0);

    // Текст рисуется в общий батч кадра: он подчиняется порядку отрисовки,
    // режимам смешивания и пост-обработке — в отличие от прежней очереди
    // поверх сцены (см. src/font.h).
    const int drawn = r2d_font_draw(text, x, y, size, packed, a, family, angle, scale);

    if (family) JS_FreeCString(ctx, family);
    JS_FreeCString(ctx, text);
    return JS_NewInt32(ctx, drawn);
}

// engine.loadFont(name, path) → bool
//
// Шрифт для текста в сцене. Путь — как у loadTexture (от корня игры), имя
// семейства потом используется в engine.drawText(..., family) и в $.font.
static JSValue r2d__js_load_font(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const char *name = r2d__arg_str(ctx, argc, argv, 0);
    const char *path = r2d__arg_str(ctx, argc, argv, 1);
    const bool ok = (name && path) ? r2d_font_load(name, path) : false;
    if (name) JS_FreeCString(ctx, name);
    if (path) JS_FreeCString(ctx, path);
    return JS_NewBool(ctx, ok);
}

// engine.fontDefault() → имя семейства по умолчанию или null
static JSValue r2d__js_font_default(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    const char *name = r2d_font_default();
    return name ? JS_NewString(ctx, name) : JS_NULL;
}

// engine.fontList() → [имена семейств]
static JSValue r2d__js_font_list(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    const int n = r2d_font_count();
    JSValue arr = JS_NewArray(ctx);
    for (int i = 0; i < n; ++i) {
        const char *name = r2d_font_name_at(i);
        if (name) JS_SetPropertyUint32(ctx, arr, (uint32_t)i, JS_NewString(ctx, name));
    }
    return arr;
}

// engine.fontStats() → { glyphs, atlas_w, atlas_h }
static JSValue r2d__js_font_stats(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    int glyphs = 0, aw = 0, ah = 0;
    r2d_font_stats(&glyphs, &aw, &ah);
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "glyphs", JS_NewInt32(ctx, glyphs));
    JS_SetPropertyStr(ctx, obj, "atlas_w", JS_NewInt32(ctx, aw));
    JS_SetPropertyStr(ctx, obj, "atlas_h", JS_NewInt32(ctx, ah));
    JS_SetPropertyStr(ctx, obj, "drawn", JS_NewInt32(ctx, r2d_font_drawn_total()));
    JS_SetPropertyStr(ctx, obj, "first_sprite", JS_NewInt32(ctx, r2d_font_first_sprite()));
    return obj;
}

// engine.measureText(text, size) → [ширина, высота]
static JSValue r2d__js_measure_text(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    const char *text = r2d__arg_str(ctx, argc, argv, 0);
    const float size = (float)r2d__arg_num(ctx, argc, argv, 1, 18.0);

    const char *family = (argc > 2 && !JS_IsUndefined(argv[2]) && !JS_IsNull(argv[2]))
        ? JS_ToCString(ctx, argv[2]) : NULL;
    float w = 0.0f, h = 0.0f;
    if (text) r2d_font_measure(text, size, family, &w, &h);
    if (family) JS_FreeCString(ctx, family);
    if (text) JS_FreeCString(ctx, text);

    JSValue arr = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, arr, 0, JS_NewFloat64(ctx, w));
    JS_SetPropertyUint32(ctx, arr, 1, JS_NewFloat64(ctx, h));
    return arr;
}

// --- Файлы ------------------------------------------------------------------
// Пути разрешаются от каталога запуска — того же, что и у loadTexture.

static JSValue r2d__js_fs_read_text(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const char *path = r2d__arg_str(ctx, argc, argv, 0);
    if (!path || !s) { if (path) JS_FreeCString(ctx, path); return JS_UNDEFINED; }

    char full[4096];
    r2d_app_resolve_path(s->app, full, sizeof full, path);
    JS_FreeCString(ctx, path);

    size_t size = 0;
    char *buf = (char *)SDL_LoadFile(full, &size);
    if (!buf) return JS_UNDEFINED;   // нет файла — undefined, а не исключение
    JSValue out = JS_NewStringLen(ctx, buf, size);
    SDL_free(buf);
    return out;
}

static JSValue r2d__js_fs_write(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const char *path = r2d__arg_str(ctx, argc, argv, 0);
    const char *text = r2d__arg_str(ctx, argc, argv, 1);
    if (!path || !s) {
        if (path) JS_FreeCString(ctx, path);
        if (text) JS_FreeCString(ctx, text);
        return JS_FALSE;
    }

    char full[4096];
    r2d_app_resolve_path(s->app, full, sizeof full, path);
    JS_FreeCString(ctx, path);

    // Каталог назначения может не существовать — создаём (SDL_SaveFile сам
    // этого не делает), иначе сохранение молча ломается.
    char dir[4096];
    SDL_snprintf(dir, sizeof dir, "%s", full);
    char *slash = SDL_strrchr(dir, '/');
    if (slash) {
        *slash = '\0';
        if (dir[0]) SDL_CreateDirectory(dir);
    }

    const size_t len = text ? SDL_strlen(text) : 0;
    const bool ok = SDL_SaveFile(full, text ? text : "", len);
    if (text) JS_FreeCString(ctx, text);
    return ok ? JS_TRUE : JS_FALSE;
}

static JSValue r2d__js_fs_exists(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const char *path = r2d__arg_str(ctx, argc, argv, 0);
    if (!path || !s) { if (path) JS_FreeCString(ctx, path); return JS_FALSE; }

    char full[4096];
    r2d_app_resolve_path(s->app, full, sizeof full, path);
    JS_FreeCString(ctx, path);

    SDL_PathInfo info;
    return (SDL_GetPathInfo(full, &info) && info.type == SDL_PATHTYPE_FILE) ? JS_TRUE : JS_FALSE;
}

static JSValue r2d__js_fs_remove(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    const char *path = r2d__arg_str(ctx, argc, argv, 0);
    if (!path || !s) { if (path) JS_FreeCString(ctx, path); return JS_FALSE; }

    char full[4096];
    r2d_app_resolve_path(s->app, full, sizeof full, path);
    JS_FreeCString(ctx, path);
    // SDL_RemovePath сообщает успех и для несуществующего пути (проверено на
    // SDL 3.4.16: missing → true, ошибка только на запрет доступа). Из-за этого
    // $.fs.remove() врал, а $.save.remove() «удалял» пустые слоты. Спрашиваем
    // о существовании сами — это и есть разница между «удалил» и «и так нет».
    if (!SDL_GetPathInfo(full, NULL)) {
        SDL_SetError("файла нет: %s", full);
        return JS_FALSE;
    }
    return SDL_RemovePath(full) ? JS_TRUE : JS_FALSE;
}

typedef struct R2DFsEnum {
    JSContext *ctx;
    JSValue    arr;
    uint32_t   n;
} R2DFsEnum;

static SDL_EnumerationResult SDLCALL r2d__fs_list_cb(void *userdata, const char *dirname,
                                                      const char *fname)
{
    R2DFsEnum *e = (R2DFsEnum *)userdata;
    char full[4096];
    SDL_snprintf(full, sizeof full, "%s/%s", dirname, fname);

    SDL_PathInfo info;
    if (!SDL_GetPathInfo(full, &info)) return SDL_ENUM_CONTINUE;
    // Каталоги пропускаем: $.fs.list() обещает список файлов, а рекурсию
    // вызывающая сторона может сделать сама.
    if (info.type != SDL_PATHTYPE_FILE) return SDL_ENUM_CONTINUE;

    JS_SetPropertyUint32(e->ctx, e->arr, e->n++, JS_NewString(e->ctx, fname));
    return SDL_ENUM_CONTINUE;
}

// engine.fs.list(dir) → string[] (только файлы, путь относительно base_path)
static JSValue r2d__js_fs_list(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    JSValue arr = JS_NewArray(ctx);
    const char *dir = r2d__arg_str(ctx, argc, argv, 0);
    if (!dir || !s) { if (dir) JS_FreeCString(ctx, dir); return arr; }

    char full[4096];
    r2d_app_resolve_path(s->app, full, sizeof full, dir);
    JS_FreeCString(ctx, dir);

    R2DFsEnum e;
    e.ctx = ctx;
    e.arr = arr;
    e.n = 0;
    SDL_EnumerateDirectory(full, r2d__fs_list_cb, &e);
    return arr;
}

// --- Мост к агенту ----------------------------------------------------------

// engine.setExit(fn) — вызывается движком при завершении (в агентском режиме
// и при обычном выходе), чтобы игра успела сохранить прогресс.
static JSValue r2d__js_set_exit(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s) return JS_UNDEFINED;
    if (argc < 1 || !JS_IsFunction(ctx, argv[0])) {
        JS_ThrowTypeError(ctx, "setExit(fn) — нужна функция");
        return JS_EXCEPTION;
    }
    JS_FreeValue(ctx, s->exit_fn);
    s->exit_fn = JS_DupValue(ctx, argv[0]);
    s->has_exit = true;
    return JS_UNDEFINED;
}

// engine.setSnapshot(fn) — функция, возвращающая JSON-совместимый снимок мира.
// Именно он уходит агенту в ответ на команду `state`.
static JSValue r2d__js_set_snapshot(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s) return JS_UNDEFINED;
    if (argc < 1 || !JS_IsFunction(ctx, argv[0])) {
        JS_ThrowTypeError(ctx, "setSnapshot(fn) — нужна функция");
        return JS_EXCEPTION;
    }
    JS_FreeValue(ctx, s->snapshot_fn);
    s->snapshot_fn = JS_DupValue(ctx, argv[0]);
    return JS_UNDEFINED;
}

// Превращает значение JS в строку JSON. Объекты сериализуются JSON.stringify,
// поэтому циклические структуры дают понятную ошибку, а не мусор.
static bool r2d__value_to_json(R2DScript *s, JSValue value, char **out, char **out_error)
{
    JSContext *ctx = s->ctx;
    if (out) *out = NULL;
    if (out_error) *out_error = NULL;

    if (JS_IsUndefined(value)) {
        if (out) *out = SDL_strdup("null");
        return true;
    }

    // JS_GetGlobalObject возвращает новую ссылку — её обязательно освободить,
    // иначе каждый eval течёт и QuickJS падает на проверке GC при выходе.
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue json_fn = JS_GetPropertyStr(ctx, global, "JSON");
    JSValue stringify = JS_GetPropertyStr(ctx, json_fn, "stringify");
    JSValue args[1] = { value };
    JSValue str = JS_Call(ctx, stringify, json_fn, 1, args);

    bool ok = false;
    if (JS_IsException(str)) {
        if (out_error) {
            JSValue exc = JS_GetException(ctx);
            const char *text = JS_ToCString(ctx, exc);
            *out_error = SDL_strdup(text ? text : "ошибка преобразования в JSON");
            if (text) JS_FreeCString(ctx, text);
            JS_FreeValue(ctx, exc);
        }
        JS_FreeValue(ctx, str);
    } else if (JS_IsUndefined(str)) {
        // JSON.stringify(undefined) — например, функция или символ.
        if (out) *out = SDL_strdup("null");
        ok = true;
        JS_FreeValue(ctx, str);
    } else {
        const char *text = JS_ToCString(ctx, str);
        if (out) *out = SDL_strdup(text ? text : "null");
        if (text) JS_FreeCString(ctx, text);
        ok = true;
        JS_FreeValue(ctx, str);
    }

    JS_FreeValue(ctx, stringify);
    JS_FreeValue(ctx, json_fn);
    JS_FreeValue(ctx, global);
    return ok;
}

// Превращает значение в JSON. Если JSON.stringify не смог (циклическая
// ссылка — например, обёртка $ со ссылкой на узел, а узел на обёртку), отдаём
// ОПИСАНИЕ значения, а не ошибку: агент вызывает методы $ и не должен падать
// от того, что цепочка возвращает саму себя.
static bool r2d__value_to_json_safe(R2DScript *s, JSValue value, char **out, char **out_error)
{
    if (r2d__value_to_json(s, value, out, out_error)) return true;

    JSContext *ctx = s->ctx;
    if (out_error) {
        SDL_free(*out_error);
        *out_error = NULL;
    }

    // Описание обязано быть валидным JSON (строкой): протокол агента — JSON,
    // поэтому кавычки и экранирование делает сам JSON.stringify.
    char buffer[256];
    if (JS_IsObject(value)) {
        JSValue length = JS_GetPropertyStr(ctx, value, "length");
        int32_t len = -1;
        const bool has_len = JS_IsNumber(length) && JS_ToInt32(ctx, &len, length) == 0;
        JS_FreeValue(ctx, length);
        if (has_len && len >= 0) {
            SDL_snprintf(buffer, sizeof buffer,
                         "<объект с циклом в ссылках: length=%d>", (int)len);
        } else {
            SDL_snprintf(buffer, sizeof buffer, "<объект с циклом в ссылках>");
        }
    } else {
        SDL_snprintf(buffer, sizeof buffer, "<значение не сериализуется>");
    }

    if (out) {
        JSValue str = JS_NewString(ctx, buffer);
        const char *text = JS_ToCString(ctx, str);
        // Экранирование: собираем JSON-строку вручную поверх готового
        // JS-значения — так кавычки и юникод не разъезжаются.
        JSValue global = JS_GetGlobalObject(ctx);
        JSValue json_fn = JS_GetPropertyStr(ctx, global, "JSON");
        JSValue stringify = JS_GetPropertyStr(ctx, json_fn, "stringify");
        JSValue args[1] = { str };
        JSValue json = JS_Call(ctx, stringify, json_fn, 1, args);
        const char *json_text = JS_ToCString(ctx, json);
        *out = SDL_strdup(json_text ? json_text : "\"<значение>\"");
        if (json_text) JS_FreeCString(ctx, json_text);
        if (text) JS_FreeCString(ctx, text);
        JS_FreeValue(ctx, json);
        JS_FreeValue(ctx, stringify);
        JS_FreeValue(ctx, json_fn);
        JS_FreeValue(ctx, global);
        JS_FreeValue(ctx, str);
    }
    return true;
}

bool r2d_script_eval(R2DScript *s, const char *code, char **out_json, char **out_error)
{
    if (out_json) *out_json = NULL;
    if (out_error) *out_error = NULL;
    if (!s || !s->ctx || !code) {
        if (out_error) *out_error = SDL_strdup("скриптовый рантайм недоступен");
        return false;
    }

    // eval в глобальном контексте: доступны engine, $, Global и всё, что игра
    // положила в globalThis. В отличие от модулей, тут не нужен import.
    JSValue value = JS_Eval(s->ctx, code, SDL_strlen(code), "<agent eval>",
                            JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(value)) {
        JSValue exc = JS_GetException(s->ctx);
        const char *text = JS_ToCString(s->ctx, exc);
        if (out_error) *out_error = SDL_strdup(text ? text : "ошибка выполнения");
        if (text) JS_FreeCString(s->ctx, text);
        JS_FreeValue(s->ctx, exc);
        JS_FreeValue(s->ctx, value);
        return false;
    }

    const bool ok = r2d__value_to_json_safe(s, value, out_json, out_error);
    JS_FreeValue(s->ctx, value);
    return ok;
}

bool r2d_script_snapshot(R2DScript *s, char **out_json, char **out_error)
{
    if (out_json) *out_json = NULL;
    if (out_error) *out_error = NULL;
    if (!s || !s->ctx || JS_IsUndefined(s->snapshot_fn)) return false;

    JSValue value = JS_Call(s->ctx, s->snapshot_fn, JS_UNDEFINED, 0, NULL);
    if (JS_IsException(value)) {
        JSValue exc = JS_GetException(s->ctx);
        const char *text = JS_ToCString(s->ctx, exc);
        if (out_error) *out_error = SDL_strdup(text ? text : "ошибка снимка состояния");
        if (text) JS_FreeCString(s->ctx, text);
        JS_FreeValue(s->ctx, exc);
        return false;
    }

    const bool ok = r2d__value_to_json(s, value, out_json, out_error);
    JS_FreeValue(s->ctx, value);
    return ok;
}

void r2d_script_call_exit(R2DScript *s)
{
    if (!s || !s->ctx || !s->has_exit || JS_IsUndefined(s->exit_fn)) return;
    JSValue result = JS_Call(s->ctx, s->exit_fn, JS_UNDEFINED, 0, NULL);
    if (JS_IsException(result)) r2d__capture_error(s);
    JS_FreeValue(s->ctx, result);
}

// ---------------------------------------------------------------------------
// engine.window.* — окно из скриптов.
//
// Механика живёт в src/app.c, политика — в высокоуровневом API ($.window).
// Здесь только передача значений: скрипт должен уметь всё, что умеет игрок
// за окном, — переименовать, развернуть, спрятать курсор.
// ---------------------------------------------------------------------------

static JSValue r2d__js_window_set_title(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app || argc < 1) return JS_UNDEFINED;
    const char *text = JS_ToCString(ctx, argv[0]);
    if (text) {
        r2d_app_set_title(s->app, text);
        JS_FreeCString(ctx, text);
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_window_title(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewString(ctx, s && s->app ? r2d_app_title(s->app) : "");
}

static JSValue r2d__js_window_set_size(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_UNDEFINED;
    r2d_app_set_size(s->app, r2d__arg_int(ctx, argc, argv, 0, 1280),
                             r2d__arg_int(ctx, argc, argv, 1, 720));
    return JS_UNDEFINED;
}

static JSValue r2d__js_window_size(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    int w = 0, h = 0;
    if (s && s->app) r2d_app_get_size(s->app, &w, &h);
    JSValue out = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, out, 0, JS_NewInt32(ctx, w));
    JS_SetPropertyUint32(ctx, out, 1, JS_NewInt32(ctx, h));
    return out;
}

static JSValue r2d__js_window_pixel_size(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    int w = 0, h = 0;
    if (s && s->app) r2d_app_get_pixel_size(s->app, &w, &h);
    JSValue out = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, out, 0, JS_NewInt32(ctx, w));
    JS_SetPropertyUint32(ctx, out, 1, JS_NewInt32(ctx, h));
    return out;
}

static JSValue r2d__js_window_set_fullscreen(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_UNDEFINED;
    // Без аргумента — переключить: так удобнее в обработчике клавиши.
    const bool on = (argc >= 1 && !JS_IsUndefined(argv[0])) ? JS_ToBool(ctx, argv[0])
                                                            : !r2d_app_is_fullscreen(s->app);
    r2d_app_set_fullscreen(s->app, on);
    return JS_UNDEFINED;
}

static JSValue r2d__js_window_is_fullscreen(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewBool(ctx, s && s->app && r2d_app_is_fullscreen(s->app));
}

static JSValue r2d__js_window_position(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    int x = 0, y = 0;
    if (s && s->app) r2d_app_get_position(s->app, &x, &y);
    JSValue out = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, out, 0, JS_NewInt32(ctx, x));
    JS_SetPropertyUint32(ctx, out, 1, JS_NewInt32(ctx, y));
    return out;
}

static JSValue r2d__js_window_move(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_UNDEFINED;
    r2d_app_set_position(s->app, r2d__arg_int(ctx, argc, argv, 0, 0),
                                 r2d__arg_int(ctx, argc, argv, 1, 0));
    return JS_UNDEFINED;
}

#define R2D_WINDOW_ACTION(fn_name, call)                                          \
    static JSValue fn_name(JSContext *ctx, JSValueConst this_val,                 \
                           int argc, JSValueConst *argv)                          \
    {                                                                             \
        R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);                  \
        R2DScript *s = r2d__script_of(ctx);                                       \
        if (s && s->app) call;                                                    \
        return JS_UNDEFINED;                                                      \
    }

R2D_WINDOW_ACTION(r2d__js_window_center,   r2d_app_center(s->app))
R2D_WINDOW_ACTION(r2d__js_window_minimize, r2d_app_minimize(s->app))
R2D_WINDOW_ACTION(r2d__js_window_maximize, r2d_app_maximize(s->app))
R2D_WINDOW_ACTION(r2d__js_window_restore,  r2d_app_restore(s->app))
R2D_WINDOW_ACTION(r2d__js_window_show,     r2d_app_show(s->app))
R2D_WINDOW_ACTION(r2d__js_window_hide,     r2d_app_hide(s->app))
R2D_WINDOW_ACTION(r2d__js_window_focus,    r2d_app_focus(s->app))

static JSValue r2d__js_window_visible(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewBool(ctx, s && s->app && r2d_app_is_visible(s->app));
}

static JSValue r2d__js_window_focused(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewBool(ctx, s && s->app && r2d_app_is_focused(s->app));
}

static JSValue r2d__js_window_set_resizable(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_UNDEFINED;
    r2d_app_set_resizable(s->app, argc >= 1 ? JS_ToBool(ctx, argv[0]) : true);
    return JS_UNDEFINED;
}

static JSValue r2d__js_window_resizable(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewBool(ctx, s && s->app && r2d_app_is_resizable(s->app));
}

static JSValue r2d__js_window_set_vsync(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app) return JS_UNDEFINED;
    r2d_app_set_vsync(s->app, argc >= 1 ? JS_ToBool(ctx, argv[0]) : true);
    return JS_UNDEFINED;
}

static JSValue r2d__js_window_vsync(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewBool(ctx, s && s->app && r2d_app_vsync(s->app));
}

static JSValue r2d__js_window_set_cursor(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    R2DScript *s = r2d__script_of(ctx);
    if (!s || !s->app || argc < 1) return JS_UNDEFINED;
    const char *kind = JS_ToCString(ctx, argv[0]);
    if (kind) {
        r2d_app_set_cursor(s->app, kind);
        JS_FreeCString(ctx, kind);
    }
    return JS_UNDEFINED;
}

static JSValue r2d__js_window_cursor(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    R2DScript *s = r2d__script_of(ctx);
    return JS_NewString(ctx, s && s->app ? r2d_app_cursor(s->app) : "normal");
}

static void r2d__install_window(JSContext *ctx, JSValue engine)
{
    JSValue win = JS_NewObject(ctx);
    r2d__set_fn(ctx, win, "setTitle",       r2d__js_window_set_title, 1);
    r2d__set_fn(ctx, win, "title",          r2d__js_window_title, 0);
    r2d__set_fn(ctx, win, "setSize",        r2d__js_window_set_size, 2);
    r2d__set_fn(ctx, win, "size",           r2d__js_window_size, 0);
    r2d__set_fn(ctx, win, "pixelSize",      r2d__js_window_pixel_size, 0);
    r2d__set_fn(ctx, win, "setFullscreen",  r2d__js_window_set_fullscreen, 1);
    r2d__set_fn(ctx, win, "fullscreen",     r2d__js_window_is_fullscreen, 0);
    r2d__set_fn(ctx, win, "position",       r2d__js_window_position, 0);
    r2d__set_fn(ctx, win, "move",           r2d__js_window_move, 2);
    r2d__set_fn(ctx, win, "center",         r2d__js_window_center, 0);
    r2d__set_fn(ctx, win, "minimize",       r2d__js_window_minimize, 0);
    r2d__set_fn(ctx, win, "maximize",       r2d__js_window_maximize, 0);
    r2d__set_fn(ctx, win, "restore",        r2d__js_window_restore, 0);
    r2d__set_fn(ctx, win, "show",           r2d__js_window_show, 0);
    r2d__set_fn(ctx, win, "hide",           r2d__js_window_hide, 0);
    r2d__set_fn(ctx, win, "focus",          r2d__js_window_focus, 0);
    r2d__set_fn(ctx, win, "visible",        r2d__js_window_visible, 0);
    r2d__set_fn(ctx, win, "focused",        r2d__js_window_focused, 0);
    r2d__set_fn(ctx, win, "setResizable",   r2d__js_window_set_resizable, 1);
    r2d__set_fn(ctx, win, "resizable",      r2d__js_window_resizable, 0);
    r2d__set_fn(ctx, win, "setVsync",       r2d__js_window_set_vsync, 1);
    r2d__set_fn(ctx, win, "vsync",          r2d__js_window_vsync, 0);
    r2d__set_fn(ctx, win, "setCursor",      r2d__js_window_set_cursor, 1);
    r2d__set_fn(ctx, win, "cursor",         r2d__js_window_cursor, 0);
    JS_SetPropertyStr(ctx, engine, "window", win);
}


static JSValue r2d__make_engine(JSContext *ctx)
{

    JSValue engine = JS_NewObject(ctx);

    // Базовое
    r2d__set_fn(ctx, engine, "log", r2d__js_log, 1);
    r2d__set_fn(ctx, engine, "rgba", r2d__js_rgba, 4);
    r2d__set_fn(ctx, engine, "now", r2d__js_now, 0);
    r2d__set_fn(ctx, engine, "setCursor", r2d__js_set_cursor, 1);
    r2d__set_fn(ctx, engine, "cursorVisible", r2d__js_cursor_visible, 1);
    r2d__set_fn(ctx, engine, "profile", r2d__js_profile, 0);
    r2d__set_fn(ctx, engine, "profileReset", r2d__js_profile_reset, 0);
    r2d__set_fn(ctx, engine, "profileEnabled", r2d__js_profile_enabled, 1);
    r2d__set_fn(ctx, engine, "quit", r2d__js_quit, 0);
    r2d__set_fn(ctx, engine, "scancode", r2d__js_scancode, 1);
    r2d__set_fn(ctx, engine, "setUpdate", r2d__js_set_update, 1);
    r2d__set_fn(ctx, engine, "setRender", r2d__js_set_render, 1);
    r2d__install_window(ctx, engine);
    r2d__set_fn(ctx, engine, "setExit", r2d__js_set_exit, 1);
    r2d__set_fn(ctx, engine, "setSnapshot", r2d__js_set_snapshot, 1);

    // Ввод
    r2d__set_fn(ctx, engine, "keyDown", r2d__js_key_down, 1);
    r2d__set_fn(ctx, engine, "keyPressed", r2d__js_key_pressed, 1);
    r2d__set_fn(ctx, engine, "keyReleased", r2d__js_key_released, 1);
    r2d__set_fn(ctx, engine, "mouseDown", r2d__js_mouse_down, 1);
    r2d__set_fn(ctx, engine, "mousePressed", r2d__js_mouse_pressed, 1);
    r2d__set_fn(ctx, engine, "padDown", r2d__js_pad_down, 1);
    r2d__set_fn(ctx, engine, "padAxis", r2d__js_pad_axis, 1);
    r2d__set_fn(ctx, engine, "padConnected", r2d__js_pad_connected, 0);
    r2d__set_fn(ctx, engine, "padRumble", r2d__js_pad_rumble, 3);
    r2d__set_fn(ctx, engine, "padRumbleTriggers", r2d__js_pad_rumble_triggers, 3);

    // Ресурсы и отрисовка
    r2d__set_fn(ctx, engine, "loadTexture", r2d__js_load_texture, 1);
    r2d__set_fn(ctx, engine, "textureSize", r2d__js_texture_size, 1);
    r2d__set_fn(ctx, engine, "textureFromPixels", r2d__js_texture_from_pixels, 3);
    r2d__set_fn(ctx, engine, "createSprite", r2d__js_create_sprite, 5);
    r2d__set_fn(ctx, engine, "drawSprite", r2d__js_draw_sprite, 7);
    r2d__set_fn(ctx, engine, "drawRect", r2d__js_draw_rect, 5);
    r2d__set_fn(ctx, engine, "submitSprites", r2d__js_submit_sprites, 3);
    r2d__set_fn(ctx, engine, "submitTriangles", r2d__js_submit_triangles, 2);
    r2d__set_fn(ctx, engine, "setClearColor", r2d__js_set_clear_color, 4);

    // Физика
    r2d__set_fn(ctx, engine, "createBody", r2d__js_create_body, 1);
    r2d__set_fn(ctx, engine, "destroyBody", r2d__js_destroy_body, 1);
    r2d__set_fn(ctx, engine, "bodyAlive", r2d__js_body_alive, 1);
    r2d__set_fn(ctx, engine, "bodyEnabled", r2d__js_body_enabled, 1);
    r2d__set_fn(ctx, engine, "getTransforms", r2d__js_get_transforms, 0);
    r2d__set_fn(ctx, engine, "setVelocity", r2d__js_set_velocity, 3);
    r2d__set_fn(ctx, engine, "getVelocity", r2d__js_get_velocity, 1);
    r2d__set_fn(ctx, engine, "setAngularVelocity", r2d__js_set_angular_velocity, 2);
    r2d__set_fn(ctx, engine, "getAngularVelocity", r2d__js_get_angular_velocity, 1);
    r2d__set_fn(ctx, engine, "setPosition", r2d__js_set_position, 4);
    r2d__set_fn(ctx, engine, "applyImpulse", r2d__js_apply_impulse, 3);
    r2d__set_fn(ctx, engine, "setGravity", r2d__js_set_gravity, 2);
    r2d__set_fn(ctx, engine, "getGravity", r2d__js_get_gravity, 0);
    r2d__set_fn(ctx, engine, "setAwake", r2d__js_set_awake, 2);
    r2d__set_fn(ctx, engine, "isAwake", r2d__js_is_awake, 1);
    r2d__set_fn(ctx, engine, "freeTexture", r2d__js_free_texture, 1);
    r2d__set_fn(ctx, engine, "requestReload", r2d__js_request_reload, 1);
    r2d__set_fn(ctx, engine, "reloadPending", r2d__js_reload_pending, 0);
    r2d__set_fn(ctx, engine, "hotReload", r2d__js_hot_reload, 0);
    r2d__set_fn(ctx, engine, "setSpriteFilter", r2d__js_set_sprite_filter, 1);
    r2d__set_fn(ctx, engine, "setDepth", r2d__js_set_depth, 1);
    r2d__set_fn(ctx, engine, "submitMesh", r2d__js_submit_mesh, 2);
    r2d__set_fn(ctx, engine, "depth", r2d__js_get_depth, 0);
    r2d__set_fn(ctx, engine, "depthInfo", r2d__js_depth_info, 0);
    r2d__set_fn(ctx, engine, "netHost", r2d__js_net_host, 1);
    r2d__set_fn(ctx, engine, "netJoin", r2d__js_net_join, 2);
    r2d__set_fn(ctx, engine, "netClose", r2d__js_net_close, 0);
    r2d__set_fn(ctx, engine, "netMode", r2d__js_net_mode, 0);
    r2d__set_fn(ctx, engine, "netStatus", r2d__js_net_status, 0);
    r2d__set_fn(ctx, engine, "netSend", r2d__js_net_send, 3);
    r2d__set_fn(ctx, engine, "netPoll", r2d__js_net_poll, 0);
    r2d__set_fn(ctx, engine, "netSimulate", r2d__js_net_simulate, 3);
    r2d__set_fn(ctx, engine, "spriteFilter", r2d__js_get_sprite_filter, 0);
    r2d__set_fn(ctx, engine, "limits", r2d__js_limits, 0);
    r2d__set_fn(ctx, engine, "setBodyEnabled", r2d__js_set_body_enabled, 2);
    r2d__set_fn(ctx, engine, "setBodyFilter", r2d__js_set_body_filter, 4);
    r2d__set_fn(ctx, engine, "getBodyFilter", r2d__js_get_body_filter, 1);
    r2d__set_fn(ctx, engine, "setGravityScale", r2d__js_set_gravity_scale, 2);
    r2d__set_fn(ctx, engine, "setBullet", r2d__js_set_bullet, 2);
    // Геймпады по слотам и касания (мультигеймпад, тач-экраны).
    r2d__set_fn(ctx, engine, "padCount", r2d__js_pad_count, 0);
    r2d__set_fn(ctx, engine, "padSlots", r2d__js_pad_slots, 0);
    r2d__set_fn(ctx, engine, "padConnectedAt", r2d__js_pad_connected_at, 1);
    r2d__set_fn(ctx, engine, "padDownAt", r2d__js_pad_down_at, 2);
    r2d__set_fn(ctx, engine, "padPressedAt", r2d__js_pad_pressed_at, 2);
    r2d__set_fn(ctx, engine, "padAxisAt", r2d__js_pad_axis_at, 2);
    r2d__set_fn(ctx, engine, "padRumbleAt", r2d__js_pad_rumble_at, 4);
    r2d__set_fn(ctx, engine, "touchCount", r2d__js_touch_count, 0);
    r2d__set_fn(ctx, engine, "touch", r2d__js_touch, 1);
    r2d__set_fn(ctx, engine, "touchDelta", r2d__js_touch_delta, 1);
    r2d__set_fn(ctx, engine, "touchDown", r2d__js_touch_down, 1);
    r2d__set_fn(ctx, engine, "touchPressure", r2d__js_touch_pressure, 1);
    r2d__set_fn(ctx, engine, "setSleeping", r2d__js_set_sleeping, 2);
    r2d__set_fn(ctx, engine, "isSleeping", r2d__js_is_sleeping, 1);
    r2d__set_fn(ctx, engine, "isBullet", r2d__js_is_bullet, 1);
    r2d__set_fn(ctx, engine, "bodyMass", r2d__js_body_mass, 1);
    r2d__set_fn(ctx, engine, "bodyCount", r2d__js_body_count, 0);
    r2d__set_fn(ctx, engine, "contacts", r2d__js_contacts, 0);
    r2d__set_fn(ctx, engine, "createJoint", r2d__js_create_joint, 1);
    r2d__set_fn(ctx, engine, "destroyJoint", r2d__js_destroy_joint, 1);
    r2d__set_fn(ctx, engine, "jointAlive", r2d__js_joint_alive, 1);
    r2d__set_fn(ctx, engine, "jointCount", r2d__js_joint_count, 0);

    // Константы — чтобы в JS не было магических чисел.
    JS_SetPropertyStr(ctx, engine, "STATIC", JS_NewInt32(ctx, R2D_BODY_STATIC));
    JS_SetPropertyStr(ctx, engine, "KINEMATIC", JS_NewInt32(ctx, R2D_BODY_KINEMATIC));
    JS_SetPropertyStr(ctx, engine, "DYNAMIC", JS_NewInt32(ctx, R2D_BODY_DYNAMIC));
    JS_SetPropertyStr(ctx, engine, "WHITE", JS_NewInt32(ctx, (int32_t)R2D_WHITE));

    // Игровой GUI
    JSValue ui = JS_NewObject(ctx);
    r2d__set_fn(ctx, ui, "load", r2d__js_ui_load, 1);
    r2d__set_fn(ctx, ui, "show", r2d__js_ui_show, 1);
    r2d__set_fn(ctx, ui, "hide", r2d__js_ui_hide, 1);
    r2d__set_fn(ctx, ui, "unload", r2d__js_ui_unload, 1);
    r2d__set_fn(ctx, ui, "visible", r2d__js_ui_visible, 1);
    r2d__set_fn(ctx, ui, "setText", r2d__js_ui_set_text, 3);
    r2d__set_fn(ctx, ui, "setHtml", r2d__js_ui_set_html, 3);
    r2d__set_fn(ctx, ui, "setClass", r2d__js_ui_set_class, 4);
    r2d__set_fn(ctx, ui, "setProperty", r2d__js_ui_set_property, 4);
    r2d__set_fn(ctx, ui, "on", r2d__js_ui_on, 4);

    // Иконки Material Design: встроены в бинарник, доступны по имени.
    r2d__set_fn(ctx, ui, "icon", r2d__js_ui_icon, 1);
    r2d__set_fn(ctx, ui, "iconCode", r2d__js_ui_icon_code, 1);
    r2d__set_fn(ctx, ui, "hasIcon", r2d__js_ui_has_icon, 1);
    r2d__set_fn(ctx, ui, "iconCount", r2d__js_ui_icon_count, 0);
    r2d__set_fn(ctx, ui, "iconNames", r2d__js_ui_icon_names, 0);

    JS_SetPropertyStr(ctx, engine, "ui", ui);

    // Звук и музыка
    JSValue audio = JS_NewObject(ctx);
    r2d__set_fn(ctx, audio, "load", r2d__js_audio_load, 1);
    r2d__set_fn(ctx, audio, "play", r2d__js_audio_play, 4);
    r2d__set_fn(ctx, audio, "stop", r2d__js_audio_stop, 2);
    r2d__set_fn(ctx, audio, "stopAll", r2d__js_audio_stop_all, 1);
    r2d__set_fn(ctx, audio, "playing", r2d__js_audio_playing, 1);
    r2d__set_fn(ctx, audio, "activeChannels", r2d__js_audio_active, 0);
    r2d__set_fn(ctx, audio, "music", r2d__js_audio_music, 4);
    r2d__set_fn(ctx, audio, "stopMusic", r2d__js_audio_stop_music, 1);
    r2d__set_fn(ctx, audio, "pauseMusic", r2d__js_audio_pause_music, 1);
    r2d__set_fn(ctx, audio, "musicPlaying", r2d__js_audio_music_playing, 0);
    r2d__set_fn(ctx, audio, "setMasterVolume", r2d__js_audio_set_master, 1);
    r2d__set_fn(ctx, audio, "getMasterVolume", r2d__js_audio_get_master, 0);
    r2d__set_fn(ctx, audio, "setSfxVolume", r2d__js_audio_set_sfx, 1);
    r2d__set_fn(ctx, audio, "setMusicVolume", r2d__js_audio_set_music_vol, 1);
    r2d__set_fn(ctx, audio, "duration", r2d__js_audio_duration, 1);
    r2d__set_fn(ctx, audio, "count", r2d__js_audio_count, 0);
    r2d__set_fn(ctx, audio, "setChannelVolume", r2d__js_audio_set_channel_volume, 2);
    r2d__set_fn(ctx, audio, "channelVolume", r2d__js_audio_channel_volume, 1);
    r2d__set_fn(ctx, audio, "setChannelPan", r2d__js_audio_set_channel_pan, 2);
    r2d__set_fn(ctx, audio, "channelPan", r2d__js_audio_channel_pan, 1);
    r2d__set_fn(ctx, audio, "setChannelEffect", r2d__js_audio_set_effect, 4);
    r2d__set_fn(ctx, audio, "channelEffect", r2d__js_audio_channel_effect, 1);
    r2d__set_fn(ctx, audio, "effectCount", r2d__js_audio_effect_count, 0);
    r2d__set_fn(ctx, audio, "effectName", r2d__js_audio_effect_name, 1);
    r2d__set_fn(ctx, audio, "setChannelPitch", r2d__js_audio_set_channel_pitch, 2);
    r2d__set_fn(ctx, audio, "channelPitch", r2d__js_audio_channel_pitch, 1);
    r2d__set_fn(ctx, audio, "setMusicPitch", r2d__js_audio_set_music_pitch, 1);
    r2d__set_fn(ctx, audio, "musicPitch", r2d__js_audio_music_pitch, 0);
    r2d__set_fn(ctx, audio, "setRoom", r2d__js_audio_set_room, 4);
    r2d__set_fn(ctx, audio, "getRoom", r2d__js_audio_get_room, 0);
    r2d__set_fn(ctx, audio, "group", r2d__js_audio_group, 1);
    r2d__set_fn(ctx, audio, "groupCount", r2d__js_audio_group_count, 0);
    r2d__set_fn(ctx, audio, "setChannelGroup", r2d__js_audio_set_channel_group, 2);
    r2d__set_fn(ctx, audio, "setGroupEffect", r2d__js_audio_set_group_effect, 4);
    r2d__set_fn(ctx, audio, "setChannelReverb", r2d__js_audio_set_channel_reverb, 5);
    r2d__set_fn(ctx, audio, "setGroupReverb", r2d__js_audio_set_group_reverb, 5);
    r2d__set_fn(ctx, audio, "groupEffect", r2d__js_audio_group_effect, 1);
    r2d__set_fn(ctx, audio, "setChannel3D", r2d__js_audio_set_channel_3d, 5);
    JS_SetPropertyStr(ctx, engine, "audio", audio);

    // 2D BSP-дерево: порядок отрисовки без z-буфера на произвольной геометрии.
    JSValue bsp = JS_NewObject(ctx);
    r2d__set_fn(ctx, bsp, "build", r2d__js_bsp_build, 1);
    r2d__set_fn(ctx, bsp, "clear", r2d__js_bsp_clear, 0);
    r2d__set_fn(ctx, bsp, "count", r2d__js_bsp_count, 0);
    r2d__set_fn(ctx, bsp, "nodes", r2d__js_bsp_nodes, 0);
    r2d__set_fn(ctx, bsp, "depth", r2d__js_bsp_depth, 0);
    r2d__set_fn(ctx, bsp, "segment", r2d__js_bsp_segment, 1);
    r2d__set_fn(ctx, bsp, "order", r2d__js_bsp_order, 3);
    JS_SetPropertyStr(ctx, engine, "bsp", bsp);

    // Полигоны видимости: 2D-свет и тени.
    JSValue light = JS_NewObject(ctx);
    r2d__set_fn(ctx, light, "visibility", r2d__js_light_visibility, 3);
    r2d__set_fn(ctx, light, "maxPoints", r2d__js_light_max_points, 1);
    r2d__set_fn(ctx, light, "prepare", r2d__js_light_prepare, 1);
    r2d__set_fn(ctx, light, "preparedCount", r2d__js_light_prepared_count, 0);
    r2d__set_fn(ctx, light, "preparedMaxPoints", r2d__js_light_prepared_max_points, 0);
    r2d__set_fn(ctx, light, "visibilityPrepared", r2d__js_light_visibility_prepared, 2);
    JS_SetPropertyStr(ctx, engine, "light", light);

    // Запросы к миру: лучи и пересечения. Нужны высокоуровневому API
    // ($.world.raycast/query) и проверке «стоит ли на земле».
    // Последний аргумент каждого — маска слоёв (0 или отсутствие = все слои).
    r2d__set_fn(ctx, engine, "raycast", r2d__js_raycast, 6);
    r2d__set_fn(ctx, engine, "castShape", r2d__js_cast_shape, 1);
    r2d__set_fn(ctx, engine, "queryPoint", r2d__js_query_point, 3);
    r2d__set_fn(ctx, engine, "queryBox", r2d__js_query_box, 5);
    // Ввод: фронты нажатий пакетом (для $.input.on('key')) и мелочи.
    r2d__set_fn(ctx, engine, "keysPressed", r2d__js_keys_pressed, 0);
    r2d__set_fn(ctx, engine, "keysReleased", r2d__js_keys_released, 0);
    r2d__set_fn(ctx, engine, "keyName", r2d__js_key_name, 1);
    r2d__set_fn(ctx, engine, "mouseDelta", r2d__js_mouse_delta, 0);
    r2d__set_fn(ctx, engine, "textInput", r2d__js_text_input, 0);

    // Текст поверх сцены: $.gfx.text, $('<text>'), $.debug.watch.
    r2d__set_fn(ctx, engine, "drawText", r2d__js_draw_text, 6);
    r2d__set_fn(ctx, engine, "measureText", r2d__js_measure_text, 3);
    r2d__set_fn(ctx, engine, "loadFont", r2d__js_load_font, 2);
    r2d__set_fn(ctx, engine, "fontDefault", r2d__js_font_default, 0);
    r2d__set_fn(ctx, engine, "fontList", r2d__js_font_list, 0);
    r2d__set_fn(ctx, engine, "fontStats", r2d__js_font_stats, 0);

    // Отладочный оверлей и завершение.
    r2d__set_fn(ctx, engine, "setOverlay", r2d__js_set_overlay, 1);

    // Файлы: сохранения, данные, сгенерированные таблицы.
    JSValue fs = JS_NewObject(ctx);
    r2d__set_fn(ctx, fs, "readText", r2d__js_fs_read_text, 1);
    r2d__set_fn(ctx, fs, "write", r2d__js_fs_write, 2);
    r2d__set_fn(ctx, fs, "exists", r2d__js_fs_exists, 1);
    r2d__set_fn(ctx, fs, "remove", r2d__js_fs_remove, 1);
    r2d__set_fn(ctx, fs, "list", r2d__js_fs_list, 1);
    JS_SetPropertyStr(ctx, engine, "fs", fs);

    // Расширения engine.*, которые живут в своих файлах и сами ставят себе
    // свойства. Так render.c и http.c не конфликтуют в этом файле: точка
    // расширения одна, а реализации — у каждого свои.
    r2d_render_register_js(ctx, engine);
    r2d_http_register_js(ctx, engine);

    return engine;
}

// ---------------------------------------------------------------------------
// Жизненный цикл рантайма
// ---------------------------------------------------------------------------

static void r2d__free_js_values(R2DScript *s)
{
    if (!s->ctx) return;
    for (int i = 0; i < s->callback_count; ++i) {
        JS_FreeValue(s->ctx, s->callbacks[i]);
        s->callbacks[i] = JS_UNDEFINED;
    }
    s->callback_count = 0;

    JS_FreeValue(s->ctx, s->update_fn);
    JS_FreeValue(s->ctx, s->render_fn);
    JS_FreeValue(s->ctx, s->exit_fn);
    JS_FreeValue(s->ctx, s->snapshot_fn);
    JS_FreeValue(s->ctx, s->engine_obj);
    if (s->transforms_valid) JS_FreeValue(s->ctx, s->transforms_array);

    s->update_fn = JS_UNDEFINED;
    s->render_fn = JS_UNDEFINED;
    s->exit_fn = JS_UNDEFINED;
    s->snapshot_fn = JS_UNDEFINED;
    s->has_exit = false;
    s->engine_obj = JS_UNDEFINED;
    s->transforms_array = JS_UNDEFINED;
    s->transforms_valid = false;
}

static void r2d__destroy_context(R2DScript *s)
{
    if (s->ctx) {
        r2d__free_js_values(s);
        JS_FreeContext(s->ctx);
        s->ctx = NULL;
    }
    if (s->rt) {
        JS_FreeRuntime(s->rt);
        s->rt = NULL;
    }
}

// Прокручивает очередь заданий QuickJS (обещания, import.meta, top-level await).
static void r2d__drain_jobs(R2DScript *s)
{
    if (!s->rt) return;
    JSContext *ctx = NULL;
    int guard = 0;
    for (;;) {
        const int ret = JS_ExecutePendingJob(s->rt, &ctx);
        if (ret == 0) break;               // очередь пуста
        if (ret < 0) {                     // задание бросило исключение
            // Раньше цикл молча выходил: исключение оставалось в контексте,
            // утекало и потом подменяло собой чужую ошибку у следующего
            // потребителя JS_GetException. Забираем и логируем его.
            r2d__capture_error(s);
            break;
        }
        if (++guard > 10000) {
            R2D_WARN("очередь заданий QuickJS не заканчивается — прерываю");
            break;
        }
    }
}

// Загружает высокоуровневое API ($) в текущий контекст.
static bool r2d__load_highlevel_api(R2DScript *s)
{
    if (!s->ctx) return false;

    // Параметры запуска, на которые смотрит $.agent и $.random.
    JS_SetPropertyStr(s->ctx, s->engine_obj, "agent",
                      JS_NewBool(s->ctx, s->agent_mode));
    JS_SetPropertyStr(s->ctx, s->engine_obj, "headless",
                      JS_NewBool(s->ctx, s->headless));
    JS_SetPropertyStr(s->ctx, s->engine_obj, "seed",
                      JS_NewInt32(s->ctx, (int)s->seed));
    if (s->app && s->app->base_path) {
        JS_SetPropertyStr(s->ctx, s->engine_obj, "basePath",
                          JS_NewString(s->ctx, s->app->base_path));
    }

    // Загружаем через импорт, а не через JS_Eval одного исходника: bootstrap
    // сам импортирует свои части, и загрузчик модулей движка должен их
    // увидеть. Имя "r2d/entry.js" задаёт каталог для относительных импортов.
    static const char *bootstrap = "import './bootstrap.js';\n";
    JSValue result = JS_Eval(s->ctx, bootstrap, SDL_strlen(bootstrap), "r2d/entry.js",
                             JS_EVAL_TYPE_MODULE);
    if (JS_IsException(result)) {
        // r2d__capture_error() сам забирает исключение, печатает текст и стек
        // и кладёт всё в last_error. Раньше здесь исключение уже было забрано
        // через JS_GetException, и capture_error получал JS_UNINITIALIZED —
        // в last_error попадало «неизвестная ошибка» вместо настоящей причины.
        r2d__capture_error(s);
        JS_FreeValue(s->ctx, result);
        return false;
    }
    JS_FreeValue(s->ctx, result);
    r2d__drain_jobs(s);

    // $ обязан оказаться в глобальном объекте — иначе игра его не увидит.
    JSValue global = JS_GetGlobalObject(s->ctx);
    JSValue dollar = JS_GetPropertyStr(s->ctx, global, "$");
    const bool ok = JS_IsObject(dollar) || JS_IsFunction(s->ctx, dollar);
    JS_FreeValue(s->ctx, dollar);
    JS_FreeValue(s->ctx, global);
    if (!ok) {
        SDL_snprintf(s->last_error, sizeof s->last_error,
                     "модуль r2d/bootstrap.js не выставил globalThis.$");
        R2D_ERROR("%s", s->last_error);
    }
    return ok;
}

static bool r2d__create_context(R2DScript *s)
{
    s->rt = JS_NewRuntime();
    if (!s->rt) {
        R2D_ERROR("JS_NewRuntime не удалась");
        return false;
    }

    // Ограничения защищают от бесконечной рекурсии и утечек в игровом скрипте.
    JS_SetMemoryLimit(s->rt, 256u * 1024u * 1024u);
    JS_SetMaxStackSize(s->rt, 2u * 1024u * 1024u);
#ifdef R2D_JS_LEAK_DEBUG
    // Диагностика: QuickJS печатает объекты, не освобождённые к моменту
    // уничтожения рантайма. Включается флагом сборки, в обычной сборке выключено.
    JS_SetDumpFlags(s->rt, JS_DUMP_LEAKS);
#endif
    JS_SetModuleLoaderFunc(s->rt, r2d__module_normalize, r2d__module_loader, s);

    s->ctx = JS_NewContext(s->rt);
    if (!s->ctx) {
        R2D_ERROR("JS_NewContext не удалась");
        return false;
    }
    JS_SetContextOpaque(s->ctx, s);

    s->update_fn = JS_UNDEFINED;
    s->render_fn = JS_UNDEFINED;
    s->exit_fn = JS_UNDEFINED;
    s->snapshot_fn = JS_UNDEFINED;
    s->has_exit = false;
    s->engine_obj = JS_UNDEFINED;
    s->transforms_array = JS_UNDEFINED;
    s->transforms_valid = false;
    s->callback_count = 0;
    for (size_t i = 0; i < sizeof s->callbacks / sizeof s->callbacks[0]; ++i) {
        s->callbacks[i] = JS_UNDEFINED;
    }

    // globalThis.engine
    JSValue global = JS_GetGlobalObject(s->ctx);
    s->engine_obj = r2d__make_engine(s->ctx);

    // Спрайт белой текстуры 1x1 — из JS через него рисуют сплошные
    // прямоугольники, в том числе внутри пакета submitSprites().
    if (s->renderer) {
        JS_SetPropertyStr(s->ctx, s->engine_obj, "whiteSprite",
                          JS_NewInt32(s->ctx, s->renderer->white_sprite));
    }

    // Сцена из --scene должна быть видна уже на этапе загрузки модуля:
    // main.js читает engine.startScene прямо в top-level коде, до первого
    // onUpdate. Поэтому выставляем здесь, а не в refresh_engine_props.
    if (s->app && s->app->start_scene && *s->app->start_scene) {
        JS_SetPropertyStr(s->ctx, s->engine_obj, "startScene",
                          JS_NewString(s->ctx, s->app->start_scene));
    } else {
        JS_SetPropertyStr(s->ctx, s->engine_obj, "startScene", JS_NULL);
    }

    JS_SetPropertyStr(s->ctx, global, "engine", JS_DupValue(s->ctx, s->engine_obj));
    JS_FreeValue(s->ctx, global);

    // --- Высокоуровневое API ($) -------------------------------------------
    // Загружается до точки входа игры, поэтому $ доступен уже в top-level
    // коде main.js. Модуль r2d/bootstrap.js строит API и кладёт его в
    // globalThis.$, а import 'r2d' потом отдаёт тот же объект.
    if (!r2d__load_highlevel_api(s)) {
        // Игра без $ работать может (engine.* никуда не делся), поэтому это
        // предупреждение, а не отказ: движок продолжает запуск.
        R2D_WARN("высокоуровневое API ($) не загрузилось — доступен только engine.*");
    }

    // Float32Array поверх C-массива трансформов: без копирования каждый кадр.
    if (s->physics) {
        const size_t bytes = sizeof(float) * 3u * (size_t)R2D_MAX_BODIES;
        JSValue ab = JS_NewArrayBuffer(s->ctx, (uint8_t *)s->physics->transforms, bytes,
                                       NULL, NULL, false);
        if (!JS_IsException(ab)) {
            // ВАЖНО: JS_NewTypedArray передаёт аргументы прямо в конструктор
            // типизированного массива, а тот при ArrayBuffer безусловно читает
            // argv[1] (смещение) и argv[2] (длина). С одним аргументом он
            // прочитал бы мусор со стека и создал массив длиной 0.
            JSValue args[3];
            args[0] = ab;
            args[1] = JS_NewInt32(s->ctx, 0);
            args[2] = JS_NewInt32(s->ctx, R2D_MAX_BODIES * 3);

            JSValue ta = JS_NewTypedArray(s->ctx, 3, args, JS_TYPED_ARRAY_FLOAT32);

            JS_FreeValue(s->ctx, args[1]);
            JS_FreeValue(s->ctx, args[2]);
            JS_FreeValue(s->ctx, ab);

            if (!JS_IsException(ta)) {
                s->transforms_array = ta;
                s->transforms_valid = true;
            } else {
                r2d__capture_error(s);
            }
        } else {
            r2d__capture_error(s);
        }
    }

    return true;
}

// Обновляет в engine быстроменяющиеся числа (без вызова функций из JS).
static void r2d__refresh_engine_props(R2DScript *s)
{
    if (!s->ctx || JS_IsUndefined(s->engine_obj)) return;

    JSContext *ctx = s->ctx;
    JSValueConst e = s->engine_obj;

    JS_SetPropertyStr(ctx, e, "time", JS_NewFloat64(ctx, s->app->time));
    JS_SetPropertyStr(ctx, e, "dt", JS_NewFloat64(ctx, s->app->dt));
    JS_SetPropertyStr(ctx, e, "fps", JS_NewFloat64(ctx, s->app->fps));
    JS_SetPropertyStr(ctx, e, "frame", JS_NewFloat64(ctx, (double)s->app->frame));
    // Логические точки, а не пиксели буфера: на HiDPI игровой код не должен
    // знать про Retina — 1280x720 остаётся 1280x720.
    JS_SetPropertyStr(ctx, e, "width", JS_NewInt32(ctx, s->app->width));
    JS_SetPropertyStr(ctx, e, "height", JS_NewInt32(ctx, s->app->height));
    JS_SetPropertyStr(ctx, e, "mouseX", JS_NewFloat64(ctx, s->app->mouse_x));
    JS_SetPropertyStr(ctx, e, "mouseY", JS_NewFloat64(ctx, s->app->mouse_y));
    JS_SetPropertyStr(ctx, e, "wheel", JS_NewFloat64(ctx, s->app->wheel_y));
    JS_SetPropertyStr(ctx, e, "reloads", JS_NewFloat64(ctx, (double)s->reload_count));
    JS_SetPropertyStr(ctx, e, "mouseDX", JS_NewFloat64(ctx, s->app->mouse_dx));
    JS_SetPropertyStr(ctx, e, "mouseDY", JS_NewFloat64(ctx, s->app->mouse_dy));
    JS_SetPropertyStr(ctx, e, "fixedDt", JS_NewFloat64(ctx, s->fixed_dt));

    // Сцена, запрошенная через --scene. Игра сама решает, как её открыть;
    // это нужно для дымовых прогонов конкретного демо без кликов мышью.
    if (s->app->start_scene && *s->app->start_scene) {
        JS_SetPropertyStr(ctx, e, "startScene", JS_NewString(ctx, s->app->start_scene));
    } else {
        JS_SetPropertyStr(ctx, e, "startScene", JS_NULL);
    }
}

static bool r2d__run_entry(R2DScript *s)
{
    // Важно: JS_Eval для модуля возвращает Promise, а не namespace-объект.
    // Поэтому сначала компилируем модуль, выполняем его через JS_EvalFunction,
    // и уже потом читаем экспорты из namespace.
    JSValue compiled = JS_UNDEFINED;

#ifdef R2D_EMBED_SCRIPTS
    const R2dEmbeddedModule *mod = r2d__find_embedded(s->entry_name);
    if (!mod) {
        SDL_snprintf(s->last_error, sizeof s->last_error,
                     "точка входа '%s' не встроена в бинарник", s->entry_name);
        R2D_ERROR("%s", s->last_error);
        return false;
    }
    compiled = JS_ReadObject(s->ctx, mod->data, mod->size, JS_READ_OBJ_BYTECODE);
    if (JS_IsException(compiled)) {
        r2d__capture_error(s);
        return false;
    }
    if (JS_VALUE_GET_TAG(compiled) != JS_TAG_MODULE) {
        JS_FreeValue(s->ctx, compiled);
        SDL_snprintf(s->last_error, sizeof s->last_error,
                     "точка входа '%s' не является модулем", s->entry_name);
        R2D_ERROR("%s", s->last_error);
        return false;
    }
#else
    // Собранная игра: точка входа лежит в грузе готовым байткодом.
    const R2dPayloadFile *packed_entry = r2d_payload_find(r2d_payload_active(), s->entry_name);
    if (packed_entry) {
        compiled = JS_ReadObject(s->ctx, packed_entry->data, packed_entry->size,
                                 JS_READ_OBJ_BYTECODE);
        if (JS_IsException(compiled)) {
            r2d__capture_error(s);
            return false;
        }
        if (JS_VALUE_GET_TAG(compiled) != JS_TAG_MODULE) {
            JS_FreeValue(s->ctx, compiled);
            SDL_snprintf(s->last_error, sizeof s->last_error,
                         "точка входа '%s' в грузе не является модулем", s->entry_name);
            R2D_ERROR("%s", s->last_error);
            return false;
        }
    } else {
        size_t size = 0;
        char *buf = (char *)SDL_LoadFile(s->entry_path, &size);
        if (!buf) {
            SDL_snprintf(s->last_error, sizeof s->last_error,
                         "не удалось прочитать %s: %s", s->entry_path, SDL_GetError());
            R2D_ERROR("%s", s->last_error);
            return false;
        }

        compiled = JS_Eval(s->ctx, buf, size, s->entry_name,
                           JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
        SDL_free(buf);

        if (JS_IsException(compiled)) {
            r2d__capture_error(s);
            return false;
        }
    }
#endif

    // Указатель на модуль переживёт выполнение: рантайм владеет им до Shutdown.
    JSModuleDef *module = (JSModuleDef *)JS_VALUE_GET_PTR(compiled);

    // JS_EvalFunction забирает владение compiled и выполняет модуль.
    JSValue result = JS_EvalFunction(s->ctx, compiled);
    if (JS_IsException(result)) {
        r2d__capture_error(s);
        return false;
    }
    JS_FreeValue(s->ctx, result);

    // Контракт точки входа: модуль экспортирует onUpdate/onRender. Если он
    // вместо этого вызвал engine.setUpdate()/setRender() — они уже записаны.
    JSValue ns = JS_GetModuleNamespace(s->ctx, module);
    if (JS_IsObject(ns)) {
        JSValue upd = JS_GetPropertyStr(s->ctx, ns, "onUpdate");
        if (JS_IsFunction(s->ctx, upd)) {
            JS_FreeValue(s->ctx, s->update_fn);
            s->update_fn = JS_DupValue(s->ctx, upd);
            s->has_update = true;
        }
        JS_FreeValue(s->ctx, upd);

        JSValue rnd = JS_GetPropertyStr(s->ctx, ns, "onRender");
        if (JS_IsFunction(s->ctx, rnd)) {
            JS_FreeValue(s->ctx, s->render_fn);
            s->render_fn = JS_DupValue(s->ctx, rnd);
            s->has_render = true;
        }
        JS_FreeValue(s->ctx, rnd);
    } else {
        R2D_WARN("модуль %s не отдал namespace — экспорты onUpdate/onRender недоступны",
                  s->entry_path);
    }
    JS_FreeValue(s->ctx, ns);

    s->loaded = true;
    s->last_error[0] = '\0';
    return true;
}

// ---------------------------------------------------------------------------
// Hot reload: следим за mtime всех .js в каталоге игры
// ---------------------------------------------------------------------------

typedef struct R2DScanState {
    double hash;
    int    files;
} R2DScanState;

static SDL_EnumerationResult SDLCALL r2d__scan_cb(void *userdata, const char *dirname,
                                                   const char *fname)
{
    R2DScanState *st = (R2DScanState *)userdata;

    char full[4096];
    SDL_snprintf(full, sizeof full, "%s/%s", dirname, fname);

    SDL_PathInfo info;
    if (!SDL_GetPathInfo(full, &info)) return SDL_ENUM_CONTINUE;

    if (info.type == SDL_PATHTYPE_DIRECTORY) {
        SDL_EnumerateDirectory(full, r2d__scan_cb, st);
        return SDL_ENUM_CONTINUE;
    }

    const size_t len = SDL_strlen(fname);
    if (len < 3 || SDL_strcasecmp(fname + len - 3, ".js") != 0) return SDL_ENUM_CONTINUE;

    // Складываем времена правки и размеры — достаточно, чтобы заметить
    // сохранение файла, и не зависит от точности часов файловой системы.
    st->hash += (double)info.modify_time + (double)info.size * 1e-6;
    st->files++;
    return SDL_ENUM_CONTINUE;
}

static double r2d__scan_scripts(const char *dir, int *file_count)
{
    R2DScanState st = { 0.0, 0 };
    SDL_EnumerateDirectory(dir, r2d__scan_cb, &st);
    if (file_count) *file_count = st.files;
    return st.hash;
}

void r2d_script_poll_hot_reload(R2DScript *s, float dt)
{
    if (!s->hot_reload) return;

    s->reload_check_timer += dt;
    if (s->reload_check_timer < 0.35) return;   // не дёргаем диск каждый кадр
    s->reload_check_timer = 0.0;

    int files = 0;
    const double hash = r2d__scan_scripts(s->game_dir, &files);
    if (files == 0) return;

    if (s->entry_mtime == 0.0) {
        s->entry_mtime = hash;
        return;
    }
    if (hash != s->entry_mtime) {
        s->entry_mtime = hash;
        r2d_script_request_reload(s, "изменены файлы скриптов");
    }
}

void r2d_script_request_reload(R2DScript *s, const char *reason)
{
    if (!s) return;
    if (s->reload_requested) return;   // первый запрос важнее: он и есть причина
    s->reload_requested = true;
    SDL_strlcpy(s->reload_reason, reason ? reason : "без причины", sizeof s->reload_reason);
    R2D_LOG("запрошен перезапуск скриптов (%s) — на границе кадра", s->reload_reason);
}

bool r2d_script_take_reload_request(R2DScript *s, const char **reason_out)
{
    if (!s || !s->reload_requested) return false;
    s->reload_requested = false;
    if (reason_out) *reason_out = s->reload_reason;
    return true;
}

bool r2d_script_hot_reload_enabled(const R2DScript *s)
{
    return s && s->hot_reload;
}

// ---------------------------------------------------------------------------
// Публичный API
// ---------------------------------------------------------------------------

bool r2d_script_init(R2DScript *s, R2DApp *app, R2DRenderer *renderer,
                      R2DPhysics *physics, R2DGui *gui, R2DAudio *audio,
                      const char *entry_relative, bool hot_reload,
                      bool agent_mode, bool headless, double fixed_dt, uint32_t seed)
{
    SDL_zero(*s);
    s->app = app;
    s->renderer = renderer;
    s->physics = physics;
    s->gui = gui;
    s->audio = audio;
    s->agent_mode = agent_mode;
    s->headless = headless;
    s->fixed_dt = fixed_dt;
    s->seed = seed;
#ifdef R2D_EMBED_SCRIPTS
    // В релизной сборке исходников на диске нет — следить не за чем.
    s->hot_reload = false;
    R2D_UNUSED(hot_reload);
#else
    s->hot_reload = hot_reload;
#endif

    // В собранной игре скриптов на диске нет: точкой входа становится груз,
    // а каталогом — каталог запуска (по нему разрешаются пути к ассетам).
    const char *entry_from_payload = r2d_payload_entry();
    if (entry_from_payload && entry_from_payload[0]) {
        SDL_snprintf(s->entry_path, sizeof s->entry_path, "%s", entry_from_payload);
        const char *base = app && app->base_path ? app->base_path : "";
        SDL_snprintf(s->game_dir, sizeof s->game_dir, "%s", base);
        const char *slash = SDL_strrchr(entry_from_payload, '/');
        SDL_snprintf(s->entry_name, sizeof s->entry_name, "%s", slash ? slash + 1 : entry_from_payload);
        s->hot_reload = false;
        if (!r2d__create_context(s)) return false;
        if (!r2d__run_entry(s)) return false;
        s->entry_mtime = 0.0;
        R2D_LOG("собранная игра: точка входа %s из груза", s->entry_name);
        return true;
    }

    r2d_app_resolve_path(app, s->entry_path, sizeof s->entry_path, entry_relative);

    // Каталог скриптов = каталог точки входа, а её имя модуля — имя файла.
    // Именно относительное имя уходит в загрузчик модулей, поэтому оно годится
    // и для чтения с диска, и для поиска во встроенном байткоде.
    SDL_snprintf(s->game_dir, sizeof s->game_dir, "%s", s->entry_path);
    char *slash = SDL_strrchr(s->game_dir, '/');
    if (slash) {
        SDL_snprintf(s->entry_name, sizeof s->entry_name, "%s", slash + 1);
        *slash = '\0';
    } else {
        SDL_snprintf(s->entry_name, sizeof s->entry_name, "%s", s->entry_path);
        s->game_dir[0] = '\0';
    }

    if (s->gui) {
        r2d_gui_set_event_dispatch(s->gui, r2d__gui_dispatch, s);
    }

    if (!r2d__create_context(s)) {
        return false;
    }
    if (!r2d__run_entry(s)) {
        // Скрипт не загрузился — окно всё равно должно открыться, чтобы
        // разработчик увидел ошибку в консоли и в оверлее.
        return false;
    }

    s->entry_mtime = r2d__scan_scripts(s->game_dir, NULL);

    R2D_LOG("скрипты загружены: %s (модуль %s, onUpdate=%s, onRender=%s)",
             s->entry_path, s->entry_name,
             s->has_update ? "да" : "нет", s->has_render ? "да" : "нет");
    return true;
}

void r2d_script_shutdown(R2DScript *s)
{
    r2d_bsp_free(&s->bsp);
    r2d__destroy_context(s);
}

bool r2d_script_reload(R2DScript *s)
{
    s->has_update = false;
    s->has_render = false;
    s->loaded = false;

    // Документы RmlUi переживают перезагрузку, а их слушатели держат числовые
    // id колбэков старого контекста: после пересоздания контекста тот же id
    // указывал бы на чужой обработчик (или ни на какой). Снимаем документы
    // вместе с контекстом — JS-сторона после перезагрузки всё равно пуста.
    if (s->gui) r2d_gui_unload_all(s->gui);

    r2d__destroy_context(s);

    if (!r2d__create_context(s)) {
        return false;
    }

    const bool ok = r2d__run_entry(s);
    s->reload_count++;

    if (ok) {
        // Не перезапускаем слежение на самих себя.
        s->entry_mtime = r2d__scan_scripts(s->game_dir, NULL);
        R2D_LOG("скрипты перезагружены (всего перезагрузок: %llu)",
                 (unsigned long long)s->reload_count);
    }
    return ok;
}

static void r2d__call_no_args(R2DScript *s, JSValue fn)
{
    if (!s->ctx || !JS_IsFunction(s->ctx, fn)) return;
    JSValue ret = JS_Call(s->ctx, fn, JS_UNDEFINED, 0, NULL);
    if (JS_IsException(ret)) {
        r2d__capture_error(s);
    }
    JS_FreeValue(s->ctx, ret);
}

void r2d_script_call_update(R2DScript *s, float dt)
{
    if (!s->ctx || !s->loaded) return;
    r2d__refresh_engine_props(s);

    if (!JS_IsFunction(s->ctx, s->update_fn)) return;

    JSValue arg = JS_NewFloat64(s->ctx, (double)dt);
    JSValue ret = JS_Call(s->ctx, s->update_fn, JS_UNDEFINED, 1, &arg);
    JS_FreeValue(s->ctx, arg);
    if (JS_IsException(ret)) {
        r2d__capture_error(s);
    }
    JS_FreeValue(s->ctx, ret);

    // Обещания игрового кода ($.time.wait, твины, await в $.ready) должны
    // разрешаться в том же кадре, иначе цепочки сценариев «зависают».
    r2d__drain_jobs(s);
}

void r2d_script_call_render(R2DScript *s)
{
    if (!s->ctx || !s->loaded) return;
    r2d__call_no_args(s, s->render_fn);
    r2d__drain_jobs(s);
}

const char *r2d_script_last_error(const R2DScript *s)
{
    return s ? s->last_error : "";
}

int r2d_script_callback_count(const R2DScript *s)
{
    return s ? s->callback_count : 0;
}
