"""Inventory remote doc Markdown, including pages absent from old manifests."""
import ftplib
import os
from pathlib import Path, PurePosixPath
import re
import sys

ftp=ftplib.FTP()
try:
    ftp.connect(os.environ['DEPLOY_HOST'],int(os.environ.get('DEPLOY_PORT','21')),timeout=20)
    ftp.login(os.environ['DEPLOY_USER'],os.environ['DEPLOY_PASS'])
    todo=['doc']
    while todo:
        folder=todo.pop()
        try: entries=list(ftp.mlsd(folder))
        except ftplib.error_perm:
            if folder=='doc':raise
            continue
        for name,meta in entries:
            if name in ('.','..') or not re.fullmatch(r'[A-Za-z0-9_.-]+',name):continue
            path=PurePosixPath(folder)/name
            if meta.get('type')=='dir':
                todo.append(str(path))
            elif name.endswith('.md') and not Path(str(path)).exists():
                print(path)
    ftp.quit()
except Exception as e:
    print('Remote documentation inventory failed: '+type(e).__name__,file=sys.stderr)
    sys.exit(1)
