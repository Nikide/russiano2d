#include "re2d_world_particle.h"
#include "unity.h"

#include <math.h>
#include <stdint.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-4f

// Large static buffers keep big capacities off the test stack.
static R2DWorldParticle g_storage_8192[R2D_WORLD_PARTICLE_MAX_CAPACITY];
static R2DWorldParticle g_storage_512[512];
static R2DWorldParticle g_storage_256[256];
static R2DWorldParticle g_storage_300[300];
static R2DWorldParticle g_storage_64[64];
static R2DWorldParticle g_storage_16[16];
static R2DWorldParticle g_storage_8[8];
static R2DWorldParticle g_storage_4[4];

static R2DWorldParticle make_proto(void)
{
    R2DWorldParticle p;
    memset(&p, 0, sizeof(p));
    p.max_life = 1.0f;
    p.size = 1.0f;
    p.alpha = 1.0f;
    p.end_size = -1.0f;  // hold spawn size
    p.end_alpha = -1.0f; // hold spawn alpha
    p.mode = R2D_PARTICLE_BILLBOARD;
    p.blend = R2D_PARTICLE_MASKED;
    p.r = 1.0f;
    p.g = 0.5f;
    p.b = 0.25f;
    return p;
}

static uint32_t float_bits(float v)
{
    uint32_t bits;
    memcpy(&bits, &v, sizeof(bits));
    return bits;
}

static uint64_t hash_mix(uint64_t h, uint32_t v)
{
    h ^= (uint64_t)v;
    h *= 1099511628211ull;
    return h;
}

static uint64_t hash_pool(const R2DWorldParticlePool *pool)
{
    uint64_t h = 1469598103934665603ull;
    h = hash_mix(h, (uint32_t)pool->count);
    h = hash_mix(h, (uint32_t)pool->overflow);
    h = hash_mix(h, pool->seed);
    for (int i = 0; i < pool->count; ++i) {
        const R2DWorldParticle *p = &pool->items[i];
        h = hash_mix(h, float_bits(p->x));
        h = hash_mix(h, float_bits(p->y));
        h = hash_mix(h, float_bits(p->h));
        h = hash_mix(h, float_bits(p->vx));
        h = hash_mix(h, float_bits(p->vy));
        h = hash_mix(h, float_bits(p->vh));
        h = hash_mix(h, float_bits(p->life));
        h = hash_mix(h, float_bits(p->size));
        h = hash_mix(h, float_bits(p->rotation));
        h = hash_mix(h, float_bits(p->alpha));
        h = hash_mix(h, (uint32_t)p->frame);
        h = hash_mix(h, (uint32_t)p->blend);
        h = hash_mix(h, (uint32_t)p->mode);
        h = hash_mix(h, p->active ? 1u : 0u);
        h = hash_mix(h, p->world_space ? 1u : 0u);
    }
    return h;
}

static void test_init_validation(void)
{
    R2DWorldParticlePool pool;
    memset(&pool, 0xcd, sizeof(pool));

    TEST_ASSERT_FALSE_MESSAGE(r2d_world_particle_pool_init(NULL, g_storage_4, 4),
                             "NULL pool rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_particle_pool_init(&pool, NULL, 4),
                             "NULL storage rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, pool.capacity, "failed init leaves a zeroed pool");

    TEST_ASSERT_FALSE_MESSAGE(r2d_world_particle_pool_init(&pool, g_storage_4, 0),
                             "capacity 0 rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_particle_pool_init(&pool, g_storage_4, -3),
                             "negative capacity rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_particle_pool_init(&pool, g_storage_4, 8193),
                             "capacity above 8192 rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, pool.capacity, "failed capacity leaves pool empty");

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_particle_pool_init(&pool, g_storage_4, 4),
                             "capacity 1..8192 accepted");
    TEST_ASSERT_TRUE_MESSAGE(pool.items == g_storage_4, "storage is borrowed, not copied");
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, pool.capacity, "capacity stored");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, pool.count, "pool starts empty");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, pool.overflow, "pool starts without overflow");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(R2D_WORLD_PARTICLE_DEFAULT_SEED, pool.seed,
                                     "default seed installed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_particle_alive(&pool), "new pool is empty");
    for (int i = 0; i < 4; ++i) {
        TEST_ASSERT_FALSE_MESSAGE(g_storage_4[i].active, "init clears slot active flags");
    }

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_particle_pool_init(&pool, g_storage_8192,
                                                          R2D_WORLD_PARTICLE_MAX_CAPACITY),
                             "max capacity 8192 accepted");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_particle_pool_init(&pool, g_storage_8, 1),
                             "capacity 1 accepted");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, pool.capacity, "capacity 1 stored");
}

