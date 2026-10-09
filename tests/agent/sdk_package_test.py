"""Настоящий архив SDK: распаковка, CLI, GUI, шаблон, Run и Package."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from agent_client import Agent, ROOT
import release


def main():
    count = 0
    def check(ok, text):
        nonlocal count
        assert ok, text
        count += 1
        print('  ok   ' + text, flush=True)
    platform = release.host_platform()
    with tempfile.TemporaryDirectory(prefix='r2d-sdk-package-') as tmp:
        release.package_platform(release.Runner(False), platform, ROOT+'/build/russiano2d', tmp+'/out', False, release.read_version())
        archive = Path(tmp)/'out'/('russiano2d-'+platform+'.'+release.PLATFORMS[platform][2])
        unpack = Path(tmp)/'unpacked';unpack.mkdir()
        if platform.startswith('windows'):
            import zipfile
            with zipfile.ZipFile(archive) as z:z.extractall(unpack)
        else:
            with tarfile.open(archive) as z:z.extractall(unpack, filter='data')
        check((unpack/'sdk/main.js').is_file() and (unpack/'sdk_tools.json').is_file(), 'архив содержит оболочку и реестр')
        check(not (unpack/'sdk/state.local.json').exists() and not (unpack/'sdk/native').exists(), 'в пакет не попали локальное состояние и исходники backend')
        for row in (unpack/'SHA256SUMS.txt').read_text().splitlines():
            digest, path = row.split('  ',1)
            assert hashlib.sha256((unpack/path).read_bytes()).hexdigest()==digest,path
        check(True, 'все файлы распакованного пакета соответствуют SHA256SUMS')
        suffix=release.PLATFORMS[platform][1]
        engine=str(unpack/('russiano2d'+suffix));tool=str(unpack/('r2d-sdk'+suffix))
        def command(args):
            r=subprocess.run([tool]+args,cwd=unpack,text=True,capture_output=True,timeout=60)
            assert r.returncode==0,r.stdout+r.stderr
            result=json.loads(r.stdout);assert result['ok'],result
            return result
        check(len(command(['tools'])['tools'])==18, 'нативный CLI находит реестр без checkout')
        check(len(command(['templates'])['templates'])==4, 'нативный CLI находит шаблоны без checkout')
        project=str(Path(tmp)/'new-game')
        command(['new','blank',project,'--name','Packaged SDK game'])
        check(Path(project,'main.js').is_file(), 'нативный SDK создаёт обычный проект')
        command(['run',project,'--headless','--frames','8'])
        check(True,'проект запускается соседним runtime пакета')
        output=str(Path(tmp)/('standalone'+suffix))
        command(['build',project,'--out',output,'--no-encrypt'])
        with Agent(binary=output,game=None,cwd=tmp) as game:
            game.step(5)
            check(game.eval('$.world.count()')>0,'игра из пакетного SDK работает самостоятельно')
        with Agent(binary=engine,game='sdk',cwd=str(unpack),timeout=60) as a:
            def idle():
                for _ in range(500):
                    a.step(2)
                    if a.eval('$.sdkApp.state.busy')==0:return
                raise AssertionError('SDK timeout')
            a.step(20);idle()
            check(a.eval('$.sdk.available()') and a.eval('$.sdkApp.snapshot().registry.tools.length')==18,'GUI SDK запускается и загружает 18 инструментов')
            a.eval('$.sdkApp.openProject('+json.dumps(project)+')');idle()
            a.eval('$.sdkApp.loadTemplates()');idle()
            a.screenshot(ROOT+'/build/sdk_package_shell.png')
            check(a.eval('$.sdkApp.snapshot().templates.count')==4,'GUI SDK загружает шаблоны в распакованном пакете')
    print('Все проверки пройдены (%s)' % count)
    return 0

if __name__=='__main__':sys.exit(main())
