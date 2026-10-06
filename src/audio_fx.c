// ===========================================================================
// DSP-эффекты каналов и шин — реализация.
//
// Все эффекты работают по одному шаблону: пройти кадры буфера и переписать
// отсчёты на месте. Никаких аллокаций внутри цикла, никакого обращения к
// SDL_mixer — только математика. Поэтому модуль собирается и тестируется без
// звукового устройства (tests/audio/fx_test.c).
// ===========================================================================
#include "audio_fx.h"

#include <math.h>
#include <string.h>

#include <SDL3/SDL.h>

static const char *const r2d__fx_names[] = {
    "none", "lowpass", "highpass", "echo", "tremolo", "bitcrush", "ringmod", "reverb",
};

int r2d_audio_fx_count(void)
{
    return (int)(sizeof(r2d__fx_names) / sizeof(r2d__fx_names[0]));
}

const char *r2d_audio_fx_name(int index)
{
    if (index < 0 || index >= r2d_audio_fx_count()) return "none";
    return r2d__fx_names[index];
}

const char *r2d_audio_fx_kind_name(int kind)
{
    return r2d_audio_fx_name(kind);
}

static int r2d__fx_kind_of(const char *kind)
{
    if (!kind || !*kind) return R2D_AUDIO_FX_NONE;
    for (int i = 0; i < r2d_audio_fx_count(); ++i) {
        if (SDL_strcmp(kind, r2d__fx_names[i]) == 0) return i;
    }
    return -1;
}

/** Однополюсный коэффициент сглаживания по частоте среза. */
static float r2d__one_pole(float cutoff_hz, int rate)
{
    if (rate <= 0) rate = 44100;
    float fc = cutoff_hz > 0.0f ? cutoff_hz : 800.0f;
    const float nyquist = (float)rate * 0.45f;
    if (fc > nyquist) fc = nyquist;
    return 1.0f - SDL_expf(-2.0f * SDL_PI_F * fc / (float)rate);
}

static float r2d__clampf(float v, float lo, float hi)
{
    if (!(v > lo)) return lo;
    if (v > hi) return hi;
    return v;
}

bool r2d_audio_fx_set(R2DAudioFx *fx, int rate, const char *kind, float p1, float p2)
{
    if (!fx) return false;

    const int wanted = r2d__fx_kind_of(kind);
    if (wanted < 0) return false;

    fx->kind = R2D_AUDIO_FX_NONE;
    r2d_audio_fx_reset(fx);

    if (wanted == R2D_AUDIO_FX_NONE) return true;

    if (wanted == R2D_AUDIO_FX_LOWPASS || wanted == R2D_AUDIO_FX_HIGHPASS) {
        // По умолчанию: ФНЧ срезает «пелену» на 800 Гц, ФВЧ убирает гул на 200 Гц.
        const float def = (wanted == R2D_AUDIO_FX_LOWPASS) ? 800.0f : 200.0f;
        fx->p1 = r2d__one_pole(p1 > 0.0f ? p1 : def, rate);
        fx->kind = wanted;
        return true;
    }

    if (wanted == R2D_AUDIO_FX_ECHO) {
        if (!fx->line) {
            fx->line = (float *)SDL_calloc((size_t)R2D_AUDIO_FX_FRAMES * 2, sizeof(float));
            if (!fx->line) {
                SDL_LogError(SDL_LOG_CATEGORY_AUDIO, "не удалось выделить линию задержки эха");
                return false;
            }
        }
        fx->p1 = p1 > 0.0f ? p1 : 180.0f;              // задержка, мс
        fx->p2 = r2d__clampf(p2 > 0.0f ? p2 : 0.35f, 0.0f, 0.9f);
        fx->kind = R2D_AUDIO_FX_ECHO;
        return true;
    }

    if (wanted == R2D_AUDIO_FX_TREMOLO) {
        fx->p1 = r2d__clampf(p1 > 0.0f ? p1 : 5.0f, 0.01f, 40.0f);     // Гц
        fx->p2 = r2d__clampf(p2 >= 0.0f ? p2 : 0.5f, 0.0f, 1.0f);      // глубина
        fx->kind = R2D_AUDIO_FX_TREMOLO;
        return true;
    }

    if (wanted == R2D_AUDIO_FX_BITCRUSH) {
        fx->p1 = r2d__clampf(p1 > 0.0f ? p1 : 6.0f, 1.0f, 16.0f);      // бит
        fx->p2 = r2d__clampf(p2 > 0.0f ? p2 : 1.0f, 1.0f, 64.0f);      // прореживание
        fx->kind = R2D_AUDIO_FX_BITCRUSH;
        return true;
    }

    if (wanted == R2D_AUDIO_FX_RINGMOD) {
        fx->p1 = r2d__clampf(p1 > 0.0f ? p1 : 220.0f, 0.5f, 8000.0f);  // Гц
        fx->p2 = r2d__clampf(p2 >= 0.0f ? p2 : 1.0f, 0.0f, 1.0f);      // доля модуляции
        fx->kind = R2D_AUDIO_FX_RINGMOD;
        return true;
    }

    // Реверб-шина: p1 — посыл (доля сигнала в хвост), p2 — размер помещения.
    if (wanted == R2D_AUDIO_FX_REVERB) {
        if (!fx->reverb) {
            fx->reverb = (R2DAudioReverb *)SDL_calloc(1, sizeof(R2DAudioReverb));
            if (!fx->reverb) {
                SDL_LogError(SDL_LOG_CATEGORY_AUDIO, "не удалось выделить хвост реверба");
                return false;
            }
            if (!r2d_reverb_init(fx->reverb, rate)) {
                SDL_free(fx->reverb);
                fx->reverb = NULL;
                return false;
            }
        }
        const float send = r2d__clampf(p1 > 0.0f ? p1 : 0.35f, 0.0f, 1.0f);
        const float room = r2d__clampf(p2 > 0.0f ? p2 : 0.5f, 0.0f, 1.0f);
        r2d_reverb_set_params(fx->reverb, send, room, 0.4f, 0.8f);
        fx->p1 = send;
        fx->p2 = room;
        fx->kind = R2D_AUDIO_FX_REVERB;
        return true;
    }

    return false;
}

