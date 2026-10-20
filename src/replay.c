// ===========================================================================
// Реализация записи/воспроизведения ввода (см. src/replay.h).
// ===========================================================================
#include "replay.h"

#include <SDL3/SDL.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Предел клавиш в одном кадре: больше одновременных нажатий не бывает даже
// при зажатом Shift; лишние отбрасываются (и это видно в файле по длине).
#define R2D_REPLAY_MAX_KEYS 64

// Пределы обхода проекта для content ID. Превышение — это НЕ усечённый хэш:
// content не пишется вовсе (честное «нет данных» вместо тихо неверного ID).
#define R2D_REPLAY_MAX_CONTENT_FILES 4096
#define R2D_REPLAY_MAX_CONTENT_DEPTH 16

typedef struct R2DReplayFrame {
    int      key_count;
    int      keys[R2D_REPLAY_MAX_KEYS];
    float    mouse_x, mouse_y;
    bool     mouse_valid;      // позиция мыши была задана (иначе не трогаем)
    uint32_t buttons;          // маска SDL_BUTTON_MASK
    float    wheel;
    float    mouse_dx, mouse_dy;   // относительное движение мыши (взгляд, Re2D)
} R2DReplayFrame;

typedef struct R2DReplayCheckSlot {
    R2DReplayCheckpoint checkpoint;
    bool                done;      // записан (recording) или сверен (playback)
} R2DReplayCheckSlot;

struct R2DReplay {
    bool recording;
    bool checkpoints_on;       // воспроизведение: сверять checkpoints
    FILE *out;                 // запись
    int   written;             // сколько кадров записано
    R2DReplayHeader header;

    // Воспроизведение: кадры загружены целиком — записей на 10 минут это
    // десятки килобайт, читать их по одному с диска в кадре незачем.
    R2DReplayFrame *frames;
    int             count;
    int             cursor;

    R2DReplayCheckSlot checks[R2D_REPLAY_MAX_CHECKPOINTS];
    int  check_count;
    int  checked;
    bool diverged;
};

// ---------------------------------------------------------------------------
// FNV-1a 64
// ---------------------------------------------------------------------------

#define R2D_REPLAY_FNV_BASIS 14695981039346656037ULL
#define R2D_REPLAY_FNV_PRIME 1099511628211ULL

uint64_t r2d_replay_hash_begin(void) { return R2D_REPLAY_FNV_BASIS; }

uint64_t r2d_replay_hash_bytes(uint64_t hash, const void *data, size_t size)
{
    const unsigned char *p = (const unsigned char *)data;
    for (size_t i = 0; i < size; ++i) {
        hash ^= (uint64_t)p[i];
        hash *= R2D_REPLAY_FNV_PRIME;
    }
    return hash;
}

uint64_t r2d_replay_hash_u32(uint64_t hash, uint32_t value)
{
    // Явно little-endian: на поддерживаемых платформах это те же байты, но
    // запись порядка убирает вопрос «а как оно на big-endian».
    unsigned char bytes[4] = {
        (unsigned char)(value & 0xFFu),
        (unsigned char)((value >> 8) & 0xFFu),
        (unsigned char)((value >> 16) & 0xFFu),
        (unsigned char)((value >> 24) & 0xFFu),
    };
    return r2d_replay_hash_bytes(hash, bytes, sizeof bytes);
}

uint64_t r2d_replay_hash_f32(uint64_t hash, float value)
{
    // float -> его 32-битное представление. Побитовое сравнение специально:
    // -0.0 и +0.0 дают разные байты, а NaN в игровом состоянии — уже сигнал.
    uint32_t bits = 0;
    memcpy(&bits, &value, sizeof bits);
    return r2d_replay_hash_u32(hash, bits);
}

