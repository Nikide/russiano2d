// ===========================================================================
// Тесты путей SDK: api.schema.json из любого cwd и абсолютный путь проекта
// для внешнего процесса (sdk_schema_resolve / sdk_abs_path / sdk_cmd_validate).
//
// Регрессия к аудиту установленного пакета (task-6): validate проекта из /tmp
// раньше падал с SDK_LINT_SCHEMA, потому что схема искалась только в cwd, а
// --schema не доходил до проектного режима; run с относительным каталогом
// отдавал движку путь, который тот резолвил от своего каталога.
// Собирается с ASan/UBSan (см. sdk/native/CMakeLists.txt).
// ===========================================================================
#include "sdk.h"
#include "unity.h"

#include <SDL3/SDL.h>

#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(_WIN32)
#include <direct.h>
#include <io.h>
#define R2D_TEST_CHDIR _chdir
#define R2D_TEST_DUP _dup
#define R2D_TEST_DUP2 _dup2
#define R2D_TEST_CLOSE _close
#define R2D_TEST_OPEN _open
#else
#include <unistd.h>
#define R2D_TEST_CHDIR chdir
#define R2D_TEST_DUP dup
#define R2D_TEST_DUP2 dup2
#define R2D_TEST_CLOSE close
#define R2D_TEST_OPEN open
#endif

static char g_dir[1200];
static char g_out[1400];
static char g_saved_cwd[1200];

void setUp(void) {}
void tearDown(void) {}

static const char *const SCHEMA_JSON =
    "{\"names\":[{\"path\":\"$.ready\",\"kind\":\"function\",\"arity\":1}]}";

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

static void put(const char *project, const char *rel, const char *text)
{
    char path[2048], dir[2048];
    snprintf(path, sizeof path, "%s/%s", project, rel);
    sdk_dirname(path, dir, sizeof dir);
    mkdir_p(dir);
    TEST_ASSERT_TRUE_MESSAGE(sdk_write_file(path, text, strlen(text)), "запись фикстуры");
}

static void make_project(const char *name, const char *extra_rel, const char *extra_text,
                        char *out, size_t cap)
{
    snprintf(out, cap, "%s/%s", g_dir, name);
    mkdir_p(out);
    put(out, "project.json", "{\"title\":\"T\",\"width\":320,\"height\":180,\"version\":\"1.0.0\"}");
    put(out, "main.js", "// fixture without $ API calls\n");
    if (extra_rel) put(out, extra_rel, extra_text);
}

static int g_saved_stdout = -1;

static void capture_begin(void)
{
    fflush(stdout);
    g_saved_stdout = R2D_TEST_DUP(1);
    const int fd = R2D_TEST_OPEN(g_out, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd >= 0) {
        R2D_TEST_DUP2(fd, 1);
        R2D_TEST_CLOSE(fd);
    }
}

static void capture_end(void)
{
    fflush(stdout);
    if (g_saved_stdout >= 0) {
        R2D_TEST_DUP2(g_saved_stdout, 1);
        R2D_TEST_CLOSE(g_saved_stdout);
        g_saved_stdout = -1;
    }
}

static R2dJson *run_cmd(int (*fn)(const SdkArgs *), const char *const *argv, int argc, int *rc)
{
    capture_begin();
    SdkArgs a = { argc, argv };
    const int code = fn(&a);
    if (rc) *rc = code;
    capture_end();
    char *text = sdk_read_file(g_out, NULL);
    TEST_ASSERT_NOT_NULL_MESSAGE(text, "команда печатает JSON");
    char err[256];
    R2dJson *root = r2d_json_parse(text, err, sizeof err);
    free(text);
    TEST_ASSERT_NOT_NULL_MESSAGE(root, err);
    return root;
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

static void chdir_or_fail(const char *path)
{
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, R2D_TEST_CHDIR(path), "chdir");
}

