#version 450

// ---------------------------------------------------------------------------
// Спрайтовый батчер russiano2d — вершинная стадия.
//
// Позиции приходят уже в clip-space: ортографическая проекция запекается на
// CPU при сборке батча. Это осознанное решение — у шейдера нет ни одного
// юниформ-буфера, а значит нет и риска разъехаться с раскладкой байндингов
// SDL_GPU (на Metal юниформ-буферы и вершинные буферы живут в общем
// пространстве индексов [[buffer(N)]]).
// ---------------------------------------------------------------------------

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texcoord;
layout(location = 2) in vec4 a_color;

layout(location = 0) out vec2 v_texcoord;
layout(location = 1) out vec4 v_color;

void main()
{
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texcoord  = a_texcoord;
    v_color     = a_color;
}
