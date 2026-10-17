#include "re2d_world_terrain.h"

#include <math.h>
#include <stddef.h>

// Pure Re2D terrain/conveyor helpers: no allocation, no mutable globals, no
// clock. Results depend only on the arguments and on the static preset table.

#define R2D_TERRAIN_MAX_DT 0.25f

// Authored presets. Values are deliberately binary-exact so tests can pin
// them with fabsf()==0 and the runtime gets stable metadata across builds.
static const R2DWorldTerrain k_terrain[R2D_TERRAIN_COUNT] = {
    [R2D_TERRAIN_NONE] = {
        R2D_TERRAIN_NONE, 1.0f, 1.0f, 0.0f, 0.0f,
        1.0f, 1.0f, 1.0f, 0.0f, R2D_TERRAIN_DECAL_NONE
    },
    [R2D_TERRAIN_STONE] = {
        R2D_TERRAIN_STONE, 1.0f, 1.0f, 0.0f, 0.5f,
        0.75f, 0.75f, 0.75f, 0.0f, R2D_TERRAIN_DECAL_DUST
    },
    [R2D_TERRAIN_METAL] = {
        R2D_TERRAIN_METAL, 1.0f, 1.0f, 0.0f, 0.5f,
        0.75f, 0.875f, 1.0f, 0.0f, R2D_TERRAIN_DECAL_DUST
    },
    [R2D_TERRAIN_FLESH] = {
        R2D_TERRAIN_FLESH, 0.875f, 0.75f, 0.0f, 0.0f,
        0.75f, 0.25f, 0.25f, 0.0f, R2D_TERRAIN_DECAL_BLOOD
    },
    [R2D_TERRAIN_WOOD] = {
        R2D_TERRAIN_WOOD, 1.0f, 1.0f, 0.0f, 0.0f,
        0.75f, 0.5f, 0.25f, 0.0f, R2D_TERRAIN_DECAL_DUST
    },
    [R2D_TERRAIN_CRYSTAL] = {
        R2D_TERRAIN_CRYSTAL, 1.0f, 0.75f, 0.0f, 0.75f,
        0.625f, 0.875f, 1.0f, 0.0078125f, R2D_TERRAIN_DECAL_MAGIC
    },
    [R2D_TERRAIN_MAGIC] = {
        R2D_TERRAIN_MAGIC, 1.0f, 1.0f, 0.0f, 1.0f,
        0.625f, 0.375f, 1.0f, 0.015625f, R2D_TERRAIN_DECAL_MAGIC
    },
    [R2D_TERRAIN_WATER] = {
        R2D_TERRAIN_WATER, 0.5f, 0.5f, 0.0f, 2.0f,
        0.25f, 0.5f, 0.75f, 0.015625f, R2D_TERRAIN_DECAL_WET
    },
    [R2D_TERRAIN_BLOOD] = {
        R2D_TERRAIN_BLOOD, 0.75f, 0.625f, 0.5f, 1.5f,
        0.5f, 0.0625f, 0.0625f, 0.03125f, R2D_TERRAIN_DECAL_BLOOD
    },
    [R2D_TERRAIN_ACID] = {
        R2D_TERRAIN_ACID, 0.75f, 0.5f, 8.0f, 2.0f,
        0.5f, 0.875f, 0.125f, 0.03125f, R2D_TERRAIN_DECAL_ACID
    },
    [R2D_TERRAIN_LAVA] = {
        R2D_TERRAIN_LAVA, 0.5f, 0.25f, 40.0f, 1.0f,
        1.0f, 0.25f, 0.0625f, 0.0625f, R2D_TERRAIN_DECAL_SCORCH
    },
    [R2D_TERRAIN_MIST] = {
        R2D_TERRAIN_MIST, 1.0f, 1.0f, 2.0f, 0.25f,
        0.625f, 0.75f, 0.875f, 0.125f, R2D_TERRAIN_DECAL_MAGIC
    }
};

static const char *const k_terrain_names[R2D_TERRAIN_COUNT] = {
    "none", "stone", "metal", "flesh", "wood", "crystal",
    "magic", "water", "blood", "acid", "lava", "mist"
};

static bool terrain_kind_valid(int kind)
{
    return kind >= 0 && kind < (int)R2D_TERRAIN_COUNT;
}

static char lower_ascii(char c)
{
    return (c >= 'A' && c <= 'Z') ? (char)(c - 'A' + 'a') : c;
}

static bool name_equal(const char *a,const char *b)
{
    if (!a || !b) return false;
    while (*a && *b) {
        if (lower_ascii(*a) != lower_ascii(*b)) return false;
        a++;
        b++;
    }
    return *a == '\0' && *b == '\0';
}

const R2DWorldTerrain *r2d_world_terrain_preset(int kind)
{
    if (!terrain_kind_valid(kind)) return NULL;
    return &k_terrain[kind];
}

bool r2d_world_terrain_from_name(const char *name,int *kind)
{
    if (kind) *kind = -1;
    if (!name || name[0] == '\0') return false;
    for (int i = 0; i < (int)R2D_TERRAIN_COUNT; i++) {
        if (name_equal(name,k_terrain_names[i])) {
            if (kind) *kind = i;
            return true;
        }
    }
    return false;
}

const char *r2d_world_terrain_name(int kind)
{
    if (!terrain_kind_valid(kind)) return NULL;
    return k_terrain_names[kind];
}

void r2d_world_conveyor_apply(const R2DWorldConveyor *conveyor,
                              float *vx,float *vy,
                              float move_scale,float dt)
{
    if (!conveyor || !vx || !vy) return;
    if (!isfinite(conveyor->vx) || !isfinite(conveyor->vy)) return;
    if (!isfinite(conveyor->accel) || conveyor->accel < 0.0f) return;
    if (!isfinite(*vx) || !isfinite(*vy)) return;
    if (!isfinite(move_scale) || move_scale < 0.0f) return;
    if (!isfinite(dt) || dt <= 0.0f) return;
    if (dt > R2D_TERRAIN_MAX_DT) dt = R2D_TERRAIN_MAX_DT;

    const float target_x = conveyor->vx * move_scale;
    const float target_y = conveyor->vy * move_scale;
    if (!isfinite(target_x) || !isfinite(target_y)) return;

    const float dx = target_x - *vx;
    const float dy = target_y - *vy;
    const float distance = sqrtf(dx * dx + dy * dy);
    if (!isfinite(distance) || !(distance > 0.0f)) {
        if (distance == 0.0f) {
            *vx = target_x;
            *vy = target_y;
        }
        return;
    }

    const float max_step = conveyor->accel * dt;
    if (!(max_step < distance)) {
        *vx = target_x;
        *vy = target_y;
        return;
    }
    const float scale = max_step / distance;
    *vx += dx * scale;
    *vy += dy * scale;
}
