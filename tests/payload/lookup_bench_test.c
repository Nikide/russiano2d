// ===========================================================================
// Индекс путей груза (src/payload.c) — тест без окна.
//
// Закрывает требования §35:
//   * точный поиск идёт через хэш-индекс (O(1) в среднем), а не сканом;
//   * суффиксный fallback сохраняет СТАРУЮ семантику: точное совпадение
//     первым, затем совпадение на границе каталога, при нескольких
//     кандидатах — первый файл в порядке контейнера;
//   * на большом грузе не остаётся линейных fallback'ов;
//   * индекс освобождается вместе с грузом (ASan/LSan в CMake-цели).
//
// Собирается с AddressSanitizer/UBSan, как остальные C-тесты.
// ===========================================================================
#include "payload.h"
#include "unity.h"

#include <SDL3/SDL.h>

#include <string.h>

// Журнал движка (R2D_LOG в payload.c) смотрит на этот флаг.
bool r2d_log_stderr = false;

void setUp(void) {}
void tearDown(void) {}

static void put_u32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v & 0xff);
    p[1] = (uint8_t)((v >> 8) & 0xff);
    p[2] = (uint8_t)((v >> 16) & 0xff);
    p[3] = (uint8_t)((v >> 24) & 0xff);
}

// Строит контейнер v1: [magic][version][entry_len][entry][count][файлы…].
// Файлы — параллельные массивы; данные копируются ВНУТРЬ буфера, как в
// настоящем контейнере (тест не проверяет владение — это делает payload_test).
static R2dPayload *build_container(const char *const *paths, const char *const *data,
                                   int count)
{
    size_t size = 4 + 4 + 4 + 7 + 4;   // magic+version+entry_len+"main.js"+count
    for (int i = 0; i < count; ++i) {
        size += 4 + strlen(paths[i]) + 4 + strlen(data[i]);
    }
    uint8_t *buf = (uint8_t *)SDL_malloc(size);
    TEST_ASSERT_NOT_NULL(buf);
    size_t n = 0;
    put_u32(buf + n, R2D_PAYLOAD_MAGIC);   n += 4;
    put_u32(buf + n, R2D_PAYLOAD_VERSION); n += 4;
    put_u32(buf + n, 7);                   n += 4;
    memcpy(buf + n, "main.js", 7);         n += 7;
    put_u32(buf + n, (uint32_t)count);     n += 4;
    for (int i = 0; i < count; ++i) {
        const size_t plen = strlen(paths[i]);
        const size_t dlen = strlen(data[i]);
        put_u32(buf + n, (uint32_t)plen); n += 4;
        memcpy(buf + n, paths[i], plen);  n += plen;
        put_u32(buf + n, (uint32_t)dlen); n += 4;
        memcpy(buf + n, data[i], dlen);   n += dlen;
    }
    TEST_ASSERT_EQUAL_UINT64((uint64_t)size, (uint64_t)n);
    char err[128] = {0};
    R2dPayload *p = r2d_payload_parse(buf, size, err, sizeof err);
    TEST_ASSERT_NOT_NULL_MESSAGE(p, err);
    return p;
}

static void check_file(const R2dPayload *p, const char *query, const char *expect)
{
    const R2dPayloadFile *f = r2d_payload_find(p, query);
    TEST_ASSERT_NOT_NULL_MESSAGE(f, query);
    TEST_ASSERT_EQUAL_UINT64((uint64_t)strlen(expect), (uint64_t)f->size);
    TEST_ASSERT_EQUAL_MEMORY(expect, f->data, f->size);
}

