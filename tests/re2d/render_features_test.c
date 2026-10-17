#include "re2d_world_render_features.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-5f
#define PI_F 3.14159265358979323846f

static void test_defaults(void)
{
    R2DWorldRenderFeatures f;
    memset(&f, 0xcd, sizeof(f));
    r2d_world_render_defaults(&f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_RENDER_QUALITY_MEDIUM, f.quality, "default quality is medium");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(0x9e3779b9u, f.seed, "default seed");
    TEST_ASSERT_TRUE_MESSAGE(f.grounding && f.contact_shadow && f.foot_ao,
                             "P0 grounding defaults on");
    TEST_ASSERT_TRUE_MESSAGE(f.edge_quality && f.material_variation && f.corner_ao,
                             "R-01 surface defaults on");
    TEST_ASSERT_TRUE_MESSAGE(f.height_fog && f.atmospheric_haze && f.sky_layers,
                             "R-02 atmosphere/sky defaults on");
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, f.sky_layer_count, "three default parallax layers");
    TEST_ASSERT_TRUE_MESSAGE(f.shadow_softness > 0.0f && f.shadow_opacity <= 1.0f,
                             "shadow parameters in range");
    TEST_ASSERT_TRUE_MESSAGE(f.shadow_height_fade > 0.0f, "height fade enabled");
    TEST_ASSERT_FALSE_MESSAGE(f.reflection_lite, "reflection-lite is opt-in");
}

static void test_quality_presets(void)
{
    R2DWorldRenderFeatures f;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_render_preset(R2D_RENDER_QUALITY_LOW, &f), "low preset");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_RENDER_QUALITY_LOW, f.quality, "low quality stored");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, f.sky_layer_count, "low has one sky layer");
    TEST_ASSERT_FALSE_MESSAGE(f.foot_ao, "low disables foot AO");
    TEST_ASSERT_FALSE_MESSAGE(f.height_fog, "low disables height fog");
    TEST_ASSERT_FALSE_MESSAGE(f.sky_layers ? f.sun_disc : false, "low disables celestial disc");
    TEST_ASSERT_FALSE_MESSAGE(f.bloom_lite, "low disables bloom-lite");

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_render_preset(R2D_RENDER_QUALITY_MEDIUM, &f), "medium preset");
    TEST_ASSERT_TRUE_MESSAGE(f.foot_ao && f.height_fog && f.sun_disc, "medium enables P0/P1 features");

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_render_preset(R2D_RENDER_QUALITY_HIGH, &f), "high preset");
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, f.sky_layer_count, "high has four sky layers");
    TEST_ASSERT_TRUE_MESSAGE(f.haze_strength > 0.35f, "high increases haze");

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_render_preset(R2D_RENDER_QUALITY_ULTRA, &f), "ultra preset");
    TEST_ASSERT_TRUE_MESSAGE(f.shadow_softness > 0.7f && f.macro_strength > 0.6f,
                             "ultra increases visual density");

    R2DWorldRenderFeatures keep = f;
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_render_preset(99, &f), "invalid preset rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_render_preset(-1, &f), "negative preset rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_render_preset(0, NULL), "NULL preset rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(keep.quality, f.quality, "failed preset leaves config untouched");
}

static void test_validate_clamps_and_nan(void)
{
    R2DWorldRenderFeatures f;
    r2d_world_render_defaults(&f);
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_render_validate(NULL), "NULL validate rejected");

    f.quality = 12;
    f.shadow_opacity = 2.0f;
    f.shadow_softness = -1.0f;
    f.edge_alpha_threshold = NAN;
    f.fog_height_density = INFINITY;
    f.sky_layer_count = 9;
    f.sky_scale[0] = NAN;
    f.sky_alpha[1] = -3.0f;
    f.sun_size = 4.0f;
    f.liquid_distortion = -2.0f;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_render_validate(&f), "validate sanitizes");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_RENDER_QUALITY_MEDIUM, f.quality, "quality clamped to preset range");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, f.shadow_opacity, "opacity clamped to 1");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.05f, f.shadow_softness, "softness clamped low");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.45f, f.edge_alpha_threshold,
                                     "NaN threshold falls back to default");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.006f, f.fog_height_density,
                                     "infinite fog density falls back to default");
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, f.sky_layer_count, "sky layer count clamped to 4");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.00f, f.sky_scale[0],
                                     "NaN sky scale falls back to default");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, f.sky_alpha[1], "negative layer alpha clamped");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, f.sun_size, "sun size clamped");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, f.liquid_distortion, "negative distortion clamped");
}

