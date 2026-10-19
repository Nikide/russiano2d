#pragma once
// ===========================================================================
// Re2D: native VFX library (R-03, roadmap sections 108-116).
//
// Constrained 2.5D VFX data and runtime-allocated pools for world/screen cards,
// pooled trails, temporary lights, decals and effect bundles. No ECS, no mesh,
// no per-spark JS node: one native step owns all effects on the world.
//
// Particles are emitted into the existing R2DWorldParticlePool. Particle
// collision modes live in re2d_world_particle.h and are also driven here with
// world support/blocked queries. This module never allocates per frame: all
// pool storage is allocated once by r2d_world_vfx_init/_init_quality and
// released by r2d_world_vfx_free. Bundle parsing is one-shot (r2d_json); the
// bundle registry and per-bundle preset lists grow on demand, while the
// spawn-time pools stay budgeted by the current R2DWorldVfxQuality.
//
// FX bundle format (JSON, same shape as high-level fxDefine):
//   {
//     "particles": [{"count":12,"life":.4,"size":8,"endSize":0,
//                    "color":"#ffd080","blend":"additive","mode":"billboard",
//                    "collision":"bounce","bounce":.4,"radius":1,
//                    "speed":120,"spread":40,"dirH":.2}],
//     "cards": [{"kind":"ring","life":.25,"size":20,"endSize":120,
//                "color":"#ffd0a0","blend":"additive","distortion":"shockwave"}],
//     "trail": {"life":.3,"width":6,"color":"#ffffff","spacing":.02,"speed":80},
//     "light": {"radius":200,"intensity":2,"color":"#ffb060","life":.1,
//               "priority":3,"shadow":false},
//     "decal": {"material":0,"width":16,"height":16,"life":12},
//     "sound": "sfx/impact.ogg", "shake": .2,
//     "flash": {"color":"#fff0c0","ms":60}
//   }
//
// Counters: cards/trails/lights/decals are bounded by the quality capacities
// below. Temp lights respect `light_budget` with deterministic stealing by
// priority. Decals use existing world decal slots and require a used material.
// ===========================================================================
#include "re2d_world_particle.h"

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// Default quality capacities. These are DEFAULTS, not hard limits: the bundle
// registry and the per-bundle preset lists grow on demand, and
// r2d_world_vfx_set_quality() can resize the spawn-time pools at runtime.
#define R2D_WORLD_VFX_MAX_BUNDLES 64
#define R2D_WORLD_VFX_MAX_CARDS 128
#define R2D_WORLD_VFX_MAX_TRAILS 32
#define R2D_WORLD_VFX_TRAIL_POINTS 8
#define R2D_WORLD_VFX_MAX_LIGHTS 16
#define R2D_WORLD_VFX_MAX_PARTICLES 4096
#define R2D_WORLD_VFX_MAX_PARTICLE_PRESETS 4
#define R2D_WORLD_VFX_MAX_CARD_PRESETS 4
#define R2D_WORLD_VFX_NAME_MAX 48
#define R2D_WORLD_VFX_SOUND_MAX 96

enum {
    R2D_VFX_CARD_SPRITE = 0,
    R2D_VFX_CARD_STREAK,
    R2D_VFX_CARD_RING,
    R2D_VFX_CARD_FLASH,
    R2D_VFX_CARD_DECAL,
    R2D_VFX_CARD_LIGHT_PULSE,
    R2D_VFX_CARD_KIND_COUNT
};

enum {
    R2D_VFX_MODE_BILLBOARD = 0,
    R2D_VFX_MODE_SCREEN,
    R2D_VFX_MODE_AXIS,
    R2D_VFX_MODE_FLOOR
};

enum {
    R2D_VFX_DISTORTION_NONE = 0,
    R2D_VFX_DISTORTION_HEAT,
    R2D_VFX_DISTORTION_SHOCKWAVE,
    R2D_VFX_DISTORTION_MAGIC
};

typedef struct {
    int kind;             // R2D_VFX_CARD_*
    int mode;             // R2D_VFX_MODE_*
    int blend;            // R2D_PARTICLE_MASKED/TRANSLUCENT/ADDITIVE
    int distortion;       // R2D_VFX_DISTORTION_*
    float x,y,h;
    float vx,vy,vh;
    float speed;          // spawn-time direction boost
    float life,max_life;
    float size,start_size,end_size;
    float alpha,start_alpha,end_alpha;
    float rotation,spin;
    float width;          // streak width / ring thickness
    float r,g,b;
    int frame,frames;
    bool active;
} R2DWorldVfxCard;

