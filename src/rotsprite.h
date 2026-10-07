#pragma once
#include <quickjs.h>

// Регистрирует нативные примитивы; публичный игровой API ставит rotsprite.js.
int r2d_rotsprite_install(JSContext *ctx, JSValue engine);