static void save_cwd(void)
{
    char *cwd = SDL_GetCurrentDirectory();
    TEST_ASSERT_NOT_NULL(cwd);
    snprintf(g_saved_cwd, sizeof g_saved_cwd, "%s", cwd);
    SDL_free(cwd);
}
// ---------------------------------------------------------------------------
// sdk_abs_path: абсолютный путь для внешнего процесса
// ---------------------------------------------------------------------------
static void test_abs_path(void)
{
    char empty[1400];
    snprintf(empty, sizeof empty, "%s/empty_cwd", g_dir);
    mkdir_p(empty);
    save_cwd();
    chdir_or_fail(empty);

    char out[2048];
    TEST_ASSERT_TRUE_MESSAGE(sdk_abs_path("rel/proj", out, sizeof out), "относительный путь");
    TEST_ASSERT_EQUAL_INT_MESSAGE('/', out[0], "результат абсолютный");
    TEST_ASSERT_TRUE_MESSAGE(sdk_ends_with(out, "/rel/proj"), "хвост пути сохранён");

    char absolute[2048], again[2048];
    snprintf(absolute, sizeof absolute, "%s/game", g_dir);
    TEST_ASSERT_TRUE(sdk_abs_path(absolute, again, sizeof again));
    TEST_ASSERT_EQUAL_STRING_MESSAGE(absolute, again, "абсолютный путь не меняется");

    TEST_ASSERT_FALSE_MESSAGE(sdk_abs_path("", out, sizeof out), "пустой путь отклонён");
    chdir_or_fail(g_saved_cwd);
}

// ---------------------------------------------------------------------------
// sdk_schema_resolve: явный --schema без подмены, иначе поиск по каталогам
// ---------------------------------------------------------------------------
static void test_schema_resolve(void)
{
    char proj[1300];
    make_project("p_schema", "api.schema.json", SCHEMA_JSON, proj, sizeof proj);

    char schema_abs[1500];
    snprintf(schema_abs, sizeof schema_abs, "%s/api.schema.json", proj);

    char out[2048];
    TEST_ASSERT_TRUE_MESSAGE(sdk_schema_resolve(schema_abs, NULL, out, sizeof out),
                             "явный существующий --schema");
    TEST_ASSERT_EQUAL_STRING_MESSAGE(schema_abs, out, "явный путь возвращается как есть");

    char missing[1500];
    snprintf(missing, sizeof missing, "%s/nope.json", g_dir);
    TEST_ASSERT_FALSE_MESSAGE(sdk_schema_resolve(missing, NULL, out, sizeof out),
                             "явный отсутствующий --schema не подменяется");
    TEST_ASSERT_EQUAL_STRING_MESSAGE(missing, out, "диагностика назовёт именно его");

    char empty[1400];
    snprintf(empty, sizeof empty, "%s/empty_schema", g_dir);
    mkdir_p(empty);
    save_cwd();
    chdir_or_fail(empty);
    TEST_ASSERT_TRUE_MESSAGE(sdk_schema_resolve(NULL, proj, out, sizeof out),
                             "схема проекта найдена из чужого cwd");
    TEST_ASSERT_TRUE_MESSAGE(sdk_ends_with(out, "/p_schema/api.schema.json"),
                             "найдена именно схема проекта");
    TEST_ASSERT_TRUE_MESSAGE(sdk_schema_resolve(NULL, NULL, out, sizeof out),
                             "схема SDK рядом с r2d-sdk или выше");
    chdir_or_fail(g_saved_cwd);
}

// ---------------------------------------------------------------------------
// validate из любого cwd: проектный режим и --schema
// ---------------------------------------------------------------------------
static void test_validate_from_any_cwd(void)
{
    char proj[1300];
    make_project("p_ok", "api.schema.json", SCHEMA_JSON, proj, sizeof proj);
    char schema_abs[1500];
    snprintf(schema_abs, sizeof schema_abs, "%s/api.schema.json", proj);

    char elsewhere[1400];
    snprintf(elsewhere, sizeof elsewhere, "%s/elsewhere", g_dir);
    mkdir_p(elsewhere);
    save_cwd();
    chdir_or_fail(elsewhere);

    int rc = 0;
    const char *argv1[] = { proj };
    R2dJson *r = run_cmd(sdk_cmd_validate, argv1, 1, &rc);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, rc, "validate абсолютного проекта из чужого cwd: код 0");
    TEST_ASSERT_TRUE_MESSAGE(r2d_json_bool(r2d_json_get(r, "ok"), false), "ok=true");
    TEST_ASSERT_FALSE_MESSAGE(has_code(r, "SDK_LINT_SCHEMA"), "схема найдена без --schema");
    r2d_json_free(r);

    const char *argv2[] = { "--schema", schema_abs, proj };
    r = run_cmd(sdk_cmd_validate, argv2, 3, &rc);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, rc, "--schema перед проектом: код 0");
    TEST_ASSERT_FALSE_MESSAGE(has_code(r, "SDK_LINT_SCHEMA"), "явный --schema принят");
    r2d_json_free(r);

    chdir_or_fail(g_dir);
    const char *argv3[] = { "p_ok" };
    r = run_cmd(sdk_cmd_validate, argv3, 1, &rc);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, rc, "относительный проект: код 0");
    TEST_ASSERT_FALSE_MESSAGE(has_code(r, "SDK_LINT_SCHEMA"), "схема проекта из cwd-родителя");
    r2d_json_free(r);

    chdir_or_fail(g_saved_cwd);
}

