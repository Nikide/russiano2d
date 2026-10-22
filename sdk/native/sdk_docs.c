// ===========================================================================
// r2d docs list | show | search — документация из встроенного пакета бинарника.
//
// Страницы docs/*.md лежат внутри r2d (tools/embed_bundle.py), поэтому агенту
// не нужен каталог docs/ рядом: всё отдаётся CLI структурированно (JSON).
//   r2d docs list [--filter текст]
//   r2d docs show <страница> [--raw]       страница: highlevel/ui, ui.md, docs/ui.md
//   r2d docs search <запрос> [--limit N]
//   r2d docs api <путь|часть> [--limit N]  сигнатуры `$`-API из api.schema.json (есть ли такое имя)
//   r2d docs context <вопрос> [--limit N]  лучшие куски по BM25 (RU/EN) — готовый контекст для агента
//   r2d docs generate [--out-dir DIR]      прежнее поведение: generated $ API reference
// Без подкоманды и с --out-dir работает «generate» (совместимость).
// ===========================================================================
#include "sdk.h"
#include "payload.h"
#include "json.h"

#include <SDL3/SDL.h>
#include <ctype.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

static bool is_doc(const R2dPayloadFile *f)
{
    const size_t n = strlen(f->path);
    return strncmp(f->path, "docs/", 5) == 0 && n > 8 && strcmp(f->path + n - 3, ".md") == 0;
}

static const R2dPayload *bundle_or_fail(const char *what)
{
    const R2dPayload *b = r2d_bundle();
    if (!b) {
        printf("{\"ok\":false,\"code\":\"SDK_DOCS_NO_BUNDLE\",\"message\":\"%s: в этой сборке нет встроенной документации\"}\n", what);
    }
    return b;
}

// Первая строка «# Заголовок» (без решётки); пусто, если её нет.
static void doc_title(const R2dPayloadFile *f, char *out, size_t cap)
{
    out[0] = '\0';
    const char *p = (const char *)f->data, *end = p + f->size;
    while (p < end) {
        const char *nl = memchr(p, '\n', (size_t)(end - p));
        const char *line_end = nl ? nl : end;
        if (line_end - p > 2 && p[0] == '#' && p[1] == ' ') {
            size_t len = (size_t)(line_end - p - 2);
            if (len >= cap) len = cap - 1;
            memcpy(out, p + 2, len);
            out[len] = '\0';
            return;
        }
        p = line_end + 1;
    }
}

// Складывает регистр: ASCII и русские буквы в UTF-8 (А–Я → а–я, Ё → ё).
static char *fold(const char *s, size_t n)
{
    char *out = (char *)malloc(n + 1);
    if (!out) return NULL;
    for (size_t i = 0; i < n; ++i) {
        unsigned char c = (unsigned char)s[i];
        if (c < 0x80) { out[i] = (char)tolower(c); continue; }
        if (c == 0xD0 && i + 1 < n) {
            unsigned char d = (unsigned char)s[i + 1];
            if (d >= 0x90 && d <= 0x9F) { out[i] = (char)0xD0; out[i + 1] = (char)(d + 0x20); ++i; continue; }
            if (d >= 0xA0 && d <= 0xAF) { out[i] = (char)0xD1; out[i + 1] = (char)(d - 0x20); ++i; continue; }
            if (d == 0x81) { out[i] = (char)0xD1; out[i + 1] = (char)0x91; ++i; continue; }
        }
        out[i] = (char)c;
    }
    out[n] = '\0';
    return out;
}

static const R2dPayloadFile *find_doc(const R2dPayload *b, const char *name)
{
    char want[512];
    if (strncmp(name, "docs/", 5) == 0) name += 5;
    snprintf(want, sizeof want, "docs/%s", name);
    size_t n = strlen(want);
    const bool has_ext = n > 3 && strcmp(want + n - 3, ".md") == 0;
    for (int i = 0; i < b->file_count; ++i) {
        const R2dPayloadFile *f = &b->files[i];
        if (!is_doc(f)) continue;
        if (strcmp(f->path, want) == 0) return f;
        if (!has_ext && strlen(f->path) == n + 3 && strncmp(f->path, want, n) == 0) return f;
    }
    return NULL;
}

