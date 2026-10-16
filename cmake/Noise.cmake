# ---------------------------------------------------------------------------
# Комплект шумов (FastNoiseLite + тонкий C-фасад).
#
# Файл отдельный, чтобы не пересекаться правками с cmake/Tracy.cmake,
# cmake/Zstd.cmake и RmlUi: в src/CMakeLists.txt от него ровно одна строка —
# include(Noise) после add_executable.
#
# Цель — та же игра (russiano2d): шумы нужны и движку (биндинги), и игре.
# Заголовок FastNoiseLite вендорен целиком в third_party/fastnoise_lite и не
# патчится: его SHA-256 и пин записаны в README рядом с ним, а совпадение
# значений с апстримом проверяет tests/agent/noise_set_test.py.
# ---------------------------------------------------------------------------

if(NOT TARGET russiano2d)
    message(WARNING "Noise: цель russiano2d ещё не создана — include(Noise) "
                    "должен идти после add_executable(russiano2d ...)")
    return()
endif()

target_sources(russiano2d PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/noise.cpp")

target_include_directories(russiano2d PRIVATE
    "${CMAKE_SOURCE_DIR}/third_party/fastnoise_lite")
