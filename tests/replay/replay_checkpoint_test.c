// ===========================================================================
// Тест C-формата реплея: заголовок (версия/игра/content ID) и checkpoints.
//
// Зачем: заголовок и checkpoints — обещание перед CI. Если content ID считается
// недетерминированно или checkpoint «сверяется» без реального hash, тест на
// дивергенцию становится фикцией. Здесь проверяется именно запись/чтение
// файла, обход проекта для content ID и сравнение нативного hash, без окна,
// GPU и игровой симуляции.
//
// Сборка: цель r2d_replay_checkpoint_test (tests/CMakeLists.txt).
// ===========================================================================
#include "replay.h"
#include "unity.h"

#include <SDL3/SDL.h>

#include <stdio.h>
#include <string.h>

// replay.c зовёт виртуальный ввод при apply; для проверки заголовка/checkpoints
// сам ввод не нужен — подставляем пустые заглушки, чтобы не тащить app.c/GPU.
void r2d_app_virtual_key(R2DApp *app, SDL_Scancode sc, bool down)
{
    (void)app; (void)sc; (void)down;
}
void r2d_app_virtual_release_all(R2DApp *app) { (void)app; }
void r2d_app_virtual_mouse(R2DApp *app, int button, bool down)
{
    (void)app; (void)button; (void)down;
}
void r2d_app_virtual_mouse_pos(R2DApp *app, float x, float y)
{
    (void)app; (void)x; (void)y;
}
void r2d_app_virtual_mouse_move(R2DApp *app, float dx, float dy)
{
    (void)app; (void)dx; (void)dy;
}
void r2d_app_virtual_wheel(R2DApp *app, float amount)
{
    (void)app; (void)amount;
}

static char g_tmp[4096];     // каталог теста
static char g_hash_dir[4096];
static char g_hash_sub[4096];
static char g_replay_file[4096];
static char g_old_file[4096];
static char g_bad_file[4096];

static void remove_quiet(const char *path) { SDL_RemovePath(path); }

static bool write_file(const char *path, const char *text)
{
    FILE *f = fopen(path, "wb");
    if (!f) return false;
    const bool ok = fputs(text, f) >= 0;
    fclose(f);
    return ok;
}

void setUp(void) {}
void tearDown(void) {}

static void prepare_paths(void)
{
    char *cwd = SDL_GetCurrentDirectory();
    TEST_ASSERT_NOT_NULL_MESSAGE(cwd, "нет текущего каталога");
    SDL_snprintf(g_tmp, sizeof g_tmp, "%s/r2d_replay_test_tmp", cwd);
    SDL_free(cwd);
    SDL_snprintf(g_hash_dir, sizeof g_hash_dir, "%s/hash", g_tmp);
    SDL_snprintf(g_hash_sub, sizeof g_hash_sub, "%s/sub", g_hash_dir);
    SDL_snprintf(g_replay_file, sizeof g_replay_file, "%s/roundtrip.r2replay", g_tmp);
    SDL_snprintf(g_old_file, sizeof g_old_file, "%s/old.r2replay", g_tmp);
    SDL_snprintf(g_bad_file, sizeof g_bad_file, "%s/bad.r2replay", g_tmp);

    // Чистим хвосты прошлого прогона и создаём заново.
    remove_quiet(g_replay_file);
    remove_quiet(g_old_file);
    remove_quiet(g_bad_file);
    remove_quiet(g_hash_sub);
    remove_quiet(g_hash_dir);
    remove_quiet(g_tmp);
    TEST_ASSERT_TRUE_MESSAGE(SDL_CreateDirectory(g_tmp), SDL_GetError());
    TEST_ASSERT_TRUE_MESSAGE(SDL_CreateDirectory(g_hash_dir), SDL_GetError());
    TEST_ASSERT_TRUE_MESSAGE(SDL_CreateDirectory(g_hash_sub), SDL_GetError());
}

// --- Заголовок: запись/чтение и обратная совместимость ----------------------

