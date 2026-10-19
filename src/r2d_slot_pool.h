// ===========================================================================
// Переиспользуемый пул слотов с поколениями — src/r2d_slot_pool.h
//
// Зачем: десятки подсистем движка хранили ресурсы в массивах фиксированного
// размера и сканировали ВСЮ ёмкость, чтобы найти свободный слот. Из-за этого
// «лимит» был не бюджетом, а размером C-массива: текстура #257 не могла
// существовать, а создание тела при 50 живых телах всё равно обходило 8192
// слота.
//
// Пул даёт три вещи без нового объектного слоя и без ECS:
//
//   * O(1) выделение и освобождение через freelist;
//   * стабильный числовой id = индекс слота (публичный API не меняется);
//   * generation — старый id после переиспользования слота отличается от
//     нового владельца, поэтому «протухшая» ссылка распознаётся;
//   * dense-список живых слотов — обход стоит O(живых), а не O(ёмкости).
//
// Это инфраструктура ресурсов, а не игровая модель: игра по-прежнему видит
// обычные целые id и не знает про поколения.
// ===========================================================================
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** «Слота нет»: результат неудачного alloc и значение next_free в конце цепи. */
#define R2D_SLOT_NONE UINT32_MAX

typedef struct R2DSlot {
    uint32_t generation;   // растёт при переиспользовании слота
    uint32_t dense_index;  // позиция в dense[] для живого слота
    uint32_t next_free;    // следующий свободный слот (R2D_SLOT_NONE — конец)
    bool     alive;
} R2DSlot;

typedef struct R2DSlotPool {
    R2DSlot  *slots;
    uint32_t *dense;         // живые индексы слотов, [0, alive_count)
    uint32_t *dense_to_slot; // обратный индекс: dense[i] -> ...

    uint32_t slot_count;     // сколько слотов уже выдавалось (верхняя граница)
    uint32_t slot_capacity;
    uint32_t alive_count;
    uint32_t dense_capacity;
    uint32_t free_head;
} R2DSlotPool;

// --- Жизненный цикл ---------------------------------------------------------
// init выделяет начальную ёмкость. Ноль допустим: первый alloc вырастет сам.
bool r2d_slot_pool_init(R2DSlotPool *pool, uint32_t initial_capacity);
void r2d_slot_pool_shutdown(R2DSlotPool *pool);
// Довести ёмкость до capacity (идемпотентно). false — нет памяти/переполнение.
bool r2d_slot_pool_reserve(R2DSlotPool *pool, uint32_t capacity);

// --- Слоты ------------------------------------------------------------------
// Возвращает индекс слота или R2D_SLOT_NONE. Поколение нового слота на единицу
// больше прежнего: старый (slot, generation) перестаёт быть валидным.
uint32_t r2d_slot_pool_alloc(R2DSlotPool *pool);
// Освободить живой слот. false — слот уже мёртв/вне пула.
bool r2d_slot_pool_free(R2DSlotPool *pool, uint32_t slot);
bool r2d_slot_pool_alive(const R2DSlotPool *pool, uint32_t slot);
uint32_t r2d_slot_pool_generation(const R2DSlotPool *pool, uint32_t slot);
// Проверка протухшей ссылки: слот жив И поколение совпало.
bool r2d_slot_pool_valid(const R2DSlotPool *pool, uint32_t slot, uint32_t generation);

// --- Обход живых ------------------------------------------------------------
uint32_t r2d_slot_pool_count(const R2DSlotPool *pool);
uint32_t r2d_slot_pool_capacity(const R2DSlotPool *pool);
uint32_t r2d_slot_pool_dense_at(const R2DSlotPool *pool, uint32_t index);
uint32_t r2d_slot_pool_dense_to_slot(const R2DSlotPool *pool, uint32_t index);

// --- Общий проверяемый рост массивов (§36) ---------------------------------
// Единая точка роста для подсистем, которые пока не перешли на пул: удваивает
// capacity до required, проверяет required <= UINT32_MAX, переполнение
// capacity*element_size и отказ аллокатора. Данные при отказе не меняются.
bool r2d_grow_array(void **data, size_t element_size, uint32_t *capacity,
                    uint32_t required);

#ifdef __cplusplus
}
#endif
