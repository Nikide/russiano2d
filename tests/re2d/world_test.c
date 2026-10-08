#include "re2d_world.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
static int failed;
#define CHECK(c,m) do {bool ok=(c);printf("  %s %s\n",ok?"ok":"FAIL",m);if(!ok)failed++;}while(0)
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
