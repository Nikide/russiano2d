// ===========================================================================
// Тесты графа зависимостей ассетов (sdk/native/sdk_deps.c).
//
// Проверяется то, ради чего граф существует: запись состояния, «всё
// актуально» без пересборки, устаревание только зависимых узлов (включая
// транзитивное), структурные ошибки на отсутствующей зависимости и на выходе
// за каталог проекта, а также стабильность FNV-1a 64 (содержимое важнее
// mtime). Тест дергает ту же C-команду, что CLI/GUI/агент, и разбирает её
// JSON собственным парсером SDK. Собирается с ASan/UBSan
// (см. xmake.lua).
// ===========================================================================
#include "sdk.h"
#include "unity.h"

#include <SDL3/SDL.h>

#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(_WIN32)
#include <io.h>
#include <process.h>
#define R2D_TEST_PID _getpid
#define R2D_TEST_DUP _dup
#define R2D_TEST_DUP2 _dup2
#define R2D_TEST_CLOSE _close
#define R2D_TEST_OPEN _open
#else
#include <unistd.h>
#define R2D_TEST_PID getpid
#define R2D_TEST_DUP dup
#define R2D_TEST_DUP2 dup2
#define R2D_TEST_CLOSE close
#define R2D_TEST_OPEN open
#endif

static char g_dir[1024];
static int g_out_seq;
static char g_out_path[1200];

void setUp(void) {}
void tearDown(void) {}

#define CHECK(cond, msg) TEST_ASSERT_TRUE_MESSAGE((cond), (msg))

static void mkdir_p(const char *path)
{
    char tmp[2048];
    snprintf(tmp, sizeof tmp, "%s", path);
    for (char *c = tmp + 1; *c; ++c) {
        if (*c != '/') continue;
        *c = '\0';
        SDL_CreateDirectory(tmp);
        *c = '/';
    }
    SDL_CreateDirectory(tmp);
}

static const char *proj_dir(const char *name, char *out, size_t cap)
{
    snprintf(out, cap, "%s/%s", g_dir, name);
    mkdir_p(out);
    return out;
}

static void put(const char *project, const char *rel, const char *text)
{
    char path[2048], dir[2048];
    snprintf(path, sizeof path, "%s/%s", project, rel);
    sdk_dirname(path, dir, sizeof dir);
    mkdir_p(dir);
    TEST_ASSERT_TRUE_MESSAGE(sdk_write_file(path, text, strlen(text)), "запись файла фикстуры");
}

static char *read_text(const char *project, const char *rel)
{
    char path[2048];
    snprintf(path, sizeof path, "%s/%s", project, rel);
    return sdk_read_file(path, NULL);
}

static bool file_present(const char *project, const char *rel)
{
    char path[2048];
    snprintf(path, sizeof path, "%s/%s", project, rel);
    return sdk_file_exists(path);
}

// Запускает sdk_cmd_deps с выводом в файл и разбирает JSON-ответ.
static R2dJson *run_deps(const char *target, bool record, bool detail, int *rc)
{
    char out[1200];
    snprintf(out, sizeof out, "%s/out_%d.json", g_dir, g_out_seq++);
    snprintf(g_out_path, sizeof g_out_path, "%s", out);

    const char *argv[4];
    int argc = 0;
    argv[argc++] = target;
    if (record) argv[argc++] = "--record";
    else argv[argc++] = "--check";
    if (detail) argv[argc++] = "--json";

    fflush(stdout);
    const int saved = R2D_TEST_DUP(1);
    const int fd = R2D_TEST_OPEN(out, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd >= 0) {
        R2D_TEST_DUP2(fd, 1);
        R2D_TEST_CLOSE(fd);
    }
    SdkArgs a = { argc, argv };
    const int code = sdk_cmd_deps(&a);
    fflush(stdout);
    if (saved >= 0) {
        R2D_TEST_DUP2(saved, 1);
        R2D_TEST_CLOSE(saved);
    }
    if (rc) *rc = code;

    char *text = sdk_read_file(out, NULL);
    TEST_ASSERT_NOT_NULL_MESSAGE(text, "ответ deps записан");
    char err[256];
    R2dJson *root = r2d_json_parse(text, err, sizeof err);
    free(text);
    TEST_ASSERT_NOT_NULL_MESSAGE(root, err);
    return root;
}

