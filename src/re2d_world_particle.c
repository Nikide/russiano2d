#include "re2d_world_particle.h"

#include <limits.h>
#include <math.h>
#include <stddef.h>
#include <string.h>

// Pure particle pool. The only state is the caller-owned pool + storage; there
// is no allocation, no globals and no clock. Every call is a deterministic
// function of the arguments and the previous calls (seed included).

static bool finite3(float a, float b, float c)
{
    return isfinite(a) && isfinite(b) && isfinite(c);
}

// Reject prototypes that would poison the simulation. life is intentionally not
// checked: the emitter ignores it and always spawns with max_life.
static bool prototype_valid(const R2DWorldParticle *p)
{
    if (!finite3(p->x, p->y, p->h)) return false;
    if (!finite3(p->vx, p->vy, p->vh)) return false;
    if (!isfinite(p->max_life) || !(p->max_life > 0.0f)) return false;
    if (!isfinite(p->size) || p->size < 0.0f) return false;
    if (!finite3(p->rotation, p->spin, p->gravity)) return false;
    if (!isfinite(p->drag)) return false;
    if (!finite3(p->end_size, p->end_alpha, p->alpha)) return false;
    if (!finite3(p->r, p->g, p->b)) return false;
    if (p->frames < 0) return false;
    if (p->mode < R2D_PARTICLE_SCREEN || p->mode > R2D_PARTICLE_FLOOR) return false;
    if (p->blend < R2D_PARTICLE_MASKED || p->blend > R2D_PARTICLE_ADDITIVE) return false;
    if (p->collision < R2D_PARTICLE_COLLIDE_NONE || p->collision > R2D_PARTICLE_COLLIDE_DESPAWN) return false;
    if (!isfinite(p->bounce) || p->bounce < 0.0f || p->bounce > 1.0f) return false;
    if (!isfinite(p->radius) || p->radius < 0.0f) return false;
    return true;
}

// Every float that step() reads must be finite, otherwise the particle is
// dropped instead of letting NaN/Inf propagate through the pool.
static bool particle_sane(const R2DWorldParticle *p)
{
    return finite3(p->x, p->y, p->h) &&
           finite3(p->vx, p->vy, p->vh) &&
           finite3(p->life, p->max_life, p->size) &&
           finite3(p->rotation, p->spin, p->gravity) &&
           finite3(p->drag, p->start_size, p->start_alpha) &&
           finite3(p->end_size, p->end_alpha, p->r) &&
           finite3(p->g, p->b, p->alpha) &&
           isfinite(p->bounce) && isfinite(p->radius) &&
           p->collision >= R2D_PARTICLE_COLLIDE_NONE &&
           p->collision <= R2D_PARTICLE_COLLIDE_DESPAWN &&
           p->max_life > 0.0f;
}

bool r2d_world_particle_pool_init(R2DWorldParticlePool *pool,
                                  R2DWorldParticle *storage, int capacity)
{
    if (!pool) return false;
    memset(pool, 0, sizeof(*pool));
    if (!storage) return false;
    if (capacity < 1 || capacity > R2D_WORLD_PARTICLE_MAX_CAPACITY) return false;

    memset(storage, 0, sizeof(*storage) * (size_t)capacity);
    pool->items = storage;
    pool->capacity = capacity;
    pool->count = 0;
    pool->overflow = 0;
    pool->start = 0;
    pool->peak = 0;
    pool->seed = R2D_WORLD_PARTICLE_DEFAULT_SEED;
    return true;
}

void r2d_world_particle_clear(R2DWorldParticlePool *pool)
{
    if (!pool) return;
    if (pool->items && pool->capacity > 0)
        memset(pool->items, 0, sizeof(*pool->items) * (size_t)pool->capacity);
    pool->count = 0;
    pool->overflow = 0;
    pool->start = 0;
    pool->peak = 0;
    // seed is deliberately preserved: a clear restarts the scene, not the RNG.
}

