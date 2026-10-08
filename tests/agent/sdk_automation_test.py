#!/usr/bin/env python3
"""Batch error isolation, canonical reports, native original-protocol client and GUI parity."""
import json, os, subprocess, sys, time
sys.path.insert(0,os.path.join(os.path.dirname(__file__),'..','..','tools'))
from agent_client import Agent,ROOT
SDK=os.environ.get('R2D_SDK_BINARY',os.path.join(ROOT,'build','r2d-sdk'))
OUT=os.path.join(ROOT,'build','sdk_automation');os.makedirs(OUT,exist_ok=True)
failed=[]
def check(x,m):
 print(('  ok   ' if x else '  FAIL ')+m)
 if not x:failed.append(m)
def save(name,data):
 p=os.path.join(OUT,name);open(p,'w').write(json.dumps(data));return p
def run(*args):
 p=subprocess.run([SDK,*args,*(['--engine',os.environ['R2D_BINARY']] if args[0]=='agent' and os.environ.get('R2D_BINARY') else [])],cwd=ROOT,capture_output=True,text=True,timeout=120)
 return p.returncode,json.loads(p.stdout)
def wait(a):
 for _ in range(400):
  a.step(2);time.sleep(.003)
  if a.eval('$.sdkApp.state.busy===0 && (!$.sdkApp.studios.automation || !$.sdkApp.studios.automation.state.busy)'):return
 raise RuntimeError('SDK GUI did not finish')
fixture=os.path.join(ROOT,'tests','fixtures','sdk')
jobs=[{'op':'validate','source':os.path.join(fixture,'world','stack.re2dmap')},{'op':'validate','source':'missing.json'},{'op':'bake-re2d','source':os.path.join(fixture,'props','crate.glb'),'output':'crate'}]
manifest=save('test.batch.json',{'version':1,'jobs':jobs});report=os.path.join(OUT,'batch.json')
rc,b=run('batch',manifest,'--output',report)
check(rc==1 and b['total']==3 and b['failed']==1 and b['succeeded']==2,'batch continues after missing input and bakes subsequent job')
check(json.load(open(report))==b,'saved and stdout machine reports are identical')
rc,bad=run('batch',manifest,'--output',os.path.join(OUT,'missing','report.json'))
check(rc==1 and not bad['ok'] and any(d['code']=='SDK_WRITE_FAILED' for d in bad['diagnostics']),'report write failure affects status')
duplicate=save('duplicate.batch.json',{'version':1,'jobs':[
 {'op':'bake-re2d','source':os.path.join(fixture,'props','crate.glb'),'output':'alias'},
 {'op':'bake-re2d','source':os.path.join(fixture,'props','crate.glb'),'output':'unused/../alias'}]})
rc,dup=run('batch',duplicate)
check(rc==1 and dup['failed']==1 and any(d['code']=='SDK_BATCH_OUTPUT_DUPLICATE'for d in dup['jobs'][1]['diagnostics']),'lexical output aliases cannot overwrite earlier jobs')
typed=save('typed.batch.json',{'version':1,'jobs':[{'op':'bake-re2d','source':os.path.join(fixture,'props','crate.glb'),'output':'bad-size','size':'1024'}]})
rc,wrong_type=run('batch',typed)
check(rc==1 and wrong_type['failed']==1,'batch option types are checked instead of silently defaulted')
requests=[{'cmd':'ping','id':'quoted"id'},{'cmd':'step','frames':2},{'cmd':'eval','code':'1+2'}, {'cmd':'sdk-unknown'}, {'cmd':'state'},{'cmd':'quit'}]
for field,value in [('seed',2.5),('seed','bad'),('timeoutMs','bad'),('scene',42)]:
 invalid=save('invalid.agent.json',{'version':1,'game':os.path.join(fixture,'re2d_proj'),'requests':[],field:value})
 rc,invalid_report=run('agent',invalid)
 check(rc==1 and invalid_report['completed']==0 and any(d['code']=='SDK_AGENT_SESSION'for d in invalid_report['diagnostics']),'agent session rejects invalid '+field)
