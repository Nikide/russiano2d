// ===========================================================================
// `r2d-sdk api` — machine-readable публичного $ API.
//
// Источник истины — живой runtime: `russiano2d --dump-api` обходит `$` и
// `engine.*` после загрузки скриптов. SDK не держит вторую рукописную копию
// списка методов; он только нормализует/проверяет снимок и (позже) генерирует
// schema/typings/docs.
// ===========================================================================
#include "sdk_api.h"

#include <SDL3/SDL.h>
#include <stdlib.h>
#include <string.h>

static const char *api_game(const SdkArgs *a)
{
    const char *game = sdk_arg_value(a, "--game");
    if (game && game[0]) return game;
    game = SDL_getenv("R2D_GAME");
    if (game && game[0]) return game;
    return "game";
}

static const char *find_json_object(const char *text)
{
    // Пакетный вывод двигателя может содержать журнал до/после JSON. Ищем
    // канонический объект снимка по уникальному началу.
    const char *p = text;
    const char *found = NULL;
    while ((p = strstr(p, "{\"schema_version\"")) != NULL) { found = p; ++p; }
    return found;
}

// Запускает runtime --dump-api и возвращает распарсенный снимок либо NULL.
R2dJson *sdk_api_snapshot(const SdkArgs *a, SdkReport *rep, char **raw_out)
{
    const char *engine_arg = sdk_arg_value(a, "--engine");
    char engine[1536];
    if (!sdk_find_engine(engine_arg, engine, sizeof engine)) {
        sdk_diag(rep, SDK_ERROR, "SDK_ENGINE_NOT_FOUND",
                 engine_arg ? engine_arg : "russiano2d", NULL, NULL,
                 "движок не найден; укажите --engine или R2D_ENGINE");
        return NULL;
    }
    const char *game = api_game(a);
    if (!sdk_is_dir(game)) {
        sdk_diag(rep, SDK_ERROR, "SDK_GAME_NOT_FOUND", game, NULL, NULL,
                 "каталог игры «%s» не найден (--game)", game);
        return NULL;
    }
    const char *argv[] = { engine, "--game", game, "--dump-api", NULL };
    SdkProcResult proc;
    if (!sdk_run_process(argv, &proc)) {
        sdk_diag(rep, SDK_ERROR, "SDK_API_RUNTIME", engine, NULL, NULL,
                 "не удалось запустить runtime: %s", SDL_GetError());
        return NULL;
    }
    if (proc.exit_code != 0) {
        sdk_diag(rep, SDK_ERROR, "SDK_API_RUNTIME", engine, NULL, NULL,
                 "runtime --dump-api завершился с кодом %d", proc.exit_code);
        sdk_proc_free(&proc);
        return NULL;
    }
    const char *json = find_json_object(proc.out ? proc.out : "");
    if (!json) {
        sdk_diag(rep, SDK_ERROR, "SDK_API_JSON", engine, NULL, NULL,
                 "runtime не вернул JSON снимка (stdout пуст или не JSON)");
        sdk_proc_free(&proc);
        return NULL;
    }
    char err[256];
    R2dJson *root = r2d_json_parse(json, err, sizeof err);
    if (!root) {
        sdk_diag(rep, SDK_ERROR, "SDK_API_JSON", engine, NULL, NULL,
                 "некорректный JSON снимка: %s", err);
    }
    if (raw_out) {
        size_t len = strlen(json);
        char *copy = (char *)malloc(len + 1);
        if (copy) memcpy(copy, json, len + 1);
        *raw_out = copy;
    }
    sdk_proc_free(&proc);
    return root;
}

static int cmd_api_dump(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    char *raw = NULL;
    R2dJson *root = sdk_api_snapshot(a, &rep, &raw);
    R2dSb out;
    r2d_sb_init(&out);
    if (!root) {
        r2d_sb_puts(&out, "{\"ok\":false,\"diagnostics\":[");
        // rep.items уже содержит объекты без внешних скобок
        if (rep.items.data) r2d_sb_puts(&out, rep.items.data);
        r2d_sb_puts(&out, "],");
        sdk_report_put_counts(&rep, &out);
        r2d_sb_putc(&out, '}');
        printf("%s\n", out.data ? out.data : "{}");
        r2d_sb_free(&out);
        sdk_report_free(&rep);
        free(raw);
        return 2;
    }
    // Печатаем снимок как есть, добавив ok перед schema_version.
    if (raw && strncmp(raw, "{\"schema_version\"", 17) == 0)
        printf("{\"ok\":true,%s\n", raw + 1);
    else
        printf("{\"ok\":true}\n");
    r2d_json_free(root);
    free(raw);
    r2d_sb_free(&out);
    sdk_report_free(&rep);
    return 0;
}

