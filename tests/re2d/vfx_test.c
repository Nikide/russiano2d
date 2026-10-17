#include "re2d_world_vfx.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static const char *BUNDLE_ALL =
    "{"
    "\"particles\":[{\"count\":3,\"life\":0.5,\"size\":2,\"endSize\":0,"
        "\"color\":\"#ff8000\",\"blend\":\"additive\",\"mode\":\"billboard\","
        "\"collision\":\"bounce\",\"bounce\":0.5,\"radius\":1,\"speed\":10,"
        "\"spread\":2,\"dirH\":0.25}],"
    "\"cards\":[{\"kind\":\"ring\",\"life\":0.5,\"size\":10,\"endSize\":20,"
        "\"alpha\":1,\"endAlpha\":0,\"color\":\"#ffd080\",\"blend\":\"additive\","
        "\"distortion\":\"shockwave\"}],"
    "\"trail\":{\"life\":0.4,\"width\":6,\"color\":\"#ffffff\",\"spacing\":0.02,"
        "\"speed\":20,\"blend\":\"additive\"},"
    "\"light\":{\"radius\":200,\"intensity\":2,\"color\":\"#ffb060\",\"life\":0.1,"
        "\"priority\":3,\"shadow\":false},"
    "\"decal\":{\"material\":0,\"width\":16,\"height\":16,\"life\":12},"
    "\"sound\":\"sfx/hit.ogg\",\"shake\":0.25,"
    "\"flash\":{\"color\":\"#fff0c0\",\"ms\":60}"
    "}";

static const char *BUNDLE_PARTICLES =
    "{\"particles\":[{\"count\":3,\"life\":0.5,\"size\":2,\"color\":\"#ffffff\"}]}";

static R2DWorldParticle storage[16];

typedef struct { float floor; float wall_x; } Query;

static bool test_support(void *user,float x,float y,float h,float *floor,float *ceiling)
{
    (void)x; (void)y; (void)h;
    Query *query = (Query *)user;
    *floor = query->floor;
    *ceiling = 100.0f;
    return true;
}

static bool test_blocked(void *user,float x,float y,float radius,float bottom,float top)
{
    (void)y; (void)radius; (void)bottom; (void)top;
    Query *query = (Query *)user;
    return x > query->wall_x;
}

static void init_pool(R2DWorldParticlePool *pool,int capacity)
{
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(pool,storage,capacity));
}

static R2DWorldParticle particle_at(float x,float y,float h,float vx,float vy,float vh)
{
    R2DWorldParticle p;
    memset(&p,0,sizeof p);
    p.x=x; p.y=y; p.h=h; p.vx=vx; p.vy=vy; p.vh=vh;
    p.max_life=2.0f; p.size=1.0f; p.alpha=1.0f; p.r=p.g=p.b=1.0f;
    p.active=true; p.world_space=true;
    return p;
}

static void test_init_and_info_defaults(void)
{
    R2DWorldVfx vfx;
    r2d_world_vfx_init(&vfx,NULL,99);
    R2DWorldVfxInfo info;
    r2d_world_vfx_info(&vfx,&info);
    TEST_ASSERT_EQUAL_INT(0, info.particles_alive);
    TEST_ASSERT_EQUAL_INT(0, info.cards);
    TEST_ASSERT_EQUAL_INT(0, info.trails);
    TEST_ASSERT_EQUAL_INT(0, info.temp_lights);
    TEST_ASSERT_EQUAL_INT(0, info.decals);
    TEST_ASSERT_EQUAL_INT(0, info.bundles);
    TEST_ASSERT_EQUAL_INT(R2D_WORLD_VFX_MAX_LIGHTS, info.light_budget);
    r2d_world_vfx_init(&vfx,NULL,-5);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_vfx_get_light_budget(&vfx));
}

