// ===========================================================================
// Запись и воспроизведение ввода: `--record <файл>` и `--replay <файл>`.
//
// Зачем: игровой баг должен быть воспроизводим. Реплей записывает ВВОД кадра
// (клавиши, мышь, колесо), который фактически увидела игра, и на втором
// прогоне подставляет его обратно. Мир не сериализуется — при том же зерне
// (`--seed`) и том же шаге (`--fixed-dt`) симуляция обязана прийти туда же
// (docs/RECORD_REPLAY.md).
//
// Формат — JSON-строки (по строке на кадр), первая строка — версионированный
// заголовок. Файл с другой версией отвергается явно, а не читается «как
// получится».
//
// Заголовок несёт идентичность записи: версию движка, каталог игры, шаг,
// зерно и content ID — FNV-1a 64 от канонических файлов проекта (см.
// r2d_replay_content_hash). Поля content* необязательны: старые файлы без них
// читаются как «content не записан», а не отвергаются.
//
// Checkpoints — отдельные строки `{"check":{"frame":N,"name":"...","hash":"..."}}`
// в том же потоке. Hash считает НАТИВНОЕ состояние, которым владеет C:
// номер кадра и трансформы/скорости живых физических тел (main.c собирает
// значения, replay.c хэширует и сравнивает). JS-состояние узлов сюда не
// входит: его хэширует игровой $.replay v2. Это честное ограничение, а не
// забывчивость — C не видит JS-мир.
//
// Что НЕ записывается: касания и геймпады (у них своя модель состояния), текст
// IME и содержимое окон. Это честное ограничение первой версии.
// ===========================================================================
#pragma once

#include "app.h"
#include "json.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Версия формата записи. Меняется, только если старые файлы перестают
// читаться; заголовок всегда её несёт. Дополнительные НЕОБЯЗАТЕЛЬНЫЕ поля
// (content, checkpoints) версию не поднимают: старые файлы остаются валидными,
// новые читаются старым кодом как «полей нет».
#define R2D_REPLAY_FORMAT 1

// Сколько checkpoints принимаем в одной записи. Предел не «на всякий случай»:
// больше — это уже не отладочная запись, а профиль сэмплирования, и его место
// в $.replay v2 с ограничением MAX_CHECKPOINTS.
#define R2D_REPLAY_MAX_CHECKPOINTS 256

// Длина имени checkpoint (включая завершающий NUL).
#define R2D_REPLAY_NAME_MAX 64

typedef struct R2DReplayHeader {
    int      format;                    // R2D_REPLAY_FORMAT
    char     version[64];               // версия движка (R2D_VERSION_STRING)
    char     game[512];                 // каталог игры, как его передали в --game
    char     content[96];               // content ID или "" (старый файл/нет данных)
    uint32_t content_files;             // сколько файлов вошло в content ID
    uint64_t content_bytes;             // сколько байт вошло в content ID
    double   fixed_dt;                  // --fixed-dt (0 — реальное время)
    uint32_t seed;                      // --seed
} R2DReplayHeader;

typedef struct R2DReplayCheckpoint {
    int      frame;                     // engine.frame: 1 — первый кадр
    char     name[R2D_REPLAY_NAME_MAX]; // "after_boss" / "frame-120"
    uint64_t hash;                      // нативное состояние (заполняется при записи)
} R2DReplayCheckpoint;

typedef enum R2DReplayCheckResult {
    R2D_REPLAY_CHECK_NONE = 0,      // checkpoint на этом кадре не назначен
    R2D_REPLAY_CHECK_OK = 1,        // проверен и совпал
    R2D_REPLAY_CHECK_DIVERGED = 2,  // проверен и РАЗОШЁЛСЯ
} R2DReplayCheckResult;

typedef struct R2DReplayCheck {
    int      frame;
    char     name[R2D_REPLAY_NAME_MAX];
    uint64_t expected;
    uint64_t actual;
} R2DReplayCheck;

typedef struct R2DReplay R2DReplay;

// Начать запись в файл. Заголовок пишется сразу. checkpoints/count — какие
// кадры пометить checkpoints при записи (может быть NULL/0). NULL — не
// удалось открыть файл (err заполнен).
R2DReplay *r2d_replay_record(const char *path, const R2DReplayHeader *header,
                             const R2DReplayCheckpoint *checkpoints, int checkpoint_count,
                             char *err, size_t err_size);

