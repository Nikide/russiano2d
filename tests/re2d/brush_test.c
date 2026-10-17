#include "sdk_brush.h"
#include "re2d_world.h"
#include "unity.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static SdkBrushSpec make_rect(const char *id, float x, float y, float w, float h,
                              float bottom, float top, SdkBrushTool tool)
{
    SdkBrushSpec b;
    memset(&b, 0, sizeof b);
    snprintf(b.id, sizeof b.id, "%s", id);
    b.tool = tool;
    b.solid = !(tool == SDK_BRUSH_TOOL_HINT || tool == SDK_BRUSH_TOOL_SKIP ||
                tool == SDK_BRUSH_TOOL_TRIGGER || tool == SDK_BRUSH_TOOL_AREAPORTAL ||
                tool == SDK_BRUSH_TOOL_OCCLUDER);
    b.ring_count = 4;
    b.ring[0] = (SdkBrushPoint){x, y};
    b.ring[1] = (SdkBrushPoint){x + w, y};
    b.ring[2] = (SdkBrushPoint){x + w, y + h};
    b.ring[3] = (SdkBrushPoint){x, y + h};
    b.bottom = bottom;
    b.top = top;
    snprintf(b.side_color, sizeof b.side_color, "#7a6a50");
    snprintf(b.floor_color, sizeof b.floor_color, "#c0b090");
    snprintf(b.ceiling_color, sizeof b.ceiling_color, "#606870");
    b.wall_flags = sdk_brush_tool_flags(tool);
    return b;
}

static SdkBrushBounds make_bounds(void)
{
    SdkBrushBounds bounds;
    memset(&bounds, 0, sizeof bounds);
    bounds.x = 0; bounds.y = 0; bounds.w = 256; bounds.h = 128;
    bounds.bottom = 0; bounds.top = 128;
    snprintf(bounds.floor_color, sizeof bounds.floor_color, "#9a9a9a");
    snprintf(bounds.ceiling_color, sizeof bounds.ceiling_color, "#6a7078");
    snprintf(bounds.side_color, sizeof bounds.side_color, "#8f7a58");
    bounds.boundary_flags = sdk_brush_tool_flags(SDK_BRUSH_TOOL_SKY);
    return bounds;
}

static void fill_fixture(SdkBrushSpec brushes[6])
{
    brushes[0] = make_rect("wall.north", 100, 0, 16, 48, 0, 128, SDK_BRUSH_TOOL_NONE);
    brushes[1] = make_rect("wall.south", 100, 80, 16, 48, 0, 128, SDK_BRUSH_TOOL_NONE);
    brushes[2] = make_rect("door.area", 100, 48, 16, 32, 0, 128, SDK_BRUSH_TOOL_AREAPORTAL);
    brushes[3] = make_rect("altar.nodraw", 20, 20, 32, 32, 0, 32, SDK_BRUSH_TOOL_NODRAW);
    brushes[4] = make_rect("crate.clip", 20, 80, 32, 32, 0, 64, SDK_BRUSH_TOOL_CLIP);
}

static void test_tool_materials(void)
{
    SdkBrushTool tool = SDK_BRUSH_TOOL_NONE;
    TEST_ASSERT_TRUE(sdk_brush_tool_parse("nodraw", &tool));
    TEST_ASSERT_EQUAL_INT(SDK_BRUSH_TOOL_NODRAW, tool);
    TEST_ASSERT_TRUE(sdk_brush_tool_parse("playerclip", &tool));
    TEST_ASSERT_EQUAL_INT(SDK_BRUSH_TOOL_PLAYERCLIP, tool);
    TEST_ASSERT_FALSE(sdk_brush_tool_parse("bogus", &tool));
    TEST_ASSERT_FALSE(sdk_brush_tool_parse(NULL, &tool));
    TEST_ASSERT_FALSE(sdk_brush_tool_parse("sky", NULL));
    TEST_ASSERT_EQUAL_STRING("areaportal", sdk_brush_tool_name(SDK_BRUSH_TOOL_AREAPORTAL));

    const uint16_t nodraw = sdk_brush_tool_flags(SDK_BRUSH_TOOL_NODRAW);
    TEST_ASSERT_EQUAL_INT(0, nodraw & R2D_WALL_RENDER);
    TEST_ASSERT_TRUE(nodraw & R2D_WALL_COLLIDE);
    TEST_ASSERT_TRUE(nodraw & R2D_WALL_RAY);
    const uint16_t clip = sdk_brush_tool_flags(SDK_BRUSH_TOOL_CLIP);
    TEST_ASSERT_EQUAL_INT(R2D_WALL_COLLIDE, clip);
    const uint16_t sky = sdk_brush_tool_flags(SDK_BRUSH_TOOL_SKY);
    TEST_ASSERT_TRUE(sky & R2D_WALL_SKY);
    TEST_ASSERT_EQUAL_INT(0, sky & R2D_WALL_RENDER);
    TEST_ASSERT_EQUAL_INT(0, sky & R2D_WALL_SHADOW);
    const uint16_t occluder = sdk_brush_tool_flags(SDK_BRUSH_TOOL_OCCLUDER);
    TEST_ASSERT_TRUE(occluder & R2D_WALL_OCCLUDER);
    TEST_ASSERT_EQUAL_INT(0, occluder & R2D_WALL_COLLIDE);
    TEST_ASSERT_EQUAL_INT(0, sdk_brush_tool_flags(SDK_BRUSH_TOOL_NONE));
}