static int cmd_api_check(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    R2dJson *root = sdk_api_snapshot(a, &rep, NULL);
    if (!root) {
        R2dSb out; r2d_sb_init(&out);
        r2d_sb_puts(&out, "{\"ok\":false,\"diagnostics\":[");
        if (rep.items.data) r2d_sb_puts(&out, rep.items.data);
        r2d_sb_puts(&out, "],");
        sdk_report_put_counts(&rep, &out);
        r2d_sb_puts(&out, ",\"checked\":0,\"unique\":0}");
        printf("%s\n", out.data ? out.data : "{}");
        r2d_sb_free(&out); sdk_report_free(&rep); return 1;
    }
    const R2dJson *names = r2d_json_get(root, "names");
    const int count = names && names->type == R2D_JSON_ARR ? r2d_json_size(names) : -1;
    // Compare with the cached generated schema when it exists at the project
    // root (CI gate: generated artifacts must not be stale).
    const char *schema_arg = sdk_arg_value(a, "--schema");
    const char *schema_path = (schema_arg && schema_arg[0]) ? schema_arg : "api.schema.json";
    if (sdk_file_exists(schema_path)) {
        size_t size = 0; char *text = sdk_read_file(schema_path, &size);
        char err[128];
        R2dJson *cached = text ? r2d_json_parse(text, err, sizeof err) : NULL;
        if (!cached) {
            sdk_diag(&rep, SDK_ERROR, "SDK_API_SCHEMA_PARSE", schema_path, NULL, NULL, "cached schema не парсится");
        } else {
            const R2dJson *cnames = r2d_json_get(cached, "names");
            const int ccount = cnames && cnames->type == R2D_JSON_ARR ? r2d_json_size(cnames) : -1;
            if (ccount != count) {
                sdk_diag(&rep, SDK_ERROR, "SDK_API_SCHEMA_STALE", schema_path, NULL, NULL,
                         "schema содержит %d имён, runtime — %d; запустите r2d-sdk api generate", ccount, count);
            } else {
                for (int i = 0; i < count; ++i) {
                    const char *rp = r2d_json_str(r2d_json_get(r2d_json_at(names, i), "path"), "");
                    const char *cp = r2d_json_str(r2d_json_get(r2d_json_at(cnames, i), "path"), "");
                    if (strcmp(rp, cp)) {
                        sdk_diag(&rep, SDK_ERROR, "SDK_API_SCHEMA_STALE", schema_path, NULL, NULL,
                                 "schema расходится с runtime на names[%d]: «%s» vs «%s»", i, cp, rp);
                        break;
                    }
                }
            }
            r2d_json_free(cached);
        }
        free(text);
    }
    int duplicates = 0, bad = 0;
    char **seen = count > 0 ? (char **)calloc((size_t)count, sizeof *seen) : NULL;
    for (int i = 0; i < count; ++i) {
        const R2dJson *item = r2d_json_at(names, i);
        const char *path = r2d_json_str(r2d_json_get(item, "path"), NULL);
        const char *kind = r2d_json_str(r2d_json_get(item, "kind"), NULL);
        if (!path || !path[0]) { sdk_diag(&rep, SDK_ERROR, "SDK_API_PATH", NULL, NULL, NULL, "names[%d]: пустой path", i); bad++; continue; }
        if (!kind) { sdk_diag(&rep, SDK_ERROR, "SDK_API_KIND", path, NULL, NULL, "нет kind"); bad++; continue; }
        const bool known_kind = !strcmp(kind, "function") || !strcmp(kind, "object") ||
            !strcmp(kind, "number") || !strcmp(kind, "string") || !strcmp(kind, "boolean") ||
            !strcmp(kind, "array") || !strcmp(kind, "null");
        if (!known_kind) { sdk_diag(&rep, SDK_ERROR, "SDK_API_KIND", path, NULL, NULL, "неизвестный kind «%s»", kind); bad++; }
        if (!strcmp(kind, "function")) {
            const R2dJson *arity = r2d_json_get(item, "arity");
            const R2dJson *args = r2d_json_get(item, "args");
            if (!arity || arity->type != R2D_JSON_NUM || !args || args->type != R2D_JSON_ARR) {
                sdk_diag(&rep, SDK_ERROR, "SDK_API_DESCRIPTOR", path, NULL, NULL, "у function нужны arity и args[]"); bad++;
            } else if ((int)arity->number != r2d_json_size(args)) {
                sdk_diag(&rep, SDK_ERROR, "SDK_API_DESCRIPTOR", path, NULL, NULL, "arity=%g, но args=%d", arity->number, r2d_json_size(args)); bad++;
            }
            if (!r2d_json_get(item, "returns")) { sdk_diag(&rep, SDK_ERROR, "SDK_API_DESCRIPTOR", path, NULL, NULL, "у function нет returns"); bad++; }
        }
        for (int j = 0; j < i; ++j) if (seen[j] && !strcmp(seen[j], path)) {
            sdk_diag(&rep, SDK_ERROR, "SDK_API_DUPLICATE", path, NULL, NULL, "path повторяется (индексы %d и %d)", j, i);
            duplicates++; break;
        }
        seen[i] = (char *)path;
    }
    free(seen);
    R2dSb out; r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"ok\":");
    r2d_sb_puts(&out, (rep.errors == 0) ? "true" : "false");
    r2d_sb_puts(&out, ",\"checked\":");
    r2d_sb_printf(&out, "%d,\"duplicates\":%d,\"bad\":%d,", count, duplicates, bad);
    const R2dJson *ver = r2d_json_get(root, "engine_version");
    r2d_sb_puts(&out, "\"engine_version\":");
    r2d_sb_put_json_string(&out, r2d_json_str(ver, ""));
    r2d_sb_puts(&out, ",");
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    printf("%s\n", out.data ? out.data : "{}");
    const int rc = rep.errors ? 1 : 0;
    r2d_sb_free(&out); r2d_json_free(root); sdk_report_free(&rep);
    return rc;
}


