#include "re2d_world_gpu.h"
#include "re2d_world_sky.h"
#include "re2d_world_render_features.h"
#include "re2d_world_post.h"
#include "re2d_world_vfx.h"
#include "re2d_world_batch.h"
#include "r2d_shaders.h"
#include "rotsprite.h"
#include <SDL3/SDL_timer.h>
#include <math.h>
#include <float.h>
#include <stdlib.h>
#include <string.h>
typedef struct SurfaceUniform SurfaceUniform;
typedef struct {
    SDL_GPUBuffer *buffer;
    SDL_GPUTransferBuffer *upload;
    int buffer_capacity,upload_capacity;
} BatchGPUSlot;
typedef struct { SDL_GPUTexture *color,*depth;uint64_t key;int revision,size;Uint32 offsets[2];bool dirty,stream_blocked; } ActorGPU;
typedef struct { uint64_t key;float (*data)[4];int count,walls,spans; } ShadowChunk;
typedef struct {
    SDL_GPUGraphicsPipeline *pipeline,*overdraw,*translucent,*additive,*mirror,*ground,*fx_translucent,*fx_additive;
    // P4 static batching: one fullscreen draw per material/blend/light/atlas
    // group, per-instance SurfaceUniform indexed from a std430 SSBO.
    SDL_GPUGraphicsPipeline *batch_pipeline;
    BatchGPUSlot *batch_slots;
    int batch_slot_capacity;
    SurfaceUniform *batch_uniforms;
    int batch_uniform_capacity;
    SurfaceUniform *batch_packed;
    int batch_packed_capacity;
    int batch_uniform_count,batch_base_count,batch_span_count,batch_last_variant_count;
    R2DWorldBatchItem *batch_items;
    int batch_item_capacity;
    R2DWorldBatchInstance *batch_instances;
    int batch_instance_capacity;
    R2DWorldBatchGroup *batch_groups;
    int batch_group_capacity;
    int batch_instance_count,batch_group_count,batch_logical_count;
    bool batch_available;
    R2DWorldVisibility mirror_visibility;
    SDL_Rect clip;bool clip_active;
    // Cached inverse of span_wall_refs: wall -> incident spans. Rebuilt only on
    // topology_revision; removes the O(visibleWalls*visibleSpans) scan.
    int *wall_span_offsets,*wall_span_refs;int wall_span_count;uint64_t wall_span_revision;
    SDL_GPUSampler *sampler,*linear,*sky_sampler;
    SDL_GPUTexture *color,*owner,*depth;
    SDL_GPUTexture *post_color,*post_owner,*post_depth;
    SDL_GPUGraphicsPipeline *post;
    float ambient_grid[16][4];
    float ambient_rect[4];
    uint64_t ambient_key;
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
    // Task-12: stream residency -> real SDL_GPU textures.
    bool stream_hook_installed;
} WorldGPU;
struct SurfaceUniform {
    float eye[4],basis[4],screen[4],shape[4],plane[4],normal[4],tangent[4],tint[4],material[4],ambient[4],fog[4],options[4];
    float bounds[4],floor_plane[4],ceiling_plane[4],identity[4],light_position[16][4],light_color[16][4],light_options[16][4];
    float opening[4];
    float billboard[4],actor[4];
    float anim[4];
    // P0/P1 visual feature inputs (keep std140 order in world.frag.glsl).
    float surfacefx[4];  // variation, macro, bevel, corner AO
    float surfacefx2[4]; // edge width, edge grime, deterministic seed, unused
    float spritefx[4];   // outline, grime, contact shading, alpha threshold
    float fog2[4];       // height density, base height, falloff, haze strength
    float haze[4];       // haze/sky tint rgb, blend
    float ground[4];     // contact card center x/y, radius x/y (output pixels)
    float ground2[4];    // opacity, softness, foot AO ratio, foot AO strength
    float ground3[4];    // contact tint rgb, enabled
    float liquid[4];     // enabled, time, distortion, highlight
    float liquid2[4];    // liquid tint rgb, foam
    float skyLayer[4][4];// parallax, scale, vertical offset, alpha
    float skyParams[4];  // layer count, sun azimuth, sun elevation, time
    float celestial[4];  // disc size, glow, disc rgb
    float celestial2[4]; // disc b, unused, unused, enabled
    float ambientGrid[16][4]; // baked 4x4 ambient rgb + AO
    float ambientRect[4];     // x0,y0,invW,invH; w>0 => field enabled
    float detail[4];          // uv scale, detail weight, unused, enabled
    float decal2[4];          // rotation, scale, fade alpha, enabled
    float render_origin[4];   // shifted render space -> world space XY
    float scissor[4];         // batched path: per-instance pixel scissor (x0,y0,x1,y1)
    float ordinal[4];         // batched path: submission ordinal for stable depth order
};
_Static_assert(sizeof(SurfaceUniform)==107*16,"shader std140/SSBO layout");
static void targets_free(SDL_GPUDevice *d,WorldGPU *g)
{
    if(g->color)SDL_ReleaseGPUTexture(d,g->color);if(g->owner)SDL_ReleaseGPUTexture(d,g->owner);if(g->depth)SDL_ReleaseGPUTexture(d,g->depth);
    if(g->post_color)SDL_ReleaseGPUTexture(d,g->post_color);if(g->post_owner)SDL_ReleaseGPUTexture(d,g->post_owner);if(g->post_depth)SDL_ReleaseGPUTexture(d,g->post_depth);
    if(g->download)SDL_ReleaseGPUTransferBuffer(d,g->download);
    g->color=g->owner=g->depth=g->post_color=g->post_owner=g->post_depth=NULL;g->download=NULL;g->width=g->height=0;g->ambient_key=0;
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
    targets_free(d,g);if(g->pipeline)SDL_ReleaseGPUGraphicsPipeline(d,g->pipeline);if(g->overdraw)SDL_ReleaseGPUGraphicsPipeline(d,g->overdraw);if(g->mirror)SDL_ReleaseGPUGraphicsPipeline(d,g->mirror);if(g->translucent)SDL_ReleaseGPUGraphicsPipeline(d,g->translucent);if(g->additive)SDL_ReleaseGPUGraphicsPipeline(d,g->additive);if(g->ground)SDL_ReleaseGPUGraphicsPipeline(d,g->ground);if(g->post)SDL_ReleaseGPUGraphicsPipeline(d,g->post);if(g->fx_translucent)SDL_ReleaseGPUGraphicsPipeline(d,g->fx_translucent);if(g->fx_additive)SDL_ReleaseGPUGraphicsPipeline(d,g->fx_additive);if(g->sampler)SDL_ReleaseGPUSampler(d,g->sampler);if(g->linear)SDL_ReleaseGPUSampler(d,g->linear);if(g->sky_sampler)SDL_ReleaseGPUSampler(d,g->sky_sampler);
    if(g->white>=0)r2d_texture_free(w->renderer,g->white);if(g->black>=0)r2d_texture_free(w->renderer,g->black);
    if(g->shadows)SDL_ReleaseGPUBuffer(d,g->shadows);free(g->shadow_data);for(int i=0;i<128;i++)free(g->shadow_chunks[i].data);
    for(int i=0;i<g->actor_capacity;i++){if(g->actors[i].color)SDL_ReleaseGPUTexture(d,g->actors[i].color);if(g->actors[i].depth)SDL_ReleaseGPUTexture(d,g->actors[i].depth);}free(g->actors);
    r2d_world_visibility_free(&g->mirror_visibility);
    for(int i=0;i<g->batch_slot_capacity;i++){
        if(g->batch_slots[i].buffer)SDL_ReleaseGPUBuffer(d,g->batch_slots[i].buffer);
        if(g->batch_slots[i].upload)SDL_ReleaseGPUTransferBuffer(d,g->batch_slots[i].upload);
    }
    free(g->batch_slots);
    if(g->batch_pipeline)SDL_ReleaseGPUGraphicsPipeline(d,g->batch_pipeline);
    free(g->batch_uniforms);free(g->batch_items);free(g->batch_instances);free(g->batch_groups);
    free(g->wall_span_offsets);free(g->wall_span_refs);free(g);w->gpu=NULL;w->gpu_texture_bytes=w->gpu_transfer_bytes=0;w->gpu_shadow_updates=w->gpu_material_batches=w->gpu_draws=0;w->gpu_draw_base=w->gpu_draw_span=w->gpu_draw_actor=w->gpu_draw_other=0;w->gpu_draw_ground=0;w->gpu_draw_vfx=0;
}
static void material_bind(R2DWorldRuntime *w,WorldGPU *g,SDL_GPURenderPass *pass,const SDL_GPUTextureSamplerBinding textures[3])
{
    bool changed=false;for(int i=0;i<3;i++)if(g->bound_textures[i]!=textures[i].texture||g->bound_samplers[i]!=textures[i].sampler)changed=true;
    if(!changed)return;SDL_BindGPUFragmentSamplers(pass,0,textures,3);w->gpu_material_batches++;
    for(int i=0;i<3;i++){g->bound_textures[i]=textures[i].texture;g->bound_samplers[i]=textures[i].sampler;}
}

// Transition hook: the stream cache owns residency decisions; the GPU owner
// reacts by uploading on RESIDENT and releasing on UNLOADED in gpu_stream_sync.
static void gpu_stream_hook(void *user,int id,int kind,R2DStreamState from,R2DStreamState to)
{
    R2DWorldRuntime *w=(R2DWorldRuntime *)user;if(!w)return;
    (void)id;(void)kind;(void)from;
    w->gpu_stream_transitions++;
    (void)to;
}

static void gpu_stream_install_hook(R2DWorldRuntime *w,WorldGPU *g)
{
    if(!w||!g||!w->stream_ready)return;
    // The stream cache is rebuilt on region-size changes, which clears its hook;
    // re-install whenever the live cache no longer points at our hook.
    if(g->stream_hook_installed&&w->stream.hook==gpu_stream_hook)return;
    g->stream_hook_installed=false;
    r2d_world_stream_set_hook(&w->stream,gpu_stream_hook,w);
    g->stream_hook_installed=true;
}

// Upload RESIDENT material textures, release UNLOADED ones. Renderer slots are
// g->textures[material][0..2]; stream ids are material*4+slot (kind TEXTURE).
static void gpu_stream_sync(R2DWorldRuntime *w,WorldGPU *g)
{
    gpu_stream_install_hook(w,g);
    if(!w->stream_ready)return;
    // Demand set: materials used by currently visible surfaces/decals. A visible
    // material is always sampleable even when its owning region payload is still
    // in PRELOAD; residency still governs hidden-region prefetch/eviction.
    bool used[R2D_WORLD_MAX_MATERIALS]={0};
    if(w->world.surface_materials){
        for(int i=0;i<w->visibility.surface_count;i++){
            const int id=w->visibility.surfaces[i];
            if(id<0||id>=w->world.surface_count)continue;
            const int material=w->world.surface_materials[id];
            if(material>=0&&material<R2D_WORLD_MAX_MATERIALS)used[material]=true;
        }
    }
    int resident=0;
    for(int m=0;m<w->world.material_count&&m<R2D_WORLD_MAX_MATERIALS;m++){
        const R2DWorldMaterial *material=&w->world.materials[m];
        if(!material->used)continue;
        const R2DWorldTexture *slots[3]={&material->albedo,&material->normal,&material->emissive};
        for(int j=0;j<3;j++){
            const R2DWorldTexture *texture=slots[j];
            const int stream_slot=r2d_world_stream_find(&w->stream,m*4+j,R2D_STREAM_TEXTURE);
            const R2DStreamState state=stream_slot<0?R2D_STREAM_UNLOADED:
                w->stream.items[stream_slot].state;
            // Missing stream item = fallback (asset registered after the cache
            // sized itself); visible materials are demand-loaded so a visible
            // surface is never left with a white texture.
            const bool sampleable=stream_slot<0||state==R2D_STREAM_RESIDENT||
                state==R2D_STREAM_EVICTABLE||used[m];
            if(sampleable){
                if(g->textures[m][j]<0&&texture->pixels){
                    const uint64_t bytes=(uint64_t)texture->width*texture->height*4u;
                    g->textures[m][j]=r2d_texture_create_rgba(w->renderer,texture->pixels,
                                                               texture->width,texture->height);
                    if(g->textures[m][j]>=0){
                        w->gpu_stream_uploads++;
                        w->gpu_stream_upload_bytes+=bytes;
                    }
                }
                if(g->textures[m][j]>=0)resident++;
            }else if(!used[m]){
                // PRELOAD/UNLOADED: no renderer copy. EVICTABLE stays resident
                // for visual continuity until the cache actually evicts it.
                if(g->textures[m][j]>=0){
                    r2d_texture_free(w->renderer,g->textures[m][j]);
                    g->textures[m][j]=-1;
                    w->gpu_stream_evictions++;
                }
            }
        }
    }
    w->gpu_textures_resident=resident;
    int atlas_resident=0;
    for(int a=0;a<w->atlas_count;a++){
        const R2DStreamState state=r2d_world_stream_state(&w->stream,1000000+a,
                                                          R2D_STREAM_ATLAS);
        if(state==R2D_STREAM_RESIDENT||state==R2D_STREAM_EVICTABLE)atlas_resident++;
    }
    w->gpu_atlases_resident=atlas_resident;
}

