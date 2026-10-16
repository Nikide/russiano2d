"""Normalize multi-config executables, collect libraries, package with SDK.

Имя готового архива проверяется здесь же: контракт имени артефакта
(``release.archive_name``) обязан совпасть с тем, что реально лежит в
``dist-ci/``. Иначе Release уехал бы с файлом, которого не ждёт ни локальный
шаг прикладывания macOS, ни проверки в тестах.
"""
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
expected=Path('dist-ci')/release.archive_name(a.platform,release.read_version())
if not expected.is_file():
    print('  FAIL нет архива с ожидаемым именем: %s' % expected, file=sys.stderr)
    print('       в dist-ci/: %s' % ', '.join(sorted(f.name for f in Path('dist-ci').glob('russiano2d-*'))), file=sys.stderr)
    sys.exit(1)
print('  ok   имя артефакта по контракту: %s' % expected.name)
