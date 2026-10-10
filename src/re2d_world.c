#include "re2d_world.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <float.h>

static bool finite6(float a,float b,float c,float d,float e,float f)
{ return isfinite(a)&&isfinite(b)&&isfinite(c)&&isfinite(d)&&isfinite(e)&&isfinite(f); }
float r2d_world_floor_height(const R2DWorldSpan *s,float x,float y)
{ return s->bottom+s->floor_a*(x-s->x)+s->floor_b*(y-s->y); }
float r2d_world_ceiling_height(const R2DWorldSpan *s,float x,float y)
{ return s->top+s->ceiling_a*(x-s->x)+s->ceiling_b*(y-s->y); }
bool r2d_world_span_opening(const R2DWorldSpan *s,const R2DWorldPortal *p,const R2DWorldOpening *o)
{
    return o->bottom>=fmaxf(r2d_world_floor_height(s,p->ax,p->ay),r2d_world_floor_height(s,p->bx,p->by))&&
        o->top<=fminf(r2d_world_ceiling_height(s,p->ax,p->ay),r2d_world_ceiling_height(s,p->bx,p->by));
}
void r2d_world_span_height_bounds(const R2DWorldSpan *s,float *low,float *high)
{
    *low=INFINITY;*high=-INFINITY;for(int c=0;c<4;c++){float x=s->x+(c&1?s->w:0),y=s->y+(c&2?s->h:0);*low=fminf(*low,r2d_world_floor_height(s,x,y));*high=fmaxf(*high,r2d_world_ceiling_height(s,x,y));}
}
void r2d_world_free(R2DRe2dWorld *w)
{ if (!w) return; free(w->sort_items);free(w->transparent_ids);free(w->surface_sky);free(w->sky.pixels);r2d_bsp_free(&w->bsp); free(w->walls);free(w->spans);free(w->cells);free(w->portals);free(w->openings);free(w->surfaces);free(w->cell_nodes);free(w->span_cells);free(w->wall_portals);free(w->wall_openings);free(w->opening_spans_a);free(w->opening_spans_b);free(w->cell_refs);free(w->span_wall_offsets);free(w->span_wall_refs);free(w->cell_portal_offsets);free(w->cell_portal_refs);free(w->surface_materials);for(int i=0;i<R2D_WORLD_MAX_MATERIALS;i++)r2d_world_material_free(&w->materials[i]);r2d_world_light_free(w);memset(w,0,sizeof *w);w->bsp.root=-1; }
bool r2d_world_build(R2DRe2dWorld *w,const R2DWorldWall *walls,int nw,const R2DWorldSpan *spans,int ns)
{
    if (!w || nw<0 || ns<0 || nw>65536 || ns>65536 || (nw&&!walls) || (ns&&!spans)) return false;
    for (int i=0;i<nw;i++) {
        const R2DWorldWall *s=&walls[i];
        if (!finite6(s->x1,s->y1,s->x2,s->y2,s->bottom,s->top) || s->top<=s->bottom ||
            (s->x1==s->x2 && s->y1==s->y2)) return false;
    }
    for (int i=0;i<ns;i++) {
        const R2DWorldSpan *s=&spans[i];
        if (!finite6(s->x,s->y,s->w,s->h,s->bottom,s->top) || s->w<=0 || s->h<=0 || s->top<=s->bottom ||
            !isfinite(s->x+s->w) || !isfinite(s->y+s->h)||!isfinite(s->floor_a)||!isfinite(s->floor_b)||!isfinite(s->ceiling_a)||!isfinite(s->ceiling_b)) return false;
        for(int corner=0;corner<4;corner++) {
            float x=s->x+(corner&1?s->w:0),y=s->y+(corner&2?s->h:0),floor=r2d_world_floor_height(s,x,y),ceiling=r2d_world_ceiling_height(s,x,y);
            if(!isfinite(floor)||!isfinite(ceiling)||ceiling<=floor)return false;
        }
        // Free intervals may share XY, but cannot overlap in height there.
        for (int j=0;j<i;j++) {
            const R2DWorldSpan *p=&spans[j];
            float lo_x=fmaxf(s->x,p->x),lo_y=fmaxf(s->y,p->y),hi_x=fminf(s->x+s->w,p->x+p->w),hi_y=fminf(s->y+s->h,p->y+p->h);
            if(lo_x<hi_x&&lo_y<hi_y) {
                bool s_above=true,p_above=true;
                for(int corner=0;corner<4;corner++){float x=corner&1?hi_x:lo_x,y=corner&2?hi_y:lo_y;
                    if(r2d_world_floor_height(s,x,y)<r2d_world_ceiling_height(p,x,y))s_above=false;
                    if(r2d_world_floor_height(p,x,y)<r2d_world_ceiling_height(s,x,y))p_above=false;}
                if(!s_above&&!p_above)return false;
            }
        }
    }
    R2DRe2dWorld next={0};next.bsp.root=-1;
    next.walls=nw ? malloc((size_t)nw*sizeof *walls):NULL;
    next.spans=ns ? malloc((size_t)ns*sizeof *spans):NULL;
    float *lines=nw ? malloc((size_t)nw*5*sizeof(float)):NULL;
    if ((nw&&(!next.walls||!lines)) || (ns&&!next.spans)) goto fail;
    if(nw) memcpy(next.walls,walls,(size_t)nw*sizeof *walls);
    if(ns) memcpy(next.spans,spans,(size_t)ns*sizeof *spans);
    for (int i=0;i<nw;i++) {
        lines[i*5]=walls[i].x1;lines[i*5+1]=walls[i].y1;
        lines[i*5+2]=walls[i].x2;lines[i*5+3]=walls[i].y2;lines[i*5+4]=(float)i;
    }
    if (nw&&!r2d_bsp_build(&next.bsp,lines,nw)) goto fail;
    free(lines);next.wall_count=nw;next.span_count=ns;r2d_world_free(w);*w=next;return true;
fail:
    free(lines);r2d_world_free(&next);return false;
}
static bool inside(const R2DWorldSpan *s,float x,float y)
{ return x>=s->x && x<=s->x+s->w && y>=s->y && y<=s->y+s->h; }
int r2d_world_support(const R2DRe2dWorld *w,float x,float y,float feet,float height,float step)
{
    if(!w || !finite6(x,y,feet,height,step,0) || height<=0 || step<0)return -1;
    int best=-1,cell=w->cell_count?r2d_world_cell_at(w,x,y):-1;float best_height=-INFINITY;
    for(int i=0;i<w->span_count;i++) {
        const R2DWorldSpan *s=&w->spans[i];if(w->cell_count&&w->span_cells[i]!=cell)continue;
        float floor=r2d_world_floor_height(s,x,y),ceiling=r2d_world_ceiling_height(s,x,y);
        if(inside(s,x,y)&&floor<=feet+step&&ceiling-floor>=height&&feet<ceiling&&floor>best_height){best=i;best_height=floor;}
    }
    return best;
}

