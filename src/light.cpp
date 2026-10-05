// ===========================================================================
// Полигоны видимости: C++-обёртка над trylock/visibility с чистым C-API.
//
// Библиотека header-only и написана на C++, поэтому весь C++ живёт в этом
// единственном файле, а наружу смотрит src/light.h (чистый C).
//
// Библиотека не проверяет два своих предусловия, и обёртка берёт их на себя:
//
//   1) Отрезки не должны пересекаться нигде, кроме общих концов. Отрезки
//      приходят из JS и запросто могут пересекаться (стены крест-накрест,
//      накладывающиеся коллинеарные куски). Перед вызовом алгоритма все
//      попарные пересечения находятся и отрезки режутся по ним. Для демо
//      с парой десятков отрезков O(n^2) незаметен.
//
//   2) Полигон видимости должен быть замкнут. Вокруг всех препятствий и
//      наблюдателя добавляется ограничивающая рамка с запасом — иначе
//      алгоритм не знает, где заканчивается «открытая» геометрия.
//
// Наружу не вылетает ни исключений, ни abort()'ов: всё, что не влезло или
// оказалось невалидным, превращается в возврат 0.
// ===========================================================================

// Библиотека щедро расставляет assert() на внутренние инварианты и молча
// предполагает «хорошую» геометрию. На вход (из JS) может прийти вырожденный
// или пограничный случай, а ронять движок из-за этого нельзя. NDEBUG обязан
// стоять до первого включения <cassert> — то есть до всех заголовков; влияет
// он только на этот файл трансляции.
#ifndef NDEBUG
#define NDEBUG 1
#endif

#include "light.h"

#include <visibility/visibility.hpp>

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <utility>
#include <vector>

