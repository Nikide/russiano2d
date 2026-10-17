#include "re2d_world_save.h"
#include "unity.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define SAVE_TEXT_CAP 16384

static void fill_state(R2DWorldSaveState *s,R2DWorldSavedSpan spans[2],R2DWorldSavedPortal portals[2],
                       R2DWorldSavedMover movers[2],R2DWorldSavedTrigger triggers[2])
{
    memset(spans,0,2*sizeof *spans);
    memset(portals,0,2*sizeof *portals);
    memset(movers,0,2*sizeof *movers);
    memset(triggers,0,2*sizeof *triggers);

    spans[0].span=0; spans[0].bottom=0.0f; spans[0].top=10.5f;
    strcpy(spans[0].id,"hall.lower");
    spans[1].span=3; spans[1].bottom=10.5f; spans[1].top=18.25f;
    spans[1].id[0]=0;

    portals[0].portal=5; portals[0].open_fraction=0.25f; portals[0].closed=false;
    strcpy(portals[0].id,"gate.west");
    portals[1].portal=7; portals[1].open_fraction=1.0f; portals[1].closed=false;
    portals[1].id[0]=0;

    movers[0].type=0; movers[0].span=0; movers[0].portal=-1;
    movers[0].from=0.0f; movers[0].to=4.0f; movers[0].position=1.5f;
    movers[0].fraction=0.375f; movers[0].speed=2.5f; movers[0].wait=1.25f;
    movers[0].timer=0.0f; movers[0].phase=1; movers[0].direction=1;
    movers[0].auto_return=true; movers[0].blocking=false;

    movers[1].type=3; movers[1].span=-1; movers[1].portal=5;
    movers[1].from=-2.25f; movers[1].to=1.5f; movers[1].position=-2.25f;
    movers[1].fraction=0.0f; movers[1].speed=0.5f; movers[1].wait=0.0f;
    movers[1].timer=-1.0f; movers[1].phase=1; movers[1].direction=1;
    movers[1].auto_return=false; movers[1].blocking=true;

    strcpy(triggers[0].id,"gate.use"); triggers[0].type=1; triggers[0].fire_count=3;
    triggers[0].enabled=true; triggers[0].once=true; triggers[0].armed=false;
    triggers[0].timer=0.5f;
    strcpy(triggers[1].id,"boss.enter"); triggers[1].type=0; triggers[1].fire_count=0;
    triggers[1].enabled=false; triggers[1].once=false; triggers[1].armed=true;
    triggers[1].timer=0.0f;

    s->spans=spans; s->span_count=2;
    s->portals=portals; s->portal_count=2;
    s->movers=movers; s->mover_count=2;
    s->triggers=triggers; s->trigger_count=2;
}

static bool same_state(const R2DWorldSaveState *a,const R2DWorldSaveState *b)
{
    if(a->span_count!=b->span_count||a->portal_count!=b->portal_count||
       a->mover_count!=b->mover_count||a->trigger_count!=b->trigger_count)return false;
    for(int i=0;i<a->span_count;i++) {
        const R2DWorldSavedSpan *x=&a->spans[i],*y=&b->spans[i];
        if(x->span!=y->span||x->bottom!=y->bottom||x->top!=y->top||strcmp(x->id,y->id)!=0)return false;
    }
    for(int i=0;i<a->portal_count;i++) {
        const R2DWorldSavedPortal *x=&a->portals[i],*y=&b->portals[i];
        if(x->portal!=y->portal||x->open_fraction!=y->open_fraction||x->closed!=y->closed||
           strcmp(x->id,y->id)!=0)return false;
    }
    for(int i=0;i<a->mover_count;i++) {
        const R2DWorldSavedMover *x=&a->movers[i],*y=&b->movers[i];
        if(x->type!=y->type||x->span!=y->span||x->portal!=y->portal||
           x->from!=y->from||x->to!=y->to||x->position!=y->position||
           x->fraction!=y->fraction||x->speed!=y->speed||x->wait!=y->wait||
           x->timer!=y->timer||x->phase!=y->phase||x->direction!=y->direction||
           x->auto_return!=y->auto_return||x->blocking!=y->blocking)return false;
    }
    for(int i=0;i<a->trigger_count;i++) {
        const R2DWorldSavedTrigger *x=&a->triggers[i],*y=&b->triggers[i];
        if(strcmp(x->id,y->id)!=0||x->type!=y->type||x->fire_count!=y->fire_count||
           x->enabled!=y->enabled||x->once!=y->once||x->armed!=y->armed||
           x->timer!=y->timer)return false;
    }
    return true;
}

