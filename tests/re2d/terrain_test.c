#include "re2d_world_terrain.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static void assert_finite_preset(const R2DWorldTerrain *t)
{
    TEST_ASSERT_NOT_NULL(t);
    const char *name = r2d_world_terrain_name(t->kind);
    TEST_ASSERT_NOT_NULL_MESSAGE(name, "every preset has a name");
    TEST_ASSERT_TRUE(t->move_scale >= 0.0f && t->move_scale <= 4.0f);
    TEST_ASSERT_TRUE(t->friction_scale >= 0.0f && t->friction_scale <= 4.0f);
    TEST_ASSERT_TRUE(t->damage_per_second >= 0.0f);
    TEST_ASSERT_TRUE(t->splash_speed >= 0.0f);
    TEST_ASSERT_TRUE(t->tint_r >= 0.0f && t->tint_r <= 1.0f);
    TEST_ASSERT_TRUE(t->tint_g >= 0.0f && t->tint_g <= 1.0f);
    TEST_ASSERT_TRUE(t->tint_b >= 0.0f && t->tint_b <= 1.0f);
    TEST_ASSERT_TRUE(t->fog_density >= 0.0f && t->fog_density <= 1.0f);
    TEST_ASSERT_TRUE(t->decal_policy >= R2D_TERRAIN_DECAL_NONE);
    TEST_ASSERT_TRUE(t->decal_policy <= R2D_TERRAIN_DECAL_MAGIC);
}

static void test_presets_solid_families(void)
{
    const int kinds[] = {
        R2D_TERRAIN_NONE, R2D_TERRAIN_STONE, R2D_TERRAIN_METAL,
        R2D_TERRAIN_FLESH, R2D_TERRAIN_WOOD, R2D_TERRAIN_CRYSTAL
    };
    for (unsigned i = 0; i < sizeof kinds / sizeof kinds[0]; i++) {
        const R2DWorldTerrain *t = r2d_world_terrain_preset(kinds[i]);
        assert_finite_preset(t);
        TEST_ASSERT_EQUAL_INT(kinds[i], t->kind);
    }
    TEST_ASSERT_EQUAL_FLOAT(1.0f, r2d_world_terrain_preset(R2D_TERRAIN_NONE)->move_scale);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, r2d_world_terrain_preset(R2D_TERRAIN_STONE)->damage_per_second);
    TEST_ASSERT_EQUAL_FLOAT(0.875f, r2d_world_terrain_preset(R2D_TERRAIN_FLESH)->move_scale);
    TEST_ASSERT_EQUAL_FLOAT(0.75f, r2d_world_terrain_preset(R2D_TERRAIN_CRYSTAL)->friction_scale);
    TEST_ASSERT_EQUAL_INT(R2D_TERRAIN_DECAL_BLOOD, r2d_world_terrain_preset(R2D_TERRAIN_FLESH)->decal_policy);
}

static void test_presets_liquid_and_special_families(void)
{
    const int kinds[] = {
        R2D_TERRAIN_MAGIC, R2D_TERRAIN_WATER, R2D_TERRAIN_BLOOD,
        R2D_TERRAIN_ACID, R2D_TERRAIN_LAVA, R2D_TERRAIN_MIST
    };
    for (unsigned i = 0; i < sizeof kinds / sizeof kinds[0]; i++) {
        const R2DWorldTerrain *t = r2d_world_terrain_preset(kinds[i]);
        assert_finite_preset(t);
        TEST_ASSERT_EQUAL_INT(kinds[i], t->kind);
        TEST_ASSERT_TRUE_MESSAGE(t->splash_speed > 0.0f, "liquid/special surfaces splash");
    }
    TEST_ASSERT_TRUE(r2d_world_terrain_preset(R2D_TERRAIN_WATER)->move_scale < 1.0f);
    TEST_ASSERT_TRUE(r2d_world_terrain_preset(R2D_TERRAIN_LAVA)->move_scale < 1.0f);
    TEST_ASSERT_TRUE(r2d_world_terrain_preset(R2D_TERRAIN_MIST)->fog_density > 0.0f);
}

