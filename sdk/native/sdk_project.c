// ===========================================================================
// `r2d validate` в режиме проекта: project.json, main.js, JS API lint,
// ссылки на ассеты и структурная валидация известных файлов. Один backend для
// CLI, GUI и агента.
// ===========================================================================
#include "sdk.h"

#include <SDL3/SDL.h>
#include <ctype.h>
#include <stdlib.h>
#include <string.h>

typedef struct { const char *root; SdkReport *rep; int files; } PV;

static bool has_ext(const char *path, const char *ext)
{
    const size_t n = strlen(path), m = strlen(ext);
    return n > m && !strcmp(path + n - m, ext);
}

static bool known_asset_ext(const char *s)
{
    static const char *const exts[] = {
        ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif",
        ".wav", ".ogg", ".mp3", ".ttf", ".otf",
        ".atlas.json", ".tilemap.json", ".particles.json", ".collision.json",
        ".layers.json", ".audio.json", ".input.json", ".rml", ".rcss",
        ".re2dworld", ".re2dmap", ".json", ".js"
    };
    for (size_t i = 0; i < sizeof exts / sizeof exts[0]; ++i)
        if (has_ext(s, exts[i])) return true;
    return false;
}

static void check_ref(PV *pv, const char *from, const char *ref)
{
    if (!ref || !ref[0]) return;
    if (ref[0] == '#' || ref[0] == '/' || ref[0] == '\\') return;
    if (!strncmp(ref, "http://", 7) || !strncmp(ref, "https://", 8) || !strncmp(ref, "data:", 5)) return;
    if (strstr(ref, "{{") || strchr(ref, '$')) return;
    if (!known_asset_ext(ref)) return;
    char cand[2048];
    snprintf(cand, sizeof cand, "%s/%s", pv->root, ref);
    if (sdk_file_exists(cand)) return;
    char dir[1024]; sdk_dirname(from, dir, sizeof dir);
    snprintf(cand, sizeof cand, "%s/%s", dir, ref);
    if (sdk_file_exists(cand)) return;
    sdk_diag(pv->rep, SDK_ERROR, "R2D100", from, NULL, NULL,
             "Missing asset \"%s\" (project root %s)", ref, pv->root);
}

static void scan_text_refs(PV *pv, const char *path)
{
    size_t size = 0;
    char *text = sdk_read_file(path, &size);
    if (!text) return;
    const char *p = text;
    while ((p = strchr(p, '"')) != NULL) {
        const char *start = ++p;
        while (*p && *p != '"') { if (*p == '\\' && p[1]) p++; p++; }
        if (!*p) break;
        size_t len = (size_t)(p - start);
        if (len > 0 && len < 512) {
            char buf[520];
            memcpy(buf, start, len); buf[len] = 0;
            // RML/RCSS attributes and JS string literals both end up here; only
            // strings that look like asset paths are checked.
            if (strchr(buf, '/') || known_asset_ext(buf)) check_ref(pv, path, buf);
        }
        p++;
    }
    free(text);
}

static SDL_EnumerationResult project_cb(void *user, const char *dir, const char *name)
{
    PV *pv = (PV *)user;
    if (!strcmp(name, ".") || !strcmp(name, "..")) return SDL_ENUM_CONTINUE;
    if (!strcmp(name, "node_modules") || !strcmp(name, ".git") || !strcmp(name, "build") ||
        !strcmp(name, "dist") || !strcmp(name, ".cache")) return SDL_ENUM_CONTINUE;
    char full[2048];
    snprintf(full, sizeof full, "%s/%s", dir, name);
    if (sdk_is_dir(full)) {
        SDL_EnumerateDirectory(full, project_cb, pv);
        return SDL_ENUM_CONTINUE;
    }
    pv->files++;
    if (has_ext(name, ".js") || has_ext(name, ".rml") || has_ext(name, ".rcss") ||
        has_ext(name, ".json") || has_ext(name, ".re2dmap")) {
        scan_text_refs(pv, full);
    }
    if (has_ext(name, ".rml") || has_ext(name, ".rcss") || has_ext(name, ".atlas.json") ||
        has_ext(name, ".tilemap.json") || has_ext(name, ".particles.json") ||
        has_ext(name, ".collision.json") || has_ext(name, ".layers.json") ||
        has_ext(name, ".audio.json") || has_ext(name, ".input.json") ||
        has_ext(name, ".re2dmap")) {
        sdk_validate_file(full, NULL, pv->rep);
    }
    return SDL_ENUM_CONTINUE;
}

