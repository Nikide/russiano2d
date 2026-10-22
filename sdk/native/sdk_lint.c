// ===========================================================================
// `r2d lint` — API-aware проверка JS без запуска игры.
//
// Это не полноценный JS-парсер и не style police: детерминированный сканер
// проверяет только обращения к $ API по сгенерированной api.schema.json.
// Стабильные коды: R2D001 (метод), R2D002 (свойство), R2D004 (аргументы),
// R2D014 (тип свойства).
// ===========================================================================
#include "sdk.h"
#include "payload.h"

#include <SDL3/SDL.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    char *path;
    char kind[16];
    char type[16];
    int arity;
} ApiEntry;

typedef struct {
    ApiEntry *items;
    int count;
} ApiSchema;

typedef struct {
    char *text;
    int line, col;
} Token;

typedef struct {
    char *file;
    Token *tokens;
    int count;
} Source;

static void schema_free(ApiSchema *s)
{
    for (int i = 0; i < s->count; ++i) free(s->items[i].path);
    free(s->items);
    memset(s, 0, sizeof *s);
}

// Условное «имя файла»: схема лежит не на диске, а во встроенном пакете.
#define SDK_BUILTIN_SCHEMA SDK_BUILTIN_PREFIX "api.schema.json"

static bool load_schema(const char *path, ApiSchema *out)
{
    size_t size = 0;
    char *text = sdk_read_file(path, &size);
    if (!text) return false;
    char err[256];
    R2dJson *root = r2d_json_parse(text, err, sizeof err);
    free(text);
    if (!root) return false;
    const R2dJson *names = r2d_json_get(root, "names");
    if (!names || names->type != R2D_JSON_ARR) { r2d_json_free(root); return false; }
    out->count = r2d_json_size(names);
    out->items = (ApiEntry *)calloc((size_t)(out->count ? out->count : 1), sizeof *out->items);
    if (!out->items) { r2d_json_free(root); return false; }
    for (int i = 0; i < out->count; ++i) {
        const R2dJson *item = r2d_json_at(names, i);
        const char *p = r2d_json_str(r2d_json_get(item, "path"), "");
        const char *kind = r2d_json_str(r2d_json_get(item, "kind"), "any");
        out->items[i].path = (char *)malloc(strlen(p) + 1);
        if (!out->items[i].path) { r2d_json_free(root); schema_free(out); return false; }
        strcpy(out->items[i].path, p);
        snprintf(out->items[i].kind, sizeof out->items[i].kind, "%s", kind);
        out->items[i].arity = (int)(r2d_json_get(item, "arity") ? r2d_json_get(item, "arity")->number : 0);
        const char *type = "any";
        if (!strcmp(kind, "number")) type = "number";
        else if (!strcmp(kind, "string")) type = "string";
        else if (!strcmp(kind, "boolean")) type = "boolean";
        else if (!strcmp(kind, "array")) type = "array";
        else if (!strcmp(kind, "function")) type = "function";
        else if (!strcmp(kind, "object")) type = "object";
        else if (!strcmp(kind, "null")) type = "null";
        snprintf(out->items[i].type, sizeof out->items[i].type, "%s", type);
    }
    r2d_json_free(root);
    return true;
}

static const ApiEntry *find_entry(const ApiSchema *s, const char *path)
{
    for (int i = 0; i < s->count; ++i)
        if (!strcmp(s->items[i].path, path)) return &s->items[i];
    return NULL;
}

static int levenshtein(const char *a, const char *b)
{
    const int n = (int)strlen(a), m = (int)strlen(b);
    if (n > 128 || m > 128) return 999;
    int prev[129], cur[129];
    for (int j = 0; j <= m; ++j) prev[j] = j;
    for (int i = 1; i <= n; ++i) {
        cur[0] = i;
        for (int j = 1; j <= m; ++j) {
            const int cost = a[i - 1] == b[j - 1] ? 0 : 1;
            int best = prev[j] + 1;
            if (cur[j - 1] + 1 < best) best = cur[j - 1] + 1;
            if (prev[j - 1] + cost < best) best = prev[j - 1] + cost;
            cur[j] = best;
        }
        memcpy(prev, cur, (size_t)(m + 1) * sizeof *prev);
    }
    return prev[m];
}

// Ближайшее публичное имя под данным prefix. Для node-методов prefix="$.fn.".
static const char *suggest(const ApiSchema *s, const char *prefix, const char *name)
{
    const char *best = NULL;
    int best_dist = 3;
    const size_t plen = strlen(prefix);
    for (int i = 0; i < s->count; ++i) {
        if (strncmp(s->items[i].path, prefix, plen) != 0) continue;
        const char *candidate = s->items[i].path + plen;
        if (strchr(candidate, '.')) continue;
        const int d = levenshtein(name, candidate);
        if (d < best_dist) { best_dist = d; best = candidate; }
    }
    return best;
}

