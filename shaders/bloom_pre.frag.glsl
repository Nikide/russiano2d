#version 450

// ---------------------------------------------------------------------------
// Bloom, шаг 1: яркий проход с понижением разрешения.
//
// Сцена читается в текстуру половинного разрешения, остаются только пиксели
// ярче порога. Порог берётся с мягким коленом (soft knee): жёсткий порог даёт
// «звенящую» границу свечения, когда яркость ходит вокруг него.
//
// Раньше свечение было восемью выборками в одном проходе пост-обработки
// (см. post.frag.glsl, ветка «запасной путь»): оно не размывалось, поэтому
// выглядело как ореол, а не как свет. Честный bloom — отдельные проходы:
// порог, горизонтальное размытие, вертикальное, композит.
//
// Раскладка ресурсов SDL_GPU: set 2 — текстуры фрагментной стадии,
// set 3 — её юниформы (как в sprite.frag.glsl и post.frag.glsl).
// ---------------------------------------------------------------------------

layout(set = 2, binding = 0) uniform sampler2D u_src;

layout(set = 3, binding = 0) uniform BloomParams {
    vec4 p;   // x = порог яркости, y = колено, zw = тексель источника (1/w, 1/h)
} u;

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 o_color;

void main()
{
    // Вертикаль переворачивается: текстурные координаты сверху, clip-space снизу.
    vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
    vec2 t = u.p.zw;

    // Четыре выборки крестом: цель вдвое меньше, поэтому и выборок вдвое меньше.
    vec3 c = texture(u_src, uv + vec2(-t.x, -t.y)).rgb
           + texture(u_src, uv + vec2( t.x, -t.y)).rgb
           + texture(u_src, uv + vec2(-t.x,  t.y)).rgb
           + texture(u_src, uv + vec2( t.x,  t.y)).rgb;
    c *= 0.25;

    const float brightness = max(c.r, max(c.g, c.b));
    const float knee = max(u.p.y, 1e-4);
    const float soft = clamp(brightness - u.p.x + knee, 0.0, 2.0 * knee);
    const float weight = max(soft * soft / (4.0 * knee), brightness - u.p.x)
                       / max(brightness, 1e-4);

    o_color = vec4(c * weight, 1.0);
}
