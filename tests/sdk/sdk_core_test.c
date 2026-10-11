// ===========================================================================
// Тесты нативного бэкенда SDK без окна и GPU: диагностика, glob, ISO 8601,
// реестр sdk_tools.json, типы и сканирование ассетов, валидация.
// Собирается с ASan/UBSan (см. sdk/native/CMakeLists.txt).
// ===========================================================================
#include "sdk.h"
#include "sdk_re2d3.h"

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

// ---------------------------------------------------------------------------
// Re2DSprite v3: контейнер (docs/RE2DSPRITE_V3.md) — чтение, статистика,
// правка сетки и запись. Контейнер собирается здесь же: 3 колонки × 2 ряда
// слоёв, строка 0 — заголовок, alpha слоя позиции 255 — тексель существует.
// ---------------------------------------------------------------------------
static void enc_v3(float v, uint8_t *hi, uint8_t *lo)
{
    float q = (v + 128.0f) * 256.0f;
    if (q < 0) q = 0;
    if (q > 65535.0f) q = 65535.0f;
    const uint16_t u = (uint16_t)(q + 0.5f);
    *hi = (uint8_t)(u >> 8);
    *lo = (uint8_t)u;
}

// `live_mode`: 0 — ни одного живого текселя, 1 — все живые, 2 — все, кроме
// одного (проверка «мёртвый тексель внутри живой области»), 3 — все живые, но у
// одного текселя нулевые веса.
// `layers` — число слоёв в контейнере (6 — формат правки).
static const char *put_v3_layers(const char *rel, int W, int H, int extent, int live_mode, int layers)
{
    const int cols = 3;
    const int PW = W * cols, PH = 1 + ((layers + cols - 1) / cols) * H;
    uint8_t *px = (uint8_t *)calloc((size_t)PW * PH * 4, 1);
    const uint8_t head[7][4] = { { 82, 50, 68, 255 }, { 82, 79, 84, 255 }, { 3, 0, 0, 255 },
                                 { (uint8_t)(W >> 8), (uint8_t)W, (uint8_t)(H >> 8), (uint8_t)H },
                                 { cols, (uint8_t)layers, 0, 0 }, { (uint8_t)(extent >> 8), (uint8_t)extent, 0, 0 }, { 0, 0, 0, 0 } };
    memcpy(px, head, sizeof head);
    for (int y = 0; y < H; ++y) {
        for (int x = 0; x < W; ++x) {
            const bool live = live_mode == 1 || live_mode == 3 || (live_mode == 2 && !(x == 1 && y == 1));
            uint8_t *l[6];
            for (int k = 0; k < 6; ++k) l[k] = px + ((size_t)(1 + (k / cols) * H + y) * PW + (size_t)(k % cols) * W + x) * 4;
            if (!live) continue;
            l[0][0] = (uint8_t)(x * 3); l[0][1] = (uint8_t)(y * 3); l[0][2] = 64; l[0][3] = 255;
            enc_v3((float)x - 32.0f, &l[1][0], &l[2][0]);
            enc_v3((float)y - 32.0f, &l[1][1], &l[2][1]);
            enc_v3(4.0f, &l[1][2], &l[2][2]);
            l[1][3] = 255; l[2][3] = 255;
            l[3][0] = 128; l[3][1] = 128; l[3][2] = 255; l[3][3] = 90;   // нормаль «в зрителя», блеск 90
            l[4][0] = 1; l[4][1] = 0; l[4][2] = 0; l[4][3] = 0;          // кость id 2
            if (live_mode == 3 && x == 5 && y == 5) continue;           // нулевые веса у одного текселя
            l[5][0] = 255; l[5][1] = 0; l[5][2] = 0; l[5][3] = 0;
        }
    }
    const char *path = p(rel);
    char dir[1024];
    sdk_dirname(path, dir, sizeof dir);
    SDL_CreateDirectory(dir);
    sdk_image_write_png(path, px, PW, PH);
    free(px);
    return path;
}

static const char *put_v3(const char *rel, int W, int H, int extent, int live_mode)
{
    return put_v3_layers(rel, W, H, extent, live_mode, 6);
}

