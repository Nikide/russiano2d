#include "re2d_world_region.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define CELLS 4
#define PORTALS 4

static const R2DWorldRegionCell CELL_RECTS[CELLS] = {
    {0, 0, 100, 100},
    {100, 0, 100, 100},
    {0, 100, 100, 100},
    {100, 100, 100, 100},
};

static const R2DWorldRegionPortal PORTAL_LINKS[PORTALS] = {
    {0, 1, false, false},
    {1, 3, false, false},
    {0, 2, false, false},
    {2, 3, false, false},
};

typedef struct {
    R2DWorldRegionSet set;
    R2DWorldRegion regions[8];
    int cell_region[8];
    int region_cells[8];
    int region_portal_offsets[9];
    int region_portal_refs[16];
    int region_adj_offsets[9];
    int region_adj_refs[16];
    uint64_t pvs[8];
} RegionBuffers;

static void init_buffers(RegionBuffers *b)
{
    memset(b, 0, sizeof *b);
    b->set.regions = b->regions;
    b->set.region_capacity = 8;
    b->set.cell_region = b->cell_region;
    b->set.cell_region_capacity = 8;
    b->set.region_cells = b->region_cells;
    b->set.region_cells_capacity = 8;
    b->set.region_portal_offsets = b->region_portal_offsets;
    b->set.region_portal_offsets_capacity = 9;
    b->set.region_portal_refs = b->region_portal_refs;
    b->set.region_portal_refs_capacity = 16;
    b->set.region_adj_offsets = b->region_adj_offsets;
    b->set.region_adj_offsets_capacity = 9;
    b->set.region_adj_refs = b->region_adj_refs;
    b->set.region_adj_refs_capacity = 16;
    b->set.pvs = b->pvs;
    b->set.pvs_capacity = 8;
}

static int build(RegionBuffers *b, const R2DWorldRegionCell *cells, int cell_count,
                 const R2DWorldRegionPortal *portals, int portal_count,
                 float size, char *error)
{
    return r2d_world_region_build(cells, cell_count, portals, portal_count, size,
                                  &b->set, error, 128);
}

