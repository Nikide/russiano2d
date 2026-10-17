#include "re2d_world_debug_overlay.h"
#include "re2d_world_render_features.h"
#include "unity.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define W 64
#define H 48

typedef struct {
    R2DRe2dWorld world;
    R2DWorldRegionSet regions;
    R2DWorldClusterSet clusters;
    R2DWorldRegion region_store[2];
    R2DWorldRegionCell region_cells[2];
    uint64_t pvs[2];
    int cell_cluster[2];
    uint8_t states[2];
    R2DWorldOccluder occluder;
    R2DWorldImpostor impostor;
    R2DWorldImpostor impostor_store[1];
    float positions[5];
    const uint8_t *frame_images[1];
    uint8_t sprite[4];
    R2DWorldPixelOwner owners[W*H];
    R2DWorldCell cells[2];
    R2DWorldSpan spans[2];
    R2DWorldPortal portals[1];
    int surface_materials[2];
    R2DWorldRenderFeatures features;
    R2DWorldDebugOverlayContext ctx;
} Fixture;

static void fixture_init(Fixture *f)
{
    memset(f,0,sizeof *f);
    f->cells[0]=(R2DWorldCell){0,0,100,100,0,1};
    f->cells[1]=(R2DWorldCell){100,0,100,100,0,1};
    f->spans[0]=(R2DWorldSpan){0,0,100,100,0,100,0xff404040,0xff606060};
    f->spans[1]=(R2DWorldSpan){100,0,100,100,0,100,0xff404040,0xff606060};
    f->portals[0].cell_a=0;f->portals[0].cell_b=1;
    f->portals[0].ax=100;f->portals[0].ay=0;f->portals[0].bx=100;f->portals[0].by=100;
    f->portals[0].area_portal=true;
    f->world.cells=f->cells;f->world.cell_count=2;
    f->world.spans=f->spans;f->world.span_count=2;
    f->world.portals=f->portals;f->world.portal_count=1;
    f->surface_materials[0]=0;f->surface_materials[1]=0;
    f->world.surface_materials=f->surface_materials;f->world.surface_count=2;

    f->region_store[0]=(R2DWorldRegion){0,0,0,0,100,100,0,1,0,1,0,0};
    f->region_store[1]=(R2DWorldRegion){1,0,100,0,100,100,1,1,0,1,0,0};
    f->region_cells[0]=(R2DWorldRegionCell){0,0,100,100};
    f->region_cells[1]=(R2DWorldRegionCell){100,0,100,100};
    f->pvs[0]=3;f->pvs[1]=3;
    f->regions.regions=f->region_store;f->regions.region_count=2;
    f->regions.region_cells=(int *)f->region_cells; /* same layout: int x,y,w? no */
    f->regions.pvs=f->pvs;f->regions.pvs_words=1;
    f->states[0]=R2D_WORLD_REGION_ACTIVE;f->states[1]=R2D_WORLD_REGION_PRELOADING;

    f->clusters.clusters=NULL; /* only cell_cluster is read by the overlay */
    f->cell_cluster[0]=0;f->cell_cluster[1]=1;
    f->clusters.cell_cluster=f->cell_cluster;f->clusters.cell_cluster_capacity=2;f->clusters.cluster_count=2;

    f->occluder=(R2DWorldOccluder){100,0,100,100};
    f->impostor=(R2DWorldImpostor){1,350,50,0,0,120,80,0,120,0xff808080,1,1,2000.0f,true};
    f->impostor_store[0]=f->impostor;
    f->positions[0]=50;f->positions[1]=50;f->positions[2]=0;f->positions[3]=20;f->positions[4]=40;
    f->sprite[3]=255;f->frame_images[0]=f->sprite;
    for(int i=0;i<W*H;i++)f->owners[i].surface=i%2?0:-1;
    for(int i=0;i<W*H/2;i++){f->owners[i].surface=0;f->owners[i].span=0;}
    r2d_world_render_defaults(&f->features);

    f->ctx.view=0;f->ctx.world=&f->world;f->ctx.regions=&f->regions;
    f->ctx.region_states=f->states;f->ctx.region_current=0;f->ctx.clusters=&f->clusters;
    f->ctx.occluders=&f->occluder;f->ctx.occluder_count=1;
    f->ctx.impostors=f->impostor_store;f->ctx.impostor_count=1;
    f->ctx.frame_positions=f->positions;f->ctx.frame_images=f->frame_images;f->ctx.frame_count=1;
    f->ctx.owners=f->owners;f->ctx.features=&f->features;
    f->ctx.particles_count=10;f->ctx.particles_capacity=100;
    f->ctx.decal_count=3;f->ctx.light_count=2;f->ctx.actors=1;f->ctx.active_regions=1;
    f->ctx.stream_uploads=2;f->ctx.stream_budget=8;
}