static int count_stale(const R2dJson *root)
{
    const R2dJson *stale = r2d_json_get(root, "stale");
    return stale && stale->type == R2D_JSON_ARR ? stale->count : -1;
}

static const R2dJson *stale_entry(const R2dJson *root, const char *source)
{
    const R2dJson *stale = r2d_json_get(root, "stale");
    if (!stale || stale->type != R2D_JSON_ARR) return NULL;
    for (int i = 0; i < stale->count; ++i) {
        const char *s = r2d_json_str(r2d_json_get(stale->items[i], "source"), NULL);
        if (s && strcmp(s, source) == 0) return stale->items[i];
    }
    return NULL;
}

static bool has_code(const R2dJson *root, const char *code)
{
    const R2dJson *diag = r2d_json_get(root, "diagnostics");
    if (!diag || diag->type != R2D_JSON_ARR) return false;
    for (int i = 0; i < diag->count; ++i) {
        const char *c = r2d_json_str(r2d_json_get(diag->items[i], "code"), NULL);
        if (c && strcmp(c, code) == 0) return true;
    }
    return false;
}

static const char *reason_of(const R2dJson *entry)
{
    return r2d_json_str(r2d_json_get(entry, "reason"), "");
}

// ---------------------------------------------------------------------------
// Манифест с четырьмя узлами: a → b → d (транзитивно) и независимый c.
// ---------------------------------------------------------------------------
static const char *const MANIFEST_MAIN =
    "{\"version\": 1, \"nodes\": [\n"
    " {\"source\": \"art/a.png\", \"deps\": [\"art/palette.json\"],\n"
    "  \"outputs\": [\"build/a.atlas.json\"], \"baker\": \"baker-a\", \"version\": 2,\n"
    "  \"options\": {\"cell\": \"16x16\"}},\n"
    " {\"source\": \"art/b.png\", \"deps\": [\"art/a.png\"],\n"
    "  \"outputs\": [\"build/b.atlas.json\"], \"baker\": \"baker-b\"},\n"
    " {\"source\": \"art/c.png\", \"outputs\": [\"build/c.atlas.json\"], \"baker\": \"baker-c\"},\n"
    " {\"source\": \"art/d.png\", \"deps\": [\"art/b.png\"],\n"
    "  \"outputs\": [\"build/d.atlas.json\"], \"baker\": \"baker-d\"}\n"
    "]}\n";

static void make_main_project(const char *name, char *out, size_t cap)
{
    proj_dir(name, out, cap);
    put(out, "deps.json", MANIFEST_MAIN);
    put(out, "art/a.png", "A1");
    put(out, "art/b.png", "B1");
    put(out, "art/c.png", "C1");
    put(out, "art/d.png", "D1");
    put(out, "art/palette.json", "P1");
    put(out, "build/a.atlas.json", "GEN-a");
    put(out, "build/b.atlas.json", "GEN-b");
    put(out, "build/c.atlas.json", "GEN-c");
    put(out, "build/d.atlas.json", "GEN-d");
}

