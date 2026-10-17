#include "re2d_world_automap.h"

#include <math.h>

// Pure topology -> 2D lines. No allocation, no globals, no renderer state.

static bool automap_wall_is_closure(const R2DRe2dWorld *world, int wall)
{
    // r2d_world_build_cells() appends one closure wall per portal opening and
    // tags it in both incidence tables. Legacy r2d_world_build() worlds have
    // neither table, so every stored wall is authored.
    if (world->wall_openings && world->wall_openings[wall] != 0) return true;
    if (world->wall_portals && world->wall_portals[wall] != 0) return true;
    return false;
}

static void automap_fill_line(R2DWorldAutomapLine *line, float x1, float y1,
                              float x2, float y2, int state, int kind, int index)
{
    line->x1 = x1;
    line->y1 = y1;
    line->x2 = x2;
    line->y2 = y2;
    line->state = state;
    line->kind = kind;
    line->index = index;
}

int r2d_world_automap_lines(const R2DRe2dWorld *world,
                            const uint8_t *state_by_index,
                            R2DWorldAutomapLine *out, int capacity)
{
    if (!world) return -1;
    if (out && capacity < 0) return -1;

    const int state_count = world->wall_count + world->portal_count;
    int total = 0;

    for (int i = 0; i < world->wall_count; i++) {
        if (automap_wall_is_closure(world, i)) continue;
        if (out && total < capacity) {
            const R2DWorldWall *wall = &world->walls[i];
            const int state = r2d_world_automap_state(state_by_index, state_count, i);
            automap_fill_line(&out[total], wall->x1, wall->y1, wall->x2, wall->y2,
                              state, R2D_AUTOMAP_WALL, i);
        }
        total++;
    }

    for (int i = 0; i < world->portal_count; i++) {
        if (out && total < capacity) {
            const R2DWorldPortal *portal = &world->portals[i];
            const int state = r2d_world_automap_state(state_by_index, state_count,
                                                      world->wall_count + i);
            automap_fill_line(&out[total], portal->ax, portal->ay,
                              portal->bx, portal->by, state,
                              R2D_AUTOMAP_PORTAL, i);
        }
        total++;
    }

    return total;
}

void r2d_world_automap_project(const R2DWorldAutomapView *view,
                               float x, float y,
                               float *out_x, float *out_y)
{
    float px, py;

    if (!view) {
        px = x;
        py = y;
    } else {
        const float dx = x - view->cx;
        const float dy = y - view->cy;
        if (view->scale == 0.0f) {
            px = 0.0f;
            py = 0.0f;
        } else {
            const float c = cosf(view->rotation);
            const float s = sinf(view->rotation);
            px = (dx * c - dy * s) * view->scale;
            py = (dx * s + dy * c) * view->scale;
        }
    }

    if (out_x) *out_x = px;
    if (out_y) *out_y = py;
}

int r2d_world_automap_state(const uint8_t *states, int count, int index)
{
    if (!states || count <= 0 || index < 0 || index >= count) {
        return R2D_AUTOMAP_UNSEEN;
    }
    const int state = (int)states[index];
    if (state < R2D_AUTOMAP_UNSEEN || state > R2D_AUTOMAP_SPECIAL) {
        return R2D_AUTOMAP_UNSEEN;
    }
    return state;
}
