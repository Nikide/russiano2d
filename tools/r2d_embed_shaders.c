// ===========================================================================
// r2d_embed_shaders — генерация встроенных шейдеров и правка MSL-биндингов.
//
// Зачем: раньше это делали cmake/EmbedShader.cmake и
// cmake/WorldMetalBindings.cmake через `cmake -P` прямо из xmake-сборки.
// То есть каноническая сборка требовала cmake только ради строковых
// операций. Здесь те же операции сделаны нативным host-инструментом:
// xmake больше не зависит от cmake.
//
// Использование:
//   r2d_embed_shaders --dir <каталог> --entries a,b,c --mode glsl|wgsl \
//                     --output <r2d_shaders.h>
//   r2d_embed_shaders --remap-metal <файл.msl>
//
// В заголовке — те же R2DShaderBlob, что и раньше: SPIR-V байтами, MSL и
// WGSL C-строками. Порядок и форматирование повторяют прежний CMake-скрипт,
// поэтому результат побайтово совпадает (кроме строки о генераторе).
// ===========================================================================
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Buffer {
    char *data;
    size_t len;
    size_t cap;
} Buffer;

static void die(const char *fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    fputs("r2d_embed_shaders: ", stderr);
    vfprintf(stderr, fmt, args);
    fputc('\n', stderr);
    va_end(args);
    exit(1);
}

static void buffer_reserve(Buffer *buf, size_t extra)
{
    if (buf->len + extra + 1 <= buf->cap) return;
    size_t cap = buf->cap ? buf->cap : 4096;
    while (cap < buf->len + extra + 1) cap *= 2;
    char *grown = (char *)realloc(buf->data, cap);
    if (!grown) die("не хватило памяти");
    buf->data = grown;
    buf->cap = cap;
}

static void buffer_append(Buffer *buf, const char *text, size_t size)
{
    buffer_reserve(buf, size);
    memcpy(buf->data + buf->len, text, size);
    buf->len += size;
    buf->data[buf->len] = '\0';
}

static void buffer_puts(Buffer *buf, const char *text)
{
    buffer_append(buf, text, strlen(text));
}

static void buffer_printf(Buffer *buf, const char *fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    va_list copy;
    va_copy(copy, args);
    int need = vsnprintf(NULL, 0, fmt, copy);
    va_end(copy);
    if (need < 0) {
        va_end(args);
        die("ошибка форматирования");
    }
    buffer_reserve(buf, (size_t)need);
    vsnprintf(buf->data + buf->len, (size_t)need + 1, fmt, args);
    va_end(args);
    buf->len += (size_t)need;
}

static unsigned char *read_file(const char *path, size_t *out_size)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    long size = ftell(f);
    if (size < 0) { fclose(f); return NULL; }
    rewind(f);
    unsigned char *data = (unsigned char *)malloc((size_t)size ? (size_t)size : 1);
    if (!data) { fclose(f); return NULL; }
    if (size > 0 && fread(data, 1, (size_t)size, f) != (size_t)size) {
        free(data);
        fclose(f);
        return NULL;
    }
    fclose(f);
    *out_size = (size_t)size;
    return data;
}

static int file_exists(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) return 0;
    fclose(f);
    return 1;
}

static char *path_join(const char *dir, const char *name, const char *ext)
{
    size_t need = strlen(dir) + strlen(name) + strlen(ext) + 2;
    char *path = (char *)malloc(need);
    if (!path) die("не хватило памяти");
    snprintf(path, need, "%s/%s%s", dir, name, ext);
    return path;
}

// C-строка из текста: "\" -> "\\", "\"" -> "\\\"", перевод строки -> "\n"\n" —
// ровно так же, как это делал string(REPLACE) в EmbedShader.cmake.
static void append_c_string(Buffer *out, const unsigned char *text, size_t size)
{
    for (size_t i = 0; i < size; ++i) {
        unsigned char ch = text[i];
        if (ch == '\\') {
            buffer_puts(out, "\\\\");
        } else if (ch == '"') {
            buffer_puts(out, "\\\"");
        } else if (ch == '\n') {
            buffer_puts(out, "\\n\"\n\"");
        } else {
            buffer_append(out, (const char *)&ch, 1);
        }
    }
}

static void append_symbol(char *sym)
{
    for (char *p = sym; *p; ++p) {
        if (*p == '.') *p = '_';
    }
}

