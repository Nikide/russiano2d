// ---------------------------------------------------------------------------
// Спрайтовый батчер russiano2d — фрагментная стадия, вариант для WebGPU.
//
// SDL_GPU раскладывает ресурсы графических стадий по фиксированным группам:
// группа 0 — ресурсы вершинной стадии, 1 — её юниформы, 2 — ресурсы
// фрагментной стадии, 3 — её юниформы. Поэтому текстуры и сэмплеры обязаны
// лежать в группе 2, причём сэмплируемая текстура идёт первой, а её сэмплер —
// сразу за ней (см. SDL_gpu.h, раздел про WGSL). Вторая пара —
// маска получателя света (§20.1) — занимает binding 2 и 3.
//
// В GLSL-варианте (shaders/sprite.frag.glsl) это два sampler2D в set = 2,
// binding 0 и 1; SDL_GPU сам разводит каждый на texture + sampler.
//
// Три режима одной стадии (юниформа u.p.x):
//   0 — обычный спрайт, 1 — запись маски, 2 — накопление света с гейтом.
// ---------------------------------------------------------------------------

@group(2) @binding(0) var u_texture: texture_2d<f32>;
@group(2) @binding(1) var u_sampler: sampler;
@group(2) @binding(2) var u_mask: texture_2d<f32>;
@group(2) @binding(3) var u_mask_sampler: sampler;

struct SpriteParams {
    // Раскладка совпадает с R2DSpriteParams в C (16 байт): mode, layer (целое),
    // inv_size. Слой — ЦЕЛОЕ, а не биты во float: денормальный бит 1 GPU гасит.
    mode: f32,
    layer: u32,
    inv_size: vec2<f32>,
};

@group(3) @binding(0) var<uniform> u: SpriteParams;

/** Биты из RGBA8 маски: r — младший байт, a — старший. */
fn mask_bits(texel: vec4<f32>) -> u32 {
    let b = vec4<u32>(texel * 255.0 + 0.5);
    return b.r | (b.g << 8u) | (b.b << 16u) | (b.a << 24u);
}

/** Биты вершины в RGBA8: тот же порядок байтов, что у mask_bits. */
fn bits_color(bits: u32) -> vec4<f32> {
    return vec4<f32>(f32(bits & 0xFFu), f32((bits >> 8u) & 0xFFu),
                     f32((bits >> 16u) & 0xFFu), f32((bits >> 24u) & 0xFFu)) / 255.0;
}

@fragment
fn main(
    @builtin(position) frag: vec4<f32>,
    @location(0) v_texcoord: vec2<f32>,
    @location(1) v_color:    vec4<f32>,
    @location(3) @interpolate(flat) v_mask: u32,
) -> @location(0) vec4<f32> {
    let src = textureSample(u_texture, u_sampler, v_texcoord) * v_color;

    if (u.mode > 1.5) {
        // Свет: гейт «что принимает пиксель» × «что излучает источник».
        let receiver = mask_bits(textureSample(u_mask, u_mask_sampler, frag.xy * u.inv_size));
        let gate = select(0.0, 1.0, (receiver & u.layer) != 0u);
        return src * gate;
    } else if (u.mode > 0.5) {
        return bits_color(v_mask);
    }
    return src;
}
