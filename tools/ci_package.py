"""Normalize multi-config executables, collect libraries, package with SDK."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import release
import autobuild
p=argparse.ArgumentParser()
p.add_argument('--build-dir', required=True)
p.add_argument('--platform', required=True, choices=release.PLATFORMS)
a=p.parse_args()
build=Path(a.build_dir).resolve()
suffix='.exe' if a.platform.startswith('windows') else ''
for name in ['russiano2d', 'r2d-sdk']:
    target=build/(name+suffix)
    if not target.exists():
        source=next(build.rglob(name+suffix))
        shutil.copy2(source,target)
for dll in list(build.rglob('*.dll')):
    if dll.parent != build:
        shutil.copy2(dll,build/dll.name)
if a.platform.startswith('linux'):
    autobuild.collect_native_libs(build/('russiano2d'+suffix))
subprocess.run([sys.executable,'tools/release.py','--package-only','--platform',a.platform,'--binary',str(build/('russiano2d'+suffix)),'--out','dist-ci','--force'],check=True)
