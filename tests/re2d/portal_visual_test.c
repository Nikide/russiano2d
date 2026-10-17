#include "re2d_world_portal_visual.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-5f
#define PI 3.14159265358979323846f
#define SENTINEL 12345.0f

static R2DWorldPortalVisual make_portal(int kind, float ax, float ay,
                                        float bx, float by)
{
    R2DWorldPortalVisual portal;
    memset(&portal, 0, sizeof portal);
    portal.kind = kind;
    portal.ax = ax;
    portal.ay = ay;
    portal.bx = bx;
    portal.by = by;
    portal.max_depth = 2;
    portal.yaw_only = false;
    return portal;
}

static bool yaw_near(float actual, float expected)
{
    float diff = fabsf(actual - expected);
    if (diff > PI) diff = fabsf(diff - 2.0f * PI);
    return diff < 1e-4f;
}

static bool float_bits_equal(float a, float b)
{
    return memcmp(&a, &b, sizeof a) == 0;
}

static void test_mirror_axis_aligned(void)
{
    const R2DWorldPortalVisual vertical =
        make_portal(R2D_PORTAL_VISUAL_MIRROR, 5.0f, 0.0f, 5.0f, 10.0f);
    float x = 0.0f, y = 0.0f, yaw = 0.0f;

    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&vertical, 2.0f, 3.0f, 0.0f, &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 8.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 3.0f, y);
    TEST_ASSERT_TRUE(yaw_near(yaw, PI));

    // A point on the mirror line is fixed; a pose looking along the line keeps
    // its yaw because the line is invariant under its own reflection.
    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&vertical, 5.0f, 7.0f, PI * 0.5f, &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 5.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 7.0f, y);
    TEST_ASSERT_TRUE(yaw_near(yaw, PI * 0.5f));

    const R2DWorldPortalVisual horizontal =
        make_portal(R2D_PORTAL_VISUAL_MIRROR, 0.0f, 4.0f, 10.0f, 4.0f);
    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&horizontal, 3.0f, 7.0f, 0.0f, &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 3.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, y);
    TEST_ASSERT_TRUE(yaw_near(yaw, 0.0f));

    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&horizontal, 3.0f, 4.0f, -0.7f, &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 3.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 4.0f, y);
    TEST_ASSERT_TRUE(yaw_near(yaw, 0.7f));
}

static void test_mirror_diagonal(void)
{
    const R2DWorldPortalVisual diagonal =
        make_portal(R2D_PORTAL_VISUAL_MIRROR, 0.0f, 0.0f, 10.0f, 10.0f);
    float x = 0.0f, y = 0.0f, yaw = 0.0f;

    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&diagonal, 4.0f, 0.0f, 0.0f, &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 4.0f, y);
    TEST_ASSERT_TRUE(yaw_near(yaw, PI * 0.5f));

    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&diagonal, 2.0f, 9.0f, 0.0f, &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 9.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 2.0f, y);
    TEST_ASSERT_TRUE(yaw_near(yaw, PI * 0.5f));

    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&diagonal, 6.0f, -1.0f, 0.0f, &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, -1.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 6.0f, y);

    // Yaw along the mirror line is unchanged.
    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&diagonal, 3.0f, 3.0f, PI * 0.25f, &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 3.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 3.0f, y);
    TEST_ASSERT_TRUE(yaw_near(yaw, PI * 0.25f));
}

