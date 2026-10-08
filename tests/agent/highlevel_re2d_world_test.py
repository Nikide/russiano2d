#!/usr/bin/env python3
# ===========================================================================
# Тест демо Re2D «мир-коробка» (`--game demos --scene re2d_world`) — фаза 6
# docs/RE2D.md: игрок от первого лица и добрые маскоты.
#
# 1. Игрок идёт относительно взгляда камеры: W — вперёд туда, куда смотрят
#    глаза, A/D — боком; мышь поворачивает камеру, и «вперёд» следует за ней.
# 2. Стены останавливают игрока (физика остаётся обычной 2D).
# 3. Маскоты реагируют на расстояние: idle → notice → smile, поворачиваются к
#    игроку, меняют эмоцию; реплика появляется рядом с ближним.
# 4. Esc возвращает в меню и отдаёт камеру и мышь обратно в 2D.
# 5. Запись и воспроизведение: прогулка с мышью приходит в ту же точку.
#
# Запуск (после сборки):
#   python3 tests/agent/highlevel_re2d_world_test.py
# ===========================================================================

import json
import math
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402

FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def world(a):
    return a.state()["re2dWorld"]


def pos(a):
    p = a.eval("$('#hero').pos()")
    return p["x"], p["y"]


def angle_diff(a, b):
    return abs((a - b + math.pi) % (2 * math.pi) - math.pi)


def walk(a, key, frames):
    a.key(key, "down")
    a.step(frames)
    a.key(key, "up")
    a.step(2)


