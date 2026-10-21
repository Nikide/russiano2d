#include "re2d_world_automap.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-5f
#define PI 3.14159265358979323846f
#define SENTINEL (-12345)

// Two neighbouring 100x100 cells sharing the x=100 edge, each with two free
// height intervals and one two-opening portal on the shared edge. Two authored
// outer walls, two derived opening closures and one derived solid-band closure
// (the slab between the two openings) are present.
static void build_two_cell_world(R2DRe2dWorld *world)
{
    const R2DWorldWall walls[] = {
        {0.0f, 0.0f, 0.0f, 100.0f, 0.0f, 3.0f, 0xff0000ff},
        {200.0f, 0.0f, 200.0f, 100.0f, 0.0f, 3.0f, 0xff00ff00}
    };
    const R2DWorldSpan spans[] = {
        {0.0f, 0.0f, 100.0f, 100.0f, 0.0f, 3.0f, 0, 0, 0, 0, 0, 0},
        {0.0f, 0.0f, 100.0f, 100.0f, 6.0f, 9.0f, 0, 0, 0, 0, 0, 0},
        {100.0f, 0.0f, 100.0f, 100.0f, 0.0f, 3.0f, 0, 0, 0, 0, 0, 0},
        {100.0f, 0.0f, 100.0f, 100.0f, 6.0f, 9.0f, 0, 0, 0, 0, 0, 0}
    };
    const R2DWorldCell cells[] = {
        {0.0f, 0.0f, 100.0f, 100.0f, 0, 2},
        {100.0f, 0.0f, 100.0f, 100.0f, 2, 2}
    };
    const R2DWorldOpening openings[] = { {0.0f, 3.0f}, {6.0f, 9.0f} };
    R2DWorldPortal portal = {0, 1, 0, 2, 100.0f, 0.0f, 100.0f, 100.0f, false, 1.0f};
    char err[256];

    memset(world, 0, sizeof *world);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build_cells(world, walls, 2, spans, 4,
                                                   cells, 2, &portal, 1,
                                                   openings, 2, err, sizeof err), err);
    TEST_ASSERT_EQUAL_INT_MESSAGE(5, world->wall_count,
                                  "2 authored + 2 opening closures + 1 solid-band closure");
    TEST_ASSERT_EQUAL_INT(1, world->portal_count);
}

static void test_extraction_counts_and_order_on_two_cells(void)
{
    R2DRe2dWorld world;
    build_two_cell_world(&world);

    // Flat state slots: walls 0..4 (closures ignored), portal at wall_count+0.
    uint8_t states[6] = {
        R2D_AUTOMAP_SEEN, R2D_AUTOMAP_SECRET, 0xff, 0xff, 0xff, R2D_AUTOMAP_LOCKED
    };
    R2DWorldAutomapLine lines[3];

    TEST_ASSERT_EQUAL_INT_MESSAGE(3, r2d_world_automap_lines(&world, states, NULL, 0),
                                  "count query returns authored walls + portals");
    TEST_ASSERT_EQUAL_INT(3, r2d_world_automap_lines(&world, states, lines, 3));

    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_WALL, lines[0].kind);
    TEST_ASSERT_EQUAL_INT(0, lines[0].index);
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_SEEN, lines[0].state);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, lines[0].x1);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, lines[0].y1);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, lines[0].x2);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 100.0f, lines[0].y2);

    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_WALL, lines[1].kind);
    TEST_ASSERT_EQUAL_INT(1, lines[1].index);
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_SECRET, lines[1].state);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 200.0f, lines[1].x1);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 200.0f, lines[1].x2);

    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_PORTAL, lines[2].kind);
    TEST_ASSERT_EQUAL_INT(0, lines[2].index);
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_LOCKED, lines[2].state);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 100.0f, lines[2].x1);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, lines[2].y1);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 100.0f, lines[2].x2);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 100.0f, lines[2].y2);
    r2d_world_free(&world);
}

