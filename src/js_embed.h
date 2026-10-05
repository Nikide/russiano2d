// ===========================================================================
// Таблица JS-модулей движка (высокоуровневое API $).
//
// Модули лежат в src/highlevel/*.js и попадают в бинарник как текст: игра
// импортирует их по именам r2d/<файл>.js, а загрузчик движка отдаёт их из
// памяти, не трогая диск. Благодаря этому $ доступен и в релизной сборке, где
// скриптов на диске нет вовсе.
//
// Файл-определение (r2d_js_data.h) генерирует tools/r2d_embed_js.c.
// ===========================================================================
#pragma once

typedef struct R2dJsModule {
    const char *name;     // имя для import, напр. "r2d/core.js"
    const char *source;   // исходный текст модуля (NUL-terminated)
} R2dJsModule;

extern const R2dJsModule r2d_js_modules[];
extern const int         r2d_js_module_count;

// Ищет модуль по имени. NULL, если такого встроенного модуля нет.
const R2dJsModule *r2d_js_module_find(const char *name);
