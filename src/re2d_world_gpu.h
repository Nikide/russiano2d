#pragma once
#include "re2d_world_runtime.h"
// Dedicated constrained-surface GPU pass, retaining readback for reference actor composition.
bool r2d_world_gpu_frame(JSContext *,R2DWorldRuntime *,const R2DRe2dView *,float);
void r2d_world_gpu_free(R2DWorldRuntime *);
void r2d_world_gpu_material_dirty(R2DWorldRuntime *);
