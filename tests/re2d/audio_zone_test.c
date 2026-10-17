#include "re2d_audio_zone.h"
#include "unity.h"

#include <math.h>
#include <string.h>

#define EPS 1e-4f
#define T R2D_AUDIO_PORTAL_TRANSMISSION

void setUp(void) {}
void tearDown(void) {}

static void check_zone_finite(const R2DAudioReverbZone *zone)
{
    TEST_ASSERT_NOT_NULL_MESSAGE(zone,"preset exists");
    TEST_ASSERT_TRUE_MESSAGE(isfinite(zone->wet)&&isfinite(zone->dry)&&
        isfinite(zone->decay)&&isfinite(zone->damping),"preset values are finite");
    TEST_ASSERT_TRUE_MESSAGE(zone->wet>=0.0f&&zone->wet<=1.0f,"wet in range");
    TEST_ASSERT_TRUE_MESSAGE(zone->dry>=0.0f&&zone->dry<=1.0f,"dry in range");
    TEST_ASSERT_TRUE_MESSAGE(zone->decay>=0.0f&&zone->decay<=1.0f,"decay in range");
    TEST_ASSERT_TRUE_MESSAGE(zone->damping>=0.0f&&zone->damping<=1.0f,"damping in range");
}

static void test_presets_distinct_and_valid(void)
{
    for(int i=0;i<R2D_AUDIO_ZONE_COUNT;i++) {
        const R2DAudioReverbZone *zone=r2d_audio_zone_preset(i);
        check_zone_finite(zone);
        TEST_ASSERT_EQUAL_INT_MESSAGE(i,zone->preset,"preset echoes its id");
    }
    for(int i=0;i<R2D_AUDIO_ZONE_COUNT;i++) {
        for(int j=i+1;j<R2D_AUDIO_ZONE_COUNT;j++) {
            const R2DAudioReverbZone *a=r2d_audio_zone_preset(i);
            const R2DAudioReverbZone *b=r2d_audio_zone_preset(j);
            bool different=a->wet!=b->wet||a->dry!=b->dry||
                a->decay!=b->decay||a->damping!=b->damping;
            TEST_ASSERT_TRUE_MESSAGE(different,"presets are distinct");
        }
    }
    TEST_ASSERT_NULL_MESSAGE(r2d_audio_zone_preset(-1),"negative preset rejected");
    TEST_ASSERT_NULL_MESSAGE(r2d_audio_zone_preset(R2D_AUDIO_ZONE_COUNT),"unknown preset rejected");
}

static void test_room_size_mapping(void)
{
    R2DAudioReverbZone zone;
    const R2DAudioReverbZone *room=r2d_audio_zone_preset(R2D_AUDIO_ZONE_ROOM);
    const R2DAudioReverbZone *hall=r2d_audio_zone_preset(R2D_AUDIO_ZONE_HALL);
    const R2DAudioReverbZone *cave=r2d_audio_zone_preset(R2D_AUDIO_ZONE_CAVE);

    r2d_audio_zone_from_room(5,5,3,&zone); // 75
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_AUDIO_ZONE_ROOM,zone.preset,"small room maps to room");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,room->wet,zone.wet,"small room wet");

    r2d_audio_zone_from_room(40,40,8,&zone); // 12800
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_AUDIO_ZONE_HALL,zone.preset,"large room maps to hall");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,hall->decay,zone.decay,"large room decay");

    r2d_audio_zone_from_room(100,100,20,&zone); // 200000
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_AUDIO_ZONE_CAVE,zone.preset,"huge room saturates at cave");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,cave->wet,zone.wet,"huge room wet");

    r2d_audio_zone_from_room(10,20,4,&zone); // 800: room -> hall blend
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_AUDIO_ZONE_ROOM,zone.preset,"low blend keeps room anchor");
    TEST_ASSERT_TRUE_MESSAGE(zone.wet>room->wet&&zone.wet<hall->wet,"low blend wet is between anchors");

    r2d_audio_zone_from_room(80,80,10,&zone); // 64000: hall -> cave blend
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_AUDIO_ZONE_HALL,zone.preset,"high blend keeps hall anchor");
    TEST_ASSERT_TRUE_MESSAGE(zone.wet>hall->wet&&zone.wet<cave->wet,"high blend wet is between anchors");

    r2d_audio_zone_from_room(0,10,3,&zone);
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,zone.preset,"zero width is invalid");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,zone.wet,"invalid room is zeroed");
    r2d_audio_zone_from_room(NAN,10,3,&zone);
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,zone.preset,"NaN width is invalid");
    r2d_audio_zone_from_room(10,10,INFINITY,&zone);
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,zone.preset,"infinite height is invalid");
    r2d_audio_zone_from_room(10,10,3,NULL);
    TEST_ASSERT_TRUE_MESSAGE(1,"NULL room output is safe");
}

