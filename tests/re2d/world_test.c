#include "re2d_world.h"
#include "re2d_world_bake.h"
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
    r2d_world_free(&w);
    const R2DWorldSpan stack[]={
        {0,0,100,100,0,3,0,0},{0,0,100,100,6,9,0,0},
        {100,0,100,100,0,3,0,0},{100,0,100,100,6,9,0,0}};
    const R2DWorldCell cells[]={{0,0,100,100,0,2},{100,0,100,100,2,2}};
    const R2DWorldOpening openings[]={{0,3},{6,9}};
    R2DWorldPortal portal={0,1,0,2,100,0,100,100,false};char err[256];
    CHECK(r2d_world_build_cells(&w,NULL,0,stack,4,cells,2,&portal,1,openings,2,err,sizeof err),"explicit native cells/spans/two-opening portal build");
    CHECK(r2d_world_cell_at(&w,50,50)==0&&r2d_world_cell_at(&w,100,50)==1,"shared XY edge has deterministic half-open owner");
    CHECK(r2d_world_cell_at(&w,200,50)==-1&&r2d_world_cell_at(&w,NAN,50)==-1,"outside/nonfinite cell query rejects");
    CHECK(r2d_world_span_at(&w,50,50,1)==0&&r2d_world_span_at(&w,50,50,7)==1&&r2d_world_span_at(&w,50,50,4)==-1,"same XY resolves two storeys and solid gap");
    CHECK(r2d_world_span_at(&w,50,50,3)==-1,"span top is exclusive");
    int order[2]={-1,-1};
    CHECK(r2d_world_cells_order(&w,150,50,order,2)==2&&order[0]==1&&order[1]==0,"native XY cell BSP traversal near-first");
    CHECK(w.surface_count==10&&r2d_world_surface(&w,6)->cell==1&&!r2d_world_surface(&w,10),"surface enumeration retains cell/span ownership");
    CHECK(r2d_world_portal_passes(&w,0,1,2)&&r2d_world_portal_passes(&w,0,7,8)&&!r2d_world_portal_passes(&w,0,2,7),"multiple portal openings reject solid intervening height");
    CHECK(r2d_world_portal_set_closed(&w,0,true)&&!r2d_world_portal_passes(&w,0,1,2)&&r2d_world_portal_set_closed(&w,0,false),"native closed portal rejects propagation and reopens");
    uint64_t revision=w.geometry_revision;
    CHECK(r2d_world_span_set_heights(&w,2,2,3)&&w.geometry_revision>revision&&r2d_world_support(&w,150,50,2,1,0)==2,"native lift moves only height plane and updates shared support");
    CHECK(!r2d_world_portal_passes(&w,0,1,2)&&r2d_world_portal_passes(&w,0,2,3)&&r2d_world_blocked(&w,100,50,1,0,1),"moving floor clips free portal height and creates solid riser collision");
    float lift_o[3]={50,50,1},lift_d[3]={100,0,0};
    CHECK(r2d_world_ray(&w,lift_o,lift_d,0,1,&hit)&&hit.wall>=0&&fabsf(hit.t-.5f)<1e-5f,"horizontal gameplay and shadow ray hit the same moving riser");
    CHECK(!r2d_world_span_set_heights(&w,2,2,8)&&w.spans[2].top==3,"overlapping lift move rejects transactionally");
    CHECK(r2d_world_span_set_heights(&w,2,0,3)&&!r2d_world_ray(&w,lift_o,lift_d,0,1,&hit),"lowering lift reopens the same ray interval");
    R2DWorldVisibility visibility={0};
    r2d_re2d_view_set(&view,50,50,1.5f,0,0,1.2f,64,48);view.near_plane=.1f;
    CHECK(r2d_world_visibility(&w,&view,0,&visibility)&&visibility.span_count==2&&visibility.cells_visible==2&&!visibility.span_seen[1]&&!visibility.span_seen[3],"portal visibility reaches lower neighbour without leaking to upper storeys");
    float door_o[]={50,50,1.5f},door_d[]={100,0,0};
    CHECK(!r2d_world_ray(&w,door_o,door_d,0,1,&hit)&&!r2d_world_blocked(&w,100,50,1,0,2),"open portal admits collision and ray");
    r2d_world_portal_set_closed(&w,0,true);
    CHECK(r2d_world_visibility(&w,&view,0,&visibility)&&visibility.span_count==1&&visibility.cells_visible==1,"closed portal removes neighbour from native visible set");
    CHECK(r2d_world_ray(&w,door_o,door_d,0,1,&hit)&&r2d_world_blocked(&w,100,50,1,0,2),"same authoritative close operation blocks ray and collision");
    r2d_world_portal_set_closed(&w,0,false);view.yaw=3.14159265f;view.cos_yaw=-1;view.sin_yaw=0;
    CHECK(r2d_world_visibility(&w,&view,0,&visibility)&&visibility.span_count==1,"portal behind camera is clipped");
    r2d_world_visibility_free(&visibility);
    R2DWorldLighting config={true,true,true,false,0,.06f};
    CHECK(r2d_world_set_lighting(&w,&config),"independent native classic/dynamic configuration");
    R2DWorldSpanLight dark={0,1,1,1,0,0,0,0,0};
    for(int i=0;i<4;i++)r2d_world_set_span_light(&w,i,&dark);
    R2DWorldLight lamp={.x=50,.y=50,.h=1.5f,.radius=200,.intensity=1,.r=1,.g=0,.b=0,.shadow=true};
    int lamp_token=r2d_world_light_create(&w,&lamp);float illumination[3];
    CHECK(lamp_token>=0&&r2d_world_light_rebuild(&w)&&w.span_light_counts[2]==1&&w.span_light_counts[1]==0,"light propagation follows lower portal and excludes upper span");
    r2d_world_light_sample(&w,2,150,50,1.5f,-1,0,0,100,illumination);
    CHECK(illumination[0]>.2f&&illumination[1]==0,"red lamp illuminates adjacent receiver through opening");
    r2d_world_portal_set_closed(&w,0,true);r2d_world_light_rebuild(&w);
    r2d_world_light_sample(&w,2,150,50,1.5f,-1,0,0,100,illumination);
    CHECK(w.span_light_counts[2]==0&&illumination[0]==0,"same closed portal invalidates native light propagation");
    r2d_world_portal_set_closed(&w,0,false);lamp.h=7;CHECK(r2d_world_light_update(&w,lamp_token,&lamp)&&r2d_world_light_rebuild(&w)&&w.span_light_counts[0]==0&&w.span_light_counts[3]==1,"upper lamp remains in upper storeys at identical XY");
    float slab_o[]={50,50,7},slab_d[]={0,0,-5};
    CHECK(r2d_world_ray(&w,slab_o,slab_d,.0001f,.9999f,&hit),"solid floor/ceiling geometry blocks cross-storey shadow ray");
    CHECK(r2d_world_light_remove(&w,lamp_token)&&!r2d_world_light_remove(&w,lamp_token)&&!r2d_world_light_update(&w,lamp_token,&lamp),"stale light handles cannot remove or update a reused slot");
    int replacement=r2d_world_light_create(&w,&lamp);CHECK(replacement!=lamp_token,"light pool generations prevent ABA reuse");r2d_world_light_remove(&w,replacement);
    uint8_t albedo_pixel[4]={255,255,255,255},emissive_pixel[4]={220,0,0,255},normal_pixel[4]={128,128,255,255};
    R2DWorldMaterial material={.albedo={albedo_pixel,1,1},.emissive={emissive_pixel,1,1},.emissive_strength=1,.u_scale=1,.v_scale=1,.name="test-emissive"};
    int mat=r2d_world_material_set(&w,&material);CHECK(mat>=0&&r2d_world_surface_material(&w,0,mat),"native material owns independent albedo/emissive images");
    uint32_t material_color;float normal[3]={1,0,0},tangent[3]={0,1,0};
    CHECK(r2d_world_material_color(&w,0,0,0xffffffff,0,0,40,50,1.5f,normal,tangent,0,&material_color)&&(material_color&255)==220&&((material_color>>8)&255)==0,"emissive survives zero ambient without creating a light");
    float debug_normal[3],debug_emissive[3];r2d_world_material_probe(&w,0,0,0,normal,tangent,debug_normal,debug_emissive);
    CHECK(debug_emissive[0]==220&&debug_emissive[1]==0&&debug_normal[0]==1,"material diagnostics read emissive before lighting and fog");
    R2DWorldDecal paint={.surface=0,.material=mat,.u=0,.v=0,.w=16,.h=16,.remaining=.03f};
    int paint_token=r2d_world_decal_create(&w,&paint);
    CHECK(paint_token>=128&&r2d_world_decal_color(&w,&paint,0,8,8,40,50,1.5f,normal,tangent,0,&material_color)&&(material_color&255)==220&&!r2d_world_decal_color(&w,&paint,0,17,8,40,50,1.5f,normal,tangent,0,&material_color),"decal sampling remains within its authoritative surface UV rectangle");
    r2d_world_decal_step(&w,.04f);
    CHECK(w.decal_count==0&&!r2d_world_decal_remove(&w,paint_token),"native decal lifetime invalidates its handle");
    paint.remaining=0;int decal_tokens[R2D_WORLD_MAX_DECALS];for(int i=0;i<R2D_WORLD_MAX_DECALS;i++)decal_tokens[i]=r2d_world_decal_create(&w,&paint);
    CHECK(w.decal_count==R2D_WORLD_MAX_DECALS&&r2d_world_decal_create(&w,&paint)<0&&decal_tokens[0]!=paint_token,"bounded decal pool and generations prevent ABA reuse");
    for(int i=0;i<R2D_WORLD_MAX_DECALS;i++)r2d_world_decal_remove(&w,decal_tokens[i]);
    material.emissive.pixels=NULL;material.emissive.width=material.emissive.height=0;material.normal=(R2DWorldTexture){normal_pixel,1,1};strcpy(material.name,"test-normal");
    int normal_mat=r2d_world_material_set(&w,&material);r2d_world_surface_material(&w,0,normal_mat);
    lamp.h=1.5f;int normal_light=r2d_world_light_create(&w,&lamp);r2d_world_light_rebuild(&w);
    r2d_world_material_color(&w,0,0,0xffffffff,0,0,40,50,1.5f,normal,tangent,0,&material_color);unsigned facing_color=material_color&255;
    normal_pixel[2]=0;r2d_world_material_set(&w,&material);
    r2d_world_material_probe(&w,0,0,0,normal,tangent,debug_normal,debug_emissive);
    CHECK(debug_normal[0]<-.99f&&debug_emissive[0]==0,"normal diagnostics use the same tangent-space decode as shading");
    r2d_world_material_color(&w,0,0,0xffffffff,0,0,40,50,1.5f,normal,tangent,0,&material_color);
    CHECK(facing_color>100&&(material_color&255)==0,"optional normal changes native direct-light response without changing topology");r2d_world_light_remove(&w,normal_light);
    int old_materials=w.material_count;material.albedo.width=4096;
    CHECK(r2d_world_material_set(&w,&material)<0&&w.material_count==old_materials,"invalid material replacement preserves old owned images");
    R2DWorldSpanLight fog={.5f,1,1,1,.1f,0,0,0,1};r2d_world_set_span_light(&w,0,&fog);r2d_world_light_rebuild(&w);
    uint32_t near_color=r2d_world_lit_color(&w,0,0xffffffff,50,50,1,0,0,1,0),far_color=r2d_world_lit_color(&w,0,0xffffffff,50,50,1,0,0,1,30);
    CHECK((near_color&255)==128&&(far_color&255)<(near_color&255)&&((far_color>>16)&255)>((near_color>>16)&255),"independent classic level and monotone blue span fog");
    R2DWorldLight temporary={.x=50,.y=50,.h=1.5f,.radius=200,.intensity=1,.r=1,.shadow=false};
    int temporary_id=r2d_world_light_create(&w,&temporary);
    CHECK(r2d_world_light_visual(&w,temporary_id,.03f,.5f,1,9,42),"native lifetime and seeded flicker configuration");
    r2d_world_light_step(&w,.02f);CHECK(w.light_count==1&&r2d_world_light_update(&w,temporary_id,&temporary),"physical light update preserves native lifetime");
    r2d_world_light_step(&w,.02f);CHECK(w.light_count==0&&!r2d_world_light_remove(&w,temporary_id),"native step expires light and invalidates its handle");
    lamp.radius=-1;CHECK(r2d_world_light_create(&w,&lamp)<0&&w.light_count==0,"invalid light radius does not mutate pool");
    lamp.radius=2;lamp.x=10000;lamp.y=10000;
    for(int i=0;i<128;i++)r2d_world_light_create(&w,&lamp);
    CHECK(w.light_count==128&&r2d_world_light_create(&w,&lamp)<0&&r2d_world_light_rebuild(&w)&&w.light_pairs==0,"128-light stress obeys pool budget and culls outside-map lights");
    int one_token=(int)(w.lights[0].generation*128);lamp.x=50;lamp.y=50;lamp.h=1.5f;lamp.radius=200;
    CHECK(r2d_world_light_update(&w,one_token,&lamp)&&r2d_world_light_rebuild(&w)&&w.light_updates==1&&w.span_light_counts[0]==1,"one changed light rebuilds only its native associations");
    r2d_world_portal_set_closed(&w,0,true);r2d_world_light_rebuild(&w);
    CHECK(w.light_updates==1&&w.span_light_counts[2]==0,"door invalidation excludes 127 remote lights");
    r2d_world_portal_set_closed(&w,0,false);r2d_world_light_rebuild(&w);
    for(int i=1;i<20;i++)r2d_world_light_update(&w,(int)(w.lights[i].generation*128)+(int)i,&lamp);
    r2d_world_light_rebuild(&w);
    CHECK(w.span_light_counts[0]==16&&w.span_light_candidates[0]==20&&w.span_light_refs[15]==15,"incremental light masks retain deterministic slot priority at overflow");
    r2d_world_light_remove(&w,one_token);r2d_world_light_rebuild(&w);
    CHECK(w.light_updates==1&&w.span_light_counts[0]==16&&w.span_light_refs[0]==1&&w.span_light_refs[15]==16,"removal promotes the next overflow candidate without rebuilding other lights");
    portal.cell_b=8;
    CHECK(!r2d_world_build_cells(&w,NULL,0,stack,4,cells,2,&portal,1,openings,2,err,sizeof err)&&w.cell_count==2&&strstr(err,"portal"),"invalid portal reference preserves old world and names geometry");
    portal.cell_b=1;portal.ax=portal.bx=99;
    CHECK(!r2d_world_build_cells(&w,NULL,0,stack,4,cells,2,&portal,1,openings,2,err,sizeof err),"portal must lie on actual common edge");
    const char *json="{\"version\":1,\"walls\":[],\"cells\":[{\"x\":0,\"y\":0,\"w\":10,\"h\":10,\"spans\":[{\"bottom\":0,\"top\":3}]}],\"portals\":[]}";
    CHECK(r2d_world_load_json(&w,json,err,sizeof err)&&r2d_world_span_at(&w,5,5,1)==0,"versioned world JSON loads through native validator");
    CHECK(!r2d_world_load_json(&w,"{\"version\":2}",err,sizeof err)&&w.cell_count==1,"incompatible version preserves loaded map");
    CHECK(!r2d_world_load_json(&w,"{",err,sizeof err)&&w.cell_count==1,"malformed JSON preserves loaded map");
    r2d_world_free(&w);
    // Lookup vs independent rectangle scan across a 128-cell stress map.
    R2DWorldSpan many_spans[128];R2DWorldCell many_cells[128];
    for(int i=0;i<128;i++){float x=(i%16)*10,y=(i/16)*10;many_spans[i]=(R2DWorldSpan){x,y,10,10,0,3,0,0};many_cells[i]=(R2DWorldCell){x,y,10,10,i,1};}
    CHECK(r2d_world_build_cells(&w,NULL,0,many_spans,128,many_cells,128,NULL,0,NULL,0,err,sizeof err),"128 cells build native XY index");
    bool lookup=true;int visits[128],seen[128]={0};
    for(int y=-1;y<=81;y++)for(int x=-1;x<=161;x++){int expected=x>=0&&x<160&&y>=0&&y<80?(y/10)*16+x/10:-1;if(r2d_world_cell_at(&w,x,y)!=expected)lookup=false;}
    CHECK(lookup,"BSP cell lookup matches independent scan including shared boundaries");
    int count=r2d_world_cells_order(&w,15,15,visits,128);bool complete=count==128;
    for(int i=0;i<count&&i<128;i++){if(visits[i]<0||visits[i]>=128||seen[visits[i]]++)complete=false;}
    CHECK(complete,"128-cell traversal enumerates each cell exactly once");
    R2DRe2dWorld brute={0};r2d_world_build(&brute,NULL,0,many_spans,128);bool ray_matches=true;
    for(int i=0;i<1024;i++) {
        float origin[3]={5+(i%16)*10,5+((i/16)%8)*10,1.5f},direction[3]={((i*37)%201)-100.0f,((i*53)%201)-100.0f,((i*11)%17)-8.0f};R2DWorldHit actual,expected;
        bool a=r2d_world_ray(&w,origin,direction,.001f,1,&actual),b=r2d_world_ray(&brute,origin,direction,.001f,1,&expected);
        if(a!=b||(a&&fabsf(actual.t-expected.t)>1e-5f))ray_matches=false;
    }
    CHECK(w.cell_rays_complete&&ray_matches,"native XY ray broadphase matches complete flat queries for 1024 independent rays");r2d_world_free(&brute);
    r2d_re2d_view_set(&view,5,5,1.5f,0,0,1.2f,64,48);view.near_plane=.1f;
    CHECK(r2d_world_visibility(&w,&view,0,&visibility)&&visibility.span_count==1&&visibility.cells_visible==1&&visibility.surface_count==2,"128-cell disconnected map submits only local surfaces");
    CHECK(visibility.bsp_nodes_visited>0&&visibility.bsp_nodes_visited<12,"visible BSP traversal prunes disconnected branches");
    CHECK(r2d_world_visibility(&w,&view,0,&visibility)&&visibility.span_count==1&&visibility.bsp_nodes_visited<12,"reused BSP branch marks clear without visiting the full tree");
    r2d_world_visibility_free(&visibility);
    r2d_world_free(&w);
    R2DWorldSpan slope_span={0,0,100,100,0,80,0xff00ff00,0xff0000ff,.5f,0,0,0};
    R2DWorldCell slope_cell={0,0,100,100,0,1};
    CHECK(r2d_world_build_cells(&w,NULL,0,&slope_span,1,&slope_cell,1,NULL,0,NULL,0,err,sizeof err),"continuous constrained slope builds in native topology");
    CHECK(r2d_world_span_at(&w,50,50,24)==-1&&r2d_world_span_at(&w,50,50,26)==0&&r2d_world_floor_height(&w.spans[0],50,50)==25,"slope spanAt uses local plane height");
    CHECK(r2d_world_support(&w,50,50,25,40,0)==0&&r2d_world_support(&w,90,50,45,40,0)==-1,"slope support/headroom use the same plane equation");
    float slope_o[]={50,50,60},slope_d[]={0,0,-50};
    CHECK(r2d_world_ray(&w,slope_o,slope_d,0,1,&hit)&&fabsf(hit.height-25)<1e-5f,"vertical gameplay ray hits exact continuous slope");
    r2d_re2d_view_set(&view,50,50,60,0,-1.2f,1.2f,64,48);view.near_plane=.1f;
    r2d_world_frame(&w,&view,64,48,fast,fd,0);reference_frame(&w,&view,64,48,reference,rd,0);bool slope_matches=true;
    for(int i=0;i<64*48;i++)if((fd[i]==FLT_MAX)!=(rd[i]==FLT_MAX)||(fd[i]!=FLT_MAX&&fabsf(fd[i]-rd[i])>.02f))slope_matches=false;
    CHECK(slope_matches,"projected continuous slope depth matches independent native ray queries");
    slope_span.ceiling_a=-1;
    CHECK(!r2d_world_build_cells(&w,NULL,0,&slope_span,1,&slope_cell,1,NULL,0,NULL,0,err,sizeof err)&&w.cell_count==1,"crossing floor/ceiling slopes rejected transactionally");
    R2DWorldWall outside_wall={150,0,150,100,0,80,0xff0000ff};slope_span.ceiling_a=0;
    CHECK(r2d_world_build_cells(&w,&outside_wall,1,&slope_span,1,&slope_cell,1,NULL,0,NULL,0,err,sizeof err)&&!w.cell_rays_complete,"unowned exterior wall disables incomplete cell ray acceleration");
    float external_o[]={50,50,60},external_d[]={200,0,0};
    CHECK(r2d_world_ray(&w,external_o,external_d,0,1,&hit)&&hit.wall==0&&fabsf(hit.t-.5f)<1e-5f,"exterior geometry remains reachable through complete ray fallback");
    R2dSb baked;r2d_sb_init(&baked);r2d_sb_puts(&baked,"{\"version\":1,");r2d_world_put_baked(&w,&baked);r2d_sb_putc(&baked,'}');R2DRe2dWorld restored={0};
    CHECK(r2d_world_load_json(&restored,baked.data,err,sizeof err)&&restored.baked_topology&&restored.cell_node_count==w.cell_node_count&&restored.bsp.node_count==0,"baked native tables load without authoring BSP build");
    CHECK(r2d_world_cell_at(&restored,50,50)==0&&r2d_world_ray(&restored,external_o,external_d,0,1,&hit)&&fabsf(hit.t-.5f)<1e-5f,"imported BSP lookup and complete primitive ray fallback preserve geometry");
    R2dJson *parsed=r2d_json_parse(baked.data,err,sizeof err);R2dJson *bo=(R2dJson *)r2d_json_get(parsed,"baked"),*data=(R2dJson *)r2d_json_get(bo,"data"),*sum=(R2dJson *)r2d_json_get(bo,"checksum");
    char saved=sum->string[0];sum->string[0]=saved=='0'?'1':'0';
    CHECK(!r2d_world_load_baked(&restored,bo,err,sizeof err)&&restored.cell_count==1,"corrupt baked checksum rejects transactionally");sum->string[0]=saved;
    size_t front_offset=40+(size_t)w.wall_count*28+(size_t)w.span_count*48+(size_t)w.cell_count*24+(size_t)w.portal_count*36+(size_t)w.opening_count*8+(size_t)w.surface_count*16+8;
    memset(data->string+front_offset*2,'0',8);uint64_t hash=1469598103934665603ULL;
    for(size_t i=0;i<strlen(data->string);i+=2){char pair[3]={data->string[i],data->string[i+1],0};hash=(hash^(uint8_t)strtoul(pair,NULL,16))*1099511628211ULL;}
    snprintf(sum->string,17,"%016llx",(unsigned long long)hash);
    CHECK(!r2d_world_load_baked(&restored,bo,err,sizeof err),"baked BSP cycle rejects even with a recomputed checksum");
    r2d_json_free(parsed);r2d_sb_free(&baked);r2d_world_free(&restored);
    r2d_world_free(&w);
    const char *static_json="{\"version\":1,\"cells\":[{\"x\":0,\"y\":0,\"w\":100,\"h\":100,\"spans\":[{\"bottom\":0,\"top\":100,\"lighting\":{\"level\":0.25,\"color\":\"#ffffff\"}}]}],\"walls\":[],\"portals\":[],\"lights\":[{\"x\":50,\"y\":50,\"h\":40,\"radius\":80,\"color\":\"#ff0000\"}]}";
    CHECK(r2d_world_load_json(&w,static_json,err,sizeof err)&&w.authored_lighting&&w.lights[0].is_static,"authored classic light metadata is validated natively");
    r2d_sb_init(&baked);r2d_sb_puts(&baked,"{\"version\":1,");CHECK(r2d_world_put_baked(&w,&baked),"static native light tables serialize");r2d_sb_putc(&baked,'}');
    CHECK(r2d_world_load_json(&restored,baked.data,err,sizeof err)&&restored.baked_lighting&&restored.authored_lighting&&restored.lights[0].is_static&&restored.span_light_masks[0]==1&&restored.light_links[0].count==1,"baked static lights, candidate masks and link ownership round trip");
    CHECK(r2d_world_light_rebuild(&restored)&&restored.light_updates==0&&restored.span_lights[0].level==.25f,"compiled static lighting does not traverse light graph on startup");
    parsed=r2d_json_parse(baked.data,err,sizeof err);bo=(R2dJson *)r2d_json_get(parsed,"baked");R2dJson *wire=(R2dJson *)r2d_json_get(bo,"version");wire->number=2.5;
    CHECK(!r2d_world_load_baked(&restored,bo,err,sizeof err)&&restored.light_count==1,"fractional baked version rejects transactionally");
    r2d_json_free(parsed);r2d_sb_free(&baked);r2d_world_free(&restored);r2d_world_free(&w);
    R2DWorldSpan actor_span={0,-100,300,200,-100,200,0xffffffff,0xffffffff};
    CHECK(r2d_world_build(&w,NULL,0,&actor_span,1),"sample depth fixture builds");
    r2d_re2d_view_set(&view,0,0,32,0,0,1.2f,64,48);view.near_plane=1;
    const uint8_t actor_pixels[16]={255,0,0,255,0,255,0,255,255,0,0,255,0,255,0,255};const float actor_depth[4]={.25f,-.25f,.25f,-.25f};
    for(int i=0;i<64*48;i++){fd[i]=100;memset(fast+i*4,0,4);}
    r2d_world_stamp_samples(&w,&view,64,48,fast,fd,actor_pixels,actor_depth,2,100,0,0,64,64,0,NULL,0);
    int near_samples=0,far_samples=0;for(int i=0;i<64*48;i++){if(fast[i*4]){near_samples++;if(fabsf(fd[i]-84)>1e-5f)near_samples=-10000;}if(fast[i*4+1])far_samples++;}
    CHECK(near_samples>0&&far_samples==0,"body samples straddling wall depth occlude independently rather than billboard order");
    r2d_world_free(&w);r2d_world_free(&w);return failed?1:0;
}
