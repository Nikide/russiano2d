#include "re2d_world_render_features.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-5f

static void test_p4_defaults_and_presets(void)
{
    R2DWorldRenderFeatures f;
    memset(&f, 0xcd, sizeof(f));
    r2d_world_render_defaults(&f);
    TEST_ASSERT_TRUE_MESSAGE(f.light_shafts, "light shafts enabled by default");
    TEST_ASSERT_TRUE_MESSAGE(f.heat_distortion, "heat distortion enabled by default");
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, f.shaft_budget, "default shaft budget");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, f.distant_cards, "two default distant cards");

    TEST_ASSERT_TRUE(r2d_world_render_preset(R2D_RENDER_QUALITY_LOW, &f));
    TEST_ASSERT_FALSE_MESSAGE(f.light_shafts, "low disables shafts");
    TEST_ASSERT_FALSE_MESSAGE(f.weather_layers, "low disables weather");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, f.distant_cards, "low keeps one distant card");

    TEST_ASSERT_TRUE(r2d_world_render_preset(R2D_RENDER_QUALITY_HIGH, &f));
    TEST_ASSERT_TRUE_MESSAGE(f.weather_layers, "high enables weather layers");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, f.sky_profile, "high selects the dusk profile");
    TEST_ASSERT_TRUE_MESSAGE(f.distant_cards >= 3, "high increases distant cards");

    TEST_ASSERT_TRUE(r2d_world_render_preset(R2D_RENDER_QUALITY_ULTRA, &f));
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, f.sky_profile, "ultra selects the storm profile");
    TEST_ASSERT_EQUAL_INT_MESSAGE(8, f.shaft_budget, "ultra raises the shaft budget");
    TEST_ASSERT_TRUE_MESSAGE(f.weather_density > 0.4f, "ultra raises weather density");

    f.shaft_budget = 99;
    f.shaft_opacity = NAN;
    f.shaft_fade = -1.0f;
    f.sky_profile = 42;
    f.weather_type = -7;
    f.weather_density = 3.0f;
    f.distant_cards = 9;
    TEST_ASSERT_TRUE(r2d_world_render_validate(&f));
    TEST_ASSERT_EQUAL_INT_MESSAGE(8, f.shaft_budget, "shaft budget clamped");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.18f, f.shaft_opacity, "NaN shaft opacity falls back");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.01f, f.shaft_fade, "negative fade clamped");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, f.sky_profile, "bad sky profile falls back");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, f.weather_type, "bad weather type falls back");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, f.weather_density, "weather density clamped");
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, f.distant_cards, "distant card count clamped");
}

static void test_shaft_cards(void)
{
    R2DWorldRenderFeatures f;
    r2d_world_render_defaults(&f);
    float center = r2d_world_render_shaft_alpha(0.5f, 1.0f, &f);
    TEST_ASSERT_TRUE_MESSAGE(center > 0.0f, "shaft centre is visible");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, r2d_world_render_shaft_alpha(0.0f, 1.0f, &f),
                                     "shaft alpha feathers at the source end");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, r2d_world_render_shaft_alpha(1.0f, 1.0f, &f),
                                     "shaft alpha ends before the floor");
    float near_light = r2d_world_render_shaft_alpha(0.5f, 1.0f, &f);
    float near_floor = r2d_world_render_shaft_alpha(0.5f, 0.1f, &f);
    TEST_ASSERT_TRUE_MESSAGE(near_light > near_floor, "shaft fades with height");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f,
                                     r2d_world_render_shaft_alpha(NAN, 1.0f, &f),
                                     "NaN shaft input rejected");
    TEST_ASSERT_TRUE(r2d_world_render_shaft_width(1.0f, &f) >
                     r2d_world_render_shaft_width(0.0f, &f));
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, f.shaft_width,
                                     r2d_world_render_shaft_width(0.0f, &f),
                                     "shaft width starts at the authored width");
}

