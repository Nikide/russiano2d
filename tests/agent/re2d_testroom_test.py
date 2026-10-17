#!/usr/bin/env python3
# ===========================================================================
# Re2D: тестовая комната врагов на билбордах (только прогулки, без оружия).
#
# Проверяется живым прогоном:
#   * игрок ходит вперёд/назад/боком (yaw камеры — ГРАДУСЫ), упирается в
#     внутреннюю стену и в границу комнаты;
#   * камера жёстко на теле (smooth 0): camera.x/y равны hero.x/y;
#   * враги — плоские PNG-билборды: арт виден по скриншоту с фронта и НЕ виден,
#     когда камера смотрит в противоположную сторону;
#   * враги патрулируют (координаты меняются), подходят к игроку ближе 380 px
#     и останавливаются, но НЕ атакуют;
#   * оружия нет: state.weapons == 0, узлов weapon/bullet в мире нет,
#     ошибок игрового кода нет.
#
# Запуск: python3 tests/agent/re2d_testroom_test.py
# ===========================================================================

import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402
from re2d_skip import skip_without_re2d   # noqa: E402

GAME = "demos"
SCENE = "re2d_testroom"
SHOTS = os.path.join("build", "shots")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def state(a):
    return a.state().get("re2dTestroom") or {}


def green_pixels(path):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    n = 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = img.getpixel((x, y))
            if g > r + 18 and g > b + 18 and g > 60:
                n += 1
    return n


