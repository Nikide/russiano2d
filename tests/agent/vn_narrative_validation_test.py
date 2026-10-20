#!/usr/bin/env python3
# ===========================================================================
# VN narrative validation: native SDK linter integration test.
#
# Proves `r2d story validate` and `r2d dialog validate` are real native
# commands (single backend for CLI/GUI/agent), diagnose broken scenes/themes,
# and accept valid authored data. Does not boot the engine or a window.
#
# Запуск:
#   python3 tests/agent/vn_narrative_validation_test.py
# ===========================================================================
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from agent_client import resolve_binary
SDK = resolve_binary()
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def run(*args):
    proc = subprocess.run([SDK, *args], cwd=ROOT, capture_output=True, text=True)
    try:
        payload = json.loads(proc.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        payload = {"ok": False, "diagnostics": [], "raw": proc.stdout + proc.stderr}
    return proc.returncode, payload


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def codes(payload):
    return {d.get("code") for d in payload.get("diagnostics", [])}


def main():
    if not os.path.isfile(SDK):
        print("  FAIL r2d не собран: " + SDK)
        return 1
    with tempfile.TemporaryDirectory(prefix="r2d-vn-") as work:
        # --- valid story ----------------------------------------------------
        good = os.path.join(work, "good")
        write(os.path.join(good, "story", "speakers.json"),
              '{"speakers":{"w":{"name":"???","expressions":["smirk"],'
              '"portraits":{"smirk":"art/w.png"}}}}')
        write(os.path.join(good, "art", "w.png"), "PNG")
        write(os.path.join(good, "story", "ch1.scene"),
              "@theme dialog\n:start\nw (smirk): Привет.\n"
              "- Друг -> friend\n- Молчать -> end\n"
              ":friend\nimage art/w.png 0.4\nimage off 0.5\nend\n")
        write(os.path.join(good, "ui", "dialog", "dialog.rml"),
              '<rml><body><div data-dialog-role="root">'
              '<div data-dialog-role="text"></div>'
              '<div data-dialog-role="choices"></div></div></body></rml>')
        rc, payload = run("story", "validate", os.path.join(good, "story"))
        check(rc == 0 and payload.get("ok") is True, "valid .scene directory with image duration/off accepted")
        check(payload.get("scenes") == 1, "scanner counted one scene")
        check(payload.get("speakers_registry") is True, "speaker registry discovered")

        # --- broken story ---------------------------------------------------
        bad = os.path.join(work, "bad")
        write(os.path.join(bad, "story", "speakers.json"),
              '{"speakers":{"w":{"name":"???","expressions":["smirk"]}}}')
        write(os.path.join(bad, "story", "broken.scene"),
              ":start\nw (angry): Привет.\n- Друг -> missing\ngoto nowhere\n"
              "image art/nope.png\n:orphan\nend\n")
        rc, payload = run("story", "validate", os.path.join(bad, "story"))
        found = codes(payload)
        check(rc == 1 and payload.get("ok") is False, "broken scene rejected")
        check("STORY_GOTO_UNKNOWN" in found, "unknown goto diagnosed")
        check("STORY_EXPRESSION" in found, "invalid expression diagnosed")
        check("STORY_ASSET" in found, "missing asset diagnosed")
        check("STORY_UNREACHABLE" in found, "unreachable label diagnosed")

        # --- goto loop ------------------------------------------------------
        loop = os.path.join(work, "loop")
        write(os.path.join(loop, "story", "loop.scene"), ":a\ngoto b\n:b\ngoto a\n")
        rc, payload = run("story", "validate", os.path.join(loop, "story"))
        check("STORY_GOTO_LOOP" in codes(payload), "obvious goto loop diagnosed")

        # --- valid dialog theme --------------------------------------------
        theme = os.path.join(work, "theme")
        write(os.path.join(theme, "fonts", "font.ttf"), "TTF")
        write(os.path.join(theme, "ui", "dialog", "custom.rcss"),
              '@font-face { font-family:"Bashnya"; src:url("../../fonts/font.ttf"); }\n')
        write(os.path.join(theme, "ui", "dialog", "custom.rml"),
              '<rml><head><link type="text/rcss" href="custom.rcss"/></head><body>'
              '<div data-dialog-role="root"><div data-dialog-role="text"></div>'
              '<div data-dialog-role="choices">'
              '<button data-dialog-role="choice"></button></div></div></body></rml>')
        rc, payload = run("dialog", "validate", os.path.join(theme, "ui", "dialog", "custom.rml"))
        check(rc == 0 and payload.get("ok") is True, "custom RML+RCSS+custom font accepted")
        check(payload.get("roles", 0) >= 3, "semantic roles counted")

        rc, payload = run("dialog", "validate", os.path.join(theme, "ui", "dialog", "custom.rml"))
        check(payload.get("choices") == 1, "choice role counted")

        # --- broken dialog theme -------------------------------------------
        write(os.path.join(theme, "ui", "dialog", "broken.rml"),
              '<rml><body><div data-dialog-role="root">'
              '<div data-dialog-role="text"></div></div></body></rml>')
        rc, payload = run("dialog", "validate", os.path.join(theme, "ui", "dialog", "broken.rml"))
        check(rc == 1 and "DIALOG_ROLE_MISSING" in codes(payload), "missing choices role diagnosed")

        write(os.path.join(theme, "ui", "dialog", "unclosed.rml"),
              '<rml><body><div data-dialog-role="root"><div data-dialog-role="text">'
              '</div><div data-dialog-role="choices"></div></body></rml>')
        rc, payload = run("dialog", "validate", os.path.join(theme, "ui", "dialog", "unclosed.rml"))
        check(rc == 1 and "DIALOG_RML_TAG" in codes(payload), "unbalanced RML diagnosed")

        write(os.path.join(theme, "ui", "dialog", "missing_rcss.rml"),
              '<rml><head><link type="text/rcss" href="nope.rcss"/></head><body>'
              '<div data-dialog-role="root"><div data-dialog-role="text"></div>'
              '<div data-dialog-role="choices"></div></div></body></rml>')
        rc, payload = run("dialog", "validate", os.path.join(theme, "ui", "dialog", "missing_rcss.rml"))
        check("DIALOG_RCSS_MISSING" in codes(payload), "missing linked RCSS diagnosed")

    if FAILURES:
        print("ПРОВАЛЕНО %d" % len(FAILURES))
        for item in FAILURES:
            print("  - " + item)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
