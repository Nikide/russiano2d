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
if(MSVC OR CMAKE_CROSSCOMPILING)
    set(R2D_SANITIZE_FLAGS_AVAILABLE FALSE)
endif()

add_executable(r2d_json_test json/json_test.c "${CMAKE_SOURCE_DIR}/src/json.c")
target_include_directories(r2d_json_test PRIVATE "${CMAKE_SOURCE_DIR}/src")

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