static int docs_list(const SdkArgs *a)
{
    const R2dPayload *b = bundle_or_fail("docs list");
    if (!b) return 2;
    const char *filter = sdk_arg_value(a, "--filter");
    char *needle = filter ? fold(filter, strlen(filter)) : NULL;
    R2dSb out; r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"ok\":true,\"docs\":[");
    int count = 0;
    for (int i = 0; i < b->file_count; ++i) {
        const R2dPayloadFile *f = &b->files[i];
        if (!is_doc(f)) continue;
        char title[256];
        doc_title(f, title, sizeof title);
        if (needle) {
            char *hay = fold(f->path, strlen(f->path));
            char *ht = fold(title, strlen(title));
            const bool hit = (hay && strstr(hay, needle)) || (ht && strstr(ht, needle));
            free(hay); free(ht);
            if (!hit) continue;
        }
        if (count++) r2d_sb_putc(&out, ',');
        r2d_sb_puts(&out, "{\"path\":");
        r2d_sb_put_json_string(&out, f->path);
        r2d_sb_puts(&out, ",\"title\":");
        r2d_sb_put_json_string(&out, title);
        r2d_sb_printf(&out, ",\"bytes\":%zu}", f->size);
    }
    r2d_sb_printf(&out, "],\"count\":%d}", count);
    printf("%s\n", out.data);
    r2d_sb_free(&out);
    free(needle);
    return 0;
}

static int docs_show(const SdkArgs *a)
{
    const char *name = sdk_arg_positional(a, 1);
    if (!name || !name[0]) {
        printf("{\"ok\":false,\"code\":\"SDK_DOCS_USAGE\",\"message\":\"r2d docs show <страница>, список — r2d docs list\"}\n");
        return 2;
    }
    const R2dPayload *b = bundle_or_fail("docs show");
    if (!b) return 2;
    const R2dPayloadFile *f = find_doc(b, name);
    if (!f) {
        R2dSb out; r2d_sb_init(&out);
        r2d_sb_puts(&out, "{\"ok\":false,\"code\":\"SDK_DOCS_NOT_FOUND\",\"message\":");
        r2d_sb_put_json_string(&out, "нет такой страницы; список — r2d docs list");
        r2d_sb_puts(&out, ",\"name\":");
        r2d_sb_put_json_string(&out, name);
        r2d_sb_putc(&out, '}');
        printf("%s\n", out.data);
        r2d_sb_free(&out);
        return 2;
    }
    bool raw = false;
    for (int i = 0; i < a->argc; ++i) if (strcmp(a->argv[i], "--raw") == 0) raw = true;
    if (raw) {
        fwrite(f->data, 1, f->size, stdout);
        return 0;
    }
    char *text = (char *)malloc(f->size + 1);
    if (!text) return 2;
    memcpy(text, f->data, f->size);
    text[f->size] = '\0';
    R2dSb out; r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"ok\":true,\"path\":");
    r2d_sb_put_json_string(&out, f->path);
    r2d_sb_puts(&out, ",\"text\":");
    r2d_sb_put_json_string(&out, text);
    r2d_sb_putc(&out, '}');
    printf("%s\n", out.data);
    r2d_sb_free(&out);
    free(text);
    return 0;
}

