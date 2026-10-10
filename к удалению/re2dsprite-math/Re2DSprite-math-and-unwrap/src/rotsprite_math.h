#pragma once
#include <stdbool.h>
#include <stdint.h>

#define R2D_ROTSPRITE_SIZE 64

// Единый атлас всего тела 8N×8N. Пока проецируются только голова и уши.
bool r2d_rotsprite_layout(int w, int h, int *cell);
bool r2d_rotsprite_angles(double yaw, double pitch, double *out_yaw, double *out_pitch);
bool r2d_rotsprite_raster(const uint8_t *atlas, int w, int h, int stride,
                          double yaw, double pitch, uint8_t *out);

// v2: точки поверхности декодируются из карт единственного PNG при загрузке.
typedef struct R2DRotPoint {
    float x,y,z; uint8_t rgba[4], part, group, corner_parts[4];
    uint8_t blend_part,blend_weight,corner_blend_parts[4],corner_blend_weights[4];
    // Optional continuous footprint decoded from neighboring cells of the PNG.
    bool patch; float du[3],dv[3],duv[3]; uint8_t colors[4][4];
    // Material footprint at source texel density, independent of control-map density.
    bool textured, mapped; uint8_t material[5*5*4];
} R2DRotPoint;
typedef struct R2DRotAtlas { R2DRotPoint *points; int count; } R2DRotAtlas;
bool r2d_rotsprite_v2_header(const uint8_t *atlas,int w,int h,int stride);
bool r2d_rotsprite_v2_decode(const uint8_t *atlas,int w,int h,int stride,R2DRotAtlas *out);
void r2d_rotsprite_v2_free(R2DRotAtlas *atlas);
bool r2d_rotsprite_v2_raster(const R2DRotAtlas *atlas,double yaw,double pitch,int eyes,int mouth,uint8_t *out);

typedef struct R2DRotPartPose {
    double matrix[12]; // 3x4 affine, row-major; one native pass over cached points.
    bool defined, visible, one_sided;
    uint8_t selector, variant; // 0 ordinary, 1 eyes, 2 mouth, 3 brows.
} R2DRotPartPose;
typedef struct R2DRotModelPose { double scale; R2DRotPartPose parts[256]; } R2DRotModelPose;
typedef struct R2DRotRig { const R2DRotModelPose *model; bool body; double phase, stride, arm_left, arm_right, head_yaw; int brows; } R2DRotRig;
bool r2d_rotsprite_v2_draw(const R2DRotAtlas *atlas,double yaw,double pitch,int eyes,int mouth,const R2DRotRig *rig,uint8_t *out);

void r2d_rotsprite_v2_joint(int part,double x,double y,double z,double yaw,double pitch,const R2DRotRig *rig,double *out_x,double *out_y);

// Smooth anime projection: dense atlas samples, 512 supersampling -> RGBA 256.
bool r2d_rotsprite_v2_decode_anime(const uint8_t *atlas,int w,int h,int stride,R2DRotAtlas *out);
bool r2d_rotsprite_v2_anime(const R2DRotAtlas *atlas,double yaw,double pitch,int eyes,int mouth,const R2DRotRig *rig,uint8_t *out);

// Per-handle scratch for smooth 2D synthesis. Zero-initialise; free at disposal.
typedef struct R2DRotAnimeWorkspace {
    float *depth,*distance;uint8_t *rgba,*resolved;int bounds[4], size;
} R2DRotAnimeWorkspace;
void r2d_rotsprite_anime_workspace_free(R2DRotAnimeWorkspace *);
bool r2d_rotsprite_v2_anime_workspace(const R2DRotAtlas *,double yaw,double pitch,int eyes,int mouth,const R2DRotRig *,uint8_t *out,R2DRotAnimeWorkspace *);

// Output size 256 or 512; legacy entry points retain their 256-pixel contract.
bool r2d_rotsprite_v2_anime_sized(const R2DRotAtlas *,double,double,int,int,const R2DRotRig *,uint8_t *,R2DRotAnimeWorkspace *,int size);
