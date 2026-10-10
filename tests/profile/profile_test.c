// ===========================================================================
// Тест профайлера кадра (src/profile.c).
//
// Проверяет модель строк без GPU-устройства: CPU-зоны идут первыми, GPU-строка
// идёт после них и без устройства честно помечена как «н/д» (valid = false).
// Сам замер по fence здесь не проверить — для него нужно GPU-устройство и
// настоящий командный буфер, это покрывает агентский прогон движка
// (tools/agent_client.py: engine.profile()).
//
// Запуск: build/tests/r2d_profile_test
// ===========================================================================

#include "profile.h"

#include <SDL3/SDL.h>

#include <math.h>
#include <stdio.h>

static int failures = 0;

static void check(int condition, const char *message)
{
    printf("  ok   ");
    if (!condition) {
        printf("FAIL %s\n", message);
        failures++;
        return;
    }
    printf("%s\n", message);
}

// Один кадр: немного «работы» в двух зонах и закрытие кадра.
static void run_frame(float real_ms, float busy_ms)
{
    r2d_prof_begin(R2D_PROF_UPDATE);
    r2d_prof_begin(R2D_PROF_DRAW);
    if (busy_ms > 0.0f) SDL_Delay((Uint32)busy_ms);
    r2d_prof_end(R2D_PROF_DRAW);
    r2d_prof_end(R2D_PROF_UPDATE);
    r2d_prof_frame_end(real_ms);
}

int main(void)
{
    R2DProfileRow rows[R2D_PROF_ROW_MAX];

    // --- 1. Пустой профайлер -------------------------------------------------
    r2d_prof_reset();
    check(r2d_prof_rows(rows, R2D_PROF_ROW_MAX) == 0, "до первых кадров строк нет");
    check(r2d_prof_frames() == 0, "счётчик кадров пуст");
    check(r2d_prof_real_ms() == 0.0f && r2d_prof_frame_ms() == 0.0f,
          "времена пустого окна — нули");

    // --- 2. Кадры: CPU-зоны, затем GPU-строка --------------------------------
    for (int i = 0; i < 5; i++) run_frame(16.0f, 1.0f);

    const int count = r2d_prof_rows(rows, R2D_PROF_ROW_MAX);
    check(count == R2D_PROF_ROW_MAX, "строк ровно столько, сколько зон: CPU + GPU");
    check(r2d_prof_frames() == 5, "в окне пять кадров");

    check(rows[0].name && rows[0].name[0] && rows[0].gpu == false,
          "первая строка — CPU-зона");
    check(rows[R2D_PROF_UPDATE].name && rows[R2D_PROF_UPDATE].gpu == false &&
              rows[R2D_PROF_UPDATE].peak >= rows[R2D_PROF_UPDATE].ms,
          "пик не меньше среднего (CPU)");
    check(rows[R2D_PROF_COUNT].gpu == true, "GPU-строка идёт после CPU-зон");
    check(rows[R2D_PROF_COUNT].name && rows[R2D_PROF_COUNT].valid == false,
          "без GPU-устройства GPU-строка помечена как «н/д»");
    check(fabsf(rows[R2D_PROF_UPDATE].ms) > 0.0f, "CPU-зона что-то измерила");

    // Итог кадра и неучтённый остаток: сумма зон заметно меньше реального
    // времени, значит остаток положительный и близок к реальному.
    check(r2d_prof_real_ms() > 15.0f && r2d_prof_real_ms() < 17.0f,
          "реальное время кадра — из real_ms");
    float cpu_sum = 0.0f;
    for (int i = 0; i < R2D_PROF_COUNT; ++i) cpu_sum += rows[i].ms;
    check(cpu_sum > 0.0f && fabsf(r2d_prof_frame_ms() - cpu_sum) < 0.001f,
          "итог равен сумме измеренных CPU-зон");
    check(fabsf(r2d_prof_unaccounted_ms() - fmaxf(16.0f - cpu_sum, 0.0f)) < 0.001f,
          "остаток равен реальному времени минус зоны, минимум ноль");

    // --- 3. Обрезка и защита от мусора ---------------------------------------
    check(r2d_prof_rows(rows, 3) == 3, "max меньше числа зон — строк меньше");
    check(rows[0].gpu == false && rows[2].gpu == false, "обрезка не пускает GPU вперёд CPU");
    check(r2d_prof_rows(NULL, 4) == 0 && r2d_prof_rows(rows, 0) == 0,
          "NULL/нулевой max — ноль строк, без падения");

    // --- 4. GPU-замер без устройства: тихий «н/д» ----------------------------
    check(r2d_prof_gpu_available() == false, "без устройства GPU-замер недоступен");
    check(r2d_prof_gpu_ms() < 0.0f, "без замера gpu_ms отрицательный (нет данных)");
    check(r2d_prof_gpu_frames() == 0, "без замера кадров с GPU-временем нет");
    check(r2d_prof_gpu_note() != NULL, "пояснение для оверлея не NULL");
    r2d_prof_gpu_init(NULL);
    r2d_prof_gpu_submit(NULL);      // кадр без GPU-работы — не должно падать
    r2d_prof_gpu_shutdown();
    r2d_prof_gpu_shutdown();        // повторный вызов безопасен
    check(r2d_prof_rows(rows, R2D_PROF_ROW_MAX) == R2D_PROF_ROW_MAX,
          "после shutdown модель строк не сломалась");

    // --- 5. Окно наблюдения не растёт бесконечно -----------------------------
    // 200 кадров при окне в 120: счётчик должен упереться в размер окна.
    for (int i = 0; i < 200; i++) run_frame(8.0f, 0.0f);
    check(r2d_prof_frames() == 120, "окно ограничено 120 кадрами");

    // --- 6. Выключенный профайлер ничего не считает --------------------------
    r2d_prof_set_enabled(false);
    check(r2d_prof_enabled() == false, "профайлер выключен");
    run_frame(16.0f, 1.0f);
    check(r2d_prof_frames() == 0 && r2d_prof_rows(rows, R2D_PROF_ROW_MAX) == 0,
          "выключенный профайлер не копит кадры");
    r2d_prof_set_enabled(true);
    check(r2d_prof_enabled() == true && r2d_prof_frames() == 0,
          "включение сбрасывает окно");

    if (failures) printf("ПРОВАЛЕНО: %d\n", failures);
    else printf("Все проверки пройдены\n");
    return failures ? 1 : 0;
}
