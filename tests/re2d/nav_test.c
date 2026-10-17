#include "re2d_world_nav.h"
#include "unity.h"

#include <math.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

// ---------------------------------------------------------------------------
// Fixtures: tiny explicit-cell worlds, never a 3D mesh.
// ---------------------------------------------------------------------------

static R2DWorldSpan make_span(float x, float y, float w, float h,
                              float bottom, float top)
{
    R2DWorldSpan s = {0};
    s.x = x; s.y = y; s.w = w; s.h = h;
    s.bottom = bottom; s.top = top;
    s.floor_color = 0xff00ff00u;
    s.ceiling_color = 0xff888888u;
    return s;
}

static void build_cells_or_fail(R2DRe2dWorld *world, int span_count,
                                const R2DWorldSpan *spans, int cell_count,
                                const R2DWorldCell *cells, int portal_count,
                                const R2DWorldPortal *portals, int opening_count,
                                const R2DWorldOpening *openings)
{
    char err[256];
    TEST_ASSERT_TRUE_MESSAGE(
        r2d_world_build_cells(world, NULL, 0, spans, span_count,
                              cells, cell_count, portals, portal_count,
                              openings, opening_count, err, sizeof err),
        err);
}

// Two XY-adjacent cells, each with a lower [0,40] and an upper [60,100]
// storey. A single portal at x=100 has one opening per storey.
static void build_two_storey_world(R2DRe2dWorld *world)
{
    R2DWorldSpan spans[4] = {
        make_span(0, 0, 100, 100, 0, 40),
        make_span(0, 0, 100, 100, 60, 100),
        make_span(100, 0, 100, 100, 0, 40),
        make_span(100, 0, 100, 100, 60, 100),
    };
    R2DWorldCell cells[2] = {
        {0, 0, 100, 100, 0, 2},
        {100, 0, 100, 100, 2, 2},
    };
    R2DWorldOpening openings[2] = {{0, 40}, {60, 100}};
    R2DWorldPortal portal = {0, 1, 0, 2, 100, 0, 100, 100, false, 1.0f};
    build_cells_or_fail(world, 4, spans, 2, cells, 1, &portal, 2, openings);
}

// Two same-storey cells with one authored opening interval.
static void build_flat_passage(R2DRe2dWorld *world, float bottom_b,
                               const R2DWorldOpening *opening)
{
    R2DWorldSpan spans[2] = {
        make_span(0, 0, 100, 100, 0, 100),
        make_span(100, 0, 100, 100, bottom_b, 100),
    };
    R2DWorldCell cells[2] = {
        {0, 0, 100, 100, 0, 1},
        {100, 0, 100, 100, 1, 1},
    };
    R2DWorldPortal portal = {0, 1, 0, 1, 100, 0, 100, 100, false, 1.0f};
    build_cells_or_fail(world, 2, spans, 2, cells, 1, &portal, 1, opening);
}

static int build_graph(const R2DRe2dWorld *world, float radius, float height,
                       float step, R2DWorldNavNode *nodes, int node_capacity,
                       R2DWorldNavEdge *edges, int edge_capacity,
                       int *offsets, int offset_capacity,
                       R2DWorldNavGraph *graph)
{
    TEST_ASSERT_NOT_NULL(nodes);
    TEST_ASSERT_NOT_NULL(edges);
    TEST_ASSERT_NOT_NULL(offsets);
    TEST_ASSERT_NOT_NULL(graph);
    return r2d_world_nav_build(world, radius, height, step,
                               nodes, node_capacity, edges, edge_capacity,
                               offsets, offset_capacity, graph);
}

// Scratch arrays sized for any graph in these tests (at most 4 nodes).
#define TEST_NAV_NODES 8
typedef struct {
    R2DWorldNavScratch scratch;
    float g[TEST_NAV_NODES];
    int parent[TEST_NAV_NODES];
    uint8_t state[TEST_NAV_NODES];
    int heap[TEST_NAV_NODES];
    int heap_pos[TEST_NAV_NODES];
} TestNavScratch;

