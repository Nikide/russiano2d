"""Three git targets: failure must not prevent the third push; verify tags too."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
spec=importlib.util.spec_from_file_location('publish_refs',Path(__file__).resolve().parents[1]/'tools/publish_refs.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def git(*args):
    return subprocess.run(['git',*args],check=True,capture_output=True,text=True).stdout.strip()
with tempfile.TemporaryDirectory() as tmp:
    old=os.getcwd();os.chdir(tmp)
    try:
        for name in ['first','third']:git('init','--bare',name)
        git('init','work');os.chdir('work')
        git('config','user.email','test@example.invalid');git('config','user.name','Test')
        Path('data').write_text('test');git('add','data');git('commit','-m','test')
        branch=git('branch','--show-current');git('tag','-a','v1.0.0','-m','test')
        git('remote','add','first',str(Path(tmp)/'first'))
        git('remote','add','broken',str(Path(tmp)/'missing'))
        git('remote','add','third',str(Path(tmp)/'third'))
        git('remote','add','duplicate',str(Path(tmp)/'third'))
        results=m.publish(['first','broken','third','duplicate'],['refs/heads/'+branch,'refs/tags/v1.0.0'])
        assert [r['ok'] for r in results]==[True,False,True],results
        assert git('--git-dir',str(Path(tmp)/'third'),'rev-parse','refs/tags/v1.0.0')==git('rev-parse','refs/tags/v1.0.0')
        print('PASS: third mirror receives branch/tag after second fails; duplicate skipped')
    finally:os.chdir(old)