static void test_mirror_yaw_mapping(void)
{
    const R2DWorldPortalVisual vertical =
        make_portal(R2D_PORTAL_VISUAL_MIRROR, 5.0f, -5.0f, 5.0f, 5.0f);
    const R2DWorldPortalVisual horizontal =
        make_portal(R2D_PORTAL_VISUAL_MIRROR, 0.0f, 0.0f, 10.0f, 0.0f);
    float x, y, yaw;

    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&vertical, 1.0f, 1.0f, PI * 0.5f, &x, &y, &yaw));
    TEST_ASSERT_TRUE(yaw_near(yaw, PI * 0.5f));
    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&vertical, 1.0f, 1.0f, -PI * 0.5f, &x, &y, &yaw));
    TEST_ASSERT_TRUE(yaw_near(yaw, -PI * 0.5f));
    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&vertical, 1.0f, 1.0f, PI, &x, &y, &yaw));
    TEST_ASSERT_TRUE(yaw_near(yaw, 0.0f));

    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&horizontal, 1.0f, 1.0f, 3.0f * PI * 0.5f, &x, &y, &yaw));
    TEST_ASSERT_TRUE(yaw_near(yaw, PI * 0.5f));
    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&horizontal, 1.0f, 1.0f, -3.0f * PI * 0.5f, &x, &y, &yaw));
    TEST_ASSERT_TRUE(yaw_near(yaw, -PI * 0.5f));
    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&horizontal, 1.0f, 1.0f, 2.0f * PI, &x, &y, &yaw));
    TEST_ASSERT_TRUE(yaw_near(yaw, 0.0f));
    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&horizontal, 1.0f, 1.0f, 4.0f * PI + 0.25f, &x, &y, &yaw));
    TEST_ASSERT_TRUE(yaw_near(yaw, -0.25f));
}

static void test_mirror_preserves_distances(void)
{
    const R2DWorldPortalVisual mirror =
        make_portal(R2D_PORTAL_VISUAL_MIRROR, 2.0f, 3.0f, 11.0f, 7.0f);
    const float px[4] = {0.0f, 4.0f, -3.0f, 8.0f};
    const float py[4] = {0.0f, 9.0f, 5.0f, -2.0f};
    float rx[4], ry[4], dummy_yaw;

    for (int i = 0; i < 4; i++) {
        TEST_ASSERT_TRUE(r2d_world_portal_reflect(&mirror, px[i], py[i], 0.0f,
                                                  &rx[i], &ry[i], &dummy_yaw));
    }
    for (int i = 0; i < 4; i++) {
        for (int j = 0; j < 4; j++) {
            const float before = hypotf(px[i] - px[j], py[i] - py[j]);
            const float after = hypotf(rx[i] - rx[j], ry[i] - ry[j]);
            TEST_ASSERT_FLOAT_WITHIN(1e-4f, before, after);
        }
    }

    // Reflecting twice is the identity (isometry involution).
    float bx = 0.0f, by = 0.0f, byaw = 0.0f;
    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&mirror, 4.0f, 9.0f, 0.7f, &bx, &by, &byaw));
    float cx = 0.0f, cy = 0.0f, cyaw = 0.0f;
    TEST_ASSERT_TRUE(r2d_world_portal_reflect(&mirror, bx, by, byaw, &cx, &cy, &cyaw));
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 4.0f, cx);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 9.0f, cy);
    TEST_ASSERT_TRUE(yaw_near(cyaw, 0.7f));
}

static void test_link_translate(void)
{
    const R2DWorldPortalVisual from =
        make_portal(R2D_PORTAL_VISUAL_LINK, 0.0f, 0.0f, 10.0f, 0.0f);
    const R2DWorldPortalVisual to =
        make_portal(R2D_PORTAL_VISUAL_LINK, 20.0f, 5.0f, 30.0f, 5.0f);
    float x = 0.0f, y = 0.0f, yaw = 0.0f;

    TEST_ASSERT_TRUE(r2d_world_portal_linked_pose(&from, &to, 7.0f, 2.0f, 0.3f,
                                                  &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 27.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 7.0f, y);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.3f, yaw);

    // Segment lengths are never used for scaling: only midpoints matter.
    const R2DWorldPortalVisual long_to =
        make_portal(R2D_PORTAL_VISUAL_LINK, 20.0f, 0.0f, 50.0f, 0.0f);
    TEST_ASSERT_TRUE(r2d_world_portal_linked_pose(&from, &long_to, 10.0f, 0.0f, 0.0f,
                                                  &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 40.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, y);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, yaw);

    // yaw_only is irrelevant when both segments share an angle.
    R2DWorldPortalVisual yaw_only_to = to;
    yaw_only_to.yaw_only = true;
    TEST_ASSERT_TRUE(r2d_world_portal_linked_pose(&from, &yaw_only_to, 7.0f, 2.0f, 0.3f,
                                                  &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 27.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 7.0f, y);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.3f, yaw);
}

