"""Release package contract: one r2d executable, Editor data, and templates."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
from agent_client import Agent, ROOT
import release

ENGINE = os.environ.get('R2D_BINARY', os.path.join(
    ROOT, 'build-xmake', 'macos-arm64', 'macosx', 'arm64', 'release', 'r2d'))


def check(ok, text):
    assert ok, text
    print('  ok   ' + text, flush=True)


def main():
    platform = release.host_platform()
    version = release.read_version()
    with tempfile.TemporaryDirectory(prefix='r2d-package-') as tmp:
        out = Path(tmp) / 'out'
        release.package_platform(release.Runner(False), platform, ENGINE,
                                 str(out), False, version)
        archive = out / release.archive_name(platform, version)
        unpack = Path(tmp) / 'unpacked'
        unpack.mkdir()
        if archive.suffix == '.zip':
            import zipfile
            with zipfile.ZipFile(archive) as z:
                z.extractall(unpack)
        else:
            with tarfile.open(archive) as t:
                t.extractall(unpack, filter='data')

        binary = unpack / ('r2d.exe' if platform.startswith('windows') else 'r2d')
        check(binary.is_file(), 'пакет содержит единственный r2d executable')
        check((unpack / 'editor/main.js').is_file()
              and (unpack / 'editor/project.json').is_file(),
              'Project Manager и Editor включены в пакет')
        check((unpack / 'templates/blank/template.json').is_file(),
              'шаблоны доступны вне checkout')
        check((unpack / 'VERSION').read_text().strip() == version,
              'VERSION пакета совпадает с xmake target')
        forbidden = [p for p in unpack.rglob('*') if p.name in {
            'russiano2d', 'russiano2d.exe', 'r2d-sdk', 'r2d-sdk.exe',
            'russiano2d-sdk', 'russiano2d-sdk.exe', 'Russiano2D SDK.app'}]
        check(not forbidden, 'в пакете отсутствуют старые движок/SDK executables и app bundle')

        env = os.environ.copy()
        env['R2D_BINARY'] = str(binary)
        commands = subprocess.run([str(binary), 'commands', '--json'], cwd=unpack,
                                  env=env, text=True, capture_output=True, timeout=60)
        check(commands.returncode == 0 and '"ok":true' in commands.stdout,
              'CLI-команды работают через тот же r2d')
        with Agent(binary=str(binary), game=None, cwd=str(unpack), seed=18) as game:
            game.step(5)
            check(game.eval('typeof $') == 'function',
                  'code-first JavaScript запускается напрямую из пакета')

        check((out / platform / 'SHA256SUMS.txt').is_file(),
              'пакет содержит SHA256 manifest')
        sums = (out / platform / 'SHA256SUMS.txt').read_text().splitlines()
        for row in sums:
            digest, rel = row.split('  ', 1)
            check(hashlib.sha256((out / platform / rel).read_bytes()).hexdigest() == digest,
                  'SHA256 подтверждён: ' + rel)
    return 0


if __name__ == '__main__':
    sys.exit(main())
