#include "re2d_world_post.h"
#include "re2d_world_render_features.h"
#include "re2d_world_sky.h"
#include "unity.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Deterministic native render regression harness (roadmap sections 133-134).
// A tiny 64x64 reference frame is composed from the same P4 sky/ambient/post
// math the renderer consumes, then hashed and compared against a stored 8x8
// tolerance grid. No GPU device, no Python, no external image library.

void setUp(void) {}
void tearDown(void) {}

#define W 64
#define H 64

static uint32_t fnv(const uint8_t *p, size_t bytes)
{
    uint32_t h = 2166136261u;
    for (size_t i = 0; i < bytes; ++i) h = (h ^ p[i]) * 16777619u;
    return h;
}

static void render_reference(uint8_t out[W * H * 4], bool bloom, bool heat,
                             int sky_layer_count)
{
    R2DWorldAmbientField field;
    float floor_h[16], ceiling_h[16];
    for (int i = 0; i < 16; ++i) {
        floor_h[i] = 0.0f;
        ceiling_h[i] = (i % 4 == 0) ? 40.0f : 420.0f;
    }
    const float sky_rgb[3] = {0.72f, 0.84f, 1.0f};
    TEST_ASSERT_TRUE(r2d_world_ambient_bake(&field, -100, -100, 200, 200, 4, 4,
                                            floor_h, ceiling_h, sky_rgb, 0.65f));
    R2DWorldSky sky;
    TEST_ASSERT_TRUE(r2d_world_sky_profile(R2D_SKY_PROFILE_DUSK, &sky));
    sky.layer_count = sky_layer_count;
    float sun_dir[3], sun_visible = 0, sun_size = 0, sun_glow = 0;
    uint32_t sun_color = 0;
    r2d_world_sky_celestial(&sky, false, sun_dir, &sun_visible, &sun_size, &sun_glow, &sun_color);

    for (int y = 0; y < H; ++y) {
        for (int x = 0; x < W; ++x) {
            float u = (x + 0.5f) / W, v = (y + 0.5f) / H;
            float ambient[3], ao = 0;
            float wx = (u - 0.5f) * 200.0f, wy = (0.5f - v) * 200.0f;
            r2d_world_ambient_sample(&field, wx, wy, ambient, &ao);
            float r = sky.panorama_tint & 255, g = (sky.panorama_tint >> 8) & 255, b = (sky.panorama_tint >> 16) & 255;
            float base[3] = {r / 255.0f, g / 255.0f, b / 255.0f};
            for (int layer = 0; layer < sky_layer_count; ++layer) {
                float uv[2]; uint32_t tint = 0; float alpha = 0;
                r2d_world_sky_layer_sample(&sky, layer, (u - 0.5f) * 1.5f, 2.0f, uv, &tint, &alpha);
                float band = 0.5f + 0.5f * sinf(uv[0] * 6.2831853f + uv[1] * 3.0f);
                float lr = (tint & 255) / 255.0f, lg = ((tint >> 8) & 255) / 255.0f, lb = ((tint >> 16) & 255) / 255.0f;
                float k = alpha * band * 0.35f;
                base[0] = base[0] * (1.0f - k) + lr * k;
                base[1] = base[1] * (1.0f - k) + lg * k;
                base[2] = base[2] * (1.0f - k) + lb * k;
            }
            float sx = (u - 0.5f) * 2.0f, sy = (0.5f - v) * 2.0f;
            float ddx = sx - sun_dir[0], ddy = sy - sun_dir[1];
            float disc = sun_visible > 0.5f ? expf(-(ddx * ddx + ddy * ddy) / fmaxf(sun_size * sun_size, 0.0001f)) : 0.0f;
            base[0] += disc * 3.2f * ((sun_color & 255) / 255.0f);
            base[1] += disc * 3.2f * (((sun_color >> 8) & 255) / 255.0f);
            base[2] += disc * 3.2f * (((sun_color >> 16) & 255) / 255.0f);
            for (int c = 0; c < 3; ++c) base[c] = base[c] * ambient[c] * (1.0f - ao * 0.45f);
            int i = (y * W + x) * 4;
            out[i] = (uint8_t)fminf(255.0f, fmaxf(0.0f, base[0] * 255.0f + 0.5f));
            out[i + 1] = (uint8_t)fminf(255.0f, fmaxf(0.0f, base[1] * 255.0f + 0.5f));
            out[i + 2] = (uint8_t)fminf(255.0f, fmaxf(0.0f, base[2] * 255.0f + 0.5f));
            out[i + 3] = 255;
        }
    }
    R2DWorldPostConfig post;
    r2d_world_post_defaults(&post);
    post.bloom = bloom;
    post.heat = heat;
    post.heat_strength = 0.004f;
    static uint8_t bloomed[W * H * 4], heated[W * H * 4];
    if (bloom) {
        r2d_world_post_reference_bloom(out, W, H, &post, bloomed);
        memcpy(out, bloomed, sizeof(bloomed));
    }
    if (heat) {
        r2d_world_post_reference_heat(out, W, H, &post, 1.7f, NULL, heated);
        memcpy(out, heated, sizeof(heated));
    }
}

