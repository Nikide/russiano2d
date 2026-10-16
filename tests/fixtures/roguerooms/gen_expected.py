#!/usr/bin/env python3
# ===========================================================================
# Пересборка tests/fixtures/roguerooms/expected.json — эталонов примера
# demos/roguerooms (§31-4).
#
# Запуск из корня репозитория (движок уже собран):
#   python3 tests/fixtures/roguerooms/gen_expected.py
#
# Скрипт гоняет движок через агентский протокол теми же вызовами, что и
# приёмочный тест tests/agent/roguerooms_test.py, и печатает JSON в stdout.
# Записывать эталоны можно только осознанно: расхождение с прежними означает,
# что геометрия комнат изменилась и это нужно объяснить, а не «обновить».
# ===========================================================================

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from agent_client import Agent   # noqa: E402

GAME = "demos/roguerooms"
FULL = {"budget": 1, "maxSteps": 8721, "maxTicks": 240, "maxAttempts": 3, "profile": "standard"}


def wait_ready(a, iters=400, chunk=3):
    for _ in range(iters):
        if not a.eval("$.rooms.stats().generating"):
            return True
        a.step(chunk)
    return False


def run_room(a, seed, **opts):
    config = dict(FULL)
    config.update(opts)
    a.eval("$.rooms.start(%d, %s)" % (seed, json.dumps(config)))
    if not wait_ready(a):
        raise SystemExit("генерация не завершилась: seed=%d %s" % (seed, opts))
    return a.eval("$.rooms.stats()")


def main():
    with Agent(game=GAME, seed=7) as a:
        a.step(10)
        a.eval("$.rooms.dir('build/test_roguerooms_gen', { clear: true })")
        rooms = {}
        for key, seed, opts in (("standard42", 42, {}),
                                ("dense7", 7, {"profile": "dense"}),
                                ("standard7", 7, {})):
            stats = run_room(a, seed, **opts)
            room = {
                "profile": stats["profile"],
                "seed": stats["seed"],
                "status": stats["status"],
                "hash": stats["hash"],
                "platforms": stats["platforms"],
                "steps": stats["steps"],
                "attempt": stats["attempt"],
                "attemptSeeds": stats["attemptSeeds"],
                "freeFraction": stats["freeFraction"],
                "longest": stats["longest"],
                "spawn": stats["spawn"],
            }
            if stats["attemptLog"]:
                room["reason"] = stats["attemptLog"][0]["reasons"][0]
            rooms[key] = room

        budget = run_room(a, 42)
        broken = run_room(a, 7, profile="broken")

    out = {
        "comment": "Эталонные комнаты demos/roguerooms (§31-4). Записано с прогона движка; "
                   "пересборка — python3 tests/fixtures/roguerooms/gen_expected.py.",
        "cols": 72,
        "rows": 40,
        "tile": 32,
        "maxSteps": 8721,
        "rooms": rooms,
        "budgets": {
            "comment": "Один seed — один hash при разном бюджете $.task (мс/кадр).",
            "seed": 42,
            "profile": "standard",
            "hash": budget["hash"],
            "steps": budget["steps"],
        },
        "broken": {
            "profile": "broken",
            "seed": 7,
            "attemptSeeds": broken["attemptSeeds"],
            "reason": broken["reason"],
        },
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
