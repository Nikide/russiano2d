#include "re2d_world_stream_io.h"
#include "unity.h"

#include <stdlib.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

typedef struct {
    int calls, failures;
    int last_region, last_kind;
    uint64_t last_offset, last_bytes;
    int order[16], order_count;
} Probe;

static bool probe_read(void *user, int region, int kind, void *dst, const void *src,
                       uint64_t offset, uint32_t bytes)
{
    Probe *probe = (Probe *)user;
    probe->calls++;
    probe->last_region = region;
    probe->last_kind = kind;
    probe->last_offset = offset;
    probe->last_bytes = bytes;
    if (probe->order_count < 16) probe->order[probe->order_count++] = kind;
    if (probe->failures != 0) return false;
    if (bytes) memcpy((uint8_t *)dst + offset, (const uint8_t *)src + offset, bytes);
    return true;
}

typedef struct {
    int calls;
    uint64_t bytes;
    int last_region, last_kind;
} EvictProbe;

static void *probe_alloc(void *user, int region, int kind, uint64_t bytes)
{
    (void)user; (void)region; (void)kind;
    return bytes ? malloc((size_t)bytes) : NULL;
}

static void probe_evict(void *user, int region, int kind, void *payload, uint64_t bytes)
{
    EvictProbe *probe = (EvictProbe *)user;
    probe->calls++;
    probe->bytes += bytes;
    probe->last_region = region;
    probe->last_kind = kind;
    free(payload);
}

static R2DWorldStreamIOBudget make_budget(uint64_t load_bytes, uint64_t unload_bytes,
                                          int load_items, int unload_items)
{
    R2DWorldStreamIOBudget b;
    memset(&b, 0, sizeof b);
    b.load_budget_bytes = load_bytes;
    b.unload_budget_bytes = unload_bytes;
    b.load_budget_items = load_items;
    b.unload_budget_items = unload_items;
    return b;
}

// Registers a payload and drives it to RESIDENT, then releases the refcount so
// eviction/refcount tests start from an unpinned resident payload.
static int add_resident(R2DWorldStreamIO *io, int region, int kind, uint64_t bytes,
                        const R2DWorldStreamIOBudget *load_budget, uint64_t frame)
{
    uint8_t *source = (uint8_t *)malloc((size_t)bytes);
    uint8_t *destination = (uint8_t *)malloc((size_t)bytes);
    TEST_ASSERT_NOT_NULL(source); TEST_ASSERT_NOT_NULL(destination);
    for (uint64_t i = 0; i < bytes; i++) source[i] = (uint8_t)(i * 37u + (unsigned)kind);
    memset(destination, 0, (size_t)bytes);
    const int slot = r2d_world_stream_io_add(io, region, kind, bytes, destination,
                                             source, 1);
    TEST_ASSERT_TRUE(slot >= 0);
    unsigned token = 0;
    TEST_ASSERT_TRUE(r2d_world_stream_io_acquire(io, region, kind, &token) >= 0);
    R2DWorldStreamIOStats stats;
    for (int i = 0; i < 1000 &&
         r2d_world_stream_io_state(io, region, kind) != R2D_WORLD_IO_RESIDENT; i++)
        r2d_world_stream_io_tick(io, load_budget, frame, &stats);
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_IO_RESIDENT,
                                  r2d_world_stream_io_state(io, region, kind),
                                  "payload reaches RESIDENT");
    TEST_ASSERT_TRUE(r2d_world_stream_io_release(io, region, kind));
    return slot;
}

static void free_payloads_and_sources(R2DWorldStreamIO *io)
{
    for (int i = 0; i < io->count; i++) {
        free(io->payloads[i].payload);
        free((void *)io->payloads[i].source);
    }
}

