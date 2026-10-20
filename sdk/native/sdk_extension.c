// ===========================================================================
// Расширения SDK и standalone-инструменты (docs/SDK_EXTENSIONS.md).
//
// Effective registry = built-in инструменты sdk_tools.json + user-расширения +
// project-расширения. Загрузка детерминирована: built-in, затем user, затем
// project; внутри каталога — по имени. Дубликат namespaced id не перекрывает
// существующий молча: SDK_EXTENSION_DUPLICATE_ID и запись отключается.
//
// Одно расширение не может уронить SDK (failure isolation): манифест/вход/
// контракт проверяются, ошибки уходят структурной диагностикой, остальные
// расширения и встроенные инструменты продолжают работать.
//
// Каталоги:
//   <SDK>/sdk/extensions/<id>/        built-in (владелец — движок)
//   <pref>/russiano2d/sdk/extensions  user (платформенный конфиг-путь)
//   <project>/sdk_extensions/<id>/    project (живёт с проектом)
// Манифест: extension.json | tool.json | manifest.json (первый найденный).
// ===========================================================================
#include "sdk.h"

#include <SDL3/SDL.h>

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define EXT_MAX_DIRS 256
#define EXT_MAX_PERMISSIONS 8

// ---------------------------------------------------------------------------
// Мелкие помощники
// ---------------------------------------------------------------------------
static void copy_text(char *dst, size_t cap, const char *src)
{
    if (!dst || cap == 0) return;
    snprintf(dst, cap, "%s", src ? src : "");
}

static bool path_absolute(const char *p)
{
    if (!p || !p[0]) return false;
    if (p[0] == '/') return true;
    if (strlen(p) > 2 && p[1] == ':') return true;    // C:\...
    return false;
}

static void trim_trailing_slash(char *p)
{
    size_t n = strlen(p);
    while (n > 1 && (p[n - 1] == '/' || p[n - 1] == '\\')) p[--n] = '\0';
}

static void make_absolute(const char *path, char *out, size_t cap)
{
    if (!path || !path[0]) { out[0] = '\0'; return; }
    if (path_absolute(path)) { copy_text(out, cap, path); trim_trailing_slash(out); return; }
    char *raw = SDL_GetCurrentDirectory();
    if (!raw) { copy_text(out, cap, path); trim_trailing_slash(out); return; }
    trim_trailing_slash(raw);
    snprintf(out, cap, "%s/%s", raw, path);
    SDL_free(raw);
}

static bool ensure_dir(const char *path)
{
    if (sdk_is_dir(path)) return true;
    return SDL_CreateDirectory(path);
}

// namespaced id: минимум одна точка, сегменты [a-z0-9-], первый символ — a-z0-9
static bool namespaced_id_ok(const char *id)
{
    if (!id || !id[0]) return false;
    bool dot = false;
    bool seg_start = true;
    for (const char *p = id; *p; ++p) {
        const unsigned char c = (unsigned char)*p;
        if (c == '.') {
            if (seg_start) return false;    // пустой сегмент
            dot = true;
            seg_start = true;
            continue;
        }
        if (seg_start) {
            if (!(islower(c) || isdigit(c))) return false;
            seg_start = false;
            continue;
        }
        if (!(islower(c) || isdigit(c) || c == '-')) return false;
    }
    return dot && !seg_start;
}

static bool semver_ok(const char *v)
{
    if (!v || !v[0]) return false;
    int dots = 0;
    bool digit = false;
    for (const char *p = v; *p; ++p) {
        if (*p == '.') { if (!digit) return false; dots++; digit = false; }
        else if (isdigit((unsigned char)*p)) digit = true;
        else return false;
    }
    return dots >= 2 && digit;
}

static bool permission_ok(const char *p)
{
    if (!p || !p[0]) return false;
    bool dot = false;
    for (const char *q = p; *q; ++q) {
        const unsigned char c = (unsigned char)*q;
        if (c == '.') { dot = true; continue; }
        if (!(islower(c) || isdigit(c) || c == '_' || c == '-')) return false;
    }
    return dot;
}

// ---------------------------------------------------------------------------
// Каталоги и манифесты
// ---------------------------------------------------------------------------
typedef struct DirNames {
    char names[EXT_MAX_DIRS][256];
    int  count;
} DirNames;

static SDL_EnumerationResult SDLCALL enum_dirs(void *ud, const char *dir, const char *fname)
{
    DirNames *d = (DirNames *)ud;
    if (!fname || fname[0] == '.') return SDL_ENUM_CONTINUE;
    char full[2048];
    snprintf(full, sizeof full, "%s/%s", dir, fname);
    if (!sdk_is_dir(full)) return SDL_ENUM_CONTINUE;
    if (d->count >= EXT_MAX_DIRS) return SDL_ENUM_CONTINUE;
    snprintf(d->names[d->count++], 256, "%s", fname);
    return SDL_ENUM_CONTINUE;
}

static int cmp_str(const void *a, const void *b)
{
    return strcmp((const char *)a, (const char *)b);
}

static bool find_manifest(const char *dir, char *out, size_t cap)
{
    static const char *const names[] = { "extension.json", "tool.json", "manifest.json", NULL };
    for (int i = 0; names[i]; ++i) {
        char full[2200];
        snprintf(full, sizeof full, "%s/%s", dir, names[i]);
        if (sdk_file_exists(full)) { copy_text(out, cap, full); return true; }
    }
    return false;
}

static void default_user_root(char *out, size_t cap)
{
    out[0] = '\0';
    char *pref = SDL_GetPrefPath("russiano2d", "sdk");
    if (!pref) return;
    snprintf(out, cap, "%sextensions", pref);    // SDL_GetPrefPath завершается '/'
    SDL_free(pref);
}

// ---------------------------------------------------------------------------
// Разбор contributions
// ---------------------------------------------------------------------------
static bool contribution_array_ok(const R2dJson *contributes, const char *key,
                                  SdkReport *rep, const char *asset, bool *present)
{
    *present = false;
    const R2dJson *v = r2d_json_get(contributes, key);
    if (!v) return true;
    *present = true;
    if (v->type != R2D_JSON_ARR) {
        sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_CONTRIBUTION_INVALID", asset, NULL, NULL,
                 "contributes.%s должен быть массивом", key);
        return false;
    }
    return true;
}

static bool contribution_items_ok(const R2dJson *contributes, const char *key,
                                  const char *id_key, int *count,
                                  SdkReport *rep, const char *asset)
{
    *count = 0;
    const R2dJson *v = r2d_json_get(contributes, key);
    if (!v) return true;
    const int n = r2d_json_size(v);
    bool ok = true;
    for (int i = 0; i < n; ++i) {
        const R2dJson *item = r2d_json_at(v, i);
        if (!item || item->type != R2D_JSON_OBJ) {
            R2dSb d; r2d_sb_init(&d);
            r2d_sb_printf(&d, "{\"component\":\"%s\",\"index\":%d}", key, i);
            sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_CONTRIBUTION_INVALID", asset, d.data, NULL,
                     "contributes.%s[%d] должен быть объектом", key, i);
            r2d_sb_free(&d);
            ok = false;
            continue;
        }
        const char *id = r2d_json_str(r2d_json_get(item, id_key), NULL);
        if (!id || !id[0]) {
            R2dSb d; r2d_sb_init(&d);
            r2d_sb_printf(&d, "{\"component\":\"%s\",\"index\":%d,\"field\":\"%s\"}", key, i, id_key);
            sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_CONTRIBUTION_INVALID", asset, d.data, NULL,
                     "contributes.%s[%d]: нет обязательного поля «%s»", key, i, id_key);
            r2d_sb_free(&d);
            ok = false;
        }
        (*count)++;
    }
    return ok;
}

