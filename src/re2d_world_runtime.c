#include "re2d_world_runtime.h"
#include "re2d_world_atlas.h"
#include "re2d_world_exr.h"
#include "re2d_world_gpu.h"
#include "rotsprite.h"
#include "script.h"
#include "payload.h"
#include "json.h"
#include <SDL3_image/SDL_image.h>
#include <SDL3/SDL_timer.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#define ACTOR_LIMIT 4096
// P0/P1 visual features are native configuration, not per-frame JS work. A
// runtime starts with the medium preset; the pure feature module owns the
// validation/preset table, so the C tests and the renderer share one contract.
void r2d_world_render_init(R2DWorldRuntime *w)
{
    if(!w)return;
    r2d_world_render_defaults(&w->render_features);
    r2d_world_render_counters_reset(&w->render_counters);
    w->render_features_ready=true;
    w->render_time=0;
}
bool r2d_world_render_set_features(R2DWorldRuntime *w,const R2DWorldRenderFeatures *features)
{
    if(!w||!features||w->rendering)return false;
    R2DWorldRenderFeatures next=*features;
    if(!r2d_world_render_validate(&next))return false;
    w->render_features=next;w->render_features_ready=true;return true;
}
bool r2d_world_render_quality(R2DWorldRuntime *w,int quality)
{
    if(!w||w->rendering)return false;
    R2DWorldRenderFeatures next;
    if(!r2d_world_render_preset(quality,&next))return false;
    w->render_features=next;w->render_features_ready=true;return true;
}
const R2DWorldRenderFeatures *r2d_world_render_features(const R2DWorldRuntime *w)
{
    return w&&w->render_features_ready?&w->render_features:NULL;
}
void r2d_world_render_advance(R2DWorldRuntime *w,float dt)
{
    if(!w||!isfinite(dt)||dt<=0)return;
    if(dt>0.25f)dt=0.25f;
    w->render_time+=dt;
    if(!(w->render_time<1e6f))w->render_time=0; // bounded phase, no precision cliff
}
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


// --- Task-15: true per-region payload residency -----------------------------
// The caller-owned copies are small index packets derived from the master world
// (cells/walls/spans/surfaces/materials/nav). Unloading frees the copy; all
// gameplay/visibility/render queries keep using the master arrays as a safe
// fallback, so an unloaded region can never leave a dangling pointer.
static void runtime_stream_io_evict(void *user,int region,int kind,void *payload,uint64_t bytes)
{
    (void)user;(void)region;(void)kind;(void)bytes;
    free(payload);
}

static void *runtime_stream_io_alloc(void *user,int region,int kind,uint64_t bytes)
{
    (void)user;(void)region;(void)kind;
    return bytes ? malloc((size_t)bytes) : NULL;
}

static void runtime_stream_io_dispose(R2DWorldRuntime *w)
{
    if(!w)return;
    for(int i=0;i<w->stream_io.count;i++){
        free(w->stream_io.payloads[i].payload);
        free((void *)w->stream_io.payloads[i].source);
    }
    r2d_world_stream_io_free(&w->stream_io);
    w->stream_io_ready=false;
    free(w->stream_io_required);w->stream_io_required=NULL;
    w->stream_io_required_capacity=0;
    memset(&w->stream_io_stats,0,sizeof w->stream_io_stats);
    memset(&w->stream_io_budget,0,sizeof w->stream_io_budget);
    w->stream_io_loads_total=w->stream_io_unloads_total=w->stream_io_bytes_total=0;
    w->stream_io_peak_tick_bytes=0;
}

static int runtime_stream_io_packet(R2DWorldRuntime *w,int region,int kind,int count)
{
    const uint64_t bytes=(uint64_t)count*sizeof(int);
    int *source=bytes?(int *)malloc((size_t)bytes):NULL;
    int *payload=bytes?(int *)calloc((size_t)count,sizeof(int)):NULL;
    if(bytes&&(!source||!payload)){free(source);free(payload);return -1;}
    const int priority=kind==R2D_STREAM_IO_CELLS?30:
        kind==R2D_STREAM_IO_SPANS?25:kind==R2D_STREAM_IO_SURFACES?20:10;
    const int slot=r2d_world_stream_io_add(&w->stream_io,region,kind,bytes,payload,
                                           source,priority);
    if(slot<0){free(source);free(payload);return -1;}
    return slot;
}

static bool runtime_stream_io_build(R2DWorldRuntime *w)
{
    R2DWorldRegionSet *set=&w->regions;
    const int regions=set->region_count;
    int capacity=regions*6;if(capacity<1)capacity=1;
    if(!r2d_world_stream_io_init(&w->stream_io,capacity))return false;
    r2d_world_stream_io_set_callbacks(&w->stream_io,NULL,NULL,runtime_stream_io_evict,NULL);
    r2d_world_stream_io_set_allocator(&w->stream_io,runtime_stream_io_alloc,NULL);
    const int wall_total=w->world.wall_count;
    int *wall_mark=(int *)calloc((size_t)(wall_total>0?wall_total:1),sizeof(int));
    int *material_mark=(int *)calloc(R2D_WORLD_MAX_MATERIALS,sizeof(int));
    if(!wall_mark||!material_mark){free(wall_mark);free(material_mark);runtime_stream_io_dispose(w);return false;}
    int generation=0;
    bool ok=true;
    for(int r=0;r<regions&&ok;r++){
        const R2DWorldRegion *region=&set->regions[r];
        int span_count=0,wall_count=0,material_count=0;
        for(int k=0;k<region->cell_count;k++){
            const int cell=set->region_cells[region->first_cell+k];
            if(cell<0||cell>=w->world.cell_count){ok=false;break;}
            span_count+=w->world.cells[cell].span_count;
        }
        if(!ok)break;
        // Cells packet.
        int slot=runtime_stream_io_packet(w,r,R2D_STREAM_IO_CELLS,region->cell_count);
        if(slot<0){ok=false;break;}
        int *values=(int *)w->stream_io.payloads[slot].source;
        for(int k=0;k<region->cell_count;k++)values[k]=set->region_cells[region->first_cell+k];
        // Spans packet.
        slot=runtime_stream_io_packet(w,r,R2D_STREAM_IO_SPANS,span_count);
        if(slot<0){ok=false;break;}
        values=(int *)w->stream_io.payloads[slot].source;
        int cursor=0;
        for(int k=0;k<region->cell_count;k++){
            const int cell=set->region_cells[region->first_cell+k];
            const R2DWorldCell *world_cell=&w->world.cells[cell];
            for(int j=0;j<world_cell->span_count;j++)values[cursor++]=world_cell->first_span+j;
        }
        // Walls packet: unique incident walls over the region's spans.
        generation++;
        for(int k=0;k<span_count;k++){
            const int span=values[k];
            for(int q=w->world.span_wall_offsets[span];q<w->world.span_wall_offsets[span+1];q++){
                const int wall=w->world.span_wall_refs[q];
                if(wall<0||wall>=wall_total||wall_mark[wall]==generation)continue;
                wall_mark[wall]=generation;wall_count++;
            }
        }
        slot=runtime_stream_io_packet(w,r,R2D_STREAM_IO_WALLS,wall_count);
        if(slot<0){ok=false;break;}
        int *wall_values=(int *)w->stream_io.payloads[slot].source;
        generation++;cursor=0;
        for(int k=0;k<span_count;k++){
            const int span=values[k];
            for(int q=w->world.span_wall_offsets[span];q<w->world.span_wall_offsets[span+1];q++){
                const int wall=w->world.span_wall_refs[q];
                if(wall<0||wall>=wall_total||wall_mark[wall]==generation)continue;
                wall_mark[wall]=generation;wall_values[cursor++]=wall;
            }
        }
        // Surfaces packet: wall surface ids + floor/ceiling surface ids.
        const int surface_count=wall_count+span_count*2;
        slot=runtime_stream_io_packet(w,r,R2D_STREAM_IO_SURFACES,surface_count);
        if(slot<0){ok=false;break;}
        int *surface_values=(int *)w->stream_io.payloads[slot].source;
        cursor=0;
        for(int k=0;k<wall_count;k++)surface_values[cursor++]=wall_values[k];
        for(int k=0;k<span_count;k++){
            surface_values[cursor++]=w->world.wall_count+values[k]*2;
            surface_values[cursor++]=w->world.wall_count+values[k]*2+1;
        }
        // Materials packet: unique material ids referenced by region surfaces.
        generation++;
        if(w->world.surface_materials){
            for(int k=0;k<surface_count;k++){
                const int surface=surface_values[k];
                if(surface<0||surface>=w->world.surface_count)continue;
                const int material=w->world.surface_materials[surface];
                if(material<0||material>=R2D_WORLD_MAX_MATERIALS||material_mark[material]==generation)continue;
                material_mark[material]=generation;material_count++;
            }
        }
        slot=runtime_stream_io_packet(w,r,R2D_STREAM_IO_MATERIALS,material_count);
        if(slot<0){ok=false;break;}
        int *material_values=(int *)w->stream_io.payloads[slot].source;
        generation++;cursor=0;
        if(w->world.surface_materials){
            for(int k=0;k<surface_count;k++){
                const int surface=surface_values[k];
                if(surface<0||surface>=w->world.surface_count)continue;
                const int material=w->world.surface_materials[surface];
                if(material<0||material>=R2D_WORLD_MAX_MATERIALS||material_mark[material]==generation)continue;
                material_mark[material]=generation;material_values[cursor++]=material;
            }
        }
        // Nav packet: no authoring fragments yet; registered so residency/stats
        // stay uniform and a future nav split can extend it without API churn.
        if(runtime_stream_io_packet(w,r,R2D_STREAM_IO_NAV,0)<0){ok=false;break;}
    }
    free(wall_mark);free(material_mark);
    if(!ok){runtime_stream_io_dispose(w);return false;}
    w->stream_io_required=(uint8_t *)calloc((size_t)regions,1);
    if(!w->stream_io_required){runtime_stream_io_dispose(w);return false;}
    w->stream_io_required_capacity=regions;
    w->stream_io_budget.load_budget_bytes=64u*1024u;
    w->stream_io_budget.unload_budget_bytes=64u*1024u;
    w->stream_io_budget.load_budget_items=8;
    w->stream_io_budget.unload_budget_items=8;
    w->stream_io_ready=true;
    return true;
}