static void test_register_find_and_duplicates(void)
{
    R2DWorldStreamIO io;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_stream_io_init(&io, 8), "init");
    TEST_ASSERT_FALSE(r2d_world_stream_io_init(&io, 0));
    const int slot = r2d_world_stream_io_add(&io, 2, R2D_STREAM_IO_CELLS, 128, NULL, NULL, 1);
    TEST_ASSERT_TRUE(slot >= 0);
    TEST_ASSERT_EQUAL_INT_MESSAGE(slot,
        r2d_world_stream_io_add(&io, 2, R2D_STREAM_IO_CELLS, 256, NULL, NULL, 5),
        "duplicate region+kind reuses the descriptor");
    TEST_ASSERT_EQUAL_INT(slot, r2d_world_stream_io_find(&io, 2, R2D_STREAM_IO_CELLS));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_stream_io_find(&io, 2, R2D_STREAM_IO_NAV));
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_IO_UNLOADED,
                                  r2d_world_stream_io_state(&io, 2, R2D_STREAM_IO_CELLS),
                                  "new payload is UNLOADED");
    TEST_ASSERT_TRUE(r2d_world_stream_io_payload(&io, 2, R2D_STREAM_IO_CELLS) == NULL);
    TEST_ASSERT_EQUAL_STRING("cells", r2d_world_stream_io_kind_name(R2D_STREAM_IO_CELLS));
    TEST_ASSERT_EQUAL_STRING("nav", r2d_world_stream_io_kind_name(R2D_STREAM_IO_NAV));
    TEST_ASSERT_EQUAL_STRING("unknown", r2d_world_stream_io_kind_name(99));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_stream_io_add(&io, 2, 99, 1, NULL, NULL, 1));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_stream_io_add(&io, -1, R2D_STREAM_IO_NAV, 1, NULL, NULL, 1));
    r2d_world_stream_io_free(&io);
    TEST_ASSERT_NULL(io.payloads);
    r2d_world_stream_io_free(NULL);
}

static void test_budgeted_slices_and_payload_bytes(void)
{
    R2DWorldStreamIO io;
    TEST_ASSERT_TRUE(r2d_world_stream_io_init(&io, 8));
    Probe probe;
    memset(&probe, 0, sizeof probe);
    r2d_world_stream_io_set_callbacks(&io, probe_read, &probe, NULL, NULL);
    const uint64_t bytes = 1000;
    uint8_t *source = (uint8_t *)malloc((size_t)bytes);
    uint8_t *destination = (uint8_t *)malloc((size_t)bytes);
    TEST_ASSERT_NOT_NULL(source); TEST_ASSERT_NOT_NULL(destination);
    for (uint64_t i = 0; i < bytes; i++) source[i] = (uint8_t)(i * 13u + 7u);
    memset(destination, 0, (size_t)bytes);
    TEST_ASSERT_TRUE(r2d_world_stream_io_add(&io, 0, R2D_STREAM_IO_CELLS, bytes,
                                             destination, source, 1) >= 0);
    unsigned token = 0;
    TEST_ASSERT_TRUE(r2d_world_stream_io_acquire(&io, 0, R2D_STREAM_IO_CELLS, &token) >= 0);
    const R2DWorldStreamIOBudget b = make_budget(100, 0, 1, 0);
    int ticks = 0;
    R2DWorldStreamIOStats stats;
    memset(&stats, 0, sizeof stats);
    while (r2d_world_stream_io_state(&io, 0, R2D_STREAM_IO_CELLS) != R2D_WORLD_IO_RESIDENT &&
           ticks < 100) {
        r2d_world_stream_io_tick(&io, &b, (uint64_t)ticks, &stats);
        TEST_ASSERT_TRUE_MESSAGE(stats.max_tick_bytes <= 100,
                                 "one tick never copies more than the byte budget");
        ticks++;
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(10, ticks, "1000 bytes with a 100-byte budget takes 10 ticks");
    TEST_ASSERT_EQUAL_MEMORY(source, destination, (size_t)bytes);
    TEST_ASSERT_TRUE(r2d_world_stream_io_payload(&io, 0, R2D_STREAM_IO_CELLS) == destination);
    TEST_ASSERT_TRUE(probe.calls >= 10);
    TEST_ASSERT_TRUE(probe.last_offset < bytes);
    TEST_ASSERT_EQUAL_INT(R2D_WORLD_IO_RESIDENT,
                          r2d_world_stream_io_state(&io, 0, R2D_STREAM_IO_CELLS));
    free_payloads_and_sources(&io);
    r2d_world_stream_io_free(&io);
}

static void test_priority_order(void)
{
    R2DWorldStreamIO io;
    TEST_ASSERT_TRUE(r2d_world_stream_io_init(&io, 8));
    Probe probe;
    memset(&probe, 0, sizeof probe);
    r2d_world_stream_io_set_callbacks(&io, probe_read, &probe, NULL, NULL);
    uint8_t data[2][16];
    memset(data[0], 1, sizeof data[0]);
    memset(data[1], 2, sizeof data[1]);
    TEST_ASSERT_TRUE(r2d_world_stream_io_add(&io, 0, R2D_STREAM_IO_NAV, 16, data[0], data[0], 1) >= 0);
    TEST_ASSERT_TRUE(r2d_world_stream_io_add(&io, 0, R2D_STREAM_IO_CELLS, 16, data[1], data[1], 9) >= 0);
    unsigned token = 0;
    TEST_ASSERT_TRUE(r2d_world_stream_io_acquire(&io, 0, R2D_STREAM_IO_NAV, &token) >= 0);
    TEST_ASSERT_TRUE(r2d_world_stream_io_acquire(&io, 0, R2D_STREAM_IO_CELLS, &token) >= 0);
    const R2DWorldStreamIOBudget b = make_budget(16, 0, 1, 0);
    R2DWorldStreamIOStats stats;
    r2d_world_stream_io_tick(&io, &b, 0, &stats);
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_STREAM_IO_CELLS, probe.order[0],
                                  "higher-priority payload loads first");
    r2d_world_stream_io_tick(&io, &b, 1, &stats);
    TEST_ASSERT_EQUAL_INT(R2D_STREAM_IO_NAV, probe.order[1]);
    r2d_world_stream_io_free(&io);
}

