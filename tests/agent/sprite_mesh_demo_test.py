#!/usr/bin/env python3
"""Runtime integration check for the SpriteMesh sample project."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT  # noqa: E402


def snap(agent):
    return json.loads(agent.eval("JSON.stringify($.agent.snapshot().spriteMeshDemo)"))


def main():
    with Agent(game=os.path.join(ROOT, "demos", "sprite_mesh_demo"), seed=23) as agent:
        agent.step(8)
        state = snap(agent)
        assert state["clip"] == "idle" and state["mesh"] and state["meshEnabled"], state
        assert 0 <= state["frame"] < 8 and 0 <= state["meshFrame"] < 8, state
        agent.screenshot(os.path.join(ROOT, "build", "sprite_mesh_demo.png"))
        agent.cmd("key", key="2", action="tap")
        agent.step(12)
        state = snap(agent)
        assert state["clip"] == "walk" and state["mesh"], state
        assert 0 <= state["frame"] < 8 and 8 <= state["meshFrame"] < 16, state
        agent.cmd("key", key="m", action="tap")
        agent.step(2)
        state = snap(agent)
        assert not state["mesh"] and not state["meshEnabled"], state
        agent.cmd("key", key="r", action="tap")
        agent.step(2)
        assert snap(agent)["rotate"] is True
    print("SpriteMesh demo runtime: ordinary idle/walk animation, baked frame selection, toggle, rotation PASS")


if __name__ == "__main__":
    main()