static void test_name_round_trip_both_ways(void)
{
    for (int kind = 0; kind < (int)R2D_TERRAIN_COUNT; kind++) {
        const char *name = r2d_world_terrain_name(kind);
        int parsed = -1;
        TEST_ASSERT_NOT_NULL(name);
        TEST_ASSERT_TRUE_MESSAGE(r2d_world_terrain_from_name(name, &parsed), "canonical name parses");
        TEST_ASSERT_EQUAL_INT(kind, parsed);

        char upper[32];
        const size_t len = strlen(name);
        TEST_ASSERT_TRUE(len < sizeof upper);
        for (size_t i = 0; i <= len; i++) {
            char c = name[i];
            upper[i] = (c >= 'a' && c <= 'z') ? (char)(c - 'a' + 'A') : c;
        }
        parsed = -1;
        TEST_ASSERT_TRUE_MESSAGE(r2d_world_terrain_from_name(upper, &parsed), "name is case-insensitive");
        TEST_ASSERT_EQUAL_INT(kind, parsed);
        TEST_ASSERT_TRUE(strcmp(r2d_world_terrain_name(parsed), name) == 0);
    }

    int parsed = -1;
    TEST_ASSERT_TRUE(r2d_world_terrain_from_name("WaTeR", &parsed));
    TEST_ASSERT_EQUAL_INT(R2D_TERRAIN_WATER, parsed);
    TEST_ASSERT_TRUE(r2d_world_terrain_from_name("LAVA", &parsed));
    TEST_ASSERT_EQUAL_INT(R2D_TERRAIN_LAVA, parsed);
}

static void test_unknown_and_null_names_rejected(void)
{
    int kind = 123;
    TEST_ASSERT_FALSE(r2d_world_terrain_from_name(NULL, &kind));
    TEST_ASSERT_EQUAL_INT(-1, kind);
    kind = 123;
    TEST_ASSERT_FALSE(r2d_world_terrain_from_name("", &kind));
    TEST_ASSERT_EQUAL_INT(-1, kind);
    kind = 123;
    TEST_ASSERT_FALSE(r2d_world_terrain_from_name("water ", &kind));
    TEST_ASSERT_EQUAL_INT(-1, kind);
    TEST_ASSERT_FALSE(r2d_world_terrain_from_name("waterx", &kind));
    TEST_ASSERT_FALSE(r2d_world_terrain_from_name("wat er", &kind));
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_terrain_from_name("stone", NULL), "NULL out-kind is allowed on success");

    TEST_ASSERT_NULL(r2d_world_terrain_preset(-1));
    TEST_ASSERT_NULL(r2d_world_terrain_preset((int)R2D_TERRAIN_COUNT));
    TEST_ASSERT_NULL(r2d_world_terrain_name(-1));
    TEST_ASSERT_NULL(r2d_world_terrain_name((int)R2D_TERRAIN_COUNT));
}

static void test_conveyor_accelerates_toward_surface_velocity(void)
{
    R2DWorldConveyor c = { 100.0f, 0.0f, 50.0f, true };
    float vx = 0.0f, vy = 0.0f;
    r2d_world_conveyor_apply(&c, &vx, &vy, 1.0f, 0.1f);       // accel*dt = 5
    TEST_ASSERT_EQUAL_FLOAT(5.0f, vx);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, vy);
    for (int i = 0; i < 100; i++) r2d_world_conveyor_apply(&c, &vx, &vy, 1.0f, 0.1f);
    TEST_ASSERT_EQUAL_FLOAT(100.0f, vx);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, vy);

    R2DWorldConveyor diag = { 60.0f, 80.0f, 1000.0f, false };
    vx = 0.0f; vy = 0.0f;
    r2d_world_conveyor_apply(&diag, &vx, &vy, 1.0f, 0.25f);
    TEST_ASSERT_EQUAL_FLOAT(60.0f, vx);
    TEST_ASSERT_EQUAL_FLOAT(80.0f, vy);
}

