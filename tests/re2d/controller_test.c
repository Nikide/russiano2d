#include "re2d_world.h"
#include "re2d_world_controller.h"
#include "unity.h"

#include <math.h>
#include <stdint.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static R2DWorldControllerConfig make_config(void)
{
    R2DWorldControllerConfig c={0};
    c.radius=10.0f;
    c.height=60.0f;
    c.eye=50.0f;
    c.step=8.0f;
    c.slope_limit=60.0f;
    c.gravity=800.0f;
    c.jump_speed=300.0f;
    c.max_ground=200.0f;
    c.max_air=150.0f;
    c.accel=3000.0f;
    c.friction=10.0f;
    c.air_control=0.5f;
    return c;
}

static R2DWorldSpan make_span(float x,float y,float w,float h,float bottom,float top)
{
    R2DWorldSpan s={0};
    s.x=x;s.y=y;s.w=w;s.h=h;s.bottom=bottom;s.top=top;
    s.floor_color=0xff00ff00;s.ceiling_color=0xff888888;
    return s;
}

static R2DWorldWall make_wall(float x1,float y1,float x2,float y2,float bottom,float top)
{
    R2DWorldWall w={x1,y1,x2,y2,bottom,top,0xff0000ff};
    return w;
}

static bool same_state(const R2DWorldControllerState *a,const R2DWorldControllerState *b)
{
    return a->x==b->x&&a->y==b->y&&a->feet==b->feet&&
        a->vx==b->vx&&a->vy==b->vy&&a->vz==b->vz&&
        a->span==b->span&&a->ceiling==b->ceiling&&a->grounded==b->grounded;
}

static bool state_finite(const R2DWorldControllerState *s)
{
    return isfinite(s->x)&&isfinite(s->y)&&isfinite(s->feet)&&
        isfinite(s->vx)&&isfinite(s->vy)&&isfinite(s->vz)&&isfinite(s->ceiling);
}

static void start_at(R2DWorldControllerState *s,float x,float y,float feet)
{
    memset(s,0,sizeof *s);
    s->x=x;s->y=y;s->feet=feet;s->span=-1;
    s->ceiling=INFINITY;
}

// One 200x400 room with a full-height vertical wall at x=100.
static void build_wall_world(R2DRe2dWorld *world)
{
    R2DWorldSpan span=make_span(0,-100,200,400,0,100);
    R2DWorldWall wall=make_wall(100,-100,100,300,0,100);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build(world,&wall,1,&span,1),"wall fixture builds");
}

static void test_straight_wall_stops_motion(void)
{
    R2DRe2dWorld world={0};
    build_wall_world(&world);
    R2DWorldControllerConfig cfg=make_config();
    R2DWorldControllerState start,s;
    start_at(&start,20,0,0);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"init at support");
    for(int i=0;i<240;i++)r2d_world_controller_move(&world,&cfg,&s,1,0,false,1.0f/60.0f);
    TEST_ASSERT_TRUE_MESSAGE(s.x>20.0f,"body moved forward");
    TEST_ASSERT_TRUE_MESSAGE(s.x<=100.0f-cfg.radius+0.05f,"wall stops the body");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_blocked(&world,s.x,s.y,cfg.radius,s.feet,s.feet+cfg.height),
                              "final body does not penetrate the wall");
    TEST_ASSERT_TRUE_MESSAGE(s.grounded,"body stays grounded");
    r2d_world_free(&world);
}

static void test_wall_slide_keeps_tangential_motion(void)
{
    R2DRe2dWorld world={0};
    build_wall_world(&world);
    R2DWorldControllerConfig cfg=make_config();
    R2DWorldControllerState start,s;
    start_at(&start,20,0,0);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"init at support");
    for(int i=0;i<60;i++)r2d_world_controller_move(&world,&cfg,&s,1,1,false,1.0f/60.0f);
    TEST_ASSERT_TRUE_MESSAGE(s.x<=100.0f-cfg.radius+0.05f,"normal component is stopped");
    TEST_ASSERT_TRUE_MESSAGE(s.y>50.0f,"tangential motion continues along the wall");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_blocked(&world,s.x,s.y,cfg.radius,s.feet,s.feet+cfg.height),
                              "sliding body stays outside the wall");
    r2d_world_free(&world);
}