const char *r2d_replay_hash_hex(uint64_t hash, char *buf, size_t size)
{
    static char fallback[17];
    char *out = (buf && size > 0) ? buf : fallback;
    const size_t cap = (buf && size > 0) ? size : sizeof fallback;
    SDL_snprintf(out, cap, "%016" SDL_PRIx64, hash);
    return out;
}

// ---------------------------------------------------------------------------
// Content ID: упорядоченный обход канонических файлов проекта
// ---------------------------------------------------------------------------

typedef struct ContentScan {
    char   **paths;         // относительные пути, уже отсортированные
    int      count;
    int      cap;
    bool     failed;        // ошибка/превышение предела
    const char *root;       // game_dir как передали
    size_t   root_len;
} ContentScan;

static bool content_scan_add(ContentScan *scan, const char *full)
{
    if (scan->failed) return false;
    if (scan->count >= R2D_REPLAY_MAX_CONTENT_FILES) {
        scan->failed = true;
        return false;
    }
    const char *rel = full + scan->root_len;
    while (*rel == '/' || *rel == '\\') ++rel;
    char *copy = SDL_strdup(rel);
    if (!copy) {
        scan->failed = true;
        return false;
    }
    for (char *p = copy; *p; ++p) {
        if (*p == '\\') *p = '/';
    }
    if (scan->count == scan->cap) {
        const int grown = scan->cap ? scan->cap * 2 : 32;
        char **next = (char **)SDL_realloc(scan->paths, (size_t)grown * sizeof *next);
        if (!next) {
            SDL_free(copy);
            scan->failed = true;
            return false;
        }
        scan->paths = next;
        scan->cap = grown;
    }
    scan->paths[scan->count++] = copy;
    return true;
}

static bool content_is_js(const char *name)
{
    const size_t len = SDL_strlen(name);
    return len > 3 && SDL_strcmp(name + len - 3, ".js") == 0;
}

static int SDLCALL content_path_cmp(const void *a, const void *b)
{
    return SDL_strcmp(*(const char *const *)a, *(const char *const *)b);
}

static SDL_EnumerationResult SDLCALL content_scan_cb(void *userdata, const char *dirname,
                                                     const char *fname)
{
    ContentScan *scan = (ContentScan *)userdata;
    if (scan->failed) return SDL_ENUM_CONTINUE;

    // Служебные каталоги не входят в контент игры: иначе .git/node_modules
    // раздували бы ID и делали его зависимым от машины разработчика.
    if (fname[0] == '.') return SDL_ENUM_CONTINUE;
    if (SDL_strcmp(fname, "node_modules") == 0) return SDL_ENUM_CONTINUE;

    char full[4096];
    SDL_snprintf(full, sizeof full, "%s/%s", dirname, fname);

    SDL_PathInfo info;
    if (!SDL_GetPathInfo(full, &info)) return SDL_ENUM_CONTINUE;

    const char *rel = full + scan->root_len;
    while (*rel == '/' || *rel == '\\') ++rel;

    if (info.type == SDL_PATHTYPE_DIRECTORY) {
        int depth = 0;
        for (const char *p = rel; *p; ++p) {
            if (*p == '/' || *p == '\\') ++depth;
        }
        if (depth >= R2D_REPLAY_MAX_CONTENT_DEPTH) {
            scan->failed = true;
            return SDL_ENUM_CONTINUE;
        }
        SDL_EnumerateDirectory(full, content_scan_cb, scan);
        return SDL_ENUM_CONTINUE;
    }
    if (info.type != SDL_PATHTYPE_FILE) return SDL_ENUM_CONTINUE;

    // Канонические файлы: любой *.js (код игры) и project.json в корне.
    if (!content_is_js(fname) && SDL_strcmp(rel, "project.json") != 0) {
        return SDL_ENUM_CONTINUE;
    }

    content_scan_add(scan, full);
    return SDL_ENUM_CONTINUE;
}

