// ===========================================================================
// Мост инструментов SDK: см. sdk_host.h.
// ===========================================================================
#include "sdk_host.h"

#include "payload.h"
#include "r2d.h"

#include <SDL3/SDL.h>

#include <stdlib.h>
#include <string.h>

#define SDK_MAX_JOBS      16
#define SDK_MAX_ARGS      64
#define SDK_MAX_ARG_LEN   4096
#define SDK_OUT_CAP       (1024 * 1024)

// Коды ошибок start(): отрицательные числа, JS-слой превращает их в сообщения.
enum {
    SDK_ERR_DISABLED  = -1,
    SDK_ERR_NO_BINARY = -2,
    SDK_ERR_SPAWN     = -3,
    SDK_ERR_NO_SLOT   = -4,
    SDK_ERR_BAD_ARGS  = -5,
};

#ifdef __EMSCRIPTEN__
// В вебе процессов нет: мост всегда «недоступен».
void r2d_sdk_host_enable(bool enabled) { (void)enabled; }
bool r2d_sdk_host_enabled(void) { return false; }
void r2d_sdk_host_shutdown(void) {}
static JSValue r2d__sdk_available(JSContext *ctx, JSValueConst t, int c, JSValueConst *v)
{
    (void)t; (void)c; (void)v;
    return JS_NewBool(ctx, false);
}
void r2d_sdk_host_register_js(JSContext *ctx, JSValue engine)
{
    JSValue sdk = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, sdk, "available", JS_NewCFunction(ctx, r2d__sdk_available, "available", 0));
    JS_SetPropertyStr(ctx, engine, "sdk", sdk);
}
#else

typedef struct SdkJob {
    bool         used;
    SDL_Process *proc;
    SDL_Thread  *thread;
    SDL_Mutex   *mutex;
    char        *out;
    size_t       out_len;
    bool         truncated;
    bool         done;
    int          exit_code;
    bool         killed;
} SdkJob;

static bool       g_enabled = false;
static SdkJob     g_jobs[SDK_MAX_JOBS];
static bool       g_atexit = false;

void r2d_sdk_host_enable(bool enabled) { g_enabled = enabled; }
bool r2d_sdk_host_enabled(void) { return g_enabled; }

// Читает stdout (+stderr) процесса, пока он не закроется, потом ждёт код выхода.
static int SDLCALL job_thread(void *data)
{
    SdkJob *job = (SdkJob *)data;
    SDL_PropertiesID props = SDL_GetProcessProperties(job->proc);
    SDL_IOStream *io = (SDL_IOStream *)SDL_GetPointerProperty(props, SDL_PROP_PROCESS_STDOUT_POINTER, NULL);
    char chunk[4096];
    while (io) {
        const size_t n = SDL_ReadIO(io, chunk, sizeof chunk);
        if (n == 0) {
            // Пустое чтение — не всегда конец: поток процесса бывает «не готов».
            if (SDL_GetIOStatus(io) == SDL_IO_STATUS_NOT_READY) {
                SDL_Delay(5);
                continue;
            }
            break;
        }
        SDL_LockMutex(job->mutex);
        if (job->out_len + n > SDK_OUT_CAP) {
            // Держим хвост: у долгих процессов (игра) важен свежий журнал.
            const size_t keep = SDK_OUT_CAP / 2;
            if (job->out_len > keep) memmove(job->out, job->out + job->out_len - keep, keep);
            job->out_len = job->out_len > keep ? keep : job->out_len;
            job->truncated = true;
        }
        memcpy(job->out + job->out_len, chunk, n);
        job->out_len += n;
        SDL_UnlockMutex(job->mutex);
    }
    int code = -1;
    SDL_WaitProcess(job->proc, true, &code);
    SDL_LockMutex(job->mutex);
    job->exit_code = code;
    job->done = true;
    SDL_UnlockMutex(job->mutex);
    return 0;
}

static void job_release(SdkJob *job)
{
    if (!job->used) return;
    if (!job->done && job->proc) SDL_KillProcess(job->proc, true);
    if (job->thread) SDL_WaitThread(job->thread, NULL);
    if (job->proc) SDL_DestroyProcess(job->proc);
    if (job->mutex) SDL_DestroyMutex(job->mutex);
    free(job->out);
    memset(job, 0, sizeof *job);
}