typedef struct {
    bool active;
    int count;             // live points, 1..point_capacity
    // Points are slices of the VFX-owned trail storage; the renderer indexes
    // x/y/h[0..count) with 0 = newest. Never freed by the trail itself.
    float *x;
    float *y;
    float *h;
    int point_capacity;
    float head_x,head_y,head_h;
    float vx,vy,vh;
    float speed;
    float life,max_life;
    float spacing,accum;
    float width;
    float r,g,b;
    int blend,distortion;
} R2DWorldVfxTrail;

typedef struct {
    bool active;
    int token;             // world light token, -1 when world is absent
    int priority;
    float life,max_life;
    float radius,intensity;
    float x,y,h;
    float r,g,b;
    bool shadow;
} R2DWorldVfxLight;

typedef struct {
    int count;
    float spread,speed;
    float dir_x,dir_y,dir_h;
    R2DWorldParticle proto;
} R2DWorldVfxParticlePreset;

typedef struct {
    int material;
    float width,height,life,u,v;
} R2DWorldVfxDecalPreset;

typedef struct {
    char name[R2D_WORLD_VFX_NAME_MAX];
    bool used;
    int particle_count;
    int particle_capacity;
    R2DWorldVfxParticlePreset *particles; // growable, owned by the registry
    int card_count;
    int card_capacity;
    R2DWorldVfxCard *cards;               // growable, owned by the registry
    bool has_trail;
    R2DWorldVfxTrail trail;               // preset only: x/y/h stay NULL
    bool has_light;
    R2DWorldVfxLight light;
    bool has_decal;
    R2DWorldVfxDecalPreset decal;
    char sound[R2D_WORLD_VFX_SOUND_MAX];
    float shake;
    int flash_ms;
    uint32_t flash_color;
} R2DWorldVfxBundle;

// Runtime pool capacities. max_bundles is the INITIAL registry capacity (the
// registry doubles on demand); the others are hard spawn-time budgets for the
// current quality level. particles is the per-bundle-spawn particle emission
// cap (the particle pool itself remains caller-owned).
typedef struct {
    int max_bundles;
    int max_cards;
    int max_trails;
    int trail_points;
    int temp_lights;
    int particles;
} R2DWorldVfxQuality;

// Zero-initialised quality means "defaults"; use r2d_world_vfx_default_quality.
R2DWorldVfxQuality r2d_world_vfx_default_quality(void);

typedef struct {
    int particles_alive;
    int particle_capacity;
    int particle_overflow;   // particles evicted from the ring (== evicted)
    int particle_peak;       // pool high-water mark since init/clear
    int particles_spawned;
    int cards;
    int cards_capacity;
    int cards_spawned;
    int cards_evicted;       // oldest card replaced because the pool was full
    int trails;
    int trails_capacity;
    int trails_spawned;
    int trails_evicted;      // oldest trail replaced because the pool was full
    int temp_lights;
    int light_capacity;
    int light_budget;
    int light_overflow;      // lights refused by budget/priority or allocation
    int decals;
    int decals_capacity;
    int decals_spawned;
    int decals_evicted;      // oldest tracked decal replaced when the pool was full
    int distortion_cards;
    int bundles;
    int bundle_capacity;
    int fx_spawns;
    int emitters;          // active trails (continuous effect emitters)
} R2DWorldVfxInfo;

typedef struct {
    int particles;
    int cards;
    int trails;
    int lights;
    int decals;
    int distortion;
    float shake;
    int flash_ms;
    uint32_t flash_color;
    char sound[R2D_WORLD_VFX_SOUND_MAX];
} R2DWorldVfxSpawn;

// Runtime hooks. The module never includes the world/runtime headers: light,
// decal and collision queries are supplied by the host (re2d.c). All hooks are
// optional; with NULL hooks effects still simulate but do not touch the world.
typedef struct {
    void *user;
    int (*light_create)(void *user,float x,float y,float h,float radius,
                        float intensity,float r,float g,float b,bool shadow,float life);
    bool (*light_remove)(void *user,int token);
    int (*decal_spawn)(void *user,float x,float y,float h,float dx,float dy,float dh,
                       int material,float width,float height,float life);
    bool (*decal_remove)(void *user,int token);
    bool (*support)(void *user,float x,float y,float h,float *floor,float *ceiling);
    bool (*blocked)(void *user,float x,float y,float radius,float bottom,float top);
} R2DWorldVfxHooks;

