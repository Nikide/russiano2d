#include "re2d_world_polywall.h"
#include "unity.h"

#include <math.h>
#include <stdint.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-4f
#define PI_F 3.14159265358979323846f

static R2DWorldPolyWallTransform make_transform(float tx, float ty, float rotation,
                                                float pivot_x, float pivot_y)
{
    R2DWorldPolyWallTransform t;
    t.tx = tx;
    t.ty = ty;
    t.rotation = rotation;
    t.pivot_x = pivot_x;
    t.pivot_y = pivot_y;
    return t;
}

static R2DWorldPolyWallSegment make_segment(float x1, float y1, float x2, float y2,
                                            float bottom, float top)
{
    R2DWorldPolyWallSegment s;
    s.x1 = x1;
    s.y1 = y1;
    s.x2 = x2;
    s.y2 = y2;
    s.bottom = bottom;
    s.top = top;
    return s;
}

static uint32_t float_bits(float v)
{
    uint32_t bits;
    memcpy(&bits, &v, sizeof(bits));
    return bits;
}

static uint64_t hash_mix(uint64_t h, uint32_t v)
{
    h ^= (uint64_t)v;
    h *= 1099511628211ull;
    return h;
}

static float segment_length(const R2DWorldPolyWallSegment *s)
{
    float dx = s->x2 - s->x1;
    float dy = s->y2 - s->y1;
    return sqrtf(dx * dx + dy * dy);
}

static void test_transform_point(void)
{
    float ox = 123.0f, oy = 456.0f;

    R2DWorldPolyWallTransform identity = make_transform(0, 0, 0, 0, 0);
    r2d_world_polywall_transform_point(&identity, 3.0f, 4.0f, &ox, &oy);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 3.0f, ox, "identity keeps x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 4.0f, oy, "identity keeps y");

    // 90 deg around origin, then translate: (1,0) -> (0,1) -> (10,-1).
    R2DWorldPolyWallTransform t = make_transform(10.0f, -2.0f, PI_F / 2.0f, 0, 0);
    r2d_world_polywall_transform_point(&t, 1.0f, 0.0f, &ox, &oy);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 10.0f, ox, "rotation + translation x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f, oy, "rotation + translation y");

    // Pivot (10,20), +90 deg, then translate (5,-5): (12,20) -> (15,17).
    R2DWorldPolyWallTransform p = make_transform(5.0f, -5.0f, PI_F / 2.0f, 10.0f, 20.0f);
    r2d_world_polywall_transform_point(&p, 12.0f, 20.0f, &ox, &oy);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 15.0f, ox, "pivot rotation x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 17.0f, oy, "pivot rotation y");

    // The pivot itself only translates.
    r2d_world_polywall_transform_point(&p, 10.0f, 20.0f, &ox, &oy);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 15.0f, ox, "pivot maps by translation x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 15.0f, oy, "pivot maps by translation y");

    // Rotation is evaluated modulo 2*pi.
    float ax = 0.0f, ay = 0.0f;
    R2DWorldPolyWallTransform twopi = make_transform(0, 0, 2.0f * PI_F, 0, 0);
    r2d_world_polywall_transform_point(&twopi, 3.0f, 4.0f, &ax, &ay);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 3.0f, ax, "2*pi rotation is identity x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 4.0f, ay, "2*pi rotation is identity y");
}

static void test_transform_point_invalid(void)
{
    float ox = 77.0f;
    float oy = 88.0f;

    R2DWorldPolyWallTransform t = make_transform(1, 2, 0.5f, 0, 0);
    r2d_world_polywall_transform_point(NULL, 1.0f, 2.0f, &ox, &oy);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 77.0f, ox, "NULL transform leaves x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 88.0f, oy, "NULL transform leaves y");

    r2d_world_polywall_transform_point(&t, NAN, 2.0f, &ox, &oy);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 77.0f, ox, "NaN point leaves x");
    t.rotation = INFINITY;
    r2d_world_polywall_transform_point(&t, 1.0f, 2.0f, &ox, &oy);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 77.0f, ox, "infinite rotation leaves x");
    t = make_transform(1, 2, 0.5f, 0, 0);
    r2d_world_polywall_transform_point(&t, 1.0f, 2.0f, NULL, &oy);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 88.0f, oy, "NULL out x is a no-op");
    r2d_world_polywall_transform_point(&t, 1.0f, 2.0f, &ox, NULL);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 77.0f, ox, "NULL out y is a no-op");
}

