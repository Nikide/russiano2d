#pragma once
// ===========================================================================
// Re2D: pure 2D navigation over the native cell/span/portal topology.
//
// This is a constrained Re2D helper, not a general navigation system:
//   * one graph node per world span (a stack-aware free height interval);
//   * one directed edge per traversable portal/span-pair (door, window, step);
//   * XY only, with height used solely for passability (headroom, step up/down).
// There is no 3D navmesh, no ECS, no triangle soup. The builder reads the
// authoritative R2DRe2dWorld tables; it never owns or mutates world geometry.
//
// Allocation discipline
// ---------------------
// r2d_world_nav_build() never calls malloc. Every output array is supplied by
// the caller. The usual sizing pattern is:
//
//     int need = r2d_world_nav_build(w, radius, height, step,
//                                    NULL, 0, NULL, 0, NULL, 0, &graph);
//     nodes   = malloc(w->span_count * sizeof *nodes);
//     edges   = malloc(need * sizeof *edges);
//     offsets = malloc((w->span_count + 1) * sizeof *offsets);
//     r2d_world_nav_build(w, radius, height, step,
//                         nodes, w->span_count, edges, need,
//                         offsets, w->span_count + 1, &graph);
//
// A sizing call returns the required directed-edge count and leaves the graph
// empty. A real build returns that same count after filling all arrays. When
// any buffer is too small the builder writes nothing and returns the required
// count (still >= 0), so callers can compare it against their capacity.
//
// r2d_world_nav_path() is likewise allocation-free. It borrows a fixed-size
// R2DWorldNavScratch struct plus caller-owned arrays whose length must be at
// least the graph node count.
//
// Passability rules (applied at build time)
// -----------------------------------------
// A portal edge exists between spans A and B only when all of these hold:
//   * the portal is open: closed==false and open_fraction > 0, and the
//     effective opening (open fraction clipped from the top, then clipped to
//     both spans' floors/ceilings by r2d_world_opening_between) is non-empty;
//   * the opening's free height is at least actor_height;
//   * both spans independently offer at least actor_height of headroom;
//   * the floor height delta at the portal midpoint is at most step;
//   * the portal segment is at least 2*actor_radius long (the actor diameter
//     fits through the doorway).
// Closed portals, too-low openings, unreachable steps and too-narrow doorways
// simply produce no edge; the spans stay as isolated nodes.
//
// Determinism
// -----------
// Edges are emitted in a fixed order (ascending from-span, then ascending
// portal incidence order, then ascending to-span). A* breaks equal f-score
// ties by lower node index. Running the same query on the same graph always
// yields the same path, and no persistent state is kept between queries.
//
// Dynamic state at query time
// ---------------------------
// Door/lift/hazard changes do not require rebuilding the graph: pass optional
// blocked_span[node_count] and blocked_portal[world->portal_count] bitmasks to
// r2d_world_nav_path(). A set byte removes that node/edge from the search. Both
// arrays may be NULL (nothing blocked).
// ===========================================================================
#include "re2d_world.h"

#include <stdbool.h>
#include <stdint.h>

// Input actor parameters are baked into a node: `span` is the world span
// index and (x,y) is that span's footprint centre. radius is stored for
// diagnostics only; it already decided reachability during the build.
typedef struct {
    int span;
    float x, y, radius;
} R2DWorldNavNode;

// Directed adjacency entry. `from_span`/`to_span` are node indices; because
// the builder emits one node per span in span order they are also span
// indices. `portal` is the world portal handle that created the edge.
typedef struct {
    int from_span, to_span;
    float cost;
    int portal;
} R2DWorldNavEdge;

// Caller-owned graph storage. The builder fills nodes[0..node_count),
// edges[0..edge_count) and CSR offsets[0..node_count] where
// offsets[i]..offsets[i+1] index the outgoing edges of node i.
typedef struct {
    R2DWorldNavNode *nodes;
    int node_count;
    R2DWorldNavEdge *edges;
    int edge_count;
    int *offsets;
} R2DWorldNavGraph;

// Fixed-size A* workspace. `capacity` must be >= graph->node_count and every
// borrowed array must have room for capacity entries. `g` is the best known
// cost, `parent` the predecessor, `state` 0/1/2 = unseen/open/closed,
// `heap`/`heap_pos` the deterministic binary min-heap. Callers may reuse the
// same struct for every query; r2d_world_nav_path() initialises it.
typedef struct {
    float *g;
    int *parent;
    uint8_t *state;
    int *heap;
    int *heap_pos;
    int heap_count;
    int capacity;
} R2DWorldNavScratch;

// Build the span/portal navigation graph. Returns the required directed-edge
// count (>= 0) on success or when buffers are too small, and -1 on invalid
// arguments (NULL world/out, non-finite or negative parameters). A world with
// no cells/portals still yields one node per span and zero edges.
int r2d_world_nav_build(const R2DRe2dWorld *world,
                        float actor_radius, float actor_height, float step,
                        R2DWorldNavNode *nodes, int node_capacity,
                        R2DWorldNavEdge *edges, int edge_capacity,
                        int *offsets, int offset_capacity,
                        R2DWorldNavGraph *out);

// Nearest node in XY (squared distance). Ties resolve to the lower node index.
// Returns -1 for a NULL/empty graph or non-finite coordinates.
int r2d_world_nav_nearest(const R2DWorldNavGraph *graph, float x, float y);

// Deterministic A* from one node to another. Writes node indices (which equal
// span indices for builder-produced graphs) to `path` and returns the path
// length, or -1 when unreachable, arguments are invalid, `capacity` cannot
// hold the path, or the max_visits expansion budget runs out. `scratch` is
// mandatory and must have capacity >= graph->node_count. blocked_span and
// blocked_portal are optional dynamic-exclusion masks (see the header notes).
int r2d_world_nav_path(const R2DWorldNavGraph *graph, int from, int to,
                       int *path, int capacity, int max_visits,
                       R2DWorldNavScratch *scratch,
                       const uint8_t *blocked_span,
                       const uint8_t *blocked_portal);
