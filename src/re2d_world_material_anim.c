#include "re2d_world_material_anim.h"

#include <math.h>
#include <stddef.h>
#include <string.h>

// Pure material-animation timeline. No allocation, no globals, no clock reads.

#define R2D_MATERIAL_ANIM_TAU 6.28318530717958647692f

static uint32_t seed_mix(uint32_t value)
{
    // Deterministic 32-bit avalanche. Maps 0 to 0 on purpose: seed 0 is the
    // canonical unshifted animation.
    value ^= value >> 16;
    value *= 0x7feb352du;
    value ^= value >> 15;
    value *= 0x846ca68bu;
    value ^= value >> 16;
    return value;
}

static int seed_frame_impl(const R2DWorldMaterialAnim *anim)
{
    if (anim->frames <= 1) return 0;
    return (int)(seed_mix(anim->seed) % (uint32_t)anim->frames);
}

// Wrap a possibly-negative accumulated scroll to [0,1). Double intermediates
// keep large scroll*dt products finite before the cast back to float.
static float wrap_unit(double value)
{
    double wrapped = fmod(value, 1.0);
    if (!isfinite(wrapped)) return 0.0f;
    if (wrapped < 0.0) wrapped += 1.0;
    return (float)wrapped;
}

bool r2d_world_material_anim_init(R2DWorldMaterialAnim *anim, int frames, float fps, bool ping_pong,
                                  uint32_t seed, float scroll_u, float scroll_v,
                                  float pulse_hz, float pulse_amount)
{
    if (!anim) return false;
    memset(anim, 0, sizeof(*anim));
    if (frames < 1 || frames > 64) return false;
    if (!isfinite(fps) || !(fps > 0.0f)) return false;
    if (!isfinite(scroll_u) || !isfinite(scroll_v)) return false;
    if (!isfinite(pulse_hz) || !(pulse_hz >= 0.0f)) return false;
    if (!isfinite(pulse_amount) || !(pulse_amount >= 0.0f)) return false;

    anim->frames = frames;
    anim->fps = fps;
    anim->ping_pong = ping_pong;
    anim->seed = seed;
    anim->scroll_u = scroll_u;
    anim->scroll_v = scroll_v;
    anim->pulse_hz = pulse_hz;
    anim->pulse_amount = pulse_amount;
    anim->u_offset = 0.0f;
    anim->v_offset = 0.0f;
    anim->phase = 0.0f;
    return true;
}

void r2d_world_material_anim_step(R2DWorldMaterialAnim *anim, float dt)
{
    if (!anim) return;
    if (!isfinite(dt) || dt <= 0.0f) return;
    if (dt > 0.25f) dt = 0.25f;

    anim->phase += dt;
    if (!isfinite(anim->phase)) anim->phase = 0.0f; // overflow safety guard

    anim->u_offset = wrap_unit((double)anim->u_offset + (double)anim->scroll_u * (double)dt);
    anim->v_offset = wrap_unit((double)anim->v_offset + (double)anim->scroll_v * (double)dt);
}

int r2d_world_material_anim_frame(const R2DWorldMaterialAnim *anim)
{
    if (!anim || anim->frames < 1) return 0;
    if (anim->frames == 1) return 0;

    double base = floor((double)anim->phase * (double)anim->fps);
    if (!isfinite(base)) return 0;

    double cycle = anim->ping_pong ? 2.0 * (double)(anim->frames - 1) : (double)anim->frames;
    double raw = fmod(base + (double)seed_frame_impl(anim), cycle);
    if (!isfinite(raw)) return 0;
    if (raw < 0.0) raw += cycle;

    int step = (int)raw;
    if (step >= anim->frames) {
        if (!anim->ping_pong) return 0; // fmod edge, should not happen
        step = 2 * (anim->frames - 1) - step;
    }
    return step;
}

float r2d_world_material_anim_emissive(const R2DWorldMaterialAnim *anim)
{
    if (!anim) return 1.0f;
    return 1.0f + anim->pulse_amount * sinf(R2D_MATERIAL_ANIM_TAU * anim->phase * anim->pulse_hz);
}

int r2d_world_material_anim_seed_frame(const R2DWorldMaterialAnim *anim)
{
    if (!anim || anim->frames < 1) return 0;
    return seed_frame_impl(anim);
}

void r2d_world_material_anim_reset(R2DWorldMaterialAnim *anim)
{
    if (!anim) return;
    anim->phase = 0.0f;
    anim->u_offset = 0.0f;
    anim->v_offset = 0.0f;
}
