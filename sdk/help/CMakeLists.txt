# ---------------------------------------------------------------------------
# r2d-help — CLI-помощник по `$` API (docs/HELP.md).
#
# Отдельный бинарник SDK, не часть игры и не часть r2d-sdk: движок и ядро SDK
# остаются на C11 без новых зависимостей. Сам помощник — C11; эмбеддинги
# считает llama.cpp через его C API (llama.h). C++ живёт только внутри
# статической библиотеки llama.cpp — решение владельца, записанное в
# docs/HELP.md §6.
#
# R2D_HELP_LLAMA=OFF — сборка без llama.cpp: только BM25, без модели.
# ---------------------------------------------------------------------------
option(R2D_HELP_LLAMA "r2d-help: эмбеддинги через llama.cpp" ON)
set(R2D_HELP_MODEL "" CACHE FILEPATH
    "r2d-help: модель эмбеддингов GGUF (копируется рядом как r2d-help.gguf)")

add_executable(r2d-help help_main.c help_index.c help_corpus.c help_embed.c)
target_link_libraries(r2d-help PRIVATE r2d_sdk_core)
set_target_properties(r2d-help PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
if(NOT MSVC)
    target_compile_options(r2d-help PRIVATE -Wall -Wextra -Wno-unused-parameter)
endif()

if(R2D_HELP_LLAMA)
    # Запинено по коммиту, как остальные зависимости (cmake/Dependencies.cmake).
    # Только CPU и без OpenMP: один бинарник без внешних библиотек и одинаковый
    # результат на всех платформах.
    set(LLAMA_BUILD_COMMON   OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_TOOLS    OFF CACHE BOOL "" FORCE)
    set(LLAMA_BUILD_SERVER   OFF CACHE BOOL "" FORCE)
    set(LLAMA_CURL           OFF CACHE BOOL "" FORCE)
    set(LLAMA_OPENSSL        OFF CACHE BOOL "" FORCE)
    set(GGML_NATIVE          OFF CACHE BOOL "" FORCE)
    set(GGML_OPENMP          OFF CACHE BOOL "" FORCE)
    set(GGML_METAL           OFF CACHE BOOL "" FORCE)
    set(GGML_BLAS            OFF CACHE BOOL "" FORCE)
    set(GGML_CUDA            OFF CACHE BOOL "" FORCE)
    set(GGML_VULKAN          OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(llama_cpp
        GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
        GIT_TAG        8a1a9b5126126e5228b95fa909d4b08fac65e8b3  # b11517
        GIT_SHALLOW    FALSE
        EXCLUDE_FROM_ALL)
    FetchContent_MakeAvailable(llama_cpp)
    target_link_libraries(r2d-help PRIVATE llama)
    target_compile_definitions(r2d-help PRIVATE R2D_HELP_LLAMA=1)
endif()

# ---------------------------------------------------------------------------
# Индекс: пересобирается сам, когда меняются docs/ или src/highlevel/.
# CONFIGURE_DEPENDS — новый файл тоже замечается. Неизменённые фрагменты
# берут вектор из прошлого индекса, поэтому пересборка после правки — секунды.
# ---------------------------------------------------------------------------
file(GLOB R2D_HELP_JS CONFIGURE_DEPENDS "${CMAKE_SOURCE_DIR}/src/highlevel/*.js")
file(GLOB_RECURSE R2D_HELP_MD CONFIGURE_DEPENDS "${CMAKE_SOURCE_DIR}/docs/*.md")

set(R2D_HELP_INDEX "${CMAKE_BINARY_DIR}/r2d-help.idx")
set(R2D_HELP_ARGS index --root "${CMAKE_SOURCE_DIR}" --out "${R2D_HELP_INDEX}")
set(R2D_HELP_DEPS r2d-help ${R2D_HELP_JS} ${R2D_HELP_MD})
if(R2D_HELP_MODEL)
    set(R2D_HELP_GGUF "${CMAKE_BINARY_DIR}/r2d-help.gguf")
    add_custom_command(OUTPUT "${R2D_HELP_GGUF}"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different "${R2D_HELP_MODEL}" "${R2D_HELP_GGUF}"
        DEPENDS "${R2D_HELP_MODEL}"
        COMMENT "r2d-help: модель эмбеддингов")
    list(APPEND R2D_HELP_ARGS --model "${R2D_HELP_GGUF}")
    list(APPEND R2D_HELP_DEPS "${R2D_HELP_GGUF}")
endif()
add_custom_command(OUTPUT "${R2D_HELP_INDEX}"
    COMMAND r2d-help ${R2D_HELP_ARGS}
    DEPENDS ${R2D_HELP_DEPS}
    COMMENT "r2d-help: индекс $ API и docs"
    VERBATIM)
add_custom_target(r2d-help-index ALL DEPENDS "${R2D_HELP_INDEX}")

add_executable(r2d_help_test "${CMAKE_SOURCE_DIR}/tests/sdk/help_test.c" help_index.c help_corpus.c)
target_include_directories(r2d_help_test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(r2d_help_test PRIVATE r2d_sdk_core)
