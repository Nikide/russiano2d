#!/usr/bin/env python3
"""Acceptance test for the roadmap coverage audit (task-17).

Runs the static checker and asserts the matrix is complete and honest:
  * every section 0..153 is mapped exactly once;
  * every `done` section has existing evidence (checker already enforces);
  * no mandatory section marked `done` while its status says partial/deferred;
  * known unimplemented areas are not claimed done;
  * the generated docs matrix contains every section.

Fast, no engine/GPU. Run: python3 tests/agent/roadmap_acceptance_test.py
"""
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TOOL = os.path.join(ROOT, "tools", "roadmap_coverage.py")
DOC = os.path.join(ROOT, "docs", "ROADMAP_COVERAGE.md")
FAILED = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message)
    if not ok:
        FAILED.append(message)


def main():
    result = subprocess.run([sys.executable, TOOL, "--check", "--json"],
                            cwd=ROOT, capture_output=True, text=True)
    check(result.returncode == 0, "coverage checker exits 0")
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        check(False, "checker JSON parses: %s" % error)
        return 1

    sections = report.get("sections") or []
    check(len(sections) == 154, "matrix has 154 sections (got %d)" % len(sections))
    check([row["section"] for row in sections] == list(range(154)),
          "section ids are exactly 0..153 in order")
    check(not report.get("errors"), "checker reports no structural errors: %r"
          % (report.get("errors") or [])[:2])

    allowed = {"done", "partial", "deferred", "policy", "meta"}
    check(all(row["status"] in allowed for row in sections),
          "all statuses are from the allowed set")
    check(all(row["title"] for row in sections), "every section has a title")

    done_without = [row["section"] for row in sections
                    if row["status"] == "done" and not row.get("existing")]
    check(not done_without, "no done section without evidence: %r" % done_without[:5])

    mandatory = [row for row in sections if row.get("mandatory")]
    done_mandatory = [row for row in mandatory if row["status"] == "done"]
    check(len(mandatory) > 100, "mandatory set is meaningful: %d sections" % len(mandatory))
    check(len(done_mandatory) > 80, "most mandatory sections are done: %d" % len(done_mandatory))

    by_id = {row["section"]: row for row in sections}
    check(by_id[146]["status"] == "done", "VN DoD (146) is done")
    check(by_id[40]["status"] == "done", "VN P0 (40) is done")
    check(by_id[135]["status"] == "done", "Hammer compiler tests (135) are done")
    check(by_id[132]["status"] == "done", "fast test suite policy (132) is done")

    # Honest red areas: these must not be marked done while their implementation
    # evidence is documented as partial/deferred in the handoff.
    for section, why in {
        104: "GPU static batching submission",
        128: "material debug inspector",
        136: "visual lab demo",
        147: "render P0 DoD acceptance",
        148: "huge-world DoD acceptance",
    }.items():
        if section == 136 and os.path.isdir(os.path.join(ROOT, "demos", "re2d_visual_lab")):
            continue
        check(by_id[section]["status"] != "done",
              "section %d stays non-done while %s is open" % (section, why))

    # The matrix must be regenerated consistently; every section appears once.
    check(os.path.isfile(DOC), "docs/ROADMAP_COVERAGE.md exists")
    if os.path.isfile(DOC):
        text = open(DOC, encoding="utf-8").read()
        check("Mandatory red gaps" in text, "doc records mandatory red count")
        missing = [i for i in range(154) if ("| %d |" % i) not in text]
        check(not missing, "doc matrix contains every section id: %r" % missing[:5])
        check("## DoD evidence 146–148" in text, "doc has DoD 146-148 evidence")
        check("## Source audit" in text, "doc records source audit")

    reds = report.get("red") or []
    check(len(reds) == report.get("red_count"), "red list length matches red_count")
    red_ids = {row["section"] for row in reds}
    check(all(by_id[i]["status"] in ("partial", "deferred") for i in red_ids),
          "red gaps are all partial/deferred")
    check(report.get("red_count", 0) > 0, "red gaps are reported honestly: %d" %
          report.get("red_count", 0))

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
