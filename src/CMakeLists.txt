# ---------------------------------------------------------------------------
# Исполняемый файл движка russiano2d.
#
# Ядро (C11): app / render / physics / script / main
# C++-адаптеры существующих библиотек, включая GUI RmlUi.
# ---------------------------------------------------------------------------

# --- RE2D: 3D-авторинг спрайтов (опция объявлена в корневом CMakeLists) -----
# R2D_ENABLE_RE2D решает, входит ли в сборку необязательный слой 3D-авторинга:
#
#   * исходники re2d*/real2d4/rotsprite* не компилируются;
#   * EXR-декодер панорамного неба (tinyexr + zlib) не подключается;
#   * нативные биндинги engine.re2d / engine.rotsprite / engine.real2d не
#     ставятся, поэтому модули $, которые их требуют, не устанавливаются
#     (сами JS-модули остаются в бинарнике: api.js импортирует их статически,
#     см. cmake/EmbedJs.cmake);
#   * данные и C-тесты 3D-авторинга не собираются.
#
# Игровой код двух сборок совместим: конфигурацию видно из скрипта как
# `$.re2dEnabled`. Существующие 3D-демо требуют сборки с ON (поведение по
# умолчанию), см. docs/RE2D.md и docs/BUILD.md.
if(R2D_ENABLE_RE2D)
    include(WorldEXR)
else()
    message(STATUS "  RE2D ............ выключен (2D-платформерная сборка)")
endif()

set(R2D_SOURCES
    r2d.h
    icons.h    icons.c
    bsp.h      bsp.c
    light.h    light.cpp
    app.h      app.c
    render.h   render.c
    sprite_mesh.h sprite_mesh.c
    r2d_slot_pool.h r2d_slot_pool.c
    profile.h  profile.c
    physics.h  physics.c
    http.h     http.c
    sdk_host.h sdk_host.c
    script.h   script.c
    async.h    async.c
    nodes.h    nodes.c
    json.h     json.c
    fs_util.h  fs_util.c
    text.h     text.c
    font.h     font.c
    agent.h    agent.c
    replay.h   replay.c
    crypto.h   crypto.c
    payload.h  payload.c
    project.h  project.c
    build.c
    main.c)

# Опция объявлена здесь, до списка источников: от неё зависит, какие файлы в
# него попадут (см. выше).
set(R2D_DEFINES "")
if(R2D_SHADERS_WGSL_ONLY)
    # Shader blobs are WGSL-only in the browser build; native GLSL/MSL world
    # variants (including the SSBO batch variant) are not generated.
    list(APPEND R2D_DEFINES R2D_SHADERS_WGSL_ONLY=1)
endif()
if(R2D_ENABLE_RE2D)
    list(APPEND R2D_DEFINES R2D_ENABLE_RE2D=1)
endif()

# Версия движка одна на проект: строку берём из PROJECT_VERSION, чтобы usage,
# заголовок окна, событие `ready` агента и User-Agent HTTP не отставали от
# CHANGELOG (раньше в r2d.h была зашита «0.1.0» при проекте 0.1.14).
list(APPEND R2D_DEFINES R2D_VERSION_STRING="${PROJECT_VERSION}")

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

