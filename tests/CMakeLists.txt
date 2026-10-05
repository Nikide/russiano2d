# ---------------------------------------------------------------------------
# Небольшие тесты на C: то, что должно проверяться без запуска окна.
#
# r2d_json_test собирается с AddressSanitizer (если компилятор его умеет):
# именно он поймал переполнение кучи в разборе JSON, из-за которого движок
# падал на командах агента.
# ---------------------------------------------------------------------------

add_executable(r2d_json_test json/json_test.c "${CMAKE_SOURCE_DIR}/src/json.c")
target_include_directories(r2d_json_test PRIVATE "${CMAKE_SOURCE_DIR}/src")

if(NOT MSVC)
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
if(NOT MSVC)
    target_compile_options(r2d_crypto_test PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(r2d_crypto_test PRIVATE -fsanitize=address,undefined)
endif()