void r2d_world_regions_free(R2DWorldRuntime *w)
{
    if(!w)return;
    runtime_stream_io_dispose(w);
    R2DWorldRegionSet *r=&w->regions;
    free(r->regions);free(r->cell_region);free(r->region_cells);
    free(r->region_portal_offsets);free(r->region_portal_refs);
    free(r->region_adj_offsets);free(r->region_adj_refs);free(r->pvs);
    memset(r,0,sizeof *r);
    free(w->region_states);free(w->region_active);free(w->region_preload);
    w->region_states=NULL;w->region_active=w->region_preload=NULL;
    r2d_world_region_clusters_free(&w->clusters);
    w->cluster_ready=false;w->cluster_camera=-1;
    free(w->region_portals);w->region_portals=NULL;w->region_portal_capacity=0;
    free(w->occluders);w->occluders=NULL;w->occluder_count=w->occluder_capacity=0;
    free(w->region_visible);w->region_visible=NULL;w->region_visible_capacity=0;
    free(w->cell_allowed);w->cell_allowed=NULL;w->cell_allowed_capacity=0;
    w->region_visible_count=w->region_pvs_culled=w->region_occluder_culled=0;
    w->region_cluster_culled=w->region_cells_allowed=w->region_cells_culled=0;
    w->region_pvs_revision=w->occluder_revision=0;
    r2d_world_stream_free(&w->stream);w->stream_ready=false;w->stream_asset_revision=0;
    w->stream_total_uploads=w->stream_total_upload_bytes=w->stream_total_evictions=0;
    r2d_world_impostors_free(&w->impostors);w->impostor_ready=false;
    free(w->visible_impostors);w->visible_impostors=NULL;
    w->visible_impostor_count=w->visible_impostor_capacity=0;
    w->region_active_count=w->region_preload_count=0;w->region_current=-1;
    w->render_origin_region=-1;w->render_origin_x=w->render_origin_y=0;
    w->gpu_stream_uploads=w->gpu_stream_upload_bytes=w->gpu_stream_evictions=w->gpu_stream_transitions=0;
    w->gpu_textures_resident=w->gpu_atlases_resident=0;
    w->gpu_lod_culled_lights=w->gpu_lod_culled_decals=w->gpu_sprite_dir_reduced=0;
    w->gpu_impostors_drawn=0;w->gpu_render_origin_active=false;
    w->gpu_render_origin_x=w->gpu_render_origin_y=0;
    w->hint_wall_count=w->skip_wall_count=w->occluder_wall_count=0;
    w->region_ready=false;
}

