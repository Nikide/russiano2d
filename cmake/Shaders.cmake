# ---------------------------------------------------------------------------
# Компиляция GLSL-шейдеров russiano2d.
#
# Схема (повторяет подход RmlUi к SDL_GPU):
#
#   shaders/*.glsl ──glslangValidator──► *.spv ──spirv-cross──► *.msl
#                                            │                     │
#                                            └────────┬────────────┘
#                                                     ▼
#                                     src/generated/shaders.h
#
# Оба варианта встраиваются в бинарник, а на старте выбирается тот, который
# поддерживает текущий GPU-бэкенд (Metal → MSL, Vulkan → SPIR-V).
# Это снимает зависимость от SDL_shadercross и DXC во время исполнения.
#
# DXIL (Windows/D3D12) пока не генерируется: для него нужен DXC. См. README.
# ---------------------------------------------------------------------------

include(FetchContent)

# --- Инструменты ------------------------------------------------------------
# glslang: GLSL/HLSL → SPIR-V
set(ENABLE_OPT              OFF CACHE BOOL "" FORCE)  # не тянем SPIRV-Tools
set(ENABLE_HLSL             ON  CACHE BOOL "" FORCE)
set(GLSLANG_TESTS           OFF CACHE BOOL "" FORCE)
set(GLSLANG_ENABLE_INSTALL  OFF CACHE BOOL "" FORCE)
set(BUILD_EXTERNAL          OFF CACHE BOOL "" FORCE)
FetchContent_Declare(glslang
    GIT_REPOSITORY https://github.com/KhronosGroup/glslang.git
    GIT_TAG        16.6.0
    GIT_SHALLOW    TRUE)
FetchContent_MakeAvailable(glslang)

# SPIRV-Cross: SPIR-V → MSL/HLSL.
# Внимание: CLI-сборка SPIRV-Cross требует включёнными ВСЕ бэкенды
# (HLSL, CPP, UTIL) — иначе конфигурация падает с «Must enable ... if building CLI».
set(SPIRV_CROSS_CLI            ON  CACHE BOOL "" FORCE)
set(SPIRV_CROSS_ENABLE_TESTS   OFF CACHE BOOL "" FORCE)
set(SPIRV_CROSS_ENABLE_GLSL    ON  CACHE BOOL "" FORCE)
set(SPIRV_CROSS_ENABLE_HLSL    ON  CACHE BOOL "" FORCE)
set(SPIRV_CROSS_ENABLE_CPP     ON  CACHE BOOL "" FORCE)
set(SPIRV_CROSS_ENABLE_REFLECT ON  CACHE BOOL "" FORCE)
set(SPIRV_CROSS_ENABLE_UTIL    ON  CACHE BOOL "" FORCE)
FetchContent_Declare(SPIRV-Cross
    GIT_REPOSITORY https://github.com/KhronosGroup/SPIRV-Cross.git
    GIT_TAG        vulkan-sdk-1.4.363.0
    GIT_SHALLOW    TRUE)
FetchContent_MakeAvailable(SPIRV-Cross)

# glslang 16.x называет CLI-таргет `glslang-standalone` (готовый бинарь — `glslang`).
set(R2D_GLSLANG     "$<TARGET_FILE:glslang-standalone>")
set(R2D_SPIRV_CROSS "$<TARGET_FILE:spirv-cross>")

# --- Генерация --------------------------------------------------------------
set(R2D_SHADER_DIR "${CMAKE_BINARY_DIR}/generated/shaders")
set(R2D_SHADER_HEADER "${R2D_SHADER_DIR}/r2d_shaders.h")
file(MAKE_DIRECTORY "${R2D_SHADER_DIR}")

set(R2D_SHADER_ENTRIES "")

function(r2d_add_shader name stage source)
    set(basename "${name}_${stage}")
    set(spv "${R2D_SHADER_DIR}/${basename}.spv")
    set(msl "${R2D_SHADER_DIR}/${basename}.msl")

    add_custom_command(
        OUTPUT "${spv}" "${msl}"
        COMMAND "${R2D_GLSLANG}"
                -V --target-env vulkan1.1 --quiet
                -o "${spv}" "${source}"
        COMMAND "${R2D_SPIRV_CROSS}"
                "${spv}"
                --msl
                --msl-version 20100
                --msl-decoration-binding
                --output "${msl}"
        DEPENDS "${source}" glslang-standalone spirv-cross
        COMMENT "Шейдер ${basename}: GLSL → SPIR-V → MSL"
        VERBATIM)

    set(R2D_SHADER_ENTRIES "${R2D_SHADER_ENTRIES}${basename}," PARENT_SCOPE)
    set(R2D_SHADER_OUTPUTS "${R2D_SHADER_OUTPUTS};${spv};${msl}" PARENT_SCOPE)
endfunction()

r2d_add_shader(sprite vert "${CMAKE_SOURCE_DIR}/shaders/sprite.vert.glsl")
r2d_add_shader(sprite frag "${CMAKE_SOURCE_DIR}/shaders/sprite.frag.glsl")

add_custom_command(
    OUTPUT "${R2D_SHADER_HEADER}"
    COMMAND ${CMAKE_COMMAND}
            -DSHADER_DIR=${R2D_SHADER_DIR}
            -DSHADER_ENTRIES=${R2D_SHADER_ENTRIES}
            -DOUTPUT=${R2D_SHADER_HEADER}
            -P "${CMAKE_CURRENT_LIST_DIR}/EmbedShader.cmake"
    DEPENDS ${R2D_SHADER_OUTPUTS}
            "${CMAKE_CURRENT_LIST_DIR}/EmbedShader.cmake"
    COMMENT "Сборка r2d_shaders.h"
    VERBATIM)

add_custom_target(r2d_shaders DEPENDS "${R2D_SHADER_HEADER}")
