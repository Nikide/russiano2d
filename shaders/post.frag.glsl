#version 450

// ---------------------------------------------------------------------------
// Пост-обработка russiano2d — фрагментная стадия.
//
// Сцена приходит сюда уже отрисованной в offscreen-текстуру, поэтому эффекты
// можно накладывать на готовый кадр: свечение, вигнетка, хроматическая
// аберрация, зерно, скан-линии и — главное — линза (экранное искажение UV по
// полю ~1/r²), из которой делается «чёрная дыра» и любые искажения от взрывов.
//
// Раскладка ресурсов SDL_GPU: set 2 — текстуры фрагментной стадии,
// set 3 — её юниформы (см. sprite.frag.glsl).
//
// Параметры приходят push-константами: блок из девяти vec4 (96 → 144 байта
// в пределах минимума Vulkan/Metal/D3D12 для push-constant диапазона).
//
// Экранное искажение (§46 Спецификации) — это тот же проход: он уже читает
// готовую сцену (u_scene), поэтому «проход с sampling предыдущего изображения»
// не требует второго render target. Волна, шум и сдвиг каналов ниже.
// ---------------------------------------------------------------------------

layout(set = 2, binding = 0) uniform sampler2D u_scene;
// Готовая размытая яркая часть кадра (bloom_pre + два прохода bloom_blur).
// Когда свечения нет, сюда привязана чёрная текстура 1×1 — вклад нулевой.
layout(set = 2, binding = 1) uniform sampler2D u_bloom;
// Процедурный шум (C генерирует его при старте, пользовательский ассет не
// нужен). Читается только при noise_amount > 0 — иначе лишней выборки нет.
layout(set = 2, binding = 2) uniform sampler2D u_noise;

layout(set = 3, binding = 0) uniform PostParams {
    vec4 p0;   // x = свечение, y = вигнетка, z = хроматика, w = линза
    vec4 p1;   // xy = центр искажения, z = радиус, w = зерно
    vec4 p2;   // x = скан-линии, y = время, z = включено, w = постеризация
    vec4 p3;   // xyz = оттенок (множитель каналов), w = доля оттенка
    vec4 p4;   // x = насыщенность, y = контраст, z = яркость, w = кровь по краям
    vec4 p5;   // x = порог bloom, y = сила размытия, z = bloom готов (1/0)
    vec4 p6;   // xyzw = волна: амплитуда, частота, скорость, ось
    vec4 p7;   // xyzw = шум: сила, масштаб, общая сила искажения, сдвиг каналов
    vec4 p8;   // xy = время эффекта (lo/hi), zw = запас
} u;

layout(location = 0) in vec2 v_uv;
layout(location = 0) out vec4 o_color;

