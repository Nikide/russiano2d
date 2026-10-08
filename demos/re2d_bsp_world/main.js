// The World synthesises 2D; entities, weapon and combat remain game scripts.
const CHARACTER='demos/rotsprite/russi.character.json';
export const description={cells:[],walls:[]};
for(const [x,y,w,h] of [[-240,-180,400,360],[360,-220,320,220],[360,0,320,220]])
    description.cells.push({x,y,w,h,spans:[
        {bottom:0,top:128,floorColor:'#375647',ceilingColor:'#243746'},
        {bottom:160,top:288,floorColor:'#564230',ceilingColor:'#344858'},
    ]});
// The corridor is an actual chain of eight support steps connecting storeys.
for(let i=0;i<8;i++) description.cells.push({x:160+i*25,y:-60,w:25,h:120,spans:[
    {bottom:(i+1)*20,top:288,floorColor:i%2?'#64543d':'#736348',ceilingColor:'#344858'},
]});
const outline=[[-240,-180],[160,-180],[160,-60],[360,-60],[360,-220],[680,-220],
    [680,220],[360,220],[360,60],[160,60],[160,180],[-240,180]];
for(let i=0;i<outline.length;i++) description.walls.push({from:outline[i],to:outline[(i+1)%outline.length],bottom:0,top:288,color:i%2?'#587386':'#78919a'});
// A partition separates the two rooms, leaving an entrance by the landing.
description.walls.push({from:[430,0],to:[680,0],bottom:0,top:288,color:'#96785c'});
// Low railing in the foyer: it occludes lower targets and can be walked around.
description.walls.push({from:[70,-65],to:[70,65],bottom:0,top:60,color:'#b64830'});
for(let i=0;i<8;i++) description.walls.push({from:[160+i*25,-60],to:[160+i*25,60],bottom:i*20,top:(i+1)*20,color:'#4f4030'});
const SPAWNS=[[-100,100,0],[120,110,0],[550,-110,160],[550,110,160]];
let shotTime=0,reloadTime=0,flash=0,message='';
let shots=0,kills=0,magazine=30,lastHit=null,shotSound,reloadSound;
let drawWeapon=true,mouseLocked=false;
const RANGE=1800,DAMAGE=34;

