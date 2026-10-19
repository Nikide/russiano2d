// ===========================================================================
// Native unit test: deterministic async atlas prefetch queue (no engine/GPU).
//
// The module under test only reads file bytes in a worker thread; PNG decode
// stays on the main thread. This test exercises the deterministic contract:
// queue bounds, dedup, ready/take/consumed, missing and stale files, cancel,
// disable/shutdown lifecycle and payload-provisioned bytes.
//
// The target compiles src/re2d_world_atlas_prefetch.c with small limits
// (8 entries, 4096 pending bytes, 1024 per file) so the bounds are cheap.
// ===========================================================================

#include "re2d_world_atlas_prefetch.h"
#include "unity.h"

#include <SDL3/SDL.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char g_dir[1024];
static int  g_serial;

void setUp(void) {}
void tearDown(void) {}

static void test_path(char *out, size_t size, const char *name)
{
    SDL_snprintf(out, size, "%s%s_%d.bin", g_dir, name, g_serial++);
}

static bool write_file(const char *path, const uint8_t *bytes, size_t size)
{
    FILE *file = fopen(path, "wb");
    if (!file) return false;
    const bool ok = size == 0 || fwrite(bytes, 1, size, file) == size;
    fclose(file);
    return ok;
}

static void fill(uint8_t *bytes, size_t size, int seed)
{
    for (size_t i = 0; i < size; i++) bytes[i] = (uint8_t)((i * 31u + (unsigned)seed) & 0xffu);
}

static bool stat_file(const char *path, int64_t *size, int64_t *mtime)
{
    SDL_PathInfo info;
    if (!SDL_GetPathInfo(path, &info) || info.type != SDL_PATHTYPE_FILE) return false;
    if (size) *size = (int64_t)info.size;
    if (mtime) *mtime = (int64_t)info.modify_time;
    return true;
}

static bool entry_state_of(R2DAtlasPrefetch *pf, const char *canonical, int *state)
{
    for (int i = 0; i < r2d_atlas_prefetch_entry_count(pf); i++) {
        R2DAtlasPrefetchEntryInfo entry;
        if (!r2d_atlas_prefetch_entry_at(pf, i, &entry)) continue;
        if (SDL_strcmp(entry.path, canonical) != 0) continue;
        if (state) *state = entry.state;
        return true;
    }
    return false;
}

// Wait until the entry leaves PENDING. Returns the final state or -1 on timeout.
static int wait_state(R2DAtlasPrefetch *pf, const char *canonical, int timeout_ms)
{
    const Uint64 start = SDL_GetTicks();
    for (;;) {
        r2d_atlas_prefetch_poll(pf);
        int state = R2D_ATLAS_PREFETCH_PENDING;
        // entry paths are authored by the tests as canonical too
        bool found = false;
        for (int i = 0; i < r2d_atlas_prefetch_entry_count(pf); i++) {
            R2DAtlasPrefetchEntryInfo entry;
            if (!r2d_atlas_prefetch_entry_at(pf, i, &entry)) continue;
            if (SDL_strcmp(entry.path, canonical) != 0) continue;
            state = entry.state;
            found = true;
            break;
        }
        if (found && state != R2D_ATLAS_PREFETCH_PENDING) return state;
        if ((int)(SDL_GetTicks() - start) > timeout_ms) return -1;
        SDL_Delay(5);
    }
}

static void test_missing_file_is_failed(void)
{
    R2DAtlasPrefetch pf;
    r2d_atlas_prefetch_init(&pf, true);
    char path[1200];
    test_path(path, sizeof path, "missing");
    const int token = r2d_atlas_prefetch_request(&pf, path, path, -1, -1);
    TEST_ASSERT_GREATER_THAN_INT(0, token);
    r2d_atlas_prefetch_poll(&pf);
    int state = -1;
    TEST_ASSERT_TRUE(entry_state_of(&pf, path, &state));
    TEST_ASSERT_EQUAL_INT(R2D_ATLAS_PREFETCH_FAILED, state);
    R2DAtlasPrefetchEntryInfo entry;
    TEST_ASSERT_TRUE(r2d_atlas_prefetch_entry_at(&pf, 0, &entry));
    TEST_ASSERT_GREATER_THAN_INT(0, (int)strlen(entry.error));
    uint8_t *bytes = NULL;
    size_t size = 0;
    TEST_ASSERT_FALSE(r2d_atlas_prefetch_take(&pf, path, &bytes, &size));
    TEST_ASSERT_NULL(bytes);
    R2DAtlasPrefetchInfo info;
    r2d_atlas_prefetch_info(&pf, &info);
    TEST_ASSERT_EQUAL_INT(1, info.failed);
    TEST_ASSERT_EQUAL_INT(0, info.pending);
    r2d_atlas_prefetch_shutdown(&pf);
}

