// BASHNYA atlas tranche: shared decoded-image cache (path dedup) and tiled
// atlas-set crops (>4096 logical sheets) — pure atlas module tests.
#include "re2d_world_atlas.h"
#include "unity.h"

#include <stdlib.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static uint8_t *solid(int width, int height, uint8_t r, uint8_t g, uint8_t b, uint8_t a)
{
    uint8_t *pixels = (uint8_t *)malloc((size_t)width * (size_t)height * 4u);
    TEST_ASSERT_NOT_NULL(pixels);
    for (int i = 0; i < width * height; i++) {
        pixels[i * 4 + 0] = r;
        pixels[i * 4 + 1] = g;
        pixels[i * 4 + 2] = b;
        pixels[i * 4 + 3] = a;
    }
    return pixels;
}

static uint8_t pixel_at(const uint8_t *buffer, int side, int x, int y, int channel)
{
    return buffer[((size_t)y * (size_t)side + (size_t)x) * 4u + (size_t)channel];
}

static void test_image_cache_refcount_and_dedup(void)
{
    R2DWorldAtlasImageCache cache;
    memset(&cache, 0, sizeof cache);
    uint8_t *pixels = solid(16, 8, 10, 20, 30, 255);
    R2DWorldAtlasImage *image = r2d_world_atlas_image_add(&cache, "/app/a.png", "a.png",
                                                          pixels, 16, 8, 1);
    TEST_ASSERT_NOT_NULL(image);
    TEST_ASSERT_EQUAL_INT(1, image->refs);
    TEST_ASSERT_EQUAL_INT(1, cache.count);
    TEST_ASSERT_EQUAL_UINT64(16u * 8u * 4u, r2d_world_atlas_image_cache_bytes(&cache));
    TEST_ASSERT_EQUAL_UINT64(0, r2d_world_atlas_image_cache_saved(&cache));

    // Second registration of the same canonical path shares the pixels.
    R2DWorldAtlasImage *shared = r2d_world_atlas_image_find(&cache, "/app/a.png", 1);
    TEST_ASSERT_EQUAL_PTR(image, shared);
    shared->refs++;
    TEST_ASSERT_EQUAL_INT(2, shared->refs);
    TEST_ASSERT_EQUAL_UINT64(16u * 8u * 4u, r2d_world_atlas_image_cache_bytes(&cache));
    TEST_ASSERT_EQUAL_UINT64(16u * 8u * 4u, r2d_world_atlas_image_cache_saved(&cache));

    // Different canonical path stays separate.
    uint8_t *other_pixels = solid(4, 4, 1, 2, 3, 255);
    R2DWorldAtlasImage *other = r2d_world_atlas_image_add(&cache, "/app/b.png", "b.png",
                                                          other_pixels, 4, 4, 1);
    TEST_ASSERT_NOT_NULL(other);
    TEST_ASSERT_EQUAL_INT(2, cache.count);
    TEST_ASSERT_EQUAL_UINT64(16u * 8u * 4u + 4u * 4u * 4u,
                             r2d_world_atlas_image_cache_bytes(&cache));

    // Same path in a newer generation is not reused (hot reload re-decodes).
    TEST_ASSERT_NULL(r2d_world_atlas_image_find(&cache, "/app/a.png", 2));

    // Unregister releases: the shared buffer lives until the last reference.
    r2d_world_atlas_image_release(&cache, shared);
    TEST_ASSERT_EQUAL_INT(1, shared->refs);
    TEST_ASSERT_EQUAL_UINT64(16u * 8u * 4u + 4u * 4u * 4u,
                             r2d_world_atlas_image_cache_bytes(&cache));
    TEST_ASSERT_EQUAL_UINT64(0, r2d_world_atlas_image_cache_saved(&cache));
    r2d_world_atlas_image_release(&cache, shared);
    TEST_ASSERT_EQUAL_INT(1, cache.count);  // only /app/b.png remains
    TEST_ASSERT_EQUAL_UINT64(4u * 4u * 4u, r2d_world_atlas_image_cache_bytes(&cache));
    r2d_world_atlas_image_cache_free(&cache);
    TEST_ASSERT_EQUAL_INT(0, cache.count);
}

static R2DWorldAtlasTile tiles_2x2[4];
static uint8_t tile_data[4][8 * 8 * 4];

static void build_2x2_tiles(void)
{
    // Four 8x8 tiles; each tile has a unique colour so a crop can be attributed
    // to the tile it came from. Logical sheet = 16x16.
    const uint8_t colours[4][3] = {{255, 0, 0}, {0, 255, 0}, {0, 0, 255}, {255, 255, 0}};
    for (int t = 0; t < 4; t++) {
        for (int i = 0; i < 8 * 8; i++) {
            tile_data[t][i * 4 + 0] = colours[t][0];
            tile_data[t][i * 4 + 1] = colours[t][1];
            tile_data[t][i * 4 + 2] = colours[t][2];
            tile_data[t][i * 4 + 3] = 255;
        }
        tiles_2x2[t].pixels = tile_data[t];
        tiles_2x2[t].width = 8;
        tiles_2x2[t].height = 8;
    }
}