static void test_random_deterministic_and_range(void)
{
    R2DWorldParticlePool pool;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_64, 64));

    pool.seed = 42u;
    float first[10];
    for (int i = 0; i < 10; ++i) {
        first[i] = r2d_world_particle_random(&pool);
        TEST_ASSERT_TRUE_MESSAGE(first[i] >= 0.0f && first[i] < 1.0f, "random in [0,1)");
    }
    TEST_ASSERT_TRUE_MESSAGE(first[0] != first[1], "LCG produces varying values");

    pool.seed = 42u;
    for (int i = 0; i < 10; ++i) {
        TEST_ASSERT_EQUAL_UINT32_MESSAGE(float_bits(first[i]),
                                         float_bits(r2d_world_particle_random(&pool)),
                                         "same seed reproduces the same stream");
    }

    pool.seed = 43u;
    TEST_ASSERT_TRUE_MESSAGE(float_bits(first[0]) != float_bits(r2d_world_particle_random(&pool)),
                             "different seed changes the stream");

    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, r2d_world_particle_random(NULL),
                                    "NULL random returns 0");
}

static void test_burst_count_spread_and_direction(void)
{
    R2DWorldParticlePool pool;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_300, 300));
    R2DWorldParticle proto = make_proto();
    proto.max_life = 2.0f;
    proto.alpha = 0.8f;
    proto.world_space = true;

    int emitted = r2d_world_particle_emit_burst(&pool, &proto, 200, 1.5f, 10.0f,
                                                1.0f, 0.0f, 0.0f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(200, emitted, "burst returns the spawned count");
    TEST_ASSERT_EQUAL_INT_MESSAGE(200, pool.count, "burst fills the pool");
    TEST_ASSERT_EQUAL_INT_MESSAGE(200, r2d_world_particle_alive(&pool), "all burst particles alive");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, pool.overflow, "no overflow while capacity remains");

    for (int i = 0; i < pool.count; ++i) {
        const R2DWorldParticle *p = &pool.items[i];
        TEST_ASSERT_TRUE_MESSAGE(p->active, "burst slots active");
        TEST_ASSERT_EQUAL_FLOAT_MESSAGE(2.0f, p->life, "spawn life equals max_life");
        TEST_ASSERT_EQUAL_FLOAT_MESSAGE(2.0f, p->max_life, "max_life copied");
        TEST_ASSERT_EQUAL_FLOAT_MESSAGE(1.0f, p->size, "size copied");
        TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.8f, p->alpha, "alpha copied");
        TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_PARTICLE_BILLBOARD, p->mode, "mode copied");
        TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_PARTICLE_MASKED, p->blend, "blend copied");
        TEST_ASSERT_TRUE_MESSAGE(p->world_space, "world_space copied");
        TEST_ASSERT_TRUE_MESSAGE(fabsf(p->vx - 10.0f) <= 1.5f + EPS,
                                 "vx within spread bounds");
        TEST_ASSERT_TRUE_MESSAGE(fabsf(p->vy) <= 1.5f + EPS,
                                 "vy within spread bounds");
        TEST_ASSERT_TRUE_MESSAGE(fabsf(p->vh) <= 1.5f + EPS,
                                 "vh within spread bounds");
    }

    // Direction is normalized then scaled by speed; spread 0 pins velocity.
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_64, 64));
    proto = make_proto();
    proto.vx = 1.0f;
    emitted = r2d_world_particle_emit_burst(&pool, &proto, 3, 0.0f, 5.0f,
                                            0.0f, 3.0f, 4.0f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, emitted, "direction burst emitted");
    for (int i = 0; i < 3; ++i) {
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, pool.items[i].vx, "prototype vx preserved");
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 3.0f, pool.items[i].vy, "normalized dir.y * speed");
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 4.0f, pool.items[i].vh, "normalized dir.h * speed");
    }
}

