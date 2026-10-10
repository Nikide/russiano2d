#!/usr/bin/env python3
"""Deterministic native renderer captures; --record deliberately replaces baselines."""
import argparse
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'/'agent'))
from agent_client import Agent,resolve_binary
from re2d_native_test import decode
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'tests'/'goldens'/'re2d_world'
CASES=[
 ('camera01_corridor',''),
 ('camera02_multifloor','world.add(lower).add(upper);view.x=60;view.h=128;view.projection="orthographic";view.orthoHeight=340;'),
 ('camera03_redlight','world.lighting({mode:"classic",dynamic:true,shadows:false,distanceScale:.001});'),
 ('camera04_fog','world.span(0).fog({color:"#142a49",density:.008,start:0});world.span(2).fog({color:"#142a49",density:.008,start:0});'),
 ('camera05_shadow','world.lighting({mode:"classic",dynamic:true,shadows:true,distanceScale:.001});lowerLamp.at(380,0).height(70);'),
 ('camera06_sprite_occlusion','world.add(lower);lower.at(245,0).size(80,96);world.lighting({mode:"classic",dynamic:true,shadows:true,distanceScale:.001});'),
]
def pixels(path):
    w,h,_,rows=decode(str(path));return w,h,b''.join(rows)
def main():
    p=argparse.ArgumentParser();p.add_argument('--record',action='store_true');p.add_argument('--backend',choices=['cpu','gpu'],default='gpu');args=p.parse_args()
    BASE.mkdir(parents=True,exist_ok=True)
    manifest={'version':1,'seed':7,'backend':args.backend,'nativeResolution':[400,240],'screenshotResolution':[1280,720],
              'tolerance':{'channelDelta':3,'outlierFraction':.01,'meanAbsoluteDelta':1},'machine':platform.platform(),
              'baselineCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
              'binarySHA256':hashlib.sha256(Path(resolve_binary()).read_bytes()).hexdigest(),'cases':[]}
    if not args.record:
        manifest=json.loads((BASE/'manifest.json').read_text())
    failed=False
    for name,configure in CASES:
        with Agent(game='demos/re2d_world_renderer_lab',seed=7) as a:
            a.step(2)
            a.eval('hud.hide();lower.rotMotion("idle",0);upper.rotMotion("idle",0);world.remove(lower).remove(upper);world.quality({poseBudget:0,poseStep:0});world.profile({gpuWait:true});world.backend('+json.dumps(args.backend)+');world.lighting({mode:"classic",dynamic:false,shadows:false,distanceScale:.001});for(let i=0;i<4;i++)world.span(i).fog({density:0});'+configure)
            a.step(8)
            out=BASE/(name+'.png') if args.record else ROOT/'build'/(name+'_actual.png')
            a.screenshot(str(out));width,height,actual=pixels(out)
            if args.record:
                manifest['cases'].append({'name':name,'file':out.name,'configure':configure,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'width':width,'height':height})
                print('recorded',name,flush=True)
            else:
                ew,eh,expected=pixels(BASE/(name+'.png'))
                errors=[abs(x-y) for x,y in zip(actual,expected)]
                tolerance=manifest['tolerance'];outliers=sum(e>tolerance['channelDelta'] for e in errors)/max(1,len(errors));mean=sum(errors)/max(1,len(errors))
                ok=(width,height)==(ew,eh) and len(actual)==len(expected) and outliers<=tolerance['outlierFraction'] and mean<=tolerance['meanAbsoluteDelta']
                failed|=not ok;print(('ok' if ok else 'FAIL'),name,'outliers',round(outliers,6),'mean',round(mean,6),flush=True)
    if args.record:(BASE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return int(failed)
if __name__=='__main__':sys.exit(main())
