#include "re2d_world_exr.h"
#include "unity.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
void setUp(void) {}
void tearDown(void) {}

#define check(ok, s) TEST_ASSERT_TRUE_MESSAGE((ok), (s))

static int run_suite(int argc, char **argv){
 if(argc!=2)return 1;FILE *f=fopen(argv[1],"rb");if(!f)return 1;fseek(f,0,SEEK_END);size_t n=ftell(f);rewind(f);uint8_t *bytes=malloc(n);if(!bytes)return 1;if(fread(bytes,1,n,f)!=n)return 1;fclose(f);
 uint8_t *a=NULL,*b=NULL;int w=0,h=0,bw=0,bh=0;char error[256];
 check(r2d_world_exr_decode(bytes,n,0,&a,&w,&h,error,sizeof error)&&w==1024&&h==512,"supplied tiled PIZ float EXR decodes to 1024x512 bitmap");
 check(r2d_world_exr_decode(bytes,n,1,&b,&bw,&bh,error,sizeof error)&&bw==w&&bh==h,"exposure reload preserves dimensions");
 if(a&&b){long brighter=0;int opaque=1;for(int i=0;i<w*h;i++){for(int c=0;c<3;c++)brighter+=b[i*4+c]-a[i*4+c];if(a[i*4+3]!=255)opaque=0;}check(brighter>0,"positive EV increases tone-mapped sky brightness");check(opaque,"sky output is opaque ordinary RGBA8");}
 uint8_t *sentinel=(uint8_t*)1;int sw=123,sh=456;
 check(!r2d_world_exr_decode(bytes,32,0,&sentinel,&sw,&sh,error,sizeof error)&&sentinel==(uint8_t*)1&&sw==123&&sh==456,"truncated EXR fails without publishing partial texture");
 check(!r2d_world_exr_decode(bytes,n,17,&sentinel,&sw,&sh,error,sizeof error),"excess exposure rejected");
 memset(bytes,0,8);check(!r2d_world_exr_decode(bytes,n,0,&sentinel,&sw,&sh,error,sizeof error),"invalid magic rejected");
 free(a);free(b);free(bytes);return 0;
}

static int g_argc;
static char **g_argv;

static void test_exr_suite(void)
{
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, run_suite(g_argc, g_argv),
        "EXR: tiled PIZ, exposure, truncated/посторонние файлы");
}

int main(int argc, char **argv)
{
    g_argc = argc;
    g_argv = argv;
    UNITY_BEGIN();
    RUN_TEST(test_exr_suite);
    return UNITY_END();
}