static bool parse_tools(const R2dJson *contributes, SdkExtension *e,
                        SdkReport *rep, const char *asset)
{
    const R2dJson *tools = r2d_json_get(contributes, "tools");
    if (!tools) return true;
    if (tools->type != R2D_JSON_ARR) {
        sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_CONTRIBUTION_INVALID", asset, NULL, NULL,
                 "contributes.tools должен быть массивом");
        return false;
    }
    const int n = r2d_json_size(tools);
    bool ok = true;
    for (int i = 0; i < n; ++i) {
        const R2dJson *item = r2d_json_at(tools, i);
        if (!item || item->type != R2D_JSON_OBJ) {
            sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_CONTRIBUTION_INVALID", asset, NULL, NULL,
                     "contributes.tools[%d] должен быть объектом", i);
            ok = false;
            continue;
        }
        if (e->tool_count >= (int)(sizeof e->tools / sizeof e->tools[0])) {
            sdk_diag(rep, SDK_WARNING, "SDK_EXTENSION_CONTRIBUTION_INVALID", asset, NULL, NULL,
                     "contributions.tools: больше %d инструментов не поддерживается",
                     (int)(sizeof e->tools / sizeof e->tools[0]));
            break;
        }
        SdkExtTool *t = &e->tools[e->tool_count];
        memset(t, 0, sizeof *t);
        const char *id = r2d_json_str(r2d_json_get(item, "id"), NULL);
        if (!namespaced_id_ok(id)) {
            sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_CONTRIBUTION_INVALID", asset, NULL, NULL,
                     "contributes.tools[%d].id «%s» должен быть namespaced (author.tool)", i, id ? id : "");
            ok = false;
            continue;
        }
        copy_text(t->id, sizeof t->id, id);
        const char *name = r2d_json_str(r2d_json_get(item, "name"), t->id);
        copy_text(t->name, sizeof t->name, name);
        const char *desc = r2d_json_str(r2d_json_get(item, "description"), "");
        copy_text(t->description, sizeof t->description, desc);
        const char *entry = r2d_json_str(r2d_json_get(item, "entry"), e->entry);
        copy_text(t->entry, sizeof t->entry, entry);
        const char *cat = r2d_json_str(r2d_json_get(item, "category"), "extension");
        copy_text(t->category, sizeof t->category, cat);
        const R2dJson *assets = r2d_json_get(item, "assets");
        if (assets && assets->type == R2D_JSON_ARR) {
            const int an = r2d_json_size(assets);
            for (int k = 0; k < an && t->asset_count < (int)(sizeof t->assets / sizeof t->assets[0]); ++k) {
                const char *a = r2d_json_str(r2d_json_at(assets, k), NULL);
                if (a && a[0]) copy_text(t->assets[t->asset_count++], 128, a);
            }
        }
        if (t->entry[0]) {
            char full[2200];
            snprintf(full, sizeof full, "%s/%s", e->root, t->entry);
            if (!sdk_file_exists(full)) {
                sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_ENTRY_MISSING", asset, NULL, NULL,
                         "JS-модуль инструмента «%s» не найден: %s", t->id, full);
                ok = false;
                continue;
            }
        }
        e->tool_count++;
    }
    return ok;
}

