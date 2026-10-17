#include "re2d_world_material_anim.h"
#include "unity.h"

#include <math.h>
#include <stdint.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-5f
#define TAU 6.28318530717958647692f

static R2DWorldMaterialAnim make_anim(int frames, float fps, bool ping_pong, uint32_t seed,
                                      float scroll_u, float scroll_v, float pulse_hz, float pulse_amount)
{
    R2DWorldMaterialAnim anim;
    memset(&anim, 0xcd, sizeof(anim));
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_material_anim_init(&anim, frames, fps, ping_pong, seed,
                                                          scroll_u, scroll_v, pulse_hz, pulse_amount),
                             "fixture animation initializes");
    return anim;
}

static uint32_t float_bits(float value)
{
    uint32_t bits;
    memcpy(&bits, &value, sizeof(bits));
    return bits;
}

static void test_init_validation(void)
{
    R2DWorldMaterialAnim anim;

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_material_anim_init(&anim, 8, 12.5f, true, 7u, 0.5f, -0.25f, 2.0f, 0.8f),
                             "valid animation initializes");
    TEST_ASSERT_EQUAL_INT_MESSAGE(8, anim.frames, "frames stored");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(12.5f, anim.fps, "fps stored");
    TEST_ASSERT_TRUE_MESSAGE(anim.ping_pong, "ping-pong stored");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(7u, anim.seed, "seed stored");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.5f, anim.scroll_u, "scroll_u stored");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(-0.25f, anim.scroll_v, "negative scroll_v stored");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(2.0f, anim.pulse_hz, "pulse_hz stored");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.8f, anim.pulse_amount, "pulse_amount stored");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, anim.phase, "phase starts at 0");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, anim.u_offset, "u_offset starts at 0");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, anim.v_offset, "v_offset starts at 0");

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_material_anim_init(&anim, 1, 1.0f, false, 0u, 0, 0, 0, 0),
                             "one frame is valid");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, anim.frames, "one-frame animation accepted");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_material_anim_init(&anim, 64, 60.0f, false, 1u, 0, 0, 0, 0),
                             "64 frames is the upper bound and is valid");
    TEST_ASSERT_EQUAL_INT_MESSAGE(64, anim.frames, "64-frame animation accepted");

    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(NULL, 8, 10, false, 0, 0, 0, 0, 0),
                              "NULL anim rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(&anim, 0, 10, false, 0, 0, 0, 0, 0),
                              "zero frames rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(&anim, 65, 10, false, 0, 0, 0, 0, 0),
                              "65 frames rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(&anim, -3, 10, false, 0, 0, 0, 0, 0),
                              "negative frames rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(&anim, 8, 0.0f, false, 0, 0, 0, 0, 0),
                              "zero fps rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(&anim, 8, -10.0f, false, 0, 0, 0, 0, 0),
                              "negative fps rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(&anim, 8, NAN, false, 0, 0, 0, 0, 0),
                              "NaN fps rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(&anim, 8, INFINITY, false, 0, 0, 0, 0, 0),
                              "infinite fps rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(&anim, 8, 10, false, 0, NAN, 0, 0, 0),
                              "NaN scroll_u rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(&anim, 8, 10, false, 0, 0, INFINITY, 0, 0),
                              "infinite scroll_v rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(&anim, 8, 10, false, 0, 0, 0, -1.0f, 0),
                              "negative pulse_hz rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(&anim, 8, 10, false, 0, 0, 0, NAN, 0),
                              "NaN pulse_hz rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(&anim, 8, 10, false, 0, 0, 0, 1.0f, -0.5f),
                              "negative pulse_amount rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_material_anim_init(&anim, 8, 10, false, 0, 0, 0, 1.0f, NAN),
                              "NaN pulse_amount rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, anim.frames, "failed init leaves a zeroed block");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, anim.phase, "failed init leaves neutral phase");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(1.0f, r2d_world_material_anim_emissive(&anim),
                                    "zeroed block has neutral emissive");
}

static void test_forward_frame_mapping(void)
{
    R2DWorldMaterialAnim anim = make_anim(4, 4.0f, false, 0u, 0, 0, 0, 0);

    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_material_anim_frame(&anim), "starts at frame 0");
    r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_world_material_anim_frame(&anim), "advances to frame 1");
    r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, r2d_world_material_anim_frame(&anim), "advances to frame 2");
    r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, r2d_world_material_anim_frame(&anim), "advances to frame 3");
    r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_material_anim_frame(&anim), "wraps to frame 0");
    r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_world_material_anim_frame(&anim), "second cycle advances again");

    R2DWorldMaterialAnim one = make_anim(1, 8.0f, false, 123u, 0, 0, 0, 0);
    r2d_world_material_anim_step(&one, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_material_anim_frame(&one), "one-frame animation always frame 0");
}

