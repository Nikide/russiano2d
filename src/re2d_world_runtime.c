#include "re2d_world_runtime.h"
#include "re2d_world_atlas.h"
#include "re2d_world_exr.h"
#include "re2d_world_gpu.h"
#include "rotsprite.h"
#include "script.h"
#include "payload.h"
#include <SDL3_image/SDL_image.h>
#include <SDL3/SDL_timer.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#define ACTOR_LIMIT 4096
static bool same(JSValueConst a,JSValueConst b)
{ return JS_VALUE_GET_TAG(a)==JS_VALUE_GET_TAG(b)&&JS_VALUE_GET_PTR(a)==JS_VALUE_GET_PTR(b); }
bool r2d_world_actor_register(JSContext *ctx,R2DWorldRuntime *w,JSValueConst node)
{
    if(w->rendering){JS_ThrowTypeError(ctx,"Re2D World: actor registry is busy");return false;}
    if(!JS_IsObject(node)){JS_ThrowTypeError(ctx,"Re2D World: actor needs a Re2DSprite node");return false;}
    for(int i=0;i<w->actor_count;i++)if(same(node,w->actors[i]))return true;
    if(w->actor_count==ACTOR_LIMIT){JS_ThrowRangeError(ctx,"Re2D World: actor budget exhausted");return false;}
    if(w->actor_count==w->actor_capacity){int n=w->actor_capacity?w->actor_capacity*2:16;JSValue *p=realloc(w->actors,(size_t)n*sizeof *p);if(!p){JS_ThrowOutOfMemory(ctx);return false;}w->actors=p;w->actor_capacity=n;}
    w->actors[w->actor_count++]=JS_DupValue(ctx,node);return true;
}
bool r2d_world_actor_unregister(JSContext *ctx,R2DWorldRuntime *w,JSValueConst node)
{
    if(w->rendering){JS_ThrowTypeError(ctx,"Re2D World: actor registry is busy");return false;}
    for(int i=0;i<w->actor_count;i++)if(same(node,w->actors[i])){JS_FreeValue(ctx,w->actors[i]);memmove(w->actors+i,w->actors+i+1,(size_t)(w->actor_count-i-1)*sizeof(JSValue));w->actor_count--;return true;}
    return true;
}
void r2d_world_runtime_actors_free(R2DWorldRuntime *w)
{
    r2d_world_gpu_free(w);
    for(int i=0;i<w->actor_count;i++)JS_FreeValueRT(w->runtime,w->actors[i]);
    for(int i=0;i<w->atlas_count;i++){JS_FreeValueRT(w->runtime,w->atlas_actors[i].node);free(w->atlas_actors[i].atlas);free(w->atlas_actors[i].frame);}
    for(int i=0;i<w->hit_count;i++)JS_FreeValueRT(w->runtime,w->hit_entries[i].node);
    free(w->actors);free(w->frame_handles);free(w->frame_positions);free(w->frame_images);free(w->frame_sizes);
    free(w->frame_kinds);free(w->frame_revisions);free(w->frame_blends);free(w->frame_keys);free(w->atlas_actors);
    free(w->hit_entries);free(w->trace_scratch);
    w->actors=w->frame_handles=NULL;w->frame_positions=NULL;w->frame_images=NULL;w->frame_sizes=NULL;
    w->frame_kinds=NULL;w->frame_revisions=NULL;w->frame_blends=NULL;w->frame_keys=NULL;w->atlas_actors=NULL;
    w->hit_entries=NULL;w->trace_scratch=NULL;w->hit_count=w->hit_capacity=0;w->trace_scratch_capacity=0;
    w->actor_count=w->actor_capacity=0;w->atlas_count=w->atlas_capacity=0;
}
static bool field(JSContext *ctx,JSValueConst node,const char *name,float *out)
{
    JSValue v=JS_GetPropertyStr(ctx,node,name);double n;
    if(JS_IsException(v))return false;int ok=JS_ToFloat64(ctx,&n,v);JS_FreeValue(ctx,v);
    if(ok<0)return false;if(!isfinite(n)||fabs(n)>1000000){JS_ThrowRangeError(ctx,"Re2D World: actor %s must be finite",name);return false;}*out=(float)n;return true;
}
static bool collect(JSContext *ctx,R2DWorldRuntime *w,const R2DRe2dView *view,JSValueConst node,int depth,bool attached,double root_yaw,double root_pitch)
{
    if(depth>32){JS_ThrowRangeError(ctx,"Re2D World: cyclic/deep actor attachments");return false;}
    JSValue rot=JS_GetPropertyStr(ctx,node,"rot_sprite");if(JS_IsException(rot))return false;
    if(JS_IsNull(rot)||JS_IsUndefined(rot)){JS_FreeValue(ctx,rot);return true;}
    JSValue handle=JS_GetPropertyStr(ctx,rot,"handle"),children=JS_GetPropertyStr(ctx,rot,"nativeChildren"),attachment=JS_GetPropertyStr(ctx,rot,"attachment");
    bool ok=false;
    if(JS_IsException(handle)||JS_IsException(children)||JS_IsException(attachment))goto done;
    if(!attached&&!JS_IsNull(attachment)&&!JS_IsUndefined(attachment)) {ok=true;goto done;}
    float p[5],sx,sy,facing;
    if(!field(ctx,node,"x",&p[0])||!field(ctx,node,"y",&p[1])||!field(ctx,node,"depth",&p[2])||!field(ctx,node,"w",&p[3])||!field(ctx,node,"h",&p[4])||!field(ctx,node,"scale_x",&sx)||!field(ctx,node,"scale_y",&sy)||!field(ctx,node,"angle",&facing))goto done;
    p[3]*=fabsf(sx);p[4]*=fabsf(sy);if(p[3]<=0||p[4]<=0){ok=true;goto done;}
    if(!attached) {
        float dx=p[0]-view->x,dy=p[1]-view->y,dist=fmaxf(.000001f,hypotf(dx,dy)),fx=dx/dist,fy=dy/dist;
        root_yaw=atan2(-cosf(facing)*fy+sinf(facing)*fx,-cosf(facing)*fx-sinf(facing)*fy)*180/3.141592653589793;
        root_pitch=atan2(p[2]+p[4]*.5f-view->eye,dist)*180/3.141592653589793;
    }
    if(w->pose_step>0){root_yaw=round(root_yaw/w->pose_step)*w->pose_step;root_pitch=round(root_pitch/w->pose_step)*w->pose_step;}
    if(!r2d_rotsprite_world_pose(ctx,handle,root_yaw,root_pitch))goto done;
    uint32_t count=0;
    if(JS_IsArray(children)) {
        JSValue length=JS_GetPropertyStr(ctx,children,"length");int converted=JS_ToUint32(ctx,&count,length);JS_FreeValue(ctx,length);if(converted<0)goto done;
        if(count>ACTOR_LIMIT){JS_ThrowRangeError(ctx,"Re2D World: attachment budget exhausted");goto done;}
    }
    // Preserve existing attachment ordering around the parent depth.
    for(uint32_t i=0;i<count;i++) {
        JSValue child=JS_GetPropertyUint32(ctx,children,i);float h;
        if(JS_IsException(child))goto done;
        bool valid=field(ctx,child,"depth",&h);if(valid&&h<p[2])valid=collect(ctx,w,view,child,depth+1,true,root_yaw,root_pitch);JS_FreeValue(ctx,child);if(!valid)goto done;
    }
    if(w->frame_count==ACTOR_LIMIT){JS_ThrowRangeError(ctx,"Re2D World: composition budget exhausted");goto done;}
    int index=w->frame_count++;w->frame_handles[index]=JS_DupValue(ctx,handle);memcpy(w->frame_positions+index*5,p,sizeof p);
    w->frame_kinds[index]=R2D_WORLD_FRAME_ROTSPRITE;
    w->frame_keys[index]=r2d_rotsprite_instance(ctx,handle);
    w->frame_revisions[index]=r2d_rotsprite_revision(ctx,handle);
    for(uint32_t i=0;i<count;i++) {
        JSValue child=JS_GetPropertyUint32(ctx,children,i);float h;
        if(JS_IsException(child))goto done;
        bool valid=field(ctx,child,"depth",&h);if(valid&&h>=p[2])valid=collect(ctx,w,view,child,depth+1,true,root_yaw,root_pitch);JS_FreeValue(ctx,child);if(!valid)goto done;
    }
    ok=true;
done:
    JS_FreeValue(ctx,handle);JS_FreeValue(ctx,children);JS_FreeValue(ctx,attachment);JS_FreeValue(ctx,rot);return ok;
}

