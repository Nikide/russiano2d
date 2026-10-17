#include "json.h"
#include "re2d_world_metadata.h"
#include "unity.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define EPS 1e-6f

static bool parse_text(const char *text,R2DWorldMetadata *out,char *error,size_t size)
{
    R2dJson *root=r2d_json_parse(text,error,size);
    if(!root) return false;
    bool ok=r2d_world_metadata_parse(root,out,error,size);
    r2d_json_free(root);
    return ok;
}

static bool same_string(const char *a,const char *b)
{
    if(!a||!b) return a==b;
    return strcmp(a,b)==0;
}

static bool same_metadata(const R2DWorldMetadata *a,const R2DWorldMetadata *b)
{
    if(!same_string(a->id,b->id)||!same_string(a->title,b->title)||!same_string(a->author,b->author)||
       !same_string(a->version,b->version)||!same_string(a->music,b->music)||!same_string(a->sky,b->sky)||
       !same_string(a->next_map,b->next_map)||!same_string(a->secret_exit,b->secret_exit)||
       !same_string(a->environment,b->environment)||!same_string(a->default_fog_color,b->default_fog_color))
        return false;
    if(a->default_fog_density!=b->default_fog_density||a->default_fog_start!=b->default_fog_start) return false;
    if(a->spawn_count!=b->spawn_count) return false;
    for(int i=0;i<a->spawn_count;i++) {
        const R2DWorldSpawn *x=&a->spawns[i],*y=&b->spawns[i];
        if(!same_string(x->id,y->id)||!same_string(x->tag,y->tag)) return false;
        if(x->type!=y->type||x->x!=y->x||x->y!=y->y||x->h!=y->h||x->facing!=y->facing) return false;
    }
    return true;
}

static const char *FULL_JSON =
    "{"
    "\"meta\":{"
    "\"id\":\"e1m1\",\"title\":\"Test Room\",\"author\":\"Re2D\",\"version\":\"1.2.3\","
    "\"music\":\"music/test.ogg\",\"sky\":\"sky/dawn\",\"nextMap\":\"e1m2\","
    "\"secretExit\":\"e1s1\",\"environment\":\"tech\",\"defaultFogColor\":\"#336699\","
    "\"defaultFogDensity\":0.25,\"defaultFogStart\":64,"
    "\"spawns\":["
    "{\"id\":\"player.start\",\"type\":\"player\",\"x\":100.5,\"y\":200,\"h\":16,\"facing\":1.5,\"tag\":\"start\"},"
    "{\"id\":\"enemy.one\",\"type\":\"enemy\",\"x\":300,\"y\":-40.25,\"h\":0,\"facing\":-3.14,\"tag\":\"grunt\"},"
    "{\"id\":\"boss.core\",\"type\":4,\"x\":500,\"y\":500}"
    "]"
    "}"
    "}";

static void test_full_round_trip(void)
{
    R2DWorldMetadata meta={0};
    char error[256];
    TEST_ASSERT_TRUE_MESSAGE(parse_text(FULL_JSON,&meta,error,sizeof error),"full metadata parses");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("e1m1",meta.id,"map id");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("Test Room",meta.title,"title");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("Re2D",meta.author,"author");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("1.2.3",meta.version,"version");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("music/test.ogg",meta.music,"music");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("sky/dawn",meta.sky,"sky");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("e1m2",meta.next_map,"next map");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("e1s1",meta.secret_exit,"secret exit");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("tech",meta.environment,"environment");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("#336699",meta.default_fog_color,"fog color");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.25f,meta.default_fog_density,"fog density");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,64.0f,meta.default_fog_start,"fog start");

    TEST_ASSERT_EQUAL_INT_MESSAGE(3,meta.spawn_count,"spawn count");
    const R2DWorldSpawn *player=&meta.spawns[0];
    TEST_ASSERT_EQUAL_STRING_MESSAGE("player.start",player->id,"spawn id");
    TEST_ASSERT_EQUAL_INT_MESSAGE(PLAYER,player->type,"player type");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,100.5f,player->x,"spawn x");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,200.0f,player->y,"spawn y");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,16.0f,player->h,"spawn h");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,1.5f,player->facing,"spawn facing");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("start",player->tag,"spawn tag");
    TEST_ASSERT_EQUAL_INT_MESSAGE(ENEMY,meta.spawns[1].type,"enemy type");
    TEST_ASSERT_EQUAL_INT_MESSAGE(EFFECT,meta.spawns[2].type,"numeric spawn type");
    TEST_ASSERT_NULL_MESSAGE(meta.spawns[2].tag,"absent tag stays NULL");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,meta.spawns[2].h,"absent h defaults to zero");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,meta.spawns[2].facing,"absent facing defaults to zero");

    // Round trip: a second parse of identical text yields identical values.
    R2DWorldMetadata again={0};
    TEST_ASSERT_TRUE_MESSAGE(parse_text(FULL_JSON,&again,error,sizeof error),"full metadata reparses");
    TEST_ASSERT_TRUE_MESSAGE(same_metadata(&meta,&again),"metadata round trip is identical");

    r2d_world_metadata_free(&meta);
    r2d_world_metadata_free(&again);
    TEST_ASSERT_NULL_MESSAGE(meta.id,"free clears map id");
    TEST_ASSERT_NULL_MESSAGE(meta.spawns,"free clears spawn array");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,meta.spawn_count,"free clears spawn count");
}

