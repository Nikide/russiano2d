#include "re2d_world.h"
#include "re2d_world_region.h"
#include "unity.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static R2DRe2dWorld world;
static R2DWorldVisibility visibility;

static void build_world(void)
{
    R2DWorldSpan spans[2] = {
        {0, 0, 100, 100, 0, 120, 0x111111u, 0x222222u, 0, 0, 0, 0},
        {100, 0, 100, 100, 0, 120, 0x333333u, 0x444444u, 0, 0, 0, 0},
    };
    R2DWorldCell cells[2] = {{0, 0, 100, 100, 0, 1}, {100, 0, 100, 100, 1, 1}};
    R2DWorldOpening opening = {0, 120};
    R2DWorldPortal portal = {0};
    portal.cell_a = 0;
    portal.cell_b = 1;
    portal.first_opening = 0;
    portal.opening_count = 1;
    portal.ax = 100;
    portal.ay = 0;
    portal.bx = 100;
    portal.by = 100;
    char error[256] = {0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build_cells(&world, NULL, 0, spans, 2, cells, 2,
                                                   &portal, 1, &opening, 1, error,
                                                   sizeof error),
                             "two-cell world builds");
}

static void make_view(R2DRe2dView *view)
{
    r2d_re2d_view_set(view, 50, 50, 60, 0, 0, 1.2f, 640, 360);
    view->near_plane = 0.1f;
}

static bool span_in_cell(int span, int cell)
{
    return span >= world.cells[cell].first_span &&
           span < world.cells[cell].first_span + world.cells[cell].span_count;
}

static void test_filter_matches_full_pvs(void)
{
    build_world();
    R2DRe2dView view;
    make_view(&view);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_visibility(&world, &view, 0, &visibility),
                             "unfiltered visibility builds");
    int full_count = visibility.span_count;
    uint8_t allowed[2] = {1, 1};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_visibility_filtered(&world, &view, 0, &visibility,
                                                           allowed),
                             "filtered visibility accepts all cells");
    TEST_ASSERT_EQUAL_INT_MESSAGE(full_count, visibility.span_count,
                                  "all-allowed filter matches local BSP visibility");
    TEST_ASSERT_EQUAL_INT(0, visibility.culled_cells);
    r2d_world_visibility_free(&visibility);
    r2d_world_free(&world);
}

static void test_region_reject_cuts_before_local_bsp(void)
{
    build_world();
    R2DRe2dView view;
    make_view(&view);
    uint8_t allowed[2] = {1, 0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_visibility_filtered(&world, &view, 0, &visibility,
                                                           allowed),
                             "region reject still produces a valid visible set");
    TEST_ASSERT_TRUE_MESSAGE(visibility.span_count >= 1, "camera cell remains visible");
    for (int i = 0; i < visibility.span_count; i++)
        TEST_ASSERT_FALSE_MESSAGE(span_in_cell(visibility.spans[i], 1),
                                  "rejected region spans never enter local BSP");
    TEST_ASSERT_TRUE_MESSAGE(visibility.cell_rejections > 0,
                             "reject counter reports dropped portal/BSP branches");
    r2d_world_visibility_free(&visibility);
    r2d_world_free(&world);
}

