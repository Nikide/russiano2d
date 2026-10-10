// Lab stage 1: native topology, portal windows, classic/dynamic reference lighting.
// Renderer state/queues/actor poses stay native; gameplay only configures handles.
let closed=false,dynamic=true;
$.ready(() => {
    $.world.gravity(0,0).color('#101820');
    globalThis.world=$.re2dWorld.load('demos/re2d_world_renderer_lab/lab.re2dworld');
    world.material('brick',{albedo:'demos/re2d_world_renderer_lab/brick.png',normal:'demos/re2d_world_renderer_lab/brick_n.png'});
    world.material('floor',{albedo:'demos/re2d_world_renderer_lab/floor.png'});
    world.material('panel',{albedo:'demos/re2d_world_renderer_lab/panel.png',emissive:'demos/re2d_world_renderer_lab/panel_e.png',emissiveStrength:1.3,uScale:1/60,vScale:1/62});
    for(const surface of [0,1,2,3,4,5,6,7])world.surface(surface).material('brick');
    world.surface(8).material('panel');
    const planes=world.info().walls;
    for(const span of [0,1,2,3])world.surface(planes+span*2).material('floor');
    world.lighting({mode:'classic',dynamic:true,shadows:true,distanceScale:.001});
    world.span(0).lighting({level:.35,color:'#c2d2ec'});
    world.span(1).lighting({level:.28,color:'#f1d8b0'});
    world.span(2).lighting({level:.15,color:'#ccceda'}).fog({color:'#142a49',density:.002,start:100});
    world.span(3).lighting({level:.12,color:'#e7c0b0'});
    globalThis.lowerLamp=world.light({x:330,y:0,h:70,radius:250,intensity:2,color:'#ff4d24',shadow:true});
    globalThis.upperLamp=world.light({x:330,y:0,h:230,radius:220,intensity:2,color:'#ff2020',shadow:true});
    globalThis.lower=$.re2dSprite.from('demos/rotsprite/russi.character.json',{id:'lab-lower'})
        .re2dStyle('anime').at(340,0).depth(0).size(80,96).angle(Math.PI).hide();
    globalThis.upper=$.re2dSprite.from('demos/rotsprite/russi.character.json',{id:'lab-upper'})
        .re2dStyle('anime').at(340,0).depth(160).size(80,96).angle(Math.PI).hide();
    world.add(lower).add(upper);
    globalThis.view={x:60,y:0,h:48,yaw:0,pitch:0,fov:70,near:1};
    globalThis.hud=$.ui.doc('demos/re2d_world_renderer_lab/hud.rml').show();
});
$.update(dt => {
    if($.input.pressed('escape'))$.quit();
    if($.input.pressed('o')){closed=!closed;world.portalClosed(0,closed);}
    if($.input.pressed('e'))view.h=view.h<128?208:48;
    if($.input.pressed('l')){dynamic=!dynamic;world.lighting({mode:'classic',dynamic,shadows:true,distanceScale:.001});}
    if($.input.pressed('p'))view.projection=view.projection==='orthographic'?'perspective':'orthographic';
    view.yaw+=$.input.axis('left','right')*dt*80;
    view.pitch=Math.max(-75,Math.min(75,view.pitch+$.input.axis('down','up')*dt*60));
    const move=$.input.vec('wasd'),angle=view.yaw*Math.PI/180;
    const x=view.x+(-move.y*Math.cos(angle)-move.x*Math.sin(angle))*dt*70;
    const y=view.y+(-move.y*Math.sin(angle)+move.x*Math.cos(angle))*dt*70;
    if(world.support(x,y,view.h-48,64,8)&&!world.blocked(x,y,6,view.h-48,view.h+16)){view.x=x;view.y=y;}
    const s=world.info();hud.text('status',`Native Re2D lab · ${s.visibleCells}/${s.cells} cells · ${s.visibleSurfaces}/${s.surfaces} surfaces · ${s.lightSpanPairs} light/span pairs · door ${closed?'closed':'open'}`);
});
$.render(() => world.render(view,400,240));
