#include "re2d_world_mover.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-5f

static bool float_bits_equal(float a, float b)
{
    return memcmp(&a, &b, sizeof a) == 0;
}

static R2DWorldMover make_mover(int type, int span, float from, float to,
                                float speed, float wait, bool auto_return)
{
    R2DWorldMover m;
    memset(&m, 0, sizeof m);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_mover_init(&m, type, span, from, to,
                                                  speed, wait, auto_return),
                             "valid mover fixture initialises");
    return m;
}

static void run_until_idle(R2DWorldMover *m, float dt, int max_steps,
                           unsigned *all_events)
{
    unsigned all = 0;
    for (int i = 0; i < max_steps; i++) {
        unsigned ev = 0;
        r2d_world_mover_step(m, dt, &ev);
        all |= ev;
        if (m->phase == R2D_MOVER_IDLE) break;
    }
    if (all_events) *all_events = all;
}

static void test_init_validation(void)
{
    R2DWorldMover m;
    memset(&m, 0, sizeof m);

    TEST_ASSERT_FALSE(r2d_world_mover_init(NULL, R2D_MOVER_DOOR, 0, 0, 10, 10, 0, false));
    TEST_ASSERT_FALSE(r2d_world_mover_init(&m, 4, 0, 0, 10, 10, 0, false));
    TEST_ASSERT_FALSE(r2d_world_mover_init(&m, -1, 0, 0, 10, 10, 0, false));
    TEST_ASSERT_FALSE(r2d_world_mover_init(&m, R2D_MOVER_DOOR, -1, 0, 10, 10, 0, false));
    TEST_ASSERT_FALSE(r2d_world_mover_init(&m, R2D_MOVER_DOOR, 0, 5, 5, 10, 0, false));
    TEST_ASSERT_FALSE(r2d_world_mover_init(&m, R2D_MOVER_DOOR, 0, NAN, 10, 10, 0, false));
    TEST_ASSERT_FALSE(r2d_world_mover_init(&m, R2D_MOVER_DOOR, 0, 0, INFINITY, 10, 0, false));
    TEST_ASSERT_FALSE(r2d_world_mover_init(&m, R2D_MOVER_DOOR, 0, 0, 10, 0, 0, false));
    TEST_ASSERT_FALSE(r2d_world_mover_init(&m, R2D_MOVER_DOOR, 0, 0, 10, -1, 0, false));
    TEST_ASSERT_FALSE(r2d_world_mover_init(&m, R2D_MOVER_DOOR, 0, 0, 10, NAN, 0, false));
    TEST_ASSERT_FALSE(r2d_world_mover_init(&m, R2D_MOVER_DOOR, 0, 0, 10, 1, -1, false));
    TEST_ASSERT_FALSE(r2d_world_mover_init(&m, R2D_MOVER_DOOR, 0, 0, 10, 1, INFINITY, false));

    unsigned ev = 0xffffffffu;
    TEST_ASSERT_FALSE(r2d_world_mover_step(NULL, 1.0f / 60.0f, &ev));
    TEST_ASSERT_EQUAL_UINT(0u, ev);
    r2d_world_mover_open(NULL);
    r2d_world_mover_close(NULL);
    r2d_world_mover_toggle(NULL);

    TEST_ASSERT_TRUE(r2d_world_mover_init(&m, R2D_MOVER_DOOR, 3, 0.0f, 64.0f, 32.0f, 1.5f, true));
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_DOOR, m.type);
    TEST_ASSERT_EQUAL_INT(3, m.span);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, m.from);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 64.0f, m.to);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 32.0f, m.speed);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.5f, m.wait);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, m.position);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, m.fraction);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_IDLE, m.phase);
    TEST_ASSERT_EQUAL_INT(1, m.direction);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, m.timer);
    TEST_ASSERT_TRUE(m.auto_return);
    TEST_ASSERT_TRUE(m.arrived);
    TEST_ASSERT_FALSE(m.blocking);

    // Descending endpoints (ceiling mover) are valid; +1 still means "toward to".
    R2DWorldMover ceiling = make_mover(R2D_MOVER_LIFT, 2, 200.0f, 100.0f, 50.0f, 0.0f, false);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 200.0f, ceiling.position);
    TEST_ASSERT_EQUAL_INT(1, ceiling.direction);
}