static void test_room_blend_continuity(void)
{
    R2DAudioReverbZone before,after;
    r2d_audio_zone_from_room(400,1,1,&before);  // exactly ROOM
    r2d_audio_zone_from_room(401,1,1,&after);   // tiny blend
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(1e-3f,before.wet,after.wet,"room->hall blend starts continuously");

    r2d_audio_zone_from_room(3999,1,1,&before); // near hall
    r2d_audio_zone_from_room(4001,1,1,&after);  // exactly hall
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(1e-3f,before.wet,after.wet,"room->hall blend ends continuously");
}

static void test_direct_attenuation(void)
{
    R2DAudioZoneConfig config={0,100.0f};
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,1.0f,
        r2d_audio_zone_attenuation(&config,NULL,NULL,0,0.0f,1.0f),"zero distance is unity");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,expf(-1.0f),
        r2d_audio_zone_attenuation(&config,NULL,NULL,0,100.0f,1.0f),"one scale of distance");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.5f*expf(-0.5f),
        r2d_audio_zone_attenuation(&config,NULL,NULL,0,50.0f,0.5f),"direct gain scales the result");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,1.0f,
        r2d_audio_zone_attenuation(&config,NULL,NULL,0,0.0f,2.0f),"direct gain is clamped to one");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,NULL,NULL,0,0.0f,-1.0f),"negative direct gain clamps to zero");
}

static void test_one_hop(void)
{
    R2DAudioZoneConfig config={1,100.0f};
    float fractions[1]={1.0f};
    int ids[1]={7};
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,T,
        r2d_audio_zone_attenuation(&config,fractions,ids,1,0.0f,1.0f),"open one-hop transmission");
    fractions[0]=0.5f;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.5f*T,
        r2d_audio_zone_attenuation(&config,fractions,ids,1,0.0f,1.0f),"half-open one-hop");
    fractions[0]=0.25f;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.25f*T*expf(-0.5f),
        r2d_audio_zone_attenuation(&config,fractions,ids,1,50.0f,1.0f),"distance and portal combine");
}

static void test_two_hops(void)
{
    R2DAudioZoneConfig config={2,50.0f};
    float fractions[2]={0.5f,0.25f};
    int ids[2]={1,2};
    float expected=expf(-0.5f)*0.5f*0.25f*T*T;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,expected,
        r2d_audio_zone_attenuation(&config,fractions,ids,2,25.0f,1.0f),"two-hop attenuation product");
    // Order of the portal product is irrelevant.
    float reversed[2]={0.25f,0.5f};
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,expected,
        r2d_audio_zone_attenuation(&config,reversed,ids,2,25.0f,1.0f),"two-hop product is commutative");
}

static void test_closed_portal_blocks(void)
{
    R2DAudioZoneConfig config={2,100.0f};
    float fractions[2]={0.0f,1.0f};
    int ids[2]={1,2};
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,fractions,ids,1,0.0f,1.0f),"closed portal blocks one-hop");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,fractions,ids,2,0.0f,1.0f),"closed first portal blocks two-hop");
    fractions[0]=1.0f;fractions[1]=0.0f;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,fractions,ids,2,0.0f,1.0f),"closed second portal blocks two-hop");
    fractions[0]=-0.25f;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,fractions,ids,1,0.0f,1.0f),"negative open fraction is closed");
    fractions[0]=NAN;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,fractions,ids,1,0.0f,1.0f),"NaN fraction blocks the path");
    fractions[0]=2.0f;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,T,
        r2d_audio_zone_attenuation(&config,fractions,ids,1,0.0f,1.0f),"open fraction above one clamps");
}

static void test_hop_limit(void)
{
    R2DAudioZoneConfig config={1,100.0f};
    float fractions[5]={1,1,1,1,1};
    int ids[5]={0,1,2,3,4};
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,T,
        r2d_audio_zone_attenuation(&config,fractions,ids,1,0.0f,1.0f),"one hop within limit");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,fractions,ids,2,0.0f,1.0f),"two hops exceed limit");

    config.max_hops=0;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,fractions,ids,1,0.0f,1.0f),"zero hop limit blocks portals");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,1.0f,
        r2d_audio_zone_attenuation(&config,NULL,NULL,0,0.0f,1.0f),"zero hop limit keeps the direct path");

    config.max_hops=R2D_AUDIO_ZONE_MAX_HOPS;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,powf(T,4.0f),
        r2d_audio_zone_attenuation(&config,fractions,ids,4,0.0f,1.0f),"four hops allowed at the maximum");

    config.max_hops=99;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,powf(T,4.0f),
        r2d_audio_zone_attenuation(&config,fractions,ids,4,0.0f,1.0f),"large hop limit clamps to four");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,fractions,ids,5,0.0f,1.0f),"five hops exceed the clamped limit");

    config.max_hops=-1;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,NULL,NULL,0,0.0f,1.0f),"negative hop limit is invalid");
}