// Native directional atlas pass. Runs after world visibility so an off-screen or
// fully culled sprite never pays for a cell crop. Appends frame entries in the
// same composition list as Re2DSprite actors.
static bool atlas_png(JSContext *ctx,const char *path,uint8_t **pixels,int *width,int *height);
static bool atlas_collect(JSContext *ctx,R2DWorldRuntime *w,const R2DRe2dView *view,int width,int height,float ortho)
{
    for(int a=0;a<w->atlas_count;a++) {
        R2DWorldAtlasActor *actor=&w->atlas_actors[a];
        float x,y,depth,ww,hh,facing;
        if(!field(ctx,actor->node,"x",&x)||!field(ctx,actor->node,"y",&y)||!field(ctx,actor->node,"depth",&depth)||
           !field(ctx,actor->node,"w",&ww)||!field(ctx,actor->node,"h",&hh)||!field(ctx,actor->node,"angle",&facing))return false;
        if(ww<=0||hh<=0)continue;
        int row=0;
        JSValue rv=JS_GetPropertyStr(ctx,actor->node,"sprite_row");
        if(JS_IsException(rv))return false;
        if(!JS_IsUndefined(rv)&&!JS_IsNull(rv)) {
            double d;
            if(JS_ToFloat64(ctx,&d,rv)<0){JS_FreeValue(ctx,rv);return false;}
            if(!isfinite(d)||fabs(d)>1000000){JS_FreeValue(ctx,rv);JS_ThrowRangeError(ctx,"Re2D World: sprite_row must be finite");return false;}
            row=(int)d;
        }
        JS_FreeValue(ctx,rv);
        const float dx=x-view->x,dy=y-view->y,dist=fmaxf(.000001f,hypotf(dx,dy));
        bool flip=false;
        const int column=r2d_world_atlas_direction(r2d_world_atlas_relative_yaw(facing,dx/dist,dy/dist),actor->directions,actor->mirror,&flip);
        float px,py;r2d_world_atlas_pivot(actor->pivot_mode,actor->pivot_x,actor->pivot_y,&px,&py);
        int side,cell_x,cell_y,cell_w,cell_h,dest_x,dest_y;float pivot_sx,pivot_sy;
        if(!r2d_world_atlas_placement(actor->cell_w,actor->cell_h,px,py,&side,&dest_x,&dest_y,&pivot_sx,&pivot_sy))continue;
        r2d_world_atlas_cell(column,row,actor->columns,actor->rows,actor->cell_w,actor->cell_h,&cell_x,&cell_y,&cell_w,&cell_h);
        const float wsq=ww*(float)side/(float)actor->cell_w,hsq=hh*(float)side/(float)actor->cell_h;
        const float wx=x+(0.5f-pivot_sx/(float)side)*wsq;
        const float bottom=depth-(1.0f-pivot_sy/(float)side)*hsq;
        const int span=r2d_world_span_at(&w->world,wx,y,bottom+hsq*0.5f);
        const bool visible=span>=0&&w->visibility.span_seen[span]&&r2d_world_sprite_visible(view,width,height,wx,y,bottom,wsq,hsq,ortho);
        if(visible) {
            if(!actor->frame||actor->frame_side!=side) {
                uint8_t *frame=realloc(actor->frame,(size_t)side*(size_t)side*4u);
                if(!frame){JS_ThrowOutOfMemory(ctx);return false;}
                actor->frame=frame;actor->frame_side=side;actor->last_column=-1;
            }
            if(actor->last_column!=column||actor->last_row!=row||actor->last_flip!=(flip?1:0)) {
                if(!r2d_world_atlas_crop(actor->atlas,actor->atlas_w,actor->atlas_h,cell_x,cell_y,cell_w,cell_h,flip,side,dest_x,dest_y,actor->frame)) {
                    JS_ThrowInternalError(ctx,"Re2D World: atlas cell crop failed");return false;
                }
                actor->last_column=column;actor->last_row=row;actor->last_flip=flip?1:0;actor->frame_revision++;
            }
        }
        if(w->frame_count==ACTOR_LIMIT){JS_ThrowRangeError(ctx,"Re2D World: composition budget exhausted");return false;}
        const int index=w->frame_count++;
        w->frame_handles[index]=JS_UNDEFINED;
        float *p=w->frame_positions+index*5;p[0]=wx;p[1]=y;p[2]=bottom;p[3]=wsq;p[4]=hsq;
        w->frame_kinds[index]=R2D_WORLD_FRAME_ATLAS;
        w->frame_sizes[index]=side;
        w->frame_keys[index]=(uint64_t)(a+1);
        w->frame_revisions[index]=actor->frame_revision;
        w->frame_blends[index]=actor->blend;
        w->frame_images[index]=visible?actor->frame:NULL;
        if(visible){w->visible_actor_count++;w->visible_atlas_count++;}
    }
    return true;
}
int r2d_world_runtime_frame(JSContext *ctx,R2DWorldRuntime *w,const R2DRe2dView *view,int width,int height,float ortho)
{
    if(w->rendering){JS_ThrowTypeError(ctx,"Re2D World: reentrant rendering");return -1;}
    if(!w->frame_handles) {
        JSValue *handles=calloc(ACTOR_LIMIT,sizeof *handles);float *positions=malloc(ACTOR_LIMIT*5*sizeof(float));
        const uint8_t **images=calloc(ACTOR_LIMIT,sizeof *images);int *sizes=calloc(ACTOR_LIMIT,sizeof *sizes);
        int *kinds=calloc(ACTOR_LIMIT,sizeof *kinds),*revisions=calloc(ACTOR_LIMIT,sizeof *revisions),*blends=calloc(ACTOR_LIMIT,sizeof *blends);
        uint64_t *keys=calloc(ACTOR_LIMIT,sizeof *keys);
        if(!handles||!positions||!images||!sizes||!kinds||!revisions||!blends||!keys){free(handles);free(positions);free(images);free(sizes);free(kinds);free(revisions);free(blends);free(keys);JS_ThrowOutOfMemory(ctx);return -1;}
        w->frame_handles=handles;w->frame_positions=positions;w->frame_images=images;w->frame_sizes=sizes;
        w->frame_kinds=kinds;w->frame_revisions=revisions;w->frame_blends=blends;w->frame_keys=keys;
    }
    r2d_world_audio_step(w,view);
    Uint64 frame_start=SDL_GetPerformanceCounter(),phase=frame_start;double ms=1000.0/SDL_GetPerformanceFrequency();
    w->rendering=true;w->frame_count=0;w->visible_actor_count=0;w->visible_atlas_count=0;w->poses_updated=w->poses_deferred=0;w->gpu_draws=w->gpu_material_batches=w->gpu_shadow_updates=0;w->shadow_ms=w->gpu_submit_ms=w->gpu_completion_ms=0;int result=-1;
    for(int i=0;i<w->actor_count;i++)if(!collect(ctx,w,view,w->actors[i],0,false,0,0))goto done;
    if(w->disposed){JS_ThrowTypeError(ctx,"Re2D World: world disposed during actor query");goto done;}
    if(width!=w->width||height!=w->height||!w->owners) {
        size_t n=(size_t)width*height;uint8_t *rgba=malloc(n*4);float *z=malloc(n*sizeof(float));R2DWorldPixelOwner *owners=malloc(n*sizeof *owners);
        if(!rgba||!z||!owners){free(rgba);free(z);free(owners);JS_ThrowOutOfMemory(ctx);goto done;}
        int texture=r2d_texture_create_rgba(w->renderer,NULL,width,height),sprite=texture<0?-1:r2d_sprite_create(w->renderer,texture,0,0,(float)width,(float)height);
        if(sprite<0){free(rgba);free(z);free(owners);if(texture>=0)r2d_texture_free(w->renderer,texture);JS_ThrowInternalError(ctx,"Re2D World: target allocation failed");goto done;}
        if(w->texture>=0)r2d_texture_free(w->renderer,w->texture);free(w->rgba);free(w->depth);free(w->owners);
        w->rgba=rgba;w->depth=z;w->owners=owners;w->texture=texture;w->sprite=sprite;w->width=width;w->height=height;
    }
    phase=SDL_GetPerformanceCounter();
    if(!r2d_world_visibility(&w->world,view,ortho,&w->visibility)){JS_ThrowOutOfMemory(ctx);goto done;}
    w->visibility_ms=(SDL_GetPerformanceCounter()-phase)*ms;phase=SDL_GetPerformanceCounter();
    if(!r2d_world_light_rebuild(&w->world)){JS_ThrowOutOfMemory(ctx);goto done;}
    w->light_cull_ms=(SDL_GetPerformanceCounter()-phase)*ms;
    bool lights[R2D_WORLD_MAX_LIGHTS]={0};w->visible_lights=w->shadowed_lights=0;
    for(int i=0;i<w->visibility.span_count;i++){int span=w->visibility.spans[i];for(int j=0;j<w->world.span_light_counts[span];j++)lights[w->world.span_light_refs[span*R2D_WORLD_LIGHTS_PER_SPAN+j]]=true;}
    for(int i=0;i<R2D_WORLD_MAX_LIGHTS;i++)if(lights[i]){w->visible_lights++;if(w->world.shadow_mask[i])w->shadowed_lights++;}
    phase=SDL_GetPerformanceCounter();
    if(!atlas_collect(ctx,w,view,width,height,ortho))goto done;
    // Resolve all script properties before borrowing synthesis memory.
    int cursor=w->frame_count?w->pose_cursor%w->frame_count:0,next_cursor=cursor;
    for(int k=0;k<w->frame_count;k++) {
        int i=(cursor+k)%w->frame_count;
        if(w->frame_kinds[i]!=R2D_WORLD_FRAME_ROTSPRITE)continue;
        const float *p=w->frame_positions+i*5;int span=r2d_world_span_at(&w->world,p[0],p[1],p[2]+p[4]*.5f);
        bool visible=span>=0&&w->visibility.span_seen[span]&&r2d_world_sprite_visible(view,width,height,p[0],p[1],p[2],p[3],p[4],ortho);
        bool dirty=visible&&r2d_rotsprite_dirty(ctx,w->frame_handles[i]),synthesize=visible&&(w->pose_budget==0||w->poses_updated<w->pose_budget);
        const uint8_t *image=r2d_rotsprite_pixels(ctx,w->frame_handles[i],&w->frame_sizes[i],synthesize);if(!image)goto done;
        if(dirty){if(synthesize){w->poses_updated++;next_cursor=(i+1)%w->frame_count;}else w->poses_deferred++;}
        w->frame_images[i]=visible?image:NULL;if(visible)w->visible_actor_count++;
    }
    w->pose_cursor=next_cursor;
    w->actor_ms=(SDL_GetPerformanceCounter()-phase)*ms;phase=SDL_GetPerformanceCounter();
    if(w->gpu_enabled||w->debug_view==R2D_WORLD_DEBUG_OVERDRAW){if(!r2d_world_gpu_frame(ctx,w,view,ortho)){r2d_world_gpu_free(w);JS_ThrowInternalError(ctx,"Re2D World GPU: %s",SDL_GetError());goto done;}}
    else r2d_world_frame_targets(&w->world,view,width,height,w->rgba,w->depth,ortho,&w->visibility,w->owners);
    w->surface_ms=(SDL_GetPerformanceCounter()-phase)*ms;phase=SDL_GetPerformanceCounter();
    if(!w->gpu_enabled&&w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW)for(int i=0;i<w->frame_count;i++){const float *p=w->frame_positions+i*5;
        if(w->frame_kinds[i]==R2D_WORLD_FRAME_ATLAS){r2d_world_stamp_samples_ex(&w->world,view,width,height,w->rgba,w->depth,w->frame_images[i],NULL,w->frame_sizes[i],p[0],p[1],p[2],p[3],p[4],ortho,w->owners,i,w->frame_blends[i]);continue;}
        const float *samples=r2d_rotsprite_sample_depth(ctx,w->frame_handles[i]);r2d_world_stamp_samples(&w->world,view,width,height,w->rgba,w->depth,w->frame_images[i],samples,w->frame_sizes[i],p[0],p[1],p[2],p[3],p[4],ortho,w->owners,i);}
    if(!w->gpu_enabled&&w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW)r2d_world_frame_decals(&w->world,view,width,height,w->rgba,w->depth,ortho,&w->visibility,w->owners);
    if(!w->gpu_enabled&&w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW&&!r2d_world_frame_transparent(&w->world,view,width,height,w->rgba,w->depth,ortho,&w->visibility)){JS_ThrowOutOfMemory(ctx);goto done;}
    r2d_world_debug_pixels(&w->world,view,&w->visibility,ortho,w->debug_view,width,height,w->rgba,w->depth,w->owners);
    w->composition_ms=(SDL_GetPerformanceCounter()-phase)*ms;phase=SDL_GetPerformanceCounter();
    if((!w->gpu_enabled||w->debug_view!=R2D_WORLD_DEBUG_FINAL)&&!r2d_texture_upload_region(w->renderer,w->texture,0,0,width,height,w->rgba,width*4)){JS_ThrowInternalError(ctx,"Re2D World: target upload failed");goto done;}
    w->upload_ms=(SDL_GetPerformanceCounter()-phase)*ms;result=w->sprite;
done:
    for(int i=0;i<w->frame_count;i++){if(w->frame_kinds[i]==R2D_WORLD_FRAME_ROTSPRITE)JS_FreeValue(ctx,w->frame_handles[i]);w->frame_handles[i]=JS_UNDEFINED;}
    w->frame_ms=(SDL_GetPerformanceCounter()-frame_start)*ms;w->rendering=false;return result;
}