static void test_build_grid_and_partition(void)
{
    RegionBuffers b;
    init_buffers(&b);
    char error[128] = {0};
    TEST_ASSERT_EQUAL_INT(4, build(&b, CELL_RECTS, CELLS, PORTAL_LINKS, PORTALS,
                                   100.0f, error));
    TEST_ASSERT_EQUAL_INT(4, b.set.region_count);
    TEST_ASSERT_EQUAL_INT(2, b.set.columns);
    TEST_ASSERT_EQUAL_INT(2, b.set.rows);
    TEST_ASSERT_EQUAL_INT(1, b.set.pvs_words);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_region_at(&b.set, 50.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(1, r2d_world_region_at(&b.set, 150.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(2, r2d_world_region_at(&b.set, 50.0f, 150.0f));
    TEST_ASSERT_EQUAL_INT(3, r2d_world_region_at(&b.set, 150.0f, 150.0f));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_region_at(&b.set, -1.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_region_at(&b.set, 1000.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(1, b.set.regions[0].cell_count);
    TEST_ASSERT_EQUAL_INT(0, b.cell_region[0]);
    TEST_ASSERT_EQUAL_INT(3, b.cell_region[3]);
    TEST_ASSERT_EQUAL_INT(4, b.set.metrics.unloaded_count);
}

static void test_sizing_call(void)
{
    R2DWorldRegionSet sizing;
    memset(&sizing, 0, sizeof sizing);
    char error[128] = {0};
    int required = r2d_world_region_build(CELL_RECTS, CELLS, PORTAL_LINKS,
                                          PORTALS, 100.0f, &sizing,
                                          error, sizeof error);
    TEST_ASSERT_EQUAL_INT(4, required);
    TEST_ASSERT_EQUAL_INT(4, sizing.region_count);
    TEST_ASSERT_EQUAL_INT(1, sizing.pvs_words);
    TEST_ASSERT_EQUAL_INT(2, sizing.columns);
    TEST_ASSERT_EQUAL_INT(2, sizing.rows);
}

static void test_pvs_open_and_closed(void)
{
    RegionBuffers b;
    init_buffers(&b);
    char error[128] = {0};
    TEST_ASSERT_EQUAL_INT(4, build(&b, CELL_RECTS, CELLS, PORTAL_LINKS, PORTALS,
                                   100.0f, error));
    for (int r = 0; r < 4; r++)
        for (int t = 0; t < 4; t++)
            TEST_ASSERT_TRUE(r2d_world_region_visible(&b.set, r, t));
    TEST_ASSERT_FALSE(r2d_world_region_visible(&b.set, -1, 0));
    TEST_ASSERT_FALSE(r2d_world_region_visible(&b.set, 0, 9));

    R2DWorldRegionPortal closed[PORTALS];
    memcpy(closed, PORTAL_LINKS, sizeof closed);
    closed[0].closed = true; // 0-1
    closed[2].closed = true; // 0-2
    TEST_ASSERT_TRUE(r2d_world_region_rebuild_pvs(&b.set, closed, PORTALS));
    TEST_ASSERT_TRUE(r2d_world_region_visible(&b.set, 0, 0));
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_region_visible(&b.set, 0, 1),
                              "closed door cuts the 0-1 region link");
    TEST_ASSERT_FALSE(r2d_world_region_visible(&b.set, 0, 2));
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_region_visible(&b.set, 1, 3),
                             "unrelated regions stay reachable");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_region_visible(&b.set, 0, 3),
                              "cut region 0 cannot reach the far region");
}

static void test_areaportal_closed_isolation(void)
{
    const R2DWorldRegionCell two_cells[2] = {{0, 0, 100, 100},
                                             {100, 0, 100, 100}};
    R2DWorldRegionPortal door[1] = {{0, 1, false, true}};
    RegionBuffers b;
    init_buffers(&b);
    char error[128] = {0};
    TEST_ASSERT_EQUAL_INT(2, build(&b, two_cells, 2, door, 1, 100.0f, error));
    TEST_ASSERT_TRUE(r2d_world_region_visible(&b.set, 0, 1));
    door[0].closed = true;
    TEST_ASSERT_TRUE(r2d_world_region_rebuild_pvs(&b.set, door, 1));
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_region_visible(&b.set, 0, 1),
                              "closed areaportal removes the coarse PVS edge");
}

static void test_active_preload_rings_and_streaming(void)
{
    RegionBuffers b;
    init_buffers(&b);
    char error[128] = {0};
    TEST_ASSERT_EQUAL_INT(4, build(&b, CELL_RECTS, CELLS, PORTAL_LINKS, PORTALS,
                                   100.0f, error));
    uint8_t states[8] = {0};
    int active[8], preload[8];
    int active_count = r2d_world_region_update_active(&b.set, 0, 0, 1,
                                                      states, 8, active, 8,
                                                      preload, 8);
    TEST_ASSERT_EQUAL_INT(1, active_count);
    TEST_ASSERT_EQUAL_INT(0, active[0]);
    TEST_ASSERT_EQUAL_INT(3, b.set.metrics.preload_count);
    TEST_ASSERT_EQUAL_INT(0, b.set.metrics.sleeping_count);
    TEST_ASSERT_EQUAL_INT(R2D_WORLD_REGION_ACTIVE, states[0]);
    TEST_ASSERT_EQUAL_INT(R2D_WORLD_REGION_PRELOADING, states[1]);
    TEST_ASSERT_EQUAL_INT(R2D_WORLD_REGION_PRELOADING, states[2]);
    TEST_ASSERT_EQUAL_INT(R2D_WORLD_REGION_PRELOADING, states[3]);
    TEST_ASSERT_EQUAL_INT(1, r2d_world_region_stream(&b.set, states, 8, 1));
    TEST_ASSERT_EQUAL_INT(R2D_WORLD_REGION_RESIDENT, states[1]);
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_REGION_PRELOADING, states[2],
                                  "stream budget is respected");
    TEST_ASSERT_EQUAL_INT(1, r2d_world_region_stream(&b.set, states, 8, 1));
    TEST_ASSERT_EQUAL_INT(R2D_WORLD_REGION_RESIDENT, states[2]);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_region_stream(&b.set, states, 8, 0));

    // Preload radius 0: only the current region is resident; PVS-visible
    // neighbours become SLEEPING and unload under budget.
    active_count = r2d_world_region_update_active(&b.set, 0, 0, 0, states, 8,
                                                  active, 8, preload, 8);
    TEST_ASSERT_EQUAL_INT(1, active_count);
    TEST_ASSERT_EQUAL_INT(0, b.set.metrics.preload_count);
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, b.set.metrics.sleeping_count,
                                  "coarse PVS keeps distant regions sleeping");
    TEST_ASSERT_EQUAL_INT(R2D_WORLD_REGION_SLEEPING, states[1]);
    TEST_ASSERT_EQUAL_INT(1, r2d_world_region_stream(&b.set, states, 8, 1));
    TEST_ASSERT_EQUAL_INT(R2D_WORLD_REGION_UNLOADED, states[1]);
}

