#include "re2d_world.h"
#include "json.h"
#include "re2d_world_bake.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define WORLD_LIMIT 65536
static bool error(char *out,size_t size,const char *message,int index)
{ if(out&&size)snprintf(out,size,"Re2D World: %s (%d)",message,index);return false; }
static bool range(int first,int count,int total)
{ return first>=0&&count>=0&&first<=total&&count<=total-first; }
static bool contains(const R2DWorldCell *c,float x,float y)
{ return x>=c->x&&x<c->x+c->w&&y>=c->y&&y<c->y+c->h; }
static int cell_node(R2DRe2dWorld *w,int *ids,int count,int depth,int *used)
{
    if(!count)return -1;
    int node=w->cell_node_count++;R2DWorldCellNode *n=&w->cell_nodes[node];
    n->front=n->back=-1;
    float lo[2]={INFINITY,INFINITY},hi[2]={-INFINITY,-INFINITY};
    for(int i=0;i<count;i++) {
        R2DWorldCell *c=&w->cells[ids[i]];
        lo[0]=fminf(lo[0],c->x);lo[1]=fminf(lo[1],c->y);
        hi[0]=fmaxf(hi[0],c->x+c->w);hi[1]=fmaxf(hi[1],c->y+c->h);
    }
    n->axis=hi[1]-lo[1]>hi[0]-lo[0];n->split=lo[n->axis]+(hi[n->axis]-lo[n->axis])*.5f;
    int back=0,front=count,refs=0;
    // In-place partition: back | straddlers | front.
    for(int i=0;i<front;) {
        R2DWorldCell *c=&w->cells[ids[i]];
        float a=n->axis?c->y:c->x,b=a+(n->axis?c->h:c->w);
        if(depth<48&&count>1&&b<=n->split){int t=ids[back];ids[back++]=ids[i];ids[i++]=t;}
        else if(depth<48&&count>1&&a>=n->split){int t=ids[--front];ids[front]=ids[i];ids[i]=t;}
        else {i++;refs++;}
    }
    n->first_ref=*used;n->ref_count=refs;
    for(int i=back;i<front;i++)w->cell_refs[(*used)++]=ids[i];
    // Child calls do not reallocate the pre-sized node buffer.
    n->back=cell_node(w,ids,back,depth+1,used);
    n->front=cell_node(w,ids+front,count-front,depth+1,used);
    return node;
}
static bool shared_edge(const R2DWorldCell *a,const R2DWorldCell *b,const R2DWorldPortal *p)
{
    // Exact authored adjacency; do not silently weld nearby boundaries.
    if(p->ax==p->bx) {
        float x=p->ax,lo=fminf(p->ay,p->by),hi=fmaxf(p->ay,p->by);
        return hi>lo&&((x==a->x+a->w&&x==b->x)||(x==b->x+b->w&&x==a->x))&&
            lo>=fmaxf(a->y,b->y)&&hi<=fminf(a->y+a->h,b->y+b->h);
    }
    if(p->ay==p->by) {
        float y=p->ay,lo=fminf(p->ax,p->bx),hi=fmaxf(p->ax,p->bx);
        return hi>lo&&((y==a->y+a->h&&y==b->y)||(y==b->y+b->h&&y==a->y))&&
            lo>=fmaxf(a->x,b->x)&&hi<=fminf(a->x+a->w,b->x+b->w);
    }
    return false;
}
static bool cell_interval(const R2DRe2dWorld *w,int cell,const R2DWorldPortal *p,const R2DWorldOpening *o)
{
    const R2DWorldCell *c=&w->cells[cell];
    for(int i=0;i<c->span_count;i++) {
        const R2DWorldSpan *s=&w->spans[c->first_span+i];
        if(r2d_world_span_opening(s,p,o))return true;
    }
    return false;
}
static bool wall_span_candidate(const R2DWorldWall *w,const R2DWorldSpan *s)
{
    return fmaxf(w->x1,w->x2)>=s->x&&fminf(w->x1,w->x2)<=s->x+s->w&&
        fmaxf(w->y1,w->y2)>=s->y&&fminf(w->y1,w->y2)<=s->y+s->h;
}
static bool wall_cell_interval(const R2DWorldWall *w,const R2DWorldCell *c,float *lo,float *hi)
{
    const float start[2]={w->x1,w->y1},delta[2]={w->x2-w->x1,w->y2-w->y1},minimum[2]={c->x,c->y},maximum[2]={c->x+c->w,c->y+c->h};*lo=0;*hi=1;
    for(int axis=0;axis<2;axis++) {
        if(delta[axis]==0){if(start[axis]<minimum[axis]||start[axis]>maximum[axis])return false;}
        else {float a=(minimum[axis]-start[axis])/delta[axis],b=(maximum[axis]-start[axis])/delta[axis];*lo=fmaxf(*lo,fminf(a,b));*hi=fminf(*hi,fmaxf(a,b));if(*lo>*hi)return false;}
    }
    return true;
}
static bool cell_rays_complete(const R2DRe2dWorld *w)
{
    // Every wall point must have a cell owner. Otherwise use the complete legacy ray.
    for(int wall=0;wall<w->wall_count;wall++) {
        float covered=0;
        for(int pass=0;pass<64&&covered<1;pass++) {
            float old=covered;
            for(int cell=0;cell<w->cell_count;cell++) {
                float lo,hi;if(wall_cell_interval(&w->walls[wall],&w->cells[cell],&lo,&hi)&&lo<=covered&&hi>covered)covered=hi;
            }
            if(covered==old)return false;
        }
        if(covered<1)return false;
    }
    return true;
}
bool r2d_world_build_cells(R2DRe2dWorld *world,const R2DWorldWall *walls,int nw,
 const R2DWorldSpan *spans,int ns,const R2DWorldCell *cells,int nc,
 const R2DWorldPortal *portals,int np,const R2DWorldOpening *openings,int no,char *err,size_t size)
{
    if(err&&size)err[0]=0;
    if(!world||nc<0||nc>WORLD_LIMIT||np<0||np>WORLD_LIMIT||no<0||no>WORLD_LIMIT||
        (nc&&!cells)||(np&&!portals)||(no&&!openings))return error(err,size,"invalid topology count",-1);
    if(nw<0||nw>WORLD_LIMIT-no||(nw&&!walls))return error(err,size,"invalid wall count",-1);
    // Door opening closures are specialised wall surfaces, derived once from topology.
    R2DWorldWall *all=calloc((size_t)(nw+no+1),sizeof *all);
    if(!all)return error(err,size,"out of memory",-1);
    if(nw)memcpy(all,walls,(size_t)nw*sizeof *walls);
    int authored_nw=nw,total=nw;
    for(int i=0;i<np;i++) {
        const R2DWorldPortal *p=&portals[i];
        if(!range(p->first_opening,p->opening_count,no)){free(all);return error(err,size,"invalid opening range",i);}
        for(int j=0;j<p->opening_count;j++) {
            if(total>=nw+no){free(all);return error(err,size,"opening ranges reused",i);}
            const R2DWorldOpening *o=&openings[p->first_opening+j];
            all[total++]=(R2DWorldWall){p->ax,p->ay,p->bx,p->by,o->bottom,o->top,0xff605040};
        }
    }
    R2DRe2dWorld next={0};
    bool built=r2d_world_build(&next,all,total,spans,ns);free(all);
    if(!built)return error(err,size,"invalid wall/span geometry",-1);
    nw=total;walls=next.walls;
    next.cell_root=-1;
#define ALLOC(field,count) do {if((count)>0){next.field=calloc((size_t)(count),sizeof *next.field);if(!next.field)goto memory;}}while(0)
    ALLOC(wall_portals,nw);ALLOC(wall_openings,nw);ALLOC(opening_spans_a,no);ALLOC(opening_spans_b,no);ALLOC(cells,nc);ALLOC(portals,np);ALLOC(openings,no);ALLOC(span_cells,ns);
    ALLOC(surfaces,nw+2*ns);ALLOC(cell_nodes,2*nc);ALLOC(cell_refs,nc);
#undef ALLOC
    if(nc)memcpy(next.cells,cells,(size_t)nc*sizeof *cells);
    if(np)memcpy(next.portals,portals,(size_t)np*sizeof *portals);
    if(no)memcpy(next.openings,openings,(size_t)no*sizeof *openings);
    int closure=authored_nw;for(int i=0;i<np;i++)for(int j=0;j<portals[i].opening_count;j++){next.wall_openings[closure]=portals[i].first_opening+j+1;next.wall_portals[closure++]=i+1;}
    next.cell_count=nc;next.portal_count=np;next.opening_count=no;
    for(int i=0;i<ns;i++)next.span_cells[i]=-1;
    const char *why=NULL;int bad=-1;
#define REJECT(message,index) do {why=(message);bad=(index);goto invalid;}while(0)
    for(int i=0;i<nc;i++) {
        const R2DWorldCell *c=&cells[i];
        if(!isfinite(c->x)||!isfinite(c->y)||!isfinite(c->w)||!isfinite(c->h)||
           c->w<=0||c->h<=0||!isfinite(c->x+c->w)||!isfinite(c->y+c->h)||
           !range(c->first_span,c->span_count,ns)||c->span_count==0)REJECT("invalid cell bounds/span range",i);
        for(int j=0;j<i;j++) {
            const R2DWorldCell *b=&cells[j];
            if(c->x<b->x+b->w&&b->x<c->x+c->w&&c->y<b->y+b->h&&b->y<c->y+c->h)
                REJECT("overlapping XY cells; stack spans in one cell",i);
        }
        for(int j=0;j<c->span_count;j++) {
            int k=c->first_span+j;const R2DWorldSpan *s=&spans[k];
            if(next.span_cells[k]>=0)REJECT("span has multiple cell owners",k);
            if(s->x!=c->x||s->y!=c->y||s->w!=c->w||s->h!=c->h)REJECT("span footprint differs from cell",k);
            next.span_cells[k]=i;
        }
    }
    for(int i=0;i<ns;i++)if(next.span_cells[i]<0)REJECT("span has no cell owner",i);
    for(int i=0;i<np;i++) {
        const R2DWorldPortal *p=&portals[i];
        if(p->cell_a<0||p->cell_a>=nc||p->cell_b<0||p->cell_b>=nc||p->cell_a==p->cell_b||
            !isfinite(p->ax)||!isfinite(p->ay)||!isfinite(p->bx)||!isfinite(p->by)||
            !range(p->first_opening,p->opening_count,no)||p->opening_count==0)REJECT("invalid portal references",i);
        if(!shared_edge(&cells[p->cell_a],&cells[p->cell_b],p))REJECT("portal is not on shared XY edge",i);
        for(int j=0;j<p->opening_count;j++) {
            const R2DWorldOpening *o=&openings[p->first_opening+j];
            if(!isfinite(o->bottom)||!isfinite(o->top)||o->top<=o->bottom||
                !cell_interval(&next,p->cell_a,p,o)||!cell_interval(&next,p->cell_b,p,o))
                REJECT("portal opening outside adjacent free spans",i);
            const R2DWorldCell *ca=&cells[p->cell_a],*cb=&cells[p->cell_b];int oi=p->first_opening+j;
            for(int k=0;k<ca->span_count;k++)if(r2d_world_span_opening(&spans[ca->first_span+k],p,o))next.opening_spans_a[oi]=ca->first_span+k;
            for(int k=0;k<cb->span_count;k++)if(r2d_world_span_opening(&spans[cb->first_span+k],p,o))next.opening_spans_b[oi]=cb->first_span+k;
            for(int k=0;k<j;k++) {
                const R2DWorldOpening *b=&openings[p->first_opening+k];
                if(o->bottom<b->top&&b->bottom<o->top)REJECT("overlapping portal openings",i);
            }
        }
    }
    for(int i=0;i<nw;i++)next.surfaces[next.surface_count++]=(R2DWorldSurface){R2D_WORLD_WALL,i,-1,-1};
    for(int i=0;i<ns;i++)for(int ceiling=0;ceiling<2;ceiling++)
        next.surfaces[next.surface_count++]=(R2DWorldSurface){ceiling?R2D_WORLD_CEILING:R2D_WORLD_FLOOR,i,next.span_cells[i],i};
    // Static incidence tables: frame cost follows reachable spans and their surfaces.
    next.span_wall_offsets=calloc((size_t)ns+1,sizeof(int));next.cell_portal_offsets=calloc((size_t)nc+1,sizeof(int));
    if(!next.span_wall_offsets||!next.cell_portal_offsets)goto memory;
    int refs=0;
    for(int i=0;i<ns;i++) {
        next.span_wall_offsets[i]=refs;
        for(int j=0;j<nw;j++)if(wall_span_candidate(&next.walls[j],&spans[i])){if(refs==1048576)REJECT("wall incidence budget exceeded",i);refs++;}
    }
    next.span_wall_offsets[ns]=refs;
    if(refs){next.span_wall_refs=malloc((size_t)refs*sizeof(int));if(!next.span_wall_refs)goto memory;}
    refs=0;for(int i=0;i<ns;i++)for(int j=0;j<nw;j++)if(wall_span_candidate(&next.walls[j],&spans[i]))next.span_wall_refs[refs++]=j;
    for(int i=0;i<np;i++){next.cell_portal_offsets[portals[i].cell_a+1]++;next.cell_portal_offsets[portals[i].cell_b+1]++;}
    for(int i=1;i<=nc;i++)next.cell_portal_offsets[i]+=next.cell_portal_offsets[i-1];
    if(np){next.cell_portal_refs=malloc((size_t)np*2*sizeof(int));if(!next.cell_portal_refs)goto memory;}
    int *cursor=nc?malloc((size_t)nc*sizeof(int)):NULL;if(nc&&!cursor)goto memory;
    if(nc)memcpy(cursor,next.cell_portal_offsets,(size_t)nc*sizeof(int));
    for(int i=0;i<np;i++){next.cell_portal_refs[cursor[portals[i].cell_a]++]=i;next.cell_portal_refs[cursor[portals[i].cell_b]++]=i;}free(cursor);
    if(nc) {
        int *ids=malloc((size_t)nc*sizeof *ids);if(!ids)goto memory;
        for(int i=0;i<nc;i++)ids[i]=i;
        int used=0;next.cell_root=cell_node(&next,ids,nc,0,&used);free(ids);
    }
    next.cell_rays_complete=cell_rays_complete(&next);
    next.topology_revision=world->topology_revision+1;
    r2d_world_free(world);*world=next;return true;
invalid:
    r2d_world_free(&next);return error(err,size,why,bad);
memory:
    r2d_world_free(&next);return error(err,size,"out of memory",-1);
#undef REJECT
}
int r2d_world_cell_at(const R2DRe2dWorld *w,float x,float y)
{
    if(!w||!isfinite(x)||!isfinite(y))return -1;
    int index=w->cell_count?w->cell_root:-1;
    while(index>=0) {
        const R2DWorldCellNode *n=&w->cell_nodes[index];
        for(int i=0;i<n->ref_count;i++){int cell=w->cell_refs[n->first_ref+i];if(contains(&w->cells[cell],x,y))return cell;}
        index=(n->axis?y:x)>=n->split?n->front:n->back;
    }
    return -1;
}
int r2d_world_span_at(const R2DRe2dWorld *w,float x,float y,float height)
{
    if(!isfinite(height))return -1;
    int cell=r2d_world_cell_at(w,x,y);if(cell<0)return -1;
    const R2DWorldCell *c=&w->cells[cell];
    for(int i=0;i<c->span_count;i++){int k=c->first_span+i;const R2DWorldSpan *s=&w->spans[k];if(height>=r2d_world_floor_height(s,x,y)&&height<r2d_world_ceiling_height(s,x,y))return k;}
    return -1;
}
static void cells_order(const R2DRe2dWorld *w,int node,float x,float y,int *out,int cap,int *count)
{
    if(node<0)return;
    const R2DWorldCellNode *n=&w->cell_nodes[node];bool front=(n->axis?y:x)>=n->split;
    cells_order(w,front?n->front:n->back,x,y,out,cap,count);
    for(int i=0;i<n->ref_count;i++){if(*count<cap)out[*count]=w->cell_refs[n->first_ref+i];(*count)++;}
    cells_order(w,front?n->back:n->front,x,y,out,cap,count);
}
int r2d_world_cells_order(const R2DRe2dWorld *w,float x,float y,int *out,int cap)
{ if(!w||cap<0||(cap&&!out)||!isfinite(x)||!isfinite(y))return 0;int count=0;cells_order(w,w->cell_count?w->cell_root:-1,x,y,out,cap,&count);return count; }
const R2DWorldSurface *r2d_world_surface(const R2DRe2dWorld *w,int i)
{ return w&&i>=0&&i<w->surface_count?&w->surfaces[i]:NULL; }
bool r2d_world_portal_passes(const R2DRe2dWorld *w,int i,float bottom,float top)
{
    if(!w||i<0||i>=w->portal_count||!isfinite(bottom)||!isfinite(top)||top<=bottom)return false;
    const R2DWorldPortal *p=&w->portals[i];if(p->closed)return false;
    const R2DWorldCell *a=&w->cells[p->cell_a],*b=&w->cells[p->cell_b];
    for(int j=0;j<p->opening_count;j++)for(int ai=0;ai<a->span_count;ai++)for(int bi=0;bi<b->span_count;bi++){
        R2DWorldOpening opening;if(r2d_world_opening_between(&w->spans[a->first_span+ai],&w->spans[b->first_span+bi],p,&w->openings[p->first_opening+j],&opening)&&bottom>=opening.bottom&&top<=opening.top)return true;}
    return false;
}
bool r2d_world_portal_set_closed(R2DRe2dWorld *w,int i,bool closed)
{ if(!w||i<0||i>=w->portal_count)return false;if(w->portals[i].closed!=closed){
    R2DWorldPortal *p=&w->portals[i];p->closed=closed;w->geometry_revision++;
    float bottom=INFINITY,top=-INFINITY;for(int j=0;j<p->opening_count;j++){const R2DWorldOpening *o=&w->openings[p->first_opening+j];bottom=fminf(bottom,o->bottom);top=fmaxf(top,o->top);}
    r2d_world_light_invalidate_box(w,fminf(p->ax,p->bx),fminf(p->ay,p->by),bottom,fmaxf(p->ax,p->bx),fmaxf(p->ay,p->by),top);
}return true; }
bool r2d_world_opening_between(const R2DWorldSpan *a,const R2DWorldSpan *b,const R2DWorldPortal *p,const R2DWorldOpening *authored,R2DWorldOpening *out)
{
    out->bottom=authored->bottom;out->top=authored->top;const R2DWorldSpan *spans[2]={a,b};
    for(int i=0;i<2;i++){const R2DWorldSpan *s=spans[i];out->bottom=fmaxf(out->bottom,fmaxf(r2d_world_floor_height(s,p->ax,p->ay),r2d_world_floor_height(s,p->bx,p->by)));
        out->top=fminf(out->top,fminf(r2d_world_ceiling_height(s,p->ax,p->ay),r2d_world_ceiling_height(s,p->bx,p->by)));}
    return out->top>out->bottom;
}
bool r2d_world_wall_opening(const R2DRe2dWorld *w,int wall,R2DWorldOpening *out)
{
    if(!w->wall_portals||!w->wall_portals[wall])return false;const R2DWorldPortal *p=&w->portals[w->wall_portals[wall]-1];if(p->closed)return false;
    int opening=w->wall_openings[wall]-1;return r2d_world_opening_between(&w->spans[w->opening_spans_a[opening]],&w->spans[w->opening_spans_b[opening]],p,&w->openings[opening],out);
}
bool r2d_world_wall_solid(const R2DRe2dWorld *w,int wall,float bottom,float top)
{
    R2DWorldOpening opening;if(!r2d_world_wall_opening(w,wall,&opening))return true;
    return bottom<opening.bottom||top>opening.top||(bottom==top&&top>=opening.top);
}
bool r2d_world_span_set_heights(R2DRe2dWorld *w,int index,float bottom,float top)
{
    if(!w||index<0||index>=w->span_count||!isfinite(bottom)||!isfinite(top)||fabsf(bottom)>1e6f||fabsf(top)>1e6f||top<=bottom)return false;
    R2DWorldSpan next=w->spans[index];next.bottom=bottom;next.top=top;
    // Dynamic portal openings are rectangular; sloped moving boundaries need quad clipping.
    int cell=w->span_cells?w->span_cells[index]:-1;
    if(cell>=0&&w->cell_portal_offsets[cell+1]>w->cell_portal_offsets[cell]&&(next.floor_a||next.floor_b||next.ceiling_a||next.ceiling_b))return false;
    if(cell>=0)for(int pi=w->cell_portal_offsets[cell];pi<w->cell_portal_offsets[cell+1];pi++){
        const R2DWorldPortal *p=&w->portals[w->cell_portal_refs[pi]];
        for(int j=0;j<p->opening_count;j++){int oi=p->first_opening+j,owner=p->cell_a==cell?w->opening_spans_a[oi]:w->opening_spans_b[oi];
            if(owner!=index&&next.bottom<w->openings[oi].top&&next.top>w->openings[oi].bottom)return false;}
    }
    for(int corner=0;corner<4;corner++){float x=next.x+(corner&1?next.w:0),y=next.y+(corner&2?next.h:0);
        if(r2d_world_floor_height(&next,x,y)>=r2d_world_ceiling_height(&next,x,y))return false;}
    int first=cell>=0?w->cells[cell].first_span:0,last=cell>=0?first+w->cells[cell].span_count:w->span_count;
    for(int i=first;i<last;i++)if(i!=index){const R2DWorldSpan *s=&w->spans[i];
        float x0=fmaxf(next.x,s->x),x1=fminf(next.x+next.w,s->x+s->w),y0=fmaxf(next.y,s->y),y1=fminf(next.y+next.h,s->y+s->h);
        if(x0>=x1||y0>=y1)continue;bool above=true,below=true;
        for(int corner=0;corner<4;corner++){float x=corner&1?x1:x0,y=corner&2?y1:y0;
            if(r2d_world_floor_height(&next,x,y)<r2d_world_ceiling_height(s,x,y))above=false;
            if(r2d_world_floor_height(s,x,y)<r2d_world_ceiling_height(&next,x,y))below=false;}
        if(!above&&!below)return false;
    }
    if(next.bottom==w->spans[index].bottom&&next.top==w->spans[index].top)return true;
    float lo=INFINITY,hi=-INFINITY;for(int corner=0;corner<4;corner++){
        float x=next.x+(corner&1?next.w:0),y=next.y+(corner&2?next.h:0);
        lo=fminf(lo,fminf(r2d_world_floor_height(&next,x,y),r2d_world_floor_height(&w->spans[index],x,y)));
        hi=fmaxf(hi,fmaxf(r2d_world_ceiling_height(&next,x,y),r2d_world_ceiling_height(&w->spans[index],x,y)));
    }
    w->spans[index]=next;w->geometry_revision++;
    r2d_world_light_invalidate_box(w,next.x,next.y,lo,next.x+next.w,next.y+next.h,hi);return true;
}

