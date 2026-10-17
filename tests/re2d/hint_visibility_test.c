#include "re2d_world.h"
#include "re2d_world_bake.h"
#include "sdk_brush.h"
#include "unity.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

// Two 100x100 cells sharing x=100, one full-height portal. The hinted variant
// adds a compiler-style zero-policy hint marker exactly on the portal.
static bool build_pair(R2DRe2dWorld *world, bool hinted)
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
    const R2DWorldPortal portal = {0, 1, 0, 1, 100, 0, 100, 100, false, 1.0f};
    const R2DWorldWall hint = {100, 0, 100, 100, 0, 80, 0xff00ffff,
                               R2D_WALL_TOOL_HINT};
    char error[256] = {0};
    memset(world, 0, sizeof *world);
    return r2d_world_build_cells(world, hinted ? &hint : NULL, hinted ? 1 : 0,
                                 spans, 2, cells, 2, &portal, 1,
                                 openings, 1, error, sizeof error);
}

static R2DRe2dView make_view(void)
{
    R2DRe2dView view;
    r2d_re2d_view_set(&view, 50, 50, 40, 0, 0, 1.2f, 64, 48);
    view.near_plane = 0.1f;
    return view;
}

static void test_hint_barrier_reduces_visible_spans(void)
{
    R2DRe2dWorld plain, hinted;
    TEST_ASSERT_TRUE(build_pair(&plain, false));
    TEST_ASSERT_TRUE(build_pair(&hinted, true));
    const R2DRe2dView view = make_view();

    R2DWorldVisibility a = {0}, b = {0};
    TEST_ASSERT_TRUE(r2d_world_visibility(&plain, &view, 0.0f, &a));
    TEST_ASSERT_TRUE(r2d_world_visibility(&hinted, &view, 0.0f, &b));
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, a.span_count,
                                  "open portal reaches both cells without a hint");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, b.span_count,
                                  "hint barrier cuts view traversal through the portal");
    TEST_ASSERT_EQUAL_INT(2, a.cells_visible);
    TEST_ASSERT_EQUAL_INT(1, b.cells_visible);

    // Hint policy is view-only: no render, no collision, no hitscan/ray bit.
    int hint_walls = 0;
    for (int i = 0; i < hinted.wall_count; i++) {
        if (hinted.walls[i].flags & R2D_WALL_TOOL_HINT) {
            hint_walls++;
            const R2DWorldWallPolicy p = r2d_world_wall_policy(&hinted, i);
            TEST_ASSERT_FALSE(p.render);
            TEST_ASSERT_FALSE(p.collision);
            TEST_ASSERT_FALSE(p.hitscan);
        }
    }
    TEST_ASSERT_EQUAL_INT(1, hint_walls);
    TEST_ASSERT_FALSE(r2d_world_blocked(&hinted, 100, 50, 1, 0, 40));

    r2d_world_visibility_free(&a);
    r2d_world_visibility_free(&b);
    r2d_world_free(&plain);
    r2d_world_free(&hinted);
}

static void test_hint_barrier_survives_bake(void)
{
    R2DRe2dWorld hinted, restored = {0};
    TEST_ASSERT_TRUE(build_pair(&hinted, true));

    R2dSb baked;
    r2d_sb_init(&baked);
    r2d_sb_puts(&baked, "{\"version\":1,");
    TEST_ASSERT_TRUE(r2d_world_put_baked(&hinted, &baked));
    r2d_sb_putc(&baked, '}');
    char error[256] = {0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_load_json(&restored, baked.data, error,
                                                 sizeof error), error);

    int hint_walls = 0;
    for (int i = 0; i < restored.wall_count; i++)
        if (restored.walls[i].flags & R2D_WALL_TOOL_HINT) hint_walls++;
    TEST_ASSERT_EQUAL_INT(1, hint_walls);

    const R2DRe2dView view = make_view();
    R2DWorldVisibility vis = {0};
    TEST_ASSERT_TRUE(r2d_world_visibility(&restored, &view, 0.0f, &vis));
    TEST_ASSERT_EQUAL_INT(1, vis.span_count);
    r2d_world_visibility_free(&vis);
    r2d_sb_free(&baked);
    r2d_world_free(&hinted);
    r2d_world_free(&restored);
}

static void test_hint_barrier_does_not_touch_other_queries(void)
{
    R2DRe2dWorld hinted;
    TEST_ASSERT_TRUE(build_pair(&hinted, true));

    // A hint wall has no RAY bit, so a horizontal ray crosses the portal exactly
    // as in the unhinted world (closure surfaces are portal-aware).
    float origin[3] = {10, 50, 40};
    float direction[3] = {180, 0, 0};
    R2DWorldHit hit;
    const bool ray_hit = r2d_world_ray(&hinted, origin, direction, 0.0f, 1.0f, &hit);

    // A ray straight at the hint segment must not stop on it.
    float side_origin[3] = {50, 50, 40};
    float side_direction[3] = {100, 0, 0};
    R2DWorldHit side_hit;
    const bool side_ray = r2d_world_ray(&hinted, side_origin, side_direction,
                                        0.0f, 1.0f, &side_hit);
    TEST_ASSERT_EQUAL_INT(ray_hit, side_ray);
    TEST_ASSERT_FALSE(r2d_world_blocked(&hinted, 100, 50, 1, 0, 40));
    r2d_world_free(&hinted);
}


