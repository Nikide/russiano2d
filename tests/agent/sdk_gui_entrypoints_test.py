#!/usr/bin/env python3
"""GUI routing and editing checks for SDK entry tools on the showcase project."""
import os
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from agent_client import Agent  # noqa: E402


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print("  ok   " + message, flush=True)


def rect(agent, doc_name, element):
    return agent.eval("JSON.stringify($.ui.doc(" + repr(doc_name) + ").rect(" + repr(element) + "))")


def click(agent, doc_name, element):
    import json
    r = json.loads(rect(agent, doc_name, element))
    check(r["w"] > 0 and r["h"] > 0, element + " is visible and clickable")
    agent.mouse_move(x=r["x"] + r["w"] / 2, y=r["y"] + r["h"] / 2)
    agent.step(2)
    agent.mouse(button=1, action="click")
    agent.step(4)


def wait(agent, predicate, limit=180):
    for _ in range(limit):
        agent.step(2)
        if agent.eval(predicate):
            return True
    return False


def main():
    project = os.path.join(ROOT, "build", "sdk_gui_showcase")
    source = os.path.join(ROOT, "demos", "sdk_showcase")
    shutil.rmtree(project, ignore_errors=True)
    shutil.copytree(source, project, ignore=shutil.ignore_patterns(".r2d", "build"))

    with Agent(game="sdk", seed=31, headless=True) as agent:
        agent.step(12)
        agent.eval("$.sdkApp.openProject(" + repr(os.path.relpath(project, ROOT)) + ").then(()=>1)")
        check(wait(agent, "$.sdkApp.state.busy===0 && !!$.sdkApp.state.project"), "showcase copy opens in SDK GUI")

        agent.eval("$.sdkApp.showView('tools'); $.sdkApp.openTool('r2d-sdk')")
        check(agent.eval("$.sdkApp.snapshot().view") == "tools", "native backend entry stays in the tool catalog")
        check("SDK_BACKEND_SHARED" in agent.eval("$.sdkApp.snapshot().diagnostics.codes"),
              "backend entry explains which GUI tools use it instead of doing nothing")

        # Code Check now follows the open project; its buttons still call the shared native backend.
        agent.eval("$.sdkApp.openTool('code-check')")
        check(wait(agent, "$.sdkApp.studios['code-check'].snapshot().active"), "Code Check opens in the SDK UI")
        panel_project = agent.eval("$.sdkApp.studios['code-check'].snapshot().project")
        check(os.path.abspath(panel_project) == project, "Code Check defaults to the current project")
        click(agent, "sdk/ui/code_check.rml", "cc-validate")
        check(agent.eval("$.sdkApp.studios['code-check'].snapshot().tab") == "validate", "Validate button runs in Code Check")
        check(wait(agent, "$.sdkApp.studios['code-check'].snapshot().busy===false && !!$.sdkApp.studios['code-check'].snapshot().report"),
              "Code Check waits for native validation report")
        check(agent.eval("$.sdkApp.studios['code-check'].snapshot().report.ok") is True, "GUI validation accepts the showcase project")
        agent.eval("$.sdkApp.studios['code-check'].close()")
        agent.step(2)

        # API Browser is a separate catalog entry, so it must land on the schema tab.
        agent.eval("$.sdkApp.openTool('api-browser')")
        check(wait(agent, "$.sdkApp.studios['api-browser'].snapshot().active"), "API Browser opens in the SDK UI")
        check(agent.eval("$.sdkApp.studios['api-browser'].snapshot().tab") == "api", "API Browser opens directly on API schema")
        click(agent, "sdk/ui/code_check.rml", "cc-api")
        check(agent.eval("$.sdkApp.studios['api-browser'].snapshot().tab") == "api", "API schema button keeps the schema view selected")
        agent.eval("$.sdkApp.studios['api-browser'].close()")
        agent.step(2)

        # VN Maker makes real edits to an isolated copy of the authored scene.
        scene_rel = os.path.join(os.path.relpath(project, ROOT), "story", "intro.scene").replace(os.sep, "/")
        scene_abs = os.path.join(project, "story", "intro.scene")
        agent.eval("$.sdkApp.openTool('vn-narrative',{asset:" + repr(scene_rel) + ",assetAbs:" + repr(scene_abs) + "})")
        check(wait(agent, "$.sdkApp.studios['vn-maker'].snapshot().active"), "VN Maker opens the showcase story in the editor")
        before = agent.eval("$.sdkApp.studios['vn-maker'].snapshot().commandCount")
        click(agent, "sdk/ui/vn_maker.rml", "vnm-add")
        check(agent.eval("$.sdkApp.studios['vn-maker'].snapshot().commandCount") == before + 1, "VN Maker Add creates an editable narrative command")
        check(agent.eval("$.sdkApp.studios['vn-maker'].snapshot().dirty") is True, "narrative edit is marked unsaved")
        click(agent, "sdk/ui/vn_maker.rml", "vnm-undo")
        check(agent.eval("$.sdkApp.studios['vn-maker'].snapshot().commandCount") == before, "VN Maker Undo restores the story")
        agent.eval("$.sdkApp.studios['vn-maker'].close()")
        agent.step(2)

        # World Editor owns brush authoring; a cells/walls map offers a direct route to its matching editor.
        map_abs = os.path.join(project, "maps", "orbital_garden.re2dmap")
        agent.eval("$.sdkApp.openTool('world-editor',{assetAbs:" + repr(map_abs) + "})")
        check(wait(agent, "$.sdkApp.studios.world.snapshot().active"), "World Editor opens the showcase map")
        check(agent.eval("$.ui.doc('sdk/ui/world_editor.rml').rect('we-map-hint').h") > 0,
              "World Editor explains that this map uses cells/walls")
        click(agent, "sdk/ui/world_editor.rml", "we-open-re2d-world")
        check(wait(agent, "$.sdkApp.studios.world.snapshot().active && $.sdkApp.studios.world.snapshot().data.cells.length===2"),
              "hint button opens the same file in Re2D World Studio")
        click(agent, "sdk/ui/world_studio.rml", "ws-compile")
        check(wait(agent, "$.sdkApp.studios.world.snapshot().preview===true"), "Re2D World Studio compiles a native runtime preview")

    print("All SDK GUI entrypoint checks passed.")


if __name__ == "__main__":
    main()
