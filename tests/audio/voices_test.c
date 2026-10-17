#include "re2d_audio_voices.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static R2DAudioVoiceRequest make_request(int id,int priority,float x,float y,float h,
                                         float volume,float range,int bus)
{
    R2DAudioVoiceRequest r;
    memset(&r,0,sizeof r);
    r.id = id;
    r.priority = priority;
    r.x = x;
    r.y = y;
    r.h = h;
    r.volume = volume;
    r.range = range;
    r.loop = false;
    r.virtual = false;
    r.bus = bus;
    r.channel = -1;
    return r;
}

static int find_voice_for_test(const R2DAudioVoices *v,int id)
{
    for (int i = 0; i < v->slot_count; i++) {
        if (v->slots[i].voice_id == id) return i;
    }
    return -1;
}

static void test_init_capacity_and_invalid_capacity(void)
{
    R2DAudioVoices v;
    r2d_audio_voices_init(&v,2);
    TEST_ASSERT_EQUAL_INT(2, v.slot_count);
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_voices_active(&v));
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_voices_virtual(&v));
    for (int i = 0; i < 2; i++) {
        TEST_ASSERT_EQUAL_INT(-1, v.slots[i].channel);
        TEST_ASSERT_EQUAL_INT(-1, v.slots[i].voice_id);
        TEST_ASSERT_TRUE(v.slots[i].virtual);
    }

    r2d_audio_voices_init(&v,0);
    TEST_ASSERT_EQUAL_INT(0, v.slot_count);
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_voices_active(&v));
    R2DAudioVoiceRequest r = make_request(1,1,0,0,0,1,100,R2D_AUDIO_BUS_SFX);
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));

    r2d_audio_voices_init(&v,33);
    TEST_ASSERT_EQUAL_INT(0, v.slot_count);
    r2d_audio_voices_init(&v,32);
    TEST_ASSERT_EQUAL_INT(32, v.slot_count);
    r2d_audio_voices_init(NULL,4);   // no crash
}

static void test_submit_real_and_distance_culling(void)
{
    R2DAudioVoices v;
    r2d_audio_voices_init(&v,4);
    r2d_audio_voices_listener(&v,0,0,0);

    R2DAudioVoiceRequest near = make_request(1,5,0,0,0,1,100,R2D_AUDIO_BUS_SFX);
    const int slot = r2d_audio_voices_submit(&v,&near);
    TEST_ASSERT_EQUAL_INT(0, slot);
    TEST_ASSERT_EQUAL_INT(1, v.slots[slot].voice_id);
    TEST_ASSERT_FALSE(v.slots[slot].virtual);
    TEST_ASSERT_EQUAL_INT(0, v.slots[slot].channel);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 1.0f, v.slots[slot].gain);

    R2DAudioVoiceRequest far = make_request(2,5,1000,0,0,1,100,R2D_AUDIO_BUS_SFX);
    const int vslot = r2d_audio_voices_submit(&v,&far);
    TEST_ASSERT_TRUE(vslot >= 0);
    TEST_ASSERT_TRUE(v.slots[vslot].virtual);
    TEST_ASSERT_EQUAL_INT(-1, v.slots[vslot].channel);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, v.slots[vslot].gain);
    TEST_ASSERT_EQUAL_INT(2, r2d_audio_voices_active(&v));
    TEST_ASSERT_EQUAL_INT(1, r2d_audio_voices_virtual(&v));

    // Height is part of the distance: same XY, too high above the listener.
    R2DAudioVoiceRequest high = make_request(3,5,0,0,200,1,100,R2D_AUDIO_BUS_SFX);
    const int hslot = r2d_audio_voices_submit(&v,&high);
    TEST_ASSERT_TRUE(v.slots[hslot].virtual);
}

static void test_priority_stealing(void)
{
    R2DAudioVoices v;
    r2d_audio_voices_init(&v,1);
    r2d_audio_voices_listener(&v,0,0,0);

    R2DAudioVoiceRequest a = make_request(1,1,10,0,0,1,100,R2D_AUDIO_BUS_SFX);
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_voices_submit(&v,&a));
    R2DAudioVoiceRequest b = make_request(2,2,20,0,0,1,100,R2D_AUDIO_BUS_SFX);
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_voices_submit(&v,&b));
    TEST_ASSERT_EQUAL_INT(1, r2d_audio_voices_active(&v));
    TEST_ASSERT_EQUAL_INT(2, v.slots[0].voice_id);
    TEST_ASSERT_FALSE(v.slots[0].virtual);

    // Same priority, same distance: lower id wins, higher id is rejected.
    R2DAudioVoiceRequest worse_id = make_request(3,2,20,0,0,1,100,R2D_AUDIO_BUS_SFX);
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&worse_id));
    TEST_ASSERT_EQUAL_INT(2, v.slots[0].voice_id);

    // Same priority, closer distance beats the current voice.
    R2DAudioVoiceRequest closer = make_request(4,2,15,0,0,1,100,R2D_AUDIO_BUS_SFX);
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_voices_submit(&v,&closer));
    TEST_ASSERT_EQUAL_INT(4, v.slots[0].voice_id);
}