static void test_hash_deterministic(void)
{
    uint32_t a = r2d_world_render_hash(7u, 42u);
    uint32_t b = r2d_world_render_hash(7u, 42u);
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(a, b, "hash is deterministic");
    TEST_ASSERT_TRUE_MESSAGE(a != r2d_world_render_hash(7u, 43u), "hash changes with value");
    TEST_ASSERT_TRUE_MESSAGE(a != r2d_world_render_hash(8u, 42u), "hash changes with seed");
    float range = (float)(a & 0x00ffffffu) / 16777216.0f;
    TEST_ASSERT_TRUE_MESSAGE(range >= 0.0f && range < 1.0f, "hash maps to [0,1)");
}

static void test_contact_alpha_falloff(void)
{
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f,
                                     r2d_world_render_contact_alpha(0.0f, 10.0f, 0.5f, 0.0f, 30.0f),
                                     "contact shadow center is opaque");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f,
                                     r2d_world_render_contact_alpha(10.0f, 10.0f, 0.5f, 0.0f, 30.0f),
                                     "contact shadow ends at radius");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f,
                                     r2d_world_render_contact_alpha(12.0f, 10.0f, 0.5f, 0.0f, 30.0f),
                                     "contact shadow outside radius");
    float mid = r2d_world_render_contact_alpha(8.0f, 10.0f, 0.4f, 0.0f, 30.0f);
    TEST_ASSERT_TRUE_MESSAGE(mid > 0.0f && mid < 1.0f, "contact shadow has a feather band");
    float high_gap = r2d_world_render_contact_alpha(0.0f, 10.0f, 0.5f, 30.0f, 30.0f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, high_gap, "height fade removes floating shadow");
    float half_gap = r2d_world_render_contact_alpha(0.0f, 10.0f, 0.5f, 15.0f, 30.0f);
    TEST_ASSERT_TRUE_MESSAGE(half_gap > 0.0f && half_gap < 1.0f, "height fade is gradual");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f,
                                     r2d_world_render_contact_alpha(NAN, 10.0f, 0.5f, 0.0f, 30.0f),
                                     "NaN distance rejected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f,
                                     r2d_world_render_contact_alpha(1.0f, 0.0f, 0.5f, 0.0f, 30.0f),
                                     "zero radius rejected");
}

static void test_foot_ao(void)
{
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.8f,
                                     r2d_world_render_foot_ao(0.0f, 10.0f, 0.8f),
                                     "foot AO center uses strength");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f,
                                     r2d_world_render_foot_ao(10.0f, 10.0f, 0.8f),
                                     "foot AO ends at radius");
    float mid = r2d_world_render_foot_ao(5.0f, 10.0f, 0.8f);
    TEST_ASSERT_TRUE_MESSAGE(mid > 0.0f && mid < 0.8f, "foot AO falls off smoothly");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f,
                                     r2d_world_render_foot_ao(0.0f, 10.0f, 0.0f),
                                     "zero strength disables foot AO");
}

static void test_fog_and_haze(void)
{
    R2DWorldRenderFeatures f;
    r2d_world_render_defaults(&f);
    float near0 = r2d_world_render_fog_factor(0.0f, f.fog_base_height, &f);
    float far1 = r2d_world_render_fog_factor(1000.0f, f.fog_base_height, &f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, near0, "fog starts at zero");
    TEST_ASSERT_TRUE_MESSAGE(far1 > 0.5f, "distance increases fog");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_render_fog_factor(100.0f, 200.0f, &f) >
                             r2d_world_render_fog_factor(100.0f, f.fog_base_height, &f),
                             "height above base adds fog");
    float factor = r2d_world_render_fog_factor(INFINITY, 0.0f, &f);
    TEST_ASSERT_TRUE_MESSAGE(isfinite(factor), "infinite distance stays finite");

    float fog_rgb[3] = {0.1f, 0.2f, 0.3f};
    float sky_rgb[3] = {0.6f, 0.5f, 0.9f};
    float out[3];
    r2d_world_render_haze_mix(fog_rgb, sky_rgb, 0.0f, out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.1f, out[0], "zero haze keeps fog color");
    r2d_world_render_haze_mix(fog_rgb, sky_rgb, 1.0f, out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.6f, out[0], "full haze uses sky color");
    r2d_world_render_haze_mix(fog_rgb, sky_rgb, 0.5f, out);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.35f, out[0], "half haze blends channel");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, out[2] - 0.6f, "blue channel blend");

    R2DWorldRenderFeatures still = f;
    still.fog_height_density = 0.0f;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f,
                                     r2d_world_render_fog_factor(0.0f, 1000.0f, &still),
                                     "zero height density disables the height term");
}

