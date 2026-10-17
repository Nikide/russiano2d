// Re2D static batching data path: deterministic grouping, packed SSBO layout,
// material/blend/light/atlas separation, capacity and visibility conversion.
#include "re2d_world.h"
#include "re2d_world_batch.h"
#include "unity.h"

#include <math.h>
#include <stddef.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static R2DWorldBatchItem item(int kind,int surface,int span,int material,int blend,
                              int light,int atlas,uint32_t tint)
{
    R2DWorldBatchItem out;
    r2d_world_batch_item(&out,kind,surface,span,material,blend,light,atlas,tint,0);
    return out;
}

static void build_small_world(R2DRe2dWorld *world,char *error,size_t size)
{
    const R2DWorldWall walls[]={
        {0,0,100,0,0,100,0xff0000ff},
        {0,0,0,100,0,100,0xff00ff00}
    };
    const R2DWorldSpan spans[]={{0,0,100,100,0,100,0xff112233,0xff445566,0,0,0,0}};
    const R2DWorldCell cells[]={{0,0,100,100,0,1}};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build_cells(world,walls,2,spans,1,cells,1,NULL,0,NULL,0,error,size),
                             "batch fixture world builds");
    TEST_ASSERT_TRUE_MESSAGE(world->surface_count>=4,"fixture exposes wall and plane surfaces");
}

static void test_instance_layout(void)
{
    TEST_ASSERT_EQUAL_INT_MESSAGE(32,(int)sizeof(R2DWorldBatchInstance),"instance is 32 bytes");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,(int)offsetof(R2DWorldBatchInstance,surface),"surface offset");
    TEST_ASSERT_EQUAL_INT_MESSAGE(4,(int)offsetof(R2DWorldBatchInstance,span),"span offset");
    TEST_ASSERT_EQUAL_INT_MESSAGE(8,(int)offsetof(R2DWorldBatchInstance,material),"material offset");
    TEST_ASSERT_EQUAL_INT_MESSAGE(12,(int)offsetof(R2DWorldBatchInstance,flags),"flags offset");
    TEST_ASSERT_EQUAL_INT_MESSAGE(16,(int)offsetof(R2DWorldBatchInstance,tint),"tint offset");
    TEST_ASSERT_EQUAL_INT_MESSAGE(20,(int)offsetof(R2DWorldBatchInstance,aux),"aux offset");
    TEST_ASSERT_EQUAL_INT_MESSAGE(24,(int)offsetof(R2DWorldBatchInstance,light),"light offset");
    TEST_ASSERT_EQUAL_INT_MESSAGE(28,(int)offsetof(R2DWorldBatchInstance,atlas),"atlas offset");
}

static void test_item_normalization(void)
{
    R2DWorldBatchItem one;
    r2d_world_batch_item(&one,99,-5,-7,-3,99,99,-9,0xdeadbeefu,7);
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_BATCH_KIND_SKY,one.kind,"kind clamps");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,one.surface,"negative surface normalises to -1");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,one.span,"negative span normalises to -1");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,one.material,"negative material normalises to -1");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_ADDITIVE,one.blend,"blend clamps");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_BATCH_LIGHT_DYNAMIC,one.light_policy,"light clamps");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,one.atlas,"negative atlas normalises to -1");
    TEST_ASSERT_EQUAL_INT_MESSAGE(7,(int)one.aux,"aux preserved");
    r2d_world_batch_item(NULL,0,0,0,0,0,0,0,0,0);
    TEST_ASSERT_TRUE_MESSAGE(1,"NULL item is safe");
}