static void test_apply_rigid_and_heights(void)
{
    R2DWorldPolyWallTransform t = make_transform(5.0f, 0.0f, PI_F / 2.0f, 0, 0);
    R2DWorldPolyWallSegment in[2] = {
        make_segment(1.0f, 0.0f, 1.0f, 4.0f, 0.0f, 3.0f),
        make_segment(-2.0f, -1.0f, 2.0f, -1.0f, -2.0f, 1.0f)
    };
    R2DWorldPolyWallSegment out[2];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_polywall_apply(&t, in, 2, out),
                             "valid apply succeeds");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 4.0f, segment_length(&out[0]),
                                     "segment 0 length preserved");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 4.0f, segment_length(&out[1]),
                                     "segment 1 length preserved");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 5.0f, out[0].x1, "segment 0 endpoint x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, out[0].y1, "segment 0 endpoint y");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, out[0].x2, "segment 0 far endpoint x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, out[0].y2, "segment 0 far endpoint y");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 6.0f, out[1].x1, "segment 1 endpoint x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -2.0f, out[1].y1, "segment 1 endpoint y");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 6.0f, out[1].x2, "segment 1 far endpoint x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 2.0f, out[1].y2, "segment 1 far endpoint y");

    for (int i = 0; i < 2; ++i) {
        TEST_ASSERT_EQUAL_FLOAT_MESSAGE(in[i].bottom, out[i].bottom,
                                        "bottom height preserved");
        TEST_ASSERT_EQUAL_FLOAT_MESSAGE(in[i].top, out[i].top, "top height preserved");
    }

    // Rotation is rigid for a spread of angles.
    R2DWorldPolyWallSegment one = make_segment(1.0f, 2.0f, 6.0f, 5.0f, 0.0f, 4.0f);
    float expected = segment_length(&one);
    for (int i = 0; i < 24; ++i) {
        R2DWorldPolyWallTransform rt = make_transform(0.1f * (float)i, -0.2f * (float)i,
                                                      0.13f * (float)i, 3.0f, -4.0f);
        R2DWorldPolyWallSegment rotated;
        TEST_ASSERT_TRUE(r2d_world_polywall_apply(&rt, &one, 1, &rotated));
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, expected, segment_length(&rotated),
                                         "length preserved for every yaw");
        TEST_ASSERT_EQUAL_FLOAT_MESSAGE(4.0f, rotated.top, "top preserved for every yaw");
    }
}

static void test_apply_in_place_and_invalid(void)
{
    R2DWorldPolyWallTransform t = make_transform(2.0f, 3.0f, PI_F / 4.0f, 1.0f, 1.0f);
    R2DWorldPolyWallSegment arr[2] = {
        make_segment(0.0f, 0.0f, 3.0f, 4.0f, 0.0f, 2.0f),
        make_segment(1.0f, 2.0f, -1.0f, 5.0f, 1.0f, 6.0f)
    };
    float before = segment_length(&arr[0]);
    float height_before = arr[0].top;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_polywall_apply(&t, arr, 2, arr),
                             "in-place apply is allowed");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, before, segment_length(&arr[0]),
                                     "in-place length preserved");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(height_before, arr[0].top, "in-place height preserved");

    R2DWorldPolyWallSegment sentinel = make_segment(11, 12, 13, 14, 0, 1);
    R2DWorldPolyWallSegment out[2];
    out[0] = sentinel;
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polywall_apply(NULL, arr, 2, out),
                              "NULL transform rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polywall_apply(&t, NULL, 2, out),
                              "NULL segments rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polywall_apply(&t, arr, 0, out),
                              "empty group rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polywall_apply(&t, arr, -1, out),
                              "negative count rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polywall_apply(&t, arr, 2, NULL),
                              "NULL out rejected");
    R2DWorldPolyWallSegment bad = arr[0];
    bad.y2 = NAN;
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polywall_apply(&t, &bad, 1, out),
                              "NaN segment rejected");
    R2DWorldPolyWallTransform bad_t = t;
    bad_t.tx = NAN;
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polywall_apply(&bad_t, arr, 2, out),
                              "NaN transform rejected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 11.0f, out[0].x1,
                                     "failed apply writes nothing");
}

