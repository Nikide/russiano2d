// ===========================================================================
// Тест native-операций world-edit (sdk/native/sdk_world_edit.c).
//
// Тест дергает ту же C-команду, что CLI/GUI/агент, и проверяет файл после
// операции: JSON-дерево, unknown-поля, каноническую запись и транзакционность.
// stdout команды глушится, чтобы JSON-ответы не мешали выводу Unity.
// ===========================================================================
#include "sdk.h"
#include "unity.h"

#include <SDL3/SDL.h>

#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(_WIN32)
#include <io.h>
#define R2D_TEST_DUP _dup
#define R2D_TEST_DUP2 _dup2
#define R2D_TEST_CLOSE _close
#define R2D_TEST_OPEN _open
#define R2D_TEST_NULL "NUL"
#else
#include <unistd.h>
#define R2D_TEST_DUP dup
#define R2D_TEST_DUP2 dup2
#define R2D_TEST_CLOSE close
#define R2D_TEST_OPEN open
#define R2D_TEST_NULL "/dev/null"
#endif

static char g_dir[1024];

void setUp(void) {}
void tearDown(void) {}

static const char *const BASE_MAP =
    "{\n"
    "  \"version\": 1,\n"
    "  \"name\": \"world-edit fixture\",\n"
    "  \"regionSize\": 128,\n"
    "  \"customRoot\": {\"keep\": true, \"n\": [1, 2, 3]},\n"
    "  \"world\": {\n"
    "    \"x\": 0, \"y\": 0, \"w\": 512, \"h\": 512,\n"
    "    \"bottom\": 0, \"top\": 256,\n"
    "    \"floorColor\": \"#9a9a9a\",\n"
    "    \"ceilingColor\": \"#6a7078\",\n"
    "    \"sideColor\": \"#8f7a58\",\n"
    "    \"boundary\": \"sky\"\n"
    "  },\n"
    "  \"brushes\": [\n"
    "    {\"id\": \"box.a\", \"rect\": [0, 0, 64, 64], \"bottom\": 0, \"top\": 64,\n"
    "     \"customBrush\": 7, \"sideColor\": \"#112233\"},\n"
    "    {\"id\": \"poly.a\", \"polygon\": [[100,0],[200,0],[200,100],[100,100]],\n"
    "     \"bottom\": 0, \"top\": 64}\n"
    "  ],\n"
    "  \"entities\": [\n"
    "    {\"id\": \"player.start\", \"kind\": \"player_spawn\", \"x\": 16, \"y\": 16,\n"
    "     \"h\": 0, \"customEntity\": \"keep\"}\n"
    "  ]\n"
    "}\n";

static void map_path(const char *name, char *out, size_t cap)
{
    snprintf(out, cap, "%s/%s", g_dir, name);
}

static void make_map(const char *name, char *out, size_t cap)
{
    map_path(name, out, cap);
    TEST_ASSERT_TRUE_MESSAGE(sdk_write_file(out, BASE_MAP, strlen(BASE_MAP)),
                             "запись исходной карты");
}

static int run_edit(const char *file, const char *op, const char *args,
                    const char *out_path)
{
    const char *argv[9];
    int argc = 0;
    argv[argc++] = file;
    argv[argc++] = "--op";
    argv[argc++] = op;
    if (args) {
        argv[argc++] = "--args";
        argv[argc++] = args;
    }
    if (out_path) {
        argv[argc++] = "--out";
        argv[argc++] = out_path;
    }
    fflush(stdout);
    const int saved = R2D_TEST_DUP(1);
    const int null_fd = R2D_TEST_OPEN(R2D_TEST_NULL, O_WRONLY);
    if (null_fd >= 0) {
        R2D_TEST_DUP2(null_fd, 1);
        R2D_TEST_CLOSE(null_fd);
    }
    SdkArgs a = {argc, argv};
    const int rc = sdk_cmd_world_edit(&a);
    fflush(stdout);
    if (saved >= 0) {
        R2D_TEST_DUP2(saved, 1);
        R2D_TEST_CLOSE(saved);
    }
    return rc;
}

static R2dJson *load_map(const char *path)
{
    char *text = sdk_read_file(path, NULL);
    if (!text) return NULL;
    char error[256];
    R2dJson *root = r2d_json_parse(text, error, sizeof error);
    free(text);
    return root;
}