static void test_key_separation(void)
{
    uint32_t base=r2d_world_batch_key(1,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_STATIC,3);
    TEST_ASSERT_EQUAL_INT_MESSAGE((int)base,(int)r2d_world_batch_key(1,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_STATIC,3),
                                  "same key is stable");
    TEST_ASSERT_TRUE_MESSAGE(base!=r2d_world_batch_key(2,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_STATIC,3),"material separates");
    TEST_ASSERT_TRUE_MESSAGE(base!=r2d_world_batch_key(1,R2D_WORLD_TRANSLUCENT,R2D_WORLD_BATCH_LIGHT_STATIC,3),"blend separates");
    TEST_ASSERT_TRUE_MESSAGE(base!=r2d_world_batch_key(1,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_DYNAMIC,3),"light policy separates");
    TEST_ASSERT_TRUE_MESSAGE(base!=r2d_world_batch_key(1,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_STATIC,4),"atlas separates");
}

static void test_build_groups_and_order(void)
{
    R2DWorldBatchItem items[]={
        item(R2D_WORLD_BATCH_KIND_SURFACE,10,0,3,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_STATIC,-1,0xffffffff),
        item(R2D_WORLD_BATCH_KIND_SURFACE,11,0,1,R2D_WORLD_MASKED,R2D_WORLD_BATCH_LIGHT_DYNAMIC,2,0xffffffff),
        item(R2D_WORLD_BATCH_KIND_ACTOR,5,-1,3,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_STATIC,-1,0xff00ff00),
        item(R2D_WORLD_BATCH_KIND_SURFACE,12,0,1,R2D_WORLD_MASKED,R2D_WORLD_BATCH_LIGHT_DYNAMIC,2,0xffffffff),
        item(R2D_WORLD_BATCH_KIND_SURFACE,13,1,3,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_STATIC,-1,0xffffffff),
        item(R2D_WORLD_BATCH_KIND_SKY,0,-1,-1,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_UNLIT,9,0xffffffff)
    };
    R2DWorldBatchInstance instances[8];
    R2DWorldBatchGroup groups[8];
    R2DWorldBatchBuffers buffers={groups,8,instances,8};
    R2DWorldBatchStats stats;

    TEST_ASSERT_EQUAL_INT_MESSAGE(6,r2d_world_batch_build(items,6,&buffers,&stats),"total instance count");
    TEST_ASSERT_EQUAL_INT_MESSAGE(6,stats.instances,"stats instances");
    TEST_ASSERT_EQUAL_INT_MESSAGE(3,stats.groups,"material/blend/light/atlas groups");
    TEST_ASSERT_EQUAL_INT_MESSAGE(3,stats.saved_binds,"instances minus groups");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,stats.overflow,"no overflow");
    TEST_ASSERT_EQUAL_INT_MESSAGE(4,stats.surfaces,"surface count");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,stats.actors,"actor count");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,stats.skies,"sky count");

    int total=0;
    for(int g=0;g<stats.groups;g++) {
        TEST_ASSERT_EQUAL_INT_MESSAGE(total,(int)groups[g].first,"group first is contiguous");
        TEST_ASSERT_TRUE_MESSAGE(groups[g].count>=1,"group non-empty");
        TEST_ASSERT_TRUE_MESSAGE((int)groups[g].first+(int)groups[g].count<=6,"group stays in range");
        total+=(int)groups[g].count;
        if(g) {
            const R2DWorldBatchGroup *prev=&groups[g-1];
            bool ordered=prev->material<groups[g].material||
                (prev->material==groups[g].material&&prev->blend<groups[g].blend)||
                (prev->material==groups[g].material&&prev->blend==groups[g].blend&&prev->light_policy<groups[g].light_policy)||
                (prev->material==groups[g].material&&prev->blend==groups[g].blend&&prev->light_policy==groups[g].light_policy&&prev->atlas<groups[g].atlas);
            TEST_ASSERT_TRUE_MESSAGE(ordered,"groups sorted by key");
        }
        for(int i=0;i<(int)groups[g].count;i++) {
            const R2DWorldBatchInstance *instance=&instances[groups[g].first+i];
            TEST_ASSERT_EQUAL_UINT32_MESSAGE(groups[g].material,instance->material,"instance material matches group");
            TEST_ASSERT_EQUAL_UINT32_MESSAGE(groups[g].light_policy,instance->light,"instance light matches group");
            TEST_ASSERT_EQUAL_UINT32_MESSAGE(groups[g].atlas,instance->atlas,"instance atlas matches group");
            TEST_ASSERT_EQUAL_UINT32_MESSAGE(groups[g].blend,(instance->flags>>4)&15u,"instance blend matches group");
        }
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(6,total,"groups cover all instances");
}

