// ===========================================================================
// r2d-sdk dialog validate <file.rml> — native RML/RCSS theme validator.
//
// Checks the semantic contract the VN view relies on: <rml> root, required
// data-dialog-role values (root/text/choices), duplicate structural roles,
// balanced non-void tags, linked RCSS files, and @font-face URLs used by custom
// fonts. Pure C, one backend for CLI/GUI/agent; no Python.
// ===========================================================================
#include "sdk.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { char *text; const char *path; SdkReport *rep; } DialogDoc;

static char *read_text(const char *path, SdkReport *rep)
{
    char *text = sdk_read_file(path, NULL);
    if (!text) sdk_diag(rep, SDK_ERROR, "DIALOG_RML_READ", path, NULL, NULL, "file is not readable");
    return text;
}

static int role_count(const char *text, const char *role)
{
    char needle[128];
    snprintf(needle, sizeof needle, "data-dialog-role=\"%s\"", role);
    int count = 0;
    const char *p = text;
    while ((p = strstr(p, needle)) != NULL) { count++; p += strlen(needle); }
    return count;
}

static bool is_void_tag(const char *name)
{
    static const char *voids[] = { "img", "link", "br", "input", "hr", "meta" };
    for (size_t i = 0; i < sizeof voids / sizeof voids[0]; ++i)
        if (!strcasecmp(name, voids[i])) return true;
    return false;
}

static void check_balance(DialogDoc *doc)
{
    const char *p = doc->text;
    char stack[64][32];
    int depth = 0;
    while ((p = strchr(p, '<')) != NULL) {
        if (!strncmp(p, "<!--", 4)) {
            const char *end = strstr(p + 4, "-->");
            p = end ? end + 3 : p + strlen(p);
            continue;
        }
        if (p[1] == '!' || p[1] == '?') { const char *end = strchr(p, '>'); p = end ? end + 1 : p + strlen(p); continue; }
        bool closing = p[1] == '/';
        const char *name = closing ? p + 2 : p + 1;
        const char *end = strchr(p, '>');
        if (!end) break;
        char tag[32]; size_t n = 0;
        while (name + n < end && (isalnum((unsigned char)name[n]) || name[n] == '-') && n + 1 < sizeof tag) {
            tag[n] = (char)tolower((unsigned char)name[n]); n++;
        }
        tag[n] = '\0';
        bool self = end > p && end[-1] == '/';
        if (n && !self && !is_void_tag(tag)) {
            if (closing) {
                if (depth <= 0 || strcmp(stack[depth - 1], tag)) {
                    sdk_diag(doc->rep, SDK_ERROR, "DIALOG_RML_TAG", doc->path, NULL, NULL,
                             "unexpected closing tag </%s>", tag);
                    return;
                }
                depth--;
            } else if (depth < (int)(sizeof stack / sizeof stack[0])) {
                snprintf(stack[depth], sizeof stack[depth], "%s", tag);
                depth++;
            }
        }
        p = end + 1;
    }
    if (depth > 0) {
        sdk_diag(doc->rep, SDK_ERROR, "DIALOG_RML_TAG", doc->path, NULL, NULL,
                 "unclosed tag <%s>", stack[depth - 1]);
    }
}

static bool file_relative_exists(const char *base, const char *ref, char *out, size_t cap)
{
    if (ref[0] == '/') { snprintf(out, cap, "%s", ref); return sdk_file_exists(ref); }
    char dir[2048];
    sdk_dirname(base, dir, sizeof dir);
    sdk_join(dir, ref, out, cap);
    return sdk_file_exists(out);
}

static void check_stylesheet_refs(DialogDoc *doc)
{
    const char *p = doc->text;
    while ((p = strstr(p, "<link")) != NULL) {
        const char *end = strchr(p, '>');
        if (!end) break;
        char tag[1024];
        size_t n = (size_t)(end - p);
        if (n >= sizeof tag) n = sizeof tag - 1;
        memcpy(tag, p, n); tag[n] = '\0';
        const char *href = strstr(tag, "href=\"");
        if (href) {
            href += 6;
            const char *close = strchr(href, '"');
            if (close) {
                char ref[1024], full[2048];
                size_t rn = (size_t)(close - href);
                if (rn >= sizeof ref) rn = sizeof ref - 1;
                memcpy(ref, href, rn); ref[rn] = '\0';
                if (strstr(tag, "text/rcss") && !file_relative_exists(doc->path, ref, full, sizeof full))
                    sdk_diag(doc->rep, SDK_ERROR, "DIALOG_RCSS_MISSING", full, NULL, NULL,
                             "linked RCSS file not found: %s", ref);
            }
        }
        p = end + 1;
    }
}

