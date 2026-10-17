#pragma once
// ===========================================================================
// Re2D: final-frame 2D postprocess descriptor registry and evaluator.
//
// This is NOT a 3D G-buffer / shader graph. It owns a tiny caller-inspected
// stack of constrained effect descriptors and deterministically folds them
// into a small uniform block that an existing final-frame post pass can apply
// to an ordinary RGBA frame. Pure C: no allocation, no mutable globals, no GPU
// calls, no world state.
//
// Effects (fixed evaluation order, independent of stack->order):
//   GRADE     multiplicative RGB gain: scale[c] *= 1 + color[c]*strength.
//             `order` is kept as an identity diagnostic table only.
//   VIGNETTE  vignette = clamp(sum(strength), 0..1).
//   FLASH     flash = clamp(sum(strength), 0..1); color_add += color*strength.
//             step() decays strength by extra0 per second (0 => default 2.0).
//   TINT      tint[c] = clamp(sum(color[c]*strength*pulse), 0..1) and
//             tint[3] = clamp(sum(a*strength*pulse), 0..1). Pulse uses stack
//             time: pulse = 1 + clamp(extra1,0,1)*sin(2*pi*extra0*time); with
//             extra0<=0 there is no pulse.
//   PIXELATE  pixel_size = max(1, extra0) clamped to 1..16 (extra0 is the
//             authored pixel size; set() clamps it).
//   CHROMA    chroma = clamp(sum(strength), 0..1) (very limited 2D offset).
//   BLOOM     bloom = clamp(sum(strength), 0..1) (bloom-lite).
//
// Disabled effects contribute neutral values: color_scale 1, color_add 0,
// vignette/flash/chroma/bloom 0, pixel_size 1, tint 0. Parameters are clamped
// at set(): strength 0..4, colors/alpha 0..1, PIXELATE extra0 1..16. Non-finite
// parameters are rejected transactionally. step() clamps dt to 0..0.25 (NaN
// behaves as 0). Unknown effect ids/names are rejected.
//
// Profiles are immutable static tables applied transactionally (unknown name
// leaves the stack unchanged). They only replace effect parameters; `order`
// and elapsed `time` are preserved.
// ===========================================================================
#include <stdbool.h>

enum {
    R2D_POST_GRADE = 0,
    R2D_POST_VIGNETTE = 1,
    R2D_POST_FLASH = 2,
    R2D_POST_TINT = 3,
    R2D_POST_PIXELATE = 4,
    R2D_POST_CHROMA = 5,
    R2D_POST_BLOOM = 6,
    R2D_POST_COUNT = 7
};

typedef struct {
    float strength;
    float r, g, b, a;
    float extra0, extra1;
    bool enabled;
} R2DPostEffect;

typedef struct {
    R2DPostEffect effects[R2D_POST_COUNT];
    int order[R2D_POST_COUNT];   // identity diagnostic table; eval order is fixed
    float time;                  // elapsed seconds, advanced by step()
} R2DPostStack;

typedef struct {
    float color_scale[3];   // multiplicative RGB, neutral 1
    float color_add[3];     // additive RGB, neutral 0
    float vignette;         // 0..1
    float flash;            // 0..1
    float pixel_size;       // 1..16, 1 = off
    float chroma;           // 0..1
    float bloom;            // 0..1
    float tint[4];          // additive RGBA, neutral 0
} R2DPostUniforms;

typedef struct {
    R2DPostEffect effects[R2D_POST_COUNT];
} R2DPostProfile;

// Resets every effect to disabled/neutral, order to 0..COUNT-1, time to 0.
void r2d_postprocess_init(R2DPostStack *stack);

// Sets one effect's parameters without changing its enabled flag. Returns
// false for NULL/invalid effect id, non-finite parameters, and leaves the
// effect untouched on failure.
bool r2d_postprocess_set(R2DPostStack *stack, int effect,
                         float strength, float r, float g, float b, float a,
                         float extra0, float extra1);

// Enables/disables one effect. Returns false for NULL/invalid effect id.
bool r2d_postprocess_enable(R2DPostStack *stack, int effect, bool enabled);

// Advances elapsed time and decays enabled FLASH strengths. dt is clamped to
// 0..0.25; NaN behaves as 0. NULL stack is ignored.
void r2d_postprocess_step(R2DPostStack *stack, float dt);

// Folds the stack into neutral-initialised uniforms in fixed effect order.
// NULL stack or NULL out yields neutral uniforms (NULL out is ignored).
void r2d_postprocess_eval(const R2DPostStack *stack, R2DPostUniforms *out);

// Immutable named profile ("neutral", "underwater", "poison", "frost",
// "boss", "damage"), case-sensitive. Returns NULL for NULL/unknown names.
const R2DPostProfile *r2d_postprocess_profile(const char *name);

// Transactional profile application. Unknown name returns false and leaves the
// stack untouched; success copies the profile's effect parameters and keeps
// `order` and `time`.
bool r2d_postprocess_apply_profile(R2DPostStack *stack, const char *name);