static void reset_scratch(TestNavScratch *workspace, int capacity)
{
    memset(workspace, 0, sizeof *workspace);
    workspace->scratch.g = workspace->g;
    workspace->scratch.parent = workspace->parent;
    workspace->scratch.state = workspace->state;
    workspace->scratch.heap = workspace->heap;
    workspace->scratch.heap_pos = workspace->heap_pos;
    workspace->scratch.capacity = capacity;
}

static int run_path(const R2DWorldNavGraph *graph, int from, int to,
                    int *path, int capacity, int max_visits,
                    TestNavScratch *workspace)
{
    return r2d_world_nav_path(graph, from, to, path, capacity, max_visits,
                              &workspace->scratch, NULL, NULL);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

static void test_build_two_storey_graph(void)
{
    R2DRe2dWorld world = {0};
    build_two_storey_world(&world);
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, world.span_count, "two cells, two spans each");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, world.portal_count, "one shared portal");

    R2DWorldNavGraph sizing = {0};
    int required = r2d_world_nav_build(&world, 8.0f, 30.0f, 10.0f,
                                       NULL, 0, NULL, 0, NULL, 0, &sizing);
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, required,
                                  "sizing pass reports four directed edges");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, sizing.node_count,
                                  "sizing pass leaves the graph empty");

    R2DWorldNavNode nodes[4];
    R2DWorldNavEdge edges[4];
    int offsets[5];
    R2DWorldNavGraph graph = {0};
    TEST_ASSERT_EQUAL_INT(4, build_graph(&world, 8.0f, 30.0f, 10.0f,
                                         nodes, 4, edges, 4, offsets, 5,
                                         &graph));
    TEST_ASSERT_EQUAL_INT(4, graph.node_count);
    TEST_ASSERT_EQUAL_INT(4, graph.edge_count);
    TEST_ASSERT_EQUAL_INT(0, offsets[0]);
    TEST_ASSERT_EQUAL_INT(4, offsets[4]);

    for (int i = 0; i < 4; i++) {
        TEST_ASSERT_EQUAL_INT(i, graph.nodes[i].span);
        TEST_ASSERT_FLOAT_WITHIN(1e-5f, 8.0f, graph.nodes[i].radius);
    }
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 50.0f, graph.nodes[0].x);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 50.0f, graph.nodes[0].y);
    TEST_ASSERT_FLOAT_WITHIN(1e-4f, 150.0f, graph.nodes[2].x);

    // Lower storey connects 0<->2, upper storey connects 1<->3.
    TEST_ASSERT_EQUAL_INT(0, graph.edges[0].from_span);
    TEST_ASSERT_EQUAL_INT(2, graph.edges[0].to_span);
    TEST_ASSERT_EQUAL_INT(0, graph.edges[0].portal);
    TEST_ASSERT_EQUAL_INT(1, graph.edges[1].from_span);
    TEST_ASSERT_EQUAL_INT(3, graph.edges[1].to_span);
    TEST_ASSERT_EQUAL_INT(2, graph.edges[2].from_span);
    TEST_ASSERT_EQUAL_INT(0, graph.edges[2].to_span);
    TEST_ASSERT_EQUAL_INT(3, graph.edges[3].from_span);
    TEST_ASSERT_EQUAL_INT(1, graph.edges[3].to_span);
    TEST_ASSERT_TRUE(graph.edges[0].cost > 0.0f);

    r2d_world_free(&world);
}

static void test_build_capacity_too_small(void)
{
    R2DRe2dWorld world = {0};
    build_two_storey_world(&world);
    R2DWorldNavNode nodes[4];
    R2DWorldNavEdge edges[2];
    int offsets[5];
    R2DWorldNavGraph graph = {0};
    int required = r2d_world_nav_build(&world, 8.0f, 30.0f, 10.0f,
                                       nodes, 4, edges, 2, offsets, 5, &graph);
    TEST_ASSERT_EQUAL_INT_MESSAGE(4, required,
                                  "too-small edge array reports the requirement");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, graph.edge_count,
                                  "failed build writes no partial graph");
    r2d_world_free(&world);
}

// ---------------------------------------------------------------------------
// Topology rules
// ---------------------------------------------------------------------------

