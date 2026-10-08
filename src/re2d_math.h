// ===========================================================================
// Re2D: математика вида от первого лица — мировая точка → экран.
//
// Чистый C без SDL и QuickJS (поэтому проверяется офлайн: tests/re2d).
// Замысел и границы — docs/RE2D.md; JS-обвязка — re2d.c.
//
// Мир остаётся плоским: точка — это (x, y) на полу плюс высота z над полом.
// Камера задана положением глаз на полу, высотой глаз и двумя углами:
//
//   yaw   — куда смотрим; 0 = вдоль +x, положительный угол поворачивает
//           по часовой стрелке на экране (ось y мира направлена вниз);
//   pitch — наклон: положительный — вверх. Это настоящий поворот камеры
//           вокруг горизонтальной оси, а не сдвиг горизонта.
//
// Проекция перспективная: sx = w/2 + right * f / depth, sy = h/2 - up * f / depth,
// где f = (h/2) / tan(fov/2), а depth — расстояние вдоль оси взгляда. Глубина
// для z-буфера движка — 1 - near/depth в диапазоне 0..1 (ближе — меньше).
// ===========================================================================
#pragma once

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Флаги r2d_re2d_mesh. */
enum {
    R2D_RE2D_CULL_BACK = 1,   // не рисовать грани, обращённые от камеры
};

/** Состояние вида. Поля вне блока «производные» задаёт r2d_re2d_view_set. */
typedef struct R2DRe2dView {
    float x, y, eye;          // глаза: положение на полу и высота над полом
    float yaw, pitch;         // радианы
    float fov;                // вертикальный угол обзора, радианы
    float width, height;      // размер кадра в логических точках
    float near_plane;         // ближняя плоскость отсечения
    float fog_far, fog_min;   // затемнение с расстоянием; fog_far <= 0 — выключено

    // производные
    float cos_yaw, sin_yaw, cos_pitch, sin_pitch, focal;
} R2DRe2dView;

/** Счётчики последнего r2d_re2d_mesh: что движок сделал на самом деле. */
typedef struct R2DRe2dStats {
    int tris_in;              // треугольников на входе
    int tris_out;             // треугольников на выходе (отсечение может дать на один входной два)
    int behind;               // целиком позади ближней плоскости
    int clipped;              // обрезаны ближней плоскостью
    int culled;               // отброшены как обращённые от камеры
    int invalid;              // с нечисловыми координатами
    int overflow;             // не поместились в выходной буфер
} R2DRe2dStats;

/** Вид с настройками по умолчанию: ближняя плоскость 4, без тумана. */
void r2d_re2d_view_set(R2DRe2dView *v, float x, float y, float eye,
                       float yaw, float pitch, float fov,
                       float width, float height);

/** Затемнение с расстоянием: множитель цвета падает до fog_min к fog_far. */
void r2d_re2d_view_fog(R2DRe2dView *v, float fog_far, float fog_min);

/**
 * Мировая точка → экран. out = { sx, sy, z01, scale }, где scale — сколько
 * экранных пикселей занимает единица мира на этой глубине. false — точка
 * ближе ближней плоскости или позади камеры (out обнуляется, z01 = -1).
 */
bool r2d_re2d_project(const R2DRe2dView *v, float wx, float wy, float wz, float out[4]);

/**
 * Экранная точка → точка мира на горизонтальной плоскости высоты plane_z:
 * луч из глаз через пиксель, пересечённый с плоскостью (пол — plane_z = 0).
 * false — луч не попадает в плоскость (смотрит в небо, параллелен ей).
 */
bool r2d_re2d_unproject(const R2DRe2dView *v, float sx, float sy, float plane_z, float out[2]);

/** Пакет точек: in — stride 3 (x, y, z), out — stride 4. Возвращает число видимых. */
int r2d_re2d_project_points(const R2DRe2dView *v, const float *in, int count, float *out);

/**
 * Мировые треугольники → экранные вершины для engine.submitMesh.
 *
 * in  — stride 8: x, y, z, u, v, r, g, b (цвет 0..255), count вершин, кратно 3;
 * out — stride 8: sx, sy, z01, u, v, r, g, b; вместимость out_cap_verts вершин
 *       (хватает 2 * count вершин: отсечение даёт не больше двух треугольников
 *       из одного).
 *
 * Треугольник режется по ближней плоскости; цвет и текстурные координаты
 * интерполируются. Лицевой считается грань с обходом по часовой стрелке на
 * экране. Возвращает число выходных вершин (кратно 3).
 */
int r2d_re2d_mesh(const R2DRe2dView *v, const float *in, int count,
                  float *out, int out_cap_verts, unsigned flags,
                  R2DRe2dStats *stats);

#ifdef __cplusplus
}
#endif
