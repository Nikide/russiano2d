#pragma once
#include <quickjs.h>
#include <stdbool.h>

// Регистрирует нативные примитивы; публичный игровой API ставит rotsprite.js.
int r2d_rotsprite_install(JSContext *ctx, JSValue engine);

// Borrow synthesised RGBA only during a native compositor call; no JS pixel copy.
const unsigned char *r2d_rotsprite_pixels(JSContext *ctx, JSValueConst handle, int *size, bool synthesize);
