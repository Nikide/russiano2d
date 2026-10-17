#pragma once
// ===========================================================================
// Re2D: pure fixed-tick mover timeline for doors, lifts, crushers, platforms.
//
// This is a deterministic, allocation-free state machine. It owns no geometry
// and never touches the world: a runtime copies `position` into the target
// span/portal height, then invalidates visibility/collision/light caches from
// the event bits returned by r2d_world_mover_step(). Heights are constrained
// Re2D span heights (vertical translation only) -- no mesh, no 3D, no ECS.
//
// Semantics
// ---------
// `from` is the closed/rest height, `to` is the open/raised height. `direction`
// is intent, not world axis: +1 always travels toward `to`, -1 toward `from`
// (so a ceiling mover with to<from still uses +1 to open). `fraction` is always
// 0 at `from` and 1 at `to`, and `position` is clamped to the [from,to]
// interval regardless of direction.
//
//   DOOR       Toggle/triggered. open() drives to `to`, close() to `from`,
//              toggle() flips. auto_return + wait>0 closes the door again after
//              dwelling fully open; wait==0 leaves it open.
//   LIFT       Same endpoints, but the intended cycle is open (up), dwell
//              `wait` seconds at `to`, then automatic return to `from` when
//              auto_return is set. wait==0 means stay at `to`. close() still
//              returns immediately on demand.
//   CRUSHER    With auto_return the mover reverses at both endpoints forever
//              (wait is the dwell at each end; wait==0 reverses immediately).
//              With auto_return=false it stops at the requested endpoint.
//   PLATFORM   Like a lift (auto-return to `from` after `wait`, then stop), but
//              semantically a generic moving floor/carriage.
//
// Phase / event rules
// -------------------
// - IDLE: parked. MOVING: travelling in `direction`. WAITING: parked at an
//   endpoint until `timer` (seconds) expires, then travel reverses toward the
//   opposite endpoint.
// - STARTED is emitted exactly once per launch/resume of motion (including the
//   automatic return after WAITING). It is returned on the next step even when
//   that step moves no distance.
// - ARRIVED is emitted once when motion toward `to` reaches `to`.
// - CLOSED is emitted once when motion toward `from` reaches `from` (including
//   auto-return), and when a cancelled opening finds itself already at `from`.
// - REOPENED is emitted once when an opening motion (toward `to`) starts from
//   the fully closed `from` endpoint. This includes the first opening; it is
//   the runtime's signal that the opening should become visible/traversable.
// - BLOCKED is emitted once on the rising edge of `blocking` while MOVING.
//   `blocking` is an input flag set by the runtime (passenger/actor contact):
//   position and fraction freeze, and for CRUSHER the direction flips so the
//   mover backs away. Clearing `blocking` resumes motion and emits STARTED
//   again. While WAITING, `blocking` is ignored (the wait timer keeps running).
//
// `r2d_world_mover_step` clamps dt into [0, 0.25] seconds. NaN dt behaves like
// 0; +infinity clamps to 0.25. Results depend only on the struct contents and
// the dt sequence, so identical fixed-step sequences are bit-identical.
//
// `blocking` is the only field a runtime may write directly (besides reading
// the computed state); all other state transitions go through the functions.
// The struct deliberately contains no private fields: negative `timer` values
// are internal latches while MOVING (-1 = start pending, -2 = blocked pause).
// ===========================================================================
#include <stdbool.h>

typedef enum {
    R2D_MOVER_DOOR = 0,
    R2D_MOVER_LIFT = 1,
    R2D_MOVER_CRUSHER = 2,
    R2D_MOVER_PLATFORM = 3
} R2DWorldMoverType;

typedef enum {
    R2D_MOVER_IDLE = 0,
    R2D_MOVER_MOVING,
    R2D_MOVER_WAITING
} R2DWorldMoverPhase;

// Event bit flags returned by r2d_world_mover_step().
enum {
    R2D_MOVER_EVENT_NONE = 0,
    R2D_MOVER_EVENT_STARTED = 1u << 0,   // motion launched or resumed
    R2D_MOVER_EVENT_ARRIVED = 1u << 1,   // reached `to`
    R2D_MOVER_EVENT_CLOSED = 1u << 2,    // reached `from`
    R2D_MOVER_EVENT_REOPENED = 1u << 3,  // opening started from `from`
    R2D_MOVER_EVENT_BLOCKED = 1u << 4    // blocking rose while MOVING
};

typedef struct {
    int type;                // R2DWorldMoverType
    int span;                // target span index (runtime validates it)
    float from, to;          // authored target heights, from != to
    float speed;             // units/second, > 0
    float wait;              // seconds at an end before auto-return (0 = stay)
    float position;          // current computed height, clamped to [from,to]
    float fraction;          // progress from->to, 0..1
    R2DWorldMoverPhase phase;
    int direction;           // +1 toward `to` (open/up), -1 toward `from`
    float timer;             // wait countdown (negative = internal latch)
    bool auto_return, arrived, blocking;
} R2DWorldMover;

// Validates type/span/speed/from/to/wait and initialises the mover parked at
// `from` (IDLE, fraction 0, arrived=true, direction +1, timer 0, blocking
// false). Returns false and leaves *m untouched for NULL, out-of-range type,
// negative span, equal endpoints, non-finite values, speed<=0 or wait<0.
bool r2d_world_mover_init(R2DWorldMover *m, int type, int span,
                          float from, float to, float speed, float wait,
                          bool auto_return);

// Advances the timeline by one fixed tick of at most 0.25 s. Returns true iff
// `position` (and therefore `fraction`) changed during the call; a tick that
// only expires a wait or emits BLOCKED returns false but still fills *events.
// `events` may be NULL. Invalid mover state returns false with *events = 0.
bool r2d_world_mover_step(R2DWorldMover *m, float dt, unsigned *events);

// Explicit user intents. Opening an already-open mover is a no-op (no event on
// later steps); closing an already-closed idle mover is likewise a no-op.
// Calling them while `blocking` changes direction but keeps the mover paused.
void r2d_world_mover_open(R2DWorldMover *m);
void r2d_world_mover_close(R2DWorldMover *m);
// Open->close, close->open; while already opening it cancels into a close,
// while already closing it cancels into an open.
void r2d_world_mover_toggle(R2DWorldMover *m);
