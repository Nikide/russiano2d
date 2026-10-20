// ===========================================================================
// Граф зависимостей ассетов и инкрементальная пересборка (docs/SDK.md §4,
// docs/SDK_IMPLEMENTATION_GAPS.md §2).
//
// Канонические файлы игры остаются обычными файлами: манифест зависимостей —
// это JSON рядом с проектом, кэш — .r2d/cache/assets.json, который читает
// только r2d-sdk (runtime его не читает никогда). Второго build system и
// закрытой ассет-базы здесь нет: команда лишь говорит, что устарело.
//
//   r2d-sdk deps <проект|deps.json> [--check|--record] [--json]
//
// Манифест (форма для тестов и реальных проектов):
//   {
//     "version": 1,
//     "nodes": [
//       { "source": "art/hero.png",
//         "deps": ["art/palette.json"],
//         "outputs": ["art/hero.atlas.json"],
//         "baker": "atlas-grid",
//         "version": 1,
//         "options": { "cell": "32x32" } }   // "options" — любой JSON
//     ]
//   }
//
// Узел — один источник (source), его входы (deps), сгенерированные выходы
// (outputs) и identity повара (baker + version + options). deps может
// ссылаться и на source, и на outputs другого узла: тогда устаревание идёт по
// графу (транзитивно). Содержимое изменённого источника помечает устаревшими
// только его зависимые узлы; при неизменном содержимом узел считается
// актуальным, даже если mtime поменялся.
//
// Кэш (.r2d/cache/assets.json) хранит: путь источника, FNV-1a 64 содержимого,
// mtime, размер, список зависимостей и выходов с их хешами, baker, версию
// importer'а и options. Он служебный: в git не нужен, runtime его не читает,
// а потеря кэша — это «всё stale», а не молчаливая пересборка.
//
// Диагностика — со стабильными кодами SDK_DEPS_*; пути в манифесте обязаны
// быть относительными и не выходить за каталог проекта (никакого "../").
// ===========================================================================
#include "sdk.h"

#include <SDL3/SDL.h>

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(_WIN32)
#include <direct.h>
#else
#include <limits.h>
#include <unistd.h>
#ifndef PATH_MAX
#define PATH_MAX 4096
#endif
#endif

// Канонический абсолютный путь существующего файла: нужен, чтобы симлинк
// внутри проекта не уводил чтение за его пределы. SDL3 в этой сборке не даёт
// SDL_GetRealPath, поэтому платформенный вызов спрятан здесь.
static bool deps_real_path(const char *path, char *out, size_t cap)
{
#if defined(_WIN32)
    if (!_fullpath(out, path, cap)) return false;
    return true;
#else
    char resolved[PATH_MAX];
    if (!realpath(path, resolved)) return false;
    snprintf(out, cap, "%s", resolved);
    return true;
#endif
}

#define SDK_DEPS_MANIFEST_VERSION 1
#define DEPS_MAX_NODES 4096
#define DEPS_MAX_LIST 64
#define DEPS_PATH_MAX 1024
#define DEPS_MAX_REASONS 12

typedef struct DepsNode {
    char  source[DEPS_PATH_MAX];
    char  deps[DEPS_MAX_LIST][DEPS_PATH_MAX];
    int   dep_count;
    char  outputs[DEPS_MAX_LIST][DEPS_PATH_MAX];
    int   output_count;
    char  baker[64];
    int   version;                 // версия baker/importer'а из манифеста
    char *options_compact;         // malloc: канонический JSON опций или NULL
} DepsNode;

typedef struct DepsManifest {
    char      manifest[2048];
    char      root[2048];
    char      cache[2304];
    DepsNode *nodes;
    int       count;
    bool      loaded;
} DepsManifest;

typedef struct DepsFileRef {
    char     path[DEPS_PATH_MAX];
    bool     exists;
    uint64_t hash;
    int64_t  mtime;                // наносекунды (SDL_PathInfo.modify_time)
    int64_t  size;
} DepsFileRef;

typedef struct DepsNodeState {
    bool        stale;
    bool        source_exists;
    uint64_t    source_hash;
    int64_t     source_mtime;
    int64_t     source_size;
    DepsFileRef deps[DEPS_MAX_LIST];
    int         dep_count;
    DepsFileRef outputs[DEPS_MAX_LIST];
    int         output_count;
    const char *reasons[DEPS_MAX_REASONS];   // стабильные строки-литералы
    int         reason_count;
} DepsNodeState;

// ---------------------------------------------------------------------------
// Хеш содержимого: FNV-1a 64. Детерминированный, без зависимостей; в движке
// такие же хеши используют payload/audio, но они static в своих модулях,
// поэтому здесь — тонкая копия с тем же алгоритмом и форматом (16 hex).
// ---------------------------------------------------------------------------
uint64_t sdk_deps_hash64(const void *data, size_t size)
{
    const unsigned char *p = (const unsigned char *)data;
    uint64_t h = 14695981039346656037ULL;
    for (size_t i = 0; i < size; ++i) {
        h ^= (uint64_t)p[i];
        h *= 1099511628211ULL;
    }
    return h;
}

static void hash_hex(uint64_t h, char out[17])
{
    snprintf(out, 17, "%016llx", (unsigned long long)h);
}

