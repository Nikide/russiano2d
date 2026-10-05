// ===========================================================================
// Таблица встроенного байткода игровых модулей (релизная сборка).
//
// Объявление отделено от сгенерированного файла, чтобы рантайм и упаковщик
// пользовались одним и тем же описанием структуры.
// ===========================================================================
#pragma once

typedef struct R2dEmbeddedModule {
    const char          *name;   // путь относительно каталога игры, напр. "lib/scene.js"
    const unsigned char *data;   // сериализованный байткод QuickJS
    unsigned int         size;
} R2dEmbeddedModule;

extern const R2dEmbeddedModule r2d_embedded_modules[];
extern const int                r2d_embedded_module_count;
