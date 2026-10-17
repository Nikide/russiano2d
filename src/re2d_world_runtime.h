#pragma once
#include "re2d_world.h"
#include "re2d_world_trace.h"
#include "re2d_world_mover.h"
#include "re2d_world_trigger.h"
#include "re2d_world_controller.h"
#include "re2d_world_nav.h"
#include "re2d_world_automap.h"
#include "re2d_world_particle.h"
#include "re2d_world_secret.h"
#include "re2d_world_terrain.h"
#include "re2d_world_save.h"
#include "re2d_world_material_anim.h"
#include "re2d_postprocess.h"
#include "re2d_audio_zone.h"
#include "re2d_audio_voices.h"
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
    // Constrained volume part offset in the actor's local XY/height frame.
    float offset_x,offset_y,offset_h;
    uint8_t *frame;
    int frame_side;
    int last_column,last_row,last_flip,frame_revision;
} R2DWorldAtlasActor;
// Frame entry kinds. RotSprite entries use native synthesis; atlas entries reuse
// an already cropped square image and do not touch the Re2DSprite runtime.
enum { R2D_WORLD_FRAME_ROTSPRITE = 0, R2D_WORLD_FRAME_ATLAS = 1, R2D_WORLD_FRAME_PARTICLE = 2 };
#define R2D_WORLD_HIT_PROXY_LIMIT 2048
// World hit proxy lifecycle follows node add/remove: the registry owns a JS
// reference, not node lifetime. bottom/top are offsets from node.depth so a
// moving actor needs no per-move native update; coordinates are read at trace
// time, not every frame.
#define R2D_WORLD_HIT_ZONES 4
typedef struct { float from,to,multiplier; } R2DWorldHitZone;
typedef struct R2DWorldHitEntry {
    JSValue node;
    float radius,bottom_offset,top_offset;
    int category;
    // P3 multi-zone boss hit proxy: normalized height bands inside the cylinder.
    R2DWorldHitZone zones[R2D_WORLD_HIT_ZONES];
    int zone_count;
} R2DWorldHitEntry;
#define R2D_WORLD_MOVER_LIMIT 128
#define R2D_WORLD_TRIGGER_LIMIT 256
#define R2D_WORLD_SECRET_LIMIT 256
typedef struct R2DWorldMoverEntry {
    R2DWorldMover mover;
    int token,span,portal,kind;
    float span_top;
    unsigned generation,events;
    bool active;
} R2DWorldMoverEntry;
typedef struct R2DWorldTriggerEntry {
    R2DWorldTrigger trigger;
    char *id,*target;
    int token;
    unsigned generation,events;
    bool active;
} R2DWorldTriggerEntry;
#define R2D_WORLD_CONTROLLER_LIMIT 64
typedef struct { R2DWorldControllerConfig config; int token; bool active; } R2DWorldControllerEntry;
typedef struct R2DWorldAudioSource {
    bool active,hrtf,occluded,virtualized;
    unsigned generation;
    float x,y,h,range,reference,volume,distance,gain,current_gain,cutoff;
    int priority;
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
    double trace_ms,controller_ms,nav_ms;
    int trace_calls,controller_calls,nav_queries;
    int audio_active,audio_virtual;
    int width,height,texture,sprite;
    bool disposed,rendering;
    JSValue *actors,*frame_handles;
    float *frame_positions;
    const uint8_t **frame_images;
    int *frame_sizes;
    int *frame_kinds,*frame_revisions,*frame_blends;
    float *frame_tints;
    uint64_t *frame_keys;
    R2DWorldAtlasActor *atlas_actors;
    int atlas_count,atlas_capacity,visible_atlas_count;
    R2DWorldHitEntry *hit_entries;
    int hit_count,hit_capacity;
    R2DWorldHitProxy *trace_scratch;
    int trace_scratch_capacity;
    R2DWorldMoverEntry *movers;
    int mover_count,mover_capacity,next_mover_token;
    R2DWorldTriggerEntry *triggers;
    int trigger_count,trigger_capacity,next_trigger_token;
    R2DWorldControllerEntry controllers[R2D_WORLD_CONTROLLER_LIMIT];
    int next_controller_token;
    // P1 nav graph: built on demand, arrays owned by the runtime.
    R2DWorldNavNode *nav_nodes;
    R2DWorldNavEdge *nav_edges;
    int *nav_offsets;
    R2DWorldNavGraph nav_graph;
    uint8_t *nav_blocked_spans;
    uint8_t *nav_blocked_portals;
    R2DWorldNavScratch nav_scratch;
    float *nav_g;
    int *nav_parent,*nav_heap,*nav_heap_pos;
    uint8_t *nav_state;
    bool nav_ready;
    float nav_radius,nav_height,nav_step;
    // P1 particles: fixed native pool, step and draw (no JS pool).
    R2DWorldParticle *particle_storage;
    R2DWorldParticlePool particles;
    bool particle_ready;
    float particle_accumulator;
    int particles_drawn;
    int particle_budget;
    // Per-frame draw attribution for profiler/benchmarks.
    int gpu_draw_base,gpu_draw_span,gpu_draw_actor,gpu_draw_other;
    // P2 final-frame postprocess stack (descriptors; JS maps to the render pass).
    R2DPostStack post;
    bool post_ready;
    // P2 sky 2.0 animation: panorama yaw + tint/lightning pulse.
    float sky_yaw_speed,sky_pulse_hz,sky_pulse_amount,sky_phase;
    uint32_t sky_tint;
    bool sky_anim_active;
    // P1 secrets/breakables: authored semantic state, no entity system.
    R2DWorldSecret *secrets;
    int *secret_tokens;
    int secret_count,secret_capacity,next_secret_token;
    R2DWorldBreakable *breakables;
    int *breakable_tokens;
    int breakable_count,breakable_capacity,next_breakable_token;
    // P1 terrain/conveyors: per-surface authored gameplay metadata.
    int *surface_terrain;
    R2DWorldConveyor *surface_conveyors;
    int terrain_capacity;
    // P1 audio zones: authored reverb preset per span; sources pick it up.
    int *span_audio_zone;
    bool *span_audio_zone_set;
    int audio_zone_capacity;
    int channel_zone[R2D_AUDIO_CHANNELS];
    int audio_voice_budget;
    R2DAudioVoices voice_policy;
    // P3 rotating polywall groups: authored walls rotated in place around an XY
    // pivot. Coords live in world.walls, so trace/blocked/render see them; BSP
    // cell refs stay valid while walls remain inside their span footprint.
    struct R2DWorldPolywallGroup *polywalls;
    int polywall_count, polywall_capacity;
    // P2 material animation: per material slot, stepped with worldStep.
    R2DWorldMaterialAnim material_anims[R2D_WORLD_MAX_MATERIALS];
    bool material_anim_active[R2D_WORLD_MAX_MATERIALS];
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
    int pivot,float pivot_x,float pivot_y,float width,float height,int blend,
    float offset_x,float offset_y,float offset_h);