static void test_header_roundtrip(void)
{
    R2DReplayHeader header;
    SDL_zero(header);
    header.format = R2D_REPLAY_FORMAT;
    SDL_strlcpy(header.version, "1.3.0", sizeof header.version);
    SDL_strlcpy(header.game, "tests/fixtures/input_walk", sizeof header.game);
    SDL_strlcpy(header.content, "fnv1a64:0011223344556677", sizeof header.content);
    header.content_files = 3;
    header.content_bytes = 1234;
    header.fixed_dt = 1.0 / 60.0;
    header.seed = 4242;

    R2dSb sb;
    r2d_sb_init(&sb);
    r2d_replay_header_emit(&sb, &header);
    TEST_ASSERT_NOT_NULL(sb.data);

    R2DReplayHeader back;
    char err[256];
    TEST_ASSERT_TRUE_MESSAGE(r2d_replay_header_parse(sb.data, &back, err, sizeof err), err);
    TEST_ASSERT_EQUAL_INT(R2D_REPLAY_FORMAT, back.format);
    TEST_ASSERT_EQUAL_STRING("1.3.0", back.version);
    TEST_ASSERT_EQUAL_STRING("tests/fixtures/input_walk", back.game);
    TEST_ASSERT_EQUAL_STRING("fnv1a64:0011223344556677", back.content);
    TEST_ASSERT_EQUAL_UINT32(3, back.content_files);
    TEST_ASSERT_EQUAL_UINT64(1234, back.content_bytes);
    // Unity собрана без UNITY_INCLUDE_DOUBLE: сравниваем с допуском.
    TEST_ASSERT_TRUE(back.fixed_dt > 0.016666 && back.fixed_dt < 0.016667);
    TEST_ASSERT_EQUAL_UINT32(4242, back.seed);

    // Старый файл: content-полей нет — это НЕ ошибка, а «content не записан».
    const char *old =
        "{\"r2d_replay\":1,\"version\":\"0.1.15\",\"game\":\"game\","
        "\"fixed_dt\":0.0166666675,\"seed\":777}";
    R2DReplayHeader legacy;
    TEST_ASSERT_TRUE_MESSAGE(r2d_replay_header_parse(old, &legacy, err, sizeof err), err);
    TEST_ASSERT_EQUAL_INT(R2D_REPLAY_FORMAT, legacy.format);
    TEST_ASSERT_EQUAL_STRING("0.1.15", legacy.version);
    TEST_ASSERT_EQUAL_STRING("game", legacy.game);
    TEST_ASSERT_EQUAL_STRING("", legacy.content);
    TEST_ASSERT_EQUAL_UINT32(0, legacy.content_files);
    TEST_ASSERT_EQUAL_UINT64(0, legacy.content_bytes);
    TEST_ASSERT_EQUAL_UINT32(777, legacy.seed);

    // Чужая версия формата отвергается с понятной причиной, а не читается.
    const char *future = "{\"r2d_replay\":99,\"version\":\"x\"}";
    R2DReplayHeader bad;
    TEST_ASSERT_FALSE(r2d_replay_header_parse(future, &bad, err, sizeof err));
    TEST_ASSERT_NOT_NULL(strstr(err, "несовместимая"));

    // Content без файлов не пишется: отсутствие поля честнее нулевого ID.
    R2DReplayHeader empty;
    SDL_zero(empty);
    SDL_strlcpy(empty.version, "1.3.0", sizeof empty.version);
    r2d_sb_clear(&sb);
    r2d_replay_header_emit(&sb, &empty);
    TEST_ASSERT_NULL(strstr(sb.data, "\"content\""));
    r2d_sb_free(&sb);
}

// --- Content ID: детерминированный хэш канонических файлов -----------------

