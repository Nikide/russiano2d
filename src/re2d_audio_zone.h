#pragma once
// ===========================================================================
// Re2D: reverb-zone presets + portal-aware room approximation (P1 audio core).
//
// This is deliberately NOT a Steam Audio / HRTF room simulator. It is a small,
// deterministic heuristic over the existing 2D span/portal topology: an authored
// zone picks a reverb preset, room dimensions pick/blend a preset, and a short
// chain of portals attenuates the reverb send. Pure C, no allocation, no
// globals, no engine state.
//
// Attenuation heuristic (documented contract):
//   effective_hops = clamp(config->max_hops, 0, 4)
//   base  = clamp(direct_attenuation, 0, 1) * exp(-max(direct_distance,0)/scale)
//   chain = product over hops of clamp(open_fraction[i],0,1) * PORTAL_TRANSMISSION
//   result = clamp(base * chain, 0, 1)
// A closed portal (fraction <= 0) blocks the path. A path longer than the hop
// limit is blocked. portal_ids are caller bookkeeping (path diagnostics) and do
// not change the maths.
// ===========================================================================
#include <stdbool.h>

enum {
    R2D_AUDIO_ZONE_ROOM=0,
    R2D_AUDIO_ZONE_HALL=1,
    R2D_AUDIO_ZONE_CAVE=2,
    R2D_AUDIO_ZONE_OUTSIDE=3,
    R2D_AUDIO_ZONE_METAL=4,
    R2D_AUDIO_ZONE_MAGIC=5,
    R2D_AUDIO_ZONE_COUNT=6
};

#define R2D_AUDIO_ZONE_MAX_HOPS 4
#define R2D_AUDIO_PORTAL_TRANSMISSION 0.85f

typedef struct { float wet,dry,decay,damping; int preset; } R2DAudioReverbZone;

// Static presets: room/hall/cave/outside/metal/magic. NULL for an unknown
// preset. Values are finite, in 0..1, and distinct between presets.
const R2DAudioReverbZone *r2d_audio_zone_preset(int preset);

typedef struct { int span; R2DAudioReverbZone zone; float volume; } R2DAudioZoneVolume;
typedef struct { int from_portal,to_portal; float attenuation; int hops; } R2DAudioPortalPath;

typedef struct { int max_hops; float distance_scale; } R2DAudioZoneConfig;

// Portal-aware attenuation. Returns 0 for invalid input (NULL config, negative
// max_hops, non-finite distance/scale/direct attenuation, hop_count outside
// 0..clamped limit, hop_count>0 with NULL fractions). max_hops above 4 is
// clamped to 4. Fractions are clamped to 0..1; any fraction <= 0 blocks the
// path. Result is always finite and in [0,1].
float r2d_audio_zone_attenuation(const R2DAudioZoneConfig*,const float *portal_open_fraction,const int *portal_ids,int hop_count,float direct_distance,float direct_attenuation);

// Estimate room volume from footprint (width*height) and room_height and choose
// or blend a preset:
//   <=400         ROOM
//   <=4000        ROOM -> HALL linear blend
//   <=40000       HALL
//   >40000        HALL -> CAVE linear blend, saturating at 200000
// Invalid dimensions (non-finite or <=0) zero *out and set preset=-1.
void r2d_audio_zone_from_room(float width,float height,float room_height,R2DAudioReverbZone *out);

// Acoustic material tags. occlusion_gain/transmission are in 0..1, cutoff is Hz.
typedef struct { float occlusion_gain,cutoff,transmission; } R2DAudioMaterialAcoustic;

enum {
    R2D_AUDIO_MATERIAL_DEFAULT=0,
    R2D_AUDIO_MATERIAL_CONCRETE=1,
    R2D_AUDIO_MATERIAL_METAL=2,
    R2D_AUDIO_MATERIAL_WOOD=3,
    R2D_AUDIO_MATERIAL_GLASS=4,
    R2D_AUDIO_MATERIAL_FABRIC=5,
    R2D_AUDIO_MATERIAL_COUNT=6
};

// Static material table; NULL for an unknown tag.
const R2DAudioMaterialAcoustic *r2d_audio_material_acoustic(int material_tag);
