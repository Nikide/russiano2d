#!/usr/bin/env python3
"""Spatial playback in actual Re2D topology, using the supplied club loop."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools'))
from agent_client import Agent
failed=[];count=0
def check(ok,name):
 global count
 count+=1;print(('ok ' if ok else 'FAIL ')+name,flush=True)
 if not ok:failed.append(name)
with Agent(game='demos/re2d_dust2',seed=7) as a:
 a.eval('dustCamera("CLUB")');a.step(20);near=a.eval('clubMusic.info()')
 check(near['playing'] and near['hrtf'] and near['gain']>.4,'supplied MP3 plays through real HRTF in club')
 a.eval('dustCamera("T SPAWN")');a.step(20);far=a.eval('clubMusic.info()')
 check(far['gain']<near['gain']*.1,'distance fades music outside club')
 a.eval('dustCamera("CLUB");view.x=2050;world.portalClosed(151,false)');a.step(20);opened=a.eval('clubMusic.info()')
 check(not opened['occluded'] and opened['cutoff']==22000,'open native door transmits direct sound')
 a.eval('world.portalClosed(151,true)');a.step(20);closed=a.eval('clubMusic.info()')
 check(closed['occluded'] and closed['cutoff']==700 and abs(closed['gain']/opened['gain']-.18)<.001,'closed native door attenuates and low-passes sound')
 a.eval('world.portalClosed(151,false);dustCamera("CLUB");view.h=260');a.step(10)
 check(a.eval('clubMusic.info().occluded') is True,'ceiling blocks sound at same XY but another height')
 a.eval('dustCamera("CLUB");view.x=2352;view.h=64');a.step(1)
 check(a.eval('Number.isFinite(clubMusic.info().currentGain)') is True,'listener at source has finite gain and defined HRTF direction')
 check(a.eval('(()=>{dustCamera("CLUB");view.x=1880;for(let i=0;i<140;i++)if(!dustMove(2,0))return false;return view.x===2160&&view.h===48})()') is True,'Long to club traverses both door openings without falling')
 a.eval('dustCamera("CLUB");globalThis.c0=clubLamps[0].info()');a.step(40)
 check(a.eval('JSON.stringify(c0)!==JSON.stringify(clubLamps[0].info())') is True,'club lamps change actual native light parameters')
 a.eval('dustCamera("CLUB")');a.step(10);a.screenshot('build/dust2_club.png')
 check(a.eval('(()=>{clubMusic.stop();globalThis.replacement=clubAudio.source("demos/re2d_dust2/club_loop.mp3",{x:2300,y:1840,h:64});try{clubMusic.stop();return false}catch(e){return replacement.info().playing}})()') is True,'stale source cannot stop reused mixer channel')
 check(a.eval('replacement.at(2250,1840,80).volume(.3).range(800).info().x===2250') is True,'source updates through public API')
 check(a.eval('(()=>{const w=$.re2dWorld.load("demos/re2d_dust2/dust2.re2dworld"),s=w.audio.source("demos/re2d_dust2/club_loop.mp3",{hrtf:false});w.dispose();try{s.info();return false}catch(e){return replacement.info().playing}})()') is True,'world disposal invalidates owned sources and preserves other world audio')
 check(a.eval('(()=>{try{clubAudio.source("demos/re2d_dust2/club_loop.mp3",{range:0});return false}catch(e){return replacement.info().playing}})()') is True,'invalid source range is rejected without disturbing active source')
print(f'{count} checks, {len(failed)} failures')
sys.exit(bool(failed))