// Дешёвый хеш для зерна: без него кадр выглядит «пластиковым».
float r2d_hash(vec2 p)
{
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main()
{
    // Текстурные координаты начинаются сверху, clip-space — снизу, поэтому
    // вертикаль переворачивается: без этого весь кадр (и HUD) встаёт вверх ногами.
    vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);

    const float glow     = u.p0.x;
    const float vignette = u.p0.y;
    const float chroma   = u.p0.z;
    const float lens     = u.p0.w;

    const vec2  center = u.p1.xy;
    const float radius = max(u.p1.z, 0.05);
    const float grain  = u.p1.w;

    const float scanline = u.p2.x;
    const float time     = u.p2.y;

    // --- Линза: UV тянется к центру тем сильнее, чем ближе к нему точка.
    vec2 lens_uv = uv;
    if (lens > 0.0001) {
        vec2 d = uv - center;
        float r2 = max(dot(d, d), 1e-5);
        float k = lens * (radius * radius) / r2;
        lens_uv = center + d * (1.0 - clamp(k, 0.0, 0.85));
    }

    // --- Экранное искажение (§46): волна + шум. Работает по уже
    // нарисованному кадру, поэтому применяется до цветовых эффектов, а сами
    // выборки ниже используют уже искажённые координаты.
    const float wave_amp   = u.p6.x;
    const float wave_freq  = u.p6.y;
    const float wave_speed = u.p6.z;
    const float wave_axis  = u.p6.w;
    const float noise_amt  = u.p7.x;
    const float noise_scl  = max(u.p7.y, 0.001);
    const float distortion = u.p7.z;
    const float chan_shift = u.p7.w;
    const float post_time  = u.p8.x + u.p8.y;

    if (distortion > 0.0001) {
        vec2 d = lens_uv;
        if (wave_amp > 0.0001) {
            // Волна идёт либо по X, либо по Y: одна формула, два режима.
            float phase = wave_axis > 0.5 ? d.y : d.x;
            float offset = sin(phase * wave_freq + post_time * wave_speed) * wave_amp;
            if (wave_axis > 0.5) d.x += offset; else d.y += offset;
        }
        if (noise_amt > 0.0001) {
            // Шум берётся из процедурной текстуры: два канала дают смещение по
            // обеим осям, время двигает выборку, поэтому дрожание не «залипает».
            vec2 nuv = d * noise_scl + vec2(post_time * 0.13, post_time * 0.07);
            // noise_amount — это амплитуда в долях экрана (как wave_amp), а
            // distort — просто выключатель. Если умножать на оба, игра задаёт
            // силу дважды и «0.9» даёт сдвиг меньше пикселя.
            vec2 jitter = (texture(u_noise, nuv).rg - 0.5) * 2.0;
            d += jitter * noise_amt;
        }
        lens_uv = clamp(d, vec2(0.0), vec2(1.0));
    }

    // --- Цвет: с хроматикой три выборки, без неё одна.
    vec4 col;
    if (chroma > 0.0001 || chan_shift > 0.0001) {
        // Хроматика тянет каналы от центра искажения, chan_shift — просто
        // сдвигает R и B вдоль X: это разные художественные эффекты, поэтому
        // они складываются, а не подменяют друг друга.
        vec2 off = (lens_uv - center) * chroma + vec2(chan_shift, 0.0);
        col.r = texture(u_scene, clamp(lens_uv + off, vec2(0.0), vec2(1.0))).r;
        col.g = texture(u_scene, lens_uv).g;
        col.b = texture(u_scene, clamp(lens_uv - off, vec2(0.0), vec2(1.0))).b;
        col.a = texture(u_scene, lens_uv).a;
    } else {
        col = texture(u_scene, lens_uv);
    }

    // --- Свечение. Честный bloom приходит готовой размытой текстурой
    // (порог → два размытия, см. bloom_pre/bloom_blur): здесь только
    // сложение. Запасная ветка — восемь выборок в одном проходе: она нужна,
    // если буферы свечения не создались (слабый GPU, конец памяти), и как
    // поведение старых сборок.
    if (glow > 0.0001) {
        if (u.p5.z > 0.5) {
            col.rgb += texture(u_bloom, lens_uv).rgb * glow;
        } else {
            const float s = 0.0045;
            vec3 acc = vec3(0.0);
            acc += max(texture(u_scene, lens_uv + vec2( s,  0.0)).rgb - 0.55, 0.0);
            acc += max(texture(u_scene, lens_uv + vec2(-s,  0.0)).rgb - 0.55, 0.0);
            acc += max(texture(u_scene, lens_uv + vec2( 0.0, s )).rgb - 0.55, 0.0);
            acc += max(texture(u_scene, lens_uv + vec2( 0.0,-s )).rgb - 0.55, 0.0);
            acc += max(texture(u_scene, lens_uv + vec2( s,  s )).rgb - 0.55, 0.0);
            acc += max(texture(u_scene, lens_uv + vec2(-s,  s )).rgb - 0.55, 0.0);
            acc += max(texture(u_scene, lens_uv + vec2( s, -s )).rgb - 0.55, 0.0);
            acc += max(texture(u_scene, lens_uv + vec2(-s, -s )).rgb - 0.55, 0.0);
            col.rgb += acc * (glow * 0.4);
        }
    }

    // --- Вигнетка.
    if (vignette > 0.0001) {
        float d = distance(uv, vec2(0.5));
        col.rgb *= 1.0 - vignette * smoothstep(0.35, 0.9, d);
    }

    // --- Скан-линии (ретро-монитор) и зерно.
    if (scanline > 0.0001) {
        col.rgb *= 1.0 - scanline * 0.5 * (0.5 + 0.5 * sin(uv.y * 900.0));
    }
    if (grain > 0.0001) {
        col.rgb += (r2d_hash(uv * 1024.0 + vec2(time, time * 1.7)) - 0.5) * grain;
    }

    // --- Цветокоррекция: насыщенность, контраст, яркость и оттенок.
    // Именно она превращает один и тот же кадр и в «тёплый мультик», и в хоррор.
    const float saturation = u.p4.x;
    const float contrast   = u.p4.y;
    const float brightness = u.p4.z;
    const float tint_amt   = u.p3.w;

    float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));
    col.rgb = mix(vec3(lum), col.rgb, saturation);
    col.rgb = (col.rgb - 0.5) * contrast + 0.5 + brightness;
    if (tint_amt > 0.0001) {
        col.rgb = mix(col.rgb, col.rgb * u.p3.xyz, tint_amt);
    }

    // --- Постеризация: «8-битный» кадр.
    if (u.p2.w > 1.5) {
        col.rgb = floor(col.rgb * u.p2.w) / u.p2.w;
    }

    // --- Кровь по краям экрана: дешёвый аналог «залитого кровью» взгляда.
    if (u.p4.w > 0.0001) {
        float db = distance(uv, vec2(0.5));
        col.rgb = mix(col.rgb, vec3(0.42, 0.02, 0.05), u.p4.w * smoothstep(0.2, 0.85, db));
    }

    o_color = vec4(clamp(col.rgb, 0.0, 1.0), 1.0);
}
