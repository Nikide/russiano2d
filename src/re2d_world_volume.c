#include "re2d_world_volume.h"

#include <math.h>
#include <string.h>

// Pure geometry/selection core: stack arrays only, no allocation, no globals.

#define VOLUME_PART_MAX R2D_VOLUME_SLICES_MAX

static bool volume_valid(const R2DWorldVolume *v)
{
    if (!v) return false;
    if (!isfinite(v->width)||!isfinite(v->depth)||!isfinite(v->height)) return false;
    if (v->width<=0.0f||v->depth<=0.0f||v->height<=0.0f) return false;
    if (v->mode!=R2D_VOLUME_BOX&&v->mode!=R2D_VOLUME_CROSS&&v->mode!=R2D_VOLUME_SLICE_STACK)
        return false;
    if (v->mode==R2D_VOLUME_SLICE_STACK&&
        (v->slices<R2D_VOLUME_SLICES_MIN||v->slices>R2D_VOLUME_SLICES_MAX))
        return false;
    return true;
}

static void part_add(R2DWorldVolumePart *parts,int *count,int face,
                     float ox,float oy,float oz,float scale,
                     float back_x,float back_y,float back_z)
{
    R2DWorldVolumePart *p=&parts[(*count)++];
    p->face=face;
    p->offset_x=ox;
    p->offset_y=oy;
    p->scale=scale;
    // Nearest plane (largest projection onto actor->camera) sorts first.
    p->depth_bias=-(ox*back_x+oy*back_y+oz*back_z);
    p->flip=false;
}

static float wrap_pi(float angle)
{
    float wrapped=atan2f(sinf(angle),cosf(angle));
    return isfinite(wrapped)?wrapped:0.0f;
}

static bool part_before(const R2DWorldVolumePart *a,const R2DWorldVolumePart *b)
{
    if (a->depth_bias<b->depth_bias) return true;
    if (a->depth_bias>b->depth_bias) return false;
    return a->face<b->face;
}

static void parts_sort(R2DWorldVolumePart *parts,int count)
{
    // Stable insertion sort; equal (depth_bias, face) keeps emission order.
    for (int i=1;i<count;i++) {
        R2DWorldVolumePart key=parts[i];
        int j=i-1;
        while (j>=0&&part_before(&key,&parts[j])) { parts[j+1]=parts[j]; j--; }
        parts[j+1]=key;
    }
}

static int box_parts(const R2DWorldVolume *v,float world_x,float world_y,float world_z,
                     float camera_x,float camera_y,float camera_z,float camera_yaw,
                     R2DWorldVolumePart *parts)
{
    float dx=camera_x-world_x, dy=camera_y-world_y;
    bool have_x=false,have_y=false;
    int count=0;

    // Actor->camera 3D direction, used for front-to-back face ordering.
    float rz=camera_z-(world_z+v->height*0.5f);
    float length=sqrtf(dx*dx+dy*dy+rz*rz);
    float bx,by,bz;
    if (length>1e-9f) { bx=dx/length; by=dy/length; bz=rz/length; }
    else { bx=-cosf(camera_yaw); by=-sinf(camera_yaw); bz=0.0f; }

    // Camera quadrant around the actor: +Y is BACK, -Y is FRONT, +X is RIGHT.
    if (dx>0.0f) { have_x=true; part_add(parts,&count,R2D_VOLUME_FACE_RIGHT,
        v->width*0.5f,0.0f,0.0f,1.0f,bx,by,bz); }
    else if (dx<0.0f) { have_x=true; part_add(parts,&count,R2D_VOLUME_FACE_LEFT,
        -v->width*0.5f,0.0f,0.0f,1.0f,bx,by,bz); }
    if (dy>0.0f) { have_y=true; part_add(parts,&count,R2D_VOLUME_FACE_BACK,
        0.0f,v->depth*0.5f,0.0f,1.0f,bx,by,bz); }
    else if (dy<0.0f) { have_y=true; part_add(parts,&count,R2D_VOLUME_FACE_FRONT,
        0.0f,-v->depth*0.5f,0.0f,1.0f,bx,by,bz); }
    if (!have_x&&!have_y) {
        // Coincident camera: the view direction decides the single visible side.
        float vx=-cosf(camera_yaw), vy=-sinf(camera_yaw);
        if (fabsf(vx)>=fabsf(vy)) {
            if (vx>=0.0f) part_add(parts,&count,R2D_VOLUME_FACE_RIGHT,
                v->width*0.5f,0.0f,0.0f,1.0f,bx,by,bz);
            else part_add(parts,&count,R2D_VOLUME_FACE_LEFT,
                -v->width*0.5f,0.0f,0.0f,1.0f,bx,by,bz);
        } else {
            if (vy>=0.0f) part_add(parts,&count,R2D_VOLUME_FACE_BACK,
                0.0f,v->depth*0.5f,0.0f,1.0f,bx,by,bz);
            else part_add(parts,&count,R2D_VOLUME_FACE_FRONT,
                0.0f,-v->depth*0.5f,0.0f,1.0f,bx,by,bz);
        }
    }

    if ((v->flags&R2D_VOLUME_FLAG_TOP)&&camera_z>world_z+v->height)
        part_add(parts,&count,R2D_VOLUME_FACE_TOP,0.0f,0.0f,v->height*0.5f,1.0f,bx,by,bz);
    if ((v->flags&R2D_VOLUME_FLAG_BOTTOM)&&camera_z<world_z)
        part_add(parts,&count,R2D_VOLUME_FACE_BOTTOM,0.0f,0.0f,-v->height*0.5f,1.0f,bx,by,bz);
    return count;
}

