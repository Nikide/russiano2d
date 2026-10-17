#include "re2d_world_nav.h"

#include <limits.h>
#include <math.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

static bool nav_span_fits(const R2DRe2dWorld *world, int span, float height)
{
    float low, high;
    r2d_world_span_height_bounds(&world->spans[span], &low, &high);
    return high - low >= height;
}

// One directed edge from span `from` to span `to` through portal `p`.
// Writes the deterministic cost when the edge is traversable.
static bool nav_edge_ok(const R2DRe2dWorld *world, int from, int to,
                        const R2DWorldPortal *p, float radius, float height,
                        float step, float *out_cost)
{
    const R2DWorldSpan *a = &world->spans[from];
    const R2DWorldSpan *b = &world->spans[to];

    if (!nav_span_fits(world, from, height) || !nav_span_fits(world, to, height))
        return false;

    // The actor diameter must fit through the shared portal edge.
    float dx = p->bx - p->ax, dy = p->by - p->ay;
    float length = hypotf(dx, dy);
    if (length < 2.0f * radius) return false;

    float mx = 0.5f * (p->ax + p->bx);
    float my = 0.5f * (p->ay + p->by);
    float fa = r2d_world_floor_height(a, mx, my);
    float fb = r2d_world_floor_height(b, mx, my);
    float rise = fabsf(fa - fb);
    if (!(rise <= step + 1e-6f)) return false;

    // At least one effective opening must be tall enough after the portal's
    // open fraction and both spans' free intervals have clipped it.
    bool passable = false;
    for (int j = 0; j < p->opening_count; j++) {
        R2DWorldOpening opening;
        if (!r2d_world_opening_between(a, b, p,
                                       &world->openings[p->first_opening + j],
                                       &opening))
            continue;
        if (opening.top - opening.bottom + 1e-6f < height) continue;
        passable = true;
        break;
    }
    if (!passable) return false;

    if (out_cost) {
        float cx = (b->x + b->w * 0.5f) - (a->x + a->w * 0.5f);
        float cy = (b->y + b->h * 0.5f) - (a->y + a->h * 0.5f);
        *out_cost = hypotf(cx, cy) + rise;
    }
    return true;
}

static bool nav_portal_open(const R2DWorldPortal *p)
{
    if (p->closed) return false;
    float fraction = p->open_fraction;
    if (!isfinite(fraction)) fraction = 1.0f;
    return fraction > 0.0f;
}

// Counts (or fills) all directed edges in the deterministic order:
// ascending from-span -> ascending cell-portal incidence -> ascending to-span.
static int nav_emit_edges(const R2DRe2dWorld *world, float radius, float height,
                          float step, R2DWorldNavEdge *edges, int *offsets)
{
    int count = 0;
    for (int from = 0; from < world->span_count; from++) {
        if (offsets) offsets[from] = count;
        int cell = world->span_cells ? world->span_cells[from] : -1;
        if (cell < 0 || cell >= world->cell_count ||
            !world->cell_portal_offsets || !world->cell_portal_refs ||
            !world->cells || !world->portals)
            continue;
        for (int pi = world->cell_portal_offsets[cell];
             pi < world->cell_portal_offsets[cell + 1]; pi++) {
            int pid = world->cell_portal_refs[pi];
            if (pid < 0 || pid >= world->portal_count) continue;
            const R2DWorldPortal *p = &world->portals[pid];
            if (!nav_portal_open(p)) continue;
            int other = p->cell_a == cell ? p->cell_b
                      : p->cell_b == cell ? p->cell_a : -1;
            if (other < 0 || other >= world->cell_count) continue;
            const R2DWorldCell *oc = &world->cells[other];
            for (int k = 0; k < oc->span_count; k++) {
                int to = oc->first_span + k;
                if (to < 0 || to >= world->span_count || to == from) continue;
                float cost = 0.0f;
                if (!nav_edge_ok(world, from, to, p, radius, height, step,
                                 &cost))
                    continue;
                if (count == INT_MAX) return -1;
                if (edges)
                    edges[count] = (R2DWorldNavEdge){from, to, cost, pid};
                count++;
            }
        }
    }
    if (offsets) offsets[world->span_count] = count;
    return count;
}