static void test_bounds(void)
{
    R2DWorldPolyWallSegment segs[2] = {
        make_segment(1.0f, 2.0f, 3.0f, 5.0f, 0.0f, 4.0f),
        make_segment(-2.0f, 4.0f, 0.0f, -1.0f, -3.0f, 9.0f)
    };
    float minx = 0, miny = 0, maxx = 0, maxy = 0;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_polywall_bounds(segs, 2, &minx, &miny, &maxx, &maxy),
                             "valid bounds");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -2.0f, minx, "min x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f, miny, "min y");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 3.0f, maxx, "max x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 5.0f, maxy, "max y");

    // Bounds over transformed geometry (rotation + translation of a square).
    R2DWorldPolyWallTransform t = make_transform(10.0f, 20.0f, PI_F / 2.0f, 0, 0);
    R2DWorldPolyWallSegment square[4] = {
        make_segment(0.0f, 0.0f, 2.0f, 0.0f, 0, 1),
        make_segment(2.0f, 0.0f, 2.0f, 2.0f, 0, 1),
        make_segment(2.0f, 2.0f, 0.0f, 2.0f, 0, 1),
        make_segment(0.0f, 2.0f, 0.0f, 0.0f, 0, 1)
    };
    R2DWorldPolyWallSegment rotated[4];
    TEST_ASSERT_TRUE(r2d_world_polywall_apply(&t, square, 4, rotated));
    TEST_ASSERT_TRUE(r2d_world_polywall_bounds(rotated, 4, &minx, &miny, &maxx, &maxy));
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 8.0f, minx, "transformed min x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 20.0f, miny, "transformed min y");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 10.0f, maxx, "transformed max x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 22.0f, maxy, "transformed max y");

    minx = 42.0f;
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polywall_bounds(NULL, 2, &minx, &miny, &maxx, &maxy),
                              "NULL segments rejected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 42.0f, minx, "failed bounds writes nothing");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polywall_bounds(segs, 0, &minx, &miny, &maxx, &maxy),
                              "empty group rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polywall_bounds(segs, 2, NULL, &miny, &maxx, &maxy),
                              "NULL minx rejected");
    R2DWorldPolyWallSegment bad = segs[0];
    bad.x2 = INFINITY;
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_polywall_bounds(&bad, 1, &minx, &miny, &maxx, &maxy),
                              "infinite endpoint rejected");
}

static void test_sweep_body_hit(void)
{
    R2DWorldPolyWallSegment segs[1] = {make_segment(0, 0, 10, 0, 0, 4)};
    R2DWorldPolyWallHit hit;
    float t = r2d_world_polywall_sweep(segs, 1, 5, 5, 5, -5, 0.5f, &hit);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.45f, t, "body hit fraction");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, hit.segment, "body hit segment index");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, hit.nx, "body normal x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, hit.ny, "body normal y");

    // Radius 0 is a point trace through the segment.
    t = r2d_world_polywall_sweep(segs, 1, 5, 5, 5, -5, 0.0f, &hit);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.5f, t, "point trace fraction");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, hit.nx, "point trace normal x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, hit.ny, "point trace normal y");
}

static void test_sweep_miss(void)
{
    R2DWorldPolyWallSegment segs[2] = {
        make_segment(0, 0, 10, 0, 0, 4),
        make_segment(0, 0, 0, 10, 0, 4)
    };
    R2DWorldPolyWallHit hit;
    memset(&hit, 0xcd, sizeof(hit));
    hit.fraction = 0.123f;
    // Stops 1 unit above the wall, radius 0.5.
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f,
                                     r2d_world_polywall_sweep(segs, 1, 5, 5, 5, 1, 0.5f, &hit),
                                     "short sweep misses");
    // Parallel outside the segment extent.
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f,
                                     r2d_world_polywall_sweep(segs, 1, -5, 5, -5, -5, 0.5f, &hit),
                                     "sweep beside the segment misses");
    // Passes 2 units below the vertical endpoint with radius 1.
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f,
                                     r2d_world_polywall_sweep(&segs[1], 1, -5, -2, 5, -2, 1.0f, &hit),
                                     "endpoint cap miss");
    // Zero movement outside the capsule.
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f,
                                     r2d_world_polywall_sweep(segs, 1, 5, 5, 5, 5, 0.5f, &hit),
                                     "stationary miss");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.123f, hit.fraction,
                                     "miss leaves the hit untouched");
}

