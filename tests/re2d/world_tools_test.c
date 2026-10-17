#include "re2d_world.h"
#include "re2d_world_bake.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static const char *TOOL_WORLD =
    "{\"version\":1,"
    "\"cells\":["
    "{\"x\":0,\"y\":0,\"w\":100,\"h\":100,\"spans\":[{\"bottom\":0,\"top\":80,"
    "\"floorColor\":\"#cccccc\",\"ceilingColor\":\"#777777\"}]},"
    "{\"x\":100,\"y\":0,\"w\":100,\"h\":100,\"spans\":[{\"bottom\":0,\"top\":80,"
    "\"floorColor\":\"#cccccc\",\"ceilingColor\":\"#777777\"}]}],"
    "\"walls\":["
    "{\"id\":\"default\",\"from\":[0,0],\"to\":[0,100],\"bottom\":0,\"top\":80,\"color\":\"#00ff00\"},"
    "{\"id\":\"clip\",\"from\":[50,0],\"to\":[50,100],\"bottom\":0,\"top\":80,"
    "\"color\":\"#ff0000\",\"flags\":2},"
    "{\"id\":\"sky\",\"from\":[200,0],\"to\":[200,100],\"bottom\":0,\"top\":80,"
    "\"color\":\"#0000ff\",\"flags\":38}],"
    "\"portals\":[{\"id\":\"gate\",\"cellA\":0,\"cellB\":1,"
    "\"from\":[100,0],\"to\":[100,100],\"openings\":[{\"bottom\":0,\"top\":80}],"
    "\"areaPortal\":true}]}";

static void test_wall_policy_bits(void)
{
    R2DRe2dWorld world = {0};
    char error[256] = {0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_load_json(&world, TOOL_WORLD, error,
                                                 sizeof error), error);
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, world.wall_count,
                                  "three authored walls + one portal closure wall");

    R2DWorldWallPolicy legacy = r2d_world_wall_policy(&world, 0);
    TEST_ASSERT_TRUE(legacy.render && legacy.collision && legacy.hitscan);
    TEST_ASSERT_TRUE(legacy.shadow && legacy.acoustic);
    TEST_ASSERT_FALSE(legacy.sky || legacy.occluder);

    R2DWorldWallPolicy clip = r2d_world_wall_policy(&world, 1);
    TEST_ASSERT_FALSE_MESSAGE(clip.render, "clip is collision-only");
    TEST_ASSERT_TRUE(clip.collision);
    TEST_ASSERT_FALSE_MESSAGE(clip.hitscan, "clip does not stop hitscan rays");
    TEST_ASSERT_FALSE(clip.shadow);
    TEST_ASSERT_FALSE(clip.acoustic);

    R2DWorldWallPolicy sky = r2d_world_wall_policy(&world, 2);
    TEST_ASSERT_FALSE(sky.render);
    TEST_ASSERT_TRUE(sky.collision);
    TEST_ASSERT_TRUE(sky.hitscan);
    TEST_ASSERT_TRUE(sky.sky);
    TEST_ASSERT_FALSE(sky.shadow);
    TEST_ASSERT_FALSE(sky.acoustic);

    TEST_ASSERT_TRUE(r2d_world_portal_area(&world, 0));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_wall_policy(NULL, 0).sky);
    r2d_world_free(&world);
}

static void test_collision_and_ray_policy(void)
{
    R2DRe2dWorld world = {0};
    char error[256] = {0};
    TEST_ASSERT_TRUE(r2d_world_load_json(&world, TOOL_WORLD, error, sizeof error));
    R2DWorldHit hit;
    float clip_origin[3] = {40, 50, 40};
    float clip_dir[3] = {40, 0, 0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_blocked(&world, 55, 50, 5, 0, 40),
                             "clip blocks movement");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_ray(&world, clip_origin, clip_dir,
                                            0.0f, 1.0f, &hit),
                              "clip wall is invisible to hitscan/shadow rays");

    float wall_origin[3] = {-10, 50, 40};
    float wall_dir[3] = {40, 0, 0};
    TEST_ASSERT_TRUE(r2d_world_ray(&world, wall_origin, wall_dir, 0.0f, 1.0f, &hit));
    TEST_ASSERT_EQUAL_INT(0, hit.wall);

    float sky_origin[3] = {190, 50, 40};
    float sky_dir[3] = {40, 0, 0};
    TEST_ASSERT_TRUE(r2d_world_ray(&world, sky_origin, sky_dir, 0.0f, 1.0f, &hit));
    TEST_ASSERT_EQUAL_INT(2, hit.wall);
    TEST_ASSERT_TRUE(r2d_world_blocked(&world, 195, 50, 5, 0, 40));
    r2d_world_free(&world);
}