static void test_closed_portal_disconnects(void)
{
    R2DRe2dWorld world = {0};
    build_two_storey_world(&world);
    R2DWorldNavNode nodes[4];
    R2DWorldNavEdge edges[4];
    int offsets[5];
    R2DWorldNavGraph graph = {0};
    TestNavScratch workspace;
    int path[4];

    TEST_ASSERT_TRUE(r2d_world_portal_set_closed(&world, 0, true));
    TEST_ASSERT_EQUAL_INT(0, build_graph(&world, 8.0f, 30.0f, 10.0f,
                                         nodes, 4, edges, 4, offsets, 5,
                                         &graph));
    reset_scratch(&workspace, graph.node_count);
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, run_path(&graph, 0, 2, path, 4, 64,
                                               &workspace),
                                  "closed portal leaves the cells disconnected");

    TEST_ASSERT_TRUE(r2d_world_portal_set_open(&world, 0, 0.5f));
    TEST_ASSERT_EQUAL_INT(0, build_graph(&world, 8.0f, 30.0f, 10.0f,
                                         nodes, 4, edges, 4, offsets, 5,
                                         &graph));
    reset_scratch(&workspace, graph.node_count);
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, run_path(&graph, 0, 2, path, 4, 64,
                                               &workspace),
                                  "half-open door clips below actor height");

    TEST_ASSERT_TRUE(r2d_world_portal_set_open(&world, 0, 1.0f));
    TEST_ASSERT_EQUAL_INT(4, build_graph(&world, 8.0f, 30.0f, 10.0f,
                                         nodes, 4, edges, 4, offsets, 5,
                                         &graph));
    reset_scratch(&workspace, graph.node_count);
    TEST_ASSERT_EQUAL_INT(2, run_path(&graph, 0, 2, path, 4, 64, &workspace));
    r2d_world_free(&world);
}

static void test_actor_height_excludes_low_opening(void)
{
    R2DRe2dWorld world = {0};
    R2DWorldOpening low = {0, 20};
    build_flat_passage(&world, 0.0f, &low);
    R2DWorldNavNode nodes[2];
    R2DWorldNavEdge edges[2];
    int offsets[3];
    R2DWorldNavGraph graph = {0};

    TEST_ASSERT_EQUAL_INT_MESSAGE(0,
        build_graph(&world, 8.0f, 30.0f, 10.0f, nodes, 2, edges, 2,
                    offsets, 3, &graph),
        "opening shorter than the actor is not traversable");
    TEST_ASSERT_EQUAL_INT(2, graph.node_count);

    TEST_ASSERT_EQUAL_INT_MESSAGE(2,
        build_graph(&world, 8.0f, 19.0f, 10.0f, nodes, 2, edges, 2,
                    offsets, 3, &graph),
        "same opening admits a shorter actor");
    TEST_ASSERT_EQUAL_INT(0, graph.edges[0].from_span);
    TEST_ASSERT_EQUAL_INT(1, graph.edges[0].to_span);
    r2d_world_free(&world);
}

static void test_step_limit_excludes_tall_rise(void)
{
    R2DRe2dWorld world = {0};
    R2DWorldOpening full = {30, 100};
    build_flat_passage(&world, 30.0f, &full); // second floor is 30 above
    R2DWorldNavNode nodes[2];
    R2DWorldNavEdge edges[2];
    int offsets[3];
    R2DWorldNavGraph graph = {0};

    TEST_ASSERT_EQUAL_INT_MESSAGE(0,
        build_graph(&world, 8.0f, 40.0f, 10.0f, nodes, 2, edges, 2,
                    offsets, 3, &graph),
        "rise above step is rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2,
        build_graph(&world, 8.0f, 40.0f, 30.0f, nodes, 2, edges, 2,
                    offsets, 3, &graph),
        "same rise is accepted when the step limit allows it");
    r2d_world_free(&world);
}

