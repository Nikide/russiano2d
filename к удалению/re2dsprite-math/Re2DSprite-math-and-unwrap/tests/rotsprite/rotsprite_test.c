#include "rotsprite_math.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures;
#define CHECK(c) do { if (!(c)) { fprintf(stderr,"FAIL line %d: %s\n",__LINE__,#c); failures++; } } while (0)

static void point_fixture(uint8_t *a,int x,int y,int part,int X,int Y,int Z,uint8_t color)
{
    int mx=x/4,my=y/4;
    uint8_t *c=a+(y*1024+x)*4; c[0]=color;c[3]=255;
    uint8_t *id=a+((768+my)*1024+mx)*4;id[0]=(uint8_t)part;id[3]=255;
    uint8_t *z=id+256*4;z[0]=(uint8_t)(Z*4+128);z[3]=255;
    uint8_t *occ=id+512*4;occ[0]=255;occ[3]=255;
    uint8_t *xy=id+768*4;xy[0]=(uint8_t)(X*4+128);xy[1]=(uint8_t)(Y*2+128);xy[3]=255;
}

static void v2_tests(void)
{
    uint8_t *a=calloc(1024*1024,4),*base=malloc(128*128*4),*other=malloc(128*128*4);
    CHECK(a && base && other);if (!a || !base || !other) exit(1);
    uint8_t *header=a+960*1024*4;
    memcpy(header,"R2D",3);header[3]=255;memcpy(header+4,"ROT",3);header[7]=255;header[8]=2;header[9]=4;header[10]=4;header[11]=255;
    CHECK(r2d_rotsprite_v2_header(a,1024,1024,4096));
    CHECK(!r2d_rotsprite_v2_header(a,1024,1023,4096));
    point_fixture(a,128,64,1,0,0,0,100);
    point_fixture(a,832,0,16,0,0,1,200);
    point_fixture(a,832,48,18,0,0,1,150);
    point_fixture(a,512,408,8,-5,40,0,80);
    R2DRotAtlas atlas={0};
    CHECK(r2d_rotsprite_v2_decode(a,1024,1024,4096,&atlas));CHECK(atlas.count==4);
    CHECK(r2d_rotsprite_v2_raster(&atlas,0,0,0,0,base));CHECK(base[(64*128+64)*4]==200);
    CHECK(r2d_rotsprite_v2_raster(&atlas,360,0,0,0,other));CHECK(!memcmp(base,other,128*128*4));
    CHECK(r2d_rotsprite_v2_raster(&atlas,0,0,2,0,other));CHECK(other[(64*128+64)*4]==150);
    CHECK(!r2d_rotsprite_v2_raster(&atlas,NAN,0,0,0,other));
    R2DRotRig rig={.body=true,.stride=30,.phase=0};
    CHECK(r2d_rotsprite_v2_draw(&atlas,0,0,0,0,&rig,base));rig.phase=1.57;
    CHECK(r2d_rotsprite_v2_draw(&atlas,0,0,0,0,&rig,other));CHECK(memcmp(base,other,128*128*4));
    double x,y;r2d_rotsprite_v2_joint(7,-11,18,0,0,0,&rig,&x,&y);double before=x;
    rig.arm_left=90;r2d_rotsprite_v2_joint(7,-11,18,0,0,0,&rig,&x,&y);CHECK(x!=before);
    r2d_rotsprite_v2_free(&atlas);r2d_rotsprite_v2_free(&atlas);CHECK(!atlas.points && !atlas.count);
    uint8_t *id=a+((768+16)*1024+32)*4;id[0]=255;
    CHECK(!r2d_rotsprite_v2_decode(a,1024,1024,4096,&atlas));CHECK(!atlas.points);
    id[0]=1;id[256*4+3]=0;CHECK(!r2d_rotsprite_v2_decode(a,1024,1024,4096,&atlas));
    id[256*4+3]=255;
    for (int dy=0;dy<4;dy++) for (int dx=0;dx<4;dx++) {
        if (!dx && !dy) continue;
        uint8_t *c=a+((64+dy)*1024+128+dx)*4;c[0]=220;c[3]=255;
    }
    CHECK(r2d_rotsprite_v2_decode(a,1024,1024,4096,&atlas));
    for (int i=0;i<atlas.count;i++) if (atlas.points[i].part==1) CHECK(atlas.points[i].rgba[0]==220);
    r2d_rotsprite_v2_free(&atlas);
    R2DRotPoint tied[2]={ {.x=0,.y=0,.z=0,.part=1,.rgba={200,0,0,255}}, {.x=0,.y=0,.z=0,.part=1,.rgba={100,0,0,255}} };
    R2DRotAtlas tie={.points=tied,.count=2};
    CHECK(r2d_rotsprite_v2_raster(&tie,0,0,0,0,base));
    R2DRotPoint swap=tied[0];tied[0]=tied[1];tied[1]=swap;
    CHECK(r2d_rotsprite_v2_raster(&tie,0,0,0,0,other));CHECK(!memcmp(base,other,128*128*4));
    // Smooth output has fractional silhouette coverage, deterministic ties and bounds.
    uint8_t *smooth=malloc(256*256*4+2),*smooth2=malloc(256*256*4);
    CHECK(smooth && smooth2);if (!smooth || !smooth2) exit(1);
    smooth[0]=123;smooth[256*256*4+1]=231;
    CHECK(r2d_rotsprite_v2_anime(&tie,13.5,4.5,0,0,NULL,smooth+1));
    CHECK(smooth[0]==123 && smooth[256*256*4+1]==231);
    int partial=0;for (int i=0;i<256*256;i++) if (smooth[1+i*4+3]>0 && smooth[1+i*4+3]<255) partial++;
    CHECK(partial>0);
    int padded=0;for (int i=0;i<256*256;i++) if (!smooth[1+i*4+3] && smooth[1+i*4]) padded++;
    CHECK(padded>0); // transparent RGB prevents black fringes with linear sampling

    swap=tied[0];tied[0]=tied[1];tied[1]=swap;
    CHECK(r2d_rotsprite_v2_anime(&tie,13.5,4.5,0,0,NULL,smooth2));CHECK(!memcmp(smooth+1,smooth2,256*256*4));
    CHECK(!r2d_rotsprite_v2_anime(&tie,NAN,0,0,0,NULL,smooth2));
    point_fixture(a,128,64,1,0,0,0,100);point_fixture(a,132,64,1,2,0,0,100);
    point_fixture(a,128,68,1,0,2,0,100);point_fixture(a,132,68,1,3,3,0,100);
    R2DRotAtlas dense={0};CHECK(r2d_rotsprite_v2_decode_anime(a,1024,1024,4096,&dense));CHECK(dense.count>0);
    int patches=0;for (int i=0;i<dense.count;i++) if (dense.points[i].patch) patches++;CHECK(patches>=1);
    CHECK(r2d_rotsprite_v2_anime(&dense,0,0,0,0,NULL,smooth2));
    for (int y=132;y<134;y++) for (int x=132;x<134;x++) CHECK(smooth2[(y*256+x)*4+3]==255);
    // Reused native scratch must not leave silhouette/RGB trails after moves,
    // hidden parts, empty frames or changes of pose. Same output as fresh scratch.
    {
    R2DRotAnimeWorkspace cache={0};R2DRotModelPose model={.scale=1};
    model.parts[1].defined=true;model.parts[1].visible=true;
    model.parts[1].matrix[0]=model.parts[1].matrix[5]=model.parts[1].matrix[10]=1;
    R2DRotRig cached_rig={.body=true,.model=&model};
    for(int frame=0;frame<16;frame++) {
        model.parts[1].matrix[3]=(frame%4-2)*40;model.parts[1].matrix[7]=(frame%3-1)*30;
        model.parts[1].visible=frame%5!=0;
        CHECK(r2d_rotsprite_v2_anime_workspace(&dense,frame*31.7,frame%2?25:-15,0,0,&cached_rig,smooth+1,&cache));
        CHECK(r2d_rotsprite_v2_anime(&dense,frame*31.7,frame%2?25:-15,0,0,&cached_rig,smooth2));
        CHECK(!memcmp(smooth+1,smooth2,256*256*4));
    }
    CHECK(!r2d_rotsprite_v2_anime_workspace(&dense,NAN,0,0,0,&cached_rig,smooth2,&cache));
    r2d_rotsprite_anime_workspace_free(&cache);r2d_rotsprite_anime_workspace_free(&cache);
    }
    // Material detail inside a control cell must survive: its corners are red,
    // while the interior is green. Corner-only interpolation would lose it.
    R2DRotPoint detail={.part=1,.patch=true,.textured=true,.rgba={255,0,0,255},.du={2,0,0},.dv={0,2,0}};
    for(int j=0;j<4;j++){detail.colors[j][0]=255;detail.colors[j][3]=255;}
    for(int y=0;y<5;y++)for(int x=0;x<5;x++){
        uint8_t *c=detail.material+(y*5+x)*4;c[3]=255;
        c[(x>0 && x<4 && y>0 && y<4)?1:0]=255;
    }
    R2DRotAtlas detail_atlas={.points=&detail,.count=1};R2DRotAnimeWorkspace hd={0};
    uint8_t *large=malloc(512*512*4+2);CHECK(large);if(!large)exit(1);
    large[0]=123;large[512*512*4+1]=231;
    CHECK(r2d_rotsprite_v2_anime_sized(&detail_atlas,0,0,0,0,NULL,large+1,&hd,512));
    CHECK(large[0]==123 && large[512*512*4+1]==231);
    CHECK(large[1+(264*512+264)*4+1]>240);
    CHECK(!r2d_rotsprite_v2_anime_sized(&detail_atlas,0,0,0,0,NULL,large+1,&hd,513));
    CHECK(r2d_rotsprite_v2_anime_workspace(&detail_atlas,0,0,0,0,NULL,smooth2,&hd));
    CHECK(hd.size==256 && smooth2[(132*256+132)*4+1]>240);
    r2d_rotsprite_anime_workspace_free(&hd);free(large);
    // The atlas map is bilinear, including depth: the centre of a saddle is
    // above z=.5. A diagonal split incorrectly gives z=0 and exposes the red layer.
    R2DRotPoint saddle[2]={
        {.part=1,.patch=true,.z=.5f,.du={4,0,0},.dv={0,4,0}},
        {.part=1,.patch=true,.du={4,0,0},.dv={0,4,0},.duv={0,0,4}}
    };
    for(int i=0;i<2;i++)for(int j=0;j<4;j++){saddle[i].colors[j][i]=255;saddle[i].colors[j][3]=255;}
    R2DRotAtlas curved={.points=saddle,.count=2};
    CHECK(r2d_rotsprite_v2_anime(&curved,0,0,0,0,NULL,smooth2));
    CHECK(smooth2[(136*256+136)*4+1]==255);
    R2DRotPoint gradient={.part=1,.patch=true,.textured=true,.du={4,0,0},.dv={0,4,0},.duv={2,0,0}};
    for(int y=0;y<5;y++)for(int x=0;x<5;x++){
        uint8_t *c=gradient.material+(y*5+x)*4;c[0]=x*50;c[1]=y*50;c[3]=255;
    }
    curved.points=&gradient;curved.count=1;
    CHECK(r2d_rotsprite_v2_anime(&curved,0,0,0,0,NULL,smooth2));
    // Pixel centre: Y=2.125 -> v=.53125; X=2.625 -> u=X/(4+2v).
    CHECK(abs((int)smooth2[(136*256+138)*4]-104)<=1);
    CHECK(abs((int)smooth2[(136*256+138)*4+1]-106)<=1);
    // SUB retains fractional coordinates and transparent control points. Legacy
    // v2 above is still decoded without interpreting its decorative channels.
    memcpy(header+12,"SUB",3);header[15]=255;
    id[768*4+2]=0xA5;id[256*4+1]=7*17;
    CHECK(r2d_rotsprite_v2_decode(a,1024,1024,4096,&atlas));
    for(int i=0;i<atlas.count;i++)if(atlas.points[i].part==1 && atlas.points[i].x<1){
        if(atlas.points[i].y<1){CHECK(fabs(atlas.points[i].x-10.0/64)<1e-6);CHECK(fabs(atlas.points[i].y-5.0/32)<1e-6);}
    }
    r2d_rotsprite_v2_free(&atlas);
    id[512*4]=128;a[(64*1024+128)*4+3]=0;
    CHECK(r2d_rotsprite_v2_decode(a,1024,1024,4096,&atlas));r2d_rotsprite_v2_free(&atlas);
    r2d_rotsprite_v2_free(&dense);free(smooth);free(smooth2);
    R2DRotPoint far_eye={.x=5,.y=9,.z=10,.part=16,.rgba={255,100,0,255}};
    R2DRotAtlas face={.points=&far_eye,.count=1};
    CHECK(r2d_rotsprite_v2_raster(&face,90,0,0,0,base));
    int visible=0;for (int i=0;i<128*128;i++) visible+=base[i*4+3]!=0;CHECK(!visible);
    CHECK(r2d_rotsprite_v2_raster(&face,-90,0,0,0,other));
    visible=0;for (int i=0;i<128*128;i++) visible+=other[i*4+3]!=0;CHECK(visible>0);
    R2DRotRig turned={.body=true,.head_yaw=90};
    CHECK(r2d_rotsprite_v2_draw(&face,0,0,0,0,&turned,base));
    visible=0;for (int i=0;i<128*128;i++) visible+=base[i*4+3]!=0;CHECK(!visible);
    uint8_t *side=malloc(256*256*4);CHECK(side);if (!side) exit(1);
    CHECK(r2d_rotsprite_v2_anime(&face,90,0,0,0,NULL,side));
    visible=0;for (int i=0;i<256*256;i++) visible+=side[i*4+3]!=0;CHECK(!visible);
    CHECK(r2d_rotsprite_v2_anime(&face,-90,0,0,0,NULL,side));
    visible=0;for (int i=0;i<256*256;i++) visible+=side[i*4+3]!=0;CHECK(visible>0);
    // JSON model path: arbitrary IDs, explicit transforms and visibility.
    R2DRotPoint prop={.x=0,.y=0,.z=0,.part=80,.rgba={40,200,70,255}};
    R2DRotAtlas object={.points=&prop,.count=1};
    R2DRotModelPose model={.scale=1};
    model.parts[80]=(R2DRotPartPose){.defined=true,.visible=true,.matrix={1,0,0,5,0,1,0,3,0,0,1,0}};
    R2DRotRig generic={.body=true,.model=&model};
    CHECK(r2d_rotsprite_v2_draw(&object,0,0,0,0,&generic,base));
    CHECK(base[(67*128+69)*4+3]==255);
    CHECK(r2d_rotsprite_v2_anime(&object,0,0,0,0,&generic,side));
    visible=0;for(int i=0;i<256*256;i++) visible+=side[i*4+3]!=0;CHECK(visible>0);
    // A half-weight 90-degree bend preserves radius (linear blending shrinks it).
    prop.x=10;prop.blend_part=81;prop.blend_weight=128;
    model.parts[80].matrix[3]=model.parts[80].matrix[7]=0;
    model.parts[81]=(R2DRotPartPose){.defined=true,.visible=true,.matrix={0,-1,0,0,1,0,0,0,0,0,1,0}};
    CHECK(r2d_rotsprite_v2_draw(&object,0,0,0,0,&generic,base));
    CHECK(base[(71*128+71)*4+3]==255);
    CHECK(base[(69*128+69)*4+3]==0);
    // Zero weight exactly preserves the primary transform.
    prop.blend_weight=0;
    CHECK(r2d_rotsprite_v2_draw(&object,0,0,0,0,&generic,base));
    CHECK(base[(64*128+74)*4+3]==255);
    prop.x=0;prop.blend_part=0;
    model.parts[80].visible=false;
    CHECK(r2d_rotsprite_v2_draw(&object,0,0,0,0,&generic,base));
    visible=0;for(int i=0;i<128*128;i++) visible+=base[i*4+3]!=0;CHECK(!visible);
    model.parts[80].visible=true;model.parts[80].defined=false;
    CHECK(r2d_rotsprite_v2_anime(&object,0,0,0,0,&generic,side));
    visible=0;for(int i=0;i<256*256;i++) visible+=side[i*4+3]!=0;CHECK(!visible);
    free(side);
    free(a);free(base);free(other);
}

