#include "rotsprite.h"
#include "rotsprite_math.h"
#include "script.h"
#include "payload.h"
#include <SDL3_image/SDL_image.h>
#include <math.h>

typedef struct RotSprite {
    R2DRenderer *renderer;
    SDL_Surface *atlas;
    uint8_t pixels[R2D_ROTSPRITE_SIZE * R2D_ROTSPRITE_SIZE * 4];
    int texture, sprite, revision;
    double yaw, pitch;
} RotSprite;

static JSClassID rot_class;

static void dispose(RotSprite *r)
{
    if (!r) return;
    if (r->texture >= 0) r2d_texture_free(r->renderer, r->texture);
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
        return JS_ThrowTypeError(ctx, "RotSprite v1: нужен путь к PNG всего тела");
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
    if (!image) return JS_ThrowTypeError(ctx, "RotSprite v1: не удалось прочитать PNG: %s", full);
    if (!r2d_rotsprite_layout(image->w, image->h, NULL)) {
        SDL_DestroySurface(image);
        return JS_ThrowRangeError(ctx, "RotSprite v1: нужен общий атлас 8N×8N, N=8..256");
    }
    SDL_Surface *atlas = SDL_ConvertSurface(image, SDL_PIXELFORMAT_RGBA32);
    SDL_DestroySurface(image);
    if (!atlas) return JS_ThrowInternalError(ctx, "RotSprite: не удалось декодировать RGBA");
    for (int y = 0; y < atlas->h; ++y) {
        const uint8_t *row = (const uint8_t *)atlas->pixels + y*atlas->pitch;
        for (int x = 0; x < atlas->w; ++x) {
            if (row[x*4+3] != 0 && row[x*4+3] != 255) {
                SDL_DestroySurface(atlas);
                return JS_ThrowRangeError(ctx, "RotSprite v1: альфа PNG должна быть 0 или 255");
            }
        }
    }
    RotSprite *r = SDL_calloc(1, sizeof *r);
    if (!r) { SDL_DestroySurface(atlas); return JS_ThrowOutOfMemory(ctx); }
    r->renderer = s->renderer; r->atlas = atlas; r->texture = r->sprite = -1;
    r2d_rotsprite_raster(atlas->pixels, atlas->w, atlas->h, atlas->pitch, 0, 0, r->pixels);
    r->texture = r2d_texture_create_rgba(r->renderer, r->pixels, 64, 64);
    if (r->texture >= 0) r->sprite = r2d_sprite_create(r->renderer, r->texture, 0,0,64,64);
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
    if (yaw == r->yaw && pitch == r->pitch) return JS_NewInt32(ctx, r->sprite);
    r2d_rotsprite_raster(r->atlas->pixels, r->atlas->w, r->atlas->h,
                         r->atlas->pitch, yaw,pitch,r->pixels);
    if (!r2d_texture_upload_region(r->renderer,r->texture,0,0,64,64,r->pixels,64*4))
        return JS_ThrowInternalError(ctx, "RotSprite: не удалось обновить GPU-текстуру");
    r->yaw = yaw; r->pitch = pitch; r->revision++;
    return JS_NewInt32(ctx, r->sprite);
}

static JSValue info(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    R2D_UNUSED(self);
    RotSprite *r = get(ctx,argc,argv);
    if (!r) return JS_EXCEPTION;
    JSValue o = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx,o,"sprite",JS_NewInt32(ctx,r->sprite));
    JS_SetPropertyStr(ctx,o,"texture",JS_NewInt32(ctx,r->texture));
    JS_SetPropertyStr(ctx,o,"revision",JS_NewInt32(ctx,r->revision));
    JS_SetPropertyStr(ctx,o,"yaw",JS_NewFloat64(ctx,r->yaw));
    JS_SetPropertyStr(ctx,o,"pitch",JS_NewFloat64(ctx,r->pitch));
    JS_SetPropertyStr(ctx,o,"disposed",JS_NewBool(ctx,r->atlas == NULL));
    JS_SetPropertyStr(ctx,o,"width",JS_NewInt32(ctx,64));
    JS_SetPropertyStr(ctx,o,"height",JS_NewInt32(ctx,64));
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

int r2d_rotsprite_install(JSContext *ctx, JSValue engine)
{
    if (!rot_class) JS_NewClassID(JS_GetRuntime(ctx), &rot_class);
    JSClassDef def = { .class_name = "RotSpriteV1", .finalizer = finalizer };
    if (JS_NewClass(JS_GetRuntime(ctx),rot_class,&def) < 0) return -1;
    JS_SetPropertyStr(ctx,engine,"rotSpriteLoad",JS_NewCFunction(ctx,load,"rotSpriteLoad",1));
    JS_SetPropertyStr(ctx,engine,"rotSpritePose",JS_NewCFunction(ctx,pose,"rotSpritePose",3));
    JS_SetPropertyStr(ctx,engine,"rotSpriteInfo",JS_NewCFunction(ctx,info,"rotSpriteInfo",1));
    JS_SetPropertyStr(ctx,engine,"rotSpriteDispose",JS_NewCFunction(ctx,release,"rotSpriteDispose",1));
    return 0;
}
