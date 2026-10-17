#include "re2d_audio_voices.h"

#include <math.h>
#include <stddef.h>
#include <string.h>

// Pure voice-virtualization policy: no allocation, no globals, no time source.
// Every operation depends only on the manager and its arguments.

static bool manager_valid(const R2DAudioVoices *v)
{
    return v != NULL && v->slot_count >= 1 && v->slot_count <= R2D_AUDIO_VOICES_MAX;
}

static void clear_slot(R2DAudioVoices *v,int index)
{
    v->slots[index].channel = -1;
    v->slots[index].voice_id = -1;
    v->slots[index].gain = 0.0f;
    v->slots[index].virtual = true;
    memset(&v->meta[index], 0, sizeof v->meta[index]);
}

static int find_voice(const R2DAudioVoices *v,int voice_id)
{
    for (int i = 0; i < v->slot_count; i++) {
        if (v->slots[i].voice_id == voice_id) return i;
    }
    return -1;
}

static int free_slot(const R2DAudioVoices *v)
{
    for (int i = 0; i < v->slot_count; i++) {
        if (v->slots[i].voice_id < 0) return i;
    }
    return -1;
}

static float distance_sq(const R2DAudioVoices *v,const R2DAudioVoiceRequest *r)
{
    const float dx = r->x - v->listener_x;
    const float dy = r->y - v->listener_y;
    const float dz = r->h - v->listener_h;
    return dx * dx + dy * dy + dz * dz;
}

static bool audible(const R2DAudioVoices *v,const R2DAudioVoiceRequest *r)
{
    return distance_sq(v,r) < r->range * r->range;
}

static float gain_of(const R2DAudioVoices *v,const R2DAudioVoiceRequest *r)
{
    const float d2 = distance_sq(v,r);
    if (!(d2 < r->range * r->range)) return 0.0f;
    const float d = sqrtf(d2);
    float attenuation = 1.0f - d / r->range;
    if (!(attenuation > 0.0f)) attenuation = 0.0f;
    float duck = v->duck[r->bus];
    if (!(duck >= 0.0f)) duck = 0.0f;
    if (duck > 1.0f) duck = 1.0f;
    return r->volume * attenuation * (1.0f - duck);
}

static bool channel_used(const R2DAudioVoices *v,int channel)
{
    for (int i = 0; i < v->slot_count; i++) {
        if (!v->slots[i].virtual && v->slots[i].voice_id >= 0 &&
            v->slots[i].channel == channel) return true;
    }
    return false;
}

static int alloc_channel(const R2DAudioVoices *v,int preferred)
{
    if (preferred >= 0 && preferred < v->slot_count && !channel_used(v,preferred)) {
        return preferred;
    }
    for (int channel = 0; channel < v->slot_count; channel++) {
        if (!channel_used(v,channel)) return channel;
    }
    return -1;
}

static int real_count(const R2DAudioVoices *v)
{
    int count = 0;
    for (int i = 0; i < v->slot_count; i++) {
        if (v->slots[i].voice_id >= 0 && !v->slots[i].virtual) count++;
    }
    return count;
}

// True when voice `a` is better than voice `b`: priority DESC, distance ASC,
// id ASC. Distances use squared values; ordering is identical for non-negative
// distances and avoids a square root in every comparison.
static bool voice_better(const R2DAudioVoices *v,int a,int b)
{
    const R2DAudioVoiceRequest *ra = &v->meta[a];
    const R2DAudioVoiceRequest *rb = &v->meta[b];
    if (ra->priority != rb->priority) return ra->priority > rb->priority;
    const float da = distance_sq(v,ra);
    const float db = distance_sq(v,rb);
    if (da != db) return da < db;
    return ra->id < rb->id;
}

static bool request_better(const R2DAudioVoices *v,const R2DAudioVoiceRequest *r,int index)
{
    const R2DAudioVoiceRequest *other = &v->meta[index];
    if (r->priority != other->priority) return r->priority > other->priority;
    const float dr = distance_sq(v,r);
    const float do2 = distance_sq(v,other);
    if (dr != do2) return dr < do2;
    return r->id < other->id;
}

// Worst occupied slot: reverse of voice_better(). When `virtual_only` is set,
// only virtual slots are considered.
static int worst_slot(const R2DAudioVoices *v,bool virtual_only)
{
    int worst = -1;
    for (int i = 0; i < v->slot_count; i++) {
        if (v->slots[i].voice_id < 0) continue;
        if (virtual_only && !v->slots[i].virtual) continue;
        if (worst < 0 || voice_better(v,worst,i)) worst = i;
    }
    return worst;
}

static int best_virtual_audible(const R2DAudioVoices *v)
{
    int best = -1;
    for (int i = 0; i < v->slot_count; i++) {
        if (v->slots[i].voice_id < 0 || !v->slots[i].virtual) continue;
        if (!audible(v,&v->meta[i])) continue;
        if (best < 0 || voice_better(v,i,best)) best = i;
    }
    return best;
}

static void refresh_gains(R2DAudioVoices *v)
{
    for (int i = 0; i < v->slot_count; i++) {
        if (v->slots[i].voice_id < 0) continue;
        v->slots[i].gain = v->slots[i].virtual ? 0.0f : gain_of(v,&v->meta[i]);
    }
}

static void promote_virtual(R2DAudioVoices *v)
{
    while (real_count(v) < v->slot_count) {
        const int index = best_virtual_audible(v);
        if (index < 0) break;
        const int channel = alloc_channel(v,v->meta[index].channel);
        if (channel < 0) break;
        v->slots[index].virtual = false;
        v->slots[index].channel = channel;
    }
}

