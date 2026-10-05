// ===========================================================================
// ChaCha20-Poly1305 (RFC 8439). См. src/crypto.h — там же про границы защиты.
//
// Реализация намеренно простая и «по букве» стандарта: важнее совпадение с
// тест-векторами, чем скорость. Poly1305 считается на 32-битных лимбах
// (переносимо, без __int128), ChaCha20 — четвертьраундами по RFC.
// ===========================================================================
#include "crypto.h"

#include <string.h>

#ifdef _WIN32
#include <windows.h>
#include <bcrypt.h>
#else
#include <stdio.h>
#endif

// ---------------------------------------------------------------------------
// Вспомогательное
// ---------------------------------------------------------------------------

#define ROTL32(v, c) ((uint32_t)(((v) << (c)) | ((v) >> (32 - (c)))))

void r2d_secure_zero(void *data, size_t len)
{
    if (!data || len == 0) return;
    volatile uint8_t *p = (volatile uint8_t *)data;
    while (len--) *p++ = 0;
}

static uint32_t load32_le(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static void store32_le(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v);
    p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16);
    p[3] = (uint8_t)(v >> 24);
}

static void store64_le(uint8_t *p, uint64_t v)
{
    for (int i = 0; i < 8; ++i) p[i] = (uint8_t)(v >> (8 * i));
}

// ---------------------------------------------------------------------------
// ChaCha20
// ---------------------------------------------------------------------------

static void chacha20_quarter_round(uint32_t *a, uint32_t *b, uint32_t *c, uint32_t *d)
{
    *a += *b; *d ^= *a; *d = ROTL32(*d, 16);
    *c += *d; *b ^= *c; *b = ROTL32(*b, 12);
    *a += *b; *d ^= *a; *d = ROTL32(*d, 8);
    *c += *d; *b ^= *c; *b = ROTL32(*b, 7);
}

static void chacha20_block_words(const uint8_t key[R2D_KEY_SIZE],
                                 const uint8_t nonce[R2D_NONCE_SIZE],
                                 uint32_t counter, uint32_t out[16])
{
    // «Константы расширения» — первые 16 байт слова "expand 32-byte k".
    static const uint32_t sigma[4] = {
        0x61707865u, 0x3320646eu, 0x79622d32u, 0x6b206574u
    };

    uint32_t state[16];
    state[0] = sigma[0];
    state[1] = sigma[1];
    state[2] = sigma[2];
    state[3] = sigma[3];
    for (int i = 0; i < 8; ++i) state[4 + i] = load32_le(key + i * 4);
    state[12] = counter;
    state[13] = load32_le(nonce + 0);
    state[14] = load32_le(nonce + 4);
    state[15] = load32_le(nonce + 8);

    uint32_t x[16];
    memcpy(x, state, sizeof x);

    for (int i = 0; i < 10; ++i) {
        // Столбцы, затем диагонали — «двойной раунд».
        chacha20_quarter_round(&x[0], &x[4], &x[8],  &x[12]);
        chacha20_quarter_round(&x[1], &x[5], &x[9],  &x[13]);
        chacha20_quarter_round(&x[2], &x[6], &x[10], &x[14]);
        chacha20_quarter_round(&x[3], &x[7], &x[11], &x[15]);

        chacha20_quarter_round(&x[0], &x[5], &x[10], &x[15]);
        chacha20_quarter_round(&x[1], &x[6], &x[11], &x[12]);
        chacha20_quarter_round(&x[2], &x[7], &x[8],  &x[13]);
        chacha20_quarter_round(&x[3], &x[4], &x[9],  &x[14]);
    }

    for (int i = 0; i < 16; ++i) out[i] = x[i] + state[i];
}

void r2d_chacha20_block(const uint8_t key[R2D_KEY_SIZE], const uint8_t nonce[R2D_NONCE_SIZE],
                        uint32_t counter, uint8_t out[64])
{
    uint32_t words[16];
    chacha20_block_words(key, nonce, counter, words);
    for (int i = 0; i < 16; ++i) store32_le(out + i * 4, words[i]);
}

