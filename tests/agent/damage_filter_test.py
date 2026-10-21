#!/usr/bin/env python3
# ===========================================================================
# .damage(amount, source, type), .damageFilter(fn) и событие 'damaged'
# (опора брони/щита/сопротивлений в сниппетах health.*):
#   * без фильтров урон прежний, 'damaged' несёт amount/raw/type;
#   * фильтры применяются по порядку, итог не уходит ниже нуля;
#   * disposer снимает фильтр; ошибка фильтра не роняет урон;
#   * неуязвимость (iframes) — урона и события нет.
# Запуск: python3 tests/agent/damage_filter_test.py
# ===========================================================================
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=os.path.join("tests", "fixtures", "physics_edge"), seed=3) as a:
        a.step(2)
        r = a.eval("""(() => {
          const n = $('<box>', { id: 'df' }).at(10, 10).size(4, 4).health(100).appendTo($.world);
          const seen = [];
          n.on('damaged', (e) => seen.push(e.data));
          n.damage(10);
          const off = n.damageFilter((i) => i.type === 'fire' ? i.amount * 0.5 : i.amount);
          const off2 = n.damageFilter((i) => i.amount - 3);
          n.damage(20, 'lava', 'fire');
          n.damage(2);
          off(); off2();
          n.damage(5);
          n.damageFilter(() => { throw new Error('boom'); });
          n.damage(1);
          return { hp: n.hp(), seen };
        })()""")
        seen = r["seen"]
        check(seen[0]["amount"] == 10 and seen[0]["type"] == "normal", "без фильтров: 10, type normal")
        check(seen[1]["amount"] == 7 and seen[1]["raw"] == 20 and seen[1]["source"] == "lava", "фильтры по порядку: 20 fire → 10 → 7")
        check(seen[2]["amount"] == 0, "итог не ниже нуля: %s" % seen[2]["amount"])
        check(seen[3]["amount"] == 5, "disposer снял фильтры")
        check(seen[4]["amount"] == 1, "ошибка фильтра не отменяет урон")
        check(r["hp"] == 100 - 10 - 7 - 0 - 5 - 1, "hp %s" % r["hp"])
        n = a.eval("(() => { const m = $('#df'); let c = 0; m.on('damaged', () => c++); m.invulnerable(500); m.damage(50); return [c, m.hp()]; })()")
        check(n == [0, 77], "неуязвимость: нет урона и события: %s" % n)
    if FAILURES:
        print("FAILED: %d" % len(FAILURES))
        sys.exit(1)
    print("damage_filter_test: ok")


if __name__ == "__main__":
    main()
