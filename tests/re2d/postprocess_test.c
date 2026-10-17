#include "re2d_postprocess.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-5f
#define PI 3.14159265358979323846f

static bool float_bits_equal(float a, float b)
{
    return memcmp(&a, &b, sizeof a) == 0;
}

static void assert_neutral(const R2DPostUniforms *u)
{
    for (int c = 0; c < 3; c++) {
        TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, u->color_scale[c]);
        TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, u->color_add[c]);
    }
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, u->vignette);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, u->flash);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, u->pixel_size);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, u->chroma);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, u->bloom);
    for (int c = 0; c < 4; c++) TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, u->tint[c]);
}

static void test_init_neutral(void)
{
    R2DPostStack stack;
    memset(&stack, 0xff, sizeof stack);
    r2d_postprocess_init(&stack);

    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, stack.time);
    for (int i = 0; i < R2D_POST_COUNT; i++) {
        TEST_ASSERT_EQUAL_INT(i, stack.order[i]);
        TEST_ASSERT_FALSE(stack.effects[i].enabled);
        TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, stack.effects[i].strength);
        TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, stack.effects[R2D_POST_PIXELATE].extra0);
    }

    R2DPostUniforms u;
    memset(&u, 0x5a, sizeof u);
    r2d_postprocess_eval(&stack, &u);
    assert_neutral(&u);

    // NULL stack still yields neutral uniforms; NULL out is ignored.
    memset(&u, 0x5a, sizeof u);
    r2d_postprocess_eval(NULL, &u);
    assert_neutral(&u);
    r2d_postprocess_eval(&stack, NULL);
}

static void test_set_enable_and_disabled_neutral(void)
{
    R2DPostStack stack;
    r2d_postprocess_init(&stack);

    TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, R2D_POST_GRADE, 2.0f,
                                         0.5f, 0.25f, 0.0f, 1.0f, 0.0f, 0.0f));
    TEST_ASSERT_FALSE(stack.effects[R2D_POST_GRADE].enabled);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 2.0f, stack.effects[R2D_POST_GRADE].strength);

    R2DPostUniforms u;
    r2d_postprocess_eval(&stack, &u);
    assert_neutral(&u);

    TEST_ASSERT_TRUE(r2d_postprocess_enable(&stack, R2D_POST_GRADE, true));
    r2d_postprocess_eval(&stack, &u);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 2.0f, u.color_scale[0]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.5f, u.color_scale[1]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, u.color_scale[2]);

    TEST_ASSERT_TRUE(r2d_postprocess_enable(&stack, R2D_POST_GRADE, false));
    r2d_postprocess_eval(&stack, &u);
    assert_neutral(&u);

    // Every effect configured but disabled is still a neutral frame.
    for (int i = 0; i < R2D_POST_COUNT; i++) {
        TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, i, 1.0f,
                                             1.0f, 1.0f, 1.0f, 1.0f, 8.0f, 0.5f));
        TEST_ASSERT_TRUE(r2d_postprocess_enable(&stack, i, false));
    }
    r2d_postprocess_eval(&stack, &u);
    assert_neutral(&u);
}

