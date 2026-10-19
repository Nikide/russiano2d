#include "re2d_world.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <limits.h>
void r2d_world_material_free(R2DWorldMaterial *m)
{ if(!m)return;free(m->albedo.pixels);free(m->normal.pixels);free(m->emissive.pixels);memset(m,0,sizeof *m); }
// Definition-capacity growth for the dynamic material bank. The texture bytes
// and the GPU-resident set are separate concerns: growing the bank never forces
// a material texture to become GPU-resident.
static bool material_reserve(R2DRe2dWorld *w,int need)
{
    if(!w||need<0)return false;
    if(need<=w->material_capacity)return true;
    int capacity=w->material_capacity>0?w->material_capacity:R2D_WORLD_MAX_MATERIALS;
    while(capacity<need){
        if(capacity>INT_MAX/2){capacity=need;break;}
        capacity*=2;
    }
    if((size_t)capacity>SIZE_MAX/sizeof(R2DWorldMaterial))return false;
    R2DWorldMaterial *grown=realloc(w->materials,(size_t)capacity*sizeof *grown);
    if(!grown)return false;
    memset(grown+w->material_capacity,0,(size_t)(capacity-w->material_capacity)*sizeof *grown);
    w->materials=grown;w->material_capacity=capacity;
    return true;
}
bool r2d_world_material_ensure(R2DRe2dWorld *w,int slots)
{
    return material_reserve(w,slots);
}
int r2d_world_material_find(const R2DRe2dWorld *w,const char *name)
{
    if(!w||!name)return -1;
    for(int i=0;i<w->material_capacity;i++)if(w->materials[i].used&&!strcmp(w->materials[i].name,name))return i;
    return -1;
}
static bool texture_copy(R2DWorldTexture *to,const R2DWorldTexture *from,bool required)
{
    if(!from->pixels)return !required&&from->width==0&&from->height==0;
    if(from->width<1||from->height<1||from->width>R2D_WORLD_MATERIAL_TEXTURE_MAX||from->height>R2D_WORLD_MATERIAL_TEXTURE_MAX)return false;
    size_t size=(size_t)from->width*from->height*4;to->pixels=malloc(size);if(!to->pixels)return false;
    memcpy(to->pixels,from->pixels,size);to->width=from->width;to->height=from->height;return true;
}
int r2d_world_material_set(R2DRe2dWorld *w,const R2DWorldMaterial *m)
{
    if(!w||!m||!memchr(m->name,0,sizeof m->name)||!m->name[0]||!isfinite(m->emissive_strength)||m->emissive_strength<0||m->emissive_strength>100||
        m->blend<0||m->blend>3||!isfinite(m->opacity)||m->opacity<0||m->opacity>1||!isfinite(m->u_scale)||!isfinite(m->v_scale)||m->u_scale<=0||m->v_scale<=0||m->u_scale>1000000||m->v_scale>1000000)return -1;
    int index=r2d_world_material_find(w,m->name);
    if(index<0)for(int i=0;i<w->material_capacity;i++)if(!w->materials[i].used){index=i;break;}
    if(index<0){index=w->material_count;if(!material_reserve(w,index+1))return -1;}
    if(index<0||index>=w->material_capacity)return -1;
    R2DWorldMaterial next={0};
    if(!texture_copy(&next.albedo,&m->albedo,true)||!texture_copy(&next.normal,&m->normal,false)||!texture_copy(&next.emissive,&m->emissive,false)){r2d_world_material_free(&next);return -1;}
    if(!w->surface_materials&&w->surface_count) {
        int *refs=malloc((size_t)w->surface_count*sizeof(int));if(!refs){r2d_world_material_free(&next);return -1;}
        for(int i=0;i<w->surface_count;i++)refs[i]=-1;w->surface_materials=refs;
    }
    memcpy(next.name,m->name,sizeof next.name);next.u_scale=m->u_scale;next.v_scale=m->v_scale;next.emissive_strength=m->emissive_strength;next.used=true;next.blend=m->blend;next.opacity=m->opacity;next.world_uv=m->world_uv;next.linear=m->linear;
    if(!w->materials[index].used)w->material_count++;r2d_world_material_free(&w->materials[index]);w->materials[index]=next;return index;
}
bool r2d_world_surface_material(R2DRe2dWorld *w,int surface,int material)
{
    if(!w||surface<0||surface>=w->surface_count||material<0||material>=w->material_capacity||!w->materials[material].used)return false;
    w->surface_materials[surface]=material;return true;
}
void r2d_world_texture_sample(const R2DWorldTexture *t,float u,float v,bool linear,bool clamp_v,uint8_t out[4]) {
    u-=floorf(u);v=clamp_v?fmaxf(0,fminf(1,v)):v-floorf(v);
    if(!linear){int x=(int)fminf(t->width-1,u*t->width),y=(int)fminf(t->height-1,v*t->height);memcpy(out,t->pixels+((size_t)y*t->width+x)*4,4);return;}
    float px=u*t->width-.5f,py=v*t->height-.5f;int x=(int)floorf(px),y=(int)floorf(py);float fx=px-x,fy=py-y;
    float sum[4]={0};
    for(int j=0;j<2;j++)for(int i=0;i<2;i++){
        int tx=(x+i+t->width)%t->width,ty=clamp_v?(int)fmaxf(0,fminf(t->height-1,y+j)):(y+j+t->height)%t->height;
        const uint8_t *p=t->pixels+((size_t)ty*t->width+tx)*4;float weight=(i?fx:1-fx)*(j?fy:1-fy);
        for(int c=0;c<4;c++)sum[c]+=p[c]*weight;
    }
    for(int c=0;c<4;c++)out[c]=(uint8_t)fmaxf(0,fminf(255,roundf(sum[c])));
}
static const uint8_t *texel(const R2DWorldTexture *t,float u,float v,bool linear,uint8_t out[4]){r2d_world_texture_sample(t,u,v,linear,false,out);return out;}
static void mapped_normal(const R2DWorldMaterial *m,float u,float v,const float normal[3],const float tangent[3],float n[3])
{
    memcpy(n,normal,3*sizeof(float));
    if(m->normal.pixels) {
        uint8_t sample[4];const uint8_t *map=texel(&m->normal,u,v,m->linear,sample);float a=map[0]/127.5f-1,b=map[1]/127.5f-1,c=map[2]/127.5f-1;
        float bitangent[3]={normal[1]*tangent[2]-normal[2]*tangent[1],normal[2]*tangent[0]-normal[0]*tangent[2],normal[0]*tangent[1]-normal[1]*tangent[0]};
        for(int i=0;i<3;i++)n[i]=tangent[i]*a+bitangent[i]*b+normal[i]*c;
        float length=sqrtf(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]);if(length>1e-6f)for(int i=0;i<3;i++)n[i]/=length;else memcpy(n,normal,3*sizeof(float));
    }
}
void r2d_world_material_probe(const R2DRe2dWorld *w,int surface,float u,float v,const float normal[3],const float tangent[3],float n[3],float emissive[3])
{
    memcpy(n,normal,3*sizeof(float));memset(emissive,0,3*sizeof(float));
    int id=w->surface_materials&&surface>=0&&surface<w->surface_count?w->surface_materials[surface]:-1;
    if(id<0)return;
    const R2DWorldMaterial *m=&w->materials[id];u=u*m->u_scale+m->anim_u;v=v*m->v_scale+m->anim_v;
    mapped_normal(m,u,v,normal,tangent,n);
    if(m->emissive.pixels){uint8_t sample[4];const uint8_t *map=texel(&m->emissive,u,v,m->linear,sample);for(int i=0;i<3;i++)emissive[i]=map[i]*m->emissive_strength;}
}
static bool material_color_id(const R2DRe2dWorld *w,int id,int span,uint32_t tint,float u,float v,float x,float y,float h,const float normal[3],const float tangent[3],float depth,const R2DWorldRenderFeatures *features,uint32_t *out)
{
    if(id<0){*out=r2d_world_lit_color(w,span,tint,x,y,h,normal[0],normal[1],normal[2],depth);return true;}
    const R2DWorldMaterial *m=&w->materials[id];u=u*m->u_scale+m->anim_u;v=v*m->v_scale+m->anim_v;
    const float anim_emissive=m->anim_emissive>0?m->anim_emissive:1.0f;
    uint8_t sampled[4],emitted[4];const uint8_t *albedo=texel(&m->albedo,u,v,m->linear,sampled);if((m->blend==R2D_WORLD_MASKED&&albedo[3]<128)||(m->blend>=R2D_WORLD_TRANSLUCENT&&(albedo[3]==0||m->opacity==0)))return false;
    float n[3]={normal[0],normal[1],normal[2]};
    mapped_normal(m,u,v,normal,tangent,n);
    float light[3];r2d_world_light_sample(w,span,x,y,h,n[0],n[1],n[2],depth,light);
    const uint8_t *emissive=m->emissive.pixels?texel(&m->emissive,u,v,m->linear,emitted):NULL;
    const R2DWorldSpanLight *ambient=w->lighting.enabled&&w->span_lights&&span>=0&&span<w->span_count?&w->span_lights[span]:NULL;
    uint32_t color=0xff000000;
    // R-02 CPU reference for the atmosphere branch: same bounded height fog and
    // haze composition as shaders/world.frag.glsl. With NULL features (legacy
    // callers) this is the historical authored-distance fog only, unchanged.
    if(features&&(features->height_fog||features->atmospheric_haze)){
        float base_optical=ambient?ambient->fog_density*fmaxf(0.0f,depth-ambient->fog_start):0.0f;
        float height_factor=ambient?r2d_world_render_fog_height_factor(depth,h,features):0.0f;
        double height_field=height_factor>=1.0f?1.0e30:-(double)log(1.0-(double)height_factor);
        float fog=(float)(1.0-exp(-((double)base_optical+height_field)));
        if(!(fog>0.0f))fog=0.0f;else if(fog>1.0f)fog=1.0f;
        float fog_rgb[3]={ambient?ambient->fog_r:0.0f,ambient?ambient->fog_g:0.0f,ambient?ambient->fog_b:0.0f};
        float haze_rgb[3];r2d_world_render_haze_color(features,w->sky_color,haze_rgb);
        float fogcol[3];
        for(int c=0;c<3;c++)fogcol[c]=fog_rgb[c]+(haze_rgb[c]-fog_rgb[c])*features->haze_strength*0.65f;
        float scene[3];
        for(int c=0;c<3;c++){
            // Albedo/emissive come as 0..255 texels; normalize before the 0..1
            // fog/haze composition the GPU shader performs.
            float lit=albedo[c]*(((tint>>(c*8))&255)/255.0f)*light[c]+(emissive?emissive[c]*m->emissive_strength*anim_emissive:0.0f);
            scene[c]=(lit/255.0f)*(1.0f-fog)+fogcol[c]*fog;
        }
        float hz=features->haze_strength*(1.0f-(float)exp(-(double)depth*0.0015));
        float lum=scene[0]*0.2126f+scene[1]*0.7152f+scene[2]*0.0722f;
        for(int c=0;c<3;c++){
            scene[c]=scene[c]+(lum-scene[c])*hz*0.25f;
            scene[c]=scene[c]+(haze_rgb[c]-scene[c])*hz*0.10f;
            float channel=fmaxf(0.0f,fminf(1.0f,scene[c]))*255.0f;
            color|=(uint32_t)roundf(channel)<<(c*8);
        }
    }else{
        float fog=ambient?1-expf(-ambient->fog_density*fmaxf(0,depth-ambient->fog_start)):0;
        float fog_color[3]={ambient?ambient->fog_r:0,ambient?ambient->fog_g:0,ambient?ambient->fog_b:0};
        for(int i=0;i<3;i++) {
            float channel=albedo[i]*(((tint>>(i*8))&255)/255.0f)*light[i]+(emissive?emissive[i]*m->emissive_strength*anim_emissive:0);
            channel=channel*(1-fog)+fog_color[i]*255*fog;
            color|=(uint32_t)fmaxf(0,fminf(255,roundf(channel)))<<(i*8);
        }
    }
    if(m->blend>=R2D_WORLD_TRANSLUCENT)color=(color&0x00ffffff)|((uint32_t)roundf(albedo[3]*m->opacity)<<24);
    *out=color;return true;
}