// Circle on XY × vertical interval, never a mesh collider.
function targetFraction(node,origin,delta) {
    let lo=0,hi=1;
    const dx=origin.x-node.x,dy=origin.y-node.y,r=20;
    const a=delta.x*delta.x+delta.y*delta.y,b=2*(dx*delta.x+dy*delta.y),c=dx*dx+dy*dy-r*r;
    if(a<1e-9) {if(c>0)return null;}
    else {
        const disc=b*b-4*a*c;if(disc<0)return null;
        lo=Math.max(lo,(-b-Math.sqrt(disc))/(2*a));hi=Math.min(hi,(-b+Math.sqrt(disc))/(2*a));
    }
    const bottom=Number(node.depth)||0,top=bottom+node.h;
    if(Math.abs(delta.height)<1e-9) {if(origin.height<bottom||origin.height>top)return null;}
    else {
        const t0=(bottom-origin.height)/delta.height,t1=(top-origin.height)/delta.height;
        lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));
    }
    return lo<=hi?lo:null;
}
function muzzleOnScreen() {
    const info=$.re2dSprite.info(ak),m=info.sockets.muzzle.matrix;
    // Socket in the same synth pose as the viewmodel. Used for muzzle flash.
    const yaw=info.yaw*Math.PI/180,pitch=info.pitch*Math.PI/180;
    const x=Math.cos(yaw)*m[3]+Math.sin(yaw)*m[11];
    const z=-Math.sin(yaw)*m[3]+Math.cos(yaw)*m[11];
    const y=Math.cos(pitch)*m[7]-Math.sin(pitch)*z;
    const scale=holder.get(0).rot_sprite.modelPose.scale;
    return {x:engine.width*.90+x*scale*(1400/128),y:engine.height*.84+y*scale*(1400/128)};
}
function fire() {
    if(shotTime>0||reloadTime>0)return false;
    if(magazine===0){message='Магазин пуст — R перезарядить';return false;}
    magazine--;shots++;shotTime=.11;flash=.045;
    if(shotSound>=0) $.sound.play(shotSound,{volume:.35});
    const yaw=view.yaw*Math.PI/180,pitch=view.pitch*Math.PI/180;
    const origin={x:view.x,y:view.y,height:view.eye};
    const delta={x:Math.cos(yaw)*Math.cos(pitch)*RANGE,y:Math.sin(yaw)*Math.cos(pitch)*RANGE,height:Math.sin(pitch)*RANGE};
    const to={x:origin.x+delta.x,y:origin.y+delta.y,height:origin.height+delta.height};
    const obstruction=world.ray(origin,to);
    let best=obstruction?obstruction.fraction:1,target=null;
    for(const wrapper of npcs) {
        const node=wrapper.get(0);if(!wrapper.alive())continue;
        const t=targetFraction(node,origin,delta);
        if(t!==null&&t<best){best=t;target=wrapper;}
    }
    if(target) {
        target.damage(DAMAGE,hero).re2dEmotion('surprised');
        lastHit={target:target.get(0).id,fraction:best,wall:null};
        if(!target.alive()) {kills++;target.attr('state','dead').re2dEmotion('sleepy');message='Попадание · маскот выбыл';}
        else {target.attr('state','hit');message=`Попадание · HP ${target.hp()}`;}
    } else {
        lastHit={target:null,fraction:best,wall:obstruction?.wall??null};
        message=obstruction?'Выстрел остановлен поверхностью':'Промах';
    }
    return true;
}
function resetTargets() {
    npcs.forEach((n,i)=>n.health(100).at(SPAWNS[i][0],SPAWNS[i][1]).depth(SPAWNS[i][2]).attr('state','idle').re2dEmotion('neutral'));
    kills=0;message='Маскоты восстановлены';
}
$.ready(()=>{
    $.world.gravity(0,0).color('#101820');
    globalThis.world=$.re2d.world(description);
    globalThis.drawTargets=true;
    globalThis.hero=$('<player>',{id:'world-player'}).body(null).at(-130,0).depth(0).hide();
    globalThis.npcs=SPAWNS.map(([x,y,z],i)=>$.re2dSprite.from(CHARACTER,{id:'russi-'+i})
        .re2dStyle('anime').at(x,y).size(96,96).depth(z).angle(Math.PI).health(100).attr('state','idle').hide());
    globalThis.view={x:-130,y:0,eye:48,yaw:0,pitch:0,fov:70};
    // AK is the existing equipment model attached to the existing hand socket.
    globalThis.holder=$.re2dSprite.from(CHARACTER,{id:'weapon-holder'}).re2dStyle('anime')
        .re2dLayer('holdRifle').re2dPose(220,-12).hide();
    holder.re2dVisibleParts($.re2dSprite.definition(holder).rig.parts.filter(p=>['armLeft','armRight','forearmLeft','forearmRight'].includes(p.bone)).map(p=>p.id));
    mouseLocked=true;$.window.mouseLock(true);
    globalThis.ak=$.re2dSprite.equip(holder,'ak47',{id:'player-ak'}).re2dStyle('anime').hide();
    shotSound=engine.audio.load('demos/assets/audio/sfx/shoot_01.ogg');
    reloadSound=engine.audio.load('demos/assets/audio/sfx/reload.ogg');
    globalThis.hud=$.ui.doc('demos/re2d_bsp_world/hud.rml').show();
    globalThis.combat={fire,reset:resetTargets,state:()=>({shots,kills,magazine,reloading:reloadTime>0,lastHit,drawWeapon,mouseLocked})};
    $.agent.expose('re2dBspDemo',()=>({combat:combat.state(),player:{...hero.pos(),height:hero.get(0).depth},targets:npcs.map(n=>({id:n.get(0).id,hp:n.hp(),state:n.attr('state')}))}));
});
$.update(dt=>{
    shotTime=Math.max(0,shotTime-dt);flash=Math.max(0,flash-dt);
    if(reloadTime>0){reloadTime=Math.max(0,reloadTime-dt);if(reloadTime===0)magazine=30;}
    if($.input.pressed('escape')) {mouseLocked=false;$.window.mouseLock(false);}
    if($.input.pressed('m')) {mouseLocked=!mouseLocked;$.window.mouseLock(mouseLocked);}
    if($.input.pressed('e')) {const h=hero.get(0),z=h.depth<128?160:0;const support=world.support(h.x,h.y,z,64,0);if(support&&support.height===z)hero.depth(z);}
    if($.input.pressed('p')) {view.projection=view.projection==='orthographic'?'perspective':'orthographic';view.orthoHeight=400;}
    if($.input.pressed('f')) resetTargets();
    if($.input.pressed('v')) drawWeapon=!drawWeapon;
    if($.input.pressed('r')&&!reloadTime&&magazine<30){reloadTime=1.2;message='Перезарядка';if(reloadSound>=0)$.sound.play(reloadSound,{volume:.35});}
    view.yaw+=$.input.axis('left','right')*dt*90;
    view.pitch=Math.max(-80,Math.min(80,view.pitch+$.input.axis('down','up')*dt*60));
    if(mouseLocked){const m=$.input.mouseDelta();view.yaw+=m.x*.14;view.pitch=Math.max(-80,Math.min(80,view.pitch-m.y*.14));}
    const input=$.input.vec('wasd'),a=view.yaw*Math.PI/180;
    const move={x:(-input.y*Math.cos(a)-input.x*Math.sin(a))*dt*110,y:(-input.y*Math.sin(a)+input.x*Math.cos(a))*dt*110};
    const n=Math.max(1,Math.ceil(Math.hypot(move.x,move.y)/4)),h=hero.get(0);
    const tryMove=(x,y)=>{
        let support=world.support(x,y,h.depth,64,24);
        // Lift the circle when its leading edge reaches an authored riser.
        const ahead=world.support(x+Math.sign(x-h.x)*8,y+Math.sign(y-h.y)*8,h.depth,64,24);
        if(support&&ahead&&ahead.height>support.height) support=ahead;
        if(support&&!world.blocked(x,y,8,support.height,support.height+64))hero.at(x,y).depth(support.height);
    };
    for(let i=0;i<n;i++){tryMove(h.x+move.x/n,h.y);tryMove(h.x,h.y+move.y/n);}
    view.x=h.x;view.y=h.y;view.eye=h.depth+48;
    if($.input.mouseDown('left')||$.input.down('space'))fire();
    hud.text('floor',`АК · ${magazine}/30 · выбыло ${kills}/${npcs.length} · высота ${h.depth} · ${message}`);
    hud.text('keys','WASD ходьба · мышь/стрелки взгляд · M переключить мышь · ЛКМ/Space огонь · R магазин · F цели · E этаж · P проекция · V оружие · Esc отпустить мышь');
});
$.render(()=>{
    world.render(view,drawTargets?npcs.filter(n=>n.alive()):[],Math.min(1024,engine.width),Math.min(1024,engine.height));
    if(drawWeapon) {
        const recoil=shotTime/.11;
        holder.re2dPose(220,-12+recoil*5);
        const arm=holder.get(0),weapon=ak.get(0);
        const draw=n=>engine.drawSprite(n.rot_sprite.sprite,engine.width*.90,engine.height*.84+recoil*12,1400,1400,0,0xffffffff);
        if(weapon.depth<arm.depth){draw(weapon);draw(arm);}else{draw(arm);draw(weapon);}
        if(flash>0){const p=muzzleOnScreen();engine.drawSprite(engine.whiteSprite,p.x,p.y,18,18,Math.PI/4,0xff75dfff);}
    }
});
$.exit(()=>{$.window.mouseLock(false);world.dispose();});
