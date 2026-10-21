#!/usr/bin/env python3
"""Exercise release Git protection against ignored, staged and secret files."""
import contextlib
import importlib.util
import io
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('guard', ROOT / 'tools/release_git_guard.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    subprocess.run(['git', 'init', '-q', str(root)], check=True)
    guard.ROOT = root

    def git(*args):
        subprocess.run(['git', '-C', str(root), *args], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

    def audit():
        with contextlib.redirect_stdout(io.StringIO()) as out:
            code = guard.audit()
        return code, out.getvalue()

    (root / '.gitignore').write_text('.env.*\nstate.local.json\n')
    (root / 'main.js').write_text('$.ready(() => {});\n')
    (root / '.env.release').write_text('local-only\n')
    (root / 'state.local.json').write_text('{}\n')
    git('add', '-A')
    assert audit()[0] == 0, 'ignored local files should stay local'
    git('add', '-f', '.env.release')
    assert audit()[0] == 1 and '.env.release' in audit()[1], 'force-add must be rejected'
    git('rm', '--cached', '.env.release')
    assert (root / '.env.release').is_file(), 'local file must remain on disk'
    (root / 'PRIVATE_PROMPT.md').write_text('private task\n')
    assert audit()[0] == 1, 'a new prompt must be rejected before staging'
    (root / 'PRIVATE_PROMPT.md').unlink()
    token = 'ghp_' + 'x' * 40
    (root / 'main.js').write_text('const token = "' + token + '";\n')
    code, output = audit()
    assert code == 1 and token not in output, 'credential should be rejected without printing it'
    assert guard.private_path('dist/macos-arm64/.DS_Store')
    assert guard.private_path('projects/personal/project.json')
    assert guard.private_path('docs/CLAUDE_EDITOR_HANDOFF_2026-10-20.md')
    assert not guard.private_path('games/neon-courier/main.js')
    assert not guard.private_path('src/re2d_world_secret.c')
    (root / 'main.js').write_text('$.ready(() => {});\n')
    (root / 'PRIVATE_PROMPT.md').write_text('private task\n')
    git('add', '-A')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'private')
    git('rm', 'PRIVATE_PROMPT.md')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'remove at tip')
    assert audit()[0] == 1 and '[unpublished history]' in audit()[1], 'tip deletion must not hide outgoing private history'
print('PASS: Git release guard rejects private paths, forced staging and credentials')
