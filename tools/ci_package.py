"""Normalize the Xmake r2d output and package the single application."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import release

p = argparse.ArgumentParser()
p.add_argument('--build-dir', required=True)
p.add_argument('--platform', required=True, choices=release.PLATFORMS)
a = p.parse_args()
build = Path(a.build_dir).resolve()
name = release.binary_name(a.platform)
binary = build / name
if not binary.exists():
    matches = list(build.rglob(name))
    if not matches:
        raise SystemExit('не найден единственный executable %s в %s' % (name, build))
    binary = matches[0]
    shutil.copy2(binary, build / name)
    binary = build / name
subprocess.run([
    sys.executable, 'tools/release.py', '--package-only', '--platform', a.platform,
    '--binary', str(binary), '--out', 'dist-ci', '--force'
], check=True)
expected = Path('dist-ci') / release.archive_name(a.platform, release.read_version())
if not expected.is_file():
    raise SystemExit('нет архива с ожидаемым именем: %s' % expected)
print('  ok   имя артефакта по контракту: %s' % expected.name)
