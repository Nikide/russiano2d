#include "re2d_world_polygon.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define MAX_OUT_POINTS (3 * R2D_WORLD_POLYGON_MAX_POINTS)

typedef struct {
    R2DWorldPolygon rings[16];
    R2DWorldPoint points[64];
    int ring_count;
    int point_count;
} Decomposition;

static R2DWorldPoint point(float x, float y)
{
    R2DWorldPoint p = {x, y};
    return p;
}

static void clear_decomposition(Decomposition *d)
{
    memset(d, 0, sizeof *d);
    for (int i = 0; i < 16; i++) d->rings[i] = (R2DWorldPolygon){-1, -1};
    for (int i = 0; i < 64; i++) d->points[i] = point(-12345.0f, -12345.0f);
}

static int run_decomposition(const R2DWorldPoint *points, int count,
                             Decomposition *out, char *error)
{
    out->ring_count = r2d_world_polygon_decompose(points, count,
                                                  out->rings, 16,
                                                  out->points, 64,
                                                  &out->point_count,
                                                  error, 128);
    return out->ring_count;
}

static float ring_area(const Decomposition *d, int index)
{
    const R2DWorldPolygon *ring = &d->rings[index];
    return r2d_world_polygon_area(&d->points[ring->first], ring->count);
}

static float decomposition_area(const Decomposition *d)
{
    float total = 0.0f;
    for (int i = 0; i < d->ring_count; i++) total += ring_area(d, i);
    return total;
}

// The square used by several tests: CCW, area 100, bounds [0,0..10,10].
static const R2DWorldPoint SQUARE[4] = {
    {0, 0}, {10, 0}, {10, 10}, {0, 10}
};

// ---------------------------------------------------------------------------
// Winding / validation
// ---------------------------------------------------------------------------

static void test_winding_ccw_cw_degenerate(void)
{
    R2DWorldPoint cw[4] = {
        {0, 0}, {0, 10}, {10, 10}, {10, 0}
    };
    R2DWorldPoint line[3] = {
        {0, 0}, {5, 0}, {10, 0}
    };
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_world_polygon_winding(SQUARE, 4),
                                  "CCW square is positive");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_polygon_winding(cw, 4),
                                  "CW square is negative");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_polygon_winding(line, 3),
                                  "collinear triangle is degenerate");
    TEST_ASSERT_EQUAL_INT(0, r2d_world_polygon_winding(NULL, 4));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_polygon_winding(SQUARE, 2));
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 100.0f,
                             r2d_world_polygon_area(SQUARE, 4));
}

static void test_valid_rejects_self_intersection(void)
{
    R2DWorldPoint bowtie[4] = {
        {0, 0}, {10, 10}, {10, 0}, {0, 6}
    };
    char error[128] = {0};
    TEST_ASSERT_FALSE(r2d_world_polygon_valid(bowtie, 4, error, sizeof error));
    TEST_ASSERT_NOT_NULL(strstr(error, "self"));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_polygon_decompose(
        bowtie, 4, NULL, 0, NULL, 0, NULL, error, sizeof error));
}

static void test_duplicate_vertex_handling(void)
{
    R2DWorldPoint doubled[5] = {
        {0, 0}, {10, 0}, {10, 0}, {10, 10}, {0, 10}
    };
    R2DWorldPoint closing[5] = {
        {0, 0}, {10, 0}, {10, 10}, {0, 10}, {0, 0}
    };
    char error[128] = {0};
    Decomposition d;
    clear_decomposition(&d);

    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polygon_valid(doubled, 5, error,
                                                      sizeof error),
                              "duplicate consecutive vertex is invalid input");
    TEST_ASSERT_NOT_NULL(strstr(error, "duplicate"));
    TEST_ASSERT_FALSE(r2d_world_polygon_valid(closing, 5, error, sizeof error));
    R2DWorldPoint self_touch[5] = {
        {0, 0}, {10, 0}, {10, 10}, {0, 10}, {10, 0}
    };
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polygon_valid(self_touch, 5, error,
                                                      sizeof error),
                              "non-consecutive duplicate is self-touch");

    // Decomposition is forgiving: it cleans the duplicate first.
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, run_decomposition(doubled, 5, &d, error),
                                  "duplicate is removed before decomposition");
    TEST_ASSERT_EQUAL_INT(1, d.ring_count);
    TEST_ASSERT_EQUAL_INT(4, d.rings[0].count);
    TEST_ASSERT_EQUAL_INT(4, d.point_count);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 100.0f, decomposition_area(&d));

    clear_decomposition(&d);
    TEST_ASSERT_EQUAL_INT(1, run_decomposition(closing, 5, &d, error));
    TEST_ASSERT_EQUAL_INT(4, d.point_count);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 100.0f, decomposition_area(&d));
}

