// Data-only NPCs: ordinary Re2DSprite components, no new renderer types.
const ids=['assault','scout','heavy','sniper','medic','commander'];
const names=['Автоматчица','Разведчица','Тяжёлая штурмовичка','Снайперша','Медик','Командир'];
let yaw=0,pitch=0,auto=false,motion='idle',armed=false,hud;
globalThis.npcGallery={models:[],weapons:[],ids,names,
    pose(y,p=0){yaw=y;pitch=p;for(const n of this.models)n.re2dPose(yaw,pitch);},
    motion(name){motion=name;for(const n of this.models)n.re2dMotion(name);},
    equip(on){
        for(const n of this.weapons)n.remove();this.weapons=[];armed=on;
        for(const n of this.models){n.re2dLayer('holdRifle',on);if(on)this.weapons.push($.re2dSprite.equip(n,'ak47'));}
    },
    freeze(time=0){for(const n of this.models)n.re2dMotion(motion,0).re2dSeek(time);},
};
$.ready(()=>{
    $.world.gravity(0,0).color('#16222b');$.camera.at(600,450).zoom(1);
    hud=$.ui.doc('demos/re2d_npcs/gallery.rml').show();
    for(let i=0;i<ids.length;i++){
        const n=$.re2dSprite.from(`demos/re2d_npcs/${ids[i]}.character.json`,{id:`pig-${ids[i]}`})
            .at(200+(i%3)*400,235+Math.floor(i/3)*370).size(460,460).re2dMotion('idle');
        npcGallery.models.push(n);
    }
});
$.update(dt=>{
    if($.input.pressed('space'))auto=!auto;
    if($.input.pressed('i'))npcGallery.motion('idle');
    if($.input.pressed('w'))npcGallery.motion('walk');
    if($.input.pressed('r'))npcGallery.motion('run');
    if($.input.pressed('h'))npcGallery.motion('hit');
    if($.input.pressed('k'))npcGallery.motion('death');
    if($.input.pressed('g'))npcGallery.equip(!armed);
    if($.input.pressed('escape'))$.quit();
    const delta=$.input.axis('left','right')*dt*90+(auto?dt*35:0);
    const tilt=$.input.axis('down','up')*dt*45;
    if(delta||tilt)npcGallery.pose(yaw+delta,Math.max(-65,Math.min(65,pitch+tilt)));
    hud.text('status',`6 NPC · yaw ${Math.round(yaw%360)} · pitch ${Math.round(pitch)} · ${motion} · ${armed?'АК на сокете':'без оружия'}`);
});