uint64_t r2d_replay_content_hash(const char *game_dir, uint32_t *files_out,
                                 uint64_t *bytes_out, char *err, size_t err_size)
{
    if (files_out) *files_out = 0;
    if (bytes_out) *bytes_out = 0;
    if (!game_dir || !game_dir[0]) {
        if (err && err_size) SDL_snprintf(err, err_size, "content: не задан каталог игры");
        return 0;
    }

    // Срезаем завершающие '/' у корня: префикс относительного пути считается
    // по нему, и «game//sub» не должен давать «ub/x.js» в хэше.
    char root[4096];
    SDL_strlcpy(root, game_dir, sizeof root);
    size_t root_len = SDL_strlen(root);
    while (root_len > 1 && root[root_len - 1] == '/') root[--root_len] = '\0';

    SDL_PathInfo info;
    if (!SDL_GetPathInfo(root, &info) || info.type != SDL_PATHTYPE_DIRECTORY) {
        if (err && err_size) {
            SDL_snprintf(err, err_size, "content: каталог игры не найден: %s", game_dir);
        }
        return 0;
    }

    ContentScan scan;
    memset(&scan, 0, sizeof scan);
    scan.root = root;
    scan.root_len = root_len;

    SDL_EnumerateDirectory(root, content_scan_cb, &scan);
    if (scan.failed || scan.count == 0) {
        if (err && err_size) {
            SDL_snprintf(err, err_size, "content: не удалось собрать файлы %s%s",
                         game_dir, scan.failed ? " (превышен предел обхода)" : "");
        }
        for (int i = 0; i < scan.count; ++i) SDL_free(scan.paths[i]);
        SDL_free(scan.paths);
        return 0;
    }

    SDL_qsort(scan.paths, (size_t)scan.count, sizeof scan.paths[0], content_path_cmp);

    uint64_t hash = r2d_replay_hash_begin();
    uint64_t total_bytes = 0;
    bool ok = true;

    for (int i = 0; i < scan.count; ++i) {
        char full[4096];
        SDL_snprintf(full, sizeof full, "%s/%s", root, scan.paths[i]);
        size_t size = 0;
        char *data = (char *)SDL_LoadFile(full, &size);
        if (!data) {
            if (err && err_size) SDL_snprintf(err, err_size, "content: не читается %s", full);
            ok = false;
            break;
        }

        char size_text[32];
        const int size_len = SDL_snprintf(size_text, sizeof size_text, "%llu",
                                          (unsigned long long)size);
        hash = r2d_replay_hash_bytes(hash, scan.paths[i], SDL_strlen(scan.paths[i]));
        hash = r2d_replay_hash_bytes(hash, "\n", 1);
        hash = r2d_replay_hash_bytes(hash, size_text, (size_t)size_len);
        hash = r2d_replay_hash_bytes(hash, "\n", 1);
        hash = r2d_replay_hash_bytes(hash, data, size);
        total_bytes += (uint64_t)size;
        SDL_free(data);
    }

    const int files = scan.count;
    for (int i = 0; i < scan.count; ++i) SDL_free(scan.paths[i]);
    SDL_free(scan.paths);

    if (!ok) return 0;
    if (files_out) *files_out = (uint32_t)files;
    if (bytes_out) *bytes_out = total_bytes;
    return hash;
}

// ---------------------------------------------------------------------------
// Заголовок
// ---------------------------------------------------------------------------

static void copy_text(char *dst, size_t cap, const char *src)
{
    if (!dst || cap == 0) return;
    dst[0] = '\0';
    if (src) SDL_strlcpy(dst, src, cap);
}

