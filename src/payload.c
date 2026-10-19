// ===========================================================================
// Груз игры: контейнер, футер, расшифровка и виртуальная файловая система.
// Формат описан в src/payload.h.
// ===========================================================================
#include "payload.h"
#include "crypto.h"
#include "r2d.h"

#include <SDL3/SDL.h>

#include <stdlib.h>
#include <string.h>

#ifdef R2D_ENABLE_ZSTD
// Распаковка груза. Сжатие живёт только в билдере (src/build.c): движку нужен
// лишь разбор готового контейнера, поэтому тянем одну функцию библиотеки.
#include <zstd.h>
#endif

#ifdef _WIN32
#include <windows.h>
#elif defined(__APPLE__)
#include <mach-o/dyld.h>   // _NSGetExecutablePath (macOS)
#else
#include <unistd.h>        // readlink("/proc/self/exe")
#endif

// ---------------------------------------------------------------------------
// Ключ: блок из футера + постоянная соль движка
// ---------------------------------------------------------------------------

// Соль живёт в коде движка, а не рядом с ключом в файле: чтобы собрать ключ,
// нужно и то и другое. Это повышает стоимость копирования, но не делает
// извлечение невозможным — см. честную оговорку в docs/BUILD.md.
static const uint8_t R2D_KEY_SALT[R2D_KEY_SIZE] = {
    0x52, 0x75, 0x73, 0x73, 0x69, 0x61, 0x6e, 0x6f,
    0x32, 0x44, 0x20, 0x27, 0x32, 0x36, 0x20, 0x2d,
    0x9e, 0x37, 0x79, 0xb9, 0x7f, 0x4a, 0x7c, 0x15,
    0x0d, 0x1e, 0x33, 0x77, 0xa1, 0xc4, 0x5b, 0x8f,
};

static void unwrap_key(const uint8_t blob[R2D_KEY_SIZE], const uint8_t nonce[12],
                       uint8_t out[R2D_KEY_SIZE])
{
    uint8_t mask[64];
    r2d_chacha20_block(R2D_KEY_SALT, nonce, 0x9e3779b9u, mask);
    for (int i = 0; i < R2D_KEY_SIZE; ++i) out[i] = (uint8_t)(blob[i] ^ mask[i]);
    r2d_secure_zero(mask, sizeof mask);
}

void r2d_payload_wrap_key(const uint8_t key[R2D_KEY_SIZE], const uint8_t nonce[12],
                          uint8_t out_blob[R2D_KEY_SIZE])
{
    uint8_t mask[64];
    r2d_chacha20_block(R2D_KEY_SALT, nonce, 0x9e3779b9u, mask);
    for (int i = 0; i < R2D_KEY_SIZE; ++i) out_blob[i] = (uint8_t)(key[i] ^ mask[i]);
    r2d_secure_zero(mask, sizeof mask);
}

// ---------------------------------------------------------------------------
// Разбор
// ---------------------------------------------------------------------------

typedef struct Reader {
    const uint8_t *p;
    const uint8_t *end;
} Reader;

static bool read_u32(Reader *r, uint32_t *out)
{
    if ((size_t)(r->end - r->p) < 4) return false;
    *out = (uint32_t)r->p[0] | ((uint32_t)r->p[1] << 8) |
           ((uint32_t)r->p[2] << 16) | ((uint32_t)r->p[3] << 24);
    r->p += 4;
    return true;
}

static bool read_u64(Reader *r, uint64_t *out)
{
    if ((size_t)(r->end - r->p) < 8) return false;
    uint64_t v = 0;
    for (int i = 0; i < 8; ++i) v |= (uint64_t)r->p[i] << (8 * i);
    *out = v;
    r->p += 8;
    return true;
}

static bool read_bytes(Reader *r, const uint8_t **out, size_t len)
{
    if ((size_t)(r->end - r->p) < len) return false;
    *out = r->p;
    r->p += len;
    return true;
}

// Ошибка разбора: буфер контейнера остаётся собственностью вызывающего (он
// его и освобождает, см. r2d_payload_parse в payload.h). Раньше r2d_payload_free
// освобождал и его, а вызывающий освобождал повторно — на битом грузе это
// давало двойное освобождение кучи (ловилось AddressSanitizer). Распакованное
// тело (plain) создаётся внутри разбора — его освобождает сам разбор.
static void parse_fail(R2dPayload *payload)
{
    payload->buffer = NULL;
    payload->buffer_size = 0;
    payload->plain = NULL;
    payload->plain_size = 0;
    r2d_payload_free(payload);
}

