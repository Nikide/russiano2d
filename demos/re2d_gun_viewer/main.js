// Gun viewer: every weapon is a Re2DSprite; yaw/pitch come from the sprite's own projection.
const GUNS=['ak47','pistol','revolver','shotgun','smg','sniper','lmg'];
const LENGTH={ak47:46,pistol:13,revolver:16,shotgun:48,smg:30,sniper:56,lmg:52};
let node=null,current=0;
function show(name,yaw,pitch,px){
    if(node)node.remove();
    const size=128.4*(px||900)/(LENGTH[name.replace('_fp','')]||62);
    node=$.re2dSprite.from('demos/rotsprite/weapons/'+name+'.character.json').re2dStyle('anime').at(800,450).size(size,size).re2dPose(yaw,pitch);
    globalThis.gunName=name;
}
$.ready(()=>{$.world.gravity(0,0).color('#2a2e38');$.camera.at(800,450);globalThis.showGun=show;show('ak47',0,0);});
$.update(dt=>{
    if($.input.pressed('right')){current=(current+1)%GUNS.length;show(GUNS[current],0,0);}
    if($.input.pressed('left')){current=(current+GUNS.length-1)%GUNS.length;show(GUNS[current],0,0);}
    if($.input.pressed('escape')||$.input.pressed('q'))$.quit();
});
// Held-gun check: Russi with equipment + the hold clip from her own equipment definition.
globalThis.showHeld=(key,yaw,pitch)=>{
    if(node)node.remove();
    if(globalThis.heldWeapon)globalThis.heldWeapon.remove();
    const hero=$.re2dSprite.from('demos/rotsprite/russi.character.json',{id:'viewer-hero'}).re2dStyle('anime').at(800,470).size(720,720).re2dPose(yaw,pitch);
    const eq=$.re2dSprite.definition(hero).equipment[key];
    hero.re2dMotion(eq.pose,0);
    globalThis.heldWeapon=$.re2dSprite.equip(hero,key,{id:'viewer-weapon'});
    node=hero;
};
// v3: плотные модели (контейнер сетки + скелетные клипы)
globalThis.showV3=(path,yaw,pitch,px,motion,time)=>{
    if(node)node.remove();
    node=$.re2dSprite.from(path).at(800,450).size(px||1000,px||1000).re2dPose(yaw,pitch);
    if(motion)node.re2dMotion(motion,0).re2dSeek(time||0);
    globalThis.v3node=node;
};