static void test_link_with_yaw(void)
{
    const R2DWorldPortalVisual from =
        make_portal(R2D_PORTAL_VISUAL_LINK, 0.0f, 0.0f, 10.0f, 0.0f);   // mid (5,0), angle 0
    const R2DWorldPortalVisual to =
        make_portal(R2D_PORTAL_VISUAL_LINK, 20.0f, -5.0f, 20.0f, 5.0f); // mid (20,0), angle pi/2
    float x = 0.0f, y = 0.0f, yaw = 0.0f;

    TEST_ASSERT_TRUE(r2d_world_portal_linked_pose(&from, &to, 5.0f, 0.0f, 0.0f,
                                                  &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 20.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, y);
    TEST_ASSERT_TRUE(yaw_near(yaw, PI * 0.5f));

    // Offset (2,0) rotates by +90 degrees to (0,2).
    TEST_ASSERT_TRUE(r2d_world_portal_linked_pose(&from, &to, 7.0f, 0.0f, 0.0f,
                                                  &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 20.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 2.0f, y);
    TEST_ASSERT_TRUE(yaw_near(yaw, PI * 0.5f));

    // Offset (0,2) rotates by +90 degrees to (-2,0); yaw wraps through +pi.
    TEST_ASSERT_TRUE(r2d_world_portal_linked_pose(&from, &to, 5.0f, 2.0f, PI * 0.5f,
                                                  &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 18.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, y);
    TEST_ASSERT_TRUE(yaw_near(yaw, PI));

    // yaw_only: same translation, but the body offset is not swung around.
    R2DWorldPortalVisual yaw_only_to = to;
    yaw_only_to.yaw_only = true;
    TEST_ASSERT_TRUE(r2d_world_portal_linked_pose(&from, &yaw_only_to, 7.0f, 0.0f, 0.0f,
                                                  &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 22.0f, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, y);
    TEST_ASSERT_TRUE(yaw_near(yaw, PI * 0.5f));

    // Half-turn portal: yaw pi/2 maps to -pi/2 after normalization.
    const R2DWorldPortalVisual back =
        make_portal(R2D_PORTAL_VISUAL_LINK, 20.0f, 0.0f, 10.0f, 0.0f);
    TEST_ASSERT_TRUE(r2d_world_portal_linked_pose(&from, &back, 5.0f, 0.0f, PI * 0.5f,
                                                  &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 15.0f, x);
    TEST_ASSERT_TRUE(yaw_near(yaw, -PI * 0.5f));
}

static void test_sky_yaw_mapping(void)
{
    const R2DWorldPortalVisual vertical =
        make_portal(R2D_PORTAL_VISUAL_SKY, 10.0f, 0.0f, 10.0f, 10.0f);
    const R2DWorldPortalVisual horizontal =
        make_portal(R2D_PORTAL_VISUAL_SKY, 0.0f, 0.0f, 10.0f, 0.0f);
    float out = SENTINEL;

    r2d_world_portal_sky_yaw(&vertical, 0.0f, &out);
    TEST_ASSERT_TRUE(yaw_near(out, PI * 0.5f));
    r2d_world_portal_sky_yaw(&vertical, PI * 0.5f, &out);
    TEST_ASSERT_TRUE(yaw_near(out, PI));
    r2d_world_portal_sky_yaw(&vertical, PI, &out);
    TEST_ASSERT_TRUE(yaw_near(out, -PI * 0.5f));
    r2d_world_portal_sky_yaw(&vertical, -PI * 0.5f, &out);
    TEST_ASSERT_TRUE(yaw_near(out, 0.0f));

    r2d_world_portal_sky_yaw(&horizontal, 1.25f, &out);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.25f, out);

    // Invalid inputs write zero, and a NULL output is ignored.
    r2d_world_portal_sky_yaw(&horizontal, NAN, &out);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, out);
    R2DWorldPortalVisual mirror = horizontal;
    mirror.kind = R2D_PORTAL_VISUAL_MIRROR;
    r2d_world_portal_sky_yaw(&mirror, 1.0f, &out);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, out);
    R2DWorldPortalVisual degenerate = horizontal;
    degenerate.bx = degenerate.ax;
    r2d_world_portal_sky_yaw(&degenerate, 1.0f, &out);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, out);
    r2d_world_portal_sky_yaw(&horizontal, 1.0f, NULL);
    r2d_world_portal_sky_yaw(NULL, 1.0f, &out);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, out);
}

