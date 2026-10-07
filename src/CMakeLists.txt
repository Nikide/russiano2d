# ---------------------------------------------------------------------------
# Исполняемый файл движка russiano2d.
#
# Ядро (C11): app / render / physics / script / main
# Плюс два C++-слоя: отладочный оверлей (ImGui) и игровой GUI (RmlUi).
# ---------------------------------------------------------------------------

set(R2D_SOURCES
    r2d.h
    icons.h    icons.c
    bsp.h      bsp.c
    light.h    light.cpp
    app.h      app.c
    render.h   render.c
    profile.h  profile.c
    physics.h  physics.c
    http.h     http.c
    script.h   script.c
    json.h     json.c
    text.h     text.c
    font.h     font.c
    agent.h    agent.c
    crypto.h   crypto.c
    payload.h  payload.c
    project.h  project.c
    build.c
    main.c)

set(R2D_DEFINES "")

# Диагностика утечек QuickJS: -DR2D_JS_LEAK_DEBUG=ON
option(R2D_JS_LEAK_DEBUG "Печатать утечки объектов QuickJS при выходе" OFF)
if(R2D_JS_LEAK_DEBUG)
    list(APPEND R2D_DEFINES R2D_JS_LEAK_DEBUG=1)
endif()

# --- Готовый груз игры внутри бинарника --------------------------------------
# Файл генерирует `russiano2d build --relink <папка>`: это второй способ
# собрать игру (первый — дописать груз в копию движка, --append).
set(R2D_PAYLOAD_FILE "" CACHE FILEPATH "C-файл с грузом игры (см. russiano2d build --relink)")
if(R2D_PAYLOAD_FILE)
    list(APPEND R2D_SOURCES "${R2D_PAYLOAD_FILE}")
    list(APPEND R2D_DEFINES R2D_EMBEDDED_PAYLOAD=1)
endif()

# --- Звук -------------------------------------------------------------------
if(R2D_ENABLE_AUDIO)
    list(APPEND R2D_SOURCES audio.h audio.c audio_fx.h audio_fx.c
                            audio_reverb.h audio_reverb.c)
    list(APPEND R2D_DEFINES R2D_ENABLE_AUDIO=1)
else()
    # Без SDL_mixer остаётся тот же интерфейс audio.h, но с пустыми
    # реализациями — скриптовый слой не обрастает #ifdef.
    list(APPEND R2D_SOURCES audio.h audio_stub.c)
endif()

# --- Dear ImGui -------------------------------------------------------------
if(R2D_ENABLE_IMGUI)
    list(APPEND R2D_SOURCES
        debug_ui.h
        debug_ui.cpp
        shader_live.cpp
        shader_live.h
        "${imgui_SOURCE_DIR}/imgui.cpp"
        "${imgui_SOURCE_DIR}/imgui_draw.cpp"
        "${imgui_SOURCE_DIR}/imgui_tables.cpp"
        "${imgui_SOURCE_DIR}/imgui_widgets.cpp"
        "${imgui_SOURCE_DIR}/backends/imgui_impl_sdl3.cpp"
        "${imgui_SOURCE_DIR}/backends/imgui_impl_sdlgpu3.cpp")
    list(APPEND R2D_DEFINES R2D_ENABLE_IMGUI=1)
endif()

# --- RmlUi ------------------------------------------------------------------
# Каталог Backends/ у RmlUi подключается только вместе с сэмплами, поэтому
# компилируем нужные файлы бэкенда сами: они не зависят от его sample-кода.
if(R2D_ENABLE_RMLUI)
    list(APPEND R2D_SOURCES
        gui.h
        gui.cpp
        "${R2D_RMLUI_BACKENDS_DIR}/RmlUi_Renderer_SDL_GPU.cpp"
        "${R2D_RMLUI_BACKENDS_DIR}/RmlUi_Platform_SDL.cpp")
    list(APPEND R2D_DEFINES R2D_ENABLE_RMLUI=1)
else()
    # Без RmlUi остаётся тот же интерфейс gui.h, но с пустыми реализациями —
    # скриптовый слой не обрастает #ifdef.
    list(APPEND R2D_SOURCES gui.h gui_stub.c)
endif()

if(R2D_ENABLE_HOTRELOAD)
    list(APPEND R2D_DEFINES R2D_ENABLE_HOTRELOAD=1)
endif()