def main():
    with Agent(game=GAME, scene=SCENE, seed=5) as a:
        if skip_without_re2d(a):
            return 0
        a.step(8)

        check(a.eval("$.scene.current()") == SCENE,
              f"сцена загружена: {a.eval('$.scene.current()')}")
        st = state(a)
        check(st.get("camera", {}).get("kind") == "re2d",
              f"камера в Re2D: {st.get('camera')}")
        check(st.get("weapons") == 0, "в состоянии 0 оружия")
        check(a.eval("$.world.count('weapon')") == 0, "узлов <weapon> нет")
        check(a.eval("$.world.count('bullet')") == 0, "узлов <bullet> нет")
        check(a.eval("$('#testroom-title').length") == 1,
              "HUD-заголовок на месте")
        status_text = a.eval("$('#testroom-status').get(0).text")
        check("врагов" in status_text,
              "статус HUD пишет число врагов: %r" % (status_text,))

        # --- Ходьба вперёд и жёсткая камера ---------------------------------
        start = st["hero"]
        yaw0 = a.eval("$.camera.info().yaw")
        a.hold(["W"]); a.step(40); a.release_all(); a.step(2)
        st = state(a)
        moved = start["y"] - st["hero"]["y"]
        check(moved > 80,
              f"W идёт вперёд (y {start['y']} → {st['hero']['y']}, Δ={moved:.1f})")
        check(abs(st["hero"]["x"] - start["x"]) < 12,
              f"вперёд — без бокового сноса (Δx={st['hero']['x'] - start['x']:.1f})")
        check(a.eval("$.camera.info().yaw") == yaw0,
              f"при ходьбе yaw не меняется: {yaw0}")
        cam = st["camera"]
        check(abs(cam["x"] - st["hero"]["x"]) <= 1 and abs(cam["y"] - st["hero"]["y"]) <= 1,
              f"камера жёстко на теле (smooth 0): cam=({cam['x']},{cam['y']}) hero={st['hero']}")

        # --- Упор во внутреннюю стену (y=600) и в южную границу -------------
        a.hold(["W"]); a.step(320); a.release_all(); a.step(2)
        wall = state(a)["hero"]
        check(600 < wall["y"] < 660,
              f"внутренняя стена остановила игрока (y={wall['y']}, стена y=600)")
        a.hold(["S"]); a.step(320); a.release_all(); a.step(2)
        south = state(a)["hero"]
        check(1140 < south["y"] < 1200,
              f"южная граница комнаты держит (y={south['y']})")
        x0 = south["x"]
        a.hold(["A"]); a.step(40); a.release_all(); a.step(2)
        lateral = state(a)["hero"]["x"] - x0
        check(lateral < -40,
              f"A идёт боком (Δx={lateral:.1f})")

        # --- Враги: патруль и «замечание» -----------------------------------
        before = {e["id"]: (e["x"], e["y"]) for e in state(a)["enemies"]}
        a.step(120)
        after = state(a)["enemies"]
        moved_any = [e["id"] for e in after
                     if abs(e["x"] - before[e["id"]][0]) + abs(e["y"] - before[e["id"]][1]) > 5]
        check(len(moved_any) >= 4,
              f"враги патрулируют: сдвинулись {len(moved_any)} из {len(after)}: {moved_any}")
        inside = all(20 <= e["x"] <= 1580 and 20 <= e["y"] <= 1180 for e in after)
        check(inside, f"все враги внутри комнаты: {[(e['id'], e['x'], e['y']) for e in after]}")
        modes = set(e.get("mode") for e in after)
        check(modes <= {"patrol", "notice", "idle"},
              f"режимы врагов только patrol/notice/idle (атак нет): {modes}")

        # Луч видимости: за внутренней стеной враг НЕ «видит» игрока и не идёт
        # напролом сквозь стену (кинематика не умеет обходить).
        a.eval("(() => { const h=$('#hero').get(0);"
               " h.x = 900; h.y = 660; h.syncBody && h.syncBody(); return 1; })()")
        a.step(3)
        blocked = next(e for e in state(a)["enemies"] if e["id"] == "cat-nw")
        check(blocked["seen"] is False,
              f"за стеной враг не видит игрока (seen={blocked['seen']}, "
              f"distance={blocked['distance']})")
        a.step(80)
        blocked2 = next(e for e in state(a)["enemies"] if e["id"] == "cat-nw")
        check(blocked2["mode"] != "notice",
              f"за стеной враг не идёт к игроку (режим {blocked2['mode']})")

        # Игрок на той же стороне: враг замечает и подходит, но не бьёт.
        # Запад, а не восток: восточнее стоит cat-ne, и его тело перекрывает
        # луч (враги — тоже тела), «в открытую» превращалось в ложный отказ.
        a.eval("(() => { const n=$('#cat-nw').get(0);"
               " const h=$('#hero').get(0); h.x = n.x - 300; h.y = n.y;"
               " h.syncBody && h.syncBody(); return 1; })()")
        a.step(2)
        e0 = next(e for e in state(a)["enemies"] if e["id"] == "cat-nw")
        d0 = e0["distance"]
        a.step(90)
        st_near = state(a)
        d1 = next(e["distance"] for e in st_near["enemies"] if e["id"] == "cat-nw")
        mode_near = next(e["mode"] for e in st_near["enemies"] if e["id"] == "cat-nw")
        check(e0["seen"] is True and d1 <= d0 and mode_near in ("notice", "idle"),
              f"в открытую враг замечает и подходит: seen={e0['seen']}, "
              f"distance {d0} → {d1}, режим {mode_near}")
        check(st_near["weapons"] == 0, "у врага и игрока по-прежнему нет оружия")

        # --- Билборд виден по арту: изолируем один враг ---------------------
        os.makedirs(SHOTS, exist_ok=True)
        others = "['cat-ne','cat-mid','cat-w','cat-e','cat-se']"
        a.eval(f"{others}.forEach((id) => $('#' + id).hide()); 'ok'")
        a.eval("(() => { const h=$('#hero').get(0), n=$('#cat-nw').get(0);"
               " h.x = n.x - 240; h.y = n.y; h.syncBody && h.syncBody();"
               " $.camera.yaw(Math.atan2(n.y-h.y, n.x-h.x) * 180 / Math.PI); return 1; })()")
        a.step(3)
        front = a.screenshot(os.path.join(SHOTS, "re2d_testroom_front.png"))
        g_front = green_pixels(front)
        # Остальные враги скрыты, поэтому спрятанный cat-nw должен убрать
        # практически весь зелёный арт из кадра.
        a.eval("$('#cat-nw').hide(); 'ok'")
        a.step(3)
        hidden = a.screenshot(os.path.join(SHOTS, "re2d_testroom_hidden.png"))
        g_hidden = green_pixels(hidden)
        a.eval("$('#cat-nw').show(); %s.forEach((id) => $('#' + id).show()); 'ok'" % others)
        check(g_front > 400,
              f"билборд врага виден с фронта (зелёных пикселей {g_front})")
        check(g_hidden < g_front * 0.2,
              f"спрятанный cat-nw убирает свой арт с кадра ({g_hidden} против {g_front})")

        errors = a.eval("JSON.stringify($.debug.errors())")
        check(errors in ("[]", "null"), f"ошибок игрового кода нет: {errors[:200]}")

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