// ---------------------------------------------------------------------------
// Индекс путей груза
//
// Раньше r2d_payload_find делал ДВА линейных прохода по всем файлам (точный
// путь, затем суффикс), то есть на грузе в тысячи файлов каждый запрос шрифта
// или картинки стоил O(n) strcmp. Теперь индекс строится ОДИН раз здесь, при
// разборе, и дальше поиск — открытая адресация + strcmp только для коллизий.
//
// Инвариант fallback'а сохранён: если один путь является суффиксом другого на
// границе каталога, у них ОДИН basename. Поэтому достаточно индексировать по
// basename, а внутри цепочки одинаковых basename проверить точное старое
// условие суффикса и вернуть первый по порядку файлов — ровно то, что дал бы
// второй линейный скан.
// ---------------------------------------------------------------------------

// FNV-1a 64: простой, детерминированный, без зависимостей. Качество для
// коротких ASCII-путей достаточное; коллизии всё равно разрешает strcmp.
static uint64_t index_hash64(const char *s)
{
    uint64_t h = 1469598103934665603ULL;
    while (*s) {
        h ^= (uint64_t)(unsigned char)*s++;
        h *= 1099511628211ULL;
    }
    return h;
}

static int index_pow2(size_t need)
{
    size_t cap = 8;
    while (cap < need) {
        if (cap > (size_t)INT32_MAX / 2) return 0;   // грузы такого размера не наши
        cap <<= 1;
    }
    if (cap > (size_t)INT32_MAX) return 0;
    return (int)cap;
}

// Имя файла без каталогов: хвост после последнего '/'. Контейнер хранит пути
// с прямыми слэшами; поведение совпадает со старым r2d_payload_find.
static const char *path_basename(const char *path)
{
    const char *slash = strrchr(path, '/');
    return slash ? slash + 1 : path;
}

// Ровно условие второго прохода старого r2d_payload_find: один путь совпадает
// с концом другого на границе каталога (в любую сторону).
static bool path_suffix_match(const char *candidate, const char *path)
{
    const size_t want = SDL_strlen(path);
    const size_t have = SDL_strlen(candidate);
    if (have >= want) {
        return SDL_strcmp(candidate + (have - want), path) == 0 &&
               (have == want || candidate[have - want - 1] == '/');
    }
    return SDL_strcmp(path + (want - have), candidate) == 0 &&
           (want == have || path[want - have - 1] == '/');
}

static void free_index(R2dPayload *payload)
{
    SDL_free(payload->exact_slots);
    SDL_free(payload->base_slots);
    SDL_free(payload->base_tail);
    SDL_free(payload->base_next);
    payload->exact_slots = NULL;
    payload->base_slots = NULL;
    payload->base_tail = NULL;
    payload->base_next = NULL;
    payload->exact_cap = 0;
    payload->base_cap = 0;
    payload->lookup_stats.indexed = false;
}

static void exact_index_insert(R2dPayload *payload, int file_index)
{
    const char *key = payload->files[file_index].path;
    const size_t mask = (size_t)payload->exact_cap - 1;
    size_t i = (size_t)index_hash64(key) & mask;
    for (int n = 0; n < payload->exact_cap; ++n) {
        const int v = payload->exact_slots[i];
        if (v == 0) {
            payload->exact_slots[i] = file_index + 1;
            return;
        }
        if (SDL_strcmp(payload->files[v - 1].path, key) == 0) return; // дубль пути
        payload->lookup_stats.collisions++;
        i = (i + 1) & mask;
    }
}

static void base_index_insert(R2dPayload *payload, int file_index)
{
    const char *key = path_basename(payload->files[file_index].path);
    const size_t mask = (size_t)payload->base_cap - 1;
    size_t i = (size_t)index_hash64(key) & mask;
    for (int n = 0; n < payload->base_cap; ++n) {
        const int head = payload->base_slots[i];
        if (head == 0) {
            payload->base_slots[i] = file_index + 1;
            payload->base_tail[i] = file_index + 1;
            payload->base_next[file_index] = -1;
            return;
        }
        if (SDL_strcmp(path_basename(payload->files[head - 1].path), key) == 0) {
            // Цепочка в порядке файлов: новый файл дописывается в хвост, а не
            // в голову, иначе «первый по порядку» перестал бы быть первым.
            const int tail = payload->base_tail[i] - 1;
            payload->base_next[tail] = file_index;
            payload->base_next[file_index] = -1;
            payload->base_tail[i] = file_index + 1;
            return;
        }
        payload->lookup_stats.collisions++;
        i = (i + 1) & mask;
    }
}