# --- Релизная упаковка скриптов в байткод -----------------------------------
# Штатный qjsc компилирует один файл и не умеет многофайловые ES-модули,
# поэтому используем собственный упаковщик на том же байткод-API QuickJS.
# Подробности — в шапке tools/r2d_pack.c.
if(R2D_EMBED_SCRIPTS)
    set(R2D_EMBED_ROOT "${CMAKE_SOURCE_DIR}/${R2D_EMBED_DIR}")
    file(GLOB_RECURSE R2D_JS_MODULES CONFIGURE_DEPENDS
        RELATIVE "${R2D_EMBED_ROOT}"
        "${R2D_EMBED_ROOT}/*.js")
    list(SORT R2D_JS_MODULES)

    if(NOT R2D_JS_MODULES)
        message(FATAL_ERROR "R2D_EMBED_SCRIPTS=ON, но в ${R2D_EMBED_DIR}/ нет .js файлов")
    endif()

    # R2D_JS_MODULES — имена модулей относительно каталога игры (их ждёт
    # загрузчик), а для DEPENDS нужны абсолютные пути: относительные CMake
    # ищет от каталога сборки и падает с «No rule to make target».
    set(R2D_JS_PATHS "")
    foreach(rel ${R2D_JS_MODULES})
        list(APPEND R2D_JS_PATHS "${R2D_EMBED_ROOT}/${rel}")
    endforeach()

    # Упаковщику достаточно точки входа: остальные модули он найдёт сам,
    # рекурсивно обходя цепочку import. Так в бинарник не попадут файлы,
    # которые игра не импортирует.
    set(R2D_ENTRY_MODULE "main.js")

    add_executable(r2d_pack "${CMAKE_SOURCE_DIR}/tools/r2d_pack.c")
    # Упаковщику нужна таблица встроенных модулей ($): он должен уметь
    # компилировать их, не читая с диска.
    add_dependencies(r2d_pack r2d_js)
    target_include_directories(r2d_pack PRIVATE "${CMAKE_BINARY_DIR}/generated")
    target_link_libraries(r2d_pack PRIVATE qjs)
    target_include_directories(r2d_pack PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")

    set(R2D_MODULES_C "${CMAKE_BINARY_DIR}/generated/r2d_modules.c")
    add_custom_command(
        OUTPUT "${R2D_MODULES_C}"
        COMMAND r2d_pack "${R2D_MODULES_C}" "${R2D_EMBED_ROOT}" "${R2D_ENTRY_MODULE}"
        DEPENDS ${R2D_JS_PATHS} r2d_pack
                "${CMAKE_CURRENT_SOURCE_DIR}/embed.h"
                "${CMAKE_CURRENT_SOURCE_DIR}/module_path.h"
        COMMENT "Упаковываю скрипты в байткод QuickJS"
        VERBATIM)

    list(APPEND R2D_SOURCES "${R2D_MODULES_C}" embed.h)
    list(APPEND R2D_DEFINES R2D_EMBED_SCRIPTS=1)
endif()

add_executable(russiano2d ${R2D_SOURCES})

# Кладём бинарник в корень сборки, чтобы из него работали относительные пути
# game/ и assets/, скопированные шагом POST_BUILD ниже.
set_target_properties(russiano2d PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")

# Заголовок шейдеров генерируется в области видимости корневого CMakeLists,
# поэтому связываем таргеты зависимостью, а не подсовываем файл в список
# исходников (иначе CMake не знает правила его сборки в этом каталоге).
add_dependencies(russiano2d r2d_shaders)

# Заголовок со встроенным шрифтом иконок генерируется в корневой области
# видимости — по той же причине связываем таргеты, а не файл.
add_dependencies(russiano2d r2d_icons)

# Таблица встроенных JS-модулей ($) генерируется в корневой области видимости —
# как и заголовки шейдеров с иконками, связываем таргеты зависимостью.
add_dependencies(russiano2d r2d_js)

target_include_directories(russiano2d PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}"
    "${R2D_SHADER_DIR}"
    "${CMAKE_BINARY_DIR}/generated")

target_compile_definitions(russiano2d PRIVATE ${R2D_DEFINES})

target_link_libraries(russiano2d PRIVATE ${R2D_WIN_LIBS}
    SDL3::SDL3
    SDL3_image::SDL3_image
    qjs
    box2d::box2d
    r2d_stb)   # stb_truetype: растеризатор глифов для src/font.c

# --- HTTP ($.http) ----------------------------------------------------------
# Ищем libcurl: с ней работают и http, и https. Если её нет — собираем
# встроенный сокетный бэкенд (только http://) и честно пишем об этом.
option(R2D_ENABLE_HTTP "HTTP-запросы из игры ($.http)" ON)
if(R2D_ENABLE_HTTP)
    find_package(CURL QUIET)
    if(CURL_FOUND)
        target_link_libraries(russiano2d PRIVATE CURL::libcurl)
        list(APPEND R2D_DEFINES R2D_HTTP_WITH_CURL=1)
        # R2D_DEFINES уже отдан таргету выше (до блока HTTP), поэтому define
        # добавляем напрямую: иначе libcurl линкуется, а http.c всегда собирает
        # сокетный бэкенд, и https молча не работает (README обещает обратное).
        target_compile_definitions(russiano2d PRIVATE R2D_HTTP_WITH_CURL=1)
        message(STATUS "  HTTP ............ libcurl ${CURL_VERSION_STRING} (http + https)")
    else()
        message(STATUS "  HTTP ............ встроенный сокетный бэкенд (только http://)")
    endif()
    target_compile_definitions(russiano2d PRIVATE R2D_ENABLE_HTTP=1)
else()
    message(STATUS "  HTTP ............ выключен")
endif()

# --- Пользовательские шейдеры ($.gfx.defineShader) --------------------------
# Компилируем GLSL в игре: glslang (GLSL → SPIR-V) и spirv-cross (SPIR-V → MSL
# для Metal). Обе библиотеки уже собираются как зависимости движка — те же,
# которыми cmake/Shaders.cmake компилирует встроенные шейдеры на этапе сборки.
# Опция выключаема: компилятор весит пару мегабайт в бинарнике.
option(R2D_ENABLE_LIVE_SHADERS "Компиляция пользовательских шейдеров в рантайме" ON)
if(R2D_ENABLE_LIVE_SHADERS)
    target_include_directories(russiano2d PRIVATE
        "${glslang_SOURCE_DIR}"
        "${glslang_BINARY_DIR}"
        "${spirv-cross_SOURCE_DIR}")
    target_link_libraries(russiano2d PRIVATE
        glslang
        glslang::glslang-default-resource-limits
        spirv-cross-core
        spirv-cross-msl
        spirv-cross-c)
    target_compile_definitions(russiano2d PRIVATE R2D_ENABLE_LIVE_SHADERS=1)
    message(STATUS "  Шейдеры ......... пользовательские шейдеры в рантайме (glslang + spirv-cross)")
else()
    message(STATUS "  Шейдеры ......... только встроенные (R2D_ENABLE_LIVE_SHADERS=OFF)")
endif()

if(R2D_ENABLE_AUDIO)
    target_link_libraries(russiano2d PRIVATE SDL3_mixer::SDL3_mixer)
endif()

if(R2D_ENABLE_IMGUI)
    target_include_directories(russiano2d PRIVATE
        "${imgui_SOURCE_DIR}"
        "${imgui_SOURCE_DIR}/backends")
endif()

if(R2D_ENABLE_RMLUI)
    target_include_directories(russiano2d PRIVATE "${R2D_RMLUI_BACKENDS_DIR}")
    target_link_libraries(russiano2d PRIVATE RmlUi::Core)
    # Бэкенды RmlUi собираются в обход её собственного CMake, поэтому
    # необходимый им выбор версии SDL задаём вручную.
    target_compile_definitions(russiano2d PRIVATE RMLUI_SDL_VERSION_MAJOR=3)
endif()

# Предупреждения — но без фанатизма: сторонние заголовки шумят.
if(MSVC)
    target_compile_options(russiano2d PRIVATE /W4)
else()
    target_compile_options(russiano2d PRIVATE -Wall -Wextra -Wno-unused-parameter)
endif()

# --- Копируем игровые данные рядом с бинарником ------------------------------
# Так движок запускается и из каталога сборки, и из корня проекта.
#
# Важно: именно отдельный таргет со штампом, а не POST_BUILD у исполняемого
# файла. POST_BUILD выполняется только при перелинковке, поэтому правка одного
# лишь .rml/.js не обновляла копию и можно было долго отлаживать «призрак»
# старой версии файла.
file(GLOB_RECURSE R2D_DATA_FILES CONFIGURE_DEPENDS
    "${CMAKE_SOURCE_DIR}/game/*"
    "${CMAKE_SOURCE_DIR}/assets/*"
    "${CMAKE_SOURCE_DIR}/demos/*")

foreach(R2D_DATA_DIR game assets demos)
    set(R2D_DATA_STAMP "${CMAKE_BINARY_DIR}/.r2d-copy-${R2D_DATA_DIR}.stamp")
    add_custom_command(
        OUTPUT "${R2D_DATA_STAMP}"
        COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${CMAKE_SOURCE_DIR}/${R2D_DATA_DIR}"
                "${CMAKE_BINARY_DIR}/${R2D_DATA_DIR}"
        COMMAND ${CMAKE_COMMAND} -E touch "${R2D_DATA_STAMP}"
        DEPENDS ${R2D_DATA_FILES}
        COMMENT "Обновляю ${R2D_DATA_DIR}/ рядом с исполняемым файлом"
        VERBATIM)
    add_custom_target(r2d_copy_${R2D_DATA_DIR} ALL DEPENDS "${R2D_DATA_STAMP}")
    add_dependencies(russiano2d r2d_copy_${R2D_DATA_DIR})
endforeach()
