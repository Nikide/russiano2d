// ===========================================================================
// Валидация ассетов: единый реестр проверок по типу (docs/SDK.md §6).
//
// Каждая проверка — функция void(path, report). Диагностика структурная:
// code, severity, asset, location, message, details. Модули инструментов
// (Phase 2+) регистрируют сюда свои типы.
// ===========================================================================
#include "sdk.h"

#include <SDL3/SDL.h>

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------------------
// project.json: минимальный манифест и schema_version 2 (docs/PROJECT_JSON.md)
// ---------------------------------------------------------------------------

typedef struct { char (*names)[128]; int count, cap; } SceneSet;

static void scenes_scan_text(SceneSet *set, const char *text)
{
    static const char kAdd[] = "$.scene.add(";
    for (const char *p = text; (p = strstr(p, kAdd)) != NULL;) {
        p += sizeof kAdd - 1;
        while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
        const char q = *p;
        if (q != '\'' && q != '"' && q != '`') continue;
        const char *b = ++p;
        while (*p && *p != q && *p != '\n') p++;
        if (*p != q) continue;
        const size_t n = (size_t)(p - b);
        if (n == 0 || n >= 128 || set->count >= set->cap) continue;
        memcpy(set->names[set->count], b, n);
        set->names[set->count][n] = 0;
        set->count++;
    }
}

static SDL_EnumerationResult scenes_cb(void *user, const char *dir, const char *name)
{
    SceneSet *set = (SceneSet *)user;
    if (name[0] == '.' || !strcmp(name, "node_modules") || !strcmp(name, "build") ||
        !strcmp(name, "dist")) return SDL_ENUM_CONTINUE;
    char full[2048];
    snprintf(full, sizeof full, "%s/%s", dir, name);
    if (sdk_is_dir(full)) {
        SDL_EnumerateDirectory(full, scenes_cb, set);
        return SDL_ENUM_CONTINUE;
    }
    const size_t n = strlen(name);
    if (n > 3 && !strcmp(name + n - 3, ".js")) {
        size_t size = 0;
        char *text = sdk_read_file(full, &size);
        if (text) { scenes_scan_text(set, text); free(text); }
    }
    return SDL_ENUM_CONTINUE;
}

int sdk_project_scenes(const char *dir, char (*names)[128], int cap)
{
    SceneSet set = { names, 0, cap };
    SDL_EnumerateDirectory(dir, scenes_cb, &set);
    return set.count;
}

static bool scene_known(const SceneSet *set, const char *name)
{
    for (int i = 0; i < set->count; ++i)
        if (!strcmp(set->names[i], name)) return true;
    return false;
}

static bool safe_rel_path(const char *p)
{
    if (!p[0] || p[0] == '/' || p[0] == '\\' || strchr(p, ':')) return false;
    return strstr(p, "..") == NULL;
}

static bool json_is_int_range(const R2dJson *v, int lo, int hi)
{
    return v && v->type == R2D_JSON_NUM && v->number >= lo && v->number <= hi && v->number == floor(v->number);
}

static void field_err(SdkReport *rep, const char *code, const char *path, const char *field, const char *msg)
{
    char loc[128];
    snprintf(loc, sizeof loc, "{\"field\":\"%s\"}", field);
    sdk_diag(rep, SDK_ERROR, code, path, loc, NULL, "%s: %s", field, msg);
}

