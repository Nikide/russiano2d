// ===========================================================================
// r2d-sdk story validate <dir> — native .scene linter for the VN narrative DSL.
//
// One backend for CLI/GUI/agent: no Python. Checks duplicate labels, unknown
// goto/choice targets, unreachable branches, obvious goto cycles, speaker and
// expression ids (when story/speakers.json exists), referenced assets, theme
// templates, and i18n keys (when i18n dictionaries exist). Diagnostics use the
// shared SdkReport with stable codes.
// ===========================================================================
#include "sdk.h"

#include <SDL3/SDL.h>

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { char *name; int line; int targeted; } StoryLabel;
typedef struct { char *target; int line; } StoryEdge;
typedef struct { char *who; char *expr; int line; } StorySay;
typedef struct { char *path; int line; } StoryAsset;
typedef struct { char *key; int line; } StoryI18n;
typedef struct { char *theme; int line; } StoryTheme;

typedef struct StoryFile {
    char *path;
    StoryLabel *labels; int label_count, label_capacity;
    StoryEdge *edges; int edge_count, edge_capacity;
    StorySay *says; int say_count, say_capacity;
    StoryAsset *assets; int asset_count, asset_capacity;
    StoryI18n *i18n; int i18n_count, i18n_capacity;
    StoryTheme *themes; int theme_count, theme_capacity;
} StoryFile;

typedef struct StoryWalk {
    SdkReport *rep;
    const char *root;
    const char *assets_root;
    int files;
    int scenes;
    R2dJson *speakers;
    bool have_speakers;
    bool i18n_checked;
    bool have_i18n;
    char **dicts; int dict_count, dict_capacity;
} StoryWalk;

static char *story_dup(const char *s)
{
    size_t n = strlen(s);
    char *copy = malloc(n + 1);
    if (!copy) return NULL;
    memcpy(copy, s, n + 1);
    return copy;
}

static void *grow(void *items, int *capacity, int needed, size_t size)
{
    if (needed <= *capacity) return items;
    int cap = *capacity ? *capacity : 8;
    while (cap < needed) cap *= 2;
    void *next = realloc(items, (size_t)cap * size);
    if (!next) return NULL;
    *capacity = cap;
    return next;
}

static bool add_label(StoryFile *f, const char *name, int line, SdkReport *rep)
{
    for (int i = 0; i < f->label_count; ++i) {
        if (!strcmp(f->labels[i].name, name)) {
            sdk_diag(rep, SDK_ERROR, "STORY_LABEL_DUPLICATE", f->path, NULL, NULL,
                     "duplicate label \"%s\" (line %d, first at line %d)", name, line, f->labels[i].line);
            return false;
        }
    }
    StoryLabel *items = grow(f->labels, &f->label_capacity, f->label_count + 1, sizeof *items);
    if (!items) return false;
    f->labels = items;
    f->labels[f->label_count] = (StoryLabel){ story_dup(name), line, 0 };
    f->label_count++;
    return true;
}

static void add_edge(StoryFile *f, const char *target, int line)
{
    if (!target || !target[0] || !strcmp(target, "end")) return;
    StoryEdge *items = grow(f->edges, &f->edge_capacity, f->edge_count + 1, sizeof *items);
    if (!items) return;
    f->edges = items;
    f->edges[f->edge_count] = (StoryEdge){ story_dup(target), line };
    f->edge_count++;
}

static void add_say(StoryFile *f, const char *who, const char *expr, int line)
{
    StorySay *items = grow(f->says, &f->say_capacity, f->say_count + 1, sizeof *items);
    if (!items) return;
    f->says = items;
    f->says[f->say_count] = (StorySay){ story_dup(who && who[0] ? who : ""), story_dup(expr ? expr : ""), line };
    f->say_count++;
}

static void add_asset(StoryFile *f, const char *path, int line)
{
    if (!path || !path[0]) return;
    StoryAsset *items = grow(f->assets, &f->asset_capacity, f->asset_count + 1, sizeof *items);
    if (!items) return;
    f->assets = items;
    f->assets[f->asset_count] = (StoryAsset){ story_dup(path), line };
    f->asset_count++;
}

