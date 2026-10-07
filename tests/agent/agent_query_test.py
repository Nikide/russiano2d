#!/usr/bin/env python3
# ===========================================================================
# Проверка команд агентского протокола `query` и `inspect` — ROADMAP, фаза 3.
#
# Обещание: внешний агент умеет спросить «кто есть в мире» и «что это за
# сущность», не выполняя `eval` с самодельным JS. Ответ отдаёт тот же код,
# что и `$.agent.nodes/node` — второй реализации поиска нет (DEVTOOLS.md §7).
#
# Фикстура tests/fixtures/within/main.js расставляет узлы по числам, поэтому
# ожидаемые ответы проверяются арифметикой.
#
# Запуск после сборки:
#   python3 tests/agent/agent_query_test.py
# ===========================================================================

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, AgentError   # noqa: E402

GAME = os.path.join("tests", "fixtures", "within")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        a.step(2)

        # --- query: список сущностей по селектору $ -------------------------
        enemies = a.query("enemy")
        check(len(enemies) == 3, f"query('enemy') — трое, получено {len(enemies)}")
        check(all(n.get("tag") == "enemy" for n in enemies), "у всех тег enemy")
        check(enemies[0].get("id") == "enemy0", "порядок — порядок реестра")
        check(len(a.query(".enemy", limit=2)) == 2, "limit обрезает список")
        check(len(a.query()) >= 6, "без sel — все узлы мира")
        check(len(a.query("#nope")) == 0, "пустой селектор — пустой список")

        # --- inspect: одна сущность ------------------------------------------
        hero = a.inspect("#hero")
        check(isinstance(hero, dict) and hero.get("tag") == "player",
              "inspect('#hero') — игрок")
        check(abs(hero.get("x", 0) - 100) < 0.5 and abs(hero.get("y", 0) - 100) < 0.5,
              f"позиция игрока: {hero.get('x')}, {hero.get('y')}")
        check(hero.get("alive") is True, "живость видна")
        check(a.inspect("#nope") is None, "inspect пустого селектора — null, а не ошибка")

        # --- один и тот же источник данных у протокола и у игры --------------
        from_game = json.loads(a.eval("JSON.stringify($.agent.nodes('.enemy'))"))
        check(from_game == a.query(".enemy"),
              "query и $.agent.nodes() отдают одно и то же")
        one = json.loads(a.eval("JSON.stringify($.agent.node('#hero'))"))
        check(one == hero, "inspect и $.agent.node() отдают одно и то же")

        # --- ошибки понятные, состояние не сломано ---------------------------
        try:
            a.cmd("inspect")
            check(False, "inspect без sel должен быть ошибкой")
        except AgentError as exc:
            check("sel" in str(exc), f"inspect без sel: понятная ошибка ({exc})")

        # --- profile: диагностика без догадок --------------------------------
        prof = a.profile(sel=".enemy", x=100, y=100, radius=500)
        check(prof.get("sel") == ".enemy" and prof.get("count") == 3,
              f"profile: сущностей по селектору — 3 ({prof.get('count')})")
        check(prof.get("bodies") == 4, f"profile: живых тел — 4 ({prof.get('bodies')})")
        q = prof.get("query") or {}
        check(q.get("native") is True, "profile: запрос шёл нативно (broadphase)")
        check(q.get("results") == 3, f"profile: в круге 500 px — трое ({q.get('results')})")
        check(q.get("candidates", 0) >= q.get("results", 0),
              "profile: кандидатов не меньше результата")
        check(isinstance(q.get("ms"), (int, float)), "profile: время запроса числом")
        check(q.get("cap") == 256 and q.get("truncated") is False,
              "profile: предел и признак обрезки видны")
        zones = (prof.get("frame") or {}).get("zones")
        check(isinstance(zones, list) and len(zones) > 0, "profile: зоны кадра перечислены")
        check(prof.get("allocations") is None,
              "profile: аллокации честно не измеряются (null)")
        check(a.profile(sel="player").get("count") == 1,
              "profile: селектор без круга тоже считает")
        check(a.profile().get("query") is None,
              "profile: без круга нативного запроса нет")

        state = a.state()
        check(isinstance(state, dict) and "frame" in state, "state продолжает работать")
        check(isinstance(a.query("player"), list), "query на другой селектор не падает")

    print()
    if FAILURES:
        print(f"ПРОВАЛОВ: {len(FAILURES)}")
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
