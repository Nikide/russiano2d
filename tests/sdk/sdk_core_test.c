// ===========================================================================
// Тесты нативного бэкенда SDK без окна и GPU: диагностика, glob, ISO 8601,
// реестр sdk_tools.json, типы и сканирование ассетов, валидация.
// Собирается с ASan/UBSan (см. sdk/native/CMakeLists.txt).
// ===========================================================================
#include "sdk.h"

#include <SDL3/SDL.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int g_fail = 0, g_ok = 0;

#define CHECK(cond, msg) do { \
    if (cond) { ++g_ok; } else { ++g_fail; printf("  FAIL %s (%s:%d)\n", msg, __FILE__, __LINE__); } \
} while (0)

static char g_tmp[512];

static void put(const char *rel, const char *text)
{
    char path[1024];
    snprintf(path, sizeof path, "%s/%s", g_tmp, rel);
    char dir[1024];
    sdk_dirname(path, dir, sizeof dir);
    SDL_CreateDirectory(dir);
    sdk_write_file(path, text, strlen(text));
}

static const char *p(const char *rel)
{
    static char buf[4][1024];
    static int i = 0;
    i = (i + 1) % 4;
    snprintf(buf[i], sizeof buf[i], "%s/%s", g_tmp, rel);
    return buf[i];
}

// Диагностика должна быть валидным JSON: разбираем собственным парсером.
static bool report_is_json(const SdkReport *r)
{
    R2dSb sb;
    r2d_sb_init(&sb);
    r2d_sb_putc(&sb, '{');
    sdk_report_put(r, &sb);
    r2d_sb_putc(&sb, '}');
    char err[128];
    R2dJson *j = r2d_json_parse(sb.data, err, sizeof err);
    const bool ok = j != NULL && r2d_json_size(r2d_json_get(j, "diagnostics")) == r->count;
    r2d_json_free(j);
    r2d_sb_free(&sb);
    return ok;
}

static bool has_code(const SdkReport *r, const char *code)
{
    return r->items.data && strstr(r->items.data, code) != NULL;
}

static void test_glob(void)
{
    CHECK(sdk_glob_match("*.character.json", "hero.character.json"), "glob суффикс");
    CHECK(sdk_glob_match("*.CHARACTER.json", "hero.character.json"), "glob без учёта регистра");
    CHECK(!sdk_glob_match("*.character.json", "hero.json"), "glob не совпал");
    CHECK(sdk_glob_match("a?c", "abc"), "glob ?");
    CHECK(sdk_glob_match("*", ""), "glob * пустое имя");
    CHECK(!sdk_glob_match("a*b", "ac"), "glob a*b");
}

static void test_iso(void)
{
    CHECK(sdk_iso8601_tz_ok("2026-10-08T17:00:00+03:00"), "ISO со смещением");
    CHECK(sdk_iso8601_tz_ok("2026-10-08T17:00:00Z"), "ISO Z");
    CHECK(sdk_iso8601_tz_ok("2026-10-08T17:00Z"), "ISO без секунд");
    CHECK(sdk_iso8601_tz_ok("2026-10-08T17:00:00.250-05:30"), "ISO с долями");
    CHECK(!sdk_iso8601_tz_ok("2026-10-08T17:00:00"), "ISO без пояса отклонён");
    CHECK(!sdk_iso8601_tz_ok("2026-10-08 17:00:00Z"), "ISO без T отклонён");
    CHECK(!sdk_iso8601_tz_ok("2026-13-08T17:00:00Z"), "месяц 13 отклонён");
    CHECK(!sdk_iso8601_tz_ok("вчера"), "мусор отклонён");
    CHECK(!sdk_iso8601_tz_ok(NULL), "NULL отклонён");
}

