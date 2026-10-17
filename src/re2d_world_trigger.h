#pragma once
// ===========================================================================
// Re2D: pure semantic trigger state machine (P0-F, roadmap sections 15/16/105).
//
// This is NOT a gameplay script engine. The runtime feeds world/player queries
// into these calls; a successful call means "emit this semantic event now".
// The controller then does `$.emit(trigger.id, trigger.target)` (or exposes
// target through user_data on the JS side). No gameplay rules live here.
//
// Constrained primitive: an upright cylinder footprint in XY plus the vertical
// interval [bottom,top]. There is no mesh, no 3D volume and no ECS. No
// allocation, no globals, no clocks: every result depends only on the
// arguments and previous calls, so replays are bit-identical.
//
// Semantics (exact)
// ----------------
// * Cylinder containment (enter/use/shoot):
//       dx*dx + dy*dy <= radius*radius   (inclusive boundary)
//       bottom <= h <= top               (inclusive; callers pass the actor
//                                         feet for enter and the interaction
//                                         height for use/shoot)
// * enabled: set by init/reset, cleared permanently by a one-shot firing.
//   A disabled trigger never fires. enter() still tracks armed while disabled,
//   so re-enabling a player already inside waits for a leave/re-enter instead
//   of firing on the same tick.
// * armed: enter-only inside-volume state. It becomes true only on the tick the
//   point crosses outside -> inside. While armed, repeated enter() calls with an
//   inside point do NOT fire. Moving outside clears armed (re-arm). Any other
//   trigger type never touches armed.
// * once: after one successful fire, enabled becomes 0 permanently. Even if a
//   caller forces enabled back to 1, fire_count>0 still blocks the one-shot
//   until r2d_world_trigger_reset(). Non-one-shot triggers repeat.
// * cooldown: a successful fire sets timer = cooldown (when cooldown > 0). Any
//   fire (enter/use/shoot, one-shot or repeat) requires timer <= 0. step()
//   decrements timer by dt, flooring at 0. step() runs whether or not the
//   trigger is enabled. cooldown == 0 means no timer is ever set.
// * fire_count: number of successful fires. user_data is caller-owned and
//   preserved by reset.
// * Invalid input (NULL trigger, unknown type, non-finite numbers, radius <= 0,
//   top <= bottom, cooldown < 0, bad dt, NULL/oversized id) is rejected without
//   changing trigger state and returns false. init() zeroes the struct before
//   validating, so a failed init leaves a safely zeroed (disabled) trigger.
// * id: copied into a bounded buffer, at most 63 bytes plus NUL; a longer id is
//   rejected rather than truncated. target is borrowed and never copied/freed.
// ===========================================================================
#include <stdbool.h>

typedef enum {
    R2D_TRIGGER_ENTER = 0,
    R2D_TRIGGER_USE   = 1,
    R2D_TRIGGER_SHOOT = 2
} R2DWorldTriggerType;

typedef struct {
    int type;                 // R2D_TRIGGER_ENTER/USE/SHOOT
    float x, y, radius, bottom, top; // semantic cylinder volume
    int once;                 // one-shot flag
    float cooldown;           // seconds between repeats (0 = none)
    int enabled;              // 0 = never fires until reset/init
    char id[64];              // bounded event semantic name
    const char *target;       // borrowed semantic target, may be NULL
    int fire_count, user_data;
    float timer;              // cooldown remaining, seconds
    bool armed;               // inside-volume state for enter
} R2DWorldTrigger;

// Configure and reset a trigger. on success: type/x/y/radius/bottom/top/once/
// cooldown/id/target are stored, enabled=1, timer=0, fire_count=0, armed=false,
// user_data=0. Returns false for NULL trigger or invalid arguments (see above).
bool r2d_world_trigger_init(R2DWorldTrigger *trigger, int type, const char *id, const char *target,
                            float x, float y, float radius, float bottom, float top,
                            bool once, float cooldown);

// Advance the cooldown timer. dt is normally 0..0.25 s; ds outside that range
// are clamped to 0..0.25 (non-finite dt is ignored). NULL is a no-op.
void r2d_world_trigger_step(R2DWorldTrigger *trigger, float dt);

// Player/actor point at (x,y) with feet height. Returns true exactly when an
// ENTER trigger fires on this tick: the point entered the cylinder (outside ->
// inside), and enabled/once/cooldown allow it. Returns false for other types or
// invalid input. Leaving the cylinder re-arms it.
bool r2d_world_trigger_enter(R2DWorldTrigger *trigger, float x, float y, float feet);

// Discrete USE intent at (x,y,h). Returns true when a USE trigger fires; the
// point must be inside the cylinder. A repeat trigger may fire on consecutive
// calls while enabled and off cooldown. False for other types/problem input.
bool r2d_world_trigger_use(R2DWorldTrigger *trigger, float x, float y, float h);

// Discrete SHOOT intent at (x,y,h) with shot radius (>= 0). Horizontal reach is
// radius + shot_radius (inclusive); the height is still a point inside
// [bottom,top]. Returns true when a SHOOT trigger fires. False otherwise.
bool r2d_world_trigger_shoot(R2DWorldTrigger *trigger, float x, float y, float h, float radius);

// Restore runtime state after init: enabled=1, timer=0, fire_count=0,
// armed=false. Configuration (type, volume, once, cooldown, id, target) and
// user_data are preserved. NULL is a no-op.
void r2d_world_trigger_reset(R2DWorldTrigger *trigger);
