// ===========================================================================
// r2d-help: корпус — реестр `$` API из исходников и разделы документации.
//
// Источник правды — сам код: метод узла существует, если он объявлен через
// def()/defGet() в src/highlevel/*.js, функция пространства имён — если она
// член объекта, который присвоен `$.<имя>`. Поэтому новая фича попадает в
// помощника вместе с кодом, без ручного списка. Комментарий `/** … */` или
// строки `//` прямо над объявлением — описание. Документация режется по
// заголовкам: один раздел — одна запись.
//
// Это не парсер JS: разбор построчный и рассчитан на стиль кода движка
// (docs/highlevel/_CONTRACT.md §8: отступ 4 пробела). Что не распознано —
// просто не попадает в реестр как функция, но остаётся в разделах docs.
// ===========================================================================
#include "help.h"

#include <SDL3/SDL.h>

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define DOC_CHUNK_MAX 1600   // байт текста раздела в одной записи

// ---------------------------------------------------------------------------
// Список файлов (отсортированный: порядок обхода каталога зависит от ОС)
// ---------------------------------------------------------------------------
typedef struct FileList {
    char **paths;   // относительно root, с «/»
    int    count;
    int    cap;
} FileList;

static void list_push(FileList *l, const char *rel)
{
    if (l->count == l->cap) {
        const int cap = l->cap ? l->cap * 2 : 64;
        char **p = (char **)realloc(l->paths, (size_t)cap * sizeof *p);
        if (!p) return;
        l->paths = p;
        l->cap = cap;
    }
    const size_t n = strlen(rel);
    char *s = (char *)malloc(n + 1);
    if (!s) return;
    memcpy(s, rel, n + 1);
    l->paths[l->count++] = s;
}

static void list_free(FileList *l)
{
    for (int i = 0; i < l->count; ++i) free(l->paths[i]);
    free(l->paths);
    memset(l, 0, sizeof *l);
}

static int cmp_str(const void *a, const void *b)
{
    return strcmp(*(const char *const *)a, *(const char *const *)b);
}

typedef struct Walk {
    const char *root;
    const char *suffix;
    FileList   *out;
    bool        recursive;
} Walk;

static void walk_dir(const Walk *w, const char *rel_dir);

typedef struct WalkCtx {
    const Walk *w;
    const char *rel_dir;
} WalkCtx;

static SDL_EnumerationResult SDLCALL walk_cb(void *user, const char *dirname, const char *fname)
{
    (void)dirname;
    const WalkCtx *c = (const WalkCtx *)user;
    if (fname[0] == '.') return SDL_ENUM_CONTINUE;
    char rel[1024], full[2048];
    snprintf(rel, sizeof rel, "%s/%s", c->rel_dir, fname);
    snprintf(full, sizeof full, "%s/%s", c->w->root, rel);
    SDL_PathInfo info;
    if (!SDL_GetPathInfo(full, &info)) return SDL_ENUM_CONTINUE;
    if (info.type == SDL_PATHTYPE_DIRECTORY) {
        // Картинки и машинные замеры — не текст для помощника.
        if (c->w->recursive && strcmp(fname, "images") != 0 && strcmp(fname, "screenshots") != 0 &&
            strcmp(fname, "benchmarks") != 0) {
            walk_dir(c->w, rel);
        }
    } else if (info.type == SDL_PATHTYPE_FILE && sdk_ends_with(fname, c->w->suffix)) {
        list_push(c->w->out, rel);
    }
    return SDL_ENUM_CONTINUE;
}

static void walk_dir(const Walk *w, const char *rel_dir)
{
    char full[2048];
    snprintf(full, sizeof full, "%s/%s", w->root, rel_dir);
    WalkCtx c = { w, rel_dir };
    SDL_EnumerateDirectory(full, walk_cb, &c);
}

static void collect_files(const char *root, FileList *js, FileList *md)
{
    Walk wj = { root, ".js", js, false };
    walk_dir(&wj, "src/highlevel");
    Walk wm = { root, ".md", md, true };
    walk_dir(&wm, "docs");
    qsort(js->paths, (size_t)js->count, sizeof *js->paths, cmp_str);
    qsort(md->paths, (size_t)md->count, sizeof *md->paths, cmp_str);
}

