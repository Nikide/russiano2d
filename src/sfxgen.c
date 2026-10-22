// Процедурный синтезатор SFX: см. sfxgen.h. Алгоритм sfxr; параметры и пресеты — как у rFXGen.
#include "sfxgen.h"

#include <ctype.h>
#include <math.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SFX_PI 3.14159265358979323846f
#define SFX_ENV_MAX 100000

// ---- ГПСЧ: свой, чтобы результат не зависел от платформенного rand() ----
typedef struct { uint32_t s; } Rng;

static uint32_t rng_next(Rng *r)
{
    uint32_t x = r->s ? r->s : 0x9E3779B9u;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    r->s = x;
    return x;
}
static float rng_f(Rng *r, float range) { return (float)(rng_next(r) >> 8) / 16777216.0f * range; }   // [0, range)
static int rng_i(Rng *r, int n) { return (int)(rng_next(r) % (uint32_t)(n + 1)); }                      // 0..n включительно
static void rng_seed(Rng *r, uint32_t seed)
{
    r->s = seed * 2654435761u + 0x7F4A7C15u;
    for (int i = 0; i < 4; ++i) rng_next(r);
}

static float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
static float fixf(float v, float lo, float hi, float dflt)
{
    if (v != v) return dflt;
    return clampf(v, lo, hi);
}

#define F(n, f, lo, hi) { n, offsetof(R2DSfx, f), lo, hi }
static const R2DSfxField k_fields[] = {
    F("attack", attack, 0, 1), F("sustain", sustain, 0, 1), F("punch", punch, 0, 1), F("decay", decay, 0, 1),
    F("freq", freq, 0, 1), F("minFreq", min_freq, 0, 1), F("slide", slide, -1, 1), F("deltaSlide", delta_slide, -1, 1),
    F("vibratoDepth", vibrato_depth, 0, 1), F("vibratoSpeed", vibrato_speed, 0, 1),
    F("changeAmount", change_amount, -1, 1), F("changeSpeed", change_speed, 0, 1),
    F("duty", duty, 0, 1), F("dutySweep", duty_sweep, -1, 1), F("repeat", repeat, 0, 1),
    F("phaserOffset", phaser_offset, -1, 1), F("phaserSweep", phaser_sweep, -1, 1),
    F("lpf", lpf, 0, 1), F("lpfSweep", lpf_sweep, -1, 1), F("lpfResonance", lpf_resonance, 0, 1),
    F("hpf", hpf, 0, 1), F("hpfSweep", hpf_sweep, -1, 1), F("volume", volume, 0, 1),
};
#undef F

const R2DSfxField *r2d_sfx_fields(int *count) { if (count) *count = (int)(sizeof k_fields / sizeof k_fields[0]); return k_fields; }

static const char *const k_waves[] = { "square", "saw", "sine", "noise" };
const char *r2d_sfx_wave_name(int wave) { return wave >= 0 && wave < 4 ? k_waves[wave] : "square"; }
int r2d_sfx_wave_from_name(const char *name)
{
    for (int i = 0; name && i < 4; ++i) if (!strcmp(name, k_waves[i])) return i;
    return -1;
}

void r2d_sfx_defaults(R2DSfx *fx)
{
    memset(fx, 0, sizeof *fx);
    fx->wave = R2D_SFX_SQUARE;
    fx->sustain = 0.3f;
    fx->decay = 0.4f;
    fx->freq = 0.3f;
    fx->duty = 0.0f;
    fx->lpf = 1.0f;
    fx->volume = 0.5f;
    fx->seed = 1;
}

void r2d_sfx_clamp(R2DSfx *fx)
{
    if (fx->wave < 0 || fx->wave > 3) fx->wave = R2D_SFX_SQUARE;
    fx->attack = fixf(fx->attack, 0, 1, 0);
    fx->sustain = fixf(fx->sustain, 0, 1, 0.3f);
    fx->punch = fixf(fx->punch, 0, 1, 0);
    fx->decay = fixf(fx->decay, 0, 1, 0.4f);
    fx->freq = fixf(fx->freq, 0, 1, 0.3f);
    fx->min_freq = fixf(fx->min_freq, 0, 1, 0);
    fx->slide = fixf(fx->slide, -1, 1, 0);
    fx->delta_slide = fixf(fx->delta_slide, -1, 1, 0);
    fx->vibrato_depth = fixf(fx->vibrato_depth, 0, 1, 0);
    fx->vibrato_speed = fixf(fx->vibrato_speed, 0, 1, 0);
    fx->change_amount = fixf(fx->change_amount, -1, 1, 0);
    fx->change_speed = fixf(fx->change_speed, 0, 1, 0);
    fx->duty = fixf(fx->duty, 0, 1, 0);
    fx->duty_sweep = fixf(fx->duty_sweep, -1, 1, 0);
    fx->repeat = fixf(fx->repeat, 0, 1, 0);
    fx->phaser_offset = fixf(fx->phaser_offset, -1, 1, 0);
    fx->phaser_sweep = fixf(fx->phaser_sweep, -1, 1, 0);
    fx->lpf = fixf(fx->lpf, 0, 1, 1);
    fx->lpf_sweep = fixf(fx->lpf_sweep, -1, 1, 0);
    fx->lpf_resonance = fixf(fx->lpf_resonance, 0, 1, 0);
    fx->hpf = fixf(fx->hpf, 0, 1, 0);
    fx->hpf_sweep = fixf(fx->hpf_sweep, -1, 1, 0);
    fx->volume = fixf(fx->volume, 0, 1, 0.5f);
}

