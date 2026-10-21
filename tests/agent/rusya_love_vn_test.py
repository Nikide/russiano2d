#!/usr/bin/env python3
"""Play both endings of the Editor-authored Rusya romance VN."""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from agent_client import Agent  # noqa: E402

FAILURES = []
GAME = os.path.join(ROOT, "demos", "rusya-love-vn")


def check(value, message):
    print(("  ok   " if value else "  FAIL ") + message, flush=True)
    if not value:
        FAILURES.append(message)


def play(route, ending_marker, screenshot_name, expected_affection):
    shot = os.path.join(ROOT, "build", screenshot_name)
    with Agent(game=GAME, scene="main", seed=50 + route) as agent:
        agent.step(55)
        check(agent.eval("$.story.running() && $.dialog.isOpen()"),
              "маршрут %d: история и диалог запущены" % (route + 1))
        choices = []
        final_line = None
        for _ in range(25000):
            line = agent.eval("$.story.last_line")
            if isinstance(line, dict) and ending_marker in line.get("text", ""):
                agent.eval("$.dialog.skip();1")
                agent.step(3)
                final_line = line
                break

            visible = agent.eval("$.dialog.choices()")
            if visible:
                choices.append([choice.get("text", "") for choice in visible])
                agent.eval("$.story.choose(%d);1" % route)
            else:
                agent.eval("$.story.advance();1")
            agent.step(1)

        check(len(choices) == 4,
              "маршрут %d: пройдены четыре решения" % (route + 1))
        check(final_line is not None,
              "маршрут %d: достигнута нужная концовка" % (route + 1))
        state = {
            "affection": agent.eval("$.story.flags.affection"),
            "running": agent.eval("$.story.running()"),
            "speaker": agent.eval("$.dialog.speaker()"),
            "portrait": agent.eval("$.dialog.portrait()"),
            "view": agent.eval("$.dialog.viewLoaded()"),
        }
        check(state["affection"] == expected_affection,
              "маршрут %d: флаг отношения равен %d" % (route + 1, expected_affection))
        check(state["running"] and state["speaker"] == "Руси-тян",
              "маршрут %d: финальная реплика Руси-тян отображается" % (route + 1))
        check(bool(state["portrait"]) and state["view"],
              "маршрут %d: портрет и RmlUi документ загружены" % (route + 1))
        agent.screenshot(shot)
        check(os.path.isfile(shot) and os.path.getsize(shot) > 1000,
              "маршрут %d: runtime кадр сохранён" % (route + 1))
        errors = [line for line in agent.stderr_text().splitlines()
                  if "$: ошибка" in line]
        check(not errors, "маршрут %d: в игровом журнале нет ошибок" % (route + 1))
        for error in errors[:3]:
            print("        " + error.strip())


def main():
    play(0, "Тогда давай попробуем", "test_rusya_love_vn_good.png", 4)
    play(1, "Ты хороший человек", "test_rusya_love_vn_bad.png", -4)
    if FAILURES:
        print("\nПРОВАЛЕНО: %d" % len(FAILURES))
        return 1
    print("\nВсе проверки пройдены")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
