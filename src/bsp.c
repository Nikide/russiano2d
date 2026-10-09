#include "bsp.h"

#include <SDL3/SDL.h>   // SDL_zero

#include <math.h>
#include <stdlib.h>

#define R2D_BSP_MAX_DEPTH 64
#define R2D_BSP_SAMPLE     8     // сколько кандидатов в разделители перебираем

// ---------------------------------------------------------------------------
// Геометрия
// ---------------------------------------------------------------------------

// С какой стороны от прямой (ax,ay)->(bx,by) лежит точка.
// > 0 — спереди (слева от направления), < 0 — сзади, 0 — на прямой.
static float side_of(float ax, float ay, float bx, float by, float px, float py)
{
    return (px - ax) * -(by - ay) + (py - ay) * (bx - ax);
}

// Режет отрезок прямой разделителя надвое и раскладывает части по сторонам.
// Возвращает false, если отрезок целиком лежит в одной полуплоскости.
static bool split_segment(const R2DSegment *seg, float ax, float ay, float bx, float by,
                          R2DSegment *out_front, R2DSegment *out_back)
{
    const float d1 = side_of(ax, ay, bx, by, seg->x1, seg->y1);
    const float d2 = side_of(ax, ay, bx, by, seg->x2, seg->y2);

    if ((d1 <= 0.0f && d2 <= 0.0f) || (d1 >= 0.0f && d2 >= 0.0f)) return false;

    const float t = d1 / (d1 - d2);
    const float ix = seg->x1 + (seg->x2 - seg->x1) * t;
    const float iy = seg->y1 + (seg->y2 - seg->y1) * t;

    // Часть со стороны первого конца и часть со стороны второго. Какая из них
    // «передняя», определяется знаком d1: именно здесь легко перепутать
    // порядок концов и отправить половину отрезка не в ту полуплоскость.
    R2DSegment near_first  = { seg->x1, seg->y1, ix, iy, seg->user, true };
    R2DSegment near_second = { ix, iy, seg->x2, seg->y2, seg->user, true };

    if (d1 >= 0.0f) {
        *out_front = near_first;
        *out_back  = near_second;
    } else {
        *out_front = near_second;
        *out_back  = near_first;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Хранилища
// ---------------------------------------------------------------------------

static int add_segment(R2DBsp *b, float x1, float y1, float x2, float y2, int user, bool split)
{
    if (b->segment_count >= b->segment_cap) {
        const int cap = b->segment_cap ? b->segment_cap * 2 : 64;
        R2DSegment *p = (R2DSegment *)realloc(b->segments, (size_t)cap * sizeof(R2DSegment));
        if (!p) return -1;
        b->segments = p;
        b->segment_cap = cap;
    }
    R2DSegment *s = &b->segments[b->segment_count];
    s->x1 = x1; s->y1 = y1; s->x2 = x2; s->y2 = y2;
    s->user = user; s->split = split;
    return b->segment_count++;
}

static int add_node(R2DBsp *b)
{
    if (b->node_count >= b->node_cap) {
        const int cap = b->node_cap ? b->node_cap * 2 : 64;
        R2DBspNode *p = (R2DBspNode *)realloc(b->nodes, (size_t)cap * sizeof(R2DBspNode));
        if (!p) return -1;
        b->nodes = p;
        b->node_cap = cap;
    }
    R2DBspNode *n = &b->nodes[b->node_count];
    // Обнуляем целиком: у узла есть поля хвоста листа, и ноль для них —
    // корректное «хвоста нет».
    memset(n, 0, sizeof *n);
    n->splitter = -1;
    n->front = -1;
    n->back = -1;
    n->leftover_first = -1;
    n->leftover_count = 0;
    return b->node_count++;
}

static bool ensure_visit_capacity(R2DBsp *b, int need)
{
    if (need <= b->visit_cap) return true;
    int cap = b->visit_cap ? b->visit_cap : 64;
    while (cap < need) cap *= 2;

    int *order = (int *)realloc(b->visit_order, (size_t)cap * sizeof(int));
    if (!order) return false;
    b->visit_order = order;

    b->visit_cap = cap;
    return true;
}

// ---------------------------------------------------------------------------
// Построение
// ---------------------------------------------------------------------------

// Считает, сколько отрезков разрежет данный кандидат в разделители.
static int count_splits(const R2DBsp *b, const int *indices, int n, int candidate)
{
    const R2DSegment *sp = &b->segments[candidate];
    int splits = 0;
    for (int i = 0; i < n; i++) {
        if (indices[i] == candidate) continue;
        const float d1 = side_of(sp->x1, sp->y1, sp->x2, sp->y2,
                                 b->segments[indices[i]].x1, b->segments[indices[i]].y1);
        const float d2 = side_of(sp->x1, sp->y1, sp->x2, sp->y2,
                                 b->segments[indices[i]].x2, b->segments[indices[i]].y2);
        if ((d1 > 0.0f) != (d2 > 0.0f)) splits++;
    }
    return splits;
}

static int build_node(R2DBsp *b, int *indices, int n, int depth, bool *failed)
{
    if (n <= 0) return -1;

    // Выбираем разделитель из небольшой выборки: тот, что режет меньше всего.
    // Без этого на решётках получается вырожденное дерево глубиной O(n).
    int best = indices[0];
    int best_splits = count_splits(b, indices, n, best);
    const int sample = n < R2D_BSP_SAMPLE ? n : R2D_BSP_SAMPLE;
    for (int i = 1; i < sample; i++) {
        const int candidate = indices[(i * n) / sample];
        if (candidate == best) continue;
        const int s = count_splits(b, indices, n, candidate);
        if (s < best_splits) {
            best_splits = s;
            best = candidate;
        }
    }

    const R2DSegment sp = b->segments[best];

    // Каждый список может вырасти до 2n: к исходным отрезкам добавляются
    // половины разрезанных.
    const size_t list_cap = (size_t)(n * 2 + 16);
    int *front = (int *)malloc(list_cap * sizeof(int));
    int *back = (int *)malloc(list_cap * sizeof(int));
    // Индексы отрезков в списках ОТДЕЛЬНЫЕ от координат: разрезание создаёт
    // новые отрезки, а исходные индексы остаются валидными и после realloc.
    // Индекс активного неразделителя можно переиспользовать: его splitter
    // ещё не выбран, и sibling-список этим индексом не владеет.
    if (!front || !back) {
        *failed = true;
        free(front);
        free(back);
        return -1;
    }

    int nf = 0;
    int nb = 0;

    for (int i = 0; i < n; i++) {
        const int idx = indices[i];
        if (idx == best) continue;

        // Копия по значению: add_segment ниже перевыделяет массив отрезков.
        const R2DSegment seg = b->segments[idx];
        const float d1 = side_of(sp.x1, sp.y1, sp.x2, sp.y2, seg.x1, seg.y1);
        const float d2 = side_of(sp.x1, sp.y1, sp.x2, sp.y2, seg.x2, seg.y2);

        if (d1 >= 0.0f && d2 >= 0.0f) {
            front[nf++] = idx;
        } else if (d1 <= 0.0f && d2 <= 0.0f) {
            back[nb++] = idx;
        } else {
            R2DSegment f, bk;
            split_segment(&seg, sp.x1, sp.y1, sp.x2, sp.y2, &f, &bk);
            // The input index is not a splitter and belongs to this list only.
            // Reuse it for one half, so count() contains no abandoned originals.
            b->segments[idx] = f;
            const int bi = add_segment(b, bk.x1, bk.y1, bk.x2, bk.y2, seg.user, true);
            if (bi < 0) { *failed = true; free(front); free(back); return -1; }
            front[nf++] = idx;
            back[nb++] = bi;
        }
    }

    // Узел занимаем ДО рекурсии: add_node может перевыделить массив узлов, и
    // сохранённый индекс `node` после этого остаётся валидным, а указатель на
    // элемент — нет. Пишем поля только после возврата детей.
    const int node = add_node(b);
    if (node < 0) { *failed = true; free(front); free(back); return -1; }
    b->nodes[node].splitter = best;

    int front_node = -1;
    int back_node = -1;
    int leftover_first = -1;
    int leftover_count = 0;

    if (depth < R2D_BSP_MAX_DEPTH) {
        front_node = build_node(b, front, nf, depth + 1, failed);
        back_node  = build_node(b, back, nb, depth + 1, failed);
    } else {
        // Move the active tail into a contiguous range, without duplicating it.
        // All active segments are compacted once after construction below.
        leftover_first = b->segment_count;
        for (int side = 0; side < 2; side++) {
            const int *list = side ? back : front;
            const int count = side ? nb : nf;
            for (int i = 0; i < count; i++) {
                const R2DSegment tail = b->segments[list[i]];
                if (add_segment(b, tail.x1, tail.y1, tail.x2, tail.y2, tail.user, tail.split) < 0) {
                    *failed = true; free(front); free(back); return -1;
                }
                leftover_count++;
            }
        }
        if (!leftover_count) leftover_first = -1;
    }

    b->nodes[node].front = front_node;
    b->nodes[node].back = back_node;
    b->nodes[node].leftover_first = leftover_first;
    b->nodes[node].leftover_count = leftover_count;

    free(front);
    free(back);
    return node;
}

bool r2d_bsp_build(R2DBsp *b, const float *segments, int count)
{
    r2d_bsp_free(b);

    if (!segments || count <= 0) return false;

    for (int i = 0; i < count; i++) {
        const float *s = segments + (size_t)i * 5;
        if (add_segment(b, s[0], s[1], s[2], s[3], (int)s[4], false) < 0) {
            r2d_bsp_free(b);
            return false;
        }
    }

    int *indices = (int *)malloc((size_t)count * sizeof(int));
    if (!indices) { r2d_bsp_free(b); return false; }
    for (int i = 0; i < count; i++) indices[i] = i;

    bool failed = false;
    b->root = build_node(b, indices, count, 0, &failed);
    free(indices);
    if (failed || b->root < 0) { r2d_bsp_free(b); return false; }

    // Publish only reachable segments. Segment indices are local to a build;
    // user tags and endpoint orientation remain stable.
    int *map = malloc((size_t)b->segment_count * sizeof *map);
    if (!map) { r2d_bsp_free(b); return false; }
    for (int i = 0; i < b->segment_count; i++) map[i] = -1;
    for (int i = 0; i < b->node_count; i++) {
        const R2DBspNode *n = &b->nodes[i];
        map[n->splitter] = 0;
        for (int j = 0; j < n->leftover_count; j++) map[n->leftover_first + j] = 0;
    }
    int active = 0;
    for (int i = 0; i < b->segment_count; i++) if (map[i] == 0) {
        map[i] = active;
        b->segments[active++] = b->segments[i];
    }
    for (int i = 0; i < b->node_count; i++) {
        R2DBspNode *n = &b->nodes[i];
        n->splitter = map[n->splitter];
        if (n->leftover_count) n->leftover_first = map[n->leftover_first];
    }
    free(map);
    b->segment_count = active;
    if (!ensure_visit_capacity(b, active)) { r2d_bsp_free(b); return false; }
    return true;
}

void r2d_bsp_free(R2DBsp *b)
{
    if (!b) return;
    free(b->segments);
    free(b->nodes);
    free(b->visit_order);
    SDL_zero(*b);
    b->root = -1;
}

int r2d_bsp_segment_count(const R2DBsp *b) { return b ? b->segment_count : 0; }
int r2d_bsp_node_count(const R2DBsp *b) { return b ? b->node_count : 0; }

static void node_depth(const R2DBsp *b, int node, int depth, int *best)
{
    if (node < 0) return;
    if (depth > *best) *best = depth;
    node_depth(b, b->nodes[node].front, depth + 1, best);
    node_depth(b, b->nodes[node].back, depth + 1, best);
}

int r2d_bsp_depth(const R2DBsp *b)
{
    if (!b || b->root < 0) return 0;
    int best = 0;
    node_depth(b, b->root, 1, &best);
    return best;
}

// ---------------------------------------------------------------------------
// Обход
// ---------------------------------------------------------------------------

static void traverse_node(R2DBsp *b, int node, float px, float py,
                          bool far_to_near, int *count)
{
    if (node < 0) return;

    const R2DBspNode *n = &b->nodes[node];
    const R2DSegment *s = &b->segments[n->splitter];
    const float side = side_of(s->x1, s->y1, s->x2, s->y2, px, py);

    // Наблюдатель спереди: сзади лежит дальняя половина, её и рисуем первой.
    const int near_child = (side >= 0.0f) ? n->front : n->back;
    const int far_child  = (side >= 0.0f) ? n->back : n->front;

    // Хвост листа на предельной глубине: его отрезки тоже часть геометрии,
    // поэтому отдаём их сразу после разделителя узла.
    if (n->leftover_count > 0) {
        b->visit_order[(*count)++] = n->splitter;
        for (int i = 0; i < n->leftover_count; ++i) {
            if (*count < b->visit_cap) {
                b->visit_order[(*count)++] = n->leftover_first + i;
            }
        }
        return;
    }

    if (far_to_near) {
        traverse_node(b, far_child, px, py, far_to_near, count);
        if (*count < b->visit_cap) b->visit_order[(*count)++] = n->splitter;
        traverse_node(b, near_child, px, py, far_to_near, count);
    } else {
        traverse_node(b, near_child, px, py, far_to_near, count);
        if (*count < b->visit_cap) b->visit_order[(*count)++] = n->splitter;
        traverse_node(b, far_child, px, py, far_to_near, count);
    }
}

const int *r2d_bsp_traverse(R2DBsp *b, float x, float y, bool far_to_near, int *out_count)
{
    if (out_count) *out_count = 0;
    if (!b || b->root < 0) return NULL;
    // Порядок содержит каждый отрезок дерева ровно один раз: разделители — в
    // узлах, хвосты листьев — в своих диапазонах. Запас +1 на всякий случай.
    if (!ensure_visit_capacity(b, b->segment_count + 1)) return NULL;

    int count = 0;
    traverse_node(b, b->root, x, y, far_to_near, &count);
    if (out_count) *out_count = count;
    return b->visit_order;
}
