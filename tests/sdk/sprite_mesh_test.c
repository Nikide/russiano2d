#include "sprite_mesh.h"
#include "unity.h"
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

int main(void){UNITY_BEGIN();RUN_TEST(test_single_pixel_has_six_faces_and_pivot_depth);RUN_TEST(test_transparent_and_threshold);RUN_TEST(test_horizontal_and_vertical_adjacency);RUN_TEST(test_solid_block_and_frame_isolation);RUN_TEST(test_invalid_bounds);return UNITY_END();}