void sdk_project_validate(const char *dir, const char *schema_path, SdkReport *rep)
{
    char project[2048];
    snprintf(project, sizeof project, "%s/project.json", dir);
    if (!sdk_file_exists(project)) {
        sdk_diag(rep, SDK_ERROR, "R2D200", project, NULL, NULL,
                 "project.json не найден в «%s»", dir);
        return;
    }
    sdk_validate_file(project, "project", rep);
    // project.json v2 сам проверяет свою точку входа (R2D202).
    bool v2 = false;
    {
        size_t size = 0;
        char *text = sdk_read_file(project, &size);
        if (text) {
            char err[128];
            R2dJson *root = r2d_json_parse(text, err, sizeof err);
            v2 = root && r2d_json_num(r2d_json_get(root, "format"), 1) == 2;
            r2d_json_free(root);
            free(text);
        }
    }
    char main_js[2048];
    snprintf(main_js, sizeof main_js, "%s/main.js", dir);
    if (!v2 && !sdk_file_exists(main_js)) {
        sdk_diag(rep, SDK_ERROR, "R2D100", dir, NULL, NULL,
                 "нет main.js — проект не запустится");
    }
    int files = 0;
    // Схема ищется от проекта/cwd/каталога r2d: validate обязан работать из
    // любого каталога в установленном пакете. Явный --schema не подменяется.
    char schema[2048];
    if (sdk_schema_resolve(schema_path, dir, schema, sizeof schema)) {
        sdk_lint_run(schema, dir, rep, &files);
    } else if (schema_path && schema_path[0]) {
        sdk_diag(rep, SDK_ERROR, "SDK_LINT_SCHEMA", schema_path, NULL, NULL,
                 "файл схемы из --schema не найден: %s", schema_path);
    } else {
        sdk_diag(rep, SDK_ERROR, "SDK_LINT_SCHEMA", schema, NULL,
                 "{\"searched\":[\"<project>/api.schema.json\",\"api.schema.json\",\"<r2d>/api.schema.json\"]}",
                 "api.schema.json не найден: проверены каталог проекта «%s», cwd и каталог r2d (%s); укажите --schema",
                 dir, sdk_exe_dir());
    }
    PV pv = { dir, rep, 0 };
    SDL_EnumerateDirectory(dir, project_cb, &pv);
}

// ---------------------------------------------------------------------------
// migrate-project [каталог] [--write]: project.json v1 → v2. Без --write только
// печатает результат. Индекс сцен берётся из $.scene.add(...) в скриптах;
// scenes.start не угадывается — его выбирает автор.
// ---------------------------------------------------------------------------
int sdk_cmd_migrate_project(const SdkArgs *a)
{
    const char *dir = sdk_arg_positional(a, 0);
    if (!dir) dir = ".";
    const bool write = sdk_arg_flag(a, "--write");
    SdkReport rep;
    sdk_report_init(&rep);

    char path[2048];
    snprintf(path, sizeof path, "%s/project.json", dir);
    R2dSb text;
    r2d_sb_init(&text);
    bool changed = false;

    R2dJson *root = NULL;
    if (!sdk_file_exists(path)) {
        sdk_diag(&rep, SDK_ERROR, "R2D200", path, NULL, NULL, "project.json не найден в «%s»", dir);
    } else if ((root = sdk_load_json(path, &rep)) != NULL && root->type != R2D_JSON_OBJ) {
        sdk_diag(&rep, SDK_ERROR, "SDK_PROJECT_ROOT", path, NULL, NULL, "project.json должен быть объектом");
    } else if (root && r2d_json_num(r2d_json_get(root, "format"), 1) == 2) {
        // Уже v2: ничего не делаем.
    } else if (root) {
        char names[256][128];
        int n = sdk_project_scenes(dir, names, 256);
        r2d_sb_puts(&text, "{\n  \"format\": 2");
        for (int i = 0; i < root->count; ++i) {
            const char *k = root->keys[i];
            if (!strcmp(k, "format") || !strcmp(k, "entry") || !strcmp(k, "scenes") || !strcmp(k, "roles")) continue;
            r2d_sb_puts(&text, ",\n  ");
            r2d_sb_put_json_string(&text, k);
            r2d_sb_puts(&text, ": ");
            sdk_json_put_compact(&text, root->items[i]);
        }
        r2d_sb_puts(&text, ",\n  \"entry\": \"main.js\",\n  \"scenes\": { \"list\": [");
        int written = 0;
        for (int i = 0; i < n; ++i) {
            bool dup = false;
            for (int j = 0; j < i && !dup; ++j) dup = !strcmp(names[i], names[j]);
            if (dup) continue;
            r2d_sb_puts(&text, written++ ? ", " : "");
            r2d_sb_put_json_string(&text, names[i]);
        }
        r2d_sb_puts(&text, "] }\n}\n");
        changed = true;
        char main_js[2048];
        snprintf(main_js, sizeof main_js, "%s/main.js", dir);
        if (!sdk_file_exists(main_js))
            sdk_diag(&rep, SDK_WARNING, "R2D202", path, "{\"field\":\"entry\"}", NULL,
                     "main.js нет — поправьте entry после миграции");
        if (write && !sdk_write_file(path, text.data, text.len))
            sdk_diag(&rep, SDK_ERROR, "SDK_IO", path, NULL, NULL, "не удалось записать project.json");
    }
    r2d_json_free(root);

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"changed\":%s,\"written\":%s,",
                  rep.errors == 0 ? "true" : "false", changed ? "true" : "false",
                  changed && write && rep.errors == 0 ? "true" : "false");
    sdk_put_kv_str(&out, "project", path);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "manifest", changed ? text.data : NULL);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);
    const int rc = rep.errors == 0 ? 0 : 1;
    r2d_sb_free(&out);
    r2d_sb_free(&text);
    sdk_report_free(&rep);
    return rc;
}