static void test_content_hash(void)
{
    char path[4096];
    SDL_snprintf(path, sizeof path, "%s/project.json", g_hash_dir);
    TEST_ASSERT_TRUE(write_file(path, "{\"title\":\"hash test\"}\n"));
    SDL_snprintf(path, sizeof path, "%s/main.js", g_hash_dir);
    TEST_ASSERT_TRUE(write_file(path, "$.ready(() => {});\n"));
    SDL_snprintf(path, sizeof path, "%s/util.js", g_hash_sub);
    TEST_ASSERT_TRUE(write_file(path, "export const x = 1;\n"));
    SDL_snprintf(path, sizeof path, "%s/ignored.txt", g_hash_dir);
    TEST_ASSERT_TRUE(write_file(path, "не код\n"));

    char err[256];
    uint32_t files = 0;
    uint64_t bytes = 0;
    const uint64_t h1 = r2d_replay_content_hash(g_hash_dir, &files, &bytes, err, sizeof err);
    TEST_ASSERT_TRUE_MESSAGE(h1 != 0, err);
    TEST_ASSERT_EQUAL_UINT32(3, files);       // project.json + main.js + sub/util.js
    TEST_ASSERT_TRUE(bytes > 0);

    // Повторный вызов на том же дереве обязан дать тот же ID.
    uint32_t files2 = 0;
    uint64_t bytes2 = 0;
    const uint64_t h2 = r2d_replay_content_hash(g_hash_dir, &files2, &bytes2, err, sizeof err);
    TEST_ASSERT_EQUAL_UINT64(h1, h2);
    TEST_ASSERT_EQUAL_UINT32(files, files2);
    TEST_ASSERT_EQUAL_UINT64(bytes, bytes2);

    // Изменение кода меняет ID; порядок обхода от этого не зависит (сортировка).
    SDL_snprintf(path, sizeof path, "%s/main.js", g_hash_dir);
    TEST_ASSERT_TRUE(write_file(path, "$.ready(() => { /* изменено */ });\n"));
    const uint64_t h3 = r2d_replay_content_hash(g_hash_dir, NULL, NULL, err, sizeof err);
    TEST_ASSERT_TRUE(h3 != h1);

    // Недоступный каталог — 0 и причина, а не «пустой контент».
    TEST_ASSERT_EQUAL_UINT64(0, r2d_replay_content_hash("/r2d/нет/такого/каталога",
                                                        NULL, NULL, err, sizeof err));
    TEST_ASSERT_TRUE(err[0] != '\0');

    SDL_snprintf(path, sizeof path, "%s/ignored.txt", g_hash_dir);
    remove_quiet(path);
    SDL_snprintf(path, sizeof path, "%s/sub/util.js", g_hash_sub);
    remove_quiet(path);
    SDL_snprintf(path, sizeof path, "%s/main.js", g_hash_dir);
    remove_quiet(path);
    SDL_snprintf(path, sizeof path, "%s/project.json", g_hash_dir);
    remove_quiet(path);
    remove_quiet(g_hash_sub);
    remove_quiet(g_hash_dir);
}

// --- Checkpoints: запись в поток, сверка и дивергенция ----------------------

#define CHECK_ONE 0x1111222233334444ULL
#define CHECK_TWO 0xaaaabbbbccccddddULL