static void test_portal_closed_open_kind_and_index(void)
{
    R2DRe2dWorld world;
    build_two_cell_world(&world);
    R2DWorldAutomapLine lines[3];
    uint8_t states[6] = {0, 0, 0, 0, 0, R2D_AUTOMAP_SPECIAL};

    TEST_ASSERT_TRUE(r2d_world_portal_set_closed(&world, 0, true));
    TEST_ASSERT_EQUAL_INT(3, r2d_world_automap_lines(&world, states, lines, 3));
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_PORTAL, lines[2].kind);
    TEST_ASSERT_EQUAL_INT(0, lines[2].index);
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_SPECIAL, lines[2].state);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 100.0f, lines[2].x1);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 100.0f, lines[2].x2);

    // A partially open portal is still one automap portal line with the same
    // topology index; openness is a rendering/collision concern, not a line.
    TEST_ASSERT_TRUE(r2d_world_portal_set_open(&world, 0, 0.5f));
    TEST_ASSERT_EQUAL_INT(3, r2d_world_automap_lines(&world, NULL, lines, 3));
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_PORTAL, lines[2].kind);
    TEST_ASSERT_EQUAL_INT(0, lines[2].index);
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_UNSEEN, lines[2].state);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 100.0f, lines[2].x1);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, lines[2].y1);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 100.0f, lines[2].x2);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 100.0f, lines[2].y2);
    r2d_world_free(&world);
}

static void test_truncation_reports_total(void)
{
    R2DRe2dWorld world;
    build_two_cell_world(&world);
    R2DWorldAutomapLine lines[6];

    for (int i = 0; i < 6; i++) {
        memset(&lines[i], 0, sizeof lines[i]);
        lines[i].index = SENTINEL;
        lines[i].kind = SENTINEL;
    }

    TEST_ASSERT_EQUAL_INT(3, r2d_world_automap_lines(&world, NULL, lines, 0));
    TEST_ASSERT_EQUAL_INT(SENTINEL, lines[0].index);

    TEST_ASSERT_EQUAL_INT(3, r2d_world_automap_lines(&world, NULL, lines, 1));
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_WALL, lines[0].kind);
    TEST_ASSERT_EQUAL_INT(SENTINEL, lines[1].index);

    TEST_ASSERT_EQUAL_INT(3, r2d_world_automap_lines(&world, NULL, lines, 2));
    TEST_ASSERT_EQUAL_INT(0, lines[0].index);
    TEST_ASSERT_EQUAL_INT(1, lines[1].index);
    TEST_ASSERT_EQUAL_INT(SENTINEL, lines[2].index);

    TEST_ASSERT_EQUAL_INT(3, r2d_world_automap_lines(&world, NULL, lines, 6));
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_PORTAL, lines[2].kind);
    TEST_ASSERT_EQUAL_INT(SENTINEL, lines[3].index);
    r2d_world_free(&world);
}

static void test_state_lookup_default_and_out_of_range(void)
{
    const uint8_t states[5] = {
        R2D_AUTOMAP_UNSEEN, R2D_AUTOMAP_SEEN, R2D_AUTOMAP_SECRET,
        R2D_AUTOMAP_LOCKED, R2D_AUTOMAP_SPECIAL
    };
    for (int i = 0; i < 5; i++) {
        TEST_ASSERT_EQUAL_INT(i, r2d_world_automap_state(states, 5, i));
    }
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_UNSEEN, r2d_world_automap_state(states, 5, 5));
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_UNSEEN, r2d_world_automap_state(states, 5, -1));
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_UNSEEN, r2d_world_automap_state(states, 2, 2));
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_UNSEEN, r2d_world_automap_state(states, 0, 0));
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_UNSEEN, r2d_world_automap_state(states, -3, 0));
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_UNSEEN, r2d_world_automap_state(NULL, 5, 0));

    const uint8_t invalid[3] = { R2D_AUTOMAP_SPECIAL + 1, 0xff, R2D_AUTOMAP_SEEN };
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_UNSEEN, r2d_world_automap_state(invalid, 3, 0));
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_UNSEEN, r2d_world_automap_state(invalid, 3, 1));
    TEST_ASSERT_EQUAL_INT(R2D_AUTOMAP_SEEN, r2d_world_automap_state(invalid, 3, 2));
}

static void test_project_center_and_rotation(void)
{
    R2DWorldAutomapView view = {10.0f, 20.0f, 1.0f, 0.0f};
    float x = 0.0f, y = 0.0f;

    r2d_world_automap_project(&view, 10.0f, 20.0f, &x, &y);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, y);

    r2d_world_automap_project(&view, 13.0f, 24.0f, &x, &y);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 3.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 4.0f, y);

    view.scale = 2.0f;
    r2d_world_automap_project(&view, 13.0f, 24.0f, &x, &y);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 6.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 8.0f, y);

    view.scale = 1.0f;
    view.rotation = PI * 0.5f;
    r2d_world_automap_project(&view, 12.0f, 20.0f, &x, &y);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 0.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 2.0f, y);
    r2d_world_automap_project(&view, 10.0f, 22.0f, &x, &y);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, -2.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 0.0f, y);

    view.rotation = PI;
    r2d_world_automap_project(&view, 13.0f, 24.0f, &x, &y);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, -3.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, -4.0f, y);
}

