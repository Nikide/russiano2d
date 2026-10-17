#include "re2d_world_post.h"

#include <math.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

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

static uint8_t clamp_byte(float v)
{
    if (!(v > 0.0f)) return 0;
    if (v > 255.0f) return 255;
    return (uint8_t)(v + 0.5f);
}

void r2d_world_post_defaults(R2DWorldPostConfig *config)
{
    if (!config) return;
    memset(config, 0, sizeof(*config));
    config->bloom = true;
    config->bloom_threshold = 0.68f;
    config->bloom_knee = 0.18f;
    config->bloom_intensity = 0.55f;
    config->bloom_radius = 0.035f;
    config->bloom_taps = 8;
    config->reflection = false;
    config->reflection_strength = 0.22f;
    config->reflection_roughness = 0.65f;
    config->heat = true;
    config->heat_strength = 0.006f;
    config->heat_frequency = 24.0f;
    config->heat_speed = 3.2f;
    config->heat_depth_start = 24.0f;
    config->heat_depth_scale = 320.0f;
}

bool r2d_world_post_validate(R2DWorldPostConfig *config)
{
    if (!config) return false;
    R2DWorldPostConfig def;
    r2d_world_post_defaults(&def);
    config->bloom_threshold = sanitize(config->bloom_threshold, def.bloom_threshold, 0.0f, 1.0f);
    config->bloom_knee = sanitize(config->bloom_knee, def.bloom_knee, 0.001f, 1.0f);
    config->bloom_intensity = sanitize(config->bloom_intensity, def.bloom_intensity, 0.0f, 4.0f);
    config->bloom_radius = sanitize(config->bloom_radius, def.bloom_radius, 0.0f, 0.25f);
    if (config->bloom_taps < 0) config->bloom_taps = 0;
    if (config->bloom_taps > R2D_WORLD_POST_MAX_TAPS) config->bloom_taps = R2D_WORLD_POST_MAX_TAPS;
    config->reflection_strength = sanitize(config->reflection_strength, def.reflection_strength, 0.0f, 1.0f);
    config->reflection_roughness = sanitize(config->reflection_roughness, def.reflection_roughness, 0.0f, 1.0f);
    config->heat_strength = sanitize(config->heat_strength, def.heat_strength, 0.0f, 0.05f);
    config->heat_frequency = sanitize(config->heat_frequency, def.heat_frequency, 0.0f, 80.0f);
    config->heat_speed = sanitize(config->heat_speed, def.heat_speed, 0.0f, 20.0f);
    config->heat_depth_start = sanitize(config->heat_depth_start, def.heat_depth_start, 0.0f, 100000.0f);
    config->heat_depth_scale = sanitize(config->heat_depth_scale, def.heat_depth_scale, 0.001f, 100000.0f);
    return true;
}

void r2d_world_post_counters_reset(R2DWorldPostCounters *counters)
{
    if (counters) memset(counters, 0, sizeof(*counters));
}

float r2d_world_post_bloom_weight(float luma, const R2DWorldPostConfig *config)
{
    R2DWorldPostConfig def;
    if (!config) { r2d_world_post_defaults(&def); config = &def; }
    if (!isfinite(luma) || luma <= config->bloom_threshold) return 0.0f;
    float knee = config->bloom_knee > 0.001f ? config->bloom_knee : 0.001f;
    float t = clampf((luma - config->bloom_threshold) / knee, 0.0f, 1.0f);
    t = t * t * (3.0f - 2.0f * t);
    return clampf(t, 0.0f, 1.0f);
}

bool r2d_world_post_bloom_tap(const R2DWorldPostConfig *config, int index,
                              float out_xy[2])
{
    if (out_xy) out_xy[0] = out_xy[1] = 0.0f;
    if (!config || !config->bloom || index < 0 || index >= config->bloom_taps ||
        config->bloom_taps <= 0 || config->bloom_taps > R2D_WORLD_POST_MAX_TAPS) return false;
    float angle = 6.283185307179586f * (float)index / (float)config->bloom_taps;
    float radius = clampf(config->bloom_radius * 8.0f, 0.05f, 1.0f);
    if (out_xy) {
        out_xy[0] = cosf(angle) * radius;
        out_xy[1] = sinf(angle) * radius;
    }
    return true;
}