void r2d_replay_header_emit(R2dSb *sb, const R2DReplayHeader *header)
{
    if (!sb) return;
    if (!header) header = &(R2DReplayHeader){0};

    r2d_sb_printf(sb, "{\"r2d_replay\":%d,\"version\":", R2D_REPLAY_FORMAT);
    r2d_sb_put_json_string(sb, header->version);
    r2d_sb_puts(sb, ",\"game\":");
    r2d_sb_put_json_string(sb, header->game);
    if (header->content[0]) {
        r2d_sb_puts(sb, ",\"content\":");
        r2d_sb_put_json_string(sb, header->content);
        r2d_sb_printf(sb, ",\"content_files\":%u", (unsigned)header->content_files);
        r2d_sb_printf(sb, ",\"content_bytes\":%llu",
                      (unsigned long long)header->content_bytes);
    }
    r2d_sb_puts(sb, ",\"fixed_dt\":");
    r2d_sb_put_json_number(sb, header->fixed_dt);
    r2d_sb_printf(sb, ",\"seed\":%u}\n", (unsigned)header->seed);
}

bool r2d_replay_header_parse(const char *line, R2DReplayHeader *out,
                             char *err, size_t err_size)
{
    if (!out) return false;
    memset(out, 0, sizeof *out);
    if (!line) {
        if (err && err_size) SDL_snprintf(err, err_size, "replay: пустой заголовок");
        return false;
    }

    char parse_err[256];
    R2dJson *obj = r2d_json_parse(line, parse_err, sizeof parse_err);
    if (!obj) {
        if (err && err_size) SDL_snprintf(err, err_size, "replay: заголовок не JSON (%s)", parse_err);
        return false;
    }

    bool ok = false;
    const int format = r2d_json_int(r2d_json_get(obj, "r2d_replay"), 0);
    if (format != R2D_REPLAY_FORMAT) {
        if (err && err_size) {
            SDL_snprintf(err, err_size,
                         "replay: несовместимая версия записи (%d, нужна %d)",
                         format, R2D_REPLAY_FORMAT);
        }
    } else {
        out->format = format;
        copy_text(out->version, sizeof out->version, r2d_json_str(r2d_json_get(obj, "version"), ""));
        copy_text(out->game, sizeof out->game, r2d_json_str(r2d_json_get(obj, "game"), ""));
        const char *content = r2d_json_str(r2d_json_get(obj, "content"), "");
        copy_text(out->content, sizeof out->content, content);
        out->content_files = (uint32_t)r2d_json_num(r2d_json_get(obj, "content_files"), 0.0);
        const double bytes = r2d_json_num(r2d_json_get(obj, "content_bytes"), 0.0);
        out->content_bytes = bytes > 0.0 ? (uint64_t)bytes : 0;
        out->fixed_dt = r2d_json_num(r2d_json_get(obj, "fixed_dt"), 0.0);
        out->seed = (uint32_t)r2d_json_num(r2d_json_get(obj, "seed"), 0.0);
        ok = true;
    }

    r2d_json_free(obj);
    return ok;
}

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------

R2DReplay *r2d_replay_record(const char *path, const R2DReplayHeader *header,
                             const R2DReplayCheckpoint *checkpoints, int checkpoint_count,
                             char *err, size_t err_size)
{
    if (!path) {
        if (err && err_size) SDL_snprintf(err, err_size, "record: не задан файл записи");
        return NULL;
    }
    if (checkpoint_count < 0 || checkpoint_count > R2D_REPLAY_MAX_CHECKPOINTS) {
        if (err && err_size) SDL_snprintf(err, err_size, "record: слишком много checkpoints");
        return NULL;
    }

    FILE *out = fopen(path, "wb");
    if (!out) {
        if (err && err_size) SDL_snprintf(err, err_size, "record: не удалось открыть %s", path);
        return NULL;
    }

    R2dSb sb;
    r2d_sb_init(&sb);
    r2d_replay_header_emit(&sb, header);
    fputs(sb.data, out);
    r2d_sb_free(&sb);

    R2DReplay *r = (R2DReplay *)SDL_calloc(1, sizeof(R2DReplay));
    if (!r) {
        fclose(out);
        if (err && err_size) SDL_snprintf(err, err_size, "record: нет памяти");
        return NULL;
    }
    r->recording = true;
    r->checkpoints_on = true;
    r->out = out;
    if (header) r->header = *header;
    for (int i = 0; i < checkpoint_count; ++i) {
        r->checks[i].checkpoint = checkpoints[i];
        if (r->checks[i].checkpoint.name[0] == '\0') {
            SDL_snprintf(r->checks[i].checkpoint.name, R2D_REPLAY_NAME_MAX,
                         "frame-%d", checkpoints[i].frame);
        }
    }
    r->check_count = checkpoint_count;
    return r;
}

