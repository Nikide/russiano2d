#include "re2d_world_secret.h"
#include "unity.h"
#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static R2DWorldSecret make_secret(const char *id, bool once)
{
    R2DWorldSecret s;
    bool ok = r2d_world_secret_init(&s, id, 0.0f, 0.0f, 10.0f, 0.0f, 100.0f, once);
    TEST_ASSERT_TRUE_MESSAGE(ok, "secret fixture init");
    return s;
}

static R2DWorldBreakable make_breakable(const char *id, int hp)
{
    R2DWorldBreakable b;
    bool ok = r2d_world_breakable_init(&b, id, hp, 2, 7, 0.0f, 0.0f, 8.0f, 0.0f, 100.0f);
    TEST_ASSERT_TRUE_MESSAGE(ok, "breakable fixture init");
    return b;
}

static void test_secret_init_and_invalid_input(void)
{
    R2DWorldSecret s;
    TEST_ASSERT_TRUE(r2d_world_secret_init(&s, "secret.room", 1.0f, 2.0f, 3.0f, 4.0f, 5.0f, true));
    TEST_ASSERT_EQUAL_STRING("secret.room", s.id);
    TEST_ASSERT_EQUAL_FLOAT(1.0f, s.x);
    TEST_ASSERT_EQUAL_FLOAT(2.0f, s.y);
    TEST_ASSERT_EQUAL_FLOAT(3.0f, s.radius);
    TEST_ASSERT_EQUAL_FLOAT(4.0f, s.bottom);
    TEST_ASSERT_EQUAL_FLOAT(5.0f, s.top);
    TEST_ASSERT_TRUE(s.once);
    TEST_ASSERT_FALSE(s.entered);
    TEST_ASSERT_FALSE(s.found);
    TEST_ASSERT_EQUAL_INT(0, s.found_count);
    TEST_ASSERT_EQUAL_INT(R2D_SECRET_HIDDEN, r2d_world_secret_state(&s));

    TEST_ASSERT_FALSE(r2d_world_secret_init(NULL, "x", 0, 0, 1, 0, 1, false));
    TEST_ASSERT_FALSE(r2d_world_secret_init(&s, NULL, 0, 0, 1, 0, 1, false));
    TEST_ASSERT_EQUAL_INT(R2D_SECRET_HIDDEN, r2d_world_secret_state(&s));
    TEST_ASSERT_FALSE(r2d_world_secret_init(&s, "x", NAN, 0, 1, 0, 1, false));
    TEST_ASSERT_FALSE(r2d_world_secret_init(&s, "x", 0, 0, 0, 0, 1, false));
    TEST_ASSERT_FALSE(r2d_world_secret_init(&s, "x", 0, 0, 1, 1, 1, false));
    char long_id[65];
    memset(long_id, 'a', 64);
    long_id[64] = '\0';
    TEST_ASSERT_FALSE(r2d_world_secret_init(&s, long_id, 0, 0, 1, 0, 1, false));
    TEST_ASSERT_EQUAL_STRING("", s.id);
    TEST_ASSERT_EQUAL_INT(0, s.found_count);
    TEST_ASSERT_EQUAL_INT(R2D_SECRET_HIDDEN, r2d_world_secret_state(NULL));
}

