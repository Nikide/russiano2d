#include "re2d_world.h"
#include "re2d_world_trace.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-5f

// One 100x100 span, one vertical wall at x=50 spanning the full height. A ray
// from (10,50,50) to (90,50,50) therefore hits the wall at fraction 0.5.
static void build_fixture(R2DRe2dWorld *world)
{
    const R2DWorldSpan spans[] = {
        {0,0,100,100,0,100,0xff00ff00,0xff888888,0,0,0,0}
    };
    const R2DWorldWall walls[] = {
        {50,0,50,100,0,100,0xff0000ff}
    };
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build(world,walls,1,spans,1),"fixture world builds");
}

static R2DWorldHitProxy make_proxy(float x,float y,float radius,float bottom,float top,int category,int node)
{
    R2DWorldHitProxy proxy;
    proxy.x=x; proxy.y=y; proxy.bottom=bottom; proxy.top=top;
    proxy.radius=radius; proxy.category=category; proxy.node=node;
    return proxy;
}

static void test_ray_world_and_proxy_order(void)
{
    R2DRe2dWorld world={0};
    build_fixture(&world);
    const float from[3]={10,50,50},to[3]={90,50,50};
    const int mask=R2D_WORLD_TRACE_WORLD|R2D_WORLD_TRACE_ENEMY;
    R2DWorldTraceResult hit;

    // Proxy in front of the wall: entry at x=25 -> (25-10)/80 = 0.1875.
    R2DWorldHitProxy near_proxy[1]={make_proxy(30,50,5,0,100,R2D_WORLD_TRACE_ENEMY,7)};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,near_proxy,1,from,to,mask,-1,&hit),"near proxy traced");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_TRACE_SPRITE,hit.type,"near proxy wins over the wall");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.1875f,hit.fraction,"near proxy fraction");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,hit.proxy,"near proxy index");
    TEST_ASSERT_EQUAL_INT_MESSAGE(7,hit.node,"proxy node id is preserved");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,hit.surface,"sprite has no world surface");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,hit.span,"sprite has no world span");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,hit.nx,"sprite normal faces the origin in x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,hit.ny,"sprite normal has no lateral component");

    // Proxy behind the wall: entry at x=65 -> 0.6875, so the wall wins at 0.5.
    R2DWorldHitProxy far_proxy[1]={make_proxy(70,50,5,0,100,R2D_WORLD_TRACE_ENEMY,9)};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,far_proxy,1,from,to,mask,-1,&hit),"wall traced");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_TRACE_SURFACE,hit.type,"wall occludes the far proxy");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.5f,hit.fraction,"wall fraction");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,hit.surface,"wall index reported as surface");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,hit.span,"wall hit has no span");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,hit.nx,"wall normal faces the ray origin");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,hit.ny,"vertical wall normal is axial");

    r2d_world_free(&world);
}

static void test_nearest_proxy_wins(void)
{
    R2DRe2dWorld world={0};
    build_fixture(&world);
    const float from[3]={10,50,50},to[3]={90,50,50};
    R2DWorldTraceResult hit;

    R2DWorldHitProxy proxies[2]={
        make_proxy(30,50,5,0,100,R2D_WORLD_TRACE_ENEMY,1),
        make_proxy(60,50,5,0,100,R2D_WORLD_TRACE_ENEMY,2)
    };
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,proxies,2,from,to,R2D_WORLD_TRACE_ENEMY,-1,&hit),"two proxies traced");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,hit.proxy,"nearest proxy index with input order");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.1875f,hit.fraction,"nearest proxy fraction");

    R2DWorldHitProxy reversed[2]={proxies[1],proxies[0]};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,reversed,2,from,to,R2D_WORLD_TRACE_ENEMY,-1,&hit),"reversed proxies traced");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,hit.proxy,"nearest wins regardless of array order");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,hit.node,"reversed proxy node id");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.1875f,hit.fraction,"reversed nearest fraction");

    r2d_world_free(&world);
}