static void test_types(void)
{
    CHECK(strcmp(sdk_asset_type("a/hero.character.json"), "re2dsprite.character") == 0, "тип character");
    CHECK(strcmp(sdk_asset_type("menu.rml"), "rmlui.document") == 0, "тип rml");
    CHECK(strcmp(sdk_asset_type("level.re2dmap"), "re2d.world") == 0, "тип re2dmap");
    CHECK(strcmp(sdk_asset_type("x/crate.glb"), "model.glb") == 0, "тип glb");
    CHECK(strcmp(sdk_asset_type("x/data.json"), "json") == 0, "тип json");
    CHECK(strcmp(sdk_asset_type("noext"), "file") == 0, "тип file");
    CHECK(strcmp(sdk_asset_type("a/project.json"), "project") == 0, "тип project");
}

static void test_registry(void)
{
    // Корректный реестр.
    put("good/sdk_tools.json",
        "{\"schema_version\":1,\"tools\":["
        "{\"id\":\"world-studio\",\"name\":\"World\",\"description\":\"d\","
        "\"last_updated\":\"2026-10-08T17:00:00+03:00\",\"entry\":\"world-studio\","
        "\"assets\":[\"*.re2dmap\"]}]}");
    SdkReport rep;
    sdk_report_init(&rep);
    SdkRegistry reg;
    CHECK(sdk_registry_load(p("good/sdk_tools.json"), &reg, &rep), "реестр загружен");
    CHECK(rep.errors == 0 && reg.count == 1 && reg.tools[0].valid, "реестр без ошибок");
    CHECK(reg.tools[0].asset_count == 1, "assets прочитаны");
    CHECK(report_is_json(&rep), "диагностика — JSON");
    sdk_registry_free(&reg);
    sdk_report_free(&rep);

    // Неверная версия схемы: структурная ошибка, а не молчание.
    put("badver/sdk_tools.json", "{\"schema_version\":2,\"tools\":[]}");
    sdk_report_init(&rep);
    CHECK(!sdk_registry_load(p("badver/sdk_tools.json"), &reg, &rep), "версия 2 не принята");
    CHECK(has_code(&rep, "SDK_REGISTRY_SCHEMA_VERSION"), "код версии схемы");
    CHECK(report_is_json(&rep), "диагностика версии — JSON");
    sdk_registry_free(&reg);
    sdk_report_free(&rep);

    // Некорректные записи остаются в списке с valid=false.
    put("bad/sdk_tools.json",
        "{\"schema_version\":1,\"tools\":["
        "{\"id\":\"ok-tool\",\"name\":\"A\",\"description\":\"d\",\"last_updated\":\"2026-10-08T17:00:00Z\",\"entry\":\"a\"},"
        "{\"id\":\"BAD ID\",\"name\":\"B\",\"description\":\"d\",\"last_updated\":\"2026-10-08T17:00:00Z\",\"entry\":\"b\"},"
        "{\"id\":\"no-date\",\"name\":\"C\",\"description\":\"d\",\"last_updated\":\"вчера\",\"entry\":\"c\"},"
        "{\"id\":\"ok-tool\",\"name\":\"D\",\"description\":\"d\",\"last_updated\":\"2026-10-08T17:00:00Z\",\"entry\":\"d\"},"
        "{\"id\":\"no-entry\",\"name\":\"E\",\"description\":\"d\",\"last_updated\":\"2026-10-08T17:00:00Z\"},"
        "{\"id\":\"esc\",\"name\":\"F\",\"description\":\"d\",\"last_updated\":\"2026-10-08T17:00:00Z\",\"entry\":\"f\",\"binary\":\"../x\"},"
        "5]}");
    sdk_report_init(&rep);
    CHECK(sdk_registry_load(p("bad/sdk_tools.json"), &reg, &rep), "плохой реестр читается");
    CHECK(reg.count == 7, "все 7 записей в списке (ничего не пропущено)");
    CHECK(reg.tools[0].valid, "первая запись валидна");
    CHECK(!reg.tools[1].valid, "BAD ID невалидна");
    CHECK(!reg.tools[2].valid, "нет даты — невалидна");
    CHECK(!reg.tools[3].valid, "дубликат id невалиден");
    CHECK(!reg.tools[4].valid, "нет entry — невалидна");
    CHECK(!reg.tools[5].valid, "binary с .. — невалидна");
    CHECK(!reg.tools[6].valid, "не объект — невалидна");
    CHECK(has_code(&rep, "SDK_REGISTRY_ID"), "код id");
    CHECK(has_code(&rep, "SDK_REGISTRY_DATE"), "код даты");
    CHECK(has_code(&rep, "SDK_REGISTRY_DUPLICATE_ID"), "код дубликата");
    CHECK(has_code(&rep, "SDK_REGISTRY_FIELD"), "код поля");
    CHECK(has_code(&rep, "SDK_REGISTRY_BINARY_PATH"), "код binary");
    CHECK(has_code(&rep, "SDK_REGISTRY_ENTRY"), "код записи");
    CHECK(report_is_json(&rep), "диагностика плохого реестра — JSON");
    sdk_registry_free(&reg);
    sdk_report_free(&rep);

    // Битый JSON.
    put("broken/sdk_tools.json", "{\"schema_version\":1,");
    sdk_report_init(&rep);
    CHECK(!sdk_registry_load(p("broken/sdk_tools.json"), &reg, &rep), "битый JSON отклонён");
    CHECK(has_code(&rep, "SDK_JSON_PARSE"), "код разбора JSON");
    sdk_registry_free(&reg);
    sdk_report_free(&rep);

    // Нет файла.
    sdk_report_init(&rep);
    CHECK(!sdk_registry_load(p("nope/sdk_tools.json"), &reg, &rep), "нет файла");
    CHECK(has_code(&rep, "SDK_FILE_NOT_FOUND"), "код отсутствия файла");
    sdk_registry_free(&reg);
    sdk_report_free(&rep);
}

