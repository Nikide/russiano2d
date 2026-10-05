// ===========================================================================
// Минимальный JSON и растущий строковый буфер. См. src/json.h.
// ===========================================================================
#include "json.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

static char *r2d__dup(const char *s, size_t len)
{
    char *out = (char *)malloc(len + 1);
    if (!out) return NULL;
    if (len) memcpy(out, s, len);
    out[len] = '\0';
    return out;
}

static void r2d__set_error(char *err, size_t err_size, const char *fmt, ...)
{
    if (!err || err_size == 0) return;
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(err, err_size, fmt, ap);
    va_end(ap);
}

// ---------------------------------------------------------------------------
// Разбор
// ---------------------------------------------------------------------------

typedef struct Parser {
    const char *p;
    const char *end;
    char       *err;
    size_t      err_size;
    int         depth;
} Parser;

#define R2D_JSON_MAX_DEPTH 64

static void r2d__skip_ws(Parser *ps)
{
    while (ps->p < ps->end) {
        const char c = *ps->p;
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') ps->p++;
        else break;
    }
}

static R2dJson *r2d__parse_value(Parser *ps);

static R2dJson *r2d__node(R2dJsonType type)
{
    R2dJson *v = (R2dJson *)calloc(1, sizeof(R2dJson));
    if (v) v->type = type;
    return v;
}

static bool r2d__expect(Parser *ps, char c)
{
    r2d__skip_ws(ps);
    if (ps->p < ps->end && *ps->p == c) { ps->p++; return true; }
    r2d__set_error(ps->err, ps->err_size, "ожидался символ '%c' (позиция %d)",
                    c, (int)(ps->p - (ps->end - (ps->end - ps->p))));
    return false;
}

// Читает до четырёх шестнадцатеричных цифр. Чужой символ НЕ потребляется:
// иначе разбор \uXXXX съедал бы символы за концом строки (например,
// закрывающую кавычку), и запись результата уходила за границу буфера —
// именно так движок портил кучу на командах агента.
static int r2d__read_hex4(Parser *ps, unsigned *out)
{
    unsigned value = 0;
    int digits = 0;
    while (digits < 4 && ps->p < ps->end) {
        const char h = *ps->p;
        int v = -1;
        if (h >= '0' && h <= '9') v = h - '0';
        else if (h >= 'a' && h <= 'f') v = h - 'a' + 10;
        else if (h >= 'A' && h <= 'F') v = h - 'A' + 10;
        if (v < 0) break;
        ps->p++;
        value = (value << 4) | (unsigned)v;
        digits++;
    }
    *out = value;
    return digits;
}