// ---- Пресеты ---------------------------------------------------------------

static const char *const k_presets[] = { "coin", "laser", "explosion", "powerup", "hurt", "jump", "blip", "random" };

int r2d_sfx_preset_count(void) { return (int)(sizeof k_presets / sizeof k_presets[0]); }
const char *r2d_sfx_preset_name(int i) { return i >= 0 && i < r2d_sfx_preset_count() ? k_presets[i] : NULL; }

static void gen_coin(R2DSfx *f, Rng *r)
{
    f->freq = 0.4f + rng_f(r, 0.5f);
    f->attack = 0; f->sustain = rng_f(r, 0.1f); f->decay = 0.1f + rng_f(r, 0.4f); f->punch = 0.3f + rng_f(r, 0.3f);
    if (rng_i(r, 1)) { f->change_speed = 0.5f + rng_f(r, 0.2f); f->change_amount = 0.2f + rng_f(r, 0.4f); }
}

static void gen_laser(R2DSfx *f, Rng *r)
{
    f->wave = rng_i(r, 2);
    if (f->wave == R2D_SFX_SINE && rng_i(r, 1)) f->wave = rng_i(r, 1);
    f->freq = 0.5f + rng_f(r, 0.5f);
    f->min_freq = f->freq - 0.2f - rng_f(r, 0.6f);
    if (f->min_freq < 0.2f) f->min_freq = 0.2f;
    f->slide = -0.15f - rng_f(r, 0.2f);
    if (rng_i(r, 2) == 0) { f->freq = 0.3f + rng_f(r, 0.6f); f->min_freq = rng_f(r, 0.1f); f->slide = -0.35f - rng_f(r, 0.3f); }
    if (rng_i(r, 1)) { f->duty = rng_f(r, 0.5f); f->duty_sweep = rng_f(r, 0.2f); }
    else { f->duty = 0.4f + rng_f(r, 0.5f); f->duty_sweep = -rng_f(r, 0.7f); }
    f->attack = 0; f->sustain = 0.1f + rng_f(r, 0.2f); f->decay = rng_f(r, 0.4f);
    if (rng_i(r, 1)) f->punch = rng_f(r, 0.3f);
    if (rng_i(r, 2) == 0) { f->phaser_offset = rng_f(r, 0.2f); f->phaser_sweep = -rng_f(r, 0.2f); }
    if (rng_i(r, 1)) f->hpf = rng_f(r, 0.3f);
}

static void gen_explosion(R2DSfx *f, Rng *r)
{
    f->wave = R2D_SFX_NOISE;
    if (rng_i(r, 1)) { f->freq = 0.1f + rng_f(r, 0.4f); f->slide = -0.1f + rng_f(r, 0.4f); }
    else { f->freq = 0.2f + rng_f(r, 0.7f); f->slide = -0.2f - rng_f(r, 0.2f); }
    f->freq *= f->freq;
    if (rng_i(r, 4) == 0) f->slide = 0;
    if (rng_i(r, 2) == 0) f->repeat = 0.3f + rng_f(r, 0.5f);
    f->attack = 0; f->sustain = 0.1f + rng_f(r, 0.3f); f->decay = rng_f(r, 0.5f);
    if (rng_i(r, 1) == 0) { f->phaser_offset = -0.3f + rng_f(r, 0.9f); f->phaser_sweep = -rng_f(r, 0.3f); }
    f->punch = 0.2f + rng_f(r, 0.6f);
    if (rng_i(r, 1)) { f->vibrato_depth = rng_f(r, 0.7f); f->vibrato_speed = rng_f(r, 0.6f); }
    if (rng_i(r, 2) == 0) { f->change_speed = 0.6f + rng_f(r, 0.3f); f->change_amount = 0.8f - rng_f(r, 1.6f); }
}