static void test_refcount_pin_and_eviction(void)
{
    R2DWorldStreamIO io;
    TEST_ASSERT_TRUE(r2d_world_stream_io_init(&io, 8));
    EvictProbe evict;
    memset(&evict, 0, sizeof evict);
    r2d_world_stream_io_set_callbacks(&io, NULL, NULL, probe_evict, &evict);
    const R2DWorldStreamIOBudget load = make_budget(1000, 0, 8, 0);
    add_resident(&io, 0, R2D_STREAM_IO_CELLS, 32, &load, 0);
    add_resident(&io, 1, R2D_STREAM_IO_CELLS, 32, &load, 0);
    uint8_t required[2] = {1, 1};
    TEST_ASSERT_TRUE(r2d_world_stream_io_set_required(&io, required, 2));
    R2DWorldStreamIOStats stats;
    r2d_world_stream_io_tick(&io, &load, 1, &stats);
    unsigned token = 0;
    TEST_ASSERT_TRUE(r2d_world_stream_io_acquire(&io, 0, R2D_STREAM_IO_CELLS, &token) >= 0);
    TEST_ASSERT_TRUE(r2d_world_stream_io_release(&io, 0, R2D_STREAM_IO_CELLS));
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_IO_RESIDENT,
                                  r2d_world_stream_io_state(&io, 0, R2D_STREAM_IO_CELLS),
                                  "required payload stays resident with refcount 0");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_stream_io_release(&io, 0, R2D_STREAM_IO_CELLS),
                              "extra release rejected");
    uint8_t keep[2] = {1, 0};
    TEST_ASSERT_TRUE(r2d_world_stream_io_set_required(&io, keep, 2));
    const R2DWorldStreamIOBudget unload = make_budget(0, 64, 0, 1);
    int guard = 0;
    while (r2d_world_stream_io_state(&io, 1, R2D_STREAM_IO_CELLS) != R2D_WORLD_IO_UNLOADED &&
           guard++ < 10)
        r2d_world_stream_io_tick(&io, &unload, (uint64_t)guard, &stats);
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_IO_UNLOADED,
                                  r2d_world_stream_io_state(&io, 1, R2D_STREAM_IO_CELLS),
                                  "unrequired unpinned payload unloads");
    TEST_ASSERT_EQUAL_INT(1, evict.calls);
    TEST_ASSERT_EQUAL_INT(1, evict.last_region);
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_IO_RESIDENT,
                                  r2d_world_stream_io_state(&io, 0, R2D_STREAM_IO_CELLS),
                                  "required payload is not evicted");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_stream_io_payload(&io, 1, R2D_STREAM_IO_CELLS) == NULL,
                             "unloaded payload pointer is gone");
    free_payloads_and_sources(&io);
    r2d_world_stream_io_free(&io);
}

