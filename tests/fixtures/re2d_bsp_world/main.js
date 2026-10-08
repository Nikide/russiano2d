// Gameplay is ordinary nodes and scripts; World owns no Player/Enemy classes.
export const description = {
    cells: [{ x:-200, y:-200, w:600, h:400, spans:[
        { bottom:0, top:128, floorColor:'#305840', ceilingColor:'#233540' },
        { bottom:160, top:288, floorColor:'#544030', ceilingColor:'#344858' },
    ] }],
    walls: [],
};
for (const bottom of [0,160]) {
    for (const [from,to] of [[[-200,-200],[400,-200]],[[400,-200],[400,200]],[[400,200],[-200,200]],[[-200,200],[-200,-200]]])
        description.walls.push({from,to,bottom,top:bottom+128,color:'#648090'});
}
// A low railing on the lower floor; upper-floor entities pass over the same XY.
description.walls.push({from:[100,-70],to:[100,70],bottom:0,top:60,color:'#c83c28'});
$.ready(() => {
    $.world.gravity(0,0).color('#101820');
    globalThis.world = $.re2d.world(description);
    globalThis.hero = $('<player>', { id:'world-player' }).body(null).at(0,0).depth(0).hide();
    globalThis.npc = $.re2dSprite.from('demos/rotsprite/russi.character.json', {id:'world-npc'})
        .re2dStyle('pixel').at(170,0).size(96,96).depth(0).angle(Math.PI).hide();
    globalThis.view = {x:0,y:0,eye:48,yaw:0,pitch:0,fov:70};
    globalThis.drawModels = true;
    globalThis.hud = $.ui.doc('demos/re2d_bsp_world/hud.rml').show();
});
$.update(dt => {
    if ($.input.pressed('e')) {
        const floor = hero.get(0).depth === 0 ? 160 : 0;
        hero.depth(floor); npc.depth(floor);
    }
    if ($.input.pressed('escape')) $.quit();
    view.yaw += $.input.axis('left','right') * dt * 90;
    view.pitch = Math.max(-80,Math.min(80,view.pitch + $.input.axis('down','up') * dt * 60));
    const move = (() => {
        const input=$.input.vec('wasd'),a=view.yaw*Math.PI/180;
        return {x:(-input.y*Math.cos(a)-input.x*Math.sin(a))*dt*90,
            y:(-input.y*Math.sin(a)+input.x*Math.cos(a))*dt*90};
    })();
    // Small gameplay substeps plus height-aware native circle queries.
    const n=Math.max(1,Math.ceil(Math.hypot(move.x,move.y)/4)),h=hero.get(0);
    for(let i=0;i<n;i++) {
        let x=h.x+move.x/n,y=h.y+move.y/n;
        if(world.support(x,h.y,h.depth,64,8) && !world.blocked(x,h.y,8,h.depth,h.depth+64)) hero.at(x,h.y);
        if(world.support(h.x,y,h.depth,64,8) && !world.blocked(h.x,y,8,h.depth,h.depth+64)) hero.at(h.x,y);
    }
    view.x=h.x;view.y=h.y;view.eye=h.depth+48;
    hud.text('floor',`Этаж ${h.depth===0?1:2} · WASD ходьба · стрелки взгляд · E смена этажа · Esc выход`);
});
$.render(() => world.render(view,drawModels ? npc : [],320,180));