// ---------------------------------------------------------------------------
// Пути: только относительные, без ".", "..", "//", "\" и диска Windows.
// Проверка лексическая; для существующих файлов дополнительно сверяется
// реальный путь (симлинк внутри проекта не должен уводить наружу).
// ---------------------------------------------------------------------------
bool sdk_deps_path_ok(const char *rel)
{
    if (!rel || !rel[0]) return false;
    if (strlen(rel) >= DEPS_PATH_MAX) return false;
    if (rel[0] == '/' || rel[0] == '\\' || rel[0] == '~') return false;
    if (isalpha((unsigned char)rel[0]) && rel[1] == ':') return false;
    if (rel[strlen(rel) - 1] == '/') return false;                 // "art/"
    if (rel[strlen(rel) - 1] == '\\') return false;
    const char *p = rel;
    while (*p) {
        const char *seg = p;
        while (*p && *p != '/') {
            if (*p == '\\') return false;
            ++p;
        }
        const size_t n = (size_t)(p - seg);
        if (n == 0) return false;                                     // "a//b" и "a/"
        if (n == 1 && seg[0] == '.') return false;                     // "."
        if (n == 2 && seg[0] == '.' && seg[1] == '.') return false;    // ".."
        if (*p == '/') ++p;
    }
    return true;
}

static bool deps_contained(const char *root_real, const char *root, const char *rel)
{
    char full[4096];
    sdk_join(root, rel, full, sizeof full);
    SDL_PathInfo info;
    if (!SDL_GetPathInfo(full, &info)) return true;   // ещё не создан — лексически безопасен
    char real[4096];
    if (!deps_real_path(full, real, sizeof real)) return true;   // платформа не умеет — доверяем лексике
    const size_t n = strlen(root_real);
    const bool inside = strncmp(real, root_real, n) == 0 && (real[n] == '/' || real[n] == '\0');
    return inside;
}

static void deps_ref(const char *root, const char *rel, DepsFileRef *ref)
{
    memset(ref, 0, sizeof *ref);
    snprintf(ref->path, sizeof ref->path, "%s", rel);
    char full[4096];
    sdk_join(root, rel, full, sizeof full);
    SDL_PathInfo info;
    if (!SDL_GetPathInfo(full, &info) || info.type != SDL_PATHTYPE_FILE) return;
    size_t n = 0;
    char *data = sdk_read_file(full, &n);
    if (!data) return;
    ref->exists = true;
    ref->hash = sdk_deps_hash64(data, n);
    ref->mtime = (int64_t)info.modify_time;
    ref->size = (int64_t)info.size;
    free(data);
}

// ---------------------------------------------------------------------------
// Разбор манифеста
// ---------------------------------------------------------------------------
static void sdk_deps_manifest_free(DepsManifest *m)
{
    if (!m) return;
    for (int i = 0; i < m->count; ++i) free(m->nodes[i].options_compact);
    free(m->nodes);
    memset(m, 0, sizeof *m);
}

static bool deps_add_node(DepsManifest *m, int cap, const DepsNode *node)
{
    if (m->count >= cap) return false;
    m->nodes[m->count] = *node;
    m->count++;
    return true;
}

static bool deps_parse_string_list(const R2dJson *arr, const char *path, int node_index,
                                   const char *field, char out[][DEPS_PATH_MAX], int *count,
                                   SdkReport *rep)
{
    *count = 0;
    if (!arr) return true;
    char loc[160];
    snprintf(loc, sizeof loc, "{\"node\":%d,\"field\":\"%s\"}", node_index, field);
    if (arr->type != R2D_JSON_ARR) {
        sdk_diag(rep, SDK_ERROR, "SDK_DEPS_NODE", path, loc, NULL,
                 "узел %d: %s — массив путей", node_index, field);
        return false;
    }
    if (arr->count > DEPS_MAX_LIST) {
        sdk_diag(rep, SDK_ERROR, "SDK_DEPS_NODE", path, loc, NULL,
                 "узел %d: %s — не больше %d путей", node_index, field, DEPS_MAX_LIST);
        return false;
    }
    for (int i = 0; i < arr->count; ++i) {
        const char *value = r2d_json_str(arr->items[i], NULL);
        if (!value || !value[0]) {
            sdk_diag(rep, SDK_ERROR, "SDK_DEPS_NODE", path, loc, NULL,
                     "узел %d: %s[%d] — непустая строка", node_index, field, i);
            return false;
        }
        if (!sdk_deps_path_ok(value)) {
            char details[1200];
            snprintf(details, sizeof details, "{\"node\":%d,\"field\":\"%s\",\"path\":\"%s\"}",
                     node_index, field, value);
            sdk_diag(rep, SDK_ERROR, "SDK_DEPS_PATH", path, loc, details,
                     "узел %d: путь «%s» должен быть относительным и без «..»", node_index, value);
            return false;
        }
        snprintf(out[*count], DEPS_PATH_MAX, "%s", value);
        (*count)++;
    }
    return true;
}