session=save('test.agent.json',{'version':1,'game':os.path.join(fixture,'re2d_proj'),'seed':17,'requests':requests})
rc,ar=run('agent',session,'--output',os.path.join(OUT,'agent.json'))
check(rc==1 and ar['completed']==6 and ar['failed']==1,'native agent preserves errors and continues original session')
check(ar['ready']['event']=='ready' and ar['responses'][0]['id']=='quoted"id','ready and original request IDs preserved')
rc,io_failure=run('agent',session,'--output',os.path.join(OUT,'missing','agent.json'))
check(rc==1 and io_failure['ready']==ar['ready'] and io_failure['completed']==6 and io_failure['errors']==1,'agent report I/O error retains stable report fields')
check(ar['responses'][2]['result']==3 and ar['responses'][4]['ok'],'original eval and state responses preserved')
with Agent(game=os.path.join(fixture,'re2d_proj'),seed=17) as a:
 expected=a.cmd('eval',code='1+2')
 check(ar['responses'][2]['result']==expected['result'],'native eval result equals Python protocol client')
# Every supported command is forwarded to the original engine unchanged.
all_requests=[{'cmd':'ping'}, {'cmd':'frames'}, {'cmd':'eval','code':'$("<sprite>",{id:"probe"}).at(12,34);1'},
 {'cmd':'query','sel':'#probe'}, {'cmd':'inspect','sel':'#probe'}, {'cmd':'profile'},
 {'cmd':'key','key':'A','action':'down'}, {'cmd':'keys','hold':['D']},
 {'cmd':'touch','finger':0,'action':'down','x':10,'y':20}, {'cmd':'pad','slot':0,'button':0,'down':True},
 {'cmd':'mouse','button':1,'action':'down'}, {'cmd':'mouseMove','x':22,'y':44},
 {'cmd':'wheel','amount':2}, {'cmd':'text','text':'Тест \"json\"'}, {'cmd':'step','frames':2},
 {'cmd':'state'}, {'cmd':'screenshot','path':os.path.join(OUT,'protocol.png')}, {'cmd':'reload'}, {'cmd':'quit'}]
full=save('all.agent.json',{'version':1,'game':os.path.join(fixture,'re2d_proj'),'seed':17,'requests':all_requests})
rc,fr=run('agent',full)
check(rc==0 and fr['completed']==len(all_requests) and fr['failed']==0,'all 19 original protocol commands execute through native client')
with Agent(game=os.path.join(fixture,'re2d_proj'),seed=17) as a:
 for i,request in enumerate(all_requests[:-1]):
  params={k:v for k,v in request.items() if k!='cmd'}
  expected=a.cmd(request['cmd'],**params);actual={k:v for k,v in fr['responses'][i].items() if k!='id'}
  # Profile timing and complete world diagnostics are measured afresh by each process.
  if request['cmd'] in ('profile','state'):
   check(actual['ok']==expected['ok'] and set(actual)==set(expected),request['cmd']+' original response shape preserved')
  else:check(actual==expected,request['cmd']+' response equals Python protocol client')

if os.environ.get('SDK_SKIP_GUI')!='1':
 with Agent(game='sdk',seed=17) as a:
  wait(a);a.eval('$.sdkApp.openTool("automation",{assetAbs:'+json.dumps(manifest)+'});1');wait(a)
  a.eval('$.ui.doc("sdk/ui/automation.rml").click("au-run");1');wait(a)
  gui=a.eval('$.sdkApp.studios.automation.snapshot()')
  check(gui['report']==b,'RmlUi batch button returns same native machine report')
  a.screenshot(os.path.join(OUT,'gui.png'));a.eval('$.sdkApp.studios.automation.close();1')
  a.eval('$.sdkApp.openTool("automation",{assetAbs:'+json.dumps(session)+'});1');wait(a)
  check(a.eval('$.sdkApp.studios.automation.state.operation')=='agent','agent asset opens correct operation automatically')
  a.eval('$.ui.doc("sdk/ui/automation.rml").click("au-run");1');wait(a)
  check(a.eval('$.sdkApp.studios.automation.state.report')==ar,'RmlUi agent button preserves original native session report')
  a.eval('$.sdkApp.studios.automation.close();1')
sys.exit(bool(failed))