static void test_door_open_arrives_once(void)
{
    R2DWorldMover m = make_mover(R2D_MOVER_DOOR, 3, 0.0f, 64.0f, 64.0f, 0.0f, false);
    unsigned ev = 0;

    r2d_world_mover_open(&m);
    TEST_ASSERT_TRUE(r2d_world_mover_step(&m, 1.0f / 60.0f, &ev));
    TEST_ASSERT_TRUE((ev & R2D_MOVER_EVENT_STARTED) != 0);
    TEST_ASSERT_TRUE((ev & R2D_MOVER_EVENT_REOPENED) != 0);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 64.0f / 60.0f, m.position);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f / 60.0f, m.fraction);

    int arrived = 0, closed = 0, started = 0;
    for (int i = 0; i < 200; i++) {
        unsigned e = 0;
        r2d_world_mover_step(&m, 1.0f / 60.0f, &e);
        if (e & R2D_MOVER_EVENT_ARRIVED) arrived++;
        if (e & R2D_MOVER_EVENT_CLOSED) closed++;
        if (e & R2D_MOVER_EVENT_STARTED) started++;
    }
    TEST_ASSERT_EQUAL_INT(1, arrived);
    TEST_ASSERT_EQUAL_INT(0, closed);
    TEST_ASSERT_EQUAL_INT(0, started);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 64.0f, m.position);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, m.fraction);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_IDLE, m.phase);
    TEST_ASSERT_TRUE(m.arrived);
    TEST_ASSERT_EQUAL_INT(1, m.direction);

    ev = 0xffffffffu;
    TEST_ASSERT_FALSE(r2d_world_mover_step(&m, 1.0f / 60.0f, &ev));
    TEST_ASSERT_EQUAL_UINT(0u, ev);
}

static void test_door_close_returns_from(void)
{
    R2DWorldMover m = make_mover(R2D_MOVER_DOOR, 0, 0.0f, 64.0f, 64.0f, 0.0f, false);
    unsigned all = 0;
    r2d_world_mover_open(&m);
    run_until_idle(&m, 1.0f / 60.0f, 200, &all);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 64.0f, m.position);

    r2d_world_mover_close(&m);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_MOVING, m.phase);
    TEST_ASSERT_EQUAL_INT(-1, m.direction);

    unsigned ev = 0;
    TEST_ASSERT_TRUE(r2d_world_mover_step(&m, 1.0f / 60.0f, &ev));
    TEST_ASSERT_TRUE((ev & R2D_MOVER_EVENT_STARTED) != 0);
    TEST_ASSERT_FALSE((ev & R2D_MOVER_EVENT_REOPENED) != 0);

    int arrived = 0, closed = 0;
    for (int i = 0; i < 200; i++) {
        unsigned e = 0;
        r2d_world_mover_step(&m, 1.0f / 60.0f, &e);
        if (e & R2D_MOVER_EVENT_ARRIVED) arrived++;
        if (e & R2D_MOVER_EVENT_CLOSED) closed++;
    }
    TEST_ASSERT_EQUAL_INT(0, arrived);
    TEST_ASSERT_EQUAL_INT(1, closed);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, m.position);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, m.fraction);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_IDLE, m.phase);
    TEST_ASSERT_TRUE(m.arrived);

    // Closing an already-closed idle door is a no-op.
    r2d_world_mover_close(&m);
    ev = 0xffffffffu;
    TEST_ASSERT_FALSE(r2d_world_mover_step(&m, 1.0f / 60.0f, &ev));
    TEST_ASSERT_EQUAL_UINT(0u, ev);
}

