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
#if SIZE_MAX < UINT64_MAX
        if ((uint64_t)cap > (uint64_t)SIZE_MAX / (8u * sizeof(float))) return false;
#endif
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
    out->vertices=b.v; out->vertex_count=b.n; out->opaque_pixels=pixels;
    out->source_width=(uint32_t)f.w;out->source_height=(uint32_t)f.h;return true;
fail:
    free(b.v); return false;
}

void r2d_sprite_mesh_destroy(R2DSpriteMesh *mesh)
{ if(mesh){free(mesh->vertices);memset(mesh,0,sizeof *mesh);} }

static void put32(uint8_t *p,uint32_t v){p[0]=(uint8_t)v;p[1]=(uint8_t)(v>>8);p[2]=(uint8_t)(v>>16);p[3]=(uint8_t)(v>>24);}
static uint32_t get32(const uint8_t *p){return (uint32_t)p[0]|((uint32_t)p[1]<<8)|((uint32_t)p[2]<<16)|((uint32_t)p[3]<<24);}
static void put64(uint8_t *p,uint64_t v){put32(p,(uint32_t)v);put32(p+4,(uint32_t)(v>>32));}
static uint64_t get64(const uint8_t *p){return (uint64_t)get32(p)|((uint64_t)get32(p+4)<<32);}

bool r2d_sprite_mesh_build_all(const uint8_t *rgba,int tw,int th,
                               const R2DSpriteMeshFrameInput *inputs,uint32_t count,
                               const R2DSpriteMeshDesc *defaults,uint64_t source,
                               uint64_t layout,uint64_t settings,R2DSpriteMeshCache *out)
{
    if(out)memset(out,0,sizeof *out);
    if(!out||!inputs||!defaults||!count||count>65535u)return false;
    R2DSpriteMesh *frames=calloc(count,sizeof *frames);if(!frames)return false;
    for(uint32_t i=0;i<count;i++){
        R2DSpriteMeshDesc d=*defaults;d.pivot_x=inputs[i].pivot_x;d.pivot_y=inputs[i].pivot_y;
        if(!r2d_sprite_mesh_build(rgba,tw,th,inputs[i].rect,&d,&frames[i])){
            for(uint32_t j=0;j<i;j++)r2d_sprite_mesh_destroy(&frames[j]);free(frames);return false;
        }
        frames[i].page=inputs[i].page;
    }
    out->source_hash=source;out->layout_hash=layout;out->settings_hash=settings;
    out->depth=defaults->depth;out->units_per_pixel=defaults->units_per_pixel;out->alpha_threshold=defaults->alpha_threshold;
    out->frame_count=count;out->frames=frames;return true;
}
void r2d_sprite_mesh_cache_destroy(R2DSpriteMeshCache *c)
{if(c){for(uint32_t i=0;i<c->frame_count;i++)r2d_sprite_mesh_destroy(&c->frames[i]);free(c->frames);memset(c,0,sizeof *c);}}
bool r2d_sprite_mesh_cache_valid(const R2DSpriteMeshCache*c,uint64_t s,uint64_t l,uint64_t p,uint32_t n)
{return c&&c->frames&&c->frame_count==n&&c->source_hash==s&&c->layout_hash==l&&c->settings_hash==p;}

bool r2d_sprite_mesh_cache_encode(const R2DSpriteMeshCache*c,uint8_t**bytes,size_t*size)
{
    if(bytes)*bytes=NULL;if(size)*size=0;
    if(!c||!bytes||!size||!c->frames||!c->frame_count||c->frame_count>65535u)return false;
    size_t total=48;
    for(uint32_t i=0;i<c->frame_count;i++){
        size_t vb=(size_t)c->frames[i].vertex_count*8u*sizeof(float);
        if(c->frames[i].vertex_count%3u||vb>SIZE_MAX-total-20u)return false;total+=20u+vb;
    }
    uint8_t*p=malloc(total);if(!p)return false;
    memcpy(p,"R2DSMCH1",8);put32(p+8,3);put32(p+12,c->frame_count);
    put64(p+16,c->source_hash);put64(p+24,c->layout_hash);put64(p+32,c->settings_hash);
    uint32_t bits;memcpy(&bits,&c->depth,4);put32(p+40,bits);memcpy(&bits,&c->units_per_pixel,4);put32(p+44,bits);
    size_t at=48;
    for(uint32_t i=0;i<c->frame_count;i++){
        const R2DSpriteMesh*m=&c->frames[i];put32(p+at,m->vertex_count);put32(p+at+4,m->opaque_pixels);put32(p+at+8,m->source_width);put32(p+at+12,m->source_height);put32(p+at+16,m->page);at+=20;
        for(size_t j=0;j<(size_t)m->vertex_count*8u;j++){uint32_t bits;memcpy(&bits,&m->vertices[j],4);put32(p+at,bits);at+=4;}
    }
    *bytes=p;*size=total;return true;
}

bool r2d_sprite_mesh_cache_decode(const uint8_t*p,size_t size,R2DSpriteMeshCache*out)
{
    if(out)memset(out,0,sizeof *out);
    if(!p||!out||size<48||memcmp(p,"R2DSMCH1",8)||get32(p+8)!=3)return false;
    uint32_t n=get32(p+12);if(!n||n>65535u)return false;
    R2DSpriteMesh*frames=calloc(n,sizeof *frames);if(!frames)return false;size_t at=48;
    for(uint32_t i=0;i<n;i++){
        if(size-at<20)goto bad;uint32_t vc=get32(p+at),opaque=get32(p+at+4),fw=get32(p+at+8),fh=get32(p+at+12),page=get32(p+at+16);at+=20;
        if(vc%3u||size-at<(size_t)vc*8u*sizeof(float))goto bad;
        float*v=vc?malloc((size_t)vc*8u*sizeof(float)):NULL;if(vc&&!v)goto bad;
        for(size_t j=0;j<(size_t)vc*8u;j++){uint32_t bits=get32(p+at);memcpy(&v[j],&bits,4);at+=4;if(!isfinite(v[j])){free(v);goto bad;}}
        if(!fw||!fh){free(v);goto bad;}frames[i]=(R2DSpriteMesh){.vertices=v,.vertex_count=vc,.opaque_pixels=opaque,.source_width=fw,.source_height=fh,.page=page};
    }
    if(at!=size)goto bad;
    out->frame_count=n;out->frames=frames;out->source_hash=get64(p+16);out->layout_hash=get64(p+24);out->settings_hash=get64(p+32);uint32_t bits=get32(p+40);memcpy(&out->depth,&bits,4);bits=get32(p+44);memcpy(&out->units_per_pixel,&bits,4);out->alpha_threshold=0;if(!isfinite(out->depth)||out->depth<0||!isfinite(out->units_per_pixel)||out->units_per_pixel<=0)goto bad_out;return true;
bad_out: r2d_sprite_mesh_cache_destroy(out);return false;
bad:for(uint32_t i=0;i<n;i++)r2d_sprite_mesh_destroy(&frames[i]);free(frames);return false;
}
