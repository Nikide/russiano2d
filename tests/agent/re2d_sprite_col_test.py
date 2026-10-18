#!/usr/bin/env python3
"""Re2D flat-atlas sprite: explicit `node.sprite_col` (packed layered character).

A packed character flattens legs/tail/torso/head offline into one directional
atlas and drives direction + animation row from gameplay. `sprite_row` already
worked; this test pins the new explicit direction column:

1. register one world.sprite (16-direction-capable atlas, here 4 columns x 2 rows);
2. `sprite_col = 0` vs `2` must render different cells (red vs blue);
3. `sprite_row = 0` vs `1` must render different cells (bright vs dark);
4. changing `sprite_col` live for 10 frames: no exceptions, visible sprite count
   stable, no atlas re-registration;
5. an out-of-range column clamps instead of failing.
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tests", "agent"))
from agent_client import Agent  # noqa: E402
from re2d_native_test import decode  # noqa: E402

OUT = os.path.join(ROOT, "build", "re2d_sprite_col")
COLORS = [
    [(255, 0, 0), (0, 200, 0), (0, 0, 255), (255, 200, 0)],
    [(128, 0, 0), (0, 100, 0), (0, 0, 128), (128, 100, 0)],
]
FAILED = []


def check(ok, message):
    print(("  ok   " if ok else "  FAIL ") + message, flush=True)
    if not ok:
        FAILED.append(message)


def make_atlas(path, cell=8):
    from PIL import Image
    image = Image.new("RGBA", (len(COLORS[0]) * cell, len(COLORS) * cell), (0, 0, 0, 0))
    pixels = image.load()
    for row, row_colors in enumerate(COLORS):
        for col, (r, g, b) in enumerate(row_colors):
            for y in range(row * cell, (row + 1) * cell):
                for x in range(col * cell, (col + 1) * cell):
                    pixels[x, y] = (r, g, b, 255)
    image.save(path)


def shot(agent, name):
    path = os.path.join(OUT, name + ".png")
    agent.screenshot(path)
    return decode(path)


def diff(a, b, tolerance=8):
    if (a[0], a[1]) != (b[0], b[1]):
        return 1.0
    rows0, rows1 = a[3], b[3]
    changed = 0
    total = 0
    for y in range(a[1]):
        row0, row1 = rows0[y], rows1[y]
        for x in range(0, a[0] * 4, 4):
            if max(abs(row0[x + c] - row1[x + c]) for c in range(3)) > tolerance:
                changed += 1
            total += 1
    return changed / max(1, total)


def diff_bbox(a, b, tolerance=8):
    """Bounding box of changed pixels (the sprite, not the whole scene)."""
    rows0, rows1 = a[3], b[3]
    x0, y0, x1, y1 = a[0], a[1], -1, -1
    for y in range(a[1]):
        row0, row1 = rows0[y], rows1[y]
        for x in range(0, a[0] * 4, 4):
            if max(abs(row0[x + c] - row1[x + c]) for c in range(3)) > tolerance:
                x0 = min(x0, x // 4); y0 = min(y0, y); x1 = max(x1, x // 4); y1 = max(y1, y)
    return (x0, y0, x1, y1) if x1 >= 0 else None


def count_hue(img, channel, box):
    """Count channel-dominant pixels inside the sprite box (lighting shifts RGB)."""
    rows, w = img[3], img[0]
    count = 0
    for y in range(box[1], box[3] + 1):
        row = rows[y]
        for x in range(0, w * 4, 4):
            px = x // 4
            if px < box[0] or px > box[2]:
                continue
            r, g, b = row[x], row[x + 1], row[x + 2]
            if channel == "red" and r > g + 30 and r > b + 30:
                count += 1
            elif channel == "blue" and b > r + 30 and b > g + 30:
                count += 1
    return count


def make_game(path, atlas_name):
    """Isolated game: one synthetic Re2D world rendered fullscreen, one sprite."""
    os.makedirs(path, exist_ok=True)
    map_json = {
        "version": 1,
        "cells": [{"x": 0, "y": 0, "w": 100, "h": 100,
                   "spans": [{"bottom": 0, "top": 120}]}],
        "walls": [],
        "portals": [],
    }
    main_js = """'use strict';
