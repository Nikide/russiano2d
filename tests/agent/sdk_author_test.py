#!/usr/bin/env python3
"""Authoring is persisted as existing runtime definitions and previewed by it."""
import json,os,shutil,sys,time,subprocess
sys.path.insert(0,os.path.join(os.path.dirname(__file__),'..','..','tools'))
from agent_client import Agent,ROOT
SRC=os.path.join(ROOT,'tests','fixtures','sdk','re2d_proj');OUT=os.path.join(ROOT,'build','sdk_author')
shutil.rmtree(OUT,ignore_errors=True);shutil.copytree(SRC,OUT)
MODEL=os.path.join(OUT,'animal.character.json');D='$.ui.doc("sdk/ui/re2d_studio.rml")';S='$.sdkApp.studios.re2d'
data=json.load(open(MODEL));data['rig']['sockets']=[{'name':'tail-tip','bone':'tail','point':[15,-3,0]}];open(MODEL,'w').write(json.dumps(data,indent=2)+'\n')
failed=[]
def check(x,m):
 print(('  ok   ' if x else '  FAIL ')+m)
 if not x:failed.append(m)
def wait(a):
 for _ in range(400):
  a.step(2);time.sleep(.002)
  if a.eval('$.sdkApp.state.busy===0'):return
 raise RuntimeError('busy')
def edit(a,category,name,value):
 for field,text in [('a-category',category),('a-name',name),('a-json',json.dumps(value))]:a.eval(D+'.setValue('+json.dumps(field)+','+json.dumps(text)+');1')
 a.eval(D+'.click("a-apply");1');a.step(3)
with Agent(game='sdk',seed=5) as a:
 wait(a);a.eval('$.sdkApp.openTool("re2dsprite-studio",{assetAbs:'+json.dumps(MODEL)+'});1');wait(a)
 a.eval(D+'.click("rs-tab-author");1');a.step(3)
 clip={'duration':1,'loop':True,'tracks':[{'target':'tail','channel':'rotation.x','keys':[[0,-25],[.5,25],[1,-25]]}]}
 edit(a,'clips','wag',clip)
 check(a.eval(S+'.state.def.animations.clips.wag.duration')==1,'new clip stored in existing inline animations format')
 check(a.eval(S+'.state.anim.clips.walk.duration')==1,'editing external clips preserves existing walk')
 a.eval(D+'.click("a-preview");1');a.eval(D+'.setValue("a-time","0.5");'+D+'.click("a-seek");1');a.step(2)
 check(abs(a.eval('$.re2dSprite.info("#sdk-re2d").animationTime')-.5)<.001,'timeline seek sets real runtime animation time')
 edit(a,'emotions','calm',{'eyes':'open','mouth':'closed','brows':'neutral'})
 a.eval(D+'.click("a-preview");1');a.step(2)
 check(a.eval(S+'.state.emotion')=='calm','authored emotion selected in runtime')
 edit(a,'variants','body',{'copy':'animal.png'})
 a.eval(D+'.click("a-preview");1');a.step(2)
 check(a.eval('!!'+S+'.state.node'),'variant donor applied to runtime')
 # Add a socket and equipment through the existing rig editor operation.
 a.eval(S+'.ops.setSocket("tail-tip",{bone:"tail",point:[15,-3,0]});1')
 edit(a,'equipment','toy',{'model':'animal.character.json','socket':'tail-tip'})
 a.eval(D+'.click("a-preview");1');a.step(2)
 check(a.eval('!!'+S+'.state.equipmentNode'),'equipment creates attached runtime node')
 check(a.eval(S+'.state.diagnostics.length')==0,'authoring preview has no runtime errors')
 a.screenshot(os.path.join(OUT,'author.png'))
 a.eval(D+'.click("rs-undo");1');a.step(2)
 check(a.eval('!'+S+'.state.def.equipment?.toy'),'undo removes authored record')
 a.eval(D+'.click("rs-redo");1');a.step(2)
 check(a.eval('!!'+S+'.state.def.equipment?.toy'),'redo restores authored record')
 a.eval(S+'.save();1');wait(a)
 check('wag' in json.load(open(MODEL))['animations']['clips'],'authored clip persisted on disk')
 a.eval(S+'.close();1')
p=subprocess.run([os.path.join(ROOT,'build','r2d-sdk'),'validate',MODEL],capture_output=True,text=True)
check(p.returncode==0 and json.loads(p.stdout)['ok'],'saved authoring accepted by native validator')
sys.exit(bool(failed))
