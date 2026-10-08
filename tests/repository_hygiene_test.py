#!/usr/bin/env python3
"""Tracked-file, local Markdown and shipped-package integrity checks (stdlib)."""
from pathlib import Path, PurePosixPath
import hashlib
import re
import subprocess
import tarfile
import urllib.parse
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TRACKED = subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True).splitlines()
ERRORS = []


def check(ok, description):
    print(('  ok   ' if ok else '  FAIL ') + description)
    if not ok:
        ERRORS.append(description)


def junk(name):
    path = PurePosixPath(name)
    return path.name == '.DS_Store' or '__pycache__' in path.parts or path.suffix in ('.pyc', '.pyo')


def verify_sums(data, reader, label):
    errors = []
    for line in data.decode('utf-8').splitlines():
        if not line.strip():
            continue
        digest, name = line.split('  ', 1)
        try:
            if hashlib.sha256(reader(name)).hexdigest() != digest:
                errors.append(name)
        except (KeyError, FileNotFoundError):
            errors.append(name)
    check(not errors, label + ': checksums ' + str(errors))


existing = [name for name in TRACKED if (ROOT / name).exists()]
check(not [n for n in existing if junk(n)], 'tracked files contain no OS/Python caches')
check(not [n for n in existing if re.search(r'(^|/)_tmp_|\.cleanup\.tmp$', n)], 'tracked files contain no temporary scratch files')
missing = []
for name in existing:
    if not name.endswith('.md') or name.startswith(('dist/', 'deliverables/')):
        continue  # Published docs are snapshots, not the live Markdown source tree.
    path = ROOT / name
    text = re.sub(r'```.*?```', '', path.read_text(encoding='utf-8'), flags=re.S)
    for match in re.finditer(r'!?\[[^\]\n]*\]\(([^\n]+?)\)', text):
        url = match.group(1).strip().split(' "')[0].strip('<>')
        if re.match(r'[a-zA-Z][a-zA-Z0-9+.-]*:', url) or url.startswith('//'):
            continue
        target = urllib.parse.unquote(url.split('#')[0].split('?')[0])
        if target and not (path.parent / target).exists():
            missing.append(name + ': ' + target)
check(not missing, 'live Markdown local targets exist: ' + str(missing))
for manifest in sorted((ROOT / 'dist').glob('*/SHA256SUMS.txt')):
    verify_sums(manifest.read_bytes(), lambda n: (manifest.parent / n).read_bytes(), str(manifest.relative_to(ROOT)))
verify_sums((ROOT / 'dist/SHA256SUMS.txt').read_bytes(), lambda n: (ROOT / 'dist' / n).read_bytes(), 'release archive manifest')
for path in sorted((ROOT / 'dist').glob('russiano2d-*')):
    if path.suffix == '.zip':
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            check(not [n for n in names if junk(n)], path.name + ': no OS/Python caches')
            manifests = [n for n in names if PurePosixPath(n).name == 'SHA256SUMS.txt']
            check(len(manifests) == 1, path.name + ': one package manifest')
            for manifest in manifests:
                prefix = manifest.rsplit('/', 1)[0] + '/' if '/' in manifest else ''
                verify_sums(archive.read(manifest), lambda n: archive.read(prefix + n), path.name)
    elif path.name.endswith('.tar.gz'):
        with tarfile.open(path) as archive:
            names = archive.getnames()
            check(not [n for n in names if junk(n)], path.name + ': no OS/Python caches')
            manifests = [n for n in names if PurePosixPath(n).name == 'SHA256SUMS.txt']
            check(len(manifests) == 1, path.name + ': one package manifest')
            for manifest in manifests:
                prefix = manifest.rsplit('/', 1)[0] + '/' if '/' in manifest else ''
                verify_sums(archive.extractfile(manifest).read(), lambda n: archive.extractfile(prefix + n).read(), path.name)
print('\nFailures:', len(ERRORS))
raise SystemExit(bool(ERRORS))
