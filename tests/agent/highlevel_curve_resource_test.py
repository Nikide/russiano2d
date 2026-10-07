#!/usr/bin/env python3
# ===========================================================================
# Curve/Gradient как ресурсы: $.resource.define('dmg', { kind: 'curve', ... }).
#
# Зачем: §12.4 «Curve/Gradient как ресурсы» — $.curve умел кривые и градиенты,
# но в $.resource таких видов не было, поэтому кривую нельзя было описать в
# манифесте и взять по имени.
#
# Грабли, найденные при реализации (обе — молчаливый null вместо ошибки):
#   1. normalizeSpec требовал `path` для всего, кроме вида `data`, поэтому
#      curve/gradient отбрасывались: define возвращал null, а get потом
#      отдавал null без причины;
#   2. normalizeSpec СОБИРАЕТ новый объект из известных полей — points/stops
#      надо было переносить явно, иначе они терялись.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_curve_resource_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

GAME = os.path.join("tests", "fixtures", "text")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def main():
    with Agent(game=GAME, seed=5, fixed_dt=1.0 / 60.0) as a:
        check(a.eval("$.resource.RESOURCE_KINDS || true") is not None, "модуль ресурсов жив")
        check(a.eval("typeof $.resource.define") == "function", "define есть")

        # --- кривая как ресурс ---
        defined = a.eval("""
            JSON.stringify($.resource.define('damage', {
                kind: 'curve', points: [0, 1, 0.25, 0], mode: 'linear'
            }))
        """)
        print("  define: %s" % defined)
        check('"kind":"curve"' in defined, "кривая описана (define не вернул null)")

        kind = a.eval("typeof $.resource.get('damage')")
        print("  get: %s" % kind)
        check(kind == "function", "кривая берётся по имени и вызывается")

        vals = a.eval("JSON.stringify($.resource.get('damage').range(5))")
        print("  range(5): %s" % vals)
        check(vals.startswith("[0,"), "значения кривой считаются")
        at0 = a.eval("$.resource.get('damage').at(0)")
        at1 = a.eval("$.resource.get('damage').at(1)")
        check(abs(at0 - 0) < 1e-9, "at(0) = 0")
        check(abs(at1 - 0) < 1e-9, "at(1) = 0 (кривая возвращается к нулю)")

        # --- графиент как ресурс ---
        a.eval("""
            $.resource.define('fire', {
                kind: 'gradient', stops: ['#fff2a8', '#ff6b1a', '#7a1f00']
            });
        """)
        gkind = a.eval("typeof $.resource.get('fire')")
        print("  градиент: %s" % gkind)
        check(gkind == "function", "градиент берётся по имени и вызывается")
        c0 = a.eval("$.resource.get('fire')(0)")
        c1 = a.eval("$.resource.get('fire')(1)")
        mid = a.eval("$.resource.get('fire')(0.5)")
        print("  цвета: %s / %s / %s" % (c0, mid, c1))
        check(c0 != c1, "края градиента разные (интерполяция есть)")
        check(c0 != mid and c1 != mid, "середина отличается от краёв")

        # --- РАЗНЫЕ кривые не склеиваются в одну (это ловит ключ описания) ---
        # Значения берём в точках, где кривые заведомо расходятся: at(0.5) у
        # [0,1] и [1,0] совпадает (0.5 и 0.5), а at(0.25) — нет.
        diff = a.eval("""
            (() => {
                $.resource.define('c1', { kind: 'curve', points: [0, 1] });
                $.resource.define('c2', { kind: 'curve', points: [1, 0] });
                return $.resource.get('c1').at(0.25) + ' / ' + $.resource.get('c2').at(0.25);
            })()
        """)
        print("  две кривые в 0.25: %s" % diff)
        check(diff.strip() == "0.25 / 0.75", "разные кривые дают разные значения")

        # --- обе кривые живы и это РАЗНЫЕ объекты ---
        check(a.eval("$.resource.get('c1') !== $.resource.get('c2')") is True,
              "c1 и c2 — разные значения")

        # --- кривая без points: отказ, а не исключение и не тишина ---
        bad = a.eval("""
            (() => {
                $.resource.define('broken', { kind: 'curve' });
                const v = $.resource.get('broken');
                return v === null ? 'null' : typeof v;
            })()
        """)
        print("  кривая без points: %s" % bad)
        check(bad == "null", "кривая без points не загружается (null, не падение)")

        # --- имена видны, ресурсы можно перечислить ---
        names = a.eval("JSON.stringify($.resource.names())")
        print("  ресурсы: %s" % names)
        for want in ("damage", "fire", "c1", "c2"):
            check('"%s"' % want in names, "в списке есть %s" % want)

        # --- регрессии: обычные виды не сломаны ---
        check(a.eval("typeof $.resource.define('d', { kind: 'data', value: 42 })") is not None,
              "вид data по-прежнему работает")
        check(a.eval("$.resource.get('d')") == 42, "data отдаёт значение")

    print()
    if FAILURES:
        print("ПРОВАЛОВ: %d" % len(FAILURES))
        for f in FAILURES:
            print("  - " + f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
