#!/usr/bin/env python3
"""Open the existing Dust2 demo in Editor Hammer and verify native preview/history."""
import json
import sys
import tempfile
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_client import Agent
from editor_hammer_test import run, settle, snap

E = "$.editorApp"
A = E + ".activeTab().inst"
checks = 0


def check(value, label):
    global checks
    checks += 1
    print(("  ok   " if value else "  FAIL ") + label, flush=True)
    if not value:
        raise AssertionError(label)


def main():
    with tempfile.TemporaryDirectory(prefix="r2d-dust2-hammer-") as temporary:
        project = Path(temporary) / "project"
        shutil.copytree(
            ROOT / "demos/re2d_dust2",
            project,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        check((project / "project.json").is_file(), "existing Dust2 demo opens as a project without a genre template")

        with Agent(game="editor", scene=str(project), seed=9) as agent:
            settle(agent, E + ".state.project!==null && " + E + ".state.busy===0")
            run(agent, E + ".openFile('dust2.re2dmap')")
            settle(agent, A + "!==undefined && !!" + A)
            check(
                agent.eval(E + '.activeTab().studio.native && ' + E + '.activeTab().studio.id==="hammer"'),
                "Dust2 map opens in the native Hammer studio",
            )
            agent.eval("globalThis.dust2Hammer=" + A + ";1")
            check(
                all(
                    (agent.eval("dust2Hammer.doc.layoutRect(" + json.dumps("we-vp-" + view) + ")") or {}).get("w", 0) > 80
                    for view in ("top", "front", "side", "3d")
                ),
                "Hammer exposes XY, XZ, YZ and camera viewports for the Dust2 demo map",
            )

            validation = run(agent, "dust2Hammer.ops.validate()")
            diagnostics = validation.get("diagnostics", [])
            check(
                validation.get("ok")
                and not any(item.get("severity") == "error" for item in diagnostics)
                and any(item.get("severity") == "warning" for item in diagnostics),
                "Hammer Validate reports the authored map warnings without blocking on errors",
            )

            original_x = agent.eval('dust2Hammer.map.cells.find(c=>c.id==="c0_0").rect[0]')
            moved = run(agent, '(()=>{dust2Hammer.select("cell",["c0_0"]);return dust2Hammer.ops.moveSelection(16,0,0);})()')
            check(moved.get("ok") and agent.eval('dust2Hammer.map.cells.find(c=>c.id==="c0_0").rect[0]') == original_x + 16,
                  "Hammer edits a real Dust2 world cell through native world-edit")
            check(agent.eval('dust2Hammer.undo() && dust2Hammer.map.cells.find(c=>c.id==="c0_0").rect[0]===' + str(original_x)),
                  "one Undo restores the Dust2 map source")

            compiled = run(agent, "dust2Hammer.compile(true)")
            check(
                compiled.get("ok") and agent.eval("dust2Hammer.session.state.world.info().spans>0"),
                "Hammer compiles and loads the actual Re2D runtime preview",
            )
            check(snap(agent, "dust2Hammer")["preview"]["state"] == "актуален", "runtime preview matches the current document")
            run(agent, E + '.closeTab("dust2.re2dmap")')
            check(agent.eval("dust2Hammer.session.state.world===null"), "closing the map releases its native preview")

    print(f"re2d_dust2_hammer_test: {checks} checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
