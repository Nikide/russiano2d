#include "re2d_world_gpu.h"
#include "rotsprite.h"
#include <SDL3/SDL_timer.h>
#include <math.h>
#include <float.h>
#include <stdlib.h>
#include <string.h>
typedef struct { SDL_GPUTexture *color,*depth;uint64_t key;int revision,size;Uint32 offsets[2];bool dirty; } ActorGPU;
typedef struct { uint64_t key;float (*data)[4];int count,walls,spans; } ShadowChunk;
typedef struct {
    SDL_GPUGraphicsPipeline *pipeline,*overdraw,*translucent,*additive;
    SDL_GPUSampler *sampler,*linear,*sky_sampler;
    SDL_GPUTexture *color,*owner,*depth;
    SDL_GPUTransferBuffer *download;
    int width,height,draws;
    SDL_GPUTexture *bound_textures[3];SDL_GPUSampler *bound_samplers[3];
    int textures[R2D_WORLD_MAX_MATERIALS][3];
    int white,black,sky_texture;
    SDL_GPUBuffer *shadows;
    float (*shadow_data)[4];
    int shadow_count,shadow_capacity,shadow_buffer_capacity;
    uint64_t shadow_key;
    ShadowChunk shadow_chunks[128];
    ActorGPU *actors;
    int actor_capacity;
} WorldGPU;
typedef struct {
    float eye[4],basis[4],screen[4],shape[4],plane[4],normal[4],tangent[4],tint[4],material[4],ambient[4],fog[4],options[4];
    float bounds[4],floor_plane[4],ceiling_plane[4],identity[4],light_position[16][4],light_color[16][4],light_options[16][4];
    float opening[4];
    float billboard[4],actor[4];
} SurfaceUniform;
_Static_assert(sizeof(SurfaceUniform)==67*16,"shader std140 layout");
static void targets_free(SDL_GPUDevice *d,WorldGPU *g)
{
    if(g->color)SDL_ReleaseGPUTexture(d,g->color);if(g->owner)SDL_ReleaseGPUTexture(d,g->owner);if(g->depth)SDL_ReleaseGPUTexture(d,g->depth);
    if(g->download)SDL_ReleaseGPUTransferBuffer(d,g->download);
    g->color=g->owner=g->depth=NULL;g->download=NULL;g->width=g->height=0;
}
void r2d_world_gpu_material_dirty(R2DWorldRuntime *w)
{
    WorldGPU *g=w->gpu;if(!g)return;
    if(g->sky_texture>=0){r2d_texture_free(w->renderer,g->sky_texture);g->sky_texture=-1;}
    for(int i=0;i<R2D_WORLD_MAX_MATERIALS;i++)for(int j=0;j<3;j++)if(g->textures[i][j]>=0){r2d_texture_free(w->renderer,g->textures[i][j]);g->textures[i][j]=-1;}
}
void r2d_world_gpu_free(R2DWorldRuntime *w)
{
    WorldGPU *g=w->gpu;if(!g)return;r2d_world_gpu_material_dirty(w);SDL_GPUDevice *d=w->renderer->device;
    targets_free(d,g);if(g->pipeline)SDL_ReleaseGPUGraphicsPipeline(d,g->pipeline);if(g->overdraw)SDL_ReleaseGPUGraphicsPipeline(d,g->overdraw);if(g->translucent)SDL_ReleaseGPUGraphicsPipeline(d,g->translucent);if(g->additive)SDL_ReleaseGPUGraphicsPipeline(d,g->additive);if(g->sampler)SDL_ReleaseGPUSampler(d,g->sampler);if(g->linear)SDL_ReleaseGPUSampler(d,g->linear);if(g->sky_sampler)SDL_ReleaseGPUSampler(d,g->sky_sampler);
    if(g->white>=0)r2d_texture_free(w->renderer,g->white);if(g->black>=0)r2d_texture_free(w->renderer,g->black);
    if(g->shadows)SDL_ReleaseGPUBuffer(d,g->shadows);free(g->shadow_data);for(int i=0;i<128;i++)free(g->shadow_chunks[i].data);
    for(int i=0;i<g->actor_capacity;i++){if(g->actors[i].color)SDL_ReleaseGPUTexture(d,g->actors[i].color);if(g->actors[i].depth)SDL_ReleaseGPUTexture(d,g->actors[i].depth);}free(g->actors);
    free(g);w->gpu=NULL;w->gpu_texture_bytes=w->gpu_transfer_bytes=0;w->gpu_shadow_updates=w->gpu_material_batches=w->gpu_draws=0;
}
static void material_bind(R2DWorldRuntime *w,WorldGPU *g,SDL_GPURenderPass *pass,const SDL_GPUTextureSamplerBinding textures[3])
{
    bool changed=false;for(int i=0;i<3;i++)if(g->bound_textures[i]!=textures[i].texture||g->bound_samplers[i]!=textures[i].sampler)changed=true;
    if(!changed)return;SDL_BindGPUFragmentSamplers(pass,0,textures,3);w->gpu_material_batches++;
    for(int i=0;i<3;i++){g->bound_textures[i]=textures[i].texture;g->bound_samplers[i]=textures[i].sampler;}
}
static bool submit_frame(R2DWorldRuntime *w,SDL_GPUCommandBuffer *cmd,bool wait)
{
    Uint64 start=SDL_GetTicksNS();w->gpu_completion_ms=0;
    if(!wait){bool ok=SDL_SubmitGPUCommandBuffer(cmd);w->gpu_submit_ms=(SDL_GetTicksNS()-start)/1e6;return ok;}
    SDL_GPUFence *fence=SDL_SubmitGPUCommandBufferAndAcquireFence(cmd);w->gpu_submit_ms=(SDL_GetTicksNS()-start)/1e6;if(!fence)return false;
    start=SDL_GetTicksNS();bool ok=SDL_WaitForGPUFences(w->renderer->device,true,&fence,1);w->gpu_completion_ms=(SDL_GetTicksNS()-start)/1e6;SDL_ReleaseGPUFence(w->renderer->device,fence);return ok;
}
static SDL_GPUTexture *target(SDL_GPUDevice *d,int width,int height,SDL_GPUTextureFormat format,bool depth)
{
    SDL_GPUTextureCreateInfo t={0};t.type=SDL_GPU_TEXTURETYPE_2D;t.format=format;t.width=width;t.height=height;t.layer_count_or_depth=1;t.num_levels=1;
    t.sample_count=SDL_GPU_SAMPLECOUNT_1;t.usage=depth?SDL_GPU_TEXTUREUSAGE_DEPTH_STENCIL_TARGET:SDL_GPU_TEXTUREUSAGE_COLOR_TARGET;
    return SDL_CreateGPUTexture(d,&t);
}
static bool init(R2DWorldRuntime *w)
{
    SDL_GPUDevice *d=w->renderer->device;WorldGPU *g=w->gpu;
    if(!g){g=calloc(1,sizeof *g);if(!g)return false;w->gpu=g;g->white=g->black=g->sky_texture=-1;
        for(int i=0;i<R2D_WORLD_MAX_MATERIALS;i++)for(int j=0;j<3;j++)g->textures[i][j]=-1;
        SDL_GPUShader *vs=r2d_render_world_shader(w->renderer,false),*fs=r2d_render_world_shader(w->renderer,true);
        if(!vs||!fs){if(vs)SDL_ReleaseGPUShader(d,vs);if(fs)SDL_ReleaseGPUShader(d,fs);goto fail;}
        SDL_GPUColorTargetDescription colors[2]={{0}};colors[0].format=SDL_GPU_TEXTUREFORMAT_R8G8B8A8_UNORM;colors[1].format=SDL_GPU_TEXTUREFORMAT_R32G32B32A32_FLOAT;
        SDL_GPUGraphicsPipelineCreateInfo p={0};p.vertex_shader=vs;p.fragment_shader=fs;p.primitive_type=SDL_GPU_PRIMITIVETYPE_TRIANGLELIST;
        p.target_info.color_target_descriptions=colors;p.target_info.num_color_targets=2;p.target_info.has_depth_stencil_target=true;p.target_info.depth_stencil_format=SDL_GPU_TEXTUREFORMAT_D32_FLOAT;
        p.depth_stencil_state.enable_depth_test=true;p.depth_stencil_state.enable_depth_write=true;p.depth_stencil_state.compare_op=SDL_GPU_COMPAREOP_LESS_OR_EQUAL;
        p.rasterizer_state.fill_mode=SDL_GPU_FILLMODE_FILL;p.rasterizer_state.cull_mode=SDL_GPU_CULLMODE_NONE;p.multisample_state.sample_count=SDL_GPU_SAMPLECOUNT_1;
        g->pipeline=SDL_CreateGPUGraphicsPipeline(d,&p);
        p.depth_stencil_state.enable_depth_test=false;p.depth_stencil_state.enable_depth_write=false;
        colors[0].blend_state.enable_blend=true;
        colors[0].blend_state.src_color_blendfactor=colors[0].blend_state.dst_color_blendfactor=SDL_GPU_BLENDFACTOR_ONE;
        colors[0].blend_state.color_blend_op=SDL_GPU_BLENDOP_ADD;
        colors[0].blend_state.src_alpha_blendfactor=SDL_GPU_BLENDFACTOR_ONE;colors[0].blend_state.dst_alpha_blendfactor=SDL_GPU_BLENDFACTOR_ZERO;
        colors[0].blend_state.alpha_blend_op=SDL_GPU_BLENDOP_ADD;
        g->overdraw=SDL_CreateGPUGraphicsPipeline(d,&p);
        p.depth_stencil_state.enable_depth_test=true;
        colors[1].blend_state.enable_color_write_mask=true;
        colors[1].blend_state.color_write_mask=0;
        colors[0].blend_state.src_color_blendfactor=SDL_GPU_BLENDFACTOR_SRC_ALPHA;
        colors[0].blend_state.dst_color_blendfactor=SDL_GPU_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
        colors[0].blend_state.dst_alpha_blendfactor=SDL_GPU_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
        g->translucent=SDL_CreateGPUGraphicsPipeline(d,&p);
        colors[0].blend_state.dst_color_blendfactor=SDL_GPU_BLENDFACTOR_ONE;
        colors[0].blend_state.src_alpha_blendfactor=SDL_GPU_BLENDFACTOR_ZERO;
        colors[0].blend_state.dst_alpha_blendfactor=SDL_GPU_BLENDFACTOR_ONE;
        g->additive=SDL_CreateGPUGraphicsPipeline(d,&p);
        SDL_ReleaseGPUShader(d,vs);SDL_ReleaseGPUShader(d,fs);if(!g->pipeline||!g->overdraw||!g->translucent||!g->additive)goto fail;
        SDL_GPUSamplerCreateInfo s={0};s.min_filter=s.mag_filter=SDL_GPU_FILTER_NEAREST;s.mipmap_mode=SDL_GPU_SAMPLERMIPMAPMODE_NEAREST;
        s.address_mode_u=s.address_mode_v=s.address_mode_w=SDL_GPU_SAMPLERADDRESSMODE_REPEAT;g->sampler=SDL_CreateGPUSampler(d,&s);if(!g->sampler)goto fail;s.min_filter=s.mag_filter=SDL_GPU_FILTER_LINEAR;g->linear=SDL_CreateGPUSampler(d,&s);s.address_mode_v=SDL_GPU_SAMPLERADDRESSMODE_CLAMP_TO_EDGE;g->sky_sampler=SDL_CreateGPUSampler(d,&s);if(!g->linear||!g->sky_sampler)goto fail;
        const uint8_t white[4]={255,255,255,255},black[4]={0,0,0,255};g->white=r2d_texture_create_rgba(w->renderer,white,1,1);g->black=r2d_texture_create_rgba(w->renderer,black,1,1);if(g->white<0||g->black<0)goto fail;
    }
    if(g->width!=w->width||g->height!=w->height){targets_free(d,g);int x=w->width,y=w->height;
        g->color=target(d,x,y,SDL_GPU_TEXTUREFORMAT_R8G8B8A8_UNORM,false);g->owner=target(d,x,y,SDL_GPU_TEXTUREFORMAT_R32G32B32A32_FLOAT,false);g->depth=target(d,x,y,SDL_GPU_TEXTUREFORMAT_D32_FLOAT,true);
        SDL_GPUTransferBufferCreateInfo t={0};t.usage=SDL_GPU_TRANSFERBUFFERUSAGE_DOWNLOAD;t.size=((x*y*4+511)&~511)+x*y*16;
        g->download=SDL_CreateGPUTransferBuffer(d,&t);if(!g->color||!g->owner||!g->depth||!g->download)goto fail;g->width=x;g->height=y;
    }
    for(int i=0;i<R2D_WORLD_MAX_MATERIALS;i++)if(w->world.materials[i].used){R2DWorldMaterial *m=&w->world.materials[i];R2DWorldTexture *t[3]={&m->albedo,&m->normal,&m->emissive};
        for(int j=0;j<3;j++)if(t[j]->pixels&&g->textures[i][j]<0){g->textures[i][j]=r2d_texture_create_rgba(w->renderer,t[j]->pixels,t[j]->width,t[j]->height);if(g->textures[i][j]<0)goto fail;}}
    if(w->world.sky.pixels&&g->sky_texture<0){g->sky_texture=r2d_texture_create_rgba(w->renderer,w->world.sky.pixels,w->world.sky.width,w->world.sky.height);if(g->sky_texture<0)goto fail;}
    return true;
fail:r2d_world_gpu_free(w);return false;
}
static float flicker(const R2DWorldLight *l)
{
    if(l->flicker_rate<=0)return 1;uint32_t state=l->flicker_seed^(uint32_t)floorf(l->age*l->flicker_rate);state^=state<<13;state^=state>>17;state^=state<<5;
    return l->flicker_min+(l->flicker_max-l->flicker_min)*(state/4294967295.0f);
}
static bool shadow_append(WorldGPU *g,const float v[4])
{
    if(g->shadow_count>=1048576){SDL_SetError("Re2D shadow geometry arena exhausted");return false;}
    if(g->shadow_count==g->shadow_capacity){int capacity=g->shadow_capacity?g->shadow_capacity*2:256;void *p=realloc(g->shadow_data,(size_t)capacity*16);if(!p)return false;g->shadow_data=p;g->shadow_capacity=capacity;}
    memcpy(g->shadow_data[g->shadow_count++],v,16);return true;
}
static uint64_t hash_bytes(uint64_t key,const void *data,size_t size)
{ const uint8_t *p=data;for(size_t i=0;i<size;i++)key=(key^p[i])*1099511628211ULL;return key; }
static bool shadows_upload(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd)
{
    w->gpu_shadow_updates=0;
    const R2DRe2dWorld *world=&w->world;uint64_t key=1469598103934665603ULL;
    key=hash_bytes(key,&world->walls,sizeof world->walls);key=hash_bytes(key,&world->spans,sizeof world->spans);
    key=hash_bytes(key,&world->topology_revision,sizeof world->topology_revision);
    key=hash_bytes(key,world->shadow_geometry_revision,sizeof world->shadow_geometry_revision);
    for(int i=0;i<128;i++){key=hash_bytes(key,&world->shadow_mask[i],1);if(world->shadow_mask[i])key=hash_bytes(key,&world->lights[i],4*sizeof(float));}
    if(g->shadows&&g->shadow_key==key)return true;
    g->shadow_count=0;const float zero[4]={0};for(int i=0;i<128;i++)if(!shadow_append(g,zero))return false;
    for(int slot=0;slot<128;slot++)if(world->shadow_mask[slot]){const R2DWorldLight *l=&world->lights[slot];int start=g->shadow_count,walls=0;
        ShadowChunk *chunk=&g->shadow_chunks[slot];uint64_t ck=1469598103934665603ULL;
        ck=hash_bytes(ck,&world->topology_revision,sizeof world->topology_revision);
        ck=hash_bytes(ck,&world->shadow_geometry_revision[slot],sizeof(uint64_t));ck=hash_bytes(ck,l,4*sizeof(float));
        if(chunk->data&&chunk->key==ck){
            for(int i=0;i<chunk->count;i++)if(!shadow_append(g,chunk->data[i]))return false;
            g->shadow_data[slot][0]=start;g->shadow_data[slot][1]=chunk->walls;g->shadow_data[slot][2]=start+chunk->walls*2;g->shadow_data[slot][3]=chunk->spans;continue;
        }
        for(int i=0;i<world->wall_count;i++){const R2DWorldWall *wall=&world->walls[i];if(!r2d_world_wall_solid(world,i,wall->bottom,wall->top))continue;
            float dx=wall->x2-wall->x1,dy=wall->y2-wall->y1,t=fmaxf(0,fminf(1,((l->x-wall->x1)*dx+(l->y-wall->y1)*dy)/(dx*dx+dy*dy)));
            float x=wall->x1+t*dx-l->x,y=wall->y1+t*dy-l->y,h=fmaxf(wall->bottom-l->h,fmaxf(0,l->h-wall->top));
            if(x*x+y*y+h*h>l->radius*l->radius)continue;
            const float xy[4]={wall->x1,wall->y1,wall->x2,wall->y2};R2DWorldOpening opening;
            if(r2d_world_wall_opening(world,i,&opening)){
                if(opening.bottom>wall->bottom){const float height[4]={wall->bottom,opening.bottom,0,0};if(!shadow_append(g,xy)||!shadow_append(g,height))return false;walls++;}
                if(opening.top<wall->top){const float height[4]={opening.top,wall->top,0,0};if(!shadow_append(g,xy)||!shadow_append(g,height))return false;walls++;}
            }else{const float height[4]={wall->bottom,wall->top,0,0};if(!shadow_append(g,xy)||!shadow_append(g,height))return false;walls++;}
        }
        int planes=g->shadow_count,spans=0;
        for(int i=0;i<world->span_count;i++){const R2DWorldSpan *s=&world->spans[i];float x=fmaxf(s->x-l->x,fmaxf(0,l->x-s->x-s->w)),y=fmaxf(s->y-l->y,fmaxf(0,l->y-s->y-s->h));
            float lo,hi;r2d_world_span_height_bounds(s,&lo,&hi);float h=fmaxf(lo-l->h,fmaxf(0,l->h-hi));if(x*x+y*y+h*h>l->radius*l->radius)continue;
            const float xy[4]={s->x,s->y,s->w,s->h},floor[4]={s->bottom,s->floor_a,s->floor_b,0},ceiling[4]={s->top,s->ceiling_a,s->ceiling_b,0};
            if(!shadow_append(g,xy)||!shadow_append(g,floor)||!shadow_append(g,ceiling))return false;spans++;
        }
        w->gpu_shadow_updates++;
        int count=g->shadow_count-start;void *cached=realloc(chunk->data,(size_t)(count?count:1)*16);if(!cached)return false;
        chunk->data=cached;memcpy(chunk->data,&g->shadow_data[start],(size_t)count*16);chunk->count=count;chunk->walls=walls;chunk->spans=spans;chunk->key=ck;
        g->shadow_data[slot][0]=start;g->shadow_data[slot][1]=walls;g->shadow_data[slot][2]=planes;g->shadow_data[slot][3]=spans;
    }
    int bytes=g->shadow_count*16;SDL_GPUDevice *d=w->renderer->device;
    if(bytes>g->shadow_buffer_capacity){if(g->shadows)SDL_ReleaseGPUBuffer(d,g->shadows);SDL_GPUBufferCreateInfo b={0};b.usage=SDL_GPU_BUFFERUSAGE_GRAPHICS_STORAGE_READ;b.size=bytes;g->shadows=SDL_CreateGPUBuffer(d,&b);if(!g->shadows){g->shadow_buffer_capacity=0;return false;}g->shadow_buffer_capacity=bytes;}
    SDL_GPUTransferBufferCreateInfo t={0};t.usage=SDL_GPU_TRANSFERBUFFERUSAGE_UPLOAD;t.size=bytes;SDL_GPUTransferBuffer *upload=SDL_CreateGPUTransferBuffer(d,&t);if(!upload)return false;
    void *mapped=SDL_MapGPUTransferBuffer(d,upload,false);if(!mapped){SDL_ReleaseGPUTransferBuffer(d,upload);return false;}memcpy(mapped,g->shadow_data,bytes);SDL_UnmapGPUTransferBuffer(d,upload);
    SDL_GPUCopyPass *copy=SDL_BeginGPUCopyPass(cmd);SDL_GPUTransferBufferLocation src={upload,0};SDL_GPUBufferRegion dst={g->shadows,0,bytes};SDL_UploadToGPUBuffer(copy,&src,&dst,true);SDL_EndGPUCopyPass(copy);SDL_ReleaseGPUTransferBuffer(d,upload);g->shadow_key=key;return true;
}
static void lighting(const R2DRe2dWorld *world,int span,bool filter,SurfaceUniform *u)
{
    if(span>=0){const R2DWorldSpan *s=&world->spans[span];u->bounds[0]=s->x;u->bounds[1]=s->y;u->bounds[2]=s->w;u->bounds[3]=s->h;
        u->floor_plane[0]=s->bottom;u->floor_plane[1]=s->floor_a;u->floor_plane[2]=s->floor_b;u->floor_plane[3]=filter?1:0;
        u->ceiling_plane[0]=s->top;u->ceiling_plane[1]=s->ceiling_a;u->ceiling_plane[2]=s->ceiling_b;
        if(world->lighting.enabled){const R2DWorldSpanLight *a=&world->span_lights[span];u->identity[2]=1;
            u->ambient[0]=a->r;u->ambient[1]=a->g;u->ambient[2]=a->b;u->ambient[3]=a->level;
            u->fog[0]=a->fog_r;u->fog[1]=a->fog_g;u->fog[2]=a->fog_b;u->fog[3]=a->fog_density;
            u->options[0]=world->lighting.distance_scale;u->options[1]=world->lighting.orientation?world->lighting.orientation_strength:0;u->options[2]=a->fog_start;
            int count=world->lighting.dynamic?world->span_light_counts[span]:0;u->options[3]=count;
            for(int j=0;j<count;j++){int slot=world->span_light_refs[span*16+j];const R2DWorldLight *l=&world->lights[slot];
                u->light_position[j][0]=l->x;u->light_position[j][1]=l->y;u->light_position[j][2]=l->h;u->light_position[j][3]=l->radius;
                u->light_color[j][0]=l->r;u->light_color[j][1]=l->g;u->light_color[j][2]=l->b;u->light_color[j][3]=l->intensity*flicker(l);}
            for(int j=0;j<count;j++){int slot=world->span_light_refs[span*16+j];u->light_options[j][0]=world->lighting.shadows&&world->shadow_mask[slot]?slot:-1;}
        }
    }
}
static bool bounds(const R2DRe2dView *v,float ortho,int width,int height,const float points[4][3],SDL_Rect *out)
{
    float camera[4][3],clipped[8][3];int count=0;
    for(int i=0;i<4;i++){float x=points[i][0]-v->x,y=points[i][1]-v->y,h=points[i][2]-v->eye,forward=x*v->cos_yaw+y*v->sin_yaw;
        camera[i][0]=-x*v->sin_yaw+y*v->cos_yaw;camera[i][1]=h*v->cos_pitch-forward*v->sin_pitch;camera[i][2]=forward*v->cos_pitch+h*v->sin_pitch;}
    for(int i=0;i<4;i++){const float *a=camera[i],*b=camera[(i+1)%4];bool ai=a[2]>=v->near_plane,bi=b[2]>=v->near_plane;
        if(ai)memcpy(clipped[count++],a,12);if(ai!=bi){float t=(v->near_plane-a[2])/(b[2]-a[2]);for(int k=0;k<3;k++)clipped[count][k]=a[k]+t*(b[k]-a[k]);count++;}}
    if(!count)return false;float left=FLT_MAX,right=-FLT_MAX,top=FLT_MAX,bottom=-FLT_MAX;
    for(int i=0;i<count;i++){float scale=ortho>0?v->height/ortho:v->focal/clipped[i][2];float x=(v->width*.5f+clipped[i][0]*scale)*width/v->width,y=(v->height*.5f-clipped[i][1]*scale)*height/v->height;
        left=fminf(left,x);right=fmaxf(right,x);top=fminf(top,y);bottom=fmaxf(bottom,y);}
    int x0=(int)fmaxf(0,fminf(width,floorf(left)-1)),y0=(int)fmaxf(0,fminf(height,floorf(top)-1));
    int x1=(int)fmaxf(0,fminf(width,ceilf(right)+1)),y1=(int)fmaxf(0,fminf(height,ceilf(bottom)+1));
    *out=(SDL_Rect){x0,y0,x1-x0,y1-y0};return x1>x0&&y1>y0;
}
static bool surface_bounds(R2DWorldRuntime *w,const R2DRe2dView *v,float ortho,int id,SDL_Rect *out)
{
    const R2DWorldSurface *s=&w->world.surfaces[id];float points[4][3];
    if(s->kind==R2D_WORLD_WALL){const R2DWorldWall *a=&w->world.walls[s->primitive];float p[4][3]={{a->x1,a->y1,a->bottom},{a->x2,a->y2,a->bottom},{a->x2,a->y2,a->top},{a->x1,a->y1,a->top}};memcpy(points,p,sizeof p);}
    else{const R2DWorldSpan *a=&w->world.spans[s->primitive];float p[4][2]={{a->x,a->y},{a->x+a->w,a->y},{a->x+a->w,a->y+a->h},{a->x,a->y+a->h}};
        for(int i=0;i<4;i++){points[i][0]=p[i][0];points[i][1]=p[i][1];points[i][2]=s->kind==R2D_WORLD_FLOOR?r2d_world_floor_height(a,p[i][0],p[i][1]):r2d_world_ceiling_height(a,p[i][0],p[i][1]);}}
    return bounds(v,ortho,w->width,w->height,points,out);
}
static void draw(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v,float ortho,int id,int span,bool filter,const R2DWorldDecal *decal)
{
    const R2DRe2dWorld *world=&w->world;const R2DWorldSurface *surface=&world->surfaces[id];SurfaceUniform u={0};
    u.eye[0]=v->x;u.eye[1]=v->y;u.eye[2]=v->eye;u.eye[3]=v->near_plane;
    u.basis[0]=v->cos_yaw;u.basis[1]=v->sin_yaw;u.basis[2]=v->cos_pitch;u.basis[3]=v->sin_pitch;
    u.screen[0]=w->width;u.screen[1]=w->height;u.screen[2]=v->focal*w->height/v->height;u.screen[3]=ortho;
    uint32_t tint;
    if(surface->kind==R2D_WORLD_WALL){const R2DWorldWall *wall=&world->walls[surface->primitive];float dx=wall->x2-wall->x1,dy=wall->y2-wall->y1,len=hypotf(dx,dy);
        R2DWorldOpening opening;if(r2d_world_wall_opening(world,surface->primitive,&opening)){u.opening[0]=opening.bottom;u.opening[1]=opening.top;u.opening[2]=1;}
        u.shape[0]=wall->x1;u.shape[1]=wall->y1;u.shape[2]=wall->x2;u.shape[3]=wall->y2;u.plane[0]=wall->bottom;u.plane[1]=wall->top;
        u.normal[0]=-dy/len;u.normal[1]=dx/len;if((v->x-wall->x1)*u.normal[0]+(v->y-wall->y1)*u.normal[1]<0){u.normal[0]*=-1;u.normal[1]*=-1;}
        u.tangent[0]=dx/len;u.tangent[1]=dy/len;tint=wall->color;
    }else{const R2DWorldSpan *s=&world->spans[surface->primitive];bool ceiling=surface->kind==R2D_WORLD_CEILING;float a=ceiling?s->ceiling_a:s->floor_a,b=ceiling?s->ceiling_b:s->floor_b;
        u.shape[0]=s->x;u.shape[1]=s->y;u.shape[2]=s->w;u.shape[3]=s->h;u.plane[0]=ceiling?s->top:s->bottom;u.plane[1]=a;u.plane[2]=b;u.plane[3]=1;
        float k=(ceiling?-1:1)/sqrtf(1+a*a+b*b);u.normal[0]=-a*k;u.normal[1]=-b*k;u.normal[2]=k;k=1/sqrtf(1+a*a);u.tangent[0]=k;u.tangent[2]=a*k;tint=ceiling?s->ceiling_color:s->floor_color;
    }
    for(int i=0;i<4;i++)u.tint[i]=((tint>>(i*8))&255)/255.0f;
    int material=decal?decal->material:(world->surface_materials?world->surface_materials[id]:-1);SDL_GPUTextureSamplerBinding samplers[3];SDL_GPUSampler *sampler=material>=0&&world->materials[material].linear?g->linear:g->sampler;
    for(int i=0;i<3;i++){int texture=material>=0?g->textures[material][i]:-1;if(texture<0)texture=i==2?g->black:g->white;samplers[i]=(SDL_GPUTextureSamplerBinding){r2d_texture_handle(w->renderer,texture),sampler};}
    if(material>=0){const R2DWorldMaterial *m=&world->materials[material];u.material[0]=m->u_scale;u.material[1]=m->v_scale;u.material[2]=m->normal.pixels?1:0;u.material[3]=m->emissive.pixels?m->emissive_strength:0;u.identity[3]=1;u.light_options[13][3]=m->world_uv?1:0;if(m->world_uv&&surface->kind==R2D_WORLD_WALL&&(u.tangent[0]<0||(u.tangent[0]==0&&u.tangent[1]<0))){u.tangent[0]*=-1;u.tangent[1]*=-1;}u.light_options[15][3]=m->blend;u.tint[3]=m->blend>=R2D_WORLD_TRANSLUCENT?m->opacity:1;}
    if(decal){u.tint[0]=u.tint[1]=u.tint[2]=1;u.light_options[14][1]=decal->u;u.light_options[14][2]=decal->v;u.light_options[14][3]=decal->w;u.light_options[15][1]=decal->h;u.light_options[15][2]=1;}
    u.identity[0]=id;u.identity[1]=span;
    lighting(world,span,filter,&u);if(w->debug_view==R2D_WORLD_DEBUG_OVERDRAW)u.identity[2]=-1;
    material_bind(w,g,pass,samplers);SDL_PushGPUFragmentUniformData(cmd,0,&u,sizeof u);SDL_DrawGPUPrimitives(pass,3,1,0,0);g->draws++;
}
static SDL_GPUTexture *actor_texture(SDL_GPUDevice *d,int size,bool depth)
{
    SDL_GPUTextureCreateInfo t={0};t.type=SDL_GPU_TEXTURETYPE_2D;t.format=depth?SDL_GPU_TEXTUREFORMAT_R32_FLOAT:SDL_GPU_TEXTUREFORMAT_R8G8B8A8_UNORM;
    t.width=t.height=size;t.layer_count_or_depth=1;t.num_levels=1;t.sample_count=SDL_GPU_SAMPLECOUNT_1;t.usage=SDL_GPU_TEXTUREUSAGE_SAMPLER;return SDL_CreateGPUTexture(d,&t);
}
static bool actors_upload(JSContext *ctx,R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd)
{
    if(w->frame_count>g->actor_capacity){int cap=w->frame_count;ActorGPU *actors=realloc(g->actors,(size_t)cap*sizeof *actors);if(!actors)return false;
        memset(actors+g->actor_capacity,0,(size_t)(cap-g->actor_capacity)*sizeof *actors);g->actors=actors;g->actor_capacity=cap;}
    SDL_GPUDevice *d=w->renderer->device;size_t bytes=0;
    for(int i=0;i<g->actor_capacity;i++){ActorGPU *a=&g->actors[i];
        a->dirty=false;
        if(i>=w->frame_count||!w->frame_images[i]){if(a->color)SDL_ReleaseGPUTexture(d,a->color);if(a->depth)SDL_ReleaseGPUTexture(d,a->depth);memset(a,0,sizeof *a);continue;}
        uint64_t key=r2d_rotsprite_instance(ctx,w->frame_handles[i]);int revision=r2d_rotsprite_revision(ctx,w->frame_handles[i]),size=w->frame_sizes[i];
        if(a->key==key&&a->revision==revision&&a->size==size)continue;
        bytes=((bytes+511)&~(size_t)511)+(size_t)size*size*4;
        if(r2d_rotsprite_sample_depth(ctx,w->frame_handles[i]))bytes=((bytes+511)&~(size_t)511)+(size_t)size*size*4;
    }
    if(!bytes)return true;if(bytes>128*1024*1024){SDL_SetError("Re2D GPU actor upload budget 128 MiB exceeded");return false;}
    SDL_GPUTransferBufferCreateInfo t={0};t.usage=SDL_GPU_TRANSFERBUFFERUSAGE_UPLOAD;t.size=(Uint32)bytes;SDL_GPUTransferBuffer *upload=SDL_CreateGPUTransferBuffer(d,&t);if(!upload)return false;
    uint8_t *mapped=SDL_MapGPUTransferBuffer(d,upload,false);if(!mapped){SDL_ReleaseGPUTransferBuffer(d,upload);return false;}
    size_t offset=0;bool ok=true;
    for(int i=0;i<w->frame_count;i++)if(w->frame_images[i]){ActorGPU *a=&g->actors[i];uint64_t key=r2d_rotsprite_instance(ctx,w->frame_handles[i]);int revision=r2d_rotsprite_revision(ctx,w->frame_handles[i]),size=w->frame_sizes[i];
        if(a->key==key&&a->revision==revision&&a->size==size)continue;const float *depth=r2d_rotsprite_sample_depth(ctx,w->frame_handles[i]);
        if(a->size!=size||(depth!=NULL)!=(a->depth!=NULL)){if(a->color)SDL_ReleaseGPUTexture(d,a->color);if(a->depth)SDL_ReleaseGPUTexture(d,a->depth);a->color=actor_texture(d,size,false);a->depth=depth?actor_texture(d,size,true):NULL;}
        if(!a->color||(depth&&!a->depth)){ok=false;break;}
        for(int j=0;j<(depth?2:1);j++){offset=(offset+511)&~(size_t)511;size_t count=(size_t)size*size*4;memcpy(mapped+offset,j?(const void *)depth:w->frame_images[i],count);
            a->offsets[j]=(Uint32)offset;offset+=count;}
        a->key=key;a->revision=revision;a->size=size;a->dirty=true;
    }
    SDL_UnmapGPUTransferBuffer(d,upload);
    if(ok){SDL_GPUCopyPass *copy=SDL_BeginGPUCopyPass(cmd);for(int i=0;i<w->frame_count;i++){ActorGPU *a=&g->actors[i];if(!a->dirty)continue;
        for(int j=0;j<(a->depth?2:1);j++){SDL_GPUTextureTransferInfo src={0};src.transfer_buffer=upload;src.offset=a->offsets[j];src.pixels_per_row=src.rows_per_layer=a->size;
            SDL_GPUTextureRegion dst={0};dst.texture=j?a->depth:a->color;dst.w=dst.h=a->size;dst.d=1;SDL_UploadToGPUTexture(copy,&src,&dst,true);}}
        SDL_EndGPUCopyPass(copy);}
    SDL_ReleaseGPUTransferBuffer(d,upload);return ok;
}
static void actor_draw(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v,float ortho,int i,int span,bool filter)
{
    const float *p=w->frame_positions+i*5;ActorGPU *a=&g->actors[i];SurfaceUniform u={0};bool samples=a->depth!=NULL;
    float center=p[2]+p[4]*.5f,dx=p[0]-v->x,dy=p[1]-v->y,forward=dx*v->cos_yaw+dy*v->sin_yaw;
    float anchor=samples?center:p[2],dist=forward*v->cos_pitch+(anchor-v->eye)*v->sin_pitch;if(dist<v->near_plane)return;
    float projected[4],scale;
    if(ortho>0){scale=v->height/ortho;projected[0]=v->width*.5f+(-dx*v->sin_yaw+dy*v->cos_yaw)*scale;projected[1]=v->height*.5f-((anchor-v->eye)*v->cos_pitch-forward*v->sin_pitch)*scale;}
    else{if(!r2d_re2d_project(v,p[0],p[1],anchor,projected))return;scale=projected[3];}
    u.eye[0]=v->x;u.eye[1]=v->y;u.eye[2]=v->eye;u.eye[3]=v->near_plane;
    u.basis[0]=v->cos_yaw;u.basis[1]=v->sin_yaw;u.basis[2]=v->cos_pitch;u.basis[3]=v->sin_pitch;
    u.screen[0]=w->width;u.screen[1]=w->height;u.screen[2]=v->focal*w->height/v->height;u.screen[3]=ortho;
    u.billboard[2]=p[3]*scale*w->width/v->width;u.billboard[3]=p[4]*scale*w->height/v->height;
    u.billboard[0]=projected[0]*w->width/v->width-u.billboard[2]*.5f;u.billboard[1]=projected[1]*w->height/v->height-u.billboard[3]*(samples?.5f:1);
    int left=(int)fmaxf(0,fminf(w->width,floorf(u.billboard[0]))),top=(int)fmaxf(0,fminf(w->height,floorf(u.billboard[1])));
    int right=(int)fmaxf(0,fminf(w->width,ceilf(u.billboard[0]+u.billboard[2]))),bottom=(int)fmaxf(0,fminf(w->height,ceilf(u.billboard[1]+u.billboard[3])));
    if(right<=left||bottom<=top)return;SDL_Rect scissor={left,top,right-left,bottom-top};SDL_SetGPUScissor(pass,&scissor);
    u.actor[0]=p[0];u.actor[1]=p[1];u.actor[2]=center;u.actor[3]=p[4];u.shape[2]=p[3];u.plane[0]=dist;u.plane[3]=2;
    u.material[2]=samples?1:0;u.identity[0]=-1;u.identity[1]=span;u.identity[3]=1;u.opening[3]=i;
    for(int c=0;c<4;c++)u.tint[c]=1;lighting(&w->world,span,filter,&u);if(w->debug_view==R2D_WORLD_DEBUG_OVERDRAW)u.identity[2]=-1;
    SDL_GPUTextureSamplerBinding textures[3]={{a->color,g->sampler},{a->depth?a->depth:r2d_texture_handle(w->renderer,g->black),g->sampler},{r2d_texture_handle(w->renderer,g->black),g->sampler}};
    material_bind(w,g,pass,textures);SDL_PushGPUFragmentUniformData(cmd,0,&u,sizeof u);SDL_DrawGPUPrimitives(pass,3,1,0,0);g->draws++;
}
static void surface_draw(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v,float ortho,int id)
{
    if(w->world.surface_sky&&w->world.surface_sky[id])return;
    const R2DWorldSurface *s=&w->world.surfaces[id];const R2DWorldWindow *window=&w->visibility.surface_windows[id];
        SDL_Rect projected;if(!surface_bounds(w,v,ortho,id,&projected))return;
        int left=(int)fmaxf(0,floorf(window->left*w->width/v->width)),top=(int)fmaxf(0,floorf(window->top*w->height/v->height));
        int right=(int)fminf(w->width,ceilf(window->right*w->width/v->width)),bottom=(int)fminf(w->height,ceilf(window->bottom*w->height/v->height));
        left=left>projected.x?left:projected.x;top=top>projected.y?top:projected.y;
        right=right<projected.x+projected.w?right:projected.x+projected.w;bottom=bottom<projected.y+projected.h?bottom:projected.y+projected.h;
        if(right<=left||bottom<=top)return;SDL_Rect scissor={left,top,right-left,bottom-top};SDL_SetGPUScissor(pass,&scissor);
        if(s->kind!=R2D_WORLD_WALL){draw(w,g,cmd,pass,v,ortho,id,s->span,false,NULL);return;}
        if(r2d_world_surface_blend(&w->world,id)<R2D_WORLD_TRANSLUCENT||w->debug_view==R2D_WORLD_DEBUG_OVERDRAW)draw(w,g,cmd,pass,v,ortho,id,-1,false,NULL);
        for(int k=0;k<w->visibility.span_count;k++){int span=w->visibility.spans[k];bool incident=false;
            for(int r=w->world.span_wall_offsets[span];r<w->world.span_wall_offsets[span+1];r++)if(w->world.span_wall_refs[r]==s->primitive){incident=true;break;}
            if(incident)draw(w,g,cmd,pass,v,ortho,id,span,true,NULL);}
}
bool r2d_world_gpu_frame(JSContext *ctx,R2DWorldRuntime *w,const R2DRe2dView *v,float ortho)
{
    if(!init(w))return false;WorldGPU *g=w->gpu;SDL_GPUDevice *d=w->renderer->device;
    SDL_GPUCommandBuffer *cmd=SDL_AcquireGPUCommandBuffer(d);if(!cmd)return false;
    Uint64 shadow_start=SDL_GetTicksNS();
    if(!shadows_upload(w,g,cmd)){SDL_CancelGPUCommandBuffer(cmd);return false;}
    w->shadow_ms=(SDL_GetTicksNS()-shadow_start)/1e6;
    if(!actors_upload(ctx,w,g,cmd)){SDL_CancelGPUCommandBuffer(cmd);return false;}
    SDL_GPUColorTargetInfo colors[2]={{0}};colors[0].texture=g->color;colors[0].load_op=SDL_GPU_LOADOP_CLEAR;colors[0].store_op=SDL_GPU_STOREOP_STORE;
    colors[0].clear_color=w->debug_view==R2D_WORLD_DEBUG_OVERDRAW?(SDL_FColor){0,0,0,1}:(SDL_FColor){16/255.0f,24/255.0f,32/255.0f,1};colors[1].texture=g->owner;colors[1].load_op=SDL_GPU_LOADOP_CLEAR;colors[1].store_op=SDL_GPU_STOREOP_STORE;colors[1].clear_color=(SDL_FColor){FLT_MAX,-1,-1,-1};
    SDL_GPUDepthStencilTargetInfo depth={0};depth.texture=g->depth;depth.load_op=SDL_GPU_LOADOP_CLEAR;depth.store_op=SDL_GPU_STOREOP_DONT_CARE;depth.clear_depth=1;
    SDL_GPURenderPass *pass=SDL_BeginGPURenderPass(cmd,colors,2,&depth);if(!pass){SDL_CancelGPUCommandBuffer(cmd);return false;}
    SDL_BindGPUGraphicsPipeline(pass,w->debug_view==R2D_WORLD_DEBUG_OVERDRAW?g->overdraw:g->pipeline);SDL_BindGPUFragmentStorageBuffers(pass,0,&g->shadows,1);g->draws=0;w->gpu_material_batches=0;memset(g->bound_textures,0,sizeof g->bound_textures);
    if(w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW&&(w->world.sky.pixels||w->world.sky_color)){
        SurfaceUniform sky={0};sky.basis[0]=v->cos_yaw;sky.basis[1]=v->sin_yaw;sky.basis[2]=v->cos_pitch;sky.basis[3]=v->sin_pitch;
        sky.screen[0]=w->width;sky.screen[1]=w->height;sky.screen[2]=v->focal*w->height/v->height;sky.screen[3]=ortho;sky.plane[3]=3;
        sky.material[0]=w->world.sky_yaw;sky.identity[3]=w->world.sky.pixels?1:0;uint32_t tint=w->world.sky_color?w->world.sky_color:0xffffffff;
        for(int c=0;c<4;c++)sky.tint[c]=((tint>>(c*8))&255)/255.0f;
        SDL_GPUTexture *texture=r2d_texture_handle(w->renderer,g->sky_texture>=0?g->sky_texture:g->white);
        SDL_GPUTextureSamplerBinding samplers[3]={{texture,g->sky_sampler},{texture,g->sampler},{texture,g->sampler}};
        material_bind(w,g,pass,samplers);SDL_PushGPUFragmentUniformData(cmd,0,&sky,sizeof sky);SDL_DrawGPUPrimitives(pass,3,1,0,0);g->draws++;
    }
    for(int j=0;j<w->visibility.surface_count;j++){int id=w->visibility.surfaces[j];if(r2d_world_surface_blend(&w->world,id)>=R2D_WORLD_TRANSLUCENT&&w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW)continue;surface_draw(w,g,cmd,pass,v,ortho,id);}
    SDL_Rect full={0,0,w->width,w->height};SDL_SetGPUScissor(pass,&full);
    for(int i=0;i<w->frame_count;i++)if(w->frame_images[i]){actor_draw(w,g,cmd,pass,v,ortho,i,-1,false);
        for(int j=0;j<w->visibility.span_count;j++){int span=w->visibility.spans[j];const R2DWorldSpan *s=&w->world.spans[span];const float *p=w->frame_positions+i*5;
            if(p[0]+p[3]<s->x||p[0]-p[3]>s->x+s->w||p[1]+p[3]<s->y||p[1]-p[3]>s->y+s->h)continue;actor_draw(w,g,cmd,pass,v,ortho,i,span,true);}}
    for(int i=0;i<R2D_WORLD_MAX_DECALS;i++)if(w->world.decals[i].active){
        const R2DWorldDecal *decal=&w->world.decals[i];int id=decal->surface;if(!w->visibility.surface_seen[id]||(w->world.surface_sky&&w->world.surface_sky[id]))continue;
        SDL_Rect scissor;if(!surface_bounds(w,v,ortho,id,&scissor))continue;SDL_SetGPUScissor(pass,&scissor);
        SDL_BindGPUGraphicsPipeline(pass,w->debug_view==R2D_WORLD_DEBUG_OVERDRAW?g->overdraw:w->world.materials[decal->material].blend==R2D_WORLD_ADDITIVE?g->additive:g->translucent);
        const R2DWorldSurface *surface=&w->world.surfaces[id];
        if(surface->kind!=R2D_WORLD_WALL)draw(w,g,cmd,pass,v,ortho,id,surface->span,false,decal);
        else for(int j=0;j<w->visibility.span_count;j++){int span=w->visibility.spans[j];bool incident=false;for(int k=w->world.span_wall_offsets[span];k<w->world.span_wall_offsets[span+1];k++)if(w->world.span_wall_refs[k]==surface->primitive){incident=true;break;}if(incident)draw(w,g,cmd,pass,v,ortho,id,span,true,decal);}
    }
    if(w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW&&w->world.material_count){
        int count=r2d_world_transparent_order(&w->world,v,&w->visibility,NULL);int *ids=w->world.transparent_ids;
        if(count<0){SDL_EndGPURenderPass(pass);SDL_CancelGPUCommandBuffer(cmd);return false;}
        for(int i=0;i<count;i++){SDL_BindGPUGraphicsPipeline(pass,r2d_world_surface_blend(&w->world,ids[i])==R2D_WORLD_ADDITIVE?g->additive:g->translucent);surface_draw(w,g,cmd,pass,v,ortho,ids[i]);}
    }
    size_t pixel_count=(size_t)w->width*w->height;
    w->gpu_texture_bytes=pixel_count*28+8; // MRT/depth + public RGBA output + two fallback texels.
    w->gpu_transfer_bytes=((pixel_count*4+511)&~(size_t)511)+pixel_count*16+g->shadow_buffer_capacity;
    if(g->sky_texture>=0)w->gpu_texture_bytes+=(size_t)w->world.sky.width*w->world.sky.height*4;
    for(int i=0;i<64;i++){const R2DWorldMaterial *m=&w->world.materials[i];const R2DWorldTexture *t[3]={&m->albedo,&m->normal,&m->emissive};for(int j=0;j<3;j++)if(g->textures[i][j]>=0)w->gpu_texture_bytes+=(size_t)t[j]->width*t[j]->height*4;}
    for(int i=0;i<g->actor_capacity;i++)if(g->actors[i].color)w->gpu_texture_bytes+=(size_t)g->actors[i].size*g->actors[i].size*8;
    SDL_EndGPURenderPass(pass);SDL_GPUCopyPass *copy=SDL_BeginGPUCopyPass(cmd);int n=w->width*w->height,offset=(n*4+511)&~511;
    if(w->debug_view==R2D_WORLD_DEBUG_FINAL){SDL_GPUTextureLocation src={0},dst={0};src.texture=g->color;dst.texture=r2d_texture_handle(w->renderer,w->texture);
        SDL_CopyGPUTextureToTexture(copy,&src,&dst,w->width,w->height,1,true);SDL_EndGPUCopyPass(copy);w->gpu_draws=g->draws;
        return submit_frame(w,cmd,w->gpu_wait);}
    for(int i=0;i<2;i++){SDL_GPUTextureRegion src={0};src.texture=i?g->owner:g->color;src.w=w->width;src.h=w->height;src.d=1;
        SDL_GPUTextureTransferInfo dst={0};dst.transfer_buffer=g->download;dst.offset=i?offset:0;dst.pixels_per_row=w->width;dst.rows_per_layer=w->height;SDL_DownloadFromGPUTexture(copy,&src,&dst);}
    SDL_EndGPUCopyPass(copy);if(!submit_frame(w,cmd,true))return false;
    uint8_t *pixels=SDL_MapGPUTransferBuffer(d,g->download,false);if(!pixels)return false;memcpy(w->rgba,pixels,(size_t)n*4);float *owners=(float *)(pixels+offset);
    for(int i=0;i<n;i++){w->depth[i]=owners[i*4];w->owners[i]=(R2DWorldPixelOwner){(int)owners[i*4+1],(int)owners[i*4+2],(int)owners[i*4+3]};}
    SDL_UnmapGPUTransferBuffer(d,g->download);w->gpu_draws=g->draws;return true;
}