// Строит оба индекса. false — не хватило памяти: индекс освобождён, поиск
// продолжит работать старым линейным путём (корректность важнее скорости).
static bool build_index(R2dPayload *payload)
{
    if (payload->file_count <= 0) {
        payload->lookup_stats.indexed = true;   // пустой груз индексировать нечего
        return true;
    }
    const int cap = index_pow2((size_t)payload->file_count * 2);
    if (cap <= 0) return false;

    payload->exact_slots = (int *)SDL_calloc((size_t)cap, sizeof(int));
    payload->base_slots  = (int *)SDL_calloc((size_t)cap, sizeof(int));
    payload->base_tail   = (int *)SDL_calloc((size_t)cap, sizeof(int));
    payload->base_next   = (int *)SDL_malloc((size_t)payload->file_count * sizeof(int));
    if (!payload->exact_slots || !payload->base_slots || !payload->base_tail ||
        !payload->base_next) {
        free_index(payload);
        return false;
    }
    payload->exact_cap = cap;
    payload->base_cap = cap;

    for (int i = 0; i < payload->file_count; ++i) {
        exact_index_insert(payload, i);
        base_index_insert(payload, i);
    }
    payload->lookup_stats.indexed = true;
    return true;
}

static int exact_index_lookup(R2dPayload *payload, const char *path)
{
    if (payload->exact_cap <= 0 || !payload->exact_slots) return -1;
    const size_t mask = (size_t)payload->exact_cap - 1;
    size_t i = (size_t)index_hash64(path) & mask;
    for (int n = 0; n < payload->exact_cap; ++n) {
        const int v = payload->exact_slots[i];
        payload->lookup_stats.probes++;
        if (v == 0) return -1;
        if (SDL_strcmp(payload->files[v - 1].path, path) == 0) return v - 1;
        payload->lookup_stats.collisions++;
        i = (i + 1) & mask;
    }
    return -1;
}

// Голова цепочки файлов с тем же basename (индекс файла) либо -1.
static int base_index_lookup(R2dPayload *payload, const char *basename)
{
    if (payload->base_cap <= 0 || !payload->base_slots) return -1;
    const size_t mask = (size_t)payload->base_cap - 1;
    size_t i = (size_t)index_hash64(basename) & mask;
    for (int n = 0; n < payload->base_cap; ++n) {
        const int head = payload->base_slots[i];
        payload->lookup_stats.probes++;
        if (head == 0) return -1;
        if (SDL_strcmp(path_basename(payload->files[head - 1].path), basename) == 0) {
            return head - 1;
        }
        payload->lookup_stats.collisions++;
        i = (i + 1) & mask;
    }
    return -1;
}

