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
#include <stddef.h>
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

    // P4 light shaft cards (no volumetric raymarch).
    bool light_shafts;
    int shaft_budget;      // 0..8 cards per frame
    float shaft_length;    // world units below the light
    float shaft_width;     // world units
    float shaft_opacity;   // 0..1
    float shaft_fade;      // 0.01..1 height falloff

    // P4 post feature toggles in the shared model (see re2d_world_post.h for
    // the pass math and reference images).
    bool heat_distortion;
    bool weather_layers;
    int sky_profile;       // R2D_SKY_PROFILE_*
    int weather_type;      // R2D_SKY_WEATHER_* dominant layer
    float weather_density; // 0..1
    int distant_cards;     // 0..4 distant sky silhouette cards
    bool moon_disc;
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
    // P4/P5 counters.
    int shafts, weather_cards, distant_cards, distant_impostors, ambient_samples, detail_samples;
    int decal2_active, batch_draws, batch_batches, batch_saved;
    int resident_textures;
    size_t upload_bytes;
    // Final screen composite passes (GPU only).
    int post_passes, post_bloom, post_reflection, post_heat;
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

// ---------------------------------------------------------------------------
// P4: light shaft cards.
// Alpha of a shaft card at normalised distance 0..1 along the card; fades by
// height and authored opacity. Invalid input -> 0.
float r2d_world_render_shaft_alpha(float along, float height_fraction,
                                   const R2DWorldRenderFeatures *config);
// Card width in world units at `height_fraction` (slight cone widening).
float r2d_world_render_shaft_width(float height_fraction,
                                   const R2DWorldRenderFeatures *config);

// ---------------------------------------------------------------------------
// P4: contact lighting 2.0: dominant local light direction/colour plus ambient
// floor colour for a sprite. dx/dy point from the actor toward the light in XY;
// out_dir is a unit vector (0,0 when the light is at the actor), out_rgb mixes
// ambient toward the light colour by the distance falloff.
void r2d_world_render_contact_light(float dx, float dy, const float light_rgb[3],
                                    float intensity, const float ambient_rgb[3],
                                    float out_dir[2], float out_rgb[3]);

// ---------------------------------------------------------------------------
// P4: baked ambient light / AO-lite field (coarse per-span XY grid).
#define R2D_WORLD_AMBIENT_MAX 32
typedef struct {
    int width, height;             // 1..R2D_WORLD_AMBIENT_MAX
    float x0, y0, cell_w, cell_h;
    float ambient[3 * R2D_WORLD_AMBIENT_MAX * R2D_WORLD_AMBIENT_MAX];
    float occlusion[R2D_WORLD_AMBIENT_MAX * R2D_WORLD_AMBIENT_MAX];
    bool valid;
} R2DWorldAmbientField;

// Bake a deterministic field from a coarse height pair per cell (floor and
// ceiling heights). Low ceilings increase occlusion; sky_bias 0..1 adds sky
// ambient. Returns false for NULL/invalid counts. Inputs are row-major.
bool r2d_world_ambient_bake(R2DWorldAmbientField *field,
                            float x0, float y0, float w, float h,
                            int cells_x, int cells_y,
                            const float *floor_h, const float *ceiling_h,
                            const float sky_rgb[3], float sky_bias);
// Bilinear sample. Outside the field or invalid field -> neutral
// (ambient 1,1,1, occlusion 0).
void r2d_world_ambient_sample(const R2DWorldAmbientField *field,
                              float x, float y,
                              float out_rgb[3], float *out_occlusion);

// ---------------------------------------------------------------------------
// P4: surface detail layers (base/detail/macro/emissive/normal).
enum {
    R2D_WORLD_DETAIL_BASE = 0,
    R2D_WORLD_DETAIL_DETAIL = 1,
    R2D_WORLD_DETAIL_MACRO = 2,
    R2D_WORLD_DETAIL_EMISSIVE = 3,
    R2D_WORLD_DETAIL_NORMAL = 4,
    R2D_WORLD_DETAIL_LAYERS = 5
};
// Deterministic layer UV/tint/weight. macro uses a larger scale than detail.
void r2d_world_render_detail_layer(uint32_t surface, int layer, uint32_t seed,
                                   float base_u, float base_v,
                                   float out_uv[2], float *out_weight);
// P4/P5: 16-direction ultra sprite direction bucket (0..15) from a yaw angle.
int r2d_world_render_sprite_direction(float yaw, int directions);

// ---------------------------------------------------------------------------
// P4: decals 2.0 (lifetime, fade, rotation, scale, deterministic variation).
#define R2D_WORLD_DECAL2_MAX 256
typedef struct {
    int material;
    float u, v, w, h;        // local surface rect
    float rotation;          // radians
    float scale;             // 0.25..4
    float life, max_life;    // seconds
    float fade_in, fade_out; // seconds
    float seed;
    bool active;
} R2DWorldDecal2;

// Configure one decal slot. Returns false for invalid material/lifetime.
bool r2d_world_decal2_init(R2DWorldDecal2 *decal, int material,
                           float u, float v, float w, float h,
                           float rotation, float scale,
                           float life, float fade_in, float fade_out,
                           float seed);
// Advance age; returns true while active (life > 0). NULL is a no-op false.
bool r2d_world_decal2_step(R2DWorldDecal2 *decal, float dt);
// Alpha in 0..1 from fade-in/fade-out; rotation/scale variation output from the
// deterministic seed. Invalid decal -> alpha 0 and neutral outputs.
float r2d_world_decal2_eval(const R2DWorldDecal2 *decal,
                            float *out_rotation, float *out_scale);

// ---------------------------------------------------------------------------
// P4: static batching by material/blend/light-policy/atlas and residency hooks.
enum {
    R2D_WORLD_BATCH_NONE = 0,
    R2D_WORLD_BATCH_OPAQUE = 1,
    R2D_WORLD_BATCH_MASKED = 2,
    R2D_WORLD_BATCH_TRANSLUCENT = 3,
    R2D_WORLD_BATCH_ADDITIVE = 4
};
typedef struct {
    int material, blend, light_policy, atlas;
} R2DWorldBatchKey;
typedef struct {
    int draws, batches, saved;
    int runs;   // consecutive matching keys
} R2DWorldRenderBatchStats;

// Build a stable key. Negative ids are normalised to -1.
void r2d_world_render_batch_key(R2DWorldBatchKey *key, int material, int blend,
                                int light_policy, int atlas);
uint32_t r2d_world_render_batch_hash(const R2DWorldBatchKey *key);
// Feed one draw in submission order. Consecutive equal keys coalesce into one
// batch; every draw beyond the first inside a batch counts as saved.
void r2d_world_render_batch_draw(R2DWorldRenderBatchStats *stats,
                                 const R2DWorldBatchKey *key,
                                 R2DWorldBatchKey *previous, bool *has_previous);

typedef struct {
    int resident, pending, evicted;
    size_t resident_bytes, budget_bytes, uploaded_bytes, upload_bytes_budget;
} R2DWorldResidency;
void r2d_world_residency_init(R2DWorldResidency *residency, size_t budget_bytes,
                              size_t upload_bytes_budget);
// Admission is deterministic: resident if it fits, otherwise queued as pending.
bool r2d_world_residency_admit(R2DWorldResidency *residency, size_t bytes);
// Per-frame upload budget; returns the admitted byte count (<= budget).
size_t r2d_world_residency_upload(R2DWorldResidency *residency, size_t bytes);
