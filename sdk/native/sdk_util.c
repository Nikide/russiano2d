// ===========================================================================
// Общие помощники r2d-sdk: диагностика, файлы, пути, процессы, аргументы.
// ===========================================================================
#include "sdk.h"

#include <SDL3/SDL.h>

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Диагностика
// ---------------------------------------------------------------------------
const char *sdk_severity_name(SdkSeverity s)
{
    switch (s) {
    case SDK_INFO:    return "info";
    case SDK_WARNING: return "warning";
    case SDK_ERROR:   return "error";
    case SDK_FATAL:   return "fatal";
    }
    return "error";
}

void sdk_report_init(SdkReport *r)
{
    memset(r, 0, sizeof *r);
    r2d_sb_init(&r->items);
}

void sdk_report_free(SdkReport *r)
{
    r2d_sb_free(&r->items);
    memset(r, 0, sizeof *r);
}

void sdk_diagv(SdkReport *r, SdkSeverity sev, const char *code, const char *asset,
               const char *location, const char *details, const char *fmt, va_list ap)
{
    char msg[1024];
    vsnprintf(msg, sizeof msg, fmt, ap);

    if (r->count > 0) r2d_sb_putc(&r->items, ',');
    r2d_sb_puts(&r->items, "{\"code\":");
    r2d_sb_put_json_string(&r->items, code);
    r2d_sb_printf(&r->items, ",\"severity\":\"%s\",\"asset\":", sdk_severity_name(sev));
    if (asset) r2d_sb_put_json_string(&r->items, asset);
    else r2d_sb_puts(&r->items, "null");
    r2d_sb_puts(&r->items, ",\"location\":");
    r2d_sb_puts(&r->items, location ? location : "null");
    r2d_sb_puts(&r->items, ",\"message\":");
    r2d_sb_put_json_string(&r->items, msg);
    r2d_sb_puts(&r->items, ",\"details\":");
    r2d_sb_puts(&r->items, details ? details : "null");
    r2d_sb_putc(&r->items, '}');

    r->count++;
    switch (sev) {
    case SDK_INFO:    r->infos++; break;
    case SDK_WARNING: r->warnings++; break;
    default:          r->errors++; break;
    }
}

void sdk_diag(SdkReport *r, SdkSeverity sev, const char *code, const char *asset,
              const char *location, const char *details, const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    sdk_diagv(r, sev, code, asset, location, details, fmt, ap);
    va_end(ap);
}

void sdk_report_put(const SdkReport *r, R2dSb *out)
{
    r2d_sb_puts(out, "\"diagnostics\":[");
    if (r->items.data) r2d_sb_puts(out, r->items.data);
    r2d_sb_putc(out, ']');
}

void sdk_report_put_counts(const SdkReport *r, R2dSb *out)
{
    r2d_sb_printf(out, "\"errors\":%d,\"warnings\":%d,\"infos\":%d",
                  r->errors, r->warnings, r->infos);
}

// ---------------------------------------------------------------------------
// Файлы и пути
// ---------------------------------------------------------------------------
char *sdk_read_file(const char *path, size_t *size)
{
    size_t n = 0;
    void *data = SDL_LoadFile(path, &n);
    if (!data) return NULL;
    char *copy = (char *)malloc(n + 1);
    if (!copy) {
        SDL_free(data);
        return NULL;
    }
    memcpy(copy, data, n);
    copy[n] = '\0';
    SDL_free(data);
    if (size) *size = n;
    return copy;
}

bool sdk_write_file(const char *path, const void *data, size_t size)
{
    return SDL_SaveFile(path, data, size);
}

bool sdk_file_exists(const char *path)
{
    SDL_PathInfo info;
    return SDL_GetPathInfo(path, &info);
}

bool sdk_is_dir(const char *path)
{
    SDL_PathInfo info;
    return SDL_GetPathInfo(path, &info) && info.type == SDL_PATHTYPE_DIRECTORY;
}

void sdk_dirname(const char *path, char *out, size_t cap)
{
    const char *slash = strrchr(path, '/');
    if (!slash) {
        snprintf(out, cap, ".");
        return;
    }
    size_t len = (size_t)(slash - path);
    if (len == 0) len = 1;     // «/x» → «/»
    if (len >= cap) len = cap - 1;
    memcpy(out, path, len);
    out[len] = '\0';
}