// ---------------------------------------------------------------------------
// Запись, актуальность, стабильность кэша и хеша
// ---------------------------------------------------------------------------
static void test_record_then_up_to_date(void)
{
    char p[1200];
    make_main_project("p1", p, sizeof p);

    int rc = 0;
    R2dJson *r = run_deps(p, true, true, &rc);
    CHECK(rc == 0, "record: код 0");
    CHECK(r2d_json_bool(r2d_json_get(r, "ok"), false), "record: ok");
    CHECK(r2d_json_bool(r2d_json_get(r, "recorded"), false), "record: recorded");
    CHECK(r2d_json_int(r2d_json_get(r, "stale_before_record"), -1) == 4,
          "record: до записи устарели все 4 узла");
    CHECK(count_stale(r) == 0, "record: после записи stale пуст");
    CHECK(r2d_json_int(r2d_json_get(r, "up_to_date"), -1) == 4, "record: 4 актуальных");
    CHECK(r2d_json_int(r2d_json_get(r, "nodes_total"), -1) == 4, "record: nodes_total 4");
    r2d_json_free(r);

    char *cache1 = read_text(p, ".r2d/cache/assets.json");
    TEST_ASSERT_NOT_NULL_MESSAGE(cache1, "кэш .r2d/cache/assets.json записан");

    r = run_deps(p, false, false, &rc);
    CHECK(rc == 0, "check: код 0");
    CHECK(r2d_json_bool(r2d_json_get(r, "ok"), false), "check: ok");
    CHECK(count_stale(r) == 0, "check: ничего не устарело");
    CHECK(r2d_json_int(r2d_json_get(r, "up_to_date"), -1) == 4, "check: 4 актуальных");
    CHECK(r2d_json_int(r2d_json_get(r, "errors"), -1) == 0, "check: нет ошибок");
    r2d_json_free(r);

    // Служебный кэш не попадает в Asset Browser: сканирование пропускает
    // каталоги с «.» (sdk_assets.c skip_dir), поэтому .r2d/cache/assets.json —
    // не ассет проекта.
    {
        SdkReport scan_rep;
        sdk_report_init(&scan_rep);
        SdkAssets assets;
        CHECK(sdk_assets_scan(p, NULL, &assets, &scan_rep), "скан ассетов проекта");
        bool leaked = false;
        for (int i = 0; i < assets.count; ++i) {
            if (strstr(assets.items[i].path, ".r2d") != NULL) leaked = true;
        }
        CHECK(!leaked, "кэш .r2d не показывается как ассет");
        sdk_assets_free(&assets);
        sdk_report_free(&scan_rep);
    }

    // Стабильность кэша: повторная запись без правок даёт те же байты.
    r = run_deps(p, true, false, &rc);
    CHECK(rc == 0 && r2d_json_int(r2d_json_get(r, "stale_before_record"), -1) == 0,
          "повторный record: нечего записывать");
    r2d_json_free(r);
    char *cache2 = read_text(p, ".r2d/cache/assets.json");
    TEST_ASSERT_NOT_NULL(cache2);
    TEST_ASSERT_EQUAL_STRING_MESSAGE(cache1, cache2, "кэш детерминирован (байт в байт)");
    free(cache2);

    // Содержимое кэша: хеш/размер/baker/версия/опции узла a.
    char err[256];
    R2dJson *cache = r2d_json_parse(cache1, err, sizeof err);
    free(cache1);
    TEST_ASSERT_NOT_NULL_MESSAGE(cache, "кэш — валидный JSON");
    TEST_ASSERT_EQUAL_INT(1, r2d_json_int(r2d_json_get(cache, "version"), 0));
    const R2dJson *nodes = r2d_json_get(cache, "nodes");
    TEST_ASSERT_NOT_NULL(nodes);
    TEST_ASSERT_EQUAL_INT(4, nodes->count);
    const R2dJson *a = NULL;
    for (int i = 0; i < nodes->count; ++i) {
        const char *s = r2d_json_str(r2d_json_get(nodes->items[i], "source"), NULL);
        if (s && strcmp(s, "art/a.png") == 0) a = nodes->items[i];
    }
    TEST_ASSERT_NOT_NULL_MESSAGE(a, "узел a в кэше");
    TEST_ASSERT_EQUAL_STRING("baker-a", r2d_json_str(r2d_json_get(a, "baker"), ""));
    TEST_ASSERT_EQUAL_INT(2, r2d_json_int(r2d_json_get(a, "baker_version"), 0));
    TEST_ASSERT_EQUAL_INT(2, r2d_json_int(r2d_json_get(a, "size"), 0));
    char hex[17];
    snprintf(hex, sizeof hex, "%016llx", (unsigned long long)sdk_deps_hash64("A1", 2));
    TEST_ASSERT_EQUAL_STRING_MESSAGE(hex, r2d_json_str(r2d_json_get(a, "hash"), ""),
                                     "кэш хранит FNV-1a 64 содержимого");
    const R2dJson *opts = r2d_json_get(a, "options");
    TEST_ASSERT_NOT_NULL(opts);
    TEST_ASSERT_EQUAL_STRING("16x16", r2d_json_str(r2d_json_get(opts, "cell"), ""));
    const R2dJson *deps = r2d_json_get(a, "deps");
    TEST_ASSERT_NOT_NULL(deps);
    TEST_ASSERT_EQUAL_STRING("art/palette.json",
                             r2d_json_str(r2d_json_get(deps->items[0], "path"), ""));
    r2d_json_free(cache);

    // Только mtime (то же содержимое) не делает узел устаревшим.
    SDL_Delay(5);
    put(p, "art/a.png", "A1");
    r = run_deps(p, false, false, &rc);
    CHECK(rc == 0, "mtime без изменения содержимого: код 0");
    CHECK(count_stale(r) == 0 && r2d_json_int(r2d_json_get(r, "up_to_date"), -1) == 4,
          "mtime без изменения содержимого: всё актуально");
    r2d_json_free(r);
}

