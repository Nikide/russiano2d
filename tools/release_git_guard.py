#!/usr/bin/env python3
"""Reject private/local files before staging and committing a release.

Print paths only; never print matched credentials. Ignored files are left alone.
"""
import re
import subprocess
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_ROOTS = {
    "site", "witch_game", "checkpoints", "projects", "local_projects",
    "local-projects", ".zwork", ".dsh", ".claude", ".codex", ".xmake",
    "r2d_replay_test_tmp",
}
LOCAL_SCRIPTS = {
    "build_and_push", "build_and_push.sh", "build_and_push.command",
    "push_and_deploy.sh",
}
SECRET = re.compile(
    rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"
    rb"|\bgh[pousr]_[A-Za-z0-9]{30,}\b"
    rb"|\bgithub_pat_[A-Za-z0-9_]{40,}\b"
    rb"|\bAKIA[A-Z0-9]{16}\b"
)


def private_path(name):
    path = PurePosixPath(name)
    parts = path.parts
    base = path.name.lower()
    if not parts:
        return False
    if parts[0] in PRIVATE_ROOTS or name in LOCAL_SCRIPTS:
        return True
    if parts[0] == "games" and (len(parts) < 2 or parts[1] != "neon-courier"):
        return True
    if any(p in {".DS_Store", "__pycache__", ".claude", ".codex", "secrets"} for p in parts):
        return True
    if base == ".env" or base.startswith(".env.") or path.suffix.lower() in {".env", ".pem", ".key", ".secret", ".pyc", ".pyo", ".ppk"}:
        return True
    if base.startswith("id_rsa") or base in {".ftpconfig", "state.local.json"}:
        return True
    return base.endswith(".md") and (
        "prompt" in base or "handoff" in base
        or base in {"next_session.md", "from_agent_to_agent.md"}
    )


def audit():
    # Includes tracked files and everything `git add -A` would add.
    raw = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT
    )
    names = sorted(set(raw.decode().split("\0")) - {""})
    bad = []
    for name in names:
        if private_path(name):
            bad.append(name + " [local/private path]")
            continue
        path = ROOT / name
        if path.is_file() and not path.is_symlink() and path.stat().st_size <= 4_000_000:
            data = path.read_bytes()
            if b"\0" not in data and SECRET.search(data):
                bad.append(name + " [credential signature]")
    # A deletion at the tip does not remove files from outgoing commits.
    head = subprocess.run(['git', 'rev-parse', '--verify', 'HEAD'], cwd=ROOT,
                          capture_output=True)
    if head.returncode == 0:
        history = subprocess.check_output([
            'git', 'log', '--format=', '--name-only', '--diff-filter=AM',
            '--no-renames', 'HEAD', '--not', '--remotes', '-z'
        ], cwd=ROOT)
        paths = {p.strip() for p in history.decode().split('\0') if p.strip()}
        bad.extend(p + ' [unpublished history]' for p in sorted(paths) if private_path(p))
        patch = subprocess.check_output([
            'git', 'log', '--format=', '--no-ext-diff', '-p',
            'HEAD', '--not', '--remotes'
        ], cwd=ROOT)
        added = b'\n'.join(line[1:] for line in patch.splitlines()
                           if line.startswith(b'+') and not line.startswith(b'+++'))
        if SECRET.search(added):
            bad.append('[credential signature in unpublished history]')
    if bad:
        print("Release Git guard FAILED:")
        for name in bad:
            print("  " + name)
        return 1
    print("Release Git guard: OK (%d candidate paths)" % len(names))
    return 0


if __name__ == "__main__":
    raise SystemExit(audit())
