cmake_minimum_required(VERSION 3.24)

project(russiano2d
    VERSION 1.2.5
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

# --- MSVC: обход внутренней ошибки компилятора ------------------------------
# На windows-2022 (MSVC 14.44.35207) сборка Release падает не на нашем коде, а
# внутренней ошибкой компилятора: «INTERNAL COMPILER ERROR in CL.exe»
# (код 0xE06D7363) в фазе кодогенерации проекта russiano2d, стек — через
# CloseTypeServerPDB, то есть через общий PDB-сервер типов, который CL держит
# при /Zi. Ошибка появилась между v0.1.31 и v0.1.32 и валит весь Windows-джоб;
# проверено, что /Zf и отключение /MP её НЕ лечат, поэтому убираем сам сервер
# типов: /Z7 кладёт отладочную информацию в .obj, общего PDB-сервера нет.
# Цена — крупнее объектные файлы на Windows; Release-оптимизация не меняется.
# Флаг только для MSVC: остальные платформы собираются как раньше.
if(MSVC)
    add_compile_options(/Z7)
endif()

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Debug CACHE STRING "Тип сборки" FORCE)
    set_property(CACHE CMAKE_BUILD_TYPE PROPERTY STRINGS Debug Release RelWithDebInfo MinSizeRel)
endif()

option(R2D_BUNDLED_FREETYPE "Build FreeType for target architecture" OFF)
option(R2D_ENABLE_RMLUI   "Собрать игровой GUI на RmlUi"               ON)
option(R2D_ENABLE_AUDIO   "Собрать звук и музыку на SDL3_mixer"        ON)
option(R2D_ENABLE_NET     "Собрать сеть на SDL3_net (только авторитарная)" ON)
option(R2D_ENABLE_HOTRELOAD "Следить за .js файлами и перезапускать VM" ON)
option(R2D_EMBED_SCRIPTS  "Встроить скрипты в бинарник байткодом QuickJS (релиз)" OFF)
set(R2D_EMBED_DIR "game" CACHE STRING
    "Каталог игры, скрипты которой встраиваются при R2D_EMBED_SCRIPTS=ON (например demos)")
option(R2D_SANITIZE       "Включить ASan/UBSan (только для Debug)"      OFF)
# Тестовая ловля UB «освободил и прочитал»: в пути загрузки картинки пиксели
# затираются ПЕРЕД SDL_DestroySurface, поэтому такой UB проявляется
# детерминированно, а не «иногда работает на освобождённой памяти». В обычной
# сборке выключено и не стоит ничего: код под #if (docs/TESTING.md).
option(R2D_TEST_FREE_POISON "Затирать пиксели перед освобождением поверхности (тесты, OFF)" OFF)
# Tracy — профайлер реального времени для разработки (BSD-3-Clause). По
# умолчанию OFF: релизная сборка не тянет Tracy вообще. Подключение — в
# cmake/Tracy.cmake, что видно и чего не видно — docs/BUILD.md.
option(R2D_TRACY          "Подключить профайлер реального времени Tracy (только для разработки)" OFF)

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

# --- RE2D: необязательный слой 3D-авторинга спрайтов -------------------------
# Опция объявлена здесь, а не в src/CMakeLists.txt, потому что от неё зависит
# и сборка высокоуровневого API (cmake/EmbedJs.cmake, include ниже): при OFF
# из бинарника убираются исходники 3D-модулей $ — их нечем обслужить.
option(R2D_ENABLE_RE2D "Собрать RE2D: 3D-авторинг спрайтов, Re2D World, RotSprite" ON)
# ВАЖНО: модули $ встраиваются в бинарник ЦЕЛИКОМ в обеих конфигурациях.
# api.js импортирует их статически (ES-модули, а не ленивая загрузка), поэтому
# исключение файла из таблицы модулей ломает загрузку `$` целиком — проверено
# сборкой: игра падала с «$ is not defined». Необязательность RE2D обеспечивает
# не отсутствие JS-файлов, а гейт возможностей (api.js: re2dAvailable) по
# нативным биндингам: в сборке без RE2D модули просто не устанавливаются.
set(R2D_JS_EXCLUDE "" CACHE STRING "JS-модули $, не встраиваемые в эту сборку" FORCE)