static void test_ambient_field_bake_and_sample(void)
{
    float floor[4] = {0, 0, 0, 0};
    float low_ceiling[4] = {32, 32, 32, 32};
    float open_ceiling[4] = {512, 512, 512, 512};
    const float sky[3] = {0.8f, 0.9f, 1.0f};
    R2DWorldAmbientField low, open;
    TEST_ASSERT_TRUE(r2d_world_ambient_bake(&low, 0, 0, 100, 100, 2, 2, floor, low_ceiling, sky, 0.7f));
    TEST_ASSERT_TRUE(r2d_world_ambient_bake(&open, 0, 0, 100, 100, 2, 2, floor, open_ceiling, sky, 0.7f));
    TEST_ASSERT_TRUE(low.valid && open.valid);
    TEST_ASSERT_EQUAL_INT(2, low.width);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 50.0f, low.cell_w);

    float lo_rgb[3], lo_ao = 0, open_rgb[3], open_ao = 0;
    r2d_world_ambient_sample(&low, 50.0f, 50.0f, lo_rgb, &lo_ao);
    r2d_world_ambient_sample(&open, 50.0f, 50.0f, open_rgb, &open_ao);
    TEST_ASSERT_TRUE_MESSAGE(lo_ao > open_ao, "low ceiling increases AO");
    TEST_ASSERT_TRUE_MESSAGE(open_rgb[2] > lo_rgb[2], "open ceiling is brighter");
    TEST_ASSERT_TRUE(lo_ao >= 0.0f && lo_ao <= 1.0f);

    float outside[3], out_ao = 1.0f;
    r2d_world_ambient_sample(&low, 500.0f, 500.0f, outside, &out_ao);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, outside[0]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, out_ao);
    r2d_world_ambient_sample(NULL, 1, 1, outside, &out_ao);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, outside[0]);
    TEST_ASSERT_FALSE(r2d_world_ambient_bake(NULL, 0, 0, 1, 1, 1, 1, NULL, NULL, NULL, 0));
    R2DWorldAmbientField again;
    TEST_ASSERT_FALSE(r2d_world_ambient_bake(&again, 0, 0, 1, 1, 0, 1, NULL, NULL, NULL, 0));
    TEST_ASSERT_TRUE(r2d_world_ambient_bake(&again, 0, 0, 100, 100, 2, 2, floor, low_ceiling, sky, 0.7f));
    TEST_ASSERT_EQUAL_INT(0, memcmp(&low, &again, sizeof(low)));
}

static void test_contact_light(void)
{
    const float light[3] = {1.0f, 0.6f, 0.2f};
    const float ambient[3] = {0.1f, 0.12f, 0.2f};
    float dir[2], rgb[3];
    r2d_world_render_contact_light(0.0f, 10.0f, light, 1.0f, ambient, dir, rgb);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, dir[0]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, dir[1]);
    TEST_ASSERT_TRUE_MESSAGE(rgb[0] > ambient[0] && rgb[1] > ambient[1],
                             "contact light mixes toward the light colour");
    float far_dir[2], far_rgb[3];
    r2d_world_render_contact_light(0.0f, 200.0f, light, 1.0f, ambient, far_dir, far_rgb);
    TEST_ASSERT_TRUE_MESSAGE(far_rgb[0] < rgb[0], "contact light falls off with distance");
    float zero_dir[2], zero_rgb[3];
    r2d_world_render_contact_light(0.0f, 0.0f, light, 1.0f, ambient, zero_dir, zero_rgb);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, zero_dir[0]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, zero_dir[1]);
    r2d_world_render_contact_light(NAN, 1.0f, NULL, 1.0f, NULL, dir, rgb);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, dir[0]);
}

static void test_detail_layers_and_direction(void)
{
    float base[2], detail[2], macro[2], w = 0;
    r2d_world_render_detail_layer(3, R2D_WORLD_DETAIL_BASE, 7u, 0.25f, 0.5f, base, &w);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.25f, base[0]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, w);
    r2d_world_render_detail_layer(3, R2D_WORLD_DETAIL_DETAIL, 7u, 0.25f, 0.5f, detail, &w);
    TEST_ASSERT_TRUE_MESSAGE(detail[0] != base[0] && w > 0.0f, "detail layer scales UV");
    r2d_world_render_detail_layer(3, R2D_WORLD_DETAIL_MACRO, 7u, 0.25f, 0.5f, macro, &w);
    TEST_ASSERT_TRUE_MESSAGE(macro[0] < detail[0], "macro layer uses a larger feature scale");
    float invalid[2]; w = 9.0f;
    r2d_world_render_detail_layer(3, 99, 7u, 0.25f, 0.5f, invalid, &w);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, w);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_render_sprite_direction(0.0f, 16), "direction 0");
    TEST_ASSERT_EQUAL_INT_MESSAGE(8, r2d_world_render_sprite_direction(3.14159265f, 16),
                                  "half turn is direction 8");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_render_sprite_direction(6.2831853f, 16),
                                  "full turn wraps to 0");
    TEST_ASSERT_EQUAL_INT_MESSAGE(15, r2d_world_render_sprite_direction(-0.55f, 16),
                                  "negative yaw wraps backwards");
}

