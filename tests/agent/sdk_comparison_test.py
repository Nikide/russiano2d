"""Source projections C и настоящий Re2DSprite GUI при одинаковых yaw/pitch."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from agent_client import Agent, ROOT
from sdk_baker_test import read_png


def main():
    count=0
    def check(ok,text):
        nonlocal count
        assert ok,text
        count+=1;print('  ok   '+text,flush=True)
    source=ROOT+'/tests/fixtures/sdk/props/crate.glb'
    with tempfile.TemporaryDirectory(prefix='r2d-compare-') as tmp:
        p=subprocess.run([ROOT+'/build/r2d-sdk','bake-re2d',source,'--output',tmp+'/cli','--compare'],capture_output=True,text=True,timeout=120)
        report=json.loads(p.stdout)
        check(p.returncode==0 and report['ok'],'native C bake с source comparison')
        comp=report['comparison'];paths=list(Path(comp['directory']).glob('*.png'))
        check(len(paths)==25,'созданы 5 yaw × 5 pitch исходных проекций')
        for path in paths:
            w,h,rows,bpp=read_png(str(path))
            assert w==512 and h==512 and sum(sum(row[3::bpp]) for row in rows)>0,path
        check(True,'все 25 source preview имеют реальные покрытые пиксели')
        with Agent(game='sdk',timeout=120) as a:
            def idle():
                for _ in range(1000):
                    a.step(2)
                    if a.eval('$.sdkApp.state.busy')==0:return
                raise AssertionError('SDK timeout')
            a.step(20);idle()
            a.eval("$.sdkApp.openTool('re2d-baker',{assetAbs:"+json.dumps(source)+"})");a.step(12)
            a.eval("$.ui.doc('sdk/ui/baker.rml').setValue('bk-out',"+json.dumps(tmp+'/gui')+")")
            a.eval('$.sdkApp.studios.baker.bake()');idle()
            B='$.sdkApp.studios.baker'
            check(a.eval(B+'.snapshot().preview'),'результат открыт настоящим runtime')
            for yaw in comp['yaw']:
                for pitch in comp['pitch']:
                    assert a.eval(B+'.compare(%s,%s)'%(yaw,pitch))
                    a.step(2)
                    info=a.eval("$.re2dSprite.info($('#sdk-bake-preview'))")
                    assert info['yaw']==((yaw+180)%360)-180 and info['pitch']==pitch,info
            check(True,'25 пар source/runtime используют одинаковые yaw и pitch')
            check(not a.eval(B+'.compare(12,4)'),'неподдержанный ракурс отклоняется')
            a.eval(B+'.compare(45,20)');a.step(3)
            a.screenshot(ROOT+'/build/sdk_source_comparison.png')
    print('Все проверки пройдены (%s)'%count)
    return 0
if __name__=='__main__':sys.exit(main())
