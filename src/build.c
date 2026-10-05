// ===========================================================================
// Билдер игры: `russiano2d build` — собирает проект в один исполняемый файл.
//
// Что делает:
//   1. обходит граф импортов от точки входа и компилирует каждый модуль в
//      байткод QuickJS (исходников в файле не остаётся вовсе);
//   2. собирает ассеты проекта (текстуры, звук, разметку, шрифты, данные);
//   3. укладывает всё в контейнер и шифрует его ChaCha20-Poly1305;
//   4. приписывает контейнер к копии движка вместе с футером (--append) или
//      генерирует C-файл для пересборки движка с грузом внутри (--relink).
//
// Про защиту: это обфускация, а не защита. Ключ лежит в собранном файле,
// поэтому настойчивый исследователь его достанет; стоимость копирования
// растёт с «перетащил папку» до «нужен отладчик и время». Подробнее —
// docs/BUILD.md.
// ===========================================================================

#include "crypto.h"
#include "module_path.h"
#include "payload.h"
#include "r2d.h"

#include <SDL3/SDL.h>

#include <quickjs.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <io.h>
#include <sys/stat.h>
#else
#include <sys/stat.h>
#endif

#ifdef __APPLE__
#include <spawn.h>
#include <sys/wait.h>
extern char **environ;   // нужен posix_spawn: без оболочки
#endif

// Билдеру нужен тот же ключ, что и рантайму, — функция объявлена в payload.c.
void r2d_payload_wrap_key(const uint8_t key[R2D_KEY_SIZE], const uint8_t nonce[12],
                          uint8_t out_blob[R2D_KEY_SIZE]);

#define MAX_MODULES 512
#define MAX_ASSETS  20000

// ---------------------------------------------------------------------------
// Собранные данные
// ---------------------------------------------------------------------------

typedef struct PackedFile {
    char    *path;      // путь относительно корня проекта
    uint8_t *data;
    size_t   size;
} PackedFile;

typedef struct BuildState {
    const char *root;                 // корень проекта
    char        entry_dir[512];       // каталог точки входа (для имён модулей)
    PackedFile  files[MAX_MODULES + MAX_ASSETS];
    int         file_count;
    bool        failed;
} BuildState;

static void state_add(BuildState *st, const char *path, uint8_t *data, size_t size)
{
    if (st->file_count >= (int)(sizeof st->files / sizeof st->files[0])) {
        fprintf(stderr, "russiano2d build: слишком много файлов (лимит %d)\n",
                (int)(sizeof st->files / sizeof st->files[0]));
        st->failed = true;
        return;
    }
    PackedFile *f = &st->files[st->file_count++];
    f->path = SDL_strdup(path);
    f->data = data;
    f->size = size;
}

// Приводит путь к каноническому виду: убирает «./» в начале и схлопывает
// двойные слэши. Без этого SDL_EnumerateDirectory отдаёт «assets//x.png», и
// путь в грузе перестаёт совпадать с тем, что ищет игра.
static void normalize_rel(char *path)
{
    char *src = path;
    while (src[0] == '.' && src[1] == '/') src += 2;
    if (src != path) memmove(path, src, SDL_strlen(src) + 1);

    char *out = path;
    for (char *p = path; *p; ++p) {
        if (p[0] == '/' && p[1] == '/') continue;
        *out++ = *p;
    }
    *out = '\0';
    while (path[0] == '/') memmove(path, path + 1, SDL_strlen(path));
}