static bool material_png(JSContext *ctx,const char *path,R2DWorldTexture *out,int max_width)
{
    if(!path||!path[0])return true;
    R2DScript *script=JS_GetContextOpaque(ctx);char full[4096];r2d_app_resolve_path(script->app,full,sizeof full,path);
    SDL_Surface *image=NULL;
    if(r2d_vfs_has(full)) {
        size_t size=0;uint8_t *bytes=r2d_vfs_read(full,&size);
        if(bytes){SDL_IOStream *io=SDL_IOFromConstMem(bytes,size);if(io){image=IMG_LoadPNG_IO(io);SDL_CloseIO(io);}r2d_vfs_free(bytes);}
    } else {SDL_IOStream *io=SDL_IOFromFile(full,"rb");if(io){image=IMG_LoadPNG_IO(io);SDL_CloseIO(io);}}
    if(!image){JS_ThrowTypeError(ctx,"Re2D World: cannot read material PNG %s",path);return false;}
    if(image->w<1||image->h<1||image->w>max_width||image->h>2048){SDL_DestroySurface(image);JS_ThrowRangeError(ctx,"Re2D World: material PNG dimensions 1..2048");return false;}
    SDL_Surface *rgba=SDL_ConvertSurface(image,SDL_PIXELFORMAT_RGBA32);SDL_DestroySurface(image);
    if(!rgba){JS_ThrowOutOfMemory(ctx);return false;}
    out->pixels=malloc((size_t)rgba->w*rgba->h*4);
    if(!out->pixels){SDL_DestroySurface(rgba);JS_ThrowOutOfMemory(ctx);return false;}
    out->width=rgba->w;out->height=rgba->h;
    for(int y=0;y<rgba->h;y++)memcpy(out->pixels+(size_t)y*rgba->w*4,(uint8_t *)rgba->pixels+(size_t)y*rgba->pitch,(size_t)rgba->w*4);
    SDL_DestroySurface(rgba);return true;
}
bool r2d_world_runtime_material(JSContext *ctx,R2DWorldRuntime *w,const char *name,const char *albedo,const char *normal,const char *emissive,float strength,float u_scale,float v_scale,int blend,float opacity,bool world_uv,bool linear)
{
    if(!name||strlen(name)>=64||!albedo||!albedo[0]){JS_ThrowTypeError(ctx,"Re2D World: material requires name and albedo PNG");return false;}
    R2DWorldMaterial m={0};strcpy(m.name,name);m.emissive_strength=strength;m.u_scale=u_scale;m.v_scale=v_scale;m.blend=blend;m.opacity=opacity;m.world_uv=world_uv;m.linear=linear;
    bool ok=material_png(ctx,albedo,&m.albedo,2048)&&material_png(ctx,normal,&m.normal,2048)&&material_png(ctx,emissive,&m.emissive,2048);
    if(ok&&r2d_world_material_set(&w->world,&m)<0){JS_ThrowRangeError(ctx,"Re2D World: invalid material or material budget exhausted");ok=false;}
    if(ok)r2d_world_gpu_material_dirty(w);
    r2d_world_material_free(&m);return ok;
}

