// ===========================================================================
// Реестр звуков и бюджет голосов (§20-22) — тест с настоящим SDL3_mixer.
//
// Проверяет то, что нельзя проверить "на глаз":
//   * можно загрузить БОЛЬШЕ 128 ассетов (старый R2D_AUDIO_MAX_SOUNDS=128
//     был пределом контента, а не голосов);
//   * повторная загрузка того же пути возвращает тот же стабильный id;
//   * поиск по пути идёт через хэш-индекс и находит каждый загруженный файл;
//   * бюджет голосов — рантайм-настройка: уменьшение останавливает лишние
//     каналы, play() возвращает -1 при бюджете 0, статистика видит stealing.
//
// Звук выводится в dummy-драйвер SDL: тест не требует аудиоустройства и не
// шумит. spatial/payload подменены заглушками — тест не тянет Steam Audio и
// весь движок; audio.c проверяется как есть.
// ===========================================================================
#include "audio.h"
#include "unity.h"

#include <SDL3/SDL.h>

#include <stdio.h>
#include <string.h>

// Журнал движка (R2D_LOG в audio.c) смотрит на этот флаг.
bool r2d_log_stderr = false;

void setUp(void) {}
void tearDown(void) {}

// --- Заглушки внешних зависимостей audio.c ---------------------------------
// spatial (Steam Audio) тесту не нужен: включаем "модель без HRTF".
void *r2d_audio_spatial_create(int rate, int channels)
{ (void)rate; (void)channels; return NULL; }
void r2d_audio_spatial_destroy(void *bank) { (void)bank; }
void *r2d_audio_spatial_channel(void *bank, int channel)
{ (void)bank; (void)channel; return NULL; }
void r2d_audio_spatial_params(void *channel, bool enabled, bool hrtf,
                              float right, float up, float back, float cutoff)
{ (void)channel; (void)enabled; (void)hrtf; (void)right; (void)up; (void)back; (void)cutoff; }
void r2d_audio_spatial_reset(void *channel) { (void)channel; }
void r2d_audio_spatial_process(void *channel, const SDL_AudioSpec *spec,
                               float *pcm, int samples)
{ (void)channel; (void)spec; (void)pcm; (void)samples; }
bool r2d_audio_spatial_hrtf(void *bank) { (void)bank; return false; }

// Все звуки пишутся на диск: VFS груза не задействован.
bool r2d_vfs_has(const char *path) { (void)path; return false; }
uint8_t *r2d_vfs_read(const char *path, size_t *out_size)
{ (void)path; if (out_size) *out_size = 0; return NULL; }

// --- Минимальный WAV: 8 кГц, моно, 16 бит, 800 сэмплов тишины --------------
static void put_u16(uint8_t *p, uint16_t v)
{
    p[0] = (uint8_t)(v & 0xff);
    p[1] = (uint8_t)(v >> 8);
}

static void put_u32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v & 0xff);
    p[1] = (uint8_t)((v >> 8) & 0xff);
    p[2] = (uint8_t)((v >> 16) & 0xff);
    p[3] = (uint8_t)((v >> 24) & 0xff);
}

static bool write_wav(const char *path)
{
    enum { SAMPLES = 800, BYTES = SAMPLES * 2 };
    uint8_t wav[44 + BYTES];
    memcpy(wav, "RIFF", 4);
    put_u32(wav + 4, 36u + BYTES);
    memcpy(wav + 8, "WAVEfmt ", 8);
    put_u32(wav + 16, 16);          // размер fmt-чанка
    put_u16(wav + 20, 1);           // PCM
    put_u16(wav + 22, 1);           // моно
    put_u32(wav + 24, 8000);        // частота
    put_u32(wav + 28, 16000);       // байт/сек
    put_u16(wav + 32, 2);           // block align
    put_u16(wav + 34, 16);          // бит на сэмпл
    memcpy(wav + 36, "data", 4);
    put_u32(wav + 40, BYTES);
    memset(wav + 44, 0, BYTES);

    FILE *f = fopen(path, "wb");
    if (!f) return false;
    const bool ok = fwrite(wav, 1, sizeof wav, f) == sizeof wav;
    fclose(f);
    return ok;
}

