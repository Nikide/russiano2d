#pragma once
// ===========================================================================
// Re2D sky system (render roadmap sections 62-68, 120, 126-127).
//
// Pure deterministic model for a constrained 2.5D sky:
//   * panorama (layer 0) plus 1-4 independently textured/tinted parallax cards;
//   * weather layers (rain/snow/ash/clouds) that may stack;
//   * sun and moon discs;
//   * distant sky scene cards (silhouette/impostor style);
//   * sky portal and tool_sky surface policy.
//
// This is data/model only: no mesh, no 3D scene, no GPU calls, no allocation,
// no globals, no clock. The renderer samples the functions below; the tests use
// the same functions as the reference. All outputs are finite and deterministic
// for identical arguments (weather uses a caller seed).
// ===========================================================================
#include <stdbool.h>
#include <stdint.h>

#define R2D_SKY_MAX_LAYERS 4
#define R2D_SKY_MAX_WEATHER 8
#define R2D_SKY_MAX_DISTANT 4

enum {
    R2D_SKY_PROFILE_CLEAR = 0,
    R2D_SKY_PROFILE_DUSK = 1,
    R2D_SKY_PROFILE_NIGHT = 2,
    R2D_SKY_PROFILE_STORM = 3,
    R2D_SKY_PROFILE_COUNT = 4
};

enum {
    R2D_SKY_WEATHER_NONE = 0,
    R2D_SKY_WEATHER_RAIN = 1,
    R2D_SKY_WEATHER_SNOW = 2,
    R2D_SKY_WEATHER_ASH = 3,
    R2D_SKY_WEATHER_CLOUDS = 4,
    R2D_SKY_WEATHER_COUNT = 5
};

enum {
    R2D_SKY_PORTAL_NONE = 0,     // portal shows no sky
    R2D_SKY_PORTAL_INHERIT = 1,  // portal uses the room's current sky
    R2D_SKY_PORTAL_PROFILE = 2,  // portal overrides to portal_profile
    R2D_SKY_PORTAL_COUNT = 3
};

typedef struct {
    float parallax;   // 0..10 horizontal factor
    float scale;      // 0.05..10 UV scale
    float offset;     // -10..10 vertical offset
    float alpha;      // 0..1
    float scroll;     // UV units per second, may be signed
    int texture;      // caller atlas/texture slot, -1 = procedural
    uint32_t tint;    // 0xAABBGGRR RGBA
} R2DWorldSkyLayer;

typedef struct {
    int type;         // R2D_SKY_WEATHER_*
    float density;    // 0..1 amount within the layer
    float speed;      // world/screen units per second
    float slant;      // -1..1 horizontal drift
    float size;       // 0.25..4 relative card size
    float opacity;    // 0..1
} R2DWorldSkyWeather;

typedef struct {
    float parallax;   // horizontal factor
    float offset;     // vertical screen offset -1..1
    float alpha;      // 0..1
    float scroll;     // UV units per second
    int texture;      // texture slot, -1 = procedural silhouette
    uint32_t tint;    // 0xAABBGGRR RGBA
} R2DWorldSkyDistant;

typedef struct {
    char name[32];
    int layer_count;             // 1..4 (layer 0 is the panorama card)
    int panorama_texture;        // -1 = flat colour
    uint32_t panorama_tint;
    R2DWorldSkyLayer layers[R2D_SKY_MAX_LAYERS];
    bool sun, moon;
    float sun_azimuth, sun_elevation, sun_size, sun_glow;
    uint32_t sun_color, moon_color;
    int weather_count;           // 0..8
    R2DWorldSkyWeather weather[R2D_SKY_MAX_WEATHER];
    int distant_count;           // 0..4
    R2DWorldSkyDistant distant[R2D_SKY_MAX_DISTANT];
    int portal_policy;           // R2D_SKY_PORTAL_*
    int portal_profile;          // R2D_SKY_PROFILE_* for POLICY_PROFILE
    float exposure;              // 0.25..4
    float cloud_fog;             // 0..1 horizon fog wash
} R2DWorldSky;

typedef struct {
    int layers, weather_cards, distant_cards, celestial_discs, portal_surfaces;
} R2DWorldSkyCounters;

void r2d_world_sky_defaults(R2DWorldSky *sky);
bool r2d_world_sky_profile(int profile, R2DWorldSky *sky);
bool r2d_world_sky_validate(R2DWorldSky *sky);

// Sample one parallax layer at camera yaw and elapsed time. Writes UV and
// tint/alpha; invalid layer/index leaves outputs neutral (uv 0, alpha 0).
void r2d_world_sky_layer_sample(const R2DWorldSky *sky, int layer,
                                float yaw, float time,
                                float out_uv[2], uint32_t *out_tint,
                                float *out_alpha);

// Celestial disc direction (unit vector) and visibility above the horizon.
void r2d_world_sky_celestial(const R2DWorldSky *sky, bool moon,
                             float out_dir[3], float *out_visible,
                             float *out_size, float *out_glow,
                             uint32_t *out_color);

// One procedural weather card. Time drives deterministic wrapping; seed mixes
// per-index lanes. out[0..5] = screen x/y (0..1), length (0..1 of height),
// width (0..1), slant (-1..1), alpha (0..1). type is written separately.
bool r2d_world_sky_weather_sample(const R2DWorldSky *sky, int layer, int index,
                                  float time, uint32_t seed,
                                  float out[6], int *out_type);
// Relative stacked weight of weather layer `layer` (density normalised by the
// sum of all non-zero densities; 0 when the layer is empty).
float r2d_world_sky_weather_weight(const R2DWorldSky *sky, int layer);

// Distant card sample: UV/parallax x offset, alpha and tint.
void r2d_world_sky_distant_sample(const R2DWorldSky *sky, int index,
                                  float yaw, float time,
                                  float *out_x, uint32_t *out_tint,
                                  float *out_alpha);

// Sky surface / portal policy.
// surface_sky: authored tool_sky wall; no_draw: nodraw/clip; returns whether
// the renderer should draw the sky stack for this surface.
bool r2d_world_sky_surface_visible(const R2DWorldSky *sky, bool surface_sky, bool no_draw);
// Effective profile for a portal: hint < 0 = inherit, otherwise an override.
int r2d_world_sky_portal_profile(const R2DWorldSky *sky, int portal_profile_hint);
