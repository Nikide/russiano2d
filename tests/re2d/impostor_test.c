#include "re2d_world_impostor.h"
#include "re2d_world_region.h"
#include "unity.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static R2DWorldRegionSet set;
static R2DWorldRegion regions[8];
static int cell_region[8], region_cells[8];
static int region_portal_offsets[9], region_portal_refs[16];
static int region_adj_offsets[9], region_adj_refs[16];
static uint64_t pvs[8];

static int build_regions(const R2DWorldRegionCell *cells, int cell_count,
                         const R2DWorldRegionPortal *portals, int portal_count,
                         float size)
{
    memset(&set, 0, sizeof set);
    memset(regions, 0, sizeof regions);
    memset(cell_region, 0, sizeof cell_region);
    memset(region_cells, 0, sizeof region_cells);
    memset(region_portal_offsets, 0, sizeof region_portal_offsets);
    memset(region_portal_refs, 0, sizeof region_portal_refs);
    memset(region_adj_offsets, 0, sizeof region_adj_offsets);
    memset(region_adj_refs, 0, sizeof region_adj_refs);
    memset(pvs, 0, sizeof pvs);
    set.regions = regions; set.region_capacity = 8;
    set.cell_region = cell_region; set.cell_region_capacity = 8;
    set.region_cells = region_cells; set.region_cells_capacity = 8;
    set.region_portal_offsets = region_portal_offsets; set.region_portal_offsets_capacity = 9;
    set.region_portal_refs = region_portal_refs; set.region_portal_refs_capacity = 16;
    set.region_adj_offsets = region_adj_offsets; set.region_adj_offsets_capacity = 9;
    set.region_adj_refs = region_adj_refs; set.region_adj_refs_capacity = 16;
    set.pvs = pvs; set.pvs_capacity = 8;
    char error[128] = {0};
    return r2d_world_region_build(cells, cell_count, portals, portal_count, size,
                                  &set, error, sizeof error);
}

static void fixture(R2DWorldRegionCell cells[3], R2DWorldRegionPortal portals[2])
{
    cells[0] = (R2DWorldRegionCell){0, 0, 100, 100};
    cells[1] = (R2DWorldRegionCell){100, 0, 100, 100};
    cells[2] = (R2DWorldRegionCell){200, 0, 100, 100};
    portals[0] = (R2DWorldRegionPortal){0, 1, false, false};
    portals[1] = (R2DWorldRegionPortal){1, 2, false, false};
}

static void test_build_cards_and_local_coords(void)
{
    R2DWorldRegionCell cells[3];
    R2DWorldRegionPortal portals[2];
    fixture(cells, portals);
    TEST_ASSERT_EQUAL_INT(3, build_regions(cells, 3, portals, 2, 100.0f));

    R2DWorldCell world_cells[3] = {
        {0, 0, 100, 100, 0, 1},
        {100, 0, 100, 100, 1, 1},
        {200, 0, 100, 100, 2, 1},
    };
    R2DWorldSpan spans[3] = {
        {0, 0, 100, 100, 0, 40, 0x102030u, 0, 0, 0, 0, 0},
        {100, 0, 100, 100, 8, 48, 0x405060u, 0, 0, 0, 0, 0},
        {200, 0, 100, 100, 16, 56, 0x708090u, 0, 0, 0, 0, 0},
    };
    R2DWorldImpostorSet set_out;
    memset(&set_out, 0, sizeof set_out);
    char error[128] = {0};
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, r2d_world_impostors_build(&set, world_cells, 3,
                                                               spans, 3, &set_out,
                                                               error, sizeof error),
                                  "sizing call returns region count");
    set_out.items = calloc(3, sizeof *set_out.items);
    set_out.capacity = 3;
    TEST_ASSERT_EQUAL_INT(3, r2d_world_impostors_build(&set, world_cells, 3,
                                                       spans, 3, &set_out,
                                                       error, sizeof error));
    TEST_ASSERT_TRUE(set_out.items[0].valid);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 50.0f, set_out.items[0].cx);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 50.0f, set_out.items[0].cy);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, set_out.items[0].local_x);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, set_out.items[0].local_y);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 100.0f, set_out.items[0].width);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 100.0f, set_out.items[0].height);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, set_out.items[0].bottom);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 40.0f, set_out.items[0].top);
    TEST_ASSERT_EQUAL_INT(1, set_out.items[0].cells);
    TEST_ASSERT_EQUAL_INT(1, set_out.items[0].spans);
    TEST_ASSERT_EQUAL_INT(0x102030u, set_out.items[0].color);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 0.0f, set_out.items[2].local_x);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 16.0f, set_out.items[2].bottom);
    TEST_ASSERT_FLOAT_WITHIN(0.01f, 56.0f, set_out.items[2].top);
    r2d_world_impostors_free(&set_out);
}