bool help_root_ok(const char *root)
{
    char a[2048], b[2048];
    snprintf(a, sizeof a, "%s/src/highlevel/api.js", root);
    snprintf(b, sizeof b, "%s/docs", root);
    return sdk_file_exists(a) && sdk_is_dir(b);
}

uint64_t help_sources_hash(const char *root)
{
    FileList js = {0}, md = {0};
    collect_files(root, &js, &md);
    uint64_t h = 0;
    FileList *lists[2] = { &js, &md };
    for (int l = 0; l < 2; ++l) {
        for (int i = 0; i < lists[l]->count; ++i) {
            const char *rel = lists[l]->paths[i];
            char full[2048];
            snprintf(full, sizeof full, "%s/%s", root, rel);
            SDL_PathInfo info;
            int64_t meta[2] = { -1, -1 };
            if (SDL_GetPathInfo(full, &info)) {
                meta[0] = (int64_t)info.size;
                meta[1] = (int64_t)info.modify_time;
            }
            h = help_fnv1a(rel, strlen(rel) + 1, h);
            h = help_fnv1a(meta, sizeof meta, h);
        }
    }
    list_free(&js);
    list_free(&md);
    return h;
}

// ---------------------------------------------------------------------------
// Мелочи разбора строк
// ---------------------------------------------------------------------------
static int indent_of(const char *line)
{
    int n = 0;
    while (line[n] == ' ') ++n;
    return n;
}

static const char *skip_ws(const char *s)
{
    while (*s == ' ' || *s == '\t') ++s;
    return s;
}

static bool is_ident_start(char c) { return isalpha((unsigned char)c) || c == '_' || c == '$'; }
static bool is_ident(char c) { return isalnum((unsigned char)c) || c == '_' || c == '$'; }

// Читает идентификатор; возвращает указатель за ним или NULL.
static const char *read_ident(const char *s, char *out, size_t cap)
{
    if (!is_ident_start(*s)) return NULL;
    size_t n = 0;
    while (is_ident(*s)) {
        if (n + 1 < cap) out[n++] = *s;
        ++s;
    }
    out[n] = '\0';
    return s;
}

// Содержимое скобок «(a, b = 1)» → «a, b = 1» (без вложенных скобок по
// строке дальше первой закрывающей на том же уровне).
static bool read_params(const char *s, char *out, size_t cap)
{
    s = skip_ws(s);
    if (*s != '(') return false;
    int depth = 0;
    size_t n = 0;
    for (++s; *s; ++s) {
        if (*s == '(' || *s == '[' || *s == '{') depth++;
        if (*s == ')' || *s == ']' || *s == '}') {
            if (depth == 0) { out[n] = '\0'; return true; }
            depth--;
        }
        if (n + 1 < cap) out[n++] = *s;
    }
    out[n] = '\0';
    return false;   // параметры на нескольких строках: берём начало
}

// Обрезает UTF-8 строку по границе символа не длиннее max байт.
static size_t utf8_clip(const char *s, size_t len, size_t max)
{
    if (len <= max) return len;
    size_t n = max;
    while (n > 0 && ((unsigned char)s[n] & 0xC0) == 0x80) --n;
    return n;
}

// ---------------------------------------------------------------------------
// Комментарий над объявлением
// ---------------------------------------------------------------------------
typedef struct Comment {
    R2dSb text;
    bool  in_block;
    int   last_line;   // строка, где комментарий закончился
} Comment;