// Возвращает false, только если манифест прочитать нельзя. Структурные ошибки
// остаются в rep: команда печатает их и ничего не оценивает.
static bool sdk_deps_manifest_load(const char *target, const char *project_override,
                                   DepsManifest *m, SdkReport *rep)
{
    memset(m, 0, sizeof *m);
    if (!target || !target[0]) return false;

    const bool target_is_dir = sdk_is_dir(target);
    if (target_is_dir) {
        snprintf(m->root, sizeof m->root, "%s", target);
        sdk_join(target, "deps.json", m->manifest, sizeof m->manifest);
    } else {
        snprintf(m->manifest, sizeof m->manifest, "%s", target);
        if (project_override && project_override[0]) {
            snprintf(m->root, sizeof m->root, "%s", project_override);
        } else {
            sdk_dirname(target, m->root, sizeof m->root);
        }
    }
    if (project_override && project_override[0]) {
        snprintf(m->root, sizeof m->root, "%s", project_override);
        if (target_is_dir) {
            // --project задаёт корень кэша, манифест всё равно берётся из target.
            sdk_join(target, "deps.json", m->manifest, sizeof m->manifest);
        }
    }
    sdk_join(m->root, ".r2d/cache/assets.json", m->cache, sizeof m->cache);

    if (!sdk_is_dir(m->root)) {
        sdk_diag(rep, SDK_ERROR, "SDK_PROJECT_NOT_FOUND", m->root, NULL, NULL,
                 "Каталог проекта не найден: %s", m->root);
        return false;
    }
    if (!sdk_file_exists(m->manifest)) {
        sdk_diag(rep, SDK_ERROR, "SDK_DEPS_MANIFEST", m->manifest, NULL, NULL,
                 "Манифест зависимостей не найден: %s", m->manifest);
        return false;
    }

    R2dJson *root = sdk_load_json(m->manifest, rep);
    if (!root) return false;

    if (root->type != R2D_JSON_OBJ) {
        sdk_diag(rep, SDK_ERROR, "SDK_DEPS_MANIFEST", m->manifest, NULL, NULL,
                 "Манифест должен быть объектом");
        r2d_json_free(root);
        return false;
    }
    if (r2d_json_num(r2d_json_get(root, "version"), 0) != SDK_DEPS_MANIFEST_VERSION) {
        sdk_diag(rep, SDK_ERROR, "SDK_DEPS_VERSION", m->manifest,
                 "{\"field\":\"version\"}", NULL, "Поддерживается version: %d",
                 SDK_DEPS_MANIFEST_VERSION);
        r2d_json_free(root);
        return false;
    }
    const R2dJson *nodes = r2d_json_get(root, "nodes");
    if (!nodes || nodes->type != R2D_JSON_ARR) {
        sdk_diag(rep, SDK_ERROR, "SDK_DEPS_NODES", m->manifest,
                 "{\"field\":\"nodes\"}", NULL, "Нужен массив nodes");
        r2d_json_free(root);
        return false;
    }
    if (nodes->count > DEPS_MAX_NODES) {
        sdk_diag(rep, SDK_ERROR, "SDK_DEPS_NODES", m->manifest,
                 "{\"field\":\"nodes\"}", NULL, "nodes: до %d узлов", DEPS_MAX_NODES);
        r2d_json_free(root);
        return false;
    }

    bool ok = true;
    m->nodes = (DepsNode *)calloc(nodes->count > 0 ? (size_t)nodes->count : 1, sizeof *m->nodes);
    if (!m->nodes) {
        sdk_diag(rep, SDK_FATAL, "SDK_DEPS_MEMORY", m->manifest, NULL, NULL,
                 "Не хватило памяти на манифест зависимостей");
        r2d_json_free(root);
        return false;
    }

    for (int i = 0; i < nodes->count; ++i) {
        const R2dJson *n = nodes->items[i];
        char loc[96];
        snprintf(loc, sizeof loc, "{\"node\":%d}", i);
        if (!n || n->type != R2D_JSON_OBJ) {
            sdk_diag(rep, SDK_ERROR, "SDK_DEPS_NODE", m->manifest, loc, NULL,
                     "узел %d: должен быть объектом", i);
            ok = false;
            continue;
        }
        DepsNode node;
        memset(&node, 0, sizeof node);
        node.version = 1;

        const char *source = r2d_json_str(r2d_json_get(n, "source"), NULL);
        if (!source || !source[0]) {
            sdk_diag(rep, SDK_ERROR, "SDK_DEPS_NODE", m->manifest, loc, NULL,
                     "узел %d: нужен непустой source", i);
            ok = false;
            continue;
        }
        if (!sdk_deps_path_ok(source)) {
            char details[1200];
            snprintf(details, sizeof details, "{\"node\":%d,\"field\":\"source\",\"path\":\"%s\"}",
                     i, source);
            sdk_diag(rep, SDK_ERROR, "SDK_DEPS_PATH", m->manifest, loc, details,
                     "узел %d: source «%s» должен быть относительным и без «..»", i, source);
            ok = false;
            continue;
        }
        snprintf(node.source, sizeof node.source, "%s", source);

        for (int j = 0; j < m->count; ++j) {
            if (strcmp(m->nodes[j].source, node.source) == 0) {
                sdk_diag(rep, SDK_ERROR, "SDK_DEPS_DUPLICATE", m->manifest, loc, NULL,
                         "узел %d: источник «%s» уже объявлен узлом %d", i, source, j);
                ok = false;
            }
        }

        if (!deps_parse_string_list(r2d_json_get(n, "deps"), m->manifest, i, "deps",
                                    node.deps, &node.dep_count, rep)) ok = false;
        if (!deps_parse_string_list(r2d_json_get(n, "outputs"), m->manifest, i, "outputs",
                                    node.outputs, &node.output_count, rep)) ok = false;

        const R2dJson *baker = r2d_json_get(n, "baker");
        if (baker) {
            const char *b = r2d_json_str(baker, NULL);
            if (baker->type != R2D_JSON_STR || !b) {
                sdk_diag(rep, SDK_ERROR, "SDK_DEPS_NODE", m->manifest, loc, NULL,
                         "узел %d: baker — строка", i);
                ok = false;
            } else if (strlen(b) >= sizeof node.baker) {
                sdk_diag(rep, SDK_ERROR, "SDK_DEPS_NODE", m->manifest, loc, NULL,
                         "узел %d: baker длиннее %d символов", i, (int)sizeof node.baker - 1);
                ok = false;
            } else {
                snprintf(node.baker, sizeof node.baker, "%s", b);
            }
        }
        const R2dJson *version = r2d_json_get(n, "version");
        if (version) {
            const double v = r2d_json_num(version, -1);
            if (version->type != R2D_JSON_NUM || v < 1 || v > 1000000 || v != (double)(long long)v) {
                sdk_diag(rep, SDK_ERROR, "SDK_DEPS_NODE", m->manifest, loc, NULL,
                         "узел %d: version — целое 1..1000000", i);
                ok = false;
            } else {
                node.version = (int)v;
            }
        }
        const R2dJson *options = r2d_json_get(n, "options");
        if (options) {
            R2dSb sb;
            r2d_sb_init(&sb);
            sdk_json_put_compact(&sb, options);
            node.options_compact = strdup(sb.data ? sb.data : "null");
            r2d_sb_free(&sb);
            if (!node.options_compact) {
                sdk_diag(rep, SDK_FATAL, "SDK_DEPS_MEMORY", m->manifest, loc, NULL,
                         "узел %d: не хватило памяти на options", i);
                ok = false;
            }
        }

        const int before = m->count;
        if (!deps_add_node(m, nodes->count, &node)) {
            free(node.options_compact);
            ok = false;
            continue;
        }
        // Дубликат выхода между узлами — структурная ошибка: непонятно, кто
        // владеет файлом, и кэш стал бы неоднозначным.
        for (int j = 0; j < before; ++j) {
            for (int a = 0; a < m->nodes[j].output_count; ++a) {
                for (int b = 0; b < m->nodes[before].output_count; ++b) {
                    if (strcmp(m->nodes[j].outputs[a], m->nodes[before].outputs[b]) == 0) {
                        sdk_diag(rep, SDK_ERROR, "SDK_DEPS_DUPLICATE_OUTPUT", m->manifest, loc, NULL,
                                 "узел %d: выход «%s» уже объявлен узлом %d",
                                 before, m->nodes[before].outputs[b], j);
                        ok = false;
                    }
                }
            }
        }
    }

    if (m->count == 0 && rep->errors == 0) {
        sdk_diag(rep, SDK_WARNING, "SDK_DEPS_EMPTY", m->manifest, NULL, NULL,
                 "Манифест без узлов: пересобирать нечего");
    }
    r2d_json_free(root);
    m->loaded = ok;
    return ok;
}