// ---------------------------------------------------------------------------
// Изменение источника: устаревают только зависимые (транзитивно)
// ---------------------------------------------------------------------------
static void test_source_change_marks_only_dependents_stale(void)
{
    char p[1200];
    make_main_project("p2", p, sizeof p);
    int rc = 0;
    R2dJson *r = run_deps(p, true, false, &rc);
    CHECK(rc == 0, "record: код 0");
    r2d_json_free(r);

    put(p, "art/a.png", "A2");
    r = run_deps(p, false, true, &rc);
    CHECK(rc == 1, "изменение источника: код 1");
    CHECK(!r2d_json_bool(r2d_json_get(r, "ok"), true), "изменение источника: ok=false");
    CHECK(count_stale(r) == 3, "устарели a, b и транзитивно d; c — нет");
    CHECK(r2d_json_int(r2d_json_get(r, "up_to_date"), -1) == 1, "c остался актуальным");

    const R2dJson *a = stale_entry(r, "art/a.png");
    const R2dJson *b = stale_entry(r, "art/b.png");
    const R2dJson *d = stale_entry(r, "art/d.png");
    TEST_ASSERT_NOT_NULL_MESSAGE(a, "a устарел");
    TEST_ASSERT_NOT_NULL_MESSAGE(b, "b устарел");
    TEST_ASSERT_NOT_NULL_MESSAGE(d, "d устарел транзитивно");
    CHECK(stale_entry(r, "art/c.png") == NULL, "c не устарел");
    TEST_ASSERT_EQUAL_STRING("source_changed", reason_of(a));
    TEST_ASSERT_TRUE_MESSAGE(strstr(reason_of(b), "dependency") != NULL,
                             "b: причина — зависимость (dependency_changed/dependency_stale)");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("dependency_stale", reason_of(d),
                                     "d: только транзитивное устаревание (его файл не менялся)");

    // В --json виден статус каждого узла, а не только устаревших.
    const R2dJson *nodes = r2d_json_get(r, "nodes");
    TEST_ASSERT_NOT_NULL(nodes);
    TEST_ASSERT_EQUAL_INT(4, nodes->count);
    r2d_json_free(r);

    // Возврат содержимого: хеш снова совпадает с записанным — всё актуально,
    // хотя mtime новее. Содержимое важнее mtime.
    put(p, "art/a.png", "A1");
    r = run_deps(p, false, false, &rc);
    CHECK(rc == 0, "возврат содержимого: код 0");
    CHECK(count_stale(r) == 0, "возврат содержимого: всё актуально");
    r2d_json_free(r);
}

// ---------------------------------------------------------------------------
// Отсутствующая зависимость и отсутствующий источник — структурные ошибки
// ---------------------------------------------------------------------------
static void test_missing_dependency_is_structured_error(void)
{
    char p[1200];
    proj_dir("p3", p, sizeof p);
    put(p, "art/x.png", "X");
    put(p, "deps.json",
        "{\"version\": 1, \"nodes\": [{\"source\": \"art/x.png\","
        " \"deps\": [\"art/missing.json\"], \"outputs\": []}]}");

    int rc = 0;
    R2dJson *r = run_deps(p, false, true, &rc);
    CHECK(rc == 1, "нет зависимости: код 1");
    CHECK(!r2d_json_bool(r2d_json_get(r, "ok"), true), "нет зависимости: ok=false");
    TEST_ASSERT_TRUE_MESSAGE(has_code(r, "SDK_DEPS_DEP_MISSING"), "код SDK_DEPS_DEP_MISSING");
    CHECK(r2d_json_int(r2d_json_get(r, "errors"), 0) == 1, "одна структурная ошибка");
    CHECK(count_stale(r) == 1 && stale_entry(r, "art/x.png") != NULL, "узел устарел");
    const char *reason = reason_of(stale_entry(r, "art/x.png"));
    TEST_ASSERT_TRUE_MESSAGE(strcmp(reason, "dependency_missing") == 0
                             || strcmp(reason, "not_recorded") == 0,
                             "причина — отсутствующая зависимость");
    r2d_json_free(r);

    // Запись с ошибкой не пишет «наполовину правдивый» кэш.
    r = run_deps(p, true, false, &rc);
    CHECK(rc == 1, "record при ошибке: код 1");
    CHECK(!r2d_json_bool(r2d_json_get(r, "recorded"), true), "record при ошибке: не записан");
    r2d_json_free(r);
    CHECK(!file_present(p, ".r2d/cache/assets.json"), "кэш при ошибке не создан");

    put(p, "deps.json",
        "{\"version\": 1, \"nodes\": [{\"source\": \"art/nope.png\", \"outputs\": []}]}");
    r = run_deps(p, false, false, &rc);
    CHECK(rc == 1 && has_code(r, "SDK_DEPS_SOURCE_MISSING"), "нет источника: SDK_DEPS_SOURCE_MISSING");
    r2d_json_free(r);
}

