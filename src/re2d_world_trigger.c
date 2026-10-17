#include "re2d_world_trigger.h"

#include <limits.h>
#include <math.h>
#include <stddef.h>
#include <string.h>

// Pure trigger state machine. No allocation, no globals, no clock reads: the
// only state is the caller-owned R2DWorldTrigger.

static bool finite3(float a, float b, float c)
{
    return isfinite(a) && isfinite(b) && isfinite(c);
}

static bool xy_inside(const R2DWorldTrigger *t, float x, float y)
{
    // Double intermediates keep the squared test finite even for huge floats.
    double dx = (double)x - (double)t->x;
    double dy = (double)y - (double)t->y;
    double r = (double)t->radius;
    return dx * dx + dy * dy <= r * r;
}

static bool height_inside(const R2DWorldTrigger *t, float h)
{
    return h >= t->bottom && h <= t->top;
}

// Central ready/fire rule: enabled, one-shot not spent, cooldown elapsed.
// Applies to enter/use/shoot alike.
static bool trigger_fire(R2DWorldTrigger *t)
{
    if (!t->enabled) return false;
    if (t->once && t->fire_count > 0) return false;
    if (t->timer > 0.0f) return false;

    if (t->fire_count < INT_MAX) t->fire_count += 1;
    if (t->cooldown > 0.0f) t->timer = t->cooldown;
    if (t->once) t->enabled = 0;
    return true;
}

bool r2d_world_trigger_init(R2DWorldTrigger *trigger, int type, const char *id, const char *target,
                            float x, float y, float radius, float bottom, float top,
                            bool once, float cooldown)
{
    if (!trigger) return false;
    memset(trigger, 0, sizeof(*trigger));
    if (!id) return false;
    if (type != R2D_TRIGGER_ENTER && type != R2D_TRIGGER_USE && type != R2D_TRIGGER_SHOOT) return false;
    if (!finite3(x, y, radius) || !finite3(bottom, top, cooldown)) return false;
    if (!(radius > 0.0f) || !(top > bottom) || !(cooldown >= 0.0f)) return false;

    // Bounded scan: reject ids of 64+ bytes instead of truncating them.
    size_t len = 0;
    while (len < sizeof(trigger->id) - 1u && id[len] != '\0') len += 1u;
    if (id[len] != '\0') return false;

    trigger->type = type;
    trigger->x = x;
    trigger->y = y;
    trigger->radius = radius;
    trigger->bottom = bottom;
    trigger->top = top;
    trigger->once = once ? 1 : 0;
    trigger->cooldown = cooldown;
    trigger->enabled = 1;
    trigger->target = target;
    memcpy(trigger->id, id, len + 1u);
    trigger->fire_count = 0;
    trigger->user_data = 0;
    trigger->timer = 0.0f;
    trigger->armed = false;
    return true;
}

void r2d_world_trigger_step(R2DWorldTrigger *trigger, float dt)
{
    if (!trigger) return;
    if (!isfinite(dt) || dt <= 0.0f) return;
    if (dt > 0.25f) dt = 0.25f;

    if (trigger->timer > 0.0f) {
        if (trigger->timer <= dt) trigger->timer = 0.0f;
        else trigger->timer -= dt;
    } else {
        trigger->timer = 0.0f;
    }
}

bool r2d_world_trigger_enter(R2DWorldTrigger *trigger, float x, float y, float feet)
{
    if (!trigger) return false;
    if (trigger->type != R2D_TRIGGER_ENTER) return false;
    if (!finite3(x, y, feet)) return false;

    if (!xy_inside(trigger, x, y) || !height_inside(trigger, feet)) {
        trigger->armed = false; // leaving the volume re-arms the trigger
        return false;
    }
    if (trigger->armed) return false; // no repeat while standing inside
    trigger->armed = true;
    return trigger_fire(trigger);
}

bool r2d_world_trigger_use(R2DWorldTrigger *trigger, float x, float y, float h)
{
    if (!trigger) return false;
    if (trigger->type != R2D_TRIGGER_USE) return false;
    if (!finite3(x, y, h)) return false;
    if (!xy_inside(trigger, x, y) || !height_inside(trigger, h)) return false;
    return trigger_fire(trigger);
}

bool r2d_world_trigger_shoot(R2DWorldTrigger *trigger, float x, float y, float h, float radius)
{
    if (!trigger) return false;
    if (trigger->type != R2D_TRIGGER_SHOOT) return false;
    if (!finite3(x, y, h) || !isfinite(radius) || radius < 0.0f) return false;

    double dx = (double)x - (double)trigger->x;
    double dy = (double)y - (double)trigger->y;
    double reach = (double)trigger->radius + (double)radius;
    if (dx * dx + dy * dy > reach * reach) return false;
    if (!height_inside(trigger, h)) return false;
    return trigger_fire(trigger);
}

void r2d_world_trigger_reset(R2DWorldTrigger *trigger)
{
    if (!trigger) return;
    trigger->enabled = 1;
    trigger->timer = 0.0f;
    trigger->fire_count = 0;
    trigger->armed = false;
}
