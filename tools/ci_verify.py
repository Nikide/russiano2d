"""Native/JS checks shared by all hosted platforms; no GPU required."""
import argparse
from pathlib import Path
import subprocess
p = argparse.ArgumentParser()
p.add_argument('--build-dir', required=True)
build = Path(p.parse_args().build_dir)
def executable(name):
    candidates = [f for f in build.rglob(name) if f.is_file()]
    candidates += [f for f in build.rglob(name + '.exe') if f.is_file()]
    if not candidates:
        raise RuntimeError('Missing executable: ' + name)
    return candidates[0].resolve()
for name in ['json', 'crypto', 'payload', 'reverb', 'audio_fx', 'profile', 'bsp', 'rotsprite', 're2d', 're2d_world']:
    subprocess.run([str(executable('r2d_' + name + '_test'))], check=True)
subprocess.run([str(executable('r2d_sdk_core_test'))], check=True)
# r2d-help: формат индекса, BM25 и сбор корпуса из этого дерева (docs/HELP.md)
subprocess.run([str(executable('r2d_help_test')), '.'], check=True)
qjs = executable('qjs')
for test in sorted(Path('tests/js').glob('*_test.mjs')):
    subprocess.run([str(qjs), str(test)], check=True)
subprocess.run([str(executable('r2d-sdk')), 'batch', 'tests/fixtures/sdk/ci.batch.json', '--output', str(build/'sdk-ci-report.json')], check=True)
