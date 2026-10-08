// ===========================================================================
// Тест математики Re2D (src/re2d_math.c): проекция, отсечение по ближней
// плоскости, обход граней, туман, детерминизм. Без окна и GPU.
//
// Эталонные числа считаются руками: вид 800×600, fov 90° → фокус 300 px,
// поэтому точка на глубине 100 с боковым смещением 50 даёт сдвиг 150 px.
// ===========================================================================
#include "re2d_math.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Вместимость массива float в вершинах меша (по 8 float). */
#define CAP(x) ((int)(sizeof(x) / sizeof((x)[0]) / 8))

static int g_failed = 0;

static void check(int ok, const char *what)
{
    if (ok) {
        printf("  ok   %s\n", what);
    } else {
        ++g_failed;
        printf("  FAIL %s\n", what);
    }
}

static int near_eq(float a, float b, float eps) { return fabsf(a - b) <= eps; }

static const float HALF_PI = 1.57079632679f;

static void make_view(R2DRe2dView *v, float yaw, float pitch)
{
    r2d_re2d_view_set(v, 0.0f, 0.0f, 0.0f, yaw, pitch, HALF_PI, 800.0f, 600.0f);
}

static void test_project_basic(void)
{
    R2DRe2dView v;
    make_view(&v, 0.0f, 0.0f);
    check(near_eq(v.focal, 300.0f, 0.01f), "фокус при fov 90° и высоте 600 = 300");

    float p[4];
    check(r2d_re2d_project(&v, 100, 0, 0, p), "точка прямо впереди видна");
    check(near_eq(p[0], 400, 0.01f) && near_eq(p[1], 300, 0.01f), "…и лежит в центре кадра");
    check(near_eq(p[3], 3.0f, 0.001f), "масштаб на глубине 100 = 3 px на единицу");
    check(near_eq(p[2], 0.96f, 1e-5f), "глубина z01 = 1 - 4/100");

    check(r2d_re2d_project(&v, 100, 50, 0, p) && near_eq(p[0], 550, 0.01f),
          "вправо от взгляда (yaw 0 → вправо это +y мира) сдвигает на +150 px");
    check(r2d_re2d_project(&v, 100, -50, 0, p) && near_eq(p[0], 250, 0.01f),
          "влево — на -150 px");
    check(r2d_re2d_project(&v, 100, 0, 50, p) && near_eq(p[1], 150, 0.01f),
          "выше глаз — выше на экране (sy меньше)");
    check(r2d_re2d_project(&v, 100, 0, -50, p) && near_eq(p[1], 450, 0.01f),
          "ниже глаз — ниже на экране");
}

static void test_project_behind(void)
{
    R2DRe2dView v;
    make_view(&v, 0.0f, 0.0f);
    float p[4];
    check(!r2d_re2d_project(&v, -10, 0, 0, p), "точка позади камеры невидима");
    check(p[2] == -1.0f && p[3] == 0.0f, "у невидимой z01 = -1, scale = 0");
    check(!r2d_re2d_project(&v, 3, 0, 0, p), "точка ближе ближней плоскости невидима");
    check(!r2d_re2d_project(&v, NAN, 0, 0, p), "нечисловая точка невидима");
}

static void test_yaw(void)
{
    R2DRe2dView v;
    make_view(&v, HALF_PI, 0.0f);   // смотрим вдоль +y мира
    float p[4];
    check(r2d_re2d_project(&v, 0, 100, 0, p) && near_eq(p[0], 400, 0.05f) && near_eq(p[1], 300, 0.05f),
          "yaw 90°: точка вдоль +y — в центре");
    check(!r2d_re2d_project(&v, 100, 0, 0, p) || p[2] < 0 || near_eq(p[3], 0.0f, 1e9f),
          "yaw 90°: точка вдоль +x — сбоку (глубина около нуля, не впереди)");
    // Поворот по часовой на экране: при yaw 90° вправо от взгляда это -x мира.
    check(r2d_re2d_project(&v, -50, 100, 0, p) && near_eq(p[0], 550, 0.05f),
          "yaw 90°: вправо от взгляда — это -x мира");
}

