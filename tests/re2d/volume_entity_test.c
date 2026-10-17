#include "re2d_world.h"
#include "re2d_world_terrain.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static bool build_pair(R2DRe2dWorld *world)
{
    const R2DWorldSpan spans[2] = {
        {0, 0, 100, 100, 0, 80, 0, 0, 0, 0, 0, 0},
        {100, 0, 100, 100, 0, 80, 0, 0, 0, 0, 0, 0}
    };
    const R2DWorldCell cells[2] = {
        {0, 0, 100, 100, 0, 1}, {100, 0, 100, 100, 1, 1}
    };
    const R2DWorldOpening openings[1] = {{0, 80}};
    const R2DWorldPortal portal = {0, 1, 0, 1, 100, 0, 100, 100, false, 1.0f};
    char error[256] = {0};
    memset(world, 0, sizeof *world);
    return r2d_world_build_cells(world, NULL, 0, spans, 2, cells, 2,
                                 &portal, 1, openings, 1, error, sizeof error);
}

static void test_volume_span_query(void)
{
    R2DRe2dWorld world;
    TEST_ASSERT_TRUE(build_pair(&world));
    int spans[4] = {-1, -1, -1, -1};

    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_world_volume_spans(&world, 10, 10, 40, 40,
                                                            0, 40, NULL, 0),
                                  "count-only query over one cell");
    TEST_ASSERT_EQUAL_INT(1, r2d_world_volume_spans(&world, 10, 10, 40, 40,
                                                    0, 40, spans, 4));
    TEST_ASSERT_EQUAL_INT(0, spans[0]);
    TEST_ASSERT_EQUAL_INT(2, r2d_world_volume_spans(&world, 50, 10, 100, 40,
                                                    0, 40, spans, 4));
    TEST_ASSERT_EQUAL_INT(0, spans[0]);
    TEST_ASSERT_EQUAL_INT(1, spans[1]);

    // Truncation reports the total; capacity 0 writes nothing.
    TEST_ASSERT_EQUAL_INT(2, r2d_world_volume_spans(&world, 50, 10, 100, 40,
                                                    0, 40, spans, 1));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_volume_spans(&world, 0, 0, 0, 10,
                                                     0, 40, spans, 2));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_volume_spans(&world, 0, 0, 10, 10,
                                                     40, 0, spans, 2));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_volume_spans(&world, NAN, 0, 10, 10,
                                                     0, 40, spans, 2));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_volume_spans(NULL, 0, 0, 10, 10,
                                                     0, 40, spans, 2));
    r2d_world_free(&world);
}

static void test_fog_and_water_volumes_apply_to_span_light(void)
{
    R2DRe2dWorld world;
    TEST_ASSERT_TRUE(build_pair(&world));

    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_world_apply_fog_volume(&world, 10, 10,
                                                                40, 40, 0, 40,
                                                                0.5f, 8.0f,
                                                                0.2f, 0.3f, 0.4f),
                                  "fog volume updates the covered span");
    TEST_ASSERT_NOT_NULL(world.span_lights);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 0.5f, world.span_lights[0].fog_density);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 8.0f, world.span_lights[0].fog_start);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 0.2f, world.span_lights[0].fog_r);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 0.0f, world.span_lights[1].fog_density);

    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_world_apply_water_volume(&world, 110, 10,
                                                                  40, 40, 0, 40,
                                                                  0.7f, 0.1f,
                                                                  0.3f, 0.8f),
                                  "water volume updates the other covered span");
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 0.7f, world.span_lights[1].fog_density);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 0.8f, world.span_lights[1].fog_b);

    // Concrete terrain mapping: covered spans -> floor surface -> water preset.
    int spans[2] = {-1, -1};
    TEST_ASSERT_EQUAL_INT(1, r2d_world_volume_spans(&world, 110, 10, 40, 40,
                                                    0, 40, spans, 2));
    const int surface = r2d_world_span_surface(&world, spans[0], R2D_WORLD_FLOOR);
    TEST_ASSERT_GREATER_OR_EQUAL_INT(0, surface);
    const R2DWorldTerrain *water = r2d_world_terrain_preset(R2D_TERRAIN_WATER);
    TEST_ASSERT_NOT_NULL(water);
    TEST_ASSERT_EQUAL_INT(R2D_TERRAIN_WATER, water->kind);
    TEST_ASSERT_TRUE(water->fog_density > 0.0f);

    // Invalid values are rejected without changing the world.
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_apply_fog_volume(&world, 0, 0, 10, 10,
                                                         0, 40, 2.0f, 0, 0, 0, 0));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_apply_water_volume(&world, 0, 0, 10, 10,
                                                           0, 40, NAN, 0, 0, 1));
    r2d_world_free(&world);
}

static void test_areaportal_wiring(void)
{
    R2DRe2dWorld world;
    TEST_ASSERT_TRUE(build_pair(&world));
    const uint64_t revision = world.geometry_revision;

    TEST_ASSERT_FALSE(r2d_world_portal_area(&world, 0));
    TEST_ASSERT_TRUE(r2d_world_portal_set_area(&world, 0, true));
    TEST_ASSERT_TRUE(r2d_world_portal_area(&world, 0));
    TEST_ASSERT_TRUE(world.geometry_revision > revision);
    TEST_ASSERT_TRUE(r2d_world_portal_set_area(&world, 0, false));
    TEST_ASSERT_FALSE(r2d_world_portal_area(&world, 0));
    TEST_ASSERT_FALSE(r2d_world_portal_set_area(&world, -1, true));
    TEST_ASSERT_FALSE(r2d_world_portal_area(NULL, 0));
    r2d_world_free(&world);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_volume_span_query);
    RUN_TEST(test_fog_and_water_volumes_apply_to_span_light);
    RUN_TEST(test_areaportal_wiring);
    return UNITY_END();
}