static void test_round_trip_all_sections(void)
{
    R2DWorldSaveState state;
    R2DWorldSavedSpan spans[2];
    R2DWorldSavedPortal portals[2];
    R2DWorldSavedMover movers[2];
    R2DWorldSavedTrigger triggers[2];
    fill_state(&state,spans,portals,movers,triggers);

    char text[SAVE_TEXT_CAP];
    int length=r2d_world_save_write(&state,text,sizeof text);
    TEST_ASSERT_TRUE_MESSAGE(length>0,"write succeeds");
    TEST_ASSERT_EQUAL_INT_MESSAGE(length,(int)strlen(text),"returned length matches text");
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(text,"\"format\":\"re2d-save\""),"format magic is written");
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(text,"\"version\":1"),"version is written");

    R2DWorldSaveState restored={0};
    char error[256];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_save_read(text,&restored,error,sizeof error),"read succeeds");
    TEST_ASSERT_TRUE_MESSAGE(same_state(&state,&restored),"all sections round-trip exactly");
    r2d_world_save_free(&restored);
    TEST_ASSERT_NULL_MESSAGE(restored.spans,"free zeroes the struct");
}

static void test_empty_state_round_trip(void)
{
    R2DWorldSaveState empty={0};
    char text[SAVE_TEXT_CAP];
    int length=r2d_world_save_write(&empty,text,sizeof text);
    TEST_ASSERT_TRUE_MESSAGE(length>0,"empty state writes");
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(text,"\"spans\":[]"),"empty spans array");
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(text,"\"triggers\":[]"),"empty triggers array");

    R2DWorldSaveState restored={0};
    char error[256];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_save_read(text,&restored,error,sizeof error),"empty state reads");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,restored.span_count,"no spans");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,restored.portal_count,"no portals");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,restored.mover_count,"no movers");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,restored.trigger_count,"no triggers");
    TEST_ASSERT_NULL_MESSAGE(restored.spans,"null spans pointer");
    r2d_world_save_free(&restored);
    r2d_world_save_free(NULL);
    r2d_world_save_free(&restored);
}

static void test_capacity_query_and_truncation(void)
{
    R2DWorldSaveState state;
    R2DWorldSavedSpan spans[2];
    R2DWorldSavedPortal portals[2];
    R2DWorldSavedMover movers[2];
    R2DWorldSavedTrigger triggers[2];
    fill_state(&state,spans,portals,movers,triggers);
    char full[SAVE_TEXT_CAP];
    int required=r2d_world_save_write(&state,full,sizeof full);
    TEST_ASSERT_TRUE_MESSAGE(required>0,"full write");

    int queried=r2d_world_save_write(&state,NULL,0);
    TEST_ASSERT_EQUAL_INT_MESSAGE(required,queried,"cap=0 query returns required bytes");
    TEST_ASSERT_EQUAL_INT_MESSAGE(required,(int)strlen(full),"required excludes the NUL");

    char tiny[12];
    int truncated=r2d_world_save_write(&state,tiny,sizeof tiny);
    TEST_ASSERT_EQUAL_INT_MESSAGE(required,truncated,"truncated write returns required bytes");
    TEST_ASSERT_EQUAL_INT_MESSAGE((int)sizeof tiny-1,(int)strlen(tiny),"truncated text is NUL-terminated at cap-1");
    TEST_ASSERT_TRUE_MESSAGE(memcmp(tiny,full,sizeof tiny-1)==0,"truncated text is a prefix");

    char exact[SAVE_TEXT_CAP];
    TEST_ASSERT_TRUE_MESSAGE(required<(int)sizeof exact,"fixture fits its buffer");
    TEST_ASSERT_EQUAL_INT_MESSAGE(required,r2d_world_save_write(&state,exact,(size_t)required+1),
                                  "exact-capacity write");
    R2DWorldSaveState restored={0};
    char error[256];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_save_read(exact,&restored,error,sizeof error),"exact-capacity text reads");
    r2d_world_save_free(&restored);
}

