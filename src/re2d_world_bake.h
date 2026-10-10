#pragma once
#include "re2d_world.h"
#include "json.h"
// Portable little-endian wire tables, hex encoded inside inspectable compiler JSON.
bool r2d_world_put_baked(R2DRe2dWorld *,R2dSb *);
bool r2d_world_load_baked(R2DRe2dWorld *,const R2dJson *,char *,size_t);
