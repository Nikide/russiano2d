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
#include "re2d_world_render_features.h"
#include "re2d_world_batch.h"
#include "re2d_world_sky.h"
#include "re2d_world_region.h"
#include "re2d_world_atlas.h"
#include "re2d_world_atlas_prefetch.h"
#include "re2d_world_stream.h"
#include "re2d_world_stream_io.h"
#include "re2d_world_impostor.h"
#include "re2d_postprocess.h"
#include "re2d_audio_zone.h"
#include "re2d_audio_voices.h"
#include "render.h"
#include "audio.h"
#include <quickjs.h>
struct R2DWorldVfx;
// Runtime owns native actor registration and final-frame resources. Bindings only configure/call.
// Initial atlas registry bucket. This is NOT a hard cap: the registry doubles
// with checked overflow-safe growth as memory allows (see atlas_commit and the
// actor registry below). Kept named so preallocation/diagnostics have a stable
// starting size.
#define R2D_WORLD_ATLAS_ACTOR_INITIAL 64
// Bounded native warning ring for visible atlases that are not resident yet.
// Ring size is a diagnostics-memory budget (oldest entry overwritten); it never
// bounds actor/atlas creation.
// BASHNYA atlas-residency report: this is the diagnostic that names the atlas
// path, node and reason instead of silently dropping the sprite.
#define R2D_WORLD_STREAM_WARNING_LIMIT 64
#define R2D_WORLD_STREAM_WARNING_PATH 512
#define R2D_WORLD_STREAM_WARNING_NODE 96
typedef struct {
    uint64_t seq;           // monotonic; JS dedupes auto-reports by seq
    int atlas_id;           // atlas actor registration index when reported
    int stream_id;          // stable stream item id (1000000+)
    uint64_t bytes;
    int cell_w, cell_h, columns, rows;
    int image_w, image_h;
    int frame;
    int state;              // R2DStreamState at report time
    int evict_reason;       // R2DStreamEvictReason of the last eviction
    char path[R2D_WORLD_STREAM_WARNING_PATH];
    char node_id[R2D_WORLD_STREAM_WARNING_NODE];
} R2DWorldStreamWarning;

