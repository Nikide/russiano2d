// ===========================================================================
// Шаблоны проектов и сборки движка (docs/SDK.md §3, §4).
//
//   r2d-sdk templates [--root sdk/templates]
//   r2d-sdk new <шаблон> <каталог> [--name «Имя»] [--root sdk/templates]
//   r2d-sdk engines
//
// Шаблон — обычный каталог `sdk/templates/<id>/` с `template.json`
// ({name, description, category}) и файлами проекта. `new` копирует файлы как
// есть (никакой скрытой базы): после этого SDK проекту не нужен. В текстовых
// файлах метка `{{name}}` заменяется именем проекта.
// ===========================================================================
#include "sdk.h"

#include <SDL3/SDL.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_TEMPLATES 64
#define MAX_COPY_FILES 4096
#define MAX_COPY_DEPTH 12
#define MAX_TEXT_REPLACE (1u << 20)

static void emit(R2dSb *out)
{
    puts(out->data);
    fflush(stdout);
}

// Каталог шаблонов: --root, ./sdk/templates, рядом с бинарником.
static bool templates_root(const SdkArgs *a, char *out, size_t cap)
{
    const char *given = sdk_arg_value(a, "--root");
    if (given) {
        snprintf(out, cap, "%s", given);
        return sdk_is_dir(out);
    }
    char cand[1536];
    snprintf(cand, sizeof cand, "sdk/templates");
    if (sdk_is_dir(cand)) { snprintf(out, cap, "%s", cand); return true; }
    sdk_join(sdk_exe_dir(), "sdk/templates", cand, sizeof cand);
    if (sdk_is_dir(cand)) { snprintf(out, cap, "%s", cand); return true; }
    sdk_join(sdk_exe_dir(), "../sdk/templates", cand, sizeof cand);
    if (sdk_is_dir(cand)) { snprintf(out, cap, "%s", cand); return true; }
    return false;
}

