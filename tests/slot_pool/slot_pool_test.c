// Пул слотов — фундамент динамических реестров (§7, §48).
// Проверяем именно те свойства, на которые опираются текстуры/тела/звуки:
// O(1) freelist, стабильные id, плотный список живых, поколения против
// протухших ссылок и безопасный рост больших ёмкостей.
#include "r2d_slot_pool.h"

#include "unity.h"

#include <stdint.h>
#include <stdlib.h>

void setUp(void) {}
void tearDown(void) {}

static void test_alloc_free_reuse_and_generation(void)
{
    R2DSlotPool pool;
    TEST_ASSERT_TRUE(r2d_slot_pool_init(&pool, 0));
    TEST_ASSERT_EQUAL_UINT32(0, r2d_slot_pool_count(&pool));
    TEST_ASSERT_EQUAL_UINT32(0, r2d_slot_pool_capacity(&pool));

    const uint32_t a = r2d_slot_pool_alloc(&pool);
    const uint32_t b = r2d_slot_pool_alloc(&pool);
    TEST_ASSERT_NOT_EQUAL(R2D_SLOT_NONE, a);
    TEST_ASSERT_NOT_EQUAL(R2D_SLOT_NONE, b);
    TEST_ASSERT_EQUAL_UINT32(2, r2d_slot_pool_count(&pool));

    const uint32_t gen_a = r2d_slot_pool_generation(&pool, a);
    TEST_ASSERT_TRUE(r2d_slot_pool_valid(&pool, a, gen_a));
    TEST_ASSERT_TRUE(r2d_slot_pool_free(&pool, a));
    TEST_ASSERT_FALSE(r2d_slot_pool_alive(&pool, a));
    TEST_ASSERT_FALSE(r2d_slot_pool_valid(&pool, a, gen_a));
    TEST_ASSERT_EQUAL_UINT32(1, r2d_slot_pool_count(&pool));

    // Freelist обязан вернуть именно освобождённый слот, а поколение — вырасти.
    const uint32_t reused = r2d_slot_pool_alloc(&pool);
    TEST_ASSERT_EQUAL_UINT32(a, reused);
    TEST_ASSERT_NOT_EQUAL(gen_a, r2d_slot_pool_generation(&pool, reused));
    TEST_ASSERT_FALSE(r2d_slot_pool_valid(&pool, a, gen_a));
    TEST_ASSERT_TRUE(r2d_slot_pool_valid(&pool, reused,
                                         r2d_slot_pool_generation(&pool, reused)));

    TEST_ASSERT_TRUE(r2d_slot_pool_free(&pool, b));
    TEST_ASSERT_TRUE(r2d_slot_pool_free(&pool, reused));
    TEST_ASSERT_FALSE(r2d_slot_pool_free(&pool, reused));   // двойное освобождение
    TEST_ASSERT_EQUAL_UINT32(0, r2d_slot_pool_count(&pool));
    r2d_slot_pool_shutdown(&pool);
}

static void test_dense_list_tracks_only_live(void)
{
    R2DSlotPool pool;
    TEST_ASSERT_TRUE(r2d_slot_pool_init(&pool, 8));
    uint32_t ids[100];
    for (int i = 0; i < 100; ++i) ids[i] = r2d_slot_pool_alloc(&pool);
    TEST_ASSERT_EQUAL_UINT32(100, r2d_slot_pool_count(&pool));
    TEST_ASSERT_TRUE(r2d_slot_pool_capacity(&pool) >= 100);

    // Чётные освобождаем: плотный список должен содержать ровно 50 живых.
    for (int i = 0; i < 100; i += 2) TEST_ASSERT_TRUE(r2d_slot_pool_free(&pool, ids[i]));
    TEST_ASSERT_EQUAL_UINT32(50, r2d_slot_pool_count(&pool));
    for (uint32_t i = 0; i < 50; ++i) {
        const uint32_t slot = r2d_slot_pool_dense_at(&pool, i);
        TEST_ASSERT_NOT_EQUAL(R2D_SLOT_NONE, slot);
        TEST_ASSERT_TRUE(r2d_slot_pool_alive(&pool, slot));
        TEST_ASSERT_EQUAL_UINT32(slot, r2d_slot_pool_dense_to_slot(&pool, i));
    }
    r2d_slot_pool_shutdown(&pool);
}

static void test_growth_is_bounded_and_checked(void)
{
    R2DSlotPool pool;
    TEST_ASSERT_TRUE(r2d_slot_pool_init(&pool, 1));
    for (uint32_t i = 0; i < 10000; ++i) {
        TEST_ASSERT_NOT_EQUAL(R2D_SLOT_NONE, r2d_slot_pool_alloc(&pool));
    }
    TEST_ASSERT_EQUAL_UINT32(10000, r2d_slot_pool_count(&pool));

    // Абсурдная ёмкость должна отвергаться без падения и без изменения пула.
    const uint32_t cap_before = r2d_slot_pool_capacity(&pool);
    TEST_ASSERT_FALSE(r2d_slot_pool_reserve(&pool, UINT32_MAX));
    TEST_ASSERT_EQUAL_UINT32(cap_before, r2d_slot_pool_capacity(&pool));
    r2d_slot_pool_shutdown(&pool);
}

static void test_grow_array_helper(void)
{
    uint32_t *data = NULL;
    uint32_t cap = 0;
    TEST_ASSERT_TRUE(r2d_grow_array((void **)&data, sizeof *data, &cap, 1));
    TEST_ASSERT_TRUE(cap >= 1);
    TEST_ASSERT_TRUE(r2d_grow_array((void **)&data, sizeof *data, &cap, 1000));
    TEST_ASSERT_TRUE(cap >= 1000);
    data[999] = 42;
    TEST_ASSERT_EQUAL_UINT32(42, data[999]);
    free(data);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_alloc_free_reuse_and_generation);
    RUN_TEST(test_dense_list_tracks_only_live);
    RUN_TEST(test_growth_is_bounded_and_checked);
    RUN_TEST(test_grow_array_helper);
    return UNITY_END();
}
