# ---------------------------------------------------------------------------
# Небольшие тесты на C: то, что должно проверяться без запуска окна.
#
# r2d_json_test собирается с AddressSanitizer (если компилятор его умеет):
# именно он поймал переполнение кучи в разборе JSON, из-за которого движок
# падал на командах агента.
#
# Санитайзеры выключаются при кросс-сборке: у MinGW нет libasan/libubsan, и
# линковка падает с «cannot find -lasan» — а сами тесты под Windows всё равно
# запускаются на Windows, где санитайзеры можно включить отдельной сборкой.
# ---------------------------------------------------------------------------

set(R2D_SANITIZE_FLAGS_AVAILABLE TRUE)

# RotSprite: математика и границы буфера, без GPU и окна.
add_executable(r2d_rotsprite_test rotsprite/rotsprite_test.c "${CMAKE_SOURCE_DIR}/src/rotsprite_math.c")
target_include_directories(r2d_rotsprite_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
if(NOT MSVC)
    target_link_libraries(r2d_rotsprite_test PRIVATE m)
endif()
if(NOT MSVC AND NOT CMAKE_CROSSCOMPILING)
    target_compile_options(r2d_rotsprite_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_rotsprite_test PRIVATE -fsanitize=address,undefined)
endif()
if(MSVC OR CMAKE_CROSSCOMPILING)
    set(R2D_SANITIZE_FLAGS_AVAILABLE FALSE)
endif()

# Re2D: проекция, отсечение по ближней плоскости, обход граней и туман —
# чистая математика (src/re2d_math.c), без окна и GPU.
add_executable(r2d_re2d_test re2d/re2d_test.c "${CMAKE_SOURCE_DIR}/src/re2d_math.c")
target_include_directories(r2d_re2d_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
if(NOT MSVC)
    target_link_libraries(r2d_re2d_test PRIVATE m)
endif()
if(NOT MSVC AND NOT CMAKE_CROSSCOMPILING)
    target_compile_options(r2d_re2d_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_re2d_test PRIVATE -fsanitize=address,undefined)
endif()

add_executable(r2d_json_test json/json_test.c "${CMAKE_SOURCE_DIR}/src/json.c")
target_include_directories(r2d_json_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_json_test PRIVATE ${R2D_WIN_LIBS})

if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_json_test PRIVATE -fsanitize=address -g -fno-omit-frame-pointer)
    target_link_options(r2d_json_test PRIVATE -fsanitize=address)
endif()

add_custom_target(r2d_json_check
    COMMAND r2d_json_test
    DEPENDS r2d_json_test
    COMMENT "Проверяю разбор и сборку JSON"
    VERBATIM)

# --- Шифрование груза --------------------------------------------------------
# Тест-векторы RFC 8439: ChaCha20-Poly1305 не должен «почти работать» —
# молча неверный шифр хуже отсутствия шифра. Собирается с санитайзерами,
# потому что вся арифметика Poly1305 — ручная работа с 32-битными лимбами.
add_executable(r2d_crypto_test "${CMAKE_SOURCE_DIR}/tests/crypto/crypto_test.c"
                               "${CMAKE_SOURCE_DIR}/src/crypto.c")
target_include_directories(r2d_crypto_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_crypto_test PRIVATE ${R2D_WIN_LIBS})
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_crypto_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_crypto_test PRIVATE -fsanitize=address,undefined)
endif()

# --- Разбор груза игры -------------------------------------------------------
# Контейнер разбирается из памяти, поэтому тесту достаточно SDL; crypto.c нужен
# для символов расшифровки, которые тянет payload.c. Санитайзеры обязательны:
# именно здесь двойное освобождение и выход за границу буфера.
add_executable(r2d_payload_test "${CMAKE_SOURCE_DIR}/tests/payload/payload_test.c"
                                "${CMAKE_SOURCE_DIR}/src/payload.c"
                                "${CMAKE_SOURCE_DIR}/src/crypto.c")
target_include_directories(r2d_payload_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_payload_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS})
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_payload_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_payload_test PRIVATE -fsanitize=address,undefined)
endif()

# --- Реверберация помещения (Freeverb) --------------------------------------
# На разнице хвоста держится звук «комната 5×5 против зала 20×20», поэтому
# проверяем именно её, а не факт вызова функции. Санитайзеры — как у crypto:
# вся работа идёт с кольцевыми буферами вручную.
add_executable(r2d_reverb_test "${CMAKE_SOURCE_DIR}/tests/audio/reverb_test.c"
                               "${CMAKE_SOURCE_DIR}/src/audio_reverb.c")
target_include_directories(r2d_reverb_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_reverb_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS})
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_reverb_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_reverb_test PRIVATE -fsanitize=address,undefined)
endif()

# --- DSP-эффекты каналов и шин ----------------------------------------------
# Фильтры, тремоло, bitcrush, кольцевая модуляция и реверб-шина с посылом:
# математика без SDL_mixer, поэтому проверяется офлайн, вместе с ревербом.
add_executable(r2d_audio_fx_test "${CMAKE_SOURCE_DIR}/tests/audio/fx_test.c"
                               "${CMAKE_SOURCE_DIR}/src/audio_fx.c"
                               "${CMAKE_SOURCE_DIR}/src/audio_reverb.c")
target_include_directories(r2d_audio_fx_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_audio_fx_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS})
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_audio_fx_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_audio_fx_test PRIVATE -fsanitize=address,undefined)
endif()

# --- Профайлер кадра ---------------------------------------------------------
# Модель строк (сначала CPU-зоны, затем GPU) и тихий фолбэк без GPU-устройства.
# Профайлеру хватает таймеров и потоков SDL: GPU-устройство не нужно, поэтому
# тест идёт в общем наборе, без окна и драйвера.
add_executable(r2d_profile_test "${CMAKE_SOURCE_DIR}/tests/profile/profile_test.c"
                                "${CMAKE_SOURCE_DIR}/src/profile.c")
target_include_directories(r2d_profile_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_profile_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS})
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_profile_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_profile_test PRIVATE -fsanitize=address,undefined)
endif()

# --- 2D BSP-дерево -----------------------------------------------------------
# Инвариант полноты: обход обязан вернуть каждый отрезок дерева ровно один раз.
# Ловит случай предельной глубины, когда остаток геометрии «сваливался» в лист
# и пропадал из порядка отрисовки.
add_executable(r2d_bsp_test "${CMAKE_SOURCE_DIR}/tests/bsp/bsp_test.c"
                            "${CMAKE_SOURCE_DIR}/src/bsp.c")
target_include_directories(r2d_bsp_test PRIVATE "${CMAKE_SOURCE_DIR}/src")
target_link_libraries(r2d_bsp_test PRIVATE SDL3::SDL3 ${R2D_WIN_LIBS})
if(R2D_SANITIZE_FLAGS_AVAILABLE)
    target_compile_options(r2d_bsp_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_bsp_test PRIVATE -fsanitize=address,undefined)
endif()