static void test_id_tie_break_at_equal_priority_and_distance(void)
{
    R2DAudioVoices v;
    r2d_audio_voices_init(&v,1);
    r2d_audio_voices_listener(&v,0,0,0);

    R2DAudioVoiceRequest a = make_request(7,5,10,0,0,1,100,R2D_AUDIO_BUS_SFX);
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_voices_submit(&v,&a));
    R2DAudioVoiceRequest b = make_request(3,5,10,0,0,1,100,R2D_AUDIO_BUS_SFX);
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_voices_submit(&v,&b));
    TEST_ASSERT_EQUAL_INT(3, v.slots[0].voice_id);
    R2DAudioVoiceRequest c = make_request(9,5,10,0,0,1,100,R2D_AUDIO_BUS_SFX);
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&c));
    TEST_ASSERT_EQUAL_INT(3, v.slots[0].voice_id);
}

static void test_virtual_promotion_after_removal(void)
{
    R2DAudioVoices v;
    r2d_audio_voices_init(&v,2);
    r2d_audio_voices_listener(&v,0,0,0);

    R2DAudioVoiceRequest a = make_request(1,5,10,0,0,1,100,R2D_AUDIO_BUS_SFX);
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_voices_submit(&v,&a));
    R2DAudioVoiceRequest b = make_request(2,4,20,0,0,1,100,R2D_AUDIO_BUS_MUSIC);
    b.virtual = true;
    const int bslot = r2d_audio_voices_submit(&v,&b);
    TEST_ASSERT_TRUE(bslot >= 0);
    TEST_ASSERT_TRUE(v.slots[bslot].virtual);
    TEST_ASSERT_EQUAL_INT(1, r2d_audio_voices_virtual(&v));

    r2d_audio_voices_remove(&v,1);
    TEST_ASSERT_EQUAL_INT(1, r2d_audio_voices_active(&v));
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_voices_virtual(&v));
    TEST_ASSERT_EQUAL_INT(2, v.slots[bslot].voice_id);
    TEST_ASSERT_FALSE(v.slots[bslot].virtual);
    TEST_ASSERT_TRUE(v.slots[bslot].channel >= 0);
}

static void test_listener_move_rebalance(void)
{
    R2DAudioVoices v;
    r2d_audio_voices_init(&v,2);
    r2d_audio_voices_listener(&v,0,0,0);

    R2DAudioVoiceRequest a = make_request(1,5,0,0,0,1,100,R2D_AUDIO_BUS_SFX);
    R2DAudioVoiceRequest b = make_request(2,5,1000,0,0,1,100,R2D_AUDIO_BUS_MUSIC);
    TEST_ASSERT_TRUE(r2d_audio_voices_submit(&v,&a) >= 0);
    TEST_ASSERT_TRUE(r2d_audio_voices_submit(&v,&b) >= 0);
    TEST_ASSERT_EQUAL_INT(1, r2d_audio_voices_virtual(&v));

    r2d_audio_voices_listener(&v,1000,0,0);
    r2d_audio_voices_rebalance(&v);
    TEST_ASSERT_EQUAL_INT(1, r2d_audio_voices_virtual(&v));
    int real_id = -1, virtual_id = -1;
    for (int i = 0; i < v.slot_count; i++) {
        if (v.slots[i].voice_id < 0) continue;
        if (v.slots[i].virtual) virtual_id = v.slots[i].voice_id;
        else real_id = v.slots[i].voice_id;
    }
    TEST_ASSERT_EQUAL_INT(2, real_id);
    TEST_ASSERT_EQUAL_INT(1, virtual_id);

    r2d_audio_voices_listener(&v,0,0,0);
    r2d_audio_voices_rebalance(&v);
    real_id = virtual_id = -1;
    for (int i = 0; i < v.slot_count; i++) {
        if (v.slots[i].voice_id < 0) continue;
        if (v.slots[i].virtual) virtual_id = v.slots[i].voice_id;
        else real_id = v.slots[i].voice_id;
    }
    TEST_ASSERT_EQUAL_INT(1, real_id);
    TEST_ASSERT_EQUAL_INT(2, virtual_id);

    // Invalid listener values are ignored.
    const float lx = v.listener_x;
    r2d_audio_voices_listener(&v,NAN,INFINITY,0);
    TEST_ASSERT_EQUAL_FLOAT(lx, v.listener_x);
}