static void test_collinear_vertex_handling(void)
{
    R2DWorldPoint with_midpoint[5] = {
        {0, 0}, {5, 0}, {10, 0}, {10, 10}, {0, 10}
    };
    char error[128] = {0};
    Decomposition d;
    clear_decomposition(&d);

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_polygon_valid(with_midpoint, 5, error,
                                                     sizeof error),
                             "collinear midpoint is still a simple ring");
    TEST_ASSERT_EQUAL_INT(1, run_decomposition(with_midpoint, 5, &d, error));
    TEST_ASSERT_EQUAL_INT(1, d.ring_count);
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, d.rings[0].count,
                                  "redundant collinear vertex is dropped");
    TEST_ASSERT_EQUAL_INT(4, d.point_count);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 100.0f, decomposition_area(&d));
}

static void test_valid_accepts_cw_and_collinear(void)
{
    R2DWorldPoint cw[4] = {
        {0, 0}, {0, 10}, {10, 10}, {10, 0}
    };
    R2DWorldPoint line[3] = {
        {0, 0}, {5, 0}, {10, 0}
    };
    char error[128] = {0};
    TEST_ASSERT_TRUE(r2d_world_polygon_valid(SQUARE, 4, error, sizeof error));
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_polygon_valid(cw, 4, error, sizeof error),
                             "CW authoring is accepted and normalised later");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polygon_valid(line, 3, error,
                                                      sizeof error),
                              "zero-area ring is not valid");
    TEST_ASSERT_NOT_NULL(strstr(error, "degenerate"));
}

// ---------------------------------------------------------------------------
// Decomposition
// ---------------------------------------------------------------------------

static void test_convex_ring_single_part(void)
{
    R2DWorldPoint hexagon[6] = {
        {0, 0}, {4, 0}, {6, 2}, {4, 4}, {0, 4}, {-2, 2}
    };
    char error[128] = {0};
    Decomposition d;
    clear_decomposition(&d);
    float area = r2d_world_polygon_area(hexagon, 6);

    TEST_ASSERT_TRUE(r2d_world_polygon_valid(hexagon, 6, error, sizeof error));
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, run_decomposition(hexagon, 6, &d, error),
                                  "already convex ring is not split");
    TEST_ASSERT_EQUAL_INT(1, d.ring_count);
    TEST_ASSERT_EQUAL_INT_MESSAGE(6, d.rings[0].count,
                                  "convex part keeps all cleaned vertices");
    TEST_ASSERT_EQUAL_INT(6, d.point_count);
    TEST_ASSERT_EQUAL_INT(1, r2d_world_polygon_winding(&d.points[0], 6));
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, area, decomposition_area(&d));

    // CW input is normalised by decomposition, not rejected.
    R2DWorldPoint hexagon_cw[6];
    for (int i = 0; i < 6; i++) hexagon_cw[i] = hexagon[5 - i];
    clear_decomposition(&d);
    TEST_ASSERT_EQUAL_INT(1, run_decomposition(hexagon_cw, 6, &d, error));
    TEST_ASSERT_EQUAL_INT(1, d.ring_count);
    TEST_ASSERT_EQUAL_INT(6, d.point_count);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_world_polygon_winding(&d.points[0], 6),
                                  "decomposed ring is CCW regardless of input");
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, area, decomposition_area(&d));
}

