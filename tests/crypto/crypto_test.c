// Проверка криптоядра тест-векторами RFC 8439.
#include "crypto.h"
#include "unity.h"
#include <stdio.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static int run_suite(void)
{
    const int rc = r2d_crypto_selftest();
    printf("ChaCha20-Poly1305 самотест: %s (код %d)\n",
           rc == 0 ? "  ok   все три вектора RFC 8439 сошлись" : "  FAIL вектор не сошёлся", rc);
    if (rc != 0) return 1;

    // Круговой прогон на «случайном» грузе разной длины + побайтовая проверка.
    uint8_t key[32], nonce[12];
    if (!r2d_random_bytes(key, sizeof key) || !r2d_random_bytes(nonce, sizeof nonce)) {
        printf("  FAIL нет источника случайных байтов\n");
        return 1;
    }
    int checked = 0;
    for (size_t len = 0; len <= 300; ++len) {
        uint8_t plain[320], cipher[320], back[320], tag[16];
        for (size_t i = 0; i < len; ++i) plain[i] = (uint8_t)(i * 7 + len);
        r2d_aead_encrypt(key, nonce, (const uint8_t *)"ad", 2, plain, len, cipher, tag);
        if (!r2d_aead_decrypt(key, nonce, (const uint8_t *)"ad", 2, cipher, len, back, tag)) {
            printf("  FAIL расшифровка не прошла при len=%zu\n", len);
            return 1;
        }
        if (len && memcmp(plain, back, len) != 0) {
            printf("  FAIL данные не совпали при len=%zu\n", len);
            return 1;
        }
        // Шифртекст не должен совпадать с открытым текстом.
        if (len > 8 && memcmp(plain, cipher, len) == 0) {
            printf("  FAIL шифртекст равен открытому тексту при len=%zu\n", len);
            return 1;
        }
        checked++;
    }
    printf("  ok   круговой прогон: %d длин от 0 до 300 байт, все сошлись\n", checked);
    return 0;
}

// Unity: весь старый прогон — один тест-кейс (assert'ы внутри проверяют
// код возврата; на первом провале Unity останавливает кейс).
static void test_crypto_suite(void)
{
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, run_suite(),
        "ChaCha20-Poly1305: RFC 8439 и круговой прогон 0..300 байт");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_crypto_suite);
    return UNITY_END();
}