static void place_new(R2DAudioVoices *v,int index,const R2DAudioVoiceRequest *r,bool want_real)
{
    v->meta[index] = *r;
    v->slots[index].voice_id = r->id;
    v->slots[index].gain = 0.0f;
    v->slots[index].virtual = true;
    v->slots[index].channel = -1;
    if (want_real) {
        const int channel = alloc_channel(v,r->channel);
        if (channel >= 0) {
            v->slots[index].virtual = false;
            v->slots[index].channel = channel;
        }
    }
    v->slots[index].gain = v->slots[index].virtual ? 0.0f : gain_of(v,r);
}

void r2d_audio_voices_init(R2DAudioVoices *voices,int slots)
{
    if (!voices) return;
    memset(voices, 0, sizeof *voices);
    voices->slot_count = (slots >= 1 && slots <= R2D_AUDIO_VOICES_MAX) ? slots : 0;
    for (int i = 0; i < R2D_AUDIO_VOICES_MAX; i++) {
        voices->slots[i].channel = -1;
        voices->slots[i].voice_id = -1;
        voices->slots[i].gain = 0.0f;
        voices->slots[i].virtual = true;
    }
}

int r2d_audio_voices_submit(R2DAudioVoices *voices,const R2DAudioVoiceRequest *request)
{
    if (!manager_valid(voices) || !request) return -1;
    const R2DAudioVoiceRequest r = *request;

    if (r.id < 0) return -1;
    if (r.bus < 0 || r.bus >= R2D_AUDIO_BUS_COUNT) return -1;
    if (r.channel < -1 || r.channel >= voices->slot_count) return -1;
    if (!isfinite(r.x) || !isfinite(r.y) || !isfinite(r.h)) return -1;
    if (!isfinite(r.volume) || r.volume < 0.0f || r.volume > 1.0f) return -1;
    if (!isfinite(r.range) || !(r.range > 0.0f)) return -1;

    const int existing = find_voice(voices,r.id);
    if (existing >= 0) {
        const bool was_real = !voices->slots[existing].virtual;
        voices->meta[existing] = r;
        if (!audible(voices,&r)) {
            voices->slots[existing].virtual = true;
            voices->slots[existing].channel = -1;
        } else if (voices->slots[existing].virtual && !r.virtual) {
            const int channel = alloc_channel(voices,r.channel);
            if (channel >= 0) {
                voices->slots[existing].virtual = false;
                voices->slots[existing].channel = channel;
            }
        }
        voices->slots[existing].gain =
            voices->slots[existing].virtual ? 0.0f : gain_of(voices,&r);
        // A real channel was released by this update: let a virtual voice use
        // it immediately, matching the remove()/rebalance() contract.
        if (was_real && voices->slots[existing].virtual) r2d_audio_voices_rebalance(voices);
        return existing;
    }

    const bool is_audible = audible(voices,&r);
    // Explicit virtual hint and inaudible voices never steal a real channel.
    if (!is_audible || r.virtual) {
        int index = free_slot(voices);
        if (index < 0) {
            const int victim = worst_slot(voices,true);
            if (victim < 0 || !request_better(voices,&r,victim)) return -1;
            clear_slot(voices,victim);
            index = victim;
        }
        place_new(voices,index,&r,false);
        return index;
    }

    int index = free_slot(voices);
    if (index < 0) {
        const int victim = worst_slot(voices,false);
        if (victim < 0 || !request_better(voices,&r,victim)) return -1;
        clear_slot(voices,victim);
        index = victim;
    }
    place_new(voices,index,&r,true);
    return index;
}

void r2d_audio_voices_remove(R2DAudioVoices *voices,int voice_id)
{
    if (!manager_valid(voices) || voice_id < 0) return;
    const int index = find_voice(voices,voice_id);
    if (index < 0) return;
    clear_slot(voices,index);
    r2d_audio_voices_rebalance(voices);
}

void r2d_audio_voices_listener(R2DAudioVoices *voices,float x,float y,float h)
{
    if (!manager_valid(voices)) return;
    if (!isfinite(x) || !isfinite(y) || !isfinite(h)) return;
    voices->listener_x = x;
    voices->listener_y = y;
    voices->listener_h = h;
}

void r2d_audio_voices_rebalance(R2DAudioVoices *voices)
{
    if (!manager_valid(voices)) return;

    // Cull first: out-of-range real voices release their channels.
    for (int i = 0; i < voices->slot_count; i++) {
        if (voices->slots[i].voice_id < 0) continue;
        if (!audible(voices,&voices->meta[i])) {
            voices->slots[i].virtual = true;
            voices->slots[i].channel = -1;
        }
    }
    promote_virtual(voices);
    refresh_gains(voices);
}

int r2d_audio_voices_active(const R2DAudioVoices *voices)
{
    if (!manager_valid(voices)) return 0;
    int count = 0;
    for (int i = 0; i < voices->slot_count; i++) {
        if (voices->slots[i].voice_id >= 0) count++;
    }
    return count;
}

int r2d_audio_voices_virtual(const R2DAudioVoices *voices)
{
    if (!manager_valid(voices)) return 0;
    int count = 0;
    for (int i = 0; i < voices->slot_count; i++) {
        if (voices->slots[i].voice_id >= 0 && voices->slots[i].virtual) count++;
    }
    return count;
}

void r2d_audio_voices_duck(R2DAudioVoices *voices,int bus,float amount)
{
    if (!manager_valid(voices)) return;
    if (bus < 0 || bus >= R2D_AUDIO_BUS_COUNT) return;
    if (!isfinite(amount)) return;
    if (amount < 0.0f) amount = 0.0f;
    if (amount > 1.0f) amount = 1.0f;
    voices->duck[bus] = amount;
    refresh_gains(voices);
}
