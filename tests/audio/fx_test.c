// ===========================================================================
// Офлайн-тест DSP-эффектов (src/audio_fx.c).
//
// Звуковое устройство здесь не нужно: модуль эффектов работает с буфером
// float и не знает про SDL_mixer. Поэтому проверяем математику напрямую —
// фильтры, тремоло, bitcrush, кольцевую модуляцию и реверб-шину с посылом.
// Живой звук так не проверить, зато видно, что эффект не «ничего не делает»
// и не превращает буфер в тишину.
//
// Запуск (собирается вместе с движком):
//   ./build/r2d_audio_fx_test
// ===========================================================================
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "audio_fx.h"

static int failures = 0;
static int checks = 0;

static void check(int condition, const char *message)
{
    checks++;
    if (!condition) {
        failures++;
        printf("  FAIL %s\n", message);
    } else {
        printf("  ok   %s\n", message);
    }
}

/** Пиковое абсолютное значение буфера (interleaved). */
static float peak(const float *pcm, int samples)
{
    float out = 0.0f;
    for (int i = 0; i < samples; ++i) {
        const float v = fabsf(pcm[i]);
        if (v > out) out = v;
    }
    return out;
}

/** Средний квадрат — «сколько энергии» в буфере. */
static double energy(const float *pcm, int samples)
{
    double acc = 0.0;
    for (int i = 0; i < samples; ++i) acc += (double)pcm[i] * pcm[i];
    return acc / (samples > 0 ? samples : 1);
}

/** Синус в стерео-буфере: rate Гц, freq Гц, frames кадров. */
static void fill_sine(float *pcm, int frames, int rate, float freq, float amp)
{
    for (int f = 0; f < frames; ++f) {
        const float v = amp * sinf(2.0f * (float)M_PI * freq * (float)f / (float)rate);
        pcm[f * 2 + 0] = v;
        pcm[f * 2 + 1] = v;
    }
}

/** Постоянный сигнал: удобно смотреть на фильтры (ФНЧ пропускает, ФВЧ режет). */
static void fill_dc(float *pcm, int frames, float value)
{
    for (int f = 0; f < frames; ++f) {
        pcm[f * 2 + 0] = value;
        pcm[f * 2 + 1] = value;
    }
}

static SDL_AudioSpec spec_of(int rate, int channels)
{
    SDL_AudioSpec spec;
    memset(&spec, 0, sizeof spec);
    spec.freq = rate;
    spec.channels = channels;
    spec.format = SDL_AUDIO_F32;
    return spec;
}

