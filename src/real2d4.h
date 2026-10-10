// ===========================================================================
// Real2D v4 — публичный вход нативного модуля (стадия A, head-only).
//
// Контейнер `.r2d4` (ZIP store-only) читается, проверяется и рендерится целиком
// в C; игре это доступно как `engine.real2d.*` и как модуль `$` — см.
// docs/highlevel/real2d.md и demos/real2d/REAL2D_V4_SPEC.md.
// ===========================================================================
#pragma once

#include <quickjs.h>

#ifdef __cplusplus
extern "C" {
#endif

// Регистрирует группу `engine.real2d.*`. Возвращает 0 или -1 (место занято).
int r2d_real2d_install(JSContext *ctx, JSValue engine);

#ifdef __cplusplus
}
#endif
