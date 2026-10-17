#include "re2d_world_render_features.h"

#include <math.h>
#include <stddef.h>
#include <string.h>

// Pure renderer feature math. No allocation, no globals, no clock reads.

static float clampf(float v, float lo, float hi)
{
    if (!(v > lo)) return lo;
    if (v > hi) return hi;
    return v;
}

static float clamp01(float v)
{
    return clampf(v, 0.0f, 1.0f);
}

static float smoothstep01(float edge0, float edge1, float x)
{
    if (!(edge1 > edge0)) return x >= edge1 ? 1.0f : 0.0f;
    float t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3.0f - 2.0f * t);
}

static uint32_t mix32(uint32_t x)
{
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

uint32_t r2d_world_render_hash(uint32_t seed, uint32_t value)
{
    return mix32(seed ^ mix32(value + 0x9e3779b9u));
}

void r2d_world_render_defaults(R2DWorldRenderFeatures *out)
{
    if (!out) return;
    memset(out, 0, sizeof(*out));
    out->quality = R2D_RENDER_QUALITY_MEDIUM;
    out->seed = 0x9e3779b9u;

    out->grounding = true;
    out->contact_shadow = true;
    out->foot_ao = true;
    out->local_floor_tint = true;
    out->contact_lighting = true;
    out->shadow_radius = 0.55f;
    out->shadow_opacity = 0.55f;
    out->shadow_softness = 0.65f;
    out->shadow_height_fade = 28.0f;
    out->foot_ao_radius = 0.30f;
    out->foot_ao_strength = 0.38f;
    out->floor_tint_mix = 0.35f;
    out->contact_light_strength = 0.25f;

    out->edge_quality = true;
    out->edge_outline = true;
    out->edge_grime = true;
    out->alpha_feather = true;
    out->edge_outline_strength = 0.28f;
    out->edge_grime_strength = 0.22f;
    out->edge_alpha_threshold = 0.45f;
    out->edge_alpha_feather = 0.12f;

    out->material_variation = true;
    out->macro_variation = true;
    out->bevel = true;
    out->corner_ao = true;
    out->variation_strength = 0.55f;
    out->macro_strength = 0.42f;
    out->bevel_strength = 0.35f;
    out->corner_ao_strength = 0.52f;
    out->surface_edge_width = 9.0f;

    out->height_fog = true;
    out->atmospheric_haze = true;
    out->fog_height_density = 0.006f;
    out->fog_base_height = 64.0f;
    out->fog_height_falloff = 1.0f;
    out->haze_strength = 0.35f;

    out->sky_layers = true;
    out->sun_disc = true;
    out->sky_portal_surface = true;
    out->sky_layer_count = 3;
    const float parallax[4] = {0.05f, 0.12f, 0.22f, 0.35f};
    const float scale[4] = {1.00f, 1.15f, 1.35f, 1.60f};
    const float offset[4] = {0.00f, 0.02f, -0.01f, -0.04f};
    const float alpha[4] = {0.25f, 0.28f, 0.22f, 0.18f};
    for (int i = 0; i < 4; ++i) {
        out->sky_parallax[i] = parallax[i];
        out->sky_scale[i] = scale[i];
        out->sky_offset[i] = offset[i];
        out->sky_alpha[i] = alpha[i];
    }
    out->sun_azimuth = 2.20f;
    out->sun_elevation = 0.55f;
    out->sun_size = 0.045f;
    out->sun_glow = 0.12f;
    out->sky_scroll_speed = 0.0008f;

    out->liquid = true;
    out->reflection_lite = false; // existing mirror portals remain the opt-in path
    out->bloom_lite = true;
    out->surface_detail = true;
    out->material_animation = true;
    out->liquid_distortion = 0.018f;
    out->liquid_scroll_speed = 0.55f;
    out->liquid_highlight = 0.30f;
    out->liquid_foam = 0.22f;

    out->light_shafts = true;
    out->shaft_budget = 4;
    out->shaft_length = 180.0f;
    out->shaft_width = 26.0f;
    out->shaft_opacity = 0.18f;
    out->shaft_fade = 0.65f;
    out->heat_distortion = true;
    out->weather_layers = false;
    out->sky_profile = 0; // R2D_SKY_PROFILE_CLEAR
    out->weather_type = 0;
    out->weather_density = 0.0f;
    out->distant_cards = 2;
    out->moon_disc = false;
}

bool r2d_world_render_preset(int quality, R2DWorldRenderFeatures *out)
{
    if (!out || quality < R2D_RENDER_QUALITY_LOW || quality > R2D_RENDER_QUALITY_ULTRA)
        return false;
    r2d_world_render_defaults(out);
    out->quality = quality;

    if (quality == R2D_RENDER_QUALITY_LOW) {
        out->foot_ao = false;
        out->local_floor_tint = false;
        out->contact_lighting = false;
        out->edge_quality = false;
        out->edge_outline = false;
        out->edge_grime = false;
        out->alpha_feather = false;
        out->material_variation = false;
        out->macro_variation = false;
        out->bevel = false;
        out->corner_ao = false;
        out->height_fog = false;
        out->atmospheric_haze = false;
        out->sky_layers = false;
        out->sky_layer_count = 1;
        out->sun_disc = false;
        out->liquid = false;
        out->bloom_lite = false;
        out->surface_detail = false;
        out->material_animation = false;
        out->light_shafts = false;
        out->heat_distortion = false;
        out->weather_layers = false;
        out->distant_cards = 1;
        out->shadow_softness = 0.45f;
        out->foot_ao_strength = 0.0f;
    } else if (quality == R2D_RENDER_QUALITY_HIGH) {
        out->sky_layer_count = 4;
        out->variation_strength = 0.65f;
        out->macro_strength = 0.55f;
        out->corner_ao_strength = 0.62f;
        out->haze_strength = 0.45f;
        out->liquid_distortion = 0.024f;
        out->liquid_foam = 0.30f;
        out->sun_glow = 0.18f;
        out->shaft_budget = 6;
        out->shaft_opacity = 0.22f;
        out->reflection_lite = true;
        out->weather_layers = true;
        out->sky_profile = 1; // R2D_SKY_PROFILE_DUSK
        out->weather_type = 4; // R2D_SKY_WEATHER_CLOUDS
        out->weather_density = 0.30f;
        out->distant_cards = 3;
    } else if (quality == R2D_RENDER_QUALITY_ULTRA) {
        out->sky_layer_count = 4;
        out->variation_strength = 0.75f;
        out->macro_strength = 0.65f;
        out->corner_ao_strength = 0.70f;
        out->haze_strength = 0.55f;
        out->shadow_softness = 0.78f;
        out->liquid_distortion = 0.032f;
        out->liquid_foam = 0.38f;
        out->sun_glow = 0.24f;
        out->shaft_budget = 8;
        out->shaft_opacity = 0.26f;
        out->reflection_lite = true;
        out->weather_layers = true;
        out->sky_profile = 3; // R2D_SKY_PROFILE_STORM
        out->weather_type = 1; // R2D_SKY_WEATHER_RAIN
        out->weather_density = 0.55f;
        out->distant_cards = 4;
        out->moon_disc = true;
    }
    return true;
}

static float sanitize_float(float value, float fallback, float lo, float hi)
{
    if (!isfinite(value)) value = fallback;
    return clampf(value, lo, hi);
}

bool r2d_world_render_validate(R2DWorldRenderFeatures *config)
{
    if (!config) return false;
    R2DWorldRenderFeatures def;
    r2d_world_render_defaults(&def);

    if (config->quality < R2D_RENDER_QUALITY_LOW || config->quality > R2D_RENDER_QUALITY_ULTRA)
        config->quality = def.quality;
    config->shadow_radius = sanitize_float(config->shadow_radius, def.shadow_radius, 0.05f, 2.0f);
    config->shadow_opacity = sanitize_float(config->shadow_opacity, def.shadow_opacity, 0.0f, 1.0f);
    config->shadow_softness = sanitize_float(config->shadow_softness, def.shadow_softness, 0.05f, 1.0f);
    config->shadow_height_fade = sanitize_float(config->shadow_height_fade, def.shadow_height_fade, 0.01f, 100000.0f);
    config->foot_ao_radius = sanitize_float(config->foot_ao_radius, def.foot_ao_radius, 0.02f, 2.0f);
    config->foot_ao_strength = sanitize_float(config->foot_ao_strength, def.foot_ao_strength, 0.0f, 1.0f);
    config->floor_tint_mix = sanitize_float(config->floor_tint_mix, def.floor_tint_mix, 0.0f, 1.0f);
    config->contact_light_strength = sanitize_float(config->contact_light_strength, def.contact_light_strength, 0.0f, 1.0f);

    config->edge_outline_strength = sanitize_float(config->edge_outline_strength, def.edge_outline_strength, 0.0f, 1.0f);
    config->edge_grime_strength = sanitize_float(config->edge_grime_strength, def.edge_grime_strength, 0.0f, 1.0f);
    config->edge_alpha_threshold = sanitize_float(config->edge_alpha_threshold, def.edge_alpha_threshold, 0.01f, 0.99f);
    config->edge_alpha_feather = sanitize_float(config->edge_alpha_feather, def.edge_alpha_feather, 0.0f, 0.5f);

    config->variation_strength = sanitize_float(config->variation_strength, def.variation_strength, 0.0f, 1.0f);
    config->macro_strength = sanitize_float(config->macro_strength, def.macro_strength, 0.0f, 1.0f);
    config->bevel_strength = sanitize_float(config->bevel_strength, def.bevel_strength, 0.0f, 1.0f);
    config->corner_ao_strength = sanitize_float(config->corner_ao_strength, def.corner_ao_strength, 0.0f, 1.0f);
    config->surface_edge_width = sanitize_float(config->surface_edge_width, def.surface_edge_width, 0.1f, 1000.0f);

    config->fog_height_density = sanitize_float(config->fog_height_density, def.fog_height_density, 0.0f, 1.0f);
    config->fog_base_height = sanitize_float(config->fog_base_height, def.fog_base_height, -100000.0f, 100000.0f);
    config->fog_height_falloff = sanitize_float(config->fog_height_falloff, def.fog_height_falloff, 0.0f, 100.0f);
    config->haze_strength = sanitize_float(config->haze_strength, def.haze_strength, 0.0f, 1.0f);

    if (config->sky_layer_count < 0) config->sky_layer_count = 0;
    if (config->sky_layer_count > 4) config->sky_layer_count = 4;
    for (int i = 0; i < 4; ++i) {
        config->sky_parallax[i] = sanitize_float(config->sky_parallax[i], def.sky_parallax[i], 0.0f, 10.0f);
        config->sky_scale[i] = sanitize_float(config->sky_scale[i], def.sky_scale[i], 0.05f, 10.0f);
        config->sky_offset[i] = sanitize_float(config->sky_offset[i], def.sky_offset[i], -10.0f, 10.0f);
        config->sky_alpha[i] = sanitize_float(config->sky_alpha[i], def.sky_alpha[i], 0.0f, 1.0f);
    }
    config->sun_azimuth = sanitize_float(config->sun_azimuth, def.sun_azimuth, -1000.0f, 1000.0f);
    config->sun_elevation = sanitize_float(config->sun_elevation, def.sun_elevation, -1000.0f, 1000.0f);
    config->sun_size = sanitize_float(config->sun_size, def.sun_size, 0.0f, 1.0f);
    config->sun_glow = sanitize_float(config->sun_glow, def.sun_glow, 0.0f, 2.0f);
    config->sky_scroll_speed = sanitize_float(config->sky_scroll_speed, def.sky_scroll_speed, 0.0f, 10.0f);

    if (config->shaft_budget < 0) config->shaft_budget = 0;
    if (config->shaft_budget > 8) config->shaft_budget = 8;
    config->shaft_length = sanitize_float(config->shaft_length, def.shaft_length, 1.0f, 100000.0f);
    config->shaft_width = sanitize_float(config->shaft_width, def.shaft_width, 0.5f, 10000.0f);
    config->shaft_opacity = sanitize_float(config->shaft_opacity, def.shaft_opacity, 0.0f, 1.0f);
    config->shaft_fade = sanitize_float(config->shaft_fade, def.shaft_fade, 0.01f, 1.0f);
    if (config->sky_profile < 0 || config->sky_profile > 3) config->sky_profile = def.sky_profile;
    if (config->weather_type < 0 || config->weather_type > 4) config->weather_type = def.weather_type;
    config->weather_density = sanitize_float(config->weather_density, def.weather_density, 0.0f, 1.0f);
    if (config->distant_cards < 0) config->distant_cards = 0;
    if (config->distant_cards > 4) config->distant_cards = 4;
    config->liquid_distortion = sanitize_float(config->liquid_distortion, def.liquid_distortion, 0.0f, 1.0f);
    config->liquid_scroll_speed = sanitize_float(config->liquid_scroll_speed, def.liquid_scroll_speed, 0.0f, 10.0f);
    config->liquid_highlight = sanitize_float(config->liquid_highlight, def.liquid_highlight, 0.0f, 1.0f);
    config->liquid_foam = sanitize_float(config->liquid_foam, def.liquid_foam, 0.0f, 1.0f);
    return true;
}

void r2d_world_render_counters_reset(R2DWorldRenderCounters *counters)
{
    if (counters) memset(counters, 0, sizeof(*counters));
}

float r2d_world_render_contact_alpha(float distance, float radius, float softness,
                                     float height_gap, float height_fade)
{
    if (!isfinite(distance) || !isfinite(radius) || !(radius > 0.0f)) return 0.0f;
    if (distance < 0.0f) distance = 0.0f;
    float d = distance / radius;
    if (d >= 1.0f) return 0.0f;
    softness = clampf(isfinite(softness) ? softness : 0.65f, 0.05f, 1.0f);
    float inner = 1.0f - softness;
    float radial;
    if (d <= inner) {
        radial = 1.0f;
    } else {
        radial = 1.0f - smoothstep01(inner, 1.0f, d);
    }

    float fade = 1.0f;
    if (isfinite(height_gap) && isfinite(height_fade) && height_fade > 0.0f) {
        if (height_gap < 0.0f) height_gap = 0.0f;
        fade = 1.0f - smoothstep01(0.0f, height_fade, height_gap);
    } else if (isfinite(height_gap) && height_gap > 0.0f) {
        fade = 0.0f;
    }
    return clamp01(radial * fade);
}

float r2d_world_render_foot_ao(float distance, float radius, float strength)
{
    if (!isfinite(distance) || !isfinite(radius) || !(radius > 0.0f)) return 0.0f;
    if (distance < 0.0f) distance = 0.0f;
    float d = distance / radius;
    if (d >= 1.0f) return 0.0f;
    float core = 1.0f - smoothstep01(0.0f, 1.0f, d);
    strength = clamp01(isfinite(strength) ? strength : 0.0f);
    return clamp01(core * strength);
}

float r2d_world_render_fog_factor(float distance, float height,
                                  const R2DWorldRenderFeatures *config)
{
    R2DWorldRenderFeatures def;
    if (!config) {
        r2d_world_render_defaults(&def);
        config = &def;
    }
    if (!isfinite(distance) || distance < 0.0f) distance = 0.0f;
    if (!isfinite(height)) height = config->fog_base_height;
    float above = height - config->fog_base_height;
    if (above < 0.0f) above = 0.0f;
    double optical = 0.002 * (double)distance +
                     (double)config->fog_height_density * (double)above *
                     (double)config->fog_height_falloff;
    if (optical < 0.0) optical = 0.0;
    return clamp01((float)(1.0 - exp(-optical)));
}

void r2d_world_render_haze_mix(const float fog_rgb[3], const float sky_rgb[3],
                               float amount, float out_rgb[3])
{
    if (!out_rgb) return;
    amount = clamp01(isfinite(amount) ? amount : 0.0f);
    for (int c = 0; c < 3; ++c) {
        float f = fog_rgb && isfinite(fog_rgb[c]) ? fog_rgb[c] : 0.0f;
        float s = sky_rgb && isfinite(sky_rgb[c]) ? sky_rgb[c] : f;
        out_rgb[c] = clamp01(f + (s - f) * amount);
    }
}

void r2d_world_render_variation(uint32_t surface, int kind, uint32_t seed,
                                float strength, float out_tint[3], float out_uv[2])
{
    strength = clamp01(isfinite(strength) ? strength : 0.0f);
    uint32_t h0 = r2d_world_render_hash(seed, surface * 3u + (uint32_t)kind);
    uint32_t h1 = r2d_world_render_hash(seed ^ 0x85ebca6bu, surface * 7u + (uint32_t)kind + 1u);
    uint32_t h2 = r2d_world_render_hash(seed ^ 0xc2b2ae35u, surface * 11u + (uint32_t)kind + 2u);
    float n0 = (float)(h0 & 0x00ffffffu) / 16777216.0f;
    float n1 = (float)(h1 & 0x00ffffffu) / 16777216.0f;
    float n2 = (float)(h2 & 0x00ffffffu) / 16777216.0f;
    float span = 0.22f * strength;
    if (out_tint) {
        out_tint[0] = 1.0f + (n0 * 2.0f - 1.0f) * span;
        out_tint[1] = 1.0f + (n1 * 2.0f - 1.0f) * span;
        out_tint[2] = 1.0f + (n2 * 2.0f - 1.0f) * span;
    }
    if (out_uv) {
        out_uv[0] = n1;
        out_uv[1] = n2;
    }
}

float r2d_world_render_edge_alpha(float alpha, float threshold, float feather)
{
    alpha = clamp01(isfinite(alpha) ? alpha : 0.0f);
    threshold = clampf(isfinite(threshold) ? threshold : 0.45f, 0.01f, 0.99f);
    feather = clampf(isfinite(feather) ? feather : 0.0f, 0.0f, 0.5f);
    if (feather <= 0.0f) return alpha >= threshold ? 1.0f : 0.0f;
    float lo = threshold - feather * 0.5f;
    float hi = threshold + feather * 0.5f;
    return smoothstep01(lo, hi, alpha);
}

float r2d_world_render_ao_lite(float edge_a, float edge_b, float width,
                               float corner_ao, float bevel)
{
    width = isfinite(width) ? width : 0.0f;
    if (width <= 0.0f) return 1.0f;
    edge_a = edge_a > 0.0f ? edge_a : 0.0f;
    edge_b = edge_b > 0.0f ? edge_b : 0.0f;
    float a = smoothstep01(0.0f, width, edge_a);
    float b = smoothstep01(0.0f, width, edge_b);
    corner_ao = clamp01(isfinite(corner_ao) ? corner_ao : 0.0f);
    bevel = clamp01(isfinite(bevel) ? bevel : 0.0f);
    float ao = 1.0f - corner_ao * (1.0f - a) * (1.0f - b);
    ao -= bevel * 0.25f * (1.0f - (a < b ? a : b));
    return clamp01(ao);
}

void r2d_world_render_sky_layer(int layer, const R2DWorldRenderFeatures *config,
                                float *out_parallax, float *out_scale,
                                float *out_offset, float *out_alpha)
{
    if (!out_parallax || !out_scale || !out_offset || !out_alpha) return;
    *out_parallax = *out_scale = *out_offset = *out_alpha = 0.0f;
    if (!config || layer < 0 || layer >= 4 || layer >= config->sky_layer_count) return;
    *out_parallax = config->sky_parallax[layer];
    *out_scale = config->sky_scale[layer];
    *out_offset = config->sky_offset[layer];
    *out_alpha = config->sky_alpha[layer];
}

void r2d_world_render_sun_direction(float azimuth, float elevation, float out[3])
{
    if (!out) return;
    if (!isfinite(azimuth)) azimuth = 0.0f;
    if (!isfinite(elevation)) elevation = 0.0f;
    double ce = cos((double)elevation);
    out[0] = (float)(ce * cos((double)azimuth));
    out[1] = (float)(ce * sin((double)azimuth));
    out[2] = (float)sin((double)elevation);
}

void r2d_world_render_liquid_uv(float u, float v, float time,
                                const R2DWorldRenderFeatures *config,
                                float out_uv[2], float *out_foam)
{
    R2DWorldRenderFeatures def;
    if (!config) {
        r2d_world_render_defaults(&def);
        config = &def;
    }
    if (!isfinite(u)) u = 0.0f;
    if (!isfinite(v)) v = 0.0f;
    if (!isfinite(time)) time = 0.0f;
    float scroll = time * config->liquid_scroll_speed;
    float dist = config->liquid_distortion;
    if (out_uv) {
        out_uv[0] = u + sinf(v * 0.35f + scroll) * dist;
        out_uv[1] = v + cosf(u * 0.29f + scroll * 1.3f) * dist;
    }
    if (out_foam) {
        float wave = 0.5f + 0.5f * sinf((u + v) * 1.7f + time * 2.1f);
        *out_foam = clamp01(smoothstep01(0.55f, 0.95f, wave) * config->liquid_foam);
    }
}

// ---------------------------------------------------------------------------
// P4: light shaft cards.

static float smooth01(float x)
{
    return smoothstep01(0.0f, 1.0f, x);
}

float r2d_world_render_shaft_alpha(float along, float height_fraction,
                                   const R2DWorldRenderFeatures *config)
{
    R2DWorldRenderFeatures def;
    if (!config) { r2d_world_render_defaults(&def); config = &def; }
    if (!isfinite(along) || !isfinite(height_fraction)) return 0.0f;
    along = clamp01(along);
    height_fraction = clamp01(height_fraction);
    float fade = clampf(config->shaft_fade, 0.01f, 1.0f);
    // Bright at the light end, feathered before the floor end.
    float vertical = powf(height_fraction, fade);
    float ends = smooth01(along / 0.12f) * smooth01((1.0f - along) / 0.22f);
    return clamp01(config->shaft_opacity * vertical * ends);
}

float r2d_world_render_shaft_width(float height_fraction,
                                   const R2DWorldRenderFeatures *config)
{
    R2DWorldRenderFeatures def;
    if (!config) { r2d_world_render_defaults(&def); config = &def; }
    if (!isfinite(height_fraction)) height_fraction = 0.0f;
    height_fraction = clamp01(height_fraction);
    return config->shaft_width * (1.0f + 0.45f * height_fraction);
}

// ---------------------------------------------------------------------------
// P4: contact lighting 2.0.

void r2d_world_render_contact_light(float dx, float dy, const float light_rgb[3],
                                    float intensity, const float ambient_rgb[3],
                                    float out_dir[2], float out_rgb[3])
{
    if (out_dir) { out_dir[0] = out_dir[1] = 0.0f; }
    if (out_rgb) for (int c = 0; c < 3; ++c) out_rgb[c] = 1.0f;
    if (!out_dir || !out_rgb) return;
    if (!isfinite(dx) || !isfinite(dy) || !isfinite(intensity)) return;
    intensity = clampf(intensity, 0.0f, 8.0f);
    float dist = sqrtf(dx * dx + dy * dy);
    if (dist > 1e-6f) {
        out_dir[0] = dx / dist;
        out_dir[1] = dy / dist;
    }
    float falloff = 1.0f / (1.0f + dist * dist * 0.0025f);
    float mix = clamp01(intensity * falloff);
    for (int c = 0; c < 3; ++c) {
        float a = ambient_rgb && isfinite(ambient_rgb[c]) ? clamp01(ambient_rgb[c]) : 0.5f;
        float l = light_rgb && isfinite(light_rgb[c]) ? clamp01(light_rgb[c]) : 1.0f;
        out_rgb[c] = clamp01(a * (1.0f - mix) + l * mix);
    }
}

// ---------------------------------------------------------------------------
// P4: baked ambient / AO-lite field.

bool r2d_world_ambient_bake(R2DWorldAmbientField *field,
                            float x0, float y0, float w, float h,
                            int cells_x, int cells_y,
                            const float *floor_h, const float *ceiling_h,
                            const float sky_rgb[3], float sky_bias)
{
    if (!field) return false;
    memset(field, 0, sizeof(*field));
    if (cells_x < 1 || cells_y < 1 || cells_x > R2D_WORLD_AMBIENT_MAX ||
        cells_y > R2D_WORLD_AMBIENT_MAX || !isfinite(w) || !isfinite(h) ||
        !(w > 0.0f) || !(h > 0.0f) || !isfinite(x0) || !isfinite(y0)) return false;
    float sky[3] = {0.75f, 0.83f, 0.92f};
    if (sky_rgb) for (int c = 0; c < 3; ++c) if (isfinite(sky_rgb[c])) sky[c] = clamp01(sky_rgb[c]);
    sky_bias = clamp01(isfinite(sky_bias) ? sky_bias : 0.5f);
    field->width = cells_x;
    field->height = cells_y;
    field->x0 = x0;
    field->y0 = y0;
    field->cell_w = w / (float)cells_x;
    field->cell_h = h / (float)cells_y;
    int count = cells_x * cells_y;
    for (int i = 0; i < count; ++i) {
        float floor = floor_h && isfinite(floor_h[i]) ? floor_h[i] : 0.0f;
        float ceiling = ceiling_h && isfinite(ceiling_h[i]) ? ceiling_h[i] : 256.0f;
        float gap = ceiling - floor;
        if (!isfinite(gap) || gap < 0.0f) gap = 0.0f;
        // A 512-unit open interval reads as fully sky-lit; low ceilings darken.
        float openness = clamp01(gap / 512.0f);
        float bounce = 0.12f * (1.0f - openness);
        float ao = clamp01(1.0f - openness * (0.55f + 0.45f * sky_bias));
        field->occlusion[i] = ao;
        for (int c = 0; c < 3; ++c)
            field->ambient[i * 3 + c] = clamp01(sky[c] * (0.35f + 0.65f * openness) *
                                                (0.85f + 0.30f * sky_bias) + bounce);
    }
    field->valid = true;
    return true;
}

void r2d_world_ambient_sample(const R2DWorldAmbientField *field,
                              float x, float y,
                              float out_rgb[3], float *out_occlusion)
{
    if (out_rgb) { out_rgb[0] = out_rgb[1] = out_rgb[2] = 1.0f; }
    if (out_occlusion) *out_occlusion = 0.0f;
    if (!field || !field->valid || !isfinite(x) || !isfinite(y)) return;
    float fx = (x - field->x0) / field->cell_w - 0.5f;
    float fy = (y - field->y0) / field->cell_h - 0.5f;
    if (fx < -0.5f || fy < -0.5f || fx > (float)field->width - 0.5f ||
        fy > (float)field->height - 0.5f) return;
    if (fx < 0.0f) fx = 0.0f;
    if (fy < 0.0f) fy = 0.0f;
    if (fx > (float)(field->width - 1)) fx = (float)(field->width - 1);
    if (fy > (float)(field->height - 1)) fy = (float)(field->height - 1);
    int x0 = (int)fx, y0 = (int)fy;
    int x1 = x0 + 1 < field->width ? x0 + 1 : x0;
    int y1 = y0 + 1 < field->height ? y0 + 1 : y0;
    float tx = fx - (float)x0, ty = fy - (float)y0;
    int i00 = y0 * field->width + x0, i10 = y0 * field->width + x1;
    int i01 = y1 * field->width + x0, i11 = y1 * field->width + x1;
    if (out_rgb) for (int c = 0; c < 3; ++c) {
        float a = field->ambient[i00 * 3 + c] * (1.0f - tx) + field->ambient[i10 * 3 + c] * tx;
        float b = field->ambient[i01 * 3 + c] * (1.0f - tx) + field->ambient[i11 * 3 + c] * tx;
        out_rgb[c] = clamp01(a * (1.0f - ty) + b * ty);
    }
    if (out_occlusion) {
        float a = field->occlusion[i00] * (1.0f - tx) + field->occlusion[i10] * tx;
        float b = field->occlusion[i01] * (1.0f - tx) + field->occlusion[i11] * tx;
        *out_occlusion = clamp01(a * (1.0f - ty) + b * ty);
    }
}

// ---------------------------------------------------------------------------
// P4: surface detail layers.

void r2d_world_render_detail_layer(uint32_t surface, int layer, uint32_t seed,
                                   float base_u, float base_v,
                                   float out_uv[2], float *out_weight)
{
    if (out_uv) { out_uv[0] = isfinite(base_u) ? base_u : 0.0f; out_uv[1] = isfinite(base_v) ? base_v : 0.0f; }
    if (out_weight) *out_weight = 0.0f;
    if (!out_uv || layer < 0 || layer >= R2D_WORLD_DETAIL_LAYERS) return;
    uint32_t h0 = r2d_world_render_hash(seed, surface * 5u + (uint32_t)layer);
    uint32_t h1 = r2d_world_render_hash(seed ^ 0x27d4eb2fu, surface * 13u + (uint32_t)layer + 7u);
    float n0 = (float)(h0 & 0x00ffffffu) / 16777216.0f;
    float n1 = (float)(h1 & 0x00ffffffu) / 16777216.0f;
    float u = isfinite(base_u) ? base_u : 0.0f;
    float v = isfinite(base_v) ? base_v : 0.0f;
    switch (layer) {
    case R2D_WORLD_DETAIL_BASE:
        if (out_weight) *out_weight = 1.0f;
        break;
    case R2D_WORLD_DETAIL_DETAIL:
        out_uv[0] = u * 4.0f + n0; out_uv[1] = v * 4.0f + n1;
        if (out_weight) *out_weight = 0.35f;
        break;
    case R2D_WORLD_DETAIL_MACRO:
        out_uv[0] = u * 0.35f + n1 * 0.5f; out_uv[1] = v * 0.35f + n0 * 0.5f;
        if (out_weight) *out_weight = 0.25f;
        break;
    case R2D_WORLD_DETAIL_EMISSIVE:
        out_uv[0] = u * 2.0f + n0 * 0.25f; out_uv[1] = v * 2.0f + n1 * 0.25f;
        if (out_weight) *out_weight = 0.5f;
        break;
    case R2D_WORLD_DETAIL_NORMAL:
        out_uv[0] = u * 3.0f + n1 * 0.75f; out_uv[1] = v * 3.0f + n0 * 0.75f;
        if (out_weight) *out_weight = 0.5f;
        break;
    default:
        break;
    }
}

int r2d_world_render_sprite_direction(float yaw, int directions)
{
    if (!isfinite(yaw) || directions < 1) directions = 16;
    if (directions > 64) directions = 64;
    float turns = yaw / 6.283185307179586f;
    turns -= floorf(turns);
    int dir = (int)floorf(turns * (float)directions + 0.5f);
    if (dir >= directions) dir = 0;
    if (dir < 0) dir += directions;
    return dir;
}

// ---------------------------------------------------------------------------
// P4: decals 2.0.

bool r2d_world_decal2_init(R2DWorldDecal2 *decal, int material,
                           float u, float v, float w, float h,
                           float rotation, float scale,
                           float life, float fade_in, float fade_out,
                           float seed)
{
    if (!decal) return false;
    memset(decal, 0, sizeof(*decal));
    if (material < 0 || !(w > 0.0f) || !(h > 0.0f) || !isfinite(u) || !isfinite(v) ||
        !isfinite(rotation) || !isfinite(scale) || !isfinite(life) || !(life > 0.0f) ||
        !isfinite(fade_in) || !isfinite(fade_out) || !isfinite(seed) ||
        fade_in < 0.0f || fade_out < 0.0f) return false;
    decal->material = material;
    decal->u = u; decal->v = v; decal->w = w; decal->h = h;
    decal->rotation = rotation;
    decal->scale = clampf(scale, 0.25f, 4.0f);
    decal->life = life;
    decal->max_life = life;
    decal->fade_in = fade_in;
    decal->fade_out = fade_out;
    decal->seed = seed;
    decal->active = true;
    return true;
}

bool r2d_world_decal2_step(R2DWorldDecal2 *decal, float dt)
{
    if (!decal || !decal->active) return false;
    if (!isfinite(dt) || dt < 0.0f) dt = 0.0f;
    if (dt > 1.0f) dt = 1.0f;
    decal->life -= dt;
    if (decal->life <= 0.0f) {
        decal->life = 0.0f;
        decal->active = false;
    }
    return decal->active;
}

float r2d_world_decal2_eval(const R2DWorldDecal2 *decal,
                            float *out_rotation, float *out_scale)
{
    if (out_rotation) *out_rotation = 0.0f;
    if (out_scale) *out_scale = 1.0f;
    if (!decal || !decal->active || !(decal->max_life > 0.0f)) return 0.0f;
    float age = decal->max_life - decal->life;
    float alpha = 1.0f;
    if (decal->fade_in > 0.0f) alpha = fminf(alpha, clamp01(age / decal->fade_in));
    if (decal->fade_out > 0.0f) alpha = fminf(alpha, clamp01(decal->life / decal->fade_out));
    uint32_t h = r2d_world_render_hash((uint32_t)(decal->seed * 1000.0f), decal->material + 17u);
    float n = (float)(h & 0x00ffffffu) / 16777216.0f;
    if (out_rotation) *out_rotation = decal->rotation + (n - 0.5f) * 0.35f;
    if (out_scale) *out_scale = decal->scale * (0.85f + 0.30f * n);
    return clamp01(alpha);
}

// ---------------------------------------------------------------------------
// P4: static batching and residency hooks.

void r2d_world_render_batch_key(R2DWorldBatchKey *key, int material, int blend,
                                int light_policy, int atlas)
{
    if (!key) return;
    key->material = material >= 0 ? material : -1;
    key->blend = blend;
    key->light_policy = light_policy >= 0 ? light_policy : -1;
    key->atlas = atlas >= 0 ? atlas : -1;
}

uint32_t r2d_world_render_batch_hash(const R2DWorldBatchKey *key)
{
    if (!key) return 0;
    uint32_t h = 0x9e3779b9u;
    h = mix32(h ^ (uint32_t)(key->material + 1));
    h = mix32(h ^ ((uint32_t)key->blend * 0x85ebca6bu + 0x27d4eb2fu));
    h = mix32(h ^ (uint32_t)(key->light_policy + 1) * 0x165667b1u);
    h = mix32(h ^ (uint32_t)(key->atlas + 1) * 0xc2b2ae35u);
    return h;
}

void r2d_world_render_batch_draw(R2DWorldBatchStats *stats,
                                 const R2DWorldBatchKey *key,
                                 R2DWorldBatchKey *previous, bool *has_previous)
{
    if (!stats || !key) return;
    stats->draws += 1;
    bool same = previous && has_previous && *has_previous &&
                previous->material == key->material && previous->blend == key->blend &&
                previous->light_policy == key->light_policy && previous->atlas == key->atlas;
    if (!same) {
        stats->batches += 1;
        stats->runs += 1;
    } else {
        stats->saved += 1;
    }
    if (previous) *previous = *key;
    if (has_previous) *has_previous = true;
}

void r2d_world_residency_init(R2DWorldResidency *residency, size_t budget_bytes,
                              size_t upload_bytes_budget)
{
    if (!residency) return;
    memset(residency, 0, sizeof(*residency));
    residency->budget_bytes = budget_bytes;
    residency->upload_bytes_budget = upload_bytes_budget;
}

bool r2d_world_residency_admit(R2DWorldResidency *residency, size_t bytes)
{
    if (!residency) return false;
    if (bytes > residency->budget_bytes || residency->resident_bytes + bytes > residency->budget_bytes) {
        residency->pending += 1;
        return false;
    }
    residency->resident += 1;
    residency->resident_bytes += bytes;
    return true;
}

size_t r2d_world_residency_upload(R2DWorldResidency *residency, size_t bytes)
{
    if (!residency) return 0;
    size_t allowed = residency->upload_bytes_budget;
    if (bytes > allowed) bytes = allowed;
    residency->uploaded_bytes += bytes;
    return bytes;
}
