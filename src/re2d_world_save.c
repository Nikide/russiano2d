#include "re2d_world_save.h"
#include "json.h"

#include <limits.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void save_error(char *error,size_t error_size,const char *format,...)
{
    if(!error||error_size==0)return;
    va_list args;
    va_start(args,format);
    vsnprintf(error,error_size,format,args);
    va_end(args);
}

static bool value_ok(float value)
{
    return isfinite(value)&&value<=R2D_WORLD_SAVE_MAX_VALUE&&value>=-R2D_WORLD_SAVE_MAX_VALUE;
}

// A struct id is valid when it is NUL-terminated inside its 64-byte buffer.
static bool id_valid(const char *id,bool required,char *error,size_t error_size,const char *what)
{
    if(!memchr(id,0,R2D_WORLD_SAVE_ID_CAP)) {
        save_error(error,error_size,"save: %s id is not NUL-terminated within 63 bytes",what);
        return false;
    }
    if(required&&id[0]==0) {
        save_error(error,error_size,"save: %s id must not be empty",what);
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Validation shared by write (and cross-field checks after read)
// ---------------------------------------------------------------------------
static bool validate_state(const R2DWorldSaveState *state,char *error,size_t error_size)
{
    if(!state){save_error(error,error_size,"save: null state");return false;}
    if(state->span_count<0||state->span_count>R2D_WORLD_SAVE_MAX_SPANS) {
        save_error(error,error_size,"save: span count out of range");
        return false;
    }
    if(state->span_count>0&&!state->spans){save_error(error,error_size,"save: null spans array");return false;}
    for(int i=0;i<state->span_count;i++) {
        const R2DWorldSavedSpan *s=&state->spans[i];
        char where[48];
        snprintf(where,sizeof where,"spans[%d]",i);
        if(s->span<0){save_error(error,error_size,"save: %s.span must be >= 0",where);return false;}
        if(!value_ok(s->bottom)||!value_ok(s->top)) {
            save_error(error,error_size,"save: %s heights must be finite and bounded",where);
            return false;
        }
        if(!(s->top>s->bottom)){save_error(error,error_size,"save: %s.top must be greater than bottom",where);return false;}
        if(!id_valid(s->id,false,error,error_size,where))return false;
    }

    if(state->portal_count<0||state->portal_count>R2D_WORLD_SAVE_MAX_PORTALS) {
        save_error(error,error_size,"save: portal count out of range");
        return false;
    }
    if(state->portal_count>0&&!state->portals){save_error(error,error_size,"save: null portals array");return false;}
    for(int i=0;i<state->portal_count;i++) {
        const R2DWorldSavedPortal *p=&state->portals[i];
        char where[48];
        snprintf(where,sizeof where,"portals[%d]",i);
        if(p->portal<0){save_error(error,error_size,"save: %s.portal must be >= 0",where);return false;}
        if(!value_ok(p->open_fraction)||p->open_fraction<0||p->open_fraction>1) {
            save_error(error,error_size,"save: %s.open_fraction must be in 0..1",where);
            return false;
        }
        if(!id_valid(p->id,false,error,error_size,where))return false;
    }

    if(state->mover_count<0||state->mover_count>R2D_WORLD_SAVE_MAX_MOVERS) {
        save_error(error,error_size,"save: mover count out of range");
        return false;
    }
    if(state->mover_count>0&&!state->movers){save_error(error,error_size,"save: null movers array");return false;}
    for(int i=0;i<state->mover_count;i++) {
        const R2DWorldSavedMover *m=&state->movers[i];
        char where[48];
        snprintf(where,sizeof where,"movers[%d]",i);
        if(m->type<0||m->type>3){save_error(error,error_size,"save: %s.type must be 0..3",where);return false;}
        if(m->span<-1||m->portal<-1) {
            save_error(error,error_size,"save: %s target must be -1 or a non-negative handle",where);
            return false;
        }
        if(!value_ok(m->from)||!value_ok(m->to)||!value_ok(m->position)||
           !value_ok(m->fraction)||!value_ok(m->speed)||!value_ok(m->wait)||!value_ok(m->timer)) {
            save_error(error,error_size,"save: %s numbers must be finite and bounded",where);
            return false;
        }
        if(m->speed<0||m->wait<0) {
            save_error(error,error_size,"save: %s.speed/wait must be >= 0",where);
            return false;
        }
        if(m->fraction<0||m->fraction>1) {
            save_error(error,error_size,"save: %s.fraction must be in 0..1",where);
            return false;
        }
        if(m->phase<0||m->phase>2) {
            save_error(error,error_size,"save: %s.phase must be 0..2",where);
            return false;
        }
        if(m->direction<-1||m->direction>1) {
            save_error(error,error_size,"save: %s.direction must be -1..1",where);
            return false;
        }
    }

    if(state->trigger_count<0||state->trigger_count>R2D_WORLD_SAVE_MAX_TRIGGERS) {
        save_error(error,error_size,"save: trigger count out of range");
        return false;
    }
    if(state->trigger_count>0&&!state->triggers){save_error(error,error_size,"save: null triggers array");return false;}
    for(int i=0;i<state->trigger_count;i++) {
        const R2DWorldSavedTrigger *t=&state->triggers[i];
        char where[48];
        snprintf(where,sizeof where,"triggers[%d]",i);
        if(!id_valid(t->id,true,error,error_size,where))return false;
        if(t->type<0||t->type>2){save_error(error,error_size,"save: %s.type must be 0..2",where);return false;}
        if(t->fire_count<0){save_error(error,error_size,"save: %s.fire_count must be >= 0",where);return false;}
        if(!value_ok(t->timer)||t->timer<0) {
            save_error(error,error_size,"save: %s.timer must be finite and >= 0",where);
            return false;
        }
        for(int j=0;j<i;j++) {
            if(strcmp(t->id,state->triggers[j].id)==0) {
                save_error(error,error_size,"save: duplicate trigger id \"%s\"",t->id);
                return false;
            }
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Writer: counts the required length and optionally copies, never allocates.
// ---------------------------------------------------------------------------
typedef struct {
    char *out;
    size_t cap;
    size_t length;
    bool failed;
} SaveWriter;

static void writer_char(SaveWriter *w,char c)
{
    if(w->cap>0&&w->length+1<w->cap)w->out[w->length]=c;
    w->length++;
}

static void writer_text(SaveWriter *w,const char *text)
{
    while(*text)writer_char(w,*text++);
}

static void writer_printf(SaveWriter *w,const char *format,...)
{
    char buffer[64];
    va_list args;
    va_start(args,format);
    int count=vsnprintf(buffer,sizeof buffer,format,args);
    va_end(args);
    if(count<0||(size_t)count>=sizeof buffer){w->failed=true;return;}
    writer_text(w,buffer);
}

static void writer_json_string(SaveWriter *w,const char *text)
{
    writer_char(w,'"');
    for(const unsigned char *p=(const unsigned char *)text;*p;++p) {
        switch(*p) {
        case '"': writer_text(w,"\\\""); break;
        case '\\': writer_text(w,"\\\\"); break;
        case '\n': writer_text(w,"\\n"); break;
        case '\r': writer_text(w,"\\r"); break;
        case '\t': writer_text(w,"\\t"); break;
        case '\b': writer_text(w,"\\b"); break;
        case '\f': writer_text(w,"\\f"); break;
        default:
            if(*p<0x20)writer_printf(w,"\\u%04x",(unsigned)*p);
            else writer_char(w,(char)*p);
            break;
        }
    }
    writer_char(w,'"');
}

static void writer_float(SaveWriter *w,float value)
{
    writer_printf(w,"%.9g",(double)value);
}

static void writer_bool(SaveWriter *w,bool value)
{
    writer_text(w,value?"true":"false");
}

static void writer_begin_field(SaveWriter *w,bool *first,const char *name)
{
    if(!*first)writer_char(w,',');
    *first=false;
    writer_char(w,'"');
    writer_text(w,name);
    writer_text(w,"\":");
}

static void write_span(SaveWriter *w,const R2DWorldSavedSpan *s)
{
    bool first=true;
    writer_char(w,'{');
    writer_begin_field(w,&first,"span");writer_printf(w,"%d",s->span);
    writer_begin_field(w,&first,"id");writer_json_string(w,s->id);
    writer_begin_field(w,&first,"bottom");writer_float(w,s->bottom);
    writer_begin_field(w,&first,"top");writer_float(w,s->top);
    writer_char(w,'}');
}

static void write_portal(SaveWriter *w,const R2DWorldSavedPortal *p)
{
    bool first=true;
    writer_char(w,'{');
    writer_begin_field(w,&first,"portal");writer_printf(w,"%d",p->portal);
    writer_begin_field(w,&first,"id");writer_json_string(w,p->id);
    writer_begin_field(w,&first,"open_fraction");writer_float(w,p->open_fraction);
    writer_begin_field(w,&first,"closed");writer_bool(w,p->closed);
    writer_begin_field(w,&first,"sky");writer_bool(w,p->sky);
    writer_char(w,'}');
}

static void write_mover(SaveWriter *w,const R2DWorldSavedMover *m)
{
    bool first=true;
    writer_char(w,'{');
    writer_begin_field(w,&first,"type");writer_printf(w,"%d",m->type);
    writer_begin_field(w,&first,"span");writer_printf(w,"%d",m->span);
    writer_begin_field(w,&first,"portal");writer_printf(w,"%d",m->portal);
    writer_begin_field(w,&first,"from");writer_float(w,m->from);
    writer_begin_field(w,&first,"to");writer_float(w,m->to);
    writer_begin_field(w,&first,"position");writer_float(w,m->position);
    writer_begin_field(w,&first,"fraction");writer_float(w,m->fraction);
    writer_begin_field(w,&first,"speed");writer_float(w,m->speed);
    writer_begin_field(w,&first,"wait");writer_float(w,m->wait);
    writer_begin_field(w,&first,"timer");writer_float(w,m->timer);
    writer_begin_field(w,&first,"phase");writer_printf(w,"%d",m->phase);
    writer_begin_field(w,&first,"direction");writer_printf(w,"%d",m->direction);
    writer_begin_field(w,&first,"auto_return");writer_bool(w,m->auto_return);
    writer_begin_field(w,&first,"blocking");writer_bool(w,m->blocking);
    writer_char(w,'}');
}

static void write_trigger(SaveWriter *w,const R2DWorldSavedTrigger *t)
{
    bool first=true;
    writer_char(w,'{');
    writer_begin_field(w,&first,"id");writer_json_string(w,t->id);
    writer_begin_field(w,&first,"type");writer_printf(w,"%d",t->type);
    writer_begin_field(w,&first,"fire_count");writer_printf(w,"%d",t->fire_count);
    writer_begin_field(w,&first,"enabled");writer_bool(w,t->enabled);
    writer_begin_field(w,&first,"once");writer_bool(w,t->once);
    writer_begin_field(w,&first,"armed");writer_bool(w,t->armed);
    writer_begin_field(w,&first,"timer");writer_float(w,t->timer);
    writer_char(w,'}');
}

int r2d_world_save_write(const R2DWorldSaveState *state,char *out,size_t cap)
{
    if(!out&&cap>0)return -1;
    if(cap>0)out[0]='\0';
    if(!validate_state(state,NULL,0))return -1;

    SaveWriter w={out,cap,0,false};
    writer_text(&w,"{\"format\":\"");
    writer_text(&w,R2D_WORLD_SAVE_FORMAT);
    writer_text(&w,"\",\"version\":");
    writer_printf(&w,"%d",R2D_WORLD_SAVE_VERSION);

    writer_text(&w,",\"spans\":[");
    for(int i=0;i<state->span_count;i++) {
        if(i)writer_char(&w,',');
        write_span(&w,&state->spans[i]);
    }
    writer_text(&w,"],\"portals\":[");
    for(int i=0;i<state->portal_count;i++) {
        if(i)writer_char(&w,',');
        write_portal(&w,&state->portals[i]);
    }
    writer_text(&w,"],\"movers\":[");
    for(int i=0;i<state->mover_count;i++) {
        if(i)writer_char(&w,',');
        write_mover(&w,&state->movers[i]);
    }
    writer_text(&w,"],\"triggers\":[");
    for(int i=0;i<state->trigger_count;i++) {
        if(i)writer_char(&w,',');
        write_trigger(&w,&state->triggers[i]);
    }
    writer_text(&w,"]}");

    if(w.failed) {
        if(cap>0)out[0]='\0';
        return -1;
    }
    if(cap>0) {
        size_t written=w.length<cap-1?w.length:cap-1;
        out[written]='\0';
    }
    if(w.length>(size_t)INT_MAX)return -1;
    return (int)w.length;
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------
static bool read_number(const R2dJson *obj,const char *key,float *out,
                        const char *where,char *error,size_t error_size)
{
    const R2dJson *value=r2d_json_get(obj,key);
    if(!value||value->type!=R2D_JSON_NUM) {
        save_error(error,error_size,"save: %s.%s must be a number",where,key);
        return false;
    }
    double number=value->number;
    if(!isfinite(number)||number>R2D_WORLD_SAVE_MAX_VALUE||number<-R2D_WORLD_SAVE_MAX_VALUE) {
        save_error(error,error_size,"save: %s.%s must be finite and bounded",where,key);
        return false;
    }
    float result=(float)number;
    if(!isfinite(result)) {
        save_error(error,error_size,"save: %s.%s is out of range",where,key);
        return false;
    }
    *out=result;
    return true;
}

static bool read_integer(const R2dJson *obj,const char *key,int *out,int minimum,int maximum,
                         const char *where,char *error,size_t error_size)
{
    const R2dJson *value=r2d_json_get(obj,key);
    if(!value||value->type!=R2D_JSON_NUM) {
        save_error(error,error_size,"save: %s.%s must be an integer",where,key);
        return false;
    }
    double number=value->number;
    if(!isfinite(number)||number<minimum||number>maximum||number!=(double)(long long)number) {
        save_error(error,error_size,"save: %s.%s is not an integer in range",where,key);
        return false;
    }
    *out=(int)number;
    return true;
}

static bool read_boolean(const R2dJson *obj,const char *key,bool *out,
                         const char *where,char *error,size_t error_size)
{
    const R2dJson *value=r2d_json_get(obj,key);
    if(!value||value->type!=R2D_JSON_BOOL) {
        save_error(error,error_size,"save: %s.%s must be a boolean",where,key);
        return false;
    }
    *out=value->boolean;
    return true;
}

static bool read_id(const R2dJson *obj,const char *key,char *out,size_t out_size,
                    bool required,const char *where,char *error,size_t error_size)
{
    const R2dJson *value=r2d_json_get(obj,key);
    if(!value||value->type!=R2D_JSON_STR) {
        save_error(error,error_size,"save: %s.%s must be a string",where,key);
        return false;
    }
    const char *text=value->string?value->string:"";
    size_t length=strlen(text);
    if(length+1>out_size) {
        save_error(error,error_size,"save: %s.%s is too long (max %d bytes)",where,key,(int)out_size-1);
        return false;
    }
    if(required&&length==0) {
        save_error(error,error_size,"save: %s.%s must not be empty",where,key);
        return false;
    }
    memcpy(out,text,length+1);
    return true;
}

static bool read_array(const R2dJson *root,const char *key,const R2dJson **out,int maximum,
                       int *count,char *error,size_t error_size)
{
    const R2dJson *value=r2d_json_get(root,key);
    if(!value||value->type!=R2D_JSON_ARR) {
        save_error(error,error_size,"save: missing %s array",key);
        return false;
    }
    int size=r2d_json_size(value);
    if(size>maximum) {
        save_error(error,error_size,"save: too many %s (max %d)",key,maximum);
        return false;
    }
    *out=value;
    *count=size;
    return true;
}

bool r2d_world_save_read(const char *text,R2DWorldSaveState *out,char *error,size_t error_size)
{
    if(error&&error_size)error[0]='\0';
    if(!out){save_error(error,error_size,"save: null output state");return false;}

    R2DWorldSaveState parsed={0};
    char json_error[128];
    R2dJson *root=r2d_json_parse(text,json_error,sizeof json_error);
    if(!root) {
        save_error(error,error_size,"save: invalid JSON");
        r2d_world_save_free(out);
        return false;
    }

    bool ok=false;
    do {
        if(root->type!=R2D_JSON_OBJ) {
            save_error(error,error_size,"save: root must be an object");
            break;
        }
        const R2dJson *format=r2d_json_get(root,"format");
        if(!format||format->type!=R2D_JSON_STR||!format->string||
           strcmp(format->string,R2D_WORLD_SAVE_FORMAT)!=0) {
            save_error(error,error_size,"save: missing or wrong format magic");
            break;
        }
        int version=0;
        if(!read_integer(root,"version",&version,1,INT_MAX,"root",error,error_size)) {
            save_error(error,error_size,"save: missing version");
            break;
        }
        if(version!=R2D_WORLD_SAVE_VERSION) {
            save_error(error,error_size,"save: unsupported version %d",version);
            break;
        }

        const R2dJson *spans=NULL,*portals=NULL,*movers=NULL,*triggers=NULL;
        if(!read_array(root,"spans",&spans,R2D_WORLD_SAVE_MAX_SPANS,&parsed.span_count,error,error_size))break;
        if(parsed.span_count>0) {
            parsed.spans=calloc((size_t)parsed.span_count,sizeof *parsed.spans);
            if(!parsed.spans){save_error(error,error_size,"save: out of memory");break;}
        }
        for(int i=0;i<parsed.span_count;i++) {
            const R2dJson *item=r2d_json_at(spans,i);
            char where[48];
            snprintf(where,sizeof where,"spans[%d]",i);
            if(!item||item->type!=R2D_JSON_OBJ) {
                save_error(error,error_size,"save: %s must be an object",where);
                goto cleanup;
            }
            R2DWorldSavedSpan *s=&parsed.spans[i];
            if(!read_integer(item,"span",&s->span,0,INT_MAX,where,error,error_size)||
               !read_number(item,"bottom",&s->bottom,where,error,error_size)||
               !read_number(item,"top",&s->top,where,error,error_size)||
               !read_id(item,"id",s->id,sizeof s->id,false,where,error,error_size))goto cleanup;
        }

        if(!read_array(root,"portals",&portals,R2D_WORLD_SAVE_MAX_PORTALS,&parsed.portal_count,error,error_size))break;
        if(parsed.portal_count>0) {
            parsed.portals=calloc((size_t)parsed.portal_count,sizeof *parsed.portals);
            if(!parsed.portals){save_error(error,error_size,"save: out of memory");break;}
        }
        for(int i=0;i<parsed.portal_count;i++) {
            const R2dJson *item=r2d_json_at(portals,i);
            char where[48];
            snprintf(where,sizeof where,"portals[%d]",i);
            if(!item||item->type!=R2D_JSON_OBJ) {
                save_error(error,error_size,"save: %s must be an object",where);
                goto cleanup;
            }
            R2DWorldSavedPortal *p=&parsed.portals[i];
            if(!read_integer(item,"portal",&p->portal,0,INT_MAX,where,error,error_size)||
               !read_number(item,"open_fraction",&p->open_fraction,where,error,error_size)||
               !read_boolean(item,"closed",&p->closed,where,error,error_size)||
               !read_boolean(item,"sky",&p->sky,where,error,error_size)||
               !read_id(item,"id",p->id,sizeof p->id,false,where,error,error_size))goto cleanup;
        }

        if(!read_array(root,"movers",&movers,R2D_WORLD_SAVE_MAX_MOVERS,&parsed.mover_count,error,error_size))break;
        if(parsed.mover_count>0) {
            parsed.movers=calloc((size_t)parsed.mover_count,sizeof *parsed.movers);
            if(!parsed.movers){save_error(error,error_size,"save: out of memory");break;}
        }
        for(int i=0;i<parsed.mover_count;i++) {
            const R2dJson *item=r2d_json_at(movers,i);
            char where[48];
            snprintf(where,sizeof where,"movers[%d]",i);
            if(!item||item->type!=R2D_JSON_OBJ) {
                save_error(error,error_size,"save: %s must be an object",where);
                goto cleanup;
            }
            R2DWorldSavedMover *m=&parsed.movers[i];
            if(!read_integer(item,"type",&m->type,0,3,where,error,error_size)||
               !read_integer(item,"span",&m->span,-1,INT_MAX,where,error,error_size)||
               !read_integer(item,"portal",&m->portal,-1,INT_MAX,where,error,error_size)||
               !read_number(item,"from",&m->from,where,error,error_size)||
               !read_number(item,"to",&m->to,where,error,error_size)||
               !read_number(item,"position",&m->position,where,error,error_size)||
               !read_number(item,"fraction",&m->fraction,where,error,error_size)||
               !read_number(item,"speed",&m->speed,where,error,error_size)||
               !read_number(item,"wait",&m->wait,where,error,error_size)||
               !read_number(item,"timer",&m->timer,where,error,error_size)||
               !read_integer(item,"phase",&m->phase,0,2,where,error,error_size)||
               !read_integer(item,"direction",&m->direction,-1,1,where,error,error_size)||
               !read_boolean(item,"auto_return",&m->auto_return,where,error,error_size)||
               !read_boolean(item,"blocking",&m->blocking,where,error,error_size))goto cleanup;
        }

        if(!read_array(root,"triggers",&triggers,R2D_WORLD_SAVE_MAX_TRIGGERS,&parsed.trigger_count,error,error_size))break;
        if(parsed.trigger_count>0) {
            parsed.triggers=calloc((size_t)parsed.trigger_count,sizeof *parsed.triggers);
            if(!parsed.triggers){save_error(error,error_size,"save: out of memory");break;}
        }
        for(int i=0;i<parsed.trigger_count;i++) {
            const R2dJson *item=r2d_json_at(triggers,i);
            char where[48];
            snprintf(where,sizeof where,"triggers[%d]",i);
            if(!item||item->type!=R2D_JSON_OBJ) {
                save_error(error,error_size,"save: %s must be an object",where);
                goto cleanup;
            }
            R2DWorldSavedTrigger *t=&parsed.triggers[i];
            if(!read_id(item,"id",t->id,sizeof t->id,true,where,error,error_size)||
               !read_integer(item,"type",&t->type,0,2,where,error,error_size)||
               !read_integer(item,"fire_count",&t->fire_count,0,INT_MAX,where,error,error_size)||
               !read_boolean(item,"enabled",&t->enabled,where,error,error_size)||
               !read_boolean(item,"once",&t->once,where,error,error_size)||
               !read_boolean(item,"armed",&t->armed,where,error,error_size)||
               !read_number(item,"timer",&t->timer,where,error,error_size))goto cleanup;
        }

        if(!validate_state(&parsed,error,error_size))break;
        ok=true;
    } while(0);

cleanup:
    r2d_json_free(root);
    r2d_world_save_free(out);
    if(!ok) {
        r2d_world_save_free(&parsed);
        return false;
    }
    *out=parsed;
    return true;
}

void r2d_world_save_free(R2DWorldSaveState *state)
{
    if(!state)return;
    free(state->spans);
    free(state->portals);
    free(state->movers);
    free(state->triggers);
    memset(state,0,sizeof *state);
}

static uint64_t hash_bytes(uint64_t hash,const void *data,size_t size)
{
    const unsigned char *bytes=(const unsigned char *)data;
    for(size_t i=0;i<size;i++)hash=(hash^bytes[i])*1099511628211ULL;
    return hash;
}

static uint64_t hash_length(uint64_t hash,uint64_t length)
{
    for(int i=0;i<8;i++)hash=(hash^(unsigned char)(length>>(i*8)))*1099511628211ULL;
    return hash;
}

uint64_t r2d_world_save_map_hash(const char *map_id,const char *version,uint64_t topology_hash)
{
    const char *id=map_id?map_id:"";
    const char *ver=version?version:"";
    uint64_t hash=1469598103934665603ULL;
    hash=hash_length(hash,strlen(id));
    hash=hash_bytes(hash,id,strlen(id));
    hash=hash_length(hash,strlen(ver));
    hash=hash_bytes(hash,ver,strlen(ver));
    for(int i=0;i<8;i++)hash=(hash^(unsigned char)(topology_hash>>(i*8)))*1099511628211ULL;
    return hash;
}