bool r2d_world_blocked(const R2DRe2dWorld *w,float x,float y,float radius,float bottom,float top)
{
    if(!w || !finite6(x,y,radius,bottom,top,0) || radius<0 || top<=bottom) return true;
    for(int i=0;i<w->wall_count;i++) {
        const R2DWorldWall *s=&w->walls[i];
        if(!r2d_world_wall_solid(w,i,bottom,top))continue;
        if(bottom>=s->top || top<=s->bottom) continue;
        float dx=s->x2-s->x1,dy=s->y2-s->y1;
        float t=((x-s->x1)*dx+(y-s->y1)*dy)/(dx*dx+dy*dy);
        t=fmaxf(0,fminf(1,t));dx=x-s->x1-t*dx;dy=y-s->y1-t*dy;
        if(dx*dx+dy*dy<=radius*radius) return true;
    }
    return false;
}
static float cross(float ax,float ay,float bx,float by) {return ax*by-ay*bx;}
static void wall_hit(const R2DRe2dWorld *w,int index,const float o[3],const float d[3],float lo,R2DWorldHit *hit)
{
    const R2DSegment *s=&w->bsp.segments[index];const R2DWorldWall *wall=&w->walls[s->user];
    float sx=s->x2-s->x1,sy=s->y2-s->y1,den=cross(d[0],d[1],sx,sy);
    if(fabsf(den)<1e-8f) return;
    float ax=s->x1-o[0],ay=s->y1-o[1];
    float t=cross(ax,ay,sx,sy)/den,u=cross(ax,ay,d[0],d[1])/den;
    float z=o[2]+t*d[2];
    if(t<lo || t>hit->t || u<0 || u>1 || z<wall->bottom || z>wall->top||!r2d_world_wall_solid(w,s->user,z,z)) return;
    *hit=(R2DWorldHit){t,o[0]+t*d[0],o[1]+t*d[1],z,s->user,-1,false,wall->color};
}
static void ray_node(const R2DRe2dWorld *w,int node,const float o[3],const float d[3],float lo,R2DWorldHit *hit)
{
    if(node<0) return;
    const R2DBspNode *n=&w->bsp.nodes[node];const R2DSegment *s=&w->bsp.segments[n->splitter];
    float sx=s->x2-s->x1,sy=s->y2-s->y1;
    float a=cross(sx,sy,o[0]+lo*d[0]-s->x1,o[1]+lo*d[1]-s->y1);
    float b=cross(sx,sy,o[0]+hit->t*d[0]-s->x1,o[1]+hit->t*d[1]-s->y1);
    wall_hit(w,n->splitter,o,d,lo,hit);
    // The depth-limit tail has no spatial partition guarantee; test all of it.
    for(int i=0;i<n->leftover_count;i++) wall_hit(w,n->leftover_first+i,o,d,lo,hit);
    if(a>=0 || b>=0) ray_node(w,n->front,o,d,lo,hit);
    if(a<=0 || b<=0) ray_node(w,n->back,o,d,lo,hit);
}
static void primitive_wall_hit(const R2DRe2dWorld *w,int index,const float o[3],const float d[3],float lo,R2DWorldHit *hit)
{
    const R2DWorldWall *s=&w->walls[index];
    float sx=s->x2-s->x1,sy=s->y2-s->y1,den=cross(d[0],d[1],sx,sy);if(fabsf(den)<1e-8f)return;
    float ax=s->x1-o[0],ay=s->y1-o[1],t=cross(ax,ay,sx,sy)/den,u=cross(ax,ay,d[0],d[1])/den,z=o[2]+t*d[2];
    if(t<lo||t>hit->t||u<0||u>1||z<s->bottom||z>s->top||!r2d_world_wall_solid(w,index,z,z))return;
    *hit=(R2DWorldHit){t,o[0]+t*d[0],o[1]+t*d[1],z,index,-1,false,s->color};
}
static bool ray_cell_bounds(const R2DWorldCell *c,const float o[3],const float d[3],float lo,float hi)
{
    const float minimum[2]={c->x,c->y},maximum[2]={c->x+c->w,c->y+c->h};
    for(int axis=0;axis<2;axis++) {
        if(fabsf(d[axis])<1e-12f){if(o[axis]<minimum[axis]||o[axis]>maximum[axis])return false;}
        else {float a=(minimum[axis]-o[axis])/d[axis],b=(maximum[axis]-o[axis])/d[axis];lo=fmaxf(lo,fminf(a,b));hi=fminf(hi,fmaxf(a,b));if(lo>hi)return false;}
    }
    return true;
}
static void cell_ray_planes(const R2DRe2dWorld *w,int cell,const float o[3],const float d[3],float lo,R2DWorldHit *hit)
{
    const R2DWorldCell *c=&w->cells[cell];if(!ray_cell_bounds(c,o,d,lo,hit->t))return;
    int first=c->first_span;
    for(int k=w->span_wall_offsets[first];k<w->span_wall_offsets[first+1];k++)primitive_wall_hit(w,w->span_wall_refs[k],o,d,lo,hit);
    for(int j=0;j<c->span_count;j++) {
        int i=c->first_span+j;const R2DWorldSpan *s=&w->spans[i];
        for(int ceiling=0;ceiling<2;ceiling++) {
            float a=ceiling?s->ceiling_a:s->floor_a,b=ceiling?s->ceiling_b:s->floor_b,den=d[2]-a*d[0]-b*d[1];if(fabsf(den)<=1e-8f)continue;
            float plane=ceiling?r2d_world_ceiling_height(s,o[0],o[1]):r2d_world_floor_height(s,o[0],o[1]);
            float t=(plane-o[2])/den,x=o[0]+t*d[0],y=o[1]+t*d[1];if(t<lo||t>hit->t||!inside(s,x,y))continue;
            *hit=(R2DWorldHit){t,x,y,o[2]+t*d[2],-1,i,ceiling!=0,ceiling?s->ceiling_color:s->floor_color};
        }
    }
}
static void cell_ray_node(const R2DRe2dWorld *w,int node,const float o[3],const float d[3],float lo,R2DWorldHit *hit)
{
    if(node<0)return;
    const R2DWorldCellNode *n=&w->cell_nodes[node];
    for(int i=0;i<n->ref_count;i++)cell_ray_planes(w,w->cell_refs[n->first_ref+i],o,d,lo,hit);
    float a=o[n->axis]+lo*d[n->axis]-n->split,b=o[n->axis]+hit->t*d[n->axis]-n->split;
    bool front=a>=0;
    if(front?(a>=0||b>=0):(a<=0||b<=0))cell_ray_node(w,front?n->front:n->back,o,d,lo,hit);
    b=o[n->axis]+hit->t*d[n->axis]-n->split;
    if(front?(a<=0||b<=0):(a>=0||b>=0))cell_ray_node(w,front?n->back:n->front,o,d,lo,hit);
}
bool r2d_world_ray(const R2DRe2dWorld *w,const float o[3],const float d[3],float lo,float hi,R2DWorldHit *hit)
{
    if(!w||!o||!d||!hit||!finite6(o[0],o[1],o[2],d[0],d[1],d[2])||!isfinite(lo)||!isfinite(hi)||lo<0||hi<lo) return false;
    *hit=(R2DWorldHit){.t=hi,.wall=-1,.span=-1};
    // Interior rays use XY cell candidates instead of the legacy BSP depth-limit tail.
    // Outside/void origins retain the complete unbounded legacy query.
    if(w->cell_rays_complete&&r2d_world_span_at(w,o[0],o[1],o[2])>=0) {
        cell_ray_node(w,w->cell_root,o,d,lo,hit);return hit->wall>=0||hit->span>=0;
    }
    if(w->wall_count&&!w->bsp.node_count)for(int i=0;i<w->wall_count;i++)primitive_wall_hit(w,i,o,d,lo,hit);
    else ray_node(w,w->bsp.root,o,d,lo,hit);
    for(int i=0;i<w->span_count;i++) for(int ceiling=0;ceiling<2;ceiling++) {
        const R2DWorldSpan *s=&w->spans[i];float a=ceiling?s->ceiling_a:s->floor_a,b=ceiling?s->ceiling_b:s->floor_b;
        float den=d[2]-a*d[0]-b*d[1];if(fabsf(den)<=1e-8f)continue;
        float plane=ceiling?r2d_world_ceiling_height(s,o[0],o[1]):r2d_world_floor_height(s,o[0],o[1]);
        float t=(plane-o[2])/den,x=o[0]+t*d[0],y=o[1]+t*d[1],z=o[2]+t*d[2];
        if(t<lo||t>hit->t||!inside(s,x,y)) continue;
        *hit=(R2DWorldHit){t,x,y,z,-1,i,ceiling!=0,ceiling?s->ceiling_color:s->floor_color};
    }
    return hit->wall>=0||hit->span>=0;
}
// Native image synthesis over specialised planar primitives. The projected
// bounds only limit work; coverage/depth still comes from exact world equations.
typedef struct { float right,up,forward; } WorldImagePoint;
typedef struct { const R2DRe2dView *view; int width,height; float ortho;
    uint8_t *rgba;float *depth;const R2DWorldVisibility *visibility;R2DWorldPixelOwner *owners;bool translucent;const R2DWorldDecal *decal; } WorldImage;
