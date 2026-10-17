#pragma once
#include "re2d_world.h"
#include <stdbool.h>

// Native, allocation-free Re2D player controller helper.
//
// This is not an entity and not a physics engine. It moves one circle/cylinder
// body through the existing 2.5D world queries and owns no global state.
//
// Axes: x/y are the world plane, feet is the vertical foot height, vx/vy are
// horizontal velocities and vz is vertical velocity (units per second).
//
// Movement semantics (one fixed tick, dt seconds):
//  - wish (wish_x,wish_y) is clamped to length 1; ground target speed is
//    wish*max_ground and air target speed is wish*max_air.
//  - grounded: accelerate toward the target at accel*dt; with no wish apply
//    linear friction*dt along the current velocity.
//  - airborne: steer toward the target at accel*air_control*dt; with no wish
//    horizontal velocity is preserved. Airborne speed is hard capped at
//    max_air.
//  - gravity lowers vz every airborne tick; jump sets vz=jump_speed only when
//    grounded. Landing zeroes vz and sets grounded.
//  - ceiling: upward motion is clamped so feet+height <= span ceiling, and vz
//    becomes zero.
//  - horizontal motion tries the full step, then X-only, then Y-only (wall
//    slide). Each substep moves at most radius*0.5; substeps are capped at 64.
//  - step-up up to step is climbed via r2d_world_support. Ground-follow
//    descends up to step directly, or follows a slope steeper than that only
//    while its angle is <= slope_limit degrees. Deeper drops become airborne.
//  - the span/ceiling are re-resolved with r2d_world_support at the new XY,
//    so open portals and multi-span transitions move the body to the
//    destination span automatically. Closed portals are solid walls.
//
// Invalid input (null pointers, non-finite values, dt outside [0,0.5],
// invalid config) leaves the state untouched.

typedef struct {
    float radius,height,eye,step,slope_limit; // step>=0, slope_limit in [0,89] degrees
    float gravity,jump_speed,max_ground,max_air,accel,friction,air_control;
} R2DWorldControllerConfig;

typedef struct {
    float x,y,feet,vx,vy,vz;
    int span; float ceiling;
    bool grounded;
} R2DWorldControllerState;

// Resolve start (optional, zeroed when NULL) onto a support at start->x/y.
// Returns false when the world has no support there. On success writes a
// normalised starting state: feet snapped up to the floor (grounded) or kept
// above it (airborne fall), span/ceiling resolved.
bool r2d_world_controller_init(const R2DRe2dWorld *world,
                               const R2DWorldControllerConfig *config,
                               const R2DWorldControllerState *start,
                               R2DWorldControllerState *out);

// Advance one fixed tick. Deterministic, no allocation, no globals.
void r2d_world_controller_move(const R2DRe2dWorld *world,
                               const R2DWorldControllerConfig *config,
                               R2DWorldControllerState *state,
                               float wish_x,float wish_y,bool jump,float dt);