static void test_re2d3(void)
{
    const char *path = put_v3("v3/hero.png", 64, 64, 128, 2);
    Re2d3Png png;
    memset(&png, 0, sizeof png);
    CHECK(re2d_container_version(path, &png) == 3, "контейнер v3 опознан по заголовку в пикселях");
    CHECK(png.header_ok && png.size_ok && png.editable, "заголовок, размер и шесть слоёв");
    CHECK(png.tw == 64 && png.th == 64 && png.cols == 3 && png.layers == 6 && png.extent == 128, "поля заголовка прочитаны");
    CHECK(png.w == 192 && png.h == 129, "размер PNG: 3 колонки × 2 ряда слоёв");

    Re2d3Sample s;
    re2d3_sample(&png, 10, 20, &s);
    CHECK(s.live && s.px == -22.0f && s.py == -12.0f && s.pz == 4.0f, "позиция из 16-битных слоёв");
    CHECK(s.rgba[0] == 30 && s.rgba[1] == 60 && s.rgba[3] == 255, "цвет слоя 0");
    CHECK(s.gloss == 90 && s.bones[0] == 2 && s.weights[0] == 255, "блеск, id кости и вес текселя");
    re2d3_sample(&png, 1, 1, &s);
    CHECK(!s.live, "мёртвый тексель отличим от живого");

    Re2d3Stats st;
    re2d3_stats(&png, &st);
    CHECK(st.live == 64 * 64 - 1 && st.slots == 64 * 64, "живых текселей на один меньше сетки");
    CHECK(st.bones_used == 1 && st.bone_texels[2] == st.live, "кость 2 владеет всеми живыми текселями");
    CHECK(st.bad_weights == 0 && st.zero_weights == 0, "веса в норме");
    CHECK(st.gloss_min == 90 && st.gloss_max == 90, "блеск прочитан");
    CHECK(st.pos_min[0] == -32.0f && st.pos_max[0] == 31.0f, "диапазон позиции по X");
    CHECK(st.isolated == 0, "изолированных текселей нет");

    // Правка сетки: кость, блеск, цвет — только по живым текселям.
    const int bone7[4] = { 7, 0, 0, 0 }, weight255[4] = { 255, 0, 0, 0 };
    const int bone9[4] = { 9, 0, 0, 0 };
    const uint8_t red[3] = { 255, 0, 0 };
    CHECK(re2d3_paint_bone(&png, 8, 8, 4, 4, bone7, weight255) == 16, "кость покрашена в 16 текселях");
    CHECK(re2d3_paint_gloss(&png, 8, 8, 4, 4, 200) == 16, "блеск задан");
    CHECK(re2d3_paint_color(&png, 8, 8, 2, 2, red) == 4, "цвет задан");
    CHECK(re2d3_paint_bone(&png, 1, 1, 1, 1, bone9, weight255) == 0, "мёртвый тексель не красится");
    // Клетка (1,1) мертва, поэтому живых в обрезанном прямоугольнике 15 из 16.
    CHECK(re2d3_paint_gloss(&png, -4, -4, 8, 8, 10) == 15, "прямоугольник обрезан по границе сетки, мёртвый тексель пропущен");
    re2d3_sample(&png, 9, 9, &s);
    CHECK(s.bones[0] == 7 && s.gloss == 200 && s.rgba[0] == 255, "правка видна в отсчёте");

    // Четыре кости с неравными долями: сумма весов ровно 255, ни один вес не
    // «заворачивается» в 255 из-за отрицательного довеска (метод наибольших
    // остатков). Набор {1,253,253,3} раньше давал сумму 511.
    const int bone_mix[4] = { 1, 2, 3, 4 }, weight_mix[4] = { 1, 253, 253, 3 };
    CHECK(re2d3_paint_bone(&png, 20, 20, 2, 2, bone_mix, weight_mix) == 4, "четыре кости покрашены");
    re2d3_sample(&png, 20, 20, &s);
    {
        const int sum = s.weights[0] + s.weights[1] + s.weights[2] + s.weights[3];
        int worst = 0;
        for (int q = 0; q < 4; ++q) if (s.weights[q] > worst) worst = s.weights[q];
        CHECK(sum == 255 && worst <= 255, "сумма весов ровно 255 после нормировки");
        CHECK(s.weights[0] > 0 && s.weights[0] < 10 && s.weights[3] > 0 && s.weights[3] < 10,
              "мелкие доли остались мелкими, а не 255");
        CHECK(s.weights[1] > s.weights[0] && s.weights[2] > s.weights[3], "доминирование долей сохранено");
    }

    const char *out = p("v3/hero_painted.png");
    CHECK(re2d3_write(&png, out), "контейнер записан");
    re2d3_close(&png);

    Re2d3Png again;
    memset(&again, 0, sizeof again);
    CHECK(re2d_container_version(out, &again) == 3, "записанный файл — контейнер v3");
    CHECK(again.tw == 64 && again.th == 64 && again.extent == 128, "заголовок сохранён как был");
    re2d3_sample(&again, 9, 9, &s);
    CHECK(s.bones[0] == 7 && s.weights[0] == 255 && s.gloss == 200 && s.rgba[0] == 255, "правка пережила запись и чтение");
    re2d3_close(&again);

    // Отладочный вид: сетка × масштаб, без выхода за пределы изображения.
    Re2d3Png view;
    memset(&view, 0, sizeof view);
    re2d_container_version(path, &view);
    int vw = 0, vh = 0;
    uint8_t *img = re2d3_debug_image(&view, RE2D3_MODE_OWNER, 2, &vw, &vh);
    CHECK(img && vw == 128 && vh == 128, "вид «кость» — сетка × масштаб");
    free(img);
    img = re2d3_debug_image(&view, RE2D3_MODE_COVERAGE, 1, &vw, &vh);
    CHECK(img && vw == 64 && vh == 64 && img[(1 * 64 + 1) * 4] == 48, "вид «покрытие» различает мёртвый тексель");
    free(img);
    CHECK(re2d3_debug_image(&view, RE2D3_MODE_OWNER, 99, &vw, &vh) == NULL, "масштаб вне 1..16 отвергнут");
    CHECK(re2d3_mode_from_name("gloss") == RE2D3_MODE_GLOSS && re2d3_mode_from_name("part") < 0, "имена режимов v3");

    SdkReport rep;
    sdk_report_init(&rep);
    re2d3_stats(&view, &st);
    re2d3_validate_png(path, &view, &st, &rep);
    CHECK(rep.errors == 0 && !has_code(&rep, "SDK_RE2D3_EMPTY"), "валидный контейнер без ошибок");
    CHECK(report_is_json(&rep), "диагностика контейнера — JSON");
    sdk_report_free(&rep);
    re2d3_close(&view);

    // Пустой контейнер: ни одного живого текселя.
    const char *empty = put_v3("v3/empty.png", 64, 64, 128, 0);
    Re2d3Png p3;
    memset(&p3, 0, sizeof p3);
    CHECK(re2d_container_version(empty, &p3) == 3, "пустой контейнер всё ещё контейнер v3");
    re2d3_stats(&p3, &st);
    sdk_report_init(&rep);
    re2d3_validate_png(empty, &p3, &st, &rep);
    CHECK(has_code(&rep, "SDK_RE2D3_EMPTY"), "пустая сетка — ошибка SDK_RE2D3_EMPTY");
    sdk_report_free(&rep);
    re2d3_close(&p3);

    // Нулевые веса: факт данных, а не подставленная кость. Рантайм подставляет
    // кость 1 сам (src/rotsprite3.c), SDK обязан показать то, что лежит в файле.
    const char *zero = put_v3("v3/zero.png", 64, 64, 128, 3);
    Re2d3Png pz;
    memset(&pz, 0, sizeof pz);
    CHECK(re2d_container_version(zero, &pz) == 3, "контейнер с нулевым весом читается");
    re2d3_sample(&pz, 5, 5, &s);
    CHECK(s.live && s.weights[0] + s.weights[1] + s.weights[2] + s.weights[3] == 0,
          "нулевые веса не подменяются в отсчёте");
    re2d3_stats(&pz, &st);
    CHECK(st.zero_weights == 1 && st.bone_texels[2] + st.bone_texels[1] == st.live - 1,
          "статистика считает нулевой вес и не приписывает фантомную кость");
    sdk_report_init(&rep);
    re2d3_validate_png(zero, &pz, &st, &rep);
    CHECK(has_code(&rep, "SDK_RE2D3_WEIGHT_ZERO") && rep.errors == 0,
          "нулевой вес — информация, а не ошибка: контейнер читается");
    sdk_report_free(&rep);
    re2d3_close(&pz);

    // Контейнер с другим числом слоёв читается, но править его нельзя: формат
    // правки рассчитан ровно на шесть слоёв. Размер при этом верный, поэтому
    // диагностика — про слои, а не про «размеры не совпадают».
    {
        const char *seven_path = put_v3_layers("v3/seven.png", 64, 64, 128, 1, 7);
        Re2d3Png seven;
        memset(&seven, 0, sizeof seven);
        CHECK(re2d_container_version(seven_path, &seven) == 3, "семь слоёв читаются");
        CHECK(seven.size_ok && seven.header_ok && !seven.editable, "размер верный, правка недоступна");
        re2d3_stats(&seven, &st);
        sdk_report_init(&rep);
        re2d3_validate_png(seven_path, &seven, &st, &rep);
        CHECK(has_code(&rep, "SDK_RE2D3_LAYERS") && !has_code(&rep, "SDK_RE2D3_SIZE"),
              "лишние слои — отдельная диагностика SDK_RE2D3_LAYERS, а не ошибка размера");
        sdk_report_free(&rep);
        re2d3_close(&seven);
    }

    // Обычная квадратная PNG v2 — это не контейнер v3.
    const char *square = put_png("v3/square.png", 64, 64);
    Re2d3Png not3;
    memset(&not3, 0, sizeof not3);
    CHECK(re2d_container_version(square, &not3) == 2, "квадратная PNG не считается контейнером v3");
    CHECK(not3.px == NULL, "не-v3 контейнер закрыт сразу");
    CHECK(re2d_container_version(p("v3/none.png"), &not3) == 0, "отсутствующий файл — 0");
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
    test_re2d3();
    test_args();

    SDL_RemovePath(g_tmp);
    printf("sdk_core_test: ok %d, FAIL %d\n", g_ok, g_fail);
    return g_fail ? 1 : 0;
}
