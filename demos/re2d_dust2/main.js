// Coarse gameplay/configuration only. Native C owns topology, visibility, light and rendering.
const base='demos/re2d_dust2/';
let routeData,compiledData,doorStates={},debugIndex=0,gpu=true,mouseLocked=true;
let clubTime=0;const clubColors=['#ff2080','#20bfff','#8b35ff','#ffe530'];
const motion={vx:0,vy:0,vz:0,grounded:true};
let stepDistance=0,stepIndex=0;
const npcAt={x:1200,y:1040,h:128};
let npcBodyYaw=0,npcVoice=null,npcHasSpoken=false,npcSpeakTime=0,npcAnim='idle';
function dustWalkAudio(distance){
    if(!motion.grounded){stepDistance=0;return;}
    if(distance<=0)return;
    stepDistance+=distance;
    const stride=Math.hypot(motion.vx,motion.vy)>260?90:72;
    if(stepDistance<stride)return;
    stepDistance%=stride;
    stepIndex=(stepIndex+4)%9;
    const source=snd(base+'audio/step'+(stepIndex+1)+'.wav',{x:view.x,y:view.y,h:view.h-46,range:240,reference:80,volume:.5,loop:false,hrtf:true,priority:0});
    dustSteps.count++;dustSteps.last=source;dustSteps.variant=stepIndex+1;
}
// The mixer has 16 shared channels: when none is free the sound is dropped instead of throwing out of the frame.
const NULL_SRC={stop(){},at(){return NULL_SRC;},volume(){return NULL_SRC;},range(){return NULL_SRC;},info(){return{playing:false,hrtf:true};}};
function safeSrc(src){
    // a source can be taken over by a higher-priority sound (16 shared channels); its handle then goes stale and every call throws
    let dead=false;
    const call=(f,fallback)=>(...a)=>{if(dead)return fallback;try{return f.apply(src,a);}catch(e){dead=true;return fallback;}};
    const self={stop:call(src.stop,undefined),info:call(src.info,{playing:false,hrtf:true})};
    for(const k of ['at','volume','range'])self[k]=(...a)=>{call(src[k],undefined)(...a);return self;};
    return self;
}
function snd(file,opts){try{return safeSrc(clubAudio.source(file,opts));}catch(e){return NULL_SRC;}}
const debugViews=['final','cell-id','span-id','depth','owner','light-level','dynamic-light-count','normal','emissive','bsp','portals','shadow-mask','overdraw'];
function dustCamera(name){const c=routeData.cameras[name]||routeData.annexCameras[name];view.x=c[0];view.y=c[1];view.h=c[2];view.yaw=c[3];view.pitch=0;motion.vx=motion.vy=motion.vz=0;motion.grounded=true;}
function dustMove(dx,dy){
    const feet=view.h-48;
    let support=world.support(view.x+dx,view.y+dy,feet,64,9);
    // A radius-bearing walker raises onto a small riser before its centre crosses the edge.
    const distance=Math.hypot(dx,dy);
    if(distance>0)for(const sign of [-1,1]){const edge=world.support(view.x+dx+sign*dx/distance*8,view.y+dy+sign*dy/distance*8,feet,64,9);if(edge&&support&&edge.height>support.height)support=edge;}
    if(!support||world.blocked(view.x+dx,view.y+dy,7,support.height,support.height+64))return false;
    view.x+=dx;view.y+=dy;view.h=support.height+48;return true;
}
// Quake-inspired game controller; native World remains collision/height authority.
function dustPhysics(dt,input,jump){
    const steps=Math.max(1,Math.ceil(dt/(1/120))),step=dt/steps;
    for(let tick=0;tick<steps;tick++){
        let feet=view.h-48;
        const support=world.support(view.x,view.y,feet+.01,64,0);
        motion.grounded=!!support&&(Math.abs(feet-support.height)<.1||(motion.grounded&&feet>=support.height&&feet-support.height<=9))&&motion.vz<=0;
        if(motion.grounded){
            const speed=Math.hypot(motion.vx,motion.vy);
            const reduced=Math.max(0,speed-Math.max(speed,80)*6*step);
            if(speed){motion.vx*=reduced/speed;motion.vy*=reduced/speed;}
            if(jump&&tick===0){motion.vz=270;motion.grounded=false;}
        }
        const yaw=view.yaw*Math.PI/180;
        let wx=-input.y*Math.cos(yaw)-input.x*Math.sin(yaw),wy=-input.y*Math.sin(yaw)+input.x*Math.cos(yaw);
        const length=Math.hypot(wx,wy);
        if(length){
            wx/=length;wy/=length;
            const speed=$.input.down('left shift')?320:240;
            const wish=motion.grounded?speed:30;
            const add=wish-(motion.vx*wx+motion.vy*wy);
            if(add>0){const accel=Math.min(add,(motion.grounded?10:1.5)*speed*step);motion.vx+=wx*accel;motion.vy+=wy*accel;}
        }
        const dx=motion.vx*step,dy=motion.vy*step;
        if(motion.grounded){
            if(!dustMove(dx,dy)){
                if(!dustMove(dx,0))motion.vx=0;
                if(!dustMove(0,dy))motion.vy=0;
            }
        }else{
            const move=(dx,dy)=>{
                const x=view.x+dx,y=view.y+dy;
                const floor=world.support(x,y,feet+.01,64,9);
                let bottom=feet;
                if(floor&&floor.height>feet){
                    if(motion.vz>0||floor.height-feet>9)return false;
                    bottom=floor.height;
                }
                const span=world.spanAt(x,y,bottom+.01);
                if(span===null||world.spanAt(x,y,bottom+64-.01)!==span||world.blocked(x,y,7,bottom,bottom+64))return false;
                view.x=x;view.y=y;
                if(bottom>feet){view.h=bottom+48;feet=bottom;motion.vz=0;motion.grounded=true;}
                return true;
            };
            if(!move(dx,dy)){if(!move(dx,0))motion.vx=0;if(!move(0,dy))motion.vy=0;}
        }
        feet=view.h-48;
        if(!motion.grounded){
            motion.vz-=900*step;
            let next=feet+motion.vz*step;
            if(next>feet){
                const hit=world.ray({x:view.x,y:view.y,height:feet+64},{x:view.x,y:view.y,height:next+64});
                if(hit){next=hit.height-64-.01;motion.vz=0;}
            }else{
                const hit=world.ray({x:view.x,y:view.y,height:feet+.01},{x:view.x,y:view.y,height:next});
                const floor=world.support(view.x,view.y,feet+.01,64,0);
                if(hit&&!hit.ceiling){next=hit.height;motion.vz=0;motion.grounded=true;}
                else if(floor&&next<=floor.height){next=floor.height;motion.vz=0;motion.grounded=true;}
            }
            view.h=next+48;
        }else motion.vz=0;
    }
}
function annexMaterials(w){
    const AX=base+'annex/';
    const annexMats={brick:{albedo:AX+'brick.png',normal:AX+'brick_n.png'},plaster:{albedo:AX+'plaster.png'},metal:{albedo:AX+'metal.png'},concrete:{albedo:AX+'concrete.png'},tile:{albedo:AX+'tile.png'},wood:{albedo:AX+'wood.png'},carpet:{albedo:AX+'carpet.png'},grass:{albedo:AX+'grass.png'},hazard:{albedo:AX+'hazard.png'},toxic:{albedo:AX+'toxic.png',emissive:AX+'toxic_e.png',emissiveStrength:1.6},server:{albedo:AX+'server.png',emissive:AX+'server_e.png',emissiveStrength:2.2},alarm:{albedo:AX+'alarm.png',emissive:AX+'alarm_e.png',emissiveStrength:1.8},neon:{albedo:AX+'neon.png',emissive:AX+'neon.png',emissiveStrength:.85}};
    for(const k in annexMats)w.material('a_'+k,{...annexMats[k],mapping:'world',filter:'nearest',blend:'opaque',uScale:1/128,vScale:1/128});
    w.material('a_glass',{albedo:AX+'glass.png',mapping:'world',filter:'nearest',blend:'translucent',uScale:1/128,vScale:1/128});
    w.material('a_grate',{albedo:AX+'grate.png',mapping:'world',filter:'nearest',blend:'masked',uScale:1/128,vScale:1/128});
}
$.ready(()=>{
    $.world.gravity(0,0).color('#b7d0e2');
    routeData=JSON.parse($.fs.readText(base+'routes.json'));
    globalThis.world=$.re2dWorld.load(base+'dust2.re2dworld').backend('gpu');
    world.material('sand',{albedo:base+'sand.png',mapping:'world',filter:'nearest',blend:'opaque',uScale:1/128,vScale:1/128});
    world.material('stone',{albedo:base+'stone.png',mapping:'world',filter:'nearest',blend:'opaque',uScale:1/128,vScale:1/128});
    world.material('crate',{albedo:base+'crate.png',blend:'opaque',uScale:1/100,vScale:1/72});
    world.material('crateTop',{albedo:base+'crate.png',filter:'nearest',uScale:1/100,vScale:1/100});
    world.material('signA',{albedo:base+'sign_A.png',blend:'translucent',uScale:1,vScale:1});
    world.material('signB',{albedo:base+'sign_B.png',blend:'translucent',uScale:1,vScale:1});
    world.material('clubFloor',{albedo:base+'club_floor.png',uScale:1/64,vScale:1/64});
    world.material('clubSpeaker',{albedo:base+'club_speaker.png',uScale:1/24,vScale:1/32});
    world.material('clubNeon',{albedo:base+'club_neon.png',emissive:base+'club_neon.png',emissiveStrength:2});
    annexMaterials(world);
    world.sky({texture:base+'sky.exr',projection:'panorama',exposure:0,yaw:0});
    const data=compiledData=JSON.parse($.fs.readText(base+'dust2.re2dworld')),info=world.info();
    for(let i=0;i<info.walls;i++)world.surface(i).material('sand');
    // SDK keeps authored walls first; tags remain in inspectable source, not renderer state.
    const source=JSON.parse($.fs.readText(base+'dust2.re2dmap'));
    const crateWalls=source.walls.filter(w=>w.tag==='crate'),crates=[];
    for(let i=0;i<crateWalls.length;i+=4){const group=crateWalls.slice(i,i+4),pts=group.flatMap(w=>[w.from,w.to]);crates.push({x:Math.min(...pts.map(p=>p[0])),y:Math.min(...pts.map(p=>p[1])),right:Math.max(...pts.map(p=>p[0])),bottom:Math.max(...pts.map(p=>p[1])),top:group[0].top});}
    for(let i=0;i<source.walls.length;i++){const tag=source.walls[i].tag;if(tag==='crate')world.surface(i).material('crate');if(tag==='club-speaker')world.surface(i).material('clubSpeaker');if(tag==='club-lamp')world.surface(i).material('clubNeon');if(tag.startsWith('annex-'))world.surface(i).material('a_'+tag.slice(6));}
    const annexTheme=(x,y)=>(routeData.annexThemes||[]).find(t=>x>=t.rect[0]&&x<t.rect[0]+t.rect[2]&&y>=t.rect[1]&&y<t.rect[1]+t.rect[3]);
    for(let i=source.walls.length;i<info.walls;i++){const sf=world.surface(i);if(sf&&sf.cell>=0&&data.cells[sf.cell]){const cc=data.cells[sf.cell],th=annexTheme(cc.x+cc.w/2,cc.y+cc.h/2);if(th)world.surface(i).material('a_'+th.ceil);}}
    let span=0;
    for(const c of data.cells)for(const s of c.spans){
        const th=c.x>=2400?annexTheme(c.x+c.w/2,c.y+c.h/2):null;
        world.surface(info.walls+span*2).material(th?'a_'+th.floor:c.x>=1920?'clubFloor':'stone');
        if(th)world.surface(info.walls+span*2+1).material('a_'+th.ceil);
        if(crates.some(b=>c.x>=b.x&&c.y>=b.y&&c.x+c.w<=b.right&&c.y+c.h<=b.bottom&&s.bottom===b.top))world.surface(info.walls+span*2).material('crateTop');
        if((c.x===160&&c.y===160)||(c.x===1440&&c.y===160))world.decal({surface:info.walls+span*2,material:c.x===160?'signB':'signA',u:16,v:16,width:128,height:128});
        const centerX=c.x+c.w/2,centerY=c.y+c.h/2;
        const z=routeData.zones.find(z=>centerX>=z.rect[0]&&centerX<z.rect[0]+z.rect[2]&&centerY>=z.rect[1]&&centerY<z.rect[1]+z.rect[3]);
        if(z&&!z.indoor&&!z.name.includes('TUNNEL')&&!z.name.includes('CLUB')&&s.top-s.bottom>100)world.surface(info.walls+span*2+1).sky();
        span++;
    }
    // Target mannequins demonstrate native per-sample sprite depth and lighting.
    globalThis.dustNPCs=[];
    for(const [x,y,h] of [[360,240,0],[1520,240,128],[1200,1040,128],[1000,1660,0],[2280,1840,0],[1840,1240,0]]){
        const talker=x===npcAt.x&&y===npcAt.y,isClub=x>=2080;
        const sprite=$.re2dSprite.from(talker?base+'npc.character.json':isClub?base+'club.character.json':'demos/rotsprite/russi3.character.json').re2dStyle('anime').at(x,y).depth(h).size(72,88).angle(isClub?Math.PI:Math.PI/2).re2dMotion(talker?'idle':isClub?'chickenDance':'idle',talker?1:isClub?1:0).hide();world.add(sprite);dustNPCs.push(sprite);
        if(talker)globalThis.talkNpc=sprite;if(isClub)globalThis.clubDancer=sprite;
    }
    globalThis.annexNPCs=[];
    const npcGuns=['smg','pistol','sniper','shotgun','lmg'];
    for(const [x,y,h] of [[3960,1700,0],[4160,960,0],[5600,1700,288],[4000,2480,0],[6800,2200,0]]){
        const key=npcGuns[annexNPCs.length],sp=$.re2dSprite.from('demos/rotsprite/russi3.character.json').re2dStyle('anime').at(x,y).depth(h).size(72,88).angle(Math.PI/2).hide();
        sp.re2dMotion($.re2dSprite.definition(sp).equipment[key].pose,0);
        $.re2dSprite.equip(sp,key).re2dStyle('anime').hide();   // weapon is a Re2DSprite attached to her hand socket
        world.add(sp);annexNPCs.push(sp);
    }
    weaponInit();
    globalThis.annexLights=(routeData.annexLights||[]).map(d=>{const l=world.light({x:d.x,y:d.y,h:d.h,radius:d.radius,intensity:d.intensity,color:d.color,shadow:true});if(d.flicker)l.flicker(d.flicker);return{l,d};});
    globalThis.view={x:1040,y:1840,h:48,yaw:-90,pitch:0,fov:75,near:1};
    globalThis.hud=$.ui.doc(base+'hud.rml').show();
    globalThis.dustCamera=dustCamera;globalThis.dustMove=dustMove;globalThis.dustMotion=motion;globalThis.dustPhysics=dustPhysics;
    globalThis.clubLamps=[[2160,1744],[2344,1744],[2160,1952],[2344,1952]].map(([x,y],i)=>world.light({x,y,h:180,radius:600,intensity:1.5,color:clubColors[i],shadow:true}));
    globalThis.clubAudio=$.re2dWorldAudio(world);
    globalThis.dustSteps={count:0,last:null,variant:0};globalThis.dustWalkAudio=dustWalkAudio;
    globalThis.dustWind=snd(base+'audio/wind.wav',{x:view.x,y:view.y,h:800,range:2000,reference:1000,volume:.14,loop:true,hrtf:true,priority:10});
    globalThis.clubMusic=clubAudio.source(base+'club_loop.mp3',{x:2352,y:1840,h:64,range:1300,reference:130,volume:.7,loop:true,hrtf:true});
    dustCamera('T SPAWN');
    $.window.mouseLock(true);
});
// HRTF ambience: the 16 mixer channels are shared, so only the nearest few annex sources stay alive.
const annexAmbient=globalThis.annexAmbient={active:new Map(),timer:0};
function annexAudioUpdate(dt){
    annexAmbient.timer-=dt;if(annexAmbient.timer>0)return;annexAmbient.timer=.25;
    const list=routeData.annexAudio||[],cand=[];
    for(let i=0;i<list.length;i++){const s=list[i],d=Math.hypot(s.x-view.x,s.y-view.y);if(d<s.range)cand.push([d/s.range,i]);}
    cand.sort((a,b)=>a[0]-b[0]);
    const want=new Set(cand.slice(0,6).map(c=>c[1]));
    for(const [i,src] of annexAmbient.active)if(!want.has(i)||!src.info().playing){src.stop();annexAmbient.active.delete(i);}
    for(const i of want)if(!annexAmbient.active.has(i)){const s=list[i];annexAmbient.active.set(i,snd(base+s.file,{x:s.x,y:s.y,h:s.h,range:s.range,reference:s.reference,volume:s.volume,loop:true,hrtf:true,priority:30}));}
}
function oneShot(file,x,y,h,volume,range){return snd(base+'annex/'+file,{x,y,h,range:range||900,reference:100,volume,loop:false,hrtf:true,priority:50});}
function annexLightsUpdate(t){
    for(const {l,d} of annexLights){
        if(d.pulse)l.intensity(d.intensity*(d.pulse.min+(d.pulse.max-d.pulse.min)*(.5+.5*Math.sin(t*d.pulse.rate*Math.PI*2))));
        if(d.orbit){const a=(d.orbit.phase||0)+t*d.orbit.speed*Math.PI*2;l.at(d.orbit.cx+Math.cos(a)*d.orbit.r,d.orbit.cy+Math.sin(a)*d.orbit.r);}
    }
}
let annexCamIndex=-1;
// ---- Shared screen effects: shake (explosions, damage) and projection of world points onto the 800x450 frame ----
const fx=globalThis.fx={shake:0,x:0,y:0,seed:7};
function fxRand(){fx.seed=(Math.imul(fx.seed,1664525)+1013904223)>>>0;return fx.seed/4294967296;}
function fxUpdate(dt){if(fx.shake>0){fx.shake=Math.max(0,fx.shake-dt);const a=fx.shake*2.6;fx.x=(fxRand()-.5)*a;fx.y=(fxRand()-.5)*a;}else fx.x=fx.y=0;}
function projectToScreen(x,y,h){
    const yaw=view.yaw*Math.PI/180,pit=view.pitch*Math.PI/180,dx=x-view.x,dy=y-view.y,dh=h-view.h;
    const cp=Math.cos(pit),sp=Math.sin(pit),cy=Math.cos(yaw),sy=Math.sin(yaw);
    const zf=dx*cy*cp+dy*sy*cp+dh*sp;if(zf<8)return null;
    const right=-dx*sy+dy*cy,up=-dx*sp*cy-dy*sp*sy+dh*cp,focal=225/Math.tan(view.fov*Math.PI/360);
    return{x:400+focal*right/zf,y:225-focal*up/zf,z:zf};
}
function renderView(){const rp=aks.recoil*.45,ry=aks.recoilYaw*.3;return fx.x||fx.y||rp||ry?{...view,yaw:view.yaw+fx.x+ry,pitch:view.pitch+fx.y+rp}:view;}

