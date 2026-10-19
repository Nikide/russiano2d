// ===========================================================================
// r2d_embed_assets — встраивает произвольные файлы в C-заголовок.
//
// Зачем: сплэш SDK должен работать даже без каталога assets (собранный SDK,
// урезанная поставка). Как и шрифт иконок (tools/r2d_embed_icons.c), ассеты
// кладутся в бинарник обычным байтовым массивом.
//
// Использование:
//   r2d_embed_assets <output.h> <virtual/path> <file> [<virtual/path> <file> ...]
//
// В заголовке:
//   static const unsigned char r2d_embedded_asset_N[] = {...};
//   static const R2dEmbeddedAsset r2d_embedded_assets[] = {{path, bytes, size}, ...};
//   static const int r2d_embedded_asset_count;
// Заголовок включается ровно в один .cpp (src/gui.cpp) — static-массивы
// с внутренним связыванием не размножаются по объектным файлам.
// ===========================================================================
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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

int main(int argc, char **argv)
{
    if (argc < 4 || ((argc - 2) % 2) != 0) {
        fprintf(stderr, "usage: %s <output.h> <virtual/path> <file> [...]\n", argv[0]);
        return 2;
    }

    const char *output = argv[1];
    FILE *out = fopen(output, "wb");
    if (!out) {
        fprintf(stderr, "r2d_embed_assets: cannot write %s\n", output);
        return 1;
    }

    const int count = (argc - 2) / 2;
    fprintf(out, "// Сгенерировано tools/r2d_embed_assets.c — не редактировать вручную.\n");
    fprintf(out, "#pragma once\n");
    fprintf(out, "#include <stddef.h>\n\n");
    fprintf(out, "typedef struct R2dEmbeddedAsset {\n");
    fprintf(out, "    const char *path;\n");
    fprintf(out, "    const unsigned char *data;\n");
    fprintf(out, "    size_t size;\n");
    fprintf(out, "} R2dEmbeddedAsset;\n\n");

    for (int i = 0; i < count; ++i) {
        const char *virtual_path = argv[2 + i * 2];
        const char *file = argv[3 + i * 2];
        size_t size = 0;
        unsigned char *data = read_file(file, &size);
        if (!data) {
            fprintf(stderr, "r2d_embed_assets: cannot read %s\n", file);
            fclose(out);
            return 1;
        }
        fprintf(out, "// %s (%zu bytes), source: %s\n", virtual_path, size, file);
        fprintf(out, "static const unsigned char r2d_embedded_asset_%d[] = {\n", i);
        for (size_t k = 0; k < size; ++k) {
            if (k % 16 == 0) fprintf(out, "    ");
            fprintf(out, "0x%02x%s", data[k], (k + 1 == size) ? "" : ",");
            if ((k + 1) % 16 == 0 || k + 1 == size) fprintf(out, "\n");
        }
        fprintf(out, "};\n\n");
        free(data);
    }

    fprintf(out, "static const R2dEmbeddedAsset r2d_embedded_assets[] = {\n");
    for (int i = 0; i < count; ++i) {
        const char *virtual_path = argv[2 + i * 2];
        fprintf(out, "    { \"%s\", r2d_embedded_asset_%d, sizeof r2d_embedded_asset_%d },\n",
                virtual_path, i, i);
    }
    fprintf(out, "};\n");
    fprintf(out, "static const int r2d_embedded_asset_count = %d;\n", count);
    fclose(out);
    return 0;
}