// Точное совпадение, суффикс в обе стороны и сохранение «первого файла»:
// у assets/a.txt и other/a.txt один basename, но совпасть с /root/assets/a.txt
// может только первый — иначе fallback перестал бы быть прежним.
static void test_exact_and_suffix_semantics(void)
{
    static const char *const paths[] = {
        "assets/a.txt", "assets/b.txt", "other/a.txt", "assets/deep/c.txt", "c.txt",
    };
    static const char *const data[] = { "A", "B", "C", "D", "E" };
    R2dPayload *p = build_container(paths, data, 5);

    check_file(p, "assets/a.txt", "A");
    check_file(p, "assets/b.txt", "B");
    check_file(p, "other/a.txt", "C");
    check_file(p, "assets/deep/c.txt", "D");
    check_file(p, "c.txt", "E");

    // Точный путь длиннее записанного: игра просит «assets/a.txt», а движок
    // подставил каталог запуска.
    check_file(p, "/opt/game/assets/a.txt", "A");
    // Запрос короче записанного: хвост на границе каталога.
    check_file(p, "deep/c.txt", "D");
    // Точное совпадение побеждает суффиксное: c.txt есть буквально.
    check_file(p, "c.txt", "E");

    TEST_ASSERT_NULL(r2d_payload_find(p, "assets/нет.txt"));
    TEST_ASSERT_NULL(r2d_payload_find(p, ""));
    TEST_ASSERT_NULL(r2d_payload_find(p, NULL));

    R2dPayloadLookupStats st;
    r2d_payload_lookup_stats(p, &st);
    TEST_ASSERT_TRUE(st.indexed);
    TEST_ASSERT_EQUAL_INT(0, (int)st.linear_fallbacks);
    TEST_ASSERT_TRUE(st.exact_hits >= 5);
    TEST_ASSERT_TRUE(st.suffix_hits >= 2);

    r2d_payload_free(p);
}

// Большой груз: каждый поиск — попадание в индекс, линейного скана нет.
static void test_large_registry_uses_index(void)
{
    enum { N = 1000 };
    static char paths[N][32];
    static const char *ptr[N];
    static const char *data[N];
    for (int i = 0; i < N; ++i) {
        SDL_snprintf(paths[i], sizeof paths[i], "assets/f%04d.bin", i);
        ptr[i] = paths[i];
        data[i] = "x";
    }
    R2dPayload *p = build_container(ptr, data, N);
    TEST_ASSERT_EQUAL_INT(N, p->file_count);

    // Первый, средний и последний: если бы поиск сканировал, они всё равно
    // нашлись бы, поэтому отдельно проверяем счётчики fallback'ов.
    check_file(p, "assets/f0000.bin", "x");
    check_file(p, "assets/f0500.bin", "x");
    check_file(p, "assets/f0999.bin", "x");
    // Суффиксный путь для файла из тысячи.
    check_file(p, "/srv/game/assets/f0999.bin", "x");

    R2dPayloadLookupStats before, after;
    r2d_payload_lookup_stats(p, &before);
    for (int r = 0; r < 100; ++r) {
        check_file(p, "assets/f0500.bin", "x");
    }
    r2d_payload_lookup_stats(p, &after);
    TEST_ASSERT_EQUAL_INT(0, (int)after.linear_fallbacks);
    TEST_ASSERT_TRUE(after.exact_hits >= before.exact_hits + 100);
    // Открытая адресация при load factor <= 0.5: на 1000 ключей пробы
    // остаются порядка единиц на запрос, а не порядка N.
    TEST_ASSERT_TRUE(after.probes - before.probes < 1000);

    r2d_payload_free(p);
}

static void test_stats_null_is_safe(void)
{
    r2d_payload_lookup_stats(NULL, NULL);
    R2dPayloadLookupStats st;
    st.indexed = true;
    r2d_payload_lookup_stats(NULL, &st);
    TEST_ASSERT_FALSE(st.indexed);
    TEST_ASSERT_EQUAL_INT(0, (int)st.exact_hits);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_exact_and_suffix_semantics);
    RUN_TEST(test_large_registry_uses_index);
    RUN_TEST(test_stats_null_is_safe);
    return UNITY_END();
}
