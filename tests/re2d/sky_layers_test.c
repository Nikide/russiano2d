#include "re2d_world_sky.h"
#include "unity.h"

#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static const char *manifest4 =
    "{\"version\":1,\"layers\":["
    "{\"id\":\"far\",\"texture\":\"assets/sky/far.png\",\"tint\":\"#8fa0b8\",\"parallax\":0.05,\"scroll\":0.001,\"alpha\":0.55,\"offset\":0.02,\"scale\":1.2},"
    "{\"id\":\"hills\",\"texture\":\"assets/sky/hills.png\",\"tint\":\"#5a7a8a\",\"parallax\":0.12,\"scroll\":0.002,\"alpha\":0.45},"
    "{\"id\":\"clouds\",\"texture\":\"assets/sky/clouds.png\",\"parallax\":0.22,\"scroll\":0.004,\"alpha\":0.4},"
    "{\"id\":\"spires\",\"texture\":\"assets/sky/spires.png\",\"parallax\":0.35,\"scroll\":0.006,\"alpha\":0.3}"
    "],\"weather\":{\"rain\":\"assets/sky/rain.png\",\"snow\":\"assets/sky/snow.png\","
    "\"ash\":\"assets/sky/ash.png\",\"clouds\":\"assets/sky/clouds.png\"},"
    "\"sun\":\"assets/sky/sun.png\",\"moon\":\"assets/sky/moon.png\"}";

static void test_parse_manifest_4_layers(void)
{
    R2DWorldSkyManifest m;
    char err[256]={0};
    TEST_ASSERT_TRUE(r2d_world_sky_manifest_parse(manifest4,&m,err,sizeof err));
    TEST_ASSERT_EQUAL_INT(1,m.version);
    TEST_ASSERT_EQUAL_INT(4,m.layer_count);
    TEST_ASSERT_EQUAL_STRING("far",m.layers[0].id);
    TEST_ASSERT_EQUAL_STRING("assets/sky/far.png",m.layers[0].texture);
    TEST_ASSERT_EQUAL_UINT32(0xffb8a08fu,m.layers[0].tint);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f,0.05f,m.layers[0].parallax);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f,0.001f,m.layers[0].scroll);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f,0.55f,m.layers[0].alpha);
    TEST_ASSERT_EQUAL_STRING("spires",m.layers[3].id);
    TEST_ASSERT_EQUAL_INT(4,m.weather_count);
    TEST_ASSERT_EQUAL_STRING("assets/sky/rain.png",m.weather_texture[R2D_SKY_WEATHER_RAIN]);
    TEST_ASSERT_EQUAL_STRING("assets/sky/clouds.png",m.weather_texture[R2D_SKY_WEATHER_CLOUDS]);
    TEST_ASSERT_EQUAL_STRING("assets/sky/sun.png",m.sun_texture);
    TEST_ASSERT_EQUAL_STRING("assets/sky/moon.png",m.moon_texture);
}

static void test_apply_manifest(void)
{
    R2DWorldSkyManifest m;char err[256]={0};
    TEST_ASSERT_TRUE(r2d_world_sky_manifest_parse(manifest4,&m,err,sizeof err));
    R2DWorldSky sky;r2d_world_sky_defaults(&sky);
    TEST_ASSERT_TRUE(r2d_world_sky_apply_manifest(&sky,&m));
    TEST_ASSERT_EQUAL_INT(4,sky.layer_count);
    TEST_ASSERT_EQUAL_STRING("far",sky.layers[0].id);
    TEST_ASSERT_EQUAL_STRING("assets/sky/far.png",sky.layers[0].texture_path);
    TEST_ASSERT_EQUAL_INT(-1,sky.layers[0].texture);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f,0.12f,sky.layers[1].parallax);
    TEST_ASSERT_EQUAL_STRING("assets/sky/sun.png",sky.sun_texture);
    TEST_ASSERT_EQUAL_STRING("assets/sky/moon.png",sky.moon_texture);
    TEST_ASSERT_EQUAL_STRING("assets/sky/snow.png",sky.weather_texture[R2D_SKY_WEATHER_SNOW]);
    TEST_ASSERT_TRUE(r2d_world_sky_validate(&sky));
    TEST_ASSERT_EQUAL_STRING("far",sky.layers[0].id);
    TEST_ASSERT_FALSE(r2d_world_sky_apply_manifest(NULL,&m));
    TEST_ASSERT_FALSE(r2d_world_sky_apply_manifest(&sky,NULL));
}

