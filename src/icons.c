#include "icons.h"

// Сгенерирован на этапе сборки из шрифта Material Design Icons:
//   r2d_icon_font[]     — байты TTF
//   r2d_icon_table[]    — имена и кодпоинты, отсортированы по имени
//   r2d_icon_count
#include "r2d_icons_data.h"

uint32_t r2d_icon_code(const char *name)
{
    if (!name || !*name) return 0;

    // Двоичный поиск: таблица отсортирована генератором.
    int lo = 0;
    int hi = r2d_icon_count - 1;
    while (lo <= hi) {
        const int mid = lo + (hi - lo) / 2;
        const int cmp = strcmp(name, r2d_icon_table[mid].name);
        if (cmp == 0) return r2d_icon_table[mid].code;
        if (cmp < 0) hi = mid - 1;
        else         lo = mid + 1;
    }
    return 0;
}

bool r2d_icon_exists(const char *name)
{
    return r2d_icon_code(name) != 0;
}

const char *r2d_icon_name(int index)
{
    if (index < 0 || index >= r2d_icon_count) return "";
    return r2d_icon_table[index].name;
}

int r2d_icon_total(void)
{
    return r2d_icon_count;
}

int r2d_icon_utf8(uint32_t code, char *out, size_t out_size)
{
    if (!out || out_size == 0) return 0;

    // Полный UTF-8 вплоть до 4 байт: иконки лежат в U+E000..U+F8FF,
    // но функция не должна врать на любом корректном кодпоинте.
    if (code < 0x80) {
        if (out_size < 2) { out[0] = '\0'; return 0; }
        out[0] = (char)code;
        out[1] = '\0';
        return 1;
    }
    if (code < 0x800) {
        if (out_size < 3) { out[0] = '\0'; return 0; }
        out[0] = (char)(0xC0 | (code >> 6));
        out[1] = (char)(0x80 | (code & 0x3F));
        out[2] = '\0';
        return 2;
    }
    if (code < 0x10000) {
        if (out_size < 4) { out[0] = '\0'; return 0; }
        out[0] = (char)(0xE0 | (code >> 12));
        out[1] = (char)(0x80 | ((code >> 6) & 0x3F));
        out[2] = (char)(0x80 | (code & 0x3F));
        out[3] = '\0';
        return 3;
    }
    if (code <= 0x10FFFF) {
        if (out_size < 5) { out[0] = '\0'; return 0; }
        out[0] = (char)(0xF0 | (code >> 18));
        out[1] = (char)(0x80 | ((code >> 12) & 0x3F));
        out[2] = (char)(0x80 | ((code >> 6) & 0x3F));
        out[3] = (char)(0x80 | (code & 0x3F));
        out[4] = '\0';
        return 4;
    }

    out[0] = '\0';
    return 0;
}

const unsigned char *r2d_icon_font_data(unsigned int *out_size)
{
    if (out_size) *out_size = r2d_icon_font_size;
    return r2d_icon_font;
}