int main(void)
{
    const int rate = 48000;
    const int frames = 2048;
    const int samples = frames * 2;
    const SDL_AudioSpec stereo = spec_of(rate, 2);

    static float buf[4096 * 2];

    printf("DSP-эффекты каналов и шин\n");

    // --- Список эффектов ----------------------------------------------------
    check(r2d_audio_fx_count() >= 8, "движок знает не меньше восьми эффектов");
    check(strcmp(r2d_audio_fx_name(0), "none") == 0, "нулевой эффект — none");
    int has_highpass = 0, has_tremolo = 0, has_bitcrush = 0, has_ringmod = 0, has_reverb = 0;
    for (int i = 0; i < r2d_audio_fx_count(); ++i) {
        const char *n = r2d_audio_fx_name(i);
        if (strcmp(n, "highpass") == 0) has_highpass = 1;
        if (strcmp(n, "tremolo") == 0) has_tremolo = 1;
        if (strcmp(n, "bitcrush") == 0) has_bitcrush = 1;
        if (strcmp(n, "ringmod") == 0) has_ringmod = 1;
        if (strcmp(n, "reverb") == 0) has_reverb = 1;
    }
    check(has_highpass && has_tremolo && has_bitcrush && has_ringmod && has_reverb,
          "в списке есть highpass, tremolo, bitcrush, ringmod и reverb");
    check(r2d_audio_fx_kind_name(R2D_AUDIO_FX_HIGHPASS) != NULL, "имя вида отвечает");

    // --- none: буфер не меняется -------------------------------------------
    {
        R2DAudioFx fx;
        memset(&fx, 0, sizeof fx);
        check(r2d_audio_fx_set(&fx, rate, "none", 0, 0), "none включается");
        fill_sine(buf, frames, rate, 440.0f, 0.5f);
        float before = peak(buf, samples);
        r2d_audio_fx_process(&fx, &stereo, buf, samples);
        check(fabsf(peak(buf, samples) - before) < 1e-6f, "none не трогает буфер");
        check(!r2d_audio_fx_set(&fx, rate, "нет-такого", 0, 0), "неизвестный эффект не включается");
        r2d_audio_fx_shutdown(&fx);
    }

    // --- ФНЧ и ФВЧ ----------------------------------------------------------
    {
        R2DAudioFx fx;
        memset(&fx, 0, sizeof fx);
        check(r2d_audio_fx_set(&fx, rate, "lowpass", 200.0f, 0), "lowpass включается");
        fill_dc(buf, frames, 1.0f);
        r2d_audio_fx_process(&fx, &stereo, buf, samples);
        check(peak(buf + (frames - 64) * 2, 128) > 0.9f, "ФНЧ пропускает постоянный сигнал");
        r2d_audio_fx_shutdown(&fx);

        memset(&fx, 0, sizeof fx);
        check(r2d_audio_fx_set(&fx, rate, "highpass", 2000.0f, 0), "highpass включается");
        fill_dc(buf, frames, 1.0f);
        r2d_audio_fx_process(&fx, &stereo, buf, samples);
        check(peak(buf + (frames - 64) * 2, 128) < 0.1f, "ФВЧ режет постоянный сигнал");
        r2d_audio_fx_shutdown(&fx);
    }

    // --- Эхо -----------------------------------------------------------------
    {
        R2DAudioFx fx;
        memset(&fx, 0, sizeof fx);
        check(r2d_audio_fx_set(&fx, rate, "echo", 20.0f, 0.5f), "echo включается");
        // Импульс в начале: через 20 мс он должен вернуться (960 кадров — 
        // заведомо внутри одного буфера обработки).
        memset(buf, 0, sizeof(float) * (size_t)samples);
        buf[0] = 1.0f;
        buf[1] = 1.0f;
        r2d_audio_fx_process(&fx, &stereo, buf, samples);
        const int delay_frames = rate / 50;      // 20 мс
        check(delay_frames < frames, "задержка эха помещается в буфер");
        check(fabsf(buf[delay_frames * 2]) > 0.2f, "эхо вернулось с задержкой");
        r2d_audio_fx_shutdown(&fx);
    }

    // --- Тремоло -------------------------------------------------------------
    {
        R2DAudioFx fx;
        memset(&fx, 0, sizeof fx);
        check(r2d_audio_fx_set(&fx, rate, "tremolo", 8.0f, 1.0f), "tremolo включается");
        fill_dc(buf, frames, 1.0f);
        r2d_audio_fx_process(&fx, &stereo, buf, samples);
        float lo = 1.0f, hi = 0.0f;
        for (int f = 0; f < frames; ++f) {
            const float v = buf[f * 2];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        char tmsg[96];
        snprintf(tmsg, sizeof tmsg, "тремоло качает амплитуду (%.2f..%.2f)", (double)lo, (double)hi);
        check(hi > 0.95f && lo < 0.4f, tmsg);   // минимум зависит от фазы LFO
        r2d_audio_fx_shutdown(&fx);
    }

    // --- Bitcrush ------------------------------------------------------------
    {
        R2DAudioFx fx;
        memset(&fx, 0, sizeof fx);
        check(r2d_audio_fx_set(&fx, rate, "bitcrush", 3.0f, 1.0f), "bitcrush включается");
        fill_sine(buf, frames, rate, 220.0f, 1.0f);
        r2d_audio_fx_process(&fx, &stereo, buf, samples);
        int distinct = 0;
        float seen[16];
        for (int f = 0; f < frames; ++f) {
            const float v = buf[f * 2];
            int found = 0;
            for (int i = 0; i < distinct; ++i) {
                if (fabsf(seen[i] - v) < 1e-6f) { found = 1; break; }
            }
            if (!found && distinct < 16) seen[distinct++] = v;
        }
        char bmsg[96];
        snprintf(bmsg, sizeof bmsg, "три бита дают девять уровней (%d)", distinct);
        // 3 бита — это 2^(3-1) = 4 шага квантования, то есть 9 значений
        // в диапазоне [-1, 1] вместе с краями.
        check(distinct <= 9, bmsg);
        r2d_audio_fx_shutdown(&fx);
    }

    // --- Кольцевая модуляция -------------------------------------------------
    {
        R2DAudioFx fx;
        memset(&fx, 0, sizeof fx);
        check(r2d_audio_fx_set(&fx, rate, "ringmod", 400.0f, 1.0f), "ringmod включается");
        fill_dc(buf, frames, 1.0f);
        r2d_audio_fx_process(&fx, &stereo, buf, samples);
        // Постоянный сигнал превращается в синус 400 Гц: энергия есть,
        // но значения ходят в обе стороны.
        float lo = 1.0f, hi = -1.0f;
        for (int f = 0; f < frames; ++f) {
            const float v = buf[f * 2];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
        check(hi > 0.9f && lo < -0.9f, "кольцевая модуляция даёт знакопеременный сигнал");
        r2d_audio_fx_shutdown(&fx);
    }

    // --- Реверб-шина: посыл, а не замена -------------------------------------
    {
        R2DAudioFx fx;
        memset(&fx, 0, sizeof fx);
        check(r2d_audio_fx_set(&fx, rate, "reverb", 0.6f, 0.7f), "реверб включается");
        // Короткий импульс: сухой сигнал обязан остаться на месте.
        memset(buf, 0, sizeof(float) * (size_t)samples);
        buf[0] = 1.0f;
        buf[1] = 1.0f;
        r2d_audio_fx_process(&fx, &stereo, buf, samples);
        check(fabsf(buf[0] - 1.0f) < 1e-6f, "сухой сигнал остался без изменений");

        // Хвост: через 50 мс после импульса в буфере есть энергия, которой без
        // реверба не было бы (тишина).
        static float tail[4096 * 2];
        memset(tail, 0, sizeof(float) * (size_t)samples);
        r2d_audio_fx_process(&fx, &stereo, tail, samples);
        const double tail_energy = energy(tail + 1024, 2048);
        char rmsg[96];
        snprintf(rmsg, sizeof rmsg, "после импульса слышен хвост (%.3g)", tail_energy);
        check(tail_energy > 1e-9, rmsg);

        // Без реверба тот же участок — ровно нули.
        R2DAudioFx silent;
        memset(&silent, 0, sizeof silent);
        r2d_audio_fx_set(&silent, rate, "none", 0, 0);
        memset(tail, 0, sizeof(float) * (size_t)samples);
        r2d_audio_fx_process(&silent, &stereo, tail, samples);
        check(energy(tail + 1024, 2048) == 0.0, "без эффекта хвоста нет");

        // Полные параметры хвоста: своя комната и посыл.
        check(r2d_audio_fx_set_reverb(&fx, rate, 0.9f, 0.2f, 0.1f, 0.5f),
              "полные параметры реверба принимаются");
        check(fabsf(fx.p1 - 0.9f) < 1e-6f, "посыл сохранился как параметр");

        r2d_audio_fx_shutdown(&fx);
        check(fx.reverb == NULL, "shutdown освободил хвост");
    }

    // --- Сброс состояния -----------------------------------------------------
    {
        R2DAudioFx fx;
        memset(&fx, 0, sizeof fx);
        r2d_audio_fx_set(&fx, rate, "lowpass", 400.0f, 0);
        fill_dc(buf, frames, 1.0f);
        r2d_audio_fx_process(&fx, &stereo, buf, samples);
        check(fx.z[0] > 0.5f, "фильтр накопил состояние");
        r2d_audio_fx_reset(&fx);
        check(fx.z[0] == 0.0f && fx.x1[0] == 0.0f, "reset обнулил состояние");
        r2d_audio_fx_shutdown(&fx);
    }

    printf("\n%s\n", failures == 0 ? "Все проверки пройдены" : "ПРОВАЛЕНО");
    printf("проверок: %d, провалов: %d\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
