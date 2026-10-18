// ===========================================================================
// Тест кольца GPU-fence профайлера (src/profile.c).
//
// Профайлер обязан делать все вызовы SDL_GPU только на главном потоке: репорт
// BASHNYA 2026-10-18 — падение exit 139 на потоке r2d_gpu_prof в
// METAL_QueryFence (src/profile.c опрашивал fence из отдельного потока). Тест
// проверяет именно state machine слотов на подменённом fence-слое: настоящие
// SDL_GPUFence и GPU-устройство не нужны.
//
// profile.c собирается с -DR2D_PROFILE_TEST; тест предоставляет
// r2d__prof_test_signaled/release вместо SDL_QueryGPUFence/ReleaseGPUFence.
// Проверяется:
//   * capacity/занятость слотов и повторное использование;
//   * сигнальный fence даёт неотрицательный замер и освобождается ровно раз;
//   * поздний сигнал (GPU отстал больше чем на capacity кадров) — fence
//     отпускается без замера, утечки нет;
//   * shutdown с несигнальными fence'ами освобождает все, повторный shutdown
//     безопасен;
//   * выключенный профайлер fence не копит (освобождает сразу);
//   * ни один fence не освобождается дважды.
//
// Запуск: build/tests/r2d_profile_fence_test (ctest: r2d_profile_fence_test)
// ===========================================================================

#include "profile.h"
#include "unity.h"

#include <SDL3/SDL.h>

#include <stdint.h>
#include <string.h>

// Подменённый fence-слой: fence — это непрозрачный номер 1..FAKE_MAX, тест
// сам решает, когда он «сигнален», и считает освобождения.
#define FAKE_MAX 16

static bool g_fake_signaled[FAKE_MAX];
static int  g_fake_releases[FAKE_MAX];
static int  g_fake_created;

static SDL_GPUFence *fake_fence(void)
{
    TEST_ASSERT_LESS_THAN_INT_MESSAGE(FAKE_MAX, g_fake_created, "fake fence pool");
    const int id = g_fake_created++;
    g_fake_signaled[id] = false;
    g_fake_releases[id] = 0;
    return (SDL_GPUFence *)(uintptr_t)(id + 1);
}

static int fake_id(SDL_GPUFence *fence)
{
    const uintptr_t value = (uintptr_t)fence;
    if (value == 0 || value > (uintptr_t)FAKE_MAX) return -1;
    return (int)(value - 1);
}

static void fake_reset(void)
{
    memset(g_fake_signaled, 0, sizeof(g_fake_signaled));
    memset(g_fake_releases, 0, sizeof(g_fake_releases));
    g_fake_created = 0;
}

bool r2d__prof_test_signaled(SDL_GPUFence *fence)
{
    const int id = fake_id(fence);
    return id >= 0 && g_fake_signaled[id];
}

void r2d__prof_test_release(SDL_GPUFence *fence)
{
    const int id = fake_id(fence);
    if (id >= 0) g_fake_releases[id]++;
}

// Тестовые хуки из profile.c (только при R2D_PROFILE_TEST).
extern int r2d__prof_test_slots_in_use(void);
extern int r2d__prof_test_slot_capacity(void);

void setUp(void) {}
void tearDown(void) {}

// Общий старт: чистое кольцо, включённый профайлер, «устройство»-заглушка.
static void start_fresh(void)
{
    fake_reset();
    r2d_prof_set_enabled(false);   // гарантированно сбрасывает окно
    r2d_prof_set_enabled(true);
    r2d_prof_reset();
    r2d_prof_gpu_init((SDL_GPUDevice *)(uintptr_t)0x1);
}

static void test_capacity_and_submit(void)
{
    start_fresh();
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, r2d__prof_test_slot_capacity(),
                                  "кольцо из четырёх слотов");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d__prof_test_slots_in_use(),
                                  "свежее кольцо пусто");

    SDL_GPUFence *f0 = fake_fence();
    SDL_GPUFence *f1 = fake_fence();
    r2d_prof_gpu_submit(f0);
    r2d_prof_gpu_submit(f1);
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, r2d__prof_test_slots_in_use(),
                                  "несигнальные fence'ы занимают слоты");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, g_fake_releases[0],
                                  "несигнальный fence не освобождается заранее");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, g_fake_releases[1],
                                  "второй несигнальный fence тоже не освобождён");
}

static void test_signal_records_and_releases(void)
{
    start_fresh();
    SDL_GPUFence *f = fake_fence();
    r2d_prof_gpu_submit(f);
    SDL_Delay(2);              // честный ненулевой интервал submit → сигнал
    g_fake_signaled[0] = true;

    r2d_prof_frame_end(16.0f);

    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d__prof_test_slots_in_use(),
                                  "сигнальный fence освобождает слот");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, g_fake_releases[0],
                                  "сигнальный fence освобождён ровно один раз");
    TEST_ASSERT_TRUE_MESSAGE(r2d_prof_gpu_available(), "замер доступен");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_prof_gpu_frames(),
                                  "кадр с замером попал в окно");
    TEST_ASSERT_TRUE_MESSAGE(r2d_prof_gpu_ms() >= 0.0f,
                             "GPU ms неотрицателен после сигнала fence");
    TEST_ASSERT_TRUE_MESSAGE(r2d_prof_gpu_ms() > 0.0f,
                             "интервал submit → сигнал измерен (не ноль)");
}

