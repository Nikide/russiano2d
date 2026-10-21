// ===========================================================================
// `r2d project-index` — индексатор editor.graph в project.json (schema v2).
//
// Читает JS проекта детерминированным сканером (не исполняет код) и строит
// граф, который показывает Editor: сцены, объекты `$('<tag>')`, связи
// `.appendTo(...)` и `.sprite(...)`. Поддержан ограниченный, проверяемый
// поднабор (docs/PROJECT_JSON.md §5): всё, что доказать нельзя, попадает в
// diagnostics графа, а статус становится `partial` — связи не выдумываются.
//
// Владелец записей — `origin`: индексатор пересоздаёт только `origin: "code"`;
// записи `origin: "graph"` и `views` он сохраняет как есть.
//
// Стабильность: без временных меток и случайных ID, порядок — по путям файлов
// и позиции в файле; без изменений кода diff пустой.
// ===========================================================================
#include "sdk.h"

#include <SDL3/SDL.h>

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

#define G_NAME 96
#define G_KEY 192
#define G_PATH 256

typedef struct {
    char *text;       // для строки — содержимое без кавычек
    int line;
    bool str;
} Tok;

typedef struct {
    Tok *items;
    int count;
} Toks;

typedef struct {
    char key[G_KEY];
    char area[G_KEY];
    char type[16];        // scene | script | object | resource
    char tag[G_NAME];
    char pid[G_NAME];
    char name[G_NAME];
    char path[G_PATH];
    char file[G_PATH];
    int  line;
    bool entry;
    bool missing;
    bool dynamic;         // создан в цикле/колбэке перебора
} Ent;

typedef struct {
    char key[G_KEY * 3];
    char type[24];
    char from[G_KEY];
    char to[G_KEY];
    char api[24];
    char file[G_PATH];
    int  line;
    char to_sel[G_NAME];  // отложенный '#id' → to
} Edge;

typedef struct {
    char code[12];
    char file[G_PATH];
    int  line;
    char msg[240];
} Dg;

typedef struct { int from, to; } Range;

typedef struct {
    const char *root;
    const char *entry;
    Ent  *ents;  int ents_n, ents_cap;
    Edge *edges; int edges_n, edges_cap;
    Dg   *dgs;   int dgs_n, dgs_cap;
    // sources
    char (*src_path)[G_PATH];
    uint64_t *src_hash;
    int src_n, src_cap;
} G;

// ---------------------------------------------------------------------------
// Сканер
// ---------------------------------------------------------------------------
static void toks_free(Toks *t)
{
    for (int i = 0; i < t->count; ++i) free(t->items[i].text);
    free(t->items);
    t->items = NULL;
    t->count = 0;
}

static bool push_tok(Toks *t, int *cap, const char *s, size_t n, int line, bool str)
{
    if (t->count == *cap) {
        *cap = *cap ? *cap * 2 : 512;
        Tok *g = (Tok *)realloc(t->items, (size_t)*cap * sizeof *g);
        if (!g) return false;
        t->items = g;
    }
    char *copy = (char *)malloc(n + 1);
    if (!copy) return false;
    memcpy(copy, s, n);
    copy[n] = 0;
    t->items[t->count++] = (Tok){ copy, line, str };
    return true;
}

static bool scan(const char *src, Toks *out)
{
    int cap = 0, line = 1;
    out->items = NULL;
    out->count = 0;
    const char *p = src;
    while (*p) {
        if (*p == '\n') { line++; p++; continue; }
        if (isspace((unsigned char)*p)) { p++; continue; }
        if (p[0] == '/' && p[1] == '/') { while (*p && *p != '\n') p++; continue; }
        if (p[0] == '/' && p[1] == '*') {
            p += 2;
            while (*p && !(p[0] == '*' && p[1] == '/')) { if (*p == '\n') line++; p++; }
            if (*p) p += 2;
            continue;
        }
        if (*p == '"' || *p == '\'' || *p == '`') {
            const char q = *p++;
            const int start_line = line;
            R2dSb sb;
            r2d_sb_init(&sb);
            while (*p && *p != q) {
                if (*p == '\\' && p[1]) { r2d_sb_putc(&sb, p[1]); if (p[1] == '\n') line++; p += 2; continue; }
                if (*p == '\n') line++;
                r2d_sb_putc(&sb, *p++);
            }
            if (*p == q) p++;
            const bool ok = push_tok(out, &cap, sb.data ? sb.data : "", sb.len, start_line, true);
            // Шаблон с подстановкой `${…}` — не статическая строка.
            if (ok && q == '`' && sb.data && strstr(sb.data, "${")) {
                Tok *last = &out->items[out->count - 1];
                last->str = false;
                free(last->text);
                last->text = strdup("`${}`");   // маркер нестатического шаблона
            }
            r2d_sb_free(&sb);
            if (!ok) return false;
            continue;
        }
        if (isalpha((unsigned char)*p) || *p == '_' || *p == '$') {
            const char *s = p;
            while (isalnum((unsigned char)*p) || *p == '_' || *p == '$') p++;
            if (!push_tok(out, &cap, s, (size_t)(p - s), line, false)) return false;
            continue;
        }
        if (isdigit((unsigned char)*p)) {
            const char *s = p;
            while (isalnum((unsigned char)*p) || *p == '.') p++;
            if (!push_tok(out, &cap, s, (size_t)(p - s), line, false)) return false;
            continue;
        }
        if (!push_tok(out, &cap, p, 1, line, false)) return false;
        p++;
    }
    return true;
}

static bool is_p(const Toks *t, int i, const char *s)
{
    return i >= 0 && i < t->count && !t->items[i].str && !strcmp(t->items[i].text, s);
}

static bool is_id(const Toks *t, int i)
{
    if (i < 0 || i >= t->count || t->items[i].str) return false;
    const unsigned char c = (unsigned char)t->items[i].text[0];
    return isalpha(c) || c == '_' || c == '$';
}

static bool is_str(const Toks *t, int i)
{
    return i >= 0 && i < t->count && t->items[i].str;
}

static bool open_br(const char *s) { return !strcmp(s, "(") || !strcmp(s, "[") || !strcmp(s, "{"); }
static bool close_br(const char *s) { return !strcmp(s, ")") || !strcmp(s, "]") || !strcmp(s, "}"); }