static void test_l_shape_decomposition(void)
{
    R2DWorldPoint l_shape[6] = {
        {0, 0}, {4, 0}, {4, 2}, {2, 2}, {2, 4}, {0, 4}
    };
    char error[128] = {0};
    Decomposition d;
    clear_decomposition(&d);

    TEST_ASSERT_TRUE(r2d_world_polygon_valid(l_shape, 6, error, sizeof error));
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, run_decomposition(l_shape, 6, &d, error),
                                  "concave 6-gon decomposes into n-2 parts");
    TEST_ASSERT_EQUAL_INT(4, d.ring_count);
    TEST_ASSERT_EQUAL_INT_MESSAGE(12, d.point_count,
                                  "four triangles use twelve output points");
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 12.0f, decomposition_area(&d));

    for (int i = 0; i < d.ring_count; i++) {
        TEST_ASSERT_EQUAL_INT(3, d.rings[i].count);
        TEST_ASSERT_EQUAL_INT(3 * i, d.rings[i].first);
        TEST_ASSERT_EQUAL_INT_MESSAGE(
            1, r2d_world_polygon_winding(&d.points[d.rings[i].first], 3),
            "each triangle is emitted CCW");
        TEST_ASSERT_TRUE(ring_area(&d, i) > 0.0f);
    }
}

static void test_u_shape_decomposition(void)
{
    R2DWorldPoint u_shape[8] = {
        {0, 0}, {6, 0}, {6, 6}, {4, 6},
        {4, 2}, {2, 2}, {2, 6}, {0, 6}
    };
    char error[128] = {0};
    Decomposition d;
    clear_decomposition(&d);

    TEST_ASSERT_TRUE(r2d_world_polygon_valid(u_shape, 8, error, sizeof error));
    TEST_ASSERT_EQUAL_INT_MESSAGE(6, run_decomposition(u_shape, 8, &d, error),
                                  "concave 8-gon decomposes into six parts");
    TEST_ASSERT_EQUAL_INT(6, d.ring_count);
    TEST_ASSERT_EQUAL_INT(18, d.point_count);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 28.0f, decomposition_area(&d));
    for (int i = 0; i < d.ring_count; i++)
        TEST_ASSERT_EQUAL_INT(3, d.rings[i].count);
}

static void test_decomposition_deterministic(void)
{
    R2DWorldPoint l_shape[6] = {
        {0, 0}, {4, 0}, {4, 2}, {2, 2}, {2, 4}, {0, 4}
    };
    char error[128] = {0};
    Decomposition first, second;
    clear_decomposition(&first);
    clear_decomposition(&second);

    int a = run_decomposition(l_shape, 6, &first, error);
    int b = run_decomposition(l_shape, 6, &second, error);
    TEST_ASSERT_EQUAL_INT(a, b);
    TEST_ASSERT_EQUAL_INT(4, a);
    TEST_ASSERT_EQUAL_INT(first.point_count, second.point_count);
    TEST_ASSERT_EQUAL_INT(0, memcmp(first.rings, second.rings, sizeof first.rings));
    TEST_ASSERT_EQUAL_INT(0, memcmp(first.points, second.points,
                                    sizeof first.points));
}

static void test_sizing_and_capacity_contract(void)
{
    R2DWorldPoint l_shape[6] = {
        {0, 0}, {4, 0}, {4, 2}, {2, 2}, {2, 4}, {0, 4}
    };
    char error[128] = {0};
    int point_count = -1;
    int parts = r2d_world_polygon_decompose(l_shape, 6, NULL, 0, NULL, 0,
                                            &point_count, error, sizeof error);
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, parts,
                                  "sizing pass returns the required part count");
    TEST_ASSERT_EQUAL_INT_MESSAGE(12, point_count,
                                  "sizing pass returns the required point count");

    R2DWorldPolygon rings[4];
    R2DWorldPoint points[12];
    parts = r2d_world_polygon_decompose(l_shape, 6, rings, 4, points, 12,
                                        &point_count, error, sizeof error);
    TEST_ASSERT_EQUAL_INT(4, parts);
    TEST_ASSERT_EQUAL_INT(12, point_count);

    R2DWorldPolygon small_rings[4];
    R2DWorldPoint small_points[12];
    small_rings[0] = (R2DWorldPolygon){-7, -7};
    small_points[0] = point(-7.0f, -7.0f);
    parts = r2d_world_polygon_decompose(l_shape, 6, small_rings, 3,
                                        small_points, 12, &point_count,
                                        error, sizeof error);
    TEST_ASSERT_EQUAL_INT(4, parts);
    TEST_ASSERT_EQUAL_INT(-7, small_rings[0].first);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, -7.0f, small_points[0].x);

    small_rings[0] = (R2DWorldPolygon){-7, -7};
    parts = r2d_world_polygon_decompose(l_shape, 6, small_rings, 4,
                                        small_points, 11, &point_count,
                                        error, sizeof error);
    TEST_ASSERT_EQUAL_INT(4, parts);
    TEST_ASSERT_EQUAL_INT(-7, small_rings[0].first);
}

