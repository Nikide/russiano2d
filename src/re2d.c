// ===========================================================================
// Re2D: JS-обвязка нативной проекции (engine.re2d.*).
//
// Математика лежит в re2d_math.c и проверяется офлайн; здесь только мост:
// типизированные массивы в обе стороны и отправка готового меша в рендер.
// Вид хранится один на процесс — как и один кадр: JS ставит его раз за кадр
// (engine.re2d.view), дальше projects/mesh работают по нему.
// ===========================================================================
#include "re2d.h"
#include "re2d_math.h"
#include "re2d_world.h"
#include "re2d_world_runtime.h"
#include "re2d_world_automap.h"
#include "re2d_world_nav.h"
#include "re2d_world_gpu.h"
#include "re2d_world_vfx.h"
#include "rotsprite.h"
#include "script.h"
#include "app.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

static R2DRe2dView g_view;
static R2DRe2dStats g_stats;
static bool g_view_ready;
static float *g_scratch;
static int g_scratch_cap;   // в вершинах (по 8 float)
static int g_meshes, g_mesh_verts;

// Предел выходного буфера меша, вершины (32 МБ): дальше треугольники отбрасываются
// и считаются в stats.overflow.
#define R2D_RE2D_MAX_VERTS (1 << 20)

static void ensure_view(void)
{
    if (g_view_ready) return;
    r2d_re2d_view_set(&g_view, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.2f, 1280.0f, 720.0f);
    g_view_ready = true;
}

static double num_arg(JSContext *ctx, int argc, JSValueConst *argv, int idx, double def)
{
    if (idx >= argc) return def;
    double v = def;
    if (JS_ToFloat64(ctx, &v, argv[idx]) < 0) return def;
    return v;
}

// Указатель на данные Float32Array. Возвращает ArrayBuffer-обёртку, которую
// нужно освободить; nfloats — сколько float доступно.
static JSValue f32_view(JSContext *ctx, JSValueConst arr, float **data, size_t *nfloats)
{
    size_t off = 0, len = 0, bpe = 0;
    JSValue ab = JS_GetTypedArrayBuffer(ctx, arr, &off, &len, &bpe);
    if (JS_IsException(ab)) {
        // Движковое «not a TypedArray» ничего не подсказывает: заменяем своим.
        JS_FreeValue(ctx, JS_GetException(ctx));
        return JS_ThrowTypeError(ctx, "Re2D: нужен Float32Array, а передан другой тип (обычный массив не подходит)");
    }
    size_t size = 0;
    uint8_t *base = JS_GetArrayBuffer(ctx, &size, ab);
    if (!base || bpe != sizeof(float)) {
        JS_FreeValue(ctx, ab);
        return JS_ThrowTypeError(ctx, "Re2D: нужен Float32Array");
    }
    *data = (float *)(base + off);
    *nfloats = len / sizeof(float);
    return ab;
}

// engine.re2d.view(x, y, eye, yaw, pitch, fov, fogFar?, fogMin?) → true.
// Углы в радианах; размер кадра берётся у рендера — тот же, что у submitMesh.
static JSValue js_view(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    R2DScript *s = JS_GetContextOpaque(ctx);
    if (argc < 6) {
        return JS_ThrowTypeError(ctx, "re2d.view(x, y, eye, yaw, pitch, fov, fogFar?, fogMin?)");
    }
    const double x = num_arg(ctx, argc, argv, 0, 0), y = num_arg(ctx, argc, argv, 1, 0);
    const double eye = num_arg(ctx, argc, argv, 2, 0), yaw = num_arg(ctx, argc, argv, 3, 0);
    const double pitch = num_arg(ctx, argc, argv, 4, 0), fov = num_arg(ctx, argc, argv, 5, 1.2);
    if (!isfinite(x) || !isfinite(y) || !isfinite(eye) || !isfinite(yaw) || !isfinite(pitch) || !isfinite(fov)) {
        return JS_ThrowRangeError(ctx, "re2d.view: все аргументы должны быть конечными числами");
    }
    const float w = (s && s->renderer && s->renderer->screen_w > 0) ? (float)s->renderer->screen_w : 1280.0f;
    const float h = (s && s->renderer && s->renderer->screen_h > 0) ? (float)s->renderer->screen_h : 720.0f;
    r2d_re2d_view_set(&g_view, (float)x, (float)y, (float)eye, (float)yaw, (float)pitch, (float)fov, w, h);
    r2d_re2d_view_fog(&g_view, (float)num_arg(ctx, argc, argv, 6, 0.0), (float)num_arg(ctx, argc, argv, 7, 0.25));
    g_view_ready = true;
    return JS_TRUE;
}

// engine.re2d.project(points, out, count?) → число видимых точек.
// points — Float32Array stride 3 (x, y, z), out — Float32Array stride 4
// (sx, sy, z01, scale). Невидимая точка: z01 = -1, scale = 0.
static JSValue js_project(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    if (argc < 2) return JS_ThrowTypeError(ctx, "re2d.project(points: Float32Array, out: Float32Array, count?)");
    ensure_view();
    float *in = NULL, *out = NULL;
    size_t n_in = 0, n_out = 0;
    JSValue a = f32_view(ctx, argv[0], &in, &n_in);
    if (JS_IsException(a)) return a;
    JSValue b = f32_view(ctx, argv[1], &out, &n_out);
    if (JS_IsException(b)) { JS_FreeValue(ctx, a); return b; }
    size_t count = n_in / 3;
    if (n_out / 4 < count) count = n_out / 4;
    if (argc >= 3) {
        const double want = num_arg(ctx, argc, argv, 2, (double)count);
        if (want >= 0 && (size_t)want < count) count = (size_t)want;
    }
    const int visible = r2d_re2d_project_points(&g_view, in, (int)count, out);
    JS_FreeValue(ctx, a);
    JS_FreeValue(ctx, b);
    return JS_NewInt32(ctx, visible);
}

// engine.re2d.unproject(sx, sy, z?) → [x, y] | null.
// Пиксель → точка мира на плоскости высоты z (по умолчанию пол): тот же вид,
// что поставил view(). null — луч не попадает в плоскость (небо, параллель).
static JSValue js_unproject(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    if (argc < 2) return JS_ThrowTypeError(ctx, "re2d.unproject(sx, sy, z?)");
    ensure_view();
    float out[2];
    if (!r2d_re2d_unproject(&g_view, (float)num_arg(ctx, argc, argv, 0, 0), (float)num_arg(ctx, argc, argv, 1, 0),
                            (float)num_arg(ctx, argc, argv, 2, 0), out)) {
        return JS_NULL;
    }
    JSValue arr = JS_NewArray(ctx);
    JS_SetPropertyUint32(ctx, arr, 0, JS_NewFloat64(ctx, out[0]));
    JS_SetPropertyUint32(ctx, arr, 1, JS_NewFloat64(ctx, out[1]));
    return arr;
}

static void set_num(JSContext *ctx, JSValue obj, const char *key, double v);
// R-04 region/streaming JS bindings (definitions live with the world loaders).
static JSValue world_region_config(JSContext *,JSValueConst,int,JSValueConst *);
static JSValue world_impostors(JSContext *,JSValueConst,int,JSValueConst *);
static JSValue world_region_local(JSContext *,JSValueConst,int,JSValueConst *);
static JSValue world_region_budget(JSContext *,JSValueConst,int,JSValueConst *);
static JSValue world_region_lod(JSContext *,JSValueConst,int,JSValueConst *);

// engine.re2d.sprite(id) → { texture, u0, v0, u1, v1, w, h } | null.
// Откуда брать текстуру и её прямоугольник для меша: так граням и стенам
// задаётся обычный .sprite('путь.png'), а не отдельный «атрибут текстуры».
static JSValue js_sprite(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    R2DScript *s = JS_GetContextOpaque(ctx);
    const int id = (int)num_arg(ctx, argc, argv, 0, -1);
    if (!s || !s->renderer || !r2d_sprite_alive(s->renderer, id)) return JS_NULL;
    const R2DSprite *sp = &s->renderer->sprites[id];
    JSValue o = JS_NewObject(ctx);
    set_num(ctx, o, "texture", sp->texture);
    set_num(ctx, o, "u0", sp->u0);
    set_num(ctx, o, "v0", sp->v0);
    set_num(ctx, o, "u1", sp->u1);
    set_num(ctx, o, "v1", sp->v1);
    set_num(ctx, o, "w", sp->width);
    set_num(ctx, o, "h", sp->height);
    return o;
}

// engine.re2d.mesh(verts, count?, texture?, flags?) → отправлено вершин.
// verts — Float32Array stride 8 (x, y, z, u, v, r, g, b) в МИРОВЫХ координатах.
static JSValue js_mesh(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self;
    R2DScript *s = JS_GetContextOpaque(ctx);
    if (argc < 1) return JS_ThrowTypeError(ctx, "re2d.mesh(verts: Float32Array, count?, texture?, flags?)");
    ensure_view();
    float *in = NULL;
    size_t nfloats = 0;
    JSValue a = f32_view(ctx, argv[0], &in, &nfloats);
    if (JS_IsException(a)) return a;

    int count = (int)(nfloats / 8);
    if (argc >= 2) {
        const double want = num_arg(ctx, argc, argv, 1, (double)count);
        if (want >= 0 && want < count) count = (int)want;
    }
    count -= count % 3;
    const int texture = (int)num_arg(ctx, argc, argv, 2, -1);
    const unsigned flags = (unsigned)num_arg(ctx, argc, argv, 3, 0);

    memset(&g_stats, 0, sizeof g_stats);
    int submitted = 0;
    if (count >= 3) {
        // Запас под дробление близких крупных треугольников (re2d_math.c): буфер
        // заранее нужного размера не известен, поэтому при нехватке места считаем
        // заново с вдвое большим — вход тот же, результат детерминирован.
        int need = count * 3;
        for (;;) {
            if (need > g_scratch_cap) {
                float *grown = realloc(g_scratch, (size_t)need * 8 * sizeof(float));
                if (!grown) { JS_FreeValue(ctx, a); return JS_ThrowOutOfMemory(ctx); }
                g_scratch = grown;
                g_scratch_cap = need;
            }
            submitted = r2d_re2d_mesh(&g_view, in, count, g_scratch, g_scratch_cap, flags, &g_stats);
            if (g_stats.overflow == 0 || g_scratch_cap >= R2D_RE2D_MAX_VERTS) break;
            need = g_scratch_cap * 2;
        }
        if (submitted > 0 && s && s->renderer) {
            r2d_batch_mesh(s->renderer, g_scratch, submitted, texture);
            ++g_meshes;
            g_mesh_verts += submitted;
        }
    }
    JS_FreeValue(ctx, a);
    return JS_NewInt32(ctx, submitted);
}

static void set_num(JSContext *ctx, JSValue obj, const char *key, double v)
{
    JS_SetPropertyStr(ctx, obj, key, JS_NewFloat64(ctx, v));
}

// engine.re2d.info() → вид и счётчики последнего mesh(): факты, а не пояснения.
static JSValue js_info(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv)
{
    (void)self; (void)argc; (void)argv;
    ensure_view();
    JSValue o = JS_NewObject(ctx);
    set_num(ctx, o, "x", g_view.x);
    set_num(ctx, o, "y", g_view.y);
    set_num(ctx, o, "eye", g_view.eye);
    set_num(ctx, o, "yaw", g_view.yaw);
    set_num(ctx, o, "pitch", g_view.pitch);
    set_num(ctx, o, "fov", g_view.fov);
    set_num(ctx, o, "focal", g_view.focal);
    set_num(ctx, o, "width", g_view.width);
    set_num(ctx, o, "height", g_view.height);
    set_num(ctx, o, "near", g_view.near_plane);
    set_num(ctx, o, "fogFar", g_view.fog_far);
    set_num(ctx, o, "fogMin", g_view.fog_min);
    JSValue st = JS_NewObject(ctx);
    set_num(ctx, st, "trisIn", g_stats.tris_in);
    set_num(ctx, st, "trisOut", g_stats.tris_out);
    set_num(ctx, st, "behind", g_stats.behind);
    set_num(ctx, st, "clipped", g_stats.clipped);
    set_num(ctx, st, "split", g_stats.split);
    set_num(ctx, st, "culled", g_stats.culled);
    set_num(ctx, st, "invalid", g_stats.invalid);
    set_num(ctx, st, "overflow", g_stats.overflow);
    set_num(ctx, st, "meshes", g_meshes);
    set_num(ctx, st, "meshVerts", g_mesh_verts);
    JS_SetPropertyStr(ctx, o, "stats", st);
    return o;
}


// World lifetime belongs to its QJS handle, like Re2DSprite. No global world.
typedef R2DWorldRuntime WorldHandle;
static JSClassID world_class;
static WorldHandle *world_registry;

// P1 R-03 VFX binding: the VFX manager is host-owned state keyed to the world
// handle. It is kept out of R2DWorldRuntime so renderer/other feature modules
// stay independent; hooks adapt world lights/decals/queries to the pure module.
typedef struct VfxBinding {
    WorldHandle *world;
    R2DWorldVfx vfx;
    struct VfxBinding *next;
} VfxBinding;
static VfxBinding *vfx_bindings;

static VfxBinding *vfx_binding(WorldHandle *w)
{
    for(VfxBinding *b=vfx_bindings;b;b=b->next)if(b->world==w)return b;
    return NULL;
}
static int vfx_hook_light_create(void *user,float x,float y,float h,float radius,
                                 float intensity,float r,float g,float b,bool shadow,float life)
{
    VfxBinding *binding=(VfxBinding *)user;
    R2DWorldLight light;
    memset(&light,0,sizeof light);
    light.x=x;light.y=y;light.h=h;light.radius=radius;light.intensity=intensity;
    light.r=r;light.g=g;light.b=b;light.shadow=shadow;light.remaining=life;
    return r2d_world_light_create(&binding->world->world,&light);
}
static bool vfx_hook_light_remove(void *user,int token)
{
    VfxBinding *binding=(VfxBinding *)user;
    return r2d_world_light_remove(&binding->world->world,token);
}
static int vfx_hook_decal_spawn(void *user,float x,float y,float h,
                                float dx,float dy,float dh,int material,
                                float width,float height,float life)
{
    VfxBinding *binding=(VfxBinding *)user;
    R2DRe2dWorld *world=&binding->world->world;
    const float length=sqrtf(dx*dx+dy*dy+dh*dh);
    if(!(length>0.0f))return -1;
    const float origin[3]={x,y,h};
    const float direction[3]={dx/length,dy/length,dh/length};
    R2DWorldHit hit;
    if(!r2d_world_ray(world,origin,direction,0.0f,1000000.0f,&hit))return -1;
    int surface=-1;
    if(hit.wall>=0)surface=r2d_world_wall_surface(world,hit.wall);
    else if(hit.span>=0)surface=r2d_world_span_surface(world,hit.span,
        hit.ceiling?R2D_WORLD_CEILING:R2D_WORLD_FLOOR);
    if(surface<0)return -1;
    R2DWorldDecal decal;
    memset(&decal,0,sizeof decal);
    decal.surface=surface;decal.material=material;
    decal.w=width;decal.h=height;decal.remaining=life;
    return r2d_world_decal_create(world,&decal);
}
static bool vfx_hook_decal_remove(void *user,int token)
{
    VfxBinding *binding=(VfxBinding *)user;
    return r2d_world_decal_remove(&binding->world->world,token);
}
static bool vfx_hook_support(void *user,float x,float y,float h,float *floor,float *ceiling)
{
    VfxBinding *binding=(VfxBinding *)user;
    R2DRe2dWorld *world=&binding->world->world;
    const int span=r2d_world_support(world,x,y,h+0.25f,1.0f,1000000.0f);
    if(span<0||span>=world->span_count)return false;
    *floor=r2d_world_floor_height(&world->spans[span],x,y);
    *ceiling=r2d_world_ceiling_height(&world->spans[span],x,y);
    return true;
}
static bool vfx_hook_blocked(void *user,float x,float y,float radius,float bottom,float top)
{
    VfxBinding *binding=(VfxBinding *)user;
    return r2d_world_blocked(&binding->world->world,x,y,radius,bottom,top);
}
static bool vfx_attach(WorldHandle *w)
{
    VfxBinding *binding=(VfxBinding *)calloc(1,sizeof *binding);
    if(!binding)return false;
    binding->world=w;
    r2d_world_vfx_init(&binding->vfx,NULL,16);
    R2DWorldVfxHooks hooks;
    memset(&hooks,0,sizeof hooks);
    hooks.user=binding;
    hooks.light_create=vfx_hook_light_create;
    hooks.light_remove=vfx_hook_light_remove;
    hooks.decal_spawn=vfx_hook_decal_spawn;
    hooks.decal_remove=vfx_hook_decal_remove;
    hooks.support=vfx_hook_support;
    hooks.blocked=vfx_hook_blocked;
    r2d_world_vfx_hooks(&binding->vfx,&hooks);
    w->vfx=&binding->vfx;
    binding->next=vfx_bindings;
    vfx_bindings=binding;
    return true;
}
static void vfx_detach(WorldHandle *w)
{
    VfxBinding **entry=&vfx_bindings;
    while(*entry&&(*entry)->world!=w)entry=&(*entry)->next;
    if(!*entry)return;
    VfxBinding *binding=*entry;
    *entry=binding->next;
    if(binding->world)binding->world->vfx=NULL;
    r2d_world_vfx_clear(&binding->vfx);
    free(binding);
}
static void world_dispose(WorldHandle *w)
{
    if(!w || w->disposed)return;
    if(w->registered){WorldHandle **entry=&world_registry;while(*entry&&*entry!=w)entry=&(*entry)->next;if(*entry==w)*entry=w->next;w->registered=false;}
    vfx_detach(w);
    r2d_world_audio_free(w);r2d_world_free(&w->world);r2d_world_visibility_free(&w->visibility);r2d_world_runtime_actors_free(w);
    if(w->texture>=0) r2d_texture_free(w->renderer,w->texture);
    SDL_free(w->watch_path);w->watch_path=NULL;free(w->rgba);free(w->depth);free(w->owners);w->owners=NULL;w->rgba=NULL;w->depth=NULL;
    w->texture=w->sprite=-1;w->disposed=true;
}
static void world_finalizer(JSRuntime *rt,JSValue value)
{ (void)rt;WorldHandle *w=JS_GetOpaque(value,world_class);world_dispose(w);free(w); }
static WorldHandle *world_get(JSContext *ctx,JSValueConst self)
{
    WorldHandle *w=JS_GetOpaque2(ctx,self,world_class);
    if(w && w->disposed) {JS_ThrowTypeError(ctx,"RE2D World: ресурс освобождён");return NULL;}
    return w;
}
static bool world_numbers(JSContext *ctx,int argc,JSValueConst *argv,int n,float *out)
{
    if(argc<n) {JS_ThrowTypeError(ctx,"RE2D World: недостаточно аргументов");return false;}
    for(int i=0;i<n;i++) {
        double v;
        if(JS_ToFloat64(ctx,&v,argv[i])<0) return false;
        if(!isfinite(v)||fabs(v)>1e6) {JS_ThrowRangeError(ctx,"RE2D World: конечные числа в пределах +/-1000000");return false;}
        out[i]=(float)v;
    }
    return true;
}
static bool world_token(JSContext *ctx,int argc,JSValueConst *argv,int *out)
{
    double id;if(argc<1){JS_ThrowTypeError(ctx,"Re2D World: missing handle");return false;}
    if(JS_ToFloat64(ctx,&id,argv[0])<0)return false;
    if(!isfinite(id)||id<0||id>2147483647.0||id!=floor(id)){JS_ThrowRangeError(ctx,"Re2D World: integer handle required");return false;}
    *out=(int)id;return true;
}
static uint32_t world_rgb(const float *v)
{ return 0xff000000u|(uint32_t)v[0]|((uint32_t)v[1]<<8)|((uint32_t)v[2]<<16); }
static bool world_rows(JSContext *ctx,const float *p,size_t n,int stride)
{
    if(n%(size_t)stride || n/(size_t)stride>65536) {JS_ThrowRangeError(ctx,"RE2D World: неверная длина массива");return false;}
    for(size_t i=0;i<n;i++) {
        if(!isfinite(p[i])||fabsf(p[i])>1e6f || (i%(size_t)stride>=6 && (p[i]<0||p[i]>255))) {
            JS_ThrowRangeError(ctx,"RE2D World: конечная геометрия и RGB 0..255");return false;
        }
    }
    return true;
}
static JSValue world_release(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=JS_GetOpaque2(ctx,self,world_class);
    if(!w) return JS_EXCEPTION;if(w->rendering)return JS_ThrowTypeError(ctx,"Re2D World: cannot dispose during rendering");world_dispose(w);return JS_UNDEFINED;
}
static JSValue world_support(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[5];if(!w||!world_numbers(ctx,argc,argv,5,p)) return JS_EXCEPTION;
    if(p[3]<=0||p[4]<0) return JS_ThrowRangeError(ctx,"World.support: height>0, step>=0");
    int i=r2d_world_support(&w->world,p[0],p[1],p[2],p[3],p[4]);if(i<0) return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"span",i);set_num(ctx,o,"height",r2d_world_floor_height(&w->world.spans[i],p[0],p[1]));set_num(ctx,o,"ceiling",r2d_world_ceiling_height(&w->world.spans[i],p[0],p[1]));return o;
}
static JSValue world_blocked(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[5];if(!w||!world_numbers(ctx,argc,argv,5,p)) return JS_EXCEPTION;
    if(p[2]<0||p[4]<=p[3]) return JS_ThrowRangeError(ctx,"World.blocked: radius>=0, top>bottom");
    return JS_NewBool(ctx,r2d_world_blocked(&w->world,p[0],p[1],p[2],p[3],p[4]));
}
static JSValue world_ray(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[6];if(!w||!world_numbers(ctx,argc,argv,6,p)) return JS_EXCEPTION;
    float d[3]={p[3]-p[0],p[4]-p[1],p[5]-p[2]};R2DWorldHit h;
    if(!r2d_world_ray(&w->world,p,d,0,1,&h)) return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"fraction",h.t);set_num(ctx,o,"x",h.x);set_num(ctx,o,"y",h.y);
    set_num(ctx,o,"height",h.height);set_num(ctx,o,"wall",h.wall);set_num(ctx,o,"span",h.span);
    JS_SetPropertyStr(ctx,o,"ceiling",JS_NewBool(ctx,h.ceiling));return o;
}
static JSValue material_info_object(JSContext *ctx,R2DWorldRuntime *w,int index)
{
    if(!w||index<0||index>=R2D_WORLD_MAX_MATERIALS)return JS_NULL;
    const R2DWorldMaterial *m=&w->world.materials[index];
    if(!m->used)return JS_NULL;
    JSValue o=JS_NewObject(ctx);
    set_num(ctx,o,"index",index);
    JS_SetPropertyStr(ctx,o,"name",JS_NewString(ctx,m->name));
    set_num(ctx,o,"blend",m->blend);set_num(ctx,o,"opacity",m->opacity);
    set_num(ctx,o,"uScale",m->u_scale);set_num(ctx,o,"vScale",m->v_scale);
    set_num(ctx,o,"emissiveStrength",m->emissive_strength);
    JS_SetPropertyStr(ctx,o,"worldUV",JS_NewBool(ctx,m->world_uv));
    JS_SetPropertyStr(ctx,o,"linear",JS_NewBool(ctx,m->linear));
    JSValue albedo=JS_NewObject(ctx);set_num(ctx,albedo,"width",m->albedo.width);set_num(ctx,albedo,"height",m->albedo.height);
    JSValue normal=JS_NewObject(ctx);set_num(ctx,normal,"width",m->normal.width);set_num(ctx,normal,"height",m->normal.height);
    JSValue emissive=JS_NewObject(ctx);set_num(ctx,emissive,"width",m->emissive.width);set_num(ctx,emissive,"height",m->emissive.height);
    JS_SetPropertyStr(ctx,o,"albedo",albedo);JS_SetPropertyStr(ctx,o,"normal",normal);JS_SetPropertyStr(ctx,o,"emissive",emissive);
    int surfaces=0;
    if(w->world.surface_materials)for(int i=0;i<w->world.surface_count;i++)if(w->world.surface_materials[i]==index)surfaces++;
    set_num(ctx,o,"surfaceCount",surfaces);
    float tint[3],uv[2];
    r2d_world_render_variation((uint32_t)index,0,w->render_features.seed,w->render_features.variation_strength,tint,uv);
    JSValue variation=JS_NewObject(ctx);
    set_num(ctx,variation,"tintR",tint[0]);set_num(ctx,variation,"tintG",tint[1]);set_num(ctx,variation,"tintB",tint[2]);
    set_num(ctx,variation,"uvU",uv[0]);set_num(ctx,variation,"uvV",uv[1]);
    JS_SetPropertyStr(ctx,o,"variation",variation);
    return o;
}
static JSValue vfx_info_object(JSContext *ctx,const R2DWorldVfxInfo *info);
static JSValue sky_layers_array(JSContext *ctx,R2DWorldRuntime *w);
// P4 static batching switch: on by default; false restores the per-surface GPU
// path (fallback used for overdraw/non-final debug views and old devices).
static JSValue world_batch_gpu(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<1)return JS_NewBool(ctx,w->batch_gpu);
    w->batch_gpu=JS_ToBool(ctx,argv[0])>0;
    return JS_NewBool(ctx,w->batch_gpu);
}