if(R2D_ENABLE_RE2D)
    list(APPEND R2D_SOURCES
        rotsprite.h rotsprite.c rotsprite_math.h rotsprite_math.c rotsprite3.h rotsprite3.c
        real2d4.h  real2d4.c
        api_metadata.h api_metadata.c re2d.h re2d.c re2d_math.h re2d_math.c re2d_world.h re2d_world.c re2d_world_topology.c re2d_world_visibility.c re2d_world_hint.c re2d_world_light.c re2d_world_material.c re2d_world_runtime.c
        re2d_world_gpu.h re2d_world_gpu.c
        re2d_world_bake.h re2d_world_bake.c
        re2d_world_atlas.h re2d_world_atlas.c
        re2d_world_atlas_prefetch.h re2d_world_atlas_prefetch.c
        re2d_world_trace.h re2d_world_trace.c
        re2d_world_mover.h re2d_world_mover.c
        re2d_world_trigger.h re2d_world_trigger.c
        re2d_world_controller.h re2d_world_controller.c
        re2d_world_semantic.h re2d_world_semantic.c
        re2d_world_metadata.h re2d_world_metadata.c
        re2d_world_particle.h re2d_world_particle.c
        re2d_world_vfx.h re2d_world_vfx.c
        re2d_world_nav.h re2d_world_nav.c
        re2d_world_automap.h re2d_world_automap.c
        re2d_world_secret.h re2d_world_secret.c
        re2d_world_terrain.h re2d_world_terrain.c
        re2d_world_save.h re2d_world_save.c
        re2d_world_sky.h re2d_world_sky.c
        re2d_world_post.h re2d_world_post.c
        re2d_world_debug_overlay.h re2d_world_debug_overlay.c
        re2d_world_stream.h re2d_world_stream.c
        re2d_world_stream_io.h re2d_world_stream_io.c
        re2d_world_impostor.h re2d_world_impostor.c
        re2d_world_portal_visual.h re2d_world_portal_visual.c
        re2d_world_volume.h re2d_world_volume.c
        re2d_world_material_anim.h re2d_world_material_anim.c
        re2d_world_polywall.h re2d_world_polywall.c
        re2d_world_polygon.h re2d_world_polygon.c
        re2d_world_render_features.h re2d_world_render_features.c
        re2d_world_batch.h re2d_world_batch.c
        re2d_world_region.h re2d_world_region.c
        re2d_postprocess.h re2d_postprocess.c
        re2d_audio_zone.h re2d_audio_zone.c
        re2d_audio_voices.h re2d_audio_voices.c)
    list(APPEND R2D_DEFINES R2D_ENABLE_RE2D=1)
endif()

# --- Звук -------------------------------------------------------------------
if(R2D_ENABLE_AUDIO)
    include(SteamAudio)
    list(APPEND R2D_SOURCES audio_spatial.h audio_spatial.c audio.h audio.c audio_fx.h audio_fx.c
                            audio_reverb.h audio_reverb.c)
    list(APPEND R2D_DEFINES R2D_ENABLE_AUDIO=1)
else()
    # Без SDL_mixer остаётся тот же интерфейс audio.h, но с пустыми
    # реализациями — скриптовый слой не обрастает #ifdef.
    list(APPEND R2D_SOURCES audio.h audio_stub.c)
endif()

# --- Сеть -------------------------------------------------------------------
if(R2D_ENABLE_NET)
    list(APPEND R2D_SOURCES net.h net.c)
    list(APPEND R2D_DEFINES R2D_ENABLE_NET=1)
else()
    # Тот же интерфейс net.h, но без сокетов: скриптовый слой не обрастает
    # #ifdef, а сборка не тянет SDL3_net.
    list(APPEND R2D_SOURCES net.h net_stub.c)
endif()


# --- Компилятор живых шейдеров ($.gfx.defineShader) -------------------------
# Выключенный компилятор больше не оставляет render.c без символов: вместо
# shader_live.cpp компилируется заглушка с тем же интерфейсом (как audio_stub.c
# и net_stub.c). Иначе сборка с -DR2D_ENABLE_LIVE_SHADERS=OFF не линковалась.
if(R2D_ENABLE_LIVE_SHADERS)
    list(APPEND R2D_SOURCES shader_live.h shader_live.cpp)
else()
    list(APPEND R2D_SOURCES shader_live.h shader_live_stub.c)
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

    # Веб-сборка: у RmlUi нет WGSL-вариантов шейдеров, поэтому их тексты лежат
    # в движке, а в его бэкенд ветку WGSL добавляет патч из репозитория
    # (см. cmake/Dependencies.cmake и third_party/patches/).
    if(EMSCRIPTEN)
        list(APPEND R2D_SOURCES rmlui_wgsl.h rmlui_wgsl.c)
    endif()
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

