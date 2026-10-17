#include "re2d_world_semantic.h"
#include "json.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Authored names are bounded bytes, never embedded NUL. element counts stay
// parallel to geometry so a handle remains the only runtime lookup key.
static size_t bounded_len(const char *s,size_t cap)
{
    size_t n=0;if(!s)return 0;while(n<cap&&s[n])n++;return n;
}
static R2DWorldIdTable *mutable_table(R2DRe2dWorld *w,int kind)
{
    if(!w)return NULL;
    switch(kind) {
        case R2D_WORLD_IDS_CELL:return &w->cell_ids;
        case R2D_WORLD_IDS_WALL:return &w->wall_ids;
        case R2D_WORLD_IDS_SPAN:return &w->span_ids;
        case R2D_WORLD_IDS_PORTAL:return &w->portal_ids;
        default:return NULL;
    }
}
const R2DWorldIdTable *r2d_world_semantic_table(const R2DRe2dWorld *w,int kind)
{
    if(!w)return NULL;
    switch(kind) {
        case R2D_WORLD_IDS_CELL:return &w->cell_ids;
        case R2D_WORLD_IDS_WALL:return &w->wall_ids;
        case R2D_WORLD_IDS_SPAN:return &w->span_ids;
        case R2D_WORLD_IDS_PORTAL:return &w->portal_ids;
        default:return NULL;
    }
}
void r2d_world_semantic_free(R2DRe2dWorld *w)
{
    if(!w)return;
    for(int kind=0;kind<R2D_WORLD_IDS_KINDS;kind++) {
        R2DWorldIdTable *t=mutable_table(w,kind);
        if(t->names){for(int i=0;i<t->count;i++)free(t->names[i]);free(t->names);}
        t->names=NULL;t->count=0;
    }
}
bool r2d_world_semantic_any(const R2DRe2dWorld *w)
{
    if(!w)return false;
    for(int kind=0;kind<R2D_WORLD_IDS_KINDS;kind++) {
        const R2DWorldIdTable *t=r2d_world_semantic_table(w,kind);
        for(int i=0;i<t->count;i++)if(t->names&&t->names[i])return true;
    }
    return false;
}
bool r2d_world_semantic_resize(R2DRe2dWorld *w,int kind,int count)
{
    R2DWorldIdTable *t=mutable_table(w,kind);
    if(!t||count<0||count>65536)return false;
    char **names=NULL;
    if(count){names=calloc((size_t)count,sizeof *names);if(!names)return false;}
    if(t->names){for(int i=0;i<t->count;i++)free(t->names[i]);free(t->names);}
    t->names=names;t->count=count;return true;
}
bool r2d_world_semantic_assign(R2DRe2dWorld *w,int kind,int index,const char *id)
{
    R2DWorldIdTable *t=mutable_table(w,kind);
    if(!t||!t->names||index<0||index>=t->count)return false;
    size_t length=bounded_len(id,(size_t)R2D_WORLD_ID_MAX+1);
    if(length>R2D_WORLD_ID_MAX)return false;
    char *copy=NULL;
    if(length){copy=malloc(length+1);if(!copy)return false;memcpy(copy,id,length+1);}
    free(t->names[index]);t->names[index]=copy;return true;
}
static int name_compare(const void *a,const void *b)
{
    const char *const *x=(const char *const *)a;
    const char *const *y=(const char *const *)b;
    return strcmp(*x,*y);
}
static bool deny(char *err,size_t size,const char *message)
{
    if(err&&size)snprintf(err,size,"Re2D World: %s",message);
    return false;
}
static bool deny_index(char *err,size_t size,const char *message,int index)
{
    if(err&&size)snprintf(err,size,"Re2D World: %s (%d)",message,index);
    return false;
}
static bool check_table(const R2DWorldIdTable *t,int expected,const char *what,char *err,size_t size)
{
    if(t->count<0||t->count>65536)return deny(err,size,"semantic id count out of range");
    if(t->count&&!t->names)return deny(err,size,"semantic id table missing storage");
    if(t->names&&t->count!=expected)return deny_index(err,size,"semantic id table size does not match geometry",t->count);
    if(!t->names)return true;
    char **sorted=t->count?malloc((size_t)t->count*sizeof *sorted):NULL;
    if(t->count&&!sorted)return deny(err,size,"out of memory");
    int count=0;bool ok=true;
    for(int i=0;i<t->count&&ok;i++) {
        const char *name=t->names[i];if(!name)continue;
        size_t length=bounded_len(name,(size_t)R2D_WORLD_ID_MAX+1);
        if(length==0||length>R2D_WORLD_ID_MAX){ok=deny_index(err,size,"semantic id length out of range",i);break;}
        sorted[count++]=(char *)name;
    }
    if(ok) {
        qsort(sorted,(size_t)count,sizeof *sorted,name_compare);
        for(int i=1;i<count&&ok;i++)if(!strcmp(sorted[i-1],sorted[i])) {
            if(err&&size)snprintf(err,size,"Re2D World: duplicate semantic %s id \"%s\"",what,sorted[i]);
            ok=false;
        }
    }
    free(sorted);return ok;
}
bool r2d_world_semantic_check(const R2DRe2dWorld *w,char *err,size_t size)
{
    if(err&&size)err[0]=0;
    if(!w)return deny(err,size,"missing world");
    return check_table(&w->cell_ids,w->cell_count,"cell",err,size)&&
        check_table(&w->wall_ids,w->wall_count,"wall",err,size)&&
        check_table(&w->span_ids,w->span_count,"span",err,size)&&
        check_table(&w->portal_ids,w->portal_count,"portal",err,size);
}
bool r2d_world_semantic_validate(const R2DRe2dWorld *w)
{ return r2d_world_semantic_check(w,NULL,0); }