static JSValue world_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w) return JS_EXCEPTION;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"walls",w->world.wall_count);set_num(ctx,o,"spans",w->world.span_count);
    set_num(ctx,o,"drawCalls",w->gpu_draws);set_num(ctx,o,"culledSurfaces",w->world.surface_count-w->visibility.surface_count);
    set_num(ctx,o,"shadowMs",w->shadow_ms);set_num(ctx,o,"gpuSubmitMs",w->gpu_submit_ms);set_num(ctx,o,"gpuCompletionWaitMs",w->gpu_completion_ms);
    set_num(ctx,o,"gpuMaterialBatches",w->gpu_material_batches);set_num(ctx,o,"internalTriangles",w->gpu_draws);
    set_num(ctx,o,"cellsRejected",w->world.cell_count-w->visibility.cells_visible);set_num(ctx,o,"surfacesRejected",w->world.surface_count-w->visibility.surface_count);
    set_num(ctx,o,"cpuFramePayloadBytes",(double)w->width*w->height*(4+sizeof(float)+sizeof(R2DWorldPixelOwner)));
    size_t material_bytes=(size_t)w->world.sky.width*w->world.sky.height*4;
    for(int i=0;i<64;i++){const R2DWorldMaterial *m=&w->world.materials[i];material_bytes+=(size_t)m->albedo.width*m->albedo.height*4+(size_t)m->normal.width*m->normal.height*4+(size_t)m->emissive.width*m->emissive.height*4;}
    set_num(ctx,o,"cpuMaterialPayloadBytes",material_bytes);set_num(ctx,o,"gpuTexturePayloadBytes",w->gpu_texture_bytes);set_num(ctx,o,"gpuBufferPayloadBytes",w->gpu_transfer_bytes);set_num(ctx,o,"gpuShadowUpdates",w->gpu_shadow_updates);
    set_num(ctx,o,"decals",w->world.decal_count);set_num(ctx,o,"lightUpdates",w->world.light_updates);
    {
        JSValue materials=JS_NewArray(ctx);uint32_t materialCount=0;
        for(int i=0;i<R2D_WORLD_MAX_MATERIALS;i++)if(w->world.materials[i].used){
            JSValue entry=material_info_object(ctx,w,i);
            if(!JS_IsNull(entry))JS_SetPropertyUint32(ctx,materials,materialCount++,entry);else JS_FreeValue(ctx,entry);
        }
        set_num(ctx,o,"materialCount",materialCount);
        // `materials` already means the material count for legacy consumers;
        // the inspector array is additive under materialList.
        JS_SetPropertyStr(ctx,o,"materialList",materials);
    }
    set_num(ctx,o,"reloadCount",w->reload_count);JS_SetPropertyStr(ctx,o,"reloadError",JS_NewString(ctx,w->reload_error));
    JS_SetPropertyStr(ctx,o,"backend",JS_NewString(ctx,w->gpu_enabled?"gpu-reference":"cpu-reference"));set_num(ctx,o,"gpuDraws",w->gpu_draws);
    set_num(ctx,o,"gpuDrawsBase",w->gpu_draw_base);set_num(ctx,o,"gpuDrawsSpan",w->gpu_draw_span);
    set_num(ctx,o,"gpuDrawsActor",w->gpu_draw_actor);set_num(ctx,o,"gpuDrawsOther",w->gpu_draw_other);
    set_num(ctx,o,"gpuDrawsGround",w->gpu_draw_ground);
    set_num(ctx,o,"gpuDrawsVfx",w->gpu_draw_vfx);
    // P0/P1 visual feature counters. Additive fields: the legacy draw
    // attribution above is preserved exactly (ground draws are their own
    // bucket, while sky/decals stay in gpuDrawsOther).
    R2DWorldRenderCounters *c=&w->render_counters;
    JSValue v=JS_NewObject(ctx);
    set_num(ctx,v,"quality",w->render_features.quality);
    set_num(ctx,v,"groundedActors",c->grounded_actors);set_num(ctx,v,"contactShadows",c->contact_shadows);
    set_num(ctx,v,"footAo",c->foot_ao);set_num(ctx,v,"floorTint",c->floor_tint);set_num(ctx,v,"contactLit",c->contact_lit);
    set_num(ctx,v,"edgeActors",c->edge_actors);set_num(ctx,v,"outlineActors",c->outline_actors);set_num(ctx,v,"grimeActors",c->grime_actors);
    set_num(ctx,v,"variedSurfaces",c->varied_surfaces);set_num(ctx,v,"macroSurfaces",c->macro_surfaces);
    set_num(ctx,v,"bevelSurfaces",c->bevel_surfaces);set_num(ctx,v,"cornerAoSurfaces",c->corner_ao_surfaces);
    set_num(ctx,v,"fogSurfaces",c->fog_surfaces);set_num(ctx,v,"hazeSurfaces",c->haze_surfaces);
    set_num(ctx,v,"liquidSurfaces",c->liquid_surfaces);set_num(ctx,v,"animatedMaterials",c->animated_materials);
    set_num(ctx,v,"skyLayers",c->sky_layers);set_num(ctx,v,"celestialDiscs",c->celestial_discs);
    set_num(ctx,v,"skySurfaces",c->sky_surfaces);set_num(ctx,v,"reflectionPasses",c->reflection_passes);
    set_num(ctx,v,"groundDraws",c->ground_draws);set_num(ctx,v,"skyDraws",c->sky_draws);set_num(ctx,v,"decals",c->decals);
    set_num(ctx,v,"vfxCards",c->vfx_cards);set_num(ctx,v,"vfxTrails",c->vfx_trails);
    set_num(ctx,v,"vfxDistortion",c->vfx_distortion);set_num(ctx,v,"vfxCardDraws",c->vfx_card_draws);
    set_num(ctx,v,"vfxTrailDraws",c->vfx_trail_draws);set_num(ctx,v,"vfxDraws",c->vfx_draws);
    // P4/P5 renderer counters (sky cards, shafts, batching, residency model).
    set_num(ctx,v,"shafts",c->shafts);set_num(ctx,v,"weatherCards",c->weather_cards);
    set_num(ctx,v,"distantCards",c->distant_cards);set_num(ctx,v,"distantImpostors",c->distant_impostors);set_num(ctx,v,"ambientSamples",c->ambient_samples);
    set_num(ctx,v,"detailSamples",c->detail_samples);set_num(ctx,v,"decals2",c->decal2_active);
    set_num(ctx,v,"batchDraws",c->batch_draws);set_num(ctx,v,"batchBatches",c->batch_batches);
    set_num(ctx,v,"batchSaved",c->batch_saved);set_num(ctx,v,"residentTextures",c->resident_textures);
    set_num(ctx,v,"uploadBytes",(double)c->upload_bytes);
    set_num(ctx,v,"postPasses",c->post_passes);set_num(ctx,v,"postBloom",c->post_bloom);
    set_num(ctx,v,"postReflection",c->post_reflection);set_num(ctx,v,"postHeat",c->post_heat);
    // P4 static-batch data path. Additive counters; legacy draw attribution
    // (gpuDraws*/batchDraws*) above is untouched.
    const R2DWorldBatchStats *batch=r2d_world_batch_stats(w);
    set_num(ctx,v,"staticBatchGroups",batch?batch->groups:0);
    set_num(ctx,v,"staticBatchInstances",batch?batch->instances:0);
    set_num(ctx,v,"staticBatchSavedBinds",batch?batch->saved_binds:0);
    set_num(ctx,v,"staticBatchSurfaces",batch?batch->surfaces:0);
    set_num(ctx,v,"staticBatchActors",batch?batch->actors:0);
    set_num(ctx,v,"staticBatchSkies",batch?batch->skies:0);
    set_num(ctx,v,"staticBatchOverflow",batch?batch->overflow:0);
    set_num(ctx,v,"gpuBatchDraws",w->gpu_batch_draws);
    set_num(ctx,v,"gpuBatchInstances",w->gpu_batch_instances);
    set_num(ctx,v,"gpuBatchSavedDraws",w->gpu_batch_saved);
    set_num(ctx,v,"gpuBatchLogicalDraws",w->gpu_batch_logical);
    set_num(ctx,v,"renderTime",w->render_time);
    JS_SetPropertyStr(ctx,o,"visual",v);
    {
        JSValue sky=JS_NewObject(ctx);
        const R2DWorldSky *cfg=r2d_world_runtime_sky_config(w);
        set_num(ctx,sky,"count",r2d_world_runtime_sky_layer_count(w));
        JS_SetPropertyStr(ctx,sky,"error",JS_NewString(ctx,r2d_world_runtime_sky_layer_error(w)));
        JS_SetPropertyStr(ctx,sky,"layers",sky_layers_array(ctx,w));
        JS_SetPropertyStr(ctx,sky,"sun",JS_NewString(ctx,cfg?cfg->sun_texture:""));
        JS_SetPropertyStr(ctx,sky,"moon",JS_NewString(ctx,cfg?cfg->moon_texture:""));
        JSValue weather=JS_NewObject(ctx);
        if(cfg){
            const char *names[5]={"none","rain","snow","ash","clouds"};
            for(int i=1;i<5;i++)JS_SetPropertyStr(ctx,weather,names[i],JS_NewString(ctx,cfg->weather_texture[i]));
        }
        JS_SetPropertyStr(ctx,sky,"weather",weather);
        JS_SetPropertyStr(ctx,o,"sky",sky);
    }
    JS_SetPropertyStr(ctx,o,"gpuWait",JS_NewBool(ctx,w->gpu_wait));
    JS_SetPropertyStr(ctx,o,"bakedLighting",JS_NewBool(ctx,w->world.baked_lighting));
    JS_SetPropertyStr(ctx,o,"bakedTopology",JS_NewBool(ctx,w->world.baked_topology));
    set_num(ctx,o,"posesUpdated",w->poses_updated);set_num(ctx,o,"posesDeferred",w->poses_deferred);set_num(ctx,o,"poseBudget",w->pose_budget);set_num(ctx,o,"poseStep",w->pose_step);
    set_num(ctx,o,"frameMs",w->frame_ms);set_num(ctx,o,"visibilityMs",w->visibility_ms);set_num(ctx,o,"lightCullMs",w->light_cull_ms);set_num(ctx,o,"surfaceMs",w->surface_ms);set_num(ctx,o,"actorMs",w->actor_ms);set_num(ctx,o,"compositionMs",w->composition_ms);set_num(ctx,o,"uploadMs",w->upload_ms);
    set_num(ctx,o,"lightsAfterCull",w->visible_lights);set_num(ctx,o,"shadowedLights",w->shadowed_lights);
    set_num(ctx,o,"actors",w->actor_count);set_num(ctx,o,"actorCandidates",w->frame_count);set_num(ctx,o,"composedActors",w->visible_actor_count);
    set_num(ctx,o,"atlasSprites",w->atlas_count);set_num(ctx,o,"visibleAtlasSprites",w->visible_atlas_count);
    set_num(ctx,o,"hitProxies",w->hit_count);
    set_num(ctx,o,"movers",w->mover_count);set_num(ctx,o,"triggers",w->trigger_count);
    set_num(ctx,o,"particles",w->particle_ready?w->particles.count:0);set_num(ctx,o,"particlesDrawn",w->particles_drawn);
    R2DWorldVfxInfo vfx_info;memset(&vfx_info,0,sizeof vfx_info);
    VfxBinding *vfx_state=vfx_binding(w);
    if(vfx_state)r2d_world_vfx_info(&vfx_state->vfx,&vfx_info);
    set_num(ctx,o,"particlesAlive",vfx_info.particles_alive);
    set_num(ctx,o,"particleCapacity",vfx_info.particle_capacity);
    set_num(ctx,o,"particleOverflow",vfx_info.particle_overflow);
    set_num(ctx,o,"particlesSpawned",vfx_info.particles_spawned);
    set_num(ctx,o,"emitters",vfx_info.emitters);
    set_num(ctx,o,"fxBundles",vfx_info.bundles);
    set_num(ctx,o,"tempLights",vfx_info.temp_lights);
    set_num(ctx,o,"vfxLightBudget",vfx_info.light_budget);
    set_num(ctx,o,"vfxLightOverflow",vfx_info.light_overflow);
    set_num(ctx,o,"vfxDecals",vfx_info.decals);
    set_num(ctx,o,"distortionCards",vfx_info.distortion_cards);
    set_num(ctx,o,"vfxCards",vfx_info.cards);
    set_num(ctx,o,"vfxTrails",vfx_info.trails);
    JS_SetPropertyStr(ctx,o,"vfx",vfx_state?vfx_info_object(ctx,&vfx_info):JS_NULL);
    // R-04: runtime region partition (built lazily, refreshed every frame).
    bool region_ok=r2d_world_regions_ensure(w);
    const R2DWorldRegionSet *regions=region_ok?r2d_world_regions(w):NULL;
    set_num(ctx,o,"regionCount",regions?regions->region_count:0);
    set_num(ctx,o,"regionCurrent",regions?w->region_current:-1);
    set_num(ctx,o,"regionActive",regions?w->region_active_count:0);
    set_num(ctx,o,"regionPreload",regions?w->region_preload_count:0);
    set_num(ctx,o,"regionResident",regions?regions->metrics.resident_count:0);
    set_num(ctx,o,"regionUnloaded",regions?regions->metrics.unloaded_count:0);
    set_num(ctx,o,"regionCulled",regions?regions->metrics.culled_regions:0);
    set_num(ctx,o,"regionPvsEdges",regions?regions->metrics.pvs_edges:0);
    set_num(ctx,o,"regionPvsCulled",w->region_pvs_culled);
    set_num(ctx,o,"regionSizeHint",w->region_size_hint);
    set_num(ctx,o,"regionClusterEdges",w->cluster_ready?w->clusters.pvs_edges:0);
    set_num(ctx,o,"regionOccluderCulled",w->region_occluder_culled);
    set_num(ctx,o,"regionClusterCulled",w->region_cells_culled);
    set_num(ctx,o,"regionCellsAllowed",w->region_cells_allowed);
    set_num(ctx,o,"regionCellsCulled",w->region_cells_culled);
    set_num(ctx,o,"streamUploads",w->stream_stats.uploads);
    set_num(ctx,o,"streamTotalUploads",(double)w->stream_total_uploads);
    set_num(ctx,o,"streamTotalUploadBytes",(double)w->stream_total_upload_bytes);
    set_num(ctx,o,"streamTotalEvictions",(double)w->stream_total_evictions);
    set_num(ctx,o,"streamUploadBytes",(double)w->stream_stats.upload_bytes);
    set_num(ctx,o,"streamEvictions",w->stream_stats.evicted);
    set_num(ctx,o,"streamResidentBytes",(double)w->stream_stats.resident_bytes);
    set_num(ctx,o,"streamResident",w->stream_stats.resident);
    set_num(ctx,o,"streamPreload",w->stream_stats.preload);
    set_num(ctx,o,"texturesResident",w->stream_stats.textures_resident);
    set_num(ctx,o,"atlasesResident",w->stream_stats.atlases_resident);
    set_num(ctx,o,"regionStreamMs",w->region_stream_ms);
    set_num(ctx,o,"regionStreamIoMs",w->region_stream_io_ms);
    set_num(ctx,o,"regionLoadMs",w->region_load_ms);
    set_num(ctx,o,"regionVisibilityMs",w->region_visibility_ms);
    set_num(ctx,o,"impostorCount",w->impostor_ready?w->impostors.count:0);
    set_num(ctx,o,"visibleImpostors",w->visible_impostor_count);
    set_num(ctx,o,"lodHiddenActors",w->lod_hidden_actors);
    set_num(ctx,o,"lodThrottledActors",w->lod_throttled_actors);
    set_num(ctx,o,"lodHiddenAtlas",w->lod_hidden_atlas);
    set_num(ctx,o,"lodCulledLights",w->lod_culled_lights);
    set_num(ctx,o,"lodCulledParticles",w->lod_culled_particles);
    set_num(ctx,o,"lodCulledDecals",w->lod_culled_decals);
    set_num(ctx,o,"audioRegionCulled",w->audio_region_culled);
    set_num(ctx,o,"renderOriginX",w->render_origin_x);
    set_num(ctx,o,"renderOriginY",w->render_origin_y);
    set_num(ctx,o,"renderOriginRegion",w->render_origin_region);
    set_num(ctx,o,"gpuStreamUploads",(double)w->gpu_stream_uploads);
    set_num(ctx,o,"gpuStreamUploadBytes",(double)w->gpu_stream_upload_bytes);
    set_num(ctx,o,"gpuStreamEvictions",(double)w->gpu_stream_evictions);
    set_num(ctx,o,"gpuStreamTransitions",(double)w->gpu_stream_transitions);
    set_num(ctx,o,"gpuTexturesResident",w->gpu_textures_resident);
    set_num(ctx,o,"gpuAtlasesResident",w->gpu_atlases_resident);
    set_num(ctx,o,"gpuLightsCulled",w->gpu_lod_culled_lights);
    set_num(ctx,o,"gpuDecalsCulled",w->gpu_lod_culled_decals);
    set_num(ctx,o,"gpuSpriteDirReduced",w->gpu_sprite_dir_reduced);
    set_num(ctx,o,"gpuImpostorsDrawn",w->gpu_impostors_drawn);
    set_num(ctx,o,"gpuRenderOriginActive",w->gpu_render_origin_active?1:0);
    set_num(ctx,o,"gpuOriginX",w->gpu_render_origin_x);
    set_num(ctx,o,"gpuOriginY",w->gpu_render_origin_y);
    set_num(ctx,o,"hintWalls",w->hint_wall_count);
    set_num(ctx,o,"skipWalls",w->skip_wall_count);
    set_num(ctx,o,"occluderWalls",w->occluder_wall_count);
    // Task-15: true region payload residency. Master world arrays stay as the
    // query fallback; these counters describe the heap payload packets.
    set_num(ctx,o,"streamIoPayloads",w->stream_io_ready?w->stream_io.count:0);
    set_num(ctx,o,"streamIoResidentPayloads",w->stream_io_ready?w->stream_io_stats.resident:0);
    set_num(ctx,o,"streamIoLoadingPayloads",w->stream_io_ready?w->stream_io_stats.loading:0);
    set_num(ctx,o,"streamIoQueuedLoad",w->stream_io_ready?w->stream_io_stats.queued_load:0);
    set_num(ctx,o,"streamIoQueuedUnload",w->stream_io_ready?w->stream_io_stats.queued_unload:0);
    set_num(ctx,o,"streamIoResidentBytes",w->stream_io_ready?(double)w->stream_io_stats.resident_bytes:0);
    set_num(ctx,o,"streamIoMaxTickBytes",w->stream_io_ready?(double)w->stream_io_peak_tick_bytes:0);
    set_num(ctx,o,"streamIoLoadBytes",w->stream_io_ready?(double)w->stream_io_stats.bytes_loaded:0);
    set_num(ctx,o,"streamIoUnloadBytes",w->stream_io_ready?(double)w->stream_io_stats.bytes_unloaded:0);
    set_num(ctx,o,"streamIoLoads",(double)w->stream_io_loads_total);
    set_num(ctx,o,"streamIoUnloads",(double)w->stream_io_unloads_total);
    set_num(ctx,o,"streamIoTotalBytes",(double)w->stream_io_bytes_total);
    set_num(ctx,o,"streamIoLoadBudgetBytes",w->stream_io_ready?(double)w->stream_io_budget.load_budget_bytes:0);
    set_num(ctx,o,"streamIoUnloadBudgetBytes",w->stream_io_ready?(double)w->stream_io_budget.unload_budget_bytes:0);
    if(regions){
        JSValue ro=JS_NewObject(ctx);
        set_num(ctx,ro,"count",regions->region_count);set_num(ctx,ro,"columns",regions->columns);set_num(ctx,ro,"rows",regions->rows);
        set_num(ctx,ro,"size",regions->region_size);set_num(ctx,ro,"current",w->region_current);
        set_num(ctx,ro,"active",w->region_active_count);set_num(ctx,ro,"preload",w->region_preload_count);
        set_num(ctx,ro,"resident",regions->metrics.resident_count);set_num(ctx,ro,"culled",regions->metrics.culled_regions);
        set_num(ctx,ro,"clusterEdges",w->cluster_ready?w->clusters.pvs_edges:0);
        set_num(ctx,ro,"occluderCulled",w->region_occluder_culled);
        set_num(ctx,ro,"cellsAllowed",w->region_cells_allowed);
        set_num(ctx,ro,"cellsCulled",w->region_cells_culled);
        set_num(ctx,ro,"impostors",w->visible_impostor_count);
        set_num(ctx,ro,"streamUploads",w->stream_stats.uploads);
        set_num(ctx,ro,"streamEvictions",w->stream_stats.evicted);
        set_num(ctx,ro,"payloads",w->stream_io_ready?w->stream_io.count:0);
        set_num(ctx,ro,"payloadResident",w->stream_io_ready?w->stream_io_stats.resident:0);
        set_num(ctx,ro,"payloadResidentBytes",w->stream_io_ready?(double)w->stream_io_stats.resident_bytes:0);
        set_num(ctx,ro,"payloadLoads",(double)w->stream_io_loads_total);
        set_num(ctx,ro,"payloadUnloads",(double)w->stream_io_unloads_total);
        JSValue origin=JS_NewObject(ctx);
        set_num(ctx,origin,"x",w->render_origin_x);set_num(ctx,origin,"y",w->render_origin_y);
        set_num(ctx,origin,"region",w->render_origin_region);
        JS_SetPropertyStr(ctx,ro,"renderOrigin",origin);
        JSValue list=JS_NewArray(ctx);
        for(int i=0;i<w->region_active_count;i++)JS_SetPropertyUint32(ctx,list,(uint32_t)i,JS_NewInt32(ctx,w->region_active[i]));
        JS_SetPropertyStr(ctx,ro,"activeList",list);
        JS_SetPropertyStr(ctx,o,"regions",ro);
    }else JS_SetPropertyStr(ctx,o,"regions",JS_NULL);
    set_num(ctx,o,"traceMs",w->trace_ms);set_num(ctx,o,"traceCalls",w->trace_calls);
    set_num(ctx,o,"controllerMs",w->controller_ms);set_num(ctx,o,"controllerCalls",w->controller_calls);
    set_num(ctx,o,"navMs",w->nav_ms);set_num(ctx,o,"navQueries",w->nav_queries);
    set_num(ctx,o,"audioVoicesActive",w->audio_active);set_num(ctx,o,"audioVoicesVirtual",w->audio_virtual);

    set_num(ctx,o,"materials",w->world.material_count);
    set_num(ctx,o,"lights",w->world.light_count);set_num(ctx,o,"lightSpanPairs",w->world.light_pairs);set_num(ctx,o,"lightOverflow",w->world.light_overflow);
    set_num(ctx,o,"visibleCells",w->visibility.cells_visible);set_num(ctx,o,"visibleSpans",w->visibility.span_count);set_num(ctx,o,"visibleSurfaces",w->visibility.surface_count);set_num(ctx,o,"portalsTested",w->visibility.portals_tested);set_num(ctx,o,"bspNodesVisited",w->visibility.bsp_nodes_visited);
    set_num(ctx,o,"cells",w->world.cell_count);set_num(ctx,o,"portals",w->world.portal_count);set_num(ctx,o,"surfaces",w->world.surface_count);
    set_num(ctx,o,"segments",w->world.bsp.segment_count);set_num(ctx,o,"width",w->width);set_num(ctx,o,"height",w->height);
    return o;
}
// P4 static batching data contract for the renderer/DevTools. Returns the
// current deterministic group/instance counters plus the packed layout the GPU
// owner must consume; no submission happens here.
static JSValue world_batch_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w) return JS_EXCEPTION;
    const R2DWorldBatchStats *batch=r2d_world_batch_stats(w);
    JSValue o=JS_NewObject(ctx);
    set_num(ctx,o,"groups",batch?batch->groups:0);
    set_num(ctx,o,"instances",batch?batch->instances:0);
    set_num(ctx,o,"savedBinds",batch?batch->saved_binds:0);
    set_num(ctx,o,"surfaces",batch?batch->surfaces:0);
    set_num(ctx,o,"actors",batch?batch->actors:0);
    set_num(ctx,o,"skies",batch?batch->skies:0);
    set_num(ctx,o,"overflow",batch?batch->overflow:0);
    set_num(ctx,o,"instanceBytes",R2D_WORLD_BATCH_INSTANCE_BYTES);
    set_num(ctx,o,"groupBytes",(double)sizeof(R2DWorldBatchGroup));
    set_num(ctx,o,"instanceCapacity",w->batch_instance_capacity);
    set_num(ctx,o,"groupCapacity",w->batch_group_capacity);
    set_num(ctx,o,"gpuBatched",w->gpu_batch_draws>0?1:0);
    set_num(ctx,o,"gpuDraws",w->gpu_batch_draws);
    set_num(ctx,o,"gpuInstances",w->gpu_batch_instances);
    set_num(ctx,o,"gpuLogicalDraws",w->gpu_batch_logical);
    set_num(ctx,o,"gpuSavedDraws",w->gpu_batch_saved);
    set_num(ctx,o,"gpuEnabled",w->batch_gpu?1:0);
    JS_SetPropertyStr(ctx,o,"layout",JS_NewString(ctx,
        "std430: instance=8*u32(surface,span,material,flags,tint,aux,light,atlas), 32B; group=6*u32(material,blend,lightPolicy,atlas,first,count); "
        "instances sorted by group key; group.first/count index instances"));
    JS_SetPropertyStr(ctx,o,"contract",JS_NewString(ctx,
        "GPU owner: upload instances as one SSBO, groups as a second SSBO; "
        "draw groups in ascending group index, instance index = group.first + i. "
        "No draw submission or buffer allocation is performed by this data path."));
    return o;
}

