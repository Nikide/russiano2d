#!/usr/bin/env python3
"""Roadmap §131 native test layout compatibility checker.

The roadmap suggests tests/re2d/{render,bsp,region,pvs,material,sprite,fog,
sky,vfx,streaming}. Moving every C test is risky while other work is landing,
so this checker provides the documented compatibility layout instead:

  * every tracked tests/re2d/*.c is mapped to a proposed subsystem directory;
  * every mapped file must be referenced by a tracked CMakeLists.txt target;
  * every CMake reference to tests/re2d/*.c must resolve on disk;
  * no duplicate test basenames;
  * the mapping is written to tests/re2d/LAYOUT.md (--write) and validated
    there (--check).

The physical files stay flat; CMake and all 163 tests keep working. A future
mechanical move can follow the mapping without guesswork.

Usage:
  python3 tools/test_layout_check.py --check
  python3 tools/test_layout_check.py --check --json
  python3 tools/test_layout_check.py --write
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAYOUT_DOC = ROOT / "tests" / "re2d" / "LAYOUT.md"
SUGGESTED_DIRS = ["core", "world", "bsp", "region", "pvs", "render",
                  "material", "sprite", "fog", "sky", "vfx", "streaming"]

# Explicit map for files whose subsystem is not obvious from the basename.
EXPLICIT = {
    "re2d_test.c": "core",
    "world_test.c": "core",
    "trace_test.c": "core",
    "semantic_test.c": "core",
    "metadata_test.c": "core",
    "atlas_test.c": "sprite",
    "exr_test.c": "sky",
    "polygon_test.c": "world",
    "polywall_test.c": "world",
    "volume_test.c": "world",
    "volume_entity_test.c": "world",
    "secret_test.c": "core",
    "save_test.c": "core",
    "automap_test.c": "core",
    "nav_test.c": "core",
    "controller_test.c": "core",
    "mover_test.c": "core",
    "trigger_test.c": "core",
    "audio_zone_test.c": "core",
    "terrain_test.c": "world",
    "portal_fraction_test.c": "render",
    "portal_visual_test.c": "render",
    "brush_test.c": "world",
    "brush_advanced_fixture_test.c": "world",
    "brush_entity_smoke_test.c": "world",
    "world_tools_test.c": "world",
    "batch_test.c": "render",
    "region_test.c": "region",
    "hint_cache_test.c": "region",
    "hint_visibility_test.c": "pvs",
    "hierarchical_visibility_test.c": "pvs",
    "stream_test.c": "streaming",
    "stream_io_test.c": "streaming",
    "impostor_test.c": "streaming",
    "impostor_lod_policy_test.c": "streaming",
    "r2d_profile_fence_test.c": "core",
    "render_features_test.c": "render",
    "render_p4_test.c": "render",
    "render_post_test.c": "render",
    "postprocess_test.c": "render",
    "render_regression_test.c": "render",
    "decal2_test.c": "render",
    "debug_views_test.c": "render",
    "material_anim_test.c": "material",
    "sky_test.c": "sky",
    "sky_layers_test.c": "sky",
    "sky_leak_test.c": "sky",
    "vfx_test.c": "vfx",
    "particle_test.c": "vfx",
}


def tracked_tests():
    try:
        out = subprocess.run(["git", "ls-files", "tests/re2d/*.c"], cwd=ROOT,
                             capture_output=True, text=True, check=True).stdout
        files = [Path(line).name for line in out.splitlines() if line.strip()]
        if files:
            return sorted(files)
    except (OSError, subprocess.CalledProcessError):
        pass
    return sorted(Path(p).name for p in glob.glob(str(ROOT / "tests/re2d/*.c")))


def proposed_dir(name):
    if name in EXPLICIT:
        return EXPLICIT[name]
    lower = name.lower()
    rules = [
        (("stream", "impostor", "residen"), "streaming"),
        (("region", "areaportal"), "region"),
        (("pvs", "hierarch", "occluder", "hint"), "pvs"),
        (("render", "post", "decal", "batch", "debug_view", "portal"), "render"),
        (("material",), "material"),
        (("sprite", "atlas", "rotsprite"), "sprite"),
        (("fog",), "fog"),
        (("sky", "exr"), "sky"),
        (("vfx", "particle", "trail"), "vfx"),
        (("brush", "world", "terrain", "polygon", "volume"), "world"),
    ]
    for keys, directory in rules:
        if any(key in lower for key in keys):
            return directory
    return "core"


def cmake_texts():
    texts = {}
    for path in sorted(ROOT.rglob("CMakeLists.txt")):
        rel = path.relative_to(ROOT)
        if any(part in ("build", "_deps", "dist") for part in rel.parts):
            continue
        texts[str(rel)] = path.read_text(encoding="utf-8", errors="replace")
    return texts


def build_report():
    files = tracked_tests()
    texts = cmake_texts()
    big = "\n".join(texts.values())
    refs = set(re.findall(r"tests/re2d/([A-Za-z0-9_./-]+\.c)", big))
    refs |= set(re.findall(r"(?<![\w/])re2d/([A-Za-z0-9_./-]+\.c)", big))
    rows = []
    errors = []
    warnings = []
    for name in files:
        directory = proposed_dir(name)
        pattern = r"(?:tests/)?re2d/" + re.escape(name)
        wired = re.search(pattern, big) is not None
        exists = (ROOT / "tests" / "re2d" / name).is_file()
        row = {"file": name, "proposed": directory, "cmake_wired": wired,
               "exists": exists}
        rows.append(row)
        if not exists:
            errors.append("tracked test file missing on disk: %s" % name)
        if not wired:
            errors.append("test file is not referenced by any CMakeLists.txt: %s" % name)
        if directory not in SUGGESTED_DIRS:
            errors.append("unknown proposed subsystem %r for %s" % (directory, name))
    for ref in sorted(refs):
        path = ROOT / "tests" / "re2d" / ref
        if not path.is_file():
            errors.append("CMake references a missing test source: tests/re2d/%s" % ref)
    all_files = sorted(Path(p).name for p in glob.glob(str(ROOT / "tests/re2d/*.c")))
    untracked = sorted(set(all_files) - set(files))
    if untracked:
        warnings.append("untracked tests/re2d C files (not in layout yet): %s" %
                        ", ".join(untracked))
    basenames = [row["file"] for row in rows]
    if len(set(basenames)) != len(basenames):
        errors.append("duplicate test basenames in tests/re2d")
    counts = {}
    for row in rows:
        counts[row["proposed"]] = counts.get(row["proposed"], 0) + 1
    report = {
        "root": str(ROOT),
        "mode": "compatibility-flat-layout",
        "suggested_dirs": SUGGESTED_DIRS,
        "tracked": len(rows),
        "wired": sum(1 for row in rows if row["cmake_wired"]),
        "references": len(refs),
        "counts": counts,
        "rows": rows,
        "untracked": untracked,
        "warnings": warnings,
        "errors": errors,
        "ok": not errors,
    }
    return report


def render_doc(report):
    lines = [
        "# Native Re2D test layout (roadmap §131)",
        "",
        "Generated by `tools/test_layout_check.py --write`.",
        "",
        "## Status: documented compatibility layout",
        "",
        "The C tests physically stay flat in `tests/re2d/` so existing CMake",
        "targets and the 163-test gate keep working. This table is the",
        "authoritative mapping for a future mechanical move into the roadmap's",
        "subsystem directories.",
        "",
        "Every tracked file below is referenced by a CMakeLists.txt target and",
        "exists on disk. `python3 tools/test_layout_check.py --check` validates",
        "both directions (file->CMake and CMake->file).",
        "",
        "| file | proposed directory | CMake wired |",
        "|---|---|---|",
    ]
    for row in report["rows"]:
        lines.append("| `%s` | `%s` | %s |"
                     % (row["file"], row["proposed"],
                        "yes" if row["cmake_wired"] else "NO"))
    lines += [
        "",
        "## Counts",
        "",
    ]
    for directory in SUGGESTED_DIRS:
        if report["counts"].get(directory):
            lines.append("- `%s/`: **%d**" % (directory, report["counts"][directory]))
    lines += [
        "",
        "Tracked tests: **%d**; CMake-wired: **%d**; CMake source references: **%d**."
        % (report["tracked"], report["wired"], report["references"]),
        "",
        "Untracked files (new work not yet wired) are reported as warnings, not",
        "as part of the compatibility contract: %s." %
        (", ".join("`%s`" % x for x in report["untracked"]) if report["untracked"] else "none"),
        "",
        "## Moving later",
        "",
        "1. create the proposed subdirectories;",
        "2. `git mv` each file per this table;",
        "3. rewrite `tests/CMakeLists.txt` / `sdk/native/CMakeLists.txt` paths;",
        "4. run `cmake -S . -B build && cmake --build build --target r2d_check -j 8`;",
        "5. update this table (the checker knows the new paths only through the",
        "   same manifest, so update `tools/test_layout_check.py` in the same commit).",
        "",
    ]
    return "\n".join(lines)


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    report = build_report()
    if args.write:
        LAYOUT_DOC.write_text(render_doc(report), encoding="utf-8")
        print("written %s" % os.path.relpath(LAYOUT_DOC, ROOT))
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print("native test layout: tracked=%d wired=%d refs=%d mode=%s"
              % (report["tracked"], report["wired"], report["references"], report["mode"]))
        for error in report["errors"]:
            print("  FAIL " + error)
        for warning in report["warnings"]:
            print("  warn " + warning)
        print("layout check: %s" % ("PASS" if report["ok"] else "FAIL"))
    if args.write and not (args.check or args.json):
        return 0
    if not (args.check or args.write or args.json):
        print("nothing to do: pass --check, --write or --json")
        return 2
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