static int cross_parts(R2DWorldVolumePart *parts)
{
    R2DWorldVolumePart *a=&parts[0],*b=&parts[1];
    *a=(R2DWorldVolumePart){R2D_VOLUME_FACE_FRONT,0.0f,0.0f,1.0f,0.0f,false};
    *b=(R2DWorldVolumePart){R2D_VOLUME_FACE_RIGHT,0.0f,0.0f,1.0f,0.0f,false};
    return 2;
}

int r2d_world_volume_parts(const R2DWorldVolume *v,float world_x,float world_y,float world_z,
                           float camera_x,float camera_y,float camera_z,float camera_yaw,
                           R2DWorldVolumePart *out,int capacity)
{
    if (!volume_valid(v)||capacity<0) return -1;
    if (!isfinite(world_x)||!isfinite(world_y)||!isfinite(world_z)) return -1;
    if (!isfinite(camera_x)||!isfinite(camera_y)||!isfinite(camera_z)||!isfinite(camera_yaw)) return -1;

    R2DWorldVolumePart parts[VOLUME_PART_MAX];
    int total=0;
    if (v->mode==R2D_VOLUME_BOX) {
        total=box_parts(v,world_x,world_y,world_z,camera_x,camera_y,camera_z,camera_yaw,parts);
    } else if (v->mode==R2D_VOLUME_CROSS) {
        total=cross_parts(parts);
    } else {
        total=v->slices;
        for (int i=0;i<total;i++) r2d_world_volume_slice_part(v,i,world_z,&parts[i]);
    }
    parts_sort(parts,total);
    if (out) {
        int written=total<capacity?total:capacity;
        for (int i=0;i<written;i++) out[i]=parts[i];
    }
    return total;
}

int r2d_world_volume_slice_count(const R2DWorldVolume *v)
{
    if (!volume_valid(v)||v->mode!=R2D_VOLUME_SLICE_STACK) return 0;
    return v->slices;
}

void r2d_world_volume_slice_part(const R2DWorldVolume *v,int slice,float world_z,
                                 R2DWorldVolumePart *out)
{
    if (!out) return;
    memset(out,0,sizeof *out);
    if (!volume_valid(v)||v->mode!=R2D_VOLUME_SLICE_STACK) return;
    if (!isfinite(world_z)||slice<0||slice>=v->slices) return;
    int count=v->slices;
    out->face=slice;
    out->offset_x=0.0f;
    out->offset_y=0.0f;
    out->scale=1.0f/(float)count;
    out->depth_bias=world_z+((float)slice+0.5f)*v->height/(float)count;
    out->flip=false;
}

float r2d_world_volume_cross_angle(const R2DWorldVolume *v,float actor_facing,float camera_yaw)
{
    if (!v||!isfinite(actor_facing)||!isfinite(camera_yaw)) return 0.0f;
    if (!(v->width>0.0f)||!(v->depth>0.0f)||!(v->height>0.0f)) return 0.0f;
    return wrap_pi(actor_facing-camera_yaw);
}

bool r2d_world_volume_hit(const R2DWorldVolume *v,const R2DWorldVolumeHit *hit,
                          float *radius,float *bottom,float *top)
{
    if (radius) *radius=0.0f;
    if (bottom) *bottom=0.0f;
    if (top) *top=0.0f;
    if (!volume_valid(v)) return false;
    if (hit) {
        if (!isfinite(hit->radius)||hit->radius<=0.0f) return false;
        if (!isfinite(hit->bottom)||!isfinite(hit->top)||hit->top<=hit->bottom) return false;
        if (hit->zones<0) return false;
        if (radius) *radius=hit->radius;
        if (bottom) *bottom=hit->bottom;
        if (top) *top=hit->top;
        return true;
    }
    // Conservative default: circle circumscribing the authored XY box.
    if (radius) *radius=0.5f*sqrtf(v->width*v->width+v->depth*v->depth);
    if (bottom) *bottom=0.0f;
    if (top) *top=v->height;
    return true;
}
