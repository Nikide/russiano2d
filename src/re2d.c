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
#include "rotsprite.h"
#include "script.h"

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
typedef struct {
    R2DRe2dWorld world;
    R2DRenderer *renderer;
    uint8_t *rgba;
    float *depth;
    int width,height,texture,sprite;
    bool disposed;
} WorldHandle;
static JSClassID world_class;
static void world_dispose(WorldHandle *w)
{
    if(!w || w->disposed) return;
    r2d_world_free(&w->world);
    if(w->texture>=0) r2d_texture_free(w->renderer,w->texture);
    free(w->rgba);free(w->depth);w->rgba=NULL;w->depth=NULL;
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
    if(!w) return JS_EXCEPTION;world_dispose(w);return JS_UNDEFINED;
}
static JSValue world_support(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float p[5];if(!w||!world_numbers(ctx,argc,argv,5,p)) return JS_EXCEPTION;
    if(p[3]<=0||p[4]<0) return JS_ThrowRangeError(ctx,"World.support: height>0, step>=0");
    int i=r2d_world_support(&w->world,p[0],p[1],p[2],p[3],p[4]);if(i<0) return JS_NULL;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"span",i);set_num(ctx,o,"height",w->world.spans[i].bottom);set_num(ctx,o,"ceiling",w->world.spans[i].top);return o;
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
static JSValue world_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)argc;(void)argv;WorldHandle *w=world_get(ctx,self);if(!w) return JS_EXCEPTION;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"walls",w->world.wall_count);set_num(ctx,o,"spans",w->world.span_count);
    set_num(ctx,o,"segments",w->world.bsp.segment_count);set_num(ctx,o,"width",w->width);set_num(ctx,o,"height",w->height);
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
        w->rgba=rgba;w->depth=depth;w->texture=texture;w->sprite=sprite;w->width=width;w->height=height;
    }
    ensure_view();
    if(!isfinite(g_view.x)||!isfinite(g_view.y)||!isfinite(g_view.eye)||
       !isfinite(g_view.cos_yaw)||!isfinite(g_view.sin_yaw)||
       !isfinite(g_view.cos_pitch)||!isfinite(g_view.sin_pitch)||
       !isfinite(g_view.focal)||g_view.focal<=0) {
        JS_ThrowRangeError(ctx,"World.frame: некорректная камера");goto fail;
    }
    for(uint32_t i=0;i<count;i++) {
        const float *p=positions+i*5;
        bool visible=r2d_world_sprite_visible(&g_view,width,height,p[0],p[1],p[2],p[3],p[4],(float)ortho_height);
        const uint8_t *pixels=r2d_rotsprite_pixels(ctx,handles[i],&sizes[i],visible);
        // Validate every handle, including culled ones. No JS executes after borrowing.
        if(!pixels) goto fail;
        images[i]=visible?pixels:NULL;
    }
    r2d_world_frame(&w->world,&g_view,width,height,w->rgba,w->depth,(float)ortho_height);
    for(uint32_t i=0;i<count;i++) {
        const float *p=positions+i*5;
        r2d_world_stamp(&g_view,width,height,w->rgba,w->depth,images[i],sizes[i],p[0],p[1],p[2],p[3],p[4],(float)ortho_height);
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
    w->renderer=script->renderer;w->texture=w->sprite=-1;
    for(size_t i=0;i<nw/9;i++) {float *p=walls+i*9;ww[i]=(R2DWorldWall){p[0],p[1],p[2],p[3],p[4],p[5],world_rgb(p+6)};}
    for(size_t i=0;i<ns/12;i++) {float *p=spans+i*12;ss[i]=(R2DWorldSpan){p[0],p[1],p[2],p[3],p[4],p[5],world_rgb(p+6),world_rgb(p+9)};}
    bool built=r2d_world_build(&w->world,ww,(int)(nw/9),ss,(int)(ns/12));
    free(ww);free(ss);JS_FreeValue(ctx,a);JS_FreeValue(ctx,b);
    if(!built) {world_dispose(w);free(w);return JS_ThrowRangeError(ctx,"World.create: неверная геометрия, пересечение spans или нехватка памяти");}
    JSValue handle=JS_NewObjectClass(ctx,world_class);if(JS_IsException(handle)) {world_dispose(w);free(w);return handle;}
    JS_SetOpaque(handle,w);
    JS_SetPropertyStr(ctx,handle,"support",JS_NewCFunction(ctx,world_support,"support",5));
    JS_SetPropertyStr(ctx,handle,"blocked",JS_NewCFunction(ctx,world_blocked,"blocked",5));
    JS_SetPropertyStr(ctx,handle,"ray",JS_NewCFunction(ctx,world_ray,"ray",6));
    JS_SetPropertyStr(ctx,handle,"frame",JS_NewCFunction(ctx,world_frame,"frame",4));
    JS_SetPropertyStr(ctx,handle,"info",JS_NewCFunction(ctx,world_info,"info",0));
    JS_SetPropertyStr(ctx,handle,"dispose",JS_NewCFunction(ctx,world_release,"dispose",0));
    return handle;
}

int r2d_re2d_install(JSContext *ctx, JSValue engine)
{
    world_class=0;
    JS_NewClassID(JS_GetRuntime(ctx),&world_class);
    JSClassDef def={.class_name="Re2DWorld",.finalizer=world_finalizer};
    if(JS_NewClass(JS_GetRuntime(ctx),world_class,&def)<0) return -1;
    JSValue re2d = JS_NewObject(ctx);
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
