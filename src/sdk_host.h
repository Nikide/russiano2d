// ===========================================================================
// Мост инструментов SDK: engine.sdk.* (виден только модулю `$.sdk`).
//
// SDK — приложение R2D, а тяжёлые операции (импорт, bake, валидация, сборка)
// живут в нативном CLI `r2d-sdk` (sdk/native). Игре порождать процессы не
// нужно, поэтому мост ВЫКЛЮЧЕН по умолчанию и включается только манифестом
// проекта: "toolHost": true в project.json (src/project.h).
//
// Что мост умеет и чего нет:
//   * запускает ровно два бинарника — `r2d-sdk` рядом с движком и сам движок
//     (перезапуск игры/сборка); произвольной командной строки нет;
//   * аргументы — массив строк, без shell (SDL_Process);
//   * процесс идёт в фоне: вывод читает отдельный поток, кадр не блокируется;
//     состояние смотрится через poll().
// ===========================================================================
#pragma once

#include <stdbool.h>

#include <quickjs.h>

#ifdef __cplusplus
extern "C" {
#endif

// Включает мост (вызывает main.c после чтения project.json).
void r2d_sdk_host_enable(bool enabled);
bool r2d_sdk_host_enabled(void);

// Завершает все запущенные процессы и освобождает потоки.
void r2d_sdk_host_shutdown(void);

// Ставит engine.sdk в объект engine (script.c, рядом с http/render).
void r2d_sdk_host_register_js(JSContext *ctx, JSValue engine);

#ifdef __cplusplus
}
#endif