static int docs_search(const SdkArgs *a)
{
    const char *query = sdk_arg_positional(a, 1);
    if (!query || !query[0]) {
        printf("{\"ok\":false,\"code\":\"SDK_DOCS_USAGE\",\"message\":\"r2d docs search <запрос> [--limit N]\"}\n");
        return 2;
    }
    const R2dPayload *b = bundle_or_fail("docs search");
    if (!b) return 2;
    const char *limit_arg = sdk_arg_value(a, "--limit");
    int limit = limit_arg ? atoi(limit_arg) : 50;
    if (limit < 1) limit = 50;
    char *needle = fold(query, strlen(query));
    if (!needle) return 2;

    R2dSb out; r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"ok\":true,\"query\":");
    r2d_sb_put_json_string(&out, query);
    r2d_sb_puts(&out, ",\"matches\":[");
    int count = 0;
    bool truncated = false;
    for (int i = 0; i < b->file_count && !truncated; ++i) {
        const R2dPayloadFile *f = &b->files[i];
        if (!is_doc(f)) continue;
        const char *p = (const char *)f->data, *end = p + f->size;
        int line_no = 0;
        while (p < end) {
            const char *nl = memchr(p, '\n', (size_t)(end - p));
            const char *line_end = nl ? nl : end;
            ++line_no;
            const size_t len = (size_t)(line_end - p);
            char *low = fold(p, len);
            if (low && strstr(low, needle)) {
                if (count >= limit) { truncated = true; free(low); break; }
                char text[400];
                size_t t = len < sizeof text - 1 ? len : sizeof text - 1;
                // Не рвём UTF-8: обрезаем по границе символа.
                while (t > 0 && t < len && ((unsigned char)p[t] & 0xC0) == 0x80) --t;
                memcpy(text, p, t);
                text[t] = '\0';
                if (count++) r2d_sb_putc(&out, ',');
                r2d_sb_puts(&out, "{\"path\":");
                r2d_sb_put_json_string(&out, f->path);
                r2d_sb_printf(&out, ",\"line\":%d,\"text\":", line_no);
                r2d_sb_put_json_string(&out, text);
                r2d_sb_putc(&out, '}');
            }
            free(low);
            p = line_end + 1;
        }
    }
    r2d_sb_printf(&out, "],\"count\":%d,\"truncated\":%s}", count, truncated ? "true" : "false");
    printf("%s\n", out.data);
    r2d_sb_free(&out);
    free(needle);
    return 0;
}

// ---------------------------------------------------------------------------
// docs context: BM25 по кускам страниц. Без весов и индекса на диске — страницы
// уже в памяти бинарника. Слова режутся до 6 символов (грубый стемминг RU/EN),
// заголовок куска входит в его текст, поэтому совпадение в нём тоже считается.
// ---------------------------------------------------------------------------
#define CTX_MAX_TERMS 16
#define CTX_STEM 6

typedef struct { const R2dPayloadFile *f; size_t off, len; int line; int tf[CTX_MAX_TERMS]; int dl; double score; } CtxChunk;

// Следующее слово: [start,end) в s; false в конце. Байты >=0x80 — буквы (UTF-8).
static bool ctx_next(const char *s, size_t n, size_t *pos, size_t *a, size_t *b)
{
    size_t i = *pos;
    while (i < n && !(isalnum((unsigned char)s[i]) || (unsigned char)s[i] >= 0x80)) ++i;
    if (i >= n) return false;
    size_t j = i;
    while (j < n && (isalnum((unsigned char)s[j]) || (unsigned char)s[j] >= 0x80 || s[j] == '_')) ++j;
    *a = i; *b = j; *pos = j;
    return true;
}

// Основа слова: до CTX_STEM символов UTF-8, в нижнем регистре; пишет в out.
static size_t ctx_stem(const char *w, size_t n, char *out, size_t cap)
{
    char *low = fold(w, n);
    if (!low) return 0;
    size_t o = 0; int chars = 0;
    for (size_t i = 0; i < n && o + 1 < cap; ++i) {
        if (((unsigned char)low[i] & 0xC0) != 0x80) { if (chars == CTX_STEM) break; ++chars; }
        out[o++] = low[i];
    }
    out[o] = '\0';
    free(low);
    return o;
}