static void gen_powerup(R2DSfx *f, Rng *r)
{
    if (rng_i(r, 1)) f->wave = R2D_SFX_SAW; else f->duty = rng_f(r, 0.6f);
    if (rng_i(r, 1)) { f->freq = 0.2f + rng_f(r, 0.3f); f->slide = 0.1f + rng_f(r, 0.4f); f->repeat = 0.4f + rng_f(r, 0.4f); }
    else {
        f->freq = 0.2f + rng_f(r, 0.3f); f->slide = 0.05f + rng_f(r, 0.2f);
        if (rng_i(r, 1)) { f->vibrato_depth = rng_f(r, 0.7f); f->vibrato_speed = rng_f(r, 0.6f); }
    }
    f->attack = 0; f->sustain = rng_f(r, 0.4f); f->decay = 0.1f + rng_f(r, 0.4f);
}

static void gen_hurt(R2DSfx *f, Rng *r)
{
    f->wave = rng_i(r, 2);
    if (f->wave == R2D_SFX_SINE) f->wave = R2D_SFX_NOISE;
    if (f->wave == R2D_SFX_SQUARE) f->duty = rng_f(r, 0.6f);
    f->freq = 0.2f + rng_f(r, 0.6f); f->slide = -0.3f - rng_f(r, 0.4f);
    f->attack = 0; f->sustain = rng_f(r, 0.1f); f->decay = 0.1f + rng_f(r, 0.2f);
    if (rng_i(r, 1)) f->hpf = rng_f(r, 0.3f);
}

static void gen_jump(R2DSfx *f, Rng *r)
{
    f->wave = R2D_SFX_SQUARE; f->duty = rng_f(r, 0.6f);
    f->freq = 0.3f + rng_f(r, 0.3f); f->slide = 0.1f + rng_f(r, 0.2f);
    f->attack = 0; f->sustain = 0.1f + rng_f(r, 0.3f); f->decay = 0.1f + rng_f(r, 0.2f);
    if (rng_i(r, 1)) f->hpf = rng_f(r, 0.3f);
    if (rng_i(r, 1)) f->lpf = 1.0f - rng_f(r, 0.6f);
}

static void gen_blip(R2DSfx *f, Rng *r)
{
    f->wave = rng_i(r, 1);
    if (f->wave == R2D_SFX_SQUARE) f->duty = rng_f(r, 0.6f);
    f->freq = 0.2f + rng_f(r, 0.4f);
    f->attack = 0; f->sustain = 0.1f + rng_f(r, 0.1f); f->decay = rng_f(r, 0.2f); f->hpf = 0.1f;
}

static void gen_random(R2DSfx *f, Rng *r)
{
    f->wave = rng_i(r, 3);
    f->freq = powf(rng_f(r, 2.0f) - 1.0f, 2.0f);
    if (rng_i(r, 1)) f->freq = powf(rng_f(r, 2.0f) - 1.0f, 3.0f) + 0.5f;
    f->min_freq = 0.0f;
    f->slide = powf(rng_f(r, 2.0f) - 1.0f, 5.0f);
    if (f->freq > 0.7f && f->slide > 0.2f) f->slide = -f->slide;
    if (f->freq < 0.2f && f->slide < -0.05f) f->slide = -f->slide;
    f->delta_slide = powf(rng_f(r, 2.0f) - 1.0f, 3.0f);
    f->duty = rng_f(r, 2.0f) - 1.0f;
    f->duty_sweep = powf(rng_f(r, 2.0f) - 1.0f, 3.0f);
    f->vibrato_depth = powf(rng_f(r, 2.0f) - 1.0f, 3.0f);
    f->vibrato_speed = rng_f(r, 2.0f) - 1.0f;
    f->attack = powf(rng_f(r, 2.0f) - 1.0f, 3.0f);
    f->sustain = powf(rng_f(r, 2.0f) - 1.0f, 2.0f);
    f->decay = rng_f(r, 2.0f) - 1.0f;
    f->punch = powf(rng_f(r, 0.8f), 2.0f);
    if (f->attack + f->sustain + f->decay < 0.2f) { f->sustain += 0.2f + rng_f(r, 0.3f); f->decay += 0.2f + rng_f(r, 0.3f); }
    f->lpf = 1.0f - powf(rng_f(r, 1.0f), 3.0f);
    f->lpf_sweep = powf(rng_f(r, 2.0f) - 1.0f, 3.0f);
    if (f->lpf < 0.1f && f->lpf_sweep < -0.05f) f->lpf_sweep = -f->lpf_sweep;
    f->hpf = powf(rng_f(r, 1.0f), 5.0f);
    f->hpf_sweep = powf(rng_f(r, 2.0f) - 1.0f, 5.0f);
    f->phaser_offset = powf(rng_f(r, 2.0f) - 1.0f, 3.0f);
    f->phaser_sweep = powf(rng_f(r, 2.0f) - 1.0f, 3.0f);
    f->repeat = rng_f(r, 2.0f) - 1.0f;
    f->change_speed = rng_f(r, 2.0f) - 1.0f;
    f->change_amount = rng_f(r, 2.0f) - 1.0f;
}

