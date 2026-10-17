#include "re2d_audio_zone.h"

#include <math.h>
#include <string.h>

// Pure deterministic tables and arithmetic: no allocation, no mutable globals.

static const R2DAudioReverbZone preset_table[R2D_AUDIO_ZONE_COUNT]={
    {0.25f,1.00f,0.60f,0.40f,R2D_AUDIO_ZONE_ROOM},
    {0.55f,0.80f,0.85f,0.30f,R2D_AUDIO_ZONE_HALL},
    {0.60f,0.75f,0.90f,0.55f,R2D_AUDIO_ZONE_CAVE},
    {0.08f,1.00f,0.20f,0.70f,R2D_AUDIO_ZONE_OUTSIDE},
    {0.70f,0.70f,0.75f,0.15f,R2D_AUDIO_ZONE_METAL},
    {0.65f,0.80f,0.80f,0.25f,R2D_AUDIO_ZONE_MAGIC}
};

static const R2DAudioMaterialAcoustic material_table[R2D_AUDIO_MATERIAL_COUNT]={
    {0.85f,12000.0f,0.70f}, // DEFAULT
    {0.90f, 9000.0f,0.65f}, // CONCRETE
    {0.75f,14000.0f,0.80f}, // METAL
    {0.80f, 7000.0f,0.50f}, // WOOD
    {0.85f,16000.0f,0.90f}, // GLASS
    {0.55f, 3500.0f,0.20f}  // FABRIC
};

const R2DAudioReverbZone *r2d_audio_zone_preset(int preset)
{
    if(preset<0||preset>=R2D_AUDIO_ZONE_COUNT) return NULL;
    return &preset_table[preset];
}

const R2DAudioMaterialAcoustic *r2d_audio_material_acoustic(int material_tag)
{
    if(material_tag<0||material_tag>=R2D_AUDIO_MATERIAL_COUNT) return NULL;
    return &material_table[material_tag];
}

static float clamp01(float value)
{
    if(!(value>0.0f)) return 0.0f; // also maps NaN to 0
    if(value>1.0f) return 1.0f;
    return value;
}

float r2d_audio_zone_attenuation(const R2DAudioZoneConfig *config,
                                 const float *portal_open_fraction,const int *portal_ids,
                                 int hop_count,float direct_distance,float direct_attenuation)
{
    if(!config) return 0.0f;
    if(config->max_hops<0) return 0.0f;
    int max_hops=config->max_hops>R2D_AUDIO_ZONE_MAX_HOPS
        ?R2D_AUDIO_ZONE_MAX_HOPS:config->max_hops;
    if(!isfinite(config->distance_scale)||config->distance_scale<=0.0f) return 0.0f;
    if(!isfinite(direct_distance)||!isfinite(direct_attenuation)) return 0.0f;
    if(hop_count<0||hop_count>max_hops) return 0.0f;
    (void)portal_ids; // caller bookkeeping; attenuation uses only open fractions

    float distance=direct_distance>0.0f?direct_distance:0.0f;
    double result=(double)clamp01(direct_attenuation)*exp(-(double)distance/(double)config->distance_scale);
    for(int i=0;i<hop_count;i++) {
        if(!portal_open_fraction) return 0.0f;
        float open=portal_open_fraction[i];
        if(!isfinite(open)) return 0.0f;
        if(open<=0.0f) return 0.0f; // closed portal blocks the path
        if(open>1.0f) open=1.0f;
        result*=((double)open)*(double)R2D_AUDIO_PORTAL_TRANSMISSION;
    }
    if(!isfinite(result)) return 0.0f;
    return clamp01((float)result);
}

static R2DAudioReverbZone blend_zone(const R2DAudioReverbZone *a,const R2DAudioReverbZone *b,float t)
{
    R2DAudioReverbZone out;
    out.wet=a->wet+(b->wet-a->wet)*t;
    out.dry=a->dry+(b->dry-a->dry)*t;
    out.decay=a->decay+(b->decay-a->decay)*t;
    out.damping=a->damping+(b->damping-a->damping)*t;
    out.preset=t<0.5f?a->preset:b->preset;
    return out;
}

void r2d_audio_zone_from_room(float width,float height,float room_height,R2DAudioReverbZone *out)
{
    if(!out) return;
    memset(out,0,sizeof *out);
    out->preset=-1;
    if(!isfinite(width)||!isfinite(height)||!isfinite(room_height)||
       width<=0.0f||height<=0.0f||room_height<=0.0f) return;

    double volume=(double)width*(double)height*(double)room_height;
    if(!isfinite(volume)) return;

    const R2DAudioReverbZone *room=&preset_table[R2D_AUDIO_ZONE_ROOM];
    const R2DAudioReverbZone *hall=&preset_table[R2D_AUDIO_ZONE_HALL];
    const R2DAudioReverbZone *cave=&preset_table[R2D_AUDIO_ZONE_CAVE];
    if(volume<=400.0) {
        *out=*room;
    } else if(volume<=4000.0) {
        *out=blend_zone(room,hall,(float)((volume-400.0)/3600.0));
    } else if(volume<=40000.0) {
        *out=*hall;
    } else {
        double t=(volume-40000.0)/160000.0;
        if(t>1.0) t=1.0;
        *out=blend_zone(hall,cave,(float)t);
    }
}
