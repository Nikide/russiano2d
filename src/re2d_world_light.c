#include "re2d_world.h"
#include "json.h"
#include <stdio.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <stdint.h>
bool r2d_world_light_valid(const R2DWorldLight *l)
{
    return l&&isfinite(l->x)&&isfinite(l->y)&&isfinite(l->h)&&isfinite(l->radius)&&l->radius>0&&l->radius<=1000000&&
        isfinite(l->intensity)&&l->intensity>=0&&l->intensity<=100&&isfinite(l->r)&&l->r>=0&&l->r<=1&&
        isfinite(l->g)&&l->g>=0&&l->g<=1&&isfinite(l->b)&&l->b>=0&&l->b<=1;
}
static int light_mask_words(int light_capacity)
{
    int words=(light_capacity+31)/32;
    // The bake/shader format always covers the legacy 128 slots; 4 words is the
    // minimum storage even for an empty/dynamic world.
    return words<4?4:words;
}
static int light_token(unsigned generation,int slot)
{
    return (int)(generation*(unsigned)R2D_WORLD_LIGHT_TOKEN_STRIDE+(unsigned)slot);
}
int r2d_world_light_slot(const R2DRe2dWorld *w,int token)
{
    if(!w||token<0)return -1;
    const unsigned stride=R2D_WORLD_LIGHT_TOKEN_STRIDE;
    unsigned slot=(unsigned)token%stride,generation=(unsigned)token/stride;
    if(slot<(unsigned)w->light_capacity&&w->lights[slot].active&&
       w->lights[slot].generation==generation)return (int)slot;
    // Compatibility decode for callers that build the historic
    // generation*128+slot token (used by native tests/tooling). Dynamic tokens
    // start at R2D_WORLD_LIGHT_TOKEN_STRIDE, so the ranges do not overlap.
    if(token<R2D_WORLD_LIGHT_TOKEN_STRIDE){
        unsigned legacy_slot=(unsigned)token%R2D_WORLD_MAX_LIGHTS;
        unsigned legacy_generation=(unsigned)token/R2D_WORLD_MAX_LIGHTS;
        if(legacy_slot<(unsigned)w->light_capacity&&w->lights[legacy_slot].active&&
           w->lights[legacy_slot].generation==legacy_generation)return (int)legacy_slot;
    }
    return -1;
}
// Grow lights/light_links/light_dirty_slots/shadow_mask/shadow_geometry_revision
// together. Span light masks grow with the registry too (one bit per light per
// span), so a light slot above 127 still propagates correctly. All allocations
// are prepared before the old arrays are released (transactional growth).
static bool light_registry_reserve(R2DRe2dWorld *w,int need)
{
    if(!w||need<0)return false;
    if(need<=w->light_capacity)return true;
    int capacity=w->light_capacity>0?w->light_capacity:R2D_WORLD_MAX_LIGHTS;
    while(capacity<need){
        if(capacity>INT_MAX/2){capacity=need;break;}
        capacity*=2;
    }
    if((size_t)capacity>SIZE_MAX/sizeof(R2DWorldLight))return false;
    uint32_t *masks=NULL;int mask_words=w->span_light_words;
    if(w->span_light_masks&&w->span_count>0){
        const int words=light_mask_words(capacity);
        if(words>w->span_light_words){
            masks=calloc((size_t)w->span_count*(size_t)words,sizeof *masks);
            if(!masks)return false;
            for(int i=0;i<w->span_count;i++)
                memcpy(masks+(size_t)i*words,w->span_light_masks+(size_t)i*w->span_light_words,
                       (size_t)w->span_light_words*sizeof *masks);
            mask_words=words;
        }
    }
    R2DWorldLight *lights=calloc((size_t)capacity,sizeof *lights);
    R2DWorldLightLinks *links=calloc((size_t)capacity,sizeof *links);
    uint8_t *dirty=calloc((size_t)capacity,1);
    uint8_t *shadow=calloc((size_t)capacity,1);
    uint64_t *revisions=calloc((size_t)capacity,sizeof *revisions);
    if(!lights||!links||!dirty||!shadow||!revisions){
        free(masks);free(lights);free(links);free(dirty);free(shadow);free(revisions);return false;
    }
    if(w->light_capacity>0){
        memcpy(lights,w->lights,(size_t)w->light_capacity*sizeof *lights);
        memcpy(links,w->light_links,(size_t)w->light_capacity*sizeof *links);
        memcpy(dirty,w->light_dirty_slots,(size_t)w->light_capacity);
        memcpy(shadow,w->shadow_mask,(size_t)w->light_capacity);
        memcpy(revisions,w->shadow_geometry_revision,(size_t)w->light_capacity*sizeof *revisions);
    }
    free(w->lights);free(w->light_links);free(w->light_dirty_slots);
    free(w->shadow_mask);free(w->shadow_geometry_revision);
    if(masks){free(w->span_light_masks);w->span_light_masks=masks;}
    w->span_light_words=mask_words;
    w->lights=lights;w->light_links=links;w->light_dirty_slots=dirty;
    w->shadow_mask=shadow;w->shadow_geometry_revision=revisions;w->light_capacity=capacity;
    return true;
}
void r2d_world_light_registry_free(R2DRe2dWorld *w)
{
    if(!w)return;
    for(int i=0;i<w->light_capacity;i++)free(w->light_links[i].spans);
    free(w->lights);free(w->light_links);free(w->light_dirty_slots);
    free(w->shadow_mask);free(w->shadow_geometry_revision);
    w->lights=NULL;w->light_links=NULL;w->light_dirty_slots=NULL;
    w->shadow_mask=NULL;w->shadow_geometry_revision=NULL;
    w->light_capacity=0;w->light_count=0;
}
bool r2d_world_light_registry_move(R2DRe2dWorld *dst,R2DRe2dWorld *src)
{
    if(!dst||!src)return false;
    // Each span needs one bit per light slot; prepare the destination mask table
    // before detaching the source registry so a failure changes nothing.
    uint32_t *masks=NULL;int mask_words=dst->span_light_words;
    if(dst->span_light_masks&&dst->span_count>0){
        const int words=light_mask_words(src->light_capacity);
        if(words>dst->span_light_words){
            masks=calloc((size_t)dst->span_count*(size_t)words,sizeof *masks);
            if(!masks)return false;
            for(int i=0;i<dst->span_count;i++)
                memcpy(masks+(size_t)i*words,dst->span_light_masks+(size_t)i*dst->span_light_words,
                       (size_t)dst->span_light_words*sizeof *masks);
            mask_words=words;
        }
    }
    r2d_world_light_registry_free(dst);
    if(masks){free(dst->span_light_masks);dst->span_light_masks=masks;}
    dst->span_light_words=mask_words;
    dst->lights=src->lights;dst->light_links=src->light_links;
    dst->light_dirty_slots=src->light_dirty_slots;
    dst->shadow_mask=src->shadow_mask;dst->shadow_geometry_revision=src->shadow_geometry_revision;
    dst->light_capacity=src->light_capacity;dst->light_count=src->light_count;
    dst->light_dirty=src->light_dirty;dst->light_full_dirty=src->light_full_dirty;
    src->lights=NULL;src->light_links=NULL;src->light_dirty_slots=NULL;
    src->shadow_mask=NULL;src->shadow_geometry_revision=NULL;
    src->light_capacity=src->light_count=0;
    return true;
}
void r2d_world_light_free(R2DRe2dWorld *w)
{
    if(!w)return;
    free(w->span_lights);free(w->span_light_counts);free(w->span_light_refs);free(w->span_light_masks);free(w->span_light_candidates);
    free(w->light_queue);free(w->light_seen);free(w->light_touched);free(w->light_touched_flags);
    w->span_lights=NULL;w->span_light_counts=NULL;w->span_light_refs=NULL;w->span_light_masks=NULL;w->span_light_candidates=NULL;
    w->light_queue=NULL;w->light_seen=NULL;w->light_touched=NULL;w->light_touched_flags=NULL;
    w->span_light_words=0;
    r2d_world_light_registry_free(w);
}
static bool ensure(R2DRe2dWorld *w)
{
    if(!w)return false;
    if(!w->light_capacity&&!light_registry_reserve(w,R2D_WORLD_MAX_LIGHTS))return false;
    if(w->span_lights&&w->span_light_masks)return true;
    int n=w->span_count;if(!n)return true;
    const int words=light_mask_words(w->light_capacity);
    R2DWorldSpanLight *ambient=calloc((size_t)n,sizeof *ambient);
    uint8_t *counts=calloc((size_t)n,1),*candidates=calloc((size_t)n,1),*seen=calloc((size_t)n,1),*flags=calloc((size_t)n,1);
    int *refs=calloc((size_t)n*R2D_WORLD_LIGHTS_PER_SPAN,sizeof *refs),*queue=malloc((size_t)n*sizeof(int)),*touched=malloc((size_t)n*sizeof(int));
    uint32_t *masks=calloc((size_t)n*(size_t)words,sizeof *masks);
    if(!ambient||!counts||!refs||!candidates||!seen||!flags||!queue||!touched||!masks){free(ambient);free(counts);free(refs);free(candidates);free(seen);free(flags);free(queue);free(touched);free(masks);return false;}
    for(int i=0;i<n;i++)ambient[i]=w->span_lights?w->span_lights[i]:(R2DWorldSpanLight){1,1,1,1,0,0,0,0,0};
    free(w->span_lights);free(w->span_light_counts);free(w->span_light_refs);
    w->span_lights=ambient;w->span_light_counts=counts;w->span_light_refs=refs;w->span_light_masks=masks;w->span_light_candidates=candidates;
    w->span_light_words=words;
    w->light_queue=queue;w->light_seen=seen;w->light_touched=touched;w->light_touched_flags=flags;
    w->light_dirty=true;w->light_full_dirty=true;return true;
}
bool r2d_world_set_lighting(R2DRe2dWorld *w,const R2DWorldLighting *l)
{
    if(!w||!l||!isfinite(l->distance_scale)||l->distance_scale<0||!isfinite(l->orientation_strength)||l->orientation_strength<0||l->orientation_strength>1||!ensure(w))return false;
    w->lighting=*l;return true;
}
bool r2d_world_set_span_light(R2DRe2dWorld *w,int span,const R2DWorldSpanLight *l)
{
    if(!w||span<0||span>=w->span_count||!l)return false;
    const float values[]={l->level,l->r,l->g,l->b,l->fog_density,l->fog_start,l->fog_r,l->fog_g,l->fog_b};
    for(int i=0;i<9;i++)if(!isfinite(values[i])||values[i]<0)return false;
    if(l->level>1||l->r>1||l->g>1||l->b>1||l->fog_r>1||l->fog_g>1||l->fog_b>1||!ensure(w))return false;
    w->span_lights[span]=*l;return true;
}
int r2d_world_light_create(R2DRe2dWorld *w,const R2DWorldLight *l)
{
    if(!w||!r2d_world_light_valid(l)||!ensure(w))return -1;
    for(int i=0;i<w->light_capacity;i++)if(!w->lights[i].active) {
        // Exhausted-generation slots retire instead of accepting stale tokens.
        unsigned gen=w->lights[i].generation;
        if(gen>=R2D_WORLD_LIGHT_GENERATION_MAX)continue;
        gen++;
        w->lights[i]=*l;w->lights[i].active=true;w->lights[i].generation=gen;w->light_count++;w->light_dirty=true;w->light_dirty_slots[i]=1;
        return light_token(gen,i);
    }
    // No retired/free slot: grow the registry. Slots are bounded only by the
    // opaque-token packing (17 bits), which is a token-format safety limit.
    if(w->light_capacity>=R2D_WORLD_LIGHT_TOKEN_STRIDE)return -1;
    const int slot=w->light_capacity;
    if(!light_registry_reserve(w,slot+1))return -1;
    w->lights[slot]=*l;w->lights[slot].active=true;w->lights[slot].generation=1;
    w->light_dirty_slots[slot]=1;w->light_count++;w->light_dirty=true;
    return light_token(1,slot);
}
bool r2d_world_light_update(R2DRe2dWorld *w,int token,const R2DWorldLight *l)
{
    int slot=r2d_world_light_slot(w,token);if(slot<0||!r2d_world_light_valid(l))return false;unsigned generation=w->lights[slot].generation;
    R2DWorldLight old=w->lights[slot];w->lights[slot]=*l;
    w->lights[slot].is_static=old.is_static;w->lights[slot].remaining=old.remaining;w->lights[slot].age=old.age;
    w->lights[slot].flicker_min=old.flicker_min;w->lights[slot].flicker_max=old.flicker_max;w->lights[slot].flicker_rate=old.flicker_rate;w->lights[slot].flicker_seed=old.flicker_seed;
    w->lights[slot].active=true;w->lights[slot].generation=generation;w->light_dirty=true;w->light_dirty_slots[slot]=1;return true;
}
bool r2d_world_light_remove(R2DRe2dWorld *w,int token)
{ int slot=r2d_world_light_slot(w,token);if(slot<0)return false;w->lights[slot].active=false;w->light_count--;w->light_dirty=true;w->light_dirty_slots[slot]=1;return true; }
static float box_distance(float p,float lo,float hi)
{ return p<lo?lo-p:p>hi?p-hi:0; }
static bool affects(const R2DWorldLight *l,const R2DWorldSpan *s)
{
    float bottom,top;r2d_world_span_height_bounds(s,&bottom,&top);
    float x=box_distance(l->x,s->x,s->x+s->w),y=box_distance(l->y,s->y,s->y+s->h),h=box_distance(l->h,bottom,top);
    return x*x+y*y+h*h<l->radius*l->radius;
}
static bool opening_near(const R2DWorldLight *l,const R2DWorldPortal *p,const R2DWorldOpening *o)
{
    float dx=p->bx-p->ax,dy=p->by-p->ay,t=((l->x-p->ax)*dx+(l->y-p->ay)*dy)/(dx*dx+dy*dy);
    t=fmaxf(0,fminf(1,t));dx=l->x-p->ax-t*dx;dy=l->y-p->ay-t*dy;float h=box_distance(l->h,o->bottom,o->top);
    return dx*dx+dy*dy+h*h<l->radius*l->radius;
}
void r2d_world_light_invalidate_box(R2DRe2dWorld *w,float x0,float y0,float h0,float x1,float y1,float h1)
{
    for(int i=0;i<w->light_capacity;i++)if(w->lights[i].active){const R2DWorldLight *l=&w->lights[i];
        float dx=box_distance(l->x,x0,x1),dy=box_distance(l->y,y0,y1),dh=box_distance(l->h,h0,h1);
        if(dx*dx+dy*dy+dh*dh<=l->radius*l->radius){w->light_dirty_slots[i]=1;w->light_dirty=true;w->shadow_geometry_revision[i]++;}
    }
}
static void touched(R2DRe2dWorld *w,int span)
{if(!w->light_touched_flags[span]){w->light_touched_flags[span]=1;w->light_touched[w->light_touched_count++]=span;}}
static bool link_append(R2DWorldLightLinks *links,int span)
{
    if(links->count==links->capacity){int cap=links->capacity?links->capacity*2:16;int *p=realloc(links->spans,(size_t)cap*sizeof(int));if(!p)return false;links->spans=p;links->capacity=cap;}
    links->spans[links->count++]=span;return true;
}
static void clear_seen(R2DRe2dWorld *w)
{for(int i=0;i<w->light_seen_count;i++)w->light_seen[w->light_queue[i]]=0;w->light_seen_count=0;}
bool r2d_world_light_rebuild(R2DRe2dWorld *w)
{
    if(!w||!ensure(w))return false;w->light_updates=0;if(!w->light_dirty)return true;
    memset(w->shadow_mask,0,(size_t)w->light_capacity);
    // Shadow quality ranking: R2D_WORLD_MAX_SHADOWS is a BUDGET, not a creation
    // ceiling. Rank every active shadow-casting light by deterministic
    // influence (intensity * radius^2) and keep the top N; light #17 is created
    // normally and simply competes for a shadow slot.
    {
        int best_slot[R2D_WORLD_MAX_SHADOWS];double best_score[R2D_WORLD_MAX_SHADOWS];int shadowed=0;
        for(int i=0;i<w->light_capacity;i++){
            const R2DWorldLight *l=&w->lights[i];
            if(!l->active||!l->shadow)continue;
            const double score=(double)l->intensity*(double)l->radius*(double)l->radius;
            int insert=shadowed;
            if(insert>=R2D_WORLD_MAX_SHADOWS){
                insert=R2D_WORLD_MAX_SHADOWS-1;
                if(score<=best_score[insert])continue;
            }else shadowed++;
            while(insert>0&&best_score[insert-1]<score){best_score[insert]=best_score[insert-1];best_slot[insert]=best_slot[insert-1];insert--;}
            best_score[insert]=score;best_slot[insert]=i;
        }
        for(int i=0;i<shadowed;i++)w->shadow_mask[best_slot[i]]=1;
    }
    if(w->light_full_dirty){memset(w->light_dirty_slots,1,(size_t)w->light_capacity);w->light_full_dirty=false;}
    clear_seen(w);
    for(int light=0;light<w->light_capacity;light++)if(w->light_dirty_slots[light]){
        R2DWorldLightLinks *links=&w->light_links[light];uint32_t bit=1u<<(light&31);int word=light/32;
        for(int i=0;i<links->count;i++){int span=links->spans[i];w->span_light_masks[(size_t)span*w->span_light_words+word]&=~bit;touched(w,span);}links->count=0;
        const R2DWorldLight *l=&w->lights[light];w->light_updates++;
        if(!l->active){w->light_dirty_slots[light]=0;continue;}
        int head=0,tail=0,start=r2d_world_span_at(w,l->x,l->y,l->h);int *queue=w->light_queue;uint8_t *seen=w->light_seen;
        if(w->cell_count){if(start>=0){queue[tail++]=start;seen[start]=1;}}
        else for(int i=0;i<w->span_count;i++)if(affects(l,&w->spans[i])){queue[tail++]=i;seen[i]=1;}
        w->light_seen_count=tail;
        while(head<tail){
            int span=queue[head++];const R2DWorldSpan *from=&w->spans[span];if(!affects(l,from))continue;
            if(!link_append(links,span))return false;
            w->span_light_masks[(size_t)span*w->span_light_words+word]|=bit;touched(w,span);
            if(!w->cell_count)continue;int cell=w->span_cells[span];
            for(int pi=w->cell_portal_offsets[cell];pi<w->cell_portal_offsets[cell+1];pi++){
                const R2DWorldPortal *portal=&w->portals[w->cell_portal_refs[pi]];if(portal->closed)continue;
                int other=portal->cell_a==cell?portal->cell_b:portal->cell_a;const R2DWorldCell *c=&w->cells[other];
                for(int j=0;j<portal->opening_count;j++)for(int k=0;k<c->span_count;k++){
                    int dest=c->first_span+k;const R2DWorldSpan *to=&w->spans[dest];R2DWorldOpening clipped;
                    if(!seen[dest]&&r2d_world_opening_between(from,to,portal,&w->openings[portal->first_opening+j],&clipped)&&opening_near(l,portal,&clipped)&&affects(l,to)){
                        seen[dest]=1;queue[tail++]=dest;w->light_seen_count=tail;
                    }
                }
            }
        }
        clear_seen(w);w->light_dirty_slots[light]=0;
    }
    for(int i=0;i<w->light_touched_count;i++){
        const int span=w->light_touched[i];
        uint32_t *mask=w->span_light_masks+(size_t)span*w->span_light_words;
        const R2DWorldSpan *s=&w->spans[span];
        // Per-span shader budget: keep the top R2D_WORLD_LIGHTS_PER_SPAN by
        // deterministic contribution (sampling falloff at the span centre).
        // Ties keep ascending slot order, so native priority stays stable.
        int best_slot[R2D_WORLD_LIGHTS_PER_SPAN];float best_score[R2D_WORLD_LIGHTS_PER_SPAN];
        int kept=0,total=0;
        for(int slot=0;slot<w->light_capacity;slot++)if(mask[slot/32]&(1u<<(slot&31))){
            total++;
            const R2DWorldLight *l=&w->lights[slot];
            const float cx=s->x+s->w*0.5f,cy=s->y+s->h*0.5f;
            const float dx=l->x-cx,dy=l->y-cy,dh=l->h-(s->bottom+s->top)*0.5f;
            const float dist=sqrtf(dx*dx+dy*dy+dh*dh);
            float score=0.0f;
            if(dist<l->radius){const float t=1.0f-dist/l->radius;score=l->intensity*t*t;}
            int insert=kept;
            if(insert>=R2D_WORLD_LIGHTS_PER_SPAN){
                insert=R2D_WORLD_LIGHTS_PER_SPAN-1;
                if(score<=best_score[insert])continue;
            }else kept++;
            while(insert>0&&best_score[insert-1]<score){
                best_score[insert]=best_score[insert-1];best_slot[insert]=best_slot[insert-1];insert--;
            }
            best_score[insert]=score;best_slot[insert]=slot;
        }
        const int count=kept;
        for(int j=0;j<count;j++)w->span_light_refs[span*R2D_WORLD_LIGHTS_PER_SPAN+j]=best_slot[j];
        const int old=w->span_light_candidates[span];
        w->light_pairs+=count-w->span_light_counts[span];
        w->light_overflow+=(total>R2D_WORLD_LIGHTS_PER_SPAN?total-R2D_WORLD_LIGHTS_PER_SPAN:0)-(old>R2D_WORLD_LIGHTS_PER_SPAN?old-R2D_WORLD_LIGHTS_PER_SPAN:0);
        w->span_light_counts[span]=(uint8_t)count;
        // uint8 telemetry saturates instead of wrapping for huge light worlds.
        w->span_light_candidates[span]=(uint8_t)(total>255?255:total);w->light_touched_flags[span]=0;
    }
    w->light_touched_count=0;w->light_dirty=false;return true;
}
void r2d_world_light_sample(const R2DRe2dWorld *w,int span,float x,float y,float h,float nx,float ny,float nh,float depth,float out[3])
{
    out[0]=out[1]=out[2]=1;
    if(!w||!w->lighting.enabled||!w->span_lights||span<0||span>=w->span_count)return;
    const R2DWorldSpanLight *a=&w->span_lights[span];
    float contrast=w->lighting.orientation?1+w->lighting.orientation_strength*(fabsf(nx)-fabsf(ny)):1;
    float distance=1/(1+fmaxf(0,depth)*w->lighting.distance_scale),base=a->level*contrast*distance;
    out[0]=a->r*base;out[1]=a->g*base;out[2]=a->b*base;
    if(!w->lighting.dynamic)return;
    for(int j=0;j<w->span_light_counts[span];j++) {
        const R2DWorldLight *l=&w->lights[w->span_light_refs[span*R2D_WORLD_LIGHTS_PER_SPAN+j]];
        float dx=l->x-x,dy=l->y-y,dh=l->h-h,dist=sqrtf(dx*dx+dy*dy+dh*dh);if(dist>=l->radius)continue;
        float response=nx==0&&ny==0&&nh==0?1:dist>1e-5f?fmaxf(0,(nx*dx+ny*dy+nh*dh)/dist):1;
        if(response<=0)continue;
        if(w->lighting.shadows&&w->shadow_mask[w->span_light_refs[span*R2D_WORLD_LIGHTS_PER_SPAN+j]]) {
            float o[3]={l->x,l->y,l->h},d[3]={x-l->x,y-l->y,h-l->h};R2DWorldHit hit;
            if(r2d_world_ray(w,o,d,.0001f,.9999f,&hit))continue;
        }
        float flicker=1;
        if(l->flicker_rate>0){uint32_t state=l->flicker_seed^(uint32_t)floorf(l->age*l->flicker_rate);state^=state<<13;state^=state>>17;state^=state<<5;flicker=l->flicker_min+(l->flicker_max-l->flicker_min)*(state/4294967295.0f);}
        float t=1-dist/l->radius,power=l->intensity*flicker*t*t*response;
        out[0]+=l->r*power;out[1]+=l->g*power;out[2]+=l->b*power;
    }
}
uint32_t r2d_world_lit_color(const R2DRe2dWorld *w,int span,uint32_t color,float x,float y,float h,float nx,float ny,float nh,float depth)
{
    if(!w->lighting.enabled||span<0||span>=w->span_count)return color;
    float light[3];r2d_world_light_sample(w,span,x,y,h,nx,ny,nh,depth,light);uint32_t result=color&0xff000000;
    const R2DWorldSpanLight *a=&w->span_lights[span];float fog=a->fog_density>0?1-expf(-a->fog_density*fmaxf(0,depth-a->fog_start)):0;
    const float fog_color[3]={a->fog_r,a->fog_g,a->fog_b};
    for(int i=0;i<3;i++){float v=((color>>(i*8))&255)*light[i];v=v*(1-fog)+fog_color[i]*255*fog;unsigned channel=(unsigned)fmaxf(0,fminf(255,roundf(v)));result|=channel<<(i*8);}
    return result;
}

