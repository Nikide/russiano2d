#pragma once
#include "re2d_world.h"
struct R2dJson;

// Semantic ID tables: compiler/bake plumbing behind the r2d_world_find_* API.
// Names are authored identity; every number in R2DRe2dWorld stays a runtime
// handle. Tables are owned by the world and freed by r2d_world_free().
enum { R2D_WORLD_IDS_CELL,R2D_WORLD_IDS_WALL,R2D_WORLD_IDS_SPAN,R2D_WORLD_IDS_PORTAL,R2D_WORLD_IDS_KINDS };

// Parse optional "id" strings from source/compiled JSON:
// walls[] (authored walls only; derived portal closures stay unnamed),
// cells[], cells[].spans[], portals[]. Openings have no source ids in the
// current .re2dmap format and are not stored.
// Transactional: on failure the world keeps its previous tables and err holds
// an ASCII diagnostic (duplicate, empty, over-63-byte or non-string id).
bool r2d_world_semantic_load_json(R2DRe2dWorld *,const struct R2dJson *,char *,size_t);
// Bounds-checked table construction used by the baked payload loader.
bool r2d_world_semantic_resize(R2DRe2dWorld *,int kind,int count);
bool r2d_world_semantic_assign(R2DRe2dWorld *,int kind,int index,const char *id);
// Counts must parallel geometry, names must be 1..R2D_WORLD_ID_MAX bytes and
// unique inside their namespace.
bool r2d_world_semantic_check(const R2DRe2dWorld *,char *,size_t);
bool r2d_world_semantic_validate(const R2DRe2dWorld *);
bool r2d_world_semantic_any(const R2DRe2dWorld *);
void r2d_world_semantic_free(R2DRe2dWorld *);
const R2DWorldIdTable *r2d_world_semantic_table(const R2DRe2dWorld *,int kind);