static void test_secret_enter_and_reenter(void)
{
    R2DWorldSecret s = make_secret("s.enter", false);
    TEST_ASSERT_EQUAL_INT(1, r2d_world_secret_touch(&s, 0.0f, 0.0f, 50.0f));
    TEST_ASSERT_TRUE(s.found);
    TEST_ASSERT_TRUE(s.entered);
    TEST_ASSERT_EQUAL_INT(1, s.found_count);
    TEST_ASSERT_EQUAL_INT(R2D_SECRET_FOUND, r2d_world_secret_state(&s));

    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&s, 1.0f, 1.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(1, s.found_count);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&s, 100.0f, 0.0f, 50.0f));
    TEST_ASSERT_FALSE(s.entered);
    TEST_ASSERT_EQUAL_INT(1, r2d_world_secret_touch(&s, 0.0f, 0.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(2, s.found_count);
    TEST_ASSERT_TRUE(s.found);
}

static void test_secret_once_semantics(void)
{
    R2DWorldSecret s = make_secret("s.once", true);
    TEST_ASSERT_EQUAL_INT(1, r2d_world_secret_touch(&s, 0.0f, 0.0f, 10.0f));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&s, 50.0f, 0.0f, 10.0f));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&s, 0.0f, 0.0f, 10.0f));
    TEST_ASSERT_EQUAL_INT(1, s.found_count);
    TEST_ASSERT_TRUE(s.found);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&s, 50.0f, 0.0f, 10.0f));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&s, 0.0f, 0.0f, 10.0f));
    TEST_ASSERT_EQUAL_INT(1, s.found_count);
}

static void test_secret_outside_and_height_rejection(void)
{
    R2DWorldSecret s = make_secret("s.bounds", false);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&s, 10.5f, 0.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&s, 0.0f, 0.0f, -0.1f));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&s, 0.0f, 0.0f, 100.1f));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&s, NAN, 0.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&s, 0.0f, 0.0f, NAN));
    TEST_ASSERT_FALSE(s.found);
    TEST_ASSERT_EQUAL_INT(0, s.found_count);

    // Inclusive boundaries: exact radius edge, exact top and exact bottom.
    TEST_ASSERT_EQUAL_INT(1, r2d_world_secret_touch(&s, 10.0f, 0.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&s, 50.0f, 0.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(1, r2d_world_secret_touch(&s, 0.0f, 0.0f, 0.0f));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&s, 50.0f, 0.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(1, r2d_world_secret_touch(&s, 0.0f, 0.0f, 100.0f));
    TEST_ASSERT_EQUAL_INT(3, s.found_count);
}

static void test_secret_reset(void)
{
    R2DWorldSecret s = make_secret("s.reset", true);
    TEST_ASSERT_EQUAL_INT(1, r2d_world_secret_touch(&s, 0.0f, 0.0f, 50.0f));
    s.timer = 1.5f;
    r2d_world_secret_reset(&s);
    TEST_ASSERT_FALSE(s.entered);
    TEST_ASSERT_FALSE(s.found);
    TEST_ASSERT_EQUAL_INT(0, s.found_count);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, s.timer);
    TEST_ASSERT_EQUAL_STRING("s.reset", s.id);
    TEST_ASSERT_EQUAL_FLOAT(10.0f, s.radius);
    TEST_ASSERT_TRUE(s.once);
    TEST_ASSERT_EQUAL_INT(1, r2d_world_secret_touch(&s, 0.0f, 0.0f, 50.0f));
    r2d_world_secret_reset(NULL);
}

static void test_secret_presentation_timer(void)
{
    R2DWorldSecret s = make_secret("s.timer", false);
    r2d_world_secret_step(&s, 0.1f);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, s.timer);
    TEST_ASSERT_EQUAL_INT(1, r2d_world_secret_touch(&s, 0.0f, 0.0f, 50.0f));
    r2d_world_secret_step(&s, 0.1f);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.1f, s.timer);
    r2d_world_secret_step(&s, 1.0f); // clamped to 0.25
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.35f, s.timer);
    r2d_world_secret_step(&s, NAN);
    r2d_world_secret_step(&s, -1.0f);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.35f, s.timer);
    for (int i = 0; i < 20000; ++i) r2d_world_secret_step(&s, 1.0f);
    TEST_ASSERT_EQUAL_FLOAT(3600.0f, s.timer);
    r2d_world_secret_step(NULL, 0.1f);
}

