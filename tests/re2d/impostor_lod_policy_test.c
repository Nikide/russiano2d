// BASHNYA 1.2.6 impostor LOD policy: distant silhouette cards must not be
// emitted inside the region-LOD near band, where the local renderer still draws
// the same region. Cards beyond the near band stay visible. The gate is derived
// from the configured near distance; only an explicit near band of 0 disables it.
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

static void test_gate_follows_near_band(void)
{
    R2DWorldRegionLodConfig config;
    r2d_world_region_lod_defaults(&config);
    TEST_ASSERT_EQUAL_FLOAT(config.near_distance,
                            r2d_world_region_impostor_min_distance(&config));
    // A large near band widens the gate; BASHNYA's explicit request.
    config.near_distance = 8000.0f;
    TEST_ASSERT_EQUAL_FLOAT(8000.0f,
                            r2d_world_region_impostor_min_distance(&config));
    // Explicit near band 0 = no gate; this cannot happen from the defaults.
    config.near_distance = 0.0f;
    TEST_ASSERT_EQUAL_FLOAT(0.0f, r2d_world_region_impostor_min_distance(&config));
    TEST_ASSERT_EQUAL_FLOAT(0.0f, r2d_world_region_impostor_min_distance(NULL));
}

static void test_collect_suppresses_cards_inside_near_band(void)
{
    R2DWorldRegionCell cells[3] = {
        {0, 0, 100, 100}, {100, 0, 100, 100}, {200, 0, 100, 100}};
    R2DWorldRegionPortal portals[2] = {{0, 1, false, false}, {1, 2, false, false}};
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
    R2DWorldImpostorSet cards;
    memset(&cards, 0, sizeof cards);
    char error[128] = {0};
    // Sizing call first, exactly like the runtime bake.
    TEST_ASSERT_EQUAL_INT(3, r2d_world_impostors_build(&set, world_cells, 3,
                                                       spans, 3, &cards,
                                                       error, sizeof error));
    cards.items = (R2DWorldImpostor *)calloc(3, sizeof *cards.items);
    cards.capacity = 3;
    TEST_ASSERT_EQUAL_INT(3, r2d_world_impostors_build(&set, world_cells, 3,
                                                       spans, 3, &cards,
                                                       error, sizeof error));

    // Camera at (50,50) in region 0: region centres are 100 and 200 units away.
    R2DWorldRegionLodConfig config;
    r2d_world_region_lod_defaults(&config);
    config.near_distance = 150.0f;
    const float min_distance = r2d_world_region_impostor_min_distance(&config);

    R2DWorldImpostor out[4];
    const int near_gated = r2d_world_impostors_collect(
        &cards, &set, 0, NULL, 0, 50.0f, 50.0f, min_distance, 10000.0f, out, 4);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, near_gated,
                                  "only the region beyond the near band keeps a card");
    TEST_ASSERT_EQUAL_INT(2, out[0].region);
    TEST_ASSERT_TRUE(out[0].distance > config.near_distance);

    // Without the gate both distant regions are candidates: this is the old
    // BASHNYA bug (min_distance=0 passed regardless of the near band).
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, r2d_world_impostors_collect(
        &cards, &set, 0, NULL, 0, 50.0f, 50.0f, 0.0f, 10000.0f, out, 4),
        "ungated collect reproduces the 1.2.6 duplicate-card behaviour");

    // BASHNYA `regionConfig(8192,1,2)`: one region total, current region is the
    // only card candidate, so no card is emitted inside or outside the band.
    R2DWorldRegionCell single[1] = {{0, 0, 100, 100}};
    TEST_ASSERT_EQUAL_INT(1, build_regions(single, 1, NULL, 0, 100.0f));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_impostors_collect(
        &cards, &set, 0, NULL, 0, 50.0f, 50.0f, min_distance, 10000.0f, out, 4));

    r2d_world_impostors_free(&cards);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_gate_follows_near_band);
    RUN_TEST(test_collect_suppresses_cards_inside_near_band);
    return UNITY_END();
}
