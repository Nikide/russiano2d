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
    const source=clubAudio.source(base+'audio/step'+(stepIndex+1)+'.wav',{x:view.x,y:view.y,h:view.h-46,range:240,reference:80,volume:.5,loop:false,hrtf:true,priority:0});
    dustSteps.count++;dustSteps.last=source;dustSteps.variant=stepIndex+1;
}
const debugViews=['final','cell-id','span-id','depth','owner','light-level','dynamic-light-count','normal','emissive','bsp','portals','shadow-mask','overdraw'];
function dustCamera(name){const c=routeData.cameras[name];view.x=c[0];view.y=c[1];view.h=c[2];view.yaw=c[3];view.pitch=0;motion.vx=motion.vy=motion.vz=0;motion.grounded=true;}
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
$.ready(()=>{
    $.world.gravity(0,0).color('#b7d0e2');
    routeData=JSON.parse($.fs.readText(base+'routes.json'));
    globalThis.world=$.re2dWorld.load(base+'dust2.re2dworld').backend('gpu');
    world.material('sand',{albedo:base+'sand.png',mapping:'world',filter:'linear',blend:'opaque',uScale:1/128,vScale:1/128});
    world.material('stone',{albedo:base+'stone.png',mapping:'world',filter:'linear',blend:'opaque',uScale:1/128,vScale:1/128});
    world.material('crate',{albedo:base+'crate.png',blend:'opaque',uScale:1/100,vScale:1/72});
    world.material('crateTop',{albedo:base+'crate.png',filter:'linear',uScale:1/100,vScale:1/100});
    world.material('signA',{albedo:base+'sign_A.png',blend:'translucent',uScale:1,vScale:1});
    world.material('signB',{albedo:base+'sign_B.png',blend:'translucent',uScale:1,vScale:1});
    world.material('clubFloor',{albedo:base+'club_floor.png',uScale:1/64,vScale:1/64});
    world.material('clubSpeaker',{albedo:base+'club_speaker.png',uScale:1/24,vScale:1/32});
    world.material('clubNeon',{albedo:base+'club_neon.png',emissive:base+'club_neon.png',emissiveStrength:2});
    world.sky({texture:base+'sky.exr',projection:'panorama',exposure:0,yaw:0});
    const data=compiledData=JSON.parse($.fs.readText(base+'dust2.re2dworld')),info=world.info();
    for(let i=0;i<info.walls;i++)world.surface(i).material('sand');
    // SDK keeps authored walls first; tags remain in inspectable source, not renderer state.
    const source=JSON.parse($.fs.readText(base+'dust2.re2dmap'));
    const crateWalls=source.walls.filter(w=>w.tag==='crate'),crates=[];
    for(let i=0;i<crateWalls.length;i+=4){const group=crateWalls.slice(i,i+4),pts=group.flatMap(w=>[w.from,w.to]);crates.push({x:Math.min(...pts.map(p=>p[0])),y:Math.min(...pts.map(p=>p[1])),right:Math.max(...pts.map(p=>p[0])),bottom:Math.max(...pts.map(p=>p[1])),top:group[0].top});}
    for(let i=0;i<source.walls.length;i++){const tag=source.walls[i].tag;if(tag==='crate')world.surface(i).material('crate');if(tag==='club-speaker')world.surface(i).material('clubSpeaker');if(tag==='club-lamp')world.surface(i).material('clubNeon');}
    let span=0;
    for(const c of data.cells)for(const s of c.spans){
        world.surface(info.walls+span*2).material(c.x>=1920?'clubFloor':'stone');
        if(crates.some(b=>c.x>=b.x&&c.y>=b.y&&c.x+c.w<=b.right&&c.y+c.h<=b.bottom&&s.bottom===b.top))world.surface(info.walls+span*2).material('crateTop');
        if((c.x===160&&c.y===160)||(c.x===1440&&c.y===160))world.decal({surface:info.walls+span*2,material:c.x===160?'signB':'signA',u:16,v:16,width:128,height:128});
        const centerX=c.x+c.w/2,centerY=c.y+c.h/2;
        const z=routeData.zones.find(z=>centerX>=z.rect[0]&&centerX<z.rect[0]+z.rect[2]&&centerY>=z.rect[1]&&centerY<z.rect[1]+z.rect[3]);
        if(z&&!z.name.includes('TUNNEL')&&!z.name.includes('CLUB')&&s.top-s.bottom>100)world.surface(info.walls+span*2+1).sky();
        span++;
    }
    // Target mannequins demonstrate native per-sample sprite depth and lighting.
    globalThis.dustNPCs=[];
    for(const [x,y,h] of [[360,240,0],[1520,240,128],[1200,1040,128],[1000,1660,0],[2280,1840,0],[1840,1240,0]]){
        const talker=x===npcAt.x&&y===npcAt.y,isClub=x>=2080;
        const sprite=$.re2dSprite.from(talker?base+'npc.character.json':isClub?base+'club.character.json':'demos/rotsprite/russi.character.json').re2dStyle('anime').at(x,y).depth(h).size(72,88).angle(isClub?Math.PI:Math.PI/2).re2dMotion(talker?'idle':isClub?'chickenDance':'idle',talker?1:isClub?1:0).hide();world.add(sprite);dustNPCs.push(sprite);
        if(talker)globalThis.talkNpc=sprite;if(isClub)globalThis.clubDancer=sprite;
    }
    globalThis.view={x:1040,y:1840,h:48,yaw:-90,pitch:0,fov:75,near:1};
    globalThis.hud=$.ui.doc(base+'hud.rml').show();
    globalThis.dustCamera=dustCamera;globalThis.dustMove=dustMove;globalThis.dustMotion=motion;globalThis.dustPhysics=dustPhysics;
    globalThis.clubLamps=[[2160,1744],[2344,1744],[2160,1952],[2344,1952]].map(([x,y],i)=>world.light({x,y,h:180,radius:600,intensity:1.5,color:clubColors[i],shadow:true}));
    globalThis.clubAudio=$.re2dWorldAudio(world);
    globalThis.dustSteps={count:0,last:null,variant:0};globalThis.dustWalkAudio=dustWalkAudio;
    globalThis.dustWind=clubAudio.source(base+'audio/wind.wav',{x:view.x,y:view.y,h:800,range:2000,reference:1000,volume:.14,loop:true,hrtf:true,priority:10});
    globalThis.clubMusic=clubAudio.source(base+'club_loop.mp3',{x:2352,y:1840,h:64,range:1300,reference:130,volume:.7,loop:true,hrtf:true});
    dustCamera('T SPAWN');
    $.window.mouseLock(true);
});
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
        npcVoice=clubAudio.source(base+'voice/suzu_monologue.mp3',{x:npcAt.x,y:npcAt.y,h:npcAt.h+54,range:900,reference:140,volume:.9,loop:false,hrtf:true,priority:60});globalThis.npcVoice=npcVoice;
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
    if($.input.pressed('escape')){mouseLocked=false;$.window.mouseLock(false);}
    if($.input.pressed('m')){mouseLocked=!mouseLocked;$.window.mouseLock(mouseLocked);}
    if($.input.pressed('q'))$.quit();
    if($.input.pressed('8'))dustCamera('CLUB');
    clubTime+=dt;for(let i=0;i<clubLamps.length;i++){const phase=clubTime*2.1+i;clubLamps[i].color(clubColors[(Math.floor(phase))%clubColors.length]).intensity(.7+.8*(.5+.5*Math.sin(phase*Math.PI*2)));}
    const names=Object.keys(routeData.cameras);for(let i=0;i<names.length;i++)if($.input.pressed(String(i+1)))dustCamera(names[i]);
    if($.input.pressed('r'))dustCamera('T SPAWN');
    if($.input.pressed('f2')){debugIndex=(debugIndex+1)%debugViews.length;world.debug.view(debugViews[debugIndex]);}
    if($.input.pressed('g')){gpu=!gpu;world.backend(gpu?'gpu':'cpu');}
    if($.input.pressed('o')){
        let nearest=-1,distance=280*280;
        const data=compiledData;
        for(const i of routeData.doors){const p=data.portals[i],x=(p.from[0]+p.to[0])/2,y=(p.from[1]+p.to[1])/2,d=(x-view.x)**2+(y-view.y)**2;if(d<distance){nearest=i;distance=d;}}
        if(nearest>=0){doorStates[nearest]=!doorStates[nearest];world.portalClosed(nearest,doorStates[nearest]);}
    }
    if($.input.mousePressed('left')||$.input.pressed('f'))world.light({x:view.x,y:view.y,h:view.h,radius:220,intensity:2.5,color:'#ffbc65',shadow:true}).life(.09);
    dt=Math.min(dt,.04);
    if(mouseLocked){const mouse=$.input.mouseDelta();view.yaw+=mouse.x*.14;view.pitch=Math.max(-80,Math.min(80,view.pitch-mouse.y*.14));}
    view.yaw+=$.input.axis('left','right')*dt*90;view.pitch=Math.max(-80,Math.min(80,view.pitch+$.input.axis('down','up')*dt*70));
    const oldX=view.x,oldY=view.y;
    dustPhysics(dt,$.input.vec('wasd'),$.input.pressed('space'));
    dustWalkAudio(Math.hypot(view.x-oldX,view.y-oldY));
    dustWind.at(view.x,view.y,800);
    npcLookAndTalk(dt);
    const zone=routeData.zones.find(z=>view.x>=z.rect[0]&&view.x<z.rect[0]+z.rect[2]&&view.y>=z.rect[1]&&view.y<z.rect[1]+z.rect[3]);
    const info=world.info();hud.text('status',`DUST2 / ${zone?.name??'WORLD'} · height ${Math.round(view.h-48)} · speed ${Math.round(Math.hypot(motion.vx,motion.vy))} · ${motion.grounded?'GROUND':'AIR'} · ${gpu?'GPU':'CPU'}`);
    hud.text('stats',`${info.visibleCells}/${info.cells} cells · ${info.visibleSurfaces}/${info.surfaces} surfaces · ${info.lights} lights · ${info.frameMs.toFixed(2)} ms`);
});
$.render(()=>world.render(view,800,450));
$.exit(()=>{$.window.mouseLock(false);world.dispose();});