static void test_breakable_init_and_invalid_input(void)
{
    R2DWorldBreakable b;
    TEST_ASSERT_TRUE(r2d_world_breakable_init(&b, "wall.crate", 100, 3, 9, 5.0f, 6.0f, 7.0f, 0.0f, 60.0f));
    TEST_ASSERT_EQUAL_STRING("wall.crate", b.id);
    TEST_ASSERT_EQUAL_INT(100, b.hp);
    TEST_ASSERT_EQUAL_INT(100, b.max_hp);
    TEST_ASSERT_FALSE(b.broken);
    TEST_ASSERT_EQUAL_INT(3, b.variant);
    TEST_ASSERT_EQUAL_INT(9, b.portal);
    TEST_ASSERT_EQUAL_FLOAT(5.0f, b.x);
    TEST_ASSERT_EQUAL_FLOAT(60.0f, b.top);

    TEST_ASSERT_FALSE(r2d_world_breakable_init(NULL, "x", 1, 0, -1, 0, 0, 1, 0, 1));
    TEST_ASSERT_FALSE(r2d_world_breakable_init(&b, NULL, 1, 0, -1, 0, 0, 1, 0, 1));
    TEST_ASSERT_FALSE(r2d_world_breakable_init(&b, "x", 0, 0, -1, 0, 0, 1, 0, 1));
    TEST_ASSERT_FALSE(r2d_world_breakable_init(&b, "x", 1, -1, -1, 0, 0, 1, 0, 1));
    TEST_ASSERT_FALSE(r2d_world_breakable_init(&b, "x", 1, 0, -2, 0, 0, 1, 0, 1));
    TEST_ASSERT_FALSE(r2d_world_breakable_init(&b, "x", 1, 0, -1, NAN, 0, 1, 0, 1));
    TEST_ASSERT_FALSE(r2d_world_breakable_init(&b, "x", 1, 0, -1, 0, 0, 0, 0, 1));
    TEST_ASSERT_FALSE(r2d_world_breakable_init(&b, "x", 1, 0, -1, 0, 0, 1, 1, 1));
    TEST_ASSERT_EQUAL_INT(0, b.max_hp);
    TEST_ASSERT_FALSE(b.broken);
    TEST_ASSERT_EQUAL_STRING("", b.id);
}

static void test_breakable_damage_accumulation(void)
{
    R2DWorldBreakable b = make_breakable("b.crate", 100);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_breakable_hit(&b, 30));
    TEST_ASSERT_EQUAL_INT(70, b.hp);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_breakable_hit(&b, 30));
    TEST_ASSERT_EQUAL_INT(40, b.hp);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_breakable_hit(&b, 39));
    TEST_ASSERT_EQUAL_INT(1, b.hp);
    TEST_ASSERT_FALSE(b.broken);
    TEST_ASSERT_EQUAL_INT(1, r2d_world_breakable_hit(&b, 1));
    TEST_ASSERT_EQUAL_INT(0, b.hp);
    TEST_ASSERT_TRUE(b.broken);
    TEST_ASSERT_EQUAL_INT(100, b.max_hp);
}

static void test_breakable_break_transition_once_and_overkill(void)
{
    R2DWorldBreakable b = make_breakable("b.overkill", 10);
    TEST_ASSERT_EQUAL_INT(1, r2d_world_breakable_hit(&b, 999));
    TEST_ASSERT_EQUAL_INT(0, b.hp);
    TEST_ASSERT_EQUAL_INT(10, b.max_hp);
    TEST_ASSERT_TRUE(b.broken);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_breakable_hit(&b, 5));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_breakable_hit(&b, 0));
    TEST_ASSERT_EQUAL_INT(0, b.hp);
    TEST_ASSERT_TRUE(b.broken);
    TEST_ASSERT_EQUAL_INT(2, b.variant);
    TEST_ASSERT_EQUAL_INT(7, b.portal);
}

