# ---------------------------------------------------------------------------
# visibility — полигоны видимости из точки среди отрезков-препятствий.
#
# Сам FetchContent с запиненным коммитом живёт в cmake/Dependencies.cmake —
# там собраны все зависимости проекта. Этот модуль только оформляет уже
# скачанные заголовки в CMake-таргет и отдаёт движку нужные пути:
#
#   visibility::visibility       — INTERFACE-таргет с каталогом заголовков
#                                  (<visibility/visibility.hpp> и т.д.)
#   R2D_VISIBILITY_INCLUDE_DIR  — тот же путь переменной (для ручной сборки
#                                  и подсказок компилятору)
#
# Библиотека header-only и собрана под C++14: её тесты и static-таргет нам не
# нужны, поэтому в Dependencies.cmake FetchContent вызывается с несуществующим
# SOURCE_SUBDIR и add_subdirectory не происходит.
# ---------------------------------------------------------------------------

if(NOT visibility_SOURCE_DIR)
    message(FATAL_ERROR
        "[light] visibility не скачана — проверь блок FetchContent в cmake/Dependencies.cmake")
endif()

add_library(r2d_visibility INTERFACE)
add_library(visibility::visibility ALIAS r2d_visibility)

# Заголовки сторонние, поэтому системными путями: иначе -Wall/-Wextra движка
# будут разбирать чужой код (библиотека писалась под C++14 и не рассчитана на
# строгие предупреждения).
target_include_directories(r2d_visibility SYSTEM INTERFACE "${visibility_SOURCE_DIR}")
target_compile_features(r2d_visibility INTERFACE cxx_std_14)

# Дополнительно кладём каталог в INCLUDE_DIRECTORIES каталога: корневой
# CMakeLists подключает Light.cmake до add_subdirectory(src), поэтому
# src/light.cpp увидит <visibility/visibility.hpp> даже без явного линка
# с visibility::visibility.
include_directories(SYSTEM "${visibility_SOURCE_DIR}")

set(R2D_VISIBILITY_INCLUDE_DIR "${visibility_SOURCE_DIR}"
    CACHE INTERNAL "Каталог заголовков visibility (trylock/visibility)")

# Исходник C++-обёртки — движку достаточно добавить его в список файлов
# (и при желании слинковать visibility::visibility).
set(R2D_LIGHT_SOURCE "${CMAKE_CURRENT_LIST_DIR}/../src/light.cpp")

message(STATUS "[light] visibility: ${visibility_SOURCE_DIR}")