float r2d_world_particle_random(R2DWorldParticlePool *pool)
{
    if (!pool || pool->capacity < 1) return 0.0f;
    // Numerical Recipes LCG; unsigned overflow is defined and bit-stable.
    pool->seed = pool->seed * 1664525u + 1013904223u;
    // Top 24 bits -> [0,1). Value 1.0f is impossible.
    return (float)((pool->seed >> 8) & 0x00FFFFFFu) * (1.0f / 16777216.0f);
}

static void spawn_slot(R2DWorldParticlePool *pool, int slot,
                       const R2DWorldParticle *prototype,
                       float vx, float vy, float vh)
{
    R2DWorldParticle *p = &pool->items[slot];
    memset(p, 0, sizeof(*p));

    p->x = prototype->x;
    p->y = prototype->y;
    p->h = prototype->h;
    p->vx = vx;
    p->vy = vy;
    p->vh = vh;
    p->life = prototype->max_life;
    p->max_life = prototype->max_life;
    p->size = prototype->size;
    p->rotation = prototype->rotation;
    p->spin = prototype->spin;
    p->gravity = prototype->gravity;
    p->drag = prototype->drag;
    p->start_size = prototype->size;
    p->end_size = prototype->end_size;
    p->start_alpha = prototype->alpha;
    if (p->start_alpha < 0.0f) p->start_alpha = 0.0f;
    if (p->start_alpha > 1.0f) p->start_alpha = 1.0f;
    p->end_alpha = prototype->end_alpha;
    p->alpha = p->start_alpha;
    p->frame = prototype->frame;
    p->frames = prototype->frames;
    p->blend = prototype->blend;
    p->mode = prototype->mode;
    p->r = prototype->r;
    p->g = prototype->g;
    p->b = prototype->b;
    p->active = true;
    p->world_space = prototype->world_space;
    p->collision = prototype->collision;
    p->bounce = prototype->bounce;
    p->radius = prototype->radius;
}

// Insert one particle into the ring. When full, the oldest slot (ring head) is
// overwritten and the head advances; survivors are never moved, so eviction is
// O(1) and logical age order is preserved by the accessors.
static void pool_spawn(R2DWorldParticlePool *pool, const R2DWorldParticle *prototype,
                       float vx, float vy, float vh)
{
    int slot;
    if (pool->start < 0 || pool->start >= pool->capacity) pool->start = 0;
    if (pool->count < pool->capacity) {
        slot = pool->start + pool->count;
        if (slot >= pool->capacity) slot -= pool->capacity;
        pool->count += 1;
        if (pool->count > pool->peak) pool->peak = pool->count;
    } else {
        slot = pool->start;
        pool->start += 1;
        if (pool->start >= pool->capacity) pool->start = 0;
        if (pool->overflow < INT_MAX) pool->overflow += 1;
    }
    spawn_slot(pool, slot, prototype, vx, vy, vh);
}

// Normalized base direction; a zero vector contributes no directional boost.
static void base_direction(float dx, float dy, float dh, float *out_x, float *out_y, float *out_h)
{
    double len = sqrt((double)dx * (double)dx + (double)dy * (double)dy + (double)dh * (double)dh);
    if (len > 0.0) {
        *out_x = (float)((double)dx / len);
        *out_y = (float)((double)dy / len);
        *out_h = (float)((double)dh / len);
    } else {
        *out_x = 0.0f;
        *out_y = 0.0f;
        *out_h = 0.0f;
    }
}

static void jitter_velocity(R2DWorldParticlePool *pool, const R2DWorldParticle *prototype,
                            float spread, float speed, float bx, float by, float bh,
                            float *vx, float *vy, float *vh)
{
    float jx = (r2d_world_particle_random(pool) * 2.0f - 1.0f) * spread;
    float jy = (r2d_world_particle_random(pool) * 2.0f - 1.0f) * spread;
    float jh = (r2d_world_particle_random(pool) * 2.0f - 1.0f) * spread;
    *vx = prototype->vx + bx * speed + jx;
    *vy = prototype->vy + by * speed + jy;
    *vh = prototype->vh + bh * speed + jh;
}