static void test_parameter_clamping(void)
{
    R2DPostStack stack;
    r2d_postprocess_init(&stack);

    TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, R2D_POST_GRADE, 9.0f,
                                         -1.0f, 2.0f, 0.5f, -3.0f, 0.0f, 0.0f));
    const R2DPostEffect *grade = &stack.effects[R2D_POST_GRADE];
    TEST_ASSERT_FLOAT_WITHIN(EPS, 4.0f, grade->strength);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, grade->r);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, grade->g);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.5f, grade->b);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, grade->a);

    TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, R2D_POST_PIXELATE, -5.0f,
                                         0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, stack.effects[R2D_POST_PIXELATE].strength);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, stack.effects[R2D_POST_PIXELATE].extra0);

    TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, R2D_POST_PIXELATE, 1.0f,
                                         0.0f, 0.0f, 0.0f, 0.0f, 99.0f, 0.0f));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 16.0f, stack.effects[R2D_POST_PIXELATE].extra0);

    // Non-finite parameters are rejected and leave the effect untouched.
    R2DPostEffect before = stack.effects[R2D_POST_PIXELATE];
    TEST_ASSERT_FALSE(r2d_postprocess_set(&stack, R2D_POST_PIXELATE, NAN,
                                          0.0f, 0.0f, 0.0f, 0.0f, 4.0f, 0.0f));
    TEST_ASSERT_FALSE(r2d_postprocess_set(&stack, R2D_POST_PIXELATE, 1.0f,
                                          INFINITY, 0.0f, 0.0f, 0.0f, 4.0f, 0.0f));
    TEST_ASSERT_EQUAL_INT(0, memcmp(&before, &stack.effects[R2D_POST_PIXELATE],
                                    sizeof before));
}

static void test_flash_decay(void)
{
    R2DPostStack stack;
    r2d_postprocess_init(&stack);
    TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, R2D_POST_FLASH, 1.0f,
                                         1.0f, 0.5f, 0.25f, 1.0f, 1.0f, 0.0f));
    TEST_ASSERT_TRUE(r2d_postprocess_enable(&stack, R2D_POST_FLASH, true));

    r2d_postprocess_step(&stack, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.25f, stack.time);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.75f, stack.effects[R2D_POST_FLASH].strength);

    R2DPostUniforms u;
    r2d_postprocess_eval(&stack, &u);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.75f, u.flash);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.75f, u.color_add[0]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.375f, u.color_add[1]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.1875f, u.color_add[2]);

    // dt is clamped: a 1 s request only advances 0.25 s.
    r2d_postprocess_step(&stack, 1.0f);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.5f, stack.time);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.5f, stack.effects[R2D_POST_FLASH].strength);
    r2d_postprocess_step(&stack, 10.0f);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.25f, stack.effects[R2D_POST_FLASH].strength);
    r2d_postprocess_step(&stack, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, stack.effects[R2D_POST_FLASH].strength);
    r2d_postprocess_step(&stack, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, stack.effects[R2D_POST_FLASH].strength);

    // extra0 == 0 uses the documented default decay of 2.0 per second.
    R2DPostStack fast;
    r2d_postprocess_init(&fast);
    r2d_postprocess_set(&fast, R2D_POST_FLASH, 1.0f, 1.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f);
    r2d_postprocess_enable(&fast, R2D_POST_FLASH, true);
    r2d_postprocess_step(&fast, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.5f, fast.effects[R2D_POST_FLASH].strength);

    // Disabled flash does not decay.
    R2DPostStack off;
    r2d_postprocess_init(&off);
    r2d_postprocess_set(&off, R2D_POST_FLASH, 1.0f, 1.0f, 0.0f, 0.0f, 1.0f, 1.0f, 0.0f);
    r2d_postprocess_step(&off, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, off.effects[R2D_POST_FLASH].strength);
}

