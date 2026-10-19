#pragma once
#include <stdbool.h>
#include <stdint.h>

// Constrained "atlas world sprite" support for Re2D World.
//
// A world atlas sprite is an existing `$` node with a flat directional atlas PNG
// (columns = viewing directions, rows = animation states). It is NOT a mesh and
// NOT a generic 3D object: the renderer crops one cell of the authored atlas,
// places an authored pivot point at the node's world depth and composites the
// cell with world depth, light and fog. Direction selection and pivot math live
// in native C so game scripts do not run a projection loop per frame.
//
// These helpers are pure: no allocation, no globals, no engine state. The
// runtime owns the RGBA atlas image and the crop buffers.

typedef enum {
    R2D_WORLD_ATLAS_PIVOT_CENTER = 0,        // normalized (0.5, 0.5)
    R2D_WORLD_ATLAS_PIVOT_FEET = 1,          // normalized (0.5, 1.0), bottom-center
    R2D_WORLD_ATLAS_PIVOT_BOTTOM_CENTER = 2, // alias of FEET, kept for authored data
    R2D_WORLD_ATLAS_PIVOT_CUSTOM = 3         // authored normalized pivot
} R2DWorldAtlasPivot;

enum {
    R2D_WORLD_ATLAS_DIRECTIONS_MIN = 1,
    R2D_WORLD_ATLAS_DIRECTIONS_MAX = 16,
    R2D_WORLD_ATLAS_CELL_MIN = 1,
    R2D_WORLD_ATLAS_CELL_MAX = 1024,
    R2D_WORLD_ATLAS_TILE_LIMIT = 256
};

// Signed angle from the actor->camera vector to the actor facing direction.
// Result is in [-pi, pi]. facing 0 = +X; camera_to_actor_x/y is the raw or
// normalized vector camera->actor. Facing the camera yields 0.
float r2d_world_atlas_relative_yaw(float facing, float camera_to_actor_x, float camera_to_actor_y);

// Choose the atlas column for a relative yaw.
//
// directions >= 2 without mirror: sectors split the full circle evenly, column
// 0 is "facing the camera" (relative yaw 0) and the index advances clockwise.
// With mirror: the atlas covers 180 degrees in `directions` columns (0 = front,
// directions-1 = back) and the other half is drawn by horizontally mirroring;
// `flip` reports that the source cell must be mirrored.
//
// directions == 1 always selects column 0 with no flip. Out-of-range or
// non-finite input falls back to column 0 / no flip instead of trapping.
int r2d_world_atlas_direction(float relative_yaw, int directions, bool mirror, bool *flip);

// Choose the atlas column with an optional explicit override.
//
// Packed layered characters (legs/tail/torso/head flattened offline into one
// directional atlas) need a deterministic column driven by the game, not by the
// camera-relative facing: `node.sprite_col = dir` is cheap, updates every frame
// and is independent of the animation row. When `explicit` is true the authored
// column wins (clamped into [0, columns-1]) and no mirroring is applied; the
// relative-yaw direction selection is used otherwise. Out-of-range explicit
// columns are clamped, never trapped, so an animation cursor cannot read outside
// the atlas.
int r2d_world_atlas_column(bool explicit, int column, int columns,
                           float relative_yaw, int directions, bool mirror,
                           bool *flip);

// Source rectangle of one atlas cell. `column` and `row` are clamped into the
// atlas grid, so a bad animation row cannot read outside the image.
void r2d_world_atlas_cell(int column, int row, int columns, int rows,
                          int cell_w, int cell_h,
                          int *x, int *y, int *w, int *h);

// Normalized pivot inside the cell, (0,0) = top-left, (1,1) = bottom-right.
// Unknown pivot modes fall back to feet. Custom components are clamped to 0..1.
void r2d_world_atlas_pivot(int pivot, float custom_x, float custom_y,
                           float *out_x, float *out_y);

// Square buffer placement for one cell. The square always holds the whole cell
// at native pixel size; `dest_x`/`dest_y` are the cell origin inside the square
// and `pivot_sx`/`pivot_sy` are the pivot coordinates inside the square after
// clamping. The caller converts them to world offsets, so a feet pivot, a center
// pivot or an authored custom pivot all resolve exactly. Returns false for
// invalid cell/pivot input.
bool r2d_world_atlas_placement(int cell_w, int cell_h, float pivot_x, float pivot_y,
                               int *side, int *dest_x, int *dest_y,
                               float *pivot_sx, float *pivot_sy);