static void test_region_local_coordinates(void)
{
    RegionBuffers b;
    init_buffers(&b);
    char error[128] = {0};
    TEST_ASSERT_EQUAL_INT(4, build(&b, CELL_RECTS, CELLS, PORTAL_LINKS, PORTALS,
                                   100.0f, error));
    float lx = 0, ly = 0;
    TEST_ASSERT_TRUE(r2d_world_region_local(&b.set, 0, 60.0f, 70.0f, &lx, &ly));
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 10.0f, lx);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 20.0f, ly);
    TEST_ASSERT_TRUE(r2d_world_region_local(&b.set, 3, 160.0f, 170.0f, &lx, &ly));
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 10.0f, lx);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 20.0f, ly);
    TEST_ASSERT_FALSE(r2d_world_region_local(&b.set, 99, 0, 0, &lx, &ly));
}

static void test_lod_thresholds(void)
{
    R2DWorldRegionLod lod;
    r2d_world_region_lod(100.0f, &lod);
    TEST_ASSERT_EQUAL_INT(16, lod.sprite_directions);
    TEST_ASSERT_FALSE(lod.impostor);
    r2d_world_region_lod(1000.0f, &lod);
    TEST_ASSERT_EQUAL_INT(8, lod.sprite_directions);
    r2d_world_region_lod(2000.0f, &lod);
    TEST_ASSERT_EQUAL_INT(4, lod.sprite_directions);
    TEST_ASSERT_TRUE(lod.impostor);
    r2d_world_region_lod(5000.0f, &lod);
    TEST_ASSERT_EQUAL_INT(1, lod.sprite_directions);
    r2d_world_region_lod(9000.0f, &lod);
    TEST_ASSERT_TRUE(lod.hidden);
    TEST_ASSERT_EQUAL_INT(0, lod.animation_fps);
    r2d_world_region_lod(NAN, &lod);
    TEST_ASSERT_FALSE(lod.hidden);
}

static void test_deterministic_rebuild(void)
{
    RegionBuffers a, b;
    init_buffers(&a);
    init_buffers(&b);
    char error[128] = {0};
    TEST_ASSERT_EQUAL_INT(4, build(&a, CELL_RECTS, CELLS, PORTAL_LINKS, PORTALS,
                                   100.0f, error));
    TEST_ASSERT_EQUAL_INT(4, build(&b, CELL_RECTS, CELLS, PORTAL_LINKS, PORTALS,
                                   100.0f, error));
    TEST_ASSERT_EQUAL_INT(0, memcmp(a.cell_region, b.cell_region,
                                    sizeof a.cell_region));
    TEST_ASSERT_EQUAL_INT(0, memcmp(a.region_cells, b.region_cells,
                                    sizeof a.region_cells));
    TEST_ASSERT_EQUAL_INT(0, memcmp(a.region_portal_offsets,
                                    b.region_portal_offsets,
                                    sizeof a.region_portal_offsets));
    TEST_ASSERT_EQUAL_INT(0, memcmp(a.pvs, b.pvs, sizeof a.pvs));
}

static void test_invalid_arguments(void)
{
    RegionBuffers b;
    init_buffers(&b);
    char error[128] = {0};
    R2DWorldRegionCell bad = {0, 0, 0, 10};
    R2DWorldRegionPortal bad_portal = {0, 99, false, false};
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_region_build(NULL, 4, NULL, 0, 100,
                                                     &b.set, error, 128));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_region_build(CELL_RECTS, 0, NULL, 0,
                                                     100, &b.set, error, 128));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_region_build(CELL_RECTS, CELLS, NULL, 0,
                                                     0, &b.set, error, 128));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_region_build(CELL_RECTS, CELLS, NULL, 1,
                                                     100, &b.set, error, 128));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_region_build(&bad, 1, NULL, 0, 100,
                                                     &b.set, error, 128));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_region_build(CELL_RECTS, 4, &bad_portal,
                                                     1, 100, &b.set, error, 128));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_region_update_active(NULL, 0, 0, 1,
                                                             NULL, 0, NULL, 0,
                                                             NULL, 0));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_region_update_active(&b.set, 0, 0, 1,
                                                             NULL, 0, NULL, 0,
                                                             NULL, 0));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_region_stream(NULL, NULL, 0, 1));
    TEST_ASSERT_FALSE(r2d_world_region_rebuild_pvs(NULL, PORTAL_LINKS, 4));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_build_grid_and_partition);
    RUN_TEST(test_sizing_call);
    RUN_TEST(test_pvs_open_and_closed);
    RUN_TEST(test_areaportal_closed_isolation);
    RUN_TEST(test_active_preload_rings_and_streaming);
    RUN_TEST(test_region_local_coordinates);
    RUN_TEST(test_lod_thresholds);
    RUN_TEST(test_deterministic_rebuild);
    RUN_TEST(test_invalid_arguments);
    return UNITY_END();
}