bool r2d_audio_fx_set_reverb(R2DAudioFx *fx, int rate, float send, float room,
                             float damp, float width)
{
    if (!fx) return false;
    if (!r2d_audio_fx_set(fx, rate, "reverb", send, room)) return false;
    if (fx->reverb) {
        r2d_reverb_set_params(fx->reverb, r2d__clampf(send, 0.0f, 1.0f),
                              r2d__clampf(room, 0.0f, 1.0f),
                              r2d__clampf(damp, 0.0f, 1.0f),
                              r2d__clampf(width, 0.0f, 1.0f));
        fx->p1 = r2d__clampf(send, 0.0f, 1.0f);
        fx->p2 = r2d__clampf(room, 0.0f, 1.0f);
    }
    return true;
}

void r2d_audio_fx_reset(R2DAudioFx *fx)
{
    if (!fx) return;
    fx->z[0] = fx->z[1] = 0.0f;
    fx->x1[0] = fx->x1[1] = 0.0f;
    fx->phase = 0.0f;
    fx->hold[0] = fx->hold[1] = 0.0f;
    fx->hold_left = 0;
    fx->pos = 0;
    if (fx->line) {
        SDL_memset(fx->line, 0, sizeof(float) * 2 * R2D_AUDIO_FX_FRAMES);
    }
    if (fx->reverb) {
        // Хвост от прошлого включения звучал бы поверх нового — сбрасываем
        // буферы, оставляя настройки.
        const float wet = fx->reverb->wet;
        const float room = fx->reverb->room;
        const float damp = fx->reverb->damp;
        const float width = fx->reverb->width;
        r2d_reverb_shutdown(fx->reverb);
        r2d_reverb_init(fx->reverb, fx->reverb->rate);
        r2d_reverb_set_params(fx->reverb, wet, room, damp, width);
    }
}

void r2d_audio_fx_shutdown(R2DAudioFx *fx)
{
    if (!fx) return;
    if (fx->line) {
        SDL_free(fx->line);
        fx->line = NULL;
    }
    if (fx->reverb) {
        r2d_reverb_shutdown(fx->reverb);
        SDL_free(fx->reverb);
        fx->reverb = NULL;
    }
    fx->kind = R2D_AUDIO_FX_NONE;
}

