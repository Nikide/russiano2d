const base='demos/re2d_world_renderer_lab/acceptance/',textures='demos/re2d_world_renderer_lab/';
let time=0,closed=false,debugIndex=0;
globalThis.acceptanceMoving=true;
const modes=['final','cell-id','span-id','depth','owner','light-level','dynamic-light-count','normal','emissive','bsp','portals','shadow-mask','overdraw'];
$.ready(()=>{
    $.world.gravity(0,0).color('#14202c');
    globalThis.world=$.re2dWorld.load(base+'acceptance.re2dworld').backend('gpu');
    world.material('brick',{albedo:textures+'brick.png',normal:textures+'brick_n.png'});
    world.material('floor',{albedo:textures+'floor.png'});
    world.material('panel',{albedo:textures+'panel.png',emissive:textures+'panel_e.png',emissiveStrength:1.3,uScale:1/60,vScale:1/68});
    world.material('glass',{albedo:textures+'floor.png',blend:'translucent',opacity:.35});
    const source=JSON.parse($.fs.readText(base+'acceptance.re2dmap')),compiled=JSON.parse($.fs.readText(base+'acceptance.re2dworld')),info=world.info();
    for(let i=0;i<info.walls;i++)world.surface(i).material('brick');
    for(let i=0;i<source.walls.length;i++){const tag=source.walls[i].tag;if(tag==='panel')world.surface(i).material('panel');if(tag==='glass')world.surface(i).material('glass');}
    for(let i=0;i<info.spans;i++)world.surface(info.walls+2*i).material('floor');
    globalThis.lower=$.re2dSprite.from(base+'pig.character.json',{id:'acceptance-lower-pig'}).re2dStyle('anime').at(350,120).depth(0).size(74,70).rotMotion('walk',0).hide();
    globalThis.upper=$.re2dSprite.from(base+'pig.character.json',{id:'acceptance-upper-pig'}).re2dStyle('anime').at(350,120).depth(160).size(74,70).rotMotion('walk',0).hide();
    globalThis.third=$.re2dSprite.from('demos/rotsprite/russi.character.json').re2dStyle('anime').at(650,120).depth(0).size(65,90).rotMotion('idle',0).hide();
    globalThis.weapon=$.re2dSprite.equip(lower,'ak47').re2dStyle('anime').hide();
    world.add(lower).add(upper).add(third);
    globalThis.movingLamp=world.light({x:340,y:120,h:208,radius:160,intensity:1.2,color:'#ff3020',shadow:true});
    globalThis.flash=()=>world.light({x:lower.get(0).x-28,y:120,h:45,radius:200,intensity:3,color:'#ffbf70',shadow:true}).life(.12);
    globalThis.view={x:70,y:120,h:48,yaw:0,pitch:0,fov:70,near:1};
    globalThis.hud=$.ui.doc(base+'hud.rml').show();
    globalThis.acceptanceViews={corridor:[70,120,48,0],upper:[70,120,208,0],bridge:[350,190,128,-90],fog:[510,120,48,0],stairs:[680,120,48,0],ramp:[120,600,48,-90],window:[520,120,48,-45]};
    globalThis.acceptanceCamera=name=>{const c=acceptanceViews[name];Object.assign(view,{x:c[0],y:c[1],h:c[2],yaw:c[3],pitch:0});};
});
$.update(dt=>{
    if($.input.pressed('escape'))$.quit();
    const names=Object.keys(acceptanceViews);for(let i=0;i<names.length;i++)if($.input.pressed(String(i+1)))acceptanceCamera(names[i]);
    if($.input.pressed('o'))world.portalClosed(0,closed=!closed);
    if($.input.pressed('space'))flash();
    if($.input.pressed('m'))acceptanceMoving=!acceptanceMoving;
    if($.input.pressed('f2'))world.debug.view(modes[debugIndex=(debugIndex+1)%modes.length]);
    if($.input.pressed('e'))view.h=view.h<128?208:48;
    time+=dt;if(acceptanceMoving)movingLamp.at(350+Math.sin(time)*35,120);
    view.yaw+=$.input.axis('left','right')*dt*85;view.pitch=Math.max(-70,Math.min(70,view.pitch+$.input.axis('down','up')*dt*60));
    const m=$.input.vec('wasd'),a=view.yaw*Math.PI/180,dx=(-m.y*Math.cos(a)-m.x*Math.sin(a))*Math.min(dt,.04)*110,dy=(-m.y*Math.sin(a)+m.x*Math.cos(a))*Math.min(dt,.04)*110;
    const move=(dx,dy)=>{let s=world.support(view.x+dx,view.y+dy,view.h-48,64,9);const d=Math.hypot(dx,dy);if(d)for(const sign of [-1,1]){const q=world.support(view.x+dx+sign*dx/d*8,view.y+dy+sign*dy/d*8,view.h-48,64,9);if(q&&s&&q.height>s.height)s=q;}if(s&&!world.blocked(view.x+dx,view.y+dy,6,s.height,s.height+64)){view.x+=dx;view.y+=dy;view.h=s.height+48;return true;}return false;};
    if(!move(dx,dy)){move(dx,0);move(0,dy);}
    const i=world.info();hud.text('status',`FINAL LAB · ${i.visibleCells}/${i.cells} cells · ${i.visibleSurfaces}/${i.surfaces} surfaces · ${i.lightsAfterCull}/${i.lights} lights · ${modes[debugIndex]}`);
});
$.render(()=>world.render(view,480,270));