static JSValue world_frame(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float dims[2];if(!w||!world_numbers(ctx,argc,argv,2,dims)) return JS_EXCEPTION;
    if(dims[0]!=floorf(dims[0])||dims[1]!=floorf(dims[1])||dims[0]<1||dims[1]<1||dims[0]>1024||dims[1]>1024)
        return JS_ThrowRangeError(ctx,"World.frame: целый размер 1..1024");
    int width=(int)dims[0],height=(int)dims[1];
    double ortho_height=0;
    if(argc>4 && JS_ToFloat64(ctx,&ortho_height,argv[4])<0) return JS_EXCEPTION;
    if(!isfinite(ortho_height)||ortho_height<0||ortho_height>1e6)
        return JS_ThrowRangeError(ctx,"World.frame: orthoHeight 0..1000000");
    const uint8_t **images=NULL;JSValue *handles=NULL;int *sizes=NULL;float *positions=NULL,*position_copy=NULL;size_t nf=0;JSValue ab=JS_UNDEFINED;
    uint32_t count=0;
    if(argc>2) {
        if(argc<4||!JS_IsArray(argv[2])||JS_GetTypedArrayType(argv[3])!=JS_TYPED_ARRAY_FLOAT32)
            return JS_ThrowTypeError(ctx,"World.frame: handles[] и Float32Array stride 5");
        JSValue length=JS_GetPropertyStr(ctx,argv[2],"length");int ok=JS_ToUint32(ctx,&count,length);JS_FreeValue(ctx,length);
        if(ok<0) return JS_EXCEPTION;
        if(count>4096) return JS_ThrowRangeError(ctx,"World.frame: максимум 4096 моделей");
        ab=f32_view(ctx,argv[3],&positions,&nf);if(JS_IsException(ab)) return ab;
        if(nf!=(size_t)count*5) {JS_FreeValue(ctx,ab);return JS_ThrowRangeError(ctx,"World.frame: неверная длина transforms");}
        for(size_t i=0;i<nf;i++) if(!isfinite(positions[i])||fabsf(positions[i])>1e6f || (i%5>=3&&positions[i]<=0)) {
            JS_FreeValue(ctx,ab);return JS_ThrowRangeError(ctx,"World.frame: конечные позиции, положительные размеры");
        }
        // Model getters can detach or mutate the caller's ArrayBuffer.
        position_copy=malloc((nf?nf:1)*sizeof(float));
        if(!position_copy) {JS_ThrowOutOfMemory(ctx);goto fail;}
        if(nf) memcpy(position_copy,positions,nf*sizeof(float));
        positions=position_copy;
        images=calloc(count?count:1,sizeof *images);sizes=calloc(count?count:1,sizeof *sizes);
        handles=malloc((count?count:1)*sizeof *handles);
        if(handles) for(uint32_t i=0;i<count;i++) handles[i]=JS_UNDEFINED;
        if(!images||!sizes||!handles) {JS_ThrowOutOfMemory(ctx);goto fail;}
        // Resolve all getters before borrowing CPU pixels: a getter may dispose
        // an earlier model. Keep references alive through the native pass.
        for(uint32_t i=0;i<count;i++) {
            handles[i]=JS_GetPropertyUint32(ctx,argv[2],i);
            if(JS_IsException(handles[i])) goto fail;
        }
    }
    if(w->disposed) {JS_ThrowTypeError(ctx,"World.frame: ресурс освобождён во время чтения models");goto fail;}
    if(width!=w->width||height!=w->height) {
        size_t n=(size_t)width*height;
        uint8_t *rgba=malloc(n*4);float *depth=malloc(n*sizeof(float));
        if(!rgba||!depth) {free(rgba);free(depth);JS_ThrowOutOfMemory(ctx);goto fail;}
        int texture=r2d_texture_create_rgba(w->renderer,NULL,width,height);
        int sprite=texture<0?-1:r2d_sprite_create(w->renderer,texture,0,0,(float)width,(float)height);
        if(sprite<0) {if(texture>=0)r2d_texture_free(w->renderer,texture);free(rgba);free(depth);JS_ThrowInternalError(ctx,"World.frame: текстура не создана");goto fail;}
        if(w->texture>=0)r2d_texture_free(w->renderer,w->texture);free(w->rgba);free(w->depth);
        free(w->owners);w->owners=NULL;w->rgba=rgba;w->depth=depth;w->texture=texture;w->sprite=sprite;w->width=width;w->height=height;
    }
    ensure_view();
    if(!isfinite(g_view.x)||!isfinite(g_view.y)||!isfinite(g_view.eye)||
       !isfinite(g_view.cos_yaw)||!isfinite(g_view.sin_yaw)||
       !isfinite(g_view.cos_pitch)||!isfinite(g_view.sin_pitch)||
       !isfinite(g_view.focal)||g_view.focal<=0) {
        JS_ThrowRangeError(ctx,"World.frame: некорректная камера");goto fail;
    }
    if(w->world.cell_count&&!r2d_world_visibility(&w->world,&g_view,(float)ortho_height,&w->visibility)){
        JS_ThrowOutOfMemory(ctx);goto fail;
    }
    for(uint32_t i=0;i<count;i++) {
        const float *p=positions+i*5;
        bool visible=r2d_world_sprite_visible(&g_view,width,height,p[0],p[1],p[2],p[3],p[4],(float)ortho_height);
        if(w->world.cell_count){int span=r2d_world_span_at(&w->world,p[0],p[1],p[2]+p[4]*.5f);visible=visible&&span>=0&&w->visibility.span_seen[span];}
        const uint8_t *pixels=r2d_rotsprite_pixels(ctx,handles[i],&sizes[i],visible);
        // Validate every handle, including culled ones. No JS executes after borrowing.
        if(!pixels) goto fail;
        images[i]=visible?pixels:NULL;
    }
    if(w->world.lighting.enabled&&!r2d_world_light_rebuild(&w->world)){JS_ThrowOutOfMemory(ctx);goto fail;}
    r2d_world_frame_visible(&w->world,&g_view,width,height,w->rgba,w->depth,(float)ortho_height,w->world.cell_count?&w->visibility:NULL);
    for(uint32_t i=0;i<count;i++) {
        const float *p=positions+i*5;
        r2d_world_stamp_lit(&w->world,&g_view,width,height,w->rgba,w->depth,images[i],sizes[i],p[0],p[1],p[2],p[3],p[4],(float)ortho_height);
    }
    if(!r2d_texture_upload_region(w->renderer,w->texture,0,0,width,height,w->rgba,width*4)) {
        JS_ThrowInternalError(ctx,"World.frame: не удалось обновить текстуру");goto fail;
    }
    for(uint32_t i=0;handles&&i<count;i++) JS_FreeValue(ctx,handles[i]);
    free(handles);free(images);free(sizes);free(position_copy);JS_FreeValue(ctx,ab);return JS_NewInt32(ctx,w->sprite);
fail:
    for(uint32_t i=0;handles&&i<count;i++) JS_FreeValue(ctx,handles[i]);
    free(handles);free(images);free(sizes);free(position_copy);JS_FreeValue(ctx,ab);return JS_EXCEPTION;
}
static JSValue world_cell_query(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[2];if(!w||!world_numbers(ctx,argc,argv,2,p))return JS_EXCEPTION;
    int i=r2d_world_cell_at(&w->world,p[0],p[1]);return i<0?JS_NULL:JS_NewInt32(ctx,i);
}
static JSValue world_span_query(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[3];if(!w||!world_numbers(ctx,argc,argv,3,p))return JS_EXCEPTION;
    int i=r2d_world_span_at(&w->world,p[0],p[1],p[2]);return i<0?JS_NULL:JS_NewInt32(ctx,i);
}
static JSValue world_portal_closed(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);int index;
    if(!w)return JS_EXCEPTION;
    if(!world_token(ctx,argc,argv,&index))return JS_EXCEPTION;
    if(argc<2)return JS_ThrowTypeError(ctx,"Re2D World: portalClosed(index, boolean)");
    if(!JS_IsBool(argv[1]))return JS_ThrowTypeError(ctx,"Re2D World: closed must be boolean");
    if(!r2d_world_portal_set_closed(&w->world,index,JS_ToBool(ctx,argv[1])))return JS_ThrowRangeError(ctx,"Re2D World: missing portal %d",index);
    return JS_UNDEFINED;
}
static JSValue world_portal_sky(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[2];if(!w||!world_numbers(ctx,argc,argv,2,p))return JS_EXCEPTION;
    if(!r2d_world_portal_set_sky(&w->world,(int)p[0],p[1]!=0.0f))return JS_ThrowRangeError(ctx,"Re2D World: invalid portal");
    return JS_UNDEFINED;
}
static JSValue world_portal_mirror(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[2];if(!w||!world_numbers(ctx,argc,argv,2,p))return JS_EXCEPTION;
    if(!r2d_world_portal_set_mirror(&w->world,(int)p[0],p[1]!=0.0f))return JS_ThrowRangeError(ctx,"Re2D World: invalid portal");
    return JS_UNDEFINED;
}
static JSValue world_portal_mirror_get(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    return JS_NewBool(ctx,r2d_world_portal_mirror(&w->world,(int)p[0]));
}
static JSValue world_portal_sky_get(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    return JS_NewBool(ctx,r2d_world_portal_sky(&w->world,(int)p[0]));
}
static JSValue world_surface_query(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);int index;if(!w)return JS_EXCEPTION;
    if(argc<1||JS_ToInt32(ctx,&index,argv[0])<0)return JS_ThrowTypeError(ctx,"Re2D World: surface(index)");
    const R2DWorldSurface *surface=r2d_world_surface(&w->world,index);if(!surface)return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"kind",surface->kind);set_num(ctx,o,"primitive",surface->primitive);set_num(ctx,o,"cell",surface->cell);set_num(ctx,o,"span",surface->span);return o;
}
static JSValue world_lighting_config(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[6];if(!w||!world_numbers(ctx,argc,argv,6,p))return JS_EXCEPTION;
    R2DWorldLighting l={true,p[0]!=0,p[1]!=0,p[2]!=0,p[3],p[4]};l.enabled=p[5]!=0;
    if(!r2d_world_set_lighting(&w->world,&l))return JS_ThrowRangeError(ctx,"Re2D World: invalid lighting configuration");return JS_UNDEFINED;
}
static JSValue world_span_height(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[3];if(!w||!world_numbers(ctx,argc,argv,3,p))return JS_EXCEPTION;
    if(p[0]!=floorf(p[0])||!r2d_world_span_set_heights(&w->world,(int)p[0],p[1],p[2]))return JS_ThrowRangeError(ctx,"Re2D World: invalid or overlapping moving span");return JS_UNDEFINED;
}
static JSValue world_span_light(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[10];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    if(p[0]!=floorf(p[0])||p[0]<0||p[0]>=w->world.span_count)return JS_ThrowRangeError(ctx,"Re2D World: missing span");
    int span=(int)p[0];
    if(argc>1){if(!world_numbers(ctx,argc,argv,10,p))return JS_EXCEPTION;R2DWorldSpanLight l={p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8],p[9]};
        if(!r2d_world_set_span_light(&w->world,span,&l))return JS_ThrowRangeError(ctx,"Re2D World: invalid span lighting/fog");return JS_UNDEFINED;}
    R2DWorldSpanLight l=w->world.span_lights?w->world.span_lights[span]:(R2DWorldSpanLight){1,1,1,1,0,0,0,0,0};
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"level",l.level);set_num(ctx,o,"r",l.r);set_num(ctx,o,"g",l.g);set_num(ctx,o,"b",l.b);
    set_num(ctx,o,"fogDensity",l.fog_density);set_num(ctx,o,"fogStart",l.fog_start);set_num(ctx,o,"fogR",l.fog_r);set_num(ctx,o,"fogG",l.fog_g);set_num(ctx,o,"fogB",l.fog_b);return o;
}
static bool world_light_desc(JSContext *ctx,int argc,JSValueConst *argv,R2DWorldLight *l)
{
    float p[9];if(!world_numbers(ctx,argc,argv,9,p))return false;
    *l=(R2DWorldLight){.x=p[0],.y=p[1],.h=p[2],.radius=p[3],.intensity=p[4],.r=p[5],.g=p[6],.b=p[7],.shadow=p[8]!=0};return true;
}
static JSValue world_light_new(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);R2DWorldLight l;if(!w||!world_light_desc(ctx,argc,argv,&l))return JS_EXCEPTION;
    int id=r2d_world_light_create(&w->world,&l);if(id<0)return JS_ThrowRangeError(ctx,"Re2D World: invalid light or light budget exhausted");return JS_NewInt32(ctx,id);
}
static JSValue world_light_set(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);int id;R2DWorldLight l;
    if(!w||!world_token(ctx,argc,argv,&id)||!world_light_desc(ctx,argc-1,argv+1,&l))return JS_EXCEPTION;
    if(!r2d_world_light_update(&w->world,(int)id,&l))return JS_ThrowRangeError(ctx,"Re2D World: stale light or invalid configuration");return JS_UNDEFINED;
}
static JSValue world_light_delete(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);int id;if(!w||!world_token(ctx,argc,argv,&id))return JS_EXCEPTION;
    if(!r2d_world_light_remove(&w->world,id))return JS_ThrowRangeError(ctx,"Re2D World: stale light");return JS_UNDEFINED;
}
static JSValue world_light_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);int token;if(!w||!world_token(ctx,argc,argv,&token))return JS_EXCEPTION;
    int slot=token%R2D_WORLD_MAX_LIGHTS;const R2DWorldLight *l=&w->world.lights[slot];
    if(!l->active||l->generation!=(unsigned)(token/R2D_WORLD_MAX_LIGHTS))return JS_ThrowRangeError(ctx,"Re2D World: stale light");
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"x",l->x);set_num(ctx,o,"y",l->y);set_num(ctx,o,"h",l->h);set_num(ctx,o,"radius",l->radius);set_num(ctx,o,"intensity",l->intensity);
    set_num(ctx,o,"r",l->r);set_num(ctx,o,"g",l->g);set_num(ctx,o,"b",l->b);set_num(ctx,o,"remaining",l->remaining);set_num(ctx,o,"flickerMin",l->flicker_min);set_num(ctx,o,"flickerMax",l->flicker_max);set_num(ctx,o,"flickerRate",l->flicker_rate);set_num(ctx,o,"flickerSeed",l->flicker_seed);JS_SetPropertyStr(ctx,o,"shadow",JS_NewBool(ctx,l->shadow));return o;
}

