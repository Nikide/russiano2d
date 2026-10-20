#include "sprite_mesh.h"

#include <limits.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

static bool opaque(const uint8_t *rgba, int width, int height,
                   R2DSpriteMeshRect frame, int x, int y, uint8_t threshold)
{
    if (x < frame.x || y < frame.y || x >= frame.x + frame.w ||
        y >= frame.y + frame.h || x < 0 || y < 0 || x >= width || y >= height)
        return false;
    return rgba[((size_t)y * (size_t)width + (size_t)x) * 4u + 3u] >= threshold;
}

typedef struct Build { float *v; uint32_t n, cap; } Build;
static bool push(Build *b, float x, float y, float z, float u, float v)
{
    if (b->n == UINT32_MAX) return false;
    if (b->n + 1u > b->cap) {
        uint32_t cap = b->cap ? b->cap * 2u : 96u;
        if (cap < b->n + 1u) cap = b->n + 1u;
        if (cap > SIZE_MAX / (8u * sizeof(float))) return false;
        float *p = realloc(b->v, (size_t)cap * 8u * sizeof(float));
        if (!p) return false;
        b->v = p; b->cap = cap;
    }
    float *d = b->v + (size_t)(b->n++) * 8u;
    const float vertex[5] = {x,y,z,u,v};
    memcpy(d, vertex, sizeof vertex); d[5] = d[6] = d[7] = 255.0f;
    return true;
}

static bool quad(Build *b, const float p[4][3], const float uv[4][2])
{
    static const int order[6] = {0,1,2,0,2,3};
    for (int i=0;i<6;i++) { int k=order[i]; if (!push(b,p[k][0],p[k][1],p[k][2],uv[k][0],uv[k][1])) return false; }
    return true;
}

bool r2d_sprite_mesh_build(const uint8_t *rgba, int tw, int th,
                           R2DSpriteMeshRect f, const R2DSpriteMeshDesc *d,
                           R2DSpriteMesh *out)
{
    if (out) memset(out,0,sizeof *out);
    if (!rgba || !out || !d || tw<=0 || th<=0 || f.x<0 || f.y<0 || f.w<=0 || f.h<=0 ||
        f.x>tw-f.w || f.y>th-f.h || !isfinite(d->depth) || d->depth<0 ||
        !isfinite(d->units_per_pixel) || d->units_per_pixel<=0 ||
        !isfinite(d->pivot_x) || !isfinite(d->pivot_y)) return false;
    Build b={0}; uint32_t pixels=0;
    const float scale=d->units_per_pixel, z=d->depth;
    for (int y=f.y;y<f.y+f.h;y++) for (int x=f.x;x<f.x+f.w;x++) {
        if (!opaque(rgba,tw,th,f,x,y,d->alpha_threshold)) continue;
        pixels++;
        const float x0=(x-f.x-d->pivot_x)*scale, x1=x0+scale;
        const float y0=(d->pivot_y-(y-f.y))*scale, y1=y0-scale;
        const float u0=(float)x/tw, u1=(float)(x+1)/tw;
        const float v0=(float)y/th, v1=(float)(y+1)/th;
        const float front[4][3]={{x0,y0,0},{x1,y0,0},{x1,y1,0},{x0,y1,0}};
        const float back[4][3]={{x1,y0,z},{x0,y0,z},{x0,y1,z},{x1,y1,z}};
        const float uv[4][2]={{u0,v0},{u1,v0},{u1,v1},{u0,v1}};
        if (!quad(&b,front,uv)||!quad(&b,back,uv)) goto fail;
        const float uv_side[4][2]={{u0,v0},{u1,v0},{u1,v1},{u0,v1}};
        if (!opaque(rgba,tw,th,f,x-1,y,d->alpha_threshold)) { const float q[4][3]={{x0,y0,0},{x0,y1,0},{x0,y1,z},{x0,y0,z}}; if(!quad(&b,q,uv_side))goto fail; }
        if (!opaque(rgba,tw,th,f,x+1,y,d->alpha_threshold)) { const float q[4][3]={{x1,y1,0},{x1,y0,0},{x1,y0,z},{x1,y1,z}}; if(!quad(&b,q,uv_side))goto fail; }
        if (!opaque(rgba,tw,th,f,x,y-1,d->alpha_threshold)) { const float q[4][3]={{x1,y0,0},{x0,y0,0},{x0,y0,z},{x1,y0,z}}; if(!quad(&b,q,uv_side))goto fail; }
        if (!opaque(rgba,tw,th,f,x,y+1,d->alpha_threshold)) { const float q[4][3]={{x0,y1,0},{x1,y1,0},{x1,y1,z},{x0,y1,z}}; if(!quad(&b,q,uv_side))goto fail; }
    }
    out->vertices=b.v; out->vertex_count=b.n; out->opaque_pixels=pixels; return true;
fail:
    free(b.v); return false;
}

void r2d_sprite_mesh_destroy(R2DSpriteMesh *mesh)
{ if(mesh){free(mesh->vertices);memset(mesh,0,sizeof *mesh);} }