static void test_door_toggle_twice(void)
{
    // Two toggles before the first step cancel into an immediate close.
    R2DWorldMover m = make_mover(R2D_MOVER_DOOR, 0, 0.0f, 64.0f, 64.0f, 0.0f, false);
    r2d_world_mover_toggle(&m);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_MOVING, m.phase);
    TEST_ASSERT_EQUAL_INT(1, m.direction);
    r2d_world_mover_toggle(&m);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_MOVING, m.phase);
    TEST_ASSERT_EQUAL_INT(-1, m.direction);

    unsigned ev = 0xffffffffu;
    TEST_ASSERT_FALSE(r2d_world_mover_step(&m, 1.0f / 60.0f, &ev));
    TEST_ASSERT_TRUE((ev & R2D_MOVER_EVENT_STARTED) != 0);
    TEST_ASSERT_TRUE((ev & R2D_MOVER_EVENT_CLOSED) != 0);
    TEST_ASSERT_FALSE((ev & R2D_MOVER_EVENT_ARRIVED) != 0);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_IDLE, m.phase);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, m.position);

    // A normal toggle cycle: open to `to`, toggle, close to `from`.
    r2d_world_mover_toggle(&m);
    unsigned all = 0;
    run_until_idle(&m, 1.0f / 60.0f, 200, &all);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 64.0f, m.position);
    TEST_ASSERT_TRUE((all & R2D_MOVER_EVENT_ARRIVED) != 0);

    r2d_world_mover_toggle(&m);
    all = 0;
    run_until_idle(&m, 1.0f / 60.0f, 200, &all);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, m.position);
    TEST_ASSERT_TRUE((all & R2D_MOVER_EVENT_CLOSED) != 0);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_IDLE, m.phase);
}

static void test_lift_auto_return_after_wait(void)
{
    R2DWorldMover m = make_mover(R2D_MOVER_LIFT, 1, 0.0f, 40.0f, 40.0f, 0.5f, true);
    r2d_world_mover_open(&m);

    bool waiting = false;
    int arrived = 0;
    for (int i = 0; i < 500; i++) {
        unsigned e = 0;
        r2d_world_mover_step(&m, 1.0f / 60.0f, &e);
        if (e & R2D_MOVER_EVENT_ARRIVED) arrived++;
        if (m.phase == R2D_MOVER_WAITING) { waiting = true; break; }
    }
    TEST_ASSERT_TRUE(waiting);
    TEST_ASSERT_EQUAL_INT(1, arrived);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 40.0f, m.position);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, m.fraction);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.5f, m.timer);

    for (int i = 0; i < 29; i++) {
        unsigned e = 0;
        r2d_world_mover_step(&m, 1.0f / 60.0f, &e);
        TEST_ASSERT_EQUAL_INT(R2D_MOVER_WAITING, m.phase);
        TEST_ASSERT_FLOAT_WITHIN(EPS, 40.0f, m.position);
    }

    unsigned ev = 0;
    TEST_ASSERT_FALSE(r2d_world_mover_step(&m, 1.0f / 60.0f, &ev));
    TEST_ASSERT_TRUE((ev & R2D_MOVER_EVENT_STARTED) != 0);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_MOVING, m.phase);
    TEST_ASSERT_EQUAL_INT(-1, m.direction);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 40.0f, m.position);

    int closed = 0;
    for (int i = 0; i < 300; i++) {
        unsigned e = 0;
        r2d_world_mover_step(&m, 1.0f / 60.0f, &e);
        if (e & R2D_MOVER_EVENT_CLOSED) closed++;
    }
    TEST_ASSERT_EQUAL_INT(1, closed);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, m.position);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.0f, m.fraction);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_IDLE, m.phase);

    // wait == 0 means "stay": an auto-return lift remains parked at `to`.
    R2DWorldMover stay = make_mover(R2D_MOVER_LIFT, 1, 0.0f, 20.0f, 20.0f, 0.0f, true);
    r2d_world_mover_open(&stay);
    for (int i = 0; i < 300; i++) {
        unsigned e = 0;
        r2d_world_mover_step(&stay, 1.0f / 60.0f, &e);
    }
    TEST_ASSERT_FLOAT_WITHIN(EPS, 20.0f, stay.position);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_IDLE, stay.phase);
}

