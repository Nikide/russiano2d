#!/usr/bin/env python3
# ===========================================================================
# Проверка масштаба интерфейса и семантики доступности (a11y).
#
# Масштаб интерфейса — не «косметика»: на 4K HUD без масштаба не прочитать, а
# для слабого зрения это обязательная настройка. Здесь проверяется именно
# ПОЗИЦИЯ и РАЗМЕР узлов, а не наличие метода: масштаб, который ничего не
# меняет, выглядел бы зелёным тестом на существование.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_ui_scale_test.py
# ===========================================================================

import json
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


def box(a, sel):
    return json.loads(a.eval(f"JSON.stringify($('{sel}').nodes[0] ? "
                             f"{{x: $('{sel}').nodes[0].x, y: $('{sel}').nodes[0].y, "
                             f"w: $('{sel}').nodes[0].w, h: $('{sel}').nodes[0].h, "
                             f"size: $('{sel}').nodes[0].size}} : null)"))


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        a.eval("""
            $('<ui.label>', { id: 'hud', text: 'HP', size: 20, w: 100, h: 30 })
                .at(60, 40).appendTo($.ui);
            $('<ui.bar>', { id: 'stam', value: 0.5, w: 200, h: 12 })
                .at(60, 80).appendTo($.ui);
        """)
        check(a.eval("$.ui.scale()") == 1, "по умолчанию масштаб 1")

        before = box(a, "#hud")
        check(abs(before["x"] - 60) < 0.01 and abs(before["size"] - 20) < 0.01,
              f"до масштабирования: x = {before['x']:.0f}, кегль {before['size']:.0f}")

        a.eval("$.ui.scale(1.5)")
        check(a.eval("$.ui.scale()") == 1.5, "масштаб выставлен")
        after = box(a, "#hud")
        print(f"  HUD: x {before['x']:.0f} → {after['x']:.0f}, "
              f"кегль {before['size']:.0f} → {after['size']:.0f}")
        check(abs(after["x"] - 90) < 0.01, f"позиция умножилась: {after['x']:.1f} (ждали 90)")
        check(abs(after["size"] - 30) < 0.01, f"кегль умножился: {after['size']:.1f} (ждали 30)")
        check(abs(after["w"] - 150) < 0.01, f"ширина умножилась: {after['w']:.1f}")

        bar = box(a, "#stam")
        check(abs(bar["x"] - 90) < 0.01 and abs(bar["h"] - 18) < 0.01,
              f"второй узел тоже: x = {bar['x']:.0f}, высота {bar['h']:.0f}")

        # Повторный вызов НЕ удваивает: масштаб — абсолютная величина.
        a.eval("$.ui.scale(1.5)")
        again = box(a, "#hud")
        check(abs(again["x"] - 90) < 0.01, f"повторный scale(1.5) идемпотентен: x = {again['x']:.1f}")

        # Возврат к 1 обязан вернуть исходные числа.
        a.eval("$.ui.scale(1)")
        back = box(a, "#hud")
        check(abs(back["x"] - 60) < 0.01 and abs(back["size"] - 20) < 0.01,
              f"возврат к 1: x = {back['x']:.1f}, кегль {back['size']:.1f}")

        # Границы: масштаб зажимается, мусор не ломает интерфейс.
        a.eval("$.ui.scale(100)")
        check(a.eval("$.ui.scale()") == 4, f"верхний предел — 4: {a.eval('$.ui.scale()')}")
        a.eval("$.ui.scale(0)")
        check(a.eval("$.ui.scale()") == 1, f"ноль — не масштаб: {a.eval('$.ui.scale()')}")
        a.eval("$.ui.scale('чушь')")
        check(a.eval("$.ui.scale()") == 1, "нечисло не ломает")

        # --- a11y -----------------------------------------------------------
        check(a.eval("$.ui.ariaCount()") == 0, "сначала семантики нет")
        check(a.eval("$.ui.aria('#hud')") is None, "у узла её тоже нет")

        a.eval("$.ui.aria('#hud', { role: 'status', label: 'Здоровье' })")
        a.eval("$.ui.aria('#stam', { role: 'progressbar', label: 'Выносливость', max: 100 })")
        check(a.eval("$.ui.ariaCount()") == 2, "семантика у двух узлов")

        aria = json.loads(a.eval("JSON.stringify($.ui.ariaOf('#hud'))"))
        check(aria.get("role") == "status", f"роль записана: {aria.get('role')}")
        check(aria.get("label") == "Здоровье", f"подпись записана: {aria.get('label')}")

        # Дополнение не затирает записанное.
        a.eval("$.ui.aria('#hud', { live: 'polite' })")
        aria2 = json.loads(a.eval("JSON.stringify($.ui.ariaOf('#hud'))"))
        check(aria2.get("role") == "status" and aria2.get("live") == "polite",
              "дополнение сохранило прежние поля")

        # Семантика попадает в снимок агента — иначе её не проверить тестом.
        data = json.loads(a.eval("JSON.stringify($.agent.snapshot())"))
        ui_nodes = data.get("ui") or []
        check(isinstance(ui_nodes, list) and len(ui_nodes) > 0,
              f"в снимке есть раздел ui ({len(ui_nodes)} узлов)")
        with_aria = [n for n in ui_nodes if n.get("aria")]
        check(len(with_aria) >= 2, f"в снимке {len(with_aria)} ui-узлов с семантикой")
        roles = sorted(n.get("aria", {}).get("role") for n in with_aria)
        check("status" in roles and "progressbar" in roles, f"роли в снимке: {roles}")

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
