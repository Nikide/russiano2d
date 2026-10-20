#include "sdk.h"
#include "sprite_mesh.h"
#include <SDL3/SDL.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Page {
    const char *name;
    char fallback_name[32];
    char path[2048];
    uint8_t *rgba;
    int width, height;
} Page;

static uint64_t hash_bytes(uint64_t h,const void*p,size_t n)
{ const uint8_t*b=p;for(size_t i=0;i<n;i++){h^=b[i];h*=1099511628211ull;}return h; }
static bool box(const R2dJson*v,R2DSpriteMeshRect*r)
{
    const R2dJson*b=r2d_json_get(v,"frame");if(!b)b=v;
    double x=r2d_json_num(r2d_json_get(b,"x"),NAN),y=r2d_json_num(r2d_json_get(b,"y"),NAN);
    double w=r2d_json_num(r2d_json_get(b,"w"),NAN),h=r2d_json_num(r2d_json_get(b,"h"),NAN);
    if(!isfinite(x)||!isfinite(y)||!isfinite(w)||!isfinite(h)||x<0||y<0||w<1||h<1||x>INT32_MAX||y>INT32_MAX||w>INT32_MAX||h>INT32_MAX)return false;
    *r=(R2DSpriteMeshRect){(int)x,(int)y,(int)w,(int)h};return x==r->x&&y==r->y&&w==r->w&&h==r->h;
}
static bool number_arg(const SdkArgs*a,const char*name,double fallback,double*out)
{const char*s=sdk_arg_value(a,name);if(!s){*out=fallback;return true;}char*end=NULL;double x=strtod(s,&end);if(end==s||*end||!isfinite(x))return false;*out=x;return true;}
static int report(const char*code,const char*asset,const char*message)
{SdkReport r;sdk_report_init(&r);sdk_diag(&r,SDK_ERROR,code,asset,NULL,NULL,"%s",message);R2dSb out;r2d_sb_init(&out);r2d_sb_puts(&out,"{\"ok\":false,");sdk_report_put_counts(&r,&out);r2d_sb_putc(&out,',');sdk_report_put(&r,&out);r2d_sb_putc(&out,'}');puts(out.data);r2d_sb_free(&out);sdk_report_free(&r);return 1;}
static void free_pages(Page*p,uint32_t n)
{if(p){for(uint32_t i=0;i<n;i++)sdk_image_free(p[i].rgba);free(p);}}
static const char *frame_name(const R2dJson *list,uint32_t i)
{if(list->type==R2D_JSON_OBJ)return list->keys[i];return r2d_json_str(r2d_json_get(list->items[i],"filename"),NULL);}
static int resolve_page(const R2dJson *frame,const Page *pages,uint32_t n)
{
    const R2dJson*p=r2d_json_get(frame,"page");if(!p)return 0;
    if(p->type==R2D_JSON_NUM){int i=(int)p->number;return i>=0&&(uint32_t)i<n?i:-1;}
    if(p->type==R2D_JSON_STR)for(uint32_t i=0;i<n;i++)if(pages[i].name&&strcmp(pages[i].name,p->string)==0)return (int)i;
    return -1;
}
static void frame_pivot(const R2dJson *root,const char *name,uint32_t i,
                        R2DSpriteMeshRect rect,float *px,float *py)
{
    *px=rect.w*.5f;*py=rect.h*.5f;
    const R2dJson*slices=r2d_json_get(r2d_json_get(root,"meta"),"slices");
    if(!slices||slices->type!=R2D_JSON_ARR||!name)return;
    for(int s=0;s<slices->count;s++){
        const R2dJson*slice=slices->items[s];const char*sn=r2d_json_str(r2d_json_get(slice,"name"),"");if(strcmp(sn,name))continue;
        const R2dJson*keys=r2d_json_get(slice,"keys");if(!keys||keys->type!=R2D_JSON_ARR)return;
        for(int k=0;k<keys->count;k++){
            const R2dJson*key=keys->items[k];const R2dJson*fr=r2d_json_get(key,"frame");
            if(fr&&(uint32_t)r2d_json_int(fr,-1)!=i)continue;
            const R2dJson*p=r2d_json_get(key,"pivot");double x=r2d_json_num(r2d_json_get(p,"x"),NAN),y=r2d_json_num(r2d_json_get(p,"y"),NAN);
            if(isfinite(x)&&isfinite(y)){*px=(float)x-rect.x;*py=(float)y-rect.y;}return;
        }
        return;
    }
}

