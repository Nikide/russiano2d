// ---------------------------------------------------------------------------
// Шейдер узла russiano2d (эффекты поверх спрайта) — вариант для WebGPU.
//
// Копия shaders/sprite_fx.frag.glsl: один конвейер на все эффекты, вид и
// параметры приходят юниформой (group 3), обычные узлы идут конвейером
// sprite.frag.wgsl и об этой юниформе не знают.
//
// Эффекты: 1 flash, 2 dissolve, 3 chroma, 4 wave.
// ---------------------------------------------------------------------------

struct SpriteFx {
    p: vec4<f32>,   // x = вид эффекта, y/z/w = параметры (смысл — по виду)
    c: vec4<f32>,   // цвет эффекта, альфа — «сила»
};

@group(2) @binding(0) var u_texture: texture_2d<f32>;
@group(2) @binding(1) var u_sampler: sampler;
@group(3) @binding(0) var<uniform> u: SpriteFx;

fn r2d_noise(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn main(
    @location(0) v_texcoord: vec2<f32>,
    @location(1) v_color:    vec4<f32>,
) -> @location(0) vec4<f32> {
    var uv = v_texcoord;
    var col = textureSample(u_texture, u_sampler, uv) * v_color;

    let kind = i32(u.p.x + 0.5);

    if (kind == 1) {
        // Подсветка: тянем цвет к цвету эффекта, сохраняя форму (умножаем на
        // альфу спрайта, иначе прозрачный фон тоже засветился бы).
        let amount = clamp(u.p.y * u.c.a, 0.0, 1.0);
        col = vec4<f32>(mix(col.rgb, u.c.rgb, amount * col.a), col.a);
    } else if (kind == 2) {
        // Растворение: шум решает, жив пиксель или нет; у кромки — цвет.
        let threshold = clamp(u.p.y, 0.0, 1.0);
        let n = r2d_noise(floor(uv * u.p.z));
        if (n < threshold) {
            discard;
        }
        let edge = smoothstep(threshold, threshold + 0.12, n);
        col = vec4<f32>(mix(u.c.rgb, col.rgb, edge), col.a);
    } else if (kind == 3) {
        // Расхождение каналов: красный в одну сторону, синий в другую.
        let off = u.p.y;
        let r = textureSample(u_texture, u_sampler, uv + vec2<f32>(off, 0.0)).r * v_color.r;
        let b = textureSample(u_texture, u_sampler, uv - vec2<f32>(off, 0.0)).b * v_color.b;
        col = vec4<f32>(r, col.g, b, col.a);
    } else if (kind == 4) {
        // Волна: UV сдвигается по вертикали, фаза — параметр времени.
        uv = vec2<f32>(uv.x + sin(uv.y * u.p.z + u.p.w) * u.p.y, uv.y);
        col = textureSample(u_texture, u_sampler, uv) * v_color;
    }

    return col;
}