static void test_assets(void)
{
    put("proj/project.json", "{\"title\":\"T\",\"width\":640,\"height\":360}");
    put("proj/main.js", "// x");
    put("proj/assets/hero.character.json", "{}");
    put("proj/assets/b.png", "x");
    put("proj/assets/a.png", "x");
    put("proj/ui/menu.rml", "<rml/>");
    put("proj/.git/config", "x");
    put("proj/build/skip.png", "x");
    put("proj/sdk_tools.json",
        "{\"schema_version\":1,\"tools\":[{\"id\":\"sprite-studio\",\"name\":\"S\",\"description\":\"d\","
        "\"last_updated\":\"2026-10-08T17:00:00Z\",\"entry\":\"sprite\",\"assets\":[\"*.character.json\"]}]}");

    SdkReport rep;
    sdk_report_init(&rep);
    SdkRegistry reg;
    CHECK(sdk_registry_load(p("proj/sdk_tools.json"), &reg, &rep), "реестр проекта");
    SdkAssets assets;
    CHECK(sdk_assets_scan(p("proj"), &reg, &assets, &rep), "скан ассетов");
    bool sorted = true, git = false, built = false, tool_ok = false;
    for (int i = 0; i < assets.count; ++i) {
        if (i && strcmp(assets.items[i - 1].path, assets.items[i].path) > 0) sorted = false;
        if (strstr(assets.items[i].path, ".git")) git = true;
        if (strstr(assets.items[i].path, "build/")) built = true;
        if (strcmp(assets.items[i].path, "assets/hero.character.json") == 0)
            tool_ok = strcmp(assets.items[i].tool, "sprite-studio") == 0;
    }
    CHECK(assets.count == 7, "7 файлов (без .git и build)");
    CHECK(sorted, "список отсортирован");
    CHECK(!git && !built, "служебные каталоги пропущены");
    CHECK(tool_ok, "character.json → sprite-studio");
    sdk_assets_free(&assets);
    sdk_registry_free(&reg);
    CHECK(!sdk_assets_scan(p("proj_missing"), NULL, &assets, &rep), "нет каталога");
    CHECK(has_code(&rep, "SDK_PROJECT_NOT_FOUND"), "код отсутствия проекта");
    sdk_report_free(&rep);
}

