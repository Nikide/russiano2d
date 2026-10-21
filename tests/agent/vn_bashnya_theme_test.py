#!/usr/bin/env python3
"""BASHNYA custom dialog theme: real RmlUi document + RCSS, pixel-verified.

Loads ui/dialog/bashnya.rml/.rcss through $.dialog.themeDefine, opens a dialog
on the RmlUi backend, checks the document geometry and the actual framebuffer:
black panel, dark-red rule/accent, light text, oversized portrait area.

Also verifies the new VN DoD hooks on the live engine:
  * voice really goes through $.sound (channel tracked by $.dialog.voiceInfo());
  * prefetch really warms the sound/texture caches;
  * narrative inspector facts are available to DevTools.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402
from re2d_native_test import decode  # noqa: E402

GAME = os.path.join("tests", "fixtures", "within")
FAILED = []
SHOT = os.path.join(ROOT, "build", "test_bashnya_dialog.png")


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def read(path):
    with open(os.path.join(ROOT, path), "r", encoding="utf-8") as handle:
        return handle.read()


def main():
    rml = read("ui/dialog/bashnya.rml")
    rcss = read("ui/dialog/bashnya.rcss")
    with Agent(game=GAME, seed=17, fixed_dt=1.0 / 60.0) as a:
        a.step(2)
        check(a.eval("typeof $.dialog === 'object'") is True, "$.dialog installed")
        check(a.eval("typeof engine.ui.loadMarkup === 'function'") is True,
              "RmlUi loadMarkup available")

        define = ("$.dialog.themeDefine('bashnya',{rml:%s,rcss:%s});"
                  "$.dialog.speaker('w',{name:'BASHNYA',portraits:{neutral:'demos/assets/art/vn/russi/russi_neutral.png'}});"
                  "$.dialog.define('bashnya_probe',{start:'a',nodes:{a:{speaker:'w',expression:'neutral',"
                  "slot:'left',text:'Тонкая красная линия. Никаких скруглённых панелей.',"
                  "choices:[{text:'Продолжить',to:null},{text:'Уйти',to:null}]}}});"
                  "$.dialog.theme('bashnya');$.dialog.hardLock(false);$.dialog.play('bashnya_probe')"
                  % (json.dumps(rml), json.dumps(rcss)))
        check(a.eval(define) is True, "dialog plays with BASHNYA theme")
        a.step(2)

        check(a.eval("$.dialog.viewLoaded()") is True, "RmlUi document is loaded")
        snap = json.loads(a.eval("JSON.stringify($.dialog.inspect())") or "{}")
        check(snap.get("theme") == "bashnya", "inspector reports bashnya theme")
        check(snap.get("view") == "rml", "inspector reports RmlUi view")
        check(snap.get("choiceSlots") == 8, "custom RML exposes eight choice slots")
        check(len(snap.get("choices") or []) == 2, "two visible authored choices")
        check(snap.get("inputHardLocked") is False, "advisory input lock by default")
        check(a.eval("typeof $.devtools.narrative === 'function'") is True,
              "DevTools narrative inspector API exists")
        narrative = json.loads(a.eval("JSON.stringify($.devtools.narrative())") or "{}")
        check((narrative.get("section") or {}).get("text", "").find("БАШНЯ") >= 0
              or "definition" in (narrative.get("section") or {}).get("text", ""),
              "narrative panel exposes dialog facts")
        check("bashnya_probe" in (narrative.get("section") or {}).get("text", ""),
              "narrative panel shows the open definition")

        # --- real voice + prefetch -------------------------------------------
        voice = "tests/fixtures/lifecycle/assets/hit.wav"
        check(a.eval("$.fs.exists(%s)" % json.dumps(voice)) is True, "voice fixture exists")
        a.eval("$.dialog.close()")
        a.eval("$.dialog.define('bashnya_voice',{start:'a',nodes:{a:{speaker:'w',voice:%s,"
               "text:'Голос.',to:'b'},b:{speaker:'w',voice:%s,text:'Ещё.'}}})"
               % (json.dumps(voice), json.dumps(voice)))
        a.eval("$.dialog.play('bashnya_voice')")
        a.step(1)
        vinfo = json.loads(a.eval("JSON.stringify($.dialog.voiceInfo())") or "{}")
        check(vinfo.get("enabled") is True, "voice playback enabled")
        check(vinfo.get("playing") is True, "voice channel is live through $.sound")
        check(vinfo.get("src") == voice, "voice source tracked")
        prefetch = json.loads(a.eval("JSON.stringify($.dialog.prefetchInfo())") or "{}")
        check((prefetch.get("sounds") or 0) >= 1, "voice was actually preloaded")
        a.eval("$.dialog.close()")
        a.step(1)
        check(json.loads(a.eval("JSON.stringify($.dialog.voiceInfo())") or "{}").get("playing") is False,
              "voice stops when the dialog closes")

        # --- dialog with portrait, then screenshot ---------------------------
        a.eval("$.dialog.play('bashnya_probe')")
        a.step(3)
        doc = a.eval("$.dialog.view().document")
        rect = a.eval("engine.ui.rect(%s,'r2d-dlg-root')" % doc)
        if isinstance(rect, str):
            rect = json.loads(rect)
        check(bool(rect) and rect.get("w", 0) > 200 and rect.get("h", 0) > 100,
              "BASHNYA root lays out on the RmlUi backend: %s" % rect)
        a.screenshot(SHOT)
        w, h, bpp, rows = decode(SHOT)
        check((w, h) == (800, 600), "screenshot is 800x600: %sx%s" % (w, h))
        dark = red = light = 0
        sampled = 0
        for y in range(h // 2, h):
            line = rows[y]
            for x in range(0, w, 2):
                r, g, b = line[x * bpp:x * bpp + 3]
                sampled += 1
                if r + g + b < 110:
                    dark += 1
                if r > 90 and g < 60 and b < 60:
                    red += 1
                if r > 190 and g > 185 and b > 175:
                    light += 1
        check(dark / max(1, sampled) > 0.20, "bottom half is dominated by black panel: %.1f%%"
              % (100.0 * dark / max(1, sampled)))
        check(red >= 20, "dark-red rule/accent is visible: %d px" % red)
        check(light >= 100, "light dialog text is visible: %d px" % light)
        check(not a.eval("$.debug.errors()"), "no script errors while rendering the theme")

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