static void test_crusher_reversal_and_no_escape(void)
{
    R2DWorldMover m = make_mover(R2D_MOVER_CRUSHER, 0, 0.0f, 100.0f, 100.0f, 0.0f, true);
    r2d_world_mover_open(&m);

    int arrived = 0, closed = 0;
    bool escaped = false;
    for (int i = 0; i < 1000; i++) {
        unsigned e = 0;
        r2d_world_mover_step(&m, 1.0f / 60.0f, &e);
        if (e & R2D_MOVER_EVENT_ARRIVED) arrived++;
        if (e & R2D_MOVER_EVENT_CLOSED) closed++;
        if (!isfinite(m.position) || !isfinite(m.fraction)) escaped = true;
        if (m.position < -EPS || m.position > 100.0f + EPS) escaped = true;
        if (m.fraction < 0.0f || m.fraction > 1.0f) escaped = true;
    }
    TEST_ASSERT_FALSE(escaped);
    TEST_ASSERT_TRUE(arrived >= 3);
    TEST_ASSERT_TRUE(closed >= 3);
    TEST_ASSERT_TRUE((arrived - closed) <= 1 && (closed - arrived) <= 1);

    // With wait > 0 the crusher dwells at the endpoint before reversing.
    R2DWorldMover dwell = make_mover(R2D_MOVER_CRUSHER, 0, 0.0f, 10.0f, 50.0f, 0.2f, true);
    r2d_world_mover_open(&dwell);
    bool waiting = false;
    for (int i = 0; i < 100; i++) {
        unsigned e = 0;
        r2d_world_mover_step(&dwell, 1.0f / 60.0f, &e);
        if (dwell.phase == R2D_MOVER_WAITING) { waiting = true; break; }
    }
    TEST_ASSERT_TRUE(waiting);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 10.0f, dwell.position);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 0.2f, dwell.timer);
    for (int i = 0; i < 20; i++) {
        unsigned e = 0;
        r2d_world_mover_step(&dwell, 1.0f / 60.0f, &e);
    }
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_MOVING, dwell.phase);
    TEST_ASSERT_EQUAL_INT(-1, dwell.direction);
}

static void test_blocked_pause_resume(void)
{
    R2DWorldMover m = make_mover(R2D_MOVER_DOOR, 0, 0.0f, 100.0f, 100.0f, 0.0f, false);
    r2d_world_mover_open(&m);
    for (int i = 0; i < 10; i++) {
        unsigned e = 0;
        r2d_world_mover_step(&m, 1.0f / 60.0f, &e);
    }
    const float paused_at = m.position;
    TEST_ASSERT_TRUE(paused_at > 0.0f);

    m.blocking = true;
    unsigned ev = 0;
    TEST_ASSERT_FALSE(r2d_world_mover_step(&m, 1.0f / 60.0f, &ev));
    TEST_ASSERT_TRUE((ev & R2D_MOVER_EVENT_BLOCKED) != 0);
    TEST_ASSERT_FLOAT_WITHIN(EPS, paused_at, m.position);

    ev = 0xffffffffu;
    TEST_ASSERT_FALSE(r2d_world_mover_step(&m, 1.0f / 60.0f, &ev));
    TEST_ASSERT_EQUAL_UINT(0u, ev);
    TEST_ASSERT_FLOAT_WITHIN(EPS, paused_at, m.position);

    m.blocking = false;
    ev = 0;
    TEST_ASSERT_TRUE(r2d_world_mover_step(&m, 1.0f / 60.0f, &ev));
    TEST_ASSERT_TRUE((ev & R2D_MOVER_EVENT_STARTED) != 0);
    TEST_ASSERT_TRUE(m.position > paused_at);

    // Crusher backs away: blocking flips its direction, resume travels down.
    R2DWorldMover c = make_mover(R2D_MOVER_CRUSHER, 0, 0.0f, 100.0f, 100.0f, 0.0f, true);
    r2d_world_mover_open(&c);
    for (int i = 0; i < 20; i++) {
        unsigned e = 0;
        r2d_world_mover_step(&c, 1.0f / 60.0f, &e);
    }
    const float crusher_at = c.position;
    TEST_ASSERT_TRUE(crusher_at > 0.0f);
    TEST_ASSERT_EQUAL_INT(1, c.direction);

    c.blocking = true;
    ev = 0;
    TEST_ASSERT_FALSE(r2d_world_mover_step(&c, 1.0f / 60.0f, &ev));
    TEST_ASSERT_TRUE((ev & R2D_MOVER_EVENT_BLOCKED) != 0);
    TEST_ASSERT_EQUAL_INT(-1, c.direction);
    TEST_ASSERT_FLOAT_WITHIN(EPS, crusher_at, c.position);

    c.blocking = false;
    ev = 0;
    TEST_ASSERT_TRUE(r2d_world_mover_step(&c, 1.0f / 60.0f, &ev));
    TEST_ASSERT_TRUE((ev & R2D_MOVER_EVENT_STARTED) != 0);
    TEST_ASSERT_TRUE(c.position < crusher_at);
}