static bool ident_ok(const char *s)
{
    if (!s || !s[0]) return false;
    for (const unsigned char *p = (const unsigned char *)s; *p; ++p)
        if (!(isalnum(*p) || *p == '_' || *p == '$' || *p == '.')) return false;
    return true;
}

static const char *type_of(const R2dJson *item)
{
    const char *kind = r2d_json_str(r2d_json_get(item, "kind"), "any");
    if (!strcmp(kind, "number")) return "number";
    if (!strcmp(kind, "string")) return "string";
    if (!strcmp(kind, "boolean")) return "boolean";
    if (!strcmp(kind, "array")) return "any[]";
    if (!strcmp(kind, "function")) return "Function";
    if (!strcmp(kind, "object")) return "Record<string, any>";
    return "any";
}

// api.schema.json: deterministic normalized snapshot with the settings the
// generator/linter need. The runtime dump is still the source; this is a cached
// artifact, and `api check` fails when it is stale.
void sdk_api_schema_text(const R2dJson *root, R2dSb *out)
{
    r2d_sb_puts(out, "{\n  \"schema_version\": 1,\n  \"generated_by\": \"r2d-sdk\",\n  \"engine_version\": ");
    r2d_sb_put_json_string(out, r2d_json_str(r2d_json_get(root, "engine_version"), ""));
    r2d_sb_puts(out, ",\n  \"names\": [\n");
    const R2dJson *names = r2d_json_get(root, "names");
    for (int i = 0; i < r2d_json_size(names); ++i) {
        const R2dJson *item = r2d_json_at(names, i);
        if (i) r2d_sb_puts(out, ",\n");
        r2d_sb_puts(out, "    {\"path\": ");
        r2d_sb_put_json_string(out, r2d_json_str(r2d_json_get(item, "path"), ""));
        r2d_sb_puts(out, ", \"kind\": ");
        r2d_sb_put_json_string(out, r2d_json_str(r2d_json_get(item, "kind"), "any"));
        const R2dJson *arity = r2d_json_get(item, "arity");
        if (arity) r2d_sb_printf(out, ", \"arity\": %d", (int)arity->number);
        const R2dJson *args = r2d_json_get(item, "args");
        if (args && args->type == R2D_JSON_ARR) {
            r2d_sb_puts(out, ", \"args\": [");
            for (int a = 0; a < r2d_json_size(args); ++a) {
                const R2dJson *arg = r2d_json_at(args, a);
                r2d_sb_printf(out, "%s{\"name\": ", a ? ", " : "");
                r2d_sb_put_json_string(out, r2d_json_str(r2d_json_get(arg, "name"), "arg"));
                r2d_sb_puts(out, ", \"type\": ");
                r2d_sb_put_json_string(out, r2d_json_str(r2d_json_get(arg, "type"), "any"));
                r2d_sb_putc(out, '}');
            }
            r2d_sb_putc(out, ']');
        }
        const R2dJson *returns = r2d_json_get(item, "returns");
        if (returns) { r2d_sb_puts(out, ", \"returns\": "); r2d_sb_put_json_string(out, r2d_json_str(returns, "any")); }
        const R2dJson *value = r2d_json_get(item, "value");
        if (value) {
            r2d_sb_puts(out, ", \"value\": ");
            if (value->type == R2D_JSON_ARR) r2d_sb_puts(out, "[]");
            else if (value->type == R2D_JSON_STR) r2d_sb_put_json_string(out, value->string);
            else if (value->type == R2D_JSON_BOOL) r2d_sb_puts(out, value->boolean ? "true" : "false");
            else if (value->type == R2D_JSON_NUM) r2d_sb_printf(out, "%g", value->number);
            else r2d_sb_puts(out, "null");
        }
        r2d_sb_putc(out, '}');
    }
    r2d_sb_puts(out, "\n  ]\n}\n");
}