static const R2dJson *find_obj(const R2dJson *arr, const char *id)
{
    if (!arr || arr->type != R2D_JSON_ARR) return NULL;
    for (int i = 0; i < arr->count; ++i) {
        const R2dJson *obj = arr->items[i];
        if (!obj || obj->type != R2D_JSON_OBJ) continue;
        const char *value = r2d_json_str(r2d_json_get(obj, "id"), NULL);
        if (value && strcmp(value, id) == 0) return obj;
    }
    return NULL;
}

static float field_number(const R2dJson *obj, const char *key, float fallback)
{
    const R2dJson *v = r2d_json_get(obj, key);
    if (!v || v->type != R2D_JSON_NUM) return fallback;
    return (float)v->number;
}

static float array_number(const R2dJson *arr, int index, float fallback)
{
    const R2dJson *v = r2d_json_at(arr, index);
    if (!v || v->type != R2D_JSON_NUM) return fallback;
    return (float)v->number;
}

static bool text_contains(const char *text, const char *needle)
{
    return text && strstr(text, needle) != NULL;
}

// --- brushes ---------------------------------------------------------------

static void test_create_box_and_polygon(void)
{
    char map[1200];
    make_map("create.re2dmap", map, sizeof map);
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "brush.create",
        "{\"rect\":[300,300,32,32],\"bottom\":0,\"top\":64}", map));
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "brush.create",
        "{\"id\":\"poly.b\",\"polygon\":[[300,100],[340,100],[340,140]],"
        "\"bottom\":0,\"top\":32,\"tool\":\"trigger\",\"tags\":[\"metal\"]}", map));
    R2dJson *root = load_map(map);
    TEST_ASSERT_NOT_NULL(root);
    const R2dJson *brushes = r2d_json_get(root, "brushes");
    TEST_ASSERT_EQUAL_INT(4, r2d_json_size(brushes));
    const R2dJson *created = find_obj(brushes, "brush_1");
    TEST_ASSERT_NOT_NULL(created);
    TEST_ASSERT_EQUAL_FLOAT(300.0f, array_number(r2d_json_get(created, "rect"), 0, -1));
    TEST_ASSERT_EQUAL_FLOAT(32.0f, array_number(r2d_json_get(created, "rect"), 3, -1));
    const R2dJson *poly = find_obj(brushes, "poly.b");
    TEST_ASSERT_NOT_NULL(poly);
    TEST_ASSERT_EQUAL_STRING("trigger", r2d_json_str(r2d_json_get(poly, "tool"), ""));
    TEST_ASSERT_EQUAL_INT(3, r2d_json_size(r2d_json_get(poly, "polygon")));
    TEST_ASSERT_NOT_NULL(r2d_json_get(r2d_json_get(root, "customRoot"), "keep"));
    r2d_json_free(root);
}

static void test_move_and_duplicate_keep_unknown_fields(void)
{
    char map[1200];
    make_map("move.re2dmap", map, sizeof map);
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "brush.move", "{\"ids\":[\"box.a\"],\"dx\":10,\"dy\":5,\"dz\":10}", map));
    R2dJson *root = load_map(map);
    const R2dJson *box = find_obj(r2d_json_get(root, "brushes"), "box.a");
    TEST_ASSERT_NOT_NULL(box);
    TEST_ASSERT_EQUAL_FLOAT(10.0f, array_number(r2d_json_get(box, "rect"), 0, -1));
    TEST_ASSERT_EQUAL_FLOAT(5.0f, array_number(r2d_json_get(box, "rect"), 1, -1));
    TEST_ASSERT_EQUAL_FLOAT(10.0f, field_number(box, "bottom", -1));
    TEST_ASSERT_EQUAL_FLOAT(74.0f, field_number(box, "top", -1));
    TEST_ASSERT_EQUAL_FLOAT(7.0f, field_number(box, "customBrush", -1));
    r2d_json_free(root);

    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "brush.duplicate", "{\"ids\":[\"box.a\"],\"dx\":1,\"dy\":2,\"dz\":0}", map));
    root = load_map(map);
    const R2dJson *copy = find_obj(r2d_json_get(root, "brushes"), "box.a-copy");
    TEST_ASSERT_NOT_NULL(copy);
    TEST_ASSERT_EQUAL_FLOAT(11.0f, array_number(r2d_json_get(copy, "rect"), 0, -1));
    TEST_ASSERT_EQUAL_FLOAT(7.0f, array_number(r2d_json_get(copy, "rect"), 1, -1));
    TEST_ASSERT_EQUAL_FLOAT(7.0f, field_number(copy, "customBrush", -1));
    r2d_json_free(root);
}

