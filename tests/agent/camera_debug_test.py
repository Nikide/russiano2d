#!/usr/bin/env python3
# ===========================================================================
# §34. Camera debugger: отладочный оверлей камеры.
#
# Проверяется на реальном движке (фикстура tests/fixtures/camera_zones) и на
# пикселях кадра:
#   * по умолчанию оверлей ВЫКЛЮЧЕН: примитивов ноль, кадр не меняется;
#   * включение рисует рамки границ, мёртвой зоны, зоны и рамку вида — и это
#     видно на скриншоте;
#   * нарисованные координаты совпадают с $.camera.limits(),
#     $.camera.deadzone(), $.camera.viewport(), зонами из camera_zones и
#     целью follow: рамки сверяются по записанным вызовам $.debug.draw.*;
#   * выключение возвращает РОВНО прежний кадр (сравнение PNG).
#
# Запуск после сборки:
#   python3 tests/agent/camera_debug_test.py
#   R2D_BINARY=build-2d/russiano2d python3 tests/agent/camera_debug_test.py
# ===========================================================================

import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "camera_zones")
FAILURES = []
TOL = 1.5          # допуск сравнения координат: камера сглаживается субпиксельно

# Перехват $.debug.draw.*: считаем и запоминаем фактические аргументы. Оверлей
# обязан рисоваться этими примитивами, поэтому проверка идёт по кадру, а не по
# «функция есть».
PATCH = """
(() => {
  globalThis.__camdbg = { rect: [], line: [], circle: [], ring: [], text: [], arrow: [] };
  for (const k of Object.keys(globalThis.__camdbg)) {
    const orig = $.debug.draw[k];
    $.debug.draw[k] = (...args) => {
      if (k === 'rect') globalThis.__camdbg.rect.push([args[0].x, args[0].y, args[1].x, args[1].y]);
      else if (k === 'line') globalThis.__camdbg.line.push([args[0].x, args[0].y, args[1].x, args[1].y]);
      else if (k === 'circle' || k === 'ring') globalThis.__camdbg[k].push([args[0].x, args[0].y, args[1]]);
      else if (k === 'text') globalThis.__camdbg.text.push(String(args[0]));
      return orig(...args);
    };
  }
  return true;
})()
"""

RESET = ("globalThis.__camdbg = { rect: [], line: [], circle: [], ring: [], text: [], arrow: [] };"
         " true")


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def calls(a):
    return json.loads(a.eval("JSON.stringify(globalThis.__camdbg)"))


def image(path):
    return Image.open(path).convert("RGB")


def same_pixels(path_a, path_b):
    """Сколько пикселей различается между двумя PNG."""
    ia, ib = image(path_a), image(path_b)
    if ia.size != ib.size:
        return ia.size[0] * ia.size[1]
    pa, pb = ia.load(), ib.load()
    diff = 0
    for y in range(ia.size[1]):
        for x in range(ia.size[0]):
            if pa[x, y] != pb[x, y]:
                diff += 1
    return diff


def has_segment(lines, x1, y1, x2, y2, tol=TOL):
    for line in lines:
        if (abs(line[0] - x1) <= tol and abs(line[1] - y1) <= tol
                and abs(line[2] - x2) <= tol and abs(line[3] - y2) <= tol):
            return True
        if (abs(line[2] - x1) <= tol and abs(line[3] - y1) <= tol
                and abs(line[0] - x2) <= tol and abs(line[1] - y2) <= tol):
            return True
    return False


def has_box(lines, x0, y0, x1, y1, tol=TOL):
    """Рамка — четыре отрезка по углам (заливать кадр оверлей не должен)."""
    return (has_segment(lines, x0, y0, x1, y0, tol)
            and has_segment(lines, x1, y0, x1, y1, tol)
            and has_segment(lines, x1, y1, x0, y1, tol)
            and has_segment(lines, x0, y1, x0, y0, tol))


def near(a, b, tol=TOL):
    return abs(a - b) <= tol