bool r2d_world_runtime_sky(JSContext *ctx,R2DWorldRuntime *w,const char *path,uint32_t color,float yaw,float exposure)
{
    R2DWorldTexture texture={0};
    size_t len=path?strlen(path):0;
    if(len>=4&&!SDL_strcasecmp(path+len-4,".exr")) {
        R2DScript *script=JS_GetContextOpaque(ctx);char full[4096],error[256];r2d_app_resolve_path(script->app,full,sizeof full,path);
        size_t size=0;bool packed=r2d_vfs_has(full);uint8_t *bytes=NULL;
        if(packed)bytes=r2d_vfs_read(full,&size);
        else {SDL_IOStream *io=SDL_IOFromFile(full,"rb");if(io){Sint64 n=SDL_GetIOSize(io);if(n>=8&&n<=64*1024*1024){size=(size_t)n;bytes=SDL_malloc(size);if(bytes&&SDL_ReadIO(io,bytes,size)!=size){SDL_free(bytes);bytes=NULL;}}SDL_CloseIO(io);}}
        if(!bytes){JS_ThrowTypeError(ctx,"Re2D World: cannot read EXR %s (limit 64 MiB)",path);return false;}
        bool ok=r2d_world_exr_decode(bytes,size,exposure,&texture.pixels,&texture.width,&texture.height,error,sizeof error);
        if(packed)r2d_vfs_free(bytes);else SDL_free(bytes);
        if(!ok){JS_ThrowTypeError(ctx,"Re2D World EXR: %s",error);return false;}
    }else {
        if(!material_png(ctx,path,&texture,4096))return false;
        if(exposure!=0)for(size_t i=0;i<(size_t)texture.width*texture.height;i++)for(int c=0;c<3;c++){
            float v=texture.pixels[i*4+c]/255.f,linear=v<=.04045f?v/12.92f:powf((v+.055f)/1.055f,2.4f);linear=fminf(1,linear*exp2f(exposure));
            texture.pixels[i*4+c]=(uint8_t)roundf(255*(linear<=.0031308f?12.92f*linear:1.055f*powf(linear,1/2.4f)-.055f));
        }
    }
    free(w->world.sky.pixels);w->world.sky=texture;w->world.sky_color=color;w->world.sky_yaw=yaw;
    r2d_world_gpu_material_dirty(w);return true;
}