// Group methods of a namespace into a TypeScript interface. `prefix` is e.g.
// "$.fn."; `iface` gets members without the prefix.
static void dts_namespace(const R2dJson *names, const char *prefix, const char *iface, R2dSb *out, bool node_methods)
{
    r2d_sb_printf(out, "interface %s {\n", iface);
    const size_t plen = strlen(prefix);
    int emitted = 0;
    for (int i = 0; i < r2d_json_size(names); ++i) {
        const R2dJson *item = r2d_json_at(names, i);
        const char *path = r2d_json_str(r2d_json_get(item, "path"), "");
        if (strncmp(path, prefix, plen) != 0) continue;
        const char *rest = path + plen;
        if (!rest[0] || strchr(rest, '.')) continue;
        if (!ident_ok(rest)) continue;
        const char *kind = r2d_json_str(r2d_json_get(item, "kind"), "any");
        if (!strcmp(kind, "function")) {
            const R2dJson *arity = r2d_json_get(item, "arity");
            const int n = arity ? (int)arity->number : 0;
            r2d_sb_printf(out, "    %s(", rest);
            for (int a = 0; a < n; ++a) r2d_sb_printf(out, "%sarg%d: any", a ? ", " : "", a);
            r2d_sb_printf(out, "): %s;\n", node_methods ? "R2DNode" : "any");
        } else if (!strcmp(kind, "object")) {
            r2d_sb_printf(out, "    %s: Record<string, any>;\n", rest);
        } else {
            r2d_sb_printf(out, "    %s: %s;\n", rest, type_of(item));
        }
        emitted++;
    }
    (void)emitted;
    r2d_sb_puts(out, "}\n");
}

