#include "audio_spatial.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#define N 8192
static float input[N*2],a[N*2],b[N*2];
static int failures,checks;
static SDL_AudioSpec spec={SDL_AUDIO_F32,2,48000};
static void check(int ok,const char *name){checks++;printf("%s %s\n",ok?"ok":"FAIL",name);if(!ok)failures++;}
static void render(void *s,float *out,float x,float y,float z,float cutoff,int chunk){
 memcpy(out,input,sizeof input);r2d_audio_spatial_reset(s);r2d_audio_spatial_params(s,true,true,x,y,z,cutoff);
 for(int i=0;i<N;i+=chunk){int n=N-i<chunk?N-i:chunk;r2d_audio_spatial_process(s,&spec,out+i*2,n*2);}
}
static double diff(void){double d=0;for(int i=0;i<N*2;i++)d+=fabs(a[i]-b[i]);return d;}
static double energy(float *v,int ear){double d=0;for(int i=1024;i<N;i++)d+=v[i*2+ear]*v[i*2+ear];return d;}
int main(void){
 void *bank=r2d_audio_spatial_create(48000,2),*s=r2d_audio_spatial_channel(bank,0);check(bank&&s&&r2d_audio_spatial_hrtf(bank),"actual Steam Audio default HRTF initializes");if(!bank||!s)return 1;
 unsigned noise=7;for(int i=0;i<N;i++){noise=noise*1664525u+1013904223u;input[i*2]=input[i*2+1]=((noise>>8)/16777216.f-.5f)*.2f;}
 render(s,a,1,0,0,22000,N);check(energy(a,1)>energy(a,0)*1.1,"right-side HRTF has stronger right ear");
 render(s,b,-1,0,0,22000,N);check(energy(b,0)>energy(b,1)*1.1,"left-side HRTF has stronger left ear");
 render(s,a,0,0,-1,22000,N);render(s,b,0,0,1,22000,N);check(diff()>1,"front and back have different spectral impulse responses");
 render(s,b,0,1,0,22000,N);check(diff()>1,"elevation changes HRTF response");
 render(s,a,.6f,0,-.8f,22000,N);render(s,b,.6f,0,-.8f,22000,73);check(diff()<.0001,"irregular SDL callback chunks preserve PCM and filter history");
 int finite=1;for(int i=0;i<N*2;i++)if(!isfinite(a[i]))finite=0;check(finite,"output PCM is finite");
 for(int i=0;i<N;i++)input[i*2]=input[i*2+1]=.2f*sinf(2*3.14159265f*8000*i/48000);
 render(s,a,0,0,-1,22000,N);render(s,b,0,0,-1,700,N);check(energy(b,0)<energy(a,0)*.03,"occlusion low-pass suppresses 8 kHz energy");
 memcpy(a,input,sizeof input);r2d_audio_spatial_params(s,false,true,0,0,-1,700);r2d_audio_spatial_process(s,&spec,a,N*2);check(!memcmp(a,input,sizeof input),"ordinary audio bypass remains bit exact");
 r2d_audio_spatial_destroy(bank);printf("%d checks, %d failures\n",checks,failures);return failures?1:0;
}