// ---------------------------------------------------------------------------
// Пути: выход за каталог проекта запрещён, кэш не создаётся
// ---------------------------------------------------------------------------
static void test_path_traversal_rejected(void)
{
    CHECK(sdk_deps_path_ok("art/a.png"), "обычный относительный путь");
    CHECK(sdk_deps_path_ok("a.png"), "путь без каталогов");
    CHECK(sdk_deps_path_ok("art/sub dir/a.png"), "пробел в имени");
    CHECK(!sdk_deps_path_ok(""), "пустой путь");
    CHECK(!sdk_deps_path_ok(NULL), "NULL");
    CHECK(!sdk_deps_path_ok("../escape.png"), ".. в начале");
    CHECK(!sdk_deps_path_ok("art/../escape.png"), ".. внутри");
    CHECK(!sdk_deps_path_ok("/etc/passwd"), "абсолютный путь");
    CHECK(!sdk_deps_path_ok("C:/windows/system32"), "диск Windows");
    CHECK(!sdk_deps_path_ok("art//a.png"), "пустой сегмент");
    CHECK(!sdk_deps_path_ok("art/"), "хвостовой слэш");
    CHECK(!sdk_deps_path_ok("./a.png"), "сегмент .");
    CHECK(!sdk_deps_path_ok("art\\a.png"), "обратный слэш");
    CHECK(!sdk_deps_path_ok("~/.ssh/id_rsa"), "домашний каталог");

    char p[1200];
    proj_dir("p4", p, sizeof p);
    put(p, "art/x.png", "X");
    put(p, "bad_source.json",
        "{\"version\": 1, \"nodes\": [{\"source\": \"../escape.png\", \"outputs\": []}]}");
    char bad[2200];
    snprintf(bad, sizeof bad, "%s/bad_source.json", p);
    int rc = 0;
    R2dJson *r = run_deps(bad, false, false, &rc);
    CHECK(rc == 1, "выход source за проект: код 1");
    CHECK(has_code(r, "SDK_DEPS_PATH"), "код SDK_DEPS_PATH для source");
    r2d_json_free(r);
    CHECK(!file_present(p, ".r2d/cache/assets.json"), "кэш для плохого манифеста не создан");

    // deps.json по умолчанию берётся из каталога проекта — используем
    // отдельный проект, чтобы проверить именно правку манифеста.
    char q[1200];
    proj_dir("p5", q, sizeof q);
    put(q, "art/x.png", "X");
    put(q, "deps.json",
        "{\"version\": 1, \"nodes\": [{\"source\": \"art/x.png\","
        " \"deps\": [\"../escape.png\"], \"outputs\": []}]}");
    r = run_deps(q, false, false, &rc);
    CHECK(rc == 1, "выход dep за проект: код 1");
    CHECK(has_code(r, "SDK_DEPS_PATH"), "код SDK_DEPS_PATH для dep");
    r2d_json_free(r);
}