// Copy one optional JSON "id" field; absent stays unnamed. Any malformed name
// rejects the whole table set so a partially labelled map never goes live.
static bool copy_json_id(R2DRe2dWorld *t,int kind,int expected,int index,const R2dJson *v,const char *what,char *err,size_t size)
{
    if(!v)return true;
    if(v->type!=R2D_JSON_STR) {
        if(err&&size)snprintf(err,size,"Re2D World: %s semantic id is not a string (%d)",what,index);
        return false;
    }
    size_t length=bounded_len(v->string,(size_t)R2D_WORLD_ID_MAX+1);
    if(length==0) {
        if(err&&size)snprintf(err,size,"Re2D World: empty %s semantic id (%d)",what,index);
        return false;
    }
    if(length>R2D_WORLD_ID_MAX) {
        if(err&&size)snprintf(err,size,"Re2D World: %s semantic id longer than %d bytes (%d)",what,R2D_WORLD_ID_MAX,index);
        return false;
    }
    R2DWorldIdTable *table=mutable_table(t,kind);
    if(!table->names&&!r2d_world_semantic_resize(t,kind,expected))return deny(err,size,"out of memory");
    if(!r2d_world_semantic_assign(t,kind,index,v->string))return deny(err,size,"out of memory");
    return true;
}
bool r2d_world_semantic_load_json(R2DRe2dWorld *w,const R2dJson *root,char *err,size_t size)
{
    if(err&&size)err[0]=0;
    if(!w||!root)return deny(err,size,"missing world JSON");
    const R2dJson *walls=r2d_json_get(root,"walls"),*cells=r2d_json_get(root,"cells"),*portals=r2d_json_get(root,"portals");
    if((walls&&walls->type!=R2D_JSON_ARR)||(cells&&cells->type!=R2D_JSON_ARR)||(portals&&portals->type!=R2D_JSON_ARR))
        return deny(err,size,"semantic source arrays are not arrays");
    int authored_walls=walls?walls->count:0,source_cells=cells?cells->count:0,source_portals=portals?portals->count:0;
    // The loader appends one closure wall per portal opening after the authored walls.
    if(authored_walls>w->wall_count||source_cells!=w->cell_count||source_portals!=w->portal_count)
        return deny(err,size,"semantic source counts do not match topology");
    R2DRe2dWorld t={0};
    bool ok=true;
    for(int i=0;i<authored_walls&&ok;i++)
        ok=copy_json_id(&t,R2D_WORLD_IDS_WALL,w->wall_count,i,r2d_json_get(walls->items[i],"id"),"wall",err,size);
    int span=0;
    for(int i=0;i<source_cells&&ok;i++) {
        const R2dJson *o=cells->items[i],*ss=r2d_json_get(o,"spans");
        ok=copy_json_id(&t,R2D_WORLD_IDS_CELL,w->cell_count,i,r2d_json_get(o,"id"),"cell",err,size);
        if(!ok)break;
        if(!ss||ss->type!=R2D_JSON_ARR||span+ss->count>w->span_count){ok=deny_index(err,size,"invalid semantic span array",i);break;}
        for(int j=0;j<ss->count;j++,span++)
            if(!(ok=copy_json_id(&t,R2D_WORLD_IDS_SPAN,w->span_count,span,r2d_json_get(ss->items[j],"id"),"span",err,size)))break;
    }
    if(ok&&span!=w->span_count)ok=deny(err,size,"semantic span counts do not match topology");
    for(int i=0;i<source_portals&&ok;i++)
        ok=copy_json_id(&t,R2D_WORLD_IDS_PORTAL,w->portal_count,i,r2d_json_get(portals->items[i],"id"),"portal",err,size);
    // A map with at least one label normalises all four tables to parallel
    // counts, so the baker always writes a complete table set.
    if(ok&&r2d_world_semantic_any(&t)) {
        const int expected[R2D_WORLD_IDS_KINDS]={w->cell_count,w->wall_count,w->span_count,w->portal_count};
        for(int kind=0;kind<R2D_WORLD_IDS_KINDS&&ok;kind++) {
            const R2DWorldIdTable *table=r2d_world_semantic_table(&t,kind);
            if(!table->names&&!r2d_world_semantic_resize(&t,kind,expected[kind]))ok=deny(err,size,"out of memory");
        }
        R2DRe2dWorld probe={0};
        probe.cell_count=w->cell_count;probe.wall_count=w->wall_count;probe.span_count=w->span_count;probe.portal_count=w->portal_count;
        probe.cell_ids=t.cell_ids;probe.wall_ids=t.wall_ids;probe.span_ids=t.span_ids;probe.portal_ids=t.portal_ids;
        ok=ok&&r2d_world_semantic_check(&probe,err,size);
    }
    if(!ok){r2d_world_semantic_free(&t);return false;}
    if(r2d_world_semantic_any(&t)) {
        r2d_world_semantic_free(w);
        w->cell_ids=t.cell_ids;w->wall_ids=t.wall_ids;w->span_ids=t.span_ids;w->portal_ids=t.portal_ids;
    } else r2d_world_semantic_free(&t);
    return true;
}