static void test_recursion_depth_limit(void)
{
    R2DWorldPortalRecursion rec;
    memset(&rec, 0, sizeof rec);

    // max_depth 0 is clamped up to 1.
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_push(&rec, 10));
    TEST_ASSERT_EQUAL_INT(1, rec.max_depth);
    TEST_ASSERT_EQUAL_INT(1, rec.depth);
    TEST_ASSERT_FALSE(r2d_world_portal_recursion_push(&rec, 11));
    r2d_world_portal_recursion_pop(&rec);
    TEST_ASSERT_EQUAL_INT(0, rec.depth);

    // A too-large budget is clamped to 4.
    memset(&rec, 0, sizeof rec);
    rec.max_depth = 99;
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_push(&rec, 0));
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_push(&rec, 1));
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_push(&rec, 2));
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_push(&rec, 3));
    TEST_ASSERT_EQUAL_INT(4, rec.max_depth);
    TEST_ASSERT_EQUAL_INT(4, rec.depth);
    TEST_ASSERT_FALSE(r2d_world_portal_recursion_push(&rec, 4));

    memset(&rec, 0, sizeof rec);
    rec.max_depth = 2;
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_push(&rec, 0));
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_push(&rec, 1));
    TEST_ASSERT_FALSE(r2d_world_portal_recursion_push(&rec, 2));

    // Negative ids and NULL recursion are rejected.
    TEST_ASSERT_FALSE(r2d_world_portal_recursion_push(&rec, -1));
    TEST_ASSERT_FALSE(r2d_world_portal_recursion_push(NULL, 0));
}

static void test_recursion_cycle_and_pop(void)
{
    R2DWorldPortalRecursion rec;
    memset(&rec, 0, sizeof rec);
    rec.max_depth = 4;

    TEST_ASSERT_TRUE(r2d_world_portal_recursion_push(&rec, 0));
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_push(&rec, 1));
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_push(&rec, 2));
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_contains(&rec, 0));
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_contains(&rec, 1));
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_contains(&rec, 2));
    TEST_ASSERT_FALSE(r2d_world_portal_recursion_contains(&rec, 3));

    // Cycle: 1 is already on the stack.
    TEST_ASSERT_FALSE(r2d_world_portal_recursion_push(&rec, 1));
    TEST_ASSERT_FALSE(r2d_world_portal_recursion_push(&rec, 0));
    TEST_ASSERT_EQUAL_INT(3, rec.depth);

    // Pop 2, then it can be revisited; 1 is still on the stack.
    r2d_world_portal_recursion_pop(&rec);
    TEST_ASSERT_EQUAL_INT(2, rec.depth);
    TEST_ASSERT_FALSE(r2d_world_portal_recursion_contains(&rec, 2));
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_push(&rec, 2));
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_contains(&rec, 2));
    TEST_ASSERT_FALSE(r2d_world_portal_recursion_push(&rec, 1));

    r2d_world_portal_recursion_pop(&rec);
    r2d_world_portal_recursion_pop(&rec);
    r2d_world_portal_recursion_pop(&rec);
    TEST_ASSERT_EQUAL_INT(0, rec.depth);
    TEST_ASSERT_TRUE(r2d_world_portal_recursion_push(&rec, 1));

    // Empty pop is a no-op, NULL-safe helpers do not crash.
    r2d_world_portal_recursion_pop(&rec);
    r2d_world_portal_recursion_pop(&rec);
    TEST_ASSERT_EQUAL_INT(0, rec.depth);
    r2d_world_portal_recursion_pop(NULL);
    TEST_ASSERT_FALSE(r2d_world_portal_recursion_contains(NULL, 0));
    TEST_ASSERT_FALSE(r2d_world_portal_recursion_contains(&rec, -2));
}