static void test_project_translation_scale_zero_and_null(void)
{
    float x = 99.0f, y = 99.0f;

    R2DWorldAutomapView view = {-5.0f, 7.0f, 3.0f, 0.0f};
    r2d_world_automap_project(&view, -5.0f, 7.0f, &x, &y);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, y);
    r2d_world_automap_project(&view, -4.0f, 8.0f, &x, &y);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 3.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 3.0f, y);

    view.scale = -1.0f;
    r2d_world_automap_project(&view, -6.0f, 7.0f, &x, &y);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, y);

    // Zero scale is documented as collapsing every point to the view focus.
    view.scale = 0.0f;
    view.rotation = 1.234f;
    r2d_world_automap_project(&view, 100.0f, -50.0f, &x, &y);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, y);

    // NULL view is the identity transform.
    x = 0.0f;
    y = 0.0f;
    r2d_world_automap_project(NULL, 3.5f, -2.25f, &x, &y);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 3.5f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, -2.25f, y);

    // NULL output pointers are ignored independently.
    x = 0.0f;
    y = 0.0f;
    r2d_world_automap_project(&view, 1.0f, 2.0f, NULL, &y);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, y);
    r2d_world_automap_project(&view, 1.0f, 2.0f, &x, NULL);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, x);
    r2d_world_automap_project(NULL, 1.0f, 2.0f, NULL, NULL);
}

static void test_invalid_arguments(void)
{
    R2DWorldAutomapLine line;
    R2DRe2dWorld empty;
    memset(&empty, 0, sizeof empty);

    TEST_ASSERT_EQUAL_INT(-1, r2d_world_automap_lines(NULL, NULL, NULL, 0));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_automap_lines(NULL, NULL, &line, 1));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_automap_lines(&empty, NULL, &line, -1));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_automap_lines(&empty, NULL, NULL, 0));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_automap_lines(&empty, NULL, &line, 4));

    R2DRe2dWorld world;
    build_two_cell_world(&world);
    // Count query ignores capacity entirely, including a negative one.
    TEST_ASSERT_EQUAL_INT(3, r2d_world_automap_lines(&world, NULL, NULL, -7));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_automap_lines(&world, NULL, &line, -7));
    r2d_world_free(&world);
}

static void test_determinism(void)
{
    R2DRe2dWorld world;
    build_two_cell_world(&world);
    const uint8_t states[6] = {
        R2D_AUTOMAP_SEEN, R2D_AUTOMAP_LOCKED, 0xff, 0xff, 0xff, R2D_AUTOMAP_SPECIAL
    };
    R2DWorldAutomapLine a[3], b[3], wide[5];

    for (int i = 0; i < 3; i++) {
        memset(&a[i], 0x5a, sizeof a[i]);
        memset(&b[i], 0x5a, sizeof b[i]);
    }
    TEST_ASSERT_EQUAL_INT(3, r2d_world_automap_lines(&world, states, a, 3));
    TEST_ASSERT_EQUAL_INT(3, r2d_world_automap_lines(&world, states, b, 3));
    TEST_ASSERT_EQUAL_INT(0, memcmp(a, b, sizeof a));

    TEST_ASSERT_EQUAL_INT(3, r2d_world_automap_lines(&world, states, wide, 5));
    TEST_ASSERT_EQUAL_INT(0, memcmp(a, wide, sizeof a));

    // Repeated calls must not mutate the world or depend on prior output.
    TEST_ASSERT_EQUAL_INT(3, r2d_world_automap_lines(&world, states, b, 3));
    TEST_ASSERT_EQUAL_INT(0, memcmp(a, b, sizeof a));
    TEST_ASSERT_EQUAL_INT(1, world.portal_count);
    TEST_ASSERT_EQUAL_INT(5, world.wall_count);
    r2d_world_free(&world);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_extraction_counts_and_order_on_two_cells);
    RUN_TEST(test_portal_closed_open_kind_and_index);
    RUN_TEST(test_truncation_reports_total);
    RUN_TEST(test_state_lookup_default_and_out_of_range);
    RUN_TEST(test_project_center_and_rotation);
    RUN_TEST(test_project_translation_scale_zero_and_null);
    RUN_TEST(test_invalid_arguments);
    RUN_TEST(test_determinism);
    return UNITY_END();
}
