#include "re2d_world_metadata.h"

#include "json.h"

#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Pure metadata parser/validator. All allocation goes into a temporary struct;
// a failed parse frees it and leaves the caller's struct zeroed.

static bool error(char *out,size_t size,const char *message,int index)
{
    if(out&&size) {
        if(index>=0) snprintf(out,size,"Re2D metadata: %s (%d)",message,index);
        else snprintf(out,size,"Re2D metadata: %s",message);
    }
    return false;
}

static char *copy_string(const char *value,size_t length)
{
    char *copy=malloc(length+1);
    if(!copy) return NULL;
    memcpy(copy,value,length);
    copy[length]='\0';
    return copy;
}

// Optional metadata string. Present values must be strings within the byte
// limit; absent values stay NULL.
static bool read_string(const R2dJson *obj,const char *key,const char *alias,
                        char **out,char *err,size_t size,const char *what)
{
    const R2dJson *v=r2d_json_get(obj,key);
    if(!v&&alias) v=r2d_json_get(obj,alias);
    if(!v) return true;
    if(v->type!=R2D_JSON_STR||!v->string)
        return error(err,size,what,-1);
    size_t length=strlen(v->string);
    if(length>R2D_WORLD_METADATA_STRING_MAX)
        return error(err,size,what,-1);
    char *copy=copy_string(v->string,length);
    if(!copy) return error(err,size,"out of memory",-1);
    *out=copy;
    return true;
}

static bool read_fog(const R2dJson *obj,const char *key,const char *alias,
                     float *out,char *err,size_t size)
{
    const R2dJson *v=r2d_json_get(obj,key);
    if(!v&&alias) v=r2d_json_get(obj,alias);
    if(!v) return true;
    if(v->type!=R2D_JSON_NUM||!isfinite(v->number)||
       fabs(v->number)>R2D_WORLD_METADATA_COORD_MAX)
        return error(err,size,"invalid default fog value",-1);
    *out=(float)v->number;
    return true;
}

static bool read_spawn_number(const R2dJson *obj,const char *key,float *out,bool required,
                              char *err,size_t size,int index)
{
    const R2dJson *v=r2d_json_get(obj,key);
    if(!v) {
        if(required) return error(err,size,"missing spawn coordinate",index);
        return true;
    }
    if(v->type!=R2D_JSON_NUM||!isfinite(v->number)||
       fabs(v->number)>R2D_WORLD_METADATA_COORD_MAX)
        return error(err,size,"invalid spawn coordinate",index);
    *out=(float)v->number;
    return true;
}

static bool read_spawn_type(const R2dJson *obj,int *out,char *err,size_t size,int index)
{
    const R2dJson *v=r2d_json_get(obj,"type");
    if(!v) return error(err,size,"missing spawn type",index);
    if(v->type==R2D_JSON_STR) {
        int type=r2d_world_spawn_type_from_name(v->string);
        if(type<0) return error(err,size,"invalid spawn type",index);
        *out=type;
        return true;
    }
    if(v->type==R2D_JSON_NUM&&isfinite(v->number)&&v->number>=0.0&&v->number<=5.0&&
       floor(v->number)==v->number) {
        *out=(int)v->number;
        return true;
    }
    return error(err,size,"invalid spawn type",index);
}

static bool read_spawn_string(const R2dJson *obj,const char *key,char **out,bool required,
                              char *err,size_t size,int index,const char *what)
{
    const R2dJson *v=r2d_json_get(obj,key);
    if(!v) {
        if(required) return error(err,size,what,index);
        return true;
    }
    if(v->type!=R2D_JSON_STR||!v->string)
        return error(err,size,what,index);
    size_t length=strlen(v->string);
    if(length>R2D_WORLD_METADATA_STRING_MAX)
        return error(err,size,what,index);
    char *copy=copy_string(v->string,length);
    if(!copy) return error(err,size,"out of memory",-1);
    *out=copy;
    return true;
}

void r2d_world_metadata_free(R2DWorldMetadata *metadata)
{
    if(!metadata) return;
    free(metadata->id);free(metadata->title);free(metadata->author);free(metadata->version);
    free(metadata->music);free(metadata->sky);free(metadata->next_map);
    free(metadata->secret_exit);free(metadata->environment);free(metadata->default_fog_color);
    if(metadata->spawns) {
        for(int i=0;i<metadata->spawn_count;i++) {
            free(metadata->spawns[i].id);
            free(metadata->spawns[i].tag);
        }
        free(metadata->spawns);
    }
    memset(metadata,0,sizeof *metadata);
}

