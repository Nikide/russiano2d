// ---------------------------------------------------------------------------
// Спрайтовый батчер russiano2d — фрагментная стадия, вариант для WebGPU.
//
// SDL_GPU раскладывает ресурсы графических стадий по фиксированным группам:
// группа 0 — ресурсы вершинной стадии, 1 — её юниформы, 2 — ресурсы
// фрагментной стадии, 3 — её юниформы. Поэтому текстура и сэмплер обязаны
// лежать в группе 2, причём сэмплируемая текстура идёт первой, а её сэмплер —
// сразу за ней (см. SDL_gpu.h, раздел про WGSL).
//
// В GLSL-варианте (shaders/sprite.frag.glsl) это был один sampler2D в
// set = 2, binding = 0; SDL_GPU сам разводил его на texture + sampler.
// ---------------------------------------------------------------------------

@group(2) @binding(0) var u_texture: texture_2d<f32>;
@group(2) @binding(1) var u_sampler: sampler;

@fragment
fn main(
    @location(0) v_texcoord: vec2<f32>,
    @location(1) v_color:    vec4<f32>,
) -> @location(0) vec4<f32> {
    return textureSample(u_texture, u_sampler, v_texcoord) * v_color;
}