// Служебные слова запроса: не несут темы, но перетягивают счёт.
static bool ctx_stop(const char *st)
{
    static const char *const stop[] = {
        "как", "что", "для", "его", "её", "это", "при", "или", "где", "когда", "можно", "нужно", "чтобы", "надо",
        "the", "and", "how", "for", "with", "can", "what", "does", "from", "this", "that", "into", "use", NULL };
    for (int i = 0; stop[i]; ++i) if (strcmp(stop[i], st) == 0) return true;
    return false;
}

static int ctx_cmp(const void *x, const void *y)
{
    const double a = ((const CtxChunk *)x)->score, b = ((const CtxChunk *)y)->score;
    return a < b ? 1 : a > b ? -1 : 0;
}

static int docs_context(const SdkArgs *a)
{
    const char *query = sdk_arg_positional(a, 1);
    if (!query || !query[0]) {
        printf("{\"ok\":false,\"code\":\"SDK_DOCS_USAGE\",\"message\":\"r2d docs context <вопрос> [--limit N]\"}\n");
        return 2;
    }
    const R2dPayload *b = bundle_or_fail("docs context");
    if (!b) return 2;
    const char *limit_arg = sdk_arg_value(a, "--limit");
    int limit = limit_arg ? atoi(limit_arg) : 5;
    if (limit < 1) limit = 5;
    if (limit > 20) limit = 20;

    char terms[CTX_MAX_TERMS][40];
    int nterms = 0;
    {
        size_t qn = strlen(query), pos = 0, s0, e0;
        while (nterms < CTX_MAX_TERMS && ctx_next(query, qn, &pos, &s0, &e0)) {
            char st[40];
            if (!ctx_stem(query + s0, e0 - s0, st, sizeof st) || strlen(st) < 3 || ctx_stop(st)) continue;
            bool dup = false;
            for (int t = 0; t < nterms; ++t) if (strcmp(terms[t], st) == 0) dup = true;
            if (!dup) strcpy(terms[nterms++], st);
        }
    }
    if (nterms == 0) {
        printf("{\"ok\":true,\"query\":\"\",\"chunks\":[],\"count\":0}\n");
        return 0;
    }

    size_t cap = 1024, count = 0;
    CtxChunk *chunks = (CtxChunk *)calloc(cap, sizeof *chunks);
    if (!chunks) return 2;
    for (int i = 0; i < b->file_count; ++i) {
        const R2dPayloadFile *f = &b->files[i];
        if (!is_doc(f)) continue;
        const char *d = (const char *)f->data;
        size_t p = 0, start = 0; int line = 1, start_line = 1;
        for (;;) {
            const char *nl = p < f->size ? memchr(d + p, '\n', f->size - p) : NULL;
            size_t le = nl ? (size_t)(nl - d) : f->size;
            const bool heading = le > p && d[p] == '#';
            const bool at_end = p >= f->size;
            const bool soft = le == p && p - start > 1800;
            if ((heading && p > start) || soft || at_end) {
                if (p > start) {
                    if (count == cap) {
                        cap *= 2;
                        CtxChunk *g = (CtxChunk *)realloc(chunks, cap * sizeof *chunks);
                        if (!g) { free(chunks); return 2; }
                        chunks = g;
                        memset(chunks + count, 0, (cap - count) * sizeof *chunks);
                    }
                    CtxChunk *c = &chunks[count++];
                    c->f = f; c->off = start; c->len = p - start; c->line = start_line;
                }
                start = p; start_line = line;
            }
            if (at_end) break;
            p = le + 1; ++line;
        }
    }

    // tf по запросным основам и длина куска в словах.
    double total_len = 0;
    int df[CTX_MAX_TERMS] = {0};
    for (size_t k = 0; k < count; ++k) {
        CtxChunk *c = &chunks[k];
        const char *d = (const char *)c->f->data + c->off;
        size_t pos = 0, s0, e0;
        while (ctx_next(d, c->len, &pos, &s0, &e0)) {
            char st[40];
            if (!ctx_stem(d + s0, e0 - s0, st, sizeof st)) continue;
            ++c->dl;
            for (int t = 0; t < nterms; ++t) if (strcmp(terms[t], st) == 0) { ++c->tf[t]; break; }
        }
        total_len += c->dl;
        for (int t = 0; t < nterms; ++t) if (c->tf[t]) ++df[t];
    }
    const double avg = count ? total_len / (double)count : 1.0;
    for (size_t k = 0; k < count; ++k) {
        CtxChunk *c = &chunks[k];
        for (int t = 0; t < nterms; ++t) {
            if (!c->tf[t]) continue;
            const double idf = log(1.0 + ((double)count - df[t] + 0.5) / (df[t] + 0.5));
            const double tf = c->tf[t];
            c->score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * c->dl / avg));
        }
    }
    qsort(chunks, count, sizeof *chunks, ctx_cmp);

    R2dSb out; r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"ok\":true,\"query\":");
    r2d_sb_put_json_string(&out, query);
    r2d_sb_puts(&out, ",\"chunks\":[");
    int shown = 0;
    for (size_t k = 0; k < count && shown < limit && chunks[k].score > 0; ++k) {
        const CtxChunk *c = &chunks[k];
        const char *d = (const char *)c->f->data + c->off;
        size_t t = c->len < 1800 ? c->len : 1800;
        while (t > 0 && t < c->len && ((unsigned char)d[t] & 0xC0) == 0x80) --t;
        char *text = (char *)malloc(t + 1);
        if (!text) break;
        memcpy(text, d, t); text[t] = '\0';
        if (shown++) r2d_sb_putc(&out, ',');
        r2d_sb_puts(&out, "{\"path\":");
        r2d_sb_put_json_string(&out, c->f->path);
        r2d_sb_printf(&out, ",\"line\":%d,\"score\":%.3f,\"truncated\":%s,\"text\":", c->line, c->score, t < c->len ? "true" : "false");
        r2d_sb_put_json_string(&out, text);
        r2d_sb_putc(&out, '}');
        free(text);
    }
    r2d_sb_printf(&out, "],\"count\":%d}", shown);
    printf("%s\n", out.data);
    r2d_sb_free(&out);
    free(chunks);
    return 0;
}