namespace {

using vec2 = geometry::vec2;  // = geometry::vector2<float>
using segment = geometry::line_segment<vec2>;

// Допуск по параметру вдоль отрезка (t в [0, 1]): им же сравниваются почти
// совпадающие точки разреза.
constexpr float kParamEps = 1e-6f;

// Относительный допуск для векторных произведений: cross имеет размерность
// длины в квадрате, поэтому абсолютный порог здесь не годится.
constexpr float kGeomEps = 1e-6f;

// Отрезок короче этого (в квадрате длины) считается вырожденным и
// выбрасывается: у него нет направления, и алгоритм на нём не определён.
constexpr float kMinLenSq = 1e-12f;

bool finite(float v)
{
    return std::isfinite(v);
}

// Добавляет параметр разреза, если точка вообще лежит на отрезке. Крошечные
// вылеты за [0, 1] из-за округления прижимаются к концам, а не отбрасываются:
// иначе на конце мог бы остаться незакрытый стык.
void push_param(std::vector<float> &ts, float t)
{
    if (!finite(t)) return;
    if (t < -kParamEps || t > 1.0f + kParamEps) return;
    ts.push_back(std::min(1.0f, std::max(0.0f, t)));
}

// Находит точки, в которых отрезки a и b пересекаются или накладываются, и
// складывает их параметры вдоль каждого отрезка в ts_a / ts_b. Сами отрезки
// не меняются — резать будем позже, одним проходом по всем параметрам.
void collect_intersections(const segment &a, const segment &b,
                           std::vector<float> &ts_a, std::vector<float> &ts_b)
{
    const vec2 p = a.a, r = a.b - a.a;
    const vec2 q = b.a, s = b.b - b.a;

    const float r2 = dot(r, r);
    const float s2 = dot(s, s);
    if (r2 <= kMinLenSq || s2 <= kMinLenSq) return;

    const float rlen = std::sqrt(r2);
    const float slen = std::sqrt(s2);
    const float qpx = q.x - p.x;
    const float qpy = q.y - p.y;

    const float denom = cross(r, s);

    // Общий (не параллельный) случай: одна точка пересечения прямых. Она
    // лежит на отрезках, если оба параметра попали в [0, 1].
    if (std::fabs(denom) > kGeomEps * rlen * slen)
    {
        const float t = (qpx * s.y - qpy * s.x) / denom;  // cross(q - p, s) / denom
        const float u = (qpx * r.y - qpy * r.x) / denom;  // cross(q - p, r) / denom
        if (t >= -kParamEps && t <= 1.0f + kParamEps &&
            u >= -kParamEps && u <= 1.0f + kParamEps)
        {
            push_param(ts_a, t);
            push_param(ts_b, u);
        }
        return;
    }

    // Параллельны. Если прямые не совпадают — пересечений нет.
    if (std::fabs(qpx * r.y - qpy * r.x) > kGeomEps * rlen * slen) return;

    // Коллинеарны: режем каждый отрезок по проекциям концов другого. Это
    // закрывает и общий случай частичного наложения, и полные дубликаты.
    const float qa  = dot(q - p, r) / r2;         // b.a на прямой a
    const float qb  = dot(b.b - p, r) / r2;       // b.b на прямой a
    const float pa  = dot(p - q, s) / s2;         // a.a на прямой b
    const float pb  = dot(a.b - q, s) / s2;       // a.b на прямой b

    push_param(ts_a, qa);
    push_param(ts_a, qb);
    push_param(ts_b, pa);
    push_param(ts_b, pb);
}

// Канонический ключ отрезка для выбрасывания точных дубликатов: концы
// упорядочены, координаты огрублены до сетки. Два совпадающих отрезка — это
// два равных элемента в std::set алгоритма; erase() по такому «близнецу»
// снял бы состояние дважды и сломал обход, поэтому дубликаты убираем заранее.
long long quantize(float v)
{
    const double grid = 1e-4;
    return std::llround(static_cast<double>(v) / grid);
}

struct SegmentKey
{
    long long v[4];
};

bool operator<(const SegmentKey &x, const SegmentKey &y)
{
    for (int i = 0; i < 4; ++i)
    {
        if (x.v[i] != y.v[i]) return x.v[i] < y.v[i];
    }
    return false;
}

// Разрезает входные отрезки по всем найденным пересечениям. Возвращает
// список непересекающихся (кроме общих концов) отрезков без дубликатов.
std::vector<segment> build_split_segments(const float *segments, int count)
{
    std::vector<segment> raw;
    raw.reserve(static_cast<std::size_t>(count > 0 ? count : 0));

    for (int i = 0; i < count; ++i)
    {
        const float *s = segments + i * 4;
        if (!finite(s[0]) || !finite(s[1]) || !finite(s[2]) || !finite(s[3]))
            continue;  // NaN/Inf из скрипта — просто игнорируем отрезок

        const vec2 a{s[0], s[1]};
        const vec2 b{s[2], s[3]};
        if (distance_squared(a, b) <= kMinLenSq) continue;
        raw.push_back(segment{a, b});
    }

    // Параметры разреза для каждого исходного отрезка; 0 и 1 — его концы.
    std::vector<std::vector<float>> cuts(raw.size());
    for (std::size_t i = 0; i < raw.size(); ++i)
    {
        cuts[i].push_back(0.0f);
        cuts[i].push_back(1.0f);
    }

    for (std::size_t i = 0; i < raw.size(); ++i)
    {
        for (std::size_t j = i + 1; j < raw.size(); ++j)
            collect_intersections(raw[i], raw[j], cuts[i], cuts[j]);
    }

    std::vector<std::pair<SegmentKey, segment>> keyed;

    for (std::size_t i = 0; i < raw.size(); ++i)
    {
        std::vector<float> &ts = cuts[i];
        std::sort(ts.begin(), ts.end());

        std::vector<float> uniq;
        uniq.reserve(ts.size());
        for (float t : ts)
        {
            if (uniq.empty() || t - uniq.back() > kParamEps)
                uniq.push_back(t);
        }

        const vec2 a = raw[i].a;
        const vec2 ab = raw[i].b - raw[i].a;

        for (std::size_t k = 0; k + 1 < uniq.size(); ++k)
        {
            if (uniq[k + 1] - uniq[k] <= kParamEps) continue;
            const vec2 p0 = a + ab * uniq[k];
            const vec2 p1 = a + ab * uniq[k + 1];
            if (distance_squared(p0, p1) <= kMinLenSq) continue;

            vec2 lo = p0, hi = p1;
            if (hi.x < lo.x || (hi.x == lo.x && hi.y < lo.y))
                std::swap(lo, hi);

            SegmentKey key{{quantize(lo.x), quantize(lo.y),
                            quantize(hi.x), quantize(hi.y)}};
            keyed.emplace_back(key, segment{lo, hi});
        }
    }

    std::sort(keyed.begin(), keyed.end(),
              [](const auto &x, const auto &y) { return x.first < y.first; });
    keyed.erase(std::unique(keyed.begin(), keyed.end(),
                            [](const auto &x, const auto &y) {
                                return !(x.first < y.first) &&
                                       !(y.first < x.first);
                            }),
                keyed.end());

    std::vector<segment> out;
    out.reserve(keyed.size());
    for (auto &kv : keyed) out.push_back(kv.second);
    return out;
}

// Добавляет замкнутую рамку вокруг всех препятствий и наблюдателя. Наблюдатель
// тоже входит в габариты, поэтому после раздува он гарантированно внутри, а
// рамка заведомо больше всех препятствий.
void append_bounding_box(std::vector<segment> &segs, float ox, float oy)
{
    float minx = ox, maxx = ox, miny = oy, maxy = oy;
    for (const segment &s : segs)
    {
        minx = std::min(minx, std::min(s.a.x, s.b.x));
        maxx = std::max(maxx, std::max(s.a.x, s.b.x));
        miny = std::min(miny, std::min(s.a.y, s.b.y));
        maxy = std::max(maxy, std::max(s.a.y, s.b.y));
    }

    const float w = maxx - minx;
    const float h = maxy - miny;
    const float pad = 0.5f * std::max(std::max(w, h), 1.0f) + 10.0f;

    minx -= pad;
    maxx += pad;
    miny -= pad;
    maxy += pad;

    segs.push_back(segment{{minx, miny}, {maxx, miny}});
    segs.push_back(segment{{maxx, miny}, {maxx, maxy}});
    segs.push_back(segment{{maxx, maxy}, {minx, maxy}});
    segs.push_back(segment{{minx, maxy}, {minx, miny}});
}

}  // namespace

