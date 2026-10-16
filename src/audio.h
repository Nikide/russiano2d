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
#include "audio_fx.h"
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
// Эффект-каналов (по одному MIX_Track на канал). Было 16 — для плотной сцены
// (шаги + удары + фон + реплики) это упиралось в предел: звук вытеснялся по
// priority, а при равных приоритетах play() возвращал -1 (отчёт BASHNYA, C4).
//
// 128 выбрано по замерам (macOS, SDL3_mixer, 44.1 кГц/стерео):
//   * статическая память: sizeof(R2DAudioFx) = 80 Б, вся структура состояния
//     канала ≈ 109 Б → 16 → 128 это +12 КБ на движок, RSS процесса на старте
//     не отличается от 16 каналов (141.1–141.8 МБ во всех трёх сборках —
//     16/64/128, три прогона каждая: треки SDL_mixer внутри шума);
//   * CPU платится только за ЗВУЧАЩИЕ голоса и линейна: 4.5 % ядра при 16
//     одновременно играющих, 10.9 % при 64, 17.9 % при 128; время кадра не
//     меняется (8.21–8.27 мс) — микс идёт в аудиопотоке, не в кадре.
// Потолок остаётся честным: выше 128 — вытеснение по priority, а если
// вытеснять некого, play() возвращает -1 (см. $.sound.playing/priorityOf).
#define R2D_AUDIO_CHANNELS   128

// --- Эффекты на канале и на шине --------------------------------------------
//
// SDL_mixer 3.2 не даёт готовых DSP-эффектов: единственная точка входа в
// сэмплы — PostMix-колбэк трека или группы. Через него реализованы эффекты,
// которых хватает игре: фильтры (ФНЧ/ФВЧ), эхо, тремоло, bitcrush, кольцевая
// модуляция и реверб-шина с посылом. Сам DSP живёт в src/audio_fx.c — без
// SDL_mixer, чтобы его можно было проверить офлайн (tests/audio/fx_test.c).
//
// Обработка идёт в аудиопотоке, поэтому:
//   * буферы (линия задержки, хвост реверба) выделяются лениво при включении
//     эффекта — в потоке аллокаций нет;
//   * параметры в колбэке только читаются, меняются они из потока игры.

// Шина микшера: настоящая группа SDL_mixer. Треки одной шины микшируются
// вместе, и эффект шины (MIX_SetGroupPostMixCallback) обрабатывает уже
// готовый микс этой шины — то есть действует и на звуки, запущенные позже.
// Группы в SDL_mixer 3.2 плоские (без вложенности и без своего гейна), поэтому
// громкость/mute/solo по-прежнему считает JS, а группа отвечает за DSP.
#define R2D_AUDIO_MAX_GROUPS 8

// Музыкальные слои (stem'ы): до восьми дорожек одного transport'а. Запуск
// идёт одной командой под локом микшера, поэтому слои стартуют с одного
// sample-clock, а seek/pause применяются ко всем сразу (см. §25).
#define R2D_AUDIO_MAX_STEMS 8

// --- Бинауральная модель для 2D (этап 1 «ХРТФ в 2D») -------------------------
//
// Синтетическая модель БЕЗ HRIR-датасетов: межушная задержка (ITD, дробная —
// линейная интерполяция), межушная разница уровней (ILD), тень головы
// (однополюсный ФНЧ на дальнем ухе, срез падает с |азимутом|) и подсказка
// «сзади» (полка ВЧ). Высоты НЕТ: только азимут и дистанция (дистанцию и
// общий gain по-прежнему считает JS). Это НЕ «настоящая HRTF»: настоящая —
// Steam Audio (r2d_audio_world_channel), модель работает фолбэком там, где
// HRTF-бэкенд не поднялся. Какой backend звучит, видно в $.audio.hrtf().
//
// Выключена по умолчанию: при `on == false` обработка не вызывается вовсе, и
// PCM канала побитово равен прежнему.
#define R2D_BINAURAL_DELAY 64   // сэмплов: 0.66 мс при 48 кГц ≈ 32, с запасом

