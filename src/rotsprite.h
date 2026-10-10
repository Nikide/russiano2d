#pragma once
#include <quickjs.h>
#include <stdbool.h>
#include <stdint.h>

// Регистрирует нативные примитивы; публичный игровой API ставит rotsprite.js.
int r2d_rotsprite_install(JSContext *ctx, JSValue engine);

// Borrow synthesised RGBA only during a native compositor call; no JS pixel copy.
const unsigned char *r2d_rotsprite_pixels(JSContext *ctx, JSValueConst handle, int *size, bool synthesize);

// Native World view pose; retains expressions/model state and defers synthesis.
bool r2d_rotsprite_world_pose(JSContext *,JSValueConst,double,double);
// Borrow native per-pixel depth as fraction of the sprite's world height.
const float *r2d_rotsprite_sample_depth(JSContext *,JSValueConst);
int r2d_rotsprite_revision(JSContext *,JSValueConst);
uint64_t r2d_rotsprite_instance(JSContext *,JSValueConst);
bool r2d_rotsprite_dirty(JSContext *,JSValueConst);
