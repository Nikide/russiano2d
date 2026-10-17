#include "re2d_world_vfx.h"
#include "json.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

// Native VFX library: fixed pools, no per-frame allocation, no mutable globals.
// Only bundle parsing allocates (through r2d_json) and frees before returning.

static bool finite3(float a,float b,float c)
{
    return isfinite(a) && isfinite(b) && isfinite(c);
}

static float clampf(float v,float lo,float hi)
{
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

static bool set_error(char *error,size_t error_size,const char *message)
{
    if (error && error_size) snprintf(error,error_size,"%s",message);
    return false;
}

static bool json_num_opt(const R2dJson *obj,const char *key,float def,float *out)
{
    const R2dJson *value = r2d_json_get(obj,key);
    if (!value) { *out = def; return true; }
    if (value->type != R2D_JSON_NUM || !isfinite(value->number) ||
        fabs(value->number) > 1000000.0) return false;
    *out = (float)value->number;
    return true;
}

static bool json_int_opt(const R2dJson *obj,const char *key,int def,int *out)
{
    const R2dJson *value = r2d_json_get(obj,key);
    if (!value) { *out = def; return true; }
    if (value->type != R2D_JSON_NUM || !isfinite(value->number) ||
        value->number < -1000000.0 || value->number > 1000000.0) return false;
    const int number = (int)value->number;
    if ((double)number != value->number) return false;
    *out = number;
    return true;
}

static bool json_bool_opt(const R2dJson *obj,const char *key,bool def,bool *out)
{
    const R2dJson *value = r2d_json_get(obj,key);
    if (!value) { *out = def; return true; }
    if (value->type != R2D_JSON_BOOL) return false;
    *out = value->boolean;
    return true;
}

static bool json_color_opt(const R2dJson *obj,const char *key,
                           float *r,float *g,float *b)
{
    const R2dJson *value = r2d_json_get(obj,key);
    if (!value) return true;
    if (value->type != R2D_JSON_STR) return false;
    const char *text = value->string;
    if (!text || strlen(text) != 7 || text[0] != '#') return false;
    unsigned rgb = 0;
    for (int i = 1; i < 7; i++) {
        const char c = text[i];
        unsigned digit;
        if (c >= '0' && c <= '9') digit = (unsigned)(c - '0');
        else if (c >= 'a' && c <= 'f') digit = (unsigned)(c - 'a' + 10);
        else if (c >= 'A' && c <= 'F') digit = (unsigned)(c - 'A' + 10);
        else return false;
        rgb = (rgb << 4) | digit;
    }
    *r = (float)((rgb >> 16) & 0xffu) / 255.0f;
    *g = (float)((rgb >> 8) & 0xffu) / 255.0f;
    *b = (float)(rgb & 0xffu) / 255.0f;
    return true;
}

static bool name_is(const char *text,const char *name)
{
    return text && name && strcmp(text,name) == 0;
}

static int parse_blend(const char *name,int def,const char *def_name)
{
    if (!name) name = def_name;
    if (name_is(name,"masked")) return R2D_PARTICLE_MASKED;
    if (name_is(name,"translucent")) return R2D_PARTICLE_TRANSLUCENT;
    if (name_is(name,"additive")) return R2D_PARTICLE_ADDITIVE;
    return def;
}

static int parse_mode(const char *name,int def)
{
    if (name_is(name,"screen")) return R2D_PARTICLE_SCREEN;
    if (name_is(name,"billboard")) return R2D_PARTICLE_BILLBOARD;
    if (name_is(name,"axis")) return R2D_PARTICLE_AXIS;
    if (name_is(name,"floor")) return R2D_PARTICLE_FLOOR;
    return def;
}

static int parse_collision(const char *name,int def)
{
    if (name_is(name,"none")) return R2D_PARTICLE_COLLIDE_NONE;
    if (name_is(name,"floor")) return R2D_PARTICLE_COLLIDE_FLOOR;
    if (name_is(name,"wall")) return R2D_PARTICLE_COLLIDE_WALL;
    if (name_is(name,"bounce")) return R2D_PARTICLE_COLLIDE_BOUNCE;
    if (name_is(name,"despawn")) return R2D_PARTICLE_COLLIDE_DESPAWN;
    return def;
}

static int parse_card_kind(const char *name)
{
    if (name_is(name,"sprite")) return R2D_VFX_CARD_SPRITE;
    if (name_is(name,"streak")) return R2D_VFX_CARD_STREAK;
    if (name_is(name,"ring")) return R2D_VFX_CARD_RING;
    if (name_is(name,"flash")) return R2D_VFX_CARD_FLASH;
    if (name_is(name,"decal")) return R2D_VFX_CARD_DECAL;
    if (name_is(name,"light_pulse")) return R2D_VFX_CARD_LIGHT_PULSE;
    return -1;
}

static int parse_distortion(const char *name)
{
    if (name_is(name,"heat")) return R2D_VFX_DISTORTION_HEAT;
    if (name_is(name,"shockwave")) return R2D_VFX_DISTORTION_SHOCKWAVE;
    if (name_is(name,"magic")) return R2D_VFX_DISTORTION_MAGIC;
    return R2D_VFX_DISTORTION_NONE;
}

static const char *json_string_opt(const R2dJson *obj,const char *key)
{
    const R2dJson *value = r2d_json_get(obj,key);
    return (value && value->type == R2D_JSON_STR) ? value->string : NULL;
}

static bool parse_particle_preset(const R2dJson *obj,
                                  R2DWorldVfxParticlePreset *preset,
                                  char *error,size_t error_size)
{
    if (!obj || obj->type != R2D_JSON_OBJ)
        return set_error(error,error_size,"vfx: particle preset must be an object");
    memset(preset,0,sizeof *preset);
    int count = 1;
    float life = 0.5f, size = 4.0f, end_size = -1.0f;
    float alpha = 1.0f, end_alpha = -1.0f;
    float gravity = 0.0f, drag = 0.0f;
    float frame_f = 0.0f, frames_f = 0.0f;
    if (!json_int_opt(obj,"count",1,&count) || count < 0 || count > R2D_WORLD_VFX_MAX_PARTICLES)
        return set_error(error,error_size,"vfx: particle count out of range");
    if (!json_num_opt(obj,"life",0.5f,&life) || !(life > 0.0f))
        return set_error(error,error_size,"vfx: particle life must be > 0");
    if (!json_num_opt(obj,"size",4.0f,&size) || size < 0.0f)
        return set_error(error,error_size,"vfx: particle size must be >= 0");
    if (!json_num_opt(obj,"endSize",-1.0f,&end_size) || end_size < -1.0f)
        return set_error(error,error_size,"vfx: particle endSize must be >= -1");
    if (!json_num_opt(obj,"alpha",1.0f,&alpha) || !json_num_opt(obj,"endAlpha",-1.0f,&end_alpha))
        return set_error(error,error_size,"vfx: particle alpha must be finite");
    if (!json_num_opt(obj,"gravity",0.0f,&gravity) || !json_num_opt(obj,"drag",0.0f,&drag))
        return set_error(error,error_size,"vfx: particle gravity/drag must be finite");
    if (!json_num_opt(obj,"frame",0.0f,&frame_f) || !json_num_opt(obj,"frames",0.0f,&frames_f))
        return set_error(error,error_size,"vfx: particle frame/frames must be finite");
    if (!json_num_opt(obj,"speed",0.0f,&preset->speed) ||
        !json_num_opt(obj,"spread",0.0f,&preset->spread) ||
        preset->speed < 0.0f || preset->spread < 0.0f)
        return set_error(error,error_size,"vfx: particle speed/spread must be >= 0");
    if (!json_num_opt(obj,"dirX",0.0f,&preset->dir_x) ||
        !json_num_opt(obj,"dirY",0.0f,&preset->dir_y))
        return set_error(error,error_size,"vfx: particle direction must be finite");
    if (!json_num_opt(obj,"dirZ",0.0f,&preset->dir_h)) {
        if (!json_num_opt(obj,"dirH",0.0f,&preset->dir_h))
            return set_error(error,error_size,"vfx: particle direction must be finite");
    }
    if (frame_f < 0.0f || frames_f < 0.0f || frame_f > 1000000.0f || frames_f > 1000000.0f ||
        floorf(frame_f) != frame_f || floorf(frames_f) != frames_f)
        return set_error(error,error_size,"vfx: particle frame/frames must be non-negative integers");

    preset->count = count;
    preset->proto.x = preset->proto.y = preset->proto.h = 0.0f;
    preset->proto.max_life = life;
    preset->proto.life = life;
    preset->proto.size = size;
    preset->proto.start_size = size;
    preset->proto.end_size = end_size;
    preset->proto.alpha = clampf(alpha,0.0f,1.0f);
    preset->proto.start_alpha = preset->proto.alpha;
    preset->proto.end_alpha = end_alpha;
    preset->proto.gravity = gravity;
    preset->proto.drag = drag;
    preset->proto.frame = (int)frame_f;
    preset->proto.frames = (int)frames_f;
    preset->proto.blend = R2D_PARTICLE_MASKED;
    preset->proto.mode = R2D_PARTICLE_BILLBOARD;
    const char *blend = json_string_opt(obj,"blend");
    const char *mode = json_string_opt(obj,"mode");
    const char *collision = json_string_opt(obj,"collision");
    if (blend) {
        const int parsed = parse_blend(blend,-1,NULL);
        if (parsed < 0) return set_error(error,error_size,"vfx: unknown particle blend");
        preset->proto.blend = parsed;
    }
    if (mode) {
        const int parsed = parse_mode(mode,-1);
        if (parsed < 0) return set_error(error,error_size,"vfx: unknown particle mode");
        preset->proto.mode = parsed;
    }
    if (collision) {
        const int parsed = parse_collision(collision,-1);
        if (parsed < 0) return set_error(error,error_size,"vfx: unknown particle collision mode");
        preset->proto.collision = parsed;
    }
    if (!json_num_opt(obj,"bounce",0.0f,&preset->proto.bounce) ||
        preset->proto.bounce < 0.0f || preset->proto.bounce > 1.0f)
        return set_error(error,error_size,"vfx: particle bounce must be 0..1");
    if (!json_num_opt(obj,"radius",0.0f,&preset->proto.radius) || preset->proto.radius < 0.0f)
        return set_error(error,error_size,"vfx: particle radius must be >= 0");
    preset->proto.r = preset->proto.g = preset->proto.b = 1.0f;
    if (!json_color_opt(obj,"color",&preset->proto.r,&preset->proto.g,&preset->proto.b))
        return set_error(error,error_size,"vfx: particle color must be #rrggbb");
    preset->proto.active = true;
    preset->proto.world_space = preset->proto.mode != R2D_PARTICLE_SCREEN;
    return true;
}

static bool parse_card_preset(const R2dJson *obj,R2DWorldVfxCard *card,
                              char *error,size_t error_size)
{
    if (!obj || obj->type != R2D_JSON_OBJ)
        return set_error(error,error_size,"vfx: card preset must be an object");
    memset(card,0,sizeof *card);
    const char *kind = json_string_opt(obj,"kind");
    const char *mode = json_string_opt(obj,"mode");
    const char *blend = json_string_opt(obj,"blend");
    const char *distortion = json_string_opt(obj,"distortion");
    card->kind = kind ? parse_card_kind(kind) : R2D_VFX_CARD_SPRITE;
    if (card->kind < 0) return set_error(error,error_size,"vfx: unknown card kind");
    card->mode = R2D_VFX_MODE_BILLBOARD;
    if (mode) {
        if (name_is(mode,"billboard")) card->mode = R2D_VFX_MODE_BILLBOARD;
        else if (name_is(mode,"screen")) card->mode = R2D_VFX_MODE_SCREEN;
        else if (name_is(mode,"axis")) card->mode = R2D_VFX_MODE_AXIS;
        else if (name_is(mode,"floor")) card->mode = R2D_VFX_MODE_FLOOR;
        else return set_error(error,error_size,"vfx: unknown card mode");
    }
    card->blend = R2D_PARTICLE_ADDITIVE;
    if (blend) {
        const int parsed = parse_blend(blend,-1,NULL);
        if (parsed < 0) return set_error(error,error_size,"vfx: unknown card blend");
        card->blend = parsed;
    }
    card->distortion = distortion ? parse_distortion(distortion) : R2D_VFX_DISTORTION_NONE;
    float life = 0.3f, size = 32.0f, end_size = -1.0f;
    float alpha = 1.0f, end_alpha = -1.0f, width = 2.0f;
    float frame_f = 0.0f, frames_f = 0.0f;
    if (!json_num_opt(obj,"life",0.3f,&life) || !(life > 0.0f))
        return set_error(error,error_size,"vfx: card life must be > 0");
    if (!json_num_opt(obj,"size",32.0f,&size) || size < 0.0f)
        return set_error(error,error_size,"vfx: card size must be >= 0");
    if (!json_num_opt(obj,"endSize",-1.0f,&end_size) || end_size < -1.0f)
        return set_error(error,error_size,"vfx: card endSize must be >= -1");
    if (!json_num_opt(obj,"alpha",1.0f,&alpha) || !json_num_opt(obj,"endAlpha",-1.0f,&end_alpha) ||
        !json_num_opt(obj,"width",2.0f,&width) || width < 0.0f)
        return set_error(error,error_size,"vfx: card alpha/width invalid");
    if (!json_num_opt(obj,"rotation",0.0f,&card->rotation) ||
        !json_num_opt(obj,"spin",0.0f,&card->spin) ||
        !json_num_opt(obj,"speed",0.0f,&card->speed) || card->speed < 0.0f ||
        !json_num_opt(obj,"vx",0.0f,&card->vx) ||
        !json_num_opt(obj,"vy",0.0f,&card->vy) ||
        !json_num_opt(obj,"vz",0.0f,&card->vh) ||
        !json_num_opt(obj,"vh",card->vh,&card->vh))
        return set_error(error,error_size,"vfx: card motion invalid");
    if (!json_num_opt(obj,"frame",0.0f,&frame_f) || !json_num_opt(obj,"frames",0.0f,&frames_f) ||
        frame_f < 0.0f || frames_f < 0.0f || floorf(frame_f) != frame_f || floorf(frames_f) != frames_f)
        return set_error(error,error_size,"vfx: card frame invalid");
    card->max_life = life;
    card->life = life;
    card->size = size;
    card->start_size = size;
    card->end_size = end_size;
    card->alpha = clampf(alpha,0.0f,1.0f);
    card->start_alpha = card->alpha;
    card->end_alpha = end_alpha;
    card->width = width;
    card->frame = (int)frame_f;
    card->frames = (int)frames_f;
    card->r = card->g = card->b = 1.0f;
    if (!json_color_opt(obj,"color",&card->r,&card->g,&card->b))
        return set_error(error,error_size,"vfx: card color must be #rrggbb");
    card->active = false;
    return true;
}

static bool parse_trail(const R2dJson *obj,R2DWorldVfxTrail *trail,
                        char *error,size_t error_size)
{
    if (!obj || obj->type != R2D_JSON_OBJ)
        return set_error(error,error_size,"vfx: trail must be an object");
    memset(trail,0,sizeof *trail);
    if (!json_num_opt(obj,"life",0.3f,&trail->life) || !(trail->life > 0.0f))
        return set_error(error,error_size,"vfx: trail life must be > 0");
    trail->max_life = trail->life;
    if (!json_num_opt(obj,"width",4.0f,&trail->width) || trail->width < 0.0f)
        return set_error(error,error_size,"vfx: trail width must be >= 0");
    if (!json_num_opt(obj,"spacing",0.02f,&trail->spacing) || !(trail->spacing > 0.0f))
        return set_error(error,error_size,"vfx: trail spacing must be > 0");
    if (!json_num_opt(obj,"speed",0.0f,&trail->speed) || trail->speed < 0.0f ||
        !json_num_opt(obj,"vx",0.0f,&trail->vx) ||
        !json_num_opt(obj,"vy",0.0f,&trail->vy) ||
        !json_num_opt(obj,"vz",0.0f,&trail->vh) ||
        !json_num_opt(obj,"vh",trail->vh,&trail->vh))
        return set_error(error,error_size,"vfx: trail motion invalid");
    trail->blend = R2D_PARTICLE_ADDITIVE;
    const char *blend = json_string_opt(obj,"blend");
    if (blend) {
        const int parsed = parse_blend(blend,-1,NULL);
        if (parsed < 0) return set_error(error,error_size,"vfx: unknown trail blend");
        trail->blend = parsed;
    }
    trail->distortion = parse_distortion(json_string_opt(obj,"distortion"));
    trail->r = trail->g = trail->b = 1.0f;
    if (!json_color_opt(obj,"color",&trail->r,&trail->g,&trail->b))
        return set_error(error,error_size,"vfx: trail color must be #rrggbb");
    return true;
}

static bool parse_light(const R2dJson *obj,R2DWorldVfxLight *light,
                        char *error,size_t error_size)
{
    if (!obj || obj->type != R2D_JSON_OBJ)
        return set_error(error,error_size,"vfx: light must be an object");
    memset(light,0,sizeof *light);
    light->token = -1;
    if (!json_num_opt(obj,"radius",200.0f,&light->radius) || !(light->radius > 0.0f))
        return set_error(error,error_size,"vfx: light radius must be > 0");
    if (!json_num_opt(obj,"intensity",2.0f,&light->intensity) || light->intensity < 0.0f)
        return set_error(error,error_size,"vfx: light intensity must be >= 0");
    if (!json_num_opt(obj,"life",0.1f,&light->life) || !(light->life > 0.0f))
        return set_error(error,error_size,"vfx: light life must be > 0");
    light->max_life = light->life;
    if (!json_int_opt(obj,"priority",0,&light->priority))
        return set_error(error,error_size,"vfx: light priority must be an integer");
    if (!json_bool_opt(obj,"shadow",false,&light->shadow))
        return set_error(error,error_size,"vfx: light shadow must be boolean");
    light->r = light->g = light->b = 1.0f;
    if (!json_color_opt(obj,"color",&light->r,&light->g,&light->b))
        return set_error(error,error_size,"vfx: light color must be #rrggbb");
    return true;
}

static bool parse_decal(const R2dJson *obj,R2DWorldVfxDecalPreset *decal,
                        char *error,size_t error_size)
{
    if (!obj || obj->type != R2D_JSON_OBJ)
        return set_error(error,error_size,"vfx: decal must be an object");
    memset(decal,0,sizeof *decal);
    if (!json_int_opt(obj,"material",0,&decal->material) || decal->material < 0)
        return set_error(error,error_size,"vfx: decal material must be >= 0");
    if (!json_num_opt(obj,"width",16.0f,&decal->width) || !(decal->width > 0.0f) ||
        !json_num_opt(obj,"height",16.0f,&decal->height) || !(decal->height > 0.0f))
        return set_error(error,error_size,"vfx: decal width/height must be > 0");
    if (!json_num_opt(obj,"life",0.0f,&decal->life) || decal->life < 0.0f)
        return set_error(error,error_size,"vfx: decal life must be >= 0");
    if (!json_num_opt(obj,"u",0.0f,&decal->u) || !json_num_opt(obj,"v",0.0f,&decal->v))
        return set_error(error,error_size,"vfx: decal uv must be finite");
    return true;
}

static bool parse_bundle(const char *name,const char *json,
                         R2DWorldVfxBundle *bundle,char *error,size_t error_size)
{
    memset(bundle,0,sizeof *bundle);
    if (!name || !name[0] || strlen(name) >= R2D_WORLD_VFX_NAME_MAX)
        return set_error(error,error_size,"vfx: bundle name is empty or too long");
    snprintf(bundle->name,sizeof bundle->name,"%s",name);
    char parse_error[192];
    R2dJson *root = r2d_json_parse(json,parse_error,sizeof parse_error);
    if (!root) {
        snprintf(error,error_size,"vfx: JSON parse failed: %s",parse_error);
        return false;
    }
    if (root->type != R2D_JSON_OBJ) {
        r2d_json_free(root);
        return set_error(error,error_size,"vfx: bundle root must be an object");
    }
    bool ok = true;
    const R2dJson *particles = r2d_json_get(root,"particles");
    if (particles) {
        if (particles->type != R2D_JSON_ARR ||
            particles->count > R2D_WORLD_VFX_MAX_PARTICLE_PRESETS) {
            ok = set_error(error,error_size,"vfx: particles must be an array of at most 4 presets");
        } else {
            for (int i = 0; ok && i < particles->count; i++) {
                ok = parse_particle_preset(r2d_json_at(particles,i),
                                           &bundle->particles[bundle->particle_count],
                                           error,error_size);
                if (ok) bundle->particle_count++;
            }
        }
    }
    const R2dJson *cards = ok ? r2d_json_get(root,"cards") : NULL;
    if (ok && cards) {
        if (cards->type != R2D_JSON_ARR || cards->count > R2D_WORLD_VFX_MAX_CARD_PRESETS) {
            ok = set_error(error,error_size,"vfx: cards must be an array of at most 4 presets");
        } else {
            for (int i = 0; ok && i < cards->count; i++) {
                ok = parse_card_preset(r2d_json_at(cards,i),
                                       &bundle->cards[bundle->card_count],
                                       error,error_size);
                if (ok) bundle->card_count++;
            }
        }
    }
    const R2dJson *trail = ok ? r2d_json_get(root,"trail") : NULL;
    if (ok && trail) {
        ok = parse_trail(trail,&bundle->trail,error,error_size);
        if (ok) bundle->has_trail = true;
    }
    const R2dJson *light = ok ? r2d_json_get(root,"light") : NULL;
    if (ok && light) {
        ok = parse_light(light,&bundle->light,error,error_size);
        if (ok) bundle->has_light = true;
    }
    const R2dJson *decal = ok ? r2d_json_get(root,"decal") : NULL;
    if (ok && decal) {
        ok = parse_decal(decal,&bundle->decal,error,error_size);
        if (ok) bundle->has_decal = true;
    }
    const R2dJson *flash = ok ? r2d_json_get(root,"flash") : NULL;
    if (ok && flash) {
        if (flash->type != R2D_JSON_OBJ) {
            ok = set_error(error,error_size,"vfx: flash must be an object");
        } else {
            float ms = 60.0f;
            float r = 1.0f, g = 1.0f, b = 1.0f;
            if (!json_num_opt(flash,"ms",60.0f,&ms) || ms < 0.0f || ms > 100000.0f ||
                !json_color_opt(flash,"color",&r,&g,&b)) {
                ok = set_error(error,error_size,"vfx: flash ms/color invalid");
            } else {
                bundle->flash_ms = (int)ms;
                bundle->flash_color = ((uint32_t)(r * 255.0f + 0.5f) << 16) |
                                      ((uint32_t)(g * 255.0f + 0.5f) << 8) |
                                      (uint32_t)(b * 255.0f + 0.5f) | 0xff000000u;
            }
        }
    }
    if (ok) {
        const char *sound = json_string_opt(root,"sound");
        if (sound) snprintf(bundle->sound,sizeof bundle->sound,"%s",sound);
        if (!json_num_opt(root,"shake",0.0f,&bundle->shake) || bundle->shake < 0.0f)
            ok = set_error(error,error_size,"vfx: shake must be >= 0");
    }
    bundle->used = ok;
    r2d_json_free(root);
    if (!ok) memset(bundle,0,sizeof *bundle);
    return ok;
}

static R2DWorldVfxBundle *find_bundle(R2DWorldVfx *vfx,const char *name)
{
    if (!vfx || !name) return NULL;
    for (int i = 0; i < R2D_WORLD_VFX_MAX_BUNDLES; i++) {
        if (vfx->bundles[i].used && strcmp(vfx->bundles[i].name,name) == 0)
            return &vfx->bundles[i];
    }
    return NULL;
}

static const R2DWorldVfxBundle *find_bundle_const(const R2DWorldVfx *vfx,const char *name)
{
    return find_bundle((R2DWorldVfx *)vfx,name);
}

void r2d_world_vfx_init(R2DWorldVfx *vfx,R2DWorldParticlePool *particles,int light_budget)
{
    if (!vfx) return;
    memset(vfx,0,sizeof *vfx);
    vfx->particles = particles;
    vfx->light_budget = light_budget < 0 ? 0 :
        (light_budget > R2D_WORLD_VFX_MAX_LIGHTS ? R2D_WORLD_VFX_MAX_LIGHTS : light_budget);
    for (int i = 0; i < R2D_WORLD_VFX_MAX_LIGHTS; i++) vfx->lights[i].token = -1;
}

void r2d_world_vfx_bind(R2DWorldVfx *vfx,R2DWorldParticlePool *particles)
{
    if (!vfx) return;
    if (particles) vfx->particles = particles;
}

void r2d_world_vfx_hooks(R2DWorldVfx *vfx,const R2DWorldVfxHooks *hooks)
{
    if (!vfx) return;
    if (hooks) vfx->hooks = *hooks;
    else memset(&vfx->hooks,0,sizeof vfx->hooks);
}

bool r2d_world_vfx_define(R2DWorldVfx *vfx,const char *name,const char *json,
                          char *error,size_t error_size)
{
    if (!vfx) return set_error(error,error_size,"vfx: no manager");
    if (!json) return set_error(error,error_size,"vfx: bundle JSON is required");
    R2DWorldVfxBundle parsed;
    if (!parse_bundle(name,json,&parsed,error,error_size)) return false;
    R2DWorldVfxBundle *slot = find_bundle(vfx,name);
    if (!slot) {
        for (int i = 0; i < R2D_WORLD_VFX_MAX_BUNDLES; i++) {
            if (!vfx->bundles[i].used) { slot = &vfx->bundles[i]; break; }
        }
    }
    if (!slot) return set_error(error,error_size,"vfx: bundle registry is full");
    if (!slot->used) vfx->bundle_count++;
    parsed.used = true;
    *slot = parsed;
    return true;
}

bool r2d_world_vfx_defined(const R2DWorldVfx *vfx,const char *name)
{
    return find_bundle_const(vfx,name) != NULL;
}

static float spawn_dir(float authored,float override)
{
    return override != 0.0f ? override : authored;
}

static int alloc_card(R2DWorldVfx *vfx)
{
    for (int i = 0; i < R2D_WORLD_VFX_MAX_CARDS; i++) {
        if (!vfx->cards[i].active) return i;
    }
    const int index = vfx->card_cursor++ % R2D_WORLD_VFX_MAX_CARDS;
    return index;
}

static int alloc_trail(R2DWorldVfx *vfx)
{
    for (int i = 0; i < R2D_WORLD_VFX_MAX_TRAILS; i++) {
        if (!vfx->trails[i].active) return i;
    }
    const int index = vfx->trail_cursor++ % R2D_WORLD_VFX_MAX_TRAILS;
    return index;
}

static int active_lights(const R2DWorldVfx *vfx)
{
    int count = 0;
    for (int i = 0; i < R2D_WORLD_VFX_MAX_LIGHTS; i++) if (vfx->lights[i].active) count++;
    return count;
}

static int worst_light(const R2DWorldVfx *vfx)
{
    int worst = -1;
    for (int i = 0; i < R2D_WORLD_VFX_MAX_LIGHTS; i++) {
        if (!vfx->lights[i].active) continue;
        if (worst < 0 || vfx->lights[i].priority < vfx->lights[worst].priority) worst = i;
    }
    return worst;
}

static void remove_light_record(R2DWorldVfx *vfx,int index)
{
    if (index < 0 || index >= R2D_WORLD_VFX_MAX_LIGHTS) return;
    R2DWorldVfxLight *light = &vfx->lights[index];
    if (light->active && light->token >= 0 && vfx->hooks.light_remove)
        vfx->hooks.light_remove(vfx->hooks.user,light->token);
    memset(light,0,sizeof *light);
    light->token = -1;
}

static bool spawn_light(R2DWorldVfx *vfx,const R2DWorldVfxLight *template,
                        float x,float y,float h)
{
    if (!vfx || !template || vfx->light_budget <= 0) return false;
    int index = -1;
    if (active_lights(vfx) >= vfx->light_budget) {
        const int worst = worst_light(vfx);
        if (worst < 0 || template->priority <= vfx->lights[worst].priority) {
            vfx->light_overflow++;
            return false;
        }
        remove_light_record(vfx,worst);
        index = worst;
    }
    if (index < 0) {
        for (int i = 0; i < R2D_WORLD_VFX_MAX_LIGHTS; i++) {
            if (!vfx->lights[i].active) { index = i; break; }
        }
    }
    if (index < 0) {
        vfx->light_overflow++;
        return false;
    }
    R2DWorldVfxLight *light = &vfx->lights[index];
    memset(light,0,sizeof *light);
    *light = *template;
    light->x = x; light->y = y; light->h = h;
    light->life = light->max_life = template->life;
    light->active = true;
    light->token = -1;
    if (vfx->hooks.light_create) {
        light->token = vfx->hooks.light_create(vfx->hooks.user,x,y,h,
            light->radius,light->intensity,light->r,light->g,light->b,
            light->shadow,light->life);
        if (light->token < 0) {
            light->active = false;
            vfx->light_overflow++;
            return false;
        }
    }
    vfx->lights_spawned++;
    return true;
}

static void push_trail_point(R2DWorldVfxTrail *trail,float x,float y,float h)
{
    const int max = R2D_WORLD_VFX_TRAIL_POINTS;
    int count = trail->count;
    if (count < max) count++;
    for (int i = count - 1; i > 0; i--) {
        trail->x[i] = trail->x[i - 1];
        trail->y[i] = trail->y[i - 1];
        trail->h[i] = trail->h[i - 1];
    }
    trail->x[0] = x; trail->y[0] = y; trail->h[0] = h;
    trail->count = count;
}

static bool spawn_decal(R2DWorldVfx *vfx,const R2DWorldVfxDecalPreset *decal,
                        float x,float y,float h,float dx,float dy,float dh)
{
    if (!vfx || !decal || !vfx->hooks.decal_spawn) return false;
    const int token = vfx->hooks.decal_spawn(vfx->hooks.user,x,y,h,dx,dy,dh,
        decal->material,decal->width,decal->height,decal->life);
    if (token < 0) return false;
    if (vfx->decal_count < R2D_WORLD_VFX_MAX_CARDS) {
        vfx->decal_tokens[vfx->decal_count] = token;
        vfx->decal_life[vfx->decal_count] = decal->life > 0.0f ? decal->life : -1.0f;
        vfx->decal_count++;
    }
    vfx->decals_spawned++;
    return true;
}

int r2d_world_vfx_spawn(R2DWorldVfx *vfx,const char *name,
                        float x,float y,float h,
                        float dx,float dy,float dh,uint32_t seed,
                        R2DWorldVfxSpawn *out)
{
    if (out) memset(out,0,sizeof *out);
    if (!vfx || !name) return -1;
    if (!finite3(x,y,h) || !finite3(dx,dy,dh)) return -1;
    R2DWorldVfxBundle *bundle = find_bundle(vfx,name);
    if (!bundle) return -1;

    R2DWorldVfxSpawn result;
    memset(&result,0,sizeof result);
    snprintf(result.sound,sizeof result.sound,"%s",bundle->sound);
    result.shake = bundle->shake;
    result.flash_ms = bundle->flash_ms;
    result.flash_color = bundle->flash_color;

    if (vfx->particles && bundle->particle_count > 0) {
        vfx->particles->seed = seed;
        for (int i = 0; i < bundle->particle_count; i++) {
            R2DWorldVfxParticlePreset *preset = &bundle->particles[i];
            if (preset->count <= 0) continue;
            R2DWorldParticle prototype = preset->proto;
            prototype.x = x; prototype.y = y; prototype.h = h;
            const float dir_x = spawn_dir(preset->dir_x,dx);
            const float dir_y = spawn_dir(preset->dir_y,dy);
            const float dir_h = spawn_dir(preset->dir_h,dh);
            const int spawned = r2d_world_particle_emit_burst(vfx->particles,&prototype,
                preset->count,preset->spread,preset->speed,dir_x,dir_y,dir_h);
            if (spawned < 0) return -1;
            result.particles += spawned;
            vfx->particles_spawned += spawned;
        }
    }
    for (int i = 0; i < bundle->card_count; i++) {
        const int index = alloc_card(vfx);
        R2DWorldVfxCard *card = &vfx->cards[index];
        *card = bundle->cards[i];
        card->active = true;
        card->x = x; card->y = y; card->h = h;
        if (dx != 0.0f || dy != 0.0f || dh != 0.0f) {
            card->vx += dx * card->speed;
            card->vy += dy * card->speed;
            card->vh += dh * card->speed;
        }
        card->life = card->max_life;
        card->size = card->start_size;
        card->alpha = card->start_alpha;
        result.cards++;
        vfx->cards_spawned++;
        if (card->distortion != R2D_VFX_DISTORTION_NONE) result.distortion++;
    }
    if (bundle->has_trail) {
        const int index = alloc_trail(vfx);
        R2DWorldVfxTrail *trail = &vfx->trails[index];
        *trail = bundle->trail;
        trail->active = true;
        trail->life = trail->max_life;
        trail->count = 1;
        trail->accum = 0.0f;
        trail->head_x = trail->x[0] = x;
        trail->head_y = trail->y[0] = y;
        trail->head_h = trail->h[0] = h;
        if (dx != 0.0f || dy != 0.0f || dh != 0.0f) {
            trail->vx += dx * trail->speed;
            trail->vy += dy * trail->speed;
            trail->vh += dh * trail->speed;
        }
        result.trails++;
        vfx->trails_spawned++;
    }
    if (bundle->has_light) {
        if (spawn_light(vfx,&bundle->light,x,y,h)) result.lights++;
    }
    if (bundle->has_decal) {
        if (spawn_decal(vfx,&bundle->decal,x,y,h,dx,dy,dh)) result.decals++;
    }
    vfx->last_seed = seed;
    vfx->fx_spawns++;
    if (out) *out = result;
    return result.particles + result.cards + result.trails + result.lights + result.decals;
}

void r2d_world_vfx_step(R2DWorldVfx *vfx,float dt)
{
    if (!vfx || !isfinite(dt) || dt <= 0.0f) return;
    if (dt > 0.25f) dt = 0.25f;

    for (int i = 0; i < R2D_WORLD_VFX_MAX_CARDS; i++) {
        R2DWorldVfxCard *card = &vfx->cards[i];
        if (!card->active) continue;
        card->x += card->vx * dt;
        card->y += card->vy * dt;
        card->h += card->vh * dt;
        card->rotation += card->spin * dt;
        card->life -= dt;
        float fraction = 0.0f;
        if (card->life <= 0.0f) {
            card->life = 0.0f;
            card->active = false;
            fraction = 1.0f;
        } else if (card->max_life > 0.0f) {
            fraction = 1.0f - card->life / card->max_life;
        }
        if (!card->active) continue;
        if (card->end_size >= 0.0f)
            card->size = card->start_size + (card->end_size - card->start_size) * fraction;
        else
            card->size = card->start_size;
        if (card->size < 0.0f) card->size = 0.0f;
        if (card->end_alpha >= 0.0f)
            card->alpha = card->start_alpha + (card->end_alpha - card->start_alpha) * fraction;
        else
            card->alpha = card->start_alpha;
        card->alpha = clampf(card->alpha,0.0f,1.0f);
        if (card->frames > 0 && card->max_life > 0.0f) {
            int frame = (int)(fraction * (float)card->frames);
            if (frame >= card->frames) frame = card->frames - 1;
            if (frame < 0) frame = 0;
            card->frame = frame;
        }
    }

    for (int i = 0; i < R2D_WORLD_VFX_MAX_TRAILS; i++) {
        R2DWorldVfxTrail *trail = &vfx->trails[i];
        if (!trail->active) continue;
        trail->head_x += trail->vx * dt;
        trail->head_y += trail->vy * dt;
        trail->head_h += trail->vh * dt;
        trail->accum += dt;
        if (trail->spacing > 0.0f) {
            while (trail->accum >= trail->spacing) {
                trail->accum -= trail->spacing;
                push_trail_point(trail,trail->head_x,trail->head_y,trail->head_h);
            }
        }
        trail->life -= dt;
        if (trail->life <= 0.0f) {
            trail->life = 0.0f;
            trail->active = false;
            trail->count = 0;
        }
    }

    for (int i = 0; i < R2D_WORLD_VFX_MAX_LIGHTS; i++) {
        R2DWorldVfxLight *light = &vfx->lights[i];
        if (!light->active) continue;
        light->life -= dt;
        if (light->life <= 0.0f) remove_light_record(vfx,i);
    }

    // Decal lifetime is tracked by the library; the host removes the token.
    int write = 0;
    for (int i = 0; i < vfx->decal_count; i++) {
        float life = vfx->decal_life[i];
        if (life > 0.0f) life -= dt;
        if (life > 0.0f || vfx->decal_life[i] < 0.0f) {
            vfx->decal_tokens[write] = vfx->decal_tokens[i];
            vfx->decal_life[write] = life;
            write++;
        } else if (vfx->hooks.decal_remove) {
            vfx->hooks.decal_remove(vfx->hooks.user,vfx->decal_tokens[i]);
        }
    }
    vfx->decal_count = write;
}

void r2d_world_vfx_step_particles(R2DWorldVfx *vfx,float dt)
{
    if (!vfx || !vfx->particles) return;
    R2DWorldParticleCollision collision;
    if (vfx->hooks.support && vfx->hooks.blocked) {
        collision.support = vfx->hooks.support;
        collision.blocked = vfx->hooks.blocked;
        collision.user = vfx->hooks.user;
        r2d_world_particle_step_collide(vfx->particles,dt,&collision);
    } else {
        r2d_world_particle_step_collide(vfx->particles,dt,NULL);
    }
}

void r2d_world_vfx_clear(R2DWorldVfx *vfx)
{
    if (!vfx) return;
    for (int i = 0; i < R2D_WORLD_VFX_MAX_LIGHTS; i++) remove_light_record(vfx,i);
    if (vfx->hooks.decal_remove) {
        for (int i = 0; i < vfx->decal_count; i++)
            vfx->hooks.decal_remove(vfx->hooks.user,vfx->decal_tokens[i]);
    }
    vfx->decal_count = 0;
    memset(vfx->cards,0,sizeof vfx->cards);
    memset(vfx->trails,0,sizeof vfx->trails);
    vfx->fx_spawns = vfx->particles_spawned = vfx->cards_spawned = 0;
    vfx->trails_spawned = vfx->lights_spawned = vfx->decals_spawned = 0;
    vfx->light_overflow = 0;
}

void r2d_world_vfx_info(const R2DWorldVfx *vfx,R2DWorldVfxInfo *out)
{
    if (!out) return;
    memset(out,0,sizeof *out);
    if (!vfx) return;
    if (vfx->particles) {
        out->particles_alive = r2d_world_particle_alive(vfx->particles);
        out->particle_capacity = vfx->particles->capacity;
        out->particle_overflow = vfx->particles->overflow;
    }
    for (int i = 0; i < R2D_WORLD_VFX_MAX_CARDS; i++) {
        if (!vfx->cards[i].active) continue;
        out->cards++;
        if (vfx->cards[i].distortion != R2D_VFX_DISTORTION_NONE) out->distortion_cards++;
    }
    for (int i = 0; i < R2D_WORLD_VFX_MAX_TRAILS; i++)
        if (vfx->trails[i].active) out->trails++;
    out->temp_lights = active_lights(vfx);
    out->light_budget = vfx->light_budget;
    out->light_overflow = vfx->light_overflow;
    out->decals = vfx->decal_count;
    out->bundles = vfx->bundle_count;
    out->fx_spawns = vfx->fx_spawns;
    out->particles_spawned = vfx->particles_spawned;
    out->cards_spawned = vfx->cards_spawned;
    out->trails_spawned = vfx->trails_spawned;
    out->decals_spawned = vfx->decals_spawned;
    out->emitters = out->trails;
}

void r2d_world_vfx_light_budget(R2DWorldVfx *vfx,int budget)
{
    if (!vfx) return;
    vfx->light_budget = budget < 0 ? 0 :
        (budget > R2D_WORLD_VFX_MAX_LIGHTS ? R2D_WORLD_VFX_MAX_LIGHTS : budget);
    while (active_lights(vfx) > vfx->light_budget) {
        const int worst = worst_light(vfx);
        if (worst < 0) break;
        remove_light_record(vfx,worst);
    }
}

int r2d_world_vfx_get_light_budget(const R2DWorldVfx *vfx)
{
    return vfx ? vfx->light_budget : 0;
}
