// Стресс динамических реестров Re2D: материалы, свет, декали (§12-15).
//
// Бывшие compile-time потолки (64 материала, 128 света, 128 декалей) были
// размером массива, а не бюджетом мира. Здесь проверяем, что создание сотен и
// тысяч объектов проходит, а ограничена только дорогая часть кадра:
// 16 света на span, 16 теней, бюджет рендера декалей — с детерминированным
// вытеснением, а не отказом контента.
#include "re2d_world.h"

#include "unity.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static R2DRe2dWorld make_world(void)
{
    // Клетка, а не только span: декали живут на surfaces, а surface появляется
    // из cell-топологии (как в decal2_test).
    const R2DWorldSpan span = { 0, 0, 64, 64, 0, 96, 0xff404040, 0xff606060 };
    const R2DWorldCell cell = { 0, 0, 64, 64, 0, 1 };
    R2DRe2dWorld w;
    memset(&w, 0, sizeof w);
    char err[128] = {0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build_cells(&w, NULL, 0, &span, 1, &cell, 1,
                                                   NULL, 0, NULL, 0, err, sizeof err),
                             "мир не собрался");
    return w;
}

static void test_materials_beyond_64(void)
{
    R2DRe2dWorld w = make_world();
    uint8_t pixel[4] = { 255, 255, 255, 255 };
    int made = 0;
    for (int i = 0; i < 256; ++i) {
        R2DWorldMaterial m;
        memset(&m, 0, sizeof m);
        snprintf(m.name, sizeof m.name, "mat-%d", i);
        m.albedo.pixels = pixel;
        m.albedo.width = m.albedo.height = 1;
        m.u_scale = m.v_scale = 1.0f;
        if (r2d_world_material_set(&w, &m) >= 0) made++;
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(256, made, "материалов сверх 64 должно создаваться 256");
    TEST_ASSERT_TRUE(w.material_count >= 256);
    TEST_ASSERT_TRUE(w.material_capacity >= 256);
    r2d_world_free(&w);
}

static void test_lights_beyond_128(void)
{
    R2DRe2dWorld w = make_world();
    R2DWorldLight l;
    memset(&l, 0, sizeof l);
    l.x = 0; l.y = 0; l.h = 10; l.radius = 20; l.intensity = 1.0f;
    l.r = 1.0f; l.g = 0.8f; l.b = 0.6f; l.shadow = true;
    int made = 0;
    for (int i = 0; i < 1000; ++i) {
        l.x = (float)(i % 10) * 4.0f;
        l.y = (float)(i / 10) * 4.0f;
        if (r2d_world_light_create(&w, &l) >= 0) made++;
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(1000, made, "свет сверх 128 должен создаваться");
    TEST_ASSERT_EQUAL_INT(1000, w.light_count);
    TEST_ASSERT_TRUE(w.light_capacity >= 1000);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_light_rebuild(&w), "rebuild после 1000 света");
    // Бюджеты шейдера/теней остаются бюджетами, а не потолками мира.
    for (int s = 0; s < w.span_count; ++s) {
        TEST_ASSERT_TRUE(w.span_light_counts[s] <= R2D_WORLD_LIGHTS_PER_SPAN);
    }
    int shadows = 0;
    for (int i = 0; i < w.light_capacity; ++i) if (w.shadow_mask[i]) shadows++;
    TEST_ASSERT_TRUE(shadows <= R2D_WORLD_MAX_SHADOWS);
    r2d_world_free(&w);
}

static void test_decals_beyond_budget(void)
{
    R2DRe2dWorld w = make_world();
    uint8_t pixel[4] = { 200, 100, 50, 255 };
    R2DWorldMaterial m;
    memset(&m, 0, sizeof m);
    snprintf(m.name, sizeof m.name, "%s", "decal-mat");
    m.albedo.pixels = pixel;
    m.albedo.width = m.albedo.height = 1;
    m.u_scale = m.v_scale = 1.0f;
    const int mat = r2d_world_material_set(&w, &m);
    TEST_ASSERT_TRUE(mat >= 0);
    // Бюджет рендера поднимаем, чтобы проверить именно РОСТ хранилища:
    // по умолчанию (128) неактивные слоты переиспользуются и capacity не растёт.
    TEST_ASSERT_EQUAL_INT(512, r2d_world_decal_budget(&w, 512));
    R2DWorldDecal d;
    memset(&d, 0, sizeof d);
    d.surface = 0; d.material = mat; d.u = 8; d.v = 8; d.w = 32; d.h = 32;
    d.remaining = 10.0f;
    int made = 0;
    for (int i = 0; i < 2000; ++i) {
        if (r2d_world_decal_create(&w, &d) >= 0) made++;
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(2000, made, "декали сверх 128 должны создаваться");
    TEST_ASSERT_TRUE_MESSAGE(w.decal_count <= 512, "активных декалей не больше бюджета");
    TEST_ASSERT_TRUE_MESSAGE(w.decal_evicted > 0, "переполнение бюджета вытесняет детерминированно");
    TEST_ASSERT_TRUE_MESSAGE(w.decal_capacity >= 512, "хранилище декалей выросло под бюджет");
    r2d_world_free(&w);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_materials_beyond_64);
    RUN_TEST(test_lights_beyond_128);
    RUN_TEST(test_decals_beyond_budget);
    return UNITY_END();
}
