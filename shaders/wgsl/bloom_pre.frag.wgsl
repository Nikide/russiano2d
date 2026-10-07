// ---------------------------------------------------------------------------
// Bloom, шаг 1 (яркий проход с понижением разрешения) — вариант для WebGPU.
//
// Копия shaders/bloom_pre.frag.glsl: порог яркости с мягким коленом, четыре
// выборки крестом (цель вдвое меньше).
// ---------------------------------------------------------------------------

struct BloomParams {
    p: vec4<f32>,   // x = порог, y = колено, zw = тексель источника
};

@group(2) @binding(0) var u_src: texture_2d<f32>;
@group(2) @binding(1) var u_sampler: sampler;
@group(3) @binding(0) var<uniform> u: BloomParams;

@fragment
fn main(@location(0) v_uv: vec2<f32>) -> @location(0) vec4<f32> {
    // Вертикаль переворачивается: текстурные координаты сверху, clip-space снизу.
    let uv = vec2<f32>(v_uv.x, 1.0 - v_uv.y);
    let t = u.p.zw;

    var c = textureSample(u_src, u_sampler, uv + vec2<f32>(-t.x, -t.y)).rgb
          + textureSample(u_src, u_sampler, uv + vec2<f32>( t.x, -t.y)).rgb
          + textureSample(u_src, u_sampler, uv + vec2<f32>(-t.x,  t.y)).rgb
          + textureSample(u_src, u_sampler, uv + vec2<f32>( t.x,  t.y)).rgb;
    c = c * 0.25;

    let brightness = max(c.r, max(c.g, c.b));
    let knee = max(u.p.y, 1e-4);
    let soft = clamp(brightness - u.p.x + knee, 0.0, 2.0 * knee);
    let weight = max(soft * soft / (4.0 * knee), brightness - u.p.x) / max(brightness, 1e-4);

    return vec4<f32>(c * weight, 1.0);
}
