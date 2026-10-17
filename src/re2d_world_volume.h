#pragma once
// ===========================================================================
// Re2D: constrained volumetric sprite geometry/selection (P2).
//
// A "volume" is still a Re2DSprite: a bounded set of authored sprite planes,
// never a mesh. This layer only answers WHICH specialised planes are visible
// and where their centres sit. It deliberately has no vertex/index API, no
// renderer state, no allocation and no globals. The renderer owns textures,
// batching and final compositing.
//
// Modes
// -----
// BOX          up to four visible faces (two XY sides plus optional top/bottom)
//              selected from the camera position around the actor.
// CROSS        two perpendicular camera-facing planes. parts() emits two arms
//              (FRONT and RIGHT); the renderer rotates both by
//              r2d_world_volume_cross_angle().
// SLICE_STACK  N horizontal bands evenly spaced through the actor height. Each
//              part's face is the slice index (0..N-1), scale is the normalized
//              band height (1/N), and depth_bias is the absolute world height of
//              the band centre (world_z + (slice+0.5)*height/N).
//
// Part ordering is deterministic and front-to-back: ascending depth_bias, ties
// broken by face id, then by emission order. For BOX depth_bias is the negative
// projection of the face centre onto the actor->camera direction, so the face
// nearest the camera sorts first. Offsets are world units from the actor origin
// on the XY plane; scale is a multiplier on the authored plane (1 = full size).
// All functions are NULL-safe.
// ===========================================================================
#include <stdbool.h>
#include <stdint.h>

enum { R2D_VOLUME_BOX=0, R2D_VOLUME_CROSS=1, R2D_VOLUME_SLICE_STACK=2 };
enum { R2D_VOLUME_FACE_FRONT=0, R2D_VOLUME_FACE_BACK=1, R2D_VOLUME_FACE_LEFT=2,
       R2D_VOLUME_FACE_RIGHT=3, R2D_VOLUME_FACE_TOP=4, R2D_VOLUME_FACE_BOTTOM=5 };

// Optional box faces. Default flags=0 emits only the two XY side faces.
enum { R2D_VOLUME_FLAG_TOP=1u<<0, R2D_VOLUME_FLAG_BOTTOM=1u<<1 };
enum { R2D_VOLUME_SLICES_MIN=1, R2D_VOLUME_SLICES_MAX=32 };

typedef struct { int mode; float width,depth,height; int slices; uint32_t flags; } R2DWorldVolume;

typedef struct {
    int face;             // R2D_VOLUME_FACE_* for BOX/CROSS; slice index for SLICE_STACK
    float offset_x,offset_y; // plane centre offset from the actor origin, world units
    float scale;          // multiplier on the authored plane (slice stack: 1/N)
    float depth_bias;     // front-to-back key (BOX: negative camera projection;
                          // SLICE_STACK: absolute band-centre height)
    bool flip;            // horizontal mirror hint; always false for these modes
} R2DWorldVolumePart;

// Camera-relative selection. Returns the total number of parts the mode requires
// (which may exceed capacity; only the nearest `capacity` parts are written), or
// -1 for invalid input (NULL volume, non-finite camera/actor data, capacity<0,
// non-positive/non-finite dimensions, unknown mode, or SLICE_STACK slices
// outside 1..32). out may be NULL to query the total. Valid total: BOX <= 4,
// CROSS == 2, SLICE_STACK == slices.
int r2d_world_volume_parts(const R2DWorldVolume*,float world_x,float world_y,float world_z,
                           float camera_x,float camera_y,float camera_z,float camera_yaw,
                           R2DWorldVolumePart *out,int capacity);

// Number of slices for a valid SLICE_STACK volume, else 0.
int r2d_world_volume_slice_count(const R2DWorldVolume*);

// Fill one slice part. Invalid volume/mode/slice or non-finite world_z zeroes
// *out (when non-NULL) and writes nothing useful.
void r2d_world_volume_slice_part(const R2DWorldVolume*,int slice,float world_z,R2DWorldVolumePart*);

// Signed relative angle (actor_facing - camera_yaw) wrapped to [-pi,pi].
// Invalid/NULL volume or non-finite angles return 0. The renderer draws the
// cross arms at this angle and this angle + pi/2.
float r2d_world_volume_cross_angle(const R2DWorldVolume*,float actor_facing,float camera_yaw);

// Hit proxy: constrained XY circle + vertical interval, never pixels. When
// `hit` is NULL the conservative bounds are derived from the volume box
// (circumscribed XY radius, bottom 0, top height). When supplied, `hit` must be
// finite with radius>0 and top>bottom; its values are returned unchanged and
// `zones` is a caller count hint only (it never encodes per-pixel geometry).
// Returns false and zeroes the outputs on invalid input.
typedef struct { float radius,bottom,top; int zones; } R2DWorldVolumeHit;
bool r2d_world_volume_hit(const R2DWorldVolume*,const R2DWorldVolumeHit*,float *radius,float *bottom,float *top);