void r2d_world_post_reflection_uv(float u, float v, float n_dot_v,
                                  float roughness, float strength,
                                  float out_uv[2], float *out_weight)
{
    if (out_uv) { out_uv[0] = isfinite(u) ? u : 0.0f; out_uv[1] = isfinite(v) ? v : 0.0f; }
    if (out_weight) *out_weight = 0.0f;
    if (!out_uv) return;
    float rough = clampf(isfinite(roughness) ? roughness : 1.0f, 0.0f, 1.0f);
    float s = clampf(isfinite(strength) ? strength : 0.0f, 0.0f, 1.0f);
    float ndv = clampf(isfinite(n_dot_v) ? n_dot_v : 1.0f, -1.0f, 1.0f);
    float fresnel = 1.0f - fabsf(ndv);
    fresnel *= fresnel;
    float weight = clampf(s * (1.0f - rough) * fresnel, 0.0f, 1.0f);
    out_uv[0] = clampf(out_uv[0], 0.0f, 1.0f);
    out_uv[1] = clampf(1.0f - out_uv[1], 0.0f, 1.0f);
    if (out_weight) *out_weight = weight;
}

float r2d_world_post_heat_mask(float sx, float sy, float cx, float cy,
                               float rx, float ry, float falloff)
{
    if (!isfinite(sx) || !isfinite(sy) || !isfinite(cx) || !isfinite(cy) ||
        !isfinite(rx) || !isfinite(ry) || !(rx > 0.0f) || !(ry > 0.0f)) return 0.0f;
    float dx = (sx - cx) / rx;
    float dy = (sy - cy) / ry;
    float d = sqrtf(dx * dx + dy * dy);
    if (d >= 1.0f) return 0.0f;
    float f = clampf(isfinite(falloff) ? falloff : 0.35f, 0.01f, 1.0f);
    float inner = 1.0f - f;
    if (d <= inner) return 1.0f;
    float t = clampf((1.0f - d) / f, 0.0f, 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

float r2d_world_post_heat_offset(float u, float v, float time, float depth,
                                 float mask, const R2DWorldPostConfig *config,
                                 float out_uv[2])
{
    if (out_uv) { out_uv[0] = isfinite(u) ? u : 0.0f; out_uv[1] = isfinite(v) ? v : 0.0f; }
    R2DWorldPostConfig def;
    if (!config) { r2d_world_post_defaults(&def); config = &def; }
    if (!config->heat || !out_uv) return 0.0f;
    if (!isfinite(u) || !isfinite(v) || !isfinite(time) || !isfinite(depth) || !isfinite(mask)) return 0.0f;
    mask = clampf(mask, 0.0f, 1.0f);
    if (!(mask > 0.0f) || !(config->heat_strength > 0.0f)) return 0.0f;
    float start = config->heat_depth_start;
    float scale = config->heat_depth_scale > 0.001f ? config->heat_depth_scale : 0.001f;
    float att = depth <= start ? 1.0f : 1.0f - clampf((depth - start) / scale, 0.0f, 1.0f);
    float amount = config->heat_strength * att * mask;
    float phase = time * config->heat_speed;
    float freq = config->heat_frequency;
    out_uv[0] = u + sinf(v * freq + phase) * amount;
    out_uv[1] = v + cosf(u * freq * 0.8f + phase * 1.3f) * amount;
    return att * mask;
}

// --- CPU reference implementation (render regression harness) --------------

static void bloom_bright(const uint8_t *src, int w, int h,
                         const R2DWorldPostConfig *config, uint8_t *bright)
{
    int count = w * h;
    for (int i = 0; i < count; ++i) {
        const uint8_t *p = src + (size_t)i * 4u;
        float luma = (0.2126f * p[0] + 0.7152f * p[1] + 0.0722f * p[2]) / 255.0f;
        float weight = r2d_world_post_bloom_weight(luma, config);
        uint8_t *q = bright + (size_t)i * 4u;
        q[0] = clamp_byte(p[0] * weight);
        q[1] = clamp_byte(p[1] * weight);
        q[2] = clamp_byte(p[2] * weight);
        q[3] = 255;
    }
}

static void box_blur_rgba(const uint8_t *src, uint8_t *dst, int w, int h, int radius, bool horizontal)
{
    int count = w * h;
    int span = horizontal ? w : h;
    for (int line = 0; line < (horizontal ? h : w); ++line) {
        for (int x = 0; x < span; ++x) {
            int sum[3] = {0, 0, 0}, n = 0;
            for (int d = -radius; d <= radius; ++d) {
                int y = x + d;
                if (y < 0 || y >= span) continue;
                int index = horizontal ? line * w + y : y * w + line;
                const uint8_t *p = src + (size_t)index * 4u;
                sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; ++n;
            }
            int index = horizontal ? line * w + x : x * w + line;
            uint8_t *q = dst + (size_t)index * 4u;
            q[0] = (uint8_t)((n ? sum[0] / n : 0));
            q[1] = (uint8_t)((n ? sum[1] / n : 0));
            q[2] = (uint8_t)((n ? sum[2] / n : 0));
            q[3] = 255;
        }
    }
    (void)count;
}

void r2d_world_post_reference_bloom(const uint8_t *src, int w, int h,
                                    const R2DWorldPostConfig *config,
                                    uint8_t *out)
{
    if (!src || !out || w <= 0 || h <= 0) return;
    size_t bytes = (size_t)w * (size_t)h * 4u;
    R2DWorldPostConfig def;
    if (!config) { r2d_world_post_defaults(&def); config = &def; }
    if (!config->bloom || config->bloom_intensity <= 0.0f || config->bloom_taps <= 0) {
        memcpy(out, src, bytes);
        return;
    }
    uint8_t *bright = malloc(bytes);
    uint8_t *temp = malloc(bytes);
    if (!bright || !temp) {
        free(bright); free(temp);
        memcpy(out, src, bytes);
        return;
    }
    bloom_bright(src, w, h, config, bright);
    int radius = (int)(config->bloom_radius * (float)(w < h ? w : h));
    if (radius < 1) radius = 1;
    if (radius > 12) radius = 12;
    box_blur_rgba(bright, temp, w, h, radius, true);
    box_blur_rgba(temp, bright, w, h, radius, false);
    int count = w * h;
    for (int i = 0; i < count; ++i) {
        const uint8_t *p = src + (size_t)i * 4u;
        const uint8_t *b = bright + (size_t)i * 4u;
        uint8_t *q = out + (size_t)i * 4u;
        q[0] = clamp_byte(p[0] + b[0] * config->bloom_intensity);
        q[1] = clamp_byte(p[1] + b[1] * config->bloom_intensity);
        q[2] = clamp_byte(p[2] + b[2] * config->bloom_intensity);
        q[3] = p[3];
    }
    free(bright); free(temp);
}

void r2d_world_post_reference_heat(const uint8_t *src, int w, int h,
                                   const R2DWorldPostConfig *config,
                                   float time, const float *mask,
                                   uint8_t *out)
{
    if (!src || !out || w <= 0 || h <= 0) return;
    R2DWorldPostConfig def;
    if (!config) { r2d_world_post_defaults(&def); config = &def; }
    for (int y = 0; y < h; ++y) {
        for (int x = 0; x < w; ++x) {
            int i = y * w + x;
            float m = mask ? mask[i] : 1.0f;
            float u = (x + 0.5f) / (float)w;
            float v = (y + 0.5f) / (float)h;
            float uv[2];
            r2d_world_post_heat_offset(u, v, time, config->heat_depth_start, m, config, uv);
            float px = uv[0] * (float)w - 0.5f;
            float py = uv[1] * (float)h - 0.5f;
            int x0 = (int)floorf(px), y0 = (int)floorf(py);
            float tx = px - (float)x0, ty = py - (float)y0;
            int x1 = x0 + 1, y1 = y0 + 1;
            if (x0 < 0) x0 = 0; if (x0 >= w) x0 = w - 1;
            if (x1 < 0) x1 = 0; if (x1 >= w) x1 = w - 1;
            if (y0 < 0) y0 = 0; if (y0 >= h) y0 = h - 1;
            if (y1 < 0) y1 = 0; if (y1 >= h) y1 = h - 1;
            if (tx < 0.0f) tx = 0.0f; if (tx > 1.0f) tx = 1.0f;
            if (ty < 0.0f) ty = 0.0f; if (ty > 1.0f) ty = 1.0f;
            for (int c = 0; c < 4; ++c) {
                float a = src[((size_t)y0 * (size_t)w + (size_t)x0) * 4u + (size_t)c] * (1.0f - tx) +
                          src[((size_t)y0 * (size_t)w + (size_t)x1) * 4u + (size_t)c] * tx;
                float b = src[((size_t)y1 * (size_t)w + (size_t)x0) * 4u + (size_t)c] * (1.0f - tx) +
                          src[((size_t)y1 * (size_t)w + (size_t)x1) * 4u + (size_t)c] * tx;
                out[(size_t)i * 4u + (size_t)c] = clamp_byte(a * (1.0f - ty) + b * ty);
            }
        }
    }
}