// Строка в кавычках. Поддерживает \" \\ \/ \b \f \n \r \t \uXXXX.
static char *r2d__parse_string_raw(Parser *ps)
{
    if (!r2d__expect(ps, '"')) return NULL;

    // Граница строки: до закрывающей кавычки, а для незакрытой — до конца
    // ввода. Экранированный символ пропускаем, иначе \" обрывал бы строку.
    const char *start = ps->p;
    const char *stop = ps->end;
    for (const char *q = ps->p; q < ps->end; ++q) {
        if (*q == '\\') { if (q + 1 < ps->end) q++; continue; }
        if (*q == '"') { stop = q; break; }
    }

    // Ёмкость буфера. Строгий факт: результат не длиннее исходного текста —
    // каждый байт результата получается минимум из одного входного символа
    // (\uXXXX: 6 символов → максимум 4 байта). Оценивать «на глаз» нельзя:
    // недооценка здесь переполняет кучу, и это уже ловилось фаззером
    // (tests/json_test.c) — движок падал на разборе команд агента.
    const size_t cap = (size_t)(stop - start);

    char *out = (char *)malloc(cap + 1);
    if (!out) { r2d__set_error(ps->err, ps->err_size, "нет памяти"); return NULL; }

    size_t n = 0;
    while (ps->p < ps->end && *ps->p != '"') {
        char c = *ps->p++;
        if (c != '\\') {
            out[n++] = c;
            continue;
        }
        if (ps->p >= ps->end) break;
        const char e = *ps->p++;
        switch (e) {
        case 'n':  out[n++] = '\n'; break;
        case 't':  out[n++] = '\t'; break;
        case 'r':  out[n++] = '\r'; break;
        case 'b':  out[n++] = '\b'; break;
        case 'f':  out[n++] = '\f'; break;
        case '"':  out[n++] = '"';  break;
        case '\\': out[n++] = '\\'; break;
        case '/':  out[n++] = '/';  break;
        case 'u': {
            // \uXXXX → UTF-8. Суррогатные пары (D800..DFFF) собираем в один
            // кодпоинт, иначе агент не сможет передать эмодзи или редкий
            // символ в строке.
            unsigned cp = 0;
            r2d__read_hex4(ps, &cp);
            if (cp >= 0xD800 && cp <= 0xDBFF && ps->p + 1 < ps->end &&
                ps->p[0] == '\\' && ps->p[1] == 'u') {
                const char *save = ps->p;
                ps->p += 2;
                unsigned lo = 0;
                const int low_digits = r2d__read_hex4(ps, &lo);
                if (low_digits == 4 && lo >= 0xDC00 && lo <= 0xDFFF) {
                    cp = 0x10000u + ((cp - 0xD800u) << 10) + (lo - 0xDC00u);
                } else {
                    ps->p = save;   // это была не суррогатная пара — откатываемся
                }
            }
            // Страховка: запись никогда не выходит за буфер. Инвариант длины
            // выше гарантирует, что это не сработает, но цена проверки —
            // одна ветка, а цена ошибки — испорченная куча.
            if (n + 4 > cap) {
                free(out);
                r2d__set_error(ps->err, ps->err_size, "слишком длинная строка");
                return NULL;
            }
            if (cp < 0x80) {
                out[n++] = (char)cp;
            } else if (cp < 0x800) {
                out[n++] = (char)(0xC0 | (cp >> 6));
                out[n++] = (char)(0x80 | (cp & 0x3F));
            } else if (cp < 0x10000) {
                out[n++] = (char)(0xE0 | (cp >> 12));
                out[n++] = (char)(0x80 | ((cp >> 6) & 0x3F));
                out[n++] = (char)(0x80 | (cp & 0x3F));
            } else {
                out[n++] = (char)(0xF0 | (cp >> 18));
                out[n++] = (char)(0x80 | ((cp >> 12) & 0x3F));
                out[n++] = (char)(0x80 | ((cp >> 6) & 0x3F));
                out[n++] = (char)(0x80 | (cp & 0x3F));
            }
            break;
        }
        default:
            out[n++] = e;
            break;
        }
    }
    if (ps->p >= ps->end || *ps->p != '"') {
        free(out);
        r2d__set_error(ps->err, ps->err_size, "незакрытая строка");
        return NULL;
    }
    ps->p++;   // закрывающая кавычка
    out[n] = '\0';
    return out;
}

static R2dJson *r2d__parse_string(Parser *ps)
{
    char *s = r2d__parse_string_raw(ps);
    if (!s) return NULL;
    R2dJson *v = r2d__node(R2D_JSON_STR);
    if (!v) { free(s); return NULL; }
    v->string = s;
    return v;
}

static R2dJson *r2d__parse_number(Parser *ps)
{
    char buf[64];
    size_t n = 0;
    while (ps->p < ps->end && n + 1 < sizeof buf) {
        const char c = *ps->p;
        if ((c >= '0' && c <= '9') || c == '-' || c == '+' || c == '.' ||
            c == 'e' || c == 'E') {
            buf[n++] = c;
            ps->p++;
        } else break;
    }
    buf[n] = '\0';
    if (n == 0) {
        r2d__set_error(ps->err, ps->err_size, "ожидалось число");
        return NULL;
    }
    R2dJson *v = r2d__node(R2D_JSON_NUM);
    if (!v) return NULL;
    v->number = strtod(buf, NULL);
    return v;
}

