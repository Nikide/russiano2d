#pragma once
// ===========================================================================
// Re2D: native particle pool (P1, roadmap sections 20/21/108).
//
// Pure data-oriented 2.5D particle simulation: no rendering, no textures, no
// world ownership, no audio, no ECS, no mesh. The caller owns the storage array
// and the prototypes; a runtime later feeds this pool and draws the particles.
// No allocation happens here: init only binds caller storage, and emit/step
// never call malloc/free. No globals and no clock reads.
//
// Constrained primitive: every particle is a screen/world billboard point with
// (x,y) in the map plane and a separate height h. Modes and blends are hints
// for the future renderer; this module only integrates motion and lifetime.
//
// Semantics (exact)
// ----------------
// * Pool: init() zeroes the pool and storage, stores [storage,storage+capacity),
//   sets count=overflow=peak=0, start=0 and seed=R2D_WORLD_PARTICLE_DEFAULT_SEED.
//   capacity must be 1..R2D_WORLD_PARTICLE_MAX_CAPACITY (1,048,576; the pool is
//   caller-allocated, so a larger capacity is refused explicitly instead of
//   being silently clamped). The caller may overwrite pool->seed before
//   emitting. clear() drops all particles and resets overflow/peak but
//   PRESERVES seed.
// * Storage layout: storage is a RING buffer. `start` is the physical slot of
//   the oldest live particle; the active particles are the logical range
//   [0,count) in age order (oldest first). There are no holes and logical order
//   is stable across calls, but logical index i is NOT necessarily physical
//   slot i: use r2d_world_particle_at(pool,i) /
//   r2d_world_particle_at_mut(pool,i), and iterate i in [0,count).
//   items[start+i mod capacity] is the storage mapping. Direct packed-range
//   iteration (items[0..count)) is no longer valid for a wrapped ring.
// * Eviction: when count == capacity a new particle overwrites the OLDEST
//   particle. The ring head advances by one slot (O(1)); no other particle is
//   moved, so age order is preserved through the accessors. overflow counts
//   every evicted particle (saturating at INT_MAX) and is the "evicted"
//   telemetry counter; peak is the high-water mark of count since init/clear.
//   Cost is O(1) per eviction regardless of capacity.
// * Emission: emit bursts/continuous streams into the pool. The prototype is
//   copied per particle; prototype.life is IGNORED and life is set to
//   prototype.max_life (which must be > 0). mode must be 0..3 and blend 0..2.
//   size >= 0, alpha in [0,1] (clamped), frames >= 0. All values must be finite.
//   end_size / end_alpha are optional linear curve endpoints: a negative value
//   means "hold the spawn value"; 0 is a real endpoint (e.g. end_alpha=0 fades
//   out, end_size=0 shrinks to nothing).
//   Velocity per spawned particle is
//       v = prototype.v + normalize(dir) * speed
//           + (random()*2-1) * spread                    (each of vx,vy,vh)
//   so spread is an absolute velocity jitter half-range (>= 0), not an angle.
//   A zero dir adds no directional velocity. Random draws are consumed only
//   for particles actually spawned, so count<=0 is a strict no-op (returns 0,
//   seed unchanged). Returns the number spawned, or -1 on invalid arguments
//   (NULL pool/prototype/storage, bad capacity, non-finite/out-of-range input)
//   without touching the pool.
// * Continuous: caller owns a float accumulator (initialize to 0). Each call
//   adds rate*dt (dt clamped to 0..0.25; rate >= 0) and spawns whole particles,
//   keeping the fractional remainder in *accumulator. A 1e-4 tolerance prevents
//   float rounding from losing a whole particle. Returns the number spawned or
//   -1 on invalid arguments. Emission (burst and continuous) is capped at
//   1,000,000 particles per call to keep loops bounded; the remainder / surplus
//   is dropped past that cap.
// * Deterministic: one shared 32-bit LCG (Numerical Recipes constants) advanced
//   three times per spawned particle. The same seed plus the same call sequence
//   produces bit-identical particles. r2d_world_particle_random() returns a
//   float in [0,1).
// * step(): dt is clamped to 0..0.25; non-finite or dt<=0 is a no-op. Per
//   particle (semi-implicit Euler, dt'=min(dt,life)):
//       if drag>0: v *= exp(-clamp(drag,0,32)*dt')     (all components)
//       if mode != SCREEN: vh += gravity*dt'          (gravity only on h)
//       x += vx*dt'; y += vy*dt'; h += vh*dt'
//       rotation += spin*dt'
//       life -= dt'; at life<=0 the particle expires and is compacted out
//   size/alpha are linear in life fraction f=1-life/max_life:
//       size = end_size  >= 0 ? start_size +(end_size -start_size )*f : start
//       alpha= end_alpha >= 0 ? start_alpha+(end_alpha-start_alpha)*f : start
//   alpha is clamped to [0,1], size to >=0. With frames>0,
//   frame = min((int)(f*frames), frames-1). world_space is copied for the
//   renderer and has no simulation effect.
// * NaN safety: a particle whose stored float fields become non-finite is
//   dropped by step() instead of poisoning the pool; invalid emitter input is
//   rejected. No operation reads past items[0..capacity) or count.
// * alive() counts the active particles in the logical range [0,count) through
//   the ring mapping; NULL pool returns 0.
// ===========================================================================
#include <stdbool.h>
#include <stdint.h>

