// ===========================================================================
// Заглушки звуковой подсистемы.
//
// Компилируются вместо audio.c, когда движок собран с -DR2D_ENABLE_AUDIO=OFF.
// Нужны, чтобы скриптовый слой не обрастал #ifdef: вызовы engine.audio.*
// молча ничего не делают, а load() возвращает -1.
// ===========================================================================

#include "audio.h"

bool r2d_audio_init(R2DAudio *a)
{
    SDL_zero(*a);
    a->master_volume = 1.0f;
    a->sfx_volume = 1.0f;
    a->music_volume = 0.0f;
    R2D_WARN("движок собран без звука (R2D_ENABLE_AUDIO=OFF) — engine.audio.* недоступен");
    return false;
}

void r2d_audio_shutdown(R2DAudio *a) { SDL_zero(*a); }

int r2d_audio_load(R2DAudio *a, const char *path)
{
    R2D_UNUSED(a);
    R2D_UNUSED(path);
    return -1;
}

int r2d_audio_find(const R2DAudio *a, const char *path)
{
    R2D_UNUSED(a);
    R2D_UNUSED(path);
    return -1;
}

const char *r2d_audio_name(const R2DAudio *a, int id)
{
    R2D_UNUSED(a);
    R2D_UNUSED(id);
    return "";
}

double r2d_audio_duration(const R2DAudio *a, int id)
{
    R2D_UNUSED(a);
    R2D_UNUSED(id);
    return -1.0;
}

int r2d_audio_play(R2DAudio *a, int id, float volume, float pan, int loops, int priority)
{
    R2D_UNUSED(a); R2D_UNUSED(id); R2D_UNUSED(volume); R2D_UNUSED(pan);
    R2D_UNUSED(loops); R2D_UNUSED(priority);
    return -1;
}
bool r2d_audio_seek(R2DAudio *a, int channel, double seconds)
{ R2D_UNUSED(a); R2D_UNUSED(channel); R2D_UNUSED(seconds); return false; }
double r2d_audio_position(const R2DAudio *a, int channel)
{ R2D_UNUSED(a); R2D_UNUSED(channel); return -1; }
double r2d_audio_channel_duration(const R2DAudio *a, int channel)
{ R2D_UNUSED(a); R2D_UNUSED(channel); return -1; }
int r2d_audio_channel_priority(const R2DAudio *a, int channel)
{ R2D_UNUSED(a); R2D_UNUSED(channel); return -1; }

void r2d_audio_stop_channel(R2DAudio *a, int channel, float fade_ms)
{
    R2D_UNUSED(a); R2D_UNUSED(channel); R2D_UNUSED(fade_ms);
}

void r2d_audio_stop_all(R2DAudio *a, float fade_ms)
{
    R2D_UNUSED(a); R2D_UNUSED(fade_ms);
}

bool r2d_audio_channel_playing(const R2DAudio *a, int channel)
{
    R2D_UNUSED(a); R2D_UNUSED(channel);
    return false;
}

int r2d_audio_active_channels(const R2DAudio *a) { R2D_UNUSED(a); return 0; }

void r2d_audio_set_channel_volume(R2DAudio *a, int channel, float v)
{
    R2D_UNUSED(a); R2D_UNUSED(channel); R2D_UNUSED(v);
}

float r2d_audio_get_channel_volume(const R2DAudio *a, int channel)
{
    R2D_UNUSED(a); R2D_UNUSED(channel);
    return 0.0f;
}

void r2d_audio_set_channel_pan(R2DAudio *a, int channel, float pan)
{
    R2D_UNUSED(a); R2D_UNUSED(channel); R2D_UNUSED(pan);
}

float r2d_audio_get_channel_pan(const R2DAudio *a, int channel)
{
    R2D_UNUSED(a); R2D_UNUSED(channel);
    return 0.0f;
}

bool r2d_audio_set_channel_reverb(R2DAudio *a, int channel, float send, float room,
                                  float damp, float width)
{
    R2D_UNUSED(a); R2D_UNUSED(channel); R2D_UNUSED(send);
    R2D_UNUSED(room); R2D_UNUSED(damp); R2D_UNUSED(width);
    return false;
}

bool r2d_audio_set_channel_effect(R2DAudio *a, int channel, const char *kind,
                                  float p1, float p2)
{
    R2D_UNUSED(a); R2D_UNUSED(channel); R2D_UNUSED(kind); R2D_UNUSED(p1); R2D_UNUSED(p2);
    return false;
}

const char *r2d_audio_channel_effect(const R2DAudio *a, int channel)
{
    R2D_UNUSED(a); R2D_UNUSED(channel);
    return "none";
}

