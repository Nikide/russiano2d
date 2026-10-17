#include "re2d_world_sky.h"

#include <math.h>
#include <stddef.h>
#include <string.h>

// Deterministic sky model. No allocation/globals/clock.

static float clampf(float v, float lo, float hi)
{
    if (!(v > lo)) return lo;
    if (v > hi) return hi;
    return v;
}

static float sanitize(float v, float fallback, float lo, float hi)
{
    if (!isfinite(v)) v = fallback;
    return clampf(v, lo, hi);
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

static uint32_t hash2(uint32_t seed, uint32_t a, uint32_t b)
{
    return mix32(seed ^ mix32(a + 0x9e3779b9u) ^ mix32(b * 0x85ebca6bu + 0xc2b2ae35u));
}

static float unit(uint32_t h)
{
    return (float)(h & 0x00ffffffu) / 16777216.0f;
}

static float fractf(float v)
{
    if (!isfinite(v)) return 0.0f;
    return v - floorf(v);
}

static void add_weather(R2DWorldSky *sky, int type, float density, float speed,
                        float slant, float size, float opacity)
{
    if (!sky || sky->weather_count >= R2D_SKY_MAX_WEATHER) return;
    R2DWorldSkyWeather *w = &sky->weather[sky->weather_count++];
    w->type = type;
    w->density = density;
    w->speed = speed;
    w->slant = slant;
    w->size = size;
    w->opacity = opacity;
}

static void set_layer(R2DWorldSky *sky, int i, float parallax, float scale,
                      float offset, float alpha, float scroll, int texture,
                      uint32_t tint)
{
    R2DWorldSkyLayer *l = &sky->layers[i];
    l->parallax = parallax;
    l->scale = scale;
    l->offset = offset;
    l->alpha = alpha;
    l->scroll = scroll;
    l->texture = texture;
    l->tint = tint;
}

static void set_distant(R2DWorldSky *sky, int i, float parallax, float offset,
                        float alpha, float scroll, int texture, uint32_t tint)
{
    R2DWorldSkyDistant *d = &sky->distant[i];
    d->parallax = parallax;
    d->offset = offset;
    d->alpha = alpha;
    d->scroll = scroll;
    d->texture = texture;
    d->tint = tint;
}

void r2d_world_sky_defaults(R2DWorldSky *sky)
{
    if (!sky) return;
    memset(sky, 0, sizeof(*sky));
    memcpy(sky->name, "clear", 6);
    sky->layer_count = 3;
    sky->panorama_texture = -1;
    sky->panorama_tint = 0xffd9b98fu; // RGBA little-endian: #8fb9d9 sky blue
    set_layer(sky, 0, 0.02f, 1.00f, 0.00f, 1.00f, 0.0000f, -1, 0xffd9b98fu);
    set_layer(sky, 1, 0.10f, 1.35f, 0.05f, 0.55f, 0.0015f, -1, 0xffcfc2b4u);
    set_layer(sky, 2, 0.22f, 1.70f, -0.02f, 0.40f, 0.0030f, -1, 0xffb8a898u);
    set_layer(sky, 3, 0.36f, 2.10f, -0.05f, 0.30f, 0.0045f, -1, 0xffa09080u);
    sky->sun = true;
    sky->moon = false;
    sky->sun_azimuth = 2.20f;
    sky->sun_elevation = 0.42f;
    sky->sun_size = 0.030f;
    sky->sun_glow = 0.20f;
    sky->sun_color = 0xffd9f2ffu;
    sky->moon_color = 0xffe6dfd3u;
    sky->weather_count = 0;
    sky->distant_count = 2;
    set_distant(sky, 0, 0.06f, 0.02f, 0.55f, 0.0010f, -1, 0xffa8b0b8u);
    set_distant(sky, 1, 0.14f, 0.00f, 0.38f, 0.0020f, -1, 0xff9098a0u);
    sky->portal_policy = R2D_SKY_PORTAL_INHERIT;
    sky->portal_profile = R2D_SKY_PROFILE_CLEAR;
    sky->exposure = 1.0f;
    sky->cloud_fog = 0.16f;
}

bool r2d_world_sky_profile(int profile, R2DWorldSky *sky)
{
    if (!sky || profile < 0 || profile >= R2D_SKY_PROFILE_COUNT) return false;
    r2d_world_sky_defaults(sky);
    switch (profile) {
    case R2D_SKY_PROFILE_CLEAR:
        return true;
    case R2D_SKY_PROFILE_DUSK:
        memcpy(sky->name, "dusk", 5);
        sky->panorama_tint = 0xff5f8fc4u;
        sky->layer_count = 4;
        set_layer(sky, 0, 0.02f, 1.00f, 0.00f, 1.00f, 0.0000f, -1, 0xff5f8fc4u);
        set_layer(sky, 1, 0.09f, 1.30f, 0.02f, 0.60f, 0.0012f, -1, 0xff8fc3ddu);
        set_layer(sky, 2, 0.21f, 1.65f, -0.04f, 0.44f, 0.0024f, -1, 0xff7f9fb8u);
        set_layer(sky, 3, 0.37f, 2.20f, -0.08f, 0.32f, 0.0040f, -1, 0xff605878u);
        sky->sun = true;
        sky->sun_azimuth = 3.05f;
        sky->sun_elevation = 0.10f;
        sky->sun_size = 0.045f;
        sky->sun_glow = 0.32f;
        sky->sun_color = 0xff7fb6ffu;
        sky->exposure = 0.92f;
        sky->cloud_fog = 0.30f;
        add_weather(sky, R2D_SKY_WEATHER_CLOUDS, 0.35f, 0.010f, 0.15f, 2.2f, 0.32f);
        set_distant(sky, 0, 0.05f, 0.01f, 0.60f, 0.0010f, -1, 0xff9a7f8fu);
        set_distant(sky, 1, 0.13f, -0.02f, 0.45f, 0.0020f, -1, 0xff705a6au);
        return true;
    case R2D_SKY_PROFILE_NIGHT:
        memcpy(sky->name, "night", 6);
        sky->panorama_tint = 0xff2a1a10u;
        sky->layer_count = 3;
        set_layer(sky, 0, 0.02f, 1.00f, 0.00f, 1.00f, 0.0000f, -1, 0xff2a1a10u);
        set_layer(sky, 1, 0.08f, 1.25f, 0.05f, 0.48f, 0.0006f, -1, 0xff5a4030u);
        set_layer(sky, 2, 0.20f, 1.55f, -0.03f, 0.30f, 0.0012f, -1, 0xff302820u);
        sky->sun = false;
        sky->moon = true;
        sky->sun_azimuth = 4.10f;
        sky->sun_elevation = 0.55f;
        sky->sun_size = 0.026f;
        sky->sun_glow = 0.16f;
        sky->moon_color = 0xffd8e6ffu;
        sky->exposure = 0.70f;
        sky->cloud_fog = 0.08f;
        add_weather(sky, R2D_SKY_WEATHER_ASH, 0.10f, 0.015f, 0.10f, 0.6f, 0.18f);
        set_distant(sky, 0, 0.04f, 0.00f, 0.35f, 0.0006f, -1, 0xff3a3028u);
        return true;
    case R2D_SKY_PROFILE_STORM:
        memcpy(sky->name, "storm", 6);
        sky->panorama_tint = 0xff4a3a2au;
        sky->layer_count = 4;
        set_layer(sky, 0, 0.02f, 1.00f, 0.00f, 1.00f, 0.0000f, -1, 0xff4a3a2au);
        set_layer(sky, 1, 0.07f, 1.20f, 0.06f, 0.70f, 0.0040f, -1, 0xff8a7a6au);
        set_layer(sky, 2, 0.18f, 1.55f, -0.01f, 0.55f, 0.0060f, -1, 0xff6a5a4au);
        set_layer(sky, 3, 0.31f, 2.00f, -0.10f, 0.40f, 0.0080f, -1, 0xff4a3a2au);
        sky->sun = false;
        sky->moon = false;
        sky->sun_size = 0.0f;
        sky->sun_glow = 0.05f;
        sky->exposure = 0.62f;
        sky->cloud_fog = 0.55f;
        add_weather(sky, R2D_SKY_WEATHER_CLOUDS, 0.70f, 0.030f, 0.25f, 2.6f, 0.45f);
        add_weather(sky, R2D_SKY_WEATHER_RAIN, 0.60f, 0.55f, 0.35f, 1.0f, 0.40f);
        set_distant(sky, 0, 0.05f, 0.00f, 0.62f, 0.0020f, -1, 0xff7f7f6fu);
        set_distant(sky, 1, 0.15f, -0.03f, 0.45f, 0.0035f, -1, 0xff5f5f4fu);
        return true;
    default:
        return false;
    }
}

bool r2d_world_sky_validate(R2DWorldSky *sky)
{
    if (!sky) return false;
    R2DWorldSky def;
    r2d_world_sky_defaults(&def);
    sky->layer_count = (int)clampf((float)sky->layer_count, 1.0f, (float)R2D_SKY_MAX_LAYERS);
    sky->panorama_tint = sky->panorama_tint ? sky->panorama_tint : def.panorama_tint;
    sky->panorama_texture = sky->panorama_texture < -1 ? -1 : sky->panorama_texture;
    for (int i = 0; i < R2D_SKY_MAX_LAYERS; ++i) {
        R2DWorldSkyLayer *l = &sky->layers[i];
        l->parallax = sanitize(l->parallax, def.layers[i].parallax, 0.0f, 10.0f);
        l->scale = sanitize(l->scale, def.layers[i].scale, 0.05f, 10.0f);
        l->offset = sanitize(l->offset, def.layers[i].offset, -10.0f, 10.0f);
        l->alpha = sanitize(l->alpha, def.layers[i].alpha, 0.0f, 1.0f);
        l->scroll = sanitize(l->scroll, def.layers[i].scroll, -10.0f, 10.0f);
        if (l->texture < -1) l->texture = -1;
    }
    sky->sun_azimuth = sanitize(sky->sun_azimuth, def.sun_azimuth, -1000.0f, 1000.0f);
    sky->sun_elevation = sanitize(sky->sun_elevation, def.sun_elevation, -2.0f, 2.0f);
    sky->sun_size = sanitize(sky->sun_size, def.sun_size, 0.0f, 1.0f);
    sky->sun_glow = sanitize(sky->sun_glow, def.sun_glow, 0.0f, 4.0f);
    sky->exposure = sanitize(sky->exposure, def.exposure, 0.25f, 4.0f);
    sky->cloud_fog = sanitize(sky->cloud_fog, def.cloud_fog, 0.0f, 1.0f);
    sky->weather_count = (int)clampf((float)sky->weather_count, 0.0f, (float)R2D_SKY_MAX_WEATHER);
    for (int i = 0; i < R2D_SKY_MAX_WEATHER; ++i) {
        R2DWorldSkyWeather *w = &sky->weather[i];
        if (w->type < R2D_SKY_WEATHER_NONE || w->type >= R2D_SKY_WEATHER_COUNT) w->type = R2D_SKY_WEATHER_NONE;
        w->density = sanitize(w->density, 0.0f, 0.0f, 1.0f);
        w->speed = sanitize(w->speed, 0.0f, 0.0f, 20.0f);
        w->slant = sanitize(w->slant, 0.0f, -1.0f, 1.0f);
        w->size = sanitize(w->size, 1.0f, 0.25f, 4.0f);
        w->opacity = sanitize(w->opacity, 0.0f, 0.0f, 1.0f);
    }
    sky->distant_count = (int)clampf((float)sky->distant_count, 0.0f, (float)R2D_SKY_MAX_DISTANT);
    for (int i = 0; i < R2D_SKY_MAX_DISTANT; ++i) {
        R2DWorldSkyDistant *d = &sky->distant[i];
        d->parallax = sanitize(d->parallax, def.distant[i].parallax, 0.0f, 10.0f);
        d->offset = sanitize(d->offset, def.distant[i].offset, -1.0f, 1.0f);
        d->alpha = sanitize(d->alpha, def.distant[i].alpha, 0.0f, 1.0f);
        d->scroll = sanitize(d->scroll, def.distant[i].scroll, -10.0f, 10.0f);
        if (d->texture < -1) d->texture = -1;
    }
    if (sky->portal_policy < R2D_SKY_PORTAL_NONE || sky->portal_policy >= R2D_SKY_PORTAL_COUNT)
        sky->portal_policy = def.portal_policy;
    if (sky->portal_profile < 0 || sky->portal_profile >= R2D_SKY_PROFILE_COUNT)
        sky->portal_profile = def.portal_profile;
    return true;
}

void r2d_world_sky_layer_sample(const R2DWorldSky *sky, int layer,
                                float yaw, float time,
                                float out_uv[2], uint32_t *out_tint,
                                float *out_alpha)
{
    if (out_uv) out_uv[0] = out_uv[1] = 0.0f;
    if (out_tint) *out_tint = 0xffffffffu;
    if (out_alpha) *out_alpha = 0.0f;
    if (!sky || layer < 0 || layer >= sky->layer_count || layer >= R2D_SKY_MAX_LAYERS) return;
    const R2DWorldSkyLayer *l = &sky->layers[layer];
    if (!isfinite(yaw)) yaw = 0.0f;
    if (!isfinite(time)) time = 0.0f;
    float u = fractf(yaw * l->parallax * 0.15915494f + time * l->scroll + (float)layer * 0.137f);
    float v = clampf(l->offset + 0.5f * (1.0f - l->scale * 0.5f), 0.0f, 1.0f);
    if (out_uv) { out_uv[0] = u; out_uv[1] = v; }
    if (out_tint) *out_tint = l->tint;
    if (out_alpha) *out_alpha = clampf(l->alpha, 0.0f, 1.0f);
}

void r2d_world_sky_celestial(const R2DWorldSky *sky, bool moon,
                             float out_dir[3], float *out_visible,
                             float *out_size, float *out_glow,
                             uint32_t *out_color)
{
    if (out_dir) out_dir[0] = out_dir[1] = out_dir[2] = 0.0f;
    if (out_visible) *out_visible = 0.0f;
    if (out_size) *out_size = 0.0f;
    if (out_glow) *out_glow = 0.0f;
    if (out_color) *out_color = 0xffffffffu;
    if (!sky || !(moon ? sky->moon : sky->sun)) return;
    double az = (double)sky->sun_azimuth;
    double el = (double)sky->sun_elevation;
    double ce = cos(el);
    if (out_dir) {
        out_dir[0] = (float)(ce * cos(az));
        out_dir[1] = (float)(ce * sin(az));
        out_dir[2] = (float)sin(el);
    }
    if (out_visible) *out_visible = sky->sun_elevation > -0.02f ? 1.0f : 0.0f;
    if (out_size) *out_size = sky->sun_size;
    if (out_glow) *out_glow = sky->sun_glow;
    if (out_color) *out_color = moon ? sky->moon_color : sky->sun_color;
}

float r2d_world_sky_weather_weight(const R2DWorldSky *sky, int layer)
{
    if (!sky || layer < 0 || layer >= sky->weather_count || layer >= R2D_SKY_MAX_WEATHER) return 0.0f;
    if (sky->weather[layer].type == R2D_SKY_WEATHER_NONE) return 0.0f;
    float total = 0.0f;
    for (int i = 0; i < sky->weather_count && i < R2D_SKY_MAX_WEATHER; ++i)
        if (sky->weather[i].type != R2D_SKY_WEATHER_NONE) total += clampf(sky->weather[i].density, 0.0f, 1.0f);
    if (!(total > 0.0f)) return 0.0f;
    return clampf(sky->weather[layer].density, 0.0f, 1.0f) / total;
}

bool r2d_world_sky_weather_sample(const R2DWorldSky *sky, int layer, int index,
                                  float time, uint32_t seed,
                                  float out[6], int *out_type)
{
    if (out) for (int i = 0; i < 6; ++i) out[i] = 0.0f;
    if (out_type) *out_type = R2D_SKY_WEATHER_NONE;
    if (!sky || !out || index < 0 || layer < 0 || layer >= sky->weather_count ||
        layer >= R2D_SKY_MAX_WEATHER || index >= 512) return false;
    const R2DWorldSkyWeather *w = &sky->weather[layer];
    if (w->type == R2D_SKY_WEATHER_NONE || !(w->density > 0.0f) || !(w->opacity > 0.0f)) return false;
    if (!isfinite(time)) time = 0.0f;
    uint32_t h = hash2(seed, (uint32_t)(layer * 64 + index), (uint32_t)w->type);
    float lane = unit(h);
    float phase = unit(hash2(seed, (uint32_t)(layer * 64 + index), 0x51ed270bu));
    float speed = w->speed * (0.6f + 0.8f * phase);
    float y = fractf(phase + time * speed * 0.05f);
    float x = fractf(lane + time * speed * w->slant * 0.01f + sinf(time * 0.7f + phase * 6.28f) * 0.004f);
    float alpha = clampf(w->opacity * w->density, 0.0f, 1.0f);
    float length = 0.0f, width = 0.0f;
    switch (w->type) {
    case R2D_SKY_WEATHER_RAIN:
        length = 0.10f + 0.14f * phase; width = 0.008f + 0.006f * phase;
        break;
    case R2D_SKY_WEATHER_SNOW:
        length = 0.025f + 0.02f * phase; width = length; y = fractf(phase + time * speed * 0.012f);
        x = fractf(lane + sinf(time * 0.6f + phase * 6.28f) * 0.02f);
        break;
    case R2D_SKY_WEATHER_ASH:
        length = 0.012f + 0.012f * phase; width = length; y = fractf(phase + time * speed * 0.008f);
        x = fractf(lane + cosf(time * 0.45f + phase * 6.28f) * 0.015f);
        break;
    case R2D_SKY_WEATHER_CLOUDS:
        length = 0.35f + 0.30f * phase; width = 0.18f + 0.20f * phase;
        y = clampf(0.10f + 0.55f * phase, 0.0f, 0.9f);
        x = fractf(lane + time * speed * 0.004f);
        alpha *= 0.65f;
        break;
    default:
        return false;
    }
    out[0] = x;
    out[1] = y;
    out[2] = length;
    out[3] = width;
    out[4] = clampf(w->slant, -1.0f, 1.0f);
    out[5] = alpha;
    if (out_type) *out_type = w->type;
    return true;
}

void r2d_world_sky_distant_sample(const R2DWorldSky *sky, int index,
                                  float yaw, float time,
                                  float *out_x, uint32_t *out_tint,
                                  float *out_alpha)
{
    if (out_x) *out_x = 0.0f;
    if (out_tint) *out_tint = 0xffffffffu;
    if (out_alpha) *out_alpha = 0.0f;
    if (!sky || index < 0 || index >= sky->distant_count || index >= R2D_SKY_MAX_DISTANT) return;
    const R2DWorldSkyDistant *d = &sky->distant[index];
    if (!isfinite(yaw)) yaw = 0.0f;
    if (!isfinite(time)) time = 0.0f;
    if (out_x) *out_x = fractf(yaw * d->parallax * 0.15915494f + time * d->scroll + (float)index * 0.31f);
    if (out_tint) *out_tint = d->tint;
    if (out_alpha) *out_alpha = clampf(d->alpha, 0.0f, 1.0f);
}

bool r2d_world_sky_surface_visible(const R2DWorldSky *sky, bool surface_sky, bool no_draw)
{
    if (!sky || !surface_sky || no_draw) return false;
    return sky->layer_count > 0;
}

int r2d_world_sky_portal_profile(const R2DWorldSky *sky, int portal_profile_hint)
{
    if (!sky) return R2D_SKY_PROFILE_CLEAR;
    if (portal_profile_hint >= 0 && portal_profile_hint < R2D_SKY_PROFILE_COUNT)
        return portal_profile_hint;
    if (sky->portal_policy == R2D_SKY_PORTAL_PROFILE &&
        sky->portal_profile >= 0 && sky->portal_profile < R2D_SKY_PROFILE_COUNT)
        return sky->portal_profile;
    return R2D_SKY_PROFILE_CLEAR;
}
