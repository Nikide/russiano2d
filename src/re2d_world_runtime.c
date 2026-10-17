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
    for(int i=0;i<w->trigger_count;i++){free(w->triggers[i].id);free(w->triggers[i].target);}
    free(w->actors);free(w->frame_handles);free(w->frame_positions);free(w->frame_images);free(w->frame_sizes);
    free(w->frame_kinds);free(w->frame_revisions);free(w->frame_blends);free(w->frame_tints);free(w->frame_keys);free(w->atlas_actors);
    free(w->hit_entries);free(w->trace_scratch);free(w->movers);free(w->triggers);
    r2d_world_nav_free(w);r2d_world_particles_free(w);r2d_world_secret_free(w);r2d_world_terrain_free(w);r2d_world_audio_zone_free(w);r2d_world_polywall_free(w);
    w->actors=w->frame_handles=NULL;w->frame_positions=NULL;w->frame_images=NULL;w->frame_sizes=NULL;
    w->frame_kinds=NULL;w->frame_revisions=NULL;w->frame_blends=NULL;w->frame_tints=NULL;w->frame_keys=NULL;w->atlas_actors=NULL;
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
    w->frame_tints[index*4]=w->frame_tints[index*4+1]=w->frame_tints[index*4+2]=w->frame_tints[index*4+3]=1.0f;
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
static void particles_draw_cpu(R2DWorldRuntime *,const R2DRe2dView *,int,int,uint8_t *,float *,float);
static bool particle_collect_gpu(R2DWorldRuntime *,const R2DRe2dView *,int,int,float);
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
        float px_=x,py_=y,pdepth=depth;
        if(actor->offset_x!=0||actor->offset_y!=0||actor->offset_h!=0){
            const float ca=cosf(facing),sa=sinf(facing);
            const float right_x=ca,right_y=sa,forward_x=-sa,forward_y=ca;
            px_+=right_x*actor->offset_x+forward_x*actor->offset_y;
            py_+=right_y*actor->offset_x+forward_y*actor->offset_y;
            pdepth+=actor->offset_h;
        }
        const float dx=px_-view->x,dy=py_-view->y,dist=fmaxf(.000001f,hypotf(dx,dy));
        bool flip=false;
        const int column=r2d_world_atlas_direction(r2d_world_atlas_relative_yaw(facing,dx/dist,dy/dist),actor->directions,actor->mirror,&flip);
        float px,py;r2d_world_atlas_pivot(actor->pivot_mode,actor->pivot_x,actor->pivot_y,&px,&py);
        int side,cell_x,cell_y,cell_w,cell_h,dest_x,dest_y;float pivot_sx,pivot_sy;
        if(!r2d_world_atlas_placement(actor->cell_w,actor->cell_h,px,py,&side,&dest_x,&dest_y,&pivot_sx,&pivot_sy))continue;
        r2d_world_atlas_cell(column,row,actor->columns,actor->rows,actor->cell_w,actor->cell_h,&cell_x,&cell_y,&cell_w,&cell_h);
        const float wsq=ww*(float)side/(float)actor->cell_w,hsq=hh*(float)side/(float)actor->cell_h;
        const float wx=px_+(0.5f-pivot_sx/(float)side)*wsq;
        const float bottom=pdepth-(1.0f-pivot_sy/(float)side)*hsq;
        const int span=r2d_world_span_at(&w->world,wx,py_,bottom+hsq*0.5f);
        const bool visible=span>=0&&w->visibility.span_seen[span]&&r2d_world_sprite_visible(view,width,height,wx,py_,bottom,wsq,hsq,ortho);
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
        float *p=w->frame_positions+index*5;p[0]=wx;p[1]=py_;p[2]=bottom;p[3]=wsq;p[4]=hsq;
        w->frame_kinds[index]=R2D_WORLD_FRAME_ATLAS;
        w->frame_sizes[index]=side;
        w->frame_keys[index]=(uint64_t)(a+1);
        w->frame_revisions[index]=actor->frame_revision;
        w->frame_blends[index]=actor->blend;
        w->frame_tints[index*4]=w->frame_tints[index*4+1]=w->frame_tints[index*4+2]=w->frame_tints[index*4+3]=1.0f;
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
        uint64_t *keys=calloc(ACTOR_LIMIT,sizeof *keys);float *tints=calloc((size_t)ACTOR_LIMIT*4,sizeof *tints);
        if(!handles||!positions||!images||!sizes||!kinds||!revisions||!blends||!keys||!tints){free(handles);free(positions);free(images);free(sizes);free(kinds);free(revisions);free(blends);free(keys);free(tints);JS_ThrowOutOfMemory(ctx);return -1;}
        w->frame_handles=handles;w->frame_positions=positions;w->frame_images=images;w->frame_sizes=sizes;
        w->frame_kinds=kinds;w->frame_revisions=revisions;w->frame_blends=blends;w->frame_keys=keys;w->frame_tints=tints;
    }
    if(w->frame_tints)for(int i=0;i<ACTOR_LIMIT;i++){w->frame_tints[i*4]=w->frame_tints[i*4+1]=w->frame_tints[i*4+2]=w->frame_tints[i*4+3]=1.0f;}
    r2d_world_audio_step(w,view);
    Uint64 frame_start=SDL_GetPerformanceCounter(),phase=frame_start;double ms=1000.0/SDL_GetPerformanceFrequency();
    w->rendering=true;w->frame_count=0;w->visible_actor_count=0;w->visible_atlas_count=0;w->particles_drawn=0;w->poses_updated=w->poses_deferred=0;w->gpu_draws=w->gpu_material_batches=w->gpu_shadow_updates=0;w->shadow_ms=w->gpu_submit_ms=w->gpu_completion_ms=0;int result=-1;
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
    if(w->gpu_enabled&&!particle_collect_gpu(w,view,width,height,ortho))goto done;
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
    if(!w->gpu_enabled&&w->debug_view!=R2D_WORLD_DEBUG_OVERDRAW)particles_draw_cpu(w,view,width,height,w->rgba,w->depth,ortho);
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
    int pivot,float pivot_x,float pivot_y,float width,float height,int blend,
    float offset_x,float offset_y,float offset_h)
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
    actor.width=width;actor.height=height;actor.blend=blend;actor.offset_x=offset_x;actor.offset_y=offset_y;actor.offset_h=offset_h;
    w->atlas_actors[w->atlas_count++]=actor;return true;
}
bool r2d_world_atlas_unregister(JSContext *ctx,R2DWorldRuntime *w,JSValueConst node)
{
    if(w->rendering){JS_ThrowTypeError(ctx,"Re2D World: atlas registry is busy");return false;}
    bool removed=false;
    for(int i=w->atlas_count-1;i>=0;i--)if(same(node,w->atlas_actors[i].node)){
        JS_FreeValue(ctx,w->atlas_actors[i].node);free(w->atlas_actors[i].atlas);free(w->atlas_actors[i].frame);
        memmove(w->atlas_actors+i,w->atlas_actors+i+1,(size_t)(w->atlas_count-i-1)*sizeof(R2DWorldAtlasActor));
        w->atlas_count--;removed=true;
    }
    return removed?true:true;
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
    e->zone_count=0;
    return true;
}
bool r2d_world_hit_zones(R2DWorldRuntime *w,JSValueConst node,const R2DWorldHitZone *zones,int count)
{
    if(w->rendering||!zones||count<0||count>R2D_WORLD_HIT_ZONES)return false;
    for(int i=0;i<w->hit_count;i++)if(same(node,w->hit_entries[i].node)){
        R2DWorldHitEntry *e=&w->hit_entries[i];
        for(int z=0;z<count;z++){
            const R2DWorldHitZone *zone=&zones[z];
            if(!isfinite(zone->from)||!isfinite(zone->to)||!isfinite(zone->multiplier)||
               zone->from<0||zone->to>1||zone->to<=zone->from||zone->multiplier<0)return false;
        }
        for(int z=0;z<count;z++)e->zones[z]=zones[z];
        e->zone_count=count;return true;
    }
    return false;
}
void r2d_world_hit_zone_info(const R2DWorldHitEntry *e,float h,int *zone,float *multiplier)
{
    *zone=-1;*multiplier=1.0f;
    if(!e||e->zone_count<=0)return;
    const float bottom=e->bottom_offset,top=e->top_offset,span=top-bottom;
    if(!(span>0))return;
    const float t=(h-bottom)/span;
    for(int i=0;i<e->zone_count;i++)if(t>=e->zones[i].from&&t<=e->zones[i].to){*zone=i;*multiplier=e->zones[i].multiplier;return;}
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
    Uint64 start=SDL_GetPerformanceCounter();
    int result=0;
    for(int i=0;i<3;i++)if(!isfinite(from[i])||!isfinite(to[i])){JS_ThrowRangeError(ctx,"Re2D World: trace needs finite from/to");return -1;}
    R2DWorldHitProxy *proxies;int count;
    if(!trace_proxies(ctx,w,from,to,mask,ignore_node,&proxies,&count))return -1;
    int core_mask=(mask&R2D_WORLD_TRACE_WORLD?R2D_WORLD_TRACE_WORLD:0)|R2D_WORLD_TRACE_ENEMY|R2D_WORLD_TRACE_BREAKABLE;
    result=r2d_world_trace_ray(&w->world,proxies,count,from,to,core_mask,-1,out)?1:0;
    w->trace_calls++;
    w->trace_ms+=(double)(SDL_GetPerformanceCounter()-start)*1000.0/(double)SDL_GetPerformanceFrequency();
    return result;
}
int r2d_world_trace_query_all(JSContext *ctx,R2DWorldRuntime *w,const float from[3],const float to[3],int mask,int ignore_node,R2DWorldTraceResult *out,int capacity)
{
    R2DWorldHitProxy *proxies;int count;
    if(!trace_proxies(ctx,w,from,to,mask,ignore_node,&proxies,&count))return -1;
    int core_mask=(mask&R2D_WORLD_TRACE_WORLD?R2D_WORLD_TRACE_WORLD:0)|R2D_WORLD_TRACE_ENEMY|R2D_WORLD_TRACE_BREAKABLE;
    return r2d_world_trace_collect(&w->world,proxies,count,from,to,core_mask,-1,out,capacity);
}


