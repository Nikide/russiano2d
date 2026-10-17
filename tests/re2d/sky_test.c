#include "re2d_world_sky.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-5f

static void test_profiles_and_validation(void)
{
    R2DWorldSky sky;
    memset(&sky, 0xcd, sizeof(sky));
    r2d_world_sky_defaults(&sky);
    TEST_ASSERT_EQUAL_INT(3, sky.layer_count);
    TEST_ASSERT_TRUE(sky.sun && !sky.moon);
    TEST_ASSERT_EQUAL_INT(2, sky.distant_count);

    for (int p = 0; p < R2D_SKY_PROFILE_COUNT; ++p) {
        R2DWorldSky out;
        TEST_ASSERT_TRUE(r2d_world_sky_profile(p, &out));
        TEST_ASSERT_TRUE(out.layer_count >= 1 && out.layer_count <= R2D_SKY_MAX_LAYERS);
        TEST_ASSERT_TRUE(out.exposure >= 0.25f && out.exposure <= 4.0f);
        TEST_ASSERT_TRUE(out.portal_policy >= R2D_SKY_PORTAL_NONE &&
                         out.portal_policy < R2D_SKY_PORTAL_COUNT);
    }
    TEST_ASSERT_FALSE(r2d_world_sky_profile(-1, &sky));
    TEST_ASSERT_FALSE(r2d_world_sky_profile(9, &sky));
    TEST_ASSERT_FALSE(r2d_world_sky_profile(0, NULL));

    R2DWorldSky storm;
    TEST_ASSERT_TRUE(r2d_world_sky_profile(R2D_SKY_PROFILE_STORM, &storm));
    TEST_ASSERT_TRUE(storm.weather_count >= 2);
    TEST_ASSERT_EQUAL_INT(R2D_SKY_WEATHER_CLOUDS, storm.weather[0].type);

    R2DWorldSky broken;
    r2d_world_sky_defaults(&broken);
    broken.layer_count = 99;
    broken.layers[0].alpha = NAN;
    broken.layers[1].parallax = -5;
    broken.weather_count = 99;
    broken.weather[0].type = 42;
    broken.weather[0].density = 9;
    broken.weather[0].speed = INFINITY;
    broken.distant_count = 99;
    broken.distant[0].alpha = 5;
    broken.sun_size = NAN;
    broken.exposure = 0;
    broken.portal_policy = 9;
    broken.portal_profile = -3;
    TEST_ASSERT_FALSE(r2d_world_sky_validate(NULL));
    TEST_ASSERT_TRUE(r2d_world_sky_validate(&broken));
    TEST_ASSERT_EQUAL_INT(4, broken.layer_count);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, broken.layers[0].alpha);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, broken.layers[1].parallax);
    TEST_ASSERT_EQUAL_INT(8, broken.weather_count);
    TEST_ASSERT_EQUAL_INT(R2D_SKY_WEATHER_NONE, broken.weather[0].type);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, broken.weather[0].density);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, broken.weather[0].speed);
    TEST_ASSERT_EQUAL_INT(4, broken.distant_count);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, broken.distant[0].alpha);
    TEST_ASSERT_EQUAL_INT(R2D_SKY_PORTAL_INHERIT, broken.portal_policy);
    TEST_ASSERT_EQUAL_INT(R2D_SKY_PROFILE_CLEAR, broken.portal_profile);
}

static void test_layer_sampling(void)
{
    R2DWorldSky sky;
    r2d_world_sky_defaults(&sky);
    float uv0[2], uv1[2];
    uint32_t tint0 = 0, tint1 = 0;
    float a0 = 0, a1 = 0;
    r2d_world_sky_layer_sample(&sky, 0, 0.7f, 1.0f, uv0, &tint0, &a0);
    r2d_world_sky_layer_sample(&sky, 1, 0.7f, 1.0f, uv1, &tint1, &a1);
    TEST_ASSERT_TRUE(a0 > 0.9f && a1 > 0.0f);
    TEST_ASSERT_TRUE(tint0 != tint1);
    TEST_ASSERT_TRUE_MESSAGE(uv0[0] != uv1[0], "layers use independent parallax");
    TEST_ASSERT_TRUE(uv0[0] >= 0.0f && uv0[0] < 1.0f && uv0[1] >= 0.0f && uv0[1] <= 1.0f);
    float again[2];
    uint32_t again_tint = 0;
    float again_alpha = 0;
    r2d_world_sky_layer_sample(&sky, 0, 0.7f, 1.0f, again, &again_tint, &again_alpha);
    TEST_ASSERT_EQUAL_UINT32(tint0, again_tint);
    TEST_ASSERT_FLOAT_WITHIN(EPS, uv0[0], again[0]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, a0, again_alpha);
    r2d_world_sky_layer_sample(&sky, -1, 0, 0, uv0, &tint0, &a0);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, a0, "invalid layer is neutral");
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, a0);
    r2d_world_sky_layer_sample(NULL, 0, 0, 0, uv0, &tint0, &a0);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, a0);
    sky.layer_count = 1;
    r2d_world_sky_layer_sample(&sky, 1, 0, 0, uv1, &tint1, &a1);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, a1);
}

