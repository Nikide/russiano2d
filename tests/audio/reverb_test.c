// ===========================================================================
// Тест реверберации (Freeverb).
//
// Проверяет ровно то, ради чего она добавлена: выстрел в большой комнате
// должен звучать дольше и плотнее, чем в маленькой. Если тест позеленеет, а
// слух скажет обратное — врёт тест, а не ухо.
//
// Запуск: build/tests/r2d_reverb_test
// ===========================================================================

#include "audio_reverb.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#define RATE 44100

static int failures = 0;

static void check(int condition, const char *message)
{
    printf(("  ok   " ));
    if (!condition) {
        printf("FAIL %s\n", message);
        failures++;
        return;
    }
    printf("%s\n", message);
}

// Прогон импульса через реверб. early — RMS на 100–200 мс, tail — RMS после 750 мс.
static void run_impulse(float wet, float room, float damp, double *early, double *tail, double *peak)
{
    R2DAudioReverb rv;
    memset(&rv, 0, sizeof rv);
    if (!r2d_reverb_init(&rv, RATE)) {
        printf("  FAIL не инициализировался реверб\n");
        failures++;
        *early = *tail = *peak = 0;
        return;
    }
    r2d_reverb_set_params(&rv, wet, room, damp, 1.0f);

    const int block = 512;              // кадров
    float buf[512 * 2];

    double e_early = 0.0, e_tail = 0.0, pk = 0.0;
    long n_early = 0, n_tail = 0;
    const int total = RATE;             // одна секунда

    for (int f = 0; f < total; f += block) {
        for (int i = 0; i < block; ++i) {
            const float v = (f + i == 0) ? 1.0f : 0.0f;   // импульс
            buf[i * 2] = v;
            buf[i * 2 + 1] = v;
        }
        r2d_reverb_process(&rv, buf, block * 2, 2);

        for (int i = 0; i < block; ++i) {
            const int t = f + i;
            const double s = (double)buf[i * 2];
            if (!(s == s) || s > 1e6 || s < -1e6) {        // NaN или разбег
                printf("  FAIL реверб выдал мусор на кадре %d\n", t);
                failures++;
                r2d_reverb_shutdown(&rv);
                *early = *tail = *peak = 0;
                return;
            }
            const double a = fabs(s);
            if (a > pk) pk = a;
            if (t > RATE / 10 && t < RATE / 5) { e_early += s * s; n_early++; }
            if (t > RATE * 3 / 4)              { e_tail  += s * s; n_tail++; }
        }
    }

    *early = sqrt(e_early / (double)(n_early ? n_early : 1));
    *tail  = sqrt(e_tail  / (double)(n_tail  ? n_tail  : 1));
    *peak  = pk;

    r2d_reverb_shutdown(&rv);
}

int main(void)
{
    printf("Тест реверберации (Freeverb, %d Гц)\n", RATE);

    // --- 1. wet = 0 — сигнал проходит без изменений --------------------------
    {
        R2DAudioReverb rv;
        memset(&rv, 0, sizeof rv);
        r2d_reverb_init(&rv, RATE);
        r2d_reverb_set_params(&rv, 0.0f, 0.5f, 0.5f, 1.0f);

        float buf[512 * 2];
        for (int i = 0; i < 512; ++i) {
            buf[i * 2] = (i == 0) ? 1.0f : 0.0f;
            buf[i * 2 + 1] = (i == 0) ? 1.0f : 0.0f;
        }
        r2d_reverb_process(&rv, buf, 512 * 2, 2);

        check(fabs(buf[0] - 1.0f) < 1e-6f, "wet=0: импульс не тронут");
        check(fabs(buf[2]) < 1e-9f && fabs(buf[100]) < 1e-9f, "wet=0: хвоста нет");
        r2d_reverb_shutdown(&rv);
    }

    // --- 2. Маленькая комната против зала ------------------------------------
    double small_early = 0, small_tail = 0, small_peak = 0;
    double big_early = 0,   big_tail = 0,   big_peak = 0;
    run_impulse(0.35f, 0.15f, 0.85f, &small_early, &small_tail, &small_peak);   // кладовка 5×5
    run_impulse(0.60f, 0.95f, 0.20f, &big_early,   &big_tail,   &big_peak);     // зал 20×20

    printf("  small: early=%.5f tail=%.5f peak=%.4f\n", small_early, small_tail, small_peak);
    printf("  big:   early=%.5f tail=%.5f peak=%.4f\n", big_early, big_tail, big_peak);

    check(small_tail > 1e-6, "маленькая комната: хвост слышен");
    check(big_tail > small_tail * 2.0, "зал: хвост заметно длиннее, чем в комнате");
    check(small_early > small_tail, "маленькая комната: хвост затухает");
    check(big_early > big_tail * 0.5, "зал: хвост держится дольше");
    check(big_peak > 0.0 && small_peak > 0.0, "обе комнаты дают звук");

    printf(failures ? "ПРОВАЛЕНО: %d\n" : "Все проверки пройдены\n", failures);
    return failures ? 1 : 0;
}
