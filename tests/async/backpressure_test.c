// ===========================================================================
// Нативный тест планировщика async (src/async.c).
//
// Проверяет БЕЗ GPU и окна: explicit-состояния задания, outstanding-учёт
// (QUEUED+RUNNING+READY), high/low watermarks очереди применений, бюджеты
// max_jobs/max_bytes, producer backpressure, отмену и безопасное завершение.
//
// Собирается с -DR2D_ASYNC_TEST: async.c не тянет app/render/payload, а тест
// получает синтетические задания (work_ms задаёт длительность «работы»).
// Именно этот флаг — тестовый крючок, без него движок собирается как раньше.
// ===========================================================================

#include "async.h"
#include "unity.h"

#include <SDL3/SDL.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char g_dir[1024];
static int  g_serial;

void setUp(void) {}
void tearDown(void) {}

static R2DAsyncPressure snap(void)
{
    R2DAsyncPressure p;
    r2d_async_pressure(&p);
    return p;
}

static void drain_and_release(void)
{
    for (int guard = 0; guard < 20000; ++guard) {
        R2DAsyncResult buf[16];
        const int n = r2d_async_poll(buf, (int)(sizeof buf / sizeof buf[0]));
        if (n > 0) {
            for (int i = 0; i < n; ++i) r2d_async_release(buf[i].id);
            continue;
        }
        const R2DAsyncPressure p = snap();
        if (p.live == 0 && p.delivered == 0) return;
        SDL_Delay(1);
    }
}

static void limits_apply(int max_jobs, long long max_bytes, int max_ready,
                         long long max_ready_bytes, int ready_low,
                         bool block_producer)
{
    R2DAsyncLimits l;
    r2d_async_limits_default(&l);
    l.max_jobs = max_jobs;
    l.max_bytes = max_bytes;
    l.max_ready = max_ready;
    l.max_ready_bytes = max_ready_bytes;
    l.ready_low = ready_low;
    l.ready_low_bytes = max_ready_bytes / 2;
    l.workers = 1;
    l.block_producer = block_producer;
    TEST_ASSERT_TRUE(r2d_async_set_limits(&l));
}

static void begin(int max_jobs, long long max_bytes, int max_ready,
                  long long max_ready_bytes, int ready_low, bool block_producer)
{
    r2d_async_shutdown();
    limits_apply(max_jobs, max_bytes, max_ready, max_ready_bytes, ready_low, block_producer);
    TEST_ASSERT_TRUE(r2d_async_init(NULL));
    TEST_ASSERT_EQUAL_INT(1, r2d_async_workers());
}