static void test_compile_brush_world(void)
{
    SdkBrushSpec brushes[5];
    fill_fixture(brushes);
    SdkBrushBounds bounds = make_bounds();
    SdkBrushOutput out;
    SdkBrushStats stats;
    char error[256] = {0};
    TEST_ASSERT_TRUE_MESSAGE(sdk_brush_compile(brushes, 5, &bounds, &out, &stats,
                                               error, sizeof error), error);
    TEST_ASSERT_EQUAL_INT(5, stats.brushes);
    TEST_ASSERT_EQUAL_INT(4, stats.solids); // two walls + nodraw + clip solids
    TEST_ASSERT_TRUE(stats.cells >= 2);
    TEST_ASSERT_EQUAL_INT(stats.cells, out.cell_count);
    TEST_ASSERT_EQUAL_INT(stats.spans, out.span_count);
    TEST_ASSERT_TRUE(out.span_count >= out.cell_count);
    TEST_ASSERT_TRUE(out.wall_count >= 4);
    TEST_ASSERT_TRUE(out.portal_count >= 1);
    TEST_ASSERT_TRUE(stats.areaportal_brushes == 1);
    TEST_ASSERT_TRUE_MESSAGE(stats.areaportal_edges >= 1,
                             "areaportal brush marks at least one generated edge");
    bool found_area = false;
    for (int i = 0; i < out.portal_count; i++)
        if (out.portals[i].area_portal) found_area = true;
    TEST_ASSERT_TRUE(found_area);

    // Every cell span has a valid height interval and every portal points at
    // real cells with at least one opening.
    for (int i = 0; i < out.span_count; i++)
        TEST_ASSERT_TRUE(out.spans[i].top > out.spans[i].bottom);
    for (int i = 0; i < out.portal_count; i++) {
        TEST_ASSERT_TRUE(out.portals[i].cell_a >= 0 && out.portals[i].cell_a < out.cell_count);
        TEST_ASSERT_TRUE(out.portals[i].cell_b >= 0 && out.portals[i].cell_b < out.cell_count);
        TEST_ASSERT_TRUE(out.portals[i].opening_count >= 1);
    }

    // Boundary walls carry the sky/clip policy, not translucent opacity:0.
    int sky_walls = 0;
    for (int i = 0; i < out.wall_count; i++)
        if (out.walls[i].flags & R2D_WALL_SKY) sky_walls++;
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, sky_walls,
                                  "four envelope walls use the sky boundary policy");
    sdk_brush_output_free(&out);
}

static void test_compiler_is_deterministic(void)
{
    SdkBrushSpec brushes[5];
    fill_fixture(brushes);
    SdkBrushBounds bounds = make_bounds();
    SdkBrushOutput a, b;
    SdkBrushStats sa, sb;
    char error[256] = {0};
    TEST_ASSERT_TRUE(sdk_brush_compile(brushes, 5, &bounds, &a, &sa, error, sizeof error));
    TEST_ASSERT_TRUE(sdk_brush_compile(brushes, 5, &bounds, &b, &sb, error, sizeof error));
    TEST_ASSERT_EQUAL_INT(a.cell_count, b.cell_count);
    TEST_ASSERT_EQUAL_INT(a.span_count, b.span_count);
    TEST_ASSERT_EQUAL_INT(a.wall_count, b.wall_count);
    TEST_ASSERT_EQUAL_INT(a.portal_count, b.portal_count);
    TEST_ASSERT_EQUAL_INT(a.opening_count, b.opening_count);
    TEST_ASSERT_EQUAL_INT(0, memcmp(a.cells, b.cells, (size_t)a.cell_count * sizeof *a.cells));
    TEST_ASSERT_EQUAL_INT(0, memcmp(a.walls, b.walls, (size_t)a.wall_count * sizeof *a.walls));
    TEST_ASSERT_EQUAL_INT(0, memcmp(a.portals, b.portals, (size_t)a.portal_count * sizeof *a.portals));
    sdk_brush_output_free(&a);
    sdk_brush_output_free(&b);
}