static bool parse_manifest(const char *dir, const char *scope, const char *manifest_path,
                           SdkExtension *e, SdkReport *rep)
{
    memset(e, 0, sizeof *e);
    copy_text(e->scope, sizeof e->scope, scope);
    make_absolute(dir, e->root, sizeof e->root);
    copy_text(e->manifest_path, sizeof e->manifest_path, manifest_path);
    e->sdk_api = 0;

    const char *base = sdk_basename(manifest_path);
    e->standalone = base && strcmp(base, "tool.json") == 0;

    R2dJson *root = sdk_load_json(manifest_path, rep);
    if (!root) return false;
    const int err0 = rep->errors;

    if (root->type != R2D_JSON_OBJ) {
        sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_MANIFEST", manifest_path, NULL, NULL,
                 "Корень манифеста должен быть объектом");
        r2d_json_free(root);
        return false;
    }

    const R2dJson *schema = r2d_json_get(root, "schema_version");
    if (!schema || schema->type != R2D_JSON_NUM || (int)schema->number != 1) {
        R2dSb d; r2d_sb_init(&d);
        r2d_sb_printf(&d, "{\"expected\":1,\"found\":%g}", schema && schema->type == R2D_JSON_NUM ? schema->number : 0.0);
        sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_MANIFEST", manifest_path, NULL, d.data,
                 "Неподдерживаемая schema_version манифеста расширения: ожидалась 1");
        r2d_sb_free(&d);
    }

    const char *id = r2d_json_str(r2d_json_get(root, "id"), NULL);
    if (!namespaced_id_ok(id)) {
        sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_MANIFEST", manifest_path, NULL, NULL,
                 "id «%s» должен быть namespaced: author.tool (a-z, 0-9, «-», точки)", id ? id : "");
    } else {
        copy_text(e->id, sizeof e->id, id);
    }

    const char *name = r2d_json_str(r2d_json_get(root, "name"), NULL);
    if (!name || !name[0]) {
        sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_MANIFEST", manifest_path, NULL, NULL,
                 "Манифест расширения без поля name");
    } else {
        copy_text(e->name, sizeof e->name, name);
    }

    const char *version = r2d_json_str(r2d_json_get(root, "version"), NULL);
    if (!semver_ok(version)) {
        sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_MANIFEST", manifest_path, NULL, NULL,
                 "version «%s» должен быть semver вида 1.0.0", version ? version : "");
    } else {
        copy_text(e->version, sizeof e->version, version);
    }

    const char *description = r2d_json_str(r2d_json_get(root, "description"), "");
    copy_text(e->description, sizeof e->description, description);
    const char *category = r2d_json_str(r2d_json_get(root, "category"), "tool");
    copy_text(e->category, sizeof e->category, category);

    const R2dJson *api = r2d_json_get(root, "sdk_api");
    if (!api || api->type != R2D_JSON_NUM) {
        sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_MANIFEST", manifest_path, NULL, NULL,
                 "Манифест расширения без целочисленного sdk_api");
    } else {
        e->sdk_api = (int)api->number;
        if (e->sdk_api != SDK_EXT_API_VERSION) {
            R2dSb d; r2d_sb_init(&d);
            r2d_sb_printf(&d, "{\"required\":%d,\"current\":%d}", e->sdk_api, SDK_EXT_API_VERSION);
            sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_API_MISMATCH", manifest_path, NULL, d.data,
                     "Расширение «%s» требует sdk_api=%d, SDK поддерживает %d — расширение отключено",
                     e->id[0] ? e->id : dir, e->sdk_api, SDK_EXT_API_VERSION);
            r2d_sb_free(&d);
        }
    }

    const char *entry = r2d_json_str(r2d_json_get(root, "entry"), NULL);
    if (entry && entry[0]) {
        copy_text(e->entry, sizeof e->entry, entry);
        char full[2400];
        snprintf(full, sizeof full, "%s/%s", e->root, e->entry);
        if (!sdk_file_exists(full)) {
            sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_ENTRY_MISSING", manifest_path, NULL, NULL,
                     "Точка входа «%s» не найдена в каталоге расширения", e->entry);
        }
    } else if (e->standalone) {
        sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_ENTRY_MISSING", manifest_path, NULL, NULL,
                 "Standalone-инструмент без entry: нечего запускать");
    }

    const R2dJson *permissions = r2d_json_get(root, "permissions");
    if (permissions) {
        if (permissions->type != R2D_JSON_ARR) {
            sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_PERMISSION", manifest_path, NULL, NULL,
                     "permissions должен быть массивом строк");
        } else {
            const int pn = r2d_json_size(permissions);
            for (int i = 0; i < pn && e->permission_count < EXT_MAX_PERMISSIONS; ++i) {
                const char *p = r2d_json_str(r2d_json_at(permissions, i), NULL);
                if (!permission_ok(p)) {
                    sdk_diag(rep, SDK_WARNING, "SDK_EXTENSION_PERMISSION", manifest_path, NULL, NULL,
                             "permission «%s» не похож на group.action", p ? p : "");
                    continue;
                }
                copy_text(e->permissions[e->permission_count++], 64, p);
            }
        }
    }

    const R2dJson *contributes = r2d_json_get(root, "contributes");
    bool contributes_ok = true;
    if (contributes) {
        if (contributes->type != R2D_JSON_OBJ) {
            sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_CONTRIBUTION_INVALID", manifest_path, NULL, NULL,
                     "contributes должен быть объектом");
            contributes_ok = false;
        } else {
            bool present = false;
            static const char *const array_keys[] = {
                "tools", "menus", "toolbar", "panels", "inspectors", "entityDefinitions",
                "worldTools", "validators", "buildSteps", "agentCommands", "contextActions",
                "worldOverlays", NULL,
            };
            for (int i = 0; array_keys[i]; ++i) {
                if (!contribution_array_ok(contributes, array_keys[i], rep, manifest_path, &present)) {
                    contributes_ok = false;
                }
                if (present) e->contributes_count++;
            }
            if (contributes_ok) {
                contributes_ok = contribution_items_ok(contributes, "menus", "id", &e->c_menus, rep, manifest_path);
                contributes_ok = contribution_items_ok(contributes, "toolbar", "id", &e->c_toolbar, rep, manifest_path) && contributes_ok;
                contributes_ok = contribution_items_ok(contributes, "panels", "id", &e->c_panels, rep, manifest_path) && contributes_ok;
                contributes_ok = contribution_items_ok(contributes, "inspectors", "id", &e->c_inspectors, rep, manifest_path) && contributes_ok;
                contributes_ok = contribution_items_ok(contributes, "entityDefinitions", "class", &e->c_entity_defs, rep, manifest_path) && contributes_ok;
                contributes_ok = contribution_items_ok(contributes, "worldTools", "id", &e->c_world_tools, rep, manifest_path) && contributes_ok;
                contributes_ok = contribution_items_ok(contributes, "validators", "id", &e->c_validators, rep, manifest_path) && contributes_ok;
                contributes_ok = contribution_items_ok(contributes, "buildSteps", "id", &e->c_build_steps, rep, manifest_path) && contributes_ok;
                contributes_ok = contribution_items_ok(contributes, "agentCommands", "id", &e->c_agent_commands, rep, manifest_path) && contributes_ok;
                if (!parse_tools(contributes, e, rep, manifest_path)) contributes_ok = false;
            }
            R2dSb raw;
            r2d_sb_init(&raw);
            sdk_json_put_compact(&raw, contributes);
            e->contributes_json = r2d_sb_take(&raw);
            const bool has_tools = e->tool_count > 0;
            if (!has_tools && e->standalone) e->standalone = true;
        }
    }

    if (e->standalone) {
        // tool.json без contributions — standalone-инструмент: один tool из id.
        if (e->tool_count == 0 && e->id[0]) {
            SdkExtTool *t = &e->tools[e->tool_count];
            memset(t, 0, sizeof *t);
            copy_text(t->id, sizeof t->id, e->id);
            copy_text(t->name, sizeof t->name, e->name);
            copy_text(t->description, sizeof t->description, e->description);
            copy_text(t->entry, sizeof t->entry, e->entry);
            copy_text(t->category, sizeof t->category, e->category);
            e->tool_count = 1;
        }
    }

    e->valid = (rep->errors == err0) && contributes_ok;
    e->enabled = e->valid;
    r2d_json_free(root);
    return e->valid;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
static void ext_append(SdkExtensions *out, const SdkExtension *src)
{
    if (out->count == out->cap) {
        const int cap = out->cap ? out->cap * 2 : 8;
        SdkExtension *items = (SdkExtension *)realloc(out->items, (size_t)cap * sizeof *items);
        if (!items) return;
        out->items = items;
        out->cap = cap;
    }
    out->items[out->count++] = *src;
}

static void scan_root(const char *root, const char *scope, SdkExtensions *out, SdkReport *rep)
{
    if (!root || !root[0] || !sdk_is_dir(root)) return;
    DirNames names;
    memset(&names, 0, sizeof names);
    SDL_EnumerateDirectory(root, enum_dirs, &names);
    qsort(names.names, (size_t)names.count, sizeof names.names[0], cmp_str);

    for (int i = 0; i < names.count; ++i) {
        char dir[2048], manifest[2200];
        snprintf(dir, sizeof dir, "%s/%s", root, names.names[i]);
        if (!find_manifest(dir, manifest, sizeof manifest)) continue;

        SdkExtension e;
        parse_manifest(dir, scope, manifest, &e, rep);

        if (e.id[0]) {
            for (int k = 0; k < out->count; ++k) {
                if (strcmp(out->items[k].id, e.id) == 0) {
                    R2dSb d; r2d_sb_init(&d);
                    r2d_sb_printf(&d, "{\"scope\":\"%s\",\"firstScope\":\"%s\",\"firstRoot\":",
                                  scope, out->items[k].scope);
                    r2d_sb_put_json_string(&d, out->items[k].root);
                    r2d_sb_putc(&d, '}');
                    sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_DUPLICATE_ID", manifest, NULL, d.data,
                             "id «%s» уже объявлен в scope %s — дубликат отключён (silent override запрещён)",
                             e.id, out->items[k].scope);
                    r2d_sb_free(&d);
                    e.valid = false;
                    e.enabled = false;
                    break;
                }
            }
        }
        ext_append(out, &e);
    }
}

