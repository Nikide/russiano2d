#pragma once
// ===========================================================================
// Re2D P4 post passes (render roadmap sections 54,59,60,61,121).
//
// Deterministic CPU model for three cheap 2D passes that the final-frame
// composite can apply to an ordinary RGBA image. No 3D G-buffer, no shader
// graph, no allocation inside the evaluation functions.
//
// bloom-lite: luminance threshold with a smooth knee, fixed 8-tap ring, then a
//   separable box blur feeding an additive composite. `reference_bloom`
//   implements exactly that on CPU so the model and the regression reference
//   cannot drift apart.
// reflection-lite: vertical UV mirror for planar surfaces with roughness and
//   Fresnel-style attenuation. Not a planar-reflection engine.
// depth-aware heat distortion: a screen-space UV offset gated by a distortion
//   mask and attenuated by depth, so only the background inside the heat card
//   moves. `reference_heat` applies it to an RGBA image (nearest sampling).
//
// Validation keeps NULL false; otherwise non-finite values fall back to the
// defaults and every parameter is clamped. All functions are finite for finite
// input; NaN/inf behaviour is documented per function and never propagates.
// ===========================================================================
#include <stdbool.h>
#include <stdint.h>

#define R2D_WORLD_POST_MAX_TAPS 8

typedef struct {
    bool bloom;
    float bloom_threshold;   // 0..1 luma
    float bloom_knee;        // 0.001..1
    float bloom_intensity;   // 0..4
    float bloom_radius;      // 0..0.25 of the min screen dimension
    int bloom_taps;          // 0..8, 8 = full ring
    bool reflection;
    float reflection_strength;  // 0..1
    float reflection_roughness; // 0..1
    bool heat;
    float heat_strength;     // 0..0.05 UV offset
    float heat_frequency;    // 0..80
    float heat_speed;        // 0..20
    float heat_depth_start;  // world units
    float heat_depth_scale;  // world units
} R2DWorldPostConfig;

typedef struct {
    int bloom_taps;
    int heat_cards;
    float bloom_coverage;
    float heat_coverage;
} R2DWorldPostCounters;

void r2d_world_post_defaults(R2DWorldPostConfig *config);
bool r2d_world_post_validate(R2DWorldPostConfig *config);
void r2d_world_post_counters_reset(R2DWorldPostCounters *counters);

// Soft-threshold weight in 0..1 for one luminance sample.
float r2d_world_post_bloom_weight(float luma, const R2DWorldPostConfig *config);

// Ring tap i (0..taps-1) as a normalised offset in [-1,1]. Returns false for
// invalid index/config; out_xy is zeroed on failure.
bool r2d_world_post_bloom_tap(const R2DWorldPostConfig *config, int index,
                              float out_xy[2]);

// Vertical mirror UV plus weight. `n_dot_v` is the view/normal dot in -1..1.
void r2d_world_post_reflection_uv(float u, float v, float n_dot_v,
                                  float roughness, float strength,
                                  float out_uv[2], float *out_weight);

// Screen-space elliptical mask: 1 at the heat card centre, smooth falloff to 0.
float r2d_world_post_heat_mask(float sx, float sy, float cx, float cy,
                               float rx, float ry, float falloff);

// Depth-attenuated distortion offset. mask 0 => exactly zero offset. Writes the
// new UV; returns the applied mask*attenuation in 0..1.
float r2d_world_post_heat_offset(float u, float v, float time, float depth,
                                 float mask, const R2DWorldPostConfig *config,
                                 float out_uv[2]);

// CPU reference passes used by the render regression harness. Images are
// tightly packed RGBA8, w*h pixels. `out` may alias `src` for heat.
void r2d_world_post_reference_bloom(const uint8_t *src, int w, int h,
                                    const R2DWorldPostConfig *config,
                                    uint8_t *out);
void r2d_world_post_reference_heat(const uint8_t *src, int w, int h,
                                   const R2DWorldPostConfig *config,
                                   float time, const float *mask,
                                   uint8_t *out);
