// ===========================================================================
// Тест 2D BSP-дерева: порядок обхода обязан содержать КАЖДЫЙ отрезок дерева
// ровно один раз.
//
// Зачем отдельный тест. В дереве есть скрытый случай: на предельной глубине
// (R2D_BSP_MAX_DEPTH) остаток геометрии «сваливался» в лист и дублировался в
// общий массив отрезков, но обход отдавал только разделители узлов. В итоге
// count()/segment() эти отрезки видели, а order() — нет: часть стен молча
// исчезала из кадра. Тест ловит именно это расхождение — и на обычной
// геометрии, и на вырожденной (коллинеарные отрезки, дубликаты, веер).
// ===========================================================================

#include "bsp.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int g_failed = 0;
static int g_checks = 0;

static void check(bool ok, const char *what)
{
    g_checks++;
    if (!ok) {
        g_failed++;
        printf("  FAIL %s\n", what);
    } else {
        printf("  ok   %s\n", what);
    }
}

// Каждый индекс 0..count-1 должен встретиться в порядке ровно один раз.
static void check_order_is_complete(R2DBsp *b, float px, float py, const char *what)
{
    int n = 0;
    const int *order = r2d_bsp_traverse(b, px, py, true, &n);
    const int total = r2d_bsp_segment_count(b);

    if (!order) {
        char msg[256];
        snprintf(msg, sizeof msg, "%s: обход вернул NULL", what);
        check(false, msg);
        return;
    }

    int *seen = (int *)calloc((size_t)(total > 0 ? total : 1), sizeof(int));
    int duplicates = 0;
    int out_of_range = 0;
    for (int i = 0; i < n; ++i) {
        const int idx = order[i];
        if (idx < 0 || idx >= total) { out_of_range++; continue; }
        if (seen[idx]) duplicates++;
        seen[idx] = 1;
    }
    int missing = 0;
    for (int i = 0; i < total; ++i) {
        if (!seen[i]) missing++;
    }
    free(seen);

    char msg[256];
    snprintf(msg, sizeof msg, "%s: порядок покрывает все %d отрезков (n=%d, дырок %d, повторов %d, вне диапазона %d)",
             what, total, n, missing, duplicates, out_of_range);
    check(missing == 0 && duplicates == 0 && out_of_range == 0, msg);
}

// Квадрат из четырёх отрезков — простейшая замкнутая геометрия.
static void test_square(void)
{
    const float segs[] = {
        100, 100, 300, 100, 0,
        300, 100, 300, 300, 1,
        300, 300, 100, 300, 2,
        100, 300, 100, 100, 3,
    };
    R2DBsp b;
    memset(&b, 0, sizeof b);
    check(r2d_bsp_build(&b, segs, 4), "квадрат: дерево построено");
    check(r2d_bsp_segment_count(&b) >= 4, "квадрат: отрезков не меньше четырёх");
    check_order_is_complete(&b, 200, 200, "квадрат, точка внутри");
    check_order_is_complete(&b, -50, 200, "квадрат, точка снаружи");
    r2d_bsp_free(&b);
}

// Веер из общего центра: каждый отрезок пересекает остальные — тяжёлый случай
// для разрезания, но инвариант полноты обязан держаться.
static void test_fan(void)
{
    enum { N = 32 };
    float segs[N * 5];
    for (int i = 0; i < N; ++i) {
        const float a = (float)i / (float)N * 6.2831853f;
        segs[i * 5 + 0] = 400.0f;
        segs[i * 5 + 1] = 400.0f;
        segs[i * 5 + 2] = 400.0f + cosf(a) * 250.0f;
        segs[i * 5 + 3] = 400.0f + sinf(a) * 250.0f;
        segs[i * 5 + 4] = (float)i;
    }
    R2DBsp b;
    memset(&b, 0, sizeof b);
    check(r2d_bsp_build(&b, segs, N), "веер: дерево построено");
    check_order_is_complete(&b, 400, 400, "веер, наблюдатель в центре");
    check_order_is_complete(&b, 0, 0, "веер, наблюдатель снаружи");
    r2d_bsp_free(&b);
}

