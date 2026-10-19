// BASHNYA atlas-residency: stream cache pinning, visible-demand soft cap,
// eviction preference/reasons and unlimited budgets.
#include "re2d_world_stream.h"
#include "unity.h"

#include <stdio.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static R2DStreamCache cache;
static R2DStreamItem storage[8];

static void init_cache(void)
{
    memset(storage, 0, sizeof storage);
    memset(&cache, 0, sizeof cache);
    cache.items = storage;
    cache.capacity = 8;
}

static int add(int id, int region, uint64_t bytes, int priority, uint64_t used)
{
    const int slot = r2d_world_stream_register(&cache, id, R2D_STREAM_ATLAS, region,
                                               bytes, priority);
    if (slot >= 0) cache.items[slot].last_used = used;
    return slot;
}

static void test_pin_prevents_eviction(void)
{
    init_cache();
    add(1, 1, 100, 30, 1);
    add(2, 1, 100, 30, 2);
    TEST_ASSERT_TRUE(r2d_world_stream_mark(&cache, 1, R2D_STREAM_ATLAS, R2D_STREAM_RESIDENT));
    TEST_ASSERT_TRUE(r2d_world_stream_mark(&cache, 2, R2D_STREAM_ATLAS, R2D_STREAM_RESIDENT));
    TEST_ASSERT_TRUE(r2d_world_stream_pin(&cache, 1, R2D_STREAM_ATLAS, true));

    uint8_t states[2] = {0, 0};  // both regions unloaded -> demote + evict
    R2DStreamBudget budget = {.resident_budget_bytes = 150};
    R2DStreamStats stats;
    r2d_world_stream_update(&cache, states, 2, &budget, 10, &stats);

    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_STREAM_RESIDENT,
        r2d_world_stream_state(&cache, 1, R2D_STREAM_ATLAS),
        "pinned item is never evicted");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_STREAM_UNLOADED,
        r2d_world_stream_state(&cache, 2, R2D_STREAM_ATLAS),
        "unpinned LRU item is evicted");
    TEST_ASSERT_EQUAL_INT(1, stats.evicted);
    TEST_ASSERT_EQUAL_INT(1, stats.pinned_resident);
    TEST_ASSERT_EQUAL_INT(100, (int)stats.pinned_bytes);
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_EVICT_BUDGET_BYTES,
        cache.items[r2d_world_stream_find(&cache, 2, R2D_STREAM_ATLAS)].evict_reason);
    TEST_ASSERT_EQUAL_INT(0, stats.over_budget_bytes);
}

static void test_visible_demand_soft_cap(void)
{
    init_cache();
    add(1, 1, 100, 30, 1);
    add(2, 1, 100, 30, 2);
    add(3, 1, 100, 30, 3);
    TEST_ASSERT_TRUE(r2d_world_stream_demand(&cache, 1, R2D_STREAM_ATLAS, true));
    TEST_ASSERT_TRUE(r2d_world_stream_demand(&cache, 2, R2D_STREAM_ATLAS, true));
    TEST_ASSERT_TRUE(r2d_world_stream_refs(&cache, 1, R2D_STREAM_ATLAS, 1, 1));

    uint8_t states[2] = {0, 0};
    R2DStreamBudget budget = {.resident_budget_bytes = 50};
    R2DStreamStats stats;
    r2d_world_stream_update(&cache, states, 2, &budget, 10, &stats);

    // Demand-pinned items are force-promoted without the promote budget and stay
    // resident over the byte cap; the unprotected item is the only victim.
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_RESIDENT,
        r2d_world_stream_state(&cache, 1, R2D_STREAM_ATLAS));
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_RESIDENT,
        r2d_world_stream_state(&cache, 2, R2D_STREAM_ATLAS));
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_UNLOADED,
        r2d_world_stream_state(&cache, 3, R2D_STREAM_ATLAS));
    TEST_ASSERT_EQUAL_INT(1, stats.over_budget_bytes);
    TEST_ASSERT_EQUAL_INT(2, stats.pinned_resident);
    TEST_ASSERT_EQUAL_INT(1, cache.items[r2d_world_stream_find(&cache, 1,
        R2D_STREAM_ATLAS)].visible_refs);
}