static bool r2d__match(Parser *ps, const char *word)
{
    const size_t len = strlen(word);
    if ((size_t)(ps->end - ps->p) < len) return false;
    if (memcmp(ps->p, word, len) != 0) return false;
    ps->p += len;
    return true;
}

static bool r2d__push(R2dJson *container, char *key, R2dJson *value)
{
    const int n = container->count;
    char **keys = (char **)realloc(container->keys, sizeof(char *) * (size_t)(n + 1));
    if (!keys) return false;
    container->keys = keys;
    R2dJson **items = (R2dJson **)realloc(container->items,
                                            sizeof(R2dJson *) * (size_t)(n + 1));
    if (!items) return false;
    container->items = items;
    container->keys[n] = key;
    container->items[n] = value;
    container->count = n + 1;
    return true;
}

static R2dJson *r2d__parse_array(Parser *ps)
{
    ps->p++;   // '['
    R2dJson *arr = r2d__node(R2D_JSON_ARR);
    if (!arr) return NULL;

    r2d__skip_ws(ps);
    if (ps->p < ps->end && *ps->p == ']') { ps->p++; return arr; }

    for (;;) {
        R2dJson *item = r2d__parse_value(ps);
        if (!item) { r2d_json_free(arr); return NULL; }
        if (!r2d__push(arr, NULL, item)) { r2d_json_free(item); r2d_json_free(arr); return NULL; }

        r2d__skip_ws(ps);
        if (ps->p < ps->end && *ps->p == ',') { ps->p++; continue; }
        if (ps->p < ps->end && *ps->p == ']') { ps->p++; return arr; }
        r2d__set_error(ps->err, ps->err_size, "ожидалась ',' или ']' в массиве");
        r2d_json_free(arr);
        return NULL;
    }
}

static R2dJson *r2d__parse_object(Parser *ps)
{
    ps->p++;   // '{'
    R2dJson *obj = r2d__node(R2D_JSON_OBJ);
    if (!obj) return NULL;

    r2d__skip_ws(ps);
    if (ps->p < ps->end && *ps->p == '}') { ps->p++; return obj; }

    for (;;) {
        r2d__skip_ws(ps);
        char *key = r2d__parse_string_raw(ps);
        if (!key) { r2d_json_free(obj); return NULL; }

        r2d__skip_ws(ps);
        if (!r2d__expect(ps, ':')) { free(key); r2d_json_free(obj); return NULL; }

        R2dJson *value = r2d__parse_value(ps);
        if (!value) { free(key); r2d_json_free(obj); return NULL; }
        if (!r2d__push(obj, key, value)) {
            free(key);
            r2d_json_free(value);
            r2d_json_free(obj);
            return NULL;
        }

        r2d__skip_ws(ps);
        if (ps->p < ps->end && *ps->p == ',') { ps->p++; continue; }
        if (ps->p < ps->end && *ps->p == '}') { ps->p++; return obj; }
        r2d__set_error(ps->err, ps->err_size, "ожидалась ',' или '}' в объекте");
        r2d_json_free(obj);
        return NULL;
    }
}