int r2d_world_surface_blend(const R2DRe2dWorld *w,int surface)
{
    int id=w->surface_materials&&surface>=0&&surface<w->surface_count?w->surface_materials[surface]:-1;
    int blend=id>=0?w->materials[id].blend:R2D_WORLD_OPAQUE;
    // A faded opaque/masked surface must leave the opaque pass and take part in
    // transparent sorting. Additive materials keep their additive pipeline; the
    // fade scales their contribution through the alpha channel.
    if(blend<R2D_WORLD_TRANSLUCENT&&r2d_world_surface_alpha(w,surface)<1.0f)blend=R2D_WORLD_TRANSLUCENT;
    return blend;
}

// Surface-only fade application: decals keep their own alpha (they call
// material_color_id directly), so only the public surface entry points scale.
static uint32_t surface_fade_color(const R2DRe2dWorld *w,int surface,uint32_t color)
{
    float alpha=r2d_world_surface_alpha(w,surface);
    if(!(alpha<1.0f))return color;
    uint32_t value=(uint32_t)lroundf((double)((color>>24)&255u)*(double)alpha);
    if(value>255u)value=255u;
    return (color&0x00ffffffu)|(value<<24);
}

bool r2d_world_material_color(const R2DRe2dWorld *w,int surface,int span,uint32_t tint,float u,float v,float x,float y,float h,const float normal[3],const float tangent[3],float depth,uint32_t *out)
{int id=w->surface_materials&&surface>=0&&surface<w->surface_count?w->surface_materials[surface]:-1;if(!material_color_id(w,id,span,tint,u,v,x,y,h,normal,tangent,depth,NULL,out))return false;*out=surface_fade_color(w,surface,*out);return true;}
bool r2d_world_material_color_features(const R2DRe2dWorld *w,int surface,int span,uint32_t tint,float u,float v,float x,float y,float h,const float normal[3],const float tangent[3],float depth,const R2DWorldRenderFeatures *features,uint32_t *out)
{int id=w->surface_materials&&surface>=0&&surface<w->surface_count?w->surface_materials[surface]:-1;if(!material_color_id(w,id,span,tint,u,v,x,y,h,normal,tangent,depth,features,out))return false;*out=surface_fade_color(w,surface,*out);return true;}
// Dynamic decal bank. Creation capacity is memory-bound; the RENDER budget
// (decal_budget, default R2D_WORLD_MAX_DECALS) is enforced by deterministic
// eviction instead of rejecting new decals.
static bool decal_reserve(R2DRe2dWorld *w,int need)
{
    if(!w||need<0)return false;
    if(need<=w->decal_capacity)return true;
    int capacity=w->decal_capacity>0?w->decal_capacity:R2D_WORLD_MAX_DECALS;
    while(capacity<need){
        if(capacity>INT_MAX/2){capacity=need;break;}
        capacity*=2;
    }
    if((size_t)capacity>SIZE_MAX/sizeof(R2DWorldDecal))return false;
    R2DWorldDecal *grown=realloc(w->decals,(size_t)capacity*sizeof *grown);
    if(!grown)return false;
    memset(grown+w->decal_capacity,0,(size_t)(capacity-w->decal_capacity)*sizeof *grown);
    w->decals=grown;w->decal_capacity=capacity;
    return true;
}
static int decal_effective_budget(const R2DRe2dWorld *w)
{
    return w&&w->decal_budget>0?w->decal_budget:R2D_WORLD_MAX_DECALS;
}
int r2d_world_decal_budget(R2DRe2dWorld *w,int budget)
{
    if(!w)return 0;
    if(budget<0)budget=0;
    w->decal_budget=budget;
    return decal_effective_budget(w);
}
int r2d_world_decal_active_count(const R2DRe2dWorld *w)
{
    if(!w)return 0;
    int active=0;for(int i=0;i<w->decal_capacity;i++)if(w->decals[i].active)active++;
    const int budget=decal_effective_budget(w);
    return budget>0&&active>budget?budget:active;
}
// Deterministic eviction: non-persistent (max_life>0) before persistent; then
// lowest authored priority; then oldest serial.
static void decal_evict_one(R2DRe2dWorld *w)
{
    int victim=-1;bool victim_persistent=true;int victim_priority=INT_MAX;uint64_t victim_serial=UINT64_MAX;
    for(int i=0;i<w->decal_capacity;i++){
        R2DWorldDecal *d=&w->decals[i];if(!d->active)continue;
        const bool persistent=d->max_life<=0.0f;
        bool better=false;
        if(victim<0)better=true;
        else if(victim_persistent&&!persistent)better=true;
        else if(victim_persistent==persistent){
            if(d->priority<victim_priority)better=true;
            else if(d->priority==victim_priority&&d->serial<victim_serial)better=true;
        }
        if(better){victim=i;victim_persistent=persistent;victim_priority=d->priority;victim_serial=d->serial;}
    }
    if(victim<0)return;
    R2DWorldDecal *d=&w->decals[victim];
    d->active=false;d->generation++;
    w->decal_count--;w->decal_evicted++;
}
// Find a reusable slot. Retired slots (generation exhausted) are never reused;
// the bank grows instead so stale tokens can never alias a new decal.
static int decal_slot_for_new(R2DRe2dWorld *w)
{
    for(int i=0;i<w->decal_capacity;i++)
        if(!w->decals[i].active&&w->decals[i].generation<R2D_WORLD_DECAL_GENERATION_MAX)return i;
    const int slot=w->decal_capacity;
    if(!decal_reserve(w,slot+1))return -1;
    return slot;
}
int r2d_world_decal_create(R2DRe2dWorld *w,const R2DWorldDecal *d)
{
    if(!w||!d||d->surface<0||d->surface>=w->surface_count||(w->surface_sky&&w->surface_sky[d->surface])||r2d_world_surface_blend(w,d->surface)>=R2D_WORLD_TRANSLUCENT||d->material<0||d->material>=w->material_capacity||!w->materials[d->material].used||
       !isfinite(d->u)||!isfinite(d->v)||!isfinite(d->w)||!isfinite(d->h)||!isfinite(d->remaining)||fabsf(d->u)>1000000||fabsf(d->v)>1000000||d->w<=0||d->h<=0||d->w>1000000||d->h>1000000||d->remaining<0||d->remaining>1000000||
       !isfinite(d->max_life)||!isfinite(d->rotation)||!isfinite(d->scale)||!isfinite(d->fade_in)||!isfinite(d->fade_out)||
       d->max_life<0||d->max_life>1000000||d->scale<0||d->scale>8||d->fade_in<0||d->fade_out<0)return -1;
    const int budget=decal_effective_budget(w);
    if(budget>0&&w->decal_count>=budget)decal_evict_one(w);
    const int slot=decal_slot_for_new(w);
    if(slot<0)return -1;
    R2DWorldDecal *target=&w->decals[slot];
    unsigned generation=target->generation+1;
    if(generation>R2D_WORLD_DECAL_GENERATION_MAX)return -1;
    *target=*d;
    if(target->max_life>0.0f&&target->scale<=0.0f)target->scale=1.0f;
    target->generation=generation;target->active=true;target->serial=++w->decal_sequence;
    w->decal_count++;
    return (int)(generation*R2D_WORLD_DECAL_TOKEN_STRIDE+(unsigned)slot);
}
bool r2d_world_decal_remove(R2DRe2dWorld *w,int token)
{
    if(!w||token<0)return false;
    const unsigned stride=R2D_WORLD_DECAL_TOKEN_STRIDE;
    const unsigned slot=(unsigned)token%stride,generation=(unsigned)token/stride;
    if(slot>=(unsigned)w->decal_capacity)return false;
    R2DWorldDecal *d=&w->decals[slot];
    if(!d->active||d->generation!=generation)return false;
    d->active=false;w->decal_count--;return true;
}
float r2d_world_decal_alpha(const R2DWorldDecal *d)
{
    if(!d)return 0.0f;
    if(d->max_life<=0.0f)return 1.0f;
    if(!d->active)return 0.0f;
    float age=d->max_life-d->remaining;if(age<0.0f)age=0.0f;
    float alpha=1.0f;
    if(d->fade_in>0.0f)alpha=fminf(alpha,age/d->fade_in);
    if(d->fade_out>0.0f)alpha=fminf(alpha,d->remaining/d->fade_out);
    return alpha<0.0f?0.0f:(alpha>1.0f?1.0f:alpha);
}
void r2d_world_decal_step(R2DRe2dWorld *w,float dt)
{if(!w||!isfinite(dt)||dt<0)return;for(int i=0;i<w->decal_capacity;i++){R2DWorldDecal *d=&w->decals[i];if(d->active&&d->remaining>0){d->remaining-=dt;if(d->remaining<=0){d->active=false;w->decal_count--;}}}}
bool r2d_world_decal_color(const R2DRe2dWorld *w,const R2DWorldDecal *decal,int span,float u,float v,float x,float y,float h,const float normal[3],const float tangent[3],float depth,uint32_t *out)
{
    u=(u-decal->u)/decal->w;v=(v-decal->v)/decal->h;if(u<0||v<0||u>=1||v>=1)return false;
    const R2DWorldMaterial *m=&w->materials[decal->material];return material_color_id(w,decal->material,span,0xffffffff,u/m->u_scale,v/m->v_scale,x,y,h,normal,tangent,depth,NULL,out);
}

void r2d_world_material_uv(const R2DRe2dWorld *w,int surface,float x,float y,float h,const float normal[3],float tangent[3],float *u,float *v) {
    int id=w->surface_materials&&surface>=0&&surface<w->surface_count?w->surface_materials[surface]:-1;
    if(id<0||!w->materials[id].world_uv)return;
    if(normal[2]==0){if(tangent[0]<0||(tangent[0]==0&&tangent[1]<0)){tangent[0]*=-1;tangent[1]*=-1;}*u=x*tangent[0]+y*tangent[1];*v=h;}
    else {*u=x;*v=y;}
}