static void test_validate(void)
{
    SdkReport rep;
    put("val/project.json", "{\"title\":\"T\",\"width\":-5}");
    sdk_report_init(&rep);
    const char *type = sdk_validate_file(p("val/project.json"), NULL, &rep);
    CHECK(strcmp(type, "project") == 0, "тип project");
    CHECK(has_code(&rep, "SDK_PROJECT_FIELD"), "width < 1");
    CHECK(has_code(&rep, "SDK_PROJECT_NO_MAIN"), "нет main.js");
    CHECK(rep.errors == 1 && rep.warnings == 1, "1 ошибка и 1 предупреждение");
    sdk_report_free(&rep);

    put("val/x.json", "{\"a\":");
    sdk_report_init(&rep);
    sdk_validate_file(p("val/x.json"), NULL, &rep);
    CHECK(has_code(&rep, "SDK_JSON_PARSE"), "битый json");
    sdk_report_free(&rep);

    sdk_report_init(&rep);
    sdk_validate_file(p("val/data.csv"), NULL, &rep);
    CHECK(has_code(&rep, "SDK_FILE_NOT_FOUND"), "нет файла");
    sdk_report_free(&rep);

    put("val/blob.bin", "x");
    sdk_report_init(&rep);
    sdk_validate_file(p("val/blob.bin"), NULL, &rep);
    CHECK(has_code(&rep, "SDK_NO_VALIDATOR") && rep.errors == 0, "нет проверки — info, не ошибка");
    sdk_report_free(&rep);
}

// Записывает PNG w×h и возвращает путь.
static const char *put_png(const char *rel, int w, int h)
{
    uint8_t *px = (uint8_t *)calloc((size_t)w * h, 4);
    for (int i = 0; i < w * h; ++i) { px[i * 4] = (uint8_t)(i * 7); px[i * 4 + 3] = 255; }
    const char *path = p(rel);
    char dir[1024];
    sdk_dirname(path, dir, sizeof dir);
    SDL_CreateDirectory(dir);
    sdk_image_write_png(path, px, w, h);
    free(px);
    return path;
}

static void test_image(void)
{
    const char *png = put_png("img/a.png", 64, 32);
    int w = 0, h = 0;
    CHECK(sdk_image_info(png, &w, &h) && w == 64 && h == 32, "PNG: размер читается без декодировки");
    uint8_t *px = sdk_image_load_rgba(png, &w, &h);
    CHECK(px && w == 64 && h == 32 && px[3] == 255 && px[4] == 7, "PNG: RGBA загружен");
    sdk_image_free(px);
    CHECK(!sdk_image_info(p("img/none.png"), &w, &h), "нет файла картинки");
    put("img/bad.png", "это не PNG");
    CHECK(!sdk_image_info(p("img/bad.png"), &w, &h), "битый PNG отвергнут");
}

static void atlas_codes(const char *rel, const char *text, const char *const *want, int nwant, const char *msg)
{
    put(rel, text);
    SdkReport rep;
    sdk_report_init(&rep);
    sdk_validate_atlas(p(rel), &rep);
    for (int i = 0; i < nwant; ++i) {
        if (!has_code(&rep, want[i])) {
            ++g_fail;
            printf("  FAIL %s: нет кода %s в %s (%s:%d)\n", msg, want[i], rep.items.data ? rep.items.data : "", __FILE__, __LINE__);
        } else {
            ++g_ok;
        }
    }
    CHECK(report_is_json(&rep), "диагностика атласа — JSON");
    sdk_report_free(&rep);
}