static void test_pitch(void)
{
    R2DRe2dView v;
    make_view(&v, 0.0f, HALF_PI / 2.0f);   // взгляд на 45° вверх
    float p[4];
    check(r2d_re2d_project(&v, 100, 0, 0, p) && near_eq(p[1], 600, 0.5f),
          "наклон вверх на 45° при fov 90°: точка на уровне глаз уходит к нижнему краю");
    check(r2d_re2d_project(&v, 100, 0, 100, p) && near_eq(p[0], 400, 0.01f) && near_eq(p[1], 300, 0.5f),
          "…а точка под углом 45° вверх — в центре (настоящий наклон, не сдвиг горизонта)");

    R2DRe2dView w;
    r2d_re2d_view_set(&w, 0, 0, 0, 0, 10.0f, HALF_PI, 800, 600);
    check(w.pitch < HALF_PI && w.pitch > 1.5f, "наклон зажат строго внутри ±90°");
}

static void test_project_points(void)
{
    R2DRe2dView v;
    make_view(&v, 0.0f, 0.0f);
    const float in[9] = { 100, 0, 0,   -10, 0, 0,   200, 100, 0 };
    float out[12];
    const int visible = r2d_re2d_project_points(&v, in, 3, out);
    check(visible == 2, "пакет: видимых 2 из 3");
    check(out[2] > 0 && out[10] > 0, "…у первой и третьей глубина записана");
    check(out[4 + 2] == -1.0f && out[4 + 3] == 0.0f, "…невидимая (вторая) помечена z01 = -1, scale = 0");
    check(near_eq(out[0], 400, 0.01f) && near_eq(out[1], 300, 0.01f), "первая точка в центре");
    check(near_eq(out[8], 400 + 100 * 1.5f, 0.01f), "третья: глубина 200, сдвиг 100 → +150 px");
}

static void test_unproject(void)
{
    R2DRe2dView v;
    r2d_re2d_view_set(&v, 12.0f, -5.0f, 48.0f, 0.7f, 0.3f, 1.2f, 800.0f, 600.0f);
    float pts[3][3] = { {120, 40, 0}, {-60, 200, 0}, {300, -150, 20} };
    for (int i = 0; i < 3; ++i) {
        float s[4], w[2];
        const int vis = r2d_re2d_project(&v, pts[i][0], pts[i][1], pts[i][2], s);
        check(vis, "точка видна для проверки обратной проекции");
        if (!vis) continue;
        const int ok = r2d_re2d_unproject(&v, s[0], s[1], pts[i][2], w);
        check(ok && near_eq(w[0], pts[i][0], 0.05f) && near_eq(w[1], pts[i][1], 0.05f),
              "unproject(project(p)) возвращает p на плоскости его высоты");
    }
    // Взгляд в небо не попадает в пол.
    R2DRe2dView up;
    r2d_re2d_view_set(&up, 0, 0, 48, 0, 1.0f, 1.0f, 800, 600);
    float w[2];
    check(!r2d_re2d_unproject(&up, 400, 100, 0, w), "луч в небо не пересекает пол");
    check(!r2d_re2d_unproject(&up, NAN, 0, 0, w), "нечисловой пиксель — false");
}

// Вершина меша: x y z u v r g b
static void put_vert(float *dst, float x, float y, float z, float u, float vv, float r, float g, float b)
{
    dst[0] = x; dst[1] = y; dst[2] = z; dst[3] = u; dst[4] = vv; dst[5] = r; dst[6] = g; dst[7] = b;
}

static void test_mesh_front(void)
{
    R2DRe2dView v;
    make_view(&v, 0.0f, 0.0f);
    float in[24], out[48];
    // Три вершины впереди камеры на глубине 100; обход по часовой на экране.
    put_vert(in + 0, 100, 0, 50, 0, 0, 255, 255, 255);
    put_vert(in + 8, 100, 50, -50, 1, 1, 255, 255, 255);
    put_vert(in + 16, 100, -50, -50, 0, 1, 255, 255, 255);
    R2DRe2dStats st;
    const int n = r2d_re2d_mesh(&v, in, 3, out, CAP(out), 0, &st);
    check(n == 3 && st.tris_in == 1 && st.tris_out == 1, "треугольник впереди: 1 → 1");
    check(st.clipped == 0 && st.behind == 0, "…ничего не отсечено");
    check(near_eq(out[0], 400, 0.01f) && near_eq(out[1], 150, 0.01f), "вершина 0 спроецирована");
    check(near_eq(out[8 + 0], 550, 0.01f) && near_eq(out[8 + 1], 450, 0.01f), "вершина 1 спроецирована");
    check(near_eq(out[2], 0.96f, 1e-5f), "глубина вершины 0.96");
    check(out[3] == 0 && out[4] == 0 && out[8 + 3] == 1, "текстурные координаты сохранены");
}