static void test_burst_invalid_and_noop(void)
{
    R2DWorldParticlePool pool;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_64, 64));
    R2DWorldParticle proto = make_proto();
    uint32_t seed_before = pool.seed;

    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_particle_emit_burst(&pool, &proto, 0,
                                                                   0.0f, 1.0f, 0, 0, 1),
                                  "count 0 is a no-op");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_particle_emit_burst(&pool, &proto, -5,
                                                                   0.0f, 1.0f, 0, 0, 1),
                                  "negative count is a no-op");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, pool.count, "no-op emits nothing");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(seed_before, pool.seed, "count<=0 does not consume RNG");

    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_burst(NULL, &proto, 1,
                                                                    0, 1, 0, 0, 1),
                                  "NULL pool rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_burst(&pool, NULL, 1,
                                                                    0, 1, 0, 0, 1),
                                  "NULL prototype rejected");

    R2DWorldParticle bad = proto;
    bad.x = NAN;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_burst(&pool, &bad, 1,
                                                                    0, 1, 0, 0, 1),
                                  "NaN position rejected");
    bad = proto;
    bad.max_life = 0.0f;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_burst(&pool, &bad, 1,
                                                                    0, 1, 0, 0, 1),
                                  "non-positive max_life rejected");
    bad = proto;
    bad.size = -1.0f;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_burst(&pool, &bad, 1,
                                                                    0, 1, 0, 0, 1),
                                  "negative size rejected");
    bad = proto;
    bad.mode = 4;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_burst(&pool, &bad, 1,
                                                                    0, 1, 0, 0, 1),
                                  "unknown mode rejected");
    bad = proto;
    bad.blend = 3;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_burst(&pool, &bad, 1,
                                                                    0, 1, 0, 0, 1),
                                  "unknown blend rejected");
    bad = proto;
    bad.frames = -1;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_burst(&pool, &bad, 1,
                                                                    0, 1, 0, 0, 1),
                                  "negative frames rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_burst(&pool, &proto, 1,
                                                                    -1.0f, 1, 0, 0, 1),
                                  "negative spread rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_burst(&pool, &proto, 1,
                                                                    0, NAN, 0, 0, 1),
                                  "NaN speed rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_burst(&pool, &proto, 1,
                                                                    0, 1, NAN, 0, 1),
                                  "NaN direction rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, pool.count, "invalid emit does not touch the pool");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(seed_before, pool.seed, "invalid emit does not consume RNG");
}

static void test_continuous_60hz_and_120hz(void)
{
    R2DWorldParticlePool pool;
    R2DWorldParticle proto = make_proto();
    proto.max_life = 5.0f;
    float acc = 0.0f;

    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_512, 512));
    int total = 0;
    for (int i = 0; i < 6; ++i) {
        int n = r2d_world_particle_emit_continuous(&pool, &proto, 1.0f / 60.0f, 60.0f,
                                                   0.0f, 0.0f, 0, 0, 1, &acc);
        TEST_ASSERT_EQUAL_INT_MESSAGE(1, n, "60/s at 60 Hz emits one per call");
        total += n;
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(6, total, "6 calls at 60 Hz emit 6");
    TEST_ASSERT_EQUAL_INT_MESSAGE(6, pool.count, "all continuous particles stored");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, acc, "no whole-particle remainder");

    acc = 0.0f;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_512, 512));
    total = 0;
    for (int i = 0; i < 12; ++i) {
        total += r2d_world_particle_emit_continuous(&pool, &proto, 1.0f / 120.0f, 120.0f,
                                                    0.0f, 0.0f, 0, 0, 1, &acc);
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(12, total, "120/s at 120 Hz emits one per call");

    // Fractional accumulation: 10/s at 60 Hz => 10 after 60 ticks.
    acc = 0.0f;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_512, 512));
    total = 0;
    for (int i = 0; i < 60; ++i) {
        total += r2d_world_particle_emit_continuous(&pool, &proto, 1.0f / 60.0f, 10.0f,
                                                    0.0f, 0.0f, 0, 0, 1, &acc);
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(10, total, "10/s accumulates to 10 particles in one second");

    // 1.5 particles per tick: 3 total after two ticks.
    acc = 0.0f;
    pool.count = 0;
    total = r2d_world_particle_emit_continuous(&pool, &proto, 1.0f / 60.0f, 90.0f,
                                               0.0f, 0.0f, 0, 0, 1, &acc);
    total += r2d_world_particle_emit_continuous(&pool, &proto, 1.0f / 60.0f, 90.0f,
                                                0.0f, 0.0f, 0, 0, 1, &acc);
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, total, "90/s at 60 Hz emits 3 over two ticks");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, acc, "fractional remainder consumed");

    // dt is clamped to 0.25 s: 1000/s * 0.25 = 250.
    acc = 0.0f;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_512, 512));
    int n = r2d_world_particle_emit_continuous(&pool, &proto, 10.0f, 1000.0f,
                                                0.0f, 0.0f, 0, 0, 1, &acc);
    TEST_ASSERT_EQUAL_INT_MESSAGE(250, n, "continuous dt clamps to 0.25 s");
}