void r2d_sdk_host_shutdown(void)
{
    for (int i = 0; i < SDK_MAX_JOBS; ++i) job_release(&g_jobs[i]);
}

static bool binary_path(const char *kind, char *out, size_t cap)
{
    if (SDL_strcmp(kind, "engine") == 0) return r2d_self_executable_path(out, cap);
    if (SDL_strcmp(kind, "tool") != 0) return false;
    const char *dir = SDL_GetBasePath();
    if (!dir) return false;
    static const char *names[] = { "r2d-sdk", "r2d-sdk.exe" };
    for (int i = 0; i < 2; ++i) {
        SDL_snprintf(out, cap, "%s%s", dir, names[i]);
        SDL_PathInfo info;
        if (SDL_GetPathInfo(out, &info)) return true;
    }
    return false;
}

static int start_job(const char *kind, char **args, int argc)
{
    if (!g_enabled) return SDK_ERR_DISABLED;
    char exe[2048];
    if (!binary_path(kind, exe, sizeof exe)) return SDK_ERR_NO_BINARY;

    int slot = -1;
    for (int i = 0; i < SDK_MAX_JOBS; ++i) {
        if (!g_jobs[i].used) { slot = i; break; }
    }
    if (slot < 0) return SDK_ERR_NO_SLOT;

    const char **argv = (const char **)calloc((size_t)argc + 2, sizeof *argv);
    if (!argv) return SDK_ERR_SPAWN;
    argv[0] = exe;
    for (int i = 0; i < argc; ++i) argv[i + 1] = args[i];

    SdkJob *job = &g_jobs[slot];
    memset(job, 0, sizeof *job);
    job->out = (char *)malloc(SDK_OUT_CAP + 1);
    job->mutex = SDL_CreateMutex();
    job->proc = job->out && job->mutex ? SDL_CreateProcess(argv, true) : NULL;
    free(argv);
    if (!job->proc) {
        R2D_WARN("sdk: не удалось запустить %s: %s", exe, SDL_GetError());
        if (job->mutex) SDL_DestroyMutex(job->mutex);
        free(job->out);
        memset(job, 0, sizeof *job);
        return SDK_ERR_SPAWN;
    }
    job->used = true;
    job->thread = SDL_CreateThread(job_thread, "r2d-sdk-job", job);
    if (!job->thread) {
        SDL_KillProcess(job->proc, true);
        job->done = true;
        job_release(job);
        return SDK_ERR_SPAWN;
    }
    if (!g_atexit) {
        g_atexit = true;
        atexit(r2d_sdk_host_shutdown);
    }
    return slot;
}

// ---------------------------------------------------------------------------
// JS: engine.sdk
// ---------------------------------------------------------------------------
static JSValue r2d__sdk_available(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    return JS_NewBool(ctx, g_enabled);
}

// engine.sdk.start(kind, args[]) → id >= 0 или код ошибки < 0
static JSValue r2d__sdk_start(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    if (argc < 2 || !JS_IsString(argv[0]) || !JS_IsArray(argv[1])) {
        return JS_NewInt32(ctx, SDK_ERR_BAD_ARGS);
    }
    const char *kind = JS_ToCString(ctx, argv[0]);
    JSValue len_val = JS_GetPropertyStr(ctx, argv[1], "length");
    int32_t n = 0;
    JS_ToInt32(ctx, &n, len_val);
    JS_FreeValue(ctx, len_val);
    if (!kind || n < 0 || n > SDK_MAX_ARGS) {
        if (kind) JS_FreeCString(ctx, kind);
        return JS_NewInt32(ctx, SDK_ERR_BAD_ARGS);
    }

    char **args = (char **)calloc((size_t)n + 1, sizeof *args);
    int result = SDK_ERR_BAD_ARGS;
    bool ok = args != NULL;
    for (int32_t i = 0; ok && i < n; ++i) {
        JSValue item = JS_GetPropertyUint32(ctx, argv[1], (uint32_t)i);
        const char *text = JS_IsString(item) ? JS_ToCString(ctx, item) : NULL;
        JS_FreeValue(ctx, item);
        if (!text || SDL_strlen(text) > SDK_MAX_ARG_LEN) {
            if (text) JS_FreeCString(ctx, text);
            ok = false;
            break;
        }
        args[i] = SDL_strdup(text);
        JS_FreeCString(ctx, text);
    }
    if (ok) result = start_job(kind, args, (int)n);
    if (args) {
        for (int32_t i = 0; i < n; ++i) SDL_free(args[i]);
        free(args);
    }
    JS_FreeCString(ctx, kind);
    return JS_NewInt32(ctx, result);
}

