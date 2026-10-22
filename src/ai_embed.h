// Встроенная модель эмбеддингов (multilingual-e5-small, дообучена на R2D; см.
// docs/EDITOR_AGENT.md). Модель вшита в бинарник (third_party/ai_model) и при
// первом обращении извлекается в кэш пользователя — llama.cpp читает GGUF из
// файла, не из памяти. Без R2D_HAVE_AI все функции возвращают «недоступно».
#ifndef R2D_AI_EMBED_H
#define R2D_AI_EMBED_H

#include <stdbool.h>
#include <stddef.h>

#define R2D_AI_DIM 384

// Вшита ли модель в эту сборку.
bool r2d_ai_available(void);

// Загрузить модель (идемпотентно). false + сообщение в err при сбое.
bool r2d_ai_open(char *err, size_t cap);

// Эмбеддинг текста (префикс «query: »/«passage: » добавляет вызывающий), L2-нормирован.
// out — R2D_AI_DIM float. Текст обрезается до 160 токенов.
bool r2d_ai_embed(const char *text, float *out);

// Освободить модель и контекст.
void r2d_ai_close(void);

// Короткая подпись модели для кэша векторов (размер+хеш содержимого).
unsigned long long r2d_ai_model_id(void);

#endif