static void test_sweep_radius_blocked(void)
{
    R2DWorldPolyWallSegment segs[1] = {make_segment(0, 0, 10, 0, 0, 4)};
    R2DWorldPolyWallHit hit;

    // Starts already inside the radius: fraction 0, outward normal.
    float t = r2d_world_polywall_sweep(segs, 1, 5, 0.2f, 5, -5, 0.5f, &hit);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, t, "start overlap is fraction 0");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, hit.nx, "start overlap normal x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, hit.ny, "start overlap normal y");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, hit.segment, "start overlap segment");

    // Exactly touching counts as blocked at fraction 0.
    t = r2d_world_polywall_sweep(segs, 1, 5, 0.5f, 5, -5, 0.5f, &hit);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, t, "touching start blocks at 0");

    // Large radius starts deeply overlapped.
    t = r2d_world_polywall_sweep(segs, 1, 5, 3, 5, -5, 4.0f, &hit);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, t, "large radius blocks at 0");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, hit.ny, "large radius outward normal");
}

static void test_sweep_nearest(void)
{
    R2DWorldPolyWallSegment segs[2] = {
        make_segment(0, -4, 10, -4, 0, 4), // farther wall, index 0
        make_segment(0, -2, 10, -2, 0, 4)  // nearer wall, index 1
    };
    R2DWorldPolyWallHit hit;
    float t = r2d_world_polywall_sweep(segs, 2, 5, 5, 5, -5, 0.0f, &hit);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.7f, t, "nearest wall fraction");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, hit.segment, "nearest wall segment index");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, hit.ny, "nearest wall normal");

    R2DWorldPolyWallSegment reversed[2] = {segs[1], segs[0]};
    t = r2d_world_polywall_sweep(reversed, 2, 5, 5, 5, -5, 0.0f, &hit);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.7f, t, "reversed array keeps nearest fraction");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, hit.segment, "reversed array reports its index");

    // Radius makes the near wall block earlier.
    t = r2d_world_polywall_sweep(segs, 2, 5, 5, 5, -5, 0.5f, &hit);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.65f, t, "radius moves the near hit earlier");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, hit.segment, "radius still hits the near wall");
}

static void test_sweep_endpoint_cap(void)
{
    R2DWorldPolyWallSegment segs[1] = {make_segment(0, 0, 0, 10, 0, 5)};
    R2DWorldPolyWallHit hit;
    // Circle approaches the bottom endpoint from the left: entry at x=-1.
    float t = r2d_world_polywall_sweep(segs, 1, -5, 0, 5, 0, 1.0f, &hit);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.4f, t, "endpoint cap fraction");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f, hit.nx, "endpoint cap normal x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, hit.ny, "endpoint cap normal y");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, hit.segment, "endpoint cap segment");
}

static void test_sweep_invalid(void)
{
    R2DWorldPolyWallSegment segs[1] = {make_segment(0, 0, 10, 0, 0, 4)};
    R2DWorldPolyWallHit hit;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f,
                                     r2d_world_polywall_sweep(NULL, 1, 5, 5, 5, -5, 0.5f, &hit),
                                     "NULL segments rejected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f,
                                     r2d_world_polywall_sweep(segs, 0, 5, 5, 5, -5, 0.5f, &hit),
                                     "empty group rejected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f,
                                     r2d_world_polywall_sweep(segs, 1, NAN, 5, 5, -5, 0.5f, &hit),
                                     "NaN from rejected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f,
                                     r2d_world_polywall_sweep(segs, 1, 5, 5, INFINITY, -5, 0.5f, &hit),
                                     "infinite to rejected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f,
                                     r2d_world_polywall_sweep(segs, 1, 5, 5, 5, -5, NAN, &hit),
                                     "NaN radius rejected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f,
                                     r2d_world_polywall_sweep(segs, 1, 5, 5, 5, -5, -0.5f, &hit),
                                     "negative radius rejected");
    R2DWorldPolyWallSegment bad = segs[0];
    bad.y1 = NAN;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f,
                                     r2d_world_polywall_sweep(&bad, 1, 5, 5, 5, -5, 0.5f, &hit),
                                     "NaN segment rejected");
    // out_hit is optional.
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.45f,
                                     r2d_world_polywall_sweep(segs, 1, 5, 5, 5, -5, 0.5f, NULL),
                                     "NULL hit still returns the fraction");
}

