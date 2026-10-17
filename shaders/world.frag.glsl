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
    vec4 anim; // surface uv offset xy, emissive multiplier z
    vec4 surfacefx;  // variation, macro, bevel, corner AO
    vec4 surfacefx2; // edge width, grime, deterministic seed, unused
    vec4 spritefx;   // outline, grime, contact shading, alpha threshold
    vec4 fog2;       // height density, base height, falloff, haze strength
    vec4 haze;       // haze/sky tint rgb, blend
    vec4 ground;     // contact card center xy, radius xy (output px)
    vec4 ground2;    // opacity, softness, foot AO ratio, foot AO strength
    vec4 ground3;    // contact tint rgb, enabled
    vec4 liquid;     // enabled, time, distortion, highlight
    vec4 liquid2;    // liquid tint rgb, foam
    vec4 skyLayer[4];// parallax, scale, vertical offset, alpha
    vec4 skyParams;  // layer count, sun azimuth, sun elevation, time
    vec4 celestial;  // disc size, glow, disc rgb
    vec4 celestial2; // disc b, unused, unused, enabled
    vec4 ambientGrid[16]; // baked 4x4 ambient rgb + AO (row major)
    vec4 ambientRect;     // x0,y0,invW,invH; w>0 => field enabled
    vec4 detail;          // uv scale, albedo detail weight, unused, enabled
    vec4 decal2;          // rotation, scale, fade alpha, enabled
} u;
layout(location=0) out vec4 color;
layout(location=1) out vec4 owner; // exact forward depth, surface, span, actor
float cross2(vec2 a,vec2 b) { return a.x*b.y-a.y*b.x; }
float r2d_hash21(vec2 p) {
    p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);
    return fract(p.x*p.y);
}
float r2d_noise2(vec2 p) {
    vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(r2d_hash21(i),r2d_hash21(i+vec2(1,0)),f.x),
               mix(r2d_hash21(i+vec2(0,1)),r2d_hash21(i+vec2(1,1)),f.x),f.y);
}
vec4 r2d_ambient_at(vec2 p){
    if(u.ambientRect.w<=0.0)return vec4(1.0,1.0,1.0,0.0);
    vec2 g=(p-u.ambientRect.xy)*u.ambientRect.zw*4.0;
    ivec2 i=ivec2(clamp(g,vec2(0.0),vec2(3.999)));
    return u.ambientGrid[i.y*4+i.x];
}
float r2d_ao_lite(float ea,float eb,float width,float corner,float bevel) {
    if(width<=0.0)return 1.0;
    float a=smoothstep(0.0,width,max(ea,0.0));
    float b=smoothstep(0.0,width,max(eb,0.0));
    float ao=1.0-corner*(1.0-a)*(1.0-b)-bevel*0.25*(1.0-min(a,b));
    return clamp(ao,0.0,1.0);
}
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
    if(u.plane.w>5.5){
        // P4 final screen composite: samples the colour scene (albedoMap),
        // owner target (normalMap) and scene depth (emissiveMap). Renders to a
        // separate post target, so there is no read/write hazard.
        vec2 suv=clamp(gl_FragCoord.xy/vec2(u.screen.xy),vec2(0.001),vec2(0.999));
        vec3 sceneCol=texture(albedoMap,suv).rgb;
        vec4 own=texture(normalMap,suv);
        float sceneDepth=texture(emissiveMap,suv).r;
        vec2 uv=suv;
        float heatStrength=u.options.x;
        if(heatStrength>0.0&&sceneDepth<1.0e30){
            float att=sceneDepth<=u.material.z?1.0:clamp(1.0-(sceneDepth-u.material.z)/max(u.options.w,1.0),0.0,1.0);
            float phase=u.plane.y*u.material.y;
            vec2 off=vec2(sin(uv.y*u.material.x+phase),cos(uv.x*u.material.x*0.8+phase*1.3))*heatStrength*att*0.012;
            vec2 dist=clamp(uv+off,vec2(0.001),vec2(0.999));
            float distDepth=texture(emissiveMap,dist).r;
            if(distDepth>=sceneDepth-0.5)uv=dist;
        }
        vec3 sampled=texture(albedoMap,uv).rgb;
        float reflectStrength=u.options.y;
        if(reflectStrength>0.0){
            float wallCount=u.options.z;
            float surfaceId=own.y;
            bool floorPixel=surfaceId>=wallCount&&mod(surfaceId-wallCount,2.0)<0.5;
            if(floorPixel){
                float rough=r2d_hash21(uv*u.screen.xy*0.37);
                vec2 ruv=vec2(uv.x,clamp(1.0-uv.y,0.001,0.999));
                vec3 refl=texture(albedoMap,ruv).rgb;
                sampled=mix(sampled,refl,reflectStrength*(0.18+0.12*rough));
            }
        }
        float bloomStrength=u.plane.z;
        if(bloomStrength>0.0){
            vec3 bloom=vec3(0.0);
            float radius=max(2.0,u.screen.y/100.0);
            for(int i=0;i<8;i++){
                float a=(float(i)+0.5)*0.7853982;
                vec2 d=vec2(cos(a),sin(a))*radius/vec2(u.screen.xy);
                vec3 c=texture(albedoMap,clamp(suv+d,vec2(0.001),vec2(0.999))).rgb;
                float l=dot(c,vec3(0.2126,0.7152,0.0722));
                bloom+=c*max(l-0.50,0.0);
            }
            sampled+=bloom*bloomStrength*0.45;
        }
        color=vec4(clamp(sampled,0.0,1.0),1.0);
        owner=vec4(0.0);
        gl_FragDepth=1.0;
        return;
    }
    vec2 ru=vec2(pixel.x-u.screen.x*.5,u.screen.y*.5-pixel.y);
    vec3 right=vec3(-u.basis.y,u.basis.x,0);
    vec3 up=vec3(-u.basis.x*u.basis.w,-u.basis.y*u.basis.w,u.basis.z);
    vec3 forward=vec3(u.basis.x*u.basis.z,u.basis.y*u.basis.z,u.basis.w);
    vec3 origin=u.eye.xyz,dir=forward;
    if(u.screen.w>0) origin+=(right*ru.x+up*ru.y)*(u.screen.w/u.screen.y);
    else dir+=(right*ru.x+up*ru.y)/u.screen.z;
    if(u.plane.w>4.5){
        // R-03 VFX card/trail: procedural shape, no texture/mesh. kind in
        // material.x, rotation in material.y, thickness/ratio in material.z,
        // distortion flag in material.w.
        vec2 uv=(pixel-u.billboard.xy)/max(u.billboard.zw,vec2(0.0001));
        if(any(lessThan(uv,vec2(0.0)))||any(greaterThanEqual(uv,vec2(1.0))))discard;
        vec2 c=uv*2.0-1.0;
        float cr=cos(u.material.y),sr=sin(u.material.y);
        c=mat2(cr,-sr,sr,cr)*c;
        float kind=u.material.x;
        float shape;
        if(kind<0.5)      shape=1.0-smoothstep(0.45,1.0,length(c));
        else if(kind<1.5) shape=(1.0-smoothstep(0.55,1.0,abs(c.y)/max(u.material.z,0.02)))*
                               (1.0-smoothstep(0.82,1.0,abs(c.x)));
        else if(kind<2.5){float d=length(c);float w=max(u.material.z,0.04);
                          shape=1.0-smoothstep(w,w+0.20,abs(d-0.72));}
        else if(kind<3.5) shape=1.0-smoothstep(0.72,1.05,length(c));
        else if(kind<4.5) shape=1.0-smoothstep(0.40,1.0,length(c));
        else              shape=1.0-smoothstep(0.15,1.0,length(c));
        float alpha=u.tint.a*shape;
        if(u.material.w>0.5){
            float wave=0.5+0.5*sin((c.x+c.y)*18.0+u.anim.x*6.0);
            float ripple=0.5+0.5*sin((c.x-c.y)*12.0+u.anim.x*4.0);
            alpha*=mix(0.30,1.0,wave)*mix(0.75,1.10,ripple);
        }
        if(alpha<=0.002)discard;
        color=vec4(u.tint.rgb,clamp(alpha,0.0,1.0));
        owner=vec4(3.402823e38,-1,-1,-1);
        gl_FragDepth=1.0-u.eye.w/max(u.plane.x,0.001);
        return;
    }
    if(u.plane.w>3.5){
        // P0 grounding card: screen-space ellipse matching the CPU reference.
        vec2 d=(gl_FragCoord.xy-u.ground.xy)/max(u.ground.zw,vec2(0.0001));
        float dist=length(d);
        if(dist>=1.0)discard;
        float radial=1.0;
        if(dist>1.0-u.ground2.y){
            float t=clamp((1.0-dist)/max(u.ground2.y,0.0001),0.0,1.0);
            radial=t*t*(3.0-2.0*t);
        }
        float alpha=u.ground2.x*radial;
        if(u.ground2.z>0.0){
            float q=dist/u.ground2.z;
            float core=(1.0-smoothstep(0.0,1.0,q))*u.ground2.w;
            alpha=min(1.0,alpha+core*0.25);
        }
        if(alpha<=0.001)discard;
        vec3 src=mix(vec3(0.02,0.02,0.025),u.ground3.rgb,0.25);
        color=vec4(src,alpha);owner=vec4(3.402823e38,-1,-1,-1);gl_FragDepth=1.0;return;
    }
    if(u.plane.w>2.5){
        vec3 direction=normalize(dir);vec2 skyUV=vec2(fract(.5+(atan(direction.y,direction.x)+u.material.x)/6.283185307179586),clamp(.5-asin(clamp(direction.z,-1,1))/3.141592653589793,.000001,.999999));
        vec3 skycol=u.tint.rgb*(u.identity.w>0?texture(albedoMap,skyUV).rgb:vec3(1));
        int layers=int(u.skyParams.x);
        if(layers>0){
            for(int i=0;i<4;i++){
                if(i>=layers)break;
                vec4 layer=u.skyLayer[i];
                vec2 luv=vec2(fract(skyUV.x+layer.x*0.35+0.031*float(i)+u.skyParams.w*layer.x*0.02),
                              clamp(skyUV.y*layer.y+layer.z,0.000001,0.999999));
                vec3 tex=texture(albedoMap,luv).rgb*u.tint.rgb;
                float band=smoothstep(0.10,0.55,1.0-abs(skyUV.y*layer.y+layer.z-0.38));
                skycol=mix(skycol,tex,layer.w*band);
            }
        }
        if(u.celestial2.w>0.5){
            vec3 sun=vec3(cos(u.skyParams.z)*cos(u.skyParams.y),
                          cos(u.skyParams.z)*sin(u.skyParams.y),
                          sin(u.skyParams.z));
            float d=length(direction-sun);
            float disc=1.0-smoothstep(u.celestial.x*0.65,u.celestial.x,d);
            float glow=u.celestial.y*exp(-d*8.0);
            vec3 c=vec3(u.celestial.z,u.celestial.w,u.celestial2.x);
            skycol+=c*(disc+glow);
        }
        color=vec4(layers>0||u.celestial2.w>0.5?clamp(skycol,0.0,1.0):skycol,1);owner=vec4(3.402823e38,-1,-1,-1);gl_FragDepth=1;return;
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
    if(decal){
        uv=(uv-u.lightOptions[14].yz)/vec2(u.lightOptions[14].w,u.lightOptions[15].y);
        if(any(lessThan(uv,vec2(0)))||any(greaterThanEqual(uv,vec2(1))))discard;
        // Decals 2.0: deterministic per-decal rotation/scale variation. Gated by
        // the surface variation tier so legacy low quality stays byte-identical
        // to the CPU reference.
        if(u.decal2.w>0.5){
            vec2 dc=uv-0.5;
            float dca=cos(u.decal2.x),dsa=sin(u.decal2.x);
            dc=mat2(dca,-dsa,dsa,dca)*dc;
            dc/=max(u.decal2.y,0.05);
            uv=dc+0.5;
            if(any(lessThan(uv,vec2(0.0)))||any(greaterThanEqual(uv,vec2(1.0))))discard;
        } else if(u.surfacefx.x>0.0){
            float dh=r2d_hash21(vec2(u.identity.x*0.37+u.lightOptions[14].x*0.11,
                                    u.lightOptions[14].y*0.23+u.lightOptions[14].z*0.19));
            vec2 dc=uv-0.5;
            float da=(dh*2.0-1.0)*0.6;
            float dca=cos(da),dsa=sin(da);
            dc=mat2(dca,-dsa,dsa,dca)*dc;
            dc*=0.90+0.20*dh;
            uv=dc+0.5;
            if(any(lessThan(uv,vec2(0)))||any(greaterThanEqual(uv,vec2(1))))discard;
        }
    }
    vec3 n=u.normal.xyz;
    if(u.plane.w>1.5){vec2 towards=u.eye.xy-hit.xy;n=length(towards)>0?vec3(normalize(towards),0):vec3(0);}
    vec4 albedo=vec4(1);vec3 emissive=vec3(0);
    if(u.identity.w>0) {
        if(u.liquid.x>0.5&&!decal)
            uv+=vec2(sin(hit.x*0.15+u.liquid.y),cos(hit.y*0.13+u.liquid.y*1.3))*u.liquid.z;
        if(u.plane.w<1.5&&!decal)uv=fract(uv*u.material.xy+u.anim.xy);
        albedo=texture(albedoMap,uv);
        if(u.detail.w>0.0&&!decal){
            vec2 duv=fract(uv*u.detail.x+vec2(0.371,0.613));
            vec3 detailCol=texture(albedoMap,duv).rgb;
            albedo.rgb=mix(albedo.rgb,albedo.rgb*0.55+detailCol.rgb*0.65,clamp(u.detail.y,0.0,1.0));
        }
        float blend=u.lightOptions[15].w;
        float edge_cov=1.0;
        if(u.spritefx.w>0.0&&blend<0.5)
            edge_cov=smoothstep(u.spritefx.w-0.06,u.spritefx.w+0.06,albedo.a);
        bool masked_bad=u.spritefx.w>0.0?edge_cov<=0.0:albedo.a<0.5;
        if((blend<.5&&masked_bad)||(blend>1.5&&albedo.a*u.tint.a<=0))discard;
        if(u.material.z>0&&u.plane.w<1.5) {
            vec3 map=texture(normalMap,uv).rgb*2-1;
            vec3 mapped=u.tangent.xyz*map.x+cross(n,u.tangent.xyz)*map.y+n*map.z;
            if(length(mapped)>1e-6)n=normalize(mapped);
        }
        if(u.material.w>0)emissive=texture(emissiveMap,uv).rgb*u.material.w*max(u.anim.z,0.0);
    }
    // R-01 sprite edge quality: feathered masked coverage, inner outline,
    // deterministic grime and a contact/ambient gradient toward the feet.
    if(u.plane.w>1.5&&u.identity.w>0&&u.spritefx.w>0.0){
        float blend=u.lightOptions[15].w;
        if(u.spritefx.x>0.0&&blend<0.5){
            vec2 texel=1.0/vec2(textureSize(albedoMap,0));
            float na=max(max(texture(albedoMap,uv+vec2(-texel.x,0)).a,texture(albedoMap,uv+vec2(texel.x,0)).a),
                         max(texture(albedoMap,uv+vec2(0,-texel.y)).a,texture(albedoMap,uv+vec2(0,texel.y)).a));
            float edge=max(0.0,albedo.a-na);
            albedo.rgb*=1.0-u.spritefx.x*clamp(edge*3.0,0.0,1.0);
        }
        if(u.spritefx.y>0.0){
            float g=r2d_noise2(uv*vec2(37.0,29.0)+u.actor.xy*0.013);
            albedo.rgb*=1.0-u.spritefx.y*0.35*g;
        }
        if(u.spritefx.z>0.0)
            albedo.rgb*=mix(1.0-u.spritefx.z,1.0,clamp(uv.y,0.0,1.0));
    }
    // R-01/R-02 surface variation, macro detail, edge grime and fake bevel/AO.
    if(u.identity.w>0&&!decal&&u.plane.w<1.5){
        float edge_a=1.0e6,edge_b=1.0e6;
        if(u.plane.w<0.5){
            edge_a=hit.z-u.plane.x;edge_b=u.plane.y-hit.z;
            float along=dot(hit.xy-u.shape.xy,u.tangent.xy);
            float wall_len=length(u.shape.zw-u.shape.xy);
            edge_a=min(edge_a,min(along,wall_len-along));
        } else {
            vec2 local=hit.xy-u.shape.xy;
            edge_a=min(local.x,u.shape.z-local.x);
            edge_b=min(local.y,u.shape.w-local.y);
        }
        if(u.surfacefx.x>0.0||u.surfacefx.y>0.0){
            float h=r2d_hash21(hit.xy*0.173+vec2(hit.z*0.117,u.identity.x*0.371));
            if(u.surfacefx.x>0.0)albedo.rgb*=1.0+(h*2.0-1.0)*u.surfacefx.x*0.16;
            if(u.surfacefx.y>0.0){
                float macro=r2d_noise2(hit.xy*0.045+hit.z*0.02+h*3.0);
                albedo.rgb*=mix(1.0,0.78+0.44*macro,u.surfacefx.y);
            }
            if(u.surfacefx2.y>0.0&&u.plane.w<0.5){
                float grime=1.0-u.surfacefx2.y*smoothstep(0.0,24.0,edge_a)*
                    (0.5+0.5*r2d_noise2(hit.xy*0.13+hit.z*0.11));
                albedo.rgb*=grime;
            }
        }
        if(u.surfacefx.z>0.0||u.surfacefx.w>0.0){
            float ao=r2d_ao_lite(edge_a,edge_b,u.surfacefx2.x,u.surfacefx.w,u.surfacefx.z);
            albedo.rgb*=ao;
        }
    }
    if(u.liquid.x>0.5&&!decal){
        float foam=u.liquid2.w*smoothstep(0.55,0.95,0.5+0.5*sin((hit.x+hit.y)*0.09+u.liquid.y*2.1));
        albedo.rgb=mix(albedo.rgb,u.liquid2.rgb,0.35);
        albedo.rgb+=vec3(foam*0.55*u.liquid.w);
        emissive+=u.liquid2.rgb*foam*0.15*u.liquid.w;
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
    if(decal&&u.decal2.w>0.5)rgb*=clamp(u.decal2.z,0.0,1.0);
    // Baked ambient/AO field (4x4 coarse grid) modulates lit surfaces.
    if(u.ambientRect.w>0.0&&!decal){
        vec4 af=r2d_ambient_at(hit.xy);
        rgb*=mix(vec3(1.0),af.rgb,0.55)*(1.0-af.a*0.25);
    }
    vec3 scene=rgb;
    float alpha_out=u.lightOptions[15].w>1.5?albedo.a*u.tint.a:1.0;
    if(u.haze.w>0.0||u.fog2.x>0.0){
        // R-02 height fog + atmospheric haze: authored span fog stays the
        // distance term, the new term adds height and sky-coloured contrast
        // loss. The legacy branch below is byte-identical when both are off.
        float optical=u.fog.a*max(0.0,depth-u.options.z)+
            u.fog2.x*max(0.0,hit.z-u.fog2.y)*u.fog2.z;
        float fog=u.identity.z>0?clamp(1.0-exp(-optical),0.0,1.0):0.0;
        vec3 fogcol=mix(u.fog.rgb,u.haze.rgb,u.haze.w*0.65);
        scene=mix(rgb,fogcol,fog);
        float hz=u.haze.w*(1.0-exp(-depth*0.0015));
        float lum=dot(scene,vec3(0.2126,0.7152,0.0722));
        scene=mix(scene,vec3(lum),hz*0.25);
        scene=mix(scene,u.haze.rgb,hz*0.10);
        color=vec4(clamp(scene,0,1),alpha_out);
    } else {
        float fog=u.identity.z>0?1-exp(-u.fog.a*max(0,depth-u.options.z)):0;
        color=vec4(clamp(mix(rgb,u.fog.rgb,fog),0,1),alpha_out);
    }
    owner=vec4(depth,u.identity.xy,u.actor.w>0?u.opening.w:-1);
    gl_FragDepth=max(0,1-u.eye.w/depth-(decal?.000001:0));
}