void sdk_api_dts_text(const R2dJson *root, R2dSb *out)
{
    const R2dJson *names = r2d_json_get(root, "names");
    r2d_sb_puts(out,
        "// GENERATED FILE — DO NOT EDIT MANUALLY\n"
        "// Source: Russiano2D $ API Registry\n"
        "// Generator: r2d-sdk\n"
        "// Run: r2d-sdk api generate\n\n"
        "declare interface R2DNode {\n"
        "    [key: string]: any;\n");
    // Node methods ($.fn.*) make the selector wrapper useful.
    const size_t fplen = 4; // "$.fn"
    for (int i = 0; i < r2d_json_size(names); ++i) {
        const R2dJson *item = r2d_json_at(names, i);
        const char *path = r2d_json_str(r2d_json_get(item, "path"), "");
        if (strncmp(path, "$.fn.", fplen + 1) != 0) continue;
        const char *rest = path + fplen + 1;
        if (!ident_ok(rest) || strchr(rest, '.')) continue;
        const char *kind = r2d_json_str(r2d_json_get(item, "kind"), "any");
        if (!strcmp(kind, "function")) {
            const R2dJson *arity = r2d_json_get(item, "arity");
            const int n = arity ? (int)arity->number : 0;
            r2d_sb_printf(out, "    %s(", rest);
            for (int a = 0; a < n; ++a) r2d_sb_printf(out, "%sarg%d: any", a ? ", " : "", a);
            r2d_sb_puts(out, "): any;\n");
        } else if (strcmp(kind, "object")) {
            r2d_sb_printf(out, "    %s: %s;\n", rest, type_of(item));
        }
    }
    r2d_sb_puts(out, "}\n\n");
    // Namespaces: all first-level $.objects (except internal _ names).
    for (int i = 0; i < r2d_json_size(names); ++i) {
        const R2dJson *item = r2d_json_at(names, i);
        const char *path = r2d_json_str(r2d_json_get(item, "path"), "");
        if (strncmp(path, "$.", 2) != 0) continue;
        const char *name = path + 2;
        if (!name[0] || name[0] == '_' || strchr(name, '.')) continue;
        if (strcmp(r2d_json_str(r2d_json_get(item, "kind"), ""), "object") != 0) continue;
        char iface[256];
        snprintf(iface, sizeof iface, "R2D_%s", name);
        for (char *q = iface; *q; ++q) if (!(isalnum((unsigned char)*q) || *q == '_')) *q = '_';
        char prefix[256];
        snprintf(prefix, sizeof prefix, "$.%s.", name);
        dts_namespace(names, prefix, iface, out, false);
        r2d_sb_putc(out, '\n');
    }
    // Globals.
    r2d_sb_puts(out, "declare interface R2DGlobal {\n");
    for (int i = 0; i < r2d_json_size(names); ++i) {
        const R2dJson *item = r2d_json_at(names, i);
        const char *path = r2d_json_str(r2d_json_get(item, "path"), "");
        if (strncmp(path, "$.", 2) != 0) continue;
        const char *name = path + 2;
        if (!name[0] || name[0] == '_' || strchr(name, '.')) continue;
        if (!ident_ok(name)) continue;
        const char *kind = r2d_json_str(r2d_json_get(item, "kind"), "any");
        if (!strcmp(kind, "function")) {
            const R2dJson *arity = r2d_json_get(item, "arity");
            const int n = arity ? (int)arity->number : 0;
            r2d_sb_printf(out, "    %s(", name);
            for (int a = 0; a < n; ++a) r2d_sb_printf(out, "%sarg%d: any", a ? ", " : "", a);
            r2d_sb_puts(out, "): any;\n");
        } else if (!strcmp(kind, "object")) {
            r2d_sb_printf(out, "    %s: R2D_%s;\n", name, name);
        } else {
            r2d_sb_printf(out, "    %s: %s;\n", name, type_of(item));
        }
    }
    r2d_sb_puts(out, "}\n\n"
        "declare const $: R2DGlobal & ((selector: string) => R2DNode);\n"
        "declare const engine: Record<string, any>;\n"
        "declare const __R2D_API_VERSION: string;\n");
}


