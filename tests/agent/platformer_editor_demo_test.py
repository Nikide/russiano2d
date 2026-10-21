#!/usr/bin/env python3
"""Play the Tilemap Studio platformer from start to its flag using input."""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from agent_client import Agent  # noqa: E402

GAME = os.path.join(ROOT, "demos", "platformer-editor-demo")
FAILURES = []


def check(value, message):
    print(("  ok   " if value else "  FAIL ") + message, flush=True)
    if not value:
        FAILURES.append(message)


def jump_right(agent):
    agent.hold(["D"])
    agent.tap("Space")
    airborne = False
    for _ in range(100):
        agent.step(1)
        floor = agent.eval("$('#hero').onFloor()")
        won = "Получилось!" in (agent.eval("$('#instructions').text()") or "")
        if not floor:
            airborne = True
        if won or (airborne and floor):
            break
    agent.release_all()
    return agent.eval("({p:$('#hero').pos(),floor:$('#hero').onFloor(),"
                      "won:$('#instructions').text().includes('Получилось!')})")


def main():
    with Agent(game=GAME, scene="spring_path", seed=4) as agent:
        agent.step(30)
        check(agent.eval("$.scene.current()") == "spring_path",
              "запущена сцена платформера")
        check(agent.eval("$('tilemap').length===1 && $('#hero').length===1 "
                         "&& $('#goal').length===1 && $('#instructions').length===1"),
              "тайловая карта, герой, цель и подсказка созданы")
        start = agent.eval("$('#hero').pos()")

        state = jump_right(agent)
        check(state["p"]["x"] > start["x"] and state["p"]["y"] < start["y"],
              "первый прыжок переносит героя на лестницу платформ")
        jumps = 1
        while not state["won"] and jumps < 6:
            check(state["floor"], "герой приземлился перед следующим прыжком")
            previous_x = state["p"]["x"]
            agent.hold(["A"])
            agent.step(15)
            agent.release_all()
            state = jump_right(agent)
            jumps += 1
            check(state["p"]["x"] > previous_x or state["won"],
                  "прыжок %d продвигает героя к флагу" % jumps)

        check(state["won"], "полный маршрут заканчивается у флага")
        agent.screenshot(os.path.join(ROOT, "build", "test_platformer_editor_demo.png"))
        errors = [line for line in agent.stderr_text().splitlines()
                  if "$: ошибка" in line]
        check(not errors, "во время маршрута нет ошибок игрового кода")
        for error in errors[:3]:
            print("        " + error.strip())

    if FAILURES:
        print("\nПРОВАЛЕНО: %d" % len(FAILURES))
        return 1
    print("\nВсе проверки пройдены")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
