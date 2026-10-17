#include "re2d_world_post.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-5f

static uint32_t hash_image(const uint8_t *pixels, size_t bytes)
{
    uint32_t h = 2166136261u;
    for (size_t i = 0; i < bytes; ++i) h = (h ^ pixels[i]) * 16777619u;
    return h;
}

static void test_defaults_and_validate(void)
{
    R2DWorldPostConfig c;
    memset(&c, 0xcd, sizeof(c));
    r2d_world_post_defaults(&c);
    TEST_ASSERT_TRUE(c.bloom && c.heat);
    TEST_ASSERT_FALSE(c.reflection);
    TEST_ASSERT_EQUAL_INT(8, c.bloom_taps);
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_post_validate(NULL), "NULL config rejected");

    c.bloom_threshold = NAN;
    c.bloom_knee = -1;
    c.bloom_intensity = 9;
    c.bloom_radius = 3;
    c.bloom_taps = 99;
    c.heat_strength = 1;
    c.heat_frequency = -4;
    c.heat_depth_scale = 0;
    TEST_ASSERT_TRUE(r2d_world_post_validate(&c));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.68f, c.bloom_threshold);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.001f, c.bloom_knee);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 4.0f, c.bloom_intensity);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.25f, c.bloom_radius);
    TEST_ASSERT_EQUAL_INT(8, c.bloom_taps);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.05f, c.heat_strength);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, c.heat_frequency);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.001f, c.heat_depth_scale);
}

static void test_bloom_weight_and_taps(void)
{
    R2DWorldPostConfig c;
    r2d_world_post_defaults(&c);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, r2d_world_post_bloom_weight(0.2f, &c));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, r2d_world_post_bloom_weight(c.bloom_threshold, &c));
    float mid = r2d_world_post_bloom_weight(c.bloom_threshold + c.bloom_knee * 0.5f, &c);
    TEST_ASSERT_TRUE(mid > 0.0f && mid < 1.0f);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, r2d_world_post_bloom_weight(1.0f, &c));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, r2d_world_post_bloom_weight(NAN, &c));

    float xy[2], previous_x = 0, previous_y = 0;
    for (int i = 0; i < c.bloom_taps; ++i) {
        TEST_ASSERT_TRUE(r2d_world_post_bloom_tap(&c, i, xy));
        TEST_ASSERT_TRUE(xy[0] >= -1.0f && xy[0] <= 1.0f && xy[1] >= -1.0f && xy[1] <= 1.0f);
        if (i) TEST_ASSERT_TRUE(xy[0] != previous_x || xy[1] != previous_y);
        previous_x = xy[0]; previous_y = xy[1];
    }
    TEST_ASSERT_FALSE(r2d_world_post_bloom_tap(&c, c.bloom_taps, xy));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, xy[0]);
    c.bloom = false;
    TEST_ASSERT_FALSE(r2d_world_post_bloom_tap(&c, 0, xy));
}

static void test_reflection_and_heat_math(void)
{
    float uv[2], weight = 0;
    r2d_world_post_reflection_uv(0.25f, 0.20f, 0.1f, 0.0f, 1.0f, uv, &weight);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.25f, uv[0]);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.80f, uv[1], "reflection mirrors v");
    TEST_ASSERT_TRUE_MESSAGE(weight > 0.8f, "grazing view reflects strongly");
    r2d_world_post_reflection_uv(0.25f, 0.20f, 1.0f, 0.0f, 1.0f, uv, &weight);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, weight);
    r2d_world_post_reflection_uv(0.25f, 0.20f, 0.0f, 1.0f, 1.0f, uv, &weight);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, weight);
    r2d_world_post_reflection_uv(NAN, 0.2f, NAN, NAN, NAN, uv, &weight);
    TEST_ASSERT_TRUE(isfinite(uv[0]) && isfinite(uv[1]) && isfinite(weight));

    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f,
                             r2d_world_post_heat_mask(10, 10, 10, 10, 20, 5, 0.4f));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f,
                             r2d_world_post_heat_mask(100, 10, 10, 10, 20, 5, 0.4f));
    float edge = r2d_world_post_heat_mask(10, 14, 10, 10, 20, 5, 0.9f);
    TEST_ASSERT_TRUE(edge > 0.0f && edge < 1.0f);

    R2DWorldPostConfig c;
    r2d_world_post_defaults(&c);
    float out[2];
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f,
                             r2d_world_post_heat_offset(0.5f, 0.5f, 1.0f, 20.0f, 0.0f, &c, out));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.5f, out[0]);
    TEST_ASSERT_TRUE(r2d_world_post_heat_offset(0.5f, 0.5f, 1.0f, 20.0f, 1.0f, &c, out) > 0.0f);
    TEST_ASSERT_TRUE(fabsf(out[0] - 0.5f) <= c.heat_strength + EPS);
    r2d_world_post_heat_offset(0.5f, 0.5f, 1.0f, c.heat_depth_start + c.heat_depth_scale, 1.0f, &c, out);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.5f, out[0]);
    r2d_world_post_heat_offset(NAN, 0.5f, 1.0f, 20.0f, 1.0f, &c, out);
    TEST_ASSERT_TRUE(isfinite(out[0]) && isfinite(out[1]));
}

