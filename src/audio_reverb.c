// ===========================================================================
// Freeverb: реверберация помещения.
//
// Порт модели Jezar at Dreampoint (public domain). Оригинал — стерео-сеть из
// восьми гребёнок (comb) и четырёх всепропускающих звеньев (allpass) на канал,
// с разными временами задержки для левого и правого канала.
//
// Отличия от оригинала:
//   * буферы выделяются под частоту микшера (tunings масштабируются от 44100);
//   * сухой сигнал не ослабляется: реверб работает как «посыл» поверх прямого
//     звука, а не как полная замена (в игре так слышно и выстрел, и комнату);
//   * никаких аллокаций и блокировок в r2d_reverb_process.
// ===========================================================================

#include "audio_reverb.h"

#include "r2d.h"

#include <SDL3/SDL.h>
#include <math.h>

// Времена задержек Freeverb на 44100 Гц.
static const int r2d__comb_tuning[R2D_REVERB_COMBS] = {
    1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617
};
static const int r2d__allpass_tuning[R2D_REVERB_ALLPASSES] = {
    556, 441, 341, 225
};

// Разница задержек между каналами — источник стерео-ширины хвоста.
#define R2D_REVERB_STEREO_SPREAD 23

// Входной коэффициент оригинала: без него сумма восьми гребёнок перегружает.
#define R2D_REVERB_INPUT_GAIN 0.015f

static float r2d__scale_tuning(int tuning, int rate)
{
    int n = (int)((float)tuning * (float)rate / 44100.0f + 0.5f);
    if (n < 8) n = 8;
    return (float)n;
}

// Денормали: без обнуления хвост уходит в денормальные числа и жрёт CPU.
static float r2d__undenormalise(float x)
{
    if (!(x > -1.0e-25f && x < 1.0e-25f)) return x;
    return 0.0f;
}

