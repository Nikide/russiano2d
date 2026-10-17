#pragma once
// ===========================================================================
// Re2D: constrained planar portal visual math (mirror / link / sky).
//
// Pure C, allocation-free and deterministic. This layer only computes poses and
// yaw angles for Re2D portal visuals; it never renders, touches the world, or
// builds a general 3D matrix. Re2D portal rules (roadmap sections 12, 52):
// translation and optional yaw rotation, SAME scale, planar wall mirrors only.
//
// A portal is stored as the 2D segment A->B. The segment direction gives its
// local frame; all functions reject non-finite values and zero-length segments.
//
// MIRROR: planar reflection across the infinite line through A->B. The point is
//   reflected and the yaw is mirrored (out_yaw = 2*segment_angle - yaw), so the
//   transform is a rigid isometry: distances between reflected points are
//   preserved exactly (up to float rounding).
//
// LINK: maps portal A's midpoint onto portal B's midpoint. The offset from A's
//   midpoint and the yaw are rotated by angle(B)-angle(A). If B.yaw_only is
//   true, the position offset is NOT rotated and only yaw is rotated by that
//   delta (translation-only body, yaw-adjusted view). Segment lengths are never
//   used for scaling; authored portals that differ in length are still mapped
//   with a rigid midpoint/rotation transform.
//
// SKY: yaw-only panorama direction mapping. The segment direction is added to
//   the incoming yaw; no position output exists. Invalid input writes 0.
//
// All yaw outputs are normalised to [-pi, pi]; -pi is represented as +pi.
// Outputs are written only on success (failure leaves them untouched), except
// the void sky function which writes 0 for invalid input.
// ===========================================================================
#include <stdbool.h>

enum {
    R2D_PORTAL_VISUAL_LINK = 0,
    R2D_PORTAL_VISUAL_MIRROR = 1,
    R2D_PORTAL_VISUAL_SKY = 2
};

typedef struct {
    int kind;            // R2D_PORTAL_VISUAL_*
    float ax, ay;        // portal segment start
    float bx, by;        // portal segment end, must differ from start
    int max_depth;       // recursion hint, clamped to 1..4 by recursion_push
    bool yaw_only;       // LINK: rotate yaw but not the position offset
} R2DWorldPortalVisual;

typedef struct {
    float x, y, yaw;     // yaw in radians
} R2DWorldPortalPose;

// Planar mirror reflection of a pose across the MIRROR portal's A->B line.
// Returns false for NULL/invalid inputs (wrong kind, zero-length or non-finite
// segment, non-finite pose/output pointers).
bool r2d_world_portal_reflect(const R2DWorldPortalVisual *portal,
                              float x, float y, float yaw,
                              float *out_x, float *out_y, float *out_yaw);

// Rigid (translation + optional yaw) mapping from LINK portal A to LINK
// portal B. See the LINK rule above.
bool r2d_world_portal_linked_pose(const R2DWorldPortalVisual *from,
                                  const R2DWorldPortalVisual *to,
                                  float x, float y, float yaw,
                                  float *out_x, float *out_y, float *out_yaw);

// SKY yaw mapping: out_yaw = normalize(yaw + segment_angle(from->to)).
// out_yaw==NULL is ignored. Invalid portal/kind/non-finite yaw writes 0.
void r2d_world_portal_sky_yaw(const R2DWorldPortalVisual *portal,
                              float yaw, float *out_yaw);

// Bounded portal recursion with cycle detection. `stack` holds portal ids in
// traversal order; `depth` is the current number of entries; `max_depth` is
// clamped into 1..4 on every push. push() returns false when the child id is
// already on the stack (cycle) or the clamped budget is reached. pop() removes
// the last entry; pop on an empty stack is a no-op. contains() is NULL-safe.
typedef struct {
    int stack[8];
    int depth, max_depth;
} R2DWorldPortalRecursion;

bool r2d_world_portal_recursion_push(R2DWorldPortalRecursion *recursion, int portal_id);
void r2d_world_portal_recursion_pop(R2DWorldPortalRecursion *recursion);
bool r2d_world_portal_recursion_contains(const R2DWorldPortalRecursion *recursion,
                                         int portal_id);