static void test_corner_does_not_squeeze_through(void)
{
    R2DRe2dWorld world={0};
    R2DWorldSpan span=make_span(0,0,200,200,0,100);
    R2DWorldWall walls[]={
        make_wall(100,0,100,100,0,100),
        make_wall(0,100,100,100,0,100)
    };
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build(&world,walls,2,&span,1),"corner fixture builds");
    R2DWorldControllerConfig cfg=make_config();
    R2DWorldControllerState start,s;
    start_at(&start,50,50,0);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"init at support");
    for(int i=0;i<120;i++)r2d_world_controller_move(&world,&cfg,&s,1,1,false,1.0f/60.0f);
    TEST_ASSERT_TRUE_MESSAGE(s.x<=100.0f-cfg.radius+0.05f,"corner stops the X component");
    TEST_ASSERT_TRUE_MESSAGE(s.y<=100.0f-cfg.radius+0.05f,"corner stops the Y component");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_blocked(&world,s.x,s.y,cfg.radius,s.feet,s.feet+cfg.height),
                              "body cannot squeeze through the corner");
    r2d_world_free(&world);
}

static void test_doorway_wider_than_body_passes(void)
{
    R2DRe2dWorld world={0};
    R2DWorldSpan span=make_span(0,0,200,200,0,100);
    R2DWorldWall walls[]={
        make_wall(100,0,100,80,0,100),
        make_wall(100,120,100,200,0,100)
    };
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build(&world,walls,2,&span,1),"doorway fixture builds");
    TEST_ASSERT_TRUE_MESSAGE(120.0f-80.0f>2.0f*make_config().radius,"doorway is wider than the body");
    R2DWorldControllerConfig cfg=make_config();
    R2DWorldControllerState start,s;
    start_at(&start,20,100,0);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"init at support");
    for(int i=0;i<40;i++)r2d_world_controller_move(&world,&cfg,&s,1,0,false,1.0f/60.0f);
    TEST_ASSERT_TRUE_MESSAGE(s.x>110.0f,"body passes through the doorway");
    TEST_ASSERT_TRUE_MESSAGE(s.grounded,"body remains grounded after the doorway");
    r2d_world_free(&world);
}

static void test_step_exact_limit_climbs(void)
{
    R2DRe2dWorld world={0};
    R2DWorldSpan spans[]={
        make_span(0,0,100,200,0,100),
        make_span(100,0,100,200,18,100)
    };
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build(&world,NULL,0,spans,2),"exact step fixture builds");
    R2DWorldControllerConfig cfg=make_config();
    cfg.max_ground=120.0f;
    cfg.step=18.0f;
    R2DWorldControllerState start,s;
    start_at(&start,50,100,0);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"init at support");
    for(int i=0;i<60;i++)r2d_world_controller_move(&world,&cfg,&s,1,0,false,1.0f/60.0f);
    TEST_ASSERT_TRUE_MESSAGE(s.x>105.0f,"body crossed the step edge");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(0.01f,18.0f,s.feet,"exact step up was climbed");
    TEST_ASSERT_TRUE_MESSAGE(s.grounded,"body remains grounded on the upper floor");
    r2d_world_free(&world);
}