static R2DWorldAudioSource *world_audio_source(JSContext *ctx,WorldHandle *w,int token,int *channel) {
    int c=token%R2D_AUDIO_CHANNELS;unsigned gen=(unsigned)token/R2D_AUDIO_CHANNELS;
    if(token<0||!w->audio||!w->sources[c].active||w->sources[c].generation!=gen||w->audio->channel_generation[c]!=gen){JS_ThrowRangeError(ctx,"Re2D World audio: stale source");return NULL;}
    *channel=c;return &w->sources[c];
}
static JSValue world_audio_add(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    WorldHandle *w=world_get(ctx,self);float p[8];if(!w||!world_numbers(ctx,argc,argv,8,p))return JS_EXCEPTION;
    if(!w->audio){R2DScript *script=JS_GetContextOpaque(ctx);if(script)w->audio=script->audio;}
    int c=(int)p[0];if(c<0||c>=R2D_AUDIO_CHANNELS||p[0]!=c||p[4]<=0||p[5]<=0||p[6]<0||p[6]>1||!w->audio||!r2d_audio_channel_playing(w->audio,c))return JS_ThrowRangeError(ctx,"Re2D World audio: invalid channel/position/range/reference/volume");
    if(!r2d_audio_world_channel(w->audio,c,true,p[7]!=0,0,0,-1,0,22000))return JS_ThrowTypeError(ctx,"Re2D World audio: requested HRTF/audio backend unavailable");
    w->sources[c]=(R2DWorldAudioSource){.active=true,.hrtf=p[7]!=0,.generation=w->audio->channel_generation[c],.x=p[1],.y=p[2],.h=p[3],.range=p[4],.reference=p[5],.volume=p[6],.cutoff=22000};
    return JS_NewInt32(ctx,(int)w->sources[c].generation*R2D_AUDIO_CHANNELS+c);
}
static JSValue world_audio_update(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    WorldHandle *w=world_get(ctx,self);int token,c;float p[6];if(!w||!world_token(ctx,argc,argv,&token)||!world_numbers(ctx,argc-1,argv+1,6,p))return JS_EXCEPTION;
    R2DWorldAudioSource *s=world_audio_source(ctx,w,token,&c);if(!s)return JS_EXCEPTION;
    if(p[3]<=0||p[4]<=0||p[5]<0||p[5]>1)return JS_ThrowRangeError(ctx,"Re2D World audio: invalid source parameters");
    s->x=p[0];s->y=p[1];s->h=p[2];s->range=p[3];s->reference=p[4];s->volume=p[5];return JS_UNDEFINED;
}
static JSValue world_audio_priority(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    WorldHandle *w=world_get(ctx,self);int token,c;float p[1];if(!w||!world_token(ctx,argc,argv,&token)||!world_numbers(ctx,argc-1,argv+1,1,p))return JS_EXCEPTION;
    R2DWorldAudioSource *s=world_audio_source(ctx,w,token,&c);if(!s)return JS_EXCEPTION;
    s->priority=(int)p[0];return JS_UNDEFINED;
}
static JSValue world_audio_state(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    JSValue o=JS_NewObject(ctx);JS_SetPropertyStr(ctx,o,"ready",JS_NewBool(ctx,w->audio!=NULL));
    set_num(ctx,o,"active",w->audio_active);set_num(ctx,o,"virtual",w->audio_virtual);set_num(ctx,o,"budget",w->audio_voice_budget);
    return o;
}
static JSValue world_audio_budget(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    return JS_NewInt32(ctx,r2d_world_audio_budget(w,(int)p[0]));
}
static JSValue world_audio_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    WorldHandle *w=world_get(ctx,self);int token,c;if(!w||!world_token(ctx,argc,argv,&token))return JS_EXCEPTION;
    R2DWorldAudioSource *s=world_audio_source(ctx,w,token,&c);if(!s)return JS_EXCEPTION;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"channel",c);set_num(ctx,o,"x",s->x);set_num(ctx,o,"y",s->y);set_num(ctx,o,"h",s->h);set_num(ctx,o,"distance",s->distance);set_num(ctx,o,"gain",s->gain);set_num(ctx,o,"currentGain",s->current_gain);set_num(ctx,o,"cutoff",s->cutoff);set_num(ctx,o,"priority",s->priority);set_num(ctx,o,"virtualized",s->virtualized?1:0);
    JS_SetPropertyStr(ctx,o,"occluded",JS_NewBool(ctx,s->occluded));JS_SetPropertyStr(ctx,o,"hrtf",JS_NewBool(ctx,s->hrtf));JS_SetPropertyStr(ctx,o,"playing",JS_NewBool(ctx,r2d_audio_channel_playing(w->audio,c)));return o;
}
static JSValue world_audio_remove(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    WorldHandle *w=world_get(ctx,self);int token,c;if(!w||!world_token(ctx,argc,argv,&token))return JS_EXCEPTION;
    R2DWorldAudioSource *s=world_audio_source(ctx,w,token,&c);if(!s)return JS_EXCEPTION;
    r2d_audio_stop_channel(w->audio,c,0);r2d_audio_world_channel(w->audio,c,false,false,0,0,-1,0,22000);s->active=false;return JS_UNDEFINED;
}
static void world_mark(JSRuntime *rt,JSValueConst value,JS_MarkFunc *mark_func)
{
    WorldHandle *w=JS_GetOpaque(value,world_class);if(!w)return;
    for(int i=0;i<w->actor_count;i++)JS_MarkValue(rt,w->actors[i],mark_func);
    for(int i=0;i<w->atlas_count;i++)JS_MarkValue(rt,w->atlas_actors[i].node,mark_func);
    for(int i=0;i<w->hit_count;i++)JS_MarkValue(rt,w->hit_entries[i].node,mark_func);
    for(int i=0;i<w->frame_count&&w->rendering;i++)JS_MarkValue(rt,w->frame_handles[i],mark_func);
}
static JSValue world_actor_add(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<1)return JS_ThrowTypeError(ctx,"Re2D World: actorAdd(node)");
    return r2d_world_actor_register(ctx,w,argv[0])?JS_UNDEFINED:JS_EXCEPTION;
}
static JSValue world_actor_remove(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<1)return JS_ThrowTypeError(ctx,"Re2D World: actorRemove(node)");
    return r2d_world_actor_unregister(ctx,w,argv[0])?JS_UNDEFINED:JS_EXCEPTION;
}
static JSValue trace_result_object(JSContext *ctx,const R2DWorldTraceResult *h,WorldHandle *w)
{
    JSValue o=JS_NewObject(ctx);
    set_num(ctx,o,"type",h->type);set_num(ctx,o,"fraction",h->fraction);
    set_num(ctx,o,"x",h->x);set_num(ctx,o,"y",h->y);set_num(ctx,o,"h",h->h);
    set_num(ctx,o,"surface",h->surface);set_num(ctx,o,"span",h->span);
    set_num(ctx,o,"proxy",h->proxy);set_num(ctx,o,"node",h->node);
    set_num(ctx,o,"normalX",h->nx);set_num(ctx,o,"normalY",h->ny);
    if(h->type==R2D_WORLD_TRACE_SPRITE&&w&&h->node>=0&&h->node<w->hit_count){
        int zone=-1;float multiplier=1;r2d_world_hit_zone_info(&w->hit_entries[h->node],h->h,&zone,&multiplier);
        set_num(ctx,o,"zone",zone);set_num(ctx,o,"zoneMultiplier",multiplier);
    }else{set_num(ctx,o,"zone",-1);set_num(ctx,o,"zoneMultiplier",1);}
    return o;
}
static JSValue world_hit_add(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<5)return JS_ThrowTypeError(ctx,"Re2D World: hitAdd(node,radius,bottom,top,category)");
    float p[4];if(!world_numbers(ctx,argc-1,argv+1,4,p))return JS_EXCEPTION;
    return r2d_world_hit_register(ctx,w,argv[0],p[0],p[1],p[2],(int)p[3])?JS_UNDEFINED:JS_EXCEPTION;
}
static JSValue world_hit_zones(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<2||JS_GetTypedArrayType(argv[1])!=JS_TYPED_ARRAY_FLOAT32)
        return JS_ThrowTypeError(ctx,"Re2D World: hitZones(node, Float32Array)");
    float *values=NULL;size_t count=0;JSValue ab=f32_view(ctx,argv[1],&values,&count);
    if(JS_IsException(ab))return JS_EXCEPTION;
    if(count%3!=0||count/3>R2D_WORLD_HIT_ZONES){JS_FreeValue(ctx,ab);return JS_ThrowRangeError(ctx,"Re2D World: hitZones needs up to 4 (from,to,multiplier) triples");}
    R2DWorldHitZone zones[R2D_WORLD_HIT_ZONES];
    for(size_t i=0;i<count/3;i++){zones[i].from=values[i*3];zones[i].to=values[i*3+1];zones[i].multiplier=values[i*3+2];}
    bool ok=r2d_world_hit_zones(w,argv[0],zones,(int)(count/3));
    JS_FreeValue(ctx,ab);
    return ok?JS_UNDEFINED:JS_ThrowRangeError(ctx,"Re2D World: hitZones needs a registered node with valid bands");
}
static JSValue world_hit_remove(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<1)return JS_ThrowTypeError(ctx,"Re2D World: hitRemove(node)");
    return r2d_world_hit_unregister(ctx,w,argv[0])?JS_UNDEFINED:JS_EXCEPTION;
}
static JSValue world_trace(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[8];if(!w||!world_numbers(ctx,argc,argv,8,p))return JS_EXCEPTION;
    float from[3]={p[0],p[1],p[2]},to[3]={p[3],p[4],p[5]};
    R2DWorldTraceResult hit;
    int found=r2d_world_trace_query(ctx,w,from,to,(int)p[6],(int)p[7],&hit);
    if(found<0)return JS_EXCEPTION;
    if(!found)return JS_NULL;
    return trace_result_object(ctx,&hit,w);
}
static JSValue world_trace_all(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[8];if(!w||!world_numbers(ctx,argc,argv,8,p))return JS_EXCEPTION;
    float from[3]={p[0],p[1],p[2]},to[3]={p[3],p[4],p[5]};
    int count=r2d_world_trace_query_all(ctx,w,from,to,(int)p[6],(int)p[7],NULL,0);
    if(count<0)return JS_EXCEPTION;
    JSValue array=JS_NewArray(ctx);if(JS_IsException(array))return array;
    if(count==0)return array;
    R2DWorldTraceResult *hits=malloc((size_t)count*sizeof *hits);
    if(!hits)return JS_ThrowOutOfMemory(ctx);
    int written=r2d_world_trace_query_all(ctx,w,from,to,(int)p[6],(int)p[7],hits,count);
    if(written<0){free(hits);return JS_EXCEPTION;}
    for(int i=0;i<written;i++)JS_SetPropertyUint32(ctx,array,(uint32_t)i,trace_result_object(ctx,&hits[i],w));
    free(hits);return array;
}
static JSValue world_portal_open(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[2];if(!w||!world_numbers(ctx,argc,argv,2,p))return JS_EXCEPTION;
    if(!r2d_world_portal_set_open(&w->world,(int)p[0],p[1]))return JS_ThrowRangeError(ctx,"Re2D World: invalid portal or fraction");
    return JS_UNDEFINED;
}
static JSValue world_portal_fraction(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    float fraction=r2d_world_portal_open_fraction(&w->world,(int)p[0]);
    return fraction<0?JS_NULL:JS_NewFloat64(ctx,fraction);
}
// Particle prototype layout (Float32Array, 25 values): x,y,h,vx,vy,vh,life,
// size,endSize,gravity,drag,r,g,b,alpha,endAlpha,spread,speed,dirX,dirY,dirH,
// frame,frames,blend,mode.
static bool particle_proto(JSContext *ctx,JSValueConst arr,R2DWorldParticle *p,float *spread,float *speed,float *dx,float *dy,float *dh)
{
    float *f=NULL;size_t n=0;JSValue ab=f32_view(ctx,arr,&f,&n);
    if(JS_IsException(ab))return false;
    if(n<25){JS_FreeValue(ctx,ab);JS_ThrowTypeError(ctx,"Re2D World: particle prototype needs 25 floats");return false;}
    memset(p,0,sizeof *p);
    p->x=f[0];p->y=f[1];p->h=f[2];p->vx=f[3];p->vy=f[4];p->vh=f[5];
    p->max_life=f[6];p->life=f[6];
    p->size=f[7];p->start_size=f[7];p->end_size=f[8];
    p->gravity=f[9];p->drag=f[10];
    p->r=f[11];p->g=f[12];p->b=f[13];
    p->alpha=f[14];p->start_alpha=f[14];p->end_alpha=f[15];
    *spread=f[16];*speed=f[17];*dx=f[18];*dy=f[19];*dh=f[20];
    p->frame=(int)f[21];p->frames=(int)f[22];p->blend=(int)f[23];p->mode=(int)f[24];
    p->active=true;p->world_space=p->mode!=R2D_PARTICLE_SCREEN;
    bool ok=isfinite(p->max_life)&&p->max_life>0&&isfinite(*spread)&&*spread>=0&&isfinite(*speed)&&
        p->blend>=0&&p->blend<=2&&p->mode>=0&&p->mode<=3;
    JS_FreeValue(ctx,ab);
    if(!ok)JS_ThrowRangeError(ctx,"Re2D World: invalid particle prototype");
    return ok;
}
static JSValue trigger_tokens(JSContext *ctx,int count,const int *tokens);
static JSValue world_span_audio_zone(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<2)return JS_ThrowTypeError(ctx,"Re2D World: spanAudioZone(index,name)");
    float index;if(!world_numbers(ctx,1,argv,1,&index))return JS_EXCEPTION;
    const char *name=JS_ToCString(ctx,argv[1]);if(!name)return JS_EXCEPTION;
    bool ok=r2d_world_set_span_audio_zone(w,(int)index,name);
    JS_FreeCString(ctx,name);
    return ok?JS_UNDEFINED:JS_ThrowRangeError(ctx,"Re2D World: unknown audio zone (room|hall|cave|outside|metal|magic) or span");
}
static JSValue world_span_audio_zone_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    int preset=-1;const char *name=NULL;
    if(!r2d_world_span_audio_zone(w,(int)p[0],&preset,&name))return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"preset",preset);
    JS_SetPropertyStr(ctx,o,"name",JS_NewString(ctx,name?name:"room"));return o;
}
static JSValue world_audio_zone_at(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[3];if(!w||!world_numbers(ctx,argc,argv,3,p))return JS_EXCEPTION;
    int preset=-1,span=-1;const char *name=NULL;
    if(!r2d_world_audio_zone_at(w,p[0],p[1],p[2],&preset,&name,&span))return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"preset",preset);set_num(ctx,o,"span",span);
    JS_SetPropertyStr(ctx,o,"name",JS_NewString(ctx,name?name:"room"));return o;
}
static JSValue world_surface_terrain(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<2||!JS_IsString(argv[1]))return JS_ThrowTypeError(ctx,"Re2D World: surfaceTerrain(index,name)");
    float index;if(!world_numbers(ctx,1,argv,1,&index))return JS_EXCEPTION;
    const char *name=JS_ToCString(ctx,argv[1]);if(!name)return JS_EXCEPTION;
    int kind=-1;bool ok=r2d_world_terrain_from_name(name,&kind);
    JS_FreeCString(ctx,name);
    if(!ok)return JS_ThrowRangeError(ctx,"Re2D World: unknown terrain name");
    if(!r2d_world_set_surface_terrain(w,(int)index,kind))return JS_ThrowRangeError(ctx,"Re2D World: invalid surface");
    return JS_NewInt32(ctx,kind);
}
static JSValue world_surface_terrain_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    int kind=r2d_world_surface_terrain_kind(w,(int)p[0]);
    if(kind<0)return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"kind",kind);
    JS_SetPropertyStr(ctx,o,"name",JS_NewString(ctx,r2d_world_terrain_name(kind)));
    return o;
}
static JSValue world_surface_conveyor(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[5];if(!w||!world_numbers(ctx,argc,argv,5,p))return JS_EXCEPTION;
    if(!r2d_world_set_surface_conveyor(w,(int)p[0],p[1],p[2],p[3],p[4]!=0.0f))
        return JS_ThrowRangeError(ctx,"Re2D World: invalid conveyor");
    return JS_UNDEFINED;
}
static JSValue world_surface_conveyor_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    float out[3]={0,0,0};int affects=0;
    if(!r2d_world_surface_conveyor_info(w,(int)p[0],out,&affects))return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"vx",out[0]);set_num(ctx,o,"vy",out[1]);
    set_num(ctx,o,"accel",out[2]);set_num(ctx,o,"affectsProjectiles",affects);return o;
}
static JSValue world_terrain_at(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[3];if(!w||!world_numbers(ctx,argc,argv,3,p))return JS_EXCEPTION;
    int kind=-1,surface=-1;
    if(!r2d_world_terrain_at(w,p[0],p[1],p[2],&kind,&surface))return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"kind",kind);set_num(ctx,o,"surface",surface);
    JS_SetPropertyStr(ctx,o,"name",JS_NewString(ctx,r2d_world_terrain_name(kind)));
    const R2DWorldTerrain *t=r2d_world_terrain_preset(kind);
    if(t){set_num(ctx,o,"moveScale",t->move_scale);set_num(ctx,o,"frictionScale",t->friction_scale);
        set_num(ctx,o,"damagePerSecond",t->damage_per_second);}
    return o;
}
static JSValue world_conveyor_apply(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[4];if(!w||!world_numbers(ctx,argc,argv,4,p))return JS_EXCEPTION;
    float info[3];int affects=0;
    if(!r2d_world_surface_conveyor_info(w,(int)p[0],info,&affects))return JS_ThrowRangeError(ctx,"Re2D World: unknown surface conveyor");
    R2DWorldConveyor conveyor={.vx=info[0],.vy=info[1],.accel=info[2],.affects_projectiles=affects!=0};
    float vx=p[1],vy=p[2];if(!isfinite(p[3])||p[3]<=0)return JS_ThrowRangeError(ctx,"Re2D World: invalid conveyor tick");
    r2d_world_conveyor_apply(&conveyor,&vx,&vy,1.0f,p[3]);
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"vx",vx);set_num(ctx,o,"vy",vy);return o;
}
static JSValue world_conveyor_at_js(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[3];if(!w||!world_numbers(ctx,argc,argv,3,p))return JS_EXCEPTION;
    float out[3]={0,0,0};int affects=0;
    if(!r2d_world_conveyor_at(w,p[0],p[1],p[2],out,&affects))return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"vx",out[0]);set_num(ctx,o,"vy",out[1]);
    set_num(ctx,o,"accel",out[2]);set_num(ctx,o,"affectsProjectiles",affects);return o;
}
static int material_arg(WorldHandle *w,JSContext *ctx,JSValueConst value)
{
    if(JS_IsString(value)) {
        const char *name=JS_ToCString(ctx,value);if(!name)return -1;
        int index=r2d_world_material_find(&w->world,name);JS_FreeCString(ctx,name);return index;
    }
    int32_t index=-1;if(JS_ToInt32(ctx,&index,value)<0)return -1;return index;
}
static JSValue world_sky_anim(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[3];if(!w||!world_numbers(ctx,argc,argv,3,p))return JS_EXCEPTION;
    uint32_t tint=0xffffffu;
    if(argc>=4){uint32_t parsed=0;if(JS_ToUint32(ctx,&parsed,argv[3])<0)return JS_EXCEPTION;tint=parsed&0xffffffu;}
    if(!r2d_world_sky_anim(w,p[0],p[1],p[2],tint))return JS_ThrowRangeError(ctx,"Re2D World: invalid sky animation");
    return JS_UNDEFINED;
}
static JSValue world_sky_anim_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    float out[4];r2d_world_sky_anim_info(w,out);
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"active",out[0]);set_num(ctx,o,"yaw",out[1]);
    set_num(ctx,o,"phase",out[2]);set_num(ctx,o,"tinted",out[3]);return o;
}
static JSValue world_post_set(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[8];if(!w||!world_numbers(ctx,argc,argv,8,p))return JS_EXCEPTION;
    if(!r2d_world_post_set(w,(int)p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7]))return JS_ThrowRangeError(ctx,"Re2D World: invalid post effect");
    return JS_UNDEFINED;
}
static JSValue world_post_enable(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[2];if(!w||!world_numbers(ctx,argc,argv,2,p))return JS_EXCEPTION;
    if(!r2d_world_post_enable(w,(int)p[0],p[1]!=0.0f))return JS_ThrowRangeError(ctx,"Re2D World: invalid post effect");
    return JS_UNDEFINED;
}
static JSValue world_post_profile(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w||argc<1||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: postProfile(name)");
    const char *name=JS_ToCString(ctx,argv[0]);if(!name)return JS_EXCEPTION;
    bool ok=r2d_world_post_profile(w,name);JS_FreeCString(ctx,name);
    return ok?JS_UNDEFINED:JS_ThrowRangeError(ctx,"Re2D World: unknown post profile");
}
static JSValue world_post_eval(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    R2DPostUniforms u;
    if(!r2d_world_post_eval(w,&u))return JS_NULL;
    JSValue o=JS_NewObject(ctx);
    JSValue scale=JS_NewArray(ctx),add=JS_NewArray(ctx),tint=JS_NewArray(ctx);
    for(int i=0;i<3;i++){JS_SetPropertyUint32(ctx,scale,(uint32_t)i,JS_NewFloat64(ctx,u.color_scale[i]));
        JS_SetPropertyUint32(ctx,add,(uint32_t)i,JS_NewFloat64(ctx,u.color_add[i]));}
    for(int i=0;i<4;i++)JS_SetPropertyUint32(ctx,tint,(uint32_t)i,JS_NewFloat64(ctx,u.tint[i]));
    JS_SetPropertyStr(ctx,o,"colorScale",scale);JS_SetPropertyStr(ctx,o,"colorAdd",add);JS_SetPropertyStr(ctx,o,"tint",tint);
    set_num(ctx,o,"vignette",u.vignette);set_num(ctx,o,"flash",u.flash);set_num(ctx,o,"pixelSize",u.pixel_size);
    set_num(ctx,o,"chroma",u.chroma);set_num(ctx,o,"bloom",u.bloom);
    return o;
}
static JSValue world_post_reset(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    r2d_world_post_reset(w);return JS_UNDEFINED;
}
static JSValue world_post_step(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    if(w->post_ready)r2d_world_post_step_all(w,p[0]);
    return JS_UNDEFINED;
}
static JSValue world_polywall_add(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[3];if(!w||argc<5||!world_numbers(ctx,4,argv+1,4,p)||JS_GetTypedArrayType(argv[0])!=JS_TYPED_ARRAY_FLOAT32)return JS_ThrowTypeError(ctx,"Re2D World: polywall(Float32Array walls,pivotX,pivotY,angle,speed)");
    float *ids=NULL;size_t count=0;JSValue ab=f32_view(ctx,argv[0],&ids,&count);
    if(JS_IsException(ab))return JS_EXCEPTION;
    if(!count||count>64){JS_FreeValue(ctx,ab);return JS_ThrowRangeError(ctx,"Re2D World: polywall needs 1..64 walls");}
    int walls[64];for(size_t i=0;i<count;i++)walls[i]=(int)ids[i];
    int token=r2d_world_polywall_add(w,walls,(int)count,p[0],p[1],p[2],p[3]);
    JS_FreeValue(ctx,ab);
    if(token<0)return JS_ThrowRangeError(ctx,"Re2D World: invalid polywall group");
    return JS_NewInt32(ctx,token);
}
static JSValue world_polywall_speed(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[2];if(!w||!world_numbers(ctx,argc,argv,2,p))return JS_EXCEPTION;
    return r2d_world_polywall_set_speed(w,(int)p[0],p[1])?JS_UNDEFINED:JS_ThrowRangeError(ctx,"Re2D World: unknown polywall group");
}
static JSValue world_polywall_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    float angle=0,speed=0;int walls[64];
    if(!r2d_world_polywall_info(w,(int)p[0],&angle,&speed,walls))return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"angle",angle);set_num(ctx,o,"speed",speed);return o;
}
static JSValue world_polywall_remove(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    return r2d_world_polywall_remove(w,(int)p[0])?JS_UNDEFINED:JS_ThrowRangeError(ctx,"Re2D World: unknown polywall group");
}
static JSValue world_aim_assist(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[11];if(!w||!world_numbers(ctx,argc,argv,11,p))return JS_EXCEPTION;
    float from[3]={p[0],p[1],p[2]},dir[3]={p[3],p[4],p[5]};
    R2DWorldAimAssist assist;
    if(!r2d_world_aim_assist(ctx,w,from,dir,p[6],p[7],(int)p[8],&assist)) {
        JSValue exc=JS_GetException(ctx);
        if(!JS_IsNull(exc)&&!JS_IsUndefined(exc)){JS_Throw(ctx,exc);return JS_EXCEPTION;}
        return JS_NULL;
    }
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"x",assist.x);set_num(ctx,o,"y",assist.y);set_num(ctx,o,"z",assist.z);
    set_num(ctx,o,"node",assist.node);set_num(ctx,o,"angle",assist.angle);return o;
}
static JSValue world_particles_budget(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    r2d_world_particles_budget(w,(int)p[0]);return JS_UNDEFINED;
}
static JSValue world_material_index(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<1)return JS_ThrowTypeError(ctx,"Re2D World: materialIndex(name)");
    int index=material_arg(w,ctx,argv[0]);
    return index<0?JS_NULL:JS_NewInt32(ctx,index);
}
static JSValue world_material_anim_set(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<9)return JS_ThrowTypeError(ctx,"Re2D World: materialAnim(name,frames,fps,pingPong,seed,scrollU,scrollV,pulseHz,pulseAmount)");
    int index=material_arg(w,ctx,argv[0]);
    float p[8];if(!world_numbers(ctx,argc-1,argv+1,8,p))return JS_EXCEPTION;
    if(p[0]<1||p[0]>64||floorf(p[0])!=p[0])return JS_ThrowRangeError(ctx,"Re2D World: material frames 1..64");
    if(!r2d_world_material_anim_set(w,index,(int)p[0],p[1],p[2]!=0.0f,(uint32_t)p[3],p[4],p[5],p[6],p[7]))
        return JS_ThrowRangeError(ctx,"Re2D World: invalid material animation");
    return JS_UNDEFINED;
}
static JSValue world_material_anim_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w||argc<1)return JS_ThrowTypeError(ctx,"Re2D World: materialAnimInfo(name)");
    int index=material_arg(w,ctx,argv[0]);
    int frame=0;float emissive=1,u=0,v=0;
    if(!r2d_world_material_anim_info(w,index,&frame,&emissive,&u,&v))return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"frame",frame);set_num(ctx,o,"emissive",emissive);
    set_num(ctx,o,"uOffset",u);set_num(ctx,o,"vOffset",v);return o;
}
static JSValue world_material_anim_remove(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w||argc<1)return JS_ThrowTypeError(ctx,"Re2D World: materialAnimRemove(name)");
    int index=material_arg(w,ctx,argv[0]);
    return r2d_world_material_anim_clear(w,index)?JS_UNDEFINED:JS_EXCEPTION;
}
static JSValue world_save_hash(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    uint64_t hash=r2d_world_save_map_hash_runtime(w);
    char hex[32];snprintf(hex,sizeof hex,"%016llx",(unsigned long long)hash);
    return JS_NewString(ctx,hex);
}
static JSValue world_save_state(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    R2DWorldSaveState state={0};
    if(!r2d_world_state_capture(w,&state))return JS_ThrowInternalError(ctx,"Re2D World: state capture failed");
    char save_error[256]={0};
    if(!r2d_world_save_validate(&state,save_error,sizeof save_error)){
        char message[320];
        SDL_snprintf(message,sizeof message,"Re2D World: state not serializable: %s",save_error[0]?save_error:"invalid state");
        r2d_world_save_free(&state);
        return JS_ThrowRangeError(ctx,"%s",message);
    }
    int needed=r2d_world_save_write(&state,NULL,0);
    if(needed<0){r2d_world_save_free(&state);return JS_ThrowInternalError(ctx,"Re2D World: state serialization failed");}
    char *text=malloc((size_t)needed+1);
    if(!text){r2d_world_save_free(&state);return JS_ThrowOutOfMemory(ctx);}
    int written=r2d_world_save_write(&state,text,(size_t)needed+1);
    r2d_world_save_free(&state);
    if(written<0){free(text);return JS_ThrowInternalError(ctx,"Re2D World: state serialization failed");}
    JSValue result=JS_NewString(ctx,text);free(text);return result;
}
static JSValue world_load_state(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<1||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: loadStateJSON(text)");
    const char *text=JS_ToCString(ctx,argv[0]);if(!text)return JS_EXCEPTION;
    R2DWorldSaveState state={0};char error[256]={0};
    bool ok=r2d_world_save_read(text,&state,error,sizeof error);
    JS_FreeCString(ctx,text);
    if(!ok){JS_ThrowTypeError(ctx,"Re2D World: invalid save: %s",error[0]?error:"parse error");r2d_world_save_free(&state);return JS_EXCEPTION;}
    bool applied=r2d_world_state_apply(w,&state);
    r2d_world_save_free(&state);
    if(!applied)return JS_ThrowRangeError(ctx,"Re2D World: save state does not match current world/movers/triggers");
    return JS_TRUE;
}
static JSValue world_secret_create(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<7||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: secret(id,x,y,radius,bottom,top,once)");
    const char *id=JS_ToCString(ctx,argv[0]);if(!id)return JS_EXCEPTION;
    float p[5];bool ok=world_numbers(ctx,argc-1,argv+1,5,p);
    int token=-1;if(ok)token=r2d_world_secret_create(w,id,p[0],p[1],p[2],p[3],p[4],argc>6&&JS_ToBool(ctx,argv[6]));
    JS_FreeCString(ctx,id);
    if(!ok)return JS_EXCEPTION;
    if(token<=0)return JS_ThrowRangeError(ctx,"Re2D World: invalid secret");
    return JS_NewInt32(ctx,token);
}
static JSValue world_secret_restore(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[3];if(!w||!world_numbers(ctx,argc,argv,3,p))return JS_EXCEPTION;
    return r2d_world_secret_restore(w,(int)p[0],(int)p[1],(int)p[2])?JS_UNDEFINED:JS_ThrowRangeError(ctx,"Re2D World: unknown secret");
}
static JSValue world_breakable_restore(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[3];if(!w||!world_numbers(ctx,argc,argv,3,p))return JS_EXCEPTION;
    return r2d_world_breakable_restore(w,(int)p[0],(int)p[1],(int)p[2])?JS_UNDEFINED:JS_ThrowRangeError(ctx,"Re2D World: unknown breakable");
}
static JSValue world_secret_remove(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    return r2d_world_secret_remove(w,(int)p[0])?JS_UNDEFINED:JS_EXCEPTION;
}
static JSValue world_secret_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    int found=0,count=0;if(!r2d_world_secret_info(w,(int)p[0],&found,&count))return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"found",found);set_num(ctx,o,"foundCount",count);return o;
}
static JSValue world_secret_tick(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[4];if(!w||!world_numbers(ctx,argc,argv,4,p))return JS_EXCEPTION;
    int tokens[R2D_WORLD_SECRET_LIMIT];
    int count=r2d_world_secret_tick(w,p[0],p[1],p[2],p[3],tokens,R2D_WORLD_SECRET_LIMIT);
    return trigger_tokens(ctx,count,tokens);
}
static JSValue world_breakable_create(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w||argc<9||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: breakable(id,hp,variant,portal,x,y,radius,bottom,top)");
    const char *id=JS_ToCString(ctx,argv[0]);if(!id)return JS_EXCEPTION;
    float p[8];bool ok=world_numbers(ctx,argc-1,argv+1,8,p);
    int token=-1;
    if(ok)token=r2d_world_breakable_create(w,id,(int)p[0],(int)p[1],(int)p[2],p[3],p[4],p[5],p[6],p[7]);
    JS_FreeCString(ctx,id);
    if(!ok)return JS_EXCEPTION;
    if(token<=0)return JS_ThrowRangeError(ctx,"Re2D World: invalid breakable");
    return JS_NewInt32(ctx,token);
}
static JSValue world_breakable_remove(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    return r2d_world_breakable_remove(w,(int)p[0])?JS_UNDEFINED:JS_EXCEPTION;
}
static JSValue world_breakable_damage(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[2];if(!w||!world_numbers(ctx,argc,argv,2,p))return JS_EXCEPTION;
    int broke=r2d_world_breakable_damage(w,(int)p[0],(int)p[1]);
    if(broke<0)return JS_ThrowRangeError(ctx,"Re2D World: invalid breakable damage");
    return JS_NewInt32(ctx,broke);
}
static JSValue world_breakable_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    int hp=0,variant=0,portal=0,broken=0;
    if(!r2d_world_breakable_info(w,(int)p[0],&hp,&variant,&portal,&broken))return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"hp",hp);set_num(ctx,o,"variant",variant);
    set_num(ctx,o,"portal",portal);set_num(ctx,o,"broken",broken);return o;
}
static JSValue world_particles_burst(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<3)return JS_ThrowTypeError(ctx,"Re2D World: particlesBurst(prototype,count,seed)");
    R2DWorldParticle proto;float spread=0,speed=0,dx=0,dy=0,dh=0;
    if(!particle_proto(ctx,argv[0],&proto,&spread,&speed,&dx,&dy,&dh))return JS_EXCEPTION;
    int32_t count=0,seed=0;if(JS_ToInt32(ctx,&count,argv[1])<0||JS_ToInt32(ctx,&seed,argv[2])<0)return JS_EXCEPTION;
    if(count<0)return JS_ThrowRangeError(ctx,"Re2D World: particle count >= 0");
    if(!r2d_world_particles_ready(w)&&count>0)return JS_ThrowOutOfMemory(ctx);
    if(count>0)w->particles.seed=(uint32_t)seed;
    int spawned=r2d_world_particles_burst(w,&proto,count,spread,speed,dx,dy,dh);
    if(spawned<0)return JS_ThrowRangeError(ctx,"Re2D World: invalid particle emission");
    return JS_NewInt32(ctx,spawned);
}
static JSValue world_particles_continuous(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<4)return JS_ThrowTypeError(ctx,"Re2D World: particlesContinuous(prototype,rate,dt,seed)");
    R2DWorldParticle proto;float spread=0,speed=0,dx=0,dy=0,dh=0;
    if(!particle_proto(ctx,argv[0],&proto,&spread,&speed,&dx,&dy,&dh))return JS_EXCEPTION;
    double rate_d=0,dt_d=0;int32_t seed=0;
    if(JS_ToFloat64(ctx,&rate_d,argv[1])<0||JS_ToFloat64(ctx,&dt_d,argv[2])<0)return JS_EXCEPTION;
    if(!isfinite(rate_d)||!isfinite(dt_d)||rate_d<0||dt_d<0)return JS_ThrowRangeError(ctx,"Re2D World: particle rate/dt must be finite and >= 0");
    if(JS_ToInt32(ctx,&seed,argv[3])<0)return JS_EXCEPTION;
    const float rate=(float)rate_d,dt=(float)dt_d;
    if(!r2d_world_particles_ready(w))return JS_ThrowOutOfMemory(ctx);
    w->particles.seed=(uint32_t)seed;
    // Continuous emission uses its own accumulator and the same prototype.
    proto.vx=proto.vx+dx*speed;proto.vy=proto.vy+dy*speed;proto.vh=proto.vh+dh*speed;
    int spawned=r2d_world_particle_emit_continuous(&w->particles,&proto,dt,rate,spread,0,0,0,0,&w->particle_accumulator);
    if(spawned<0)return JS_ThrowRangeError(ctx,"Re2D World: invalid particle emission");
    return JS_NewInt32(ctx,spawned);
}
static JSValue world_particles_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    JSValue o=JS_NewObject(ctx);
    set_num(ctx,o,"alive",w->particle_ready?w->particles.count:0);
    set_num(ctx,o,"capacity",w->particle_ready?w->particles.capacity:0);
    set_num(ctx,o,"overflow",w->particle_ready?w->particles.overflow:0);
    set_num(ctx,o,"drawn",w->particles_drawn);
    return o;
}
static JSValue world_particles_clear(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(w->particle_ready)r2d_world_particle_clear(&w->particles);
    w->particle_accumulator=0;w->particles_drawn=0;
    return JS_UNDEFINED;
}

