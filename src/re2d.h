#pragma once
#include <quickjs.h>

// Регистрирует нативные примитивы Re2D (engine.re2d.*): вид от первого лица,
// проекцию точек и мировых треугольников. Игровой API ставит re2d.js.
int r2d_re2d_install(JSContext *ctx, JSValue engine);