static void test_mesh_clip(void)
{
    R2DRe2dView v;
    make_view(&v, 0.0f, 0.0f);
    float in[24], out[96];

    // Одна вершина позади: многоугольник из 4 вершин → 2 треугольника.
    put_vert(in + 0, 10, -20, 0, 0.0f, 0.0f, 255, 0, 0);
    put_vert(in + 8, 10, 20, 0, 1.0f, 0.0f, 0, 255, 0);
    put_vert(in + 16, -10, 0, 0, 0.5f, 1.0f, 0, 0, 255);
    R2DRe2dStats st;
    int n = r2d_re2d_mesh(&v, in, 3, out, CAP(out), R2D_RE2D_NO_SPLIT, &st);
    check(n == 6 && st.tris_out == 2 && st.clipped == 1, "одна вершина позади: 1 → 2 треугольника");
    // Новые вершины лежат ровно на ближней плоскости: z01 = 1 - 4/4 = 0.
    int on_plane = 0;
    for (int i = 0; i < n; ++i) if (near_eq(out[i * 8 + 2], 0.0f, 1e-6f)) ++on_plane;
    check(on_plane >= 2, "точки разреза лежат на ближней плоскости (z01 = 0)");

    // Интерполяция u на разрезе: ребро 0→2 идёт с глубины 10 до -10, разрез при t = 0.3.
    int found = 0;
    for (int i = 0; i < n; ++i) {
        if (near_eq(out[i * 8 + 2], 0.0f, 1e-6f) && near_eq(out[i * 8 + 3], 0.15f, 1e-4f)) found = 1;
    }
    check(found, "текстурная координата на разрезе интерполирована (u = 0.15)");

    // Целиком позади.
    put_vert(in + 0, -10, 0, 0, 0, 0, 255, 255, 255);
    put_vert(in + 8, -20, 5, 0, 0, 0, 255, 255, 255);
    put_vert(in + 16, -30, -5, 0, 0, 0, 255, 255, 255);
    n = r2d_re2d_mesh(&v, in, 3, out, CAP(out), R2D_RE2D_NO_SPLIT, &st);
    check(n == 0 && st.behind == 1, "треугольник целиком позади камеры отброшен");
}

static void test_mesh_cull(void)
{
    R2DRe2dView v;
    make_view(&v, 0.0f, 0.0f);
    float cw[24], ccw[24], out[48];
    put_vert(cw + 0, 100, 0, 50, 0, 0, 255, 255, 255);
    put_vert(cw + 8, 100, 50, -50, 0, 0, 255, 255, 255);
    put_vert(cw + 16, 100, -50, -50, 0, 0, 255, 255, 255);
    memcpy(ccw + 0, cw + 0, 8 * sizeof(float));
    memcpy(ccw + 8, cw + 16, 8 * sizeof(float));
    memcpy(ccw + 16, cw + 8, 8 * sizeof(float));
    R2DRe2dStats st;
    check(r2d_re2d_mesh(&v, cw, 3, out, CAP(out), R2D_RE2D_CULL_BACK, &st) == 3 && st.culled == 0,
          "обход по часовой на экране — лицевая грань рисуется");
    check(r2d_re2d_mesh(&v, ccw, 3, out, CAP(out), R2D_RE2D_CULL_BACK, &st) == 0 && st.culled == 1,
          "обход против часовой — отбракована");
    check(r2d_re2d_mesh(&v, ccw, 3, out, CAP(out), 0, &st) == 3, "без флага рисуются обе стороны");
}