// ---------------------------------------------------------------------------
// docs api: поиск имён `$`-API в схеме из бинарника. Точное совпадение пути —
// первым, затем префикс, затем подстрока (без учёта регистра). Нужен агенту,
// чтобы проверить, что метод существует и какие у него аргументы, не читая доки.
// ---------------------------------------------------------------------------
static int api_rank(const char *path, const char *q)
{
    char *p = fold(path, strlen(path)), *n = fold(q, strlen(q));
    int rank = 0;
    if (p && n) {
        if (strcmp(p, n) == 0 || (strncmp(n, "$.", 2) != 0 && strcmp(p + (strncmp(p, "$.", 2) == 0 ? 2 : 0), n) == 0)) rank = 3;
        else if (strncmp(p, n, strlen(n)) == 0) rank = 2;
        else if (strstr(p, n)) rank = 1;
    }
    free(p); free(n);
    return rank;
}

static int docs_api(const SdkArgs *a)
{
    const char *query = sdk_arg_positional(a, 1);
    if (!query || !query[0]) {
        printf("{\"ok\":false,\"code\":\"SDK_DOCS_USAGE\",\"message\":\"r2d docs api <путь|часть> [--limit N]\"}\n");
        return 2;
    }
    const R2dPayload *b = bundle_or_fail("docs api");
    if (!b) return 2;
    const R2dPayloadFile *f = r2d_payload_find(b, "api.schema.json");
    if (!f) {
        printf("{\"ok\":false,\"code\":\"SDK_DOCS_NO_SCHEMA\",\"message\":\"в сборке нет api.schema.json\"}\n");
        return 2;
    }
    char err[160];
    char *text = (char *)malloc(f->size + 1);
    if (!text) return 2;
    memcpy(text, f->data, f->size);
    text[f->size] = '\0';
    R2dJson *root = r2d_json_parse(text, err, sizeof err);
    free(text);
    const R2dJson *names = root ? r2d_json_get(root, "names") : NULL;
    if (!names) {
        r2d_json_free(root);
        printf("{\"ok\":false,\"code\":\"SDK_DOCS_BAD_SCHEMA\",\"message\":\"api.schema.json не разобран\"}\n");
        return 2;
    }
    const char *limit_arg = sdk_arg_value(a, "--limit");
    int limit = limit_arg ? atoi(limit_arg) : 12;
    if (limit < 1 || limit > 50) limit = 12;

    R2dSb out; r2d_sb_init(&out);
    r2d_sb_puts(&out, "{\"ok\":true,\"query\":");
    r2d_sb_put_json_string(&out, query);
    r2d_sb_puts(&out, ",\"entries\":[");
    int shown = 0;
    bool exact = false;
    const int total = (int)r2d_json_size(names);
    for (int rank = 3; rank >= 1 && shown < limit; --rank) {
        for (int i = 0; i < total && shown < limit; ++i) {
            const R2dJson *item = r2d_json_at(names, (size_t)i);
            const char *path = r2d_json_str(r2d_json_get(item, "path"), "");
            if (api_rank(path, query) != rank) continue;
            if (rank == 3) exact = true;
            if (shown++) r2d_sb_putc(&out, ',');
            r2d_sb_puts(&out, "{\"path\":");
            r2d_sb_put_json_string(&out, path);
            r2d_sb_puts(&out, ",\"kind\":");
            r2d_sb_put_json_string(&out, r2d_json_str(r2d_json_get(item, "kind"), ""));
            r2d_sb_puts(&out, ",\"description\":");
            r2d_sb_put_json_string(&out, r2d_json_str(r2d_json_get(item, "description"), ""));
            const R2dJson *args = r2d_json_get(item, "args");
            if (args) {
                r2d_sb_puts(&out, ",\"args\":[");
                for (int k = 0; k < (int)r2d_json_size(args); ++k) {
                    const R2dJson *ar = r2d_json_at(args, (size_t)k);
                    if (k) r2d_sb_putc(&out, ',');
                    r2d_sb_put_json_string(&out, r2d_json_str(r2d_json_get(ar, "name"), "?"));
                }
                r2d_sb_puts(&out, "]");
            }
            const char *ret = r2d_json_str(r2d_json_get(item, "returns"), "");
            if (ret[0]) { r2d_sb_puts(&out, ",\"returns\":"); r2d_sb_put_json_string(&out, ret); }
            r2d_sb_putc(&out, '}');
        }
    }
    r2d_sb_printf(&out, "],\"count\":%d,\"exact\":%s}", shown, exact ? "true" : "false");
    printf("%s\n", out.data);
    r2d_sb_free(&out);
    r2d_json_free(root);
    return 0;
}

int sdk_cmd_docs(const SdkArgs *a)
{
    const char *sub = sdk_arg_positional(a, 0);
    if (!sub || strcmp(sub, "generate") == 0) return cmd_docs_generate(a);
    if (strcmp(sub, "list") == 0) return docs_list(a);
    if (strcmp(sub, "show") == 0) return docs_show(a);
    if (strcmp(sub, "search") == 0) return docs_search(a);
    if (strcmp(sub, "context") == 0) return docs_context(a);
    if (strcmp(sub, "api") == 0) return docs_api(a);
    printf("{\"ok\":false,\"code\":\"SDK_DOCS_USAGE\",\"message\":\"docs list|show|search|context|api|generate\"}\n");
    return 2;
}