// --- P0-E: movers ----------------------------------------------------------
static R2DWorldMoverEntry *mover_entry(R2DWorldRuntime *w,int token)
{
    for(int i=0;i<w->mover_count;i++)if(w->movers[i].active&&w->movers[i].token==token)return &w->movers[i];
    return NULL;
}
int r2d_world_mover_create(R2DWorldRuntime *w,int type,int span,int portal,float from,float to,float speed,float wait,bool auto_return)
{
    if(w->rendering)return -1;
    if(type<R2D_MOVER_DOOR||type>R2D_MOVER_PLATFORM||!isfinite(from)||!isfinite(to)||!isfinite(speed)||!isfinite(wait)||speed<=0||wait<0)return -1;
    if((span>=0)==(portal>=0))return -1;
    if(span>=w->world.span_count)return -1;
    if(portal>=w->world.portal_count)return -1;
    float top=0;if(span>=0){top=w->world.spans[span].top;if(to>=top||from>=top||from==to)return -1;}
    int slot=-1;for(int i=0;i<w->mover_count;i++)if(!w->movers[i].active){slot=i;break;}
    if(slot<0){if(w->mover_count==R2D_WORLD_MOVER_LIMIT)return -1;slot=w->mover_count++;
        if(slot>=w->mover_capacity){int n=w->mover_capacity?w->mover_capacity*2:8;R2DWorldMoverEntry *p=realloc(w->movers,(size_t)n*sizeof *p);if(!p){w->mover_count--;return -1;}w->movers=p;w->mover_capacity=n;}}
    R2DWorldMoverEntry *e=&w->movers[slot];memset(e,0,sizeof *e);
    if(!r2d_world_mover_init(&e->mover,type,span,from,to,speed,wait,auto_return))return -1;
    e->active=true;e->token=++w->next_mover_token;e->span=span;e->portal=portal;e->kind=type;e->span_top=top;e->generation++;
    if(span>=0)r2d_world_span_set_heights(&w->world,span,from,top);
    if(portal>=0)r2d_world_portal_set_closed(&w->world,portal,true);
    return e->token;
}
bool r2d_world_mover_remove(R2DWorldRuntime *w,int token)
{
    R2DWorldMoverEntry *e=mover_entry(w,token);if(!e)return true;
    e->active=false;e->generation++;return true;
}
void r2d_world_mover_intent(R2DWorldRuntime *w,int token,int action)
{
    R2DWorldMoverEntry *e=mover_entry(w,token);if(!e)return;
    if(action==0)r2d_world_mover_open(&e->mover);
    else if(action==1)r2d_world_mover_close(&e->mover);
    else r2d_world_mover_toggle(&e->mover);
}
bool r2d_world_mover_block(R2DWorldRuntime *w,int token,bool blocking)
{
    R2DWorldMoverEntry *e=mover_entry(w,token);if(!e)return false;
    e->mover.blocking=blocking;return true;
}
bool r2d_world_mover_info(R2DWorldRuntime *w,int token,float out[6],unsigned *events)
{
    R2DWorldMoverEntry *e=mover_entry(w,token);if(!e)return false;
    if(out){out[0]=e->mover.position;out[1]=e->mover.fraction;out[2]=(float)e->mover.phase;out[3]=(float)e->mover.direction;out[4]=e->mover.timer;out[5]=(float)e->kind;}
    if(events)*events=e->events;
    e->events=0;
    return true;
}
void r2d_world_mover_advance(R2DWorldRuntime *w,float dt)
{
    if(w->rendering)return;
    if(!isfinite(dt))dt=0;if(dt<0)dt=0;if(dt>0.25f)dt=0.25f;
    for(int i=0;i<w->mover_count;i++){
        R2DWorldMoverEntry *e=&w->movers[i];if(!e->active)continue;
        unsigned ev=0;bool moved=r2d_world_mover_step(&e->mover,dt,&ev);
        e->events|=ev;
        if(!moved&&!ev)continue;
        if(e->span>=0)r2d_world_span_set_heights(&w->world,e->span,e->mover.position,e->span_top);
        if(e->portal>=0){
            // Smooth Portal 2.0: the mover timeline drives the open fraction, so
            // collision/visibility/light see the door at every intermediate step.
            r2d_world_portal_set_open(&w->world,e->portal,e->mover.fraction);
        }
    }
}
void r2d_world_mover_free(R2DWorldRuntime *w)
{
    free(w->movers);w->movers=NULL;w->mover_count=w->mover_capacity=0;w->next_mover_token=0;
}

// --- P0-F: semantic triggers ----------------------------------------------
static R2DWorldTriggerEntry *trigger_entry(R2DWorldRuntime *w,int token)
{
    for(int i=0;i<w->trigger_count;i++)if(w->triggers[i].active&&w->triggers[i].token==token)return &w->triggers[i];
    return NULL;
}
int r2d_world_trigger_create(R2DWorldRuntime *w,int type,const char *id,const char *target,float x,float y,float radius,float bottom,float top,bool once,float cooldown)
{
    if(w->rendering||!id||!id[0]||strlen(id)>=64)return -1;
    if(w->trigger_count==R2D_WORLD_TRIGGER_LIMIT)return -1;
    int slot=-1;for(int i=0;i<w->trigger_count;i++)if(!w->triggers[i].active){slot=i;break;}
    if(slot<0){slot=w->trigger_count++;
        if(slot>=w->trigger_capacity){int n=w->trigger_capacity?w->trigger_capacity*2:8;R2DWorldTriggerEntry *p=realloc(w->triggers,(size_t)n*sizeof *p);if(!p){w->trigger_count--;return -1;}w->triggers=p;w->trigger_capacity=n;}}
    R2DWorldTriggerEntry *e=&w->triggers[slot];memset(e,0,sizeof *e);
    if(!r2d_world_trigger_init(&e->trigger,type,id,target,x,y,radius,bottom,top,once,cooldown))return -1;
    e->id=SDL_strdup(id);e->target=target?SDL_strdup(target):NULL;
    if(!e->id){free(e->target);return -1;}
    e->active=true;e->token=++w->next_trigger_token;
    return e->token;
}
bool r2d_world_trigger_remove(R2DWorldRuntime *w,int token)
{
    R2DWorldTriggerEntry *e=trigger_entry(w,token);if(!e)return true;
    e->active=false;free(e->id);e->id=NULL;free(e->target);e->target=NULL;return true;
}
void r2d_world_trigger_advance(R2DWorldRuntime *w,float dt)
{
    if(w->rendering)return;
    for(int i=0;i<w->trigger_count;i++)if(w->triggers[i].active)r2d_world_trigger_step(&w->triggers[i].trigger,dt);
}
int r2d_world_trigger_tick(R2DWorldRuntime *w,float px,float py,float feet,int *tokens,int capacity)
{
    int count=0;
    for(int i=0;i<w->trigger_count;i++){R2DWorldTriggerEntry *e=&w->triggers[i];if(!e->active)continue;
        if(r2d_world_trigger_enter(&e->trigger,px,py,feet)){if(count<capacity)tokens[count]=e->token;count++;}}
    return tokens&&capacity>0?(count<capacity?count:capacity):0;
}
int r2d_world_trigger_use_at(R2DWorldRuntime *w,float x,float y,float h,int *tokens,int capacity)
{
    int count=0;
    for(int i=0;i<w->trigger_count;i++){R2DWorldTriggerEntry *e=&w->triggers[i];if(!e->active)continue;
        if(r2d_world_trigger_use(&e->trigger,x,y,h)){if(count<capacity)tokens[count]=e->token;count++;}}
    return tokens&&capacity>0?(count<capacity?count:capacity):0;
}
int r2d_world_trigger_shoot_at(R2DWorldRuntime *w,float x,float y,float h,float radius,int *tokens,int capacity)
{
    int count=0;
    for(int i=0;i<w->trigger_count;i++){R2DWorldTriggerEntry *e=&w->triggers[i];if(!e->active)continue;
        if(r2d_world_trigger_shoot(&e->trigger,x,y,h,radius)){if(count<capacity)tokens[count]=e->token;count++;}}
    return tokens&&capacity>0?(count<capacity?count:capacity):0;
}
void r2d_world_trigger_free(R2DWorldRuntime *w)
{
    for(int i=0;i<w->trigger_count;i++){free(w->triggers[i].id);free(w->triggers[i].target);}
    free(w->triggers);w->triggers=NULL;w->trigger_count=w->trigger_capacity=0;w->next_trigger_token=0;
}


