const ATLAS = 'demos/assets/art/mascot/russi_rotsprite_v1.png';
const DOC = 'demos/rotsprite/rotsprite.rml';

export default function installRotSpriteDemo($) {
    let doc, head, yaw = 0, pitch = 0, auto = true, elapsed = 0;
    function setPose(y,p) {
        yaw = y; pitch = p; auto = false;
        if (head) head.rotPose(yaw,pitch);
    }
    function layout() {
        const s = $.window.size();
        $('#rot-atlas').at(s.w*.22,s.h*.47).size(s.h*.48,s.h*.48);
        const scale = Math.max(1,Math.floor(s.h*.65/64));
        if (head) head.at(s.w*.7,s.h*.43).size(64*scale,64*scale);
        [-45,0,45].forEach((p,i) => $('#rot-small-'+i).at(s.w*(.58+i*.12),s.h*.8).size(128,128));
    }
    $.agent.expose('rotSpriteDemo', () => ({ auto, yaw, pitch,
        head: head ? $.rotSprite.info(head) : null, atlas: ATLAS, bodyProjection: false }));
    $.scene.add('rotsprite', {
        enter() {
            yaw = pitch = elapsed = 0; auto = true;
            $.world.color('#101820');
            $.camera.at(0,0).zoom(1);
            $('<sprite>',{id:'rot-atlas',src:ATLAS});
            head = $.rotSprite.create(ATLAS,{id:'rot-head'});
            [-45,0,45].forEach((p,i) => $.rotSprite.create(ATLAS,{id:'rot-small-'+i}).rotPose(35,p));
            layout();
            doc = $.ui.doc(DOC).show();
            doc.on('front','click',() => setPose(0,0))
                .on('back','click',() => setPose(180,0))
                .on('profile','click',() => setPose(90,0))
                .on('auto','click',() => { auto = !auto; })
                .on('menu','click',() => $.scene.load('launcher'));
        },
        update(dt) {
            elapsed += dt;
            if ($.input.pressed('space')) auto = !auto;
            const dy = $.input.axis('left','right'), dp = $.input.axis('up','down');
            if (dy || dp) { auto = false; yaw += dy*dt*75; pitch += dp*dt*60; }
            if (auto) { yaw += dt*28; pitch = Math.sin(elapsed*.6)*25; }
            head.rotPose(yaw,pitch);
            const info = $.rotSprite.info(head);
            yaw = info.yaw; pitch = info.pitch;
            doc.text('pose',`yaw ${yaw.toFixed(1)}° · pitch ${pitch.toFixed(1)}° · ${auto ? 'авто' : 'ручной режим'}`);
            layout();
            if ($.input.pressed('escape')) $.scene.load('launcher');
        },
        exit() { if (doc) doc.hide(); head = null; },
    });
}
