#include "rotsprite.h"
#include "rotsprite_math.h"
#include "script.h"
#include "payload.h"
#include <SDL3_image/SDL_image.h>
#include <math.h>
#include <stdlib.h>

typedef struct RotSprite {
    R2DRenderer *renderer;
    SDL_Surface *atlas;
    uint8_t pixels[256 * 256 * 4];
    R2DRotRig rig;
    R2DRotModelPose model;
    bool dirty, anime;
    char path[4096];
    SDL_Time modified;
    Uint64 size;
    int texture, sprite, revision, version, eyes, mouth;
    R2DRotAtlas surface;
    double yaw, pitch;
} RotSprite;

static JSClassID rot_class;
static JSValue style(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv);
static int raster_size(const RotSprite *r) {return r->anime ? 256 : r->version==2 ? 128 : 64;}

static void dispose(RotSprite *r)
{
    if (!r) return;
    if (r->texture >= 0) r2d_texture_free(r->renderer, r->texture);
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
    if (!r2d_rotsprite_layout(image->w, image->h, NULL) && !(image->w==image->h && (image->w==3072 || image->w==4096))) {
        SDL_DestroySurface(image);
        return JS_ThrowRangeError(ctx, "RotSprite: нужен квадратный атлас v1 до 2048 или v2 до 4096");
    }
    SDL_Surface *atlas = SDL_ConvertSurface(image, SDL_PIXELFORMAT_RGBA32);
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
    if (!r) { SDL_DestroySurface(atlas); return JS_ThrowOutOfMemory(ctx); }
    SDL_strlcpy(r->path,full,sizeof r->path);
    SDL_PathInfo file;
    if (SDL_GetPathInfo(full,&file)) { r->modified=file.modify_time; r->size=file.size; }
    r->renderer = s->renderer; r->atlas = atlas; r->texture = r->sprite = -1;
    r->version = r2d_rotsprite_v2_header(atlas->pixels,atlas->w,atlas->h,atlas->pitch) ? 2 : 1;
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

static JSValue pose(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
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
    if (!r->dirty && yaw == r->yaw && pitch == r->pitch && eyes==r->eyes && mouth==r->mouth && brows==r->rig.brows) return JS_NewInt32(ctx, r->sprite);
    int previous_brows=r->rig.brows;r->rig.brows=brows;
    bool drawn=true;
    if (r->anime) drawn=r2d_rotsprite_v2_anime(&r->surface,yaw,pitch,eyes,mouth,&r->rig,r->pixels);
    else if (r->version==2) drawn=r2d_rotsprite_v2_draw(&r->surface,yaw,pitch,eyes,mouth,&r->rig,r->pixels);
    else r2d_rotsprite_raster(r->atlas->pixels, r->atlas->w, r->atlas->h,
                         r->atlas->pitch, yaw,pitch,r->pixels);
    if (!drawn) {r->rig.brows=previous_brows;return JS_ThrowOutOfMemory(ctx);}
    int size=raster_size(r);
    if (!r2d_texture_upload_region(r->renderer,r->texture,0,0,size,size,r->pixels,size*4)) {
        r->rig.brows=previous_brows; return JS_ThrowInternalError(ctx, "RotSprite: не удалось обновить GPU-текстуру");
    }
    r->dirty=false; r->eyes=eyes; r->mouth=mouth; r->yaw = yaw; r->pitch = pitch; r->revision++;
    return JS_NewInt32(ctx, r->sprite);
}

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
    JS_SetPropertyStr(ctx,o,"surfaceSamples",JS_NewInt32(ctx,r->surface.count));
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
    const char *name=JS_ToCString(ctx,argv[1]);if (!name) return JS_EXCEPTION;
    bool anime=!strcmp(name,"anime"),valid=anime || !strcmp(name,"pixel");JS_FreeCString(ctx,name);
    if (!valid || (anime && r->version!=2)) return JS_ThrowRangeError(ctx,"RotSprite: anime требует v2");
    if (r->anime==anime) return JS_NewInt32(ctx,r->sprite);
    R2DRotAtlas surface={0};
    bool decoded=anime ? r2d_rotsprite_v2_decode_anime(r->atlas->pixels,r->atlas->w,r->atlas->h,r->atlas->pitch,&surface) :
        r2d_rotsprite_v2_decode(r->atlas->pixels,r->atlas->w,r->atlas->h,r->atlas->pitch,&surface);
    if (!decoded) return JS_ThrowOutOfMemory(ctx);
    bool drawn=anime ? r2d_rotsprite_v2_anime(&surface,r->yaw,r->pitch,r->eyes,r->mouth,&r->rig,r->pixels) :
        r2d_rotsprite_v2_draw(&surface,r->yaw,r->pitch,r->eyes,r->mouth,&r->rig,r->pixels);
    if (!drawn) {r2d_rotsprite_v2_free(&surface);return JS_ThrowOutOfMemory(ctx);}
    int size=anime ? 256 : 128;
    int texture=r2d_texture_create_rgba(r->renderer,r->pixels,size,size);
    int sprite=texture>=0 ? r2d_sprite_create(r->renderer,texture,0,0,size,size) : -1;
    if (sprite<0) {if (texture>=0) r2d_texture_free(r->renderer,texture);r2d_rotsprite_v2_free(&surface);return JS_ThrowInternalError(ctx,"RotSprite: не удалось сменить стиль");}
    R2DSprite *sp=&r->renderer->sprites[sprite];sp->force_nearest=!anime;sp->force_linear=anime;
    sp->u0=sp->v0=0;sp->u1=sp->v1=1;
    r2d_texture_free(r->renderer,r->texture);r2d_rotsprite_v2_free(&r->surface);
    r->surface=surface;r->texture=texture;r->sprite=sprite;r->anime=anime;r->revision++;
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
    if (!r->atlas || r->version!=2 || argc<3 || !JS_IsArray(argv[2]))
        return JS_ThrowTypeError(ctx,"RotSprite: model требует v2, scale и массив частей");
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
    JS_SetPropertyStr(ctx,engine,"rotSpritePose",JS_NewCFunction(ctx,pose,"rotSpritePose",3));
    JS_SetPropertyStr(ctx,engine,"rotSpriteInfo",JS_NewCFunction(ctx,info,"rotSpriteInfo",1));
    JS_SetPropertyStr(ctx,engine,"rotSpriteDispose",JS_NewCFunction(ctx,release,"rotSpriteDispose",1));
    return 0;
}

const unsigned char *r2d_rotsprite_pixels(JSContext *ctx, JSValueConst handle, int *size)
{
    RotSprite *r=JS_GetOpaque2(ctx,handle,rot_class);
    if (!r) return NULL;
    if (!r->atlas) { JS_ThrowTypeError(ctx,"Re2DSprite: ресурс уже освобождён"); return NULL; }
    *size=raster_size(r);return r->pixels;
}