def main():
    kw = dict(game="demos", scene="re2d_world", seed=5, fixed_dt=1.0 / 60.0, start_timeout=180, timeout=180)
    with Agent(**kw) as a:
        a.step(10)

        # --- Сцена собрана -------------------------------------------------------
        check(a.eval("$.scene.current()") == "re2d_world", "открыта сцена re2d_world")
        info = world(a)["camera"]
        check(info["kind"] == "re2d" and info["mouseLook"] is True, "камера Re2D, взгляд мышью включён")
        check(a.eval("$('[kind=re2d]').length") >= 9, "узлы вида Re2D: комната, игрок и маскоты (%s)" % a.eval("$('[kind=re2d]').length"))
        check(len(world(a)["npcs"]) == 3, "три маскота")
        check(a.eval("$('#maid').kind()") == "re2d", "маскот — узел вида Re2D")

        # --- Ходьба относительно взгляда ----------------------------------------
        a.eval("$('#hero').at(640, 1000); $.camera.yaw(-90)")
        a.step(2)
        x0, y0 = pos(a)
        walk(a, "W", 30)
        x1, y1 = pos(a)
        check(abs(x1 - x0) < 1.5 and 100 < y0 - y1 < 130, "W при взгляде на север: идём на север (dy = %.1f, dx = %.1f)" % (y1 - y0, x1 - x0))

        a.eval("$.camera.yaw(0)")
        x0, y0 = pos(a)
        walk(a, "W", 30)
        x1, y1 = pos(a)
        check(abs(y1 - y0) < 2 and 100 < x1 - x0 < 130, "W при взгляде на восток: идём на восток (dx = %.1f)" % (x1 - x0))

        a.eval("$.camera.yaw(-90)")
        x0, y0 = pos(a)
        walk(a, "D", 30)
        x1, y1 = pos(a)
        check(abs(y1 - y0) < 2 and x1 - x0 > 100, "D при взгляде на север: боком вправо, то есть на восток (dx = %.1f)" % (x1 - x0))

        # Мышь поворачивает камеру, «вперёд» следует за ней.
        a.eval("$('#hero').at(640, 640); $.camera.yaw(-90)")
        a.step(2)
        a.mouse_move(dx=-300, dy=0)      # -300 px × 0.0026 рад ≈ -44.7°: поворот налево
        a.step(1)
        yaw = a.eval("$.camera.info().yaw")
        check(abs(yaw - (-90 - 300 * 0.0026 * 180 / math.pi)) < 0.2, "сдвиг мыши -300 px повернул камеру налево: yaw %.1f°" % yaw)
        x0, y0 = pos(a)
        walk(a, "W", 30)
        x1, y1 = pos(a)
        heading = math.degrees(math.atan2(y1 - y0, x1 - x0))
        check(abs((heading - yaw + 180) % 360 - 180) < 3, "после поворота идём туда, куда смотрим: курс %.1f°, yaw %.1f°" % (heading, yaw))

        # --- Стены останавливают игрока ------------------------------------------
        a.eval("$('#hero').at(640, 300); $.camera.yaw(-90)")
        a.step(2)
        walk(a, "W", 120)
        x, y = pos(a)
        check(10 < y < 40, "северная стена остановила игрока (y = %.1f)" % y)
        a.eval("$('#hero').at(640, 300); $.camera.yaw(180)")
        a.step(2)
        walk(a, "W", 200)
        x, y = pos(a)
        check(10 < x < 40, "западная стена остановила игрока (x = %.1f)" % x)

        # --- Маскоты реагируют на расстояние -------------------------------------
        a.eval("$('#hero').at(1200, 1200); $.camera.yaw(-90)")
        a.step(30)
        far = {n["id"]: n for n in world(a)["npcs"]}
        check(all(n["state"] == "idle" for n in far.values()), "вдали все в покое (%s)" % [n["state"] for n in far.values()])
        check(world(a)["speaking"] is None, "реплики нет")

        maid = a.eval("(() => { const n = $('#maid').get(0); return [n.x, n.y]; })()")
        # В зоне «заметил»: между TALK (230) и NOTICE (420).
        a.eval("$('#hero').at(%r, %r)" % (maid[0], maid[1] + 330))
        a.step(60)
        near = {n["id"]: n for n in world(a)["npcs"]}["maid"]
        check(near["state"] == "notice" and near["mood"] == "surprised", "в 330 единицах: заметила и удивилась (%s, %s)" % (near["state"], near["mood"]))
        check(angle_diff(near["angle"], math.pi / 2) < 0.15, "…и повернулась к игроку (angle %.2f, ждали %.2f)" % (near["angle"], math.pi / 2))

        # Вплотную.
        a.eval("$('#hero').at(%r, %r)" % (maid[0] + 120, maid[1] + 120))
        a.step(60)
        w = world(a)
        close = {n["id"]: n for n in w["npcs"]}["maid"]
        want = math.atan2((maid[1] + 120) - maid[1], (maid[0] + 120) - maid[0])
        check(close["state"] == "smile" and close["mood"] == "happy", "вплотную: улыбается (%s, %s)" % (close["state"], close["mood"]))
        check(angle_diff(close["angle"], want) < 0.1, "смотрит на игрока: angle %.2f, ждали %.2f" % (close["angle"], want))
        smiling = [n for n in w["npcs"] if n["state"] == "smile"]
        nearest = min(smiling, key=lambda n: n["distance"])["id"]
        check(w["speaking"] == nearest, "реплику говорит ближайший из улыбающихся: %s (говорит %s)" % (nearest, w["speaking"]))
        a.eval("$.test.reset(); $.expect('#maid').state('smile'); void 0")
        check(a.eval("$.test.results().failed") == 0, "$.expect('#maid').state('smile') проходит")

        eyes = a.eval("(() => { const i = $.re2dSprite.info('#maid'); return [i.eyes, i.brows]; })()")
        check(eyes[0] == 3, "эмоция happy дошла до модели: глаза = %s (счастливые = 3)" % eyes[0])

        # Отошли — вернулась в покой.
        a.eval("$('#hero').at(1200, 1200)")
        a.step(80)
        back = {n["id"]: n for n in world(a)["npcs"]}["maid"]
        check(back["state"] == "idle" and angle_diff(back["angle"], math.pi / 2) < 0.15, "отошёл: снова в покое и на своём месте (%s, %.2f)" % (back["state"], back["angle"]))
        check(world(a)["speaking"] is None, "реплика скрыта")

        # --- Esc: назад в меню, камера и мышь возвращены ------------------------
        a.key("Escape", "tap")
        a.step(30)
        check(a.eval("$.scene.current()") == "launcher", "Esc вернул в меню")
        ci = a.eval("$.camera.info()")
        check(ci["kind"] == "2d" and ci["mouseLook"] is False, "камера снова 2D, взгляд мышью выключен")
        check(a.eval("$.window.mouseLock()") is False, "захват мыши снят")

    # --- Запись и воспроизведение прогулки --------------------------------------
    def run(extra, record):
        with Agent(**kw, extra_args=extra) as b:
            b.step(5)
            for frame in range(60):
                if record:
                    if frame == 0:
                        b.key("W", "down")
                    if frame == 20:
                        b.mouse_move(dx=140, dy=-20)
                    if frame == 35:
                        b.mouse_move(dx=-60, dy=10)
                    if frame == 50:
                        b.key("W", "up")
                b.step(1)
            p = b.eval("$('#hero').pos()")
            y = b.eval("$.camera.info().yaw")
            return p["x"], p["y"], y

    with tempfile.TemporaryDirectory(prefix="r2d-world-") as tmp:
        path = os.path.join(tmp, "walk.r2replay")
        rec = run(["--record", path], True)
        lines = open(path, encoding="utf-8").read().splitlines()
        check(any('"dx"' in ln for ln in lines[1:]), "в записи есть сдвиг мыши")
        rep = run(["--replay", path], False)
        check(abs(rep[0] - rec[0]) < 0.05 and abs(rep[1] - rec[1]) < 0.05 and abs(rep[2] - rec[2]) < 0.01,
              "воспроизведение пришло в ту же точку и угол: %s против %s" % (tuple(round(v, 3) for v in rep), tuple(round(v, 3) for v in rec)))
        check(rec[1] < 1100, "и прогулка была настоящей: игрок ушёл от старта (y = %.1f)" % rec[1])

    if FAILURES:
        print("\nПровалов: %d" % len(FAILURES))
        for f in FAILURES:
            print(" -", f)
        sys.exit(1)
    print("\nВсе проверки пройдены")


if __name__ == "__main__":
    main()