bool sdk_extensions_scan(const SdkExtOptions *opt, SdkExtensions *out, SdkReport *rep)
{
    memset(out, 0, sizeof *out);
    char sdk_root[1200] = "";
    if (opt && opt->sdk_root && opt->sdk_root[0]) make_absolute(opt->sdk_root, sdk_root, sizeof sdk_root);
    else {
        char *cwd = SDL_GetCurrentDirectory();
        if (cwd) { copy_text(sdk_root, sizeof sdk_root, cwd); SDL_free(cwd); }
    }

    if (opt && opt->builtin_dir && opt->builtin_dir[0]) make_absolute(opt->builtin_dir, out->builtin_root, sizeof out->builtin_root);
    else if (sdk_root[0]) snprintf(out->builtin_root, sizeof out->builtin_root, "%s/sdk/extensions", sdk_root);

    if (opt && opt->user_dir && opt->user_dir[0]) make_absolute(opt->user_dir, out->user_root, sizeof out->user_root);
    else default_user_root(out->user_root, sizeof out->user_root);

    if (opt && opt->project_dir && opt->project_dir[0]) {
        char proj[1200];
        make_absolute(opt->project_dir, proj, sizeof proj);
        snprintf(out->project_root, sizeof out->project_root, "%s/sdk_extensions", proj);
    }

    scan_root(out->builtin_root, "builtin", out, rep);
    scan_root(out->user_root, "user", out, rep);
    scan_root(out->project_root, "project", out, rep);
    return true;
}

void sdk_extensions_free(SdkExtensions *ext)
{
    if (!ext) return;
    for (int i = 0; i < ext->count; ++i) free(ext->items[i].contributes_json);
    free(ext->items);
    memset(ext, 0, sizeof *ext);
}

static bool reg_has_id(const SdkRegistry *reg, const char *id)
{
    for (int i = 0; i < reg->count; ++i) {
        if (strcmp(reg->tools[i].id, id) == 0) return true;
    }
    return false;
}

static SdkTool *reg_add(SdkRegistry *reg)
{
    SdkTool *tools = (SdkTool *)realloc(reg->tools, (size_t)(reg->count + 1) * sizeof *tools);
    if (!tools) return NULL;
    reg->tools = tools;
    SdkTool *t = &reg->tools[reg->count++];
    memset(t, 0, sizeof *t);
    return t;
}

void sdk_extensions_append_tools(const SdkExtensions *ext, SdkRegistry *reg, SdkReport *rep)
{
    if (!ext || !reg) return;
    for (int i = 0; i < ext->count; ++i) {
        const SdkExtension *e = &ext->items[i];
        if (!e->enabled || !e->valid) continue;
        for (int k = 0; k < e->tool_count; ++k) {
            const SdkExtTool *et = &e->tools[k];
            if (reg_has_id(reg, et->id)) {
                sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_DUPLICATE_ID", e->manifest_path, NULL, NULL,
                         "Инструмент «%s» из расширения «%s» перекрывает существующий id — пропущен",
                         et->id, e->id);
                continue;
            }
            SdkTool *t = reg_add(reg);
            if (!t) continue;
            copy_text(t->id, sizeof t->id, et->id);
            copy_text(t->name, sizeof t->name, et->name);
            copy_text(t->description, sizeof t->description, et->description);
            copy_text(t->category, sizeof t->category, et->category);
            copy_text(t->source, sizeof t->source, e->scope);
            t->last_updated[0] = '\0';
            t->entry[0] = '\0';
            if (et->entry[0]) snprintf(t->module, sizeof t->module, "sdk-ext/%s/%s", e->id, et->entry);
            for (int a = 0; a < et->asset_count; ++a) t->assets[t->asset_count++] = strdup(et->assets[a]);
            t->valid = true;
        }
    }
}

void sdk_extensions_put_json(const SdkExtensions *ext, R2dSb *out)
{
    r2d_sb_puts(out, "\"extensions\":[");
    if (ext) {
        for (int i = 0; i < ext->count; ++i) {
            const SdkExtension *e = &ext->items[i];
            if (i) r2d_sb_putc(out, ',');
            r2d_sb_putc(out, '{');
            sdk_put_kv_str(out, "id", e->id[0] ? e->id : NULL);
            r2d_sb_putc(out, ',');
            sdk_put_kv_str(out, "name", e->name[0] ? e->name : NULL);
            r2d_sb_putc(out, ',');
            sdk_put_kv_str(out, "version", e->version[0] ? e->version : NULL);
            r2d_sb_putc(out, ',');
            sdk_put_kv_str(out, "scope", e->scope);
            r2d_sb_putc(out, ',');
            sdk_put_kv_str(out, "root", e->root);
            r2d_sb_putc(out, ',');
            sdk_put_kv_str(out, "manifest", e->manifest_path);
            r2d_sb_putc(out, ',');
            r2d_sb_printf(out, "\"sdk_api\":%d,\"valid\":%s,\"enabled\":%s,\"standalone\":%s,",
                          e->sdk_api, e->valid ? "true" : "false", e->enabled ? "true" : "false",
                          e->standalone ? "true" : "false");
            r2d_sb_puts(out, "\"permissions\":[");
            for (int p = 0; p < e->permission_count; ++p) {
                if (p) r2d_sb_putc(out, ',');
                r2d_sb_put_json_string(out, e->permissions[p]);
            }
            r2d_sb_puts(out, "],\"contributes\":{");
            r2d_sb_printf(out,
                          "\"tools\":%d,\"menus\":%d,\"toolbar\":%d,\"panels\":%d,\"inspectors\":%d,"
                          "\"entityDefinitions\":%d,\"worldTools\":%d,\"validators\":%d,"
                          "\"buildSteps\":%d,\"agentCommands\":%d",
                          e->tool_count, e->c_menus, e->c_toolbar, e->c_panels, e->c_inspectors,
                          e->c_entity_defs, e->c_world_tools, e->c_validators,
                          e->c_build_steps, e->c_agent_commands);
            r2d_sb_puts(out, "},\"toolIds\":[");
            for (int k = 0; k < e->tool_count; ++k) {
                if (k) r2d_sb_putc(out, ',');
                r2d_sb_put_json_string(out, e->tools[k].id);
            }
            r2d_sb_puts(out, "],");
            char module[640];
            module[0] = '\0';
            if (e->entry[0]) snprintf(module, sizeof module, "sdk-ext/%s/%s", e->id, e->entry);
            sdk_put_kv_str(out, "module", module[0] ? module : NULL);
            r2d_sb_putc(out, ',');
            sdk_put_kv_str(out, "contributesJson", e->contributes_json);
            r2d_sb_putc(out, '}');
        }
    }
    r2d_sb_putc(out, ']');
}