// ---------------------------------------------------------------------------
// Кэш
// ---------------------------------------------------------------------------
static R2dJson *deps_cache_read(const DepsManifest *m, SdkReport *rep)
{
    if (!sdk_file_exists(m->cache)) return NULL;
    char *text = sdk_read_file(m->cache, NULL);
    if (!text) {
        sdk_diag(rep, SDK_WARNING, "SDK_DEPS_CACHE", m->cache, NULL, NULL,
                 "Кэш зависимостей не читается; все узлы считаются устаревшими");
        return NULL;
    }
    char err[256];
    R2dJson *root = r2d_json_parse(text, err, sizeof err);
    free(text);
    if (!root) {
        sdk_diag(rep, SDK_WARNING, "SDK_DEPS_CACHE", m->cache, NULL, NULL,
                 "Кэш зависимостей повреждён (%s); все узлы считаются устаревшими", err);
        return NULL;
    }
    if (root->type != R2D_JSON_OBJ
        || r2d_json_num(r2d_json_get(root, "version"), 0) != SDK_DEPS_MANIFEST_VERSION) {
        sdk_diag(rep, SDK_WARNING, "SDK_DEPS_CACHE", m->cache, NULL, NULL,
                 "Кэш неизвестной версии; все узлы считаются устаревшими");
        r2d_json_free(root);
        return NULL;
    }
    return root;
}

static const R2dJson *deps_cache_node(const R2dJson *cache, const char *source)
{
    const R2dJson *nodes = r2d_json_get(cache, "nodes");
    if (!nodes || nodes->type != R2D_JSON_ARR) return NULL;
    for (int i = 0; i < nodes->count; ++i) {
        const R2dJson *n = nodes->items[i];
        const char *s = r2d_json_str(r2d_json_get(n, "source"), NULL);
        if (s && strcmp(s, source) == 0) return n;
    }
    return NULL;
}