// Разбор ТЕЛА контейнера: [entry_len][entry][count][файлы…]. Отдельная
// функция, потому что тело лежит либо прямо в контейнере (версия 1, без
// сжатия), либо в распакованном буфере (версия 2 с признаком zstd).
static bool parse_body(R2dPayload *payload, const uint8_t *body, size_t body_size,
                       char *err, size_t err_size)
{
    Reader r = { body, body + body_size };
    uint32_t count = 0;
    const uint8_t *entry = NULL;
    uint32_t entry_len = 0;

    if (!read_u32(&r, &entry_len) || entry_len == 0 || entry_len > 500) {
        if (err) SDL_snprintf(err, err_size, "груз: некорректная длина точки входа");
        return false;
    }
    if (!read_bytes(&r, &entry, entry_len)) {
        if (err) SDL_snprintf(err, err_size, "груз: обрезано имя точки входа");
        return false;
    }
    if (!read_u32(&r, &count) || count > 100000) {
        if (err) SDL_snprintf(err, err_size, "груз: некорректное число файлов");
        return false;
    }

    payload->file_count = (int)count;
    payload->files = (R2dPayloadFile *)SDL_calloc(count ? count : 1, sizeof(R2dPayloadFile));
    if (!payload->files) {
        // Таблицы нет: обнуляем число, иначе r2d_payload_free пошёл бы по NULL.
        payload->file_count = 0;
        if (err) SDL_snprintf(err, err_size, "груз: нет памяти");
        return false;
    }

    SDL_snprintf(payload->entry, sizeof payload->entry, "%.*s", (int)entry_len, (const char *)entry);

    for (uint32_t i = 0; i < count; ++i) {
        uint32_t path_len = 0, data_len = 0;
        const uint8_t *path = NULL, *data = NULL;

        if (!read_u32(&r, &path_len) || path_len == 0 || path_len > 4000) {
            if (err) SDL_snprintf(err, err_size, "груз: файл %u — плохой путь", i);
            return false;
        }
        if (!read_bytes(&r, &path, path_len)) goto truncated;
        if (!read_u32(&r, &data_len)) goto truncated;
        if (!read_bytes(&r, &data, data_len)) goto truncated;

        payload->files[i].path = (char *)SDL_malloc(path_len + 1);
        if (!payload->files[i].path) goto no_memory;
        memcpy(payload->files[i].path, path, path_len);
        payload->files[i].path[path_len] = '\0';
        // Данные остаются внутри буфера груза (или в распакованном теле):
        // копировать их незачем, а владельцем остаётся payload.
        payload->files[i].data = (uint8_t *)data;
        payload->files[i].size = data_len;
        continue;

    truncated:
        if (err) SDL_snprintf(err, err_size, "груз: файл %u обрезан", i);
        return false;
    no_memory:
        if (err) SDL_snprintf(err, err_size, "груз: нет памяти");
        return false;
    }

    // Индекс необязателен: при OOM поиск честно откатывается на старый
    // линейный скан (build_index сам освобождает частичные таблицы).
    (void)build_index(payload);
    return true;
}