void r2d_chacha20_xor(const uint8_t key[R2D_KEY_SIZE], const uint8_t nonce[R2D_NONCE_SIZE],
                      uint32_t counter, const uint8_t *in, size_t len, uint8_t *out)
{
    uint8_t stream[64];
    size_t offset = 0;

    while (offset < len) {
        r2d_chacha20_block(key, nonce, counter, stream);
        const size_t chunk = (len - offset) < 64 ? (len - offset) : 64;
        for (size_t i = 0; i < chunk; ++i) out[offset + i] = in[offset + i] ^ stream[i];
        offset += chunk;
        counter++;   // счётчик растёт по блокам, как требует стандарт
    }

    r2d_secure_zero(stream, sizeof stream);
}

// ---------------------------------------------------------------------------
// Poly1305
//
// Пять 26-битных лимбов: так произведение 130-битного аккумулятора и r
// укладывается в 64-битные промежуточные значения без __int128.
// ---------------------------------------------------------------------------

typedef struct {
    uint32_t r[5];
    uint32_t h[5];
    uint32_t pad[4];
    uint8_t  buffer[16];
    size_t   leftover;
    bool     final;
} Poly1305;

static void poly1305_init(Poly1305 *ctx, const uint8_t key[R2D_KEY_SIZE])
{
    ctx->r[0] = (uint32_t)((load32_le(key + 0)) & 0x3ffffff);
    ctx->r[1] = (uint32_t)((load32_le(key + 3) >> 2) & 0x3ffff03);
    ctx->r[2] = (uint32_t)((load32_le(key + 6) >> 4) & 0x3ffc0ff);
    ctx->r[3] = (uint32_t)((load32_le(key + 9) >> 6) & 0x3f03fff);
    ctx->r[4] = (uint32_t)((load32_le(key + 12) >> 8) & 0x00fffff);

    ctx->pad[0] = load32_le(key + 16);
    ctx->pad[1] = load32_le(key + 20);
    ctx->pad[2] = load32_le(key + 24);
    ctx->pad[3] = load32_le(key + 28);

    memset(ctx->h, 0, sizeof ctx->h);
    ctx->leftover = 0;
    ctx->final = false;
}

static void poly1305_blocks(Poly1305 *ctx, const uint8_t *m, size_t bytes)
{
    const uint32_t hibit = ctx->final ? 0u : (1u << 24);   // 2^128 в лимбах 26 бит
    const uint32_t r0 = ctx->r[0], r1 = ctx->r[1], r2 = ctx->r[2], r3 = ctx->r[3], r4 = ctx->r[4];
    const uint32_t s1 = r1 * 5, s2 = r2 * 5, s3 = r3 * 5, s4 = r4 * 5;

    uint32_t h0 = ctx->h[0], h1 = ctx->h[1], h2 = ctx->h[2], h3 = ctx->h[3], h4 = ctx->h[4];

    while (bytes >= 16) {
        h0 += load32_le(m + 0) & 0x3ffffff;
        h1 += (load32_le(m + 3) >> 2) & 0x3ffffff;
        h2 += (load32_le(m + 6) >> 4) & 0x3ffffff;
        h3 += (load32_le(m + 9) >> 6) & 0x3ffffff;
        h4 += (load32_le(m + 12) >> 8) | hibit;

        // (h * r) mod 2^130-5, разложенное по лимбам.
        uint64_t d0 = (uint64_t)h0 * r0 + (uint64_t)h1 * s4 + (uint64_t)h2 * s3 + (uint64_t)h3 * s2 + (uint64_t)h4 * s1;
        uint64_t d1 = (uint64_t)h0 * r1 + (uint64_t)h1 * r0 + (uint64_t)h2 * s4 + (uint64_t)h3 * s3 + (uint64_t)h4 * s2;
        uint64_t d2 = (uint64_t)h0 * r2 + (uint64_t)h1 * r1 + (uint64_t)h2 * r0 + (uint64_t)h3 * s4 + (uint64_t)h4 * s3;
        uint64_t d3 = (uint64_t)h0 * r3 + (uint64_t)h1 * r2 + (uint64_t)h2 * r1 + (uint64_t)h3 * r0 + (uint64_t)h4 * s4;
        uint64_t d4 = (uint64_t)h0 * r4 + (uint64_t)h1 * r3 + (uint64_t)h2 * r2 + (uint64_t)h3 * r1 + (uint64_t)h4 * r0;

        uint32_t c = (uint32_t)(d0 >> 26); h0 = (uint32_t)d0 & 0x3ffffff;
        d1 += c; c = (uint32_t)(d1 >> 26); h1 = (uint32_t)d1 & 0x3ffffff;
        d2 += c; c = (uint32_t)(d2 >> 26); h2 = (uint32_t)d2 & 0x3ffffff;
        d3 += c; c = (uint32_t)(d3 >> 26); h3 = (uint32_t)d3 & 0x3ffffff;
        d4 += c; c = (uint32_t)(d4 >> 26); h4 = (uint32_t)d4 & 0x3ffffff;
        h0 += c * 5;
        c = h0 >> 26;
        h0 &= 0x3ffffff;
        h1 += c;

        m += 16;
        bytes -= 16;
    }

    ctx->h[0] = h0;
    ctx->h[1] = h1;
    ctx->h[2] = h2;
    ctx->h[3] = h3;
    ctx->h[4] = h4;
}

