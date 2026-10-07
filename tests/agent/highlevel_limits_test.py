#!/usr/bin/env python3
# ===========================================================================
# Проверка отчёта о лимитах: $.debug.limits().
#
# Зачем: половина лимитов движка не была видна игре вообще, а поведение при
# достижении разное — где-то -1, где-то исключение, где-то тихая потеря.
# Игре нужно ЗАРАНЕЕ видеть, близко ли она к потолку: «потолок 256» без
# занятости не отвечает на вопрос «сколько осталось».
#
# Здесь проверяется не список полей, а то, что занятость РЕАЛЬНО меняется от
# действий игры, и что счётчик выглядит разумно.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_limits_test.py
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


def limits(a):
    return json.loads(a.eval("JSON.stringify($.debug.limits())"))


def main():
    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0) as a:
        a.eval("$.world.gravity(0, 0).bounds(0, 0, 640, 360)")
        lim = limits(a)
        check(isinstance(lim, dict) and len(lim) > 10,
              f"отчёт отдаёт полей: {len(lim)}")

        # Обязательные поля: занятость + потолок.
        required = [
            ("textures", "textures_max"), ("bodies", "bodies_max"),
            ("joints", "joints_max"), ("user_shaders", "user_shaders_max"),
            ("viewports", "viewports_max"), ("ui_callbacks", "ui_callbacks_max"),
            ("contact_events", "contact_events_max"), ("node_fx", "node_fx_max"),
            ("gamepads", "gamepads_max"), ("touches_max",),
        ]
        missing = []
        for need in required:
            for name in need:
                if name not in lim:
                    missing.append(name)
        check(not missing, f"все нужные поля на месте (нет: {missing})")

        # Потолки совпадают с C: раньше JS-слой держал СВОЙ предел эффектов (60
        # против 64 в C) и молча терял лишние.
        check(lim["node_fx_max"] == 64, f"потолок эффектов узла: {lim['node_fx_max']} (в C — 64)")
        check(lim["viewports_max"] == 8, f"вьюпортов: {lim['viewports_max']}")
        check(lim["user_shaders_max"] == 16, f"пользовательских шейдеров: {lim['user_shaders_max']}")
        check(lim["gamepads_max"] == 4, f"слотов геймпада: {lim['gamepads_max']}")

        # Занятость тел растёт от действий игры.
        before = limits(a)["bodies"]
        a.eval("""
            $('<wall>', { id: 'w1', w: 40, h: 40 }).at(100, 100).appendTo($.world);
            $('<wall>', { id: 'w2', w: 40, h: 40 }).at(200, 100).appendTo($.world);
        """)
        a.step(1)
        after = limits(a)["bodies"]
        print(f"  тела: {before} → {after}")
        check(after >= before + 2, f"занятость тел выросла ({before} → {after})")

        # Суставы: создаём и видим рост.
        j0 = limits(a)["joints"]
        a.eval("$('<enemy>', { id: 'e1', w: 20, h: 20 }).at(300, 100).appendTo($.world)")
        a.eval("$.world.joint('#w1', '#e1', { type: 'revolute' })")
        a.step(1)
        j1 = limits(a)["joints"]
        check(j1 >= j0 + 1, f"занятость суставов выросла ({j0} → {j1})")

        # Вьюпорт: раньше отдавался только потолок.
        v0 = limits(a)["viewports"]
        a.eval("const vp = $.viewport.create(64, 48); globalThis.__vp = vp;")
        a.step(1)
        v1 = limits(a)["viewports"]
        print(f"  вьюпорты: {v0} → {v1} (потолок {lim['viewports_max']})")
        check(v1 >= v0 + 1, f"занятость вьюпортов выросла ({v0} → {v1})")
        a.eval("$.viewport.destroy(globalThis.__vp)")
        a.step(1)
        check(limits(a)["viewports"] == v0, "после destroy занятость вернулась")

        # Обработчики UI: раньше отдавался только потолок 256.
        c0 = limits(a)["ui_callbacks"]
        check(c0 >= 0, f"обработчиков UI сейчас: {c0}")

        # Занятость не превышает потолок.
        lim2 = limits(a)
        bad = [k for k in lim2 if k.endswith("_max") and not k.startswith("touch")]
        over = []
        for name in ["textures", "bodies", "joints", "user_shaders", "viewports",
                     "ui_callbacks", "contact_events", "node_fx", "gamepads"]:
            if name in lim2 and lim2[name] > lim2.get(name + "_max", 1 << 30):
                over.append(name)
        check(not over, f"занятость не выше потолка (превысили: {over})")

        # Отчёт не падает без движка-объектов и повторяем.
        check(json.dumps(limits(a)) == json.dumps(limits(a)), "отчёт стабилен между вызовами")

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
