const CHARACTER = 'demos/rotsprite/russi.character.json';
const ATLAS = 'demos/assets/art/mascot/russi_model_maid.png';
const DOC = 'demos/rotsprite/rotsprite.rml';

export default function installRe2DSpriteDemo($) {
    let doc, head, yaw=0, pitch=0, auto=true, elapsed=0, eyes='open', mouth='smile', blink=true, speaking=false;
    let body=true, motion='idle', phase=0, armLeft=0, armRight=0, drag=null, shortHair=false, headYaw=0;
    let weapon=null, equipment='none', holdPose=null;
    function cycleEquipment() {
        const names=['none','ak47','pistol','shotgun'],next=names[(names.indexOf(equipment)+1)%names.length];
        const item=next==='none'?null:$.re2dSprite.equip(head,next,{id:'rot-weapon-next'}).re2dHotReload();
        if (weapon) weapon.remove();weapon=item;equipment=next;
        if (holdPose) head.re2dLayer(holdPose,false);
        holdPose=$.re2dSprite.definition(head).equipment[next]?.pose ?? null;
        if (holdPose) head.re2dLayer(holdPose);
        $('#rot-atlas').sprite(item?$.re2dSprite.info(item).path:ATLAS);
    }
    let rect={x:0,y:0,scale:1}, emotion='neutral', brows='neutral';
    function setPose(y,p) { yaw=y;pitch=p;auto=false;head.re2dPose(yaw,pitch); }
    function expression() {
        head.re2dExpression({eyes,mouth,brows}).re2dLayer('blink',blink).re2dLayer('talk',speaking);
    }
    function cycleEyes() {const a=['open','half','closed','happy'];eyes=a[(a.indexOf(eyes)+1)%4];blink=false;}
    function cycleMouth() {const a=['closed','open','smile','talk'];mouth=a[(a.indexOf(mouth)+1)%4];speaking=false;}
    function cycleEmotion() {
        const modes=['neutral','happy','angry','sad','surprised','sleepy'];emotion=modes[(modes.indexOf(emotion)+1)%modes.length];
        head.re2dEmotion(emotion);
        const p=$.re2dSprite.info(head);eyes=['open','half','closed','happy'][p.eyes];mouth=['closed','open','smile','talk'][p.mouth];brows=['neutral','angry','sad','surprised'][p.brows];
    }
    function cycleMotion() {const a=['idle','walk','run'];motion=a[(a.indexOf(motion)+1)%3];body=true;head.re2dMotion(motion);}
    function hair() {
        shortHair=!shortHair;
        head.re2dVariant('hair',shortHair ? 'short' : 'long');
    }
    function layout() {
        const s=$.window.size();$.camera.at(s.w/2,s.h/2);
        $('#rot-atlas').at(s.w*.23,s.h*.48).size(s.h*.48,s.h*.48);
        rect={x:s.w*.7,y:s.h*.43,scale:s.h*.59/128};
        head.at(rect.x,rect.y).size(128*rect.scale,128*rect.scale);
        [-45,0,45].forEach((p,i) => $('#rot-small-'+i).at(s.w*(.58+i*.12),s.h*.76).size(128,128));
    }
    function jointScreen(j) {return {x:rect.x+(j.x-64)*rect.scale,y:rect.y+(j.y-64)*rect.scale};}
    function hands() {
        const info=$.re2dSprite.info(head),m=$.input.mouse();
        if (!body || !info.joints) return;
        if ($.input.mousePressed('left')) {
            for (const side of ['Left','Right']) {
                const j=jointScreen(info.joints['hand'+side]);
                if (Math.hypot(m.x-j.x,m.y-j.y)<28) {drag=side;auto=false;motion='idle';head.re2dMotion('idle');setPose(0,0);break;}
            }
        }
        if (!$.input.mouseDown('left')) drag=null;
        if (drag) {
            const shoulder=jointScreen($.re2dSprite.info(head).joints['shoulder'+drag]);
            const angle=(Math.atan2(m.y-shoulder.y,m.x-shoulder.x)*180/Math.PI)-90-(drag==='Left' ? 20 : -20);
            if (drag==='Left') armLeft=angle;else armRight=angle;
        }
    }
    $.agent.expose('rotSpriteDemo',() => ({auto,yaw,pitch,eyes,mouth,brows,emotion,blink,speaking,bodyProjection:body,motion,phase,armLeft,armRight,drag,shortHair,equipment,weapon:weapon ? $.re2dSprite.info(weapon) : null,
        head:head ? $.re2dSprite.info(head) : null,atlas:ATLAS}));
    const scene={
        enter() {
            yaw=pitch=elapsed=phase=armLeft=armRight=0;auto=true;eyes='open';mouth='smile';blink=true;speaking=false;
            weapon=null;equipment='none';holdPose=null;body=true;motion='idle';drag=null;headYaw=0;shortHair=false;emotion='neutral';brows='neutral';
            $.world.color('#101820');$.camera.at(0,0).zoom(1);
            $('<sprite>',{id:'rot-atlas',src:ATLAS});
            head=$.re2dSprite.from(CHARACTER,{id:'rot-head'}).re2dHotReload();
            [-45,0,45].forEach((p,i) => $.re2dSprite.from(CHARACTER,{id:'rot-small-'+i}).re2dMotion('idle',0).re2dRig({body:false}).re2dPose(35,p).re2dExpression({eyes:'open',mouth:'smile'}));
            layout();doc=$.ui.doc(DOC).show();
            doc.on('front','click',() => setPose(0,0)).on('back','click',() => setPose(180,0))
                .on('profile','click',() => setPose(90,0)).on('auto','click',() => {auto=!auto;})
                .on('emotion','click',cycleEmotion).on('eyes','click',cycleEyes).on('mouth','click',cycleMouth)
                .on('blink','click',() => {blink=!blink;}).on('talk','click',() => {speaking=!speaking;})
                .on('body','click',() => {body=!body;motion='idle';head.re2dMotion('idle');}).on('hair','click',hair)
                .on('equipment','click',cycleEquipment).on('motion','click',cycleMotion).on('reset','click',() => {armLeft=armRight=0;motion='idle';head.re2dMotion('idle');})
                .on('reload','click',() => head.re2dReload()).on('menu','click',() => $.scene.load('launcher'));
        },
        update(dt) {
            elapsed+=dt;
            if ($.input.pressed('space')) auto=!auto;
            const dy=$.input.axis('left','right'),dp=$.input.axis('up','down');
            if (dy || dp) {auto=false;yaw+=dy*dt*75;pitch+=dp*dt*60;}
            if (auto) {yaw+=dt*28;pitch=Math.sin(elapsed*.6)*(body ? 4 : 25);}
            if ($.input.pressed('v')) cycleEmotion();
            if ($.input.pressed('e')) cycleEyes();if ($.input.pressed('m')) cycleMouth();
            if ($.input.pressed('b')) blink=!blink;if ($.input.pressed('t')) speaking=!speaking;
            if ($.input.pressed('l')) cycleMotion();
            if ($.input.pressed('g')) cycleEquipment();if ($.input.pressed('h')) hair();if ($.input.pressed('r')) head.re2dReload();
            layout();hands();
            headYaw+=$.input.axis('q','w')*dt*65;
            phase=$.re2dSprite.info(head).rig.phase || 0;
            head.re2dRig({body,armLeft,armRight,headYaw}).re2dPose(yaw,pitch);
            expression();
            const info=$.re2dSprite.info(head);yaw=info.yaw;pitch=info.pitch;
            for (const side of ['Left','Right']) {
                const id='hand'+side;
                doc.style(id,'display',body ? 'block' : 'none');
                if (body && info.joints) {
                    const j=jointScreen(info.joints[id]);
                    doc.style(id,'left',`${Math.round(j.x-8)}px`).style(id,'top',`${Math.round(j.y-8)}px`)
                        .style(id,'opacity',drag===side ? '1' : '0.45');
                }
            }
            doc.text('pose',`yaw ${yaw.toFixed(1)}° · pitch ${pitch.toFixed(1)}° · ${auto ? 'авто' : 'ручной режим'}`);
            const moves={idle:'Стоит',walk:'Ходьба',run:'Бег'};
            doc.text('status',`${moves[motion]} · ${{none:'Без предмета',ak47:'АК-47',pistol:'Пистолет',shotgun:'Дробовик'}[equipment]} · PNG 4096×4096 · обновлений ${info.reloads}`);
            doc.text('error',info.reloadError || '');
            if ($.input.pressed('escape')) $.scene.load('launcher');
        },
        exit() {if (doc) doc.hide();head=null;weapon=null;},
    };
    $.scene.add('re2dsprite',scene);
    $.scene.add('rotsprite',scene); // legacy scene name
}
