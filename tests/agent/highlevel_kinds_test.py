#!/usr/bin/env python3
# ===========================================================================
# Тест видов узла (`.kind()`, `$.kinds`, `Re2D`) через агентский интерфейс —
# фаза 1 docs/RE2D.md.
#
# Проверяет то, что видит игра внутри движка: константу и реестр видов, вид по
# умолчанию, назначение и снятие вида, выдачу вида в inspect/query/state,
# работу хука в рендере (отрисовщик вида берёт узел или отказывается), и то,
# что 2D-узел хук не вызывает вообще.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_kinds_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "kinds")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=7) as a:
        # --- Константа и реестр ------------------------------------------------
        check(a.eval("typeof $.kinds") == "object", "$.kinds доступно")
        check(a.eval("Re2D") == "re2d", "глобальная константа Re2D")
        check(a.eval("$.Re2D") == "re2d", "канонический $.Re2D")
        names = a.eval("$.kinds.list().map(k => k.name)")
        check(names[:2] == ["2d", "re2d"], "в реестре 2d и re2d первыми (%s)" % names)

        # --- Вид по умолчанию --------------------------------------------------
        check(a.eval("$('#flat').kind()") == "2d", "узел без kind — 2d")
        check(a.eval("$('#russi').kind()") == "re2d", "kind(Re2D) назначен в фикстуре")

        a.step(3)

        # --- Хук рендера -------------------------------------------------------
        calls = a.eval("globalThis.__calls")
        check(calls["probe"] >= 3, "отрисовщик probe вызывается каждый кадр (%s)" % calls)
        check(calls["skip"] >= 3, "отрисовщик skip тоже вызывается (%s)" % calls)

        before = a.eval("$.gfx.stats().sprites")
        a.eval("void $('#fallback').kind('skip')")      # отказывающий вид — узел рисуется как 2D
        a.step(1)
        with_fallback = a.eval("$.gfx.stats().sprites")
        a.eval("void $('#fallback').kind('probe')")     # теперь вид берёт узел и ничего не рисует
        a.step(1)
        taken = a.eval("$.gfx.stats().sprites")
        check(with_fallback == taken + 1,
              "отказ вида = обычная 2D-отрисовка (+1 спрайт): %s против %s" % (with_fallback, taken))
        check(before == with_fallback, "повторное назначение того же вида кадр не меняет")

        # 2D-узел хук не вызывает: счётчики растут только от kind-узлов.
        a.eval("globalThis.__calls.probe = 0; globalThis.__calls.skip = 0")
        a.eval("void $('#fallback').kind(null)")
        a.step(2)
        now = a.eval("globalThis.__calls")
        check(now["skip"] == 0, "узел, возвращённый в 2D, отрисовщик вида не зовёт (%s)" % now)

        # --- Снимок агента -----------------------------------------------------
        flat = a.inspect("#flat")
        russi = a.inspect("#russi")
        check("kind" not in flat, "inspect 2D-узла без поля kind")
        check(russi.get("kind") == "re2d", "inspect Re2D-узла показывает kind (%s)" % russi.get("kind"))
        found = a.query("[kind=re2d]")
        check(len(found) == 1 and found[0].get("id") == "russi", "query('[kind=re2d]') находит Re2D-узел")

        # --- Ошибка с подсказкой ----------------------------------------------
        msg = a.eval("(() => { try { $('#flat').kind('3d'); return ''; } catch (e) { return String(e.message); } })()")
        check("доступны" in msg, "неизвестный вид — ошибка с подсказкой (%s)" % msg)
        check(a.eval("$('#flat').kind()") == "2d", "после ошибки вид прежний")

    if FAILURES:
        print("\nПровалов: %d" % len(FAILURES))
        for f in FAILURES:
            print(" -", f)
        sys.exit(1)
    print("\nВсе проверки пройдены")


if __name__ == "__main__":
    main()