// Decode a flat atlas PNG once. Atlas sheets may be larger than a surface
// material but stay bounded; the runtime owns the decoded RGBA8 pixels.
static bool atlas_png(JSContext *ctx,const char *path,uint8_t **pixels,int *width,int *height)
{
    if(!path||!path[0]){JS_ThrowTypeError(ctx,"Re2D World: atlas sprite requires an atlas PNG");return false;}
    R2DScript *script=JS_GetContextOpaque(ctx);char full[4096];r2d_app_resolve_path(script->app,full,sizeof full,path);
    SDL_Surface *image=NULL;
    if(r2d_vfs_has(full)) {
        size_t size=0;uint8_t *bytes=r2d_vfs_read(full,&size);
        if(bytes){SDL_IOStream *io=SDL_IOFromConstMem(bytes,size);if(io){image=IMG_LoadPNG_IO(io);SDL_CloseIO(io);}r2d_vfs_free(bytes);}
    } else {SDL_IOStream *io=SDL_IOFromFile(full,"rb");if(io){image=IMG_LoadPNG_IO(io);SDL_CloseIO(io);}}
    if(!image){JS_ThrowTypeError(ctx,"Re2D World: cannot read atlas PNG %s",path);return false;}
    if(image->w<1||image->h<1||image->w>4096||image->h>4096){SDL_DestroySurface(image);JS_ThrowRangeError(ctx,"Re2D World: atlas PNG dimensions 1..4096");return false;}
    SDL_Surface *rgba=SDL_ConvertSurface(image,SDL_PIXELFORMAT_RGBA32);SDL_DestroySurface(image);
    if(!rgba){JS_ThrowOutOfMemory(ctx);return false;}
    uint8_t *copy=malloc((size_t)rgba->w*(size_t)rgba->h*4u);
    if(!copy){SDL_DestroySurface(rgba);JS_ThrowOutOfMemory(ctx);return false;}
    for(int y=0;y<rgba->h;y++)memcpy(copy+(size_t)y*rgba->w*4,(uint8_t *)rgba->pixels+(size_t)y*rgba->pitch,(size_t)rgba->w*4);
    *pixels=copy;*width=rgba->w;*height=rgba->h;
    SDL_DestroySurface(rgba);return true;
}
bool r2d_world_atlas_register(JSContext *ctx,R2DWorldRuntime *w,JSValueConst node,const char *path,
    int columns,int rows,int directions,bool mirror,int cell_w,int cell_h,
    int pivot,float pivot_x,float pivot_y,float width,float height,int blend)
{
    if(w->rendering){JS_ThrowTypeError(ctx,"Re2D World: atlas registry is busy");return false;}
    if(!JS_IsObject(node)){JS_ThrowTypeError(ctx,"Re2D World: atlas sprite needs a node");return false;}
    if(w->atlas_count==R2D_WORLD_ATLAS_ACTOR_LIMIT){JS_ThrowRangeError(ctx,"Re2D World: atlas sprite budget exhausted");return false;}
    if(columns<1||columns>64||rows<1||rows>64){JS_ThrowRangeError(ctx,"Re2D World: atlas columns/rows 1..64");return false;}
    if(directions<R2D_WORLD_ATLAS_DIRECTIONS_MIN||directions>R2D_WORLD_ATLAS_DIRECTIONS_MAX){JS_ThrowRangeError(ctx,"Re2D World: atlas directions 1..16");return false;}
    if(cell_w<R2D_WORLD_ATLAS_CELL_MIN||cell_h<R2D_WORLD_ATLAS_CELL_MIN||cell_w>R2D_WORLD_ATLAS_CELL_MAX||cell_h>R2D_WORLD_ATLAS_CELL_MAX){JS_ThrowRangeError(ctx,"Re2D World: atlas cell size 1..1024");return false;}
    if(pivot<R2D_WORLD_ATLAS_PIVOT_CENTER||pivot>R2D_WORLD_ATLAS_PIVOT_CUSTOM){JS_ThrowRangeError(ctx,"Re2D World: atlas pivot mode 0..3");return false;}
    if(blend<R2D_WORLD_MASKED||blend>R2D_WORLD_ADDITIVE){JS_ThrowRangeError(ctx,"Re2D World: atlas blend mode 0..3");return false;}
    if(!isfinite(pivot_x)||!isfinite(pivot_y)||!isfinite(width)||!isfinite(height)||width<=0||height<=0){JS_ThrowRangeError(ctx,"Re2D World: atlas pivot/size must be finite and positive width/height");return false;}
    for(int i=0;i<w->atlas_count;i++)if(same(node,w->atlas_actors[i].node)){JS_ThrowTypeError(ctx,"Re2D World: node already has an atlas sprite");return false;}
    R2DWorldAtlasActor actor={0};
    if(!atlas_png(ctx,path,&actor.atlas,&actor.atlas_w,&actor.atlas_h))return false;
    if(columns*cell_w>actor.atlas_w||rows*cell_h>actor.atlas_h){
        free(actor.atlas);
        JS_ThrowRangeError(ctx,"Re2D World: atlas grid %dx%d cells %dx%d does not fit %dx%d image",columns,rows,cell_w,cell_h,actor.atlas_w,actor.atlas_h);
        return false;
    }
    if(w->atlas_count==w->atlas_capacity){int n=w->atlas_capacity?w->atlas_capacity*2:8;R2DWorldAtlasActor *p=realloc(w->atlas_actors,(size_t)n*sizeof *p);if(!p){free(actor.atlas);JS_ThrowOutOfMemory(ctx);return false;}w->atlas_actors=p;w->atlas_capacity=n;}
    actor.node=JS_DupValue(ctx,node);
    actor.columns=columns;actor.rows=rows;actor.directions=directions;actor.mirror=mirror;
    actor.cell_w=cell_w;actor.cell_h=cell_h;actor.pivot_mode=pivot;actor.pivot_x=pivot_x;actor.pivot_y=pivot_y;
    actor.width=width;actor.height=height;actor.blend=blend;
    w->atlas_actors[w->atlas_count++]=actor;return true;
}
bool r2d_world_atlas_unregister(JSContext *ctx,R2DWorldRuntime *w,JSValueConst node)
{
    if(w->rendering){JS_ThrowTypeError(ctx,"Re2D World: atlas registry is busy");return false;}
    for(int i=0;i<w->atlas_count;i++)if(same(node,w->atlas_actors[i].node)){
        JS_FreeValue(ctx,w->atlas_actors[i].node);free(w->atlas_actors[i].atlas);free(w->atlas_actors[i].frame);
        memmove(w->atlas_actors+i,w->atlas_actors+i+1,(size_t)(w->atlas_count-i-1)*sizeof(R2DWorldAtlasActor));
        w->atlas_count--;return true;
    }
    return true;
}


