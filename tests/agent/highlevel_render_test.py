#!/usr/bin/env python3
# ===========================================================================
# Тест режимов смешивания и заглушки render target через агентский интерфейс.
#
# Гоняет фикстуру tests/fixtures/render и проверяет то, что видит игра:
# $.blend()/node.blend_mode доходят до батча, все четыре режима рисуются в
# одном кадре и не ломают вывод, а $.viewport честно сообщает, что render
# target в этой сборке не поддержан. Картинку целиком не сверяем — только
# размер скриншота и живые счётчики кадра.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_render_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "render")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- $.blend: геттер/сеттер и валидация -------------------------------
        check(a.eval("typeof $.blend") == "function", "$.blend доступно")
        check(a.eval("$.blend()") == "alpha", "режим по умолчанию — alpha")

        a.eval("$.blend('add')")
        check(a.eval("$.blend()") == "add", "$.blend('add') сменил режим по умолчанию")
        check(a.eval("$.blend('screen')") == "add",
              "неизвестный режим не меняет текущий")
        a.eval("$.blend('alpha')")
        check(a.eval("$.blend()") == "alpha", "режим вернулся к alpha")

        # --- node.blend_mode --------------------------------------------------
        for node_id, mode in (("b_alpha", "alpha"), ("b_add", "add"),
                              ("b_multiply", "multiply"), ("b_none", "none")):
            check(a.eval("$('#%s').blend()" % node_id) == mode,
                  "узел #%s в режиме %s" % (node_id, mode))
        check(a.eval("$('#b_bad').blend()") == "alpha",
              "неизвестный режим узла откатился в alpha")

        # --- Кадр со всеми режимами рисуется ---------------------------------
        a.step(2)
        stats = a.eval("$.gfx.stats()")
        check(isinstance(stats, dict) and stats.get("sprites", 0) >= 6,
              "все узлы со своими режимами попали в батч (sprites=%s)"
              % (stats.get("sprites") if isinstance(stats, dict) else stats))
        check(a.eval("engine.frame") > 0, "кадры идут")

        # --- $.viewport: честная заглушка -------------------------------------
        check(a.eval("typeof $.viewport") == "object", "$.viewport доступно")
        check(a.eval("$.viewport.supported") is False,
              "render target помечен как не поддержанный")
        check(a.eval("$.viewport.list().length") == 0, "list() пуст")
        check(a.eval("$.viewport.get(1)") is None, "get() вернул null")
        check(a.eval("$.viewport.remove(1)") is False, "remove() вернул false")

        error = a.eval(
            "(() => { try { $.viewport.create(64, 64); return 'no-error'; }"
            " catch (e) { return String(e.message); } })()"
        )
        check(isinstance(error, str) and "не поддержан" in error,
              "create() объясняет, что render target не поддержан (%s)" % error)

        error = a.eval(
            "(() => { try { $.viewport.draw(1, 0, 0, 64, 64, 1); return 'no-error'; }"
            " catch (e) { return String(e.message); } })()"
        )
        check(isinstance(error, str) and "не поддержан" in error,
              "draw() объясняет, что render target не поддержан")

        # --- Скриншот кадра со смешиванием ------------------------------------
        shot = a.screenshot(os.path.join(ROOT, "build", "render_blend_test.png"))
        check(os.path.getsize(shot) > 0, "скриншот кадра сохранён: " + shot)
        check(a.ping().get("pong") is True, "движок жив после кадра с режимами")

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