static void image_color(WorldImage *im,int i,uint32_t color)
{ for(int c=0;c<4;c++)im->rgba[i*4+c]=(uint8_t)(color>>(c*8)); }
static void image_blend(WorldImage *im,int i,uint32_t color,int blend)
{
    float alpha=(color>>24)/255.0f;
    for(int c=0;c<3;c++){float source=(color>>(c*8))&255,dest=im->rgba[i*4+c];im->rgba[i*4+c]=(uint8_t)fminf(255,roundf(source*alpha+dest*(blend==R2D_WORLD_ADDITIVE?1:1-alpha)));}
    im->rgba[i*4+3]=255;
}
static bool image_bounds(const WorldImage *im,const float points[4][3],int out[4])
{
    const R2DRe2dView *v=im->view;WorldImagePoint a[4],b[8];int n=0;
    for(int i=0;i<4;i++) {
        float dx=points[i][0]-v->x,dy=points[i][1]-v->y,z=points[i][2]-v->eye;
        float f=dx*v->cos_yaw+dy*v->sin_yaw;
        a[i]=(WorldImagePoint){-dx*v->sin_yaw+dy*v->cos_yaw,z*v->cos_pitch-f*v->sin_pitch,f*v->cos_pitch+z*v->sin_pitch};
    }
    for(int i=0;i<4;i++) {
        WorldImagePoint p=a[i],q=a[(i+1)%4];bool pi=p.forward>=v->near_plane,qi=q.forward>=v->near_plane;
        if(pi)b[n++]=p;
        if(pi!=qi) {float t=(v->near_plane-p.forward)/(q.forward-p.forward);
            b[n++]=(WorldImagePoint){p.right+t*(q.right-p.right),p.up+t*(q.up-p.up),v->near_plane};}
    }
    if(!n)return false;
    float left=FLT_MAX,right=-FLT_MAX,top=FLT_MAX,bottom=-FLT_MAX;
    for(int i=0;i<n;i++) {
        float scale=im->ortho>0?v->height/im->ortho:v->focal/b[i].forward;
        float x=(v->width/2+b[i].right*scale)*im->width/v->width;
        float y=(v->height/2-b[i].up*scale)*im->height/v->height;
        left=fminf(left,x);right=fmaxf(right,x);top=fminf(top,y);bottom=fmaxf(bottom,y);
    }
    // One pixel margin covers floating-point projection at shared edges.
    out[0]=(int)fmaxf(0,fminf(im->width,floorf(left)-1));out[1]=(int)fmaxf(0,fminf(im->height,floorf(top)-1));
    out[2]=(int)fmaxf(0,fminf(im->width,ceilf(right)+1));out[3]=(int)fmaxf(0,fminf(im->height,ceilf(bottom)+1));
    return out[0]<out[2]&&out[1]<out[3];
}
static bool image_window(const WorldImage *im,int bounds[4],int surface)
{
    if(!im->visibility)return true;
    const R2DWorldWindow *w=&im->visibility->surface_windows[surface];
    bounds[0]=(int)fmaxf(bounds[0],fmaxf(0,floorf(w->left*im->width/im->view->width)));
    bounds[1]=(int)fmaxf(bounds[1],fmaxf(0,floorf(w->top*im->height/im->view->height)));
    bounds[2]=(int)fminf(bounds[2],fminf(im->width,ceilf(w->right*im->width/im->view->width)));
    bounds[3]=(int)fminf(bounds[3],fminf(im->height,ceilf(w->bottom*im->height/im->view->height)));
    return bounds[0]<bounds[2]&&bounds[1]<bounds[3];
}
static void image_row(const WorldImage *im,int x,int y,float o[3],float d[3],float os[2],float ds[2])
{
    const R2DRe2dView *v=im->view;
    o[0]=v->x;o[1]=v->y;o[2]=v->eye;os[0]=os[1]=ds[0]=ds[1]=0;
    if(im->ortho>0) {
        float k=im->ortho/v->height,step=v->width/im->width*k;
        float right=((x+.5f)*v->width/im->width-v->width/2)*k,up=(v->height/2-(y+.5f)*v->height/im->height)*k;
        o[0]+=-v->sin_yaw*right-v->cos_yaw*v->sin_pitch*up;o[1]+=v->cos_yaw*right-v->sin_yaw*v->sin_pitch*up;o[2]+=v->cos_pitch*up;
        d[0]=v->cos_pitch*v->cos_yaw;d[1]=v->cos_pitch*v->sin_yaw;d[2]=v->sin_pitch;
        os[0]=-v->sin_yaw*step;os[1]=v->cos_yaw*step;
    } else {
        float right=((x+.5f)*v->width/im->width-v->width/2)/v->focal,up=(v->height/2-(y+.5f)*v->height/im->height)/v->focal;
        float forward=v->cos_pitch-up*v->sin_pitch,step=v->width/im->width/v->focal;
        d[0]=forward*v->cos_yaw-right*v->sin_yaw;d[1]=forward*v->sin_yaw+right*v->cos_yaw;d[2]=v->sin_pitch+up*v->cos_pitch;
        ds[0]=-v->sin_yaw*step;ds[1]=v->cos_yaw*step;
    }
}
static void image_wall_segment(WorldImage *im,const R2DRe2dWorld *w,const R2DSegment *seg)
{
    const R2DWorldWall *wall=&w->walls[seg->user];
    int blend=r2d_world_surface_blend(w,seg->user);if(!im->decal&&(blend>=R2D_WORLD_TRANSLUCENT)!=im->translucent)return;

    if(im->visibility&&!im->visibility->surface_seen[seg->user])return;
    float points[4][3]={{seg->x1,seg->y1,wall->bottom},{seg->x2,seg->y2,wall->bottom},{seg->x2,seg->y2,wall->top},{seg->x1,seg->y1,wall->top}};
    int b[4];if(!image_bounds(im,points,b)||!image_window(im,b,seg->user))return;
    float sx=seg->x2-seg->x1,sy=seg->y2-seg->y1;
    float length=sqrtf(sx*sx+sy*sy),nx=-sy/length,ny=sx/length;
    if((im->view->x-seg->x1)*nx+(im->view->y-seg->y1)*ny<0){nx=-nx;ny=-ny;}
    for(int y=b[1];y<b[3];y++) {
        float o[3],d[3],os[2],ds[2];image_row(im,b[0],y,o,d,os,ds);
        float ax=seg->x1-o[0],ay=seg->y1-o[1];
        float den=cross(d[0],d[1],sx,sy),den_step=cross(ds[0],ds[1],sx,sy);
        float num=cross(ax,ay,sx,sy),num_step=-cross(os[0],os[1],sx,sy);
        float un=cross(ax,ay,d[0],d[1]),un_step=cross(ax,ay,ds[0],ds[1])-cross(os[0],os[1],d[0],d[1]);
        for(int x=b[0];x<b[2];x++) {
            // Derive from the row origin rather than accumulating drift.
            float k=(float)(x-b[0]),dd=den+k*den_step;if(fabsf(dd)<1e-8f)continue;
            float t=(num+k*num_step)/dd;int i=y*im->width+x;
            if(t<im->view->near_plane||t>100000||t>im->depth[i])continue;
            float u=(un+k*un_step)/dd,z=o[2]+t*d[2];
            if(u<0||u>1||z<wall->bottom||z>wall->top||!r2d_world_wall_solid(w,seg->user,z,z))continue;
            float px=o[0]+k*os[0]+t*(d[0]+k*ds[0]),py=o[1]+k*os[1]+t*(d[1]+k*ds[1]);
            int span=r2d_world_span_at(w,px+nx*.001f,py+ny*.001f,z);
            uint32_t shaded;float normal[3]={nx,ny,0},tangent[3]={sx/length,sy/length,0};
            float world_u=hypotf(px-wall->x1,py-wall->y1),world_v=z-wall->bottom;
            if(!im->decal)r2d_world_material_uv(w,seg->user,px,py,z,normal,tangent,&world_u,&world_v);
            if(im->decal){
                if(im->owners&&im->owners[i].surface!=seg->user)continue;
                if(!r2d_world_decal_color(w,im->decal,span,world_u,world_v,px,py,z,normal,tangent,t,&shaded))continue;
                image_blend(im,i,shaded,w->materials[im->decal->material].blend);continue;
            }
            if(!r2d_world_material_color(w,seg->user,span,wall->color,world_u,world_v,px,py,z,normal,tangent,t,&shaded))continue;
            if(im->translucent){image_blend(im,i,shaded,blend);continue;}
            im->depth[i]=t;image_color(im,i,shaded);if(im->owners)im->owners[i]=(R2DWorldPixelOwner){seg->user,span,-1};
        }
    }
}
static void image_wall(WorldImage *im,const R2DRe2dWorld *w,int index)
{ image_wall_segment(im,w,&w->bsp.segments[index]); }
static void image_node(WorldImage *im,const R2DRe2dWorld *w,int index)
{
    if(index<0)return;
    const R2DBspNode *n=&w->bsp.nodes[index];const R2DSegment *s=&w->bsp.segments[n->splitter];
    bool front=cross(s->x2-s->x1,s->y2-s->y1,im->view->x-s->x1,im->view->y-s->y1)>=0;
    image_node(im,w,front?n->front:n->back);image_wall(im,w,n->splitter);
    for(int i=0;i<n->leftover_count;i++)image_wall(im,w,n->leftover_first+i);
    image_node(im,w,front?n->back:n->front);
}
static void image_plane(WorldImage *im,const R2DRe2dWorld *w,int span,bool ceiling)
{
    const R2DWorldSpan *s=&w->spans[span];float a=ceiling?s->ceiling_a:s->floor_a,b=ceiling?s->ceiling_b:s->floor_b,z=ceiling?s->top:s->bottom;
    float points[4][3]={{s->x,s->y,z},{s->x+s->w,s->y,z+a*s->w},{s->x+s->w,s->y+s->h,z+a*s->w+b*s->h},{s->x,s->y+s->h,z+b*s->h}};
    int bounds[4],surface=w->wall_count+span*2+(ceiling?1:0);
    if(w->surface_sky&&w->surface_sky[surface])return;
    int blend=r2d_world_surface_blend(w,surface);if(!im->decal&&(blend>=R2D_WORLD_TRANSLUCENT)!=im->translucent)return;
    if(!image_bounds(im,points,bounds)||!image_window(im,bounds,surface))return;
    float normal_scale=(ceiling?-1:1)/sqrtf(1+a*a+b*b),nx=-a*normal_scale,ny=-b*normal_scale,nh=normal_scale;
    for(int y=bounds[1];y<bounds[3];y++) {
        float o[3],d[3],os[2],ds[2];image_row(im,bounds[0],y,o,d,os,ds);
        float numerator=z+a*(o[0]-s->x)+b*(o[1]-s->y)-o[2],den=d[2]-a*d[0]-b*d[1];
        float num_step=a*os[0]+b*os[1],den_step=-a*ds[0]-b*ds[1];
        for(int x=bounds[0];x<bounds[2];x++) {
            float k=(float)(x-bounds[0]),divisor=den+k*den_step;if(fabsf(divisor)<=1e-8f)continue;
            float t=(numerator+k*num_step)/divisor;int i=y*im->width+x;
            if(t<im->view->near_plane||t>100000||t>im->depth[i])continue;
            float px=o[0]+k*os[0]+t*(d[0]+k*ds[0]),py=o[1]+k*os[1]+t*(d[1]+k*ds[1]),height=o[2]+t*d[2];
            if(!inside(s,px,py))continue;
            uint32_t color;float normal[3]={nx,ny,nh},tangent_scale=1/sqrtf(1+a*a),tangent[3]={tangent_scale,0,a*tangent_scale};
            if(im->decal){
                if(im->owners&&im->owners[i].surface!=surface)continue;
                if(!r2d_world_decal_color(w,im->decal,span,px-s->x,py-s->y,px,py,height,normal,tangent,t,&color))continue;
                image_blend(im,i,color,w->materials[im->decal->material].blend);continue;
            }
            float world_u=px-s->x,world_v=py-s->y;r2d_world_material_uv(w,surface,px,py,height,normal,tangent,&world_u,&world_v);
            if(!r2d_world_material_color(w,surface,span,ceiling?s->ceiling_color:s->floor_color,world_u,world_v,px,py,height,normal,tangent,t,&color))continue;
            if(im->translucent){image_blend(im,i,color,blend);continue;}
            im->depth[i]=t;image_color(im,i,color);if(im->owners)im->owners[i]=(R2DWorldPixelOwner){surface,span,-1};
        }
    }
}