static void test_material_blend_light_separation(void)
{
    R2DWorldBatchItem items[]={
        item(R2D_WORLD_BATCH_KIND_SURFACE,1,0,3,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_STATIC,-1,0),
        item(R2D_WORLD_BATCH_KIND_SURFACE,2,0,3,R2D_WORLD_TRANSLUCENT,R2D_WORLD_BATCH_LIGHT_STATIC,-1,0),
        item(R2D_WORLD_BATCH_KIND_SURFACE,3,0,3,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_DYNAMIC,-1,0),
        item(R2D_WORLD_BATCH_KIND_SURFACE,4,0,3,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_STATIC,5,0)
    };
    R2DWorldBatchInstance instances[4];
    R2DWorldBatchGroup groups[4];
    R2DWorldBatchBuffers buffers={groups,4,instances,4};
    R2DWorldBatchStats stats;
    TEST_ASSERT_EQUAL_INT_MESSAGE(4,r2d_world_batch_build(items,4,&buffers,&stats),"four separated groups");
    TEST_ASSERT_EQUAL_INT_MESSAGE(4,stats.groups,"same material still separates by blend/light/atlas");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,stats.saved_binds,"one instance per group");
}

static void test_determinism_across_input_order(void)
{
    R2DWorldBatchItem items[]={
        item(R2D_WORLD_BATCH_KIND_SURFACE,7,1,2,R2D_WORLD_MASKED,R2D_WORLD_BATCH_LIGHT_STATIC,1,0x11111111),
        item(R2D_WORLD_BATCH_KIND_SURFACE,3,0,1,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_DYNAMIC,-1,0x22222222),
        item(R2D_WORLD_BATCH_KIND_ACTOR,9,-1,2,R2D_WORLD_MASKED,R2D_WORLD_BATCH_LIGHT_STATIC,1,0x11111111),
        item(R2D_WORLD_BATCH_KIND_SURFACE,1,0,1,R2D_WORLD_OPAQUE,R2D_WORLD_BATCH_LIGHT_DYNAMIC,-1,0x22222222)
    };
    R2DWorldBatchItem reversed[4];
    for(int i=0;i<4;i++) reversed[i]=items[3-i];
    R2DWorldBatchInstance a_instance[4],b_instance[4];
    R2DWorldBatchGroup a_group[4],b_group[4];
    R2DWorldBatchStats a_stats,b_stats;
    R2DWorldBatchBuffers a_buffers={a_group,4,a_instance,4},b_buffers={b_group,4,b_instance,4};
    TEST_ASSERT_EQUAL_INT_MESSAGE(4,r2d_world_batch_build(items,4,&a_buffers,&a_stats),"forward build");
    TEST_ASSERT_EQUAL_INT_MESSAGE(4,r2d_world_batch_build(reversed,4,&b_buffers,&b_stats),"reversed build");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,memcmp(&a_stats,&b_stats,sizeof a_stats),"stats independent of input order");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,memcmp(a_group,b_group,(size_t)a_stats.groups*sizeof a_group[0]),"groups independent of input order");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,memcmp(a_instance,b_instance,sizeof a_instance),"instances independent of input order");
    for(int i=1;i<a_stats.groups;i++)
        TEST_ASSERT_TRUE_MESSAGE(a_group[i-1].material<=a_group[i].material,"deterministic group order");
}