static void test_mesh_fog(void)
{
    R2DRe2dView v;
    make_view(&v, 0.0f, 0.0f);
    r2d_re2d_view_fog(&v, 100.0f, 0.25f);
    float in[24], out[48];
    put_vert(in + 0, 50, 0, 10, 0, 0, 200, 100, 40);
    put_vert(in + 8, 50, 10, -10, 0, 0, 200, 100, 40);
    put_vert(in + 16, 50, -10, -10, 0, 0, 200, 100, 40);
    r2d_re2d_mesh(&v, in, 3, out, CAP(out), 0, NULL);
    check(near_eq(out[5], 100.0f, 0.01f) && near_eq(out[6], 50.0f, 0.01f), "туман на половине дальности: цвет × 0.5");
    put_vert(in + 0, 500, 0, 10, 0, 0, 200, 100, 40);
    put_vert(in + 8, 500, 10, -10, 0, 0, 200, 100, 40);
    put_vert(in + 16, 500, -10, -10, 0, 0, 200, 100, 40);
    r2d_re2d_mesh(&v, in, 3, out, CAP(out), 0, NULL);
    check(near_eq(out[5], 50.0f, 0.01f), "дальше fog_far цвет не темнее fog_min (200 × 0.25)");
}

static void test_mesh_depth_order(void)
{
    R2DRe2dView v;
    make_view(&v, 0.0f, 0.0f);
    float in[24], out[48];
    put_vert(in + 0, 50, 0, 10, 0, 0, 255, 255, 255);
    put_vert(in + 8, 200, 0, 10, 0, 0, 255, 255, 255);
    put_vert(in + 16, 400, 0, 10, 0, 0, 255, 255, 255);
    r2d_re2d_mesh(&v, in, 3, out, CAP(out), R2D_RE2D_NO_SPLIT, NULL);
    check(out[2] < out[8 + 2] && out[8 + 2] < out[16 + 2], "z01 растёт с расстоянием: ближе — меньше");
    check(out[16 + 2] < 1.0f && out[2] > 0.0f, "z01 внутри (0, 1)");
}

static void test_mesh_guards(void)
{
    R2DRe2dView v;
    make_view(&v, 0.0f, 0.0f);
    float in[24], out[48];
    put_vert(in + 0, 100, 0, 0, 0, 0, 255, 255, 255);
    put_vert(in + 8, 100, NAN, 0, 0, 0, 255, 255, 255);
    put_vert(in + 16, 100, 10, 0, 0, 0, 255, 255, 255);
    R2DRe2dStats st;
    check(r2d_re2d_mesh(&v, in, 3, out, CAP(out), 0, &st) == 0 && st.invalid == 1, "нечисловой треугольник отброшен и посчитан");

    put_vert(in + 8, 100, 20, 0, 0, 0, 255, 255, 255);
    check(r2d_re2d_mesh(&v, in, 3, out, 2, 0, &st) == 0, "выходной буфер меньше треугольника — 0 вершин, без записи");
    check(r2d_re2d_mesh(&v, in, 2, out, CAP(out), 0, &st) == 0, "меньше трёх вершин — пусто");
    check(r2d_re2d_mesh(NULL, in, 3, out, CAP(out), 0, &st) == 0, "нет вида — пусто");
}

// Ошибка аффинной текстуры: для каждого выходного треугольника сравниваем среднее u
// по вершинам с «точным» u в центре тяжести (по обратной проекции на пол).
static float affine_error(const R2DRe2dView *v, const float *out, int verts, float x0, float x1, float z)
{
    float worst = 0.0f;
    for (int i = 0; i + 2 < verts; i += 3) {
        const float *a = out + (size_t)i * 8, *b = a + 8, *c = a + 16;
        const float cx = (a[0] + b[0] + c[0]) / 3.0f, cy = (a[1] + b[1] + c[1]) / 3.0f;
        float w[2];
        if (!r2d_re2d_unproject(v, cx, cy, z, w)) continue;
        const float exact = (w[0] - x0) / (x1 - x0);          // u линейно по x мира
        const float affine = (a[3] + b[3] + c[3]) / 3.0f;
        const float e = fabsf(exact - affine);
        if (e > worst) worst = e;
    }
    return worst;
}