static void test_tokens_and_stale_handles(void)
{
    R2DWorldStreamIO io;
    TEST_ASSERT_TRUE(r2d_world_stream_io_init(&io, 4));
    EvictProbe evict;
    memset(&evict, 0, sizeof evict);
    r2d_world_stream_io_set_callbacks(&io, NULL, NULL, probe_evict, &evict);
    const R2DWorldStreamIOBudget load = make_budget(16, 0, 1, 0);
    add_resident(&io, 0, R2D_STREAM_IO_NAV, 16, &load, 0);
    const unsigned first = r2d_world_stream_io_token(&io, 0, R2D_STREAM_IO_NAV);
    TEST_ASSERT_TRUE(first != 0);
    uint8_t required[1] = {0};
    r2d_world_stream_io_set_required(&io, required, 1);
    const R2DWorldStreamIOBudget unload = make_budget(0, 16, 0, 1);
    R2DWorldStreamIOStats stats;
    r2d_world_stream_io_tick(&io, &unload, 1, &stats);
    const unsigned second = r2d_world_stream_io_token(&io, 0, R2D_STREAM_IO_NAV);
    TEST_ASSERT_TRUE_MESSAGE(second != first, "unload invalidates the token");
    TEST_ASSERT_EQUAL_INT(1, evict.calls);
    free_payloads_and_sources(&io);
    r2d_world_stream_io_free(&io);
}

static void test_unload_budget_and_no_hitch(void)
{
    R2DWorldStreamIO io;
    TEST_ASSERT_TRUE(r2d_world_stream_io_init(&io, 8));
    EvictProbe evict;
    memset(&evict, 0, sizeof evict);
    r2d_world_stream_io_set_callbacks(&io, NULL, NULL, probe_evict, &evict);
    const R2DWorldStreamIOBudget load = make_budget(1000, 0, 8, 0);
    add_resident(&io, 0, R2D_STREAM_IO_CELLS, 40, &load, 0);
    add_resident(&io, 1, R2D_STREAM_IO_CELLS, 40, &load, 0);
    uint8_t none[2] = {0, 0};
    r2d_world_stream_io_set_required(&io, none, 2);
    const R2DWorldStreamIOBudget unload = make_budget(0, 1000, 0, 1);
    R2DWorldStreamIOStats stats;
    memset(&stats, 0, sizeof stats);
    r2d_world_stream_io_tick(&io, &unload, 1, &stats);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, stats.unloads, "unload item budget caps frees per tick");
    TEST_ASSERT_EQUAL_INT(1, evict.calls);
    free_payloads_and_sources(&io);
    r2d_world_stream_io_free(&io);

    R2DWorldStreamIO io2;
    TEST_ASSERT_TRUE(r2d_world_stream_io_init(&io2, 8));
    for (int i = 0; i < 4; i++)
        add_resident(&io2, i, R2D_STREAM_IO_SPANS, 64, &load, 0);
    for (int i = 0; i < 4; i++) {
        unsigned token = 0;
        TEST_ASSERT_TRUE(r2d_world_stream_io_acquire(&io2, i, R2D_STREAM_IO_SPANS, &token) >= 0);
    }
    const R2DWorldStreamIOBudget b = make_budget(32, 0, 2, 0);
    for (int tick = 0; tick < 40; tick++) {
        r2d_world_stream_io_tick(&io2, &b, (uint64_t)tick, &stats);
        TEST_ASSERT_TRUE_MESSAGE(stats.max_tick_bytes <= 32,
                                 "no tick exceeds the byte budget");
        TEST_ASSERT_TRUE_MESSAGE(stats.queued_load <= 4, "queue stays bounded");
    }
    for (int i = 0; i < 4; i++)
        TEST_ASSERT_EQUAL_INT(R2D_WORLD_IO_RESIDENT,
                              r2d_world_stream_io_state(&io2, i, R2D_STREAM_IO_SPANS));
    free_payloads_and_sources(&io2);
    r2d_world_stream_io_free(&io2);
}

