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
// Параметры приходят push-константами: 12 float, три vec4.
// ---------------------------------------------------------------------------

layout(set = 2, binding = 0) uniform sampler2D u_scene;
// Готовая размытая яркая часть кадра (bloom_pre + два прохода bloom_blur).
// Когда свечения нет, сюда привязана чёрная текстура 1×1 — вклад нулевой.
layout(set = 2, binding = 1) uniform sampler2D u_bloom;

layout(set = 3, binding = 0) uniform PostParams {
    vec4 p0;   // x = свечение, y = вигнетка, z = хроматика, w = линза
    vec4 p1;   // xy = центр искажения, z = радиус, w = зерно
    vec4 p2;   // x = скан-линии, y = время, z = включено, w = постеризация
    vec4 p3;   // xyz = оттенок (множитель каналов), w = доля оттенка
    vec4 p4;   // x = насыщенность, y = контраст, z = яркость, w = кровь по краям
    vec4 p5;   // x = порог bloom, y = сила размытия, z = bloom готов (1/0)
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

    // --- Цвет: с хроматикой три выборки, без неё одна.
    vec4 col;
    if (chroma > 0.0001) {
        vec2 off = (lens_uv - center) * chroma;
        col.r = texture(u_scene, lens_uv + off).r;
        col.g = texture(u_scene, lens_uv).g;
        col.b = texture(u_scene, lens_uv - off).b;
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
