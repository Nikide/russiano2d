#pragma once
// ===========================================================================
// Re2D: pure material-animation timeline (roadmap sections 27/28/50/51).
//
// One deterministic, allocation-free state block that a renderer/material cache
// can sample per tick:
//   * flipbook frame index from frames/fps/seed/ping-pong;
//   * UV scroll offsets accumulated modulo 1;
//   * emissive pulse multiplier.
//
// This is NOT a shader graph and NOT a texture loader. The caller owns the
// texture frame list and decides how to combine these values (base UV scale,
// emissive strength, etc.). No mesh, no 3D scene type, no clock reads, no
// globals, no allocation. The same seed plus the same step sequence always
// produces bit-identical state.
//
// Semantics (exact)
// ----------------
// * phase: animation time in seconds, starts at 0 on init/reset and advances
//   only through step(). The caller does not write it.
// * frame: floor(phase * fps) steps, plus a fixed seeded offset of
//   seed_frame() frames, then wrapped:
//      forward   : raw % frames
//      ping-pong : symmetric over the cycle 0..frames-1..1
//                  (0,1,...,frames-2,frames-1,frames-2,...,1,0,...)
//   With frames == 1 the frame is always 0. seed == 0 means no offset.
//   The seeded offset is applied to the frame only, not to pulse phase.
// * seed_frame: a deterministic value in [0,frames) hashed from seed alone; it
//   is the trigger's "random deterministic phase". It is stable across reset.
//   The hash maps seed 0 to frame 0, so seed 0 is the canonical unshifted
//   animation and easy to test.
// * step: dt is normally 0..0.25 s. Non-finite dt and dt <= 0 are ignored;
//   dt > 0.25 is clamped to 0.25. Each accepted step does:
//      phase += dt
//      u_offset = (u_offset + scroll_u * dt) mod 1   in [0,1)
//      v_offset = (v_offset + scroll_v * dt) mod 1   in [0,1)
//   Negative scroll values wrap correctly (e.g. -0.1 -> 0.9).
//   phase is not otherwise wrapped; it is reset to 0 only if float overflow
//   makes it non-finite (a deterministic safety guard, never expected in play).
// * emissive: exactly 1 + pulse_amount * sin(2*pi*phase*pulse_hz). It may be
//   below 0 if pulse_amount > 1; the renderer may clamp it. pulse_hz == 0
//   therefore yields the neutral multiplier 1.
// * init validation: frames must be 1..64, fps finite and > 0, scroll/pulse
//   values finite, pulse_hz >= 0, pulse_amount >= 0. A failed init zeroes the
//   whole block (frames = 0, phase = 0) and returns false, so a zeroed state
//   safely renders frame 0 with neutral emissive.
// * reset: phase = 0, u_offset = v_offset = 0; configuration and seed are
//   preserved. NULL is a no-op for reset/step; NULL samplers return frame 0
//   and emissive 1.0f.
// ===========================================================================
#include <stdbool.h>
#include <stdint.h>

typedef struct {
    int frames;              // flipbook frame count, 1..64
    float fps;               // frame rate, > 0
    bool ping_pong;          // symmetric frame direction
    uint32_t seed;           // deterministic frame-phase offset seed
    float scroll_u, scroll_v; // UV units per second
    float pulse_hz;           // emissive pulse frequency, >= 0
    float pulse_amount;       // emissive amplitude, >= 0
    float u_offset, v_offset; // accumulated UV scroll, each in [0,1)
    float phase;              // animation phase seconds, starts at 0
} R2DWorldMaterialAnim;

// Configure a new timeline. On success: frames/fps/ping_pong/seed/scroll/pulse
// are stored, phase=0, u_offset=v_offset=0. Returns false for NULL or invalid
// arguments (see above); the block is zeroed first, so failure leaves safe
// neutral state.
bool r2d_world_material_anim_init(R2DWorldMaterialAnim *anim, int frames, float fps, bool ping_pong,
                                  uint32_t seed, float scroll_u, float scroll_v,
                                  float pulse_hz, float pulse_amount);

// Advance phase and UV offsets. dt is clamped to 0..0.25 s; non-finite dt and
// dt <= 0 are ignored. NULL is a no-op.
void r2d_world_material_anim_step(R2DWorldMaterialAnim *anim, float dt);

// Current flipbook frame in [0,frames-1], ping-pong and seeded offset aware.
// Returns 0 for NULL or a zeroed/failed block.
int r2d_world_material_anim_frame(const R2DWorldMaterialAnim *anim);

// Emissive multiplier: 1 + pulse_amount*sin(2*pi*phase*pulse_hz). Returns 1.0f
// for NULL.
float r2d_world_material_anim_emissive(const R2DWorldMaterialAnim *anim);

// Deterministic seeded frame offset in [0,frames-1] derived from seed only.
// seed 0 -> 0; frames <= 1 or zeroed block -> 0.
int r2d_world_material_anim_seed_frame(const R2DWorldMaterialAnim *anim);

// Restore runtime state to init values: phase=0, u_offset=v_offset=0.
// Configuration and seed are preserved. NULL is a no-op.
void r2d_world_material_anim_reset(R2DWorldMaterialAnim *anim);