typedef struct R2DAudioBinaural {
    bool  on;
    float head;        // радиус головы, м (0.0875 — средний)
    float far_gain;    // усиление дальнего уха на 90° (0..1; 0.63 = -4 дБ)
    float rear_gain;   // полка ВЧ сзади, линейный множитель (1.585 = +4 дБ)
    float mix;         // 0 — сухой сигнал, 1 — полностью бинауральный
    int   rate;        // частота микшера (обновляется из колбэка)

    // Режим канала: 0 — выключено, 1 — полная модель, 2 — ТОЛЬКО ITD
    // (гибрид: межушную задержку добавляем поверх Steam-выхода, у которого
    // своей задержки нет — измерено, см. tests/agent/audio_hrtf_test.py).
    unsigned char mode[R2D_AUDIO_CHANNELS];
    bool  active[R2D_AUDIO_CHANNELS];
    float az[R2D_AUDIO_CHANNELS];                  // рад: 0 спереди, +pi/2 справа
    float line[R2D_AUDIO_CHANNELS][R2D_BINAURAL_DELAY];
    int   pos[R2D_AUDIO_CHANNELS];
    float lp_near[R2D_AUDIO_CHANNELS];             // ФНЧ тени: ближнее ухо
    float lp_far[R2D_AUDIO_CHANNELS];              // ФНЧ тени: дальнее ухо
    float lp_far_low[R2D_AUDIO_CHANNELS];          // НЧ-часть дальнего уха (ILD)
    float shelf[R2D_AUDIO_CHANNELS][2];            // ФНЧ полки «сзади» по ушам
} R2DAudioBinaural;

// Контекст raw-колбэка канала: сам эффект плюс владелец и номер канала, без
// которых бинауральная модель не достанет своё состояние (колбэк получает
// только userdata). У шин контекст не заводится — там owner == NULL.
typedef struct R2DChannelCb {
    R2DAudioFx      *fx;
    struct R2DAudio *owner;
    int              channel;
} R2DChannelCb;

typedef struct R2DAudioGroup {
    MIX_Group *handle;
    char       name[32];
    R2DAudioFx fx;          // эффект шины (обрабатывает буфер группы)
} R2DAudioGroup;