static void test_define_parses_every_primitive(void)
{
    R2DWorldVfx vfx;
    r2d_world_vfx_init(&vfx,NULL,4);
    char error[192] = {0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_vfx_define(&vfx,"all",BUNDLE_ALL,error,sizeof error),error);
    TEST_ASSERT_TRUE(r2d_world_vfx_defined(&vfx,"all"));
    R2DWorldVfxInfo info;
    r2d_world_vfx_info(&vfx,&info);
    TEST_ASSERT_EQUAL_INT(1, info.bundles);
    TEST_ASSERT_FALSE(r2d_world_vfx_defined(&vfx,"missing"));
}

static void test_bad_bundle_json_is_rejected(void)
{
    R2DWorldVfx vfx;
    r2d_world_vfx_init(&vfx,NULL,4);
    char error[192] = {0};
    TEST_ASSERT_FALSE(r2d_world_vfx_define(&vfx,"bad","{",error,sizeof error));
    TEST_ASSERT_FALSE(r2d_world_vfx_define(&vfx,"bad","[]",error,sizeof error));
    TEST_ASSERT_FALSE(r2d_world_vfx_define(&vfx,"bad",
        "{\"particles\":{}}",error,sizeof error));
    TEST_ASSERT_FALSE(r2d_world_vfx_define(&vfx,"bad",
        "{\"particles\":[{\"life\":0}]}",error,sizeof error));
    TEST_ASSERT_FALSE(r2d_world_vfx_define(&vfx,"bad",
        "{\"cards\":[{\"kind\":\"nope\"}]}",error,sizeof error));
    TEST_ASSERT_FALSE(r2d_world_vfx_define(&vfx,"bad",
        "{\"particles\":[{\"count\":999999}]}",error,sizeof error));
    TEST_ASSERT_FALSE(r2d_world_vfx_define(&vfx,"bad",
        "{\"light\":{\"radius\":0}}",error,sizeof error));
    TEST_ASSERT_FALSE(r2d_world_vfx_defined(&vfx,"bad"));
}

static void test_spawn_emits_particles_and_cards(void)
{
    R2DWorldParticlePool pool;
    init_pool(&pool,16);
    R2DWorldVfx vfx;
    r2d_world_vfx_init(&vfx,&pool,4);
    char error[192];
    TEST_ASSERT_TRUE(r2d_world_vfx_define(&vfx,"all",BUNDLE_ALL,error,sizeof error));
    R2DWorldVfxSpawn spawned;
    const int total = r2d_world_vfx_spawn(&vfx,"all",10,20,30,0,0,-1,7,&spawned);
    TEST_ASSERT_TRUE(total > 0);
    TEST_ASSERT_EQUAL_INT(3, spawned.particles);
    TEST_ASSERT_EQUAL_INT(1, spawned.cards);
    TEST_ASSERT_EQUAL_INT(1, spawned.trails);
    TEST_ASSERT_EQUAL_INT(1, spawned.lights);
    TEST_ASSERT_EQUAL_INT(1, spawned.distortion);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 0.25f, spawned.shake);
    TEST_ASSERT_EQUAL_INT(60, spawned.flash_ms);
    TEST_ASSERT_TRUE(strcmp(spawned.sound,"sfx/hit.ogg") == 0);
    TEST_ASSERT_EQUAL_INT(3, r2d_world_particle_alive(&pool));

    R2DWorldVfxInfo info;
    r2d_world_vfx_info(&vfx,&info);
    TEST_ASSERT_EQUAL_INT(3, info.particles_alive);
    TEST_ASSERT_EQUAL_INT(1, info.cards);
    TEST_ASSERT_EQUAL_INT(1, info.trails);
    TEST_ASSERT_EQUAL_INT(1, info.temp_lights);
    TEST_ASSERT_EQUAL_INT(1, info.distortion_cards);
    TEST_ASSERT_EQUAL_INT(1, info.fx_spawns);
}