static void comment_line(Comment *c, const char *line, int lineno)
{
    const char *s = skip_ws(line);
    if (c->in_block) {
        const char *end = strstr(s, "*/");
        const char *body = s;
        if (*body == '*' && body[1] != '/') ++body;
        body = skip_ws(body);
        const size_t n = end ? (size_t)(end - body) : strlen(body);
        if (end && end < body) { /* «*/» в начале строки */ }
        else if (n > 0) { r2d_sb_putc(&c->text, ' '); r2d_sb_printf(&c->text, "%.*s", (int)n, body); }
        if (end) { c->in_block = false; c->last_line = lineno; }
        return;
    }
    if (strncmp(s, "/**", 3) == 0 || strncmp(s, "/*", 2) == 0) {
        r2d_sb_clear(&c->text);
        const char *body = s + (s[2] == '*' ? 3 : 2);
        const char *end = strstr(body, "*/");
        body = skip_ws(body);
        const size_t n = end ? (size_t)(end - body) : strlen(body);
        if (n > 0) r2d_sb_printf(&c->text, "%.*s", (int)n, body);
        if (end) c->last_line = lineno; else c->in_block = true;
        return;
    }
    if (strncmp(s, "//", 2) == 0) {
        if (c->last_line != lineno - 1) r2d_sb_clear(&c->text);
        const char *body = skip_ws(s + 2);
        if (*body == '-' || *body == '=') { c->last_line = lineno; return; }  // разделители
        if (c->text.len > 0) r2d_sb_putc(&c->text, ' ');
        r2d_sb_puts(&c->text, body);
        c->last_line = lineno;
    }
}

// Комментарий относится к объявлению на следующей строке, иначе сброшен.
static const char *comment_for(Comment *c, int lineno)
{
    if (c->in_block || c->last_line != lineno - 1 || c->text.len == 0) return "";
    return c->text.data;
}

// ---------------------------------------------------------------------------
// Реестр API из одного JS-модуля
// ---------------------------------------------------------------------------
typedef struct Member {
    char  owner[64];      // имя переменной объекта: «nav», «api»
    char  name[96];
    char  params[256];
    char *comment;
    int   line;
} Member;

typedef struct Alias {
    char var[64];         // переменная
    char ns[96];          // «nav» для `$.nav = nav`
} Alias;

static void add_api_entry(HelpIndex *ix, int kind, const char *full_name, const char *module,
                          const char *sig, const char *rel, int line, const char *doc,
                          const char *comment)
{
    char loc[1100];
    snprintf(loc, sizeof loc, "%s:%d", rel, line);
    R2dSb t;
    r2d_sb_init(&t);
    r2d_sb_printf(&t, "%s %s\nмодуль %s\n%s", full_name, sig, module, comment ? comment : "");
    help_index_add(ix, kind, full_name, module, sig, loc, doc, t.data ? t.data : "");
    r2d_sb_free(&t);
}