static void test_tint_pulse(void)
{
    R2DPostStack stack;
    r2d_postprocess_init(&stack);
    TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, R2D_POST_TINT, 0.5f,
                                         0.5f, 0.5f, 0.5f, 0.5f, 1.0f, 0.5f));
    TEST_ASSERT_TRUE(r2d_postprocess_enable(&stack, R2D_POST_TINT, true));

    R2DPostUniforms u;
    r2d_postprocess_eval(&stack, &u);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.25f, u.tint[0]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.25f, u.tint[3]);

    // time = 0.25 s at 1 Hz -> pulse factor 1.5.
    r2d_postprocess_step(&stack, 0.25f);
    r2d_postprocess_eval(&stack, &u);
    TEST_ASSERT_FLOAT_WITHIN(1e-3f, 0.375f, u.tint[0]);
    TEST_ASSERT_FLOAT_WITHIN(1e-3f, 0.375f, u.tint[1]);
    TEST_ASSERT_FLOAT_WITHIN(1e-3f, 0.375f, u.tint[3]);

    // time = 0.5 s -> sin(pi) = 0 -> base tint.
    r2d_postprocess_step(&stack, 0.25f);
    r2d_postprocess_eval(&stack, &u);
    TEST_ASSERT_FLOAT_WITHIN(1e-3f, 0.25f, u.tint[0]);

    // time = 0.75 s -> pulse factor 0.5.
    r2d_postprocess_step(&stack, 0.25f);
    r2d_postprocess_eval(&stack, &u);
    TEST_ASSERT_FLOAT_WITHIN(1e-3f, 0.125f, u.tint[0]);
    TEST_ASSERT_FLOAT_WITHIN(1e-3f, 0.125f, u.tint[3]);

    // extra0 == 0 disables the pulse.
    R2DPostStack steady;
    r2d_postprocess_init(&steady);
    r2d_postprocess_set(&steady, R2D_POST_TINT, 0.5f,
                        0.5f, 0.5f, 0.5f, 0.5f, 0.0f, 1.0f);
    r2d_postprocess_enable(&steady, R2D_POST_TINT, true);
    r2d_postprocess_step(&steady, 0.75f);
    r2d_postprocess_eval(&steady, &u);
    TEST_ASSERT_FLOAT_WITHIN(1e-3f, 0.25f, u.tint[0]);
}

static void test_profiles(void)
{
    TEST_ASSERT_NULL(r2d_postprocess_profile(NULL));
    TEST_ASSERT_NULL(r2d_postprocess_profile("missing"));
    TEST_ASSERT_NULL(r2d_postprocess_profile("Underwater"));

    static const char *const names[] = {
        "neutral", "underwater", "poison", "frost", "boss", "damage"
    };
    for (int i = 0; i < 6; i++) {
        TEST_ASSERT_NOT_NULL(r2d_postprocess_profile(names[i]));
    }

    R2DPostStack stack;
    r2d_postprocess_init(&stack);
    TEST_ASSERT_TRUE(r2d_postprocess_apply_profile(&stack, "underwater"));
    TEST_ASSERT_TRUE(stack.effects[R2D_POST_GRADE].enabled);
    TEST_ASSERT_TRUE(stack.effects[R2D_POST_TINT].enabled);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.6f, stack.effects[R2D_POST_TINT].strength);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.35f, stack.effects[R2D_POST_VIGNETTE].strength);

    R2DPostUniforms u;
    r2d_postprocess_eval(&stack, &u);
    TEST_ASSERT_TRUE(u.color_scale[2] > 1.0f);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.35f, u.vignette);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.30f, u.bloom);

    // Failed apply is transactional.
    R2DPostEffect before[R2D_POST_COUNT];
    memcpy(before, stack.effects, sizeof before);
    TEST_ASSERT_FALSE(r2d_postprocess_apply_profile(&stack, "missing"));
    TEST_ASSERT_FALSE(r2d_postprocess_apply_profile(&stack, NULL));
    TEST_ASSERT_EQUAL_INT(0, memcmp(before, stack.effects, sizeof before));

    // Successful apply keeps elapsed time and the diagnostic order table.
    r2d_postprocess_step(&stack, 0.25f);
    stack.order[0] = 99;
    const float kept_time = stack.time;
    TEST_ASSERT_TRUE(r2d_postprocess_apply_profile(&stack, "damage"));
    TEST_ASSERT_FLOAT_WITHIN(EPS, kept_time, stack.time);
    TEST_ASSERT_EQUAL_INT(99, stack.order[0]);
    TEST_ASSERT_TRUE(stack.effects[R2D_POST_FLASH].enabled);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 2.5f, stack.effects[R2D_POST_FLASH].extra0);
}