static void test_portal_width_limits_actor_radius(void)
{
    R2DRe2dWorld world = {0};
    R2DWorldOpening full = {0, 100};
    build_flat_passage(&world, 0.0f, &full); // shared edge is 100 long
    R2DWorldNavNode nodes[2];
    R2DWorldNavEdge edges[2];
    int offsets[3];
    R2DWorldNavGraph graph = {0};

    TEST_ASSERT_EQUAL_INT_MESSAGE(0,
        build_graph(&world, 60.0f, 40.0f, 10.0f, nodes, 2, edges, 2,
                    offsets, 3, &graph),
        "actor diameter wider than the doorway is rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(2,
        build_graph(&world, 40.0f, 40.0f, 10.0f, nodes, 2, edges, 2,
                    offsets, 3, &graph),
        "actor that fits through the doorway is admitted");
    r2d_world_free(&world);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

static void test_nearest_span(void)
{
    R2DRe2dWorld world = {0};
    build_two_storey_world(&world);
    R2DWorldNavNode nodes[4];
    R2DWorldNavEdge edges[4];
    int offsets[5];
    R2DWorldNavGraph graph = {0};
    TEST_ASSERT_EQUAL_INT(4, build_graph(&world, 8.0f, 30.0f, 10.0f,
                                         nodes, 4, edges, 4, offsets, 5,
                                         &graph));
    TEST_ASSERT_EQUAL_INT(2, r2d_world_nav_nearest(&graph, 150.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_nav_nearest(&graph, 50.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(0, r2d_world_nav_nearest(&graph, -1000.0f, 50.0f));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_nearest(&graph, NAN, 50.0f));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_nearest(NULL, 0, 0));
    r2d_world_free(&world);
}

static void test_path_across_two_cells(void)
{
    R2DRe2dWorld world = {0};
    build_two_storey_world(&world);
    R2DWorldNavNode nodes[4];
    R2DWorldNavEdge edges[4];
    int offsets[5];
    R2DWorldNavGraph graph = {0};
    TestNavScratch workspace;
    int path[4];

    TEST_ASSERT_EQUAL_INT(4, build_graph(&world, 8.0f, 30.0f, 10.0f,
                                         nodes, 4, edges, 4, offsets, 5,
                                         &graph));
    reset_scratch(&workspace, graph.node_count);
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, run_path(&graph, 0, 2, path, 4, 64,
                                              &workspace),
                                  "path crosses one cell portal");
    TEST_ASSERT_EQUAL_INT(0, path[0]);
    TEST_ASSERT_EQUAL_INT(2, path[1]);
    TEST_ASSERT_EQUAL_INT(2, graph.nodes[path[1]].span);

    reset_scratch(&workspace, graph.node_count);
    TEST_ASSERT_EQUAL_INT(2, run_path(&graph, 2, 0, path, 4, 64, &workspace));
    TEST_ASSERT_EQUAL_INT(2, path[0]);
    TEST_ASSERT_EQUAL_INT(0, path[1]);

    reset_scratch(&workspace, graph.node_count);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, run_path(&graph, 1, 1, path, 4, 64,
                                              &workspace),
                                  "same-node path is a single node");
    TEST_ASSERT_EQUAL_INT(1, path[0]);
    r2d_world_free(&world);
}

static void test_unreachable_target(void)
{
    R2DRe2dWorld world = {0};
    build_two_storey_world(&world);
    R2DWorldNavNode nodes[4];
    R2DWorldNavEdge edges[4];
    int offsets[5];
    R2DWorldNavGraph graph = {0};
    TestNavScratch workspace;
    int path[4];

    TEST_ASSERT_EQUAL_INT(4, build_graph(&world, 8.0f, 30.0f, 10.0f,
                                         nodes, 4, edges, 4, offsets, 5,
                                         &graph));
    reset_scratch(&workspace, graph.node_count);
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, run_path(&graph, 0, 3, path, 4, 64,
                                               &workspace),
                                  "no vertical link between storeys");
    reset_scratch(&workspace, graph.node_count);
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, run_path(&graph, 2, 1, path, 4, 64,
                                               &workspace),
                                  "upper/lower storeys stay disconnected");
    r2d_world_free(&world);
}