static void test_read_failure_and_determinism(void)
{
    R2DWorldStreamIO a, b;
    TEST_ASSERT_TRUE(r2d_world_stream_io_init(&a, 8));
    TEST_ASSERT_TRUE(r2d_world_stream_io_init(&b, 8));
    Probe probe;
    memset(&probe, 0, sizeof probe);
    probe.failures = 1;
    r2d_world_stream_io_set_callbacks(&a, probe_read, &probe, NULL, NULL);
    r2d_world_stream_io_set_callbacks(&b, probe_read, &probe, NULL, NULL);
    uint8_t source[16] = {0}, dest_a[16] = {0}, dest_b[16] = {0};
    TEST_ASSERT_TRUE(r2d_world_stream_io_add(&a, 0, R2D_STREAM_IO_NAV, 16, dest_a, source, 1) >= 0);
    TEST_ASSERT_TRUE(r2d_world_stream_io_add(&b, 0, R2D_STREAM_IO_NAV, 16, dest_b, source, 1) >= 0);
    unsigned token = 0;
    r2d_world_stream_io_acquire(&a, 0, R2D_STREAM_IO_NAV, &token);
    r2d_world_stream_io_acquire(&b, 0, R2D_STREAM_IO_NAV, &token);
    const R2DWorldStreamIOBudget cfg = make_budget(64, 0, 4, 0);
    R2DWorldStreamIOStats sa, sb;
    const int ta = r2d_world_stream_io_tick(&a, &cfg, 1, &sa);
    const int tb = r2d_world_stream_io_tick(&b, &cfg, 1, &sb);
    TEST_ASSERT_EQUAL_INT(ta, tb);
    TEST_ASSERT_EQUAL_INT(1, sa.read_failures);
    TEST_ASSERT_EQUAL_INT(R2D_WORLD_IO_UNLOADED,
                          r2d_world_stream_io_state(&a, 0, R2D_STREAM_IO_NAV));

    R2DWorldStreamIO c, d;
    TEST_ASSERT_TRUE(r2d_world_stream_io_init(&c, 8));
    TEST_ASSERT_TRUE(r2d_world_stream_io_init(&d, 8));
    EvictProbe evict_c, evict_d;
    memset(&evict_c, 0, sizeof evict_c);
    memset(&evict_d, 0, sizeof evict_d);
    r2d_world_stream_io_set_callbacks(&c, NULL, NULL, probe_evict, &evict_c);
    r2d_world_stream_io_set_callbacks(&d, NULL, NULL, probe_evict, &evict_d);
    for (int i = 0; i < 4; i++) {
        uint8_t *src = (uint8_t *)malloc(128), *dst_c = (uint8_t *)malloc(128);
        uint8_t *src_d = (uint8_t *)malloc(128), *dst_d = (uint8_t *)malloc(128);
        TEST_ASSERT_NOT_NULL(src); TEST_ASSERT_NOT_NULL(dst_c);
        TEST_ASSERT_NOT_NULL(src_d); TEST_ASSERT_NOT_NULL(dst_d);
        memset(src, i + 1, 128); memset(dst_c, 0, 128);
        memset(src_d, i + 1, 128); memset(dst_d, 0, 128);
        r2d_world_stream_io_add(&c, i, R2D_STREAM_IO_WALLS, 128, dst_c, src, i);
        r2d_world_stream_io_add(&d, i, R2D_STREAM_IO_WALLS, 128, dst_d, src_d, i);
    }
    for (int i = 0; i < 4; i++) {
        unsigned tok = 0;
        r2d_world_stream_io_acquire(&c, i, R2D_STREAM_IO_WALLS, &tok);
        r2d_world_stream_io_acquire(&d, i, R2D_STREAM_IO_WALLS, &tok);
    }
    uint8_t required[4] = {1, 1, 0, 0};
    r2d_world_stream_io_set_required(&c, required, 4);
    r2d_world_stream_io_set_required(&d, required, 4);
    const R2DWorldStreamIOBudget tick_budget = make_budget(100, 30, 2, 1);
    for (int tick = 0; tick < 20; tick++) {
        R2DWorldStreamIOStats sc, sd;
        TEST_ASSERT_EQUAL_INT(r2d_world_stream_io_tick(&c, &tick_budget, (uint64_t)tick, &sc),
                              r2d_world_stream_io_tick(&d, &tick_budget, (uint64_t)tick, &sd));
        TEST_ASSERT_EQUAL_INT(0, memcmp(&sc, &sd, sizeof sc));
    }
    for (int i = 0; i < c.count; i++) {
        TEST_ASSERT_EQUAL_INT(c.payloads[i].state, d.payloads[i].state);
        TEST_ASSERT_EQUAL_INT(c.payloads[i].region, d.payloads[i].region);
        TEST_ASSERT_EQUAL_INT(c.payloads[i].kind, d.payloads[i].kind);
        TEST_ASSERT_EQUAL_INT((int)c.payloads[i].bytes, (int)d.payloads[i].bytes);
        TEST_ASSERT_EQUAL_INT((int)c.payloads[i].copied, (int)d.payloads[i].copied);
    }
    free_payloads_and_sources(&c);
    free_payloads_and_sources(&d);
    r2d_world_stream_io_free(&c);
    r2d_world_stream_io_free(&d);
    r2d_world_stream_io_free(&a);
    r2d_world_stream_io_free(&b);
}