static void test_continuous_invalid(void)
{
    R2DWorldParticlePool pool;
    R2DWorldParticle proto = make_proto();
    float acc = 0.0f;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_64, 64));

    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_continuous(NULL, &proto, 0.1f, 10,
                                                                          0, 0, 0, 0, 1, &acc),
                                  "NULL pool rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_continuous(&pool, &proto, 0.1f, 10,
                                                                          0, 0, 0, 0, 1, NULL),
                                  "NULL accumulator rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_continuous(&pool, &proto, 0.1f, -1,
                                                                          0, 0, 0, 0, 1, &acc),
                                  "negative rate rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_continuous(&pool, &proto, NAN, 10,
                                                                          0, 0, 0, 0, 1, &acc),
                                  "NaN dt rejected");
    acc = NAN;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_continuous(&pool, &proto, 0.1f, 10,
                                                                          0, 0, 0, 0, 1, &acc),
                                  "NaN accumulator rejected");
    acc = 0.0f;
    R2DWorldParticle bad = proto;
    bad.vx = INFINITY;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, r2d_world_particle_emit_continuous(&pool, &bad, 0.1f, 10,
                                                                         0, 0, 0, 0, 1, &acc),
                                  "invalid prototype rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, pool.count, "invalid continuous emit touches nothing");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, acc, "invalid call leaves the accumulator alone");
}

static void test_step_math_gravity(void)
{
    R2DWorldParticlePool pool;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_4, 4));
    R2DWorldParticle proto = make_proto();
    proto.x = 1.0f;
    proto.y = 2.0f;
    proto.h = 3.0f;
    proto.vx = 3.0f;
    proto.vy = -2.0f;
    proto.vh = 4.0f;
    proto.gravity = -10.0f;
    proto.max_life = 2.0f;

    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool, &proto, 1,
                                                           0, 0, 0, 0, 0));
    r2d_world_particle_step(&pool, 0.2f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, pool.count, "particle survives the first step");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.6f, pool.items[0].x, "x += vx*dt");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.6f, pool.items[0].y, "y += vy*dt");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 2.0f, pool.items[0].vh, "gravity integrates vh");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 3.4f, pool.items[0].h, "h += vh*dt after gravity");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.8f, pool.items[0].life, "life counts down");

    r2d_world_particle_step(&pool, 0.2f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 2.2f, pool.items[0].x, "second x update");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.2f, pool.items[0].y, "second y update");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, pool.items[0].vh, "gravity keeps integrating");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 3.4f, pool.items[0].h, "second h update");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.6f, pool.items[0].life, "life after two steps");
}

static void test_step_screen_ignores_gravity(void)
{
    R2DWorldParticle proto = make_proto();
    proto.vh = 1.0f;
    proto.gravity = -10.0f;
    proto.max_life = 1.0f;

    R2DWorldParticlePool billboard, screen;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&billboard, g_storage_16, 16));
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&screen, g_storage_8, 8));

    proto.mode = R2D_PARTICLE_BILLBOARD;
    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&billboard, &proto, 1, 0, 0, 0, 0, 0));
    proto.mode = R2D_PARTICLE_SCREEN;
    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&screen, &proto, 1, 0, 0, 0, 0, 0));

    r2d_world_particle_step(&billboard, 0.2f);
    r2d_world_particle_step(&screen, 0.2f);

    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -1.0f, billboard.items[0].vh,
                                     "billboard applies gravity");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -0.2f, billboard.items[0].h,
                                     "billboard height follows gravity");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, screen.items[0].vh,
                                     "screen mode ignores gravity");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.2f, screen.items[0].h,
                                     "screen height still integrates vh");
}