// Ждём предикат над свежим снимком давления. Никаких busy sleep в движке —
// это только тест.
#define WAIT_P(expr, ms)                                                       \
    do {                                                                       \
        const Uint64 _wstart = SDL_GetTicks();                                  \
        R2DAsyncPressure p = snap();                                           \
        while (!(expr)) {                                                      \
            if (SDL_GetTicks() - _wstart > (Uint32)(ms)) break;                 \
            SDL_Delay(1);                                                      \
            p = snap();                                                        \
        }                                                                      \
        TEST_ASSERT_TRUE_MESSAGE((expr), "timeout: " #expr);                    \
    } while (0)

// ---------------------------------------------------------------------------
// 1. Явные состояния и точный outstanding-учёт
// ---------------------------------------------------------------------------

static void test_state_accounting(void)
{
    begin(32, 1LL << 20, 8, 1LL << 20, 4, false);

    const int a = r2d_async_test_request(R2D_ASYNC_READ, 1000, 250, false);
    TEST_ASSERT_GREATER_THAN_INT(0, a);
    WAIT_P(p.running == 1, 2000);

    const int b = r2d_async_test_request(R2D_ASYNC_READ, 2000, 0, false);
    TEST_ASSERT_GREATER_THAN_INT(0, b);

    // a в работе, b в очереди — оба уже outstanding, хотя поток один.
    R2DAsyncPressure p = snap();
    TEST_ASSERT_EQUAL_INT(1, p.running);
    TEST_ASSERT_EQUAL_INT(1, p.queued);
    TEST_ASSERT_EQUAL_INT(2, p.outstanding);
    TEST_ASSERT_EQUAL_INT(2, p.live);
    TEST_ASSERT_EQUAL_INT(3000, (int)p.outstanding_bytes);

    WAIT_P(p.ready == 2 && p.running == 0 && p.queued == 0, 3000);
    TEST_ASSERT_EQUAL_INT(2, p.outstanding);
    TEST_ASSERT_EQUAL_INT(3000, (int)p.outstanding_bytes);

    R2DAsyncResult buf[4];
    int n = r2d_async_poll(buf, 4);
    TEST_ASSERT_EQUAL_INT(2, n);
    p = snap();
    TEST_ASSERT_EQUAL_INT(0, p.outstanding);
    TEST_ASSERT_EQUAL_INT(2, p.delivered);
    TEST_ASSERT_EQUAL_INT(0, (int)p.outstanding_bytes);

    for (int i = 0; i < n; ++i) r2d_async_release(buf[i].id);
    p = snap();
    TEST_ASSERT_EQUAL_INT(0, p.delivered);
    TEST_ASSERT_EQUAL_INT(0, p.live);

    int pending = -1, done = -1, failed = -1, cancelled = -1;
    long long bytes = -1;
    r2d_async_stats(&pending, &done, &failed, &cancelled, &bytes);
    TEST_ASSERT_EQUAL_INT(2, done);
    TEST_ASSERT_EQUAL_INT(0, failed);
    TEST_ASSERT_EQUAL_INT(0, cancelled);
    TEST_ASSERT_EQUAL_INT(3000, (int)bytes);
}

// ---------------------------------------------------------------------------
// 2. High/low watermark: worker стоит выше high, просыпается ниже low;
//    успешная работа НЕ помечается ошибкой из-за полной очереди.
// ---------------------------------------------------------------------------

static void test_ready_watermark_backpressure(void)
{
    begin(32, 1LL << 20, 2, 1LL << 20, 1, false);

    for (int i = 0; i < 6; ++i)
        TEST_ASSERT_GREATER_THAN_INT(0, r2d_async_test_request(R2D_ASYNC_READ, 10, 1, false));

    R2DAsyncPressure p = snap();
    WAIT_P(p.ready == 2 && p.queued == 4, 4000);
    p = snap();
    TEST_ASSERT_EQUAL_INT(6, p.live);
    TEST_ASSERT_EQUAL_INT(6, p.outstanding);

    // Выше high worker не идёт: за 80 мс очередь не выросла.
    SDL_Delay(80);
    p = snap();
    TEST_ASSERT_EQUAL_INT(2, p.ready);
    TEST_ASSERT_EQUAL_INT(4, p.queued);
    TEST_ASSERT_GREATER_THAN_INT(0, (int)p.backpressure_waits);

    // Один poll опускает очередь до low (1) — worker имеет право продолжить.
    R2DAsyncResult buf[4];
    TEST_ASSERT_EQUAL_INT(1, r2d_async_poll(buf, 1));
    r2d_async_release(buf[0].id);
    WAIT_P(p.ready == 2 && p.queued == 3, 4000);

    drain_and_release();
    p = snap();
    TEST_ASSERT_EQUAL_INT(0, p.live);
    TEST_ASSERT_EQUAL_INT(0, p.delivered);

    int pending = 0, done = 0, failed = 0, cancelled = 0;
    long long bytes = 0;
    r2d_async_stats(&pending, &done, &failed, &cancelled, &bytes);
    TEST_ASSERT_EQUAL_INT(6, done);
    TEST_ASSERT_EQUAL_INT(0, failed);      // главный регресс: не failed
    TEST_ASSERT_EQUAL_INT(0, cancelled);
}

// ---------------------------------------------------------------------------
// 3. Бюджет max_jobs: producer получает явный -1, память не растёт,
//    после poll/release бюджет снова доступен.
// ---------------------------------------------------------------------------

static void test_admission_budget_and_recovery(void)
{
    begin(3, 1LL << 20, 1, 1LL << 20, 0, false);

    int ids[3];
    for (int i = 0; i < 3; ++i) {
        ids[i] = r2d_async_test_request(R2D_ASYNC_READ, 100, 0, false);
        TEST_ASSERT_GREATER_THAN_INT(0, ids[i]);
    }
    WAIT_P(p.ready == 1 && p.queued == 2, 3000);

    // Четвёртое задание не помещается: budget bounded, без вечного ожидания.
    TEST_ASSERT_EQUAL_INT(-1, r2d_async_test_request(R2D_ASYNC_READ, 100, 0, false));
    R2DAsyncPressure p = snap();
    TEST_ASSERT_EQUAL_INT(3, p.live);
    TEST_ASSERT_EQUAL_INT(3, p.outstanding);

    // Отмена из очереди освобождает outstanding, но результат ещё ждёт poll.
    TEST_ASSERT_TRUE(r2d_async_cancel(ids[2]));
    p = snap();
    TEST_ASSERT_EQUAL_INT(1, p.cancelled_pending);
    TEST_ASSERT_EQUAL_INT(2, p.outstanding);
    TEST_ASSERT_EQUAL_INT(3, p.live);

    // Один poll + release освобождает место в live-бюджете.
    R2DAsyncResult buf[4];
    TEST_ASSERT_EQUAL_INT(1, r2d_async_poll(buf, 1));
    r2d_async_release(buf[0].id);
    p = snap();
    TEST_ASSERT_EQUAL_INT(2, p.live);       // queued/running + cancelled_pending
    TEST_ASSERT_GREATER_THAN_INT(0, r2d_async_test_request(R2D_ASYNC_READ, 100, 0, false));

    drain_and_release();
    p = snap();
    TEST_ASSERT_EQUAL_INT(0, p.live);
    TEST_ASSERT_EQUAL_INT(0, p.delivered);
}

// ---------------------------------------------------------------------------
// 3b. Бюджет max_bytes: байты считаются по оценке, пики не превышают бюджет,
//     одно задание больше бюджета отклоняется сразу (без вечного ожидания).
// ---------------------------------------------------------------------------

static void test_byte_budget_and_peaks(void)
{
    begin(64, 300, 8, 1LL << 20, 4, false);

    int admitted = 0;
    int rejected = 0;
    for (int i = 0; i < 10; ++i) {
        const int id = r2d_async_test_request(R2D_ASYNC_READ, 100, 40, false);
        if (id > 0) admitted++;
        else rejected++;
    }
    // 100 байт на задание, бюджет 300 — ровно три невыданных задания.
    TEST_ASSERT_EQUAL_INT(3, admitted);
    TEST_ASSERT_EQUAL_INT(7, rejected);

    R2DAsyncPressure p = snap();
    TEST_ASSERT_LESS_OR_EQUAL_INT(3, p.live);
    TEST_ASSERT_LESS_OR_EQUAL_INT(300, (int)p.live_bytes);
    TEST_ASSERT_LESS_OR_EQUAL_INT(300, (int)p.peak_live_bytes);
    TEST_ASSERT_EQUAL_INT((int)p.live_bytes, (int)p.peak_live_bytes);

    // Задание больше всего бюджета не ждёт вечно: явный отказ.
    TEST_ASSERT_EQUAL_INT(-1, r2d_async_test_request(R2D_ASYNC_READ, 500, 0, false));

    drain_and_release();
    TEST_ASSERT_EQUAL_INT(0, snap().live);
}

// ---------------------------------------------------------------------------
// 4. block_producer: не-главный producer спит на condition и просыпается,
//    когда главный поток разгружает бюджет. Главный не блокируется (см. тест 3).
// ---------------------------------------------------------------------------

typedef struct ProducerProbe {
    int           id;
    SDL_AtomicInt done;
} ProducerProbe;

static int SDLCALL producer_main(void *arg)
{
    ProducerProbe *probe = (ProducerProbe *)arg;
    probe->id = r2d_async_test_request(R2D_ASYNC_READ, 50, 0, false);
    SDL_SetAtomicInt(&probe->done, 1);
    return 0;
}

static void test_block_producer_thread(void)
{
    begin(1, 1LL << 20, 1, 1LL << 20, 0, true);

    const int a = r2d_async_test_request(R2D_ASYNC_READ, 10, 400, false);
    TEST_ASSERT_GREATER_THAN_INT(0, a);
    WAIT_P(p.running == 1 && p.ready == 0, 2000);

    ProducerProbe probe;
    memset(&probe, 0, sizeof probe);
    probe.id = -1;
    SDL_SetAtomicInt(&probe.done, 0);
    SDL_Thread *thread = SDL_CreateThread(producer_main, "producer", &probe);
    TEST_ASSERT_NOT_NULL(thread);

    // Producer должен заснуть на condition, а не вернуть -1 и не крутиться.
    WAIT_P(p.backpressure_waits >= 1, 2000);
    SDL_Delay(50);
    TEST_ASSERT_EQUAL_INT(0, SDL_GetAtomicInt(&probe.done));

    WAIT_P(p.ready == 1, 3000);
    R2DAsyncResult buf[4];
    TEST_ASSERT_EQUAL_INT(1, r2d_async_poll(buf, 4));
    r2d_async_release(buf[0].id);

    for (int i = 0; i < 3000 && !SDL_GetAtomicInt(&probe.done); ++i) SDL_Delay(1);
    SDL_WaitThread(thread, NULL);
    TEST_ASSERT_EQUAL_INT(1, SDL_GetAtomicInt(&probe.done));
    TEST_ASSERT_GREATER_THAN_INT(0, probe.id);

    drain_and_release();
    TEST_ASSERT_EQUAL_INT(0, snap().live);
}

// ---------------------------------------------------------------------------
// 5. Отмена: running, ready и «чужой» id. Buffers освобождаются ровно раз.
// ---------------------------------------------------------------------------

static void test_cancel_paths(void)
{
    begin(16, 1LL << 20, 2, 1LL << 20, 0, false);

    const int running = r2d_async_test_request(R2D_ASYNC_IMAGE, 4096, 300, false);
    TEST_ASSERT_GREATER_THAN_INT(0, running);
    WAIT_P(p.running == 1, 2000);
    TEST_ASSERT_TRUE(r2d_async_cancel(running));
    WAIT_P(p.cancelled_pending == 1, 3000);

    R2DAsyncResult buf[4];
    TEST_ASSERT_EQUAL_INT(1, r2d_async_poll(buf, 4));
    TEST_ASSERT_TRUE(buf[0].cancelled);
    TEST_ASSERT_FALSE(buf[0].ok);
    r2d_async_release(buf[0].id);

    // Отмена уже готового (READY → CANCELLED) до poll.
    const int ready = r2d_async_test_request(R2D_ASYNC_READ, 64, 50, false);
    TEST_ASSERT_GREATER_THAN_INT(0, ready);
    WAIT_P(p.ready == 1, 3000);
    TEST_ASSERT_TRUE(r2d_async_cancel(ready));
    R2DAsyncPressure p = snap();
    TEST_ASSERT_EQUAL_INT(0, p.ready);
    TEST_ASSERT_EQUAL_INT(1, p.cancelled_pending);
    TEST_ASSERT_EQUAL_INT(1, r2d_async_poll(buf, 4));
    TEST_ASSERT_TRUE(buf[0].cancelled);
    r2d_async_release(buf[0].id);

    // Ошибка задания — это failed, но не cancelled.
    const int failing = r2d_async_test_request(R2D_ASYNC_READ, 32, 10, true);
    TEST_ASSERT_GREATER_THAN_INT(0, failing);
    WAIT_P(p.ready == 1, 3000);
    TEST_ASSERT_EQUAL_INT(1, r2d_async_poll(buf, 4));
    TEST_ASSERT_FALSE(buf[0].ok);
    TEST_ASSERT_FALSE(buf[0].cancelled);
    TEST_ASSERT_TRUE(buf[0].error[0] != '\0');
    r2d_async_release(buf[0].id);

    TEST_ASSERT_FALSE(r2d_async_cancel(999999));
    p = snap();
    TEST_ASSERT_EQUAL_INT(0, p.live);
    TEST_ASSERT_EQUAL_INT(0, p.delivered);

    int pending = 0, done = 0, failed = 0, cancelled = 0;
    long long bytes = 0;
    r2d_async_stats(&pending, &done, &failed, &cancelled, &bytes);
    // READY-задание успело завершиться до отмены — done честно равен 1.
    TEST_ASSERT_EQUAL_INT(1, done);
    TEST_ASSERT_EQUAL_INT(1, failed);
    TEST_ASSERT_EQUAL_INT(2, cancelled);
}

// ---------------------------------------------------------------------------
// 6. Реальные файлы: оценка байт (текст / пиксели width*height*4) и take_text.
// ---------------------------------------------------------------------------

static void test_file_bytes_and_pixel_estimate(void)
{
    begin(16, 4LL << 20, 4, 4LL << 20, 1, false);
    TEST_ASSERT_TRUE(g_dir[0] != '\0');

    // --- текст: est = размер файла ---
    char text_path[1200];
    SDL_snprintf(text_path, sizeof text_path, "%stext_%d.bin", g_dir, g_serial++);
    FILE *f = fopen(text_path, "wb");
    TEST_ASSERT_NOT_NULL(f);
    for (int i = 0; i < 1000; ++i) fputc('a' + (i % 26), f);
    fclose(f);

    const int read_id = r2d_async_request(NULL, text_path, R2D_ASYNC_READ);
    TEST_ASSERT_GREATER_THAN_INT(0, read_id);
    WAIT_P(p.ready == 1, 3000);
    R2DAsyncPressure p = snap();
    TEST_ASSERT_EQUAL_INT(1000, (int)p.ready_bytes);

    R2DAsyncResult buf[4];
    TEST_ASSERT_EQUAL_INT(1, r2d_async_poll(buf, 4));
    TEST_ASSERT_TRUE(buf[0].ok);
    TEST_ASSERT_EQUAL_INT(1000, (int)buf[0].size);
    size_t text_size = 0;
    char *text = r2d_async_take_text(buf[0].id, &text_size);
    TEST_ASSERT_NOT_NULL(text);
    TEST_ASSERT_EQUAL_INT(1000, (int)text_size);
    TEST_ASSERT_EQUAL_INT('a', text[0]);
    TEST_ASSERT_EQUAL_INT('a' + (999 % 26), text[999]);
    free(text);

    // --- картинка BMP 4x4: после декода est = 4*4*4 = 64 байта ---
    char bmp_path[1200];
    SDL_snprintf(bmp_path, sizeof bmp_path, "%simg_%d.bmp", g_dir, g_serial++);
    f = fopen(bmp_path, "wb");
    TEST_ASSERT_NOT_NULL(f);
    uint8_t bmp[54 + 4 * 12];
    memset(bmp, 0, sizeof bmp);
    const uint32_t file_size = (uint32_t)sizeof bmp;
    bmp[0] = 'B'; bmp[1] = 'M';
    bmp[2] = (uint8_t)(file_size); bmp[3] = (uint8_t)(file_size >> 8);
    bmp[4] = (uint8_t)(file_size >> 16); bmp[5] = (uint8_t)(file_size >> 24);
    bmp[10] = 54;                       // pixel data offset
    bmp[14] = 40;                       // DIB header size
    bmp[18] = 4;                        // width
    bmp[22] = 4;                        // height
    bmp[26] = 1;                        // planes
    bmp[28] = 24;                       // bpp
    for (size_t i = 54; i < sizeof bmp; ++i) bmp[i] = (uint8_t)i;
    TEST_ASSERT_EQUAL_INT((int)sizeof bmp, (int)fwrite(bmp, 1, sizeof bmp, f));
    fclose(f);

    const int img_id = r2d_async_request(NULL, bmp_path, R2D_ASYNC_IMAGE);
    TEST_ASSERT_GREATER_THAN_INT(0, img_id);
    WAIT_P(p.ready == 1 && p.ready_bytes == 64, 4000);
    p = snap();
    TEST_ASSERT_EQUAL_INT(64, (int)p.outstanding_bytes);

    TEST_ASSERT_EQUAL_INT(1, r2d_async_poll(buf, 4));
    TEST_ASSERT_TRUE(buf[0].ok);
    TEST_ASSERT_EQUAL_INT(4, buf[0].width);
    TEST_ASSERT_EQUAL_INT(4, buf[0].height);
    r2d_async_release(buf[0].id);

    SDL_RemovePath(text_path);
    SDL_RemovePath(bmp_path);
    TEST_ASSERT_EQUAL_INT(0, snap().live);
}

// ---------------------------------------------------------------------------
// 7. Shutdown с непустыми очередями не дедлочится и освобождает всё.
// ---------------------------------------------------------------------------

static void test_shutdown_with_pending_work(void)
{
    begin(32, 1LL << 20, 32, 1LL << 20, 16, false);
    for (int i = 0; i < 5; ++i)
        TEST_ASSERT_GREATER_THAN_INT(0, r2d_async_test_request(R2D_ASYNC_READ, 10, 150, false));
    WAIT_P(p.running == 1 || p.ready >= 1, 2000);

    const Uint64 start = SDL_GetTicks();
    r2d_async_shutdown();
    TEST_ASSERT_LESS_THAN_UINT32(3000, (Uint32)(SDL_GetTicks() - start));

    R2DAsyncPressure p = snap();
    TEST_ASSERT_EQUAL_INT(0, p.workers);
    TEST_ASSERT_EQUAL_INT(0, p.live);
    TEST_ASSERT_EQUAL_INT(0, p.delivered);

    // Возвращаем модуль в рабочее состояние для tearDown/следующих тестов.
    TEST_ASSERT_TRUE(r2d_async_init(NULL));
}

int main(void)
{
    char *pref = SDL_GetPrefPath("r2d", "async_backpressure_test");
    if (pref) {
        SDL_snprintf(g_dir, sizeof g_dir, "%s", pref);
        SDL_free(pref);
    } else {
        char *cwd = SDL_GetCurrentDirectory();
        if (cwd) {
            SDL_snprintf(g_dir, sizeof g_dir, "%s/", cwd);
            SDL_free(cwd);
        }
    }
    g_serial = 0;

    UNITY_BEGIN();
    RUN_TEST(test_state_accounting);
    RUN_TEST(test_ready_watermark_backpressure);
    RUN_TEST(test_admission_budget_and_recovery);
    RUN_TEST(test_byte_budget_and_peaks);
    RUN_TEST(test_block_producer_thread);
    RUN_TEST(test_cancel_paths);
    RUN_TEST(test_file_bytes_and_pixel_estimate);
    RUN_TEST(test_shutdown_with_pending_work);
    return UNITY_END();
}
