#include "sdk_brush.h"
#include "re2d_world_mover.h"
#include "re2d_world_trigger.h"
#include "unity.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static SdkBrushSpec make_rect(const char *id, float x, float y, float w, float h,
                              float bottom, float top, SdkBrushTool tool)
{
    SdkBrushSpec brush;
    memset(&brush, 0, sizeof brush);
    snprintf(brush.id, sizeof brush.id, "%s", id);
    brush.tool = tool;
    brush.solid = !(tool == SDK_BRUSH_TOOL_HINT || tool == SDK_BRUSH_TOOL_SKIP ||
                    tool == SDK_BRUSH_TOOL_TRIGGER ||
                    tool == SDK_BRUSH_TOOL_AREAPORTAL ||
                    tool == SDK_BRUSH_TOOL_OCCLUDER);
    brush.ring_count = 4;
    brush.ring[0] = (SdkBrushPoint){x, y};
    brush.ring[1] = (SdkBrushPoint){x + w, y};
    brush.ring[2] = (SdkBrushPoint){x + w, y + h};
    brush.ring[3] = (SdkBrushPoint){x, y + h};
    brush.bottom = bottom;
    brush.top = top;
    return brush;
}

// Compiler metadata -> existing native runtime APIs. This is the smoke test the
// roadmap asks for: a door brush drives R2DWorldMover, a trigger volume brush
// drives R2DWorldTrigger, with no second gameplay path.
static void test_door_brush_maps_to_native_mover(void)
{
    SdkBrushSpec brushed[2];
    brushed[0] = make_rect("door.brush", 32, 32, 32, 64, 0, 96, SDK_BRUSH_TOOL_NONE);
    brushed[1] = make_rect("trigger.brush", 96, 32, 32, 64, 0, 96,
                           SDK_BRUSH_TOOL_TRIGGER);
    const SdkBrushEntityRef refs[2] = {
        {"door.gate", "door", "door.brush", "portal.door"},
        {"trig.entry", "trigger_volume", "trigger.brush", "door.gate"}
    };
    SdkBrushEntityMap map[2];
    char error[256] = {0};

    TEST_ASSERT_EQUAL_INT(2, sdk_brush_map_entities(brushed, 2, refs, 2, map, 2,
                                                    error, sizeof error));
    TEST_ASSERT_EQUAL_STRING("world.mover", map[0].api);
    TEST_ASSERT_EQUAL_INT(0, map[0].mover_type);

    R2DWorldMover mover;
    TEST_ASSERT_TRUE(r2d_world_mover_init(&mover, map[0].mover_type, 0,
                                          map[0].bottom, map[0].top,
                                          96.0f, 0.0f, false));
    r2d_world_mover_open(&mover);
    unsigned events = 0;
    for (int i = 0; i < 200 && mover.position < map[0].top; i++)
        r2d_world_mover_step(&mover, 1.0f / 60.0f, &events);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, map[0].top, mover.position);
    TEST_ASSERT_TRUE(events & R2D_MOVER_EVENT_ARRIVED);
    r2d_world_mover_close(&mover);
    for (int i = 0; i < 200 && mover.position > map[0].bottom; i++)
        r2d_world_mover_step(&mover, 1.0f / 60.0f, &events);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, map[0].bottom, mover.position);
}

static void test_trigger_brush_maps_to_native_trigger(void)
{
    SdkBrushSpec brushed[1];
    brushed[0] = make_rect("trigger.brush", 96, 32, 32, 64, 0, 96,
                           SDK_BRUSH_TOOL_TRIGGER);
    const SdkBrushEntityRef ref[1] = {
        {"trig.entry", "trigger_volume", "trigger.brush", "door.gate"}
    };
    SdkBrushEntityMap map[1];
    char error[256] = {0};

    TEST_ASSERT_EQUAL_INT(1, sdk_brush_map_entities(brushed, 1, ref, 1, map, 1,
                                                    error, sizeof error));
    TEST_ASSERT_EQUAL_STRING("world.trigger", map[0].api);
    const float radius = fminf(map[0].w, map[0].h) * 0.5f;
    const float cx = map[0].x + map[0].w * 0.5f;
    const float cy = map[0].y + map[0].h * 0.5f;

    R2DWorldTrigger trigger;
    TEST_ASSERT_TRUE(r2d_world_trigger_init(&trigger, map[0].trigger_type, map[0].id,
                                            map[0].target, cx, cy, radius,
                                            map[0].bottom, map[0].top,
                                            false, 0.0f));
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&trigger, 0, 0, 0),
                              "outside point does not fire");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_enter(&trigger, cx, cy, 0),
                             "inside point fires the enter trigger");
    TEST_ASSERT_EQUAL_INT(1, trigger.fire_count);
    TEST_ASSERT_EQUAL_STRING("door.gate", trigger.target);
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&trigger, cx, cy, 0),
                              "repeat enter while armed does not fire");
}

