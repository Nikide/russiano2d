// ---------------------------------------------------------------------------
// Пост-обработка russiano2d — фрагментная стадия, вариант для WebGPU.
//
// Копия shaders/post.frag.glsl: свечение, вигнетка, хроматика, зерно,
// скан-линии, линза, цветокоррекция и «кровь по краям».
//
// Раскладка привязок — по конвенции SDL_GPU для WGSL: сэмплируемая текстура и
// её сэмплер идут парами, в порядке слотов (сцена — слот 0, bloom — слот 1),
// а юниформы фрагментной стадии живут в группе 3.
// ---------------------------------------------------------------------------

struct PostParams {
    p0: vec4<f32>,   // x = свечение, y = вигнетка, z = хроматика, w = линза
    p1: vec4<f32>,   // xy = центр искажения, z = радиус, w = зерно
    p2: vec4<f32>,   // x = скан-линии, y = время, z = включено, w = постеризация
    p3: vec4<f32>,   // xyz = оттенок, w = доля оттенка
    p4: vec4<f32>,   // x = насыщенность, y = контраст, z = яркость, w = кровь
    p5: vec4<f32>,   // x = порог bloom, y = сила размытия, z = bloom готов
};

@group(2) @binding(0) var u_scene: texture_2d<f32>;
@group(2) @binding(1) var u_scene_sampler: sampler;
@group(2) @binding(2) var u_bloom: texture_2d<f32>;
@group(2) @binding(3) var u_bloom_sampler: sampler;
@group(3) @binding(0) var<uniform> u: PostParams;

fn r2d_hash(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn main(@location(0) v_uv: vec2<f32>) -> @location(0) vec4<f32> {
    // Текстурные координаты начинаются сверху, clip-space — снизу, поэтому
    // вертикаль переворачивается: без этого кадр (и HUD) встанет вверх ногами.
    let uv = vec2<f32>(v_uv.x, 1.0 - v_uv.y);

    let glow     = u.p0.x;
    let vignette = u.p0.y;
    let chroma   = u.p0.z;
    let lens     = u.p0.w;

    let center = u.p1.xy;
    let radius = max(u.p1.z, 0.05);
    let grain  = u.p1.w;

    let scanline = u.p2.x;
    let time     = u.p2.y;

    // --- Линза: UV тянется к центру тем сильнее, чем ближе к нему точка.
    var lens_uv = uv;
    if (lens > 0.0001) {
        let d = uv - center;
        let r2 = max(dot(d, d), 1e-5);
        let k = lens * (radius * radius) / r2;
        lens_uv = center + d * (1.0 - clamp(k, 0.0, 0.85));
    }

    // --- Цвет: с хроматикой три выборки, без неё одна.
    var col: vec4<f32>;
    if (chroma > 0.0001) {
        let off = (lens_uv - center) * chroma;
        let r = textureSample(u_scene, u_scene_sampler, lens_uv + off).r;
        let g = textureSample(u_scene, u_scene_sampler, lens_uv).g;
        let b = textureSample(u_scene, u_scene_sampler, lens_uv - off).b;
        let a = textureSample(u_scene, u_scene_sampler, lens_uv).a;
        col = vec4<f32>(r, g, b, a);
    } else {
        col = textureSample(u_scene, u_scene_sampler, lens_uv);
    }

    // --- Свечение. Честный bloom приходит готовой размытой текстурой;
    // запасная ветка — восемь выборок в одном проходе (буферы не создались).
    if (glow > 0.0001) {
        if (u.p5.z > 0.5) {
            let bloom = textureSample(u_bloom, u_bloom_sampler, lens_uv);
            col = vec4<f32>(col.rgb + bloom.rgb * glow, col.a);
        } else {
            let s = 0.0045;
            var acc = vec3<f32>(0.0, 0.0, 0.0);
            let offs = array<vec2<f32>, 8>(
                vec2<f32>( s,  0.0), vec2<f32>(-s,  0.0),
                vec2<f32>( 0.0,  s ), vec2<f32>( 0.0, -s ),
                vec2<f32>( s,   s ), vec2<f32>(-s,   s ),
                vec2<f32>( s,  -s ), vec2<f32>(-s,  -s ),
            );
            for (var i = 0; i < 8; i = i + 1) {
                let c = textureSample(u_scene, u_scene_sampler, lens_uv + offs[i]).rgb;
                acc = acc + max(c - vec3<f32>(0.55, 0.55, 0.55), vec3<f32>(0.0, 0.0, 0.0));
            }
            col = vec4<f32>(col.rgb + acc * (glow * 0.4), col.a);
        }
    }

    // --- Вигнетка.
    if (vignette > 0.0001) {
        let d = distance(uv, vec2<f32>(0.5, 0.5));
        col = vec4<f32>(col.rgb * (1.0 - vignette * smoothstep(0.35, 0.9, d)), col.a);
    }

    // --- Скан-линии (ретро-монитор) и зерно.
    if (scanline > 0.0001) {
        let k = 1.0 - scanline * 0.5 * (0.5 + 0.5 * sin(uv.y * 900.0));
        col = vec4<f32>(col.rgb * k, col.a);
    }
    if (grain > 0.0001) {
        let n = r2d_hash(uv * 1024.0 + vec2<f32>(time, time * 1.7)) - 0.5;
        col = vec4<f32>(col.rgb + vec3<f32>(n, n, n) * grain, col.a);
    }

    // --- Цветокоррекция: насыщенность, контраст, яркость и оттенок.
    let saturation = u.p4.x;
    let contrast   = u.p4.y;
    let brightness = u.p4.z;
    let tint_amt   = u.p3.w;

    let lum = dot(col.rgb, vec3<f32>(0.299, 0.587, 0.114));
    var rgb = mix(vec3<f32>(lum, lum, lum), col.rgb, saturation);
    rgb = (rgb - vec3<f32>(0.5, 0.5, 0.5)) * contrast + vec3<f32>(0.5, 0.5, 0.5) + vec3<f32>(brightness, brightness, brightness);
    if (tint_amt > 0.0001) {
        rgb = mix(rgb, rgb * u.p3.xyz, tint_amt);
    }

    // --- Постеризация: «8-битный» кадр.
    if (u.p2.w > 1.5) {
        rgb = floor(rgb * u.p2.w) / u.p2.w;
    }

    // --- Кровь по краям экрана.
    if (u.p4.w > 0.0001) {
        let db = distance(uv, vec2<f32>(0.5, 0.5));
        rgb = mix(rgb, vec3<f32>(0.42, 0.02, 0.05), u.p4.w * smoothstep(0.2, 0.85, db));
    }

    return vec4<f32>(clamp(rgb, vec3<f32>(0.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 1.0)), 1.0);
}