static void add_i18n(StoryFile *f, const char *text, int line)
{
    if (!text) return;
    char key[256];
    size_t n = 0;
    bool dotted = false;
    for (const char *p = text; *p && n + 1 < sizeof key; ++p) {
        unsigned char c = (unsigned char)*p;
        if (isspace(c)) break;
        if (c == '{') break;
        if (c == '.') dotted = true;
        if (!(isalnum(c) || c == '.' || c == '_' || c == '-')) return;
        key[n++] = (char)c;
    }
    key[n] = '\0';
    if (!dotted || n < 3) return;
    StoryI18n *items = grow(f->i18n, &f->i18n_capacity, f->i18n_count + 1, sizeof *items);
    if (!items) return;
    f->i18n = items;
    f->i18n[f->i18n_count] = (StoryI18n){ story_dup(key), line };
    f->i18n_count++;
}

static const char *skip_space(const char *s)
{
    while (*s && isspace((unsigned char)*s)) s++;
    return s;
}

static void trim_end(char *s)
{
    size_t n = strlen(s);
    while (n && isspace((unsigned char)s[n - 1])) s[--n] = '\0';
}

static void parse_say_text(StoryFile *f, const char *line, int number)
{
    const char *colon = strchr(line, ':');
    if (!colon || colon == line) return;
    char who[128];
    size_t n = (size_t)(colon - line);
    if (n >= sizeof who) return;
    memcpy(who, line, n); who[n] = '\0';
    trim_end(who);
    // Actor names are one to three words; otherwise it is an unknown command.
    int words = 0;
    for (const char *p = who; *p;) {
        while (*p && isspace((unsigned char)*p)) p++;
        if (!*p) break;
        words++;
        while (*p && !isspace((unsigned char)*p)) p++;
    }
    if (words < 1 || words > 3) return;
    char expr[128] = "";
    char *open = strchr(who, '(');
    if (open && who[strlen(who) - 1] == ')') {
        char *end = who + strlen(who) - 1;
        size_t en = (size_t)(end - open - 1);
        if (en < sizeof expr) { memcpy(expr, open + 1, en); expr[en] = '\0'; }
        *open = '\0';
        trim_end(who);
    }
    add_say(f, who, expr, number);
    add_i18n(f, skip_space(colon + 1), number);
}

static void parse_scene_file(StoryFile *f, const char *text, SdkReport *rep)
{
    const char *p = text;
    int number = 0;
    while (*p) {
        const char *end = strchr(p, '\n');
        size_t len = end ? (size_t)(end - p) : strlen(p);
        char line[2048];
        if (len >= sizeof line) len = sizeof line - 1;
        memcpy(line, p, len); line[len] = '\0';
        trim_end(line);
        number++;
        const char *s = skip_space(line);
        if (!*s || *s == '#') { p = end ? end + 1 : p + strlen(p); continue; }

        if (*s == ':') {
            add_label(f, skip_space(s + 1), number, rep);
        } else if (!strncmp(s, "@theme", 6) && (s[6] == 0 || isspace((unsigned char)s[6]))) {
            const char *theme = skip_space(s + 6);
            if (*theme) {
                StoryTheme *items = grow(f->themes, &f->theme_capacity, f->theme_count + 1, sizeof *items);
                if (items) { f->themes = items; f->themes[f->theme_count++] = (StoryTheme){ story_dup(theme), number }; }
            }
        } else if (!strncmp(s, "- ", 2)) {
            const char *arrow = strstr(s, "->");
            add_i18n(f, skip_space(s + 2), number);
            if (arrow) add_edge(f, skip_space(arrow + 2), number);
        } else if (!strncmp(s, "if ", 3) || !strncmp(s, "if\t", 3)) {
            const char *arrow = strstr(s, "->");
            if (arrow) add_edge(f, skip_space(arrow + 2), number);
            else sdk_diag(rep, SDK_ERROR, "STORY_SYNTAX", f->path, NULL, NULL,
                          "if without -> target (line %d)", number);
        } else if (!strncmp(s, "goto ", 5)) {
            add_edge(f, skip_space(s + 5), number);
        } else if (!strncmp(s, "image ", 6)) {
            add_asset(f, skip_space(s + 6), number);
        } else if (!strncmp(s, "sound ", 6)) {
            add_asset(f, skip_space(s + 6), number);
        } else if (!strncmp(s, "voice ", 6)) {
            add_asset(f, skip_space(s + 6), number);
        } else if (!strncmp(s, "bubble ", 7)) {
            parse_say_text(f, skip_space(s + 7), number);
        } else if (!strncmp(s, "say ", 4)) {
            parse_say_text(f, skip_space(s + 4), number);
        } else {
            parse_say_text(f, s, number);
        }
        p = end ? end + 1 : p + strlen(p);
    }
}