static void test_lerp_endpoints_and_mid(void)
{
    R2DWorldPolyWallTransform from = make_transform(0, 0, 0, 0, 0);
    R2DWorldPolyWallTransform to = make_transform(10, 20, PI_F / 2.0f, 0, 0);
    R2DWorldPolyWallTransform out;

    r2d_world_polywall_lerp(&from, &to, 0.0f, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, out.tx, "f=0 tx");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, out.ty, "f=0 ty");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, out.rotation, "f=0 rotation");

    r2d_world_polywall_lerp(&from, &to, 1.0f, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 10.0f, out.tx, "f=1 tx");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 20.0f, out.ty, "f=1 ty");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, PI_F / 2.0f, out.rotation, "f=1 rotation");

    r2d_world_polywall_lerp(&from, &to, 0.5f, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 5.0f, out.tx, "mid tx");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 10.0f, out.ty, "mid ty");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, PI_F / 4.0f, out.rotation, "mid rotation");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, out.pivot_x, "mid pivot x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, out.pivot_y, "mid pivot y");

    // Fraction clamps to the timeline ends.
    r2d_world_polywall_lerp(&from, &to, -2.0f, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, out.tx, "fraction below 0 clamps");
    r2d_world_polywall_lerp(&from, &to, 3.0f, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 10.0f, out.tx, "fraction above 1 clamps");

    // Pivot interpolation is linear and the pivot itself carries no extra math.
    R2DWorldPolyWallTransform pf = make_transform(1, 2, 0, 4, 6);
    R2DWorldPolyWallTransform pt = make_transform(5, 8, 0, 10, 14);
    r2d_world_polywall_lerp(&pf, &pt, 0.5f, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 7.0f, out.pivot_x, "mid pivot x interpolation");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 10.0f, out.pivot_y, "mid pivot y interpolation");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 3.0f, out.tx, "translation interpolation");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 5.0f, out.ty, "translation y interpolation");
}

static void test_lerp_rotation_shortest_and_normalized(void)
{
    R2DWorldPolyWallTransform from = make_transform(0, 0, 3.0f, 0, 0);
    R2DWorldPolyWallTransform to = make_transform(0, 0, -3.0f, 0, 0);
    R2DWorldPolyWallTransform out;
    r2d_world_polywall_lerp(&from, &to, 0.5f, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, PI_F, fabsf(out.rotation),
                                     "shortest arc crosses +-pi");

    // 2*pi is normalized to 0 at the endpoint.
    R2DWorldPolyWallTransform a = make_transform(0, 0, 0, 0, 0);
    R2DWorldPolyWallTransform b = make_transform(0, 0, 2.0f * PI_F, 0, 0);
    r2d_world_polywall_lerp(&a, &b, 0.5f, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, out.rotation, "full turn normalizes to 0");
    r2d_world_polywall_lerp(&a, &b, 1.0f, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, out.rotation, "normalized endpoint");

    // out may alias from.
    R2DWorldPolyWallTransform alias = make_transform(2, 4, 0, 0, 0);
    R2DWorldPolyWallTransform target = make_transform(6, 8, 1.0f, 0, 0);
    r2d_world_polywall_lerp(&alias, &target, 0.5f, &alias);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 4.0f, alias.tx, "alias tx");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 6.0f, alias.ty, "alias ty");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.5f, alias.rotation, "alias rotation");
}