static void test_defaults_and_aliases(void)
{
    R2DWorldMetadata meta={0};
    char error[256];

    TEST_ASSERT_TRUE_MESSAGE(parse_text("{}",&meta,error,sizeof error),"empty document parses");
    TEST_ASSERT_NULL_MESSAGE(meta.id,"no metadata id default");
    TEST_ASSERT_NULL_MESSAGE(meta.title,"no metadata title default");
    TEST_ASSERT_NULL_MESSAGE(meta.spawns,"no spawns default");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,meta.spawn_count,"no spawn count default");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,meta.default_fog_density,"default fog density");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,meta.default_fog_start,"default fog start");
    r2d_world_metadata_free(&meta);

    TEST_ASSERT_TRUE_MESSAGE(parse_text("{\"meta\":{}}",&meta,error,sizeof error),"empty meta object parses");
    TEST_ASSERT_NULL_MESSAGE(meta.author,"empty meta author");
    r2d_world_metadata_free(&meta);

    // "metadata" object, snake_case aliases, root-level spawns and cutscene alias.
    TEST_ASSERT_TRUE_MESSAGE(parse_text(
        "{\"metadata\":{\"next_map\":\"e2\",\"secret_exit\":\"e9\",\"default_fog_color\":\"#112233\","
        "\"default_fog_density\":0.5,\"default_fog_start\":32},"
        "\"spawns\":[{\"id\":\"cam\",\"type\":\"cutscene\",\"x\":1,\"y\":2}]}",
        &meta,error,sizeof error),"aliases and root spawns parse");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("e2",meta.next_map,"snake_case next map alias");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("e9",meta.secret_exit,"snake_case secret exit alias");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("#112233",meta.default_fog_color,"snake_case fog color alias");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.5f,meta.default_fog_density,"snake_case fog density alias");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,32.0f,meta.default_fog_start,"snake_case fog start alias");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,meta.spawn_count,"root-level spawns count");
    TEST_ASSERT_EQUAL_INT_MESSAGE(CAMERA,meta.spawns[0].type,"cutscene maps to camera");
    r2d_world_metadata_free(&meta);
}