typedef struct R2DAudio {
    void *spatial;
    unsigned channel_generation[R2D_AUDIO_CHANNELS];
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
    // Приоритет канала: когда свободных нет, движок вытесняет САМЫЙ НЕВАЖНЫЙ
    // звук, а не всегда нулевой. Больше — важнее (0 по умолчанию).
    int   channel_priority[R2D_AUDIO_CHANNELS];

    R2DAudioGroup groups[R2D_AUDIO_MAX_GROUPS];
    int    group_count;
    // Свободные слоты групп (после destroy) переиспользуются: индексы шин
    // стабильны, а лимит из восьми групп не «выгорает» при смене шин.
    bool   group_used[R2D_AUDIO_MAX_GROUPS];

    R2DAudioFx fx[R2D_AUDIO_CHANNELS];
    R2DChannelCb chan_cb[R2D_AUDIO_CHANNELS];   // userdata raw-колбэка канала
    int    fx_freq;        // частота микшера, нужна для пересчёта мс → кадры
    int    fx_channels;    // 1 или 2, из формата микшера

    // Бинауральная модель (фолбэк без Steam Audio): по умолчанию выключена.
    R2DAudioBinaural binaural;

    // Диагностический захват итогового микса (post-mix, после реверба): нужен
    // тестам, чтобы МЕРИТЬ PCM, а не доверять коду. Играм не нужен.
    float        *capture;       // interleaved L,R
    int           capture_cap;   // сколько кадров просили
    int           capture_len;   // сколько записали
    int           capture_rate;  // частота микшера в момент захвата, Гц
    SDL_AtomicInt capture_on;

    // Реверберация помещения: одна на весь микс (MIX_SetPostMixCallback),
    // как комната — она звучит для всех источников сразу.
    R2DAudioReverb reverb;
    bool  reverb_on;
    float music_pitch;     // скорость воспроизведения музыки

    // --- Музыкальные слои (§25) ------------------------------------------
    MIX_Track *stems[R2D_AUDIO_MAX_STEMS];
    int    stem_count;
    float  stem_gain[R2D_AUDIO_MAX_STEMS];   // личная громкость слоя (crossfade)
    bool   stems_active;                     // транспорт запущен
    bool   stems_paused;
    double stems_loop_start_ms;              // точка зацикливания (0 — начало)
    double stems_loop_end_ms;                // конец петли (0 — конец файла)
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
// `priority` — насколько звук важен: при нехватке каналов вытесняется канал с
// НАИМЕНЬШИМ приоритетом, и только если новый не менее важен. Возвращает -1,
// если каналов нет и вытеснять некого (звук не проигрывается — это честнее,
// чем глушить важное).
int  r2d_audio_play(R2DAudio *a, int id, float volume, float pan, int loops,
                    int priority);
// Перемотать канал: `seconds` от начала звука.
bool   r2d_audio_seek(R2DAudio *a, int channel, double seconds);
// Текущая позиция канала в секундах (-1, если канал не играет).
double r2d_audio_position(const R2DAudio *a, int channel);
// Длительность проигрываемого на канале звука в секундах (-1, если неизвестна).
double r2d_audio_channel_duration(const R2DAudio *a, int channel);
// Приоритет, с которым канал запущен (-1, если канал не играет).
int  r2d_audio_channel_priority(const R2DAudio *a, int channel);
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
// Реверб-шина на канале: send — доля сигнала в хвост, room/damp/width — сам хвост.
bool r2d_audio_set_channel_reverb(R2DAudio *a, int channel, float send, float room,
                                  float damp, float width);
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
// Реверб-шина с посылом: у группы свой хвост, доля send её микса уходит в него.
bool r2d_audio_set_group_reverb(R2DAudio *a, int group_id, float send, float room,
                                float damp, float width);
const char *r2d_audio_group_effect(const R2DAudio *a, int group_id);
// Освобождает группу: её эффект (вместе с хвостом) снимается, слот остаётся
// свободным для следующей шины. Звуки, которые ещё в ней, надо перевести
// заранее (JS делает это в $.audio.remove).
bool r2d_audio_group_destroy(R2DAudio *a, int group_id);

// --- Музыкальные слои: один transport на все stem'ы -------------------------
// Набор слоёв задаётся загруженными sound id; каждый получает свою дорожку.
int  r2d_audio_stems_set(R2DAudio *a, const int *sound_ids, int count);
int  r2d_audio_stem_count(const R2DAudio *a);
// Создать/пересоздать слои и запустить их ОДНОЙ командой: общий sample-clock,
// общая петля, общий fade-in. Возвращает false, если слоёв нет.
bool r2d_audio_stems_start(R2DAudio *a, bool loop, float fade_ms, double start_ms,
                           double loop_start_ms, double loop_end_ms);
bool r2d_audio_stems_seek(R2DAudio *a, double seconds);
void r2d_audio_stems_pause(R2DAudio *a, bool paused);
bool r2d_audio_stems_paused(const R2DAudio *a);
bool r2d_audio_stems_playing(const R2DAudio *a);
void r2d_audio_stems_stop(R2DAudio *a, float fade_ms);
// Позиция слоя в секундах (-1, если слоя нет). Это PCM-кадры SDL_mixer,
// переведённые в секунды, — по ним и сверяется расхождение слоёв.
double r2d_audio_stem_time(const R2DAudio *a, int index);
// Позиция слоя в кадрах — целое число, без потери точности перевода.
long long r2d_audio_stem_frames(const R2DAudio *a, int index);
void  r2d_audio_stem_gain(R2DAudio *a, int index, float gain);
float r2d_audio_get_stem_gain(const R2DAudio *a, int index);
double r2d_audio_stems_loop_start(const R2DAudio *a);
// Диагностика транспорта: сколько итераций осталось у слоя и сколько кадров
// до конца файла (-1 — слоя нет).
int        r2d_audio_stem_loops(const R2DAudio *a, int index);
long long  r2d_audio_stem_remaining(const R2DAudio *a, int index);

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

// World adapter reuses mixer channels and their generation, never a second device.
bool r2d_audio_world_channel(R2DAudio *,int,bool,bool,float,float,float,float,float);

// Настоящая HRTF доступна в этой сборке и поднялась (Steam Audio).
bool r2d_audio_hrtf_available(const R2DAudio *);

// --- Бинауральная модель (фолбэк, этап 1 «ХРТФ в 2D») -----------------------
// `on=false` возвращает движок к прежнему поведению: обработка не вызывается.
void r2d_audio_binaural_set(R2DAudio *,bool on,float head,float far_gain,float rear_gain,float mix);
void r2d_audio_binaural_get(const R2DAudio *,bool *on,float *head,float *far_gain,float *rear_gain,float *mix);
// Канал: `active=false` — канал вне бинаурального режима (обычная панорама).
void r2d_audio_binaural_channel(R2DAudio *,int channel,bool active,float azimuth);
// Гибрид: ТОЛЬКО межушная задержка (дробная), без ILD/тени/полки. Нужен там,
// где backend даёт свой спектр, но своей задержки не имеет (steam).
void r2d_audio_itd_channel(R2DAudio *,int channel,bool active,float azimuth);

// --- Диагностический захват PCM (тесты) -------------------------------------
// Захват идёт с post-mix: то, что слышит игрок, вместе с шинами и ревербом.
bool r2d_audio_capture_start(R2DAudio *,int frames);
int  r2d_audio_capture_len(const R2DAudio *);
const float *r2d_audio_capture_data(const R2DAudio *);
void r2d_audio_capture_clear(R2DAudio *);
