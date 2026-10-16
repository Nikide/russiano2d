#!/usr/bin/env python3
# ===========================================================================
# §6.6. Луч: попадание и промах, старт внутри тела, луч ровно по стыку плит,
# слой/маска и выключенная форма.
#
# Фикстура: tests/fixtures/physics_raycast/main.js.
#
# Контракт луча (docs/internal/NATIVE.md, §16, `engine.raycast`):
#   * луч возвращает ближайшее препятствие;
#   * «Луч, начинающийся ВНУТРИ тела, это тело не находит: Box2D игнорирует
#     начальное перекрытие» — поэтому «стою ли на земле» проверяется лучом из
#     центра узла (api.js, onFloor);
#   * `mask` запроса решает, какие слои луч видит; `0`/отсутствие — все слои.
#
# Общие маски/свипы формы уже покрыты highlevel_collision_test.py — здесь
# только пробелы §6.6: выключенная форма, старт внутри, стык/угол, layerBits.
#
# Запуск:
#   python3 tests/agent/highlevel_physics_raycast_test.py
# ===========================================================================

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []
GAME = os.path.join("tests", "fixtures", "physics_raycast")

#: Геометрия фикстуры.
BOX_LEFT, BOX_TOP = 1100.0, 350.0          # ray-box: x 1100..1300, y 350..450
FAR_LEFT = 1480.0                          # ray-far: x 1480..1520
SHARED_X, SHARED_TOP = 2300.0, 350.0       # стык плит shared-a | shared-b


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ray(a, x1, y1, x2, y2, opts=""):
    """Луч через $.world.raycast, приведённый к простому словарю или None."""
    return a.eval("""(() => {
        const h = $.world.raycast({ x: %f, y: %f }, { x: %f, y: %f }%s);
        if (!h) return null;
        return {
            id: h.node ? h.node.id : null,
            x: h.point.x, y: h.point.y,
            nx: h.normal.x, ny: h.normal.y,
            fraction: h.fraction,
        };
    })()""" % (x1, y1, x2, y2, opts))