static bool id_ok(const char *id)
{
    if (!id || !id[0] || strlen(id) > 63) return false;
    for (const char *p = id; *p; ++p) {
        const bool good = (*p >= 'a' && *p <= 'z') || (*p >= '0' && *p <= '9') || *p == '-' || *p == '_';
        if (!good) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Перечисление
// ---------------------------------------------------------------------------
typedef struct NameList {
    char *names[MAX_TEMPLATES];
    int count;
} NameList;

static SDL_EnumerationResult SDLCALL on_template_dir(void *user, const char *dirname, const char *fname)
{
    NameList *l = (NameList *)user;
    (void)dirname;
    if (fname[0] == '.' || l->count >= MAX_TEMPLATES) return SDL_ENUM_CONTINUE;
    l->names[l->count++] = strdup(fname);
    return SDL_ENUM_CONTINUE;
}

static int cmp_str(const void *a, const void *b)
{
    return strcmp(*(char *const *)a, *(char *const *)b);
}

typedef struct CountCtx {
    const char *dir;
    int files;
    int64_t bytes;
    int depth;
} CountCtx;

static SDL_EnumerationResult SDLCALL on_count(void *user, const char *dirname, const char *fname)
{
    CountCtx *c = (CountCtx *)user;
    (void)dirname;
    char full[2048];
    snprintf(full, sizeof full, "%s/%s", c->dir, fname);
    SDL_PathInfo info;
    if (!SDL_GetPathInfo(full, &info)) return SDL_ENUM_CONTINUE;
    if (info.type == SDL_PATHTYPE_DIRECTORY) {
        if (c->depth < MAX_COPY_DEPTH) {
            CountCtx sub = { full, 0, 0, c->depth + 1 };
            SDL_EnumerateDirectory(full, on_count, &sub);
            c->files += sub.files;
            c->bytes += sub.bytes;
        }
    } else if (info.type == SDL_PATHTYPE_FILE && strcmp(fname, "template.json") != 0) {
        c->files++;
        c->bytes += (int64_t)info.size;
    }
    return SDL_ENUM_CONTINUE;
}

int sdk_cmd_templates(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    char root[1536];
    if (!templates_root(a, root, sizeof root)) {
        const int rc = sdk_fail(&rep, "SDK_TEMPLATES_NOT_FOUND",
                                "Каталог шаблонов не найден: укажите --root <каталог> (обычно sdk/templates)");
        sdk_report_free(&rep);
        return rc;
    }
    NameList names = { {0}, 0 };
    SDL_EnumerateDirectory(root, on_template_dir, &names);
    qsort(names.names, (size_t)names.count, sizeof names.names[0], cmp_str);

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"templates\":[");
    int listed = 0;
    for (int i = 0; i < names.count; ++i) {
        char dir[2048], meta[2200];
        snprintf(dir, sizeof dir, "%s/%s", root, names.names[i]);
        if (!sdk_is_dir(dir)) continue;
        snprintf(meta, sizeof meta, "%s/template.json", dir);
        if (!id_ok(names.names[i])) {
            sdk_diag(&rep, SDK_ERROR, "SDK_TEMPLATE_ID", dir, NULL, NULL,
                     "Имя каталога шаблона «%s» должно состоять из a-z, 0-9, «-», «_»", names.names[i]);
            continue;
        }
        R2dJson *info = sdk_file_exists(meta) ? sdk_load_json(meta, &rep) : NULL;
        if (!info) {
            if (!sdk_file_exists(meta)) {
                sdk_diag(&rep, SDK_WARNING, "SDK_TEMPLATE_NO_META", dir, NULL, NULL,
                         "В шаблоне «%s» нет template.json — он не показан", names.names[i]);
            }
            continue;
        }
        char proj[2200];
        snprintf(proj, sizeof proj, "%s/project.json", dir);
        if (!sdk_file_exists(proj)) {
            sdk_diag(&rep, SDK_ERROR, "SDK_TEMPLATE_NO_PROJECT", dir, NULL, NULL,
                     "В шаблоне «%s» нет project.json", names.names[i]);
        }
        CountCtx cc = { dir, 0, 0, 0 };
        SDL_EnumerateDirectory(dir, on_count, &cc);
        if (listed++) r2d_sb_putc(&out, ',');
        r2d_sb_putc(&out, '{');
        sdk_put_kv_str(&out, "id", names.names[i]);
        r2d_sb_putc(&out, ',');
        sdk_put_kv_str(&out, "name", r2d_json_str(r2d_json_get(info, "name"), names.names[i]));
        r2d_sb_putc(&out, ',');
        sdk_put_kv_str(&out, "description", r2d_json_str(r2d_json_get(info, "description"), ""));
        r2d_sb_putc(&out, ',');
        sdk_put_kv_str(&out, "category", r2d_json_str(r2d_json_get(info, "category"), ""));
        r2d_sb_putc(&out, ',');
        sdk_put_kv_str(&out, "path", dir);
        r2d_sb_printf(&out, ",\"files\":%d,\"bytes\":%lld}", cc.files, (long long)cc.bytes);
        r2d_json_free(info);
    }
    r2d_sb_puts(&out, "],");
    sdk_put_kv_str(&out, "root", root);
    r2d_sb_printf(&out, ",\"count\":%d,\"ok\":%s,", listed, rep.errors ? "false" : "true");
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    emit(&out);

    for (int i = 0; i < names.count; ++i) free(names.names[i]);
    const int rc = rep.errors ? 1 : 0;
    r2d_sb_free(&out);
    sdk_report_free(&rep);
    return rc;
}

// ---------------------------------------------------------------------------
// new: копирование шаблона
// ---------------------------------------------------------------------------
typedef struct CopyCtx {
    const char *src;
    const char *dst;
    const char *name;
    SdkReport *rep;
    int *files;
    int depth;
    bool failed;
} CopyCtx;

static bool is_text_name(const char *name)
{
    static const char *const exts[] = { ".json", ".js", ".mjs", ".rml", ".rcss", ".md", ".txt", ".csv", NULL };
    for (int i = 0; exts[i]; ++i) if (sdk_ends_with(name, exts[i])) return true;
    return false;
}

// Заменяет «{{name}}» на имя проекта (экранированное для JSON, если файл .json).
static char *replace_name(const char *text, size_t size, const char *name, bool json, size_t *out_size)
{
    R2dSb sb;
    r2d_sb_init(&sb);
    R2dSb esc;
    r2d_sb_init(&esc);
    if (json) {
        r2d_sb_put_json_string(&esc, name);
        // без внешних кавычек
        memmove(esc.data, esc.data + 1, esc.len - 2);
        esc.len -= 2;
        esc.data[esc.len] = '\0';
    }
    const char *value = json ? esc.data : name;
    const size_t mark_len = 8;   // «{{name}}»
    for (size_t i = 0; i < size;) {
        if (i + mark_len <= size && memcmp(text + i, "{{name}}", mark_len) == 0) {
            r2d_sb_puts(&sb, value);
            i += mark_len;
        } else {
            r2d_sb_putc(&sb, text[i++]);
        }
    }
    *out_size = sb.len;
    r2d_sb_free(&esc);
    return r2d_sb_take(&sb);
}

static SDL_EnumerationResult SDLCALL on_copy(void *user, const char *dirname, const char *fname)
{
    CopyCtx *c = (CopyCtx *)user;
    (void)dirname;
    if (c->failed) return SDL_ENUM_FAILURE;
    char from[2048], to[2048];
    snprintf(from, sizeof from, "%s/%s", c->src, fname);
    snprintf(to, sizeof to, "%s/%s", c->dst, fname);
    SDL_PathInfo info;
    if (!SDL_GetPathInfo(from, &info)) return SDL_ENUM_CONTINUE;

    if (info.type == SDL_PATHTYPE_DIRECTORY) {
        if (c->depth >= MAX_COPY_DEPTH) {
            sdk_diag(c->rep, SDK_ERROR, "SDK_TEMPLATE_DEPTH", from, NULL, NULL, "Слишком глубокая вложенность шаблона");
            c->failed = true;
            return SDL_ENUM_FAILURE;
        }
        if (!SDL_CreateDirectory(to)) {
            sdk_diag(c->rep, SDK_ERROR, "SDK_NEW_WRITE", to, NULL, NULL, "Не удалось создать каталог: %s", SDL_GetError());
            c->failed = true;
            return SDL_ENUM_FAILURE;
        }
        CopyCtx sub = *c;
        sub.src = from;
        sub.dst = to;
        sub.depth = c->depth + 1;
        SDL_EnumerateDirectory(from, on_copy, &sub);
        if (sub.failed) c->failed = true;
        return c->failed ? SDL_ENUM_FAILURE : SDL_ENUM_CONTINUE;
    }
    if (info.type != SDL_PATHTYPE_FILE) return SDL_ENUM_CONTINUE;
    if (c->depth == 0 && strcmp(fname, "template.json") == 0) return SDL_ENUM_CONTINUE;
    if (*c->files >= MAX_COPY_FILES) {
        sdk_diag(c->rep, SDK_ERROR, "SDK_TEMPLATE_TOO_BIG", from, NULL, NULL, "В шаблоне больше %d файлов", MAX_COPY_FILES);
        c->failed = true;
        return SDL_ENUM_FAILURE;
    }
    size_t size = 0;
    char *data = sdk_read_file(from, &size);
    if (!data) {
        sdk_diag(c->rep, SDK_ERROR, "SDK_NEW_READ", from, NULL, NULL, "Не удалось прочитать файл шаблона");
        c->failed = true;
        return SDL_ENUM_FAILURE;
    }
    char *payload = data;
    size_t payload_size = size;
    if (is_text_name(fname) && size <= MAX_TEXT_REPLACE) {
        payload = replace_name(data, size, c->name, sdk_ends_with(fname, ".json"), &payload_size);
    }
    const bool ok = sdk_write_file(to, payload, payload_size);
    if (payload != data) free(payload);
    free(data);
    if (!ok) {
        sdk_diag(c->rep, SDK_ERROR, "SDK_NEW_WRITE", to, NULL, NULL, "Не удалось записать файл");
        c->failed = true;
        return SDL_ENUM_FAILURE;
    }
    (*c->files)++;
    return SDL_ENUM_CONTINUE;
}

typedef struct EmptyCtx { bool any; } EmptyCtx;

static SDL_EnumerationResult SDLCALL on_any(void *user, const char *dirname, const char *fname)
{
    (void)dirname;
    (void)fname;
    ((EmptyCtx *)user)->any = true;
    return SDL_ENUM_FAILURE;
}

int sdk_cmd_new(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *id = sdk_arg_positional(a, 0);
    const char *dest = sdk_arg_positional(a, 1);
    if (!id || !dest) {
        const int rc = sdk_fail(&rep, "SDK_USAGE",
            "Использование: r2d-sdk new <шаблон> <каталог проекта> [--name «Имя»] [--root sdk/templates]");
        sdk_report_free(&rep);
        return rc;
    }
    char root[1536];
    if (!templates_root(a, root, sizeof root)) {
        const int rc = sdk_fail(&rep, "SDK_TEMPLATES_NOT_FOUND", "Каталог шаблонов не найден: укажите --root");
        sdk_report_free(&rep);
        return rc;
    }
    int files = 0;
    char src[2048];
    snprintf(src, sizeof src, "%s/%s", root, id);
    const char *base = sdk_basename(dest);
    const char *name = sdk_arg_value(a, "--name");
    if (!name || !name[0]) name = base;

    if (!id_ok(id)) {
        sdk_diag(&rep, SDK_ERROR, "SDK_TEMPLATE_ID", NULL, NULL, NULL, "Некорректное имя шаблона «%s»", id);
    } else if (!sdk_is_dir(src)) {
        sdk_diag(&rep, SDK_ERROR, "SDK_TEMPLATE_NOT_FOUND", src, NULL, NULL, "Шаблон «%s» не найден в %s", id, root);
    } else if (sdk_file_exists(dest) && !sdk_is_dir(dest)) {
        sdk_diag(&rep, SDK_ERROR, "SDK_DEST_EXISTS", dest, NULL, NULL, "%s — файл, а не каталог", dest);
    } else {
        bool occupied = false;
        if (sdk_is_dir(dest)) {
            EmptyCtx e = { false };
            SDL_EnumerateDirectory(dest, on_any, &e);
            occupied = e.any;
        }
        if (occupied) {
            sdk_diag(&rep, SDK_ERROR, "SDK_DEST_EXISTS", dest, NULL, NULL,
                     "Каталог %s не пуст: SDK ничего не перезаписывает — выберите новый путь", dest);
        } else if (!SDL_CreateDirectory(dest)) {
            sdk_diag(&rep, SDK_ERROR, "SDK_NEW_WRITE", dest, NULL, NULL, "Не удалось создать каталог: %s", SDL_GetError());
        } else {
            CopyCtx c = { src, dest, name, &rep, &files, 0, false };
            SDL_EnumerateDirectory(src, on_copy, &c);
        }
    }

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", rep.errors ? "false" : "true");
    sdk_put_kv_str(&out, "template", id);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "dest", dest);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "name", name);
    r2d_sb_printf(&out, ",\"files\":%d,", files);
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    emit(&out);
    const int rc = rep.errors ? 1 : 0;
    r2d_sb_free(&out);
    sdk_report_free(&rep);
    return rc;
}