// ---------------------------------------------------------------------------
// Проверка одного каталога (extension validate PATH)
// ---------------------------------------------------------------------------
bool sdk_extension_validate_dir(const char *dir, const char *scope,
                                SdkExtension *out, SdkReport *rep)
{
    memset(out, 0, sizeof *out);
    char manifest[2200];
    if (!find_manifest(dir, manifest, sizeof manifest)) {
        sdk_diag(rep, SDK_ERROR, "SDK_EXTENSION_MANIFEST", dir, NULL, NULL,
                 "В каталоге нет манифеста extension.json, tool.json или manifest.json");
        return false;
    }
    return parse_manifest(dir, scope ? scope : "project", manifest, out, rep);
}

// ---------------------------------------------------------------------------
// Поиск и установка
// ---------------------------------------------------------------------------
static const SdkExtension *find_extension(const SdkExtensions *ext, const char *id)
{
    for (int i = 0; i < ext->count; ++i) {
        if (strcmp(ext->items[i].id, id) == 0) return &ext->items[i];
    }
    return NULL;
}

static bool copy_tree(const char *from, const char *to, SdkReport *rep);

typedef struct CopyWalk {
    const char *from_root;
    const char *to_root;
    SdkReport *rep;
    int files;
} CopyWalk;

static SDL_EnumerationResult SDLCALL copy_walk(void *ud, const char *dir, const char *fname)
{
    CopyWalk *w = (CopyWalk *)ud;
    char src[2400], dst[2400];
    snprintf(src, sizeof src, "%s/%s", dir, fname);
    if (sdk_is_dir(src)) {
        // Относительный путь от корня копии.
        const char *rel = src + strlen(w->from_root);
        while (*rel == '/' || *rel == '\\') rel++;
        snprintf(dst, sizeof dst, "%s/%s", w->to_root, rel);
        if (!ensure_dir(dst)) { w->rep ? sdk_diag(w->rep, SDK_ERROR, "SDK_TOOL_INSTALL", dst, NULL, NULL, "Не удалось создать каталог %s", dst) : (void)0; return SDL_ENUM_CONTINUE; }
        CopyWalk sub = { w->from_root, w->to_root, w->rep, 0 };
        SDL_EnumerateDirectory(src, copy_walk, &sub);
        w->files += sub.files;
        return SDL_ENUM_CONTINUE;
    }
    const char *rel = src + strlen(w->from_root);
    while (*rel == '/' || *rel == '\\') rel++;
    snprintf(dst, sizeof dst, "%s/%s", w->to_root, rel);
    char ddir[2400];
    sdk_dirname(dst, ddir, sizeof ddir);
    ensure_dir(ddir);
    size_t n = 0;
    char *data = sdk_read_file(src, &n);
    if (!data) return SDL_ENUM_CONTINUE;
    if (sdk_write_file(dst, data, n)) w->files++;
    free(data);
    return SDL_ENUM_CONTINUE;
}

static bool copy_tree(const char *from, const char *to, SdkReport *rep)
{
    if (!ensure_dir(to)) return false;
    CopyWalk w = { from, to, rep, 0 };
    SDL_EnumerateDirectory(from, copy_walk, &w);
    return w.files > 0;
}

static SDL_EnumerationResult SDLCALL remove_walk(void *ud, const char *dir, const char *fname)
{
    (void)ud;
    char full[2400];
    snprintf(full, sizeof full, "%s/%s", dir, fname);
    if (sdk_is_dir(full)) {
        SDL_EnumerateDirectory(full, remove_walk, NULL);
        SDL_RemovePath(full);
    } else {
        SDL_RemovePath(full);
    }
    return SDL_ENUM_CONTINUE;
}

static void remove_tree(const char *path)
{
    SDL_EnumerateDirectory(path, remove_walk, NULL);
    SDL_RemovePath(path);
}

// ---------------------------------------------------------------------------
// Аргументы и общий контекст команд
// ---------------------------------------------------------------------------
typedef struct ExtContext {
    char sdk_root[1200];
    char registry[1200];
    const char *project;
    const char *user_dir;
    const char *builtin_dir;
} ExtContext;

static void context_from_args(const SdkArgs *a, ExtContext *c)
{
    memset(c, 0, sizeof *c);
    const char *registry = sdk_arg_value(a, "--registry");
    if (registry && registry[0]) {
        make_absolute(registry, c->registry, sizeof c->registry);
        char dir[1200];
        sdk_dirname(c->registry, dir, sizeof dir);
        make_absolute(dir, c->sdk_root, sizeof c->sdk_root);
    } else {
        char *cwd = SDL_GetCurrentDirectory();
        if (cwd) { make_absolute(cwd, c->sdk_root, sizeof c->sdk_root); SDL_free(cwd); }
        snprintf(c->registry, sizeof c->registry, "%s/sdk_tools.json", c->sdk_root);
    }
    c->project = sdk_arg_value(a, "--project");
    c->user_dir = sdk_arg_value(a, "--user-extensions");
    c->builtin_dir = sdk_arg_value(a, "--builtin-extensions");
}

static void scan_context(const ExtContext *c, SdkExtensions *ext, SdkReport *rep)
{
    SdkExtOptions opt;
    memset(&opt, 0, sizeof opt);
    opt.sdk_root = c->sdk_root;
    opt.project_dir = c->project;
    opt.user_dir = c->user_dir;
    opt.builtin_dir = c->builtin_dir;
    sdk_extensions_scan(&opt, ext, rep);
}

static void put_roots(const SdkExtensions *ext, R2dSb *out)
{
    r2d_sb_puts(out, "\"roots\":{");
    sdk_put_kv_str(out, "builtin", ext->builtin_root[0] ? ext->builtin_root : NULL);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "user", ext->user_root[0] ? ext->user_root : NULL);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "project", ext->project_root[0] ? ext->project_root : NULL);
    r2d_sb_putc(out, '}');
}

static void put_report(SdkReport *rep, R2dSb *out)
{
    r2d_sb_putc(out, ',');
    sdk_report_put_counts(rep, out);
    r2d_sb_putc(out, ',');
    sdk_report_put(rep, out);
}

static void put_extension_detail(const SdkExtension *e, R2dSb *out)
{
    r2d_sb_putc(out, '{');
    sdk_put_kv_str(out, "id", e->id[0] ? e->id : NULL);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "name", e->name[0] ? e->name : NULL);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "description", e->description[0] ? e->description : NULL);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "version", e->version[0] ? e->version : NULL);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "scope", e->scope);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "root", e->root);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "manifest", e->manifest_path);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "entry", e->entry[0] ? e->entry : NULL);
    r2d_sb_putc(out, ',');
    r2d_sb_printf(out, "\"sdk_api\":%d,\"valid\":%s,\"enabled\":%s,\"standalone\":%s,",
                  e->sdk_api, e->valid ? "true" : "false", e->enabled ? "true" : "false",
                  e->standalone ? "true" : "false");
    r2d_sb_puts(out, "\"permissions\":[");
    for (int p = 0; p < e->permission_count; ++p) {
        if (p) r2d_sb_putc(out, ',');
        r2d_sb_put_json_string(out, e->permissions[p]);
    }
    r2d_sb_puts(out, "],\"tools\":[");
    for (int k = 0; k < e->tool_count; ++k) {
        if (k) r2d_sb_putc(out, ',');
        r2d_sb_putc(out, '{');
        sdk_put_kv_str(out, "id", e->tools[k].id);
        r2d_sb_putc(out, ',');
        sdk_put_kv_str(out, "name", e->tools[k].name);
        r2d_sb_putc(out, ',');
        sdk_put_kv_str(out, "entry", e->tools[k].entry);
        r2d_sb_putc(out, ',');
        sdk_put_kv_str(out, "category", e->tools[k].category);
        r2d_sb_putc(out, '}');
    }
    r2d_sb_puts(out, "]}");
}

