// Re2D World atlas sprites: native direction selection, pivot and crop math.
// Pure C, no engine state: the runtime feeds these results into world compositing.
#include "unity.h"
#include "re2d_world_atlas.h"
#include <math.h>
#include <string.h>

#define PI_F 3.14159265358979323846f

void setUp(void) {}
void tearDown(void) {}

static void test_relative_yaw_facing_camera_is_zero(void)
{
    // Camera at origin looking north; actor to the north faces south (toward camera).
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 0.0f, r2d_world_atlas_relative_yaw(-PI_F * 0.5f, 0.0f, 1.0f));
}

static void test_relative_yaw_turn_is_signed(void)
{
    // Actor to the north; facing east (+X) is a +90 degree turn from camera-facing.
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, PI_F * 0.5f, r2d_world_atlas_relative_yaw(0.0f, 0.0f, 1.0f));
    // Facing west is the mirrored turn.
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, -PI_F * 0.5f, r2d_world_atlas_relative_yaw(PI_F, 0.0f, 1.0f));
}

static void test_relative_yaw_degenerate_inputs_are_safe(void)
{
    TEST_ASSERT_EQUAL_FLOAT(0.0f, r2d_world_atlas_relative_yaw(0.0f, 0.0f, 0.0f));
    TEST_ASSERT_EQUAL_FLOAT(0.0f, r2d_world_atlas_relative_yaw(NAN, 0.0f, 1.0f));
    TEST_ASSERT_EQUAL_FLOAT(0.0f, r2d_world_atlas_relative_yaw(0.0f, INFINITY, 1.0f));
}

static void test_direction_single_and_eight(void)
{
    bool flip = true;
    TEST_ASSERT_EQUAL_INT(0, r2d_world_atlas_direction(0.0f, 1, false, &flip));
    TEST_ASSERT_FALSE(flip);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_atlas_direction(0.0f, 8, false, &flip));
    // Eight 45-degree sectors: front 0, right 2, back 4, left 6.
    TEST_ASSERT_EQUAL_INT(2, r2d_world_atlas_direction(PI_F * 0.5f, 8, false, &flip));
    TEST_ASSERT_EQUAL_INT(4, r2d_world_atlas_direction(PI_F, 8, false, &flip));
    TEST_ASSERT_EQUAL_INT(6, r2d_world_atlas_direction(-PI_F * 0.5f, 8, false, &flip));
    // Sector boundary rotates to the next column deterministically.
    TEST_ASSERT_EQUAL_INT(1, r2d_world_atlas_direction(PI_F * 0.25f, 8, false, &flip));
}

static void test_explicit_column_overrides_facing(void)
{
    bool flip = true;
    // Packed layered character: the game owns the direction column.
    TEST_ASSERT_EQUAL_INT(7, r2d_world_atlas_column(true, 7, 16, 0.0f, 16, true, &flip));
    TEST_ASSERT_FALSE(flip);
    TEST_ASSERT_EQUAL_INT(7, r2d_world_atlas_column(true, 7, 16, PI_F, 16, true, &flip));
    // Out-of-range columns clamp instead of reading outside the atlas.
    TEST_ASSERT_EQUAL_INT(0, r2d_world_atlas_column(true, -3, 16, 0.0f, 16, false, &flip));
    TEST_ASSERT_EQUAL_INT(15, r2d_world_atlas_column(true, 99, 16, 0.0f, 16, false, &flip));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_atlas_column(true, 9, 0, 0.0f, 16, false, &flip));
    // Without the explicit flag the relative-yaw selection is unchanged.
    TEST_ASSERT_EQUAL_INT(r2d_world_atlas_direction(PI_F * 0.5f, 8, false, &flip),
                          r2d_world_atlas_column(false, 7, 16, PI_F * 0.5f, 8, false, &flip));
}

static void test_direction_mirrored_five(void)
{
    bool flip = false;
    // Five authored columns cover 180 degrees, the other side mirrors.
    TEST_ASSERT_EQUAL_INT(0, r2d_world_atlas_direction(0.0f, 5, true, &flip));
    TEST_ASSERT_FALSE(flip);
    TEST_ASSERT_EQUAL_INT(2, r2d_world_atlas_direction(PI_F * 0.5f, 5, true, &flip));
    TEST_ASSERT_FALSE(flip);
    TEST_ASSERT_EQUAL_INT(4, r2d_world_atlas_direction(PI_F, 5, true, &flip));
    TEST_ASSERT_FALSE(flip);
    TEST_ASSERT_EQUAL_INT(2, r2d_world_atlas_direction(-PI_F * 0.5f, 5, true, &flip));
    TEST_ASSERT_TRUE(flip);
    TEST_ASSERT_EQUAL_INT(1, r2d_world_atlas_direction(-PI_F * 0.25f, 5, true, &flip));
    TEST_ASSERT_TRUE(flip);
}