static void test_cap_zero_writes_nothing(void)
{
    R2DWorldSaveState state;
    R2DWorldSavedSpan spans[2];
    R2DWorldSavedPortal portals[2];
    R2DWorldSavedMover movers[2];
    R2DWorldSavedTrigger triggers[2];
    fill_state(&state,spans,portals,movers,triggers);
    char guard[8];
    memset(guard,0x7f,sizeof guard);
    int required=r2d_world_save_write(&state,guard,0);
    TEST_ASSERT_TRUE_MESSAGE(required>0,"cap=0 still reports the required length");
    for(int i=0;i<(int)sizeof guard;i++)TEST_ASSERT_EQUAL_INT_MESSAGE(0x7f,(unsigned char)guard[i],
                                                                      "cap=0 must not write to the buffer");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_save_write(NULL,NULL,0),"NULL state rejected");
}

static void test_missing_version_rejected(void)
{
    const char *texts[]={
        "{\"format\":\"re2d-save\",\"spans\":[],\"portals\":[],\"movers\":[],\"triggers\":[]}",
        "{\"format\":\"re2d-other\",\"version\":1,\"spans\":[],\"portals\":[],\"movers\":[],\"triggers\":[]}",
        "{\"format\":\"re2d-save\",\"version\":2,\"spans\":[],\"portals\":[],\"movers\":[],\"triggers\":[]}",
        "{\"format\":\"re2d-save\",\"version\":\"1\",\"spans\":[],\"portals\":[],\"movers\":[],\"triggers\":[]}"
    };
    for(int i=0;i<(int)(sizeof texts/sizeof *texts);i++) {
        R2DWorldSaveState restored={0};
        char error[256];
        TEST_ASSERT_FALSE_MESSAGE(r2d_world_save_read(texts[i],&restored,error,sizeof error),
                                  "missing/wrong version or magic is rejected");
        TEST_ASSERT_TRUE_MESSAGE(error[0]!=0,"an ASCII error is reported");
        TEST_ASSERT_EQUAL_INT_MESSAGE(0,restored.span_count,"failed read zeroes the output");
        TEST_ASSERT_NULL_MESSAGE(restored.spans,"failed read leaves no arrays");
    }
}

static void test_corrupt_and_truncated_rejected(void)
{
    R2DWorldSaveState state;
    R2DWorldSavedSpan spans[2];
    R2DWorldSavedPortal portals[2];
    R2DWorldSavedMover movers[2];
    R2DWorldSavedTrigger triggers[2];
    fill_state(&state,spans,portals,movers,triggers);
    char valid[SAVE_TEXT_CAP];
    int length=r2d_world_save_write(&state,valid,sizeof valid);
    TEST_ASSERT_TRUE_MESSAGE(length>0,"fixture write");

    char truncated[SAVE_TEXT_CAP];
    memcpy(truncated,valid,(size_t)length/2);
    truncated[length/2]=0;
    char trailing[SAVE_TEXT_CAP];
    snprintf(trailing,sizeof trailing,"%s x",valid);

    const char *bad[]={
        "",
        "{",
        truncated,
        trailing,
        "{\"format\":\"re2d-save\",\"version\":1,\"spans\":{},\"portals\":[],\"movers\":[],\"triggers\":[]}",
        "{\"format\":\"re2d-save\",\"version\":1,\"spans\":[],\"portals\":[],\"triggers\":[]}"
    };
    for(int i=0;i<(int)(sizeof bad/sizeof *bad);i++) {
        R2DWorldSaveState restored={0};
        char error[256];
        TEST_ASSERT_FALSE_MESSAGE(r2d_world_save_read(bad[i],&restored,error,sizeof error),
                                  "corrupt/truncated save is rejected");
        TEST_ASSERT_TRUE_MESSAGE(error[0]!=0,"an ASCII error is reported");
        TEST_ASSERT_EQUAL_INT_MESSAGE(0,restored.span_count,"output is zeroed");
    }
}

static void test_duplicate_trigger_id_rejected(void)
{
    R2DWorldSaveState state;
    R2DWorldSavedSpan spans[2];
    R2DWorldSavedPortal portals[2];
    R2DWorldSavedMover movers[2];
    R2DWorldSavedTrigger triggers[2];
    fill_state(&state,spans,portals,movers,triggers);
    strcpy(triggers[1].id,triggers[0].id);
    char text[SAVE_TEXT_CAP];
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_save_write(&state,text,sizeof text),
                                  "duplicate trigger ids are rejected on write");

    fill_state(&state,spans,portals,movers,triggers);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_save_write(&state,text,sizeof text)>0,"fixture writes");
    char *first=strstr(text,"\"triggers\":[");
    TEST_ASSERT_NOT_NULL_MESSAGE(first,"triggers section exists");
    *first=0;
    char duplicate[SAVE_TEXT_CAP];
    snprintf(duplicate,sizeof duplicate,
             "%s\"triggers\":["
             "{\"id\":\"same\",\"type\":1,\"fire_count\":0,\"enabled\":true,\"once\":false,\"armed\":false,\"timer\":0},"
             "{\"id\":\"same\",\"type\":1,\"fire_count\":1,\"enabled\":true,\"once\":true,\"armed\":true,\"timer\":0.5}"
             "]}",text);
    R2DWorldSaveState restored={0};
    char error[256];
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_save_read(duplicate,&restored,error,sizeof error),
                              "duplicate trigger ids are rejected on read");
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(error,"duplicate trigger id"),"duplicate id is named in the error");
}

