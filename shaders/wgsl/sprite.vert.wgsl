// ---------------------------------------------------------------------------
// Спрайтовый батчер russiano2d — вершинная стадия, вариант для WebGPU.
//
// Копия shaders/sprite.vert.glsl в WGSL: позиции приходят уже в clip-space
// (ортопроекция запекается на CPU), юниформ-буферов нет вовсе. Поэтому у
// шейдера нет ни одной группы привязок — только атрибуты вершины.
//
// Соответствие атрибутов (SDL_GPUVertexAttribute → @location):
//   0 — a_position, FLOAT2
//   1 — a_texcoord, FLOAT2
//   2 — a_color,    UBYTE4_NORM (нормализуется в vec4<f32>)
//   3 — a_mask,     UINT (§20.1: биты получателя света)
// ---------------------------------------------------------------------------

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0)       texcoord: vec2<f32>,
    @location(1)       color:    vec4<f32>,
    // flat: биты интерполировать нельзя — на границе квада получилась бы смесь
    // масок, которой не существует.
    @location(3) @interpolate(flat) mask: u32,
};

@vertex
fn main(
    @location(0) a_position: vec2<f32>,
    @location(1) a_texcoord: vec2<f32>,
    @location(2) a_color:    vec4<f32>,
    @location(3) a_mask:     u32,
) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(a_position, 0.0, 1.0);
    out.texcoord = a_texcoord;
    out.color    = a_color;
    out.mask     = a_mask;
    return out;
}
