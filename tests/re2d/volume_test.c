#include "re2d_world_volume.h"
#include "unity.h"

#include <math.h>
#include <string.h>

#define PI_F 3.14159265358979323846f
#define EPS 1e-4f

void setUp(void) {}
void tearDown(void) {}

static bool has_face(const R2DWorldVolumePart *parts,int count,int face)
{
    for(int i=0;i<count;i++) if(parts[i].face==face) return true;
    return false;
}

static R2DWorldVolume make_volume(int mode,float width,float depth,float height,int slices,uint32_t flags)
{
    R2DWorldVolume volume;
    volume.mode=mode;volume.width=width;volume.depth=depth;volume.height=height;
    volume.slices=slices;volume.flags=flags;
    return volume;
}

static void check_sorted(const R2DWorldVolumePart *parts,int count)
{
    for(int i=1;i<count;i++) {
        TEST_ASSERT_TRUE_MESSAGE(parts[i-1].depth_bias<=parts[i].depth_bias,"parts sorted front-to-back");
        if(parts[i-1].depth_bias==parts[i].depth_bias)
            TEST_ASSERT_TRUE_MESSAGE(parts[i-1].face<=parts[i].face,"equal depth ties by face");
    }
}

static void test_box_quadrants(void)
{
    R2DWorldVolume volume=make_volume(R2D_VOLUME_BOX,40,20,50,0,0);
    R2DWorldVolumePart parts[4];

    struct { float x,y; int x_face,y_face; } quadrants[]={
        {100,100,R2D_VOLUME_FACE_RIGHT,R2D_VOLUME_FACE_BACK},
        {-100,100,R2D_VOLUME_FACE_LEFT,R2D_VOLUME_FACE_BACK},
        {100,-100,R2D_VOLUME_FACE_RIGHT,R2D_VOLUME_FACE_FRONT},
        {-100,-100,R2D_VOLUME_FACE_LEFT,R2D_VOLUME_FACE_FRONT}
    };
    for(int q=0;q<4;q++) {
        int total=r2d_world_volume_parts(&volume,0,0,0,quadrants[q].x,quadrants[q].y,25,0,parts,4);
        TEST_ASSERT_EQUAL_INT_MESSAGE(2,total,"box quadrant shows two side faces");
        TEST_ASSERT_TRUE_MESSAGE(has_face(parts,total,quadrants[q].x_face),"expected X face visible");
        TEST_ASSERT_TRUE_MESSAGE(has_face(parts,total,quadrants[q].y_face),"expected Y face visible");
        TEST_ASSERT_FALSE_MESSAGE(has_face(parts,total,R2D_VOLUME_FACE_TOP),"top is opt-in");
        TEST_ASSERT_FALSE_MESSAGE(has_face(parts,total,R2D_VOLUME_FACE_BOTTOM),"bottom is opt-in");
        check_sorted(parts,total);
        for(int i=0;i<total;i++) {
            TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,1.0f,parts[i].scale,"box face uses full authored scale");
            TEST_ASSERT_FALSE_MESSAGE(parts[i].flip,"box faces are not mirrored");
            TEST_ASSERT_TRUE_MESSAGE(isfinite(parts[i].depth_bias),"box depth bias is finite");
            TEST_ASSERT_TRUE_MESSAGE(fabsf(parts[i].offset_x)<=volume.width*0.5f+EPS,"X offset stays inside the box");
            TEST_ASSERT_TRUE_MESSAGE(fabsf(parts[i].offset_y)<=volume.depth*0.5f+EPS,"Y offset stays inside the box");
        }
    }
}

static void test_box_top_bottom_flags(void)
{
    uint32_t flags=R2D_VOLUME_FLAG_TOP|R2D_VOLUME_FLAG_BOTTOM;
    R2DWorldVolume volume=make_volume(R2D_VOLUME_BOX,40,20,50,0,flags);
    R2DWorldVolumePart parts[4];

    int total=r2d_world_volume_parts(&volume,0,0,0,100,0,200,0,parts,4);
    TEST_ASSERT_EQUAL_INT_MESSAGE(2,total,"camera above shows one side plus top");
    TEST_ASSERT_TRUE_MESSAGE(has_face(parts,total,R2D_VOLUME_FACE_TOP),"top face visible from above");
    TEST_ASSERT_FALSE_MESSAGE(has_face(parts,total,R2D_VOLUME_FACE_BOTTOM),"bottom hidden from above");
    check_sorted(parts,total);

    total=r2d_world_volume_parts(&volume,0,0,0,100,0,-100,0,parts,4);
    TEST_ASSERT_TRUE_MESSAGE(has_face(parts,total,R2D_VOLUME_FACE_BOTTOM),"bottom face visible from below");
    TEST_ASSERT_FALSE_MESSAGE(has_face(parts,total,R2D_VOLUME_FACE_TOP),"top hidden from below");

    // Camera inside the vertical span sees neither optional cap.
    total=r2d_world_volume_parts(&volume,0,0,0,100,0,25,0,parts,4);
    TEST_ASSERT_EQUAL_INT_MESSAGE(1,total,"mid-height camera sees one side only");
    TEST_ASSERT_FALSE_MESSAGE(has_face(parts,total,R2D_VOLUME_FACE_TOP),"no top from mid-height");
    TEST_ASSERT_FALSE_MESSAGE(has_face(parts,total,R2D_VOLUME_FACE_BOTTOM),"no bottom from mid-height");
}

