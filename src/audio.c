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
// Эффекты канала
//
// SDL_mixer 3.2 не содержит готовых эффектов, но отдаёт сырые сэмплы в
// MIX_SetTrackRawCallback. Колбэк работает в аудиопотоке: здесь нельзя
// выделять память и нельзя трогать сам трек — только pcm.
// ---------------------------------------------------------------------------

static const char *const r2d__fx_names[] = { "none", "lowpass", "echo" };

int r2d_audio_effect_count(void)
{
    return (int)(sizeof(r2d__fx_names) / sizeof(r2d__fx_names[0]));
}

const char *r2d_audio_effect_name(int index)
{
    if (index < 0 || index >= r2d_audio_effect_count()) return "none";
    return r2d__fx_names[index];
}

static void SDLCALL r2d__fx_process(void *userdata, MIX_Track *track,
                                    const SDL_AudioSpec *spec, float *pcm, int samples)
{
    R2D_UNUSED(track);
    R2DAudioChannelFx *fx = (R2DAudioChannelFx *)userdata;
    if (!fx || fx->kind == R2D_AUDIO_FX_NONE || !pcm || samples <= 0) return;

    const int ch = spec->channels > 0 ? spec->channels : 1;
    const int frames = samples / ch;
    if (frames <= 0) return;

    if (fx->kind == R2D_AUDIO_FX_LOWPASS) {
        // p1 уже коэффициент сглаживания: y += a * (x - y).
        const float alpha = fx->p1;
        for (int f = 0; f < frames; ++f) {
            for (int c = 0; c < ch && c < 2; ++c) {
                float *s = &pcm[f * ch + c];
                fx->z[c] += alpha * (*s - fx->z[c]);
                *s = fx->z[c];
            }
        }
        return;
    }

    if (fx->kind == R2D_AUDIO_FX_ECHO && fx->line) {
        const int cap = R2D_AUDIO_FX_FRAMES;
        int delay = (int)(fx->p1 * (float)spec->freq / 1000.0f);
        if (delay < 1) delay = 1;
        if (delay >= cap) delay = cap - 1;
        const float feedback = fx->p2;
        // Линия задержки выделена на два канала (см. r2d_audio_init), а
        // spec->channels приходит от декодера и может быть больше — например
        // 6 у 5.1. Индексировать её по ch нельзя: запись уходила бы далеко за
        // конец буфера. Обрабатываем максимум два канала с их же шагом.
        const int line_ch = ch > 2 ? 2 : ch;
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
    }
}

