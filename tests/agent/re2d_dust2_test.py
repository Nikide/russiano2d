#!/usr/bin/env python3
"""Dust2 reference acceptance through the public API and actual native frames."""
import json,sys,subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools'))
from agent_client import Agent
failed=[]
def check(ok,name):
 print(('ok ' if ok else 'FAIL ')+name,flush=True)
 if not ok:failed.append(name)
def main():
 compiled=Path('build/dust2-portal-regression.re2dworld')
 run=subprocess.run(['build/r2d-sdk','world-compile','demos/re2d_dust2/dust2.re2dmap','--renderer','--output',str(compiled)],capture_output=True,text=True)
 check(run.returncode==0,'current native SDK recompiles slope side portals without precision rejection')
 if run.returncode:return 1
 with Agent(game='demos/re2d_dust2',seed=7) as a:
  check(a.eval('view.x===1040&&view.y===1840&&view.h===48&&view.yaw===-90') is True,'demo starts at T spawn')
  check(a.eval('world.spanAt(1040,1840,800)!==null&&world.spanAt(1200,240,800)!==null&&world.spanAt(1360,400,800)!==null') is True,'open T, CT ramp and raised A have air space above wall tops')
  check(a.eval('world.spanAt(240,1360,800)===null&&world.spanAt(2180,1840,800)===null') is True,'tunnels and club retain closed height bounds')
  check(a.eval('(()=>{const w=$.re2dWorld.load("build/dust2-portal-regression.re2dworld");const n=w.info().portals;w.dispose();return n>157})()') is True,'fresh compiler output loads subdivided slope portals in native runtime')
  a.step(5);a.eval('world.quality({poseBudget:0,poseStep:0});world.profile({gpuWait:true});')
  info=a.eval('world.info()');check(info['cells']==313 and info['spans']==316 and info['bakedLighting'] and info['actors']==11,'compiled cells, crate solids, stacked spans, static lights and world sprites load')
  check(a.eval('dustNPCs.length===6&&dustNPCs.every(n=>n.get(0).w===72&&n.get(0).h===88)') is True,'six enlarged standing Re2DSprite NPCs populate the map')
  check(a.eval('(()=>{dustCamera("T SPAWN");for(let i=0;i<20;i++)dustPhysics(.01,{x:0,y:-1},false);const speed=Math.hypot(dustMotion.vx,dustMotion.vy);dustPhysics(.01,{x:0,y:0},false);return speed>100&&speed<=240.001&&Math.hypot(dustMotion.vx,dustMotion.vy)<speed})()') is True,'ground acceleration reaches wish speed and friction slows released movement')
  check(a.eval('(()=>{dustCamera("T SPAWN");dustPhysics(.02,{x:0,y:0},true);const airborne=!dustMotion.grounded&&view.h>48;for(let i=0;i<100;i++)dustPhysics(.01,{x:0,y:0},false);return airborne&&dustMotion.grounded&&Math.abs(view.h-48)<.01})()') is True,'jump rises and native floor ray lands without sinking')
  check(a.eval('(()=>{dustCamera("T SPAWN");dustPhysics(.02,{x:0,y:0},true);dustPhysics(.02,{x:1,y:0},false);return !dustMotion.grounded&&Math.hypot(dustMotion.vx,dustMotion.vy)>0})()') is True,'air strafing accelerates while airborne')
  a.eval('dustCamera("T SPAWN")');a.key('Space');a.step(2)
  check(a.eval('view.h>48&&!dustMotion.grounded') is True,'actual Space input triggers jump')
  a.eval('dustCamera("T SPAWN")');before=a.eval('({yaw:view.yaw,pitch:view.pitch})');a.mouse_move(dx=30,dy=-10);a.step(1)
  after=a.eval('({yaw:view.yaw,pitch:view.pitch})')
  check(after['yaw']>before['yaw'] and after['pitch']>before['pitch'],'actual relative mouse input turns yaw and pitch')
  check(a.eval('(()=>{dustCamera("T SPAWN");view.x=1040;view.y=880;let peak=0;for(let i=0;i<100;i++){dustPhysics(.01,{x:0,y:0},i===0);peak=Math.max(peak,view.h-48)}return peak>0&&peak<=32.01&&dustMotion.grounded&&Math.abs(view.h-48)<.01})()') is True,'jump respects lower mid ceiling and lands in the lower storey')
  ramps=a.eval('(()=>{const result=[];for(const [start,end] of [[[1040,240],[1360,240]],[[1200,1520],[1200,1200]],[[1840,720],[1840,360]]])for(const reverse of [false,true])for(const jumping of [false,true]){const s=reverse?end:start,t=reverse?start:end;dustCamera("T SPAWN");view.x=s[0];view.y=s[1];view.h=world.support(view.x,view.y,128,64,0).height+48;view.yaw=Math.atan2(t[1]-s[1],t[0]-s[0])*180/Math.PI;let ok=true,i=0;for(;i<600;i++){dustPhysics(1/120,{x:0,y:-1},jumping&&i%100===0);const feet=view.h-48;if(world.spanAt(view.x,view.y,feet+.02)===null){ok=false;break;}if(Math.hypot(view.x-t[0],view.y-t[1])<5)break;}result.push({start:s,end:t,jumping,ok,reached:i<600,x:view.x,y:view.y,h:view.h});}return result})()')
  for route in ramps:
   check(route['ok'] and route['reached'],f"physics ramp {route['start']} → {route['end']}, jumping={route['jumping']}: stays in a free span")
  check(a.eval('(()=>{const ramp=world.ray({x:1050,y:1320,height:64},{x:1200,y:1320,height:64}),ledge=world.ray({x:1050,y:1200,height:64},{x:1200,y:1200,height:64});return ramp&&ramp.wall>=0&&ledge&&ledge.wall>=0})()') is True,'exposed ramp and raised ledge have native solid side walls')
  a.eval('dustCamera("T SPAWN")')
  a.eval('view.x=1200;view.y=1410;view.h=72;view.yaw=-90;view.pitch=-15;hud.hide()');a.step(5)
  check(len(a.eval('world.debug.visibility().spans'))>1,'low camera on short ramp sees neighbouring spans through its sloped side')
  a.screenshot('build/dust2_ramp_view_regression.png')
  from re2d_native_test import decode
  rw,rh,_,rows=decode('build/dust2_ramp_view_regression.png')
  sample=rows[int(rh*.1)][int(rw*.01)*4:int(rw*.01)*4+3]
  check(sum(abs(sample[i]-[183,208,226][i]) for i in range(3))>30,'actual ramp frame draws the neighbouring wall instead of a sky hole')
  a.eval('hud.show();dustCamera("T SPAWN")')
  names=['T SPAWN','MID','B SITE','A SITE','LONG A','SHORT','TUNNELS'];frames=[]
  for name in names:
   a.eval('dustCamera('+json.dumps(name)+')');a.step(5)
   info=a.eval('world.info()');check(info['visibleSurfaces']>0 and a.eval('world.support(view.x,view.y,view.h-48,64,9)!==null'),'camera '+name+' renders from a supported free span')
   path=Path('build/dust2_'+name.lower().replace(' ','_')+'.png');a.screenshot(str(path));frames.append(path.read_bytes())
  check(len(set(frames))==7,'seven named routes produce distinct actual screenshots')
  # Substeps use the same gameplay movement routine as WASD, including native support and collision.
  a.eval('globalThis.walkDust=(points)=>{for(const [x,y] of points){let guard=0;while(Math.hypot(view.x-x,view.y-y)>.1){if(++guard>2000)return false;const d=Math.hypot(x-view.x,y-view.y),s=Math.min(2,d);if(!dustMove((x-view.x)/d*s,(y-view.y)/d*s))return false;}}return true;}')
  a.eval('dustCamera("T SPAWN")')
  check(a.eval('walkDust([[1040,240],[1360,240],[1360,360],[1840,360],[1840,720],[1840,1790],[1520,1790],[1520,1840]])') is True,'T → mid → CT ramp → A → long ramp → long → T is traversable without teleport')
  a.eval('dustCamera("T SPAWN")')
  check(a.eval('walkDust([[720,1840],[720,1680],[400,1680],[400,240],[1040,240]])') is True,'T → upper tunnels → B → CT is traversable without teleport')
  a.eval('dustCamera("T SPAWN")')
  check(a.eval('walkDust([[1040,1520],[1200,1520],[1200,1200],[1200,880],[1040,880]])&&view.h===176') is True,'short ramp reaches raised catwalk above mid through continuous support')
  check(a.eval('world.spanAt(1040,880,48)!==world.spanAt(1040,880,176)&&world.spanAt(1040,880,110)===null') is True,'same XY bridge has two free spans and a solid separating interval')
  data=json.loads(Path('demos/re2d_dust2/dust2.re2dworld').read_text());routes=json.loads(Path('demos/re2d_dust2/routes.json').read_text());p=routes['doors'][0];portal=data['portals'][p];x=sum(v[0] for v in [portal['from'],portal['to']])/2;y=sum(v[1] for v in [portal['from'],portal['to']])/2
  check(a.eval(f'world.portalClosed({p},true);world.blocked({x},{y},7,0,64)') is True,'native closed door blocks passage')
  check(a.eval(f'world.portalClosed({p},false);!world.blocked({x},{y},7,0,64)') is True,'same door reopens collision passage')
  check(a.eval('world.blocked(0,80,7,0,64)') is True,'outer world boundary is solid')
  a.eval('dustCamera("TUNNELS");world.backend("gpu");hud.hide();');a.step(5);a.screenshot('build/dust2_gpu.png');a.eval('world.backend("cpu")');a.step(2);a.screenshot('build/dust2_cpu.png')
  from re2d_native_test import decode
  gpu=b''.join(decode('build/dust2_gpu.png')[3]);cpu=b''.join(decode('build/dust2_cpu.png')[3]);errors=[abs(x-y) for x,y in zip(cpu,gpu)]
  check(sum(e>3 for e in errors)/len(errors)<.01,'Dust2 tunnel material/light/shadow frame matches CPU/GPU reference')
 return int(bool(failed))
if __name__=='__main__':sys.exit(main())