// Парная скобка для открывающей в позиции `open`; -1 — не найдена.
static int match(const Toks *t, int open)
{
    int depth = 0;
    for (int i = open; i < t->count; ++i) {
        if (t->items[i].str) continue;
        const char *s = t->items[i].text;
        if (open_br(s)) depth++;
        else if (close_br(s) && --depth == 0) return i;
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Накопление графа
// ---------------------------------------------------------------------------
static void scpy(char *dst, size_t cap, const char *src)
{
    SDL_snprintf(dst, cap, "%s", src ? src : "");
}

static void dg(G *g, const char *code, const char *file, int line, const char *fmt, ...)
{
    if (g->dgs_n == g->dgs_cap) {
        g->dgs_cap = g->dgs_cap ? g->dgs_cap * 2 : 16;
        g->dgs = (Dg *)realloc(g->dgs, (size_t)g->dgs_cap * sizeof *g->dgs);
    }
    Dg *d = &g->dgs[g->dgs_n++];
    memset(d, 0, sizeof *d);
    scpy(d->code, sizeof d->code, code);
    scpy(d->file, sizeof d->file, file);
    d->line = line;
    va_list ap;
    va_start(ap, fmt);
    SDL_vsnprintf(d->msg, sizeof d->msg, fmt, ap);
    va_end(ap);
}

static int find_ent(const G *g, const char *key)
{
    for (int i = 0; i < g->ents_n; ++i)
        if (!strcmp(g->ents[i].key, key)) return i;
    return -1;
}

static Ent *new_ent(G *g)
{
    if (g->ents_n == g->ents_cap) {
        g->ents_cap = g->ents_cap ? g->ents_cap * 2 : 64;
        g->ents = (Ent *)realloc(g->ents, (size_t)g->ents_cap * sizeof *g->ents);
    }
    Ent *e = &g->ents[g->ents_n++];
    memset(e, 0, sizeof *e);
    return e;
}

static int add_edge(G *g, const char *type, const char *from, const char *to, const char *sel,
                    const char *api, const char *file, int line)
{
    Edge probe;
    memset(&probe, 0, sizeof probe);
    SDL_snprintf(probe.key, sizeof probe.key, "edge:%s:%s>%s", type, from, to ? to : sel);
    for (int i = 0; i < g->edges_n; ++i)
        if (!strcmp(g->edges[i].key, probe.key)) return i;   // одна связь — одна запись
    if (g->edges_n == g->edges_cap) {
        g->edges_cap = g->edges_cap ? g->edges_cap * 2 : 64;
        g->edges = (Edge *)realloc(g->edges, (size_t)g->edges_cap * sizeof *g->edges);
    }
    Edge *e = &g->edges[g->edges_n++];
    *e = probe;
    scpy(e->type, sizeof e->type, type);
    scpy(e->from, sizeof e->from, from);
    scpy(e->to, sizeof e->to, to ? to : "");
    scpy(e->to_sel, sizeof e->to_sel, sel ? sel : "");
    scpy(e->api, sizeof e->api, api);
    scpy(e->file, sizeof e->file, file);
    e->line = line;
    return g->edges_n - 1;
}

// Ресурс по пути: общая запись на весь проект.
static const char *resource_key(G *g, const char *path, char *out, size_t cap)
{
    SDL_snprintf(out, cap, "resource:%s", path);
    if (find_ent(g, out) >= 0) return out;
    Ent *e = new_ent(g);
    scpy(e->key, sizeof e->key, out);
    scpy(e->area, sizeof e->area, "project:main");
    scpy(e->type, sizeof e->type, "resource");
    scpy(e->path, sizeof e->path, path);
    char full[2048];
    sdk_join(g->root, path, full, sizeof full);
    e->missing = !sdk_file_exists(full);
    return out;
}

// ---------------------------------------------------------------------------
// Разбор одного файла
// ---------------------------------------------------------------------------
typedef struct {
    G *g;
    const char *file;
    const Toks *t;
    Range *loops; int loops_n, loops_cap;
    struct { char name[G_NAME]; char key[G_KEY]; } vars[256];
    int vars_n;
    struct { int open, close; char name[G_NAME]; } scenes[64];
    int scenes_n;
} F;

static void loop_add(F *f, int from, int to)
{
    if (f->loops_n == f->loops_cap) {
        f->loops_cap = f->loops_cap ? f->loops_cap * 2 : 16;
        f->loops = (Range *)realloc(f->loops, (size_t)f->loops_cap * sizeof *f->loops);
    }
    f->loops[f->loops_n++] = (Range){ from, to };
}

static bool in_loop(const F *f, int i)
{
    for (int k = 0; k < f->loops_n; ++k)
        if (i >= f->loops[k].from && i <= f->loops[k].to) return true;
    return false;
}

static const char *scene_at(const F *f, int i)
{
    for (int k = 0; k < f->scenes_n; ++k)
        if (i > f->scenes[k].open && i < f->scenes[k].close) return f->scenes[k].name;
    return NULL;
}

static void world_key(const F *f, int i, char *out, size_t cap)
{
    const char *scene = scene_at(f, i);
    SDL_snprintf(out, cap, "world:%s", scene ? scene : "main");
}

static const char *var_find(const F *f, const char *name)
{
    for (int k = f->vars_n - 1; k >= 0; --k)
        if (!strcmp(f->vars[k].name, name)) return f->vars[k].key;
    return NULL;
}

static void var_set(F *f, const char *name, const char *key)
{
    for (int k = 0; k < f->vars_n; ++k)
        if (!strcmp(f->vars[k].name, name)) { scpy(f->vars[k].key, G_KEY, key); return; }
    if (f->vars_n >= 256) return;
    scpy(f->vars[f->vars_n].name, G_NAME, name);
    scpy(f->vars[f->vars_n].key, G_KEY, key);
    f->vars_n++;
}

// Предпросмотр: метки циклов. for/while-блок и колбэки each/forEach/map.
static void mark_loops(F *f)
{
    const Toks *t = f->t;
    for (int i = 0; i < t->count; ++i) {
        if ((is_p(t, i, "for") || is_p(t, i, "while")) && is_p(t, i + 1, "(")) {
            const int c = match(t, i + 1);
            if (c < 0) continue;
            if (is_p(t, c + 1, "{")) {
                const int e = match(t, c + 1);
                loop_add(f, c + 1, e < 0 ? t->count : e);
            } else {
                int e = c + 1;
                while (e < t->count && !is_p(t, e, ";")) e++;
                loop_add(f, c + 1, e);
            }
        } else if (is_p(t, i, "do") && is_p(t, i + 1, "{")) {
            const int e = match(t, i + 1);
            loop_add(f, i + 1, e < 0 ? t->count : e);
        } else if (is_p(t, i, ".") && is_id(t, i + 1) && is_p(t, i + 2, "(")) {
            const char *m = t->items[i + 1].text;
            if (!strcmp(m, "each") || !strcmp(m, "forEach") || !strcmp(m, "map") ||
                !strcmp(m, "eachNode") || !strcmp(m, "times")) {
                const int e = match(t, i + 2);
                loop_add(f, i + 2, e < 0 ? t->count : e);
            }
        }
    }
}

// Цель .appendTo(...): $.world, переменная или $('#id'). Возвращает true, если
// цель определена статически; иначе ключ/селектор пусты.
static bool parent_target(F *f, int a, int b, char *key, size_t kcap, char *sel, size_t scap, int at)
{
    const Toks *t = f->t;
    key[0] = 0;
    sel[0] = 0;
    if (b - a == 3 && is_p(t, a, "$") && is_p(t, a + 1, ".") && is_p(t, a + 2, "world")) {
        world_key(f, at, key, kcap);
        return true;
    }
    if (b - a == 1 && is_id(t, a)) {
        const char *v = var_find(f, t->items[a].text);
        if (v) { scpy(key, kcap, v); return true; }
        return false;
    }
    if (b - a == 1 && is_str(t, a) && t->items[a].text[0] == '#') {
        scpy(sel, scap, t->items[a].text + 1);
        return true;
    }
    if (b - a == 4 && is_p(t, a, "$") && is_p(t, a + 1, "(") && is_str(t, a + 2) &&
        t->items[a + 2].text[0] == '#' && is_p(t, a + 3, ")")) {
        scpy(sel, scap, t->items[a + 2].text + 1);
        return true;
    }
    return false;
}

// .appendTo(цель) на объекте `child_key`: связь parent → child.
static void link_parent(F *f, const char *child_key, int open, int close, int at, int line)
{
    char key[G_KEY], sel[G_NAME];
    if (!parent_target(f, open + 1, close, key, sizeof key, sel, sizeof sel, at)) {
        dg(f->g, "R2D301", f->file, line, ".appendTo(…) с нестатической целью — пространственная связь не построена");
        return;
    }
    if (key[0]) {
        add_edge(f->g, "spatial_parent", key, child_key, NULL, "appendTo", f->file, line);
    } else {
        // селектор '#id': родитель определяется после разбора всех файлов
        add_edge(f->g, "spatial_parent", "", child_key, sel, "appendTo", f->file, line);
    }
}

// Цепочка `.метод(арги)` после выражения, указывающего на объект `ent_key`.
static void chain_apply(F *f, int j, const char *ent_key)
{
    const Toks *t = f->t;
    while (is_p(t, j, ".") && is_id(t, j + 1) && is_p(t, j + 2, "(")) {
        const char *m = t->items[j + 1].text;
        const int open = j + 2;
        const int close = match(t, open);
        if (close < 0) {
            dg(f->g, "R2D303", f->file, t->items[j].line, "цепочка .%s(…) не закрыта — разбор неполный", m);
            return;
        }
        const int line = t->items[j + 1].line;
        if (!strcmp(m, "sprite") && close > open + 1 && is_str(t, open + 1) &&
            (close == open + 2 || is_p(t, open + 2, ","))) {
            char rk[G_KEY];
            resource_key(f->g, t->items[open + 1].text, rk, sizeof rk);
            add_edge(f->g, "uses_resource", ent_key, rk, NULL, "sprite", f->file, line);
        } else if (!strcmp(m, "sprite") && close > open + 1 && !is_p(t, open + 1, "{")) {
            dg(f->g, "R2D301", f->file, line, ".sprite(…) с нестатическим аргументом — связь с ресурсом не построена");
        } else if (!strcmp(m, "appendTo") || !strcmp(m, "prependTo")) {
            link_parent(f, ent_key, open, close, j, line);
        }
        j = close + 1;
    }
}

static void object_create(F *f, int i, int str_i, bool via_spawn)
{
    const Toks *t = f->t;
    G *g = f->g;
    const char *raw = t->items[str_i].text;
    const size_t n = strlen(raw);
    if (n < 3 || raw[0] != '<' || raw[n - 1] != '>') return;
    char tag[G_NAME];
    SDL_snprintf(tag, sizeof tag, "%.*s", (int)(n - 2 > G_NAME - 1 ? G_NAME - 1 : n - 2), raw + 1);

    const int open = via_spawn ? str_i - 1 : i + 1;
    const int close = match(t, open);
    if (close < 0) {
        dg(g, "R2D303", f->file, t->items[i].line, "вызов $('<%s>') не закрыт — разбор неполный", tag);
        return;
    }
    const int line = t->items[str_i].line;

    // Атрибуты верхнего уровня: id / src / sprite / parent.
    char pid[G_NAME] = "", src[G_PATH] = "", parent_sel[G_NAME] = "";
    int attrs = -1;
    if (!via_spawn && is_p(t, str_i + 1, ",") && is_p(t, str_i + 2, "{")) attrs = str_i + 2;
    if (attrs >= 0) {
        const int end = match(t, attrs);
        int depth = 0;
        for (int k = attrs; end > 0 && k < end; ++k) {
            if (!t->items[k].str) {
                const char *s = t->items[k].text;
                if (open_br(s)) { depth++; continue; }
                if (close_br(s)) { depth--; continue; }
            }
            if (depth != 1 || !is_p(t, k + 1, ":")) continue;
            if (!(is_id(t, k) || is_str(t, k))) continue;
            const char *key = t->items[k].text;
            const int v = k + 2;
            if (!strcmp(key, "id")) {
                if (is_str(t, v)) scpy(pid, sizeof pid, t->items[v].text);
                else dg(g, "R2D301", f->file, line, "id у <%s> не статическая строка", tag);
            } else if ((!strcmp(key, "src") || !strcmp(key, "sprite")) && is_str(t, v)) {
                scpy(src, sizeof src, t->items[v].text);
            } else if (!strcmp(key, "parent") && is_str(t, v) && t->items[v].text[0] == '#') {
                scpy(parent_sel, sizeof parent_sel, t->items[v].text + 1);
            }
        }
    }

    // Динамический тег: `$('<' + x + '>')` — первый аргумент не одна строка.
    Ent *e = new_ent(g);
    char wk[G_KEY];
    world_key(f, i, wk, sizeof wk);
    const char *scene = scene_at(f, i);
    if (pid[0]) {
        char probe[G_KEY];
        SDL_snprintf(probe, sizeof probe, "object:%s", pid);
        if (find_ent(g, probe) >= 0) {
            int dup = 2;
            do SDL_snprintf(probe, sizeof probe, "object:%s~%d", pid, dup++);
            while (find_ent(g, probe) >= 0);
            dg(g, "R2D301", f->file, line, "повторный id «%s»: запись получила суффикс", pid);
        }
        scpy(e->key, sizeof e->key, probe);
    } else {
        char probe[G_KEY];
        int n = 1;
        do SDL_snprintf(probe, sizeof probe, "object:%s:%s:%d", scene ? scene : "main", tag, n++);
        while (find_ent(g, probe) >= 0);
        scpy(e->key, sizeof e->key, probe);
    }
    scpy(e->area, sizeof e->area, wk);
    scpy(e->type, sizeof e->type, "object");
    scpy(e->tag, sizeof e->tag, tag);
    scpy(e->pid, sizeof e->pid, pid);
    scpy(e->file, sizeof e->file, f->file);
    e->line = line;
    e->dynamic = in_loop(f, i);
    if (e->dynamic)
        dg(g, "R2D302", f->file, line, "<%s> создаётся в цикле или переборе — показана одна запись на место в коде", tag);
    const char *key = e->key;
    char keybuf[G_KEY];
    scpy(keybuf, sizeof keybuf, key);   // add_edge/resource_key могут перераспределить массив

    if (src[0]) {
        char rk[G_KEY];
        resource_key(g, src, rk, sizeof rk);
        add_edge(g, "uses_resource", keybuf, rk, NULL, "src", f->file, line);
    }
    if (parent_sel[0])
        add_edge(g, "spatial_parent", "", keybuf, parent_sel, "parent", f->file, line);
    if (via_spawn) {
        add_edge(g, "spatial_parent", wk, keybuf, NULL, "spawn", f->file, line);
    } else {
        // переменная-владелец: `const hero = $('<player>')`
        int b = i - 1;
        if (is_p(t, b, "=") && is_id(t, b - 1) && !is_p(t, b - 2, ".")) var_set(f, t->items[b - 1].text, keybuf);
        chain_apply(f, close + 1, keybuf);
    }
}

static void scan_file(G *g, const char *rel, const Toks *t)
{
    F f;
    memset(&f, 0, sizeof f);
    f.g = g;
    f.file = rel;
    f.t = t;
    mark_loops(&f);

    // Скрипт — запись проекта; точка входа помечается.
    {
        Ent *s = new_ent(g);
        SDL_snprintf(s->key, sizeof s->key, "script:%s", rel);
        scpy(s->area, sizeof s->area, "project:main");
        scpy(s->type, sizeof s->type, "script");
        scpy(s->path, sizeof s->path, rel);
        scpy(s->file, sizeof s->file, rel);
        s->line = 1;
        s->entry = !strcmp(rel, g->entry);
    }

    // Сначала сцены: нужны диапазоны колбэков.
    for (int i = 0; i + 6 < t->count; ++i) {
        if (!(is_p(t, i, "$") && is_p(t, i + 1, ".") && is_p(t, i + 2, "scene") && is_p(t, i + 3, ".") &&
              is_p(t, i + 4, "add") && is_p(t, i + 5, "("))) continue;
        const int close = match(t, i + 5);
        if (!is_str(t, i + 6)) {
            dg(g, "R2D301", rel, t->items[i].line, "$.scene.add с нестатическим именем — сцена не добавлена в граф");
            continue;
        }
        const char *name = t->items[i + 6].text;
        char key[G_KEY];
        SDL_snprintf(key, sizeof key, "scene:%s", name);
        if (find_ent(g, key) >= 0) {
            dg(g, "R2D301", rel, t->items[i].line, "сцена «%s» зарегистрирована повторно", name);
            continue;
        }
        Ent *e = new_ent(g);
        scpy(e->key, sizeof e->key, key);
        scpy(e->area, sizeof e->area, "project:main");
        scpy(e->type, sizeof e->type, "scene");
        scpy(e->name, sizeof e->name, name);
        scpy(e->file, sizeof e->file, rel);
        e->line = t->items[i + 6].line;
        char sk[G_KEY];
        SDL_snprintf(sk, sizeof sk, "script:%s", rel);
        add_edge(g, "scene_registration", sk, key, NULL, "$.scene.add", rel, e->line);
        if (f.scenes_n < 64 && close > 0) {
            scpy(f.scenes[f.scenes_n].name, G_NAME, name);
            f.scenes[f.scenes_n].open = i + 5;
            f.scenes[f.scenes_n].close = close;
            f.scenes_n++;
        }
    }

    for (int i = 0; i < t->count; ++i) {
        // $('<tag>' …
        if (is_p(t, i, "$") && is_p(t, i + 1, "(") && !is_p(t, i - 1, ".")) {
            if (is_str(t, i + 2)) {
                const char *s = t->items[i + 2].text;
                if (s[0] == '<') object_create(&f, i, i + 2, false);
            }
            continue;
        }
        // $.world.spawn('<tag>', …)
        if (is_p(t, i, "spawn") && is_p(t, i - 1, ".") && is_p(t, i - 2, "world") && is_p(t, i + 1, "(") &&
            is_str(t, i + 2) && t->items[i + 2].text[0] == '<') {
            object_create(&f, i, i + 2, true);
            continue;
        }
        // переменная.метод(…) отдельным оператором: hero.sprite('…'), hero.appendTo(…)
        if (is_id(t, i) && !is_p(t, i - 1, ".") && is_p(t, i + 1, ".")) {
            const char *v = var_find(&f, t->items[i].text);
            if (v) {
                char keybuf[G_KEY];
                scpy(keybuf, sizeof keybuf, v);
                chain_apply(&f, i + 1, keybuf);
            }
        }
    }

    // Динамические имена тегов: $('<' + …), $(`<${…}>`).
    for (int i = 0; i + 3 < t->count; ++i) {
        if (!(is_p(t, i, "$") && is_p(t, i + 1, "(") && !is_p(t, i - 1, "."))) continue;
        if (is_str(t, i + 2) && t->items[i + 2].text[0] == '<' && is_p(t, i + 3, "+"))
            dg(g, "R2D301", rel, t->items[i + 2].line, "динамическое имя тега в $('<' + …) — объект не добавлен в граф");
        else if (is_p(t, i + 2, "`${}`"))
            dg(g, "R2D301", rel, t->items[i + 2].line, "динамическое имя тега в шаблонной строке — объект не добавлен в граф");
    }
    free(f.loops);
}

// ---------------------------------------------------------------------------
// Файлы проекта
// ---------------------------------------------------------------------------
typedef struct { char (*paths)[G_PATH]; int n, cap; const char *root; } Files;

static SDL_EnumerationResult files_cb(void *user, const char *dir, const char *name)
{
    Files *fl = (Files *)user;
    if (name[0] == '.' || !strcmp(name, "node_modules") || !strcmp(name, "build") ||
        !strcmp(name, "dist") || !strcmp(name, "checkpoints") || !strcmp(name, "saves"))
        return SDL_ENUM_CONTINUE;
    char full[2048];
    SDL_snprintf(full, sizeof full, "%s/%s", dir, name);
    if (sdk_is_dir(full)) {
        SDL_EnumerateDirectory(full, files_cb, fl);
        return SDL_ENUM_CONTINUE;
    }
    if (!sdk_ends_with(name, ".js")) return SDL_ENUM_CONTINUE;
    const size_t root_len = strlen(fl->root);
    const char *rel = full + root_len;
    while (*rel == '/') rel++;
    if (fl->n == fl->cap) {
        fl->cap = fl->cap ? fl->cap * 2 : 32;
        fl->paths = (char (*)[G_PATH])realloc(fl->paths, (size_t)fl->cap * G_PATH);
    }
    SDL_snprintf(fl->paths[fl->n++], G_PATH, "%s", rel);
    return SDL_ENUM_CONTINUE;
}

static int cmp_path(const void *a, const void *b) { return strcmp((const char *)a, (const char *)b); }

// ---------------------------------------------------------------------------
// Запись графа
// ---------------------------------------------------------------------------
static void put_src(R2dSb *sb, const char *file, int line)
{
    r2d_sb_puts(sb, "\"source\": {\"file\": ");
    r2d_sb_put_json_string(sb, file);
    r2d_sb_printf(sb, ", \"line\": %d}", line);
}

static void kv(R2dSb *sb, const char *k, const char *v)
{
    r2d_sb_put_json_string(sb, k);
    r2d_sb_puts(sb, ": ");
    r2d_sb_put_json_string(sb, v);
}

static bool has_children(const G *g, const char *key)
{
    for (int i = 0; i < g->edges_n; ++i)
        if (!strcmp(g->edges[i].type, "spatial_parent") && !strcmp(g->edges[i].from, key)) return true;
    return false;
}

static void put_ent(R2dSb *sb, const Ent *e)
{
    r2d_sb_puts(sb, "      {");
    kv(sb, "key", e->key); r2d_sb_puts(sb, ", ");
    kv(sb, "area", e->area); r2d_sb_puts(sb, ", ");
    kv(sb, "type", e->type); r2d_sb_puts(sb, ", ");
    kv(sb, "origin", "code");
    if (!strcmp(e->type, "object")) {
        r2d_sb_puts(sb, ", "); kv(sb, "tag", e->tag);
        if (e->pid[0]) { r2d_sb_puts(sb, ", "); kv(sb, "public_id", e->pid); }
        if (e->dynamic) r2d_sb_puts(sb, ", \"dynamic\": true");
    } else if (!strcmp(e->type, "scene")) {
        r2d_sb_puts(sb, ", "); kv(sb, "name", e->name);
    } else {
        r2d_sb_puts(sb, ", "); kv(sb, "path", e->path);
        if (!strcmp(e->type, "script") && e->entry) r2d_sb_puts(sb, ", \"entry\": true");
        if (!strcmp(e->type, "resource") && e->missing) r2d_sb_puts(sb, ", \"missing\": true");
    }
    if (e->file[0]) { r2d_sb_puts(sb, ", "); put_src(sb, e->file, e->line); }
    r2d_sb_putc(sb, '}');
}

static void put_edge(R2dSb *sb, const Edge *e)
{
    r2d_sb_puts(sb, "      {");
    kv(sb, "key", e->key); r2d_sb_puts(sb, ", ");
    kv(sb, "type", e->type); r2d_sb_puts(sb, ", ");
    kv(sb, "from", e->from); r2d_sb_puts(sb, ", ");
    kv(sb, "to", e->to); r2d_sb_puts(sb, ", ");
    kv(sb, "origin", "code"); r2d_sb_puts(sb, ", ");
    r2d_sb_puts(sb, "\"evidence\": {");
    kv(sb, "api", e->api); r2d_sb_puts(sb, ", ");
    kv(sb, "file", e->file);
    r2d_sb_printf(sb, ", \"line\": %d}}", e->line);
}

// Пользовательские записи (origin: "graph") и views сохраняются дословно.
static void put_kept(R2dSb *sb, const R2dJson *old_arr, int *wrote)
{
    for (int i = 0; old_arr && i < old_arr->count; ++i) {
        const R2dJson *it = old_arr->items[i];
        if (strcmp(r2d_json_str(r2d_json_get(it, "origin"), "code"), "graph") != 0) continue;
        if ((*wrote)++) r2d_sb_puts(sb, ",\n");
        r2d_sb_puts(sb, "      ");
        sdk_json_put_compact(sb, it);
    }
}

static void put_graph(R2dSb *sb, G *g, const R2dJson *old, bool partial)
{
    r2d_sb_puts(sb, "{\n    \"format\": 1,\n    \"status\": ");
    r2d_sb_put_json_string(sb, partial ? "partial" : "current");
    r2d_sb_puts(sb, ",\n    \"sources\": [\n");
    for (int i = 0; i < g->src_n; ++i) {
        r2d_sb_puts(sb, "      {\"path\": ");
        r2d_sb_put_json_string(sb, g->src_path[i]);
        r2d_sb_printf(sb, ", \"hash\": \"%016llx\"}%s\n", (unsigned long long)g->src_hash[i], i + 1 < g->src_n ? "," : "");
    }
    r2d_sb_puts(sb, "    ],\n    \"diagnostics\": [");
    for (int i = 0; i < g->dgs_n; ++i) {
        r2d_sb_puts(sb, i ? ",\n      {" : "\n      {");
        kv(sb, "code", g->dgs[i].code); r2d_sb_puts(sb, ", ");
        kv(sb, "file", g->dgs[i].file);
        r2d_sb_printf(sb, ", \"line\": %d, ", g->dgs[i].line);
        kv(sb, "message", g->dgs[i].msg);
        r2d_sb_putc(sb, '}');
    }
    r2d_sb_puts(sb, g->dgs_n ? "\n    ],\n" : "],\n");

    // areas
    r2d_sb_puts(sb, "    \"areas\": [\n");
    int wrote = 0;
    r2d_sb_puts(sb, "      {\"key\": \"project:main\", \"type\": \"project\", \"label\": \"Проект\", \"origin\": \"code\"}");
    wrote = 1;
    for (int pass = 0; pass < 2; ++pass) {
        for (int i = 0; i < g->ents_n; ++i) {
            const Ent *e = &g->ents[i];
            if (!strcmp(e->type, "object") && pass == 0) {
                // area мира: по одной на сцену/main — объявляем при первой встрече
                int first = 1;
                for (int k = 0; k < i; ++k)
                    if (!strcmp(g->ents[k].type, "object") && !strcmp(g->ents[k].area, e->area)) { first = 0; break; }
                if (!first) continue;
                r2d_sb_puts(sb, ",\n      {");
                kv(sb, "key", e->area); r2d_sb_puts(sb, ", \"type\": \"world\", \"label\": \"World\", \"runtime_root\": \"$.world\", ");
                const char *sc = strchr(e->area, ':') + 1;
                if (strcmp(sc, "main") != 0) {
                    char sk[G_KEY];
                    SDL_snprintf(sk, sizeof sk, "scene:%s", sc);
                    kv(sb, "scene", sk); r2d_sb_puts(sb, ", ");
                }
                kv(sb, "origin", "code");
                r2d_sb_putc(sb, '}');
            } else if (!strcmp(e->type, "object") && pass == 1 && has_children(g, e->key)) {
                char label[G_NAME * 2];
                if (e->pid[0]) SDL_snprintf(label, sizeof label, "<%s> #%s", e->tag, e->pid);
                else SDL_snprintf(label, sizeof label, "<%s>", e->tag);
                r2d_sb_puts(sb, ",\n      {\"key\": ");
                char ak[G_KEY + 8];
                SDL_snprintf(ak, sizeof ak, "children:%s", e->key);
                r2d_sb_put_json_string(sb, ak);
                r2d_sb_puts(sb, ", \"type\": \"entity\", \"label\": ");
                r2d_sb_put_json_string(sb, label);
                r2d_sb_puts(sb, ", \"entity\": ");
                r2d_sb_put_json_string(sb, e->key);
                r2d_sb_puts(sb, ", \"parent\": ");
                r2d_sb_put_json_string(sb, e->area);
                r2d_sb_puts(sb, ", \"origin\": \"code\"}");
            }
        }
    }
    put_kept(sb, r2d_json_get(old, "areas"), &wrote);
    r2d_sb_puts(sb, "\n    ],\n    \"entities\": [\n");
    wrote = 0;
    for (int i = 0; i < g->ents_n; ++i) {
        if (wrote++) r2d_sb_puts(sb, ",\n");
        put_ent(sb, &g->ents[i]);
    }
    put_kept(sb, r2d_json_get(old, "entities"), &wrote);
    r2d_sb_puts(sb, "\n    ],\n    \"edges\": [\n");
    wrote = 0;
    for (int i = 0; i < g->edges_n; ++i) {
        if (!g->edges[i].from[0] || !g->edges[i].to[0]) continue;   // неразрешённые отложенные связи
        if (wrote++) r2d_sb_puts(sb, ",\n");
        put_edge(sb, &g->edges[i]);
    }
    put_kept(sb, r2d_json_get(old, "edges"), &wrote);
    r2d_sb_puts(sb, "\n    ],\n    \"views\": ");
    const R2dJson *views = r2d_json_get(old, "views");
    if (views && views->type == R2D_JSON_OBJ) sdk_json_put_compact(sb, views);
    else r2d_sb_puts(sb, "{}");
    r2d_sb_puts(sb, "\n  }");
}

// Каноническая запись editor.graph из дерева: по одной записи на строку в
// списках, остальное компактно. И индексатор, и project-set пишут граф только
// ею, поэтому правка настроек не меняет форматирование графа.
static bool graph_list_key(const char *k)
{
    return !strcmp(k, "sources") || !strcmp(k, "diagnostics") || !strcmp(k, "areas") ||
           !strcmp(k, "entities") || !strcmp(k, "edges");
}

static void put_graph_json(R2dSb *sb, const R2dJson *graph)
{
    r2d_sb_puts(sb, "{\n");
    for (int i = 0; i < graph->count; ++i) {
        r2d_sb_puts(sb, "    ");
        r2d_sb_put_json_string(sb, graph->keys[i]);
        r2d_sb_puts(sb, ": ");
        const R2dJson *v = graph->items[i];
        if (v->type == R2D_JSON_ARR && v->count > 0 && graph_list_key(graph->keys[i])) {
            r2d_sb_puts(sb, "[\n");
            for (int k = 0; k < v->count; ++k) {
                r2d_sb_puts(sb, "      ");
                sdk_json_put_compact(sb, v->items[k]);
                r2d_sb_puts(sb, k + 1 < v->count ? ",\n" : "\n");
            }
            r2d_sb_puts(sb, "    ]");
        } else {
            sdk_json_put_compact(sb, v);
        }
        r2d_sb_puts(sb, i + 1 < graph->count ? ",\n" : "\n");
    }
    r2d_sb_puts(sb, "  }");
}

// ---------------------------------------------------------------------------
// Пересборка манифеста с сохранением остальных полей
// ---------------------------------------------------------------------------
static void put_pretty(R2dSb *sb, const R2dJson *v, int indent)
{
    R2dSb compact;
    r2d_sb_init(&compact);
    sdk_json_put_compact(&compact, v);
    if (v->type != R2D_JSON_OBJ && v->type != R2D_JSON_ARR) {
        r2d_sb_puts(sb, compact.data);
    } else if (compact.len + (size_t)indent <= 100 || v->count == 0) {
        r2d_sb_puts(sb, compact.data);
    } else {
        const bool obj = v->type == R2D_JSON_OBJ;
        r2d_sb_putc(sb, obj ? '{' : '[');
        r2d_sb_putc(sb, '\n');
        for (int i = 0; i < v->count; ++i) {
            for (int k = 0; k < indent + 2; ++k) r2d_sb_putc(sb, ' ');
            if (obj) { r2d_sb_put_json_string(sb, v->keys[i]); r2d_sb_puts(sb, ": "); }
            put_pretty(sb, v->items[i], indent + 2);
            r2d_sb_puts(sb, i + 1 < v->count ? ",\n" : "\n");
        }
        for (int k = 0; k < indent; ++k) r2d_sb_putc(sb, ' ');
        r2d_sb_putc(sb, obj ? '}' : ']');
    }
    r2d_sb_free(&compact);
}

// Граф собран с отступом корня; под editor.graph он вложен на два пробела глубже.
static void put_indented(R2dSb *sb, const char *text)
{
    for (const char *p = text; *p; ++p) {
        r2d_sb_putc(sb, *p);
        if (*p == '\n') r2d_sb_puts(sb, "  ");
    }
}

static void put_manifest(R2dSb *sb, const R2dJson *root, const char *graph_text)
{
    r2d_sb_puts(sb, "{\n");
    bool saw_editor = false;
    for (int i = 0; i < root->count; ++i) {
        r2d_sb_puts(sb, "  ");
        r2d_sb_put_json_string(sb, root->keys[i]);
        r2d_sb_puts(sb, ": ");
        const R2dJson *v = root->items[i];
        if (!strcmp(root->keys[i], "editor") && v->type == R2D_JSON_OBJ) {
            saw_editor = true;
            r2d_sb_puts(sb, "{\n");
            bool saw_graph = false;
            for (int k = 0; k < v->count; ++k) {
                r2d_sb_puts(sb, "    ");
                r2d_sb_put_json_string(sb, v->keys[k]);
                r2d_sb_puts(sb, ": ");
                if (!strcmp(v->keys[k], "graph")) {
                    saw_graph = true;
                    if (graph_text) put_indented(sb, graph_text);
                    else if (v->items[k]->type == R2D_JSON_OBJ) {
                        R2dSb g;
                        r2d_sb_init(&g);
                        put_graph_json(&g, v->items[k]);
                        put_indented(sb, g.data);
                        r2d_sb_free(&g);
                    } else put_pretty(sb, v->items[k], 4);
                }
                else put_pretty(sb, v->items[k], 4);
                r2d_sb_puts(sb, (k + 1 < v->count || !saw_graph) ? ",\n" : "\n");
            }
            if (!saw_graph) { r2d_sb_puts(sb, "    \"graph\": "); put_indented(sb, graph_text); r2d_sb_putc(sb, '\n'); }
            r2d_sb_puts(sb, "  }");
        } else {
            put_pretty(sb, v, 2);
        }
        r2d_sb_puts(sb, (i + 1 < root->count || !saw_editor) ? ",\n" : "\n");
    }
    if (!saw_editor) {
        r2d_sb_puts(sb, "  \"editor\": {\n    \"graph\": ");
        put_indented(sb, graph_text);
        r2d_sb_puts(sb, "\n  }\n");
    }
    r2d_sb_puts(sb, "}\n");
}

// ---------------------------------------------------------------------------
// Команда
// ---------------------------------------------------------------------------
// r2d project-index <проект> [--write] [--check]
//   по умолчанию печатает результат, ничего не записывая; --write обновляет
//   editor.graph в project.json; --check завершается с кодом 1, если запись
//   изменила бы файл (индекс устарел).
typedef struct { bool changed, written, partial; int entities, edges, sources; char manifest[2048]; } IndexResult;

// Ядро индексации: общее для команды и `r2d new`. Диагностика — в `rep`.
static void index_core(const char *dir, bool write, bool check, SdkReport *rep_ptr, IndexResult *res)
{
#define rep (*rep_ptr)
    char manifest[2048];
    sdk_join(dir, "project.json", manifest, sizeof manifest);
    R2dJson *root = NULL;
    char *old_text = NULL;
    G g;
    memset(&g, 0, sizeof g);
    Files files;
    memset(&files, 0, sizeof files);
    R2dSb graph, out_text;
    r2d_sb_init(&graph);
    r2d_sb_init(&out_text);
    bool changed = false, written = false, partial = false;

    if (!sdk_is_dir(dir)) {
        sdk_diag(&rep, SDK_ERROR, "SDK_PROJECT_NOT_FOUND", dir, NULL, NULL, "Каталог проекта не найден: %s", dir);
    } else if (!sdk_file_exists(manifest)) {
        sdk_diag(&rep, SDK_ERROR, "R2D200", manifest, NULL, NULL, "project.json не найден в «%s»", dir);
    } else if ((root = sdk_load_json(manifest, &rep)) != NULL) {
        old_text = sdk_read_file(manifest, NULL);
        if (root->type != R2D_JSON_OBJ) {
            sdk_diag(&rep, SDK_ERROR, "SDK_PROJECT_ROOT", manifest, NULL, NULL, "project.json должен быть объектом");
        } else if ((int)r2d_json_num(r2d_json_get(root, "schema_version"), 0) != 2) {
            sdk_diag(&rep, SDK_ERROR, "R2D207", manifest, "{\"field\":\"schema_version\"}", NULL,
                     "граф проекта хранится только в project.json со schema_version 2 (r2d migrate-project)");
        } else {
            const R2dJson *runtime = r2d_json_get(root, "runtime");
            const char *entry = r2d_json_str(r2d_json_get(runtime, "entry"), "main.js");
            g.root = dir;
            g.entry = entry;
            files.root = dir;
            SDL_EnumerateDirectory(dir, files_cb, &files);
            qsort(files.paths, (size_t)files.n, G_PATH, cmp_path);

            for (int i = 0; i < files.n; ++i) {
                char full[2048];
                sdk_join(dir, files.paths[i], full, sizeof full);
                size_t size = 0;
                char *text = sdk_read_file(full, &size);
                if (!text) continue;
                if (g.src_n == g.src_cap) {
                    g.src_cap = g.src_cap ? g.src_cap * 2 : 32;
                    g.src_path = (char (*)[G_PATH])realloc(g.src_path, (size_t)g.src_cap * G_PATH);
                    g.src_hash = (uint64_t *)realloc(g.src_hash, (size_t)g.src_cap * sizeof *g.src_hash);
                }
                SDL_snprintf(g.src_path[g.src_n], G_PATH, "%s", files.paths[i]);
                g.src_hash[g.src_n++] = sdk_deps_hash64(text, size);
                Toks t;
                if (scan(text, &t)) scan_file(&g, files.paths[i], &t);
                else dg(&g, "R2D303", files.paths[i], 1, "файл не удалось разобрать — граф неполный");
                toks_free(&t);
                free(text);
            }

            // Отложенные '#id'-родители.
            for (int i = 0; i < g.edges_n; ++i) {
                Edge *e = &g.edges[i];
                if (!e->to_sel[0] || e->from[0]) continue;
                char key[G_KEY];
                SDL_snprintf(key, sizeof key, "object:%s", e->to_sel);
                if (find_ent(&g, key) >= 0) {
                    scpy(e->from, sizeof e->from, key);
                    char k2[sizeof e->key];
                    SDL_snprintf(k2, sizeof k2, "edge:%s:%s>%s", e->type, e->from, e->to);
                    scpy(e->key, sizeof e->key, k2);
                } else {
                    dg(&g, "R2D301", e->file, e->line, "родитель #%s не найден среди объектов с id — связь не построена", e->to_sel);
                }
            }
            // Повтор после разрешения: связь не хранится дважды.
            for (int i = 0; i < g.edges_n; ++i)
                for (int j = i + 1; j < g.edges_n;) {
                    if (g.edges[i].from[0] && !strcmp(g.edges[i].key, g.edges[j].key)) {
                        memmove(&g.edges[j], &g.edges[j + 1], (size_t)(g.edges_n - j - 1) * sizeof *g.edges);
                        g.edges_n--;
                    } else j++;
                }

            partial = g.dgs_n > 0;
            put_graph(&graph, &g, r2d_json_get(r2d_json_get(root, "editor"), "graph"), partial);
            // Запись — только канонической формой: разбор собранного текста и повторная печать.
            char gerr[128];
            R2dJson *gtree = r2d_json_parse(graph.data, gerr, sizeof gerr);
            if (gtree) {
                R2dSb canon;
                r2d_sb_init(&canon);
                put_graph_json(&canon, gtree);
                r2d_sb_clear(&graph);
                r2d_sb_puts(&graph, canon.data);
                r2d_sb_free(&canon);
                r2d_json_free(gtree);
            }
            put_manifest(&out_text, root, graph.data);
            changed = !old_text || strcmp(old_text, out_text.data) != 0;
            if (write && changed) {
                if (sdk_write_file(manifest, out_text.data, out_text.len)) written = true;
                else sdk_diag(&rep, SDK_ERROR, "SDK_IO", manifest, NULL, NULL, "не удалось записать project.json");
            }
            if (check && changed)
                sdk_diag(&rep, SDK_WARNING, "R2D206", manifest, "{\"field\":\"editor.graph\"}", NULL,
                         "индекс графа устарел: выполните r2d project-index --write");
        }
    }

    res->changed = changed;
    res->written = written;
    res->partial = partial;
    res->entities = g.ents_n;
    res->edges = g.edges_n;
    res->sources = g.src_n;
    snprintf(res->manifest, sizeof res->manifest, "%s", manifest);

    r2d_sb_free(&graph);
    r2d_sb_free(&out_text);
    r2d_json_free(root);
    free(old_text);
    free(files.paths);
    free(g.ents);
    free(g.edges);
    free(g.dgs);
    free(g.src_path);
    free(g.src_hash);
#undef rep
}

// Для `r2d new`: записывает editor.graph в только что созданный проект.
// Манифест без schema_version пропускается без ошибки.
bool sdk_project_index_write(const char *dir, SdkReport *rep)
{
    char manifest[2048];
    sdk_join(dir, "project.json", manifest, sizeof manifest);
    char *text = sdk_read_file(manifest, NULL);
    const bool v2 = text && strstr(text, "\"schema_version\"") != NULL;
    free(text);
    if (!v2) return true;
    IndexResult res;
    memset(&res, 0, sizeof res);
    const int before = rep->errors;
    index_core(dir, true, false, rep, &res);
    return rep->errors == before;
}

int sdk_cmd_project_index(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *dir = sdk_arg_positional(a, 0);
    if (dir && !strcmp(dir, "index")) dir = sdk_arg_positional(a, 1);   // `project index <dir>`
    if (!dir) dir = ".";
    const bool write = sdk_arg_flag(a, "--write");
    const bool check = sdk_arg_flag(a, "--check");

    IndexResult res;
    memset(&res, 0, sizeof res);
    index_core(dir, write, check, &rep, &res);

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"changed\":%s,\"written\":%s,\"status\":%s,",
                  rep.errors == 0 ? "true" : "false", res.changed ? "true" : "false",
                  res.written ? "true" : "false", res.partial ? "\"partial\"" : "\"current\"");
    r2d_sb_printf(&out, "\"entities\":%d,\"edges\":%d,\"sources\":%d,", res.entities, res.edges, res.sources);
    sdk_put_kv_str(&out, "project", res.manifest);
    r2d_sb_putc(&out, ',');
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);
    const int rc = rep.errors == 0 && !(check && res.changed) ? 0 : 1;
    r2d_sb_free(&out);
    sdk_report_free(&rep);
    return rc;
}

