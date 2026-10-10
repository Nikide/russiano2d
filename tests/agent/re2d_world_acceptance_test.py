#!/usr/bin/env python3
"""Final renderer lab gates: actual native topology, actors, materials and diagnostic frames."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools'))
from agent_client import Agent
from re2d_native_test import decode
fail=[]
def check(ok,name):
 print(('ok ' if ok else 'FAIL ')+name,flush=True)
 if not ok:fail.append(name)
def capture(a,name):
 p='build/acceptance_'+name+'.png';a.screenshot(p);return b''.join(decode(p)[3])
def main():
 with Agent(game='demos/re2d_world_renderer_lab/acceptance',seed=7) as a:
  a.step(4);a.eval('acceptanceMoving=false;world.quality({poseBudget:0,poseStep:0});world.profile({gpuWait:true});hud.hide();');a.step(3)
  i=a.eval('world.info()');check(i['cells']==11 and i['spans']==14 and i['lights']>=16 and i['actors']==3 and i['actorCandidates']==4,'complete lab contains stacked rooms, 16 lights, three actors and native AK attachment')
  check(a.eval('movingLamp.info().h===208&&movingLamp.info().r>movingLamp.info().g') is True,'moving red lamp belongs to upper storey as required by acceptance contract')
  check(a.eval('world.spanAt(350,120,40)===2&&world.spanAt(350,120,200)===3&&world.spanAt(350,120,140)===null') is True,'same XY lower and upper pigs occupy free spans separated by solid bridge')
  check(a.eval('lower.get(0).x===upper.get(0).x&&lower.get(0).y===upper.get(0).y&&upper.get(0).depth===160') is True,'registered actors are truly stacked at identical XY')
  check(a.eval('world.ray({x:350,y:120,height:200},{x:350,y:120,height:40})!==null') is True,'solid floor intersects cross-storey light/gameplay ray')
  check(a.eval('(()=>{const below=world.lightAt(350,120,64).r,across=world.lightAt(210,120,208).r;const lamp=world.light({x:350,y:120,h:208,radius:220,intensity:1,color:"#ff0000",shadow:true});const blocked=Math.abs(world.lightAt(350,120,64).r-below)<.00001,open=world.lightAt(210,120,208).r>across+.01;lamp.remove();return blocked&&open})()') is True,'isolated upper red lamp crosses upper opening but cannot illuminate lower span at identical XY')
  base=capture(a,'corridor')
  pairs=a.eval('world.info().lightSpanPairs');visible=a.eval('world.info().visibleCells');a.eval('world.portalClosed(0,true)');a.step(2);closed=capture(a,'door')
  check(closed!=base and a.eval('world.info().visibleCells')<visible,'door changes actual visibility and pixels')
  check(a.eval('world.info().lightSpanPairs')<pairs,'same door changes native light propagation')
  check(a.eval('world.blocked(240,120,6,0,64)') is True and a.eval('world.info().gpuShadowUpdates')==0,'closed door collision agrees and unchanged shadow cache does no rebuild')
  a.eval('world.portalClosed(0,false)');a.step(1)
  check(a.eval('world.info().gpuShadowUpdates')>0,'reopening the door invalidates affected native shadow chunks')
  a.eval('acceptanceCamera("corridor")');a.step(2);before=capture(a,'preflash')
  receivers='[[350,120,40],[350,1,45],[350,120,.01]]'
  light_before=a.eval('('+receivers+').map(p=>world.lightAt(...p).r)')
  a.eval('flash()');a.step(1);after=capture(a,'flash')
  light_after=a.eval('('+receivers+').map(p=>world.lightAt(...p).r)')
  check(all(after>before+.01 for before,after in zip(light_before,light_after)),'native muzzle flash adds light independently at lower actor, wall and floor receivers')
  # Lower pig/AK screen rectangle. No generated reference image stands in for runtime output.
  def crop_sum(p):return sum(p[(y*1280+x)*4+c] for y in range(350,470) for x in range(575,715) for c in range(3))
  check(crop_sum(after)>crop_sum(before),'native muzzle flash brightens lower pig/weapon region in actual output')
  a.step(12);check(a.eval('world.info().lights')==17,'native muzzle lifetime expires')
  a.eval('world.debug.view("normal")');a.step(1);normal=capture(a,'normal');a.eval('world.debug.view("emissive")');a.step(1);emissive=capture(a,'emissive')
  check(normal!=base and emissive!=base and normal!=emissive,'normal-mapped wall and emissive panel produce independent material diagnostics')
  frames=[]
  for name in ['bsp','dynamic-light-count','depth','owner','shadow-mask','portals','overdraw']:
   a.eval('world.debug.view('+json.dumps(name)+')');a.step(1);frames.append(capture(a,name))
  check(len(set(frames))==7,'BSP, affected light sets, depth/owner, shadow, portal and overdraw diagnostics explain distinct native data')
  a.eval('world.debug.view("final");acceptanceCamera("fog")');a.step(2);fog=capture(a,'fog');a.eval('world.span(4).fog({density:0})');a.step(2);unfog=capture(a,'unfog')
  check(fog!=unfog,'blue corridor fog changes actual world and actor pixels')
  a.eval('acceptanceCamera("upper")');a.step(2);check(capture(a,'upper')!=base,'upper red room is a distinct rendered scene')
  check(a.eval('world.support(740,120,8,64,0).height===8&&world.support(860,120,32,64,0).height===32') is True,'compiled four-step stair support is exact')
  check(a.eval('Math.abs(world.support(120,360,80,64,0).height-80)<.001') is True,'compiled continuous ramp has exact midpoint support')
  i=a.eval('world.info()');check(i['bspNodesVisited']>0 and i['cellsRejected']>0 and i['gpuDraws']>0 and i['internalTriangles']==i['gpuDraws'] and i['gpuMaterialBatches']<i['gpuDraws'],'profiler reports actual culled work and adjacent material batches')
  check(i['gpuTexturePayloadBytes']>0 and i['cpuFramePayloadBytes']>0 and i['gpuCompletionWaitMs']>=0,'payload memory and fence-wait provenance are visible')
 return int(bool(fail))
if __name__=='__main__':sys.exit(main())
