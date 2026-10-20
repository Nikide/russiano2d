// ===========================================================================
// `r2d-sdk doctor` — один health check для CLI/CI/GUI/агента:
// runtime + API metadata + generated artifacts freshness + project + lint.
// ===========================================================================
#include "sdk_api.h"

#include <SDL3/SDL.h>
#include <stdlib.h>
#include <string.h>

typedef struct { const char *name; bool ok; char detail[512]; } Check;

static bool file_equals(const char *path, const char *text, size_t len)
{
    size_t size = 0;
    char *disk = sdk_read_file(path, &size);
    if (!disk) return false;
    const bool same = size == len && !memcmp(disk, text, len);
    free(disk);
    return same;
}

static bool schema_matches(const R2dJson *root, const char *path)
{
    size_t size = 0;
    char *text = sdk_read_file(path, &size);
    if (!text) return false;
    char err[128];
    R2dJson *cached = r2d_json_parse(text, err, sizeof err);
    free(text);
    if (!cached) return false;
    const R2dJson *a = r2d_json_get(root, "names");
    const R2dJson *b = r2d_json_get(cached, "names");
    bool same = a && b && r2d_json_size(a) == r2d_json_size(b);
    for (int i = 0; same && i < r2d_json_size(a); ++i) {
        const char *pa = r2d_json_str(r2d_json_get(r2d_json_at(a, i), "path"), "");
        const char *pb = r2d_json_str(r2d_json_get(r2d_json_at(b, i), "path"), "");
        same = !strcmp(pa, pb);
    }
    r2d_json_free(cached);
    return same;
}

static void add(Check *c, int *n, const char *name, bool ok, const char *fmt, ...)
{
    Check *x = &c[(*n)++];
    x->name = name; x->ok = ok;
    va_list ap; va_start(ap, fmt); vsnprintf(x->detail, sizeof x->detail, fmt, ap); va_end(ap);
}

int sdk_cmd_doctor(const SdkArgs *a)
{
    const char *project = sdk_arg_value(a, "--project");
    if (!project || !project[0]) project = "game";
    // Схема — от --schema или рядом с r2d-sdk/проектом: doctor в установленном
    // пакете запускают из любого каталога.
    const char *explicit_schema = sdk_arg_value(a, "--schema");
    char schema[2048];
    if (!sdk_schema_resolve(explicit_schema, project, schema, sizeof schema)) {
        snprintf(schema, sizeof schema, "%s", "api.schema.json");
    }
    SdkReport rep; sdk_report_init(&rep);
    Check checks[16]; int n = 0;

    char engine[1536];
    const bool engine_ok = sdk_find_engine(sdk_arg_value(a, "--engine"), engine, sizeof engine);
    R2dJson *root = NULL;
    if (engine_ok) root = sdk_api_snapshot(a, &rep, NULL);
    add(checks, &n, "runtime", engine_ok && root != NULL,
        engine_ok ? "%s" : "russiano2d не найден (--engine/R2D_ENGINE)", engine);
    add(checks, &n, "api_metadata", root != NULL, root ? "%d names" : "metadata dump не получен",
        root ? r2d_json_size(r2d_json_get(root, "names")) : 0);

    if (root) {
        const bool schema_ok = schema_matches(root, schema);
        add(checks, &n, "schema", schema_ok,
            "%s %s", schema, schema_ok ? "up to date" : "STALE (api generate)");
        R2dSb sb; r2d_sb_init(&sb);
        sdk_api_dts_text(root, &sb);
        const bool dts_ok = file_equals("russiano2d.d.ts", sb.data, sb.len);
        r2d_sb_free(&sb); r2d_sb_init(&sb);
        sdk_api_docs_text(root, &sb);
        const bool docs_ok = file_equals("docs/api/API_REFERENCE.md", sb.data, sb.len);
        r2d_sb_free(&sb);
        add(checks, &n, "typings", dts_ok, "russiano2d.d.ts %s", dts_ok ? "up to date" : "STALE (api generate)");
        add(checks, &n, "docs", docs_ok, "docs/api/API_REFERENCE.md %s", docs_ok ? "up to date" : "STALE (docs generate)");
    } else {
        add(checks, &n, "schema", false, "нет metadata");
        add(checks, &n, "typings", false, "нет metadata");
        add(checks, &n, "docs", false, "нет metadata");
    }

    SdkReport project_rep; sdk_report_init(&project_rep);
    // В project_validate передаём именно --schema (NULL — пусть ищет сам):
    // иначе при отсутствии схемы диагностика ссылалась бы на несуществующий ключ.
    sdk_project_validate(project, explicit_schema, &project_rep);
    add(checks, &n, "project", project_rep.errors == 0,
        "%s: errors=%d warnings=%d", project, project_rep.errors, project_rep.warnings);
    for (int i = 0; i < project_rep.count; ++i) {
        // merge project diagnostics into the doctor report
        switch (project_rep.items.data ? 0 : 0) { default: break; }
    }
    // Copy diagnostics by re-running into the main report would duplicate; use a
    // second report is enough for the check, but agents need exact diagnostics.
    int lint_files = 0;
    SdkReport lint_rep; sdk_report_init(&lint_rep);
    sdk_lint_run(schema, project, &lint_rep, &lint_files);
    add(checks, &n, "lint", lint_rep.errors == 0, "%s: files=%d errors=%d", project, lint_files, lint_rep.errors);

    R2dSb out; r2d_sb_init(&out);
    bool all = true;
    for (int i = 0; i < n; ++i) all = all && checks[i].ok;
    bool project_failed = project_rep.errors != 0;
    bool lint_failed = lint_rep.errors != 0;
    r2d_sb_printf(&out, "{\"ok\":%s,\"checks\":[", all && !project_failed && !lint_failed ? "true" : "false");
    for (int i = 0; i < n; ++i) {
        r2d_sb_printf(&out, "%s{\"name\":", i ? "," : "");
        r2d_sb_put_json_string(&out, checks[i].name);
        r2d_sb_printf(&out, ",\"ok\":%s,\"detail\":", checks[i].ok ? "true" : "false");
        r2d_sb_put_json_string(&out, checks[i].detail);
        r2d_sb_putc(&out, '}');
    }
    r2d_sb_puts(&out, "],\"diagnostics\":[");
    bool first = true;
    // Concatenate project/lint diagnostics JSON objects.
    if (project_rep.items.data && project_rep.items.data[0]) { r2d_sb_puts(&out, project_rep.items.data); first = false; }
    if (lint_rep.items.data && lint_rep.items.data[0]) {
        if (!first) r2d_sb_putc(&out, ',');
        r2d_sb_puts(&out, lint_rep.items.data);
    }
    r2d_sb_puts(&out, "],");
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, '}');
    printf("%s\n", out.data ? out.data : "{}");
    const bool ok = all && !project_failed && !lint_failed;
    r2d_sb_free(&out); r2d_json_free(root); sdk_report_free(&rep);
    sdk_report_free(&project_rep); sdk_report_free(&lint_rep);
    return ok ? 0 : 1;
}