static void test_category_mask(void)
{
    R2DRe2dWorld world={0};
    build_fixture(&world);
    const float from[3]={10,50,50},to[3]={90,50,50};
    R2DWorldTraceResult hit;

    R2DWorldHitProxy proxies[2]={
        make_proxy(30,50,5,0,100,1,11),          // category 1 -> shifted ENEMY bit
        make_proxy(70,50,5,0,100,2,12)           // category 2 -> shifted BREAKABLE bit
    };
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,proxies,2,from,to,R2D_WORLD_TRACE_ENEMY,-1,&hit),"enemy mask selects enemy");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,hit.proxy,"enemy proxy selected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.1875f,hit.fraction,"enemy proxy fraction");

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,proxies,2,from,to,R2D_WORLD_TRACE_BREAKABLE,-1,&hit),"breakable mask selects breakable");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,hit.proxy,"breakable proxy selected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.6875f,hit.fraction,"breakable proxy fraction");

    // The enemy proxy is excluded by a mask without its bit.
    R2DWorldHitProxy only_enemy[1]={make_proxy(30,50,5,0,100,1,13)};
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trace_ray(&world,only_enemy,1,from,to,R2D_WORLD_TRACE_BREAKABLE,-1,&hit),"enemy excluded by breakable-only mask");

    // World only: static geometry is filterable as its own category. No proxies
    // are supplied because a proxy whose raw category value contains bit 1 also
    // matches the world bit under the documented OR rule.
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,NULL,0,from,to,R2D_WORLD_TRACE_WORLD,-1,&hit),"world-only mask");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_TRACE_SURFACE,hit.type,"world-only mask hits the wall");

    // Direct enum-style value (>=8) also matches through the unshifted term.
    R2DWorldHitProxy direct[1]={make_proxy(30,50,5,0,100,8,14)};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,direct,1,from,to,8,-1,&hit),"direct category 8 matches mask 8");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,hit.proxy,"direct enum category proxy index");

    // High categories only use the shifted-bit term.
    R2DWorldHitProxy shifted[1]={make_proxy(30,50,5,0,100,8,15)};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,shifted,1,from,to,256,-1,&hit),"shifted category 8 matches bit 256");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,hit.proxy,"shifted category proxy index");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trace_ray(&world,shifted,1,from,to,R2D_WORLD_TRACE_ENEMY,-1,&hit),"shifted category 8 does not match enemy bit");

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,proxies,2,from,to,R2D_WORLD_TRACE_ENEMY|R2D_WORLD_TRACE_BREAKABLE,-1,&hit),"combined mask selects nearest");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,hit.proxy,"combined mask keeps nearest proxy");

    r2d_world_free(&world);
}

static void test_ignore_proxy(void)
{
    R2DRe2dWorld world={0};
    build_fixture(&world);
    const float from[3]={10,50,50},to[3]={90,50,50};
    const int mask=R2D_WORLD_TRACE_ENEMY|R2D_WORLD_TRACE_BREAKABLE;
    R2DWorldTraceResult hit;

    R2DWorldHitProxy proxies[2]={
        make_proxy(30,50,5,0,100,R2D_WORLD_TRACE_ENEMY,21),
        make_proxy(70,50,5,0,100,R2D_WORLD_TRACE_BREAKABLE,22)
    };
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,proxies,2,from,to,mask,-1,&hit),"no ignore hits nearest");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,hit.proxy,"nearest proxy without ignore");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,proxies,2,from,to,mask,0,&hit),"ignore zero");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,hit.proxy,"ignore_proxy=0 skips the near proxy");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.6875f,hit.fraction,"ignored proxy reveals the far one");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,proxies,2,from,to,mask,1,&hit),"ignore one");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,hit.proxy,"ignore_proxy=1 keeps the near proxy");

    r2d_world_free(&world);
}

