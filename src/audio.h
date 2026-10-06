// ===========================================================================
// Звук и музыка на SDL3_mixer.
//
// Ядро SDL3 умеет отдавать на устройство только сырые сэмплы — декодеров
// OGG/MP3 в нём нет. Поэтому звуковой слой построен на SDL_mixer 3, который
// даёт загрузку файлов, каналы, петли, затухания и стриминг музыки.
//
// Разделение простое:
//   * звуковые эффекты играют на пуле каналов (их можно останавливать);
//   * музыка идёт отдельной дорожкой, у неё своя громкость и затухания.
// ===========================================================================
#pragma once

#include "r2d.h"
#include "audio_reverb.h"

#include <stdbool.h>

// --- Непрозрачные типы SDL_mixer -------------------------------------------
// Объявляем их сами, чтобы этот заголовок не тянул SDL_mixer.h: движок
// собирается и без звука (тогда используется src/audio_stub.c).
typedef struct MIX_Mixer MIX_Mixer;
typedef struct MIX_Audio MIX_Audio;
typedef struct MIX_Track MIX_Track;
typedef struct MIX_Group MIX_Group;

#define R2D_AUDIO_MAX_SOUNDS 128
#define R2D_AUDIO_CHANNELS   16

// --- Эффекты на канале ------------------------------------------------------
//
// SDL_mixer 3.2 не даёт готовых DSP-эффектов: единственная точка входа в
// сэмплы — MIX_SetTrackRawCallback. Через неё реализованы простые эффекты,
// которых хватает игре: фильтр низких частот и эхо. Обработка идёт в
// аудиопотоке, поэтому:
//   * буфер задержки выделяется один раз в init (аллокация в потоке запрещена);
//   * параметры только читаются в колбэке, меняются они из потока игры.
typedef enum R2DAudioFx {
    R2D_AUDIO_FX_NONE    = 0,
    R2D_AUDIO_FX_LOWPASS = 1,   // p1 — частота среза в Гц (мягкая, one-pole)
    R2D_AUDIO_FX_ECHO    = 2,   // p1 — задержка в мс, p2 — доля повтора 0..1
} R2DAudioFx;

// Сколько кадров вмещает линия задержки эха. 0.5 с при 48 кГц — компромисс
// между памятью (16 каналов × 2 канала × 24000 float ≈ 3 МБ) и слышимым эхом.
#define R2D_AUDIO_FX_FRAMES 24000

typedef struct R2DAudioChannelFx {
    int    kind;    // R2DAudioFx
    float  p1;      // параметр эффекта: срез (Гц) либо задержка (мс)
    float  p2;      // доля повтора для эха
    float  z[2];    // состояние фильтра, по одному на аудиоканал
    float *line;    // буфер задержки, interleaved
    int    pos;     // текущий кадр в буфере задержки
} R2DAudioChannelFx;

// Шина микшера: настоящая группа SDL_mixer. Треки одной шины микшируются
// вместе, и эффект шины (MIX_SetGroupPostMixCallback) обрабатывает уже
// готовый микс этой шины — то есть действует и на звуки, запущенные позже.
// Группы в SDL_mixer 3.2 плоские (без вложенности и без своего гейна), поэтому
// громкость/mute/solo по-прежнему считает JS, а группа отвечает за DSP.
#define R2D_AUDIO_MAX_GROUPS 8

typedef struct R2DAudioGroup {
    MIX_Group *handle;
    char       name[32];
    R2DAudioChannelFx fx;   // эффект шины (обрабатывает буфер группы)
} R2DAudioGroup;

typedef struct R2DAudio {
    MIX_Mixer *mixer;

    MIX_Audio *sounds[R2D_AUDIO_MAX_SOUNDS];
    char       names[R2D_AUDIO_MAX_SOUNDS][192];
    int        sound_count;

    MIX_Track *channels[R2D_AUDIO_CHANNELS];
    MIX_Track *music_track;

    bool  ready;
    float master_volume;   // 0..1, применяется ко всему миксу
    float sfx_volume;      // 0..1, множитель для эффектов
    float music_volume;    // 0..1, множитель для музыки

    // Состояние каналов, которое нужно высокоуровневому API для шин: игра
    // задаёт громкость/панораму/эффект, а движок хранит их, чтобы вернуть
    // обратно и пересчитать при смене громкости шины.
    float channel_volume[R2D_AUDIO_CHANNELS];
    float channel_pan[R2D_AUDIO_CHANNELS];
    // Скорость воспроизведения канала: 1.0 — как записано, 2.0 — вдвое
    // быстрее и выше (MIX_SetTrackFrequencyRatio). Живёт здесь, чтобы
    // переживать MIX_SetTrackAudio при повторном запуске звука.
    float channel_pitch[R2D_AUDIO_CHANNELS];
    // Канал в 3D-режиме: координаты задаются относительно слушателя (он у
    // SDL_mixer всегда в нуле), SDL сам считает затухание и панораму.
    bool  channel_3d[R2D_AUDIO_CHANNELS];

    R2DAudioGroup groups[R2D_AUDIO_MAX_GROUPS];
    int    group_count;

    R2DAudioChannelFx fx[R2D_AUDIO_CHANNELS];
    int    fx_freq;        // частота микшера, нужна для пересчёта мс → кадры
    int    fx_channels;    // 1 или 2, из формата микшера

    // Реверберация помещения: одна на весь микс (MIX_SetPostMixCallback),
    // как комната — она звучит для всех источников сразу.
    R2DAudioReverb reverb;
    bool  reverb_on;
    float music_pitch;     // скорость воспроизведения музыки
} R2DAudio;