static void test_cards_step_curves_and_expire(void)
{
    R2DWorldVfx vfx;
    r2d_world_vfx_init(&vfx,NULL,4);
    char error[192];
    TEST_ASSERT_TRUE(r2d_world_vfx_define(&vfx,"all",BUNDLE_ALL,error,sizeof error));
    TEST_ASSERT_TRUE(r2d_world_vfx_spawn(&vfx,"all",0,0,0,0,0,0,1,NULL) > 0);
    R2DWorldVfxCard *card = &vfx.cards[0];
    TEST_ASSERT_EQUAL_INT(R2D_VFX_CARD_RING, card->kind);
    TEST_ASSERT_EQUAL_INT(R2D_VFX_DISTORTION_SHOCKWAVE, card->distortion);
    TEST_ASSERT_FLOAT_WITHIN(1e-6f, 10.0f, card->size);
    r2d_world_vfx_step(&vfx,0.25f);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 15.0f, card->size);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 0.5f, card->alpha);
    r2d_world_vfx_step(&vfx,0.25f);
    TEST_ASSERT_FALSE(card->active);
    R2DWorldVfxInfo info;
    r2d_world_vfx_info(&vfx,&info);
    TEST_ASSERT_EQUAL_INT(0, info.cards);
    TEST_ASSERT_EQUAL_INT(0, info.distortion_cards);
}

static void test_trail_step_records_points_and_expires(void)
{
    R2DWorldVfx vfx;
    r2d_world_vfx_init(&vfx,NULL,4);
    char error[192];
    TEST_ASSERT_TRUE(r2d_world_vfx_define(&vfx,"all",BUNDLE_ALL,error,sizeof error));
    TEST_ASSERT_TRUE(r2d_world_vfx_spawn(&vfx,"all",0,0,0,1,0,0,1,NULL) > 0);
    R2DWorldVfxTrail *trail = &vfx.trails[0];
    TEST_ASSERT_TRUE(trail->active);
    TEST_ASSERT_EQUAL_INT(1, trail->count);
    r2d_world_vfx_step(&vfx,0.05f);
    TEST_ASSERT_TRUE(trail->count >= 2);
    TEST_ASSERT_TRUE(trail->head_x > 0.0f);
    r2d_world_vfx_step(&vfx,0.25f);
    r2d_world_vfx_step(&vfx,0.25f);
    TEST_ASSERT_FALSE(trail->active);
    TEST_ASSERT_EQUAL_INT(0, trail->count);
}

static void test_light_budget_and_priority_stealing(void)
{
    R2DWorldVfx vfx;
    r2d_world_vfx_init(&vfx,NULL,1);
    char error[192];
    TEST_ASSERT_TRUE(r2d_world_vfx_define(&vfx,"low",
        "{\"light\":{\"radius\":100,\"intensity\":1,\"life\":1,\"priority\":1}}",
        error,sizeof error));
    TEST_ASSERT_TRUE(r2d_world_vfx_define(&vfx,"high",
        "{\"light\":{\"radius\":100,\"intensity\":1,\"life\":1,\"priority\":5}}",
        error,sizeof error));
    TEST_ASSERT_TRUE(r2d_world_vfx_spawn(&vfx,"low",0,0,0,0,0,0,1,NULL) > 0);
    R2DWorldVfxInfo info;
    r2d_world_vfx_info(&vfx,&info);
    TEST_ASSERT_EQUAL_INT(1, info.temp_lights);
    TEST_ASSERT_TRUE(r2d_world_vfx_spawn(&vfx,"high",0,0,0,0,0,0,1,NULL) >= 0);
    r2d_world_vfx_info(&vfx,&info);
    TEST_ASSERT_EQUAL_INT(1, info.temp_lights);
    TEST_ASSERT_EQUAL_INT(5, vfx.lights[0].priority);
    TEST_ASSERT_TRUE(r2d_world_vfx_spawn(&vfx,"low",0,0,0,0,0,0,1,NULL) >= 0);
    r2d_world_vfx_info(&vfx,&info);
    TEST_ASSERT_EQUAL_INT(5, vfx.lights[0].priority);
    TEST_ASSERT_EQUAL_INT(1, info.light_overflow);
    r2d_world_vfx_light_budget(&vfx,0);
    r2d_world_vfx_info(&vfx,&info);
    TEST_ASSERT_EQUAL_INT(0, info.temp_lights);
    TEST_ASSERT_EQUAL_INT(0, info.light_budget);
}

