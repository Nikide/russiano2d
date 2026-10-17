#pragma once
// ===========================================================================
// Re2D renderer visual feature model (R-01/R-02, render roadmap sections
// 41-68,117-122). Pure C reference math and configuration for the constrained
// 2.5D renderer. No mesh/3D/ECS, no allocation, no globals.
//
// The renderer consumes this model in three places:
//   * GPU uniforms are prepared from these fields every surface/actor draw;
//   * the CPU reference path uses the same contact/fog/variation formulas;
//   * world.info() exposes the per-frame counters below without changing the
//     existing gpuDraws attribution.
//
// Definitions
// -----------
// * contact alpha: radial elliptical footprint under an actor. `distance` and
//   `radius` are in world units, `softness` 0.05..1 controls the feather band,
//   `height_gap` is actor-feet minus floor height, `height_fade` is the gap at
//   which the shadow disappears. Center is 1, outside radius is 0.
// * foot AO: a smaller, stronger core near the point of support; same radial
//   rule with `radius` and `strength` 0..1.
// * fog factor: 1-exp(-0.002*distance - height_density*max(0,height-base)*falloff)
//   clamped to 0..1. The renderer may substitute the authored span fog density
//   for the 0.002 distance term; this reference pins the height term.
// * haze mix: fog_rgb + (sky_rgb - fog_rgb)*amount, clamped to 0..1.
// * material variation: deterministic splitmix hash of (seed, surface, kind).
//   UV offsets are in [0,1); tint is a per-channel brightness factor in
//   [1-0.22*strength, 1+0.22*strength] with a small deterministic hue skew.
// * edge alpha: masked-sprite threshold with a configurable feather band.
// * AO-lite: `ao = 1 - corner_ao*(1-a)*(1-b)` where a/b are smoothstep distances
//   to two edges; a bevel darkening is applied as a separate small term at
//   `bevel` strength. Result is clamped to 0..1.
// * sky layer offsets: panorama parallax factor, UV scale and vertical offset
//   per layer 0..3, deterministic and independent of the camera; the shader
//   adds the current yaw to the horizontal sample.
// * sun direction: azimuth/elevation radians -> unit vector
//   (cos(e)cos(a), cos(e)sin(a), sin(e)).
// * liquid UV: deterministic scrolling/distortion of a surface UV plus a foam
//   scalar in 0..1. No fluid simulation.
//
// Validation: presets accept 0..3 (low, medium, high, ultra). validate() keeps
// NULL false, otherwise sanitizes every non-finite float to the default and
// clamps all parameters; it always returns true for a non-NULL config.
// ===========================================================================
#include <stdbool.h>
#include <stdint.h>

enum {
    R2D_RENDER_QUALITY_LOW = 0,
    R2D_RENDER_QUALITY_MEDIUM = 1,
    R2D_RENDER_QUALITY_HIGH = 2,
    R2D_RENDER_QUALITY_ULTRA = 3
};

typedef struct {
    int quality;
    uint32_t seed;

    // R-01 grounding.
    bool grounding, contact_shadow, foot_ao, local_floor_tint, contact_lighting;
    float shadow_radius, shadow_opacity, shadow_softness, shadow_height_fade;
    float foot_ao_radius, foot_ao_strength, floor_tint_mix, contact_light_strength;

    // Sprite edge quality.
    bool edge_quality, edge_outline, edge_grime, alpha_feather;
    float edge_outline_strength, edge_grime_strength, edge_alpha_threshold,
          edge_alpha_feather;

    // Surface material variation / fake geometry depth.
    bool material_variation, macro_variation, bevel, corner_ao;
    float variation_strength, macro_strength, bevel_strength, corner_ao_strength,
          surface_edge_width;

    // Atmosphere / lighting 2.0.
    bool height_fog, atmospheric_haze;
    float fog_height_density, fog_base_height, fog_height_falloff, haze_strength;

    // Sky system.
    bool sky_layers, sun_disc, sky_portal_surface;
    int sky_layer_count; // 0..4
    float sky_parallax[4], sky_scale[4], sky_offset[4], sky_alpha[4];
    float sun_azimuth, sun_elevation, sun_size, sun_glow;
    float sky_scroll_speed;

    // Liquid / reflection / post hooks (rendered by existing pass machinery).
    bool liquid, reflection_lite, bloom_lite, surface_detail, material_animation;
    float liquid_distortion, liquid_scroll_speed, liquid_highlight, liquid_foam;
} R2DWorldRenderFeatures;

typedef struct {
    int grounded_actors, contact_shadows, foot_ao, floor_tint, contact_lit;
    int edge_actors, outline_actors, grime_actors;
    int varied_surfaces, macro_surfaces, bevel_surfaces, corner_ao_surfaces;
    int fog_surfaces, haze_surfaces, liquid_surfaces, animated_materials;
    int sky_layers, celestial_discs, sky_surfaces, reflection_passes;
    int ground_draws, sky_draws, decals;
    // R-03 VFX render pass (cards/trails/distortion cards).
    int vfx_cards, vfx_trails, vfx_distortion, vfx_card_draws, vfx_trail_draws, vfx_draws;
} R2DWorldRenderCounters;

void r2d_world_render_defaults(R2DWorldRenderFeatures *out);
bool r2d_world_render_preset(int quality, R2DWorldRenderFeatures *out);
bool r2d_world_render_validate(R2DWorldRenderFeatures *config);
void r2d_world_render_counters_reset(R2DWorldRenderCounters *counters);

uint32_t r2d_world_render_hash(uint32_t seed, uint32_t value);
float r2d_world_render_contact_alpha(float distance, float radius, float softness,
                                     float height_gap, float height_fade);
float r2d_world_render_foot_ao(float distance, float radius, float strength);
float r2d_world_render_fog_factor(float distance, float height,
                                  const R2DWorldRenderFeatures *config);
void r2d_world_render_haze_mix(const float fog_rgb[3], const float sky_rgb[3],
                               float amount, float out_rgb[3]);
void r2d_world_render_variation(uint32_t surface, int kind, uint32_t seed,
                                float strength, float out_tint[3], float out_uv[2]);
float r2d_world_render_edge_alpha(float alpha, float threshold, float feather);
float r2d_world_render_ao_lite(float edge_a, float edge_b, float width,
                               float corner_ao, float bevel);
void r2d_world_render_sky_layer(int layer, const R2DWorldRenderFeatures *config,
                                float *out_parallax, float *out_scale,
                                float *out_offset, float *out_alpha);
void r2d_world_render_sun_direction(float azimuth, float elevation, float out[3]);
void r2d_world_render_liquid_uv(float u, float v, float time,
                                const R2DWorldRenderFeatures *config,
                                float out_uv[2], float *out_foam);
