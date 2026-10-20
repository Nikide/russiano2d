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
// project.json (формат 1 и 2, docs/FORMATS.md)
// ---------------------------------------------------------------------------

// Роли v2 — id студий Editor (editor/studios/index.js) и общие роли.
static const char *const k_project_roles[] = {
    "atlas", "hammer", "narrative", "sprite-mesh", "tilemap", "particles", "collision",
    "parallax", "fonts", "audio", "input", "re2dsprite", "rmlui",
    "script", "data", "asset", NULL
};

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

static void validate_project_v2(const R2dJson *root, const char *path, const char *dir, SdkReport *rep)
{
    // entry
    const R2dJson *entry = r2d_json_get(root, "entry");
    const char *entry_name = "main.js";
    if (entry) {
        if (entry->type != R2D_JSON_STR || !safe_rel_path(entry->string)) {
            sdk_diag(rep, SDK_ERROR, "R2D202", path, "{\"field\":\"entry\"}", NULL,
                     "entry: нужен относительный путь внутри проекта (без «..»)");
            entry_name = NULL;
        } else {
            entry_name = entry->string;
        }
    }
    if (entry_name) {
        char p[1100];
        sdk_join(dir, entry_name, p, sizeof p);
        if (!sdk_file_exists(p))
            sdk_diag(rep, SDK_ERROR, "R2D202", path, "{\"field\":\"entry\"}", NULL,
                     "Точка входа «%s» не найдена", entry_name);
    }

    // scenes
    const R2dJson *scenes = r2d_json_get(root, "scenes");
    if (scenes) {
        if (scenes->type != R2D_JSON_OBJ) {
            sdk_diag(rep, SDK_ERROR, "R2D203", path, "{\"field\":\"scenes\"}", NULL,
                     "scenes должен быть объектом { start, list }");
        } else {
            char names[256][128];
            SceneSet found = { names, 0, 256 };
            SDL_EnumerateDirectory(dir, scenes_cb, &found);

            const R2dJson *list = r2d_json_get(scenes, "list");
            const R2dJson *start = r2d_json_get(scenes, "start");
            if (list && list->type != R2D_JSON_ARR) {
                sdk_diag(rep, SDK_ERROR, "R2D203", path, "{\"field\":\"scenes.list\"}", NULL,
                         "scenes.list должен быть массивом имён сцен");
                list = NULL;
            }
            for (int i = 0; list && i < list->count; ++i) {
                const R2dJson *it = list->items[i];
                char loc[96];
                snprintf(loc, sizeof loc, "{\"field\":\"scenes.list\",\"index\":%d}", i);
                if (it->type != R2D_JSON_STR || !it->string[0]) {
                    sdk_diag(rep, SDK_ERROR, "R2D203", path, loc, NULL,
                             "scenes.list[%d]: нужно непустое имя сцены", i);
                    continue;
                }
                for (int j = 0; j < i; ++j) {
                    const R2dJson *o = list->items[j];
                    if (o->type == R2D_JSON_STR && !strcmp(o->string, it->string)) {
                        sdk_diag(rep, SDK_ERROR, "R2D203", path, loc, NULL,
                                 "scenes.list: сцена «%s» указана дважды", it->string);
                        break;
                    }
                }
                if (!scene_known(&found, it->string))
                    sdk_diag(rep, SDK_WARNING, "R2D204", path, loc, NULL,
                             "Сцена «%s» есть в scenes.list, но ни один скрипт не вызывает $.scene.add('%s')",
                             it->string, it->string);
            }
            // Сцены из кода, которых нет в индексе.
            if (list) {
                for (int i = 0; i < found.count; ++i) {
                    bool listed = false;
                    for (int j = 0; j < list->count && !listed; ++j)
                        listed = list->items[j]->type == R2D_JSON_STR && !strcmp(list->items[j]->string, found.names[i]);
                    bool dup = false;
                    for (int k = 0; k < i && !dup; ++k) dup = !strcmp(found.names[k], found.names[i]);
                    if (!listed && !dup)
                        sdk_diag(rep, SDK_WARNING, "R2D204", path, "{\"field\":\"scenes.list\"}", NULL,
                                 "Скрипт регистрирует сцену «%s», но её нет в scenes.list", found.names[i]);
                }
            }
            if (start) {
                if (start->type != R2D_JSON_STR || !start->string[0]) {
                    sdk_diag(rep, SDK_ERROR, "R2D203", path, "{\"field\":\"scenes.start\"}", NULL,
                             "scenes.start: нужно имя сцены");
                } else {
                    bool in_list = !list;
                    for (int j = 0; list && j < list->count && !in_list; ++j)
                        in_list = list->items[j]->type == R2D_JSON_STR && !strcmp(list->items[j]->string, start->string);
                    if (!in_list)
                        sdk_diag(rep, SDK_ERROR, "R2D203", path, "{\"field\":\"scenes.start\"}", NULL,
                                 "scenes.start «%s» нет в scenes.list", start->string);
                    else if (!scene_known(&found, start->string))
                        sdk_diag(rep, SDK_WARNING, "R2D204", path, "{\"field\":\"scenes.start\"}", NULL,
                                 "Стартовая сцена «%s» не зарегистрирована ни одним $.scene.add", start->string);
                }
            }
        }
    }

    // roles
    const R2dJson *roles = r2d_json_get(root, "roles");
    if (roles) {
        if (roles->type != R2D_JSON_OBJ) {
            sdk_diag(rep, SDK_ERROR, "R2D205", path, "{\"field\":\"roles\"}", NULL,
                     "roles должен быть объектом { \"путь\": \"роль\" }");
        } else {
            for (int i = 0; i < roles->count; ++i) {
                const char *file = roles->keys[i];
                const R2dJson *role = roles->items[i];
                char loc[600];
                snprintf(loc, sizeof loc, "{\"field\":\"roles\",\"key\":\"%.500s\"}", file);
                if (!safe_rel_path(file)) {
                    sdk_diag(rep, SDK_ERROR, "R2D205", path, loc, NULL,
                             "roles: «%s» — нужен относительный путь внутри проекта", file);
                    continue;
                }
                char p[1100];
                sdk_join(dir, file, p, sizeof p);
                if (!sdk_file_exists(p))
                    sdk_diag(rep, SDK_ERROR, "R2D205", path, loc, NULL,
                             "roles: файл «%s» не найден", file);
                bool ok = role->type == R2D_JSON_STR;
                if (ok) {
                    ok = false;
                    for (int k = 0; k_project_roles[k] && !ok; ++k) ok = !strcmp(k_project_roles[k], role->string);
                }
                if (!ok)
                    sdk_diag(rep, SDK_ERROR, "R2D206", path, loc, NULL,
                             "roles: неизвестная роль «%s» для «%s»",
                             role->type == R2D_JSON_STR ? role->string : "?", file);
            }
        }
    }
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

    char dir[1024];
    sdk_dirname(path, dir, sizeof dir);

    int format = 1;
    const R2dJson *fmt = r2d_json_get(root, "format");
    if (fmt) {
        if (fmt->type == R2D_JSON_NUM && (fmt->number == 1.0 || fmt->number == 2.0)) {
            format = (int)fmt->number;
        } else {
            sdk_diag(rep, SDK_ERROR, "R2D201", path, "{\"field\":\"format\"}", NULL,
                     "format: поддерживаются 1 и 2");
            format = 0;
        }
    }
    if (format == 1) {
        static const char *const v2only[] = { "entry", "scenes", "roles" };
        for (int i = 0; i < 3; ++i) {
            if (!r2d_json_get(root, v2only[i])) continue;
            char loc[64];
            snprintf(loc, sizeof loc, "{\"field\":\"%s\"}", v2only[i]);
            sdk_diag(rep, SDK_WARNING, "R2D201", path, loc, NULL,
                     "Поле %s читается только при \"format\": 2 — сейчас оно игнорируется (r2d migrate-project)",
                     v2only[i]);
        }
        char main_js[1100];
        sdk_join(dir, "main.js", main_js, sizeof main_js);
        if (!sdk_file_exists(main_js)) {
            sdk_diag(rep, SDK_WARNING, "SDK_PROJECT_NO_MAIN", path, NULL, NULL,
                     "Рядом с project.json нет main.js — точка входа задаётся флагом --entry при сборке");
        }
    } else if (format == 2) {
        validate_project_v2(root, path, dir, rep);
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