static void test_split_texture(void)
{
    // Ячейка пола 128×128 (так режет поверхности re2d.js) вплотную к глазам:
    // одним краем в 10 единицах, другим — в 138.
    R2DRe2dView v;
    r2d_re2d_view_set(&v, 0, 0, 40, 0, 0, HALF_PI, 800, 600);
    float in[48];
    put_vert(in + 0, 10, -64, 0, 0, 0, 255, 255, 255);
    put_vert(in + 8, 138, -64, 0, 1, 0, 255, 255, 255);
    put_vert(in + 16, 10, 64, 0, 0, 1, 255, 255, 255);
    put_vert(in + 24, 138, -64, 0, 1, 0, 255, 255, 255);
    put_vert(in + 32, 138, 64, 0, 1, 1, 255, 255, 255);
    put_vert(in + 40, 10, 64, 0, 0, 1, 255, 255, 255);
    // u = (x - 10) / 128 — меняется только вдоль глубины.
    float *plain = malloc(sizeof(float) * 8 * 4096), *split = malloc(sizeof(float) * 8 * 4096);
    R2DRe2dStats sp, ns;
    const int n_plain = r2d_re2d_mesh(&v, in, 6, plain, 4096, R2D_RE2D_NO_SPLIT, &ns);
    const int n_split = r2d_re2d_mesh(&v, in, 6, split, 4096, 0, &sp);
    check(ns.split == 0 && n_plain == 6, "без дробления: два треугольника как были");
    check(sp.split > 0 && n_split > n_plain, "с дроблением: крупный близкий пол разделён на куски");
    const float e_plain = affine_error(&v, plain, n_plain, 10.0f, 138.0f, 0.0f);
    const float e_split = affine_error(&v, split, n_split, 10.0f, 138.0f, 0.0f);
    printf("       ошибка u: без дробления %.3f, с дроблением %.3f (треугольников %d → %d)\n",
           e_plain, e_split, n_plain / 3, n_split / 3);
    check(e_plain > 0.10f, "аффинная текстура без дробления заметно врёт (ошибка > 0.1)");
    check(e_split < 0.03f, "с дроблением ошибка мала (< 0.03)");

    // Далёкий мелкий треугольник не дробится: разброс глубины мал.
    float far_tri[24];
    put_vert(far_tri + 0, 900, -5, 0, 0, 0, 255, 255, 255);
    put_vert(far_tri + 8, 910, -5, 0, 1, 0, 255, 255, 255);
    put_vert(far_tri + 16, 900, 5, 0, 0, 1, 255, 255, 255);
    R2DRe2dStats fs;
    check(r2d_re2d_mesh(&v, far_tri, 3, plain, 4096, 0, &fs) == 3 && fs.split == 0,
          "далёкий мелкий треугольник не дробится");

    // Нехватка места: треугольник входа записывается целиком либо не записывается.
    R2DRe2dStats of;
    const int n_small = r2d_re2d_mesh(&v, in, 6, plain, 6, 0, &of);
    check(n_small % 3 == 0 && of.overflow >= 1, "малый буфер: вход пропущен целиком, overflow посчитан");
    free(plain);
    free(split);
}

static void test_determinism(void)
{
    R2DRe2dView v;
    r2d_re2d_view_set(&v, 12.5f, -7.25f, 48.0f, 0.77f, 0.21f, 1.1f, 1280, 720);
    float in[48], a[96], b[96];
    for (int i = 0; i < 6; ++i) {
        put_vert(in + i * 8, 100 + i * 17.0f, -30 + i * 11.0f, i * 9.0f, i * 0.1f, 0.5f, 255, 200, 100);
    }
    const int na = r2d_re2d_mesh(&v, in, 6, a, CAP(a), 0, NULL);
    const int nb = r2d_re2d_mesh(&v, in, 6, b, CAP(b), 0, NULL);
    check(na == nb && memcmp(a, b, (size_t)na * 8 * sizeof(float)) == 0, "тот же вход — побайтово тот же выход");
}

int main(void)
{
    test_project_basic();
    test_project_behind();
    test_yaw();
    test_pitch();
    test_project_points();
    test_mesh_front();
    test_mesh_clip();
    test_mesh_cull();
    test_mesh_fog();
    test_mesh_depth_order();
    test_unproject();
    test_split_texture();
    test_mesh_guards();
    test_determinism();
    if (g_failed) {
        printf("\nПровалов: %d\n", g_failed);
        return 1;
    }
    printf("\nВсе проверки пройдены\n");
    return 0;
}