static void downsample(const uint8_t *src, float out[8 * 8 * 3])
{
    for (int by = 0; by < 8; ++by) for (int bx = 0; bx < 8; ++bx) {
        float sum[3] = {0, 0, 0};
        for (int y = 0; y < H / 8; ++y) for (int x = 0; x < W / 8; ++x) {
            int i = ((by * (H / 8) + y) * W + bx * (W / 8) + x) * 4;
            sum[0] += src[i]; sum[1] += src[i + 1]; sum[2] += src[i + 2];
        }
        int n = (H / 8) * (W / 8);
        int o = (by * 8 + bx) * 3;
        out[o] = sum[0] / n; out[o + 1] = sum[1] / n; out[o + 2] = sum[2] / n;
    }
}

static const uint32_t GOLDEN_HASH = 784661284u;
static const float GOLDEN_GRID[8 * 8 * 3] = {
    46.00,40.00,33.00,60.66,53.33,45.00,94.41,84.62,71.86,113.00,102.00,87.00,
    113.88,102.00,87.00,114.00,102.75,87.00,114.00,103.00,87.00,114.00,103.00,87.00,
    46.00,40.00,33.00,59.95,52.62,44.30,93.69,83.91,71.14,112.98,101.98,86.98,
    113.88,102.00,87.00,114.00,102.75,87.00,114.00,103.00,87.00,114.00,103.00,87.00,
    46.00,40.00,33.00,60.53,53.16,44.78,94.20,84.45,71.70,113.00,102.00,87.00,
    113.88,102.00,87.00,114.00,102.75,87.00,114.00,103.00,87.00,114.00,103.00,87.00,
    59.45,50.78,41.67,60.16,52.73,44.31,93.77,84.05,71.31,112.98,101.98,86.98,
    113.88,102.00,87.00,114.00,102.75,87.00,114.00,103.00,87.00,114.00,103.00,87.00,
    46.00,40.00,33.00,60.39,52.97,44.55,94.02,84.30,71.56,113.00,102.00,87.00,
    113.88,102.00,87.00,114.00,102.75,87.00,114.00,103.00,87.00,114.00,103.00,87.00,
    46.00,40.00,33.00,60.30,52.92,44.55,93.97,84.22,71.47,113.00,102.00,87.00,
    113.88,102.00,87.00,114.00,102.75,87.00,114.00,103.00,87.00,114.00,103.00,87.00,
    46.00,40.00,33.00,60.17,52.80,44.42,93.84,84.09,71.34,112.98,101.98,86.98,
    113.88,102.00,87.00,114.00,102.75,87.00,114.00,103.00,87.00,114.00,103.00,87.00,
    46.00,40.00,33.00,60.53,53.16,44.78,94.20,84.45,71.70,113.00,102.00,87.00,
    113.88,102.00,87.00,114.00,102.75,87.00,114.00,103.00,87.00,114.00,103.00,87.00,
};

static uint32_t g_hash;
static float g_golden[8 * 8 * 3];

static void test_reference_frame_hash_and_tolerance(void)
{
    static uint8_t frame[W * H * 4];
    render_reference(frame, true, true, 4);
    g_hash = fnv(frame, sizeof(frame));
    downsample(frame, g_golden);
    if (getenv("R2D_PRINT_GOLDEN")) {
        printf("GOLDEN_HASH=%u\n", g_hash);
        printf("GOLDEN_GRID={");
        for (int i = 0; i < 8 * 8 * 3; ++i) printf("%.2f%s", g_golden[i], i == 8 * 8 * 3 - 1 ? "" : ",");
        printf("}\n");
    }
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(GOLDEN_HASH, g_hash,
                                     "reference frame hash matches the stored baseline");
    for (int i = 0; i < 8 * 8 * 3; ++i)
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(1.5f, GOLDEN_GRID[i], g_golden[i],
                                         "8x8 reference grid within tolerance");
    static uint8_t again[W * H * 4];
    render_reference(again, true, true, 4);
    TEST_ASSERT_EQUAL_UINT32(g_hash, fnv(again, sizeof(again)));
}

static void test_feature_toggles_change_reference(void)
{
    static uint8_t bloomed[W * H * 4], plain[W * H * 4];
    render_reference(bloomed, true, true, 4);
    render_reference(plain, false, false, 4);
    TEST_ASSERT_TRUE_MESSAGE(fnv(bloomed, sizeof(bloomed)) != fnv(plain, sizeof(plain)),
                             "bloom+heat change the reference frame");
    static uint8_t bloom_only[W * H * 4];
    render_reference(bloom_only, true, false, 4);
    TEST_ASSERT_TRUE(fnv(bloom_only, sizeof(bloom_only)) != fnv(plain, sizeof(plain)));
    static uint8_t one_layer[W * H * 4];
    render_reference(one_layer, true, true, 1);
    TEST_ASSERT_TRUE_MESSAGE(fnv(one_layer, sizeof(one_layer)) != fnv(bloomed, sizeof(bloomed)),
                             "sky layer count changes the reference frame");
    // Tolerance compare of the full pipeline against itself is exact; the 8x8
    // grid is the stable golden data for cross-build comparison.
    float grid[8 * 8 * 3];
    downsample(bloomed, grid);
    for (int i = 0; i < 8 * 8 * 3; ++i)
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(1.5f, g_golden[i], grid[i],
                                         "pipeline grid matches itself within tolerance");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_reference_frame_hash_and_tolerance);
    RUN_TEST(test_feature_toggles_change_reference);
    return UNITY_END();
}