void sdk_join(const char *a, const char *b, char *out, size_t cap)
{
    if (!a || !a[0] || strcmp(a, ".") == 0) {
        snprintf(out, cap, "%s", b);
        return;
    }
    const size_t la = strlen(a);
    snprintf(out, cap, "%s%s%s", a, a[la - 1] == '/' ? "" : "/", b);
}

bool sdk_ends_with(const char *s, const char *suffix)
{
    const size_t ls = strlen(s), lx = strlen(suffix);
    if (lx > ls) return false;
    for (size_t i = 0; i < lx; ++i) {
        if (tolower((unsigned char)s[ls - lx + i]) != tolower((unsigned char)suffix[i])) return false;
    }
    return true;
}

static bool glob_rec(const char *p, const char *s)
{
    while (*p) {
        if (*p == '*') {
            while (*p == '*') ++p;
            if (!*p) return true;
            for (; *s; ++s) {
                if (glob_rec(p, s)) return true;
            }
            return glob_rec(p, s);
        }
        if (!*s) return false;
        if (*p != '?' && tolower((unsigned char)*p) != tolower((unsigned char)*s)) return false;
        ++p;
        ++s;
    }
    return *s == '\0';
}

bool sdk_glob_match(const char *pattern, const char *name)
{
    return glob_rec(pattern, name);
}

const char *sdk_basename(const char *path)
{
    const char *slash = strrchr(path, '/');
    return slash ? slash + 1 : path;
}

const char *sdk_exe_dir(void)
{
    const char *base = SDL_GetBasePath();
    return base ? base : "./";
}

static bool digits(const char *s, int n)
{
    for (int i = 0; i < n; ++i) {
        if (!isdigit((unsigned char)s[i])) return false;
    }
    return true;
}

bool sdk_iso8601_tz_ok(const char *s)
{
    // YYYY-MM-DDTHH:MM[:SS[.fff]](Z|±HH:MM)
    if (!s || strlen(s) < 17) return false;
    if (!digits(s, 4) || s[4] != '-' || !digits(s + 5, 2) || s[7] != '-' || !digits(s + 8, 2)) return false;
    if (s[10] != 'T' || !digits(s + 11, 2) || s[13] != ':' || !digits(s + 14, 2)) return false;
    const int month = atoi((char[3]){ s[5], s[6], 0 });
    const int day = atoi((char[3]){ s[8], s[9], 0 });
    const int hour = atoi((char[3]){ s[11], s[12], 0 });
    const int minute = atoi((char[3]){ s[14], s[15], 0 });
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return false;
    const char *p = s + 16;
    if (*p == ':') {
        if (!digits(p + 1, 2)) return false;
        if (atoi((char[3]){ p[1], p[2], 0 }) > 60) return false;
        p += 3;
        if (*p == '.') {
            ++p;
            if (!isdigit((unsigned char)*p)) return false;
            while (isdigit((unsigned char)*p)) ++p;
        }
    }
    if (*p == 'Z' && p[1] == '\0') return true;
    if ((*p == '+' || *p == '-') && digits(p + 1, 2) && p[3] == ':' && digits(p + 4, 2) && p[6] == '\0') {
        return atoi((char[3]){ p[1], p[2], 0 }) <= 23 && atoi((char[3]){ p[4], p[5], 0 }) <= 59;
    }
    return false;
}

R2dJson *sdk_load_json(const char *path, SdkReport *rep)
{
    char *text = sdk_read_file(path, NULL);
    if (!text) {
        sdk_diag(rep, SDK_ERROR, "SDK_FILE_NOT_FOUND", path, NULL, NULL,
                 "Файл не найден или не читается: %s", path);
        return NULL;
    }
    char err[256];
    R2dJson *root = r2d_json_parse(text, err, sizeof err);
    free(text);
    if (!root) {
        R2dSb d;
        r2d_sb_init(&d);
        r2d_sb_puts(&d, "{\"parser\":");
        r2d_sb_put_json_string(&d, err);
        r2d_sb_putc(&d, '}');
        sdk_diag(rep, SDK_ERROR, "SDK_JSON_PARSE", path, NULL, d.data,
                 "Некорректный JSON: %s", err);
        r2d_sb_free(&d);
    }
    return root;
}