// ---------------------------------------------------------------------------
// Hash: FNV-1a 64, стабилен, зависит только от байтов
// ---------------------------------------------------------------------------
static void test_hash_stability(void)
{
    const uint64_t abc = sdk_deps_hash64("abc", 3);
    TEST_ASSERT_EQUAL_UINT64_MESSAGE(0xe71fa2190541574bULL, abc, "FNV-1a 64 «abc»");
    TEST_ASSERT_EQUAL_UINT64_MESSAGE(0xcbf29ce484222325ULL, sdk_deps_hash64("", 0),
                                     "FNV-1a 64 пустого входа — offset basis");
    TEST_ASSERT_EQUAL_UINT64(abc, sdk_deps_hash64("abc", 3));
    TEST_ASSERT_NOT_EQUAL(abc, sdk_deps_hash64("abd", 3));
    TEST_ASSERT_NOT_EQUAL(abc, sdk_deps_hash64("abc ", 4));
    // Бинарные данные: NUL внутри не обрывает хеш (читаем длину, а не strlen).
    const char bin1[] = { 'a', '\0', 'b' };
    const char bin2[] = { 'a', '\0', 'c' };
    TEST_ASSERT_NOT_EQUAL(sdk_deps_hash64(bin1, 3), sdk_deps_hash64(bin2, 3));
}

// ---------------------------------------------------------------------------
// Identity baker/version/options и отсутствующий выход
// ---------------------------------------------------------------------------
static const char *const MANIFEST_ID =
    "{\"version\": 1, \"nodes\": ["
    "{\"source\": \"x.png\", \"outputs\": [\"x.out.json\"], \"baker\": \"%s\"%s},"
    "{\"source\": \"y.png\", \"outputs\": []}"
    "]}";

static void write_identity_manifest(const char *project, const char *baker, const char *extra)
{
    char json[1024];
    snprintf(json, sizeof json, MANIFEST_ID, baker, extra);
    put(project, "deps.json", json);
}

static void test_baker_version_options_and_outputs(void)
{
    char p[1200];
    proj_dir("p6", p, sizeof p);
    put(p, "x.png", "X");
    put(p, "y.png", "Y");
    put(p, "x.out.json", "GEN-x");
    write_identity_manifest(p, "bx", "");

    int rc = 0;
    R2dJson *r = run_deps(p, true, false, &rc);
    CHECK(rc == 0, "record identity: код 0");
    r2d_json_free(r);

    // Смена baker: устарел только x.
    write_identity_manifest(p, "bx2", "");
    r = run_deps(p, false, false, &rc);
    CHECK(rc == 1 && count_stale(r) == 1, "смена baker: устарел один узел");
    TEST_ASSERT_EQUAL_STRING("baker_changed", reason_of(stale_entry(r, "x.png")));
    CHECK(stale_entry(r, "y.png") == NULL, "y не затронут");
    r2d_json_free(r);
    r = run_deps(p, true, false, &rc);
    r2d_json_free(r);

    // Смена options (даже при том же baker) — тоже устаревание.
    write_identity_manifest(p, "bx2", ", \"options\": {\"n\": 1}");
    r = run_deps(p, false, false, &rc);
    CHECK(rc == 1 && count_stale(r) == 1, "смена options: устарел один узел");
    TEST_ASSERT_EQUAL_STRING("options_changed", reason_of(stale_entry(r, "x.png")));
    r2d_json_free(r);
    r = run_deps(p, true, false, &rc);
    r2d_json_free(r);

    // Пропавший сгенерированный выход — stale (не ошибка манифеста).
    char out_path[2048];
    snprintf(out_path, sizeof out_path, "%s/x.out.json", p);
    SDL_RemovePath(out_path);
    r = run_deps(p, false, false, &rc);
    CHECK(rc == 1 && count_stale(r) == 1, "нет выхода: stale");
    TEST_ASSERT_EQUAL_STRING("output_missing", reason_of(stale_entry(r, "x.png")));
    CHECK(r2d_json_int(r2d_json_get(r, "errors"), -1) == 0, "нет выхода — не ошибка манифеста");
    r2d_json_free(r);

    // Изменённый вручную выход виден как output_changed.
    put(p, "x.out.json", "HAND-EDIT");
    r = run_deps(p, false, false, &rc);
    CHECK(rc == 1 && count_stale(r) == 1, "правка выхода: stale");
    TEST_ASSERT_EQUAL_STRING("output_changed", reason_of(stale_entry(r, "x.png")));
    r2d_json_free(r);
}