static void test_material_variation(void)
{
    float tint_a[3], tint_b[3], tint_zero[3];
    float uv_a[2], uv_b[2];
    r2d_world_render_variation(3u, 1, 9u, 0.5f, tint_a, uv_a);
    r2d_world_render_variation(3u, 1, 9u, 0.5f, tint_b, uv_b);
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(tint_a[0], tint_b[0], "variation deterministic tint");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(uv_a[0], uv_b[0], "variation deterministic uv");
    TEST_ASSERT_TRUE_MESSAGE(uv_a[0] >= 0.0f && uv_a[0] < 1.0f, "variation u in [0,1)");
    TEST_ASSERT_TRUE_MESSAGE(uv_a[1] >= 0.0f && uv_a[1] < 1.0f, "variation v in [0,1)");

    float tint_other[3];
    r2d_world_render_variation(4u, 1, 9u, 0.5f, tint_other, NULL);
    TEST_ASSERT_TRUE_MESSAGE(tint_other[0] != tint_a[0] || tint_other[1] != tint_a[1] ||
                             tint_other[2] != tint_a[2], "different surface varies");

    r2d_world_render_variation(3u, 1, 9u, 0.0f, tint_zero, NULL);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, tint_zero[0], "zero strength is neutral r");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, tint_zero[1], "zero strength is neutral g");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, tint_zero[2], "zero strength is neutral b");

    for (int i = 0; i < 3; ++i) {
        TEST_ASSERT_TRUE_MESSAGE(tint_a[i] > 0.7f && tint_a[i] < 1.3f,
                                 "variation tint stays near neutral");
    }
    r2d_world_render_variation(0u, 0, 0u, 1.0f, NULL, NULL); // NULL outputs are safe
}

static void test_edge_alpha(void)
{
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f,
                                     r2d_world_render_edge_alpha(0.49f, 0.5f, 0.0f),
                                     "hard threshold rejects below");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f,
                                     r2d_world_render_edge_alpha(0.5f, 0.5f, 0.0f),
                                     "hard threshold accepts at edge");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f,
                                     r2d_world_render_edge_alpha(0.39f, 0.5f, 0.2f),
                                     "feather low end is zero");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f,
                                     r2d_world_render_edge_alpha(0.61f, 0.5f, 0.2f),
                                     "feather high end is one");
    float mid = r2d_world_render_edge_alpha(0.5f, 0.5f, 0.2f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.5f, mid, "feather midpoint is half");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_render_edge_alpha(NAN, 0.5f, 0.2f) >= 0.0f,
                             "NaN alpha stays in range");
}

static void test_ao_lite(void)
{
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f,
                                     r2d_world_render_ao_lite(20.0f, 20.0f, 10.0f, 0.5f, 0.2f),
                                     "AO is neutral far from edges");
    float corner = r2d_world_render_ao_lite(0.0f, 0.0f, 10.0f, 0.5f, 0.0f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.5f, corner, "corner AO darkens two-edge corner");
    float beveled = r2d_world_render_ao_lite(0.0f, 0.0f, 10.0f, 0.5f, 0.5f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.375f, beveled, "bevel adds edge darkening");
    float one_edge = r2d_world_render_ao_lite(0.0f, 20.0f, 10.0f, 0.5f, 0.2f);
    TEST_ASSERT_TRUE_MESSAGE(one_edge > corner && one_edge < 1.0f, "single edge partially lit");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f,
                                     r2d_world_render_ao_lite(0.0f, 0.0f, 0.0f, 1.0f, 1.0f),
                                     "zero width disables AO");
}

