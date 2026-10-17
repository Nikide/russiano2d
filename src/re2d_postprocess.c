#include "re2d_postprocess.h"

#include <math.h>
#include <string.h>

#define R2D_POST_PI 3.14159265358979323846f
#define R2D_POST_TWO_PI 6.28318530717958647692f

#define POST_E(strength, r, g, b, a, extra0, extra1, enabled) \
    { (strength), (r), (g), (b), (a), (extra0), (extra1), (enabled) }

typedef struct {
    const char *name;
    R2DPostProfile profile;
} R2DPostNamedProfile;

// Immutable presets. They only describe final-frame uniforms; no allocation and
// no mutable global state. PIXELATE's extra0 is 1 when the effect is off so a
// stray enable still yields a neutral pixel size until authored.
static const R2DPostNamedProfile r2d_post_profiles[] = {
    {
        "neutral",
        {{
            POST_E(0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false),
            POST_E(0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false),
            POST_E(0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false),
            POST_E(0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false),
            POST_E(0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, false),
            POST_E(0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false),
            POST_E(0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false)
        }}
    },
    {
        "underwater",
        {{
            POST_E(0.80f, 0.35f, 0.75f, 1.00f, 1.0f, 0.0f, 0.0f, true),
            POST_E(0.35f, 0.10f, 0.30f, 0.45f, 1.0f, 0.0f, 0.0f, true),
            POST_E(0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false),
            POST_E(0.60f, 0.10f, 0.45f, 0.90f, 0.50f, 0.0f, 0.0f, true),
            POST_E(1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, false),
            POST_E(0.25f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, true),
            POST_E(0.30f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, true)
        }}
    },
    {
        "poison",
        {{
            POST_E(0.50f, 0.35f, 0.90f, 0.25f, 1.0f, 0.0f, 0.0f, true),
            POST_E(0.45f, 0.10f, 0.35f, 0.10f, 1.0f, 0.0f, 0.0f, true),
            POST_E(0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false),
            POST_E(0.70f, 0.20f, 0.80f, 0.10f, 0.55f, 0.0f, 0.0f, true),
            POST_E(1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, false),
            POST_E(0.15f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, true),
            POST_E(0.20f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, true)
        }}
    },
    {
        "frost",
        {{
            POST_E(0.60f, 0.55f, 0.85f, 1.00f, 1.0f, 0.0f, 0.0f, true),
            POST_E(0.40f, 0.20f, 0.45f, 0.60f, 1.0f, 0.0f, 0.0f, true),
            POST_E(0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false),
            POST_E(0.50f, 0.60f, 0.90f, 1.00f, 0.40f, 0.0f, 0.0f, true),
            POST_E(1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, false),
            POST_E(0.20f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, true),
            POST_E(0.25f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, true)
        }}
    },
    {
        "boss",
        {{
            POST_E(0.90f, 1.00f, 0.35f, 0.30f, 1.0f, 0.0f, 0.0f, true),
            POST_E(0.50f, 0.30f, 0.05f, 0.05f, 1.0f, 0.0f, 0.0f, true),
            POST_E(0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false),
            POST_E(1.00f, 1.00f, 0.10f, 0.05f, 0.50f, 1.50f, 0.35f, true),
            POST_E(1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, false),
            POST_E(0.30f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, true),
            POST_E(0.40f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, true)
        }}
    },
    {
        "damage",
        {{
            POST_E(0.30f, 1.00f, 0.20f, 0.10f, 1.0f, 0.0f, 0.0f, true),
            POST_E(0.60f, 0.30f, 0.02f, 0.02f, 1.0f, 0.0f, 0.0f, true),
            POST_E(1.00f, 1.00f, 0.15f, 0.10f, 1.0f, 2.50f, 0.0f, true),
            POST_E(0.30f, 1.00f, 0.10f, 0.05f, 0.30f, 0.0f, 0.0f, true),
            POST_E(1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, false),
            POST_E(0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, false),
            POST_E(0.10f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, true)
        }}
    }
};

#define R2D_POST_PROFILE_COUNT \
    ((int)(sizeof r2d_post_profiles / sizeof r2d_post_profiles[0]))