static bool state_has(const BuildState *st, const char *path)
{
    for (int i = 0; i < st->file_count; ++i) {
        if (SDL_strcmp(st->files[i].path, path) == 0) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Модули: обход графа импортов и компиляция в байткод
// ---------------------------------------------------------------------------

static void report_exception(JSContext *ctx, const char *module)
{
    JSValue exc = JS_GetException(ctx);
    const char *text = JS_ToCString(ctx, exc);
    fprintf(stderr, "russiano2d build: ошибка в модуле %s:\n%s\n",
            module, text ? text : "?");
    if (text) JS_FreeCString(ctx, text);
    JS_FreeValue(ctx, exc);
}

static char *build_module_normalize(JSContext *ctx, const char *base_name,
                                    const char *name, void *opaque)
{
    (void)opaque;
    if (!name || !*name) return NULL;
    char norm[4096];
    r2d_module_path(base_name, name, norm, sizeof norm);
    // Короткий алиас 'r2d' — это встроенное API движка, в груз оно не идёт.
    if (SDL_strcmp(norm, "r2d") == 0) return js_strdup(ctx, "r2d/index.js");
    return js_strdup(ctx, norm);
}

static JSModuleDef *build_module_loader(JSContext *ctx, const char *module_name, void *opaque)
{
    BuildState *st = (BuildState *)opaque;
    if (st->failed) return NULL;

    // Встроенные модули движка (высокоуровневое API $) всегда лежат в самом
    // движке: в груз их класть не нужно, но скомпилировать надо.
    if (SDL_strncmp(module_name, "r2d/", 4) == 0 || SDL_strcmp(module_name, "r2d") == 0) {
        // Их текст ищется в таблице движка; здесь достаточно пустого модуля:
        // рантайм подставит настоящий.
        JSValue stub = JS_Eval(ctx, "export default globalThis.$;", 29, module_name,
                               JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
        if (JS_IsException(stub)) {
            report_exception(ctx, module_name);
            st->failed = true;
            return NULL;
        }
        return (JSModuleDef *)JS_VALUE_GET_PTR(stub);
    }

    // Файлы читаются из каталога точки входа, а имена модулей остаются такими
    // же, какими их увидит рантайм (см. r2d_module_path в рантайме).
    char full_path[4096];
    if (st->entry_dir[0]) {
        SDL_snprintf(full_path, sizeof full_path, "%s/%s/%s", st->root, st->entry_dir, module_name);
    } else {
        SDL_snprintf(full_path, sizeof full_path, "%s/%s", st->root, module_name);
    }

    size_t source_size = 0;
    char *source = (char *)SDL_LoadFile(full_path, &source_size);
    if (!source) {
        fprintf(stderr, "russiano2d build: не удалось прочитать %s\n", full_path);
        st->failed = true;
        return NULL;
    }

    JSValue compiled = JS_Eval(ctx, source, source_size, module_name,
                               JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    SDL_free(source);

    if (JS_IsException(compiled)) {
        report_exception(ctx, module_name);
        st->failed = true;
        return NULL;
    }

    // Байткод без исходников и отладочных данных: после расшифровки читать
    // в нём нечего.
    size_t blob_size = 0;
    uint8_t *blob = JS_WriteObject(ctx, &blob_size, compiled,
                                   JS_WRITE_OBJ_BYTECODE |
                                   JS_WRITE_OBJ_STRIP_SOURCE);
    // Отладочную информацию НЕ срезаем: без неё QuickJS не знает имя модуля
    // при динамическом import() и падает с «no function filename for import()».
    // Исходный текст всё равно вырезан (STRIP_SOURCE), читать в байткоде
    // нечего — именно это и нужно было для обфускации.
    if (!blob) {
        report_exception(ctx, module_name);
        fprintf(stderr, "russiano2d build: не удалось сериализовать %s\n", module_name);
        st->failed = true;
        return NULL;
    }

    // Имя в грузе — ровно то, под которым модуль записан в байткоде: рантайм
    // разрешает импорты от точки входа «main.js», значит и здесь то же самое.
    if (!state_has(st, module_name)) {
        state_add(st, module_name, blob, blob_size);
        printf("  скрипт  %-34s %7zu байт\n", module_name, blob_size);
    } else {
        SDL_free(blob);   // ромбовидный граф импортов: второй копии не нужно
    }

    return (JSModuleDef *)JS_VALUE_GET_PTR(compiled);
}

// Догрузка модулей, до которых статический граф не дотянулся: динамический
// `import('./scene/x.js')` вычисляется в рантайме, поэтому угадать его заранее
// нельзя. Компилируем все .js каталога точки входа — лишние просто лежат в
// грузе и никому не мешают.
typedef struct ModuleScan {
    BuildState *st;
    JSContext  *ctx;
} ModuleScan;

static SDL_EnumerationResult SDLCALL module_scan_cb(void *userdata, const char *dirname,
                                                    const char *fname)
{
    ModuleScan *scan = (ModuleScan *)userdata;
    BuildState *st = scan->st;

    char full[4096];
    SDL_snprintf(full, sizeof full, "%s/%s", dirname, fname);

    SDL_PathInfo info;
    if (!SDL_GetPathInfo(full, &info)) return SDL_ENUM_CONTINUE;

    if (info.type == SDL_PATHTYPE_DIRECTORY) {
        ModuleScan child = *scan;
        SDL_EnumerateDirectory(full, module_scan_cb, &child);
        return SDL_ENUM_CONTINUE;
    }
    if (info.type != SDL_PATHTYPE_FILE) return SDL_ENUM_CONTINUE;

    const size_t len = SDL_strlen(fname);
    if (len < 4 || SDL_strcmp(fname + len - 3, ".js") != 0) return SDL_ENUM_CONTINUE;

    // Имя модуля — путь относительно каталога точки входа. SDL передаёт
    // каталог с завершающим слэшем, поэтому путь обязательно нормализуем —
    // иначе в груз попадёт «platformer//index.js», и рантайм его не найдёт.
    char name[4096];
    SDL_snprintf(name, sizeof name, "%s", full + SDL_strlen(st->root));
    normalize_rel(name);

    // Срезаем каталог точки входа: имена модулей считаются от него, иначе
    // рантайм искал бы «demos/platformer/index.js» вместо «platformer/index.js».
    if (st->entry_dir[0]) {
        const size_t entry_len = SDL_strlen(st->entry_dir);
        if (SDL_strncmp(name, st->entry_dir, entry_len) == 0 && name[entry_len] == '/') {
            memmove(name, name + entry_len + 1, SDL_strlen(name + entry_len + 1) + 1);
        }
    }

    if (state_has(st, name)) return SDL_ENUM_CONTINUE;   // уже собран по графу импортов

    build_module_loader(scan->ctx, name, st);
    return SDL_ENUM_CONTINUE;
}

static void collect_extra_modules(BuildState *st, JSContext *ctx)
{
    if (st->failed) return;
    char dir[4096];
    if (st->entry_dir[0]) SDL_snprintf(dir, sizeof dir, "%s/%s", st->root, st->entry_dir);
    else SDL_snprintf(dir, sizeof dir, "%s", st->root);

    ModuleScan scan;
    scan.st = st;
    scan.ctx = ctx;
    SDL_EnumerateDirectory(dir, module_scan_cb, &scan);
}

// ---------------------------------------------------------------------------
// Ассеты
// ---------------------------------------------------------------------------

typedef struct AssetScan {
    BuildState *st;
    const char *dir_path;    // относительный путь каталога от корня
} AssetScan;

// Считаем ассетом всё, кроме исполняемых файлов и служебных каталогов: так
// игра забирает с собой и то, о чём движок заранее не знает (данные уровней,
// таблицы, тексты).
static bool looks_like_asset(const char *name)
{
    static const char *skip[] = { ".git", "build", "build-asan", ".DS_Store", "node_modules" };
    for (size_t i = 0; i < sizeof skip / sizeof skip[0]; ++i) {
        if (SDL_strcmp(name, skip[i]) == 0) return false;
    }
    const size_t len = SDL_strlen(name);
    if (len > 3 && SDL_strcmp(name + len - 3, ".js") == 0) return false;   // скрипты уже в байткоде
    return true;
}

static SDL_EnumerationResult SDLCALL asset_scan_cb(void *userdata, const char *dirname,
                                                   const char *fname)
{
    AssetScan *scan = (AssetScan *)userdata;
    BuildState *st = scan->st;

    char full[4096];
    SDL_snprintf(full, sizeof full, "%s/%s", dirname, fname);

    SDL_PathInfo info;
    if (!SDL_GetPathInfo(full, &info)) return SDL_ENUM_CONTINUE;

    if (info.type == SDL_PATHTYPE_DIRECTORY) {
        if (!looks_like_asset(fname)) return SDL_ENUM_CONTINUE;
        AssetScan child = *scan;
        SDL_EnumerateDirectory(full, asset_scan_cb, &child);
        return SDL_ENUM_CONTINUE;
    }
    if (info.type != SDL_PATHTYPE_FILE) return SDL_ENUM_CONTINUE;
    if (!looks_like_asset(fname)) return SDL_ENUM_CONTINUE;

    // Путь файла в грузе — относительно корня проекта.
    const size_t root_len = SDL_strlen(st->root);
    char rel[4096];
    SDL_snprintf(rel, sizeof rel, "%s", full + root_len);
    normalize_rel(rel);

    if (state_has(st, rel)) return SDL_ENUM_CONTINUE;

    size_t size = 0;
    uint8_t *data = (uint8_t *)SDL_LoadFile(full, &size);
    if (!data) return SDL_ENUM_CONTINUE;
    state_add(st, rel, data, size);
    printf("  ассет   %-34s %7zu байт\n", rel, size);
    return SDL_ENUM_CONTINUE;
}

static void collect_assets(BuildState *st, const char *rel_dir)
{
    char full[4096];
    SDL_snprintf(full, sizeof full, "%s/%s", st->root, rel_dir);

    SDL_PathInfo info;
    if (!SDL_GetPathInfo(full, &info) || info.type != SDL_PATHTYPE_DIRECTORY) return;

    AssetScan scan;
    scan.st = st;
    scan.dir_path = rel_dir;
    SDL_EnumerateDirectory(full, asset_scan_cb, &scan);
}

// ---------------------------------------------------------------------------
// Контейнер
// ---------------------------------------------------------------------------

static void put_u32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24);
}

static void put_u64(uint8_t *p, uint64_t v)
{
    for (int i = 0; i < 8; ++i) p[i] = (uint8_t)(v >> (8 * i));
}

static uint8_t *build_container(const BuildState *st, const char *entry, size_t *out_size)
{
    size_t need = 12 + SDL_strlen(entry) + 4;
    for (int i = 0; i < st->file_count; ++i) {
        need += 8 + SDL_strlen(st->files[i].path) + st->files[i].size;
    }

    uint8_t *buffer = (uint8_t *)SDL_malloc(need);
    if (!buffer) return NULL;

    uint8_t *p = buffer;
    put_u32(p, R2D_PAYLOAD_MAGIC); p += 4;
    put_u32(p, R2D_PAYLOAD_VERSION); p += 4;
    put_u32(p, (uint32_t)SDL_strlen(entry)); p += 4;
    memcpy(p, entry, SDL_strlen(entry)); p += SDL_strlen(entry);
    put_u32(p, (uint32_t)st->file_count); p += 4;

    for (int i = 0; i < st->file_count; ++i) {
        const PackedFile *f = &st->files[i];
        put_u32(p, (uint32_t)SDL_strlen(f->path)); p += 4;
        memcpy(p, f->path, SDL_strlen(f->path)); p += SDL_strlen(f->path);
        put_u32(p, (uint32_t)f->size); p += 4;
        memcpy(p, f->data, f->size); p += f->size;
    }

    *out_size = (size_t)(p - buffer);
    return buffer;
}

static uint8_t *build_footer(uint64_t offset, uint64_t size, const uint8_t nonce[12],
                             const uint8_t tag[16], const uint8_t key_blob[32], bool encrypted)
{
    uint8_t *footer = (uint8_t *)SDL_calloc(1, R2D_FOOTER_SIZE);
    if (!footer) return NULL;

    put_u32(footer + 0, R2D_FOOTER_MAGIC);
    put_u32(footer + 4, R2D_PAYLOAD_VERSION);
    put_u64(footer + 8, offset);
    put_u64(footer + 16, size);
    memcpy(footer + 24, nonce, 12);
    memcpy(footer + 36, tag, 16);
    memcpy(footer + 52, key_blob, 32);
    put_u32(footer + 84, encrypted ? 1u : 0u);
    put_u32(footer + 120, R2D_FOOTER_SIZE);
    put_u32(footer + 124, R2D_FOOTER_MAGIC);
    return footer;
}

// ---------------------------------------------------------------------------
// Режимы вывода
// ---------------------------------------------------------------------------

static bool self_executable_path(char *out, size_t out_size)
{
#ifdef _WIN32
    const DWORD n = GetModuleFileNameA(NULL, out, (DWORD)out_size);
    return n > 0 && n < out_size;
#elif defined(__APPLE__)
    extern int _NSGetExecutablePath(char *buf, uint32_t *bufsize);
    uint32_t size = (uint32_t)out_size;
    return _NSGetExecutablePath(out, &size) == 0;
#else
    extern ssize_t readlink(const char *, char *, size_t);
    const ssize_t n = readlink("/proc/self/exe", out, out_size - 1);
    if (n <= 0) return false;
    out[n] = '\0';
    return true;
#endif
}

// На macOS дописанные байты ломают подпись, и система отказывается запускать
// файл. Подписываем заново ад-хок подписью — этого достаточно для локального
// запуска (для распространения нужна настоящая подпись разработчика).
static void resign_macos(const char *path)
{
#ifdef __APPLE__
    // Без system(): путь к собранному файлу приходит из --out и может
    // содержать кавычки и метасимволы оболочки, а system() выполнил бы их как
    // отдельные команды. posix_spawn передаёт аргументы напрямую.
    char *argv[] = {
        (char *)"/usr/bin/codesign", (char *)"--force", (char *)"--sign",
        (char *)"-", (char *)path, NULL,
    };
    pid_t pid = 0;
    int status = 0;
    const int spawned = posix_spawn(&pid, "/usr/bin/codesign", NULL, NULL, argv, environ);
    const bool ok = spawned == 0 && waitpid(pid, &status, 0) >= 0 &&
                    WIFEXITED(status) && WEXITSTATUS(status) == 0;
    if (ok) {
        printf("  подпись пересоздана (ад-хок), иначе macOS отказалась бы запускать файл\n");
    } else {
        printf("  ВНИМАНИЕ: переподписать не удалось — на macOS запустите вручную:\n"
               "           codesign --force --sign - '%s'\n", path);
    }
#else
    (void)path;
#endif
}

static bool write_append(const BuildState *st, const char *engine_path, const char *out_path,
                         const uint8_t *container, size_t container_size,
                         const uint8_t *footer)
{
    size_t engine_size = 0;
    uint8_t *engine = (uint8_t *)SDL_LoadFile(engine_path, &engine_size);
    if (!engine) {
        fprintf(stderr, "russiano2d build: не удалось прочитать движок %s: %s\n",
                engine_path, SDL_GetError());
        return false;
    }

    SDL_IOStream *io = SDL_IOFromFile(out_path, "wb");
    if (!io) {
        fprintf(stderr, "russiano2d build: не удалось записать %s: %s\n", out_path, SDL_GetError());
        SDL_free(engine);
        return false;
    }

    bool ok = SDL_WriteIO(io, engine, engine_size) == engine_size;
    ok = ok && SDL_WriteIO(io, container, container_size) == container_size;
    ok = ok && SDL_WriteIO(io, footer, R2D_FOOTER_SIZE) == R2D_FOOTER_SIZE;
    SDL_CloseIO(io);
    SDL_free(engine);

    if (!ok) {
        fprintf(stderr, "russiano2d build: ошибка записи в %s\n", out_path);
        return false;
    }

    // Права запуска: копия движка должна остаться исполняемой.
#ifdef _WIN32
    _chmod(out_path, _S_IREAD | _S_IWRITE);
#else
    chmod(out_path, 0755);
#endif

    resign_macos(out_path);
    return true;
}

static bool write_relink(const char *dir, const uint8_t *container, size_t container_size,
                         const uint8_t *footer)
{
    char path[4096];
    SDL_snprintf(path, sizeof path, "%s/r2d_payload_data.c", dir);

    SDL_IOStream *io = SDL_IOFromFile(path, "wb");
    if (!io) {
        fprintf(stderr, "russiano2d build: не удалось записать %s: %s\n", path, SDL_GetError());
        return false;
    }

    char header[512];
    const int header_len = SDL_snprintf(header, sizeof header,
        "// Сгенерировано `russiano2d build --relink`. Не править руками.\n"
        "// Груз игры: скрипты в байткоде + ассеты, зашифрованные ChaCha20-Poly1305.\n"
        "#include <stddef.h>\n\n"
        "static const unsigned char payload_data[] = {\n");
    SDL_WriteIO(io, header, (size_t)header_len);

    char line[64];
    for (size_t i = 0; i < container_size; ++i) {
        const int n = SDL_snprintf(line, sizeof line, "%s0x%02x,", (i % 16 == 0) ? "\n" : " ",
                                   container[i]);
        SDL_WriteIO(io, line, (size_t)n);
    }
    SDL_WriteIO(io, "\n};\n", 4);   // без завершающего нуля литерала

    // Заголовок второго массива длиннее 32 байт — пишем его напрямую, минуя
    // буфер строки (иначе он обрезался и файл не компилировался).
    const char *footer_header = "\nstatic const unsigned char payload_footer[] = {\n";
    SDL_WriteIO(io, footer_header, SDL_strlen(footer_header));
    for (size_t i = 0; i < R2D_FOOTER_SIZE; ++i) {
        const int n = SDL_snprintf(line, sizeof line, "%s0x%02x,", (i % 16 == 0) ? "\n" : " ",
                                   footer[i]);
        SDL_WriteIO(io, line, (size_t)n);
    }
    SDL_WriteIO(io, "\n};\n", 4);   // без завершающего нуля литерала

    char tail[256];
    const int tail_len = SDL_snprintf(tail, sizeof tail,
        "\nconst unsigned char *r2d_embedded_payload = payload_data;\n"
        "const unsigned long r2d_embedded_payload_size = %zuUL;\n"
        "const unsigned char *r2d_embedded_footer = payload_footer;\n",
        container_size);
    SDL_WriteIO(io, tail, (size_t)tail_len);
    SDL_CloseIO(io);

    printf("\nГотово: %s\n", path);
    printf("Пересоберите движок с грузом внутри:\n");
    printf("  cmake -S . -B build-payload -DR2D_PAYLOAD_FILE=%s\n", path);
    printf("  cmake --build build-payload -j\n");
    printf("  ./build-payload/russiano2d\n");
    return true;
}

// ---------------------------------------------------------------------------
// Точка входа
// ---------------------------------------------------------------------------

// Поиск точки входа: считаем кандидатов на один уровень вложенности.
typedef struct EntrySearch {
    int  count;
    char name[256];
} EntrySearch;

static SDL_EnumerationResult SDLCALL find_entry_cb(void *userdata, const char *dirname,
                                                   const char *fname)
{
    EntrySearch *search = (EntrySearch *)userdata;
    char probe[4096];
    SDL_snprintf(probe, sizeof probe, "%s/%s/main.js", dirname, fname);

    SDL_PathInfo info;
    if (SDL_GetPathInfo(probe, &info) && info.type == SDL_PATHTYPE_FILE) {
        search->count++;
        SDL_snprintf(search->name, sizeof search->name, "%s/main.js", fname);
    }
    return SDL_ENUM_CONTINUE;
}

static void print_usage(void)
{
    printf(
        "russiano2d build — собрать игру в один исполняемый файл\n"
        "\n"
        "  --project <папка>   корень проекта: отсюда считаются пути внутри груза\n"
        "  --entry <путь>      точка входа относительно корня (по умолчанию ищется main.js)\n"
        "  --out <файл>        куда положить собранный бинарник (режим --append)\n"
        "  --add <путь>        добавить в груз файл или каталог (можно повторять)\n"
        "  --no-assets         не добавлять ассеты, только скрипты\n"
        "  --no-encrypt        не шифровать груз (байткод всё равно нечитаем)\n"
        "  --engine <файл>     какой движок взять за основу (по умолчанию — этот же файл)\n"
        "  --relink <папка>    вместо приписывания сгенерировать C-файл для пересборки\n"
        "  --list              только показать, что попадёт в груз\n"
        "\n"
        "Примеры:\n"
        "  russiano2d build --project . --entry game/main.js --out mygame\n"
        "  russiano2d build --project demos-root --entry demos/main.js --relink build-payload\n");
}

int r2d_build_main(int argc, char **argv)
{
    const char *project = NULL;
    const char *entry = NULL;
    const char *out_path = NULL;
    const char *engine_path = NULL;
    const char *relink_dir = NULL;
    const char *adds[64];
    int add_count = 0;
    bool with_assets = true;
    bool encrypt = true;
    bool list_only = false;

    for (int i = 2; i < argc; ++i) {
        const char *a = argv[i];
        if (SDL_strcmp(a, "--project") == 0 && i + 1 < argc) project = argv[++i];
        else if (SDL_strcmp(a, "--entry") == 0 && i + 1 < argc) entry = argv[++i];
        else if (SDL_strcmp(a, "--out") == 0 && i + 1 < argc) out_path = argv[++i];
        else if (SDL_strcmp(a, "--engine") == 0 && i + 1 < argc) engine_path = argv[++i];
        else if (SDL_strcmp(a, "--relink") == 0 && i + 1 < argc) relink_dir = argv[++i];
        else if (SDL_strcmp(a, "--add") == 0 && i + 1 < argc && add_count < 64) adds[add_count++] = argv[++i];
        else if (SDL_strcmp(a, "--no-assets") == 0) with_assets = false;
        else if (SDL_strcmp(a, "--no-encrypt") == 0) encrypt = false;
        else if (SDL_strcmp(a, "--list") == 0) list_only = true;
        else if (SDL_strcmp(a, "--help") == 0 || SDL_strcmp(a, "-h") == 0) { print_usage(); return 0; }
        else {
            fprintf(stderr, "russiano2d build: неизвестная опция %s (см. --help)\n", a);
            return 2;
        }
    }

    if (!project) {
        fprintf(stderr, "russiano2d build: нужен --project <папка>\n");
        return 2;
    }
    if (!relink_dir && !out_path && !list_only) {
        fprintf(stderr, "russiano2d build: нужен --out <файл> или --relink <папка>\n");
        return 2;
    }

    // Проверка реализации шифра: молча «почти работающий» шифр хуже, чем
    // его отсутствие.
    const int crypto_rc = r2d_crypto_selftest();
    if (crypto_rc != 0) {
        fprintf(stderr, "russiano2d build: самотест шифра не прошёл (проверка %d) — сборка отменена\n",
                crypto_rc);
        return 1;
    }

    BuildState st;
    memset(&st, 0, sizeof st);
    st.root = project;

    // Точка входа: явная, иначе main.js в корне проекта, иначе единственный
    // main.js на уровень ниже (частый случай: корень репозитория + каталог игры).
    char entry_buf[512];
    if (entry) {
        SDL_snprintf(entry_buf, sizeof entry_buf, "%s", entry);
    } else {
        char candidate[4096];
        SDL_PathInfo probe;
        SDL_snprintf(candidate, sizeof candidate, "%s/main.js", project);
        if (SDL_GetPathInfo(candidate, &probe) && probe.type == SDL_PATHTYPE_FILE) {
            SDL_snprintf(entry_buf, sizeof entry_buf, "main.js");
        } else {
            EntrySearch search;
            SDL_zero(search);
            SDL_EnumerateDirectory(project, find_entry_cb, &search);
            if (search.count == 1) {
                SDL_snprintf(entry_buf, sizeof entry_buf, "%s", search.name);
            } else if (search.count == 0) {
                fprintf(stderr, "russiano2d build: в %s нет main.js — укажите --entry\n", project);
                return 2;
            } else {
                fprintf(stderr, "russiano2d build: нашлось несколько main.js — укажите --entry "
                                "(например, %s)\n", search.name);
                return 2;
            }
        }
    }

    // Каталог точки входа: из имён модулей он вырезается, потому что рантайм
    // считает имена относительно него же.
    {
        SDL_snprintf(st.entry_dir, sizeof st.entry_dir, "%s", entry_buf);
        char *slash = SDL_strrchr(st.entry_dir, '/');
        if (slash) *slash = '\0'; else st.entry_dir[0] = '\0';
    }

    printf("Проект: %s\nТочка входа: %s\n", project, entry_buf);

    char entry_full[4096];
    SDL_snprintf(entry_full, sizeof entry_full, "%s/%s", project, entry_buf);
    SDL_PathInfo entry_info;
    if (!SDL_GetPathInfo(entry_full, &entry_info)) {
        fprintf(stderr, "russiano2d build: нет файла %s\n", entry_full);
        return 1;
    }

    // --- 1. Скрипты в байткоде --------------------------------------------
    printf("\nСкрипты:\n");
    JSRuntime *rt = JS_NewRuntime();
    JSContext *ctx = JS_NewContext(rt);
    if (!rt || !ctx) {
        fprintf(stderr, "russiano2d build: не удалось создать рантайм QuickJS\n");
        return 1;
    }
    JS_SetMaxStackSize(rt, 2u * 1024u * 1024u);
    JS_SetModuleLoaderFunc(rt, build_module_normalize, build_module_loader, &st);

    // Загружаем точку входа как модуль — загрузчик рекурсивно подтянет импорты.
    // Имя модуля — только имя файла: каталог задаётся корнем поиска, иначе
    // байткод запомнил бы имена зависимостей с лишним префиксом.
    const char *entry_base = SDL_strrchr(entry_buf, '/');
    entry_base = entry_base ? entry_base + 1 : entry_buf;
    char import_line[1024];
    SDL_snprintf(import_line, sizeof import_line, "import './%s';\n", entry_base);
    JSValue entry_module = JS_Eval(ctx, import_line, SDL_strlen(import_line), "build-entry.js",
                                   JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(entry_module)) {
        report_exception(ctx, entry_buf);
        st.failed = true;
    }

    // Прогоняем связывание модулей: в этот момент и срабатывает загрузчик.
    if (!st.failed) {
        JSModuleDef *module = (JSModuleDef *)JS_VALUE_GET_PTR(entry_module);
        JSValue ns = JS_GetModuleNamespace(ctx, module);
        if (JS_IsException(ns)) report_exception(ctx, entry_buf);
        else JS_FreeValue(ctx, ns);
    }

    // Модули, которые подключаются динамически (import() по строке).
    collect_extra_modules(&st, ctx);
    if (st.failed) {
        fprintf(stderr, "russiano2d build: не удалось собрать модули динамического импорта\n");
    }

    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);

    if (st.failed || st.file_count == 0) {
        fprintf(stderr, "russiano2d build: сборка скриптов не удалась\n");
        return 1;
    }

    // --- 2. Ассеты ---------------------------------------------------------
    if (with_assets) {
        printf("\nАссеты:\n");
        collect_assets(&st, "assets");
        // Каталог точки входа: там лежат ui/*.rml, data/*.json и подобное.
        char entry_dir[512];
        SDL_snprintf(entry_dir, sizeof entry_dir, "%s", entry_buf);
        char *slash = SDL_strrchr(entry_dir, '/');
        if (slash) *slash = '\0'; else entry_dir[0] = '\0';
        if (entry_dir[0]) collect_assets(&st, entry_dir);
        for (int i = 0; i < add_count; ++i) collect_assets(&st, adds[i]);
    }

    // Манифест проекта кладём всегда, даже с --no-assets: именно из него
    // собранная игра берёт имя окна. Ищем его рядом с точкой входа и в корне.
    {
        char dir[512] = { 0 };
        SDL_snprintf(dir, sizeof dir, "%s", entry_buf);
        char *slash = SDL_strrchr(dir, '/');
        if (slash) *slash = '\0'; else dir[0] = '\0';

        char beside[1024];
        if (dir[0]) SDL_snprintf(beside, sizeof beside, "%s/project.json", dir);
        else SDL_snprintf(beside, sizeof beside, "project.json");

        const char *candidates[2] = { beside, "project.json" };
        for (int i = 0; i < 2; ++i) {
            if (state_has(&st, candidates[i])) continue;
            char full[4096];
            SDL_snprintf(full, sizeof full, "%s/%s", project, candidates[i]);
            size_t size = 0;
            uint8_t *data = (uint8_t *)SDL_LoadFile(full, &size);
            if (!data) continue;
            state_add(&st, candidates[i], data, size);
            printf("  ассет   %-34s %7zu байт (манифест проекта)\n", candidates[i], size);
        }
    }

    size_t scripts = 0, assets = 0;
    for (int i = 0; i < st.file_count; ++i) {
        const size_t len = SDL_strlen(st.files[i].path);
        if (len > 3 && SDL_strcmp(st.files[i].path + len - 3, ".js") == 0) scripts += st.files[i].size;
        else assets += st.files[i].size;
    }

    // --- 3. Контейнер и шифрование ----------------------------------------
    size_t container_size = 0;
    uint8_t *container = build_container(&st, entry_buf, &container_size);
    if (!container) {
        fprintf(stderr, "russiano2d build: нет памяти под контейнер\n");
        return 1;
    }

    uint8_t nonce[R2D_NONCE_SIZE] = { 0 };
    uint8_t tag[R2D_TAG_SIZE] = { 0 };
    uint8_t key_blob[R2D_KEY_SIZE] = { 0 };
    uint8_t *footer = NULL;

    if (encrypt) {
        uint8_t key[R2D_KEY_SIZE];
        if (!r2d_random_bytes(key, sizeof key) || !r2d_random_bytes(nonce, sizeof nonce)) {
            fprintf(stderr, "russiano2d build: нет источника случайных байтов — шифрование отменено\n");
            SDL_free(container);
            return 1;
        }
        r2d_payload_wrap_key(key, nonce, key_blob);

        uint8_t *cipher = (uint8_t *)SDL_malloc(container_size);
        if (!cipher) {
            r2d_secure_zero(key, sizeof key);
            SDL_free(container);
            return 1;
        }
        // Дополнительные данные для тега: магия и версия футера. Именно они,
        // а не смещение с размером: смещение дописывается уже после
        // шифрования, и тег от него разошёлся бы.
        uint8_t aad[8];
        put_u32(aad + 0, R2D_FOOTER_MAGIC);
        put_u32(aad + 4, R2D_PAYLOAD_VERSION);

        r2d_aead_encrypt(key, nonce, aad, sizeof aad, container, container_size, cipher, tag);
        r2d_secure_zero(key, sizeof key);
        r2d_secure_zero(container, container_size);
        SDL_free(container);
        container = cipher;
    }

    footer = build_footer(0, container_size, nonce, tag, key_blob, encrypt);
    if (!footer) {
        SDL_free(container);
        return 1;
    }

    printf("\nИтого: скриптов %zu байт, ассетов %zu байт, контейнер %zu байт, файлов %d\n",
           scripts, assets, container_size, st.file_count);
    printf("Шифрование: %s\n", encrypt ? "ChaCha20-Poly1305 (RFC 8439)" : "выключено");

    if (list_only) {
        printf("\n--list: файлы не записаны\n");
        SDL_free(footer);
        SDL_free(container);
        return 0;
    }

    // --- 4. Вывод ----------------------------------------------------------
    bool ok = true;
    if (relink_dir) {
        SDL_CreateDirectory(relink_dir);
        ok = write_relink(relink_dir, container, container_size, footer);
    } else {
        char self[4096];
        if (!engine_path) {
            if (!self_executable_path(self, sizeof self)) {
                fprintf(stderr, "russiano2d build: не удалось определить путь к движку — укажите --engine\n");
                SDL_free(footer);
                SDL_free(container);
                return 1;
            }
            engine_path = self;
        }
        printf("\nСобираю %s из %s\n", out_path, engine_path);
        // В футере смещение считается от начала файла: узнаём размер движка.
        size_t engine_size = 0;
        uint8_t *probe = (uint8_t *)SDL_LoadFile(engine_path, &engine_size);
        if (!probe) {
            fprintf(stderr, "russiano2d build: не удалось прочитать %s\n", engine_path);
            SDL_free(footer);
            SDL_free(container);
            return 1;
        }
        SDL_free(probe);
        put_u64(footer + 8, (uint64_t)engine_size);
        ok = write_append(&st, engine_path, out_path, container, container_size, footer);
        if (ok) {
            SDL_PathInfo info;
            if (SDL_GetPathInfo(out_path, &info)) {
                printf("\nГотово: %s (%.1f МБ)\nЗапуск: ./%s\n",
                       out_path, (double)info.size / (1024.0 * 1024.0), out_path);
            }
        }
    }

    SDL_free(footer);
    r2d_secure_zero(container, container_size);
    SDL_free(container);
    for (int i = 0; i < st.file_count; ++i) {
        SDL_free(st.files[i].path);
        SDL_free(st.files[i].data);
    }
    return ok ? 0 : 1;
}
