"""FTP deployment prunes only removed doc pages and retains failed deletions."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
script=Path(__file__).resolve().parents[1]/'site/deploy-fast.sh'
with tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);shutil.copy2(script,root/'deploy-fast.sh')
    (root/'.env.deploy').write_text('DEPLOY_HOST=example.invalid\nDEPLOY_USER=test\nDEPLOY_PASS=test\n')
    (root/'doc').mkdir();(root/'doc/new.md').write_text('current')
    (root/'.deploy-state').write_text('doc/old.md\t1:1\told\nother/keep.md\t1:1\told\n')
    (root/'mock').mkdir()
    curl=root/'mock/curl'
    curl.write_text('''#!/usr/bin/env python3
import os,sys
args=sys.argv[1:]
if '-Q' in args:
 command=args[args.index('-Q')+1]
 with open('calls','a') as f:f.write(command+'\\n')
 sys.exit(int(os.environ.get('FAIL_DELETE','0')))
for a in args:
 if a.startswith('ftp://') and not a.endswith('/'):
  print('RESULT 0 '+a)
''');curl.chmod(0o755)
    env={**os.environ,'PATH':str(root/'mock')+os.pathsep+os.environ['PATH'],'FAIL_DELETE':'1','DEPLOY_INVENTORY':'0'}
    r=subprocess.run(['bash','deploy-fast.sh','--go'],cwd=root,env=env,capture_output=True,text=True)
    assert r.returncode==1,(r.stdout,r.stderr)
    assert 'doc/old.md' in (root/'.deploy-state').read_text()
    env['FAIL_DELETE']='0'
    r=subprocess.run(['bash','deploy-fast.sh','--go'],cwd=root,env=env,capture_output=True,text=True)
    assert r.returncode==0,(r.stdout,r.stderr)
    assert 'doc/old.md' not in (root/'.deploy-state').read_text()
    assert (root/'calls').read_text().splitlines()==['DELE doc/old.md','DELE doc/old.md']
    print('PASS: obsolete doc removed, other paths untouched, failed deletion retried')