int r2d_world_particle_emit_burst(R2DWorldParticlePool *pool,
                                  const R2DWorldParticle *prototype,
                                  int count, float spread, float speed,
                                  float dir_x, float dir_y, float dir_h)
{
    if (!pool || !prototype) return -1;
    if (!pool->items || pool->capacity < 1) return -1;
    if (count <= 0) return 0;
    if (!prototype_valid(prototype)) return -1;
    if (!isfinite(spread) || spread < 0.0f || !isfinite(speed)) return -1;
    if (!finite3(dir_x, dir_y, dir_h)) return -1;
    // Per-call safety cap: keeps one JS/native call's loop bounded.
    if (count > 1000000) count = 1000000;
    if (pool->count < 0) pool->count = 0;
    if (pool->count > pool->capacity) pool->count = pool->capacity;
    if (pool->start < 0 || pool->start >= pool->capacity) pool->start = 0;

    float bx, by, bh;
    base_direction(dir_x, dir_y, dir_h, &bx, &by, &bh);

    for (int i = 0; i < count; ++i) {
        float vx, vy, vh;
        jitter_velocity(pool, prototype, spread, speed, bx, by, bh, &vx, &vy, &vh);
        pool_spawn(pool, prototype, vx, vy, vh);
    }
    return count;
}

int r2d_world_particle_emit_continuous(R2DWorldParticlePool *pool,
                                       const R2DWorldParticle *prototype,
                                       float dt, float rate,
                                       float spread, float speed,
                                       float dir_x, float dir_y, float dir_h,
                                       float *accumulator)
{
    if (!pool || !prototype || !accumulator) return -1;
    if (!pool->items || pool->capacity < 1) return -1;
    if (!prototype_valid(prototype)) return -1;
    if (!isfinite(spread) || spread < 0.0f || !isfinite(speed)) return -1;
    if (!finite3(dir_x, dir_y, dir_h)) return -1;
    if (!isfinite(dt) || !isfinite(rate) || rate < 0.0f) return -1;
    if (!isfinite(*accumulator)) return -1;
    if (pool->count < 0) pool->count = 0;
    if (pool->count > pool->capacity) pool->count = pool->capacity;
    if (pool->start < 0 || pool->start >= pool->capacity) pool->start = 0;

    if (dt < 0.0f) dt = 0.0f;
    if (dt > 0.25f) dt = 0.25f;

    // Double intermediate + small tolerance: 60 Hz * 60/s must yield exactly
    // one particle per call despite float rounding.
    double acc = (double)*accumulator + (double)rate * (double)dt;
    if (acc < 0.0) acc = 0.0;
    double whole = floor(acc + 1e-4);
    if (whole > 1000000.0) whole = 1000000.0;
    int to_spawn = (int)whole;
    *accumulator = (float)(acc - whole);
    if (*accumulator < 0.0f) *accumulator = 0.0f;

    if (to_spawn <= 0) return 0;

    float bx, by, bh;
    base_direction(dir_x, dir_y, dir_h, &bx, &by, &bh);

    for (int i = 0; i < to_spawn; ++i) {
        float vx, vy, vh;
        jitter_velocity(pool, prototype, spread, speed, bx, by, bh, &vx, &vy, &vh);
        pool_spawn(pool, prototype, vx, vy, vh);
    }
    return to_spawn;
}

static float particle_span(const R2DWorldParticle *p)
{
    float extent = p->size;
    if (!(extent > 0.0f)) extent = 0.01f;
    return extent;
}

