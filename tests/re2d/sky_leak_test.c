#include "sdk.h"
#include "unity.h"

#include <stdio.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static int validate(const char *name, bool *leak)
{
    char path[1024];
    snprintf(path, sizeof path, "%s/tests/fixtures/sdk/world/%s",
             R2D_TEST_SOURCE_DIR, name);
    SdkReport report;
    sdk_report_init(&report);
    sdk_validate_re2dmap(path, &report);
    const bool has_leak = report.items.data &&
                          strstr(report.items.data, "SDK_WORLD_SKY_LEAK") != NULL;
    if (leak) *leak = has_leak;
    const int errors = report.errors;
    if (errors) fprintf(stderr, "%s errors: %d\n", name, errors);
    sdk_report_free(&report);
    return errors;
}

static void test_sealed_cell_has_no_leak(void)
{
    bool leak = true;
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, validate("sealed.re2dmap", &leak), "sealed map compiles");
    TEST_ASSERT_FALSE_MESSAGE(leak, "four sealing walls -> no exterior flood-fill reach");
}

static void test_missing_outer_wall_is_a_leak(void)
{
    bool leak = false;
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, validate("leaked.re2dmap", &leak), "leaked map compiles");
    TEST_ASSERT_TRUE_MESSAGE(leak, "missing east wall lets exterior flood reach the room");
}

static void test_open_internal_edge_is_not_a_leak(void)
{
    bool leak = true;
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, validate("sealed_two.re2dmap", &leak),
                                  "two sealed cells compile");
    TEST_ASSERT_FALSE_MESSAGE(leak,
                              "open internal edge between sealed cells is not an exterior leak");
}

static void test_brush_envelope_is_sealed(void)
{
    bool leak = true;
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, validate("brushes.re2dmap", &leak),
                                  "brush fixture compiles");
    TEST_ASSERT_FALSE_MESSAGE(leak,
                              "brush sky envelope + walls seal the map (no flood-fill leak)");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_sealed_cell_has_no_leak);
    RUN_TEST(test_missing_outer_wall_is_a_leak);
    RUN_TEST(test_open_internal_edge_is_not_a_leak);
    RUN_TEST(test_brush_envelope_is_sealed);
    return UNITY_END();
}