static void emit_entry(Buffer *header, Buffer *blobs, const char *dir,
                       const char *entry, int wgsl_only)
{
    char sym[256];
    snprintf(sym, sizeof sym, "%s", entry);
    append_symbol(sym);

    char *spv_path = path_join(dir, entry, ".spv");
    char *msl_path = path_join(dir, entry, ".msl");
    char *wgsl_path = path_join(dir, entry, ".wgsl");

    int has_wgsl = file_exists(wgsl_path);
    int has_spv = file_exists(spv_path);
    int has_msl = file_exists(msl_path);

    if (wgsl_only && !has_wgsl) die("не найден %s", wgsl_path);

    const char *wgsl_ref = "0";
    const char *wgsl_bytes = "0u";
    char wgsl_ref_buf[320];
    char wgsl_bytes_buf[320];

    if (has_wgsl) {
        size_t size = 0;
        unsigned char *text = read_file(wgsl_path, &size);
        if (!text) die("не читается %s", wgsl_path);
        buffer_printf(header, "static const char %s_wgsl[] =\n\"", sym);
        append_c_string(header, text, size);
        buffer_puts(header, "\";\n\n");
        snprintf(wgsl_ref_buf, sizeof wgsl_ref_buf, "%s_wgsl", sym);
        snprintf(wgsl_bytes_buf, sizeof wgsl_bytes_buf,
                 "(unsigned int)sizeof(%s_wgsl) - 1u", sym);
        wgsl_ref = wgsl_ref_buf;
        wgsl_bytes = wgsl_bytes_buf;
        free(text);
    }

    if (wgsl_only) {
        buffer_printf(blobs,
            "static const R2DShaderBlob r2d_shader_%s = { 0, 0u, 0, 0u, %s, %s };\n",
            sym, wgsl_ref, wgsl_bytes);
    } else {
        if (!has_spv) die("не найден %s", spv_path);
        if (!has_msl) die("не найден %s", msl_path);

        size_t spv_size = 0;
        unsigned char *spv = read_file(spv_path, &spv_size);
        if (!spv) die("не читается %s", spv_path);
        buffer_printf(header, "static const unsigned char %s_spirv[] = {\n\t", sym);
        for (size_t i = 0; i < spv_size; ++i) buffer_printf(header, "0x%02x,", spv[i]);
        buffer_puts(header, "\n};\n\n");
        free(spv);

        size_t msl_size = 0;
        unsigned char *msl = read_file(msl_path, &msl_size);
        if (!msl) die("не читается %s", msl_path);
        buffer_printf(header, "static const char %s_msl[] =\n\"", sym);
        append_c_string(header, msl, msl_size);
        buffer_puts(header, "\";\n\n");
        free(msl);

        buffer_printf(blobs,
            "static const R2DShaderBlob r2d_shader_%s = { %s_spirv, (unsigned int)sizeof(%s_spirv), %s_msl, (unsigned int)sizeof(%s_msl) - 1u, %s, %s };\n",
            sym, sym, sym, sym, sym, wgsl_ref, wgsl_bytes);
    }

    free(spv_path);
    free(msl_path);
    free(wgsl_path);
}

// ---------------------------------------------------------------------------
// --remap-metal: SPIR-V слоты биндингов переезжают в отдельное пространство
// имён Metal. Контракт SDL MSL: сначала uniform-буферы, затем storage.
// ---------------------------------------------------------------------------
static char *replace_all(const char *src, const char *from, const char *to)
{
    size_t from_len = strlen(from);
    size_t to_len = strlen(to);
    size_t count = 0;
    const char *p = src;
    while ((p = strstr(p, from)) != NULL) {
        ++count;
        p += from_len;
    }
    size_t size = strlen(src);
    size_t out_size = size + count * (to_len > from_len ? to_len - from_len : 0);
    char *out = (char *)malloc(out_size + 1);
    if (!out) die("не хватило памяти");
    char *dst = out;
    p = src;
    const char *next = NULL;
    while ((next = strstr(p, from)) != NULL) {
        size_t chunk = (size_t)(next - p);
        memcpy(dst, p, chunk);
        dst += chunk;
        memcpy(dst, to, to_len);
        dst += to_len;
        p = next + from_len;
    }
    strcpy(dst, p);
    return out;
}