// ---- Second map: the burning facility (key 0). A separate `$.re2dWorld`; switching maps swaps `world` and `clubAudio`. ----
// Flames/smoke/explosions are the engine's `$.particles` presets (anchors projected from the world); zombies are Re2D characters
// baked by r2d-sdk from the supplied Mixamo FBX (walk via animation-import, hit/death are the existing rig clips).
const FIRE_DIR=base+'fire/';
const fireMap=globalThis.fireMap={loaded:false,active:false,t:0,nextBoom:3,world:null,audio:null,meta:null,dust:null,dustAudio:null,ret:null,
    fires:[],alarms:[],alarmLights:[],crackle:new Map(),booms:[],zombies:[],hp:100,dead:0,noise:0,kills:0};
function loadFireMap(){
    if(fireMap.loaded)return;
    const meta=JSON.parse($.fs.readText(FIRE_DIR+'fire.json')),w=$.re2dWorld.load(FIRE_DIR+'fire.re2dworld').backend('gpu');
    annexMaterials(w);
    const source=JSON.parse($.fs.readText(FIRE_DIR+'fire.re2dmap')),data=JSON.parse($.fs.readText(FIRE_DIR+'fire.re2dworld')),info=w.info();
    const theme=(x,y)=>meta.themes.find(t=>x>=t.rect[0]&&x<t.rect[0]+t.rect[2]&&y>=t.rect[1]&&y<t.rect[1]+t.rect[3]);
    for(let i=0;i<info.walls;i++)w.surface(i).material('a_concrete');
    for(let i=0;i<source.walls.length;i++){const tag=source.walls[i].tag;if(tag&&tag.startsWith('annex-'))w.surface(i).material('a_'+tag.slice(6));}
    let span=0;
    for(const c of data.cells)for(const s of c.spans){
        const th=theme(c.x+c.w/2,c.y+c.h/2);
        w.surface(info.walls+span*2).material(th?'a_'+th.floor:'a_metal');
        w.surface(info.walls+span*2+1).material(th?'a_'+th.ceil:'a_concrete');
        span++;
    }
    Object.assign(fireMap,{world:w,audio:$.re2dWorldAudio(w),meta,loaded:true});
}
function dustAudioPark(){
    if(globalThis.dustWind){dustWind.stop();globalThis.dustWind=null;}
    if(globalThis.clubMusic){try{clubMusic.stop();}catch(e){}globalThis.clubMusic=null;}
    if(globalThis.npcVoice){npcVoice.stop();globalThis.npcVoice=null;}
    for(const [,src] of annexAmbient.active)src.stop();annexAmbient.active.clear();
}
function dustAudioResume(){
    globalThis.dustWind=snd(base+'audio/wind.wav',{x:view.x,y:view.y,h:800,range:2000,reference:1000,volume:.14,loop:true,hrtf:true,priority:10});
    globalThis.clubMusic=clubAudio.source(base+'club_loop.mp3',{x:2352,y:1840,h:64,range:1300,reference:130,volume:.7,loop:true,hrtf:true});
}
function cleanFire(){
    for(const e of fireMap.fires){e.flame.remove();e.smoke.remove();e.light.remove();}
    for(const [,s] of fireMap.crackle)s.stop();
    for(const a of fireMap.alarms)a.stop();
    for(const l of fireMap.alarmLights)l.remove();
    for(const b of fireMap.booms)for(const n of b.nodes)n.remove();
    for(const z of fireMap.zombies)if(!z.gone)z.sp.remove();
    fireMap.fires=[];fireMap.alarms=[];fireMap.alarmLights=[];fireMap.crackle=new Map();fireMap.booms=[];fireMap.zombies=[];
}
function resetFire(){
    cleanFire();
    const m=fireMap.meta;
    Object.assign(view,{x:m.spawn.x,y:m.spawn.y,h:m.spawn.h,yaw:m.spawn.yaw,pitch:0});
    motion.vx=motion.vy=motion.vz=0;motion.grounded=true;
    Object.assign(fireMap,{hp:100,dead:0,t:0,nextBoom:3.5,noise:0,kills:0});fx.seed=7;
    aks.ammo=aks.mag;aks.clip='draw';aks.t=0;
    m.fires.forEach((f,i)=>{
        const flame=$('<particles>',$.particles.preset('fire',{amount:44})).layer(4).hide();
        const smoke=$('<particles>',$.particles.preset('smoke',{amount:10})).layer(4).hide();
        const light=world.light({x:f.x,y:f.y,h:f.h+50,radius:900,intensity:4.4,color:'#ff7a28',shadow:true}).flicker({min:.5,max:1,rate:11,seed:7+i*13});
        fireMap.fires.push({f,flame,smoke,light});
    });
    for(const p of m.alarm.sources){
        fireMap.alarms.push(snd(base+m.alarm.file,{x:p.x,y:p.y,h:p.h,range:m.alarm.range,reference:m.alarm.reference,volume:m.alarm.volume,loop:true,hrtf:true,priority:70}));
        fireMap.alarmLights.push(world.light({x:p.x,y:p.y,h:p.h-25,radius:620,intensity:1.8,color:'#ff1a10',shadow:true}));
    }
    for(const z of m.zombies)zombieSpawn(z.x,z.y);
}
function enterFireMap(){
    loadFireMap();
    fireMap.ret={x:view.x,y:view.y,h:view.h,yaw:view.yaw,pitch:view.pitch};
    dustAudioPark();
    fireMap.dust=world;fireMap.dustAudio=clubAudio;
    globalThis.world=fireMap.world;globalThis.clubAudio=fireMap.audio;
    fireMap.active=true;
    resetFire();
}
function leaveFireMap(){
    cleanFire();
    fireMap.active=false;
    globalThis.world=fireMap.dust;globalThis.clubAudio=fireMap.dustAudio;
    Object.assign(view,fireMap.ret);motion.vx=motion.vy=motion.vz=0;
    dustAudioResume();
}
function fireAudioUpdate(){
    // nearest few crackling fires get an HRTF source (16 mixer channels are shared)
    const cfg=fireMap.meta.crackle,near=fireMap.fires.map((e,i)=>[Math.hypot(e.f.x-view.x,e.f.y-view.y),i]).filter(a=>a[0]<cfg.range).sort((a,b)=>a[0]-b[0]).slice(0,3).map(a=>a[1]);
    const want=new Set(near);
    for(const [i,s] of fireMap.crackle)if(!want.has(i)){s.stop();fireMap.crackle.delete(i);}
    for(const i of want)if(!fireMap.crackle.has(i)){const f=fireMap.fires[i].f;fireMap.crackle.set(i,snd(base+cfg.file,{x:f.x,y:f.y,h:f.h+20,range:cfg.range,reference:cfg.reference,volume:cfg.volume,loop:true,hrtf:true,priority:40}));}
}
function fireBoom(){
    const cfg=fireMap.meta;
    let x=0,y=0,h=70+fxRand()*70,ok=false;
    for(let tries=0;tries<10&&!ok;tries++){
        const a=fxRand()*6.283,r=260+fxRand()*620;x=view.x+Math.cos(a)*r;y=view.y+Math.sin(a)*r;
        ok=world.spanAt(x,y,40)!==null&&!world.blocked(x,y,20,0,80);
    }
    if(!ok){x=view.x+Math.cos(view.yaw*Math.PI/180)*320;y=view.y+Math.sin(view.yaw*Math.PI/180)*320;}
    world.light({x,y,h:h+60,radius:880,intensity:5,color:'#ffb458',shadow:true}).life(.22);
    world.light({x,y,h:h+40,radius:700,intensity:1.7,color:'#ff3a10',shadow:true}).life(1.2);
    oneShot('explosion.wav',x,y,h,cfg.boom.volume,cfg.boom.range);
    const p=projectToScreen(x,y,h),nodes=[];
    if(p&&!world.ray({x:view.x,y:view.y,height:view.h},{x,y,height:h+10})){
        const k=Math.max(.7,Math.min(8,620/p.z));
        for(const [preset,amount] of [['explosion',46],['sparks',30],['smoke',14]]){
            const n=$('<particles>',$.particles.preset(preset,{amount})).layer(4).at(p.x,p.y).scale(k);n.burst(amount);nodes.push(n);
        }
    }
    fireMap.booms.push({until:fireMap.t+2.4,nodes});
    fx.shake=.7;aks.recoil=Math.min(1.6,aks.recoil+.8);fireMap.noise=2.5;
    for(const z of fireMap.zombies)if(!z.dead&&Math.hypot(z.x-x,z.y-y)<190)zombieHit(z,2);      // blast kills nearby zombies
}
// ---- Zombies: plain objects (no classes); movement/hearing/line of sight are coarse queries on the native world ----
function zombieVoice(z,file,volume){return snd(base+'annex/'+file,{x:z.x,y:z.y,h:z.h+52,range:2200,reference:110,volume,loop:false,hrtf:true,priority:75});}
function zombieSpawn(x,y){
    const sp=$.re2dSprite.from(base+'zombie3/zombie.character.json').at(x,y).depth(0).size(128,128).angle(0).re2dMotion('walk',.25).hide();
    world.add(sp);
    fireMap.zombies.push({sp,x,y,h:0,hp:3,state:'idle',t:0,cool:0,hitT:0,growl:1.5+fxRand()*5,dead:false,gone:false,speed:48+fxRand()*26,face:fxRand()*6.283,anim:'idle'});
}
function zombieStep(z,dx,dy){
    const nx=z.x+dx,ny=z.y+dy,s=world.support(nx,ny,z.h,64,9);
    if(!s||world.blocked(nx,ny,14,s.height,s.height+60))return false;
    z.x=nx;z.y=ny;z.h=s.height;return true;
}
function zombieHit(z,dmg){
    if(z.dead)return;
    z.hp-=dmg;z.state='chase';
    if(z.hp<=0){
        z.dead=true;z.t=0;z.sp.re2dMotion('walk',0);fireMap.kills++;
        zombieVoice(z,'zombie_die.wav',1);
        snd('demos/assets/audio/sfx/enemy_die.ogg',{x:z.x,y:z.y,h:z.h+40,range:1400,reference:100,volume:.5,loop:false,hrtf:true,priority:70});
    }else{
        z.hitT=.35;z.anim='hit';
        zombieVoice(z,'zombie_growl_'+(1+Math.floor(fxRand()*3))+'.wav',.9);
        snd('demos/assets/audio/sfx/enemy_hit.ogg',{x:z.x,y:z.y,h:z.h+45,range:1200,reference:100,volume:.7,loop:false,hrtf:true,priority:70});
    }
}
function playerHurt(d){
    if(fireMap.dead>0)return;
    fireMap.hp=Math.max(0,fireMap.hp-d);fx.shake=.45;
    snd('demos/assets/audio/sfx/hurt_01.ogg',{x:view.x,y:view.y,h:view.h-10,range:700,reference:100,volume:.9,loop:false,hrtf:true,priority:95});
    if(fireMap.hp<=0)fireMap.dead=3.2;
}
function zombieUpdate(z,dt){
    if(z.gone)return;
    if(z.dead){z.t+=dt;z.sp.re2dPose(0,-Math.min(88,z.t*220));if(z.t>9){z.sp.remove();z.gone=true;}return;}
    z.cool=Math.max(0,z.cool-dt);z.growl-=dt;
    const dx=view.x-z.x,dy=view.y-z.y,dist=Math.hypot(dx,dy);
    const sees=dist<1100&&!world.ray({x:z.x,y:z.y,height:z.h+54},{x:view.x,y:view.y,height:view.h-8});
    if(sees||(fireMap.noise>0&&dist<1500))z.state='chase';
    if(z.growl<=0&&dist<1700){zombieVoice(z,'zombie_growl_'+(1+Math.floor(fxRand()*3))+'.wav',z.state==='chase'?1:.75);z.growl=3.5+fxRand()*5;}
    if(z.hitT>0){z.hitT-=dt;z.sp.color('#ff9a9a');if(z.hitT<=0){z.anim='';z.sp.color('#ffffff');}return;}
    if(z.state==='chase'){
        z.face=Math.atan2(dy,dx);
        if(dist>64){
            const s=z.speed*dt,ux=dx/dist,uy=dy/dist;
            if(!zombieStep(z,ux*s,uy*s)){
                // blocked: steer around the obstacle, preferring the side that worked last time
                const side=z.dodge||1;let ok=false;
                for(const deg of [35,70,110,150]){for(const sg of [side,-side]){const a=Math.atan2(uy,ux)+sg*deg*Math.PI/180;if(zombieStep(z,Math.cos(a)*s,Math.sin(a)*s)){z.dodge=sg;ok=true;break;}}if(ok)break;}
            }
            if(z.anim!=='walk'){z.sp.re2dMotion('walk',1);z.anim='walk';}
        }else if(z.cool<=0){
            z.cool=1.1;playerHurt(10);zombieVoice(z,'zombie_attack.wav',1);
        }
    }else if(z.anim!=='idle'){z.sp.re2dMotion('walk',.25);z.anim='idle';}
    z.sp.at(z.x,z.y).depth(z.h).angle(z.face);
}
function zombieTrace(ux,uy,uz,wallT){      // nearest zombie on the shot ray (capsule approximated by distance to the torso point)
    let best=null,bt=Infinity;
    for(const z of fireMap.zombies){
        if(z.dead||z.gone)continue;
        const px=z.x-view.x,py=z.y-view.y,pz=z.h+48-view.h,t=px*ux+py*uy+pz*uz;
        if(t<12||t>wallT)continue;
        const perp=Math.hypot(px-ux*t,py-uy*t,pz-uz*t);
        if(perp<30&&t<bt){bt=t;best=z;}
    }
    return best?{z:best,t:bt}:null;
}
Object.assign(globalThis,{fireBoom,zombieHit,playerHurt,enterFireMap,leaveFireMap,resetFire});
function fireUpdate(dt){
    if(!fireMap.active)return;
    fireMap.t+=dt;fireMap.noise=Math.max(0,fireMap.noise-dt*1.2);
    if(fireMap.dead>0){fireMap.dead-=dt;if(fireMap.dead<=0)resetFire();return;}
    for(const e of fireMap.fires){
        const p=projectToScreen(e.f.x,e.f.y,e.f.h),far=Math.hypot(e.f.x-view.x,e.f.y-view.y)>1500;
        const seen=p&&!far&&!world.ray({x:view.x,y:view.y,height:view.h},{x:e.f.x,y:e.f.y,height:e.f.h+20});
        for(const n of [e.flame,e.smoke]){if(seen)n.show().at(p.x,p.y).scale(Math.max(.6,Math.min(7,520/p.z)));else n.hide();}
    }
    fireMap.alarmLights.forEach((l,i)=>l.intensity(.3+2.4*(.5+.5*Math.sin(fireMap.t*6.5+i*1.3))));
    fireMap.audioT=(fireMap.audioT||0)-dt;if(fireMap.audioT<=0){fireMap.audioT=.3;fireAudioUpdate();}
    fireMap.nextBoom-=dt;if(fireMap.nextBoom<=0){fireBoom();fireMap.nextBoom=4+fxRand()*6;}
    fireMap.booms=fireMap.booms.filter(b=>{if(fireMap.t<b.until)return true;for(const n of b.nodes)n.remove();return false;});
    for(const z of fireMap.zombies)zombieUpdate(z,dt);
}
// ---- Player weapon: AKS-74U with hands, one dense Re2DSprite v3 baked by r2d-sdk from the supplied FBX ----
// The viewmodel is an ordinary 2D sprite over the world frame, synthesized with a perspective eye (`projection.eye` in aks.character.json):
// the sprite centre is the view axis (the crosshair), so the weapon sits where a first-person camera would see it.
// Its tint follows `world.lightAt`, so it goes dark in a dark room.
const WSND=base+'audio/weapon/';
// Sprite nodes live in window pixels around the screen centre (the 2D camera stays at 0,0), so the view axis is the node position (0,0).
const AKS=globalThis.AKS={fov:52,yaw:7,pitch:-4,cx:0,cy:0,muzzle:[2.86,-12.15,-30.82],eye:[0,0,1],focal:1,size:2100};
// Model point (Re2D units, idle pose) -> screen point of the viewmodel sprite; the same maths as the native v3 projection.
function aksProject(p){
    const yaw=AKS.yaw*Math.PI/180,pit=AKS.pitch*Math.PI/180,cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pit),sp=Math.sin(pit);
    const x=cy*p[0]+sy*p[2],y=sp*sy*p[0]+cp*p[1]-sp*cy*p[2],z=-cp*sy*p[0]+sp*p[1]+cp*cy*p[2],k=AKS.focal/(AKS.eye[2]-z);
    return{x:(x-AKS.eye[0])*k,y:(y-AKS.eye[1])*k};
}
const weaponList=globalThis.weaponList=['aks74u','ak47','pistol','revolver','shotgun','smg','sniper','lmg'];
const staticGuns={ak47:[46,138],pistol:[13,138],revolver:[15,138],shotgun:[48,138],smg:[30,138],sniper:[56,138],lmg:[52,138]};
const aks=globalThis.aks={frames:{},clips:null,node:null,clip:'idle',t:0,ammo:30,mag:30,cool:0,flash:[],flashT:0,recoil:0,recoilYaw:0,timers:[],reloadClicked:false};
globalThis.weaponIndex=0;globalThis.vmKick=0;
function weaponInit(){
    // v3 viewmodel: one dense Re2DSprite with skin clips idle/draw/fire/reload baked by `r2d-sdk bake-re2d3`
    aks.clips={idle:{seconds:.0167},draw:{seconds:1},fire:{seconds:.3},reload:{seconds:1.8833}};
    const def=JSON.parse($.fs.readText(base+'aks3/aks.character.json')).projection;
    AKS.eye=def.eye;AKS.focal=$.window.size().h/2/Math.tan(AKS.fov*Math.PI/360);
    AKS.size=AKS.focal*def.extent/(def.eye[2]*def.bodyScale);        // sprite size that gives the chosen field of view
    AKS.flashAt=aksProject(AKS.muzzle);
    aks.node=$.re2dSprite.from(base+'aks3/aks.character.json').at(AKS.cx,AKS.cy).size(AKS.size,AKS.size).re2dPose(AKS.yaw,AKS.pitch).layer(5).hide();
    for(let i=1;i<=4;i++)aks.flash.push($('<sprite>',{src:base+'annex/flash_'+i+'.png'}).blend('add').layer(6).hide());
    setWeapon(0);
}
globalThis.setWeapon=i=>setWeapon(i);
function aksFrame(name,t){
    if(aks.shown!==name){aks.node.re2dMotion(name,0);aks.shown=name;}
    aks.node.re2dSeek(Math.min(t,aks.clips[name].seconds));
}
function setWeapon(i){
    if(aks.node)aks.node.hide();
    if(globalThis.vm){vm.remove();globalThis.vm=null;}
    weaponIndex=((i%weaponList.length)+weaponList.length)%weaponList.length;
    const key=weaponList[weaponIndex];
    if(key==='aks74u'){aks.clip='draw';aks.t=0;aks.cool=0;aks.shown=null;aks.node.show();return;}
    const [len,yaw]=staticGuns[key],px=key==='pistol'||key==='revolver'?400:key==='smg'?820:key==='sniper'||key==='lmg'?1250:1100,size=128.4*px/len;
    globalThis.vm=$.re2dSprite.from('demos/rotsprite/weapons/'+key+'_fp.character.json').re2dStyle('anime').at(610,470).size(size,size).re2dPose(yaw,-24).layer(5);
    globalThis.vmYaw=yaw;
}
function worldTint(){
    // brightness of the room at the player's hands (native deterministic approximation, no pixel reads)
    const L=world.lightAt(view.x,view.y,view.h-12);
    const k=v=>Math.max(.05,Math.min(1,(v||0)*1.15+.05)),c=v=>('0'+Math.round(255*k(v)).toString(16)).slice(-2);
    return L?'#'+c(L.r)+c(L.g)+c(L.b):'#606060';
}
function weaponTimer(delay,fn){aks.timers.push({t:delay,fn});}
function muzzleWorld(){
    const yaw=view.yaw*Math.PI/180,fx=Math.cos(yaw),fy=Math.sin(yaw),rx=-fy,ry=fx;
    return{x:view.x+fx*34+rx*7,y:view.y+fy*34+ry*7,h:view.h-9,fx,fy,rx,ry};
}
function weaponSound(file,x,y,h,volume,range,priority){return snd(WSND+file,{x,y,h,range:range||3200,reference:140,volume,loop:false,hrtf:true,priority:priority||80});}
function aksShoot(){
    const m=muzzleWorld();
    aks.ammo--;aks.clip='fire';aks.t=0;aks.cool=.105;aks.recoil=Math.min(1.6,aks.recoil+.55);aks.recoilYaw=(Math.random()-.5)*.5;
    weaponSound('assault-rifle-shot-1.wav',m.x,m.y,m.h,1,3600,90);                 // the shot itself, HRTF at the muzzle
    world.light({x:m.x+m.fx*18,y:m.y+m.fy*18,h:m.h+4,radius:620,intensity:4.6,color:'#ffc27a',shadow:true}).life(.055);
    world.light({x:view.x,y:view.y,h:view.h,radius:240,intensity:1.4,color:'#ff8a3a',shadow:false}).life(.09);
    aks.flashT=.055;aks.flashIndex=Math.floor(Math.random()*aks.flash.length);aks.flashRot=Math.random()*360;aks.flashScale=.85+Math.random()*.5;
    weaponTimer(.28,()=>weaponSound('shell-casing-concrete-1.wav',m.x+m.rx*20+m.fx*10,m.y+m.ry*20+m.fy*10,6,.55,900,50));   // brass hits the floor
    if(aks.ammo<=8&&aks.ammo>0)weaponTimer(.04,()=>weaponSound('low-ammo-click.wav',view.x,view.y,view.h-14,.45,500,60));
    fireMap.noise=Math.max(fireMap.noise,1.4);
    // bullet impact: ray along the (recoiled) aim; sound and sparks at the hit point
    const yaw=view.yaw*Math.PI/180,pit=(view.pitch+aks.recoil*.5)*Math.PI/180,d=4000;
    const to={x:view.x+Math.cos(yaw)*Math.cos(pit)*d,y:view.y+Math.sin(yaw)*Math.cos(pit)*d,height:view.h+Math.sin(pit)*d};
    const hit=world.ray({x:view.x,y:view.y,height:view.h},to);
    if(fireMap.active){
        const ux=Math.cos(yaw)*Math.cos(pit),uy=Math.sin(yaw)*Math.cos(pit),uz=Math.sin(pit),wallT=hit?hit.fraction*d:Infinity,tr=zombieTrace(ux,uy,uz,wallT);
        if(tr){zombieHit(tr.z,1);impactSparks(tr.z.x,tr.z.y,tr.z.h+48);return;}
    }
    if(hit){
        const dist=Math.hypot(hit.x-view.x,hit.y-view.y),delay=Math.min(.35,dist/9000);
        weaponTimer(delay,()=>{weaponSound(Math.random()<.3?'ricochet-1.wav':'impact-concrete-1.wav',hit.x,hit.y,hit.height,.8,2400,70);impactSparks(hit.x,hit.y,hit.height);});
    }
}
function impactSparks(x,y,h){
    const p=projectToScreen(x,y,h);if(!p)return;
    const k=Math.max(.5,Math.min(4,420/p.z)),n=$('<particles>',$.particles.preset('sparks',{amount:14})).layer(4).at(p.x,p.y).scale(k);
    n.burst(14);weaponTimer(1.2,()=>n.remove());
}
function aksUpdate(dt){
    const firing=$.input.mouseDown('left')||$.input.down('f');
    aks.cool=Math.max(0,aks.cool-dt);aks.t+=dt;
    for(const t of aks.timers)t.t-=dt;
    for(const t of aks.timers.filter(t=>t.t<=0))t.fn();
    aks.timers=aks.timers.filter(t=>t.t>0);
    const clips=aks.clips;
    if(aks.clip==='draw'){
        aksFrame('draw',aks.t);
        if(aks.t>=clips.draw.seconds){aks.clip='idle';aks.t=0;}
    }else if(aks.clip==='reload'){
        aksFrame('reload',aks.t);
        if(!aks.reloadClicked&&aks.t>1.02){aks.reloadClicked=true;weaponSound('rifle-mag-insert.wav',view.x,view.y,view.h-16,.9,900,60);}
        if(aks.t>=clips.reload.seconds){aks.clip='idle';aks.t=0;aks.ammo=aks.mag;}
    }else{
        if(aks.clip==='fire'){aksFrame('fire',aks.t);if(aks.t>clips.fire.seconds){aks.clip='idle';aks.t=0;}}
        else aksFrame('idle',0);
        if($.input.pressed('r')&&aks.ammo<aks.mag){aks.clip='reload';aks.t=0;aks.reloadClicked=false;}
        else if(firing&&aks.cool<=0){
            if(aks.ammo>0)aksShoot();
            else{aks.cool=.35;weaponSound('pistol-dry-fire.wav',view.x,view.y,view.h-14,.7,600,60);}
        }
    }
    // recoil settles; the muzzle flash is a short additive sprite at the barrel tip
    aks.recoil=Math.max(0,aks.recoil-dt*5.5);aks.recoilYaw*=Math.max(0,1-dt*8);
    const sp=Math.hypot(motion.vx,motion.vy)*(motion.grounded?1:0),bob=Math.sin(clubTime*9)*Math.min(1,sp/240);
    // recoil: the sprite grows about the view axis (the weapon kicks toward the eye) and drops a little; no re-synthesis is needed for that
    const kick=1+aks.recoil*.03,size=AKS.size*kick,nodeX=AKS.cx+bob*3+aks.recoilYaw*4,nodeY=AKS.cy+Math.abs(bob)*3+aks.recoil*4;
    aks.node.at(nodeX,nodeY).size(size,size).color(worldTint());
    if(aks.flashT>0){
        aks.flashT-=dt;
        aks.flash.forEach((f,i)=>{if(i===aks.flashIndex&&aks.flashT>0){const fs=520*aks.flashScale;f.show().size(fs,fs).at(nodeX+AKS.flashAt.x*kick,nodeY+AKS.flashAt.y*kick).rotate?.(aks.flashRot);}else f.hide();});
    }else aks.flash.forEach(f=>f.hide());
}
function weaponUpdate(dt){
    if($.input.pressed('c'))setWeapon(weaponIndex+1);
    const key=weaponList[weaponIndex];
    if(key==='aks74u'){aksUpdate(dt);return;}
    // the older procedural guns: same lighting tint, simple kick
    const sp=Math.hypot(motion.vx,motion.vy)*(motion.grounded?1:0),bob=Math.sin(clubTime*9)*Math.min(1,sp/240);vmKick=Math.max(0,vmKick-dt*6);
    if($.input.mousePressed('left')||$.input.pressed('f')){vmKick=1;const m=muzzleWorld();weaponSound('assault-rifle-shot-1.wav',m.x,m.y,m.h,.9,3400,90);world.light({x:view.x,y:view.y,h:view.h,radius:240,intensity:2.5,color:'#ffbc65',shadow:true}).life(.08);}
    vm.at(610+bob*4,470+Math.abs(bob)*4+vmKick*10).re2dPose(vmYaw+vmKick*3,-24+vmKick*10).color(worldTint());
}
function npcLookAndTalk(dt){
    const dx=view.x-npcAt.x,dy=view.y-npcAt.y,dz=(view.h-48)-(npcAt.h+54),distance=Math.hypot(dx,dy,dz);
    const visible=distance<560&&!world.ray({x:view.x,y:view.y,height:view.h},{x:npcAt.x,y:npcAt.y,height:npcAt.h+54});
    if(visible){
        const target=Math.atan2(dx,dy)*180/Math.PI;
        let difference=((target-npcBodyYaw+540)%360)-180;
        const desiredBody=Math.abs(difference)>32?target-Math.sign(difference)*32:npcBodyYaw;
        const bodyDelta=((desiredBody-npcBodyYaw+540)%360)-180;
        npcBodyYaw+=Math.max(-75*dt,Math.min(75*dt,bodyDelta));
        const head=((target-npcBodyYaw+540)%360)-180;
        talkNpc.re2dRig({bodyYaw:npcBodyYaw,headYaw:Math.max(-32,Math.min(32,head))});
    }else{
        npcBodyYaw*=Math.max(0,1-dt*2.5);talkNpc.re2dRig({bodyYaw:npcBodyYaw,headYaw:0});
    }
    if(visible&&distance<250&&!npcHasSpoken&&!npcVoice){
        npcHasSpoken=true;npcSpeakTime=0;npcAnim='talking';talkNpc.re2dMotion(npcAnim,1);
        talkNpc.re2dEmotion('speaking');
        npcVoice=snd(base+'voice/suzu_monologue.mp3',{x:npcAt.x,y:npcAt.y,h:npcAt.h+54,range:900,reference:140,volume:.9,loop:false,hrtf:true,priority:60});globalThis.npcVoice=npcVoice;
    }
    if(npcVoice){
        const state=npcVoice.info();
        if(state.playing){
            npcSpeakTime+=dt;
            const next=['talking','arguing','walkCircle'][Math.floor(npcSpeakTime/4.2)%3];
            if(next!==npcAnim){npcAnim=next;talkNpc.re2dMotion(npcAnim,1);}
            npcVoice.at(npcAt.x,npcAt.y,npcAt.h+54);
        }else{npcVoice=null;globalThis.npcVoice=null;talkNpc.re2dEmotion('neutral');talkNpc.re2dMotion('idle',1);npcAnim='idle';}
    }
    if(distance>620)npcHasSpoken=false;
}
$.update(dt=>{
    if(mouseLocked&&$.input.mousePressed('left')&&!$.window.mouseLock())$.window.mouseLock(true);   // a click re-captures the mouse if the window started without focus
    if($.input.pressed('escape')){mouseLocked=false;$.window.mouseLock(false);}
    if($.input.pressed('m')){mouseLocked=!mouseLocked;$.window.mouseLock(mouseLocked);}
    if($.input.pressed('q'))$.quit();
    const inFire=fireMap.active;
    if($.input.pressed('0')){if(inFire)leaveFireMap();else enterFireMap();}
    if(!inFire&&$.input.pressed('8'))dustCamera('CLUB');
    clubTime+=dt;for(let i=0;i<clubLamps.length;i++){const phase=clubTime*2.1+i;clubLamps[i].color(clubColors[(Math.floor(phase))%clubColors.length]).intensity(.7+.8*(.5+.5*Math.sin(phase*Math.PI*2)));}
    if(!inFire){const names=Object.keys(routeData.cameras);for(let i=0;i<names.length;i++)if($.input.pressed(String(i+1)))dustCamera(names[i]);}
    if($.input.pressed('x')){if(inFire)resetFire();else dustCamera('T SPAWN');}
    if($.input.pressed('f2')){debugIndex=(debugIndex+1)%debugViews.length;world.debug.view(debugViews[debugIndex]);}
    if($.input.pressed('g')){gpu=!gpu;world.backend(gpu?'gpu':'cpu');}
    if(!inFire&&$.input.pressed('o')){
        let nearest=-1,distance=280*280;
        const data=compiledData;
        for(const i of [...routeData.doors,...(routeData.annexDoors||[])]){const p=data.portals[i],x=(p.from[0]+p.to[0])/2,y=(p.from[1]+p.to[1])/2,d=(x-view.x)**2+(y-view.y)**2;if(d<distance){nearest=i;distance=d;}}
        if(nearest>=0){doorStates[nearest]=!doorStates[nearest];world.portalClosed(nearest,doorStates[nearest]);const dp=data.portals[nearest];oneShot(doorStates[nearest]?'door_close.wav':'door_open.wav',(dp.from[0]+dp.to[0])/2,(dp.from[1]+dp.to[1])/2,64,.9);}
    }
    dt=Math.min(dt,.04);
    if(mouseLocked){const mouse=$.input.mouseDelta();view.yaw+=mouse.x*.14;view.pitch=Math.max(-80,Math.min(80,view.pitch-mouse.y*.14));}
    view.yaw+=$.input.axis('left','right')*dt*90;view.pitch=Math.max(-80,Math.min(80,view.pitch+$.input.axis('down','up')*dt*70));
    const oldX=view.x,oldY=view.y;
    dustPhysics(dt,$.input.vec('wasd'),$.input.pressed('space'));
    dustWalkAudio(Math.hypot(view.x-oldX,view.y-oldY));
    if(!inFire){if(globalThis.dustWind)dustWind.at(view.x,view.y,800);npcLookAndTalk(dt);annexAudioUpdate(dt);annexLightsUpdate(clubTime);}
    fireUpdate(dt);fxUpdate(dt);
    weaponUpdate(dt);
    if(!inFire&&$.input.pressed('tab')){const names=Object.keys(routeData.annexCameras||{});if(names.length){annexCamIndex=(annexCamIndex+1)%names.length;dustCamera(names[annexCamIndex]);}}
    const zone=inFire?{name:'FIRE FACILITY'}:routeData.zones.find(z=>view.x>=z.rect[0]&&view.x<z.rect[0]+z.rect[2]&&view.y>=z.rect[1]&&view.y<z.rect[1]+z.rect[3]);
    hud.text('hp',inFire?(fireMap.dead>0?'YOU DIED':'HP '+fireMap.hp+'  ·  kills '+fireMap.kills+'/'+fireMap.meta.zombies.length):'');
    hud.text('ammo',weaponList[weaponIndex]==='aks74u'?(aks.clip==='reload'?'RELOAD':aks.ammo+' / '+aks.mag):weaponList[weaponIndex].toUpperCase());
    const info=world.info();hud.text('status',`${inFire?'MAP 2':'DUST2'} / ${zone?.name??'WORLD'} · height ${Math.round(view.h-48)} · speed ${Math.round(Math.hypot(motion.vx,motion.vy))} · ${motion.grounded?'GROUND':'AIR'} · ${gpu?'GPU':'CPU'}`);
    hud.text('stats',`${info.visibleCells}/${info.cells} cells · ${info.visibleSurfaces}/${info.surfaces} surfaces · ${info.lights} lights · ${info.frameMs.toFixed(2)} ms`);
});
$.render(()=>world.render(renderView(),1024,576));
$.exit(()=>{$.window.mouseLock(false);if(fireMap.active)leaveFireMap();if(fireMap.world)fireMap.world.dispose();world.dispose();});