static void test_eval_combined(void)
{
    R2DPostStack stack;
    r2d_postprocess_init(&stack);
    TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, R2D_POST_GRADE, 1.0f,
                                         0.5f, 0.5f, 0.5f, 1.0f, 0.0f, 0.0f));
    TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, R2D_POST_VIGNETTE, 0.6f,
                                         0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f));
    TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, R2D_POST_FLASH, 0.4f,
                                         0.8f, 0.2f, 0.1f, 1.0f, 0.0f, 0.0f));
    TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, R2D_POST_TINT, 0.5f,
                                         0.2f, 0.4f, 0.6f, 0.5f, 0.0f, 0.0f));
    TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, R2D_POST_PIXELATE, 1.0f,
                                         0.0f, 0.0f, 0.0f, 0.0f, 8.0f, 0.0f));
    TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, R2D_POST_CHROMA, 0.3f,
                                         0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f));
    TEST_ASSERT_TRUE(r2d_postprocess_set(&stack, R2D_POST_BLOOM, 0.7f,
                                         0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f));
    for (int i = 0; i < R2D_POST_COUNT; i++) {
        TEST_ASSERT_TRUE(r2d_postprocess_enable(&stack, i, true));
    }

    R2DPostUniforms u;
    r2d_postprocess_eval(&stack, &u);
    for (int c = 0; c < 3; c++) TEST_ASSERT_FLOAT_WITHIN(EPS, 1.5f, u.color_scale[c]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.6f, u.vignette);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.4f, u.flash);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.32f, u.color_add[0]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.08f, u.color_add[1]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.04f, u.color_add[2]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.1f, u.tint[0]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.2f, u.tint[1]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.3f, u.tint[2]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.25f, u.tint[3]);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 8.0f, u.pixel_size);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.3f, u.chroma);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.7f, u.bloom);

    // Default decay removes the flash after one clamped 0.25 s tick.
    r2d_postprocess_step(&stack, 10.0f);
    r2d_postprocess_eval(&stack, &u);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, u.flash);
}

static void test_eval_fixed_order_independent_of_order_table(void)
{
    R2DPostStack stack;
    r2d_postprocess_init(&stack);
    r2d_postprocess_set(&stack, R2D_POST_GRADE, 1.0f, 0.5f, 0.5f, 0.5f, 1.0f, 0.0f, 0.0f);
    r2d_postprocess_set(&stack, R2D_POST_VIGNETTE, 0.25f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f);
    r2d_postprocess_set(&stack, R2D_POST_TINT, 0.5f, 0.2f, 0.4f, 0.6f, 0.5f, 0.0f, 0.0f);
    for (int i = 0; i < R2D_POST_COUNT; i++) r2d_postprocess_enable(&stack, i, true);

    R2DPostUniforms a, b;
    r2d_postprocess_eval(&stack, &a);
    for (int i = 0; i < R2D_POST_COUNT; i++) stack.order[i] = R2D_POST_COUNT - 1 - i;
    r2d_postprocess_eval(&stack, &b);
    TEST_ASSERT_EQUAL_INT(0, memcmp(&a, &b, sizeof a));
}

static void test_step_dt_clamp_and_time(void)
{
    R2DPostStack stack;
    r2d_postprocess_init(&stack);

    r2d_postprocess_step(&stack, -1.0f);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, stack.time);
    r2d_postprocess_step(&stack, NAN);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, stack.time);
    r2d_postprocess_step(&stack, 10.0f);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.25f, stack.time);
    r2d_postprocess_step(&stack, INFINITY);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.5f, stack.time);
    r2d_postprocess_step(&stack, 0.1f);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.6f, stack.time);
    r2d_postprocess_step(NULL, 0.25f);
}

