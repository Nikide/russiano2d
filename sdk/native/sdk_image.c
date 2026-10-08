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
