#include "re2d_world_trigger.h"
#include "unity.h"

#include <math.h>
#include <stdint.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-5f

static R2DWorldTrigger make_trigger(int type, float cooldown, bool once)
{
    R2DWorldTrigger t;
    memset(&t, 0xcd, sizeof(t));
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_init(&t, type, "test.event", "line:target",
                                                    0.0f, 0.0f, 5.0f, 0.0f, 10.0f, once, cooldown),
                             "fixture trigger initializes");
    return t;
}

static uint32_t float_bits(float value)
{
    uint32_t bits;
    memcpy(&bits, &value, sizeof(bits));
    return bits;
}

static void test_init_validation(void)
{
    R2DWorldTrigger t;
    const char *target = "line:gate";
    char id63[64];
    char id64[65];

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_ENTER, "door.enter", target,
                                                    10.0f, 20.0f, 4.0f, 1.0f, 8.0f, false, 0.25f),
                             "valid enter trigger initializes");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_TRIGGER_ENTER, t.type, "type stored");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(10.0f, t.x, "x stored");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(20.0f, t.y, "y stored");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(4.0f, t.radius, "radius stored");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(1.0f, t.bottom, "bottom stored");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(8.0f, t.top, "top stored");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, t.once, "once normalized to 0");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.25f, t.cooldown, "cooldown stored");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, t.enabled, "new trigger starts enabled");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, t.fire_count, "new trigger has no fires");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, t.user_data, "user_data zeroed");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, t.timer, "timer starts at zero");
    TEST_ASSERT_FALSE_MESSAGE(t.armed, "enter trigger starts disarmed");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("door.enter", t.id, "id copied");
    TEST_ASSERT_TRUE_MESSAGE(t.target == target, "target is borrowed, not copied");

    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_init(NULL, R2D_TRIGGER_ENTER, "id", NULL,
                                                     0, 0, 1, 0, 1, false, 0),
                              "NULL trigger rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_init(&t, -1, "id", NULL, 0, 0, 1, 0, 1, false, 0),
                              "unknown type rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_init(&t, 3, "id", NULL, 0, 0, 1, 0, 1, false, 0),
                              "type above range rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_ENTER, NULL, NULL,
                                                     0, 0, 1, 0, 1, false, 0),
                              "NULL id rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_ENTER, "id", NULL,
                                                     NAN, 0, 1, 0, 1, false, 0),
                              "NaN x rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_ENTER, "id", NULL,
                                                     0, INFINITY, 1, 0, 1, false, 0),
                              "infinite y rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_ENTER, "id", NULL,
                                                     0, 0, 0, 0, 1, false, 0),
                              "zero radius rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_ENTER, "id", NULL,
                                                     0, 0, -1, 0, 1, false, 0),
                              "negative radius rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_ENTER, "id", NULL,
                                                     0, 0, 1, 1, 1, false, 0),
                              "empty height interval rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_ENTER, "id", NULL,
                                                     0, 0, 1, 0, 1, false, -0.5f),
                              "negative cooldown rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_ENTER, "id", NULL,
                                                     0, 0, 1, 0, 1, false, NAN),
                              "NaN cooldown rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, t.enabled, "failed init leaves a zeroed disabled trigger");

    memset(id63, 'a', sizeof(id63) - 1u);
    id63[sizeof(id63) - 1u] = '\0';
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_USE, id63, NULL,
                                                    0, 0, 1, 0, 1, false, 0),
                             "63-byte id accepted");
    TEST_ASSERT_EQUAL_STRING_MESSAGE(id63, t.id, "63-byte id copied exactly");

    memset(id64, 'a', sizeof(id64) - 1u);
    id64[sizeof(id64) - 1u] = '\0';
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_USE, id64, NULL,
                                                     0, 0, 1, 0, 1, false, 0),
                              "64-byte id rejected instead of truncated");

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_SHOOT, "shoot", NULL,
                                                    0, 0, 1, 0, 1, true, 0),
                             "NULL target is allowed");
    TEST_ASSERT_TRUE_MESSAGE(t.target == NULL, "NULL target stays NULL");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, t.once, "non-zero once normalized to 1");
}