static void poly1305_update(Poly1305 *ctx, const uint8_t *m, size_t bytes)
{
    if (ctx->leftover) {
        const size_t want = 16 - ctx->leftover;
        const size_t take = bytes < want ? bytes : want;
        memcpy(ctx->buffer + ctx->leftover, m, take);
        ctx->leftover += take;
        m += take;
        bytes -= take;
        if (ctx->leftover == 16) {
            poly1305_blocks(ctx, ctx->buffer, 16);
            ctx->leftover = 0;
        }
    }
    if (bytes >= 16) {
        const size_t full = bytes & ~(size_t)15;
        poly1305_blocks(ctx, m, full);
        m += full;
        bytes -= full;
    }
    if (bytes) {
        memcpy(ctx->buffer, m, bytes);
        ctx->leftover = bytes;
    }
}

static void poly1305_finish(Poly1305 *ctx, uint8_t tag[R2D_TAG_SIZE])
{
    if (ctx->leftover) {
        // Последний неполный блок дополняется единицей старшего разряда.
        ctx->buffer[ctx->leftover++] = 1;
        memset(ctx->buffer + ctx->leftover, 0, 16 - ctx->leftover);
        ctx->final = true;
        poly1305_blocks(ctx, ctx->buffer, 16);
        ctx->final = false;
    }

    uint32_t h0 = ctx->h[0], h1 = ctx->h[1], h2 = ctx->h[2], h3 = ctx->h[3], h4 = ctx->h[4];

    // Полная редукция по модулю 2^130-5.
    uint32_t c = h1 >> 26; h1 &= 0x3ffffff;
    h2 += c; c = h2 >> 26; h2 &= 0x3ffffff;
    h3 += c; c = h3 >> 26; h3 &= 0x3ffffff;
    h4 += c; c = h4 >> 26; h4 &= 0x3ffffff;
    h0 += c * 5; c = h0 >> 26; h0 &= 0x3ffffff;
    h1 += c;

    uint32_t g0 = h0 + 5; c = g0 >> 26; g0 &= 0x3ffffff;
    uint32_t g1 = h1 + c; c = g1 >> 26; g1 &= 0x3ffffff;
    uint32_t g2 = h2 + c; c = g2 >> 26; g2 &= 0x3ffffff;
    uint32_t g3 = h3 + c; c = g3 >> 26; g3 &= 0x3ffffff;
    uint32_t g4 = h4 + c - (1u << 26);

    // Если g не переполнилось, берём h, иначе — g.
    uint32_t mask = (g4 >> 31) - 1;       // 0xffffffff, если g подошло
    g0 &= mask; g1 &= mask; g2 &= mask; g3 &= mask; g4 &= mask;
    mask = ~mask;
    h0 = (h0 & mask) | g0;
    h1 = (h1 & mask) | g1;
    h2 = (h2 & mask) | g2;
    h3 = (h3 & mask) | g3;
    h4 = (h4 & mask) | g4;

    h0 = (h0 | (h1 << 26)) & 0xffffffff;
    h1 = ((h1 >> 6) | (h2 << 20)) & 0xffffffff;
    h2 = ((h2 >> 12) | (h3 << 14)) & 0xffffffff;
    h3 = ((h3 >> 18) | (h4 << 8)) & 0xffffffff;

    uint64_t f;
    f = (uint64_t)h0 + ctx->pad[0]; h0 = (uint32_t)f;
    f = (uint64_t)h1 + ctx->pad[1] + (f >> 32); h1 = (uint32_t)f;
    f = (uint64_t)h2 + ctx->pad[2] + (f >> 32); h2 = (uint32_t)f;
    f = (uint64_t)h3 + ctx->pad[3] + (f >> 32); h3 = (uint32_t)f;

    store32_le(tag + 0, h0);
    store32_le(tag + 4, h1);
    store32_le(tag + 8, h2);
    store32_le(tag + 12, h3);
}