// --- P0-C: controller config registry --------------------------------------
static R2DWorldControllerEntry *controller_entry(R2DWorldRuntime *w,int token)
{
    if(token<=0)return NULL;
    for(int i=0;i<R2D_WORLD_CONTROLLER_LIMIT;i++)
        if(w->controllers[i].active&&w->controllers[i].token==token)return &w->controllers[i];
    return NULL;
}
int r2d_world_controller_create(R2DWorldRuntime *w,const R2DWorldControllerConfig *config)
{
    if(w->rendering||!config)return -1;
    for(int i=0;i<R2D_WORLD_CONTROLLER_LIMIT;i++){
        R2DWorldControllerEntry *e=&w->controllers[i];if(e->active)continue;
        e->config=*config;e->active=true;e->token=++w->next_controller_token;
        return e->token;
    }
    return -1;
}
bool r2d_world_controller_remove(R2DWorldRuntime *w,int token)
{
    R2DWorldControllerEntry *e=controller_entry(w,token);if(!e)return true;
    e->active=false;return true;
}
bool r2d_world_controller_place(R2DWorldRuntime *w,int token,float x,float y,float feet,R2DWorldControllerState *out)
{
    R2DWorldControllerEntry *e=controller_entry(w,token);if(!e||!out)return false;
    R2DWorldControllerState start={0};start.x=x;start.y=y;start.feet=feet;
    return r2d_world_controller_init(&w->world,&e->config,&start,out);
}
bool r2d_world_controller_step_state(R2DWorldRuntime *w,int token,R2DWorldControllerState *state,float wish_x,float wish_y,bool jump,float dt)
{
    R2DWorldControllerEntry *e=controller_entry(w,token);if(!e||!state)return false;
    Uint64 start=SDL_GetPerformanceCounter();
    r2d_world_controller_move(&w->world,&e->config,state,wish_x,wish_y,jump,dt);
    w->controller_calls++;
    w->controller_ms+=(double)(SDL_GetPerformanceCounter()-start)*1000.0/(double)SDL_GetPerformanceFrequency();
    return true;
}


// --- P1: navigation graph over spans/portals -------------------------------
void r2d_world_nav_free(R2DWorldRuntime *w)
{
    free(w->nav_nodes);free(w->nav_edges);free(w->nav_offsets);free(w->nav_blocked_spans);free(w->nav_blocked_portals);
    free(w->nav_g);free(w->nav_parent);free(w->nav_heap);free(w->nav_heap_pos);free(w->nav_state);
    w->nav_nodes=NULL;w->nav_edges=NULL;w->nav_offsets=NULL;w->nav_blocked_spans=NULL;w->nav_blocked_portals=NULL;
    w->nav_g=NULL;w->nav_parent=NULL;w->nav_heap=NULL;w->nav_heap_pos=NULL;w->nav_state=NULL;
    memset(&w->nav_graph,0,sizeof w->nav_graph);memset(&w->nav_scratch,0,sizeof w->nav_scratch);
    w->nav_ready=false;
}
bool r2d_world_nav_build_runtime(R2DWorldRuntime *w,float radius,float height,float step,int *nodes,int *edges)
{
    if(w->rendering||!w||w->world.span_count<1)return false;
    if(!isfinite(radius)||!isfinite(height)||!isfinite(step)||radius<0||height<=0||step<0)return false;
    r2d_world_nav_free(w);
    int need=r2d_world_nav_build(&w->world,radius,height,step,NULL,0,NULL,0,NULL,0,&w->nav_graph);
    if(need<0)return false;
    w->nav_nodes=calloc((size_t)w->world.span_count,sizeof *w->nav_nodes);
    w->nav_edges=need?calloc((size_t)need,sizeof *w->nav_edges):NULL;
    w->nav_offsets=calloc((size_t)w->world.span_count+1,sizeof *w->nav_offsets);
    w->nav_g=malloc((size_t)w->world.span_count*sizeof *w->nav_g);
    w->nav_parent=malloc((size_t)w->world.span_count*sizeof *w->nav_parent);
    w->nav_state=malloc((size_t)w->world.span_count*sizeof *w->nav_state);
    w->nav_heap=malloc((size_t)w->world.span_count*sizeof *w->nav_heap);
    w->nav_heap_pos=malloc((size_t)w->world.span_count*sizeof *w->nav_heap_pos);
    if(!w->nav_nodes||!w->nav_offsets||!w->nav_g||!w->nav_parent||!w->nav_state||!w->nav_heap||!w->nav_heap_pos||(need&&!w->nav_edges)){r2d_world_nav_free(w);return false;}
    int built=r2d_world_nav_build(&w->world,radius,height,step,
        w->nav_nodes,w->world.span_count,w->nav_edges,need,w->nav_offsets,w->world.span_count+1,&w->nav_graph);
    if(built<0){r2d_world_nav_free(w);return false;}
    w->nav_graph.nodes=w->nav_nodes;w->nav_graph.edges=w->nav_edges;w->nav_graph.offsets=w->nav_offsets;
    w->nav_graph.node_count=w->world.span_count;w->nav_graph.edge_count=built;
    w->nav_scratch=(R2DWorldNavScratch){w->nav_g,w->nav_parent,w->nav_state,w->nav_heap,w->nav_heap_pos,0,w->world.span_count};
    w->nav_ready=true;w->nav_radius=radius;w->nav_height=height;w->nav_step=step;
    if(nodes)*nodes=w->nav_graph.node_count;if(edges)*edges=w->nav_graph.edge_count;
    return true;
}
int r2d_world_nav_nearest_runtime(R2DWorldRuntime *w,float x,float y)
{
    if(!w->nav_ready)return -1;
    return r2d_world_nav_nearest(&w->nav_graph,x,y);
}
int r2d_world_nav_path_mask(R2DWorldRuntime *w,int from,int to,int *path,int capacity,int max_visits,const int *blocked_spans,int span_count,const int *blocked_portals,int portal_count)
{
    if(!w||!w->nav_ready||!path||capacity<=0)return -1;
    const int nodes=w->nav_graph.node_count,portals=w->world.portal_count;
    if(!w->nav_blocked_spans||!w->nav_blocked_portals){
        free(w->nav_blocked_spans);free(w->nav_blocked_portals);
        w->nav_blocked_spans=calloc((size_t)(nodes?nodes:1),1);
        w->nav_blocked_portals=calloc((size_t)(portals?portals:1),1);
        if(!w->nav_blocked_spans||!w->nav_blocked_portals)return -1;
    }
    memset(w->nav_blocked_spans,0,(size_t)(nodes?nodes:1));
    memset(w->nav_blocked_portals,0,(size_t)(portals?portals:1));
    for(int i=0;i<span_count;i++){int id=blocked_spans[i];if(id>=0&&id<nodes)w->nav_blocked_spans[id]=1;}
    for(int i=0;i<portal_count;i++){int id=blocked_portals[i];if(id>=0&&id<portals)w->nav_blocked_portals[id]=1;}
    if(max_visits<=0)max_visits=nodes*8;
    Uint64 start=SDL_GetPerformanceCounter();
    int result=r2d_world_nav_path(&w->nav_graph,from,to,path,capacity,max_visits,&w->nav_scratch,w->nav_blocked_spans,w->nav_blocked_portals);
    w->nav_queries++;
    w->nav_ms+=(double)(SDL_GetPerformanceCounter()-start)*1000.0/(double)SDL_GetPerformanceFrequency();
    return result;
}
int r2d_world_nav_path_runtime(R2DWorldRuntime *w,int from,int to,int *path,int capacity,int max_visits)
{
    if(!w->nav_ready||!path||capacity<=0)return -1;
    if(max_visits<=0)max_visits=w->nav_graph.node_count*8;
    Uint64 start=SDL_GetPerformanceCounter();
    int result=r2d_world_nav_path(&w->nav_graph,from,to,path,capacity,max_visits,&w->nav_scratch,NULL,NULL);
    w->nav_queries++;
    w->nav_ms+=(double)(SDL_GetPerformanceCounter()-start)*1000.0/(double)SDL_GetPerformanceFrequency();
    return result;
}