// End-to-end: brush compiler marker -> runtime visibility. This is the exact
// contract between sdk_brush (marker emission) and re2d_world_visibility.
static void test_compiled_hint_marker_cuts_runtime_view(void)
{
    SdkBrushSpec brushes[3];
    memset(brushes, 0, sizeof brushes);
    const char *ids[3] = {"north", "south", "hint.gap"};
    const float rect[3][4] = {
        {100, 0, 16, 48}, {100, 80, 16, 48}, {100, 48, 16, 32}
    };
    const SdkBrushTool tools[3] = {
        SDK_BRUSH_TOOL_NONE, SDK_BRUSH_TOOL_NONE, SDK_BRUSH_TOOL_HINT
    };
    for (int i = 0; i < 3; i++) {
        snprintf(brushes[i].id, sizeof brushes[i].id, "%s", ids[i]);
        brushes[i].solid = tools[i] == SDK_BRUSH_TOOL_NONE;
        brushes[i].tool = tools[i];
        brushes[i].ring_count = 4;
        brushes[i].ring[0] = (SdkBrushPoint){rect[i][0], rect[i][1]};
        brushes[i].ring[1] = (SdkBrushPoint){rect[i][0] + rect[i][2], rect[i][1]};
        brushes[i].ring[2] = (SdkBrushPoint){rect[i][0] + rect[i][2],
                                             rect[i][1] + rect[i][3]};
        brushes[i].ring[3] = (SdkBrushPoint){rect[i][0],
                                             rect[i][1] + rect[i][3]};
        brushes[i].bottom = 0;
        brushes[i].top = 128;
        snprintf(brushes[i].side_color, sizeof brushes[i].side_color, "#8f7a58");
        snprintf(brushes[i].floor_color, sizeof brushes[i].floor_color, "#9a9a9a");
        snprintf(brushes[i].ceiling_color, sizeof brushes[i].ceiling_color, "#6a7078");
    }
    SdkBrushBounds bounds;
    memset(&bounds, 0, sizeof bounds);
    bounds.x = 0; bounds.y = 0; bounds.w = 256; bounds.h = 128;
    bounds.bottom = 0; bounds.top = 128;
    snprintf(bounds.side_color, sizeof bounds.side_color, "#8f7a58");
    snprintf(bounds.floor_color, sizeof bounds.floor_color, "#9a9a9a");
    snprintf(bounds.ceiling_color, sizeof bounds.ceiling_color, "#6a7078");
    bounds.boundary_flags = sdk_brush_tool_flags(SDK_BRUSH_TOOL_SKY);

    SdkBrushOutput out;
    SdkBrushStats stats;
    char error[256] = {0};
    TEST_ASSERT_TRUE_MESSAGE(sdk_brush_compile(brushes, 3, &bounds, &out, &stats,
                                               error, sizeof error), error);
    TEST_ASSERT_GREATER_THAN(0, stats.hint_barriers);
    const SdkBrushWall *marker = NULL;
    for (int i = 0; i < out.wall_count; i++)
        if (out.walls[i].flags == R2D_WALL_TOOL_HINT) marker = &out.walls[i];
    TEST_ASSERT_NOT_NULL(marker);

    const float boundary = marker->x1;   // use the compiled barrier's portal plane
    const R2DWorldSpan spans[2] = {
        {0, 0, boundary, 100, 0, 80, 0, 0, 0, 0, 0, 0},
        {boundary, 0, 200 - boundary, 100, 0, 80, 0, 0, 0, 0, 0, 0}
    };
    const R2DWorldCell cells[2] = {
        {0, 0, boundary, 100, 0, 1}, {boundary, 0, 200 - boundary, 100, 1, 1}
    };
    const R2DWorldOpening openings[1] = {{0, 80}};
    const R2DWorldPortal portal = {0, 1, 0, 1, boundary, 0, boundary, 100,
                                   false, 1.0f};
    const R2DWorldWall hint = {marker->x1, marker->y1, marker->x2, marker->y2,
                               marker->bottom, marker->top, 0xff00ffff,
                               marker->flags};
    R2DRe2dWorld world = {0};
    char build_error[256] = {0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build_cells(&world, &hint, 1, spans, 2,
                                                   cells, 2, &portal, 1,
                                                   openings, 1, build_error,
                                                   sizeof build_error),
                             build_error);
    const R2DRe2dView view = make_view();
    R2DWorldVisibility vis = {0};
    TEST_ASSERT_TRUE(r2d_world_visibility(&world, &view, 0.0f, &vis));
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, vis.span_count,
                                  "compiled hint marker cuts the runtime portal");
    r2d_world_visibility_free(&vis);
    r2d_world_free(&world);
    sdk_brush_output_free(&out);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_hint_barrier_reduces_visible_spans);
    RUN_TEST(test_hint_barrier_survives_bake);
    RUN_TEST(test_hint_barrier_does_not_touch_other_queries);
    RUN_TEST(test_compiled_hint_marker_cuts_runtime_view);
    return UNITY_END();
}