static VfxBinding *vfx_require(JSContext *ctx,WorldHandle *w)
{
    VfxBinding *binding=w?vfx_binding(w):NULL;
    if(!binding)JS_ThrowTypeError(ctx,"Re2D World: VFX manager unavailable");
    return binding;
}
static JSValue world_vfx_define(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);VfxBinding *binding=vfx_require(ctx,w);
    if(!binding)return JS_EXCEPTION;
    if(argc<2||!JS_IsString(argv[0])||!JS_IsString(argv[1]))
        return JS_ThrowTypeError(ctx,"Re2D World: vfxDefine(name,jsonText)");
    const char *name=JS_ToCString(ctx,argv[0]);if(!name)return JS_EXCEPTION;
    const char *text=JS_ToCString(ctx,argv[1]);if(!text){JS_FreeCString(ctx,name);return JS_EXCEPTION;}
    char error[256]={0};
    const bool ok=r2d_world_vfx_define(&binding->vfx,name,text,error,sizeof error);
    JS_FreeCString(ctx,text);JS_FreeCString(ctx,name);
    if(!ok)return JS_ThrowTypeError(ctx,"%s",error[0]?error:"invalid VFX bundle");
    return JS_TRUE;
}
static JSValue world_vfx_defined(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);VfxBinding *binding=vfx_require(ctx,w);
    if(!binding)return JS_EXCEPTION;
    if(argc<1||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: vfxDefined(name)");
    const char *name=JS_ToCString(ctx,argv[0]);if(!name)return JS_EXCEPTION;
    const bool defined=r2d_world_vfx_defined(&binding->vfx,name);
    JS_FreeCString(ctx,name);
    return JS_NewBool(ctx,defined);
}
static JSValue world_vfx_spawn(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);VfxBinding *binding=vfx_require(ctx,w);
    if(!binding)return JS_EXCEPTION;
    if(argc<1||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: vfxSpawn(name,x,y,h,dx,dy,dz,seed?)");
    const char *name=JS_ToCString(ctx,argv[0]);if(!name)return JS_EXCEPTION;
    float p[6]={0,0,0,0,0,0};
    int count=argc-1;if(count>6)count=6;
    bool numbers=true;
    if(count>0)numbers=world_numbers(ctx,count,argv+1,count,p);
    int32_t seed=0;
    if(numbers&&argc>7&&JS_ToInt32(ctx,&seed,argv[7])<0)numbers=false;
    if(!numbers){JS_FreeCString(ctx,name);return JS_EXCEPTION;}
    if(!r2d_world_particles_ready(w)){JS_FreeCString(ctx,name);return JS_ThrowOutOfMemory(ctx);}
    r2d_world_vfx_bind(&binding->vfx,&w->particles);
    R2DWorldVfxSpawn spawned;
    const int total=r2d_world_vfx_spawn(&binding->vfx,name,p[0],p[1],p[2],p[3],p[4],p[5],(uint32_t)seed,&spawned);
    JS_FreeCString(ctx,name);
    if(total<0)return JS_ThrowRangeError(ctx,"Re2D World: unknown VFX bundle or invalid spawn args");
    JSValue o=JS_NewObject(ctx);
    set_num(ctx,o,"particles",spawned.particles);set_num(ctx,o,"cards",spawned.cards);
    set_num(ctx,o,"trails",spawned.trails);set_num(ctx,o,"lights",spawned.lights);
    set_num(ctx,o,"decals",spawned.decals);set_num(ctx,o,"distortion",spawned.distortion);
    set_num(ctx,o,"shake",spawned.shake);set_num(ctx,o,"flashMs",spawned.flash_ms);
    set_num(ctx,o,"flashColor",(double)spawned.flash_color);
    JS_SetPropertyStr(ctx,o,"sound",JS_NewString(ctx,spawned.sound));
    return o;
}
static JSValue vfx_info_object(JSContext *ctx,const R2DWorldVfxInfo *info)
{
    JSValue o=JS_NewObject(ctx);
    set_num(ctx,o,"particlesAlive",info->particles_alive);
    set_num(ctx,o,"particleCapacity",info->particle_capacity);
    set_num(ctx,o,"particleOverflow",info->particle_overflow);
    set_num(ctx,o,"particlesSpawned",info->particles_spawned);
    set_num(ctx,o,"cards",info->cards);set_num(ctx,o,"cardsSpawned",info->cards_spawned);
    set_num(ctx,o,"trails",info->trails);set_num(ctx,o,"trailsSpawned",info->trails_spawned);
    set_num(ctx,o,"tempLights",info->temp_lights);set_num(ctx,o,"lightBudget",info->light_budget);
    set_num(ctx,o,"lightOverflow",info->light_overflow);
    set_num(ctx,o,"decals",info->decals);set_num(ctx,o,"decalsSpawned",info->decals_spawned);
    set_num(ctx,o,"distortionCards",info->distortion_cards);
    set_num(ctx,o,"fxBundles",info->bundles);set_num(ctx,o,"fxSpawns",info->fx_spawns);
    set_num(ctx,o,"emitters",info->emitters);
    return o;
}
static JSValue world_vfx_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);VfxBinding *binding=vfx_require(ctx,w);
    if(!binding)return JS_EXCEPTION;
    if(r2d_world_particles_ready(w))r2d_world_vfx_bind(&binding->vfx,&w->particles);
    R2DWorldVfxInfo info;r2d_world_vfx_info(&binding->vfx,&info);
    return vfx_info_object(ctx,&info);
}
static JSValue world_vfx_debug(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);VfxBinding *binding=vfx_require(ctx,w);
    if(!binding)return JS_EXCEPTION;
    if(r2d_world_particles_ready(w))r2d_world_vfx_bind(&binding->vfx,&w->particles);
    R2DWorldVfxInfo info;r2d_world_vfx_info(&binding->vfx,&info);
    JSValue o=vfx_info_object(ctx,&info);
    set_num(ctx,o,"particleBudget",w->particle_budget);
    JSValue names=JS_NewArray(ctx);
    int written=0;
    for(int i=0;i<R2D_WORLD_VFX_MAX_BUNDLES;i++)
        if(binding->vfx.bundles[i].used)
            JS_SetPropertyUint32(ctx,names,(uint32_t)written++,JS_NewString(ctx,binding->vfx.bundles[i].name));
    JS_SetPropertyStr(ctx,o,"bundles",names);
    return o;
}
static JSValue world_vfx_clear(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);VfxBinding *binding=vfx_require(ctx,w);
    if(!binding)return JS_EXCEPTION;
    r2d_world_vfx_clear(&binding->vfx);
    return JS_UNDEFINED;
}
static JSValue world_vfx_light_budget(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);VfxBinding *binding=vfx_require(ctx,w);
    if(!binding)return JS_EXCEPTION;
    if(argc>=1){float p[1];if(!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
        r2d_world_vfx_light_budget(&binding->vfx,(int)p[0]);}
    return JS_NewInt32(ctx,r2d_world_vfx_get_light_budget(&binding->vfx));
}
static JSValue world_nav_build(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[3];if(!w||!world_numbers(ctx,argc,argv,3,p))return JS_EXCEPTION;
    int nodes=0,edges=0;
    if(!r2d_world_nav_build_runtime(w,p[0],p[1],p[2],&nodes,&edges))
        return JS_ThrowRangeError(ctx,"Re2D World: nav build failed (radius/height/step or allocation)");
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"nodes",nodes);set_num(ctx,o,"edges",edges);return o;
}
static JSValue world_nav_nearest(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[2];if(!w||!world_numbers(ctx,argc,argv,2,p))return JS_EXCEPTION;
    int node=r2d_world_nav_nearest_runtime(w,p[0],p[1]);
    return node<0?JS_NULL:JS_NewInt32(ctx,node);
}
static JSValue world_nav_path_mask(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[4]={0,0,256,0};int count=argc<4?argc:4;
    if(!w||!world_numbers(ctx,count,argv,count,p))return JS_EXCEPTION;
    int from=(int)p[0],to=(int)p[1],capacity=(int)(p[2]<=0?256:p[2]),visits=(int)p[3];
    float *spans=NULL,*portals=NULL;size_t span_count=0,portal_count=0;JSValue ab1=JS_UNDEFINED,ab2=JS_UNDEFINED;
    if(argc>4&&!JS_IsUndefined(argv[4])&&!JS_IsNull(argv[4])){
        ab1=f32_view(ctx,argv[4],&spans,&span_count);if(JS_IsException(ab1))return JS_EXCEPTION;}
    if(argc>5&&!JS_IsUndefined(argv[5])&&!JS_IsNull(argv[5])){
        ab2=f32_view(ctx,argv[5],&portals,&portal_count);if(JS_IsException(ab2)){JS_FreeValue(ctx,ab1);return JS_EXCEPTION;}}
    int *blocked_spans=span_count?malloc(span_count*sizeof(int)):NULL;
    int *blocked_portals=portal_count?malloc(portal_count*sizeof(int)):NULL;
    int *path=malloc((size_t)capacity*sizeof *path);
    if(!path||(span_count&&!blocked_spans)||(portal_count&&!blocked_portals)){free(blocked_spans);free(blocked_portals);free(path);JS_FreeValue(ctx,ab1);JS_FreeValue(ctx,ab2);return JS_ThrowOutOfMemory(ctx);}
    for(size_t i=0;i<span_count;i++)blocked_spans[i]=(int)spans[i];
    for(size_t i=0;i<portal_count;i++)blocked_portals[i]=(int)portals[i];
    int n=r2d_world_nav_path_mask(w,from,to,path,capacity,visits,blocked_spans,(int)span_count,blocked_portals,(int)portal_count);
    free(blocked_spans);free(blocked_portals);JS_FreeValue(ctx,ab1);JS_FreeValue(ctx,ab2);
    if(n<0){free(path);return JS_NULL;}
    JSValue array=JS_NewArray(ctx);if(JS_IsException(array)){free(path);return array;}
    for(int i=0;i<n;i++)JS_SetPropertyUint32(ctx,array,(uint32_t)i,JS_NewInt32(ctx,path[i]));
    free(path);return array;
}
static JSValue world_nav_nodes(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(!w->nav_ready)return JS_NewArray(ctx);
    JSValue array=JS_NewArray(ctx);
    for(int i=0;i<w->nav_graph.node_count;i++){
        JSValue o=JS_NewObject(ctx);set_num(ctx,o,"x",w->nav_nodes[i].x);set_num(ctx,o,"y",w->nav_nodes[i].y);
        set_num(ctx,o,"span",w->nav_nodes[i].span);set_num(ctx,o,"radius",w->nav_nodes[i].radius);
        JS_SetPropertyUint32(ctx,array,(uint32_t)i,o);
    }
    return array;
}
static JSValue world_nav_path(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[4]={0,0,256,0};
    int count=argc<4?argc:4;
    if(!w||!world_numbers(ctx,count,argv,count,p))return JS_EXCEPTION;
    int from=(int)p[0],to=(int)p[1],capacity=(int)(p[2]<=0?256:p[2]),visits=(int)p[3];
    int *path=malloc((size_t)capacity*sizeof *path);if(!path)return JS_ThrowOutOfMemory(ctx);
    int n=r2d_world_nav_path_runtime(w,from,to,path,capacity,visits);
    if(n<0){free(path);return JS_NULL;}
    JSValue array=JS_NewArray(ctx);if(JS_IsException(array)){free(path);return array;}
    for(int i=0;i<n;i++)JS_SetPropertyUint32(ctx,array,(uint32_t)i,JS_NewInt32(ctx,path[i]));
    free(path);return array;
}
static JSValue world_automap_lines(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    uint8_t *states=NULL;int state_count=0;
    if(argc>=1&&JS_IsArray(argv[0])) {
        JSValue length=JS_GetPropertyStr(ctx,argv[0],"length");int converted=JS_ToInt32(ctx,&state_count,length);JS_FreeValue(ctx,length);
        if(converted<0)return JS_EXCEPTION;
        if(state_count>0) {
            states=malloc((size_t)state_count);
            if(!states)return JS_ThrowOutOfMemory(ctx);
            for(int i=0;i<state_count;i++) {
                JSValue v=JS_GetPropertyUint32(ctx,argv[0],(uint32_t)i);int32_t s=0;
                int valid=JS_ToInt32(ctx,&s,v);JS_FreeValue(ctx,v);
                if(valid<0){free(states);return JS_EXCEPTION;}
                states[i]=(uint8_t)(s<0||s>4?0:s);
            }
        }
    }
    int count=r2d_world_automap_lines(&w->world,states,NULL,0);
    if(count<0){free(states);return JS_ThrowRangeError(ctx,"Re2D World: automap extraction failed");}
    R2DWorldAutomapLine *lines=count?malloc((size_t)count*sizeof *lines):NULL;
    if(count&&!lines){free(states);return JS_ThrowOutOfMemory(ctx);}
    int written=r2d_world_automap_lines(&w->world,states,lines,count);
    free(states);
    if(written<0){free(lines);return JS_ThrowRangeError(ctx,"Re2D World: automap extraction failed");}
    JSValue array=JS_NewArray(ctx);if(JS_IsException(array)){free(lines);return array;}
    for(int i=0;i<written;i++) {
        JSValue o=JS_NewObject(ctx);
        set_num(ctx,o,"x1",lines[i].x1);set_num(ctx,o,"y1",lines[i].y1);
        set_num(ctx,o,"x2",lines[i].x2);set_num(ctx,o,"y2",lines[i].y2);
        set_num(ctx,o,"state",lines[i].state);set_num(ctx,o,"kind",lines[i].kind);set_num(ctx,o,"index",lines[i].index);
        JS_SetPropertyUint32(ctx,array,(uint32_t)i,o);
    }
    free(lines);return array;
}
static JSValue world_automap_project(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    float p[6];if(!world_numbers(ctx,argc,argv,6,p))return JS_EXCEPTION;
    R2DWorldAutomapView view={p[0],p[1],p[2],p[3]};
    float x=0,y=0;r2d_world_automap_project(&view,p[4],p[5],&x,&y);
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"x",x);set_num(ctx,o,"y",y);return o;
}
static void set_string_or_null(JSContext *ctx,JSValue o,const char *name,const char *value)
{
    JS_SetPropertyStr(ctx,o,name,value?JS_NewString(ctx,value):JS_NULL);
}
static JSValue world_metadata(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    const R2DWorldMetadata *m=&w->world.metadata;
    JSValue o=JS_NewObject(ctx);
    set_string_or_null(ctx,o,"id",m->id);set_string_or_null(ctx,o,"title",m->title);
    set_string_or_null(ctx,o,"author",m->author);set_string_or_null(ctx,o,"version",m->version);
    set_string_or_null(ctx,o,"music",m->music);set_string_or_null(ctx,o,"sky",m->sky);
    set_string_or_null(ctx,o,"nextMap",m->next_map);set_string_or_null(ctx,o,"secretExit",m->secret_exit);
    set_string_or_null(ctx,o,"environment",m->environment);
    JSValue fog=JS_NewObject(ctx);
    set_string_or_null(ctx,fog,"color",m->default_fog_color);
    set_num(ctx,fog,"density",m->default_fog_density);set_num(ctx,fog,"start",m->default_fog_start);
    JS_SetPropertyStr(ctx,o,"defaultFog",fog);
    set_num(ctx,o,"spawnCount",m->spawn_count);
    return o;
}
static JSValue spawn_object(JSContext *ctx,const R2DWorldSpawn *s)
{
    JSValue o=JS_NewObject(ctx);
    set_string_or_null(ctx,o,"id",s->id);
    set_num(ctx,o,"type",s->type);
    set_string_or_null(ctx,o,"typeName",r2d_world_spawn_type_name(s->type));
    set_string_or_null(ctx,o,"tag",s->tag);
    set_num(ctx,o,"x",s->x);set_num(ctx,o,"y",s->y);set_num(ctx,o,"h",s->h);set_num(ctx,o,"facing",s->facing);
    return o;
}
static JSValue world_spawns(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    const R2DWorldMetadata *m=&w->world.metadata;
    JSValue array=JS_NewArray(ctx);if(JS_IsException(array))return array;
    for(int i=0;i<m->spawn_count;i++)JS_SetPropertyUint32(ctx,array,(uint32_t)i,spawn_object(ctx,&m->spawns[i]));
    return array;
}
static JSValue world_spawn(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<1||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: spawn(id) requires a spawn id string");
    const char *id=JS_ToCString(ctx,argv[0]);if(!id)return JS_EXCEPTION;
    const R2DWorldMetadata *m=&w->world.metadata;JSValue result=JS_NULL;
    for(int i=0;i<m->spawn_count;i++)if(m->spawns[i].id&&!strcmp(m->spawns[i].id,id)){result=spawn_object(ctx,&m->spawns[i]);break;}
    JS_FreeCString(ctx,id);return result;
}
static JSValue world_find(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv,int kind)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<1||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: find(name) requires a semantic id string");
    const char *name=JS_ToCString(ctx,argv[0]);if(!name)return JS_EXCEPTION;
    int index=-1;
    if(kind==0)index=r2d_world_find_cell(&w->world,name);
    else if(kind==1)index=r2d_world_find_wall(&w->world,name);
    else if(kind==2)index=r2d_world_find_span(&w->world,name);
    else if(kind==3)index=r2d_world_find_portal(&w->world,name);
    else {
        int wall=r2d_world_find_wall(&w->world,name),span=r2d_world_find_span(&w->world,name);
        for(int i=0;i<w->world.surface_count&&index<0;i++){
            const R2DWorldSurface *surface=&w->world.surfaces[i];
            if(wall>=0&&surface->kind==R2D_WORLD_WALL&&surface->primitive==wall)index=i;
            if(span>=0&&surface->kind!=R2D_WORLD_WALL&&surface->primitive==span){if(surface->kind==R2D_WORLD_FLOOR)index=i;else if(index<0)index=i;}
        }
    }
    JS_FreeCString(ctx,name);
    return index<0?JS_NULL:JS_NewInt32(ctx,index);
}
static JSValue world_find_cell(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){return world_find(ctx,self,argc,argv,0);}
static JSValue world_find_wall(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){return world_find(ctx,self,argc,argv,1);}
static JSValue world_find_span(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){return world_find(ctx,self,argc,argv,2);}
static JSValue world_find_portal(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){return world_find(ctx,self,argc,argv,3);}
static JSValue world_find_surface(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){return world_find(ctx,self,argc,argv,4);}
static JSValue controller_state_object(JSContext *ctx,const R2DWorldControllerState *st)
{
    JSValue o=JS_NewObject(ctx);
    set_num(ctx,o,"x",st->x);set_num(ctx,o,"y",st->y);set_num(ctx,o,"feet",st->feet);
    set_num(ctx,o,"vx",st->vx);set_num(ctx,o,"vy",st->vy);set_num(ctx,o,"vz",st->vz);
    set_num(ctx,o,"span",st->span);set_num(ctx,o,"ceiling",st->ceiling);
    JS_SetPropertyStr(ctx,o,"grounded",JS_NewBool(ctx,st->grounded));
    return o;
}
static JSValue world_controller_create(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[12];if(!w||!world_numbers(ctx,argc,argv,12,p))return JS_EXCEPTION;
    R2DWorldControllerConfig cfg={p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8],p[9],p[10],p[11]};
    if(cfg.radius<=0||cfg.height<=0||cfg.step<0||cfg.slope_limit<0||cfg.slope_limit>89||cfg.gravity<0||cfg.jump_speed<0||cfg.max_ground<0||cfg.max_air<0||cfg.accel<0||cfg.friction<0||cfg.air_control<0)
        return JS_ThrowRangeError(ctx,"Re2D World: invalid controller config");
    int token=r2d_world_controller_create(w,&cfg);
    if(token<=0)return JS_ThrowRangeError(ctx,"Re2D World: controller budget exhausted");
    return JS_NewInt32(ctx,token);
}
static JSValue world_controller_remove(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    return r2d_world_controller_remove(w,(int)p[0])?JS_UNDEFINED:JS_EXCEPTION;
}
static JSValue world_controller_init(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[4];if(!w||!world_numbers(ctx,argc,argv,4,p))return JS_EXCEPTION;
    R2DWorldControllerState st;
    if(!r2d_world_controller_place(w,(int)p[0],p[1],p[2],p[3],&st))return JS_NULL;
    return controller_state_object(ctx,&st);
}
static JSValue world_controller_move(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[11];if(!w||!world_numbers(ctx,argc,argv,11,p))return JS_EXCEPTION;
    R2DWorldControllerState st={0};
    st.x=p[1];st.y=p[2];st.feet=p[3];st.vx=p[4];st.vy=p[5];st.vz=p[6];
    st.span=-1;st.ceiling=0;st.grounded=false;
    if(!r2d_world_controller_step_state(w,(int)p[0],&st,p[7],p[8],p[9]!=0.0f,p[10]))return JS_EXCEPTION;
    return controller_state_object(ctx,&st);
}
static JSValue world_mover_create(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    float p[8];if(!world_numbers(ctx,argc,argv,8,p))return JS_EXCEPTION;
    int token=r2d_world_mover_create(w,(int)p[0],(int)p[1],(int)p[2],p[3],p[4],p[5],p[6],p[7]!=0.0f);
    if(token<=0)return JS_ThrowRangeError(ctx,"Re2D World: invalid mover (type/span/portal/from/to/speed/wait/top)");
    return JS_NewInt32(ctx,token);
}
static JSValue world_mover_block(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[2];if(!w||!world_numbers(ctx,argc,argv,2,p))return JS_EXCEPTION;
    if(!r2d_world_mover_block(w,(int)p[0],p[1]!=0.0f))return JS_ThrowRangeError(ctx,"Re2D World: unknown mover");
    return JS_UNDEFINED;
}
static JSValue world_mover_remove(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    return r2d_world_mover_remove(w,(int)p[0])?JS_UNDEFINED:JS_EXCEPTION;
}
static JSValue world_mover_intent(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[2];if(!w||!world_numbers(ctx,argc,argv,2,p))return JS_EXCEPTION;
    if(p[1]<0||p[1]>2)return JS_ThrowRangeError(ctx,"Re2D World: mover intent 0 open / 1 close / 2 toggle");
    r2d_world_mover_intent(w,(int)p[0],(int)p[1]);return JS_UNDEFINED;
}
static JSValue world_mover_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    float out[6];unsigned events=0;if(!r2d_world_mover_info(w,(int)p[0],out,&events))return JS_NULL;
    JSValue o=JS_NewObject(ctx);
    set_num(ctx,o,"position",out[0]);set_num(ctx,o,"fraction",out[1]);set_num(ctx,o,"phase",out[2]);
    set_num(ctx,o,"direction",out[3]);set_num(ctx,o,"timer",out[4]);set_num(ctx,o,"kind",out[5]);
    set_num(ctx,o,"events",events);return o;
}
static JSValue world_trigger_create(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<10||!JS_IsNumber(argv[0])||!JS_IsString(argv[1]))return JS_ThrowTypeError(ctx,"Re2D World: triggerCreate(type,id,target,x,y,radius,bottom,top,once,cooldown)");
    float type;if(!world_numbers(ctx,1,argv,1,&type))return JS_EXCEPTION;
    const char *id=JS_ToCString(ctx,argv[1]);if(!id)return JS_EXCEPTION;
    const char *target=NULL;if(JS_IsString(argv[2]))target=JS_ToCString(ctx,argv[2]);
    float p[7];bool ok=world_numbers(ctx,argc-3,argv+3,7,p);
    int token=-1;
    if(ok)token=r2d_world_trigger_create(w,(int)type,id,target,p[0],p[1],p[2],p[3],p[4],p[5]!=0.0f,p[6]);
    JS_FreeCString(ctx,id);if(target)JS_FreeCString(ctx,target);
    if(!ok)return JS_EXCEPTION;
    if(token<=0)return JS_ThrowRangeError(ctx,"Re2D World: invalid trigger");
    return JS_NewInt32(ctx,token);
}
static JSValue world_trigger_remove(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    return r2d_world_trigger_remove(w,(int)p[0])?JS_UNDEFINED:JS_EXCEPTION;
}
static JSValue trigger_tokens(JSContext *ctx,int count,const int *tokens)
{
    JSValue array=JS_NewArray(ctx);if(JS_IsException(array))return array;
    for(int i=0;i<count;i++)JS_SetPropertyUint32(ctx,array,(uint32_t)i,JS_NewInt32(ctx,tokens[i]));
    return array;
}
static JSValue world_trigger_tick(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[4];if(!w||!world_numbers(ctx,argc,argv,4,p))return JS_EXCEPTION;
    int tokens[R2D_WORLD_TRIGGER_LIMIT];
    int count=r2d_world_trigger_tick(w,p[1],p[2],p[3],tokens,R2D_WORLD_TRIGGER_LIMIT);
    (void)p[0];
    return trigger_tokens(ctx,count,tokens);
}
static JSValue world_trigger_use(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[3];if(!w||!world_numbers(ctx,argc,argv,3,p))return JS_EXCEPTION;
    int tokens[R2D_WORLD_TRIGGER_LIMIT];
    int count=r2d_world_trigger_use_at(w,p[0],p[1],p[2],tokens,R2D_WORLD_TRIGGER_LIMIT);
    return trigger_tokens(ctx,count,tokens);
}
static JSValue world_trigger_shoot(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[4];if(!w||!world_numbers(ctx,argc,argv,4,p))return JS_EXCEPTION;
    int tokens[R2D_WORLD_TRIGGER_LIMIT];
    int count=r2d_world_trigger_shoot_at(w,p[0],p[1],p[2],p[3],tokens,R2D_WORLD_TRIGGER_LIMIT);
    return trigger_tokens(ctx,count,tokens);
}
static JSValue world_atlas_add(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<17)return JS_ThrowTypeError(ctx,"Re2D World: atlasAdd(node,path,columns,rows,directions,mirror,cellW,cellH,pivot,pivotX,pivotY,width,height,blend,offsetX,offsetY,offsetH)");
    if(!JS_IsString(argv[1]))return JS_ThrowTypeError(ctx,"Re2D World: atlas path must be a string");
    const char *path=JS_ToCString(ctx,argv[1]);if(!path)return JS_EXCEPTION;
    float p[15];bool ok=world_numbers(ctx,argc-2,argv+2,15,p);
    if(ok)ok=r2d_world_atlas_register(ctx,w,argv[0],path,(int)p[0],(int)p[1],(int)p[2],p[3]!=0.0f,(int)p[4],(int)p[5],(int)p[6],p[7],p[8],p[9],p[10],(int)p[11],p[12],p[13],p[14]);
    JS_FreeCString(ctx,path);return ok?JS_UNDEFINED:JS_EXCEPTION;
}
static JSValue world_atlas_remove(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<1)return JS_ThrowTypeError(ctx,"Re2D World: atlasRemove(node)");
    return r2d_world_atlas_unregister(ctx,w,argv[0])?JS_UNDEFINED:JS_EXCEPTION;
}
static JSValue world_camera(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[8];if(!w||!world_numbers(ctx,argc,argv,8,p))return JS_EXCEPTION;
    if(p[5]<=0||p[5]>=3.14159265f||p[6]<=0||p[7]<0)return JS_ThrowRangeError(ctx,"Re2D World: invalid camera fov/near/orthographic height");
    r2d_re2d_view_set(&w->view,p[0],p[1],p[2],p[3],p[4],p[5],320,180);w->view.near_plane=p[6];w->ortho=p[7];return JS_UNDEFINED;
}
static JSValue world_registered_frame(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[2];if(!w||!world_numbers(ctx,argc,argv,2,p))return JS_EXCEPTION;
    if(p[0]<1||p[0]>1024||p[1]<1||p[1]>1024||p[0]!=floorf(p[0])||p[1]!=floorf(p[1]))return JS_ThrowRangeError(ctx,"Re2D World: frame dimensions 1..1024 integers");
    R2DRe2dView view=w->view;view.width=p[0];view.height=p[1];view.focal=(view.height*.5f)/tanf(view.fov*.5f);
    int sprite=r2d_world_runtime_frame(ctx,w,&view,(int)p[0],(int)p[1],w->ortho);return sprite<0?JS_EXCEPTION:JS_NewInt32(ctx,sprite);
}
static JSValue world_backend(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(w->rendering)return JS_ThrowTypeError(ctx,"Re2D World: backend busy");
    const char *mode=argc?JS_ToCString(ctx,argv[0]):NULL;if(!mode)return JS_EXCEPTION;
    bool gpu=!strcmp(mode,"gpu"),valid=gpu||!strcmp(mode,"cpu");JS_FreeCString(ctx,mode);
    if(!valid)return JS_ThrowTypeError(ctx,"Re2D World: backend must be cpu or gpu");w->gpu_enabled=gpu;return JS_UNDEFINED;
}
static JSValue world_gpu_wait(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;if(argc<1||!JS_IsBool(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: gpuWait(boolean)");w->gpu_wait=JS_ToBool(ctx,argv[0]);return JS_UNDEFINED;
}
static JSValue world_quality(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[2];if(!w||!world_numbers(ctx,argc,argv,2,p))return JS_EXCEPTION;
    if(p[0]<0||p[0]>4096||floorf(p[0])!=p[0]||p[1]<0||p[1]>45)return JS_ThrowRangeError(ctx,"Re2D World: poseBudget 0..4096, poseStep 0..45");w->pose_budget=(int)p[0];w->pose_step=p[1];
    // Existing quality presets also drive the visual tier: low keeps the legacy
    // look plus P0 grounding, medium adds P1 atmosphere/variation, high/ultra add
    // edge quality, corner AO, four sky layers and liquid. This keeps the old
    // high-level world.qualityPreset('high') path usable without a JS change.
    r2d_world_render_quality(w,p[0]>=4?R2D_RENDER_QUALITY_HIGH:p[0]>=2?R2D_RENDER_QUALITY_MEDIUM:R2D_RENDER_QUALITY_LOW);
    return JS_UNDEFINED;
}
static JSValue world_debug_view(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float mode;if(!w||!world_numbers(ctx,argc,argv,1,&mode))return JS_EXCEPTION;
    if(mode<0||mode>=R2D_WORLD_DEBUG_COUNT||mode!=floorf(mode))return JS_ThrowRangeError(ctx,"Re2D World: unsupported debug view");w->debug_view=(int)mode;return JS_UNDEFINED;
}
static JSValue world_debug_visibility(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    JSValue out=JS_NewObject(ctx),spans=JS_NewArray(ctx),surfaces=JS_NewArray(ctx);
    for(int i=0;i<w->visibility.span_count;i++)JS_SetPropertyUint32(ctx,spans,(uint32_t)i,JS_NewInt32(ctx,w->visibility.spans[i]));
    for(int i=0;i<w->visibility.surface_count;i++)JS_SetPropertyUint32(ctx,surfaces,(uint32_t)i,JS_NewInt32(ctx,w->visibility.surfaces[i]));
    JS_SetPropertyStr(ctx,out,"spans",spans);JS_SetPropertyStr(ctx,out,"surfaces",surfaces);return out;
}
static JSValue world_decal_new(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[6];if(!w||argc<7||!JS_IsString(argv[1]))return JS_ThrowTypeError(ctx,"Re2D World: decal(surface,material,u,v,width,height,life[,rotation,scale,fadeIn,fadeOut])");
    if(!world_numbers(ctx,1,argv,1,p)||!world_numbers(ctx,argc-2,argv+2,5,p+1))return JS_EXCEPTION;
    if(p[0]!=floorf(p[0]))return JS_ThrowRangeError(ctx,"Re2D World: decal surface must be an integer");
    const char *name=JS_ToCString(ctx,argv[1]);if(!name)return JS_EXCEPTION;int material=r2d_world_material_find(&w->world,name);JS_FreeCString(ctx,name);
    R2DWorldDecal decal={.surface=(int)p[0],.material=material,.u=p[1],.v=p[2],.w=p[3],.h=p[4],.remaining=p[5],
        .max_life=0.0f,.scale=1.0f};
    // P4 decals 2.0: optional authored rotation/scale/fade. Only an explicitly
    // extended call opts into decals 2.0; the legacy 7-argument form keeps the
    // deterministic hash variation and CPU/GPU parity.
    if(argc>7){float v2[1];if(!world_numbers(ctx,1,argv+7,1,v2))return JS_EXCEPTION;decal.rotation=v2[0];decal.max_life=p[5];}
    if(argc>8){float v2[1];if(!world_numbers(ctx,1,argv+8,1,v2))return JS_EXCEPTION;decal.scale=v2[0];decal.max_life=p[5];}
    if(argc>9){float v2[1];if(!world_numbers(ctx,1,argv+9,1,v2))return JS_EXCEPTION;decal.fade_in=v2[0];decal.max_life=p[5];}
    if(argc>10){float v2[1];if(!world_numbers(ctx,1,argv+10,1,v2))return JS_EXCEPTION;decal.fade_out=v2[0];decal.max_life=p[5];}
    int token=r2d_world_decal_create(&w->world,&decal);
    if(token<0)return JS_ThrowRangeError(ctx,"Re2D World: invalid decal or 128-decal budget exhausted");return JS_NewInt32(ctx,token);
}
static JSValue world_decal_remove(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);int token;if(!w||!world_token(ctx,argc,argv,&token))return JS_EXCEPTION;
    if(!r2d_world_decal_remove(&w->world,token))return JS_ThrowRangeError(ctx,"Re2D World: stale decal handle");return JS_UNDEFINED;
}
static JSValue world_surface_sky(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);int32_t id;if(!w)return JS_EXCEPTION;
    if(argc<2||JS_ToInt32(ctx,&id,argv[0])||id<0||id>=w->world.surface_count||w->world.surfaces[id].kind!=R2D_WORLD_CEILING||!JS_IsBool(argv[1]))return JS_ThrowRangeError(ctx,"Re2D World: sky requires a ceiling surface");
    if(!w->world.surface_sky){w->world.surface_sky=calloc((size_t)w->world.surface_count,1);if(!w->world.surface_sky)return JS_ThrowOutOfMemory(ctx);}
    w->world.surface_sky[id]=JS_ToBool(ctx,argv[1]);return JS_UNDEFINED;
}
static JSValue world_sky_set(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    uint32_t color;if(argc<2||!JS_IsString(argv[0])||JS_ToUint32(ctx,&color,argv[1]))return JS_ThrowTypeError(ctx,"Re2D World: sky(texture,color)");
    const char *path=JS_ToCString(ctx,argv[0]);if(!path)return JS_EXCEPTION;
    float p[2]={0,0};if(argc>=4&&!world_numbers(ctx,2,argv+2,2,p)){JS_FreeCString(ctx,path);return JS_EXCEPTION;}if(p[1]<-16||p[1]>16){JS_FreeCString(ctx,path);return JS_ThrowRangeError(ctx,"Re2D World: sky exposure -16..16 EV");}
    bool ok=r2d_world_runtime_sky(ctx,w,path,color,p[0],p[1]);JS_FreeCString(ctx,path);return ok?JS_UNDEFINED:JS_EXCEPTION;
}
static JSValue sky_layers_array(JSContext *ctx,R2DWorldRuntime *w)
{
    JSValue arr=JS_NewArray(ctx);
    const R2DWorldSky *cfg=r2d_world_runtime_sky_config(w);
    int count=cfg?cfg->layer_count:0;
    for(int i=0;i<count;i++){
        JSValue o=JS_NewObject(ctx);
        set_num(ctx,o,"index",i);
        JS_SetPropertyStr(ctx,o,"id",JS_NewString(ctx,cfg->layers[i].id));
        JS_SetPropertyStr(ctx,o,"texture",JS_NewString(ctx,cfg->layers[i].texture_path));
        set_num(ctx,o,"tint",(double)cfg->layers[i].tint);
        set_num(ctx,o,"parallax",cfg->layers[i].parallax);
        set_num(ctx,o,"scale",cfg->layers[i].scale);
        set_num(ctx,o,"offset",cfg->layers[i].offset);
        set_num(ctx,o,"alpha",cfg->layers[i].alpha);
        set_num(ctx,o,"scroll",cfg->layers[i].scroll);
        int width=0,height=0;
        const uint8_t *pixels=r2d_world_runtime_sky_layer_pixels(w,i,&width,&height);
        JS_SetPropertyStr(ctx,o,"loaded",JS_NewBool(ctx,pixels!=NULL));
        set_num(ctx,o,"width",width);set_num(ctx,o,"height",height);
        JS_SetPropertyUint32(ctx,arr,(uint32_t)i,o);
    }
    return arr;
}
static JSValue world_sky_layer_set(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<9)return JS_ThrowTypeError(ctx,"Re2D World: skyLayer(index,id,texture,tint,parallax,scroll,alpha,offset,scale)");
    int32_t index=0;if(JS_ToInt32(ctx,&index,argv[0])||index<0||index>=R2D_SKY_MAX_LAYERS)return JS_ThrowRangeError(ctx,"Re2D World: sky layer index 0..3");
    const char *strings[2]={0};for(int i=0;i<2;i++){if(!JS_IsString(argv[1+i])){JS_ThrowTypeError(ctx,"Re2D World: sky layer id/texture must be strings");return JS_EXCEPTION;}strings[i]=JS_ToCString(ctx,argv[1+i]);if(!strings[i])return JS_EXCEPTION;}
    uint32_t tint=0xffffffffu;float numbers[5]={0};int ok=!JS_ToUint32(ctx,&tint,argv[3]);
    for(int i=0;i<5&&ok;i++){double v;if(JS_ToFloat64(ctx,&v,argv[4+i])||!isfinite(v))ok=0;else numbers[i]=(float)v;}
    bool result=false;
    if(ok)result=r2d_world_runtime_sky_layer_set(ctx,w,index,strings[0],strings[1],tint,
        numbers[0],numbers[1],numbers[2],numbers[3],numbers[4]); // parallax,scroll,alpha,offset,scale
    JS_FreeCString(ctx,strings[0]);JS_FreeCString(ctx,strings[1]);
    if(!ok)return JS_ThrowRangeError(ctx,"Re2D World: sky layer parameters invalid");
    return JS_NewBool(ctx,result);
}
static JSValue world_sky_layers_get(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    return sky_layers_array(ctx,w);
}
static JSValue world_sky_manifest(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<1||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: skyManifest(path)");
    const char *path=JS_ToCString(ctx,argv[0]);if(!path)return JS_EXCEPTION;
    bool ok=r2d_world_runtime_sky_manifest(ctx,w,path);JS_FreeCString(ctx,path);
    return JS_NewBool(ctx,ok);
}
static JSValue world_material_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<1)return JS_ThrowTypeError(ctx,"Re2D World: materialInfo(index|name)");
    int index=-1;
    if(JS_IsString(argv[0])){
        const char *name=JS_ToCString(ctx,argv[0]);if(!name)return JS_EXCEPTION;
        index=r2d_world_material_find(&w->world,name);JS_FreeCString(ctx,name);
    }else{
        int32_t value=0;if(JS_ToInt32(ctx,&value,argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: materialInfo(index|name)");
        index=value;
    }
    return material_info_object(ctx,w,index);
}
static JSValue world_materials_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    JSValue arr=JS_NewArray(ctx);uint32_t count=0;
    for(int i=0;i<R2D_WORLD_MAX_MATERIALS;i++)if(w->world.materials[i].used){
        JSValue o=material_info_object(ctx,w,i);if(JS_IsNull(o)){JS_FreeValue(ctx,o);continue;}
        JS_SetPropertyUint32(ctx,arr,count++,o);
    }
    return arr;
}
static JSValue world_material_set(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<7)return JS_ThrowTypeError(ctx,"Re2D World: material(name,albedo,normal,emissive,strength,uScale,vScale)");
    const char *strings[4]={0};float numbers[5]={0,0,0,0,1};
    for(int i=0;i<4;i++){if(!JS_IsString(argv[i])){JS_ThrowTypeError(ctx,"Re2D World: material names/paths must be strings");goto fail;}strings[i]=JS_ToCString(ctx,argv[i]);if(!strings[i])goto fail;}
    if(!world_numbers(ctx,argc-4,argv+4,argc>=9?5:3,numbers))goto fail;
    if(numbers[3]<0||numbers[3]>3||floorf(numbers[3])!=numbers[3]){JS_ThrowRangeError(ctx,"Re2D World: invalid blend category");goto fail;}
    if(w->disposed){JS_ThrowTypeError(ctx,"Re2D World: world disposed during material configuration");goto fail;}
    bool ok=r2d_world_runtime_material(ctx,w,strings[0],strings[1],strings[2],strings[3],numbers[0],numbers[1],numbers[2],(int)numbers[3],numbers[4],argc>=10&&JS_ToBool(ctx,argv[9]),argc>=11&&JS_ToBool(ctx,argv[10]));
    for(int i=0;i<4;i++)JS_FreeCString(ctx,strings[i]);return ok?JS_UNDEFINED:JS_EXCEPTION;