// --- P1: native particle pool + compositor pass ----------------------------
#define R2D_WORLD_PARTICLE_CAPACITY 2048
bool r2d_world_particles_ready(R2DWorldRuntime *w)
{
    if(w->particle_ready)return true;
    R2DWorldParticle *storage=calloc(R2D_WORLD_PARTICLE_CAPACITY,sizeof *storage);
    if(!storage)return false;
    if(!r2d_world_particle_pool_init(&w->particles,storage,R2D_WORLD_PARTICLE_CAPACITY)){free(storage);return false;}
    w->particle_storage=storage;w->particle_ready=true;w->particle_accumulator=0;
    if(w->particle_budget<=0)w->particle_budget=R2D_WORLD_PARTICLE_CAPACITY;
    return true;
}
int r2d_world_particles_burst(R2DWorldRuntime *w,const R2DWorldParticle *prototype,int count,float spread,float speed,float dx,float dy,float dh)
{
    if(!w||!prototype||count<0)return -1;
    if(count==0)return 0;
    if(!r2d_world_particles_ready(w))return -1;
    int budget=w->particle_budget;if(budget>0&&w->particles.count>=budget)return 0;
    int allowed=count;if(budget>0&&w->particles.count+allowed>budget)allowed=budget-w->particles.count;
    if(allowed<=0)return 0;
    return r2d_world_particle_emit_burst(&w->particles,prototype,allowed,spread,speed,dx,dy,dh);
}
int r2d_world_particles_continuous(R2DWorldRuntime *w,const R2DWorldParticle *prototype,float rate,float dt)
{
    if(!w||!prototype)return -1;
    if(!r2d_world_particles_ready(w))return -1;
    return r2d_world_particle_emit_continuous(&w->particles,prototype,dt,rate,0,0,0,0,0,&w->particle_accumulator);
}
void r2d_world_particles_step(R2DWorldRuntime *w,float dt)
{
    if(!w||!w->particle_ready)return;
    r2d_world_particle_step(&w->particles,dt);
}
void r2d_world_particles_free(R2DWorldRuntime *w)
{
    free(w->particle_storage);w->particle_storage=NULL;memset(&w->particles,0,sizeof w->particles);
    w->particle_ready=false;w->particle_accumulator=0;w->particles_drawn=0;
}
// Screen-space quad with world depth test and shared world light/fog. This is
// the CPU reference path; the SDL_GPU path reuses the native actor billboard
// pipeline with a 1x1 white texture and a tint (see re2d_world_gpu.c).
static void particles_draw_cpu(R2DWorldRuntime *w,const R2DRe2dView *v,int width,int height,uint8_t *rgba,float *depth,float ortho)
{
    w->particles_drawn=0;
    for(int i=0;i<w->particles.count;i++){
        const R2DWorldParticle *p=&w->particles.items[i];if(!p->active)continue;
        float pj[4],center,scale,dist;
        if(ortho>0){
            const float dx=p->x-v->x,dy=p->y-v->y,up=p->h-v->eye;
            const float forward=dx*v->cos_yaw+dy*v->sin_yaw;
            dist=forward*v->cos_pitch+up*v->sin_pitch;
            if(dist<v->near_plane)continue;
            scale=v->height/ortho;
            pj[0]=v->width*.5f+(-dx*v->sin_yaw+dy*v->cos_yaw)*scale;
            pj[1]=v->height*.5f-(up*v->cos_pitch-forward*v->sin_pitch)*scale;
        }else{
            if(!r2d_re2d_project(v,p->x,p->y,p->h,pj))continue;
            dist=v->focal/pj[3];scale=pj[3];
            if(dist<v->near_plane)continue;
        }
        const float cx=pj[0]*width/v->width,cy=pj[1]*height/v->height;
        const float half=p->size*scale*.5f*width/v->width;
        if(!(half>=0.35f)||!isfinite(half))continue;
        int x0=(int)fmaxf(0,floorf(cx-half)),x1=(int)fminf(width,ceilf(cx+half));
        int y0=(int)fmaxf(0,floorf(cy-half)),y1=(int)fminf(height,ceilf(cy+half));
        if(x1<=x0||y1<=y0)continue;
        const int span=r2d_world_span_at(&w->world,p->x,p->y,p->h);
        uint32_t color=(uint32_t)(fminf(1,fmaxf(0,p->r))*255)|((uint32_t)(fminf(1,fmaxf(0,p->g))*255)<<8)|((uint32_t)(fminf(1,fmaxf(0,p->b))*255)<<16)|0xff000000u;
        float nx=v->x-p->x,ny=v->y-p->y,len=hypotf(nx,ny);
        color=r2d_world_lit_color(&w->world,span,color,p->x,p->y,p->h,len>0?nx/len:0,len>0?ny/len:0,0,dist);
        uint32_t alpha=(uint32_t)(fminf(1,fmaxf(0,p->alpha))*255);
        for(int y=y0;y<y1;y++)for(int x=x0;x<x1;x++){
            int k=y*width+x;if(dist>depth[k])continue;
            uint8_t *dst=rgba+k*4;
            const uint32_t sr=color&0xffu,sg=(color>>8)&0xffu,sb=(color>>16)&0xffu;
            if(p->blend==R2D_PARTICLE_ADDITIVE){
                dst[0]=(uint8_t)fminf(255.0f,(float)dst[0]+(float)sr*alpha/255.0f);
                dst[1]=(uint8_t)fminf(255.0f,(float)dst[1]+(float)sg*alpha/255.0f);
                dst[2]=(uint8_t)fminf(255.0f,(float)dst[2]+(float)sb*alpha/255.0f);
            }else if(p->blend==R2D_PARTICLE_TRANSLUCENT){
                const uint32_t inv=255u-alpha;
                dst[0]=(uint8_t)((sr*alpha+dst[0]*inv)/255u);
                dst[1]=(uint8_t)((sg*alpha+dst[1]*inv)/255u);
                dst[2]=(uint8_t)((sb*alpha+dst[2]*inv)/255u);
            }else{
                if(alpha<128)continue;
                dst[0]=(uint8_t)sr;dst[1]=(uint8_t)sg;dst[2]=(uint8_t)sb;
            }
            dst[3]=255;depth[k]=dist;
        }
        w->particles_drawn++;
    }
}


// GPU particles reuse the actor billboard pipeline with a shared 1x1 white
// texture and a per-frame tint. Bounded so a huge CPU pool cannot monopolise
// GPU texture uploads; the CPU reference still draws the full pool.
#define R2D_WORLD_PARTICLE_GPU_BUDGET 512
static bool particle_collect_gpu(R2DWorldRuntime *w,const R2DRe2dView *v,int width,int height,float ortho)
{
    static const uint8_t white[4]={255,255,255,255};
    int drawn=0;
    for(int i=0;i<w->particles.count&&drawn<R2D_WORLD_PARTICLE_GPU_BUDGET;i++){
        const R2DWorldParticle *p=&w->particles.items[i];if(!p->active)continue;
        if(w->frame_count==ACTOR_LIMIT)break;
        const int index=w->frame_count++;
        float *pos=w->frame_positions+index*5;
        pos[0]=p->x;pos[1]=p->y;pos[2]=p->h-p->size*0.5f;pos[3]=p->size;pos[4]=p->size;
        w->frame_handles[index]=JS_UNDEFINED;
        w->frame_kinds[index]=R2D_WORLD_FRAME_PARTICLE;
        w->frame_images[index]=white;
        w->frame_sizes[index]=1;
        w->frame_keys[index]=0x50415254ull;
        w->frame_revisions[index]=0;
        w->frame_blends[index]=p->blend==R2D_PARTICLE_ADDITIVE?R2D_WORLD_ADDITIVE:p->blend==R2D_PARTICLE_TRANSLUCENT?R2D_WORLD_TRANSLUCENT:R2D_WORLD_MASKED;
        w->frame_tints[index*4]=p->r;w->frame_tints[index*4+1]=p->g;w->frame_tints[index*4+2]=p->b;w->frame_tints[index*4+3]=p->alpha;
        w->particles_drawn++;
        drawn++;
    }
    (void)v;(void)width;(void)height;(void)ortho;
    return true;
}