// ---------------------------------------------------------------------------
// Shared edges
// ---------------------------------------------------------------------------

static void test_shared_edges_symmetric(void)
{
    R2DWorldPoint east[4] = {
        {10, 0}, {20, 0}, {20, 10}, {10, 10}
    };
    R2DWorldPoint east_cw[4] = {
        {10, 10}, {20, 10}, {20, 0}, {10, 0}
    };
    R2DWorldPoint far_away[4] = {
        {40, 0}, {50, 0}, {50, 10}, {40, 10}
    };

    TEST_ASSERT_EQUAL_INT_MESSAGE(1,
        r2d_world_polygon_shared_edges(SQUARE, 4, east, 4, 1e-3f),
        "adjacent squares share one edge");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,
        r2d_world_polygon_shared_edges(east, 4, SQUARE, 4, 1e-3f),
        "shared-edge count is symmetric");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,
        r2d_world_polygon_shared_edges(SQUARE, 4, east_cw, 4, 1e-3f),
        "winding does not change the undirected match");
    TEST_ASSERT_EQUAL_INT(0,
        r2d_world_polygon_shared_edges(SQUARE, 4, far_away, 4, 1e-3f));
    TEST_ASSERT_EQUAL_INT_MESSAGE(4,
        r2d_world_polygon_shared_edges(SQUARE, 4, SQUARE, 4, 1e-3f),
        "a ring matches all of its own edges");
}

static void test_shared_edges_epsilon_boundary(void)
{
    R2DWorldPoint near[4] = {
        {10.5f, 0}, {20.5f, 0}, {20.5f, 10}, {10.5f, 10}
    };
    R2DWorldPoint farther[4] = {
        {10.75f, 0}, {20.75f, 0}, {20.75f, 10}, {10.75f, 10}
    };
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,
        r2d_world_polygon_shared_edges(SQUARE, 4, near, 4, 0.5f),
        "endpoint distance equal to epsilon still matches");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,
        r2d_world_polygon_shared_edges(SQUARE, 4, farther, 4, 0.5f),
        "endpoint distance beyond epsilon does not match");
    TEST_ASSERT_EQUAL_INT(-1,
        r2d_world_polygon_shared_edges(SQUARE, 4, near, 4, -1.0f));
    TEST_ASSERT_EQUAL_INT(-1,
        r2d_world_polygon_shared_edges(SQUARE, 4, near, 4, NAN));
    TEST_ASSERT_EQUAL_INT(-1,
        r2d_world_polygon_shared_edges(NULL, 4, near, 4, 1.0f));
}

// ---------------------------------------------------------------------------
// Bounds / area / arguments
// ---------------------------------------------------------------------------

static void test_bounds_and_area_concave(void)
{
    R2DWorldPoint l_shape[6] = {
        {0, 0}, {4, 0}, {4, 2}, {2, 2}, {2, 4}, {0, 4}
    };
    R2DWorldPoint reversed[6];
    for (int i = 0; i < 6; i++) reversed[i] = l_shape[5 - i];
    float minx = 0, miny = 0, maxx = 0, maxy = 0;

    TEST_ASSERT_TRUE(r2d_world_polygon_bounds(l_shape, 6, &minx, &miny,
                                              &maxx, &maxy));
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.0f, minx);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.0f, miny);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 4.0f, maxx);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 4.0f, maxy);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 12.0f,
                             r2d_world_polygon_area(l_shape, 6));
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 12.0f,
                             r2d_world_polygon_area(reversed, 6));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_polygon_winding(reversed, 6));
}