static void test_open_idempotent(void)
{
    R2DWorldMover m = make_mover(R2D_MOVER_DOOR, 0, 0.0f, 32.0f, 32.0f, 0.0f, false);
    r2d_world_mover_open(&m);
    unsigned all = 0;
    run_until_idle(&m, 1.0f / 60.0f, 200, &all);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 32.0f, m.position);

    R2DWorldMover before = m;
    r2d_world_mover_open(&m);
    TEST_ASSERT_EQUAL_INT(0, memcmp(&before, &m, sizeof m));
    unsigned ev = 0xffffffffu;
    TEST_ASSERT_FALSE(r2d_world_mover_step(&m, 1.0f / 60.0f, &ev));
    TEST_ASSERT_EQUAL_UINT(0u, ev);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 32.0f, m.position);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_IDLE, m.phase);

    // open() while a lift is dwelling at `to` must not restart the wait.
    R2DWorldMover lift = make_mover(R2D_MOVER_LIFT, 0, 0.0f, 10.0f, 10.0f, 1.0f, true);
    r2d_world_mover_open(&lift);
    for (int i = 0; i < 200; i++) {
        unsigned e = 0;
        r2d_world_mover_step(&lift, 1.0f / 60.0f, &e);
        if (lift.phase == R2D_MOVER_WAITING) break;
    }
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_WAITING, lift.phase);
    const float timer_before = lift.timer;
    r2d_world_mover_open(&lift);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_WAITING, lift.phase);
    TEST_ASSERT_TRUE(float_bits_equal(timer_before, lift.timer));
    ev = 0;
    r2d_world_mover_step(&lift, 0.1f, &ev);
    TEST_ASSERT_EQUAL_INT(R2D_MOVER_WAITING, lift.phase);
    TEST_ASSERT_FLOAT_WITHIN(EPS, timer_before - 0.1f, lift.timer);
}

static void test_dt_clamp(void)
{
    R2DWorldMover m = make_mover(R2D_MOVER_DOOR, 0, 0.0f, 100.0f, 100.0f, 0.0f, false);
    r2d_world_mover_open(&m);

    unsigned ev = 0;
    TEST_ASSERT_TRUE(r2d_world_mover_step(&m, 10.0f, &ev));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 25.0f, m.position);

    ev = 0xffffffffu;
    TEST_ASSERT_FALSE(r2d_world_mover_step(&m, -5.0f, &ev));
    TEST_ASSERT_EQUAL_UINT(0u, ev);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 25.0f, m.position);

    ev = 0xffffffffu;
    TEST_ASSERT_FALSE(r2d_world_mover_step(&m, NAN, &ev));
    TEST_ASSERT_EQUAL_UINT(0u, ev);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 25.0f, m.position);

    ev = 0xffffffffu;
    TEST_ASSERT_FALSE(r2d_world_mover_step(&m, 0.0f, &ev));
    TEST_ASSERT_EQUAL_UINT(0u, ev);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 25.0f, m.position);

    // +infinity clamps to the 0.25 s maximum.
    TEST_ASSERT_TRUE(r2d_world_mover_step(&m, INFINITY, &ev));
    TEST_ASSERT_FLOAT_WITHIN(EPS, 50.0f, m.position);

    for (int i = 0; i < 20; i++) {
        unsigned e = 0;
        r2d_world_mover_step(&m, 10.0f, &e);
        TEST_ASSERT_TRUE(m.position <= 100.0f + EPS);
    }
    TEST_ASSERT_FLOAT_WITHIN(EPS, 100.0f, m.position);
    TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, m.fraction);
}

