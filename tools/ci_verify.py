"""Native/JS checks shared by all hosted platforms; no GPU required.

Две конфигурации сборки, и проверка знает про обе:

* ``R2D_ENABLE_RE2D=ON`` (по умолчанию) — собираются и запускаются все тесты,
  включая C-тесты 3D-авторинга (``r2d_re2d_test``, ``r2d_re2d_world_test``,
  ``r2d_world_exr_test``), в дереве сборки копируется ``demos/``;
* ``R2D_ENABLE_RE2D=OFF`` — ``--re2d off``: целей RE2D в сборке нет, и проверка
  не ищет их, а **требует**, чтобы их не было. Так «RE2D выключен» проверяется
  фактом, а не обещанием: если цель или объект вдруг появились, прогон падает.

Что именно закреплено (docs/PRODUCTION_READINESS.md §30, docs/BUILD.md):

* переданный ``--re2d`` обязан совпадать с ``R2D_ENABLE_RE2D`` в
  ``CMakeCache.txt`` — иначе легко «проверить» не ту сборку и не заметить;
* объекты движка из ``re2d*``/``rotsprite*``/``real2d*``/``world_exr*`` есть
  ровно в ON-сборке и отсутствуют в OFF (тестовые объекты не считаем: у Ninja
  остаются устаревшие файлы от прежней конфигурации);
* каталог ``demos/`` рядом с бинарником есть ровно в ON-сборке
  (src/CMakeLists.txt: R2D_DATA_DIRS);
* доступность модулей ``$.re2d/$.rotsprite/$.real2d`` проверяется рантайм-пробой
  в ``tests/agent/build_test.py`` (здесь нет окна и GPU).
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--build-dir', required=True)
p.add_argument('--re2d', choices=['on', 'off'], default='on',
               help='R2D_ENABLE_RE2D, с которым собрана сборка (по умолчанию on)')
p.add_argument('--web', action='store_true',
               help='проверить web-экспорт; без emsdk шаг честно пропускается')
p.add_argument('--config-only', action='store_true',
               help='только проверка конфигурации (RE2D и данные), без тестов')
args = p.parse_args()
build = Path(args.build_dir)
re2d = args.re2d == 'on'

failures = []
#: Префиксы объектных файлов необязательного слоя 3D-авторинга.
RE2D_OBJECT_PREFIXES = ('re2d', 'rotsprite', 'real2d', 'world_exr')


def fail(message):
    failures.append(message)


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


def cfg_flag():
    """R2D_ENABLE_RE2D из CMakeCache.txt: 'ON' | 'OFF' | None (нет кэша)."""
    cache = build / 'CMakeCache.txt'
    if not cache.is_file():
        fail('нет %s: нельзя подтвердить конфигурацию сборки' % cache)
        return None
    match = re.search(r'^R2D_ENABLE_RE2D:BOOL=(ON|OFF)\s*$',
                      cache.read_text(encoding='utf-8', errors='replace'), re.M)
    if not match:
        fail('в %s нет записи R2D_ENABLE_RE2D' % cache)
        return None
    return match.group(1)


def engine_re2d_objects():
    """Объектные файлы движка из 3D-слоя (каталог russiano2d.dir, не тесты)."""
    found = []
    for path in build.rglob('*'):
        if not path.is_file() or path.suffix.lower() not in ('.o', '.obj'):
            continue
        if 'russiano2d.dir' not in path.as_posix():
            continue
        stem = path.name.split('.')[0].lower()
        if stem.startswith(RE2D_OBJECT_PREFIXES):
            found.append(path)
    return found


def demos_data_dir():
    """Каталог demos/, скопированный сборкой рядом с бинарником (R2D_DATA_DIRS)."""
    for candidate in (build / 'demos', build / 'Release' / 'demos', build / 'RelWithDebInfo' / 'demos'):
        if candidate.is_dir():
            return candidate
    return None


def check_configuration():
    configured = cfg_flag()
    if configured is None:
        return
    if (configured == 'ON') != re2d:
        fail('--re2d %s, но %s собран с R2D_ENABLE_RE2D=%s'
             % (args.re2d, build, configured))
        return
    print('  ok   конфигурация: %s собран с R2D_ENABLE_RE2D=%s' % (build, configured))


def check_re2d_layer():
    objects = engine_re2d_objects()
    demos = demos_data_dir()
    if re2d:
        if not objects:
            fail('R2D_ENABLE_RE2D=ON, но объектов 3D-слоя в движке нет')
        if demos is None:
            fail('R2D_ENABLE_RE2D=ON, но demos/ не скопирован рядом с бинарником')
    else:
        if objects:
            fail('R2D_ENABLE_RE2D=OFF, но в движке есть объекты 3D-слоя: %s'
                 % ', '.join(sorted(o.name for o in objects[:5])))
        if demos is not None:
            fail('R2D_ENABLE_RE2D=OFF, но demos/ скопирован рядом с бинарником: %s' % demos)
    # build.ninja описывает ТЕКУЩУЮ конфигурацию (в отличие от устаревших .o),
    # поэтому объявленные RE2D-цели в OFF-сборке — расхождение.
    ninja = build / 'build.ninja'
    if ninja.is_file():
        text = ninja.read_text(encoding='utf-8', errors='replace')
        declared = sorted(set(re.findall(r'r2d_(?:rotsprite|re2d|re2d_world|world_exr)_test', text)))
        if not re2d and declared:
            fail('R2D_ENABLE_RE2D=OFF, но build.ninja объявляет цели: %s' % ', '.join(declared))
        if re2d and 'r2d_re2d_test' not in text:
            fail('R2D_ENABLE_RE2D=ON, но build.ninja не объявляет r2d_re2d_test')
    print('  ok   слой RE2D: объектов движка %d, demos/ %s'
          % (len(objects), 'есть' if demos else 'нет'))


def check_web_export():
    """Web-экспорт: без emsdk — честный skip с причиной, а не падение."""
    emsdk = os.environ.get('EMSDK')
    emcc = shutil.which('emcc')
    if not emsdk and not emcc:
        print('  skip web: emsdk/emcc не найден (нет установленного Emscripten) — '
              'web-экспорт не проверялся')
        return
    print('  web  emsdk найден (%s): собираю web-экспорт демо' % (emsdk or emcc))
    subprocess.run([sys.executable, 'web/export.py', '--game', 'demos',
                    '--out', str(build / 'web-export')], check=True)


#: Ядро движка: собирается в обеих конфигурациях.
CORE_TESTS = ['json', 'crypto', 'payload', 'reverb', 'audio_fx', 'profile', 'bsp']
#: 3D-авторинг спрайтов: только с R2D_ENABLE_RE2D=ON.
RE2D_TESTS = ['rotsprite', 're2d', 're2d_world', 're2d_atlas', 'world_trace',
              'world_mover', 'world_trigger', 'world_controller', 're2d_semantic',
              're2d_portal', 'world_metadata', 'world_automap', 'world_particle', 'world_nav',
              'world_save', 'world_secret', 'world_terrain', 'world_portal_visual',
              'world_volume', 'world_material_anim', 'world_polywall', 'world_polygon',
              'postprocess', 'audio_zone', 'audio_voices']

check_configuration()
check_re2d_layer()

if args.config_only:
    if failures:
        for line in failures:
            print('  FAIL ' + line, file=sys.stderr)
        sys.exit(1)
    print('  ok  ci_verify: RE2D=%s (только конфигурация)' % ('on' if re2d else 'off'))
    sys.exit(0)

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
            fail('R2D_ENABLE_RE2D=OFF, но цель r2d_%s_test собрана' % name)

subprocess.run([str(executable('r2d_sdk_core_test'))], check=True)

# Web-экспорт проверяем до чистого JS-прогона: без emsdk шаг печатает причину
# пропуска сразу и не мешает остальным проверкам.
if args.web:
    check_web_export()

qjs = executable('qjs')
for test in sorted(Path('tests/js').glob('*_test.mjs')):
    subprocess.run([str(qjs), str(test)], check=True)

sdk_bin = str(executable('r2d-sdk'))
engine_bin = str(executable('russiano2d'))
subprocess.run([sdk_bin, 'batch', 'tests/fixtures/sdk/ci.batch.json',
                '--output', str(build / 'sdk-ci-report.json')], check=True)

# Unified SDK backend gates: metadata/schema/typings/docs freshness, API-aware
# lint, project validation and the doctor health check. No GPU required.
subprocess.run([sdk_bin, 'api', 'check', '--engine', engine_bin, '--game', 'game'], check=True)
subprocess.run([sdk_bin, 'lint', 'game', '--schema', 'api.schema.json'], check=True)
subprocess.run([sdk_bin, 'validate', 'game'], check=True)
subprocess.run([sdk_bin, 'doctor', '--engine', engine_bin, '--project', 'game'], check=True)
subprocess.run([sys.executable, 'tools/sdk_recipes_check.py'], check=True)

if failures:
    for line in failures:
        print('  FAIL ' + line, file=sys.stderr)
    sys.exit(1)
print('  ok  ci_verify: RE2D=%s' % ('on' if re2d else 'off'))