void sdk_put_kv_str(R2dSb *sb, const char *key, const char *value)
{
    r2d_sb_put_json_string(sb, key);
    r2d_sb_putc(sb, ':');
    if (value) r2d_sb_put_json_string(sb, value);
    else r2d_sb_puts(sb, "null");
}

// ---------------------------------------------------------------------------
// Процессы
// ---------------------------------------------------------------------------
bool sdk_run_process(const char *const *argv, SdkProcResult *res)
{
    memset(res, 0, sizeof *res);
    SDL_Process *p = SDL_CreateProcess(argv, true);
    if (!p) return false;
    res->started = true;
    size_t n = 0;
    int code = 0;
    void *data = SDL_ReadProcess(p, &n, &code);
    if (data) {
        res->out = (char *)malloc(n + 1);
        if (res->out) {
            memcpy(res->out, data, n);
            res->out[n] = '\0';
            res->out_size = n;
        }
        SDL_free(data);
    }
    res->exit_code = code;
    SDL_DestroyProcess(p);
    return true;
}

void sdk_proc_free(SdkProcResult *res)
{
    free(res->out);
    memset(res, 0, sizeof *res);
}

bool sdk_find_engine(const char *override_path, char *out, size_t cap)
{
    // Явно указанный путь — приказ, а не подсказка: если файла нет, молча
    // подставлять другой движок нельзя (иначе запустится не то, что просили).
    if (override_path && override_path[0]) {
        if (!sdk_file_exists(override_path)) return false;
        snprintf(out, cap, "%s", override_path);
        return true;
    }
    const char *env = SDL_getenv("R2D_ENGINE");
    if (env && env[0]) {
        if (!sdk_file_exists(env)) return false;
        snprintf(out, cap, "%s", env);
        return true;
    }
    char path[1024];
    sdk_join(sdk_exe_dir(), "russiano2d", path, sizeof path);
    if (sdk_file_exists(path)) {
        snprintf(out, cap, "%s", path);
        return true;
    }
    sdk_join(sdk_exe_dir(), "russiano2d.exe", path, sizeof path);
    if (sdk_file_exists(path)) {
        snprintf(out, cap, "%s", path);
        return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Аргументы
// ---------------------------------------------------------------------------
// Флаги, которые принимают значение. Остальные «--x» — булевы.
static bool takes_value(const char *flag)
{
    static const char *const names[] = {
        "--registry", "--engine", "--type", "--depth", "--out", "--output", "--entry",
        "--scene", "--frames", "--project", "--seed", "--preset", "--name", "--tool",
        "--root", "--game", "--fixed-dt", "--format", "--width", "--height", NULL,
    };
    for (int i = 0; names[i]; ++i) {
        if (strcmp(flag, names[i]) == 0) return true;
    }
    return false;
}

const char *sdk_arg_value(const SdkArgs *a, const char *flag)
{
    for (int i = 0; i + 1 < a->argc; ++i) {
        if (strcmp(a->argv[i], flag) == 0) return a->argv[i + 1];
    }
    return NULL;
}

bool sdk_arg_flag(const SdkArgs *a, const char *flag)
{
    for (int i = 0; i < a->argc; ++i) {
        if (strcmp(a->argv[i], flag) == 0) return true;
    }
    return false;
}

const char *sdk_arg_positional(const SdkArgs *a, int n)
{
    int seen = 0;
    for (int i = 0; i < a->argc; ++i) {
        const char *arg = a->argv[i];
        if (arg[0] == '-' && arg[1] == '-') {
            if (takes_value(arg)) ++i;
            continue;
        }
        if (seen++ == n) return arg;
    }
    return NULL;
}

int sdk_fail(SdkReport *rep, const char *code, const char *fmt, ...)
{
    char msg[512];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof msg, fmt, ap);
    va_end(ap);
    sdk_diag(rep, SDK_FATAL, code, NULL, NULL, NULL, "%s", msg);

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"ok\":false,\"error\":");
    r2d_sb_put_json_string(&out, msg);
    r2d_sb_puts(&out, ",\"code\":");
    r2d_sb_put_json_string(&out, code);
    r2d_sb_putc(&out, ',');
    sdk_report_put(rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    r2d_sb_free(&out);
    return 2;
}