// ---------------------------------------------------------------------------
// r2d project-set <проект> <путь=JSON> [<путь=JSON> …]
//
// Запись настроек schema_version 2 тем же писателем, что у индексатора:
// порядок и неизвестные поля сохраняются, editor.graph не переформатируется.
// Разрешены только настройки (project.*, runtime.*): граф принадлежит
// индексатору. `путь=` без значения (или null) удаляет поле. Результат
// проверяется тем же validate, что и CLI; при ошибке файл не меняется.
// ---------------------------------------------------------------------------
static const char *const k_settable[] = {
    "project.name", "project.version", "runtime.entry", "runtime.start_scene",
    "runtime.window.title", "runtime.window.width", "runtime.window.height",
    "runtime.window.fullscreen", NULL
};

static R2dJson *obj_find(R2dJson *o, const char *key)
{
    for (int i = 0; o && o->type == R2D_JSON_OBJ && i < o->count; ++i)
        if (!strcmp(o->keys[i], key)) return o->items[i];
    return NULL;
}

static bool obj_put(R2dJson *o, const char *key, R2dJson *val)
{
    for (int i = 0; i < o->count; ++i)
        if (!strcmp(o->keys[i], key)) { r2d_json_free(o->items[i]); o->items[i] = val; return true; }
    char **keys = (char **)realloc(o->keys, sizeof(char *) * (size_t)(o->count + 1));
    if (!keys) return false;
    o->keys = keys;
    R2dJson **items = (R2dJson **)realloc(o->items, sizeof(R2dJson *) * (size_t)(o->count + 1));
    if (!items) return false;
    o->items = items;
    o->keys[o->count] = strdup(key);
    o->items[o->count] = val;
    o->count++;
    return true;
}

