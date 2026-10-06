#version 450

// ---------------------------------------------------------------------------
// Спрайтовый батчер: шейдер узла (эффекты поверх обычного спрайта).
//
// Один конвейер на все эффекты: вид и параметры приходят юниформой, поэтому
// переключение эффекта — это не новый пайплайн, а новое значение в push-
// константах. Обычные узлы (без .shader()) идут прежним конвейером
// (sprite.frag.glsl) и о юниформах не знают.
//
// Раскладка ресурсов SDL_GPU та же, что у остальных: set 2 — текстуры,
// set 3 — юниформы фрагментной стадии.
//
// Эффекты:
//   1 flash     — подсветка цветом (попадание, урон, вспышка)
//   2 dissolve  — растворение с кромкой (смерть, телепорт, призрак)
//   3 chroma    — расхождение каналов (глитч, удар, помехи)
//   4 wave      — волна по UV (жар, вода, искажение)
// ---------------------------------------------------------------------------

layout(set = 2, binding = 0) uniform sampler2D u_texture;

layout(set = 3, binding = 0) uniform SpriteFx {
    vec4 p;   // x = вид эффекта, y = p1, z = p2, w = p3 (смысл — по виду)
    vec4 c;   // цвет эффекта (rgba), альфа — «сила»
} u;

layout(location = 0) in vec2 v_texcoord;
layout(location = 1) in vec4 v_color;

layout(location = 0) out vec4 o_color;

float r2d_noise(vec2 p)
{
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main()
{
    vec2 uv = v_texcoord;
    vec4 col = texture(u_texture, uv) * v_color;

    const int kind = int(u.p.x + 0.5);

    if (kind == 1) {
        // Подсветка: тянем цвет к цвету эффекта, сохраняя форму (умножаем на
        // альфу спрайта, иначе прозрачный фон тоже засветился бы).
        const float amount = clamp(u.p.y * u.c.a, 0.0, 1.0);
        col.rgb = mix(col.rgb, u.c.rgb, amount * col.a);
    } else if (kind == 2) {
        // Растворение: шум решает, жив пиксель или нет; у кромки — цвет.
        const float threshold = clamp(u.p.y, 0.0, 1.0);
        const float n = r2d_noise(floor(uv * u.p.z));
        if (n < threshold) discard;
        const float edge = smoothstep(threshold, threshold + 0.12, n);
        col.rgb = mix(u.c.rgb, col.rgb, edge);
    } else if (kind == 3) {
        // Расхождение каналов: красный в одну сторону, синий в другую.
        const float off = u.p.y;
        col.r = texture(u_texture, uv + vec2(off, 0.0)).r * v_color.r;
        col.b = texture(u_texture, uv - vec2(off, 0.0)).b * v_color.b;
    } else if (kind == 4) {
        // Волна: UV сдвигается по вертикали, фаза — параметр времени.
        uv.x += sin(uv.y * u.p.z + u.p.w) * u.p.y;
        col = texture(u_texture, uv) * v_color;
    }

    o_color = col;
}
