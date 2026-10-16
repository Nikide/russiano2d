# ---------------------------------------------------------------------------
# zstd (BSD-3, https://github.com/facebook/zstd) — сжатие груза игры.
#
# Отдельный файл, а не строка в cmake/Dependencies.cmake: Dependencies.cmake —
# общая точка, её одновременно правят несколько задач (Tracy, HRTF), а здесь
# зависимость одна и видно её целиком. Подключается из корневого CMakeLists.txt
# ПОСЛЕ add_subdirectory(src) — как Tracy: линковать можно только в уже
# существующую цель движка.
#
# Версия запинена КОММИТОМ, а не тегом: байты сжатого груза зависят от версии
# библиотеки, поэтому упаковка обязана быть воспроизводимой на всех машинах —
# иначе одинаковое дерево даёт разные SHA256 и гейт воспроизводимости падает.
# Тот же коммит в FetchContent означает, что CI, разработчик и релизная сборка
# кладут в груз одни и те же байты.
#
# R2D_ENABLE_ZSTD=OFF — сборка без zstd: билдер пишет груз ровно как раньше
# (заголовок версии 1, без сжатия), а чтение сжатого груза даёт понятную
# ошибку с кодом R2D_PAYLOAD_NO_ZSTD. Ничего не падает.
#
# Итог: INTERFACE-цель r2d_zstd (заголовки zstd, линковка и определение
# R2D_ENABLE_ZSTD=1), подключённая к russiano2d.
# ---------------------------------------------------------------------------

# Уровень сжатия — КОНСТАНТА формата, а не «умолчание библиотеки»: от неё
# зависят байты груза. То же число продублировано в src/payload.h
# (R2D_PAYLOAD_ZSTD_LEVEL) и проверяется тестом на воспроизводимость.
set(R2D_ZSTD_LEVEL 19 CACHE STRING "Уровень zstd для груза (меняет байты груза!)")

if(EMSCRIPTEN)
    # Веб-сборка: груз и так отдаётся одним .wasm/.data, а zstd тянет в wasm
    # лишний код. Сжатие включается осознанно: -DR2D_ENABLE_ZSTD=ON.
    option(R2D_ENABLE_ZSTD "Сжимать груз игры zstd" OFF)
else()
    option(R2D_ENABLE_ZSTD "Сжимать груз игры zstd" ON)
endif()
option(R2D_ZSTD_USE_SYSTEM "Взять системный zstd вместо запиненного (байты груза могут отличаться)" OFF)

# v1.5.7 — версия, на которой сняты числа в tests/agent/payload_compression_test.py.
set(R2D_ZSTD_TAG "ac66b19e6bd6b83238bf008eecc1298105298532" CACHE STRING "Коммит zstd (v1.5.7)")
set(R2D_ZSTD_VERSION "1.5.7" CACHE STRING "Версия zstd — для сообщений и отчётов")

if(NOT R2D_ENABLE_ZSTD)
    message(STATUS "  zstd ............ выключен (R2D_ENABLE_ZSTD=OFF): груз не сжимается")
    return()
endif()

if(NOT TARGET russiano2d)
    message(WARNING "zstd: цель russiano2d не найдена — include(Zstd) обязан идти после "
                    "add_subdirectory(src); сжатие груза не подключено")
    return()
endif()

add_library(r2d_zstd INTERFACE)
target_compile_definitions(r2d_zstd INTERFACE R2D_ENABLE_ZSTD=1)

if(R2D_ZSTD_USE_SYSTEM)
    find_path(R2D_ZSTD_INCLUDE_DIR zstd.h)
    find_library(R2D_ZSTD_LIBRARY NAMES zstd)
    if(NOT R2D_ZSTD_INCLUDE_DIR OR NOT R2D_ZSTD_LIBRARY)
        message(FATAL_ERROR "[deps] R2D_ZSTD_USE_SYSTEM=ON, но системный zstd не найден "
                            "(нужны zstd.h и libzstd)")
    endif()
    target_include_directories(r2d_zstd INTERFACE "${R2D_ZSTD_INCLUDE_DIR}")
    target_link_libraries(r2d_zstd INTERFACE "${R2D_ZSTD_LIBRARY}")
    message(STATUS "  zstd ............ системный: ${R2D_ZSTD_LIBRARY} "
                   "(версия не пинится — байты груза могут отличаться от релизных)")
else()
    include(FetchContent)

    # Собираем только статическую библиотеку и без программ/тестов: движку
    # нужны compress/decompress, всё остальное — лишнее время сборки.
    set(ZSTD_BUILD_PROGRAMS        OFF CACHE BOOL "" FORCE)
    set(ZSTD_BUILD_SHARED          OFF CACHE BOOL "" FORCE)
    set(ZSTD_BUILD_STATIC          ON  CACHE BOOL "" FORCE)
    set(ZSTD_BUILD_TESTS           OFF CACHE BOOL "" FORCE)
    set(ZSTD_BUILD_CONTRIB         OFF CACHE BOOL "" FORCE)
    set(ZSTD_LEGACY_SUPPORT        OFF CACHE BOOL "" FORCE)
    # Однопоточное сжатие — часть контракта воспроизводимости: многопоточный
    # режим режет вход на блоки, и результат зависит от их числа.
    set(ZSTD_MULTITHREAD_SUPPORT   OFF CACHE BOOL "" FORCE)

    FetchContent_Declare(zstd
        GIT_REPOSITORY https://github.com/facebook/zstd.git
        GIT_TAG        ${R2D_ZSTD_TAG}   # v${R2D_ZSTD_VERSION}
        GIT_SHALLOW    TRUE
        # У zstd CMake-проект лежит не в корне, а в build/cmake: без этого
        # FetchContent не находит CMakeLists.txt и цели библиотеки не создаются.
        SOURCE_SUBDIR  build/cmake)
    FetchContent_MakeAvailable(zstd)

    # Имя цели у zstd зависит от его собственного CMakeLists: в 1.5.x это
    # libzstd_static (плюс INTERFACE-цель libzstd). Не угадываем молча: если
    # цели нет — ошибка конфигурации с подсказкой, а не «сборка без сжатия».
    if(TARGET libzstd_static)
        target_link_libraries(r2d_zstd INTERFACE libzstd_static)
    elseif(TARGET zstd::libzstd_static)
        target_link_libraries(r2d_zstd INTERFACE zstd::libzstd_static)
    elseif(TARGET libzstd)
        target_link_libraries(r2d_zstd INTERFACE libzstd)
    else()
        message(FATAL_ERROR "[deps] zstd собран, но цель libzstd_static не найдена — "
                            "проверьте R2D_ZSTD_TAG (${R2D_ZSTD_TAG})")
    endif()
    message(STATUS "  zstd ............ v${R2D_ZSTD_VERSION} из исходников "
                   "(пин ${R2D_ZSTD_TAG}), уровень груза ${R2D_ZSTD_LEVEL}")
endif()

target_link_libraries(russiano2d PRIVATE r2d_zstd)
