#pragma once
// ===========================================================================
// Re2D: authored map metadata + typed spawn points (P1).
//
// Pure C validation/parsing over an already parsed R2dJson tree. No world
// mutation, no globals, no allocation on failure (transactional). This never
// becomes a WAD compatibility layer: only source-level Re2D metadata.
//
// Expected JSON shape (unknown fields are ignored):
//   { "meta": {                // "metadata" is accepted as an alias
//       "id": "...", "title": "...", "author": "...", "version": "...",
//       "music": "...", "sky": "...", "nextMap": "...", "secretExit": "...",
//       "environment": "...", "defaultFogColor": "#rrggbb",
//       "defaultFogDensity": 0.0, "defaultFogStart": 0.0,
//       "spawns": [
//         {"id":"player.start","type":"player","x":100,"y":200,"h":0,
//          "facing":1.5,"tag":"start"}
//       ]
//     } }
// multi-word snake_case aliases (next_map, secret_exit, default_fog_color,
// default_fog_density, default_fog_start) are accepted too. "spawns" may live
// inside meta/metadata or at the document root; the meta copy wins.
//
// Defaults: absent strings are NULL, absent spawns mean spawn_count=0,
// default_fog_density/default_fog_start are 0, spawn h/facing are 0.
// Limits: every string is <= 127 bytes (R2D_WORLD_METADATA_STRING_MAX), spawn
// count is <= 1024, coordinates are finite and |v| <= 1000000. Failure leaves
// *out zeroed and writes an ASCII diagnostic; *out must therefore be
// zero-initialised or a previously parsed value (it is freed/cleared).
// ===========================================================================
#include <stdbool.h>
#include <stddef.h>

struct R2dJson;

enum { PLAYER=0, ENEMY, ITEM, BOSS, EFFECT, CAMERA };

typedef struct {
    char *id;
    int type;
    float x,y,h,facing;
    char *tag;
} R2DWorldSpawn;

typedef struct {
    char *id;
    char *title;
    char *author;
    char *version;
    char *music;
    char *sky;
    char *next_map;
    char *secret_exit;
    char *environment;
    char *default_fog_color;
    float default_fog_density;
    float default_fog_start;
    R2DWorldSpawn *spawns;
    int spawn_count;
} R2DWorldMetadata;

enum { R2D_WORLD_METADATA_STRING_MAX=127, R2D_WORLD_METADATA_SPAWN_MAX=1024 };
#define R2D_WORLD_METADATA_COORD_MAX 1000000.0

bool r2d_world_metadata_parse(const struct R2dJson *root,R2DWorldMetadata *out,char *error,size_t size);
void r2d_world_metadata_free(R2DWorldMetadata *metadata);

// Stable lowercase names ("player","enemy","item","boss","effect","camera").
// from_name is case-insensitive and also accepts "cutscene" as CAMERA.
// Invalid type => "unknown"; unknown name => -1.
const char *r2d_world_spawn_type_name(int type);
int r2d_world_spawn_type_from_name(const char *name);
