#pragma once
// ===========================================================================
// Re2D audio voice virtualization policy.
//
// Pure C policy for the existing mixer. It does not create channels, decode
// audio, touch SDL_mixer or mutate engine state: a runtime submits authored
// voice requests and copies the selected slot's channel/gain into its mixer.
// No ECS, no 3D scene, no malloc, no mutable globals, no clock.
//
// Model
// -----
// A manager holds `slot_count` (1..32) managed voices. Each occupied slot is
// either:
//   * real    - has a mixer channel (0..slot_count-1), audible gain;
//   * virtual - no channel, gain 0, still tracked for promotion.
// Virtual voices are produced by distance culling (distance >= range), by an
// explicit `request.virtual` hint, or when no real slot can be taken. When a
// real channel frees (remove/rebalance), audible virtual voices are promoted
// in the deterministic order priority DESC, distance ASC, id ASC.
//
// Stealing
// --------
// When capacity is exhausted, a new audible request replaces the worst slot
// (lowest priority, then farthest distance, then highest id) only if the new
// request is strictly better under the same order. Tie-breaks are exact.
//
// Buses and ducking
// -----------------
// SFX, AMBIENT, MUSIC, COMBAT and UI are metadata buses for the mixer. Ducking
// is a per-bus amount in [0,1]; effective gain is multiplied by (1 - amount).
// Music/combat stems use the MUSIC/COMBAT bus and can be ducked independently.
// ===========================================================================
#include <stdbool.h>

#define R2D_AUDIO_VOICES_MAX 32

enum {
    R2D_AUDIO_BUS_SFX = 0,
    R2D_AUDIO_BUS_AMBIENT = 1,
    R2D_AUDIO_BUS_MUSIC = 2,
    R2D_AUDIO_BUS_COMBAT = 3,
    R2D_AUDIO_BUS_UI = 4,
    R2D_AUDIO_BUS_COUNT = 5
};

typedef struct {
    int id;               // stable voice id, >= 0; resubmit updates
    int priority;         // higher is more important; any int
    float x,y,h;          // world position for distance culling
    float volume;         // 0..1 base gain
    float range;          // > 0; distance >= range means virtual/gain 0
    bool loop;            // data-only policy: one-shot vs looping
    bool virtual;         // hint: prefer virtual instead of stealing a channel
    int bus;              // R2D_AUDIO_BUS_*
    int channel;          // preferred real channel, or -1 for auto
} R2DAudioVoiceRequest;

typedef struct {
    int channel;          // mixer channel, -1 for a virtual voice
    int voice_id;         // request id, -1 for a free slot
    float gain;           // final gain: distance attenuation * (1 - duck)
    bool virtual;         // true when no channel is held
} R2DAudioVoiceSlot;

typedef struct {
    R2DAudioVoiceSlot slots[R2D_AUDIO_VOICES_MAX];
    int slot_count;       // capacity 1..32; 0 means a rejected/disabled manager
    float listener_x,listener_y,listener_h;
    float duck[R2D_AUDIO_BUS_COUNT];
    // Private policy metadata, parallel to slots. Read slots instead.
    R2DAudioVoiceRequest meta[R2D_AUDIO_VOICES_MAX];
} R2DAudioVoices;

// Initialise a manager with capacity 1..32. Any other value yields a disabled
// manager (slot_count 0); NULL is a no-op. All slots start free.
void r2d_audio_voices_init(R2DAudioVoices *voices,int slots);

// Submit or update one voice. Returns the slot index it occupies, or -1 when
// rejected (NULL, disabled manager, id < 0, bus out of range, non-finite
// position/volume/range, volume outside 0..1, range <= 0, channel outside
// [-1, slot_count-1]). Existing ids update in place; duplicates never appear.
int r2d_audio_voices_submit(R2DAudioVoices *voices,const R2DAudioVoiceRequest *request);

// Remove a voice by id (one-shot completion or an explicit stop). Removing a
// real voice frees its channel and immediately rebalances/promotes. Unknown
// ids are a no-op. NULL is rejected.
void r2d_audio_voices_remove(R2DAudioVoices *voices,int voice_id);

// Move the listener. Finite x/y/h only; it does not rebalance by itself, call
// r2d_audio_voices_rebalance() after changing the listener or positions.
void r2d_audio_voices_listener(R2DAudioVoices *voices,float x,float y,float h);

// Recompute distance culling, promote virtual voices while channels are free,
// demote out-of-range real voices, and refresh gains (including ducking).
void r2d_audio_voices_rebalance(R2DAudioVoices *voices);

// Counts of occupied slots (real + virtual) and of virtual-only slots.
int r2d_audio_voices_active(const R2DAudioVoices *voices);
int r2d_audio_voices_virtual(const R2DAudioVoices *voices);

// Set a bus ducking amount in [0,1] (clamped). 0 = no duck, 1 = mute that bus.
// Invalid bus or non-finite amount is ignored. Gains refresh immediately.
void r2d_audio_voices_duck(R2DAudioVoices *voices,int bus,float amount);
