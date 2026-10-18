// Portal closure surfaces: the builder derives, per portal opening, a
// specialised wall whose open interval is carved out by the renderer/rays, and
// per portal plane a wall for every solid band between/around the openings.
// The second kind closes the structural slab between stacked spans so the
// panorama cannot leak through it (BASHNYA 1.2.6 "pink sky strips").
#include "re2d_world.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-3f

static const R2DWorldSpan two_storey_spans[] = {
    {0.0f, 0.0f, 100.0f, 100.0f, 0.0f, 3.0f, 0, 0, 0, 0, 0, 0},
    {0.0f, 0.0f, 100.0f, 100.0f, 6.0f, 9.0f, 0, 0, 0, 0, 0, 0},
    {100.0f, 0.0f, 100.0f, 100.0f, 0.0f, 3.0f, 0, 0, 0, 0, 0, 0},
    {100.0f, 0.0f, 100.0f, 100.0f, 6.0f, 9.0f, 0, 0, 0, 0, 0, 0}
};
static const R2DWorldCell two_storey_cells[] = {
    {0.0f, 0.0f, 100.0f, 100.0f, 0, 2},
    {100.0f, 0.0f, 100.0f, 100.0f, 2, 2}
};
static const R2DWorldOpening two_storey_openings[] = {{0.0f, 3.0f}, {6.0f, 9.0f}};
static R2DWorldPortal two_storey_portal(void)
{
    R2DWorldPortal portal = {0, 1, 0, 2, 100.0f, 0.0f, 100.0f, 100.0f, false};
    portal.open_fraction = 1.0f;
    return portal;
}

static bool wall_on_plane(const R2DWorldWall *wall, float ax, float ay, float bx, float by)
{
    const bool forward = fabsf(wall->x1 - ax) <= EPS && fabsf(wall->y1 - ay) <= EPS &&
                         fabsf(wall->x2 - bx) <= EPS && fabsf(wall->y2 - by) <= EPS;
    const bool reverse = fabsf(wall->x1 - bx) <= EPS && fabsf(wall->y1 - by) <= EPS &&
                         fabsf(wall->x2 - ax) <= EPS && fabsf(wall->y2 - ay) <= EPS;
    return forward || reverse;
}

static int walls_covering(const R2DRe2dWorld *world, float bottom, float top)
{
    int count = 0;
    for (int i = 0; i < world->wall_count; ++i) {
        const R2DWorldWall *wall = &world->walls[i];
        if (!wall_on_plane(wall, 100.0f, 0.0f, 100.0f, 100.0f)) continue;
        if (fabsf(wall->bottom - bottom) <= EPS && fabsf(wall->top - top) <= EPS) count++;
    }
    return count;
}

static void test_solid_band_between_openings_is_closed(void)
{
    R2DRe2dWorld world;
    memset(&world, 0, sizeof world);
    R2DWorldPortal portal = two_storey_portal();
    char err[256];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build_cells(&world, NULL, 0, two_storey_spans, 4,
                                                   two_storey_cells, 2, &portal, 1,
                                                   two_storey_openings, 2, err, sizeof err), err);
    // Two opening closures + one solid-band closure over the 3..6 gap.
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, world.wall_count,
                                  "two opening closures plus one solid-band closure");
    TEST_ASSERT_EQUAL_INT(1, walls_covering(&world, 3.0f, 6.0f));

    // The slab band blocks movement and rays; the authored openings stay open.
    TEST_ASSERT_TRUE(r2d_world_blocked(&world, 100.0f, 50.0f, 1.0f, 3.5f, 5.5f));
    TEST_ASSERT_FALSE(r2d_world_blocked(&world, 100.0f, 50.0f, 1.0f, 1.0f, 2.0f));
    TEST_ASSERT_FALSE(r2d_world_blocked(&world, 100.0f, 50.0f, 1.0f, 7.0f, 8.0f));

    R2DWorldHit hit;
    const float slab_o[3] = {50.0f, 50.0f, 4.5f}, slab_d[3] = {100.0f, 0.0f, 0.0f};
    TEST_ASSERT_TRUE(r2d_world_ray(&world, slab_o, slab_d, 0.0f, 1.0f, &hit));
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 0.5f, hit.t);
    const float lower_o[3] = {50.0f, 50.0f, 1.5f}, lower_d[3] = {100.0f, 0.0f, 0.0f};
    TEST_ASSERT_FALSE(r2d_world_ray(&world, lower_o, lower_d, 0.0f, 1.0f, &hit));
    const float upper_o[3] = {50.0f, 50.0f, 7.5f}, upper_d[3] = {100.0f, 0.0f, 0.0f};
    TEST_ASSERT_FALSE(r2d_world_ray(&world, upper_o, upper_d, 0.0f, 1.0f, &hit));

    r2d_world_free(&world);
}