bool r2d_world_atlas_unregister(JSContext *,R2DWorldRuntime *,JSValueConst);
// Actor hit proxies for unified world+actor trace (P0-B). Not a physics body.
bool r2d_world_hit_register(JSContext *,R2DWorldRuntime *,JSValueConst,float radius,float bottom,float top,int category);
bool r2d_world_hit_unregister(JSContext *,R2DWorldRuntime *,JSValueConst);
bool r2d_world_hit_zones(R2DWorldRuntime *,JSValueConst,const R2DWorldHitZone *,int);
void r2d_world_hit_zone_info(const R2DWorldHitEntry *,float h,int *zone,float *multiplier);
// 1 = hit, 0 = nothing, -1 = invalid input/exception.
int r2d_world_trace_query(JSContext *,R2DWorldRuntime *,const float from[3],const float to[3],int mask,int ignore_node,R2DWorldTraceResult *);
int r2d_world_trace_query_all(JSContext *,R2DWorldRuntime *,const float from[3],const float to[3],int mask,int ignore_node,R2DWorldTraceResult *out,int capacity);
// P0-E: native mover timeline applied to span heights / portal open state.
int r2d_world_mover_create(R2DWorldRuntime *,int type,int span,int portal,float from,float to,float speed,float wait,bool auto_return);
bool r2d_world_mover_remove(R2DWorldRuntime *,int token);
void r2d_world_mover_intent(R2DWorldRuntime *,int token,int action);
// Passenger/crusher contact flag: freezes travel, CRUSHER reverses, emits BLOCKED.
bool r2d_world_mover_block(R2DWorldRuntime *,int token,bool blocking);
bool r2d_world_mover_info(R2DWorldRuntime *,int token,float out[6],unsigned *events);
void r2d_world_mover_advance(R2DWorldRuntime *,float dt);
void r2d_world_mover_free(R2DWorldRuntime *);
// P0-F: semantic trigger state machine (enter/use/shoot).
int r2d_world_trigger_create(R2DWorldRuntime *,int type,const char *id,const char *target,float x,float y,float radius,float bottom,float top,bool once,float cooldown);
bool r2d_world_trigger_remove(R2DWorldRuntime *,int token);
void r2d_world_trigger_advance(R2DWorldRuntime *,float dt);
int r2d_world_trigger_tick(R2DWorldRuntime *,float px,float py,float feet,int *tokens,int capacity);
int r2d_world_trigger_use_at(R2DWorldRuntime *,float x,float y,float h,int *tokens,int capacity);
int r2d_world_trigger_shoot_at(R2DWorldRuntime *,float x,float y,float h,float radius,int *tokens,int capacity);
void r2d_world_trigger_free(R2DWorldRuntime *);
// P0-C: native player controller config registry; state stays caller-owned.
int r2d_world_controller_create(R2DWorldRuntime *,const R2DWorldControllerConfig *);
bool r2d_world_controller_remove(R2DWorldRuntime *,int token);
bool r2d_world_controller_place(R2DWorldRuntime *,int token,float x,float y,float feet,R2DWorldControllerState *out);
bool r2d_world_controller_step_state(R2DWorldRuntime *,int token,R2DWorldControllerState *,float wish_x,float wish_y,bool jump,float dt);
// P1 nav graph over spans/portals. Returns {nodes,edges} via out counts.
bool r2d_world_nav_build_runtime(R2DWorldRuntime *,float radius,float height,float step,int *nodes,int *edges);
int r2d_world_nav_nearest_runtime(R2DWorldRuntime *,float x,float y);
int r2d_world_nav_path_runtime(R2DWorldRuntime *,int from,int to,int *path,int capacity,int max_visits);
int r2d_world_nav_path_mask(R2DWorldRuntime *,int from,int to,int *path,int capacity,int max_visits,const int *blocked_spans,int span_count,const int *blocked_portals,int portal_count);
void r2d_world_nav_free(R2DWorldRuntime *);
// P1 particles: pool bound lazily (capacity 2048), stepped with worldStep,
// drawn by the native compositor. Renderer hints only; no JS pool.
bool r2d_world_particles_ready(R2DWorldRuntime *);
void r2d_world_particles_budget(R2DWorldRuntime *,int budget);
// P4 aim assist: nearest registered hit proxy inside a cone/range.
typedef struct { float x,y,z; int node; float angle; } R2DWorldAimAssist;
bool r2d_world_aim_assist(JSContext *,R2DWorldRuntime *,const float from[3],const float dir[3],float cone_rad,float range,int mask,R2DWorldAimAssist *out);
int r2d_world_particles_burst(R2DWorldRuntime *,const R2DWorldParticle *,int count,float spread,float speed,float dx,float dy,float dh);
int r2d_world_particles_continuous(R2DWorldRuntime *,const R2DWorldParticle *,float rate,float dt);
void r2d_world_particles_step(R2DWorldRuntime *,float dt);
void r2d_world_particles_free(R2DWorldRuntime *);
// P1 secrets/breakables.
int r2d_world_secret_create(R2DWorldRuntime *,const char *id,float x,float y,float radius,float bottom,float top,bool once);
bool r2d_world_secret_remove(R2DWorldRuntime *,int token);
bool r2d_world_secret_info(R2DWorldRuntime *,int token,int *found,int *count);
int r2d_world_secret_tick(R2DWorldRuntime *,float dt,float x,float y,float feet,int *tokens,int capacity);
int r2d_world_breakable_create(R2DWorldRuntime *,const char *id,int hp,int variant,int portal,float x,float y,float radius,float bottom,float top);
bool r2d_world_breakable_remove(R2DWorldRuntime *,int token);
int r2d_world_breakable_damage(R2DWorldRuntime *,int token,int damage);
bool r2d_world_breakable_info(R2DWorldRuntime *,int token,int *hp,int *variant,int *portal,int *broken);
bool r2d_world_secret_restore(R2DWorldRuntime *,int token,int found,int found_count);
bool r2d_world_breakable_restore(R2DWorldRuntime *,int token,int hp,int broken);
void r2d_world_secret_free(R2DWorldRuntime *);
// P1 terrain/conveyors per surface.
bool r2d_world_set_surface_terrain(R2DWorldRuntime *,int surface,int kind);
int r2d_world_surface_terrain_kind(R2DWorldRuntime *,int surface);
bool r2d_world_set_surface_conveyor(R2DWorldRuntime *,int surface,float vx,float vy,float accel,bool affects_projectiles);
bool r2d_world_surface_conveyor_info(R2DWorldRuntime *,int surface,float out[3],int *affects);
// Resolve the floor surface owning (x,y,h) and read its metadata.
bool r2d_world_terrain_at(R2DWorldRuntime *,float x,float y,float h,int *kind,int *surface);
bool r2d_world_conveyor_at(R2DWorldRuntime *,float x,float y,float h,float out[3],int *affects);
void r2d_world_terrain_free(R2DWorldRuntime *);
// P1 audio zones per span (reverb presets; source channels inherit the span zone).
bool r2d_world_set_span_audio_zone(R2DWorldRuntime *,int span,const char *name);
bool r2d_world_span_audio_zone(R2DWorldRuntime *,int span,int *preset,const char **name);
bool r2d_world_audio_zone_at(R2DWorldRuntime *,float x,float y,float h,int *preset,const char **name,int *span);
void r2d_world_audio_zone_free(R2DWorldRuntime *);
// P1 audio voice virtualization runtime: cap real voices, keep virtual ones for
// promotion. Returns effective budget (1..R2D_AUDIO_VOICES_MAX).
int r2d_world_audio_budget(R2DWorldRuntime *,int budget);
// P3 rotating polywall groups.
int r2d_world_polywall_add(R2DWorldRuntime *,const int *walls,int wall_count,float pivot_x,float pivot_y,float angle,float speed);
bool r2d_world_polywall_info(R2DWorldRuntime *,int token,float *angle,float *speed,int *walls);
bool r2d_world_polywall_remove(R2DWorldRuntime *,int token);
bool r2d_world_polywall_set_speed(R2DWorldRuntime *,int token,float speed);
bool r2d_world_polywall_speed(R2DWorldRuntime *,int token,float *speed);
void r2d_world_polywall_advance(R2DWorldRuntime *,float dt);
void r2d_world_polywall_free(R2DWorldRuntime *);
// P1 save/load snapshot of native gameplay state (spans/portals/movers/triggers).
bool r2d_world_state_capture(R2DWorldRuntime *,R2DWorldSaveState *out);
bool r2d_world_state_apply(R2DWorldRuntime *,const R2DWorldSaveState *in);
uint64_t r2d_world_save_map_hash_runtime(R2DWorldRuntime *);
// P2 material animation on an existing material slot.
bool r2d_world_material_anim_set(R2DWorldRuntime *,int material,int frames,float fps,bool ping_pong,uint32_t seed,float scroll_u,float scroll_v,float pulse_hz,float pulse_amount);
bool r2d_world_material_anim_info(R2DWorldRuntime *,int material,int *frame,float *emissive,float *u_offset,float *v_offset);
bool r2d_world_material_anim_clear(R2DWorldRuntime *,int material);
// P2 postprocess stack.
bool r2d_world_post_set(R2DWorldRuntime *,int effect,float strength,float r,float g,float b,float a,float extra0,float extra1);
bool r2d_world_post_enable(R2DWorldRuntime *,int effect,bool enabled);
bool r2d_world_post_profile(R2DWorldRuntime *,const char *name);
bool r2d_world_post_eval(R2DWorldRuntime *,R2DPostUniforms *out);
void r2d_world_post_reset(R2DWorldRuntime *);
void r2d_world_post_step_all(R2DWorldRuntime *,float dt);
// P2 sky animation (panorama yaw + deterministic pulse).
bool r2d_world_sky_anim(R2DWorldRuntime *,float yaw_speed,float pulse_hz,float pulse_amount,uint32_t tint);
void r2d_world_sky_anim_info(R2DWorldRuntime *,float out[4]);
void r2d_world_sky_anim_advance(R2DWorldRuntime *,float dt);
void r2d_world_material_anim_advance(R2DWorldRuntime *,float dt);
void r2d_world_runtime_actors_free(R2DWorldRuntime *);
// Returns ordinary 2D sprite id; errors set QuickJS exception, no script renderer loops.
int r2d_world_runtime_frame(JSContext *,R2DWorldRuntime *,const R2DRe2dView *,int,int,float);
bool r2d_world_runtime_material(JSContext *,R2DWorldRuntime *,const char *,const char *,const char *,const char *,float,float,float,int,float,bool,bool);
bool r2d_world_runtime_sky(JSContext *,R2DWorldRuntime *,const char *,uint32_t,float,float);

void r2d_world_audio_step(R2DWorldRuntime *,const R2DRe2dView *);
void r2d_world_audio_free(R2DWorldRuntime *);
