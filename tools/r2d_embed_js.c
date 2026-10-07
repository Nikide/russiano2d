// ===========================================================================
// Генератор таблицы встроенных JS-модулей движка.
//
//   r2d_embed_js <каталог с .js> <файл-заголовок>
//
// Читает все *.js из каталога, превращает их в C-строковые литералы и пишет
// заголовок с таблицей {имя → исходник}. Имена модулей получаются такими:
//   core.js → r2d/core.js,   index.js → r2d/index.js
//
// Отдельный инструмент, а не configure_file(): экранировать произвольный
// JavaScript средствами CMake — верный способ получить неверный код. Здесь
// экранирование делается в C, где оно очевидно.
// ===========================================================================
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <dirent.h>
#endif

typedef struct Entry {
    char *name;
    char *path;
} Entry;

// Экранирует текст как C-строковый литерал, разбивая его на куски, чтобы
// компилятор не споткнулся о предел длины строки.
static void emit_literal(FILE *out, const char *text)
{
    fputs("\"", out);
    for (const char *p = text; *p; ++p) {
        const unsigned char c = (unsigned char)*p;
        switch (c) {
        case '"':  fputs("\\\"", out); break;
        case '\\': fputs("\\\\", out); break;
        case '\n': fputs("\\n\"\n    \"", out); break;
        case '\r': fputs("\\r", out); break;
        case '\t': fputs("\\t", out); break;
        default:
            if (c < 0x20 || c == '?') {
                // Трёхзначный восьмеричный код и склейка — чтобы за цифрой
                // escape-последовательности не «прилипла» следующая цифра.
                fprintf(out, "\\%03o\"\"", c);
            } else {
                fputc((int)c, out);
            }
            break;
        }
    }
    fputs("\"", out);
}

static int compare_entries(const void *a, const void *b)
{
    return strcmp(((const Entry *)a)->name, ((const Entry *)b)->name);
}

static char *read_file(const char *path, size_t *out_size)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    const long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (size < 0) { fclose(f); return NULL; }

    char *buf = (char *)malloc((size_t)size + 1);
    if (!buf) { fclose(f); return NULL; }
    const size_t got = fread(buf, 1, (size_t)size, f);
    fclose(f);
    buf[got] = '\0';
    if (out_size) *out_size = got;
    return buf;
}

int main(int argc, char **argv)
{
    if (argc < 3) {
        fprintf(stderr, "использование: r2d_embed_js <каталог> <заголовок>\n");
        return 2;
    }

    const char *dir = argv[1];
    const char *out_path = argv[2];

    // Модулей может стать больше: раньше здесь стоял жёсткий предел 64, и
    // 65-й файл (acoustics.js) МОЛЧА не попадал в бинарник — движок падал на
    // импорте, а «$» оставался неопределённым. Список растёт по мере чтения.
    size_t cap = 128;
    Entry *entries = (Entry *)calloc(cap, sizeof(Entry));
    if (!entries) {
        fprintf(stderr, "не хватило памяти под список модулей\n");
        return 1;
    }
    int count = 0;

#ifndef _WIN32
    DIR *d = opendir(dir);
    if (!d) {
        fprintf(stderr, "не удалось открыть каталог %s\n", dir);
        return 1;
    }
    struct dirent *de;
    while ((de = readdir(d)) != NULL) {
        const size_t len = strlen(de->d_name);
        if (len < 4 || strcmp(de->d_name + len - 3, ".js") != 0) continue;
        if ((size_t)count + 1 >= cap) {
            cap *= 2;
            Entry *grown = (Entry *)realloc(entries, cap * sizeof(Entry));
            if (!grown) {
                fprintf(stderr, "не хватило памяти под список модулей\n");
                closedir(d);
                return 1;
            }
            entries = grown;
        }

        entries[count].name = strdup(de->d_name);
        char full[4096];
        snprintf(full, sizeof full, "%s/%s", dir, de->d_name);
        entries[count].path = strdup(full);
        count++;
    }
    closedir(d);
#else
    char pattern[4096];
    snprintf(pattern, sizeof pattern, "%s\\*.js", dir);
    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA(pattern, &fd);
    if (h != INVALID_HANDLE_VALUE) {
        do {
            const size_t len = strlen(fd.cFileName);
            if (len < 4) continue;
            if ((size_t)count + 1 >= cap) {
                cap *= 2;
                Entry *grown = (Entry *)realloc(entries, cap * sizeof(Entry));
                if (!grown) {
                    fprintf(stderr, "не хватило памяти под список модулей\n");
                    FindClose(h);
                    return 1;
                }
                entries = grown;
            }
            entries[count].name = _strdup(fd.cFileName);
            char full[4096];
            snprintf(full, sizeof full, "%s\\%s", dir, fd.cFileName);
            entries[count].path = _strdup(full);
            count++;
        } while (FindNextFileA(h, &fd));
        FindClose(h);
    }
#endif

    if (count == 0) {
        fprintf(stderr, "в каталоге %s нет ни одного .js\n", dir);
        return 1;
    }

    qsort(entries, (size_t)count, sizeof(Entry), compare_entries);

    FILE *out = fopen(out_path, "wb");
    if (!out) {
        fprintf(stderr, "не удалось записать %s\n", out_path);
        return 1;
    }

    fprintf(out, "// Сгенерировано tools/r2d_embed_js.c. Не править руками.\n");
    fprintf(out, "// Исходники: src/highlevel/*.js\n");
    fprintf(out, "#include \"js_embed.h\"\n\n");

    for (int i = 0; i < count; ++i) {
        size_t size = 0;
        char *src = read_file(entries[i].path, &size);
        if (!src) {
            fprintf(stderr, "не удалось прочитать %s\n", entries[i].path);
            fclose(out);
            return 1;
        }
        fprintf(out, "// %s (%zu байт)\n", entries[i].name, size);
        fprintf(out, "static const char r2d__js_%d[] =\n    ", i);
        emit_literal(out, src);
        fprintf(out, ";\n\n");
        free(src);
    }

    fprintf(out, "const R2dJsModule r2d_js_modules[] = {\n");
    for (int i = 0; i < count; ++i) {
        fprintf(out, "    { \"r2d/%s\", r2d__js_%d },\n", entries[i].name, i);
    }
    fprintf(out, "};\n\n");
    fprintf(out, "const int r2d_js_module_count = %d;\n\n", count);

    fprintf(out,
        "const R2dJsModule *r2d_js_module_find(const char *name)\n"
        "{\n"
        "    if (!name) return NULL;\n"
        "    for (int i = 0; i < r2d_js_module_count; ++i) {\n"
        "        if (strcmp(r2d_js_modules[i].name, name) == 0) return &r2d_js_modules[i];\n"
        "    }\n"
        "    return NULL;\n"
        "}\n");

    fclose(out);
    printf("r2d_embed_js: %s — модулей %d\n", out_path, count);
    return 0;
}