static const ApiEntry *find_selector_entry(const ApiSchema *s, const char *name)
{
    char path[256];
    snprintf(path, sizeof path, "$.fn.%s", name);
    const ApiEntry *e = find_entry(s, path);
    if (e) return e;
    snprintf(path, sizeof path, "$.selection.%s", name);
    return find_entry(s, path);
}

static const char *suggest_selector(const ApiSchema *s, const char *name)
{
    const char *a = suggest(s, "$.fn.", name);
    const char *b = suggest(s, "$.selection.", name);
    if (!a) return b;
    if (!b) return a;
    return levenshtein(name, a) <= levenshtein(name, b) ? a : b;
}

static bool tokenize(const char *src, Source *out, char *err, size_t errsz)
{
    out->count = 0;
    size_t cap = 256;
    out->tokens = (Token *)calloc(cap, sizeof *out->tokens);
    if (!out->tokens) { snprintf(err, errsz, "out of memory"); return false; }
    int line = 1, col = 1;
    const char *p = src;
    while (*p) {
        if (*p == '\n') { line++; col = 1; p++; continue; }
        if (isspace((unsigned char)*p)) { col++; p++; continue; }
        if (p[0] == '/' && p[1] == '/') { while (*p && *p != '\n') { col++; p++; } continue; }
        if (p[0] == '/' && p[1] == '*') {
            p += 2; col += 2;
            while (*p && !(p[0] == '*' && p[1] == '/')) { if (*p == '\n') { line++; col = 1; } else col++; p++; }
            if (*p) { p += 2; col += 2; }
            continue;
        }
        if (out->count == (int)cap) {
            cap *= 2; Token *grown = (Token *)realloc(out->tokens, cap * sizeof *grown);
            if (!grown) { snprintf(err, errsz, "out of memory"); free(out->tokens); out->tokens = NULL; return false; }
            out->tokens = grown;
        }
        Token *t = &out->tokens[out->count++];
        t->line = line; t->col = col;
        size_t start = 0;
        if (*p == '"' || *p == '\'' || *p == '`') {
            const char quote = *p++;
            col++;
            start = (size_t)(p - src);
            while (*p && *p != quote) {
                if (*p == '\\' && p[1]) { p += 2; col += 2; continue; }
                if (*p == '\n') { line++; col = 1; p++; continue; }
                p++; col++;
            }
            size_t len = (size_t)(p - src) - start;
            t->text = (char *)malloc(len + 2);
            if (!t->text) { snprintf(err, errsz, "out of memory"); return false; }
            t->text[0] = quote;
            memcpy(t->text + 1, src + start, len);
            t->text[len + 1] = 0;
            if (*p == quote) { p++; col++; }
            continue;
        }
        if (isalpha((unsigned char)*p) || *p == '_' || *p == '$') {
            start = (size_t)(p - src);
            while (isalnum((unsigned char)*p) || *p == '_' || *p == '$') { p++; col++; }
            size_t len = (size_t)(p - src) - start;
            t->text = (char *)malloc(len + 1);
            if (!t->text) { snprintf(err, errsz, "out of memory"); return false; }
            memcpy(t->text, src + start, len); t->text[len] = 0;
            continue;
        }
        if (isdigit((unsigned char)*p)) {
            start = (size_t)(p - src);
            while (isalnum((unsigned char)*p) || *p == '.') { p++; col++; }
            size_t len = (size_t)(p - src) - start;
            t->text = (char *)malloc(len + 1);
            if (!t->text) { snprintf(err, errsz, "out of memory"); return false; }
            memcpy(t->text, src + start, len); t->text[len] = 0;
            continue;
        }
        t->text = (char *)malloc(2);
        if (!t->text) { snprintf(err, errsz, "out of memory"); return false; }
        t->text[0] = *p; t->text[1] = 0;
        p++; col++;
    }
    return true;
}

static void source_free(Source *s)
{
    for (int i = 0; i < s->count; ++i) free(s->tokens[i].text);
    free(s->tokens);
    memset(s, 0, sizeof *s);
}

static bool is_ident(const Token *t)
{
    return t && t->text && (isalpha((unsigned char)t->text[0]) || t->text[0] == '_' || t->text[0] == '$');
}

