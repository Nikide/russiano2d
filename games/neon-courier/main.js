// Игра = код + открытые данные; SDK не требуется при запуске.
let hud, menu, hero, pickups = [], drones = [], fx;
let phase = 'menu', hp = 3, score = 0, remaining = 75, elapsed = 0, shield = 0;
const spawn = { x: 110, y: 330 };
const parcels = [[220,180],[440,180],[740,180],[820,480],[580,480],[300,480]];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rect = (x,y,w,h,color,id) => $('<rect>', id ? { id } : {}).at(x,y).size(w,h).color(color).appendTo($.world);

function panel(title, message, button) {
    menu.text('title', title).text('message', message).text('play', button).show();
}
function updateHud() {
    hud.text('score', score + ' / 6').text('health', 'ЩИТ ' + hp + ' / 3').text('time', Math.ceil(remaining) + ' сек');
    hud.text('status', phase === 'playing' ? 'Соберите все посылки и вернитесь на базу' : phase === 'paused' ? 'Пауза' : 'НЕОНОВЫЙ КУРЬЕР');
}
function reset() {
    pickups.forEach(p => p.node.remove());
    pickups = parcels.map(([x,y],i) => ({ x,y, collected:false,
        node:rect(x,y,20,20,'#ffc96b','parcel-'+i).angle(Math.PI/4) }));
    hp=3;score=0;remaining=75;elapsed=0;shield=0;
    hero.at(spawn.x,spawn.y).color('#7fffe0');
    phase='playing';menu.hide();updateHud();
}
function finish(won, reason) {
    phase=won?'won':'lost';
    panel(won?'Доставка завершена!':'Рейс прерван',won?'Все шесть посылок на базе. Осталось '+Math.ceil(remaining)+' секунд.':reason,'Ещё один рейс');
    updateHud();
}
function togglePause() {
    if(phase==='playing') { phase='paused';panel('Рейс на паузе','Escape или кнопка ниже — продолжить.','Продолжить'); }
    else if(phase==='paused') {phase='playing';menu.hide();}
    updateHud();
}
$.ready(() => {
    $.gfx.color('#080e1c');$.world.gravity(0,0);$.camera.at(480,320);
    const bindings=$.fs.readJSON('controls.input.json');
    for(const name of Object.keys(bindings.actions)) $.input.bind(name,bindings.actions[name]);
    rect(480,330,860,440,'#101e30');
    for(let x=60;x<=900;x+=40) rect(x,330,1,440,'#192d40');
    for(let y=110;y<=550;y+=40) rect(480,y,860,1,'#192d40');
    rect(480,110,860,3,'#315b70');rect(480,550,860,3,'#315b70');
    rect(50,330,3,440,'#315b70');rect(910,330,3,440,'#315b70');
    rect(110,330,74,86,'#164b4b');rect(110,330,54,66,'#20685d');
    rect(110,330,34,46,'#2c8976');
    // Полосы предупреждения обозначают маршруты дронов.
    [350,620].forEach((x,i)=> {
        rect(x,330,46,400,'#301d35');
        const node=rect(x,200,32,32,'#ff6e91','drone-'+i).angle(Math.PI/4);
        drones.push({x,y:200,node,offset:i*Math.PI});
    });
    hero=rect(spawn.x,spawn.y,24,24,'#7fffe0','hero');
    fx=$('<particles>',$.fs.readJSON('pickup.particles.json')).at(110,330).appendTo($.world);
    hud=$.ui.doc('ui/hud.rml').show();menu=$.ui.doc('ui/menu.rml').show();
    menu.on('play','click',()=>phase==='paused'?togglePause():reset());
    menu.on('quit','click',()=>$.quit());
    hud.on('pause','click',togglePause);
    panel('Неоновый курьер','Соберите 6 золотых посылок и вернитесь на зелёную базу. Избегайте розовых дронов. На рейс — 75 секунд.','Начать рейс');
    updateHud();
    const privateApiHidden = typeof globalThis.engine === 'undefined';
    $.agent.expose('courier',()=>({phase,hp,score,remaining,elapsed,shield,privateApiHidden,player:hero.pos(),
        parcels:pickups.map(p=>({x:p.x,y:p.y,collected:p.collected})),drones:drones.map(d=>({x:d.x,y:d.y}))}));
});
$.update(dt=> {
    if(!hero)return;
    if($.input.pressed('restart'))reset();
    if($.input.pressed('pause'))togglePause();
    if(phase!=='playing')return;
    elapsed+=dt;remaining=Math.max(0,remaining-dt);shield=Math.max(0,shield-dt);
    if(remaining<=0){finish(false,'Время вышло. Попробуйте более короткий маршрут.');return;}
    let dx=$.input.axis('left','right'),dy=$.input.axis('up','down');
    const n=Math.hypot(dx,dy)||1,p=hero.pos();
    const x=clamp(p.x+dx/n*240*dt,70,890),y=clamp(p.y+dy/n*240*dt,130,530);
    hero.at(x,y).color(shield>0 && Math.floor(elapsed*12)%2?'#ffffff':'#7fffe0');
    for(const item of pickups) if(!item.collected && Math.hypot(x-item.x,y-item.y)<30) {
        item.collected=true;item.node.remove();score++;fx.at(x,y).burst(24);
    }
    for(const d of drones) {
        d.y=330+Math.sin(elapsed*1.7+d.offset)*165;d.node.at(d.x,d.y).angle(elapsed*1.2);
        if(shield===0 && Math.hypot(x-d.x,y-d.y)<32) {
            hp--;shield=1.5;hero.at(spawn.x,spawn.y);
            if(hp<=0){finish(false,'Щит исчерпан. Следите за маршрутами дронов.');return;}
            break;
        }
    }
    if(score===6 && Math.hypot(x-spawn.x,y-spawn.y)<40)finish(true);
    updateHud();
});