static const R2dJson *deps_cache_file(const R2dJson *arr, const char *path)
{
    if (!arr || arr->type != R2D_JSON_ARR) return NULL;
    for (int i = 0; i < arr->count; ++i) {
        const char *p = r2d_json_str(r2d_json_get(arr->items[i], "path"), NULL);
        if (p && strcmp(p, path) == 0) return arr->items[i];
    }
    return NULL;
}

static bool deps_list_matches(const R2dJson *cached, const DepsFileRef *refs, int count)
{
    if (!cached) return count == 0;
    if (cached->type != R2D_JSON_ARR || cached->count != count) return false;
    for (int i = 0; i < count; ++i) {
        bool found = false;
        for (int j = 0; j < cached->count; ++j) {
            const char *p = r2d_json_str(r2d_json_get(cached->items[j], "path"), NULL);
            if (p && strcmp(p, refs[i].path) == 0) { found = true; break; }
        }
        if (!found) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Оценка: что устарело. Содержимое — истина; mtime только справочно.
// ---------------------------------------------------------------------------
static void state_reason(DepsNodeState *s, const char *reason)
{
    for (int i = 0; i < s->reason_count; ++i) {
        if (strcmp(s->reasons[i], reason) == 0) return;
    }
    if (s->reason_count < DEPS_MAX_REASONS) s->reasons[s->reason_count++] = reason;
    s->stale = true;
}

static const char *const k_reason_priority[] = {
    "source_missing", "path_denied", "source_changed", "not_recorded", "deps_changed",
    "dependency_missing", "dependency_changed", "dependency_stale",
    "output_missing", "output_changed", "baker_changed", "version_changed",
    "options_changed", NULL,
};

static const char *state_primary(const DepsNodeState *s)
{
    for (int p = 0; k_reason_priority[p]; ++p) {
        for (int i = 0; i < s->reason_count; ++i) {
            if (strcmp(s->reasons[i], k_reason_priority[p]) == 0) return k_reason_priority[p];
        }
    }
    return "";
}

static int deps_dep_node(const DepsManifest *m, const char *path)
{
    for (int i = 0; i < m->count; ++i) {
        if (strcmp(m->nodes[i].source, path) == 0) return i;
    }
    for (int i = 0; i < m->count; ++i) {
        for (int o = 0; o < m->nodes[i].output_count; ++o) {
            if (strcmp(m->nodes[i].outputs[o], path) == 0) return i;
        }
    }
    return -1;
}

static bool deps_cycle_visit(const DepsManifest *m, int i, unsigned char *color, SdkReport *rep)
{
    color[i] = 1;
    for (int k = 0; k < m->nodes[i].dep_count; ++k) {
        const int j = deps_dep_node(m, m->nodes[i].deps[k]);
        if (j < 0) continue;
        if (color[j] == 1) {
            char loc[96];
            snprintf(loc, sizeof loc, "{\"node\":%d}", i);
            sdk_diag(rep, SDK_ERROR, "SDK_DEPS_CYCLE", m->manifest, loc, NULL,
                     "узел %d: цикл зависимостей через «%s» (зависимость узла %d)",
                     i, m->nodes[i].source, j);
            return true;
        }
        if (color[j] == 0 && deps_cycle_visit(m, j, color, rep)) return true;
    }
    color[i] = 2;
    return false;
}

static void deps_eval(const DepsManifest *m, DepsNodeState *st, SdkReport *rep)
{
    R2dJson *cache = deps_cache_read(m, rep);

    char root_real[4096];
    if (!deps_real_path(m->root, root_real, sizeof root_real)) {
        snprintf(root_real, sizeof root_real, "%s", m->root);
    }

    for (int i = 0; i < m->count; ++i) {
        const DepsNode *node = &m->nodes[i];
        DepsNodeState *s = &st[i];
        memset(s, 0, sizeof *s);
        char loc[96];
        snprintf(loc, sizeof loc, "{\"node\":%d}", i);

        DepsFileRef src;
        deps_ref(m->root, node->source, &src);
        s->source_exists = src.exists;
        s->source_hash = src.hash;
        s->source_mtime = src.mtime;
        s->source_size = src.size;

        if (!src.exists) {
            sdk_diag(rep, SDK_ERROR, "SDK_DEPS_SOURCE_MISSING", m->manifest, loc, NULL,
                     "узел %d: источник «%s» не найден", i, node->source);
            state_reason(s, "source_missing");
        } else if (!deps_contained(root_real, m->root, node->source)) {
            sdk_diag(rep, SDK_ERROR, "SDK_DEPS_PATH", m->manifest, loc, NULL,
                     "узел %d: источник «%s» выходит за каталог проекта", i, node->source);
            state_reason(s, "path_denied");
        }

        for (int k = 0; k < node->dep_count; ++k) {
            DepsFileRef *ref = &s->deps[s->dep_count++];
            deps_ref(m->root, node->deps[k], ref);
            if (!ref->exists) {
                char details[1200];
                snprintf(details, sizeof details,
                         "{\"node\":%d,\"dep\":\"%s\"}", i, node->deps[k]);
                sdk_diag(rep, SDK_ERROR, "SDK_DEPS_DEP_MISSING", m->manifest, loc, details,
                         "узел %d: зависимость «%s» не найдена", i, node->deps[k]);
                state_reason(s, "dependency_missing");
            } else if (!deps_contained(root_real, m->root, node->deps[k])) {
                sdk_diag(rep, SDK_ERROR, "SDK_DEPS_PATH", m->manifest, loc, NULL,
                         "узел %d: зависимость «%s» выходит за каталог проекта", i, node->deps[k]);
                state_reason(s, "path_denied");
            }
        }
        for (int k = 0; k < node->output_count; ++k) {
            DepsFileRef *ref = &s->outputs[s->output_count++];
            deps_ref(m->root, node->outputs[k], ref);
            if (!ref->exists) {
                // Выход ещё не собран: это stale, а не ошибка манифеста.
                state_reason(s, "output_missing");
            } else if (!deps_contained(root_real, m->root, node->outputs[k])) {
                sdk_diag(rep, SDK_ERROR, "SDK_DEPS_PATH", m->manifest, loc, NULL,
                         "узел %d: выход «%s» выходит за каталог проекта", i, node->outputs[k]);
                state_reason(s, "path_denied");
            }
        }

        const R2dJson *c = cache ? deps_cache_node(cache, node->source) : NULL;
        if (!c) {
            state_reason(s, "not_recorded");
            continue;
        }

        char hex[17];
        hash_hex(src.hash, hex);
        const char *recorded = r2d_json_str(r2d_json_get(c, "hash"), NULL);
        if (src.exists && (!recorded || strcmp(recorded, hex) != 0)) {
            state_reason(s, "source_changed");
        }

        const R2dJson *cached_deps = r2d_json_get(c, "deps");
        if (!deps_list_matches(cached_deps, s->deps, s->dep_count)) {
            state_reason(s, "deps_changed");
        } else {
            for (int k = 0; k < s->dep_count; ++k) {
                if (!s->deps[k].exists) continue;
                const R2dJson *cf = deps_cache_file(cached_deps, s->deps[k].path);
                if (!cf) continue;
                const char *dh = r2d_json_str(r2d_json_get(cf, "hash"), NULL);
                hash_hex(s->deps[k].hash, hex);
                if (!dh || strcmp(dh, hex) != 0) state_reason(s, "dependency_changed");
            }
        }

        const R2dJson *cached_out = r2d_json_get(c, "outputs");
        if (!deps_list_matches(cached_out, s->outputs, s->output_count)) {
            state_reason(s, "output_changed");
        } else {
            for (int k = 0; k < s->output_count; ++k) {
                if (!s->outputs[k].exists) continue;
                const R2dJson *cf = deps_cache_file(cached_out, s->outputs[k].path);
                const char *oh = r2d_json_str(r2d_json_get(cf, "hash"), NULL);
                hash_hex(s->outputs[k].hash, hex);
                if (!oh || strcmp(oh, hex) != 0) state_reason(s, "output_changed");
            }
        }

        const char *baker = r2d_json_str(r2d_json_get(c, "baker"), NULL);
        if (strcmp(baker ? baker : "", node->baker) != 0) state_reason(s, "baker_changed");

        if (r2d_json_int(r2d_json_get(c, "baker_version"), 0) != node->version) {
            state_reason(s, "version_changed");
        }

        const R2dJson *cached_options = r2d_json_get(c, "options");
        R2dSb options;
        r2d_sb_init(&options);
        sdk_json_put_compact(&options, cached_options);
        const char *want = node->options_compact ? node->options_compact : "null";
        if (strcmp(want, options.data ? options.data : "null") != 0) {
            state_reason(s, "options_changed");
        }
        r2d_sb_free(&options);
    }

    // Циклы в графе — структурная ошибка: пересборка не определена.
    if (m->count > 0) {
        unsigned char *color = (unsigned char *)calloc((size_t)m->count, 1);
        if (color) {
            for (int i = 0; i < m->count; ++i) {
                if (color[i] != 0) continue;
                if (deps_cycle_visit(m, i, color, rep)) break;
            }
            free(color);
        }
    }

    // Транзитивное устаревание: зависимый узел пересобирается, если устарел
    // владелец его source/outputs. Фиксированная точка, сходится за ≤ count шагов.
    for (int pass = 0; pass < m->count; ++pass) {
        bool changed = false;
        for (int i = 0; i < m->count; ++i) {
            if (st[i].stale) continue;
            for (int k = 0; k < m->nodes[i].dep_count; ++k) {
                const int j = deps_dep_node(m, m->nodes[i].deps[k]);
                if (j >= 0 && st[j].stale) {
                    state_reason(&st[i], "dependency_stale");
                    changed = true;
                    break;
                }
            }
        }
        if (!changed) break;
    }

    r2d_json_free(cache);
}

// ---------------------------------------------------------------------------
// Запись кэша: атомарно (sdk_write_file пишет через временный файл), только
// по --record и только когда нет ошибок — иначе кэш «наполовину правдив».
// ---------------------------------------------------------------------------
static void put_file_ref(R2dSb *sb, const DepsFileRef *f)
{
    char hex[17];
    hash_hex(f->hash, hex);
    r2d_sb_puts(sb, "{\"path\":");
    r2d_sb_put_json_string(sb, f->path);
    r2d_sb_printf(sb, ",\"exists\":%s", f->exists ? "true" : "false");
    if (f->exists) {
        r2d_sb_printf(sb, ",\"hash\":\"%s\",\"mtime\":%lld,\"size\":%lld",
                      hex, (long long)f->mtime, (long long)f->size);
    } else {
        r2d_sb_puts(sb, ",\"hash\":null,\"mtime\":0,\"size\":0");
    }
    r2d_sb_putc(sb, '}');
}

static bool deps_write_cache(const DepsManifest *m, const DepsNodeState *st, SdkReport *rep)
{
    char dir[2200];
    sdk_join(m->root, ".r2d", dir, sizeof dir);
    SDL_CreateDirectory(dir);
    sdk_join(m->root, ".r2d/cache", dir, sizeof dir);
    SDL_CreateDirectory(dir);

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\n  \"version\": 1,\n  \"tool\": \"r2d-sdk " SDK_VERSION "\",\n  \"manifest\": ");
    r2d_sb_put_json_string(&out, m->manifest);
    r2d_sb_puts(&out, ",\n  \"nodes\": [");
    for (int i = 0; i < m->count; ++i) {
        const DepsNode *node = &m->nodes[i];
        const DepsNodeState *s = &st[i];
        char hex[17];
        hash_hex(s->source_hash, hex);
        if (i) r2d_sb_putc(&out, ',');
        r2d_sb_puts(&out, "\n    {\n      \"source\": ");
        r2d_sb_put_json_string(&out, node->source);
        r2d_sb_printf(&out, ",\n      \"exists\": %s", s->source_exists ? "true" : "false");
        if (s->source_exists) {
            r2d_sb_printf(&out, ",\n      \"hash\": \"%s\",\n      \"mtime\": %lld,\n      \"size\": %lld",
                          hex, (long long)s->source_mtime, (long long)s->source_size);
        } else {
            r2d_sb_puts(&out, ",\n      \"hash\": null,\n      \"mtime\": 0,\n      \"size\": 0");
        }
        r2d_sb_puts(&out, ",\n      \"baker\": ");
        r2d_sb_put_json_string(&out, node->baker);
        r2d_sb_printf(&out, ",\n      \"baker_version\": %d,\n      \"options\": ", node->version);
        r2d_sb_puts(&out, node->options_compact ? node->options_compact : "null");
        r2d_sb_puts(&out, ",\n      \"deps\": [");
        for (int k = 0; k < s->dep_count; ++k) {
            if (k) r2d_sb_putc(&out, ',');
            put_file_ref(&out, &s->deps[k]);
        }
        r2d_sb_puts(&out, "],\n      \"outputs\": [");
        for (int k = 0; k < s->output_count; ++k) {
            if (k) r2d_sb_putc(&out, ',');
            put_file_ref(&out, &s->outputs[k]);
        }
        r2d_sb_puts(&out, "]\n    }");
    }
    r2d_sb_puts(&out, "\n  ]\n}\n");

    const bool written = sdk_write_file(m->cache, out.data, out.len);
    if (!written) {
        sdk_diag(rep, SDK_ERROR, "SDK_DEPS_CACHE_WRITE", m->cache, NULL, NULL,
                 "Не удалось записать кэш зависимостей: %s", m->cache);
    }
    r2d_sb_free(&out);
    return written;
}

// ---------------------------------------------------------------------------
// Ответ CLI
// ---------------------------------------------------------------------------
static int stale_count(const DepsManifest *m, const DepsNodeState *st)
{
    int n = 0;
    for (int i = 0; i < m->count; ++i) {
        if (st[i].stale) ++n;
    }
    return n;
}

static void put_json_str_array(R2dSb *sb, const char *const *items, int count)
{
    r2d_sb_putc(sb, '[');
    for (int i = 0; i < count; ++i) {
        if (i) r2d_sb_putc(sb, ',');
        r2d_sb_put_json_string(sb, items[i]);
    }
    r2d_sb_putc(sb, ']');
}

static void put_ref_paths(R2dSb *sb, const DepsFileRef *refs, int count)
{
    r2d_sb_putc(sb, '[');
    for (int i = 0; i < count; ++i) {
        if (i) r2d_sb_putc(sb, ',');
        r2d_sb_put_json_string(sb, refs[i].path);
    }
    r2d_sb_putc(sb, ']');
}

static int deps_emit(const DepsManifest *m, const DepsNodeState *st, bool record,
                     bool recorded, bool detail, int stale_before, SdkReport *rep)
{
    const int stale = st ? stale_count(m, st) : 0;
    const int total = m->count;
    const bool ok = rep->errors == 0 && (record ? recorded : stale == 0);

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"version\":%d,\"mode\":\"%s\",",
                  ok ? "true" : "false", SDK_DEPS_MANIFEST_VERSION, record ? "record" : "check");
    sdk_put_kv_str(&out, "manifest", m->manifest[0] ? m->manifest : NULL);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "project", m->root[0] ? m->root : NULL);
    r2d_sb_putc(&out, ',');
    sdk_put_kv_str(&out, "cache", m->cache[0] ? m->cache : NULL);
    r2d_sb_printf(&out, ",\"nodes_total\":%d,\"up_to_date\":%d,\"stale_count\":%d,\"stale\":[",
                  total, total - stale, stale);
    if (st) {
        bool first = true;
        for (int i = 0; i < m->count; ++i) {
            if (!st[i].stale) continue;
            if (!first) r2d_sb_putc(&out, ',');
            first = false;
            r2d_sb_puts(&out, "{\"source\":");
            r2d_sb_put_json_string(&out, m->nodes[i].source);
            r2d_sb_puts(&out, ",\"outputs\":");
            put_ref_paths(&out, st[i].outputs, st[i].output_count);
            r2d_sb_puts(&out, ",\"deps\":");
            put_ref_paths(&out, st[i].deps, st[i].dep_count);
            r2d_sb_puts(&out, ",\"reason\":");
            r2d_sb_put_json_string(&out, state_primary(&st[i]));
            r2d_sb_puts(&out, ",\"reasons\":");
            put_json_str_array(&out, st[i].reasons, st[i].reason_count);
            r2d_sb_putc(&out, '}');
        }
    }
    r2d_sb_putc(&out, ']');
    if (detail) {
        // --json: полная картина по каждому узлу (для CI, GUI и агента),
        // а не только список устаревших.
        r2d_sb_puts(&out, ",\"nodes\":[");
        for (int i = 0; i < m->count; ++i) {
            if (i) r2d_sb_putc(&out, ',');
            r2d_sb_puts(&out, "{\"source\":");
            r2d_sb_put_json_string(&out, m->nodes[i].source);
            r2d_sb_puts(&out, ",\"outputs\":");
            put_ref_paths(&out, st ? st[i].outputs : NULL, st ? st[i].output_count : 0);
            r2d_sb_printf(&out, ",\"status\":\"%s\"",
                          st && st[i].stale ? "stale" : "up_to_date");
            r2d_sb_puts(&out, ",\"reason\":");
            r2d_sb_put_json_string(&out, st ? state_primary(&st[i]) : "");
            r2d_sb_puts(&out, ",\"reasons\":");
            put_json_str_array(&out, st ? st[i].reasons : NULL, st ? st[i].reason_count : 0);
            r2d_sb_putc(&out, '}');
        }
        r2d_sb_putc(&out, ']');
    }
    r2d_sb_printf(&out, ",\"recorded\":%s", recorded ? "true" : "false");
    if (record) {
        // После успешной записи кэш описывает текущее состояние, поэтому
        // up_to_date/stale относятся уже к записанному снимку; сколько узлов
        // было устаревшим до записи — в stale_before_record.
        r2d_sb_printf(&out, ",\"stale_before_record\":%d", stale_before);
    }
    r2d_sb_putc(&out, ',');
    sdk_report_put_counts(rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);
    r2d_sb_free(&out);
    return ok ? 0 : 1;
}

