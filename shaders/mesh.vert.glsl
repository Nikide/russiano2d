#version 450

// ---------------------------------------------------------------------------
// Меш псевдо-3D: вершина с ГЛУБИНОЙ (x, y, z, u, v, rgba).
//
// Отдельный формат от спрайтов: у них z = 0 («ближе всего»), и общий формат
// заставил бы переписать весь спрайтовый путь. Конвейер меша читает позицию
// как vec3, поэтому атрибуты не пересекаются.
//
// ВНИМАНИЕ: отрисовка меша С ЭТИМ конвейером валит Metal (код -11) на первом
// же draw, если у прохода есть цель глубины. Отрисовка отключена в
// r2d_render_draw_mesh (см. комментарий там и docs/highlevel/depth.md §4).
// ---------------------------------------------------------------------------

layout(location = 0) in vec3 a_position;   // clip-space xy + глубина z
layout(location = 1) in vec2 a_texcoord;
layout(location = 2) in vec4 a_color;      // нормализованные байты

layout(location = 0) out vec2 v_texcoord;
layout(location = 1) out vec4 v_color;

void main()
{
    gl_Position = vec4(a_position, 1.0);
    v_texcoord  = a_texcoord;
    v_color     = a_color;
}