static void obj_drop(R2dJson *o, const char *key)
{
    for (int i = 0; i < o->count; ++i) {
        if (strcmp(o->keys[i], key)) continue;
        free(o->keys[i]);
        r2d_json_free(o->items[i]);
        memmove(&o->keys[i], &o->keys[i + 1], sizeof(char *) * (size_t)(o->count - i - 1));
        memmove(&o->items[i], &o->items[i + 1], sizeof(R2dJson *) * (size_t)(o->count - i - 1));
        o->count--;
        return;
    }
}

// Применяет одну правку к дереву. Пустое значение удаляет поле и пустые родители.
static bool apply_set(R2dJson *root, const char *path, const char *value, char *err, size_t errcap)
{
    char parts[4][64];
    int n = 0;
    for (const char *p = path; *p && n < 4;) {
        const char *dot = strchr(p, '.');
        size_t len = dot ? (size_t)(dot - p) : strlen(p);
        if (len == 0 || len >= sizeof parts[0]) break;
        memcpy(parts[n], p, len);
        parts[n++][len] = 0;
        p += len + (dot ? 1 : 0);
    }
    R2dJson *node[5] = { root, NULL, NULL, NULL, NULL };
    const bool unset = !value[0] || !strcmp(value, "null");
    for (int i = 0; i < n - 1; ++i) {
        R2dJson *next = obj_find(node[i], parts[i]);
        if (next && next->type != R2D_JSON_OBJ) {
            snprintf(err, errcap, "%s: родитель не объект", path);
            return false;
        }
        if (!next) {
            if (unset) return true;
            R2dJson *fresh = r2d_json_parse("{}", err, errcap);
            if (!fresh || !obj_put(node[i], parts[i], fresh)) { snprintf(err, errcap, "нет памяти"); return false; }
            next = fresh;
        }
        node[i + 1] = next;
    }
    R2dJson *leafparent = node[n - 1];
    if (unset) {
        obj_drop(leafparent, parts[n - 1]);
        for (int i = n - 2; i >= 0; --i)
            if (node[i + 1]->count == 0) obj_drop(node[i], parts[i]); else break;
        return true;
    }
    R2dJson *val = r2d_json_parse(value, err, errcap);
    if (!val) return false;
    if (!obj_put(leafparent, parts[n - 1], val)) { r2d_json_free(val); snprintf(err, errcap, "нет памяти"); return false; }
    return true;
}