// ---------------------------------------------------------------------------
// Использование команды
// ---------------------------------------------------------------------------
static void test_usage_errors(void)
{
    const char *none[1] = { "--check" };
    SdkArgs a = { 1, none };
    fflush(stdout);
    const int saved = R2D_TEST_DUP(1);
    const int fd = R2D_TEST_OPEN(g_out_path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd >= 0) {
        R2D_TEST_DUP2(fd, 1);
        R2D_TEST_CLOSE(fd);
    }
    const int rc = sdk_cmd_deps(&a);
    fflush(stdout);
    if (saved >= 0) {
        R2D_TEST_DUP2(saved, 1);
        R2D_TEST_CLOSE(saved);
    }
    CHECK(rc == 2, "без аргумента: код 2 (неверное использование)");

    char p[1200];
    proj_dir("p7", p, sizeof p);
    const char *argv[] = { p, "--check", "--record" };
    SdkArgs both = { 3, argv };
    fflush(stdout);
    const int saved2 = R2D_TEST_DUP(1);
    const int fd2 = R2D_TEST_OPEN(g_out_path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd2 >= 0) {
        R2D_TEST_DUP2(fd2, 1);
        R2D_TEST_CLOSE(fd2);
    }
    const int rc2 = sdk_cmd_deps(&both);
    fflush(stdout);
    if (saved2 >= 0) {
        R2D_TEST_DUP2(saved2, 1);
        R2D_TEST_CLOSE(saved2);
    }
    CHECK(rc2 == 2, "--check вместе с --record: код 2");
    char *text = sdk_read_file(g_out_path, NULL);
    TEST_ASSERT_NOT_NULL(text);
    TEST_ASSERT_TRUE_MESSAGE(strstr(text, "SDK_USAGE") != NULL, "SDK_USAGE в ответе");
    free(text);

    // Нет манифеста — структурная ошибка, а не молчаливый ok.
    char q[1200];
    proj_dir("p8", q, sizeof q);
    const char *noman[] = { q };
    SdkArgs na = { 1, noman };
    fflush(stdout);
    const int saved3 = R2D_TEST_DUP(1);
    const int fd3 = R2D_TEST_OPEN(g_out_path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd3 >= 0) {
        R2D_TEST_DUP2(fd3, 1);
        R2D_TEST_CLOSE(fd3);
    }
    const int rc3 = sdk_cmd_deps(&na);
    fflush(stdout);
    if (saved3 >= 0) {
        R2D_TEST_DUP2(saved3, 1);
        R2D_TEST_CLOSE(saved3);
    }
    CHECK(rc3 == 1, "нет deps.json: код 1");
    text = sdk_read_file(g_out_path, NULL);
    TEST_ASSERT_NOT_NULL(text);
    TEST_ASSERT_TRUE_MESSAGE(strstr(text, "SDK_DEPS_MANIFEST") != NULL,
                             "SDK_DEPS_MANIFEST в ответе");
    free(text);
}

int main(void)
{
    const char *base = SDL_getenv("TMPDIR");
    if (!base || !base[0]) base = "/tmp";
    // Уникальный каталог: повторный запуск не должен видеть кэш прошлого
    // прогона (иначе «record впервые» превращается в «record повторно»).
    // PID обязателен: SDL_GetTicksNS() в начале процесса может быть ~0, и один
    // thread id дал бы один и тот же каталог двум запускам подряд.
    snprintf(g_dir, sizeof g_dir, "%s/r2d_sdk_deps_test_%d_%d_%llu",
             base, (int)SDL_GetCurrentThreadID() % 1000, (int)R2D_TEST_PID(),
             (unsigned long long)SDL_GetPerformanceCounter());
    mkdir_p(g_dir);
    snprintf(g_out_path, sizeof g_out_path, "%s/out.json", g_dir);

    UNITY_BEGIN();
    RUN_TEST(test_hash_stability);
    RUN_TEST(test_path_traversal_rejected);
    RUN_TEST(test_record_then_up_to_date);
    RUN_TEST(test_source_change_marks_only_dependents_stale);
    RUN_TEST(test_missing_dependency_is_structured_error);
    RUN_TEST(test_baker_version_options_and_outputs);
    RUN_TEST(test_usage_errors);
    const int rc = UNITY_END();
    SDL_RemovePath(g_dir);
    return rc;
}