// --- P0-B: actor hit proxies + unified world+actor trace -------------------
bool r2d_world_hit_register(JSContext *ctx,R2DWorldRuntime *w,JSValueConst node,float radius,float bottom,float top,int category)
{
    if(w->rendering){JS_ThrowTypeError(ctx,"Re2D World: hit registry is busy");return false;}
    if(!JS_IsObject(node)){JS_ThrowTypeError(ctx,"Re2D World: worldHit needs a node");return false;}
    if(!isfinite(radius)||!isfinite(bottom)||!isfinite(top)||radius<0||top<=bottom){JS_ThrowRangeError(ctx,"Re2D World: worldHit radius>=0 and top>bottom");return false;}
    // Category is an index: 1 = enemy, 2 = breakable. The trace core shifts it
    // into the caller mask, so the public API does not expose raw bit values.
    if(category!=1&&category!=2){JS_ThrowRangeError(ctx,"Re2D World: worldHit category enemy|breakable");return false;}
    for(int i=0;i<w->hit_count;i++)if(same(node,w->hit_entries[i].node)){JS_ThrowTypeError(ctx,"Re2D World: node already has a hit proxy");return false;}
    if(w->hit_count==R2D_WORLD_HIT_PROXY_LIMIT){JS_ThrowRangeError(ctx,"Re2D World: hit proxy budget exhausted");return false;}
    if(w->hit_count==w->hit_capacity){int n=w->hit_capacity?w->hit_capacity*2:16;R2DWorldHitEntry *p=realloc(w->hit_entries,(size_t)n*sizeof *p);if(!p){JS_ThrowOutOfMemory(ctx);return false;}w->hit_entries=p;w->hit_capacity=n;}
    R2DWorldHitEntry *e=&w->hit_entries[w->hit_count++];
    e->node=JS_DupValue(ctx,node);e->radius=radius;e->bottom_offset=bottom;e->top_offset=top;e->category=category;
    return true;
}
bool r2d_world_hit_unregister(JSContext *ctx,R2DWorldRuntime *w,JSValueConst node)
{
    if(w->rendering){JS_ThrowTypeError(ctx,"Re2D World: hit registry is busy");return false;}
    for(int i=0;i<w->hit_count;i++)if(same(node,w->hit_entries[i].node)){
        JS_FreeValue(ctx,w->hit_entries[i].node);
        memmove(w->hit_entries+i,w->hit_entries+i+1,(size_t)(w->hit_count-i-1)*sizeof(R2DWorldHitEntry));
        w->hit_count--;return true;
    }
    return true;
}
static bool trace_proxies(JSContext *ctx,R2DWorldRuntime *w,const float from[3],const float to[3],int mask,int ignore_node,R2DWorldHitProxy **out,int *out_count)
{
    (void)from;(void)to;
    if(w->hit_count>w->trace_scratch_capacity) {
        R2DWorldHitProxy *p=realloc(w->trace_scratch,(size_t)w->hit_count*sizeof *p);
        if(!p){JS_ThrowOutOfMemory(ctx);return false;}
        w->trace_scratch=p;w->trace_scratch_capacity=w->hit_count;
    }
    int count=0;
    for(int i=0;i<w->hit_count;i++) {
        R2DWorldHitEntry *e=&w->hit_entries[i];
        if(!(mask&(1<<e->category)))continue;
        if(i==ignore_node)continue;
        float x,y,depth;
        if(!field(ctx,e->node,"x",&x)||!field(ctx,e->node,"y",&y)||!field(ctx,e->node,"depth",&depth))return false;
        R2DWorldHitProxy *p=&w->trace_scratch[count++];
        p->x=x;p->y=y;p->bottom=depth+e->bottom_offset;p->top=depth+e->top_offset;p->radius=e->radius;
        p->category=e->category;p->node=i;
    }
    *out=w->trace_scratch;*out_count=count;return true;
}
// Native trace reads registered node positions at query time, so moving actors
// need no per-frame registry update. Proxy filtering happens here; the mask
// handed to the core only toggles static world geometry.
int r2d_world_trace_query(JSContext *ctx,R2DWorldRuntime *w,const float from[3],const float to[3],int mask,int ignore_node,R2DWorldTraceResult *out)
{
    for(int i=0;i<3;i++)if(!isfinite(from[i])||!isfinite(to[i])){JS_ThrowRangeError(ctx,"Re2D World: trace needs finite from/to");return -1;}
    R2DWorldHitProxy *proxies;int count;
    if(!trace_proxies(ctx,w,from,to,mask,ignore_node,&proxies,&count))return -1;
    int core_mask=(mask&R2D_WORLD_TRACE_WORLD?R2D_WORLD_TRACE_WORLD:0)|R2D_WORLD_TRACE_ENEMY|R2D_WORLD_TRACE_BREAKABLE;
    return r2d_world_trace_ray(&w->world,proxies,count,from,to,core_mask,-1,out)?1:0;
}
int r2d_world_trace_query_all(JSContext *ctx,R2DWorldRuntime *w,const float from[3],const float to[3],int mask,int ignore_node,R2DWorldTraceResult *out,int capacity)
{
    R2DWorldHitProxy *proxies;int count;
    if(!trace_proxies(ctx,w,from,to,mask,ignore_node,&proxies,&count))return -1;
    int core_mask=(mask&R2D_WORLD_TRACE_WORLD?R2D_WORLD_TRACE_WORLD:0)|R2D_WORLD_TRACE_ENEMY|R2D_WORLD_TRACE_BREAKABLE;
    return r2d_world_trace_collect(&w->world,proxies,count,from,to,core_mask,-1,out,capacity);
}