R2dPayload *r2d_payload_parse(uint8_t *buffer, size_t size, char *err, size_t err_size)
{
    if (err && err_size) err[0] = '\0';
    if (!buffer || size < 8) {
        if (err) SDL_snprintf(err, err_size, "груз: контейнер короче заголовка (код R2D_PAYLOAD_TRUNCATED)");
        return NULL;
    }

    Reader r = { buffer, buffer + size };
    uint32_t magic = 0, version = 0;

    if (!read_u32(&r, &magic) || magic != R2D_PAYLOAD_MAGIC) {
        if (err) SDL_snprintf(err, err_size, "груз: неверная магия (код R2D_PAYLOAD_MAGIC)");
        return NULL;
    }
    if (!read_u32(&r, &version)) {
        if (err) SDL_snprintf(err, err_size, "груз: обрезанный заголовок (код R2D_PAYLOAD_TRUNCATED)");
        return NULL;
    }
    if (version != R2D_PAYLOAD_VERSION && version != R2D_PAYLOAD_VERSION_ZSTD) {
        // Старый груз читается (версия 1), новый с признаками — тоже (версия 2);
        // всё остальное отвергается ЯВНО, а не «не нашлось файлов» потом.
        if (err) SDL_snprintf(err, err_size,
                              "груз: версия контейнера %u не поддерживается, читаются 1 и %u "
                              "(код R2D_PAYLOAD_UNKNOWN_VERSION)", version, R2D_PAYLOAD_VERSION_MAX);
        return NULL;
    }

    const uint8_t *body = r.p;
    size_t body_size = (size_t)(r.end - r.p);
    uint8_t *plain = NULL;
    size_t plain_size = 0;
    double decompress_took_ms = 0.0;

    if (version == R2D_PAYLOAD_VERSION_ZSTD) {
        uint32_t flags = 0;
        if (!read_u32(&r, &flags)) {
            if (err) SDL_snprintf(err, err_size, "груз: обрезанный заголовок версии 2 (код R2D_PAYLOAD_TRUNCATED)");
            return NULL;
        }
        if (flags & ~R2D_PAYLOAD_FLAGS_KNOWN) {
            if (err) SDL_snprintf(err, err_size,
                                  "груз: неизвестные признаки контейнера 0x%X (код R2D_PAYLOAD_FLAGS)", flags);
            return NULL;
        }
        if (flags & R2D_PAYLOAD_FLAG_ZSTD) {
            uint64_t raw = 0;
            if (!read_u64(&r, &raw)) {
                if (err) SDL_snprintf(err, err_size,
                                      "груз: нет размера тела до сжатия (код R2D_PAYLOAD_TRUNCATED)");
                return NULL;
            }
#ifndef R2D_ENABLE_ZSTD
            // Сборка без zstd: не делаем вид, что груза нет, — называем причину.
            if (err) SDL_snprintf(err, err_size,
                                  "груз сжат zstd, а эта сборка собрана без поддержки zstd "
                                  "(код R2D_PAYLOAD_NO_ZSTD)");
            return NULL;
#else
            if (raw == 0 || raw > R2D_PAYLOAD_MAX_RAW || raw > (uint64_t)SIZE_MAX) {
                if (err) SDL_snprintf(err, err_size,
                                      "груз: неправдоподобный размер тела до сжатия %llu "
                                      "(код R2D_PAYLOAD_RAW_SIZE)", (unsigned long long)raw);
                return NULL;
            }
            plain = (uint8_t *)SDL_malloc((size_t)raw);
            if (!plain) {
                if (err) SDL_snprintf(err, err_size, "груз: нет памяти под распаковку");
                return NULL;
            }
            const Uint64 t0 = SDL_GetTicksNS();
            const size_t got = ZSTD_decompress(plain, (size_t)raw, r.p, (size_t)(r.end - r.p));
            const double decompress_ms = (double)(SDL_GetTicksNS() - t0) / 1e6;
            if (ZSTD_isError(got)) {
                // Повреждённый блок — это ошибка, а не «груз без файлов»: иначе
                // игра молча стартовала бы с пустым миром.
                if (err) SDL_snprintf(err, err_size, "груз: сжатый блок повреждён: %s "
                                                     "(код R2D_PAYLOAD_ZSTD_CORRUPT)",
                                      ZSTD_getErrorName(got));
                r2d_secure_zero(plain, (size_t)raw);
                SDL_free(plain);
                return NULL;
            }
            if (got != (size_t)raw) {
                if (err) SDL_snprintf(err, err_size,
                                      "груз: распаковалось %zu байт вместо %llu "
                                      "(код R2D_PAYLOAD_ZSTD_SIZE)", got, (unsigned long long)raw);
                r2d_secure_zero(plain, (size_t)raw);
                SDL_free(plain);
                return NULL;
            }
            body = plain;
            body_size = (size_t)raw;
            plain_size = (size_t)raw;
            decompress_took_ms = decompress_ms;
            // Дальше тело читается из plain, а не из контейнера.
            r.p = r.end;
#endif
        }
    }

    R2dPayload *payload = (R2dPayload *)SDL_calloc(1, sizeof(R2dPayload));
    if (!payload) {
        if (err) SDL_snprintf(err, err_size, "груз: нет памяти");
        SDL_free(plain);
        return NULL;
    }
    payload->buffer = buffer;
    payload->buffer_size = size;
    payload->plain = plain;
    payload->plain_size = plain_size;
    payload->compressed = plain != NULL;
    payload->decompress_ms = decompress_took_ms;

    if (!parse_body(payload, body, body_size, err, err_size)) {
        // Таблицы может не быть вовсе: r2d_payload_free пройдёт по ней
        // безопасно (file_count уже выставлен, files == NULL допустим).
        parse_fail(payload);
        if (plain) {
            r2d_secure_zero(plain, plain_size);
            SDL_free(plain);
        }
        return NULL;
    }

    return payload;
}

void r2d_payload_free(R2dPayload *payload)
{
    if (!payload) return;
    // Индекс ссылается на files[], поэтому освобождаем его до самих файлов.
    free_index(payload);
    for (int i = 0; i < payload->file_count; ++i) SDL_free(payload->files[i].path);
    SDL_free(payload->files);
    if (payload->buffer) {
        r2d_secure_zero(payload->buffer, payload->buffer_size);
        SDL_free(payload->buffer);
    }
    // Распакованное тело — тоже секрет: в зашифрованном грузе оно получено
    // расшифровкой. Освобождаем отдельно: файлы указывают внутрь него.
    if (payload->plain) {
        r2d_secure_zero(payload->plain, payload->plain_size);
        SDL_free(payload->plain);
    }
    SDL_free(payload);
}

void r2d_payload_lookup_stats(const R2dPayload *payload, R2dPayloadLookupStats *out)
{
    if (!out) return;
    if (!payload) {
        memset(out, 0, sizeof *out);
        return;
    }
    // Копия: счётчики меняются в const-поиске (диагностика), но наружу они
    // уходят снимком, чтобы вызывающий не держал указатель внутрь груза.
    *out = payload->lookup_stats;
}