static void test_brush_entity_validation(void)
{
    SdkBrushSpec brush = make_rect("door.brush", 0, 0, 32, 32, 0, 64,
                                   SDK_BRUSH_TOOL_NONE);
    SdkBrushEntityMap map[2];
    char error[256] = {0};

    const SdkBrushEntityRef missing[1] = {
        {"door.a", "door", "missing", ""}
    };
    TEST_ASSERT_EQUAL_INT(-1, sdk_brush_map_entities(&brush, 1, missing, 1,
                                                     map, 2, error, sizeof error));
    TEST_ASSERT_TRUE(error[0] != 0);

    const SdkBrushEntityRef unknown[1] = {
        {"x", "player_spawn", "door.brush", ""}
    };
    TEST_ASSERT_EQUAL_INT(-1, sdk_brush_map_entities(&brush, 1, unknown, 1,
                                                     map, 2, error, sizeof error));

    const SdkBrushEntityRef duplicate[2] = {
        {"dup", "door", "door.brush", ""},
        {"dup", "lift", "door.brush", ""}
    };
    TEST_ASSERT_EQUAL_INT(-1, sdk_brush_map_entities(&brush, 1, duplicate, 2,
                                                     map, 2, error, sizeof error));
}


static void test_fog_water_areaportal_mapping_defaults(void)
{
    SdkBrushSpec brushed[3];
    brushed[0] = make_rect("fog.brush", 8, 8, 32, 32, 0, 64, SDK_BRUSH_TOOL_TRIGGER);
    brushed[1] = make_rect("water.brush", 48, 8, 32, 32, 0, 24, SDK_BRUSH_TOOL_TRIGGER);
    brushed[2] = make_rect("area.brush", 96, 0, 8, 64, 0, 64, SDK_BRUSH_TOOL_AREAPORTAL);
    const SdkBrushEntityRef refs[3] = {
        {"fog.pool", "fog_volume", "fog.brush", ""},
        {"water.pool", "water_volume", "water.brush", ""},
        {"area.gate", "areaportal", "area.brush", ""}
    };
    SdkBrushEntityMap map[3];
    char error[256] = {0};
    TEST_ASSERT_EQUAL_INT(3, sdk_brush_map_entities(brushed, 3, refs, 3, map, 3,
                                                    error, sizeof error));
    TEST_ASSERT_EQUAL_STRING("r2d_world_apply_fog_volume", map[0].api);
    TEST_ASSERT_FLOAT_WITHIN(1e-3f, 0.45f, map[0].fog_density);
    TEST_ASSERT_EQUAL_INT(-1, map[0].portal);
    TEST_ASSERT_EQUAL_STRING("r2d_world_apply_water_volume", map[1].api);
    TEST_ASSERT_EQUAL_INT(R2D_TERRAIN_WATER, map[1].terrain_kind);
    TEST_ASSERT_TRUE(map[1].hook[0] != 0);
    TEST_ASSERT_EQUAL_STRING("r2d_world_portal_set_area", map[2].api);
    TEST_ASSERT_EQUAL_INT(-1, map[2].portal); // resolved by sdk_world after compile
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_door_brush_maps_to_native_mover);
    RUN_TEST(test_trigger_brush_maps_to_native_trigger);
    RUN_TEST(test_brush_entity_validation);
    RUN_TEST(test_fog_water_areaportal_mapping_defaults);
    return UNITY_END();
}