static R2dJson *r2d__parse_value(Parser *ps)
{
    r2d__skip_ws(ps);
    if (ps->p >= ps->end) {
        r2d__set_error(ps->err, ps->err_size, "неожиданный конец строки");
        return NULL;
    }
    if (ps->depth >= R2D_JSON_MAX_DEPTH) {
        r2d__set_error(ps->err, ps->err_size, "слишком глубокая вложенность JSON");
        return NULL;
    }

    ps->depth++;
    R2dJson *out = NULL;

    switch (*ps->p) {
    case '{': out = r2d__parse_object(ps); break;
    case '[': out = r2d__parse_array(ps);  break;
    case '"': out = r2d__parse_string(ps); break;
    case 't':
        if (r2d__match(ps, "true")) {
            out = r2d__node(R2D_JSON_BOOL);
            if (out) out->boolean = true;
        }
        break;
    case 'f':
        if (r2d__match(ps, "false")) {
            out = r2d__node(R2D_JSON_BOOL);
            if (out) out->boolean = false;
        }
        break;
    case 'n':
        if (r2d__match(ps, "null")) out = r2d__node(R2D_JSON_NULL);
        break;
    default:
        out = r2d__parse_number(ps);
        break;
    }

    ps->depth--;
    if (!out && ps->err && ps->err[0] == '\0') {
        r2d__set_error(ps->err, ps->err_size, "не удалось разобрать значение");
    }
    return out;
}

R2dJson *r2d_json_parse(const char *text, char *err, size_t err_size)
{
    if (err && err_size) err[0] = '\0';
    if (!text) {
        r2d__set_error(err, err_size, "пустой ввод");
        return NULL;
    }

    Parser ps;
    ps.p = text;
    ps.end = text + strlen(text);
    ps.err = err;
    ps.err_size = err_size;
    ps.depth = 0;

    R2dJson *root = r2d__parse_value(&ps);
    if (!root) return NULL;

    r2d__skip_ws(&ps);
    if (ps.p != ps.end) {
        r2d__set_error(err, err_size, "лишние данные после JSON");
        r2d_json_free(root);
        return NULL;
    }
    return root;
}

void r2d_json_free(R2dJson *v)
{
    if (!v) return;
    for (int i = 0; i < v->count; ++i) {
        if (v->keys) free(v->keys[i]);
        if (v->items) r2d_json_free(v->items[i]);
    }
    free(v->keys);
    free(v->items);
    free(v->string);
    free(v);
}

// ---------------------------------------------------------------------------
// Доступ
// ---------------------------------------------------------------------------

const R2dJson *r2d_json_get(const R2dJson *obj, const char *key)
{
    if (!obj || obj->type != R2D_JSON_OBJ || !key) return NULL;
    for (int i = 0; i < obj->count; ++i) {
        if (obj->keys[i] && strcmp(obj->keys[i], key) == 0) return obj->items[i];
    }
    return NULL;
}

const R2dJson *r2d_json_at(const R2dJson *arr, int index)
{
    if (!arr || arr->type != R2D_JSON_ARR) return NULL;
    if (index < 0 || index >= arr->count) return NULL;
    return arr->items[index];
}

int r2d_json_size(const R2dJson *v)
{
    if (!v) return 0;
    if (v->type == R2D_JSON_ARR || v->type == R2D_JSON_OBJ) return v->count;
    return 0;
}

const char *r2d_json_str(const R2dJson *v, const char *def)
{
    if (!v || v->type != R2D_JSON_STR) return def;
    return v->string ? v->string : def;
}

double r2d_json_num(const R2dJson *v, double def)
{
    if (!v) return def;
    if (v->type == R2D_JSON_NUM) return v->number;
    if (v->type == R2D_JSON_BOOL) return v->boolean ? 1.0 : 0.0;
    return def;
}

int r2d_json_int(const R2dJson *v, int def)
{
    if (!v) return def;
    if (v->type == R2D_JSON_NUM) return (int)v->number;
    if (v->type == R2D_JSON_BOOL) return v->boolean ? 1 : 0;
    return def;
}

bool r2d_json_bool(const R2dJson *v, bool def)
{
    if (!v) return def;
    if (v->type == R2D_JSON_BOOL) return v->boolean;
    if (v->type == R2D_JSON_NUM) return v->number != 0.0;
    return def;
}

// ---------------------------------------------------------------------------
// Строковый буфер
// ---------------------------------------------------------------------------

