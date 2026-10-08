#pragma once
#include "bsp.h"
#include "re2d_math.h"
#include <stdint.h>

// Specialised RE2D authoring primitives, never a triangle mesh.
typedef struct { float x1,y1,x2,y2,bottom,top; uint32_t color; } R2DWorldWall;
typedef struct { float x,y,w,h,bottom,top; uint32_t floor_color,ceiling_color; } R2DWorldSpan;
typedef struct {
    R2DBsp bsp;
    R2DWorldWall *walls;
    R2DWorldSpan *spans;
    int wall_count,span_count;
} R2DRe2dWorld;
typedef struct { float t,x,y,height; int wall,span; bool ceiling; uint32_t color; } R2DWorldHit;

// Zero-initialise before first build; failed build leaves the old world intact.
bool r2d_world_build(R2DRe2dWorld *, const R2DWorldWall *, int, const R2DWorldSpan *, int);
void r2d_world_free(R2DRe2dWorld *);
// Highest support not above feet + step and with sufficient headroom.
int r2d_world_support(const R2DRe2dWorld *, float x,float y,float feet,float height,float step);
bool r2d_world_blocked(const R2DRe2dWorld *, float x,float y,float radius,float bottom,float top);
// Parametric ray: origin + direction*t, with explicit near/far. XY BSP traversal.
bool r2d_world_ray(const R2DRe2dWorld *, const float origin[3],const float direction[3],float near_t,float far_t,R2DWorldHit *);
// Final ordinary RGBA8 image plus PRIVATE synthesis depth; no GPU world geometry.
// ortho_height>0 selects orthographic projection; otherwise perspective.
void r2d_world_frame(const R2DRe2dWorld *, const R2DRe2dView *,int w,int h,uint8_t *rgba,float *depth,float ortho_height);
// Compose an already synthesised ordinary 2D sprite at projected depth.
void r2d_world_stamp(const R2DRe2dView *,int w,int h,uint8_t *rgba,float *depth,
                     const uint8_t *sprite,int size,float x,float y,float bottom,float width,float height,float ortho_height);
