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

#ifdef _WIN32
#include <windows.h>
#else
#include <mach-o/dyld.h>   // _NSGetExecutablePath (macOS)
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
// давало двойное освобождение кучи (ловилось AddressSanitizer).
static void parse_fail(R2dPayload *payload)
{
    payload->buffer = NULL;
    payload->buffer_size = 0;
    r2d_payload_free(payload);
}

R2dPayload *r2d_payload_parse(uint8_t *buffer, size_t size, char *err, size_t err_size)
{
    if (err && err_size) err[0] = '\0';

    Reader r = { buffer, buffer + size };
    uint32_t magic = 0, version = 0, count = 0;
    const uint8_t *entry = NULL;
    uint32_t entry_len = 0;

    if (!read_u32(&r, &magic) || magic != R2D_PAYLOAD_MAGIC) {
        if (err) SDL_snprintf(err, err_size, "груз: неверная магия");
        return NULL;
    }
    if (!read_u32(&r, &version) || version != R2D_PAYLOAD_VERSION) {
        if (err) SDL_snprintf(err, err_size, "груз: версия %u не поддерживается", version);
        return NULL;
    }
    if (!read_u32(&r, &entry_len) || entry_len == 0 || entry_len > 500) {
        if (err) SDL_snprintf(err, err_size, "груз: некорректная длина точки входа");
        return NULL;
    }
    if (!read_bytes(&r, &entry, entry_len)) {
        if (err) SDL_snprintf(err, err_size, "груз: обрезано имя точки входа");
        return NULL;
    }
    if (!read_u32(&r, &count) || count > 100000) {
        if (err) SDL_snprintf(err, err_size, "груз: некорректное число файлов");
        return NULL;
    }

    R2dPayload *payload = (R2dPayload *)SDL_calloc(1, sizeof(R2dPayload));
    if (!payload) {
        if (err) SDL_snprintf(err, err_size, "груз: нет памяти");
        return NULL;
    }
    payload->buffer = buffer;
    payload->buffer_size = size;
    payload->file_count = (int)count;
    payload->files = (R2dPayloadFile *)SDL_calloc(count ? count : 1, sizeof(R2dPayloadFile));
    if (!payload->files) {
        if (err) SDL_snprintf(err, err_size, "груз: нет памяти");
        // Таблицы ещё нет: r2d_payload_free по ней не пройдёт. Буфер не
        // трогаем — его освободит вызывающий.
        SDL_free(payload);
        return NULL;
    }

    SDL_snprintf(payload->entry, sizeof payload->entry, "%.*s", (int)entry_len, (const char *)entry);

    for (uint32_t i = 0; i < count; ++i) {
        uint32_t path_len = 0, data_len = 0;
        const uint8_t *path = NULL, *data = NULL;

        if (!read_u32(&r, &path_len) || path_len == 0 || path_len > 4000) {
            if (err) SDL_snprintf(err, err_size, "груз: файл %u — плохой путь", i);
            parse_fail(payload);
            return NULL;
        }
        if (!read_bytes(&r, &path, path_len)) goto truncated;
        if (!read_u32(&r, &data_len)) goto truncated;
        if (!read_bytes(&r, &data, data_len)) goto truncated;

        payload->files[i].path = (char *)SDL_malloc(path_len + 1);
        if (!payload->files[i].path) goto no_memory;
        memcpy(payload->files[i].path, path, path_len);
        payload->files[i].path[path_len] = '\0';
        // Данные остаются внутри буфера груза: копировать их незачем, а
        // владельцем остаётся payload.
        payload->files[i].data = (uint8_t *)data;
        payload->files[i].size = data_len;
        continue;

    truncated:
        if (err) SDL_snprintf(err, err_size, "груз: файл %u обрезан", i);
        parse_fail(payload);
        return NULL;
    no_memory:
        if (err) SDL_snprintf(err, err_size, "груз: нет памяти");
        parse_fail(payload);
        return NULL;
    }

    return payload;
}

void r2d_payload_free(R2dPayload *payload)
{
    if (!payload) return;
    for (int i = 0; i < payload->file_count; ++i) SDL_free(payload->files[i].path);
    SDL_free(payload->files);
    if (payload->buffer) {
        r2d_secure_zero(payload->buffer, payload->buffer_size);
        SDL_free(payload->buffer);
    }
    SDL_free(payload);
}

const R2dPayloadFile *r2d_payload_find(const R2dPayload *payload, const char *path)
{
    if (!payload || !path || !*path) return NULL;

    for (int i = 0; i < payload->file_count; ++i) {
        if (SDL_strcmp(payload->files[i].path, path) == 0) return &payload->files[i];
    }

    // Точное совпадение не сработало — значит пути записаны от разных корней:
    // игра просит «assets/x.png», а движок подставил каталог запуска
    // («/opt/game/assets/x.png»), или наоборот. Сверяем по хвосту пути в обе
    // стороны: тот, что короче, должен совпасть с концом длинного на границе
    // каталога.
    const size_t want = SDL_strlen(path);
    for (int i = 0; i < payload->file_count; ++i) {
        const char *candidate = payload->files[i].path;
        const size_t have = SDL_strlen(candidate);

        if (have >= want) {
            if (SDL_strcmp(candidate + (have - want), path) == 0 &&
                (have == want || candidate[have - want - 1] == '/')) {
                return &payload->files[i];
            }
        } else {
            if (SDL_strcmp(path + (want - have), candidate) == 0 &&
                (want == have || path[want - have - 1] == '/')) {
                return &payload->files[i];
            }
        }
    }
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
    R2D_LOG("груз встроен в бинарник: файлов %d, точка входа %s%s",
            payload->file_count, payload->entry, encrypted ? ", зашифрован" : "");
    return true;
}
#endif  // R2D_EMBEDDED_PAYLOAD

bool r2d_payload_attach_self(void)
{
#ifdef R2D_EMBEDDED_PAYLOAD
    if (attach_embedded()) return true;
#endif

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
        const uint8_t *nonce = footer + 24;
        const uint8_t *tag = footer + 36;
        uint8_t key[R2D_KEY_SIZE];
        unwrap_key(footer + 52, nonce, key);

        // Тег считается по магии и версии футера — ровно так же, как при
        // сборке (смещение и размер в тег не входят: они дописываются позже).
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

    R2D_LOG("груз найден в исполняемом файле: файлов %d, точка входа %s%s",
            payload->file_count, payload->entry, encrypted ? ", зашифрован" : "");
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
        // Данные груза лежат внутри его буфера — их нельзя освобождать.
        if (data >= g_payload->buffer && data < g_payload->buffer + g_payload->buffer_size) return;
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