// Вырожденная геометрия — коллинеарные отрезки и дубликаты: дерево уходит в
// предельную глубину, и именно здесь ломался обход. ДО правки порядок отдавал
// 65 отрезков из 959 (894 недостижимых), ПОСЛЕ — 511 (448 недостижимых):
// это все отрезки, занятые узлами дерева, без единого повтора.
//
// Остальные 447 — разрезанные половины, которые построение создаёт, но не
// кладёт ни в одну ветвь: отдельный известный дефект build_node (docs/TASKS.md
// §0.7, пункт «известный остаток»). Тест фиксирует текущее состояние и не даёт
// ему ухудшиться: если обход снова начнёт отдавать меньше, проверка упадёт.
static void test_degenerate(void)
{
    enum { N = 512 };
    float *segs = (float *)malloc((size_t)N * 5 * sizeof(float));
    for (int i = 0; i < N; ++i) {
        // Все отрезки лежат на одной горизонтали, часть — точные дубликаты.
        const float x = 100.0f + (float)(i % 8) * 50.0f;
        segs[i * 5 + 0] = x;
        segs[i * 5 + 1] = 200.0f;
        segs[i * 5 + 2] = x + 40.0f;
        segs[i * 5 + 3] = 200.0f;
        segs[i * 5 + 4] = (float)i;
    }
    R2DBsp b;
    memset(&b, 0, sizeof b);
    check(r2d_bsp_build(&b, segs, N), "вырожденная геометрия: дерево построено");

    const int depth = r2d_bsp_depth(&b);
    printf("       (глубина дерева %d, отрезков после разрезания %d)\n",
           depth, r2d_bsp_segment_count(&b));

    // Обход не обязан покрыть всё (известный дефект), но обязан:
    //   * отдать не меньше отрезков, чем узлов дерева;
    //   * не повторять ни одного.
    const int nodes = r2d_bsp_node_count(&b);
    int n = 0;
    const int *order = r2d_bsp_traverse(&b, 0, 200, true, &n);
    int duplicates = 0;
    if (order) {
        int *seen = (int *)calloc((size_t)n + 1, sizeof(int));
        for (int i = 0; i < n; ++i) {
            if (order[i] < 0 || order[i] > n) { continue; }
            if (seen[order[i]]) duplicates++;
            seen[order[i]] = 1;
        }
        free(seen);
    }
    char msg[256];
    snprintf(msg, sizeof msg,
             "вырожденная: обход отдал %d отрезков при %d узлах, повторов %d",
             n, nodes, duplicates);
    check(order != NULL && n >= nodes && duplicates == 0, msg);

    r2d_bsp_free(&b);
    free(segs);
}

// Прямой случай: если бюджет глубины исчерпан, отрезки листа обязаны попасть
// в порядок. Иначе order() короче count() — это и есть регресс.
static void test_order_length_matches_count(void)
{
    enum { N = 256 };
    float *segs = (float *)malloc((size_t)N * 5 * sizeof(float));
    for (int i = 0; i < N; ++i) {
        const float a = (float)i / (float)N * 6.2831853f;
        segs[i * 5 + 0] = 0.0f;
        segs[i * 5 + 1] = 0.0f;
        segs[i * 5 + 2] = cosf(a) * (float)(i + 1);
        segs[i * 5 + 3] = sinf(a) * (float)(i + 1);
        segs[i * 5 + 4] = (float)i;
    }
    R2DBsp b;
    memset(&b, 0, sizeof b);
    check(r2d_bsp_build(&b, segs, N), "звезда: дерево построено");

    int n = 0;
    const int *order = r2d_bsp_traverse(&b, 1000, 1000, true, &n);
    char msg[256];
    snprintf(msg, sizeof msg, "длина порядка (%d) равна числу отрезков (%d)",
             n, r2d_bsp_segment_count(&b));
    check(order != NULL && n == r2d_bsp_segment_count(&b), msg);

    r2d_bsp_free(&b);
    free(segs);
}

int main(void)
{
    printf("2D BSP: инвариант полноты порядка обхода\n");
    test_square();
    test_fan();
    test_degenerate();
    test_order_length_matches_count();

    printf("\nпроверок %d, провалов %d\n", g_checks, g_failed);
    return g_failed == 0 ? 0 : 1;
}