static void test_closed_areaportal_and_cluster_pvs(void)
{
    build_world();
    R2DWorldRegionCell region_cells[2] = {{0, 0, 100, 100}, {100, 0, 100, 100}};
    R2DWorldRegionPortal region_portals[1] = {{0, 1, false, true}};
    R2DWorldRegionSet sizing;
    memset(&sizing, 0, sizeof sizing);
    char error[128] = {0};
    TEST_ASSERT_EQUAL_INT(2, r2d_world_region_build(region_cells, 2, region_portals, 1,
                                                    100.0f, &sizing, error,
                                                    sizeof error));
    R2DWorldRegionSet regions;
    memset(&regions, 0, sizeof regions);
    regions.regions = calloc(2, sizeof *regions.regions);
    regions.cell_region = calloc(2, sizeof *regions.cell_region);
    regions.region_cells = calloc(2, sizeof *regions.region_cells);
    regions.region_portal_offsets = calloc(3, sizeof *regions.region_portal_offsets);
    regions.region_portal_refs = calloc(2, sizeof *regions.region_portal_refs);
    regions.region_adj_offsets = calloc(3, sizeof *regions.region_adj_offsets);
    regions.region_adj_refs = calloc(2, sizeof *regions.region_adj_refs);
    regions.pvs = calloc(2, sizeof *regions.pvs);
    regions.region_capacity = 2;
    regions.cell_region_capacity = 2;
    regions.region_cells_capacity = 2;
    regions.region_portal_offsets_capacity = 3;
    regions.region_portal_refs_capacity = 2;
    regions.region_adj_offsets_capacity = 3;
    regions.region_adj_refs_capacity = 2;
    regions.pvs_capacity = 2;
    TEST_ASSERT_EQUAL_INT(2, r2d_world_region_build(region_cells, 2, region_portals, 1,
                                                    100.0f, &regions, error,
                                                    sizeof error));
    uint8_t visible[2] = {0};
    TEST_ASSERT_EQUAL_INT(2, r2d_world_region_visible_set(&regions, 0, NULL, 0,
                                                          50, 50, visible, 2));
    TEST_ASSERT_EQUAL_INT(1, visible[1]);
    region_portals[0].closed = true;
    TEST_ASSERT_TRUE(r2d_world_region_rebuild_pvs(&regions, region_portals, 1));
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_region_visible(&regions, 0, 1),
                              "closed areaportal removes the coarse region edge");
    TEST_ASSERT_EQUAL_INT(1, r2d_world_region_visible_set(&regions, 0, NULL, 0,
                                                          50, 50, visible, 2));
    TEST_ASSERT_EQUAL_INT(0, visible[1]);

    R2DWorldClusterSet cluster_sizing;
    memset(&cluster_sizing, 0, sizeof cluster_sizing);
    int clusters = r2d_world_region_clusters_build(&regions, 1, region_portals, 1,
                                                   &cluster_sizing, error,
                                                   sizeof error);
    TEST_ASSERT_EQUAL_INT(2, clusters);
    R2DWorldClusterSet cluster_set;
    memset(&cluster_set, 0, sizeof cluster_set);
    cluster_set.clusters = calloc((size_t)clusters, sizeof *cluster_set.clusters);
    cluster_set.cell_cluster = calloc(2, sizeof *cluster_set.cell_cluster);
    cluster_set.cluster_cells = calloc(2, sizeof *cluster_set.cluster_cells);
    cluster_set.cluster_portal_offsets = calloc((size_t)clusters + 1,
                                                sizeof *cluster_set.cluster_portal_offsets);
    cluster_set.cluster_portal_refs = calloc(2, sizeof *cluster_set.cluster_portal_refs);
    cluster_set.pvs = calloc((size_t)clusters, sizeof *cluster_set.pvs);
    cluster_set.cluster_capacity = clusters;
    cluster_set.cell_cluster_capacity = 2;
    cluster_set.cluster_cells_capacity = 2;
    cluster_set.cluster_portal_offsets_capacity = clusters + 1;
    cluster_set.cluster_portal_refs_capacity = 2;
    cluster_set.pvs_capacity = clusters;
    TEST_ASSERT_EQUAL_INT(2, r2d_world_region_clusters_build(&regions, 1,
                                                             region_portals, 1,
                                                             &cluster_set, error,
                                                             sizeof error));
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_region_cluster_visible(&cluster_set, 0, 1),
                              "closed areaportal cuts cluster PVS too");
    r2d_world_region_clusters_free(&cluster_set);
    r2d_world_region_clusters_free(&cluster_set); // double free is safe

    // A closed portal also stops the local portal walk, so both hierarchy
    // levels agree.
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_portal_set_closed(&world, 0, true),
                             "runtime closes the same areaportal");
    R2DRe2dView view;
    make_view(&view);
    TEST_ASSERT_TRUE(r2d_world_visibility(&world, &view, 0, &visibility));
    TEST_ASSERT_TRUE(visibility.span_count >= 1);
    for (int i = 0; i < visibility.span_count; i++)
        TEST_ASSERT_FALSE_MESSAGE(span_in_cell(visibility.spans[i], 1),
                                  "closed local portal cuts the destination cell");
    r2d_world_visibility_free(&visibility);
    free(regions.regions);
    free(regions.cell_region);
    free(regions.region_cells);
    free(regions.region_portal_offsets);
    free(regions.region_portal_refs);
    free(regions.region_adj_offsets);
    free(regions.region_adj_refs);
    free(regions.pvs);
    r2d_world_free(&world);
}

static void test_camera_on_portal_plane_keeps_visibility(void)
{
    // Regression (BASHNYA spawn on a cell border): a camera exactly on a portal
    // plane used to lose the portal because the projected aperture degenerates
    // to a line and near-plane clipping drops it, collapsing visibility to the
    // seed cell. The camera stands in the aperture, so the portal must stay
    // reachable (conservative full-view window).
    build_world();
    R2DRe2dView view;
    // Camera at the portal endpoint (100,0), on the portal plane, looking -X.
    r2d_re2d_view_set(&view, 100, 0, 60, -1.5707964f, 0, 1.2f, 640, 360);
    view.near_plane = 3.0f;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_visibility(&world, &view, 0, &visibility),
                             "on-plane visibility builds");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, visibility.span_count,
                                  "camera on the portal plane reaches both cells");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, visibility.cells_visible,
                                  "camera on the portal plane counts both cells");
    r2d_world_visibility_free(&visibility);

    // Just off the plane in either direction must keep both cells too.
    for (int side = -1; side <= 1; side += 2) {
        r2d_re2d_view_set(&view, 100, 0.25f * (float)side, 60, -1.5707964f, 0,
                          1.2f, 640, 360);
        view.near_plane = 3.0f;
        TEST_ASSERT_TRUE(r2d_world_visibility(&world, &view, 0, &visibility));
        TEST_ASSERT_EQUAL_INT_MESSAGE(2, visibility.span_count,
                                      "near-plane camera still sees both cells");
        r2d_world_visibility_free(&visibility);
    }
    r2d_world_free(&world);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_filter_matches_full_pvs);
    RUN_TEST(test_region_reject_cuts_before_local_bsp);
    RUN_TEST(test_closed_areaportal_and_cluster_pvs);
    RUN_TEST(test_camera_on_portal_plane_keeps_visibility);
    return UNITY_END();
}