extern "C" int r2d_visibility_polygon(const float *segments, int segment_count,
                                       float ox, float oy,
                                       float *out_points, int max_points)
{
    if (!out_points || max_points <= 0) return 0;
    if (!finite(ox) || !finite(oy)) return 0;
    if (segment_count < 0) return 0;
    if (segment_count > 0 && !segments) return 0;

#ifdef __cpp_exceptions
    try
#endif
    {
        std::vector<segment> obstacles =
            build_split_segments(segments, segment_count);
        append_bounding_box(obstacles, ox, oy);

        const vec2 observer{ox, oy};
        std::vector<vec2> polygon = geometry::visibility_polygon(
            observer, obstacles.begin(), obstacles.end());

        if (polygon.empty()) return 0;
        // Буфер меньше нужного — честный отказ, а не запись за границу.
        if (static_cast<int>(polygon.size()) > max_points) return 0;

        for (std::size_t i = 0; i < polygon.size(); ++i)
        {
            if (!finite(polygon[i].x) || !finite(polygon[i].y)) return 0;
            out_points[2 * i]     = polygon[i].x;
            out_points[2 * i + 1] = polygon[i].y;
        }
        return static_cast<int>(polygon.size());
    }
#ifdef __cpp_exceptions
    catch (...)
    {
        return 0;
    }
#endif
}

extern "C" int r2d_visibility_max_points(int segment_count)
{
    if (segment_count <= 0) return 16;  // только рамка: 8 событий с запасом

    // Разрезание: каждый исходный отрезок режется не более чем по двум
    // точкам от каждого из остальных (n - 1), то есть даёт меньше 2n
    // подотрезков. Итого m <= 2n^2 + 4 (четыре стороны рамки). На каждый
    // подотрезок алгоритм заводит два события и добавляет не больше двух
    // вершин, отсюда 4m; плюс запас.
    const long long n = segment_count;
    const long long m = 2 * n * n + 4;
    const long long bound = 4 * m + 8;

    if (bound > 2147483647LL) return 2147483647;
    return static_cast<int>(bound);
}
