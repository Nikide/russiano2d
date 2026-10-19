#include "re2d_world.h"
#include "unity.h"
#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static R2DRe2dWorld make_world(void)
{
    const R2DWorldSpan span={0,0,64,64,0,96,0xff404040,0xff606060};
    const R2DWorldCell cell={0,0,64,64,0,1};
    R2DRe2dWorld w={0};char err[128]={0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build_cells(&w,NULL,0,&span,1,&cell,1,NULL,0,NULL,0,err,sizeof err),"decal fixture topology");
    R2DWorldMaterial m;memset(&m,0,sizeof m);
    static uint8_t pixels[4*4*4];for(int i=0;i<4*4;i++){pixels[i*4+0]=255;pixels[i*4+1]=80;pixels[i*4+2]=20;pixels[i*4+3]=255;}
    memcpy(m.name,"paint",6);
    m.albedo.pixels=pixels;m.albedo.width=4;m.albedo.height=4;m.opacity=1.0f;m.u_scale=1.0f;m.v_scale=1.0f;
    TEST_ASSERT_TRUE(r2d_world_material_set(&w,&m)>=0);
    return w;
}

static void test_decal2_authoring_and_fade(void)
{
    R2DRe2dWorld w=make_world();
    R2DWorldDecal legacy={.surface=0,.material=0,.u=8,.v=8,.w=32,.h=32,.remaining=5.0f};
    int a=r2d_world_decal_create(&w,&legacy);
    TEST_ASSERT_TRUE(a>=0);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f,1.0f,r2d_world_decal_alpha(&w.decals[a%128]));
    TEST_ASSERT_EQUAL_FLOAT(0.0f,w.decals[a%128].max_life); // legacy form stays legacy

    R2DWorldDecal modern={.surface=0,.material=0,.u=8,.v=8,.w=32,.h=32,.remaining=2.0f,
        .max_life=2.0f,.rotation=0.4f,.scale=1.4f,.fade_in=0.5f,.fade_out=0.5f};
    int b=r2d_world_decal_create(&w,&modern);
    TEST_ASSERT_TRUE(b>=0);
    R2DWorldDecal *d=&w.decals[b%128];
    TEST_ASSERT_FLOAT_WITHIN(1e-5f,0.0f,r2d_world_decal_alpha(d));
    r2d_world_decal_step(&w,0.5f);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f,1.0f,r2d_world_decal_alpha(d));
    r2d_world_decal_step(&w,1.0f);
    r2d_world_decal_step(&w,0.25f);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(1e-5f,0.5f,r2d_world_decal_alpha(d),"fade-out halves alpha");
    r2d_world_decal_step(&w,0.25f);
    TEST_ASSERT_FALSE(d->active);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f,0.0f,r2d_world_decal_alpha(d));
    TEST_ASSERT_TRUE(r2d_world_decal_remove(&w,a));
    r2d_world_free(&w);
}

static void test_decal2_validation_and_budget(void)
{
    R2DRe2dWorld w=make_world();
    R2DWorldDecal bad={.surface=0,.material=0,.u=8,.v=8,.w=32,.h=32,.remaining=1.0f,.max_life=-1};
    TEST_ASSERT_EQUAL_INT(-1,r2d_world_decal_create(&w,&bad));
    bad.max_life=1.0f;bad.scale=99;
    TEST_ASSERT_EQUAL_INT(-1,r2d_world_decal_create(&w,&bad));
    bad.scale=1.0f;bad.fade_in=-1;
    TEST_ASSERT_EQUAL_INT(-1,r2d_world_decal_create(&w,&bad));
    bad.fade_in=0;bad.surface=999;
    TEST_ASSERT_EQUAL_INT(-1,r2d_world_decal_create(&w,&bad));
    TEST_ASSERT_EQUAL_INT(-1,r2d_world_decal_create(NULL,&bad));
    TEST_ASSERT_FLOAT_WITHIN(1e-5f,0.0f,r2d_world_decal_alpha(NULL));

    R2DWorldDecal ok={.surface=0,.material=0,.u=0,.v=0,.w=8,.h=8,.remaining=1.0f};
    int created=0;
    for(int i=0;i<128;i++)if(r2d_world_decal_create(&w,&ok)>=0)created++;
    TEST_ASSERT_EQUAL_INT_MESSAGE(128,created,"decal render budget starts at 128");
    // Хранилище динамическое: создание сверх бюджета успешно и вытесняет
    // самую старую/низкоприоритетную декаль, а не отвергает контент.
    const int extra=r2d_world_decal_create(&w,&ok);
    TEST_ASSERT_GREATER_OR_EQUAL_INT_MESSAGE(0,extra,"decal creation beyond the budget succeeds");
    TEST_ASSERT_EQUAL_INT(128,w.decal_count);
    TEST_ASSERT_TRUE_MESSAGE(w.decal_evicted>0,"budget overflow evicts deterministically");
    r2d_world_free(&w);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_decal2_authoring_and_fade);
    RUN_TEST(test_decal2_validation_and_budget);
    return UNITY_END();
}
