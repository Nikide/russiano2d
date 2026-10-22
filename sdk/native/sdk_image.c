// ===========================================================================
// Изображения для инструментов SDK: размер, загрузка RGBA8, запись PNG.
// Только stb_image / stb_image_write (одиночные заголовки, без зависимостей).
// ===========================================================================
#include "sdk.h"

#include <stdlib.h>
#include <string.h>

#define STB_IMAGE_IMPLEMENTATION
#define STBI_NO_STDIO
#define STBI_NO_HDR
#define STBI_NO_LINEAR
#define STBI_ONLY_PNG
#define STBI_ONLY_JPEG
#define STBI_ONLY_BMP
#include "stb_image.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#define STBI_WRITE_NO_STDIO
#include "stb_image_write.h"

bool sdk_image_info(const char *path, int *w, int *h)
{
    size_t size = 0;
    char *data = sdk_read_file(path, &size);
    if (!data) return false;
    int comp = 0, iw = 0, ih = 0;
    const bool ok = stbi_info_from_memory((const unsigned char *)data, (int)size, &iw, &ih, &comp) != 0;
    free(data);
    if (ok) {
        if (w) *w = iw;
        if (h) *h = ih;
    }
    return ok;
}

uint8_t *sdk_image_load_rgba(const char *path, int *w, int *h)
{
    size_t size = 0;
    char *data = sdk_read_file(path, &size);
    if (!data) return NULL;
    int comp = 0;
    uint8_t *pixels = stbi_load_from_memory((const unsigned char *)data, (int)size, w, h, &comp, 4);
    free(data);
    return pixels;
}

uint8_t *sdk_image_load_rgba_mem(const uint8_t *data, size_t size, int *w, int *h)
{
    int comp = 0;
    return stbi_load_from_memory(data, (int)size, w, h, &comp, 4);
}

void sdk_image_free(uint8_t *pixels)
{
    stbi_image_free(pixels);
}

bool sdk_image_write_png(const char *path, const uint8_t *rgba, int w, int h)
{
    int len = 0;
    unsigned char *png = stbi_write_png_to_mem(rgba, w * 4, w, h, 4, &len);
    if (!png) return false;
    const bool ok = sdk_write_file(path, png, (size_t)len);
    STBIW_FREE(png);
    return ok;
}

// ---------------------------------------------------------------------------
// r2d image-stats <png> — быстрая «проверка кадра» для агентов: пустой/чёрный ли
// скриншот. JSON: размер, средняя яркость 0..255, число различных цветов (по
// сетке выборки), доля пикселей, отличных от фона (цвет верхнего левого угла).
// ---------------------------------------------------------------------------
int sdk_cmd_image_stats(const SdkArgs *a)
{
    const char *path = sdk_arg_positional(a, 0);
    if (!path || !path[0]) {
        printf("{\"ok\":false,\"code\":\"SDK_USAGE\",\"message\":\"r2d image-stats <файл.png>\"}\n");
        return 2;
    }
    int w = 0, h = 0;
    uint8_t *px = sdk_image_load_rgba(path, &w, &h);
    if (!px || w <= 0 || h <= 0) {
        printf("{\"ok\":false,\"code\":\"SDK_IMAGE_LOAD\",\"message\":\"не удалось прочитать изображение\"}\n");
        free(px);
        return 2;
    }
    const uint32_t bg = ((uint32_t)px[0] << 16) | ((uint32_t)px[1] << 8) | px[2];
    double luma = 0;
    size_t n = 0, diff = 0, distinct = 0;
    enum { SLOTS = 4096 };
    uint32_t *seen = (uint32_t *)calloc(SLOTS, sizeof *seen);
    bool *used = (bool *)calloc(SLOTS, sizeof *used);
    const int step = (w * h > 400000) ? 3 : 1;
    // --grid WxH: ASCII-карта кадра (доля не-фона в каждой ячейке) — текстовым моделям, которые не видят картинку
    int gw = 0, gh = 0;
    const char *gspec = sdk_arg_value(a, "--grid");
    if (gspec && sscanf(gspec, "%dx%d", &gw, &gh) == 2 && gw >= 4 && gw <= 120 && gh >= 2 && gh <= 60) {
        /* ok */
    } else { gw = gh = 0; }
    size_t *gcount = gw ? (size_t *)calloc((size_t)gw * gh * 2, sizeof(size_t)) : NULL;
    for (int y = 0; y < h; y += step) {
        for (int x = 0; x < w; x += step) {
            const uint8_t *p = px + ((size_t)y * w + x) * 4;
            const uint32_t c = ((uint32_t)p[0] << 16) | ((uint32_t)p[1] << 8) | p[2];
            luma += 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
            if (c != bg) ++diff;
            ++n;
            if (gcount) {
                const size_t cell = (size_t)(y * gh / h) * gw + (size_t)(x * gw / w);
                gcount[cell * 2 + 1]++;
                if (c != bg) gcount[cell * 2]++;
            }
            if (seen && used) {
                size_t s = (c * 2654435761u) % SLOTS;
                for (int probe = 0; probe < 32; ++probe, s = (s + 1) % SLOTS) {
                    if (!used[s]) { used[s] = true; seen[s] = c; ++distinct; break; }
                    if (seen[s] == c) break;
                }
            }
        }
    }
    printf("{\"ok\":true,\"width\":%d,\"height\":%d,\"meanLuma\":%.2f,\"distinctColors\":%zu,\"nonBackgroundFraction\":%.4f,"
           "\"background\":\"#%06x\",\"blank\":%s",
           w, h, n ? luma / (double)n : 0.0, distinct, n ? (double)diff / (double)n : 0.0, bg,
           (n && (double)diff / (double)n < 0.002) ? "true" : "false");
    if (gcount) {
        static const char ramp[] = ".:-=+*#%@";
        printf(",\"grid\":[");
        for (int gy = 0; gy < gh; ++gy) {
            printf("%s\"", gy ? "," : "");
            for (int gx = 0; gx < gw; ++gx) {
                const size_t cell = (size_t)gy * gw + gx;
                const double fr = gcount[cell * 2 + 1] ? (double)gcount[cell * 2] / (double)gcount[cell * 2 + 1] : 0.0;
                int idx = (int)(fr * 9.0 + 0.5);
                if (idx > 8) idx = 8;
                putchar(ramp[idx]);
            }
            putchar('"');
        }
        printf("]");
    }
    printf("}\n");
    free(gcount);
    free(seen); free(used); free(px);
    return 0;
}
