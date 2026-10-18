#include "re2d_world.h"
#include "re2d_world_hint.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <float.h>
void r2d_world_visibility_free(R2DWorldVisibility *f)
{
    if(!f)return;
    free(f->spans);free(f->surfaces);free(f->queue);free(f->span_seen);free(f->surface_seen);free(f->queued);free(f->windows);free(f->surface_windows);free(f->node_parents);free(f->cell_nodes);free(f->node_active);free(f->cell_filter);memset(f,0,sizeof *f);
}
// Index immutable BSP ownership once, never scan the full tree each frame.
static bool index_bsp(const R2DRe2dWorld *w,R2DWorldVisibility *f)
{
    if(!w->cell_node_count)return true;
    if(f->capacity_nodes<w->cell_node_count||f->capacity_cells<w->cell_count){
        int *parents=malloc((size_t)w->cell_node_count*sizeof(int));
        int *cells=malloc((size_t)w->cell_count*sizeof(int));
        uint8_t *active=calloc((size_t)w->cell_node_count,1);
        if(!parents||!cells||!active){free(parents);free(cells);free(active);return false;}
        free(f->node_parents);free(f->cell_nodes);free(f->node_active);
        f->node_parents=parents;f->cell_nodes=cells;f->node_active=active;
        f->capacity_nodes=w->cell_node_count;f->capacity_cells=w->cell_count;f->indexed_nodes=NULL;
    }
    if(f->indexed_nodes!=w->cell_nodes||f->indexed_revision!=w->topology_revision){
        memset(f->node_active,0,(size_t)w->cell_node_count);
        for(int i=0;i<w->cell_node_count;i++)f->node_parents[i]=-1;
        for(int i=0;i<w->cell_count;i++)f->cell_nodes[i]=-1;
        for(int i=0;i<w->cell_node_count;i++){
            const R2DWorldCellNode *n=&w->cell_nodes[i];
            if(n->front>=0)f->node_parents[n->front]=i;
            if(n->back>=0)f->node_parents[n->back]=i;
            for(int j=0;j<n->ref_count;j++)f->cell_nodes[w->cell_refs[n->first_ref+j]]=i;
        }
        f->indexed_nodes=w->cell_nodes;f->indexed_revision=w->topology_revision;
    }
    return true;
}
static void bsp_visible_order(const R2DRe2dWorld *w,const R2DRe2dView *v,R2DWorldVisibility *f,
                              const uint8_t *cell_allowed,int node)
{
    if(node<0||!f->node_active[node])return;
    f->node_active[node]=0;
    f->bsp_nodes_visited++;
    const R2DWorldCellNode *n=&w->cell_nodes[node];
    bool front=(n->axis?v->y:v->x)>=n->split;
    bsp_visible_order(w,v,f,cell_allowed,front?n->front:n->back);
    for(int i=0;i<n->ref_count;i++){
        const int cell_index=w->cell_refs[n->first_ref+i];
        if((cell_allowed&&(cell_index<0||cell_index>=w->cell_count||!cell_allowed[cell_index]))||
           (f->cell_filter&&cell_index>=0&&cell_index<w->cell_count&&f->cell_filter[cell_index])){
            f->culled_cells++;f->cell_rejections++;continue;
        }
        const R2DWorldCell *c=&w->cells[cell_index];
        for(int j=0;j<c->span_count;j++){
            int span=c->first_span+j;
            if(f->span_seen[span])f->spans[f->span_count++]=span;
        }
    }
    bsp_visible_order(w,v,f,cell_allowed,front?n->back:n->front);
}
static bool reserve(R2DWorldVisibility *f,int ns,int nf,int nc)
{
    if(ns<=f->capacity_spans&&nf<=f->capacity_surfaces&&nc<=f->capacity_filter_cells&&f->span_seen&&f->surface_seen&&f->cell_filter)return true;
    R2DWorldVisibility n={0};n.capacity_spans=ns;n.capacity_surfaces=nf;n.capacity_filter_cells=nc;
#define A(field,count) do {n.field=calloc((size_t)((count)?(count):1),sizeof *n.field);if(!n.field){r2d_world_visibility_free(&n);return false;}}while(0)
    A(spans,ns);A(queue,ns);A(span_seen,ns);A(queued,ns);A(windows,ns);A(surface_windows,nf);A(surfaces,nf);A(surface_seen,nf);A(cell_filter,nc);
#undef A
    r2d_world_visibility_free(f);*f=n;return true;
}
static bool intersection(R2DWorldWindow a,R2DWorldWindow b,R2DWorldWindow *out)
{
    *out=(R2DWorldWindow){fmaxf(a.left,b.left),fmaxf(a.top,b.top),fminf(a.right,b.right),fminf(a.bottom,b.bottom)};
    return out->left<out->right&&out->top<out->bottom;
}
// Project and near-clip a vertical portal quad in the existing camera convention.
bool r2d_world_portal_window(const R2DRe2dView *v,float ortho,const R2DWorldPortal *p,const R2DWorldOpening *o,R2DWorldWindow *out)
{
    // Camera on the portal plane: the aperture projects to a line, so the
    // near-plane clip below can drop the whole portal (all corners end up at or
    // behind the near plane). The camera is physically standing in the
    // aperture, so the conservative window is the full view. This keeps spawns
    // exactly on a cell/portal boundary from collapsing visibility to one cell.
    {
        float px=p->bx-p->ax,py=p->by-p->ay,length=sqrtf(px*px+py*py);
        if(length>1e-6f){
            float distance=fabsf((v->x-p->ax)*py-(v->y-p->ay)*px)/length;
            if(distance<=1e-4f){*out=(R2DWorldWindow){0,0,v->width,v->height};return true;}
        }
    }
    float points[4][3]={{p->ax,p->ay,o->bottom},{p->bx,p->by,o->bottom},{p->bx,p->by,o->top},{p->ax,p->ay,o->top}},camera[4][3],clipped[8][3];int count=0;
    for(int i=0;i<4;i++) {
        float dx=points[i][0]-v->x,dy=points[i][1]-v->y,h=points[i][2]-v->eye,f=dx*v->cos_yaw+dy*v->sin_yaw;
        camera[i][0]=-dx*v->sin_yaw+dy*v->cos_yaw;camera[i][1]=h*v->cos_pitch-f*v->sin_pitch;camera[i][2]=f*v->cos_pitch+h*v->sin_pitch;
    }
    for(int i=0;i<4;i++) {
        float *a=camera[i],*b=camera[(i+1)%4];bool ai=a[2]>=v->near_plane,bi=b[2]>=v->near_plane;
        if(ai)memcpy(clipped[count++],a,3*sizeof(float));
        if(ai!=bi){float t=(v->near_plane-a[2])/(b[2]-a[2]);for(int k=0;k<3;k++)clipped[count][k]=a[k]+t*(b[k]-a[k]);count++;}
    }
    if(!count)return false;
    *out=(R2DWorldWindow){FLT_MAX,FLT_MAX,-FLT_MAX,-FLT_MAX};
    for(int i=0;i<count;i++) {
        float scale=ortho>0?v->height/ortho:v->focal/clipped[i][2];
        float x=v->width/2+clipped[i][0]*scale,y=v->height/2-clipped[i][1]*scale;
        out->left=fminf(out->left,x-1);out->right=fmaxf(out->right,x+1);out->top=fminf(out->top,y-1);out->bottom=fmaxf(out->bottom,y+1);
    }
    return true;
}
bool r2d_world_visibility_filtered_ex(const R2DRe2dWorld *w,const R2DRe2dView *v,float ortho,
                                      R2DWorldVisibility *f,const uint8_t *cell_allowed,
                                      const struct R2DWorldHintCache *hints)
{
    if(!w||!v||!f||!isfinite(v->x)||!isfinite(v->y)||!isfinite(v->eye)||v->width<=0||v->height<=0||!reserve(f,w->span_count,w->surface_count,w->cell_count))return false;
    memset(f->span_seen,0,(size_t)w->span_count);memset(f->surface_seen,0,(size_t)w->surface_count);memset(f->queued,0,(size_t)w->span_count);
    memset(f->cell_filter,0,(size_t)w->cell_count);
    f->span_count=f->surface_count=f->portals_tested=f->cells_visible=f->bsp_nodes_visited=0;
    f->culled_regions=f->culled_cells=f->cell_rejections=0;
    f->hint_markers=f->skip_markers=f->occluder_segments=0;
    f->hint_portals_tested=f->hint_portals_cut=0;
    f->occluder_cells_tested=f->occluder_cells_cut=0;
    if(hints&&hints->world==w&&!r2d_world_hint_rebuild_needed(hints,w)){
        f->hint_markers=hints->hint_markers;
        f->skip_markers=hints->skip_markers;
        f->occluder_segments=hints->occluder_count;
        if(hints->occluder_count>0){
            for(int i=0;i<w->cell_count;i++){
                const R2DWorldCell *c=&w->cells[i];
                f->occluder_cells_tested++;
                if(r2d_world_hint_cell_occluded(hints,c->x,c->y,c->w,c->h,v->x,v->y)){
                    f->cell_filter[i]=1;f->occluder_cells_cut++;
                }
            }
        }
    }
    R2DWorldWindow full={0,0,v->width,v->height};int start=r2d_world_span_at(w,v->x,v->y,v->eye);
    if(cell_allowed&&start>=0&&(w->span_cells[start]<0||w->span_cells[start]>=w->cell_count||!cell_allowed[w->span_cells[start]]))start=-1;
    // Orthographic rays originate across the view plane, not at the camera XY.
    // Use all spans until an orthographic seed-volume traversal exists.
    if(start<0||ortho>0) {
        for(int i=0;i<w->span_count;i++){
            const int cell=w->span_cells?w->span_cells[i]:-1;
            if((cell_allowed&&(cell<0||cell>=w->cell_count||!cell_allowed[cell]))||
               (f->cell_filter&&cell>=0&&cell<w->cell_count&&f->cell_filter[cell])){f->culled_cells++;f->cell_rejections++;continue;}
            f->span_seen[i]=1;f->windows[i]=full;f->spans[f->span_count++]=i;
        }
    } else {
        int head=0,tail=0,pending=1;f->queue[tail++]=start;tail%=w->span_count;f->queued[start]=1;f->span_seen[start]=1;f->windows[start]=full;f->spans[f->span_count++]=start;
        while(pending) {
            int span=f->queue[head++];head%=w->span_count;pending--;f->queued[span]=0;
            int cell=w->span_cells[span];const R2DWorldSpan *from=&w->spans[span];
            for(int pi=w->cell_portal_offsets[cell];pi<w->cell_portal_offsets[cell+1];pi++) {
                int i=w->cell_portal_refs[pi];const R2DWorldPortal *p=&w->portals[i];if(p->closed||p->sky||p->mirror||(p->cell_a!=cell&&p->cell_b!=cell))continue;
                if(hints){f->hint_portals_tested++;if(r2d_world_hint_portal_blocked(hints,w,p)){f->hint_portals_cut++;continue;}}
                else if(r2d_world_hint_portal_blocked(NULL,w,p))continue;
                f->portals_tested++;int other=p->cell_a==cell?p->cell_b:p->cell_a;
                if((cell_allowed&&(other<0||other>=w->cell_count||!cell_allowed[other]))||
                   (f->cell_filter&&other>=0&&other<w->cell_count&&f->cell_filter[other])){f->culled_cells++;f->cell_rejections++;continue;}
                const R2DWorldCell *to=&w->cells[other];
                for(int j=0;j<p->opening_count;j++) {
                    const R2DWorldOpening *o=&w->openings[p->first_opening+j];
                    for(int k=0;k<to->span_count;k++) {
                        int dest=to->first_span+k;const R2DWorldSpan *s=&w->spans[dest];R2DWorldOpening clipped;
                        if(!r2d_world_opening_between(from,s,p,o,&clipped))continue;
                        R2DWorldWindow projected,window;if(!r2d_world_portal_window(v,ortho,p,&clipped,&projected)||!intersection(f->windows[span],projected,&window))continue;
                        R2DWorldWindow old=f->windows[dest],merged=window;
                        if(f->span_seen[dest])merged=(R2DWorldWindow){fminf(old.left,window.left),fminf(old.top,window.top),fmaxf(old.right,window.right),fmaxf(old.bottom,window.bottom)};
                        bool changed=!f->span_seen[dest]||merged.left!=old.left||merged.top!=old.top||merged.right!=old.right||merged.bottom!=old.bottom;
                        if(changed){f->windows[dest]=merged;if(!f->span_seen[dest])f->spans[f->span_count++]=dest;f->span_seen[dest]=1;if(!f->queued[dest]){f->queue[tail++]=dest;tail%=w->span_count;pending++;f->queued[dest]=1;}}
                    }
                }
            }
        }

    }
    // Portal windows determine reachability. Walk only their marked BSP branches,
    // near side first, to produce native surface submission order.
    if(w->cell_node_count){
        if(!index_bsp(w,f))return false;
        for(int i=0;i<f->span_count;i++){
            int node=f->cell_nodes[w->span_cells[f->spans[i]]];
            while(node>=0&&!f->node_active[node]){f->node_active[node]=1;node=f->node_parents[node];}
        }
        f->span_count=0;bsp_visible_order(w,v,f,cell_allowed,w->cell_root);
    }
    // Count each reached cell once, without scanning all authored cells.
    memset(f->queued,0,(size_t)w->span_count);
    for(int j=0;j<f->span_count;j++) {
        int span=f->spans[j],cell=w->span_cells[span],first=w->cells[cell].first_span;
        if(!f->queued[first]){f->queued[first]=1;f->cells_visible++;}
        int plane=w->wall_count+span*2;
        for(int k=0;k<2;k++){f->surface_seen[plane+k]=1;f->surface_windows[plane+k]=f->windows[span];f->surfaces[f->surface_count++]=plane+k;}
        for(int k=w->span_wall_offsets[span];k<w->span_wall_offsets[span+1];k++) {
            int wall=w->span_wall_refs[k];
            if(!r2d_world_wall_renders(&w->walls[wall]))continue;
            if(!r2d_world_wall_solid(w,wall,w->walls[wall].bottom,w->walls[wall].top))continue;
            R2DWorldWindow window=f->windows[span];
            if(!f->surface_seen[wall]){f->surface_seen[wall]=1;f->surface_windows[wall]=window;f->surfaces[f->surface_count++]=wall;}
            else {R2DWorldWindow old=f->surface_windows[wall];f->surface_windows[wall]=(R2DWorldWindow){fminf(old.left,window.left),fminf(old.top,window.top),fmaxf(old.right,window.right),fmaxf(old.bottom,window.bottom)};}
        }
    }
    if(start<0||ortho>0)for(int wall=0;wall<w->wall_count;wall++) {
        if(!r2d_world_wall_renders(&w->walls[wall]))continue;
        if(!r2d_world_wall_solid(w,wall,w->walls[wall].bottom,w->walls[wall].top))continue;
        if(!f->surface_seen[wall]){f->surface_seen[wall]=1;f->surface_windows[wall]=full;f->surfaces[f->surface_count++]=wall;}
    }
    return true;
}

bool r2d_world_visibility_filtered(const R2DRe2dWorld *w,const R2DRe2dView *v,float ortho,
                                   R2DWorldVisibility *f,const uint8_t *cell_allowed)
{
    return r2d_world_visibility_filtered_ex(w,v,ortho,f,cell_allowed,NULL);
}

bool r2d_world_visibility(const R2DRe2dWorld *w,const R2DRe2dView *v,float ortho,R2DWorldVisibility *f)
{
    return r2d_world_visibility_filtered_ex(w,v,ortho,f,NULL,NULL);
}