static void test_cross_angle_cardinals_and_wrap(void)
{
    R2DWorldVolume volume=make_volume(R2D_VOLUME_CROSS,32,32,64,0,0);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,r2d_world_volume_cross_angle(&volume,0,0),"0 degrees");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,PI_F*0.5f,r2d_world_volume_cross_angle(&volume,PI_F*0.5f,0),"90 degrees");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,PI_F,fabsf(r2d_world_volume_cross_angle(&volume,PI_F,0)),"180 degrees wraps to pi magnitude");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-PI_F*0.5f,r2d_world_volume_cross_angle(&volume,PI_F*1.5f,0),"270 degrees wraps to -90");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,-PI_F*0.5f,r2d_world_volume_cross_angle(&volume,0,PI_F*0.5f),"camera yaw is subtracted");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,PI_F*0.5f,r2d_world_volume_cross_angle(&volume,0,PI_F*1.5f),"negative side wraps to +90");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,r2d_world_volume_cross_angle(&volume,PI_F*4,0),"full turns wrap to zero");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,r2d_world_volume_cross_angle(NULL,1,1),"NULL volume is safe");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,r2d_world_volume_cross_angle(&volume,NAN,0),"NaN facing is safe");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,r2d_world_volume_cross_angle(&volume,0,INFINITY),"Inf yaw is safe");
    for(int i=0;i<64;i++) {
        float angle=r2d_world_volume_cross_angle(&volume,(float)i*0.7f,-(float)i*0.31f);
        TEST_ASSERT_TRUE_MESSAGE(angle>=-PI_F-EPS&&angle<=PI_F+EPS,"cross angle stays in [-pi,pi]");
    }
}

static void test_cross_parts(void)
{
    R2DWorldVolume volume=make_volume(R2D_VOLUME_CROSS,32,32,64,0,0);
    R2DWorldVolumePart parts[2];
    int total=r2d_world_volume_parts(&volume,10,20,0,100,20,32,0.7f,parts,2);
    TEST_ASSERT_EQUAL_INT_MESSAGE(2,total,"cross emits two perpendicular planes");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_VOLUME_FACE_FRONT,parts[0].face,"first cross arm");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_VOLUME_FACE_RIGHT,parts[1].face,"second cross arm is perpendicular");
    for(int i=0;i<2;i++) {
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,parts[i].offset_x,"cross arm centred on actor");
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,parts[i].offset_y,"cross arm centred on actor");
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,1.0f,parts[i].scale,"cross arm full size");
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,parts[i].depth_bias,"cross arms share depth");
        TEST_ASSERT_FALSE_MESSAGE(parts[i].flip,"cross arms are not mirrored");
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(2,r2d_world_volume_parts(&volume,10,20,0,100,20,32,0.7f,parts,1),"capacity truncation still returns total");
    TEST_ASSERT_EQUAL_INT_MESSAGE(R2D_VOLUME_FACE_FRONT,parts[0].face,"truncated cross keeps nearest arm");
}

static void test_slice_count_and_parts(void)
{
    R2DWorldVolume volume=make_volume(R2D_VOLUME_SLICE_STACK,40,20,80,8,0);
    TEST_ASSERT_EQUAL_INT_MESSAGE(8,r2d_world_volume_slice_count(&volume),"slice count");

    R2DWorldVolumePart parts[8];
    int total=r2d_world_volume_parts(&volume,0,0,100,100,0,125,0,parts,8);
    TEST_ASSERT_EQUAL_INT_MESSAGE(8,total,"slice stack emits every slice");
    check_sorted(parts,total);
    for(int i=0;i<total;i++) {
        TEST_ASSERT_EQUAL_INT_MESSAGE(i,parts[i].face,"slice index is the face id");
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,1.0f/8.0f,parts[i].scale,"normalized slice band height");
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,parts[i].offset_x,"slice centred in X");
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,parts[i].offset_y,"slice centred in Y");
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,100.0f+((float)i+0.5f)*10.0f,parts[i].depth_bias,"slice centre height is evenly spaced");
        TEST_ASSERT_TRUE_MESSAGE(parts[i].depth_bias>=100.0f-EPS&&parts[i].depth_bias<=180.0f+EPS,"slice stays inside the volume height");
    }
    for(int i=1;i<total;i++)
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,10.0f,parts[i].depth_bias-parts[i-1].depth_bias,"uniform slice spacing");
}