static void test_spawn_type_mapping(void)
{
    TEST_ASSERT_EQUAL_STRING_MESSAGE("player",r2d_world_spawn_type_name(PLAYER),"player name");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("enemy",r2d_world_spawn_type_name(ENEMY),"enemy name");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("item",r2d_world_spawn_type_name(ITEM),"item name");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("boss",r2d_world_spawn_type_name(BOSS),"boss name");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("effect",r2d_world_spawn_type_name(EFFECT),"effect name");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("camera",r2d_world_spawn_type_name(CAMERA),"camera name");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("unknown",r2d_world_spawn_type_name(-1),"invalid type name");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("unknown",r2d_world_spawn_type_name(CAMERA+1),"out-of-range type name");

    TEST_ASSERT_EQUAL_INT_MESSAGE(PLAYER,r2d_world_spawn_type_from_name("player"),"player parse");
    TEST_ASSERT_EQUAL_INT_MESSAGE(ENEMY,r2d_world_spawn_type_from_name("ENEMY"),"case-insensitive parse");
    TEST_ASSERT_EQUAL_INT_MESSAGE(ITEM,r2d_world_spawn_type_from_name("Item"),"mixed-case parse");
    TEST_ASSERT_EQUAL_INT_MESSAGE(BOSS,r2d_world_spawn_type_from_name("boss"),"boss parse");
    TEST_ASSERT_EQUAL_INT_MESSAGE(EFFECT,r2d_world_spawn_type_from_name("effect"),"effect parse");
    TEST_ASSERT_EQUAL_INT_MESSAGE(CAMERA,r2d_world_spawn_type_from_name("camera"),"camera parse");
    TEST_ASSERT_EQUAL_INT_MESSAGE(CAMERA,r2d_world_spawn_type_from_name("cutscene"),"cutscene alias");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_spawn_type_from_name("turret"),"unknown name rejects");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_spawn_type_from_name(""),"empty name rejects");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_spawn_type_from_name(NULL),"NULL name rejects");

    R2DWorldMetadata meta={0};
    char error[256];
    TEST_ASSERT_TRUE_MESSAGE(parse_text("{\"spawns\":[{\"id\":\"c\",\"type\":5,\"x\":0,\"y\":0}]}",
        &meta,error,sizeof error),"numeric camera type parses");
    TEST_ASSERT_EQUAL_INT_MESSAGE(CAMERA,meta.spawns[0].type,"numeric camera value");
    r2d_world_metadata_free(&meta);
    TEST_ASSERT_FALSE_MESSAGE(parse_text("{\"spawns\":[{\"id\":\"c\",\"type\":6,\"x\":0,\"y\":0}]}",
        &meta,error,sizeof error),"type above range rejects");
    TEST_ASSERT_FALSE_MESSAGE(parse_text("{\"spawns\":[{\"id\":\"c\",\"type\":-1,\"x\":0,\"y\":0}]}",
        &meta,error,sizeof error),"negative type rejects");
    TEST_ASSERT_FALSE_MESSAGE(parse_text("{\"spawns\":[{\"id\":\"c\",\"type\":1.5,\"x\":0,\"y\":0}]}",
        &meta,error,sizeof error),"fractional type rejects");
    TEST_ASSERT_FALSE_MESSAGE(parse_text("{\"spawns\":[{\"id\":\"c\",\"type\":\"turret\",\"x\":0,\"y\":0}]}",
        &meta,error,sizeof error),"unknown type name rejects");
}

static void test_duplicate_spawn_ids(void)
{
    R2DWorldMetadata meta={0};
    char error[256];
    TEST_ASSERT_FALSE_MESSAGE(parse_text(
        "{\"spawns\":[{\"id\":\"same\",\"type\":\"player\",\"x\":0,\"y\":0},"
        "{\"id\":\"same\",\"type\":\"enemy\",\"x\":10,\"y\":10}]}",
        &meta,error,sizeof error),"duplicate spawn ids rejected");
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(error,"duplicate"),"duplicate diagnostic is clear");
    TEST_ASSERT_NULL_MESSAGE(meta.spawns,"failed parse leaves spawns NULL");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,meta.spawn_count,"failed parse leaves spawn count zero");

    TEST_ASSERT_TRUE_MESSAGE(parse_text(
        "{\"spawns\":[{\"id\":\"a\",\"type\":\"player\",\"x\":0,\"y\":0},"
        "{\"id\":\"b\",\"type\":\"enemy\",\"x\":10,\"y\":10}]}",
        &meta,error,sizeof error),"distinct spawn ids accepted");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2,meta.spawn_count,"distinct spawn count");
    r2d_world_metadata_free(&meta);
}

static void test_oversized_strings(void)
{
    char huge[129];
    memset(huge,'a',sizeof huge-1);
    huge[sizeof huge-1]='\0';
    char json[512];
    char error[256];
    R2DWorldMetadata meta={0};

    snprintf(json,sizeof json,"{\"meta\":{\"title\":\"%s\"}}",huge);
    TEST_ASSERT_FALSE_MESSAGE(parse_text(json,&meta,error,sizeof error),"128-byte metadata string rejected");
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(error,"title"),"oversized title diagnostic names the field");
    TEST_ASSERT_NULL_MESSAGE(meta.title,"oversized title leaves field NULL");

    snprintf(json,sizeof json,"{\"spawns\":[{\"id\":\"%s\",\"type\":\"player\",\"x\":0,\"y\":0}]}",huge);
    TEST_ASSERT_FALSE_MESSAGE(parse_text(json,&meta,error,sizeof error),"128-byte spawn id rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,meta.spawn_count,"oversized spawn id leaves count zero");

    char exact[128];
    memset(exact,'b',sizeof exact-1);
    exact[sizeof exact-1]='\0';
    snprintf(json,sizeof json,"{\"meta\":{\"id\":\"%s\"}}",exact);
    TEST_ASSERT_TRUE_MESSAGE(parse_text(json,&meta,error,sizeof error),"127-byte string accepted");
    TEST_ASSERT_EQUAL_INT_MESSAGE(127,(int)strlen(meta.id),"127-byte string preserved");
    r2d_world_metadata_free(&meta);
}