// Resolve one particle's collision after integration. Returns false when the
// particle must despawn on contact. `old_*` is the pre-integration position.
static bool particle_collide(const R2DWorldParticleCollision *collision,
                             R2DWorldParticle *p,
                             float old_x,float old_y,float old_h)
{
    if (!collision || !collision->support || !collision->blocked) return true;
    if (p->collision == R2D_PARTICLE_COLLIDE_NONE) return true;

    const bool wall_mode = p->collision == R2D_PARTICLE_COLLIDE_WALL ||
                           p->collision == R2D_PARTICLE_COLLIDE_BOUNCE ||
                           p->collision == R2D_PARTICLE_COLLIDE_DESPAWN;
    const bool floor_mode = p->collision == R2D_PARTICLE_COLLIDE_FLOOR ||
                            p->collision == R2D_PARTICLE_COLLIDE_BOUNCE ||
                            p->collision == R2D_PARTICLE_COLLIDE_DESPAWN;

    if (wall_mode) {
        float bottom = old_h < p->h ? old_h : p->h;
        float top = (old_h > p->h ? old_h : p->h) + particle_span(p);
        if (!(top > bottom)) top = bottom + 0.01f;
        const float radius = p->radius;
        if (collision->blocked(collision->user,p->x,p->y,radius,bottom,top)) {
            if (p->collision == R2D_PARTICLE_COLLIDE_DESPAWN) return false;
            const bool block_x = collision->blocked(collision->user,p->x,old_y,radius,bottom,top);
            const bool block_y = collision->blocked(collision->user,old_x,p->y,radius,bottom,top);
            if (block_x && block_y) {
                p->x = old_x; p->y = old_y;
                if (p->collision == R2D_PARTICLE_COLLIDE_BOUNCE) {
                    p->vx = -p->vx * p->bounce;
                    p->vy = -p->vy * p->bounce;
                } else {
                    p->vx = 0.0f; p->vy = 0.0f;
                }
            } else if (block_x) {
                p->x = old_x;
                if (p->collision == R2D_PARTICLE_COLLIDE_BOUNCE) p->vx = -p->vx * p->bounce;
                else p->vx = 0.0f;
            } else if (block_y) {
                p->y = old_y;
                if (p->collision == R2D_PARTICLE_COLLIDE_BOUNCE) p->vy = -p->vy * p->bounce;
                else p->vy = 0.0f;
            } else {
                // Diagonal corner: neither single-axis step is blocked, but the
                // combined step is. Reject the step instead of tunnelling.
                p->x = old_x; p->y = old_y;
                if (p->collision != R2D_PARTICLE_COLLIDE_BOUNCE) {
                    p->vx = 0.0f; p->vy = 0.0f;
                }
            }
        }
    }

    if (floor_mode) {
        float floor = 0.0f, ceiling = 0.0f;
        if (collision->support(collision->user,p->x,p->y,p->h,&floor,&ceiling) &&
            isfinite(floor) && isfinite(ceiling) && p->h < floor) {
            if (p->collision == R2D_PARTICLE_COLLIDE_DESPAWN) return false;
            p->h = floor;
            if (p->vh < 0.0f) {
                if (p->collision == R2D_PARTICLE_COLLIDE_BOUNCE) {
                    p->vh = -p->vh * p->bounce;
                    if (p->vh < 1e-4f) p->vh = 0.0f;
                } else {
                    p->vh = 0.0f;
                }
            }
        }
    }
    return true;
}

