#!/usr/bin/env python3
"""Native renderer reference-path profiling; Python only drives the agent protocol."""
import argparse
import hashlib
import json
import platform
import statistics
import subprocess
import sys
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from agent_client import Agent

def scene(cells,visible,stacked=False):
    data={'version':1,'cells':[],'walls':[],'portals':[]}
    for i in range(cells):
        x=i*100
        spans=[{'bottom':0,'top':128,'floorColor':'#888888','ceilingColor':'#777777'}]
        if stacked:spans.append({'bottom':160,'top':288,'floorColor':'#aa8877','ceilingColor':'#777777'})
        data['cells'].append({'x':x,'y':-60,'w':100,'h':120,'spans':spans})
        # Eight walls + two flats per cell, with honest endpoint extras below.
        walls=[([x,-60],[x+100,-60]),([x,60],[x+100,60]),
               ([x,-60],[x,-30]),([x,30],[x,60]),([x+100,-60],[x+100,-30]),([x+100,30],[x+100,60]),
               ([x+10,-48],[x+90,-48]),([x+10,48],[x+90,48])]
        if cells==500:
            for offset in [34,38,42]:
                walls.extend([([x+10,-offset],[x+90,-offset]),([x+10,offset],[x+90,offset])])
        for a,b in walls:data['walls'].append({'from':a,'to':b,'bottom':0,'top':288 if stacked else 128,'color':'#8899aa'})
        if i:
            opens=[{'bottom':0,'top':128}]
            if stacked:opens.append({'bottom':160,'top':288})
            data['portals'].append({'cellA':i-1,'cellB':i,'from':[x,-30],'to':[x,30],'openings':opens,'closed':i==visible})
    for x in [0,cells*100]:data['walls'].append({'from':[x,-30],'to':[x,30],'bottom':0,'top':288 if stacked else 128,'color':'#8899aa'})
    return data

def machine():
    try:cpu=subprocess.check_output(['sysctl','-n','machdep.cpu.brand_string'],text=True).strip()
    except (OSError,subprocess.CalledProcessError):cpu=platform.processor()
    return {'os':platform.platform(),'cpu':cpu,'architecture':platform.machine()}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--frames',type=int,default=20);parser.add_argument('--backend',choices=['cpu','gpu'],default='cpu');parser.add_argument('--output',default='build/re2d_world_renderer_benchmark.json');args=parser.parse_args()
    if args.frames<1:parser.error('--frames must be positive')
    binary=Path('build/russiano2d')
    report={'machine':machine(),'baselineCommit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),
        'workingTreeModified':bool(subprocess.check_output(['git','status','--porcelain'],text=True).strip()),
        'binarySHA256':hashlib.sha256(binary.read_bytes()).hexdigest(),'binary':str(binary.resolve()),
        'backend':'native CPU world synthesis + SDL_GPU upload' if args.backend=='cpu' else 'SDL_GPU constrained surfaces/materials/shadows and sample-depth actors; fence waited; no framebuffer readback',
        'posePolicy':'static motion; unlimited initial synthesis before warmup; zero quantization','resolution':[400,240],'warmupFrames':8,'sampleFrames':args.frames,'scenes':[]}
    with Agent(game='demos/re2d_world_renderer_lab',seed=7) as a:
        a.step(2)
        for name,n,visible,total,relevant,actors,shadow,stacked in [('A',100,16,8,8,10,0,False),('B',500,30,64,12,30,0,False),('C',80,16,128,16,50,16,True)]:
            data=scene(n,visible,stacked);source=json.dumps(json.dumps(data,separators=(',',':')))
            start=time.perf_counter()
            a.eval('world.dispose();globalThis.world=$.re2dWorld.fromJSON('+source+');view.x=50;view.y=0;view.h=48;view.yaw=0;view.pitch=0;view.projection="perspective";world.lighting({mode:"classic",dynamic:true,shadows:true,distanceScale:.001});')
            load_ms=(time.perf_counter()-start)*1000
            a.eval('world.backend('+json.dumps(args.backend)+')')
            a.eval('world.profile({gpuWait:true});world.quality({poseBudget:0,poseStep:0})')
            a.eval(f'''(()=>{{for(let i=0;i<{total};i++)world.light({{x:i<{relevant}?50+100*(i%{visible}):-10000,y:i<{relevant}?0:10000,h:70,radius:180,intensity:1,color:'#ff8060',shadow:i<{shadow}}});return true}})()''')
            a.eval(f'''globalThis.benchActors=[];for(let i=0;i<{actors};i++){{const actor=$.re2dSprite.from('demos/rotsprite/russi.character.json',{{id:'bench-{name}-'+i}}).re2dStyle('anime').rotMotion('idle',0).at(50+100*i,0).depth(0).size(48,64).angle(Math.PI).hide();benchActors.push(actor);world.add(actor)}}''')
            cold_start=time.perf_counter();a.step(1);cold_wall=(time.perf_counter()-cold_start)*1000;cold=a.eval('world.info()');a.step(7);samples=[]
            for _ in range(args.frames):a.step(1);samples.append(a.eval('world.info()'))
            last=samples[-1];keys=['frameMs','visibilityMs','surfaceMs','actorMs','lightCullMs','compositionMs','uploadMs','shadowMs','gpuSubmitMs','gpuCompletionWaitMs']
            timings={k:{'median':statistics.median(s[k] for s in samples),'max':max(s[k] for s in samples)} for k in keys}
            result={'name':name,'loadWallMsIncludingAgentTransport':load_ms,'coldFrameNativeCounters':cold,'coldAgentStepWallMs':cold_wall,'timingsMs':timings,'lastNativeCounters':last}
            report['scenes'].append(result)
            print(json.dumps({'scene':name,'frameMedianMs':timings['frameMs']['median'],'cells':[last['visibleCells'],last['cells']],'surfaces':[last['visibleSurfaces'],last['surfaces']],'lights':[last['lightsAfterCull'],last['lights']],'actors':[last['composedActors'],last['actors']]}),flush=True)
            a.eval('world.dispose();for(const actor of benchActors)actor.remove();benchActors=[];')
    Path(args.output).write_text(json.dumps(report,indent=2)+'\n');print(args.output)
if __name__=='__main__':main()