static void test_capacity_truncation(void)
{
    R2DWorldBatchItem items[5];
    for(int i=0;i<5;i++) items[i]=item(R2D_WORLD_BATCH_KIND_SURFACE,i,0,i,R2D_WORLD_OPAQUE,
                                        R2D_WORLD_BATCH_LIGHT_STATIC,-1,0);
    R2DWorldBatchInstance instances[2];
    R2DWorldBatchGroup groups[1];
    R2DWorldBatchBuffers buffers={groups,1,instances,2};
    R2DWorldBatchStats stats;
    TEST_ASSERT_EQUAL_INT_MESSAGE(5,r2d_world_batch_build(items,5,&buffers,&stats),"returns required instances");
    TEST_ASSERT_EQUAL_INT_MESSAGE(5,stats.instances,"required count in stats");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,stats.overflow,"truncation marks overflow");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,(int)groups[0].count,"written group covers written instances");

    R2DWorldBatchBuffers count_only={NULL,0,NULL,0};
    TEST_ASSERT_EQUAL_INT_MESSAGE(5,r2d_world_batch_build(items,5,&count_only,&stats),"count-only build");
    TEST_ASSERT_EQUAL_INT_MESSAGE(5,stats.groups,"count-only still counts groups");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,stats.saved_binds,"five separate groups save nothing");
}

static void test_from_visibility_world(void)
{
    R2DRe2dWorld world={0};
    char error[256];
    build_small_world(&world,error,sizeof error);

    static uint8_t white_pixel[4]={255,255,255,255};
    R2DWorldMaterial emissive={0};
    emissive.albedo=(R2DWorldTexture){white_pixel,1,1};
    emissive.blend=R2D_WORLD_ADDITIVE;
    emissive.emissive_strength=1.0f;
    emissive.opacity=1.0f;
    emissive.u_scale=1.0f;
    emissive.v_scale=1.0f;
    strcpy(emissive.name,"batch-emissive");
    int material=r2d_world_material_set(&world,&emissive);
    TEST_ASSERT_TRUE_MESSAGE(material>=0,"material installed");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_surface_material(&world,0,material),"material assigned to wall surface");

    R2DWorldVisibility visibility={0};
    static int surfaces[64];
    int count=world.surface_count<64?world.surface_count:64;
    for(int i=0;i<count;i++) surfaces[i]=i;
    visibility.surfaces=surfaces;
    visibility.surface_count=count;

    R2DWorldBatchItem items[64];
    R2DWorldBatchStats stats;
    int total=r2d_world_batch_from_visibility(&world,&visibility,items,64,&stats);
    TEST_ASSERT_EQUAL_INT_MESSAGE(count,total,"surface conversion count");
    TEST_ASSERT_EQUAL_INT_MESSAGE(count,stats.surfaces,"stats surfaces");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,stats.overflow,"conversion fits");
    TEST_ASSERT_EQUAL_INT_MESSAGE(material,items[0].material,"surface material read from world");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_ADDITIVE,items[0].blend,"material blend read");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_BATCH_LIGHT_UNLIT,items[0].light_policy,"emissive is unlit policy");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0xff0000ffu,items[0].tint,"wall tint from authored color");
    TEST_ASSERT_EQUAL_INT_MESSAGE((int)R2D_WORLD_BATCH_KIND_SURFACE,items[0].kind,"surface kind");

    int plane=-1;
    for(int i=0;i<count;i++) if(items[i].span>=0) { plane=i; break; }
    TEST_ASSERT_TRUE_MESSAGE(plane>=0,"found a floor/ceiling surface");
    TEST_ASSERT_TRUE_MESSAGE(items[plane].span==0,"plane span id");

    // Truncated conversion reports the required count and overflow.
    R2DWorldBatchStats truncated;
    TEST_ASSERT_EQUAL_INT_MESSAGE(count,r2d_world_batch_from_visibility(&world,&visibility,items,1,&truncated),
                                  "truncated conversion reports total");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,truncated.overflow,"truncated conversion marks overflow");
    r2d_world_free(&world);
}