int r2d_sfx_preset(R2DSfx *fx, const char *name, uint32_t seed)
{
    if (!fx || !name) return -1;
    Rng r; rng_seed(&r, seed);
    R2DSfx f; r2d_sfx_defaults(&f);
    f.sustain = 0; f.decay = 0; f.freq = 0; f.duty = 0;     // пресеты задают сами; шум — от seed
    f.seed = seed ? seed : 1;
    if (!strcmp(name, "coin")) gen_coin(&f, &r);
    else if (!strcmp(name, "laser")) gen_laser(&f, &r);
    else if (!strcmp(name, "explosion")) gen_explosion(&f, &r);
    else if (!strcmp(name, "powerup")) gen_powerup(&f, &r);
    else if (!strcmp(name, "hurt")) gen_hurt(&f, &r);
    else if (!strcmp(name, "jump")) gen_jump(&f, &r);
    else if (!strcmp(name, "blip")) gen_blip(&f, &r);
    else if (!strcmp(name, "random")) gen_random(&f, &r);
    else return -1;
    r2d_sfx_clamp(&f);
    *fx = f;
    return 0;
}

void r2d_sfx_mutate(R2DSfx *fx, uint32_t seed, float amount)
{
    Rng r; rng_seed(&r, seed);
    amount = clampf(amount, 0.0f, 1.0f);
    float *p[] = { &fx->freq, &fx->slide, &fx->delta_slide, &fx->duty, &fx->duty_sweep, &fx->vibrato_depth, &fx->vibrato_speed,
                   &fx->attack, &fx->sustain, &fx->decay, &fx->punch, &fx->lpf, &fx->lpf_sweep, &fx->hpf, &fx->hpf_sweep,
                   &fx->phaser_offset, &fx->phaser_sweep, &fx->repeat, &fx->change_speed, &fx->change_amount };
    for (size_t i = 0; i < sizeof p / sizeof p[0]; ++i)
        if (rng_i(&r, 1)) *p[i] += (rng_f(&r, 2.0f) - 1.0f) * amount;
    fx->seed = seed ? seed : fx->seed;
    r2d_sfx_clamp(fx);
}

// ---- Слова → параметры ---------------------------------------------------------

typedef struct { const char *word; const char *preset; } Keyword;

static const Keyword k_words[] = {
    { "coin", "coin" }, { "pickup", "coin" }, { "collect", "coin" }, { "монет", "coin" }, { "подбор", "coin" }, { "собра", "coin" },
    { "laser", "laser" }, { "shoot", "laser" }, { "shot", "laser" }, { "zap", "laser" }, { "лазер", "laser" }, { "выстрел", "laser" }, { "стрельб", "laser" },
    { "explo", "explosion" }, { "boom", "explosion" }, { "blast", "explosion" }, { "взрыв", "explosion" }, { "бабах", "explosion" },
    { "powerup", "powerup" }, { "power", "powerup" }, { "bonus", "powerup" }, { "upgrade", "powerup" }, { "бонус", "powerup" }, { "усилени", "powerup" }, { "улучшен", "powerup" },
    { "hurt", "hurt" }, { "hit", "hurt" }, { "damage", "hurt" }, { "ouch", "hurt" }, { "урон", "hurt" }, { "удар", "hurt" }, { "попадан", "hurt" },
    { "jump", "jump" }, { "hop", "jump" }, { "прыж", "jump" }, { "скач", "jump" },
    { "blip", "blip" }, { "click", "blip" }, { "select", "blip" }, { "menu", "blip" }, { "beep", "blip" }, { "клик", "blip" }, { "выбор", "blip" }, { "меню", "blip" }, { "писк", "blip" },
    { "random", "random" }, { "случайн", "random" },
};

static int has_word(const char *low, const char *w) { return strstr(low, w) != NULL; }