def main():
    shots = os.path.join(ROOT, "build")

    with Agent(game=GAME, seed=3, fixed_dt=1.0 / 60.0, start_timeout=120) as a:
        a.step(4)
        a.eval(PATCH)

        # --- по умолчанию выключен: ни примитивов, ни изменений кадра --------
        facts = a.eval("$.camera.debug()")
        check(facts["on"] is False, "оверлей камеры по умолчанию выключен")
        check(facts["drawn"] is None, "у выключенного оверлея нет фактов кадра")
        a.eval(RESET)
        a.step(3)
        before = calls(a)
        check(sum(len(before[k]) for k in before) == 0,
              "без оверлея $.debug.draw.* не зовётся: %s" % {k: len(v) for k, v in before.items()})

        # --- камера в зоне с мёртвой зоной и выносом --------------------------
        a.eval("$.camera.enter('well')")
        a.eval("$.camera.follow('#hero', { deadzone: [64, 48] })")
        a.eval("$.camera.lookahead(40)")
        a.step(150)                       # камера и герой успокаиваются

        base_a = a.screenshot(os.path.join(shots, "camera_debug_off_a.png"))
        a.step(3)
        base_b = a.screenshot(os.path.join(shots, "camera_debug_off_b.png"))
        stable = same_pixels(base_a, base_b)
        check(stable == 0, "кадр фикстуры без оверлея стабилен (%d пикселей различия)" % stable)

        # --- включение --------------------------------------------------------
        a.eval(RESET)
        facts = a.eval("$.camera.debug({ on: true, viewport: true })")
        a.step(3)

        check(facts["on"] is True, "оверлей включается объектом опций")
        check(facts["kind"] == "2d", "вид камеры — 2d (оверлей §34 только для него)")
        check(facts["target"] == "#hero", "цель follow названа селектором: %s" % facts["target"])

        limits = a.eval("$.camera.limits()")
        deadzone = a.eval("$.camera.deadzone()")
        zoom = a.eval("$.camera.zoom()")
        cam_pos = a.eval("$.camera.pos()")
        viewport = a.eval("$.camera.viewport()")
        zone = a.eval("$.camera.zone('well')")

        check(facts["limits"] == limits,
              "факты несут настоящие limits: %s" % facts["limits"])
        check(facts["deadzone"] == deadzone,
              "факты несут настоящую мёртвую зону: %s" % facts["deadzone"])
        check(near(facts["zoom"], zoom, 1e-9), "факты несут текущий зум: %s" % facts["zoom"])
        check(near(facts["actual"]["x"], cam_pos["x"], 1e-6)
              and near(facts["actual"]["y"], cam_pos["y"], 1e-6),
              "факты несут фактическое положение камеры")
        check(facts["viewport"] == viewport, "факты несут видимый прямоугольник мира")
        check(zone["bounds"] == limits,
              "границы зоны well из camera_zones совпали с limits: %s" % zone["bounds"])
        check(facts["active"] and facts["active"]["name"] == "well",
              "активная зона названа: %s" % (facts["active"] or {}).get("name"))
        areas = {row["name"]: row for row in facts["areas"]}
        check("well" in areas and areas["well"]["bounds"] == limits,
              "зона well перечислена с реальными границами")

        # Данные оверлея == данные камеры: позиция цели и куда её тянет.
        hero = a.eval("(() => { const n = $('#hero').get(0); return { x: n.x, y: n.y }; })()")
        check(facts["targetPos"] and near(facts["targetPos"]["x"], hero["x"], 1e-6)
              and near(facts["targetPos"]["y"], hero["y"], 1e-6),
              "позиция цели в фактах — позиция узла #hero")

        # --- что реально нарисовано -------------------------------------------
        recorded = calls(a)
        lines = recorded["line"]
        check(len(lines) > 0, "оверлей рисует отрезки: %d" % len(lines))
        check(has_box(lines, limits["x"], limits["y"], limits["x"] + limits["w"],
                      limits["y"] + limits["h"]),
              "рамка limits нарисована по настоящим координатам")
        dhw, dhh = deadzone["w"] / 2.0, deadzone["h"] / 2.0
        check(has_box(lines, cam_pos["x"] - dhw, cam_pos["y"] - dhh,
                      cam_pos["x"] + dhw, cam_pos["y"] + dhh),
              "рамка мёртвой зоны нарисована вокруг камеры")
        check(has_box(lines, viewport["x"], viewport["y"], viewport["x"] + viewport["w"],
                      viewport["y"] + viewport["h"]),
              "рамка вида нарисована по $.camera.viewport()")
        check(has_segment(lines, cam_pos["x"], cam_pos["y"], hero["x"], hero["y"]),
              "линия «камера → цель» нарисована")
        check(len(recorded["text"]) >= 2, "подпись оверлея нарисована: %s"
              % recorded["text"][:2])
        check(any("камера" in t for t in recorded["text"]),
              "подпись начинается с фактического положения камеры")

        drawn = a.eval("$.camera.debug()")["drawn"]
        check(drawn and drawn["rects"] >= 4 and drawn["lines"] > 0 and drawn["texts"] > 0,
              "факты кадра описывают нарисованное: %s" % drawn)

        # --- кадр действительно изменился --------------------------------------
        on_shot = a.screenshot(os.path.join(shots, "camera_debug_on.png"))
        diff_on = same_pixels(base_a, on_shot)
        check(diff_on > 0, "включённый оверлей видно на кадре (%d пикселей)" % diff_on)

        # --- выключение возвращает ровно прежний кадр --------------------------
        a.eval(RESET)
        a.eval("$.camera.debug(false)")
        a.step(3)
        off_shot = a.screenshot(os.path.join(shots, "camera_debug_off_again.png"))
        diff_off = same_pixels(base_a, off_shot)
        check(diff_off == 0, "выключение убрало оверлей: кадр совпал с исходным (%d)"
              % diff_off)
        after = calls(a)
        check(sum(len(after[k]) for k in after) == 0,
              "после выключения примитивы не выпускаются")
        check(a.eval("$.camera.debug().on") is False, "факты подтверждают выключение")
        check(a.eval("$.camera.debug().drawn") is None, "фактов кадра у выключенного нет")

        # --- частичное включение: только границы -------------------------------
        a.eval(RESET)
        a.eval("$.camera.debug({ on: true, limits: true, deadzone: false, target: false, "
               "zones: false, lookahead: false, text: false, viewport: false })")
        a.step(1)     # ровно один кадр: счётчики не копят примитивы соседних кадров
        partial = calls(a)
        check(not any(len(partial[k]) for k in ("rect", "circle", "ring", "text")),
              "при выключенных флагах заливок и подписей нет")
        check(len(partial["line"]) == 4, "только рамка границ: 4 отрезка, а не %d"
              % len(partial["line"]))
        check(has_box(partial["line"], limits["x"], limits["y"], limits["x"] + limits["w"],
                      limits["y"] + limits["h"]),
              "рамка границ на месте и в частичном режиме")

        # --- неизвестный режим не выдумывает данные ----------------------------
        a.eval("$.camera.debug({ viewport: 'нет-такого-флага' })")
        check(a.eval("$.camera.debug().flags.viewport") is True,
              "неизвестный ключ не меняет состояние оверлея")
        a.eval("$.camera.debug(false)")

    print()
    if FAILURES:
        print("ПРОВАЛЕНО %d проверок:" % len(FAILURES))
        for message in FAILURES:
            print("  - " + message)
        return 1
    print("Все проверки §34 (camera debugger) пройдены.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