static void test_checkpoint_roundtrip(void)
{
    R2DReplayHeader header;
    SDL_zero(header);
    header.format = R2D_REPLAY_FORMAT;
    SDL_strlcpy(header.version, "1.3.0", sizeof header.version);
    SDL_strlcpy(header.game, "game", sizeof header.game);
    SDL_strlcpy(header.content, "fnv1a64:0011223344556677", sizeof header.content);
    header.content_files = 2;
    header.content_bytes = 99;
    header.fixed_dt = 1.0 / 60.0;
    header.seed = 4242;

    R2DReplayCheckpoint schedule[2];
    SDL_zero(schedule);
    schedule[0].frame = 5;
    SDL_strlcpy(schedule[0].name, "after_walk", sizeof schedule[0].name);
    schedule[1].frame = 9;
    SDL_strlcpy(schedule[1].name, "after_turn", sizeof schedule[1].name);

    char err[256];
    R2DReplay *rec = r2d_replay_record(g_replay_file, &header, schedule, 2, err, sizeof err);
    TEST_ASSERT_NOT_NULL_MESSAGE(rec, err);
    TEST_ASSERT_TRUE(r2d_replay_recording(rec));

    // Запись: 12 кадров ввода и два checkpoint'а на назначенных кадрах.
    static R2DApp app;
    SDL_zero(app);
    app.mouse_x = 10.0f;
    app.mouse_y = 20.0f;
    for (int i = 0; i < 12; ++i) r2d_replay_capture(rec, &app);

    R2DReplayCheck out;
    TEST_ASSERT_TRUE(r2d_replay_checkpoint_due(rec, 5));
    TEST_ASSERT_EQUAL(R2D_REPLAY_CHECK_NONE, r2d_replay_check(rec, 5, CHECK_ONE, &out));
    TEST_ASSERT_FALSE(r2d_replay_checkpoint_due(rec, 5));   // уже записан
    TEST_ASSERT_FALSE(r2d_replay_checkpoint_due(rec, 6));   // не назначен
    TEST_ASSERT_TRUE(r2d_replay_checkpoint_due(rec, 9));
    TEST_ASSERT_EQUAL(R2D_REPLAY_CHECK_NONE, r2d_replay_check(rec, 9, CHECK_TWO, &out));
    TEST_ASSERT_EQUAL_INT(2, r2d_replay_checkpoint_checked(rec));
    TEST_ASSERT_EQUAL_INT(12, r2d_replay_frames(rec));
    r2d_replay_destroy(rec);

    // Чтение: заголовок и checkpoints на месте.
    R2DReplay *play = r2d_replay_play(g_replay_file, true, err, sizeof err);
    TEST_ASSERT_NOT_NULL_MESSAGE(play, err);
    TEST_ASSERT_TRUE(r2d_replay_playing(play));
    const R2DReplayHeader *rh = r2d_replay_header(play);
    TEST_ASSERT_EQUAL_STRING("fnv1a64:0011223344556677", rh->content);
    TEST_ASSERT_EQUAL_UINT32(2, rh->content_files);
    TEST_ASSERT_EQUAL_UINT64(99, rh->content_bytes);
    TEST_ASSERT_EQUAL_INT(12, r2d_replay_frames(play));
    TEST_ASSERT_EQUAL_INT(2, r2d_replay_checkpoint_count(play));

    TEST_ASSERT_TRUE(r2d_replay_checkpoint_due(play, 5));
    TEST_ASSERT_EQUAL(R2D_REPLAY_CHECK_OK, r2d_replay_check(play, 5, CHECK_ONE, &out));
    TEST_ASSERT_EQUAL_INT(5, out.frame);
    TEST_ASSERT_EQUAL_STRING("after_walk", out.name);
    TEST_ASSERT_EQUAL_UINT64(CHECK_ONE, out.expected);
    TEST_ASSERT_EQUAL_UINT64(CHECK_ONE, out.actual);
    TEST_ASSERT_FALSE(r2d_replay_diverged(play));

    TEST_ASSERT_EQUAL(R2D_REPLAY_CHECK_OK, r2d_replay_check(play, 9, CHECK_TWO, &out));
    TEST_ASSERT_EQUAL_INT(2, r2d_replay_checkpoint_checked(play));
    TEST_ASSERT_FALSE(r2d_replay_diverged(play));
    TEST_ASSERT_EQUAL(R2D_REPLAY_CHECK_NONE, r2d_replay_check(play, 7, CHECK_ONE, &out));
    r2d_replay_destroy(play);

    // Дивергенция: hash на кадре 5 не совпал — поля expected/actual/имя/кадр
    // обязаны быть настоящими, а сверка на кадре 9 продолжиться.
    play = r2d_replay_play(g_replay_file, true, err, sizeof err);
    TEST_ASSERT_NOT_NULL_MESSAGE(play, err);
    const uint64_t wrong = CHECK_ONE ^ 0xFFFFULL;
    TEST_ASSERT_EQUAL(R2D_REPLAY_CHECK_DIVERGED, r2d_replay_check(play, 5, wrong, &out));
    TEST_ASSERT_TRUE(r2d_replay_diverged(play));
    TEST_ASSERT_EQUAL_INT(5, out.frame);
    TEST_ASSERT_EQUAL_STRING("after_walk", out.name);
    TEST_ASSERT_EQUAL_UINT64(CHECK_ONE, out.expected);
    TEST_ASSERT_EQUAL_UINT64(wrong, out.actual);
    TEST_ASSERT_EQUAL(R2D_REPLAY_CHECK_OK, r2d_replay_check(play, 9, CHECK_TWO, &out));
    TEST_ASSERT_TRUE(r2d_replay_diverged(play));
    r2d_replay_destroy(play);

    // --checkpoints off: checkpoints читаются, но НЕ сверяются.
    play = r2d_replay_play(g_replay_file, false, err, sizeof err);
    TEST_ASSERT_NOT_NULL_MESSAGE(play, err);
    TEST_ASSERT_EQUAL_INT(2, r2d_replay_checkpoint_count(play));
    TEST_ASSERT_FALSE(r2d_replay_checkpoint_due(play, 5));
    TEST_ASSERT_EQUAL(R2D_REPLAY_CHECK_NONE, r2d_replay_check(play, 5, wrong, &out));
    TEST_ASSERT_EQUAL_INT(0, r2d_replay_checkpoint_checked(play));
    TEST_ASSERT_FALSE(r2d_replay_diverged(play));
    r2d_replay_destroy(play);
}

