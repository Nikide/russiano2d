#include "re2d_world_secret.h"

#include <limits.h>
#include <math.h>
#include <string.h>

// Pure secret/breakable state machines. No allocation, no globals, no clock
// reads: the only state is the caller-owned struct.

static bool finite5(float a, float b, float c, float d, float e)
{
    return isfinite(a) && isfinite(b) && isfinite(c) && isfinite(d) && isfinite(e);
}

// Bounded copy: reject ids of 63+ bytes instead of truncating them. The
// destination must have room for 64 bytes including NUL.
static bool copy_id(char out[64], const char *id)
{
    size_t len = 0;
    if (!id) return false;
    while (len < 63u && id[len] != '\0') len += 1u;
    if (id[len] != '\0') return false;
    memcpy(out, id, len + 1u);
    return true;
}

static bool xy_inside(const R2DWorldSecret *s, float x, float y)
{
    // Double intermediates keep the squared test finite even for huge floats.
    double dx = (double)x - (double)s->x;
    double dy = (double)y - (double)s->y;
    double r = (double)s->radius;
    return dx * dx + dy * dy <= r * r;
}

static bool height_inside(const R2DWorldSecret *s, float feet)
{
    return feet >= s->bottom && feet <= s->top;
}

bool r2d_world_secret_init(R2DWorldSecret *secret, const char *id,
                           float x, float y, float radius,
                           float bottom, float top, bool once)
{
    if (!secret) return false;
    memset(secret, 0, sizeof(*secret));
    if (!copy_id(secret->id, id)) {
        memset(secret->id, 0, sizeof(secret->id));
        return false;
    }
    if (!finite5(x, y, radius, bottom, top)) {
        memset(secret, 0, sizeof(*secret));
        return false;
    }
    if (!(radius > 0.0f) || !(top > bottom)) {
        memset(secret, 0, sizeof(*secret));
        return false;
    }
    secret->x = x;
    secret->y = y;
    secret->radius = radius;
    secret->bottom = bottom;
    secret->top = top;
    secret->once = once;
    secret->entered = false;
    secret->found = false;
    secret->found_count = 0;
    secret->timer = 0.0f;
    return true;
}

int r2d_world_secret_touch(R2DWorldSecret *secret, float x, float y, float feet)
{
    if (!secret || !isfinite(x) || !isfinite(y) || !isfinite(feet)) return 0;
    if (!xy_inside(secret, x, y) || !height_inside(secret, feet)) {
        secret->entered = false; // leaving the volume re-arms it
        return 0;
    }
    if (secret->entered) return 0; // no repeat while standing inside
    secret->entered = true;
    if (secret->once && secret->found_count > 0) return 0;
    if (secret->found_count < INT_MAX) secret->found_count += 1;
    secret->found = true;
    secret->timer = 0.0f; // latest find restarts the presentation pulse
    return 1;
}

int r2d_world_secret_state(const R2DWorldSecret *secret)
{
    if (!secret || !secret->found) return R2D_SECRET_HIDDEN;
    return R2D_SECRET_FOUND;
}

void r2d_world_secret_step(R2DWorldSecret *secret, float dt)
{
    if (!secret || !isfinite(dt) || dt <= 0.0f) return;
    if (!secret->found) return;
    if (dt > 0.25f) dt = 0.25f;
    float next = secret->timer + dt;
    if (!isfinite(next) || next > 3600.0f) secret->timer = 3600.0f;
    else if (next < 0.0f) secret->timer = 0.0f;
    else secret->timer = next;
}

void r2d_world_secret_reset(R2DWorldSecret *secret)
{
    if (!secret) return;
    secret->entered = false;
    secret->found = false;
    secret->found_count = 0;
    secret->timer = 0.0f;
}

bool r2d_world_breakable_init(R2DWorldBreakable *breakable, const char *id,
                              int hp, int variant, int portal,
                              float x, float y, float radius,
                              float bottom, float top)
{
    if (!breakable) return false;
    memset(breakable, 0, sizeof(*breakable));
    if (!copy_id(breakable->id, id)) {
        memset(breakable->id, 0, sizeof(breakable->id));
        return false;
    }
    if (!finite5(x, y, radius, bottom, top)) {
        memset(breakable, 0, sizeof(*breakable));
        return false;
    }
    if (!(radius > 0.0f) || !(top > bottom) || hp <= 0 || variant < 0 || portal < -1) {
        memset(breakable, 0, sizeof(*breakable));
        return false;
    }
    breakable->hp = hp;
    breakable->max_hp = hp;
    breakable->broken = false;
    breakable->variant = variant;
    breakable->portal = portal;
    breakable->x = x;
    breakable->y = y;
    breakable->radius = radius;
    breakable->bottom = bottom;
    breakable->top = top;
    return true;
}

int r2d_world_breakable_hit(R2DWorldBreakable *breakable, int damage)
{
    if (!breakable || damage < 0) return -1;
    if (breakable->broken) return 0;
    // hp <= 0 without a recorded transition means zeroed/uninitialised state;
    // never emit a spurious break event for it.
    if (breakable->hp <= 0) return 0;
    if (damage >= breakable->hp) breakable->hp = 0;
    else breakable->hp -= damage;
    if (breakable->hp == 0) {
        breakable->broken = true;
        return 1;
    }
    return 0;
}

void r2d_world_breakable_reset(R2DWorldBreakable *breakable)
{
    if (!breakable) return;
    breakable->hp = breakable->max_hp;
    breakable->broken = false;
}
