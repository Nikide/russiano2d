#!/usr/bin/env python3
"""Generate and verify all derived $ API documentation artifacts."""
import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANSI = re.compile(r"\x1b\[[0-9;]*m")
GAME = "tests/fixtures/hello"


def run(command: list[str]) -> bool:
    print("+", " ".join(command), flush=True)
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode:
        print(f"failed ({result.returncode}): {' '.join(command)}", file=sys.stderr)
        return False
    return True


def configured_binary() -> Path | None:
    result = subprocess.run(
        ["xmake", "show", "-t", "r2d"], cwd=ROOT, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    if result.returncode:
        return None
    for line in ANSI.sub("", result.stdout).splitlines():
        match = re.match(r"\s*targetfile\s*:\s*(.*?)\s*$", line)
        if match:
            candidate = Path(match.group(1))
            return candidate if candidate.is_absolute() else ROOT / candidate
    return None


def resolve_binary(argument: str | None) -> Path | None:
    selected = argument or os.environ.get("R2D_BINARY")
    binary = Path(selected) if selected else configured_binary()
    if binary and not binary.is_absolute():
        binary = ROOT / binary
    if binary and binary.is_file():
        return binary
    return None


def check(binary: Path) -> bool:
    steps = [
        [sys.executable, "scripts/generate_api_docs_catalog.py", "--check"],
        [str(binary), "api", "check", "--game", GAME, "--schema", "api.schema.json"],
        [str(binary), "doctor", "--project", GAME, "--game", GAME, "--schema", "api.schema.json"],
        [sys.executable, "tests/api_docs_sync_test.py"],
    ]
    for command in steps:
        if not run(command):
            return False
    print("API docs: all generated artifacts are fresh")
    return True


def refresh(binary: Path) -> bool:
    """Refresh versioned artifacts from an already built release binary.

    Authored API help must already be embedded in every platform binary.
    This step writes schema/types/reference only; it never rebuilds a target.
    """
    if not run([sys.executable, "scripts/generate_api_docs_catalog.py", "--check"]):
        return False
    if not run([str(binary), "api", "generate", "--game", GAME, "--out-dir", "."]):
        return False
    return check(binary)


def generate(binary_argument: str | None, jobs: int) -> bool:
    if not run(["xmake", "build", "-y", "-j", str(jobs), "r2d"]):
        return False
    binary = resolve_binary(binary_argument)
    if not binary:
        print("cannot locate the configured r2d binary; set R2D_BINARY", file=sys.stderr)
        return False

    api_generate = [str(binary), "api", "generate", "--game", GAME, "--out-dir", "."]
    if not run(api_generate):
        return False
    if not run([sys.executable, "scripts/generate_api_docs_catalog.py"]):
        return False
    if not run(["xmake", "build", "-y", "-j", str(jobs), "r2d"]):
        return False

    # The runtime embeds the editor catalog. Refresh the API artifacts once
    # more after embedding it, then compare everything without writing files.
    binary = resolve_binary(binary_argument) or binary
    if not run([str(binary), "api", "generate", "--game", GAME, "--out-dir", "."]):
        return False
    return check(binary)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("generate", "refresh", "check"))
    parser.add_argument("--binary", help="r2d executable (defaults to R2D_BINARY or active xmake target)")
    parser.add_argument("--jobs", type=int, default=8, help="parallel xmake jobs during generation")
    args = parser.parse_args()

    if args.mode == "generate":
        if args.jobs < 1:
            parser.error("--jobs must be positive")
        return 0 if generate(args.binary, args.jobs) else 1
    binary = resolve_binary(args.binary)
    if not binary:
        print("cannot locate r2d; pass --binary or set R2D_BINARY", file=sys.stderr)
        return 2
    if args.mode == "refresh":
        return 0 if refresh(binary) else 1
    return 0 if check(binary) else 1


if __name__ == "__main__":
    raise SystemExit(main())