static int remap_metal(const char *path)
{
    size_t size = 0;
    unsigned char *raw = read_file(path, &size);
    if (!raw) die("не читается %s", path);
    char *src = (char *)malloc(size + 1);
    if (!src) die("не хватило памяти");
    memcpy(src, raw, size);
    src[size] = '\0';
    free(raw);

    char *updated = src;
    if (strstr(src, "batch [[buffer(1)]]")) {
        char *step = replace_all(updated, "batch [[buffer(1)]]", "batch [[buffer(0)]]");
        if (updated != src) free(updated);
        updated = step;
        step = replace_all(updated, "shadow [[buffer(3)]]", "shadow [[buffer(1)]]");
        if (updated != src) free(updated);
        updated = step;
        if (!strstr(updated, "batch [[buffer(0)]]") ||
            !strstr(updated, "shadow [[buffer(1)]]")) {
            die("контракт Metal storage-биндингов world batch изменился");
        }
    } else if (!strstr(src, "shadow [[buffer(3)]]")) {
        // Уже переписанный файл принимаем идемпотентно.
        if (!strstr(src, "shadow [[buffer(1)]]"))
            die("контракт Metal storage-биндингов world изменился");
    } else {
        char *step = replace_all(src, "shadow [[buffer(3)]]", "shadow [[buffer(1)]]");
        if (updated != src) free(updated);
        updated = step;
    }

    FILE *out = fopen(path, "wb");
    if (!out) die("не записывается %s", path);
    size_t out_size = strlen(updated);
    if (fwrite(updated, 1, out_size, out) != out_size) {
        fclose(out);
        die("не записывается %s", path);
    }
    fclose(out);
    if (updated != src) free(updated);
    free(src);
    return 0;
}

static void usage(const char *argv0)
{
    fprintf(stderr,
        "usage: %s --dir <dir> --entries a,b --mode glsl|wgsl --output <file>\n"
        "       %s --remap-metal <file.msl>\n", argv0, argv0);
}

int main(int argc, char **argv)
{
    const char *dir = NULL;
    const char *entries = NULL;
    const char *mode = "glsl";
    const char *output = NULL;
    const char *remap = NULL;

    for (int i = 1; i < argc; ++i) {
        const char *arg = argv[i];
        const char *value = (i + 1 < argc) ? argv[i + 1] : NULL;
        if (strcmp(arg, "--dir") == 0 && value) { dir = value; ++i; }
        else if (strcmp(arg, "--entries") == 0 && value) { entries = value; ++i; }
        else if (strcmp(arg, "--mode") == 0 && value) { mode = value; ++i; }
        else if (strcmp(arg, "--output") == 0 && value) { output = value; ++i; }
        else if (strcmp(arg, "--remap-metal") == 0 && value) { remap = value; ++i; }
        else if (strcmp(arg, "--help") == 0 || strcmp(arg, "-h") == 0) {
            usage(argv[0]);
            return 0;
        } else {
            fprintf(stderr, "r2d_embed_shaders: неизвестный аргумент %s\n", arg);
            usage(argv[0]);
            return 2;
        }
    }

    if (remap) return remap_metal(remap);
    if (!dir || !entries || !output) {
        usage(argv[0]);
        return 2;
    }

    int wgsl_only;
    if (strcmp(mode, "glsl") == 0) wgsl_only = 0;
    else if (strcmp(mode, "wgsl") == 0) wgsl_only = 1;
    else die("неизвестный режим %s", mode);

    Buffer header = {0};
    Buffer blobs = {0};
    buffer_puts(&header,
        "// ===========================================================================\n"
        "// ВНИМАНИЕ: файл сгенерирован автоматически (tools/r2d_embed_shaders.c).\n"
        "// Любые правки будут перезаписаны при следующей сборке.\n"
        "// ===========================================================================\n"
        "\n"
        "#pragma once\n"
        "\n"
        "#include <stdint.h>\n"
        "\n"
        "typedef struct R2DShaderBlob {\n"
        "    const unsigned char *spirv;\n"
        "    unsigned int         spirv_size;\n"
        "    const char          *msl;\n"
        "    unsigned int         msl_size;\n"
        "    const char          *wgsl;\n"
        "    unsigned int         wgsl_size;\n"
        "} R2DShaderBlob;\n"
        "\n");

    char *list = (char *)malloc(strlen(entries) + 1);
    if (!list) die("не хватило памяти");
    strcpy(list, entries);
    int index = 0;
    char *cursor = list;
    while (cursor && *cursor) {
        char *comma = strchr(cursor, ',');
        if (comma) *comma = '\0';
        if (*cursor) {
            emit_entry(&header, &blobs, dir, cursor, wgsl_only);
            ++index;
        }
        cursor = comma ? comma + 1 : NULL;
    }
    free(list);

    if (blobs.len) buffer_append(&header, blobs.data, blobs.len);
    free(blobs.data);

    FILE *out = fopen(output, "wb");
    if (!out) die("не записывается %s", output);
    if (header.len && fwrite(header.data, 1, header.len, out) != header.len) {
        fclose(out);
        die("не записывается %s", output);
    }
    fclose(out);
    free(header.data);

    fprintf(stdout, "r2d_embed_shaders: записан %s (шейдеров: %d)\n", output, index);
    return 0;
}