static void test_collect_sorted_and_count(void)
{
    R2DRe2dWorld world={0};
    build_fixture(&world);
    const float from[3]={10,50,50},to[3]={90,50,50};
    const int mask=R2D_WORLD_TRACE_WORLD|R2D_WORLD_TRACE_ENEMY|R2D_WORLD_TRACE_BREAKABLE;
    R2DWorldHitProxy proxies[2]={
        make_proxy(30,50,5,0,100,R2D_WORLD_TRACE_ENEMY,31),
        make_proxy(70,50,5,0,100,R2D_WORLD_TRACE_BREAKABLE,32)
    };
    R2DWorldTraceResult hits[8];

    TEST_ASSERT_EQUAL_INT_MESSAGE(3,r2d_world_trace_collect(&world,proxies,2,from,to,mask,-1,NULL,0),"count query with NULL out");
    TEST_ASSERT_EQUAL_INT_MESSAGE(3,r2d_world_trace_collect(&world,proxies,2,from,to,mask,-1,hits,8),"collect three hits");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_TRACE_SPRITE,hits[0].type,"first hit is the near sprite");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.1875f,hits[0].fraction,"first sorted fraction");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_TRACE_SURFACE,hits[1].type,"second hit is the wall");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.5f,hits[1].fraction,"second sorted fraction");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_TRACE_SPRITE,hits[2].type,"third hit is the far sprite");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.6875f,hits[2].fraction,"third sorted fraction");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,hits[0].proxy,"near sprite index");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,hits[2].proxy,"far sprite index");

    // Truncation keeps the nearest capacity hits but reports the total.
    R2DWorldTraceResult nearest[2];
    TEST_ASSERT_EQUAL_INT_MESSAGE(3,r2d_world_trace_collect(&world,proxies,2,from,to,mask,-1,nearest,2),"truncated collect reports total");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_TRACE_SPRITE,nearest[0].type,"truncated first hit");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_TRACE_SURFACE,nearest[1].type,"truncated second hit");
    TEST_ASSERT_EQUAL_INT_MESSAGE(3,r2d_world_trace_collect(&world,proxies,2,from,to,mask,-1,nearest,0),"zero capacity still reports total");

    // Tie at exactly 0.5: wall before sprite.
    const float tie_from[3]={0,50,50},tie_to[3]={100,50,50};
    R2DWorldHitProxy tie_proxy[1]={make_proxy(52,50,2,0,100,R2D_WORLD_TRACE_ENEMY,33)};
    R2DWorldTraceResult tie_hits[2];
    TEST_ASSERT_EQUAL_INT_MESSAGE(2,r2d_world_trace_collect(&world,tie_proxy,1,tie_from,tie_to,mask,-1,tie_hits,2),"tie collects both hits");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_TRACE_SURFACE,tie_hits[0].type,"world wins the equal-fraction tie");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_TRACE_SPRITE,tie_hits[1].type,"sprite follows on the tie");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.5f,tie_hits[0].fraction,"tie world fraction");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.5f,tie_hits[1].fraction,"tie sprite fraction");
    R2DWorldTraceResult tie_ray;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,tie_proxy,1,tie_from,tie_to,mask,-1,&tie_ray),"tie ray resolved");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_TRACE_SURFACE,tie_ray.type,"nearest ray also prefers world on a tie");

    r2d_world_free(&world);
}

