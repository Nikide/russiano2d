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
void r2d_world_frame(const R2DRe2dWorld *w,const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,float ortho_height)
{
    const float eye[3]={v->x,v->y,v->eye};
    for(int y=0;y<height;y++) for(int x=0;x<width;x++) {
        float right,up,forward,o[3],d[3];
        memcpy(o,eye,sizeof o);
        if(ortho_height>0) {
            const float scale=ortho_height/v->height;
            right=((x+0.5f)*v->width/width-v->width/2)*scale;
            up=(v->height/2-(y+0.5f)*v->height/height)*scale;
            o[0]+=-v->sin_yaw*right-v->cos_yaw*v->sin_pitch*up;
            o[1]+=v->cos_yaw*right-v->sin_yaw*v->sin_pitch*up;
            o[2]+=v->cos_pitch*up;
            forward=v->cos_pitch;
            d[0]=forward*v->cos_yaw;d[1]=forward*v->sin_yaw;d[2]=v->sin_pitch;
        } else {
            right=((x+0.5f)*v->width/width-v->width/2)/v->focal;
            up=(v->height/2-(y+0.5f)*v->height/height)/v->focal;
            forward=v->cos_pitch-up*v->sin_pitch;
            d[0]=forward*v->cos_yaw-right*v->sin_yaw;
            d[1]=forward*v->sin_yaw+right*v->cos_yaw;d[2]=v->sin_pitch+up*v->cos_pitch;
        }
        R2DWorldHit hit;int i=y*width+x;uint32_t color=0xff201810;
        if(r2d_world_ray(w,o,d,v->near_plane,100000.0f,&hit)) {color=hit.color;depth[i]=hit.t;}
        else depth[i]=FLT_MAX;
        for(int c=0;c<4;c++) rgba[i*4+c]=(uint8_t)(color>>(c*8));
    }
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