static void test_celestial(void)
{
    R2DWorldSky sky;
    r2d_world_sky_defaults(&sky);
    float dir[3], visible = 0, size = 0, glow = 0;
    uint32_t color = 0;
    r2d_world_sky_celestial(&sky, false, dir, &visible, &size, &glow, &color);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, visible, "sun above horizon is visible");
    TEST_ASSERT_TRUE(size > 0.0f && glow > 0.0f);
    TEST_ASSERT_TRUE_MESSAGE(fabsf(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2] - 1.0f) < 1e-5f,
                             "sun direction is a unit vector");
    r2d_world_sky_celestial(&sky, true, dir, &visible, &size, &glow, &color);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, visible, "moon hidden when disabled");
    sky.moon = true;
    r2d_world_sky_celestial(&sky, true, dir, &visible, &size, &glow, &color);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, visible);
    sky.sun_elevation = -1.0f;
    r2d_world_sky_celestial(&sky, false, dir, &visible, &size, &glow, &color);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, visible);
    r2d_world_sky_celestial(NULL, false, dir, &visible, &size, &glow, &color);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, visible);
}

static void test_weather_stacking_and_sampling(void)
{
    R2DWorldSky sky;
    TEST_ASSERT_TRUE(r2d_world_sky_profile(R2D_SKY_PROFILE_STORM, &sky));
    TEST_ASSERT_TRUE(sky.weather_count >= 2);
    float w0 = r2d_world_sky_weather_weight(&sky, 0);
    float w1 = r2d_world_sky_weather_weight(&sky, 1);
    TEST_ASSERT_TRUE_MESSAGE(w0 > 0.0f && w1 > 0.0f, "two weather layers stack");
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, w0 + w1);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, r2d_world_sky_weather_weight(&sky, 7));

    float out[6], again[6];
    int type = 0, again_type = 0;
    TEST_ASSERT_TRUE(r2d_world_sky_weather_sample(&sky, 0, 5, 1.7f, 1234u, out, &type));
    TEST_ASSERT_EQUAL_INT(sky.weather[0].type, type);
    TEST_ASSERT_TRUE(r2d_world_sky_weather_sample(&sky, 0, 5, 1.7f, 1234u, again, &again_type));
    TEST_ASSERT_EQUAL_INT(type, again_type);
    for (int i = 0; i < 6; ++i) TEST_ASSERT_FLOAT_WITHIN(EPS, out[i], again[i]);
    TEST_ASSERT_TRUE(out[0] >= 0.0f && out[0] < 1.0f);
    TEST_ASSERT_TRUE(out[1] >= 0.0f && out[1] < 1.0f);
    TEST_ASSERT_TRUE(out[2] > 0.0f && out[3] > 0.0f);
    TEST_ASSERT_TRUE(out[5] > 0.0f && out[5] <= 1.0f);
    int other_type = 0;
    float other[6];
    r2d_world_sky_weather_sample(&sky, 1, 5, 1.7f, 1234u, other, &other_type);
    TEST_ASSERT_TRUE_MESSAGE(out[2] != other[2] || out[3] != other[3],
                             "rain and clouds use different card shapes");
    TEST_ASSERT_FALSE(r2d_world_sky_weather_sample(&sky, 0, -1, 0, 0, out, &type));
    TEST_ASSERT_FALSE(r2d_world_sky_weather_sample(NULL, 0, 0, 0, 0, out, &type));
    TEST_ASSERT_EQUAL_INT(R2D_SKY_WEATHER_NONE, type);
    sky.weather[0].density = 0.0f;
    TEST_ASSERT_FALSE(r2d_world_sky_weather_sample(&sky, 0, 0, 0, 0, out, &type));
}

static void test_distant_cards_and_policy(void)
{
    R2DWorldSky sky;
    r2d_world_sky_defaults(&sky);
    float x0 = 0, x1 = 0, a0 = 0, a1 = 0;
    uint32_t t0 = 0, t1 = 0;
    r2d_world_sky_distant_sample(&sky, 0, 0.9f, 2.0f, &x0, &t0, &a0);
    r2d_world_sky_distant_sample(&sky, 1, 0.9f, 2.0f, &x1, &t1, &a1);
    TEST_ASSERT_TRUE(a0 > 0.0f && a1 > 0.0f);
    TEST_ASSERT_TRUE_MESSAGE(x0 != x1, "distant cards use independent parallax");
    TEST_ASSERT_TRUE(t0 != t1);
    float x2 = 99;
    uint32_t t2 = 0;
    float a2 = 99;
    r2d_world_sky_distant_sample(&sky, 9, 0, 0, &x2, &t2, &a2);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, x2);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, a2);

    TEST_ASSERT_TRUE(r2d_world_sky_surface_visible(&sky, true, false));
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_sky_surface_visible(&sky, false, false),
                              "non-sky surface does not draw sky");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_sky_surface_visible(&sky, true, true),
                              "nodraw/clip wins over sky flag");
    TEST_ASSERT_FALSE(r2d_world_sky_surface_visible(NULL, true, false));

    TEST_ASSERT_EQUAL_INT(R2D_SKY_PROFILE_CLEAR, r2d_world_sky_portal_profile(&sky, -1));
    sky.portal_policy = R2D_SKY_PORTAL_PROFILE;
    sky.portal_profile = R2D_SKY_PROFILE_NIGHT;
    TEST_ASSERT_EQUAL_INT(R2D_SKY_PROFILE_NIGHT, r2d_world_sky_portal_profile(&sky, -1));
    TEST_ASSERT_EQUAL_INT(R2D_SKY_PROFILE_DUSK, r2d_world_sky_portal_profile(&sky, R2D_SKY_PROFILE_DUSK));
    TEST_ASSERT_EQUAL_INT(R2D_SKY_PROFILE_CLEAR, r2d_world_sky_portal_profile(NULL, -1));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_profiles_and_validation);
    RUN_TEST(test_layer_sampling);
    RUN_TEST(test_celestial);
    RUN_TEST(test_weather_stacking_and_sampling);
    RUN_TEST(test_distant_cards_and_policy);
    return UNITY_END();
}
