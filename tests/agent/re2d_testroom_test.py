#!/usr/bin/env python3
# ===========================================================================
# Re2D test room: карта из SDK `.re2dmap`, мир `$.re2dWorld`, враги-билборды
# и оружие от первого лица.
#
# Проверяется живым прогоном:
#   * карта собрана SDK (`testroom.re2dmap` → `testroom.re2dworld`) и грузится
#     через `$.re2dWorld.load`: cells/surfaces/lights не выдуманы;
#   * ходьба: W идёт вперёд, упирается во внутреннюю стену (y≈620) и южную
#     границу; A — боком; высота глаз едет по `world.support`;
#   * враги: 6 данных, лист 40 кадров (5×8), ходьба меняет строки 0..3,
#     поворот = колонка по `facing − yaw` (0 лицом … 4 спиной) + зеркало;
#     за внутренней стеной враг не «видит» игрока (`world.ray`), а на кадре
#     он скрыт оверлеем (occluded > 0);
#   * оружие: 3 вида, 1/2/3 переключают, выстрел 0→1→2→3→0 со звуком на
#     кадре 1, R — перезарядка со звуком; урона/боя нет (combat: false);
#   * ошибок игрового кода нет.
#
# Запуск: python3 tests/agent/re2d_testroom_test.py
# ===========================================================================