static SdkJob *job_from_arg(JSContext *ctx, JSValueConst v)
{
    int32_t id = -1;
    if (JS_ToInt32(ctx, &id, v) != 0 || id < 0 || id >= SDK_MAX_JOBS || !g_jobs[id].used) return NULL;
    return &g_jobs[id];
}

// engine.sdk.poll(id) → { running, exitCode, output, bytes, truncated, killed } | null
static JSValue r2d__sdk_poll(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    SdkJob *job = argc >= 1 ? job_from_arg(ctx, argv[0]) : NULL;
    if (!job) return JS_NULL;
    SDL_LockMutex(job->mutex);
    JSValue obj = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, obj, "running", JS_NewBool(ctx, !job->done));
    JS_SetPropertyStr(ctx, obj, "exitCode", job->done ? JS_NewInt32(ctx, job->exit_code) : JS_NULL);
    JS_SetPropertyStr(ctx, obj, "output", JS_NewStringLen(ctx, job->out, job->out_len));
    JS_SetPropertyStr(ctx, obj, "bytes", JS_NewInt64(ctx, (int64_t)job->out_len));
    JS_SetPropertyStr(ctx, obj, "truncated", JS_NewBool(ctx, job->truncated));
    JS_SetPropertyStr(ctx, obj, "killed", JS_NewBool(ctx, job->killed));
    SDL_UnlockMutex(job->mutex);
    return obj;
}

static JSValue r2d__sdk_kill(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    SdkJob *job = argc >= 1 ? job_from_arg(ctx, argv[0]) : NULL;
    if (!job) return JS_NewBool(ctx, false);
    if (!job->done) {
        job->killed = true;
        SDL_KillProcess(job->proc, true);
    }
    return JS_NewBool(ctx, true);
}

static JSValue r2d__sdk_release(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val);
    SdkJob *job = argc >= 1 ? job_from_arg(ctx, argv[0]) : NULL;
    if (!job) return JS_NewBool(ctx, false);
    job_release(job);
    return JS_NewBool(ctx, true);
}

// engine.sdk.paths() → { tool, toolFound, engine, exeDir }
static JSValue r2d__sdk_paths(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv)
{
    R2D_UNUSED(this_val); R2D_UNUSED(argc); R2D_UNUSED(argv);
    JSValue obj = JS_NewObject(ctx);
    char path[2048];
    const bool tool = binary_path("tool", path, sizeof path);
    JS_SetPropertyStr(ctx, obj, "tool", tool ? JS_NewString(ctx, path) : JS_NULL);
    JS_SetPropertyStr(ctx, obj, "toolFound", JS_NewBool(ctx, tool));
    const bool eng = binary_path("engine", path, sizeof path);
    JS_SetPropertyStr(ctx, obj, "engine", eng ? JS_NewString(ctx, path) : JS_NULL);
    const char *dir = SDL_GetBasePath();
    JS_SetPropertyStr(ctx, obj, "exeDir", dir ? JS_NewString(ctx, dir) : JS_NULL);
    return obj;
}

void r2d_sdk_host_register_js(JSContext *ctx, JSValue engine)
{
    JSValue sdk = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, sdk, "available", JS_NewCFunction(ctx, r2d__sdk_available, "available", 0));
    JS_SetPropertyStr(ctx, sdk, "start", JS_NewCFunction(ctx, r2d__sdk_start, "start", 2));
    JS_SetPropertyStr(ctx, sdk, "poll", JS_NewCFunction(ctx, r2d__sdk_poll, "poll", 1));
    JS_SetPropertyStr(ctx, sdk, "kill", JS_NewCFunction(ctx, r2d__sdk_kill, "kill", 1));
    JS_SetPropertyStr(ctx, sdk, "release", JS_NewCFunction(ctx, r2d__sdk_release, "release", 1));
    JS_SetPropertyStr(ctx, sdk, "paths", JS_NewCFunction(ctx, r2d__sdk_paths, "paths", 0));
    JS_SetPropertyStr(ctx, engine, "sdk", sdk);
}

#endif  // __EMSCRIPTEN__