// Открыть запись для воспроизведения. checkpoints == false — checkpoints
// читаются, но не сверяются (--checkpoints off). NULL — файл не читается или
// у него другая версия формата (err заполнен).
R2DReplay *r2d_replay_play(const char *path, bool checkpoints, char *err, size_t err_size);

// Заголовок открытой записи (NULL для NULL/записи).
const R2DReplayHeader *r2d_replay_header(const R2DReplay *r);

// Перед началом кадра: подставить записанный ввод кадра (виртуальный ввод).
void r2d_replay_apply(R2DReplay *r, R2DApp *app);

// После начала кадра (когда ввод уже наложен): записать фактический ввод.
void r2d_replay_capture(R2DReplay *r, const R2DApp *app);

bool r2d_replay_recording(const R2DReplay *r);
bool r2d_replay_playing(const R2DReplay *r);

// Сколько кадров записано / сколько есть в открытой записи.
int  r2d_replay_frames(const R2DReplay *r);

// Воспроизведение дошло до конца записи.
bool r2d_replay_finished(const R2DReplay *r);

// Назначен ли checkpoint на этом кадре (и ещё не обработан). В recording —
// по списку из r2d_replay_record, в playback — по строкам из файла и только
// при включённой сверке. main.c зовёт это, чтобы не считать нативный hash
// каждый кадр впустую.
bool r2d_replay_checkpoint_due(const R2DReplay *r, int frame);

// После кадра: при записи — дописать checkpoint с фактическим hash, при
// воспроизведении — сверить. out заполняется для DIVERGED и OK. В recording
// возвращает NONE: сравнивать не с чем, hash просто записан.
R2DReplayCheckResult r2d_replay_check(R2DReplay *r, int frame, uint64_t actual,
                                      R2DReplayCheck *out);

// Сколько checkpoints в записи и сколько уже проверено/записано.
int  r2d_replay_checkpoint_count(const R2DReplay *r);
int  r2d_replay_checkpoint_checked(const R2DReplay *r);

// Было ли расхождение хотя бы раз (для кода возврата процесса).
bool r2d_replay_diverged(const R2DReplay *r);

void r2d_replay_destroy(R2DReplay *r);

// ---------------------------------------------------------------------------
// Хэши и заголовок — отдельными функциями, чтобы их можно было проверить
// Unity-тестом без окна, GPU и симуляции (tests/replay/replay_checkpoint_test.c).
// ---------------------------------------------------------------------------

// FNV-1a 64: begin() — базовое смещение, bytes/u32/f32 — продолжение.
uint64_t r2d_replay_hash_begin(void);
uint64_t r2d_replay_hash_bytes(uint64_t hash, const void *data, size_t size);
uint64_t r2d_replay_hash_u32(uint64_t hash, uint32_t value);
uint64_t r2d_replay_hash_f32(uint64_t hash, float value);

// Content ID игры: FNV-1a 64 по УПОРЯДОЧЕННОМУ списку канонических файлов.
// Хэшируется: корневой project.json, корневой main.js и каждый *.js рекурсивно
// (относительный путь с '/' + '\n' + размер в десятичном виде + '\n' + байты).
// Возвращает 0, если каталог недоступен/превышены пределы — тогда content в
// заголовок не пишется (err заполнен). files/bytes_out — сколько вошло.
uint64_t r2d_replay_content_hash(const char *game_dir, uint32_t *files_out,
                                 uint64_t *bytes_out, char *err, size_t err_size);

// Записать/разобрать строку заголовка. parse отвергает чужую версию формата;
// отсутствующие необязательные поля — это НЕ ошибка (старые файлы).
void r2d_replay_header_emit(R2dSb *sb, const R2DReplayHeader *header);
bool r2d_replay_header_parse(const char *line, R2DReplayHeader *out,
                             char *err, size_t err_size);

// Формат "fnv1a64:<16 hex>" / "ffffffffffffffff" в buf (>= 17 байт).
const char *r2d_replay_hash_hex(uint64_t hash, char *buf, size_t size);

#ifdef __cplusplus
}
#endif