static void test_slice_part_direct_and_bounds(void)
{
    R2DWorldVolume volume=make_volume(R2D_VOLUME_SLICE_STACK,40,20,80,8,0);
    R2DWorldVolumePart part;
    r2d_world_volume_slice_part(&volume,3,100,&part);
    TEST_ASSERT_EQUAL_INT_MESSAGE(3,part.face,"direct slice face");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.125f,part.scale,"direct slice scale");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,135.0f,part.depth_bias,"direct slice height");
    TEST_ASSERT_FALSE_MESSAGE(part.flip,"slice is not mirrored");

    r2d_world_volume_slice_part(&volume,-1,100,&part);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,part.face,"invalid slice zeroes the part");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,part.depth_bias,"invalid slice zeroes depth bias");
    r2d_world_volume_slice_part(&volume,8,100,&part);
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,part.scale,"out-of-range slice zeroes scale");
    r2d_world_volume_slice_part(NULL,0,100,&part);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,part.face,"NULL volume zeroes the part");
    r2d_world_volume_slice_part(&volume,0,100,NULL);
    TEST_ASSERT_TRUE_MESSAGE(1,"NULL part is safe");

    // Cross-mode and invalid volume must not describe slices.
    R2DWorldVolume box=make_volume(R2D_VOLUME_BOX,40,20,50,8,0);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,r2d_world_volume_slice_count(&box),"box has no slices");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,r2d_world_volume_slice_count(NULL),"NULL has no slices");
    R2DWorldVolume bad=make_volume(R2D_VOLUME_SLICE_STACK,40,20,80,0,0);
    TEST_ASSERT_EQUAL_INT_MESSAGE(0,r2d_world_volume_slice_count(&bad),"invalid slice count reports zero");
}

static void test_capacity_truncation_returns_total(void)
{
    R2DWorldVolume volume=make_volume(R2D_VOLUME_SLICE_STACK,40,20,80,8,0);
    R2DWorldVolumePart parts[3];
    int total=r2d_world_volume_parts(&volume,0,0,100,100,0,125,0,parts,3);
    TEST_ASSERT_EQUAL_INT_MESSAGE(8,total,"truncated slice stack reports total");
    for(int i=0;i<3;i++) {
        TEST_ASSERT_EQUAL_INT_MESSAGE(i,parts[i].face,"truncation keeps the nearest slices");
        TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,100.0f+((float)i+0.5f)*10.0f,parts[i].depth_bias,"truncated slice order");
    }
    TEST_ASSERT_EQUAL_INT_MESSAGE(8,r2d_world_volume_parts(&volume,0,0,100,100,0,125,0,NULL,0),"NULL out is a count query");
    TEST_ASSERT_EQUAL_INT_MESSAGE(8,r2d_world_volume_parts(&volume,0,0,100,100,0,125,0,parts,0),"zero capacity reports total");
}

static void test_invalid_volume_rejected(void)
{
    R2DWorldVolumePart parts[4];
    R2DWorldVolume volume=make_volume(R2D_VOLUME_BOX,40,20,50,0,0);
    int saved=volume.mode;

    volume.width=0;TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_volume_parts(&volume,0,0,0,1,1,1,0,parts,4),"zero width rejected");
    volume=make_volume(R2D_VOLUME_BOX,40,20,50,0,0);volume.depth=-1;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_volume_parts(&volume,0,0,0,1,1,1,0,parts,4),"negative depth rejected");
    volume=make_volume(R2D_VOLUME_BOX,40,20,50,0,0);volume.height=NAN;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_volume_parts(&volume,0,0,0,1,1,1,0,parts,4),"NaN height rejected");
    volume=make_volume(7,40,20,50,0,0);
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_volume_parts(&volume,0,0,0,1,1,1,0,parts,4),"unknown mode rejected");
    volume=make_volume(R2D_VOLUME_SLICE_STACK,40,20,50,0,0);
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_volume_parts(&volume,0,0,0,1,1,1,0,parts,4),"zero slices rejected");
    volume.slices=33;
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_volume_parts(&volume,0,0,0,1,1,1,0,parts,4),"too many slices rejected");
    volume=make_volume(R2D_VOLUME_BOX,40,20,50,0,0);
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_volume_parts(&volume,0,0,0,NAN,1,1,0,parts,4),"NaN camera rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_volume_parts(&volume,0,INFINITY,0,1,1,1,0,parts,4),"Inf actor rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_volume_parts(&volume,0,0,0,1,1,1,NAN,parts,4),"NaN yaw rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_volume_parts(&volume,0,0,0,1,1,1,0,parts,-1),"negative capacity rejected");
    TEST_ASSERT_EQUAL_INT_MESSAGE(-1,r2d_world_volume_parts(NULL,0,0,0,1,1,1,0,parts,4),"NULL volume rejected");
    (void)saved;
}