// Generated API reference: structural (names/types/arity). Descriptions/since/
// examples live in the registry/hand docs and are not invented here.
void sdk_api_docs_text(const R2dJson *root, R2dSb *out)
{
    const R2dJson *names = r2d_json_get(root, "names");
    r2d_sb_puts(out,
        "# Russiano2D $ API reference\n\n"
        "<!-- GENERATED FILE - DO NOT EDIT MANUALLY\n"
        "     Source: Russiano2D $ API Registry\n"
        "     Generator: r2d-sdk -->\n\n"
        "Engine version: ");
    r2d_sb_put_json_string(out, r2d_json_str(r2d_json_get(root, "engine_version"), ""));
    r2d_sb_printf(out, "\n\nEntries: %d\n\n", r2d_json_size(names));
    // Collect unique parent paths and emit one section per parent.
    char **parents = (char **)calloc((size_t)r2d_json_size(names), sizeof *parents);
    int np = 0;
    for (int i = 0; i < r2d_json_size(names); ++i) {
        const char *path = r2d_json_str(r2d_json_get(r2d_json_at(names, i), "path"), "");
        const char *dot = strrchr(path, '.');
        if (!dot) continue;
        if (strstr(path, "._")) continue;
        char parent[512];
        const size_t len = (size_t)(dot - path);
        if (len >= sizeof parent) continue;
        memcpy(parent, path, len); parent[len] = 0;
        bool seen = false;
        for (int j = 0; j < np; ++j) if (!strcmp(parents[j], parent)) { seen = true; break; }
        if (seen) continue;
        parents[np] = (char *)malloc(len + 1);
        if (!parents[np]) continue;
        memcpy(parents[np], parent, len + 1); np++;
    }
    for (int i = 0; i < np; ++i) for (int j = i + 1; j < np; ++j)
        if (strcmp(parents[i], parents[j]) > 0) { char *t = parents[i]; parents[i] = parents[j]; parents[j] = t; }
    for (int s = 0; s < np; ++s) {
        r2d_sb_printf(out, "## %s\n\n| Name | Kind | Signature / value |\n|---|---|---|\n", parents[s]);
        const size_t plen = strlen(parents[s]);
        for (int i = 0; i < r2d_json_size(names); ++i) {
            const R2dJson *item = r2d_json_at(names, i);
            const char *path = r2d_json_str(r2d_json_get(item, "path"), "");
            if (strncmp(path, parents[s], plen) != 0 || path[plen] != '.') continue;
            const char *leaf = path + plen + 1;
            if (strchr(leaf, '.') || leaf[0] == '_') continue;
            const char *kind = r2d_json_str(r2d_json_get(item, "kind"), "any");
            r2d_sb_printf(out, "| `%s` | %s | ", leaf, kind);
            if (!strcmp(kind, "function")) {
                const R2dJson *arity = r2d_json_get(item, "arity");
                const int n = arity ? (int)arity->number : 0;
                r2d_sb_puts(out, "`(");
                for (int a = 0; a < n; ++a) r2d_sb_printf(out, "%sarg%d: any", a ? ", " : "", a);
                r2d_sb_puts(out, ") -> any`");
            } else {
                const R2dJson *value = r2d_json_get(item, "value");
                if (value) {
                    if (value->type == R2D_JSON_STR) { r2d_sb_putc(out, '`'); r2d_sb_puts(out, value->string); r2d_sb_putc(out, '`'); }
                    else if (value->type == R2D_JSON_BOOL) r2d_sb_puts(out, value->boolean ? "`true`" : "`false`");
                    else if (value->type == R2D_JSON_NUM) r2d_sb_printf(out, "`%g`", value->number);
                    else r2d_sb_puts(out, "—");
                } else r2d_sb_puts(out, "—");
            }
            r2d_sb_puts(out, " |\n");
        }
        r2d_sb_putc(out, '\n');
    }
    for (int i = 0; i < np; ++i) free(parents[i]);
    free(parents);
}

int cmd_docs_generate(const SdkArgs *a)
{
    SdkReport rep; sdk_report_init(&rep);
    R2dJson *root = sdk_api_snapshot(a, &rep, NULL);
    if (!root) { sdk_report_free(&rep); return 2; }
    const char *dir = sdk_arg_value(a, "--out-dir");
    if (!dir || !dir[0]) dir = ".";
    char api_dir[2048], path[2048];
    snprintf(api_dir, sizeof api_dir, "%s/docs/api", dir);
    SDL_CreateDirectory(api_dir);
    snprintf(path, sizeof path, "%s/API_REFERENCE.md", api_dir);
    R2dSb sb; r2d_sb_init(&sb);
    sdk_api_docs_text(root, &sb);
    const bool ok = sdk_write_file(path, sb.data, sb.len);
    char docs_dir[2048], docs_path[2048];
    snprintf(docs_dir, sizeof docs_dir, "%s/docs/api", dir);
    SDL_CreateDirectory(docs_dir);
    snprintf(docs_path, sizeof docs_path, "%s/API_REFERENCE.md", docs_dir);
    r2d_sb_free(&sb); r2d_sb_init(&sb);
    sdk_api_docs_text(root, &sb);
    const bool docs_ok = sdk_write_file(docs_path, sb.data, sb.len);
    const int count = r2d_json_size(r2d_json_get(root, "names"));
    r2d_sb_free(&sb);
    R2dSb out; r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"docs\":", ok ? "true" : "false");
    r2d_sb_put_json_string(&out, path);
    r2d_sb_printf(&out, ",\"names\":%d,\"engine_version\":", count);
    r2d_sb_put_json_string(&out, r2d_json_str(r2d_json_get(root, "engine_version"), ""));
    r2d_sb_putc(&out, '}');
    printf("%s\n", out.data ? out.data : "{}");
    r2d_sb_free(&out); r2d_json_free(root); sdk_report_free(&rep);
    return ok ? 0 : 2;
}

