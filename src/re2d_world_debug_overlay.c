#include "re2d_world_debug_overlay.h"
#include <math.h>

const char *r2d_world_debug_mode_name(int mode)
{
    static const char *const names[R2D_WORLD_DEBUG_COUNT]={
        "final","cell-id","span-id","depth","owner","light-level","dynamic-light-count",
        "normal","emissive","bsp","portals","shadow-mask","overdraw",
        "region","active-region","pvs","vis-cluster","areaportal","occluder",
        "distant-lod","sprite-lod","material-variation","ao-lite","vfx-budget"};
    if(mode<0||mode>=R2D_WORLD_DEBUG_COUNT)return "";
    return names[mode];
}

static uint32_t dbg_color(uint32_t seed,float scale)
{
    seed^=seed>>16;seed*=0x7feb352du;seed^=seed>>15;seed*=0x846ca68bu;seed^=seed>>16;
    float r=(float)(seed&255)/255.0f*scale;
    float g=(float)((seed>>8)&255)/255.0f*scale;
    float b=(float)((seed>>16)&255)/255.0f*scale;
    return 0xff000000u|((uint32_t)(b*255)<<16)|((uint32_t)(g*255)<<8)|(uint32_t)(r*255);
}
static void dbg_blend(uint8_t *rgba,int width,int height,int x,int y,uint32_t color,float alpha)
{
    if(!rgba||x<0||y<0||x>=width||y>=height)return;
    if(!(alpha>0.0f))return;if(alpha>1.0f)alpha=1.0f;
    uint8_t *p=rgba+((size_t)y*(size_t)width+(size_t)x)*4u;
    for(int c=0;c<3;c++){float src=(float)((color>>(c*8))&255);p[c]=(uint8_t)(p[c]*(1.0f-alpha)+src*alpha+0.5f);}
    p[3]=255;
}
static bool dbg_project(const R2DRe2dView *v,float x,float y,float z,float out[4])
{
    if(!v||!r2d_re2d_project(v,x,y,z,out))return false;
    return isfinite(out[0])&&isfinite(out[1]);
}
static void dbg_line(uint8_t *rgba,int width,int height,const R2DRe2dView *v,float w,
                     float x0,float y0,float z0,float x1,float y1,float z1,uint32_t color,float alpha)
{
    float a[4],b[4];if(!dbg_project(v,x0,y0,z0,a)||!dbg_project(v,x1,y1,z1,b))return;
    float sx=(float)width/(float)v->width,sy=(float)height/(float)v->height;
    float ax=a[0]*sx,ay=a[1]*sy,bx=b[0]*sx,by=b[1]*sy;
    int steps=(int)fmaxf(fabsf(bx-ax),fabsf(by-ay));
    if(steps<1)steps=1;if(steps>4096)steps=4096;
    for(int i=0;i<=steps;i++){float t=(float)i/(float)steps;
        dbg_blend(rgba,width,height,(int)(ax+(bx-ax)*t),(int)(ay+(by-ay)*t),color,alpha);}
    (void)w;
}
static void dbg_world_rect(uint8_t *rgba,int width,int height,const R2DRe2dView *v,
                           float x,float y,float ww,float hh,float z,uint32_t color,bool fill,float alpha)
{
    if(fill){
        float cx[4],cy[4];const float xs[4]={x,x+ww,x+ww,x},ys[4]={y,y,y+hh,y+hh};int n=0;
        for(int i=0;i<4;i++){float p[4];if(dbg_project(v,xs[i],ys[i],z,p)){cx[n]=p[0];cy[n]=p[1];n++;}}
        if(n<3)return;
        float left=cx[0],right=cx[0],top=cy[0],bottom=cy[0];
        for(int i=1;i<n;i++){left=fminf(left,cx[i]);right=fmaxf(right,cx[i]);top=fminf(top,cy[i]);bottom=fmaxf(bottom,cy[i]);}
        float sx=(float)width/(float)v->width,sy=(float)height/(float)v->height;
        int x0=(int)fmaxf(0,left*sx),x1=(int)fminf(width-1,right*sx);
        int y0=(int)fmaxf(0,top*sy),y1=(int)fminf(height-1,bottom*sy);
        for(int py=y0;py<=y1;py++)for(int px=x0;px<=x1;px++)dbg_blend(rgba,width,height,px,py,color,alpha);
        return;
    }
    dbg_line(rgba,width,height,v,ww,x,y,z,x+ww,y,z,color,alpha);
    dbg_line(rgba,width,height,v,ww,x+ww,y,z,x+ww,y+hh,z,color,alpha);
    dbg_line(rgba,width,height,v,ww,x+ww,y+hh,z,x,y+hh,z,color,alpha);
    dbg_line(rgba,width,height,v,ww,x,y+hh,z,x,y,z,color,alpha);
}
static void dbg_budget_bar(uint8_t *rgba,int width,int height,int row,int used,int max,uint32_t color)
{
    if(max<=0)max=1;
    int bx=8,by=8+row*7,bw=(width/3>16?width/3:16),bh=4;
    for(int y=by;y<by+bh;y++)for(int x=bx;x<bx+bw;x++)dbg_blend(rgba,width,height,x,y,0xff101010,0.75f);
    int fill=(int)((float)(used>max?max:used)/(float)max*(float)bw);
    if(fill<0)fill=0;
    for(int y=by;y<by+bh;y++)for(int x=bx;x<bx+fill;x++)dbg_blend(rgba,width,height,x,y,color,0.95f);
}
static bool dbg_pvs_visible(const R2DWorldRegionSet *set,int from,int to)
{
    if(!set||!set->pvs||set->pvs_words<=0||from<0||from>=set->region_count||to<0||to>=set->region_count)return false;
    return (set->pvs[(size_t)to*(size_t)set->pvs_words+(size_t)(from/64)]&(1ULL<<(from%64)))!=0;
}
static void dbg_variation(uint32_t surface,uint32_t material,uint32_t seed,float strength,float tint[3],float uv[2])
{
    uint32_t h0=dbg_color(seed^surface*3u+material,1.0f);
    uint32_t h1=dbg_color(seed^material*7u+surface*11u,1.0f);
    float n0=(float)(h0&255)/255.0f,n1=(float)(h1&255)/255.0f;
    float span=0.22f*(isfinite(strength)?strength:0.0f);
    for(int i=0;i<3;i++)tint[i]=1.0f+(n0*2.0f-1.0f)*span;
    uv[0]=n1;uv[1]=n0;
}
void r2d_world_debug_overlay_draw(const R2DWorldDebugOverlayContext *ctx,
                                  const R2DRe2dView *view,
                                  int width,int height,uint8_t *rgba)
{
    if(!ctx||!view||!rgba||width<=0||height<=0)return;
    if(ctx->view<R2D_WORLD_DEBUG_REGION||ctx->view>=R2D_WORLD_DEBUG_COUNT)return;
    const R2DWorldRegionSet *set=ctx->regions;
    switch(ctx->view){
    case R2D_WORLD_DEBUG_REGION:
        if(!set||set->region_count<=0)break;
        for(int r=0;r<set->region_count;r++){
            const R2DWorldRegion *g=&set->regions[r];uint32_t color=dbg_color((uint32_t)(g->col*131+g->row*17),0.85f);
            dbg_world_rect(rgba,width,height,view,g->x,g->y,g->w,g->h,0.0f,color,false,0.85f);
        }
        break;
    case R2D_WORLD_DEBUG_ACTIVE_REGION:
        if(!set||set->region_count<=0)break;
        for(int r=0;r<set->region_count;r++){
            const R2DWorldRegion *g=&set->regions[r];uint8_t st=ctx->region_states?ctx->region_states[r]:0;
            uint32_t color=st==R2D_WORLD_REGION_ACTIVE?0xff40ff40u:
                (st==R2D_WORLD_REGION_PRELOADING||st==R2D_WORLD_REGION_RESIDENT)?0xff40c0ffu:0xff302020u;
            dbg_world_rect(rgba,width,height,view,g->x,g->y,g->w,g->h,0.0f,color,true,0.22f);
            dbg_world_rect(rgba,width,height,view,g->x,g->y,g->w,g->h,0.0f,color,false,0.55f);
        }
        break;
    case R2D_WORLD_DEBUG_PVS:
        if(!set||set->region_count<=0)break;
        for(int r=0;r<set->region_count;r++){
            const R2DWorldRegion *g=&set->regions[r];
            bool visible=dbg_pvs_visible(set,ctx->region_current,r);
            dbg_world_rect(rgba,width,height,view,g->x,g->y,g->w,g->h,0.0f,
                           visible?0xff40ffffu:0xff402020u,true,visible?0.24f:0.16f);
        }
        break;
    case R2D_WORLD_DEBUG_VISCLUSTER:
        if(!set||set->region_count<=0||!ctx->clusters||ctx->clusters->cluster_count<=0||ctx->region_current<0||ctx->region_current>=set->region_count)break;
        {
            const R2DWorldRegion *g=&set->regions[ctx->region_current];
            for(int k=0;k<g->cell_count;k++){
                int cell=g->first_cell+k;int cell_id=set->region_cells?set->region_cells[cell]:-1;
                if(cell_id<0||cell_id>=(ctx->world?ctx->world->cell_count:0))continue;
                int cluster=(ctx->clusters->cell_cluster&&cell_id<ctx->clusters->cell_cluster_capacity?ctx->clusters->cell_cluster[cell_id]:-1);
                const R2DWorldCell *rcell=&ctx->world->cells[cell_id];
                dbg_world_rect(rgba,width,height,view,rcell->x,rcell->y,rcell->w,rcell->h,0.0f,
                               dbg_color((uint32_t)(cluster<0?0:cluster+1),0.9f),true,0.30f);
            }
        }
        break;
    case R2D_WORLD_DEBUG_AREAPORTAL:
        for(int i=0;i<(ctx->world?ctx->world->portal_count:0);i++){
            const R2DWorldPortal *p=&ctx->world->portals[i];
            if(!p->area_portal)continue;
            uint32_t color=p->closed?0xff3030ffu:0xff30ffffu;
            dbg_line(rgba,width,height,view,0,p->ax,p->ay,0.0f,p->bx,p->by,0.0f,color,0.95f);
            dbg_line(rgba,width,height,view,0,p->ax,p->ay,48.0f,p->bx,p->by,48.0f,color,0.55f);
        }
        break;
    case R2D_WORLD_DEBUG_OCCLUDER:
        for(int i=0;i<ctx->occluder_count;i++){
            const R2DWorldOccluder *o=&ctx->occluders[i];
            dbg_line(rgba,width,height,view,0,o->x1,o->y1,0.0f,o->x2,o->y2,0.0f,0xff40ffffu,0.9f);
            dbg_line(rgba,width,height,view,0,o->x1,o->y1,96.0f,o->x2,o->y2,96.0f,0xff40ffffu,0.45f);
        }
        break;
    case R2D_WORLD_DEBUG_DISTANT_LOD:
        for(int i=0;i<ctx->impostor_count;i++){
            const R2DWorldImpostor *im=&ctx->impostors[i];if(!im->valid)continue;
            uint32_t color=im->distance>6000.0f?0xff30a0ffu:0xff40ff80u;
            dbg_world_rect(rgba,width,height,view,im->cx-im->width*0.5f,im->cy-im->height*0.5f,im->width,im->height,
                           im->bottom,color,false,0.6f);
            dbg_world_rect(rgba,width,height,view,im->cx-im->width*0.5f,im->cy-im->height*0.5f,im->width,im->height,
                           im->top,color,false,0.25f);
        }
        break;
    case R2D_WORLD_DEBUG_SPRITE_LOD:
        for(int i=0;i<ctx->frame_count;i++){
            if(!ctx->frame_images[i])continue;
            const float *p=ctx->frame_positions+i*5;
            float dx=p[0]-view->x,dy=p[1]-view->y;float dist=sqrtf(dx*dx+dy*dy);
            uint32_t color=dist>6000.0f?0xff30a0ffu:
                dist>1500.0f?0xff40c0ffu:
                dist>500.0f?0xff40ff80u:0xff40ffffu;
            dbg_world_rect(rgba,width,height,view,p[0]-p[3]*0.5f,p[1]-p[3]*0.5f,p[3]*2.0f,p[3]*2.0f,
                           p[2],color,false,0.55f);
        }
        break;
    case R2D_WORLD_DEBUG_MATERIAL_VARIATION:
        for(int i=0;i<width*height;i++){
            int surface=ctx->owners?ctx->owners[i].surface:-1;if(surface<0||!(ctx->world?ctx->world->surface_materials:NULL))continue;
            int material=(ctx->world?ctx->world->surface_materials:NULL)[surface];
            float tint[3],uv[2];
            dbg_variation((uint32_t)surface,(uint32_t)material,(ctx->features?ctx->features->seed:0),
                          (ctx->features?ctx->features->variation_strength:0.0f),tint,uv);
            uint8_t *px=rgba+((size_t)i)*4u;
            px[0]=(uint8_t)fminf(255.0f,tint[0]*180.0f);
            px[1]=(uint8_t)fminf(255.0f,tint[1]*180.0f);
            px[2]=(uint8_t)fminf(255.0f,tint[2]*180.0f);
            px[3]=255;
        }
        break;
    case R2D_WORLD_DEBUG_AO:
        for(int i=0;i<width*height;i++){
            int span=ctx->owners?ctx->owners[i].span:-1;if(span<0||span>=(ctx->world?ctx->world->span_count:0))continue;
            const R2DWorldSpan *sp=&ctx->world->spans[span];
            float floor_h=sp->bottom;
            float ceil_h=sp->top;
            float gap=fmaxf(0.0f,ceil_h-floor_h);
            float ao=1.0f-fminf(1.0f,gap/512.0f);
            uint8_t v=(uint8_t)(ao*220.0f);
            uint8_t *px=rgba+((size_t)i)*4u;
            px[0]=(uint8_t)(v*0.55f);px[1]=(uint8_t)(v*0.75f);px[2]=v;px[3]=255;
        }
        break;
    case R2D_WORLD_DEBUG_VFX_BUDGET:
        dbg_budget_bar(rgba,width,height,0,ctx->particles_count,ctx->particles_capacity>0?ctx->particles_capacity:1,0xff40ff80u);
        dbg_budget_bar(rgba,width,height,1,ctx->decal_count,R2D_WORLD_MAX_DECALS,0xff40c0ffu);
        dbg_budget_bar(rgba,width,height,2,ctx->light_count,R2D_WORLD_MAX_LIGHTS,0xffffff40u);
        dbg_budget_bar(rgba,width,height,3,ctx->actors,300,0xffff8040u);
        dbg_budget_bar(rgba,width,height,4,ctx->active_regions,9,0xffff40ffu);
        dbg_budget_bar(rgba,width,height,5,ctx->stream_uploads,
                       ctx->stream_budget>0?ctx->stream_budget:1,0xff80ffffu);
        break;
    default:break;
    }
}