const char *r2d_sfx_from_text(R2DSfx *fx, const char *text, uint32_t seed)
{
    if (!fx || !text) return NULL;
    char low[512];
    size_t n = 0;
    // Приведение к нижнему регистру: ASCII и кириллица UTF-8 (А–Я → а–я; Ё → ё).
    for (size_t i = 0; text[i] && n + 2 < sizeof low; ) {
        unsigned char c = (unsigned char)text[i];
        if (c < 0x80) { low[n++] = (char)tolower(c); ++i; }
        else if (c == 0xD0 && text[i + 1]) {
            unsigned char d = (unsigned char)text[i + 1];
            if (d >= 0x90 && d <= 0x9F) { low[n++] = (char)0xD0; low[n++] = (char)(d + 0x20); }
            else if (d >= 0xA0 && d <= 0xAF) { low[n++] = (char)0xD1; low[n++] = (char)(d - 0x20); }
            else if (d == 0x81) { low[n++] = (char)0xD1; low[n++] = (char)0x91; }
            else { low[n++] = (char)c; low[n++] = (char)d; }
            i += 2;
        } else { low[n++] = (char)c; ++i; }
    }
    low[n] = 0;

    const char *chosen = NULL;
    size_t best_pos = (size_t)-1;
    for (size_t i = 0; i < sizeof k_words / sizeof k_words[0]; ++i) {
        const char *at = strstr(low, k_words[i].word);
        if (at && (size_t)(at - low) < best_pos) { best_pos = (size_t)(at - low); chosen = k_words[i].preset; }
    }
    if (!chosen) return NULL;
    r2d_sfx_preset(fx, chosen, seed);

    if (has_word(low, "high") || has_word(low, "высок") || has_word(low, "тонк") || has_word(low, "писклив")) { fx->freq += 0.2f; fx->min_freq *= 0.5f; }
    if (has_word(low, "low") || has_word(low, "низк") || has_word(low, "глух") || has_word(low, "басов") || has_word(low, "deep")) fx->freq -= 0.2f;
    if (has_word(low, "short") || has_word(low, "корот") || has_word(low, "быстр")) { fx->sustain *= 0.4f; fx->decay *= 0.5f; }
    if (has_word(low, "long") || has_word(low, "длин") || has_word(low, "протяж")) { fx->sustain = fx->sustain * 1.8f + 0.1f; fx->decay = fx->decay * 1.6f + 0.1f; }
    if (has_word(low, "quiet") || has_word(low, "soft") || has_word(low, "тих") || has_word(low, "мягк")) { fx->volume *= 0.6f; fx->hpf *= 0.5f; if (fx->lpf > 0.5f) fx->lpf = 0.6f; }
    if (has_word(low, "loud") || has_word(low, "громк")) fx->volume = fx->volume * 1.4f + 0.05f;
    if (has_word(low, "harsh") || has_word(low, "rough") || has_word(low, "груб") || has_word(low, "жёстк") || has_word(low, "жестк")) { fx->punch += 0.25f; if (fx->wave == R2D_SFX_SINE) fx->wave = R2D_SFX_SAW; }
    if (has_word(low, "retro") || has_word(low, "8bit") || has_word(low, "8-bit") || has_word(low, "ретро") || has_word(low, "8 бит")) { fx->wave = R2D_SFX_SQUARE; fx->lpf = 1.0f; }
    r2d_sfx_clamp(fx);
    return chosen;
}

// ---- Синтез ---------------------------------------------------------------------

size_t r2d_sfx_max_samples(void) { return (size_t)3 * SFX_ENV_MAX + 64; }

typedef struct {
    int phase; double fperiod, fmaxperiod, fslide, fdslide; int period;
    float square_duty, square_slide;
    int env_stage, env_time, env_length[3]; float env_vol;
    float fphase, fdphase; int iphase; float phaser_buf[1024]; int ipp;
    float noise_buf[32];
    float fltp, fltdp, fltw, fltw_d, fltdmp, fltphp, flthp, flthp_d;
    float vib_phase, vib_speed, vib_amp;
    int rep_time, rep_limit;
    int arp_time, arp_limit; double arp_mod;
} Synth;

