#include "sdk.h"
#include "unity.h"

#include <stdio.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

static void validate(const char *name)
{
    char path[1024];
    snprintf(path, sizeof path, "%s/tests/fixtures/sdk/world/%s", R2D_TEST_SOURCE_DIR, name);
    SdkReport rep;
    sdk_report_init(&rep);
    sdk_validate_re2dmap(path, &rep);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, rep.errors, name);
    sdk_report_free(&rep);
}

static void test_brush_fixture_compiles(void)
{
    validate("brushes.re2dmap");
}

static void test_backward_compatible_cell_map_compiles(void)
{
    validate("two.re2dmap");
    validate("polygon_l.re2dmap");
    validate("demo.re2dmap");
}

static void test_invalid_brush_map_rejected(void)
{
    char path[1024];
    snprintf(path, sizeof path, "%s/tests/fixtures/sdk/world/bad_range.re2dmap",
             R2D_TEST_SOURCE_DIR);
    SdkReport rep;
    sdk_report_init(&rep);
    sdk_validate_re2dmap(path, &rep);
    TEST_ASSERT_GREATER_THAN(0, rep.errors);
    sdk_report_free(&rep);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_brush_fixture_compiles);
    RUN_TEST(test_backward_compatible_cell_map_compiles);
    RUN_TEST(test_invalid_brush_map_rejected);
    return UNITY_END();
}
