#!/usr/bin/env python3
"""Exercise every Inspector field through native package tests on a temp catalog.

No project or builtin manifest is edited. Each invalid value gets its own test,
so one rejected field cannot mask another incorrectly accepted value.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BINARY = os.environ.get('R2D_BINARY', str(ROOT / 'build-xmake/macos-arm64/macosx/arm64/release/r2d'))


def cases(f):
    t = f['type']
    if 'default' in f and f['default'] is not None:
        yield f['default'], False
    yield None, True
    yield {}, True
    if t in ('number', 'int'):
        for key, delta in [('min', -1), ('max', 1)]:
            if key in f:
                yield f[key], False
                yield f[key] + delta, True
        yield '1', True
        if t == 'int':
            yield f.get('min', 0) + 0.5, True
    elif t == 'bool':
        yield True, False
        yield False, False
        yield 1, True
    elif t == 'enum':
        for v in f['options']:
            yield v if isinstance(v, str) else v['value'], False
        yield '__not_an_option__', True
    elif t == 'color':
        for v in ['#000000', '#ffffff', '#00000000', '#FFFFFFFF']:
            yield v, False
        for v in ['#gg0000', '#fff', 'red']:
            yield v, True
    elif t == 'vec2':
        yield [0, -1], False
        for v in [[], [0], [0, 1, 2], ['0', 1]]:
            yield v, True
    elif t == 'list':
        yield [], False
        yield ['русский', ''], False
        yield [1], True
    else:
        yield '', False
        yield 'тест', False
        yield 1, True


def main():
    total = fields = 0
    with tempfile.TemporaryDirectory(prefix='r2d-snip-bounds-') as tmp:
        catalog = Path(tmp) / 'catalog'
        shutil.copytree(ROOT / 'snippets', catalog)
        packages = sorted(catalog.glob('*/snippet.json'))
        assert len(packages) == 500
        for path in packages:
            manifest = json.loads(path.read_text())
            for f in manifest.get('fields', []):
                fields += 1
                for value, invalid in cases(f):
                    rel = 'tests/boundary-%d.json' % total
                    (path.parent / rel).write_text(json.dumps({'values': {f['id']: value}, 'invalid': invalid}, ensure_ascii=False))
                    manifest['tests'].append(rel)
                    total += 1
            path.write_text(json.dumps(manifest, ensure_ascii=False))
        run = subprocess.run([BINARY, 'snippet', 'catalog', '--catalog', str(catalog), '--strict'], cwd=ROOT, capture_output=True, text=True)
        report = json.loads([l for l in run.stdout.splitlines() if l.startswith('{')][-1])
        errors = [d for d in report['diagnostics'] if d['severity'] in ('error', 'fatal')]
        assert run.returncode == 0 and report['ok'] and not errors, errors[:30]
        assert report['total'] == 500
        print('sdk_snippet_boundaries_test: ok (500 packages, %d fields, %d cases)' % (fields, total))

if __name__ == '__main__':
    main()