static void test_set_rect_via_patch_and_alias_id(void)
{
    char map[1200];
    make_map("set.re2dmap", map, sizeof map);
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "brush.set",
        "{\"ids\":[\"box.a\"],\"patch\":{\"rect\":[200,200,48,48],"
        "\"bottom\":10,\"top\":80,\"tags\":[\"stone\"]}}", map));
    R2dJson *root = load_map(map);
    const R2dJson *box = find_obj(r2d_json_get(root, "brushes"), "box.a");
    TEST_ASSERT_NOT_NULL(box);
    TEST_ASSERT_EQUAL_FLOAT(200.0f, array_number(r2d_json_get(box, "rect"), 0, -1));
    TEST_ASSERT_EQUAL_FLOAT(48.0f, array_number(r2d_json_get(box, "rect"), 3, -1));
    TEST_ASSERT_EQUAL_FLOAT(80.0f, field_number(box, "top", -1));
    TEST_ASSERT_EQUAL_INT(1, r2d_json_size(r2d_json_get(box, "tags")));
    TEST_ASSERT_EQUAL_FLOAT(7.0f, field_number(box, "customBrush", -1));
    r2d_json_free(root);

    // алиас: один id вместо ids
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "brush.set",
        "{\"id\":\"poly.a\",\"patch\":{\"rect\":[10,10,20,20]}}", map));
    root = load_map(map);
    const R2dJson *poly = find_obj(r2d_json_get(root, "brushes"), "poly.a");
    TEST_ASSERT_NOT_NULL(poly);
    TEST_ASSERT_NOT_NULL(r2d_json_get(poly, "rect"));
    TEST_ASSERT_NULL(r2d_json_get(poly, "polygon"));
    r2d_json_free(root);
}

static void test_vertex_move_valid_and_concave_rejected(void)
{
    char map[1200], out_map[1200];
    make_map("vertex.re2dmap", map, sizeof map);
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "brush.vertex.move",
        "{\"id\":\"poly.a\",\"vertex\":0,\"x\":90,\"y\":0}", map));
    R2dJson *root = load_map(map);
    const R2dJson *poly = find_obj(r2d_json_get(root, "brushes"), "poly.a");
    TEST_ASSERT_NOT_NULL(poly);
    TEST_ASSERT_EQUAL_FLOAT(90.0f, array_number(
        r2d_json_at(r2d_json_get(poly, "polygon"), 0), 0, -1));
    r2d_json_free(root);

    char *before = sdk_read_file(map, NULL);
    TEST_ASSERT_NOT_NULL(before);
    map_path("vertex_rejected.re2dmap", out_map, sizeof out_map);
    SDL_RemovePath(out_map);
    // вершина внутрь кольца — результат невыпуклый, операция отклонена
    TEST_ASSERT_EQUAL_INT(1, run_edit(
        map, "brush.vertex.move",
        "{\"id\":\"poly.a\",\"vertex\":0,\"x\":250,\"y\":50}", out_map));
    char *after = sdk_read_file(map, NULL);
    TEST_ASSERT_NOT_NULL(after);
    TEST_ASSERT_EQUAL_STRING(before, after);
    TEST_ASSERT_FALSE_MESSAGE(sdk_file_exists(out_map),
                              "отклонённая операция не пишет --out");
    free(before);
    free(after);
}

