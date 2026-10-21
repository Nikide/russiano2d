#!/usr/bin/env python3
"""Roadmap §131 compatibility layout acceptance.

The C tests stay flat by design; this test proves the documented subsystem
mapping is complete and that every tracked test file is wired into CMake.
Run: python3 tests/agent/native_test_layout_test.py
"""
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TOOL = os.path.join(ROOT, "tools", "test_layout_check.py")
DOC = os.path.join(ROOT, "tests", "re2d", "LAYOUT.md")
FAILED = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message)
    if not ok:
        FAILED.append(message)


def main():
    run = subprocess.run([sys.executable, TOOL, "--check", "--json"],
                         cwd=ROOT, capture_output=True, text=True)
    check(run.returncode == 0, "layout checker exits 0")
    try:
        report = json.loads(run.stdout)
    except json.JSONDecodeError as error:
        check(False, "layout checker JSON parses: %s" % error)
        return 1

    rows = report.get("rows") or []
    check(report.get("ok") is True, "checker reports no errors: %r" % (report.get("errors") or [])[:2])
    check(report.get("mode") == "compatibility-flat-layout",
          "compatibility layout mode is explicit")
    check(report.get("tracked", 0) >= 40, "native test count is meaningful: %s" % report.get("tracked"))
    check(report.get("wired") == report.get("tracked"),
          "every tracked test is Xmake-wired: %s/%s" % (report.get("wired"), report.get("tracked")))
    check(report.get("references", 0) >= report.get("tracked", 0),
          "Xmake references at least every tracked source: %s" % report.get("references"))
    check(not report.get("errors"), "no missing/duplicate/unwired tracked tests")

    suggested = set(report.get("suggested_dirs") or [])
    for name in ("render", "region", "pvs", "material", "sprite", "sky", "vfx", "streaming"):
        check(name in suggested, "roadmap subsystem %r present in proposed layout" % name)
    check(all(row.get("proposed") in suggested for row in rows),
          "every file maps to a known proposed subsystem")
    check(len({row.get("file") for row in rows}) == len(rows), "no duplicate basenames")
    check(os.path.isfile(DOC), "tests/re2d/LAYOUT.md exists")
    if os.path.isfile(DOC):
        text = open(DOC, encoding="utf-8").read()
        missing = [row["file"] for row in rows if ("`%s`" % row["file"]) not in text]
        check(not missing, "layout doc lists every tracked test: %r" % missing[:5])
        check("compatibility layout" in text, "layout doc explains flat compatibility")

    print()
    if FAILED:
        print("ПРОВАЛОВ:", len(FAILED))
        for item in FAILED:
            print("  -", item)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