int main(void)
{
    v2_tests();
    enum { W = 64, S = 64*64*4 };
    // Три независимых материала: затылок/фронт/уши. Ракурсов в фикстуре нет.
    uint8_t atlas[W*W*4], base[S], other[S], guard[S+2];
    for (int y=0;y<W;y++) for (int x=0;x<W;x++) {
        uint8_t *p = atlas+(y*W+x)*4;
        p[0] = x < 32 && x >= 10 && x < 22 ? 220 : 30;
        p[1] = x >= 32 && x < 48 && y < 16 ? 200 : 40;
        p[2] = x >= 32 && x < 48 && y >= 8 && y < 16 ? 180 : 50;
        p[3] = x >= 48 || y >= 16 ? 0 : 255;
    }
    CHECK(r2d_rotsprite_layout(512,512,NULL));
    CHECK(!r2d_rotsprite_layout(192,64,NULL));
    CHECK(!r2d_rotsprite_layout(65,65,NULL));
    CHECK(!r2d_rotsprite_layout(4096,4096,NULL));
    CHECK(r2d_rotsprite_raster(atlas,W,W,W*4,0,0,base));
    CHECK(base[(32*64+32)*4] == 220);
    CHECK(base[3] == 0);
    CHECK(r2d_rotsprite_raster(atlas,W,W,W*4,180,0,other));
    CHECK(other[(32*64+32)*4] == 30);
    CHECK(memcmp(base,other,S) != 0);
    CHECK(r2d_rotsprite_raster(atlas,W,W,W*4,360,0,other));
    CHECK(memcmp(base,other,S) == 0);
    CHECK(r2d_rotsprite_raster(atlas,W,W,W*4,-180,0,base));
    CHECK(r2d_rotsprite_raster(atlas,W,W,W*4,180,0,other));
    CHECK(memcmp(base,other,S) == 0);
    CHECK(!r2d_rotsprite_raster(atlas,W,W,W*4,NAN,0,other));
    CHECK(!r2d_rotsprite_raster(atlas,W,W,W*4,0,INFINITY,other));
    CHECK(!r2d_rotsprite_raster(atlas,W,W,1,0,0,other));
    for (int yaw=-180;yaw<=180;yaw+=15) for (int pitch=-75;pitch<=75;pitch+=25) {
        guard[0]=123; guard[S+1]=231;
        CHECK(r2d_rotsprite_raster(atlas,W,W,W*4,yaw,pitch,guard+1));
        CHECK(guard[0]==123 && guard[S+1]==231);
        for (int i=0;i<S;i+=4) {
            const uint8_t *p=guard+1+i;
            if (!p[3]) { CHECK(p[0]==0 && p[1]==0 && p[2]==0); continue; }
            bool found=false;
            for (int j=0;j<W*W*4;j+=4) if (memcmp(p,atlas+j,4)==0) {found=true;break;}
            CHECK(found);
        }
    }
    memset(atlas,0,sizeof atlas);
    memset(other,255,sizeof other);
    CHECK(r2d_rotsprite_raster(atlas,W,W,W*4,35,45,other));
    for (int i=0;i<S;i++) CHECK(other[i]==0);
    printf("RotSprite: %s\n",failures ? "FAIL" : "all checks passed");
    return failures ? EXIT_FAILURE : EXIT_SUCCESS;
}