static void test_ducking_per_bus(void)
{
    R2DAudioVoices v;
    r2d_audio_voices_init(&v,2);
    r2d_audio_voices_listener(&v,0,0,0);

    R2DAudioVoiceRequest sfx = make_request(1,5,0,0,0,1,100,R2D_AUDIO_BUS_SFX);
    R2DAudioVoiceRequest music = make_request(2,5,0,0,0,1,100,R2D_AUDIO_BUS_MUSIC);
    TEST_ASSERT_TRUE(r2d_audio_voices_submit(&v,&sfx) >= 0);
    TEST_ASSERT_TRUE(r2d_audio_voices_submit(&v,&music) >= 0);

    r2d_audio_voices_duck(&v,R2D_AUDIO_BUS_SFX,0.5f);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 0.5f, v.slots[0].gain);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 1.0f, v.slots[1].gain);

    r2d_audio_voices_duck(&v,R2D_AUDIO_BUS_SFX,1.0f);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, v.slots[0].gain);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 1.0f, v.slots[1].gain);

    r2d_audio_voices_duck(&v,R2D_AUDIO_BUS_MUSIC,0.25f);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 0.75f, v.slots[1].gain);

    r2d_audio_voices_duck(&v,R2D_AUDIO_BUS_SFX,0.0f);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 1.0f, v.slots[0].gain);

    // Invalid bus/non-finite does nothing; amounts are clamped to [0,1].
    r2d_audio_voices_duck(&v,R2D_AUDIO_BUS_COUNT,0.5f);
    r2d_audio_voices_duck(&v,-1,0.5f);
    r2d_audio_voices_duck(&v,R2D_AUDIO_BUS_SFX,NAN);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 1.0f, v.slots[0].gain);
    r2d_audio_voices_duck(&v,R2D_AUDIO_BUS_SFX,2.0f);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, v.slots[0].gain);
    r2d_audio_voices_duck(&v,R2D_AUDIO_BUS_SFX,-1.0f);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 1.0f, v.slots[0].gain);
}

static void test_one_shot_and_loop_removal(void)
{
    R2DAudioVoices v;
    r2d_audio_voices_init(&v,2);
    r2d_audio_voices_listener(&v,0,0,0);

    R2DAudioVoiceRequest shot = make_request(1,3,0,0,0,1,100,R2D_AUDIO_BUS_SFX);
    shot.loop = false;
    R2DAudioVoiceRequest loop = make_request(2,3,0,0,0,1,100,R2D_AUDIO_BUS_AMBIENT);
    loop.loop = true;
    TEST_ASSERT_TRUE(r2d_audio_voices_submit(&v,&shot) >= 0);
    TEST_ASSERT_TRUE(r2d_audio_voices_submit(&v,&loop) >= 0);

    r2d_audio_voices_remove(&v,1);            // one-shot completed
    TEST_ASSERT_EQUAL_INT(1, r2d_audio_voices_active(&v));
    TEST_ASSERT_EQUAL_INT(-1, v.slots[0].voice_id);
    r2d_audio_voices_remove(&v,2);            // looping voice stopped
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_voices_active(&v));

    r2d_audio_voices_remove(&v,2);            // unknown id: no-op
    r2d_audio_voices_remove(&v,-1);
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_voices_active(&v));
}

static void test_invalid_submit_rejected(void)
{
    R2DAudioVoices v;
    r2d_audio_voices_init(&v,2);
    r2d_audio_voices_listener(&v,0,0,0);
    R2DAudioVoiceRequest good = make_request(1,1,0,0,0,1,100,R2D_AUDIO_BUS_SFX);

    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(NULL,&good));
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,NULL));

    R2DAudioVoiceRequest r = good;
    r.id = -1;
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));
    r = good; r.bus = R2D_AUDIO_BUS_COUNT;
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));
    r = good; r.bus = -1;
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));
    r = good; r.channel = 2;
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));
    r = good; r.channel = -2;
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));
    r = good; r.x = NAN;
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));
    r = good; r.y = INFINITY;
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));
    r = good; r.h = NAN;
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));
    r = good; r.volume = NAN;
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));
    r = good; r.volume = -0.1f;
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));
    r = good; r.volume = 1.1f;
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));
    r = good; r.range = 0.0f;
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));
    r = good; r.range = NAN;
    TEST_ASSERT_EQUAL_INT(-1, r2d_audio_voices_submit(&v,&r));
    TEST_ASSERT_EQUAL_INT(0, r2d_audio_voices_active(&v));
}