// One flat directional atlas sprite registered from an existing `$` node. The
// atlas image and the cropped square frame live here; world depth/light/fog and
// direction selection are native, so game scripts do not project per frame.
typedef struct R2DWorldAtlasActor {
    JSValue node;
    // Decoded pixels are shared through R2DWorldAtlasImage (path dedup): one
    // buffer per unique canonical PNG path. Tiled sets keep one image per tile.
    R2DWorldAtlasImage *image;     // single-image source (tiles == NULL)
    R2DWorldAtlasImage **tiles;    // row-major tile references (tiled set)
    char **tile_paths;             // authored path per tile (row-major)
    int tile_count, tile_columns, tile_rows, tile_width, tile_height;
    int logical_w, logical_h;      // logical sheet size (single = image size)
    uint64_t pixel_bytes;          // sum of referenced image bytes (per-registration)
    uint64_t stream_bytes;         // unique bytes this registration accounts in the stream cache
    int columns,rows,directions,cell_w,cell_h,pivot_mode,blend;
    bool mirror;
    float pivot_x,pivot_y,width,height;
    // Constrained volume part offset in the actor's local XY/height frame.
    float offset_x,offset_y,offset_h;
    uint8_t *frame;
    int frame_side;
    int last_column,last_row,last_flip,frame_revision;
    // Stable per-registration stream id. Atlas actor slots shift on unregister, so
    // an array index would let stale residency state block the wrong atlas.
    int stream_id;
    char *path;             // authored atlas PNG path (diagnostics/pinning)
    char *node_id;          // authored $ node id (diagnostics)
    bool last_visible;      // previous-frame visibility (visible-demand input)
    bool warned;            // visible-not-resident already reported this episode
    bool pinned;            // explicit world.atlasPin() request
} R2DWorldAtlasActor;
// Frame entry kinds. RotSprite entries use native synthesis; atlas entries reuse
// an already cropped square image and do not touch the Re2DSprite runtime.
enum { R2D_WORLD_FRAME_ROTSPRITE = 0, R2D_WORLD_FRAME_ATLAS = 1, R2D_WORLD_FRAME_PARTICLE = 2 };
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
    // Scalability telemetry exposed through world.info(): registry sizes and
    // budget decisions (candidates vs selected, decal evictions, etc.).
    int diag_light_candidates,diag_lights_selected,diag_shadows_selected;
    int diag_decals_total,diag_decals_rendered,diag_decals_evicted;
    int diag_hit_proxies,diag_triggers,diag_movers,diag_controllers;
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
    // Controller configs share the same checked grow-on-demand registry pattern
    // as movers/triggers/secrets (no fixed compile-time capacity).
    R2DWorldControllerEntry *controllers;
    int controller_count,controller_capacity,next_controller_token;
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
    // R-04 huge-world region partition: lazily built from runtime cells/portals,
    // active/preload ring refreshed around the camera. Compiler metadata uses
    // the same deterministic grid rule.
    R2DWorldRegionSet regions;
    uint8_t *region_states;
    int *region_active,*region_preload;
    int region_active_count,region_preload_count,region_current;
    bool region_ready;
    // Profiler split (real CPU clocks, no fabricated GPU timestamps):
    // load = region grid build/ensure, visibility = PVS/occluder/cluster/
    // active-ring selection, stream = residency state update, stream_io =
    // budgeted payload load/unload tick.
    float region_load_ms,region_visibility_ms,region_stream_ms,region_stream_io_ms;
    // Hierarchical visibility: region PVS -> vis clusters -> local BSP/portal.
    R2DWorldClusterSet clusters;
    bool cluster_ready;
    R2DWorldRegionPortal *region_portals;
    int region_portal_capacity;
    R2DWorldOccluder *occluders;
    int occluder_count,occluder_capacity;
    uint64_t region_pvs_revision,occluder_revision;
    uint8_t *region_visible,*cell_allowed;
    int region_visible_capacity,cell_allowed_capacity;
    int region_visible_count,region_pvs_culled,region_occluder_culled,region_cluster_culled;
    int region_cells_allowed,region_cells_culled;
    int cluster_camera;
    float region_size_hint;
    int region_active_radius,region_preload_radius,region_cluster_cells;
    // Budgeted payload residency (BSP/surfaces/materials/textures/atlases/...).
    R2DStreamCache stream;
    R2DStreamBudget stream_budget;
    R2DStreamStats stream_stats;
    uint64_t stream_total_uploads,stream_total_upload_bytes,stream_total_evictions;
    bool stream_ready;
    uint64_t stream_asset_revision;
    // Stable atlas stream ids + registry revision (see R2DWorldAtlasActor).
    uint64_t atlas_registry_revision;
    int next_atlas_stream_id;
    // Sticky path pins: world.atlasPin(path,true) may run before the atlas is
    // registered (streamed populations); registration consults this set.
    R2DStreamPinSet path_pins;
    // Shared decoded-image cache (canonical path -> RGBA, refcounted). Generation
    // bumps on world reload/hot reload; live images stay until their last ref.
    R2DWorldAtlasImageCache atlas_images;
    uint64_t atlas_cache_generation;
    uint64_t atlas_dedup_hits;
    // Optional deterministic async PNG prefetch (file reads only; decode stays
    // on the main thread). Default OFF; zero-initialised state is valid.
    R2DAtlasPrefetch atlas_prefetch;
    // Bounded diagnostics ring for visible-not-resident atlases.
    R2DWorldStreamWarning stream_warnings[R2D_WORLD_STREAM_WARNING_LIMIT];
    int stream_warning_count;      // valid entries, oldest..newest logical order
    int stream_warning_head;       // next overwrite slot
    uint64_t stream_warning_seq;
    uint64_t stream_frame;         // monotonic residency frame counter
    int visible_atlas_blocked;     // visible atlas actors not resident this frame
    int ground_shadows_suppressed; // grounding cards skipped for blocked atlases
    // Task-15: true per-region payload residency (index packets moved by
    // R2DWorldStreamIO). Master world arrays remain the correctness fallback for
    // queries/visibility/render/nav, so an unloaded region never dangles.
    R2DWorldStreamIO stream_io;
    bool stream_io_ready;
    uint8_t *stream_io_required;
    int stream_io_required_capacity;
    R2DWorldStreamIOBudget stream_io_budget;
    R2DWorldStreamIOStats stream_io_stats;
    uint64_t stream_io_loads_total, stream_io_unloads_total;
    uint64_t stream_io_bytes_total;
    uint64_t stream_io_peak_tick_bytes;
    // Distant region impostors consumed by the renderer/JS. GPU owner draws.
    R2DWorldImpostorSet impostors;
    bool impostor_ready;
    R2DWorldImpostor *visible_impostors;
    int visible_impostor_count,visible_impostor_capacity;
    // Per-feature LOD policy + this-frame counters.
    R2DWorldRegionLodConfig lod_config;
    int lod_tick,lod_hidden_actors,lod_throttled_actors,lod_hidden_atlas;
    int lod_culled_lights,lod_culled_particles,lod_culled_decals;
    int audio_region_culled;
    float render_origin_x,render_origin_y;
    int render_origin_region;
    // Task-12 renderer integration: real GPU texture/atlas residency accounting,
    // shader-space render origin, LOD mask culling and hint/tool wall counts.
    uint64_t gpu_stream_uploads,gpu_stream_upload_bytes,gpu_stream_evictions,gpu_stream_transitions;
    int gpu_textures_resident,gpu_atlases_resident;
    int gpu_lod_culled_lights,gpu_lod_culled_decals,gpu_sprite_dir_reduced;
    int gpu_impostors_drawn;
    bool gpu_render_origin_active;
    float gpu_render_origin_x,gpu_render_origin_y;
    int hint_wall_count,skip_wall_count,occluder_wall_count;
    // Per-frame draw attribution for profiler/benchmarks.
    int gpu_draw_base,gpu_draw_span,gpu_draw_actor,gpu_draw_other,gpu_draw_ground,gpu_draw_vfx;
    // Borrowed R-03 VFX binding owned by the JS handle layer. NULL when the
    // world has no VFX manager; the GPU pass skips cards/trails in that case.
    struct R2DWorldVfx *vfx;
    // P0/P1 renderer visual model: grounding, edge quality, surface variation,
    // height fog/haze, sky layers and liquid. Pure data consumed by the GPU
    // uniform setup and the CPU reference grounding pass.
    R2DWorldRenderFeatures render_features;
    R2DWorldRenderCounters render_counters;
    // P4 static batching data path (CPU grouping only; GPU consumes the packed
    // contract from re2d_world_batch.h). Arrays are runtime-owned and grow on
    // demand; no GPU submission lives here.
    R2DWorldBatchItem *batch_items;
    int batch_item_capacity;
    R2DWorldBatchInstance *batch_instances;
    int batch_instance_capacity;
    R2DWorldBatchGroup *batch_groups;
    int batch_group_capacity;
    R2DWorldBatchStats batch_stats;
    // P4 GPU static batching: opt-out fallback and last-frame submission stats.
    bool batch_gpu;
    int gpu_batch_draws,gpu_batch_instances,gpu_batch_saved,gpu_batch_logical;
    bool render_features_ready;
    float render_time;
    // P2 final-frame postprocess stack (descriptors; JS maps to the render pass).
    R2DPostStack post;
    bool post_ready;
    // P2 sky 2.0 animation: panorama yaw + tint/lightning pulse.
    float sky_yaw_speed,sky_pulse_hz,sky_pulse_amount,sky_phase;
    uint32_t sky_tint;
    bool sky_anim_active;
    // Per-layer sky texture data. The runtime owns decoded RGBA8 pixels; the
    // renderer binds them through r2d_world_runtime_sky_layer_pixels().
    R2DWorldSky sky_config;
    struct { uint8_t *pixels; int width,height; bool loaded; } sky_layer_tex[R2D_SKY_MAX_LAYERS];
    bool sky_layers_ready;
    char sky_layer_error[192];
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
    // P2 material animation: parallel to the dynamic material bank. Both arrays
    // grow with world.material_capacity (never a fixed 64-slot cap).
    R2DWorldMaterialAnim *material_anims;
    bool *material_anim_active;
    int material_anim_capacity;
    // Per-frame light culling scratch (visible flags + nearest-first selection).
    // Runtime-owned and grown with the dynamic light registry, so no per-frame
    // allocation is needed for worlds with thousands of lights.
    uint8_t *light_flags;
    int light_flags_capacity;
    int *light_kept;
    int light_kept_capacity;
    int actor_count,actor_capacity,frame_count,frame_capacity;
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
// Tiled atlas-set source (world.sprite atlas:{files,tile}): row-major tiles,
// logical sheet may exceed 4096; each tile PNG stays <=4096 per side.
bool r2d_world_atlas_register_tiled(JSContext *,R2DWorldRuntime *,JSValueConst,JSValueConst files,
    int tile_columns,int tile_rows,int tile_width,int tile_height,
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
// Active-entry counts for callers that size a token buffer without a fixed
// compile-time trigger/secret capacity (bindings, native tooling).
int r2d_world_trigger_active_count(const R2DWorldRuntime *);
int r2d_world_secret_active_count(const R2DWorldRuntime *);
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
// Runtime particle capacity (default 2048; quality presets 512/2048/8192).
// Reallocates only while the pool is empty; the per-frame budget stays separate.
bool r2d_world_particles_set_capacity(R2DWorldRuntime *,int capacity);
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
bool r2d_world_regions_ensure(R2DWorldRuntime *);
void r2d_world_regions_free(R2DWorldRuntime *);
const R2DWorldRegionSet *r2d_world_regions(const R2DWorldRuntime *);
// Compiler --region-size metadata ("compiler.regionGrid.size" or root
// "regionGrid.size") parsed from the same JSON the runtime loads. 0 when absent.
float r2d_world_region_size_from_json(const char *text);
// Streaming/LOD runtime configuration. region_size<=0 keeps the compiler hint
// or the deterministic 512 default. Returns false on invalid values.
bool r2d_world_region_config(R2DWorldRuntime *,float region_size,int active_ring,
                             int preload_ring,uint64_t upload_budget_bytes,
                             int upload_items);
bool r2d_world_region_lod_config(R2DWorldRuntime *,const R2DWorldRegionLodConfig *);
// Residency raw budget (0 resident bytes = unlimited, max_items 0 = unlimited).
// Used by tests/benchmarks to force deterministic evictions.
bool r2d_world_region_budget(R2DWorldRuntime *,uint64_t resident_bytes,int max_resident_items);
// Public stream budget setter behind world.streamConfig(). Unlike the low-level
// cache contract, 0 means "unlimited/no cap" for every field here: resident
// bytes/items, per-frame upload bytes/items and per-frame promotions. Callers
// that need the legacy "0 uploads = freeze this frame" contract keep using
// r2d_world_region_config()/r2d_world_region_budget().
bool r2d_world_stream_config(R2DWorldRuntime *,uint64_t resident_bytes,int resident_items,
                             uint64_t upload_bytes,int upload_items,int promote_items);
// Sticky path-pin cap: 0 = unlimited (hard cap 4096), default 64. Lowering below
// the current pending count is rejected and surfaced as a typed error.
bool r2d_world_stream_set_pin_limit(R2DWorldRuntime *,int limit);
// Hot-reload/scene-reload cache generation: new registrations re-decode; images
// still referenced by live actors stay valid until their last release.
void r2d_world_atlas_cache_invalidate(R2DWorldRuntime *);
// Explicit atlas pin by authored path (all registered actors with that path) or
// by atlas actor id (0..atlas_count-1). Returns the number of matched atlases.
int r2d_world_atlas_pin(R2DWorldRuntime *,const char *path_or_null,int atlas_id,bool pinned);
// Visible-but-not-resident warning ring. `warnings()` peeks (oldest first);
// `take_warnings()` copies and clears. Return the number of entries available
// (bounded by R2D_WORLD_STREAM_WARNING_LIMIT).
int r2d_world_stream_warnings(R2DWorldRuntime *,R2DWorldStreamWarning *out,int capacity);
int r2d_world_take_stream_warnings(R2DWorldRuntime *,R2DWorldStreamWarning *out,int capacity);
// Override only the five LOD distance bands (budgets stay at defaults). Used by
// benchmarks/tests to force deterministic light/decal/sprite culling.
bool r2d_world_region_lod_bands(R2DWorldRuntime *,float near_distance,float mid_distance,
                                float far_distance,float impostor_distance,float hidden_distance);
// Region/vis-cluster/PVS/occluder pass for the current camera. Called once per
// frame by r2d_world_runtime_frame(); exposed for native tests/benchmarks.
void r2d_world_regions_frame(R2DWorldRuntime *,const R2DRe2dView *);
// Native debug overlay for the appended R2D_WORLD_DEBUG_* views. Blends
// constrained 2D lines/tints and per-owner material/AO colors into an existing
// RGBA frame; FINAL and legacy views are never touched.
void r2d_world_debug_overlay(R2DWorldRuntime *,const R2DRe2dView *,float ortho,
                             int width,int height,uint8_t *rgba);
// Renderer hook: region-local render origin of the current camera region.
bool r2d_world_render_origin(R2DWorldRuntime *,float *,float *,int *);
// Renderer hook: nearest-first distant impostor cards collected this frame.
const R2DWorldImpostor *r2d_world_visible_impostors(R2DWorldRuntime *,int *count);
// P4 static batching: rebuild deterministic groups from the current visibility
// once per frame. Pure data path; the GPU renderer may upload the arrays later.
void r2d_world_batch_frame(R2DWorldRuntime *);
const R2DWorldBatchStats *r2d_world_batch_stats(const R2DWorldRuntime *);
bool r2d_world_runtime_material(JSContext *,R2DWorldRuntime *,const char *,const char *,const char *,const char *,float,float,float,int,float,bool,bool);
bool r2d_world_runtime_sky(JSContext *,R2DWorldRuntime *,const char *,uint32_t,float,float);

void r2d_world_audio_step(R2DWorldRuntime *,const R2DRe2dView *);
void r2d_world_audio_free(R2DWorldRuntime *);
// Renderer visual feature configuration and deterministic time advance.
void r2d_world_render_init(R2DWorldRuntime *);
bool r2d_world_render_set_features(R2DWorldRuntime *,const R2DWorldRenderFeatures *);
bool r2d_world_render_quality(R2DWorldRuntime *,int quality);
const R2DWorldRenderFeatures *r2d_world_render_features(const R2DWorldRuntime *);
void r2d_world_render_advance(R2DWorldRuntime *,float dt);
// Grounding card shared by the CPU reference and the GPU ground pass. Values
// are output-pixel coordinates/radii plus the exact blend parameters, so both
// backends draw the same footprint. Returns false when the actor has no floor
// span or the card is off-screen/too small.
typedef struct {
    float center_x,center_y,radius_x,radius_y;
    float opacity,softness,foot_ratio,foot_strength;
    float tint_r,tint_g,tint_b;
    int span;
} R2DWorldGroundCard;
bool r2d_world_render_ground_card(R2DWorldRuntime *,const R2DRe2dView *,int width,int height,
                                  float ortho,int actor,R2DWorldGroundCard *out);

// Per-layer sky textures (GPU-independent data half). The owner is the world
// runtime; these functions never touch GPU objects. The renderer hook is:
//   const R2DWorldSky *cfg = r2d_world_runtime_sky_config(w);
//   for i in 0..cfg->sky_layer_count-1:
//       const uint8_t *rgba = r2d_world_runtime_sky_layer_pixels(w,i,&px_w,&px_h);
//       if (rgba) bind/upload as a texture; layer metadata is cfg->layers[i].
bool r2d_world_runtime_sky_layer_set(JSContext *, R2DWorldRuntime *, int index,
                                     const char *id, const char *texture,
                                     uint32_t tint, float parallax, float scroll,
                                     float alpha, float offset, float scale);
bool r2d_world_runtime_sky_manifest(JSContext *, R2DWorldRuntime *, const char *path);
int r2d_world_runtime_sky_layer_count(const R2DWorldRuntime *);
const R2DWorldSky *r2d_world_runtime_sky_config(const R2DWorldRuntime *);
const uint8_t *r2d_world_runtime_sky_layer_pixels(const R2DWorldRuntime *, int,
                                                  int *width, int *height);
const char *r2d_world_runtime_sky_layer_path(const R2DWorldRuntime *, int);
const char *r2d_world_runtime_sky_layer_error(const R2DWorldRuntime *);
void r2d_world_runtime_sky_layers_free(R2DWorldRuntime *);
