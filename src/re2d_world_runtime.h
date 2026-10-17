#pragma once
#include "re2d_world.h"
#include "re2d_world_trace.h"
#include "render.h"
#include "audio.h"
#include <quickjs.h>
// Runtime owns native actor registration and final-frame resources. Bindings only configure/call.
#define R2D_WORLD_ATLAS_ACTOR_LIMIT 1024
// One flat directional atlas sprite registered from an existing `$` node. The
// atlas image and the cropped square frame live here; world depth/light/fog and
// direction selection are native, so game scripts do not project per frame.
typedef struct R2DWorldAtlasActor {
    JSValue node;
    uint8_t *atlas;
    int atlas_w,atlas_h;
    int columns,rows,directions,cell_w,cell_h,pivot_mode,blend;
    bool mirror;
    float pivot_x,pivot_y,width,height;
    uint8_t *frame;
    int frame_side;
    int last_column,last_row,last_flip,frame_revision;
} R2DWorldAtlasActor;
// Frame entry kinds. RotSprite entries use native synthesis; atlas entries reuse
// an already cropped square image and do not touch the Re2DSprite runtime.
enum { R2D_WORLD_FRAME_ROTSPRITE = 0, R2D_WORLD_FRAME_ATLAS = 1 };
#define R2D_WORLD_HIT_PROXY_LIMIT 2048
// World hit proxy lifecycle follows node add/remove: the registry owns a JS
// reference, not node lifetime. bottom/top are offsets from node.depth so a
// moving actor needs no per-move native update; coordinates are read at trace
// time, not every frame.
typedef struct R2DWorldHitEntry {
    JSValue node;
    float radius,bottom_offset,top_offset;
    int category;
} R2DWorldHitEntry;
typedef struct R2DWorldAudioSource {
    bool active,hrtf,occluded;
    unsigned generation;
    float x,y,h,range,reference,volume,distance,gain,current_gain,cutoff;
} R2DWorldAudioSource;
typedef struct R2DWorldRuntime {
    R2DAudio *audio;
    R2DWorldAudioSource sources[R2D_AUDIO_CHANNELS];
    R2DRe2dWorld world;
    R2DWorldVisibility visibility;
    R2DRenderer *renderer;
    JSRuntime *runtime;
    R2DRe2dView view;
    float ortho;
    uint8_t *rgba;
    float *depth;
    R2DWorldPixelOwner *owners;
    int debug_view,visible_lights,shadowed_lights,visible_actor_count;
    double frame_ms,visibility_ms,light_cull_ms,surface_ms,actor_ms,composition_ms,upload_ms;
    int width,height,texture,sprite;
    bool disposed,rendering;
    JSValue *actors,*frame_handles;
    float *frame_positions;
    const uint8_t **frame_images;
    int *frame_sizes;
    int *frame_kinds,*frame_revisions,*frame_blends;
    uint64_t *frame_keys;
    R2DWorldAtlasActor *atlas_actors;
    int atlas_count,atlas_capacity,visible_atlas_count;
    R2DWorldHitEntry *hit_entries;
    int hit_count,hit_capacity;
    R2DWorldHitProxy *trace_scratch;
    int trace_scratch_capacity;
    int actor_count,actor_capacity,frame_count;
    struct R2DWorldRuntime *next;
    bool registered;
    void *gpu;
    bool gpu_enabled;
    int gpu_draws,gpu_shadow_updates,gpu_material_batches;
    double shadow_ms,gpu_submit_ms,gpu_completion_ms;
    size_t gpu_texture_bytes,gpu_transfer_bytes;
    bool gpu_wait;
    int pose_budget,pose_cursor,poses_updated,poses_deferred;
    float pose_step;
    char *watch_path;
    SDL_Time watch_mtime;
    Uint64 watch_size;
    float watch_elapsed;
    unsigned reload_count;
    char reload_error[256];
} R2DWorldRuntime;
bool r2d_world_actor_register(JSContext *,R2DWorldRuntime *,JSValueConst);
bool r2d_world_actor_unregister(JSContext *,R2DWorldRuntime *,JSValueConst);
// Flat directional atlas sprite mode for an existing node. Not a mesh, not an
// entity: only an atlas PNG + direction/pivot policy attached to the node.
bool r2d_world_atlas_register(JSContext *,R2DWorldRuntime *,JSValueConst,const char *,
    int columns,int rows,int directions,bool mirror,int cell_w,int cell_h,
    int pivot,float pivot_x,float pivot_y,float width,float height,int blend);
bool r2d_world_atlas_unregister(JSContext *,R2DWorldRuntime *,JSValueConst);
// Actor hit proxies for unified world+actor trace (P0-B). Not a physics body.
bool r2d_world_hit_register(JSContext *,R2DWorldRuntime *,JSValueConst,float radius,float bottom,float top,int category);
bool r2d_world_hit_unregister(JSContext *,R2DWorldRuntime *,JSValueConst);
// 1 = hit, 0 = nothing, -1 = invalid input/exception.
int r2d_world_trace_query(JSContext *,R2DWorldRuntime *,const float from[3],const float to[3],int mask,int ignore_node,R2DWorldTraceResult *);
int r2d_world_trace_query_all(JSContext *,R2DWorldRuntime *,const float from[3],const float to[3],int mask,int ignore_node,R2DWorldTraceResult *out,int capacity);
void r2d_world_runtime_actors_free(R2DWorldRuntime *);
// Returns ordinary 2D sprite id; errors set QuickJS exception, no script renderer loops.
int r2d_world_runtime_frame(JSContext *,R2DWorldRuntime *,const R2DRe2dView *,int,int,float);
bool r2d_world_runtime_material(JSContext *,R2DWorldRuntime *,const char *,const char *,const char *,const char *,float,float,float,int,float,bool,bool);
bool r2d_world_runtime_sky(JSContext *,R2DWorldRuntime *,const char *,uint32_t,float,float);

void r2d_world_audio_step(R2DWorldRuntime *,const R2DRe2dView *);
void r2d_world_audio_free(R2DWorldRuntime *);