static void test_astar_budget_exhaustion(void)
{
    R2DRe2dWorld world = {0};
    build_two_storey_world(&world);
    R2DWorldNavNode nodes[4];
    R2DWorldNavEdge edges[4];
    int offsets[5];
    R2DWorldNavGraph graph = {0};
    TestNavScratch workspace;
    int path[4];

    TEST_ASSERT_EQUAL_INT(4, build_graph(&world, 8.0f, 30.0f, 10.0f,
                                         nodes, 4, edges, 4, offsets, 5,
                                         &graph));
    reset_scratch(&workspace, graph.node_count);
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1, run_path(&graph, 0, 2, path, 4, 1,
                                               &workspace),
                                  "one expansion cannot reach the neighbour");
    reset_scratch(&workspace, graph.node_count);
    TEST_ASSERT_EQUAL_INT_MESSAGE(2, run_path(&graph, 0, 2, path, 4, 2,
                                              &workspace),
                                  "two expansions are exactly enough");
    r2d_world_free(&world);
}

static void test_deterministic_paths_and_rebuild(void)
{
    R2DRe2dWorld world = {0};
    build_two_storey_world(&world);
    R2DWorldNavNode nodes_a[4], nodes_b[4];
    R2DWorldNavEdge edges_a[4], edges_b[4];
    int offsets_a[5], offsets_b[5];
    R2DWorldNavGraph graph_a = {0}, graph_b = {0};
    TestNavScratch workspace;
    int path_a[4], path_b[4];

    TEST_ASSERT_EQUAL_INT(4, build_graph(&world, 8.0f, 30.0f, 10.0f,
                                         nodes_a, 4, edges_a, 4, offsets_a, 5,
                                         &graph_a));
    TEST_ASSERT_EQUAL_INT(4, build_graph(&world, 8.0f, 30.0f, 10.0f,
                                         nodes_b, 4, edges_b, 4, offsets_b, 5,
                                         &graph_b));
    TEST_ASSERT_EQUAL_INT(0, memcmp(nodes_a, nodes_b, sizeof nodes_a));
    TEST_ASSERT_EQUAL_INT(0, memcmp(edges_a, edges_b, sizeof edges_a));
    TEST_ASSERT_EQUAL_INT(0, memcmp(offsets_a, offsets_b, sizeof offsets_a));

    reset_scratch(&workspace, graph_a.node_count);
    int count_a = run_path(&graph_a, 0, 2, path_a, 4, 64, &workspace);
    reset_scratch(&workspace, graph_a.node_count);
    int count_b = run_path(&graph_a, 0, 2, path_b, 4, 64, &workspace);
    TEST_ASSERT_EQUAL_INT(count_a, count_b);
    TEST_ASSERT_EQUAL_INT(0, memcmp(path_a, path_b,
                                    (size_t)count_a * sizeof path_a[0]));
    r2d_world_free(&world);
}

static void test_dynamic_blocked_masks(void)
{
    R2DRe2dWorld world = {0};
    build_two_storey_world(&world);
    R2DWorldNavNode nodes[4];
    R2DWorldNavEdge edges[4];
    int offsets[5];
    R2DWorldNavGraph graph = {0};
    TestNavScratch workspace;
    int path[4];
    uint8_t blocked_span[4] = {0};
    uint8_t blocked_portal[1] = {0};

    TEST_ASSERT_EQUAL_INT(4, build_graph(&world, 8.0f, 30.0f, 10.0f,
                                         nodes, 4, edges, 4, offsets, 5,
                                         &graph));
    reset_scratch(&workspace, graph.node_count);
    blocked_span[2] = 1;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,
        r2d_world_nav_path(&graph, 0, 2, path, 4, 64, &workspace.scratch,
                           blocked_span, NULL),
        "blocked target span is rejected dynamically");

    blocked_span[2] = 0;
    blocked_span[1] = 1;
    TEST_ASSERT_EQUAL_INT_MESSAGE(2,
        r2d_world_nav_path(&graph, 0, 2, path, 4, 64, &workspace.scratch,
                           blocked_span, NULL),
        "blocking an unrelated storey keeps the path");
    blocked_span[1] = 0;

    blocked_portal[0] = 1;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,
        r2d_world_nav_path(&graph, 0, 2, path, 4, 64, &workspace.scratch,
                           NULL, blocked_portal),
        "blocked portal edge is rejected dynamically");
    blocked_portal[0] = 0;
    TEST_ASSERT_EQUAL_INT(2,
        r2d_world_nav_path(&graph, 0, 2, path, 4, 64, &workspace.scratch,
                           NULL, blocked_portal));
    r2d_world_free(&world);
}

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

