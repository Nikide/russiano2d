#!/usr/bin/env python3
# Фикстуры Re2D World (тестовая обвязка): воспроизводят карту демо `demos/re2d_bsp_world`
# в исходном формате `*.re2dmap` и набор испорченных карт для проверки диагностики.
#
#   python3 tests/fixtures/sdk/make_world_fixtures.py
import json
import os

OUT = os.path.join(os.path.dirname(__file__), "world")


def spans(a=("#375647", "#243746"), b=("#564230", "#344858")):
    return [{"bottom": 0, "top": 128, "floorColor": a[0], "ceilingColor": a[1]},
            {"bottom": 160, "top": 288, "floorColor": b[0], "ceilingColor": b[1]}]


def demo():
    cells = [
        {"id": "hall", "rect": [-240, -180, 400, 360], "spans": spans()},
        {"id": "roomN", "rect": [360, -220, 320, 220], "spans": spans()},
        {"id": "roomS", "rect": [360, 0, 320, 220], "spans": spans()},
    ]
    outline = [[-240, -180], [160, -180], [160, -60], [360, -60], [360, -220], [680, -220],
               [680, 220], [360, 220], [360, 60], [160, 60], [160, 180], [-240, 180]]
    walls = []
    for i, p in enumerate(outline):
        walls.append({"id": "outline%d" % i, "from": p, "to": outline[(i + 1) % len(outline)], "bottom": 0, "top": 288,
                      "color": "#587386" if i % 2 else "#78919a"})
    walls.append({"id": "partition", "from": [430, 0], "to": [680, 0], "bottom": 0, "top": 288, "color": "#96785c"})
    walls.append({"id": "railing", "from": [70, -65], "to": [70, 65], "bottom": 0, "top": 60, "color": "#b64830"})
    stairs = [{"id": "stairs", "rect": [160, -60, 200, 120], "axis": "x", "dir": 1, "steps": 8, "base": 0, "rise": 20, "top": 288,
               "floorColor": "#736348", "floorColorAlt": "#64543d", "ceilingColor": "#344858", "riserColor": "#4f4030"}]
    portals = [
        {"id": "hall-stairs", "cellA": "hall", "cellB": "roomN", "from": [0, 0], "to": [0, 0], "openings": []},
    ]
    return {"version": 1, "name": "demo-hall", "cells": cells, "walls": walls, "stairs": stairs, "portals": []}


def write(name, data):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    d = demo()
    write("demo.re2dmap", d)

    # Минимальный room-over-room: один XY, два этажа.
    write("stack.re2dmap", {"version": 1, "name": "stack", "cells": [
        {"id": "ground", "rect": [0, 0, 200, 200], "spans": [
            {"bottom": 0, "top": 128, "floorColor": "#375647", "ceilingColor": "#243746"},
            {"bottom": 160, "top": 288, "floorColor": "#564230", "ceilingColor": "#344858"}]}],
        "walls": [
            {"id": "w0", "from": [0, 0], "to": [200, 0], "bottom": 0, "top": 288, "color": "#78919a"},
            {"id": "w1", "from": [200, 0], "to": [200, 200], "bottom": 0, "top": 288, "color": "#78919a"},
            {"id": "w2", "from": [200, 200], "to": [0, 200], "bottom": 0, "top": 288, "color": "#78919a"},
            {"id": "w3", "from": [0, 200], "to": [0, 0], "bottom": 0, "top": 288, "color": "#78919a"}]})

    # Портал между двумя комнатами с общей стеной.
    two = {"version": 1, "name": "two", "cells": [
        {"id": "left", "rect": [0, 0, 100, 100], "spans": [{"bottom": 0, "top": 100}]},
        {"id": "right", "rect": [100, 0, 100, 100], "spans": [{"bottom": 0, "top": 100}]}],
        "walls": [
            {"id": "n", "from": [0, 0], "to": [200, 0], "bottom": 0, "top": 100},
            {"id": "s", "from": [0, 100], "to": [200, 100], "bottom": 0, "top": 100},
            {"id": "w", "from": [0, 0], "to": [0, 100], "bottom": 0, "top": 100},
            {"id": "e", "from": [200, 0], "to": [200, 100], "bottom": 0, "top": 100},
            {"id": "mid-a", "from": [100, 0], "to": [100, 30], "bottom": 0, "top": 100},
            {"id": "mid-b", "from": [100, 70], "to": [100, 100], "bottom": 0, "top": 100}],
        "portals": [{"id": "door", "cellA": "left", "cellB": "right", "from": [100, 30], "to": [100, 70], "openings": [{"bottom": 0, "top": 80}]}]}
    write("two.re2dmap", two)

    def mut(name, fn):
        import copy
        m = copy.deepcopy(two)
        fn(m)
        write(name, m)

    # Перекрытие интервалов высоты на одном XY.
    def overlap(m):
        m["cells"][0]["spans"].append({"bottom": 50, "top": 150})
    mut("bad_overlap.re2dmap", overlap)
    # Утечка: нет стены на восточной кромке и портал убран.
    def leak(m):
        m["walls"] = [w for w in m["walls"] if w["id"] != "e"]
    mut("bad_leak.re2dmap", leak)
    # Портал не на общей кромке.
    def portal_edge(m):
        m["portals"][0]["from"] = [90, 30]
        m["portals"][0]["to"] = [90, 70]
    mut("bad_portal_edge.re2dmap", portal_edge)
    def portal_cell(m):
        m["portals"][0]["cellB"] = "nowhere"
    mut("bad_portal_cell.re2dmap", portal_cell)
    def portal_open(m):
        m["portals"][0]["openings"] = [{"bottom": 0, "top": 400}]
    mut("bad_portal_opening.re2dmap", portal_open)
    def span_h(m):
        m["cells"][1]["spans"][0]["top"] = -5
    mut("bad_span_height.re2dmap", span_h)
    def dup(m):
        m["cells"][1]["id"] = "left"
    mut("bad_dup_id.re2dmap", dup)
    def wall0(m):
        m["walls"][0]["to"] = m["walls"][0]["from"]
    mut("bad_wall_degenerate.re2dmap", wall0)
    def color(m):
        m["walls"][0]["color"] = "#12"
    mut("bad_color.re2dmap", color)
    def range_(m):
        m["cells"][0]["rect"][0] = 5e6
    mut("bad_range.re2dmap", range_)
    # Уклон: аппроксимация ступенями.
    sl = json.loads(json.dumps(two))
    sl["slopes"] = [{"id": "ramp", "rect": [200, 0, 100, 100], "axis": "x", "dir": 1, "segments": 5, "from": 0, "to": 50, "top": 120}]
    write("slope.re2dmap", sl)
    print("ok")