// ---------------------------------------------------------------------------
// engines
// ---------------------------------------------------------------------------
typedef struct EngineRow {
    char    path[1536];
    char    label[96];
    int64_t size;
    int64_t mtime;
} EngineRow;

static void add_engine(EngineRow *rows, int *count, const char *path, const char *label)
{
    if (*count >= 32) return;
    SDL_PathInfo info;
    if (!SDL_GetPathInfo(path, &info) || info.type != SDL_PATHTYPE_FILE) return;
    for (int i = 0; i < *count; ++i) {
        if (strcmp(rows[i].path, path) == 0) return;
    }
    EngineRow *r = &rows[(*count)++];
    snprintf(r->path, sizeof r->path, "%s", path);
    snprintf(r->label, sizeof r->label, "%s", label);
    r->size = (int64_t)info.size;
    r->mtime = (int64_t)(info.modify_time / 1000000000LL);
}

typedef struct DistCtx {
    EngineRow *rows;
    int *count;
    const char *dir;
} DistCtx;

static SDL_EnumerationResult SDLCALL on_dist(void *user, const char *dirname, const char *fname)
{
    DistCtx *d = (DistCtx *)user;
    (void)dirname;
    char sub[2048], exe[2200], label[96];
    snprintf(sub, sizeof sub, "%s/%s", d->dir, fname);
    if (!sdk_is_dir(sub)) return SDL_ENUM_CONTINUE;
    snprintf(exe, sizeof exe, "%s/russiano2d", sub);
    snprintf(label, sizeof label, "dist/%s", fname);
    add_engine(d->rows, d->count, exe, label);
    snprintf(exe, sizeof exe, "%s/russiano2d.exe", sub);
    add_engine(d->rows, d->count, exe, label);
    return SDL_ENUM_CONTINUE;
}