static int label_index(const StoryFile *f, const char *name)
{
    for (int i = 0; i < f->label_count; ++i) if (!strcmp(f->labels[i].name, name)) return i;
    return -1;
}

static void check_edges(StoryFile *f, SdkReport *rep)
{
    for (int i = 0; i < f->edge_count; ++i) {
        int at = label_index(f, f->edges[i].target);
        if (at < 0) {
            sdk_diag(rep, SDK_ERROR, "STORY_GOTO_UNKNOWN", f->path, NULL, NULL,
                     "unknown goto target \"%s\" (line %d)", f->edges[i].target, f->edges[i].line);
        } else {
            f->labels[at].targeted = 1;
        }
    }
    // Unreachable: no label reaches it and it is not the entry label.
    for (int i = 0; i < f->label_count; ++i) {
        if (i == 0 || f->labels[i].targeted) continue;
        sdk_diag(rep, SDK_WARNING, "STORY_UNREACHABLE", f->path, NULL, NULL,
                 "label \"%s\" is never targeted (line %d)", f->labels[i].name, f->labels[i].line);
    }
}

// Simple DFS over label->label edges; any back edge is a likely infinite loop.
static void loop_dfs(const StoryFile *f, int node, int *state, bool *reported, SdkReport *rep)
{
    state[node] = 1;
    for (int i = 0; i < f->edge_count; ++i) {
        int at = label_index(f, f->edges[i].target);
        if (at < 0) continue;
        // Only edges that belong to this node are considered: attach edges to
        // their source line range by matching the next label boundary.
        int owner = 0;
        for (int j = 0; j < f->label_count; ++j) {
            if (f->labels[j].line <= f->edges[i].line) owner = j;
        }
        if (owner != node) continue;
        if (state[at] == 1) {
            if (!*reported) {
                sdk_diag(rep, SDK_WARNING, "STORY_GOTO_LOOP", f->path, NULL, NULL,
                         "goto cycle through \"%s\" (line %d)", f->labels[at].name, f->edges[i].line);
                *reported = true;
            }
        } else if (state[at] == 0) {
            loop_dfs(f, at, state, reported, rep);
        }
    }
    state[node] = 2;
}

static void check_loops(StoryFile *f, SdkReport *rep)
{
    if (!f->label_count) return;
    int *state = calloc((size_t)f->label_count, sizeof *state);
    if (!state) return;
    bool reported = false;
    for (int i = 0; i < f->label_count; ++i) if (state[i] == 0) loop_dfs(f, i, state, &reported, rep);
    free(state);
}

static R2dJson *load_speakers(StoryWalk *walk)
{
    const char *names[] = { "speakers.json", "story/speakers.json", "../speakers.json" };
    char path[2048];
    for (size_t i = 0; i < sizeof names / sizeof names[0]; ++i) {
        sdk_join(walk->root, names[i], path, sizeof path);
        if (!sdk_file_exists(path)) continue;
        char err[256];
        char *text = sdk_read_file(path, NULL);
        R2dJson *root = text ? r2d_json_parse(text, err, sizeof err) : NULL;
        free(text);
        if (!root) {
            sdk_diag(walk->rep, SDK_ERROR, "STORY_SPEAKERS_JSON", path, NULL, NULL, "speaker registry invalid: %s", err);
            return NULL;
        }
        const R2dJson *list = r2d_json_get(root, "speakers");
        if (!list || list->type != R2D_JSON_OBJ) {
            sdk_diag(walk->rep, SDK_ERROR, "STORY_SPEAKERS_JSON", path, NULL, NULL, "\"speakers\" object missing");
            r2d_json_free(root);
            return NULL;
        }
        walk->have_speakers = true;
        return root;
    }
    return NULL;
}

static bool jeq(const char *a, const char *b) { return a && b && !strcmp(a, b); }

static void check_speakers(StoryWalk *walk, StoryFile *f)
{
    if (!walk->speakers || !walk->have_speakers) return;
    const R2dJson *speakers = r2d_json_get(walk->speakers, "speakers");
    for (int i = 0; i < f->say_count; ++i) {
        const StorySay *say = &f->says[i];
        if (!say->who[0]) continue; // narrator
        const R2dJson *entry = r2d_json_get(speakers, say->who);
        if (!entry) {
            sdk_diag(walk->rep, SDK_ERROR, "STORY_SPEAKER", f->path, NULL, NULL,
                     "unknown speaker \"%s\" (line %d)", say->who, say->line);
            continue;
        }
        if (!say->expr[0]) continue;
        const R2dJson *expressions = r2d_json_get(entry, "expressions");
        if (!expressions || expressions->type != R2D_JSON_ARR) continue;
        bool found = false;
        for (int j = 0; j < expressions->count; ++j) {
            if (jeq(r2d_json_str(r2d_json_at(expressions, j), NULL), say->expr)) { found = true; break; }
        }
        if (!found) {
            sdk_diag(walk->rep, SDK_ERROR, "STORY_EXPRESSION", f->path, NULL, NULL,
                     "speaker \"%s\" has no expression \"%s\" (line %d)", say->who, say->expr, say->line);
        }
    }
}