static float clampf(float v, float lo, float hi)
{
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

static float clamp01(float v)
{
    return clampf(v, 0.0f, 1.0f);
}

static const R2DPostNamedProfile *find_profile(const char *name)
{
    if (!name) return NULL;
    for (int i = 0; i < R2D_POST_PROFILE_COUNT; i++) {
        if (strcmp(r2d_post_profiles[i].name, name) == 0) {
            return &r2d_post_profiles[i];
        }
    }
    return NULL;
}

void r2d_postprocess_init(R2DPostStack *stack)
{
    if (!stack) return;
    memset(stack, 0, sizeof *stack);
    for (int i = 0; i < R2D_POST_COUNT; i++) {
        stack->order[i] = i;
        stack->effects[i].enabled = false;
    }
    // A neutral pixel size keeps an accidentally enabled pixelate harmless.
    stack->effects[R2D_POST_PIXELATE].extra0 = 1.0f;
}

bool r2d_postprocess_set(R2DPostStack *stack, int effect,
                         float strength, float r, float g, float b, float a,
                         float extra0, float extra1)
{
    if (!stack || effect < 0 || effect >= R2D_POST_COUNT) return false;
    if (!isfinite(strength) || !isfinite(r) || !isfinite(g) ||
        !isfinite(b) || !isfinite(a) || !isfinite(extra0) || !isfinite(extra1)) {
        return false;
    }

    R2DPostEffect next;
    next.strength = clampf(strength, 0.0f, 4.0f);
    next.r = clamp01(r);
    next.g = clamp01(g);
    next.b = clamp01(b);
    next.a = clamp01(a);
    next.extra0 = extra0;
    next.extra1 = extra1;
    if (effect == R2D_POST_PIXELATE) next.extra0 = clampf(extra0, 1.0f, 16.0f);
    next.enabled = stack->effects[effect].enabled;
    stack->effects[effect] = next;
    return true;
}

bool r2d_postprocess_enable(R2DPostStack *stack, int effect, bool enabled)
{
    if (!stack || effect < 0 || effect >= R2D_POST_COUNT) return false;
    stack->effects[effect].enabled = enabled;
    return true;
}

void r2d_postprocess_step(R2DPostStack *stack, float dt)
{
    if (!stack) return;
    if (isnan(dt) || dt < 0.0f) dt = 0.0f;
    else if (dt > 0.25f) dt = 0.25f;
    if (!isfinite(stack->time)) stack->time = 0.0f;
    stack->time += dt;

    R2DPostEffect *flash = &stack->effects[R2D_POST_FLASH];
    if (flash->enabled && flash->strength > 0.0f) {
        const float rate = flash->extra0 > 0.0f ? flash->extra0 : 2.0f;
        const float remaining = flash->strength - rate * dt;
        flash->strength = remaining > 0.0f ? remaining : 0.0f;
    }
}

void r2d_postprocess_eval(const R2DPostStack *stack, R2DPostUniforms *out)
{
    if (!out) return;

    out->color_scale[0] = out->color_scale[1] = out->color_scale[2] = 1.0f;
    out->color_add[0] = out->color_add[1] = out->color_add[2] = 0.0f;
    out->vignette = 0.0f;
    out->flash = 0.0f;
    out->pixel_size = 1.0f;
    out->chroma = 0.0f;
    out->bloom = 0.0f;
    out->tint[0] = out->tint[1] = out->tint[2] = out->tint[3] = 0.0f;

    if (!stack) return;

    float tint[4] = {0.0f, 0.0f, 0.0f, 0.0f};
    float pixel_size = 1.0f;

    // Fixed order: GRADE, VIGNETTE, FLASH, TINT, PIXELATE, CHROMA, BLOOM.
    for (int i = 0; i < R2D_POST_COUNT; i++) {
        const R2DPostEffect *e = &stack->effects[i];
        if (!e->enabled) continue;

        switch (i) {
        case R2D_POST_GRADE:
            for (int c = 0; c < 3; c++) {
                const float color = c == 0 ? e->r : (c == 1 ? e->g : e->b);
                out->color_scale[c] = clampf(out->color_scale[c] *
                                             (1.0f + color * e->strength), 0.0f, 8.0f);
            }
            break;
        case R2D_POST_VIGNETTE:
            out->vignette = clamp01(out->vignette + e->strength);
            break;
        case R2D_POST_FLASH:
            out->flash = clamp01(out->flash + e->strength);
            out->color_add[0] = clampf(out->color_add[0] + e->r * e->strength, 0.0f, 8.0f);
            out->color_add[1] = clampf(out->color_add[1] + e->g * e->strength, 0.0f, 8.0f);
            out->color_add[2] = clampf(out->color_add[2] + e->b * e->strength, 0.0f, 8.0f);
            break;
        case R2D_POST_TINT: {
            float pulse = 1.0f;
            if (e->extra0 > 0.0f) {
                pulse += clamp01(e->extra1) *
                         sinf(R2D_POST_TWO_PI * e->extra0 * stack->time);
            }
            tint[0] += e->r * e->strength * pulse;
            tint[1] += e->g * e->strength * pulse;
            tint[2] += e->b * e->strength * pulse;
            tint[3] += e->a * e->strength * pulse;
            break;
        }
        case R2D_POST_PIXELATE: {
            const float size = clampf(e->extra0, 1.0f, 16.0f);
            if (size > pixel_size) pixel_size = size;
            break;
        }
        case R2D_POST_CHROMA:
            out->chroma = clamp01(out->chroma + e->strength);
            break;
        case R2D_POST_BLOOM:
            out->bloom = clamp01(out->bloom + e->strength);
            break;
        default:
            break;
        }
    }

    out->pixel_size = pixel_size;
    out->tint[0] = clamp01(tint[0]);
    out->tint[1] = clamp01(tint[1]);
    out->tint[2] = clamp01(tint[2]);
    out->tint[3] = clamp01(tint[3]);
}

const R2DPostProfile *r2d_postprocess_profile(const char *name)
{
    const R2DPostNamedProfile *named = find_profile(name);
    return named ? &named->profile : NULL;
}

bool r2d_postprocess_apply_profile(R2DPostStack *stack, const char *name)
{
    if (!stack) return false;
    const R2DPostNamedProfile *named = find_profile(name);
    if (!named) return false;
    memcpy(stack->effects, named->profile.effects, sizeof stack->effects);
    return true;
}
