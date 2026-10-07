# ---------------------------------------------------------------------------
# Зависимости russiano2d
#
# Все версии запинены. Где возможно — сначала ищем системный пакет, иначе
# тянем исходники через FetchContent и собираем вместе с проектом.
#
# Итоговые CMake-таргеты, которые используются в src/CMakeLists.txt:
#   SDL3::SDL3                  — платформа, окно, ввод, SDL_GPU
#   SDL3_image::SDL3_image      — загрузка PNG
#   qjs                         — статическая библиотека QuickJS-ng
#   qjsc                        — компилятор JS → байткод (релизная сборка)
#   box2d::box2d                — физика Box2D v3
#   RmlUi::Core                 — игровой GUI
#   imgui                       — отладочный оверлей (собираем сами)
# ---------------------------------------------------------------------------

include(FetchContent)

# Движок — приложение: все зависимости собираются статически, чтобы готовый
# пакет был самодостаточным (системный SDL3, если найден, всё равно берётся
# как есть — это выбор того, кто собирает).
set(BUILD_SHARED_LIBS OFF CACHE BOOL "Собирать зависимости статически" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)

# ---------------------------------------------------------------------------
# SDL3
# ---------------------------------------------------------------------------
find_package(SDL3 3.2 CONFIG QUIET)