static void test_clip_both_front_back(void)
{
    char map[1200];
    make_map("clip_both.re2dmap", map, sizeof map);
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "brush.clip",
        "{\"id\":\"box.a\",\"axis\":\"x\",\"coordinate\":32,\"keep\":\"both\"}", map));
    R2dJson *root = load_map(map);
    const R2dJson *brushes = r2d_json_get(root, "brushes");
    TEST_ASSERT_NULL(find_obj(brushes, "box.a"));
    const R2dJson *low = find_obj(brushes, "box.a#a");
    const R2dJson *high = find_obj(brushes, "box.a#b");
    TEST_ASSERT_NOT_NULL(low);
    TEST_ASSERT_NOT_NULL(high);
    TEST_ASSERT_EQUAL_FLOAT(0.0f, array_number(r2d_json_get(low, "rect"), 0, -1));
    TEST_ASSERT_EQUAL_FLOAT(32.0f, array_number(r2d_json_get(low, "rect"), 2, -1));
    TEST_ASSERT_EQUAL_FLOAT(32.0f, array_number(r2d_json_get(high, "rect"), 0, -1));
    TEST_ASSERT_EQUAL_FLOAT(32.0f, array_number(r2d_json_get(high, "rect"), 2, -1));
    r2d_json_free(root);

    make_map("clip_front.re2dmap", map, sizeof map);
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "brush.clip",
        "{\"id\":\"poly.a\",\"axis\":\"y\",\"coord\":50,\"keep\":\"front\"}", map));
    root = load_map(map);
    brushes = r2d_json_get(root, "brushes");
    TEST_ASSERT_NOT_NULL(find_obj(brushes, "poly.a#b"));
    TEST_ASSERT_NULL(find_obj(brushes, "poly.a#a"));
    r2d_json_free(root);

    make_map("clip_back.re2dmap", map, sizeof map);
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "brush.clip",
        "{\"id\":\"poly.a\",\"axis\":\"x\",\"coordinate\":150,\"keep\":\"back\"}", map));
    root = load_map(map);
    brushes = r2d_json_get(root, "brushes");
    TEST_ASSERT_NOT_NULL(find_obj(brushes, "poly.a#a"));
    TEST_ASSERT_NULL(find_obj(brushes, "poly.a#b"));
    r2d_json_free(root);
}

static void test_delete_and_face_set(void)
{
    char map[1200];
    make_map("delete.re2dmap", map, sizeof map);
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "face.set",
        "{\"brush\":\"box.a\",\"face\":\"floor\",\"color\":\"#aabbcc\","
        "\"tags\":[\"wood\"]}", map));
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "face.set",
        "{\"id\":\"box.a\",\"face\":\"side\",\"material\":\"#010203\"}", map));
    R2dJson *root = load_map(map);
    const R2dJson *box = find_obj(r2d_json_get(root, "brushes"), "box.a");
    TEST_ASSERT_NOT_NULL(box);
    TEST_ASSERT_EQUAL_STRING("#aabbcc",
                             r2d_json_str(r2d_json_get(box, "floorColor"), ""));
    TEST_ASSERT_EQUAL_STRING("#010203",
                             r2d_json_str(r2d_json_get(box, "sideColor"), ""));
    TEST_ASSERT_EQUAL_INT(1, r2d_json_size(r2d_json_get(box, "tags")));
    r2d_json_free(root);

    TEST_ASSERT_EQUAL_INT(0, run_edit(map, "brush.delete",
                                      "{\"ids\":[\"box.a\"]}", map));
    root = load_map(map);
    TEST_ASSERT_NULL(find_obj(r2d_json_get(root, "brushes"), "box.a"));
    TEST_ASSERT_NOT_NULL(find_obj(r2d_json_get(root, "brushes"), "poly.a"));
    r2d_json_free(root);
}

// --- world / entities / paths / visgroups ----------------------------------

static void test_world_set_and_validation(void)
{
    char map[1200];
    make_map("world.re2dmap", map, sizeof map);
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "world.set",
        "{\"patch\":{\"w\":600,\"boundary\":\"nodraw\",\"floorColor\":\"#010203\"},"
        "\"h\":700,\"regionSize\":128}", map));
    R2dJson *root = load_map(map);
    const R2dJson *world = r2d_json_get(root, "world");
    TEST_ASSERT_EQUAL_FLOAT(600.0f, field_number(world, "w", -1));
    TEST_ASSERT_EQUAL_FLOAT(700.0f, field_number(world, "h", -1));
    // regionSize — корневое поле карты (не поле world-конверта).
    TEST_ASSERT_EQUAL_FLOAT(128.0f, field_number(root, "regionSize", -1));
    TEST_ASSERT_EQUAL_FLOAT(256.0f, field_number(world, "top", -1));
    TEST_ASSERT_EQUAL_STRING("nodraw", r2d_json_str(r2d_json_get(world, "boundary"), ""));
    TEST_ASSERT_EQUAL_STRING("#010203",
                             r2d_json_str(r2d_json_get(world, "floorColor"), ""));
    r2d_json_free(root);

    char *before = sdk_read_file(map, NULL);
    TEST_ASSERT_EQUAL_INT(1, run_edit(map, "world.set",
                                      "{\"top\":0,\"bottom\":0}", map));
    TEST_ASSERT_EQUAL_INT(1, run_edit(map, "world.set",
                                      "{\"regionSize\":0}", map));
    char *after = sdk_read_file(map, NULL);
    TEST_ASSERT_EQUAL_STRING(before, after);
    free(before);
    free(after);
}

