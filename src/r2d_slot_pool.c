#include "r2d_slot_pool.h"

#include <stdlib.h>
#include <string.h>

// Начальная ёмкость: небольшая, чтобы пустая подсистема не ела память, но и не
// росла с первого же ресурса. Дальше — удвоение до required.
#define R2D_SLOT_POOL_MIN 16u
// Safety-предел ёмкости: это не игровой лимит, а защита от запроса гигантской
// таблицы (например, UINT32_MAX слотов = десятки ГиБ). 67M слотов с запасом
// покрывают любой реальный контент и при этом сразу отвергают абсурд.
#define R2D_SLOT_POOL_MAX_CAPACITY (1u << 26)

bool r2d_grow_array(void **data, size_t element_size, uint32_t *capacity,
                    uint32_t required)
{
    if (!data || !capacity || element_size == 0) return false;
    if (required <= *capacity) return true;

    uint32_t next = *capacity ? *capacity : R2D_SLOT_POOL_MIN;
    while (next < required) {
        if (next > UINT32_MAX / 2u) { next = required; break; }
        next *= 2u;
    }
    if (next < required) return false;
    if ((size_t)next > SIZE_MAX / element_size) return false;

    void *grown = realloc(*data, (size_t)next * element_size);
    if (!grown) return false;
    *data = grown;
    *capacity = next;
    return true;
}

bool r2d_slot_pool_reserve(R2DSlotPool *pool, uint32_t capacity)
{
    if (!pool) return false;
    if (capacity <= pool->slot_capacity) return true;
    if (capacity == 0) return true;
    if (capacity > R2D_SLOT_POOL_MAX_CAPACITY) return false;

    uint32_t next = pool->slot_capacity ? pool->slot_capacity : R2D_SLOT_POOL_MIN;
    while (next < capacity) {
        if (next > UINT32_MAX / 2u) { next = capacity; break; }
        next *= 2u;
    }
    if (next < capacity) return false;
    if (next > R2D_SLOT_POOL_MAX_CAPACITY) return false;
    if ((size_t)next > SIZE_MAX / sizeof(R2DSlot)) return false;
    if ((size_t)next > SIZE_MAX / sizeof(uint32_t)) return false;

    // Растим все три массива согласованно. При отказе любого realloc пул
    // остаётся прежним: частично увеличенный набор сломал бы инварианты.
    R2DSlot *slots = (R2DSlot *)realloc(pool->slots, (size_t)next * sizeof(R2DSlot));
    if (!slots) return false;
    pool->slots = slots;

    uint32_t *dense = (uint32_t *)realloc(pool->dense, (size_t)next * sizeof(uint32_t));
    if (!dense) return false;
    pool->dense = dense;

    uint32_t *map = (uint32_t *)realloc(pool->dense_to_slot, (size_t)next * sizeof(uint32_t));
    if (!map) return false;
    pool->dense_to_slot = map;

    const uint32_t old = pool->slot_capacity;
    for (uint32_t i = old; i < next; ++i) {
        pool->slots[i].generation = 0;
        pool->slots[i].dense_index = R2D_SLOT_NONE;
        pool->slots[i].alive = false;
        // Новые слоты добавляются в freelist цепочкой.
        pool->slots[i].next_free = pool->free_head;
        pool->free_head = i;
    }
    pool->slot_capacity = next;
    pool->dense_capacity = next;
    return true;
}

bool r2d_slot_pool_init(R2DSlotPool *pool, uint32_t initial_capacity)
{
    if (!pool) return false;
    memset(pool, 0, sizeof *pool);
    pool->free_head = R2D_SLOT_NONE;
    if (initial_capacity == 0) return true;
    return r2d_slot_pool_reserve(pool, initial_capacity);
}

void r2d_slot_pool_shutdown(R2DSlotPool *pool)
{
    if (!pool) return;
    free(pool->slots);
    free(pool->dense);
    free(pool->dense_to_slot);
    memset(pool, 0, sizeof *pool);
    pool->free_head = R2D_SLOT_NONE;
}

uint32_t r2d_slot_pool_alloc(R2DSlotPool *pool)
{
    if (!pool) return R2D_SLOT_NONE;
    if (pool->free_head == R2D_SLOT_NONE) {
        if (!r2d_slot_pool_reserve(pool, pool->slot_capacity + 1u)) {
            return R2D_SLOT_NONE;
        }
    }
    const uint32_t slot = pool->free_head;
    if (slot == R2D_SLOT_NONE || slot >= pool->slot_capacity) return R2D_SLOT_NONE;

    pool->free_head = pool->slots[slot].next_free;
    pool->slots[slot].next_free = R2D_SLOT_NONE;
    pool->slots[slot].alive = true;
    pool->slots[slot].generation++;
    if (pool->slots[slot].generation == 0) pool->slots[slot].generation = 1;
    pool->slots[slot].dense_index = pool->alive_count;
    pool->dense[pool->alive_count] = slot;
    pool->dense_to_slot[pool->alive_count] = slot;
    pool->alive_count++;
    if (pool->slot_count <= slot) pool->slot_count = slot + 1u;
    return slot;
}

bool r2d_slot_pool_free(R2DSlotPool *pool, uint32_t slot)
{
    if (!pool || slot >= pool->slot_capacity || !pool->slots[slot].alive) return false;
    const uint32_t di = pool->slots[slot].dense_index;
    if (di >= pool->alive_count) {
        // Инвариант нарушен — но не позволяем выйти за массив.
        pool->slots[slot].alive = false;
        return false;
    }
    const uint32_t last = pool->alive_count - 1u;
    if (di != last) {
        const uint32_t moved = pool->dense[last];
        pool->dense[di] = moved;
        pool->dense_to_slot[di] = moved;
        if (moved < pool->slot_capacity) pool->slots[moved].dense_index = di;
    }
    pool->alive_count--;
    pool->slots[slot].alive = false;
    pool->slots[slot].dense_index = R2D_SLOT_NONE;
    pool->slots[slot].next_free = pool->free_head;
    pool->free_head = slot;
    return true;
}

bool r2d_slot_pool_alive(const R2DSlotPool *pool, uint32_t slot)
{
    return pool && slot < pool->slot_capacity && pool->slots[slot].alive;
}

uint32_t r2d_slot_pool_generation(const R2DSlotPool *pool, uint32_t slot)
{
    if (!pool || slot >= pool->slot_capacity) return 0;
    return pool->slots[slot].generation;
}

bool r2d_slot_pool_valid(const R2DSlotPool *pool, uint32_t slot, uint32_t generation)
{
    if (!r2d_slot_pool_alive(pool, slot)) return false;
    return pool->slots[slot].generation == generation;
}

uint32_t r2d_slot_pool_count(const R2DSlotPool *pool)
{
    return pool ? pool->alive_count : 0;
}

uint32_t r2d_slot_pool_capacity(const R2DSlotPool *pool)
{
    return pool ? pool->slot_capacity : 0;
}

uint32_t r2d_slot_pool_dense_at(const R2DSlotPool *pool, uint32_t index)
{
    if (!pool || index >= pool->alive_count) return R2D_SLOT_NONE;
    return pool->dense[index];
}

uint32_t r2d_slot_pool_dense_to_slot(const R2DSlotPool *pool, uint32_t index)
{
    if (!pool || index >= pool->alive_count) return R2D_SLOT_NONE;
    return pool->dense_to_slot[index];
}