static bool asset_exists(const StoryWalk *walk, const char *path, char *out, size_t cap)
{
    if (path[0] == '/') { snprintf(out, cap, "%s", path); return sdk_file_exists(path); }
    sdk_join(walk->root, path, out, cap);
    if (sdk_file_exists(out)) return true;
    if (walk->assets_root && walk->assets_root[0]) {
        sdk_join(walk->assets_root, path, out, cap);
        if (sdk_file_exists(out)) return true;
    }
    char parent[2048];
    snprintf(parent, sizeof parent, "%s/..", walk->root);
    sdk_join(parent, path, out, cap);
    return sdk_file_exists(out);
}

static void check_assets(StoryWalk *walk, StoryFile *f)
{
    for (int i = 0; i < f->asset_count; ++i) {
        char resolved[2048];
        if (asset_exists(walk, f->assets[i].path, resolved, sizeof resolved)) continue;
        sdk_diag(walk->rep, SDK_ERROR, "STORY_ASSET", f->path, NULL, NULL,
                 "missing asset \"%s\" (line %d)", f->assets[i].path, f->assets[i].line);
    }
}

static void check_themes(StoryWalk *walk, StoryFile *f)
{
    for (int i = 0; i < f->theme_count; ++i) {
        char path[2048];
        snprintf(path, sizeof path, "ui/dialog/%s.rml", f->themes[i].theme);
        char full[2048];
        if (asset_exists(walk, path, full, sizeof full)) continue;
        sdk_join(walk->root, f->themes[i].theme, full, sizeof full);
        if (sdk_file_exists(full)) continue;
        sdk_diag(walk->rep, SDK_ERROR, "STORY_THEME", f->path, NULL, NULL,
                 "dialog theme \"%s\" not found (line %d)", f->themes[i].theme, f->themes[i].line);
    }
}

static void collect_dicts(StoryWalk *walk, const char *dir);
static SDL_EnumerationResult dict_cb(void *user, const char *dirname, const char *fname)
{
    StoryWalk *walk = (StoryWalk *)user;
    if (!strcmp(fname, ".") || !strcmp(fname, "..")) return SDL_ENUM_CONTINUE;
    char full[2048];
    snprintf(full, sizeof full, "%s/%s", dirname, fname);
    if (sdk_is_dir(full)) return SDL_ENUM_CONTINUE;
    if (!sdk_ends_with(fname, ".json")) return SDL_ENUM_CONTINUE;
    char **items = grow(walk->dicts, &walk->dict_capacity, walk->dict_count + 1, sizeof *items);
    if (!items) return SDL_ENUM_CONTINUE;
    walk->dicts = items;
    walk->dicts[walk->dict_count++] = story_dup(full);
    return SDL_ENUM_CONTINUE;
}
static void collect_dicts(StoryWalk *walk, const char *dir)
{
    if (!sdk_is_dir(dir)) return;
    SDL_EnumerateDirectory(dir, dict_cb, walk);
}

static bool dict_has_key(StoryWalk *walk, const char *key)
{
    char quoted[300];
    snprintf(quoted, sizeof quoted, "\"%s\"", key);
    for (int i = 0; i < walk->dict_count; ++i) {
        char *text = sdk_read_file(walk->dicts[i], NULL);
        if (!text) continue;
        bool found = strstr(text, quoted) != NULL;
        free(text);
        if (found) return true;
    }
    return false;
}

static void check_i18n(StoryWalk *walk, StoryFile *f)
{
    if (!walk->have_i18n) return;
    for (int i = 0; i < f->i18n_count; ++i) {
        if (dict_has_key(walk, f->i18n[i].key)) continue;
        sdk_diag(walk->rep, SDK_WARNING, "STORY_I18N", f->path, NULL, NULL,
                 "i18n key \"%s\" missing from dictionaries (line %d)", f->i18n[i].key, f->i18n[i].line);
    }
}

