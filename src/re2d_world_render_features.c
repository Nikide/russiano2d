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