const R2dPayloadFile *r2d_payload_find(const R2dPayload *payload, const char *path)
{
    if (!payload || !path || !*path) return NULL;

    // Счётчики — диагностика, а не состояние поиска. API исторически const,
    // поэтому снимаем const именно для них (сам груз при поиске не меняется).
    R2dPayload *mutable_payload = (R2dPayload *)(void *)payload;

    if (payload->exact_cap > 0 && payload->exact_slots) {
        const int exact = exact_index_lookup(mutable_payload, path);
        if (exact >= 0) {
            mutable_payload->lookup_stats.exact_hits++;
            return &payload->files[exact];
        }

        // Точное совпадение не сработало — значит пути записаны от разных
        // корней: игра просит «assets/x.png», а движок подставил каталог
        // запуска («/opt/game/assets/x.png»), или наоборот. Кандидаты с другим
        // basename совпасть не могут, поэтому идём только по своей цепочке;
        // внутри — то же условие суффикса и тот же порядок, что раньше.
        const char *basename = path_basename(path);
        for (int i = base_index_lookup(mutable_payload, basename); i >= 0;
             i = payload->base_next[i]) {
            if (path_suffix_match(payload->files[i].path, path)) {
                mutable_payload->lookup_stats.suffix_hits++;
                return &payload->files[i];
            }
        }
        mutable_payload->lookup_stats.misses++;
        return NULL;
    }

    // Fallback: индекс не построился (OOM). Поведение побайтово прежнее.
    mutable_payload->lookup_stats.linear_fallbacks++;
    for (int i = 0; i < payload->file_count; ++i) {
        if (SDL_strcmp(payload->files[i].path, path) == 0) {
            mutable_payload->lookup_stats.exact_hits++;
            return &payload->files[i];
        }
    }
    for (int i = 0; i < payload->file_count; ++i) {
        if (path_suffix_match(payload->files[i].path, path)) {
            mutable_payload->lookup_stats.suffix_hits++;
            return &payload->files[i];
        }
    }
    mutable_payload->lookup_stats.misses++;
    return NULL;
}

// ---------------------------------------------------------------------------
// Активный груз
// ---------------------------------------------------------------------------

static R2dPayload *g_payload = NULL;

const R2dPayload *r2d_payload_active(void) { return g_payload; }

const char *r2d_payload_entry(void)
{
    return g_payload ? g_payload->entry : "";
}

// Путь к собственному исполняемому файлу.
static bool self_path(char *out, size_t out_size)
{
#ifdef _WIN32
    const DWORD n = GetModuleFileNameA(NULL, out, (DWORD)out_size);
    return n > 0 && n < out_size;
#elif defined(__APPLE__)
    uint32_t size = (uint32_t)out_size;
    if (_NSGetExecutablePath(out, &size) != 0) return false;
    // Путь может содержать символические ссылки — приводим к настоящему.
    char resolved[4096];
    if (realpath(out, resolved)) SDL_snprintf(out, out_size, "%s", resolved);
    return true;
#else
    const ssize_t n = readlink("/proc/self/exe", out, out_size - 1);
    if (n <= 0) return false;
    out[n] = '\0';
    return true;
#endif
}

bool r2d_self_executable_path(char *out, size_t out_size)
{
    return self_path(out, out_size);
}

#ifdef R2D_EMBEDDED_PAYLOAD
// Заполняет файл, сгенерированный `russiano2d build --relink`: контейнер и
// футер уже лежат в бинарнике как массивы байт.
extern const unsigned char *r2d_embedded_payload;
extern const unsigned long  r2d_embedded_payload_size;
extern const unsigned char *r2d_embedded_footer;