static void test_collect_visible_nearest_first_and_occluder(void)
{
    R2DWorldRegionCell cells[3];
    R2DWorldRegionPortal portals[2];
    fixture(cells, portals);
    TEST_ASSERT_EQUAL_INT(3, build_regions(cells, 3, portals, 2, 100.0f));
    R2DWorldCell world_cells[3] = {
        {0, 0, 100, 100, 0, 1},
        {100, 0, 100, 100, 1, 1},
        {200, 0, 100, 100, 2, 1},
    };
    R2DWorldSpan spans[3] = {
        {0, 0, 100, 100, 0, 40, 0x111111u, 0, 0, 0, 0, 0},
        {100, 0, 100, 100, 8, 48, 0x222222u, 0, 0, 0, 0, 0},
        {200, 0, 100, 100, 16, 56, 0x333333u, 0, 0, 0, 0, 0},
    };
    R2DWorldImpostorSet out;
    memset(&out, 0, sizeof out);
    char error[128] = {0};
    out.items = calloc(3, sizeof *out.items);
    out.capacity = 3;
    TEST_ASSERT_EQUAL_INT(3, r2d_world_impostors_build(&set, world_cells, 3,
                                                       spans, 3, &out, error, sizeof error));
    R2DWorldImpostor cards[4];
    int total = r2d_world_impostors_collect(&out, &set, 0, NULL, 0, 50, 50, 0, 10000,
                                            cards, 4);
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, total, "current region is not an impostor");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, cards[0].region, "nearest region first");
    TEST_ASSERT_EQUAL_INT(2, cards[1].region);
    TEST_ASSERT_TRUE(cards[0].distance <= cards[1].distance);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_world_impostors_collect(&out, &set, 0, NULL, 0,
                                                                 50, 50, 0, 150,
                                                                 cards, 4),
                                  "max distance filters far cards");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, r2d_world_impostors_collect(&out, &set, 0, NULL, 0,
                                                                 50, 50, 0, 10000,
                                                                 cards, 1),
                                  "capacity reports the full match count");
    R2DWorldOccluder wall = {150, -1000, 150, 1000};
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_world_impostors_collect(&out, &set, 0, &wall, 1,
                                                                 50, 50, 0, 10000,
                                                                 cards, 4),
                                  "occluder hides the far region card");
    TEST_ASSERT_EQUAL_INT(1, cards[0].region);
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_impostors_collect(&out, &set, 0, NULL, 0, 50, 50,
                                                          100, 10, cards, 4));
    r2d_world_impostors_free(&out);
}

static void test_invalid_inputs(void)
{
    R2DWorldRegionCell cells[1] = {{0, 0, 100, 100}};
    TEST_ASSERT_EQUAL_INT(1, build_regions(cells, 1, NULL, 0, 100.0f));
    R2DWorldImpostorSet out;
    memset(&out, 0, sizeof out);
    char error[128] = {0};
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_impostors_build(NULL, NULL, 0, NULL, 0, &out,
                                                        error, sizeof error));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_impostors_build(&set, NULL, 0, NULL, 0, &out,
                                                        error, sizeof error));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_impostors_collect(NULL, &set, 0, NULL, 0,
                                                          0, 0, 0, 10, NULL, 0));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_impostors_collect(&out, &set, 0, NULL, 0,
                                                          0, 0, 0, 10, NULL, 0));
    r2d_world_impostors_free(NULL);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_build_cards_and_local_coords);
    RUN_TEST(test_collect_visible_nearest_first_and_occluder);
    RUN_TEST(test_invalid_inputs);
    return UNITY_END();
}
