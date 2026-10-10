#include "rotsprite.h"
#include "rotsprite_math.h"
#include "script.h"
#include "payload.h"
#include "rotsprite3.h"
#include <SDL3_image/SDL_image.h>
#include <math.h>
#include <stdlib.h>

typedef struct RotSprite {
    uint64_t instance_id;
    R2DRenderer *renderer;
    SDL_Surface *atlas;
    uint8_t *pixels;                 // raster_size()² RGBA
    R2DRotRig rig;
    R2DRotModelPose model;
    float *sample_depth;
    bool dirty, anime, texture_dirty;
    char path[4096];
    SDL_Time modified;
    Uint64 size;
    int texture, sprite, revision, version, eyes, mouth;
    R2DRotAtlas surface;
    double yaw, pitch;
    // v3: плотная геометрическая картинка (src/rotsprite3.c)
    R3Model m3;
    R3Light light3;
    R3Work work3;
    int out_size;
    int motion_lod, still, up[4];    // грубее во время движения; сколько кадров поза не менялась; область текстуры к загрузке
    bool coarse, drawn;
} RotSprite;

// --- параллельный цикл для синтеза v3: рабочие потоки живут до выхода процесса ---------------
#ifndef __EMSCRIPTEN__
typedef struct RotPool {
    int workers;
    SDL_Semaphore *start[15], *done;
    SDL_AtomicInt next;
    R3Task task;
    void *ctx;
    int count;
    bool ready;
} RotPool;
static RotPool g_pool;
static int SDLCALL rot_worker(void *arg)
{
    const int id = (int)(intptr_t)arg;
    for (;;) {
        SDL_WaitSemaphore(g_pool.start[id]);
        int i;
        while ((i = SDL_AddAtomicInt(&g_pool.next, 1)) < g_pool.count) g_pool.task(g_pool.ctx, i);
        SDL_SignalSemaphore(g_pool.done);
    }
    return 0;
}
static void rot_parallel(R3Task task, void *ctx, int count)
{
    if (!g_pool.ready) {
        g_pool.ready = true;
        int cores = SDL_GetNumLogicalCPUCores();
        const char *forced = SDL_getenv("R2D_ROT_THREADS");      // 1 — без пула (замеры и отладка)
        if (forced) cores = SDL_atoi(forced);
        g_pool.workers = cores > 1 ? (cores - 1 < 15 ? cores - 1 : 15) : 0;
        g_pool.done = SDL_CreateSemaphore(0);
        for (int i = 0; i < g_pool.workers; ++i) {
            g_pool.start[i] = SDL_CreateSemaphore(0);
            SDL_Thread *t = SDL_CreateThread(rot_worker, "r2d-rot3", (void *)(intptr_t)i);
            if (t) SDL_DetachThread(t);
            else { g_pool.workers = i; break; }
        }
    }
    if (!g_pool.workers || !g_pool.done) { for (int i = 0; i < count; ++i) task(ctx, i); return; }
    g_pool.task = task; g_pool.ctx = ctx; g_pool.count = count;
    SDL_SetAtomicInt(&g_pool.next, 0);
    for (int i = 0; i < g_pool.workers; ++i) SDL_SignalSemaphore(g_pool.start[i]);
    int i;
    while ((i = SDL_AddAtomicInt(&g_pool.next, 1)) < count) task(ctx, i);
    for (int k = 0; k < g_pool.workers; ++k) SDL_WaitSemaphore(g_pool.done);
}
#endif

void r2d_rot_parallel(R3Task task, void *ctx, int count)
{
    if (count <= 0) return;
#ifdef __EMSCRIPTEN__
    for (int i = 0; i < count; ++i) task(ctx, i);
#else
    rot_parallel(task, ctx, count);
#endif
}

static bool ensure_pixels(RotSprite *r,int size)
{
    const size_t need=(size_t)size*size*4;
    if(r->pixels&&r->out_size==size)return true;
    uint8_t *p=realloc(r->pixels,need);if(!p)return false;
    r->pixels=p;memset(p,0,need);
    if(r->sample_depth){float *d=realloc(r->sample_depth,(size_t)size*size*sizeof(float));if(!d)return false;r->sample_depth=d;memset(d,0,(size_t)size*size*sizeof(float));}
    r->out_size=size;return true;
}
// v3: накопить область результата, изменённую синтезом, до следующей загрузки текстуры.
static void rot_touch(RotSprite *r)
{
    if(r->version!=3)return;
    const int *t=r->work3.touched;
    if(t[2]<=t[0] || t[3]<=t[1])return;
    if(r->up[2]<=r->up[0] || r->up[3]<=r->up[1]){memcpy(r->up,t,sizeof r->up);return;}
    if(t[0]<r->up[0])r->up[0]=t[0];
    if(t[1]<r->up[1])r->up[1]=t[1];
    if(t[2]>r->up[2])r->up[2]=t[2];
    if(t[3]>r->up[3])r->up[3]=t[3];
}
static bool anime_draw(RotSprite *r,const R2DRotAtlas *surface,double yaw,double pitch,int eyes,int mouth)
{
    if(r->version==3){
        if(!r->sample_depth){r->sample_depth=calloc((size_t)r->out_size*r->out_size,sizeof(float));if(!r->sample_depth)return false;}
        if(!ensure_pixels(r,r->out_size))return false;
#ifndef __EMSCRIPTEN__
        r->work3.parallel=rot_parallel;
#endif
        // движение (поза менялась в последние кадры) рисуется на motion_lod уровней грубее; первый кадр и покой — в полном качестве
        r->coarse=r->motion_lod>0 && r->drawn && r->still<4;
        r->work3.lod_bias=r->coarse?r->motion_lod:0;
        return r2d_rot3_draw(&r->m3,yaw,pitch,&r->rig,&r->light3,r->out_size,&r->work3,r->pixels,r->sample_depth);
    }
    // Main-thread synthesis is serial: shared supersampling scratch, private output.
    if(!r->renderer->rot_workspace){r->renderer->rot_workspace=calloc(1,sizeof(R2DRotAnimeWorkspace));if(!r->renderer->rot_workspace)return false;}
    if(!r->sample_depth){r->sample_depth=malloc(512*512*sizeof(float));if(!r->sample_depth)return false;}
    if(!ensure_pixels(r,512))return false;
    R2DRotAnimeWorkspace *scratch=r->renderer->rot_workspace;
    if(!r2d_rotsprite_v2_anime_sized(surface,yaw,pitch,eyes,mouth,&r->rig,r->pixels,scratch,512))return false;
    memcpy(r->sample_depth,scratch->sample_depth,512*512*sizeof(float));return true;
}
static JSClassID rot_class;
static JSValue style(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv);
static int raster_size(const RotSprite *r) {return r->version==3 ? r->out_size : r->anime ? 512 : r->version==2 ? 128 : 64;}