static void test_invalid_args(void)
{
    R2DPostStack stack;
    r2d_postprocess_init(&stack);

    r2d_postprocess_init(NULL);
    r2d_postprocess_step(NULL, 0.1f);
    TEST_ASSERT_FALSE(r2d_postprocess_set(NULL, R2D_POST_GRADE, 1.0f,
                                          0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f));
    TEST_ASSERT_FALSE(r2d_postprocess_enable(NULL, R2D_POST_GRADE, true));
    TEST_ASSERT_FALSE(r2d_postprocess_apply_profile(NULL, "damage"));

    TEST_ASSERT_FALSE(r2d_postprocess_set(&stack, -1, 1.0f,
                                          0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f));
    TEST_ASSERT_FALSE(r2d_postprocess_set(&stack, R2D_POST_COUNT, 1.0f,
                                          0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f));
    TEST_ASSERT_FALSE(r2d_postprocess_enable(&stack, -1, true));
    TEST_ASSERT_FALSE(r2d_postprocess_enable(&stack, R2D_POST_COUNT, true));
    TEST_ASSERT_FALSE(r2d_postprocess_apply_profile(&stack, ""));
    TEST_ASSERT_FALSE(r2d_postprocess_apply_profile(&stack, "BOSS"));
}

static void test_determinism_10k_ticks(void)
{
    static const float dts[4] = {
        1.0f / 60.0f, 1.0f / 120.0f, 0.02f, 1.0f / 30.0f
    };
    R2DPostStack a, b;
    r2d_postprocess_init(&a);
    r2d_postprocess_init(&b);
    TEST_ASSERT_TRUE(r2d_postprocess_apply_profile(&a, "damage"));
    TEST_ASSERT_TRUE(r2d_postprocess_apply_profile(&b, "damage"));

    for (int i = 0; i < 10000; i++) {
        if (i == 500) {
            r2d_postprocess_set(&a, R2D_POST_TINT, 1.5f,
                                0.2f, 0.8f, 0.4f, 0.6f, 2.0f, 0.5f);
            r2d_postprocess_set(&b, R2D_POST_TINT, 1.5f,
                                0.2f, 0.8f, 0.4f, 0.6f, 2.0f, 0.5f);
        }
        if (i == 777) {
            r2d_postprocess_enable(&a, R2D_POST_GRADE, false);
            r2d_postprocess_enable(&b, R2D_POST_GRADE, false);
        }
        if (i == 8888) {
            r2d_postprocess_set(&a, R2D_POST_FLASH, 2.0f,
                                1.0f, 0.2f, 0.1f, 1.0f, 1.0f, 0.0f);
            r2d_postprocess_set(&b, R2D_POST_FLASH, 2.0f,
                                1.0f, 0.2f, 0.1f, 1.0f, 1.0f, 0.0f);
        }

        const float dt = dts[i % 4];
        r2d_postprocess_step(&a, dt);
        r2d_postprocess_step(&b, dt);

        R2DPostUniforms ua, ub;
        r2d_postprocess_eval(&a, &ua);
        r2d_postprocess_eval(&b, &ub);
        TEST_ASSERT_EQUAL_INT(0, memcmp(&ua, &ub, sizeof ua));
        TEST_ASSERT_TRUE(float_bits_equal(a.time, b.time));
    }

    TEST_ASSERT_TRUE(isfinite(a.time));
    TEST_ASSERT_TRUE(a.time > 0.0f);
    TEST_ASSERT_EQUAL_INT(0, memcmp(a.order, b.order, sizeof a.order));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_init_neutral);
    RUN_TEST(test_set_enable_and_disabled_neutral);
    RUN_TEST(test_parameter_clamping);
    RUN_TEST(test_flash_decay);
    RUN_TEST(test_tint_pulse);
    RUN_TEST(test_profiles);
    RUN_TEST(test_eval_combined);
    RUN_TEST(test_eval_fixed_order_independent_of_order_table);
    RUN_TEST(test_step_dt_clamp_and_time);
    RUN_TEST(test_invalid_args);
    RUN_TEST(test_determinism_10k_ticks);
    return UNITY_END();
}
