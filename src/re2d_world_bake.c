#include "re2d_world_bake.h"
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static void put_u(R2dSb *s,uint32_t u)
{for(int i=0;i<4;i++)r2d_sb_putc(s,(char)(u>>(i*8)));}
static void put_f(R2dSb *s,float f)
{uint32_t u;memcpy(&u,&f,4);put_u(s,u);}
static uint64_t checksum(const uint8_t *data,size_t size)
{uint64_t h=1469598103934665603ULL;for(size_t i=0;i<size;i++)h=(h^data[i])*1099511628211ULL;return h;}
bool r2d_world_put_baked(R2DRe2dWorld *w,R2dSb *out)
{
    if(!r2d_world_light_rebuild(w))return false;
    R2dSb s;r2d_sb_init(&s);bool lit=w->span_lights!=NULL||w->authored_lighting||w->light_count>0;put_u(&s,lit?0x32574452:0x31574452); // RDW1/RDW2 wire marker
    int nr=w->span_wall_offsets[w->span_count];const int counts[]={w->wall_count,w->span_count,w->cell_count,w->portal_count,w->opening_count,w->surface_count,w->cell_node_count,w->cell_root,nr};
    for(int i=0;i<9;i++)put_u(&s,(uint32_t)counts[i]);
    for(int i=0;i<w->wall_count;i++){const R2DWorldWall *p=&w->walls[i];put_f(&s,p->x1);put_f(&s,p->y1);put_f(&s,p->x2);put_f(&s,p->y2);put_f(&s,p->bottom);put_f(&s,p->top);put_u(&s,p->color);}
    for(int i=0;i<w->span_count;i++){const R2DWorldSpan *p=&w->spans[i];put_f(&s,p->x);put_f(&s,p->y);put_f(&s,p->w);put_f(&s,p->h);put_f(&s,p->bottom);put_f(&s,p->top);put_u(&s,p->floor_color);put_u(&s,p->ceiling_color);put_f(&s,p->floor_a);put_f(&s,p->floor_b);put_f(&s,p->ceiling_a);put_f(&s,p->ceiling_b);}
    for(int i=0;i<w->cell_count;i++){const R2DWorldCell *p=&w->cells[i];put_f(&s,p->x);put_f(&s,p->y);put_f(&s,p->w);put_f(&s,p->h);put_u(&s,p->first_span);put_u(&s,p->span_count);}
    for(int i=0;i<w->portal_count;i++){const R2DWorldPortal *p=&w->portals[i];put_u(&s,p->cell_a);put_u(&s,p->cell_b);put_u(&s,p->first_opening);put_u(&s,p->opening_count);put_f(&s,p->ax);put_f(&s,p->ay);put_f(&s,p->bx);put_f(&s,p->by);put_u(&s,p->closed?1:0);}
    for(int i=0;i<w->opening_count;i++){put_f(&s,w->openings[i].bottom);put_f(&s,w->openings[i].top);}
    for(int i=0;i<w->surface_count;i++){const R2DWorldSurface *p=&w->surfaces[i];put_u(&s,p->kind);put_u(&s,p->primitive);put_u(&s,p->cell);put_u(&s,p->span);}
    for(int i=0;i<w->cell_node_count;i++){const R2DWorldCellNode *p=&w->cell_nodes[i];put_f(&s,p->split);put_u(&s,p->axis);put_u(&s,p->front);put_u(&s,p->back);put_u(&s,p->first_ref);put_u(&s,p->ref_count);}
#define ARRAY(field,count) for(int i=0;i<(count);i++)put_u(&s,(uint32_t)w->field[i])
    ARRAY(cell_refs,w->cell_count);ARRAY(span_cells,w->span_count);ARRAY(wall_portals,w->wall_count);ARRAY(wall_openings,w->wall_count);
    ARRAY(opening_spans_a,w->opening_count);ARRAY(opening_spans_b,w->opening_count);
    ARRAY(span_wall_offsets,w->span_count+1);ARRAY(span_wall_refs,nr);ARRAY(cell_portal_offsets,w->cell_count+1);ARRAY(cell_portal_refs,w->portal_count*2);
#undef ARRAY
    if(lit){
        const R2DWorldLighting *l=&w->lighting;put_u(&s,l->enabled);put_u(&s,l->dynamic);put_u(&s,l->shadows);put_u(&s,l->orientation);put_u(&s,w->authored_lighting);put_f(&s,l->distance_scale);put_f(&s,l->orientation_strength);
        for(int i=0;i<128;i++){const R2DWorldLight *p=&w->lights[i];put_u(&s,(p->active?1u:0u)|(p->is_static?2u:0u));put_u(&s,p->generation);put_f(&s,p->x);put_f(&s,p->y);put_f(&s,p->h);put_f(&s,p->radius);put_f(&s,p->intensity);put_f(&s,p->r);put_f(&s,p->g);put_f(&s,p->b);put_u(&s,p->shadow);put_f(&s,p->remaining);put_f(&s,p->age);put_f(&s,p->flicker_min);put_f(&s,p->flicker_max);put_f(&s,p->flicker_rate);put_u(&s,p->flicker_seed);}
        for(int i=0;i<w->span_count;i++){const R2DWorldSpanLight *p=&w->span_lights[i];put_f(&s,p->level);put_f(&s,p->r);put_f(&s,p->g);put_f(&s,p->b);put_f(&s,p->fog_density);put_f(&s,p->fog_start);put_f(&s,p->fog_r);put_f(&s,p->fog_g);put_f(&s,p->fog_b);for(int j=0;j<4;j++)put_u(&s,w->span_light_masks[i*4+j]);}
        for(int i=0;i<128;i++){const R2DWorldLightLinks *p=&w->light_links[i];put_u(&s,p->count);for(int j=0;j<p->count;j++)put_u(&s,p->spans[j]);}
    }
    r2d_sb_printf(out,"\"baked\":{\"version\":%d,\"checksum\":\"%016llx\",\"encoding\":\"le32-hex\",\"data\":\"",lit?2:1,(unsigned long long)checksum((const uint8_t *)s.data,s.len));
    static const char hex[]="0123456789abcdef";for(size_t i=0;i<s.len;i++){uint8_t b=(uint8_t)s.data[i];r2d_sb_putc(out,hex[b>>4]);r2d_sb_putc(out,hex[b&15]);}r2d_sb_puts(out,"\"}");r2d_sb_free(&s);return true;
}
typedef struct { const uint8_t *data;size_t size,offset;bool ok; } Reader;
static uint32_t get_u(Reader *r)
{if(r->offset+4>r->size){r->ok=false;return 0;}uint32_t u=0;for(int i=0;i<4;i++)u|=(uint32_t)r->data[r->offset++]<<(i*8);return u;}
static float get_f(Reader *r)
{uint32_t u=get_u(r);float f;memcpy(&f,&u,4);if(!isfinite(f)||fabsf(f)>1e6f)r->ok=false;return f;}
static bool range(int first,int count,int total)
{return first>=0&&count>=0&&first<=total&&count<=total-first;}
static bool node_validate(const R2DRe2dWorld *w,int node,int depth,uint8_t *seen_nodes,uint8_t *seen_cells,float xmin,float ymin,float xmax,float ymax)
{
    if(node<0)return node==-1;if(node>=w->cell_node_count||depth>48||seen_nodes[node])return false;seen_nodes[node]=1;
    const R2DWorldCellNode *n=&w->cell_nodes[node];if(n->axis<0||n->axis>1||!range(n->first_ref,n->ref_count,w->cell_count))return false;
    for(int i=0;i<n->ref_count;i++){int id=w->cell_refs[n->first_ref+i];if(id<0||id>=w->cell_count||seen_cells[id])return false;seen_cells[id]=1;const R2DWorldCell *c=&w->cells[id];
        if(c->x<xmin||c->y<ymin||c->x+c->w>xmax||c->y+c->h>ymax)return false;}
    float fminx=n->axis?xmin:fmaxf(xmin,n->split),fminy=n->axis?fmaxf(ymin,n->split):ymin;
    float bmaxx=n->axis?xmax:fminf(xmax,n->split),bmaxy=n->axis?fminf(ymax,n->split):ymax;
    return node_validate(w,n->front,depth+1,seen_nodes,seen_cells,fminx,fminy,xmax,ymax)&&node_validate(w,n->back,depth+1,seen_nodes,seen_cells,xmin,ymin,bmaxx,bmaxy);
}
static bool validate(const R2DRe2dWorld *w,int refs)
{
    if(w->surface_count!=w->wall_count+w->span_count*2)return false;
    int span=0;for(int i=0;i<w->cell_count;i++){const R2DWorldCell *c=&w->cells[i];if(c->w<=0||c->h<=0||c->span_count<=0||c->first_span!=span||!range(c->first_span,c->span_count,w->span_count))return false;
        for(int j=0;j<c->span_count;j++,span++){const R2DWorldSpan *s=&w->spans[span];if(w->span_cells[span]!=i||s->x!=c->x||s->y!=c->y||s->w!=c->w||s->h!=c->h)return false;
            for(int k=0;k<4;k++){float x=s->x+(k&1?s->w:0),y=s->y+(k&2?s->h:0);if(r2d_world_floor_height(s,x,y)>=r2d_world_ceiling_height(s,x,y))return false;}}
    }if(span!=w->span_count)return false;
    for(int i=0;i<w->wall_count;i++){const R2DWorldWall *s=&w->walls[i];if(s->top<=s->bottom||(s->x1==s->x2&&s->y1==s->y2)||w->wall_portals[i]<0||w->wall_portals[i]>w->portal_count||w->wall_openings[i]<0||w->wall_openings[i]>w->opening_count)return false;
        if((w->wall_portals[i]==0)!=(w->wall_openings[i]==0))return false;
        if(w->wall_portals[i]){const R2DWorldPortal *p=&w->portals[w->wall_portals[i]-1];int oi=w->wall_openings[i]-1;
            if(!range(p->first_opening,p->opening_count,w->opening_count))return false;
            if(!range(oi,1,w->opening_count)||oi<p->first_opening||oi>=p->first_opening+p->opening_count||s->x1!=p->ax||s->y1!=p->ay||s->x2!=p->bx||s->y2!=p->by||s->bottom!=w->openings[oi].bottom||s->top!=w->openings[oi].top)return false;}
    }
    for(int i=0;i<w->portal_count;i++){const R2DWorldPortal *p=&w->portals[i];if(p->cell_a<0||p->cell_a>=w->cell_count||p->cell_b<0||p->cell_b>=w->cell_count||p->cell_a==p->cell_b||p->opening_count<=0||!range(p->first_opening,p->opening_count,w->opening_count))return false;
        for(int j=0;j<p->opening_count;j++){int oi=p->first_opening+j,a=w->opening_spans_a[oi],b=w->opening_spans_b[oi];if(a<0||a>=w->span_count||b<0||b>=w->span_count||w->span_cells[a]!=p->cell_a||w->span_cells[b]!=p->cell_b)return false;
            if(w->openings[oi].top<=w->openings[oi].bottom||!r2d_world_span_opening(&w->spans[a],p,&w->openings[oi])||!r2d_world_span_opening(&w->spans[b],p,&w->openings[oi]))return false;}}
    for(int i=0;i<w->surface_count;i++){const R2DWorldSurface *s=&w->surfaces[i];if(i<w->wall_count){if(s->kind!=R2D_WORLD_WALL||s->primitive!=i||s->cell!=-1||s->span!=-1)return false;}
        else{int k=i-w->wall_count,expected=k/2;if(s->kind!=(k%2?R2D_WORLD_CEILING:R2D_WORLD_FLOOR)||s->primitive!=expected||s->span!=expected||s->cell!=w->span_cells[expected])return false;}}
    if(w->span_wall_offsets[0]!=0||w->span_wall_offsets[w->span_count]!=refs||w->cell_portal_offsets[0]!=0||w->cell_portal_offsets[w->cell_count]!=w->portal_count*2)return false;
    for(int i=0;i<w->span_count;i++)if(!range(w->span_wall_offsets[i],w->span_wall_offsets[i+1]-w->span_wall_offsets[i],refs))return false;
    for(int i=0;i<refs;i++)if(w->span_wall_refs[i]<0||w->span_wall_refs[i]>=w->wall_count)return false;
    for(int i=0;i<w->cell_count;i++){int first=w->cell_portal_offsets[i],count=w->cell_portal_offsets[i+1]-first;if(!range(first,count,w->portal_count*2))return false;
        for(int j=first;j<first+count;j++){int id=w->cell_portal_refs[j];if(id<0||id>=w->portal_count||(w->portals[id].cell_a!=i&&w->portals[id].cell_b!=i))return false;}}
    uint8_t *seen_nodes=calloc((size_t)w->cell_node_count+1,1),*seen_cells=calloc((size_t)w->cell_count+1,1);if(!seen_nodes||!seen_cells){free(seen_nodes);free(seen_cells);return false;}
    bool ok=node_validate(w,w->cell_root,0,seen_nodes,seen_cells,-INFINITY,-INFINITY,INFINITY,INFINITY);
    for(int i=0;i<w->cell_count;i++)if(!seen_cells[i])ok=false;for(int i=0;i<w->cell_node_count;i++)if(!seen_nodes[i])ok=false;free(seen_nodes);free(seen_cells);return ok;
}
static int hex(char c)
{return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1;}
bool r2d_world_load_baked(R2DRe2dWorld *world,const R2dJson *obj,char *err,size_t size)
{
    R2DRe2dWorld w={0};w.bsp.root=w.cell_root=-1;bool ok=false;uint8_t *bytes=NULL;
    const char *data=r2d_json_str(r2d_json_get(obj,"data"),NULL),*sum=r2d_json_str(r2d_json_get(obj,"checksum"),NULL),*encoding=r2d_json_str(r2d_json_get(obj,"encoding"),"");
    double wire_version=r2d_json_num(r2d_json_get(obj,"version"),0);
    int version=wire_version==1?1:wire_version==2?2:0;
    if((version!=1&&version!=2)||strcmp(encoding,"le32-hex")||!data||!sum)goto done;
    size_t length=strlen(data);if(length%2||length>128*1024*1024||length<80)goto done;bytes=malloc(length/2);if(!bytes)goto done;
    for(size_t i=0;i<length/2;i++){int a=hex(data[i*2]),b=hex(data[i*2+1]);if(a<0||b<0)goto done;bytes[i]=(uint8_t)(a*16+b);}
    char actual[17];snprintf(actual,sizeof actual,"%016llx",(unsigned long long)checksum(bytes,length/2));if(strcmp(sum,actual))goto done;
    Reader r={bytes,length/2,0,true};if(get_u(&r)!=(version==2?0x32574452u:0x31574452u))goto done;
    int *counts[]={&w.wall_count,&w.span_count,&w.cell_count,&w.portal_count,&w.opening_count,&w.surface_count,&w.cell_node_count,&w.cell_root};
    for(int i=0;i<8;i++)*counts[i]=(int32_t)get_u(&r);int refs=(int32_t)get_u(&r);
    for(int i=0;i<5;i++)if(*counts[i]<0||*counts[i]>65536)goto done;
    if(w.surface_count<0||w.surface_count>196608||w.cell_node_count<0||w.cell_node_count>w.cell_count*2||refs<0||refs>1048576||w.cell_root<-1||w.cell_root>=w.cell_node_count)goto done;
#define A(field,count) do{w.field=calloc((size_t)(count)+1,sizeof *w.field);if(!w.field)goto done;}while(0)
    A(walls,w.wall_count);A(spans,w.span_count);A(cells,w.cell_count);A(portals,w.portal_count);A(openings,w.opening_count);A(surfaces,w.surface_count);A(cell_nodes,w.cell_node_count);
    A(cell_refs,w.cell_count);A(span_cells,w.span_count);A(wall_portals,w.wall_count);A(wall_openings,w.wall_count);A(opening_spans_a,w.opening_count);A(opening_spans_b,w.opening_count);
    A(span_wall_offsets,w.span_count+1);A(span_wall_refs,refs);A(cell_portal_offsets,w.cell_count+1);A(cell_portal_refs,w.portal_count*2);
#undef A
    for(int i=0;i<w.wall_count;i++){R2DWorldWall *p=&w.walls[i];p->x1=get_f(&r);p->y1=get_f(&r);p->x2=get_f(&r);p->y2=get_f(&r);p->bottom=get_f(&r);p->top=get_f(&r);p->color=get_u(&r);}
    for(int i=0;i<w.span_count;i++){R2DWorldSpan *p=&w.spans[i];p->x=get_f(&r);p->y=get_f(&r);p->w=get_f(&r);p->h=get_f(&r);p->bottom=get_f(&r);p->top=get_f(&r);p->floor_color=get_u(&r);p->ceiling_color=get_u(&r);p->floor_a=get_f(&r);p->floor_b=get_f(&r);p->ceiling_a=get_f(&r);p->ceiling_b=get_f(&r);}
    for(int i=0;i<w.cell_count;i++){R2DWorldCell *p=&w.cells[i];p->x=get_f(&r);p->y=get_f(&r);p->w=get_f(&r);p->h=get_f(&r);p->first_span=(int32_t)get_u(&r);p->span_count=(int32_t)get_u(&r);}
    for(int i=0;i<w.portal_count;i++){R2DWorldPortal *p=&w.portals[i];p->cell_a=(int32_t)get_u(&r);p->cell_b=(int32_t)get_u(&r);p->first_opening=(int32_t)get_u(&r);p->opening_count=(int32_t)get_u(&r);p->ax=get_f(&r);p->ay=get_f(&r);p->bx=get_f(&r);p->by=get_f(&r);uint32_t closed=get_u(&r);if(closed>1)r.ok=false;p->closed=closed!=0;}
    for(int i=0;i<w.opening_count;i++){w.openings[i].bottom=get_f(&r);w.openings[i].top=get_f(&r);}
    for(int i=0;i<w.surface_count;i++){R2DWorldSurface *p=&w.surfaces[i];p->kind=(int32_t)get_u(&r);p->primitive=(int32_t)get_u(&r);p->cell=(int32_t)get_u(&r);p->span=(int32_t)get_u(&r);}
    for(int i=0;i<w.cell_node_count;i++){R2DWorldCellNode *p=&w.cell_nodes[i];p->split=get_f(&r);p->axis=(int32_t)get_u(&r);p->front=(int32_t)get_u(&r);p->back=(int32_t)get_u(&r);p->first_ref=(int32_t)get_u(&r);p->ref_count=(int32_t)get_u(&r);}
#define READ(field,count) for(int i=0;i<(count);i++)w.field[i]=(int32_t)get_u(&r)
    READ(cell_refs,w.cell_count);READ(span_cells,w.span_count);READ(wall_portals,w.wall_count);READ(wall_openings,w.wall_count);READ(opening_spans_a,w.opening_count);READ(opening_spans_b,w.opening_count);
    READ(span_wall_offsets,w.span_count+1);READ(span_wall_refs,refs);READ(cell_portal_offsets,w.cell_count+1);READ(cell_portal_refs,w.portal_count*2);
#undef READ
    if(!r.ok||!validate(&w,refs))goto done;
    if(version==2){
        R2DWorldLighting light;uint32_t flags[4];for(int i=0;i<4;i++){flags[i]=get_u(&r);if(flags[i]>1)goto done;}
        uint32_t authored=get_u(&r);if(authored>1)goto done;w.authored_lighting=authored;
        light.enabled=flags[0];light.dynamic=flags[1];light.shadows=flags[2];light.orientation=flags[3];light.distance_scale=get_f(&r);light.orientation_strength=get_f(&r);
        if(!r.ok||!r2d_world_set_lighting(&w,&light))goto done;
        int shadowed=0;for(int i=0;i<128;i++){R2DWorldLight *p=&w.lights[i];uint32_t active=get_u(&r);p->generation=get_u(&r);p->x=get_f(&r);p->y=get_f(&r);p->h=get_f(&r);p->radius=get_f(&r);p->intensity=get_f(&r);p->r=get_f(&r);p->g=get_f(&r);p->b=get_f(&r);uint32_t shadow=get_u(&r);p->remaining=get_f(&r);p->age=get_f(&r);p->flicker_min=get_f(&r);p->flicker_max=get_f(&r);p->flicker_rate=get_f(&r);p->flicker_seed=get_u(&r);
            if(active>3||shadow>1||p->generation>16777215||p->remaining<0||p->age<0||p->flicker_min<0||p->flicker_max<p->flicker_min||p->flicker_max>100||p->flicker_rate<0||p->flicker_rate>1000)goto done;
            p->active=(active&1)!=0;p->is_static=(active&2)!=0;p->shadow=shadow;if(p->active){if(!p->generation||!r2d_world_light_valid(p))goto done;w.light_count++;if(shadow&&shadowed<16){w.shadow_mask[i]=1;shadowed++;}}
        }
        int expected[128]={0};
        for(int i=0;i<w.span_count;i++){R2DWorldSpanLight p; p.level=get_f(&r);p.r=get_f(&r);p.g=get_f(&r);p.b=get_f(&r);p.fog_density=get_f(&r);p.fog_start=get_f(&r);p.fog_r=get_f(&r);p.fog_g=get_f(&r);p.fog_b=get_f(&r);if(!r2d_world_set_span_light(&w,i,&p))goto done;
            for(int j=0;j<4;j++)w.span_light_masks[i*4+j]=get_u(&r);int total=0,count=0;
            for(int slot=0;slot<128;slot++)if(w.span_light_masks[i*4+slot/32]&(1u<<(slot&31))){if(!w.lights[slot].active)goto done;expected[slot]++;total++;if(count<16)w.span_light_refs[i*16+count++]=slot;}
            w.span_light_counts[i]=(uint8_t)count;w.span_light_candidates[i]=(uint8_t)total;w.light_pairs+=count;w.light_overflow+=total>16?total-16:0;
        }
        for(int slot=0;slot<128;slot++){R2DWorldLightLinks *links=&w.light_links[slot];uint32_t count=get_u(&r);if(count!=(unsigned)expected[slot]||count>(unsigned)w.span_count)goto done;
            if(count){links->spans=malloc((size_t)count*sizeof(int));if(!links->spans)goto done;links->count=links->capacity=(int)count;}
            for(unsigned j=0;j<count;j++){int span=(int32_t)get_u(&r);if(span<0||span>=w.span_count||w.light_seen[span]||!(w.span_light_masks[span*4+slot/32]&(1u<<(slot&31))))goto done;w.light_seen[span]=1;links->spans[j]=span;}
            for(unsigned j=0;j<count;j++)w.light_seen[links->spans[j]]=0;
        }
        w.baked_lighting=true;w.light_dirty=false;w.light_full_dirty=false;
    }
    if(!r.ok||r.offset!=r.size)goto done;
    // Imported ray queries use complete primitive fallback; no unverified cell-ray coverage claim.
    w.baked_topology=true;if(version==1)w.light_dirty=true;w.topology_revision=world->topology_revision+1;r2d_world_free(world);*world=w;memset(&w,0,sizeof w);ok=true;
done:free(bytes);r2d_world_free(&w);if(!ok&&err&&size)snprintf(err,size,"Re2D World: invalid baked topology/checksum; recompile .re2dmap");return ok;
}