static void dispose(RotSprite *r)
{
    if (!r) return;
    if (r->texture >= 0) r2d_texture_free(r->renderer, r->texture);
    free(r->sample_depth);r->sample_depth=NULL;
    free(r->pixels);r->pixels=NULL;
    r2d_rot3_free(&r->m3);r2d_rot3_work_free(&r->work3);
    r2d_rotsprite_v2_free(&r->surface);
    SDL_DestroySurface(r->atlas);
    r->atlas = NULL;
    r->texture = r->sprite = -1;
}

static void finalizer(JSRuntime *rt, JSValue value)
{
    R2D_UNUSED(rt);
    RotSprite *r = JS_GetOpaque(value, rot_class);
    dispose(r);
    SDL_free(r);
}

static RotSprite *get(JSContext *ctx, int argc, JSValueConst *argv)
{
    return JS_GetOpaque2(ctx, argc ? argv[0] : JS_UNDEFINED, rot_class);
}

static JSValue load(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    R2DScript *s = JS_GetContextOpaque(ctx);
    if (!s || !s->renderer || argc < 1 || !JS_IsString(argv[0]))
        return JS_ThrowTypeError(ctx, "RotSprite: нужен путь к PNG всего тела");
    const char *path = JS_ToCString(ctx, argv[0]);
    if (!path) return JS_EXCEPTION;
    char full[4096];
    r2d_app_resolve_path(s->app, full, sizeof full, path);
    JS_FreeCString(ctx, path);
    // Тот же VFS и SDL_image, что у действующей загрузки текстур.
    SDL_Surface *image = NULL;
    if (r2d_vfs_has(full)) {
        size_t size = 0;
        uint8_t *data = r2d_vfs_read(full, &size);
        if (data) {
            SDL_IOStream *io = SDL_IOFromConstMem(data, size);
            if (io) image = IMG_LoadPNG_IO(io);
            if (io) SDL_CloseIO(io);
            r2d_vfs_free(data);
        }
    } else {
        SDL_IOStream *io = SDL_IOFromFile(full, "rb");
        if (io) { image = IMG_LoadPNG_IO(io); SDL_CloseIO(io); }
    }
    if (!image) return JS_ThrowTypeError(ctx, "RotSprite: не удалось прочитать PNG: %s", full);
    SDL_Surface *atlas = NULL;
    {
        SDL_Surface *rgba = SDL_ConvertSurface(image, SDL_PIXELFORMAT_RGBA32);
        const bool is_v3 = rgba && r2d_rot3_header(rgba->pixels, rgba->w, rgba->h, rgba->pitch);
        if (is_v3) {
            // Re2DSprite v3: слои данных (веса костей лежат в альфе) — альфа-проверка v2 не применяется.
            R3Model model;
            if (!r2d_rot3_decode(rgba->pixels, rgba->w, rgba->h, rgba->pitch, &model)) {
                SDL_DestroySurface(rgba); SDL_DestroySurface(image);
                return JS_ThrowRangeError(ctx, "RotSprite: повреждённая сетка Re2DSprite v3");
            }
            SDL_DestroySurface(rgba);
            SDL_DestroySurface(image);
            RotSprite *r = SDL_calloc(1, sizeof *r);
            static uint64_t next_v3_instance;
            if (!r) { r2d_rot3_free(&model); return JS_ThrowOutOfMemory(ctx); }
            r->instance_id = ((uint64_t)1 << 40) + ++next_v3_instance;
            SDL_strlcpy(r->path, full, sizeof r->path);
            SDL_PathInfo file3;
            if (SDL_GetPathInfo(full, &file3)) { r->modified = file3.modify_time; r->size = file3.size; }
            r->renderer = s->renderer;
            r->atlas = SDL_CreateSurface(1, 1, SDL_PIXELFORMAT_RGBA32);       // «жив»: большой PNG после декодирования не нужен
            r->texture = r->sprite = -1;
            r->version = 3;
            r->anime = true;
            r->m3 = model;
            r2d_rot3_default_light(&r->light3);
            r->out_size = 1024;
            if (!r->atlas || !ensure_pixels(r, r->out_size)) { dispose(r); SDL_free(r); return JS_ThrowOutOfMemory(ctx); }
            r->texture = r2d_texture_create_rgba(r->renderer, r->pixels, r->out_size, r->out_size);
            if (r->texture >= 0) r->sprite = r2d_sprite_create(r->renderer, r->texture, 0, 0, r->out_size, r->out_size);
            if (r->sprite < 0) { dispose(r); SDL_free(r); return JS_ThrowInternalError(ctx, "RotSprite: не удалось создать спрайт — проверьте лимит текстур"); }
            R2DSprite *sp3 = &r->renderer->sprites[r->sprite];
            sp3->force_linear = true;
            sp3->u0 = sp3->v0 = 0; sp3->u1 = sp3->v1 = 1;
            r->revision = 1;
            JSValue handle3 = JS_NewObjectClass(ctx, rot_class);
            if (JS_IsException(handle3)) { dispose(r); SDL_free(r); return handle3; }
            JS_SetOpaque(handle3, r);
            return handle3;
        }
        if (rgba) SDL_DestroySurface(rgba);
    }
    if (!r2d_rotsprite_layout(image->w, image->h, NULL) && !(image->w==image->h && (image->w==3072 || image->w==4096))) {
        SDL_DestroySurface(image);
        return JS_ThrowRangeError(ctx, "RotSprite: нужен квадратный атлас v1 до 2048, v2 до 4096 или контейнер v3");
    }
    atlas = SDL_ConvertSurface(image, SDL_PIXELFORMAT_RGBA32);
    SDL_DestroySurface(image);
    if (!atlas) return JS_ThrowInternalError(ctx, "RotSprite: не удалось декодировать RGBA");
    for (int y = 0; y < atlas->h; ++y) {
        const uint8_t *row = (const uint8_t *)atlas->pixels + y*atlas->pitch;
        for (int x = 0; x < atlas->w; ++x) {
            if (row[x*4+3] != 0 && row[x*4+3] != 255) {
                SDL_DestroySurface(atlas);
                return JS_ThrowRangeError(ctx, "RotSprite: альфа PNG должна быть 0 или 255");
            }
        }
    }
    RotSprite *r = SDL_calloc(1, sizeof *r);
    static uint64_t next_instance_id;
    if(r)r->instance_id=++next_instance_id;
    if (!r) { SDL_DestroySurface(atlas); return JS_ThrowOutOfMemory(ctx); }
    SDL_strlcpy(r->path,full,sizeof r->path);
    SDL_PathInfo file;
    if (SDL_GetPathInfo(full,&file)) { r->modified=file.modify_time; r->size=file.size; }
    r->renderer = s->renderer; r->atlas = atlas; r->texture = r->sprite = -1;
    r->version = r2d_rotsprite_v2_header(atlas->pixels,atlas->w,atlas->h,atlas->pitch) ? 2 : 1;
    if (!ensure_pixels(r, r->version==2 ? 128 : 64)) { dispose(r); SDL_free(r); return JS_ThrowOutOfMemory(ctx); }
    if (r->version == 2) {
        if (!r2d_rotsprite_v2_decode(atlas->pixels,atlas->w,atlas->h,atlas->pitch,&r->surface)) {
            dispose(r); SDL_free(r); return JS_ThrowRangeError(ctx,"RotSprite: невалидные или пустые карты v2");
        }
        r2d_rotsprite_v2_raster(&r->surface,0,0,0,0,r->pixels);
    } else if (!r2d_rotsprite_raster(atlas->pixels,atlas->w,atlas->h,atlas->pitch,0,0,r->pixels)) {
        dispose(r); SDL_free(r); return JS_ThrowRangeError(ctx,"RotSprite: неизвестный формат PNG");
    }
    r->texture = r2d_texture_create_rgba(r->renderer, r->pixels, r->version==2 ? 128 : 64, r->version==2 ? 128 : 64);
    if (r->texture >= 0) r->sprite = r2d_sprite_create(r->renderer, r->texture, 0,0,r->version==2 ? 128 : 64,r->version==2 ? 128 : 64);
    if (r->sprite < 0) {
        dispose(r); SDL_free(r);
        return JS_ThrowInternalError(ctx, "RotSprite: не удалось создать спрайт — проверьте лимит текстур");
    }
    R2DSprite *sp = &r->renderer->sprites[r->sprite];
    sp->force_nearest = true;
    // Полный растер: край квада соответствует краю пикселя, не центру texel.
    sp->u0 = sp->v0 = 0; sp->u1 = sp->v1 = 1;
    r->revision = 1;
    JSValue handle = JS_NewObjectClass(ctx, rot_class);
    if (JS_IsException(handle)) { dispose(r); SDL_free(r); return handle; }
    JS_SetOpaque(handle, r);
    return handle;
}