static void test_parse_rejects_invalid(void)
{
    R2DWorldSkyManifest m;char err[256];
    const char *bad[] = {
        "{\"version\":2,\"layers\":[{\"id\":\"a\",\"texture\":\"a.png\"}]}",
        "{\"version\":1,\"layers\":[]}",
        "{\"version\":1,\"layers\":[{\"id\":\"a\",\"texture\":\"a.png\"},{\"id\":\"a\",\"texture\":\"b.png\"}]}",
        "{\"version\":1,\"layers\":[{\"id\":\"a\",\"texture\":\"a.png\",\"tint\":\"red\"}]}",
        "{\"version\":1,\"layers\":[{\"id\":\"a\",\"texture\":\"a.png\",\"parallax\":-1}]}",
        "{\"version\":1,\"layers\":[{\"id\":\"\",\"texture\":\"a.png\"}]}",
        "{\"version\":1,\"layers\":[{\"id\":\"a\",\"texture\":\"a.png\",\"alpha\":2}]}",
        "{\"version\":1,\"layers\":[{\"id\":\"a\",\"texture\":\"a.png\"},{\"id\":\"b\",\"texture\":\"b.png\"},{\"id\":\"c\",\"texture\":\"c.png\"},{\"id\":\"d\",\"texture\":\"d.png\"},{\"id\":\"e\",\"texture\":\"e.png\"}]}",
        "{\"version\":1,\"layers\":[{\"id\":\"a\",\"texture\":\"a.png\"}],\"weather\":{\"rain\":5}}",
        "{\"version\":1,\"layers\":[{\"id\":\"a\",\"texture\":\"a.png\"}",
    };
    for(size_t i=0;i<sizeof bad/sizeof *bad;i++){
        TEST_ASSERT_FALSE(r2d_world_sky_manifest_parse(bad[i],&m,err,sizeof err));
        TEST_ASSERT_TRUE(err[0]!=0);
        TEST_ASSERT_EQUAL_INT(0,m.layer_count);
    }
    TEST_ASSERT_FALSE(r2d_world_sky_manifest_parse(NULL,&m,err,sizeof err));
}

static void test_layer_authoring_validation(void)
{
    R2DWorldSky sky;r2d_world_sky_defaults(&sky);
    TEST_ASSERT_TRUE(r2d_world_sky_set_layer(&sky,0,"my_far","assets/sky/far.png",0xff808080u,0.1f,1.5f,0.0f,0.6f,0.002f));
    TEST_ASSERT_EQUAL_INT(3,sky.layer_count); // default 3; index 0 does not shrink
    TEST_ASSERT_EQUAL_STRING("my_far",sky.layers[0].id);
    TEST_ASSERT_EQUAL_STRING("assets/sky/far.png",sky.layers[0].texture_path);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f,1.5f,sky.layers[0].scale);
    TEST_ASSERT_FALSE(r2d_world_sky_set_layer(&sky,4,"x","x.png",0,0,1,0,1,0));
    TEST_ASSERT_FALSE(r2d_world_sky_set_layer(NULL,0,"x","x.png",0,0,1,0,1,0));
    TEST_ASSERT_FALSE(r2d_world_sky_set_layer(&sky,0,"x","x.png",0,-1,1,0,1,0));
    TEST_ASSERT_FALSE(r2d_world_sky_set_layer(&sky,0,"x","x.png",0,0,0.01f,0,1,0));
    TEST_ASSERT_FALSE(r2d_world_sky_set_layer(&sky,0,"x","x.png",0,0,1,11,1,0));
    char long_path[200];memset(long_path,'p',sizeof long_path-1);long_path[sizeof long_path-1]=0;
    TEST_ASSERT_FALSE(r2d_world_sky_set_layer(&sky,1,"x",long_path,0,0,1,0,1,0));
    TEST_ASSERT_TRUE(r2d_world_sky_set_layer(&sky,3,NULL,NULL,0,0.3f,2.0f,0.0f,0.2f,0.0f));
    TEST_ASSERT_EQUAL_INT(4,sky.layer_count);
    TEST_ASSERT_EQUAL_STRING("",sky.layers[3].texture_path);

    TEST_ASSERT_TRUE(r2d_world_sky_set_weather_texture(&sky,R2D_SKY_WEATHER_RAIN,"assets/sky/rain.png"));
    TEST_ASSERT_EQUAL_STRING("assets/sky/rain.png",sky.weather_texture[R2D_SKY_WEATHER_RAIN]);
    TEST_ASSERT_FALSE(r2d_world_sky_set_weather_texture(&sky,99,"x.png"));
    TEST_ASSERT_TRUE(r2d_world_sky_set_celestial_texture(&sky,true,"assets/sky/moon.png"));
    TEST_ASSERT_EQUAL_STRING("assets/sky/moon.png",sky.moon_texture);
    TEST_ASSERT_TRUE(r2d_world_sky_apply_manifest(&sky,&(R2DWorldSkyManifest){0})==false);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_parse_manifest_4_layers);
    RUN_TEST(test_apply_manifest);
    RUN_TEST(test_parse_rejects_invalid);
    RUN_TEST(test_layer_authoring_validation);
    return UNITY_END();
}