import json
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
        a.step(10)

        check(a.eval("$.scene.current()") == SCENE,
              f"сцена загружена: {a.eval('$.scene.current()')}")
        st = state(a)
        check(st.get("map", "").endswith("testroom.re2dworld"),
              f"карта — скомпилированный SDK-мир: {st.get('map')}")
        src = os.path.join("demos", "re2d_testroom", "testroom.re2dmap")
        check(os.path.isfile(src), f"рядом лежит SDK-исходник карты: {src}")
        check(os.path.isfile(os.path.join("demos", "re2d_testroom", "testroom.re2dworld")),
              "скомпилированный .re2dworld существует")
        world = st.get("world") or {}
        check(world.get("cells", 0) >= 1 and world.get("surfaces", 0) >= 12,
              f"мир сообщает геометрию: {world}")
        check(str(st.get("backend", "")).startswith(("gpu", "cpu")),
              f"бэкенд мира: {st.get('backend')}")
        hero = st.get("hero") or {}
        check(abs(hero.get("x", 0) - 800) < 1 and abs(hero.get("y", 0) - 1080) < 1
              and abs(hero.get("h", 0) - 48) < 1,
              f"игрок на спавне, глаза на 48: {hero}")
        check(st.get("weapons") == 3 and st.get("combat") is False,
              f"три оружия и нет боя: weapons={st.get('weapons')}, combat={st.get('combat')}")
        check(st.get("frames") == 40, f"у врага лист 5×8 = 40 кадров: {st.get('frames')}")
        check(a.eval("$.world.count('weapon')") == 0
              and a.eval("$.world.count('bullet')") == 0,
              "узлов weapon/bullet нет (оружие — HUD)")

        # --- Ходьба и коллизии мира -----------------------------------------
        start = state(a)["hero"]
        a.hold(["W"]); a.step(40); a.release_all(); a.step(2)
        st = state(a)
        moved = start["y"] - st["hero"]["y"]
        check(moved > 80, f"W идёт вперёд (y {start['y']} → {st['hero']['y']}, Δ={moved:.1f})")
        check(abs(st["hero"]["x"] - start["x"]) < 12,
              f"вперёд без бокового сноса (Δx={st['hero']['x'] - start['x']:.1f})")
        check(abs(st["hero"]["h"] - 48) < 1, f"высота глаз по миру: h={st['hero']['h']}")

        a.hold(["W"]); a.step(320); a.release_all(); a.step(2)
        wall = state(a)["hero"]
        check(600 < wall["y"] < 660,
              f"внутренняя стена карты остановила игрока (y={wall['y']}, стена y≈604)")
        a.hold(["S"]); a.step(320); a.release_all(); a.step(2)
        south = state(a)["hero"]
        check(1140 < south["y"] < 1200, f"южная стена держит (y={south['y']})")
        x0 = south["x"]
        a.hold(["A"]); a.step(40); a.release_all(); a.step(2)
        lateral = state(a)["hero"]["x"] - x0
        check(lateral < -40, f"A идёт боком (Δx={lateral:.1f})")

        # --- Враги: патруль, лист, поворот ----------------------------------
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
              f"режимы только patrol/notice/idle (атак нет): {modes}")

        seen_frames, seen_rows = set(), set()
        for _ in range(12):
            a.step(4)
            for e in state(a)["enemies"]:
                seen_frames.add(e.get("frame"))
                seen_rows.add(e.get("row"))
        check(len(seen_frames) >= 3 and seen_rows <= {0, 1, 2, 3},
              f"ходьба анимирована кадрами 0..3: кадры {sorted(seen_frames)}, строки {sorted(seen_rows)}")

        # Колонка/зеркало соответствуют формуле «угол к камере».
        yaw = state(a)["hero"]["yaw"]
        ok_rot = True
        for e in state(a)["enemies"]:
            rel = ((e["facing"] - yaw + 540) % 360) - 180
            col = max(0, min(4, round((180 - abs(rel)) / 45)))
            if e["col"] != col or e["flip"] != (rel < 0):
                ok_rot = False
                break
        check(ok_rot, f"поворот врагов = колонка по углу к камере (yaw={yaw})")

        # За внутренней стеной враг не видит игрока и скрыт оверлеем.
        a.hold(["W"]); a.step(330); a.release_all(); a.step(3)
        near_wall = state(a)
        cat_nw = next(e for e in near_wall["enemies"] if e["id"] == "cat-nw")
        check(cat_nw["seen"] is False,
              f"за стеной враг не видит игрока (seen={cat_nw['seen']}, "
              f"distance={cat_nw['distance']})")
        if cat_nw["seen"] is False:
            check(near_wall.get("occluded", 0) >= 1,
                  f"оверлей скрыл врага за стеной: occluded={near_wall.get('occluded')}")

        # --- Оружие от первого лица -----------------------------------------
        st = state(a)
        check(st["weapon"]["name"] == "pistol" and st["weapon"]["state"] == "idle"
              and st["weapon"]["frame"] == 0,
              f"стартовый пистолет в покое: {st['weapon']}")
        a.cmd("key", key="2", action="tap"); a.step(3)
        check(state(a)["weapon"]["name"] == "shotgun", "клавиша 2 — дробовик")
        a.cmd("key", key="3", action="tap"); a.step(3)
        check(state(a)["weapon"]["name"] == "ak", "клавиша 3 — АК")
        a.cmd("key", key="1", action="tap"); a.step(3)
        check(state(a)["weapon"]["name"] == "pistol", "клавиша 1 — пистолет")

        a.mouse(button=1, action="click"); a.step(14)
        firing = state(a)["weapon"]
        check(firing["state"] == "fire" and firing["frame"] >= 1,
              f"выстрел идёт по кадрам: state={firing['state']}, frame={firing['frame']}")
        check(firing["shots"] == 1 and firing["sound_ok"] >= 1,
              f"выстрел засчитан и озвучен: shots={firing['shots']}, sound_ok={firing['sound_ok']}")
        a.step(40)
        check(state(a)["weapon"]["state"] == "idle"
              and state(a)["weapon"]["frame"] == 0, "после выстрела — покой, кадр 0")

        a.cmd("key", key="r", action="tap"); a.step(8)
        reloading = state(a)["weapon"]
        check(reloading["state"] == "reload" and reloading["reloads"] == 1
              and reloading["sound_ok"] >= 2,
              f"перезарядка идёт и озвучена: {reloading}")
        a.step(90)
        check(state(a)["weapon"]["state"] == "idle"
              and state(a)["weapon"]["reloads"] == 1, "перезарядка вернула покой")

        # --- Арт врага виден на кадре (смотрим на ближайшего) ----------------
        os.makedirs(SHOTS, exist_ok=True)
        shot = a.screenshot(os.path.join(SHOTS, "re2d_testroom_world.png"))
        green = green_pixels(shot)
        check(green > 400, f"билборды врагов видны на кадре (зелёных пикселей {green})")

        errors = a.eval("JSON.stringify($.debug.errors())")
        check(errors in ("[]", "null"), f"ошибок игрового кода нет: {errors[:200]}")

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