static uint32_t hash_frame(const uint8_t *rgba)
{
    uint32_t h=2166136261u;for(size_t i=0;i<(size_t)W*H*4;i++)h=(h^rgba[i])*16777619u;return h;
}

static void test_new_views_draw_something(void)
{
    Fixture f;fixture_init(&f);
    R2DRe2dView view;r2d_re2d_view_set(&view,-50,50,50,0,0,1.2f,W,H);
    uint8_t rgba[W*H*4];
    uint32_t hashes[R2D_WORLD_DEBUG_COUNT]={0};
    for(int mode=R2D_WORLD_DEBUG_FINAL;mode<R2D_WORLD_DEBUG_COUNT;mode++){
        memset(rgba,0,sizeof rgba);
        f.ctx.view=mode;
        r2d_world_debug_overlay_draw(&f.ctx,&view,W,H,rgba);
        uint32_t h=hash_frame(rgba);int nonzero=0;
        for(size_t i=0;i<sizeof rgba;i++)if(rgba[i])nonzero++;
        if(mode<R2D_WORLD_DEBUG_REGION)
            TEST_ASSERT_EQUAL_INT_MESSAGE(0,nonzero,"legacy/FINAL view untouched");
        else {
            {
                static char message[64];
                snprintf(message,sizeof message,"new debug view %d draws pixels",mode);
                TEST_ASSERT_TRUE_MESSAGE(nonzero>0,message);
            }
            hashes[mode]=h;
        }
    }
    for(int a=R2D_WORLD_DEBUG_REGION;a<R2D_WORLD_DEBUG_COUNT;a++)
        for(int b=a+1;b<R2D_WORLD_DEBUG_COUNT;b++)
            TEST_ASSERT_TRUE_MESSAGE(hashes[a]!=hashes[b],"debug views are distinct");
}

static void test_names_and_invalid(void)
{
    TEST_ASSERT_EQUAL_STRING("final",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_FINAL));
    TEST_ASSERT_EQUAL_STRING("overdraw",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_OVERDRAW));
    TEST_ASSERT_EQUAL_STRING("region",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_REGION));
    TEST_ASSERT_EQUAL_STRING("active-region",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_ACTIVE_REGION));
    TEST_ASSERT_EQUAL_STRING("pvs",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_PVS));
    TEST_ASSERT_EQUAL_STRING("vis-cluster",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_VISCLUSTER));
    TEST_ASSERT_EQUAL_STRING("areaportal",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_AREAPORTAL));
    TEST_ASSERT_EQUAL_STRING("occluder",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_OCCLUDER));
    TEST_ASSERT_EQUAL_STRING("distant-lod",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_DISTANT_LOD));
    TEST_ASSERT_EQUAL_STRING("sprite-lod",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_SPRITE_LOD));
    TEST_ASSERT_EQUAL_STRING("material-variation",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_MATERIAL_VARIATION));
    TEST_ASSERT_EQUAL_STRING("ao-lite",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_AO));
    TEST_ASSERT_EQUAL_STRING("vfx-budget",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_VFX_BUDGET));
    TEST_ASSERT_EQUAL_STRING("",r2d_world_debug_mode_name(-1));
    TEST_ASSERT_EQUAL_STRING("",r2d_world_debug_mode_name(R2D_WORLD_DEBUG_COUNT));
    uint8_t rgba[4]={0,0,0,0};
    r2d_world_debug_overlay_draw(NULL,NULL,W,H,rgba);
    r2d_world_debug_overlay_draw(&(R2DWorldDebugOverlayContext){0},NULL,W,H,rgba);
    TEST_ASSERT_EQUAL_UINT8(0,rgba[0]);
    TEST_ASSERT_TRUE(R2D_WORLD_DEBUG_REGION>R2D_WORLD_DEBUG_OVERDRAW);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_new_views_draw_something);
    RUN_TEST(test_names_and_invalid);
    return UNITY_END();
}