static void test_move_scale_zero_stops_drift(void)
{
    R2DWorldConveyor c = { 200.0f, -100.0f, 50.0f, true };
    float vx = 50.0f, vy = 20.0f;
    for (int i = 0; i < 100; i++) r2d_world_conveyor_apply(&c, &vx, &vy, 0.0f, 0.05f);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, vx);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, vy);

    vx = 40.0f; vy = 40.0f;
    r2d_world_conveyor_apply(&c, &vx, &vy, 0.5f, 0.05f);      // target (100,-50)
    TEST_ASSERT_TRUE(vx > 40.0f && vy < 40.0f);
    TEST_ASSERT_TRUE(isfinite(vx) && isfinite(vy));
}

static void test_dt_clamp_and_invalid_dt(void)
{
    R2DWorldConveyor c = { 100.0f, 0.0f, 100.0f, false };
    float a = 0.0f, b = 0.0f;
    r2d_world_conveyor_apply(&c, &a, &b, 1.0f, 100.0f);       // clamps to 0.25
    TEST_ASSERT_EQUAL_FLOAT(25.0f, a);
    float c0 = 0.0f, d0 = 0.0f;
    r2d_world_conveyor_apply(&c, &c0, &d0, 1.0f, 0.25f);
    TEST_ASSERT_EQUAL_FLOAT(c0, a);

    const float bad_dt[] = { 0.0f, -1.0f, NAN, INFINITY, -INFINITY };
    for (unsigned i = 0; i < sizeof bad_dt / sizeof bad_dt[0]; i++) {
        float vx = 7.0f, vy = -3.0f;
        r2d_world_conveyor_apply(&c, &vx, &vy, 1.0f, bad_dt[i]);
        TEST_ASSERT_EQUAL_FLOAT(7.0f, vx);
        TEST_ASSERT_EQUAL_FLOAT(-3.0f, vy);
    }
}

static void test_affects_projectiles_is_data_only(void)
{
    R2DWorldConveyor a = { 120.0f, -40.0f, 80.0f, true };
    R2DWorldConveyor b = a;
    b.affects_projectiles = false;
    float ax = 0.0f, ay = 0.0f, bx = 0.0f, by = 0.0f;
    for (int i = 0; i < 20; i++) {
        r2d_world_conveyor_apply(&a, &ax, &ay, 1.0f, 0.05f);
        r2d_world_conveyor_apply(&b, &bx, &by, 1.0f, 0.05f);
    }
    TEST_ASSERT_EQUAL_FLOAT(ax, bx);
    TEST_ASSERT_EQUAL_FLOAT(ay, by);
    TEST_ASSERT_TRUE_MESSAGE(a.affects_projectiles != b.affects_projectiles, "flag stays data-only");
}

static void test_conveyor_never_overshoots(void)
{
    R2DWorldConveyor c = { 3.0f, 4.0f, 1000.0f, false };
    float vx = 100.0f, vy = 100.0f;
    r2d_world_conveyor_apply(&c, &vx, &vy, 1.0f, 0.25f);
    TEST_ASSERT_EQUAL_FLOAT(3.0f, vx);
    TEST_ASSERT_EQUAL_FLOAT(4.0f, vy);

    R2DWorldConveyor slow = { 10.0f, 0.0f, 1.0f, false };
    vx = 9.5f; vy = 0.0f;
    r2d_world_conveyor_apply(&slow, &vx, &vy, 1.0f, 0.1f);     // step .1 > .5 gap? no
    TEST_ASSERT_EQUAL_FLOAT(9.6f, vx);
    TEST_ASSERT_TRUE(vx < 10.0f);
}