static void test_proxy_sweep(void)
{
    R2DWorldHitProxy proxy=make_proxy(52,50,5,0,100,R2D_WORLD_TRACE_ENEMY,41);

    // Expanded radius 5+1=6, entry at x=46 -> 0.46 along (0..100).
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.46f,r2d_world_proxy_sweep(&proxy,0,50,100,50,1,40,60),"direct sweep fraction");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,r2d_world_proxy_sweep(&proxy,0,50,100,50,1,100,120),"sweep touching the proxy top is a miss");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,r2d_world_proxy_sweep(&proxy,0,50,100,50,1,-20,0),"sweep touching the proxy bottom is a miss");
    // Tangent (y offset exactly the radius) is a documented miss.
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,r2d_world_proxy_sweep(&proxy,0,55,100,55,0,40,60),"tangent sweep is a miss");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,r2d_world_proxy_sweep(&proxy,0,60,100,60,0,40,60),"outside sweep is a miss");
    // Arrow passing above the proxy top: vertical intervals do not overlap.
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,r2d_world_proxy_sweep(&proxy,0,50,100,50,1,110,120),"sweep above the proxy top is a miss");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,r2d_world_proxy_sweep(&proxy,0,50,100,50,1,-20,-10),"sweep below the proxy bottom is a miss");
    // Starting inside the footprint is an immediate entry at fraction zero.
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,r2d_world_proxy_sweep(&proxy,50,50,100,50,1,40,60),"sweep from inside the footprint");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,r2d_world_proxy_sweep(&proxy,52,50,52,50,1,40,60),"degenerate sweep inside the footprint");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,r2d_world_proxy_sweep(&proxy,0,50,0,50,1,40,60),"degenerate sweep outside the footprint");
    // Invalid inputs.
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,r2d_world_proxy_sweep(NULL,0,50,100,50,1,40,60),"NULL proxy rejected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,r2d_world_proxy_sweep(&proxy,NAN,50,100,50,1,40,60),"NaN sweep origin rejected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,r2d_world_proxy_sweep(&proxy,0,50,100,50,-1,40,60),"negative sweep radius rejected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,r2d_world_proxy_sweep(&proxy,0,50,100,50,1,120,110),"inverted vertical interval rejected");
    R2DWorldHitProxy invalid=proxy; invalid.radius=0;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,r2d_world_proxy_sweep(&invalid,0,50,100,50,1,40,60),"zero proxy radius rejected");
    invalid=proxy; invalid.x=NAN;
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-1.0f,r2d_world_proxy_sweep(&invalid,0,50,100,50,1,40,60),"non-finite proxy ignored");
}

static void test_determinism_and_degenerate_rays(void)
{
    R2DRe2dWorld world={0};
    build_fixture(&world);
    const float from[3]={10,50,50},to[3]={90,50,50};
    const int mask=R2D_WORLD_TRACE_WORLD|R2D_WORLD_TRACE_ENEMY|R2D_WORLD_TRACE_BREAKABLE;
    R2DWorldHitProxy proxies[2]={
        make_proxy(30,50,5,0,100,R2D_WORLD_TRACE_ENEMY,51),
        make_proxy(70,50,5,0,100,R2D_WORLD_TRACE_BREAKABLE,52)
    };

    R2DWorldTraceResult first_ray,next_ray;
    R2DWorldTraceResult first_hits[3],next_hits[3];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,proxies,2,from,to,mask,-1,&first_ray),"determinism baseline ray");
    TEST_ASSERT_EQUAL_INT_MESSAGE(3,r2d_world_trace_collect(&world,proxies,2,from,to,mask,-1,first_hits,3),"determinism baseline collect");
    for(int i=0;i<64;i++) {
        TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,proxies,2,from,to,mask,-1,&next_ray),"repeat ray succeeds");
        TEST_ASSERT_EQUAL_INT_MESSAGE(0,memcmp(&first_ray,&next_ray,sizeof first_ray),"repeat ray is bit-identical");
        TEST_ASSERT_EQUAL_INT_MESSAGE(3,r2d_world_trace_collect(&world,proxies,2,from,to,mask,-1,next_hits,3),"repeat collect succeeds");
        TEST_ASSERT_EQUAL_INT_MESSAGE(0,memcmp(first_hits,next_hits,sizeof first_hits),"repeat collect is bit-identical");
    }

    // Zero-length segment: only a point already inside a proxy can hit (at 0).
    const float point_in[3]={30,50,50},point_out[3]={90,90,50};
    R2DWorldTraceResult hit;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,proxies,2,point_in,point_in,R2D_WORLD_TRACE_ENEMY,-1,&hit),"degenerate ray inside proxy");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_TRACE_SPRITE,hit.type,"degenerate point hit is a sprite");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,hit.fraction,"degenerate point hit fraction");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trace_ray(&world,proxies,2,point_out,point_out,mask,-1,&hit),"degenerate ray outside geometry misses");

    // Invalid proxies are ignored, not fatal.
    R2DWorldHitProxy bad[2]={make_proxy(30,50,0,0,100,R2D_WORLD_TRACE_ENEMY,61),make_proxy(70,50,NAN,0,100,R2D_WORLD_TRACE_ENEMY,62)};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_trace_ray(&world,bad,2,from,to,mask,-1,&hit),"invalid proxies are skipped");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_TRACE_SURFACE,hit.type,"only the wall remains after skipping bad proxies");

    r2d_world_free(&world);
}

