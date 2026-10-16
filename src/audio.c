#include "audio.h"
#include "audio_spatial.h"

#include "payload.h"

#include <SDL3/SDL.h>
#include <SDL3_mixer/SDL_mixer.h>

#include <math.h>       // sinf/expf/fabsf: бинауральная модель
#include <string.h>     // memset: сброс линии задержки канала
#include <stdlib.h>     // SDL_realloc-совместимые размеры

// ---------------------------------------------------------------------------

static float r2d__clamp01(float v)
{
    if (v < 0.0f) return 0.0f;
    if (v > 1.0f) return 1.0f;
    return v;
}

// Панорама: -1 — слева, 0 — по центру, +1 — справа.
static void r2d__stereo_from_pan(float pan, MIX_StereoGains *out)
{
    if (pan < -1.0f) pan = -1.0f;
    if (pan > 1.0f) pan = 1.0f;

    out->left  = (pan <= 0.0f) ? 1.0f : 1.0f - pan;
    out->right = (pan >= 0.0f) ? 1.0f : 1.0f + pan;
}

static void r2d__apply_master(R2DAudio *a)
{
    if (a->mixer) {
        MIX_SetMixerGain(a->mixer, a->master_volume);
    }
}

// ---------------------------------------------------------------------------
// Реверберация помещения
//
// Комната звучит для всего сразу, поэтому реверб висит на последнем шаге
// микшера (MIX_SetPostMixCallback), а не на отдельных каналах: одна модель на
// микс и никаких шестнадцати копий хвоста. Колбэк работает в аудиопотоке —
// только чтение параметров и запись в pcm.
// ---------------------------------------------------------------------------

static void SDLCALL r2d__post_mix(void *userdata, MIX_Mixer *mixer,
                                  const SDL_AudioSpec *spec, float *pcm, int samples)
{
    R2D_UNUSED(mixer);
    R2DAudio *a = (R2DAudio *)userdata;
    if (!a || !spec || !pcm || samples <= 0) return;
    if (a->reverb_on) r2d_reverb_process(&a->reverb, pcm, samples, spec->channels);

    // Диагностический захват — ПОСЛЕ реверба: тест меряет то, что слышит
    // игрок, а не промежуточный буфер. Работает независимо от бинаурального
    // режима (нужен и для проверки «выключено = как раньше»).
    if (SDL_GetAtomicInt(&a->capture_on) && a->capture && spec->channels >= 2) {
        const int ch = spec->channels;
        a->capture_rate = spec->freq;
        int frames = samples / ch;
        const int left = a->capture_cap - a->capture_len;
        if (frames > left) frames = left;
        // Пишем в локальный счётчик, а публикуем ЦЕЛЫМ числом кадров: иначе
        // читатель (JS/тест) мог увидеть нечётное число и получить половину кадра —
        // L уже записан, R ещё нет (гонка аудиопотока с чтением).
        int written = a->capture_len;
        for (int i = 0; i < frames; i++) {
            a->capture[written * 2]     = pcm[i * ch];
            a->capture[written * 2 + 1] = pcm[i * ch + 1];
            written++;
        }
        a->capture_len = written;
        if (written >= a->capture_cap) SDL_SetAtomicInt(&a->capture_on, 0);
    }
}

bool r2d_audio_set_room(R2DAudio *a, float wet, float room, float damp, float width)
{
    if (!a) return false;
    r2d_reverb_set_params(&a->reverb, wet, room, damp, width);
    a->reverb_on = a->ready && a->reverb.ready && a->reverb.wet > 0.0f;
    return a->reverb_on;
}

void r2d_audio_get_room(const R2DAudio *a, float *wet, float *room, float *damp, float *width)
{
    if (!a) return;
    if (wet)   *wet   = a->reverb.wet;
    if (room)  *room  = a->reverb.room;
    if (damp)  *damp  = a->reverb.damp;
    if (width) *width = a->reverb.width;
}

// ---------------------------------------------------------------------------
// Шины: группы микшера
//
// Треки одной шины микшируются вместе, и MIX_SetGroupPostMixCallback отдаёт
// готовый буфер группы: эффект шины действует на все её звуки, включая
// запущенные позже. Гейна у группы в SDL_mixer 3.2 нет, поэтому громкость,
// mute и solo по-прежнему считает JS на каналах.
// ---------------------------------------------------------------------------

static void SDLCALL r2d__group_fx(void *userdata, MIX_Group *group,
                                  const SDL_AudioSpec *spec, float *pcm, int samples)
{
    R2D_UNUSED(group);
    r2d_audio_fx_process((R2DAudioFx *)userdata, spec, pcm, samples);

}

int r2d_audio_group(R2DAudio *a, const char *name)
{
    if (!a || !a->ready || !a->mixer || !name || !*name) return -1;

    for (int i = 0; i < a->group_count; ++i) {
        if (a->group_used[i] && SDL_strcmp(a->groups[i].name, name) == 0) return i;
    }
    // Свободный слот после destroy переиспользуем: индексы шин, которые уже
    // держит JS, не должны съезжать, а лимит групп — не выгорать.
    int slot = -1;
    for (int i = 0; i < a->group_count; ++i) {
        if (!a->group_used[i]) { slot = i; break; }
    }
    if (slot < 0) {
        if (a->group_count >= R2D_AUDIO_MAX_GROUPS) {
            R2D_ERROR("достигнут лимит аудио-шин (%d)", R2D_AUDIO_MAX_GROUPS);
            return -1;
        }
        slot = a->group_count++;
    }

    R2DAudioGroup *g = &a->groups[slot];
    SDL_zero(*g);
    g->handle = MIX_CreateGroup(a->mixer);
    if (!g->handle) {
        R2D_ERROR("MIX_CreateGroup: %s", SDL_GetError());
        return -1;
    }
    SDL_snprintf(g->name, sizeof g->name, "%s", name);
    g->fx.kind = R2D_AUDIO_FX_NONE;
    // Колбэк ставим сразу: при kind == NONE он выходит на первой строке.
    if (!MIX_SetGroupPostMixCallback(g->handle, r2d__group_fx, &g->fx)) {
        R2D_WARN("MIX_SetGroupPostMixCallback(%s): %s", g->name, SDL_GetError());
    }
    a->group_used[slot] = true;
    return slot;
}

bool r2d_audio_group_destroy(R2DAudio *a, int group_id)
{
    if (!a || group_id < 0 || group_id >= a->group_count) return false;
    if (!a->group_used[group_id]) return false;
    R2DAudioGroup *g = &a->groups[group_id];
    // Сначала снимаем колбэк и гасим эффект: хвост реверба не должен
    // «доигрывать» в чужом миксе после освобождения шины.
    if (g->handle) {
        MIX_SetGroupPostMixCallback(g->handle, NULL, NULL);
        MIX_DestroyGroup(g->handle);
        g->handle = NULL;
    }
    r2d_audio_fx_shutdown(&g->fx);
    SDL_zero(g->fx);
    g->fx.kind = R2D_AUDIO_FX_NONE;
    g->name[0] = '\0';
    a->group_used[group_id] = false;
    return true;
}