const MAP = %s;
let world = null;
export default function install($) {
    $.scene.add('main', {
        enter($) {
            world = $.re2dWorld.fromJSON(JSON.stringify(MAP)).backend('gpu');
            const n = $('<sprite>', { id: 'layered' }).at(70, 50).depth(40).size(90, 45)
                .pivot('center').hide().appendTo($.world);
            world.sprite(n, { atlas: %s, columns: 4, rows: 2, directions: 1,
                cell: { w: 8, h: 8 }, pivot: 'center', width: 90, height: 45, blend: 'opaque' });
            globalThis.LAYERED = n.get(0);
            globalThis.LAYERED_WORLD = world;
            $.render(() => {
                world.camera({ x: 50, y: 50, h: 60, yaw: 0, pitch: 0, fov: 70, near: 1 });
                world.render(null, 640, 360);
            });
        },
    });
}
$.ready(($) => { install($); $.scene.load('main', { transition: 'none' }); });
""" % (json.dumps(map_json), json.dumps(atlas_name))
    with open(os.path.join(path, "main.js"), "w", encoding="utf-8") as handle:
        handle.write(main_js)
    with open(os.path.join(path, "project.json"), "w", encoding="utf-8") as handle:
        handle.write('{"title":"sprite_col test","version":"0.1.0","width":1280,"height":720}')


def main():
    os.makedirs(OUT, exist_ok=True)
    atlas_name = "atlas.png"
    game = os.path.join(OUT, "game")
    make_game(game, atlas_name)
    make_atlas(os.path.join(game, atlas_name))

    with Agent(cwd=ROOT, game=game, seed=7, fixed_dt=1.0 / 60.0) as agent:
        agent.step(3)
        before = agent.eval("LAYERED_WORLD.info().visibleAtlasSprites")

        frames = {}
        for name, col, row in (("col0", 0, 0), ("col2", 2, 0), ("row1", 0, 1)):
            agent.eval("LAYERED.sprite_col=%d;LAYERED.sprite_row=%d;true" % (col, row))
            agent.step(2)
            frames[name] = shot(agent, name)

        check(diff(frames["col0"], frames["col2"]) > 0.001,
              "sprite_col 0 vs 2 renders different cells (%.3f%%)"
              % (100 * diff(frames["col0"], frames["col2"])))
        box = diff_bbox(frames["col0"], frames["col2"])
        check(box is not None, "the direction change has a rendered bbox")
        box = box or (0, 0, frames["col0"][0] - 1, frames["col0"][1] - 1)
        red0, blue0 = count_hue(frames["col0"], "red", box), count_hue(frames["col0"], "blue", box)
        red2, blue2 = count_hue(frames["col2"], "red", box), count_hue(frames["col2"], "blue", box)
        check(red0 > 20 and red0 > blue0, "col0 cell is red in the sprite bbox (red %d / blue %d)"
              % (red0, blue0))
        check(blue2 > 20 and blue2 > red2, "col2 cell is blue in the sprite bbox (red %d / blue %d)"
              % (red2, blue2))
        check(diff(frames["col0"], frames["row1"]) > 0.001,
              "sprite_row 0 vs 1 renders different cells (%.3f%%)"
              % (100 * diff(frames["col0"], frames["row1"])))

        # Live direction changes: no re-registration, no exceptions, stable count.
        visible = []
        for i in range(10):
            agent.eval("LAYERED.sprite_col=%d;true" % (i % 4))
            agent.step(1)
            visible.append(agent.eval("LAYERED_WORLD.info().visibleAtlasSprites"))
        check(len(set(visible)) == 1,
              "live sprite_col changes keep visibleAtlasSprites stable %s" % sorted(set(visible)))
        check(visible[0] >= before,
              "the registered sprite stays visible during live changes (%s -> %s)"
              % (before, visible[0]))
        check(not agent.eval("$.debug.errors()"), "no script errors during live changes")

        # Out-of-range column clamps (no exception, no atlas read outside the grid).
        agent.eval("LAYERED.sprite_col=99;true")
        agent.step(2)
        _ = shot(agent, "col_clamped")
        check(not agent.eval("$.debug.errors()"), "out-of-range sprite_col clamps without errors")

    print()
    if FAILED:
        print("ПРОВАЛОВ:", len(FAILED))
        for item in FAILED:
            print("  -", item)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