static void test_step_drag_rotation_and_curves(void)
{
    R2DWorldParticlePool pool;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_4, 4));
    R2DWorldParticle proto = make_proto();
    proto.max_life = 2.0f;
    proto.size = 2.0f;
    proto.alpha = 1.0f;
    proto.end_size = 6.0f;
    proto.end_alpha = 0.0f;
    proto.vx = 3.0f;
    proto.vy = -2.0f;
    proto.vh = 4.0f;
    proto.drag = 2.0f;
    proto.spin = 2.0f;
    proto.gravity = -10.0f;
    proto.mode = R2D_PARTICLE_SCREEN; // isolate drag from gravity
    proto.frames = 8;
    proto.blend = R2D_PARTICLE_ADDITIVE;

    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool, &proto, 1, 0, 0, 0, 0, 0));
    r2d_world_particle_step(&pool, 0.25f);

    const float damp = expf(-0.5f); // drag 2 * dt 0.25
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 3.0f * damp, pool.items[0].vx, "drag damps vx");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -2.0f * damp, pool.items[0].vy, "drag damps vy");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 4.0f * damp, pool.items[0].vh, "drag damps vh");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 3.0f * damp * 0.25f, pool.items[0].x,
                                     "x uses damped vx");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, -2.0f * damp * 0.25f, pool.items[0].y,
                                     "y uses damped vy");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 4.0f * damp * 0.25f, pool.items[0].h,
                                     "h uses damped vh");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.5f, pool.items[0].rotation, "rotation += spin*dt");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 2.5f, pool.items[0].size, "size curve at f=0.125");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.875f, pool.items[0].alpha, "alpha curve at f=0.125");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, pool.items[0].frame, "frame follows life fraction");

    r2d_world_particle_step(&pool, 0.25f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 3.0f * damp * damp, pool.items[0].vx,
                                     "drag compounds");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 3.0f * damp * 0.25f + 3.0f * damp * damp * 0.25f,
                                     pool.items[0].x, "x after two damped steps");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, pool.items[0].rotation, "rotation after two steps");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 3.0f, pool.items[0].size, "size curve at f=0.25");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.75f, pool.items[0].alpha, "alpha curve at f=0.25");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, pool.items[0].frame, "frame at f=0.25");

    for (int i = 0; i < 4; ++i) r2d_world_particle_step(&pool, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, pool.count, "particle alive at f=0.75");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 5.0f, pool.items[0].size, "size curve at f=0.75");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, pool.items[0].alpha, "alpha curve at f=0.75");
    TEST_ASSERT_EQUAL_INT_MESSAGE(6, pool.items[0].frame, "frame at f=0.75");

    // Non-positive drag must not amplify velocity.
    R2DWorldParticle hold = make_proto();
    hold.vx = 5.0f;
    hold.drag = -10.0f;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_4, 4));
    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool, &hold, 1, 0, 0, 0, 0, 0));
    r2d_world_particle_step(&pool, 0.1f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 5.0f, pool.items[0].vx, "negative drag clamps to zero");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, pool.items[0].size, "size holds without endpoints");

    // Alpha is clamped into [0,1] at spawn.
    R2DWorldParticle bright = make_proto();
    bright.alpha = 2.0f;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_4, 4));
    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool, &bright, 1, 0, 0, 0, 0, 0));
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 1.0f, pool.items[0].alpha, "alpha clamps to 1");
}

