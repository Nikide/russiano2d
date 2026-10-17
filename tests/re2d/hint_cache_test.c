#include "re2d_world.h"
#include "re2d_world_hint.h"
#include "re2d_world_region.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static bool build_pair(R2DRe2dWorld *world, bool hint, bool skip)
{
    const R2DWorldSpan spans[2] = {
        {0, 0, 100, 100, 0, 80, 0, 0, 0, 0, 0, 0},
        {100, 0, 100, 100, 0, 80, 0, 0, 0, 0, 0, 0}
    };
    const R2DWorldCell cells[2] = {
        {0, 0, 100, 100, 0, 1},
        {100, 0, 100, 100, 1, 1}
    };
    const R2DWorldOpening openings[1] = {{0, 80}};
    const R2DWorldPortal portal = {0, 1, 0, 1, 100, 0, 100, 100, false, 1.0f,
                                    false, false, false};
    R2DWorldWall marker;
    memset(&marker, 0, sizeof marker);
    marker.x1 = marker.x2 = 100;
    marker.y1 = 0; marker.y2 = 100;
    marker.bottom = 0; marker.top = 80;
    marker.color = 0xff00ffff;
    marker.flags = hint ? (uint16_t)R2D_WALL_TOOL_HINT
                        : (uint16_t)R2D_WALL_TOOL_SKIP;
    char error[256] = {0};
    memset(world, 0, sizeof *world);
    const int nw = (hint || skip) ? 1 : 0;
    return r2d_world_build_cells(world, nw ? &marker : NULL, nw,
                                 spans, 2, cells, 2, &portal, 1,
                                 openings, 1, error, sizeof error);
}

static bool build_occluder_world(R2DRe2dWorld *world)
{
    const R2DWorldSpan spans[2] = {
        {0, 0, 100, 100, 0, 80, 0, 0, 0, 0, 0, 0},
        {300, 0, 100, 100, 0, 80, 0, 0, 0, 0, 0, 0}
    };
    const R2DWorldCell cells[2] = {
        {0, 0, 100, 100, 0, 1},
        {300, 0, 100, 100, 1, 1}
    };
    R2DWorldWall occluder;
    memset(&occluder, 0, sizeof occluder);
    occluder.x1 = occluder.x2 = 75;
    occluder.y1 = -100; occluder.y2 = 200;
    occluder.bottom = 0; occluder.top = 80;
    occluder.color = 0;
    occluder.flags = (uint16_t)R2D_WALL_OCCLUDER;
    char error[256] = {0};
    memset(world, 0, sizeof *world);
    return r2d_world_build_cells(world, &occluder, 1, spans, 2, cells, 2,
                                 NULL, 0, NULL, 0, error, sizeof error);
}

static R2DRe2dView make_view(float x, float y)
{
    R2DRe2dView view;
    r2d_re2d_view_set(&view, x, y, 40, 0, 0, 1.2f, 64, 48);
    view.near_plane = 0.1f;
    return view;
}

static void build_cache(const R2DRe2dWorld *world, R2DWorldHintCache *cache,
                        R2DWorldHintBarrier *barriers, int barrier_cap,
                        R2DWorldOccluder *occluders, int occluder_cap)
{
    memset(cache, 0, sizeof *cache);
    cache->barriers = barriers;
    cache->barrier_capacity = barrier_cap;
    cache->occluders = occluders;
    cache->occluder_capacity = occluder_cap;
    char error[128] = {0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_hint_cache_build(world, cache, error,
                                                        sizeof error), error);
}