static void story_file_free(StoryFile *f)
{
    for (int i = 0; i < f->label_count; ++i) free(f->labels[i].name);
    for (int i = 0; i < f->edge_count; ++i) free(f->edges[i].target);
    for (int i = 0; i < f->say_count; ++i) { free(f->says[i].who); free(f->says[i].expr); }
    for (int i = 0; i < f->asset_count; ++i) free(f->assets[i].path);
    for (int i = 0; i < f->i18n_count; ++i) free(f->i18n[i].key);
    for (int i = 0; i < f->theme_count; ++i) free(f->themes[i].theme);
    free(f->labels); free(f->edges); free(f->says); free(f->assets); free(f->i18n); free(f->themes);
    free(f->path);
}

static void validate_scene(StoryWalk *walk, const char *path)
{
    char *text = sdk_read_file(path, NULL);
    if (!text) {
        sdk_diag(walk->rep, SDK_ERROR, "STORY_READ", path, NULL, NULL, "scene is not readable");
        return;
    }
    StoryFile file = {0};
    file.path = story_dup(path);
    parse_scene_file(&file, text, walk->rep);
    free(text);
    check_edges(&file, walk->rep);
    check_loops(&file, walk->rep);
    check_speakers(walk, &file);
    check_assets(walk, &file);
    check_themes(walk, &file);
    check_i18n(walk, &file);
    walk->scenes++;
    story_file_free(&file);
}

static SDL_EnumerationResult story_enum_cb(void *user, const char *dirname, const char *fname)
{
    StoryWalk *walk = (StoryWalk *)user;
    if (!strcmp(fname, ".") || !strcmp(fname, "..")) return SDL_ENUM_CONTINUE;
    char full[2048];
    snprintf(full, sizeof full, "%s/%s", dirname, fname);
    if (sdk_is_dir(full)) {
        if (!strcmp(fname, ".git") || !strcmp(fname, "build") || !strcmp(fname, "node_modules"))
            return SDL_ENUM_CONTINUE;
        SDL_EnumerateDirectory(full, story_enum_cb, walk);
    } else if (sdk_ends_with(fname, ".scene") || sdk_ends_with(fname, ".story")) {
        validate_scene(walk, full);
    }
    return SDL_ENUM_CONTINUE;
}

int sdk_cmd_story(const SdkArgs *a)
{
    const char *sub = sdk_arg_positional(a, 0);
    if (!sub || strcmp(sub, "validate")) {
        SdkReport rep; sdk_report_init(&rep);
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d-sdk story validate <каталог|файл> [--assets-root <dir>]");
        sdk_report_free(&rep);
        return rc;
    }
    const char *root = sdk_arg_positional(a, 1);
    if (!root || !root[0]) {
        SdkReport rep; sdk_report_init(&rep);
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Укажите каталог или файл сценки: r2d-sdk story validate story/");
        sdk_report_free(&rep);
        return rc;
    }
    SdkReport rep; sdk_report_init(&rep);
    StoryWalk walk = {0};
    walk.rep = &rep;
    walk.root = root;
    walk.assets_root = sdk_arg_value(a, "--assets-root");
    if (!sdk_file_exists(root) && !sdk_is_dir(root)) {
        sdk_diag(&rep, SDK_ERROR, "SDK_PATH", root, NULL, NULL, "path not found");
    } else if (sdk_is_dir(root)) {
        walk.speakers = load_speakers(&walk);
        char dicts[2048];
        sdk_join(root, "i18n", dicts, sizeof dicts);
        collect_dicts(&walk, dicts);
        char parent[2048];
        snprintf(parent, sizeof parent, "%s/../i18n", root);
        collect_dicts(&walk, parent);
        walk.have_i18n = walk.dict_count > 0;
        SDL_EnumerateDirectory(root, story_enum_cb, &walk);
    } else {
        walk.speakers = load_speakers(&walk);
        validate_scene(&walk, root);
    }

    R2dSb out; r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", rep.errors ? "false" : "true");
    sdk_put_kv_str(&out, "root", root);
    r2d_sb_printf(&out, ",\"scenes\":%d,\"speakers_registry\":%s,", walk.scenes,
                  walk.have_speakers ? "true" : "false");
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);

    const int rc = rep.errors ? 1 : 0;
    r2d_sb_free(&out);
    if (walk.speakers) r2d_json_free(walk.speakers);
    for (int i = 0; i < walk.dict_count; ++i) free(walk.dicts[i]);
    free(walk.dicts);
    sdk_report_free(&rep);
    return rc;
}