// ---------------------------------------------------------------------------
// extension list | info | validate
// ---------------------------------------------------------------------------
static int ext_list(const SdkArgs *a)
{
    ExtContext c;
    context_from_args(a, &c);
    SdkReport rep;
    sdk_report_init(&rep);
    SdkExtensions ext;
    scan_context(&c, &ext, &rep);

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", rep.errors == 0 ? "true" : "false");
    put_roots(&ext, &out);
    r2d_sb_putc(&out, ',');
    sdk_extensions_put_json(&ext, &out);
    put_report(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    r2d_sb_free(&out);
    sdk_extensions_free(&ext);
    const int rc = rep.errors == 0 ? 0 : 1;
    sdk_report_free(&rep);
    return rc;
}

static int ext_info(const SdkArgs *a)
{
    const char *target = sdk_arg_positional(a, 1);
    SdkReport rep;
    sdk_report_init(&rep);
    if (!target) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d extension info <id|path>");
        sdk_report_free(&rep);
        return rc;
    }

    SdkExtension one;
    memset(&one, 0, sizeof one);
    bool found = false;
    const SdkExtension *found_ptr = NULL;
    SdkExtensions ext;
    memset(&ext, 0, sizeof ext);

    if (strchr(target, '/') || strchr(target, '\\')) {
        found = sdk_extension_validate_dir(target, "path", &one, &rep);
        found_ptr = &one;
    } else {
        ExtContext c;
        context_from_args(a, &c);
        scan_context(&c, &ext, &rep);
        found_ptr = find_extension(&ext, target);
        found = found_ptr != NULL;
        if (!found) {
            char full[2200];
            snprintf(full, sizeof full, "%s/%s", c.project ? c.project : ".", target);
            if (sdk_is_dir(full) && sdk_extension_validate_dir(full, "path", &one, &rep)) {
                found_ptr = &one;
                found = true;
            }
        }
    }

    if (!found_ptr) {
        R2dSb out;
        r2d_sb_init(&out);
        r2d_sb_puts(&out, "{\"ok\":false,");
        sdk_put_kv_str(&out, "extension", target);
        sdk_diag(&rep, SDK_ERROR, "SDK_EXTENSION_NOT_FOUND", target, NULL, NULL,
                 "Расширение «%s» не найдено (scope built-in/user/project)", target);
        put_report(&rep, &out);
        r2d_sb_putc(&out, '}');
        puts(out.data);
        r2d_sb_free(&out);
        sdk_extensions_free(&ext);
        sdk_report_free(&rep);
        return 1;
    }

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"ok\":true,\"extension\":");
    put_extension_detail(found_ptr, &out);
    put_report(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    r2d_sb_free(&out);
    sdk_extensions_free(&ext);
    // Ошибки ДРУГИХ расширений не делают info неуспешным: найденный объект валиден.
    const int rc = 0;
    sdk_report_free(&rep);
    return rc;
}

static int ext_validate(const SdkArgs *a)
{
    const char *target = sdk_arg_positional(a, 1);
    SdkReport rep;
    sdk_report_init(&rep);

    if (target) {
        SdkExtension one;
        const bool ok = sdk_extension_validate_dir(target, "path", &one, &rep);
        R2dSb out;
        r2d_sb_init(&out);
        r2d_sb_printf(&out, "{\"ok\":%s,", ok && rep.errors == 0 ? "true" : "false");
        r2d_sb_puts(&out, "\"extension\":");
        put_extension_detail(&one, &out);
        put_report(&rep, &out);
        r2d_sb_putc(&out, '}');
        puts(out.data);
        r2d_sb_free(&out);
        const int rc = ok && rep.errors == 0 ? 0 : 1;
        sdk_report_free(&rep);
        return rc;
    }

    ExtContext c;
    context_from_args(a, &c);
    SdkExtensions ext;
    scan_context(&c, &ext, &rep);
    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", rep.errors == 0 ? "true" : "false");
    put_roots(&ext, &out);
    r2d_sb_putc(&out, ',');
    sdk_extensions_put_json(&ext, &out);
    put_report(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    r2d_sb_free(&out);
    sdk_extensions_free(&ext);
    const int rc = rep.errors == 0 ? 0 : 1;
    sdk_report_free(&rep);
    return rc;
}

int sdk_cmd_extension(const SdkArgs *a)
{
    const char *sub = sdk_arg_positional(a, 0);
    if (!sub || strcmp(sub, "list") == 0) return ext_list(a);
    if (strcmp(sub, "info") == 0) return ext_info(a);
    if (strcmp(sub, "validate") == 0) return ext_validate(a);
    SdkReport rep;
    sdk_report_init(&rep);
    const int rc = sdk_fail(&rep, "SDK_USAGE",
                            "Использование: r2d extension list|info <id>|validate [path] [--project DIR]");
    sdk_report_free(&rep);
    return rc;
}

// ---------------------------------------------------------------------------
// tool list | info | validate | run | install | uninstall
// ---------------------------------------------------------------------------
static bool load_merged_registry(const ExtContext *c, SdkRegistry *reg,
                                 SdkExtensions *ext, SdkReport *rep)
{
    if (!sdk_file_exists(c->registry)) return false;
    if (!sdk_registry_load(c->registry, reg, rep)) return false;
    scan_context(c, ext, rep);
    sdk_extensions_append_tools(ext, reg, rep);
    return true;
}

static void put_tool_json(const SdkTool *t, R2dSb *out)
{
    r2d_sb_putc(out, '{');
    sdk_put_kv_str(out, "id", t->id);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "name", t->name);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "description", t->description);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "category", t->category[0] ? t->category : NULL);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "source", t->source[0] ? t->source : "builtin");
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "module", t->module[0] ? t->module : NULL);
    r2d_sb_putc(out, ',');
    sdk_put_kv_str(out, "entry", t->entry[0] ? t->entry : NULL);
    r2d_sb_puts(out, ",\"assets\":[");
    for (int i = 0; i < t->asset_count; ++i) {
        if (i) r2d_sb_putc(out, ',');
        r2d_sb_put_json_string(out, t->assets[i]);
    }
    r2d_sb_printf(out, "],\"valid\":%s}", t->valid ? "true" : "false");
}

static const SdkTool *find_tool(const SdkRegistry *reg, const char *id)
{
    for (int i = 0; i < reg->count; ++i) {
        if (strcmp(reg->tools[i].id, id) == 0) return &reg->tools[i];
    }
    return NULL;
}

