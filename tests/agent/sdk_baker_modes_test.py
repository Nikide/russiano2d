"""Native presets/optimized имеют настоящий результат и загружаются runtime."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
sys.path.insert(0,os.path.join(os.path.dirname(__file__),'..','..','tools'))
from agent_client import Agent,ROOT


def main():
    count=0
    def check(ok,text):
        nonlocal count
        assert ok,text
        count+=1;print('  ok   '+text,flush=True)
    source=ROOT+'/tests/fixtures/sdk/props/crate.glb'
    with tempfile.TemporaryDirectory() as tmp:
        def bake(name,*args):
            p=subprocess.run([ROOT+'/build/r2d-sdk','bake-re2d',source,'--output',tmp+'/'+name,*args],capture_output=True,text=True,timeout=60)
            d=json.loads(p.stdout);return p.returncode,d
        rc,auto=bake('auto');check(rc==0,'Auto bake baseline')
        rc,opt=bake('opt','--uv','optimized');check(rc==0 and opt['uvMode']=='optimized','weighted atlas budget produces asset')
        digest=lambda d:hashlib.sha256(Path(d['files']['png']).read_bytes()).hexdigest()
        check(digest(auto)!=digest(opt),'optimized меняет распределение отсчётов, не только имя режима')
        rc,opt2=bake('opt2','--uv','optimized');check(rc==0 and digest(opt)==digest(opt2),'optimized результат детерминирован')
        rc,weapon=bake('weapon','--type','weapon');check(rc==0,'Weapon bake проходит C pipeline')
        w=json.loads(Path(weapon['files']['character']).read_text())
        check(w['rig']['sockets'][0]['name']=='grip','Weapon имеет редактируемый grip socket')
        rc,env=bake('environment','--type','environment');check(rc==0 and env['fit']['origin']=='feet' and abs(env['fit']['y'][1])<.001,'Environment piece опирается на Y=0')
        rc,bad=bake('bad','--uv','nonsense');check(rc!=0 and not bad['ok'],'неизвестный UV отклонён')
        with Agent(game='tests/fixtures/sdk/re2d_proj') as a:
            for d in (opt,weapon,env):
                a.eval("globalThis.baked=$.re2dSprite.from("+json.dumps(d['files']['character'])+").size(300,300).re2dMotion('spin',0)")
                a.step(2);info=a.eval('$.re2dSprite.info(globalThis.baked)')
                assert info['surfaceSamples']>0 and not info['disposed'],info
                a.eval('globalThis.baked.remove()')
            check(True,'все новые режимы принимаются настоящим Re2DSprite runtime')
    print('Все проверки пройдены (%s)'%count)
    return 0
if __name__=='__main__':sys.exit(main())
