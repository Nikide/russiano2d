// ===========================================================================
// Текст поверх сцены.
//
// ВНИМАНИЕ: очередь из этого файла — РУДИМЕНТ. Игровой текст рисуется спрайтами
// глифов движка (src/font.c: engine.drawText/measureText, docs/API.md §16), и в
// r2d_text_queue() больше никто не пишет. Живыми остаются измерение строки
// (r2d_text_measure_ui) и очистка очереди в кадре.
//
// Очередь чистится раз в кадр после отрисовки; элементы живут до конца кадра.
// ===========================================================================
#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum R2DTextAlign {
    R2D_TEXT_LEFT   = 0,
    R2D_TEXT_CENTER = 1,
    R2D_TEXT_RIGHT  = 2,
} R2DTextAlign;

typedef struct R2DTextItem {
    char    *text;     // владеемая копия
    float    x, y;     // точка привязки, логические пиксели окна
    float    size;     // высота шрифта в пикселях
    uint32_t color;    // упакованный RGBA (младший байт — R)
    int      align;
} R2DTextItem;

// Кладёт строку в очередь кадра. Текст копируется — вызывающий может
// освободить свой буфер сразу.
void r2d_text_queue(const char *text, float x, float y, float size,
                    uint32_t color, int align);

// Размер строки в пикселях для данного кегля. Возвращает false, если точный
// размер пока неизвестен (шрифт ImGui ещё не инициализирован) — тогда в w/h
// кладётся оценка, которой достаточно для центрирования.
bool r2d_text_measure(const char *text, float size, float *w, float *h);

// --- Для отладочного слоя ----------------------------------------------------
int                r2d_text_count(void);
const R2DTextItem *r2d_text_items(void);
void               r2d_text_clear(void);

// Точное измерение силами ImGui. Реализовано в src/debug_ui.cpp: в C нет
// доступа к шрифту. Возвращает false, если ImGui ещё не начинал кадр.
bool r2d_text_measure_ui(const char *text, float size, float *w, float *h);

#ifdef __cplusplus
}
#endif
