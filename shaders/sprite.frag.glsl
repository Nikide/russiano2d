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
// становится [[texture(0)]] / [[sampler(0)]], binding 1 — [[texture(1)]] /
// [[sampler(1)]], что совпадает с ожиданиями Metal-бэкенда SDL_GPU.
//
// Три режима одной стадии (юниформа u.p.x):
//   0 — обычный спрайт: текстура × цвет (как было);
//   1 — запись маски получателя света (§20.1): в цель уходят биты вершины.
//       Так работает проход маски: он рисует те же квады, но без текстуры;
//   2 — накопление света (§20.1): свет умножается на гейт (биты получателя из
//       маски × биты слоя источника). Гейт читается из цели половинного
//       разрешения, поэтому цена — одна выборка на фрагмент света, а не на
//       пиксель сцены.
//
// Этот же шейдер рисует треугольники и меш: у них нет своей текстуры (белая
// 1×1), а режим 0 — прежнее поведение.
// ---------------------------------------------------------------------------

layout(set = 2, binding = 0) uniform sampler2D u_texture;
// §20.1. Маска получателя света: половинное разрешение, RGBA8 = 32 бита.
layout(set = 2, binding = 1) uniform sampler2D u_mask;

layout(set = 3, binding = 0) uniform SpriteParams {
    // Раскладка совпадает с R2DSpriteParams в C (16 байт):
    //   mode — режим стадии, layer — биты слоя источника (ЦЕЛОЕ: как float
    //   денормальный бит 1 Metal гасит в ноль), inv_size — 1/размер маски.
    float mode;
    uint  layer;
    vec2  inv_size;
} u;

layout(location = 0) in vec2 v_texcoord;
layout(location = 1) in vec4 v_color;
layout(location = 3) flat in uint v_mask;

layout(location = 0) out vec4 o_color;

/** Биты из RGBA8 маски: r — младший байт, a — старший. */
uint mask_bits(vec4 texel)
{
    uvec4 b = uvec4(texel * 255.0 + 0.5);
    return b.r | (b.g << 8u) | (b.b << 16u) | (b.a << 24u);
}

/** Биты вершины в RGBA8: тот же порядок байтов, что у mask_bits. */
vec4 bits_color(uint bits)
{
    return vec4(float(bits & 0xFFu), float((bits >> 8u) & 0xFFu),
                float((bits >> 16u) & 0xFFu), float((bits >> 24u) & 0xFFu)) / 255.0;
}

void main()
{
    vec4 src = texture(u_texture, v_texcoord) * v_color;

    if (u.mode > 1.5) {
        // Свет: гейт по пересечению «что принимает пиксель» и «что излучает
        // источник». gl_FragCoord — позиция в цели света; цель маски того же
        // размера и той же проекции, поэтому координаты совпадают.
        uint receiver = mask_bits(texture(u_mask, gl_FragCoord.xy * u.inv_size));
        o_color = src * ((receiver & u.layer) != 0u ? 1.0 : 0.0);
    } else if (u.mode > 0.5) {
        // Запись маски: цвет — не картинка, а биты получателя этой вершины.
        o_color = bits_color(v_mask);
    } else {
        o_color = src;
    }
}