static void test_enter_transition_and_rearm(void)
{
    R2DWorldTrigger t = make_trigger(R2D_TRIGGER_ENTER, 0.0f, false);

    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 20.0f, 0.0f, 5.0f), "outside does not fire");
    TEST_ASSERT_FALSE_MESSAGE(t.armed, "outside leaves trigger disarmed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, t.fire_count, "outside does not count as fire");

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_enter(&t, 3.0f, 0.0f, 5.0f), "outside -> inside fires");
    TEST_ASSERT_TRUE_MESSAGE(t.armed, "entering arms the trigger");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, t.fire_count, "first entry counted");

    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 3.0f, 0.0f, 5.0f), "no repeat while standing inside");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 1.0f, 1.0f, 9.0f), "moving inside does not refire");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, t.fire_count, "inside stays at one fire");

    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 8.0f, 0.0f, 5.0f), "leaving does not fire");
    TEST_ASSERT_FALSE_MESSAGE(t.armed, "leaving re-arms");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_enter(&t, 0.0f, 0.0f, 5.0f), "re-entry fires again");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, t.fire_count, "second entry counted");

    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 9.0f, 0.0f, 5.0f), "leave before boundary checks");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_enter(&t, 5.0f, 0.0f, 0.0f), "radius and bottom are inclusive");
    TEST_ASSERT_EQUAL_INT_MESSAGE(3, t.fire_count, "boundary entry counted");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 9.0f, 0.0f, 5.0f), "leave before height checks");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 0.0f, 0.0f, 10.0001f), "above top is outside");
    TEST_ASSERT_FALSE_MESSAGE(t.armed, "height miss disarms");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_enter(&t, 0.0f, 0.0f, 10.0f), "top is inclusive");
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, t.fire_count, "top boundary entry counted");

    TEST_ASSERT_TRUE_MESSAGE(t.armed, "inside again");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, NAN, 0.0f, 5.0f), "NaN point rejected");
    TEST_ASSERT_TRUE_MESSAGE(t.armed, "invalid input does not disturb armed state");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 0.0f, 0.0f, 5.0f), "still no repeat while inside");
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, t.fire_count, "invalid input changes nothing");

    R2DWorldTrigger use_t = make_trigger(R2D_TRIGGER_USE, 0.0f, false);
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&use_t, 0.0f, 0.0f, 5.0f), "enter ignores non-enter triggers");
    TEST_ASSERT_FALSE_MESSAGE(use_t.armed, "non-enter triggers never touch armed");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(NULL, 0.0f, 0.0f, 5.0f), "NULL trigger rejected");
}

static void test_once_disables_permanently(void)
{
    R2DWorldTrigger t = make_trigger(R2D_TRIGGER_ENTER, 0.0f, true);

    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 20.0f, 0.0f, 5.0f), "outside does not fire");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_enter(&t, 0.0f, 0.0f, 5.0f), "first entry fires the one-shot");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, t.fire_count, "one-shot fired once");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, t.enabled, "one-shot disables itself");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 20.0f, 0.0f, 5.0f), "leave");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 0.0f, 0.0f, 5.0f), "re-entry cannot refire");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, t.fire_count, "one-shot fire count stays at one");

    // Even a caller forcing enabled back on must not bypass the spent one-shot.
    t.enabled = 1;
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 20.0f, 0.0f, 5.0f), "leave");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 0.0f, 0.0f, 5.0f), "spent one-shot still blocked");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, t.fire_count, "forced enabled does not add fires");

    r2d_world_trigger_reset(&t);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, t.enabled, "reset restores enabled");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, t.fire_count, "reset clears fire count");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_enter(&t, 0.0f, 0.0f, 5.0f), "reset one-shot fires again");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, t.fire_count, "reset one-shot fire counted");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, t.enabled, "reset one-shot disables after firing");

    R2DWorldTrigger use_t = make_trigger(R2D_TRIGGER_USE, 0.0f, true);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_use(&use_t, 0.0f, 0.0f, 5.0f), "one-shot use fires");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_use(&use_t, 0.0f, 0.0f, 5.0f), "one-shot use stays spent");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, use_t.fire_count, "one-shot use fired exactly once");
}