fail:
    for(int i=0;i<4;i++)if(strings[i])JS_FreeCString(ctx,strings[i]);return JS_EXCEPTION;
}
static JSValue world_surface_material_name(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[1];if(!w||!world_numbers(ctx,argc,argv,1,p))return JS_EXCEPTION;
    int index=(int)p[0];
    if(index<0||index>=w->world.surface_count)return JS_NULL;
    int material=w->world.surface_materials?w->world.surface_materials[index]:-1;
    if(material<0||material>=R2D_WORLD_MAX_MATERIALS||!w->world.materials[material].used)return JS_NULL;
    return JS_NewString(ctx,w->world.materials[material].name);
}
static JSValue world_surface_material_set(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float index;if(!w||!world_numbers(ctx,argc,argv,1,&index))return JS_EXCEPTION;
    if(argc<2||!JS_IsString(argv[1])||index<0||index!=floorf(index))return JS_ThrowTypeError(ctx,"Re2D World: surfaceMaterial(surface,name)");
    const char *name=JS_ToCString(ctx,argv[1]);if(!name)return JS_EXCEPTION;
    int material=r2d_world_material_find(&w->world,name);JS_FreeCString(ctx,name);
    if(!r2d_world_surface_material(&w->world,(int)index,material))return JS_ThrowRangeError(ctx,"Re2D World: missing surface or material");return JS_UNDEFINED;
}
static JSValue world_light_visual_config(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);int token;float p[4];uint32_t seed;if(!w||!world_token(ctx,argc,argv,&token)||!world_numbers(ctx,argc-1,argv+1,4,p))return JS_EXCEPTION;
    if(argc<6||JS_ToUint32(ctx,&seed,argv[5])<0)return JS_ThrowTypeError(ctx,"Re2D World: flicker seed required");
    if(!r2d_world_light_visual(&w->world,token,p[0],p[1],p[2],p[3],seed))return JS_ThrowRangeError(ctx,"Re2D World: invalid light visual parameters");return JS_UNDEFINED;
}
static void world_watch_poll(JSContext *,WorldHandle *,float);
static JSValue world_step_all(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)self;float dt;if(!world_numbers(ctx,argc,argv,1,&dt))return JS_EXCEPTION;if(dt<0||dt>60)return JS_ThrowRangeError(ctx,"Re2D World: invalid step dt");
    for(WorldHandle *w=world_registry;w;w=w->next)if(w->runtime==JS_GetRuntime(ctx)){r2d_world_light_step(&w->world,dt);r2d_world_decal_step(&w->world,dt);r2d_world_mover_advance(w,dt);r2d_world_trigger_advance(w,dt);VfxBinding *vfx=vfx_binding(w);if(vfx){r2d_world_vfx_step(&vfx->vfx,dt);if(w->particle_ready){r2d_world_vfx_bind(&vfx->vfx,&w->particles);r2d_world_vfx_step_particles(&vfx->vfx,dt);}}else r2d_world_particles_step(w,dt);r2d_world_material_anim_advance(w,dt);r2d_world_polywall_advance(w,dt);r2d_world_post_step_all(w,dt);r2d_world_sky_anim_advance(w,dt);r2d_world_render_advance(w,dt);world_watch_poll(ctx,w,dt);}return JS_UNDEFINED;
}
static JSValue world_light_at(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[3],rgb[3];if(!w||!world_numbers(ctx,argc,argv,3,p))return JS_EXCEPTION;
    int span=r2d_world_span_at(&w->world,p[0],p[1],p[2]);if(span<0)return JS_NULL;
    if(!r2d_world_light_rebuild(&w->world))return JS_ThrowOutOfMemory(ctx);
    r2d_world_light_sample(&w->world,span,p[0],p[1],p[2],0,0,0,0,rgb);
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"r",rgb[0]);set_num(ctx,o,"g",rgb[1]);set_num(ctx,o,"b",rgb[2]);set_num(ctx,o,"level",(rgb[0]+rgb[1]+rgb[2])/3);return o;
}
static JSValue world_watch(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<1||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: watch(path)");
    const char *path=JS_ToCString(ctx,argv[0]);if(!path)return JS_EXCEPTION;
    char full[4096];R2DScript *script=JS_GetContextOpaque(ctx);r2d_app_resolve_path(script->app,full,sizeof full,path);
    SDL_PathInfo info={0};bool enabled=path[0]!=0;JS_FreeCString(ctx,path);
    if(enabled&&!SDL_GetPathInfo(full,&info))return JS_ThrowTypeError(ctx,"Re2D World: watch file missing");
    char *copy=enabled?SDL_strdup(full):NULL;if(enabled&&!copy)return JS_ThrowOutOfMemory(ctx);
    SDL_free(w->watch_path);w->watch_path=copy;w->watch_mtime=info.modify_time;w->watch_size=info.size;w->watch_elapsed=0;w->reload_error[0]=0;return JS_UNDEFINED;
}
static JSValue world_reload(JSContext *,JSValueConst,int,JSValueConst *);
static JSValue world_wrap(JSContext *ctx,WorldHandle *w)
{
    R2DScript *audio_script=JS_GetContextOpaque(ctx);w->audio=audio_script?audio_script->audio:NULL;
    JSValue handle=JS_NewObjectClass(ctx,world_class);if(JS_IsException(handle)) {world_dispose(w);free(w);return handle;}
    JS_SetOpaque(handle,w);w->next=world_registry;world_registry=w;w->registered=true;
    JS_SetPropertyStr(ctx,handle,"support",JS_NewCFunction(ctx,world_support,"support",5));
    JS_SetPropertyStr(ctx,handle,"blocked",JS_NewCFunction(ctx,world_blocked,"blocked",5));
    JS_SetPropertyStr(ctx,handle,"ray",JS_NewCFunction(ctx,world_ray,"ray",6));
    JS_SetPropertyStr(ctx,handle,"frame",JS_NewCFunction(ctx,world_frame,"frame",4));
    JS_SetPropertyStr(ctx,handle,"info",JS_NewCFunction(ctx,world_info,"info",0));
    JS_SetPropertyStr(ctx,handle,"batchInfo",JS_NewCFunction(ctx,world_batch_info,"batchInfo",0));
    JS_SetPropertyStr(ctx,handle,"batchGpu",JS_NewCFunction(ctx,world_batch_gpu,"batchGpu",1));
    JS_SetPropertyStr(ctx,handle,"dispose",JS_NewCFunction(ctx,world_release,"dispose",0));
    JS_SetPropertyStr(ctx,handle,"cellAt",JS_NewCFunction(ctx,world_cell_query,"cellAt",2));
    JS_SetPropertyStr(ctx,handle,"spanAt",JS_NewCFunction(ctx,world_span_query,"spanAt",3));
    JS_SetPropertyStr(ctx,handle,"surface",JS_NewCFunction(ctx,world_surface_query,"surface",1));
    JS_SetPropertyStr(ctx,handle,"portalClosed",JS_NewCFunction(ctx,world_portal_closed,"portalClosed",2));
    JS_SetPropertyStr(ctx,handle,"portalMirror",JS_NewCFunction(ctx,world_portal_mirror,"portalMirror",2));
    JS_SetPropertyStr(ctx,handle,"portalMirrorGet",JS_NewCFunction(ctx,world_portal_mirror_get,"portalMirrorGet",1));
    JS_SetPropertyStr(ctx,handle,"portalSky",JS_NewCFunction(ctx,world_portal_sky,"portalSky",2));
    JS_SetPropertyStr(ctx,handle,"portalSkyGet",JS_NewCFunction(ctx,world_portal_sky_get,"portalSkyGet",1));
    JS_SetPropertyStr(ctx,handle,"portalOpen",JS_NewCFunction(ctx,world_portal_open,"portalOpen",2));
    JS_SetPropertyStr(ctx,handle,"portalFraction",JS_NewCFunction(ctx,world_portal_fraction,"portalFraction",1));
    JS_SetPropertyStr(ctx,handle,"lighting",JS_NewCFunction(ctx,world_lighting_config,"lighting",6));
    JS_SetPropertyStr(ctx,handle,"spanLight",JS_NewCFunction(ctx,world_span_light,"spanLight",1));
    JS_SetPropertyStr(ctx,handle,"spanHeight",JS_NewCFunction(ctx,world_span_height,"spanHeight",3));
    JS_SetPropertyStr(ctx,handle,"lightCreate",JS_NewCFunction(ctx,world_light_new,"lightCreate",9));
    JS_SetPropertyStr(ctx,handle,"lightUpdate",JS_NewCFunction(ctx,world_light_set,"lightUpdate",10));
    JS_SetPropertyStr(ctx,handle,"lightRemove",JS_NewCFunction(ctx,world_light_delete,"lightRemove",1));
    JS_SetPropertyStr(ctx,handle,"lightInfo",JS_NewCFunction(ctx,world_light_info,"lightInfo",1));
    JS_SetPropertyStr(ctx,handle,"audioPriority",JS_NewCFunction(ctx,world_audio_priority,"audioPriority",2));
    JS_SetPropertyStr(ctx,handle,"audioState",JS_NewCFunction(ctx,world_audio_state,"audioState",0));
    JS_SetPropertyStr(ctx,handle,"audioBudget",JS_NewCFunction(ctx,world_audio_budget,"audioBudget",1));
    JS_SetPropertyStr(ctx,handle,"audioAdd",JS_NewCFunction(ctx,world_audio_add,"audioAdd",8));
    JS_SetPropertyStr(ctx,handle,"audioUpdate",JS_NewCFunction(ctx,world_audio_update,"audioUpdate",7));
    JS_SetPropertyStr(ctx,handle,"audioInfo",JS_NewCFunction(ctx,world_audio_info,"audioInfo",1));
    JS_SetPropertyStr(ctx,handle,"audioRemove",JS_NewCFunction(ctx,world_audio_remove,"audioRemove",1));
    JS_SetPropertyStr(ctx,handle,"atlasAdd",JS_NewCFunction(ctx,world_atlas_add,"atlasAdd",17));
    JS_SetPropertyStr(ctx,handle,"hitZones",JS_NewCFunction(ctx,world_hit_zones,"hitZones",2));
    JS_SetPropertyStr(ctx,handle,"hitAdd",JS_NewCFunction(ctx,world_hit_add,"hitAdd",5));
    JS_SetPropertyStr(ctx,handle,"skyAnim",JS_NewCFunction(ctx,world_sky_anim,"skyAnim",4));
    JS_SetPropertyStr(ctx,handle,"skyAnimInfo",JS_NewCFunction(ctx,world_sky_anim_info,"skyAnimInfo",0));
    JS_SetPropertyStr(ctx,handle,"postSet",JS_NewCFunction(ctx,world_post_set,"postSet",8));
    JS_SetPropertyStr(ctx,handle,"postEnable",JS_NewCFunction(ctx,world_post_enable,"postEnable",2));
    JS_SetPropertyStr(ctx,handle,"postProfile",JS_NewCFunction(ctx,world_post_profile,"postProfile",1));
    JS_SetPropertyStr(ctx,handle,"postEval",JS_NewCFunction(ctx,world_post_eval,"postEval",0));
    JS_SetPropertyStr(ctx,handle,"postReset",JS_NewCFunction(ctx,world_post_reset,"postReset",0));
    JS_SetPropertyStr(ctx,handle,"postStep",JS_NewCFunction(ctx,world_post_step,"postStep",1));
    JS_SetPropertyStr(ctx,handle,"polywallAdd",JS_NewCFunction(ctx,world_polywall_add,"polywallAdd",5));
    JS_SetPropertyStr(ctx,handle,"polywallSpeed",JS_NewCFunction(ctx,world_polywall_speed,"polywallSpeed",2));
    JS_SetPropertyStr(ctx,handle,"polywallInfo",JS_NewCFunction(ctx,world_polywall_info,"polywallInfo",1));
    JS_SetPropertyStr(ctx,handle,"polywallRemove",JS_NewCFunction(ctx,world_polywall_remove,"polywallRemove",1));
    JS_SetPropertyStr(ctx,handle,"aimAssist",JS_NewCFunction(ctx,world_aim_assist,"aimAssist",11));
    JS_SetPropertyStr(ctx,handle,"particlesBudget",JS_NewCFunction(ctx,world_particles_budget,"particlesBudget",1));
    JS_SetPropertyStr(ctx,handle,"materialIndex",JS_NewCFunction(ctx,world_material_index,"materialIndex",1));
    JS_SetPropertyStr(ctx,handle,"materialAnimSet",JS_NewCFunction(ctx,world_material_anim_set,"materialAnimSet",9));
    JS_SetPropertyStr(ctx,handle,"materialAnimInfo",JS_NewCFunction(ctx,world_material_anim_info,"materialAnimInfo",1));
    JS_SetPropertyStr(ctx,handle,"materialAnimRemove",JS_NewCFunction(ctx,world_material_anim_remove,"materialAnimRemove",1));
    JS_SetPropertyStr(ctx,handle,"saveMapHash",JS_NewCFunction(ctx,world_save_hash,"saveMapHash",0));
    JS_SetPropertyStr(ctx,handle,"saveStateJSON",JS_NewCFunction(ctx,world_save_state,"saveStateJSON",0));
    JS_SetPropertyStr(ctx,handle,"loadStateJSON",JS_NewCFunction(ctx,world_load_state,"loadStateJSON",1));
    JS_SetPropertyStr(ctx,handle,"spanAudioZone",JS_NewCFunction(ctx,world_span_audio_zone,"spanAudioZone",2));
    JS_SetPropertyStr(ctx,handle,"spanAudioZoneInfo",JS_NewCFunction(ctx,world_span_audio_zone_info,"spanAudioZoneInfo",1));
    JS_SetPropertyStr(ctx,handle,"audioZoneAt",JS_NewCFunction(ctx,world_audio_zone_at,"audioZoneAt",3));
    JS_SetPropertyStr(ctx,handle,"surfaceMaterialName",JS_NewCFunction(ctx,world_surface_material_name,"surfaceMaterialName",1));
    JS_SetPropertyStr(ctx,handle,"surfaceTerrain",JS_NewCFunction(ctx,world_surface_terrain,"surfaceTerrain",2));
    JS_SetPropertyStr(ctx,handle,"surfaceTerrainInfo",JS_NewCFunction(ctx,world_surface_terrain_info,"surfaceTerrainInfo",1));
    JS_SetPropertyStr(ctx,handle,"surfaceConveyor",JS_NewCFunction(ctx,world_surface_conveyor,"surfaceConveyor",5));
    JS_SetPropertyStr(ctx,handle,"surfaceConveyorInfo",JS_NewCFunction(ctx,world_surface_conveyor_info,"surfaceConveyorInfo",1));
    JS_SetPropertyStr(ctx,handle,"terrainAt",JS_NewCFunction(ctx,world_terrain_at,"terrainAt",3));
    JS_SetPropertyStr(ctx,handle,"conveyorApply",JS_NewCFunction(ctx,world_conveyor_apply,"conveyorApply",4));
    JS_SetPropertyStr(ctx,handle,"conveyorAt",JS_NewCFunction(ctx,world_conveyor_at_js,"conveyorAt",3));
    JS_SetPropertyStr(ctx,handle,"secretCreate",JS_NewCFunction(ctx,world_secret_create,"secretCreate",7));
    JS_SetPropertyStr(ctx,handle,"secretRestore",JS_NewCFunction(ctx,world_secret_restore,"secretRestore",3));
    JS_SetPropertyStr(ctx,handle,"breakableRestore",JS_NewCFunction(ctx,world_breakable_restore,"breakableRestore",3));
    JS_SetPropertyStr(ctx,handle,"secretRemove",JS_NewCFunction(ctx,world_secret_remove,"secretRemove",1));
    JS_SetPropertyStr(ctx,handle,"secretInfo",JS_NewCFunction(ctx,world_secret_info,"secretInfo",1));
    JS_SetPropertyStr(ctx,handle,"secretTick",JS_NewCFunction(ctx,world_secret_tick,"secretTick",4));
    JS_SetPropertyStr(ctx,handle,"breakableCreate",JS_NewCFunction(ctx,world_breakable_create,"breakableCreate",9));
    JS_SetPropertyStr(ctx,handle,"breakableRemove",JS_NewCFunction(ctx,world_breakable_remove,"breakableRemove",1));
    JS_SetPropertyStr(ctx,handle,"breakableDamage",JS_NewCFunction(ctx,world_breakable_damage,"breakableDamage",2));
    JS_SetPropertyStr(ctx,handle,"breakableInfo",JS_NewCFunction(ctx,world_breakable_info,"breakableInfo",1));
    JS_SetPropertyStr(ctx,handle,"particlesBurst",JS_NewCFunction(ctx,world_particles_burst,"particlesBurst",3));
    JS_SetPropertyStr(ctx,handle,"particlesContinuous",JS_NewCFunction(ctx,world_particles_continuous,"particlesContinuous",4));
    JS_SetPropertyStr(ctx,handle,"particlesInfo",JS_NewCFunction(ctx,world_particles_info,"particlesInfo",0));
    JS_SetPropertyStr(ctx,handle,"particlesClear",JS_NewCFunction(ctx,world_particles_clear,"particlesClear",0));
    JS_SetPropertyStr(ctx,handle,"vfxDefine",JS_NewCFunction(ctx,world_vfx_define,"vfxDefine",2));
    JS_SetPropertyStr(ctx,handle,"vfxDefined",JS_NewCFunction(ctx,world_vfx_defined,"vfxDefined",1));
    JS_SetPropertyStr(ctx,handle,"vfxSpawn",JS_NewCFunction(ctx,world_vfx_spawn,"vfxSpawn",8));
    JS_SetPropertyStr(ctx,handle,"vfxInfo",JS_NewCFunction(ctx,world_vfx_info,"vfxInfo",0));
    JS_SetPropertyStr(ctx,handle,"vfxDebug",JS_NewCFunction(ctx,world_vfx_debug,"vfxDebug",0));
    JS_SetPropertyStr(ctx,handle,"vfxClear",JS_NewCFunction(ctx,world_vfx_clear,"vfxClear",0));
    JS_SetPropertyStr(ctx,handle,"vfxLightBudget",JS_NewCFunction(ctx,world_vfx_light_budget,"vfxLightBudget",1));
    JS_SetPropertyStr(ctx,handle,"navBuild",JS_NewCFunction(ctx,world_nav_build,"navBuild",3));
    JS_SetPropertyStr(ctx,handle,"navNodes",JS_NewCFunction(ctx,world_nav_nodes,"navNodes",0));
    JS_SetPropertyStr(ctx,handle,"navNearest",JS_NewCFunction(ctx,world_nav_nearest,"navNearest",2));
    JS_SetPropertyStr(ctx,handle,"navPathMasked",JS_NewCFunction(ctx,world_nav_path_mask,"navPathMasked",6));
    JS_SetPropertyStr(ctx,handle,"navPath",JS_NewCFunction(ctx,world_nav_path,"navPath",4));
    JS_SetPropertyStr(ctx,handle,"automapLines",JS_NewCFunction(ctx,world_automap_lines,"automapLines",1));
    JS_SetPropertyStr(ctx,handle,"automapProject",JS_NewCFunction(ctx,world_automap_project,"automapProject",6));
    JS_SetPropertyStr(ctx,handle,"metadata",JS_NewCFunction(ctx,world_metadata,"metadata",0));
    JS_SetPropertyStr(ctx,handle,"spawns",JS_NewCFunction(ctx,world_spawns,"spawns",0));
    JS_SetPropertyStr(ctx,handle,"spawn",JS_NewCFunction(ctx,world_spawn,"spawn",1));
    JS_SetPropertyStr(ctx,handle,"findCell",JS_NewCFunction(ctx,world_find_cell,"findCell",1));
    JS_SetPropertyStr(ctx,handle,"findWall",JS_NewCFunction(ctx,world_find_wall,"findWall",1));
    JS_SetPropertyStr(ctx,handle,"findSpan",JS_NewCFunction(ctx,world_find_span,"findSpan",1));
    JS_SetPropertyStr(ctx,handle,"findPortal",JS_NewCFunction(ctx,world_find_portal,"findPortal",1));
    JS_SetPropertyStr(ctx,handle,"findSurface",JS_NewCFunction(ctx,world_find_surface,"findSurface",1));
    JS_SetPropertyStr(ctx,handle,"controllerCreate",JS_NewCFunction(ctx,world_controller_create,"controllerCreate",12));
    JS_SetPropertyStr(ctx,handle,"controllerRemove",JS_NewCFunction(ctx,world_controller_remove,"controllerRemove",1));
    JS_SetPropertyStr(ctx,handle,"controllerInit",JS_NewCFunction(ctx,world_controller_init,"controllerInit",4));
    JS_SetPropertyStr(ctx,handle,"controllerMove",JS_NewCFunction(ctx,world_controller_move,"controllerMove",11));
    JS_SetPropertyStr(ctx,handle,"moverCreate",JS_NewCFunction(ctx,world_mover_create,"moverCreate",8));
    JS_SetPropertyStr(ctx,handle,"moverBlock",JS_NewCFunction(ctx,world_mover_block,"moverBlock",2));
    JS_SetPropertyStr(ctx,handle,"moverRemove",JS_NewCFunction(ctx,world_mover_remove,"moverRemove",1));
    JS_SetPropertyStr(ctx,handle,"moverIntent",JS_NewCFunction(ctx,world_mover_intent,"moverIntent",2));
    JS_SetPropertyStr(ctx,handle,"moverInfo",JS_NewCFunction(ctx,world_mover_info,"moverInfo",1));
    JS_SetPropertyStr(ctx,handle,"triggerCreate",JS_NewCFunction(ctx,world_trigger_create,"triggerCreate",10));
    JS_SetPropertyStr(ctx,handle,"triggerRemove",JS_NewCFunction(ctx,world_trigger_remove,"triggerRemove",1));
    JS_SetPropertyStr(ctx,handle,"triggerTick",JS_NewCFunction(ctx,world_trigger_tick,"triggerTick",4));
    JS_SetPropertyStr(ctx,handle,"triggerUse",JS_NewCFunction(ctx,world_trigger_use,"triggerUse",3));
    JS_SetPropertyStr(ctx,handle,"triggerShoot",JS_NewCFunction(ctx,world_trigger_shoot,"triggerShoot",4));
    JS_SetPropertyStr(ctx,handle,"hitRemove",JS_NewCFunction(ctx,world_hit_remove,"hitRemove",1));
    JS_SetPropertyStr(ctx,handle,"trace",JS_NewCFunction(ctx,world_trace,"trace",8));
    JS_SetPropertyStr(ctx,handle,"traceAll",JS_NewCFunction(ctx,world_trace_all,"traceAll",8));
    JS_SetPropertyStr(ctx,handle,"atlasRemove",JS_NewCFunction(ctx,world_atlas_remove,"atlasRemove",1));
    JS_SetPropertyStr(ctx,handle,"actorAdd",JS_NewCFunction(ctx,world_actor_add,"actorAdd",1));
    JS_SetPropertyStr(ctx,handle,"actorRemove",JS_NewCFunction(ctx,world_actor_remove,"actorRemove",1));
    JS_SetPropertyStr(ctx,handle,"camera",JS_NewCFunction(ctx,world_camera,"camera",8));
    JS_SetPropertyStr(ctx,handle,"frameRegistered",JS_NewCFunction(ctx,world_registered_frame,"frameRegistered",2));
    JS_SetPropertyStr(ctx,handle,"debugView",JS_NewCFunction(ctx,world_debug_view,"debugView",1));
    JS_SetPropertyStr(ctx,handle,"backend",JS_NewCFunction(ctx,world_backend,"backend",1));
    JS_SetPropertyStr(ctx,handle,"gpuWait",JS_NewCFunction(ctx,world_gpu_wait,"gpuWait",1));
    JS_SetPropertyStr(ctx,handle,"quality",JS_NewCFunction(ctx,world_quality,"quality",2));
    JS_SetPropertyStr(ctx,handle,"visibility",JS_NewCFunction(ctx,world_debug_visibility,"visibility",0));
    JS_SetPropertyStr(ctx,handle,"regionConfig",JS_NewCFunction(ctx,world_region_config,"regionConfig",5));
    JS_SetPropertyStr(ctx,handle,"impostors",JS_NewCFunction(ctx,world_impostors,"impostors",0));
    JS_SetPropertyStr(ctx,handle,"regionLocal",JS_NewCFunction(ctx,world_region_local,"regionLocal",2));
    JS_SetPropertyStr(ctx,handle,"regionBudget",JS_NewCFunction(ctx,world_region_budget,"regionBudget",2));
    JS_SetPropertyStr(ctx,handle,"regionLod",JS_NewCFunction(ctx,world_region_lod,"regionLod",5));
    JS_SetPropertyStr(ctx,handle,"material",JS_NewCFunction(ctx,world_material_set,"material",7));
    JS_SetPropertyStr(ctx,handle,"materialInfo",JS_NewCFunction(ctx,world_material_info,"materialInfo",1));
    JS_SetPropertyStr(ctx,handle,"materials",JS_NewCFunction(ctx,world_materials_info,"materials",0));
    JS_SetPropertyStr(ctx,handle,"watch",JS_NewCFunction(ctx,world_watch,"watch",1));
    JS_SetPropertyStr(ctx,handle,"reloadJSON",JS_NewCFunction(ctx,world_reload,"reloadJSON",1));
    JS_SetPropertyStr(ctx,handle,"decal",JS_NewCFunction(ctx,world_decal_new,"decal",7));
    JS_SetPropertyStr(ctx,handle,"decalRemove",JS_NewCFunction(ctx,world_decal_remove,"decalRemove",1));
    JS_SetPropertyStr(ctx,handle,"surfaceSky",JS_NewCFunction(ctx,world_surface_sky,"surfaceSky",2));
    JS_SetPropertyStr(ctx,handle,"sky",JS_NewCFunction(ctx,world_sky_set,"sky",4));
    JS_SetPropertyStr(ctx,handle,"skyLayer",JS_NewCFunction(ctx,world_sky_layer_set,"skyLayer",9));
    JS_SetPropertyStr(ctx,handle,"skyLayers",JS_NewCFunction(ctx,world_sky_layers_get,"skyLayers",0));
    JS_SetPropertyStr(ctx,handle,"skyManifest",JS_NewCFunction(ctx,world_sky_manifest,"skyManifest",1));
    JS_SetPropertyStr(ctx,handle,"surfaceMaterial",JS_NewCFunction(ctx,world_surface_material_set,"surfaceMaterial",2));
    JS_SetPropertyStr(ctx,handle,"lightVisual",JS_NewCFunction(ctx,world_light_visual_config,"lightVisual",6));
    JS_SetPropertyStr(ctx,handle,"lightAt",JS_NewCFunction(ctx,world_light_at,"lightAt",3));
    return handle;
}
static JSValue world_reload_apply(JSContext *ctx,WorldHandle *w,const char *text)
{
    R2DRe2dWorld next={0};char error[256];bool ok=r2d_world_load_json(&next,text,error,sizeof error);
    if(!ok)return JS_ThrowTypeError(ctx,"%s",error);
    const float region_hint=r2d_world_region_size_from_json(text);
    R2DRe2dWorld old=w->world;
    R2DWorldLight authored[R2D_WORLD_MAX_LIGHTS];memcpy(authored,next.lights,sizeof authored);
    bool retain=!next.authored_lighting;
    if(!r2d_world_set_lighting(&next,retain?&old.lighting:&next.lighting)){r2d_world_free(&next);return JS_ThrowOutOfMemory(ctx);}
    memcpy(next.lights,old.lights,sizeof next.lights);next.light_count=0;
    for(int i=0;i<R2D_WORLD_MAX_LIGHTS;i++){
        if(next.lights[i].is_static)next.lights[i].active=false;
        if(next.lights[i].active)next.light_count++;
        next.light_links[i].count=0;
    }
    if(next.span_count)memset(next.span_light_masks,0,(size_t)next.span_count*4*sizeof(uint32_t));
    if(next.span_count)memset(next.span_light_counts,0,(size_t)next.span_count);
    if(next.span_count)memset(next.span_light_candidates,0,(size_t)next.span_count);
    next.light_pairs=next.light_overflow=0;next.light_dirty=next.light_full_dirty=true;
    for(int i=0;i<R2D_WORLD_MAX_LIGHTS;i++)if(authored[i].active){
        if(r2d_world_light_create(&next,&authored[i])<0){r2d_world_free(&next);return JS_ThrowRangeError(ctx,"Re2D World: reloaded static lights exceed available pool");}
    }
    memcpy(next.materials,old.materials,sizeof next.materials);next.material_count=old.material_count;
    memset(old.materials,0,sizeof old.materials);old.material_count=0;
    next.sky=old.sky;next.sky_color=old.sky_color;next.sky_yaw=old.sky_yaw;memset(&old.sky,0,sizeof old.sky);
    // Indexed configuration survives only when its canonical index domain agrees.
    if(next.wall_count==old.wall_count&&next.span_count==old.span_count&&next.cell_count==old.cell_count){
        free(next.surface_sky);next.surface_sky=old.surface_sky;old.surface_sky=NULL;
        free(next.surface_materials);next.surface_materials=old.surface_materials;old.surface_materials=NULL;
        if(retain){free(next.span_lights);next.span_lights=old.span_lights;old.span_lights=NULL;}
    }
    memcpy(next.decals,old.decals,sizeof next.decals);next.decal_count=old.decal_count;
    if(next.wall_count!=old.wall_count||next.span_count!=old.span_count||next.cell_count!=old.cell_count){for(int i=0;i<R2D_WORLD_MAX_DECALS;i++)next.decals[i].active=false;next.decal_count=0;}
    next.geometry_revision=old.geometry_revision+1;
    VfxBinding *vfx=vfx_binding(w);
    if(vfx)r2d_world_vfx_clear(&vfx->vfx);
    r2d_world_gpu_free(w);r2d_world_visibility_free(&w->visibility);r2d_world_regions_free(w);
    w->world=next;w->region_size_hint=region_hint;r2d_world_free(&old);
    w->reload_count++;w->reload_error[0]=0;return JS_UNDEFINED;
}
static JSValue world_reload(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(w->rendering||argc<1||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: reload expects JSON outside rendering");
    const char *text=JS_ToCString(ctx,argv[0]);if(!text)return JS_EXCEPTION;
    JSValue result=world_reload_apply(ctx,w,text);JS_FreeCString(ctx,text);return result;
}
static void world_watch_poll(JSContext *ctx,WorldHandle *w,float dt)
{
    if(!w->watch_path||w->rendering)return;w->watch_elapsed+=dt;if(w->watch_elapsed<.35f)return;w->watch_elapsed=0;
    SDL_PathInfo info;if(!SDL_GetPathInfo(w->watch_path,&info)){SDL_strlcpy(w->reload_error,"watched file missing",sizeof w->reload_error);return;}
    if(info.modify_time==w->watch_mtime&&info.size==w->watch_size)return;
    w->watch_mtime=info.modify_time;w->watch_size=info.size;
    if(info.size>268435456){SDL_strlcpy(w->reload_error,"watched world exceeds 256 MiB",sizeof w->reload_error);return;}
    size_t size;char *text=SDL_LoadFile(w->watch_path,&size);if(!text){SDL_strlcpy(w->reload_error,"watched file read failed",sizeof w->reload_error);return;}
    JSValue result=world_reload_apply(ctx,w,text);SDL_free(text);
    if(JS_IsException(result)){JSValue error=JS_GetException(ctx);const char *message=JS_ToCString(ctx,error);SDL_strlcpy(w->reload_error,message?message:"invalid watched world",sizeof w->reload_error);if(message)JS_FreeCString(ctx,message);JS_FreeValue(ctx,error);}
}
static bool world_number_arg(JSContext *ctx,JSValueConst value,double *out)
{
    if(JS_ToFloat64(ctx,out,value)<0)return false;
    return isfinite(*out);
}

static JSValue world_region_config(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<5)return JS_ThrowTypeError(ctx,"Re2D World: regionConfig(size,activeRing,preloadRing,uploadBytes,uploadItems)");
    double size=0,bytes=0;int32_t active=0,preload=0,items=0;
    if(!world_number_arg(ctx,argv[0],&size)||!world_number_arg(ctx,argv[3],&bytes)||
       JS_ToInt32(ctx,&active,argv[1])<0||JS_ToInt32(ctx,&preload,argv[2])<0||
       JS_ToInt32(ctx,&items,argv[4])<0)return JS_EXCEPTION;
    if(bytes<0)return JS_ThrowRangeError(ctx,"Re2D World: upload budget must be >= 0");
    if(!r2d_world_region_config(w,(float)size,active,preload,(uint64_t)bytes,items))
        return JS_ThrowRangeError(ctx,"Re2D World: invalid region configuration");
    return JS_UNDEFINED;
}