void r2d_audio_fx_process(R2DAudioFx *fx, const SDL_AudioSpec *spec, float *pcm, int samples)
{
    if (!fx || fx->kind == R2D_AUDIO_FX_NONE || !pcm || samples <= 0) return;

    const int ch = (spec && spec->channels > 0) ? spec->channels : 1;
    const int frames = samples / ch;
    if (frames <= 0) return;

    const int rate = (spec && spec->freq > 0) ? spec->freq : 44100;
    // Обрабатываем не больше двух каналов: звук движка стерео, а у 5.1
    // остальные каналы просто проходят без обработки — это честнее, чем
    // писать за границу буфера.
    const int proc = ch > 2 ? 2 : ch;

    switch (fx->kind) {
    case R2D_AUDIO_FX_LOWPASS: {
        const float a = fx->p1;
        for (int f = 0; f < frames; ++f) {
            for (int c = 0; c < proc; ++c) {
                float *s = &pcm[f * ch + c];
                fx->z[c] += a * (*s - fx->z[c]);
                *s = fx->z[c];
            }
        }
        break;
    }

    case R2D_AUDIO_FX_HIGHPASS: {
        // Однополюсный ФВЧ: y = a * (y_prev + x - x_prev).
        const float a = fx->p1;
        for (int f = 0; f < frames; ++f) {
            for (int c = 0; c < proc; ++c) {
                float *s = &pcm[f * ch + c];
                const float x = *s;
                fx->z[c] = a * (fx->z[c] + x - fx->x1[c]);
                fx->x1[c] = x;
                *s = fx->z[c];
            }
        }
        break;
    }

    case R2D_AUDIO_FX_ECHO: {
        if (!fx->line) break;
        const int cap = R2D_AUDIO_FX_FRAMES;
        int delay = (int)(fx->p1 * (float)rate / 1000.0f);
        if (delay < 1) delay = 1;
        if (delay >= cap) delay = cap - 1;
        const float feedback = fx->p2;
        const int line_ch = proc;
        for (int f = 0; f < frames; ++f) {
            int rd = fx->pos - delay;
            if (rd < 0) rd += cap;
            const int wr_base = fx->pos * line_ch;
            const int rd_base = rd * line_ch;
            for (int c = 0; c < line_ch; ++c) {
                float *s = &pcm[f * ch + c];
                const float out = *s + fx->line[rd_base + c] * feedback;
                fx->line[wr_base + c] = out;
                *s = out;
            }
            fx->pos = (fx->pos + 1) % cap;
        }
        break;
    }

    case R2D_AUDIO_FX_TREMOLO: {
        const float step = fx->p1 / (float)rate;     // доля периода за кадр
        const float depth = fx->p2;
        for (int f = 0; f < frames; ++f) {
            const float lfo = 0.5f - 0.5f * SDL_cosf(fx->phase * 2.0f * SDL_PI_F);
            const float gain = 1.0f - depth * lfo;
            for (int c = 0; c < proc; ++c) {
                pcm[f * ch + c] *= gain;
            }
            fx->phase += step;
            if (fx->phase >= 1.0f) fx->phase -= 1.0f;
        }
        break;
    }

    case R2D_AUDIO_FX_BITCRUSH: {
        const float bits = fx->p1;
        const float levels = SDL_powf(2.0f, bits - 1.0f);
        int step = (int)(fx->p2 + 0.5f);
        if (step < 1) step = 1;
        for (int f = 0; f < frames; ++f) {
            if (fx->hold_left <= 0) {
                for (int c = 0; c < proc; ++c) {
                    const float x = pcm[f * ch + c];
                    fx->hold[c] = SDL_roundf(x * levels) / levels;
                }
                fx->hold_left = step;
            }
            for (int c = 0; c < proc; ++c) {
                pcm[f * ch + c] = fx->hold[c];
            }
            fx->hold_left--;
        }
        break;
    }

    case R2D_AUDIO_FX_RINGMOD: {
        const float step = fx->p1 / (float)rate;
        const float mix = fx->p2;
        for (int f = 0; f < frames; ++f) {
            const float carrier = SDL_sinf(fx->phase * 2.0f * SDL_PI_F);
            for (int c = 0; c < proc; ++c) {
                float *s = &pcm[f * ch + c];
                *s = *s * (1.0f - mix + mix * carrier);
            }
            fx->phase += step;
            if (fx->phase >= 1.0f) fx->phase -= 1.0f;
        }
        break;
    }

    case R2D_AUDIO_FX_REVERB: {
        // Сухой сигнал остаётся, хвост добавляется — это посыльная шина, а не
        // «замена сигнала на реверб».
        if (fx->reverb) r2d_reverb_process(fx->reverb, pcm, samples, ch);
        break;
    }

    default:
        break;
    }
}
