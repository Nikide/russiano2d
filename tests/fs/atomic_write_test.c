// ===========================================================================
// Атомарная запись (src/fs_util.c): Unity, без SDL/QuickJS.
//
// Проверяем ровно то, на чём стоит $.save/$.store: новая запись, замена
// существующей, переименование с заменой и отказ без порчи целевого файла.
// ===========================================================================
#include "unity.h"
#include "fs_util.h"

#include <stdio.h>
#include <string.h>

#ifdef _WIN32
#include <direct.h>
#include <process.h>
#else
#include <sys/stat.h>
#include <unistd.h>
#endif

static char dir[512];
static char file_path[600];

static void make_dir(const char *path)
{
#ifdef _WIN32
    _mkdir(path);
#else
    mkdir(path, 0700);
#endif
}

static void remove_dir(const char *path)
{
#ifdef _WIN32
    _rmdir(path);
#else
    rmdir(path);
#endif
}

static void read_all(const char *path, char *out, size_t size)
{
    FILE *f = fopen(path, "rb");
    TEST_ASSERT_NOT_NULL_MESSAGE(f, "файл должен существовать");
    size_t n = fread(out, 1, size - 1, f);
    out[n] = '\0';
    fclose(f);
}

void setUp(void)
{
#ifdef _WIN32
    snprintf(dir, sizeof dir, "r2d_fs_atomic_%ld", (long)_getpid());
#else
    snprintf(dir, sizeof dir, "r2d_fs_atomic_%ld", (long)getpid());
#endif
    remove_dir(dir);
    make_dir(dir);
    snprintf(file_path, sizeof file_path, "%s/slot.json", dir);
}

void tearDown(void)
{
    remove(file_path);
    char tmp[600];
    snprintf(tmp, sizeof tmp, "%s/renamed.json", dir);
    remove(tmp);
    remove_dir(dir);
}

static void test_writes_new_file(void)
{
    char error[256] = "";
    TEST_ASSERT_TRUE(r2d_fs_write_atomic(file_path, "hello", 5, error, sizeof error));
    char got[32];
    read_all(file_path, got, sizeof got);
    TEST_ASSERT_EQUAL_STRING("hello", got);
}

static void test_replaces_existing_file(void)
{
    char error[256] = "";
    TEST_ASSERT_TRUE(r2d_fs_write_atomic(file_path, "old", 3, error, sizeof error));
    TEST_ASSERT_TRUE(r2d_fs_write_atomic(file_path, "new-data", 8, error, sizeof error));
    char got[32];
    read_all(file_path, got, sizeof got);
    TEST_ASSERT_EQUAL_STRING("new-data", got);
}

static void test_rename_replace(void)
{
    char error[256] = "";
    char other[600];
    snprintf(other, sizeof other, "%s/renamed.json", dir);
    TEST_ASSERT_TRUE(r2d_fs_write_atomic(file_path, "one", 3, error, sizeof error));
    TEST_ASSERT_TRUE(r2d_fs_write_atomic(other, "two", 3, error, sizeof error));
    TEST_ASSERT_TRUE(r2d_fs_rename_replace(other, file_path, error, sizeof error));
    char got[32];
    read_all(file_path, got, sizeof got);
    TEST_ASSERT_EQUAL_STRING("two", got);
}

static void test_failure_leaves_target_intact(void)
{
    char error[256] = "";
    TEST_ASSERT_TRUE(r2d_fs_write_atomic(file_path, "keep", 4, error, sizeof error));
    char missing[600];
    snprintf(missing, sizeof missing, "%s/no-such-dir/x.json", dir);
    TEST_ASSERT_FALSE(r2d_fs_write_atomic(missing, "lost", 4, error, sizeof error));
    TEST_ASSERT_TRUE(error[0] != '\0');
    char got[32];
    read_all(file_path, got, sizeof got);
    TEST_ASSERT_EQUAL_STRING("keep", got);
}

static void test_rejects_empty_path(void)
{
    char error[256] = "";
    TEST_ASSERT_FALSE(r2d_fs_write_atomic("", "x", 1, error, sizeof error));
    TEST_ASSERT_TRUE(error[0] != '\0');
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_writes_new_file);
    RUN_TEST(test_replaces_existing_file);
    RUN_TEST(test_rename_replace);
    RUN_TEST(test_failure_leaves_target_intact);
    RUN_TEST(test_rejects_empty_path);
    return UNITY_END();
}