static JSValue update_pose(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv,bool synthesize,bool upload)
{
    R2D_UNUSED(self);
    RotSprite *r = get(ctx, argc, argv);
    if (!r) return JS_EXCEPTION;
    if (!r->atlas) return JS_ThrowTypeError(ctx, "RotSprite: ресурс уже освобождён");
    double yaw, pitch;
    if (argc < 3) return JS_ThrowTypeError(ctx, "rotSpritePose(handle, yaw, pitch)");
    if (JS_ToFloat64(ctx, &yaw, argv[1]) < 0 || JS_ToFloat64(ctx, &pitch, argv[2]) < 0) return JS_EXCEPTION;
    if (!r2d_rotsprite_angles(yaw,pitch,&yaw,&pitch))
        return JS_ThrowRangeError(ctx, "RotSprite: yaw/pitch должны быть конечными числами");
    int eyes=r->eyes,mouth=r->mouth,brows=r->rig.brows;
    if (argc>3 && JS_ToInt32(ctx,&eyes,argv[3])<0) return JS_EXCEPTION;
    if (argc>4 && JS_ToInt32(ctx,&mouth,argv[4])<0) return JS_EXCEPTION;
    if (argc>5 && JS_ToInt32(ctx,&brows,argv[5])<0) return JS_EXCEPTION;
    if (brows<0 || brows>3) return JS_ThrowRangeError(ctx,"RotSprite: неизвестные брови");
    if (eyes<0 || eyes>3 || mouth<0 || mouth>3 || (r->version==1 && (eyes || mouth || brows)))
        return JS_ThrowRangeError(ctx,"RotSprite: выражение не поддерживается атласом");
    bool changed=r->dirty||yaw!=r->yaw||pitch!=r->pitch||eyes!=r->eyes||mouth!=r->mouth||brows!=r->rig.brows;
    if(!synthesize) {
        r->dirty=changed;r->yaw=yaw;r->pitch=pitch;r->eyes=eyes;r->mouth=mouth;r->rig.brows=brows;
        return JS_NewInt32(ctx,r->sprite);
    }
    if(changed) {
        int previous_brows=r->rig.brows;r->rig.brows=brows;bool drawn=true;
        if(r->anime)drawn=anime_draw(r,&r->surface,yaw,pitch,eyes,mouth);
        else if(r->version==2)drawn=r2d_rotsprite_v2_draw(&r->surface,yaw,pitch,eyes,mouth,&r->rig,r->pixels);
        else r2d_rotsprite_raster(r->atlas->pixels,r->atlas->w,r->atlas->h,r->atlas->pitch,yaw,pitch,r->pixels);
        if(!drawn){r->rig.brows=previous_brows;return JS_ThrowOutOfMemory(ctx);}
        r->dirty=false;r->texture_dirty=true;r->yaw=yaw;r->pitch=pitch;r->eyes=eyes;r->mouth=mouth;r->revision++;
        r->still=0;r->drawn=true;rot_touch(r);
    } else if(r->version==3 && r->anime) {
        // поза устоялась: кадр, нарисованный в движении грубее, дорисовывается в полном качестве
        if(r->still<1000)r->still++;
        if(r->coarse && r->still>=4) {
            if(!anime_draw(r,&r->surface,r->yaw,r->pitch,r->eyes,r->mouth))return JS_ThrowOutOfMemory(ctx);
            r->texture_dirty=true;r->revision++;rot_touch(r);
        }
    }
    if(upload && r->texture_dirty) {
        int size=raster_size(r),x=0,y=0,w=size,h=size;
        if(r->version==3 && r->up[2]>r->up[0] && r->up[3]>r->up[1]) {x=r->up[0];y=r->up[1];w=r->up[2]-x;h=r->up[3]-y;}   // v3: только изменённая область
        if(!r2d_texture_upload_region(r->renderer,r->texture,x,y,w,h,r->pixels+((size_t)y*size+x)*4,size*4))
            return JS_ThrowInternalError(ctx,"RotSprite: не удалось обновить GPU-текстуру");
        r->texture_dirty=false;memset(r->up,0,sizeof r->up);
    }
    return JS_NewInt32(ctx,r->sprite);
}
static JSValue pose(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{return update_pose(ctx,self,argc,argv,true,true);}
// Internal World preparation: keep the last complete pose, synthesize on read.
static JSValue prepare_pose(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{return update_pose(ctx,self,argc,argv,false,false);}

static JSValue info(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    RotSprite *r = get(ctx,argc,argv);
    if (!r) return JS_EXCEPTION;
    JSValue o = JS_NewObject(ctx);
    if (r->version==2 && r->rig.body && !r->rig.model) {
        const char *names[]={"head","shoulderLeft","shoulderRight","handLeft","handRight","hipLeft","hipRight","kneeLeft","kneeRight","footLeft","footRight"};
        const int ids[]={1,7,11,7,11,8,12,8,12,13,14};
        const double xs[]={0,-9.5,9.5,-9.5,9.5,-5,5,-5,5,-5,5};
        const double ys[]={0,-10,-10,18,18,20,20,36,36,54,54};
        JSValue joints=JS_NewObject(ctx);
        for (int i=0;i<11;i++) {
            double x,y;r2d_rotsprite_v2_joint(ids[i],xs[i],ys[i],0,r->yaw,r->pitch,&r->rig,&x,&y);
            JSValue j=JS_NewObject(ctx);JS_SetPropertyStr(ctx,j,"x",JS_NewFloat64(ctx,x));JS_SetPropertyStr(ctx,j,"y",JS_NewFloat64(ctx,y));
            JS_SetPropertyStr(ctx,joints,names[i],j);
        }
        JS_SetPropertyStr(ctx,o,"joints",joints);
    }
    JS_SetPropertyStr(ctx,o,"style",JS_NewString(ctx,r->anime ? "anime" : "pixel"));
    JS_SetPropertyStr(ctx,o,"body",JS_NewBool(ctx,r->rig.body));
    JS_SetPropertyStr(ctx,o,"version",JS_NewInt32(ctx,r->version));
    JS_SetPropertyStr(ctx,o,"brows",JS_NewInt32(ctx,r->rig.brows));
    JS_SetPropertyStr(ctx,o,"eyes",JS_NewInt32(ctx,r->eyes));
    JS_SetPropertyStr(ctx,o,"mouth",JS_NewInt32(ctx,r->mouth));
    JS_SetPropertyStr(ctx,o,"surfaceSamples",JS_NewInt32(ctx,r->version==3 ? r->m3.vertices : r->surface.count));
    if (r->version==3) {
        JS_SetPropertyStr(ctx,o,"grid",JS_NewInt32(ctx,r->m3.grid_w));
        JS_SetPropertyStr(ctx,o,"extent",JS_NewInt32(ctx,r->m3.extent));
        JS_SetPropertyStr(ctx,o,"level",JS_NewInt32(ctx,r->work3.last_level));
        JS_SetPropertyStr(ctx,o,"levels",JS_NewInt32(ctx,r->m3.levels));
        JSValue ms=JS_NewArray(ctx);
        for (int i=0;i<3;i++) JS_SetPropertyUint32(ctx,ms,i,JS_NewFloat64(ctx,r->work3.last_ms[i]));
        JS_SetPropertyStr(ctx,o,"synthMs",ms);
    }
    JS_SetPropertyStr(ctx,o,"sprite",JS_NewInt32(ctx,r->sprite));
    JS_SetPropertyStr(ctx,o,"texture",JS_NewInt32(ctx,r->texture));
    JS_SetPropertyStr(ctx,o,"revision",JS_NewInt32(ctx,r->revision));
    JS_SetPropertyStr(ctx,o,"yaw",JS_NewFloat64(ctx,r->yaw));
    JS_SetPropertyStr(ctx,o,"pitch",JS_NewFloat64(ctx,r->pitch));
    JS_SetPropertyStr(ctx,o,"disposed",JS_NewBool(ctx,r->atlas == NULL));
    JS_SetPropertyStr(ctx,o,"width",JS_NewInt32(ctx,raster_size(r)));
    JS_SetPropertyStr(ctx,o,"height",JS_NewInt32(ctx,raster_size(r)));
    JS_SetPropertyStr(ctx,o,"atlasWidth",JS_NewInt32(ctx,r->atlas ? r->atlas->w : 0));
    return o;
}

static JSValue release(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    RotSprite *r = get(ctx,argc,argv);
    if (!r) return JS_EXCEPTION;
    dispose(r);
    return JS_UNDEFINED;
}

static JSValue rig(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    R2D_UNUSED(self);
    RotSprite *r=get(ctx,argc,argv);
    if (!r) return JS_EXCEPTION;
    if (!r->atlas || r->version!=2 || argc<7) return JS_ThrowTypeError(ctx,"RotSprite: rig требует атлас v2");
    R2DRotRig next={.model=r->rig.model,.body=JS_ToBool(ctx,argv[1])>0,.brows=r->rig.brows};
    double *values[]={&next.phase,&next.stride,&next.arm_left,&next.arm_right,&next.head_yaw};
    for (int i=0;i<5;i++) {
        if (JS_ToFloat64(ctx,values[i],argv[i+2])<0) return JS_EXCEPTION;
        if (!isfinite(*values[i])) return JS_ThrowRangeError(ctx,"RotSprite: конечные параметры rig");
    }
    next.phase=fmod(next.phase,6.283185307179586);
    next.stride=fmax(-75,fmin(75,next.stride));
    double ignored;
    r2d_rotsprite_angles(next.arm_left,0,&next.arm_left,&ignored);
    r2d_rotsprite_angles(next.arm_right,0,&next.arm_right,&ignored);
    r2d_rotsprite_angles(next.head_yaw,0,&next.head_yaw,&ignored);
    if (next.body!=r->rig.body || next.phase!=r->rig.phase || next.stride!=r->rig.stride ||
        next.arm_left!=r->rig.arm_left || next.arm_right!=r->rig.arm_right || next.head_yaw!=r->rig.head_yaw) {
        r->rig=next; r->dirty=true;
    }
    JSValue args[]={argv[0],JS_NewFloat64(ctx,r->yaw),JS_NewFloat64(ctx,r->pitch)};
    JSValue result=pose(ctx,self,3,args); JS_FreeValue(ctx,args[1]); JS_FreeValue(ctx,args[2]); return result;
}

// Build the alternate projection before releasing the active texture/cache.
static JSValue style(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    R2D_UNUSED(self);RotSprite *r=get(ctx,argc,argv);if (!r) return JS_EXCEPTION;
    if (!r->atlas || argc<2 || !JS_IsString(argv[1])) return JS_ThrowTypeError(ctx,"RotSprite: style pixel / anime");
    if (r->version==3) return JS_NewInt32(ctx,r->sprite);      // v3 всегда гладкий синтез
    const char *name=JS_ToCString(ctx,argv[1]);if (!name) return JS_EXCEPTION;
    bool anime=!strcmp(name,"anime"),valid=anime || !strcmp(name,"pixel");JS_FreeCString(ctx,name);
    if (!valid || (anime && r->version!=2)) return JS_ThrowRangeError(ctx,"RotSprite: anime требует v2");
    if (r->anime==anime) return JS_NewInt32(ctx,r->sprite);
    R2DRotAtlas surface={0};
    bool decoded=anime ? r2d_rotsprite_v2_decode_anime(r->atlas->pixels,r->atlas->w,r->atlas->h,r->atlas->pitch,&surface) :
        r2d_rotsprite_v2_decode(r->atlas->pixels,r->atlas->w,r->atlas->h,r->atlas->pitch,&surface);
    if (!decoded) return JS_ThrowOutOfMemory(ctx);
    bool drawn=anime ? anime_draw(r,&surface,r->yaw,r->pitch,r->eyes,r->mouth) :
        r2d_rotsprite_v2_draw(&surface,r->yaw,r->pitch,r->eyes,r->mouth,&r->rig,r->pixels);
    if (!drawn) {r2d_rotsprite_v2_free(&surface);return JS_ThrowOutOfMemory(ctx);}
    int size=anime ? 512 : 128;
    int texture=r2d_texture_create_rgba(r->renderer,r->pixels,size,size);
    int sprite=texture>=0 ? r2d_sprite_create(r->renderer,texture,0,0,size,size) : -1;
    if (sprite<0) {if (texture>=0) r2d_texture_free(r->renderer,texture);r2d_rotsprite_v2_free(&surface);return JS_ThrowInternalError(ctx,"RotSprite: не удалось сменить стиль");}
    R2DSprite *sp=&r->renderer->sprites[sprite];sp->force_nearest=!anime;sp->force_linear=anime;
    sp->u0=sp->v0=0;sp->u1=sp->v1=1;
    r2d_texture_free(r->renderer,r->texture);r2d_rotsprite_v2_free(&r->surface);
    r->surface=surface;r->texture=texture;r->sprite=sprite;r->anime=anime;r->dirty=false;r->texture_dirty=false;r->revision++;
    return JS_NewInt32(ctx,sprite);
}

static JSValue changed(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    R2D_UNUSED(self); RotSprite *r=get(ctx,argc,argv); if (!r) return JS_EXCEPTION;
    SDL_PathInfo file;
    bool change=r->atlas && SDL_GetPathInfo(r->path,&file) && (file.modify_time!=r->modified || file.size!=r->size);
    return JS_NewBool(ctx,change);
}

// One descriptor upload per pose, never a JS call per surface sample.
static JSValue model_pose(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    R2D_UNUSED(self);RotSprite *r=get(ctx,argc,argv);if (!r) return JS_EXCEPTION;
    if (!r->atlas || (r->version!=2 && r->version!=3) || argc<3 || !JS_IsArray(argv[2]))
        return JS_ThrowTypeError(ctx,"RotSprite: model требует v2/v3, scale и массив частей");
    R2DRotModelPose next={0};
    if (JS_ToFloat64(ctx,&next.scale,argv[1])<0) return JS_EXCEPTION;
    if (!isfinite(next.scale) || next.scale<=0 || next.scale>8) return JS_ThrowRangeError(ctx,"RotSprite: scale 0..8");
    JSValue length=JS_GetPropertyStr(ctx,argv[2],"length");uint32_t count;
    int ok=JS_ToUint32(ctx,&count,length);JS_FreeValue(ctx,length);
    if (ok<0) return JS_EXCEPTION;
    if (!count || count>254) return JS_ThrowRangeError(ctx,"RotSprite: 1..254 частей");
    for (uint32_t i=0;i<count;i++) {
        JSValue row=JS_GetPropertyUint32(ctx,argv[2],i);
        length=JS_GetPropertyStr(ctx,row,"length");uint32_t n=0;
        ok=JS_ToUint32(ctx,&n,length);JS_FreeValue(ctx,length);
        if (ok<0 || !JS_IsArray(row) || n!=17) {JS_FreeValue(ctx,row);return JS_ThrowTypeError(ctx,"RotSprite: запись части содержит 17 чисел");}
        double values[17];bool valid=true;
        for (int j=0;j<17;j++) {
            JSValue value=JS_GetPropertyUint32(ctx,row,j);
            if (JS_ToFloat64(ctx,&values[j],value)<0 || !isfinite(values[j]) || fabs(values[j])>1e6) valid=false;
            JS_FreeValue(ctx,value);if (!valid) break;
        }
        JS_FreeValue(ctx,row);
        if (!valid) return JS_ThrowRangeError(ctx,"RotSprite: конечная матрица части");
        for (int j=0;j<5;j++) if (values[j]!=floor(values[j])) valid=false;
        if (!valid || values[0]<1 || values[0]>254 || values[1]<0 || values[1]>3 || values[2]<0 || values[2]>3 ||
            values[3]<0 || values[3]>1 || values[4]<0 || values[4]>1) return JS_ThrowRangeError(ctx,"RotSprite: неверный ID/selector/variant/flags");
        int id=(int)values[0];if (next.parts[id].defined) return JS_ThrowRangeError(ctx,"RotSprite: повтор ID части");
        R2DRotPartPose *part=&next.parts[id];part->defined=true;part->selector=(uint8_t)values[1];part->variant=(uint8_t)values[2];
        part->one_sided=values[3]!=0;part->visible=values[4]!=0;memcpy(part->matrix,values+5,sizeof part->matrix);
    }
    bool body=argc>3 ? JS_ToBool(ctx,argv[3])>0 : true;
    if (body!=r->rig.body) {r->rig.body=body;r->dirty=true;}
    if (!r->rig.model || memcmp(&next,&r->model,sizeof next)) {r->model=next;r->rig.model=&r->model;r->dirty=true;}
    return JS_UNDEFINED;
}

static bool selected(uint8_t part,const bool *ids) { return ids[part]; }
static JSValue replace_part(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    RotSprite *r=get(ctx,argc,argv); if (!r) return JS_EXCEPTION;
    uint32_t mask=0;bool ids[256]={0};
    if (!r->atlas || r->version!=2 || argc<3)
        return JS_ThrowTypeError(ctx,"RotSprite: подмена требует v2, PNG и маску частей");
    const uint32_t allowed=(1u<<4)|(1u<<5)|(1u<<1)|(1u<<2)|(1u<<3)|(1u<<6)|(1u<<7)|(1u<<8)|(1u<<9)|(1u<<11)|(1u<<12)|(1u<<13)|(1u<<14);
    if (JS_IsArray(argv[2])) {
        JSValue length=JS_GetPropertyStr(ctx,argv[2],"length");uint32_t n=0;
        int ok=JS_ToUint32(ctx,&n,length);JS_FreeValue(ctx,length);
        if (ok<0) return JS_EXCEPTION;
        if (!n || n>254) return JS_ThrowRangeError(ctx,"RotSprite: список ID частей 1..254");
        for (uint32_t i=0;i<n;i++) {
            JSValue v=JS_GetPropertyUint32(ctx,argv[2],i);double id=0;
            ok=JS_ToFloat64(ctx,&id,v);JS_FreeValue(ctx,v);
            if (ok<0) return JS_EXCEPTION;
            if (!isfinite(id) || id!=floor(id) || id<1 || id>254 || ids[(int)id]) return JS_ThrowRangeError(ctx,"RotSprite: неверный ID части");
            ids[(int)id]=true;
        }
    } else {
        if (JS_ToUint32(ctx,&mask,argv[2])<0) return JS_EXCEPTION;
        if (!mask || (mask & ~allowed)) return JS_ThrowRangeError(ctx,"RotSprite: неизвестная часть");
        for (int i=1;i<32;i++) ids[i]=(mask & (1u<<i))!=0;
    }
    JSValue donor=load(ctx,self,1,&argv[1]); if (JS_IsException(donor)) return donor;
    RotSprite *d=JS_GetOpaque(donor,rot_class);
    if (d->version!=2) { dispose(d); JS_FreeValue(ctx,donor); return JS_ThrowTypeError(ctx,"RotSprite: донор должен быть v2"); }
    if (r->anime) {
        JSValue args[]={donor,JS_NewString(ctx,"anime")};JSValue result=style(ctx,self,2,args);JS_FreeValue(ctx,args[1]);
        if (JS_IsException(result)) {dispose(d);JS_FreeValue(ctx,donor);return result;}JS_FreeValue(ctx,result);
    }
    int count=0,added=0;
    for (int i=0;i<r->surface.count;i++) if (!selected(r->surface.points[i].part,ids)) count++;
    for (int i=0;i<d->surface.count;i++) if (selected(d->surface.points[i].part,ids)) {count++;added++;}
    if (!added) {dispose(d);JS_FreeValue(ctx,donor);return JS_ThrowRangeError(ctx,"RotSprite: часть отсутствует у донора");}
    R2DRotPoint *points=malloc((size_t)count*sizeof *points);
    if (!points) {dispose(d);JS_FreeValue(ctx,donor);return JS_ThrowOutOfMemory(ctx);}
    int n=0;
    for (int i=0;i<r->surface.count;i++) if (!selected(r->surface.points[i].part,ids)) points[n++]=r->surface.points[i];
    for (int i=0;i<d->surface.count;i++) if (selected(d->surface.points[i].part,ids)) points[n++]=d->surface.points[i];
    r2d_rotsprite_v2_free(&r->surface); r->surface.points=points;r->surface.count=count;r->dirty=true;
    dispose(d);JS_FreeValue(ctx,donor);
    JSValue args[]={argv[0],JS_NewFloat64(ctx,r->yaw),JS_NewFloat64(ctx,r->pitch)};
    JSValue result=pose(ctx,self,3,args);JS_FreeValue(ctx,args[1]);JS_FreeValue(ctx,args[2]);return result;
}

static JSValue file_stamp(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    R2D_UNUSED(self);R2DScript *s=JS_GetContextOpaque(ctx);
    if (!s || argc<1 || !JS_IsString(argv[0])) return JS_ThrowTypeError(ctx,"RotSprite: путь PNG");
    const char *path=JS_ToCString(ctx,argv[0]);if (!path) return JS_EXCEPTION;
    char full[4096],stamp[80];r2d_app_resolve_path(s->app,full,sizeof full,path);JS_FreeCString(ctx,path);
    SDL_PathInfo file;
    if (!SDL_GetPathInfo(full,&file)) return JS_NULL;
    SDL_snprintf(stamp,sizeof stamp,"%llu:%llu",(unsigned long long)file.modify_time,(unsigned long long)file.size);
    return JS_NewString(ctx,stamp);
}

// Размер растра, освещение, детализация и вид синтеза v3: rotSpriteConfig(handle, size, [24 числа света], detail, {eye,window,cull,motionLod}).
static JSValue config(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    R2D_UNUSED(self);RotSprite *r=get(ctx,argc,argv);if (!r) return JS_EXCEPTION;
    if (!r->atlas || r->version!=3) return JS_ThrowTypeError(ctx,"RotSprite: config требует Re2DSprite v3");
    int size=r->out_size;
    if (argc>1 && !JS_IsUndefined(argv[1]) && JS_ToInt32(ctx,&size,argv[1])<0) return JS_EXCEPTION;
    if (size<128 || size>2048) return JS_ThrowRangeError(ctx,"RotSprite: размер растра v3 128..2048");
    if (argc>3 && !JS_IsUndefined(argv[3])) {
        double detail=0;
        if (JS_ToFloat64(ctx,&detail,argv[3])<0) return JS_EXCEPTION;
        if (!(detail>=.25 && detail<=8)) return JS_ThrowRangeError(ctx,"RotSprite: detail 0.25..8 пикселей на тексель");
        if ((float)detail!=r->work3.detail) {r->work3.detail=(float)detail;r->dirty=true;}
    }
    if (argc>4 && JS_IsObject(argv[4])) {
        // вид: {eye:[x,y,z]|null — глаз перспективы (единицы Re2D, z>0), window:[x0,y0,x1,y1]|null — видимое окно в долях, cull:boolean}
        float eye[3]={0,0,0},window[4]={0,0,0,0};int persp=0;
        JSValue item=JS_GetPropertyStr(ctx,argv[4],"eye");
        if (JS_IsArray(item)) {
            for (int i=0;i<3;i++) {
                JSValue n=JS_GetPropertyUint32(ctx,item,i);double d=0;
                int ok=JS_ToFloat64(ctx,&d,n);JS_FreeValue(ctx,n);
                if (ok<0 || !isfinite(d) || fabs(d)>1000) {JS_FreeValue(ctx,item);return JS_ThrowRangeError(ctx,"RotSprite: eye — три конечных числа");}
                eye[i]=(float)d;
            }
            if (eye[2]<=1e-3f) {JS_FreeValue(ctx,item);return JS_ThrowRangeError(ctx,"RotSprite: eye.z должен быть > 0 (глаз перед моделью)");}
            persp=1;
        } else if (!JS_IsNull(item) && !JS_IsUndefined(item)) {JS_FreeValue(ctx,item);return JS_ThrowTypeError(ctx,"RotSprite: eye — массив [x,y,z] или null");}
        JS_FreeValue(ctx,item);
        item=JS_GetPropertyStr(ctx,argv[4],"window");
        if (JS_IsArray(item)) {
            for (int i=0;i<4;i++) {
                JSValue n=JS_GetPropertyUint32(ctx,item,i);double d=0;
                int ok=JS_ToFloat64(ctx,&d,n);JS_FreeValue(ctx,n);
                if (ok<0 || !(d>=0 && d<=1)) {JS_FreeValue(ctx,item);return JS_ThrowRangeError(ctx,"RotSprite: window — четыре доли 0..1");}
                window[i]=(float)d;
            }
            if (!(window[2]>window[0] && window[3]>window[1])) {JS_FreeValue(ctx,item);return JS_ThrowRangeError(ctx,"RotSprite: window — [x0,y0,x1,y1], x1>x0 и y1>y0");}
        } else if (!JS_IsNull(item) && !JS_IsUndefined(item)) {JS_FreeValue(ctx,item);return JS_ThrowTypeError(ctx,"RotSprite: window — массив [x0,y0,x1,y1] или null");}
        JS_FreeValue(ctx,item);
        item=JS_GetPropertyStr(ctx,argv[4],"cull");
        const int cull=JS_ToBool(ctx,item)>0;JS_FreeValue(ctx,item);
        item=JS_GetPropertyStr(ctx,argv[4],"motionLod");
        int motion_lod=0;
        if (!JS_IsUndefined(item) && !JS_IsNull(item) && JS_ToInt32(ctx,&motion_lod,item)<0) {JS_FreeValue(ctx,item);return JS_EXCEPTION;}
        JS_FreeValue(ctx,item);
        if (motion_lod<0 || motion_lod>4) return JS_ThrowRangeError(ctx,"RotSprite: motionLod 0..4");
        r->motion_lod=motion_lod;
        if (persp!=r->work3.persp || cull!=r->work3.cull || memcmp(eye,r->work3.eye,sizeof eye) || memcmp(window,r->work3.window,sizeof window)) {
            r->work3.persp=persp;r->work3.cull=cull;memcpy(r->work3.eye,eye,sizeof eye);memcpy(r->work3.window,window,sizeof window);r->dirty=true;
        }
    }
    if (argc>2 && JS_IsArray(argv[2])) {
        float v[24];
        for (int i=0;i<24;i++) {
            JSValue item=JS_GetPropertyUint32(ctx,argv[2],i);double d=0;
            int ok=JS_ToFloat64(ctx,&d,item);JS_FreeValue(ctx,item);
            if (ok<0 || !isfinite(d) || fabs(d)>1000) return JS_ThrowRangeError(ctx,"RotSprite: свет — 24 конечных числа");
            v[i]=(float)d;
        }
        R3Light next;memcpy(&next,&r->light3,sizeof next);
        memcpy(next.key_dir,v,12);memcpy(next.key_col,v+3,12);memcpy(next.fill_dir,v+6,12);memcpy(next.fill_col,v+9,12);
        memcpy(next.sky,v+12,12);memcpy(next.ground,v+15,12);next.rim=v[18];next.spec=v[19];next.shine=fmaxf(4,v[20]);memcpy(next.tint,v+21,12);
        for (int k=0;k<2;k++) {
            float *d=k?next.fill_dir:next.key_dir,l=sqrtf(d[0]*d[0]+d[1]*d[1]+d[2]*d[2]);
            if (l<1e-6f) return JS_ThrowRangeError(ctx,"RotSprite: направление света не нулевое");
            for (int j=0;j<3;j++) d[j]/=l;
        }
        if (memcmp(&next,&r->light3,sizeof next)) {r->light3=next;r->dirty=true;}
    }
    if (size!=r->out_size) {
        int old_size=r->out_size;
        free(r->sample_depth);r->sample_depth=NULL;
        if (!ensure_pixels(r,size)) {r->out_size=old_size;return JS_ThrowOutOfMemory(ctx);}
        r->sample_depth=calloc((size_t)size*size,sizeof(float));
        if (!r->sample_depth) return JS_ThrowOutOfMemory(ctx);
        r2d_rot3_work_free(&r->work3);
        int texture=r2d_texture_create_rgba(r->renderer,r->pixels,size,size);
        int sprite=texture>=0 ? r2d_sprite_create(r->renderer,texture,0,0,size,size) : -1;
        if (sprite<0) {if (texture>=0) r2d_texture_free(r->renderer,texture);return JS_ThrowInternalError(ctx,"RotSprite: не удалось сменить размер растра");}
        R2DSprite *sp=&r->renderer->sprites[sprite];sp->force_linear=true;sp->u0=sp->v0=0;sp->u1=sp->v1=1;
        r2d_texture_free(r->renderer,r->texture);
        r->texture=texture;r->sprite=sprite;r->dirty=true;r->texture_dirty=false;r->revision++;
    }
    return JS_NewInt32(ctx,r->sprite);
}

int r2d_rotsprite_install(JSContext *ctx, JSValue engine)
{
    // В QuickJS-ng allocator принадлежит runtime: после reload нужен новый id.
    rot_class = 0;
    JS_NewClassID(JS_GetRuntime(ctx), &rot_class);
    JSClassDef def = { .class_name = "RotSprite", .finalizer = finalizer };
    if (JS_NewClass(JS_GetRuntime(ctx),rot_class,&def) < 0) return -1;
    JS_SetPropertyStr(ctx,engine,"rotSpriteModelPose",JS_NewCFunction(ctx,model_pose,"rotSpriteModelPose",3));
    JS_SetPropertyStr(ctx,engine,"rotSpriteStyle",JS_NewCFunction(ctx,style,"rotSpriteStyle",2));
    JS_SetPropertyStr(ctx,engine,"rotSpriteFileStamp",JS_NewCFunction(ctx,file_stamp,"rotSpriteFileStamp",1));
    JS_SetPropertyStr(ctx,engine,"rotSpriteChanged",JS_NewCFunction(ctx,changed,"rotSpriteChanged",1));
    JS_SetPropertyStr(ctx,engine,"rotSpritePart",JS_NewCFunction(ctx,replace_part,"rotSpritePart",3));
    JS_SetPropertyStr(ctx,engine,"rotSpriteRig",JS_NewCFunction(ctx,rig,"rotSpriteRig",7));
    JS_SetPropertyStr(ctx,engine,"rotSpriteLoad",JS_NewCFunction(ctx,load,"rotSpriteLoad",1));
    JS_SetPropertyStr(ctx,engine,"rotSpritePrepare",JS_NewCFunction(ctx,prepare_pose,"rotSpritePrepare",3));
    JS_SetPropertyStr(ctx,engine,"rotSpritePose",JS_NewCFunction(ctx,pose,"rotSpritePose",3));
    JS_SetPropertyStr(ctx,engine,"rotSpriteInfo",JS_NewCFunction(ctx,info,"rotSpriteInfo",1));
    JS_SetPropertyStr(ctx,engine,"rotSpriteConfig",JS_NewCFunction(ctx,config,"rotSpriteConfig",5));
    JS_SetPropertyStr(ctx,engine,"rotSpriteDispose",JS_NewCFunction(ctx,release,"rotSpriteDispose",1));
    return 0;
}

const unsigned char *r2d_rotsprite_pixels(JSContext *ctx, JSValueConst handle, int *size, bool synthesize)
{
    RotSprite *r=JS_GetOpaque2(ctx,handle,rot_class);
    if (!r) return NULL;
    if (!r->atlas) { JS_ThrowTypeError(ctx,"Re2DSprite: ресурс уже освобождён"); return NULL; }
    if(!synthesize){*size=raster_size(r);return r->pixels;}
    JSValue args[]={handle,JS_NewFloat64(ctx,r->yaw),JS_NewFloat64(ctx,r->pitch)};
    JSValue result=update_pose(ctx,JS_UNDEFINED,3,args,true,false);JS_FreeValue(ctx,args[1]);JS_FreeValue(ctx,args[2]);
    if(JS_IsException(result))return NULL;JS_FreeValue(ctx,result);
    *size=raster_size(r);return r->pixels;
}

bool r2d_rotsprite_world_pose(JSContext *ctx,JSValueConst handle,double yaw,double pitch)
{
    RotSprite *r=JS_GetOpaque2(ctx,handle,rot_class);
    if(!r)return false;if(!r->atlas){JS_ThrowTypeError(ctx,"Re2DSprite: resource disposed");return false;}
    if(!r2d_rotsprite_angles(yaw,pitch,&yaw,&pitch)){JS_ThrowRangeError(ctx,"Re2DSprite: invalid world pose");return false;}
    pitch=fmax(-75,fmin(75,pitch));
    r->dirty=r->dirty||yaw!=r->yaw||pitch!=r->pitch;r->yaw=yaw;r->pitch=pitch;return true;
}
const float *r2d_rotsprite_sample_depth(JSContext *ctx,JSValueConst handle)
{
    RotSprite *r=JS_GetOpaque2(ctx,handle,rot_class);if(!r)return NULL;
    return r->anime?r->sample_depth:NULL;
}
int r2d_rotsprite_revision(JSContext *ctx,JSValueConst handle)
{ RotSprite *r=JS_GetOpaque2(ctx,handle,rot_class);return r?r->revision:-1; }
uint64_t r2d_rotsprite_instance(JSContext *ctx,JSValueConst handle)
{ RotSprite *r=JS_GetOpaque2(ctx,handle,rot_class);return r?r->instance_id:0; }
bool r2d_rotsprite_dirty(JSContext *ctx,JSValueConst handle)
{ RotSprite *r=JS_GetOpaque2(ctx,handle,rot_class);return r&&r->dirty; }