# Кликабельный запуск SDK: тот же runtime, ничего второго. Двойной клик по
# russiano2d-sdk запускает `russiano2d --game sdk` (docs/SDK.md §1).
if(NOT EMSCRIPTEN)
    add_executable(russiano2d-sdk sdk_launcher.c)
    target_link_libraries(russiano2d-sdk PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS})
    set_target_properties(russiano2d-sdk PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
endif()

# §38: релизный профиль. Один таргет, никаких изменений в поведении.
if(R2D_LTO)
    include(CheckIPOSupported)
    check_ipo_supported(RESULT _r2d_ipo_ok OUTPUT _r2d_ipo_msg LANGUAGES C CXX)
    if(_r2d_ipo_ok)
        message(STATUS "  LTO ............. включён")
        set_property(TARGET russiano2d PROPERTY INTERPROCEDURAL_OPTIMIZATION TRUE)
    else()
        message(WARNING "R2D_LTO=ON, но IPO не поддерживается: ${_r2d_ipo_msg}")
    endif()
endif()

# Тестовая сборка: см. R2D_TEST_FREE_POISON в корневом CMakeLists.txt.
# В релизном пути определения нет — ни одной лишней инструкции.
if(R2D_TEST_FREE_POISON)
    target_compile_definitions(russiano2d PRIVATE R2D_TEST_FREE_POISON=1)
endif()

# Комплект шумов: C-фасад над вендоренным FastNoiseLite (свой cmake-файл, чтобы
# не пересекаться правками с Tracy/Zstd/RmlUi).
include(Noise)

# Кладём бинарник в корень сборки, чтобы из него работали относительные пути
# game/ и assets/, скопированные шагом POST_BUILD ниже.
set_target_properties(russiano2d PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")

# --- Обход внутренней ошибки компилятора MSVC --------------------------------
# На windows-2022 (MSVC 14.44) сборка Release падает внутренней ошибкой CL.exe
# в фазе кодогенерации этого проекта (стек через CloseTypeServerPDB). /Zf и
# отключение /MP проверены прогоном CI и не помогли; сам PDB-сервер типов
# убирает /Z7, он включён глобально в корневом CMakeLists. Здесь остаётся
# только снять /MP у проекта движка, чтобы кодогенерация не шла общей пачкой.
# Действует лишь для MSVC/VS.
if(MSVC)
    # Что проверено прогонами CI: ни /Zf (PDB без сервера типов), ни снятие /MP,
    # ни /Z7 не убирают внутреннюю ошибку CL.exe — падение остаётся в проходе
    # оптимизатора («Generating Code...») на батче наших C-файлов. Поэтому
    # понижаем уровень оптимизации только у цели движка: /O1 — тот же
    # оптимизатор, но без самых агрессивных проходов; Release остаётся
    # оптимизированным, третьи стороны — на своих настройках.
    #
    # Это обход ошибки тулчейна (MSVC 14.44.35207), а не решение: когда раннер
    # обновит компилятор, /O1 можно снять и вернуть /O2 (проверка — зелёный
    # windows-x86_64 в CI).
    target_compile_options(russiano2d PRIVATE /O1 /Od)
    set_target_properties(russiano2d PROPERTIES
        VS_GLOBAL_MultiProcessorCompilation "false")
endif()

# --- Веб-сборка (Emscripten) -------------------------------------------------
# На выходе — russiano2d.html + .js + .wasm + .data: груз игры монтируется в
# виртуальную ФС MEMFS, поэтому файлы читаются движком как обычные (SDL_GetPathInfo
# и stdio работают поверх неё).
if(EMSCRIPTEN)
    set_target_properties(russiano2d PROPERTIES SUFFIX ".html")

    # --preload-file разрешает путь от ТЕКУЩЕГО каталога линковки, а это каталог
    # сборки, поэтому относительные пути переводим в абсолютные от корня
    # репозитория: -DR2D_WEB_PRELOAD="web/game@/game;assets@/assets".
    foreach(preload IN LISTS R2D_WEB_PRELOAD)
        string(FIND "${preload}" "@" at_pos)
        if(at_pos GREATER -1)
            string(SUBSTRING "${preload}" 0 ${at_pos} preload_local)
            math(EXPR mount_pos "${at_pos} + 1")
            string(SUBSTRING "${preload}" ${mount_pos} -1 preload_mount)
        else()
            set(preload_local "${preload}")
            set(preload_mount "/")
        endif()
        if(NOT IS_ABSOLUTE "${preload_local}")
            get_filename_component(preload_local
                "${CMAKE_SOURCE_DIR}/${preload_local}" ABSOLUTE)
        endif()
        target_link_options(russiano2d PRIVATE
            "--preload-file=${preload_local}@${preload_mount}")
    endforeach()

    # --- Страница и её настройки (то, что называют «экспортом в веб») -------
    #   R2D_WEB_SHELL         — своя HTML-оболочка (по умолчанию web/shell.html);
    #   R2D_WEB_LOADER_IMAGE  — своя картинка экрана загрузки (по умолчанию
    #                           маскот из README, docs/images/russiano2d-mascot.png);
    #   R2D_WEB_FORCE_PLAY    — начинать игру сразу после загрузки, без кнопки
    #                           «Играть» (она нужна браузеру для звука, поэтому
    #                           по умолчанию показывается).
    #
    # Оболочка не копируется как есть, а конфигурируется: CMake подставляет в
    # неё имя картинки и «начинать сразу», а Emscripten — скрипт на место
    # {{{ SCRIPT }}}. Поэтому в шаблоне допустимы подстановки вида @ИМЯ@,
    # и их же можно использовать в своей оболочке.
    set(R2D_WEB_SHELL_TEMPLATE "${R2D_WEB_SHELL}")
    if(NOT R2D_WEB_SHELL_TEMPLATE)
        set(R2D_WEB_SHELL_TEMPLATE "${CMAKE_SOURCE_DIR}/web/shell.html")
    endif()
    if(NOT EXISTS "${R2D_WEB_SHELL_TEMPLATE}")
        message(FATAL_ERROR "нет HTML-оболочки ${R2D_WEB_SHELL_TEMPLATE}")
    endif()

    set(R2D_WEB_LOADER_IMAGE_NAME "loader.png")
    set(R2D_WEB_LOADER_IMAGE_SOURCE "${CMAKE_SOURCE_DIR}/docs/images/russiano2d-mascot.png")
    if(R2D_WEB_LOADER_IMAGE)
        if(NOT IS_ABSOLUTE "${R2D_WEB_LOADER_IMAGE}")
            get_filename_component(R2D_WEB_LOADER_IMAGE
                "${CMAKE_SOURCE_DIR}/${R2D_WEB_LOADER_IMAGE}" ABSOLUTE)
        endif()
        if(NOT EXISTS "${R2D_WEB_LOADER_IMAGE}")
            message(FATAL_ERROR "нет картинки экрана загрузки ${R2D_WEB_LOADER_IMAGE}")
        endif()
        set(R2D_WEB_LOADER_IMAGE_SOURCE "${R2D_WEB_LOADER_IMAGE}")
    endif()

    if(R2D_WEB_FORCE_PLAY)
        set(R2D_WEB_FORCE_PLAY_JS "true")
    else()
        set(R2D_WEB_FORCE_PLAY_JS "false")
    endif()

    set(R2D_WEB_SHELL_GENERATED "${CMAKE_BINARY_DIR}/web-shell.html")
    # configure_file выполняется на конфигурации и сам перезапускает CMake,
    # когда шаблон изменился, — отдельного шага сборки здесь не нужно.
    configure_file("${R2D_WEB_SHELL_TEMPLATE}" "${R2D_WEB_SHELL_GENERATED}" @ONLY)

    target_link_options(russiano2d PRIVATE "--shell-file=${R2D_WEB_SHELL_GENERATED}")
    # Оболочка — вход линковки, а не просто опция: без этого её правка не
    # пересобирала страницу ("ninja: no work to do").
    set_property(TARGET russiano2d APPEND PROPERTY LINK_DEPENDS
                 "${R2D_WEB_SHELL_GENERATED}")

    # Картинки страницы: картинка экрана загрузки и иконка вкладки. Лежат рядом
    # с .html, поэтому видны ДО загрузки .wasm и .data.
    add_custom_command(
        OUTPUT "${CMAKE_BINARY_DIR}/${R2D_WEB_LOADER_IMAGE_NAME}"
               "${CMAKE_BINARY_DIR}/russiano2d.png"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${R2D_WEB_LOADER_IMAGE_SOURCE}"
                "${CMAKE_BINARY_DIR}/${R2D_WEB_LOADER_IMAGE_NAME}"
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${CMAKE_SOURCE_DIR}/assets/icons/russiano2d.png"
                "${CMAKE_BINARY_DIR}/russiano2d.png"
        DEPENDS "${R2D_WEB_LOADER_IMAGE_SOURCE}"
                "${CMAKE_SOURCE_DIR}/assets/icons/russiano2d.png"
        COMMENT "Кладу картинки страницы рядом с веб-сборкой"
        VERBATIM)
    add_custom_target(r2d_web_page_assets DEPENDS
        "${CMAKE_BINARY_DIR}/${R2D_WEB_LOADER_IMAGE_NAME}"
        "${CMAKE_BINARY_DIR}/russiano2d.png")
    add_dependencies(russiano2d r2d_web_page_assets)
endif()

# Заголовок шейдеров генерируется в области видимости корневого CMakeLists,
# поэтому связываем таргеты зависимостью, а не подсовываем файл в список
# исходников (иначе CMake не знает правила его сборки в этом каталоге).
add_dependencies(russiano2d r2d_shaders)

# Заголовок со встроенным шрифтом иконок генерируется в корневой области
# видимости — по той же причине связываем таргеты, а не файл.
add_dependencies(russiano2d r2d_icons)

# Сплэш SDK: сгенерированный заголовок с байтами картинки/разметки.
add_dependencies(russiano2d r2d_splash)

# Таблица встроенных JS-модулей ($) генерируется в корневой области видимости —
# как и заголовки шейдеров с иконками, связываем таргеты зависимостью.
add_dependencies(russiano2d r2d_js)

target_include_directories(russiano2d PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}"
    "${R2D_SHADER_DIR}"
    "${CMAKE_BINARY_DIR}/generated")

target_compile_definitions(russiano2d PRIVATE ${R2D_DEFINES})

# EXR-декодер нужен только Re2D World (панорамное небо): при выключенном RE2D
# ни библиотеки, ни tinyexr/zlib в сборке нет.
set(R2D_RE2D_LIBS "")
if(R2D_ENABLE_RE2D)
    set(R2D_RE2D_LIBS r2d_world_exr)
endif()

target_link_libraries(russiano2d PRIVATE ${R2D_RE2D_LIBS} ${R2D_WIN_LIBS}
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
    if(TARGET R2D_SteamAudio)
        target_link_libraries(russiano2d PRIVATE R2D_SteamAudio)
        target_compile_definitions(russiano2d PRIVATE R2D_STEAM_AUDIO=1)
        if(WIN32)
            set(_r2d_audio_dest "$<TARGET_FILE_DIR:russiano2d>")
        else()
            set(_r2d_audio_dest "$<TARGET_FILE_DIR:russiano2d>/lib")
        endif()
        add_custom_command(TARGET russiano2d POST_BUILD COMMAND ${CMAKE_COMMAND} -E make_directory "${_r2d_audio_dest}" COMMAND ${CMAKE_COMMAND} -E copy_if_different "${R2D_STEAM_AUDIO_RUNTIME}" "${_r2d_audio_dest}")
        set_property(TARGET russiano2d APPEND PROPERTY BUILD_RPATH "$<TARGET_FILE_DIR:russiano2d>")
        if(WIN32)
            install(FILES "${R2D_STEAM_AUDIO_RUNTIME}" DESTINATION .)
        else()
            install(FILES "${R2D_STEAM_AUDIO_RUNTIME}" DESTINATION lib)
        endif()
        install(DIRECTORY "${CMAKE_SOURCE_DIR}/third_party/steam_audio/" DESTINATION share/licenses/steam_audio)
    endif()
endif()

if(R2D_ENABLE_NET)
    # Цель может называться SDL3_net::SDL3_net (современный SDL_net 3) или
    # SDL3_net::SDL3_net-static — берём ту, что объявила зависимость.
    if(TARGET SDL3_net::SDL3_net)
        target_link_libraries(russiano2d PRIVATE SDL3_net::SDL3_net)
    elseif(TARGET SDL3_net::SDL3_net-static)
        target_link_libraries(russiano2d PRIVATE SDL3_net::SDL3_net-static)
    else()
        message(FATAL_ERROR "[deps] SDL3_net собран, но цель не найдена")
    endif()
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
#
# В веб-сборке копировать нечего: данные вшиваются в .data через
# --preload-file (см. блок EMSCRIPTEN выше).
#
# В сборке платформера (R2D_ENABLE_RE2D=OFF) каталог demos/ не копируется:
# половина демо — 3D-авторинг, который в такой сборке не работает, а весь
# каталог весит 260 МБ и в дереве сборки платформера не нужен. Сама игра
# (game/) и ассеты копируются всегда.
if(NOT EMSCRIPTEN)
set(R2D_DATA_DIRS game assets)
if(R2D_ENABLE_RE2D)
    list(APPEND R2D_DATA_DIRS demos)
endif()

file(GLOB_RECURSE R2D_DATA_FILES CONFIGURE_DEPENDS
    "${CMAKE_SOURCE_DIR}/game/*"
    "${CMAKE_SOURCE_DIR}/assets/*"
    "${CMAKE_SOURCE_DIR}/demos/*")

foreach(R2D_DATA_DIR IN LISTS R2D_DATA_DIRS)
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
endif()   # NOT EMSCRIPTEN