static void scan_js(const char *root, const char *rel, HelpIndex *ix, SdkReport *rep)
{
    char full[2048];
    snprintf(full, sizeof full, "%s/%s", root, rel);
    size_t size = 0;
    char *src = sdk_read_file(full, &size);
    if (!src) {
        sdk_diag(rep, SDK_WARNING, "HELP_SOURCE_READ", rel, NULL, NULL, "файл не прочитан");
        return;
    }

    char module[96];
    snprintf(module, sizeof module, "%s", sdk_basename(rel));
    char *dot = strrchr(module, '.');
    if (dot) *dot = '\0';
    char doc[256] = "";
    {
        char p[2048];
        snprintf(p, sizeof p, "%s/docs/highlevel/%s.md", root, module);
        if (sdk_file_exists(p)) snprintf(doc, sizeof doc, "docs/highlevel/%s.md", module);
    }

    Member *mem = NULL;
    int nmem = 0, capmem = 0;
    Alias alias[64];
    int nalias = 0;

    // Открытые объектные литералы: переменная и её отступ.
    char obj_var[8][64];
    int obj_indent[8];
    int nobj = 0;

    Comment cm;
    memset(&cm, 0, sizeof cm);
    r2d_sb_init(&cm.text);

    int lineno = 0;
    char *line = src;
    while (line && *line) {
        char *nl = strchr(line, '\n');
        if (nl) *nl = '\0';
        if (nl && nl > line && nl[-1] == '\r') nl[-1] = '\0';
        ++lineno;
        const int ind = indent_of(line);
        const char *s = line + ind;

        if (cm.in_block || strncmp(s, "/*", 2) == 0 || strncmp(s, "//", 2) == 0) {
            comment_line(&cm, line, lineno);
            goto next;
        }

        // Закрытие объектного литерала на его отступе.
        if (nobj > 0 && ind == obj_indent[nobj - 1] && s[0] == '}') nobj--;

        // const X = {   /   let X = {
        if (strncmp(s, "const ", 6) == 0 || strncmp(s, "let ", 4) == 0) {
            char var[64];
            const char *p = read_ident(skip_ws(strchr(s, ' ')), var, sizeof var);
            if (p) {
                p = skip_ws(p);
                if (*p == '=') {
                    p = skip_ws(p + 1);
                    if (*p == '{' && skip_ws(p + 1)[0] == '\0' && nobj < 8) {
                        snprintf(obj_var[nobj], sizeof obj_var[nobj], "%s", var);
                        obj_indent[nobj++] = ind;
                    }
                }
            }
        }

        // $.ns = var;   $.ns = (args) => …;   $.ns = function (args)
        if (s[0] == '$' && s[1] == '.') {
            char ns[96];
            const char *p = read_ident(s + 2, ns, sizeof ns);
            if (p && *p == '.') p = NULL;   // $.a.b = … — не новое пространство
            if (p) {
                p = skip_ws(p);
                if (p[0] == '=' && p[1] != '=') {
                    p = skip_ws(p + 1);
                    char rhs[64];
                    const char *after = read_ident(p, rhs, sizeof rhs);
                    char params[256];
                    if (strncmp(p, "function", 8) == 0 && read_params(p + 8, params, sizeof params)) {
                        char name[128], sig[400];
                        snprintf(name, sizeof name, "$.%s", ns);
                        snprintf(sig, sizeof sig, "$.%s(%s)", ns, params);
                        add_api_entry(ix, HELP_KIND_NS, name, module, sig, rel, lineno, doc,
                                      comment_for(&cm, lineno));
                    } else if (*p == '(' && read_params(p, params, sizeof params) && strstr(p, "=>")) {
                        char name[128], sig[400];
                        snprintf(name, sizeof name, "$.%s", ns);
                        snprintf(sig, sizeof sig, "$.%s(%s)", ns, params);
                        add_api_entry(ix, HELP_KIND_NS, name, module, sig, rel, lineno, doc,
                                      comment_for(&cm, lineno));
                    } else if (after && (*skip_ws(after) == ';' || *skip_ws(after) == '\0') &&
                               nalias < 64) {
                        snprintf(alias[nalias].var, sizeof alias[nalias].var, "%s", rhs);
                        snprintf(alias[nalias].ns, sizeof alias[nalias].ns, "%s", ns);
                        nalias++;
                    } else if (*p == '{' && nobj < 8) {
                        // $.ns = {  — литерал прямо в пространстве имён
                        snprintf(obj_var[nobj], sizeof obj_var[nobj], "$.%s", ns);
                        obj_indent[nobj++] = ind;
                    }
                }
            }
        }

        // Член открытого литерала: на отступ глубже литерала.
        if (nobj > 0 && ind == obj_indent[nobj - 1] + 4 && is_ident_start(*s)) {
            char name[96];
            const char *p = read_ident(s, name, sizeof name);
            char params[256] = "";
            bool is_fn = false;
            if (p) {
                const char *q = skip_ws(p);
                if (*q == '(' && strchr(q, '{') && !strstr(q, "=>")) {
                    is_fn = read_params(q, params, sizeof params) || params[0] || true;
                } else if (*q == ':') {
                    q = skip_ws(q + 1);
                    if (strncmp(q, "function", 8) == 0) is_fn = read_params(q + 8, params, sizeof params) || true;
                    else if (*q == '(' && strstr(q, "=>")) is_fn = read_params(q, params, sizeof params) || true;
                    else if (is_ident_start(*q)) {
                        char id[64];
                        const char *r = read_ident(q, id, sizeof id);
                        if (r && strncmp(skip_ws(r), "=>", 2) == 0) { snprintf(params, sizeof params, "%s", id); is_fn = true; }
                    }
                }
            }
            if (is_fn && strcmp(name, "if") != 0 && strcmp(name, "for") != 0 &&
                strcmp(name, "while") != 0 && strcmp(name, "switch") != 0 &&
                strcmp(name, "return") != 0 && strcmp(name, "catch") != 0) {
                if (nmem == capmem) {
                    capmem = capmem ? capmem * 2 : 64;
                    Member *m = (Member *)realloc(mem, (size_t)capmem * sizeof *m);
                    if (!m) goto next;
                    mem = m;
                }
                Member *m = &mem[nmem++];
                snprintf(m->owner, sizeof m->owner, "%s", obj_var[nobj - 1]);
                snprintf(m->name, sizeof m->name, "%s", name);
                snprintf(m->params, sizeof m->params, "%s", params);
                const char *c = comment_for(&cm, lineno);
                m->comment = (char *)malloc(strlen(c) + 1);
                if (m->comment) strcpy(m->comment, c);
                m->line = lineno;
            }
        }

        // def('name', function (args)  /  def('name', (args) =>  /  defGet('name', …
        {
            const bool is_get = strncmp(s, "defGet(", 7) == 0;
            if (is_get || strncmp(s, "def(", 4) == 0) {
                const char *p = skip_ws(s + (is_get ? 7 : 4));
                const char quote = *p;
                if (quote == '\'' || quote == '"') {
                    const char *e = strchr(p + 1, quote);
                    if (e && e - p - 1 < 96) {
                        char name[96];
                        snprintf(name, sizeof name, "%.*s", (int)(e - p - 1), p + 1);
                        char params[256] = "";
                        const char *q = skip_ws(e + 1);
                        if (*q == ',') {
                            q = skip_ws(q + 1);
                            if (strncmp(q, "function", 8) == 0) read_params(q + 8, params, sizeof params);
                            else if (*q == '(') read_params(q, params, sizeof params);
                        }
                        // У геттера первый параметр — узел, а не аргумент вызова.
                        if (is_get) params[0] = '\0';
                        char full_name[128], sig[400];
                        snprintf(full_name, sizeof full_name, ".%s", name);
                        snprintf(sig, sizeof sig, ".%s(%s)", name, params);
                        add_api_entry(ix, HELP_KIND_METHOD, full_name, module, sig, rel, lineno, doc,
                                      comment_for(&cm, lineno));
                    }
                }
            }
        }
    next:
        if (!cm.in_block && cm.last_line != lineno && s[0] != '\0') {
            // Обычная строка кода: комментарий выше к следующим строкам не относится.
        }
        line = nl ? nl + 1 : NULL;
    }

    // Члены объектов, которые стали пространствами имён `$`.
    for (int i = 0; i < nmem; ++i) {
        const Member *m = &mem[i];
        const char *ns = NULL;
        if (strncmp(m->owner, "$.", 2) == 0) ns = m->owner + 2;
        for (int a = 0; !ns && a < nalias; ++a) if (strcmp(alias[a].var, m->owner) == 0) ns = alias[a].ns;
        if (ns) {
            char name[200], sig[600];
            snprintf(name, sizeof name, "$.%s.%s", ns, m->name);
            snprintf(sig, sizeof sig, "$.%s.%s(%s)", ns, m->name, m->params);
            add_api_entry(ix, HELP_KIND_NS, name, module, sig, rel, m->line, doc, m->comment);
        }
        free(m->comment);
    }
    free(mem);
    r2d_sb_free(&cm.text);
    free(src);
}