static void test_preferred_channel_and_uniqueness(void)
{
    R2DAudioVoices v;
    r2d_audio_voices_init(&v,3);
    r2d_audio_voices_listener(&v,0,0,0);

    R2DAudioVoiceRequest a = make_request(1,1,0,0,0,1,100,R2D_AUDIO_BUS_SFX);
    a.channel = 2;
    R2DAudioVoiceRequest b = make_request(2,1,0,0,0,1,100,R2D_AUDIO_BUS_AMBIENT);
    b.channel = 2;  // already taken by a: fall back deterministically
    R2DAudioVoiceRequest c = make_request(3,1,0,0,0,1,100,R2D_AUDIO_BUS_MUSIC);
    TEST_ASSERT_TRUE(r2d_audio_voices_submit(&v,&a) >= 0);
    TEST_ASSERT_TRUE(r2d_audio_voices_submit(&v,&b) >= 0);
    TEST_ASSERT_TRUE(r2d_audio_voices_submit(&v,&c) >= 0);
    TEST_ASSERT_EQUAL_INT(2, v.slots[find_voice_for_test(&v,1)].channel);
    TEST_ASSERT_EQUAL_INT(0, v.slots[find_voice_for_test(&v,2)].channel);
    TEST_ASSERT_EQUAL_INT(1, v.slots[find_voice_for_test(&v,3)].channel);

    // All real channels are unique.
    for (int i = 0; i < v.slot_count; i++) {
        if (v.slots[i].voice_id < 0 || v.slots[i].virtual) continue;
        for (int j = i + 1; j < v.slot_count; j++) {
            if (v.slots[j].voice_id < 0 || v.slots[j].virtual) continue;
            TEST_ASSERT_TRUE(v.slots[i].channel != v.slots[j].channel);
        }
    }
}

static void test_determinism_10k_submits(void)
{
    R2DAudioVoices a, b;
    r2d_audio_voices_init(&a,8);
    r2d_audio_voices_init(&b,8);
    r2d_audio_voices_listener(&a,25,-15,3);
    r2d_audio_voices_listener(&b,25,-15,3);

    for (int i = 0; i < 10000; i++) {
        R2DAudioVoiceRequest r = make_request(
            i % 40,
            (i * 7) % 11,
            (float)(((i * 13) % 600) - 300),
            (float)(((i * 17) % 600) - 300),
            (float)((i * 3) % 80),
            0.25f + (float)(i % 4) * 0.25f,
            100.0f + (float)(i % 7) * 25.0f,
            i % R2D_AUDIO_BUS_COUNT);
        r.loop = (i % 2) != 0;
        r.virtual = (i % 13) == 0;
        const int sa = r2d_audio_voices_submit(&a,&r);
        const int sb = r2d_audio_voices_submit(&b,&r);
        TEST_ASSERT_EQUAL_INT(sa, sb);
        if (i % 97 == 0) {
            const int id = i % 40;
            r2d_audio_voices_remove(&a,id);
            r2d_audio_voices_remove(&b,id);
        }
        if (i % 1000 == 0) {
            const float x = (float)((i / 10) % 200);
            r2d_audio_voices_listener(&a,x,-x,0);
            r2d_audio_voices_listener(&b,x,-x,0);
            r2d_audio_voices_rebalance(&a);
            r2d_audio_voices_rebalance(&b);
        }
    }

    TEST_ASSERT_EQUAL_INT(r2d_audio_voices_active(&a), r2d_audio_voices_active(&b));
    TEST_ASSERT_EQUAL_INT(r2d_audio_voices_virtual(&a), r2d_audio_voices_virtual(&b));
    TEST_ASSERT_EQUAL_FLOAT(a.listener_x, b.listener_x);
    TEST_ASSERT_EQUAL_FLOAT(a.listener_y, b.listener_y);
    TEST_ASSERT_EQUAL_FLOAT(a.listener_h, b.listener_h);
    for (int i = 0; i < a.slot_count; i++) {
        TEST_ASSERT_EQUAL_INT(a.slots[i].channel, b.slots[i].channel);
        TEST_ASSERT_EQUAL_INT(a.slots[i].voice_id, b.slots[i].voice_id);
        TEST_ASSERT_EQUAL_FLOAT(a.slots[i].gain, b.slots[i].gain);
        TEST_ASSERT_EQUAL_INT(a.slots[i].virtual, b.slots[i].virtual);
    }
    for (int bus = 0; bus < R2D_AUDIO_BUS_COUNT; bus++) {
        TEST_ASSERT_EQUAL_FLOAT(a.duck[bus], b.duck[bus]);
    }
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_init_capacity_and_invalid_capacity);
    RUN_TEST(test_submit_real_and_distance_culling);
    RUN_TEST(test_priority_stealing);
    RUN_TEST(test_id_tie_break_at_equal_priority_and_distance);
    RUN_TEST(test_virtual_promotion_after_removal);
    RUN_TEST(test_listener_move_rebalance);
    RUN_TEST(test_ducking_per_bus);
    RUN_TEST(test_one_shot_and_loop_removal);
    RUN_TEST(test_invalid_submit_rejected);
    RUN_TEST(test_preferred_channel_and_uniqueness);
    RUN_TEST(test_determinism_10k_submits);
    return UNITY_END();
}