static void test_direction_clamps_and_normalizes(void)
{
    bool flip = true;
    // Yaw beyond one circle is normalized, not truncated.
    TEST_ASSERT_EQUAL_INT(0, r2d_world_atlas_direction(PI_F * 4.0f, 4, false, &flip));
    // Out-of-range direction counts stay safe.
    TEST_ASSERT_EQUAL_INT(0, r2d_world_atlas_direction(0.0f, 0, false, &flip));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_atlas_direction(0.0f, -8, true, &flip));
    TEST_ASSERT_FALSE(flip);
}

static void test_cell_rect_and_clamping(void)
{
    int x = -1, y = -1, w = -1, h = -1;
    r2d_world_atlas_cell(3, 2, 5, 8, 198, 198, &x, &y, &w, &h);
    TEST_ASSERT_EQUAL_INT(594, x);
    TEST_ASSERT_EQUAL_INT(396, y);
    TEST_ASSERT_EQUAL_INT(198, w);
    TEST_ASSERT_EQUAL_INT(198, h);
    r2d_world_atlas_cell(99, -5, 5, 8, 198, 198, &x, &y, &w, &h);
    TEST_ASSERT_EQUAL_INT(4 * 198, x);
    TEST_ASSERT_EQUAL_INT(0, y);
}

static void test_pivot_modes(void)
{
    float px = -1, py = -1;
    r2d_world_atlas_pivot(R2D_WORLD_ATLAS_PIVOT_CENTER, 0, 0, &px, &py);
    TEST_ASSERT_EQUAL_FLOAT(0.5f, px);
    TEST_ASSERT_EQUAL_FLOAT(0.5f, py);
    r2d_world_atlas_pivot(R2D_WORLD_ATLAS_PIVOT_FEET, 0, 0, &px, &py);
    TEST_ASSERT_EQUAL_FLOAT(0.5f, px);
    TEST_ASSERT_EQUAL_FLOAT(1.0f, py);
    r2d_world_atlas_pivot(R2D_WORLD_ATLAS_PIVOT_BOTTOM_CENTER, 0, 0, &px, &py);
    TEST_ASSERT_EQUAL_FLOAT(0.5f, px);
    TEST_ASSERT_EQUAL_FLOAT(1.0f, py);
    r2d_world_atlas_pivot(R2D_WORLD_ATLAS_PIVOT_CUSTOM, 5.0f, -2.0f, &px, &py);
    TEST_ASSERT_EQUAL_FLOAT(1.0f, px);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, py);
    r2d_world_atlas_pivot(99, 0, 0, &px, &py);
    TEST_ASSERT_EQUAL_FLOAT(0.5f, px);
    TEST_ASSERT_EQUAL_FLOAT(1.0f, py);
}

static void test_placement_feet_pivot_bottom_center(void)
{
    int side = 0, dx = -1, dy = -1;
    float px = -1, py = -1;
    TEST_ASSERT_TRUE(r2d_world_atlas_placement(128, 96, 0.5f, 1.0f, &side, &dx, &dy, &px, &py));
    TEST_ASSERT_EQUAL_INT(128, side);
    TEST_ASSERT_EQUAL_INT(0, dx);
    // The cell sits on the square bottom: 128 - 96.
    TEST_ASSERT_EQUAL_INT(32, dy);
    TEST_ASSERT_EQUAL_FLOAT(64.0f, px);
    TEST_ASSERT_EQUAL_FLOAT(128.0f, py);
}

static void test_placement_center_pivot_keeps_cell(void)
{
    int side = 0, dx = -1, dy = -1;
    float px = -1, py = -1;
    TEST_ASSERT_TRUE(r2d_world_atlas_placement(128, 128, 0.5f, 0.5f, &side, &dx, &dy, &px, &py));
    TEST_ASSERT_EQUAL_INT(128, side);
    TEST_ASSERT_EQUAL_INT(0, dx);
    TEST_ASSERT_EQUAL_INT(0, dy);
    TEST_ASSERT_EQUAL_FLOAT(64.0f, px);
    TEST_ASSERT_EQUAL_FLOAT(64.0f, py);
}

static void test_placement_custom_pivot_clamped_inside_square(void)
{
    int side = 0, dx = -1, dy = -1;
    float px = -1, py = -1;
    TEST_ASSERT_TRUE(r2d_world_atlas_placement(100, 60, 0.0f, 0.0f, &side, &dx, &dy, &px, &py));
    TEST_ASSERT_EQUAL_INT(100, side);
    // Rounding can place the origin at most one pixel outside; clamping keeps the cell visible.
    TEST_ASSERT_TRUE(dx >= 0 && dx + 100 <= side);
    TEST_ASSERT_TRUE(dy >= 0 && dy + 60 <= side);
    TEST_ASSERT_TRUE(px >= 0 && px <= (float)side);
    TEST_ASSERT_TRUE(py >= 0 && py <= (float)side);
}