static void test_entity_create_set_delete(void)
{
    char map[1200];
    make_map("entity.re2dmap", map, sizeof map);
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "entity.create",
        "{\"kind\":\"light\",\"x\":10,\"y\":20,\"h\":30,\"id\":\"light.a\","
        "\"angle\":90,\"tags\":[\"warm\"]}", map));
    R2dJson *root = load_map(map);
    const R2dJson *light = find_obj(r2d_json_get(root, "entities"), "light.a");
    TEST_ASSERT_NOT_NULL(light);
    TEST_ASSERT_EQUAL_FLOAT(30.0f, field_number(light, "h", -1));
    TEST_ASSERT_EQUAL_FLOAT(90.0f, field_number(light, "angle", -1));
    TEST_ASSERT_EQUAL_INT(1, r2d_json_size(r2d_json_get(light, "tags")));
    r2d_json_free(root);

    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "entity.set",
        "{\"id\":\"light.a\",\"patch\":{\"x\":11,\"y\":22,\"angle\":45}}", map));
    root = load_map(map);
    light = find_obj(r2d_json_get(root, "entities"), "light.a");
    TEST_ASSERT_NOT_NULL(light);
    TEST_ASSERT_EQUAL_FLOAT(11.0f, field_number(light, "x", -1));
    TEST_ASSERT_EQUAL_FLOAT(45.0f, field_number(light, "angle", -1));
    r2d_json_free(root);

    TEST_ASSERT_EQUAL_INT(0, run_edit(map, "entity.delete",
                                      "{\"ids\":[\"light.a\"]}", map));
    root = load_map(map);
    TEST_ASSERT_NULL(find_obj(r2d_json_get(root, "entities"), "light.a"));
    TEST_ASSERT_NOT_NULL(find_obj(r2d_json_get(root, "entities"), "player.start"));
    r2d_json_free(root);
}

static void test_path_create_node_ops_and_metadata(void)
{
    char map[1200];
    make_map("path.re2dmap", map, sizeof map);
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "path.create",
        "{\"id\":\"p1\",\"type\":\"patrol\",\"nodes\":[{\"x\":1,\"y\":2},"
        "{\"x\":3,\"y\":4,\"h\":8}],\"loop\":true,\"note\":\"n\"}", map));
    R2dJson *root = load_map(map);
    const R2dJson *path = find_obj(r2d_json_get(root, "paths"), "p1");
    TEST_ASSERT_NOT_NULL(path);
    const R2dJson *nodes = r2d_json_get(path, "nodes");
    TEST_ASSERT_EQUAL_INT(2, r2d_json_size(nodes));
    TEST_ASSERT_EQUAL_FLOAT(0.0f, field_number(r2d_json_at(nodes, 0), "h", -1));
    TEST_ASSERT_EQUAL_FLOAT(8.0f, field_number(r2d_json_at(nodes, 1), "h", -1));
    TEST_ASSERT_TRUE(r2d_json_bool(r2d_json_get(path, "loop"), false));
    TEST_ASSERT_EQUAL_STRING("patrol", r2d_json_str(r2d_json_get(path, "type"), ""));
    TEST_ASSERT_EQUAL_STRING("n", r2d_json_str(r2d_json_get(path, "note"), ""));
    r2d_json_free(root);

    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "path.node.add", "{\"id\":\"p1\",\"x\":5,\"y\":6,\"index\":1}", map));
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "path.node.move", "{\"id\":\"p1\",\"index\":1,\"x\":7,\"y\":9}", map));
    root = load_map(map);
    path = find_obj(r2d_json_get(root, "paths"), "p1");
    nodes = r2d_json_get(path, "nodes");
    TEST_ASSERT_EQUAL_INT(3, r2d_json_size(nodes));
    const R2dJson *middle = r2d_json_at(nodes, 1);
    TEST_ASSERT_EQUAL_FLOAT(7.0f, field_number(middle, "x", -1));
    TEST_ASSERT_EQUAL_FLOAT(9.0f, field_number(middle, "y", -1));
    r2d_json_free(root);

    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "path.set",
        "{\"id\":\"p1\",\"fields\":{\"oneWay\":true},\"metadata\":{\"a\":1}}", map));
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "path.node.delete", "{\"id\":\"p1\",\"index\":0}", map));
    root = load_map(map);
    path = find_obj(r2d_json_get(root, "paths"), "p1");
    nodes = r2d_json_get(path, "nodes");
    TEST_ASSERT_EQUAL_INT(2, r2d_json_size(nodes));
    TEST_ASSERT_TRUE(r2d_json_bool(r2d_json_get(path, "oneWay"), false));
    TEST_ASSERT_NOT_NULL(r2d_json_get(path, "metadata"));
    r2d_json_free(root);
}

