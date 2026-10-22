// ===========================================================================
// Процедурный синтезатор звуковых эффектов (SFX): описание → PCM → WAV.
//
// Это ТОЛЬКО ядро синтеза (без интерфейса): модель параметров, пресеты и
// рендер. Алгоритм — классический sfxr (Tomas Pettersson, MIT); набор
// параметров и имена пресетов совместимы с rFXGen (raylib technologies, zlib).
// Целиком rFXGen не встраивается: у него интерфейс на raylib/raygui, движку
// нужен только расчёт сэмплов.
//
//   R2DSfx fx; r2d_sfx_preset(&fx, "coin", 7);
//   int16_t *pcm = malloc(r2d_sfx_max_samples() * 2);
//   size_t n = r2d_sfx_render(&fx, pcm, r2d_sfx_max_samples());
//   r2d_sfx_write_wav("coin.wav", pcm, n);
//
// Синтез детерминирован: одни и те же параметры и seed дают те же сэмплы.
// Формат выхода фиксирован: 44100 Гц, моно, 16 бит.
// ===========================================================================
#pragma once

#include <stddef.h>
#include <stdint.h>

#define R2D_SFX_RATE 44100

enum { R2D_SFX_SQUARE = 0, R2D_SFX_SAW = 1, R2D_SFX_SINE = 2, R2D_SFX_NOISE = 3 };

typedef struct R2DSfx {
    int wave;                        // 0 квадрат, 1 пила, 2 синус, 3 шум
    float attack, sustain, punch, decay;           // огибающая, 0..1
    float freq, min_freq;                          // старт и нижний предел частоты, 0..1
    float slide, delta_slide;                      // скольжение высоты, -1..1
    float vibrato_depth, vibrato_speed;            // вибрато, 0..1
    float change_amount, change_speed;             // скачок высоты (арпеджио): -1..1 / 0..1
    float duty, duty_sweep;                        // скважность квадрата 0..1 / -1..1
    float repeat;                                  // перезапуск высоты, 0..1
    float phaser_offset, phaser_sweep;             // фазер, -1..1
    float lpf, lpf_sweep, lpf_resonance;           // ФНЧ: срез 0..1 (1 — выкл.), ход -1..1, резонанс 0..1
    float hpf, hpf_sweep;                          // ФВЧ: срез 0..1, ход -1..1
    float volume;                                  // общая громкость 0..1 (по умолчанию 0.5)
    uint32_t seed;                                 // зерно шума (волна «noise»)
} R2DSfx;

typedef struct R2DSfxStats {
    size_t samples;
    float seconds;
    float peak;          // 0..1
    float rms;           // 0..1
    int clipped;         // сколько сэмплов упёрлось в потолок
    float freq_hz;       // оценка основного тона по пересечениям нуля (0 — шум/тишина)
    int env_bins;        // 24
    float env[24];       // огибающая: пик в каждой из 24 равных долей, 0..1
} R2DSfxStats;

/** Числовые поля дескриптора по именам (общая таблица для CLI и привязки к JS). */
typedef struct R2DSfxField { const char *name; size_t offset; float lo, hi; } R2DSfxField;
const R2DSfxField *r2d_sfx_fields(int *count);
const char *r2d_sfx_wave_name(int wave);
/** -1, если имени волны нет (square, saw, sine, noise). */
int r2d_sfx_wave_from_name(const char *name);

/** Параметры по умолчанию: тихий квадрат средней высоты. */
void r2d_sfx_defaults(R2DSfx *fx);

/** Привести поля к допустимым диапазонам (NaN → значение по умолчанию). */
void r2d_sfx_clamp(R2DSfx *fx);

/**
 * Пресет по имени: coin, laser, explosion, powerup, hurt, jump, blip, random.
 * Разные seed дают разные, но однотипные звуки. 0 — готово, -1 — нет такого имени.
 */
int r2d_sfx_preset(R2DSfx *fx, const char *name, uint32_t seed);

/** Число и имена пресетов (для справок и ошибок). */
int r2d_sfx_preset_count(void);
const char *r2d_sfx_preset_name(int index);

/** Слегка изменить звук (вариация): amount 0..1, обычно 0.05..0.3. */
void r2d_sfx_mutate(R2DSfx *fx, uint32_t seed, float amount);

/**
 * Описание словами → параметры. Распознаёт тип звука (ru/en: «монета», «laser», «взрыв»,
 * «прыжок», «удар», «бонус», «клик»…) и модификаторы («высокий/low», «короткий/long»,
 * «громкий/quiet», «грубый/мягкий»). Возвращает имя выбранного пресета или NULL, если
 * ни одно слово не опознано (параметры тогда не меняются).
 */
const char *r2d_sfx_from_text(R2DSfx *fx, const char *text, uint32_t seed);

/** Верхняя оценка числа сэмплов одного звука. */
size_t r2d_sfx_max_samples(void);

/** Рендер в PCM16 моно 44100 Гц. Возвращает число записанных сэмплов (≤ cap). */
size_t r2d_sfx_render(const R2DSfx *fx, int16_t *out, size_t cap);

/** Статистика готового звука: по ней модель без слуха проверяет результат. */
void r2d_sfx_analyze(const int16_t *pcm, size_t n, R2DSfxStats *st);

/** WAV (PCM16 моно 44100). 0 — записан, -1 — ошибка файла. */
int r2d_sfx_write_wav(const char *path, const int16_t *pcm, size_t n);

/** .rfx в раскладке rFXGen (заголовок «rFX », версия 200, 96 байт параметров). 0 — готово. */
int r2d_sfx_save_rfx(const char *path, const R2DSfx *fx);
int r2d_sfx_load_rfx(const char *path, R2DSfx *fx);