// Создаёт микшер. base_path не используется напрямую — пути сюда приходят уже
// разрешёнными, — но хранится для диагностики.
bool r2d_audio_init(R2DAudio *a);
void r2d_audio_shutdown(R2DAudio *a);

// --- Загрузка ---------------------------------------------------------------
// id >= 0 либо -1. Повторный вызов с тем же путём вернёт тот же id.
int  r2d_audio_load(R2DAudio *a, const char *path);
int  r2d_audio_find(const R2DAudio *a, const char *path);
const char *r2d_audio_name(const R2DAudio *a, int id);
double r2d_audio_duration(const R2DAudio *a, int id);   // секунды, -1 если неизвестно

// --- Эффекты ----------------------------------------------------------------
// Возвращает номер канала (0..R2D_AUDIO_CHANNELS-1) либо -1.
int  r2d_audio_play(R2DAudio *a, int id, float volume, float pan, int loops);
void r2d_audio_stop_channel(R2DAudio *a, int channel, float fade_ms);
void r2d_audio_stop_all(R2DAudio *a, float fade_ms);
bool r2d_audio_channel_playing(const R2DAudio *a, int channel);
int  r2d_audio_active_channels(const R2DAudio *a);

// Громкость и панорама уже играющего канала. Нужны шинам: игра меняет
// громкость шины, и все её звуки должны отреагировать немедленно, а не
// только следующие.
void  r2d_audio_set_channel_volume(R2DAudio *a, int channel, float v);
float r2d_audio_get_channel_volume(const R2DAudio *a, int channel);
void  r2d_audio_set_channel_pan(R2DAudio *a, int channel, float pan);
float r2d_audio_get_channel_pan(const R2DAudio *a, int channel);

// Эффект на канале. kind — "none" | "lowpass" | "echo"; у lowpass значим p1
// (частота среза, Гц), у echo — p1 (задержка, мс) и p2 (доля повтора).
// Возвращает false, если эффект неизвестен или аудио не поднято.
bool r2d_audio_set_channel_effect(R2DAudio *a, int channel, const char *kind,
                                  float p1, float p2);
const char *r2d_audio_channel_effect(const R2DAudio *a, int channel);

// Список встроенных эффектов — игра показывает его в подсказке.
int         r2d_audio_effect_count(void);
const char *r2d_audio_effect_name(int index);

// Скорость воспроизведения канала: 1.0 — как записано, 2.0 — вдвое быстрее и
// на октаву выше. Это то, чего не хватало для { pitch } в $.sound.play().
void  r2d_audio_set_channel_pitch(R2DAudio *a, int channel, float ratio);
float r2d_audio_get_channel_pitch(const R2DAudio *a, int channel);
void  r2d_audio_set_music_pitch(R2DAudio *a, float ratio);
float r2d_audio_get_music_pitch(const R2DAudio *a);

// --- Реверберация помещения -------------------------------------------------
// wet — доля хвоста (0 выключает обработку), room — длина хвоста (размер
// помещения), damp — демпфирование высоких, width — стерео-ширина.
bool r2d_audio_set_room(R2DAudio *a, float wet, float room, float damp, float width);
void r2d_audio_get_room(const R2DAudio *a, float *wet, float *room, float *damp, float *width);

// --- Шины (группы микшера) --------------------------------------------------
// Группа ищется по имени и создаётся при первом обращении. Возвращает id >= 0
// либо -1 (нет аудио/мест). group_id = -1 в assign — вернуть трек в группу по
// умолчанию.
int  r2d_audio_group(R2DAudio *a, const char *name);
int  r2d_audio_group_count(const R2DAudio *a);
bool r2d_audio_group_assign(R2DAudio *a, int channel, int group_id);
bool r2d_audio_set_group_effect(R2DAudio *a, int group_id, const char *kind, float p1, float p2);
const char *r2d_audio_group_effect(const R2DAudio *a, int group_id);

// --- 3D-позиция канала ------------------------------------------------------
// Координаты — относительно слушателя (SDL_mixer держит его в (0,0,0) и не
// даёт двигать). on = false возвращает трек в обычный стерео-режим.
bool r2d_audio_set_channel_3d(R2DAudio *a, int channel, float x, float y, float z, bool on);

// --- Музыка -----------------------------------------------------------------
void r2d_audio_play_music(R2DAudio *a, int id, float volume, bool loop, float fade_ms);
void r2d_audio_stop_music(R2DAudio *a, float fade_ms);
void r2d_audio_pause_music(R2DAudio *a, bool paused);
bool r2d_audio_music_playing(const R2DAudio *a);

// --- Громкость --------------------------------------------------------------
void  r2d_audio_set_master_volume(R2DAudio *a, float v);
float r2d_audio_get_master_volume(const R2DAudio *a);
void  r2d_audio_set_sfx_volume(R2DAudio *a, float v);
float r2d_audio_get_sfx_volume(const R2DAudio *a);
void  r2d_audio_set_music_volume(R2DAudio *a, float v);
float r2d_audio_get_music_volume(const R2DAudio *a);