static float r2d__clampf(float v, float lo, float hi)
{
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

bool r2d_reverb_init(R2DAudioReverb *r, int sample_rate)
{
    if (!r) return false;
    SDL_zero(*r);

    r->rate = sample_rate > 0 ? sample_rate : 44100;
    r->wet   = 0.0f;      // по умолчанию реверб выключен
    r->room  = 0.5f;
    r->damp  = 0.5f;
    r->width = 1.0f;

    for (int c = 0; c < R2D_REVERB_CHANNELS; ++c) {
        const int spread = (c == 0) ? 0 : R2D_REVERB_STEREO_SPREAD;

        for (int i = 0; i < R2D_REVERB_COMBS; ++i) {
            R2DReverbComb *k = &r->comb[c][i];
            k->size = (int)r2d__scale_tuning(r2d__comb_tuning[i] + spread, r->rate) + 1;
            k->buf = (float *)SDL_calloc((size_t)k->size, sizeof(float));
            if (!k->buf) {
                r2d_reverb_shutdown(r);
                return false;
            }
            k->idx = 0;
            k->store = 0.0f;
            k->damp1 = 0.0f;
            k->damp2 = 1.0f;
            k->feedback = 0.5f;
        }

        for (int i = 0; i < R2D_REVERB_ALLPASSES; ++i) {
            R2DReverbAllpass *ap = &r->allpass[c][i];
            ap->size = (int)r2d__scale_tuning(r2d__allpass_tuning[i] + spread, r->rate) + 1;
            ap->buf = (float *)SDL_calloc((size_t)ap->size, sizeof(float));
            if (!ap->buf) {
                r2d_reverb_shutdown(r);
                return false;
            }
            ap->idx = 0;
            ap->feedback = 0.5f;   // в Freeverb — фиксированные 0.5
        }
    }

    r->ready = true;
    r2d_reverb_set_params(r, r->wet, r->room, r->damp, r->width);
    return true;
}

void r2d_reverb_shutdown(R2DAudioReverb *r)
{
    if (!r) return;
    for (int c = 0; c < R2D_REVERB_CHANNELS; ++c) {
        for (int i = 0; i < R2D_REVERB_COMBS; ++i) {
            SDL_free(r->comb[c][i].buf);
            r->comb[c][i].buf = NULL;
        }
        for (int i = 0; i < R2D_REVERB_ALLPASSES; ++i) {
            SDL_free(r->allpass[c][i].buf);
            r->allpass[c][i].buf = NULL;
        }
    }
    r->ready = false;
}

void r2d_reverb_set_params(R2DAudioReverb *r, float wet, float room, float damp, float width)
{
    if (!r) return;
    r->wet   = r2d__clampf(wet, 0.0f, 1.0f);
    r->room  = r2d__clampf(room, 0.0f, 1.0f);
    r->damp  = r2d__clampf(damp, 0.0f, 1.0f);
    r->width = r2d__clampf(width, 0.0f, 1.0f);

    if (!r->ready) return;

    // Формулы оригинала: обратная связь гребёнок от «размера» комнаты,
    // демпфирование — от параметра damp.
    const float feedback = r->room * 0.28f + 0.7f;
    const float damp1 = r->damp * 0.4f;
    const float damp2 = 1.0f - damp1;

    for (int c = 0; c < R2D_REVERB_CHANNELS; ++c) {
        for (int i = 0; i < R2D_REVERB_COMBS; ++i) {
            r->comb[c][i].feedback = feedback;
            r->comb[c][i].damp1 = damp1;
            r->comb[c][i].damp2 = damp2;
        }
    }
}

void r2d_reverb_process(R2DAudioReverb *r, float *pcm, int samples, int channels)
{
    if (!r || !r->ready || !pcm || samples <= 0 || r->wet <= 0.0f) return;
    if (channels <= 0) return;

    const int frames = samples / channels;
    if (frames <= 0) return;

    // Стерео-микс хвоста: wide хвост чуть расширяется, узкий — сходится к моно.
    const float wet1 = r->wet * (r->width * 0.5f + 0.5f);
    const float wet2 = r->wet * ((1.0f - r->width) * 0.5f);

    for (int f = 0; f < frames; ++f) {
        float *frame = &pcm[f * channels];
        const float in_l = frame[0];
        const float in_r = (channels > 1) ? frame[1] : in_l;
        const float input = (in_l + in_r) * R2D_REVERB_INPUT_GAIN;

        float out_l = 0.0f;
        float out_r = 0.0f;

        for (int i = 0; i < R2D_REVERB_COMBS; ++i) {
            R2DReverbComb *kl = &r->comb[0][i];
            R2DReverbComb *kr = &r->comb[1][i];

            float out = kl->buf[kl->idx];
            out = r2d__undenormalise(out);
            kl->store = out * kl->damp2 + kl->store * kl->damp1;
            kl->buf[kl->idx] = input + kl->store * kl->feedback;
            kl->idx = (kl->idx + 1) % kl->size;
            out_l += out;

            out = kr->buf[kr->idx];
            out = r2d__undenormalise(out);
            kr->store = out * kr->damp2 + kr->store * kr->damp1;
            kr->buf[kr->idx] = input + kr->store * kr->feedback;
            kr->idx = (kr->idx + 1) % kr->size;
            out_r += out;
        }

        for (int i = 0; i < R2D_REVERB_ALLPASSES; ++i) {
            R2DReverbAllpass *al = &r->allpass[0][i];
            R2DReverbAllpass *ar = &r->allpass[1][i];

            float bufout = al->buf[al->idx];
            bufout = r2d__undenormalise(bufout);
            al->buf[al->idx] = out_l + bufout * al->feedback;
            out_l = bufout - out_l;
            al->idx = (al->idx + 1) % al->size;

            bufout = ar->buf[ar->idx];
            bufout = r2d__undenormalise(bufout);
            ar->buf[ar->idx] = out_r + bufout * ar->feedback;
            out_r = bufout - out_r;
            ar->idx = (ar->idx + 1) % ar->size;
        }

        // Сухой сигнал проходит без изменений: реверб — добавка, а не замена.
        frame[0] = in_l + out_l * wet1 + out_r * wet2;
        if (channels > 1) {
            frame[1] = in_r + out_r * wet1 + out_l * wet2;
        }
    }
}