// --- P1 secret volumes / authored breakables ------------------------------
static int *secret_token_slot(R2DWorldRuntime *w,int token)
{
    for(int i=0;i<w->secret_count;i++)if(w->secret_tokens[i]==token)return &w->secret_tokens[i];
    return NULL;
}
static int *breakable_token_slot(R2DWorldRuntime *w,int token)
{
    for(int i=0;i<w->breakable_count;i++)if(w->breakable_tokens[i]==token)return &w->breakable_tokens[i];
    return NULL;
}
int r2d_world_secret_create(R2DWorldRuntime *w,const char *id,float x,float y,float radius,float bottom,float top,bool once)
{
    if(w->rendering||!id)return -1;
    int slot=-1;for(int i=0;i<w->secret_count;i++)if(w->secret_tokens[i]==0){slot=i;break;}
    if(slot<0){if(w->secret_count==R2D_WORLD_SECRET_LIMIT)return -1;slot=w->secret_count++;
        if(slot>=w->secret_capacity){int n=w->secret_capacity?w->secret_capacity*2:8;
            R2DWorldSecret *s=realloc(w->secrets,(size_t)n*sizeof *s);int *t=realloc(w->secret_tokens,(size_t)n*sizeof *t);
            if(!s||!t){if(s)w->secrets=s;if(t)w->secret_tokens=t;return -1;}
            w->secrets=s;w->secret_tokens=t;w->secret_capacity=n;}}
    if(!r2d_world_secret_init(&w->secrets[slot],id,x,y,radius,bottom,top,once))return -1;
    w->secret_tokens[slot]=++w->next_secret_token;
    return w->secret_tokens[slot];
}
bool r2d_world_secret_remove(R2DWorldRuntime *w,int token)
{
    int *slot=secret_token_slot(w,token);if(!slot)return false;
    memset(&w->secrets[slot-w->secret_tokens],0,sizeof w->secrets[0]);*slot=0;return true;
}
bool r2d_world_secret_info(R2DWorldRuntime *w,int token,int *found,int *count)
{
    int *slot=secret_token_slot(w,token);if(!slot)return false;
    const R2DWorldSecret *s=&w->secrets[slot-w->secret_tokens];
    if(found)*found=s->found?1:0;if(count)*count=s->found_count;return true;
}
int r2d_world_secret_tick(R2DWorldRuntime *w,float dt,float x,float y,float feet,int *tokens,int capacity)
{
    int fired=0;
    for(int i=0;i<w->secret_count;i++){
        R2DWorldSecret *s=&w->secrets[i];if(!w->secret_tokens[i])continue;
        r2d_world_secret_step(s,dt);
        if(r2d_world_secret_touch(s,x,y,feet)){if(tokens&&fired<capacity)tokens[fired]=w->secret_tokens[i];fired++;}
    }
    return fired;
}
int r2d_world_breakable_create(R2DWorldRuntime *w,const char *id,int hp,int variant,int portal,float x,float y,float radius,float bottom,float top)
{
    if(w->rendering||!id)return -1;
    int slot=-1;for(int i=0;i<w->breakable_count;i++)if(w->breakable_tokens[i]==0){slot=i;break;}
    if(slot<0){if(w->breakable_count==R2D_WORLD_SECRET_LIMIT)return -1;slot=w->breakable_count++;
        if(slot>=w->breakable_capacity){int n=w->breakable_capacity?w->breakable_capacity*2:8;
            R2DWorldBreakable *b=realloc(w->breakables,(size_t)n*sizeof *b);int *t=realloc(w->breakable_tokens,(size_t)n*sizeof *t);
            if(!b||!t){if(b)w->breakables=b;if(t)w->breakable_tokens=t;return -1;}
            w->breakables=b;w->breakable_tokens=t;w->breakable_capacity=n;}}
    if(!r2d_world_breakable_init(&w->breakables[slot],id,hp,variant,portal,x,y,radius,bottom,top))return -1;
    w->breakable_tokens[slot]=++w->next_breakable_token;
    return w->breakable_tokens[slot];
}
bool r2d_world_breakable_remove(R2DWorldRuntime *w,int token)
{
    int *slot=breakable_token_slot(w,token);if(!slot)return false;
    memset(&w->breakables[slot-w->breakable_tokens],0,sizeof w->breakables[0]);*slot=0;return true;
}
int r2d_world_breakable_damage(R2DWorldRuntime *w,int token,int damage)
{
    int *slot=breakable_token_slot(w,token);if(!slot)return -1;
    return r2d_world_breakable_hit(&w->breakables[slot-w->breakable_tokens],damage);
}
bool r2d_world_breakable_info(R2DWorldRuntime *w,int token,int *hp,int *variant,int *portal,int *broken)
{
    int *slot=breakable_token_slot(w,token);if(!slot)return false;
    const R2DWorldBreakable *b=&w->breakables[slot-w->breakable_tokens];
    if(hp)*hp=b->hp;if(variant)*variant=b->variant;if(portal)*portal=b->portal;if(broken)*broken=b->broken?1:0;
    return true;
}
bool r2d_world_secret_restore(R2DWorldRuntime *w,int token,int found,int found_count)
{
    int *slot=secret_token_slot(w,token);if(!slot)return false;
    R2DWorldSecret *s=&w->secrets[slot-w->secret_tokens];
    s->found=found!=0;s->found_count=found_count<0?0:found_count;
    if(s->found)s->entered=true;
    return true;
}
bool r2d_world_breakable_restore(R2DWorldRuntime *w,int token,int hp,int broken)
{
    int *slot=breakable_token_slot(w,token);if(!slot)return false;
    R2DWorldBreakable *b=&w->breakables[slot-w->breakable_tokens];
    if(hp<0)hp=0;if(hp>b->max_hp)hp=b->max_hp;
    b->hp=hp;b->broken=broken!=0;
    return true;
}
void r2d_world_secret_free(R2DWorldRuntime *w)
{
    free(w->secrets);free(w->secret_tokens);free(w->breakables);free(w->breakable_tokens);
    w->secrets=NULL;w->secret_tokens=NULL;w->breakables=NULL;w->breakable_tokens=NULL;
    w->secret_count=w->secret_capacity=0;w->breakable_count=w->breakable_capacity=0;
}


// --- P1 terrain/conveyors per surface -------------------------------------
static bool terrain_ensure(R2DWorldRuntime *w)
{
    if(w->terrain_capacity==w->world.surface_count&&w->surface_terrain)return true;
    int n=w->world.surface_count;
    int *terrain=calloc((size_t)(n?n:1),sizeof *terrain);
    R2DWorldConveyor *conveyors=calloc((size_t)(n?n:1),sizeof *conveyors);
    if(!terrain||!conveyors){free(terrain);free(conveyors);return false;}
    free(w->surface_terrain);free(w->surface_conveyors);
    w->surface_terrain=terrain;w->surface_conveyors=conveyors;w->terrain_capacity=n;
    return true;
}
bool r2d_world_set_surface_terrain(R2DWorldRuntime *w,int surface,int kind)
{
    if(!w||!terrain_ensure(w))return false;
    if(surface<0||surface>=w->world.surface_count||kind<0||kind>=R2D_TERRAIN_COUNT)return false;
    w->surface_terrain[surface]=kind;return true;
}
int r2d_world_surface_terrain_kind(R2DWorldRuntime *w,int surface)
{
    if(!w||!w->surface_terrain||surface<0||surface>=w->terrain_capacity)return -1;
    return w->surface_terrain[surface];
}
bool r2d_world_set_surface_conveyor(R2DWorldRuntime *w,int surface,float vx,float vy,float accel,bool affects_projectiles)
{
    if(!w||!terrain_ensure(w))return false;
    if(surface<0||surface>=w->world.surface_count||!isfinite(vx)||!isfinite(vy)||!isfinite(accel)||accel<0)return false;
    w->surface_conveyors[surface]=(R2DWorldConveyor){vx,vy,accel,affects_projectiles};return true;
}
bool r2d_world_surface_conveyor_info(R2DWorldRuntime *w,int surface,float out[3],int *affects)
{
    if(!w||!w->surface_conveyors||surface<0||surface>=w->terrain_capacity)return false;
    const R2DWorldConveyor *c=&w->surface_conveyors[surface];
    if(out){out[0]=c->vx;out[1]=c->vy;out[2]=c->accel;}
    if(affects)*affects=c->affects_projectiles?1:0;
    return true;
}
static int floor_surface_for_span(R2DWorldRuntime *w,int span)
{
    for(int i=0;i<w->world.surface_count;i++){
        const R2DWorldSurface *s=&w->world.surfaces[i];
        if(s->kind==R2D_WORLD_FLOOR&&s->span==span)return i;
    }
    return -1;
}
bool r2d_world_terrain_at(R2DWorldRuntime *w,float x,float y,float h,int *kind,int *surface)
{
    if(!w||!w->surface_terrain)return false;
    int span=r2d_world_span_at(&w->world,x,y,h);if(span<0)return false;
    int floor=floor_surface_for_span(w,span);if(floor<0)return false;
    if(kind)*kind=w->surface_terrain[floor];if(surface)*surface=floor;
    return true;
}
bool r2d_world_conveyor_at(R2DWorldRuntime *w,float x,float y,float h,float out[3],int *affects)
{
    if(!w||!w->surface_conveyors)return false;
    int span=r2d_world_span_at(&w->world,x,y,h);if(span<0)return false;
    int floor=floor_surface_for_span(w,span);if(floor<0)return false;
    const R2DWorldConveyor *c=&w->surface_conveyors[floor];
    if(out){out[0]=c->vx;out[1]=c->vy;out[2]=c->accel;}
    if(affects)*affects=c->affects_projectiles?1:0;
    return true;
}
void r2d_world_terrain_free(R2DWorldRuntime *w)
{
    free(w->surface_terrain);free(w->surface_conveyors);
    w->surface_terrain=NULL;w->surface_conveyors=NULL;w->terrain_capacity=0;
}