// editor.graph: внутренняя согласованность и актуальность индекса (R2D205/R2D206).
static void validate_graph(const R2dJson *graph, const char *path, const char *dir, SdkReport *rep)
{
    if (graph->type != R2D_JSON_OBJ) { field_err(rep, "R2D205", path, "editor.graph", "ожидался объект"); return; }
    const R2dJson *fmt = r2d_json_get(graph, "format");
    if (!fmt || fmt->type != R2D_JSON_NUM || fmt->number != 1.0)
        field_err(rep, "R2D205", path, "editor.graph.format", "поддерживается 1");
    const char *status = r2d_json_str(r2d_json_get(graph, "status"), "");
    if (strcmp(status, "current") && strcmp(status, "partial") && strcmp(status, "stale"))
        field_err(rep, "R2D205", path, "editor.graph.status", "current | partial | stale");

    static const char *const lists[] = { "sources", "areas", "entities", "edges", "diagnostics" };
    for (int i = 0; i < 5; ++i) {
        const R2dJson *l = r2d_json_get(graph, lists[i]);
        if (l && l->type != R2D_JSON_ARR) {
            char f[64];
            snprintf(f, sizeof f, "editor.graph.%s", lists[i]);
            field_err(rep, "R2D205", path, f, "ожидался массив");
            return;
        }
    }
    const R2dJson *areas = r2d_json_get(graph, "areas");
    const R2dJson *ents = r2d_json_get(graph, "entities");
    const R2dJson *edges = r2d_json_get(graph, "edges");
    // Ключи уникальны; рёбра ссылаются на существующие записи.
    for (int pass = 0; pass < 3; ++pass) {
        const R2dJson *l = pass == 0 ? areas : pass == 1 ? ents : edges;
        for (int i = 0; l && i < l->count; ++i) {
            const char *key = r2d_json_str(r2d_json_get(l->items[i], "key"), "");
            if (!key[0]) {
                field_err(rep, "R2D205", path, "editor.graph", "запись без key");
                continue;
            }
            const R2dJson *all[3] = { areas, ents, edges };
            for (int q = 0; q < 3; ++q)
                for (int j = 0; all[q] && j < all[q]->count; ++j) {
                    if (q == pass && j >= i) break;
                    if (!strcmp(r2d_json_str(r2d_json_get(all[q]->items[j], "key"), ""), key)) {
                        char msg[256];
                        snprintf(msg, sizeof msg, "повторный ключ «%s»", key);
                        field_err(rep, "R2D205", path, "editor.graph", msg);
                    }
                }
        }
    }
    for (int i = 0; edges && i < edges->count; ++i) {
        const char *ends[2] = { r2d_json_str(r2d_json_get(edges->items[i], "from"), ""),
                                r2d_json_str(r2d_json_get(edges->items[i], "to"), "") };
        for (int e = 0; e < 2; ++e) {
            bool found = false;
            for (int j = 0; !found && ents && j < ents->count; ++j)
                found = !strcmp(r2d_json_str(r2d_json_get(ents->items[j], "key"), ""), ends[e]);
            for (int j = 0; !found && areas && j < areas->count; ++j)
                found = !strcmp(r2d_json_str(r2d_json_get(areas->items[j], "key"), ""), ends[e]);
            if (!found) {
                char msg[256];
                snprintf(msg, sizeof msg, "ребро %s ссылается на неизвестную запись «%s»",
                         r2d_json_str(r2d_json_get(edges->items[i], "key"), "?"), ends[e]);
                field_err(rep, "R2D205", path, "editor.graph.edges", msg);
            }
        }
    }
    for (int i = 0; ents && i < ents->count; ++i) {
        const char *area = r2d_json_str(r2d_json_get(ents->items[i], "area"), "");
        bool found = false;
        for (int j = 0; !found && areas && j < areas->count; ++j)
            found = !strcmp(r2d_json_str(r2d_json_get(areas->items[j], "key"), ""), area);
        if (!found) {
            char msg[256];
            snprintf(msg, sizeof msg, "запись %s в неизвестной области «%s»",
                     r2d_json_str(r2d_json_get(ents->items[i], "key"), "?"), area);
            field_err(rep, "R2D205", path, "editor.graph.entities", msg);
        }
    }
    // Актуальность: хеши исходников против диска. Индекс не переписывается молча.
    const R2dJson *sources = r2d_json_get(graph, "sources");
    for (int i = 0; sources && i < sources->count; ++i) {
        const char *rel = r2d_json_str(r2d_json_get(sources->items[i], "path"), "");
        const char *hash = r2d_json_str(r2d_json_get(sources->items[i], "hash"), "");
        char full[1100];
        sdk_join(dir, rel, full, sizeof full);
        size_t size = 0;
        char *text = safe_rel_path(rel) ? sdk_read_file(full, &size) : NULL;
        char now[32] = "";
        if (text) snprintf(now, sizeof now, "%016llx", (unsigned long long)sdk_deps_hash64(text, size));
        free(text);
        if (strcmp(now, hash)) {
            sdk_diag(rep, SDK_WARNING, "R2D206", path, "{\"field\":\"editor.graph.sources\"}", NULL,
                     "индекс графа устарел: «%s» изменён (r2d project-index --write)", rel);
            break;
        }
    }
}