static void test_bad_arguments(void)
{
    R2DRe2dWorld world = {0};
    build_two_storey_world(&world);
    R2DWorldNavNode nodes[4];
    R2DWorldNavEdge edges[4];
    int offsets[5];
    R2DWorldNavGraph graph = {0};
    TestNavScratch workspace;
    int path[4];

    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_build(NULL, 8, 30, 10,
        nodes, 4, edges, 4, offsets, 5, &graph));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_build(&world, 8, 30, 10,
        nodes, 4, edges, 4, offsets, 5, NULL));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_build(&world, -1, 30, 10,
        nodes, 4, edges, 4, offsets, 5, &graph));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_build(&world, NAN, 30, 10,
        nodes, 4, edges, 4, offsets, 5, &graph));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_build(&world, 8, 0, 10,
        nodes, 4, edges, 4, offsets, 5, &graph));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_build(&world, 8, INFINITY, 10,
        nodes, 4, edges, 4, offsets, 5, &graph));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_build(&world, 8, 30, -1,
        nodes, 4, edges, 4, offsets, 5, &graph));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_build(&world, 8, 30, 10,
        NULL, 4, edges, 4, offsets, 5, &graph));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_build(&world, 8, 30, 10,
        nodes, 4, edges, 4, NULL, 5, &graph));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_build(&world, 8, 30, 10,
        nodes, 4, NULL, 4, offsets, 5, &graph));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_build(&world, 8, 30, 10,
        nodes, -1, edges, 4, offsets, 5, &graph));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_build(&world, 8, 30, 10,
        nodes, 4, edges, -1, offsets, 5, &graph));

    TEST_ASSERT_EQUAL_INT(4, build_graph(&world, 8.0f, 30.0f, 10.0f,
                                         nodes, 4, edges, 4, offsets, 5,
                                         &graph));
    reset_scratch(&workspace, graph.node_count);
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_path(NULL, 0, 2, path, 4, 64,
                                                 &workspace.scratch, NULL, NULL));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_path(&graph, -1, 2, path, 4, 64,
                                                 &workspace.scratch, NULL, NULL));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_path(&graph, 0, 4, path, 4, 64,
                                                 &workspace.scratch, NULL, NULL));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_path(&graph, 0, 2, NULL, 4, 64,
                                                 &workspace.scratch, NULL, NULL));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_path(&graph, 0, 2, path, 0, 64,
                                                 &workspace.scratch, NULL, NULL));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_path(&graph, 0, 2, path, 1, 64,
                                                 &workspace.scratch, NULL, NULL));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_path(&graph, 0, 2, path, 4, 0,
                                                 &workspace.scratch, NULL, NULL));
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_path(&graph, 0, 2, path, 4, 64,
                                                 NULL, NULL, NULL));
    workspace.scratch.capacity = 3;
    TEST_ASSERT_EQUAL_INT(-1, r2d_world_nav_path(&graph, 0, 2, path, 4, 64,
                                                 &workspace.scratch, NULL, NULL));
    r2d_world_free(&world);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_build_two_storey_graph);
    RUN_TEST(test_build_capacity_too_small);
    RUN_TEST(test_closed_portal_disconnects);
    RUN_TEST(test_actor_height_excludes_low_opening);
    RUN_TEST(test_step_limit_excludes_tall_rise);
    RUN_TEST(test_portal_width_limits_actor_radius);
    RUN_TEST(test_nearest_span);
    RUN_TEST(test_path_across_two_cells);
    RUN_TEST(test_unreachable_target);
    RUN_TEST(test_astar_budget_exhaustion);
    RUN_TEST(test_deterministic_paths_and_rebuild);
    RUN_TEST(test_dynamic_blocked_masks);
    RUN_TEST(test_bad_arguments);
    return UNITY_END();
}