static void test_nan_and_infinity_rejected(void)
{
    R2DWorldSaveState state;
    R2DWorldSavedSpan spans[2];
    R2DWorldSavedPortal portals[2];
    R2DWorldSavedMover movers[2];
    R2DWorldSavedTrigger triggers[2];
    fill_state(&state,spans,portals,movers,triggers);

    spans[0].bottom=NAN;
    char text[SAVE_TEXT_CAP];
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_save_write(&state,text,sizeof text),"NaN span height rejected");
    spans[0].bottom=0.0f;
    spans[0].top=INFINITY;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_save_write(&state,text,sizeof text),"infinite span height rejected");
    spans[0].top=10.5f;
    portals[0].open_fraction=NAN;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_save_write(&state,text,sizeof text),"NaN portal fraction rejected");
    portals[0].open_fraction=0.25f;
    movers[0].speed=INFINITY;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_save_write(&state,text,sizeof text),"infinite mover speed rejected");
    movers[0].speed=2.5f;

    fill_state(&state,spans,portals,movers,triggers);
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_save_write(&state,text,sizeof text)>0,"valid fixture writes");
    const char *field=strstr(text,"\"top\":");
    TEST_ASSERT_NOT_NULL_MESSAGE(field,"top field exists");
    const char *after=strstr(field,"10.5");
    TEST_ASSERT_NOT_NULL(after);
    after+=4;
    size_t head=(size_t)(field-text)+6; // includes the opening quote through the colon
    char overflow[SAVE_TEXT_CAP];
    snprintf(overflow,sizeof overflow,"%.*s1e999%s",(int)head,text,after);
    R2DWorldSaveState restored={0};
    char error[256];
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_save_read(overflow,&restored,error,sizeof error),
                              "non-finite JSON number rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,restored.span_count,"failed read is zeroed");
}

static void test_oversized_counts_and_ids_rejected(void)
{
    R2DWorldSaveState state={0};
    state.span_count=R2D_WORLD_SAVE_MAX_SPANS+1;
    char text[SAVE_TEXT_CAP];
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_save_write(&state,text,sizeof text),"oversized span count rejected");
    state.span_count=0;
    state.trigger_count=R2D_WORLD_SAVE_MAX_TRIGGERS+1;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_save_write(&state,text,sizeof text),"oversized trigger count rejected");

    R2DWorldSavedSpan spans[2];
    R2DWorldSavedPortal portals[2];
    R2DWorldSavedMover movers[2];
    R2DWorldSavedTrigger triggers[2];
    fill_state(&state,spans,portals,movers,triggers);
    memset(spans[1].id,'a',R2D_WORLD_SAVE_ID_CAP);
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_save_write(&state,text,sizeof text),
                                  "unterminated bounded id rejected");

    const int count=R2D_WORLD_SAVE_MAX_SPANS+1;
    const size_t capacity=(size_t)count*64+512;
    char *big=malloc(capacity);
    TEST_ASSERT_NOT_NULL_MESSAGE(big,"big JSON buffer allocated");
    size_t used=(size_t)snprintf(big,capacity,"{\"format\":\"re2d-save\",\"version\":1,\"spans\":[");
    for(int i=0;i<count;i++) {
        used+=(size_t)snprintf(big+used,capacity-used,"%s{\"span\":0,\"id\":\"\",\"bottom\":0,\"top\":1}",i?",":"");
    }
    snprintf(big+used,capacity-used,"],\"portals\":[],\"movers\":[],\"triggers\":[]}");
    R2DWorldSaveState restored={0};
    char error[256];
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_save_read(big,&restored,error,sizeof error),"oversized JSON count rejected");
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(error,"too many spans"),"oversized count is named in the error");
    free(big);

    char id_of_64[65];
    memset(id_of_64,'a',64);
    id_of_64[64]=0;
    char long_id[SAVE_TEXT_CAP];
    snprintf(long_id,sizeof long_id,
             "{\"format\":\"re2d-save\",\"version\":1,\"spans\":[],\"portals\":[],\"movers\":[],"
             "\"triggers\":[{\"id\":\"%s\",\"type\":1,\"fire_count\":0,\"enabled\":true,\"once\":false,"
             "\"armed\":false,\"timer\":0}]}",id_of_64);
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_save_read(long_id,&restored,error,sizeof error),
                              "overlong id rejected on read");
    TEST_ASSERT_NOT_NULL_MESSAGE(strstr(error,"too long"),"overlong id is named in the error");
}

