// ===========================================================================
// Реализация записи/воспроизведения ввода (см. src/replay.h).
// ===========================================================================
#include "replay.h"

#include "json.h"

#include <SDL3/SDL.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Предел клавиш в одном кадре: больше одновременных нажатий не бывает даже
// при зажатом Shift; лишние отбрасываются (и это видно в файле по длине).
#define R2D_REPLAY_MAX_KEYS 64

typedef struct R2DReplayFrame {
    int      key_count;
    int      keys[R2D_REPLAY_MAX_KEYS];
    float    mouse_x, mouse_y;
    bool     mouse_valid;      // позиция мыши была задана (иначе не трогаем)
    uint32_t buttons;          // маска SDL_BUTTON_MASK
    float    wheel;
} R2DReplayFrame;

struct R2DReplay {
    bool recording;
    FILE *out;                 // запись
    int   written;             // сколько кадров записано

    // Воспроизведение: кадры загружены целиком — записей на 10 минут это
    // десятки килобайт, читать их по одному с диска в кадре незачем.
    R2DReplayFrame *frames;
    int             count;
    int             cursor;
};

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------

R2DReplay *r2d_replay_record(const char *path, const char *version, const char *game,
                             const R2DApp *app, uint32_t seed, char *err, size_t err_size)
{
    if (!path) {
        if (err && err_size) SDL_snprintf(err, err_size, "record: не задан файл записи");
        return NULL;
    }

    FILE *out = fopen(path, "wb");
    if (!out) {
        if (err && err_size) SDL_snprintf(err, err_size, "record: не удалось открыть %s", path);
        return NULL;
    }

    R2dSb sb;
    r2d_sb_init(&sb);
    r2d_sb_printf(&sb, "{\"r2d_replay\":%d,\"version\":", R2D_REPLAY_FORMAT);
    r2d_sb_put_json_string(&sb, version ? version : "");
    r2d_sb_puts(&sb, ",\"game\":");
    r2d_sb_put_json_string(&sb, game ? game : "");
    r2d_sb_puts(&sb, ",\"fixed_dt\":");
    r2d_sb_put_json_number(&sb, app ? (double)app->fixed_dt : 0.0);
    r2d_sb_puts(&sb, ",\"seed\":");
    r2d_sb_put_json_number(&sb, (double)seed);
    r2d_sb_puts(&sb, "}\n");
    fputs(sb.data, out);
    r2d_sb_free(&sb);

    R2DReplay *r = (R2DReplay *)SDL_calloc(1, sizeof(R2DReplay));
    if (!r) {
        fclose(out);
        if (err && err_size) SDL_snprintf(err, err_size, "record: нет памяти");
        return NULL;
    }
    r->recording = true;
    r->out = out;
    return r;
}

void r2d_replay_capture(R2DReplay *r, const R2DApp *app)
{
    if (!r || !r->recording || !r->out || !app) return;

    R2dSb sb;
    r2d_sb_init(&sb);
    r2d_sb_printf(&sb, "{\"f\":%d,\"keys\":[", r->written);

    int keys = 0;
    for (int sc = 0; sc < SDL_SCANCODE_COUNT; ++sc) {
        if (!app->keys_cur[sc]) continue;
        if (keys >= R2D_REPLAY_MAX_KEYS) break;
        if (keys > 0) r2d_sb_putc(&sb, ',');
        r2d_sb_printf(&sb, "%d", sc);
        ++keys;
    }

    r2d_sb_puts(&sb, "],\"mx\":");
    r2d_sb_put_json_number(&sb, app->mouse_x);
    r2d_sb_puts(&sb, ",\"my\":");
    r2d_sb_put_json_number(&sb, app->mouse_y);
    r2d_sb_puts(&sb, ",\"mb\":");
    r2d_sb_printf(&sb, "%u", (unsigned)app->mouse_cur);
    r2d_sb_puts(&sb, ",\"wheel\":");
    r2d_sb_put_json_number(&sb, app->wheel_y);
    r2d_sb_puts(&sb, "}\n");

    fputs(sb.data, r->out);
    r2d_sb_free(&sb);
    ++r->written;
}

// ---------------------------------------------------------------------------
// Воспроизведение
// ---------------------------------------------------------------------------

static bool r2d__replay_push(R2DReplay *r, const R2dJson *line)
{
    R2DReplayFrame frame;
    memset(&frame, 0, sizeof frame);

    const R2dJson *keys = r2d_json_get(line, "keys");
    const int key_count = r2d_json_size(keys);
    for (int i = 0; i < key_count && frame.key_count < R2D_REPLAY_MAX_KEYS; ++i) {
        frame.keys[frame.key_count++] = r2d_json_int(r2d_json_at(keys, i), -1);
    }

    frame.mouse_x = (float)r2d_json_num(r2d_json_get(line, "mx"), 0.0);
    frame.mouse_y = (float)r2d_json_num(r2d_json_get(line, "my"), 0.0);
    frame.mouse_valid = true;
    frame.buttons = (uint32_t)r2d_json_num(r2d_json_get(line, "mb"), 0.0);
    frame.wheel = (float)r2d_json_num(r2d_json_get(line, "wheel"), 0.0);

    if (r->count % 256 == 0) {
        R2DReplayFrame *grown = (R2DReplayFrame *)SDL_realloc(
            r->frames, (size_t)(r->count + 256) * sizeof(R2DReplayFrame));
        if (!grown) return false;
        r->frames = grown;
    }
    r->frames[r->count++] = frame;
    return true;
}

