// ---------------------------------------------------------------------------
// Bloom, шаг 2 (разделяемое гауссово размытие по одной оси) — вариант для WebGPU.
//
// Копия shaders/bloom_blur.frag.glsl: «dual filter», пять выборок вместо
// двадцати пяти; направление и сила приходят юниформой.
// ---------------------------------------------------------------------------

struct BlurParams {
    p: vec4<f32>,   // xy = шаг в UV (направление), z = сила размытия
};

@group(2) @binding(0) var u_src: texture_2d<f32>;
@group(2) @binding(1) var u_sampler: sampler;
@group(3) @binding(0) var<uniform> u: BlurParams;

@fragment
fn main(@location(0) v_uv: vec2<f32>) -> @location(0) vec4<f32> {
    let uv = vec2<f32>(v_uv.x, 1.0 - v_uv.y);
    let step_uv = u.p.xy * max(u.p.z, 0.0);

    var acc = textureSample(u_src, u_sampler, uv).rgb * 0.2270270270;
    acc = acc + textureSample(u_src, u_sampler, uv + step_uv * 1.3846153846).rgb * 0.3162162162;
    acc = acc + textureSample(u_src, u_sampler, uv - step_uv * 1.3846153846).rgb * 0.3162162162;
    acc = acc + textureSample(u_src, u_sampler, uv + step_uv * 3.2307692308).rgb * 0.0702702703;
    acc = acc + textureSample(u_src, u_sampler, uv - step_uv * 3.2307692308).rgb * 0.0702702703;

    return vec4<f32>(acc, 1.0);
}
