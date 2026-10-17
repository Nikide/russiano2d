#include "re2d_world_stream.h"
#include "re2d_world_region.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static R2DStreamBudget budget(uint64_t resident_bytes, uint64_t upload_bytes,
                              int promote_items, int upload_items)
{
    R2DStreamBudget b;
    memset(&b, 0, sizeof b);
    b.resident_budget_bytes = resident_bytes;
    b.upload_budget_bytes = upload_bytes;
    b.promote_budget_items = promote_items;
    b.upload_budget_items = upload_items;
    b.max_resident_items = 0;
    return b;
}

static uint8_t region_states[8];

typedef struct {
    int calls, promotions, unloads;
    R2DStreamState last_from, last_to;
    int last_id, last_kind;
} HookProbe;

static void hook_count(void *user, int id, int kind, R2DStreamState from, R2DStreamState to)
{
    HookProbe *probe = (HookProbe *)user;
    probe->calls++;
    if (to == R2D_STREAM_RESIDENT) probe->promotions++;
    if (to == R2D_STREAM_UNLOADED) probe->unloads++;
    probe->last_from = from;
    probe->last_to = to;
    probe->last_id = id;
    probe->last_kind = kind;
}

static void set_active_only(int active_region, int count)
{
    for (int i = 0; i < count; i++)
        region_states[i] = i == active_region ? R2D_WORLD_REGION_ACTIVE
                                              : R2D_WORLD_REGION_UNLOADED;
}

static void test_register_find_and_duplicates(void)
{
    R2DStreamCache cache;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_stream_init(&cache, 8), "cache init");
    TEST_ASSERT_FALSE(r2d_world_stream_init(&cache, 0));
    int a = r2d_world_stream_register(&cache, 7, R2D_STREAM_TEXTURE, 2, 100, 5);
    int b = r2d_world_stream_register(&cache, 7, R2D_STREAM_TEXTURE, 3, 150, 9);
    TEST_ASSERT_EQUAL_INT_MESSAGE(a, b, "same id+kind reuses the slot");
    TEST_ASSERT_EQUAL_INT(1, cache.count);
    TEST_ASSERT_EQUAL_INT(a, r2d_world_stream_find(&cache, 7, R2D_STREAM_TEXTURE));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_stream_find(&cache, 7, R2D_STREAM_ATLAS));
    TEST_ASSERT_EQUAL_INT(3, cache.items[a].region);
    TEST_ASSERT_EQUAL_INT(150, (int)cache.items[a].bytes);
    TEST_ASSERT_EQUAL_INT(9, cache.items[a].priority);
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_STREAM_UNLOADED, r2d_world_stream_state(&cache, 7, R2D_STREAM_TEXTURE),
                                  "new payload starts unloaded");
    TEST_ASSERT_EQUAL_STRING("texture", r2d_world_stream_kind_name(R2D_STREAM_TEXTURE));
    TEST_ASSERT_EQUAL_STRING("atlas", r2d_world_stream_kind_name(R2D_STREAM_ATLAS));
    TEST_ASSERT_EQUAL_STRING("unknown", r2d_world_stream_kind_name(99));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_stream_register(&cache, 1, 99, 0, 1, 1));
    r2d_world_stream_free(&cache);
    TEST_ASSERT_NULL(cache.items);
    r2d_world_stream_free(NULL);
}

