#include "re2d_world.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <float.h>

static bool finite6(float a,float b,float c,float d,float e,float f)
{ return isfinite(a)&&isfinite(b)&&isfinite(c)&&isfinite(d)&&isfinite(e)&&isfinite(f); }
void r2d_world_free(R2DRe2dWorld *w)
{ if (!w) return; r2d_bsp_free(&w->bsp); free(w->walls);free(w->spans);memset(w,0,sizeof *w);w->bsp.root=-1; }
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
            !isfinite(s->x+s->w) || !isfinite(s->y+s->h)) return false;
        // Free intervals may share XY, but cannot overlap in height there.
        for (int j=0;j<i;j++) {
            const R2DWorldSpan *p=&spans[j];
            if (s->x<p->x+p->w && p->x<s->x+s->w && s->y<p->y+p->h && p->y<s->y+s->h &&
                s->bottom<p->top && p->bottom<s->top) return false;
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
    if(!w || !finite6(x,y,feet,height,step,0) || height<=0 || step<0) return -1;
    int best=-1;
    for(int i=0;i<w->span_count;i++) {
        const R2DWorldSpan *s=&w->spans[i];
        if (inside(s,x,y) && s->bottom<=feet+step && s->top-s->bottom>=height &&
            // Do not drop through the ceiling of a lower storey.
            feet<s->top && (best<0 || s->bottom>w->spans[best].bottom)) best=i;
    }
    return best;
}
bool r2d_world_blocked(const R2DRe2dWorld *w,float x,float y,float radius,float bottom,float top)
{
    if(!w || !finite6(x,y,radius,bottom,top,0) || radius<0 || top<=bottom) return true;
    for(int i=0;i<w->wall_count;i++) {
        const R2DWorldWall *s=&w->walls[i];
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
    if(t<lo || t>hit->t || u<0 || u>1 || z<wall->bottom || z>wall->top) return;
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
bool r2d_world_ray(const R2DRe2dWorld *w,const float o[3],const float d[3],float lo,float hi,R2DWorldHit *hit)
{
    if(!w||!o||!d||!hit||!finite6(o[0],o[1],o[2],d[0],d[1],d[2])||!isfinite(lo)||!isfinite(hi)||lo<0||hi<lo) return false;
    *hit=(R2DWorldHit){.t=hi,.wall=-1,.span=-1};
    ray_node(w,w->bsp.root,o,d,lo,hit);
    if(fabsf(d[2])>1e-8f) for(int i=0;i<w->span_count;i++) for(int ceiling=0;ceiling<2;ceiling++) {
        const R2DWorldSpan *s=&w->spans[i];float z=ceiling?s->top:s->bottom;
        float t=(z-o[2])/d[2],x=o[0]+t*d[0],y=o[1]+t*d[1];
        if(t<lo||t>hit->t||!inside(s,x,y)) continue;
        *hit=(R2DWorldHit){t,x,y,z,-1,i,ceiling!=0,ceiling?s->ceiling_color:s->floor_color};
    }
    return hit->wall>=0||hit->span>=0;
}
// Native image synthesis over specialised planar primitives. The projected
// bounds only limit work; coverage/depth still comes from exact world equations.
typedef struct { float right,up,forward; } WorldImagePoint;
typedef struct { const R2DRe2dView *view; int width,height; float ortho;
    uint8_t *rgba;float *depth; } WorldImage;
static void image_color(WorldImage *im,int i,uint32_t color)
{ for(int c=0;c<4;c++)im->rgba[i*4+c]=(uint8_t)(color>>(c*8)); }
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
static void image_wall(WorldImage *im,const R2DRe2dWorld *w,int index)
{
    const R2DSegment *seg=&w->bsp.segments[index];const R2DWorldWall *wall=&w->walls[seg->user];
    float points[4][3]={{seg->x1,seg->y1,wall->bottom},{seg->x2,seg->y2,wall->bottom},{seg->x2,seg->y2,wall->top},{seg->x1,seg->y1,wall->top}};
    int b[4];if(!image_bounds(im,points,b))return;
    float sx=seg->x2-seg->x1,sy=seg->y2-seg->y1;
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
            if(u<0||u>1||z<wall->bottom||z>wall->top)continue;
            im->depth[i]=t;image_color(im,i,wall->color);
        }
    }
}
static void image_node(WorldImage *im,const R2DRe2dWorld *w,int index)
{
    if(index<0)return;
    const R2DBspNode *n=&w->bsp.nodes[index];const R2DSegment *s=&w->bsp.segments[n->splitter];
    bool front=cross(s->x2-s->x1,s->y2-s->y1,im->view->x-s->x1,im->view->y-s->y1)>=0;
    image_node(im,w,front?n->front:n->back);image_wall(im,w,n->splitter);
    for(int i=0;i<n->leftover_count;i++)image_wall(im,w,n->leftover_first+i);
    image_node(im,w,front?n->back:n->front);
}
static void image_plane(WorldImage *im,const R2DWorldSpan *s,bool ceiling)
{
    float z=ceiling?s->top:s->bottom;
    float points[4][3]={{s->x,s->y,z},{s->x+s->w,s->y,z},{s->x+s->w,s->y+s->h,z},{s->x,s->y+s->h,z}};
    int b[4];if(!image_bounds(im,points,b))return;
    for(int y=b[1];y<b[3];y++) {
        float o[3],d[3],os[2],ds[2];image_row(im,b[0],y,o,d,os,ds);
        if(fabsf(d[2])<=1e-8f)continue;
        float t=(z-o[2])/d[2];if(t<im->view->near_plane||t>100000)continue;
        float px=o[0]+t*d[0],py=o[1]+t*d[1],xs=os[0]+t*ds[0],ys=os[1]+t*ds[1];
        for(int x=b[0];x<b[2];x++) {
            int i=y*im->width+x;float k=(float)(x-b[0]);
            if(t>im->depth[i]||!inside(s,px+k*xs,py+k*ys))continue;
            im->depth[i]=t;image_color(im,i,ceiling?s->ceiling_color:s->floor_color);
        }
    }
}
void r2d_world_frame(const R2DRe2dWorld *w,const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,float ortho_height)
{
    WorldImage im={v,width,height,ortho_height,rgba,depth};
    for(int i=0;i<width*height;i++){depth[i]=FLT_MAX;image_color(&im,i,0xff201810);}
    image_node(&im,w,w->bsp.root);
    for(int i=0;i<w->span_count;i++){image_plane(&im,&w->spans[i],false);image_plane(&im,&w->spans[i],true);}
}
void r2d_world_stamp(const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,
 const uint8_t *sprite,int size,float x,float y,float bottom,float ww,float hh,float ortho_height)
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
        memcpy(rgba+i*4,src,4);rgba[i*4+3]=255;depth[i]=dist;
    }
}

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
