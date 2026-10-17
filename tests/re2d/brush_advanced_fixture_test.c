#include "sdk.h"
#include "unity.h"

#include <stdio.h>

void setUp(void) {}
void tearDown(void) {}

static void validate(const char *name, int expected_errors)
{
    char path[1024];
    snprintf(path, sizeof path, "%s/tests/fixtures/sdk/world/%s",
             R2D_TEST_SOURCE_DIR, name);
    SdkReport report;
    sdk_report_init(&report);
    sdk_validate_re2dmap(path, &report);
    TEST_ASSERT_EQUAL_INT_MESSAGE(expected_errors, report.errors, name);
    sdk_report_free(&report);
}

static void test_advanced_brush_fixture_compiles(void)
{
    // Convex polygon + rectilinear hole + Z-CSG subtract + all brush-entity
    // mappings must pass the same native compile path as a plain brush map.
    validate("brush_advanced.re2dmap", 0);
}

static void test_existing_brush_fixture_stays_valid(void)
{
    validate("brushes.re2dmap", 0);
}

static void test_legacy_cell_maps_stay_valid(void)
{
    validate("two.re2dmap", 0);
    validate("polygon_l.re2dmap", 0);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_advanced_brush_fixture_compiles);
    RUN_TEST(test_existing_brush_fixture_stays_valid);
    RUN_TEST(test_legacy_cell_maps_stay_valid);
    return UNITY_END();
}
