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
#include "re2d_world_gpu.h"
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
static void world_dispose(WorldHandle *w)
{
    if(!w || w->disposed)return;
    if(w->registered){WorldHandle **entry=&world_registry;while(*entry&&*entry!=w)entry=&(*entry)->next;if(*entry==w)*entry=w->next;w->registered=false;}
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
    set_num(ctx,o,"reloadCount",w->reload_count);JS_SetPropertyStr(ctx,o,"reloadError",JS_NewString(ctx,w->reload_error));
    JS_SetPropertyStr(ctx,o,"backend",JS_NewString(ctx,w->gpu_enabled?"gpu-reference":"cpu-reference"));set_num(ctx,o,"gpuDraws",w->gpu_draws);
    JS_SetPropertyStr(ctx,o,"gpuWait",JS_NewBool(ctx,w->gpu_wait));
    JS_SetPropertyStr(ctx,o,"bakedLighting",JS_NewBool(ctx,w->world.baked_lighting));
    JS_SetPropertyStr(ctx,o,"bakedTopology",JS_NewBool(ctx,w->world.baked_topology));
    set_num(ctx,o,"posesUpdated",w->poses_updated);set_num(ctx,o,"posesDeferred",w->poses_deferred);set_num(ctx,o,"poseBudget",w->pose_budget);set_num(ctx,o,"poseStep",w->pose_step);
    set_num(ctx,o,"frameMs",w->frame_ms);set_num(ctx,o,"visibilityMs",w->visibility_ms);set_num(ctx,o,"lightCullMs",w->light_cull_ms);set_num(ctx,o,"surfaceMs",w->surface_ms);set_num(ctx,o,"actorMs",w->actor_ms);set_num(ctx,o,"compositionMs",w->composition_ms);set_num(ctx,o,"uploadMs",w->upload_ms);
    set_num(ctx,o,"lightsAfterCull",w->visible_lights);set_num(ctx,o,"shadowedLights",w->shadowed_lights);
    set_num(ctx,o,"actors",w->actor_count);set_num(ctx,o,"actorCandidates",w->frame_count);set_num(ctx,o,"composedActors",w->visible_actor_count);
    set_num(ctx,o,"materials",w->world.material_count);
    set_num(ctx,o,"lights",w->world.light_count);set_num(ctx,o,"lightSpanPairs",w->world.light_pairs);set_num(ctx,o,"lightOverflow",w->world.light_overflow);
    set_num(ctx,o,"visibleCells",w->visibility.cells_visible);set_num(ctx,o,"visibleSpans",w->visibility.span_count);set_num(ctx,o,"visibleSurfaces",w->visibility.surface_count);set_num(ctx,o,"portalsTested",w->visibility.portals_tested);set_num(ctx,o,"bspNodesVisited",w->visibility.bsp_nodes_visited);
    set_num(ctx,o,"cells",w->world.cell_count);set_num(ctx,o,"portals",w->world.portal_count);set_num(ctx,o,"surfaces",w->world.surface_count);
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
static JSValue world_audio_info(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
    WorldHandle *w=world_get(ctx,self);int token,c;if(!w||!world_token(ctx,argc,argv,&token))return JS_EXCEPTION;
    R2DWorldAudioSource *s=world_audio_source(ctx,w,token,&c);if(!s)return JS_EXCEPTION;
    JSValue o=JS_NewObject(ctx);set_num(ctx,o,"channel",c);set_num(ctx,o,"x",s->x);set_num(ctx,o,"y",s->y);set_num(ctx,o,"h",s->h);set_num(ctx,o,"distance",s->distance);set_num(ctx,o,"gain",s->gain);set_num(ctx,o,"currentGain",s->current_gain);set_num(ctx,o,"cutoff",s->cutoff);
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
    if(p[0]<0||p[0]>4096||floorf(p[0])!=p[0]||p[1]<0||p[1]>45)return JS_ThrowRangeError(ctx,"Re2D World: poseBudget 0..4096, poseStep 0..45");w->pose_budget=(int)p[0];w->pose_step=p[1];return JS_UNDEFINED;
}
static JSValue world_debug_view(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    WorldHandle *w=world_get(ctx,self);float mode;if(!w||!world_numbers(ctx,argc,argv,1,&mode))return JS_EXCEPTION;
    if(mode<0||mode>R2D_WORLD_DEBUG_OVERDRAW||mode!=floorf(mode))return JS_ThrowRangeError(ctx,"Re2D World: unsupported debug view");w->debug_view=(int)mode;return JS_UNDEFINED;
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
    WorldHandle *w=world_get(ctx,self);float p[6];if(!w||argc<7||!JS_IsString(argv[1]))return JS_ThrowTypeError(ctx,"Re2D World: decal(surface,material,u,v,width,height,life)");
    if(!world_numbers(ctx,1,argv,1,p)||!world_numbers(ctx,argc-2,argv+2,5,p+1))return JS_EXCEPTION;
    if(p[0]!=floorf(p[0]))return JS_ThrowRangeError(ctx,"Re2D World: decal surface must be an integer");
    const char *name=JS_ToCString(ctx,argv[1]);if(!name)return JS_EXCEPTION;int material=r2d_world_material_find(&w->world,name);JS_FreeCString(ctx,name);
    R2DWorldDecal decal={.surface=(int)p[0],.material=material,.u=p[1],.v=p[2],.w=p[3],.h=p[4],.remaining=p[5]};int token=r2d_world_decal_create(&w->world,&decal);
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
    for(WorldHandle *w=world_registry;w;w=w->next)if(w->runtime==JS_GetRuntime(ctx)){r2d_world_light_step(&w->world,dt);r2d_world_decal_step(&w->world,dt);world_watch_poll(ctx,w,dt);}return JS_UNDEFINED;
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
    JS_SetPropertyStr(ctx,handle,"dispose",JS_NewCFunction(ctx,world_release,"dispose",0));
    JS_SetPropertyStr(ctx,handle,"cellAt",JS_NewCFunction(ctx,world_cell_query,"cellAt",2));
    JS_SetPropertyStr(ctx,handle,"spanAt",JS_NewCFunction(ctx,world_span_query,"spanAt",3));
    JS_SetPropertyStr(ctx,handle,"surface",JS_NewCFunction(ctx,world_surface_query,"surface",1));
    JS_SetPropertyStr(ctx,handle,"portalClosed",JS_NewCFunction(ctx,world_portal_closed,"portalClosed",2));
    JS_SetPropertyStr(ctx,handle,"lighting",JS_NewCFunction(ctx,world_lighting_config,"lighting",6));
    JS_SetPropertyStr(ctx,handle,"spanLight",JS_NewCFunction(ctx,world_span_light,"spanLight",1));
    JS_SetPropertyStr(ctx,handle,"spanHeight",JS_NewCFunction(ctx,world_span_height,"spanHeight",3));
    JS_SetPropertyStr(ctx,handle,"lightCreate",JS_NewCFunction(ctx,world_light_new,"lightCreate",9));
    JS_SetPropertyStr(ctx,handle,"lightUpdate",JS_NewCFunction(ctx,world_light_set,"lightUpdate",10));
    JS_SetPropertyStr(ctx,handle,"lightRemove",JS_NewCFunction(ctx,world_light_delete,"lightRemove",1));
    JS_SetPropertyStr(ctx,handle,"lightInfo",JS_NewCFunction(ctx,world_light_info,"lightInfo",1));
    JS_SetPropertyStr(ctx,handle,"audioAdd",JS_NewCFunction(ctx,world_audio_add,"audioAdd",8));
    JS_SetPropertyStr(ctx,handle,"audioUpdate",JS_NewCFunction(ctx,world_audio_update,"audioUpdate",7));
    JS_SetPropertyStr(ctx,handle,"audioInfo",JS_NewCFunction(ctx,world_audio_info,"audioInfo",1));
    JS_SetPropertyStr(ctx,handle,"audioRemove",JS_NewCFunction(ctx,world_audio_remove,"audioRemove",1));
    JS_SetPropertyStr(ctx,handle,"actorAdd",JS_NewCFunction(ctx,world_actor_add,"actorAdd",1));
    JS_SetPropertyStr(ctx,handle,"actorRemove",JS_NewCFunction(ctx,world_actor_remove,"actorRemove",1));
    JS_SetPropertyStr(ctx,handle,"camera",JS_NewCFunction(ctx,world_camera,"camera",8));
    JS_SetPropertyStr(ctx,handle,"frameRegistered",JS_NewCFunction(ctx,world_registered_frame,"frameRegistered",2));
    JS_SetPropertyStr(ctx,handle,"debugView",JS_NewCFunction(ctx,world_debug_view,"debugView",1));
    JS_SetPropertyStr(ctx,handle,"backend",JS_NewCFunction(ctx,world_backend,"backend",1));
    JS_SetPropertyStr(ctx,handle,"gpuWait",JS_NewCFunction(ctx,world_gpu_wait,"gpuWait",1));
    JS_SetPropertyStr(ctx,handle,"quality",JS_NewCFunction(ctx,world_quality,"quality",2));
    JS_SetPropertyStr(ctx,handle,"visibility",JS_NewCFunction(ctx,world_debug_visibility,"visibility",0));
    JS_SetPropertyStr(ctx,handle,"material",JS_NewCFunction(ctx,world_material_set,"material",7));
    JS_SetPropertyStr(ctx,handle,"watch",JS_NewCFunction(ctx,world_watch,"watch",1));
    JS_SetPropertyStr(ctx,handle,"reloadJSON",JS_NewCFunction(ctx,world_reload,"reloadJSON",1));
    JS_SetPropertyStr(ctx,handle,"decal",JS_NewCFunction(ctx,world_decal_new,"decal",7));
    JS_SetPropertyStr(ctx,handle,"decalRemove",JS_NewCFunction(ctx,world_decal_remove,"decalRemove",1));
    JS_SetPropertyStr(ctx,handle,"surfaceSky",JS_NewCFunction(ctx,world_surface_sky,"surfaceSky",2));
    JS_SetPropertyStr(ctx,handle,"sky",JS_NewCFunction(ctx,world_sky_set,"sky",4));
    JS_SetPropertyStr(ctx,handle,"surfaceMaterial",JS_NewCFunction(ctx,world_surface_material_set,"surfaceMaterial",2));
    JS_SetPropertyStr(ctx,handle,"lightVisual",JS_NewCFunction(ctx,world_light_visual_config,"lightVisual",6));
    JS_SetPropertyStr(ctx,handle,"lightAt",JS_NewCFunction(ctx,world_light_at,"lightAt",3));
    return handle;
}
static JSValue world_reload_apply(JSContext *ctx,WorldHandle *w,const char *text)
{
    R2DRe2dWorld next={0};char error[256];bool ok=r2d_world_load_json(&next,text,error,sizeof error);
    if(!ok)return JS_ThrowTypeError(ctx,"%s",error);
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
    r2d_world_gpu_free(w);r2d_world_visibility_free(&w->visibility);w->world=next;r2d_world_free(&old);
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
static JSValue world_load(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv)
{
    (void)self;R2DScript *script=JS_GetContextOpaque(ctx);
    if(!script||!script->renderer||argc<1||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"Re2D World: load expects JSON text");
    const char *text=JS_ToCString(ctx,argv[0]);if(!text)return JS_EXCEPTION;
    WorldHandle *w=calloc(1,sizeof *w);if(!w){JS_FreeCString(ctx,text);return JS_ThrowOutOfMemory(ctx);}
    w->renderer=script->renderer;w->runtime=JS_GetRuntime(ctx);w->texture=w->sprite=-1;
    r2d_re2d_view_set(&w->view,0,0,48,0,0,1.2f,320,180);char error[256];
    bool ok=r2d_world_load_json(&w->world,text,error,sizeof error);JS_FreeCString(ctx,text);
    if(!ok){world_dispose(w);free(w);return JS_ThrowTypeError(ctx,"%s",error);}
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
    w->renderer=script->renderer;w->runtime=JS_GetRuntime(ctx);w->texture=w->sprite=-1;
    r2d_re2d_view_set(&w->view,0,0,48,0,0,1.2f,320,180);
    for(size_t i=0;i<nw/9;i++) {float *p=walls+i*9;ww[i]=(R2DWorldWall){p[0],p[1],p[2],p[3],p[4],p[5],world_rgb(p+6)};}
    for(size_t i=0;i<ns/12;i++) {float *p=spans+i*12;ss[i]=(R2DWorldSpan){p[0],p[1],p[2],p[3],p[4],p[5],world_rgb(p+6),world_rgb(p+9),0,0,0,0};}
    bool built=r2d_world_build(&w->world,ww,(int)(nw/9),ss,(int)(ns/12));
    free(ww);free(ss);JS_FreeValue(ctx,a);JS_FreeValue(ctx,b);
    if(!built) {world_dispose(w);free(w);return JS_ThrowRangeError(ctx,"World.create: неверная геометрия, пересечение spans или нехватка памяти");}
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
