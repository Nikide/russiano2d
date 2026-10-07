// ---------------------------------------------------------------------------
// Пост-обработка russiano2d — вершинная стадия, вариант для WebGPU.
//
// Копия shaders/post.vert.glsl: полноэкранный треугольник без вершинного
// буфера, три вершины по встроенному индексу. Прямоугольник [-1,1]²
// покрывается треугольником (-1,-1), (3,-1), (-1,3) — без шва по диагонали.
// ---------------------------------------------------------------------------

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0)       uv:       vec2<f32>,
};

@vertex
fn main(@builtin(vertex_index) index: u32) -> VertexOutput {
    var out: VertexOutput;
    let p = vec2<f32>(
        f32((index << 1u) & 2u),
        f32(index & 2u),
    );
    out.uv = p;
    out.position = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
    return out;
}