static void test_degenerate_and_invalid(void)
{
    R2DWorldPortalVisual zero =
        make_portal(R2D_PORTAL_VISUAL_MIRROR, 3.0f, 3.0f, 3.0f, 3.0f);
    float x = SENTINEL, y = SENTINEL, yaw = SENTINEL;

    TEST_ASSERT_FALSE(r2d_world_portal_reflect(&zero, 0.0f, 0.0f, 0.0f, &x, &y, &yaw));
    TEST_ASSERT_FLOAT_WITHIN(EPS, SENTINEL, x);
    TEST_ASSERT_FLOAT_WITHIN(EPS, SENTINEL, y);
    TEST_ASSERT_FLOAT_WITHIN(EPS, SENTINEL, yaw);

    R2DWorldPortalVisual bad = zero;
    bad.bx = NAN;
    TEST_ASSERT_FALSE(r2d_world_portal_reflect(&bad, 0.0f, 0.0f, 0.0f, &x, &y, &yaw));
    bad = zero;
    bad.ay = INFINITY;
    TEST_ASSERT_FALSE(r2d_world_portal_reflect(&bad, 0.0f, 0.0f, 0.0f, &x, &y, &yaw));

    R2DWorldPortalVisual mirror =
        make_portal(R2D_PORTAL_VISUAL_MIRROR, 0.0f, 0.0f, 1.0f, 0.0f);
    R2DWorldPortalVisual link =
        make_portal(R2D_PORTAL_VISUAL_LINK, 0.0f, 0.0f, 1.0f, 0.0f);
    R2DWorldPortalVisual sky =
        make_portal(R2D_PORTAL_VISUAL_SKY, 0.0f, 0.0f, 1.0f, 0.0f);

    TEST_ASSERT_FALSE(r2d_world_portal_reflect(&link, 0.0f, 0.0f, 0.0f, &x, &y, &yaw));
    TEST_ASSERT_FALSE(r2d_world_portal_linked_pose(&mirror, &link, 0.0f, 0.0f, 0.0f,
                                                   &x, &y, &yaw));
    TEST_ASSERT_FALSE(r2d_world_portal_linked_pose(&link, &sky, 0.0f, 0.0f, 0.0f,
                                                   &x, &y, &yaw));
    TEST_ASSERT_FALSE(r2d_world_portal_linked_pose(&link, &mirror, 0.0f, 0.0f, 0.0f,
                                                   &x, &y, &yaw));

    TEST_ASSERT_FALSE(r2d_world_portal_reflect(NULL, 0.0f, 0.0f, 0.0f, &x, &y, &yaw));
    TEST_ASSERT_FALSE(r2d_world_portal_reflect(&mirror, 0.0f, 0.0f, 0.0f, NULL, &y, &yaw));
    TEST_ASSERT_FALSE(r2d_world_portal_reflect(&mirror, 0.0f, 0.0f, 0.0f, &x, NULL, &yaw));
    TEST_ASSERT_FALSE(r2d_world_portal_reflect(&mirror, 0.0f, 0.0f, 0.0f, &x, &y, NULL));
    TEST_ASSERT_FALSE(r2d_world_portal_reflect(&mirror, NAN, 0.0f, 0.0f, &x, &y, &yaw));
    TEST_ASSERT_FALSE(r2d_world_portal_reflect(&mirror, 0.0f, INFINITY, 0.0f, &x, &y, &yaw));
    TEST_ASSERT_FALSE(r2d_world_portal_reflect(&mirror, 0.0f, 0.0f, NAN, &x, &y, &yaw));
    TEST_ASSERT_FALSE(r2d_world_portal_linked_pose(NULL, &link, 0.0f, 0.0f, 0.0f,
                                                   &x, &y, &yaw));
    TEST_ASSERT_FALSE(r2d_world_portal_linked_pose(&link, NULL, 0.0f, 0.0f, 0.0f,
                                                   &x, &y, &yaw));
    TEST_ASSERT_FALSE(r2d_world_portal_linked_pose(&link, &link, 0.0f, 0.0f, NAN,
                                                   &x, &y, &yaw));
    TEST_ASSERT_FALSE(r2d_world_portal_linked_pose(&link, &link, 0.0f, 0.0f, 0.0f,
                                                   NULL, &y, &yaw));
}