static void test_explicit_missing_schema_is_structured(void)
{
    char proj[1300];
    make_project("p_no_schema", NULL, NULL, proj, sizeof proj);
    char missing[1500];
    snprintf(missing, sizeof missing, "%s/missing-schema.json", g_dir);

    int rc = 0;
    const char *argv[] = { proj, "--schema", missing };
    R2dJson *r = run_cmd(sdk_cmd_validate, argv, 3, &rc);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, rc, "нет схемы из --schema: код 1");
    TEST_ASSERT_TRUE_MESSAGE(has_code(r, "SDK_LINT_SCHEMA"), "структурная диагностика SDK_LINT_SCHEMA");
    const R2dJson *diag = r2d_json_get(r, "diagnostics");
    const char *asset = diag && diag->count ? r2d_json_str(r2d_json_get(diag->items[0], "asset"), "") : "";
    TEST_ASSERT_EQUAL_STRING_MESSAGE(missing, asset, "диагностика называет именно --schema путь");
    r2d_json_free(r);

    const char *argv2[] = { proj };
    r = run_cmd(sdk_cmd_validate, argv2, 1, &rc);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, rc, "без локальной схемы работает схема SDK");
    TEST_ASSERT_FALSE(has_code(r, "SDK_LINT_SCHEMA"));
    r2d_json_free(r);
}

static void test_corrupt_schema_is_structured(void)
{
    char proj[1300];
    make_project("p_bad_schema", "api.schema.json", "{ это не json", proj, sizeof proj);
    int rc = 0;
    const char *argv[] = { proj };
    R2dJson *r = run_cmd(sdk_cmd_validate, argv, 1, &rc);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, rc, "битая схема: код 1");
    TEST_ASSERT_TRUE_MESSAGE(has_code(r, "SDK_LINT_SCHEMA"), "битая схема — SDK_LINT_SCHEMA");
    r2d_json_free(r);
}

// ---------------------------------------------------------------------------
// Разбор аргументов: --schema принимает значение (не позиционный)
// ---------------------------------------------------------------------------
static void test_schema_flag_parsing(void)
{
    const char *argv[] = { "--schema", "s.json", "proj", "--json" };
    SdkArgs a = { 4, argv };
    TEST_ASSERT_EQUAL_STRING_MESSAGE("proj", sdk_arg_positional(&a, 0),
                                     "--schema не съедает позиционный путь");
    TEST_ASSERT_EQUAL_STRING("s.json", sdk_arg_value(&a, "--schema"));
    TEST_ASSERT_TRUE(sdk_arg_flag(&a, "--json"));
}

int main(void)
{
    const char *base = SDL_getenv("TMPDIR");
    if (!base || !base[0]) base = "/tmp";
    snprintf(g_dir, sizeof g_dir, "%s/r2d_sdk_schema_path_test_%d_%llu",
             base, (int)SDL_GetCurrentThreadID() % 1000,
             (unsigned long long)SDL_GetPerformanceCounter());
    mkdir_p(g_dir);
    snprintf(g_out, sizeof g_out, "%s/out.json", g_dir);
    save_cwd();

    UNITY_BEGIN();
    RUN_TEST(test_abs_path);
    RUN_TEST(test_schema_resolve);
    RUN_TEST(test_schema_flag_parsing);
    RUN_TEST(test_validate_from_any_cwd);
    RUN_TEST(test_explicit_missing_schema_is_structured);
    RUN_TEST(test_corrupt_schema_is_structured);
    const int rc = UNITY_END();
    SDL_RemovePath(g_dir);
    return rc;
}