static void validate_project_v2(const R2dJson *root, const char *path, const char *dir, SdkReport *rep)
{
    static const char *const flat[] = { "title", "width", "height", "version", "format", "entry", "scenes", "roles" };
    for (int i = 0; i < (int)(sizeof flat / sizeof flat[0]); ++i)
        if (r2d_json_get(root, flat[i])) {
            char loc[64];
            snprintf(loc, sizeof loc, "{\"field\":\"%s\"}", flat[i]);
            sdk_diag(rep, SDK_WARNING, "R2D209", path, loc, NULL,
                     "Поле %s на верхнем уровне при schema_version 2 игнорируется (см. project.* и runtime.*)", flat[i]);
        }
    const R2dJson *proj = r2d_json_get(root, "project");
    if (proj) {
        if (proj->type != R2D_JSON_OBJ) field_err(rep, "R2D203", path, "project", "ожидался объект");
        else {
            const R2dJson *n = r2d_json_get(proj, "name"), *v = r2d_json_get(proj, "version");
            if (n && n->type != R2D_JSON_STR) field_err(rep, "R2D203", path, "project.name", "нужна строка");
            if (v && v->type != R2D_JSON_STR) field_err(rep, "R2D203", path, "project.version", "нужна строка");
        }
    }
    const R2dJson *rt = r2d_json_get(root, "runtime");
    const char *entry_name = "main.js";
    if (rt && rt->type != R2D_JSON_OBJ) {
        field_err(rep, "R2D203", path, "runtime", "ожидался объект");
        rt = NULL;
    }
    if (rt) {
        const R2dJson *entry = r2d_json_get(rt, "entry");
        if (entry) {
            if (entry->type != R2D_JSON_STR || !safe_rel_path(entry->string)) {
                field_err(rep, "R2D202", path, "runtime.entry", "нужен относительный путь внутри проекта (без «..»)");
                entry_name = NULL;
            } else {
                entry_name = entry->string;
            }
        }
        const R2dJson *start = r2d_json_get(rt, "start_scene");
        if (start) {
            if (start->type != R2D_JSON_STR || !start->string[0]) {
                field_err(rep, "R2D203", path, "runtime.start_scene", "нужно непустое имя сцены");
            } else {
                char names[256][128];
                SceneSet found = { names, 0, 256 };
                SDL_EnumerateDirectory(dir, scenes_cb, &found);
                if (!scene_known(&found, start->string))
                    sdk_diag(rep, SDK_WARNING, "R2D204", path, "{\"field\":\"runtime.start_scene\"}", NULL,
                             "start_scene «%s»: в коде нет $.scene.add('%s', …)", start->string, start->string);
            }
        }
        const R2dJson *win = r2d_json_get(rt, "window");
        if (win) {
            if (win->type != R2D_JSON_OBJ) field_err(rep, "R2D203", path, "runtime.window", "ожидался объект");
            else {
                const R2dJson *t = r2d_json_get(win, "title"), *w = r2d_json_get(win, "width"),
                              *h = r2d_json_get(win, "height"), *fs = r2d_json_get(win, "fullscreen");
                if (t && t->type != R2D_JSON_STR) field_err(rep, "R2D203", path, "runtime.window.title", "нужна строка");
                if (w && !json_is_int_range(w, 1, 16384)) field_err(rep, "R2D203", path, "runtime.window.width", "целое 1..16384");
                if (h && !json_is_int_range(h, 1, 16384)) field_err(rep, "R2D203", path, "runtime.window.height", "целое 1..16384");
                if (fs && fs->type != R2D_JSON_BOOL) field_err(rep, "R2D203", path, "runtime.window.fullscreen", "нужен boolean");
            }
        }
    }
    if (entry_name) {
        char p[1100];
        sdk_join(dir, entry_name, p, sizeof p);
        if (!sdk_file_exists(p))
            field_err(rep, "R2D202", path, "runtime.entry", "точка входа не найдена");
    }
    const R2dJson *ed = r2d_json_get(root, "editor");
    if (ed && ed->type != R2D_JSON_OBJ) field_err(rep, "R2D203", path, "editor", "ожидался объект");
    else if (ed && r2d_json_get(ed, "graph")) validate_graph(r2d_json_get(ed, "graph"), path, dir, rep);
}