static void test_decals2_lifetime_fade_rotation_scale(void)
{
    R2DWorldDecal2 d;
    TEST_ASSERT_TRUE(r2d_world_decal2_init(&d, 2, 0, 0, 1, 1, 0.1f, 1.5f, 2.0f, 0.5f, 0.5f, 4.0f));
    float rot = 0, scale = 0;
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, r2d_world_decal2_eval(&d, &rot, &scale));
    TEST_ASSERT_TRUE(r2d_world_decal2_step(&d, 0.5f));
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, r2d_world_decal2_eval(&d, &rot, &scale),
                                     "decal fully faded in");
    TEST_ASSERT_TRUE_MESSAGE(rot >= 0.1f - 0.175f && rot <= 0.1f + 0.175f &&
                             scale >= 1.5f * 0.85f && scale <= 1.5f * 1.15f,
                             "seed varies rotation and scale within bounds");
    TEST_ASSERT_TRUE(r2d_world_decal2_step(&d, 1.0f));
    TEST_ASSERT_TRUE(r2d_world_decal2_step(&d, 0.25f));
    TEST_ASSERT_TRUE(r2d_world_decal2_eval(&d, NULL, NULL) < 1.0f);
    TEST_ASSERT_FALSE(r2d_world_decal2_step(&d, 0.3f));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, r2d_world_decal2_eval(&d, NULL, NULL));
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_decal2_step(&d, 0.1f), "expired decal stays inactive");
    R2DWorldDecal2 bad;
    TEST_ASSERT_FALSE(r2d_world_decal2_init(&bad, -1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0));
    TEST_ASSERT_FALSE(r2d_world_decal2_init(&bad, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0));
    TEST_ASSERT_FALSE(r2d_world_decal2_init(&bad, 0, 0, 0, 1, 1, 0, 1, NAN, 0, 0, 0));
    TEST_ASSERT_FALSE(r2d_world_decal2_init(NULL, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0));
    TEST_ASSERT_FALSE(r2d_world_decal2_step(NULL, 0.1f));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, r2d_world_decal2_eval(NULL, NULL, NULL));
}

static void test_batching(void)
{
    R2DWorldBatchKey a, b, c, previous;
    bool has = false;
    R2DWorldBatchStats stats;
    memset(&stats, 0, sizeof(stats));
    r2d_world_render_batch_key(&a, 4, R2D_WORLD_BATCH_OPAQUE, 1, 2);
    r2d_world_render_batch_key(&b, 4, R2D_WORLD_BATCH_OPAQUE, 1, 2);
    r2d_world_render_batch_key(&c, 5, R2D_WORLD_BATCH_OPAQUE, 1, 2);
    TEST_ASSERT_EQUAL_UINT32(r2d_world_render_batch_hash(&a), r2d_world_render_batch_hash(&b));
    TEST_ASSERT_TRUE(r2d_world_render_batch_hash(&a) != r2d_world_render_batch_hash(&c));
    r2d_world_render_batch_draw(&stats, &a, &previous, &has);
    r2d_world_render_batch_draw(&stats, &b, &previous, &has);
    r2d_world_render_batch_draw(&stats, &b, &previous, &has);
    TEST_ASSERT_EQUAL_INT(3, stats.draws);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, stats.batches, "equal consecutive keys coalesce");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, stats.saved, "two draws saved by one batch");
    r2d_world_render_batch_draw(&stats, &c, &previous, &has);
    TEST_ASSERT_EQUAL_INT(2, stats.batches);
    TEST_ASSERT_EQUAL_INT(2, stats.runs);
    R2DWorldBatchKey neg;
    r2d_world_render_batch_key(&neg, -9, 1, -9, -9);
    TEST_ASSERT_EQUAL_INT(-1, neg.material);
    TEST_ASSERT_EQUAL_INT(-1, neg.light_policy);
    TEST_ASSERT_EQUAL_INT(-1, neg.atlas);
    r2d_world_render_batch_draw(NULL, &a, NULL, NULL);
    r2d_world_render_batch_draw(&stats, NULL, &previous, &has);
    TEST_ASSERT_EQUAL_INT(4, stats.draws);
}

static void test_residency_budget(void)
{
    R2DWorldResidency r;
    r2d_world_residency_init(&r, 1000, 300);
    TEST_ASSERT_TRUE(r2d_world_residency_admit(&r, 600));
    TEST_ASSERT_EQUAL_INT(1, r.resident);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_world_residency_admit(&r, 400), "exact budget fits");
    TEST_ASSERT_FALSE(r2d_world_residency_admit(&r, 1));
    TEST_ASSERT_EQUAL_INT(1, r.pending);
    TEST_ASSERT_EQUAL_UINT(1000u, (unsigned)r.resident_bytes);
    TEST_ASSERT_EQUAL_UINT(300u, (unsigned)r2d_world_residency_upload(&r, 500));
    TEST_ASSERT_EQUAL_UINT(300u, (unsigned)r.uploaded_bytes);
    TEST_ASSERT_EQUAL_UINT(100u, (unsigned)r2d_world_residency_upload(&r, 100));
    TEST_ASSERT_EQUAL_UINT(0u, (unsigned)r2d_world_residency_upload(&r, 0));
    TEST_ASSERT_FALSE(r2d_world_residency_admit(NULL, 1));
    TEST_ASSERT_EQUAL_UINT(0u, (unsigned)r2d_world_residency_upload(NULL, 5));
    r2d_world_residency_init(NULL, 1, 1);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_p4_defaults_and_presets);
    RUN_TEST(test_shaft_cards);
    RUN_TEST(test_ambient_field_bake_and_sample);
    RUN_TEST(test_contact_light);
    RUN_TEST(test_detail_layers_and_direction);
    RUN_TEST(test_decals2_lifetime_fade_rotation_scale);
    RUN_TEST(test_batching);
    RUN_TEST(test_residency_budget);
    return UNITY_END();
}