typedef struct R2DWorldVfx {
    R2DWorldVfxQuality quality;
    // Growable registry: bundle_count live entries in bundle_capacity slots.
    R2DWorldVfxBundle *bundles;
    int bundle_count,bundle_capacity;
    // Runtime spawn pools, allocated once per quality change.
    R2DWorldVfxCard *cards;
    int card_capacity;
    R2DWorldVfxTrail *trails;
    int trail_capacity;
    R2DWorldVfxLight *lights;
    int light_capacity;
    int card_cursor,trail_cursor,light_cursor;
    // Trail point storage: each trails[i] x/y/h points into these slices.
    float *trail_x,*trail_y,*trail_h;
    // Decal bookkeeping pool (tokens tracked by the library).
    int *decal_tokens;
    float *decal_life;
    int decal_capacity,decal_count;
    R2DWorldVfxHooks hooks;          // borrowed host callbacks
    R2DWorldParticlePool *particles; // borrowed; NULL = no particle emission
    int light_budget;
    uint32_t last_seed;
    int fx_spawns;
    int particles_spawned,cards_spawned,trails_spawned,lights_spawned,decals_spawned;
    int cards_evicted,trails_evicted,decals_evicted,light_overflow;
} R2DWorldVfx;

// Allocate the default quality pools and reset all state. Returns false and
// leaves a safe, empty manager when allocation fails (all pools NULL/0).
// Existing callers can keep using the void form below.
bool r2d_world_vfx_init_quality(R2DWorldVfx *vfx,R2DWorldParticlePool *particles,
                                int light_budget,const R2DWorldVfxQuality *quality);

// Bind borrowed particle storage and reset all pools with the default quality.
// light_budget is clamped to 0..quality.temp_lights; NULL vfx is a no-op.
void r2d_world_vfx_init(R2DWorldVfx *vfx,R2DWorldParticlePool *particles,int light_budget);

// Release every heap pool and registry. Registered definitions are dropped.
// Safe on NULL and on an already-freed/zeroed manager.
void r2d_world_vfx_free(R2DWorldVfx *vfx);

// Resize the spawn-time pools. Registered bundle definitions are preserved;
// live cards/trails/lights/decals are dropped (quality changes are not hot).
// The bundle registry only grows (never shrinks below the registered count).
// Returns false (state untouched) for invalid/NULL input or allocation failure.
bool r2d_world_vfx_set_quality(R2DWorldVfx *vfx,const R2DWorldVfxQuality *quality);
R2DWorldVfxQuality r2d_world_vfx_get_quality(const R2DWorldVfx *vfx);

// Replace the borrowed particle pool (created lazily by the runtime). NULL is
// ignored. Hooks may be updated independently.
void r2d_world_vfx_bind(R2DWorldVfx *vfx,R2DWorldParticlePool *particles);
void r2d_world_vfx_hooks(R2DWorldVfx *vfx,const R2DWorldVfxHooks *hooks);

// Parse one FX bundle JSON into the growable registry. Returns false and writes
// a human-readable ASCII error when name/text is invalid or any parsed field is
// out of range. The registry and per-bundle preset arrays grow on demand, so
// there is no fixed "#65 bundle" rejection; only allocation failure stops it.
// Re-defining an existing name replaces it. No partial bundle is stored on
// failure.
bool r2d_world_vfx_define(R2DWorldVfx *vfx,const char *name,const char *json,
                          char *error,size_t error_size);

// True when a bundle name is registered.
bool r2d_world_vfx_defined(const R2DWorldVfx *vfx,const char *name);

// Spawn a registered bundle at (x,y,h). Direction (dx,dy,dh) is optional; when
// non-zero it overrides the authored particle/card/trail direction. Returns the
// number of spawned primitives (>=0) or -1 on invalid/unknown input.
int r2d_world_vfx_spawn(R2DWorldVfx *vfx,const char *name,
                        float x,float y,float h,
                        float dx,float dy,float dh,uint32_t seed,
                        R2DWorldVfxSpawn *out);

// Advance cards, trails, temp lights and VFX decal bookkeeping. dt is clamped
// to 0..0.25; non-finite dt is ignored. The particle pool is not stepped here.
void r2d_world_vfx_step(R2DWorldVfx *vfx,float dt);

// Step the bound particle pool with world collision queries (modes from each
// particle prototype). Call once per world tick after r2d_world_vfx_step.
void r2d_world_vfx_step_particles(R2DWorldVfx *vfx,float dt);

// Drop all live effects and remove their temp lights/decals; registered bundle
// definitions stay. NULL is a no-op.
void r2d_world_vfx_clear(R2DWorldVfx *vfx);

void r2d_world_vfx_info(const R2DWorldVfx *vfx,R2DWorldVfxInfo *out);

// Light budget setter/getter. Values are clamped to 0..quality.temp_lights;
// lowering the budget removes the lowest-priority lights immediately.
void r2d_world_vfx_light_budget(R2DWorldVfx *vfx,int budget);
int  r2d_world_vfx_get_light_budget(const R2DWorldVfx *vfx);
