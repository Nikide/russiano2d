#include "re2d_world.h"
#include "re2d_world_bake.h"
#include "re2d_world_semantic.h"
#include "json.h"
#include "unity.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

#define CHECK(c,m) TEST_ASSERT_TRUE_MESSAGE((c), (m))

// Two cells sharing one authored portal; every primitive type carries an id.
static const char *source_with_ids =
    "{\"version\":1,\"cells\":["
    "{\"id\":\"room.a\",\"x\":0,\"y\":0,\"w\":100,\"h\":100,\"spans\":[{\"id\":\"span.ground\",\"bottom\":0,\"top\":80}]},"
    "{\"id\":\"room.b\",\"x\":100,\"y\":0,\"w\":100,\"h\":100,\"spans\":[{\"id\":\"span.hall\",\"bottom\":0,\"top\":80}]}"
    "],\"walls\":["
    "{\"id\":\"wall.north\",\"from\":[0,0],\"to\":[200,0],\"bottom\":0,\"top\":80},"
    "{\"id\":\"wall.south\",\"from\":[0,100],\"to\":[200,100],\"bottom\":0,\"top\":80}"
    "],\"portals\":["
    "{\"id\":\"portal.door\",\"cellA\":0,\"cellB\":1,\"from\":[100,0],\"to\":[100,100],\"openings\":[{\"bottom\":0,\"top\":80}]}"
    "]}";

static const char *source_duplicate =
    "{\"version\":1,\"cells\":["
    "{\"x\":0,\"y\":0,\"w\":100,\"h\":100,\"spans\":[{\"bottom\":0,\"top\":80}]}"
    "],\"walls\":["
    "{\"id\":\"dup\",\"from\":[0,0],\"to\":[100,0],\"bottom\":0,\"top\":80},"
    "{\"id\":\"dup\",\"from\":[0,100],\"to\":[100,100],\"bottom\":0,\"top\":80}"
    "],\"portals\":[]}";

static const char *source_plain =
    "{\"version\":1,\"cells\":["
    "{\"x\":0,\"y\":0,\"w\":100,\"h\":100,\"spans\":[{\"bottom\":0,\"top\":80}]}"
    "],\"walls\":[],\"portals\":[]}";

static int baked_version(const char *json)
{
    R2dJson *root=r2d_json_parse(json,NULL,0);if(!root)return -1;
    const R2dJson *baked=r2d_json_get(root,"baked");
    int version=baked?(int)r2d_json_num(r2d_json_get(baked,"version"),0):-1;
    r2d_json_free(root);return version;
}

