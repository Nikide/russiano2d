// ===========================================================================
// r2d docs list | show | search — документация из встроенного пакета бинарника.
//
// Страницы docs/*.md лежат внутри r2d (tools/embed_bundle.py), поэтому агенту
// не нужен каталог docs/ рядом: всё отдаётся CLI структурированно (JSON).
//   r2d docs list [--filter текст]
//   r2d docs show <страница> [--raw]       страница: highlevel/ui, ui.md, docs/ui.md
//   r2d docs search <запрос> [--limit N]
//   r2d docs generate [--out-dir DIR]      прежнее поведение: generated $ API reference
// Без подкоманды и с --out-dir работает «generate» (совместимость).
// ===========================================================================
#include "sdk.h"
#include "payload.h"

#include <SDL3/SDL.h>
#include <ctype.h>
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

int sdk_cmd_docs(const SdkArgs *a)
{
    const char *sub = sdk_arg_positional(a, 0);
    if (!sub || strcmp(sub, "generate") == 0) return cmd_docs_generate(a);
    if (strcmp(sub, "list") == 0) return docs_list(a);
    if (strcmp(sub, "show") == 0) return docs_show(a);
    if (strcmp(sub, "search") == 0) return docs_search(a);
    printf("{\"ok\":false,\"code\":\"SDK_DOCS_USAGE\",\"message\":\"docs list|show|search|generate\"}\n");
    return 2;
}