void r2d_world_frame_targets(const R2DRe2dWorld *w,const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,float ortho_height,const R2DWorldVisibility *visibility,R2DWorldPixelOwner *owners)
{
    WorldImage im={v,width,height,ortho_height,rgba,depth,visibility,owners,false,NULL};
    for(int i=0;i<width*height;i++){depth[i]=FLT_MAX;image_color(&im,i,0xff201810);if(owners)owners[i]=(R2DWorldPixelOwner){-1,-1,-1};}
    if(w->sky.pixels||w->sky_color)for(int y=0;y<height;y++)for(int x=0;x<width;x++){
        uint32_t color=w->sky_color?w->sky_color:0xffffffff;
        if(w->sky.pixels){float o[3],d[3],os[2],ds[2];image_row(&im,x,y,o,d,os,ds);float len=sqrtf(d[0]*d[0]+d[1]*d[1]+d[2]*d[2]);
            float u=.5f+(atan2f(d[1],d[0])+w->sky_yaw)/(2*3.14159265358979323846f),vv=.5f-asinf(fmaxf(-1,fminf(1,d[2]/len)))/3.14159265358979323846f;u-=floorf(u);
            uint8_t sample[4];r2d_world_texture_sample(&w->sky,u,vv,true,true,sample);const uint8_t *p=sample;
            uint32_t tinted=0xff000000;for(int c=0;c<3;c++)tinted|=(uint32_t)roundf(p[c]*(((color>>(c*8))&255)/255.0f))<<(c*8);color=tinted;
        }image_color(&im,y*width+x,color);
    }
    if(visibility) {
        for(int j=0;j<visibility->surface_count;j++) {
            const R2DWorldSurface *surface=&w->surfaces[visibility->surfaces[j]];
            if(surface->kind!=R2D_WORLD_WALL)continue;
            const R2DWorldWall *wall=&w->walls[surface->primitive];
            R2DSegment segment={wall->x1,wall->y1,wall->x2,wall->y2,surface->primitive,false};
            image_wall_segment(&im,w,&segment);
        }
    } else if(w->wall_count&&!w->bsp.node_count)for(int i=0;i<w->wall_count;i++){const R2DWorldWall *wall=&w->walls[i];R2DSegment seg={wall->x1,wall->y1,wall->x2,wall->y2,i,false};image_wall_segment(&im,w,&seg);}
    else image_node(&im,w,w->bsp.root);
    if(visibility)for(int j=0;j<visibility->span_count;j++){int i=visibility->spans[j];image_plane(&im,w,i,false);image_plane(&im,w,i,true);}
    else for(int i=0;i<w->span_count;i++){image_plane(&im,w,i,false);image_plane(&im,w,i,true);}
}
typedef R2DWorldSortItem TransparentItem;
static int transparent_compare(const void *a,const void *b)
{const TransparentItem *x=a,*y=b;return x->depth>y->depth?-1:x->depth<y->depth?1:(x->id>y->id)-(x->id<y->id);}
int r2d_world_transparent_order(R2DRe2dWorld *w,const R2DRe2dView *v,const R2DWorldVisibility *f,int *ids)
{
    if(!w->surface_count)return 0;
    if(w->sort_capacity<w->surface_count){
        TransparentItem *items=malloc((size_t)w->surface_count*sizeof *items);int *order=malloc((size_t)w->surface_count*sizeof(int));
        if(!items||!order){free(items);free(order);return -1;}free(w->sort_items);free(w->transparent_ids);w->sort_items=items;w->transparent_ids=order;w->sort_capacity=w->surface_count;
    }
    TransparentItem *items=w->sort_items;if(!ids)ids=w->transparent_ids;int count=0;
    for(int i=0;i<f->surface_count;i++){int id=f->surfaces[i];if(w->surface_sky&&w->surface_sky[id])continue;if(r2d_world_surface_blend(w,id)<R2D_WORLD_TRANSLUCENT)continue;
        const R2DWorldSurface *surface=&w->surfaces[id];float x,y,h;
        if(surface->kind==R2D_WORLD_WALL){const R2DWorldWall *wall=&w->walls[surface->primitive];x=(wall->x1+wall->x2)*.5f;y=(wall->y1+wall->y2)*.5f;h=(wall->bottom+wall->top)*.5f;}
        else {const R2DWorldSpan *s=&w->spans[surface->primitive];x=s->x+s->w*.5f;y=s->y+s->h*.5f;h=surface->kind==R2D_WORLD_FLOOR?r2d_world_floor_height(s,x,y):r2d_world_ceiling_height(s,x,y);}
        float depth=((x-v->x)*v->cos_yaw+(y-v->y)*v->sin_yaw)*v->cos_pitch+(h-v->eye)*v->sin_pitch;items[count++]=(TransparentItem){id,depth};
    }
    qsort(items,(size_t)count,sizeof *items,transparent_compare);for(int i=0;i<count;i++)ids[i]=items[i].id;return count;
}
bool r2d_world_frame_transparent(R2DRe2dWorld *w,const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,float ortho,const R2DWorldVisibility *f)
{
    if(!w->material_count)return true;
    int count=r2d_world_transparent_order(w,v,f,NULL);if(count<0)return false;int *ids=w->transparent_ids;
    WorldImage im={v,width,height,ortho,rgba,depth,f,NULL,true,NULL};
    for(int i=0;i<count;i++){const R2DWorldSurface *surface=&w->surfaces[ids[i]];
        if(surface->kind==R2D_WORLD_WALL){const R2DWorldWall *wall=&w->walls[surface->primitive];R2DSegment segment={wall->x1,wall->y1,wall->x2,wall->y2,surface->primitive,false};image_wall_segment(&im,w,&segment);}
        else image_plane(&im,w,surface->primitive,surface->kind==R2D_WORLD_CEILING);
    }return true;
}
void r2d_world_frame_decals(const R2DRe2dWorld *w,const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,float ortho,const R2DWorldVisibility *f,R2DWorldPixelOwner *owners)
{
    if(!w->decal_count)return;
    WorldImage im={v,width,height,ortho,rgba,depth,f,owners,true,NULL};
    for(int i=0;i<R2D_WORLD_MAX_DECALS;i++)if(w->decals[i].active){const R2DWorldDecal *d=&w->decals[i];if(!f->surface_seen[d->surface])continue;im.decal=d;const R2DWorldSurface *s=&w->surfaces[d->surface];
        if(s->kind==R2D_WORLD_WALL){const R2DWorldWall *wall=&w->walls[s->primitive];R2DSegment segment={wall->x1,wall->y1,wall->x2,wall->y2,s->primitive,false};image_wall_segment(&im,w,&segment);}
        else image_plane(&im,w,s->primitive,s->kind==R2D_WORLD_CEILING);
    }
}
void r2d_world_frame_visible(const R2DRe2dWorld *w,const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,float ortho,const R2DWorldVisibility *visibility)
{ r2d_world_frame_targets(w,v,width,height,rgba,depth,ortho,visibility,NULL); }
void r2d_world_frame(const R2DRe2dWorld *w,const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,float ortho_height)
{ r2d_world_frame_visible(w,v,width,height,rgba,depth,ortho_height,NULL); }