static int run_suite(void)
{
    char err[256],baked_json[65536];
    R2DRe2dWorld w={0};

    // 1. Source JSON -> native topology with owned semantic tables.
    CHECK(r2d_world_load_json(&w,source_with_ids,err,sizeof err),"source map with semantic ids loads natively");
    CHECK(w.semantic_revision==1,"semantic revision advances on first load");
    CHECK(w.cell_count==2&&w.span_count==2&&w.portal_count==1&&w.wall_count==3,"portal closure wall is derived after authored walls");
    CHECK(w.cell_ids.names&&w.wall_ids.names&&w.span_ids.names&&w.portal_ids.names,"all four name tables are owned by the world");
    CHECK(w.cell_ids.count==2&&w.span_ids.count==2&&w.portal_ids.count==1&&w.wall_ids.count==3,"name table counts parallel geometry");

    // 2. Lookup returns the canonical numeric handle, not the authored order.
    CHECK(r2d_world_find_cell(&w,"room.a")==0&&r2d_world_find_cell(&w,"room.b")==1,"find_cell resolves authored cell ids");
    CHECK(r2d_world_find_wall(&w,"wall.north")==0&&r2d_world_find_wall(&w,"wall.south")==1,"find_wall resolves authored wall ids");
    CHECK(r2d_world_find_span(&w,"span.ground")==0&&r2d_world_find_span(&w,"span.hall")==1,"find_span resolves global span indices");
    CHECK(r2d_world_find_portal(&w,"portal.door")==0,"find_portal resolves authored portal ids");
    CHECK(!strcmp(r2d_world_cell_id(&w,1),"room.b")&&!strcmp(r2d_world_span_id(&w,0),"span.ground"),"debug getters return authored names");
    CHECK(r2d_world_wall_id(&w,2)==NULL,"derived portal closure wall stays unnamed");
    CHECK(r2d_world_wall_surface(&w,0)==0,"wall surface is derived from the wall handle");
    CHECK(r2d_world_span_surface(&w,0,R2D_WORLD_FLOOR)==w.wall_count&&r2d_world_span_surface(&w,0,R2D_WORLD_CEILING)==w.wall_count+1,"span floor/ceiling surfaces are derived");
    CHECK(r2d_world_span_surface(&w,0,R2D_WORLD_WALL)==-1&&r2d_world_wall_surface(&w,99)==-1,"surface helper rejects wrong kind/index");

    // 3. Bake -> reload keeps the table and resolves to the same indices.
    R2dSb baked;r2d_sb_init(&baked);r2d_sb_puts(&baked,"{\"version\":1,");
    CHECK(r2d_world_put_baked(&w,&baked),"semantic tables bake into the .re2dworld payload");
    r2d_sb_putc(&baked,'}');
    snprintf(baked_json,sizeof baked_json,"%s",baked.data);r2d_sb_free(&baked);
    CHECK(baked_version(baked_json)==3,"baked wire version 3 carries semantic tables alongside static lighting");
    R2DRe2dWorld restored={0};
    CHECK(r2d_world_load_json(&restored,baked_json,err,sizeof err),"baked payload with semantic tables loads transactionally");
    CHECK(restored.semantic_revision==1&&restored.baked_topology,"baked load bumps semantic revision and skips authoring BSP");
    CHECK(r2d_world_find_cell(&restored,"room.b")==1&&r2d_world_find_wall(&restored,"wall.south")==1&&
          r2d_world_find_span(&restored,"span.hall")==1&&r2d_world_find_portal(&restored,"portal.door")==0,"find_* survives bake/load round trip");
    CHECK(!strcmp(r2d_world_cell_id(&restored,0),"room.a")&&!strcmp(r2d_world_portal_id(&restored,0),"portal.door"),"owned strings survive the baked round trip");

    // 4. Duplicate source id is rejected and the old world is untouched.
    char error_text[256]={0};
    CHECK(!r2d_world_load_json(&w,source_duplicate,error_text,sizeof error_text),"duplicate source ids are rejected");
    CHECK(strstr(error_text,"duplicate")!=NULL,"duplicate rejection names the offending id class");
    CHECK(w.cell_count==2&&r2d_world_find_cell(&w,"room.a")==0&&r2d_world_find_wall(&w,"wall.north")==0,"failed reload preserves the previous world and its names");

    // 5. Unknown / NULL / empty names are inert.
    CHECK(r2d_world_find_cell(&w,"missing")==-1&&r2d_world_find_wall(&w,"ROOM.A")==-1,"unknown and case-mismatched ids return -1");
    CHECK(r2d_world_find_cell(&w,NULL)==-1&&r2d_world_find_span(&w,"")==-1&&r2d_world_find_portal(&w,NULL)==-1,"NULL/empty lookups are safe");
    CHECK(r2d_world_cell_id(&w,-1)==NULL&&r2d_world_cell_id(&w,99)==NULL&&r2d_world_wall_id(&w,-5)==NULL,"getters reject invalid handles");
    CHECK(r2d_world_find_cell(NULL,"room.a")==-1&&r2d_world_semantic_any(NULL)==false,"NULL world is safe");

    // 6. Compatibility: a map without an id table still loads and stays numeric.
    R2DRe2dWorld legacy={0};
    CHECK(r2d_world_load_json(&legacy,source_plain,err,sizeof err)&&legacy.cell_count==1,"legacy map without semantic ids loads");
    CHECK(!r2d_world_semantic_any(&legacy)&&r2d_world_find_cell(&legacy,"room.a")==-1&&r2d_world_cell_id(&legacy,0)==NULL,"absent id table yields -1 lookups");
    R2dSb legacy_baked;r2d_sb_init(&legacy_baked);r2d_sb_puts(&legacy_baked,"{\"version\":1,");
    CHECK(r2d_world_put_baked(&legacy,&legacy_baked),"legacy world bakes without a semantic section");
    r2d_sb_putc(&legacy_baked,'}');
    snprintf(baked_json,sizeof baked_json,"%s",legacy_baked.data);r2d_sb_free(&legacy_baked);
    CHECK(baked_version(baked_json)==2,"legacy baked payload keeps wire version 2");
    R2DRe2dWorld legacy_loaded={0};
    CHECK(r2d_world_load_json(&legacy_loaded,baked_json,err,sizeof err)&&r2d_world_find_cell(&legacy_loaded,"room.a")==-1,"baked payload without the new table still loads");
    r2d_world_free(&legacy_loaded);r2d_world_free(&legacy);

    // 7. Reload semantics and ownership: free is leak/double-free clean under ASan.
    CHECK(r2d_world_load_json(&w,source_with_ids,err,sizeof err)&&w.semantic_revision==2,"reload replaces names and advances semantic_revision");
    CHECK(r2d_world_find_cell(&w,"room.a")==0,"reloaded table resolves again");
    r2d_world_free(&restored);r2d_world_free(&restored);
    r2d_world_free(&w);r2d_world_free(&w);
    CHECK(r2d_world_load_json(&w,source_with_ids,err,sizeof err)&&r2d_world_find_span(&w,"span.hall")==1,"load after free is independent of freed names");
    r2d_world_free(&w);
    return 0;
}

static void test_re2d_world_semantic_suite(void)
{
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, run_suite(), "Re2D World: semantic ids bake/load/lookup");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_re2d_world_semantic_suite);
    return UNITY_END();
}
