#include "audio.h"

#include "payload.h"

#include <SDL3/SDL.h>
#include <SDL3_mixer/SDL_mixer.h>

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
    if (!a || !a->reverb_on || !spec || !pcm || samples <= 0) return;
    r2d_reverb_process(&a->reverb, pcm, samples, spec->channels);
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
        if (SDL_strcmp(a->groups[i].name, name) == 0) return i;
    }
    if (a->group_count >= R2D_AUDIO_MAX_GROUPS) {
        R2D_ERROR("достигнут лимит аудио-шин (%d)", R2D_AUDIO_MAX_GROUPS);
        return -1;
    }

    R2DAudioGroup *g = &a->groups[a->group_count];
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
    return a->group_count++;
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

static void SDLCALL r2d__track_fx(void *userdata, MIX_Track *track,
                                  const SDL_AudioSpec *spec, float *pcm, int samples)
{
    R2D_UNUSED(track);
    r2d_audio_fx_process((R2DAudioFx *)userdata, spec, pcm, samples);
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
    if (!r2d_reverb_init(&a->reverb, a->fx_freq)) {
        R2D_WARN("не удалось подготовить реверберацию — комната будет сухой");
    } else if (!MIX_SetPostMixCallback(a->mixer, r2d__post_mix, a)) {
        R2D_WARN("MIX_SetPostMixCallback: %s", SDL_GetError());
        r2d_reverb_shutdown(&a->reverb);
    }
    a->reverb_on = false;

    // Колбэк ставим один раз на канал: подмена на лету гонялась бы с
    // аудиопотоком, а сам эффект задаётся полем kind. Буферы (линия задержки,
    // хвост реверба) выделяет модуль эффектов лениво — при включении эффекта.
    for (int i = 0; i < R2D_AUDIO_CHANNELS; ++i) {
        a->fx[i].kind = R2D_AUDIO_FX_NONE;
        MIX_SetTrackRawCallback(a->channels[i], r2d__track_fx, &a->fx[i]);
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
    }
    a->group_count = 0;
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

void r2d_audio_set_music_volume(R2DAudio *a, float v)
{
    a->music_volume = r2d__clamp01(v);
    if (a->ready && a->music_track) {
        MIX_SetTrackGain(a->music_track, a->music_volume);
    }
}

float r2d_audio_get_music_volume(const R2DAudio *a) { return a->music_volume; }