void r2d_world_stamp_targets(const R2DRe2dWorld *world,const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,
 const uint8_t *sprite,int size,float x,float y,float bottom,float ww,float hh,float ortho_height,R2DWorldPixelOwner *owners,int actor)
{
    float p[4];
    if(!sprite || size<=0 || ww<=0 || hh<=0) return;
    float dist;
    if(ortho_height>0) {
        const float dx=x-v->x,dy=y-v->y,up=bottom-v->eye;
        const float forward=dx*v->cos_yaw+dy*v->sin_yaw;
        dist=forward*v->cos_pitch+up*v->sin_pitch;
        if(dist<v->near_plane) return;
        const float scale=v->height/ortho_height;
        p[0]=v->width/2+(-dx*v->sin_yaw+dy*v->cos_yaw)*scale;
        p[1]=v->height/2-(up*v->cos_pitch-forward*v->sin_pitch)*scale;
        p[3]=scale;
    } else {
        if(!r2d_re2d_project(v,x,y,bottom,p)) return;
        dist=v->focal/p[3];
    }
    float sx=width/v->width,sy=height/v->height,sw=ww*p[3]*sx,sh=hh*p[3]*sy;
    float left=p[0]*sx-sw/2,top=p[1]*sy-sh;
    int x0=(int)fmaxf(0,fminf(width,floorf(left))),x1=(int)fmaxf(0,fminf(width,ceilf(left+sw)));
    int y0=(int)fmaxf(0,fminf(height,floorf(top))),y1=(int)fmaxf(0,fminf(height,ceilf(top+sh)));
    for(int py=y0;py<y1;py++) for(int px=x0;px<x1;px++) {
        int u=(int)((px+0.5f-left)*size/sw),vv=(int)((py+0.5f-top)*size/sh);
        if(u<0||u>=size||vv<0||vv>=size) continue;
        const uint8_t *src=sprite+(vv*size+u)*4;int i=py*width+px;
        // Binary coverage only: alpha blending would need ordered fragments.
        if(src[3]<128||dist>depth[i]) continue;
        uint32_t color=(uint32_t)src[0]|((uint32_t)src[1]<<8)|((uint32_t)src[2]<<16)|0xff000000;
        if(world&&world->lighting.enabled) {
            float local_h=bottom+(1-(py+.5f-top)/sh)*hh;
            int span=r2d_world_span_at(world,x,y,local_h);
            float dx=v->x-x,dy=v->y-y,len=sqrtf(dx*dx+dy*dy);
            color=r2d_world_lit_color(world,span,color,x,y,local_h,len>0?dx/len:0,len>0?dy/len:0,0,dist);
        }
        for(int c=0;c<4;c++)rgba[i*4+c]=(uint8_t)(color>>(c*8));depth[i]=dist;
        if(owners){float h=bottom+(1-(py+.5f-top)/sh)*hh;int span=world?r2d_world_span_at(world,x,y,h):-1;owners[i]=(R2DWorldPixelOwner){-1,span,actor};}
    }
}