static void test_ready_take_consumed(void)
{
    R2DAtlasPrefetch pf;
    r2d_atlas_prefetch_init(&pf, true);
    char path[1200];
    test_path(path, sizeof path, "ready");
    uint8_t payload[512];
    fill(payload, sizeof payload, 7);
    TEST_ASSERT_TRUE(write_file(path, payload, sizeof payload));

    int64_t size_on_disk = -1, mtime = -1;
    TEST_ASSERT_TRUE(stat_file(path, &size_on_disk, &mtime));
    const int token = r2d_atlas_prefetch_request(&pf, path, path, size_on_disk, mtime);
    TEST_ASSERT_GREATER_THAN_INT(0, token);
    TEST_ASSERT_EQUAL_INT(R2D_ATLAS_PREFETCH_READY,
                          wait_state(&pf, path, 2000));

    uint8_t *bytes = NULL;
    size_t size = 0;
    TEST_ASSERT_TRUE(r2d_atlas_prefetch_take(&pf, path, &bytes, &size));
    TEST_ASSERT_EQUAL_size_t(sizeof payload, size);
    TEST_ASSERT_EQUAL_MEMORY(payload, bytes, sizeof payload);
    free(bytes);

    int state = -1;
    TEST_ASSERT_TRUE(entry_state_of(&pf, path, &state));
    TEST_ASSERT_EQUAL_INT(R2D_ATLAS_PREFETCH_CONSUMED, state);
    TEST_ASSERT_FALSE(r2d_atlas_prefetch_take(&pf, path, &bytes, &size));

    R2DAtlasPrefetchInfo info;
    r2d_atlas_prefetch_info(&pf, &info);
    TEST_ASSERT_EQUAL_INT(0, info.ready);
    TEST_ASSERT_EQUAL_INT(0, (int)info.bytes_ready);
    TEST_ASSERT_GREATER_OR_EQUAL_INT(1, info.consumed);
    TEST_ASSERT_GREATER_OR_EQUAL_INT(1, info.consumed_total);
    r2d_atlas_prefetch_shutdown(&pf);
}

static void test_stale_file_rejected(void)
{
    R2DAtlasPrefetch pf;
    r2d_atlas_prefetch_init(&pf, true);
    char path[1200];
    test_path(path, sizeof path, "stale");
    uint8_t first[256];
    fill(first, sizeof first, 3);
    TEST_ASSERT_TRUE(write_file(path, first, sizeof first));
    int64_t size_on_disk = -1, mtime = -1;
    TEST_ASSERT_TRUE(stat_file(path, &size_on_disk, &mtime));
    TEST_ASSERT_GREATER_THAN_INT(0, r2d_atlas_prefetch_request(&pf, path, path,
                                                               size_on_disk, mtime));
    TEST_ASSERT_EQUAL_INT(R2D_ATLAS_PREFETCH_READY, wait_state(&pf, path, 2000));

    // Rewrite the file (different size) after it was prefetched.
    uint8_t second[300];
    fill(second, sizeof second, 9);
    TEST_ASSERT_TRUE(write_file(path, second, sizeof second));
    SDL_Delay(5);

    uint8_t *bytes = NULL;
    size_t size = 0;
    TEST_ASSERT_FALSE_MESSAGE(r2d_atlas_prefetch_take(&pf, path, &bytes, &size),
                              "stale prefetch must be rejected");
    int state = -1;
    TEST_ASSERT_TRUE(entry_state_of(&pf, path, &state));
    TEST_ASSERT_EQUAL_INT(R2D_ATLAS_PREFETCH_FAILED, state);
    r2d_atlas_prefetch_shutdown(&pf);
}