static bool attach_embedded(void)
{
    const size_t size = (size_t)r2d_embedded_payload_size;
    if (size == 0 || !r2d_embedded_payload || !r2d_embedded_footer) return false;

    const uint8_t *footer = r2d_embedded_footer;

    uint8_t *container = (uint8_t *)SDL_malloc(size);
    if (!container) return false;
    memcpy(container, r2d_embedded_payload, size);

    const uint32_t flags = (uint32_t)footer[84] | ((uint32_t)footer[85] << 8) |
                           ((uint32_t)footer[86] << 16) | ((uint32_t)footer[87] << 24);
    const bool encrypted = (flags & 1u) != 0;

    if (encrypted) {
        const uint8_t *nonce = footer + 24;
        const uint8_t *tag = footer + 36;
        uint8_t key[R2D_KEY_SIZE];
        unwrap_key(footer + 52, nonce, key);

        uint8_t aad[8];
        memcpy(aad, footer, sizeof aad);

        uint8_t *plain = (uint8_t *)SDL_malloc(size);
        if (!plain) {
            r2d_secure_zero(key, sizeof key);
            SDL_free(container);
            return false;
        }
        const bool ok = r2d_aead_decrypt(key, nonce, aad, sizeof aad, container, size, plain, tag);
        r2d_secure_zero(key, sizeof key);
        r2d_secure_zero(container, size);
        SDL_free(container);
        if (!ok) {
            R2D_ERROR("груз в бинарнике: тег не сошёлся");
            return false;
        }
        container = plain;
    }

    char err[256];
    R2dPayload *payload = r2d_payload_parse(container, size, err, sizeof err);
    if (!payload) {
        R2D_ERROR("%s", err);
        SDL_free(container);
        return false;
    }
    payload->encrypted = encrypted;
    g_payload = payload;
    R2D_LOG("груз встроен в бинарник: файлов %d, точка входа %s%s%s, разбор %.1f мс",
            payload->file_count, payload->entry, encrypted ? ", зашифрован" : "",
            payload->compressed ? ", сжат zstd" : "", payload->decompress_ms);
    return true;
}
#endif  // R2D_EMBEDDED_PAYLOAD

bool r2d_payload_attach_self(void)
{
#ifdef R2D_EMBEDDED_PAYLOAD
    if (attach_embedded()) return true;
#endif

    // Отсчёт старта: чтение своего файла, расшифровка, распаковка и разбор.
    const Uint64 attach_t0 = SDL_GetTicksNS();

    char path[4096];
    if (!self_path(path, sizeof path)) {
        R2D_WARN("груз: не удалось определить путь к исполняемому файлу");
        return false;
    }

    size_t file_size = 0;
    uint8_t *bytes = (uint8_t *)SDL_LoadFile(path, &file_size);
    if (!bytes) return false;

    if (file_size < R2D_FOOTER_SIZE) {
        SDL_free(bytes);
        return false;
    }

    const uint8_t *footer = bytes + file_size - R2D_FOOTER_SIZE;
    const uint32_t magic = (uint32_t)footer[0] | ((uint32_t)footer[1] << 8) |
                           ((uint32_t)footer[2] << 16) | ((uint32_t)footer[3] << 24);
    const uint32_t magic2 = (uint32_t)footer[124] | ((uint32_t)footer[125] << 8) |
                            ((uint32_t)footer[126] << 16) | ((uint32_t)footer[127] << 24);
    if (magic != R2D_FOOTER_MAGIC || magic2 != R2D_FOOTER_MAGIC) {
        SDL_free(bytes);
        return false;   // обычная сборка движка, груза нет
    }

    uint64_t offset = 0, size = 0;
    for (int i = 0; i < 8; ++i) offset |= (uint64_t)footer[8 + i] << (8 * i);
    for (int i = 0; i < 8; ++i) size |= (uint64_t)footer[16 + i] << (8 * i);

    const uint32_t flags = (uint32_t)footer[84] | ((uint32_t)footer[85] << 8) |
                           ((uint32_t)footer[86] << 16) | ((uint32_t)footer[87] << 24);
    const bool encrypted = (flags & 1u) != 0;

    // Поля футера копируем СЕЙЧАС, пока буфер файла жив: ниже он освобождается
    // (файл целиком в памяти не нужен), а `footer` указывает внутрь него.
    // Раньше nonce/tag/ключ читались уже после SDL_free(bytes) — это
    // use-after-free: на glibc большой блок возвращается системе по munmap и
    // чтение падало SIGSEGV в r2d_chacha20_block, то есть зашифрованная
    // standalone-сборка не запускалась на Linux вовсе (§3.3, P0).
    uint8_t aad[8];
    uint8_t nonce_copy[R2D_NONCE_SIZE];
    uint8_t tag_copy[R2D_TAG_SIZE];
    uint8_t key_blob[R2D_KEY_SIZE];
    memcpy(aad, footer, sizeof aad);
    memcpy(nonce_copy, footer + 24, sizeof nonce_copy);
    memcpy(tag_copy, footer + 36, sizeof tag_copy);
    memcpy(key_blob, footer + 52, sizeof key_blob);

    // Проверяем без переполнения: offset и size приходят из футера, и их сумма
    // могла обернуться по модулю 2^64 — тогда memcpy читал бы до буфера.
    if (size == 0 || offset > file_size - R2D_FOOTER_SIZE ||
        size > file_size - R2D_FOOTER_SIZE - offset) {
        R2D_ERROR("груз: размеры в футере не сходятся с файлом");
        SDL_free(bytes);
        return false;
    }

    uint8_t *container = (uint8_t *)SDL_malloc(size);
    if (!container) {
        SDL_free(bytes);
        return false;
    }
    memcpy(container, bytes + offset, size);
    SDL_free(bytes);   // сам исполняемый файл целиком в памяти не нужен

    if (encrypted) {
        uint8_t key[R2D_KEY_SIZE];
        unwrap_key(key_blob, nonce_copy, key);

        uint8_t *plain = (uint8_t *)SDL_malloc(size);
        if (!plain) {
            r2d_secure_zero(key, sizeof key);
            SDL_free(container);
            return false;
        }
        const bool ok = r2d_aead_decrypt(key, nonce_copy, aad, sizeof aad,
                                         container, size, plain, tag_copy);
        r2d_secure_zero(key, sizeof key);
        r2d_secure_zero(container, size);
        SDL_free(container);

        if (!ok) {
            R2D_ERROR("груз: тег не сошёлся — файл повреждён или подменён");
            r2d_secure_zero(plain, size);
            SDL_free(plain);
            return false;
        }
        container = plain;
    }

    char err[256];
    R2dPayload *payload = r2d_payload_parse(container, size, err, sizeof err);
    if (!payload) {
        R2D_ERROR("%s", err);
        SDL_free(container);
        return false;
    }
    payload->encrypted = encrypted;
    g_payload = payload;

    // Замер старта: сколько заняли расшифровка, распаковка и разбор. Число
    // нужно и игре (диагностика), и приёмке сжатия: это цена, которую платит
    // запуск, в отличие от размера груза, который она уменьшает.
    const double total_ms = (double)(SDL_GetTicksNS() - attach_t0) / 1e6;
    R2D_LOG("груз найден в исполняемом файле: файлов %d, точка входа %s%s%s, "
            "разбор %.1f мс (распаковка %.1f мс)",
            payload->file_count, payload->entry, encrypted ? ", зашифрован" : "",
            payload->compressed ? ", сжат zstd" : "",
            total_ms, payload->decompress_ms);
    return true;
}