if(NOT SDL3_FOUND)
    message(STATUS "[deps] SDL3 не найден в системе — собираю из исходников")
    # Статически: пакет должен быть самодостаточным. С shared-сборкой
    # бинарник требует libSDL3.so.0 / libSDL3.0.dylib рядом, и скачавший
    # архив получал «cannot open shared object file».
    set(SDL_SHARED OFF CACHE BOOL "" FORCE)
    set(SDL_STATIC ON  CACHE BOOL "" FORCE)
    set(SDL_TESTS OFF  CACHE BOOL "" FORCE)
    set(SDL_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(SDL_INSTALL OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(SDL3
        GIT_REPOSITORY https://github.com/libsdl-org/SDL.git
        GIT_TAG        release-3.4.16
        GIT_SHALLOW    TRUE)
    FetchContent_MakeAvailable(SDL3)
else()
    message(STATUS "[deps] SDL3 ${SDL3_VERSION} — системный")
endif()

# ---------------------------------------------------------------------------
# SDL3_image (PNG)
# ---------------------------------------------------------------------------
find_package(SDL3_image CONFIG QUIET)

if(NOT SDL3_image_FOUND)
    message(STATUS "[deps] SDL3_image не найден в системе — собираю из исходников")
    set(SDLIMAGE_VENDORED        ON  CACHE BOOL "" FORCE)
    set(SDLIMAGE_SAMPLES         OFF CACHE BOOL "" FORCE)
    set(SDLIMAGE_TESTS           OFF CACHE BOOL "" FORCE)
    set(SDLIMAGE_INSTALL         OFF CACHE BOOL "" FORCE)
    set(SDLIMAGE_DEPS_SHARED     OFF CACHE BOOL "" FORCE)
    set(SDLIMAGE_STRICT          OFF CACHE BOOL "" FORCE)
    # Отключаем экзотические форматы: они тянут тяжёлые внешние библиотеки,
    # а движку для спрайтов достаточно PNG/BMP/TGA/GIF/QOI.
    set(SDLIMAGE_AVIF OFF CACHE BOOL "" FORCE)
    set(SDLIMAGE_JXL  OFF CACHE BOOL "" FORCE)
    set(SDLIMAGE_TIF  OFF CACHE BOOL "" FORCE)
    set(SDLIMAGE_WEBP OFF CACHE BOOL "" FORCE)
    set(SDLIMAGE_SVG  OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(SDL3_image
        GIT_REPOSITORY https://github.com/libsdl-org/SDL_image.git
        GIT_TAG        0891fc30428b518e7d018677bd6fa95c1a50f4c6  # release-3.4.8
        GIT_SHALLOW    TRUE
        # По умолчанию FetchContent тянет ВСЕ подмодули SDL_image, включая
        # aom/dav1d/libjxl/libwebp/libtiff — это сотни мегабайт ради форматов,
        # которые мы всё равно отключили выше. Берём только нужное.
        GIT_SUBMODULES "external/jpeg;external/libpng;external/zlib")
    FetchContent_MakeAvailable(SDL3_image)
else()
    message(STATUS "[deps] SDL3_image — системный")
endif()

# ---------------------------------------------------------------------------
# QuickJS-ng — скриптовый рантайм
# ---------------------------------------------------------------------------
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
FetchContent_Declare(quickjs
    GIT_REPOSITORY https://github.com/quickjs-ng/quickjs.git
    GIT_TAG        3c9afc9943323ee9c7dbd123c0cd991448f4b6c2  # v0.10.1
    GIT_SHALLOW    TRUE)
FetchContent_MakeAvailable(quickjs)

# ---------------------------------------------------------------------------
# Box2D v3 — физика
# ---------------------------------------------------------------------------
set(BOX2D_SAMPLES      OFF CACHE BOOL "" FORCE)
set(BOX2D_UNIT_TESTS   OFF CACHE BOOL "" FORCE)
set(BOX2D_BENCHMARKS   OFF CACHE BOOL "" FORCE)
set(BOX2D_DOCS         OFF CACHE BOOL "" FORCE)
set(BOX2D_VALIDATE     ON  CACHE BOOL "" FORCE)
FetchContent_Declare(box2d
    GIT_REPOSITORY https://github.com/erincatto/box2d.git
    GIT_TAG        8c661469c9507d3ad6fbd2fea3f1aa71669c2fe3  # v3.1.1
    GIT_SHALLOW    TRUE)
FetchContent_MakeAvailable(box2d)

# ---------------------------------------------------------------------------
# SDL3_mixer — звук и музыка
#
# Основная библиотека SDL3 умеет отдавать на устройство только сырые сэмплы
# и не декодирует OGG/MP3, поэтому звуковой слой построен на SDL_mixer 3:
# он даёт загрузку файлов, каналы, петли, затухания и стриминг музыки.
# ---------------------------------------------------------------------------
if(R2D_ENABLE_AUDIO)
    set(SDLMIXER_VENDORED   ON  CACHE BOOL "" FORCE)
    set(SDLMIXER_TESTS      OFF CACHE BOOL "" FORCE)
    set(SDLMIXER_EXAMPLES   OFF CACHE BOOL "" FORCE)
    set(SDLMIXER_INSTALL    OFF CACHE BOOL "" FORCE)
    set(SDLMIXER_DEPS_SHARED OFF CACHE BOOL "" FORCE)
    set(SDLMIXER_STRICT     OFF CACHE BOOL "" FORCE)

    # Оставляем ровно те форматы, что нужны играм: WAV (встроен), OGG и MP3.
    # Остальное — лишние внешние библиотеки в сборке.
    set(SDLMIXER_OGG     ON  CACHE BOOL "" FORCE)
    set(SDLMIXER_MP3     ON  CACHE BOOL "" FORCE)
    set(SDLMIXER_MP3_DRMP3  ON  CACHE BOOL "" FORCE)   # заголовочный, без libmpg123
    set(SDLMIXER_MP3_MPG123 OFF CACHE BOOL "" FORCE)
    set(SDLMIXER_FLAC    OFF CACHE BOOL "" FORCE)
    set(SDLMIXER_OPUS    OFF CACHE BOOL "" FORCE)
    set(SDLMIXER_MOD     OFF CACHE BOOL "" FORCE)
    set(SDLMIXER_MIDI    OFF CACHE BOOL "" FORCE)
    set(SDLMIXER_GME     OFF CACHE BOOL "" FORCE)
    set(SDLMIXER_WAVPACK OFF CACHE BOOL "" FORCE)
    set(SDLMIXER_VOC     OFF CACHE BOOL "" FORCE)
    set(SDLMIXER_AU      OFF CACHE BOOL "" FORCE)
    set(SDLMIXER_AIFF    OFF CACHE BOOL "" FORCE)

    FetchContent_Declare(SDL3_mixer
        GIT_REPOSITORY https://github.com/libsdl-org/SDL_mixer.git
        GIT_TAG        72a81869b45e249e8e67102db4e98dd2441f05a1  # release-3.2.4
        GIT_SHALLOW    TRUE
        # Как и у SDL_image, по умолчанию тянутся ВСЕ подмодули — включая
        # тяжёлые кодеки, которые мы только что отключили.
        GIT_SUBMODULES "external/ogg;external/vorbis")
    FetchContent_MakeAvailable(SDL3_mixer)
endif()

# ---------------------------------------------------------------------------
# SDL3_net — сеть (только авторитарная модель, см. docs/highlevel/net.md)
#
# Канал — датаграммы: сервер отвечает на адрес отправителя, не заводя
# соединений на каждого игрока, а потеря пакета не блокирует остальных.
# Минимум: без R2D_ENABLE_NET остаётся net_stub.c с тем же интерфейсом.
# ---------------------------------------------------------------------------
if(R2D_ENABLE_NET)
    set(SDLNET_TESTS    OFF CACHE BOOL "" FORCE)
    set(SDLNET_EXAMPLES OFF CACHE BOOL "" FORCE)
    set(SDLNET_INSTALL  OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(SDL3_net
        GIT_REPOSITORY https://github.com/libsdl-org/SDL_net.git
        GIT_TAG        30dd38a36b487b60847a8bb9832e94b124802e2f
        GIT_SHALLOW    TRUE)
    FetchContent_MakeAvailable(SDL3_net)
endif()

# ---------------------------------------------------------------------------
# RmlUi — игровой GUI (HUD, меню, инвентарь) на HTML/CSS-подобной разметке
# ---------------------------------------------------------------------------
if(R2D_ENABLE_RMLUI)
    set(RMLUI_SAMPLES              OFF CACHE BOOL "" FORCE)
    set(RMLUI_TESTS                OFF CACHE BOOL "" FORCE)
    set(RMLUI_BUILD_TESTS          OFF CACHE BOOL "" FORCE)
    set(RMLUI_INSTALL              OFF CACHE BOOL "" FORCE)
    set(RMLUI_WARNINGS_AS_ERRORS   OFF CACHE BOOL "" FORCE)
    set(RMLUI_PRECOMPILED_HEADERS  OFF CACHE BOOL "" FORCE)
    set(RMLUI_COMPILER_OPTIONS     OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(RmlUi
        GIT_REPOSITORY https://github.com/mikke89/RmlUi.git
        GIT_TAG        ba95ffe8bfb6370efb2cdcca927eaad4710c5413  # 6.3
        GIT_SHALLOW    TRUE)

    # RmlUi везёт собственный FindFreetype для Emscripten (шрифт берётся из
    # порта -sUSE_FREETYPE=1, системного FreeType в wasm нет), но каталог с
    # этим модулем добавляет к CMAKE_MODULE_PATH только когда собирается как
    # корневой проект. Мы встраиваем RmlUi через FetchContent, поэтому каталог
    # добавляем сами — иначе конфигурация веб-сборки падает на
    # «Freetype could not be found».
    if(EMSCRIPTEN)
        foreach(_r2d_rmlui_src "${FETCHCONTENT_SOURCE_DIR_RMLUI}"
                               "${CMAKE_BINARY_DIR}/_deps/rmlui-src")
            if(_r2d_rmlui_src AND EXISTS "${_r2d_rmlui_src}/CMake/Modules/Emscripten")
                list(PREPEND CMAKE_MODULE_PATH "${_r2d_rmlui_src}/CMake/Modules/Emscripten")
            endif()
        endforeach()
    endif()

    FetchContent_MakeAvailable(RmlUi)
    # Бэкенды RmlUi под SDL_GPU не собираются автоматически (каталог Backends/
    # подключается только вместе с сэмплами). Компилируем нужные файлы сами —
    # см. src/CMakeLists.txt.
    set(R2D_RMLUI_BACKENDS_DIR "${RmlUi_SOURCE_DIR}/Backends")

    # --- Веб-сборка: WGSL-шейдеры интерфейса --------------------------------
    # RmlUi 6.3 знает только SPIR-V, MSL и DXIL, а браузерный WebGPU принимает
    # исключительно WGSL. Патч из репозитория добавляет его бэкенду ветку WGSL:
    # тексты шейдеров живут в движке (src/rmlui_wgsl.c) и попадают в бинарник,
    # так что в рантайме ничего не читается с диска.
    #
    # Патч применяется только для веб-сборки и один раз (по маркеру). Нативная
    # сборка компилирует тот же файл, но ветка заперта под
    # #if defined(__EMSCRIPTEN__) — её поведение не меняется.
    if(EMSCRIPTEN)
        set(R2D_RMLUI_PATCH
            "${CMAKE_SOURCE_DIR}/third_party/patches/rmlui-webgpu.patch")
        set(_r2d_rmlui_backend
            "${R2D_RMLUI_BACKENDS_DIR}/RmlUi_Renderer_SDL_GPU.cpp")
        file(READ "${_r2d_rmlui_backend}" _r2d_rmlui_backend_text LIMIT 262144)
        # Маркер — из последней правки патча. Если его нет, файл либо чистый,
        # либо остался с прошлой версией патча: в обоих случаях возвращаем его
        # к состоянию из репозитория RmlUi и накладываем патч заново.
        if(NOT _r2d_rmlui_backend_text MATCHES "r2d: освобождать transfer-буфер")
            if(NOT EXISTS "${R2D_RMLUI_PATCH}")
                message(FATAL_ERROR "нет файла патча ${R2D_RMLUI_PATCH}")
            endif()
            execute_process(
                COMMAND git checkout -- Backends/RmlUi_Renderer_SDL_GPU.cpp
                WORKING_DIRECTORY "${RmlUi_SOURCE_DIR}"
                RESULT_VARIABLE _r2d_restore_rc
                ERROR_VARIABLE _r2d_restore_err)
            if(NOT _r2d_restore_rc EQUAL 0)
                message(FATAL_ERROR
                    "не удалось вернуть ${_r2d_rmlui_backend} к исходному виду: "
                    "${_r2d_restore_err}")
            endif()
            execute_process(
                COMMAND git apply "${R2D_RMLUI_PATCH}"
                WORKING_DIRECTORY "${RmlUi_SOURCE_DIR}"
                RESULT_VARIABLE _r2d_patch_rc
                OUTPUT_VARIABLE _r2d_patch_out
                ERROR_VARIABLE _r2d_patch_err)
            if(NOT _r2d_patch_rc EQUAL 0)
                message(FATAL_ERROR
                    "патч не лёг на RmlUi (${RmlUi_SOURCE_DIR}): ${_r2d_patch_err}\n"
                    "Скорее всего сместился пин RmlUi — обновите "
                    "third_party/patches/rmlui-webgpu.patch")
            endif()
            message(STATUS "[rmlui] применён патч для WebGPU (WGSL + порядок заливки)")
        else()
            message(STATUS "[rmlui] патч для WebGPU уже применён")
        endif()
    endif()
endif()

# ---------------------------------------------------------------------------
# Dear ImGui — отладочный оверлей
# ---------------------------------------------------------------------------
if(R2D_ENABLE_IMGUI)
    # У upstream-репозитория ImGui нет своего CMakeLists.txt. Пустой
    # SOURCE_SUBDIR заставляет FetchContent только скачать исходники.
    # Глубокий клон обязателен: пин указывает на коммит ветки `docking`, а
    # shallow-клон главной ветки его не содержит — checkout падает с
    # «reference is not a tree». На машине, где _deps уже был, ошибка не
    # видна; в чистом контейнере или CI она есть.
    FetchContent_Declare(imgui
        GIT_REPOSITORY https://github.com/ocornut/imgui.git
        GIT_TAG        64944b4520b30772de8dbf0b37d0311746477a32  # docking
        GIT_SHALLOW    FALSE
        SOURCE_SUBDIR  "cmake/нет-здесь-CMakeLists")
    FetchContent_MakeAvailable(imgui)
endif()

# ---------------------------------------------------------------------------
# visibility — полигоны видимости (header-only C++, MIT)
#
# Внутри библиотеки всё в namespace geometry, заголовки лежат в подкаталоге
# visibility/ (visibility/visibility.hpp, vector2.hpp, primitives.hpp,
# floats.hpp). Коммит — вершина master на момент подключения; API стабилен,
# проект давно не обновлялся, поэтому фиксируем именно его.
#
# У репозитория свой CMakeLists.txt, который собирает static-библиотеку и
# тесты на Catch. Нам нужны только заголовки, поэтому несуществующий
# SOURCE_SUBDIR отключает add_subdirectory — как у ImGui выше. CMake-таргет
# оформляет cmake/Light.cmake.
# ---------------------------------------------------------------------------
FetchContent_Declare(visibility
    GIT_REPOSITORY https://github.com/trylock/visibility.git
    GIT_TAG        71eb5c00692713abd870113f3efc943322486d8e  # master
    GIT_SHALLOW    TRUE
    SOURCE_SUBDIR  "cmake/нет-здесь-CMakeLists")
FetchContent_MakeAvailable(visibility)

# ---------------------------------------------------------------------------
# stb_truetype — растеризатор глифов для текста в сцене (src/font.c).
#
# Зачем своя зависимость, если stb уже лежит внутри ImGui. ImGui подключает
# свою копию со стандартным stb-двойным включением (реализация — только в
# imgui_draw.cpp). Если движок определит STB_TRUETYPE_IMPLEMENTATION и
# подключит ту же копию, символы продублируются на линковке. Поэтому берём
# оригинальный заголовок из отдельного репозитория: у него свой guard, и он
# не конфликтует с копией ImGui.
#
# Версия 1.26 — та же, что внутри ImGui, так что метрики совпадают.
# ---------------------------------------------------------------------------
FetchContent_Declare(stb
    GIT_REPOSITORY https://github.com/nothings/stb.git
    GIT_TAG        2c980bb59875b0d32144a71867fbdebb2f77cd20  # master, stb_truetype 1.26
    GIT_SHALLOW    TRUE
    SOURCE_SUBDIR  "cmake/нет-здесь-CMakeLists")
FetchContent_MakeAvailable(stb)

# Интерфейсный таргет только с путём к заголовкам: сборку stb не проверяем
# строгими предупреждениями движка — чужой код.
add_library(r2d_stb INTERFACE)
target_include_directories(r2d_stb SYSTEM INTERFACE "${stb_SOURCE_DIR}")