static void test_light_expiry_and_clear(void)
{
    R2DWorldVfx vfx;
    r2d_world_vfx_init(&vfx,NULL,4);
    char error[192];
    TEST_ASSERT_TRUE(r2d_world_vfx_define(&vfx,"all",BUNDLE_ALL,error,sizeof error));
    TEST_ASSERT_TRUE(r2d_world_vfx_spawn(&vfx,"all",0,0,0,0,0,0,1,NULL) > 0);
    r2d_world_vfx_step(&vfx,0.2f);
    R2DWorldVfxInfo info;
    r2d_world_vfx_info(&vfx,&info);
    TEST_ASSERT_EQUAL_INT(0, info.temp_lights);
    TEST_ASSERT_TRUE(r2d_world_vfx_spawn(&vfx,"all",0,0,0,0,0,0,1,NULL) > 0);
    r2d_world_vfx_clear(&vfx);
    r2d_world_vfx_info(&vfx,&info);
    TEST_ASSERT_EQUAL_INT(0, info.cards);
    TEST_ASSERT_EQUAL_INT(0, info.trails);
    TEST_ASSERT_EQUAL_INT(0, info.temp_lights);
    TEST_ASSERT_EQUAL_INT(1, info.bundles);
}

static void test_particle_collision_modes(void)
{
    R2DWorldParticlePool pool;
    init_pool(&pool,4);
    R2DWorldParticleCollision collision;
    collision.support = NULL;
    collision.blocked = NULL;
    collision.user = NULL;

    R2DWorldParticle floor = particle_at(0,0,0.5f,0,0,-5);
    floor.collision = R2D_PARTICLE_COLLIDE_FLOOR;
    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool,&floor,1,0,0,0,0,0));

    Query query = { 0.0f, 100.0f };
    collision.support = test_support;
    collision.blocked = test_blocked;
    collision.user = &query;
    r2d_world_particle_step_collide(&pool,0.1f,&collision);
    R2DWorldParticle *p = &pool.items[0];
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 0.0f, p->h);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 0.0f, p->vh);

    r2d_world_particle_clear(&pool);
    R2DWorldParticle bounce = particle_at(0,0,0.1f,0,0,-10);
    bounce.collision = R2D_PARTICLE_COLLIDE_BOUNCE;
    bounce.bounce = 0.5f;
    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool,&bounce,1,0,0,0,0,0));
    r2d_world_particle_step_collide(&pool,0.1f,&collision);
    p = &pool.items[0];
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 0.0f, p->h);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 5.0f, p->vh);

    r2d_world_particle_clear(&pool);
    R2DWorldParticle wall = particle_at(0.9f,0,0,10,0,0);
    wall.collision = R2D_PARTICLE_COLLIDE_WALL;
    wall.radius = 0.25f;
    query.wall_x = 1.0f;
    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool,&wall,1,0,0,0,0,0));
    r2d_world_particle_step_collide(&pool,0.1f,&collision);
    p = &pool.items[0];
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 0.9f, p->x);
    TEST_ASSERT_FLOAT_WITHIN(1e-5f, 0.0f, p->vx);

    r2d_world_particle_clear(&pool);
    R2DWorldParticle despawn = particle_at(0,0,0.1f,0,0,-10);
    despawn.collision = R2D_PARTICLE_COLLIDE_DESPAWN;
    TEST_ASSERT_EQUAL_INT(1, r2d_world_particle_emit_burst(&pool,&despawn,1,0,0,0,0,0));
    r2d_world_particle_step_collide(&pool,0.1f,&collision);
    TEST_ASSERT_EQUAL_INT(0, r2d_world_particle_alive(&pool));
}