static void test_material_acoustics(void)
{
    for(int i=0;i<R2D_AUDIO_MATERIAL_COUNT;i++) {
        const R2DAudioMaterialAcoustic *material=r2d_audio_material_acoustic(i);
        TEST_ASSERT_NOT_NULL_MESSAGE(material,"material exists");
        TEST_ASSERT_TRUE_MESSAGE(isfinite(material->occlusion_gain)&&
            isfinite(material->cutoff)&&isfinite(material->transmission),"material values are finite");
        TEST_ASSERT_TRUE_MESSAGE(material->occlusion_gain>=0.0f&&material->occlusion_gain<=1.0f,"occlusion gain in range");
        TEST_ASSERT_TRUE_MESSAGE(material->cutoff>0.0f,"cutoff is positive");
        TEST_ASSERT_TRUE_MESSAGE(material->transmission>=0.0f&&material->transmission<=1.0f,"transmission in range");
    }
    const R2DAudioMaterialAcoustic *metal=r2d_audio_material_acoustic(R2D_AUDIO_MATERIAL_METAL);
    const R2DAudioMaterialAcoustic *fabric=r2d_audio_material_acoustic(R2D_AUDIO_MATERIAL_FABRIC);
    TEST_ASSERT_TRUE_MESSAGE(metal->cutoff>fabric->cutoff,"metal is brighter than fabric");
    TEST_ASSERT_TRUE_MESSAGE(metal->transmission>fabric->transmission,"metal transmits more than fabric");
    TEST_ASSERT_NULL_MESSAGE(r2d_audio_material_acoustic(-1),"negative material tag rejected");
    TEST_ASSERT_NULL_MESSAGE(r2d_audio_material_acoustic(R2D_AUDIO_MATERIAL_COUNT),"unknown material tag rejected");
}

static void test_attenuation_bounds_and_determinism(void)
{
    R2DAudioZoneConfig config={4,37.0f};
    for(int i=0;i<256;i++) {
        float fractions[4]={
            (float)((i*37)%100)/100.0f+0.01f,
            (float)((i*53)%100)/100.0f+0.01f,
            (float)((i*71)%100)/100.0f+0.01f,
            (float)((i*97)%100)/100.0f+0.01f
        };
        int ids[4]={i,i+1,i+2,i+3};
        float value=r2d_audio_zone_attenuation(&config,fractions,ids,4,(float)(i%200),1.0f);
        TEST_ASSERT_TRUE_MESSAGE(isfinite(value),"attenuation is finite");
        TEST_ASSERT_TRUE_MESSAGE(value>=0.0f&&value<=1.0f,"attenuation stays in [0,1]");
        float again=r2d_audio_zone_attenuation(&config,fractions,ids,4,(float)(i%200),1.0f);
        TEST_ASSERT_EQUAL_INT_MESSAGE(0,memcmp(&value,&again,sizeof value),"attenuation is bit-identical");
        int other_ids[4]={i+9,i+8,i+7,i+6};
        float other=r2d_audio_zone_attenuation(&config,fractions,other_ids,4,(float)(i%200),1.0f);
        TEST_ASSERT_EQUAL_INT_MESSAGE(0,memcmp(&value,&other,sizeof value),"portal ids do not change the result");
    }
}

static void test_invalid_arguments(void)
{
    float fractions[4]={1,1,1,1};
    R2DAudioZoneConfig config={4,100.0f};
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(NULL,fractions,NULL,1,0.0f,1.0f),"NULL config");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,NULL,NULL,1,0.0f,1.0f),"NULL fractions with hops");
    config.distance_scale=0.0f;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,NULL,NULL,0,0.0f,1.0f),"zero distance scale");
    config.distance_scale=NAN;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,NULL,NULL,0,0.0f,1.0f),"NaN distance scale");
    config.distance_scale=100.0f;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,NULL,NULL,0,NAN,1.0f),"NaN distance");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,NULL,NULL,0,0.0f,NAN),"NaN direct gain");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,fractions,NULL,-1,0.0f,1.0f),"negative hop count");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,
        r2d_audio_zone_attenuation(&config,fractions,NULL,5,0.0f,1.0f),"hop count above limit");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,1.0f,
        r2d_audio_zone_attenuation(&config,NULL,NULL,0,-5.0f,1.0f),"negative distance clamps to direct path");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_presets_distinct_and_valid);
    RUN_TEST(test_room_size_mapping);
    RUN_TEST(test_room_blend_continuity);
    RUN_TEST(test_direct_attenuation);
    RUN_TEST(test_one_hop);
    RUN_TEST(test_two_hops);
    RUN_TEST(test_closed_portal_blocks);
    RUN_TEST(test_hop_limit);
    RUN_TEST(test_material_acoustics);
    RUN_TEST(test_attenuation_bounds_and_determinism);
    RUN_TEST(test_invalid_arguments);
    return UNITY_END();
}