void r2d_world_particle_step_collide(R2DWorldParticlePool *pool, float dt,
                                     const R2DWorldParticleCollision *collision)
{
    if (!pool || !pool->items || pool->capacity < 1) return;
    if (!isfinite(dt) || dt <= 0.0f) return;
    if (dt > 0.25f) dt = 0.25f;

    if (pool->count < 0) pool->count = 0;
    if (pool->count > pool->capacity) pool->count = pool->capacity;
    if (pool->start < 0 || pool->start >= pool->capacity) pool->start = 0;

    // Compact expired particles in logical age order. The ring head stays put;
    // survivors are copied down within the logical range (O(live) per step and
    // no shift on emit/eviction).
    int write = 0;
    for (int i = 0; i < pool->count; ++i) {
        int slot = pool->start + i;
        if (slot >= pool->capacity) slot -= pool->capacity;
        R2DWorldParticle *p = &pool->items[slot];
        if (!p->active) continue;
        if (!particle_sane(p) || p->life <= 0.0f) {
            p->active = false;
            continue;
        }

        float remaining = p->life;
        float use = dt < remaining ? dt : remaining;

        float drag = p->drag;
        if (!(drag > 0.0f)) drag = 0.0f;
        if (drag > 32.0f) drag = 32.0f;
        if (drag > 0.0f) {
            float damping = (float)exp(-(double)drag * (double)use);
            p->vx *= damping;
            p->vy *= damping;
            p->vh *= damping;
        }
        if (p->mode != R2D_PARTICLE_SCREEN) p->vh += p->gravity * use;

        const float old_x = p->x, old_y = p->y, old_h = p->h;
        p->x += p->vx * use;
        p->y += p->vy * use;
        p->h += p->vh * use;
        p->rotation += p->spin * use;

        if (!particle_collide(collision,p,old_x,old_y,old_h)) {
            p->active = false;
            continue;
        }

        p->life -= use;
        float fraction;
        if (p->life <= 0.0f) {
            p->life = 0.0f;
            p->active = false;
            fraction = 1.0f;
        } else {
            fraction = 1.0f - p->life / p->max_life;
            if (fraction < 0.0f) fraction = 0.0f;
            if (fraction > 1.0f) fraction = 1.0f;
        }

        if (p->end_size >= 0.0f)
            p->size = p->start_size + (p->end_size - p->start_size) * fraction;
        else
            p->size = p->start_size;
        if (!(p->size >= 0.0f)) p->size = 0.0f;

        if (p->end_alpha >= 0.0f)
            p->alpha = p->start_alpha + (p->end_alpha - p->start_alpha) * fraction;
        else
            p->alpha = p->start_alpha;
        if (p->alpha < 0.0f) p->alpha = 0.0f;
        if (p->alpha > 1.0f) p->alpha = 1.0f;

        if (p->frames > 0) {
            int frame = (int)(fraction * (float)p->frames);
            if (frame >= p->frames) frame = p->frames - 1;
            if (frame < 0) frame = 0;
            p->frame = frame;
        }

        if (p->active) {
            if (write != i) {
                int wslot = pool->start + write;
                if (wslot >= pool->capacity) wslot -= pool->capacity;
                pool->items[wslot] = *p;
            }
            write += 1;
        }
    }
    pool->count = write;
}

void r2d_world_particle_step(R2DWorldParticlePool *pool, float dt)
{
    r2d_world_particle_step_collide(pool,dt,NULL);
}

int r2d_world_particle_alive(const R2DWorldParticlePool *pool)
{
    if (!pool || !pool->items || pool->capacity < 1) return 0;
    int count = pool->count;
    if (count < 0) return 0;
    if (count > pool->capacity) count = pool->capacity;
    int alive = 0;
    for (int i = 0; i < count; ++i) {
        const R2DWorldParticle *p = r2d_world_particle_at(pool, i);
        if (p && p->active) alive += 1;
    }
    return alive;
}

const R2DWorldParticle *r2d_world_particle_at(const R2DWorldParticlePool *pool, int index)
{
    if (!pool || !pool->items || pool->capacity < 1) return NULL;
    if (index < 0 || index >= pool->count) return NULL;
    int slot = pool->start + index;
    if (slot >= pool->capacity) slot -= pool->capacity;
    return &pool->items[slot];
}

R2DWorldParticle *r2d_world_particle_at_mut(R2DWorldParticlePool *pool, int index)
{
    return (R2DWorldParticle *)r2d_world_particle_at(pool, index);
}