void r2d_world_audio_step(R2DWorldRuntime *w,const R2DRe2dView *v) {
    if(!w->audio)return;
    for(int i=0;i<R2D_AUDIO_CHANNELS;i++) {
        R2DWorldAudioSource *s=&w->sources[i];if(!s->active)continue;
        if(s->generation!=w->audio->channel_generation[i]||!r2d_audio_channel_playing(w->audio,i)){s->active=false;continue;}
        float dx=s->x-v->x,dy=s->y-v->y,dh=s->h-v->eye,d=sqrtf(dx*dx+dy*dy+dh*dh),norm=fmaxf(.0001f,d);
        s->distance=d;float taper=fmaxf(0,1-(d/s->range)*(d/s->range));
        float origin[3]={v->x,v->y,v->eye},direction[3]={dx,dy,dh};R2DWorldHit hit;
        s->occluded=d>.01f&&r2d_world_ray(&w->world,origin,direction,.001f,.999f,&hit);
        s->gain=s->volume*fminf(1,s->reference/fmaxf(s->reference,d))*taper*taper*(s->occluded?.18f:1);
        s->cutoff=s->occluded?700:22000; s->current_gain+=(s->gain-s->current_gain)*.2f;
        float forward=dx*v->cos_yaw+dy*v->sin_yaw,right=-dx*v->sin_yaw+dy*v->cos_yaw;
        float up=dh*v->cos_pitch-forward*v->sin_pitch,back=-(forward*v->cos_pitch+dh*v->sin_pitch);
        r2d_audio_world_channel(w->audio,i,true,s->hrtf,right/norm,up/norm,d>.0001f?back/norm:-1,s->current_gain,s->cutoff);
    }
}
void r2d_world_audio_free(R2DWorldRuntime *w) {
    if(!w->audio)return;
    for(int i=0;i<R2D_AUDIO_CHANNELS;i++){R2DWorldAudioSource *s=&w->sources[i];if(s->active&&s->generation==w->audio->channel_generation[i]){r2d_audio_world_channel(w->audio,i,false,false,0,0,-1,0,22000);r2d_audio_stop_channel(w->audio,i,0);}s->active=false;}
}