// ---------------------------------------------------------------------------
// Документация: один раздел (заголовок + текст до следующего) — одна запись
// ---------------------------------------------------------------------------
typedef struct Section {
    R2dSb body;
    char  path[6][256];   // заголовки по уровням
    int   level;          // уровень текущего заголовка (0 — до первого)
    int   line;           // строка заголовка
    int   part;
} Section;

static void flush_section(HelpIndex *ix, Section *sec, const char *rel)
{
    const char *body = sec->body.data ? sec->body.data : "";
    // Пустые разделы (только заголовок, пустые строки) не нужны.
    const char *p = body;
    while (*p == ' ' || *p == '\n' || *p == '\t') ++p;
    if (strlen(p) < 20) { r2d_sb_clear(&sec->body); return; }

    char title[300] = "";
    char crumbs[1200] = "";
    for (int l = 0; l < sec->level && l < 6; ++l) {
        if (!sec->path[l][0]) continue;
        if (crumbs[0]) strncat(crumbs, " › ", sizeof crumbs - strlen(crumbs) - 1);
        strncat(crumbs, sec->path[l], sizeof crumbs - strlen(crumbs) - 1);
        snprintf(title, sizeof title, "%s", sec->path[l]);
    }
    if (!title[0]) snprintf(title, sizeof title, "%s", sdk_basename(rel));

    // Длинный раздел режется на части по абзацам, чтобы текст влезал в окно
    // модели и не размывал смысл.
    size_t len = strlen(p);
    int part = 1;
    while (len > 0) {
        size_t take = utf8_clip(p, len, DOC_CHUNK_MAX);
        if (take < len) {
            // Разрез на границе абзаца или строки, если она недалеко.
            size_t cut = take;
            while (cut > take / 2 && !(p[cut] == '\n' && cut > 0 && p[cut - 1] == '\n')) --cut;
            if (cut <= take / 2) { cut = take; while (cut > take / 2 && p[cut] != '\n') --cut; }
            if (cut > take / 2) take = cut;
        }
        char name[340], loc[1100];
        if (part == 1 && take == len) snprintf(name, sizeof name, "%s", title);
        else snprintf(name, sizeof name, "%s (ч. %d)", title, part);
        snprintf(loc, sizeof loc, "%s:%d", rel, sec->line);
        R2dSb t;
        r2d_sb_init(&t);
        r2d_sb_printf(&t, "%s\n%.*s", crumbs[0] ? crumbs : rel, (int)take, p);
        help_index_add(ix, HELP_KIND_DOC, name, rel, "", loc, rel, t.data ? t.data : "");
        r2d_sb_free(&t);
        p += take;
        len -= take;
        while (len > 0 && (*p == '\n' || *p == ' ')) { ++p; --len; }
        part++;
    }
    r2d_sb_clear(&sec->body);
}