static void test_spawn_determinism(void)
{
    R2DWorldParticle storage_a[16],storage_b[16];
    R2DWorldParticlePool pool_a,pool_b;
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool_a,storage_a,16));
    TEST_ASSERT_TRUE(r2d_world_particle_pool_init(&pool_b,storage_b,16));
    R2DWorldVfx a,b;
    r2d_world_vfx_init(&a,&pool_a,4);
    r2d_world_vfx_init(&b,&pool_b,4);
    char error[192];
    TEST_ASSERT_TRUE(r2d_world_vfx_define(&a,"all",BUNDLE_ALL,error,sizeof error));
    TEST_ASSERT_TRUE(r2d_world_vfx_define(&b,"all",BUNDLE_ALL,error,sizeof error));
    for (int i = 0; i < 1000; i++) {
        const float x = (float)(i % 37);
        const float y = (float)(i % 19);
        const int sa = r2d_world_vfx_spawn(&a,"all",x,y,0,0.5f,-0.25f,0.1f,(uint32_t)i,NULL);
        const int sb = r2d_world_vfx_spawn(&b,"all",x,y,0,0.5f,-0.25f,0.1f,(uint32_t)i,NULL);
        TEST_ASSERT_EQUAL_INT(sa,sb);
        if (i % 7 == 0) { r2d_world_vfx_step(&a,0.05f); r2d_world_vfx_step(&b,0.05f); }
        if (i % 13 == 0) { r2d_world_vfx_clear(&a); r2d_world_vfx_clear(&b); }
    }
    R2DWorldVfxInfo ia,ib;
    r2d_world_vfx_info(&a,&ia);
    r2d_world_vfx_info(&b,&ib);
    TEST_ASSERT_EQUAL_INT(ia.particles_alive,ib.particles_alive);
    TEST_ASSERT_EQUAL_INT(ia.cards,ib.cards);
    TEST_ASSERT_EQUAL_INT(ia.trails,ib.trails);
    TEST_ASSERT_EQUAL_INT(ia.temp_lights,ib.temp_lights);
    TEST_ASSERT_EQUAL_INT(ia.fx_spawns,ib.fx_spawns);
    TEST_ASSERT_EQUAL_INT(ia.particles_spawned,ib.particles_spawned);
}

static void test_spawn_rejects_invalid_input(void)
{
    R2DWorldVfx vfx;
    r2d_world_vfx_init(&vfx,NULL,4);
    char error[192];
    TEST_ASSERT_TRUE(r2d_world_vfx_define(&vfx,"p",BUNDLE_PARTICLES,error,sizeof error));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_vfx_spawn(NULL,"p",0,0,0,0,0,0,0,NULL));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_vfx_spawn(&vfx,NULL,0,0,0,0,0,0,0,NULL));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_vfx_spawn(&vfx,"missing",0,0,0,0,0,0,0,NULL));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_vfx_spawn(&vfx,"p",NAN,0,0,0,0,0,0,NULL));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_vfx_spawn(&vfx,"p",0,0,0,0,0,INFINITY,0,NULL));
    R2DWorldVfxInfo info;
    r2d_world_vfx_info(&vfx,&info);
    TEST_ASSERT_EQUAL_INT(0, info.fx_spawns);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_init_and_info_defaults);
    RUN_TEST(test_define_parses_every_primitive);
    RUN_TEST(test_bad_bundle_json_is_rejected);
    RUN_TEST(test_spawn_emits_particles_and_cards);
    RUN_TEST(test_cards_step_curves_and_expire);
    RUN_TEST(test_trail_step_records_points_and_expires);
    RUN_TEST(test_light_budget_and_priority_stealing);
    RUN_TEST(test_light_expiry_and_clear);
    RUN_TEST(test_particle_collision_modes);
    RUN_TEST(test_spawn_determinism);
    RUN_TEST(test_spawn_rejects_invalid_input);
    return UNITY_END();
}
