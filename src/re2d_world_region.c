#include "re2d_world_region.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    int key;
    int cell;
} RegionKey;

static int compare_keys(const void *a, const void *b)
{
    const RegionKey *x = (const RegionKey *)a;
    const RegionKey *y = (const RegionKey *)b;
    if (x->key != y->key) return x->key < y->key ? -1 : 1;
    return x->cell < y->cell ? -1 : x->cell > y->cell ? 1 : 0;
}

typedef struct {
    int region;
    int neighbor;
} RegionEdge;

static int compare_edges(const void *a, const void *b)
{
    const RegionEdge *x = (const RegionEdge *)a;
    const RegionEdge *y = (const RegionEdge *)b;
    if (x->region != y->region) return x->region < y->region ? -1 : 1;
    return x->neighbor < y->neighbor ? -1 : x->neighbor > y->neighbor ? 1 : 0;
}

typedef struct {
    int region;
    int portal;
} PortalIncidence;

static int compare_incidence(const void *a, const void *b)
{
    const PortalIncidence *x = (const PortalIncidence *)a;
    const PortalIncidence *y = (const PortalIncidence *)b;
    if (x->region != y->region) return x->region < y->region ? -1 : 1;
    return x->portal < y->portal ? -1 : x->portal > y->portal ? 1 : 0;
}

static bool fail(char *error, size_t size, const char *message)
{
    if (error && size) snprintf(error, size, "%s", message);
    return false;
}

static bool is_open(const R2DWorldRegionPortal *p)
{
    return !p->closed;
}

// Deterministic coarse PVS: region reachability over currently open portals.
static bool build_pvs(R2DWorldRegionSet *set,
                      const R2DWorldRegionPortal *portals, int portal_count)
{
    const int n = set->region_count;
    const int words = set->pvs_words;
    if (n <= 0 || words <= 0 || !set->pvs ||
        set->pvs_capacity < n * words || !set->region_portal_offsets ||
        !set->region_portal_refs)
        return false;
    memset(set->pvs, 0, (size_t)n * (size_t)words * sizeof(uint64_t));
    int *queue = (int *)malloc((size_t)n * sizeof(int));
    if (!queue) return false;
    int edges = 0;
    for (int start = 0; start < n; start++) {
        int head = 0, tail = 0;
        set->pvs[(size_t)start * words + (start >> 6)] |= 1ull << (start & 63);
        queue[tail++] = start;
        while (head < tail) {
            const int current = queue[head++];
            const int first = set->region_portal_offsets[current];
            const int end = set->region_portal_offsets[current + 1];
            for (int i = first; i < end; i++) {
                const int pi = set->region_portal_refs[i];
                if (pi < 0 || pi >= portal_count) continue;
                if (!is_open(&portals[pi])) continue;
                const int next = set->cell_region[portals[pi].cell_a] == current
                               ? set->cell_region[portals[pi].cell_b]
                               : set->cell_region[portals[pi].cell_a];
                if (next < 0 || next >= n) continue;
                const size_t word = (size_t)next >> 6;
                const uint64_t bit = 1ull << (next & 63);
                if (set->pvs[(size_t)start * words + word] & bit) continue;
                set->pvs[(size_t)start * words + word] |= bit;
                if (tail < n) queue[tail++] = next;
                edges++;
            }
        }
    }
    free(queue);
    set->metrics.pvs_edges = edges;
    return true;
}