int r2d_audio_group_count(const R2DAudio *a) { return a ? a->group_count : 0; }

bool r2d_audio_group_assign(R2DAudio *a, int channel, int group_id)
{
    if (!a || !a->ready || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return false;
    MIX_Group *g = NULL;
    if (group_id >= 0) {
        if (group_id >= a->group_count) return false;
        g = a->groups[group_id].handle;
    }
    return MIX_SetTrackGroup(a->channels[channel], g);
}

bool r2d_audio_set_group_effect(R2DAudio *a, int group_id, const char *kind,
                                float p1, float p2)
{
    if (!a || !a->ready || group_id < 0 || group_id >= a->group_count) return false;
    return r2d_audio_fx_set(&a->groups[group_id].fx, a->fx_freq, kind, p1, p2);
}

// Реверб-шина: у группы свой хвост, в который уходит доля `send` её микса.
// Это и есть «посыл»: остальные шины и мастер хвоста не получают.
bool r2d_audio_set_group_reverb(R2DAudio *a, int group_id, float send, float room,
                                float damp, float width)
{
    if (!a || !a->ready || group_id < 0 || group_id >= a->group_count) return false;
    return r2d_audio_fx_set_reverb(&a->groups[group_id].fx, a->fx_freq, send, room, damp, width);
}

const char *r2d_audio_group_effect(const R2DAudio *a, int group_id)
{
    if (!a || group_id < 0 || group_id >= a->group_count) return "none";
    return r2d_audio_fx_kind_name(a->groups[group_id].fx.kind);
}

// ---------------------------------------------------------------------------
// 3D-позиция канала
//
// У SDL_mixer слушатель всегда в (0,0,0) и его нельзя двигать, поэтому игре
// отдаются координаты ОТНОСИТЕЛЬНО слушателя. SDL сам считает затухание и
// раскладку по колонкам; трек при этом микшируется в моно.
// ---------------------------------------------------------------------------

bool r2d_audio_set_channel_3d(R2DAudio *a, int channel, float x, float y, float z, bool on)
{
    if (!a || !a->ready || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return false;

    MIX_Track *track = a->channels[channel];
    a->channel_3d[channel] = on;

    if (!on) {
        // NULL выключает и 3D, и «принудительное стерео» — трек возвращается
        // в обычный режим, панораму снова задаёт MIX_SetTrackStereo.
        return MIX_SetTrack3DPosition(track, NULL);
    }

    MIX_Point3D p;
    p.x = x;
    p.y = y;
    p.z = z;
    return MIX_SetTrack3DPosition(track, &p);
}

// ---------------------------------------------------------------------------
// Эффекты канала
//
// SDL_mixer 3.2 не содержит готовых эффектов, но отдаёт сырые сэмплы в
// MIX_SetTrackRawCallback. Колбэк работает в аудиопотоке: здесь нельзя
// выделять память и нельзя трогать сам трек — только pcm.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Эффекты: список имён, включение, обработка
//
// DSP живёт в src/audio_fx.c (он же собирается в офлайн-тест), здесь — только
// мост к шинам и каналам SDL_mixer: найти буфер эффекта и отдать его модулю.
// ---------------------------------------------------------------------------

int r2d_audio_effect_count(void)
{
    return r2d_audio_fx_count();
}

const char *r2d_audio_effect_name(int index)
{
    return r2d_audio_fx_name(index);
}

// Бинауральная модель (фолбэк без Steam Audio). Вызывается из raw-колбэка
// канала ПОСЛЕ обычных эффектов: окклюзия (lowpass из acoustics.js) успевает
// приглушить источник, а ITD/тень головы работают по приглушённому сигналу.
//
// Что делает на каждый кадр:
//   1. mono = (L+R)/2 — при включённой модели JS держит панораму в центре;
//   2. ITD: задержка дальнего уха по Вудворту (a/c)·(|az| + sin|az|), читается
//      дробно (линейная интерполяция) из общей линии задержки;
//   3. ILD и тень головы: однополюсный ФНЧ на дальнем ухе со срезом
//      20 кГц → 2 кГц по |az| плюс ослабление дальнего уха до -4 дБ;
//   4. «сзади»: полка +4 дБ выше 3 кГц на обоих ушах при |az| > 90°;
//   5. mix подмешивает сухой сигнал (1 — только бинаурально).
/**
 * ITD по Вудворту: (a/c)·(|az| + sin|az|) секунд, в сэмплах (дробное).
 * 0.0875 м и 343 м/с дают 0.656 мс на 90° — это и проверяет тест.
 */
static float r2d__itd_samples(const R2DAudioBinaural *b, float aaz, int rate)
{
    return (b->head / 343.0f) * (aaz + sinf(aaz)) * (float)rate;
}

/**
 * Гибрид: к готовому стерео (например, выходу Steam Audio) добавляется ТОЛЬКО
 * межушная задержка — дальнее ухо читается из линии с дробной задержкой,
 * ближнее идёт как есть. Спектр (ILD, тень, подсказки библиотеки) не трогаем:
 * это ровно то, что просил `itd: 'model'` при backend 'steam'.
 */
static void r2d__itd_process(R2DAudio *a, int ch, const SDL_AudioSpec *spec,
                             float *pcm, int samples)
{
    R2DAudioBinaural *b = &a->binaural;
    if (!b->on || ch < 0 || ch >= R2D_AUDIO_CHANNELS || b->mode[ch] != 2) return;

    const int channels = (spec && spec->channels > 0) ? spec->channels : 2;
    if (channels != 2 || !pcm || samples < 2) return;
    const int rate = (spec && spec->freq > 0) ? spec->freq : b->rate;
    if (rate <= 0) return;
    b->rate = rate;

    const float az = b->az[ch];
    const float aaz = fabsf(az);
    if (aaz < 0.02f) return;                    // центр: задержки нет

    const float itd = r2d__itd_samples(b, aaz, rate);
    const int idelay = (int)itd;
    const float frac = itd - (float)idelay;
    const bool far_is_left = az > 0.0f;         // источник справа → дальнее левое

    float *line = b->line[ch];
    int pos = b->pos[ch];
    for (int i = 0; i + 1 < samples; i += 2) {
        const float far_in = far_is_left ? pcm[i] : pcm[i + 1];
        line[pos] = far_in;
        int p = pos - idelay;
        while (p < 0) p += R2D_BINAURAL_DELAY;
        int q = p - 1;
        while (q < 0) q += R2D_BINAURAL_DELAY;
        const float far_out = line[p] * (1.0f - frac) + line[q] * frac;
        if (far_is_left) pcm[i] = far_out;
        else             pcm[i + 1] = far_out;
        pos = (pos + 1) % R2D_BINAURAL_DELAY;
    }
    b->pos[ch] = pos;
}

static void r2d__binaural_process(R2DAudio *a, int ch, const SDL_AudioSpec *spec,
                                  float *pcm, int samples)
{
    R2DAudioBinaural *b = &a->binaural;
    if (!b->on || ch < 0 || ch >= R2D_AUDIO_CHANNELS || b->mode[ch] != 1) return;

    const int channels = (spec && spec->channels > 0) ? spec->channels : 2;
    if (channels < 2 || !pcm || samples < 2) return;
    const int rate = (spec && spec->freq > 0) ? spec->freq : b->rate;
    if (rate <= 0) return;
    b->rate = rate;

    const float az = b->az[ch];
    const float aaz = fabsf(az);
    // Мёртвая зона у фронта: на 0° модель обязана совпасть с моно (иначе
    // «моно-совместимость» выполнялась бы только приблизительно).
    if (aaz < 0.02f) return;

    const float half_pi = SDL_PI_F * 0.5f;
    const float t = aaz > half_pi ? 1.0f : aaz / half_pi;      // 0..1
    // ITD: Вудворт, максимум (0.0875/343)·(pi/2+1) = 0.656 мс на 90°.
    const float itd = r2d__itd_samples(b, aaz, rate);
    const int   idelay = (int)itd;
    const float frac = itd - (float)idelay;
    // Тень головы: срез падает 20 кГц → 2 кГц; на 0° фильтр не работает.
    const float cut = 20000.0f + (2000.0f - 20000.0f) * t;
    const float alpha = 1.0f - expf(-2.0f * SDL_PI_F * cut / (float)rate);
    // «Сзади»: полка выше 3 кГц, только для задней полусферы.
    const bool rear = aaz > half_pi;
    const float shelf_alpha = 1.0f - expf(-2.0f * SDL_PI_F * 3000.0f / (float)rate);
    const float far_gain = 1.0f + (b->far_gain - 1.0f) * t;
    const float dry = 1.0f - b->mix;
    // ILD частотозависима: ослабляем дальнее ухо только ВЫШЕ ~1.2 кГц
    // (полка), иначе на 200 Гц разница была бы такой же, как на 4 кГц —
    // а у головы на низах тень не работает.
    const float low_alpha = 1.0f - expf(-2.0f * SDL_PI_F * 1200.0f / (float)rate);

    float *line = b->line[ch];
    int pos = b->pos[ch];
    float lp_near = b->lp_near[ch];
    float lp_far = b->lp_far[ch];
    float lp_far_low = b->lp_far_low[ch];
    float shelf_l = b->shelf[ch][0];
    float shelf_r = b->shelf[ch][1];

    const bool near_left = az < 0.0f;      // азимут < 0 — источник слева
    for (int i = 0; i + 1 < samples; i += 2) {
        const float mono = 0.5f * (pcm[i] + pcm[i + 1]);
        line[pos] = mono;
        int p = pos - idelay;
        while (p < 0) p += R2D_BINAURAL_DELAY;
        int q = p - 1;
        while (q < 0) q += R2D_BINAURAL_DELAY;
        const float far_raw = line[p] * (1.0f - frac) + line[q] * frac;
        const float near_raw = mono;

        // Тень: ФНЧ на дальнем ухе (ближнее — без фильтра).
        lp_near += alpha * (near_raw - lp_near);
        lp_far  += alpha * (far_raw  - lp_far);
        // ILD-полка: НЧ дальнего уха идут без ослабления, ВЧ — с far_gain.
        lp_far_low += low_alpha * (lp_far - lp_far_low);
        float e_near = near_raw;
        float e_far  = lp_far_low + far_gain * (lp_far - lp_far_low);

        if (rear) {
            // Полка +rear_gain выше 3 кГц: y = lp + g·(x − lp).
            shelf_l += shelf_alpha * (e_near - shelf_l);
            shelf_r += shelf_alpha * (e_far - shelf_r);
            e_near = shelf_l + b->rear_gain * (e_near - shelf_l);
            e_far  = shelf_r + b->rear_gain * (e_far - shelf_r);
        }

        const float l_bin = (near_left ? e_near : e_far);
        const float r_bin = (near_left ? e_far : e_near);
        pcm[i]     = pcm[i] * dry + l_bin * b->mix;
        pcm[i + 1] = pcm[i + 1] * dry + r_bin * b->mix;

        pos = (pos + 1) % R2D_BINAURAL_DELAY;
    }

    b->pos[ch] = pos;
    b->lp_near[ch] = lp_near;
    b->lp_far[ch] = lp_far;
    b->lp_far_low[ch] = lp_far_low;
    b->shelf[ch][0] = shelf_l;
    b->shelf[ch][1] = shelf_r;
    if (isnan(lp_far) || isnan(lp_near)) {   // мусорный азимут не должен «залипать»
        b->lp_near[ch] = b->lp_far[ch] = b->lp_far_low[ch] = 0.0f;
        b->shelf[ch][0] = b->shelf[ch][1] = 0.0f;
    }
}

static void SDLCALL r2d__track_fx(void *userdata, MIX_Track *track,
                                  const SDL_AudioSpec *spec, float *pcm, int samples)
{
    R2D_UNUSED(track);
    R2DChannelCb *cb = (R2DChannelCb *)userdata;
    if (!cb) return;
    // Только эффекты канала: raw-буфер МОНО (spec->channels == 1), а
    // бинауральная модель строит стерео — ей нужен cooked-буфер (ниже).
    r2d_audio_fx_process(cb->fx, spec, pcm, samples);
}


// Cooked-колбэк канала: сюда приходит СТЕРЕО-буфер устройства. Здесь живут два
// взаимно исключающих пути (какой именно — решает $.audio.hrtf().backend):
//   * Steam Audio (r2d_audio_spatial_process) — настоящая HRTF;
//   * встроенная модель (r2d__binaural_process) — фолбэк без датасетов.
// Порядок важен: эффекты канала (raw) уже применены, здесь только панорама.
static void SDLCALL r2d__track_spatial(void *userdata,MIX_Track *track,const SDL_AudioSpec *spec,float *pcm,int samples) {
    R2D_UNUSED(track);
    R2DChannelCb *cb=(R2DChannelCb *)userdata;
    if(!cb)return;
    r2d_audio_spatial_process(cb->fx?cb->fx->spatial:NULL,spec,pcm,samples);
    if(cb->owner&&cb->channel>=0){
        // Порядок: сначала backend (Steam), потом наша задержка поверх него —
        // так работает гибрид `itd: 'model'` при backend 'steam'.
        r2d__itd_process(cb->owner,cb->channel,spec,pcm,samples);
        r2d__binaural_process(cb->owner,cb->channel,spec,pcm,samples);
    }
}

bool r2d_audio_set_channel_effect(R2DAudio *a, int channel, const char *kind,
                                  float p1, float p2)
{
    if (!a || !a->ready || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return false;
    return r2d_audio_fx_set(&a->fx[channel], a->fx_freq, kind, p1, p2);
}

// Реверб-шина на канале: посыл (доля в хвост), размер, глухость, ширина.
bool r2d_audio_set_channel_reverb(R2DAudio *a, int channel, float send, float room,
                                  float damp, float width)
{
    if (!a || !a->ready || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return false;
    return r2d_audio_fx_set_reverb(&a->fx[channel], a->fx_freq, send, room, damp, width);
}

const char *r2d_audio_channel_effect(const R2DAudio *a, int channel)
{
    if (!a || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return "none";
    return r2d_audio_fx_kind_name(a->fx[channel].kind);
}

void r2d_audio_set_channel_volume(R2DAudio *a, int channel, float v)
{
    if (!a || !a->ready || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return;
    a->channel_volume[channel] = r2d__clamp01(v);
    MIX_SetTrackGain(a->channels[channel], a->channel_volume[channel] * a->sfx_volume);
}

float r2d_audio_get_channel_volume(const R2DAudio *a, int channel)
{
    if (!a || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return 0.0f;
    return a->channel_volume[channel];
}

void r2d_audio_set_channel_pan(R2DAudio *a, int channel, float pan)
{
    if (!a || !a->ready || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return;
    if (pan < -1.0f) pan = -1.0f;
    if (pan > 1.0f) pan = 1.0f;
    a->channel_pan[channel] = pan;

    // В 3D-режиме панораму считает SDL_mixer; MIX_SetTrackStereo здесь только
    // выключил бы 3D (он сбрасывает и «принудительное стерео», и позицию).
    if (a->channel_3d[channel]) return;

    MIX_StereoGains gains;
    r2d__stereo_from_pan(pan, &gains);
    MIX_SetTrackStereo(a->channels[channel], &gains);
}

float r2d_audio_get_channel_pan(const R2DAudio *a, int channel)
{
    if (!a || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return 0.0f;
    return a->channel_pan[channel];
}

// Скорость воспроизведения: 1.0 — как записано. Границы выбраны так, чтобы
// случайный ноль или мусор из игры не превратились в тишину или визг.
static float r2d__clamp_pitch(float ratio)
{
    if (!(ratio > 0.0f)) return 1.0f;
    if (ratio < 0.05f) return 0.05f;
    if (ratio > 8.0f) return 8.0f;
    return ratio;
}

void r2d_audio_set_channel_pitch(R2DAudio *a, int channel, float ratio)
{
    if (!a || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return;
    a->channel_pitch[channel] = r2d__clamp_pitch(ratio);
    if (a->ready) MIX_SetTrackFrequencyRatio(a->channels[channel], a->channel_pitch[channel]);
}

float r2d_audio_get_channel_pitch(const R2DAudio *a, int channel)
{
    if (!a || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return 1.0f;
    return a->channel_pitch[channel];
}


// ---------------------------------------------------------------------------
// Музыкальные слои (§25): один transport на все stem'ы
//
// Запуск каждого слоя отдельным вызовом из JS давал бы разное время старта
// (два вызова в одном кадре всё равно попадают в разные буферы микшера).
// Поэтому старт идёт ОДНОЙ нативной командой под локом микшера: SDL_mixer
// фиксирует начало воспроизведения на одном sample-clock, и слои остаются в
// фазе. Seek и pause — такие же групповые команды.
// ---------------------------------------------------------------------------

int r2d_audio_stems_set(R2DAudio *a, const int *sound_ids, int count)
{
    if (!a) return 0;
    for (int i = 0; i < a->stem_count; ++i) {
        if (a->stems[i]) {
            MIX_StopTrack(a->stems[i], 0);
            MIX_DestroyTrack(a->stems[i]);
            a->stems[i] = NULL;
        }
    }
    a->stem_count = 0;
    a->stems_active = false;
    a->stems_paused = false;
    if (!a->ready || !a->mixer || !sound_ids || count <= 0) return 0;

    const int n = count > R2D_AUDIO_MAX_STEMS ? R2D_AUDIO_MAX_STEMS : count;
    for (int i = 0; i < n; ++i) {
        const int id = sound_ids[i];
        if (id < 0 || id >= R2D_AUDIO_MAX_SOUNDS || !a->sounds[id]) continue;
        MIX_Track *track = MIX_CreateTrack(a->mixer);
        if (!track) {
            R2D_WARN("MIX_CreateTrack (слой %d): %s", i, SDL_GetError());
            continue;
        }
        if (!MIX_SetTrackAudio(track, a->sounds[id])) {
            MIX_DestroyTrack(track);
            continue;
        }
        if (a->stem_gain[a->stem_count] <= 0.0f) a->stem_gain[a->stem_count] = 1.0f;
        MIX_SetTrackGain(track, r2d__clamp01(a->stem_gain[a->stem_count]) * a->music_volume);
        a->stems[a->stem_count++] = track;
    }
    return a->stem_count;
}

int r2d_audio_stem_count(const R2DAudio *a) { return a ? a->stem_count : 0; }

bool r2d_audio_stems_start(R2DAudio *a, bool loop, float fade_ms, double start_ms,
                           double loop_start_ms, double loop_end_ms)
{
    if (!a || !a->ready || a->stem_count <= 0) return false;
    SDL_PropertiesID props = SDL_CreateProperties();
    if (!props) return false;
    SDL_SetNumberProperty(props, MIX_PROP_PLAY_LOOPS_NUMBER, loop ? -1 : 0);
    if (start_ms > 0.0) {
        SDL_SetNumberProperty(props, MIX_PROP_PLAY_START_MILLISECOND_NUMBER, (Sint64)(start_ms + 0.5));
    }
    // Конец петли задаём как «максимум» файла: SDL_mixer сам зациклит на
    // loop_start, поэтому щели между итерациями не возникает.
    if (loop_end_ms > 0.0) {
        SDL_SetNumberProperty(props, MIX_PROP_PLAY_MAX_MILLISECONDS_NUMBER, (Sint64)(loop_end_ms + 0.5));
    }
    if (loop && loop_start_ms > 0.0) {
        SDL_SetNumberProperty(props, MIX_PROP_PLAY_LOOP_START_MILLISECOND_NUMBER, (Sint64)(loop_start_ms + 0.5));
    }
    if (fade_ms > 0.0f) {
        SDL_SetNumberProperty(props, MIX_PROP_PLAY_FADE_IN_MILLISECONDS_NUMBER, (Sint64)(fade_ms + 0.5f));
    }

    // Лок микшера: все PlayTrack попадают в один и тот же момент времени.
    MIX_LockMixer(a->mixer);
    for (int i = 0; i < a->stem_count; ++i) {
        if (a->stems[i]) MIX_PlayTrack(a->stems[i], props);
    }
    MIX_UnlockMixer(a->mixer);
    SDL_DestroyProperties(props);

    a->stems_active = true;
    a->stems_paused = false;
    a->stems_loop_start_ms = loop_start_ms;
    a->stems_loop_end_ms = loop_end_ms;
    return true;
}

bool r2d_audio_stems_seek(R2DAudio *a, double seconds)
{
    if (!a || a->stem_count <= 0) return false;
    if (seconds < 0.0) seconds = 0.0;
    const Sint64 ms = (Sint64)(seconds * 1000.0 + 0.5);
    MIX_LockMixer(a->mixer);
    for (int i = 0; i < a->stem_count; ++i) {
        if (!a->stems[i]) continue;
        // Одна и та же миллисекунда для всех слоёв: SDL_mixer переводит её в
        // кадры по формату своего файла, поэтому слои с одинаковым sample rate
        // получают одинаковую позицию.
        MIX_SetTrackPlaybackPosition(a->stems[i], MIX_TrackMSToFrames(a->stems[i], ms));
    }
    MIX_UnlockMixer(a->mixer);
    return true;
}

void r2d_audio_stems_pause(R2DAudio *a, bool paused)
{
    if (!a || a->stem_count <= 0) return;
    for (int i = 0; i < a->stem_count; ++i) {
        if (!a->stems[i]) continue;
        if (paused) MIX_PauseTrack(a->stems[i]);
        else MIX_ResumeTrack(a->stems[i]);
    }
    a->stems_paused = paused;
}

bool r2d_audio_stems_paused(const R2DAudio *a) { return a ? a->stems_paused : false; }

bool r2d_audio_stems_playing(const R2DAudio *a)
{
    if (!a || !a->stems_active || a->stems_paused) return false;
    for (int i = 0; i < a->stem_count; ++i) {
        if (!a->stems[i]) continue;
        // Петля: у дорожки ещё есть итерации — транспорт играет.
        if (MIX_GetTrackLoops(a->stems[i]) != 0) return true;
        if (MIX_GetTrackRemaining(a->stems[i]) > 0) return true;
    }
    return false;
}

int r2d_audio_stem_loops(const R2DAudio *a, int index)
{
    if (!a || index < 0 || index >= a->stem_count || !a->stems[index]) return 0;
    return MIX_GetTrackLoops(a->stems[index]);
}

long long r2d_audio_stem_remaining(const R2DAudio *a, int index)
{
    if (!a || index < 0 || index >= a->stem_count || !a->stems[index]) return -1;
    return (long long)MIX_GetTrackRemaining(a->stems[index]);
}

void r2d_audio_stems_stop(R2DAudio *a, float fade_ms)
{
    if (!a || a->stem_count <= 0) return;
    for (int i = 0; i < a->stem_count; ++i) {
        if (!a->stems[i]) continue;
        MIX_StopTrack(a->stems[i], MIX_TrackMSToFrames(a->stems[i], (Sint64)(fade_ms + 0.5f)));
    }
    a->stems_active = false;
    a->stems_paused = false;
}

double r2d_audio_stem_time(const R2DAudio *a, int index)
{
    if (!a || index < 0 || index >= a->stem_count || !a->stems[index]) return -1.0;
    const Sint64 frames = MIX_GetTrackPlaybackPosition(a->stems[index]);
    if (frames < 0) return -1.0;
    return (double)MIX_TrackFramesToMS(a->stems[index], frames) / 1000.0;
}

long long r2d_audio_stem_frames(const R2DAudio *a, int index)
{
    if (!a || index < 0 || index >= a->stem_count || !a->stems[index]) return -1;
    return (long long)MIX_GetTrackPlaybackPosition(a->stems[index]);
}

void r2d_audio_stem_gain(R2DAudio *a, int index, float gain)
{
    if (!a || index < 0 || index >= a->stem_count) return;
    a->stem_gain[index] = r2d__clamp01(gain);
    if (a->stems[index]) MIX_SetTrackGain(a->stems[index], a->stem_gain[index] * a->music_volume);
}

float r2d_audio_get_stem_gain(const R2DAudio *a, int index)
{
    if (!a || index < 0 || index >= a->stem_count) return 0.0f;
    return a->stem_gain[index];
}

double r2d_audio_stems_loop_start(const R2DAudio *a) { return a ? a->stems_loop_start_ms : 0.0; }

void r2d_audio_set_music_pitch(R2DAudio *a, float ratio)
{
    if (!a) return;
    a->music_pitch = r2d__clamp_pitch(ratio);
    if (a->ready && a->music_track) MIX_SetTrackFrequencyRatio(a->music_track, a->music_pitch);
}

float r2d_audio_get_music_pitch(const R2DAudio *a)
{
    return a ? a->music_pitch : 1.0f;
}

bool r2d_audio_init(R2DAudio *a)
{
    SDL_zero(*a);
    a->master_volume = 1.0f;
    a->sfx_volume    = 1.0f;
    a->music_volume  = 0.7f;
    a->fx_freq       = 48000;
    a->fx_channels   = 2;
    a->music_pitch   = 1.0f;
    for (int i = 0; i < R2D_AUDIO_CHANNELS; ++i) a->channel_pitch[i] = 1.0f;

    if (!MIX_Init()) {
        R2D_ERROR("MIX_Init: %s", SDL_GetError());
        return false;
    }

    // Устройство по умолчанию; формат пусть выберет сам микшер.
    a->mixer = MIX_CreateMixerDevice(SDL_AUDIO_DEVICE_DEFAULT_PLAYBACK, NULL);
    if (!a->mixer) {
        R2D_ERROR("MIX_CreateMixerDevice: %s", SDL_GetError());
        MIX_Quit();
        return false;
    }

    for (int i = 0; i < R2D_AUDIO_CHANNELS; ++i) {
        a->channels[i] = MIX_CreateTrack(a->mixer);
        if (!a->channels[i]) {
            R2D_ERROR("MIX_CreateTrack: %s", SDL_GetError());
            return false;
        }
    }

    a->music_track = MIX_CreateTrack(a->mixer);
    if (!a->music_track) {
        R2D_ERROR("MIX_CreateTrack (музыка): %s", SDL_GetError());
        return false;
    }

    r2d__apply_master(a);
    MIX_SetTrackGain(a->music_track, a->music_volume);

    a->ready = true;

    SDL_AudioSpec spec;
    SDL_zero(spec);
    if (MIX_GetMixerFormat(a->mixer, &spec)) {
        if (spec.freq > 0) a->fx_freq = spec.freq;
        if (spec.channels > 0) a->fx_channels = spec.channels;
        R2D_LOG("аудио готово: %d Гц, %d каналов, %d эффект-каналов",
                 spec.freq, spec.channels, R2D_AUDIO_CHANNELS);
    } else {
        R2D_LOG("аудио готово (%d эффект-каналов)", R2D_AUDIO_CHANNELS);
    }

    // Реверберация: буферы под частоту микшера и один колбэк на весь микс.
    // Колбэк ставим ВСЕГДА (даже если реверб не поднялся): через него же идёт
    // диагностический захват PCM, которым тесты меряют итоговый микс.
    if (!r2d_reverb_init(&a->reverb, a->fx_freq)) {
        R2D_WARN("не удалось подготовить реверберацию — комната будет сухой");
    }
    if (!MIX_SetPostMixCallback(a->mixer, r2d__post_mix, a)) {
        R2D_WARN("MIX_SetPostMixCallback: %s", SDL_GetError());
        r2d_reverb_shutdown(&a->reverb);
    }
    a->reverb_on = false;

    // Колбэк ставим один раз на канал: подмена на лету гонялась бы с
    // аудиопотоком, а сам эффект задаётся полем kind. Буферы (линия задержки,
    // хвост реверба) выделяет модуль эффектов лениво — при включении эффекта.
    a->spatial=r2d_audio_spatial_create(a->fx_freq,a->fx_channels);
    a->binaural.on=false;
    a->binaural.head=0.0875f;      // средний радиус головы, м
    a->binaural.far_gain=0.63f;    // -4 дБ на дальнем ухе при 90°
    a->binaural.rear_gain=1.585f;  // +4 дБ полки ВЧ сзади
    a->binaural.mix=1.0f;
    a->binaural.rate=a->fx_freq>0?a->fx_freq:44100;
    for (int i = 0; i < R2D_AUDIO_CHANNELS; ++i) {
        a->fx[i].spatial=r2d_audio_spatial_channel(a->spatial,i);
        a->fx[i].kind = R2D_AUDIO_FX_NONE;
        a->chan_cb[i].fx=&a->fx[i];
        a->chan_cb[i].owner=a;
        a->chan_cb[i].channel=i;
        MIX_SetTrackRawCallback(a->channels[i], r2d__track_fx, &a->chan_cb[i]);
        MIX_SetTrackCookedCallback(a->channels[i],r2d__track_spatial,&a->chan_cb[i]);
    }
    return true;
}

void r2d_audio_shutdown(R2DAudio *a)
{
    if (!a->mixer) return;

    // Сначала снимаем колбэк: после уничтожения буферов реверба он бы читал
    // освобождённую память, если микшер успел запустить ещё один блок.
    MIX_SetPostMixCallback(a->mixer, NULL, NULL);
    r2d_reverb_shutdown(&a->reverb);
    a->reverb_on = false;
    r2d_audio_capture_clear(a);
    SDL_free(a->capture);
    a->capture = NULL;
    a->capture_cap = 0;
    a->binaural.on = false;
    memset(a->binaural.mode, 0, sizeof a->binaural.mode);

    for (int i = 0; i < R2D_AUDIO_CHANNELS; ++i) {
        if (a->channels[i]) MIX_DestroyTrack(a->channels[i]);
        a->channels[i] = NULL;
        r2d_audio_fx_shutdown(&a->fx[i]);
    }

    // Шины: снимаем колбэк и освобождаем буферы эффектов до уничтожения микшера.
    for (int i = 0; i < a->group_count; ++i) {
        if (a->groups[i].handle) {
            MIX_SetGroupPostMixCallback(a->groups[i].handle, NULL, NULL);
            MIX_DestroyGroup(a->groups[i].handle);
            a->groups[i].handle = NULL;
        }
        r2d_audio_fx_shutdown(&a->groups[i].fx);
        a->group_used[i] = false;
    }
    a->group_count = 0;
    r2d_audio_stems_set(a, NULL, 0);
    if (a->music_track) {
        MIX_DestroyTrack(a->music_track);
        a->music_track = NULL;
    }
    for (int i = 0; i < a->sound_count; ++i) {
        if (a->sounds[i]) MIX_DestroyAudio(a->sounds[i]);
        a->sounds[i] = NULL;
    }
    MIX_DestroyMixer(a->mixer);
    a->mixer = NULL;
    MIX_Quit();

    r2d_audio_spatial_destroy(a->spatial);a->spatial=NULL;
    a->ready = false;
    a->sound_count = 0;
}

// ---------------------------------------------------------------------------
// Загрузка
// ---------------------------------------------------------------------------

int r2d_audio_find(const R2DAudio *a, const char *path)
{
    for (int i = 0; i < a->sound_count; ++i) {
        if (a->sounds[i] && SDL_strcmp(a->names[i], path) == 0) return i;
    }
    return -1;
}

// Кадры микшера → секунды (определение ниже): нужен уже здесь, чтобы журнал
// загрузки печатал длительность в секундах, а не в кадрах.
static double r2d__frames_to_sec(const R2DAudio *a, Sint64 frames);

int r2d_audio_load(R2DAudio *a, const char *path)
{
    if (!a->ready || !path) return -1;

    const int existing = r2d_audio_find(a, path);
    if (existing >= 0) return existing;

    if (a->sound_count >= R2D_AUDIO_MAX_SOUNDS) {
        R2D_ERROR("достигнут лимит звуков (%d)", R2D_AUDIO_MAX_SOUNDS);
        return -1;
    }

    // predecode = false: декодируем на лету, чтобы музыка не съедала память
    // целиком. Короткие эффекты всё равно декодируются полностью при первом
    // проигрывании и дальше берутся из кэша.
    // Из груза звук берём без копирования: буфер живёт столько же, сколько
    // процесс, поэтому MIX_LoadAudioNoCopy здесь и уместен, и безопасен.
    MIX_Audio *audio = NULL;
    if (r2d_vfs_has(path)) {
        size_t data_size = 0;
        uint8_t *data = r2d_vfs_read(path, &data_size);
        if (data) audio = MIX_LoadAudioNoCopy(a->mixer, data, data_size, false);
    } else {
        audio = MIX_LoadAudio(a->mixer, path, false);
    }
    if (!audio) {
        R2D_ERROR("не удалось загрузить звук %s: %s", path, SDL_GetError());
        return -1;
    }

    const int id = a->sound_count++;
    a->sounds[id] = audio;
    SDL_snprintf(a->names[id], sizeof a->names[id], "%s", path);

    // MIX_GetAudioDuration отдаёт длину в СЭМПЛ-КАДРАХ, а не в миллисекундах:
    // раньше журнал делил их на 1000 и показывал 9040 с вместо 188. Переводим
    // тем же помощником, что и r2d_audio_duration/engine.audio.duration().
    const Sint64 frames = MIX_GetAudioDuration(audio);
    R2D_LOG("звук #%d: %s (%.1f с)", id, path,
            frames >= 0 ? r2d__frames_to_sec(a, frames) : -1.0);
    return id;
}

const char *r2d_audio_name(const R2DAudio *a, int id)
{
    if (id < 0 || id >= a->sound_count) return "";
    return a->names[id];
}

double r2d_audio_duration(const R2DAudio *a, int id)
{
    if (id < 0 || id >= a->sound_count || !a->sounds[id]) return -1.0;
    // MIX_GetAudioDuration отдаёт длину в СЭМПЛ-КАДРАХ, а не в миллисекундах:
    // без пересчёта файл на 74 с показывал 3274 с (кадры / 1000).
    const Sint64 frames = MIX_GetAudioDuration(a->sounds[id]);
    if (frames == MIX_DURATION_UNKNOWN || frames == MIX_DURATION_INFINITE) return -1.0;
    if (frames < 0) return -1.0;
    const Sint64 ms = MIX_AudioFramesToMS(a->sounds[id], frames);
    return ms >= 0 ? (double)ms / 1000.0 : -1.0;
}

// ---------------------------------------------------------------------------
// Эффекты
// ---------------------------------------------------------------------------

int r2d_audio_play(R2DAudio *a, int id, float volume, float pan, int loops,
                   int priority)
{
    if (!a->ready || id < 0 || id >= a->sound_count) return -1;

    // Ищем свободный канал. Если все заняты — вытесняем САМЫЙ НЕВАЖНЫЙ, а не
    // всегда нулевой: раньше важный звук (реплика, удар) глушился первым же
    // шагом по траве, потому что жертвой всегда был канал 0.
    int channel = -1;
    for (int i = 0; i < R2D_AUDIO_CHANNELS; ++i) {
        if (!MIX_TrackPlaying(a->channels[i])) { channel = i; break; }
    }
    if (channel < 0) {
        int victim = -1;
        for (int i = 0; i < R2D_AUDIO_CHANNELS; ++i) {
            if (victim < 0 || a->channel_priority[i] < a->channel_priority[victim]) victim = i;
        }
        // Вытесняем только если новый звук НЕ МЕНЕЕ важен: иначе лучше не
        // играть вовсе, чем глушить то, что игрок должен слышать.
        if (victim >= 0 && priority >= a->channel_priority[victim]) channel = victim;
    }
    if (channel < 0) return -1;

    MIX_Track *track = a->channels[channel];
    r2d_audio_spatial_params(a->fx[channel].spatial,false,false,0,0,-1,22000);
    r2d_audio_spatial_reset(a->fx[channel].spatial);
    a->channel_3d[channel]=false;
    if(++a->channel_generation[channel]>1000000)a->channel_generation[channel]=1;

    if (!MIX_SetTrackAudio(track, a->sounds[id])) return -1;

    // Канал либо в обычном стерео-режиме (панорама), либо в 3D: задавать оба
    // нельзя — MIX_SetTrackStereo выключает 3D и наоборот.
    if (!a->channel_3d[channel]) {
        MIX_StereoGains gains;
        r2d__stereo_from_pan(pan, &gains);
        MIX_SetTrackStereo(track, &gains);
    }

    // Запоминаем, что поставила игра: шины пересчитывают громкость канала
    // позже, и им нужно знать исходное значение.
    a->channel_volume[channel] = r2d__clamp01(volume);
    a->channel_pan[channel] = pan < -1.0f ? -1.0f : (pan > 1.0f ? 1.0f : pan);
    a->channel_priority[channel] = priority;

    MIX_SetTrackGain(track, a->channel_volume[channel] * a->sfx_volume);
    // Скорость (pitch) канала переживает повторный запуск: трек один и тот же,
    // а MIX_SetTrackAudio её не сбрасывает — но применить всё равно надёжнее.
    MIX_SetTrackFrequencyRatio(track, a->channel_pitch[channel]);

    SDL_PropertiesID props = SDL_CreateProperties();
    if (!props) return -1;
    SDL_SetNumberProperty(props, MIX_PROP_PLAY_LOOPS_NUMBER, loops);
    const bool ok = MIX_PlayTrack(track, props);
    SDL_DestroyProperties(props);

    return ok ? channel : -1;
}

/** Кадры → секунды по частоте микшера. */
static double r2d__frames_to_sec(const R2DAudio *a, Sint64 frames)
{
    const int freq = a->fx_freq > 0 ? a->fx_freq : 44100;
    return (double)frames / (double)freq;
}

bool r2d_audio_seek(R2DAudio *a, int channel, double seconds)
{
    if (!a->ready || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return false;
    if (!MIX_TrackPlaying(a->channels[channel])) return false;
    const int freq = a->fx_freq > 0 ? a->fx_freq : 44100;
    Sint64 frames = (Sint64)(seconds * (double)freq);
    if (frames < 0) frames = 0;
    return MIX_SetTrackPlaybackPosition(a->channels[channel], frames);
}

double r2d_audio_position(const R2DAudio *a, int channel)
{
    if (!a->ready || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return -1;
    if (!MIX_TrackPlaying(a->channels[channel])) return -1;
    return r2d__frames_to_sec(a, MIX_GetTrackPlaybackPosition(a->channels[channel]));
}

double r2d_audio_channel_duration(const R2DAudio *a, int channel)
{
    if (!a->ready || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return -1;
    const MIX_Audio *audio = MIX_GetTrackAudio(a->channels[channel]);
    if (!audio) return -1;
    const Sint64 frames = MIX_GetAudioDuration(audio);
    if (frames <= 0) return -1;
    return r2d__frames_to_sec(a, frames);
}

int r2d_audio_channel_priority(const R2DAudio *a, int channel)
{
    if (!a->ready || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return -1;
    if (!MIX_TrackPlaying(a->channels[channel])) return -1;
    return a->channel_priority[channel];
}

void r2d_audio_stop_channel(R2DAudio *a, int channel, float fade_ms)
{
    if (!a->ready || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return;
    MIX_StopTrack(a->channels[channel], (Sint64)fade_ms);
}

void r2d_audio_stop_all(R2DAudio *a, float fade_ms)
{
    if (!a->ready) return;
    for (int i = 0; i < R2D_AUDIO_CHANNELS; ++i) {
        MIX_StopTrack(a->channels[i], (Sint64)fade_ms);
    }
}

bool r2d_audio_channel_playing(const R2DAudio *a, int channel)
{
    if (!a->ready || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return false;
    return MIX_TrackPlaying(a->channels[channel]);
}

int r2d_audio_active_channels(const R2DAudio *a)
{
    if (!a->ready) return 0;
    int n = 0;
    for (int i = 0; i < R2D_AUDIO_CHANNELS; ++i) {
        if (MIX_TrackPlaying(a->channels[i])) n++;
    }
    return n;
}

// ---------------------------------------------------------------------------
// Музыка
// ---------------------------------------------------------------------------

void r2d_audio_play_music(R2DAudio *a, int id, float volume, bool loop, float fade_ms)
{
    if (!a->ready || id < 0 || id >= a->sound_count) return;

    if (!MIX_SetTrackAudio(a->music_track, a->sounds[id])) return;

    // Музыку не панорамируем — она играет по центру.
    MIX_SetTrackGain(a->music_track, r2d__clamp01(volume) * a->music_volume);
    MIX_SetTrackFrequencyRatio(a->music_track, a->music_pitch);

    SDL_PropertiesID props = SDL_CreateProperties();
    if (!props) return;
    SDL_SetNumberProperty(props, MIX_PROP_PLAY_LOOPS_NUMBER, loop ? -1 : 0);
    if (fade_ms > 0.0f) {
        SDL_SetNumberProperty(props, MIX_PROP_PLAY_FADE_IN_MILLISECONDS_NUMBER, (Sint64)fade_ms);
    }
    MIX_PlayTrack(a->music_track, props);
    SDL_DestroyProperties(props);
}

void r2d_audio_stop_music(R2DAudio *a, float fade_ms)
{
    if (!a->ready) return;
    MIX_StopTrack(a->music_track, (Sint64)fade_ms);
}

void r2d_audio_pause_music(R2DAudio *a, bool paused)
{
    if (!a->ready) return;
    if (paused) MIX_PauseTrack(a->music_track);
    else        MIX_ResumeTrack(a->music_track);
}

bool r2d_audio_music_playing(const R2DAudio *a)
{
    if (!a->ready) return false;
    return MIX_TrackPlaying(a->music_track);
}

// ---------------------------------------------------------------------------
// Громкость
// ---------------------------------------------------------------------------

void r2d_audio_set_master_volume(R2DAudio *a, float v)
{
    a->master_volume = r2d__clamp01(v);
    r2d__apply_master(a);
}

float r2d_audio_get_master_volume(const R2DAudio *a) { return a->master_volume; }

void r2d_audio_set_sfx_volume(R2DAudio *a, float v)
{
    a->sfx_volume = r2d__clamp01(v);
    // Уже играющие звуки тоже должны подчиниться: иначе громкость шины
    // менялась бы только для следующих запусков, что звучит как баг.
    if (!a->ready) return;
    for (int i = 0; i < R2D_AUDIO_CHANNELS; ++i) {
        if (MIX_TrackPlaying(a->channels[i])) {
            MIX_SetTrackGain(a->channels[i], a->channel_volume[i] * a->sfx_volume);
        }
    }
}

float r2d_audio_get_sfx_volume(const R2DAudio *a) { return a->sfx_volume; }

static void r2d__apply_stem_gains(R2DAudio *a)
{
    if (!a) return;
    for (int i = 0; i < a->stem_count; ++i) {
        if (a->stems[i]) MIX_SetTrackGain(a->stems[i], r2d__clamp01(a->stem_gain[i]) * a->music_volume);
    }
}

void r2d_audio_set_music_volume(R2DAudio *a, float v)
{
    if (!a) return;
    a->music_volume = r2d__clamp01(v);
    if (a->ready && a->music_track) {
        MIX_SetTrackGain(a->music_track, a->music_volume);
    }
    // Слои живут на своих дорожках: громкость музыки обязана действовать и на них.
    r2d__apply_stem_gains(a);
}

float r2d_audio_get_music_volume(const R2DAudio *a) { return a->music_volume; }

bool r2d_audio_hrtf_available(const R2DAudio *a) {
    return a && a->spatial && r2d_audio_spatial_hrtf(a->spatial);
}

void r2d_audio_binaural_set(R2DAudio *a,bool on,float head,float far_gain,float rear_gain,float mix) {
    if(!a)return;
    R2DAudioBinaural *b=&a->binaural;
    b->on=on;
    if(head>0.01f&&head<1.0f)b->head=head;
    if(far_gain>0.0f&&far_gain<=1.0f)b->far_gain=far_gain;
    if(rear_gain>=1.0f&&rear_gain<=8.0f)b->rear_gain=rear_gain;
    if(mix>=0.0f&&mix<=1.0f)b->mix=mix;
}

void r2d_audio_binaural_get(const R2DAudio *a,bool *on,float *head,float *far_gain,float *rear_gain,float *mix) {
    if(!a)return;
    const R2DAudioBinaural *b=&a->binaural;
    if(on)*on=b->on;
    if(head)*head=b->head;
    if(far_gain)*far_gain=b->far_gain;
    if(rear_gain)*rear_gain=b->rear_gain;
    if(mix)*mix=b->mix;
}

static void r2d__binaural_channel_mode(R2DAudio *a,int channel,bool active,float azimuth,unsigned char mode) {
    if(!a||channel<0||channel>=R2D_AUDIO_CHANNELS)return;
    R2DAudioBinaural *b=&a->binaural;
    if(!active){b->active[channel]=false;b->mode[channel]=0;return;}
    // Азимут нормализуем в (-pi, pi]: мусор (NaN/inf) выключает канал, иначе
    // фильтры «залипли» бы в NaN и звук пропал бы совсем.
    if(!isfinite(azimuth)){b->active[channel]=false;return;}
    float az=fmodf(azimuth+SDL_PI_F,2.0f*SDL_PI_F);
    if(az<0.0f)az+=2.0f*SDL_PI_F;
    az-=SDL_PI_F;
    if(!b->active[channel]){          // новый источник: чистое состояние
        b->pos[channel]=0;
        b->lp_near[channel]=b->lp_far[channel]=b->lp_far_low[channel]=0.0f;
        b->shelf[channel][0]=b->shelf[channel][1]=0.0f;
        memset(b->line[channel],0,sizeof b->line[channel]);
    }
    b->az[channel]=az;
    b->active[channel]=true;
    b->mode[channel]=mode;
}

void r2d_audio_binaural_channel(R2DAudio *a,int channel,bool active,float azimuth) {
    r2d__binaural_channel_mode(a,channel,active,azimuth,1);
}

void r2d_audio_itd_channel(R2DAudio *a,int channel,bool active,float azimuth) {
    r2d__binaural_channel_mode(a,channel,active,azimuth,2);
}

bool r2d_audio_capture_start(R2DAudio *a,int frames) {
    if(!a||frames<=0)return false;
    if(frames>a->capture_cap){
        float *next=(float *)SDL_realloc(a->capture,(size_t)frames*2*sizeof(float));
        if(!next)return false;
        a->capture=next;a->capture_cap=frames;
    }
    a->capture_len=0;
    SDL_SetAtomicInt(&a->capture_on,1);
    return true;
}

int r2d_audio_capture_len(const R2DAudio *a){return a?a->capture_len:0;}
const float *r2d_audio_capture_data(const R2DAudio *a){return a?a->capture:NULL;}
void r2d_audio_capture_clear(R2DAudio *a){if(a){a->capture_len=0;SDL_SetAtomicInt(&a->capture_on,0);}}

bool r2d_audio_world_channel(R2DAudio *a,int c,bool enabled,bool hrtf,float x,float y,float z,float gain,float cutoff) {
    if(!a||!a->ready||c<0||c>=R2D_AUDIO_CHANNELS||!a->spatial)return false;
    if(hrtf&&!r2d_audio_spatial_hrtf(a->spatial))return false;
    MIX_StereoGains stereo={1,1};MIX_SetTrackStereo(a->channels[c],&stereo);a->channel_3d[c]=false;
    r2d_audio_set_channel_volume(a,c,gain);
    r2d_audio_spatial_params(a->fx[c].spatial,enabled,hrtf,x,y,z,cutoff);return true;
}
