#!/usr/bin/env python3
"""Play the scripted AK demo: wall/height occlusion, targets, stairs and reload."""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from agent_client import Agent
sys.path.insert(0, os.path.dirname(__file__))
from re2d_native_test import decode
failed = []
def step(a, frames):
    # Keep individual agent commands bounded for full window CPU synthesis.
    while frames:
        batch=min(20,frames);a.step(batch);frames-=batch
def check(ok, message):
    print(('  ok   ' if ok else '  FAIL ') + message, flush=True)
    if not ok: failed.append(message)
with Agent(game='demos/re2d_bsp_world', seed=5) as a:
    step(a, 2)
    check(a.eval('combat.state().mouseLocked'), 'relative mouse control enabled immediately')
    a.mouse_move(dx=20,dy=10);step(a, 1)
    check(abs(a.eval('view.yaw')-2.8)<.001 and abs(a.eval('view.pitch')+1.4)<.001, 'mouse delta turns FPS camera without M')
    a.eval('view.yaw=0;view.pitch=0')
    check(a.eval('$.re2dSprite.info(ak).style') == 'anime', 'viewmodel uses smooth synthesis')
    check(a.eval('world.info().width') == 800 and a.eval('world.info().height') == 600, 'world synthesis matches window without low resolution pixel upscale')
    check(a.eval('holder.get(0).rot_sprite.modelPose.records.filter(p=>p[4]).length') == 4, 'only Russi arm parts render, sockets retained')
    a.eval('holder.re2dStyle("pixel").re2dStyle("anime")')
    check(a.eval('holder.get(0).rot_sprite.modelPose.records.filter(p=>p[4]).length') == 4, 'part visibility survives style reload')
    check(a.eval('world.info().spans') == 14, 'multiroom world has stacked floors and eight stair supports')
    check(a.eval('$.re2dSprite.info(ak).attachment.socket') == 'handRight', 'AK uses existing hand socket attachment')
    a.eval('hero.at(-130,0);view.yaw=Math.atan2(100,30)*180/Math.PI')
    step(a, 1)
    for _ in range(3): a.eval('combat.fire()'); step(a, 8)
    check(a.eval('npcs[0].hp()') == 0 and a.eval('combat.state().kills') == 1, 'three hits eliminate test mascot')
    check(a.eval('npcs[0].attr("state")') == 'dead', 'dead target has gameplay state')
    a.eval('combat.reset();hero.at(0,0);view.yaw=0;npcs[1].at(120,0)')
    step(a, 1);a.eval('combat.fire()');step(a, 8)
    check(a.eval('npcs[1].hp()') == 100 and a.eval('combat.state().lastHit.wall') == 13, 'railing stops shot before target')
    a.eval('hero.depth(160)');step(a, 1);a.eval('combat.fire()');step(a, 8)
    check(a.eval('npcs[1].hp()') == 100, 'same XY lower mascot is not hit from upper storey')
    a.eval('npcs[1].depth(160)');a.eval('combat.fire()');step(a, 8)
    check(a.eval('npcs[1].hp()') == 66, 'upper shot passes above lower railing')
    a.eval('hero.at(500,-100).depth(160);npcs[3].at(500,100);view.yaw=90')
    step(a, 1);a.eval('combat.fire()');step(a, 8)
    check(a.eval('npcs[3].hp()') == 100 and a.eval('combat.state().lastHit.wall') == 12, 'room partition stops shot')
    a.eval('hero.at(140,0).depth(0);view.yaw=0')
    a.hold(['W']);step(a, 145);a.release_all()
    check(a.eval('hero.get(0).x') > 360 and a.eval('hero.get(0).depth') == 160, 'walks up actual eight steps into upper rooms')
    a.eval('combat.reset();view.yaw=-35');step(a, 1)
    a.screenshot('build/re2d_bsp_ak_rooms.png')
    with_targets=decode('build/re2d_bsp_ak_rooms.png')[3]
    a.eval('drawTargets=false')
    a.screenshot('build/re2d_bsp_no_targets.png')
    check(with_targets != decode('build/re2d_bsp_no_targets.png')[3], 'array of Re2DSprite wrappers visibly composes room mascot')
    a.eval('drawTargets=true')
    a.hold(['Space']);step(a, 210);a.release_all()
    check(a.eval('combat.state().magazine') == 0, 'automatic fire empties thirty round magazine')
    n=a.eval('combat.state().shots');a.eval('combat.fire()')
    check(a.eval('combat.state().shots') == n, 'empty magazine cannot fire')
    a.tap('R');step(a, 73)
    check(a.eval('combat.state().magazine') == 30 and not a.eval('combat.state().reloading'), 'reload restores magazine after delay')
    a.eval('combat.fire()');a.screenshot('build/re2d_bsp_ak_flash.png')
    a.tap('F');step(a, 1)
    check(a.eval('npcs.every(n=>n.hp()===100&&n.alive())') and a.eval('combat.state().kills') == 0, 'F restores all test targets')
    check(a.eval('engine.depthInfo().meshVerts') == 0, 'gameplay demo still draws ordinary 2D sprites without GPU world mesh')
    errors=[line for line in a.stderr_text().splitlines() if 'ошибка в $.' in line]
    check(not errors, 'no script callback errors')
raise SystemExit(bool(failed))