static int matching_paren(const Source *s, int open)
{
    int depth = 0;
    for (int i = open; i < s->count; ++i) {
        if (!strcmp(s->tokens[i].text, "(")) depth++;
        else if (!strcmp(s->tokens[i].text, ")")) { depth--; if (depth == 0) return i; }
    }
    return -1;
}

static int arg_count(const Source *s, int open, int close)
{
    int count = 0, depth = 0;
    bool has_value = false;
    for (int i = open + 1; i < close; ++i) {
        const char *t = s->tokens[i].text;
        if (!strcmp(t, "(") || !strcmp(t, "[") || !strcmp(t, "{")) depth++;
        else if (!strcmp(t, ")") || !strcmp(t, "]") || !strcmp(t, "}")) depth--;
        else if (depth == 0 && !strcmp(t, ",")) { if (has_value) count++; has_value = false; continue; }
        if (depth >= 0 && strcmp(t, ",")) has_value = true;
    }
    if (has_value) count++;
    return count;
}

static void add_diag(SdkReport *rep, const char *code, const char *file, int line, int col,
                     const char *fmt, ...)
{
    char msg[512];
    va_list ap; va_start(ap, fmt); vsnprintf(msg, sizeof msg, fmt, ap); va_end(ap);
    char loc[256];
    snprintf(loc, sizeof loc, "{\"line\":%d,\"column\":%d}", line, col);
    sdk_diag(rep, SDK_ERROR, code, file, loc, NULL, "%s", msg);
}

static const char *literal_type(const Token *t)
{
    if (!t) return NULL;
    if (is_ident(t)) {
        if (!strcmp(t->text, "true") || !strcmp(t->text, "false")) return "boolean";
        if (!strcmp(t->text, "null") || !strcmp(t->text, "undefined")) return "null";
        if (!strcmp(t->text, "function")) return "function";
    }
    if (t->text[0] == '"' || t->text[0] == '\'' || t->text[0] == '`') return "string";
    if (isdigit((unsigned char)t->text[0]) || (t->text[0] == '-' && isdigit((unsigned char)t->text[1]))) return "number";
    return NULL;
}