static void test_budgeted_promotion_and_upload(void)
{
    R2DStreamCache cache;
    TEST_ASSERT_TRUE(r2d_world_stream_init(&cache, 8));
    r2d_world_stream_register(&cache, 0, R2D_STREAM_BSP, 0, 100, 1);
    r2d_world_stream_register(&cache, 1, R2D_STREAM_BSP, 0, 100, 1);
    r2d_world_stream_register(&cache, 2, R2D_STREAM_BSP, 0, 100, 1);
    set_active_only(0, 4);
    HookProbe probe;
    memset(&probe, 0, sizeof probe);
    r2d_world_stream_set_hook(&cache, hook_count, &probe);
    R2DStreamBudget b = budget(0, 0, 2, 0);
    R2DStreamStats stats;
    int changes = r2d_world_stream_update(&cache, region_states, 4, &b, 1, &stats);
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, stats.promoted, "promotion respects the item budget");
    TEST_ASSERT_EQUAL_INT(2, changes);
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_RESIDENT, cache.items[0].state);
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_RESIDENT, cache.items[1].state);
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_STREAM_UNLOADED, cache.items[2].state,
                                  "third payload waits for the next frame");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, stats.uploads, "upload item budget 0 defers dirty payloads");
    TEST_ASSERT_EQUAL_INT(2, stats.deferred_uploads);
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, probe.promotions, "transition hook sees promotions");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_STREAM_RESIDENT, probe.last_to,
                                  "hook reports the destination state");

    b.promote_budget_items = 1;
    b.upload_budget_bytes = 100;
    b.upload_budget_items = 4;
    for (int i = 0; i < (int)(sizeof region_states); i++) region_states[i] = 0;
    region_states[0] = R2D_WORLD_REGION_ACTIVE;
    r2d_world_stream_update(&cache, region_states, 4, &b, 2, &stats);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, stats.promoted, "third payload promoted now");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, stats.uploads, "only one 100-byte payload fits 100 bytes");
    TEST_ASSERT_TRUE(stats.deferred_uploads >= 1);
    r2d_world_stream_update(&cache, region_states, 4, &b, 3, &stats);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, stats.uploads, "deferred payloads upload one per frame");
    r2d_world_stream_update(&cache, region_states, 4, &b, 4, &stats);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, stats.uploads, "last deferred payload uploads");
    TEST_ASSERT_EQUAL_INT(0, stats.deferred_uploads);
    TEST_ASSERT_TRUE(cache.items[0].dirty == false && cache.items[1].dirty == false &&
                     cache.items[2].dirty == false);
    r2d_world_stream_set_hook(&cache, NULL, NULL);
    TEST_ASSERT_TRUE_MESSAGE(probe.calls >= 3, "hook counted every transition");
    r2d_world_stream_free(&cache);
}

static void test_lru_eviction_and_active_pin(void)
{
    R2DStreamCache cache;
    TEST_ASSERT_TRUE(r2d_world_stream_init(&cache, 8));
    r2d_world_stream_register(&cache, 0, R2D_STREAM_SURFACES, 0, 100, 1);
    r2d_world_stream_register(&cache, 1, R2D_STREAM_SURFACES, 1, 100, 1);
    r2d_world_stream_register(&cache, 2, R2D_STREAM_SURFACES, 2, 100, 1);
    uint8_t states[4] = {R2D_WORLD_REGION_ACTIVE, R2D_WORLD_REGION_ACTIVE,
                         R2D_WORLD_REGION_PRELOADING, R2D_WORLD_REGION_UNLOADED};
    R2DStreamBudget b = budget(1000, 1000, 8, 8);
    R2DStreamStats stats;
    r2d_world_stream_update(&cache, states, 4, &b, 1, &stats);
    TEST_ASSERT_EQUAL_INT(3, stats.promoted);
    TEST_ASSERT_EQUAL_INT(0, stats.evicted);

    // Move region 0 to unloaded; touch region 1 later so region 2 is the LRU
    // evictable payload. Active region 1 must stay resident.
    states[0] = R2D_WORLD_REGION_UNLOADED;
    states[2] = R2D_WORLD_REGION_UNLOADED;
    r2d_world_stream_update(&cache, states, 4, &b, 2, &stats);
    r2d_world_stream_touch(&cache, 1, R2D_STREAM_SURFACES, 5);
    b.resident_budget_bytes = 100;
    r2d_world_stream_update(&cache, states, 4, &b, 6, &stats);
    TEST_ASSERT_TRUE_MESSAGE(stats.evicted >= 1, "over-budget residency evicts");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_STREAM_RESIDENT, r2d_world_stream_state(&cache, 1, R2D_STREAM_SURFACES),
                                  "active payload is pinned");
    TEST_ASSERT_TRUE(stats.resident_bytes <= 100);
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_stream_update(&cache, NULL, -1, &b, 7, &stats),
                                  "negative region count rejected");
    r2d_world_stream_free(&cache);
}

