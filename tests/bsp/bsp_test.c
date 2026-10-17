// ===========================================================================
// Тест 2D BSP-дерева (Unity): порядок обхода обязан содержать КАЖДЫЙ отрезок
// дерева ровно один раз.
//
// Зачем отдельный тест. В дереве есть скрытый случай: на предельной глубине
// (R2D_BSP_MAX_DEPTH) остаток геометрии «сваливался» в лист и дублировался в
// общий массив отрезков, но обход отдавал только разделители узлов. В итоге
// count()/segment() эти отрезки видели, а order() — нет: часть стен молча
// исчезала из кадра. Тест ловит именно это расхождение — и на обычной
// геометрии, и на вырожденной (коллинеарные отрезки, дубликаты, веер).
//
// Пилот Unity (ThrowTheSwitch/Unity, v2.6.0): фреймворк лежит в
// third_party/unity, цель CMake — r2d_bsp_test; tools/ci_verify.py гоняет её
// так же, как прежний ручной тест, но с TEST_ASSERT_* и автоотчётом Unity.
// ===========================================================================

#include "bsp.h"
#include "unity.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

// Каждый индекс 0..count-1 должен встретиться в порядке ровно один раз.
static void check_order_is_complete(R2DBsp *b, float px, float py, const char *what)
{
    int n = 0;
    const int *order = r2d_bsp_traverse(b, px, py, true, &n);
    const int total = r2d_bsp_segment_count(b);

    if (!order) {
        char msg[256];
        snprintf(msg, sizeof msg, "%s: traverse returned NULL", what);
        TEST_FAIL_MESSAGE(msg);
        return;
    }

    int *seen = (int *)calloc((size_t)(total > 0 ? total : 1), sizeof(int));
    TEST_ASSERT_NOT_NULL_MESSAGE(seen, "calloc for traversal marks");
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
    snprintf(msg, sizeof msg, "%s: order covers all %d segments (n=%d, missing %d, duplicates %d, out_of_range %d)",
             what, total, n, missing, duplicates, out_of_range);
    TEST_ASSERT_TRUE_MESSAGE(missing == 0 && duplicates == 0 && out_of_range == 0, msg);
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
    TEST_ASSERT_TRUE_MESSAGE(r2d_bsp_build(&b, segs, 4), "square: tree built");
    TEST_ASSERT_GREATER_OR_EQUAL_INT32_MESSAGE(4, r2d_bsp_segment_count(&b),
                                               "square: at least four segments");
    check_order_is_complete(&b, 200, 200, "square, point inside");
    check_order_is_complete(&b, -50, 200, "square, point outside");
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
    TEST_ASSERT_TRUE_MESSAGE(r2d_bsp_build(&b, segs, N), "fan: tree built");
    check_order_is_complete(&b, 400, 400, "fan, viewer at center");
    check_order_is_complete(&b, 0, 0, "fan, viewer outside");
    r2d_bsp_free(&b);
}

// Коллинеарные отрезки и дубликаты: проверяем полноту на пределе глубины.
static void test_degenerate(void)
{
    enum { N = 512 };
    float *segs = (float *)malloc((size_t)N * 5 * sizeof(float));
    TEST_ASSERT_NOT_NULL_MESSAGE(segs, "degenerate geometry array");
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
    TEST_ASSERT_TRUE_MESSAGE(r2d_bsp_build(&b, segs, N),
                             "degenerate geometry: tree built");

    check_order_is_complete(&b, 0, 200, "depth limit: splitter and every segment");
    const int depth = r2d_bsp_depth(&b);
    printf("       (глубина дерева %d, отрезков после разрезания %d)\n",
           depth, r2d_bsp_segment_count(&b));

    // Полный обход должен сохранять все активные отрезки.
    const int nodes = r2d_bsp_node_count(&b);
    int n = 0;
    const int *order = r2d_bsp_traverse(&b, 0, 200, true, &n);
    int duplicates = 0;
    if (order) {
        int *seen = (int *)calloc((size_t)n + 1, sizeof(int));
        TEST_ASSERT_NOT_NULL_MESSAGE(seen, "calloc for duplicates");
        for (int i = 0; i < n; ++i) {
            if (order[i] < 0 || order[i] > n) { continue; }
            if (seen[order[i]]) duplicates++;
            seen[order[i]] = 1;
        }
        free(seen);
    }
    char msg[256];
    snprintf(msg, sizeof msg,
             "degenerate: traverse returned %d segments at %d nodes, duplicates %d",
             n, nodes, duplicates);
    TEST_ASSERT_TRUE_MESSAGE(order != NULL && n >= nodes && duplicates == 0, msg);

    r2d_bsp_free(&b);
    free(segs);
}

// Прямой случай: если бюджет глубины исчерпан, отрезки листа обязаны попасть
// в порядок. Иначе order() короче count() — это и есть регресс.
static void test_order_length_matches_count(void)
{
    enum { N = 256 };
    float *segs = (float *)malloc((size_t)N * 5 * sizeof(float));
    TEST_ASSERT_NOT_NULL_MESSAGE(segs, "star geometry array");
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
    TEST_ASSERT_TRUE_MESSAGE(r2d_bsp_build(&b, segs, N), "star: tree built");

    int n = 0;
    const int *order = r2d_bsp_traverse(&b, 1000, 1000, true, &n);
    char msg[256];
    snprintf(msg, sizeof msg, "order length (%d) equals segment count (%d)",
             n, r2d_bsp_segment_count(&b));
    TEST_ASSERT_TRUE_MESSAGE(order != NULL && n == r2d_bsp_segment_count(&b), msg);

    r2d_bsp_free(&b);
    free(segs);
}

// Both crossing directions must split; active geometry must be reachable.
static void test_crossing_directions(void)
{
    for (int reverse = 0; reverse < 2; reverse++) {
        const float segments[] = { -10,0,10,0,0, 0,reverse ? -10:10,0,reverse ? 10:-10,1 };
        R2DBsp b = {0};
        TEST_ASSERT_TRUE_MESSAGE(r2d_bsp_build(&b, segments, 2), "crossing: build");
        int n = 0;
        const int *order = r2d_bsp_traverse(&b, 5, 5, true, &n);
        TEST_ASSERT_TRUE_MESSAGE(order && n == 3,
                                 "crossing: two halves plus splitter in both directions");
        check_order_is_complete(&b, 5, 5, "crossing: active count");
        r2d_bsp_free(&b);
    }
}

int main(void)
{
    UNITY_BEGIN();
    printf("2D BSP: traversal completeness invariant (Unity %d.%d.%d)\n",
           UNITY_VERSION_MAJOR, UNITY_VERSION_MINOR, UNITY_VERSION_BUILD);
    RUN_TEST(test_crossing_directions);
    RUN_TEST(test_square);
    RUN_TEST(test_fan);
    RUN_TEST(test_degenerate);
    RUN_TEST(test_order_length_matches_count);
    return UNITY_END();
}
