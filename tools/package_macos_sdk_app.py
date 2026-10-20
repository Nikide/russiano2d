#!/usr/bin/env python3
"""Assemble a self-contained Finder-launchable macOS SDK application."""

import argparse
import os
from pathlib import Path
import plistlib
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import release  # noqa: E402


def copy_tree(source: Path, destination: Path) -> None:
    if not source.exists():
        raise SystemExit(f"required app resource missing: {source}")
    if source.is_dir():
        shutil.copytree(source, destination, dirs_exist_ok=True,
                        ignore=release.package_ignore)
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True, type=Path)
    parser.add_argument("--engine", required=True, type=Path)
    parser.add_argument("--launcher", required=True, type=Path)
    parser.add_argument("--backend", required=True, type=Path)
    parser.add_argument("--source-root", type=Path, default=ROOT)
    args = parser.parse_args()

    app = args.app.resolve()
    contents = app / "Contents"
    macos = contents / "MacOS"
    resources = contents / "Resources"
    if app.exists():
        shutil.rmtree(app)
    macos.mkdir(parents=True)
    resources.mkdir(parents=True)

    for source in (args.engine, args.launcher, args.backend):
        if not source.is_file():
            raise SystemExit(f"required executable missing: {source}")
    shutil.copy2(args.engine, macos / "russiano2d")
    shutil.copy2(args.launcher, macos / "russiano2d-sdk")
    shutil.copy2(args.backend, macos / "r2d-sdk")
    for executable in macos.iterdir():
        if executable.is_file():
            executable.chmod(0o755)

    source_root = args.source_root.resolve()
    for relative in ("sdk", "sdk_tools.json", "docs", "api.schema.json",
                     "russiano2d.d.ts"):
        source = source_root / relative
        if source.exists():
            copy_tree(source, resources / relative)
    if not (resources / "sdk" / "project.json").is_file():
        raise SystemExit("SDK project was not copied into the app bundle")

    version = release.read_version()
    info = {
        "CFBundleDevelopmentRegion": "ru",
        "CFBundleDisplayName": "Russiano2D SDK",
        "CFBundleExecutable": "russiano2d-sdk",
        "CFBundleIdentifier": "ru.nikiniki.russiano2d.sdk",
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": "Russiano2D SDK",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": version,
        "CFBundleVersion": version,
        "LSMinimumSystemVersion": "12.0",
        "NSHighResolutionCapable": True,
    }
    with (contents / "Info.plist").open("wb") as stream:
        plistlib.dump(info, stream, sort_keys=True)

    executables = [str(path) for path in macos.iterdir() if path.is_file()]
    release.bundle_macos_libs(str(macos), executables)
    print(f"macOS app: {app}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