// Caller-allocated storage ceiling. This is an explicit sanity bound, not a
// quality target: the runtime default is 2048 and Low/Medium/High quality map
// to 512/2048/8192 (see r2d_world_particles_set_capacity).
#define R2D_WORLD_PARTICLE_MAX_CAPACITY (1 << 20)
#define R2D_WORLD_PARTICLE_DEFAULT_SEED 0x9E3779B9u

enum {
    R2D_PARTICLE_SCREEN    = 0, // screen-space sprite; gravity is ignored
    R2D_PARTICLE_BILLBOARD = 1, // world billboard facing the camera
    R2D_PARTICLE_AXIS      = 2, // axis-locked billboard
    R2D_PARTICLE_FLOOR     = 3  // floor streak / decal-like
};

enum {
    R2D_PARTICLE_MASKED     = 0,
    R2D_PARTICLE_TRANSLUCENT = 1,
    R2D_PARTICLE_ADDITIVE   = 2
};

// P1 VFX collision modes. NONE keeps the original free-flight step; FLOOR
// clamps h to the support; WALL rejects a blocked XY step; BOUNCE reflects the
// blocked axis with `bounce` restitution and bounces on the floor; DESPAWN
// deactivates the particle on the first contact. All modes are point-based
// (particles are constrained 2.5D points, not rigid bodies).
enum {
    R2D_PARTICLE_COLLIDE_NONE = 0,
    R2D_PARTICLE_COLLIDE_FLOOR = 1,
    R2D_PARTICLE_COLLIDE_WALL = 2,
    R2D_PARTICLE_COLLIDE_BOUNCE = 3,
    R2D_PARTICLE_COLLIDE_DESPAWN = 4
};

// Caller-provided world queries. Both callbacks return false when the query is
// unavailable at that point. `support` fills the floor/ceiling heights at XY;
// `blocked` answers a vertical cylinder overlap. This keeps the particle pool
// free of world/runtime dependencies (offline tests pass their own functions).
typedef struct R2DWorldParticleCollision {
    bool (*support)(void *user,float x,float y,float h,float *floor,float *ceiling);
    bool (*blocked)(void *user,float x,float y,float radius,float bottom,float top);
    void *user;
} R2DWorldParticleCollision;

typedef struct {
    // Position: x,y in the map plane, h is the separate height axis.
    float x, y, h;
    // Velocity in the same three axes; gravity acts only on vh.
    float vx, vy, vh;
    // Lifetime is counted down by step(); max_life is the spawn lifetime.
    float life, max_life, size, rotation, spin;
    // gravity: acceleration on h; drag: positive exponential damping 1/s.
    float gravity, drag;
    // Spawn snapshot of size/alpha, captured by the emitter for the curves.
    float start_size, start_alpha;
    // Optional curve endpoints (<0 = hold the spawn value).
    float end_size, end_alpha;
    // Renderer hints: animation frame, frame count, blend, particle mode.
    int frame, frames, blend, mode;
    // Color/alpha; alpha is curve-driven and clamped to [0,1].
    float r, g, b, alpha;
    bool active;      // pool-owned: false once expired/cleared
    bool world_space; // renderer hint only
    // P1 VFX collision (prototype fields copied by the emitter; 0 = NONE).
    int collision;    // R2D_PARTICLE_COLLIDE_*
    float bounce;     // restitution 0..1, BOUNCE mode
    float radius;     // wall probe radius, WALL/BOUNCE/DESPAWN modes
} R2DWorldParticle;