static void test_determinism_10k_steps(void)
{
    R2DWorldConveyor c = { 120.0f, -45.0f, 400.0f, true };
    float ax = 0.0f, ay = 0.0f, bx = 0.0f, by = 0.0f;
    for (int i = 0; i < 10000; i++) {
        const float dt = (float)((i % 7) + 1) * 0.01f;
        const float scale = 1.0f;
        r2d_world_conveyor_apply(&c, &ax, &ay, scale, dt);
        r2d_world_conveyor_apply(&c, &bx, &by, scale, dt);
        TEST_ASSERT_TRUE(isfinite(ax) && isfinite(ay));
    }
    TEST_ASSERT_EQUAL_FLOAT(ax, bx);
    TEST_ASSERT_EQUAL_FLOAT(ay, by);
    TEST_ASSERT_EQUAL_FLOAT(120.0f, ax);
    TEST_ASSERT_EQUAL_FLOAT(-45.0f, ay);
}

static void test_damage_tint_and_fog_presets_pinned(void)
{
    const R2DWorldTerrain *water = r2d_world_terrain_preset(R2D_TERRAIN_WATER);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, water->damage_per_second);
    TEST_ASSERT_EQUAL_FLOAT(0.25f, water->tint_r);
    TEST_ASSERT_EQUAL_FLOAT(0.5f, water->tint_g);
    TEST_ASSERT_EQUAL_FLOAT(0.75f, water->tint_b);
    TEST_ASSERT_EQUAL_FLOAT(0.015625f, water->fog_density);
    TEST_ASSERT_EQUAL_INT(R2D_TERRAIN_DECAL_WET, water->decal_policy);

    const R2DWorldTerrain *blood = r2d_world_terrain_preset(R2D_TERRAIN_BLOOD);
    TEST_ASSERT_EQUAL_FLOAT(0.5f, blood->damage_per_second);
    TEST_ASSERT_EQUAL_FLOAT(0.5f, blood->tint_r);
    TEST_ASSERT_EQUAL_FLOAT(0.0625f, blood->tint_g);
    TEST_ASSERT_EQUAL_FLOAT(0.0625f, blood->tint_b);
    TEST_ASSERT_EQUAL_FLOAT(0.03125f, blood->fog_density);
    TEST_ASSERT_EQUAL_INT(R2D_TERRAIN_DECAL_BLOOD, blood->decal_policy);

    const R2DWorldTerrain *acid = r2d_world_terrain_preset(R2D_TERRAIN_ACID);
    TEST_ASSERT_EQUAL_FLOAT(8.0f, acid->damage_per_second);
    TEST_ASSERT_EQUAL_FLOAT(0.5f, acid->tint_r);
    TEST_ASSERT_EQUAL_FLOAT(0.875f, acid->tint_g);
    TEST_ASSERT_EQUAL_FLOAT(0.125f, acid->tint_b);
    TEST_ASSERT_EQUAL_FLOAT(0.03125f, acid->fog_density);
    TEST_ASSERT_EQUAL_INT(R2D_TERRAIN_DECAL_ACID, acid->decal_policy);

    const R2DWorldTerrain *lava = r2d_world_terrain_preset(R2D_TERRAIN_LAVA);
    TEST_ASSERT_EQUAL_FLOAT(40.0f, lava->damage_per_second);
    TEST_ASSERT_EQUAL_FLOAT(1.0f, lava->tint_r);
    TEST_ASSERT_EQUAL_FLOAT(0.25f, lava->tint_g);
    TEST_ASSERT_EQUAL_FLOAT(0.0625f, lava->tint_b);
    TEST_ASSERT_EQUAL_FLOAT(0.0625f, lava->fog_density);
    TEST_ASSERT_EQUAL_INT(R2D_TERRAIN_DECAL_SCORCH, lava->decal_policy);

    const R2DWorldTerrain *mist = r2d_world_terrain_preset(R2D_TERRAIN_MIST);
    TEST_ASSERT_EQUAL_FLOAT(2.0f, mist->damage_per_second);
    TEST_ASSERT_EQUAL_FLOAT(0.625f, mist->tint_r);
    TEST_ASSERT_EQUAL_FLOAT(0.75f, mist->tint_g);
    TEST_ASSERT_EQUAL_FLOAT(0.875f, mist->tint_b);
    TEST_ASSERT_EQUAL_FLOAT(0.125f, mist->fog_density);
    TEST_ASSERT_EQUAL_INT(R2D_TERRAIN_DECAL_MAGIC, mist->decal_policy);
}