static void validate_project(const char *path, SdkReport *rep)
{
    R2dJson *root = sdk_load_json(path, rep);
    if (!root) return;
    if (root->type != R2D_JSON_OBJ) {
        sdk_diag(rep, SDK_ERROR, "SDK_PROJECT_ROOT", path, NULL, NULL, "project.json должен быть объектом");
        r2d_json_free(root);
        return;
    }
    char dir[1024];
    sdk_dirname(path, dir, sizeof dir);

    const R2dJson *sv = r2d_json_get(root, "schema_version");
    if (sv) {
        if (sv->type == R2D_JSON_NUM && sv->number == 2.0) {
            validate_project_v2(root, path, dir, rep);
        } else {
            field_err(rep, "R2D201", path, "schema_version", "поддерживается 2");
        }
        r2d_json_free(root);
        return;
    }

    // Минимальный манифест без schema_version: title/width/height/version.
    static const char *const nums[] = { "width", "height" };
    for (int i = 0; i < 2; ++i) {
        const R2dJson *v = r2d_json_get(root, nums[i]);
        if (!v) continue;
        if (v->type != R2D_JSON_NUM || v->number < 1 || v->number > 16384 || v->number != floor(v->number)) {
            char loc[64];
            snprintf(loc, sizeof loc, "{\"field\":\"%s\"}", nums[i]);
            sdk_diag(rep, SDK_ERROR, "SDK_PROJECT_FIELD", path, loc, NULL,
                     "Поле %s должно быть целым 1..16384", nums[i]);
        }
    }
    static const char *const strs[] = { "title", "version" };
    for (int i = 0; i < 2; ++i) {
        const R2dJson *v = r2d_json_get(root, strs[i]);
        if (v && v->type != R2D_JSON_STR) {
            char loc[64];
            snprintf(loc, sizeof loc, "{\"field\":\"%s\"}", strs[i]);
            sdk_diag(rep, SDK_ERROR, "SDK_PROJECT_FIELD", path, loc, NULL,
                     "Поле %s должно быть строкой", strs[i]);
        }
    }
    static const char *const v2only[] = { "format", "entry", "scenes", "roles" };
    for (int i = 0; i < 4; ++i) {
        if (!r2d_json_get(root, v2only[i])) continue;
        char loc[64];
        snprintf(loc, sizeof loc, "{\"field\":\"%s\"}", v2only[i]);
        sdk_diag(rep, SDK_WARNING, "R2D209", path, loc, NULL,
                 "Поле %s без schema_version 2 не читается (r2d migrate-project)", v2only[i]);
    }
    char main_js[1100];
    sdk_join(dir, "main.js", main_js, sizeof main_js);
    if (!sdk_file_exists(main_js)) {
        sdk_diag(rep, SDK_WARNING, "SDK_PROJECT_NO_MAIN", path, NULL, NULL,
                 "Рядом с project.json нет main.js — точка входа задаётся флагом --entry при сборке");
    }
    r2d_json_free(root);
}

// ---------------------------------------------------------------------------
// sdk_tools.json
// ---------------------------------------------------------------------------
static void validate_registry(const char *path, SdkReport *rep)
{
    SdkRegistry reg;
    sdk_registry_load(path, &reg, rep);
    sdk_registry_free(&reg);
}

// ---------------------------------------------------------------------------
// Любой JSON
// ---------------------------------------------------------------------------
static void validate_json(const char *path, SdkReport *rep)
{
    R2dJson *root = sdk_load_json(path, rep);
    r2d_json_free(root);
}

typedef struct Validator {
    const char *type;
    SdkValidateFn fn;
} Validator;

static const Validator k_validators[] = {
    { "project",      validate_project },
    { "sdk.registry", validate_registry },
    { "sdk.manifest", sdk_validate_sdk_manifest },
    { "sdk.agent-session", sdk_validate_agent_session },
    { "json",         validate_json },
    { "sprite.atlas", sdk_validate_atlas },
    { "re2d.world",   sdk_validate_re2dmap },
    { "tilemap",      sdk_validate_tilemap },
    { "particles",    sdk_validate_particles },
    { "collision",    sdk_validate_collision },
    { "layers",       sdk_validate_layers },
    { "fonts",        sdk_validate_fonts },
    { "audio",        sdk_validate_audio },
    { "input",        sdk_validate_input },
    { "rmlui.document", sdk_validate_rml },
    { "rmlui.style",  sdk_validate_rcss },
};

int sdk_validator_count(void) { return (int)(sizeof k_validators / sizeof k_validators[0]); }
const char *sdk_validator_type(int i) { return k_validators[i].type; }

const char *sdk_validate_file(const char *path, const char *type_override, SdkReport *rep)
{
    const char *type = type_override && type_override[0] ? type_override : sdk_asset_type(path);
    if (!sdk_file_exists(path)) {
        sdk_diag(rep, SDK_ERROR, "SDK_FILE_NOT_FOUND", path, NULL, NULL, "Файл не найден: %s", path);
        return type;
    }
    for (size_t i = 0; i < sizeof k_validators / sizeof k_validators[0]; ++i) {
        if (strcmp(k_validators[i].type, type) == 0) {
            k_validators[i].fn(path, rep);
            return type;
        }
    }
    char details[128];
    snprintf(details, sizeof details, "{\"type\":\"%s\"}", type);
    sdk_diag(rep, SDK_INFO, "SDK_NO_VALIDATOR", path, NULL, details,
             "Для типа «%s» проверки пока нет — файл не проверялся", type);
    return type;
}