void r2d_payload_shutdown(void)
{
    r2d_payload_free(g_payload);
    g_payload = NULL;
}

// ---------------------------------------------------------------------------
// Доступ к файлам
// ---------------------------------------------------------------------------

bool r2d_vfs_has(const char *path)
{
    return r2d_payload_find(g_payload, path) != NULL;
}

uint8_t *r2d_vfs_read(const char *path, size_t *out_size)
{
    if (out_size) *out_size = 0;
    if (!path) return NULL;

    const R2dPayloadFile *entry = r2d_payload_find(g_payload, path);
    if (entry) {
        if (out_size) *out_size = entry->size;
        return entry->data;   // владелец — груз, освобождать не нужно
    }

    size_t size = 0;
    uint8_t *data = (uint8_t *)SDL_LoadFile(path, &size);
    if (!data) return NULL;
    if (out_size) *out_size = size;
    return data;
}

void r2d_vfs_free(uint8_t *data)
{
    if (!data) return;
    if (g_payload) {
        // Данные груза лежат внутри его буфера — их нельзя освобождать. У
        // сжатого груза это ДВА буфера: сам контейнер и распакованное тело,
        // внутрь которого указывают файлы.
        if (data >= g_payload->buffer && data < g_payload->buffer + g_payload->buffer_size) return;
        if (g_payload->plain &&
            data >= g_payload->plain && data < g_payload->plain + g_payload->plain_size) return;
    }
    SDL_free(data);
}

int r2d_vfs_count(void)
{
    return g_payload ? g_payload->file_count : 0;
}

const char *r2d_vfs_path_at(int index)
{
    if (!g_payload || index < 0 || index >= g_payload->file_count) return NULL;
    return g_payload->files[index].path;
}