static void test_more_than_128_assets_and_voice_budget(void)
{
    SDL_SetHint(SDL_HINT_AUDIO_DRIVER, "dummy");
    TEST_ASSERT_TRUE(SDL_Init(SDL_INIT_AUDIO));

    char *dir = SDL_GetPrefPath("russiano2d", "audio_registry_stress");
    TEST_ASSERT_NOT_NULL(dir);

    R2DAudio a;
    TEST_ASSERT_TRUE_MESSAGE(r2d_audio_init(&a), "аудио не поднялось (dummy)");
    TEST_ASSERT_TRUE(a.ready);
    TEST_ASSERT_EQUAL_INT(R2D_DEFAULT_AUDIO_VOICES, r2d_audio_voice_budget(&a));

    // 200 > старого предела 128: реестр должен вырасти, а не отказать.
    enum { N = 200 };
    char paths[N][512];
    int ids[N];
    for (int i = 0; i < N; ++i) {
        SDL_snprintf(paths[i], sizeof paths[i], "%sstress_%03d.wav", dir, i);
        TEST_ASSERT_TRUE_MESSAGE(write_wav(paths[i]), paths[i]);
        ids[i] = r2d_audio_load(&a, paths[i]);
        TEST_ASSERT_EQUAL_INT_MESSAGE(i, ids[i], paths[i]);
    }
    TEST_ASSERT_EQUAL_INT(N, r2d_audio_sound_count(&a));

    // Id стабилен, повторная загрузка не создаёт новый слот, find находит все.
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_load(&a, paths[0]));
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_find(&a, paths[0]));
    TEST_ASSERT_EQUAL_INT(N / 2, r2d_audio_find(&a, paths[N / 2]));
    TEST_ASSERT_EQUAL_INT(N - 1, r2d_audio_find(&a, paths[N - 1]));
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_find(&a, "нет-такого-пути.wav"));
    TEST_ASSERT_EQUAL_STRING(paths[N - 1], r2d_audio_name(&a, N - 1));
    TEST_ASSERT_EQUAL_INT(N, r2d_audio_sound_count(&a));

    R2DAudioVoiceStats st;
    r2d_audio_stats(&a, &st);
    TEST_ASSERT_EQUAL_INT(N, st.sound_count);
    TEST_ASSERT_EQUAL_INT(R2D_DEFAULT_AUDIO_VOICES, st.budget);

    // Бюджет — рантайм-настройка, а не предел ассетов: 4 голоса.
    r2d_audio_set_voice_budget(&a, 4);
    TEST_ASSERT_EQUAL_INT(4, r2d_audio_voice_budget(&a));
    for (int i = 0; i < 6; ++i) {
        const int ch = r2d_audio_play(&a, i, 0.5f, 0.0f, 0, 10);
        TEST_ASSERT_TRUE_MESSAGE(ch >= 0 && ch < 4, "канал вне бюджета");
    }
    TEST_ASSERT_EQUAL_INT(4, r2d_audio_active_channels(&a));
    r2d_audio_stats(&a, &st);
    TEST_ASSERT_EQUAL_INT(4, st.active);
    TEST_ASSERT_TRUE(st.peak >= 4);
    TEST_ASSERT_TRUE(st.stolen_total >= 2);
    r2d_audio_frame_tick(&a);
    r2d_audio_stats(&a, &st);
    TEST_ASSERT_TRUE(st.stolen_last_frame >= 2);

    // Бюджет 0 — честный отказ и тишина, а не «играет мимо бюджета».
    r2d_audio_set_voice_budget(&a, 0);
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_active_channels(&a));
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_play(&a, 0, 1.0f, 0.0f, 0, 100));
    // Зажим диапазона: больше ёмкости не принимаем.
    r2d_audio_set_voice_budget(&a, R2D_AUDIO_CHANNELS + 1000);
    TEST_ASSERT_EQUAL_INT(R2D_AUDIO_CHANNELS, r2d_audio_voice_budget(&a));

    r2d_audio_shutdown(&a);
    for (int i = 0; i < N; ++i) SDL_RemovePath(paths[i]);
    SDL_free(dir);
    SDL_QuitSubSystem(SDL_INIT_AUDIO);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_more_than_128_assets_and_voice_budget);
    return UNITY_END();
}