bool r2d_world_regions_ensure(R2DWorldRuntime *w)
{
    if(!w)return false;
    if(w->region_ready&&w->regions.cell_count==w->world.cell_count&&w->regions.portal_count==w->world.portal_count)return true;
    r2d_world_regions_free(w);
    const int nc=w->world.cell_count,np=w->world.portal_count,ns=w->world.span_count;
    if(nc<=0)return false;
    R2DWorldRegionCell *cells=(R2DWorldRegionCell *)calloc((size_t)nc,sizeof *cells);
    R2DWorldRegionPortal *portals=(R2DWorldRegionPortal *)calloc((size_t)(np?np:1),sizeof *portals);
    if(!cells||!portals){free(cells);free(portals);return false;}
    float minx=INFINITY,miny=INFINITY,maxx=-INFINITY,maxy=-INFINITY;
    for(int i=0;i<nc;i++){
        const R2DWorldCell *c=&w->world.cells[i];
        cells[i]=(R2DWorldRegionCell){(float)c->x,(float)c->y,(float)c->w,(float)c->h};
        if(c->x<minx)minx=(float)c->x;if(c->y<miny)miny=(float)c->y;
        if(c->x+c->w>maxx)maxx=(float)(c->x+c->w);if(c->y+c->h>maxy)maxy=(float)(c->y+c->h);
    }
    for(int i=0;i<np;i++){
        const R2DWorldPortal *p=&w->world.portals[i];
        portals[i]=(R2DWorldRegionPortal){p->cell_a,p->cell_b,p->closed,p->area_portal};
    }
    // Compiler --region-size metadata wins; 512 is the deterministic fallback.
    float size=(isfinite(w->region_size_hint)&&w->region_size_hint>=16.0f&&w->region_size_hint<=1048576.0f)
               ?w->region_size_hint:512.0f;
    while(((int)ceilf((maxx-minx)/size)+2)*((int)ceilf((maxy-miny)/size)+2)>R2D_WORLD_REGION_MAX_GRID&&size<1048576.0f)size*=2.0f;
    R2DWorldRegionSet sizing;memset(&sizing,0,sizeof sizing);
    char error[160]={0};
    int regions=r2d_world_region_build(cells,nc,portals,np,size,&sizing,error,sizeof error);
    if(regions<=0){free(cells);free(portals);return false;}
    R2DWorldRegionSet *r=&w->regions;
    r->regions=(R2DWorldRegion *)calloc((size_t)regions,sizeof *r->regions);
    r->cell_region=(int *)calloc((size_t)nc,sizeof *r->cell_region);
    r->region_cells=(int *)calloc((size_t)nc,sizeof *r->region_cells);
    r->region_portal_offsets=(int *)calloc((size_t)(regions+1),sizeof *r->region_portal_offsets);
    r->region_portal_refs=(int *)calloc((size_t)(np?np*2:1),sizeof *r->region_portal_refs);
    r->region_adj_offsets=(int *)calloc((size_t)(regions+1),sizeof *r->region_adj_offsets);
    r->region_adj_refs=(int *)calloc((size_t)(np?np*2:1),sizeof *r->region_adj_refs);
    r->pvs=(uint64_t *)calloc((size_t)regions*sizing.pvs_words,sizeof *r->pvs);
    r->region_capacity=regions;r->cell_region_capacity=nc;r->region_cells_capacity=nc;
    r->region_portal_offsets_capacity=regions+1;r->region_portal_refs_capacity=np*2;
    r->region_adj_offsets_capacity=regions+1;r->region_adj_refs_capacity=np*2;
    r->pvs_capacity=regions*sizing.pvs_words;r->pvs_words=sizing.pvs_words;
    bool ok=r->regions&&r->cell_region&&r->region_cells&&r->region_portal_offsets&&r->region_portal_refs&&r->region_adj_offsets&&r->region_adj_refs&&r->pvs;
    if(ok)ok=r2d_world_region_build(cells,nc,portals,np,size,r,error,sizeof error)==regions;
    if(!ok){free(cells);free(portals);r2d_world_regions_free(w);return false;}

    // Keep a portal snapshot for PVS rebuilds after door/areaportal changes.
    w->region_portals=(R2DWorldRegionPortal *)calloc((size_t)(np?np:1),sizeof *w->region_portals);
    if(!w->region_portals){free(cells);free(portals);r2d_world_regions_free(w);return false;}
    if(np)memcpy(w->region_portals,portals,(size_t)np*sizeof *portals);
    w->region_portal_capacity=np;

    // Vis clusters: bounded grouping of cells inside each region.
    int cells_per_cluster=w->region_cluster_cells>0?w->region_cluster_cells:4;
    if(cells_per_cluster>R2D_WORLD_REGION_MAX_CLUSTER_CELLS)cells_per_cluster=R2D_WORLD_REGION_MAX_CLUSTER_CELLS;
    R2DWorldClusterSet cluster_sizing;memset(&cluster_sizing,0,sizeof cluster_sizing);
    int cluster_count=r2d_world_region_clusters_build(r,cells_per_cluster,portals,np,&cluster_sizing,error,sizeof error);
    if(cluster_count>0){
        R2DWorldClusterSet *c=&w->clusters;
        c->clusters=(R2DWorldCluster *)calloc((size_t)cluster_count,sizeof *c->clusters);
        c->cell_cluster=(int *)calloc((size_t)nc,sizeof *c->cell_cluster);
        c->cluster_cells=(int *)calloc((size_t)nc,sizeof *c->cluster_cells);
        c->cluster_portal_offsets=(int *)calloc((size_t)(cluster_count+1),sizeof *c->cluster_portal_offsets);
        c->cluster_portal_refs=(int *)calloc((size_t)(np?np*2:1),sizeof *c->cluster_portal_refs);
        c->pvs=(uint64_t *)calloc((size_t)cluster_count*cluster_sizing.pvs_words,sizeof *c->pvs);
        c->cluster_capacity=cluster_count;c->cell_cluster_capacity=nc;c->cluster_cells_capacity=nc;
        c->cluster_portal_offsets_capacity=cluster_count+1;c->cluster_portal_refs_capacity=np*2;
        c->pvs_capacity=cluster_count*cluster_sizing.pvs_words;c->pvs_words=cluster_sizing.pvs_words;
        c->cells_per_cluster=cells_per_cluster;
        bool cok=c->clusters&&c->cell_cluster&&c->cluster_cells&&c->cluster_portal_offsets&&c->cluster_portal_refs&&c->pvs;
        if(cok)cok=r2d_world_region_clusters_build(r,cells_per_cluster,portals,np,c,error,sizeof error)==cluster_count;
        w->cluster_ready=cok;
        if(!cok){free(cells);free(portals);r2d_world_regions_free(w);return false;}
    }

    // Compiler occluder wall chains, kept as 2D segments for the coarse pass.
    int occluder_count=0;
    w->hint_wall_count=w->skip_wall_count=w->occluder_wall_count=0;
    for(int i=0;i<w->world.wall_count;i++){
        const uint16_t bits=r2d_world_wall_bits(&w->world.walls[i]);
        if(bits&R2D_WALL_OCCLUDER){occluder_count++;w->occluder_wall_count++;}
        if(bits&R2D_WALL_TOOL_HINT)w->hint_wall_count++;
        if(bits&R2D_WALL_TOOL_SKIP)w->skip_wall_count++;
    }
    w->occluders=(R2DWorldOccluder *)calloc((size_t)(occluder_count?occluder_count:1),sizeof *w->occluders);
    if(!w->occluders){free(cells);free(portals);r2d_world_regions_free(w);return false;}
    w->occluder_capacity=occluder_count?occluder_count:1;
    w->occluder_count=0;
    for(int i=0;i<w->world.wall_count;i++){
        const R2DWorldWall *wall=&w->world.walls[i];
        if(!(r2d_world_wall_bits(wall)&R2D_WALL_OCCLUDER))continue;
        if(!isfinite(wall->x1)||!isfinite(wall->y1)||!isfinite(wall->x2)||!isfinite(wall->y2))continue;
        w->occluders[w->occluder_count++]=(R2DWorldOccluder){wall->x1,wall->y1,wall->x2,wall->y2};
    }

    // Distant region impostor descriptors (renderer consumes; no GPU here).
    R2DWorldImpostorSet impostor_sizing;memset(&impostor_sizing,0,sizeof impostor_sizing);
    int impostor_count=r2d_world_impostors_build(r,w->world.cells,nc,w->world.spans,ns,&impostor_sizing,error,sizeof error);
    if(impostor_count>0){
        w->impostors.items=(R2DWorldImpostor *)calloc((size_t)impostor_count,sizeof *w->impostors.items);
        w->impostors.count=impostor_count;w->impostors.capacity=impostor_count;
        bool iok=w->impostors.items!=NULL;
        if(iok)iok=r2d_world_impostors_build(r,w->world.cells,nc,w->world.spans,ns,&w->impostors,error,sizeof error)==impostor_count;
        w->impostor_ready=iok;
        if(!iok){free(cells);free(portals);r2d_world_regions_free(w);return false;}
    }

    w->region_visible=(uint8_t *)calloc((size_t)regions,1);
    w->cell_allowed=(uint8_t *)calloc((size_t)nc,1);
    int visible_capacity=impostor_count<64?impostor_count:64;
    if(visible_capacity<1)visible_capacity=1;
    w->visible_impostors=(R2DWorldImpostor *)calloc((size_t)visible_capacity,sizeof *w->visible_impostors);
    w->region_visible_capacity=regions;w->cell_allowed_capacity=nc;
    w->visible_impostor_capacity=visible_capacity;w->visible_impostor_count=0;
    if(!w->region_visible||!w->cell_allowed||!w->visible_impostors){free(cells);free(portals);r2d_world_regions_free(w);return false;}

    // Budgeted residency cache. Per-region BSP/surface payloads are registered;
    // material textures/atlases are merged by stream_sync_assets().
    int stream_capacity=regions*2+512+w->world.material_count;
    if(stream_capacity<1024)stream_capacity=1024;
    if(stream_capacity>R2D_WORLD_STREAM_MAX_ITEMS)stream_capacity=R2D_WORLD_STREAM_MAX_ITEMS;
    w->stream_ready=r2d_world_stream_init(&w->stream,stream_capacity);
    if(w->stream_ready){
        if(w->stream_budget.resident_budget_bytes==0)w->stream_budget.resident_budget_bytes=8u*1024u*1024u;
        if(w->stream_budget.upload_budget_bytes==0)w->stream_budget.upload_budget_bytes=512u*1024u;
        // Enough per-frame headroom to bring a region's payload set resident
        // without starving the first visible frame; deeper maps still bounded.
        if(w->stream_budget.promote_budget_items<=0)w->stream_budget.promote_budget_items=16;
        if(w->stream_budget.upload_budget_items<=0)w->stream_budget.upload_budget_items=16;
        if(w->stream_budget.max_resident_items<=0)w->stream_budget.max_resident_items=4096;
        for(int ri=0;ri<regions;ri++){
            const R2DWorldRegion *region=&r->regions[ri];
            uint64_t payload=64u+(uint64_t)region->cell_count*96u;
            r2d_world_stream_register(&w->stream,ri,R2D_STREAM_BSP,ri,payload,10);
            r2d_world_stream_register(&w->stream,ri,R2D_STREAM_SURFACES,ri,payload,8);
        }
    }
    if(w->region_active_radius<=0)w->region_active_radius=1;
    if(w->region_preload_radius<w->region_active_radius)w->region_preload_radius=2;
    if(w->lod_config.near_distance<=0&&w->lod_config.hidden_distance<=0)
        r2d_world_region_lod_defaults(&w->lod_config);

    w->region_states=(uint8_t *)calloc((size_t)regions,1);
    w->region_active=(int *)calloc((size_t)regions,sizeof *w->region_active);
    w->region_preload=(int *)calloc((size_t)regions,sizeof *w->region_preload);
    if(!w->region_states||!w->region_active||!w->region_preload){free(cells);free(portals);r2d_world_regions_free(w);return false;}
    free(cells);free(portals);
    w->region_pvs_revision=0;w->occluder_revision=0;
    if(!runtime_stream_io_build(w)){r2d_world_regions_free(w);return false;}
    w->region_ready=true;w->region_current=-1;
    return true;
}

const R2DWorldRegionSet *r2d_world_regions(const R2DWorldRuntime *w)
{
    return w&&w->region_ready?&w->regions:NULL;
}

float r2d_world_region_size_from_json(const char *text)
{
    if(!text)return 0;
    char error[128];
    R2dJson *root=r2d_json_parse(text,error,sizeof error);
    if(!root)return 0;
    float size=0;
    const R2dJson *compiler=r2d_json_get(root,"compiler");
    const R2dJson *grid=r2d_json_get(compiler?compiler:root,"regionGrid");
    if(grid&&grid->type==R2D_JSON_OBJ){
        const R2dJson *value=r2d_json_get(grid,"size");
        if(value&&value->type==R2D_JSON_NUM){
            double number=value->number;
            if(isfinite(number)&&number>=16.0&&number<=1048576.0)size=(float)number;
        }
    }
    r2d_json_free(root);
    return size;
}

bool r2d_world_region_config(R2DWorldRuntime *w,float region_size,int active_ring,
                             int preload_ring,uint64_t upload_budget_bytes,
                             int upload_items)
{
    if(!w||w->rendering)return false;
    if(!(region_size>=0.0f)||!isfinite(region_size)||
       (region_size>0.0f&&(region_size<16.0f||region_size>1048576.0f)))
        return false;
    if(active_ring<0||active_ring>R2D_WORLD_REGION_MAX_RING||
       preload_ring<active_ring||preload_ring>R2D_WORLD_REGION_MAX_RING)
        return false;
    if(upload_items<0)return false;
    const bool rebuild=region_size>0.0f&&
        (!(w->region_size_hint==region_size));
    w->region_size_hint=region_size>0.0f?region_size:0.0f;
    w->region_active_radius=active_ring;
    w->region_preload_radius=preload_ring;
    if(upload_budget_bytes>0)w->stream_budget.upload_budget_bytes=upload_budget_bytes;
    if(upload_items>0)w->stream_budget.upload_budget_items=upload_items;
    if(rebuild)r2d_world_regions_free(w);
    return true;
}

