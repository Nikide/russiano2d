#version 450

// ---------------------------------------------------------------------------
// Спрайтовый батчер russiano2d — фрагментная стадия.
//
// SDL_GPU раскладывает ресурсы графических стадий по фиксированным
// descriptor set'ам: set 0 — ресурсы вершинной стадии, set 1 — юниформы
// вершинной стадии, set 2 — ресурсы фрагментной стадии, set 3 — юниформы
// фрагментной стадии. Текстура во фрагментной стадии обязана лежать в set 2.
//
// При конвертации в MSL (spirv-cross --msl-decoration-binding) binding 0
// становится [[texture(0)]] / [[sampler(0)]], что совпадает с ожиданиями
// Metal-бэкенда SDL_GPU.
// ---------------------------------------------------------------------------

layout(set = 2, binding = 0) uniform sampler2D u_texture;

layout(location = 0) in vec2 v_texcoord;
layout(location = 1) in vec4 v_color;

layout(location = 0) out vec4 o_color;

void main()
{
    o_color = texture(u_texture, v_texcoord) * v_color;
}
