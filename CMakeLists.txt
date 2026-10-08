cmake_minimum_required(VERSION 3.24)

project(russiano2d
    VERSION 0.1.21
    DESCRIPTION "Легковесный кроссплатформенный 2D-движок: SDL3 + SDL_GPU, QuickJS-ng, Box2D v3, RmlUi, экспорт в веб (WebGPU)"
    LANGUAGES C CXX)
# Бинарник ищет библиотеки рядом с собой: если что-то осталось динамическим,
# пакет всё равно переносим (lib/ рядом с исполняемым файлом).
set(R2D_RPATH "")
if(APPLE)
    set(R2D_RPATH "@loader_path/lib")
elseif(UNIX)
    set(R2D_RPATH "$ORIGIN/lib")
endif()
if(R2D_RPATH)
    set(CMAKE_INSTALL_RPATH "${R2D_RPATH}")
    set(CMAKE_BUILD_WITH_INSTALL_RPATH TRUE)
endif()

# DT_RPATH вместо DT_RUNPATH: старый формат применяется и к транзитивным
# зависимостям, поэтому libfreetype из пакета находит свои libpng и
# libbrotlidec рядом с собой. С RUNPATH они остаются «not found».
#
# Условие строго по целевой системе: у MinGW-линкера такой опции нет, и он
# падает с «unrecognized option '--disable-new-dtags'».
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    add_link_options("-Wl,--disable-new-dtags")
endif()


# ---------------------------------------------------------------------------
# Стандарты и глобальные настройки
# ---------------------------------------------------------------------------
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Debug CACHE STRING "Тип сборки" FORCE)
    set_property(CACHE CMAKE_BUILD_TYPE PROPERTY STRINGS Debug Release RelWithDebInfo MinSizeRel)
endif()

option(R2D_ENABLE_IMGUI   "Собрать отладочный оверлей Dear ImGui"      ON)
option(R2D_ENABLE_RMLUI   "Собрать игровой GUI на RmlUi"               ON)
option(R2D_ENABLE_AUDIO   "Собрать звук и музыку на SDL3_mixer"        ON)
option(R2D_ENABLE_NET     "Собрать сеть на SDL3_net (только авторитарная)" ON)
option(R2D_ENABLE_HOTRELOAD "Следить за .js файлами и перезапускать VM" ON)
option(R2D_EMBED_SCRIPTS  "Встроить скрипты в бинарник байткодом QuickJS (релиз)" OFF)
set(R2D_EMBED_DIR "game" CACHE STRING
    "Каталог игры, скрипты которой встраиваются при R2D_EMBED_SCRIPTS=ON (например demos)")
option(R2D_SANITIZE       "Включить ASan/UBSan (только для Debug)"      OFF)

if(R2D_SANITIZE AND NOT MSVC)
    add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer)
    add_link_options(-fsanitize=address,undefined)
endif()

# Windows: bcrypt нужна для BCryptGenRandom (MSVC подключает её pragma'ой,
# MinGW — нет), ws2_32 — для сокетов в src/http.c (WSAStartup, select,
# closesocket). Без них линковка падает с undefined reference.
if(WIN32)
    # Рантайм MinGW статически: иначе .exe требует libstdc++-6.dll и
    # libgcc_s_seh-1.dll, которых на чистой Windows нет.
    add_link_options(-static-libgcc -static-libstdc++)
    set(R2D_WIN_LIBS bcrypt ws2_32)
else()
    set(R2D_WIN_LIBS "")
endif()

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

# Веб-сборка (Emscripten) включается ДО зависимостей: она решает, какие
# подсистемы собирать и в каком виде готовить шейдеры (см. cmake/Web.cmake).
include(Web)

include(Dependencies)
include(Light)      # полигоны видимости (trylock/visibility)
include(Shaders)
include(Icons)
include(EmbedJs)   # высокоуровневое API ($) внутри бинарника

add_subdirectory(src)
# C-тесты (json/crypto/payload/bsp/…) — хостовые: в веб-сборке их место занимает
# дымовой прогон страницы в браузере (tests/web/README.md).
if(NOT EMSCRIPTEN)
    add_subdirectory(tests)
    # Нативный бэкенд SDK (r2d-sdk): отдельный CLI-бинарник, не часть игры.
    add_subdirectory(sdk/native)
endif()

message(STATUS "")
message(STATUS "── russiano2d ${PROJECT_VERSION} ──────────────────────────────")
message(STATUS "  Тип сборки ...... ${CMAKE_BUILD_TYPE}")
message(STATUS "  Dear ImGui ...... ${R2D_ENABLE_IMGUI}")
message(STATUS "  RmlUi ........... ${R2D_ENABLE_RMLUI}")
message(STATUS "  Звук ............ ${R2D_ENABLE_AUDIO}")
message(STATUS "  Сеть ............ ${R2D_ENABLE_NET}")
message(STATUS "  Hot reload ...... ${R2D_ENABLE_HOTRELOAD}")
message(STATUS "  Байткод скриптов  ${R2D_EMBED_SCRIPTS}")
message(STATUS "───────────────────────────────────────────────────────────")