// --- P1 save/load snapshot of native state --------------------------------
static void copy_id(char dst[R2D_WORLD_SAVE_ID_CAP],const char *src)
{
    dst[0]=0;if(src)snprintf(dst,R2D_WORLD_SAVE_ID_CAP,"%s",src);
}
uint64_t r2d_world_save_map_hash_runtime(R2DWorldRuntime *w)
{
    if(!w)return 0;
    return r2d_world_save_map_hash(w->world.metadata.id,w->world.metadata.version,(uint64_t)w->world.topology_revision);
}
bool r2d_world_state_capture(R2DWorldRuntime *w,R2DWorldSaveState *out)
{
    if(!w||!out)return false;
    memset(out,0,sizeof *out);
    int spans=w->world.span_count,portals=w->world.portal_count,movers=0,triggers=0;
    for(int i=0;i<w->mover_count;i++)if(w->movers[i].active)movers++;
    for(int i=0;i<w->trigger_count;i++)if(w->triggers[i].active)triggers++;
    out->spans=spans?calloc((size_t)spans,sizeof *out->spans):NULL;
    out->portals=portals?calloc((size_t)portals,sizeof *out->portals):NULL;
    out->movers=movers?calloc((size_t)movers,sizeof *out->movers):NULL;
    out->triggers=triggers?calloc((size_t)triggers,sizeof *out->triggers):NULL;
    if((spans&&!out->spans)||(portals&&!out->portals)||(movers&&!out->movers)||(triggers&&!out->triggers))goto fail;
    for(int i=0;i<spans;i++){
        out->spans[i].span=i;out->spans[i].bottom=w->world.spans[i].bottom;out->spans[i].top=w->world.spans[i].top;
        copy_id(out->spans[i].id,r2d_world_span_id(&w->world,i));
    }
    for(int i=0;i<portals;i++){
        out->portals[i].portal=i;out->portals[i].open_fraction=w->world.portals[i].open_fraction;out->portals[i].sky=w->world.portals[i].sky;
        out->portals[i].closed=w->world.portals[i].closed;copy_id(out->portals[i].id,r2d_world_portal_id(&w->world,i));
    }
    int mi=0;
    for(int i=0;i<w->mover_count;i++){
        R2DWorldMoverEntry *e=&w->movers[i];if(!e->active)continue;
        R2DWorldSavedMover *m=&out->movers[mi++];
        m->type=e->kind;m->span=e->span;m->portal=e->portal;
        m->from=e->mover.from;m->to=e->mover.to;m->position=e->mover.position;m->fraction=e->mover.fraction;
        m->speed=e->mover.speed;m->wait=e->mover.wait;m->timer=e->mover.timer;
        m->phase=(int)e->mover.phase;m->direction=e->mover.direction;
        m->auto_return=e->mover.auto_return;m->blocking=e->mover.blocking;
    }
    out->span_count=spans;out->portal_count=portals;out->mover_count=mi;
    int ti=0;
    for(int i=0;i<w->trigger_count;i++){
        R2DWorldTriggerEntry *e=&w->triggers[i];if(!e->active)continue;
        R2DWorldSavedTrigger *t=&out->triggers[ti++];
        copy_id(t->id,e->id);t->type=e->trigger.type;t->fire_count=e->trigger.fire_count;
        t->enabled=e->trigger.enabled;t->once=e->trigger.once;t->armed=e->trigger.armed;t->timer=e->trigger.timer;
    }
    out->trigger_count=ti;
    return true;
fail:
    r2d_world_save_free(out);return false;
}
bool r2d_world_state_apply(R2DWorldRuntime *w,const R2DWorldSaveState *in)
{
    if(!w||!in)return false;
    if(in->span_count!=w->world.span_count||in->portal_count!=w->world.portal_count)return false;
    int active_movers=0,active_triggers=0;
    for(int i=0;i<w->mover_count;i++)if(w->movers[i].active)active_movers++;
    for(int i=0;i<w->trigger_count;i++)if(w->triggers[i].active)active_triggers++;
    if(in->mover_count!=active_movers||in->trigger_count!=active_triggers)return false;
    // Validate before mutating anything.
    for(int i=0;i<in->span_count;i++){
        const R2DWorldSavedSpan *s=&in->spans[i];
        if(s->span<0||s->span>=w->world.span_count||!isfinite(s->bottom)||!isfinite(s->top)||s->top<=s->bottom)return false;
    }
    for(int i=0;i<in->portal_count;i++){
        const R2DWorldSavedPortal *p=&in->portals[i];
        if(p->portal<0||p->portal>=w->world.portal_count||!isfinite(p->open_fraction))return false;
    }
    for(int i=0;i<in->span_count;i++)r2d_world_span_set_heights(&w->world,in->spans[i].span,in->spans[i].bottom,in->spans[i].top);
    for(int i=0;i<in->portal_count;i++){r2d_world_portal_set_open(&w->world,in->portals[i].portal,in->portals[i].open_fraction);r2d_world_portal_set_sky(&w->world,in->portals[i].portal,in->portals[i].sky);}
    int mi=0;
    for(int i=0;i<w->mover_count;i++){
        R2DWorldMoverEntry *e=&w->movers[i];if(!e->active)continue;
        const R2DWorldSavedMover *m=&in->movers[mi++];
        e->mover.from=m->from;e->mover.to=m->to;e->mover.position=m->position;e->mover.fraction=m->fraction;
        e->mover.speed=m->speed;e->mover.wait=m->wait;e->mover.timer=m->timer;
        e->mover.phase=(R2DWorldMoverPhase)m->phase;e->mover.direction=m->direction;
        e->mover.auto_return=m->auto_return;e->mover.blocking=m->blocking;
        if(e->span>=0)r2d_world_span_set_heights(&w->world,e->span,e->mover.position,e->span_top);
    }
    // Match triggers by authored id first; fall back to registry order.
    for(int i=0;i<in->trigger_count;i++){
        const R2DWorldSavedTrigger *t=&in->triggers[i];
        R2DWorldTriggerEntry *target=NULL;
        for(int j=0;j<w->trigger_count;j++)if(w->triggers[j].active&&w->triggers[j].id&&!strcmp(w->triggers[j].id,t->id)){target=&w->triggers[j];break;}
        if(!target){int seen=0;for(int j=0;j<w->trigger_count;j++){if(!w->triggers[j].active)continue;if(seen++==i){target=&w->triggers[j];break;}}}
        if(!target)return false;
        target->trigger.fire_count=t->fire_count;target->trigger.enabled=t->enabled;
        target->trigger.once=t->once;target->trigger.armed=t->armed;target->trigger.timer=t->timer;
    }
    return true;
}


// --- P2 material animation over the existing material bank -----------------
bool r2d_world_material_anim_set(R2DWorldRuntime *w,int material,int frames,float fps,bool ping_pong,uint32_t seed,float scroll_u,float scroll_v,float pulse_hz,float pulse_amount)
{
    if(!w||material<0||material>=R2D_WORLD_MAX_MATERIALS||!w->world.materials[material].used)return false;
    if(!r2d_world_material_anim_init(&w->material_anims[material],frames,fps,ping_pong,seed,scroll_u,scroll_v,pulse_hz,pulse_amount))return false;
    w->material_anim_active[material]=true;return true;
}
bool r2d_world_material_anim_info(R2DWorldRuntime *w,int material,int *frame,float *emissive,float *u_offset,float *v_offset)
{
    if(!w||material<0||material>=R2D_WORLD_MAX_MATERIALS||!w->material_anim_active[material])return false;
    const R2DWorldMaterialAnim *a=&w->material_anims[material];
    if(frame)*frame=r2d_world_material_anim_frame(a);
    if(emissive)*emissive=r2d_world_material_anim_emissive(a);
    if(u_offset)*u_offset=a->u_offset;if(v_offset)*v_offset=a->v_offset;
    return true;
}
bool r2d_world_material_anim_clear(R2DWorldRuntime *w,int material)
{
    if(!w||material<0||material>=R2D_WORLD_MAX_MATERIALS)return false;
    w->material_anim_active[material]=false;
    w->world.materials[material].anim_u=0;w->world.materials[material].anim_v=0;w->world.materials[material].anim_emissive=1;
    return true;
}
void r2d_world_material_anim_advance(R2DWorldRuntime *w,float dt)
{
    if(!w)return;
    for(int i=0;i<R2D_WORLD_MAX_MATERIALS;i++){
        if(!w->material_anim_active[i])continue;
        R2DWorldMaterialAnim *a=&w->material_anims[i];
        r2d_world_material_anim_step(a,dt);
        w->world.materials[i].anim_u=a->u_offset;
        w->world.materials[i].anim_v=a->v_offset;
        w->world.materials[i].anim_emissive=r2d_world_material_anim_emissive(a);
    }
}


// --- P4 particle budget + aim assist --------------------------------------
void r2d_world_particles_budget(R2DWorldRuntime *w,int budget)
{
    if(!w)return;
    if(budget<0)budget=0;
    if(budget>R2D_WORLD_PARTICLE_CAPACITY)budget=R2D_WORLD_PARTICLE_CAPACITY;
    w->particle_budget=budget;
}
bool r2d_world_aim_assist(JSContext *ctx,R2DWorldRuntime *w,const float from[3],const float dir[3],float cone_rad,float range,int mask,R2DWorldAimAssist *out)
{
    if(!w||!from||!dir||!out)return false;
    if(!isfinite(cone_rad)||!isfinite(range)||cone_rad<0||range<=0)return false;
    const float len=sqrtf(dir[0]*dir[0]+dir[1]*dir[1]+dir[2]*dir[2]);
    if(!(len>1e-6f))return false;
    const float dx=dir[0]/len,dy=dir[1]/len,dz=dir[2]/len;
    const float cos_limit=cosf(cone_rad);
    bool found=false;float best_angle=0,best_distance=0;
    for(int i=0;i<w->hit_count;i++){
        R2DWorldHitEntry *e=&w->hit_entries[i];
        if(!(mask&(1<<e->category)))continue;
        float x,y,depth;
        if(!field(ctx,e->node,"x",&x)||!field(ctx,e->node,"y",&y)||!field(ctx,e->node,"depth",&depth))return false;
        const float z=depth+(e->bottom_offset+e->top_offset)*0.5f;
        const float tx=x-from[0],ty=y-from[1],tz=z-from[2];
        const float distance=sqrtf(tx*tx+ty*ty+tz*tz);
        if(!(distance>1e-4f)||distance>range)continue;
        const float cos_angle=(tx*dx+ty*dy+tz*dz)/distance;
        if(cos_angle<cos_limit)continue;
        const float angle=acosf(cos_angle>1?1:(cos_angle<-1?-1:cos_angle));
        if(!found||angle<best_angle||(angle==best_angle&&distance<best_distance)){
            found=true;best_angle=angle;best_distance=distance;
            out->x=x;out->y=y;out->z=z;out->node=i;out->angle=angle;
        }
    }
    return found;
}