bool r2d_world_region_lod_config(R2DWorldRuntime *w,const R2DWorldRegionLodConfig *config)
{
    if(!w||!config||!r2d_world_region_lod_valid(config))return false;
    w->lod_config=*config;
    return true;
}

bool r2d_world_region_budget(R2DWorldRuntime *w,uint64_t resident_bytes,int max_resident_items)
{
    if(!w||w->rendering||max_resident_items<0)return false;
    w->stream_budget.resident_budget_bytes=resident_bytes;
    w->stream_budget.max_resident_items=max_resident_items;
    return true;
}

bool r2d_world_region_lod_bands(R2DWorldRuntime *w,float near_distance,float mid_distance,
                                float far_distance,float impostor_distance,float hidden_distance)
{
    if(!w||w->rendering)return false;
    R2DWorldRegionLodConfig config;
    r2d_world_region_lod_defaults(&config);
    config.near_distance=near_distance;
    config.mid_distance=mid_distance;
    config.far_distance=far_distance;
    config.impostor_distance=impostor_distance;
    config.hidden_distance=hidden_distance;
    if(!r2d_world_region_lod_valid(&config))return false;
    w->lod_config=config;
    return true;
}

bool r2d_world_render_origin(R2DWorldRuntime *w,float *origin_x,float *origin_y,int *region)
{
    if(!w||!w->region_ready||!origin_x||!origin_y)return false;
    if(origin_x)*origin_x=w->render_origin_x;
    if(origin_y)*origin_y=w->render_origin_y;
    if(region)*region=w->render_origin_region;
    return w->render_origin_region>=0;
}

const R2DWorldImpostor *r2d_world_visible_impostors(R2DWorldRuntime *w,int *count)
{
    if(count)*count=w?w->visible_impostor_count:0;
    if(!w||!w->impostor_ready||w->visible_impostor_count<=0)return NULL;
    return w->visible_impostors;
}

static void runtime_refresh_portals(R2DWorldRuntime *w)
{
    const int np=w->world.portal_count;
    if(np>w->region_portal_capacity){
        R2DWorldRegionPortal *next=(R2DWorldRegionPortal *)realloc(
            w->region_portals,(size_t)np*sizeof *next);
        if(!next)return;
        w->region_portals=next;w->region_portal_capacity=np;
    }
    for(int i=0;i<np;i++){
        const R2DWorldPortal *p=&w->world.portals[i];
        w->region_portals[i]=(R2DWorldRegionPortal){p->cell_a,p->cell_b,p->closed,p->area_portal};
    }
}

static void runtime_refresh_occluders(R2DWorldRuntime *w)
{
    int count=0;
    for(int i=0;i<w->world.wall_count;i++)
        if(r2d_world_wall_bits(&w->world.walls[i])&R2D_WALL_OCCLUDER)count++;
    if(count>w->occluder_capacity){
        R2DWorldOccluder *next=(R2DWorldOccluder *)realloc(w->occluders,(size_t)count*sizeof *next);
        if(!next)return;
        w->occluders=next;w->occluder_capacity=count;
    }
    w->occluder_count=0;
    for(int i=0;i<w->world.wall_count;i++){
        const R2DWorldWall *wall=&w->world.walls[i];
        if(!(r2d_world_wall_bits(wall)&R2D_WALL_OCCLUDER))continue;
        if(!isfinite(wall->x1)||!isfinite(wall->y1)||!isfinite(wall->x2)||!isfinite(wall->y2))continue;
        w->occluders[w->occluder_count++]=(R2DWorldOccluder){wall->x1,wall->y1,wall->x2,wall->y2};
    }
}

static bool region_asset_xy(JSContext *ctx,JSValueConst node,float *x,float *y)
{
    JSValue vx=JS_GetPropertyStr(ctx,node,"x");double dx=0,dy=0;
    JSValue vy=JS_GetPropertyStr(ctx,node,"y");
    int ok=!JS_IsException(vx)&&!JS_IsException(vy)&&
        JS_ToFloat64(ctx,&dx,vx)==0&&JS_ToFloat64(ctx,&dy,vy)==0;
    JS_FreeValue(ctx,vx);JS_FreeValue(ctx,vy);
    if(!ok||!isfinite(dx)||!isfinite(dy))return false;
    *x=(float)dx;*y=(float)dy;
    return true;
}

// Texture/atlas residency: merge authored material textures and live atlas
// buffers into the same budgeted cache as region payloads. This is the data the
// GPU owner uploads when an item becomes RESIDENT; no GPU call is made here.
static void runtime_stream_sync_assets(JSContext *ctx,R2DWorldRuntime *w)
{
    if(!w->stream_ready||!w->region_ready)return;
    const int revision=w->world.material_count*131+w->atlas_count*17+
        (int)(w->world.geometry_revision&0x7fffffff);
    if(revision==w->stream_asset_revision)return;
    w->stream_asset_revision=revision;
    for(int m=0;m<w->world.material_count;m++){
        const R2DWorldMaterial *material=&w->world.materials[m];
        if(!material->used)continue;
        int region=-1;
        // Prefer a span-owned surface for the owner region; wall-only materials
        // stay global so a wall texture is never tied to an arbitrary cell.
        for(int s=0;s<w->world.surface_count&&region<0;s++){
            if(!w->world.surface_materials||w->world.surface_materials[s]!=m)continue;
            const R2DWorldSurface *surface=r2d_world_surface(&w->world,s);
            if(!surface||surface->span<0||!w->world.span_cells)continue;
            const int cell=w->world.span_cells[surface->span];
            if(cell>=0&&cell<w->regions.cell_count)region=w->regions.cell_region[cell];
        }
        uint64_t bytes=64;
        const R2DWorldTexture *slots[3]={&material->albedo,&material->normal,&material->emissive};
        for(int j=0;j<3;j++){
            const R2DWorldTexture *texture=slots[j];
            if(!texture->pixels)continue;
            const uint64_t slot_bytes=(uint64_t)texture->width*texture->height*4u;
            bytes+=slot_bytes;
            // One TEXTURE item per material slot: the GPU uploader maps
            // id=m*4+j back to g->textures[m][j].
            r2d_world_stream_register(&w->stream,m*4+j,R2D_STREAM_TEXTURE,region,slot_bytes,30);
        }
        r2d_world_stream_register(&w->stream,m,R2D_STREAM_MATERIAL,region,bytes,20);
    }
    for(int a=0;a<w->atlas_count;a++){
        const R2DWorldAtlasActor *actor=&w->atlas_actors[a];
        if(!actor->atlas)continue;
        float x=0,y=0;int region=-1;
        if(region_asset_xy(ctx,actor->node,&x,&y))
            region=r2d_world_region_at(&w->regions,x,y);
        const uint64_t bytes=(uint64_t)actor->atlas_w*actor->atlas_h*4u;
        r2d_world_stream_register(&w->stream,1000000+a,R2D_STREAM_ATLAS,region,bytes,30);
    }
}

static void runtime_build_cell_allowed(R2DWorldRuntime *w,float camera_x,float camera_y)
{
    if(!w->region_ready||!w->cell_allowed||!w->region_visible)return;
    memset(w->cell_allowed,0,(size_t)w->world.cell_count);
    w->region_cells_allowed=0;w->region_cells_culled=0;
    if(w->region_current<0)return;
    const int camera_cell=r2d_world_cell_at(&w->world,camera_x,camera_y);
    const int camera_cluster=(camera_cell>=0&&w->cluster_ready)
        ?r2d_world_region_cluster_at(&w->clusters,camera_cell):-1;
    w->cluster_camera=camera_cluster;
    for(int r=0;r<w->regions.region_count;r++){
        if(!w->region_visible[r])continue;
        const R2DWorldRegion *region=&w->regions.regions[r];
        for(int k=0;k<region->cell_count;k++){
            const int cell=w->regions.region_cells[region->first_cell+k];
            if(cell<0||cell>=w->world.cell_count)continue;
            bool allow=(r==w->region_current)||camera_cluster<0||!w->cluster_ready;
            if(!allow)allow=r2d_world_region_cluster_visible(&w->clusters,camera_cluster,
                r2d_world_region_cluster_at(&w->clusters,cell));
            if(allow){w->cell_allowed[cell]=1;w->region_cells_allowed++;}
            else w->region_cells_culled++;
        }
    }
}