int sdk_cmd_project_set(const SdkArgs *a)
{
    SdkReport rep;
    sdk_report_init(&rep);
    const char *dir = sdk_arg_positional(a, 0);
    char manifest[2048], temp[2100];
    R2dSb text;
    r2d_sb_init(&text);
    R2dJson *root = NULL;
    bool written = false;
    int applied = 0;

    if (!dir || !sdk_arg_positional(a, 1)) {
        sdk_diag(&rep, SDK_ERROR, "SDK_USAGE", "", NULL, NULL, "Использование: r2d project-set <проект> <путь=JSON> [<путь=JSON> …]");
    } else {
        sdk_join(dir, "project.json", manifest, sizeof manifest);
        if ((root = sdk_load_json(manifest, &rep)) != NULL) {
            if (root->type != R2D_JSON_OBJ || (int)r2d_json_num(r2d_json_get(root, "schema_version"), 0) != 2) {
                sdk_diag(&rep, SDK_ERROR, "R2D207", manifest, "{\"field\":\"schema_version\"}", NULL,
                         "project-set работает с project.json со schema_version 2 (r2d migrate-project)");
            } else {
                for (int i = 1; sdk_arg_positional(a, i); ++i) {
                    const char *pair = sdk_arg_positional(a, i);
                    const char *eq = strchr(pair, '=');
                    char path[96];
                    if (!eq || (size_t)(eq - pair) >= sizeof path) {
                        sdk_diag(&rep, SDK_ERROR, "SDK_USAGE", manifest, NULL, NULL, "«%s»: ожидалось путь=JSON", pair);
                        break;
                    }
                    memcpy(path, pair, (size_t)(eq - pair));
                    path[eq - pair] = 0;
                    bool known = false;
                    for (int k = 0; k_settable[k] && !known; ++k) known = !strcmp(k_settable[k], path);
                    if (!known) {
                        sdk_diag(&rep, SDK_ERROR, "R2D210", manifest, NULL, NULL,
                                 "«%s» нельзя менять через project-set (граф принадлежит индексатору)", path);
                        break;
                    }
                    char err[160] = "";
                    if (!apply_set(root, path, eq + 1, err, sizeof err)) {
                        sdk_diag(&rep, SDK_ERROR, "R2D203", manifest, NULL, NULL, "%s: %s", path, err);
                        break;
                    }
                    applied++;
                }
                if (rep.errors == 0) {
                    put_manifest(&text, root, NULL);
                    snprintf(temp, sizeof temp, "%s/.project.json.set.tmp", dir);
                    if (!sdk_write_file(temp, text.data, text.len)) {
                        sdk_diag(&rep, SDK_ERROR, "SDK_IO", manifest, NULL, NULL, "не удалось записать черновик project.json");
                    } else {
                        SdkReport check;
                        sdk_report_init(&check);
                        sdk_validate_file(temp, "project", &check);
                        if (check.errors) {
                            // диагностика черновика приходит с путём временного файла — подменим на настоящий
                            sdk_diag(&rep, SDK_ERROR, "R2D203", manifest, NULL, NULL,
                                     "новые значения не проходят проверку: файл не изменён");
                            if (check.items.data) r2d_sb_puts(&rep.items, rep.items.len ? "," : "");
                            if (check.items.data) r2d_sb_puts(&rep.items, check.items.data);
                            rep.errors += check.errors;
                            rep.count += check.count;
                        } else if (SDL_RenamePath(temp, manifest)) {
                            written = true;
                        } else {
                            sdk_diag(&rep, SDK_ERROR, "SDK_IO", manifest, NULL, NULL, "не удалось заменить project.json");
                        }
                        SDL_RemovePath(temp);
                        sdk_report_free(&check);
                    }
                }
            }
        }
    }

    R2dSb out;
    r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,\"written\":%s,\"applied\":%d,", rep.errors == 0 ? "true" : "false",
                  written ? "true" : "false", applied);
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);
    const int rc = rep.errors == 0 ? 0 : 1;
    r2d_sb_free(&out);
    r2d_sb_free(&text);
    r2d_json_free(root);
    sdk_report_free(&rep);
    return rc;
}
