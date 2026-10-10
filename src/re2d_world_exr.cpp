#include "re2d_world_exr.h"
#include <zlib.h>
#define TINYEXR_USE_MINIZ 0
#define TINYEXR_USE_OPENMP 0
#define TINYEXR_IMPLEMENTATION
#include <tinyexr.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
static bool fail(char *out,size_t n,const char *message){if(out&&n)std::snprintf(out,n,"%s",message);return false;}
static unsigned char display(float v,float scale){
    if(!std::isfinite(v)||v<0)v=0;
    double linear=(double)v*scale;linear=linear/(1+linear); // Reinhard, finite even for huge HDR float values.
    double srgb=linear<=.0031308?linear*12.92:1.055*std::pow(linear,1/2.4)-.055;
    return (unsigned char)std::lround(std::fmax(0,std::fmin(255,srgb*255)));
}
bool r2d_world_exr_decode(const uint8_t *bytes,size_t size,float exposure,uint8_t **pixels,int *width,int *height,char *error,size_t error_size){
    if(!bytes||!pixels||!width||!height||size<8||size>64*1024*1024||!std::isfinite(exposure)||exposure<-16||exposure>16)return fail(error,error_size,"invalid EXR input or exposure (-16..16 EV)");
    EXRVersion version;EXRHeader header;InitEXRHeader(&header);const char *err=nullptr;float *rgba=nullptr;unsigned char *image=nullptr;
    try{
        if(ParseEXRVersionFromMemory(&version,bytes,size)!=TINYEXR_SUCCESS||version.multipart||version.non_image)return fail(error,error_size,"expected a single-part EXR image");
        int result=ParseEXRHeaderFromMemory(&header,&version,bytes,size,&err);
        if(result!=TINYEXR_SUCCESS){fail(error,error_size,err?err:"invalid EXR header");if(err)FreeEXRErrorMessage(err);FreeEXRHeader(&header);return false;}
        int64_t w=(int64_t)header.data_window.max_x-header.data_window.min_x+1,h=(int64_t)header.data_window.max_y-header.data_window.min_y+1;
        bool bounded=w>0&&h>0&&w<=4096&&h<=2048&&header.num_channels<=4;
        FreeEXRHeader(&header);InitEXRHeader(&header);
        if(!bounded)return fail(error,error_size,"EXR dimensions must be 1..4096 x 1..2048 with at most four channels");
        int iw=0,ih=0;result=LoadEXRFromMemory(&rgba,&iw,&ih,bytes,size,&err);
        if(result!=TINYEXR_SUCCESS){fail(error,error_size,err?err:"EXR decode failed");if(err)FreeEXRErrorMessage(err);std::free(rgba);return false;}
        if(iw!=w||ih!=h){std::free(rgba);return fail(error,error_size,"EXR decoder dimensions changed");}
        image=(unsigned char*)std::malloc((size_t)iw*ih*4);if(!image){std::free(rgba);return fail(error,error_size,"EXR bitmap allocation failed");}
        float scale=std::exp2(exposure);
        for(size_t i=0;i<(size_t)iw*ih;i++){for(int c=0;c<3;c++)image[i*4+c]=display(rgba[i*4+c],scale);image[i*4+3]=255;}
        std::free(rgba);*pixels=image;*width=iw;*height=ih;return true;
    }catch(const std::exception &e){FreeEXRHeader(&header);std::free(rgba);std::free(image);return fail(error,error_size,e.what());}
}
