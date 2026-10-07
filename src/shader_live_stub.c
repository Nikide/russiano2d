// ===========================================================================
// Заглушки компиляции пользовательских шейдеров.
//
// Компилируются вместо shader_live.cpp, когда движок собран с
// -DR2D_ENABLE_LIVE_SHADERS=OFF (минимальная сборка: glslang и spirv-cross не
// линкуются). Интерфейс тот же, поэтому render.c и скриптовый слой не
// обрастают #ifdef: $.gfx.defineShader() честно возвращает «не поддержано»,
// а .shader() продолжает работать со встроенными эффектами.
//
// Заглушка появилась из-за веб-сборки: там живые шейдеры выключены (WebGPU
// принимает WGSL, а компилятор собирает SPIR-V), и без неё линковка падала на
// неопределённых r2d_live_shader_*.
// ===========================================================================

#include "shader_live.h"

#include <stdio.h>
#include <string.h>

const char *r2d_live_shader_preamble(void)
{
    return "// Сборка без компилятора шейдеров (R2D_ENABLE_LIVE_SHADERS=OFF):\n"
           "// $.gfx.defineShader() недоступен, работают только встроенные эффекты.\n";
}

bool r2d_live_shader_compile(const char *fragment_body, R2DLiveShader *out)
{
    (void)fragment_body;
    if (!out) return false;

    memset(out, 0, sizeof *out);
    out->ok = false;
    // Текст ошибки виден игре через engine.userShaderError(): молчаливый отказ
    // здесь хуже, чем понятное сообщение.
    snprintf(out->error, sizeof out->error,
             "движок собран без компилятора шейдеров (R2D_ENABLE_LIVE_SHADERS=OFF)");
    return false;
}

void r2d_live_shader_free(R2DLiveShader *shader)
{
    if (!shader) return;
    memset(shader, 0, sizeof *shader);
}

bool r2d_live_shader_supported(void)
{
    return false;
}
