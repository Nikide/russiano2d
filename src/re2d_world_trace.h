#pragma once
// ===========================================================================
// Re2D: unified trace over the static world plus caller-owned actor proxies.
//
// This is deliberately NOT a physics engine and NOT a 3D scene query. Geometry
// stays the constrained Re2D layer: walls/spans are resolved by the existing
// r2d_world_ray(), while actors are vertical cylinders (XY circle + height
// interval) supplied by the caller. No allocation, no globals, no mesh/3D
// types, deterministic ordering.
//
// Hit categories and mask rule
// ----------------------------
// A proxy carries an integer category. The mask matches a proxy when
//   (mask & (1 << category)) || (mask & category)
// is non-zero (the shift term is skipped for categories outside 0..30). This is
// the intentionally simple rule requested by the trace design: category 0/1/2
// select WORLD/ENEMY/BREAKABLE through the shifted bit, and a caller may also
// pass a value that already contains the enum bit directly. Example: category 2
// matches masks with either bit 2 (1<<1, ENEMY) or bit 4 (1<<2, BREAKABLE),
// because the two terms are OR-ed; callers that need strictly one small
// category should use categories 0/1/2 and rely on the shifted term. Static
// world geometry is considered only when (mask & R2D_WORLD_TRACE_WORLD) is set.
// ===========================================================================
#include "re2d_world.h"
#include <stdbool.h>
#include <stdint.h>

enum { R2D_WORLD_TRACE_NONE=0, R2D_WORLD_TRACE_SURFACE=1, R2D_WORLD_TRACE_SPRITE=2 };
enum { R2D_WORLD_TRACE_WORLD=1, R2D_WORLD_TRACE_ENEMY=2, R2D_WORLD_TRACE_BREAKABLE=4 };

// XY circle footprint + vertical interval. node is an opaque caller id.
typedef struct { float x,y,bottom,top,radius; int category; int node; } R2DWorldHitProxy;

typedef struct {
    int type;            // R2D_WORLD_TRACE_* of the nearest hit
    float fraction;      // 0..1 along from->to
    float x,y,h;         // world-space hit point
    int surface,span;    // world wall index / span index when type==SURFACE, else -1
    int proxy,node;      // proxy index / node id when type==SPRITE, else -1
    float nx,ny;         // XY normal pointing back toward the ray origin
} R2DWorldTraceResult;

// Nearest hit against world geometry (r2d_world_ray) and actor proxies, filtered by
// mask (bitwise OR of category bits) and ignoring one proxy index (-1 = ignore none).
// Returns false for invalid input or no hit. Invalid input: NULL world/from/to/out,
// non-finite coordinates, proxy_count<0, NULL proxies with proxy_count>0,
// ignore_proxy<-1. A NULL world is not accepted; this layer never owns geometry.
//
// Normal convention: wall hits use the wall's XY perpendicular, flipped to face
// the ray origin; proxy hits use the outward radial direction at the entry
// point, flipped to face the origin. Hits on horizontal floor/ceiling planes
// (including sloped spans) report a zero XY normal (nx=ny=0) because the true
// normal of such a plane is dominantly vertical and inexpressible here.
// Tangential proxy contact is treated as a miss (see r2d_world_proxy_sweep).
bool r2d_world_trace_ray(const R2DRe2dWorld *world, const R2DWorldHitProxy *proxies, int proxy_count,
                         const float from[3], const float to[3], int mask, int ignore_proxy,
                         R2DWorldTraceResult *out);

// All hits (world + proxies) sorted near-to-far, fraction ascending; ties broken
// deterministically (world before sprite at identical fraction; otherwise input
// order). Returns number of hits that matched (may exceed capacity; still writes
// the nearest capacity hits) or -1 on invalid input. out may be NULL to query
// the count (capacity is then ignored). capacity<0 is invalid. mask/ignore_proxy
// as above.
int r2d_world_trace_collect(const R2DRe2dWorld *world, const R2DWorldHitProxy *proxies, int proxy_count,
                            const float from[3], const float to[3], int mask, int ignore_proxy,
                            R2DWorldTraceResult *out, int capacity);

// Circle sweep segment test against one vertical cylinder proxy. Returns entry
// fraction 0..1, or -1 if missed. Broad-phase radius test, then exact quadratic
// on the XY segment against (proxy.radius + radius); the swept object's vertical
// interval [bottom,top] must overlap the proxy interval (touching does not
// overlap). A sweep starting inside the footprint returns 0. Tangential contact
// is a miss. Invalid/non-finite input, radius<0, top<bottom and non-positive or
// non-finite proxy radius all return -1.
float r2d_world_proxy_sweep(const R2DWorldHitProxy *proxy, float from_x, float from_y, float to_x, float to_y,
                            float radius, float bottom, float top);