// --- P3 rotating polywall groups -------------------------------------------
typedef struct {
    int wall;
    float x1,y1,x2,y2;     // authored endpoints (restored on remove)
} R2DWorldPolywallWall;
typedef struct R2DWorldPolywallGroup {
    int token,count;
    float pivot_x,pivot_y,angle,speed;
    R2DWorldPolywallWall *walls;
} R2DWorldPolywallGroup;
static R2DWorldPolywallGroup *polywall_group(R2DWorldRuntime *w,int token)
{
    if(!w||token<0)return NULL;
    for(int i=0;i<w->polywall_count;i++)if(w->polywalls[i].token==token)return &w->polywalls[i];
    return NULL;
}
static void polywall_apply(R2DWorldRuntime *w,R2DWorldPolywallGroup *g)
{
    const float c=cosf(g->angle),s=sinf(g->angle);
    for(int i=0;i<g->count;i++){
        R2DWorldPolywallWall *p=&g->walls[i];
        const float ax=p->x1-g->pivot_x,ay=p->y1-g->pivot_y,bx=p->x2-g->pivot_x,by=p->y2-g->pivot_y;
        R2DWorldWall *wall=&w->world.walls[p->wall];
        wall->x1=g->pivot_x+ax*c-ay*s;wall->y1=g->pivot_y+ax*s+ay*c;
        wall->x2=g->pivot_x+bx*c-by*s;wall->y2=g->pivot_y+bx*s+by*c;
    }
    w->world.geometry_revision++;
}
int r2d_world_polywall_add(R2DWorldRuntime *w,const int *walls,int wall_count,float pivot_x,float pivot_y,float angle,float speed)
{
    if(!w||!walls||wall_count<1||wall_count>64||!isfinite(pivot_x)||!isfinite(pivot_y)||!isfinite(angle)||!isfinite(speed))return -1;
    if(w->polywall_count==w->polywall_capacity){
        int next=w->polywall_capacity?w->polywall_capacity*2:8;
        R2DWorldPolywallGroup *grown=realloc(w->polywalls,(size_t)next*sizeof *grown);
        if(!grown)return -1;
        w->polywalls=grown;w->polywall_capacity=next;
    }
    for(int i=0;i<wall_count;i++)if(walls[i]<0||walls[i]>=w->world.wall_count)return -1;
    R2DWorldPolywallGroup *g=&w->polywalls[w->polywall_count];
    memset(g,0,sizeof *g);
    g->walls=calloc((size_t)wall_count,sizeof *g->walls);
    if(!g->walls)return -1;
    for(int i=0;i<wall_count;i++){
        R2DWorldPolywallWall *p=&g->walls[i];
        p->wall=walls[i];const R2DWorldWall *wall=&w->world.walls[walls[i]];
        p->x1=wall->x1;p->y1=wall->y1;p->x2=wall->x2;p->y2=wall->y2;
        if(p->x1==p->x2&&p->y1==p->y2){free(g->walls);return -1;}
    }
    g->count=wall_count;g->token=(w->polywall_count+1)*128+w->polywall_count;g->pivot_x=pivot_x;g->pivot_y=pivot_y;g->angle=angle;g->speed=speed;
    w->polywall_count++;
    polywall_apply(w,g);
    return g->token;
}
bool r2d_world_polywall_info(R2DWorldRuntime *w,int token,float *angle,float *speed,int *walls)
{
    R2DWorldPolywallGroup *g=polywall_group(w,token);if(!g)return false;
    if(angle)*angle=g->angle;if(speed)*speed=g->speed;
    if(walls)for(int i=0;i<g->count;i++)walls[i]=g->walls[i].wall;
    return true;
}
bool r2d_world_polywall_set_speed(R2DWorldRuntime *w,int token,float speed)
{
    R2DWorldPolywallGroup *g=polywall_group(w,token);
    if(!g||!isfinite(speed))return false;
    g->speed=speed;return true;
}
bool r2d_world_polywall_speed(R2DWorldRuntime *w,int token,float *speed)
{
    R2DWorldPolywallGroup *g=polywall_group(w,token);
    if(!g||!speed)return false;*speed=g->speed;return true;
}
bool r2d_world_polywall_remove(R2DWorldRuntime *w,int token)
{
    for(int i=0;i<w->polywall_count;i++)if(w->polywalls[i].token==token){
        R2DWorldPolywallGroup *g=&w->polywalls[i];
        for(int j=0;j<g->count;j++){R2DWorldPolywallWall *p=&g->walls[j];R2DWorldWall *wall=&w->world.walls[p->wall];wall->x1=p->x1;wall->y1=p->y1;wall->x2=p->x2;wall->y2=p->y2;}
        free(g->walls);
        memmove(w->polywalls+i,w->polywalls+i+1,(size_t)(w->polywall_count-i-1)*sizeof *g);
        w->polywall_count--;w->world.geometry_revision++;
        return true;
    }
    return false;
}
void r2d_world_polywall_advance(R2DWorldRuntime *w,float dt)
{
    if(!w||!isfinite(dt)||dt<=0)return;
    for(int i=0;i<w->polywall_count;i++){
        R2DWorldPolywallGroup *g=&w->polywalls[i];
        g->angle+=g->speed*dt;
        polywall_apply(w,g);
    }
}
void r2d_world_polywall_free(R2DWorldRuntime *w)
{
    for(int i=0;i<w->polywall_count;i++)free(w->polywalls[i].walls);
    free(w->polywalls);w->polywalls=NULL;w->polywall_count=w->polywall_capacity=0;
}

// --- P2 final-frame postprocess stack --------------------------------------
static bool post_ensure(R2DWorldRuntime *w)
{
    if(w->post_ready)return true;
    r2d_postprocess_init(&w->post);w->post_ready=true;return true;
}
bool r2d_world_post_set(R2DWorldRuntime *w,int effect,float strength,float r,float g,float b,float a,float extra0,float extra1)
{
    if(!w||!post_ensure(w))return false;
    return r2d_postprocess_set(&w->post,effect,strength,r,g,b,a,extra0,extra1);
}
bool r2d_world_post_enable(R2DWorldRuntime *w,int effect,bool enabled)
{
    if(!w||!post_ensure(w))return false;
    return r2d_postprocess_enable(&w->post,effect,enabled);
}
bool r2d_world_post_profile(R2DWorldRuntime *w,const char *name)
{
    if(!w||!post_ensure(w)||!name)return false;
    return r2d_postprocess_apply_profile(&w->post,name);
}
bool r2d_world_post_eval(R2DWorldRuntime *w,R2DPostUniforms *out)
{
    if(!w||!post_ensure(w)||!out)return false;
    r2d_postprocess_eval(&w->post,out);return true;
}
void r2d_world_post_reset(R2DWorldRuntime *w)
{
    if(!w)return;r2d_postprocess_init(&w->post);w->post_ready=true;
}
void r2d_world_post_step_all(R2DWorldRuntime *w,float dt)
{
    if(w&&w->post_ready)r2d_postprocess_step(&w->post,dt);
}

static void sky_anim_step(R2DWorldRuntime *w,float dt)
{
    if(!w||!w->sky_anim_active)return;
    w->sky_phase+=dt;
    w->world.sky_yaw+=w->sky_yaw_speed*dt;
    float factor=1.0f;
    if(w->sky_pulse_hz>0)factor=1.0f+w->sky_pulse_amount*sinf(6.283185307179586f*w->sky_phase*w->sky_pulse_hz);
    const uint32_t t=w->sky_tint;
    float r=((t&0xff)/255.0f)*factor,g=(((t>>8)&0xff)/255.0f)*factor,b=(((t>>16)&0xff)/255.0f)*factor;
    r=fmaxf(0,fminf(1,r));g=fmaxf(0,fminf(1,g));b=fmaxf(0,fminf(1,b));
    w->world.sky_color=0xff000000u|(uint32_t)(r*255)|((uint32_t)(g*255)<<8)|((uint32_t)(b*255)<<16);
}
bool r2d_world_sky_anim(R2DWorldRuntime *w,float yaw_speed,float pulse_hz,float pulse_amount,uint32_t tint)
{
    if(!w||!isfinite(yaw_speed)||!isfinite(pulse_hz)||!isfinite(pulse_amount)||pulse_hz<0||pulse_amount<0)return false;
    w->sky_yaw_speed=yaw_speed;w->sky_pulse_hz=pulse_hz;w->sky_pulse_amount=pulse_amount;
    w->sky_tint=tint|0xff000000u;w->sky_phase=0;w->sky_anim_active=true;return true;
}
void r2d_world_sky_anim_info(R2DWorldRuntime *w,float out[4])
{
    if(!w||!out)return;
    out[0]=w->sky_anim_active?1.0f:0.0f;out[1]=w->world.sky_yaw;out[2]=w->sky_phase;out[3]=w->world.sky_color?1.0f:0.0f;
}
void r2d_world_sky_anim_advance(R2DWorldRuntime *w,float dt) { sky_anim_step(w,dt); }