static void test_determinism(void)
{
    const R2DWorldPortalVisual mirror =
        make_portal(R2D_PORTAL_VISUAL_MIRROR, 2.0f, 3.0f, 11.0f, 7.0f);
    const R2DWorldPortalVisual from =
        make_portal(R2D_PORTAL_VISUAL_LINK, 0.0f, 0.0f, 10.0f, 0.0f);
    const R2DWorldPortalVisual to =
        make_portal(R2D_PORTAL_VISUAL_LINK, 20.0f, -5.0f, 20.0f, 5.0f);
    const R2DWorldPortalVisual sky =
        make_portal(R2D_PORTAL_VISUAL_SKY, 10.0f, 0.0f, 10.0f, 10.0f);

    for (int i = 0; i < 100; i++) {
        float ax, ay, ayaw, bx, by, byaw;
        TEST_ASSERT_TRUE(r2d_world_portal_reflect(&mirror, 4.0f, 9.0f, 0.7f,
                                                  &ax, &ay, &ayaw));
        TEST_ASSERT_TRUE(r2d_world_portal_reflect(&mirror, 4.0f, 9.0f, 0.7f,
                                                  &bx, &by, &byaw));
        TEST_ASSERT_TRUE(float_bits_equal(ax, bx));
        TEST_ASSERT_TRUE(float_bits_equal(ay, by));
        TEST_ASSERT_TRUE(float_bits_equal(ayaw, byaw));

        TEST_ASSERT_TRUE(r2d_world_portal_linked_pose(&from, &to, 7.0f, 0.0f, 0.0f,
                                                      &ax, &ay, &ayaw));
        TEST_ASSERT_TRUE(r2d_world_portal_linked_pose(&from, &to, 7.0f, 0.0f, 0.0f,
                                                      &bx, &by, &byaw));
        TEST_ASSERT_TRUE(float_bits_equal(ax, bx));
        TEST_ASSERT_TRUE(float_bits_equal(ay, by));
        TEST_ASSERT_TRUE(float_bits_equal(ayaw, byaw));

        r2d_world_portal_sky_yaw(&sky, 0.25f, &ax);
        r2d_world_portal_sky_yaw(&sky, 0.25f, &bx);
        TEST_ASSERT_TRUE(float_bits_equal(ax, bx));
    }

    R2DWorldPortalRecursion a, b;
    memset(&a, 0, sizeof a);
    memset(&b, 0, sizeof b);
    a.max_depth = 3;
    b.max_depth = 3;
    for (int i = 0; i < 3; i++) {
        TEST_ASSERT_EQUAL_INT(r2d_world_portal_recursion_push(&a, i),
                              r2d_world_portal_recursion_push(&b, i));
    }
    TEST_ASSERT_EQUAL_INT(0, memcmp(&a, &b, sizeof a));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_mirror_axis_aligned);
    RUN_TEST(test_mirror_diagonal);
    RUN_TEST(test_mirror_yaw_mapping);
    RUN_TEST(test_mirror_preserves_distances);
    RUN_TEST(test_link_translate);
    RUN_TEST(test_link_with_yaw);
    RUN_TEST(test_sky_yaw_mapping);
    RUN_TEST(test_recursion_depth_limit);
    RUN_TEST(test_recursion_cycle_and_pop);
    RUN_TEST(test_degenerate_and_invalid);
    RUN_TEST(test_determinism);
    return UNITY_END();
}
