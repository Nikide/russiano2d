// ---------------------------------------------------------------------------
// Lightmap: композит накопленного света на сцену — вариант для WebGPU.
//
// Копия shaders/light_map.frag.glsl: конвейер создаётся с аддитивным
// смешиванием, поэтому шейдер просто отдаёт цвет света — сложение делает GPU.
// ---------------------------------------------------------------------------

struct LightMapParams {
    p: vec4<f32>,   // x — общая сила света
};

@group(2) @binding(0) var u_src: texture_2d<f32>;
@group(2) @binding(1) var u_sampler: sampler;
@group(3) @binding(0) var<uniform> u: LightMapParams;

@fragment
fn main(@location(0) v_uv: vec2<f32>) -> @location(0) vec4<f32> {
    // Цели рендера в SDL_GPU читаются перевёрнутыми по Y.
    let uv = vec2<f32>(v_uv.x, 1.0 - v_uv.y);
    let power = max(u.p.x, 0.0);
    return vec4<f32>(textureSample(u_src, u_sampler, uv).rgb * power, 1.0);
}
