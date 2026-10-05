// ===========================================================================
// Шифрование груза игры: ChaCha20-Poly1305 (RFC 8439).
//
// Зачем свой код, а не библиотека: движок не тянет внешних зависимостей, а
// качать криптобиблиотеку без разрешения владельца нельзя. ChaCha20-Poly1305
// выбран потому, что он проще для корректной реализации, чем AES-GCM (нет
// таблиц AES и GHASH), быстр на ARM и сразу даёт аутентификацию (AEAD):
// изменение хотя бы байта груза обнаруживается по тегу.
//
// ВАЖНО про защиту: это обфускация, а не защита от взлома. Ключ обязан лежать
// в исполняемом файле, поэтому настойчивый исследователь его достанет. Что
// даёт шифрование — стоимость копирования растёт с «перетащить папку» до
// «нужен отладчик и время». Настоящая защита логики — только на сервере.
//
// Корректность подтверждается тест-векторами RFC 8439 в r2d_crypto_selftest().
// ===========================================================================
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define R2D_KEY_SIZE   32
#define R2D_NONCE_SIZE 12
#define R2D_TAG_SIZE   16

// Блок ChaCha20: 64 байта потока для данного (ключ, счётчик, одноразовый номер).
void r2d_chacha20_block(const uint8_t key[R2D_KEY_SIZE], const uint8_t nonce[R2D_NONCE_SIZE],
                        uint32_t counter, uint8_t out[64]);

// Наложение потока ChaCha20 на данные (шифрование и расшифровка — одна операция).
void r2d_chacha20_xor(const uint8_t key[R2D_KEY_SIZE], const uint8_t nonce[R2D_NONCE_SIZE],
                      uint32_t counter, const uint8_t *in, size_t len, uint8_t *out);

// Poly1305: код аутентификации сообщения.
void r2d_poly1305(const uint8_t key[R2D_KEY_SIZE], const uint8_t *msg, size_t len,
                  uint8_t tag[R2D_TAG_SIZE]);

// AEAD: шифрует plain → cipher и считает тег. Буферы могут совпадать.
void r2d_aead_encrypt(const uint8_t key[R2D_KEY_SIZE], const uint8_t nonce[R2D_NONCE_SIZE],
                      const uint8_t *aad, size_t aad_len,
                      const uint8_t *plain, size_t len, uint8_t *cipher,
                      uint8_t tag[R2D_TAG_SIZE]);

// AEAD: проверяет тег и расшифровывает. false — груз повреждён или подменён
// (тогда в plain ничего осмысленного не остаётся).
bool r2d_aead_decrypt(const uint8_t key[R2D_KEY_SIZE], const uint8_t nonce[R2D_NONCE_SIZE],
                      const uint8_t *aad, size_t aad_len,
                      const uint8_t *cipher, size_t len, uint8_t *plain,
                      const uint8_t tag[R2D_TAG_SIZE]);

// Криптостойкие случайные байты (ключ сборки). false — источник недоступен.
bool r2d_random_bytes(uint8_t *out, size_t len);

// Затирает память так, чтобы компилятор не выбросил запись.
void r2d_secure_zero(void *data, size_t len);

// Проверка реализации тест-векторами RFC 8439. Возвращает 0, если всё сошлось,
// иначе — номер не прошедшей проверки (1..3). Используется и тестом, и при
// сборке: молча «почти работающий» шифр хуже отсутствия шифра.
int r2d_crypto_selftest(void);

#ifdef __cplusplus
}
#endif
