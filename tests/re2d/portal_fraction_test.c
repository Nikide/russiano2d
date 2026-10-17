// Re2D Portal 2.0: smooth open fraction drives collision/visibility intervals.
#include "unity.h"
#include "re2d_world.h"
#include <math.h>

void setUp(void) {}
void tearDown(void) {}

// Two cells, each with two free spans, joined by a portal with two vertical
// openings (0..3 and 6..9). Same fixture shape as tests/re2d/world_test.c.
static R2DRe2dWorld build(void)
{
    R2DRe2dWorld world = {0};
    const R2DWorldSpan stack[] = {
        {0,0,100,100,0,3,0,0}, {0,0,100,100,6,9,0,0},
        {100,0,100,100,0,3,0,0}, {100,0,100,100,6,9,0,0}
    };
    const R2DWorldCell cells[] = {{0,0,100,100,0,2},{100,0,100,100,2,2}};
    const R2DWorldOpening openings[] = {{0,3},{6,9}};
    R2DWorldPortal portal = {0,1,0,2,100,0,100,100,false,1.0f};
    char error[256] = {0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build_cells(&world, NULL, 0, stack, 4, cells, 2,
        &portal, 1, openings, 2, error, sizeof error), error);
    return world;
}

static void test_portal_defaults_to_fully_open(void)
{
    R2DRe2dWorld world = build();
    TEST_ASSERT_EQUAL_FLOAT(1.0f, r2d_world_portal_open_fraction(&world, 0));
    TEST_ASSERT_FALSE(world.portals[0].closed);
    TEST_ASSERT_TRUE(r2d_world_portal_passes(&world, 0, 0.0f, 3.0f));
    TEST_ASSERT_TRUE(r2d_world_portal_passes(&world, 0, 6.0f, 9.0f));
    TEST_ASSERT_FALSE(r2d_world_portal_passes(&world, 0, 4.0f, 5.0f));
    r2d_world_free(&world);
}

static void test_half_open_clips_each_authored_opening_from_the_top(void)
{
    R2DRe2dWorld world = build();
    TEST_ASSERT_TRUE(r2d_world_portal_set_open(&world, 0, 0.5f));
    TEST_ASSERT_EQUAL_FLOAT(0.5f, r2d_world_portal_open_fraction(&world, 0));
    TEST_ASSERT_FALSE(world.portals[0].closed);
    // [0,3] -> [0,1.5]; a body that needed the upper half no longer passes.
    TEST_ASSERT_TRUE(r2d_world_portal_passes(&world, 0, 0.0f, 1.4f));
    TEST_ASSERT_FALSE(r2d_world_portal_passes(&world, 0, 0.0f, 2.0f));
    // [6,9] -> [6,7.5].
    TEST_ASSERT_TRUE(r2d_world_portal_passes(&world, 0, 6.0f, 7.4f));
    TEST_ASSERT_FALSE(r2d_world_portal_passes(&world, 0, 6.0f, 8.0f));
    r2d_world_free(&world);
}

static void test_zero_fraction_closes_and_one_reopens(void)
{
    R2DRe2dWorld world = build();
    TEST_ASSERT_TRUE(r2d_world_portal_set_open(&world, 0, 0.0f));
    TEST_ASSERT_TRUE(world.portals[0].closed);
    TEST_ASSERT_FALSE(r2d_world_portal_passes(&world, 0, 0.0f, 1.0f));
    TEST_ASSERT_TRUE(r2d_world_portal_set_open(&world, 0, 1.0f));
    TEST_ASSERT_FALSE(world.portals[0].closed);
    TEST_ASSERT_TRUE(r2d_world_portal_passes(&world, 0, 0.0f, 3.0f));
    r2d_world_free(&world);
}

static void test_binary_and_smooth_state_stay_in_sync(void)
{
    R2DRe2dWorld world = build();
    TEST_ASSERT_TRUE(r2d_world_portal_set_closed(&world, 0, true));
    TEST_ASSERT_EQUAL_FLOAT(0.0f, world.portals[0].open_fraction);
    TEST_ASSERT_TRUE(r2d_world_portal_set_closed(&world, 0, false));
    TEST_ASSERT_EQUAL_FLOAT(1.0f, world.portals[0].open_fraction);
    TEST_ASSERT_TRUE(r2d_world_portal_set_open(&world, 0, 0.25f));
    TEST_ASSERT_FALSE(world.portals[0].closed);
    TEST_ASSERT_TRUE(r2d_world_portal_set_closed(&world, 0, true));
    TEST_ASSERT_EQUAL_FLOAT(0.0f, world.portals[0].open_fraction);
    r2d_world_free(&world);
}

static void test_fraction_is_clamped(void)
{
    R2DRe2dWorld world = build();
    TEST_ASSERT_TRUE(r2d_world_portal_set_open(&world, 0, 2.5f));
    TEST_ASSERT_EQUAL_FLOAT(1.0f, r2d_world_portal_open_fraction(&world, 0));
    TEST_ASSERT_TRUE(r2d_world_portal_set_open(&world, 0, -3.0f));
    TEST_ASSERT_EQUAL_FLOAT(0.0f, r2d_world_portal_open_fraction(&world, 0));
    TEST_ASSERT_TRUE(world.portals[0].closed);
    r2d_world_free(&world);
}

static void test_invalid_fraction_and_handle_are_rejected(void)
{
    R2DRe2dWorld world = build();
    const uint64_t revision = world.geometry_revision;
    TEST_ASSERT_FALSE(r2d_world_portal_set_open(&world, 0, NAN));
    TEST_ASSERT_FALSE(r2d_world_portal_set_open(&world, 0, INFINITY));
    TEST_ASSERT_FALSE(r2d_world_portal_set_open(&world, -1, 0.5f));
    TEST_ASSERT_FALSE(r2d_world_portal_set_open(&world, 99, 0.5f));
    TEST_ASSERT_EQUAL_FLOAT(1.0f, r2d_world_portal_open_fraction(&world, 0));
    TEST_ASSERT_EQUAL_UINT64(revision, world.geometry_revision);
    TEST_ASSERT_EQUAL_FLOAT(-1.0f, r2d_world_portal_open_fraction(&world, 99));
    r2d_world_free(&world);
}

static void test_fraction_change_bumps_geometry_revision(void)
{
    R2DRe2dWorld world = build();
    const uint64_t revision = world.geometry_revision;
    TEST_ASSERT_TRUE(r2d_world_portal_set_open(&world, 0, 0.5f));
    TEST_ASSERT_TRUE(world.geometry_revision != revision);
    const uint64_t half = world.geometry_revision;
    // Same value is a no-op and must not invalidate caches again.
    TEST_ASSERT_TRUE(r2d_world_portal_set_open(&world, 0, 0.5f));
    TEST_ASSERT_EQUAL_UINT64(half, world.geometry_revision);
    r2d_world_free(&world);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_portal_defaults_to_fully_open);
    RUN_TEST(test_half_open_clips_each_authored_opening_from_the_top);
    RUN_TEST(test_zero_fraction_closes_and_one_reopens);
    RUN_TEST(test_binary_and_smooth_state_stay_in_sync);
    RUN_TEST(test_fraction_is_clamped);
    RUN_TEST(test_invalid_fraction_and_handle_are_rejected);
    RUN_TEST(test_fraction_change_bumps_geometry_revision);
    return UNITY_END();
}