static void test_step_plus_epsilon_blocks(void)
{
    R2DRe2dWorld world={0};
    R2DWorldSpan spans[]={
        make_span(0,0,100,200,0,100),
        make_span(100,0,100,200,18.01f,100)
    };
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build(&world,NULL,0,spans,2),"over-limit step fixture builds");
    R2DWorldControllerConfig cfg=make_config();
    cfg.max_ground=120.0f;
    cfg.step=18.0f;
    R2DWorldControllerState start,s;
    start_at(&start,50,100,0);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"init at support");
    for(int i=0;i<60;i++)r2d_world_controller_move(&world,&cfg,&s,1,0,false,1.0f/60.0f);
    TEST_ASSERT_TRUE_MESSAGE(s.x<=100.0f+0.001f,"step above the limit blocks the X move");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(0.01f,0.0f,s.feet,"body did not climb the over-limit step");
    TEST_ASSERT_TRUE_MESSAGE(s.grounded,"body stays grounded on the lower floor");
    r2d_world_free(&world);
}

static void test_ceiling_blocks_jump(void)
{
    R2DRe2dWorld world={0};
    R2DWorldSpan span=make_span(0,0,100,100,0,80);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build(&world,NULL,0,&span,1),"ceiling fixture builds");
    R2DWorldControllerConfig cfg=make_config();
    cfg.height=60.0f;
    cfg.jump_speed=400.0f;
    R2DWorldControllerState start,s;
    start_at(&start,50,50,0);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"init at support");
    float max_feet=0.0f;
    for(int i=0;i<90;i++) {
        r2d_world_controller_move(&world,&cfg,&s,0,0,i==0,1.0f/60.0f);
        TEST_ASSERT_TRUE_MESSAGE(s.feet+cfg.height<=s.ceiling+1e-3f,"body stays under the ceiling");
        TEST_ASSERT_TRUE_MESSAGE(s.feet+cfg.height<=80.0f+1e-3f,"body stays under span top");
        if(s.feet>max_feet)max_feet=s.feet;
    }
    TEST_ASSERT_TRUE_MESSAGE(max_feet>5.0f,"jump did rise before the ceiling stopped it");
    TEST_ASSERT_TRUE_MESSAGE(max_feet<=20.0f+1e-3f,"ceiling capped the jump height");
    TEST_ASSERT_TRUE_MESSAGE(s.grounded,"body returned to the floor");
    r2d_world_free(&world);
}

static void test_slope_up_and_down_follows_floor(void)
{
    R2DRe2dWorld world={0};
    R2DWorldSpan span={0,0,200,200,0,120,0xff00ff00,0xff888888,0.5f,0,0,0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build(&world,NULL,0,&span,1),"slope fixture builds");
    R2DWorldControllerConfig cfg=make_config();
    cfg.max_ground=120.0f;
    cfg.slope_limit=60.0f;
    R2DWorldControllerState start,s;
    start_at(&start,20,100,10);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"init on slope");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(0.01f,10.0f,s.feet,"init snapped feet to slope support");
    float mid_x=s.x;
    for(int i=0;i<30;i++) {
        r2d_world_controller_move(&world,&cfg,&s,1,0,false,1.0f/60.0f);
        float floor=r2d_world_floor_height(&world.spans[0],s.x,s.y);
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(0.02f,floor,s.feet,"feet follow the rising floor");
        TEST_ASSERT_TRUE_MESSAGE(s.grounded,"grounded while walking up the slope");
    }
    TEST_ASSERT_TRUE_MESSAGE(s.x>mid_x+20.0f,"body walked up the slope");
    mid_x=s.x;
    for(int i=0;i<30;i++) {
        r2d_world_controller_move(&world,&cfg,&s,-1,0,false,1.0f/60.0f);
        float floor=r2d_world_floor_height(&world.spans[0],s.x,s.y);
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(0.02f,floor,s.feet,"feet follow the falling floor");
        TEST_ASSERT_TRUE_MESSAGE(s.grounded,"grounded while walking down the slope");
    }
    TEST_ASSERT_TRUE_MESSAGE(s.x<mid_x-20.0f,"body walked down the slope");
    r2d_world_free(&world);
}

