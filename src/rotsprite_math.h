#pragma once
#include <stdbool.h>
#include <stdint.h>

#define R2D_ROTSPRITE_SIZE 64

// Единый атлас всего тела 8N×8N. Пока проецируются только голова и уши.
bool r2d_rotsprite_layout(int w, int h, int *cell);
bool r2d_rotsprite_angles(double yaw, double pitch, double *out_yaw, double *out_pitch);
bool r2d_rotsprite_raster(const uint8_t *atlas, int w, int h, int stride,
                          double yaw, double pitch, uint8_t *out);