// Crop one cell into a transparent square RGBA8 buffer of side*side pixels.
// Horizontal flip implements mirrored directions. The destination rectangle is
// clipped against the square, so an extreme custom pivot never overruns it.
// Returns false on invalid arguments.
bool r2d_world_atlas_crop(const uint8_t *atlas, int atlas_w, int atlas_h,
                          int cell_x, int cell_y, int cell_w, int cell_h, bool flip,
                          int side, int dest_x, int dest_y, uint8_t *buffer);


// ---------------------------------------------------------------------------
// Shared decoded-image cache (path dedup) and tiled atlas sets.
// ---------------------------------------------------------------------------

// One decoded RGBA8 image, shared by every registration that resolved to the
// same canonical PNG path (and cache generation). Owned by the image cache.
typedef struct R2DWorldAtlasImage {
    char *canonical;      // app/VFS-resolved path, cache key
    char *authored;       // authored path (first registration), diagnostics
    uint8_t *pixels;      // width*height*4, owned by this entry
    int width, height;
    int refs;             // atlas registrations referencing it
    uint64_t generation;  // cache generation (hot reload/scene reload)
    int owner_stream_id;  // stream item that accounts the bytes (0 = none)
} R2DWorldAtlasImage;

typedef struct {
    R2DWorldAtlasImage **items;
    int count, capacity;
    uint64_t hits;        // dedup hits (acquire found a live image)
} R2DWorldAtlasImageCache;

// Finds a live image for canonical path in the current generation.
R2DWorldAtlasImage *r2d_world_atlas_image_find(const R2DWorldAtlasImageCache *cache,
                                               const char *canonical, uint64_t generation);
// Adds a newly decoded image (takes ownership of pixels/canonical/authored).
// Returns NULL on invalid input/OOM; on failure the caller still owns pixels.
R2DWorldAtlasImage *r2d_world_atlas_image_add(R2DWorldAtlasImageCache *cache,
                                              const char *canonical, const char *authored,
                                              uint8_t *pixels, int width, int height,
                                              uint64_t generation);
// Drops one reference; frees pixels and removes the entry at refs == 0.
void r2d_world_atlas_image_release(R2DWorldAtlasImageCache *cache,
                                   R2DWorldAtlasImage *image);
void r2d_world_atlas_image_cache_free(R2DWorldAtlasImageCache *cache);
// Sum of live decoded bytes / bytes saved by sharing (refs-1 per image).
uint64_t r2d_world_atlas_image_cache_bytes(const R2DWorldAtlasImageCache *cache);
uint64_t r2d_world_atlas_image_cache_saved(const R2DWorldAtlasImageCache *cache);

// One row-major tile of a tiled atlas set (borrowed pixels).
typedef struct {
    const uint8_t *pixels;
    int width, height;
} R2DWorldAtlasTile;

// Crop one logical cell from a row-major tiled set into a transparent square
// RGBA8 buffer, exactly like r2d_world_atlas_crop. A cell may straddle tile
// boundaries and flip/placement behave identically. `tile_columns`/`tile_rows`
// describe the tile grid; tile_count must be tile_columns*tile_rows and every
// tile must be tile_width x tile_height. Returns false on invalid input.
bool r2d_world_atlas_crop_tiled(const R2DWorldAtlasTile *tiles, int tile_count,
                                int tile_columns, int tile_rows,
                                int tile_width, int tile_height,
                                int logical_w, int logical_h,
                                int cell_x, int cell_y, int cell_w, int cell_h,
                                bool flip, int side, int dest_x, int dest_y,
                                uint8_t *buffer);

// Alpha modes for compositing an atlas sprite. Values match R2D_WORLD_* blend
// modes used by world surfaces.
enum {
    R2D_WORLD_ATLAS_MASKED = 0,   // alpha < 128 is cut out (default)
    R2D_WORLD_ATLAS_OPAQUE = 1,   // ignore alpha, write all pixels
    R2D_WORLD_ATLAS_TRANSLUCENT = 2, // src-over alpha blend
    R2D_WORLD_ATLAS_ADDITIVE = 3  // additive alpha
};