R2DReplay *r2d_replay_play(const char *path, char *err, size_t err_size)
{
    if (!path) {
        if (err && err_size) SDL_snprintf(err, err_size, "replay: не задан файл записи");
        return NULL;
    }

    FILE *in = fopen(path, "rb");
    if (!in) {
        if (err && err_size) SDL_snprintf(err, err_size, "replay: не удалось открыть %s", path);
        return NULL;
    }

    R2DReplay *r = (R2DReplay *)SDL_calloc(1, sizeof(R2DReplay));
    if (!r) {
        fclose(in);
        if (err && err_size) SDL_snprintf(err, err_size, "replay: нет памяти");
        return NULL;
    }

    char line[8192];
    char parse_err[256];
    int number = 0;
    bool ok = true;

    while (fgets(line, (int)sizeof line, in)) {
        if (line[0] == '\n' || line[0] == '\r' || line[0] == '\0') continue;
        R2dJson *obj = r2d_json_parse(line, parse_err, sizeof parse_err);
        if (!obj) {
            if (err && err_size) SDL_snprintf(err, err_size, "replay: строка %d не JSON (%s)", number + 1, parse_err);
            ok = false;
            break;
        }

        if (number == 0) {
            // Заголовок: версия формата — обязательное поле. Файл без неё или с
            // чужой версией отвергаем целиком, а не «дочитаем как сможем».
            const int format = r2d_json_int(r2d_json_get(obj, "r2d_replay"), 0);
            if (format != R2D_REPLAY_FORMAT) {
                if (err && err_size) {
                    SDL_snprintf(err, err_size,
                                 "replay: несовместимая версия записи (%d, нужна %d)",
                                 format, R2D_REPLAY_FORMAT);
                }
                r2d_json_free(obj);
                ok = false;
                break;
            }
        } else if (!r2d__replay_push(r, obj)) {
            if (err && err_size) SDL_snprintf(err, err_size, "replay: нет памяти на кадр %d", number);
            r2d_json_free(obj);
            ok = false;
            break;
        }

        r2d_json_free(obj);
        ++number;
    }

    fclose(in);

    if (!ok || number == 0) {
        if (ok && err && err_size) SDL_snprintf(err, err_size, "replay: в файле только заголовок");
        r2d_replay_destroy(r);
        return NULL;
    }
    return r;
}

void r2d_replay_apply(R2DReplay *r, R2DApp *app)
{
    if (!r || r->recording || !app) return;
    if (r->cursor >= r->count) return;   // запись кончилась: ввод больше не подменяем

    const R2DReplayFrame *f = &r->frames[r->cursor++];

    // Сначала снимаем прошлый кадр целиком: удерживаемые клавиши не должны
    // «протекать» из кадра в кадр, иначе реплей разойдётся с записью.
    r2d_app_virtual_release_all(app);
    for (int i = 0; i < f->key_count; ++i) {
        if (f->keys[i] >= 0 && f->keys[i] < SDL_SCANCODE_COUNT) {
            r2d_app_virtual_key(app, (SDL_Scancode)f->keys[i], true);
        }
    }

    r2d_app_virtual_mouse_pos(app, f->mouse_x, f->mouse_y);
    for (int button = SDL_BUTTON_LEFT; button <= SDL_BUTTON_X2; ++button) {
        r2d_app_virtual_mouse(app, button, (f->buttons & SDL_BUTTON_MASK(button)) != 0);
    }
    if (f->wheel != 0.0f) r2d_app_virtual_wheel(app, f->wheel);
}

// ---------------------------------------------------------------------------
// Состояние
// ---------------------------------------------------------------------------

bool r2d_replay_recording(const R2DReplay *r) { return r && r->recording; }

bool r2d_replay_playing(const R2DReplay *r) { return r && !r->recording; }

int r2d_replay_frames(const R2DReplay *r)
{
    if (!r) return 0;
    return r->recording ? r->written : r->count;
}

bool r2d_replay_finished(const R2DReplay *r)
{
    if (!r || r->recording) return false;
    return r->cursor >= r->count;
}

void r2d_replay_destroy(R2DReplay *r)
{
    if (!r) return;
    if (r->out) fclose(r->out);
    SDL_free(r->frames);
    SDL_free(r);
}