static void test_texture_and_atlas_residency_states(void)
{
    R2DStreamCache cache;
    TEST_ASSERT_TRUE(r2d_world_stream_init(&cache, 16));
    r2d_world_stream_register(&cache, 10, R2D_STREAM_TEXTURE, 0, 64, 3);
    r2d_world_stream_register(&cache, 20, R2D_STREAM_ATLAS, 1, 128, 3);
    TEST_ASSERT_TRUE(r2d_world_stream_mark(&cache, 10, R2D_STREAM_TEXTURE, R2D_STREAM_RESIDENT));
    TEST_ASSERT_TRUE(r2d_world_stream_mark(&cache, 20, R2D_STREAM_ATLAS, R2D_STREAM_EVICTABLE));
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_RESIDENT, r2d_world_stream_state(&cache, 10, R2D_STREAM_TEXTURE));
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_EVICTABLE, r2d_world_stream_state(&cache, 20, R2D_STREAM_ATLAS));
    set_active_only(0, 2);
    R2DStreamBudget b = budget(1000, 1000, 0, 8);
    R2DStreamStats stats;
    r2d_world_stream_update(&cache, region_states, 2, &b, 1, &stats);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, stats.textures_resident, "texture residency counted");
    TEST_ASSERT_TRUE(stats.uploads >= 1);
    TEST_ASSERT_FALSE(r2d_world_stream_mark(&cache, 99, R2D_STREAM_TEXTURE, R2D_STREAM_RESIDENT));
    TEST_ASSERT_FALSE(r2d_world_stream_mark(&cache, 10, R2D_STREAM_TEXTURE, 99));
    r2d_world_stream_free(&cache);
}

static void test_deterministic_updates(void)
{
    R2DStreamCache a, b;
    TEST_ASSERT_TRUE(r2d_world_stream_init(&a, 8));
    TEST_ASSERT_TRUE(r2d_world_stream_init(&b, 8));
    for (int i = 0; i < 5; i++) {
        r2d_world_stream_register(&a, i, R2D_STREAM_BSP, i % 3, 100 + (uint64_t)i, i);
        r2d_world_stream_register(&b, i, R2D_STREAM_BSP, i % 3, 100 + (uint64_t)i, i);
    }
    R2DStreamBudget budget_config = budget(300, 250, 2, 2);
    for (int frame = 0; frame < 12; frame++) {
        uint8_t states[3] = {(uint8_t)(frame % 3), R2D_WORLD_REGION_PRELOADING,
                             R2D_WORLD_REGION_RESIDENT};
        R2DStreamStats sa, sb;
        TEST_ASSERT_EQUAL_INT(r2d_world_stream_update(&a, states, 3, &budget_config,
                                                      (uint64_t)frame, &sa),
                              r2d_world_stream_update(&b, states, 3, &budget_config,
                                                      (uint64_t)frame, &sb));
        TEST_ASSERT_EQUAL_INT(0, memcmp(&sa, &sb, sizeof sa));
    }
    TEST_ASSERT_EQUAL_INT(0, memcmp(a.items, b.items, (size_t)a.count * sizeof *a.items));
    r2d_world_stream_free(&a);
    r2d_world_stream_free(&b);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_register_find_and_duplicates);
    RUN_TEST(test_budgeted_promotion_and_upload);
    RUN_TEST(test_lru_eviction_and_active_pin);
    RUN_TEST(test_texture_and_atlas_residency_states);
    RUN_TEST(test_deterministic_updates);
    return UNITY_END();
}