static void test_empty_brush_set_and_bounds(void)
{
    SdkBrushBounds bounds = make_bounds();
    SdkBrushOutput out;
    SdkBrushStats stats;
    char error[256] = {0};
    TEST_ASSERT_TRUE_MESSAGE(sdk_brush_compile(NULL, 0, &bounds, &out, &stats,
                                               error, sizeof error), error);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, out.cell_count,
                                  "empty brush set is one free envelope cell");
    TEST_ASSERT_EQUAL_INT(1, out.span_count);
    TEST_ASSERT_EQUAL_INT(4, out.wall_count);
    TEST_ASSERT_EQUAL_INT(0, out.portal_count);
    sdk_brush_output_free(&out);
    TEST_ASSERT_EQUAL_INT(0, out.cell_count);
    TEST_ASSERT_EQUAL_INT(0, out.walls);
}

static void test_invalid_brush_rejected(void)
{
    SdkBrushSpec brushes[5];
    fill_fixture(brushes);
    SdkBrushBounds bounds = make_bounds();
    SdkBrushOutput out;
    SdkBrushStats stats;
    char error[256] = {0};

    // Slanted edge is not a constrained brush footprint.
    brushes[0].ring[1].x += 5.0f;
    TEST_ASSERT_FALSE(sdk_brush_compile(brushes, 2, &bounds, &out, &stats,
                                        error, sizeof error));
    TEST_ASSERT_NOT_NULL(strstr(error, "rectilinear"));
    TEST_ASSERT_EQUAL_INT(0, out.cell_count);

    fill_fixture(brushes);
    brushes[0].top = brushes[0].bottom;
    TEST_ASSERT_FALSE(sdk_brush_compile(brushes, 2, &bounds, &out, &stats,
                                        error, sizeof error));
    TEST_ASSERT_NOT_NULL(strstr(error, "top > bottom"));

    fill_fixture(brushes);
    SdkBrushBounds bad = bounds;
    bad.w = 0;
    TEST_ASSERT_FALSE(sdk_brush_compile(brushes, 2, &bad, &out, &stats,
                                        error, sizeof error));
    TEST_ASSERT_NOT_NULL(strstr(error, "bounds"));
}

static void test_tool_flags_are_carried_to_walls(void)
{
    SdkBrushSpec brushes[3];
    brushes[0] = make_rect("clip.wall", 64, 0, 16, 128, 0, 128, SDK_BRUSH_TOOL_CLIP);
    brushes[1] = make_rect("sky.wall", 128, 0, 16, 128, 0, 128, SDK_BRUSH_TOOL_SKY);
    brushes[2] = make_rect("occluder.marker", 180, 40, 8, 48, 0, 128, SDK_BRUSH_TOOL_OCCLUDER);
    SdkBrushBounds bounds = make_bounds();
    SdkBrushOutput out;
    SdkBrushStats stats;
    char error[256] = {0};
    TEST_ASSERT_TRUE(sdk_brush_compile(brushes, 3, &bounds, &out, &stats,
                                       error, sizeof error));
    bool clip_found = false, sky_found = false, boundary_found = false;
    for (int i = 0; i < out.wall_count; i++) {
        const uint16_t f = out.walls[i].flags;
        if (f == R2D_WALL_COLLIDE) clip_found = true;
        if (f & R2D_WALL_SKY) {
            if (!strcmp(out.walls[i].id, "brush.boundary0") ||
                strncmp(out.walls[i].id, "brush.boundary", 14) == 0)
                boundary_found = true;
            if (strncmp(out.walls[i].id, "brush.face", 10) == 0)
                sky_found = true;
        }
    }
    TEST_ASSERT_TRUE(clip_found);
    TEST_ASSERT_TRUE(sky_found);
    TEST_ASSERT_TRUE(boundary_found);
    TEST_ASSERT_EQUAL_INT(1, stats.occluder_brushes);
    sdk_brush_output_free(&out);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_tool_materials);
    RUN_TEST(test_compile_brush_world);
    RUN_TEST(test_compiler_is_deterministic);
    RUN_TEST(test_empty_brush_set_and_bounds);
    RUN_TEST(test_invalid_brush_rejected);
    RUN_TEST(test_tool_flags_are_carried_to_walls);
    return UNITY_END();
}
