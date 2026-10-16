"""Настоящий архив SDK: распаковка, CLI, GUI, шаблон, Run и Package.

Проверяется и содержимое дистрибутива (docs/PRODUCTION_READINESS.md §30,
docs/BUILD.md): обязательные файлы и их отсутствие, SHA256SUMS, VERSION,
отсутствие кэшей/save.json/исходников backend, и воспроизводимость — повторная
упаковка того же дерева даёт побайтно тот же архив и те же суммы.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from agent_client import Agent, ROOT
import release

#: Движок для упаковки: в CI это build-ci/russiano2d, локально build/russiano2d.
ENGINE_BINARY = os.environ.get('R2D_BINARY', os.path.join(ROOT, 'build', 'russiano2d'))


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    count = 0
    def check(ok, text):
        nonlocal count
        assert ok, text
        count += 1
        print('  ok   ' + text, flush=True)
    platform = release.host_platform()
    suffix = release.PLATFORMS[platform][1]
    version = release.read_version()
    with tempfile.TemporaryDirectory(prefix='r2d-sdk-package-') as tmp:
        out1, out2 = tmp + '/out1', tmp + '/out2'
        release.package_platform(release.Runner(False), platform,
                                 ENGINE_BINARY, out1, False, version)
        archive = Path(out1) / release.archive_name(platform, version)
        unpack = Path(tmp) / 'unpacked'
        unpack.mkdir()
        if platform.startswith('windows'):
            import zipfile
            with zipfile.ZipFile(archive) as z:
                z.extractall(unpack)
        else:
            with tarfile.open(archive) as z:
                z.extractall(unpack, filter='data')
        check((unpack / 'sdk/main.js').is_file() and (unpack / 'sdk_tools.json').is_file(),
              'архив содержит оболочку и реестр')
        check(not (unpack / 'sdk/state.local.json').exists()
              and not (unpack / 'sdk/native').exists(),
              'в пакет не попали локальное состояние и исходники backend')
        # --- Содержимое пакета (docs/BUILD.md «Что внутри дистрибутива») ----
        check((unpack / ('russiano2d' + suffix)).is_file()
              and (unpack / ('r2d-sdk' + suffix)).is_file(),
              'в пакете оба бинарника: движок и r2d-sdk')
        check((unpack / 'VERSION').read_text(encoding='utf-8').strip() == version,
              'VERSION называет версию из CMakeLists.txt (%s)' % version)
        check(all((unpack / name).is_file() for name in
                  ('LICENSE', 'CHANGELOG.md', 'THIRD_PARTY_NOTICES.md',
                   'README.md', 'AGENTS.md', 'docs/BUILD.md')),
              'в пакете лицензия, changelog, README/AGENTS и документация сборки')
        check((unpack / 'game').is_dir() and (unpack / 'assets').is_dir(),
              'данные игры на месте: game/ и assets/')
        check(not (unpack / 'demos').exists(),
              'demos/ не уезжает без --with-demos (260 МБ 3D-демо необязательны)')
        check(not (unpack / 'save.json').exists(),
              'save.json пользователя не уезжает в пакет')
        junk = [p for p in unpack.rglob('*')
                if p.name in ('__pycache__', '.DS_Store') or p.suffix in ('.pyc', '.pyo')]
        check(not junk, 'в пакете нет кэшей и мусора (%d файлов)' % len(junk))
        # --- SHA256SUMS ------------------------------------------------------
        sums = (unpack / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines()
        listed = set()
        for row in sums:
            digest, path = row.split('  ', 1)
            listed.add(path)
            assert hashlib.sha256((unpack / path).read_bytes()).hexdigest() == digest, path
        check(True, 'все файлы распакованного пакета соответствуют SHA256SUMS')
        actual = {str(p.relative_to(unpack)).replace(os.sep, '/')
                  for p in unpack.rglob('*') if p.is_file()}
        check(actual - {'SHA256SUMS.txt'} == listed,
              'SHA256SUMS перечисляет ровно файлы пакета (%d)' % len(listed))
        check('VERSION' in listed, 'VERSION под контрольной суммой')
        # --- Воспроизводимость ------------------------------------------------
        release.package_platform(release.Runner(False), platform,
                                 ENGINE_BINARY, out2, False, version)
        archive2 = Path(out2) / archive.name
        check(sha256(archive) == sha256(archive2),
              'повторная упаковка даёт побайтно тот же архив (SHA256 совпал)')
        check((Path(out1) / platform / 'SHA256SUMS.txt').read_text(encoding='utf-8')
              == (Path(out2) / platform / 'SHA256SUMS.txt').read_text(encoding='utf-8'),
              'внутренние SHA256SUMS двух упаковок совпали')
        check((Path(out1) / 'SHA256SUMS.txt').read_text(encoding='utf-8')
              == (Path(out2) / 'SHA256SUMS.txt').read_text(encoding='utf-8'),
              'сводные SHA256SUMS (по архивам) тоже совпали')
        # --- CLI/GUI из распакованного пакета ---------------------------------
        engine = str(unpack / ('russiano2d' + suffix))
        tool = str(unpack / ('r2d-sdk' + suffix))

        def command(args):
            r = subprocess.run([tool] + args, cwd=unpack, text=True, capture_output=True, timeout=60)
            assert r.returncode == 0, r.stdout + r.stderr
            result = json.loads(r.stdout)
            assert result['ok'], result
            return result

        tools_count = len(json.load(open(os.path.join(ROOT, 'sdk_tools.json'), encoding='utf-8'))['tools'])
        check(len(command(['tools'])['tools']) == tools_count, 'нативный CLI находит реестр без checkout')
        check(len(command(['templates'])['templates']) == 4, 'нативный CLI находит шаблоны без checkout')
        project = str(Path(tmp) / 'new-game')
        command(['new', 'blank', project, '--name', 'Packaged SDK game'])
        check(Path(project, 'main.js').is_file(), 'нативный SDK создаёт обычный проект')
        command(['run', project, '--headless', '--frames', '8'])
        check(True, 'проект запускается соседним runtime пакета')
        output = str(Path(tmp) / ('standalone' + suffix))
        command(['build', project, '--out', output, '--no-encrypt'])
        with Agent(binary=output, game=None, cwd=tmp) as game:
            game.step(5)
            check(game.eval('$.world.count()') > 0, 'игра из пакетного SDK работает самостоятельно')
        # Окно видимое: снимок кадра требует настоящего swapchain, а у скрытого
        # окна на Vulkan SDL отдаёт NULL (и движок честно отвечает ошибкой).
        # В CI этот шаг идёт под Xvfb, поэтому видимое окно — рабочий путь, и
        # снимок из РАСПАКОВАННОГО пакета проверяется по-настоящему.
        with Agent(binary=engine, game='sdk', cwd=str(unpack), timeout=60,
                   headless=False) as a:
            def idle():
                for _ in range(500):
                    a.step(2)
                    if a.eval('$.sdkApp.state.busy') == 0:
                        return
                raise AssertionError('SDK timeout')
            a.step(20)
            idle()
            check(a.eval('$.sdk.available()')
                  and a.eval('$.sdkApp.snapshot().registry.tools.length') == tools_count,
                  'GUI SDK запускается и загружает все инструменты реестра')
            check(a.eval('$.sdkApp.snapshot().version') == version,
                  'GUI показывает версию нативного SDK из CMakeLists.txt')
            a.eval('$.sdkApp.openProject(' + json.dumps(project) + ')')
            idle()
            a.eval('$.sdkApp.loadTemplates()')
            idle()
            shot = Path(ROOT) / 'build' / 'sdk_package_shell.png'
            shot.parent.mkdir(parents=True, exist_ok=True)
            a.screenshot(str(shot))
            check(a.eval('$.sdkApp.snapshot().templates.count') == 4,
                  'GUI SDK загружает шаблоны в распакованном пакете')
    print('Все проверки пройдены (%s)' % count)
    return 0


if __name__ == '__main__':
    sys.exit(main())
