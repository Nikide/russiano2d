#pragma once
// ===========================================================================
// Re2D: pure 2D automap extraction from native world topology.
//
// This layer only converts constrained Re2D topology (walls + portals) into
// flat XY line segments and projects them through a 2D view transform. It does
// no rendering, owns no memory, allocates nothing and never touches the world:
// a runtime/renderer collects segments and draws them however it likes.
//
// Extraction order is deterministic: authored walls in index order, then
// portals in index order. Derived door-opening closure walls (the extra wall
// surfaces r2d_world_build_cells() appends for portal openings) are skipped so
// a doorway is not drawn twice; the portal itself is the automap door line.
// Every line keeps the original primitive index in `index`, so skipped closure
// walls simply leave gaps in the wall index sequence.
//
// State indexing (`state_by_index`)
// --------------------------------
// One flat caller-owned uint8_t array indexed by primitive:
//   walls   0 .. wall_count-1
//   portals wall_count .. wall_count+portal_count-1
// This matches the `index` field for each kind (add wall_count for portals).
// Slots for skipped closure walls are ignored. NULL states means UNSEEN.
// Values outside the enum, NULL states, negative/too-large indices all fall
// back to R2D_AUTOMAP_UNSEEN via r2d_world_automap_state().
//
// Projection
// ----------
//   out = R(rotation) * ((world - view center) * scale)
// where R is the standard counter-clockwise rotation in world XY radians. The
// output is map-local and centered on the view: (0,0) is the view focus, no
// screen origin or Y flip is implied. A zero scale is valid and collapses every
// point to (0,0) (documented instead of dividing). A NULL view is an identity
// transform (world coordinates pass through).
// ===========================================================================
#include "re2d_world.h"

enum {
    R2D_AUTOMAP_UNSEEN = 0,
    R2D_AUTOMAP_SEEN = 1,
    R2D_AUTOMAP_SECRET = 2,
    R2D_AUTOMAP_LOCKED = 3,
    R2D_AUTOMAP_SPECIAL = 4
};

enum {
    R2D_AUTOMAP_WALL = 0,
    R2D_AUTOMAP_PORTAL = 1
};

typedef struct {
    float x1, y1, x2, y2;
    int state;   // R2D_AUTOMAP_UNSEEN..R2D_AUTOMAP_SPECIAL
    int kind;    // R2D_AUTOMAP_WALL / R2D_AUTOMAP_PORTAL
    int index;   // source primitive index within wall_count / portal_count
} R2DWorldAutomapLine;

typedef struct {
    float cx, cy;       // world-space focus (translation)
    float scale;        // uniform XY scale; 0 collapses to the focus
    float rotation;     // radians, counter-clockwise
} R2DWorldAutomapView;

// Extracts automap lines. Returns the total required line count (authored walls
// plus portals), which may exceed `capacity`; at most `capacity` lines are
// written in deterministic order. out==NULL is a count-only query (capacity is
// ignored). Invalid arguments return -1: NULL world, out!=NULL with
// capacity<0. Non-finite geometry is copied as stored by the world builder;
// the builder itself rejects non-finite topology.
int r2d_world_automap_lines(const R2DRe2dWorld *world,
                            const uint8_t *state_by_index,
                            R2DWorldAutomapLine *out, int capacity);

// Forward 2D view transform (translation, uniform scale, rotation). Writes to
// non-NULL out_x/out_y; NULL outputs are ignored. NULL view is identity.
// Zero scale writes exact 0 to both outputs.
void r2d_world_automap_project(const R2DWorldAutomapView *view,
                               float x, float y,
                               float *out_x, float *out_y);

// Safe state lookup. Returns UNSEEN for NULL states, count<=0, index outside
// [0,count), or a byte outside the automap state range.
int r2d_world_automap_state(const uint8_t *states, int count, int index);
