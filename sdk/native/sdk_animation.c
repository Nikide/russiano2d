// Import-time skeletal evaluation only. Runtime receives ordinary Re2D JSON tracks.
#include "sdk.h"
#include "ufbx.h"
#include <SDL3/SDL.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define BONES 10
static const char *targets[BONES]={"root","head","armLeft","forearmLeft","armRight","forearmRight","hipLeft","kneeLeft","hipRight","kneeRight"};
// Existing mascot names are image-left/image-right. Normalized Mixamo right limb is -X.
static const char *sources[BONES]={"Spine2","Head","RightArm","RightForeArm","LeftArm","LeftForeArm","RightUpLeg","RightLeg","LeftUpLeg","LeftLeg"};
static const char *ends[BONES]={NULL,NULL,"RightForeArm","RightHand","LeftForeArm","LeftHand","RightLeg","RightFoot","LeftLeg","LeftFoot"};
static const int parents[BONES]={-1,0,0,2,0,4,0,6,0,8};
static ufbx_quat identity(void){return (ufbx_quat){.x=0,.y=0,.z=0,.w=1};}
static ufbx_quat inv(ufbx_quat q){return (ufbx_quat){.x=-q.x,.y=-q.y,.z=-q.z,.w=q.w};}
static ufbx_quat basis(ufbx_quat q){return (ufbx_quat){.x=-q.x,.y=q.y,.z=-q.z,.w=q.w};} // source Y-up -> Re2D Y-down
static ufbx_node *find(const ufbx_scene *s,const char *name){
 for(size_t i=0;i<s->nodes.count;i++){ufbx_node *n=s->nodes.data[i];const char *p=strrchr(n->name.data,':');if(!strcmp(p?p+1:n->name.data,name))return n;}return NULL;
}
static ufbx_vec3 pos(const ufbx_node *n){return (ufbx_vec3){.x=n->node_to_world.m03,.y=n->node_to_world.m13,.z=n->node_to_world.m23};}
static ufbx_quat direction(ufbx_vec3 a,ufbx_vec3 b){
 double x=b.x-a.x,y=-(b.y-a.y),z=b.z-a.z,len=sqrt(x*x+y*y+z*z);if(len<1e-8)return identity();x/=len;y/=len;z/=len;
 // Minimal swing from existing mascot's downward rest limb (0,+1,0).
 if(y<-.999999)return (ufbx_quat){.x=1,.y=0,.z=0,.w=0};double w=sqrt((1+y)*.5),k=.5/w;return (ufbx_quat){.x=z*k,.y=0,.z=-x*k,.w=w};
}
static ufbx_quat rotation(const ufbx_node *n){return basis(ufbx_matrix_to_transform(&n->node_to_world).rotation);}
static double unwrap(double previous,double value){while(value-previous>180)value-=360;while(value-previous<-180)value+=360;return value;}
static bool target_exists(const R2dJson *rig,const char *name){const R2dJson *bones=r2d_json_get(r2d_json_get(rig,"rig"),"bones");for(int i=0;i<r2d_json_size(bones);i++){const R2dJson *v=r2d_json_get(r2d_json_at(bones,i),"name");if(v&&v->type==R2D_JSON_STR&&!strcmp(v->string,name))return true;}return false;}
int sdk_cmd_animation_import(const SdkArgs *a){
 const char *input=sdk_arg_positional(a,0),*output=sdk_arg_value(a,"--output"),*rigpath=sdk_arg_value(a,"--rig"),*clip=sdk_arg_value(a,"--clip"),*fpsarg=sdk_arg_value(a,"--fps"),*seamarg=sdk_arg_value(a,"--seam"),*stackarg=sdk_arg_value(a,"--stack");
 if(!clip)clip="imported";double fps=fpsarg?strtod(fpsarg,NULL):30,seam=seamarg?strtod(seamarg,NULL):.2;
 SdkReport report;sdk_report_init(&report);R2dSb result;r2d_sb_init(&result);ufbx_scene *scene=NULL;R2dJson *rig=NULL;double *samples=NULL;size_t frames=0;double duration=0;bool ok=false;
 if(!input||!output||!rigpath||!isfinite(fps)||fps<1||fps>120||!isfinite(seam)||seam<0||seam>2||!clip[0]||strlen(clip)>80){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_ARGS",input,NULL,NULL,"animation-import <motion.fbx> --rig character.json --output animations.json [--clip name --stack name --fps 30 --seam .2]");goto done;}
 rig=sdk_load_json(rigpath,&report);if(!rig)goto done;
 for(int i=0;i<BONES;i++)if(!target_exists(rig,targets[i])){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_RIG",rigpath,NULL,NULL,"Humanoid preset requires target bone %s",targets[i]);goto done;}
 ufbx_load_opts opts={0};opts.ignore_geometry=true;opts.ignore_embedded=true;opts.load_external_files=false;opts.target_axes=ufbx_axes_right_handed_y_up;opts.target_unit_meters=1;opts.temp_allocator.memory_limit=128*1024*1024;opts.result_allocator.memory_limit=128*1024*1024;
 ufbx_error error;scene=ufbx_load_file(input,&opts,&error);if(!scene){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_FBX",input,NULL,NULL,"%s",error.description.data);goto done;}
 ufbx_anim_stack *selected=NULL;
 if(stackarg){for(size_t i=0;i<scene->anim_stacks.count;i++)if(!strcmp(scene->anim_stacks.data[i]->name.data,stackarg)){selected=scene->anim_stacks.data[i];break;}if(!selected){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_STACK",input,NULL,NULL,"Animation stack '%s' not found",stackarg);goto done;}}
 else for(size_t i=0;i<scene->anim_stacks.count;i++){ufbx_anim_stack *candidate=scene->anim_stacks.data[i];if(!selected||candidate->time_end-candidate->time_begin>selected->time_end-selected->time_begin)selected=candidate;}
 if(!selected){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_STACK",input,NULL,NULL,"FBX contains no animation stack");goto done;}
 const ufbx_anim *anim=selected->anim;duration=anim->time_end-anim->time_begin;
 if(!isfinite(duration)||duration<=0||duration>60){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_DURATION",input,NULL,NULL,"Duration must be 0..60 s");goto done;}
 frames=(size_t)ceil(duration*fps)+1;if(frames>1024||seam>=duration){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_KEYS",input,NULL,NULL,"Maximum 1024 samples and seam shorter than duration");goto done;}
 ufbx_quat bind[BONES];for(int i=0;i<BONES;i++){ufbx_node *n=find(scene,sources[i]);if(!n||(ends[i]&&!find(scene,ends[i]))){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_SOURCE_BONE",input,NULL,NULL,"Missing source bone %s",n?ends[i]:sources[i]);goto done;}bind[i]=rotation(n);}
 ufbx_node *hip=find(scene,"Hips"),*leg=find(scene,"RightUpLeg"),*knee=find(scene,"RightLeg");if(!hip){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_SOURCE_BONE",input,NULL,NULL,"Missing Hips");goto done;}
 ufbx_vec3 l=pos(leg),k=pos(knee);double length=sqrt((l.x-k.x)*(l.x-k.x)+(l.y-k.y)*(l.y-k.y)+(l.z-k.z)*(l.z-k.z));
 const R2dJson *bones=r2d_json_get(r2d_json_get(rig,"rig"),"bones");double target_length=16;
 const R2dJson *pb=NULL,*pk=NULL;for(int i=0;i<r2d_json_size(bones);i++){const R2dJson *b=r2d_json_at(bones,i),*n=r2d_json_get(b,"name");if(n&&n->type==R2D_JSON_STR&&!strcmp(n->string,"hipLeft"))pb=r2d_json_get(b,"pivot");if(n&&n->type==R2D_JSON_STR&&!strcmp(n->string,"kneeLeft"))pk=r2d_json_get(b,"pivot");}
 if(pb&&pk){double q=0;for(int i=0;i<3;i++){const R2dJson *v=r2d_json_at(pb,i),*w=r2d_json_at(pk,i);if(!v||!w||v->type!=R2D_JSON_NUM||w->type!=R2D_JSON_NUM){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_RIG",rigpath,NULL,NULL,"Expected numeric bone pivots");goto done;}double d=v->number-w->number;q+=d*d;}target_length=sqrt(q);}
 if(length<1e-6||target_length<1e-6){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_RIG",rigpath,NULL,NULL,"Degenerate upper leg length");goto done;}
 samples=calloc(frames*(BONES*3+1),sizeof *samples);if(!samples){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_ALLOC",input,NULL,NULL,"Sample allocation failed");goto done;}
 double hip_y0=0;
 for(size_t f=0;f<frames;f++){
  double time=anim->time_begin+duration*f/(frames-1);ufbx_scene *pose=ufbx_evaluate_scene(scene,anim,time,NULL,&error);if(!pose){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_EVALUATE",input,NULL,NULL,"%s",error.description.data);goto done;}
  ufbx_quat global[BONES];for(int i=0;i<BONES;i++){
   ufbx_node *n=find(pose,sources[i]);global[i]=ends[i]?direction(pos(n),pos(find(pose,ends[i]))):ufbx_quat_mul(rotation(n),inv(bind[i]));
   ufbx_quat local=parents[i]<0?global[i]:ufbx_quat_mul(inv(global[parents[i]]),global[i]);ufbx_vec3 e=ufbx_quat_to_euler(local,UFBX_ROTATION_ORDER_XYZ);
   double values[]={e.x,e.y,e.z};for(int c=0;c<3;c++){size_t index=f*(BONES*3+1)+i*3+c;samples[index]=f?unwrap(samples[index-(BONES*3+1)],values[c]):values[c];}
  }
  double hy=pos(find(pose,"Hips")).y;if(!f)hip_y0=hy;samples[f*(BONES*3+1)+BONES*3]=-(hy-hip_y0)*target_length/length;ufbx_free_scene(pose);
 }
 // Bake an explicit short seam, including a closing key. All animation still comes from source.
 if(seam>0)for(size_t f=0;f<frames;f++){double t=duration*f/(frames-1);if(t<duration-seam)continue;double blend=(t-(duration-seam))/seam;blend=blend*blend*(3-2*blend);for(int c=0;c<BONES*3+1;c++){size_t at=f*(BONES*3+1)+c;double end=c<BONES*3?unwrap(samples[at],samples[c]):samples[c];samples[at]+=(end-samples[at])*blend;}}
 R2dSb json;r2d_sb_init(&json);r2d_sb_puts(&json,"{\"version\":1,\"clips\":{");r2d_sb_put_json_string(&json,clip);r2d_sb_printf(&json,":{\"duration\":%.9g,\"loop\":true,\"tracks\":[",duration);
 for(int c=0;c<BONES*3+1;c++){
  if(c)r2d_sb_putc(&json,',');r2d_sb_puts(&json,"{\"target\":");r2d_sb_put_json_string(&json,c<BONES*3?targets[c/3]:"root");r2d_sb_puts(&json,",\"channel\":");char channel[32];snprintf(channel,sizeof channel,"%s.%c",c<BONES*3?"rotation":"translation",c<BONES*3?"xyz"[c%3]:'y');r2d_sb_put_json_string(&json,channel);r2d_sb_puts(&json,",\"interpolation\":\"linear\",\"keys\":[");
  for(size_t f=0;f<frames;f++){double value=samples[f*(BONES*3+1)+c];if(!isfinite(value)){sdk_diag(&report,SDK_ERROR,"SDK_ANIM_NONFINITE",input,NULL,NULL,"Non-finite sampled transform");r2d_sb_free(&json);goto done;}if(f)r2d_sb_putc(&json,',');r2d_sb_printf(&json,"[%.9g,%.9g]",duration*f/(frames-1),value);}r2d_sb_puts(&json,"]}");
 }
 r2d_sb_puts(&json,"]}}}\n");char temp[4096];snprintf(temp,sizeof temp,"%s.tmp-%llu",output,(unsigned long long)SDL_GetTicksNS());
 if(strlen(output)>4000||!sdk_write_file(temp,json.data,json.len)||rename(temp,output)!=0){remove(temp);sdk_diag(&report,SDK_ERROR,"SDK_ANIM_WRITE",output,NULL,NULL,"Cannot publish animation JSON");}else ok=true;r2d_sb_free(&json);
 sdk_diag(&report,SDK_INFO,"SDK_ANIM_RETARGET",input,NULL,NULL,"Humanoid swing retarget: source Y-up to Re2D Y-down, image-side limb mapping, upper-leg scale, in-place XY/Z root; no mesh/runtime FBX");
 done:
 r2d_sb_puts(&result,"{");sdk_put_kv_str(&result,"input",input?input:"");r2d_sb_printf(&result,",\"ok\":%s,\"duration\":%.9g,\"samples\":%zu,\"tracks\":%d,\"seam\":%.9g,",ok?"true":"false",duration,frames,BONES*3+1,seam);sdk_put_kv_str(&result,"output",output?output:"");r2d_sb_putc(&result,',');sdk_report_put_counts(&report,&result);r2d_sb_putc(&result,',');sdk_report_put(&report,&result);r2d_sb_puts(&result,"}\n");fputs(result.data?result.data:"{}\n",stdout);r2d_sb_free(&result);sdk_report_free(&report);r2d_json_free(rig);ufbx_free_scene(scene);free(samples);return ok?0:1;
}