static void test_fps_affects_frame(void)
{
    R2DWorldMaterialAnim slow = make_anim(16, 4.0f, false, 0u, 0, 0, 0, 0);
    R2DWorldMaterialAnim fast = make_anim(16, 8.0f, false, 0u, 0, 0, 0, 0);

    for (int i = 0; i < 2; ++i) {
        r2d_world_material_anim_step(&slow, 0.25f);
        r2d_world_material_anim_step(&fast, 0.25f);
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, r2d_world_material_anim_frame(&slow), "4 fps reaches frame 2 after 0.5 s");
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, r2d_world_material_anim_frame(&fast), "8 fps reaches frame 4 after 0.5 s");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_material_anim_frame(&slow) != r2d_world_material_anim_frame(&fast),
                             "fps changes the mapped frame");
}

static void test_ping_pong_mapping(void)
{
    R2DWorldMaterialAnim anim = make_anim(4, 4.0f, true, 0u, 0, 0, 0, 0);
    const int expected[] = { 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0 };
    for (unsigned i = 0; i < sizeof(expected) / sizeof(expected[0]); ++i) {
        r2d_world_material_anim_step(&anim, 0.25f);
        TEST_ASSERT_EQUAL_INT_MESSAGE(expected[i], r2d_world_material_anim_frame(&anim),
                                      "ping-pong frame follows 0..3..0 symmetrically");
    }

    R2DWorldMaterialAnim two = make_anim(2, 4.0f, true, 0u, 0, 0, 0, 0);
    r2d_world_material_anim_step(&two, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_world_material_anim_frame(&two), "2-frame ping-pong reaches frame 1");
    r2d_world_material_anim_step(&two, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_material_anim_frame(&two), "2-frame ping-pong returns to 0");
    r2d_world_material_anim_step(&two, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_world_material_anim_frame(&two), "2-frame ping-pong reverses again");
}

static void test_scroll_accumulation_and_wrap(void)
{
    R2DWorldMaterialAnim anim = make_anim(1, 1.0f, false, 0u, 1.0f, -0.25f, 0, 0);

    r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, anim.u_offset, "u scroll accumulates");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.9375f, anim.v_offset, "negative v scroll wraps to [0,1)");

    for (int i = 0; i < 3; ++i) r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, anim.u_offset, "u scroll wraps at 1.0");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.75f, anim.v_offset, "v scroll wraps after one second");

    for (int i = 0; i < 12; ++i) {
        r2d_world_material_anim_step(&anim, 0.25f);
        TEST_ASSERT_TRUE_MESSAGE(anim.u_offset >= 0.0f && anim.u_offset < 1.0f, "u_offset stays in [0,1)");
        TEST_ASSERT_TRUE_MESSAGE(anim.v_offset >= 0.0f && anim.v_offset < 1.0f, "v_offset stays in [0,1)");
    }
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, anim.u_offset, "u scroll wraps cleanly after 4 s");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, anim.v_offset, "v scroll wraps cleanly after 4 s");

    R2DWorldMaterialAnim still = make_anim(4, 4.0f, false, 0u, 0, 0, 0, 0);
    r2d_world_material_anim_step(&still, 0.25f);
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, still.u_offset, "zero scroll keeps u_offset at 0");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, still.v_offset, "zero scroll keeps v_offset at 0");
}

static void test_emissive_pulse(void)
{
    R2DWorldMaterialAnim anim = make_anim(1, 1.0f, false, 0u, 0, 0, 1.0f, 0.5f);

    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, r2d_world_material_anim_emissive(&anim),
                                    "pulse starts at neutral 1.0");
    r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.5f, r2d_world_material_anim_emissive(&anim),
                                    "quarter cycle reaches 1 + amount");
    r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, r2d_world_material_anim_emissive(&anim),
                                    "half cycle returns to neutral");
    r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.5f, r2d_world_material_anim_emissive(&anim),
                                    "three-quarter cycle reaches 1 - amount");
    r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, r2d_world_material_anim_emissive(&anim),
                                    "full cycle returns to neutral");

    for (int i = 0; i < 1000; ++i) {
        r2d_world_material_anim_step(&anim, 0.017f);
        float value = r2d_world_material_anim_emissive(&anim);
        TEST_ASSERT_TRUE_MESSAGE(value >= 0.5f - EPS && value <= 1.5f + EPS, "pulse stays in amount range");
    }

    R2DWorldMaterialAnim static_pulse = make_anim(1, 1.0f, false, 0u, 0, 0, 0.0f, 0.5f);
    r2d_world_material_anim_step(&static_pulse, 0.25f);
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(1.0f, r2d_world_material_anim_emissive(&static_pulse),
                                    "zero pulse_hz yields neutral emissive");

    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(1.0f, r2d_world_material_anim_emissive(NULL),
                                    "NULL emissive is neutral");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_material_anim_frame(NULL), "NULL frame is 0");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_material_anim_seed_frame(NULL), "NULL seed frame is 0");
}