static void test_malformed_and_nan_transactional(void)
{
    R2DWorldMetadata meta={0};
    char error[256];

    // Start with a valid value so the failure path must clear it.
    TEST_ASSERT_TRUE_MESSAGE(parse_text(FULL_JSON,&meta,error,sizeof error),"valid baseline parses");
    TEST_ASSERT_NOT_NULL_MESSAGE(meta.id,"baseline id present");

    TEST_ASSERT_FALSE_MESSAGE(parse_text(
        "{\"meta\":{\"id\":\"broken\"},\"spawns\":[{\"id\":\"p\",\"type\":\"player\",\"x\":NaN,\"y\":0}]}",
        &meta,error,sizeof error),"NaN spawn coordinate rejected");
    // The JSON parser may reject NaN before the metadata layer sees it, so use a
    // syntactically valid but out-of-range coordinate to prove rollback.
    TEST_ASSERT_FALSE_MESSAGE(parse_text(
        "{\"meta\":{\"id\":\"broken\"},\"spawns\":[{\"id\":\"p\",\"type\":\"player\",\"x\":1000001,\"y\":0}]}",
        &meta,error,sizeof error),"out-of-range spawn coordinate rejected");
    TEST_ASSERT_NULL_MESSAGE(meta.id,"failure clears previous metadata");
    TEST_ASSERT_NULL_MESSAGE(meta.spawns,"failure clears previous spawns");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,meta.spawn_count,"failure clears previous spawn count");

    TEST_ASSERT_FALSE_MESSAGE(parse_text(
        "{\"spawns\":[{\"id\":\"p\",\"type\":\"player\",\"x\":0,\"y\":Infinity}]}",
        &meta,error,sizeof error),"infinite spawn coordinate rejected");
    TEST_ASSERT_FALSE_MESSAGE(parse_text(
        "{\"meta\":{\"defaultFogDensity\":NaN}}",&meta,error,sizeof error),"NaN fog density rejected");
    TEST_ASSERT_FALSE_MESSAGE(parse_text(
        "{\"meta\":[]}",&meta,error,sizeof error),"non-object meta rejected");
    TEST_ASSERT_FALSE_MESSAGE(parse_text(
        "{\"spawns\":{}}",&meta,error,sizeof error),"non-array spawns rejected");
    TEST_ASSERT_FALSE_MESSAGE(parse_text(
        "{\"spawns\":[[]]}",&meta,error,sizeof error),"non-object spawn rejected");
    TEST_ASSERT_FALSE_MESSAGE(parse_text(
        "{\"spawns\":[{\"type\":\"player\",\"x\":0,\"y\":0}]}",&meta,error,sizeof error),"missing spawn id rejected");
    TEST_ASSERT_FALSE_MESSAGE(parse_text(
        "{\"spawns\":[{\"id\":\"p\",\"type\":\"player\",\"y\":0}]}",&meta,error,sizeof error),"missing spawn x rejected");
    TEST_ASSERT_FALSE_MESSAGE(parse_text(
        "{\"spawns\":[{\"id\":\"p\",\"x\":0,\"y\":0}]}",&meta,error,sizeof error),"missing spawn type rejected");
    TEST_ASSERT_FALSE_MESSAGE(parse_text(
        "{\"spawns\":[{\"id\":\"\",\"type\":\"player\",\"x\":0,\"y\":0}]}",&meta,error,sizeof error),"empty spawn id rejected");
    TEST_ASSERT_FALSE_MESSAGE(parse_text("{\"meta\":{\"id\":5}}",&meta,error,sizeof error),"non-string metadata id rejected");

    R2dJson *array=r2d_json_parse("[]",error,sizeof error);
    TEST_ASSERT_NOT_NULL_MESSAGE(array,"array JSON parses");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_metadata_parse(array,&meta,error,sizeof error),"non-object root rejected");
    r2d_json_free(array);
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_metadata_parse(NULL,&meta,error,sizeof error),"NULL JSON rejected");
    TEST_ASSERT_NULL_MESSAGE(meta.id,"NULL JSON leaves output zeroed");
}