static void test_slot_reuse(void)
{
    start_fresh();
    SDL_GPUFence *first = fake_fence();
    r2d_prof_gpu_submit(first);
    g_fake_signaled[0] = true;
    r2d_prof_frame_end(16.0f);
    TEST_ASSERT_EQUAL_INT(0, r2d__prof_test_slots_in_use());

    SDL_GPUFence *second = fake_fence();
    r2d_prof_gpu_submit(second);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d__prof_test_slots_in_use(),
                                  "освобождённый слот переиспользуется");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, g_fake_releases[1],
                                  "новый fence ещё не освобождён");
}

static void test_late_signal_expiry(void)
{
    start_fresh();
    const int capacity = r2d__prof_test_slot_capacity();
    for (int i = 0; i < capacity; i++) {
        SDL_GPUFence *f = fake_fence();
        r2d_prof_gpu_submit(f);
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(capacity, r2d__prof_test_slots_in_use(),
                                  "все слоты заняты несигнальными fence'ами");

    // GPU отстал больше чем на capacity кадров: новый кадр не измеряется, но
    // его fence отпускается сразу — утечки нет.
    SDL_GPUFence *overflow = fake_fence();
    r2d_prof_gpu_submit(overflow);
    TEST_ASSERT_EQUAL_INT_MESSAGE(capacity, r2d__prof_test_slots_in_use(),
                                  "переполнение не расширяет кольцо");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, g_fake_releases[capacity],
                                  "fence переполненного кадра освобождён сразу");

    // Теперь сигналят все ранее занятые слоты: frame_end забирает их разом.
    for (int i = 0; i < capacity; i++) g_fake_signaled[i] = true;
    r2d_prof_frame_end(16.0f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d__prof_test_slots_in_use(),
                                  "поздние fence'ы забраны и освобождены");
    for (int i = 0; i < capacity; i++) {
        TEST_ASSERT_EQUAL_INT_MESSAGE(1, g_fake_releases[i],
                                      "каждый поздний fence освобождён один раз");
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_prof_gpu_frames(),
                                  "поздний замер всё равно попал в окно");
}

static void test_shutdown_outstanding(void)
{
    start_fresh();
    SDL_GPUFence *f0 = fake_fence();
    SDL_GPUFence *f1 = fake_fence();
    r2d_prof_gpu_submit(f0);
    r2d_prof_gpu_submit(f1);
    TEST_ASSERT_EQUAL_INT(2, r2d__prof_test_slots_in_use());

    r2d_prof_gpu_shutdown();

    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d__prof_test_slots_in_use(),
                                  "shutdown очищает кольцо");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, g_fake_releases[0],
                                  "несигнальный fence кадра 0 освобождён");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, g_fake_releases[1],
                                  "несигнальный fence кадра 1 освобождён");
    TEST_ASSERT_FALSE_MESSAGE(r2d_prof_gpu_available(),
                              "после shutdown GPU-замер недоступен");
    TEST_ASSERT_TRUE_MESSAGE(r2d_prof_gpu_ms() < 0.0f,
                             "после shutdown данных нет");

    r2d_prof_gpu_shutdown();   // повторный вызов безопасен
    TEST_ASSERT_EQUAL_INT(1, g_fake_releases[0]);
    TEST_ASSERT_EQUAL_INT(1, g_fake_releases[1]);
}

static void test_disabled_path(void)
{
    start_fresh();
    r2d_prof_set_enabled(false);
    SDL_GPUFence *f = fake_fence();
    r2d_prof_gpu_submit(f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d__prof_test_slots_in_use(),
                                  "выключенный профайлер не копит fence'ы");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, g_fake_releases[0],
                                  "выключенный профайлер отпускает fence сразу");
    r2d_prof_set_enabled(true);
}

static void test_no_double_release(void)
{
    start_fresh();
    // Два раунда: сигнал в frame_end, затем повторный submit и shutdown —
    // каждый fence должен быть освобождён ровно один раз.
    SDL_GPUFence *f0 = fake_fence();
    r2d_prof_gpu_submit(f0);
    g_fake_signaled[0] = true;
    r2d_prof_frame_end(16.0f);

    SDL_GPUFence *f1 = fake_fence();
    r2d_prof_gpu_submit(f1);
    r2d_prof_gpu_shutdown();

    TEST_ASSERT_EQUAL_INT_MESSAGE(1, g_fake_releases[0], "первый fence: одно освобождение");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, g_fake_releases[1], "второй fence: одно освобождение");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_capacity_and_submit);
    RUN_TEST(test_signal_records_and_releases);
    RUN_TEST(test_slot_reuse);
    RUN_TEST(test_late_signal_expiry);
    RUN_TEST(test_shutdown_outstanding);
    RUN_TEST(test_disabled_path);
    RUN_TEST(test_no_double_release);
    return UNITY_END();
}