def main():
    with Agent(game=GAME, seed=11) as a:
        a.step(5)
        bodies = a.eval("({ box: $('#ray-box').get(0).body,"
                        "  a: $('#shared-a').get(0).body,"
                        "  b: $('#shared-b').get(0).body })")
        check(all(v >= 0 for v in bodies.values()),
              f"у целей луча есть тела Box2D ({bodies})")

        # =====================================================================
        # 1. Промах и попадание.
        # =====================================================================
        check(ray(a, 100, 100, 600, 100) is None,
              "луч в пустоте не находит ничего (null, а не исключение)")
        hit = ray(a, 1000, 400, 1400, 400)
        check(hit is not None and hit["id"] == "ray-box",
              f"луч упирается в стену ({(hit or {}).get('id')})")
        check(hit is not None and abs(hit["x"] - BOX_LEFT) < 0.5
              and abs(hit["y"] - 400) < 0.5 and abs(hit["fraction"] - 0.25) < 1e-3,
              f"точка попадания — левая грань (x={hit['x']:.1f}, y={hit['y']:.1f}, "
              f"fraction={hit['fraction']:.3f}, ждём 1100/400/0.25)")
        check(abs(hit["nx"] + 1) < 0.01 and abs(hit["ny"]) < 0.01,
              f"нормаль смотрит наружу поверхности ({hit['nx']:.2f}/{hit['ny']:.2f})")

        # =====================================================================
        # 2. Старт ВНУТРИ тела — документированное «начальное перекрытие».
        # =====================================================================
        check(ray(a, 1200, 400, 1250, 400) is None,
              "луч, начинающийся внутри тела, это тело не находит "
              "(Box2D игнорирует начальное перекрытие — NATIVE.md §16)")
        through = ray(a, 1200, 400, 1600, 400)
        check(through is not None and through["id"] == "ray-far",
              f"но начавшееся внутри перекрытие не гасит луч целиком: он идёт "
              f"дальше и находит стену за телом ({(through or {}).get('id')})")
        check(through is not None and abs(through["x"] - FAR_LEFT) < 0.5,
              f"и упирается именно в дальнюю стену (x={(through or {}).get('x')}, "
              f"ждём {FAR_LEFT:.0f})")
        check(ray(a, BOX_LEFT, 400, 1400, 400) is None,
              "луч, начавшийся РОВНО на поверхности и идущий внутрь, тоже "
              "считается начальным перекрытием (fraction == 0)")

        # =====================================================================
        # 3. Кромка: луч ровно по стыку плит и ровно через общий угол.
        # =====================================================================
        # Плиты shared-a | shared-b сходятся по x = 2300; луч идёт по стыку.
        edge = ray(a, SHARED_X, 300, SHARED_X, 600)
        check(edge is not None and edge["id"] in ("shared-a", "shared-b"),
              f"луч ровно по стыку плит не проваливается в щель "
              f"(попадание в {edge and edge['id']})")
        check(edge is not None and abs(edge["x"] - SHARED_X) < 0.5
              and abs(edge["y"] - SHARED_TOP) < 0.5,
              f"и останавливается на общем углу плит ({(edge or {}).get('x')}, "
              f"{(edge or {}).get('y')}; ждём {SHARED_X:.0f}, {SHARED_TOP:.0f})")
        check(edge is not None and abs(edge["fraction"] - 1.0 / 6.0) < 1e-3,
              f"доля пути до угла считается верно (fraction={edge['fraction']:.4f}, "
              f"ждём {1.0 / 6.0:.4f})")

        corner = ray(a, 2200, 250, 2400, 450)   # прямая y = x - 1950 идёт через угол
        check(corner is not None and corner["id"] in ("shared-a", "shared-b")
              and abs(corner["x"] - SHARED_X) < 0.5
              and abs(corner["y"] - SHARED_TOP) < 0.5
              and abs(corner["fraction"] - 0.5) < 1e-3,
              f"луч ровно через общий угол тоже детерминирован "
              f"({(corner or {}).get('id')}, fraction={(corner or {}).get('fraction', -1):.4f})")

        # И то, и другое должно повторяться кадр в кадр, а не «дрожать».
        seq = []
        for _ in range(10):
            a.step(1)
            seq.append((ray(a, SHARED_X, 300, SHARED_X, 600),
                        ray(a, 2200, 250, 2400, 450)))
        check(all(s == seq[0] for s in seq),
              f"стык и угол дают один и тот же ответ все 10 кадров "
              f"({seq[0][0]['id']}/f={seq[0][0]['fraction']:.4f}, "
              f"{seq[0][1]['id']}/f={seq[0][1]['fraction']:.4f})")

        # =====================================================================
        # 4. Слой и маска: .layerBits(4) + маска без этого слоя — попадания нет.
        # =====================================================================
        check(ray(a, 1000, 700, 1400, 700) is not None
              and ray(a, 1000, 700, 1400, 700)["id"] == "layer-box",
              "без маски луч видит стену слоя 0x4")
        check(ray(a, 1000, 700, 1400, 700, ", { mask: 0x4 }") is not None,
              "маска 0x4 видит стену слоя 0x4")
        check(ray(a, 1000, 700, 1400, 700, ", { mask: 0x1 }") is None,
              "маска 0x1 (без слоя 0x4) не видит эту стену — попадания нет")

        # Тот же слой, выставленный на живом теле: .layerBits(N) на ray-box.
        a.eval("$('#ray-box').layerBits(0x4)")
        a.step(1)
        check(ray(a, 1000, 400, 1400, 400, ", { mask: 0x1 }") is None,
              ".layerBits(0x4) на живом теле: маска 0x1 больше его не видит")
        check(ray(a, 1000, 400, 1400, 400, ", { mask: 0x4 }") is not None,
              "а маска 0x4 видит")
        a.eval("$('#ray-box').layerBits(0x1)")
        a.step(1)

        # =====================================================================
        # 5. Выключенная форма: engine.setShapeEnabled(body, 0, false).
        # =====================================================================
        body = bodies["box"]
        disabled = a.eval("engine.setShapeEnabled(%d, 0, false)" % body)
        check(disabled is True, "engine.setShapeEnabled(body, 0, false) вернул true")
        check(a.eval("engine.shapeEnabled(%d, 0)" % body) is False,
              "engine.shapeEnabled() подтверждает: форма выключена")
        check(ray(a, 1000, 400, 1400, 400) is None,
              "луч сквозь выключенную форму не находит её (и ничего за ней нет)")
        all_hits = a.eval("$.world.raycastAll({x:1000,y:400},{x:1400,y:400})"
                          ".map(h => h.node.id)")
        check(all_hits == ["ray-box"],
              f"raycastAll документирован как обход ПО ПРЯМОУГОЛЬНИКАМ узлов, "
              f"поэтому выключенную форму он всё ещё называет ({all_hits}) — "
              f"физический луч и обход границ расходятся осознанно")

        enabled = a.eval("engine.setShapeEnabled(%d, 0, true)" % body)
        check(enabled is True, "форма включается обратно")
        check(a.eval("engine.shapeEnabled(%d, 0)" % body) is True,
              "engine.shapeEnabled() подтверждает: форма включена")
        back = ray(a, 1000, 400, 1400, 400)
        check(back is not None and back["id"] == "ray-box",
              f"после включения луч снова упирается в стену ({(back or {}).get('id')})")

        # =====================================================================
        # 6. Несколько попаданий: $.world.raycastAll.
        # =====================================================================
        many = a.eval("$.world.raycastAll({x:2100,y:400},{x:2500,y:400})"
                      ".map(h => [h.node.id, h.t])")
        check([m[0] for m in many] == ["shared-a", "shared-b"],
              f"raycastAll отдаёт оба пересечения по порядку ({[m[0] for m in many]})")
        check(len(many) == 2 and many[0][1] < many[1][1],
              f"попадания отсортированы по доле пути ({[round(m[1], 3) for m in many]})")
        check(a.eval("$.world.raycastAll({x:100,y:100},{x:600,y:100}).length") == 0,
              "raycastAll в пустоте пуст")

        # =====================================================================
        a.step(10)
        check(a.eval("engine.frame > 0") is True, "движок продолжает работать")

        if FAILURES:
            print(a.stderr_tail(15))

    print("\nВсе проверки пройдены" if not FAILURES else f"\nПРОВАЛЕНО: {len(FAILURES)}")
    for line in FAILURES:
        print("  - " + line)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