static void test_visgroup_ensure_state(void)
{
    char map[1200];
    make_map("visgroup.re2dmap", map, sizeof map);
    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "visgroup.ensure", "{\"name\":\"Detail\",\"visible\":false}", map));
    R2dJson *root = load_map(map);
    const R2dJson *group = find_obj(r2d_json_get(root, "visgroups"), "Detail");
    TEST_ASSERT_NOT_NULL(group);
    TEST_ASSERT_FALSE(r2d_json_bool(r2d_json_get(group, "visible"), true));
    r2d_json_free(root);

    TEST_ASSERT_EQUAL_INT(0, run_edit(
        map, "visgroup.state", "{\"id\":\"Detail\",\"hidden\":false}", map));
    root = load_map(map);
    group = find_obj(r2d_json_get(root, "visgroups"), "Detail");
    TEST_ASSERT_TRUE(r2d_json_bool(r2d_json_get(group, "visible"), false));
    r2d_json_free(root);
}

// --- canonical write / round trip ------------------------------------------

static void test_canonical_write_and_reload_round_trip(void)
{
    char map[1200], out1[1200], out2[1200];
    make_map("canonical.re2dmap", map, sizeof map);
    map_path("canonical_1.re2dmap", out1, sizeof out1);
    map_path("canonical_2.re2dmap", out2, sizeof out2);
    TEST_ASSERT_EQUAL_INT(0, run_edit(map, "noop", NULL, out1));
    char *first = sdk_read_file(out1, NULL);
    TEST_ASSERT_NOT_NULL(first);
    TEST_ASSERT_TRUE_MESSAGE(text_contains(first, "{\n  \"version\": 1,"),
                             "канонический отступ 2 пробела");
    TEST_ASSERT_TRUE_MESSAGE(text_contains(first, "\n  \"customRoot\": {"),
                             "неизвестные корневые ключи сохранены");
    const size_t len = strlen(first);
    TEST_ASSERT_TRUE(len > 0 && first[len - 1] == '\n');
    TEST_ASSERT_EQUAL_INT(0, run_edit(out1, "noop", NULL, out2));
    char *second = sdk_read_file(out2, NULL);
    TEST_ASSERT_NOT_NULL(second);
    TEST_ASSERT_EQUAL_STRING(first, second);
    r2d_json_free(load_map(out1));
    free(first);
    free(second);
}

static void test_usage_errors(void)
{
    char map[1200];
    make_map("usage.re2dmap", map, sizeof map);
    TEST_ASSERT_EQUAL_INT(2, run_edit(map, "no.such.op", "{}", map));
    TEST_ASSERT_EQUAL_INT(2, run_edit(map, "brush.create", "{", map));
    TEST_ASSERT_EQUAL_INT(1, run_edit(map, "brush.delete",
                                      "{\"ids\":[\"missing\"]}", map));
}

int main(void)
{
    const char *tmp = SDL_getenv("TMPDIR");
    if (!tmp || !tmp[0]) tmp = "/tmp";
    snprintf(g_dir, sizeof g_dir, "%s/r2d_world_edit_test_%d", tmp,
             (int)SDL_GetCurrentThreadID());
    SDL_CreateDirectory(g_dir);

    UNITY_BEGIN();
    RUN_TEST(test_create_box_and_polygon);
    RUN_TEST(test_move_and_duplicate_keep_unknown_fields);
    RUN_TEST(test_set_rect_via_patch_and_alias_id);
    RUN_TEST(test_vertex_move_valid_and_concave_rejected);
    RUN_TEST(test_clip_both_front_back);
    RUN_TEST(test_delete_and_face_set);
    RUN_TEST(test_world_set_and_validation);
    RUN_TEST(test_entity_create_set_delete);
    RUN_TEST(test_path_create_node_ops_and_metadata);
    RUN_TEST(test_visgroup_ensure_state);
    RUN_TEST(test_canonical_write_and_reload_round_trip);
    RUN_TEST(test_usage_errors);
    const int rc = UNITY_END();
    return rc;
}