static void frame_write(R2DReplay *r, const R2DApp *app)
{
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
    // Относительное движение пишем только когда оно было: записи 2D-игр
    // остаются побайтово прежними, а Re2D-взгляд мышью воспроизводится.
    if (app->mouse_dx != 0.0f || app->mouse_dy != 0.0f) {
        r2d_sb_puts(&sb, ",\"dx\":");
        r2d_sb_put_json_number(&sb, app->mouse_dx);
        r2d_sb_puts(&sb, ",\"dy\":");
        r2d_sb_put_json_number(&sb, app->mouse_dy);
    }
    r2d_sb_puts(&sb, "}\n");

    fputs(sb.data, r->out);
    r2d_sb_free(&sb);
    ++r->written;
}

void r2d_replay_capture(R2DReplay *r, const R2DApp *app)
{
    if (!r || !r->recording || !r->out || !app) return;
    frame_write(r, app);
}

// ---------------------------------------------------------------------------
// Воспроизведение
// ---------------------------------------------------------------------------

static bool replay_push_frame(R2DReplay *r, const R2dJson *line)
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
    frame.mouse_dx = (float)r2d_json_num(r2d_json_get(line, "dx"), 0.0);
    frame.mouse_dy = (float)r2d_json_num(r2d_json_get(line, "dy"), 0.0);

    if (r->count % 256 == 0) {
        R2DReplayFrame *grown = (R2DReplayFrame *)SDL_realloc(
            r->frames, (size_t)(r->count + 256) * sizeof(R2DReplayFrame));
        if (!grown) return false;
        r->frames = grown;
    }
    r->frames[r->count++] = frame;
    return true;
}

static bool replay_push_checkpoint(R2DReplay *r, const R2dJson *obj, char *err, size_t err_size)
{
    if (r->check_count >= R2D_REPLAY_MAX_CHECKPOINTS) {
        if (err && err_size) {
            SDL_snprintf(err, err_size, "replay: checkpoints больше предела (%d)",
                         R2D_REPLAY_MAX_CHECKPOINTS);
        }
        return false;
    }

    R2DReplayCheckpoint cp;
    memset(&cp, 0, sizeof cp);
    cp.frame = r2d_json_int(r2d_json_get(obj, "frame"), 0);
    if (cp.frame <= 0) {
        if (err && err_size) SDL_snprintf(err, err_size, "replay: checkpoint без номера кадра");
        return false;
    }
    copy_text(cp.name, sizeof cp.name, r2d_json_str(r2d_json_get(obj, "name"), ""));
    if (cp.name[0] == '\0') SDL_snprintf(cp.name, sizeof cp.name, "frame-%d", cp.frame);

    const char *hex = r2d_json_str(r2d_json_get(obj, "hash"), "");
    if (hex[0] == '0' && (hex[1] == 'x' || hex[1] == 'X')) hex += 2;
    cp.hash = hex[0] ? SDL_strtoull(hex, NULL, 16) : 0;

    r->checks[r->check_count].checkpoint = cp;
    r->checks[r->check_count].done = false;
    ++r->check_count;
    return true;
}

