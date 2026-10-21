#!/usr/bin/env python3
"""Only the Blank starter remains in CLI and Project Manager template catalogs."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from agent_client import Agent

R2D = os.environ.get("R2D_BINARY", "build-xmake/macos-arm64/macosx/arm64/release/r2d")


def main():
    result = subprocess.run([R2D, "templates"], cwd=ROOT, capture_output=True, text=True)
    listing = json.loads(result.stdout or "{}")
    templates = {item.get("id") for item in listing.get("templates", [])}
    assert result.returncode == 0 and templates == {"blank"}, listing

    with Agent(game="editor", seed=5) as agent:
        for _ in range(90):
            visible = agent.eval("$.editorApp.state.templates.map(t=>t.id)")
            if visible:
                break
            agent.step(1)
        assert set(visible) == {"blank"}, visible

    print("editor_template_registry_test: CLI and Project Manager expose only Blank")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
