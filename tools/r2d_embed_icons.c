// ===========================================================================
// r2d_embed_icons — встраивает шрифт иконок и таблицу имён в C-заголовок.
//
// Зачем отдельный инструмент, а не скрипт на CMake: шрифт весит ~350 КБ,
// и прогонять его через строковые операции CMake медленно и хрупко. Здесь же
// обычное чтение файла и печать массива — быстро и предсказуемо.
//
// Использование:
//   r2d_embed_icons <MaterialIcons.ttf> <MaterialIcons.codepoints> <output.h>
//
// Формат .codepoints — по строке на иконку: "<имя> <hex-кодпоинт>".
// На выходе получается заголовок, который включает только src/icons.c.
// ===========================================================================

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Icon {
    char     name[64];
    uint32_t code;
} Icon;

static int icon_cmp(const void *a, const void *b)
{
    return strcmp(((const Icon *)a)->name, ((const Icon *)b)->name);
}

static unsigned char *read_file(const char *path, size_t *out_size)
{
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    const long size = ftell(f);
    if (size < 0) { fclose(f); return NULL; }
    rewind(f);

    unsigned char *buf = (unsigned char *)malloc((size_t)size + 1);
    if (!buf) { fclose(f); return NULL; }

    const size_t read = fread(buf, 1, (size_t)size, f);
    fclose(f);
    buf[read] = '\0';
    *out_size = read;
    return buf;
}

int main(int argc, char **argv)
{
    if (argc != 4) {
        fprintf(stderr,
                "Использование: %s <шрифт.ttf> <codepoints> <выход.h>\n", argv[0]);
        return 2;
    }

    size_t font_size = 0;
    unsigned char *font = read_file(argv[1], &font_size);
    if (!font || font_size == 0) {
        fprintf(stderr, "r2d_embed_icons: не удалось прочитать шрифт %s\n", argv[1]);
        return 1;
    }

    size_t cp_size = 0;
    char *cp_text = (char *)read_file(argv[2], &cp_size);
    if (!cp_text || cp_size == 0) {
        fprintf(stderr, "r2d_embed_icons: не удалось прочитать %s\n", argv[2]);
        free(font);
        return 1;
    }

    // --- Разбор таблицы имён ---
    // Идём по буферу вручную, а не через strtok_r/strtok_s: у них разный
    // интерфейс на POSIX и MSVC, а разбор тут тривиальный.
    Icon *icons = (Icon *)calloc(4096, sizeof(Icon));
    int count = 0;

    char *p = cp_text;
    while (*p && count < 4096) {
        char *line = p;
        while (*p && *p != '\n' && *p != '\r') p++;
        if (*p) { *p++ = '\0'; while (*p == '\n' || *p == '\r') p++; }

        char name[64];
        unsigned int code = 0;
        if (sscanf(line, "%63s %x", name, &code) != 2) continue;

        snprintf(icons[count].name, sizeof icons[count].name, "%s", name);
        icons[count].code = (uint32_t)code;
        count++;
    }

    if (count == 0) {
        fprintf(stderr, "r2d_embed_icons: не разобрано ни одной иконки\n");
        free(icons); free(font); free(cp_text);
        return 1;
    }

    // Двоичный поиск в рантайме требует упорядоченной таблицы.
    qsort(icons, (size_t)count, sizeof(Icon), icon_cmp);

    // --- Печать заголовка ---
    FILE *out = fopen(argv[3], "wb");
    if (!out) {
        fprintf(stderr, "r2d_embed_icons: не удалось открыть %s на запись\n", argv[3]);
        free(icons); free(font); free(cp_text);
        return 1;
    }

    fprintf(out,
            "// ===========================================================================\n"
            "// ВНИМАНИЕ: файл сгенерирован tools/r2d_embed_icons.c. Не редактировать.\n"
            "// Шрифт Material Design Icons (Apache-2.0) и таблица имён, встроенные\n"
            "// прямо в исполняемый файл. См. cmake/Icons.cmake.\n"
            "// ===========================================================================\n"
            "\n#pragma once\n\n#include <stdint.h>\n\n");
    fprintf(out, "typedef struct R2dIconEntry {\n    const char *name;\n    uint32_t    code;\n} R2dIconEntry;\n\n");

    fprintf(out, "static const unsigned char r2d_icon_font[%zu] = {\n", font_size);
    for (size_t i = 0; i < font_size; i++) {
        if (i % 16 == 0) fputs("    ", out);
        fprintf(out, "0x%02x,", font[i]);
        if (i % 16 == 15 || i + 1 == font_size) fputc('\n', out);
    }
    fputs("};\n\n", out);
    fprintf(out, "static const unsigned int r2d_icon_font_size = %zu;\n\n", font_size);

    fprintf(out, "static const R2dIconEntry r2d_icon_table[%d] = {\n", count);
    for (int i = 0; i < count; i++) {
        fprintf(out, "    { \"%s\", 0x%04x },\n", icons[i].name, icons[i].code);
    }
    fputs("};\n\n", out);
    fprintf(out, "static const int r2d_icon_count = %d;\n", count);

    fclose(out);

    fprintf(stderr, "r2d_embed_icons: %s — шрифт %zu байт, иконок %d\n",
            argv[3], font_size, count);

    free(icons);
    free(font);
    free(cp_text);
    return 0;
}