static void test_deterministic_bytes(void)
{
    R2DWorldSaveState state;
    R2DWorldSavedSpan spans[2];
    R2DWorldSavedPortal portals[2];
    R2DWorldSavedMover movers[2];
    R2DWorldSavedTrigger triggers[2];
    fill_state(&state,spans,portals,movers,triggers);
    char first[SAVE_TEXT_CAP],second[SAVE_TEXT_CAP];
    int first_length=r2d_world_save_write(&state,first,sizeof first);
    int second_length=r2d_world_save_write(&state,second,sizeof second);
    TEST_ASSERT_TRUE_MESSAGE(first_length>0&&second_length==first_length,"both writes succeed");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,memcmp(first,second,(size_t)first_length),"same state writes identical bytes");

    R2DWorldSaveState restored={0};
    char error[256];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_save_read(first,&restored,error,sizeof error),"first text reads");
    char canonical[SAVE_TEXT_CAP];
    int canonical_length=r2d_world_save_write(&restored,canonical,sizeof canonical);
    TEST_ASSERT_EQUAL_INT_MESSAGE(first_length,canonical_length,"canonical length is stable");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,memcmp(first,canonical,(size_t)first_length),
                                  "read/write round-trip is byte-stable");
    r2d_world_save_free(&restored);
}

static void test_large_topology_matches_save_limit(void)
{
    // BASHNYA repro: runtime accepted one cell with 4097 spans, but the save
    // writer used to reject it (MAX_SPANS was 4096). The limit must cover the
    // runtime topology limit and the snapshot must still write/validate.
    R2DWorldSaveState state={0};
    state.span_count=4097;
    state.spans=calloc((size_t)state.span_count,sizeof *state.spans);
    TEST_ASSERT_NOT_NULL_MESSAGE(state.spans,"4097 spans allocated");
    for(int i=0;i<state.span_count;i++){state.spans[i].span=i;state.spans[i].bottom=(float)i*4;state.spans[i].top=(float)i*4+3;}
    char error[256];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_save_validate(&state,error,sizeof error),"4097-span state validates");
    const int needed=r2d_world_save_write(&state,NULL,0);
    TEST_ASSERT_GREATER_THAN_MESSAGE(0,needed,"4097-span state has a serialized size");
    char *text=malloc((size_t)needed+1);
    TEST_ASSERT_NOT_NULL(text);
    TEST_ASSERT_EQUAL_INT_MESSAGE(needed,r2d_world_save_write(&state,text,(size_t)needed+1),"4097-span state writes");
    R2DWorldSaveState restored={0};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_save_read(text,&restored,error,sizeof error),"4097-span snapshot reads back");
    TEST_ASSERT_EQUAL_INT(4097,restored.span_count);
    r2d_world_save_free(&restored);
    free(text);
    free(state.spans);
}

static void test_map_hash_identity(void)
{
    uint64_t base=r2d_world_save_map_hash("map01","1.2.3",0x123456789abcdef0ULL);
    TEST_ASSERT_TRUE_MESSAGE(base==r2d_world_save_map_hash("map01","1.2.3",0x123456789abcdef0ULL),
                             "hash is stable for identical identity");
    TEST_ASSERT_TRUE_MESSAGE(base!=r2d_world_save_map_hash("map02","1.2.3",0x123456789abcdef0ULL),
                             "hash changes with map id");
    TEST_ASSERT_TRUE_MESSAGE(base!=r2d_world_save_map_hash("map01","1.2.4",0x123456789abcdef0ULL),
                             "hash changes with map version");
    TEST_ASSERT_TRUE_MESSAGE(base!=r2d_world_save_map_hash("map01","1.2.3",0x123456789abcdef1ULL),
                             "hash changes with topology hash");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_save_map_hash(NULL,NULL,7)==r2d_world_save_map_hash("","",7),
                             "NULL strings behave as empty strings");
}