// --- P1 audio zones per span ----------------------------------------------
static bool audio_zone_ensure(R2DWorldRuntime *w)
{
    if(w->audio_zone_capacity==w->world.span_count&&w->span_audio_zone)return true;
    int n=w->world.span_count;
    int *zones=calloc((size_t)(n?n:1),sizeof *zones);
    bool *set=calloc((size_t)(n?n:1),sizeof *set);
    if(!zones||!set){free(zones);free(set);return false;}
    free(w->span_audio_zone);free(w->span_audio_zone_set);
    w->span_audio_zone=zones;w->span_audio_zone_set=set;w->audio_zone_capacity=n;
    for(int i=0;i<R2D_AUDIO_CHANNELS;i++)w->channel_zone[i]=-1;
    return true;
}
bool r2d_world_set_span_audio_zone(R2DWorldRuntime *w,int span,const char *name)
{
    if(!w||!name||!audio_zone_ensure(w)||span<0||span>=w->world.span_count)return false;
    int preset=-1;
    for(int i=0;i<R2D_AUDIO_ZONE_COUNT;i++){
        const R2DAudioReverbZone *zone=r2d_audio_zone_preset(i);
        if(!zone)continue;
        const char *names[]={"room","hall","cave","outside","metal","magic"};
        if(i<6&&!strcmp(name,names[i])){preset=i;break;}
    }
    if(preset<0)return false;
    w->span_audio_zone[span]=preset;w->span_audio_zone_set[span]=true;
    return true;
}
bool r2d_world_span_audio_zone(R2DWorldRuntime *w,int span,int *preset,const char **name)
{
    static const char *names[]={"room","hall","cave","outside","metal","magic"};
    if(!w||!w->span_audio_zone||span<0||span>=w->audio_zone_capacity)return false;
    int p=w->span_audio_zone_set[span]?w->span_audio_zone[span]:-1;
    if(p<0)return false;
    if(preset)*preset=p;if(name)*name=names[p];
    return true;
}
bool r2d_world_audio_zone_at(R2DWorldRuntime *w,float x,float y,float h,int *preset,const char **name,int *span)
{
    static const char *names[]={"room","hall","cave","outside","metal","magic"};
    if(!w)return false;
    int index=r2d_world_span_at(&w->world,x,y,h);
    if(index<0)return false;
    if(span)*span=index;
    if(w->span_audio_zone&&w->span_audio_zone_set&&index<w->audio_zone_capacity&&w->span_audio_zone_set[index]){
        int p=w->span_audio_zone[index];
        if(preset)*preset=p;if(name)*name=names[p];return true;
    }
    // No authored zone: derive from the room size (deterministic heuristic).
    const R2DWorldSpan *s=&w->world.spans[index];
    R2DAudioReverbZone zone;
    r2d_audio_zone_from_room(s->w,s->h,s->top-s->bottom,&zone);
    if(preset)*preset=zone.preset;
    if(name)*name=(zone.preset>=0&&zone.preset<6)?names[zone.preset]:NULL;
    return zone.preset>=0;
}
void r2d_world_audio_zone_free(R2DWorldRuntime *w)
{
    free(w->span_audio_zone);free(w->span_audio_zone_set);
    w->span_audio_zone=NULL;w->span_audio_zone_set=NULL;w->audio_zone_capacity=0;
}

int r2d_world_audio_budget(R2DWorldRuntime *w,int budget)
{
    if(!w)return 0;
    if(budget<1)budget=1;
    if(budget>R2D_AUDIO_VOICES_MAX)budget=R2D_AUDIO_VOICES_MAX;
    w->audio_voice_budget=budget;
    return budget;
}
static void audio_voice_policy_step(R2DWorldRuntime *w,const R2DRe2dView *v)
{
    if(!w||!w->audio)return;
    int budget=w->audio_voice_budget;
    if(budget<=0)budget=24;
    if(budget>R2D_AUDIO_VOICES_MAX)budget=R2D_AUDIO_VOICES_MAX;
    R2DAudioVoices *policy=&w->voice_policy;
    r2d_audio_voices_init(policy,budget);
    r2d_audio_voices_listener(policy,v->x,v->y,v->eye);
    for(int i=0;i<R2D_AUDIO_CHANNELS;i++)if(w->sources[i].active){
        R2DAudioVoiceRequest req={0};
        req.id=i;req.priority=w->sources[i].priority;req.x=w->sources[i].x;req.y=w->sources[i].y;req.h=w->sources[i].h;
        req.volume=w->sources[i].volume;req.range=w->sources[i].range;req.loop=true;req.bus=R2D_AUDIO_BUS_SFX;req.channel=-1;
        r2d_audio_voices_submit(policy,&req);
    }
    for(int i=0;i<R2D_AUDIO_CHANNELS;i++)if(w->sources[i].active){
        bool virtualized=true;
        for(int sl=0;sl<policy->slot_count;sl++)if(policy->slots[sl].voice_id==i){virtualized=policy->slots[sl].virtual;break;}
        w->sources[i].virtualized=virtualized;
    }
}

void r2d_world_audio_step(R2DWorldRuntime *w,const R2DRe2dView *v) {
    if(!w->audio)return;
    audio_voice_policy_step(w,v);
    for(int i=0;i<R2D_AUDIO_CHANNELS;i++) {
        R2DWorldAudioSource *s=&w->sources[i];if(!s->active)continue;
        if(s->generation!=w->audio->channel_generation[i]||!r2d_audio_channel_playing(w->audio,i)){s->active=false;continue;}
        float dx=s->x-v->x,dy=s->y-v->y,dh=s->h-v->eye,d=sqrtf(dx*dx+dy*dy+dh*dh),norm=fmaxf(.0001f,d);
        s->distance=d;float taper=fmaxf(0,1-(d/s->range)*(d/s->range));
        float origin[3]={v->x,v->y,v->eye},direction[3]={dx,dy,dh};R2DWorldHit hit;
        s->occluded=d>.01f&&r2d_world_ray(&w->world,origin,direction,.001f,.999f,&hit);
        s->gain=s->volume*fminf(1,s->reference/fmaxf(s->reference,d))*taper*taper*(s->occluded?.18f:1);
        s->cutoff=s->occluded?700:22000; s->current_gain+=(s->gain-s->current_gain)*.2f;
        if(s->virtualized){s->current_gain=0;s->gain=0;r2d_audio_world_channel(w->audio,i,true,s->hrtf,0,0,-1,0,22000);continue;}
        float forward=dx*v->cos_yaw+dy*v->sin_yaw,right=-dx*v->sin_yaw+dy*v->cos_yaw;
        float up=dh*v->cos_pitch-forward*v->sin_pitch,back=-(forward*v->cos_pitch+dh*v->sin_pitch);
        int zone=-1;const char *zone_name=NULL;int zone_span=-1;
        if(r2d_world_audio_zone_at(w,s->x,s->y,s->h,&zone,&zone_name,&zone_span)&&zone>=0&&zone<R2D_AUDIO_ZONE_COUNT){
            if(w->channel_zone[i]!=zone){
                const R2DAudioReverbZone *preset=r2d_audio_zone_preset(zone);
                if(preset)r2d_audio_set_channel_reverb(w->audio,i,preset->wet,preset->decay,preset->damping,1.0f);
                w->channel_zone[i]=zone;
            }
        }else if(w->channel_zone[i]!=-1){
            r2d_audio_set_channel_reverb(w->audio,i,0,0,0,1);w->channel_zone[i]=-1;
        }
        r2d_audio_world_channel(w->audio,i,true,s->hrtf,right/norm,up/norm,d>.0001f?back/norm:-1,s->current_gain,s->cutoff);
    }
    w->audio_active=0;w->audio_virtual=0;
    for(int i=0;i<R2D_AUDIO_CHANNELS;i++)if(w->sources[i].active){w->audio_active++;if(w->sources[i].virtualized)w->audio_virtual++;}
}
void r2d_world_audio_free(R2DWorldRuntime *w) {
    if(!w->audio)return;
    for(int i=0;i<R2D_AUDIO_CHANNELS;i++){R2DWorldAudioSource *s=&w->sources[i];if(s->active&&s->generation==w->audio->channel_generation[i]){r2d_audio_world_channel(w->audio,i,false,false,0,0,-1,0,22000);r2d_audio_stop_channel(w->audio,i,0);}s->active=false;}
}