bool r2d_audio_set_channel_effect(R2DAudio *a, int channel, const char *kind,
                                  float p1, float p2)
{
    if (!a || !a->ready || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return false;

    R2DAudioChannelFx *fx = &a->fx[channel];
    if (!kind || SDL_strcmp(kind, "none") == 0) {
        fx->kind = R2D_AUDIO_FX_NONE;
        return true;
    }

    if (SDL_strcmp(kind, "lowpass") == 0) {
        float fc = p1 > 0.0f ? p1 : 800.0f;
        const float nyquist = (float)a->fx_freq * 0.45f;
        if (fc > nyquist) fc = nyquist;
        fx->p1 = 1.0f - SDL_expf(-2.0f * SDL_PI_F * fc / (float)a->fx_freq);
        fx->kind = R2D_AUDIO_FX_LOWPASS;
        return true;
    }

    if (SDL_strcmp(kind, "echo") == 0) {
        fx->p1 = p1 > 0.0f ? p1 : 180.0f;                  // задержка, мс
        float fb = p2 > 0.0f ? p2 : 0.35f;                 // доля повтора
        if (fb > 0.9f) fb = 0.9f;
        fx->p2 = fb;
        if (fx->line) {
            SDL_memset(fx->line, 0, sizeof(float) * 2 * R2D_AUDIO_FX_FRAMES);
        }
        fx->pos = 0;
        fx->kind = R2D_AUDIO_FX_ECHO;
        return true;
    }

    return false;
}

const char *r2d_audio_channel_effect(const R2DAudio *a, int channel)
{
    if (!a || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return "none";
    switch (a->fx[channel].kind) {
    case R2D_AUDIO_FX_LOWPASS: return "lowpass";
    case R2D_AUDIO_FX_ECHO:    return "echo";
    default:                   return "none";
    }
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

    MIX_StereoGains gains;
    r2d__stereo_from_pan(pan, &gains);
    MIX_SetTrackStereo(a->channels[channel], &gains);
}

float r2d_audio_get_channel_pan(const R2DAudio *a, int channel)
{
    if (!a || channel < 0 || channel >= R2D_AUDIO_CHANNELS) return 0.0f;
    return a->channel_pan[channel];
}

bool r2d_audio_init(R2DAudio *a)
{
    SDL_zero(*a);
    a->master_volume = 1.0f;
    a->sfx_volume    = 1.0f;
    a->music_volume  = 0.7f;
    a->fx_freq       = 48000;
    a->fx_channels   = 2;

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

    // Буферы эффектов и колбэк ставим один раз: подмена колбэка на лету
    // гонялась бы с аудиопотоком, а сам эффект задаётся полем kind.
    for (int i = 0; i < R2D_AUDIO_CHANNELS; ++i) {
        a->fx[i].line = (float *)SDL_calloc((size_t)R2D_AUDIO_FX_FRAMES * 2, sizeof(float));
        if (!a->fx[i].line) {
            R2D_ERROR("не удалось выделить буфер эффекта канала %d", i);
            return false;
        }
        a->fx[i].kind = R2D_AUDIO_FX_NONE;
        MIX_SetTrackRawCallback(a->channels[i], r2d__fx_process, &a->fx[i]);
    }
    return true;
}

void r2d_audio_shutdown(R2DAudio *a)
{
    if (!a->mixer) return;

    for (int i = 0; i < R2D_AUDIO_CHANNELS; ++i) {
        if (a->channels[i]) MIX_DestroyTrack(a->channels[i]);
        a->channels[i] = NULL;
        if (a->fx[i].line) {
            SDL_free(a->fx[i].line);
            a->fx[i].line = NULL;
        }
    }
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

    const Sint64 ms = MIX_GetAudioDuration(audio);
    R2D_LOG("звук #%d: %s (%.1f с)", id, path, ms >= 0 ? (double)ms / 1000.0 : -1.0);
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
    const Sint64 ms = MIX_GetAudioDuration(a->sounds[id]);
    return ms >= 0 ? (double)ms / 1000.0 : -1.0;
}

// ---------------------------------------------------------------------------
// Эффекты
// ---------------------------------------------------------------------------

int r2d_audio_play(R2DAudio *a, int id, float volume, float pan, int loops)
{
    if (!a->ready || id < 0 || id >= a->sound_count) return -1;

    // Ищем свободный канал; если все заняты — переиспользуем нулевой, чтобы
    // звук всё равно был слышен (лучше вытеснить старый, чем потерять новый).
    int channel = 0;
    for (int i = 0; i < R2D_AUDIO_CHANNELS; ++i) {
        if (!MIX_TrackPlaying(a->channels[i])) { channel = i; break; }
    }

    MIX_Track *track = a->channels[channel];

    if (!MIX_SetTrackAudio(track, a->sounds[id])) return -1;

    MIX_StereoGains gains;
    r2d__stereo_from_pan(pan, &gains);
    MIX_SetTrackStereo(track, &gains);

    // Запоминаем, что поставила игра: шины пересчитывают громкость канала
    // позже, и им нужно знать исходное значение.
    a->channel_volume[channel] = r2d__clamp01(volume);
    a->channel_pan[channel] = pan < -1.0f ? -1.0f : (pan > 1.0f ? 1.0f : pan);

    MIX_SetTrackGain(track, a->channel_volume[channel] * a->sfx_volume);

    SDL_PropertiesID props = SDL_CreateProperties();
    if (!props) return -1;
    SDL_SetNumberProperty(props, MIX_PROP_PLAY_LOOPS_NUMBER, loops);
    const bool ok = MIX_PlayTrack(track, props);
    SDL_DestroyProperties(props);

    return ok ? channel : -1;
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
