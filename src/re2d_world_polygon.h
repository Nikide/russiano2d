#pragma once
// ===========================================================================
// Re2D: authoring-side polygon validation and convex decomposition.
//
// This module is COMPILER INPUT ONLY. It validates a 2D authoring ring, splits
// a concave ring into convex rings, and reports shared undirected edges between
// two rings. It never builds a runtime mesh and it is not linked into the
// public runtime API: the Re2D runtime still consumes axis-aligned cells,
// spans, walls and portals. Polygons exist here only long enough for the map
// compiler to turn them into those constrained primitives.
//
// No malloc, no globals, no file/OS access. All working storage is fixed-size
// stack storage bounded by R2D_WORLD_POLYGON_MAX_POINTS, and all output goes
// into caller-provided arrays.
//
// Ring representation
// -------------------
// A ring is an ordered point array; the closing edge (last -> first) is
// implicit. Rings must be simple (no self-intersection) and have non-zero
// area. Both CCW and CW input are accepted; decomposition normalises each
// convex output ring to CCW. Holes are NOT supported: one ring is one solid
// polygon. Multi-ring sets are supported only as separate solids.
//
// Validation rules
// ----------------
// r2d_world_polygon_valid() requires:
//   * non-NULL points, count in [3, R2D_WORLD_POLYGON_MAX_POINTS];
//   * every coordinate finite;
//   * no consecutive duplicates (distance <= R2D_WORLD_POLYGON_EPSILON);
//   * non-zero winding/area (no degenerate ring);
//   * no self-intersection or self-touch between non-adjacent edges.
// Collinear vertices are accepted by validation (they are still simple), but
// decomposition removes them. Decomposition is deliberately more forgiving:
// it removes consecutive duplicates and redundant collinear vertices before
// ear clipping, so an authored ring with a doubled or collinear vertex still
// decomposes when the cleaned ring is valid. Non-consecutive duplicate points
// are self-touch and are rejected by both validation and decomposition.
//
// Epsilon defaults
// ----------------
// R2D_WORLD_POLYGON_EPSILON (1e-5 world units) is the fixed tolerance for
// duplicate vertices, collinear-turn detection, degenerate area and
// self-intersection touches. r2d_world_polygon_shared_edges() takes an
// explicit caller epsilon instead; endpoints match when their euclidean
// distance is <= epsilon (0 matches exact endpoints only).
//
// Decomposition output
// --------------------
// Ear clipping is O(n^2) and deterministic: ears are considered in ascending
// ring order, so the same input always produces the same parts. Output parts
// are convex rings of 3..n vertices:
//   * an already convex ring becomes ONE part containing all cleaned vertices;
//   * a concave ring becomes n-2 triangles (the ear-clipping bound).
// Each part's vertices are copied contiguously into the caller's point buffer;
// R2DWorldPolygon.first/count index that buffer. Concave n-gons therefore use
// exactly 3*(n-2) output points; convex rings use n. A sizing call with zero
// capacities returns the required part count and required point count.
//
// Shared edges
// ------------
// r2d_world_polygon_shared_edges() compares every edge of A with every edge of
// B as an undirected segment. It counts endpoint-matched pairs, so the result
// is symmetric. This is the compiler's manifold test for adjacent authored
// polygons: 0 = not adjacent, 1 = one shared boundary, >1 = suspicious.
// ===========================================================================
#include <stdbool.h>
#include <stddef.h>

#define R2D_WORLD_POLYGON_MAX_POINTS 1024
#define R2D_WORLD_POLYGON_EPSILON 1e-5f

typedef struct {
    float x, y;
} R2DWorldPoint;

// A contiguous span [first, first+count) in a point buffer.
typedef struct {
    int first;
    int count;
} R2DWorldPolygon;

// Convenience view for a decomposed result. The module itself writes points
// and rings through explicit arguments so capacities stay visible; callers may
// use this struct to carry the two arrays together.
typedef struct {
    R2DWorldPoint *points;
    int point_count;
    R2DWorldPolygon *rings;
    int ring_count;
} R2DWorldPolygonSet;

// Shoelace winding of the input ring: +1 CCW, -1 CW, 0 degenerate/invalid.
int r2d_world_polygon_winding(const R2DWorldPoint *points, int point_count);

// Strict validation for compilation. On failure writes a short ASCII message
// into error (when error != NULL and error_size > 0) and returns false.
// Success clears error[0].
bool r2d_world_polygon_valid(const R2DWorldPoint *points, int point_count,
                             char *error, size_t error_size);

// Convex decomposition into caller-provided arrays.
//   rings/ring_capacity       - output part ring spans
//   out_points/point_capacity - output ring vertices, packed in part order
//   out_point_count           - optional; receives required/actual vertex count
// Returns the required part count (>= 1) on valid input and writes outputs only
// when both capacities are sufficient. A call with ring_capacity == 0 and
// point_capacity == 0 is the sizing pass. Returns -1 on invalid arguments or an
// invalid/degenerate/self-intersecting ring. Output is deterministic.
int r2d_world_polygon_decompose(const R2DWorldPoint *points, int point_count,
                                R2DWorldPolygon *rings, int ring_capacity,
                                R2DWorldPoint *out_points, int point_capacity,
                                int *out_point_count,
                                char *error, size_t error_size);

// Number of endpoint-matched undirected edges between two rings.
// Returns -1 for NULL arrays, counts outside [3, MAX], non-finite points or
// invalid epsilon.
int r2d_world_polygon_shared_edges(const R2DWorldPoint *a, int a_count,
                                   const R2DWorldPoint *b, int b_count,
                                   float epsilon);

// Bounds for compiler diagnostics. Returns false for invalid arguments,
// counts outside [3, MAX] or non-finite coordinates. Outputs are untouched on
// failure.
bool r2d_world_polygon_bounds(const R2DWorldPoint *points, int point_count,
                              float *minx, float *miny,
                              float *maxx, float *maxy);

// Absolute shoelace area. Returns 0 for invalid arguments or degenerate rings.
float r2d_world_polygon_area(const R2DWorldPoint *points, int point_count);
