#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
// Load-time conversion: bounded EXR bytes -> ordinary opaque RGBA8 bitmap.
// Caller owns pixels with free(). Failure leaves output pointers untouched.
bool r2d_world_exr_decode(const uint8_t *bytes,size_t size,float exposure,
                         uint8_t **pixels,int *width,int *height,char *error,size_t error_size);
#ifdef __cplusplus
}
#endif