static void test_bounds_and_dedup(void)
{
    R2DAtlasPrefetch pf;
    r2d_atlas_prefetch_init(&pf, true);
    char paths[9][1200];
    uint8_t block[1024];
    fill(block, sizeof block, 1);

    // 4 x 1024 = 4096 == pending byte budget: all accepted.
    for (int i = 0; i < 4; i++) {
        test_path(paths[i], sizeof paths[i], "bounds");
        TEST_ASSERT_TRUE(write_file(paths[i], block, sizeof block));
        TEST_ASSERT_GREATER_THAN_INT(0,
            r2d_atlas_prefetch_request(&pf, paths[i], paths[i], 1024, -1));
    }
    // A fifth byte would exceed the test byte budget -> token 0, not a crash.
    char extra[1200];
    test_path(extra, sizeof extra, "extra");
    uint8_t one = 0x42;
    TEST_ASSERT_TRUE(write_file(extra, &one, 1));
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,
        r2d_atlas_prefetch_request(&pf, extra, extra, 1, -1),
        "pending byte budget is enforced");
    // Duplicate of an occupied path -> 0 ("already").
    TEST_ASSERT_EQUAL_INT(0, r2d_atlas_prefetch_request(&pf, paths[0], paths[0], 1024, -1));
    // The over-limit request left a diagnostic, not a silent failure.
    R2DAtlasPrefetchInfo info;
    r2d_atlas_prefetch_info(&pf, &info);
    TEST_ASSERT_GREATER_THAN_INT(0, (int)strlen(info.error));

    r2d_atlas_prefetch_clear(&pf);
    // Entry budget: 8 tiny files accepted, the ninth returns 0.
    char small[9][1200];
    for (int i = 0; i < 8; i++) {
        test_path(small[i], sizeof small[i], "entry");
        TEST_ASSERT_TRUE(write_file(small[i], &one, 1));
        TEST_ASSERT_GREATER_THAN_INT(0,
            r2d_atlas_prefetch_request(&pf, small[i], small[i], 1, -1));
    }
    test_path(small[8], sizeof small[8], "entry");
    TEST_ASSERT_TRUE(write_file(small[8], &one, 1));
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,
        r2d_atlas_prefetch_request(&pf, small[8], small[8], 1, -1),
        "entry budget is enforced");
    r2d_atlas_prefetch_shutdown(&pf);
}

static void test_per_file_limit(void)
{
    R2DAtlasPrefetch pf;
    r2d_atlas_prefetch_init(&pf, true);
    char path[1200];
    test_path(path, sizeof path, "large");
    uint8_t big[1025];
    fill(big, sizeof big, 2);
    TEST_ASSERT_TRUE(write_file(path, big, sizeof big));
    const int token = r2d_atlas_prefetch_request(&pf, path, path, (int64_t)sizeof big, -1);
    TEST_ASSERT_GREATER_THAN_INT(0, token);
    int state = -1;
    TEST_ASSERT_TRUE(entry_state_of(&pf, path, &state));
    TEST_ASSERT_EQUAL_INT(R2D_ATLAS_PREFETCH_FAILED, state);
    r2d_atlas_prefetch_shutdown(&pf);
}

static void test_clear_cancel_and_reuse(void)
{
    R2DAtlasPrefetch pf;
    r2d_atlas_prefetch_init(&pf, true);
    char paths[4][1200];
    uint8_t block[512];
    fill(block, sizeof block, 4);
    for (int i = 0; i < 4; i++) {
        test_path(paths[i], sizeof paths[i], "cancel");
        TEST_ASSERT_TRUE(write_file(paths[i], block, sizeof block));
        TEST_ASSERT_GREATER_THAN_INT(0,
            r2d_atlas_prefetch_request(&pf, paths[i], paths[i], 512, -1));
    }
    // Cancel immediately: some jobs may already be done; none may survive.
    r2d_atlas_prefetch_clear(&pf);
    R2DAtlasPrefetchInfo info;
    r2d_atlas_prefetch_info(&pf, &info);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, info.entries, "clear forgets entries");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, info.pending, "clear cancels pending reads");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, (int)info.bytes_pending, "pending bytes reset");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, (int)info.bytes_ready, "ready bytes dropped");

    // The prefetcher is still usable after clear.
    char again[1200];
    test_path(again, sizeof again, "cancel_again");
    TEST_ASSERT_TRUE(write_file(again, block, sizeof block));
    TEST_ASSERT_GREATER_THAN_INT(0,
        r2d_atlas_prefetch_request(&pf, again, again, 512, -1));
    TEST_ASSERT_EQUAL_INT(R2D_ATLAS_PREFETCH_READY, wait_state(&pf, again, 2000));
    r2d_atlas_prefetch_shutdown(&pf);
}

