#version 450
layout(set=2,binding=0) uniform sampler2D albedoMap;
layout(set=2,binding=1) uniform sampler2D normalMap;
layout(set=2,binding=2) uniform sampler2D emissiveMap;
layout(std430,set=2,binding=3) readonly buffer ShadowGeometry { vec4 data[]; } shadow;
layout(std140,set=3,binding=0) uniform Surface {
    vec4 eye; // xyz, near
    vec4 basis; // cos/sin yaw, cos/sin pitch
    vec4 screen; // width,height,focal in output pixels,ortho height
    vec4 shape; // wall endpoints or plane XY bounds
    vec4 plane; // bottom/top or base,a,b,kind
    vec4 normal;
    vec4 tangent;
    vec4 tint;
    vec4 material; // u/v scale,normal enabled,emissive strength
    vec4 ambient; // rgb, level
    vec4 fog; // rgb,density
    vec4 options; // distanceScale,orientationStrength,fogStart,lightCount
    vec4 bounds; // lighting span XY bounds
    vec4 floorPlane; // bottom,a,b,filter enabled
    vec4 ceilingPlane;
    vec4 identity; // surface,span,lighting enabled,material enabled
    vec4 lightPosition[16]; // xyz,radius
    vec4 lightColor[16]; // rgb,intensity including native flicker
    vec4 lightOptions[16]; // native shadow table slot, or -1
    vec4 opening; // effective dynamic portal opening bottom/top, enabled
    vec4 billboard; // screen left,top,width,height
    vec4 actor; // world x,y,center-height,world-height
} u;
layout(location=0) out vec4 color;
layout(location=1) out vec4 owner; // exact forward depth, surface, span, actor
float cross2(vec2 a,vec2 b) { return a.x*b.y-a.y*b.x; }
bool occluded(vec3 origin,vec3 direction,int slot) {
    vec4 header=shadow.data[slot];
    for(int i=0;i<int(header.y);i++) {
        vec4 xy=shadow.data[int(header.x)+i*2],height=shadow.data[int(header.x)+i*2+1];
        vec2 segment=xy.zw-xy.xy,delta=xy.xy-origin.xy;
        float den=cross2(direction.xy,segment);if(abs(den)<1e-8)continue;
        float t=cross2(delta,segment)/den,along=cross2(delta,direction.xy)/den;
        float h=origin.z+t*direction.z;
        if(t>=.0001&&t<=.9999&&along>=0&&along<=1&&h>=height.x&&h<=height.y)return true;
    }
    for(int i=0;i<int(header.w);i++) {
        vec4 xy=shadow.data[int(header.z)+i*3];
        for(int plane=0;plane<2;plane++) {
            vec4 p=shadow.data[int(header.z)+i*3+1+plane];
            float den=direction.z-dot(p.yz,direction.xy);if(abs(den)<1e-8)continue;
            float t=(p.x+dot(p.yz,origin.xy-xy.xy)-origin.z)/den;
            vec2 hit=origin.xy+direction.xy*t;
            if(t>=.0001&&t<=.9999&&all(greaterThanEqual(hit,xy.xy))&&all(lessThanEqual(hit,xy.xy+xy.zw)))return true;
        }
    }
    return false;
}
void main() {
    vec2 pixel=gl_FragCoord.xy;
    vec2 ru=vec2(pixel.x-u.screen.x*.5,u.screen.y*.5-pixel.y);
    vec3 right=vec3(-u.basis.y,u.basis.x,0);
    vec3 up=vec3(-u.basis.x*u.basis.w,-u.basis.y*u.basis.w,u.basis.z);
    vec3 forward=vec3(u.basis.x*u.basis.z,u.basis.y*u.basis.z,u.basis.w);
    vec3 origin=u.eye.xyz,dir=forward;
    if(u.screen.w>0) origin+=(right*ru.x+up*ru.y)*(u.screen.w/u.screen.y);
    else dir+=(right*ru.x+up*ru.y)/u.screen.z;
    if(u.plane.w>2.5){
        vec3 direction=normalize(dir);vec2 skyUV=vec2(fract(.5+(atan(direction.y,direction.x)+u.material.x)/6.283185307179586),clamp(.5-asin(clamp(direction.z,-1,1))/3.141592653589793,.000001,.999999));
        color=vec4(u.tint.rgb*(u.identity.w>0?texture(albedoMap,skyUV).rgb:vec3(1)),1);owner=vec4(3.402823e38,-1,-1,-1);gl_FragDepth=1;return;
    }
    float depth; vec2 uv; vec3 hit;
    if(u.plane.w>1.5) {
        uv=(pixel-u.billboard.xy)/u.billboard.zw;
        if(any(lessThan(uv,vec2(0)))||any(greaterThanEqual(uv,vec2(1))))discard;
        float offset=u.material.z>0?texture(normalMap,uv).r*u.actor.w:0;
        depth=u.plane.x-offset;
        hit=u.actor.xyz+right*((uv.x-.5)*u.shape.z)+up*((.5-uv.y)*u.actor.w)-forward*offset;
        if(u.material.z<=0)hit=vec3(u.actor.xy,u.actor.z+(.5-uv.y)*u.actor.w);
    } else if(u.plane.w<.5) {
        vec2 segment=u.shape.zw-u.shape.xy,delta=u.shape.xy-origin.xy;
        float den=cross2(dir.xy,segment); if(abs(den)<1e-8) discard;
        depth=cross2(delta,segment)/den;
        float along=cross2(delta,dir.xy)/den;
        hit=origin+dir*depth;
        if(along<0||along>1||hit.z<u.plane.x||hit.z>u.plane.y) discard;
        if(u.opening.z>0&&hit.z>=u.opening.x&&hit.z<u.opening.y)discard;
        uv=vec2(length(hit.xy-u.shape.xy),hit.z-u.plane.x);
    } else {
        float den=dir.z-dot(u.plane.yz,dir.xy); if(abs(den)<1e-8) discard;
        depth=(u.plane.x+dot(u.plane.yz,origin.xy-u.shape.xy)-origin.z)/den;
        hit=origin+dir*depth;
        if(any(lessThan(hit.xy,u.shape.xy))||any(greaterThan(hit.xy,u.shape.xy+u.shape.zw))) discard;
        uv=hit.xy-u.shape.xy;
    }
    if(depth<u.eye.w||depth>100000) discard;
    if(u.floorPlane.w>0) {
        vec2 point=hit.xy+u.normal.xy*.001;
        vec2 local=point-u.bounds.xy;
        if(any(lessThan(local,vec2(0)))||any(greaterThanEqual(local,u.bounds.zw))) discard;
        float bottom=u.floorPlane.x+dot(u.floorPlane.yz,local);
        float top=u.ceilingPlane.x+dot(u.ceilingPlane.yz,local);
        if(hit.z<bottom||hit.z>=top) discard;
    }
    bool decal=u.lightOptions[15].z>0;
    if(!decal&&u.plane.w<1.5&&u.lightOptions[13].w>0)uv=u.plane.w<.5?vec2(dot(hit.xy,u.tangent.xy),hit.z):hit.xy;
    if(decal){uv=(uv-u.lightOptions[14].yz)/vec2(u.lightOptions[14].w,u.lightOptions[15].y);if(any(lessThan(uv,vec2(0)))||any(greaterThanEqual(uv,vec2(1))))discard;}
    vec3 n=u.normal.xyz;
    if(u.plane.w>1.5){vec2 towards=u.eye.xy-hit.xy;n=length(towards)>0?vec3(normalize(towards),0):vec3(0);}
    vec4 albedo=vec4(1);vec3 emissive=vec3(0);
    if(u.identity.w>0) {
        if(u.plane.w<1.5&&!decal)uv=fract(uv*u.material.xy);
        albedo=texture(albedoMap,uv);
        float blend=u.lightOptions[15].w;
        if((blend<.5&&albedo.a<.5)||(blend>1.5&&albedo.a*u.tint.a<=0))discard;
        if(u.material.z>0&&u.plane.w<1.5) {
            vec3 map=texture(normalMap,uv).rgb*2-1;
            vec3 mapped=u.tangent.xyz*map.x+cross(n,u.tangent.xyz)*map.y+n*map.z;
            if(length(mapped)>1e-6)n=normalize(mapped);
        }
        if(u.material.w>0)emissive=texture(emissiveMap,uv).rgb*u.material.w;
    }
    if(u.identity.z<0){color=vec4(1.0/255.0,0,0,1);owner=vec4(depth,u.identity.xy,u.actor.w>0?u.opening.w:-1);gl_FragDepth=1-u.eye.w/depth;return;}
    vec3 lighting=vec3(1);
    if(u.identity.z>0) {
        float contrast=1+u.options.y*(abs(n.x)-abs(n.y));
        lighting=u.ambient.rgb*u.ambient.a*contrast/(1+depth*u.options.x);
        for(int i=0;i<int(u.options.w);i++) {
            vec3 delta=u.lightPosition[i].xyz-hit;
            float distance=length(delta),radius=u.lightPosition[i].w;
            if(distance>=radius)continue;
            float response=distance>1e-5?max(0,dot(n,delta/distance)):1;
            if(response<=0)continue;
            if(u.lightOptions[i].x>=0&&occluded(u.lightPosition[i].xyz,-delta,int(u.lightOptions[i].x)))continue;
            float falloff=1-distance/radius;
            lighting+=u.lightColor[i].rgb*u.lightColor[i].a*falloff*falloff*response;
        }
    }
    vec3 rgb=albedo.rgb*u.tint.rgb*lighting+emissive;
    float fog=u.identity.z>0?1-exp(-u.fog.a*max(0,depth-u.options.z)):0;
    color=vec4(clamp(mix(rgb,u.fog.rgb,fog),0,1),u.lightOptions[15].w>1.5?albedo.a*u.tint.a:1);
    owner=vec4(depth,u.identity.xy,u.actor.w>0?u.opening.w:-1);
    gl_FragDepth=max(0,1-u.eye.w/depth-(decal?.000001:0));
}