static void test_falling_lands_on_floor(void)
{
    R2DRe2dWorld world={0};
    R2DWorldSpan span=make_span(0,0,100,100,0,100);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build(&world,NULL,0,&span,1),"falling fixture builds");
    R2DWorldControllerConfig cfg=make_config();
    R2DWorldControllerState start,s;
    start_at(&start,50,50,40);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"init above the floor");
    TEST_ASSERT_FALSE_MESSAGE(s.grounded,"starting above the floor is airborne");
    r2d_world_controller_move(&world,&cfg,&s,0,0,false,1.0f/60.0f);
    TEST_ASSERT_TRUE_MESSAGE(s.feet<40.0f,"gravity lowers the feet");
    int ticks=1;
    while(!s.grounded&&ticks<120){r2d_world_controller_move(&world,&cfg,&s,0,0,false,1.0f/60.0f);ticks++;}
    TEST_ASSERT_TRUE_MESSAGE(s.grounded,"body eventually lands");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(0.01f,0.0f,s.feet,"feet rest on the support");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,s.span,"landing resolves the ground span");
    r2d_world_free(&world);
}

static void test_jump_leaves_and_returns_to_ground(void)
{
    R2DRe2dWorld world={0};
    R2DWorldSpan span=make_span(0,0,100,100,0,100);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build(&world,NULL,0,&span,1),"jump fixture builds");
    R2DWorldControllerConfig cfg=make_config();
    R2DWorldControllerState start,s;
    start_at(&start,50,50,0);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"init at support");
    TEST_ASSERT_TRUE_MESSAGE(s.grounded,"starts grounded");
    r2d_world_controller_move(&world,&cfg,&s,0,0,true,1.0f/60.0f);
    TEST_ASSERT_FALSE_MESSAGE(s.grounded,"jump leaves the ground");
    TEST_ASSERT_TRUE_MESSAGE(s.feet>0.5f,"jump raises the feet");
    TEST_ASSERT_TRUE_MESSAGE(s.vz>0.0f,"upward velocity after the jump");
    int ticks=1;
    while(!s.grounded&&ticks<200){r2d_world_controller_move(&world,&cfg,&s,0,0,false,1.0f/60.0f);ticks++;}
    TEST_ASSERT_TRUE_MESSAGE(ticks<200,"body returns to the ground within a bounded number of ticks");
    TEST_ASSERT_TRUE_MESSAGE(s.grounded,"landed after the jump");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(0.01f,0.0f,s.feet,"jump lands back on the same floor");
    r2d_world_free(&world);
}

static void test_open_portal_transitions_and_closed_portal_blocks(void)
{
    R2DRe2dWorld world={0};
    R2DWorldSpan spans[]={
        make_span(0,0,100,100,0,100),
        make_span(100,0,100,100,0,100)
    };
    R2DWorldCell cells[]={{0,0,100,100,0,1},{100,0,100,100,1,1}};
    R2DWorldOpening opening={0,100};
    R2DWorldPortal portal={0,1,0,1,100,0,100,100,false};
    char err[256];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build_cells(&world,NULL,0,spans,2,cells,2,&portal,1,&opening,1,err,sizeof err),
                             "two-cell portal fixture builds");
    R2DWorldControllerConfig cfg=make_config();
    R2DWorldControllerState start,s;
    start_at(&start,50,50,0);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"init on source span");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,s.span,"starts on the source span");
    for(int i=0;i<40;i++)r2d_world_controller_move(&world,&cfg,&s,1,0,false,1.0f/60.0f);
    TEST_ASSERT_TRUE_MESSAGE(s.x>115.0f,"open portal is traversed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,s.span,"body lands on the destination span support");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(0.01f,0.0f,s.feet,"destination floor supports the body");
    TEST_ASSERT_TRUE_MESSAGE(s.grounded,"grounded after the portal");

    TEST_ASSERT_TRUE_MESSAGE(r2d_world_portal_set_closed(&world,0,true),"portal closes");
    start_at(&start,50,50,0);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"re-init on source span");
    for(int i=0;i<60;i++)r2d_world_controller_move(&world,&cfg,&s,1,0,false,1.0f/60.0f);
    TEST_ASSERT_TRUE_MESSAGE(s.x<100.0f-cfg.radius+0.05f,"closed portal behaves like a wall");
    TEST_ASSERT_TRUE_MESSAGE(s.x>50.0f,"body still moved toward the closed portal");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,s.span,"closed portal body stays on source span");
    r2d_world_free(&world);
}

