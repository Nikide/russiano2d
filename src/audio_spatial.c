#include "audio_spatial.h"
#include <SDL3/SDL.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#ifdef R2D_STEAM_AUDIO
#include <phonon.h>
#endif
#define BLOCK 512
#define CHANNELS 16
// Game thread publishes only atomics; all filter/history state belongs to audio.
typedef struct Spatial {
    SDL_AtomicInt enabled,hrtf,x,y,z,cutoff,reset;
    int seen,fill,rate;
    float low,mono[BLOCK],left[BLOCK],right[BLOCK];
#ifdef R2D_STEAM_AUDIO
    IPLBinauralEffect effect;
    IPLHRTF h;
#endif
} Spatial;
typedef struct Bank {
    Spatial channels[CHANNELS];
    bool hrtf;
#ifdef R2D_STEAM_AUDIO
    IPLContext context;
    IPLHRTF h;
#endif
} Bank;
static void block(Spatial *s,float x,float y,float z,bool hrtf) {
#ifdef R2D_STEAM_AUDIO
    if(hrtf&&s->effect) {
        float *input[]={s->mono},*output[]={s->left,s->right};
        IPLAudioBuffer in={1,BLOCK,input},out={2,BLOCK,output};
        IPLBinauralEffectParams p={0};p.direction=(IPLVector3){x,y,z};p.interpolation=IPL_HRTFINTERPOLATION_BILINEAR;p.spatialBlend=1;p.hrtf=s->h;
        iplBinauralEffectApply(s->effect,&p,&in,&out);return;
    }
#else
    (void)y;(void)z;(void)hrtf;
#endif
    float l=sqrtf((1-fmaxf(-1,fminf(1,x)))*.5f),r=sqrtf((1+fmaxf(-1,fminf(1,x)))*.5f);
    for(int i=0;i<BLOCK;i++){s->left[i]=s->mono[i]*l;s->right[i]=s->mono[i]*r;}
}
void *r2d_audio_spatial_create(int rate,int channels) {
    if(channels!=2)return NULL;
    Bank *b=calloc(1,sizeof *b);if(!b)return NULL;
#ifdef R2D_STEAM_AUDIO
    IPLContextSettings cs={0};cs.version=STEAMAUDIO_VERSION;
    IPLAudioSettings as={rate,BLOCK};IPLHRTFSettings hs={0};hs.type=IPL_HRTFTYPE_DEFAULT;hs.volume=.8f;hs.normType=IPL_HRTFNORMTYPE_RMS;
    if(iplContextCreate(&cs,&b->context)==IPL_STATUS_SUCCESS&&iplHRTFCreate(b->context,&as,&hs,&b->h)==IPL_STATUS_SUCCESS) {
        b->hrtf=true;
        for(int i=0;i<CHANNELS;i++) {
            Spatial *s=&b->channels[i];IPLBinauralEffectSettings es={b->h};s->h=b->h;
            if(iplBinauralEffectCreate(b->context,&as,&es,&s->effect)!=IPL_STATUS_SUCCESS)b->hrtf=false;
            if(s->effect){block(s,0,0,-1,true);iplBinauralEffectReset(s->effect);memset(s->left,0,sizeof s->left);memset(s->right,0,sizeof s->right);}
        }
    }
#endif
    for(int i=0;i<CHANNELS;i++){b->channels[i].rate=rate;SDL_SetAtomicInt(&b->channels[i].cutoff,22000);SDL_SetAtomicInt(&b->channels[i].z,-100000);}
    return b;
}
void r2d_audio_spatial_destroy(void *bank) {
    Bank *b=bank;if(!b)return;
#ifdef R2D_STEAM_AUDIO
    for(int i=0;i<CHANNELS;i++)if(b->channels[i].effect)iplBinauralEffectRelease(&b->channels[i].effect);
    if(b->h)iplHRTFRelease(&b->h);if(b->context)iplContextRelease(&b->context);
#endif
    free(b);
}
void *r2d_audio_spatial_channel(void *bank,int c){return bank&&c>=0&&c<CHANNELS?&((Bank*)bank)->channels[c]:NULL;}
bool r2d_audio_spatial_hrtf(void *bank){return bank&&((Bank*)bank)->hrtf;}
void r2d_audio_spatial_params(void *channel,bool enabled,bool hrtf,float x,float y,float z,float cutoff) {
    Spatial *s=channel;if(!s)return;
    SDL_SetAtomicInt(&s->x,(int)(x*100000));SDL_SetAtomicInt(&s->y,(int)(y*100000));SDL_SetAtomicInt(&s->z,(int)(z*100000));SDL_SetAtomicInt(&s->cutoff,(int)cutoff);
    SDL_SetAtomicInt(&s->hrtf,hrtf);SDL_SetAtomicInt(&s->enabled,enabled);
}
void r2d_audio_spatial_reset(void *channel){if(channel)SDL_AddAtomicInt(&((Spatial*)channel)->reset,1);}
void r2d_audio_spatial_process(void *channel,const SDL_AudioSpec *spec,float *pcm,int samples) {
    Spatial *s=channel;if(!s||!SDL_GetAtomicInt(&s->enabled)||!spec||spec->channels!=2||!pcm)return;
    int reset=SDL_GetAtomicInt(&s->reset);
    if(reset!=s->seen){s->seen=reset;s->fill=0;s->low=0;memset(s->left,0,sizeof s->left);memset(s->right,0,sizeof s->right);
#ifdef R2D_STEAM_AUDIO
        if(s->effect)iplBinauralEffectReset(s->effect);
#endif
    }
    float x=SDL_GetAtomicInt(&s->x)/100000.f,y=SDL_GetAtomicInt(&s->y)/100000.f,z=SDL_GetAtomicInt(&s->z)/100000.f;
    bool hrtf=SDL_GetAtomicInt(&s->hrtf)!=0;
    float cutoff=fminf(SDL_GetAtomicInt(&s->cutoff),s->rate*.45f),alpha=1-expf(-2*SDL_PI_F*cutoff/s->rate);
    for(int i=0;i+1<samples;i+=2) {
        float mono=(pcm[i]+pcm[i+1])*.5f;s->low+=alpha*(mono-s->low);
        pcm[i]=s->left[s->fill];pcm[i+1]=s->right[s->fill];s->mono[s->fill++]=s->low;
        if(s->fill==BLOCK){block(s,x,y,z,hrtf);s->fill=0;}
    }
}
