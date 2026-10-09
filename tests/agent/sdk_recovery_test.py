"""Recovery переживает crash и не пишет в исходный asset без Save."""
import json
import os
from pathlib import Path
import sys
import tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from agent_client import Agent, ROOT


def main():
    count=0
    def check(ok,text):
        nonlocal count
        assert ok,text
        count+=1;print('  ok   '+text,flush=True)
    with tempfile.TemporaryDirectory(prefix='r2d-recovery-') as tmp:
        asset=Path(tmp)/'test.particles.json'
        original=Path(ROOT+'/games/neon-courier/pickup.particles.json').read_text()
        asset.write_text(original)
        def openStudio(a):
            a.step(20)
            for _ in range(100):
                if a.eval('$.sdkApp.state.busy')==0:break
                a.step(2)
            a.eval("$.sdkApp.openTool('particle-studio',{assetAbs:"+json.dumps(str(asset))+"})")
            a.step(12)
        with Agent(game='sdk') as a:
            openStudio(a)
            a.eval("$.sdkApp.studios['particle-studio'].ops.set({size:[11,19]})")
            a.step(130)
            recovery=Path(a.eval('$.sdkApp.recovery.snapshot()[0].path'))
            check(recovery.is_file(),'autosave создаёт отдельный recovery через 2 секунды')
            check(asset.read_text()==original,'autosave не изменил исходный файл')
            check(json.loads(recovery.read_text())['doc']['size']==[11,19],'recovery содержит фактические правки')
            a._proc.kill();a._proc.wait()
        with Agent(game='sdk') as a:
            openStudio(a)
            check(a.eval('$.sdkApp.recovery.snapshot()[0].pending'),'после crash SDK обнаружил recovery')
            doc="$.ui.doc('sdk/ui/recovery.rml')"
            check(a.eval(doc+'.visible()'),'RmlUi предлагает восстановление человеку')
            a.screenshot(ROOT+'/build/sdk_recovery_dialog.png')
            r=a.eval(doc+".rect('recovery-restore')")
            a.mouse_move(x=r['x']+r['w']/2,y=r['y']+r['h']/2);a.step(3);a.mouse(button=1,action='click');a.step(3)
            S="$.sdkApp.studios['particle-studio']"
            check(a.eval(S+'.model.size')==[11,19],'настоящая кнопка восстанавливает рабочую модель')
            check(asset.read_text()==original,'восстановление не перезаписывает asset')
            a.eval(S+'.undo()');a.step(3)
            check(a.eval(S+'.model.size')!=[11,19],'восстановление является undo-командой')
            a.eval(S+'.redo()');a.eval(S+'.save()');a.step(30)
            check(json.loads(asset.read_text())['size']==[11,19],'только Save изменяет исходник')
            check(not recovery.exists(),'Save удаляет применённый recovery')
    print('Все проверки пройдены (%s)' % count)
    return 0
if __name__=='__main__':sys.exit(main())
