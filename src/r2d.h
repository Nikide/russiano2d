// ===========================================================================
// russiano2d — общие определения движка.
// ===========================================================================
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R2D_VERSION_STRING "0.1.0"

// --- Ёмкости по умолчанию ---------------------------------------------------
#define R2D_MAX_TEXTURES     256      // сколько PNG можно загрузить
#define R2D_MAX_BODIES       8192     // сколько физических тел живёт одновременно
#define R2D_INITIAL_SPRITES  1024     // стартовая ёмкость таблицы спрайтов
#define R2D_INITIAL_COMMANDS 2048     // стартовая ёмкость батча на кадр

// --- Упакованный цвет -------------------------------------------------------
// Формат совпадает с тем, что ждёт JS-хелпер engine.rgba(): байты R,G,B,A
// идут от младшего к старшему (little-endian RGBA).
#define R2D_RGBA(r, g, b, a) \
    ((uint32_t)(uint8_t)(r) | ((uint32_t)(uint8_t)(g) << 8) | \
     ((uint32_t)(uint8_t)(b) << 16) | ((uint32_t)(uint8_t)(a) << 24))

#define R2D_WHITE R2D_RGBA(255, 255, 255, 255)

// --- Логирование ------------------------------------------------------------
// Обычно журнал идёт в stdout: GUI не должен смешиваться с диагностикой.
// В агентском режиме stdout занят протоколом (одна JSON-строка на запрос и
// одна на ответ), поэтому флаг r2d_log_stderr уводит журнал в stderr — клиент
// читает stdout как чистый JSON.
#define R2D_LOG(...)                                          \
    do {                                                      \
        FILE *r2d__out = r2d_log_stderr ? stderr : stdout;     \
        fprintf(r2d__out, "[russiano2d] " __VA_ARGS__);        \
        fputc('\n', r2d__out);                                \
        fflush(r2d__out);                                     \
    } while (0)

#define R2D_WARN(...)                                          \
    do {                                                       \
        fprintf(stderr, "[russiano2d][warn] " __VA_ARGS__);     \
        fputc('\n', stderr);                                    \
    } while (0)

#define R2D_ERROR(...)                                         \
    do {                                                       \
        fprintf(stderr, "[russiano2d][error] " __VA_ARGS__);    \
        fputc('\n', stderr);                                    \
    } while (0)

// Определяется в src/app.c. true — весь журнал уходит в stderr.
extern bool r2d_log_stderr;

#define R2D_UNUSED(x) ((void)(x))