static JSValue world_impostors(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    int count=0;const R2DWorldImpostor *cards=r2d_world_visible_impostors(w,&count);
    JSValue list=JS_NewArray(ctx);
    if(!cards)return list;
    for(int i=0;i<count;i++){
        const R2DWorldImpostor *card=&cards[i];
        JSValue item=JS_NewObject(ctx);
        set_num(ctx,item,"region",card->region);
        set_num(ctx,item,"x",card->cx);set_num(ctx,item,"y",card->cy);
        set_num(ctx,item,"localX",card->local_x);set_num(ctx,item,"localY",card->local_y);
        set_num(ctx,item,"width",card->width);set_num(ctx,item,"height",card->height);
        set_num(ctx,item,"bottom",card->bottom);set_num(ctx,item,"top",card->top);
        set_num(ctx,item,"color",card->color);set_num(ctx,item,"distance",card->distance);
        set_num(ctx,item,"cells",card->cells);set_num(ctx,item,"spans",card->spans);
        JS_SetPropertyUint32(ctx,list,(uint32_t)i,item);
    }
    return list;
}

static JSValue world_region_local(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    double x,y;if(argc<2||!world_number_arg(ctx,argv[0],&x)||!world_number_arg(ctx,argv[1],&y))
        return JS_ThrowTypeError(ctx,"Re2D World: regionLocal(x,y)");
    if(!r2d_world_regions_ensure(w))return JS_NULL;
    const R2DWorldRegionSet *set=r2d_world_regions(w);
    const int region=r2d_world_region_at(set,(float)x,(float)y);
    if(region<0)return JS_NULL;
    float lx=0,ly=0,ox=0,oy=0;
    r2d_world_region_local(set,region,(float)x,(float)y,&lx,&ly);
    r2d_world_region_render_origin(set,region,&ox,&oy);
    JSValue out=JS_NewObject(ctx);
    set_num(ctx,out,"region",region);set_num(ctx,out,"localX",lx);set_num(ctx,out,"localY",ly);
    set_num(ctx,out,"originX",ox);set_num(ctx,out,"originY",oy);
    return out;
}