bool r2d_world_light_visual(R2DRe2dWorld *w,int token,float life,float min,float max,float rate,uint32_t seed)
{
    int slot=r2d_world_light_slot(w,token);if(slot<0||!isfinite(life)||life<0||life>1000000||!isfinite(min)||!isfinite(max)||min<0||max<min||max>100||!isfinite(rate)||rate<0||rate>1000)return false;
    R2DWorldLight *l=&w->lights[slot];l->remaining=life;l->flicker_min=min;l->flicker_max=max;l->flicker_rate=rate;l->flicker_seed=seed;return true;
}
void r2d_world_light_step(R2DRe2dWorld *w,float dt)
{
    if(!w||!isfinite(dt)||dt<0)return;
    for(int i=0;i<w->light_capacity;i++) {
        R2DWorldLight *l=&w->lights[i];if(!l->active)continue;
        // Bounded age prevents integer-overflow conversion in deterministic flicker.
        l->age=fmodf(l->age+dt,1000000);
        if(l->remaining>0){l->remaining-=dt;if(l->remaining<=0){l->remaining=0;l->active=false;w->light_count--;w->light_dirty=true;w->light_dirty_slots[i]=1;}}
    }
}

static bool json_number(const R2dJson *o,const char *key,float fallback,float *out)
{const R2dJson *v=r2d_json_get(o,key);if(!v){*out=fallback;return isfinite(fallback);}if(v->type!=R2D_JSON_NUM||!isfinite(v->number)||fabs(v->number)>1e6)return false;*out=(float)v->number;return true;}
static bool json_bool(const R2dJson *o,const char *key,bool fallback,bool *out)
{const R2dJson *v=r2d_json_get(o,key);if(!v){*out=fallback;return true;}if(v->type!=R2D_JSON_BOOL)return false;*out=v->boolean;return true;}
static bool json_color(const R2dJson *o,const char *key,float default_r,float default_g,float default_b,float *r,float *g,float *b)
{
    const R2dJson *v=r2d_json_get(o,key);*r=default_r;*g=default_g;*b=default_b;if(!v)return true;
    if(v->type!=R2D_JSON_STR||strlen(v->string)!=7||v->string[0]!='#')return false;
    char *end;unsigned long color=strtoul(v->string+1,&end,16);if(*end||color>0xffffff)return false;
    for(int i=1;i<7;i++)if(!((v->string[i]>='0'&&v->string[i]<='9')||(v->string[i]>='a'&&v->string[i]<='f')||(v->string[i]>='A'&&v->string[i]<='F')))return false;
    *r=((color>>16)&255)/255.0f;*g=((color>>8)&255)/255.0f;*b=(color&255)/255.0f;return true;
}
bool r2d_world_span_light_json(const R2dJson *o,R2DWorldSpanLight *l)
{
    *l=(R2DWorldSpanLight){1,1,1,1,0,0,0,0,0};if(!o)return true;if(o->type!=R2D_JSON_OBJ)return false;
    const R2dJson *fog=r2d_json_get(o,"fog");if(fog&&fog->type!=R2D_JSON_OBJ)return false;
    return json_number(o,"level",1,&l->level)&&l->level>=0&&l->level<=1&&json_color(o,"color",1,1,1,&l->r,&l->g,&l->b)&&
        json_number(fog,"density",0,&l->fog_density)&&l->fog_density>=0&&json_number(fog,"start",0,&l->fog_start)&&l->fog_start>=0&&json_color(fog,"color",0,0,0,&l->fog_r,&l->fog_g,&l->fog_b);
}
bool r2d_world_load_lighting(R2DRe2dWorld *w,const R2dJson *root,char *err,size_t size)
{
    const R2dJson *config=r2d_json_get(root,"lighting"),*lights=r2d_json_get(root,"lights");
    if(!config&&!lights&&!w->span_lights)return true;
    w->authored_lighting=true;
    if((config&&config->type!=R2D_JSON_OBJ)||(lights&&(lights->type!=R2D_JSON_ARR||lights->count<0)))goto bad;
    const R2dJson *mode=r2d_json_get(config,"mode");if(mode&&(mode->type!=R2D_JSON_STR||strcmp(mode->string,"classic")))goto bad;
    R2DWorldLighting l;
    if(!json_bool(config,"enabled",true,&l.enabled)||!json_bool(config,"dynamic",true,&l.dynamic)||!json_bool(config,"shadows",false,&l.shadows)||!json_bool(config,"orientationContrast",true,&l.orientation)||
       !json_number(config,"distanceScale",.001f,&l.distance_scale)||!json_number(config,"orientationStrength",.06f,&l.orientation_strength)||!r2d_world_set_lighting(w,&l))goto bad;
    for(int i=0;lights&&i<lights->count;i++){
        const R2dJson *o=lights->items[i];R2DWorldLight light={0};if(o->type!=R2D_JSON_OBJ)goto bad;
        if(!json_number(o,"x",NAN,&light.x)||!json_number(o,"y",NAN,&light.y)||!json_number(o,"h",NAN,&light.h)||!json_number(o,"radius",NAN,&light.radius)||!json_number(o,"intensity",1,&light.intensity)||
           !json_color(o,"color",1,1,1,&light.r,&light.g,&light.b)||!json_bool(o,"shadow",false,&light.shadow))goto bad;
        light.is_static=true;if(r2d_world_light_create(w,&light)<0)goto bad;
    }
    if(!r2d_world_light_rebuild(w))goto bad;return true;
bad:if(err&&size)snprintf(err,size,"Re2D World: invalid classic lighting/static light data");return false;
}