static void test_life_expiry_exact(void)
{
    R2DWorldParticlePool pool;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_4, 4));
    R2DWorldParticle proto = make_proto();
    proto.max_life = 0.5f;

    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool, &proto, 1, 0, 0, 0, 0, 0));
    r2d_world_particle_step(&pool, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, pool.count, "alive halfway through life");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, pool.items[0].life, "half life remains");

    r2d_world_particle_step(&pool, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, pool.count, "expires exactly at life end");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_particle_alive(&pool), "no alive particles after expiry");

    // A step larger than the remaining life also expires (and integrates only
    // the remaining interval).
    proto.max_life = 0.1f;
    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool, &proto, 1, 0, 0, 0, 0, 0));
    r2d_world_particle_step(&pool, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, pool.count, "oversized step expires the particle");
}

static void test_pool_overflow_evicts_oldest(void)
{
    R2DWorldParticlePool pool;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_8, 3));
    R2DWorldParticle proto = make_proto();
    proto.max_life = 10.0f;

    // Four distinct single-particle bursts with x = 10,20,30,40.
    for (int i = 0; i < 4; ++i) {
        proto.x = 10.0f * (float)(i + 1);
        TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool, &proto, 1, 0, 0, 0, 0, 0));
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, pool.count, "pool stays at capacity");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, pool.overflow, "one eviction counted");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 20.0f, pool.items[0].x, "oldest (10) was evicted");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 30.0f, pool.items[1].x, "second particle survived");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 40.0f, pool.items[2].x, "newest particle appended");
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, r2d_world_particle_alive(&pool), "all slots active");

    for (int i = 0; i < 5; ++i) {
        proto.x = 50.0f + 10.0f * (float)i;
        TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool, &proto, 1, 0, 0, 0, 0, 0));
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, pool.count, "pool remains capped");
    TEST_ASSERT_EQUAL_INT_MESSAGE(6, pool.overflow, "every eviction counted");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 70.0f, pool.items[0].x, "age order preserved (70)");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 80.0f, pool.items[1].x, "age order preserved (80)");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 90.0f, pool.items[2].x, "age order preserved (90)");

    // Overflow saturates instead of wrapping.
    pool.overflow = INT32_MAX;
    proto.x = 100.0f;
    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool, &proto, 1, 0, 0, 0, 0, 0));
    TEST_ASSERT_EQUAL_INT_MESSAGE(INT32_MAX, pool.overflow, "overflow saturates");
}

static void test_step_clamps_dt(void)
{
    R2DWorldParticlePool pool;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_4, 4));
    R2DWorldParticle proto = make_proto();
    proto.vx = 10.0f;
    proto.max_life = 10.0f;
    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool, &proto, 1, 0, 0, 0, 0, 0));

    r2d_world_particle_step(&pool, -1.0f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, pool.items[0].x, "negative dt ignored");
    r2d_world_particle_step(&pool, NAN);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, pool.items[0].x, "NaN dt ignored");
    r2d_world_particle_step(&pool, INFINITY);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.0f, pool.items[0].x, "infinite dt ignored");
    r2d_world_particle_step(NULL, 0.1f);

    r2d_world_particle_step(&pool, 10.0f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 2.5f, pool.items[0].x, "dt clamps to 0.25 s");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 9.75f, pool.items[0].life, "life uses clamped dt");

    r2d_world_particle_step(&pool, 0.0f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 2.5f, pool.items[0].x, "zero dt is a no-op");
}

static void test_nan_particle_dropped(void)
{
    R2DWorldParticlePool pool;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_4, 4));
    R2DWorldParticle proto = make_proto();
    proto.max_life = 1.0f;
    proto.vx = 2.0f;
    proto.x = 5.0f;

    TEST_ASSERT_EQUAL_INT(2, r2d_world_particle_emit_burst(&pool, &proto, 2, 0, 0, 0, 0, 0));
    pool.items[0].vx = NAN;
    r2d_world_particle_step(&pool, 0.1f);

    TEST_ASSERT_EQUAL_INT_MESSAGE(1, pool.count, "NaN particle is dropped");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, r2d_world_particle_alive(&pool), "only the sane particle lives");
    TEST_ASSERT_TRUE_MESSAGE(isfinite(pool.items[0].x), "surviving particle stays finite");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 5.2f, pool.items[0].x, "surviving particle stepped");
}