static void test_invalid_trace_inputs(void)
{
    R2DRe2dWorld world={0};
    build_fixture(&world);
    const float from[3]={10,50,50},to[3]={90,50,50};
    const int mask=R2D_WORLD_TRACE_WORLD|R2D_WORLD_TRACE_ENEMY;
    R2DWorldHitProxy proxies[1]={make_proxy(30,50,5,0,100,R2D_WORLD_TRACE_ENEMY,71)};
    R2DWorldTraceResult hit;
    R2DWorldTraceResult hits[2];

    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trace_ray(NULL,proxies,1,from,to,mask,-1,&hit),"NULL world rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trace_ray(&world,NULL,1,from,to,mask,-1,&hit),"NULL proxies with count>0 rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trace_ray(&world,proxies,1,NULL,to,mask,-1,&hit),"NULL from rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trace_ray(&world,proxies,1,from,NULL,mask,-1,&hit),"NULL to rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trace_ray(&world,proxies,1,from,to,mask,-1,NULL),"NULL result rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trace_ray(&world,proxies,-1,from,to,mask,-1,&hit),"negative proxy count rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trace_ray(&world,proxies,1,from,to,mask,-2,&hit),"ignore_proxy below -1 rejected");
    const float nan_from[3]={NAN,50,50},inf_to[3]={INFINITY,50,50};
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trace_ray(&world,proxies,1,nan_from,to,mask,-1,&hit),"NaN origin rejected");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_trace_ray(&world,proxies,1,from,inf_to,mask,-1,&hit),"Inf destination rejected");

    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_trace_collect(NULL,proxies,1,from,to,mask,-1,hits,2),"collect NULL world rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_trace_collect(&world,NULL,1,from,to,mask,-1,hits,2),"collect NULL proxies with count>0 rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_trace_collect(&world,proxies,1,nan_from,to,mask,-1,hits,2),"collect NaN origin rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_trace_collect(&world,proxies,1,from,to,mask,-1,hits,-1),"collect negative capacity rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_trace_collect(&world,proxies,1,from,to,mask,-2,hits,2),"collect ignore_proxy below -1 rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2,r2d_world_trace_collect(&world,proxies,1,from,to,mask,-1,NULL,0),"collect NULL out returns count");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,r2d_world_trace_collect(&world,proxies,1,from,to,0,-1,hits,2),"empty mask matches nothing");

    r2d_world_free(&world);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_ray_world_and_proxy_order);
    RUN_TEST(test_nearest_proxy_wins);
    RUN_TEST(test_category_mask);
    RUN_TEST(test_ignore_proxy);
    RUN_TEST(test_collect_sorted_and_count);
    RUN_TEST(test_proxy_sweep);
    RUN_TEST(test_determinism_and_degenerate_rays);
    RUN_TEST(test_invalid_trace_inputs);
    return UNITY_END();
}