static void test_seed_frame_deterministic(void)
{
    R2DWorldMaterialAnim a = make_anim(8, 4.0f, false, 123u, 0, 0, 0, 0);
    R2DWorldMaterialAnim b = make_anim(8, 4.0f, false, 123u, 0, 0, 0, 0);

    int seeded = r2d_world_material_anim_seed_frame(&a);
    TEST_ASSERT_TRUE_MESSAGE(seeded >= 0 && seeded < 8, "seed frame is inside [0,frames)");
    TEST_ASSERT_EQUAL_INT_MESSAGE(seeded, r2d_world_material_anim_seed_frame(&b), "same seed gives same frame");
    for (int i = 0; i < 100; ++i) {
        TEST_ASSERT_EQUAL_INT_MESSAGE(seeded, r2d_world_material_anim_seed_frame(&a),
                                      "repeated seed_frame calls are stable");
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(seeded, r2d_world_material_anim_frame(&a),
                                  "frame starts at the seeded offset");
    r2d_world_material_anim_step(&a, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(seeded, r2d_world_material_anim_seed_frame(&a),
                                  "seed frame is independent of phase");
    r2d_world_material_anim_reset(&a);
    TEST_ASSERT_EQUAL_INT_MESSAGE(seeded, r2d_world_material_anim_frame(&a), "reset keeps the seeded offset");

    R2DWorldMaterialAnim unseeded = make_anim(8, 4.0f, false, 0u, 0, 0, 0, 0);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_material_anim_seed_frame(&unseeded), "seed 0 maps to frame 0");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_material_anim_frame(&unseeded), "seed 0 starts at frame 0");

    int saw_different = 0;
    for (uint32_t seed = 1; seed <= 16; ++seed) {
        R2DWorldMaterialAnim other = make_anim(8, 4.0f, false, seed, 0, 0, 0, 0);
        int frame = r2d_world_material_anim_seed_frame(&other);
        TEST_ASSERT_TRUE_MESSAGE(frame >= 0 && frame < 8, "seeded frame stays in range");
        if (frame != seeded) saw_different = 1;
    }
    TEST_ASSERT_TRUE_MESSAGE(saw_different, "different seeds produce different frame phases");

    R2DWorldMaterialAnim single = make_anim(1, 4.0f, false, 999u, 0, 0, 0, 0);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_material_anim_seed_frame(&single), "single frame ignores seed");
}

static void test_reset_restores_state(void)
{
    R2DWorldMaterialAnim anim = make_anim(8, 8.0f, false, 5u, 0.5f, 0.5f, 1.0f, 0.5f);
    int seeded = r2d_world_material_anim_seed_frame(&anim);
    r2d_world_material_anim_step(&anim, 0.25f);
    r2d_world_material_anim_step(&anim, 0.25f);
    r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.75f, anim.phase, "fixture phase advanced");
    TEST_ASSERT_TRUE_MESSAGE(anim.u_offset > 0.0f && anim.v_offset > 0.0f, "fixture scrolled");

    r2d_world_material_anim_reset(&anim);
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, anim.phase, "reset clears phase");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, anim.u_offset, "reset clears u_offset");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, anim.v_offset, "reset clears v_offset");
    TEST_ASSERT_EQUAL_INT_MESSAGE(seeded, r2d_world_material_anim_frame(&anim), "reset restores seeded frame");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, r2d_world_material_anim_emissive(&anim),
                                     "reset restores neutral emissive");
    TEST_ASSERT_EQUAL_INT_MESSAGE(8, anim.frames, "reset preserves frames");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(8.0f, anim.fps, "reset preserves fps");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.5f, anim.scroll_u, "reset preserves scroll_u");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.5f, anim.scroll_v, "reset preserves scroll_v");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(1.0f, anim.pulse_hz, "reset preserves pulse_hz");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.5f, anim.pulse_amount, "reset preserves pulse_amount");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(5u, anim.seed, "reset preserves seed");

    r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, anim.phase, "reset animation steps again");
    r2d_world_material_anim_reset(NULL);
}