static void test_lerp_invalid(void)
{
    R2DWorldPolyWallTransform from = make_transform(0, 0, 0, 0, 0);
    R2DWorldPolyWallTransform to = make_transform(1, 2, 0.5f, 0, 0);
    R2DWorldPolyWallTransform out = make_transform(9, 9, 9, 9, 9);
    r2d_world_polywall_lerp(NULL, &to, 0.5f, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 9.0f, out.tx, "NULL from is a no-op");
    r2d_world_polywall_lerp(&from, NULL, 0.5f, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 9.0f, out.tx, "NULL to is a no-op");
    r2d_world_polywall_lerp(&from, &to, 0.5f, NULL);
    r2d_world_polywall_lerp(&from, &to, NAN, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 9.0f, out.tx, "NaN fraction is a no-op");
    r2d_world_polywall_lerp(&from, &to, INFINITY, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 9.0f, out.tx, "infinite fraction is a no-op");
    R2DWorldPolyWallTransform bad = to;
    bad.rotation = NAN;
    r2d_world_polywall_lerp(&from, &bad, 0.5f, &out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 9.0f, out.tx, "NaN target is a no-op");
}

static uint64_t run_deterministic_sequence(void)
{
    R2DWorldPolyWallSegment base[3] = {
        make_segment(-3, 1, 4, 2, 0, 3),
        make_segment(2, -2, 2, 5, -1, 4),
        make_segment(-4, -4, 5, -3, 0, 2)
    };
    R2DWorldPolyWallSegment out[3];
    R2DWorldPolyWallHit hit;
    memset(&hit, 0, sizeof(hit));
    R2DWorldPolyWallTransform a = make_transform(0, 0, 0, 0, 0);
    R2DWorldPolyWallTransform b = make_transform(3, -2, 1.7f, 1, 1);
    R2DWorldPolyWallTransform tmp;
    uint64_t h = 1469598103934665603ull;

    for (int i = 0; i < 100; ++i) {
        float fi = (float)i;
        R2DWorldPolyWallTransform t = {
            0.1f * fi, -0.2f * fi, 0.07f * fi, 0.5f, -0.75f
        };
        float ox, oy;
        r2d_world_polywall_transform_point(&t, fi * 0.3f, -fi * 0.1f, &ox, &oy);
        h = hash_mix(h, float_bits(ox));
        h = hash_mix(h, float_bits(oy));

        TEST_ASSERT_TRUE(r2d_world_polywall_apply(&t, base, 3, out));
        float minx, miny, maxx, maxy;
        TEST_ASSERT_TRUE(r2d_world_polywall_bounds(out, 3, &minx, &miny, &maxx, &maxy));
        h = hash_mix(h, float_bits(minx));
        h = hash_mix(h, float_bits(miny));
        h = hash_mix(h, float_bits(maxx));
        h = hash_mix(h, float_bits(maxy));

        float sweep = r2d_world_polywall_sweep(out, 3, -5.0f, 4.0f, 5.0f, -4.0f,
                                               0.3f, &hit);
        h = hash_mix(h, float_bits(sweep));
        h = hash_mix(h, float_bits(hit.fraction));
        h = hash_mix(h, float_bits(hit.nx));
        h = hash_mix(h, float_bits(hit.ny));
        h = hash_mix(h, (uint32_t)hit.segment);

        r2d_world_polywall_lerp(&a, &b, fi / 99.0f, &tmp);
        h = hash_mix(h, float_bits(tmp.tx));
        h = hash_mix(h, float_bits(tmp.ty));
        h = hash_mix(h, float_bits(tmp.rotation));
    }
    return h;
}

static void test_determinism(void)
{
    uint64_t first = run_deterministic_sequence();
    uint64_t second = run_deterministic_sequence();
    TEST_ASSERT_TRUE_MESSAGE(first == second, "100-step sequence hashes are identical");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_transform_point);
    RUN_TEST(test_transform_point_invalid);
    RUN_TEST(test_apply_rigid_and_heights);
    RUN_TEST(test_apply_in_place_and_invalid);
    RUN_TEST(test_bounds);
    RUN_TEST(test_sweep_body_hit);
    RUN_TEST(test_sweep_miss);
    RUN_TEST(test_sweep_radius_blocked);
    RUN_TEST(test_sweep_nearest);
    RUN_TEST(test_sweep_endpoint_cap);
    RUN_TEST(test_sweep_invalid);
    RUN_TEST(test_lerp_endpoints_and_mid);
    RUN_TEST(test_lerp_rotation_shortest_and_normalized);
    RUN_TEST(test_lerp_invalid);
    RUN_TEST(test_determinism);
    return UNITY_END();
}