void r2d_poly1305(const uint8_t key[R2D_KEY_SIZE], const uint8_t *msg, size_t len,
                  uint8_t tag[R2D_TAG_SIZE])
{
    Poly1305 ctx;
    poly1305_init(&ctx, key);
    poly1305_update(&ctx, msg, len);
    poly1305_finish(&ctx, tag);
    r2d_secure_zero(&ctx, sizeof ctx);
}

// ---------------------------------------------------------------------------
// AEAD (RFC 8439, раздел 2.8)
// ---------------------------------------------------------------------------

// Данные для MAC: aad || pad16 || cipher || pad16 || len(aad) || len(cipher).
// Считаем потоково, чтобы не выделять буфер размером с груз.
static void aead_compute_tag(Poly1305 *mac, const uint8_t *aad, size_t aad_len,
                             const uint8_t *cipher, size_t len)
{
    static const uint8_t zeros[16] = { 0 };

    if (aad_len) poly1305_update(mac, aad, aad_len);
    const size_t aad_pad = (16 - (aad_len & 15)) & 15;
    if (aad_pad) poly1305_update(mac, zeros, aad_pad);

    if (len) poly1305_update(mac, cipher, len);
    const size_t data_pad = (16 - (len & 15)) & 15;
    if (data_pad) poly1305_update(mac, zeros, data_pad);

    uint8_t lens[16];
    store64_le(lens + 0, (uint64_t)aad_len);
    store64_le(lens + 8, (uint64_t)len);
    poly1305_update(mac, lens, sizeof lens);

    r2d_secure_zero(lens, sizeof lens);
}

void r2d_aead_encrypt(const uint8_t key[R2D_KEY_SIZE], const uint8_t nonce[R2D_NONCE_SIZE],
                      const uint8_t *aad, size_t aad_len,
                      const uint8_t *plain, size_t len, uint8_t *cipher,
                      uint8_t tag[R2D_TAG_SIZE])
{
    // Одноразовый ключ MAC — первый блок потока с нулевым счётчиком.
    uint8_t otk[R2D_KEY_SIZE];
    uint8_t block0[64];
    r2d_chacha20_block(key, nonce, 0, block0);
    memcpy(otk, block0, R2D_KEY_SIZE);
    r2d_secure_zero(block0, sizeof block0);

    if (len) r2d_chacha20_xor(key, nonce, 1, plain, len, cipher);

    Poly1305 mac;
    poly1305_init(&mac, otk);
    aead_compute_tag(&mac, aad, aad_len, cipher, len);
    poly1305_finish(&mac, tag);

    r2d_secure_zero(&mac, sizeof mac);
    r2d_secure_zero(otk, sizeof otk);
}

bool r2d_aead_decrypt(const uint8_t key[R2D_KEY_SIZE], const uint8_t nonce[R2D_NONCE_SIZE],
                      const uint8_t *aad, size_t aad_len,
                      const uint8_t *cipher, size_t len, uint8_t *plain,
                      const uint8_t tag[R2D_TAG_SIZE])
{
    uint8_t otk[R2D_KEY_SIZE];
    uint8_t block0[64];
    r2d_chacha20_block(key, nonce, 0, block0);
    memcpy(otk, block0, R2D_KEY_SIZE);
    r2d_secure_zero(block0, sizeof block0);

    Poly1305 mac;
    poly1305_init(&mac, otk);
    aead_compute_tag(&mac, aad, aad_len, cipher, len);

    uint8_t expected[R2D_TAG_SIZE];
    poly1305_finish(&mac, expected);

    // Сравнение без раннего выхода: время проверки не должно зависеть от того,
    // на каком байте тег разошёлся.
    uint8_t diff = 0;
    for (int i = 0; i < R2D_TAG_SIZE; ++i) diff |= (uint8_t)(expected[i] ^ tag[i]);

    r2d_secure_zero(&mac, sizeof mac);
    r2d_secure_zero(otk, sizeof otk);
    r2d_secure_zero(expected, sizeof expected);

    if (diff != 0) return false;   // груз изменён — расшифровывать нельзя

    if (len) r2d_chacha20_xor(key, nonce, 1, cipher, len, plain);
    return true;
}

// ---------------------------------------------------------------------------
// Случайные байты
// ---------------------------------------------------------------------------