static void synth_reset(Synth *s, const R2DSfx *p, int restart, Rng *rng)
{
    s->fperiod = 100.0 / ((double)p->freq * p->freq + 0.001);
    s->period = (int)s->fperiod;
    s->fmaxperiod = 100.0 / ((double)p->min_freq * p->min_freq + 0.001);
    s->fslide = 1.0 - pow((double)p->slide, 3.0) * 0.01;
    s->fdslide = -pow((double)p->delta_slide, 3.0) * 0.000001;
    s->square_duty = 0.5f - p->duty * 0.5f;
    s->square_slide = -p->duty_sweep * 0.00005f;
    if (p->change_amount >= 0.0f) s->arp_mod = 1.0 - pow((double)p->change_amount, 2.0) * 0.9;
    else s->arp_mod = 1.0 + pow((double)p->change_amount, 2.0) * 10.0;
    s->arp_time = 0;
    s->arp_limit = (int)(pow(1.0 - (double)p->change_speed, 2.0) * 20000.0 + 32.0);
    if (p->change_speed >= 1.0f) s->arp_limit = 0;
    if (restart) return;
    s->phase = 0;
    s->fltp = 0; s->fltdp = 0;
    s->fltw = powf(p->lpf, 3.0f) * 0.1f;
    s->fltw_d = 1.0f + p->lpf_sweep * 0.0001f;
    s->fltdmp = 5.0f / (1.0f + powf(p->lpf_resonance, 2.0f) * 20.0f) * (0.01f + s->fltw);
    if (s->fltdmp > 0.8f) s->fltdmp = 0.8f;
    s->fltphp = 0;
    s->flthp = powf(p->hpf, 2.0f) * 0.1f;
    s->flthp_d = 1.0f + p->hpf_sweep * 0.0003f;
    s->vib_phase = 0;
    s->vib_speed = powf(p->vibrato_speed, 2.0f) * 0.01f;
    s->vib_amp = p->vibrato_depth * 0.5f;
    s->env_vol = 0; s->env_stage = 0; s->env_time = 0;
    s->env_length[0] = (int)(p->attack * p->attack * SFX_ENV_MAX);
    s->env_length[1] = (int)(p->sustain * p->sustain * SFX_ENV_MAX);
    s->env_length[2] = (int)(p->decay * p->decay * SFX_ENV_MAX);
    s->fphase = powf(p->phaser_offset, 2.0f) * 1020.0f;
    if (p->phaser_offset < 0.0f) s->fphase = -s->fphase;
    s->fdphase = powf(p->phaser_sweep, 2.0f) * 1.0f;
    if (p->phaser_sweep < 0.0f) s->fdphase = -s->fdphase;
    s->iphase = abs((int)s->fphase);
    s->ipp = 0;
    memset(s->phaser_buf, 0, sizeof s->phaser_buf);
    for (int i = 0; i < 32; ++i) s->noise_buf[i] = rng_f(rng, 2.0f) - 1.0f;
    s->rep_time = 0;
    s->rep_limit = (int)(pow(1.0 - (double)p->repeat, 2.0) * 20000.0 + 32.0);
    if (p->repeat <= 0.0f) s->rep_limit = 0;
}

