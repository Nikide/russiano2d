// ===========================================================================
// Иконки Material Design, встроенные в исполняемый файл.
//
// Шрифт и таблица имён (2235 иконок) лежат прямо в бинарнике — внешних файлов
// не нужно. Иконки занимают область Private Use Area (U+E000..U+F8FF),
// поэтому подставляются в обычный текст и рисуются как глифы запасного шрифта.
//
// Из JS: engine.ui.icon("home") → строка с нужным символом.
// Из C:  r2d_icon_code("home") → кодпоинт, r2d_icon_utf8(...) → строка.
// ===========================================================================
#pragma once

#include "r2d.h"

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Кодпоинт иконки по имени или 0, если такого имени нет.
uint32_t r2d_icon_code(const char *name);

bool r2d_icon_exists(const char *name);

// Имя иконки по индексу. Таблица отсортирована по алфавиту, поэтому обход
// даёт предсказуемый список — им пользуется engine.ui.iconNames().
const char *r2d_icon_name(int index);

int r2d_icon_total(void);

// Кодирует кодпоинт в UTF-8. Возвращает число записанных байт (без NUL).
int r2d_icon_utf8(uint32_t code, char *out, size_t out_size);

// --- Встроенный шрифт -------------------------------------------------------
// Указатель действителен всё время работы программы.
// out_size может быть NULL.
const unsigned char *r2d_icon_font_data(unsigned int *out_size);

#ifdef __cplusplus
}
#endif