int r2d_world_region_build(const R2DWorldRegionCell *cells, int cell_count,
                           const R2DWorldRegionPortal *portals, int portal_count,
                           float region_size, R2DWorldRegionSet *out,
                           char *error, size_t error_size)
{
    if (error && error_size) error[0] = 0;
    if (!out) return -1;
    if (!cells || cell_count <= 0 || cell_count > 65536)
        return fail(error, error_size, "regions: invalid cell count") ? -1 : -1;
    if (portal_count < 0 || (portal_count && !portals))
        return fail(error, error_size, "regions: invalid portal count") ? -1 : -1;
    if (!isfinite(region_size) || region_size <= 0.0f)
        return fail(error, error_size, "regions: region size must be positive") ? -1 : -1;

    float minx = cells[0].x, miny = cells[0].y;
    float maxx = cells[0].x + cells[0].w, maxy = cells[0].y + cells[0].h;
    for (int i = 0; i < cell_count; i++) {
        const R2DWorldRegionCell *c = &cells[i];
        if (!isfinite(c->x) || !isfinite(c->y) || !isfinite(c->w) ||
            !isfinite(c->h) || c->w <= 0.0f || c->h <= 0.0f)
            return fail(error, error_size, "regions: invalid cell bounds") ? -1 : -1;
        if (c->x < minx) minx = c->x;
        if (c->y < miny) miny = c->y;
        if (c->x + c->w > maxx) maxx = c->x + c->w;
        if (c->y + c->h > maxy) maxy = c->y + c->h;
    }
    for (int i = 0; i < portal_count; i++) {
        if (portals[i].cell_a < 0 || portals[i].cell_a >= cell_count ||
            portals[i].cell_b < 0 || portals[i].cell_b >= cell_count ||
            portals[i].cell_a == portals[i].cell_b)
            return fail(error, error_size, "regions: invalid portal link") ? -1 : -1;
    }

    const double span_x = (double)maxx - minx;
    const double span_y = (double)maxy - miny;
    int columns = (int)ceil(span_x / (double)region_size);
    int rows = (int)ceil(span_y / (double)region_size);
    if (columns < 1) columns = 1;
    if (rows < 1) rows = 1;
    if (columns > R2D_WORLD_REGION_MAX_GRID || rows > R2D_WORLD_REGION_MAX_GRID ||
        (long long)columns * rows > 2147483647LL)
        return fail(error, error_size, "regions: grid too large; increase region size") ? -1 : -1;

    RegionKey *keys = (RegionKey *)malloc((size_t)cell_count * sizeof(RegionKey));
    if (!keys) return fail(error, error_size, "regions: out of memory") ? -1 : -1;

    int *cell_region = (int *)malloc((size_t)cell_count * sizeof(int));
    if (!cell_region) { free(keys); return fail(error, error_size, "regions: out of memory") ? -1 : -1; }

    for (int i = 0; i < cell_count; i++) {
        const float cx = cells[i].x + cells[i].w * 0.5f;
        const float cy = cells[i].y + cells[i].h * 0.5f;
        int col = (int)floorf((cx - minx) / region_size);
        int row = (int)floorf((cy - miny) / region_size);
        if (col < 0) col = 0;
        if (row < 0) row = 0;
        if (col >= columns) col = columns - 1;
        if (row >= rows) row = rows - 1;
        keys[i].key = row * columns + col;
        keys[i].cell = i;
    }
    qsort(keys, (size_t)cell_count, sizeof(RegionKey), compare_keys);

    int region_count = 0;
    for (int i = 0; i < cell_count; i++) {
        if (i == 0 || keys[i].key != keys[i - 1].key) region_count++;
        cell_region[keys[i].cell] = region_count - 1;
    }
    const int pvs_words = R2D_WORLD_REGION_PVS_WORDS(region_count);

    out->region_count = region_count;
    out->pvs_words = pvs_words;
    out->columns = columns;
    out->rows = rows;
    out->region_size = region_size;
    out->origin_x = minx;
    out->origin_y = miny;
    out->cell_count = cell_count;
    out->portal_count = portal_count;
    memset(&out->metrics, 0, sizeof out->metrics);

    const bool fits =
        out->regions && out->region_capacity >= region_count &&
        out->cell_region && out->cell_region_capacity >= cell_count &&
        out->region_cells && out->region_cells_capacity >= cell_count &&
        out->region_portal_offsets &&
        out->region_portal_offsets_capacity >= region_count + 1 &&
        (portal_count == 0 ||
         (out->region_portal_refs &&
          out->region_portal_refs_capacity >= portal_count * 2)) &&
        out->region_adj_offsets &&
        out->region_adj_offsets_capacity >= region_count + 1 &&
        (portal_count == 0 ||
         (out->region_adj_refs &&
          out->region_adj_refs_capacity >= portal_count * 2)) &&
        out->pvs && out->pvs_capacity >= region_count * pvs_words;
    if (!fits) {
        free(keys);
        free(cell_region);
        return region_count;
    }

    for (int i = 0; i < cell_count; i++) out->cell_region[i] = cell_region[i];

    // Region headers in row-major key order.
    memset(out->regions, 0, (size_t)region_count * sizeof(R2DWorldRegion));
    {
        int r = -1;
        int previous_key = -1;
        for (int i = 0; i < cell_count; i++) {
            if (i == 0 || keys[i].key != previous_key) {
                r++;
                previous_key = keys[i].key;
                out->regions[r].col = previous_key % columns;
                out->regions[r].row = previous_key / columns;
                out->regions[r].x = minx + (float)out->regions[r].col * region_size;
                out->regions[r].y = miny + (float)out->regions[r].row * region_size;
                out->regions[r].w = region_size;
                out->regions[r].h = region_size;
            }
        }
    }

    // CSR: cells per region.
    int *counts = (int *)calloc((size_t)region_count, sizeof(int));
    int *cursor = (int *)malloc((size_t)region_count * sizeof(int));
    if (!counts || !cursor) {
        free(keys); free(cell_region); free(counts); free(cursor);
        return fail(error, error_size, "regions: out of memory") ? -1 : -1;
    }
    for (int i = 0; i < cell_count; i++) counts[cell_region[i]]++;
    int offset = 0;
    for (int r = 0; r < region_count; r++) {
        out->regions[r].first_cell = offset;
        out->regions[r].cell_count = counts[r];
        cursor[r] = offset;
        offset += counts[r];
    }
    for (int i = 0; i < cell_count; i++)
        out->region_cells[cursor[cell_region[i]]++] = i;

    // Portal incidences per region (one entry per touched region).
    PortalIncidence *incidence = (PortalIncidence *)malloc(
        (size_t)(portal_count ? portal_count * 2 : 1) * sizeof(PortalIncidence));
    if (!incidence) {
        free(keys); free(cell_region); free(counts); free(cursor);
        return fail(error, error_size, "regions: out of memory") ? -1 : -1;
    }
    int incidence_count = 0;
    for (int p = 0; p < portal_count; p++) {
        const int ra = cell_region[portals[p].cell_a];
        const int rb = cell_region[portals[p].cell_b];
        incidence[incidence_count++] = (PortalIncidence){ra, p};
        if (rb != ra) incidence[incidence_count++] = (PortalIncidence){rb, p};
    }
    qsort(incidence, (size_t)incidence_count, sizeof(PortalIncidence),
          compare_incidence);
    memset(counts, 0, (size_t)region_count * sizeof(int));
    for (int i = 0; i < incidence_count; i++) counts[incidence[i].region]++;
    offset = 0;
    for (int r = 0; r < region_count; r++) {
        out->region_portal_offsets[r] = offset;
        out->regions[r].first_portal = offset;
        out->regions[r].portal_count = counts[r];
        offset += counts[r];
    }
    out->region_portal_offsets[region_count] = offset;
    {
        int *fill = (int *)calloc((size_t)region_count, sizeof(int));
        if (!fill) {
            free(keys); free(cell_region); free(counts); free(cursor); free(incidence);
            return fail(error, error_size, "regions: out of memory") ? -1 : -1;
        }
        for (int i = 0; i < incidence_count; i++)
            out->region_portal_refs[out->region_portal_offsets[incidence[i].region] +
                                    fill[incidence[i].region]++] = incidence[i].portal;
        free(fill);
    }

    // Region adjacency, deduplicated by (region, neighbor) sort.
    RegionEdge *edges = (RegionEdge *)malloc(
        (size_t)(incidence_count ? incidence_count : 1) * sizeof(RegionEdge));
    if (!edges) {
        free(keys); free(cell_region); free(counts); free(cursor); free(incidence);
        return fail(error, error_size, "regions: out of memory") ? -1 : -1;
    }
    int edge_count = 0;
    for (int p = 0; p < portal_count; p++) {
        const int ra = cell_region[portals[p].cell_a];
        const int rb = cell_region[portals[p].cell_b];
        if (ra == rb) continue;
        edges[edge_count++] = (RegionEdge){ra, rb};
        edges[edge_count++] = (RegionEdge){rb, ra};
    }
    qsort(edges, (size_t)edge_count, sizeof(RegionEdge), compare_edges);
    memset(counts, 0, (size_t)region_count * sizeof(int));
    for (int i = 0; i < edge_count; i++) {
        if (i && edges[i].region == edges[i - 1].region &&
            edges[i].neighbor == edges[i - 1].neighbor)
            continue;
        counts[edges[i].region]++;
    }
    offset = 0;
    for (int r = 0; r < region_count; r++) {
        out->region_adj_offsets[r] = offset;
        out->regions[r].first_neighbor = offset;
        out->regions[r].neighbor_count = counts[r];
        offset += counts[r];
    }
    out->region_adj_offsets[region_count] = offset;
    {
        int *fill = (int *)calloc((size_t)region_count, sizeof(int));
        if (!fill) {
            free(keys); free(cell_region); free(counts); free(cursor);
            free(incidence); free(edges);
            return fail(error, error_size, "regions: out of memory") ? -1 : -1;
        }
        for (int i = 0; i < edge_count; i++) {
            if (i && edges[i].region == edges[i - 1].region &&
                edges[i].neighbor == edges[i - 1].neighbor)
                continue;
            out->region_adj_refs[out->region_adj_offsets[edges[i].region] +
                                 fill[edges[i].region]++] = edges[i].neighbor;
        }
        free(fill);
    }
    free(edges);
    free(incidence);
    free(counts);
    free(cursor);
    free(keys);
    free(cell_region);

    if (!build_pvs(out, portals, portal_count))
        return fail(error, error_size, "regions: PVS allocation failed") ? -1 : -1;
    out->metrics.unloaded_count = region_count;
    return region_count;
}