void r2d_sb_init(R2dSb *sb)
{
    sb->data = NULL;
    sb->len = 0;
    sb->cap = 0;
}

void r2d_sb_free(R2dSb *sb)
{
    free(sb->data);
    sb->data = NULL;
    sb->len = sb->cap = 0;
}

void r2d_sb_clear(R2dSb *sb)
{
    sb->len = 0;
    if (sb->data) sb->data[0] = '\0';
}

static bool r2d__sb_reserve(R2dSb *sb, size_t extra)
{
    if (sb->len + extra + 1 <= sb->cap) return true;
    size_t cap = sb->cap ? sb->cap : 128;
    while (cap < sb->len + extra + 1) cap *= 2;
    char *data = (char *)realloc(sb->data, cap);
    if (!data) return false;
    sb->data = data;
    sb->cap = cap;
    return true;
}

void r2d_sb_putc(R2dSb *sb, char c)
{
    if (!r2d__sb_reserve(sb, 1)) return;
    sb->data[sb->len++] = c;
    sb->data[sb->len] = '\0';
}

void r2d_sb_puts(R2dSb *sb, const char *s)
{
    if (!s) return;
    const size_t n = strlen(s);
    if (!r2d__sb_reserve(sb, n)) return;
    memcpy(sb->data + sb->len, s, n);
    sb->len += n;
    sb->data[sb->len] = '\0';
}

void r2d_sb_printf(R2dSb *sb, const char *fmt, ...)
{
    char stack_buf[512];
    va_list ap;
    va_start(ap, fmt);
    const int need = vsnprintf(stack_buf, sizeof stack_buf, fmt, ap);
    va_end(ap);
    if (need < 0) return;

    if ((size_t)need < sizeof stack_buf) {
        r2d_sb_puts(sb, stack_buf);
        return;
    }
    char *heap = (char *)malloc((size_t)need + 1);
    if (!heap) return;
    va_start(ap, fmt);
    vsnprintf(heap, (size_t)need + 1, fmt, ap);
    va_end(ap);
    r2d_sb_puts(sb, heap);
    free(heap);
}

void r2d_sb_put_json_string(R2dSb *sb, const char *s)
{
    r2d_sb_putc(sb, '"');
    if (s) {
        for (const unsigned char *p = (const unsigned char *)s; *p; ++p) {
            switch (*p) {
            case '"':  r2d_sb_puts(sb, "\\\""); break;
            case '\\': r2d_sb_puts(sb, "\\\\"); break;
            case '\n': r2d_sb_puts(sb, "\\n");  break;
            case '\r': r2d_sb_puts(sb, "\\r");  break;
            case '\t': r2d_sb_puts(sb, "\\t");  break;
            case '\b': r2d_sb_puts(sb, "\\b");  break;
            case '\f': r2d_sb_puts(sb, "\\f");  break;
            default:
                if (*p < 0x20) {
                    r2d_sb_printf(sb, "\\u%04x", (unsigned)*p);
                } else {
                    r2d_sb_putc(sb, (char)*p);
                }
                break;
            }
        }
    }
    r2d_sb_putc(sb, '"');
}

void r2d_sb_put_json_number(R2dSb *sb, double v)
{
    // NaN и бесконечности в JSON не существуют: отдаём 0, чтобы клиент не
    // подавился на невалидной строке (например, fps при первом кадре).
    if (v != v || v > 1e308 || v < -1e308) {
        r2d_sb_puts(sb, "0");
        return;
    }
    if (v == (double)(long long)v && v > -1e15 && v < 1e15) {
        r2d_sb_printf(sb, "%lld", (long long)v);
    } else {
        r2d_sb_printf(sb, "%.10g", v);
    }
}

char *r2d_sb_take(R2dSb *sb)
{
    char *out = sb->data;
    if (!out) out = r2d__dup("", 0);
    sb->data = NULL;
    sb->len = sb->cap = 0;
    return out;
}
