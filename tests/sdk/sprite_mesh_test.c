#include "sprite_mesh.h"
#include "unity.h"
#include <stdlib.h>
#include <string.h>

static uint8_t image[4*4*4];
static R2DSpriteMeshDesc d;
static void pixel(int x,int y,uint8_t a){image[((y*4+x)*4)+3]=a;}
static R2DSpriteMesh build(R2DSpriteMeshRect r){R2DSpriteMesh m={0};TEST_ASSERT_TRUE(r2d_sprite_mesh_build(image,4,4,r,&d,&m));return m;}

void setUp(void){memset(image,0,sizeof image);d=(R2DSpriteMeshDesc){.depth=0.25f,.units_per_pixel=1,.pivot_x=0,.pivot_y=0,.alpha_threshold=16};}
void tearDown(void){}

static void test_single_pixel_has_six_faces_and_pivot_depth(void){pixel(0,0,255);R2DSpriteMesh m=build((R2DSpriteMeshRect){0,0,1,1});TEST_ASSERT_EQUAL_UINT32(36,m.vertex_count);TEST_ASSERT_EQUAL_UINT32(1,m.opaque_pixels);TEST_ASSERT_FLOAT_WITHIN(.0001f,0.f,m.vertices[2]);TEST_ASSERT_FLOAT_WITHIN(.0001f,1.f,m.vertices[8]);TEST_ASSERT_FLOAT_WITHIN(.0001f,.25f,m.vertices[50]);r2d_sprite_mesh_destroy(&m);}
static void test_transparent_and_threshold(void){R2DSpriteMesh m=build((R2DSpriteMeshRect){0,0,1,1});TEST_ASSERT_EQUAL_UINT32(0,m.vertex_count);r2d_sprite_mesh_destroy(&m);pixel(0,0,15);m=build((R2DSpriteMeshRect){0,0,1,1});TEST_ASSERT_EQUAL_UINT32(0,m.vertex_count);r2d_sprite_mesh_destroy(&m);pixel(0,0,16);m=build((R2DSpriteMeshRect){0,0,1,1});TEST_ASSERT_EQUAL_UINT32(36,m.vertex_count);r2d_sprite_mesh_destroy(&m);}
static void test_horizontal_and_vertical_adjacency(void){pixel(0,0,255);pixel(1,0,255);R2DSpriteMesh m=build((R2DSpriteMeshRect){0,0,2,1});TEST_ASSERT_EQUAL_UINT32(60,m.vertex_count);r2d_sprite_mesh_destroy(&m);memset(image,0,sizeof image);pixel(0,0,255);pixel(0,1,255);m=build((R2DSpriteMeshRect){0,0,1,2});TEST_ASSERT_EQUAL_UINT32(60,m.vertex_count);r2d_sprite_mesh_destroy(&m);}
static void test_solid_block_and_frame_isolation(void){for(int y=0;y<2;y++)for(int x=0;x<2;x++)pixel(x,y,255);R2DSpriteMesh m=build((R2DSpriteMeshRect){0,0,2,2});TEST_ASSERT_EQUAL_UINT32(96,m.vertex_count);r2d_sprite_mesh_destroy(&m);pixel(2,0,255);m=build((R2DSpriteMeshRect){0,0,2,2});TEST_ASSERT_EQUAL_UINT32(96,m.vertex_count);r2d_sprite_mesh_destroy(&m);}
static void test_invalid_bounds(void){R2DSpriteMesh m={0};TEST_ASSERT_FALSE(r2d_sprite_mesh_build(image,4,4,(R2DSpriteMeshRect){3,0,2,1},&d,&m));TEST_ASSERT_NULL(m.vertices);}
static void test_build_all_cache_roundtrip_and_invalidation(void){pixel(0,0,255);pixel(1,0,255);R2DSpriteMeshFrameInput in[2]={{{0,0,1,1},0,0},{{1,0,1,1},1,0}};R2DSpriteMeshCache c={0},decoded={0};TEST_ASSERT_TRUE(r2d_sprite_mesh_build_all(image,4,4,in,2,&d,11,22,33,&c));TEST_ASSERT_EQUAL_UINT32(2,c.frame_count);TEST_ASSERT_EQUAL_UINT32(36,c.frames[0].vertex_count);TEST_ASSERT_EQUAL_UINT32(36,c.frames[1].vertex_count);TEST_ASSERT_TRUE(r2d_sprite_mesh_cache_valid(&c,11,22,33,2));TEST_ASSERT_FALSE(r2d_sprite_mesh_cache_valid(&c,12,22,33,2));TEST_ASSERT_FALSE(r2d_sprite_mesh_cache_valid(&c,11,23,33,2));TEST_ASSERT_FALSE(r2d_sprite_mesh_cache_valid(&c,11,22,34,2));TEST_ASSERT_FALSE(r2d_sprite_mesh_cache_valid(&c,11,22,33,1));uint8_t*bytes=NULL;size_t size=0;TEST_ASSERT_TRUE(r2d_sprite_mesh_cache_encode(&c,&bytes,&size));TEST_ASSERT_TRUE(r2d_sprite_mesh_cache_decode(bytes,size,&decoded));TEST_ASSERT_EQUAL_UINT64(11,decoded.source_hash);TEST_ASSERT_EQUAL_UINT64(22,decoded.layout_hash);TEST_ASSERT_EQUAL_UINT64(33,decoded.settings_hash);TEST_ASSERT_EQUAL_UINT32(c.frames[1].vertex_count,decoded.frames[1].vertex_count);TEST_ASSERT_EQUAL_MEMORY(c.frames[0].vertices,decoded.frames[0].vertices,(size_t)c.frames[0].vertex_count*8u*sizeof(float));TEST_ASSERT_FALSE(r2d_sprite_mesh_cache_decode(bytes,size-1,&(R2DSpriteMeshCache){0}));free(bytes);r2d_sprite_mesh_cache_destroy(&decoded);r2d_sprite_mesh_cache_destroy(&c);}

int main(void){UNITY_BEGIN();RUN_TEST(test_single_pixel_has_six_faces_and_pivot_depth);RUN_TEST(test_transparent_and_threshold);RUN_TEST(test_horizontal_and_vertical_adjacency);RUN_TEST(test_solid_block_and_frame_isolation);RUN_TEST(test_invalid_bounds);RUN_TEST(test_build_all_cache_roundtrip_and_invalidation);return UNITY_END();}
