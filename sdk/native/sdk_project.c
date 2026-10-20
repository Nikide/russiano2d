// ===========================================================================
// `r2d-sdk validate` в режиме проекта: project.json, main.js, JS API lint,
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
    char main_js[2048];
    snprintf(main_js, sizeof main_js, "%s/main.js", dir);
    if (!sdk_file_exists(main_js)) {
        sdk_diag(rep, SDK_ERROR, "R2D100", dir, NULL, NULL,
                 "нет main.js — проект не запустится");
    }
    int files = 0;
    // Схема ищется от проекта/cwd/каталога r2d-sdk: validate обязан работать из
    // любого каталога в установленном пакете. Явный --schema не подменяется.
    char schema[2048];
    if (sdk_schema_resolve(schema_path, dir, schema, sizeof schema)) {
        sdk_lint_run(schema, dir, rep, &files);
    } else if (schema_path && schema_path[0]) {
        sdk_diag(rep, SDK_ERROR, "SDK_LINT_SCHEMA", schema_path, NULL, NULL,
                 "файл схемы из --schema не найден: %s", schema_path);
    } else {
        sdk_diag(rep, SDK_ERROR, "SDK_LINT_SCHEMA", schema, NULL,
                 "{\"searched\":[\"<project>/api.schema.json\",\"api.schema.json\",\"<r2d-sdk>/api.schema.json\"]}",
                 "api.schema.json не найден: проверены каталог проекта «%s», cwd и каталог r2d-sdk (%s); укажите --schema",
                 dir, sdk_exe_dir());
    }
    PV pv = { dir, rep, 0 };
    SDL_EnumerateDirectory(dir, project_cb, &pv);
}