static void test_deterministic_repeat(void)
{
    R2DWorldVolume volume=make_volume(R2D_VOLUME_BOX,48,32,80,0,R2D_VOLUME_FLAG_TOP);
    R2DWorldVolumePart first[4],repeat[4];
    int total=r2d_world_volume_parts(&volume,5,7,10,200,-100,180,0.9f,first,4);
    TEST_ASSERT_TRUE_MESSAGE(total>0,"determinism baseline produced parts");
    for(int i=0;i<64;i++) {
        int again=r2d_world_volume_parts(&volume,5,7,10,200,-100,180,0.9f,repeat,4);
        TEST_ASSERT_EQUAL_INT_MESSAGE(total,again,"repeat total is identical");
        TEST_ASSERT_EQUAL_INT_MESSAGE(0,memcmp(first,repeat,(size_t)total*sizeof first[0]),"repeat parts are bit-identical");
    }
    check_sorted(first,total);
}

static void test_hit_proxy(void)
{
    R2DWorldVolume volume=make_volume(R2D_VOLUME_BOX,30,40,60,0,0);
    float radius=-1,bottom=-1,top=-1;
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_volume_hit(&volume,NULL,&radius,&bottom,&top),"default hit derives from volume");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,25.0f,radius,"circumscribed XY radius");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,bottom,"default bottom");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,60.0f,top,"default top");

    R2DWorldVolumeHit authored={5,10,40,3};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_volume_hit(&volume,&authored,&radius,&bottom,&top),"authored hit accepted");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,5.0f,radius,"authored hit radius");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,10.0f,bottom,"authored hit bottom");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,40.0f,top,"authored hit top");

    // zones is only a hint: it never changes the returned extents.
    R2DWorldVolumeHit many_zones={6,10,40,16};
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_volume_hit(&volume,&many_zones,&radius,&bottom,&top),"zones hint accepted");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,6.0f,radius,"zones do not alter radius");

    R2DWorldVolumeHit invalid={0,10,40,1};
    radius=bottom=top=7;
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_volume_hit(&volume,&invalid,&radius,&bottom,&top),"zero hit radius rejected");
    TEST_ASSERT_FLOAT_WITHIN_MESSAGE(EPS,0.0f,radius,"rejected hit zeroes outputs");
    invalid=(R2DWorldVolumeHit){5,40,10,1};
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_volume_hit(&volume,&invalid,&radius,&bottom,&top),"inverted hit interval rejected");
    invalid=(R2DWorldVolumeHit){NAN,0,10,1};
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_volume_hit(&volume,&invalid,&radius,&bottom,&top),"NaN hit radius rejected");
    invalid=(R2DWorldVolumeHit){5,0,10,-1};
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_volume_hit(&volume,&invalid,&radius,&bottom,&top),"negative zones rejected");
    R2DWorldVolume empty=make_volume(R2D_VOLUME_BOX,0,10,10,0,0);
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_volume_hit(&empty,NULL,&radius,&bottom,&top),"invalid volume rejects hit");
    TEST_ASSERT_FALSE_MESSAGE(r2d_world_volume_hit(NULL,NULL,&radius,&bottom,&top),"NULL volume rejects hit");
    TEST_ASSERT_TRUE_MESSAGE(r2d_world_volume_hit(&volume,NULL,NULL,NULL,NULL),"NULL outputs are safe");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_box_quadrants);
    RUN_TEST(test_box_top_bottom_flags);
    RUN_TEST(test_cross_angle_cardinals_and_wrap);
    RUN_TEST(test_cross_parts);
    RUN_TEST(test_slice_count_and_parts);
    RUN_TEST(test_slice_part_direct_and_bounds);
    RUN_TEST(test_capacity_truncation_returns_total);
    RUN_TEST(test_invalid_volume_rejected);
    RUN_TEST(test_deterministic_repeat);
    RUN_TEST(test_hit_proxy);
    return UNITY_END();
}