static void test_authored_wall_suppresses_duplicate_closure(void)
{
    R2DRe2dWorld world;
    memset(&world, 0, sizeof world);
    const R2DWorldWall authored[] = {{100.0f, 0.0f, 100.0f, 100.0f, 3.0f, 6.0f, 0xff404040}};
    R2DWorldPortal portal = two_storey_portal();
    char err[256];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build_cells(&world, authored, 1, two_storey_spans, 4,
                                                   two_storey_cells, 2, &portal, 1,
                                                   two_storey_openings, 2, err, sizeof err), err);
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, world.wall_count,
                                  "authored band wall + two opening closures, no duplicate");
    TEST_ASSERT_EQUAL_INT(1, walls_covering(&world, 3.0f, 6.0f));
    r2d_world_free(&world);
}

static void test_partial_authored_wall_only_closes_the_rest(void)
{
    R2DRe2dWorld world;
    memset(&world, 0, sizeof world);
    const R2DWorldWall authored[] = {{100.0f, 0.0f, 100.0f, 100.0f, 3.0f, 4.5f, 0xff404040}};
    R2DWorldPortal portal = two_storey_portal();
    char err[256];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build_cells(&world, authored, 1, two_storey_spans, 4,
                                                   two_storey_cells, 2, &portal, 1,
                                                   two_storey_openings, 2, err, sizeof err), err);
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, world.wall_count,
                                  "authored piece + derived remainder + two opening closures");
    TEST_ASSERT_EQUAL_INT(1, walls_covering(&world, 4.5f, 6.0f));
    TEST_ASSERT_EQUAL_INT(1, walls_covering(&world, 3.0f, 4.5f));
    r2d_world_free(&world);
}

static void test_single_opening_covering_extent_adds_no_band(void)
{
    R2DRe2dWorld world;
    memset(&world, 0, sizeof world);
    const R2DWorldSpan spans[] = {
        {0.0f, 0.0f, 100.0f, 100.0f, 0.0f, 3.0f, 0, 0, 0, 0, 0, 0},
        {100.0f, 0.0f, 100.0f, 100.0f, 0.0f, 3.0f, 0, 0, 0, 0, 0, 0}
    };
    const R2DWorldCell cells[] = {
        {0.0f, 0.0f, 100.0f, 100.0f, 0, 1},
        {100.0f, 0.0f, 100.0f, 100.0f, 1, 1}
    };
    const R2DWorldOpening openings[] = {{0.0f, 3.0f}};
    R2DWorldPortal portal = {0, 1, 0, 1, 100.0f, 0.0f, 100.0f, 100.0f, false};
    portal.open_fraction = 1.0f;
    char err[256];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build_cells(&world, NULL, 0, spans, 2, cells, 2,
                                                   &portal, 1, openings, 1, err, sizeof err), err);
    TEST_ASSERT_EQUAL_INT(1, world.wall_count);
    r2d_world_free(&world);
}

static void test_uncovered_upper_band_is_closed_conservatively(void)
{
    R2DRe2dWorld world;
    memset(&world, 0, sizeof world);
    R2DWorldPortal portal = two_storey_portal();
    portal.opening_count = 1;
    const R2DWorldOpening openings[] = {{0.0f, 3.0f}};
    char err[256];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build_cells(&world, NULL, 0, two_storey_spans, 4,
                                                   two_storey_cells, 2, &portal, 1,
                                                   openings, 1, err, sizeof err), err);
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, world.wall_count,
                                  "one opening closure plus one 3..9 solid band");
    TEST_ASSERT_EQUAL_INT(1, walls_covering(&world, 3.0f, 9.0f));
    r2d_world_free(&world);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_solid_band_between_openings_is_closed);
    RUN_TEST(test_authored_wall_suppresses_duplicate_closure);
    RUN_TEST(test_partial_authored_wall_only_closes_the_rest);
    RUN_TEST(test_single_opening_covering_extent_adds_no_band);
    RUN_TEST(test_uncovered_upper_band_is_closed_conservatively);
    return UNITY_END();
}
