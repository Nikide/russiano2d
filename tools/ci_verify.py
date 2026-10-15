"""Native/JS checks shared by all hosted platforms; no GPU required.

Две конфигурации сборки, и проверка знает про обе:

* ``R2D_ENABLE_RE2D=ON`` (по умолчанию) — собираются и запускаются все тесты,
  включая C-тесты 3D-авторинга (``r2d_re2d_test``, ``r2d_re2d_world_test``,
  ``r2d_world_exr_test``);
* ``R2D_ENABLE_RE2D=OFF`` — ``--re2d off``: целей RE2D в сборке нет, и проверка
  не ищет их, а **требует**, чтобы их не было. Так «RE2D выключен» проверяется
  фактом, а не обещанием: если цель вдруг появилась, прогон падает.
"""
import argparse
import sys
from pathlib import Path
import subprocess

p = argparse.ArgumentParser()
p.add_argument('--build-dir', required=True)
p.add_argument('--re2d', choices=['on', 'off'], default='on',
               help='R2D_ENABLE_RE2D, с которым собрана сборка (по умолчанию on)')
args = p.parse_args()
build = Path(args.build_dir)
re2d = args.re2d == 'on'

failures = []


def executable(name):
    candidates = [f for f in build.rglob(name) if f.is_file()]
    candidates += [f for f in build.rglob(name + '.exe') if f.is_file()]
    if not candidates:
        raise RuntimeError('Missing executable: ' + name)
    return candidates[0].resolve()


def has(name):
    """Есть ли в сборке исполняемый файл с таким именем (без падения)."""
    return bool([f for f in build.rglob(name) if f.is_file()]
                or [f for f in build.rglob(name + '.exe') if f.is_file()])


#: Ядро движка: собирается в обеих конфигурациях.
CORE_TESTS = ['json', 'crypto', 'payload', 'reverb', 'audio_fx', 'profile', 'bsp']
#: 3D-авторинг спрайтов: только с R2D_ENABLE_RE2D=ON.
RE2D_TESTS = ['rotsprite', 're2d', 're2d_world']

for name in CORE_TESTS:
    subprocess.run([str(executable('r2d_' + name + '_test'))], check=True)

if re2d:
    for name in RE2D_TESTS:
        subprocess.run([str(executable('r2d_' + name + '_test'))], check=True)
    # Тесту нужен настоящий EXR: файл передаётся аргументом (`exr_test.c`
    # без аргумента выходит с кодом 1 — так он отличает «нет входа» от
    # «декодер сломан»). Небо Re2D World лежит в демо Dust2.
    subprocess.run([str(executable('r2d_world_exr_test')), 'demos/re2d_dust2/sky.exr'],
                   check=True)
else:
    for name in RE2D_TESTS + ['world_exr']:
        if has('r2d_' + name + '_test'):
            failures.append('R2D_ENABLE_RE2D=OFF, но цель r2d_%s_test собрана' % name)

subprocess.run([str(executable('r2d_sdk_core_test'))], check=True)

qjs = executable('qjs')
for test in sorted(Path('tests/js').glob('*_test.mjs')):
    subprocess.run([str(qjs), str(test)], check=True)

subprocess.run([str(executable('r2d-sdk')), 'batch', 'tests/fixtures/sdk/ci.batch.json',
                '--output', str(build / 'sdk-ci-report.json')], check=True)

if failures:
    for line in failures:
        print('  FAIL ' + line, file=sys.stderr)
    sys.exit(1)
print('  ok  ci_verify: RE2D=%s' % ('on' if re2d else 'off'))