void r2d_world_regions_frame(R2DWorldRuntime *w,const R2DRe2dView *view)
{
    if(!w||!view)return;
    if(!r2d_world_regions_ensure(w)){w->region_ready=false;return;}
    R2DWorldRegionSet *set=&w->regions;
    const uint64_t revision=w->world.geometry_revision;
    if(revision!=w->region_pvs_revision){
        runtime_refresh_portals(w);
        if(set->portal_count)
            r2d_world_region_rebuild_pvs(set,w->region_portals,set->portal_count);
        if(w->cluster_ready)
            r2d_world_region_clusters_rebuild_pvs(&w->clusters,w->region_portals,set->portal_count);
        w->region_pvs_revision=revision;
    }
    if(revision!=w->occluder_revision){
        runtime_refresh_occluders(w);
        w->occluder_revision=revision;
    }
    int at=r2d_world_region_at(set,view->x,view->y);
    if(at<0)at=0;
    w->region_current=at;

    int pvs_visible=0;
    for(int r=0;r<set->region_count;r++)
        if(r2d_world_region_visible(set,at,r))pvs_visible++;
    int visible=r2d_world_region_visible_set(set,at,w->occluders,w->occluder_count,
        view->x,view->y,w->region_visible,w->region_visible_capacity);
    if(visible<0)visible=0;
    w->region_visible_count=visible;
    w->region_pvs_culled=set->region_count-pvs_visible;
    w->region_occluder_culled=pvs_visible-visible;
    if(w->region_occluder_culled<0)w->region_occluder_culled=0;
    runtime_build_cell_allowed(w,view->x,view->y);

    w->region_active_count=r2d_world_region_update_active(set,at,
        w->region_active_radius>0?w->region_active_radius:1,
        w->region_preload_radius>0?w->region_preload_radius:2,
        w->region_states,set->region_count,w->region_active,set->region_count,
        w->region_preload,set->region_count);
    w->region_preload_count=set->metrics.preload_count;
    r2d_world_stream_update(&w->stream,w->region_states,set->region_count,
        &w->stream_budget,(uint64_t)w->frame_count,&w->stream_stats);
    w->stream_total_uploads+=(uint64_t)w->stream_stats.uploads;
    w->stream_total_upload_bytes+=w->stream_stats.upload_bytes;
    w->stream_total_evictions+=(uint64_t)w->stream_stats.evicted;
    // Task-15: true payload residency follows the active/preload ring. Loads and
    // unloads are sliced by the IO budget, so a crossing never copies a whole
    // region in one frame. Master arrays remain the query fallback.
    if(w->stream_io_ready){
        if(w->stream_io_required_capacity<set->region_count){
            uint8_t *next=(uint8_t *)realloc(w->stream_io_required,(size_t)set->region_count);
            if(next){w->stream_io_required=next;w->stream_io_required_capacity=set->region_count;}
        }
        if(w->stream_io_required){
            for(int r=0;r<set->region_count;r++){
                const uint8_t state=w->region_states[r];
                w->stream_io_required[r]=(state==R2D_WORLD_REGION_ACTIVE||
                    state==R2D_WORLD_REGION_PRELOADING||
                    state==R2D_WORLD_REGION_RESIDENT)?1:0;
            }
            r2d_world_stream_io_set_required(&w->stream_io,w->stream_io_required,
                                             set->region_count);
            r2d_world_stream_io_tick(&w->stream_io,&w->stream_io_budget,
                (uint64_t)w->frame_count,&w->stream_io_stats);
            w->stream_io_loads_total+=(uint64_t)w->stream_io_stats.loads_completed;
            w->stream_io_unloads_total+=(uint64_t)w->stream_io_stats.unloads;
            w->stream_io_bytes_total+=w->stream_io_stats.bytes_loaded;
            if(w->stream_io_stats.max_tick_bytes>w->stream_io_peak_tick_bytes)
                w->stream_io_peak_tick_bytes=w->stream_io_stats.max_tick_bytes;
        }
    }

    float max_distance=w->lod_config.hidden_distance>0.0f?w->lod_config.hidden_distance:6000.0f;
    w->visible_impostor_count=r2d_world_impostors_collect(&w->impostors,set,at,
        w->occluders,w->occluder_count,view->x,view->y,0.0f,max_distance,
        w->visible_impostors,w->visible_impostor_capacity);
    if(w->visible_impostor_count<0)w->visible_impostor_count=0;
    w->render_origin_region=at;
    if(!r2d_world_region_render_origin(set,at,&w->render_origin_x,&w->render_origin_y))
        w->render_origin_x=w->render_origin_y=0.0f;
}

static bool runtime_batch_reserve(R2DWorldRuntime *w,int need)
{
    if(need<=w->batch_instance_capacity) return true;
    int cap=need<16?16:need;
    R2DWorldBatchItem *items=realloc(w->batch_items,(size_t)cap*sizeof *items);
    if(!items) return false;
    w->batch_items=items;w->batch_item_capacity=cap;
    R2DWorldBatchInstance *instances=realloc(w->batch_instances,(size_t)cap*sizeof *instances);
    if(!instances) return false;
    w->batch_instances=instances;w->batch_instance_capacity=cap;
    R2DWorldBatchGroup *groups=realloc(w->batch_groups,(size_t)cap*sizeof *groups);
    if(!groups) return false;
    w->batch_groups=groups;w->batch_group_capacity=cap;
    return true;
}

void r2d_world_batch_frame(R2DWorldRuntime *w)
{
    if(!w) return;
    memset(&w->batch_stats,0,sizeof w->batch_stats);
    int need=w->visibility.surface_count;
    if(need>0&&!runtime_batch_reserve(w,need)){w->batch_stats.overflow=1;return;}
    R2DWorldBatchScratch scratch={w->batch_items,0,w->batch_item_capacity};
    R2DWorldBatchBuffers buffers={w->batch_groups,w->batch_group_capacity,
                                  w->batch_instances,w->batch_instance_capacity};
    r2d_world_batch_visibility(&w->world,&w->visibility,&scratch,&buffers,&w->batch_stats);
}