static void test_lru_eviction_preference_and_reason(void)
{
    init_cache();
    add(1, 1, 100, 10, 1);
    add(2, 1, 100, 20, 2);
    add(3, 1, 100, 30, 3);
    for (int id = 1; id <= 3; id++)
        TEST_ASSERT_TRUE(r2d_world_stream_mark(&cache, id, R2D_STREAM_ATLAS,
                                               R2D_STREAM_RESIDENT));
    uint8_t states[2] = {0, 0};
    R2DStreamBudget budget = {.resident_budget_bytes = 0, .max_resident_items = 2};
    R2DStreamStats stats;
    r2d_world_stream_update(&cache, states, 2, &budget, 20, &stats);

    TEST_ASSERT_EQUAL_INT(R2D_STREAM_UNLOADED,
        r2d_world_stream_state(&cache, 1, R2D_STREAM_ATLAS));
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_EVICTABLE,
        r2d_world_stream_state(&cache, 2, R2D_STREAM_ATLAS));
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_EVICTABLE,
        r2d_world_stream_state(&cache, 3, R2D_STREAM_ATLAS));
    TEST_ASSERT_EQUAL_INT(1, stats.evicted);
    TEST_ASSERT_EQUAL_INT(1, stats.evict_budget_items);
    const int slot1 = r2d_world_stream_find(&cache, 1, R2D_STREAM_ATLAS);
    TEST_ASSERT_EQUAL_INT(20, (int)cache.items[slot1].last_evict_frame);
    TEST_ASSERT_EQUAL_STRING("budgetItems",
        r2d_world_stream_evict_reason_name(cache.items[slot1].evict_reason));
}

static void test_zero_budget_is_unlimited(void)
{
    init_cache();
    add(1, -1, 1024 * 1024, 30, 1);
    add(2, -1, 1024 * 1024, 30, 2);
    R2DStreamBudget budget = {.promote_budget_items = 8};  // residency 0 = unlimited
    R2DStreamStats stats;
    r2d_world_stream_update(&cache, NULL, 0, &budget, 1, &stats);
    TEST_ASSERT_EQUAL_INT(2, stats.resident);
    TEST_ASSERT_EQUAL_INT(0, stats.evicted);
    TEST_ASSERT_EQUAL_INT(0, stats.over_budget_bytes);
    TEST_ASSERT_EQUAL_UINT64(2u * 1024u * 1024u, stats.resident_bytes);
}

static void test_deterministic_promotion_order(void)
{
    init_cache();
    add(10, 0, 10, 5, 7);
    add(11, 0, 10, 5, 7);
    add(12, 0, 10, 5, 7);
    uint8_t states[1] = {4};  // R2D_WORLD_REGION_ACTIVE requests residency
    R2DStreamBudget budget = {.promote_budget_items = 2};
    R2DStreamStats stats;
    r2d_world_stream_update(&cache, states, 1, &budget, 1, &stats);
    TEST_ASSERT_EQUAL_INT(2, stats.promoted);
    TEST_ASSERT_EQUAL_INT(1, stats.promote_deferred);
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_RESIDENT,
        r2d_world_stream_state(&cache, 10, R2D_STREAM_ATLAS));
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_RESIDENT,
        r2d_world_stream_state(&cache, 11, R2D_STREAM_ATLAS));
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_UNLOADED,
        r2d_world_stream_state(&cache, 12, R2D_STREAM_ATLAS));
}