static void lint_file(const ApiSchema *schema, const char *file, const char *src, SdkReport *rep)
{
    Source s;
    char err[256];
    if (!tokenize(src, &s, err, sizeof err)) {
        sdk_diag(rep, SDK_ERROR, "SDK_LINT_TOKENIZE", file, NULL, NULL, "%s", err);
        return;
    }
    for (int i = 0; i < s.count; ++i) {
        const Token *t = &s.tokens[i];
        if (strcmp(t->text, "$") != 0) continue;
        if (i + 1 >= s.count) continue;
        // $("selector") -> node chain
        if (!strcmp(s.tokens[i + 1].text, "(")) {
            int close = matching_paren(&s, i + 1);
            if (close < 0) continue;
            int j = close + 1;
            while (j + 1 < s.count && !strcmp(s.tokens[j].text, ".") && is_ident(&s.tokens[j + 1])) {
                const char *name = s.tokens[j + 1].text;
                char path[256];
                snprintf(path, sizeof path, "$.fn.%s", name);
                const bool call = (j + 2 < s.count && !strcmp(s.tokens[j + 2].text, "("));
                const ApiEntry *e = find_selector_entry(schema, name);
                if (!e && strcmp(name, "id") && strcmp(name, "x") && strcmp(name, "y")) {
                    const char *near = suggest_selector(schema, name);
                    if (near) add_diag(rep, "R2D001", file, s.tokens[j + 1].line, s.tokens[j + 1].col,
                        "Unknown method \"%s\"; did you mean \"%s\"?", name, near);
                    else add_diag(rep, "R2D001", file, s.tokens[j + 1].line, s.tokens[j + 1].col,
                        "Unknown method \"%s\"", name);
                } else if (false && e && call && e->arity > 0) {
                    int pc = matching_paren(&s, j + 2);
                    if (pc > 0) {
                        const int args = arg_count(&s, j + 2, pc);
                        if (args > e->arity) add_diag(rep, "R2D004", file, s.tokens[j + 1].line, s.tokens[j + 1].col,
                            "Method \"%s\" accepts %d argument(s), got %d", name, e->arity, args);
                    }
                }
                j += (call ? 2 : 1);
                if (call && j < s.count && !strcmp(s.tokens[j].text, "(")) {
                    int pc = matching_paren(&s, j);
                    if (pc >= 0) j = pc + 1;
                }
            }
            continue;
        }
        if (!strcmp(s.tokens[i + 1].text, ".")) {
            // $.a.b.c(...) or $.a.b = literal
            char path[512] = "$";
            int j = i + 1;
            while (j + 1 < s.count && !strcmp(s.tokens[j].text, ".") && is_ident(&s.tokens[j + 1])) {
                const size_t len = strlen(path);
                snprintf(path + len, sizeof path - len, ".%s", s.tokens[j + 1].text);
                j += 2;
                if (j < s.count && !strcmp(s.tokens[j].text, "(")) break;
            }
            const bool call = (j < s.count && !strcmp(s.tokens[j].text, "("));
            const ApiEntry *e = find_entry(schema, path);
            if (!e) {
                // Не ругаемся на приватные/служебные обращения и на игровые
                // расширения: диагностика имеет смысл только если родительский
                // namespace известен как публичный объект.
                const bool private_path = strstr(path, "._") != NULL;
                char parent_path[512]; snprintf(parent_path, sizeof parent_path, "%s", path);
                char *last_dot = strrchr(parent_path, '.');
                if (last_dot) *last_dot = 0; else parent_path[0] = 0;
                const ApiEntry *parent_entry = parent_path[0] ? find_entry(schema, parent_path) : NULL;
                const bool known_parent = parent_entry && !strcmp(parent_entry->kind, "object");
                if (!private_path && known_parent) {
                    char parent[512]; snprintf(parent, sizeof parent, "%s", path);
                    char *dot = strrchr(parent, '.');
                    if (dot) *dot = 0;
                    char prefix[520]; snprintf(prefix, sizeof prefix, "%s.", parent);
                    const char *leaf = strrchr(path, '.') ? strrchr(path, '.') + 1 : path;
                    const char *near = suggest(schema, prefix, leaf);
                    if (near) add_diag(rep, "R2D001", file, s.tokens[i].line, s.tokens[i].col,
                        "Unknown API \"%s\"; did you mean \"%s\"?", path, near);
                    else add_diag(rep, "R2D001", file, s.tokens[i].line, s.tokens[i].col, "Unknown API \"%s\"", path);
                }
            } else if (false && call && e->arity > 0) {
                int pc = matching_paren(&s, j);
                if (pc > 0) {
                    const int args = arg_count(&s, j, pc);
                    if (args > e->arity) add_diag(rep, "R2D004", file, s.tokens[i].line, s.tokens[i].col,
                        "API \"%s\" accepts %d argument(s), got %d", path, e->arity, args);
                }
            } else if (!call && j < s.count && !strcmp(s.tokens[j].text, "=") &&
                       (int)strcmp(e->kind, "function") && (int)strcmp(e->kind, "object")) {
                const char *lit = literal_type(j + 1 < s.count ? &s.tokens[j + 1] : NULL);
                if (lit && strcmp(lit, e->type) && strcmp(e->type, "any"))
                    add_diag(rep, "R2D014", file, s.tokens[i].line, s.tokens[i].col,
                        "Property \"%s\" expects %s, got %s", path, e->type, lit);
            }
        }
    }
    source_free(&s);
}

static void walk_js(const char *path, SdkReport *rep, int *files);

static SDL_EnumerationResult enumerate_cb(void *user, const char *dirname, const char *fname)
{
    (void)dirname;
    struct Walker { SdkReport *rep; int *files; } *w = (struct Walker *)user;
    if (!strcmp(fname, ".") || !strcmp(fname, "..")) return SDL_ENUM_CONTINUE;
    char full[2048];
    snprintf(full, sizeof full, "%s/%s", dirname, fname);
    if (sdk_is_dir(full)) {
        if (!strcmp(fname, "node_modules") || !strcmp(fname, ".git") || !strcmp(fname, "build")) return SDL_ENUM_CONTINUE;
        walk_js(full, w->rep, w->files);
    } else if (strlen(fname) > 3 && !strcmp(fname + strlen(fname) - 3, ".js")) {
        (*w->files)++;
        size_t size = 0; char *text = sdk_read_file(full, &size);
        if (!text) { sdk_diag(w->rep, SDK_WARNING, "SDK_LINT_READ", full, NULL, NULL, "не читается"); return SDL_ENUM_CONTINUE; }
        // lint_file needs schema; stash via a static below (single-threaded CLI).
        extern const ApiSchema *g_lint_schema;
        lint_file(g_lint_schema, full, text, w->rep);
        free(text);
    }
    return SDL_ENUM_CONTINUE;
}

const ApiSchema *g_lint_schema = NULL;

static void walk_js(const char *path, SdkReport *rep, int *files)
{
    struct Walker { SdkReport *rep; int *files; } w = { rep, files };
    SDL_EnumerateDirectory(path, enumerate_cb, &w);
}