int r2d_audio_effect_count(void) { return 1; }

const char *r2d_audio_effect_name(int index)
{
    R2D_UNUSED(index);
    return "none";
}

void r2d_audio_play_music(R2DAudio *a, int id, float volume, bool loop, float fade_ms)
{
    R2D_UNUSED(a); R2D_UNUSED(id); R2D_UNUSED(volume); R2D_UNUSED(loop); R2D_UNUSED(fade_ms);
}

void r2d_audio_stop_music(R2DAudio *a, float fade_ms)
{
    R2D_UNUSED(a); R2D_UNUSED(fade_ms);
}

void r2d_audio_pause_music(R2DAudio *a, bool paused)
{
    R2D_UNUSED(a); R2D_UNUSED(paused);
}

bool r2d_audio_music_playing(const R2DAudio *a) { R2D_UNUSED(a); return false; }

void r2d_audio_set_master_volume(R2DAudio *a, float v) { R2D_UNUSED(a); R2D_UNUSED(v); }
float r2d_audio_get_master_volume(const R2DAudio *a) { R2D_UNUSED(a); return 0.0f; }
void r2d_audio_set_sfx_volume(R2DAudio *a, float v) { R2D_UNUSED(a); R2D_UNUSED(v); }
float r2d_audio_get_sfx_volume(const R2DAudio *a) { R2D_UNUSED(a); return 0.0f; }
void r2d_audio_set_music_volume(R2DAudio *a, float v) { R2D_UNUSED(a); R2D_UNUSED(v); }
float r2d_audio_get_music_volume(const R2DAudio *a) { R2D_UNUSED(a); return 0.0f; }

void r2d_audio_set_channel_pitch(R2DAudio *a, int channel, float ratio)
{
    R2D_UNUSED(a); R2D_UNUSED(channel); R2D_UNUSED(ratio);
}

float r2d_audio_get_channel_pitch(const R2DAudio *a, int channel)
{
    R2D_UNUSED(a); R2D_UNUSED(channel);
    return 1.0f;
}

void r2d_audio_set_music_pitch(R2DAudio *a, float ratio) { R2D_UNUSED(a); R2D_UNUSED(ratio); }
float r2d_audio_get_music_pitch(const R2DAudio *a) { R2D_UNUSED(a); return 1.0f; }

bool r2d_audio_set_room(R2DAudio *a, float wet, float room, float damp, float width)
{
    R2D_UNUSED(a); R2D_UNUSED(wet); R2D_UNUSED(room); R2D_UNUSED(damp); R2D_UNUSED(width);
    return false;
}

void r2d_audio_get_room(const R2DAudio *a, float *wet, float *room, float *damp, float *width)
{
    R2D_UNUSED(a);
    if (wet) *wet = 0.0f;
    if (room) *room = 0.0f;
    if (damp) *damp = 0.0f;
    if (width) *width = 0.0f;
}

int r2d_audio_group(R2DAudio *a, const char *name)
{
    R2D_UNUSED(a); R2D_UNUSED(name);
    return -1;
}

int r2d_audio_group_count(const R2DAudio *a) { R2D_UNUSED(a); return 0; }

bool r2d_audio_group_assign(R2DAudio *a, int channel, int group_id)
{
    R2D_UNUSED(a); R2D_UNUSED(channel); R2D_UNUSED(group_id);
    return false;
}

bool r2d_audio_set_group_reverb(R2DAudio *a, int group_id, float send, float room,
                                float damp, float width)
{
    R2D_UNUSED(a); R2D_UNUSED(group_id); R2D_UNUSED(send);
    R2D_UNUSED(room); R2D_UNUSED(damp); R2D_UNUSED(width);
    return false;
}

bool r2d_audio_set_group_effect(R2DAudio *a, int group_id, const char *kind, float p1, float p2)
{
    R2D_UNUSED(a); R2D_UNUSED(group_id); R2D_UNUSED(kind); R2D_UNUSED(p1); R2D_UNUSED(p2);
    return false;
}

const char *r2d_audio_group_effect(const R2DAudio *a, int group_id)
{
    R2D_UNUSED(a); R2D_UNUSED(group_id);
    return "none";
}

bool r2d_audio_set_channel_3d(R2DAudio *a, int channel, float x, float y, float z, bool on)
{
    R2D_UNUSED(a); R2D_UNUSED(channel);
    R2D_UNUSED(x); R2D_UNUSED(y); R2D_UNUSED(z); R2D_UNUSED(on);
    return false;
}