typedef struct {
    R2DWorldParticle *items; // borrowed caller storage (ring)
    int capacity, count, overflow;
    // Ring head: physical slot of logical particle 0 (the oldest live one).
    int start;
    // High-water mark of count since init/clear (telemetry).
    int peak;
    uint32_t seed;
} R2DWorldParticlePool;

// Bind caller-owned storage (capacity 1..R2D_WORLD_PARTICLE_MAX_CAPACITY) and
// reset the pool. Returns false for NULL pool/storage or bad capacity; a failed
// call leaves the pool zeroed (capacity/count/items = 0) so later calls are
// safe no-ops.
bool r2d_world_particle_pool_init(R2DWorldParticlePool *pool,
                                  R2DWorldParticle *storage, int capacity);

// Drop every particle and reset overflow; seed is preserved. NULL is a no-op.
void r2d_world_particle_clear(R2DWorldParticlePool *pool);

// Deterministic LCG output in [0,1). NULL/zero-capacity pool returns 0.
float r2d_world_particle_random(R2DWorldParticlePool *pool);

// Spawn up to `count` particles (see header semantics). Returns the number
// spawned, 0 for count<=0, or -1 for invalid pool/prototype/arguments.
int r2d_world_particle_emit_burst(R2DWorldParticlePool *pool,
                                  const R2DWorldParticle *prototype,
                                  int count, float spread, float speed,
                                  float dir_x, float dir_y, float dir_h);

// Rate-based emission with caller-owned fractional accumulator.
// Returns the number spawned or -1 on invalid arguments.
int r2d_world_particle_emit_continuous(R2DWorldParticlePool *pool,
                                       const R2DWorldParticle *prototype,
                                       float dt, float rate,
                                       float spread, float speed,
                                       float dir_x, float dir_y, float dir_h,
                                       float *accumulator);

// Integrate and compact the pool. dt is clamped to 0..0.25; non-finite dt is
// ignored. NULL is a no-op. This is the NONE-collision entry point.
void r2d_world_particle_step(R2DWorldParticlePool *pool, float dt);

// Same as r2d_world_particle_step, plus optional world collision queries for
// particles whose prototype has a collision mode. NULL collision = NONE for
// every particle. No allocation, no globals; deterministic for fixed input.
void r2d_world_particle_step_collide(R2DWorldParticlePool *pool, float dt,
                                     const R2DWorldParticleCollision *collision);

// Number of active particles; NULL returns 0.
int r2d_world_particle_alive(const R2DWorldParticlePool *pool);

// Ring-indexed accessors: logical index 0 is the oldest live particle and
// count-1 the newest. Returns NULL when pool is NULL, i is outside [0,count),
// or the pool is unbound. The pointer is valid until the next emit/step/clear.
const R2DWorldParticle *r2d_world_particle_at(const R2DWorldParticlePool *pool, int index);
R2DWorldParticle *r2d_world_particle_at_mut(R2DWorldParticlePool *pool, int index);

// --- Runtime integration ------------------------------------------------
// Defined by re2d_world_runtime.c; declared here so the capacity policy stays
// next to the pool API without making this header depend on runtime types.
// Set the runtime particle pool capacity (quality knob). Accepts
// 1..R2D_WORLD_PARTICLE_MAX_CAPACITY. The pool is reallocated only when empty
// (or not yet created); a request while particles are alive returns false and
// leaves the pool untouched. The existing per-frame particle_budget is kept
// unless it still equals the old capacity default. Returns true when the
// requested capacity is active.
struct R2DWorldRuntime;
bool r2d_world_particles_set_capacity(struct R2DWorldRuntime *runtime, int capacity);