static void test_atlas(void)
{
    put_png("atl/hero.png", 64, 32);
    // Корректный атлас.
    SdkReport rep;
    put("atl/ok.atlas.json",
        "{\"meta\":{\"image\":\"hero.png\",\"size\":{\"w\":64,\"h\":32},"
        "\"frameTags\":[{\"name\":\"idle\",\"from\":0,\"to\":1,\"direction\":\"forward\",\"loop\":true}],"
        "\"slices\":[{\"name\":\"a\",\"keys\":[{\"frame\":0,\"bounds\":{\"x\":0,\"y\":0,\"w\":32,\"h\":32},\"pivot\":{\"x\":16,\"y\":31}}]}]},"
        "\"frames\":{\"a\":{\"frame\":{\"x\":0,\"y\":0,\"w\":32,\"h\":32},\"duration\":100},"
        "\"b\":{\"frame\":{\"x\":32,\"y\":0,\"w\":32,\"h\":32},\"duration\":100}}}");
    sdk_report_init(&rep);
    sdk_validate_atlas(p("atl/ok.atlas.json"), &rep);
    CHECK(rep.count == 0, "корректный атлас: ноль диагностик");
    sdk_report_free(&rep);

    // Канонический вид: идемпотентен, один кадр на строку, пивот сохранён.
    SdkReport r2;
    sdk_report_init(&r2);
    R2dJson *root = sdk_load_json(p("atl/ok.atlas.json"), &r2);
    char *text = sdk_atlas_canonical(root, &r2, "x");
    CHECK(text && strstr(text, "\"a\": {\"frame\": {\"x\": 0, \"y\": 0, \"w\": 32, \"h\": 32}, \"duration\": 100},"), "канонический вид: кадр в одну строку");
    CHECK(text && strstr(text, "{\"name\": \"idle\", \"from\": 0, \"to\": 1, \"direction\": \"forward\", \"loop\": true}"), "канонический вид: тег в одну строку");
    char err[128];
    R2dJson *again = text ? r2d_json_parse(text, err, sizeof err) : NULL;
    char *text2 = again ? sdk_atlas_canonical(again, &r2, "x") : NULL;
    CHECK(text && text2 && strcmp(text, text2) == 0, "канонический вид идемпотентен");
    free(text); free(text2);
    r2d_json_free(root); r2d_json_free(again);
    sdk_report_free(&r2);

    // TexturePacker-массив не переписывается молча.
    put("atl/arr.atlas.json", "{\"frames\":[{\"filename\":\"a\",\"frame\":{\"x\":0,\"y\":0,\"w\":8,\"h\":8}}]}");
    sdk_report_init(&r2);
    root = sdk_load_json(p("atl/arr.atlas.json"), &r2);
    text = sdk_atlas_canonical(root, &r2, "x");
    CHECK(!text && has_code(&r2, "SDK_ATLAS_FORMAT_UNSUPPORTED"), "массивный вид: SDK_ATLAS_FORMAT_UNSUPPORTED");
    r2d_json_free(root);
    sdk_report_free(&r2);

    // Ошибки.
    const char *c1[] = { "SDK_ATLAS_FRAME_BOUNDS", "SDK_ATLAS_FRAME_RECT" };
    atlas_codes("atl/e1.atlas.json",
        "{\"meta\":{\"image\":\"hero.png\"},\"frames\":{\"far\":{\"frame\":{\"x\":60,\"y\":0,\"w\":32,\"h\":32}},"
        "\"zero\":{\"frame\":{\"x\":0,\"y\":0,\"w\":0,\"h\":4}}}}", c1, 2, "границы и размер");
    const char *c2[] = { "SDK_ATLAS_IMAGE_MISSING" };
    atlas_codes("atl/e2.atlas.json", "{\"meta\":{\"image\":\"net.png\"},\"frames\":{\"a\":{\"frame\":{\"x\":0,\"y\":0,\"w\":4,\"h\":4}}}}", c2, 1, "нет картинки");
    const char *c3[] = { "SDK_ATLAS_TAG_RANGE", "SDK_ATLAS_TAG_DUPLICATE", "SDK_ATLAS_TAG", "SDK_ATLAS_TAG_PINGPONG" };
    atlas_codes("atl/e3.atlas.json",
        "{\"meta\":{\"image\":\"hero.png\",\"frameTags\":["
        "{\"name\":\"x\",\"from\":0,\"to\":9},{\"name\":\"x\",\"from\":0,\"to\":0},"
        "{\"name\":\"d\",\"from\":0,\"to\":0,\"direction\":\"sideways\"},"
        "{\"name\":\"p\",\"from\":0,\"to\":0,\"direction\":\"pingpong\"}]},"
        "\"frames\":{\"a\":{\"frame\":{\"x\":0,\"y\":0,\"w\":4,\"h\":4}}}}", c3, 4, "теги");
    const char *c4[] = { "SDK_ATLAS_DURATION", "SDK_ATLAS_ROTATED", "SDK_ATLAS_FRAME_FRACTIONAL" };
    atlas_codes("atl/e4.atlas.json",
        "{\"meta\":{\"image\":\"hero.png\"},\"frames\":{"
        "\"a\":{\"frame\":{\"x\":0,\"y\":0,\"w\":4,\"h\":4},\"duration\":-5},"
        "\"b\":{\"frame\":{\"x\":0.5,\"y\":0,\"w\":4,\"h\":4},\"rotated\":true}}}", c4, 3, "длительность и поворот");
    const char *c5[] = { "SDK_ATLAS_SLICE", "SDK_ATLAS_SIZE_MISMATCH" };
    atlas_codes("atl/e5.atlas.json",
        "{\"meta\":{\"image\":\"hero.png\",\"size\":{\"w\":99,\"h\":99},\"slices\":[{\"name\":\"s\",\"keys\":[{\"frame\":0,\"bounds\":{\"x\":0,\"y\":0,\"w\":0,\"h\":4}}]}]},"
        "\"frames\":{\"a\":{\"frame\":{\"x\":0,\"y\":0,\"w\":4,\"h\":4}}}}", c5, 2, "слайсы и размер");
    const char *c6[] = { "SDK_ATLAS_FRAMES" };
    atlas_codes("atl/e6.atlas.json", "{\"meta\":{\"image\":\"hero.png\"},\"frames\":{}}", c6, 1, "пустой атлас");
    const char *c7[] = { "SDK_ATLAS_TAG_FRAME" };
    atlas_codes("atl/e7.atlas.json",
        "{\"image\":\"hero.png\",\"frames\":{\"a\":{\"x\":0,\"y\":0,\"w\":4,\"h\":4}},\"tags\":{\"idle\":[\"a\",\"zzz\"]}}", c7, 1, "простые теги");
}