static void test_cooldown_and_step(void)
{
    R2DWorldTrigger t = make_trigger(R2D_TRIGGER_ENTER, 0.5f, false);

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_enter(&t, 0.0f, 0.0f, 5.0f), "first entry fires");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.5f, t.timer, "fire arms the cooldown timer");

    r2d_world_trigger_step(&t, 0.1f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.4f, t.timer, "step decrements the timer");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 20.0f, 0.0f, 5.0f), "leave");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 0.0f, 0.0f, 5.0f), "cooldown blocks re-entry");
    TEST_ASSERT_TRUE_MESSAGE(t.armed, "blocked entry still arms");

    r2d_world_trigger_step(&t, 0.2f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.2f, t.timer, "timer keeps decrementing");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 20.0f, 0.0f, 5.0f), "leave");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 0.0f, 0.0f, 5.0f), "timer above zero still blocks");

    r2d_world_trigger_step(&t, 0.25f);
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, t.timer, "timer floors at exactly zero");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&t, 20.0f, 0.0f, 5.0f), "leave");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_enter(&t, 0.0f, 0.0f, 5.0f), "entry fires after cooldown elapses");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, t.fire_count, "cooled-down entry counted");

    // Invalid / out-of-range dt.
    r2d_world_trigger_step(&t, NAN);
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.5f, t.timer, "NaN dt ignored");
    r2d_world_trigger_step(&t, INFINITY);
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.5f, t.timer, "infinite dt ignored");
    r2d_world_trigger_step(&t, -1.0f);
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.5f, t.timer, "negative dt ignored");
    r2d_world_trigger_step(&t, 10.0f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS, 0.25f, t.timer, "large dt clamped to 0.25 s");
    r2d_world_trigger_step(NULL, 0.1f);
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.25f, t.timer, "NULL step is a no-op");

    // Repeat use trigger: fires again only after the cooldown.
    R2DWorldTrigger use_t = make_trigger(R2D_TRIGGER_USE, 0.2f, false);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_use(&use_t, 0.0f, 0.0f, 5.0f), "use fires");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_use(&use_t, 0.0f, 0.0f, 5.0f), "immediate repeat blocked");
    r2d_world_trigger_step(&use_t, 0.2f);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_use(&use_t, 0.0f, 0.0f, 5.0f), "repeat fires once timer elapses");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, use_t.fire_count, "repeat use counted twice");

    R2DWorldTrigger free_t = make_trigger(R2D_TRIGGER_USE, 0.0f, false);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_use(&free_t, 0.0f, 0.0f, 5.0f), "zero cooldown use fires");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_use(&free_t, 0.0f, 0.0f, 5.0f), "zero cooldown allows immediate repeat");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, free_t.timer, "zero cooldown never starts a timer");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, free_t.fire_count, "zero cooldown repeat counted");
}

static void test_disabled_never_fires(void)
{
    R2DWorldTrigger enter_t = make_trigger(R2D_TRIGGER_ENTER, 0.0f, false);
    enter_t.enabled = 0;
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&enter_t, 0.0f, 0.0f, 5.0f), "disabled enter never fires");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, enter_t.fire_count, "disabled enter has no fires");
    TEST_ASSERT_TRUE_MESSAGE(enter_t.armed, "disabled enter still tracks armed state");

    enter_t.enabled = 1;
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&enter_t, 0.0f, 0.0f, 5.0f),
                              "re-enabled while inside waits for leave/re-enter");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, enter_t.fire_count, "no fire on re-enable inside");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_enter(&enter_t, 20.0f, 0.0f, 5.0f), "leave");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_enter(&enter_t, 0.0f, 0.0f, 5.0f), "re-entry after re-enable fires");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, enter_t.fire_count, "re-enabled enter fired once");

    R2DWorldTrigger use_t = make_trigger(R2D_TRIGGER_USE, 0.0f, false);
    use_t.enabled = 0;
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_use(&use_t, 0.0f, 0.0f, 5.0f), "disabled use never fires");

    R2DWorldTrigger shoot_t = make_trigger(R2D_TRIGGER_SHOOT, 0.0f, false);
    shoot_t.enabled = 0;
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_shoot(&shoot_t, 0.0f, 0.0f, 5.0f, 10.0f),
                              "disabled shoot never fires");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, use_t.fire_count + shoot_t.fire_count, "disabled use/shoot have no fires");
}

