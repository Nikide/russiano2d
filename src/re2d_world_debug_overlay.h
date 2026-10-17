#pragma once
// Native constrained debug overlays for the appended R2D_WORLD_DEBUG_* views.
// Pure 2D: projected world rectangles/lines plus per-owner pixel tints. The
// runtime fills the context; the module never touches GPU objects or JS state.
#include "re2d_math.h"
#include "re2d_world.h"
#include "re2d_world_impostor.h"
#include "re2d_world_region.h"
#include "re2d_world_render_features.h"
#include <stdint.h>

typedef struct {
    int view;
    const R2DRe2dWorld *world;
    const R2DWorldRegionSet *regions;
    const uint8_t *region_states;
    int region_current;
    const R2DWorldClusterSet *clusters;
    const R2DWorldOccluder *occluders;
    int occluder_count;
    const R2DWorldImpostor *impostors;
    int impostor_count;
    const float *frame_positions;   // 5 floats per actor: x,y,bottom,w,h
    const uint8_t *const *frame_images;
    int frame_count;
    const R2DWorldPixelOwner *owners;
    const R2DWorldRenderFeatures *features;
    int particles_count, particles_capacity;
    int decal_count, light_count, actors, active_regions;
    int stream_uploads, stream_budget;
} R2DWorldDebugOverlayContext;

// Draws over an existing RGBA8 frame. FINAL/legacy views and NULL/invalid
// input are no-ops.
void r2d_world_debug_overlay_draw(const R2DWorldDebugOverlayContext *context,
                                  const R2DRe2dView *view,
                                  int width, int height, uint8_t *rgba);
// Stable ASCII name for a new/existing debug mode ("" for unknown). Used by
// bindings/docs; legacy numeric values are unchanged.
const char *r2d_world_debug_mode_name(int mode);