static void test_required_toggle_unloads_and_reloads(void)
{
    R2DWorldStreamIO io;
    TEST_ASSERT_TRUE(r2d_world_stream_io_init(&io, 16));
    EvictProbe evict;
    memset(&evict, 0, sizeof evict);
    r2d_world_stream_io_set_callbacks(&io, NULL, NULL, probe_evict, &evict);
    r2d_world_stream_io_set_allocator(&io, probe_alloc, NULL);
    for (int i = 0; i < 3; i++) {
        uint8_t *src = (uint8_t *)malloc(64);
        uint8_t *dst = (uint8_t *)malloc(64);
        TEST_ASSERT_NOT_NULL(src); TEST_ASSERT_NOT_NULL(dst);
        memset(src, i + 1, 64); memset(dst, 0, 64);
        TEST_ASSERT_TRUE(r2d_world_stream_io_add(&io, 0, i, 64, dst, src, 1) >= 0);
    }
    uint8_t required[1] = {1};
    const R2DWorldStreamIOBudget b = make_budget(1000, 1000, 8, 8);
    R2DWorldStreamIOStats stats;
    r2d_world_stream_io_set_required(&io, required, 1);
    const int first_loads = r2d_world_stream_io_tick(&io, &b, 0, &stats);
    TEST_ASSERT_EQUAL_INT(3, stats.loads_completed);
    TEST_ASSERT_EQUAL_INT(3, stats.resident);
    (void)first_loads;
    uint8_t none[1] = {0};
    r2d_world_stream_io_set_required(&io, none, 1);
    r2d_world_stream_io_tick(&io, &b, 1, &stats);
    TEST_ASSERT_EQUAL_INT(3, stats.unloads);
    TEST_ASSERT_EQUAL_INT(0, stats.resident);
    TEST_ASSERT_EQUAL_INT(R2D_WORLD_IO_UNLOADED, r2d_world_stream_io_state(&io, 0, 0));
    r2d_world_stream_io_set_required(&io, required, 1);
    r2d_world_stream_io_tick(&io, &b, 2, &stats);
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, stats.loads_completed,
                                  "required toggle reloads evicted payloads");
    TEST_ASSERT_EQUAL_INT(3, stats.resident);
    TEST_ASSERT_TRUE(r2d_world_stream_io_payload(&io, 0, 0) != NULL);
    free_payloads_and_sources(&io);
    r2d_world_stream_io_free(&io);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_register_find_and_duplicates);
    RUN_TEST(test_budgeted_slices_and_payload_bytes);
    RUN_TEST(test_priority_order);
    RUN_TEST(test_refcount_pin_and_eviction);
    RUN_TEST(test_tokens_and_stale_handles);
    RUN_TEST(test_unload_budget_and_no_hitch);
    RUN_TEST(test_read_failure_and_determinism);
    RUN_TEST(test_required_toggle_unloads_and_reloads);
    return UNITY_END();
}