static void test_use_radius_and_height(void)
{
    R2DWorldTrigger t;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_USE, "switch.use", "line:switch",
                                                    0.0f, 0.0f, 5.0f, 2.0f, 8.0f, false, 0.0f),
                             "use fixture initializes");

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_use(&t, 0.0f, 0.0f, 5.0f), "inside use fires");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_use(&t, 5.0f, 0.0f, 2.0f), "radius and bottom boundaries are inclusive");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_use(&t, 5.0001f, 0.0f, 5.0f), "outside radius rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_use(&t, 0.0f, 0.0f, 1.999f), "below bottom rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_use(&t, 0.0f, 0.0f, 8.001f), "above top rejected");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_use(&t, -4.0f, 0.0f, 8.0f), "top boundary is inclusive");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_use(&t, NAN, 0.0f, 5.0f), "NaN x rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_use(&t, 0.0f, INFINITY, 5.0f), "infinite y rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_use(&t, 0.0f, 0.0f, NAN), "NaN height rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_use(NULL, 0.0f, 0.0f, 5.0f), "NULL trigger rejected");

    R2DWorldTrigger enter_t = make_trigger(R2D_TRIGGER_ENTER, 0.0f, false);
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_use(&enter_t, 0.0f, 0.0f, 5.0f), "use ignores enter triggers");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, enter_t.fire_count, "wrong type leaves fire count untouched");
}

static void test_shoot_radius_and_height(void)
{
    R2DWorldTrigger t;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_SHOOT, "gate.shoot", "line:gate",
                                                    0.0f, 0.0f, 3.0f, 0.0f, 6.0f, false, 0.0f),
                             "shoot fixture initializes");

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_shoot(&t, 5.0f, 0.0f, 3.0f, 2.0f), "reach radius+shot inclusive");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_shoot(&t, 5.0001f, 0.0f, 3.0f, 2.0f), "beyond reach rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_shoot(&t, 4.0f, 0.0f, 3.0f, 0.0f), "shot radius zero still uses trigger radius");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_shoot(&t, 4.0f, 0.0f, 3.0f, 1.0f), "shot radius extends reach");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_shoot(&t, 0.0f, 0.0f, 6.0f, 0.0f), "top boundary is inclusive");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_shoot(&t, 0.0f, 0.0f, 6.001f, 0.0f), "above top rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_shoot(&t, 0.0f, 0.0f, -0.001f, 0.0f), "below bottom rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_shoot(&t, 0.0f, 0.0f, 3.0f, -1.0f), "negative shot radius rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_shoot(&t, 0.0f, 0.0f, 3.0f, NAN), "NaN shot radius rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_shoot(&t, NAN, 0.0f, 3.0f, 0.0f), "NaN x rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_shoot(NULL, 0.0f, 0.0f, 3.0f, 0.0f), "NULL trigger rejected");

    R2DWorldTrigger use_t = make_trigger(R2D_TRIGGER_USE, 0.0f, false);
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trigger_shoot(&use_t, 0.0f, 0.0f, 5.0f, 0.0f), "shoot ignores use triggers");
}

static void test_reset_restores_state(void)
{
    R2DWorldTrigger t;
    const char *target = "line:reset";
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_init(&t, R2D_TRIGGER_USE, "reset.use", target,
                                                    1.0f, 2.0f, 6.0f, 0.0f, 4.0f, false, 2.0f),
                             "reset fixture initializes");
    t.user_data = 99;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_use(&t, 1.0f, 2.0f, 2.0f), "fixture fires");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, t.fire_count, "fixture has one fire");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(2.0f, t.timer, "fixture has a timer");

    r2d_world_trigger_reset(&t);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, t.fire_count, "reset clears fire count");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, t.enabled, "reset re-enables");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(0.0f, t.timer, "reset clears timer");
    TEST_ASSERT_FALSE_MESSAGE(t.armed, "reset clears armed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(99, t.user_data, "reset preserves user_data");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_TRIGGER_USE, t.type, "reset preserves type");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(1.0f, t.x, "reset preserves x");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(6.0f, t.radius, "reset preserves radius");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(2.0f, t.cooldown, "reset preserves cooldown");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("reset.use", t.id, "reset preserves id");
    TEST_ASSERT_TRUE_MESSAGE(t.target == target, "reset preserves borrowed target");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_use(&t, 1.0f, 2.0f, 2.0f), "reset trigger fires again");

    R2DWorldTrigger once_t = make_trigger(R2D_TRIGGER_ENTER, 0.0f, true);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_enter(&once_t, 0.0f, 0.0f, 5.0f), "one-shot fires");
    r2d_world_trigger_reset(&once_t);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, once_t.fire_count, "reset restores one-shot fire count");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, once_t.enabled, "reset restores one-shot enabled state");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_enter(&once_t, 0.0f, 0.0f, 5.0f), "reset one-shot is usable again");

    r2d_world_trigger_reset(NULL);
}