bool r2d_world_metadata_parse(const R2dJson *root,R2DWorldMetadata *out,char *err,size_t size)
{
    if(err&&size) err[0]='\0';
    if(!out) return error(err,size,"missing output",-1);

    R2DWorldMetadata next={0};
    if(!root) goto fail_msg_missing;
    if(root->type!=R2D_JSON_OBJ) {
        error(err,size,"root must be an object",-1);
        goto fail;
    }

    const R2dJson *meta=r2d_json_get(root,"meta");
    if(!meta) meta=r2d_json_get(root,"metadata");
    if(meta&&meta->type!=R2D_JSON_OBJ) {
        error(err,size,"meta must be an object",-1);
        goto fail;
    }

#define META_STRING(field,key,alias,what) \
    do { if(meta&&!read_string(meta,key,alias,&next.field,err,size,what)) goto fail; } while(0)

    META_STRING(id,"id",NULL,"invalid metadata id");
    META_STRING(title,"title",NULL,"invalid metadata title");
    META_STRING(author,"author",NULL,"invalid metadata author");
    META_STRING(version,"version",NULL,"invalid metadata version");
    META_STRING(music,"music",NULL,"invalid metadata music");
    META_STRING(sky,"sky",NULL,"invalid metadata sky");
    META_STRING(next_map,"nextMap","next_map","invalid next map");
    META_STRING(secret_exit,"secretExit","secret_exit","invalid secret exit");
    META_STRING(environment,"environment",NULL,"invalid environment");
    META_STRING(default_fog_color,"defaultFogColor","default_fog_color","invalid default fog color");
#undef META_STRING

    if(meta) {
        if(!read_fog(meta,"defaultFogDensity","default_fog_density",
                     &next.default_fog_density,err,size)) goto fail;
        if(!read_fog(meta,"defaultFogStart","default_fog_start",
                     &next.default_fog_start,err,size)) goto fail;
    }

    // Spawns may be authored inside meta/metadata or at the document root.
    const R2dJson *spawns=meta?r2d_json_get(meta,"spawns"):NULL;
    if(!spawns) spawns=r2d_json_get(root,"spawns");
    if(spawns) {
        if(spawns->type!=R2D_JSON_ARR) {
            error(err,size,"spawns must be an array",-1);
            goto fail;
        }
        if(spawns->count>R2D_WORLD_METADATA_SPAWN_MAX) {
            error(err,size,"too many spawns",spawns->count);
            goto fail;
        }
        if(spawns->count>0) {
            next.spawns=calloc((size_t)spawns->count,sizeof *next.spawns);
            if(!next.spawns) {
                error(err,size,"out of memory",-1);
                goto fail;
            }
            next.spawn_count=spawns->count;
            for(int i=0;i<spawns->count;i++) {
                const R2dJson *object=spawns->items[i];
                R2DWorldSpawn *spawn=&next.spawns[i];
                if(!object||object->type!=R2D_JSON_OBJ) {
                    error(err,size,"spawn must be an object",i);
                    goto fail;
                }
                if(!read_spawn_string(object,"id",&spawn->id,true,err,size,i,"missing spawn id")) goto fail;
                if(!spawn->id[0]) {
                    error(err,size,"empty spawn id",i);
                    goto fail;
                }
                for(int j=0;j<i;j++) {
                    if(!strcmp(next.spawns[j].id,spawn->id)) {
                        error(err,size,"duplicate spawn id",i);
                        goto fail;
                    }
                }
                if(!read_spawn_type(object,&spawn->type,err,size,i)) goto fail;
                if(!read_spawn_number(object,"x",&spawn->x,true,err,size,i)) goto fail;
                if(!read_spawn_number(object,"y",&spawn->y,true,err,size,i)) goto fail;
                if(!read_spawn_number(object,"h",&spawn->h,false,err,size,i)) goto fail;
                if(!read_spawn_number(object,"facing",&spawn->facing,false,err,size,i)) goto fail;
                if(!read_spawn_string(object,"tag",&spawn->tag,false,err,size,i,"invalid spawn tag")) goto fail;
            }
        }
    }

    r2d_world_metadata_free(out);
    *out=next;
    return true;

fail_msg_missing:
    error(err,size,"missing JSON",-1);
fail:
    r2d_world_metadata_free(&next);
    r2d_world_metadata_free(out);
    *out=(R2DWorldMetadata){0};
    return false;
}

static const char *const spawn_type_names[]={
    "player","enemy","item","boss","effect","camera"
};

const char *r2d_world_spawn_type_name(int type)
{
    if(type>=PLAYER&&type<=CAMERA) return spawn_type_names[type];
    return "unknown";
}

static int same_name(const char *a,const char *b)
{
    while(*a&&*b) {
        if(tolower((unsigned char)*a)!=tolower((unsigned char)*b)) return 0;
        a++;b++;
    }
    return *a=='\0'&&*b=='\0';
}

int r2d_world_spawn_type_from_name(const char *name)
{
    if(!name) return -1;
    for(int i=PLAYER;i<=CAMERA;i++)
        if(same_name(name,spawn_type_names[i])) return i;
    if(same_name(name,"cutscene")) return CAMERA;
    return -1;
}
