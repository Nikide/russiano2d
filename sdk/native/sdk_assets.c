// ===========================================================================
// Asset Browser: реальная файловая структура проекта + типы ассетов
// (docs/SDK.md §4). Никакой базы ассетов: тип выводится из имени файла, а
// инструмент, открывающий файл, — из шаблонов `assets` реестра.
// ===========================================================================
#include "sdk.h"

#include <SDL3/SDL.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct TypeRule {
    const char *suffix;
    const char *type;
} TypeRule;

// Порядок важен: более длинные суффиксы раньше коротких.
static const TypeRule k_rules[] = {
    { ".character.json",  "re2dsprite.character" },
    { ".animations.json", "re2dsprite.animations" },
    { ".surface.json",    "re2d.surface" },
    { ".atlas.json",      "sprite.atlas" },
    { ".tilemap.json",    "tilemap" },
    { ".particles.json",  "particles" },
    { ".bake.json",       "re2d.bake" },
    { ".re2dmap.json",    "re2d.world" },
    { ".re2dmap",         "re2d.world" },
    { ".r2replay",        "replay" },
    { "project.json",     "project" },
    { "sdk_tools.json",   "sdk.registry" },
    { ".json",            "json" },
    { ".png",             "image" },
    { ".jpg",             "image" },
    { ".jpeg",            "image" },
    { ".bmp",             "image" },
    { ".webp",            "image" },
    { ".ogg",             "audio" },
    { ".wav",             "audio" },
    { ".mp3",             "audio" },
    { ".flac",            "audio" },
    { ".rml",             "rmlui.document" },
    { ".rcss",            "rmlui.style" },
    { ".js",              "script" },
    { ".mjs",             "script" },
    { ".glb",             "model.glb" },
    { ".gltf",            "model.gltf" },
    { ".vrm",             "model.vrm" },
    { ".obj",             "model.obj" },
    { ".fbx",             "model.fbx" },
    { ".ttf",             "font" },
    { ".otf",             "font" },
    { ".md",              "doc" },
    { ".txt",             "doc" },
    { ".csv",             "data" },
};

const char *sdk_asset_type(const char *path)
{
    const char *name = sdk_basename(path);
    for (size_t i = 0; i < sizeof k_rules / sizeof k_rules[0]; ++i) {
        if (sdk_ends_with(name, k_rules[i].suffix)) return k_rules[i].type;
    }
    return "file";
}

static bool skip_dir(const char *name)
{
    return name[0] == '.' || strcmp(name, "node_modules") == 0 || strcmp(name, "_deps") == 0
        || strncmp(name, "build", 5) == 0 || strcmp(name, "CMakeFiles") == 0
        || strcmp(name, "__pycache__") == 0;
}

typedef struct ScanCtx {
    const char *root;
    const SdkRegistry *reg;
    SdkAssets *out;
    int depth;
} ScanCtx;

#define SDK_ASSETS_MAX 20000
#define SDK_ASSETS_DEPTH 16

static void tool_for(const SdkRegistry *reg, const char *name, char out[64])
{
    out[0] = '\0';
    if (!reg) return;
    for (int i = 0; i < reg->count; ++i) {
        const SdkTool *t = &reg->tools[i];
        if (!t->valid) continue;
        for (int k = 0; k < t->asset_count; ++k) {
            if (sdk_glob_match(t->assets[k], name)) {
                snprintf(out, 64, "%s", t->id);
                return;
            }
        }
    }
}

static void scan_dir(ScanCtx *ctx, const char *rel);

typedef struct EnumCtx {
    ScanCtx *scan;
    const char *rel;
} EnumCtx;

static SDL_EnumerationResult SDLCALL on_entry(void *user, const char *dirname, const char *fname)
{
    EnumCtx *e = (EnumCtx *)user;
    ScanCtx *ctx = e->scan;
    SdkAssets *out = ctx->out;
    (void)dirname;
    if (out->count >= SDK_ASSETS_MAX) {
        out->truncated = true;
        return SDL_ENUM_FAILURE;
    }

    char rel[1536];
    if (e->rel[0]) snprintf(rel, sizeof rel, "%s/%s", e->rel, fname);
    else snprintf(rel, sizeof rel, "%s", fname);
    char full[2048];
    snprintf(full, sizeof full, "%s/%s", ctx->root, rel);

    SDL_PathInfo info;
    if (!SDL_GetPathInfo(full, &info)) return SDL_ENUM_CONTINUE;

    if (info.type == SDL_PATHTYPE_DIRECTORY) {
        if (!skip_dir(fname) && ctx->depth < SDK_ASSETS_DEPTH) {
            ctx->depth++;
            scan_dir(ctx, rel);
            ctx->depth--;
        }
        return SDL_ENUM_CONTINUE;
    }
    if (info.type != SDL_PATHTYPE_FILE) return SDL_ENUM_CONTINUE;

    if (out->count == out->cap) {
        const int cap = out->cap ? out->cap * 2 : 256;
        SdkAssetEntry *grown = (SdkAssetEntry *)realloc(out->items, (size_t)cap * sizeof *grown);
        if (!grown) return SDL_ENUM_FAILURE;
        out->items = grown;
        out->cap = cap;
    }
    SdkAssetEntry *item = &out->items[out->count++];
    memset(item, 0, sizeof *item);
    item->path = strdup(rel);
    item->type = sdk_asset_type(rel);
    item->size = (int64_t)info.size;
    item->mtime = (int64_t)(info.modify_time / 1000000000LL);
    tool_for(ctx->reg, fname, item->tool);
    return SDL_ENUM_CONTINUE;
}

static void scan_dir(ScanCtx *ctx, const char *rel)
{
    char full[2048];
    if (rel[0]) snprintf(full, sizeof full, "%s/%s", ctx->root, rel);
    else snprintf(full, sizeof full, "%s", ctx->root);
    EnumCtx e = { ctx, rel };
    SDL_EnumerateDirectory(full, on_entry, &e);
}

static int cmp_entry(const void *a, const void *b)
{
    return strcmp(((const SdkAssetEntry *)a)->path, ((const SdkAssetEntry *)b)->path);
}

bool sdk_assets_scan(const char *root, const SdkRegistry *reg, SdkAssets *out, SdkReport *rep)
{
    memset(out, 0, sizeof *out);
    if (!sdk_is_dir(root)) {
        sdk_diag(rep, SDK_ERROR, "SDK_PROJECT_NOT_FOUND", root, NULL, NULL,
                 "Каталог проекта не найден: %s", root);
        return false;
    }
    ScanCtx ctx = { root, reg, out, 0 };
    scan_dir(&ctx, "");
    // Порядок обхода каталога зависит от файловой системы: сортируем, чтобы
    // ответ был детерминированным (для тестов, git diff и агента).
    if (out->count > 1) qsort(out->items, (size_t)out->count, sizeof *out->items, cmp_entry);
    if (out->truncated) {
        sdk_diag(rep, SDK_WARNING, "SDK_ASSETS_TRUNCATED", root, NULL, NULL,
                 "Найдено больше %d файлов — список обрезан", SDK_ASSETS_MAX);
    }
    return true;
}

void sdk_assets_free(SdkAssets *a)
{
    for (int i = 0; i < a->count; ++i) free(a->items[i].path);
    free(a->items);
    memset(a, 0, sizeof *a);
}