const R2DWorldBatchStats *r2d_world_batch_stats(const R2DWorldRuntime *w)
{
    return w?&w->batch_stats:NULL;
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
    free(w->batch_items);free(w->batch_instances);free(w->batch_groups);
    w->batch_items=NULL;w->batch_instances=NULL;w->batch_groups=NULL;
    w->batch_item_capacity=w->batch_instance_capacity=w->batch_group_capacity=0;
    memset(&w->batch_stats,0,sizeof w->batch_stats);
    r2d_world_nav_free(w);r2d_world_particles_free(w);r2d_world_secret_free(w);r2d_world_terrain_free(w);r2d_world_audio_zone_free(w);r2d_world_polywall_free(w);r2d_world_regions_free(w);r2d_world_runtime_sky_layers_free(w);
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
        R2DWorldRegionLod lod;r2d_world_region_lod_eval(dist,&w->lod_config,&lod);
        bool animate=true;
        if(lod.animation_fps>0&&lod.animation_fps<60){
            const int frames_per_pose=(60+lod.animation_fps-1)/lod.animation_fps;
            animate=(w->lod_tick%frames_per_pose)==0;
        }
        bool flip=false;
        int column=r2d_world_atlas_direction(r2d_world_atlas_relative_yaw(facing,dx/dist,dy/dist),actor->directions,actor->mirror,&flip);
        if(lod.sprite_directions>0&&lod.sprite_directions<actor->directions&&actor->directions>0){
            column=(column*lod.sprite_directions)/actor->directions;
            w->gpu_sprite_dir_reduced++;
        }
        float px,py;r2d_world_atlas_pivot(actor->pivot_mode,actor->pivot_x,actor->pivot_y,&px,&py);
        int side,cell_x,cell_y,cell_w,cell_h,dest_x,dest_y;float pivot_sx,pivot_sy;
        if(!r2d_world_atlas_placement(actor->cell_w,actor->cell_h,px,py,&side,&dest_x,&dest_y,&pivot_sx,&pivot_sy))continue;
        r2d_world_atlas_cell(column,row,actor->columns,actor->rows,actor->cell_w,actor->cell_h,&cell_x,&cell_y,&cell_w,&cell_h);
        const float wsq=ww*(float)side/(float)actor->cell_w,hsq=hh*(float)side/(float)actor->cell_h;
        const float wx=px_+(0.5f-pivot_sx/(float)side)*wsq;
        const float bottom=pdepth-(1.0f-pivot_sy/(float)side)*hsq;
        const int span=r2d_world_span_at(&w->world,wx,py_,bottom+hsq*0.5f);
        bool visible=span>=0&&w->visibility.span_seen[span]&&r2d_world_sprite_visible(view,width,height,wx,py_,bottom,wsq,hsq,ortho);
        if(visible&&lod.hidden){visible=false;w->lod_hidden_atlas++;}
        if(visible) {
            if(!actor->frame||actor->frame_side!=side) {
                uint8_t *frame=realloc(actor->frame,(size_t)side*(size_t)side*4u);
                if(!frame){JS_ThrowOutOfMemory(ctx);return false;}
                actor->frame=frame;actor->frame_side=side;actor->last_column=-1;
            }
            const bool changed=actor->last_column!=column||actor->last_row!=row||actor->last_flip!=(flip?1:0);
            if((animate||actor->last_column<0)&&changed) {
                if(!r2d_world_atlas_crop(actor->atlas,actor->atlas_w,actor->atlas_h,cell_x,cell_y,cell_w,cell_h,flip,side,dest_x,dest_y,actor->frame)) {
                    JS_ThrowInternalError(ctx,"Re2D World: atlas cell crop failed");return false;
                }
                actor->last_column=column;actor->last_row=row;actor->last_flip=flip?1:0;actor->frame_revision++;
            } else if(changed) w->lod_throttled_actors++;
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
// Shared grounding card (R-01): CPU reference and GPU pass both consume the
// same output-pixel ellipse and blend parameters. The footprint is a floor
// contact blob with a smaller foot-AO core and a local floor tint; height fade
// hides it for airborne actors. It is a 2D card, not a shadow map.
static float cr_clamp01(float v){return v<0?0:v>1?1:v;}
static bool render_project_ground(const R2DRe2dView *v,float x,float y,float z,float ortho,float out[4],float *out_depth)
{
    if(ortho>0){
        float dx=x-v->x,dy=y-v->y,up=z-v->eye,forward=dx*v->cos_yaw+dy*v->sin_yaw;
        float depth=forward*v->cos_pitch+up*v->sin_pitch;
        if(depth<v->near_plane)return false;
        float scale=v->height/ortho;
        out[0]=v->width*.5f+(-dx*v->sin_yaw+dy*v->cos_yaw)*scale;
        out[1]=v->height*.5f-(up*v->cos_pitch-forward*v->sin_pitch)*scale;
        out[2]=1-v->near_plane/depth;out[3]=scale;
        *out_depth=depth;return true;
    }
    if(!r2d_re2d_project(v,x,y,z,out))return false;
    *out_depth=v->focal/out[3];return true;
}
bool r2d_world_render_ground_card(R2DWorldRuntime *w,const R2DRe2dView *v,int width,int height,
                                  float ortho,int actor,R2DWorldGroundCard *out)
{
    if(!w||!v||!out||!w->frame_images||!w->frame_positions)return false;
    if(actor<0||actor>=w->frame_count||!w->frame_images[actor])return false;
    const R2DWorldRenderFeatures *f=&w->render_features;
    if(!f->grounding||!f->contact_shadow)return false;
    const float *p=w->frame_positions+actor*5;
    if(!(p[3]>0)||!(p[4]>0)||!isfinite(p[0])||!isfinite(p[1])||!isfinite(p[2]))return false;
    int span=r2d_world_span_at(&w->world,p[0],p[1],p[2]+fminf(1.0f,p[4]*.25f));
    if(span<0)return false;
    if(w->visibility.span_seen&&!w->visibility.span_seen[span])return false;
    const R2DWorldSpan *s=&w->world.spans[span];
    float floor=r2d_world_floor_height(s,p[0],p[1]);
    float gap=p[2]-floor;
    if(gap>f->shadow_height_fade*2.0f)return false;
    float proj[4],floor_depth=0;
    if(!render_project_ground(v,p[0],p[1],floor+0.5f,ortho,proj,&floor_depth))return false;
    (void)floor_depth;
    float radius_world=fmaxf(p[3],p[4])*0.5f*f->shadow_radius;
    if(!(radius_world>0.0f))return false;
    float sx=(float)width/v->width,sy=(float)height/v->height;
    out->center_x=proj[0]*sx;
    out->center_y=proj[1]*sy;
    out->radius_x=radius_world*proj[3]*sx;
    out->radius_y=out->radius_x*fmaxf(0.35f,fabsf(v->sin_pitch)+0.30f);
    if(out->radius_x<0.75f)return false;
    float height_fade=1.0f;
    if(gap>0.0f&&f->shadow_height_fade>0.0f){
        float t=gap/f->shadow_height_fade;if(t>=1.0f)return false;
        height_fade=1.0f-t*t*(3.0f-2.0f*t);
    }
    out->opacity=f->shadow_opacity*height_fade;
    out->softness=f->shadow_softness;
    out->foot_ratio=f->foot_ao?f->foot_ao_radius:0.0f;
    out->foot_strength=f->foot_ao?f->foot_ao_strength:0.0f;
    out->span=span;
    float fr=0.02f,fg=0.02f,fb=0.025f;
    if(f->local_floor_tint){
        float cr=(s->floor_color&255)/255.0f,cg=((s->floor_color>>8)&255)/255.0f,cb=((s->floor_color>>16)&255)/255.0f;
        float level=1.0f,ar=1.0f,ag=1.0f,ab=1.0f;
        if(w->world.lighting.enabled&&w->world.span_lights){const R2DWorldSpanLight *l=&w->world.span_lights[span];level=l->level;ar=l->r;ag=l->g;ab=l->b;}
        cr*=level*ar;cg*=level*ag;cb*=level*ab;
        float mix=f->floor_tint_mix;
        fr=fr+(cr-fr)*mix;fg=fg+(cg-fg)*mix;fb=fb+(cb-fb)*mix;
    }
    out->tint_r=cr_clamp01(fr);out->tint_g=cr_clamp01(fg);out->tint_b=cr_clamp01(fb);
    return out->opacity>0.0f;
}
static void render_ground_cpu(R2DWorldRuntime *w,const R2DRe2dView *v,int width,int height,float ortho)
{
    const R2DWorldRenderFeatures *f=&w->render_features;
    if(!f->grounding||!f->contact_shadow||!w->rgba)return;
    int budget=f->quality<=R2D_RENDER_QUALITY_LOW?128:512;
    int drawn=0;
    for(int i=0;i<w->frame_count&&drawn<budget;i++){
        R2DWorldGroundCard card;
        if(!r2d_world_render_ground_card(w,v,width,height,ortho,i,&card))continue;
        int x0=(int)fmaxf(0,floorf(card.center_x-card.radius_x-1)),x1=(int)fminf(width,ceilf(card.center_x+card.radius_x+1));
        int y0=(int)fmaxf(0,floorf(card.center_y-card.radius_y-1)),y1=(int)fminf(height,ceilf(card.center_y+card.radius_y+1));
        if(x1<=x0||y1<=y0)continue;
        int wrote=0;
        float dark_r=0.02f,dark_g=0.02f,dark_b=0.025f;
        float src_r=dark_r+(card.tint_r-dark_r)*0.25f;
        float src_g=dark_g+(card.tint_g-dark_g)*0.25f;
        float src_b=dark_b+(card.tint_b-dark_b)*0.25f;
        for(int py=y0;py<y1;py++)for(int px=x0;px<x1;px++){
            float dx=(px+.5f-card.center_x)/card.radius_x,dy=(py+.5f-card.center_y)/card.radius_y;
            float d=sqrtf(dx*dx+dy*dy);
            if(d>=1.0f)continue;
            float radial=1.0f;
            if(d>1.0f-card.softness){
                float t=(1.0f-d)/card.softness;t=t>1?1:t<0?0:t;
                radial=t*t*(3.0f-2.0f*t);
            }
            float alpha=card.opacity*radial;
            float core=0.0f;
            if(card.foot_ratio>0.0f){
                float q=d/card.foot_ratio;
                core=(1.0f-(q>=1.0f?1.0f:q*q*(3.0f-2.0f*q)))*card.foot_strength;
                alpha=fminf(1.0f,alpha+core*0.25f);
            }
            if(alpha<=0.001f)continue;
            uint8_t *dst=w->rgba+((size_t)py*width+px)*4;
            float inv=1.0f-alpha;
            dst[0]=(uint8_t)lrintf(dst[0]*inv+src_r*255.0f*alpha);
            dst[1]=(uint8_t)lrintf(dst[1]*inv+src_g*255.0f*alpha);
            dst[2]=(uint8_t)lrintf(dst[2]*inv+src_b*255.0f*alpha);
            dst[3]=255;
            wrote=1;
        }
        if(wrote){
            drawn++;
            w->render_counters.grounded_actors++;
            w->render_counters.contact_shadows++;
            w->render_counters.ground_draws++;
            if(f->foot_ao)w->render_counters.foot_ao++;
            if(f->local_floor_tint)w->render_counters.floor_tint++;
            if(f->contact_lighting)w->render_counters.contact_lit++;
        }
    }
}

int r2d_world_runtime_frame(JSContext *ctx,R2DWorldRuntime *w,const R2DRe2dView *view,int width,int height,float ortho)
{
    if(w->rendering){JS_ThrowTypeError(ctx,"Re2D World: reentrant rendering");return -1;}
    if(!w->render_features_ready)r2d_world_render_init(w);
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
    r2d_world_regions_ensure(w);
    runtime_stream_sync_assets(ctx,w);
    r2d_world_regions_frame(w,view);
    r2d_world_audio_step(w,view);
    Uint64 frame_start=SDL_GetPerformanceCounter(),phase=frame_start;double ms=1000.0/SDL_GetPerformanceFrequency();
    w->rendering=true;w->frame_count=0;w->visible_actor_count=0;w->visible_atlas_count=0;w->particles_drawn=0;w->poses_updated=w->poses_deferred=0;w->gpu_draws=w->gpu_material_batches=w->gpu_shadow_updates=0;w->gpu_draw_ground=0;w->gpu_draw_vfx=0;w->shadow_ms=w->gpu_submit_ms=w->gpu_completion_ms=0;w->lod_hidden_actors=w->lod_throttled_actors=w->lod_hidden_atlas=0;w->lod_culled_lights=w->lod_culled_particles=w->lod_culled_decals=0;w->audio_region_culled=0;w->gpu_lod_culled_lights=w->gpu_lod_culled_decals=w->gpu_sprite_dir_reduced=0;r2d_world_render_counters_reset(&w->render_counters);int result=-1;
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
    if(!r2d_world_visibility_filtered(&w->world,view,ortho,&w->visibility,
            w->region_ready?w->cell_allowed:NULL)){JS_ThrowOutOfMemory(ctx);goto done;}
    w->visibility_ms=(SDL_GetPerformanceCounter()-phase)*ms;phase=SDL_GetPerformanceCounter();
    // P4: deterministic static-batch grouping data (no GPU submission here).
    r2d_world_batch_frame(w);
    if(!r2d_world_light_rebuild(&w->world)){JS_ThrowOutOfMemory(ctx);goto done;}
    w->light_cull_ms=(SDL_GetPerformanceCounter()-phase)*ms;
    bool lights[R2D_WORLD_MAX_LIGHTS]={0};w->visible_lights=w->shadowed_lights=0;
    for(int i=0;i<w->visibility.span_count;i++){int span=w->visibility.spans[i];for(int j=0;j<w->world.span_light_counts[span];j++)lights[w->world.span_light_refs[span*R2D_WORLD_LIGHTS_PER_SPAN+j]]=true;}
    // Light LOD: distance policy drops far lights and shadowed lights beyond
    // the per-ring shadow budget. Typical near lights keep the full pool.
    if(w->render_features.quality>=R2D_RENDER_QUALITY_HIGH){
        int kept[ R2D_WORLD_MAX_LIGHTS ], kept_count=0, shadowed=0;
        for(int i=0;i<R2D_WORLD_MAX_LIGHTS;i++)if(lights[i]){
            const R2DWorldLight *light=&w->world.lights[i];
            const float dx=light->x-view->x,dy=light->y-view->y,dz=light->h-view->eye;
            const float distance=sqrtf(dx*dx+dy*dy+dz*dz);
            R2DWorldRegionLod lod;r2d_world_region_lod_eval(distance,&w->lod_config,&lod);
            if(!lod.light_updates||lod.max_lights<=0){w->lod_culled_lights++;continue;}
            if(kept_count<R2D_WORLD_MAX_LIGHTS)kept[kept_count++]=i;
        }
        int budget=w->lod_config.near_lights>0?w->lod_config.near_lights:R2D_WORLD_MAX_LIGHTS;
        if(kept_count>budget){
            // Keep the nearest `budget` lights deterministically.
            for(int a=budget;a<kept_count;a++){
                int worst=0;float worst_distance=-1;
                const R2DWorldLight *la=&w->world.lights[kept[a]];
                const float da=hypotf(la->x-view->x,la->y-view->y);
                for(int b=0;b<budget;b++){
                    const R2DWorldLight *lb=&w->world.lights[kept[b]];
                    const float db=hypotf(lb->x-view->x,lb->y-view->y);
                    if(db>worst_distance){worst_distance=db;worst=b;}
                }
                if(da<worst_distance){lights[kept[worst]]=false;w->lod_culled_lights++;kept[worst]=kept[a];}
                else{w->lod_culled_lights++;lights[kept[a]]=false;}
            }
        }
        w->visible_lights=0;w->shadowed_lights=0;
        for(int i=0;i<R2D_WORLD_MAX_LIGHTS;i++)if(lights[i]){
            w->visible_lights++;
            if(w->world.shadow_mask[i]&&shadowed<w->lod_config.max_shadow_lights){shadowed++;w->shadowed_lights++;}
        }
    }else{
        // CPU/GPU reference parity at low/medium: no distance light culling.
        w->visible_lights=0;w->shadowed_lights=0;
        for(int i=0;i<R2D_WORLD_MAX_LIGHTS;i++)if(lights[i]){
            w->visible_lights++;
            if(w->world.shadow_mask[i])w->shadowed_lights++;
        }
    }
    // Decal region pool stats: a decal is culled when its owning cell is
    // outside the hierarchical PVS or distance LOD drops it this frame.
    for(int i=0;i<w->world.decal_count;i++){
        const R2DWorldDecal *decal=&w->world.decals[i];if(!decal->active)continue;
        const R2DWorldSurface *surface=r2d_world_surface(&w->world,decal->surface);
        if(!surface||surface->span<0||!w->world.span_cells){w->lod_culled_decals++;continue;}
        const int cell=w->world.span_cells[surface->span];
        const bool allowed=!w->region_ready||!w->cell_allowed||
            (cell>=0&&cell<w->world.cell_count&&w->cell_allowed[cell]);
        if(!allowed){w->lod_culled_decals++;continue;}
        const R2DWorldSpan *span=&w->world.spans[surface->span];
        R2DWorldRegionLod lod;r2d_world_region_lod_eval(hypotf(span->x-view->x,span->y-view->y),&w->lod_config,&lod);
        if(lod.decal_percent<100&&(i%100)>=lod.decal_percent)w->lod_culled_decals++;
    }
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
        R2DWorldRegionLod lod;r2d_world_region_lod_eval(hypotf(p[0]-view->x,p[1]-view->y),&w->lod_config,&lod);
        if(visible&&lod.hidden){visible=false;w->lod_hidden_actors++;}
        bool animate=true;
        if(lod.animation_fps>0&&lod.animation_fps<60){
            const int frames_per_pose=(60+lod.animation_fps-1)/lod.animation_fps;
            animate=(w->lod_tick%frames_per_pose)==0;
        }
        bool dirty=visible&&r2d_rotsprite_dirty(ctx,w->frame_handles[i]);
        bool synthesize=visible&&animate&&(w->pose_budget==0||w->poses_updated<w->pose_budget);
        const uint8_t *image=r2d_rotsprite_pixels(ctx,w->frame_handles[i],&w->frame_sizes[i],synthesize);if(!image)goto done;
        if(dirty){if(synthesize){w->poses_updated++;next_cursor=(i+1)%w->frame_count;}
            else{w->poses_deferred++;if(!animate)w->lod_throttled_actors++;}}
        w->frame_images[i]=visible?image:NULL;if(visible)w->visible_actor_count++;
    }
    w->pose_cursor=next_cursor;
    w->actor_ms=(SDL_GetPerformanceCounter()-phase)*ms;phase=SDL_GetPerformanceCounter();
    if(w->gpu_enabled||w->debug_view==R2D_WORLD_DEBUG_OVERDRAW){if(!r2d_world_gpu_frame(ctx,w,view,ortho)){r2d_world_gpu_free(w);JS_ThrowInternalError(ctx,"Re2D World GPU: %s",SDL_GetError());goto done;}}
    else {r2d_world_frame_targets(&w->world,view,width,height,w->rgba,w->depth,ortho,&w->visibility,w->owners);render_ground_cpu(w,view,width,height,ortho);}
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
    w->lod_tick++;
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


// Per-layer sky textures: data/loader half only. No GPU calls here; the
// renderer reads the same config + decoded RGBA pixels through the getters.
static void sky_layers_ensure(R2DWorldRuntime *w)
{
    if(w->sky_layers_ready)return;
    r2d_world_sky_defaults(&w->sky_config);
    memset(w->sky_layer_tex,0,sizeof w->sky_layer_tex);
    w->sky_layers_ready=true;
}
static void sky_error(R2DWorldRuntime *w,const char *message)
{
    if(!w)return;
    if(message)snprintf(w->sky_layer_error,sizeof w->sky_layer_error,"Re2D Sky: %s",message);
    else w->sky_layer_error[0]=0;
}
void r2d_world_runtime_sky_layers_free(R2DWorldRuntime *w)
{
    if(!w)return;
    for(int i=0;i<R2D_SKY_MAX_LAYERS;i++){free(w->sky_layer_tex[i].pixels);w->sky_layer_tex[i].pixels=NULL;
        w->sky_layer_tex[i].width=w->sky_layer_tex[i].height=0;w->sky_layer_tex[i].loaded=false;}
    w->sky_layers_ready=false;w->sky_layer_error[0]=0;
}
bool r2d_world_runtime_sky_layer_set(JSContext *ctx,R2DWorldRuntime *w,int index,
    const char *id,const char *texture,uint32_t tint,float parallax,float scroll,
    float alpha,float offset,float scale)
{
    if(!ctx||!w||index<0||index>=R2D_SKY_MAX_LAYERS)return false;
    sky_layers_ensure(w);
    R2DWorldSky cfg=w->sky_config;
    const char *next_path=texture?texture:cfg.layers[index].texture_path;
    uint8_t *pixels=NULL;int width=0,height=0;
    if(texture&&texture[0]){
        R2DWorldTexture decoded={0};
        if(!material_png(ctx,texture,&decoded,2048)){sky_error(w,"layer texture failed to load");return false;}
        pixels=decoded.pixels;width=decoded.width;height=decoded.height;
    }
    if(!r2d_world_sky_set_layer(&cfg,index,id?id:cfg.layers[index].id,next_path,
                                tint,parallax,scale,offset,alpha,scroll)){
        free(pixels);sky_error(w,"layer parameters invalid");return false;
    }
    w->sky_config=cfg;
    if(texture){
        free(w->sky_layer_tex[index].pixels);
        w->sky_layer_tex[index].pixels=pixels;
        w->sky_layer_tex[index].width=width;
        w->sky_layer_tex[index].height=height;
        w->sky_layer_tex[index].loaded=pixels!=NULL;
    }
    sky_error(w,NULL);
    return true;
}
static bool read_text_file(JSContext *ctx,const char *path,char **out,size_t *size,char *err,size_t err_size)
{
    R2DScript *script=JS_GetContextOpaque(ctx);char full[4096];r2d_app_resolve_path(script->app,full,sizeof full,path);
    uint8_t *bytes=NULL;size_t length=0;
    if(r2d_vfs_has(full))bytes=r2d_vfs_read(full,&length);
    else {SDL_IOStream *io=SDL_IOFromFile(full,"rb");if(io){Sint64 n=SDL_GetIOSize(io);
        if(n>0&&n<=256*1024){length=(size_t)n;bytes=SDL_malloc(length+1);if(bytes&&SDL_ReadIO(io,bytes,length)!=length){SDL_free(bytes);bytes=NULL;}}
        SDL_CloseIO(io);}}
    if(!bytes){if(err&&err_size)snprintf(err,err_size,"Re2D Sky: cannot read manifest %s",path);return false;}
    char *text=SDL_malloc(length+1);
    if(!text){if(r2d_vfs_has(full))r2d_vfs_free(bytes);else SDL_free(bytes);return false;}
    memcpy(text,bytes,length);text[length]=0;
    if(r2d_vfs_has(full))r2d_vfs_free(bytes);else SDL_free(bytes);
    *out=text;*size=length;return true;
}
bool r2d_world_runtime_sky_manifest(JSContext *ctx,R2DWorldRuntime *w,const char *path)
{
    if(!ctx||!w||!path||!path[0])return false;
    sky_layers_ensure(w);
    char *text=NULL;size_t size=0;char err[192]={0};
    if(!read_text_file(ctx,path,&text,&size,err,sizeof err)){sky_error(w,err);return false;}
    R2DWorldSkyManifest manifest;
    bool ok=r2d_world_sky_manifest_parse(text,&manifest,err,sizeof err);
    SDL_free(text);
    if(!ok){sky_error(w,err);return false;}
    uint8_t *pixels[R2D_SKY_MAX_LAYERS]={0};int widths[R2D_SKY_MAX_LAYERS]={0},heights[R2D_SKY_MAX_LAYERS]={0};
    for(int i=0;i<manifest.layer_count;i++){
        R2DWorldTexture decoded={0};
        if(!material_png(ctx,manifest.layers[i].texture,&decoded,2048)){
            for(int j=0;j<i;j++)free(pixels[j]);
            sky_error(w,"manifest layer texture failed to load");
            return false;
        }
        pixels[i]=decoded.pixels;widths[i]=decoded.width;heights[i]=decoded.height;
    }
    R2DWorldSky cfg=w->sky_config;
    if(!r2d_world_sky_apply_manifest(&cfg,&manifest)){
        for(int i=0;i<manifest.layer_count;i++)free(pixels[i]);
        sky_error(w,"manifest rejected by sky validation");
        return false;
    }
    for(int i=0;i<R2D_SKY_MAX_LAYERS;i++){
        free(w->sky_layer_tex[i].pixels);
        w->sky_layer_tex[i].pixels=pixels[i];pixels[i]=NULL;
        w->sky_layer_tex[i].width=widths[i];w->sky_layer_tex[i].height=heights[i];
        w->sky_layer_tex[i].loaded=widths[i]>0&&heights[i]>0;
    }
    w->sky_config=cfg;
    sky_error(w,NULL);
    return true;
}
int r2d_world_runtime_sky_layer_count(const R2DWorldRuntime *w)
{
    return w&&w->sky_layers_ready?w->sky_config.layer_count:0;
}
const R2DWorldSky *r2d_world_runtime_sky_config(const R2DWorldRuntime *w)
{
    return w&&w->sky_layers_ready?&w->sky_config:NULL;
}
const uint8_t *r2d_world_runtime_sky_layer_pixels(const R2DWorldRuntime *w,int index,
                                                  int *width,int *height)
{
    if(width)*width=0;if(height)*height=0;
    if(!w||index<0||index>=R2D_SKY_MAX_LAYERS)return NULL;
    if(width)*width=w->sky_layer_tex[index].width;
    if(height)*height=w->sky_layer_tex[index].height;
    return w->sky_layer_tex[index].loaded?w->sky_layer_tex[index].pixels:NULL;
}
const char *r2d_world_runtime_sky_layer_path(const R2DWorldRuntime *w,int index)
{
    return w&&w->sky_layers_ready&&index>=0&&index<R2D_SKY_MAX_LAYERS?
        w->sky_config.layers[index].texture_path:NULL;
}
const char *r2d_world_runtime_sky_layer_error(const R2DWorldRuntime *w)
{
    return w?w->sky_layer_error:"";
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
    // The public JS bridge supplies position and velocity, not support flags.
    // Recover a resting contact before acceleration/jump; keep airborne
    // velocity authoritative so this cannot cancel a jump or snap a fall.
    if(!state->grounded && fabsf(state->vz)<1e-5f) {
        R2DWorldControllerState contact=*state;
        if(r2d_world_controller_init(&w->world,&e->config,state,&contact) && contact.grounded) {
            state->feet=contact.feet;state->span=contact.span;
            state->ceiling=contact.ceiling;state->grounded=true;
        }
    }
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
        R2DWorldRegionLod lod;r2d_world_region_lod_eval(hypotf(p->x-v->x,p->y-v->y),&w->lod_config,&lod);
        if(lod.particle_percent<=0||(lod.particle_percent<100&&(i%100)>=lod.particle_percent)){
            w->lod_culled_particles++;continue;
        }
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
        R2DWorldRegionLod lod;r2d_world_region_lod_eval(hypotf(p->x-v->x,p->y-v->y),&w->lod_config,&lod);
        if(lod.particle_percent<=0||(lod.particle_percent<100&&(i%100)>=lod.particle_percent)){
            w->lod_culled_particles++;continue;
        }
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
        out->portals[i].portal=i;out->portals[i].open_fraction=w->world.portals[i].open_fraction;out->portals[i].sky=w->world.portals[i].sky;out->portals[i].mirror=w->world.portals[i].mirror;
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
    for(int i=0;i<in->portal_count;i++){r2d_world_portal_set_open(&w->world,in->portals[i].portal,in->portals[i].open_fraction);r2d_world_portal_set_sky(&w->world,in->portals[i].portal,in->portals[i].sky);r2d_world_portal_set_mirror(&w->world,in->portals[i].portal,in->portals[i].mirror);}
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
        // Region/PVS audio culling: a source outside the camera's hierarchical
        // visible set is virtualized (no HRTF/occlusion ray cost, silent mix).
        bool region_culled=false;
        const R2DWorldRegionSet *region_set=r2d_world_regions(w);
        if(region_set&&w->region_ready&&w->region_visible&&w->region_current>=0){
            const int source_region=r2d_world_region_at(region_set,s->x,s->y);
            if(source_region>=0&&source_region<region_set->region_count&&
               source_region<w->region_visible_capacity&&!w->region_visible[source_region])
                region_culled=true;
        }
        if(region_culled){
            s->virtualized=true;s->occluded=true;s->gain=0;s->current_gain=0;
            w->audio_region_culled++;
            r2d_audio_world_channel(w->audio,i,true,s->hrtf,0,0,-1,0,22000);
            continue;
        }
        float origin[3]={v->x,v->y,v->eye},direction[3]={dx,dy,dh};R2DWorldHit hit;
        s->occluded=false;
        if(d>.01f){
            // R2D_WALL_ACOUSTIC is the audio-occlusion policy bit; a wall with
            // the bit clear is visually solid but acoustically transparent, so
            // continue the ray past it instead of silencing the source.
            float o[3]={origin[0],origin[1],origin[2]};
            for(int pass=0;pass<8;pass++){
                if(!r2d_world_ray(&w->world,o,direction,.001f,.999f,&hit)){s->occluded=false;break;}
                if(hit.wall<0){s->occluded=true;break;}
                R2DWorldWallPolicy policy=r2d_world_wall_policy(&w->world,hit.wall);
                if(policy.acoustic){s->occluded=true;break;}
                o[0]=hit.x+direction[0]*.001f;o[1]=hit.y+direction[1]*.001f;o[2]=hit.height+direction[2]*.001f;
                s->occluded=true; // conservative if the loop budget is exhausted
            }
        }
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
