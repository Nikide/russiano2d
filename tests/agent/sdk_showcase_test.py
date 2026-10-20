#!/usr/bin/env python3
"""Runtime integration checks for demos/sdk_showcase's 2D and Re2D scenes."""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from agent_client import Agent  # noqa: E402


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print("  ok   " + message, flush=True)


def main():
    game = os.path.join("demos", "sdk_showcase")
    for scene, expected_mode in (("garden", "garden-2d"), ("workshop", "workshop-2d")):
        with Agent(game=game, scene=scene, seed=5, fixed_dt=1 / 60, headless=True) as agent:
            agent.step(8)
            state = agent.state()
            probe = state["showcase"]
            check(probe["mode"] == expected_mode, scene + " entry point starts")
            check(probe["tiles"] == {"width": 20, "height": 12}, scene + " loads the 20×12 tilemap")
            check(probe["atlas"] == ["botanist_0"], scene + " loads the generated sprite atlas")
            check(probe["parallaxReady"], scene + " builds parallax after camera setup")
            check(agent.inspect("#hero")["tag"] == "sprite", scene + " creates the player sprite")
            if scene == "garden":
                start_x = probe["hero"]["x"]
                agent.key("D", "down")
                agent.step(8)
                agent.key("D", "up")
                check(agent.state()["showcase"]["hero"]["x"] > start_x, "input moves the runtime player")
                agent.key("Space")
                agent.step(1)
                check(agent.state()["showcase"]["particleCount"] == 24, "scan input emits the configured particle burst")
                agent.key("I")
                agent.step(2)
                check(agent.eval("$.story.running()") is True, "I starts the editable VN scene")
                check(agent.eval("$.story.last_line.text") == "Станция снова ловит сигнал из оранжереи.", "VN runtime reads the authored scene")

    with Agent(game=game, scene="re2d", seed=5, fixed_dt=1 / 60, headless=True) as agent:
        agent.step(8)
        probe = agent.state()["showcase"]
        check(probe["mode"] == "re2d", "Re2D entry point starts")
        check(probe["info"]["cells"] == 2 and probe["info"]["portals"] == 1, "compiled map has two cells and a portal")
        check(probe["metadata"]["id"] == "orbital_garden.atrium", "compiled map preserves metadata")
        check([spawn["typeName"] for spawn in probe["spawns"]] == ["player", "item"], "runtime reads typed spawn points")

    print("All SDK showcase runtime checks passed.")


if __name__ == "__main__":
    main()