void r2d_world_stamp_lit(const R2DRe2dWorld *world,const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,
 const uint8_t *sprite,int size,float x,float y,float bottom,float ww,float hh,float ortho)
{ r2d_world_stamp_targets(world,v,width,height,rgba,depth,sprite,size,x,y,bottom,ww,hh,ortho,NULL,-1); }

void r2d_world_stamp_samples(const R2DRe2dWorld *world,const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,
 const uint8_t *sprite,const float *sample_depth,int size,float x,float y,float bottom,float ww,float hh,float ortho,R2DWorldPixelOwner *owners,int actor)
{
    if(!sample_depth){r2d_world_stamp_targets(world,v,width,height,rgba,depth,sprite,size,x,y,bottom,ww,hh,ortho,owners,actor);return;}
    if(!sprite||size<=0||ww<=0||hh<=0)return;float p[4],center=bottom+hh*.5f;
    float dx=x-v->x,dy=y-v->y,forward=dx*v->cos_yaw+dy*v->sin_yaw;
    float dist=forward*v->cos_pitch+(center-v->eye)*v->sin_pitch;
    if(dist<v->near_plane)return;
    if(ortho>0){float scale=v->height/ortho;p[0]=v->width*.5f+(-dx*v->sin_yaw+dy*v->cos_yaw)*scale;p[1]=v->height*.5f-((center-v->eye)*v->cos_pitch-forward*v->sin_pitch)*scale;p[3]=scale;}
    else if(!r2d_re2d_project(v,x,y,center,p))return;
    float sw=ww*p[3]*width/v->width,sh=hh*p[3]*height/v->height,left=p[0]*width/v->width-sw*.5f,top=p[1]*height/v->height-sh*.5f;
    int x0=(int)fmaxf(0,fminf(width,floorf(left))),x1=(int)fmaxf(0,fminf(width,ceilf(left+sw))),y0=(int)fmaxf(0,fminf(height,floorf(top))),y1=(int)fmaxf(0,fminf(height,ceilf(top+sh)));
    for(int py=y0;py<y1;py++)for(int px=x0;px<x1;px++){
        float u=(px+.5f-left)/sw,vv=(py+.5f-top)/sh;int tx=(int)(u*size),ty=(int)(vv*size);if(tx<0||ty<0||tx>=size||ty>=size)continue;
        int sample=ty*size+tx,i=py*width+px;const uint8_t *src=sprite+sample*4;if(src[3]<128)continue;
        float offset=sample_depth[sample]*hh,z=dist-offset;if(z<v->near_plane||z>depth[i])continue;
        // Reconstruct the actual sample position from camera-aligned 2D synthesis.
        float right=(u-.5f)*ww,up=(.5f-vv)*hh;
        float wx=x-v->sin_yaw*right-v->cos_yaw*v->sin_pitch*up-v->cos_yaw*v->cos_pitch*offset;
        float wy=y+v->cos_yaw*right-v->sin_yaw*v->sin_pitch*up-v->sin_yaw*v->cos_pitch*offset;
        float wh=center+v->cos_pitch*up-v->sin_pitch*offset;
        int span=r2d_world_span_at(world,wx,wy,wh);uint32_t color=(uint32_t)src[0]|((uint32_t)src[1]<<8)|((uint32_t)src[2]<<16)|0xff000000;
        float nx=v->x-wx,ny=v->y-wy,length=hypotf(nx,ny);
        color=r2d_world_lit_color(world,span,color,wx,wy,wh,length>0?nx/length:0,length>0?ny/length:0,0,z);
        for(int c=0;c<4;c++)rgba[i*4+c]=(uint8_t)(color>>(c*8));depth[i]=z;if(owners)owners[i]=(R2DWorldPixelOwner){-1,span,actor};
    }
}