static void test_args(void)
{
    const char *argv[] = { "dir", "--registry", "r.json", "--headless", "second" };
    SdkArgs a = { 5, argv };
    CHECK(strcmp(sdk_arg_positional(&a, 0), "dir") == 0, "позиционный 0");
    CHECK(strcmp(sdk_arg_positional(&a, 1), "second") == 0, "значение флага пропущено");
    CHECK(sdk_arg_positional(&a, 2) == NULL, "позиционный 2 нет");
    CHECK(strcmp(sdk_arg_value(&a, "--registry"), "r.json") == 0, "значение флага");
    CHECK(sdk_arg_flag(&a, "--headless"), "булев флаг");
    CHECK(!sdk_arg_flag(&a, "--agent"), "нет флага");
}

int main(void)
{
    const char *base = SDL_getenv("TMPDIR");
    snprintf(g_tmp, sizeof g_tmp, "%s/r2d_sdk_core_test_%d", base && base[0] ? base : "/tmp", (int)SDL_GetCurrentThreadID() % 1000);
    SDL_CreateDirectory(g_tmp);

    test_glob();
    test_iso();
    test_types();
    test_registry();
    test_assets();
    test_validate();
    test_image();
    test_atlas();
    test_args();

    SDL_RemovePath(g_tmp);
    printf("sdk_core_test: ok %d, FAIL %d\n", g_ok, g_fail);
    return g_fail ? 1 : 0;
}
