// ===========================================================================
// Реверберация помещения (Freeverb).
//
// Алгоритм Jezar at Dreampoint, public domain; в SoLoud он лежит обёрткой
// вокруг того же Revmodel, и мы берём именно алгоритм, а не движок
// (см. docs/GAP_ANALYSIS.md §8).
//
// Зачем: SDL_mixer 3.2 не содержит готовых DSP-эффектов, а разницу между
// комнатой 5×5 и залом 20×20 даёт как раз хвост реверберации. Обработка идёт
// в аудиопотоке (MIX_SetPostMixCallback), поэтому:
//   * все буферы выделяются один раз в r2d_reverb_init и только читаются/пишутся;
//   * параметры (wet/room/damp/width) меняются из потока игры как обычные float.
// ===========================================================================
#pragma once

#include <stdbool.h>

#define R2D_REVERB_COMBS     8
#define R2D_REVERB_ALLPASSES 4
#define R2D_REVERB_CHANNELS  2

typedef struct R2DReverbComb {
    float *buf;
    int    size;
    int    idx;
    float  store;     // состояние демпфирующего фильтра
    float  damp1;
    float  damp2;
    float  feedback;
} R2DReverbComb;

typedef struct R2DReverbAllpass {
    float *buf;
    int    size;
    int    idx;
    float  feedback;
} R2DReverbAllpass;

typedef struct R2DAudioReverb {
    bool  ready;
    int   rate;

    // 0 — сухой сигнал без хвоста, 1 — максимальная доля реверба.
    float wet;
    float room;      // «размер» помещения: длина хвоста
    float damp;      // демпфирование высоких: 0 — ярко, 1 — глухо
    float width;     // стерео-ширина хвоста

    R2DReverbComb    comb[R2D_REVERB_CHANNELS][R2D_REVERB_COMBS];
    R2DReverbAllpass allpass[R2D_REVERB_CHANNELS][R2D_REVERB_ALLPASSES];
} R2DAudioReverb;

// Готовит линии задержки под конкретную частоту микшера. false — нет памяти.
bool r2d_reverb_init(R2DAudioReverb *r, int sample_rate);
void r2d_reverb_shutdown(R2DAudioReverb *r);

// Значения вне диапазонов зажимаются. wet = 0 полностью выключает обработку.
void r2d_reverb_set_params(R2DAudioReverb *r, float wet, float room, float damp, float width);

// Обрабатывает interleaved float32 (samples — общее число сэмплов, как в
// колбэках SDL_mixer). Каналы больше двух не трогаются.
void r2d_reverb_process(R2DAudioReverb *r, float *pcm, int samples, int channels);