static void test_provide_payload_bytes(void)
{
    R2DAtlasPrefetch pf;
    r2d_atlas_prefetch_init(&pf, true);
    char canonical[1200];
    test_path(canonical, sizeof canonical, "payload");
    uint8_t payload[128];
    fill(payload, sizeof payload, 5);

    const int token = r2d_atlas_prefetch_provide(&pf, "pkg/a.png", canonical,
                                                 payload, sizeof payload);
    TEST_ASSERT_GREATER_THAN_INT(0, token);
    R2DAtlasPrefetchInfo info;
    r2d_atlas_prefetch_info(&pf, &info);
    TEST_ASSERT_EQUAL_INT(1, info.ready);
    TEST_ASSERT_EQUAL_INT((int)sizeof payload, (int)info.bytes_ready);
    // Duplicate provide -> 0 ("already"), no second record.
    TEST_ASSERT_EQUAL_INT(0, r2d_atlas_prefetch_provide(&pf, "pkg/a.png", canonical,
                                                        payload, sizeof payload));
    uint8_t *bytes = NULL;
    size_t size = 0;
    TEST_ASSERT_TRUE(r2d_atlas_prefetch_take(&pf, canonical, &bytes, &size));
    TEST_ASSERT_EQUAL_size_t(sizeof payload, size);
    TEST_ASSERT_EQUAL_MEMORY(payload, bytes, sizeof payload);
    free(bytes);
    r2d_atlas_prefetch_shutdown(&pf);
}

static void test_disable_and_shutdown_lifecycle(void)
{
    R2DAtlasPrefetch pf;
    r2d_atlas_prefetch_init(&pf, true);
    char path[1200];
    test_path(path, sizeof path, "life");
    uint8_t one = 1;
    TEST_ASSERT_TRUE(write_file(path, &one, 1));
    TEST_ASSERT_GREATER_THAN_INT(0,
        r2d_atlas_prefetch_request(&pf, path, path, 1, -1));
    R2DAtlasPrefetchInfo info;
    r2d_atlas_prefetch_info(&pf, &info);
    TEST_ASSERT_TRUE(info.worker);

    TEST_ASSERT_FALSE(r2d_atlas_prefetch_set_enabled(&pf, false));
    r2d_atlas_prefetch_info(&pf, &info);
    TEST_ASSERT_FALSE(info.enabled);
    TEST_ASSERT_FALSE(info.worker);
    TEST_ASSERT_EQUAL_INT(0, info.entries);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,
        r2d_atlas_prefetch_request(&pf, path, path, 1, -1),
        "disabled prefetch accepts nothing");

    TEST_ASSERT_TRUE(r2d_atlas_prefetch_set_enabled(&pf, true));
    TEST_ASSERT_GREATER_THAN_INT(0,
        r2d_atlas_prefetch_request(&pf, path, path, 1, -1));
    TEST_ASSERT_EQUAL_INT(R2D_ATLAS_PREFETCH_READY, wait_state(&pf, path, 2000));

    r2d_atlas_prefetch_shutdown(&pf);
    r2d_atlas_prefetch_shutdown(&pf);   // idempotent
    r2d_atlas_prefetch_info(&pf, &info);
    TEST_ASSERT_FALSE(info.enabled);
    TEST_ASSERT_FALSE(info.worker);
    TEST_ASSERT_EQUAL_INT(0, info.entries);
}

int main(void)
{
    char *pref = SDL_GetPrefPath("r2d", "atlas_prefetch_test");
    if (pref) {
        SDL_snprintf(g_dir, sizeof g_dir, "%s", pref);
        SDL_free(pref);
    } else {
        char *cwd = SDL_GetCurrentDirectory();
        if (cwd) {
            SDL_snprintf(g_dir, sizeof g_dir, "%s/", cwd);
            SDL_free(cwd);
        } else {
            g_dir[0] = 0;
        }
    }
    g_serial = 0;

    UNITY_BEGIN();
    RUN_TEST(test_missing_file_is_failed);
    RUN_TEST(test_ready_take_consumed);
    RUN_TEST(test_stale_file_rejected);
    RUN_TEST(test_bounds_and_dedup);
    RUN_TEST(test_per_file_limit);
    RUN_TEST(test_clear_cancel_and_reuse);
    RUN_TEST(test_provide_payload_bytes);
    RUN_TEST(test_disable_and_shutdown_lifecycle);
    return UNITY_END();
}