static void test_large_dt_does_not_tunnel(void)
{
    R2DRe2dWorld world={0};
    build_wall_world(&world);
    R2DWorldControllerConfig cfg=make_config();
    cfg.max_ground=400.0f;
    R2DWorldControllerState start,s;
    start_at(&start,20,0,0);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"init at support");
    for(int i=0;i<8;i++) {
        r2d_world_controller_move(&world,&cfg,&s,1,0,false,0.25f);
        TEST_ASSERT_TRUE_MESSAGE(s.x<=100.0f-cfg.radius+0.05f,"large dt substeps do not tunnel");
        TEST_ASSERT_TRUE_MESSAGE(state_finite(&s)&&s.grounded,"state remains finite and grounded");
    }
    TEST_ASSERT_TRUE_MESSAGE(s.x>50.0f,"body still advances with large dt");
    r2d_world_free(&world);
}

static void script_input(int tick,float *wish_x,float *wish_y,bool *jump)
{
    int phase=tick%240;
    if(phase<60){*wish_x=1.0f;*wish_y=0.0f;}
    else if(phase<120){*wish_x=0.0f;*wish_y=1.0f;}
    else if(phase<180){*wish_x=-1.0f;*wish_y=0.0f;}
    else {*wish_x=0.0f;*wish_y=-1.0f;}
    *jump=(tick%300==0);
}

static void mix_bits(uint64_t *hash,const void *data,size_t size)
{
    const unsigned char *bytes=(const unsigned char *)data;
    for(size_t i=0;i<size;i++)*hash=(*hash^bytes[i])*1099511628211ULL;
}

static void test_determinism_10k_ticks(void)
{
    R2DRe2dWorld world={0};
    R2DWorldSpan span=make_span(-300,-300,800,1000,0,120);
    R2DWorldWall wall=make_wall(150,-300,150,700,0,120);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build(&world,&wall,1,&span,1),"determinism fixture builds");
    R2DWorldControllerConfig cfg=make_config();
    R2DWorldControllerState start,a,b;
    start_at(&start,30,100,0);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&a),"first run init");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&b),"second run init");
    uint64_t hash_a=1469598103934665603ULL,hash_b=hash_a;
    for(int tick=0;tick<10000;tick++) {
        float wish_x,wish_y;bool jump;
        script_input(tick,&wish_x,&wish_y,&jump);
        r2d_world_controller_move(&world,&cfg,&a,wish_x,wish_y,jump,1.0f/60.0f);
        r2d_world_controller_move(&world,&cfg,&b,wish_x,wish_y,jump,1.0f/60.0f);
        mix_bits(&hash_a,&a.x,sizeof a.x);mix_bits(&hash_a,&a.y,sizeof a.y);mix_bits(&hash_a,&a.feet,sizeof a.feet);
        mix_bits(&hash_a,&a.vx,sizeof a.vx);mix_bits(&hash_a,&a.vy,sizeof a.vy);mix_bits(&hash_a,&a.vz,sizeof a.vz);
        mix_bits(&hash_b,&b.x,sizeof b.x);mix_bits(&hash_b,&b.y,sizeof b.y);mix_bits(&hash_b,&b.feet,sizeof b.feet);
        mix_bits(&hash_b,&b.vx,sizeof b.vx);mix_bits(&hash_b,&b.vy,sizeof b.vy);mix_bits(&hash_b,&b.vz,sizeof b.vz);
    }
    TEST_ASSERT_TRUE_MESSAGE(state_finite(&a),"final state is finite");
    TEST_ASSERT_TRUE_MESSAGE(state_finite(&b),"second final state is finite");
    TEST_ASSERT_TRUE_MESSAGE(same_state(&a,&b),"10k fixed input ticks are bit-identical");
    TEST_ASSERT_TRUE_MESSAGE(hash_a==hash_b,"per-tick checksums are identical");
    r2d_world_free(&world);
}

