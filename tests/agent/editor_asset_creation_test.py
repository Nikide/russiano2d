#!/usr/bin/env python3
"""Editor palette creates and opens starter game resources in their studios."""
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from agent_client import Agent  # noqa: E402
from editor_hammer_test import settle  # noqa: E402

E = "$.editorApp"
D = '$.ui.doc("ui/editor.rml")'
FAILED = []


def check(value, message):
    print(("  ok   " if value else "  FAIL ") + message, flush=True)
    if not value:
        FAILED.append(message)


def palette_action(agent, label, expected):
    agent.eval(E + '.openPalette("commands");1')
    agent.eval(D + '.setValue("palette-input",' + json.dumps(">" + label) + ');1')
    agent.step(3)
    available = agent.eval(E + ".state.palette.list.some(x=>x.item.cmd&&x.item.label==="
                           + json.dumps(label) + ")")
    check(available, "палитра предлагает «%s»" % label)
    if not available:
        return False
    agent.tap("Return")
    settle(agent, expected)
    return True


def run():
    with tempfile.TemporaryDirectory(prefix="r2d-editor-assets-") as tmp:
        project = Path(tmp)
        (project / "project.json").write_text(json.dumps({
            "format": 2, "title": "Editor asset creation", "entry": "main.js",
        }), encoding="utf-8")
        (project / "main.js").write_text("$.ready(() => {});\n", encoding="utf-8")

        with Agent(game="editor", scene=str(project), seed=13) as agent:
            settle(agent, E + ".state.project!==null && " + E + ".state.busy===0")

            if palette_action(agent, "Файл: создать JS-файл игры",
                              E + '.activeTab().path==="game.js"'):
                check((project / "game.js").is_file(),
                      "команда создала game.js в проекте")

            if palette_action(agent, "Ресурс: создать тайловую карту",
                              E + '.activeTab().path==="level.tilemap.json" && '
                              + E + '.activeTab().studio.id==="tilemap"'):
                data = json.loads((project / "level.tilemap.json").read_text(encoding="utf-8"))
                check(data.get("tile") == 16 and len(data.get("layers", [{}])[0].get("data", [])) == 22,
                      "новая карта открыта в Tilemap Studio с исходной сеткой")

            if palette_action(agent, "Ресурс: создать сцену визуальной новеллы",
                              E + '.activeTab().path==="story/main.scene" && '
                              + E + '.activeTab().studio.id==="narrative"'):
                source = (project / "story" / "main.scene").read_text(encoding="utf-8")
                check(":start" in source and "end" in source,
                      "новая сцена открыта в Narrative Studio")

    return 1 if FAILED else 0


def main():
    state = ROOT / "state.local.json"
    previous = state.read_bytes() if state.exists() else None
    try:
        result = run()
        print("editor_asset_creation_test: %s" % ("провалено" if result else "все проверки пройдены"), flush=True)
        return result
    finally:
        if previous is None:
            state.unlink(missing_ok=True)
        else:
            state.write_bytes(previous)


if __name__ == "__main__":
    raise SystemExit(main())