static void scan_md(const char *root, const char *rel, HelpIndex *ix, SdkReport *rep)
{
    char full[2048];
    snprintf(full, sizeof full, "%s/%s", root, rel);
    size_t size = 0;
    char *src = sdk_read_file(full, &size);
    if (!src) {
        sdk_diag(rep, SDK_WARNING, "HELP_SOURCE_READ", rel, NULL, NULL, "файл не прочитан");
        return;
    }
    Section sec;
    memset(&sec, 0, sizeof sec);
    r2d_sb_init(&sec.body);
    sec.line = 1;
    bool fence = false;
    int lineno = 0;
    char *line = src;
    while (line && *line) {
        char *nl = strchr(line, '\n');
        if (nl) *nl = '\0';
        if (nl && nl > line && nl[-1] == '\r') nl[-1] = '\0';
        ++lineno;
        if (strncmp(line, "```", 3) == 0) fence = !fence;
        int level = 0;
        if (!fence) while (line[level] == '#') ++level;
        if (level >= 1 && level <= 6 && line[level] == ' ') {
            flush_section(ix, &sec, rel);
            const char *h = skip_ws(line + level);
            snprintf(sec.path[level - 1], sizeof sec.path[0], "%s", h);
            for (int l = level; l < 6; ++l) sec.path[l][0] = '\0';
            sec.level = level;
            sec.line = lineno;
        } else {
            r2d_sb_puts(&sec.body, line);
            r2d_sb_putc(&sec.body, '\n');
        }
        line = nl ? nl + 1 : NULL;
    }
    flush_section(ix, &sec, rel);
    r2d_sb_free(&sec.body);
    free(src);
}

bool help_collect(const char *root, HelpIndex *ix, SdkReport *rep)
{
    if (!help_root_ok(root)) {
        sdk_diag(rep, SDK_ERROR, "HELP_ROOT", root, NULL, NULL,
                 "нет src/highlevel/api.js или docs/ — это не корень репозитория движка");
        return false;
    }
    FileList js = {0}, md = {0};
    collect_files(root, &js, &md);
    // Сначала API (короткие точные записи), затем документация.
    for (int i = 0; i < js.count; ++i) scan_js(root, js.paths[i], ix, rep);
    for (int i = 0; i < md.count; ++i) scan_md(root, md.paths[i], ix, rep);
    list_free(&js);
    list_free(&md);
    return true;
}