static void test_hint_counts_and_portal_barrier(void)
{
    R2DRe2dWorld hinted, plain;
    TEST_ASSERT_TRUE(build_pair(&hinted, true, false));
    TEST_ASSERT_TRUE(build_pair(&plain, false, false));
    int hints = -1, skips = -1, occluders = -1;
    r2d_world_hint_counts(&hinted, &hints, &skips, &occluders);
    TEST_ASSERT_EQUAL_INT(1, hints);
    TEST_ASSERT_EQUAL_INT(0, skips);
    TEST_ASSERT_EQUAL_INT(0, occluders);
    r2d_world_hint_counts(&plain, &hints, &skips, &occluders);
    TEST_ASSERT_EQUAL_INT(0, hints);
    TEST_ASSERT_EQUAL_INT(0, skips);
    TEST_ASSERT_EQUAL_INT(0, occluders);

    R2DWorldHintBarrier barriers[4];
    R2DWorldOccluder segments[4];
    R2DWorldHintCache cache;
    build_cache(&hinted, &cache, barriers, 4, segments, 4);
    TEST_ASSERT_EQUAL_INT(1, cache.hint_markers);
    TEST_ASSERT_EQUAL_INT(1, cache.barrier_count);
    TEST_ASSERT_EQUAL_INT(0, cache.skip_markers);
    TEST_ASSERT_EQUAL_INT(0, cache.occluder_count);
    TEST_ASSERT_TRUE(r2d_world_hint_portal_blocked(&cache, &hinted, &hinted.portals[0]));
    TEST_ASSERT_FALSE(r2d_world_hint_rebuild_needed(&cache, &hinted));
    hinted.topology_revision++;
    TEST_ASSERT_TRUE(r2d_world_hint_rebuild_needed(&cache, &hinted));
    hinted.topology_revision--;

    R2DRe2dView view = make_view(50, 50);
    R2DWorldVisibility visible;
    memset(&visible, 0, sizeof visible);
    TEST_ASSERT_TRUE(r2d_world_visibility_filtered_ex(&hinted, &view, 0.0f,
                                                      &visible, NULL, &cache));
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, visible.cells_visible,
                                  "hint barrier cuts view traversal at the portal");
    TEST_ASSERT_EQUAL_INT(1, visible.hint_markers);
    TEST_ASSERT_TRUE(visible.hint_portals_tested >= 1);
    TEST_ASSERT_TRUE(visible.hint_portals_cut >= 1);
    TEST_ASSERT_EQUAL_INT(0, visible.occluder_cells_cut);
    r2d_world_visibility_free(&visible);

    memset(&visible, 0, sizeof visible);
    TEST_ASSERT_TRUE(r2d_world_visibility(&plain, &view, 0.0f, &visible));
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, visible.cells_visible,
                                  "plain portal still reaches both rooms");
    TEST_ASSERT_EQUAL_INT(0, visible.hint_markers);
    TEST_ASSERT_EQUAL_INT(0, visible.hint_portals_cut);
    r2d_world_visibility_free(&visible);
    r2d_world_free(&hinted);
    r2d_world_free(&plain);
}

static void test_legacy_map_is_unchanged(void)
{
    R2DRe2dWorld world;
    TEST_ASSERT_TRUE(build_pair(&world, false, false));
    R2DWorldHintBarrier barriers[4];
    R2DWorldOccluder segments[4];
    R2DWorldHintCache cache;
    build_cache(&world, &cache, barriers, 4, segments, 4);
    TEST_ASSERT_EQUAL_INT(0, cache.barrier_count);
    TEST_ASSERT_EQUAL_INT(0, cache.occluder_count);
    R2DRe2dView view = make_view(50, 50);
    R2DWorldVisibility legacy, empty;
    memset(&legacy, 0, sizeof legacy);
    memset(&empty, 0, sizeof empty);
    TEST_ASSERT_TRUE(r2d_world_visibility(&world, &view, 0.0f, &legacy));
    TEST_ASSERT_TRUE(r2d_world_visibility_filtered_ex(&world, &view, 0.0f,
                                                      &empty, NULL, &cache));
    TEST_ASSERT_EQUAL_INT(legacy.cells_visible, empty.cells_visible);
    TEST_ASSERT_EQUAL_INT(legacy.span_count, empty.span_count);
    TEST_ASSERT_EQUAL_INT(legacy.surface_count, empty.surface_count);
    TEST_ASSERT_EQUAL_INT(0, empty.hint_markers);
    TEST_ASSERT_EQUAL_INT(0, empty.occluder_cells_tested);
    TEST_ASSERT_EQUAL_INT(0, empty.occluder_cells_cut);
    r2d_world_visibility_free(&legacy);
    r2d_world_visibility_free(&empty);
    r2d_world_free(&world);
}

