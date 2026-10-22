// Встроенная модель эмбеддингов: файл GGUF подключается в бинарник ассемблерной
// директивой .incbin (R2D_AI_MODEL_PATH задаёт xmake.lua, только если есть
// models/r2d-embed.gguf). Массив байт в C-заголовке для 70 МБ непригоден.
#if defined(R2D_HAVE_AI)
#include <stddef.h>

#if defined(__APPLE__)
__asm__(".section __DATA,__const\n"
        ".globl _r2d_ai_model_begin\n"
        ".balign 16\n"
        "_r2d_ai_model_begin:\n"
        ".incbin \"" R2D_AI_MODEL_PATH "\"\n"
        ".globl _r2d_ai_model_end\n"
        "_r2d_ai_model_end:\n"
        ".byte 0\n"
        ".text\n");
#else
__asm__(".section .rodata\n"
        ".globl r2d_ai_model_begin\n"
        ".balign 16\n"
        "r2d_ai_model_begin:\n"
        ".incbin \"" R2D_AI_MODEL_PATH "\"\n"
        ".globl r2d_ai_model_end\n"
        "r2d_ai_model_end:\n"
        ".byte 0\n"
        ".text\n");
#endif

extern const unsigned char r2d_ai_model_begin[];
extern const unsigned char r2d_ai_model_end[];

const unsigned char *r2d_ai_model_data(size_t *size)
{
    *size = (size_t)(r2d_ai_model_end - r2d_ai_model_begin);
    return r2d_ai_model_begin;
}
#endif