static void test_breakable_reset(void)
{
    R2DWorldBreakable b = make_breakable("b.reset", 50);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_breakable_hit(&b, 20));
    TEST_ASSERT_EQUAL_INT(1, r2d_world_breakable_hit(&b, 40));
    TEST_ASSERT_TRUE(b.broken);
    r2d_world_breakable_reset(&b);
    TEST_ASSERT_EQUAL_INT(50, b.hp);
    TEST_ASSERT_EQUAL_INT(50, b.max_hp);
    TEST_ASSERT_FALSE(b.broken);
    TEST_ASSERT_EQUAL_STRING("b.reset", b.id);
    TEST_ASSERT_EQUAL_INT(2, b.variant);
    TEST_ASSERT_EQUAL_INT(7, b.portal);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_breakable_hit(&b, 49));
    TEST_ASSERT_EQUAL_INT(1, r2d_world_breakable_hit(&b, 1));
    TEST_ASSERT_TRUE(b.broken);
    r2d_world_breakable_reset(NULL);
}

static void test_breakable_invalid_hit(void)
{
    R2DWorldBreakable b = make_breakable("b.hit", 5);
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_breakable_hit(NULL, 1));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_breakable_hit(&b, -1));
    TEST_ASSERT_EQUAL_INT(5, b.hp);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_breakable_hit(&b, 0));
    TEST_ASSERT_EQUAL_INT(5, b.hp);
    R2DWorldBreakable zeroed;
    memset(&zeroed, 0, sizeof(zeroed));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_breakable_hit(&zeroed, 10));
    TEST_ASSERT_FALSE(zeroed.broken);
    TEST_ASSERT_EQUAL_INT(0, zeroed.hp);
}

static void test_determinism_10k_touches(void)
{
    R2DWorldSecret a = make_secret("s.det", false);
    R2DWorldSecret b = make_secret("s.det", false);
    int hits_a = 0, hits_b = 0;
    for (int i = 0; i < 10000; ++i) {
        TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&a, 50.0f, 0.0f, 50.0f));
        TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&b, 50.0f, 0.0f, 50.0f));
        hits_a += r2d_world_secret_touch(&a, 0.0f, 0.0f, 50.0f);
        hits_b += r2d_world_secret_touch(&b, 0.0f, 0.0f, 50.0f);
    }
    TEST_ASSERT_EQUAL_INT(10000, hits_a);
    TEST_ASSERT_EQUAL_INT(10000, hits_b);
    TEST_ASSERT_EQUAL_INT(10000, a.found_count);
    TEST_ASSERT_EQUAL_INT(10000, b.found_count);
    TEST_ASSERT_TRUE(a.found && b.found);
    TEST_ASSERT_TRUE(a.entered && b.entered);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&a, 50.0f, 0.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_secret_touch(&b, 50.0f, 0.0f, 50.0f));
    TEST_ASSERT_FALSE(a.entered && b.entered);
    TEST_ASSERT_EQUAL_INT(0, memcmp(&a, &b, sizeof(a)));

    R2DWorldBreakable c = make_breakable("b.det", 1000);
    int transitions = 0;
    for (int i = 0; i < 10000; ++i) {
        int r = r2d_world_breakable_hit(&c, 1);
        TEST_ASSERT_TRUE(r == 0 || r == 1);
        transitions += r;
    }
    TEST_ASSERT_EQUAL_INT(1, transitions);
    TEST_ASSERT_TRUE(c.broken);
    TEST_ASSERT_EQUAL_INT(0, c.hp);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_secret_init_and_invalid_input);
    RUN_TEST(test_secret_enter_and_reenter);
    RUN_TEST(test_secret_once_semantics);
    RUN_TEST(test_secret_outside_and_height_rejection);
    RUN_TEST(test_secret_reset);
    RUN_TEST(test_secret_presentation_timer);
    RUN_TEST(test_breakable_init_and_invalid_input);
    RUN_TEST(test_breakable_damage_accumulation);
    RUN_TEST(test_breakable_break_transition_once_and_overkill);
    RUN_TEST(test_breakable_reset);
    RUN_TEST(test_breakable_invalid_hit);
    RUN_TEST(test_determinism_10k_touches);
    return UNITY_END();
}
