// ===========================================================================
// Очередь текста поверх сцены. См. src/text.h.
// ===========================================================================
#include "text.h"

#include <stdlib.h>
#include <string.h>

#define R2D_TEXT_MAX 2048

static R2DTextItem items[R2D_TEXT_MAX];
static int         count = 0;

void r2d_text_queue(const char *text, float x, float y, float size,
                    uint32_t color, int align)
{
    if (!text || !*text) return;
    if (count >= R2D_TEXT_MAX) return;   // молча отбрасываем лишнее: кадр важнее

    const size_t len = strlen(text);
    char *copy = (char *)malloc(len + 1);
    if (!copy) return;
    memcpy(copy, text, len + 1);

    R2DTextItem *it = &items[count++];
    it->text  = copy;
    it->x     = x;
    it->y     = y;
    it->size  = size > 1.0f ? size : 12.0f;
    it->color = color;
    it->align = align;
}

int r2d_text_count(void)
{
    return count;
}

const R2DTextItem *r2d_text_items(void)
{
    return items;
}

void r2d_text_clear(void)
{
    for (int i = 0; i < count; ++i) {
        free(items[i].text);
        items[i].text = NULL;
    }
    count = 0;
}

bool r2d_text_measure(const char *text, float size, float *w, float *h)
{
    if (w) *w = 0.0f;
    if (h) *h = 0.0f;
    if (!text) return false;

    if (r2d_text_measure_ui(text, size, w, h)) return true;

    // Оценка до первого кадра ImGui: средняя ширина глифа ~0.55 кегля.
    // Для центрирования этого достаточно, а после первого кадра измерение
    // станет точным.
    const size_t len = strlen(text);
    if (w) *w = (float)len * size * 0.55f;
    if (h) *h = size;
    return false;
}