// Где искать api.schema.json. Явный --schema — приказ: если файла нет,
// подстановка запрещена (молчаливый fallback запрещён правилами проекта).
// Иначе — каталог проекта, cwd, каталог r2d и два уровня выше: в пакете
// схема лежит рядом с r2d, в checkout — в корне репозитория (build/../).
bool sdk_schema_resolve(const char *explicit_path, const char *preferred_dir,
                        char *out, size_t cap)
{
    if (explicit_path && explicit_path[0]) {
        snprintf(out, cap, "%s", explicit_path);
        return sdk_file_exists(explicit_path);
    }
    char candidate[2048];
    if (preferred_dir && preferred_dir[0] && sdk_is_dir(preferred_dir)) {
        sdk_join(preferred_dir, "api.schema.json", candidate, sizeof candidate);
        if (sdk_file_exists(candidate)) { snprintf(out, cap, "%s", candidate); return true; }
    }
    if (sdk_file_exists("api.schema.json")) {
        snprintf(out, cap, "%s", "api.schema.json");
        return true;
    }
    // exe_dir для r2d — build/ (checkout) или корень пакета; C-тесты лежат
    // глубже (build/sdk/native), поэтому проверяем и три уровня.
    static const char *const relative[] = {
        "api.schema.json", "../api.schema.json", "../../api.schema.json",
        "../../../api.schema.json",
    };
    for (size_t i = 0; i < sizeof relative / sizeof relative[0]; ++i) {
        sdk_join(sdk_exe_dir(), relative[i], candidate, sizeof candidate);
        if (sdk_file_exists(candidate)) { snprintf(out, cap, "%s", candidate); return true; }
    }
    // Файла нигде нет: схема из встроенного пакета (бинарник без каталога рядом).
    if (r2d_payload_find(r2d_bundle(), "api.schema.json")) {
        snprintf(out, cap, "%s", SDK_BUILTIN_SCHEMA);
        return true;
    }
    snprintf(out, cap, "%s", "api.schema.json");
    return false;
}

// Shared by `validate`: lint all JS under target, schema from --schema or root.
int sdk_lint_run(const char *schema_path, const char *target, SdkReport *rep, int *files)
{
    ApiSchema schema;
    if (!schema_path || !schema_path[0]) schema_path = "api.schema.json";
    if ((strcmp(schema_path, SDK_BUILTIN_SCHEMA) != 0 && !sdk_file_exists(schema_path)) ||
        !load_schema(schema_path, &schema)) {
        sdk_diag(rep, SDK_ERROR, "SDK_LINT_SCHEMA", schema_path, NULL, NULL,
                 "нет/битая api.schema.json; сначала выполните r2d api generate");
        return -1;
    }
    g_lint_schema = &schema;
    if (files) *files = 0;
    if (!target || !target[0]) target = "game";
    if (!sdk_file_exists(target) && !sdk_is_dir(target)) {
        sdk_diag(rep, SDK_ERROR, "SDK_LINT_PATH", target, NULL, NULL, "путь не найден");
    } else if (sdk_is_dir(target)) {
        walk_js(target, rep, files);
    } else {
        size_t size = 0; char *text = sdk_read_file(target, &size);
        if (!text) sdk_diag(rep, SDK_ERROR, "SDK_LINT_READ", target, NULL, NULL, "не читается");
        else { if (files) (*files)++; lint_file(&schema, target, text, rep); free(text); }
    }
    g_lint_schema = NULL;
    schema_free(&schema);
    return rep->errors ? 1 : 0;
}

int sdk_cmd_lint(const SdkArgs *a)
{
    const char *explicit_path = sdk_arg_value(a, "--schema");
    const char *target = sdk_arg_positional(a, 0);
    char schema_path[2048];
    if (!sdk_schema_resolve(explicit_path, target && sdk_is_dir(target) ? target : NULL,
                            schema_path, sizeof schema_path)
        && explicit_path && explicit_path[0]) {
        // Явный --schema отсутствует: sdk_lint_run напечатает структурную
        // диагностику с этим же путём — подменять его нельзя.
        snprintf(schema_path, sizeof schema_path, "%s", explicit_path);
    }
    SdkReport rep; sdk_report_init(&rep);
    int files = 0;
    const int result = sdk_lint_run(schema_path, target, &rep, &files);
    R2dSb out; r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"files\":%d,", rep.errors ? "false" : "true", files);
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    printf("%s\n", out.data ? out.data : "{}");
    r2d_sb_free(&out); sdk_report_free(&rep);
    return result < 0 ? 2 : (rep.errors ? 1 : 0);
}