static void test_dt_clamp_and_invalid(void)
{
    R2DWorldMaterialAnim anim = make_anim(8, 4.0f, false, 0u, 1.0f, 1.0f, 0, 0);

    r2d_world_material_anim_step(&anim, 10.0f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, anim.phase, "large dt is clamped to 0.25 s");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, anim.u_offset, "scroll uses the clamped dt");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, anim.v_offset, "v scroll uses the clamped dt");

    r2d_world_material_anim_step(&anim, NAN);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, anim.phase, "NaN dt is ignored");
    r2d_world_material_anim_step(&anim, INFINITY);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, anim.phase, "infinite dt is ignored");
    r2d_world_material_anim_step(&anim, -1.0f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, anim.phase, "negative dt is ignored");
    r2d_world_material_anim_step(&anim, 0.0f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, anim.phase, "zero dt is ignored");

    r2d_world_material_anim_step(&anim, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.5f, anim.phase, "0.25 s is accepted verbatim");
    r2d_world_material_anim_step(NULL, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.5f, anim.phase, "NULL step is a no-op");
}

static void run_10k_ticks(R2DWorldMaterialAnim *anim, uint32_t *out_hash, float *out_phase,
                          float *out_u, float *out_v, int *out_frame, float *out_emissive)
{
    uint32_t hash = 2166136261u;
    for (int i = 0; i < 10000; ++i) {
        float dt = (i % 11 == 0) ? 0.4f : 0.016f; // includes dt-clamp path
        r2d_world_material_anim_step(anim, dt);
        int frame = r2d_world_material_anim_frame(anim);
        float emissive = r2d_world_material_anim_emissive(anim);
        TEST_ASSERT_TRUE_MESSAGE(frame >= 0 && frame < anim->frames, "10k frame stays in range");
        TEST_ASSERT_TRUE_MESSAGE(anim->u_offset >= 0.0f && anim->u_offset < 1.0f, "10k u_offset stays in [0,1)");
        TEST_ASSERT_TRUE_MESSAGE(anim->v_offset >= 0.0f && anim->v_offset < 1.0f, "10k v_offset stays in [0,1)");
        hash ^= float_bits(anim->phase);
        hash *= 16777619u;
        hash ^= float_bits(anim->u_offset);
        hash *= 16777619u;
        hash ^= float_bits(anim->v_offset);
        hash *= 16777619u;
        hash ^= (uint32_t)frame;
        hash *= 16777619u;
        hash ^= float_bits(emissive);
        hash *= 16777619u;
    }
    *out_hash = hash;
    *out_phase = anim->phase;
    *out_u = anim->u_offset;
    *out_v = anim->v_offset;
    *out_frame = r2d_world_material_anim_frame(anim);
    *out_emissive = r2d_world_material_anim_emissive(anim);
}

static void test_10k_ticks_deterministic(void)
{
    R2DWorldMaterialAnim a = make_anim(8, 12.0f, true, 1234u, 0.3f, -0.17f, 1.5f, 0.6f);
    R2DWorldMaterialAnim b = make_anim(8, 12.0f, true, 1234u, 0.3f, -0.17f, 1.5f, 0.6f);

    uint32_t hash_a, hash_b;
    float phase_a, phase_b, u_a, u_b, v_a, v_b, e_a, e_b;
    int frame_a, frame_b;
    run_10k_ticks(&a, &hash_a, &phase_a, &u_a, &v_a, &frame_a, &e_a);
    run_10k_ticks(&b, &hash_b, &phase_b, &u_b, &v_b, &frame_b, &e_b);

    TEST_ASSERT_EQUAL_UINT32_MESSAGE(hash_a, hash_b, "10k-tick state hashes are identical");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(phase_a, phase_b, "10k-tick phase is identical");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(u_a, u_b, "10k-tick u_offset is identical");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(v_a, v_b, "10k-tick v_offset is identical");
    TEST_ASSERT_EQUAL_INT_MESSAGE(frame_a, frame_b, "10k-tick frame is identical");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(e_a, e_b, "10k-tick emissive is identical");

    r2d_world_material_anim_reset(&a);
    uint32_t hash_c;
    float phase_c, u_c, v_c, e_c;
    int frame_c;
    run_10k_ticks(&a, &hash_c, &phase_c, &u_c, &v_c, &frame_c, &e_c);
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(hash_b, hash_c, "reset replay reproduces the same state hash");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(phase_b, phase_c, "reset replay reproduces phase");
    TEST_ASSERT_EQUAL_INT_MESSAGE(frame_b, frame_c, "reset replay reproduces frame");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_init_validation);
    RUN_TEST(test_forward_frame_mapping);
    RUN_TEST(test_fps_affects_frame);
    RUN_TEST(test_ping_pong_mapping);
    RUN_TEST(test_scroll_accumulation_and_wrap);
    RUN_TEST(test_emissive_pulse);
    RUN_TEST(test_seed_frame_deterministic);
    RUN_TEST(test_reset_restores_state);
    RUN_TEST(test_dt_clamp_and_invalid);
    RUN_TEST(test_10k_ticks_deterministic);
    return UNITY_END();
}