# Веб-сборка (Emscripten) включается ДО зависимостей: она решает, какие
# подсистемы собирать и в каком виде готовить шейдеры (см. cmake/Web.cmake).
include(Web)

include(Dependencies)
include(Light)      # полигоны видимости (trylock/visibility)
include(Shaders)
include(Icons)
include(EmbedJs)   # высокоуровневое API ($) внутри бинарника

enable_testing()

add_subdirectory(src)
# C-тесты (json/crypto/payload/bsp/…) — хостовые: в веб-сборке их место занимает
# дымовой прогон страницы в браузере (tests/web/README.md).
if(NOT EMSCRIPTEN)
    add_subdirectory(tests)
    # Нативный бэкенд SDK (r2d-sdk): отдельный CLI-бинарник, не часть игры.
    add_subdirectory(sdk/native)

    # P0-H: единый нативный gate. `ctest` — истина, `r2d_check` — короткая
    # команда из roadmap §82/§107 (собирает тесты и сразу гоняет CTest).
    add_test(NAME r2d_sdk_batch
             COMMAND r2d-sdk batch "${CMAKE_SOURCE_DIR}/tests/fixtures/sdk/ci.batch.json"
                     --output "${CMAKE_BINARY_DIR}/sdk-ci-report.json"
             WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}")
    add_custom_target(r2d_check
        COMMAND "${CMAKE_CTEST_COMMAND}" --output-on-failure
        DEPENDS r2d_json_test r2d_crypto_test r2d_payload_test r2d_reverb_test
                r2d_audio_fx_test r2d_profile_test r2d_bsp_test
                r2d_re2d_test r2d_rotsprite_test r2d_re2d_world_test
                r2d_re2d_atlas_test r2d_world_trace_test r2d_world_mover_test r2d_world_trigger_test r2d_world_controller_test r2d_world_render_features_test r2d_re2d_semantic_test r2d_re2d_portal_test r2d_world_metadata_test r2d_world_automap_test r2d_world_particle_test r2d_world_nav_test r2d_world_secret_test r2d_world_terrain_test r2d_world_save_test r2d_world_portal_visual_test r2d_world_volume_test r2d_world_material_anim_test r2d_world_polywall_test r2d_world_polygon_test r2d_world_vfx_test r2d_world_region_test r2d_sdk_brush_test r2d_world_tools_test r2d_postprocess_test r2d_audio_zone_test r2d_audio_voices_test r2d_world_exr_test
                r2d_sdk_core_test r2d_sdk_world_compile_test
                r2d-sdk
        COMMENT "r2d_check: Unity C tests + QuickJS tests + SDK batch (CTest)"
        VERBATIM)
endif()

# Tracy подключается после цели движка: он линкуется в russiano2d, а не в
# SDK и хостовые тесты. При R2D_TRACY=OFF (по умолчанию) файл выходит сразу.
include(Tracy)

# zstd (BSD-3) — сжатие груза игры; тоже после цели движка и своим файлом,
# чтобы не пересекаться правками в cmake/Dependencies.cmake (см. cmake/Zstd.cmake).
include(Zstd)

message(STATUS "")
message(STATUS "── russiano2d ${PROJECT_VERSION} ──────────────────────────────")
message(STATUS "  Тип сборки ...... ${CMAKE_BUILD_TYPE}")
message(STATUS "  RmlUi ........... ${R2D_ENABLE_RMLUI}")
message(STATUS "  RE2D ............ ${R2D_ENABLE_RE2D}")
message(STATUS "  Звук ............ ${R2D_ENABLE_AUDIO}")
message(STATUS "  Сеть ............ ${R2D_ENABLE_NET}")
message(STATUS "  Hot reload ...... ${R2D_ENABLE_HOTRELOAD}")
message(STATUS "  Байткод скриптов  ${R2D_EMBED_SCRIPTS}")
message(STATUS "  Tracy ........... ${R2D_TRACY}")
message(STATUS "───────────────────────────────────────────────────────────")