size_t r2d_sfx_render(const R2DSfx *in, int16_t *out, size_t cap)
{
    R2DSfx p = *in;
    r2d_sfx_clamp(&p);
    Rng rng; rng_seed(&rng, p.seed ? p.seed : 1);
    Synth *s = (Synth *)calloc(1, sizeof *s);
    if (!s) return 0;
    synth_reset(s, &p, 0, &rng);
    size_t n = 0;
    int playing = 1;
    while (playing && n < cap) {
        if (s->rep_limit != 0 && ++s->rep_time >= s->rep_limit) { s->rep_time = 0; synth_reset(s, &p, 1, &rng); }
        if (s->arp_limit != 0 && ++s->arp_time >= s->arp_limit) { s->arp_limit = 0; s->fperiod *= s->arp_mod; }
        s->fslide += s->fdslide;
        s->fperiod *= s->fslide;
        if (s->fperiod > s->fmaxperiod) {
            s->fperiod = s->fmaxperiod;
            if (p.min_freq > 0.0f) playing = 0;
        }
        double rfperiod = s->fperiod;
        if (s->vib_amp > 0.0f) { s->vib_phase += s->vib_speed; rfperiod = s->fperiod * (1.0 + sinf(s->vib_phase) * s->vib_amp); }
        s->period = (int)rfperiod;
        if (s->period < 8) s->period = 8;
        s->square_duty = clampf(s->square_duty + s->square_slide, 0.0f, 0.5f);

        if (++s->env_time > s->env_length[s->env_stage]) {
            s->env_time = 0;
            if (++s->env_stage == 3) playing = 0;
        }
        if (s->env_stage < 3) {
            const float len = (float)(s->env_length[s->env_stage] > 0 ? s->env_length[s->env_stage] : 1);
            const float t = (float)s->env_time / len;
            if (s->env_stage == 0) s->env_vol = t;
            else if (s->env_stage == 1) s->env_vol = 1.0f + (1.0f - t) * 2.0f * p.punch;
            else s->env_vol = 1.0f - t;
        }

        s->fphase += s->fdphase;
        s->iphase = abs((int)s->fphase);
        if (s->iphase > 1023) s->iphase = 1023;
        if (s->flthp_d != 0.0f) s->flthp = clampf(s->flthp * s->flthp_d, 0.00001f, 0.1f);

        float ssample = 0.0f;
        for (int si = 0; si < 8; ++si) {
            float sample = 0.0f;
            if (++s->phase >= s->period) {
                s->phase %= s->period;
                if (p.wave == R2D_SFX_NOISE) for (int i = 0; i < 32; ++i) s->noise_buf[i] = rng_f(&rng, 2.0f) - 1.0f;
            }
            const float fp = (float)s->phase / (float)s->period;
            switch (p.wave) {
                case R2D_SFX_SQUARE: sample = fp < s->square_duty ? 0.5f : -0.5f; break;
                case R2D_SFX_SAW: sample = 1.0f - fp * 2.0f; break;
                case R2D_SFX_SINE: sample = sinf(fp * 2.0f * SFX_PI); break;
                default: sample = s->noise_buf[s->phase * 32 / s->period]; break;
            }
            const float pp = s->fltp;
            s->fltw = clampf(s->fltw * s->fltw_d, 0.0f, 0.1f);
            if (p.lpf != 1.0f) {
                s->fltdp += (sample - s->fltp) * s->fltw;
                s->fltdp -= s->fltdp * s->fltdmp;
            } else { s->fltp = sample; s->fltdp = 0.0f; }
            s->fltp += s->fltdp;
            s->fltphp += s->fltp - pp;
            s->fltphp -= s->fltphp * s->flthp;
            sample = s->fltphp;
            s->phaser_buf[s->ipp & 1023] = sample;
            sample += s->phaser_buf[(s->ipp - s->iphase + 1024) & 1023];
            s->ipp = (s->ipp + 1) & 1023;
            ssample += sample * s->env_vol;
        }
        ssample = ssample / 8.0f * 0.7f * p.volume;      // фазер при нулевом сдвиге удваивает сигнал, поэтому 0.7: на громкости 0.5 пик пресетов около 0.2–0.8
        // мягкий потолок: выше 0.7 сигнал плавно прижимается к 1.0 вместо жёсткого среза (фазер и punch дают пики >1)
        const float mag = fabsf(ssample);
        const float soft = mag > 0.7f ? 0.7f + 0.3f * tanhf((mag - 0.7f) / 0.3f) : mag;
        out[n++] = (int16_t)(copysignf(soft, ssample) * 32000.0f);
    }
    free(s);
    return n;
}

void r2d_sfx_analyze(const int16_t *pcm, size_t n, R2DSfxStats *st)
{
    memset(st, 0, sizeof *st);
    st->env_bins = 24;
    st->samples = n;
    st->seconds = (float)n / (float)R2D_SFX_RATE;
    if (!n) return;
    double sum2 = 0.0; int peak = 0;
    size_t crossings = 0;
    for (size_t i = 0; i < n; ++i) {
        const int v = pcm[i], a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        if (a >= 32000) st->clipped++;      // ровно потолок синтезатора: мягкий предел до него не доходит
        sum2 += (double)v * v;
        if (i && ((pcm[i - 1] < 0) != (v < 0))) crossings++;
        const size_t bin = i * 24 / n;
        const float fv = (float)a / 32768.0f;
        if (fv > st->env[bin]) st->env[bin] = fv;
    }
    st->peak = (float)peak / 32768.0f;
    st->rms = (float)(sqrt(sum2 / (double)n) / 32768.0);
    // Основной тон: пересечения нуля считаем только в окнах, где звук «живой» (пик окна > 10% общего пика):
    // тишина в хвосте огибающей и нули синуса не должны занижать оценку.
    size_t live = 0, live_cross = 0;
    for (size_t w = 0; w + 256 <= n; w += 256) {
        int wp = 0;
        for (size_t i = w; i < w + 256; ++i) { const int a = abs(pcm[i]); if (a > wp) wp = a; }
        if (wp * 10 < peak) continue;
        live += 256;
        for (size_t i = w + 1; i < w + 256; ++i) if ((pcm[i - 1] < 0) != (pcm[i] < 0)) live_cross++;
    }
    (void)crossings;
    st->freq_hz = live >= 512 ? (float)live_cross / 2.0f * (float)R2D_SFX_RATE / (float)live : 0.0f;
}