int sdk_cmd_deps(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *target = sdk_arg_positional(a, 0);
    const bool record = sdk_arg_flag(a, "--record");
    const bool check = sdk_arg_flag(a, "--check");
    const bool detail = sdk_arg_flag(a, "--json");

    if (!target) {
        const int rc = sdk_fail(&rep, "SDK_USAGE",
            "Использование: r2d-sdk deps <проект|deps.json> [--check|--record] [--json] [--project dir]");
        sdk_report_free(&rep);
        return rc;
    }
    if (record && check) {
        const int rc = sdk_fail(&rep, "SDK_USAGE",
            "--check и --record несовместимы: проверка ничего не пишет, запись не проверяет");
        sdk_report_free(&rep);
        return rc;
    }

    DepsManifest m;
    DepsNodeState *states = NULL;
    bool recorded = false;
    const bool loaded = sdk_deps_manifest_load(target, sdk_arg_value(a, "--project"), &m, &rep);
    if (loaded && rep.errors == 0) {
        states = (DepsNodeState *)calloc(m.count > 0 ? (size_t)m.count : 1, sizeof *states);
        if (!states) {
            sdk_diag(&rep, SDK_FATAL, "SDK_DEPS_MEMORY", m.manifest, NULL, NULL,
                     "Не хватило памяти на состояние узлов");
        } else {
            deps_eval(&m, states, &rep);
            if (record && rep.errors == 0) recorded = deps_write_cache(&m, states, &rep);
        }
    }

    int stale_before = 0;
    if (states) {
        stale_before = stale_count(&m, states);
        if (recorded) {
            // Успешная запись = снимок актуален: в ответе stale пуст, а число
            // пересобранных/изменённых до записи узлов остаётся в
            // stale_before_record.
            for (int i = 0; i < m.count; ++i) {
                states[i].stale = false;
                states[i].reason_count = 0;
            }
        }
    }
    const int rc = deps_emit(&m, states, record, recorded, detail, stale_before, &rep);
    free(states);
    sdk_deps_manifest_free(&m);
    sdk_report_free(&rep);
    return rc;
}