static void test_legacy_file(void)
{
    // Старый файл без content/checkpoints читается и играется как раньше.
    TEST_ASSERT_TRUE(write_file(
        g_old_file,
        "{\"r2d_replay\":1,\"version\":\"0.1.15\",\"game\":\"game\","
        "\"fixed_dt\":0.0166666675,\"seed\":777}\n"
        "{\"f\":0,\"keys\":[4],\"mx\":0,\"my\":0,\"mb\":0,\"wheel\":0}\n"
        "{\"f\":1,\"keys\":[],\"mx\":0,\"my\":0,\"mb\":0,\"wheel\":0}\n"));

    char err[256];
    R2DReplay *play = r2d_replay_play(g_old_file, true, err, sizeof err);
    TEST_ASSERT_NOT_NULL_MESSAGE(play, err);
    TEST_ASSERT_EQUAL_INT(2, r2d_replay_frames(play));
    TEST_ASSERT_EQUAL_INT(0, r2d_replay_checkpoint_count(play));
    TEST_ASSERT_EQUAL_STRING("", r2d_replay_header(play)->content);
    TEST_ASSERT_FALSE(r2d_replay_checkpoint_due(play, 1));
    TEST_ASSERT_FALSE(r2d_replay_finished(play));

    static R2DApp app;
    SDL_zero(app);
    static R2DApp app_copy;
    SDL_zero(app_copy);
    r2d_replay_apply(play, &app);
    r2d_replay_apply(play, &app_copy);
    r2d_replay_apply(play, &app);   // за концом записи: тихо ничего не подменяет
    TEST_ASSERT_TRUE(r2d_replay_finished(play));
    TEST_ASSERT_FALSE(r2d_replay_diverged(play));
    r2d_replay_destroy(play);

    // Чужая версия — отказ при открытии, а не чтение «как получится».
    TEST_ASSERT_TRUE(write_file(g_bad_file,
        "{\"r2d_replay\":99,\"version\":\"x\",\"game\":\"x\",\"fixed_dt\":0.016,\"seed\":1}\n"
        "{\"f\":0,\"keys\":[4],\"mx\":0,\"my\":0,\"mb\":0,\"wheel\":0}\n"));
    TEST_ASSERT_NULL(r2d_replay_play(g_bad_file, true, err, sizeof err));
    TEST_ASSERT_NOT_NULL(strstr(err, "несовместимая"));
}

static void test_too_many_checkpoints(void)
{
    R2DReplayCheckpoint many[R2D_REPLAY_MAX_CHECKPOINTS + 1];
    SDL_zero(many);
    R2DReplayHeader header;
    SDL_zero(header);
    SDL_strlcpy(header.version, "1.3.0", sizeof header.version);
    char err[256];
    TEST_ASSERT_NULL(r2d_replay_record(g_replay_file, &header, many,
                                       R2D_REPLAY_MAX_CHECKPOINTS + 1, err, sizeof err));
    TEST_ASSERT_NOT_NULL(strstr(err, "checkpoints"));
}

static void cleanup_files(void)
{
    remove_quiet(g_replay_file);
    remove_quiet(g_old_file);
    remove_quiet(g_bad_file);
    remove_quiet(g_hash_sub);
    remove_quiet(g_hash_dir);
    remove_quiet(g_tmp);
}

int main(void)
{
    UNITY_BEGIN();
    prepare_paths();
    RUN_TEST(test_header_roundtrip);
    RUN_TEST(test_content_hash);
    RUN_TEST(test_legacy_file);
    RUN_TEST(test_too_many_checkpoints);
    RUN_TEST(test_checkpoint_roundtrip);
    cleanup_files();
    return UNITY_END();
}
