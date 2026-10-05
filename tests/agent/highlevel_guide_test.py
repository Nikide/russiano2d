#!/usr/bin/env python3
# ===========================================================================
# Тест мини-гайда «Моя первая игра».
#
# Документация, которая врёт, хуже отсутствующей: этот тест достаёт полный
# листинг прямо из docs/tutorial-first-game.md, собирает из него игру во
# временном каталоге и запускает её в движке. Если API в гайде разойдётся с
# кодом, тест упадёт — и гайд нельзя будет «сгнить» незаметно.
#
# Запуск (после сборки движка):
#   python3 tests/agent/highlevel_guide_test.py
# ===========================================================================

import os
import re
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
GUIDE = os.path.join(ROOT, "docs", "tutorial-first-game.md")

PROJECT_JSON = '{\n  "title": "Моя первая игра",\n  "width": 1280,\n  "height": 720\n}\n'


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def extract_listing():
    """Полный листинг игры из гайда — единственный источник правды."""
    with open(GUIDE, encoding="utf-8") as f:
        text = f.read()
    section = re.search(r"## Полный листинг[^\n]*\n(.*?)(?=\n## )", text, re.S)
    if not section:
        return None
    block = re.search(r"```js\n(.*?)```", section.group(1), re.S)
    return block.group(1) if block else None


def main():
    listing = extract_listing()
    check(listing is not None and len(listing) > 500,
          "в гайде есть полный листинг игры")
    if not listing:
        print("\nПРОВАЛЕНО: 1")
        return 1

    game_dir = tempfile.mkdtemp(prefix="r2d_guide_")
    try:
        with open(os.path.join(game_dir, "main.js"), "w", encoding="utf-8") as f:
            f.write(listing)
        with open(os.path.join(game_dir, "project.json"), "w", encoding="utf-8") as f:
            f.write(PROJECT_JSON)

        with Agent(game=game_dir, seed=5) as a:
            a.step(3)
            check(a.eval("$.scene.current()") == "menu",
                  "игра из гайда стартует со сцены меню")
            check(a.eval("$('#btn-play').length") == 1,
                  "в меню есть кнопка «Играть»")

            # Нажимаем «Играть» — как это делает игрок мышью.
            a.eval("(() => { $('#btn-play').emit('click'); })()")
            check(a.eval("$.scene.busy()") is True, "переход между сценами начался")
            a.step(40)
            check(a.eval("$.scene.current()") == "level",
                  "после клика открылся уровень")
            check(a.eval("$.scene.busy()") is False, "переход завершился")
            check(a.eval("$('#hero').length") == 1, "на уровне есть игрок")

            a.step(90)
            check(a.eval("engine.frame > 0") is True, "уровень живёт и обновляется")
            check(a.eval("$('#hero').hp()") >= 0, "здоровье игрока читается")

            check(a.eval("$.scene.names().length") >= 3,
                  "зарегистрированы сцены меню, уровня и победы")
    finally:
        shutil.rmtree(game_dir, ignore_errors=True)

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