static void test_invalid_conveyor_input_unchanged(void)
{
    R2DWorldConveyor c = { 100.0f, 50.0f, 10.0f, false };
    float vx = 4.0f, vy = -2.0f;
    r2d_world_conveyor_apply(NULL, &vx, &vy, 1.0f, 0.1f);
    TEST_ASSERT_EQUAL_FLOAT(4.0f, vx);
    TEST_ASSERT_EQUAL_FLOAT(-2.0f, vy);
    r2d_world_conveyor_apply(&c, NULL, &vy, 1.0f, 0.1f);
    r2d_world_conveyor_apply(&c, &vx, NULL, 1.0f, 0.1f);
    TEST_ASSERT_EQUAL_FLOAT(4.0f, vx);
    TEST_ASSERT_EQUAL_FLOAT(-2.0f, vy);

    R2DWorldConveyor bad = c;
    bad.vx = NAN;
    r2d_world_conveyor_apply(&bad, &vx, &vy, 1.0f, 0.1f);
    TEST_ASSERT_EQUAL_FLOAT(4.0f, vx);
    bad = c; bad.vy = INFINITY;
    r2d_world_conveyor_apply(&bad, &vx, &vy, 1.0f, 0.1f);
    bad = c; bad.accel = -1.0f;
    r2d_world_conveyor_apply(&bad, &vx, &vy, 1.0f, 0.1f);
    bad = c; bad.accel = NAN;
    r2d_world_conveyor_apply(&bad, &vx, &vy, 1.0f, 0.1f);
    r2d_world_conveyor_apply(&c, &vx, &vy, -1.0f, 0.1f);
    r2d_world_conveyor_apply(&c, &vx, &vy, NAN, 0.1f);
    TEST_ASSERT_EQUAL_FLOAT(4.0f, vx);
    TEST_ASSERT_EQUAL_FLOAT(-2.0f, vy);

    float nx = NAN, ny = 3.0f;
    r2d_world_conveyor_apply(&c, &nx, &ny, 1.0f, 0.1f);
    TEST_ASSERT_TRUE(isnan(nx));
    TEST_ASSERT_EQUAL_FLOAT(3.0f, ny);
    nx = INFINITY; ny = 0.0f;
    r2d_world_conveyor_apply(&c, &nx, &ny, 1.0f, 0.1f);
    TEST_ASSERT_TRUE(isinf(nx));
}

static void test_presets_are_stable_read_only_data(void)
{
    for (int kind = 0; kind < (int)R2D_TERRAIN_COUNT; kind++) {
        const R2DWorldTerrain *a = r2d_world_terrain_preset(kind);
        const R2DWorldTerrain *b = r2d_world_terrain_preset(kind);
        TEST_ASSERT_TRUE(a == b);
        TEST_ASSERT_TRUE(memcmp(a, b, sizeof *a) == 0);
        TEST_ASSERT_TRUE(strcmp(r2d_world_terrain_name(kind), r2d_world_terrain_name(kind)) == 0);
    }
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_presets_solid_families);
    RUN_TEST(test_presets_liquid_and_special_families);
    RUN_TEST(test_name_round_trip_both_ways);
    RUN_TEST(test_unknown_and_null_names_rejected);
    RUN_TEST(test_conveyor_accelerates_toward_surface_velocity);
    RUN_TEST(test_move_scale_zero_stops_drift);
    RUN_TEST(test_dt_clamp_and_invalid_dt);
    RUN_TEST(test_affects_projectiles_is_data_only);
    RUN_TEST(test_conveyor_never_overshoots);
    RUN_TEST(test_determinism_10k_steps);
    RUN_TEST(test_damage_tint_and_fog_presets_pinned);
    RUN_TEST(test_invalid_conveyor_input_unchanged);
    RUN_TEST(test_presets_are_stable_read_only_data);
    return UNITY_END();
}