static int tool_list(const SdkArgs *a)
{
    ExtContext c;
    context_from_args(a, &c);
    SdkReport rep;
    sdk_report_init(&rep);
    SdkRegistry reg;
    SdkExtensions ext;
    memset(&reg, 0, sizeof reg);
    memset(&ext, 0, sizeof ext);
    const bool loaded = sdk_file_exists(c.registry) &&
        sdk_registry_load(c.registry, &reg, &rep);
    if (loaded) {
        scan_context(&c, &ext, &rep);
        sdk_extensions_append_tools(&ext, &reg, &rep);
    }

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", loaded ? "true" : "false");
    sdk_put_kv_str(&out, "registry", c.registry);
    r2d_sb_putc(&out, ',');
    r2d_sb_puts(&out, "\"tools\":[");
    if (loaded) {
        for (int i = 0; i < reg.count; ++i) {
            if (i) r2d_sb_putc(&out, ',');
            put_tool_json(&reg.tools[i], &out);
        }
    }
    r2d_sb_puts(&out, "],");
    sdk_extensions_put_json(&ext, &out);
    put_report(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    r2d_sb_free(&out);
    if (loaded) sdk_registry_free(&reg);
    sdk_extensions_free(&ext);
    const int rc = loaded ? 0 : 1;
    sdk_report_free(&rep);
    return rc;
}

static int tool_info(const SdkArgs *a)
{
    const char *target = sdk_arg_positional(a, 1);
    ExtContext c;
    context_from_args(a, &c);
    SdkReport rep;
    sdk_report_init(&rep);
    if (!target) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d tool info <id|path>");
        sdk_report_free(&rep);
        return rc;
    }
    SdkRegistry reg;
    SdkExtensions ext;
    memset(&reg, 0, sizeof reg);
    memset(&ext, 0, sizeof ext);
    load_merged_registry(&c, &reg, &ext, &rep);
    const SdkTool *t = find_tool(&reg, target);

    R2dSb out;
    r2d_sb_init(&out);
    if (!t) {
        sdk_diag(&rep, SDK_ERROR, "SDK_TOOL_NOT_FOUND", target, NULL, NULL,
                 "Инструмент «%s» не найден в effective registry", target);
        r2d_sb_puts(&out, "{\"ok\":false");
        put_report(&rep, &out);
        r2d_sb_putc(&out, '}');
        puts(out.data);
        r2d_sb_free(&out);
        sdk_registry_free(&reg);
        sdk_extensions_free(&ext);
        sdk_report_free(&rep);
        return 1;
    }
    r2d_sb_puts(&out, "{\"ok\":true,\"tool\":");
    put_tool_json(t, &out);
    put_report(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    r2d_sb_free(&out);
    sdk_registry_free(&reg);
    sdk_extensions_free(&ext);
    sdk_report_free(&rep);
    return 0;
}

static int tool_run(const SdkArgs *a)
{
    const char *target = sdk_arg_positional(a, 1);
    ExtContext c;
    context_from_args(a, &c);
    SdkReport rep;
    sdk_report_init(&rep);
    if (!target) {
        const int rc = sdk_fail(&rep, "SDK_USAGE",
                                "Использование: r2d tool run <id|path> [--project DIR] [--headless] [--frames N]");
        sdk_report_free(&rep);
        return rc;
    }
    SdkRegistry reg;
    SdkExtensions ext;
    memset(&reg, 0, sizeof reg);
    memset(&ext, 0, sizeof ext);
    load_merged_registry(&c, &reg, &ext, &rep);
    const SdkTool *t = find_tool(&reg, target);
    if (!t) {
        sdk_diag(&rep, SDK_ERROR, "SDK_TOOL_NOT_FOUND", target, NULL, NULL,
                 "Инструмент «%s» не найден; список — r2d tool list", target);
        R2dSb out; r2d_sb_init(&out);
        r2d_sb_puts(&out, "{\"ok\":false");
        put_report(&rep, &out);
        r2d_sb_putc(&out, '}');
        puts(out.data); r2d_sb_free(&out);
        sdk_registry_free(&reg); sdk_extensions_free(&ext); sdk_report_free(&rep);
        return 1;
    }

    char engine[1200];
    if (!sdk_find_engine(sdk_arg_value(a, "--engine"), engine, sizeof engine)) {
        sdk_diag(&rep, SDK_ERROR, "SDK_TOOL_ENGINE", target, NULL, NULL,
                 "Бинарник движка russiano2d не найден: соберите проект (cmake --build build)");
    }

    // SDK-приложение читает запрос на открытие инструмента при старте (sdk/app.js).
    char request[2400];
    snprintf(request, sizeof request, "%s/sdk/.open-tool.json", c.sdk_root);
    char dir[2200];
    sdk_dirname(request, dir, sizeof dir);
    if (ensure_dir(dir)) {
        R2dSb payload;
        r2d_sb_init(&payload);
        r2d_sb_puts(&payload, "{\"id\":");
        r2d_sb_put_json_string(&payload, t->id);
        r2d_sb_puts(&payload, ",\"project\":");
        if (sdk_arg_value(a, "--project")) r2d_sb_put_json_string(&payload, sdk_arg_value(a, "--project"));
        else r2d_sb_puts(&payload, "null");
        r2d_sb_putc(&payload, '}');
        sdk_write_file(request, payload.data, payload.len);
        r2d_sb_free(&payload);
    }

    bool started = false;
    int exit_code = -1;
    char *out_text = NULL;
    if (engine[0]) {
        // Каталог R2D-приложения SDK: в этом репозитории это <sdk_root>/sdk
        // (там лежат project.json и main.js). `--game` явно старше.
        char game_dir[1400];
        const char *explicit_game = sdk_arg_value(a, "--game");
        if (explicit_game) {
            snprintf(game_dir, sizeof game_dir, "%s", explicit_game);
        } else {
            char probe[1500];
            snprintf(probe, sizeof probe, "%s/sdk/main.js", c.sdk_root);
            if (sdk_file_exists(probe)) snprintf(game_dir, sizeof game_dir, "%s/sdk", c.sdk_root);
            else snprintf(game_dir, sizeof game_dir, "%s", c.sdk_root);
        }
        const char *eargv[16];
        int n = 0;
        eargv[0] = engine;    // argv[0] — исполняемый файл, как в SDL_CreateProcess
        n = 1;
        eargv[n++] = "--game";
        eargv[n++] = game_dir;
        if (sdk_arg_flag(a, "--headless")) eargv[n++] = "--headless";
        const char *frames = sdk_arg_value(a, "--frames");
        if (frames) { eargv[n++] = "--frames"; eargv[n++] = frames; }
        eargv[n] = NULL;
        SdkProcResult res;
        memset(&res, 0, sizeof res);
        started = sdk_run_process(eargv, &res);
        exit_code = res.exit_code;
        out_text = res.out;
        if (!started) {
            sdk_diag(&rep, SDK_ERROR, "SDK_TOOL_ENGINE_START", t->id, NULL, NULL,
                     "Не удалось запустить движок: %s", engine);
        } else if (exit_code != 0) {
            char details[64];
            snprintf(details, sizeof details, "{\"exitCode\":%d}", exit_code);
            sdk_diag(&rep, SDK_ERROR, "SDK_TOOL_EXIT", t->id, NULL, details,
                     "Инструмент завершился с кодом %d", exit_code);
        }
    } else {
        sdk_diag(&rep, SDK_ERROR, "SDK_TOOL_ENGINE_START", t->id, NULL, NULL,
                 "Бинарник движка не найден: соберите проект (cmake --build build)");
    }

    // Если движок не прочитал запрос (не стартовал), файл не должен висеть.
    SDL_PathInfo req_info;
    if (!started && SDL_GetPathInfo(request, &req_info)) SDL_RemovePath(request);

    R2dSb out;
    r2d_sb_init(&out);
    const bool run_ok = started && exit_code == 0;
    r2d_sb_printf(&out, "{\"ok\":%s,", run_ok ? "true" : "false");
    sdk_put_kv_str(&out, "tool", t->id);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "module", t->module[0] ? t->module : NULL);
    r2d_sb_putc(&out, ',');
    r2d_sb_printf(&out, "\"launched\":%s,\"exitCode\":%d,", started ? "true" : "false", exit_code);
    sdk_put_kv_str(&out, "request", request);
    r2d_sb_putc(&out, ',');
    r2d_sb_puts(&out, "\"outputTail\":");
    if (out_text) {
        const size_t len = strlen(out_text);
        const size_t keep = len > 4000 ? 4000 : len;
        r2d_sb_put_json_string(&out, out_text + (len - keep));
    } else {
        r2d_sb_puts(&out, "null");
    }
    put_report(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    r2d_sb_free(&out);
    free(out_text);
    sdk_registry_free(&reg);
    sdk_extensions_free(&ext);
    // Ошибки чужих расширений не делают запуск неуспешным: инструмент реально стартовал.
    const int rc = run_ok ? 0 : 1;
    sdk_report_free(&rep);
    return rc;
}

static int tool_install(const SdkArgs *a)
{
    const char *src = sdk_arg_positional(a, 1);
    ExtContext c;
    context_from_args(a, &c);
    SdkReport rep;
    sdk_report_init(&rep);
    if (!src) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d tool install <каталог>");
        sdk_report_free(&rep);
        return rc;
    }
    SdkExtension one;
    const bool ok = sdk_extension_validate_dir(src, "user", &one, &rep);
    if (!ok || !one.id[0] || rep.errors > 0) {
        R2dSb out; r2d_sb_init(&out);
        r2d_sb_puts(&out, "{\"ok\":false");
        put_report(&rep, &out);
        r2d_sb_putc(&out, '}');
        puts(out.data); r2d_sb_free(&out);
        sdk_report_free(&rep);
        return 1;
    }

    char user_root[1200];
    if (c.user_dir && c.user_dir[0]) make_absolute(c.user_dir, user_root, sizeof user_root);
    else default_user_root(user_root, sizeof user_root);
    char dest[1400];
    snprintf(dest, sizeof dest, "%s/%s", user_root, one.id);
    if (sdk_is_dir(dest)) {
        sdk_diag(&rep, SDK_ERROR, "SDK_TOOL_ALREADY_INSTALLED", dest, NULL, NULL,
                 "Расширение «%s» уже установлено: %s (сначала tool uninstall)", one.id, dest);
        R2dSb out; r2d_sb_init(&out);
        r2d_sb_puts(&out, "{\"ok\":false");
        put_report(&rep, &out);
        r2d_sb_putc(&out, '}');
        puts(out.data); r2d_sb_free(&out);
        sdk_report_free(&rep);
        return 1;
    }
    ensure_dir(user_root);
    const bool copied = copy_tree(src, dest, &rep);
    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", copied ? "true" : "false");
    sdk_put_kv_str(&out, "id", one.id);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "installed", dest);
    put_report(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    r2d_sb_free(&out);
    const int rc = copied ? 0 : 1;
    sdk_report_free(&rep);
    return rc;
}