static bool number(const R2dJson *obj,const char *key,float *value)
{
    const R2dJson *v=r2d_json_get(obj,key);
    if(!v||v->type!=R2D_JSON_NUM||!isfinite(v->number)||fabs(v->number)>1000000)return false;
    *value=(float)v->number;return true;
}
static bool integer(const R2dJson *obj,const char *key,int *value)
{
    float f;if(!number(obj,key,&f)||f<0||f>WORLD_LIMIT||floorf(f)!=f)return false;
    *value=(int)f;return true;
}
static bool pair(const R2dJson *obj,const char *key,float *x,float *y)
{
    const R2dJson *v=r2d_json_get(obj,key);if(!v||v->type!=R2D_JSON_ARR||v->count!=2)return false;
    for(int i=0;i<2;i++){const R2dJson *n=v->items[i];if(n->type!=R2D_JSON_NUM||!isfinite(n->number)||fabs(n->number)>1000000)return false;}
    *x=(float)v->items[0]->number;*y=(float)v->items[1]->number;return true;
}
static bool color(const R2dJson *obj,const char *key,uint32_t *out)
{
    const R2dJson *v=r2d_json_get(obj,key);*out=0xffffffff;if(!v)return true;
    if(v->type!=R2D_JSON_STR||strlen(v->string)!=7||v->string[0]!='#')return false;
    uint32_t rgb=0;
    for(int i=1;i<7;i++){char c=v->string[i];int n=c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;if(n<0)return false;rgb=(rgb<<4)|(unsigned)n;}
    *out=0xff000000|((rgb>>16)&255)|(rgb&0xff00)|((rgb&255)<<16);return true;
}
static bool slope(const R2dJson *o,const char *key,float *a,float *b)
{const R2dJson *v=r2d_json_get(o,key);*a=*b=0;return !v||(v->type==R2D_JSON_OBJ&&number(v,"a",a)&&number(v,"b",b));}
bool r2d_world_load_json(R2DRe2dWorld *w,const char *text,char *err,size_t size)
{
    if(!w||!text)return error(err,size,"missing world JSON",-1);
    R2dJson *root=r2d_json_parse(text,err,size);if(!root)return false;
    const R2dJson *baked=r2d_json_get(root,"baked");
    if(baked){int version=0;bool loaded=integer(root,"version",&version)&&version==1&&r2d_world_load_baked(w,baked,err,size);if(version!=1)error(err,size,"incompatible compiled world version",version);r2d_json_free(root);return loaded;}
    bool ok=false;R2DWorldWall *walls=NULL;R2DWorldSpan *spans=NULL;
    R2DWorldCell *cells=NULL;R2DWorldPortal *portals=NULL;R2DWorldOpening *opens=NULL;
    int version=0,ns=0,no=0;
    const R2dJson *cs=r2d_json_get(root,"cells"),*ws=r2d_json_get(root,"walls"),*ps=r2d_json_get(root,"portals");
    if(root->type!=R2D_JSON_OBJ||!integer(root,"version",&version)||version!=1||!cs||cs->type!=R2D_JSON_ARR||
        !ws||ws->type!=R2D_JSON_ARR||!ps||ps->type!=R2D_JSON_ARR||cs->count>WORLD_LIMIT||ws->count>WORLD_LIMIT||ps->count>WORLD_LIMIT){error(err,size,"expected version 1 cells/walls/portals",-1);goto done;}
    for(int i=0;i<cs->count;i++) {
        const R2dJson *s=r2d_json_get(cs->items[i],"spans");
        if(!s||s->type!=R2D_JSON_ARR||s->count<1||s->count>WORLD_LIMIT-ns){error(err,size,"invalid cell spans",i);goto done;}ns+=s->count;
    }
    for(int i=0;i<ps->count;i++) {
        const R2dJson *s=r2d_json_get(ps->items[i],"openings");
        if(!s||s->type!=R2D_JSON_ARR||s->count<1||s->count>WORLD_LIMIT-no){error(err,size,"invalid portal openings",i);goto done;}no+=s->count;
    }
#define GET_ALLOC(ptr,count) do {ptr=calloc((size_t)((count)?(count):1),sizeof *ptr);if(!ptr){error(err,size,"out of memory",-1);goto done;}}while(0)
    GET_ALLOC(walls,ws->count);GET_ALLOC(cells,cs->count);GET_ALLOC(spans,ns);GET_ALLOC(portals,ps->count);GET_ALLOC(opens,no);
#undef GET_ALLOC
    for(int i=0;i<ws->count;i++) {
        const R2dJson *o=ws->items[i];R2DWorldWall *s=&walls[i];
        if(!pair(o,"from",&s->x1,&s->y1)||!pair(o,"to",&s->x2,&s->y2)||!number(o,"bottom",&s->bottom)||!number(o,"top",&s->top)||!color(o,"color",&s->color)){error(err,size,"invalid wall fields",i);goto done;}
    }
    int span=0,opening=0;
    for(int i=0;i<cs->count;i++) {
        const R2dJson *o=cs->items[i],*ss=r2d_json_get(o,"spans");R2DWorldCell *c=&cells[i];
        if(!number(o,"x",&c->x)||!number(o,"y",&c->y)||!number(o,"w",&c->w)||!number(o,"h",&c->h)){error(err,size,"invalid cell fields",i);goto done;}
        c->first_span=span;c->span_count=ss->count;
        for(int j=0;j<ss->count;j++) {
            R2DWorldSpan *s=&spans[span++];s->x=c->x;s->y=c->y;s->w=c->w;s->h=c->h;
            if(!number(ss->items[j],"bottom",&s->bottom)||!number(ss->items[j],"top",&s->top)||!color(ss->items[j],"floorColor",&s->floor_color)||!color(ss->items[j],"ceilingColor",&s->ceiling_color)||!slope(ss->items[j],"floorSlope",&s->floor_a,&s->floor_b)||!slope(ss->items[j],"ceilingSlope",&s->ceiling_a,&s->ceiling_b)){error(err,size,"invalid span fields",span-1);goto done;}
        }
    }
    for(int i=0;i<ps->count;i++) {
        const R2dJson *o=ps->items[i],*ss=r2d_json_get(o,"openings"),*closed=r2d_json_get(o,"closed");R2DWorldPortal *p=&portals[i];
        if(!integer(o,"cellA",&p->cell_a)||!integer(o,"cellB",&p->cell_b)||!pair(o,"from",&p->ax,&p->ay)||!pair(o,"to",&p->bx,&p->by)||(closed&&closed->type!=R2D_JSON_BOOL)){error(err,size,"invalid portal fields",i);goto done;}
        p->closed=closed&&closed->boolean;p->first_opening=opening;p->opening_count=ss->count;
        for(int j=0;j<ss->count;j++) {
            R2DWorldOpening *s=&opens[opening++];
            if(!number(ss->items[j],"bottom",&s->bottom)||!number(ss->items[j],"top",&s->top)){error(err,size,"invalid opening fields",opening-1);goto done;}
        }
    }
    R2DRe2dWorld next={0};
    ok=r2d_world_build_cells(&next,walls,ws->count,spans,ns,cells,cs->count,portals,ps->count,opens,no,err,size);
    if(ok){int span=0;for(int i=0;i<cs->count&&ok;i++){const R2dJson *ss=r2d_json_get(cs->items[i],"spans");for(int j=0;j<ss->count;j++,span++){
        const R2dJson *lighting=r2d_json_get(ss->items[j],"lighting");if(lighting){R2DWorldSpanLight light;if(!r2d_world_span_light_json(lighting,&light)||!r2d_world_set_span_light(&next,span,&light)){error(err,size,"invalid span lighting",span);ok=false;break;}}
    }}}
    if(ok)ok=r2d_world_load_lighting(&next,root,err,size);
    if(ok){next.topology_revision=w->topology_revision+1;r2d_world_free(w);*w=next;}else r2d_world_free(&next);
done:
    free(walls);free(spans);free(cells);free(portals);free(opens);r2d_json_free(root);return ok;
}
