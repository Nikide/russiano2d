# ---------------------------------------------------------------------------
# r2d-sdk — нативный бэкенд инструментов SDK (docs/SDK.md).
#
# Чистый C11 + SDL3 (файлы, каталоги, процессы) + JSON движка (src/json.c).
# Никаких внешних runtime: ни Python, ни Node.js, ни shell-скриптов.
# Один набор исходников — статическая библиотека r2d_sdk_core: из неё собираются
# CLI `r2d-sdk` и C-тесты, GUI SDK вызывает тот же CLI через мост `$.sdk`.
# ---------------------------------------------------------------------------
include(SDKFBX)

set(R2D_SDK_SOURCES
    sdk_util.c
    sdk_registry.c
    sdk_assets.c
    sdk_validate.c
    sdk_json.c
    sdk_image.c
    sdk_atlas.c
    sdk_re2dpng.c
    sdk_re2d.c
    sdk_re2d3.c
    sdk_gltf.c
    sdk_obj.c
    sdk_fbx.c
    sdk_bake3.c
    sdk_v2to3.c
    "${CMAKE_SOURCE_DIR}/src/rotsprite_math.c"
    sdk_char.c
    sdk_animation.c
    sdk_world.c
    "${CMAKE_SOURCE_DIR}/src/re2d_world.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_topology.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_visibility.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_bake.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_light.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_world_material.c"
    "${CMAKE_SOURCE_DIR}/src/re2d_math.c"
    "${CMAKE_SOURCE_DIR}/src/bsp.c"
    sdk_data.c
    sdk_bake.c
    sdk_batch.c
    sdk_agent.c
    sdk_cmds.c
    sdk_scaffold.c
    "${CMAKE_SOURCE_DIR}/src/json.c")

add_library(r2d_sdk_core STATIC ${R2D_SDK_SOURCES})
target_include_directories(r2d_sdk_core PUBLIC
    "${CMAKE_CURRENT_SOURCE_DIR}"
    "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_sdk_core PUBLIC SDL3::SDL3 r2d_stb r2d_ufbx ${R2D_WIN_LIBS})
set_source_files_properties(sdk_image.c PROPERTIES COMPILE_OPTIONS "-w")
if(NOT MSVC)
    target_link_libraries(r2d_sdk_core PUBLIC m)
    target_compile_options(r2d_sdk_core PRIVATE -Wall -Wextra -Wno-unused-parameter)
endif()

add_executable(r2d-sdk sdk_main.c)
target_link_libraries(r2d-sdk PRIVATE r2d_sdk_core)
set_target_properties(r2d-sdk PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")

# C-тесты бэкенда (без окна и GPU).
add_executable(r2d_sdk_core_test "${CMAKE_SOURCE_DIR}/tests/sdk/sdk_core_test.c")
target_link_libraries(r2d_sdk_core_test PRIVATE r2d_sdk_core)
if(NOT MSVC AND NOT CMAKE_CROSSCOMPILING)
    target_compile_options(r2d_sdk_core_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_sdk_core_test PRIVATE -fsanitize=address,undefined)
endif()