static void test_deterministic_10k_ticks(void)
{
    static const float dts[4] = {
        1.0f / 60.0f, 1.0f / 120.0f, 0.02f, 1.0f / 30.0f
    };
    R2DWorldMover a = make_mover(R2D_MOVER_CRUSHER, 2, 0.0f, 90.0f, 37.5f, 0.05f, true);
    R2DWorldMover b = a;
    r2d_world_mover_open(&a);
    r2d_world_mover_open(&b);

    bool identical = true;
    for (int i = 0; i < 10000; i++) {
        if (i == 777) {
            r2d_world_mover_toggle(&a);
            r2d_world_mover_toggle(&b);
        }
        if (i == 8888) {
            r2d_world_mover_close(&a);
            r2d_world_mover_close(&b);
        }
        const float dt = dts[i % 4];
        unsigned ea = 0, eb = 0;
        const bool ca = r2d_world_mover_step(&a, dt, &ea);
        const bool cb = r2d_world_mover_step(&b, dt, &eb);
        if (ca != cb || ea != eb) identical = false;
        if (!float_bits_equal(a.position, b.position)) identical = false;
        if (!float_bits_equal(a.fraction, b.fraction)) identical = false;
        if (!float_bits_equal(a.timer, b.timer)) identical = false;
        if (a.phase != b.phase || a.direction != b.direction) identical = false;
        if (a.arrived != b.arrived || a.blocking != b.blocking) identical = false;
    }
    TEST_ASSERT_TRUE(identical);
    TEST_ASSERT_TRUE(isfinite(a.position));
    TEST_ASSERT_TRUE(isfinite(a.fraction));
    TEST_ASSERT_TRUE(a.position >= -EPS && a.position <= 90.0f + EPS);
}

static void test_fixed_step_equivalence(void)
{
    static const float rates[3] = { 30.0f, 60.0f, 120.0f };
    float totals[3];
    float midpoints[3];

    for (int r = 0; r < 3; r++) {
        const float dt = 1.0f / rates[r];
        R2DWorldMover m = make_mover(R2D_MOVER_DOOR, 0, 0.0f, 120.0f, 60.0f, 0.0f, false);
        r2d_world_mover_open(&m);

        int ticks = 0;
        for (int i = 0; i < 100000; i++) {
            unsigned e = 0;
            r2d_world_mover_step(&m, dt, &e);
            ticks++;
            if (m.phase == R2D_MOVER_IDLE && m.position >= 120.0f - EPS) break;
        }
        TEST_ASSERT_FLOAT_WITHIN(EPS, 120.0f, m.position);
        TEST_ASSERT_FLOAT_WITHIN(EPS, 1.0f, m.fraction);
        totals[r] = (float)ticks * dt;

        R2DWorldMover mid = make_mover(R2D_MOVER_DOOR, 0, 0.0f, 120.0f, 60.0f, 0.0f, false);
        r2d_world_mover_open(&mid);
        const int mid_ticks = (int)rates[r];
        for (int i = 0; i < mid_ticks; i++) {
            unsigned e = 0;
            r2d_world_mover_step(&mid, dt, &e);
        }
        midpoints[r] = mid.position;
    }

    const float travel = 2.0f;   // 120 units at 60 units/second
    for (int r = 0; r < 3; r++) {
        TEST_ASSERT_FLOAT_WITHIN(0.01f, travel, totals[r]);
        TEST_ASSERT_FLOAT_WITHIN(0.01f, 60.0f, midpoints[r]);
    }
    float lo = totals[0], hi = totals[0];
    for (int r = 1; r < 3; r++) {
        if (totals[r] < lo) lo = totals[r];
        if (totals[r] > hi) hi = totals[r];
    }
    TEST_ASSERT_TRUE(hi - lo <= 0.01f);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_init_validation);
    RUN_TEST(test_door_open_arrives_once);
    RUN_TEST(test_door_close_returns_from);
    RUN_TEST(test_door_toggle_twice);
    RUN_TEST(test_lift_auto_return_after_wait);
    RUN_TEST(test_crusher_reversal_and_no_escape);
    RUN_TEST(test_blocked_pause_resume);
    RUN_TEST(test_open_idempotent);
    RUN_TEST(test_dt_clamp);
    RUN_TEST(test_deterministic_10k_ticks);
    RUN_TEST(test_fixed_step_equivalence);
    return UNITY_END();
}