static int tool_uninstall(const SdkArgs *a)
{
    const char *id = sdk_arg_positional(a, 1);
    ExtContext c;
    context_from_args(a, &c);
    SdkReport rep;
    sdk_report_init(&rep);
    if (!id) {
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d tool uninstall <id>");
        sdk_report_free(&rep);
        return rc;
    }
    char user_root[1200];
    if (c.user_dir && c.user_dir[0]) make_absolute(c.user_dir, user_root, sizeof user_root);
    else default_user_root(user_root, sizeof user_root);

    SdkExtOptions opt;
    memset(&opt, 0, sizeof opt);
    opt.sdk_root = c.sdk_root;
    opt.user_dir = user_root;
    SdkExtensions ext;
    SdkReport scan_rep;
    sdk_report_init(&scan_rep);
    sdk_extensions_scan(&opt, &ext, &scan_rep);
    sdk_report_free(&scan_rep);

    const SdkExtension *e = find_extension(&ext, id);
    char dest[1400] = "";
    if (e) snprintf(dest, sizeof dest, "%s", e->root);
    if (!e || !sdk_is_dir(dest)) {
        sdk_diag(&rep, SDK_ERROR, "SDK_TOOL_NOT_INSTALLED", id, NULL, NULL,
                 "Расширение «%s» не установлено в user-каталоге %s", id, user_root);
        R2dSb out; r2d_sb_init(&out);
        r2d_sb_puts(&out, "{\"ok\":false");
        put_report(&rep, &out);
        r2d_sb_putc(&out, '}');
        puts(out.data); r2d_sb_free(&out);
        sdk_extensions_free(&ext);
        sdk_report_free(&rep);
        return 1;
    }
    remove_tree(dest);
    const bool gone = !sdk_is_dir(dest);
    if (!gone) {
        sdk_diag(&rep, SDK_ERROR, "SDK_TOOL_UNINSTALL", dest, NULL, NULL,
                 "Не удалось удалить %s", dest);
    }
    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", gone ? "true" : "false");
    sdk_put_kv_str(&out, "id", id);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "removed", dest);
    put_report(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    r2d_sb_free(&out);
    sdk_extensions_free(&ext);
    const int rc = gone ? 0 : 1;
    sdk_report_free(&rep);
    return rc;
}

int sdk_cmd_tool(const SdkArgs *a)
{
    const char *sub = sdk_arg_positional(a, 0);
    if (!sub || strcmp(sub, "list") == 0) return tool_list(a);
    if (strcmp(sub, "info") == 0) return tool_info(a);
    if (strcmp(sub, "validate") == 0) return ext_validate(a);
    if (strcmp(sub, "run") == 0) return tool_run(a);
    if (strcmp(sub, "install") == 0) return tool_install(a);
    if (strcmp(sub, "uninstall") == 0) return tool_uninstall(a);
    SdkReport rep;
    sdk_report_init(&rep);
    const int rc = sdk_fail(&rep, "SDK_USAGE",
                            "Использование: r2d tool list|info <id>|validate [path]|run <id>|install <path>|uninstall <id>");
    sdk_report_free(&rep);
    return rc;
}
