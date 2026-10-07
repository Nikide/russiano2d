# ---------------------------------------------------------------------------
# Генерирует r2d_shaders.h со встроенными вариантами шейдеров.
# Запускается на этапе сборки: cmake -P cmake/EmbedShader.cmake
#
# Ожидаемые переменные:
#   SHADER_DIR      — каталог со скомпилированными *.spv/*.msl или с *.wgsl
#   SHADER_ENTRIES  — список имён через запятую, напр. "sprite_vert,sprite_frag"
#   SHADER_MODE     — "glsl" (по умолчанию) или "wgsl"
#   OUTPUT          — путь к создаваемому заголовку
#
# В режиме "wgsl" (веб-сборка, WebGPU) в blob попадает только текст WGSL:
# SPIR-V и MSL там не собираются вовсе.
# ---------------------------------------------------------------------------

if(NOT DEFINED SHADER_DIR OR NOT DEFINED SHADER_ENTRIES OR NOT DEFINED OUTPUT)
    message(FATAL_ERROR "EmbedShader.cmake: не заданы SHADER_DIR/SHADER_ENTRIES/OUTPUT")
endif()

if(NOT DEFINED SHADER_MODE)
    set(SHADER_MODE "glsl")
endif()

get_filename_component(output_dir "${OUTPUT}" DIRECTORY)
file(MAKE_DIRECTORY "${output_dir}")

set(header "// ===========================================================================\n")
string(APPEND header "// ВНИМАНИЕ: файл сгенерирован автоматически (cmake/EmbedShader.cmake).\n")
string(APPEND header "// Любые правки будут перезаписаны при следующей сборке.\n")
string(APPEND header "// ===========================================================================\n\n")
string(APPEND header "#pragma once\n\n#include <stdint.h>\n\n")
string(APPEND header "typedef struct R2DShaderBlob {\n")
string(APPEND header "    const unsigned char *spirv;\n")
string(APPEND header "    unsigned int         spirv_size;\n")
string(APPEND header "    const char          *msl;\n")
string(APPEND header "    unsigned int         msl_size;\n")
string(APPEND header "    const char          *wgsl;\n")
string(APPEND header "    unsigned int         wgsl_size;\n")
string(APPEND header "} R2DShaderBlob;\n\n")

string(REPLACE "," ";" entries "${SHADER_ENTRIES}")
set(blob_defs "")
set(index 0)

foreach(entry IN LISTS entries)
    if(entry STREQUAL "")
        continue()
    endif()

    set(spv_path "${SHADER_DIR}/${entry}.spv")
    set(msl_path "${SHADER_DIR}/${entry}.msl")
    set(wgsl_path "${SHADER_DIR}/${entry}.wgsl")

    string(REPLACE "." "_" sym "${entry}")

    # --- WGSL: текст как C-строка (в веб-режиме это единственный вариант) ----
    if(EXISTS "${wgsl_path}")
        file(READ "${wgsl_path}" wgsl_text)
        string(REPLACE "\\" "\\\\" wgsl_esc "${wgsl_text}")
        string(REPLACE "\"" "\\\"" wgsl_esc "${wgsl_esc}")
        string(REPLACE "\n" "\\n\"\n\"" wgsl_esc "${wgsl_esc}")
        file(SIZE "${wgsl_path}" wgsl_size)
        string(APPEND header "static const char ${sym}_wgsl[] =\n\"${wgsl_esc}\";\n\n")
        set(wgsl_ref "${sym}_wgsl")
        set(wgsl_bytes "(unsigned int)sizeof(${sym}_wgsl) - 1u")
    elseif(SHADER_MODE STREQUAL "wgsl")
        message(FATAL_ERROR "Не найден ${wgsl_path}")
    else()
        set(wgsl_ref "0")
        set(wgsl_bytes "0u")
    endif()

    if(SHADER_MODE STREQUAL "wgsl")
        string(APPEND blob_defs "static const R2DShaderBlob r2d_shader_${sym} = { 0, 0u, 0, 0u, ${wgsl_ref}, ${wgsl_bytes} };\n")
        math(EXPR index "${index} + 1")
        continue()
    endif()

    if(NOT EXISTS "${spv_path}")
        message(FATAL_ERROR "Не найден ${spv_path}")
    endif()
    if(NOT EXISTS "${msl_path}")
        message(FATAL_ERROR "Не найден ${msl_path}")
    endif()

    # --- SPIR-V: сырые байты -------------------------------------------------
    file(READ "${spv_path}" spv_hex HEX)
    string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," spv_bytes "${spv_hex}")
    file(SIZE "${spv_path}" spv_size)

    string(APPEND header "static const unsigned char ${sym}_spirv[] = {\n\t${spv_bytes}\n};\n\n")

    # --- MSL: текст как C-строка --------------------------------------------
    file(READ "${msl_path}" msl_text)
    string(REPLACE "\\" "\\\\" msl_esc "${msl_text}")
    string(REPLACE "\"" "\\\"" msl_esc "${msl_esc}")
    string(REPLACE "\n" "\\n\"\n\"" msl_esc "${msl_esc}")
    file(SIZE "${msl_path}" msl_size)

    string(APPEND header "static const char ${sym}_msl[] =\n\"${msl_esc}\";\n\n")
    string(APPEND blob_defs "static const R2DShaderBlob r2d_shader_${sym} = { ${sym}_spirv, (unsigned int)sizeof(${sym}_spirv), ${sym}_msl, (unsigned int)sizeof(${sym}_msl) - 1u, ${wgsl_ref}, ${wgsl_bytes} };\n")
    math(EXPR index "${index} + 1")
endforeach()

string(APPEND header "${blob_defs}")
file(WRITE "${OUTPUT}" "${header}")

message(STATUS "EmbedShader: записан ${OUTPUT} (шейдеров: ${index})")