int sdk_cmd_sprite_mesh_bake(const SdkArgs*a)
{
    const char*asset=sdk_arg_positional(a,0);
    if(!asset)return report("SDK_USAGE",NULL,"Использование: r2d sprite-mesh-bake <sprite.png|sprite.atlas.json> [--depth N --alpha-threshold N --units-per-pixel N --pivot-x N --pivot-y N --out cache] [--check]");
    double depth,threshold,upp,px,py;const bool pivot_override=sdk_arg_value(a,"--pivot-x")||sdk_arg_value(a,"--pivot-y");
    if(!number_arg(a,"--depth",.08,&depth)||!number_arg(a,"--alpha-threshold",16,&threshold)||!number_arg(a,"--units-per-pixel",1.0/32.0,&upp)||!number_arg(a,"--pivot-x",0,&px)||!number_arg(a,"--pivot-y",0,&py)||depth<0||depth>1||threshold<0||threshold>255||floor(threshold)!=threshold||upp<=0)
        return report("SDK_SPRITEMESH_SETTINGS",asset,"Параметры SpriteMesh вне диапазона");
    char atlas_dir[2048],cache_path[2048];const char*out=sdk_arg_value(a,"--out");
    if(out)snprintf(cache_path,sizeof cache_path,"%s",out);else snprintf(cache_path,sizeof cache_path,"%s.sprite-mesh.cache",asset);
    const bool is_atlas=sdk_ends_with(asset,".atlas.json");R2dJson*root=NULL;Page*pages=NULL;uint32_t page_count=1;
    R2DSpriteMeshFrameInput*inputs=NULL;uint32_t count=1;const R2dJson*list=NULL;
    if(is_atlas){SdkReport rep;sdk_report_init(&rep);root=sdk_load_json(asset,&rep);sdk_report_free(&rep);if(!root)return report("SDK_SPRITEMESH_ATLAS",asset,"Не удалось прочитать JSON атласа");
        list=r2d_json_get(root,"frames");if(!list||(list->type!=R2D_JSON_OBJ&&list->type!=R2D_JSON_ARR)||list->count<1||list->count>65535){r2d_json_free(root);return report("SDK_SPRITEMESH_FRAMES",asset,"Атлас должен содержать 1..65535 кадров");}count=(uint32_t)list->count;
        const R2dJson*meta=r2d_json_get(root,"meta");const R2dJson*page_list=r2d_json_get(meta,"pages");if(!page_list)page_list=r2d_json_get(root,"pages");
        if(page_list&&page_list->type==R2D_JSON_ARR&&page_list->count>0){if(page_list->count>256){r2d_json_free(root);return report("SDK_SPRITEMESH_PAGES",asset,"SpriteMesh поддерживает до 256 страниц атласа");}page_count=(uint32_t)page_list->count;}
        pages=calloc(page_count,sizeof *pages);inputs=calloc(count,sizeof *inputs);if(!pages||!inputs){free(pages);free(inputs);r2d_json_free(root);return report("SDK_OUT_OF_MEMORY",asset,"Недостаточно памяти для страниц/кадров атласа");}
        sdk_dirname(asset,atlas_dir,sizeof atlas_dir);
        for(uint32_t p=0;p<page_count;p++){
            const R2dJson*entry=page_list&&page_list->type==R2D_JSON_ARR&&page_list->count>0?page_list->items[p]:NULL;
            const char*image=entry? r2d_json_str(entry->type==R2D_JSON_STR?entry:r2d_json_get(entry,"image"),NULL)
                :r2d_json_str(r2d_json_get(meta,"image"),NULL);
            pages[p].name=entry&&entry->type==R2D_JSON_OBJ?r2d_json_str(r2d_json_get(entry,"name"),NULL):NULL;
            if(!pages[p].name){snprintf(pages[p].fallback_name,sizeof pages[p].fallback_name,"page%u",p);pages[p].name=pages[p].fallback_name;}
            if(!image){free_pages(pages,page_count);free(inputs);r2d_json_free(root);return report("SDK_SPRITEMESH_IMAGE",asset,"В атласе не задан image для страницы");}
            sdk_join(atlas_dir,image,pages[p].path,sizeof pages[p].path);
        }
        for(uint32_t i=0;i<count;i++){
            const R2dJson*f=list->items[i];if(!box(f,&inputs[i].rect)){free_pages(pages,page_count);free(inputs);r2d_json_free(root);return report("SDK_SPRITEMESH_FRAME",asset,"Кадр атласа имеет неверный прямоугольник");}
            int p=resolve_page(f,pages,page_count);if(p<0){free_pages(pages,page_count);free(inputs);r2d_json_free(root);return report("SDK_SPRITEMESH_PAGE",asset,"Кадр ссылается на неизвестную страницу атласа");}inputs[i].page=(uint32_t)p;
            frame_pivot(root,frame_name(list,i),i,inputs[i].rect,&inputs[i].pivot_x,&inputs[i].pivot_y);
            if(pivot_override){inputs[i].pivot_x=(float)px;inputs[i].pivot_y=(float)py;}
        }
    }else{
        pages=calloc(1,sizeof *pages);inputs=calloc(1,sizeof *inputs);if(!pages||!inputs){free(pages);free(inputs);return report("SDK_OUT_OF_MEMORY",asset,"Недостаточно памяти");}
        snprintf(pages[0].path,sizeof pages[0].path,"%s",asset);
    }
    uint64_t source=1469598103934665603ull;
    for(uint32_t p=0;p<page_count;p++){
        pages[p].rgba=sdk_image_load_rgba(pages[p].path,&pages[p].width,&pages[p].height);
        if(!pages[p].rgba){free_pages(pages,page_count);free(inputs);if(root)r2d_json_free(root);return report("SDK_SPRITEMESH_SOURCE",asset,"Не удалось загрузить PNG страницу Sprite/Atlas");}
        source=hash_bytes(source,&pages[p].width,sizeof pages[p].width);source=hash_bytes(source,&pages[p].height,sizeof pages[p].height);
        source=hash_bytes(source,pages[p].rgba,(size_t)pages[p].width*pages[p].height*4u);
    }
    if(!is_atlas){inputs[0].rect=(R2DSpriteMeshRect){0,0,pages[0].width,pages[0].height};inputs[0].pivot_x=pivot_override?(float)px:pages[0].width*.5f;inputs[0].pivot_y=pivot_override?(float)py:pages[0].height*.5f;}
    for(uint32_t i=0;i<count;i++)if(inputs[i].rect.x<0||inputs[i].rect.y<0||inputs[i].rect.w<=0||inputs[i].rect.h<=0||inputs[i].rect.x>pages[inputs[i].page].width-inputs[i].rect.w||inputs[i].rect.y>pages[inputs[i].page].height-inputs[i].rect.h){free_pages(pages,page_count);free(inputs);if(root)r2d_json_free(root);return report("SDK_SPRITEMESH_FRAME_BOUNDS",asset,"Прямоугольник кадра выходит за пределы своей PNG страницы");}
    R2DSpriteMeshDesc desc={(float)depth,(float)upp,0,0,(uint8_t)threshold};uint64_t layout=1469598103934665603ull,settings=1469598103934665603ull;
    for(uint32_t i=0;i<count;i++){layout=hash_bytes(layout,&inputs[i].rect.x,sizeof(int));layout=hash_bytes(layout,&inputs[i].rect.y,sizeof(int));layout=hash_bytes(layout,&inputs[i].rect.w,sizeof(int));layout=hash_bytes(layout,&inputs[i].rect.h,sizeof(int));layout=hash_bytes(layout,&inputs[i].pivot_x,sizeof(float));layout=hash_bytes(layout,&inputs[i].pivot_y,sizeof(float));layout=hash_bytes(layout,&inputs[i].page,sizeof(uint32_t));}
    settings=hash_bytes(settings,&desc.depth,sizeof desc.depth);settings=hash_bytes(settings,&desc.units_per_pixel,sizeof desc.units_per_pixel);settings=hash_bytes(settings,&desc.alpha_threshold,sizeof desc.alpha_threshold);
    if(sdk_arg_flag(a,"--check")){size_t old_size=0;char*old=sdk_read_file(cache_path,&old_size);R2DSpriteMeshCache previous={0};bool up=old&&r2d_sprite_mesh_cache_decode((const uint8_t*)old,old_size,&previous)&&r2d_sprite_mesh_cache_valid(&previous,source,layout,settings,count);if(old)free(old);if(previous.frames)r2d_sprite_mesh_cache_destroy(&previous);free_pages(pages,page_count);free(inputs);if(root)r2d_json_free(root);printf("{\"ok\":true,\"upToDate\":%s,\"frames\":%u,\"sourceHash\":%llu,\"layoutHash\":%llu,\"settingsHash\":%llu,\"diagnostics\":[]}\n",up?"true":"false",count,(unsigned long long)source,(unsigned long long)layout,(unsigned long long)settings);return 0;}
    R2DSpriteMeshCache cache={.source_hash=source,.layout_hash=layout,.settings_hash=settings,.depth=desc.depth,.units_per_pixel=desc.units_per_pixel,.alpha_threshold=desc.alpha_threshold,.frame_count=count};cache.frames=calloc(count,sizeof *cache.frames);
    if(!cache.frames){free_pages(pages,page_count);free(inputs);if(root)r2d_json_free(root);return report("SDK_OUT_OF_MEMORY",asset,"Недостаточно памяти для mesh кадров");}
    bool built=true;for(uint32_t i=0;i<count;i++){Page*p=&pages[inputs[i].page];R2DSpriteMeshDesc d=desc;d.pivot_x=inputs[i].pivot_x;d.pivot_y=inputs[i].pivot_y;if(!r2d_sprite_mesh_build(p->rgba,p->width,p->height,inputs[i].rect,&d,&cache.frames[i])){built=false;break;}cache.frames[i].page=inputs[i].page;}
    free_pages(pages,page_count);free(inputs);if(root)r2d_json_free(root);if(!built){r2d_sprite_mesh_cache_destroy(&cache);return report("SDK_SPRITEMESH_BUILD",asset,"Генерация mesh кадра завершилась ошибкой");}
    uint8_t*bytes=NULL;size_t size=0;if(!r2d_sprite_mesh_cache_encode(&cache,&bytes,&size)){r2d_sprite_mesh_cache_destroy(&cache);return report("SDK_SPRITEMESH_CACHE",asset,"Не удалось сериализовать cache");}
    char tmp[2100];snprintf(tmp,sizeof tmp,"%s.tmp",cache_path);bool ok=sdk_write_file(tmp,bytes,size)&&SDL_RenamePath(tmp,cache_path);free(bytes);if(!ok){SDL_RemovePath(tmp);r2d_sprite_mesh_cache_destroy(&cache);return report("SDK_SPRITEMESH_WRITE",cache_path,"Не удалось записать cache файл");}
    uint64_t verts=0,opaque=0;for(uint32_t i=0;i<count;i++){verts+=cache.frames[i].vertex_count;opaque+=cache.frames[i].opaque_pixels;}
    R2dSb response;r2d_sb_init(&response);r2d_sb_puts(&response,"{\"ok\":true,\"asset\":");r2d_sb_put_json_string(&response,asset);r2d_sb_puts(&response,",\"cache\":");r2d_sb_put_json_string(&response,cache_path);r2d_sb_printf(&response,",\"frames\":%u,\"pages\":%u,\"opaquePixels\":%llu,\"vertices\":%llu,\"triangles\":%llu,\"bytes\":%zu,\"sourceHash\":%llu,\"layoutHash\":%llu,\"settingsHash\":%llu,\"diagnostics\":[]}",count,page_count,(unsigned long long)opaque,(unsigned long long)verts,(unsigned long long)(verts/3u),size,(unsigned long long)source,(unsigned long long)layout,(unsigned long long)settings);puts(response.data);r2d_sb_free(&response);r2d_sprite_mesh_cache_destroy(&cache);return 0;
}