static void test_skip_marker_is_ignored_at_runtime(void)
{
    R2DRe2dWorld world;
    TEST_ASSERT_TRUE(build_pair(&world, false, true));
    int hints = -1, skips = -1, occluders = -1;
    r2d_world_hint_counts(&world, &hints, &skips, &occluders);
    TEST_ASSERT_EQUAL_INT(0, hints);
    TEST_ASSERT_EQUAL_INT(1, skips);
    R2DWorldHintBarrier barriers[4];
    R2DWorldOccluder segments[4];
    R2DWorldHintCache cache;
    build_cache(&world, &cache, barriers, 4, segments, 4);
    TEST_ASSERT_EQUAL_INT(0, cache.barrier_count);
    R2DRe2dView view = make_view(50, 50);
    R2DWorldVisibility visible;
    memset(&visible, 0, sizeof visible);
    TEST_ASSERT_TRUE(r2d_world_visibility_filtered_ex(&world, &view, 0.0f,
                                                      &visible, NULL, &cache));
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, visible.cells_visible,
                                  "skip is compiler-only and never cuts runtime views");
    TEST_ASSERT_EQUAL_INT(1, visible.skip_markers);
    TEST_ASSERT_EQUAL_INT(0, visible.hint_portals_cut);
    r2d_world_visibility_free(&visible);
    r2d_world_free(&world);
}

static void test_occluder_culls_cells_and_counters(void)
{
    R2DRe2dWorld world;
    TEST_ASSERT_TRUE(build_occluder_world(&world));
    int hints = -1, skips = -1, occluders = -1;
    r2d_world_hint_counts(&world, &hints, &skips, &occluders);
    TEST_ASSERT_EQUAL_INT(1, occluders);
    R2DWorldHintBarrier barriers[4];
    R2DWorldOccluder segments[4];
    R2DWorldHintCache cache;
    build_cache(&world, &cache, barriers, 4, segments, 4);
    TEST_ASSERT_EQUAL_INT(1, cache.occluder_count);
    TEST_ASSERT_TRUE(r2d_world_hint_cell_occluded(&cache, 300, 0, 100, 100, 50, 50));
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_hint_cell_occluded(&cache, 0, 0, 100, 100, 50, 50),
                              "a cell containing the camera is never occluded");

    R2DRe2dView view = make_view(50, 50);
    R2DWorldVisibility plain, filtered;
    memset(&plain, 0, sizeof plain);
    memset(&filtered, 0, sizeof filtered);
    TEST_ASSERT_TRUE(r2d_world_visibility_filtered_ex(&world, &view, 200.0f,
                                                      &plain, NULL, NULL));
    TEST_ASSERT_EQUAL_INT(2, plain.cells_visible);
    TEST_ASSERT_EQUAL_INT(0, plain.occluder_cells_cut);
    TEST_ASSERT_TRUE(r2d_world_visibility_filtered_ex(&world, &view, 200.0f,
                                                      &filtered, NULL, &cache));
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, filtered.cells_visible,
                                  "occluder segment hides the far cell");
    TEST_ASSERT_EQUAL_INT(1, filtered.occluder_segments);
    TEST_ASSERT_EQUAL_INT(2, filtered.occluder_cells_tested);
    TEST_ASSERT_EQUAL_INT(1, filtered.occluder_cells_cut);
    TEST_ASSERT_TRUE(filtered.culled_cells >= 1);
    r2d_world_visibility_free(&plain);
    r2d_world_visibility_free(&filtered);
    r2d_world_free(&world);
}

