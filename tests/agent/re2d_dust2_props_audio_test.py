#!/usr/bin/env python3
"""Real native crate support/depth and mixer-backed footsteps/outdoor wind."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools'))
from agent_client import Agent
failed=[];count=0
def check(ok,name):
 global count
 count+=1;print(('ok ' if ok else 'FAIL ')+name,flush=True)
 if not ok:failed.append(name)
ws=[w for w in json.loads(Path('demos/re2d_dust2/dust2.re2dmap').read_text())['walls'] if w.get('tag')=='crate']
with Agent(game='demos/re2d_dust2',seed=7) as a:
 a.step(15)
 for i in range(0,len(ws),4):
  g=ws[i:i+4];ps=[p for w in g for p in (w['from'],w['to'])];x=(min(p[0] for p in ps)+max(p[0] for p in ps))/2;y=(min(p[1] for p in ps)+max(p[1] for p in ps))/2;h=g[0]['top'];bottom=g[0]['bottom']
  ray=a.eval(f'world.ray({{x:{x},y:{y},height:{h+40}}},{{x:{x},y:{y},height:{bottom}}})')
  check(ray and not ray['ceiling'] and abs(ray['height']-h)<.001,f'crate {i//4+1} lid is a real native floor hit')
  check(a.eval(f'world.spanAt({x},{y},{(h+bottom)/2})===null&&world.support({x},{y},{h},64,0).height==={h}'),f'crate {i//4+1} has solid volume and supports standing on lid')
 wind=a.eval('dustWind.info()');check(wind['playing'] and wind['hrtf'] and not wind['occluded'] and wind['cutoff']==22000,'actual outdoor wind plays through HRTF without roof obstruction')
 a.eval('dustCamera("CLUB")');a.step(20);inside=a.eval('dustWind.info()')
 check(inside['occluded'] and inside['cutoff']==700 and abs(inside['gain']/wind['gain']-.18)<.001,'club roof muffles wind using native ceiling geometry')
 a.eval('dustCamera("TUNNELS")');a.step(20);tunnel=a.eval('dustWind.info()')
 check(tunnel['occluded'] and tunnel['gain']<wind['gain']*.2,'tunnel roof also attenuates wind')
 a.eval('dustCamera("T SPAWN")');a.step(20);outside=a.eval('dustWind.info()');check(not outside['occluded'] and outside['currentGain']>inside['currentGain'],'walking back outside restores wind level')
 before=a.eval('dustSteps.count');a.step(30);check(a.eval('dustSteps.count')==before,'stationary player makes no footsteps')
 a.hold(['W']);a.step(55);a.release_all();steps=a.eval('dustSteps.count');check(steps>=before+2 and a.eval('dustSteps.last.info().hrtf&&dustSteps.last.info().playing'),'real WASD ground movement triggers loaded positional step sounds')
 a.eval('dustCamera("T SPAWN")');a.step(20);before=a.eval('dustSteps.count');a.key('Space');a.step(2);a.hold(['W']);a.step(6);a.release_all();check(a.eval('!dustMotion.grounded&&dustSteps.count')==before,'airborne movement makes no grounded footsteps')
 a.eval('dustCamera("T SPAWN");view.x=350;view.y=300;view.h=120;view.yaw=-135;view.pitch=-35;hud.hide();world.backend("gpu")');a.step(2);a.screenshot('build/dust2_crate_lid.png')
 a.eval('dustCamera("T SPAWN");view.x=350;view.y=300;view.h=120;view.yaw=-135;view.pitch=-35;world.backend("cpu")');a.step(2);a.screenshot('build/dust2_crate_lid_cpu.png')
 from re2d_native_test import decode
 gpu=b''.join(decode('build/dust2_crate_lid.png')[3]);cpu=b''.join(decode('build/dust2_crate_lid_cpu.png')[3]);check(sum(abs(x-y)>3 for x,y in zip(gpu,cpu))/len(gpu)<.01,'actual textured crate lid agrees in CPU/GPU rendering')
print(f'{count} checks, {len(failed)} failures');sys.exit(bool(failed))