static void test_pending_path_pin_before_registration(void)
{
    R2DStreamPinSet pins;
    memset(&pins, 0, sizeof pins);
    // world.atlasPin('assets/ped_sheet.png', true) before any world.sprite():
    // the path is stored, the (empty) match count is 0, and registration later
    // reads path_pinned() -> the first visible frame is pinned/resident.
    TEST_ASSERT_TRUE(r2d_world_stream_pin_path(&pins, "assets/ped_sheet.png", true));
    TEST_ASSERT_EQUAL_INT(1, r2d_world_stream_pin_path_count(&pins));
    TEST_ASSERT_TRUE(r2d_world_stream_path_pinned(&pins, "assets/ped_sheet.png"));
    TEST_ASSERT_FALSE(r2d_world_stream_path_pinned(&pins, "assets/car_sheet.png"));
    // Idempotent: pinning the same path twice does not duplicate it.
    TEST_ASSERT_TRUE(r2d_world_stream_pin_path(&pins, "assets/ped_sheet.png", true));
    TEST_ASSERT_EQUAL_INT(1, r2d_world_stream_pin_path_count(&pins));
    // on=false removes the pending path so a later registration is not pinned.
    TEST_ASSERT_TRUE(r2d_world_stream_pin_path(&pins, "assets/ped_sheet.png", false));
    TEST_ASSERT_FALSE(r2d_world_stream_path_pinned(&pins, "assets/ped_sheet.png"));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_stream_pin_path_count(&pins));
    TEST_ASSERT_TRUE(r2d_world_stream_pin_path(&pins, "assets/gone.png", false));

    // Bounded set: 64 paths max, the 65th is rejected instead of growing.
    for (int i = 0; i < R2D_WORLD_STREAM_PIN_PATH_LIMIT; i++) {
        char path[64];
        snprintf(path, sizeof path, "assets/pin_%d.png", i);
        TEST_ASSERT_TRUE(r2d_world_stream_pin_path(&pins, path, true));
    }
    TEST_ASSERT_EQUAL_INT(R2D_WORLD_STREAM_PIN_PATH_LIMIT,
                          r2d_world_stream_pin_path_count(&pins));
    TEST_ASSERT_FALSE(r2d_world_stream_pin_path(&pins, "assets/overflow.png", true));
    TEST_ASSERT_FALSE(r2d_world_stream_pin_path(&pins, "", true));
    TEST_ASSERT_FALSE(r2d_world_stream_pin_path(NULL, "assets/ped_sheet.png", true));
    r2d_world_stream_pin_set_free(&pins);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_stream_pin_path_count(&pins));
}

static void test_unregister_and_invalid_inputs(void)
{
    init_cache();
    add(1, -1, 10, 30, 1);
    add(2, -1, 10, 30, 2);
    TEST_ASSERT_TRUE(r2d_world_stream_unregister(&cache, 1, R2D_STREAM_ATLAS));
    TEST_ASSERT_EQUAL_INT(1, cache.count);
    TEST_ASSERT_EQUAL_INT(2, cache.items[0].id);
    TEST_ASSERT_FALSE(r2d_world_stream_unregister(&cache, 1, R2D_STREAM_ATLAS));
    TEST_ASSERT_FALSE(r2d_world_stream_pin(&cache, 99, R2D_STREAM_ATLAS, true));
    TEST_ASSERT_FALSE(r2d_world_stream_demand(&cache, 99, R2D_STREAM_ATLAS, true));
    TEST_ASSERT_FALSE(r2d_world_stream_refs(&cache, 2, R2D_STREAM_ATLAS, -1, 0));
    TEST_ASSERT_TRUE(r2d_world_stream_pin(NULL, 1, R2D_STREAM_ATLAS, true) == false);
    TEST_ASSERT_EQUAL_STRING("none", r2d_world_stream_evict_reason_name(0));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_pin_prevents_eviction);
    RUN_TEST(test_visible_demand_soft_cap);
    RUN_TEST(test_lru_eviction_preference_and_reason);
    RUN_TEST(test_zero_budget_is_unlimited);
    RUN_TEST(test_deterministic_promotion_order);
    RUN_TEST(test_pending_path_pin_before_registration);
    RUN_TEST(test_unregister_and_invalid_inputs);
    return UNITY_END();
}