static void test_bounds_failure_leaves_outputs_untouched(void)
{
    float minx = 11, miny = 22, maxx = 33, maxy = 44;
    TEST_ASSERT_FALSE(r2d_world_polygon_bounds(SQUARE, 2, &minx, &miny,
                                               &maxx, &maxy));
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 11.0f, minx);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 22.0f, miny);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 33.0f, maxx);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 44.0f, maxy);
    TEST_ASSERT_FALSE(r2d_world_polygon_bounds(NULL, 4, &minx, &miny,
                                               &maxx, &maxy));
    TEST_ASSERT_FALSE(r2d_world_polygon_bounds(SQUARE, 4, NULL, &miny,
                                               &maxx, &maxy));
}

static void test_invalid_counts_and_arguments(void)
{
    R2DWorldPoint nonfinite[4] = {
        {0, 0}, {NAN, 0}, {10, 10}, {0, 10}
    };
    R2DWorldPoint many[R2D_WORLD_POLYGON_MAX_POINTS + 1];
    for (int i = 0; i <= R2D_WORLD_POLYGON_MAX_POINTS; i++)
        many[i] = point((float)i, 0.0f);
    char error[128] = {0};

    TEST_ASSERT_FALSE(r2d_world_polygon_valid(NULL, 4, error, sizeof error));
    TEST_ASSERT_FALSE(r2d_world_polygon_valid(SQUARE, 2, error, sizeof error));
    TEST_ASSERT_FALSE(r2d_world_polygon_valid(many,
        R2D_WORLD_POLYGON_MAX_POINTS + 1, error, sizeof error));
    TEST_ASSERT_FALSE(r2d_world_polygon_valid(nonfinite, 4, error,
                                              sizeof error));

    TEST_ASSERT_EQUAL_INT(-1, r2d_world_polygon_decompose(
        NULL, 4, NULL, 0, NULL, 0, NULL, error, sizeof error));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_polygon_decompose(
        SQUARE, 2, NULL, 0, NULL, 0, NULL, error, sizeof error));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_polygon_decompose(
        SQUARE, 4, NULL, 1, NULL, 0, NULL, error, sizeof error));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_polygon_decompose(
        SQUARE, 4, NULL, 0, NULL, 1, NULL, error, sizeof error));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_polygon_decompose(
        SQUARE, 4, NULL, -1, NULL, 0, NULL, error, sizeof error));

    TEST_ASSERT_EQUAL_INT(0, r2d_world_polygon_winding(nonfinite, 4));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_polygon_winding(SQUARE, 2));
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.0f,
                             r2d_world_polygon_area(nonfinite, 4));
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.0f,
                             r2d_world_polygon_area(SQUARE, 2));
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.0f,
                             r2d_world_polygon_area(NULL, 4));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_polygon_shared_edges(
        SQUARE, 2, SQUARE, 4, 0.1f));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_polygon_shared_edges(
        SQUARE, 4, SQUARE, 4, NAN));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_winding_ccw_cw_degenerate);
    RUN_TEST(test_valid_rejects_self_intersection);
    RUN_TEST(test_duplicate_vertex_handling);
    RUN_TEST(test_collinear_vertex_handling);
    RUN_TEST(test_valid_accepts_cw_and_collinear);
    RUN_TEST(test_convex_ring_single_part);
    RUN_TEST(test_l_shape_decomposition);
    RUN_TEST(test_u_shape_decomposition);
    RUN_TEST(test_decomposition_deterministic);
    RUN_TEST(test_sizing_and_capacity_contract);
    RUN_TEST(test_shared_edges_symmetric);
    RUN_TEST(test_shared_edges_epsilon_boundary);
    RUN_TEST(test_bounds_and_area_concave);
    RUN_TEST(test_bounds_failure_leaves_outputs_untouched);
    RUN_TEST(test_invalid_counts_and_arguments);
    return UNITY_END();
}