static void test_seed_determinism(void)
{
    R2DWorldParticle proto = make_proto();
    proto.max_life = 3.0f;
    proto.size = 2.0f;
    proto.end_size = 0.5f;
    proto.end_alpha = 0.0f;
    proto.gravity = -5.0f;

    R2DWorldParticlePool a, b, c;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&a, g_storage_256, 256));
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&b, g_storage_512, 256));
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&c, g_storage_64, 64));

    a.seed = 0xC0FFEEu;
    b.seed = 0xC0FFEEu;
    c.seed = 0xBEEF11u;

    for (int run = 0; run < 2; ++run) {
        R2DWorldParticlePool *pool = run == 0 ? &a : &b;
        TEST_ASSERT_EQUAL_INT(60, r2d_world_particle_emit_burst(pool, &proto, 60, 2.0f, 7.0f,
                                                               0.3f, 0.4f, 0.5f));
        float acc = 0.0f;
        for (int i = 0; i < 10; ++i) {
            r2d_world_particle_emit_continuous(pool, &proto, 1.0f / 60.0f, 40.0f,
                                               0.5f, 1.0f, 0.0f, 1.0f, 0.0f, &acc);
        }
        for (int i = 0; i < 5; ++i) r2d_world_particle_step(pool, 1.0f / 60.0f);
    }
    TEST_ASSERT_EQUAL_UINT64_MESSAGE(hash_pool(&a), hash_pool(&b),
                                     "same seed and calls produce identical pools");
    TEST_ASSERT_NOT_EQUAL_MESSAGE(hash_pool(&a), hash_pool(&c),
                                  "a different seed changes the stream");

    // Clearing preserves the seed, so a replay continues the same stream.
    uint32_t seed_a = a.seed;
    r2d_world_particle_clear(&a);
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(seed_a, a.seed, "clear preserves the seed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, a.count, "clear empties the pool");
}

static void test_alive_and_clear(void)
{
    R2DWorldParticlePool pool;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool, g_storage_16, 16));
    R2DWorldParticle proto = make_proto();
    proto.max_life = 1.0f;

    TEST_ASSERT_EQUAL_INT(5, r2d_world_particle_emit_burst(&pool, &proto, 5, 0, 0, 0, 0, 0));
    TEST_ASSERT_EQUAL_INT_MESSAGE(5, r2d_world_particle_alive(&pool), "alive counts spawned particles");

    for (int i = 0; i < 4; ++i) r2d_world_particle_step(&pool, 0.25f);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_particle_alive(&pool), "expired particles are not alive");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, pool.count, "expired particles are compacted away");

    TEST_ASSERT_EQUAL_INT(3, r2d_world_particle_emit_burst(&pool, &proto, 3, 0, 0, 0, 0, 0));
    pool.seed = 7u;
    pool.overflow = 9;
    r2d_world_particle_clear(&pool);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, pool.count, "clear resets count");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, pool.overflow, "clear resets overflow");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(7u, pool.seed, "clear preserves seed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_particle_alive(&pool), "clear drops all particles");
    for (int i = 0; i < 16; ++i) {
        TEST_ASSERT_FALSE_MESSAGE(pool.items[i].active, "clear deactivates every slot");
    }
    TEST_ASSERT_EQUAL_INT(2, r2d_world_particle_emit_burst(&pool, &proto, 2, 0, 0, 0, 0, 0));
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, r2d_world_particle_alive(&pool), "pool is reusable after clear");

    TEST_ASSERT_EQUAL_INT_MESSAGE(0, r2d_world_particle_alive(NULL), "alive(NULL) is 0");
    r2d_world_particle_clear(NULL);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_init_validation);
    RUN_TEST(test_random_deterministic_and_range);
    RUN_TEST(test_burst_count_spread_and_direction);
    RUN_TEST(test_burst_invalid_and_noop);
    RUN_TEST(test_continuous_60hz_and_120hz);
    RUN_TEST(test_continuous_invalid);
    RUN_TEST(test_step_math_gravity);
    RUN_TEST(test_step_screen_ignores_gravity);
    RUN_TEST(test_step_drag_rotation_and_curves);
    RUN_TEST(test_life_expiry_exact);
    RUN_TEST(test_pool_overflow_evicts_oldest);
    RUN_TEST(test_step_clamps_dt);
    RUN_TEST(test_nan_particle_dropped);
    RUN_TEST(test_seed_determinism);
    RUN_TEST(test_alive_and_clear);
    return UNITY_END();
}
