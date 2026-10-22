// Офлайн-тест процедурного синтезатора SFX (src/sfxgen.c): детерминизм, пресеты, слова → параметры, WAV, .rfx.
#include "unity.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "sfxgen.h"

void setUp(void) {}
void tearDown(void) {}

static size_t render(const R2DSfx *fx, int16_t **out)
{
    *out = (int16_t *)malloc(r2d_sfx_max_samples() * sizeof(int16_t));
    return r2d_sfx_render(fx, *out, r2d_sfx_max_samples());
}

static void test_every_preset_makes_audible_sound(void)
{
    for (int i = 0; i < r2d_sfx_preset_count(); ++i) {
        const char *name = r2d_sfx_preset_name(i);
        for (uint32_t seed = 1; seed <= 12; ++seed) {
            R2DSfx fx; int16_t *pcm;
            TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_sfx_preset(&fx, name, seed), name);
            const size_t n = render(&fx, &pcm);
            R2DSfxStats st; r2d_sfx_analyze(pcm, n, &st);
            free(pcm);
            char msg[96]; snprintf(msg, sizeof msg, "%s seed %u: %zu сэмплов, пик %.3f", name, seed, n, st.peak);
            TEST_ASSERT_TRUE_MESSAGE(n > 441 && n <= r2d_sfx_max_samples(), msg);   // не короче 10 мс
            if (strcmp(name, "random") != 0) {
                TEST_ASSERT_TRUE_MESSAGE(st.peak > 0.1f && st.peak < 0.98f, msg);
                TEST_ASSERT_EQUAL_INT_MESSAGE(0, st.clipped, msg);      // на громкости по умолчанию перегруза нет
            }
        }
    }
}

static void test_render_is_deterministic_and_seed_changes_sound(void)
{
    R2DSfx a, b, c; int16_t *pa, *pb, *pc;
    r2d_sfx_preset(&a, "explosion", 5); r2d_sfx_preset(&b, "explosion", 5); r2d_sfx_preset(&c, "explosion", 6);
    const size_t na = render(&a, &pa), nb = render(&b, &pb), nc = render(&c, &pc);
    TEST_ASSERT_EQUAL_UINT(na, nb);
    TEST_ASSERT_EQUAL_MEMORY(pa, pb, na * 2);
    TEST_ASSERT_TRUE(nc != na || memcmp(pa, pc, (na < nc ? na : nc) * 2) != 0);
    free(pa); free(pb); free(pc);
}

static void test_unknown_preset_is_rejected(void)
{
    R2DSfx fx;
    TEST_ASSERT_EQUAL_INT(-1, r2d_sfx_preset(&fx, "nope", 1));
    TEST_ASSERT_EQUAL_INT(-1, r2d_sfx_preset(&fx, NULL, 1));
}

static void test_clamp_repairs_nan_and_range(void)
{
    R2DSfx fx; r2d_sfx_defaults(&fx);
    fx.freq = NAN; fx.slide = 9.0f; fx.wave = 77; fx.volume = -3.0f;
    r2d_sfx_clamp(&fx);
    TEST_ASSERT_EQUAL_FLOAT(0.3f, fx.freq);
    TEST_ASSERT_EQUAL_FLOAT(1.0f, fx.slide);
    TEST_ASSERT_EQUAL_INT(R2D_SFX_SQUARE, fx.wave);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, fx.volume);
}

static void test_sine_tone_matches_estimated_pitch(void)
{
    R2DSfx fx; r2d_sfx_defaults(&fx);
    fx.wave = R2D_SFX_SINE; fx.freq = 0.5f; fx.sustain = 0.4f; fx.decay = 0.3f;
    int16_t *pcm; const size_t n = render(&fx, &pcm);
    R2DSfxStats st; r2d_sfx_analyze(pcm, n, &st);
    free(pcm);
    // период фазы = 100 / (f² + 0.001); фаза растёт 8 раз за сэмпл (8-кратная передискретизация) → f = 8·44100 / период
    const float expected = 8.0f * (float)R2D_SFX_RATE / (100.0f / (0.25f + 0.001f));
    TEST_ASSERT_FLOAT_WITHIN(expected * 0.08f, expected, st.freq_hz);
}