static int find_name(const R2DRe2dWorld *w,const R2DWorldIdTable *table,const char *id)
{
    if(!w||!table||!table->names||!id||!id[0])return -1;
    size_t length=bounded_len(id,(size_t)R2D_WORLD_ID_MAX+1);
    if(length==0||length>R2D_WORLD_ID_MAX)return -1;
    for(int i=0;i<table->count;i++)if(table->names[i]&&!strcmp(table->names[i],id))return i;
    return -1;
}
int r2d_world_find_cell(const R2DRe2dWorld *w,const char *id)
{ return find_name(w,w?r2d_world_semantic_table(w,R2D_WORLD_IDS_CELL):NULL,id); }
int r2d_world_find_wall(const R2DRe2dWorld *w,const char *id)
{ return find_name(w,w?r2d_world_semantic_table(w,R2D_WORLD_IDS_WALL):NULL,id); }
int r2d_world_find_span(const R2DRe2dWorld *w,const char *id)
{ return find_name(w,w?r2d_world_semantic_table(w,R2D_WORLD_IDS_SPAN):NULL,id); }
int r2d_world_find_portal(const R2DRe2dWorld *w,const char *id)
{ return find_name(w,w?r2d_world_semantic_table(w,R2D_WORLD_IDS_PORTAL):NULL,id); }
static const char *name_at(const R2DRe2dWorld *w,int kind,int index,int limit)
{
    const R2DWorldIdTable *table=w?r2d_world_semantic_table(w,kind):NULL;
    if(!table||!table->names||index<0||index>=limit||index>=table->count)return NULL;
    return table->names[index];
}
const char *r2d_world_cell_id(const R2DRe2dWorld *w,int index)
{ return name_at(w,R2D_WORLD_IDS_CELL,index,w?w->cell_count:0); }
const char *r2d_world_wall_id(const R2DRe2dWorld *w,int index)
{ return name_at(w,R2D_WORLD_IDS_WALL,index,w?w->wall_count:0); }
const char *r2d_world_span_id(const R2DRe2dWorld *w,int index)
{ return name_at(w,R2D_WORLD_IDS_SPAN,index,w?w->span_count:0); }
const char *r2d_world_portal_id(const R2DRe2dWorld *w,int index)
{ return name_at(w,R2D_WORLD_IDS_PORTAL,index,w?w->portal_count:0); }

int r2d_world_wall_surface(const R2DRe2dWorld *w,int wall)
{
    if(!w||!w->surfaces||wall<0||wall>=w->wall_count||wall>=w->surface_count)return -1;
    const R2DWorldSurface *surface=&w->surfaces[wall];
    return surface->kind==R2D_WORLD_WALL&&surface->primitive==wall?wall:-1;
}
int r2d_world_span_surface(const R2DRe2dWorld *w,int span,int kind)
{
    if(!w||!w->surfaces||span<0||span>=w->span_count||(kind!=R2D_WORLD_FLOOR&&kind!=R2D_WORLD_CEILING))return -1;
    int index=w->wall_count+span*2+(kind==R2D_WORLD_CEILING?1:0);
    if(index<0||index>=w->surface_count)return -1;
    const R2DWorldSurface *surface=&w->surfaces[index];
    return surface->kind==kind&&surface->primitive==span?index:-1;
}