int r2d_world_nav_build(const R2DRe2dWorld *world,
                        float actor_radius, float actor_height, float step,
                        R2DWorldNavNode *nodes, int node_capacity,
                        R2DWorldNavEdge *edges, int edge_capacity,
                        int *offsets, int offset_capacity,
                        R2DWorldNavGraph *out)
{
    if (out) memset(out, 0, sizeof *out);
    if (!world || !out) return -1;
    if (!isfinite(actor_radius) || actor_radius < 0.0f) return -1;
    if (!isfinite(actor_height) || actor_height <= 0.0f) return -1;
    if (!isfinite(step) || step < 0.0f) return -1;
    if (world->span_count < 0 || world->cell_count < 0 ||
        world->portal_count < 0)
        return -1;
    if (world->span_count && !world->spans) return -1;
    if (node_capacity < 0 || edge_capacity < 0 || offset_capacity < 0)
        return -1;
    // A NULL array with a positive capacity is a caller error, not a sizing
    // pass; a sizing pass always asks for zero entries.
    if ((node_capacity > 0 && !nodes) ||
        (edge_capacity > 0 && !edges) ||
        (offset_capacity > 0 && !offsets))
        return -1;

    int node_count = world->span_count;
    int required = nav_emit_edges(world, actor_radius, actor_height, step,
                                  NULL, NULL);
    if (required < 0) return -1;

    bool fits = node_count <= node_capacity &&
                (node_count == 0 || nodes) &&
                (node_count == 0 ||
                 (offsets && offset_capacity >= node_count + 1)) &&
                required <= edge_capacity &&
                (required == 0 || edges);
    if (!fits) return required;

    for (int i = 0; i < node_count; i++) {
        const R2DWorldSpan *s = &world->spans[i];
        nodes[i] = (R2DWorldNavNode){
            i, s->x + s->w * 0.5f, s->y + s->h * 0.5f, actor_radius
        };
    }

    int written = nav_emit_edges(world, actor_radius, actor_height, step,
                                 edges, offsets);
    if (written != required) return -1;

    out->nodes = nodes;
    out->node_count = node_count;
    out->edges = required ? edges : NULL;
    out->edge_count = written;
    out->offsets = node_count ? offsets : NULL;
    return written;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

int r2d_world_nav_nearest(const R2DWorldNavGraph *graph, float x, float y)
{
    if (!graph || !graph->nodes || graph->node_count <= 0) return -1;
    if (!isfinite(x) || !isfinite(y)) return -1;
    int best = -1;
    float best_distance = INFINITY;
    for (int i = 0; i < graph->node_count; i++) {
        float dx = graph->nodes[i].x - x;
        float dy = graph->nodes[i].y - y;
        float distance = dx * dx + dy * dy;
        // Strict '<' keeps the lower index on an exact tie.
        if (distance < best_distance) {
            best_distance = distance;
            best = i;
        }
    }
    return best;
}

// Admissible geometric heuristic: euclidean XY distance never exceeds an edge
// cost, which is that same distance plus the (non-negative) floor rise.
static float nav_heuristic(const R2DWorldNavGraph *graph, int a, int b)
{
    float dx = graph->nodes[a].x - graph->nodes[b].x;
    float dy = graph->nodes[a].y - graph->nodes[b].y;
    return hypotf(dx, dy);
}

static bool nav_before(const R2DWorldNavGraph *graph,
                       const R2DWorldNavScratch *scratch,
                       int a, int b, int target)
{
    float fa = scratch->g[a] + nav_heuristic(graph, a, target);
    float fb = scratch->g[b] + nav_heuristic(graph, b, target);
    if (fa < fb) return true;
    if (fa > fb) return false;
    return a < b; // deterministic tie-break: lower node index
}

static void nav_heap_up(const R2DWorldNavGraph *graph,
                        R2DWorldNavScratch *scratch, int index, int target)
{
    while (index > 0) {
        int parent = (index - 1) / 2;
        if (!nav_before(graph, scratch, scratch->heap[index],
                        scratch->heap[parent], target))
            break;
        int tmp = scratch->heap[index];
        scratch->heap[index] = scratch->heap[parent];
        scratch->heap[parent] = tmp;
        scratch->heap_pos[scratch->heap[index]] = index;
        scratch->heap_pos[scratch->heap[parent]] = parent;
        index = parent;
    }
}

static bool nav_heap_push(const R2DWorldNavGraph *graph,
                          R2DWorldNavScratch *scratch, int node, int target)
{
    if (scratch->heap_count >= scratch->capacity) return false;
    int index = scratch->heap_count++;
    scratch->heap[index] = node;
    scratch->heap_pos[node] = index;
    nav_heap_up(graph, scratch, index, target);
    return true;
}

static int nav_heap_pop(const R2DWorldNavGraph *graph,
                        R2DWorldNavScratch *scratch, int target)
{
    if (scratch->heap_count <= 0) return -1;
    int top = scratch->heap[0];
    scratch->heap_pos[top] = -1;
    int last = --scratch->heap_count;
    if (last <= 0) return top;
    scratch->heap[0] = scratch->heap[last];
    scratch->heap_pos[scratch->heap[0]] = 0;
    int index = 0;
    for (;;) {
        int left = index * 2 + 1;
        int right = left + 1;
        if (left >= scratch->heap_count) break;
        int smallest = left;
        if (right < scratch->heap_count &&
            nav_before(graph, scratch, scratch->heap[right],
                       scratch->heap[left], target))
            smallest = right;
        if (!nav_before(graph, scratch, scratch->heap[smallest],
                        scratch->heap[index], target))
            break;
        int tmp = scratch->heap[index];
        scratch->heap[index] = scratch->heap[smallest];
        scratch->heap[smallest] = tmp;
        scratch->heap_pos[scratch->heap[index]] = index;
        scratch->heap_pos[scratch->heap[smallest]] = smallest;
        index = smallest;
    }
    return top;
}

int r2d_world_nav_path(const R2DWorldNavGraph *graph, int from, int to,
                       int *path, int capacity, int max_visits,
                       R2DWorldNavScratch *scratch,
                       const uint8_t *blocked_span,
                       const uint8_t *blocked_portal)
{
    if (!graph || !graph->nodes || !graph->offsets) return -1;
    if (graph->node_count <= 0) return -1;
    if (graph->edge_count < 0 || (graph->edge_count > 0 && !graph->edges))
        return -1;
    if (from < 0 || from >= graph->node_count ||
        to < 0 || to >= graph->node_count)
        return -1;
    if (!path || capacity <= 0) return -1;
    if (max_visits <= 0) return -1;
    if (!scratch || scratch->capacity < graph->node_count ||
        !scratch->g || !scratch->parent || !scratch->state ||
        !scratch->heap || !scratch->heap_pos)
        return -1;

    if (blocked_span && (blocked_span[from] || blocked_span[to])) return -1;

    for (int i = 0; i < graph->node_count; i++) {
        scratch->g[i] = INFINITY;
        scratch->parent[i] = -1;
        scratch->state[i] = 0;
        scratch->heap_pos[i] = -1;
    }
    scratch->heap_count = 0;

    scratch->g[from] = 0.0f;
    scratch->state[from] = 1;
    if (!nav_heap_push(graph, scratch, from, to)) return -1;

    int visits = 0;
    for (;;) {
        int node = nav_heap_pop(graph, scratch, to);
        if (node < 0) return -1;
        if (scratch->state[node] == 2) continue;
        scratch->state[node] = 2;
        visits++;

        if (node == to) {
            // Count first so a too-small path array is rejected without a
            // partial write, then fill backwards and reverse in place.
            int count = 0;
            for (int cur = to; cur >= 0; cur = scratch->parent[cur]) count++;
            if (count > capacity) return -1;
            int index = count;
            for (int cur = to; cur >= 0; cur = scratch->parent[cur])
                path[--index] = cur;
            return count;
        }
        if (visits >= max_visits) return -1;

        for (int e = graph->offsets[node]; e < graph->offsets[node + 1]; e++) {
            const R2DWorldNavEdge *edge = &graph->edges[e];
            int next = edge->to_span;
            if (next < 0 || next >= graph->node_count) continue;
            if (!isfinite(edge->cost) || edge->cost < 0.0f) continue;
            if (blocked_span && blocked_span[next]) continue;
            if (blocked_portal && edge->portal >= 0 &&
                blocked_portal[edge->portal])
                continue;
            if (scratch->state[next] == 2) continue;
            float tentative = scratch->g[node] + edge->cost;
            if (tentative < scratch->g[next]) {
                scratch->g[next] = tentative;
                scratch->parent[next] = node;
                if (scratch->state[next] == 0) {
                    scratch->state[next] = 1;
                    if (!nav_heap_push(graph, scratch, next, to)) return -1;
                } else {
                    // Already open: cost only decreased, so sift it upward.
                    nav_heap_up(graph, scratch, scratch->heap_pos[next], to);
                }
            }
        }
    }
}
