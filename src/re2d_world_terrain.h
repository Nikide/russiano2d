#pragma once
// ===========================================================================
// Re2D: authored surface-terrain metadata and 2D conveyor surface velocity.
//
// Constrained 2.5D only. This module is pure data plus deterministic gameplay
// helpers: it owns no geometry, renderer, particles, clock or mutable globals.
// A runtime associates a terrain kind with an existing Re2D surface/span and
// copies the returned multipliers/hints into its own gameplay state. There is
// no fluid simulation, no mesh and no ECS entity here.
//
// Terrain fields
// --------------
//  move_scale          movement speed multiplier (1 = normal, 0 = cannot move)
//  friction_scale      friction multiplier (1 = normal, <1 = slippery)
//  damage_per_second   damage rate applied while touching the surface
//  splash_speed        splash/impact VFX speed hint (0 = no splash)
//  tint_r/g/b          0..1 liquid/material tint hint
//  fog_density         0..1 fog density hint (0 = clear)
//  decal_policy        R2DTerrainDecal hint for impact/foot decals
//  kind                one of R2DTerrainKind; also the footstep sound hint
//                      (the game maps a kind to its own footstep bank)
//
// Presets are stable authored data. R2D_TERRAIN_NONE is a valid preset with
// neutral values. Invalid kinds return NULL / false / -1; names are matched
// case-insensitively over ASCII letters and must be the exact whole word.
//
// Conveyor
// --------
// R2DWorldConveyor is authored surface velocity. r2d_world_conveyor_apply
// accelerates a grounded body velocity toward (vx,vy)*move_scale at `accel`
// units/second^2. `affects_projectiles` is a data-only policy flag: this
// helper never touches projectile state. dt is clamped to [0,0.25] seconds;
// NULL, non-finite values, negative accel/move_scale are rejected by leaving
// the velocity untouched. Deterministic for identical inputs.
// ===========================================================================
#include <stdbool.h>

typedef enum {
    R2D_TERRAIN_NONE = 0,   // neutral surface / no authored terrain
    R2D_TERRAIN_STONE,      // solid, dusty
    R2D_TERRAIN_METAL,      // solid, hard, spark hint
    R2D_TERRAIN_FLESH,      // soft, bloody
    R2D_TERRAIN_WOOD,       // solid, warm
    R2D_TERRAIN_CRYSTAL,    // solid, slippery, magical
    R2D_TERRAIN_MAGIC,      // magical surface, faint fog
    R2D_TERRAIN_WATER,      // liquid: no damage, slows movement
    R2D_TERRAIN_BLOOD,      // liquid: slight damage/slow, red
    R2D_TERRAIN_ACID,       // liquid: damage over time, green
    R2D_TERRAIN_LAVA,       // liquid: high damage, orange, dense fog
    R2D_TERRAIN_MIST,       // magical mist: minor damage, heavy fog
    R2D_TERRAIN_COUNT
} R2DTerrainKind;

// Decal hint. The game chooses its own sprites/decals for these policies.
typedef enum {
    R2D_TERRAIN_DECAL_NONE = 0,
    R2D_TERRAIN_DECAL_DUST,
    R2D_TERRAIN_DECAL_BLOOD,
    R2D_TERRAIN_DECAL_SCORCH,
    R2D_TERRAIN_DECAL_ACID,
    R2D_TERRAIN_DECAL_WET,
    R2D_TERRAIN_DECAL_MAGIC
} R2DTerrainDecal;

typedef struct {
    int kind;                    // R2DTerrainKind
    float move_scale;            // >= 0
    float friction_scale;        // >= 0
    float damage_per_second;     // >= 0
    float splash_speed;          // >= 0, VFX hint
    float tint_r, tint_g, tint_b; // 0..1
    float fog_density;           // 0..1
    int decal_policy;            // R2DTerrainDecal
} R2DWorldTerrain;

// Stable preset pointer for a valid kind, NULL for anything outside
// [0, R2D_TERRAIN_COUNT). Returned memory is read-only static data.
const R2DWorldTerrain *r2d_world_terrain_preset(int kind);

// Case-insensitive name -> kind. On failure returns false and writes -1 when
// `kind` is non-NULL. NULL name also fails.
bool r2d_world_terrain_from_name(const char *name,int *kind);

// Canonical lowercase preset name, NULL for an invalid kind.
const char *r2d_world_terrain_name(int kind);

typedef struct {
    float vx,vy;                 // authored surface velocity, units/second
    float accel;                 // >= 0, units/second^2 toward surface velocity
    bool affects_projectiles;    // data-only policy, never read by apply
} R2DWorldConveyor;

// Move *vx/*vy toward (conveyor.vx,conveyor.vy)*move_scale for one tick.
// No-op on NULL pointers, non-finite inputs, negative accel/move_scale, or
// dt <= 0. dt > 0.25 is clamped to 0.25. The result never overshoots the
// target velocity. No allocation, globals or clock.
void r2d_world_conveyor_apply(const R2DWorldConveyor *conveyor,
                              float *vx,float *vy,
                              float move_scale,float dt);