static void test_visibility_pipeline(void)
{
    R2DRe2dWorld world={0};
    char error[256];
    build_small_world(&world,error,sizeof error);
    R2DWorldVisibility visibility={0};
    static int surfaces[64];
    int count=world.surface_count<64?world.surface_count:64;
    for(int i=0;i<count;i++) surfaces[i]=i;
    visibility.surfaces=surfaces;visibility.surface_count=count;

    R2DWorldBatchItem scratch_items[64];
    R2DWorldBatchScratch scratch={scratch_items,0,64};
    R2DWorldBatchInstance instances[64];
    R2DWorldBatchGroup groups[64];
    R2DWorldBatchBuffers buffers={groups,64,instances,64};
    R2DWorldBatchStats stats;
    int total=r2d_world_batch_visibility(&world,&visibility,&scratch,&buffers,&stats);
    TEST_ASSERT_EQUAL_INT_MESSAGE(count,total,"visibility pipeline total");
    TEST_ASSERT_EQUAL_INT_MESSAGE(count,stats.instances,"pipeline instances");
    TEST_ASSERT_TRUE_MESSAGE(stats.groups>=1,"pipeline groups");
    int sum=0;
    for(int g=0;g<stats.groups;g++) sum+=(int)groups[g].count;
    TEST_ASSERT_EQUAL_INT_MESSAGE(total,sum,"pipeline groups cover instances");

    R2DWorldBatchInstance repeat_instances[64];
    R2DWorldBatchGroup repeat_groups[64];
    R2DWorldBatchBuffers repeat_buffers={repeat_groups,64,repeat_instances,64};
    R2DWorldBatchStats repeat_stats;
    TEST_ASSERT_EQUAL_INT_MESSAGE(total,r2d_world_batch_visibility(&world,&visibility,&scratch,&repeat_buffers,&repeat_stats),
                                  "pipeline repeat total");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,memcmp(&stats,&repeat_stats,sizeof stats),"pipeline stats deterministic");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,memcmp(groups,repeat_groups,(size_t)stats.groups*sizeof groups[0]),
                                  "pipeline groups deterministic");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,memcmp(instances,repeat_instances,(size_t)total*sizeof instances[0]),
                                  "pipeline instances deterministic");
    r2d_world_free(&world);
}

static void test_invalid_arguments(void)
{
    R2DWorldBatchItem items[1]={item(R2D_WORLD_BATCH_KIND_SURFACE,0,0,-1,R2D_WORLD_OPAQUE,
                                     R2D_WORLD_BATCH_LIGHT_STATIC,-1,0)};
    R2DWorldBatchInstance instances[1];
    R2DWorldBatchGroup groups[1];
    R2DWorldBatchBuffers buffers={groups,1,instances,1};
    R2DWorldBatchStats stats;
    R2DWorldVisibility visibility={0};
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_batch_build(NULL,1,&buffers,&stats),"NULL items with count");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_batch_build(items,-1,&buffers,&stats),"negative item count");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_batch_build(items,1,NULL,&stats),"NULL buffers");
    R2DWorldBatchBuffers bad={groups,1,NULL,1};
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_batch_build(items,1,&bad,&stats),"NULL instances with capacity");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_batch_from_visibility(NULL,&visibility,items,1,&stats),"NULL world");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_batch_visibility(NULL,&visibility,NULL,&buffers,&stats),"NULL scratch");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_batch_from_visibility(&(R2DRe2dWorld){0},&visibility,items,-1,&stats),
                                  "negative capacity");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_instance_layout);
    RUN_TEST(test_item_normalization);
    RUN_TEST(test_key_separation);
    RUN_TEST(test_build_groups_and_order);
    RUN_TEST(test_material_blend_light_separation);
    RUN_TEST(test_determinism_across_input_order);
    RUN_TEST(test_capacity_truncation);
    RUN_TEST(test_from_visibility_world);
    RUN_TEST(test_visibility_pipeline);
    RUN_TEST(test_invalid_arguments);
    return UNITY_END();
}