static void test_read_transactional_on_failure(void)
{
    R2DWorldSaveState state;
    R2DWorldSavedSpan spans[2];
    R2DWorldSavedPortal portals[2];
    R2DWorldSavedMover movers[2];
    R2DWorldSavedTrigger triggers[2];
    fill_state(&state,spans,portals,movers,triggers);
    char text[SAVE_TEXT_CAP];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_save_write(&state,text,sizeof text)>0,"fixture write");

    R2DWorldSaveState out={0};
    char error[256];
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_save_read(text,&out,error,sizeof error),"valid read populates output");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2,out.span_count,"output has data");

    TEST_ASSERT_FALSE_MESSAGE(r2d_world_save_read("{\"format\":\"re2d-save\",\"version\":1}",&out,error,sizeof error),
                              "missing arrays rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,out.span_count,"failed read frees existing output");
    TEST_ASSERT_NULL_MESSAGE(out.spans,"existing span array was freed");
    TEST_ASSERT_NULL_MESSAGE(out.triggers,"existing trigger array was freed");

    const char *partial=
        "{\"format\":\"re2d-save\",\"version\":1,"
        "\"spans\":[{\"span\":0,\"id\":\"ok\",\"bottom\":0,\"top\":1},"
        "{\"span\":1,\"id\":\"bad\",\"bottom\":0}],"
        "\"portals\":[],\"movers\":[],\"triggers\":[]}";
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_save_read(partial,&out,error,sizeof error),
                              "partial array is rejected transactionally");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,out.span_count,"partially allocated arrays are freed");
    TEST_ASSERT_NULL_MESSAGE(out.spans,"no dangling span pointer after failure");
}

static void test_missing_fields_and_wrong_types_rejected(void)
{
    const char *bad[]={
        "{\"format\":\"re2d-save\",\"version\":1,\"spans\":[{\"span\":0,\"id\":\"\",\"bottom\":0}],"
        "\"portals\":[],\"movers\":[],\"triggers\":[]}",
        "{\"format\":\"re2d-save\",\"version\":1,\"spans\":[{\"span\":0,\"id\":\"\",\"bottom\":0,\"top\":\"1\"}],"
        "\"portals\":[],\"movers\":[],\"triggers\":[]}",
        "{\"format\":\"re2d-save\",\"version\":1,\"spans\":[],\"portals\":[],"
        "\"movers\":[{\"type\":0,\"span\":0,\"portal\":-1,\"from\":0,\"to\":1,\"position\":0,"
        "\"fraction\":0,\"speed\":1,\"wait\":0,\"timer\":0,\"phase\":0,\"direction\":1,"
        "\"auto_return\":false}],\"triggers\":[]}",
        "{\"format\":\"re2d-save\",\"version\":1,\"spans\":[],\"portals\":[],\"movers\":[],"
        "\"triggers\":[{\"type\":1,\"fire_count\":0,\"enabled\":true,\"once\":false,"
        "\"armed\":false,\"timer\":0}]}"
    };
    for(int i=0;i<(int)(sizeof bad/sizeof *bad);i++) {
        R2DWorldSaveState out={0};
        char error[256];
        TEST_ASSERT_FALSE_MESSAGE(r2d_world_save_read(bad[i],&out,error,sizeof error),
                                  "missing field or wrong type is rejected");
        TEST_ASSERT_EQUAL_INT_MESSAGE(0,out.span_count,"output is zeroed");
    }
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_round_trip_all_sections);
    RUN_TEST(test_empty_state_round_trip);
    RUN_TEST(test_capacity_query_and_truncation);
    RUN_TEST(test_cap_zero_writes_nothing);
    RUN_TEST(test_missing_version_rejected);
    RUN_TEST(test_corrupt_and_truncated_rejected);
    RUN_TEST(test_duplicate_trigger_id_rejected);
    RUN_TEST(test_nan_and_infinity_rejected);
    RUN_TEST(test_oversized_counts_and_ids_rejected);
    RUN_TEST(test_deterministic_bytes);
    RUN_TEST(test_large_topology_matches_save_limit);
    RUN_TEST(test_map_hash_identity);
    RUN_TEST(test_read_transactional_on_failure);
    RUN_TEST(test_missing_fields_and_wrong_types_rejected);
    return UNITY_END();
}