static void test_reference_bloom_image(void)
{
    enum { W = 64, H = 64 };
    static uint8_t src[W * H * 4], out[W * H * 4], again[W * H * 4];
    memset(src, 0, sizeof(src));
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
        int i = (y * W + x) * 4;
        src[i] = 20; src[i + 1] = 20; src[i + 2] = 24; src[i + 3] = 255;
    }
    for (int y = 30; y < 34; ++y) for (int x = 30; x < 34; ++x) {
        int i = (y * W + x) * 4;
        src[i] = 250; src[i + 1] = 250; src[i + 2] = 250;
    }
    R2DWorldPostConfig c;
    r2d_world_post_defaults(&c);
    r2d_world_post_reference_bloom(src, W, H, &c, out);
    r2d_world_post_reference_bloom(src, W, H, &c, again);
    TEST_ASSERT_EQUAL_INT(0, memcmp(out, again, sizeof(out)));
    int center = (32 * W + 32) * 4;
    TEST_ASSERT_TRUE(out[center] >= src[center]);
    TEST_ASSERT_TRUE_MESSAGE(out[(4 * W + 4) * 4] == src[(4 * W + 4) * 4],
                             "dark far corner is untouched by local bloom");
    TEST_ASSERT_TRUE_MESSAGE(out[center] > src[center] || out[(28 * W + 28) * 4] > src[(28 * W + 28) * 4],
                             "bright pixels bleed into neighbours");
    uint8_t untouched[W * H * 4];
    c.bloom = false;
    r2d_world_post_reference_bloom(src, W, H, &c, untouched);
    TEST_ASSERT_EQUAL_INT(0, memcmp(untouched, src, sizeof(untouched)));
    c.bloom = true;
    c.bloom_intensity = 0.0f;
    r2d_world_post_reference_bloom(src, W, H, &c, untouched);
    TEST_ASSERT_EQUAL_INT(0, memcmp(untouched, src, sizeof(untouched)));
}

static void test_reference_heat_image(void)
{
    enum { W = 48, H = 32 };
    static uint8_t src[W * H * 4], out[W * H * 4], again[W * H * 4];
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
        int i = (y * W + x) * 4;
        src[i] = (uint8_t)(x * 5); src[i + 1] = (uint8_t)(y * 7); src[i + 2] = 90; src[i + 3] = 255;
    }
    static float mask[W * H];
    for (int i = 0; i < W * H; ++i) mask[i] = 0.0f;
    R2DWorldPostConfig c;
    r2d_world_post_defaults(&c);
    r2d_world_post_reference_heat(src, W, H, &c, 1.0f, mask, out);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, memcmp(out, src, sizeof(src)), "zero mask is identity");

    for (int i = 0; i < W * H; ++i) mask[i] = 1.0f;
    r2d_world_post_reference_heat(src, W, H, &c, 1.0f, mask, out);
    r2d_world_post_reference_heat(src, W, H, &c, 1.0f, mask, again);
    TEST_ASSERT_EQUAL_INT(0, memcmp(out, again, sizeof(out)));
    int changed = 0;
    for (int i = 0; i < W * H; ++i) if (memcmp(out + i * 4, src + i * 4, 4)) changed++;
    TEST_ASSERT_TRUE_MESSAGE(changed > 0, "full mask distorts pixels");
    TEST_ASSERT_TRUE(hash_image(out, sizeof(out)) != hash_image(src, sizeof(src)));

    R2DWorldPostCounters counters;
    memset(&counters, 0xff, sizeof(counters));
    r2d_world_post_counters_reset(&counters);
    TEST_ASSERT_EQUAL_INT(0, counters.bloom_taps);
    TEST_ASSERT_EQUAL_INT(0, counters.heat_cards);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_defaults_and_validate);
    RUN_TEST(test_bloom_weight_and_taps);
    RUN_TEST(test_reflection_and_heat_math);
    RUN_TEST(test_reference_bloom_image);
    RUN_TEST(test_reference_heat_image);
    return UNITY_END();
}
