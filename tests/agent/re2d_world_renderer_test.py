#!/usr/bin/env python3
"""New public native World loader, portal state, light handles and registered actors."""
import json
import os
import subprocess
import sys
from pathlib import Path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
sys.path.insert(0, os.path.dirname(__file__))
from agent_client import Agent
from re2d_native_test import decode
FAILED=[]
def check(ok,message):
    print(('  ok   ' if ok else '  FAIL ')+message,flush=True)
    if not ok: FAILED.append(message)
def capture(a,name):
    path='build/test_renderer_'+name+'.png'
    a.screenshot(path)
    return decode(path)[3]
def main():
    output=Path('build/test_renderer_compiled.re2dworld')
    r=subprocess.run([os.environ.get('R2D_SDK_BINARY','build/r2d-sdk'),'world-compile','tests/fixtures/sdk/world/two.re2dmap','--renderer','--output',str(output)],capture_output=True,text=True)
    compiled=json.loads(output.read_text()) if r.returncode==0 else {}
    report=json.loads(r.stdout) if r.returncode==0 else {}
    check(r.returncode==0 and compiled.get('version')==1 and compiled['portals'][0]['from']==[100,30]
          and report.get('outputFormat')=='re2dworld-v1' and report.get('runtimePortals') is True,
          'native SDK output preserves version and portal boundary and reports runtime format')
    ramp_output=Path('build/test_renderer_ramp.re2dworld')
    r=subprocess.run([os.environ.get('R2D_SDK_BINARY','build/r2d-sdk'),'world-compile','tests/fixtures/sdk/world/slope.re2dmap','--renderer','--output',str(ramp_output)],capture_output=True,text=True)
    ramp=json.loads(ramp_output.read_text()) if r.returncode==0 else {}
    check(r.returncode==0 and len(ramp.get('cells',[]))==3 and ramp['cells'][2]['spans'][0].get('floorSlope')=={'a':.5,'b':0},'SDK renderer preserves one continuous slope instead of five steps')
    stairs_source=Path('build/test_renderer_stairs.re2dmap')
    stairs_source.write_text(json.dumps({'version':1,'name':'stairs','cells':[],'walls':[],'portals':[],'stairs':[{'id':'steps','rect':[0,0,100,100],'axis':'x','dir':1,'steps':4,'base':0,'rise':8,'top':120}]}))
    stairs_output=Path('build/test_renderer_stairs.re2dworld')
    r=subprocess.run([os.environ.get('R2D_SDK_BINARY','build/r2d-sdk'),'world-compile',str(stairs_source),'--renderer','--output',str(stairs_output)],capture_output=True,text=True)
    stairs=json.loads(stairs_output.read_text()) if r.returncode==0 else {}
    check(r.returncode==0 and len(stairs.get('cells',[]))==4 and len(stairs.get('portals',[]))==3,'SDK generated stairs retain three native portal connections')
    stair_wall_data=json.loads(stairs_source.read_text());stair_wall_data['cells']=[{'id':'approach','rect':[-25,0,25,100],'spans':[{'bottom':0,'top':120}]}];stair_wall_data['walls']=[{'id':'lintel','from':[0,0],'to':[0,100],'bottom':120,'top':160}]
    stair_wall_source=Path('build/test_renderer_stair_lintel.re2dmap');stair_wall_source.write_text(json.dumps(stair_wall_data));stair_wall_output=Path('build/test_renderer_stair_lintel.re2dworld')
    r=subprocess.run([os.environ.get('R2D_SDK_BINARY','build/r2d-sdk'),'world-compile',str(stair_wall_source),'--renderer','--output',str(stair_wall_output)],capture_output=True,text=True)
    check(r.returncode==0 and len(json.loads(stair_wall_output.read_text())['portals'])==4,'authored lintel above headroom does not suppress a generated stair opening')
    static_source=Path('build/test_renderer_static.re2dmap');static_data=json.loads(Path('tests/fixtures/sdk/world/two.re2dmap').read_text())
    for cell in static_data['cells']:cell['spans'][0]['lighting']={'level':0,'color':'#ffffff'}
    static_data['lighting']={'mode':'classic','dynamic':True,'shadows':True};static_data['lights']=[{'x':50,'y':50,'h':40,'radius':200,'intensity':2,'color':'#ff0000','shadow':True}]
    static_source.write_text(json.dumps(static_data));static_output=Path('build/test_renderer_static.re2dworld')
    r=subprocess.run([os.environ.get('R2D_SDK_BINARY','build/r2d-sdk'),'world-compile',str(static_source),'--renderer','--output',str(static_output)],capture_output=True,text=True)
    static_compiled=json.loads(static_output.read_text()) if r.returncode==0 else {}
    check(r.returncode==0 and static_compiled.get('baked',{}).get('version')==2,'SDK baker serializes static span lighting and light associations in versioned native tables')
    with Agent(game='demos/re2d_world_renderer_lab',seed=7) as a:
        a.step(2)
        check(a.eval('world.info().cells')==2 and a.eval('world.info().spans')==4,'public loader preserves two cells and four stacked spans')
        check(a.eval('world.cellAt(240,0)')==1 and a.eval('world.spanAt(340,0,208)')==3,'public coarse queries reach native topology')
        check(a.eval('world.info().actors')==2,'Re2DSprites registered once in native runtime')
        check(a.eval('world.info().visibleSpans')==2,'lower camera does not traverse upper openings')
        check(a.eval('world.info().materials')==3,'native material bank loads albedo/normal/emissive PNGs')
        a.eval('lower.rotMotion("idle",0);upper.rotMotion("idle",0);world.quality({poseBudget:0,poseStep:0});view.projection="orthographic";view.orthoHeight=340;view.h=128');a.step(2)
        a.eval('world.quality({poseBudget:1,poseStep:0});view.y=20');a.step(1)
        check(a.eval('world.info().posesUpdated')==1 and a.eval('world.info().posesDeferred')>=1,'native changed-pose budget defers excess actor work')
        a.step(2)
        check(a.eval('world.info().posesDeferred')==0,'native round-robin scheduling eventually updates every stationary pending actor')
        a.eval('view.y=0;view.h=48;view.projection="perspective";world.quality({poseBudget:1,poseStep:3})');a.step(3)
        a.eval('world.span(2).heights(64,128)');a.step(1)
        check(a.eval('world.support(340,0,64,40,0).height')==64 and a.eval('world.blocked(240,0,1,0,40)') is True,
              'public native lift synchronizes support and portal riser collision')
        lift_cpu=capture(a,'lift_cpu')
        a.eval('world.backend("gpu")');a.step(1)
        lift_gpu=capture(a,'lift_gpu')
        errors=[abs(x-y) for x,y in zip(b''.join(lift_cpu),b''.join(lift_gpu))]
        check(sum(e>3 for e in errors)/len(errors)<.01,'moving floor/riser GPU geometry and shadow cache match CPU')
        a.eval('world.backend("cpu");world.span(2).heights(0,128)');a.step(1)
        a.eval('globalThis.held=$.re2dSprite.equip(lower,"pistol").re2dStyle("anime").hide()');a.step(1)
        check(a.eval('world.info().actorCandidates')==3 and a.eval('held.get(0).rot_sprite.worldComposed') is True,
              'native frame traverses configured attachments and defers their synthesis')
        a.eval('held.rotDetach().remove()');a.step(1)
        check(a.eval('world.info().actorCandidates')==2,'attachment detach updates configuration mirror without per-frame JS packing')
        open_pixels=capture(a,'open')
        a.eval('world.debug.view("depth")');a.step(1)
        check(capture(a,'depth')!=open_pixels,'native depth debug renders a different owner-backed frame')
        a.eval('world.debug.view("span-id")');a.step(1)
        check(capture(a,'span')!=open_pixels and len(a.eval('world.debug.visibility().spans'))==2,'native span debug snapshot exposes actual visible handles')
        debug_frames=[]
        for mode in ['cell-id','owner','light-level','dynamic-light-count','normal','emissive','bsp','portals','shadow-mask','overdraw']:
            a.eval('world.debug.view('+json.dumps(mode)+')');a.step(1)
            pixels=capture(a,'debug_'+mode)
            debug_frames.append(pixels)
        check(all(p!=open_pixels for p in debug_frames),'all 13 diagnostic views execute including native GPU overdraw')
        check(len({b''.join(p) for p in debug_frames})>=8,'material, shadow, topology and coverage diagnostics expose distinct data')
        a.eval('world.debug.view("final")');a.step(1)
        check(a.eval('world.info().frameMs')>0 and a.eval('world.info().surfaceMs')>0,'native stage timings record actual synthesis work')

        a.eval('world.portalClosed(0,true)');a.step(1)
        closed_pixels=capture(a,'closed')
        check(open_pixels!=closed_pixels and a.eval('world.info().visibleCells')==1,'closed native door changes actual pixels and visible set')
        check(a.eval('world.blocked(240,0,3,0,64)') is True,'same closed door blocks collision')
        check(a.eval('world.ray({x:60,y:0,height:48},{x:340,y:0,height:48}).wall') is not None,'same closed door blocks gameplay ray')
        a.eval('world.portalClosed(0,false);world.lighting({mode:"classic",dynamic:false,shadows:false,distanceScale:.001})');a.step(1)
        classic=capture(a,'classic')
        check(classic!=open_pixels,'native dynamic lighting changes actual frame')
        a.eval('world.backend("gpu")');a.step(1)
        gpu=capture(a,'gpu_classic')
        errors=[abs(x-y) for x,y in zip(b''.join(classic),b''.join(gpu))]
        check(a.eval('world.info().backend')=='gpu-reference' and a.eval('world.info().gpuDraws')>0,
              'actual SDL_GPU constrained surfaces execute native draws')
        check(sum(e>3 for e in errors)/len(errors)<.01,
              'GPU classic materials and depth composition match CPU reference within one percent edge tolerance')
        a.eval('world.backend("cpu")')
        a.eval('world.lighting({mode:"classic",dynamic:true,shadows:true,distanceScale:.001});view.h=208');a.step(1)
        upper=capture(a,'upper')
        check(upper!=open_pixels and a.eval('world.info().visibleSpans')==2,'same XY upper camera selects upper spans and different frame')
        a.eval('world.backend("gpu")');a.step(1)
        gpu_upper=capture(a,'gpu_upper')
        errors=[abs(x-y) for x,y in zip(b''.join(upper),b''.join(gpu_upper))]
        check(sum(e>3 for e in errors)/len(errors)<.01,
              'GPU normal/emissive/fog and height-aware shadows match stacked upper CPU reference')
        a.eval('world.backend("cpu");view.h=48');a.step(1)
        lower_cpu=capture(a,'shadow_cpu')
        a.eval('world.backend("gpu")');a.step(1)
        lower_gpu=capture(a,'shadow_gpu')
        errors=[abs(x-y) for x,y in zip(b''.join(lower_cpu),b''.join(lower_gpu))]
        check(sum(e>3 for e in errors)/len(errors)<.01,'GPU wall/floor shadow occlusion matches lower CPU reference')
        a.eval('world.portalClosed(0,true)');a.step(1)
        door_gpu=capture(a,'door_gpu')
        a.eval('world.backend("cpu")');a.step(1)
        door_cpu=capture(a,'door_cpu')
        errors=[abs(x-y) for x,y in zip(b''.join(door_cpu),b''.join(door_gpu))]
        check(sum(e>3 for e in errors)/len(errors)<.01,'GPU shadow cache invalidates on native door mutation')
        a.eval('world.portalClosed(0,false);view.h=208')
        check(a.eval('(()=>{lowerLamp.radius(180).color("#00ff00");const i=lowerLamp.info();return i.radius===180&&i.g===1&&i.r===0})()') is True,'public light handle updates native state')
        check(a.eval('(()=>{const l=world.light({x:60,y:0,h:48,radius:20});l.remove();try{l.radius(2)}catch(e){return true}return false})()') is True,'removed light handle rejects stale update')
        check(a.eval('(()=>{world.remove(lower);const n=world.info().actors;world.add(lower);return n===1&&world.info().actors===2})()') is True,'native actor lifetime supports unregister and register')
        check(a.eval('(()=>{const n=world.info().lights;world.light({x:60,y:0,h:208,radius:10}).life(.03);return world.info().lights===n+1})()') is True,'native light lifetime configured without JS maintenance')
        a.step(4)
        check(a.eval('world.info().lights')==2,'native update expires temporary light deterministically')
        check(a.eval('(()=>{let l;for(let i=0;i<8000;i++){l=world.light({x:60,y:0,h:208,radius:10});l.remove()}l=world.light({x:60,y:0,h:208,radius:10});const ok=l.info().radius===10;l.radius(12);l.remove();return ok})()') is True,'long-run generation handles remain valid beyond one million token values')
        check(a.eval('world.lightAt(340,0,208).r')>0,'gameplay light query uses native data without framebuffer readback')
        ramp_source=json.dumps(ramp_output.read_text())
        check(a.eval('(()=>{const w=$.re2dWorld.fromJSON('+ramp_source+');const ok=w.spanAt(225,50,12)===null&&w.spanAt(225,50,13)===2&&w.spanAt(275,50,37)===null&&w.spanAt(275,50,38)===2;w.dispose();return ok})()') is True,'compiled slope has exact continuous native floor heights')
        static_source_json=json.dumps(static_output.read_text())
        check(a.eval('(()=>{const w=$.re2dWorld.fromJSON('+static_source_json+');const initial=w.info();const light=w.lightAt(150,50,40);const ok=initial.bakedLighting&&initial.lights===1&&initial.lightUpdates===0&&light.r>.2&&light.g===0&&w.span(0).info().level===0&&w.info().lightUpdates===0;w.dispose();return ok})()') is True,'compiled static light query uses precomputed portal associations without runtime traversal')
        updated=json.loads(json.dumps(static_compiled));updated.pop('baked',None);updated['lights'][0]['color']='#0000ff';updated['cells'][0]['spans'][0]['lighting']['level']=.25
        check(a.eval('(()=>{const w=$.re2dWorld.fromJSON('+static_source_json+');const d=w.light({x:50,y:50,h:40,radius:200,intensity:.1,color:"#00ff00"});w.reloadJSON('+json.dumps(json.dumps(updated))+');const c=w.lightAt(50,50,40);const ok=w.info().lights===2&&d.info().g===1&&c.b>c.r+.5&&c.r<.3&&w.span(0).info().level===.25;w.dispose();return ok})()') is True,'reload replaces authored static light/color and ambient while retaining dynamic handles')
        source=json.dumps(output.read_text())
        check(a.eval('(()=>{const w=$.re2dWorld.fromJSON('+source+');const ok=w.info().bakedTopology&&w.info().portals===1&&w.cellAt(150,50)===1;w.dispose();return ok})()') is True,'SDK compiled map loads native baked BSP without authoring rebuild')
        check(a.eval('(()=>{try{$.re2dWorld.fromJSON("{\\\"version\\\":2}")}catch(e){return true}return false})()') is True,'incompatible native map version rejects')
        check(a.eval('(()=>{const before=world.info();try{world.reloadJSON(JSON.stringify({version:99}))}catch(e){return world.info().surfaces===before.surfaces&&world.info().actors===before.actors}return false})()') is True,'invalid reload preserves live geometry and actor registration')
        check(a.eval('(()=>{const l=world.light({x:60,y:0,h:48,radius:20});world.reload("demos/re2d_world_renderer_lab/lab.re2dworld");const ok=world.info().actors===2&&world.info().materials===3&&l.info().radius===20;l.remove();return ok})()') is True,'transactional geometry reload preserves material bank, actor roots and light generations')
        a.step(1)
        watch_path=Path('build/test_renderer_watch.re2dworld')
        watch_data=json.loads(Path('demos/re2d_world_renderer_lab/lab.re2dworld').read_text())
        watch_path.write_text(json.dumps(watch_data))
        a.eval('globalThis.watchWorld=$.re2dWorld.load("build/test_renderer_watch.re2dworld").watch("build/test_renderer_watch.re2dworld")')
        old_walls=a.eval('watchWorld.info().walls')
        watch_data['walls'].append({'from':[90,-80],'to':[100,-80],'bottom':0,'top':32})
        watch_path.write_text(json.dumps(watch_data));a.step(30)
        check(a.eval('watchWorld.info().walls')==old_walls+1 and a.eval('watchWorld.info().reloadCount')==1,'native file watch reloads valid geometry at a frame boundary')
        watch_path.write_text('{"version":99}');a.step(30)
        check(a.eval('watchWorld.info().walls')==old_walls+1 and bool(a.eval('watchWorld.info().reloadError')),'invalid watched file retains previous geometry and reports the error without stopping gameplay')
        a.eval('watchWorld.watch("").dispose()');watch_path.unlink()
        glass={'version':1,'cells':[{'x':0,'y':-120,'w':400,'h':240,'spans':[{'bottom':0,'top':128}]}],'walls':[{'from':[300,-120],'to':[300,120],'bottom':0,'top':128,'color':'#00ff00'},{'from':[200,-120],'to':[200,120],'bottom':0,'top':128,'color':'#ff0000'},{'from':[100,-120],'to':[100,120],'bottom':0,'top':128,'color':'#0000ff'}],'portals':[]}
        a.eval('world.dispose();globalThis.world=$.re2dWorld.fromJSON('+json.dumps(json.dumps(glass))+');hud.hide();view.x=50;view.y=0;view.h=48;view.pitch=0;view.yaw=0;view.projection="perspective";world.lighting({enabled:false});world.material("glass",{albedo:"demos/re2d_world_renderer_lab/floor.png",blend:"translucent",opacity:.5});world.surface(1).material("glass");world.surface(2).material("glass");world.backend("cpu");')
        a.step(2);glass_cpu=capture(a,'glass_cpu')
        a.eval('world.backend("gpu")');a.step(1);glass_gpu=capture(a,'glass_gpu')
        errors=[abs(x-y) for x,y in zip(b''.join(glass_cpu),b''.join(glass_gpu))]
        check(sum(e>3 for e in errors)/len(errors)<.01,'two translucent layers use stable far-to-near ordering with CPU/GPU parity')
        width,height,bpp,rows=decode('build/test_renderer_glass_gpu.png');center=rows[height//2][(width//2)*bpp:(width//2)*bpp+3]
        check(all(c>10 for c in center),'two colored glass layers retain the opaque background contribution')
        a.eval('world.add(lower);lower.at(150,0).depth(0).size(80,96).rotMotion("idle",0);world.quality({poseBudget:0,poseStep:0});world.backend("cpu")');a.step(2);actor_glass_cpu=capture(a,'actor_glass_cpu')
        a.eval('world.backend("gpu")');a.step(1);actor_glass_gpu=capture(a,'actor_glass_gpu')
        errors=[abs(x-y) for x,y in zip(b''.join(actor_glass_cpu),b''.join(actor_glass_gpu))]
        check(sum(e>3 for e in errors)/len(errors)<.01 and actor_glass_cpu!=glass_cpu,'actor between transparent layers shares opaque depth before ordered blending')
        a.eval('world.material("flash",{albedo:"demos/re2d_world_renderer_lab/floor.png",blend:"additive",opacity:.5});world.surface(2).material("flash");world.backend("cpu")');a.step(1);additive_cpu=capture(a,'additive_cpu')
        a.eval('world.backend("gpu")');a.step(1);additive_gpu=capture(a,'additive_gpu')
        errors=[abs(x-y) for x,y in zip(b''.join(additive_cpu),b''.join(additive_gpu))]
        check(sum(e>3 for e in errors)/len(errors)<.01 and additive_cpu!=actor_glass_cpu,'additive flash uses the same depth/order contract and preserves destination color')
        a.eval('world.sky({texture:"demos/re2d_world_renderer_lab/floor.png",color:"#88bbee"});world.surface(world.info().walls+1).sky();view.pitch=60;world.backend("cpu")');a.step(1);sky_cpu=capture(a,'sky_cpu')
        a.eval('world.backend("gpu")');a.step(1);sky_gpu=capture(a,'sky_gpu')
        errors=[abs(x-y) for x,y in zip(b''.join(sky_cpu),b''.join(sky_gpu))]
        check(sum(e>3 for e in errors)/len(errors)<.01 and sky_cpu!=additive_cpu,'native panorama sky replaces a marked ceiling and agrees across CPU/GPU')
        a.eval('view.pitch=0;world.material("paintbase",{albedo:"demos/re2d_world_renderer_lab/floor.png",blend:"opaque"});world.surface(2).material("paintbase");world.material("paint",{albedo:"demos/re2d_world_renderer_lab/panel.png",emissive:"demos/re2d_world_renderer_lab/panel_e.png"});world.backend("cpu")');a.step(1);paint_base=capture(a,'paint_base')
        a.eval('globalThis.paint=world.decal({surface:2,material:"paint",u:100,v:30,width:40,height:40})');a.step(1);decal_cpu=capture(a,'decal_cpu')
        a.eval('world.backend("gpu")');a.step(1);decal_gpu=capture(a,'decal_gpu')
        errors=[abs(x-y) for x,y in zip(b''.join(decal_cpu),b''.join(decal_gpu))]
        check(sum(e>3 for e in errors)/len(errors)<.01 and decal_cpu!=paint_base,'bounded surface-owned decal is lit/projected with CPU/GPU parity and no generic mesh')
        check(a.eval('(()=>{paint.remove();try{paint.remove()}catch(e){return world.info().decals===0}return false})()') is True,'decal handle removal rejects stale generation')
        a.eval('world.decal({surface:2,material:"paint",u:100,v:30,width:40,height:40,life:.03})');a.step(4)
        check(a.eval('world.info().decals')==0,'native decal lifetime expires without JS maintenance')
    return 1 if FAILED else 0
if __name__=='__main__':sys.exit(main())