static void run_10k_ticks(R2DWorldTrigger *t, uint32_t *out_hash, int *out_fires, float *out_timer,
                          int *out_armed, int *out_enabled)
{
    uint32_t hash = 2166136261u;
    for (int i = 0; i < 10000; ++i) {
        r2d_world_trigger_step(t, 0.01f);
        // Enter for 15 ticks, then stay outside for 25 ticks.
        int phase = i % 40;
        bool inside = phase < 15;
        float px = inside ? 2.0f : 20.0f;
        bool fired = r2d_world_trigger_enter(t, px, 0.0f, 4.0f);

        hash ^= fired ? 1u : 0u;
        hash *= 16777619u;
        hash ^= (uint32_t)t->fire_count;
        hash *= 16777619u;
        hash ^= (uint32_t)t->enabled;
        hash *= 16777619u;
        hash ^= t->armed ? 1u : 0u;
        hash *= 16777619u;
        hash ^= float_bits(t->timer);
        hash *= 16777619u;
    }
    *out_hash = hash;
    *out_fires = t->fire_count;
    *out_timer = t->timer;
    *out_armed = t->armed ? 1 : 0;
    *out_enabled = t->enabled;
}

static void test_10k_ticks_deterministic(void)
{
    R2DWorldTrigger a, b;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_init(&a, R2D_TRIGGER_ENTER, "loop.enter", "sector:loop",
                                                    0.0f, 0.0f, 5.0f, 0.0f, 8.0f, false, 0.75f),
                             "simulation A initializes");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trigger_init(&b, R2D_TRIGGER_ENTER, "loop.enter", "sector:loop",
                                                    0.0f, 0.0f, 5.0f, 0.0f, 8.0f, false, 0.75f),
                             "simulation B initializes");

    uint32_t hash_a, hash_b;
    int fires_a, fires_b, armed_a, armed_b, enabled_a, enabled_b;
    float timer_a, timer_b;
    run_10k_ticks(&a, &hash_a, &fires_a, &timer_a, &armed_a, &enabled_a);
    run_10k_ticks(&b, &hash_b, &fires_b, &timer_b, &armed_b, &enabled_b);

    TEST_ASSERT_EQUAL_UINT32_MESSAGE(hash_a, hash_b, "10k-tick state hashes are identical");
    TEST_ASSERT_EQUAL_INT_MESSAGE(fires_a, fires_b, "10k-tick fire counts are identical");
    TEST_ASSERT_EQUAL_INT_MESSAGE(armed_a, armed_b, "10k-tick armed state is identical");
    TEST_ASSERT_EQUAL_INT_MESSAGE(enabled_a, enabled_b, "10k-tick enabled state is identical");
    TEST_ASSERT_EQUAL_FLOAT_MESSAGE(timer_a, timer_b, "10k-tick timer is identical");
    TEST_ASSERT_TRUE_MESSAGE(fires_a > 0, "simulation actually fired triggers");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, armed_a, "simulation ends outside (disarmed)");

    // A third run from reset must reproduce the same trace exactly.
    r2d_world_trigger_reset(&a);
    uint32_t hash_c;
    int fires_c, armed_c, enabled_c;
    float timer_c;
    run_10k_ticks(&a, &hash_c, &fires_c, &timer_c, &armed_c, &enabled_c);
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(hash_b, hash_c, "reset replay reproduces the same state hash");
    TEST_ASSERT_EQUAL_INT_MESSAGE(fires_b, fires_c, "reset replay reproduces the fire count");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_init_validation);
    RUN_TEST(test_enter_transition_and_rearm);
    RUN_TEST(test_once_disables_permanently);
    RUN_TEST(test_cooldown_and_step);
    RUN_TEST(test_disabled_never_fires);
    RUN_TEST(test_use_radius_and_height);
    RUN_TEST(test_shoot_radius_and_height);
    RUN_TEST(test_reset_restores_state);
    RUN_TEST(test_10k_ticks_deterministic);
    return UNITY_END();
}
