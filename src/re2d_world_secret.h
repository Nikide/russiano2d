#pragma once
// ===========================================================================
// Re2D: pure secret-volume and authored-breakable state machines (P1, roadmap
// sections 16.3, 29, 30 and 63).
//
// These are NOT gameplay script engines and NOT entity systems. The runtime
// feeds world/player queries into these calls; the returned transition tells
// the caller to emit a semantic event or swap an authored variant. No gameplay
// balance, no rendering, no world mutation happens here.
//
// Constrained primitive: an upright cylinder footprint in XY plus the vertical
// interval [bottom,top]. There is no mesh, no 3D volume, no ECS, no runtime CSG.
// No allocation, no globals, no clock reads: results depend only on arguments
// and previous calls, so replays are bit-identical.
//
// Secret semantics (exact)
// ------------------------
// * Containment (inclusive boundaries):
//       dx*dx + dy*dy <= radius*radius
//       bottom <= feet <= top
// * entered is edge state: it becomes true only when touch() observes an
//   outside -> inside transition. Repeated touch() inside the same volume does
//   not fire. Any non-inside touch clears entered, so leaving re-arms the
//   volume.
// * found becomes true on the first successful find and stays true until
//   reset(). found_count increments once per successful entry.
// * once == true: only the first entry fires; later entries return 0 and do not
//   increment found_count. once == false: every outside -> inside transition
//   fires and increments found_count.
// * timer is presentation state only (seconds since the latest find, used by a
//   HUD pulse or native sprite helper). step() advances it while found.
// * Invalid input (NULL, non-finite coordinate, radius <= 0, top <= bottom,
//   NULL/oversized id) is rejected without changing state. init() zeroes the
//   struct first, so a failed init leaves a safely zeroed secret.
// * id is copied into a bounded buffer, at most 63 bytes plus NUL; longer ids
//   are rejected rather than truncated.
//
// Breakable semantics (exact)
// ---------------------------
// * hp starts at hp and max_hp; hp is clamped at 0 on damage. broken flips true
//   exactly once, on the hit that reaches hp == 0, and never flips back except
//   through reset().
// * variant and portal are authored indices. The runtime may swap to
//   variant-derived frames/graphics or unlock/open portal once broken; this
//   module only records the transition and returns 1 for it.
// * damage < 0 is invalid (-1). damage == 0 is a valid no-op (0). A broken
//   breakable or one whose hp <= 0 without a transition returns 0; this keeps
//   zeroed/uninitialised structs from emitting a spurious break event.
// * The zone (x,y,radius,bottom,top) is the authored hit proxy; it mirrors the
//   secret cylinder convention and is validated like one.
// * Invalid input (NULL, non-finite numbers, radius <= 0, top <= bottom,
//   hp <= 0, variant < 0, portal < -1, NULL/oversized id) is rejected without
//   changing state. init() zeroes the struct first.
// ===========================================================================
#include <stdbool.h>

enum { R2D_SECRET_HIDDEN = 0, R2D_SECRET_FOUND = 1 };

typedef struct {
    char id[64];              // authored semantic id, bounded
    float x, y, radius;       // XY cylinder footprint
    float bottom, top;        // vertical interval, inclusive
    bool once;                // one-shot flag
    bool entered;             // inside-volume edge state
    bool found;               // sticky found flag
    int found_count;          // successful entries
    float timer;              // presentation: seconds since the latest find
} R2DWorldSecret;

typedef struct {
    char id[64];              // authored semantic id, bounded
    int hp;                   // remaining hit points, clamped at 0
    int max_hp;               // configured hit points
    bool broken;              // sticky broken transition
    int variant;              // authored intact variant index
    int portal;               // authored portal index, -1 = none
    float x, y, radius;       // authored hit proxy, XY cylinder
    float bottom, top;        // authored hit proxy vertical interval
} R2DWorldBreakable;

// Configure and reset a secret. On success: id/volume/once are stored,
// entered=false, found=false, found_count=0, timer=0.
bool r2d_world_secret_init(R2DWorldSecret *secret, const char *id,
                           float x, float y, float radius,
                           float bottom, float top, bool once);

// Player/actor point at (x,y) with feet height. Returns 1 exactly on a
// successful find transition (outside -> inside, and once/one-shot allows it),
// otherwise 0. Invalid input returns 0 without changing state.
int r2d_world_secret_touch(R2DWorldSecret *secret, float x, float y, float feet);

// R2D_SECRET_HIDDEN / R2D_SECRET_FOUND. NULL and invalid structs report HIDDEN.
int r2d_world_secret_state(const R2DWorldSecret *secret);

// Presentation timer: while found, advances by dt clamped to [0,0.25] and caps
// at 3600 s. Non-finite or non-positive dt is ignored. NULL is a no-op.
void r2d_world_secret_step(R2DWorldSecret *secret, float dt);

// Restore runtime state after init: entered=false, found=false, found_count=0,
// timer=0. Configuration and id are preserved. NULL is a no-op.
void r2d_world_secret_reset(R2DWorldSecret *secret);

// Configure and reset an authored breakable. On success hp=max_hp, broken=false.
bool r2d_world_breakable_init(R2DWorldBreakable *breakable, const char *id,
                              int hp, int variant, int portal,
                              float x, float y, float radius,
                              float bottom, float top);

// Apply damage. Returns 1 when this call performs the hp -> 0 break transition,
// 0 for ordinary damage/no-op/already broken, -1 for invalid input.
int r2d_world_breakable_hit(R2DWorldBreakable *breakable, int damage);

// Restore runtime state after init: hp=max_hp, broken=false. Configuration,
// id, variant and portal are preserved. NULL is a no-op.
void r2d_world_breakable_reset(R2DWorldBreakable *breakable);