static void test_occluder_culls_coarse_region(void)
{
    // Synthetic region partition: two adjacent regions with an open portal.
    const R2DWorldRegionCell cells[2] = {{0, 0, 100, 100}, {100, 0, 100, 100}};
    const R2DWorldRegionPortal portals[1] = {{0, 1, false, false}};
    R2DWorldRegionSet sizing;
    memset(&sizing, 0, sizeof sizing);
    char error[128] = {0};
    const int regions = r2d_world_region_build(cells, 2, portals, 1, 100.0f,
                                               &sizing, error, sizeof error);
    TEST_ASSERT_EQUAL_INT(2, regions);
    R2DWorldRegion region_array[2];
    int cell_region[2], region_cells[2];
    int portal_offsets[3], portal_refs[4];
    int adj_offsets[3], adj_refs[4];
    uint64_t pvs[2];
    R2DWorldRegionSet set;
    memset(&set, 0, sizeof set);
    set.regions = region_array; set.region_capacity = 2;
    set.cell_region = cell_region; set.cell_region_capacity = 2;
    set.region_cells = region_cells; set.region_cells_capacity = 2;
    set.region_portal_offsets = portal_offsets; set.region_portal_offsets_capacity = 3;
    set.region_portal_refs = portal_refs; set.region_portal_refs_capacity = 4;
    set.region_adj_offsets = adj_offsets; set.region_adj_offsets_capacity = 3;
    set.region_adj_refs = adj_refs; set.region_adj_refs_capacity = 4;
    set.pvs = pvs; set.pvs_capacity = 2;
    TEST_ASSERT_EQUAL_INT(2, r2d_world_region_build(cells, 2, portals, 1, 100.0f,
                                                    &set, error, sizeof error));
    TEST_ASSERT_TRUE(r2d_world_region_visible(&set, 0, 1));
    TEST_ASSERT_FALSE(r2d_world_region_occluded(&set, 1, NULL, 0, 50, 50));

    R2DRe2dWorld world;
    TEST_ASSERT_TRUE(build_occluder_world(&world));
    R2DWorldHintBarrier barriers[4];
    R2DWorldOccluder segments[4];
    R2DWorldHintCache cache;
    build_cache(&world, &cache, barriers, 4, segments, 4);
    TEST_ASSERT_TRUE(r2d_world_region_occluded(&set, 1, cache.occluders,
                                               cache.occluder_count, 50, 50));
    uint8_t visible[2];
    const int count = r2d_world_region_visible_set(&set, 0, cache.occluders,
                                                   cache.occluder_count,
                                                   50, 50, visible, 2);
    TEST_ASSERT_EQUAL_INT(1, count);
    TEST_ASSERT_TRUE(visible[0]);
    TEST_ASSERT_FALSE_MESSAGE(visible[1],
                              "coarse region behind the occluder chain is culled");
    r2d_world_free(&world);
}

static void test_deterministic_cache_and_invalid_args(void)
{
    R2DRe2dWorld world;
    TEST_ASSERT_TRUE(build_pair(&world, true, false));
    R2DWorldHintBarrier first[4], second[4];
    R2DWorldOccluder first_seg[4], second_seg[4];
    R2DWorldHintCache a, b;
    build_cache(&world, &a, first, 4, first_seg, 4);
    build_cache(&world, &b, second, 4, second_seg, 4);
    TEST_ASSERT_EQUAL_INT(a.barrier_count, b.barrier_count);
    TEST_ASSERT_EQUAL_INT(0, memcmp(first, second, (size_t)a.barrier_count * sizeof *first));
    TEST_ASSERT_EQUAL_INT(a.occluder_count, b.occluder_count);
    TEST_ASSERT_EQUAL_INT(0, memcmp(first_seg, second_seg,
                                    (size_t)a.occluder_count * sizeof *first_seg));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_hint_portal_blocked(NULL, NULL, NULL));
    TEST_ASSERT_FALSE(r2d_world_hint_cache_build(NULL, &a, NULL, 0));
    R2DWorldHintCache tiny;
    memset(&tiny, 0, sizeof tiny);
    char error[64] = {0};
    TEST_ASSERT_FALSE(r2d_world_hint_cache_build(&world, &tiny, error, sizeof error));
    TEST_ASSERT_NOT_NULL(strstr(error, "capacity"));
    r2d_world_free(&world);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_hint_counts_and_portal_barrier);
    RUN_TEST(test_legacy_map_is_unchanged);
    RUN_TEST(test_skip_marker_is_ignored_at_runtime);
    RUN_TEST(test_occluder_culls_cells_and_counters);
    RUN_TEST(test_occluder_culls_coarse_region);
    RUN_TEST(test_deterministic_cache_and_invalid_args);
    return UNITY_END();
}