static void test_baked_v5_roundtrip_preserves_tool_policy(void)
{
    R2DRe2dWorld world = {0};
    char error[256] = {0};
    TEST_ASSERT_TRUE(r2d_world_load_json(&world, TOOL_WORLD, error, sizeof error));
    R2dSb baked;
    r2d_sb_init(&baked);
    r2d_sb_puts(&baked, "{\"version\":1,");
    TEST_ASSERT_TRUE(r2d_world_put_baked(&world, &baked));
    r2d_sb_putc(&baked, '}');
    TEST_ASSERT_NOT_NULL(strstr(baked.data, "\"version\":5"));

    R2DRe2dWorld restored = {0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_load_json(&restored, baked.data, error,
                                                 sizeof error), error);
    TEST_ASSERT_EQUAL_INT(4, restored.wall_count);
    TEST_ASSERT_EQUAL_INT(0, restored.walls[0].flags);
    TEST_ASSERT_EQUAL_INT(2, restored.walls[1].flags);
    TEST_ASSERT_EQUAL_INT(38, restored.walls[2].flags);
    TEST_ASSERT_TRUE(r2d_world_portal_area(&restored, 0));
    R2DWorldWallPolicy clip = r2d_world_wall_policy(&restored, 1);
    TEST_ASSERT_TRUE(clip.collision);
    TEST_ASSERT_FALSE(clip.render);
    R2DWorldWallPolicy sky = r2d_world_wall_policy(&restored, 2);
    TEST_ASSERT_TRUE(sky.sky);
    r2d_world_free(&restored);
    r2d_sb_free(&baked);
    r2d_world_free(&world);
}

static void test_legacy_bake_stays_legacy(void)
{
    R2DRe2dWorld world = {0};
    char error[256] = {0};
    const char *plain =
        "{\"version\":1,\"cells\":[{\"x\":0,\"y\":0,\"w\":10,\"h\":10,"
        "\"spans\":[{\"bottom\":0,\"top\":20}]}],\"walls\":[],\"portals\":[]}";
    TEST_ASSERT_TRUE(r2d_world_load_json(&world, plain, error, sizeof error));
    R2dSb baked;
    r2d_sb_init(&baked);
    r2d_sb_puts(&baked, "{\"version\":1,");
    TEST_ASSERT_TRUE(r2d_world_put_baked(&world, &baked));
    r2d_sb_putc(&baked, '}');
    TEST_ASSERT_NOT_NULL(strstr(baked.data, "\"version\":1"));
    R2DRe2dWorld restored = {0};
    TEST_ASSERT_TRUE(r2d_world_load_json(&restored, baked.data, error, sizeof error));
    TEST_ASSERT_EQUAL_INT(0, restored.wall_count);
    TEST_ASSERT_EQUAL_INT(1, restored.span_count);
    r2d_world_free(&restored);
    r2d_sb_free(&baked);
    r2d_world_free(&world);
}

static void test_portal_area_only_forces_v5(void)
{
    R2DRe2dWorld world = {0};
    char error[256] = {0};
    const char *area_only =
        "{\"version\":1,\"cells\":["
        "{\"x\":0,\"y\":0,\"w\":10,\"h\":10,\"spans\":[{\"bottom\":0,\"top\":20}]},"
        "{\"x\":10,\"y\":0,\"w\":10,\"h\":10,\"spans\":[{\"bottom\":0,\"top\":20}]}],"
        "\"walls\":[],\"portals\":[{\"id\":\"p\",\"cellA\":0,\"cellB\":1,"
        "\"from\":[10,0],\"to\":[10,10],\"openings\":[{\"bottom\":0,\"top\":20}],"
        "\"areaPortal\":true}]}";
    TEST_ASSERT_TRUE(r2d_world_load_json(&world, area_only, error, sizeof error));
    R2dSb baked;
    r2d_sb_init(&baked);
    r2d_sb_puts(&baked, "{\"version\":1,");
    TEST_ASSERT_TRUE(r2d_world_put_baked(&world, &baked));
    r2d_sb_putc(&baked, '}');
    TEST_ASSERT_NOT_NULL(strstr(baked.data, "\"version\":5"));
    R2DRe2dWorld restored = {0};
    TEST_ASSERT_TRUE(r2d_world_load_json(&restored, baked.data, error, sizeof error));
    TEST_ASSERT_TRUE(r2d_world_portal_area(&restored, 0));
    r2d_world_free(&restored);
    r2d_sb_free(&baked);
    r2d_world_free(&world);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_wall_policy_bits);
    RUN_TEST(test_collision_and_ray_policy);
    RUN_TEST(test_baked_v5_roundtrip_preserves_tool_policy);
    RUN_TEST(test_legacy_bake_stays_legacy);
    RUN_TEST(test_portal_area_only_forces_v5);
    return UNITY_END();
}