static bool actor_stream_blocked(const R2DWorldRuntime *w,int frame_index)
{
    if(!w->stream_ready||frame_index<0||frame_index>=w->frame_count)return false;
    if(w->frame_kinds[frame_index]!=R2D_WORLD_FRAME_ATLAS)return false;
    const int atlas=(int)w->frame_keys[frame_index]-1;
    if(atlas<0||atlas>=w->atlas_count)return false;
    const int slot=r2d_world_stream_find(&w->stream,1000000+atlas,R2D_STREAM_ATLAS);
    if(slot<0)return false; // fallback: atlas asset not registered in the cache
    const R2DStreamState state=w->stream.items[slot].state;
    return state==R2D_STREAM_UNLOADED||state==R2D_STREAM_PRELOAD;
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
    t.sample_count=SDL_GPU_SAMPLECOUNT_1;t.usage=depth?(SDL_GPU_TEXTUREUSAGE_DEPTH_STENCIL_TARGET|SDL_GPU_TEXTUREUSAGE_SAMPLER):SDL_GPU_TEXTUREUSAGE_COLOR_TARGET;
    return SDL_CreateGPUTexture(d,&t);
}
static SDL_GPUShader *batch_shader(SDL_GPUDevice *d,const R2DShaderBlob *blob,bool fragment)
{
#ifdef __EMSCRIPTEN__
    (void)d;(void)blob;(void)fragment;return NULL;
#else
    const SDL_GPUShaderFormat formats=SDL_GetGPUShaderFormats(d);
    SDL_GPUShaderCreateInfo info;SDL_zero(info);
    info.stage=fragment?SDL_GPU_SHADERSTAGE_FRAGMENT:SDL_GPU_SHADERSTAGE_VERTEX;
    info.num_samplers=fragment?3:0;info.num_storage_buffers=fragment?2:0;info.num_uniform_buffers=0;
    if(formats&SDL_GPU_SHADERFORMAT_SPIRV){info.format=SDL_GPU_SHADERFORMAT_SPIRV;info.code=blob->spirv;info.code_size=blob->spirv_size;info.entrypoint="main";}
    else if(formats&SDL_GPU_SHADERFORMAT_MSL){info.format=SDL_GPU_SHADERFORMAT_MSL;info.code=(const Uint8 *)blob->msl;info.code_size=blob->msl_size;info.entrypoint="main0";}
    else return NULL;
    return SDL_CreateGPUShader(d,&info);
#endif
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
#ifndef R2D_SHADERS_WGSL_ONLY
        {
            SDL_GPUShader *bvs=batch_shader(d,&r2d_shader_world_batch_vert,false);
            SDL_GPUShader *bfs=batch_shader(d,&r2d_shader_world_batch_frag,true);
            if(bvs&&bfs){SDL_GPUGraphicsPipelineCreateInfo bp=p;bp.vertex_shader=bvs;bp.fragment_shader=bfs;g->batch_pipeline=SDL_CreateGPUGraphicsPipeline(d,&bp);}
            if(bvs)SDL_ReleaseGPUShader(d,bvs);if(bfs)SDL_ReleaseGPUShader(d,bfs);
            g->batch_available=g->batch_pipeline!=NULL;
        }
#else
        g->batch_available=false; // WebGPU/WGSL build uses the per-surface path.
#endif
        // Mirror pass: depth disabled, no blending; drawn scissored into the portal.
        p.depth_stencil_state.enable_depth_test=false;p.depth_stencil_state.enable_depth_write=false;p.depth_stencil_state.compare_op=SDL_GPU_COMPAREOP_ALWAYS;
        g->mirror=SDL_CreateGPUGraphicsPipeline(d,&p);
        p.depth_stencil_state.enable_depth_test=false;p.depth_stencil_state.enable_depth_write=false;
        colors[0].blend_state.enable_blend=true;
        colors[0].blend_state.src_color_blendfactor=colors[0].blend_state.dst_color_blendfactor=SDL_GPU_BLENDFACTOR_ONE;
        colors[0].blend_state.color_blend_op=SDL_GPU_BLENDOP_ADD;
        colors[0].blend_state.src_alpha_blendfactor=SDL_GPU_BLENDFACTOR_ONE;colors[0].blend_state.dst_alpha_blendfactor=SDL_GPU_BLENDFACTOR_ZERO;
        colors[0].blend_state.alpha_blend_op=SDL_GPU_BLENDOP_ADD;
        g->overdraw=SDL_CreateGPUGraphicsPipeline(d,&p);
        p.depth_stencil_state.enable_depth_test=true;
        // Reset the compare op after the mirror/overdraw pipelines forced
        // ALWAYS; translucent/additive surfaces must still respect actor and
        // world depth or they paint over nearer sprites.
        p.depth_stencil_state.compare_op=SDL_GPU_COMPAREOP_LESS_OR_EQUAL;
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
        // P0 grounding pass: screen-space contact card. No depth test/write and
        // no owner-target write; it is drawn after opaque surfaces and before
        // actors, exactly where the CPU reference draws it.
        p.depth_stencil_state.enable_depth_test=false;
        p.depth_stencil_state.enable_depth_write=false;
        colors[0].blend_state.src_color_blendfactor=SDL_GPU_BLENDFACTOR_SRC_ALPHA;
        colors[0].blend_state.dst_color_blendfactor=SDL_GPU_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
        colors[0].blend_state.src_alpha_blendfactor=SDL_GPU_BLENDFACTOR_ONE;
        colors[0].blend_state.dst_alpha_blendfactor=SDL_GPU_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
        g->ground=SDL_CreateGPUGraphicsPipeline(d,&p);
        // R-03 VFX cards/trails: depth-tested, no depth write, two blend modes.
        p.depth_stencil_state.enable_depth_test=true;
        p.depth_stencil_state.enable_depth_write=false;
        colors[0].blend_state.enable_blend=true;
        colors[0].blend_state.src_color_blendfactor=SDL_GPU_BLENDFACTOR_SRC_ALPHA;
        colors[0].blend_state.dst_color_blendfactor=SDL_GPU_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
        colors[0].blend_state.src_alpha_blendfactor=SDL_GPU_BLENDFACTOR_ONE;
        colors[0].blend_state.dst_alpha_blendfactor=SDL_GPU_BLENDFACTOR_ONE_MINUS_SRC_ALPHA;
        g->fx_translucent=SDL_CreateGPUGraphicsPipeline(d,&p);
        colors[0].blend_state.dst_color_blendfactor=SDL_GPU_BLENDFACTOR_ONE;
        colors[0].blend_state.src_alpha_blendfactor=SDL_GPU_BLENDFACTOR_ZERO;
        colors[0].blend_state.dst_alpha_blendfactor=SDL_GPU_BLENDFACTOR_ONE;
        g->fx_additive=SDL_CreateGPUGraphicsPipeline(d,&p);
        // P4 final composite: same world shaders, plane.w=6 branch samples the
        // scene colour/owner/depth textures and writes a separate post target.
        colors[0].blend_state.enable_blend=false;
        SDL_GPUColorTargetDescription post_colors[2]={{0}};
        post_colors[0].format=SDL_GPU_TEXTUREFORMAT_R8G8B8A8_UNORM;
        post_colors[1].format=SDL_GPU_TEXTUREFORMAT_R32G32B32A32_FLOAT;
        SDL_GPUGraphicsPipelineCreateInfo pp={0};pp.vertex_shader=vs;pp.fragment_shader=fs;pp.primitive_type=SDL_GPU_PRIMITIVETYPE_TRIANGLELIST;
        pp.target_info.color_target_descriptions=post_colors;pp.target_info.num_color_targets=2;
        pp.target_info.has_depth_stencil_target=true;pp.target_info.depth_stencil_format=SDL_GPU_TEXTUREFORMAT_D32_FLOAT;
        pp.depth_stencil_state.enable_depth_test=false;pp.depth_stencil_state.enable_depth_write=false;
        pp.depth_stencil_state.compare_op=SDL_GPU_COMPAREOP_ALWAYS;
        pp.rasterizer_state.fill_mode=SDL_GPU_FILLMODE_FILL;pp.rasterizer_state.cull_mode=SDL_GPU_CULLMODE_NONE;pp.multisample_state.sample_count=SDL_GPU_SAMPLECOUNT_1;
        g->post=SDL_CreateGPUGraphicsPipeline(d,&pp);
        SDL_ReleaseGPUShader(d,vs);SDL_ReleaseGPUShader(d,fs);if(!g->pipeline||!g->mirror||!g->overdraw||!g->translucent||!g->additive||!g->ground||!g->fx_translucent||!g->fx_additive||!g->post)goto fail;
        SDL_GPUSamplerCreateInfo s={0};s.min_filter=s.mag_filter=SDL_GPU_FILTER_NEAREST;s.mipmap_mode=SDL_GPU_SAMPLERMIPMAPMODE_NEAREST;
        s.address_mode_u=s.address_mode_v=s.address_mode_w=SDL_GPU_SAMPLERADDRESSMODE_REPEAT;g->sampler=SDL_CreateGPUSampler(d,&s);if(!g->sampler)goto fail;s.min_filter=s.mag_filter=SDL_GPU_FILTER_LINEAR;g->linear=SDL_CreateGPUSampler(d,&s);s.address_mode_v=SDL_GPU_SAMPLERADDRESSMODE_CLAMP_TO_EDGE;g->sky_sampler=SDL_CreateGPUSampler(d,&s);if(!g->linear||!g->sky_sampler)goto fail;
        const uint8_t white[4]={255,255,255,255},black[4]={0,0,0,255};g->white=r2d_texture_create_rgba(w->renderer,white,1,1);g->black=r2d_texture_create_rgba(w->renderer,black,1,1);if(g->white<0||g->black<0)goto fail;
    }
    if(g->width!=w->width||g->height!=w->height){targets_free(d,g);int x=w->width,y=w->height;
        g->color=target(d,x,y,SDL_GPU_TEXTUREFORMAT_R8G8B8A8_UNORM,false);g->owner=target(d,x,y,SDL_GPU_TEXTUREFORMAT_R32G32B32A32_FLOAT,false);g->depth=target(d,x,y,SDL_GPU_TEXTUREFORMAT_D32_FLOAT,true);
        g->post_color=target(d,x,y,SDL_GPU_TEXTUREFORMAT_R8G8B8A8_UNORM,false);g->post_owner=target(d,x,y,SDL_GPU_TEXTUREFORMAT_R32G32B32A32_FLOAT,false);g->post_depth=target(d,x,y,SDL_GPU_TEXTUREFORMAT_D32_FLOAT,true);
        SDL_GPUTransferBufferCreateInfo t={0};t.usage=SDL_GPU_TRANSFERBUFFERUSAGE_DOWNLOAD;t.size=((x*y*4+511)&~511)+x*y*16;
        g->download=SDL_CreateGPUTransferBuffer(d,&t);if(!g->color||!g->owner||!g->depth||!g->post_color||!g->post_owner||!g->post_depth||!g->download)goto fail;g->width=x;g->height=y;
    }
    // Streamed path: textures upload only when the residency cache promotes
    // them (gpu_stream_sync). Without a stream cache keep the eager fallback.
    if(!w->stream_ready)for(int i=0;i<R2D_WORLD_MAX_MATERIALS;i++)if(w->world.materials[i].used){R2DWorldMaterial *m=&w->world.materials[i];R2DWorldTexture *t[3]={&m->albedo,&m->normal,&m->emissive};
        for(int j=0;j<3;j++)if(t[j]->pixels&&g->textures[i][j]<0){g->textures[i][j]=r2d_texture_create_rgba(w->renderer,t[j]->pixels,t[j]->width,t[j]->height);if(g->textures[i][j]<0)goto fail;}}
    gpu_stream_install_hook(w,g);
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
static bool shadows_upload(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,float ox,float oy)
{
    w->gpu_shadow_updates=0;
    const R2DRe2dWorld *world=&w->world;uint64_t key=1469598103934665603ULL;
    key=hash_bytes(key,&world->walls,sizeof world->walls);key=hash_bytes(key,&world->spans,sizeof world->spans);
    key=hash_bytes(key,&world->topology_revision,sizeof world->topology_revision);
    key=hash_bytes(key,world->shadow_geometry_revision,sizeof world->shadow_geometry_revision);
    key=hash_bytes(key,&ox,sizeof ox);key=hash_bytes(key,&oy,sizeof oy);
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
        for(int i=0;i<world->wall_count;i++){const R2DWorldWall *wall=&world->walls[i];
            // Tool-material policy: tool_shadowless/clip walls do not cast.
            if(!(r2d_world_wall_bits(wall)&R2D_WALL_SHADOW))continue;
            if(!r2d_world_wall_solid(world,i,wall->bottom,wall->top))continue;
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
    void *mapped=SDL_MapGPUTransferBuffer(d,upload,false);if(!mapped){SDL_ReleaseGPUTransferBuffer(d,upload);return false;}memcpy(mapped,g->shadow_data,bytes);
    // Shadow geometry stays in world coordinates: the fragment shader adds
    // render_origin.xy when it traces against the cache, so cache chunks stay
    // valid across render-origin changes and no per-upload rewrite is needed.
    (void)ox;(void)oy;
    SDL_UnmapGPUTransferBuffer(d,upload);
    SDL_GPUCopyPass *copy=SDL_BeginGPUCopyPass(cmd);SDL_GPUTransferBufferLocation src={upload,0};SDL_GPUBufferRegion dst={g->shadows,0,bytes};SDL_UploadToGPUBuffer(copy,&src,&dst,true);SDL_EndGPUCopyPass(copy);SDL_ReleaseGPUTransferBuffer(d,upload);g->shadow_key=key;return true;
}
static void lighting(R2DWorldRuntime *w,int span,bool filter,SurfaceUniform *u,float ox,float oy)
{
    const R2DRe2dWorld *world=&w->world;
    if(span>=0){const R2DWorldSpan *s=&world->spans[span];u->bounds[0]=s->x-ox;u->bounds[1]=s->y-oy;u->bounds[2]=s->w;u->bounds[3]=s->h;
        u->floor_plane[0]=s->bottom;u->floor_plane[1]=s->floor_a;u->floor_plane[2]=s->floor_b;u->floor_plane[3]=filter?1:0;
        u->ceiling_plane[0]=s->top;u->ceiling_plane[1]=s->ceiling_a;u->ceiling_plane[2]=s->ceiling_b;
        if(world->lighting.enabled){const R2DWorldSpanLight *a=&world->span_lights[span];u->identity[2]=1;
            u->ambient[0]=a->r;u->ambient[1]=a->g;u->ambient[2]=a->b;u->ambient[3]=a->level;
            u->fog[0]=a->fog_r;u->fog[1]=a->fog_g;u->fog[2]=a->fog_b;u->fog[3]=a->fog_density;
            u->options[0]=world->lighting.distance_scale;u->options[1]=world->lighting.orientation?world->lighting.orientation_strength:0;u->options[2]=a->fog_start;
            const int raw=world->lighting.dynamic?world->span_light_counts[span]:0;
            const bool advanced=w->render_features.quality>=R2D_RENDER_QUALITY_HIGH;
            R2DWorldLodLight lights[16];int slots[16];int count=0;
            for(int j=0;j<raw&&count<16;j++){int slot=world->span_light_refs[span*16+j];const R2DWorldLight *l=&world->lights[slot];
                lights[count]=(R2DWorldLodLight){l->x-ox,l->y-oy,l->h,l->radius};slots[count]=slot;count++;}
            int kept[16];int total=count;
            if(advanced){
                int shadowed=0,culled=0;
                total=r2d_world_region_lod_select_lights(lights,count,u->eye[0],u->eye[1],u->eye[2],
                    &w->lod_config,w->lod_config.max_shadow_lights,kept,16,&shadowed,&culled);
                if(total<0)total=0;if(total>16)total=16;
                w->gpu_lod_culled_lights+=culled;
            }else for(int j=0;j<count;j++)kept[j]=j;
            int shadow_used=0;
            for(int j=0;j<total;j++){const int index=kept[j],slot=slots[index];const R2DWorldLight *l=&world->lights[slot];
                u->light_position[j][0]=lights[index].x;u->light_position[j][1]=lights[index].y;
                u->light_position[j][2]=l->h;u->light_position[j][3]=l->radius;
                u->light_color[j][0]=l->r;u->light_color[j][1]=l->g;u->light_color[j][2]=l->b;
                u->light_color[j][3]=l->intensity*flicker(l);
                const bool shadow=world->lighting.shadows&&world->shadow_mask[slot]&&
                    (advanced?shadow_used<w->lod_config.max_shadow_lights:true);
                u->light_options[j][0]=shadow?slot:-1;
                if(shadow)shadow_used++;}
            u->options[3]=total;
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
// Baked 4x4 ambient/AO grid over the world AABB; rebuilt only when topology or
// span heights change. Samples authored floor/ceiling pairs per cell centre.
static void ambient_build(R2DWorldRuntime *w,WorldGPU *g)
{
    if(w->render_features.quality<R2D_RENDER_QUALITY_HIGH){g->ambient_rect[3]=0.0f;g->ambient_key=0;return;}
    uint64_t key=w->world.topology_revision^(w->world.geometry_revision*1099511628211ULL);
    if(g->ambient_key==key&&g->ambient_rect[4-1]>0.5f)return;
    g->ambient_key=key;g->ambient_rect[0]=g->ambient_rect[1]=g->ambient_rect[2]=g->ambient_rect[3]=0.0f;
    memset(g->ambient_grid,0,sizeof g->ambient_grid);
    const R2DRe2dWorld *world=&w->world;
    if(world->span_count<=0)return;
    float x0=INFINITY,y0=INFINITY,x1=-INFINITY,y1=-INFINITY;
    for(int i=0;i<world->span_count;i++){const R2DWorldSpan *sp=&world->spans[i];
        x0=fminf(x0,sp->x);y0=fminf(y0,sp->y);x1=fmaxf(x1,sp->x+sp->w);y1=fmaxf(y1,sp->y+sp->h);}
    if(!(x1>x0)||!(y1>y0))return;
    float floor_h[16],ceiling_h[16];
    for(int cy=0;cy<4;cy++)for(int cx=0;cx<4;cx++){
        float px=x0+(cx+0.5f)*(x1-x0)/4.0f,py=y0+(cy+0.5f)*(y1-y0)/4.0f;
        int span=r2d_world_span_at(world,px,py,(world->spans[0].bottom+world->spans[0].top)*0.5f);
        if(span>=0){const R2DWorldSpan *sp=&world->spans[span];
            floor_h[cy*4+cx]=r2d_world_floor_height(sp,px,py);ceiling_h[cy*4+cx]=r2d_world_ceiling_height(sp,px,py);}
        else{floor_h[cy*4+cx]=0.0f;ceiling_h[cy*4+cx]=256.0f;}
    }
    const float sky[3]={0.72f,0.84f,1.0f};
    R2DWorldAmbientField field;
    if(!r2d_world_ambient_bake(&field,x0,y0,x1-x0,y1-y0,4,4,floor_h,ceiling_h,sky,0.6f))return;
    for(int i=0;i<16;i++){g->ambient_grid[i][0]=field.ambient[i*3+0];g->ambient_grid[i][1]=field.ambient[i*3+1];
        g->ambient_grid[i][2]=field.ambient[i*3+2];g->ambient_grid[i][3]=field.occlusion[i];}
    g->ambient_rect[0]=x0;g->ambient_rect[1]=y0;
    g->ambient_rect[2]=1.0f/(x1-x0);g->ambient_rect[3]=1.0f/(y1-y0);
}
static void visual_common(R2DWorldRuntime *w,SurfaceUniform *u,float ox,float oy)
{
    const R2DWorldRenderFeatures *rf=&w->render_features;
    WorldGPU *g=w->gpu;
    u->render_origin[0]=ox;u->render_origin[1]=oy;
    if(g&&g->ambient_rect[3]>0.0f&&rf->quality>=R2D_RENDER_QUALITY_HIGH){
        memcpy(u->ambientGrid,g->ambient_grid,sizeof u->ambientGrid);
        memcpy(u->ambientRect,g->ambient_rect,sizeof u->ambientRect);
        // Ambient field is authored in world XY: shift it into shader space.
        u->ambientRect[0]-=ox;u->ambientRect[1]-=oy;
    }
    if(rf->surface_detail&&rf->quality>=R2D_RENDER_QUALITY_HIGH){u->detail[0]=3.0f;u->detail[1]=0.22f;u->detail[2]=0.0f;u->detail[3]=1.0f;}
    if(rf->height_fog)u->fog2[0]=rf->fog_height_density;
    u->fog2[1]=rf->fog_base_height;u->fog2[2]=rf->fog_height_falloff;
    if(rf->atmospheric_haze){
        // Shared with the CPU composer so both backends use the same haze tint:
        // explicit features->haze_color override, else the authored sky colour
        // with the historical 0xff88aacc fallback.
        r2d_world_render_haze_color(rf,w->world.sky_color,u->haze);
        u->haze[3]=rf->haze_strength;u->fog2[3]=rf->haze_strength;
    }
}
static void visual_surface(R2DWorldRuntime *w,SurfaceUniform *u,const R2DWorldSurface *surface,int id,bool decal)
{
    const R2DWorldRenderFeatures *rf=&w->render_features;
    if(decal)return;
    if(rf->material_variation)u->surfacefx[0]=rf->variation_strength;
    if(rf->macro_variation)u->surfacefx[1]=rf->macro_strength;
    if(rf->bevel)u->surfacefx[2]=rf->bevel_strength;
    if(rf->corner_ao)u->surfacefx[3]=rf->corner_ao_strength;
    u->surfacefx2[0]=rf->surface_edge_width;
    if(rf->edge_grime)u->surfacefx2[1]=rf->edge_grime_strength;
    u->surfacefx2[2]=(float)((rf->seed>>8)&0xffffu)/65535.0f;
    if(rf->material_variation)w->render_counters.varied_surfaces++;
    if(rf->macro_variation)w->render_counters.macro_surfaces++;
    if(rf->bevel)w->render_counters.bevel_surfaces++;
    if(rf->corner_ao)w->render_counters.corner_ao_surfaces++;
    if(rf->height_fog)w->render_counters.fog_surfaces++;
    if(rf->atmospheric_haze)w->render_counters.haze_surfaces++;
    if(rf->material_animation&&w->world.surface_materials&&id>=0){
        int material=w->world.surface_materials[id];
        if(material>=0&&material<R2D_WORLD_MAX_MATERIALS&&w->material_anim_active[material])w->render_counters.animated_materials++;
    }
    if(rf->liquid&&surface&&surface->kind==R2D_WORLD_FLOOR&&w->surface_terrain&&id>=0&&id<w->terrain_capacity){
        int kind=w->surface_terrain[id];
        if(kind>=R2D_TERRAIN_WATER&&kind<=R2D_TERRAIN_MIST){
            const R2DWorldTerrain *t=r2d_world_terrain_preset(kind);
            if(t){
                u->liquid[0]=1.0f;u->liquid[1]=w->render_time;u->liquid[2]=rf->liquid_distortion;u->liquid[3]=rf->liquid_highlight;
                u->liquid2[0]=t->tint_r;u->liquid2[1]=t->tint_g;u->liquid2[2]=t->tint_b;u->liquid2[3]=rf->liquid_foam;
                w->render_counters.liquid_surfaces++;
            }
        }
    }
}
static void visual_actor(R2DWorldRuntime *w,SurfaceUniform *u)
{
    const R2DWorldRenderFeatures *rf=&w->render_features;
    if(rf->edge_quality){
        if(rf->edge_outline)u->spritefx[0]=rf->edge_outline_strength;
        if(rf->edge_grime)u->spritefx[1]=rf->edge_grime_strength;
        if(rf->alpha_feather)u->spritefx[3]=rf->edge_alpha_threshold;
        w->render_counters.edge_actors++;
        if(rf->edge_outline)w->render_counters.outline_actors++;
        if(rf->edge_grime)w->render_counters.grime_actors++;
    }
    if(rf->contact_lighting)u->spritefx[2]=rf->contact_light_strength;
    if(rf->contact_lighting)w->render_counters.contact_lit++;
}
static void visual_sky(R2DWorldRuntime *w,SurfaceUniform *u)
{
    const R2DWorldRenderFeatures *rf=&w->render_features;
    int layers=rf->sky_layers?rf->sky_layer_count:0;
    if(layers<0)layers=0;if(layers>4)layers=4;
    u->skyParams[0]=(float)layers;
    u->skyParams[1]=rf->sun_azimuth;u->skyParams[2]=rf->sun_elevation;u->skyParams[3]=w->render_time;
    for(int i=0;i<4;i++){
        u->skyLayer[i][0]=rf->sky_parallax[i];u->skyLayer[i][1]=rf->sky_scale[i];
        u->skyLayer[i][2]=rf->sky_offset[i];u->skyLayer[i][3]=i<layers?rf->sky_alpha[i]:0.0f;
    }
    if(rf->sun_disc){
        u->celestial[0]=rf->sun_size;u->celestial[1]=rf->sun_glow;
        u->celestial[2]=1.0f;u->celestial[3]=0.88f;u->celestial2[0]=0.62f;u->celestial2[3]=1.0f;
        w->render_counters.celestial_discs++;
    }
    if(layers>0)w->render_counters.sky_layers+=(int)layers;
}
static int draw_uniform(R2DWorldRuntime *w,const R2DRe2dView *v,float ortho,int id,int span,bool filter,const R2DWorldDecal *decal,float ox,float oy,SurfaceUniform *u)
{
    const R2DRe2dWorld *world=&w->world;const R2DWorldSurface *surface=&world->surfaces[id];
    memset(u,0,sizeof *u);
    u->eye[0]=v->x-ox;u->eye[1]=v->y-oy;u->eye[2]=v->eye;u->eye[3]=v->near_plane;
    u->basis[0]=v->cos_yaw;u->basis[1]=v->sin_yaw;u->basis[2]=v->cos_pitch;u->basis[3]=v->sin_pitch;
    u->screen[0]=w->width;u->screen[1]=w->height;u->screen[2]=v->focal*w->height/v->height;u->screen[3]=ortho;
    uint32_t tint;
    if(surface->kind==R2D_WORLD_WALL){const R2DWorldWall *wall=&world->walls[surface->primitive];float dx=wall->x2-wall->x1,dy=wall->y2-wall->y1,len=hypotf(dx,dy);
        R2DWorldOpening opening;if(r2d_world_wall_opening(world,surface->primitive,&opening)){u->opening[0]=opening.bottom;u->opening[1]=opening.top;u->opening[2]=1;}
        u->shape[0]=wall->x1-ox;u->shape[1]=wall->y1-oy;u->shape[2]=wall->x2-ox;u->shape[3]=wall->y2-oy;u->plane[0]=wall->bottom;u->plane[1]=wall->top;
        u->normal[0]=-dy/len;u->normal[1]=dx/len;if((v->x-wall->x1)*u->normal[0]+(v->y-wall->y1)*u->normal[1]<0){u->normal[0]*=-1;u->normal[1]*=-1;}
        u->tangent[0]=dx/len;u->tangent[1]=dy/len;tint=wall->color;
    }else{const R2DWorldSpan *s=&world->spans[surface->primitive];bool ceiling=surface->kind==R2D_WORLD_CEILING;float a=ceiling?s->ceiling_a:s->floor_a,b=ceiling?s->ceiling_b:s->floor_b;
        u->shape[0]=s->x-ox;u->shape[1]=s->y-oy;u->shape[2]=s->w;u->shape[3]=s->h;u->plane[0]=ceiling?s->top:s->bottom;u->plane[1]=a;u->plane[2]=b;u->plane[3]=1;
        float k=(ceiling?-1:1)/sqrtf(1+a*a+b*b);u->normal[0]=-a*k;u->normal[1]=-b*k;u->normal[2]=k;k=1/sqrtf(1+a*a);u->tangent[0]=k;u->tangent[2]=a*k;tint=ceiling?s->ceiling_color:s->floor_color;
    }
    for(int i=0;i<4;i++)u->tint[i]=((tint>>(i*8))&255)/255.0f;
    int material=decal?decal->material:(world->surface_materials?world->surface_materials[id]:-1);
    if(material>=0){const R2DWorldMaterial *m=&world->materials[material];u->anim[0]=m->anim_u;u->anim[1]=m->anim_v;u->anim[2]=m->anim_emissive>0?m->anim_emissive:1.0f;u->material[0]=m->u_scale;u->material[1]=m->v_scale;u->material[2]=m->normal.pixels?1:0;u->material[3]=m->emissive.pixels?m->emissive_strength:0;u->identity[3]=1;u->light_options[13][3]=m->world_uv?1:0;if(m->world_uv&&surface->kind==R2D_WORLD_WALL&&(u->tangent[0]<0||(u->tangent[0]==0&&u->tangent[1]<0))){u->tangent[0]*=-1;u->tangent[1]*=-1;}u->light_options[15][3]=m->blend;u->tint[3]=m->blend>=R2D_WORLD_TRANSLUCENT?m->opacity:1;}
    if(decal){u->tint[0]=u->tint[1]=u->tint[2]=1;u->light_options[14][1]=decal->u;u->light_options[14][2]=decal->v;u->light_options[14][3]=decal->w;u->light_options[15][1]=decal->h;u->light_options[15][2]=1;
        if(decal->max_life>0.0f){
            u->decal2[0]=decal->rotation;u->decal2[1]=decal->scale>0.0f?decal->scale:1.0f;
            u->decal2[2]=r2d_world_decal_alpha(decal);u->decal2[3]=1.0f;
            if(decal->active)w->render_counters.decal2_active+=1;
        }}
    u->identity[0]=id;u->identity[1]=span;
    lighting(w,span,filter,u,ox,oy);if(w->debug_view==R2D_WORLD_DEBUG_OVERDRAW)u->identity[2]=-1;
    visual_common(w,u,ox,oy);visual_surface(w,u,surface,id,decal!=NULL);
    return material;
}

static void draw(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v,float ortho,int id,int span,bool filter,const R2DWorldDecal *decal,float ox,float oy)
{
    SurfaceUniform u;
    int material=draw_uniform(w,v,ortho,id,span,filter,decal,ox,oy,&u);
    const R2DRe2dWorld *world=&w->world;
    SDL_GPUTextureSamplerBinding samplers[3];SDL_GPUSampler *sampler=material>=0&&world->materials[material].linear?g->linear:g->sampler;
    for(int i=0;i<3;i++){int texture=material>=0?g->textures[material][i]:-1;if(texture<0)texture=i==2?g->black:g->white;samplers[i]=(SDL_GPUTextureSamplerBinding){r2d_texture_handle(w->renderer,texture),sampler};}
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
        // Atlas residency gate: no upload while the atlas payload is not resident.
        if(actor_stream_blocked(w,i)){
            if(a->color||a->depth){if(a->color)SDL_ReleaseGPUTexture(d,a->color);if(a->depth)SDL_ReleaseGPUTexture(d,a->depth);w->gpu_stream_evictions++;}
            memset(a,0,sizeof *a);a->stream_blocked=true;continue;
        }
        a->stream_blocked=false;
        uint64_t key;int revision,size=w->frame_sizes[i];bool samples=false;
        if(w->frame_kinds[i]==R2D_WORLD_FRAME_ATLAS||w->frame_kinds[i]==R2D_WORLD_FRAME_PARTICLE){key=w->frame_keys[i];revision=w->frame_revisions[i];}
        else {key=r2d_rotsprite_instance(ctx,w->frame_handles[i]);revision=r2d_rotsprite_revision(ctx,w->frame_handles[i]);samples=r2d_rotsprite_sample_depth(ctx,w->frame_handles[i])!=NULL;}
        if(a->key==key&&a->revision==revision&&a->size==size)continue;
        bytes=((bytes+511)&~(size_t)511)+(size_t)size*size*4;
        if(samples)bytes=((bytes+511)&~(size_t)511)+(size_t)size*size*4;
    }
    if(!bytes)return true;if(bytes>128*1024*1024){SDL_SetError("Re2D GPU actor upload budget 128 MiB exceeded");return false;}
    SDL_GPUTransferBufferCreateInfo t={0};t.usage=SDL_GPU_TRANSFERBUFFERUSAGE_UPLOAD;t.size=(Uint32)bytes;SDL_GPUTransferBuffer *upload=SDL_CreateGPUTransferBuffer(d,&t);if(!upload)return false;
    uint8_t *mapped=SDL_MapGPUTransferBuffer(d,upload,false);if(!mapped){SDL_ReleaseGPUTransferBuffer(d,upload);return false;}
    size_t offset=0;bool ok=true;
    for(int i=0;i<w->frame_count;i++)if(w->frame_images[i]){ActorGPU *a=&g->actors[i];if(a->stream_blocked)continue;uint64_t key=0;int revision=0,size=w->frame_sizes[i];const float *depth=NULL;
        if(w->frame_kinds[i]==R2D_WORLD_FRAME_ATLAS||w->frame_kinds[i]==R2D_WORLD_FRAME_PARTICLE){key=w->frame_keys[i];revision=w->frame_revisions[i];}
        else {key=r2d_rotsprite_instance(ctx,w->frame_handles[i]);revision=r2d_rotsprite_revision(ctx,w->frame_handles[i]);depth=r2d_rotsprite_sample_depth(ctx,w->frame_handles[i]);}
        if(a->key==key&&a->revision==revision&&a->size==size)continue;
        if(a->size!=size||(depth!=NULL)!=(a->depth!=NULL)){if(a->color)SDL_ReleaseGPUTexture(d,a->color);if(a->depth)SDL_ReleaseGPUTexture(d,a->depth);a->color=actor_texture(d,size,false);a->depth=depth?actor_texture(d,size,true):NULL;}
        if(!a->color||(depth&&!a->depth)){ok=false;break;}
        for(int j=0;j<(depth?2:1);j++){offset=(offset+511)&~(size_t)511;size_t count=(size_t)size*size*4;memcpy(mapped+offset,j?(const void *)depth:w->frame_images[i],count);
            a->offsets[j]=(Uint32)offset;offset+=count;}
        a->key=key;a->revision=revision;a->size=size;a->dirty=true;
        w->gpu_stream_uploads++;w->gpu_stream_upload_bytes+=(uint64_t)size*size*4u*(depth?2u:1u);
    }
    SDL_UnmapGPUTransferBuffer(d,upload);
    if(ok){SDL_GPUCopyPass *copy=SDL_BeginGPUCopyPass(cmd);for(int i=0;i<w->frame_count;i++){ActorGPU *a=&g->actors[i];if(!a->dirty)continue;
        for(int j=0;j<(a->depth?2:1);j++){SDL_GPUTextureTransferInfo src={0};src.transfer_buffer=upload;src.offset=a->offsets[j];src.pixels_per_row=src.rows_per_layer=a->size;
            SDL_GPUTextureRegion dst={0};dst.texture=j?a->depth:a->color;dst.w=dst.h=a->size;dst.d=1;SDL_UploadToGPUTexture(copy,&src,&dst,true);}}
        SDL_EndGPUCopyPass(copy);}
    SDL_ReleaseGPUTransferBuffer(d,upload);return ok;
}
static bool set_scissor(WorldGPU *g,SDL_GPURenderPass *pass,SDL_Rect r)
{
    if(g->clip_active){
        int left=r.x>g->clip.x?r.x:g->clip.x,top=r.y>g->clip.y?r.y:g->clip.y;
        int right=(r.x+r.w)<(g->clip.x+g->clip.w)?(r.x+r.w):(g->clip.x+g->clip.w);
        int bottom=(r.y+r.h)<(g->clip.y+g->clip.h)?(r.y+r.h):(g->clip.y+g->clip.h);
        r=(SDL_Rect){left,top,right>left?right-left:0,bottom>top?bottom-top:0};
    }
    if(r.w<=0||r.h<=0)return false;
    SDL_SetGPUScissor(pass,&r);
    return true;
}
static void actor_draw(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v,float ortho,int i,int span,bool filter,float ox,float oy)
{
    const float *p=w->frame_positions+i*5;ActorGPU *a=&g->actors[i];SurfaceUniform u={0};bool samples=a->depth!=NULL;
    if(!a->color||a->stream_blocked)return;
    float center=p[2]+p[4]*.5f,dx=p[0]-v->x,dy=p[1]-v->y,forward=dx*v->cos_yaw+dy*v->sin_yaw;
    float anchor=samples?center:p[2],dist=forward*v->cos_pitch+(anchor-v->eye)*v->sin_pitch;if(dist<v->near_plane)return;
    float projected[4],scale;
    if(ortho>0){scale=v->height/ortho;projected[0]=v->width*.5f+(-dx*v->sin_yaw+dy*v->cos_yaw)*scale;projected[1]=v->height*.5f-((anchor-v->eye)*v->cos_pitch-forward*v->sin_pitch)*scale;}
    else{if(!r2d_re2d_project(v,p[0],p[1],anchor,projected))return;scale=projected[3];}
    u.eye[0]=v->x-ox;u.eye[1]=v->y-oy;u.eye[2]=v->eye;u.eye[3]=v->near_plane;
    u.basis[0]=v->cos_yaw;u.basis[1]=v->sin_yaw;u.basis[2]=v->cos_pitch;u.basis[3]=v->sin_pitch;
    u.screen[0]=w->width;u.screen[1]=w->height;u.screen[2]=v->focal*w->height/v->height;u.screen[3]=ortho;
    u.billboard[2]=p[3]*scale*w->width/v->width;u.billboard[3]=p[4]*scale*w->height/v->height;
    u.billboard[0]=projected[0]*w->width/v->width-u.billboard[2]*.5f;u.billboard[1]=projected[1]*w->height/v->height-u.billboard[3]*(samples?.5f:1);
    int left=(int)fmaxf(0,fminf(w->width,floorf(u.billboard[0]))),top=(int)fmaxf(0,fminf(w->height,floorf(u.billboard[1])));
    int right=(int)fmaxf(0,fminf(w->width,ceilf(u.billboard[0]+u.billboard[2]))),bottom=(int)fmaxf(0,fminf(w->height,ceilf(u.billboard[1]+u.billboard[3])));
    if(right<=left||bottom<=top)return;SDL_Rect scissor={left,top,right-left,bottom-top};if(!set_scissor(g,pass,scissor))return;
    w->gpu_draw_actor++;
    u.actor[0]=p[0]-ox;u.actor[1]=p[1]-oy;u.actor[2]=center;u.actor[3]=p[4];u.shape[2]=p[3];u.plane[0]=dist;u.plane[3]=2;
    u.material[2]=samples?1:0;u.identity[0]=-1;u.identity[1]=span;u.identity[3]=1;u.opening[3]=i;
    for(int c=0;c<4;c++)u.tint[c]=1;
    if(w->frame_kinds[i]==R2D_WORLD_FRAME_ATLAS||w->frame_kinds[i]==R2D_WORLD_FRAME_PARTICLE){
        u.light_options[15][3]=(float)w->frame_blends[i];
        for(int c=0;c<4;c++)u.tint[c]=w->frame_tints[i*4+c];
        if(w->frame_kinds[i]==R2D_WORLD_FRAME_PARTICLE)u.light_options[15][3]=w->frame_blends[i]>=R2D_WORLD_TRANSLUCENT?2.0f:0.0f;
    }
    lighting(w,span,filter,&u,ox,oy);if(w->debug_view==R2D_WORLD_DEBUG_OVERDRAW)u.identity[2]=-1;
    visual_common(w,&u,ox,oy);visual_actor(w,&u);
    SDL_GPUTextureSamplerBinding textures[3]={{a->color,g->sampler},{a->depth?a->depth:r2d_texture_handle(w->renderer,g->black),g->sampler},{r2d_texture_handle(w->renderer,g->black),g->sampler}};
    material_bind(w,g,pass,textures);SDL_PushGPUFragmentUniformData(cmd,0,&u,sizeof u);SDL_DrawGPUPrimitives(pass,3,1,0,0);g->draws++;
}
static bool batch_cpu_reserve(WorldGPU *g,int count)
{
    if(count<=g->batch_uniform_capacity)return true;
    int cap=count<16?16:count;
    SurfaceUniform *uniforms=realloc(g->batch_uniforms,(size_t)cap*sizeof *uniforms);
    if(!uniforms)return false;
    g->batch_uniforms=uniforms;g->batch_uniform_capacity=cap;
    SurfaceUniform *packed=realloc(g->batch_packed,(size_t)cap*sizeof *packed);
    if(!packed)return false;
    g->batch_packed=packed;g->batch_packed_capacity=cap;
    R2DWorldBatchItem *items=realloc(g->batch_items,(size_t)cap*sizeof *items);
    if(!items)return false;
    g->batch_items=items;g->batch_item_capacity=cap;
    R2DWorldBatchInstance *instances=realloc(g->batch_instances,(size_t)cap*sizeof *instances);
    if(!instances)return false;
    g->batch_instances=instances;g->batch_instance_capacity=cap;
    R2DWorldBatchGroup *groups=realloc(g->batch_groups,(size_t)cap*sizeof *groups);
    if(!groups)return false;
    g->batch_groups=groups;g->batch_group_capacity=cap;
    return true;
}

static void batch_begin(WorldGPU *g)
{
    g->batch_uniform_count=0;g->batch_base_count=0;g->batch_span_count=0;g->batch_last_variant_count=0;
    g->batch_instance_count=0;g->batch_group_count=0;
}

static bool batch_append(R2DWorldRuntime *w,WorldGPU *g,const R2DRe2dView *v,float ortho,
                         int id,int span,bool filter,float ox,float oy,
                         int left,int top,int right,int bottom,int depth_rank)
{
    if(!batch_cpu_reserve(g,g->batch_uniform_count+1))return false;
    int index=g->batch_uniform_count;
    int material=draw_uniform(w,v,ortho,id,span,filter,NULL,ox,oy,&g->batch_uniforms[index]);
    g->batch_uniforms[index].scissor[0]=(float)left;g->batch_uniforms[index].scissor[1]=(float)top;
    g->batch_uniforms[index].scissor[2]=(float)right;g->batch_uniforms[index].scissor[3]=(float)bottom;
    g->batch_uniforms[index].ordinal[0]=(float)depth_rank;
    g->batch_uniforms[index].ordinal[1]=filter?1.0f:0.0f;
    r2d_world_batch_item(&g->batch_items[index],R2D_WORLD_BATCH_KIND_SURFACE,id,span,material,
                         r2d_world_surface_blend(&w->world,id),R2D_WORLD_BATCH_LIGHT_STATIC,-1,0,
                         (uint32_t)index);
    g->batch_uniform_count=index+1;
    return true;
}

// Collect exactly the draws the per-surface opaque path would issue, preserving
// submission order inside a group (batch_items stores the uniform index in aux).
static void batch_surface(R2DWorldRuntime *w,WorldGPU *g,const R2DRe2dView *v,float ortho,
                          int id,float ox,float oy)
{
    if(w->world.surface_sky&&w->world.surface_sky[id]){w->render_counters.sky_surfaces++;return;}
    const R2DWorldSurface *s=&w->world.surfaces[id];const R2DWorldWindow *window=&w->visibility.surface_windows[id];
    SDL_Rect projected;if(!surface_bounds(w,v,ortho,id,&projected))return;
    int left=(int)fmaxf(0,floorf(window->left*w->width/v->width)),top=(int)fmaxf(0,floorf(window->top*w->height/v->height));
    int right=(int)fminf(w->width,ceilf(window->right*w->width/v->width)),bottom=(int)fminf(w->height,ceilf(window->bottom*w->height/v->height));
    left=left>projected.x?left:projected.x;top=top>projected.y?top:projected.y;
    right=right<projected.x+projected.w?right:projected.x+projected.w;bottom=bottom<projected.y+projected.h?bottom:projected.y+projected.h;
    if(right<=left||bottom<=top)return;
    if(s->kind!=R2D_WORLD_WALL){
        if(batch_append(w,g,v,ortho,id,s->span,false,ox,oy,left,top,right,bottom,0))g->batch_base_count++;
        return;
    }
    if(r2d_world_surface_blend(&w->world,id)<R2D_WORLD_TRANSLUCENT||w->debug_view==R2D_WORLD_DEBUG_OVERDRAW){
        if(batch_append(w,g,v,ortho,id,-1,false,ox,oy,left,top,right,bottom,0))g->batch_base_count++;
    }
    const int wall=s->primitive;int span_rank=0;
    if(g->wall_span_offsets&&wall>=0&&wall<w->world.wall_count){
        for(int r=g->wall_span_offsets[wall];r<g->wall_span_offsets[wall+1];r++){
            const int span=g->wall_span_refs[r];
            if(span<0||span>=w->world.span_count||!w->visibility.span_seen[span])continue;
            if(!r2d_world_wall_solid(&w->world,wall,w->world.spans[span].bottom,w->world.spans[span].top))continue;
            if(batch_append(w,g,v,ortho,id,span,true,ox,oy,left,top,right,bottom,++span_rank))g->batch_span_count++;
        }
    }else{
        for(int k=0;k<w->visibility.span_count;k++){int span=w->visibility.spans[k];bool incident=false;
            for(int rr=w->world.span_wall_offsets[span];rr<w->world.span_wall_offsets[span+1];rr++)if(w->world.span_wall_refs[rr]==s->primitive){incident=true;break;}
            if(incident&&r2d_world_wall_solid(&w->world,s->primitive,w->world.spans[span].bottom,w->world.spans[span].top)){
                if(batch_append(w,g,v,ortho,id,span,true,ox,oy,left,top,right,bottom,++span_rank))g->batch_span_count++;
            }
        }
    }
}

static bool batch_slot_reserve(WorldGPU *g,int count)
{
    if(count<=g->batch_slot_capacity)return true;
    int cap=count<8?8:count;
    BatchGPUSlot *slots=realloc(g->batch_slots,(size_t)cap*sizeof *slots);
    if(!slots)return false;
    memset(slots+g->batch_slot_capacity,0,(size_t)(cap-g->batch_slot_capacity)*sizeof *slots);
    g->batch_slots=slots;g->batch_slot_capacity=cap;
    return true;
}

static bool batch_upload(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd)
{
    int count=g->batch_uniform_count;if(count<=0)return true;
    R2DWorldBatchBuffers buffers={g->batch_groups,g->batch_group_capacity,
                                  g->batch_instances,g->batch_instance_capacity};
    R2DWorldBatchStats stats;
    int total=r2d_world_batch_build(g->batch_items,count,&buffers,&stats);
    if(total!=count||stats.overflow)return false;
    g->batch_instance_count=count;g->batch_group_count=stats.groups;
    for(int i=0;i<count;i++){
        uint32_t index=g->batch_instances[i].aux;
        if(index>=(uint32_t)count)return false;
        g->batch_packed[i]=g->batch_uniforms[index];
    }
    if(!batch_slot_reserve(g,stats.groups))return false;
    SDL_GPUDevice *d=w->renderer->device;
    SDL_GPUCopyPass *copy=NULL;
    for(int i=0;i<stats.groups;i++){
        const R2DWorldBatchGroup *group=&g->batch_groups[i];
        Uint32 bytes=(Uint32)((size_t)group->count*sizeof(SurfaceUniform));
        BatchGPUSlot *slot=&g->batch_slots[i];
        if(bytes>(Uint32)slot->buffer_capacity){
            if(slot->buffer)SDL_ReleaseGPUBuffer(d,slot->buffer);
            SDL_GPUBufferCreateInfo b={0};b.usage=SDL_GPU_BUFFERUSAGE_GRAPHICS_STORAGE_READ;b.size=bytes;
            slot->buffer=SDL_CreateGPUBuffer(d,&b);
            if(!slot->buffer){slot->buffer_capacity=0;return false;}
            slot->buffer_capacity=(int)bytes;
        }
        if(bytes>(Uint32)slot->upload_capacity){
            if(slot->upload)SDL_ReleaseGPUTransferBuffer(d,slot->upload);
            SDL_GPUTransferBufferCreateInfo t={0};t.usage=SDL_GPU_TRANSFERBUFFERUSAGE_UPLOAD;t.size=bytes;
            slot->upload=SDL_CreateGPUTransferBuffer(d,&t);
            if(!slot->upload){slot->upload_capacity=0;return false;}
            slot->upload_capacity=(int)bytes;
        }
        void *mapped=SDL_MapGPUTransferBuffer(d,slot->upload,false);
        if(!mapped)return false;
        memcpy(mapped,g->batch_packed+group->first,bytes);
        SDL_UnmapGPUTransferBuffer(d,slot->upload);
        if(!copy)copy=SDL_BeginGPUCopyPass(cmd);
        SDL_GPUTransferBufferLocation src={slot->upload,0};
        SDL_GPUBufferRegion dst={slot->buffer,0,bytes};
        SDL_UploadToGPUBuffer(copy,&src,&dst,true);
    }
    if(copy)SDL_EndGPUCopyPass(copy);
    return true;
}

static void batch_draw(R2DWorldRuntime *w,WorldGPU *g,SDL_GPURenderPass *pass)
{
    if(!g->batch_group_count)return;
    // The batch pass inherits the scissor of the preceding pass (sky/cards);
    // reset it to the full target and clip per instance in the shader instead.
    SDL_Rect full={0,0,w->width,w->height};
    SDL_SetGPUScissor(pass,&full);
    SDL_BindGPUGraphicsPipeline(pass,g->batch_pipeline);
    for(int i=0;i<g->batch_group_count;i++){
        const R2DWorldBatchGroup *group=&g->batch_groups[i];
        int material=group->material>=0x80000000u?-1:(int)group->material;
        const R2DRe2dWorld *world=&w->world;
        SDL_GPUTextureSamplerBinding samplers[3];
        SDL_GPUSampler *sampler=material>=0&&world->materials[material].linear?g->linear:g->sampler;
        for(int t=0;t<3;t++){int texture=material>=0?g->textures[material][t]:-1;if(texture<0)texture=t==2?g->black:g->white;
            samplers[t]=(SDL_GPUTextureSamplerBinding){r2d_texture_handle(w->renderer,texture),sampler};}
        material_bind(w,g,pass,samplers);
        SDL_GPUBuffer *buffers[2]={g->batch_slots[i].buffer,g->shadows};
        SDL_BindGPUFragmentStorageBuffers(pass,0,buffers,2);
        SDL_DrawGPUPrimitives(pass,3,group->count,0,0);
        g->draws++;
    }
    SDL_BindGPUFragmentStorageBuffers(pass,0,&g->shadows,1);
    w->gpu_draw_base=g->batch_base_count;
    w->gpu_draw_span=g->batch_span_count;
    w->gpu_batch_draws=g->batch_group_count;
    w->gpu_batch_instances=g->batch_instance_count;
    w->gpu_batch_logical=g->batch_base_count+g->batch_span_count;
    w->gpu_batch_saved=w->gpu_batch_logical>g->batch_group_count?w->gpu_batch_logical-g->batch_group_count:0;
    // Preserve the historical gpuDraws attribution: the profiler counter counts
    // logical submissions, while gpu_batch_draws reports actual group draws.
    g->draws+=w->gpu_batch_saved;
}

static bool ensure_wall_spans(R2DWorldRuntime *w,WorldGPU *g)
{
    const int nw=w->world.wall_count;
    const int refs=w->world.span_wall_offsets?w->world.span_wall_offsets[w->world.span_count]:0;
    if(g->wall_span_offsets&&g->wall_span_revision==w->world.topology_revision&&g->wall_span_count==refs)return true;
    free(g->wall_span_offsets);free(g->wall_span_refs);g->wall_span_offsets=NULL;g->wall_span_refs=NULL;g->wall_span_count=0;
    int *offsets=(int *)calloc((size_t)(nw+1),sizeof *offsets);
    int *counts=(int *)calloc((size_t)(nw?nw:1),sizeof *counts);
    int *refs_out=(int *)malloc((size_t)(refs?refs:1)*sizeof *refs_out);
    if(!offsets||!counts||!refs_out){free(offsets);free(counts);free(refs_out);return false;}
    for(int span=0;span<w->world.span_count;span++)
        for(int r=w->world.span_wall_offsets[span];r<w->world.span_wall_offsets[span+1];r++){
            const int wall=w->world.span_wall_refs[r];
            if(wall>=0&&wall<nw)counts[wall]++;
        }
    for(int i=0;i<nw;i++)offsets[i+1]=offsets[i]+counts[i];
    int *fill=(int *)calloc((size_t)(nw?nw:1),sizeof *fill);
    if(!fill){free(offsets);free(counts);free(refs_out);return false;}
    for(int span=0;span<w->world.span_count;span++)
        for(int r=w->world.span_wall_offsets[span];r<w->world.span_wall_offsets[span+1];r++){
            const int wall=w->world.span_wall_refs[r];
            if(wall>=0&&wall<nw)refs_out[offsets[wall]+fill[wall]++]=span;
        }
    free(fill);free(counts);
    g->wall_span_offsets=offsets;g->wall_span_refs=refs_out;g->wall_span_count=refs;g->wall_span_revision=w->world.topology_revision;
    return true;
}

static void surface_draw(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v,float ortho,int id,float ox,float oy)
{
    if(w->world.surface_sky&&w->world.surface_sky[id]){w->render_counters.sky_surfaces++;return;}
    const R2DWorldSurface *s=&w->world.surfaces[id];const R2DWorldWindow *window=&w->visibility.surface_windows[id];
        SDL_Rect projected;if(!surface_bounds(w,v,ortho,id,&projected))return;
        int left=(int)fmaxf(0,floorf(window->left*w->width/v->width)),top=(int)fmaxf(0,floorf(window->top*w->height/v->height));
        int right=(int)fminf(w->width,ceilf(window->right*w->width/v->width)),bottom=(int)fminf(w->height,ceilf(window->bottom*w->height/v->height));
        left=left>projected.x?left:projected.x;top=top>projected.y?top:projected.y;
        right=right<projected.x+projected.w?right:projected.x+projected.w;bottom=bottom<projected.y+projected.h?bottom:projected.y+projected.h;
        if(right<=left||bottom<=top)return;SDL_Rect scissor={left,top,right-left,bottom-top};if(!set_scissor(g,pass,scissor))return;
        if(s->kind!=R2D_WORLD_WALL){draw(w,g,cmd,pass,v,ortho,id,s->span,false,NULL,ox,oy);w->gpu_draw_base++;return;}
        if(r2d_world_surface_blend(&w->world,id)<R2D_WORLD_TRANSLUCENT||w->debug_view==R2D_WORLD_DEBUG_OVERDRAW){
            draw(w,g,cmd,pass,v,ortho,id,-1,false,NULL,ox,oy);w->gpu_draw_base++;
        }
        // Use the cached inverse incidence list instead of scanning every
        // visible span for every wall (the only superlinear term in a frame).
        const int wall=s->primitive;
        if(g->wall_span_offsets&&wall>=0&&wall<w->world.wall_count){
            for(int r=g->wall_span_offsets[wall];r<g->wall_span_offsets[wall+1];r++){
                const int span=g->wall_span_refs[r];
                if(span<0||span>=w->world.span_count||!w->visibility.span_seen[span])continue;
                if(!r2d_world_wall_solid(&w->world,wall,w->world.spans[span].bottom,w->world.spans[span].top))continue;
                draw(w,g,cmd,pass,v,ortho,id,span,true,NULL,ox,oy);w->gpu_draw_span++;
            }
        }else{
            for(int k=0;k<w->visibility.span_count;k++){int span=w->visibility.spans[k];bool incident=false;
                for(int rr=w->world.span_wall_offsets[span];rr<w->world.span_wall_offsets[span+1];rr++)if(w->world.span_wall_refs[rr]==s->primitive){incident=true;break;}
                if(incident&&r2d_world_wall_solid(&w->world,s->primitive,w->world.spans[span].bottom,w->world.spans[span].top)){
                    draw(w,g,cmd,pass,v,ortho,id,span,true,NULL,ox,oy);w->gpu_draw_span++;
                }
            }
        }
}

static void sky_draw(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v,float ortho)
{
    SurfaceUniform sky={0};sky.basis[0]=v->cos_yaw;sky.basis[1]=v->sin_yaw;sky.basis[2]=v->cos_pitch;sky.basis[3]=v->sin_pitch;
    sky.screen[0]=w->width;sky.screen[1]=w->height;sky.screen[2]=v->focal*w->height/v->height;sky.screen[3]=ortho;sky.plane[3]=3;
    sky.material[0]=w->world.sky_yaw;sky.identity[3]=w->world.sky.pixels?1:0;uint32_t tint=w->world.sky_color?w->world.sky_color:0xffffffff;
    for(int c=0;c<4;c++)sky.tint[c]=((tint>>(c*8))&255)/255.0f;
    visual_sky(w,&sky);w->render_counters.sky_draws++;
    SDL_GPUTexture *texture=r2d_texture_handle(w->renderer,g->sky_texture>=0?g->sky_texture:g->white);
    SDL_GPUTextureSamplerBinding samplers[3]={{texture,g->sky_sampler},{texture,g->sampler},{texture,g->sampler}};
    material_bind(w,g,pass,samplers);SDL_PushGPUFragmentUniformData(cmd,0,&sky,sizeof sky);SDL_DrawGPUPrimitives(pass,3,1,0,0);g->draws++;w->gpu_draw_other++;
}
// R-03 VFX cards/trails: one procedural quad shader branch (plane.w=5), no
// texture and no mesh. Depth-tested against the world, no depth write.
static bool vfx_project(const R2DRe2dView *v,float x,float y,float h,float ortho,float out[4],float *dist)
{
    float dx=x-v->x,dy=y-v->y,forward=dx*v->cos_yaw+dy*v->sin_yaw;
    if(ortho>0){
        float depth=forward*v->cos_pitch+(h-v->eye)*v->sin_pitch;
        if(depth<v->near_plane)return false;
        float scale=v->height/ortho;
        out[0]=v->width*.5f+(-dx*v->sin_yaw+dy*v->cos_yaw)*scale;
        out[1]=v->height*.5f-((h-v->eye)*v->cos_pitch-forward*v->sin_pitch)*scale;
        out[2]=1-v->near_plane/depth;out[3]=scale;*dist=depth;return true;
    }
    if(!r2d_re2d_project(v,x,y,h,out))return false;
    *dist=v->focal/out[3];return true;
}
static void vfx_quad_draw(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,
                          float cx,float cy,float side,float rotation,int kind,
                          float r,float gg,float b,float alpha,float width_ratio,
                          int distortion,float dist,int blend,float near_plane)
{
    if(!(side>0.5f)||!(alpha>0.002f))return;
    float half=side*0.62f;
    int left=(int)fmaxf(0,floorf(cx-half)),top=(int)fmaxf(0,floorf(cy-half));
    int right=(int)fminf(w->width,ceilf(cx+half)),bottom=(int)fminf(w->height,ceilf(cy+half));
    if(right<=left||bottom<=top)return;
    SDL_Rect scissor={left,top,right-left,bottom-top};
    if(!set_scissor(g,pass,scissor))return;
    SDL_GPUGraphicsPipeline *pipeline=blend==R2D_WORLD_ADDITIVE?g->fx_additive:g->fx_translucent;
    SDL_BindGPUGraphicsPipeline(pass,pipeline);
    SurfaceUniform u={0};
    u.eye[3]=near_plane;u.plane[3]=5.0f;u.plane[0]=dist;
    u.billboard[0]=cx-side*.5f;u.billboard[1]=cy-side*.5f;u.billboard[2]=side;u.billboard[3]=side;
    u.material[0]=(float)kind;u.material[1]=rotation;u.material[2]=width_ratio;u.material[3]=(float)distortion;
    u.tint[0]=r;u.tint[1]=gg;u.tint[2]=b;u.tint[3]=alpha;
    u.anim[0]=w->render_time;
    SDL_PushGPUFragmentUniformData(cmd,0,&u,sizeof u);
    SDL_DrawGPUPrimitives(pass,3,1,0,0);
    g->draws++;w->gpu_draw_vfx++;w->render_counters.vfx_draws++;
}
static void vfx_draw_all(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v,float ortho)
{
    R2DWorldVfx *vfx=w->vfx;
    if(!vfx)return;
    float sx=(float)w->width/v->width,sy=(float)w->height/v->height;
    // Cards (sprite/streak/ring/flash/decal/light pulse) are procedural quads.
    for(int i=0;i<R2D_WORLD_VFX_MAX_CARDS;i++){
        const R2DWorldVfxCard *card=&vfx->cards[i];
        if(!card->active||!(card->alpha>0.002f)||!(card->size>0.0f))continue;
        float p[4],dist=0;
        if(!vfx_project(v,card->x,card->y,card->h,ortho,p,&dist))continue;
        float side=card->size*p[3]*fmaxf(sx,sy)*1.15f;
        float ratio=card->size>1e-4f?fmaxf(0.02f,card->width/card->size):1.0f;
        int blend=card->blend==R2D_PARTICLE_ADDITIVE?R2D_WORLD_ADDITIVE:R2D_WORLD_TRANSLUCENT;
        float cx=p[0]*sx,cy=p[1]*sy;
        // Depth is written into the uniform by vfx_quad_draw; pass near via eye.w.
        vfx_quad_draw(w,g,cmd,pass,cx,cy,side,card->rotation,card->kind,
                      card->r,card->g,card->b,card->alpha,ratio,card->distortion,dist,blend,v->near_plane);
        w->render_counters.vfx_cards++;w->render_counters.vfx_card_draws++;
        if(card->distortion!=R2D_VFX_DISTORTION_NONE)w->render_counters.vfx_distortion++;
    }
    // Trails: one streak quad per live segment; square card, rotated by segment.
    for(int i=0;i<R2D_WORLD_VFX_MAX_TRAILS;i++){
        const R2DWorldVfxTrail *trail=&vfx->trails[i];
        if(!trail->active||trail->count<=0)continue;
        float fraction=trail->max_life>0.0f?trail->life/trail->max_life:1.0f;
        if(fraction<0.0f)fraction=0.0f;if(fraction>1.0f)fraction=1.0f;
        float alpha=fminf(1.0f,fraction*1.25f);
        int segments=trail->count-1;
        if(segments<=0){
            float p[4],dist=0;
            if(vfx_project(v,trail->head_x,trail->head_y,trail->head_h,ortho,p,&dist)){
                float side=fmaxf(2.0f,trail->width*p[3]*fmaxf(sx,sy));
                vfx_quad_draw(w,g,cmd,pass,p[0]*sx,p[1]*sy,side*1.6f,0.0f,R2D_VFX_CARD_SPRITE,
                              trail->r,trail->g,trail->b,alpha,1.0f,trail->distortion,dist,
                              trail->blend==R2D_PARTICLE_ADDITIVE?R2D_WORLD_ADDITIVE:R2D_WORLD_TRANSLUCENT,v->near_plane);
                w->render_counters.vfx_trail_draws++;
            }
        }
        for(int k=0;k<trail->count;k++){
            float p0[4],p1[4],d0=0,d1=0;
            float ax=(k==0)?trail->head_x:trail->x[k-1];
            float ay=(k==0)?trail->head_y:trail->y[k-1];
            float ah=(k==0)?trail->head_h:trail->h[k-1];
            float bx=trail->x[k],by=trail->y[k],bh=trail->h[k];
            if(!vfx_project(v,ax,ay,ah,ortho,p0,&d0))continue;
            if(!vfx_project(v,bx,by,bh,ortho,p1,&d1))continue;
            float x0=p0[0]*sx,y0=p0[1]*sy,x1=p1[0]*sx,y1=p1[1]*sy;
            float dx=x1-x0,dy=y1-y0,length=sqrtf(dx*dx+dy*dy);
            float thickness=fmaxf(1.2f,trail->width*p0[3]*fmaxf(sx,sy));
            float side=fmaxf(length,thickness)*1.15f;
            float ratio=side>1e-4f?fminf(1.0f,thickness/side):1.0f;
            float rot=atan2f(dy,dx);
            vfx_quad_draw(w,g,cmd,pass,(x0+x1)*.5f,(y0+y1)*.5f,side,rot,R2D_VFX_CARD_STREAK,
                          trail->r,trail->g,trail->b,alpha,ratio,trail->distortion,(d0+d1)*.5f,
                          trail->blend==R2D_PARTICLE_ADDITIVE?R2D_WORLD_ADDITIVE:R2D_WORLD_TRANSLUCENT,v->near_plane);
            w->render_counters.vfx_trail_draws++;
        }
        w->render_counters.vfx_trails++;
        if(trail->distortion!=R2D_VFX_DISTORTION_NONE)w->render_counters.vfx_distortion++;
    }
}
// P4 sky/weather/shaft cards: one procedural quad through the same card shader
// branch as VFX (plane.w=5), but with its own counters so VFX attribution stays
// clean. Screen-space callers pass pixel coordinates; world-space callers project
// first (shaft cards do that below).
static void p4_quad_draw(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,
                         float cx,float cy,float side,float rotation,int kind,
                         float r,float gg,float b,float alpha,float width_ratio,
                         int distortion,float dist,int blend,float near_plane,int *counter)
{
    if(!(side>0.5f)||!(alpha>0.002f))return;
    float half=side*0.62f;
    int left=(int)fmaxf(0,floorf(cx-half)),top=(int)fmaxf(0,floorf(cy-half));
    int right=(int)fminf(w->width,ceilf(cx+half)),bottom=(int)fminf(w->height,ceilf(cy+half));
    if(right<=left||bottom<=top)return;
    SDL_Rect scissor={left,top,right-left,bottom-top};
    if(!set_scissor(g,pass,scissor))return;
    SDL_GPUGraphicsPipeline *pipeline=blend==R2D_WORLD_ADDITIVE?g->fx_additive:g->fx_translucent;
    SDL_BindGPUGraphicsPipeline(pass,pipeline);
    SurfaceUniform u={0};
    u.eye[3]=near_plane;u.plane[3]=5.0f;u.plane[0]=dist;
    u.billboard[0]=cx-side*.5f;u.billboard[1]=cy-side*.5f;u.billboard[2]=side;u.billboard[3]=side;
    u.material[0]=(float)kind;u.material[1]=rotation;u.material[2]=width_ratio;u.material[3]=(float)distortion;
    u.tint[0]=r;u.tint[1]=gg;u.tint[2]=b;u.tint[3]=alpha;
    u.anim[0]=w->render_time;
    SDL_PushGPUFragmentUniformData(cmd,0,&u,sizeof u);
    SDL_DrawGPUPrimitives(pass,3,1,0,0);
    g->draws++;w->gpu_draw_other++;if(counter)*counter+=1;
}
// Distant sky cards sit behind world geometry: drawn right after the panorama,
// before opaque surfaces, with a depth of 1 so closer world pixels win.
static void sky_p4_distant(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v)
{
    const R2DWorldRenderFeatures *rf=&w->render_features;
    if(!rf->sky_layers||rf->distant_cards<=0)return;
    R2DWorldSky sky;
    r2d_world_sky_defaults(&sky);
    int cards=(int)rf->distant_cards;
    if(cards>sky.distant_count)cards=sky.distant_count;
    for(int i=0;i<cards;i++){
        float x=0;uint32_t tint=0;float alpha=0;
        float yaw=atan2f(v->sin_yaw,v->cos_yaw);
        r2d_world_sky_distant_sample(&sky,i,yaw,w->render_time,&x,&tint,&alpha);
        if(!(alpha>0.001f))continue;
        float px=(0.5f+(x-0.5f)*0.5f)*w->width;
        float py=w->height*(0.44f+0.055f*(float)i+sky.distant[i].offset*0.12f);
        float side=w->height*(0.55f+0.12f*(float)i);
        float cr=((tint>>0)&255)/255.0f,cg=((tint>>8)&255)/255.0f,cb=((tint>>16)&255)/255.0f;
        p4_quad_draw(w,g,cmd,pass,px,py,side,0.0f,1,cr,cg,cb,alpha*fminf(1.0f,0.35f+0.1f*(float)i),0.16f,0,100000.0f,R2D_WORLD_TRANSLUCENT,v->near_plane,&w->render_counters.distant_cards);
    }
}
// Weather cards are drawn last, in front of the world. Deterministic sampling
// from the sky model; count is density-bounded so ultra stays cheap.
static void sky_p4_weather(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v)
{
    const R2DWorldRenderFeatures *rf=&w->render_features;
    if(!rf->weather_layers)return;
    R2DWorldSky sky;
    if(rf->sky_profile>=0&&rf->sky_profile<R2D_SKY_PROFILE_COUNT)r2d_world_sky_profile(rf->sky_profile,&sky);
    else r2d_world_sky_defaults(&sky);
    if(rf->weather_type>R2D_SKY_WEATHER_NONE&&rf->weather_type<R2D_SKY_WEATHER_COUNT&&sky.weather_count<R2D_SKY_MAX_WEATHER){
        sky.weather[sky.weather_count].type=rf->weather_type;
        sky.weather[sky.weather_count].density=rf->weather_density;
        sky.weather[sky.weather_count].speed=rf->weather_type==R2D_SKY_WEATHER_CLOUDS?0.03f:0.55f;
        sky.weather[sky.weather_count].slant=0.3f;
        sky.weather[sky.weather_count].size=1.0f;
        sky.weather[sky.weather_count].opacity=0.55f;
        sky.weather_count+=1;
    }
    for(int layer=0;layer<sky.weather_count;layer++){
        int budget=(int)(sky.weather[layer].density*96.0f);
        if(budget<=0)continue;if(budget>96)budget=96;
        for(int i=0;i<budget;i++){
            float out[6];int type=0;
            if(!r2d_world_sky_weather_sample(&sky,layer,i,w->render_time,rf->seed,out,&type))continue;
            float px=out[0]*(float)w->width,py=out[1]*(float)w->height;
            float side=(type==R2D_SKY_WEATHER_CLOUDS?w->height*out[2]:w->height*out[2]);
            float ratio=type==R2D_SKY_WEATHER_CLOUDS?0.35f:out[3]/fmaxf(out[2],1e-4f);
            int kind=type==R2D_SKY_WEATHER_CLOUDS?3:(type==R2D_SKY_WEATHER_SNOW?0:1);
            float rot=type==R2D_SKY_WEATHER_CLOUDS?0.0f:atan2f(out[4],1.0f);
            float alpha=out[5]*0.75f;
            float cr=0.72f,cg=0.80f,cb=0.92f;
            if(type==R2D_SKY_WEATHER_SNOW){cr=cg=cb=0.96f;}
            else if(type==R2D_SKY_WEATHER_ASH){cr=cg=cb=0.55f;}
            else if(type==R2D_SKY_WEATHER_RAIN){cr=0.55f;cg=0.68f;cb=0.85f;}
            int blend=type==R2D_SKY_WEATHER_CLOUDS?R2D_WORLD_TRANSLUCENT:R2D_WORLD_ADDITIVE;
            // dist = near plane keeps weather in front of world geometry.
            p4_quad_draw(w,g,cmd,pass,px,py,side,rot,kind,cr,cg,cb,alpha,ratio,type==R2D_SKY_WEATHER_RAIN?1:0,
                         v->near_plane*1.01f,blend,v->near_plane,&w->render_counters.weather_cards);
        }
    }
}
// Light shafts: authored point lights become translucent additive cards from
// the light down to a floor-ish end. No raymarch, no volume texture.
static void sky_p4_shafts(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v,float ortho)
{
    const R2DWorldRenderFeatures *rf=&w->render_features;
    if(!rf->light_shafts||rf->shaft_budget<=0)return;
    int drawn=0;
    for(int i=0;i<R2D_WORLD_MAX_LIGHTS&&drawn<rf->shaft_budget;i++){
        const R2DWorldLight *l=&w->world.lights[i];
        if(!l->active||!(l->intensity>0.0f))continue;
        float top[4],bottom[4],d0=0,d1=0;
        if(!vfx_project(v,l->x,l->y,l->h,ortho,top,&d0))continue;
        if(!vfx_project(v,l->x,l->y,l->h-rf->shaft_length,ortho,bottom,&d1))continue;
        float sx=(float)w->width/v->width,sy=(float)w->height/v->height;
        float x0=top[0]*sx,y0=top[1]*sy,x1=bottom[0]*sx,y1=bottom[1]*sy;
        float dx=x1-x0,dy=y1-y0,length=sqrtf(dx*dx+dy*dy);
        if(length<4.0f)continue;
        float width_px=fmaxf(2.0f,rf->shaft_width*fminf(top[3],bottom[3])*fmaxf(sx,sy)*0.35f);
        float alpha=r2d_world_render_shaft_alpha(0.5f,1.0f,rf)*(l->intensity>1.0f?1.0f:l->intensity);
        if(alpha<=0.002f)continue;
        float rot=atan2f(dy,dx);
        float side=length*1.12f;
        float ratio=fminf(1.0f,width_px/side);
        p4_quad_draw(w,g,cmd,pass,(x0+x1)*0.5f,(y0+y1)*0.5f,side,rot+1.5707963f,1,
                     l->r,l->g,l->b,alpha,ratio,0,(d0+d1)*0.5f,R2D_WORLD_ADDITIVE,v->near_plane,&w->render_counters.shafts);
        drawn++;
    }
}
// P0 sprite grounding: screen-space contact/foot-AO card on the floor. Uses the
// same R2DWorldGroundCard as the CPU reference, so CPU/GPU parity holds.
static bool ground_draw(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v,float ortho,int actor)
{
    R2DWorldGroundCard card;
    if(!r2d_world_render_ground_card(w,v,w->width,w->height,ortho,actor,&card))return false;
    int left=(int)fmaxf(0,floorf(card.center_x-card.radius_x-1));
    int top=(int)fmaxf(0,floorf(card.center_y-card.radius_y-1));
    int right=(int)fminf(w->width,ceilf(card.center_x+card.radius_x+1));
    int bottom=(int)fminf(w->height,ceilf(card.center_y+card.radius_y+1));
    if(right<=left||bottom<=top)return false;
    SDL_Rect scissor={left,top,right-left,bottom-top};
    if(!set_scissor(g,pass,scissor))return false;
    SurfaceUniform u={0};
    u.plane[3]=4.0f;
    u.ground[0]=card.center_x;u.ground[1]=card.center_y;
    u.ground[2]=card.radius_x;u.ground[3]=card.radius_y;
    u.ground2[0]=card.opacity;u.ground2[1]=card.softness;
    u.ground2[2]=card.foot_ratio;u.ground2[3]=card.foot_strength;
    u.ground3[0]=card.tint_r;u.ground3[1]=card.tint_g;u.ground3[2]=card.tint_b;u.ground3[3]=1.0f;
    SDL_BindGPUGraphicsPipeline(pass,g->ground);
    SDL_PushGPUFragmentUniformData(cmd,0,&u,sizeof u);
    SDL_DrawGPUPrimitives(pass,3,1,0,0);
    g->draws++;w->gpu_draw_ground++;
    w->render_counters.grounded_actors++;w->render_counters.contact_shadows++;w->render_counters.ground_draws++;
    if(card.foot_ratio>0.0f)w->render_counters.foot_ao++;
    if(w->render_features.local_floor_tint)w->render_counters.floor_tint++;
    if(w->render_features.contact_lighting)w->render_counters.contact_lit++;
    return true;
}
// P2 mirror portal: reflect the camera across the portal plane, render the world
// with disabled depth into a scissored portal window. No offscreen RT is needed.
static bool mirror_draw(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v,float ortho,float ox,float oy)
{
    int portal=-1;R2DWorldWindow window={0};const R2DWorldPortal *p=NULL;R2DWorldOpening opening={0};
    int camera_span=r2d_world_span_at(&w->world,v->x,v->y,v->eye);
    int camera_cell=camera_span>=0?w->world.span_cells[camera_span]:-1;
    for(int i=0;i<w->world.portal_count;i++){
        p=&w->world.portals[i];
        if(!p->mirror||p->closed||p->opening_count<=0)continue;
        if(camera_cell>=0&&p->cell_a!=camera_cell&&p->cell_b!=camera_cell)continue;
        opening=w->world.openings[p->first_opening];
        R2DWorldWindow projected;
        if(!r2d_world_portal_window(v,ortho,p,&opening,&projected))continue;
        if(projected.left>v->width||projected.right<0||projected.top>v->height||projected.bottom<0)continue;
        portal=i;window=projected;break;
    }
    if(portal<0)return false;
    const float dx=p->bx-p->ax,dy=p->by-p->ay,len=sqrtf(dx*dx+dy*dy);
    if(!(len>1e-6f))return false;
    const float ux=dx/len,uy=dy/len;
    const float relx=v->x-p->ax,rely=v->y-p->ay,along=relx*ux+rely*uy;
    const float px=p->ax+ux*along,py=p->ay+uy*along;
    const float rx=2*px-v->x,ry=2*py-v->y;
    const float dot=v->cos_yaw*ux+v->sin_yaw*uy;
    const float rux=2*ux*dot-v->cos_yaw,ruy=2*uy*dot-v->sin_yaw;
    const float yaw=atan2f(ruy,rux);
    R2DRe2dView rv;
    r2d_re2d_view_set(&rv,rx,ry,v->eye,yaw,v->pitch,v->fov,v->width,v->height);
    rv.near_plane=v->near_plane;rv.fog_far=v->fog_far;rv.fog_min=v->fog_min;
    // The reflected camera may need to see through the mirror portal itself,
    // while the main view must not: temporarily clear the flag for this pass.
    w->world.portals[portal].mirror=false;
    bool vis_ok=r2d_world_visibility(&w->world,&rv,ortho,&g->mirror_visibility);
    w->world.portals[portal].mirror=true;
    if(!vis_ok)return false;
    int left=(int)fmaxf(0,floorf(window.left*w->width/v->width)),top=(int)fmaxf(0,floorf(window.top*w->height/v->height));
    int right=(int)fminf(w->width,ceilf(window.right*w->width/v->width)),bottom=(int)fminf(w->height,ceilf(window.bottom*w->height/v->height));
    if(right<=left||bottom<=top)return false;
    SDL_Rect scissor={left,top,right-left,bottom-top};
    R2DWorldVisibility saved=w->visibility;w->visibility=g->mirror_visibility;
    SDL_Rect saved_clip=g->clip;bool saved_active=g->clip_active;g->clip=scissor;g->clip_active=true;
    set_scissor(g,pass,scissor);
    SDL_BindGPUGraphicsPipeline(pass,g->mirror);
    sky_draw(w,g,cmd,pass,&rv,ortho);sky_p4_distant(w,g,cmd,pass,&rv);
    for(int j=0;j<w->visibility.surface_count;j++){int id=w->visibility.surfaces[j];if(r2d_world_surface_blend(&w->world,id)>=R2D_WORLD_TRANSLUCENT)continue;surface_draw(w,g,cmd,pass,&rv,ortho,id,ox,oy);}
    for(int i=0;i<w->frame_count;i++)if(w->frame_images[i]){
        SDL_BindGPUGraphicsPipeline(pass,g->mirror);
        actor_draw(w,g,cmd,pass,&rv,ortho,i,-1,false,ox,oy);
        for(int j=0;j<w->visibility.span_count;j++){int span=w->visibility.spans[j];const R2DWorldSpan *sp=&w->world.spans[span];const float *pos=w->frame_positions+i*5;
            if(pos[0]+pos[3]<sp->x||pos[0]-pos[3]>sp->x+sp->w||pos[1]+pos[3]<sp->y||pos[1]-pos[3]>sp->y+sp->h)continue;actor_draw(w,g,cmd,pass,&rv,ortho,i,span,true,ox,oy);}
    }
    w->visibility=saved;g->clip=saved_clip;g->clip_active=saved_active;
    w->render_counters.reflection_passes++;
    return true;
}


// R-04 distant region impostors: one depth-tested vertical silhouette card per
// visible far region. Data is baked/collected natively; no mesh or per-region JS.
static void region_impostors_draw(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,SDL_GPURenderPass *pass,const R2DRe2dView *v,float ortho)
{
    if(w->render_features.quality<R2D_RENDER_QUALITY_HIGH)return;
    int count=0;const R2DWorldImpostor *cards=r2d_world_visible_impostors(w,&count);
    if(!cards||count<=0)return;
    if(count>64)count=64;
    for(int i=0;i<count;i++){
        const R2DWorldImpostor *c=&cards[i];if(!c->valid||!(c->width>0)||c->top<=c->bottom)continue;
        float pb[4],pt[4],db=0,dt=0;
        if(!vfx_project(v,c->cx,c->cy,c->bottom,ortho,pb,&db))continue;
        if(!vfx_project(v,c->cx,c->cy,c->top,ortho,pt,&dt))continue;
        float side=fabsf(pb[1]-pt[1]);
        if(side<1.5f)side=fmaxf(1.5f,c->width*fminf(pb[3],pt[3]));
        if(side<1.5f)continue;
        float ratio=c->height>1e-3f?fmaxf(0.02f,c->width/c->height):1.0f;
        float r=((c->color>>16)&255)/255.0f,gg=((c->color>>8)&255)/255.0f,b=(c->color&255)/255.0f;
        p4_quad_draw(w,g,cmd,pass,(pb[0]+pt[0])*.5f,(pb[1]+pt[1])*.5f,side,0.0f,3,
                     r,gg,b,0.82f,ratio,0,(db+dt)*.5f,R2D_WORLD_TRANSLUCENT,v->near_plane,&w->render_counters.distant_impostors);
    }
}


// P4 final screen composite. Reads the world colour/owner/depth targets and
// writes a separate post target (no read/write hazard); runs only for the
// FINAL debug view so every debug buffer path keeps reading the raw targets.
static bool post_composite(R2DWorldRuntime *w,WorldGPU *g,SDL_GPUCommandBuffer *cmd,const R2DRe2dView *v,float ortho)
{
    const R2DWorldRenderFeatures *rf=&w->render_features;
    R2DPostUniforms pu;r2d_postprocess_eval(&w->post,&pu);
    R2DWorldPostConfig pc;r2d_world_post_defaults(&pc);
    // The composite is a high/ultra (GPU-reference) feature. Medium and low
    // keep byte-identical CPU/GPU parity, while an explicit world.post bloom
    // request enables it on any tier.
    bool advanced=rf->quality>=R2D_RENDER_QUALITY_HIGH;
    float bloom=advanced&&rf->bloom_lite?0.45f:0.0f;
    if(pu.bloom>0.0f)bloom=fmaxf(bloom,pu.bloom);
    float reflection=advanced&&rf->reflection_lite?0.42f:0.0f;
    float heat=advanced&&rf->heat_distortion?pc.heat_strength:0.0f;
    if(!(bloom>0.0f)&&!(reflection>0.0f)&&!(heat>0.0f))return false;
    SDL_GPUColorTargetInfo colors[2]={{0}};
    colors[0].texture=g->post_color;colors[0].load_op=SDL_GPU_LOADOP_CLEAR;colors[0].store_op=SDL_GPU_STOREOP_STORE;colors[0].clear_color=(SDL_FColor){0,0,0,1};
    colors[1].texture=g->post_owner;colors[1].load_op=SDL_GPU_LOADOP_CLEAR;colors[1].store_op=SDL_GPU_STOREOP_STORE;colors[1].clear_color=(SDL_FColor){0,0,0,0};
    SDL_GPUDepthStencilTargetInfo depth={0};depth.texture=g->post_depth;depth.load_op=SDL_GPU_LOADOP_CLEAR;depth.store_op=SDL_GPU_STOREOP_DONT_CARE;depth.clear_depth=1;
    SDL_GPURenderPass *pass=SDL_BeginGPURenderPass(cmd,colors,2,&depth);if(!pass)return false;
    SDL_BindGPUGraphicsPipeline(pass,g->post);SDL_BindGPUFragmentStorageBuffers(pass,0,&g->shadows,1);
    SurfaceUniform u={0};
    u.screen[0]=(float)w->width;u.screen[1]=(float)w->height;
    u.screen[2]=v->focal*w->height/v->height;u.screen[3]=ortho;
    u.eye[3]=v->near_plane;
    u.plane[0]=v->near_plane;u.plane[1]=w->render_time;u.plane[2]=bloom;u.plane[3]=6.0f;
    u.options[0]=heat;u.options[1]=reflection;u.options[2]=(float)w->world.wall_count;
    u.options[3]=pc.heat_depth_scale;
    u.material[0]=pc.heat_frequency;u.material[1]=pc.heat_speed;
    u.material[2]=pc.heat_depth_start;u.material[3]=0.0f;
    SDL_GPUTextureSamplerBinding tex[3]={{g->color,g->linear},{g->owner,g->sampler},{g->depth,g->linear}};
    SDL_BindGPUFragmentSamplers(pass,0,tex,3);
    for(int i=0;i<3;i++){g->bound_textures[i]=tex[i].texture;g->bound_samplers[i]=tex[i].sampler;}
    SDL_PushGPUFragmentUniformData(cmd,0,&u,sizeof u);
    SDL_DrawGPUPrimitives(pass,3,1,0,0);
    SDL_EndGPURenderPass(pass);
    g->draws++;w->gpu_draw_other++;
    w->render_counters.post_passes+=1;
    if(bloom>0.0f)w->render_counters.post_bloom+=1;
    if(reflection>0.0f)w->render_counters.post_reflection+=1;
    if(heat>0.0f)w->render_counters.post_heat+=1;
    return true;
}

bool r2d_world_gpu_frame(JSContext *ctx,R2DWorldRuntime *w,const R2DRe2dView *v,float ortho)
{
    if(!init(w))return false;WorldGPU *g=w->gpu;SDL_GPUDevice *d=w->renderer->device;
    gpu_stream_sync(w,g);
    ensure_wall_spans(w,g);
    ambient_build(w,g);
    // Region-local render space: shift camera and every world-space uniform by
    // the current region centre. Gameplay/visibility stay in world coordinates.
    float ox=0,oy=0;bool origin_active=w->region_ready&&isfinite(w->render_origin_x)&&isfinite(w->render_origin_y);
    if(origin_active){ox=w->render_origin_x;oy=w->render_origin_y;}
    w->gpu_render_origin_active=origin_active;
    w->gpu_render_origin_x=ox;w->gpu_render_origin_y=oy;
    SDL_GPUCommandBuffer *cmd=SDL_AcquireGPUCommandBuffer(d);if(!cmd)return false;
    Uint64 shadow_start=SDL_GetTicksNS();
    if(!shadows_upload(w,g,cmd,ox,oy)){SDL_CancelGPUCommandBuffer(cmd);return false;}
    w->shadow_ms=(SDL_GetTicksNS()-shadow_start)/1e6;
    if(!actors_upload(ctx,w,g,cmd)){SDL_CancelGPUCommandBuffer(cmd);return false;}
    // P4 static batching: collect the opaque/base draw list before the render
    // pass so the instance SSBO can be uploaded, then draw one fullscreen
    // triangle per (material, blend, light policy, atlas) group. Overdraw and
    // non-final debug views keep the per-surface fallback unchanged.
    bool batch_frame=w->batch_gpu&&g->batch_available&&w->debug_view==R2D_WORLD_DEBUG_FINAL;
    if(batch_frame){
        batch_begin(g);
        for(int j=0;j<w->visibility.surface_count;j++){
            int id=w->visibility.surfaces[j];
            if(r2d_world_surface_blend(&w->world,id)>=R2D_WORLD_TRANSLUCENT)continue;
            batch_surface(w,g,v,ortho,id,ox,oy);
        }
        if(!batch_upload(w,g,cmd))batch_frame=false;
    }
    SDL_GPUColorTargetInfo colors[2]={{0}};colors[0].texture=g->color;colors[0].load_op=SDL_GPU_LOADOP_CLEAR;colors[0].store_op=SDL_GPU_STOREOP_STORE;
    colors[0].clear_color=w->debug_view==R2D_WORLD_DEBUG_OVERDRAW?(SDL_FColor){0,0,0,1}:(SDL_FColor){16/255.0f,24/255.0f,32/255.0f,1};colors[1].texture=g->owner;colors[1].load_op=SDL_GPU_LOADOP_CLEAR;colors[1].store_op=SDL_GPU_STOREOP_STORE;colors[1].clear_color=(SDL_FColor){FLT_MAX,-1,-1,-1};
    SDL_GPUDepthStencilTargetInfo depth={0};depth.texture=g->depth;depth.load_op=SDL_GPU_LOADOP_CLEAR;depth.store_op=SDL_GPU_STOREOP_DONT_CARE;depth.clear_depth=1;
    SDL_GPURenderPass *pass=SDL_BeginGPURenderPass(cmd,colors,2,&depth);if(!pass){SDL_CancelGPUCommandBuffer(cmd);return false;}
    SDL_BindGPUGraphicsPipeline(pass,w->debug_view==R2D_WORLD_DEBUG_OVERDRAW?g->overdraw:g->pipeline);SDL_BindGPUFragmentStorageBuffers(pass,0,&g->shadows,1);g->draws=0;w->gpu_draw_base=w->gpu_draw_span=w->gpu_draw_actor=w->gpu_draw_other=0;w->gpu_draw_ground=0;w->gpu_draw_vfx=0;w->gpu_material_batches=0;w->gpu_batch_draws=w->gpu_batch_instances=w->gpu_batch_saved=w->gpu_batch_logical=0;memset(g->bound_textures,0,sizeof g->bound_textures);
    if(w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW&&(w->world.sky.pixels||w->world.sky_color))sky_draw(w,g,cmd,pass,v,ortho);
    if(w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW)sky_p4_distant(w,g,cmd,pass,v);
    if(batch_frame){
        batch_draw(w,g,pass);
        SDL_BindGPUGraphicsPipeline(pass,w->debug_view==R2D_WORLD_DEBUG_OVERDRAW?g->overdraw:g->pipeline);
    }else{
        for(int j=0;j<w->visibility.surface_count;j++){int id=w->visibility.surfaces[j];if(r2d_world_surface_blend(&w->world,id)>=R2D_WORLD_TRANSLUCENT&&w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW)continue;surface_draw(w,g,cmd,pass,v,ortho,id,ox,oy);}
    }
    if(w->render_features.grounding&&w->render_features.contact_shadow&&w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW){
        int budget=w->render_features.quality<=R2D_RENDER_QUALITY_LOW?128:512,drawn=0;
        for(int i=0;i<w->frame_count&&drawn<budget;i++)if(w->frame_images[i]&&ground_draw(w,g,cmd,pass,v,ortho,i))drawn++;
    }
    if(w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW)mirror_draw(w,g,cmd,pass,v,ortho,ox,oy);
    SDL_BindGPUGraphicsPipeline(pass,w->debug_view==R2D_WORLD_DEBUG_OVERDRAW?g->overdraw:g->pipeline);
    SDL_Rect full={0,0,w->width,w->height};SDL_SetGPUScissor(pass,&full);
    for(int i=0;i<w->frame_count;i++)if(w->frame_images[i]){
        int blend=(w->frame_kinds[i]==R2D_WORLD_FRAME_ATLAS||w->frame_kinds[i]==R2D_WORLD_FRAME_PARTICLE)?w->frame_blends[i]:0;
        SDL_GPUGraphicsPipeline *actor_pipeline=w->debug_view==R2D_WORLD_DEBUG_OVERDRAW?g->overdraw:blend==R2D_WORLD_ADDITIVE?g->additive:blend>=R2D_WORLD_TRANSLUCENT?g->translucent:g->pipeline;
        SDL_BindGPUGraphicsPipeline(pass,actor_pipeline);
        actor_draw(w,g,cmd,pass,v,ortho,i,-1,false,ox,oy);
        for(int j=0;j<w->visibility.span_count;j++){int span=w->visibility.spans[j];const R2DWorldSpan *s=&w->world.spans[span];const float *p=w->frame_positions+i*5;
            if(p[0]+p[3]<s->x||p[0]-p[3]>s->x+s->w||p[1]+p[3]<s->y||p[1]-p[3]>s->y+s->h)continue;actor_draw(w,g,cmd,pass,v,ortho,i,span,true,ox,oy);}
        if(actor_pipeline!=g->pipeline&&w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW)SDL_BindGPUGraphicsPipeline(pass,g->pipeline);}
    for(int i=0;i<R2D_WORLD_MAX_DECALS;i++)if(w->world.decals[i].active){
        const R2DWorldDecal *decal=&w->world.decals[i];w->render_counters.decals++;int id=decal->surface;if(!w->visibility.surface_seen[id]||(w->world.surface_sky&&w->world.surface_sky[id]))continue;
        // R-04 decal region pool: skip decals whose owning cell was rejected by
        // the hierarchical PVS, then apply the distance LOD percentage.
        const R2DWorldSurface *dsurface=&w->world.surfaces[id];
        if(w->region_ready&&w->cell_allowed&&dsurface->span>=0&&w->world.span_cells){
            const int dcell=w->world.span_cells[dsurface->span];
            if(dcell<0||dcell>=w->world.cell_count||!w->cell_allowed[dcell]){w->gpu_lod_culled_decals++;continue;}
        }
        if(dsurface->span>=0&&w->render_features.quality>=R2D_RENDER_QUALITY_HIGH){
            const R2DWorldSpan *dspan=&w->world.spans[dsurface->span];
            R2DWorldRegionLod dlod;r2d_world_region_lod_eval(hypotf(dspan->x-v->x,dspan->y-v->y),&w->lod_config,&dlod);
            if(dlod.decal_percent<100&&(i%100)>=dlod.decal_percent){w->gpu_lod_culled_decals++;continue;}
        }
        SDL_Rect scissor;if(!surface_bounds(w,v,ortho,id,&scissor))continue;if(!set_scissor(g,pass,scissor))continue;
        w->gpu_draw_other++;
        SDL_BindGPUGraphicsPipeline(pass,w->debug_view==R2D_WORLD_DEBUG_OVERDRAW?g->overdraw:w->world.materials[decal->material].blend==R2D_WORLD_ADDITIVE?g->additive:g->translucent);
        const R2DWorldSurface *surface=&w->world.surfaces[id];
        if(surface->kind!=R2D_WORLD_WALL)draw(w,g,cmd,pass,v,ortho,id,surface->span,false,decal,ox,oy);
        else for(int j=0;j<w->visibility.span_count;j++){int span=w->visibility.spans[j];bool incident=false;for(int k=w->world.span_wall_offsets[span];k<w->world.span_wall_offsets[span+1];k++)if(w->world.span_wall_refs[k]==surface->primitive){incident=true;break;}if(incident)draw(w,g,cmd,pass,v,ortho,id,span,true,decal,ox,oy);}
    }
    if(w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW&&w->world.material_count){
        int count=r2d_world_transparent_order(&w->world,v,&w->visibility,NULL);int *ids=w->world.transparent_ids;
        if(count<0){SDL_EndGPURenderPass(pass);SDL_CancelGPUCommandBuffer(cmd);return false;}
        for(int i=0;i<count;i++){SDL_BindGPUGraphicsPipeline(pass,r2d_world_surface_blend(&w->world,ids[i])==R2D_WORLD_ADDITIVE?g->additive:g->translucent);surface_draw(w,g,cmd,pass,v,ortho,ids[i],ox,oy);}
    }
    if(w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW){region_impostors_draw(w,g,cmd,pass,v,ortho);w->gpu_impostors_drawn=w->render_counters.distant_impostors;}
    // R-03 VFX pass: procedural world cards, card trails and distortion cards.
    if(w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW&&w->vfx)vfx_draw_all(w,g,cmd,pass,v,ortho);
    if(w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW){sky_p4_shafts(w,g,cmd,pass,v,ortho);sky_p4_weather(w,g,cmd,pass,v);}
    size_t pixel_count=(size_t)w->width*w->height;
    w->gpu_texture_bytes=pixel_count*28+8; // MRT/depth + public RGBA output + two fallback texels.
    w->gpu_transfer_bytes=((pixel_count*4+511)&~(size_t)511)+pixel_count*16+g->shadow_buffer_capacity;
    if(g->sky_texture>=0)w->gpu_texture_bytes+=(size_t)w->world.sky.width*w->world.sky.height*4;
    w->gpu_texture_bytes+=pixel_count*8; // post colour + post owner/depth targets.
    for(int i=0;i<64;i++){const R2DWorldMaterial *m=&w->world.materials[i];const R2DWorldTexture *t[3]={&m->albedo,&m->normal,&m->emissive};for(int j=0;j<3;j++)if(g->textures[i][j]>=0)w->gpu_texture_bytes+=(size_t)t[j]->width*t[j]->height*4;}
    for(int i=0;i<g->actor_capacity;i++)if(g->actors[i].color)w->gpu_texture_bytes+=(size_t)g->actors[i].size*g->actors[i].size*8;
    SDL_EndGPURenderPass(pass);
    bool composited=(w->debug_view==R2D_WORLD_DEBUG_FINAL)&&post_composite(w,g,cmd,v,ortho);
    SDL_GPUCopyPass *copy=SDL_BeginGPUCopyPass(cmd);int n=w->width*w->height,offset=(n*4+511)&~511;
    if(w->debug_view==R2D_WORLD_DEBUG_FINAL){SDL_GPUTextureLocation src={0},dst={0};src.texture=composited?g->post_color:g->color;dst.texture=r2d_texture_handle(w->renderer,w->texture);
        SDL_CopyGPUTextureToTexture(copy,&src,&dst,w->width,w->height,1,true);SDL_EndGPUCopyPass(copy);w->gpu_draws=g->draws;
        return submit_frame(w,cmd,w->gpu_wait);}
    for(int i=0;i<2;i++){SDL_GPUTextureRegion src={0};src.texture=i?g->owner:g->color;src.w=w->width;src.h=w->height;src.d=1;
        SDL_GPUTextureTransferInfo dst={0};dst.transfer_buffer=g->download;dst.offset=i?offset:0;dst.pixels_per_row=w->width;dst.rows_per_layer=w->height;SDL_DownloadFromGPUTexture(copy,&src,&dst);}
    SDL_EndGPUCopyPass(copy);if(!submit_frame(w,cmd,true))return false;
    uint8_t *pixels=SDL_MapGPUTransferBuffer(d,g->download,false);if(!pixels)return false;memcpy(w->rgba,pixels,(size_t)n*4);float *owners=(float *)(pixels+offset);
    for(int i=0;i<n;i++){w->depth[i]=owners[i*4];w->owners[i]=(R2DWorldPixelOwner){(int)owners[i*4+1],(int)owners[i*4+2],(int)owners[i*4+3]};}
    SDL_UnmapGPUTransferBuffer(d,g->download);w->gpu_draws=g->draws;return true;
}
