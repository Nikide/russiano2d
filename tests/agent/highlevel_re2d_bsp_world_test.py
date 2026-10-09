#!/usr/bin/env python3
"""Height queries, RGBA synthesis, ordinary 2D batching and Re2DSprite coverage."""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
sys.path.insert(0, os.path.dirname(__file__))
from agent_client import Agent
from re2d_native_test import decode
FAILED = []

def check(ok, message):
    print(('  ok   ' if ok else '  FAIL ') + message)
    if not ok:
        FAILED.append(message)

def pixels(a, name):
    path = os.path.join('build', 'test_re2d_bsp_' + name + '.png')
    a.screenshot(path)
    _, _, bpp, rows = decode(path)
    return [tuple(row[x:x+3]) for row in rows for x in range(0, len(row), bpp)]

def main():
    with Agent(game='tests/fixtures/re2d_bsp_world', seed=5) as a:
        a.step(2)
        check(a.eval('world.info().spans') == 2, 'identical XY retains both storeys')
        check(a.eval('world.support(0,0,0,64).height') == 0, 'lower walkable support')
        check(a.eval('world.support(0,0,160,64).height') == 160, 'upper walkable support')
        check(a.eval('world.support(0,0,160,140)') is None, 'insufficient headroom rejected')
        check(a.eval('world.blocked(100,0,8,0,64)') is True, 'railing blocks lower actor')
        check(a.eval('world.blocked(100,0,8,160,224)') is False, 'same XY upper actor passes over railing')
        check(a.eval('world.ray({x:0,y:0,height:40},{x:200,y:0,height:40}).wall') == 8, 'gameplay ray hits railing')
        check(a.eval('world.ray({x:0,y:0,height:200},{x:200,y:0,height:200})') is None, 'upper ray ignores lower railing')
        check(a.eval('world.ray({x:0,y:0,height:200},{x:0,y:0,height:150}).height') == 160, 'vertical ray hits upper support')
        a.eval('drawModels=false')
        background = pixels(a, 'background')
        a.eval('drawModels=true')
        far = pixels(a, 'far')
        check(far != background, 'Re2DSprite head visible above railing')
        # Red railing area must be unchanged by the far character.
        rail = [i for i, c in enumerate(background) if c[0] > 150 and c[1] < 100 and c[2] < 100]
        check(len(rail)>10000 and all(far[i]==background[i] for i in rail), 'railing occludes far character per pixel')
        check(a.eval('engine.depthInfo().meshVerts') == 0, 'World submits no world triangles to GPU')
        a.eval("view.projection='orthographic';view.orthoHeight=300")
        ortho = pixels(a, 'orthographic')
        check(ortho != far, 'same primitives synthesize a different orthographic projection')
        a.eval("view.projection='perspective';view.pitch=25")
        tilted = pixels(a, 'tilted')
        check(tilted != far, 'perspective pitch changes real projection')
        a.eval('view.pitch=0')
        a.eval('npc.at(50,0)')
        near = pixels(a, 'near')
        check(any(near[i] != background[i] for i in rail), 'near character occludes railing')
        a.eval('npc.at(170,0); hero.depth(160); npc.depth(160)')
        a.step(2)
        upper = pixels(a, 'upper')
        check(not any(c[0]>150 and c[1]<100 and c[2]<100 for c in upper), 'upper view sees no lower railing through its floor')
        check(a.eval('view.eye') == 208, 'camera eye follows selected support height')
        check(a.eval('''(()=>{
            const h=npc.get(0).rot_sprite.handle;
            const w=engine.re2d.worldCreate(new Float32Array(0),new Float32Array(0));
            engine.re2d.view(0,0,48,0,0,1);
            const revision=()=>engine.rotSpriteInfo(h).revision;
            const start=revision();
            try {
                engine.rotSpritePrepare(h,10,0);engine.rotSpritePrepare(h,20,0);
                if(revision()!==start)return false;
                w.frame(320,180,[h],new Float32Array([170,0,0,96,96]));
                if(revision()!==start+1)return false;
                engine.rotSpritePrepare(h,30,0);
                w.frame(320,180,[h],new Float32Array([-170,0,0,96,96]));
                if(revision()!==start+1)return false;
                engine.rotSpritePose(h,30,0);
                if(revision()!==start+2)return false;
                try {w.frame(320,180,[{}],new Float32Array([-170,0,0,96,96]));return false} catch(e) {}
                return true;
            } finally {w.dispose()}
        })()'''), 'World coalesces poses, defers off-screen synthesis, preserves immediate Pose and validates culled handles')
        a.eval("npc.angle(Math.PI-.7).re2dLayer('holdRifle')")
        a.step(2)
        unarmed = pixels(a, 'unarmed')
        a.eval("globalThis.weapon=$.re2dSprite.equip(npc,'ak47').hide()")
        a.step(2)
        armed = pixels(a, 'armed')
        check(armed != unarmed, 'existing equip/socket attachment is composed')
        check(a.eval('weapon.get(0).rot_sprite.attachment.parent === npc.get(0)') is True, 'attachment remains owned by existing component API')
        a.eval('view.x=40; hero.at(40,0); view.pitch=20; view.yaw=15')
        a.step(2)
        check(a.eval('$.re2dSprite.info(npc).yaw') is not None, 'relative pose still synthesised through existing Re2DSprite API')
        # Invalid authoring and native input must throw, not corrupt live World.
        for expression, label in [
            ("engine.re2d.worldCreate(new Uint32Array(9),new Float32Array(0))", 'wrong typed array rejected'),
            ("engine.re2d.worldCreate(new Float32Array(8),new Float32Array(0))", 'partial wall record rejected'),
            ("$.re2d.world({cells:[{x:0,y:0,w:10,h:10,spans:[{bottom:0,top:10},{bottom:5,top:15}]}]})", 'overlapping free spans rejected'),
            ("world.support(0,0,0,-1)", 'invalid actor height rejected'),
        ]:
            check(a.eval('(()=>{try{'+expression+';return false}catch(e){return true}})()'), label)
        check(a.eval('world.info().spans') == 2, 'live world survives rejected inputs')
        check(a.eval('(()=>{engine.re2d.view(0,0,48,1e300,0,1);try{const w=engine.re2d.worldCreate(new Float32Array(0),new Float32Array(0));try{w.frame(8,8);return false}catch(e){return true}finally{w.dispose()}}finally{engine.re2d.view(0,0,48,0,0,1)}})()'), 'malformed legacy camera rejected before World synthesis')
        check(a.eval('(()=>{const w=engine.re2d.worldCreate(new Float32Array(0),new Float32Array(0));w.frame(16,16);w.frame(32,8);w.dispose();w.dispose();try{w.info();return false}catch(e){return true}})()'), 'resize/dispose is safe and stale handle rejected')
        a.key('w', 'down'); a.step(120); a.key('w', 'up')
        check(a.eval('hero.get(0).x') > 110, 'ordinary gameplay component walks above railing')
        check('ошибка в' not in a.stderr_tail(), 'no script errors in demo')
    return 1 if FAILED else 0

if __name__ == '__main__':
    raise SystemExit(main())