int r2d_world_region_at(const R2DWorldRegionSet *set, float x, float y)
{
    if (!set || !set->regions || set->region_count <= 0 ||
        !isfinite(x) || !isfinite(y) || !(set->region_size > 0.0f))
        return -1;
    const int col = (int)floorf((x - set->origin_x) / set->region_size);
    const int row = (int)floorf((y - set->origin_y) / set->region_size);
    if (col < 0 || col >= set->columns || row < 0 || row >= set->rows) return -1;
    const int key = row * set->columns + col;
    int lo = 0, hi = set->region_count - 1;
    while (lo <= hi) {
        const int mid = lo + (hi - lo) / 2;
        const int mid_key = set->regions[mid].row * set->columns +
                            set->regions[mid].col;
        if (mid_key == key) return mid;
        if (mid_key < key) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
}

bool r2d_world_region_visible(const R2DWorldRegionSet *set,
                              int from_region, int to_region)
{
    if (!set || !set->pvs || set->region_count <= 0 || set->pvs_words <= 0)
        return false;
    if (from_region < 0 || from_region >= set->region_count ||
        to_region < 0 || to_region >= set->region_count)
        return false;
    return (set->pvs[(size_t)from_region * set->pvs_words + (to_region >> 6)] &
            (1ull << (to_region & 63))) != 0;
}

bool r2d_world_region_rebuild_pvs(R2DWorldRegionSet *set,
                                  const R2DWorldRegionPortal *portals,
                                  int portal_count)
{
    if (!set || !portals || portal_count != set->portal_count)
        return false;
    return build_pvs(set, portals, portal_count);
}

static int ring_distance(const R2DWorldRegionSet *set, int region, int center)
{
    const int dc = abs(set->regions[region].col - set->regions[center].col);
    const int dr = abs(set->regions[region].row - set->regions[center].row);
    return dc > dr ? dc : dr;
}

int r2d_world_region_update_active(R2DWorldRegionSet *set, int center_region,
                                   int active_radius, int preload_radius,
                                   uint8_t *states, int state_capacity,
                                   int *active, int active_capacity,
                                   int *preload, int preload_capacity)
{
    if (!set || set->region_count <= 0 || center_region < 0 ||
        center_region >= set->region_count || !states ||
        state_capacity < set->region_count)
        return -1;
    if (active_radius < 0) active_radius = 0;
    if (preload_radius < active_radius) preload_radius = active_radius;
    if (active_radius > R2D_WORLD_REGION_MAX_RING)
        active_radius = R2D_WORLD_REGION_MAX_RING;
    if (preload_radius > R2D_WORLD_REGION_MAX_RING)
        preload_radius = R2D_WORLD_REGION_MAX_RING;

    int active_count = 0, preload_count = 0;
    memset(&set->metrics, 0, sizeof set->metrics);
    for (int r = 0; r < set->region_count; r++) {
        const int ring = ring_distance(set, r, center_region);
        uint8_t next;
        if (ring <= active_radius) {
            next = R2D_WORLD_REGION_ACTIVE;
            if (active && active_count < active_capacity) active[active_count] = r;
            active_count++;
            set->metrics.active_count++;
        } else if (ring <= preload_radius) {
            next = states[r] == R2D_WORLD_REGION_RESIDENT
                 ? R2D_WORLD_REGION_RESIDENT : R2D_WORLD_REGION_PRELOADING;
            if (preload && preload_count < preload_capacity) preload[preload_count] = r;
            preload_count++;
            if (next == R2D_WORLD_REGION_PRELOADING)
                set->metrics.preloading_count++;
            else
                set->metrics.resident_count++;
        } else if (r2d_world_region_visible(set, center_region, r)) {
            next = R2D_WORLD_REGION_SLEEPING;
            set->metrics.sleeping_count++;
        } else {
            next = R2D_WORLD_REGION_UNLOADED;
            set->metrics.unloaded_count++;
        }
        states[r] = next;
    }
    set->metrics.preload_count = preload_count;
    set->metrics.visible_regions = active_count + preload_count;
    set->metrics.culled_regions = set->region_count - set->metrics.visible_regions;
    return active_count;
}

int r2d_world_region_stream(R2DWorldRegionSet *set, uint8_t *states,
                            int state_capacity, int budget)
{
    if (!set || !states || state_capacity < set->region_count || budget < 0)
        return -1;
    int changes = 0;
    for (int r = 0; r < set->region_count; r++) {
        if (states[r] == R2D_WORLD_REGION_PRELOADING && changes < budget) {
            states[r] = R2D_WORLD_REGION_RESIDENT;
            changes++;
        } else if (states[r] == R2D_WORLD_REGION_SLEEPING && changes < budget) {
            states[r] = R2D_WORLD_REGION_UNLOADED;
            changes++;
        }
    }
    return changes;
}

bool r2d_world_region_local(const R2DWorldRegionSet *set, int region,
                            float world_x, float world_y,
                            float *local_x, float *local_y)
{
    if (!set || !set->regions || region < 0 || region >= set->region_count ||
        !local_x || !local_y || !isfinite(world_x) || !isfinite(world_y))
        return false;
    const R2DWorldRegion *r = &set->regions[region];
    *local_x = world_x - (r->x + r->w * 0.5f);
    *local_y = world_y - (r->y + r->h * 0.5f);
    return true;
}

void r2d_world_region_lod(float distance, R2DWorldRegionLod *out)
{
    if (!out) return;
    if (!isfinite(distance) || distance < 0.0f) distance = 0.0f;
    if (distance <= 600.0f) {
        *out = (R2DWorldRegionLod){16, 60, 1, 100, false, false};
    } else if (distance <= 1500.0f) {
        *out = (R2DWorldRegionLod){8, 15, 1, 100, false, false};
    } else if (distance <= 3000.0f) {
        *out = (R2DWorldRegionLod){4, 8, 0, 50, true, false};
    } else if (distance <= 6000.0f) {
        *out = (R2DWorldRegionLod){1, 5, 0, 20, true, false};
    } else {
        *out = (R2DWorldRegionLod){0, 0, 0, 0, true, true};
    }
}
