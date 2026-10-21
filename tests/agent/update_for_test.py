#!/usr/bin/env python3
# ===========================================================================
# $.updateFor(node, fn): покадровая подписка, принадлежащая узлу
# (docs/SNIPPET_SYSTEM_PROJECT.md §3.2). Проверяется:
#   * fn вызывается каждый кадр с (dt, обёртка узла, $);
#   * disposer снимает подписку, повторный вызов безопасен;
#   * удаление узла снимает подписку само — callback'ов не остаётся;
#   * неверные аргументы — TypeError, а не молчаливый no-op.
# Запуск: python3 tests/agent/update_for_test.py
# ===========================================================================
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "physics_edge")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=3) as a:
        a.step(2)
        a.eval("""
          globalThis.__uf = { a: 0, b: 0, same: true };
          const n = $('<box>', { id: 'ufa' }).at(10, 10).size(4, 4).appendTo($.world);
          const m = $('<box>', { id: 'ufb' }).at(20, 20).size(4, 4).appendTo($.world);
          $.updateFor(n, (dt, node) => { __uf.a++; if (node.attr('id') !== 'ufa') __uf.same = false; });
          globalThis.__ufOff = $.updateFor(m, () => { __uf.b++; });
          'ok'
        """)
        a.step(5)
        check(a.eval("__uf.a") == 5, "fn узла вызвана 5 раз: %s" % a.eval("__uf.a"))
        check(a.eval("__uf.same") is True, "fn получает обёртку своего узла")
        a.eval("__ufOff(); __ufOff(); 'ok'")
        b = a.eval("__uf.b")
        a.step(3)
        check(a.eval("__uf.b") == b, "disposer снял подписку (%s → %s)" % (b, a.eval("__uf.b")))
        a.eval("$('#ufa').remove(); 'ok'")
        a_count = a.eval("__uf.a")
        a.step(3)
        check(a.eval("__uf.a") == a_count, "удалённый узел не получает кадры")
        bad = a.eval("""(() => { try { $.updateFor(null, () => {}); return 'no'; }
                        catch (e) { return e instanceof TypeError ? 'type' : 'other'; } })()""")
        check(bad == "type", "updateFor(null) — TypeError: %s" % bad)
    if FAILURES:
        print("FAILED: %d" % len(FAILURES))
        sys.exit(1)
    print("update_for_test: ok")


if __name__ == "__main__":
    main()