static int cmd_api_generate(const SdkArgs *a)
{
    SdkReport rep; sdk_report_init(&rep);
    R2dJson *root = sdk_api_snapshot(a, &rep, NULL);
    if (!root) {
        SdkReport *rp = &rep;
        R2dSb out; r2d_sb_init(&out);
        r2d_sb_puts(&out, "{\"ok\":false,\"diagnostics\":[");
        if (rp->items.data) r2d_sb_puts(&out, rp->items.data);
        r2d_sb_puts(&out, "],"); sdk_report_put_counts(rp, &out); r2d_sb_puts(&out, "}");
        printf("%s\n", out.data ? out.data : "{}");
        r2d_sb_free(&out); sdk_report_free(&rep); return 2;
    }
    const char *dir = sdk_arg_value(a, "--out-dir");
    if (!dir || !dir[0]) dir = ".";
    char schema_path[2048], dts_path[2048];
    snprintf(schema_path, sizeof schema_path, "%s/api.schema.json", dir);
    snprintf(dts_path, sizeof dts_path, "%s/russiano2d.d.ts", dir);
    if (!sdk_is_dir(dir)) SDL_CreateDirectory(dir);
    R2dSb sb; r2d_sb_init(&sb);
    sdk_api_schema_text(root, &sb);
    const bool schema_ok = sdk_write_file(schema_path, sb.data, sb.len);
    r2d_sb_free(&sb); r2d_sb_init(&sb);
    sdk_api_dts_text(root, &sb);
    const bool dts_ok = sdk_write_file(dts_path, sb.data, sb.len);
    char docs_dir[2048], docs_path[2048];
    snprintf(docs_dir, sizeof docs_dir, "%s/docs/api", dir);
    SDL_CreateDirectory(docs_dir);
    snprintf(docs_path, sizeof docs_path, "%s/API_REFERENCE.md", docs_dir);
    r2d_sb_free(&sb); r2d_sb_init(&sb);
    sdk_api_docs_text(root, &sb);
    const bool docs_ok = sdk_write_file(docs_path, sb.data, sb.len);
    const int count = r2d_json_size(r2d_json_get(root, "names"));
    r2d_sb_free(&sb);
    R2dSb out; r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"engine_version\":", (schema_ok && dts_ok && docs_ok) ? "true" : "false");
    r2d_sb_put_json_string(&out, r2d_json_str(r2d_json_get(root, "engine_version"), ""));
    r2d_sb_printf(&out, ",\"names\":%d,\"schema\":", count);
    r2d_sb_put_json_string(&out, schema_path);
    r2d_sb_puts(&out, ",\"typings\":");
    r2d_sb_put_json_string(&out, dts_path);
    r2d_sb_puts(&out, ",\"docs\":");
    r2d_sb_put_json_string(&out, docs_path);
    r2d_sb_puts(&out, "}");
    printf("%s\n", out.data ? out.data : "{}");
    const int rc = (schema_ok && dts_ok && docs_ok) ? 0 : 2;
    r2d_sb_free(&out); r2d_json_free(root); sdk_report_free(&rep);
    return rc;
}

int sdk_cmd_api(const SdkArgs *a)
{
    const char *sub = sdk_arg_positional(a, 0);
    if (!sub) {
        SdkReport rep; sdk_report_init(&rep);
        const int rc = sdk_fail(&rep, "SDK_USAGE",
            "Использование: r2d-sdk api <dump|check|generate> [--game каталог] [--engine путь] [--json]");
        sdk_report_free(&rep); return rc;
    }
    if (!strcmp(sub, "dump")) return cmd_api_dump(a);
    if (!strcmp(sub, "check")) return cmd_api_check(a);
    if (!strcmp(sub, "generate")) return cmd_api_generate(a);
    SdkReport rep; sdk_report_init(&rep);
    const int rc = sdk_fail(&rep, "SDK_USAGE", "Неизвестная подкоманда api: %s", sub);
    sdk_report_free(&rep); return rc;
}