void r2d_world_stamp(const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,
 const uint8_t *sprite,int size,float x,float y,float bottom,float ww,float hh,float ortho_height)
{ r2d_world_stamp_lit(NULL,v,width,height,rgba,depth,sprite,size,x,y,bottom,ww,hh,ortho_height); }

bool r2d_world_sprite_visible(const R2DRe2dView *v,int width,int height,float x,float y,float bottom,float ww,float hh,float ortho_height)
{
    float p[4];
    if(ww<=0 || hh<=0) return false;
    float dist;
    if(ortho_height>0) {
        const float dx=x-v->x,dy=y-v->y,up=bottom-v->eye;
        const float forward=dx*v->cos_yaw+dy*v->sin_yaw;
        dist=forward*v->cos_pitch+up*v->sin_pitch;
        if(dist<v->near_plane) return false;
        const float scale=v->height/ortho_height;
        p[0]=v->width/2+(-dx*v->sin_yaw+dy*v->cos_yaw)*scale;
        p[1]=v->height/2-(up*v->cos_pitch-forward*v->sin_pitch)*scale;
        p[3]=scale;
    } else {
        if(!r2d_re2d_project(v,x,y,bottom,p)) return false;
        dist=v->focal/p[3];
    }
    float sx=width/v->width,sy=height/v->height,sw=ww*p[3]*sx,sh=hh*p[3]*sy;
    float left=p[0]*sx-sw/2,top=p[1]*sy-sh;
    int x0=(int)fmaxf(0,fminf(width,floorf(left))),x1=(int)fmaxf(0,fminf(width,ceilf(left+sw)));
    int y0=(int)fmaxf(0,fminf(height,floorf(top))),y1=(int)fmaxf(0,fminf(height,ceilf(top+sh)));
    return x1>x0 && y1>y0;
}