int sdk_cmd_engines(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    EngineRow rows[32];
    int count = 0;
    char path[1536], selected[1536];
    selected[0] = '\0';
    const bool have_selected = sdk_find_engine(sdk_arg_value(a, "--engine"), selected, sizeof selected);

    const char *env = SDL_getenv("R2D_ENGINE");
    if (env && env[0]) add_engine(rows, &count, env, "R2D_ENGINE");
    sdk_join(sdk_exe_dir(), "russiano2d", path, sizeof path);
    add_engine(rows, &count, path, "рядом с r2d-sdk");
    sdk_join(sdk_exe_dir(), "russiano2d.exe", path, sizeof path);
    add_engine(rows, &count, path, "рядом с r2d-sdk");
    sdk_join(sdk_exe_dir(), "../dist", path, sizeof path);
    if (sdk_is_dir(path)) {
        DistCtx d = { rows, &count, path };
        SDL_EnumerateDirectory(path, on_dist, &d);
    }
    sdk_join(sdk_exe_dir(), "../russiano2d", path, sizeof path);
    add_engine(rows, &count, path, "каталог проекта");

    if (!have_selected) {
        sdk_diag(&rep, SDK_ERROR, "SDK_ENGINE_NOT_FOUND", NULL, NULL, NULL,
                 "Бинарник движка не найден: запуск и сборка игр невозможны, соберите движок или задайте R2D_ENGINE");
    }

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"engines\":[", rep.errors ? "false" : "true");
    for (int i = 0; i < count; ++i) {
        if (i) r2d_sb_putc(&out, ',');
        r2d_sb_putc(&out, '{');
        sdk_put_kv_str(&out, "path", rows[i].path);
        r2d_sb_putc(&out, ',');
        sdk_put_kv_str(&out, "label", rows[i].label);
        r2d_sb_printf(&out, ",\"size\":%lld,\"mtime\":%lld,\"selected\":%s}", (long long)rows[i].size,
                      (long long)rows[i].mtime, have_selected && strcmp(rows[i].path, selected) == 0 ? "true" : "false");
    }
    r2d_sb_printf(&out, "],\"count\":%d,", count);
    sdk_put_kv_str(&out, "selected", have_selected ? selected : NULL);
    r2d_sb_putc(&out, ',');
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    emit(&out);
    const int rc = rep.errors ? 1 : 0;
    r2d_sb_free(&out);
    sdk_report_free(&rep);
    return rc;
}