static void check_font_urls(DialogDoc *doc, const char *css)
{
    const char *p = css;
    while ((p = strstr(p, "url(")) != NULL) {
        p += 4;
        while (*p && isspace((unsigned char)*p)) p++;
        char quote = 0;
        if (*p == '"' || *p == '\'') quote = *p++;
        const char *start = p;
        while (*p && *p != ')' && (!quote || *p != quote)) p++;
        char ref[1024], full[2048];
        size_t n = (size_t)(p - start);
        if (n >= sizeof ref) n = sizeof ref - 1;
        memcpy(ref, start, n); ref[n] = '\0';
        if (strstr(css, "@font-face") && ref[0] && !file_relative_exists(doc->path, ref, full, sizeof full))
            sdk_diag(doc->rep, SDK_ERROR, "DIALOG_FONT_MISSING", full, NULL, NULL,
                     "font file not found: %s", ref);
        if (*p) p++;
    }
}

int sdk_cmd_dialog(const SdkArgs *a)
{
    const char *sub = sdk_arg_positional(a, 0);
    if (!sub || strcmp(sub, "validate")) {
        SdkReport rep; sdk_report_init(&rep);
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Использование: r2d-sdk dialog validate <file.rml>");
        sdk_report_free(&rep);
        return rc;
    }
    const char *path = sdk_arg_positional(a, 1);
    if (!path || !path[0]) {
        SdkReport rep; sdk_report_init(&rep);
        const int rc = sdk_fail(&rep, "SDK_USAGE", "Укажите .rml файл: r2d-sdk dialog validate ui/dialog/custom.rml");
        sdk_report_free(&rep);
        return rc;
    }
    SdkReport rep; sdk_report_init(&rep);
    int roles = 0;
    int choice_count = 0;
    if (!sdk_file_exists(path)) {
        sdk_diag(&rep, SDK_ERROR, "DIALOG_RML_MISSING", path, NULL, NULL, "RML file not found");
    } else {
        DialogDoc doc = { read_text(path, &rep), path, &rep };
        if (doc.text) {
            const char *first = doc.text;
            while (*first && isspace((unsigned char)*first)) first++;
            if (strncmp(first, "<rml", 4))
                sdk_diag(&rep, SDK_ERROR, "DIALOG_RML_ROOT", path, NULL, NULL, "document must start with <rml>");
            const char *roles_req[] = { "root", "text", "choices" };
            for (size_t i = 0; i < sizeof roles_req / sizeof roles_req[0]; ++i) {
                int n = role_count(doc.text, roles_req[i]);
                roles += n;
                if (n == 0)
                    sdk_diag(&rep, SDK_ERROR, "DIALOG_ROLE_MISSING", path, NULL, NULL,
                             "missing data-dialog-role=\"%s\"", roles_req[i]);
                else if (n > 1)
                    sdk_diag(&rep, SDK_ERROR, "DIALOG_ROLE_DUPLICATE", path, NULL, NULL,
                             "data-dialog-role=\"%s\" occurs %d times (must be unique)", roles_req[i], n);
            }
            choice_count = role_count(doc.text, "choice");
            check_balance(&doc);
            check_stylesheet_refs(&doc);
            // Inline <style> blocks are validated for @font-face URLs too.
            const char *style = strstr(doc.text, "<style");
            while (style) {
                const char *open = strchr(style, '>');
                const char *close = strstr(style, "</style>");
                if (!open || !close || close < open) break;
                char *css = malloc((size_t)(close - open) + 1);
                if (css) {
                    size_t n = (size_t)(close - open - 1);
                    memcpy(css, open + 1, n); css[n] = '\0';
                    check_font_urls(&doc, css);
                    free(css);
                }
                style = strstr(close + 8, "<style");
            }
            free(doc.text);
        }
    }

    R2dSb out; r2d_sb_init(&out);
    r2d_sb_printf(&out, "{\"ok\":%s,", rep.errors ? "false" : "true");
    sdk_put_kv_str(&out, "file", path);
    r2d_sb_printf(&out, ",\"roles\":%d,\"choices\":%d,", roles, choice_count);
    sdk_report_put_counts(&rep, &out);
    r2d_sb_putc(&out, ',');
    sdk_report_put(&rep, &out);
    r2d_sb_putc(&out, '}');
    puts(out.data);
    fflush(stdout);

    const int rc = rep.errors ? 1 : 0;
    r2d_sb_free(&out);
    sdk_report_free(&rep);
    return rc;
}