static void test_invalid_input_leaves_state_unchanged(void)
{
    R2DRe2dWorld world={0};
    R2DWorldSpan span=make_span(0,0,100,100,0,100);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_build(&world,NULL,0,&span,1),"invalid-input fixture builds");
    R2DWorldControllerConfig cfg=make_config();
    R2DWorldControllerState start,s,before;
    start_at(&start,50,50,0);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_controller_init(&world,&cfg,&start,&s),"init at support");
    r2d_world_controller_move(&world,&cfg,&s,1,0,false,1.0f/60.0f);
    before=s;
    r2d_world_controller_move(&world,&cfg,&s,1,0,false,0.6f);
    TEST_ASSERT_TRUE_MESSAGE(same_state(&s,&before),"dt above 0.5 leaves state unchanged");
    r2d_world_controller_move(&world,&cfg,&s,1,0,false,-0.1f);
    TEST_ASSERT_TRUE_MESSAGE(same_state(&s,&before),"negative dt leaves state unchanged");
    r2d_world_controller_move(&world,&cfg,&s,1,0,false,NAN);
    TEST_ASSERT_TRUE_MESSAGE(same_state(&s,&before),"NaN dt leaves state unchanged");
    r2d_world_controller_move(&world,&cfg,&s,NAN,0,false,1.0f/60.0f);
    TEST_ASSERT_TRUE_MESSAGE(same_state(&s,&before),"NaN wish leaves state unchanged");
    R2DWorldControllerConfig bad=cfg;
    bad.radius=0.0f;
    r2d_world_controller_move(&world,&bad,&s,1,0,false,1.0f/60.0f);
    TEST_ASSERT_TRUE_MESSAGE(same_state(&s,&before),"invalid config leaves state unchanged");
    r2d_world_controller_move(&world,NULL,&s,1,0,false,1.0f/60.0f);
    TEST_ASSERT_TRUE_MESSAGE(same_state(&s,&before),"NULL config leaves state unchanged");

    R2DWorldControllerState outside_out;
    start_at(&outside_out,-7,-7,-7);
    R2DWorldControllerState no_support;
    start_at(&no_support,500,500,0);
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_controller_init(&world,&cfg,&no_support,&outside_out),
                              "init outside any support fails");
    TEST_ASSERT_TRUE_MESSAGE(outside_out.x==-7&&outside_out.y==-7&&outside_out.feet==-7,
                             "failed init leaves the output untouched");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_controller_init(NULL,&cfg,&start,&outside_out),"NULL world init rejected");
    r2d_world_free(&world);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_straight_wall_stops_motion);
    RUN_TEST(test_wall_slide_keeps_tangential_motion);
    RUN_TEST(test_corner_does_not_squeeze_through);
    RUN_TEST(test_doorway_wider_than_body_passes);
    RUN_TEST(test_step_exact_limit_climbs);
    RUN_TEST(test_step_plus_epsilon_blocks);
    RUN_TEST(test_ceiling_blocks_jump);
    RUN_TEST(test_slope_up_and_down_follows_floor);
    RUN_TEST(test_falling_lands_on_floor);
    RUN_TEST(test_jump_leaves_and_returns_to_ground);
    RUN_TEST(test_open_portal_transitions_and_closed_portal_blocks);
    RUN_TEST(test_large_dt_does_not_tunnel);
    RUN_TEST(test_determinism_10k_ticks);
    RUN_TEST(test_invalid_input_leaves_state_unchanged);
    return UNITY_END();
}