static void test_unknown_fields_ignored(void)
{
    R2DWorldMetadata meta={0};
    char error[256];
    TEST_ASSERT_TRUE_MESSAGE(parse_text(
        "{\"meta\":{\"id\":\"m\",\"mystery\":{\"a\":[1,2,3]},\"future\":true},"
        "\"authoring\":[1,2],"
        "\"spawns\":[{\"id\":\"p\",\"type\":\"player\",\"x\":1,\"y\":2,\"extra\":\"ignored\",\"nested\":{}}]}",
        &meta,error,sizeof error),"unknown fields are ignored");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("m",meta.id,"known field still parsed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,meta.spawn_count,"known spawn parsed");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("p",meta.spawns[0].id,"known spawn id parsed");
    r2d_world_metadata_free(&meta);
}

static void test_spawn_count_limit(void)
{
    static char json[96*1024];
    size_t used=(size_t)snprintf(json,sizeof json,"{\"spawns\":[");
    for(int i=0;i<R2D_WORLD_METADATA_SPAWN_MAX+1;i++) {
        int written=snprintf(json+used,sizeof json-used,
            "%s{\"id\":\"s%d\",\"type\":\"enemy\",\"x\":%d,\"y\":0}",
            i?",":"",i,i);
        TEST_ASSERT_TRUE_MESSAGE(written>0&&used+(size_t)written<sizeof json,"spawn stress JSON fits");
        used+=(size_t)written;
    }
    snprintf(json+used,sizeof json-used,"]}");
    char error[256];
    R2DWorldMetadata meta={0};
    TEST_ASSERT_FALSE_MESSAGE(parse_text(json,&meta,error,sizeof error),"1025 spawns rejected");
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(error,"spawns"),"spawn limit diagnostic is clear");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,meta.spawn_count,"spawn limit failure leaves count zero");

    // Exactly 1024 spawns is the accepted boundary.
    used=(size_t)snprintf(json,sizeof json,"{\"spawns\":[");
    for(int i=0;i<R2D_WORLD_METADATA_SPAWN_MAX;i++) {
        int written=snprintf(json+used,sizeof json-used,
            "%s{\"id\":\"s%d\",\"type\":\"enemy\",\"x\":%d,\"y\":0}",
            i?",":"",i,i);
        TEST_ASSERT_TRUE_MESSAGE(written>0&&used+(size_t)written<sizeof json,"boundary JSON fits");
        used+=(size_t)written;
    }
    snprintf(json+used,sizeof json-used,"]}");
    TEST_ASSERT_TRUE_MESSAGE(parse_text(json,&meta,error,sizeof error),"1024 spawns accepted");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_WORLD_METADATA_SPAWN_MAX,meta.spawn_count,"1024 spawn count preserved");
    r2d_world_metadata_free(&meta);
}

static void test_free_and_reparse(void)
{
    R2DWorldMetadata meta={0};
    char error[256];
    for(int i=0;i<3;i++) {
        TEST_ASSERT_TRUE_MESSAGE(parse_text(FULL_JSON,&meta,error,sizeof error),"reparse cycle succeeds");
        TEST_ASSERT_EQUAL_INT_MESSAGE(3,meta.spawn_count,"reparse cycle spawn count");
        r2d_world_metadata_free(&meta);
        TEST_ASSERT_NULL_MESSAGE(meta.spawns,"reparse cycle frees spawns");
    }
    r2d_world_metadata_free(&meta);
    r2d_world_metadata_free(NULL);
    TEST_ASSERT_TRUE_MESSAGE(1,"free is idempotent and NULL-safe");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_full_round_trip);
    RUN_TEST(test_defaults_and_aliases);
    RUN_TEST(test_spawn_type_mapping);
    RUN_TEST(test_duplicate_spawn_ids);
    RUN_TEST(test_oversized_strings);
    RUN_TEST(test_malformed_and_nan_transactional);
    RUN_TEST(test_unknown_fields_ignored);
    RUN_TEST(test_spawn_count_limit);
    RUN_TEST(test_free_and_reparse);
    return UNITY_END();
}