static void test_sky_layers_and_sun(void)
{
    R2DWorldRenderFeatures f;
    r2d_world_render_defaults(&f);
    float parallax = 0.0f, scale = 0.0f, offset = 0.0f, alpha = 0.0f;
    r2d_world_render_sky_layer(0, &f, &parallax, &scale, &offset, &alpha);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.05f, parallax, "layer 0 parallax");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.00f, scale, "layer 0 scale");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, alpha, "layer 0 alpha");
    f.sky_layer_count = 4;
    r2d_world_render_sky_layer(3, &f, &parallax, &scale, &offset, &alpha);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.35f, parallax, "layer 3 parallax");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.60f, scale, "layer 3 scale");

    f.sky_layer_count = 2;
    parallax = 7.0f;
    r2d_world_render_sky_layer(2, &f, &parallax, &scale, &offset, &alpha);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, parallax, "disabled layer returns zero");
    r2d_world_render_sky_layer(0, NULL, &parallax, &scale, &offset, &alpha);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, parallax, "NULL config returns zero");

    float dir[3];
    r2d_world_render_sun_direction(0.0f, 0.0f, dir);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, dir[0], "sun azimuth 0 points +x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, dir[1], "sun y is zero");
    r2d_world_render_sun_direction(0.0f, PI_F * 0.5f, dir);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, dir[2], "sun elevation pi/2 points up");
    r2d_world_render_sun_direction(0.3f, 0.4f, dir);
    float len = sqrtf(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, len, "sun direction is unit length");
}

static void test_liquid_uv(void)
{
    R2DWorldRenderFeatures f;
    r2d_world_render_defaults(&f);
    float uv_a[2], uv_b[2], uv_t[2];
    float foam_a = 0.0f, foam_b = 0.0f;
    r2d_world_render_liquid_uv(0.25f, 0.75f, 0.0f, &f, uv_a, &foam_a);
    r2d_world_render_liquid_uv(0.25f, 0.75f, 0.0f, &f, uv_b, &foam_b);
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(uv_a[0], uv_b[0], "liquid UV deterministic");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(foam_a, foam_b, "liquid foam deterministic");
    TEST_ASSERT_TRUE_MESSAGE(foam_a >= 0.0f && foam_a <= 1.0f, "foam in [0,1]");
    r2d_world_render_liquid_uv(0.25f, 0.75f, 1.7f, &f, uv_t, NULL);
    TEST_ASSERT_TRUE_MESSAGE(uv_t[0] != uv_a[0] || uv_t[1] != uv_a[1],
                             "liquid scroll changes UV");

    f.liquid_distortion = 0.0f;
    r2d_world_render_liquid_uv(0.25f, 0.75f, 2.0f, &f, uv_t, NULL);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, uv_t[0], "zero distortion keeps u");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.75f, uv_t[1], "zero distortion keeps v");
    r2d_world_render_liquid_uv(NAN, 0.0f, NAN, &f, uv_t, &foam_a);
    TEST_ASSERT_TRUE_MESSAGE(isfinite(uv_t[0]) && isfinite(foam_a), "NaN liquid input safe");
}

static void test_counters_reset(void)
{
    R2DWorldRenderCounters c;
    memset(&c, 0xff, sizeof(c));
    r2d_world_render_counters_reset(&c);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, c.contact_shadows, "counter reset");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, c.sky_layers, "sky counter reset");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, c.haze_surfaces, "haze counter reset");
    r2d_world_render_counters_reset(NULL);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_defaults);
    RUN_TEST(test_quality_presets);
    RUN_TEST(test_validate_clamps_and_nan);
    RUN_TEST(test_hash_deterministic);
    RUN_TEST(test_contact_alpha_falloff);
    RUN_TEST(test_foot_ao);
    RUN_TEST(test_fog_and_haze);
    RUN_TEST(test_material_variation);
    RUN_TEST(test_edge_alpha);
    RUN_TEST(test_ao_lite);
    RUN_TEST(test_sky_layers_and_sun);
    RUN_TEST(test_liquid_uv);
    RUN_TEST(test_counters_reset);
    return UNITY_END();
}
