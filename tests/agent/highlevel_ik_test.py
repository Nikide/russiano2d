#!/usr/bin/env python3
# ===========================================================================
# Обратная кинематика в движке: $.mesh.ik.
#
# Последний пункт §11 «осталось незакрытым» — IK.
#
# Решатели ЧИСТЫЕ и полностью покрыты юнит-тестом (tests/js/mesh_test.mjs, 12
# проверок). Здесь — то, что видно только в движке: метод доступен, скелет и
# части из $.mesh с ним работают, решение принимается для настоящего скелета, а
# недостижимая цель честно помечается.
#
# РИСОВАНИЕ деформированного меша проверяет highlevel_mesh_rig_test.py — здесь
# его дублировать не нужно.
#
# Запуск после сборки:
#   python3 tests/agent/highlevel_ik_test.py
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
        check(a.eval("typeof $.mesh.ik") == "function", "$.mesh.ik есть")
        check(a.eval("typeof $.mesh.skeleton") == "function", "скелет доступен")

        # Скелет «нога»: две кости по 60 от (0,0). Часть привязана ко второй.
        a.eval("""
            $.world.gravity(0,0).color('#000000').bounds(0,0,4000,2000);
            $.camera.at(0,0);
            globalThis.__rig = $.mesh.skeleton({
                thigh: { x: 0, y: 0, length: 60, angle: 0 },
                shin:  { parent: 'thigh', length: 60, angle: 0 },
            });
            globalThis.__part = $.mesh.part({
                verts: [-8, 0, 8, 0, 8, 40, -8, 40],
                uv: [0, 0, 1, 0, 1, 1, 0, 1],
                tris: [0, 1, 2, 0, 2, 3],
                bone: 'shin',
                depth: 0.2,
            });
            globalThis.__color = '#ff0000';
        """)

        # Цель (60, 80): расстояние 100 < 120 (две кости по 60) — достижимо.
        a.eval("""
            globalThis.__result = $.mesh.ik(globalThis.__rig, {},
                                            { x: 60, y: 80 },
                                            { chain: ['thigh', 'shin'] });
            globalThis.__tip = globalThis.__result.tip;
        """)
        tip = a.eval("JSON.stringify(globalThis.__tip)")
        print("  конец цепочки: %s" % tip)
        reached = a.eval("globalThis.__result.reached")
        dist = a.eval("globalThis.__result.distance")
        print("  reached=%s, промах=%.4f" % (reached, dist))
        check(reached is True, "IK дотянулся до цели")
        check(dist < 1.0, "промах меньше пикселя (%.4f)" % dist)
        check('"x":60' in tip.replace(".0", ""), "конец ровно в цели по X")
        check('"y":80' in tip.replace(".0", ""), "конец ровно в цели по Y")

        # Решение возвращает ДОБАВОЧНЫЕ углы, пригодные для pose().
        pose = a.eval("""
            JSON.stringify((() => {
                const p = globalThis.__rig.pose(globalThis.__result.angles);
                return { thigh: p.thigh.angle, shin: p.shin.angle };
            })())
        """)
        print("  мировые углы: %s" % pose)
        check("thigh" in pose and "shin" in pose, "углы применяются к pose()")

        # Недостижимая цель: reached=false и это ВИДНО (без молчаливого «прилипания»).
        a.eval("""
            globalThis.__far = $.mesh.ik(globalThis.__rig, {}, { x: 900, y: 0 },
                                         { chain: ['thigh', 'shin'] });
        """)
        fr = a.eval("globalThis.__far.reached")
        fd = a.eval("globalThis.__far.distance")
        print("  недостижимая цель: reached=%s, промах=%.1f" % (fr, fd))
        check(fr is False, "недостижимая цель отмечена reached=false")
        check(fd > 100, "и промах большой — игра увидит, что не дотянулись")

        # Сторона сгиба меняет колено.
        b1 = a.eval("$.mesh.ik(globalThis.__rig, {}, {x:60,y:80}, {chain:['thigh','shin'], bend:1}).angles.shin")
        b2 = a.eval("$.mesh.ik(globalThis.__rig, {}, {x:60,y:80}, {chain:['thigh','shin'], bend:-1}).angles.shin")
        print("  сгиб +1: %.3f, -1: %.3f" % (b1, b2))
        check(abs(b1 - b2) > 0.1, "сторона сгиба меняет решение")

        # Цепочка из трёх костей.
        a.eval("""
            globalThis.__rig3 = $.mesh.skeleton({
                a: { x: 0, y: 0, length: 50 },
                b: { parent: 'a', length: 50 },
                c: { parent: 'b', length: 50 },
            });
            globalThis.__r3 = $.mesh.ik(globalThis.__rig3, {}, { x: 40, y: 90 },
                                        { chain: ['a', 'b', 'c'], iterations: 40 });
        """)
        d3 = a.eval("globalThis.__r3.distance")
        print("  цепочка из трёх: промах %.3f" % d3)
        check(d3 < 2, "длинная цепочка дотягивается (промах %.3f)" % d3)

        # Без chain — честный null, а не молчаливая пустота.
        check(a.eval("$.mesh.ik(globalThis.__rig, {}, {x:1,y:1})") is None,
              "без chain → null")

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