int r2d_sfx_write_wav(const char *path, const int16_t *pcm, size_t n)
{
    FILE *f = fopen(path, "wb");
    if (!f) return -1;
    const uint32_t data = (uint32_t)(n * 2), rate = R2D_SFX_RATE, byte_rate = R2D_SFX_RATE * 2, riff = 36 + data, fmt = 16;
    const uint16_t pcm_tag = 1, ch = 1, align = 2, bits = 16;
    int ok = fwrite("RIFF", 1, 4, f) == 4 && fwrite(&riff, 4, 1, f) == 1 && fwrite("WAVEfmt ", 1, 8, f) == 8 &&
             fwrite(&fmt, 4, 1, f) == 1 && fwrite(&pcm_tag, 2, 1, f) == 1 && fwrite(&ch, 2, 1, f) == 1 &&
             fwrite(&rate, 4, 1, f) == 1 && fwrite(&byte_rate, 4, 1, f) == 1 && fwrite(&align, 2, 1, f) == 1 &&
             fwrite(&bits, 2, 1, f) == 1 && fwrite("data", 1, 4, f) == 4 && fwrite(&data, 4, 1, f) == 1 &&
             (n == 0 || fwrite(pcm, 2, n, f) == n);
    ok = (fclose(f) == 0) && ok;
    return ok ? 0 : -1;
}

// ---- .rfx (раскладка rFXGen) -------------------------------------------------------
// Заголовок: "rFX ", версия u16 = 200, длина u16 = 96; затем 2 int и 22 float в порядке rFXGen:
// seed, wave, attack, sustain, punch, decay, freq, minFreq, slide, deltaSlide, vibratoDepth, vibratoSpeed,
// changeAmount, changeSpeed, duty, dutySweep, repeat, phaserOffset, phaserSweep, lpf, lpfSweep, lpfResonance, hpf, hpfSweep.
// Раскладка записана по описанию формата; на файлах оригинальной программы не сверялась.

#define RFX_VERSION 200
#define RFX_FLOATS 22

static float *rfx_fields(R2DSfx *fx, float **arr)
{
    arr[0] = &fx->attack; arr[1] = &fx->sustain; arr[2] = &fx->punch; arr[3] = &fx->decay; arr[4] = &fx->freq; arr[5] = &fx->min_freq;
    arr[6] = &fx->slide; arr[7] = &fx->delta_slide; arr[8] = &fx->vibrato_depth; arr[9] = &fx->vibrato_speed; arr[10] = &fx->change_amount;
    arr[11] = &fx->change_speed; arr[12] = &fx->duty; arr[13] = &fx->duty_sweep; arr[14] = &fx->repeat; arr[15] = &fx->phaser_offset;
    arr[16] = &fx->phaser_sweep; arr[17] = &fx->lpf; arr[18] = &fx->lpf_sweep; arr[19] = &fx->lpf_resonance; arr[20] = &fx->hpf; arr[21] = &fx->hpf_sweep;
    return arr[0];
}

int r2d_sfx_save_rfx(const char *path, const R2DSfx *in)
{
    R2DSfx fx = *in;
    float *f[RFX_FLOATS]; rfx_fields(&fx, f);
    FILE *fp = fopen(path, "wb");
    if (!fp) return -1;
    const uint16_t ver = RFX_VERSION, len = 96;
    const int32_t seed = (int32_t)fx.seed, wave = fx.wave;
    int ok = fwrite("rFX ", 1, 4, fp) == 4 && fwrite(&ver, 2, 1, fp) == 1 && fwrite(&len, 2, 1, fp) == 1 &&
             fwrite(&seed, 4, 1, fp) == 1 && fwrite(&wave, 4, 1, fp) == 1;
    for (int i = 0; ok && i < RFX_FLOATS; ++i) ok = fwrite(f[i], 4, 1, fp) == 1;
    ok = (fclose(fp) == 0) && ok;
    return ok ? 0 : -1;
}

int r2d_sfx_load_rfx(const char *path, R2DSfx *out)
{
    FILE *fp = fopen(path, "rb");
    if (!fp) return -1;
    char sig[4]; uint16_t ver = 0, len = 0; int32_t seed = 0, wave = 0;
    R2DSfx fx; r2d_sfx_defaults(&fx);
    float *f[RFX_FLOATS]; rfx_fields(&fx, f);
    int ok = fread(sig, 1, 4, fp) == 4 && memcmp(sig, "rFX ", 4) == 0 && fread(&ver, 2, 1, fp) == 1 && fread(&len, 2, 1, fp) == 1 &&
             len == 96 && fread(&seed, 4, 1, fp) == 1 && fread(&wave, 4, 1, fp) == 1;
    for (int i = 0; ok && i < RFX_FLOATS; ++i) ok = fread(f[i], 4, 1, fp) == 1;
    fclose(fp);
    if (!ok) return -1;
    fx.seed = (uint32_t)seed ? (uint32_t)seed : 1;
    fx.wave = wave;
    fx.volume = 0.5f;
    r2d_sfx_clamp(&fx);
    *out = fx;
    return 0;
}