static JSValue world_region_budget(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<1)return JS_ThrowTypeError(ctx,"Re2D World: regionBudget(residentBytes,maxItems=0)");
    double bytes=0;int32_t items=0;
    if(!world_number_arg(ctx,argv[0],&bytes)||bytes<0)
        return JS_ThrowRangeError(ctx,"Re2D World: resident byte budget must be >= 0");
    if(argc>1&&JS_ToInt32(ctx,&items,argv[1])<0)return JS_EXCEPTION;
    if(items<0)return JS_ThrowRangeError(ctx,"Re2D World: max resident items must be >= 0");
    if(!r2d_world_region_budget(w,(uint64_t)bytes,items))
        return JS_ThrowRangeError(ctx,"Re2D World: invalid region budget");
    return JS_UNDEFINED;
}

static JSValue world_region_lod(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);if(!w)return JS_EXCEPTION;
    if(argc<5)return JS_ThrowTypeError(ctx,"Re2D World: regionLod(near,mid,far,impostor,hidden)");
    double bands[5];
    for(int i=0;i<5;i++)if(!world_number_arg(ctx,argv[i],&bands[i]))
        return JS_ThrowTypeError(ctx,"Re2D World: regionLod expects 5 finite distances");
    if(!r2d_world_region_lod_bands(w,(float)bands[0],(float)bands[1],(float)bands[2],
                                   (float)bands[3],(float)bands[4]))
        return JS_ThrowRangeError(ctx,"Re2D World: LOD bands must be finite and monotonic");
    return JS_UNDEFINED;
}

static JSValue world_load(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)self;R2DScript *script=JS_GetContextOpaque(ctx);
    if(!script||!script->renderer||argc<1||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: load expects JSON text");
    const char *text=JS_ToCString(ctx,argv[0]);if(!text)return JS_EXCEPTION;
    WorldHandle *w=calloc(1,sizeof *w);if(!w){JS_FreeCString(ctx,text);return JS_ThrowOutOfMemory(ctx);}
    w->renderer=script->renderer;w->runtime=JS_GetRuntime(ctx);w->texture=w->sprite=-1;w->batch_gpu=true;
    r2d_re2d_view_set(&w->view,0,0,48,0,0,1.2f,320,180);char error[256];
    bool ok=r2d_world_load_json(&w->world,text,error,sizeof error);
    // Honor compiler --region-size metadata from the same JSON document.
    if(ok)w->region_size_hint=r2d_world_region_size_from_json(text);
    JS_FreeCString(ctx,text);
    if(!ok){world_dispose(w);free(w);return JS_ThrowTypeError(ctx,"%s",error);}
    if(!vfx_attach(w)){world_dispose(w);free(w);return JS_ThrowOutOfMemory(ctx);}
    return world_wrap(ctx,w);
}
static JSValue world_create(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)self;R2DScript *script=JS_GetContextOpaque(ctx);
    if(!script||!script->renderer||argc<2||JS_GetTypedArrayType(argv[0])!=JS_TYPED_ARRAY_FLOAT32||JS_GetTypedArrayType(argv[1])!=JS_TYPED_ARRAY_FLOAT32)
        return JS_ThrowTypeError(ctx,"World.create: walls/spans Float32Array");
    float *walls,*spans;size_t nw,ns;
    JSValue a=f32_view(ctx,argv[0],&walls,&nw);if(JS_IsException(a)) return a;
    JSValue b=f32_view(ctx,argv[1],&spans,&ns);if(JS_IsException(b)) {JS_FreeValue(ctx,a);return b;}
    if(!world_rows(ctx,walls,nw,9)||!world_rows(ctx,spans,ns,12)) {JS_FreeValue(ctx,a);JS_FreeValue(ctx,b);return JS_EXCEPTION;}
    R2DWorldWall *ww=calloc(nw/9+1,sizeof *ww);R2DWorldSpan *ss=calloc(ns/12+1,sizeof *ss);
    WorldHandle *w=calloc(1,sizeof *w);
    if(!ww||!ss||!w) {free(ww);free(ss);free(w);JS_FreeValue(ctx,a);JS_FreeValue(ctx,b);return JS_ThrowOutOfMemory(ctx);}
    w->renderer=script->renderer;w->runtime=JS_GetRuntime(ctx);w->texture=w->sprite=-1;w->batch_gpu=true;
    r2d_re2d_view_set(&w->view,0,0,48,0,0,1.2f,320,180);
    for(size_t i=0;i<nw/9;i++) {float *p=walls+i*9;ww[i]=(R2DWorldWall){p[0],p[1],p[2],p[3],p[4],p[5],world_rgb(p+6),0};}
    for(size_t i=0;i<ns/12;i++) {float *p=spans+i*12;ss[i]=(R2DWorldSpan){p[0],p[1],p[2],p[3],p[4],p[5],world_rgb(p+6),world_rgb(p+9),0,0,0,0};}
    bool built=r2d_world_build(&w->world,ww,(int)(nw/9),ss,(int)(ns/12));
    free(ww);free(ss);JS_FreeValue(ctx,a);JS_FreeValue(ctx,b);
    if(!built) {world_dispose(w);free(w);return JS_ThrowRangeError(ctx,"World.create: неверная геометрия, пересечение spans или нехватка памяти");}
    if(!vfx_attach(w)){world_dispose(w);free(w);return JS_ThrowOutOfMemory(ctx);}
    return world_wrap(ctx,w);
}

int r2d_re2d_install(JSContext *ctx, JSValue engine)
{
    world_class=0;
    JS_NewClassID(JS_GetRuntime(ctx),&world_class);
    JSClassDef def={.class_name="Re2DWorld",.finalizer=world_finalizer,.gc_mark=world_mark};
    if(JS_NewClass(JS_GetRuntime(ctx),world_class,&def)<0) return -1;
    JSValue re2d = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx,re2d,"worldStep",JS_NewCFunction(ctx,world_step_all,"worldStep",1));
    JS_SetPropertyStr(ctx,re2d,"worldLoad",JS_NewCFunction(ctx,world_load,"worldLoad",1));
    JS_SetPropertyStr(ctx,re2d,"worldCreate",JS_NewCFunction(ctx,world_create,"worldCreate",2));
    JS_SetPropertyStr(ctx, re2d, "view", JS_NewCFunction(ctx, js_view, "view", 6));
    JS_SetPropertyStr(ctx, re2d, "project", JS_NewCFunction(ctx, js_project, "project", 2));
    JS_SetPropertyStr(ctx, re2d, "sprite", JS_NewCFunction(ctx, js_sprite, "sprite", 1));
    JS_SetPropertyStr(ctx, re2d, "unproject", JS_NewCFunction(ctx, js_unproject, "unproject", 3));
    JS_SetPropertyStr(ctx, re2d, "mesh", JS_NewCFunction(ctx, js_mesh, "mesh", 4));
    JS_SetPropertyStr(ctx, re2d, "info", JS_NewCFunction(ctx, js_info, "info", 0));
    JS_SetPropertyStr(ctx, re2d, "CULL_BACK", JS_NewInt32(ctx, R2D_RE2D_CULL_BACK));
    JS_SetPropertyStr(ctx, re2d, "NO_SPLIT", JS_NewInt32(ctx, R2D_RE2D_NO_SPLIT));
    JS_SetPropertyStr(ctx, engine, "re2d", re2d);
    return 0;
}
