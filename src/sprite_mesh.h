#ifndef R2D_SPRITE_MESH_H
#define R2D_SPRITE_MESH_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* A generated vertex matches engine.submitMesh's eight-float vertex layout:
 * screen/world x,y, depth, texture u,v and RGB. Positions are sprite-local;
 * the caller applies its existing Transform and camera projection. */
typedef struct R2DSpriteMeshRect { int x, y, w, h; } R2DSpriteMeshRect;
typedef struct R2DSpriteMeshDesc {
    float depth;
    float units_per_pixel;
    float pivot_x, pivot_y; /* source pixel coordinates within this frame */
    uint8_t alpha_threshold;
} R2DSpriteMeshDesc;
typedef struct R2DSpriteMesh {
    float *vertices; /* 8 floats per vertex, triangle list */
    uint32_t vertex_count;
    uint32_t opaque_pixels;
} R2DSpriteMesh;

typedef struct R2DSpriteMeshFrameInput {
    R2DSpriteMeshRect rect;
    float pivot_x, pivot_y;
} R2DSpriteMeshFrameInput;
typedef struct R2DSpriteMeshCache {
    uint64_t source_hash, layout_hash, settings_hash;
    uint32_t frame_count;
    R2DSpriteMesh *frames;
} R2DSpriteMeshCache;

/* Returns false on invalid bounds, overflow, or allocation failure. Frame
 * bounds are applied to every neighbor query so atlas-adjacent frames cannot
 * suppress one another's side walls. The output must be freed with destroy. */
bool r2d_sprite_mesh_build(const uint8_t *rgba, int texture_width,
                           int texture_height, R2DSpriteMeshRect frame,
                           const R2DSpriteMeshDesc *desc,
                           R2DSpriteMesh *out);
void r2d_sprite_mesh_destroy(R2DSpriteMesh *mesh);
bool r2d_sprite_mesh_build_all(const uint8_t *rgba, int texture_width,
                               int texture_height,
                               const R2DSpriteMeshFrameInput *frames,
                               uint32_t frame_count,
                               const R2DSpriteMeshDesc *defaults,
                               uint64_t source_hash, uint64_t layout_hash,
                               uint64_t settings_hash,
                               R2DSpriteMeshCache *out);
void r2d_sprite_mesh_cache_destroy(R2DSpriteMeshCache *cache);
bool r2d_sprite_mesh_cache_valid(const R2DSpriteMeshCache *cache,
                                 uint64_t source_hash, uint64_t layout_hash,
                                 uint64_t settings_hash, uint32_t frame_count);
/* Portable little-endian cache payload (magic + version + identity + frames).
 * Caller frees encoded bytes with free(); decoded cache with cache_destroy. */
bool r2d_sprite_mesh_cache_encode(const R2DSpriteMeshCache *cache,
                                  uint8_t **bytes, size_t *size);
bool r2d_sprite_mesh_cache_decode(const uint8_t *bytes, size_t size,
                                  R2DSpriteMeshCache *out);

#endif