bool r2d_random_bytes(uint8_t *out, size_t len)
{
    if (!out || len == 0) return true;

#ifdef _WIN32
    if (BCryptGenRandom(NULL, out, (ULONG)len, BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) return false;
    return true;
#else
    FILE *f = fopen("/dev/urandom", "rb");
    if (!f) return false;
    const size_t got = fread(out, 1, len, f);
    fclose(f);
    return got == len;
#endif
}

// ---------------------------------------------------------------------------
// Самотест по тест-векторам RFC 8439
// ---------------------------------------------------------------------------

static bool bytes_equal(const uint8_t *a, const uint8_t *b, size_t n)
{
    uint8_t diff = 0;
    for (size_t i = 0; i < n; ++i) diff |= (uint8_t)(a[i] ^ b[i]);
    return diff == 0;
}

static void hex_to_bytes(const char *hex, uint8_t *out, size_t n)
{
    for (size_t i = 0; i < n; ++i) {
        unsigned hi = 0, lo = 0;
        const char c1 = hex[i * 2];
        const char c2 = hex[i * 2 + 1];
        hi = (c1 <= '9') ? (unsigned)(c1 - '0') : (unsigned)((c1 | 0x20) - 'a' + 10);
        lo = (c2 <= '9') ? (unsigned)(c2 - '0') : (unsigned)((c2 | 0x20) - 'a' + 10);
        out[i] = (uint8_t)((hi << 4) | lo);
    }
}

int r2d_crypto_selftest(void)
{
    // --- 1. Блок ChaCha20 (RFC 8439, 2.3.2) --------------------------------
    {
        uint8_t key[32], nonce[12], expect[64], got[64];
        hex_to_bytes("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", key, 32);
        hex_to_bytes("000000090000004a00000000", nonce, 12);
        hex_to_bytes("10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4e"
                     "d2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e", expect, 64);

        r2d_chacha20_block(key, nonce, 1, got);
        if (!bytes_equal(got, expect, 64)) return 1;
    }

    // --- 2. Poly1305 (RFC 8439, 2.5.2) -------------------------------------
    {
        uint8_t key[32], tag[16], expect[16];
        hex_to_bytes("85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b", key, 32);
        hex_to_bytes("a8061dc1305136c6c22b8baf0c0127a9", expect, 16);

        const char *msg = "Cryptographic Forum Research Group";
        r2d_poly1305(key, (const uint8_t *)msg, strlen(msg), tag);
        if (!bytes_equal(tag, expect, 16)) return 2;
    }

    // --- 3. AEAD целиком (RFC 8439, 2.8.2) ---------------------------------
    {
        uint8_t key[32], nonce[12], aad[12], tag[16], expect_tag[16];
        hex_to_bytes("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f", key, 32);
        hex_to_bytes("070000004041424344454647", nonce, 12);
        hex_to_bytes("50515253c0c1c2c3c4c5c6c7", aad, 12);
        hex_to_bytes("1ae10b594f09e26a7e902ecbd0600691", expect_tag, 16);

        const char *plain =
            "Ladies and Gentlemen of the class of '99: If I could offer you only one "
            "tip for the future, sunscreen would be it.";
        const size_t len = strlen(plain);

        uint8_t cipher[256];
        uint8_t back[256];

        r2d_aead_encrypt(key, nonce, aad, sizeof aad, (const uint8_t *)plain, len, cipher, tag);
        if (!bytes_equal(tag, expect_tag, 16)) return 3;

        if (!r2d_aead_decrypt(key, nonce, aad, sizeof aad, cipher, len, back, tag)) return 3;
        if (!bytes_equal(back, (const uint8_t *)plain, len)) return 3;

        // Испорченный груз обязан не расшифроваться.
        cipher[0] ^= 0x01;
        if (r2d_aead_decrypt(key, nonce, aad, sizeof aad, cipher, len, back, tag)) return 3;
        cipher[0] ^= 0x01;

        // Испорченный тег — тоже.
        uint8_t bad_tag[16];
        memcpy(bad_tag, tag, 16);
        bad_tag[7] ^= 0x80;
        if (r2d_aead_decrypt(key, nonce, aad, sizeof aad, cipher, len, back, bad_tag)) return 3;

        r2d_secure_zero(cipher, sizeof cipher);
        r2d_secure_zero(back, sizeof back);
    }

    return 0;
}