static uint32_t debug_id(int id)
{ if(id<0)return 0xff101010;uint32_t h=((uint32_t)id+1)*2654435761u;return 0xff000000|((h&0x007f7f7f)+0x00404040); }
void r2d_world_debug_pixels(const R2DRe2dWorld *w,const R2DRe2dView *view,const R2DWorldVisibility *visibility,float ortho,int mode,int width,int height,uint8_t *rgba,const float *depth,const R2DWorldPixelOwner *owners)
{
    if(mode==R2D_WORLD_DEBUG_FINAL||!owners)return;
    if(mode==R2D_WORLD_DEBUG_OVERDRAW){for(int i=0;i<width*height;i++){unsigned count=rgba[i*4];rgba[i*4]=(uint8_t)fminf(255,count*32);rgba[i*4+1]=(uint8_t)fminf(255,count*8);rgba[i*4+2]=0;rgba[i*4+3]=255;}return;}
    if(mode==R2D_WORLD_DEBUG_PORTALS){
        for(int i=0;i<w->portal_count;i++){const R2DWorldPortal *p=&w->portals[i];bool visible=false;
            for(int side=0;side<2;side++){const R2DWorldCell *c=&w->cells[side?p->cell_b:p->cell_a];for(int j=0;j<c->span_count;j++)if(visibility->span_seen[c->first_span+j])visible=true;}
            if(!visible)continue;
            for(int j=0;j<p->opening_count;j++){R2DWorldWindow window;if(!r2d_world_portal_window(view,ortho,p,&w->openings[p->first_opening+j],&window)||window.right<0||window.bottom<0||window.left>=view->width||window.top>=view->height)continue;
                int left=(int)fmaxf(0,fminf(width-1,window.left*width/view->width)),right=(int)fmaxf(0,fminf(width-1,window.right*width/view->width));
                int top=(int)fmaxf(0,fminf(height-1,window.top*height/view->height)),bottom=(int)fmaxf(0,fminf(height-1,window.bottom*height/view->height));
                for(int y=top;y<=bottom;y++)for(int x=left;x<=right;x++)if(x==left||x==right||y==top||y==bottom){int k=(y*width+x)*4;rgba[k]=p->closed?255:32;rgba[k+1]=p->closed?32:255;rgba[k+2]=32;rgba[k+3]=255;}
            }
        }return;
    }
    WorldImage im={view,width,height,ortho,rgba,(float *)depth,NULL,NULL,false,NULL};
    for(int i=0;i<width*height;i++) {
        const R2DWorldPixelOwner *o=&owners[i];uint32_t color=0xff101010;int span=o->span;
        if(mode==R2D_WORLD_DEBUG_CELL)color=debug_id(span>=0&&w->span_cells?w->span_cells[span]:-1);
        else if(mode==R2D_WORLD_DEBUG_SPAN)color=debug_id(span);
        else if(mode==R2D_WORLD_DEBUG_BSP)color=debug_id(span>=0&&visibility->cell_nodes?visibility->cell_nodes[w->span_cells[span]]:-1);
        else if(mode==R2D_WORLD_DEBUG_OWNER)color=debug_id(o->actor>=0?w->surface_count+o->actor:o->surface);
        else if(mode==R2D_WORLD_DEBUG_DEPTH){int v=depth[i]==FLT_MAX?0:(int)(255/(1+depth[i]*.01f));color=0xff000000|(unsigned)v*0x010101u;}
        else if(mode==R2D_WORLD_DEBUG_LIGHT_LEVEL){unsigned v=span>=0&&w->span_lights?(unsigned)roundf(w->span_lights[span].level*255):0;color=0xff000000|v*0x010101u;}
        else if(mode==R2D_WORLD_DEBUG_LIGHT_COUNT){unsigned v=span>=0&&w->span_light_counts?w->span_light_counts[span]:0;color=0xff000000|v*15u|(v*8u<<8);}
        else if((mode==R2D_WORLD_DEBUG_NORMAL||mode==R2D_WORLD_DEBUG_EMISSIVE||mode==R2D_WORLD_DEBUG_SHADOW)&&(o->surface>=0||o->actor>=0)){
            const R2DWorldSurface *surface=o->surface>=0?&w->surfaces[o->surface]:NULL;
            float origin[3],ray[3],os[2],ds[2];image_row(&im,i%width,i/width,origin,ray,os,ds);
            float x=origin[0]+ray[0]*depth[i],y=origin[1]+ray[1]*depth[i],h=origin[2]+ray[2]*depth[i];
            float normal[3]={0,0,1},tangent[3]={1,0,0},u=0,v=0;
            if(!surface){normal[0]=-view->cos_yaw;normal[1]=-view->sin_yaw;normal[2]=0;tangent[0]=-view->sin_yaw;tangent[1]=view->cos_yaw;}
            else if(surface->kind==R2D_WORLD_WALL){
                const R2DWorldWall *wall=&w->walls[surface->primitive];float dx=wall->x2-wall->x1,dy=wall->y2-wall->y1,len=hypotf(dx,dy);
                normal[0]=-dy/len;normal[1]=dx/len;normal[2]=0;
                if((view->x-wall->x1)*normal[0]+(view->y-wall->y1)*normal[1]<0){normal[0]=-normal[0];normal[1]=-normal[1];}
                tangent[0]=dx/len;tangent[1]=dy/len;u=hypotf(x-wall->x1,y-wall->y1);v=h-wall->bottom;
            }else{
                const R2DWorldSpan *sp=&w->spans[surface->primitive];bool ceiling=surface->kind==R2D_WORLD_CEILING;
                float a=ceiling?sp->ceiling_a:sp->floor_a,b=ceiling?sp->ceiling_b:sp->floor_b,k=(ceiling?-1:1)/sqrtf(1+a*a+b*b);
                normal[0]=-a*k;normal[1]=-b*k;normal[2]=k;
                float t=1/sqrtf(1+a*a);tangent[0]=t;tangent[2]=a*t;u=x-sp->x;v=y-sp->y;
            }
            if(surface)r2d_world_material_uv(w,o->surface,x,y,h,normal,tangent,&u,&v);
            float mapped[3],emissive[3];r2d_world_material_probe(w,o->surface,u,v,normal,tangent,mapped,emissive);
            if(mode==R2D_WORLD_DEBUG_SHADOW){
                unsigned tested=0,blocked=0;
                if(span>=0&&w->span_light_counts)for(int j=0;j<w->span_light_counts[span];j++){
                    int id=w->span_light_refs[span*R2D_WORLD_LIGHTS_PER_SPAN+j];const R2DWorldLight *light=&w->lights[id];
                    float dx=x-light->x,dy=y-light->y,dh=h-light->h;
                    if(!w->shadow_mask[id]||dx*dx+dy*dy+dh*dh>=light->radius*light->radius)continue;
                    tested++;float origin[3]={light->x,light->y,light->h},direction[3]={dx,dy,dh};R2DWorldHit hit;
                    if(r2d_world_ray(w,origin,direction,.0001f,.9999f,&hit))blocked++;
                }
                unsigned value=tested?(255*(tested-blocked))/tested:0;color=0xff000000|value*0x010101u;
            }else {
            color=0xff000000;for(int c=0;c<3;c++){float value=mode==R2D_WORLD_DEBUG_NORMAL?(mapped[c]*.5f+.5f)*255:emissive[c];color|=(uint32_t)fmaxf(0,fminf(255,roundf(value)))<<(c*8);}
            }
        }
        for(int c=0;c<4;c++)rgba[i*4+c]=(uint8_t)(color>>(c*8));
    }
}