R2DReplay *r2d_replay_play(const char *path, bool checkpoints, char *err, size_t err_size)
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
    r->checkpoints_on = checkpoints;

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
            // Заголовок: версия формата — обязательное поле. Необязательные
            // content/checkpoints у старых файлов просто отсутствуют.
            if (!r2d_replay_header_parse(line, &r->header, err, err_size)) {
                r2d_json_free(obj);
                ok = false;
                break;
            }
        } else {
            const R2dJson *check = r2d_json_get(obj, "check");
            if (check) {
                if (!replay_push_checkpoint(r, check, err, err_size)) {
                    r2d_json_free(obj);
                    ok = false;
                    break;
                }
            } else if (!replay_push_frame(r, obj)) {
                if (err && err_size) SDL_snprintf(err, err_size, "replay: нет памяти на кадр %d", number);
                r2d_json_free(obj);
                ok = false;
                break;
            }
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
    if (r->count == 0 && r->check_count > 0) {
        // Файл с одними checkpoints — не запись ввода: сравнивать нечего.
        if (err && err_size) SDL_snprintf(err, err_size, "replay: в файле нет кадров ввода");
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
    if (f->mouse_dx != 0.0f || f->mouse_dy != 0.0f) r2d_app_virtual_mouse_move(app, f->mouse_dx, f->mouse_dy);
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

const R2DReplayHeader *r2d_replay_header(const R2DReplay *r)
{
    return r ? &r->header : NULL;
}

bool r2d_replay_checkpoint_due(const R2DReplay *r, int frame)
{
    if (!r || frame <= 0) return false;
    if (!r->recording && !r->checkpoints_on) return false;
    for (int i = 0; i < r->check_count; ++i) {
        if (!r->checks[i].done && r->checks[i].checkpoint.frame == frame) return true;
    }
    return false;
}

static R2DReplayCheckSlot *find_checkpoint(R2DReplay *r, int frame)
{
    // Линейный поиск: checkpoints — единицы/сотни на всю запись, а не поток.
    for (int i = 0; i < r->check_count; ++i) {
        if (!r->checks[i].done && r->checks[i].checkpoint.frame == frame) {
            return &r->checks[i];
        }
    }
    return NULL;
}

R2DReplayCheckResult r2d_replay_check(R2DReplay *r, int frame, uint64_t actual,
                                      R2DReplayCheck *out)
{
    if (!r || frame <= 0) return R2D_REPLAY_CHECK_NONE;

    R2DReplayCheckSlot *slot = find_checkpoint(r, frame);
    if (!slot) return R2D_REPLAY_CHECK_NONE;

    if (r->recording) {
        if (!r->out) return R2D_REPLAY_CHECK_NONE;
        char hex[17];
        R2dSb sb;
        r2d_sb_init(&sb);
        r2d_sb_printf(&sb, "{\"check\":{\"frame\":%d,\"name\":", frame);
        r2d_sb_put_json_string(&sb, slot->checkpoint.name);
        r2d_sb_puts(&sb, ",\"hash\":\"");
        r2d_sb_puts(&sb, r2d_replay_hash_hex(actual, hex, sizeof hex));
        r2d_sb_puts(&sb, "\"}}\n");
        fputs(sb.data, r->out);
        r2d_sb_free(&sb);
        slot->done = true;
        ++r->checked;
        return R2D_REPLAY_CHECK_NONE;
    }

    if (!r->checkpoints_on) return R2D_REPLAY_CHECK_NONE;

    slot->done = true;
    ++r->checked;

    if (out) {
        memset(out, 0, sizeof *out);
        out->frame = frame;
        copy_text(out->name, sizeof out->name, slot->checkpoint.name);
        out->expected = slot->checkpoint.hash;
        out->actual = actual;
    }

    if (slot->checkpoint.hash == actual) return R2D_REPLAY_CHECK_OK;

    r->diverged = true;
    return R2D_REPLAY_CHECK_DIVERGED;
}

int r2d_replay_checkpoint_count(const R2DReplay *r) { return r ? r->check_count : 0; }

int r2d_replay_checkpoint_checked(const R2DReplay *r) { return r ? r->checked : 0; }

bool r2d_replay_diverged(const R2DReplay *r) { return r ? r->diverged : false; }

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