static void test_tiled_crop_across_boundary(void)
{
    build_2x2_tiles();
    uint8_t buffer[16 * 16 * 4];
    // 8x8 cell starting at logical x=4,y=4: it straddles all four tiles.
    TEST_ASSERT_TRUE(r2d_world_atlas_crop_tiled(tiles_2x2, 4, 2, 2, 8, 8,
                                                16, 16, 4, 4, 8, 8, false,
                                                8, 0, 0, buffer));
    // Top-left quadrant comes from tile (0,0) red, top-right from (1,0) green,
    // bottom-left from (0,1) blue, bottom-right from (1,1) yellow.
    TEST_ASSERT_EQUAL_INT(255, pixel_at(buffer, 8, 0, 0, 0));
    TEST_ASSERT_EQUAL_INT(0, pixel_at(buffer, 8, 0, 0, 1));
    TEST_ASSERT_EQUAL_INT(0, pixel_at(buffer, 8, 7, 0, 0));
    TEST_ASSERT_EQUAL_INT(255, pixel_at(buffer, 8, 7, 0, 1));
    TEST_ASSERT_EQUAL_INT(0, pixel_at(buffer, 8, 0, 7, 0));
    TEST_ASSERT_EQUAL_INT(255, pixel_at(buffer, 8, 0, 7, 2));
    TEST_ASSERT_EQUAL_INT(255, pixel_at(buffer, 8, 7, 7, 0));
    TEST_ASSERT_EQUAL_INT(255, pixel_at(buffer, 8, 7, 7, 1));

    // Flipped crop of the same cell: left column now comes from logical right.
    TEST_ASSERT_TRUE(r2d_world_atlas_crop_tiled(tiles_2x2, 4, 2, 2, 8, 8,
                                                16, 16, 4, 4, 8, 8, true,
                                                8, 0, 0, buffer));
    TEST_ASSERT_EQUAL_INT(255, pixel_at(buffer, 8, 0, 0, 1));  // green (tile 1,0) flip
    TEST_ASSERT_EQUAL_INT(255, pixel_at(buffer, 8, 7, 0, 0));  // red   (tile 0,0) flip
    TEST_ASSERT_EQUAL_INT(255, pixel_at(buffer, 8, 7, 7, 2));  // blue  (tile 0,1) flip
    TEST_ASSERT_EQUAL_INT(255, pixel_at(buffer, 8, 0, 7, 0));  // yellow (tile 1,1) flip
}

static void test_tiled_crop_validation(void)
{
    build_2x2_tiles();
    uint8_t buffer[16 * 16 * 4];
    // Ragged set: tile grid 2x2 but three tiles.
    TEST_ASSERT_FALSE(r2d_world_atlas_crop_tiled(tiles_2x2, 3, 2, 2, 8, 8, 16, 16,
                                                 0, 0, 8, 8, false, 8, 0, 0, buffer));
    // Wrong logical size (must equal tile columns*width x rows*height).
    TEST_ASSERT_FALSE(r2d_world_atlas_crop_tiled(tiles_2x2, 4, 2, 2, 8, 8, 15, 16,
                                                 0, 0, 8, 8, false, 8, 0, 0, buffer));
    // Cell outside the logical sheet.
    TEST_ASSERT_FALSE(r2d_world_atlas_crop_tiled(tiles_2x2, 4, 2, 2, 8, 8, 16, 16,
                                                 12, 0, 8, 8, false, 8, 0, 0, buffer));
    // Tile with the wrong dimensions.
    R2DWorldAtlasTile broken[4];
    memcpy(broken, tiles_2x2, sizeof broken);
    broken[2].width = 7;
    TEST_ASSERT_FALSE(r2d_world_atlas_crop_tiled(broken, 4, 2, 2, 8, 8, 16, 16,
                                                 0, 0, 8, 8, false, 8, 0, 0, buffer));
    TEST_ASSERT_FALSE(r2d_world_atlas_crop_tiled(NULL, 4, 2, 2, 8, 8, 16, 16,
                                                 0, 0, 8, 8, false, 8, 0, 0, buffer));
    // Buffer untouched on invalid input is not asserted; returns false is the
    // contract (no silent fallback to a partial crop).
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_image_cache_refcount_and_dedup);
    RUN_TEST(test_tiled_crop_across_boundary);
    RUN_TEST(test_tiled_crop_validation);
    return UNITY_END();
}
