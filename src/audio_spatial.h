#pragma once
#include <stdbool.h>
#include <SDL3/SDL_audio.h>
// PCM-only Steam Audio adapter, no imported geometry or simulation scene.
void *r2d_audio_spatial_create(int rate,int channels);
void r2d_audio_spatial_destroy(void *bank);
void *r2d_audio_spatial_channel(void *bank,int channel);
void r2d_audio_spatial_params(void *channel,bool enabled,bool hrtf,float right,float up,float back,float cutoff);
void r2d_audio_spatial_reset(void *channel);
void r2d_audio_spatial_process(void *channel,const SDL_AudioSpec *,float *,int);
bool r2d_audio_spatial_hrtf(void *bank);