static void test_text_descriptions(void)
{
    R2DSfx fx; uint32_t seed = 3;
    TEST_ASSERT_EQUAL_STRING("coin", r2d_sfx_from_text(&fx, "Звук подбора монеты", seed));
    TEST_ASSERT_EQUAL_STRING("explosion", r2d_sfx_from_text(&fx, "БОЛЬШОЙ ВЗРЫВ", seed));
    TEST_ASSERT_EQUAL_STRING("laser", r2d_sfx_from_text(&fx, "retro laser shot", seed));
    TEST_ASSERT_EQUAL_STRING("jump", r2d_sfx_from_text(&fx, "прыжок героя", seed));
    TEST_ASSERT_NULL(r2d_sfx_from_text(&fx, "что-то непонятное", seed));
    R2DSfx hi, lo;
    r2d_sfx_from_text(&hi, "высокий прыжок", seed); r2d_sfx_from_text(&lo, "низкий прыжок", seed);
    TEST_ASSERT_TRUE(hi.freq > lo.freq);
    R2DSfx s, l;
    r2d_sfx_from_text(&s, "короткий удар", seed); r2d_sfx_from_text(&l, "длинный удар", seed);
    TEST_ASSERT_TRUE(l.decay > s.decay);
}

static void test_mutate_changes_but_stays_valid(void)
{
    R2DSfx a, b; r2d_sfx_preset(&a, "powerup", 2); b = a;
    r2d_sfx_mutate(&b, 9, 0.3f);
    TEST_ASSERT_TRUE(memcmp(&a, &b, sizeof a) != 0);
    TEST_ASSERT_TRUE(b.freq >= 0.0f && b.freq <= 1.0f);
}

static void test_wav_and_rfx_roundtrip(void)
{
    R2DSfx fx; int16_t *pcm; r2d_sfx_preset(&fx, "coin", 11);
    const size_t n = render(&fx, &pcm);
    const char *wav = "/tmp/r2d_sfxgen_test.wav", *rfx = "/tmp/r2d_sfxgen_test.rfx";
    TEST_ASSERT_EQUAL_INT(0, r2d_sfx_write_wav(wav, pcm, n));
    FILE *f = fopen(wav, "rb"); TEST_ASSERT_NOT_NULL(f);
    unsigned char h[44]; TEST_ASSERT_EQUAL_UINT(44, fread(h, 1, 44, f));
    fseek(f, 0, SEEK_END); const long size = ftell(f); fclose(f);
    TEST_ASSERT_EQUAL_MEMORY("RIFF", h, 4); TEST_ASSERT_EQUAL_MEMORY("WAVE", h + 8, 4); TEST_ASSERT_EQUAL_MEMORY("data", h + 36, 4);
    TEST_ASSERT_EQUAL_INT((long)(44 + n * 2), size);
    free(pcm);
    TEST_ASSERT_EQUAL_INT(0, r2d_sfx_save_rfx(rfx, &fx));
    f = fopen(rfx, "rb"); fseek(f, 0, SEEK_END); TEST_ASSERT_EQUAL_INT(8 + 96, ftell(f)); fclose(f);
    R2DSfx back; TEST_ASSERT_EQUAL_INT(0, r2d_sfx_load_rfx(rfx, &back));
    TEST_ASSERT_EQUAL_FLOAT(fx.freq, back.freq); TEST_ASSERT_EQUAL_FLOAT(fx.decay, back.decay); TEST_ASSERT_EQUAL_INT(fx.wave, back.wave);
    TEST_ASSERT_EQUAL_INT(-1, r2d_sfx_load_rfx(wav, &back));    // чужой файл отклоняется
    remove(wav); remove(rfx);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_every_preset_makes_audible_sound);
    RUN_TEST(test_render_is_deterministic_and_seed_changes_sound);
    RUN_TEST(test_unknown_preset_is_rejected);
    RUN_TEST(test_clamp_repairs_nan_and_range);
    RUN_TEST(test_sine_tone_matches_estimated_pitch);
    RUN_TEST(test_text_descriptions);
    RUN_TEST(test_mutate_changes_but_stays_valid);
    RUN_TEST(test_wav_and_rfx_roundtrip);
    return UNITY_END();
}