static void test_placement_rejects_invalid_cells(void)
{
    int side = 0, dx = 0, dy = 0;
    float px = 0, py = 0;
    TEST_ASSERT_FALSE(r2d_world_atlas_placement(0, 32, 0.5f, 1.0f, &side, &dx, &dy, &px, &py));
    TEST_ASSERT_FALSE(r2d_world_atlas_placement(4, 2000, 0.5f, 1.0f, &side, &dx, &dy, &px, &py));
    TEST_ASSERT_FALSE(r2d_world_atlas_placement(32, 32, NAN, 1.0f, &side, &dx, &dy, &px, &py));
}

// 4x2 atlas: two cells of 2x2. Cell (1,0) has distinct corner colors so a flip
// is observable in the output.
static const uint8_t ATLAS[4 * 2 * 4] = {
    // row 0, cell 0
    10, 0, 0, 255, 20, 0, 0, 255,
    // row 0, cell 1
    30, 0, 0, 255, 40, 0, 0, 255,
    // row 1, cell 0
    50, 0, 0, 255, 60, 0, 0, 255,
    // row 1, cell 1
    70, 0, 0, 255, 80, 0, 0, 255,
};

static void test_crop_copies_cell(void)
{
    uint8_t out[4 * 4 * 4];
    TEST_ASSERT_TRUE(r2d_world_atlas_crop(ATLAS, 4, 2, 2, 0, 2, 2, false, 4, 1, 1, out));
    const uint8_t *p = out + ((1 * 4 + 1) * 4);
    TEST_ASSERT_EQUAL_UINT8(30, p[0]);
    TEST_ASSERT_EQUAL_UINT8(40, p[4]);
    TEST_ASSERT_EQUAL_UINT8(70, out[((2 * 4 + 1) * 4) + 0]);
    // Padding starts fully transparent.
    TEST_ASSERT_EQUAL_UINT8(0, out[3]);
    TEST_ASSERT_EQUAL_UINT8(0, out[(3 * 4 + 3) * 4 + 3]);
}

static void test_crop_flips_horizontally(void)
{
    uint8_t out[4 * 4 * 4];
    TEST_ASSERT_TRUE(r2d_world_atlas_crop(ATLAS, 4, 2, 2, 0, 2, 2, true, 4, 1, 1, out));
    const uint8_t *row = out + ((1 * 4 + 1) * 4);
    TEST_ASSERT_EQUAL_UINT8(40, row[0]);
    TEST_ASSERT_EQUAL_UINT8(30, row[4]);
}

static void test_crop_rejects_bad_bounds(void)
{
    uint8_t out[4 * 4 * 4];
    TEST_ASSERT_FALSE(r2d_world_atlas_crop(ATLAS, 4, 2, 3, 0, 2, 2, false, 4, 0, 0, out));
    TEST_ASSERT_FALSE(r2d_world_atlas_crop(ATLAS, 4, 2, 0, 0, 2, 2, false, 0, 0, 0, out));
    TEST_ASSERT_FALSE(r2d_world_atlas_crop(NULL, 4, 2, 0, 0, 2, 2, false, 4, 0, 0, out));
}

static void test_crop_clips_extreme_destination(void)
{
    uint8_t out[4 * 4 * 4];
    // Destination beyond the square must clip instead of writing out of bounds.
    TEST_ASSERT_TRUE(r2d_world_atlas_crop(ATLAS, 4, 2, 0, 0, 2, 2, false, 4, 3, 3, out));
    TEST_ASSERT_EQUAL_UINT8(10, out[(3 * 4 + 3) * 4 + 0]);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_relative_yaw_facing_camera_is_zero);
    RUN_TEST(test_relative_yaw_turn_is_signed);
    RUN_TEST(test_relative_yaw_degenerate_inputs_are_safe);
    RUN_TEST(test_direction_single_and_eight);
    RUN_TEST(test_direction_mirrored_five);
    RUN_TEST(test_explicit_column_overrides_facing);
    RUN_TEST(test_direction_clamps_and_normalizes);
    RUN_TEST(test_cell_rect_and_clamping);
    RUN_TEST(test_pivot_modes);
    RUN_TEST(test_placement_feet_pivot_bottom_center);
    RUN_TEST(test_placement_center_pivot_keeps_cell);
    RUN_TEST(test_placement_custom_pivot_clamped_inside_square);
    RUN_TEST(test_placement_rejects_invalid_cells);
    RUN_TEST(test_crop_copies_cell);
    RUN_TEST(test_crop_flips_horizontally);
    RUN_TEST(test_crop_rejects_bad_bounds);
    RUN_TEST(test_crop_clips_extreme_destination);
    return UNITY_END();
}
