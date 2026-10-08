#include "re2d_world.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <float.h>
static int failed;
#define CHECK(c,m) do {bool ok=(c);printf("  %s %s\n",ok?"ok":"FAIL",m);if(!ok)failed++;}while(0)
static void reference_frame(const R2DRe2dWorld *w,const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,float ortho_height)
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

int main(void)
{
    const R2DWorldSpan spans[]={
        {-100,-100,300,200,0,80,0xff004400,0xff555555},
        {-100,-100,300,200,100,180,0xff440000,0xff555555},
        {-100,-100,300,200,200,280,0xff000044,0xff555555},
    };
    const R2DWorldWall walls[]={
        {50,-100,50,100,0,80,0xff0000ff},
        {50,-100,50,100,200,280,0xff0000ff},
    };
    R2DRe2dWorld w={0};
    CHECK(r2d_world_build(&w,walls,2,spans,3),"same XY, three disjoint walkable height intervals");
    CHECK(r2d_world_support(&w,0,0,0,40,0)==0,"lower support");
    CHECK(r2d_world_support(&w,0,0,100,40,0)==1,"middle support: does not choose lower floor");
    CHECK(r2d_world_support(&w,0,0,200,40,0)==2,"upper support");
    CHECK(r2d_world_support(&w,0,0,100,90,0)==-1,"headroom rejection");
    CHECK(r2d_world_support(&w,400,0,0,40,0)==-1,"outside region");
    CHECK(r2d_world_blocked(&w,50,0,5,0,40),"lower wall blocks circle + height interval");
    CHECK(!r2d_world_blocked(&w,50,0,5,100,140),"same XY middle actor passes under upper wall");
    CHECK(!r2d_world_blocked(&w,50,0,5,80,100),"touching height intervals do not collide");
    float origin[]={0,0,40},dir[]={100,0,0};R2DWorldHit hit;
    CHECK(r2d_world_ray(&w,origin,dir,0,1,&hit)&&fabsf(hit.t-.5f)<1e-5f&&hit.wall==0,"lower horizontal gameplay ray hits wall");
    origin[2]=140;CHECK(!r2d_world_ray(&w,origin,dir,0,1,&hit),"middle horizontal ray has no lower/upper wall collision");
    dir[0]=0;dir[2]=-100;
    CHECK(r2d_world_ray(&w,origin,dir,0,1,&hit)&&hit.span==1&&!hit.ceiling&&fabsf(hit.height-100)<1e-5f,"vertical ray finds middle floor");
    R2DWorldSpan invalid=spans[0];invalid.bottom=50;invalid.top=150;
    R2DWorldSpan overlap[]={spans[0],invalid};
    CHECK(!r2d_world_build(&w,walls,2,overlap,2)&&w.span_count==3,"invalid overlapping spans rejected transactionally");
    R2DRe2dView view;r2d_re2d_view_set(&view,0,0,40,0,0,1.5707963f,32,32);
    uint8_t rgba[32*32*4],image[4]={0,255,0,255};float depth[32*32];
    r2d_world_frame(&w,&view,32,32,rgba,depth,0);
    int pixel=16*32+16;
    CHECK(rgba[pixel*4]==255&&fabsf(depth[pixel]-50)<1e-3f,"world becomes ordinary RGBA, wall depth is internal");
    r2d_world_stamp(&view,32,32,rgba,depth,image,1,100,0,0,100,80,0);
    CHECK(rgba[pixel*4]==255,"wall occludes far synthesised sprite");
    r2d_world_stamp(&view,32,32,rgba,depth,image,1,25,0,0,20,80,0);
    CHECK(rgba[pixel*4+1]==255,"near synthesised sprite occludes wall");
    uint8_t transparent[4]={0,0,255,0};
    r2d_world_stamp(&view,32,32,rgba,depth,transparent,1,10,0,0,20,80,0);
    CHECK(rgba[pixel*4+1]==255,"transparent coverage does not write depth");
    r2d_re2d_view_set(&view,0,0,40,0,0,1.5707963f,32,32);
    r2d_world_frame(&w,&view,32,32,rgba,depth,100);
    CHECK(rgba[pixel*4]==255 && fabsf(depth[pixel]-50)<1e-3f,"orthographic projection of same wall");
    r2d_re2d_view_set(&view,0,0,140,0,-1.5707963f,1.5707963f,32,32);
    r2d_world_frame(&w,&view,32,32,rgba,depth,100);
    CHECK(rgba[pixel*4+2]==68,"orthographic top-down view hits upper floor");
    // Independent per-pixel query reference catches projection/bounds mistakes.
    bool matches=true;uint8_t fast[64*48*4],reference[64*48*4];float fd[64*48],rd[64*48];
    for(int mode=0;mode<2;mode++)for(int storey=0;storey<3;storey++)for(int pose=0;pose<4;pose++) {
        r2d_re2d_view_set(&view,0,-13,40+storey*100,(pose-1)*.45f,(pose-2)*.35f,1.2f,64,48);
        r2d_world_frame(&w,&view,64,48,fast,fd,mode?150:0);reference_frame(&w,&view,64,48,reference,rd,mode?150:0);
        for(int i=0;i<64*48;i++) {
            if((fd[i]==FLT_MAX)!=(rd[i]==FLT_MAX)) {matches=false;break;}
            if(fd[i]!=FLT_MAX && fabsf(fd[i]-rd[i])>fmaxf(.02f,rd[i]*.0001f)){matches=false;break;}
            // Coincident surfaces can choose either colour at the same depth.
            if(memcmp(fast+i*4,reference+i*4,4) && (fd[i]==FLT_MAX || fabsf(fd[i]-rd[i])>.002f)){matches=false;break;}
        }
    }
    CHECK(matches,"bounded native synthesis matches independent ray queries across projections/storeys/poses");
    r2d_world_free(&w);r2d_world_free(&w);
    // Reverse-facing crossing geometry must have the same world ray answer.
    const R2DWorldWall crossing[]={{-10,0,10,0,0,80,0xff0000ff},{0,-10,0,10,0,80,0xff00ff00}};
    CHECK(r2d_world_build(&w,crossing,2,NULL,0),"crossing walls build");
    float o[]={-5,-5,40},d[]={10,0,0};
    CHECK(r2d_world_ray(&w,o,d,0,1,&hit)&&hit.wall==1&&fabsf(hit.t-.5f)<1e-5f,"BSP ray reaches the correct split half");
    r2d_world_free(&w);
    const R2DWorldSpan stairs[]={
        {0,0,20,20,0,80,0,0},{20,0,20,20,8,80,0,0},{40,0,20,20,16,80,0,0}
    };
    CHECK(r2d_world_build(&w,NULL,0,stairs,3),"stairs are neighbouring specialised regions, not meshes");
    CHECK(r2d_world_support(&w,25,10,0,40,8)==1,"support climbs a reachable step");
    CHECK(r2d_world_support(&w,45,10,8,40,8)==2,"support climbs the next step");
    CHECK(r2d_world_support(&w,45,10,0,40,8)==-1,"support cannot skip an unreachable rise");
    r2d_world_free(&w);return failed?1:0;
}
