// ---------------------------------------------------------------------------
// Меш псевдо-3D — вершинная стадия, вариант для WebGPU.
//
// Копия shaders/mesh.vert.glsl в WGSL: позиция приходит как vec3 (clip-space
// xy + глубина z), ровно так же, как её читает конвейер меша в render.c.
// Фрагментная стадия — общая со спрайтами (shaders/sprite.frag.glsl).
// ---------------------------------------------------------------------------

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0)       texcoord: vec2<f32>,
    @location(1)       color:    vec4<f32>,
};

@vertex
fn main(
    @location(0) a_position: vec3<f32>,
    @location(1) a_texcoord: vec2<f32>,
    @location(2) a_color:    vec4<f32>,
) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(a_position, 1.0);
    out.texcoord = a_texcoord;
    out.color    = a_color;
    return out;
}
