#pragma once
// ===========================================================================
// Re2D: PolyWallGroup core (P1/P3, roadmap sections 11/90/103).
//
// A PolyWallGroup is NOT a mesh object and NOT a scene-graph node. It is a
// bounded, authored set of upright world wall segments (2D line segments plus
// the constrained height interval [bottom,top]) that share one rigid XY
// transform: rotation around a pivot followed by translation. Heights never
// change. There is no 3D rotation, no scaling, no shear, no ECS and no
// allocation here; the caller owns all arrays.
//
// This module is pure data preparation for collision/trace/BSP/visibility:
// transform authored segments, compute group bounds, sweep a moving circle, and
// sample deterministic timeline transforms. It does not own the world, mutate
// map data, emit events, or draw anything.
//
// Semantics (exact)
// ----------------
// * transform: for angle rotation (radians) and pivot p, a point q maps to
//       d = q - p
//       out = p + (tx,ty) + Rot(rotation) * d
//   which is a rigid isometry: distances and segment lengths are preserved
//   (up to float rounding). The pivot itself maps to pivot + (tx,ty).
//   rotation is evaluated modulo 2*pi. All inputs must be finite; the void
//   point transform is a no-op on invalid input or NULL out pointers.
// * apply: transforms only x1,y1,x2,y2; bottom/top are copied unchanged.
//   out may alias the input array (in-place transform). Invalid transform,
//   NULL arrays, count <= 0 or any non-finite segment field returns false and
//   writes nothing.
// * bounds: axis-aligned bounds over transformed segment endpoints in XY; the
//   height interval is not part of the 2D bounds. Requires count >= 1, finite
//   segments and non-NULL outputs; returns false otherwise without writing.
// * sweep: 2D swept circle (a point moving along from -> to against every
//   segment thickened by radius; a capsule). It is a 2D query: bottom/top are
//   validated but not filtered here; a runtime can reject by height after the
//   hit. Returns the earliest hit fraction in [0,1], or -1 on a miss/invalid
//   arguments. Starting already touching/overlapping (distance <= radius)
//   returns fraction 0. Otherwise the first boundary crossing is reported.
//   fraction 0 means "at from", 1 means "at to". The hit normal is a unit
//   normal pointing from the wall/capsule toward the moving circle center at
//   the hit; for an exact radius-0 endpoint hit it falls back to the direction
//   opposite motion. Exact ties are resolved by the first segment in array
//   order (deterministic). If `out_hit` is NULL the fraction is still returned.
//   On a miss `out_hit` is left untouched. radius must be finite and >= 0.
// * lerp: deterministic timeline sampling. tx,ty,pivot_x,pivot_y are linear;
//   rotation uses the shortest normalized arc (normalized to (-pi,pi]), then
//   the result is normalized again. fraction is clamped to 0..1; endpoints
//   reproduce the normalized from/to transforms exactly. Non-finite inputs are
//   a no-op (void). There is no easing beyond linear.
// * Determinism: no globals, no clocks, no randomness, no malloc/free; every
//   result is a pure function of the arguments, and finite inputs never read
//   past segments[0..count).
// ===========================================================================
#include <stdbool.h>

typedef struct {
    float x1, y1, x2, y2; // authored 2D wall segment
    float bottom, top;    // constrained height interval, never transformed
} R2DWorldPolyWallSegment;

typedef struct {
    float tx, ty;         // XY translation applied after rotation
    float rotation;       // yaw/2D rotation in radians around the pivot
    float pivot_x, pivot_y;
} R2DWorldPolyWallTransform;

typedef struct {
    R2DWorldPolyWallSegment *segments; // borrowed caller storage
    int count;
    float minx, miny, maxx, maxy;      // cached XY bounds (filled by caller)
} R2DWorldPolyWallGroup;

// Transform one point by rotation around the pivot + translation.
// Invalid/NULL input leaves *out_x/*out_y untouched.
void r2d_world_polywall_transform_point(const R2DWorldPolyWallTransform *transform,
                                        float x, float y, float *out_x, float *out_y);

// Transform endpoints and copy heights. Returns false on invalid input.
// Supports out == segments for an in-place transform.
bool r2d_world_polywall_apply(const R2DWorldPolyWallTransform *transform,
                              const R2DWorldPolyWallSegment *segments, int count,
                              R2DWorldPolyWallSegment *out);

// Compute XY bounds over segment endpoints. Returns false on invalid input.
bool r2d_world_polywall_bounds(const R2DWorldPolyWallSegment *segments, int count,
                               float *minx, float *miny, float *maxx, float *maxy);

typedef struct {
    float fraction; // 0..1 along from -> to
    float nx, ny;   // unit normal from wall toward the moving circle
    int segment;    // authored index
} R2DWorldPolyWallHit;

// Sweep a circle of `radius` along from -> to against the segments.
// Returns nearest fraction 0..1, or -1 on miss/invalid arguments.
float r2d_world_polywall_sweep(const R2DWorldPolyWallSegment *segments, int count,
                               float from_x, float from_y, float to_x, float to_y,
                               float radius, R2DWorldPolyWallHit *out_hit);

// Sample a deterministic transform between two timeline transforms.
// fraction is clamped to 0..1; rotation follows the shortest normalized arc.
void r2d_world_polywall_lerp(const R2DWorldPolyWallTransform *from,
                             const R2DWorldPolyWallTransform *to,
                             float fraction, R2DWorldPolyWallTransform *out);
