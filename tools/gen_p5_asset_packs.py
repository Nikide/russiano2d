#!/usr/bin/env python3
"""Generate the P5 visual asset packs (self-made, CC0) with stdlib only.

Outputs:
  assets/sprites/ultra16/  - 16-direction character + turret sheets, Aseprite
                             atlas JSON, Re2D world-sprite manifests.
  assets/sky/              - four independent parallax sky layers + weather cards.
  assets/sky/distant/      - distant city silhouette cards for R-06.

The generator is deterministic: no timestamps, Pillow, network or third-party
dependencies. Run from the repo root or pass --root.

  python3 tools/gen_p5_asset_packs.py
  python3 tools/gen_p5_asset_packs.py --check   # regenerate in memory and verify
"""
from __future__ import annotations

import argparse
import json
import math
import random
import struct
import sys
import zlib
from pathlib import Path

MAX = 255


def clamp(v):
    return 0 if v < 0 else (MAX if v > MAX else int(v))


def blend_pixel(buf, w, h, x, y, r, g, b, a):
    if x < 0 or y < 0 or x >= w or y >= h or a <= 0:
        return
    i = (y * w + x) * 4
    if a >= 255:
        buf[i] = clamp(r); buf[i + 1] = clamp(g); buf[i + 2] = clamp(b); buf[i + 3] = 255
        return
    da = buf[i + 3] / 255.0
    sa = a / 255.0
    outa = sa + da * (1.0 - sa)
    if outa <= 0:
        return
    for c, v in enumerate((r, g, b)):
        dc = buf[i + c] / 255.0
        sc = v / 255.0
        buf[i + c] = clamp(round(255.0 * (sc * sa + dc * da * (1.0 - sa)) / outa))
    buf[i + 3] = clamp(round(outa * 255.0))


class Canvas:
    def __init__(self, w, h, fill=(0, 0, 0, 0)):
        self.w = w
        self.h = h
        self.px = bytearray(w * h * 4)
        if fill[3]:
            for y in range(h):
                for x in range(w):
                    self.set(x, y, *fill)

    def set(self, x, y, r, g, b, a=255):
        blend_pixel(self.px, self.w, self.h, int(x), int(y), r, g, b, a)

    def rect(self, x0, y0, x1, y1, color, a=255):
        x0, x1 = sorted((int(x0), int(x1)))
        y0, y1 = sorted((int(y0), int(y1)))
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(x, y, color[0], color[1], color[2], a if len(color) == 3 else color[3])

    def ellipse(self, cx, cy, rx, ry, color, a=255):
        if rx <= 0 or ry <= 0:
            return
        for y in range(int(cy - ry), int(cy + ry) + 1):
            for x in range(int(cx - rx), int(cx + rx) + 1):
                dx = (x - cx) / rx
                dy = (y - cy) / ry
                if dx * dx + dy * dy <= 1.0:
                    self.set(x, y, color[0], color[1], color[2], a if len(color) == 3 else color[3])

    def line(self, x0, y0, x1, y1, width, color, a=255):
        steps = max(1, int(max(abs(x1 - x0), abs(y1 - y0)) * 2))
        for i in range(steps + 1):
            t = i / steps
            x = x0 + (x1 - x0) * t
            y = y0 + (y1 - y0) * t
            self.ellipse(x, y, width / 2.0, width / 2.0, color, a)

    def gradient(self, top, bottom):
        for y in range(self.h):
            t = y / max(1, self.h - 1)
            r = top[0] + (bottom[0] - top[0]) * t
            g = top[1] + (bottom[1] - top[1]) * t
            b = top[2] + (bottom[2] - top[2]) * t
            for x in range(self.w):
                self.set(x, y, clamp(r), clamp(g), clamp(b), 255)

    def column(self, x, y0, y1, color, a=255):
        for y in range(max(0, int(y0)), min(self.h, int(y1) + 1)):
            self.set(x, y, color[0], color[1], color[2], a if len(color) == 3 else color[3])


def write_png(path: Path, canvas: Canvas):
    raw = bytearray()
    stride = canvas.w * 4
    for y in range(canvas.h):
        raw.append(0)
        raw.extend(canvas.px[y * stride:(y + 1) * stride])

    def chunk(kind, data):
        out = struct.pack(">I", len(data)) + kind + data
        out += struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        return out

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", canvas.w, canvas.h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=True) + "\n", encoding="utf-8")


# --- character sheets -------------------------------------------------------
WARDEN_COLORS = {
    "outline": (18, 20, 28),
    "armor": (52, 72, 108),
    "armor_hi": (96, 132, 176),
    "cloth": (34, 42, 58),
    "skin": (216, 160, 120),
    "gun": (28, 32, 40),
    "gun_hi": (120, 132, 148),
    "accent": (208, 96, 48),
    "boot": (22, 24, 30),
}

TURRET_COLORS = {
    "outline": (16, 18, 24),
    "metal": (70, 82, 98),
    "metal_hi": (140, 152, 168),
    "dark": (30, 36, 46),
    "glow": (255, 140, 60),
}

STEPS = [0, 1, 0, -1]


def draw_warden(canvas, ox, oy, direction, state, frame):
    a = 2.0 * math.pi * direction / 16.0
    dx, dy = math.cos(a), math.sin(a)
    c = WARDEN_COLORS
    cx, cy = ox + 32, oy + 32

    # ground shadow
    canvas.ellipse(cx, oy + 59, 13, 3, (0, 0, 0), 55)
    if state == "walk":
        phase = math.sin(2.0 * math.pi * frame / 6.0)
    elif state == "attack":
        phase = [0.0, -0.8, -1.4, -0.7, 0.0][frame % 5]
    else:
        phase = 0.0
    bob = -2.0 if state == "walk" and abs(phase) > 0.7 else 0.0
    recoil = [0, 1, 3, 1, 0][frame % 5] if state == "attack" else 0

    # legs (walk alternates, idle/attack planted)
    step = int(round(phase * 3.0))
    for side in (-1, 1):
        lift = step * side if state == "walk" else 0
        x0 = cx + side * 4 - 2 + dx * 1
        y0 = cy + 10 + bob
        canvas.rect(x0, y0, x0 + 4, y0 + 11 + lift, c["boot"])
        canvas.rect(x0, y0 + 11 + lift, x0 + 5, y0 + 13 + lift, c["outline"])

    # backpack behind the body (opposite facing)
    canvas.ellipse(cx - dx * 7, cy + 2 + bob, 6, 9, c["cloth"])
    canvas.ellipse(cx - dx * 7, cy + 2 + bob, 4, 6, c["armor"])

    # torso + outline
    canvas.ellipse(cx + dx * 2, cy + 2 + bob, 12, 15, c["outline"])
    canvas.ellipse(cx + dx * 2, cy + 2 + bob, 10, 13, c["armor"])
    canvas.ellipse(cx + dx * 3, cy + 1 + bob, 6, 9, c["armor_hi"], 90)
    canvas.rect(cx - 8, cy + 8 + bob, cx + 8, cy + 10 + bob, c["cloth"])

    # shoulders / arms
    for side in (-1, 1):
        sx = cx + side * 9 + dx * 2
        sy = cy + 2 + bob
        canvas.line(sx, sy, sx + dx * 4, sy + 8 + dy * 2, 4, c["armor"])
        canvas.ellipse(sx + dx * 4, sy + 8 + dy * 2, 2.5, 2.5, c["skin"])

    # head + helmet
    hx, hy = cx + dx * 5, cy - 11 + dy * 2 + bob
    canvas.ellipse(hx, hy, 7, 7, c["outline"])
    canvas.ellipse(hx, hy, 5.5, 5.5, c["skin"])
    canvas.ellipse(hx, hy - 2, 6, 4, c["armor"])
    canvas.rect(hx - 5, hy - 1, hx + 5, hy + 1, c["armor_hi"])
    # facing visor accent: perpendicular marker makes the 16 directions readable
    canvas.line(hx + dx * 3, hy + dy * 3, hx + dx * 5, hy + dy * 5, 2, c["accent"])

    # weapon: points along the projected direction; attack recoils inward
    gx = cx + dx * (5 - recoil)
    gy = cy + 3 + dy * (4 - recoil)
    tx = cx + dx * 20
    ty = cy + 3 + dy * 15
    canvas.line(gx, gy, tx, ty, 4, c["gun"])
    canvas.line(gx, gy, tx, ty, 2, c["gun_hi"])
    canvas.ellipse(tx, ty, 2, 2, c["outline"])

    if state == "attack":
        flash = [0.0, 1.0, 0.55, 0.2, 0.0][frame % 5]
        if flash > 0:
            fx = tx + dx * 3
            fy = ty + dy * 3
            canvas.ellipse(fx, fy, 4 + 4 * flash, 4 + 4 * flash, (255, 210, 120), int(220 * flash))
            canvas.ellipse(fx, fy, 2 + 2 * flash, 2 + 2 * flash, (255, 255, 220), int(255 * flash))

    # idle breathing highlight / walk dust
    if state == "idle":
        canvas.ellipse(cx + dx * 3, cy + 1 + bob, 6, 9, c["armor_hi"], 35)
    if state == "walk" and frame in (1, 4):
        canvas.ellipse(cx - dx * 6, oy + 58, 6, 2, (150, 145, 130), 45)


def draw_turret(canvas, ox, oy, direction, state, frame):
    a = 2.0 * math.pi * direction / 16.0
    dx, dy = math.cos(a), math.sin(a)
    c = TURRET_COLORS
    cx, cy = ox + 32, oy + 35
    canvas.ellipse(cx, oy + 57, 15, 4, (0, 0, 0), 60)
    # base + dome
    canvas.ellipse(cx, cy + 10, 15, 8, c["outline"])
    canvas.ellipse(cx, cy + 10, 13, 6, c["metal"])
    canvas.ellipse(cx, cy + 3, 11, 9, c["outline"])
    canvas.ellipse(cx, cy + 3, 9, 7, c["metal"])
    canvas.ellipse(cx - 2, cy, 5, 4, c["metal_hi"], 90)
    # barrel; attack recoils
    recoil = [0, 2, 4, 1][frame % 4] if state == "attack" else 0
    bx = cx + dx * (8 - recoil)
    by = cy + 1 + dy * (5 - recoil)
    tx = cx + dx * 24
    ty = cy + 1 + dy * 18
    canvas.line(bx, by, tx, ty, 6, c["outline"])
    canvas.line(bx, by, tx, ty, 3, c["metal_hi"])
    canvas.ellipse(tx, ty, 2.5, 2.5, c["dark"])
    # status light
    glow = 1.0 if state == "idle" else [1.0, 0.6, 1.0, 0.4][frame % 4]
    canvas.ellipse(cx + dx * 2, cy - 7, 2.5, 2.5, c["glow"], int(170 + 85 * glow))
    if state == "attack" and frame in (0, 1):
        canvas.ellipse(tx + dx * 4, ty + dy * 3, 5, 5, (255, 210, 120), 180)
        canvas.ellipse(tx + dx * 4, ty + dy * 3, 2, 2, (255, 255, 220), 240)


def build_sheet(path, rows, draw_fn):
    cell = 64
    cols = 16
    canvas = Canvas(cols * cell, rows * cell)
    for row in range(rows):
        state, frame = SHEET_ROWS[row]
        for direction in range(16):
            draw_fn(canvas, direction * cell, row * cell, direction, state, frame)
    write_png(path, canvas)
    return cell, cols, rows


SHEET_ROWS = ([(("idle", f)) for f in range(4)] +
              [("walk", f) for f in range(6)] +
              [("attack", f) for f in range(5)])
TURRET_ROWS = [("idle", f) for f in range(2)] + [("attack", f) for f in range(4)]
DURATION = {"idle": 140, "walk": 100, "attack": 90}
TURRET_DURATION = {"idle": 220, "attack": 120}


def atlas_json(name, image, rows, cols, cell, state_duration):
    frames = {}
    slices = []
    state_rows = {}
    for row, (state, frame) in enumerate(rows):
        state_rows.setdefault(state, []).append(row)
        for direction in range(16):
            frame_name = "%s_%s_f%02d_d%02d" % (name, state, frame, direction)
            x, y = direction * cell, row * cell
            duration = state_duration[state]
            frames[frame_name] = {
                "frame": {"x": x, "y": y, "w": cell, "h": cell},
                "rotated": False,
                "trimmed": False,
                "spriteSourceSize": {"x": 0, "y": 0, "w": cell, "h": cell},
                "sourceSize": {"w": cell, "h": cell},
                "duration": duration,
            }
            slices.append({
                "name": frame_name,
                "keys": [{
                    "frame": len(slices),
                    "bounds": {"x": x, "y": y, "w": cell, "h": cell},
                    "pivot": {"x": 0.5, "y": 1.0},
                }],
            })
    tags = []
    for state in ("idle", "walk", "attack"):
        rows_for_state = state_rows.get(state, [])
        if not rows_for_state:
            continue
        first = rows_for_state[0] * 16
        last = (rows_for_state[-1] + 1) * 16 - 1
        tags.append({"name": state, "from": first, "to": last,
                     "direction": "forward", "color": "#ffffff"})
    return {
        "frames": frames,
        "meta": {
            "app": "russiano2d-p5-generator",
            "version": "1.0",
            "image": image,
            "format": "RGBA8888",
            "size": {"w": cols * cell, "h": rows.__len__() * cell},
            "scale": "1",
            "frameTags": tags,
            "slices": slices,
            "custom": {
                "format": "r2d-ultra16",
                "directions": 16,
                "cell": cell,
                "row_order": "row-major: state/frame rows, direction columns",
            },
        },
    }


def world_manifest(name, image, atlas, rows, cols, cell, state_duration):
    row_list = []
    state_rows = {}
    for row, (state, frame) in enumerate(rows):
        state_rows.setdefault(state, {"rows": [], "durations": []})
        state_rows[state]["rows"].append(row)
        state_rows[state]["durations"].append(state_duration[state])
        row_list.append({"row": row, "state": state, "frame": frame,
                         "duration": state_duration[state]})
    states = {}
    for state, info in state_rows.items():
        states[state] = {"rows": info["rows"], "fps": round(1000.0 / info["durations"][0], 3),
                         "frameMs": info["durations"][0]}
    return {
        "format": "r2d-world-ultra16",
        "version": 1,
        "name": name,
        "image": image,
        "atlas": atlas,
        "directions": 16,
        "columns": cols,
        "rows": len(row_list),
        "cell": {"w": cell, "h": cell},
        "mirror": False,
        "pivot": "feet",
        "pivotX": 0.5,
        "pivotY": 1.0,
        "worldSize": {"w": 64, "h": 64},
        "states": states,
        "spriteRows": row_list,
        "rowOrder": "row = state/frame, column = direction 0..15",
        "notes": "Use sprite_row from spriteRows; direction column is chosen by world.sprite(directions:16).",
    }


def build_ultra16(root: Path):
    out = root / "assets" / "sprites" / "ultra16"
    out.mkdir(parents=True, exist_ok=True)
    warden_cell, warden_cols, warden_rows = build_sheet(
        out / "warden_ultra16.png", len(SHEET_ROWS), draw_warden)
    turret_cell, turret_cols, turret_rows = build_sheet(
        out / "turret_ultra16.png", len(TURRET_ROWS), draw_turret)
    write_json(out / "warden_ultra16.atlas.json",
               atlas_json("warden", "warden_ultra16.png", SHEET_ROWS,
                          warden_cols, warden_cell, DURATION))
    write_json(out / "turret_ultra16.atlas.json",
               atlas_json("turret", "turret_ultra16.png", TURRET_ROWS,
                          turret_cols, turret_cell, TURRET_DURATION))
    write_json(out / "warden_ultra16.world.json",
               world_manifest("warden", "warden_ultra16.png",
                              "warden_ultra16.atlas.json", SHEET_ROWS,
                              warden_cols, warden_cell, DURATION))
    write_json(out / "turret_ultra16.world.json",
               world_manifest("turret", "turret_ultra16.png",
                              "turret_ultra16.atlas.json", TURRET_ROWS,
                              turret_cols, turret_cell, TURRET_DURATION))
    pack = {
        "format": "r2d-ultra16-pack",
        "version": 1,
        "cell": {"w": 64, "h": 64},
        "directions": 16,
        "sets": [
            {"name": "warden", "kind": "character",
             "image": "warden_ultra16.png",
             "atlas": "warden_ultra16.atlas.json",
             "world": "warden_ultra16.world.json",
             "rows": warden_rows, "states": ["idle", "walk", "attack"]},
            {"name": "turret", "kind": "prop",
             "image": "turret_ultra16.png",
             "atlas": "turret_ultra16.atlas.json",
             "world": "turret_ultra16.world.json",
             "rows": turret_rows, "states": ["idle", "attack"]},
        ],
    }
    write_json(out / "pack.json", pack)
    return pack


# --- sky --------------------------------------------------------------------
def _sun_moon(out: Path):
    sun = Canvas(128, 128)
    for radius, alpha in ((60, 10), (46, 25), (34, 120), (26, 255)):
        sun.ellipse(64, 64, radius, radius, (255, 236, 190), alpha)
    write_png(out / "sun.png", sun)
    moon = Canvas(128, 128)
    for radius, alpha in ((44, 16), (32, 120), (27, 255)):
        moon.ellipse(64, 64, radius, radius, (220, 226, 238), alpha)
    for cx, cy, r in ((55, 56, 7), (72, 70, 5), (60, 78, 4), (78, 54, 3)):
        moon.ellipse(cx, cy, r, r, (180, 188, 202), 150)
    write_png(out / "moon.png", moon)


def build_sky(root: Path):
    out = root / "assets" / "sky"
    out.mkdir(parents=True, exist_ok=True)
    w, h = 1024, 512
    rng = random.Random(0x5A17)

    # Slot 0 is an optional opaque backdrop; the runtime's 4 parallax layers
    # below are the canonical layers.json set used by r2d_world_sky.
    sky = Canvas(w, h)
    sky.gradient((16, 24, 56), (228, 132, 84))
    for _ in range(180):
        x, y = rng.randrange(w), rng.randrange(h // 2)
        sky.set(x, y, 255, 250, 230, rng.randrange(40, 140))
    for radius, alpha in ((92, 14), (62, 24), (42, 60), (32, 255)):
        sky.ellipse(760, 360, radius, radius * 0.55, (255, 232, 190), alpha)
    for y in range(h - 120, h):
        t = (y - (h - 120)) / 120.0
        sky.rect(0, y, w, y, (232, 150, 106), int(90 * t))
    write_png(out / "layer_0_sky.png", sky)

    clouds = Canvas(w, h)
    for _ in range(26):
        cx = rng.randrange(w)
        cy = rng.randrange(40, h - 140)
        rx = rng.randrange(50, 170)
        ry = rng.randrange(12, 34)
        tint = rng.choice([(255, 244, 230), (220, 224, 240), (250, 200, 170)])
        for _ in range(5):
            clouds.ellipse(cx + rng.randrange(-rx, rx), cy + rng.randrange(-ry, ry),
                           rx * rng.uniform(0.35, 0.8), ry * rng.uniform(0.4, 0.9),
                           tint, rng.randrange(18, 55))
    write_png(out / "layer_clouds.png", clouds)

    mountains = Canvas(w, h)
    for x in range(w):
        t = 2.0 * math.pi * x / w
        peak = 250 + 55 * math.sin(3 * t + 0.7) + 28 * math.sin(7 * t + 1.3) + 14 * math.sin(13 * t)
        mountains.column(x, peak, h, (66, 82, 118), 255)
        if peak < 230:
            mountains.column(x, peak, peak + 8, (190, 205, 228), 220)
    write_png(out / "layer_far_mountains.png", mountains)

    hills = Canvas(w, h)
    for x in range(w):
        t = 2.0 * math.pi * x / w
        top = 340 + 38 * math.sin(2 * t + 0.2) + 20 * math.sin(5 * t + 2.0)
        hills.column(x, top, h, (40, 58, 72), 255)
        for y in range(int(top), h, 7):
            hills.set(x, y, 72, 92, 96, 80)
    write_png(out / "layer_hills.png", hills)

    spires = Canvas(w, h)
    srng = random.Random(0x7135)
    for _ in range(36):
        cx = srng.randrange(w)
        base = h - srng.randrange(0, 80)
        top = h - srng.randrange(150, 330)
        half = srng.randrange(4, 20)
        for y in range(top, base):
            t = (y - top) / max(1, base - top)
            width = int(half * (0.2 + 0.8 * t))
            for x in range(cx - width, cx + width + 1):
                if 0 <= x < w:
                    spires.set(x, y, 30, 26, 38, 230)
        spires.ellipse(cx, top + 4, 3, 3, (210, 120, 70), 180)
    write_png(out / "layer_spires.png", spires)

    weather = {}
    rain = Canvas(512, 512)
    for _ in range(700):
        x, y = rng.randrange(512), rng.randrange(512)
        length = rng.randrange(10, 26)
        rain.line(x, y, x - 5, y + length, 1.2, (185, 220, 255), rng.randrange(70, 160))
    write_png(out / "weather_rain.png", rain)
    weather["rain"] = {"image": "weather_rain.png", "blend": "additive",
                       "tile": True, "alpha": 0.55, "scroll": [0.15, 1.0],
                       "size": [512, 512], "slot": "weather.rain"}

    snow = Canvas(512, 512)
    for _ in range(900):
        x, y = rng.randrange(512), rng.randrange(512)
        r = rng.choice([1, 1, 2])
        snow.ellipse(x, y, r, r, (245, 250, 255), rng.randrange(120, 230))
    write_png(out / "weather_snow.png", snow)
    weather["snow"] = {"image": "weather_snow.png", "blend": "translucent",
                       "tile": True, "alpha": 0.75, "scroll": [0.2, 0.6],
                       "size": [512, 512], "slot": "weather.snow"}

    fog = Canvas(512, 512)
    for _ in range(90):
        cx, cy = rng.randrange(512), rng.randrange(512)
        fog.ellipse(cx, cy, rng.randrange(40, 130), rng.randrange(16, 50),
                    (210, 220, 230), rng.randrange(5, 18))
    write_png(out / "weather_fog.png", fog)
    weather["fog"] = {"image": "weather_fog.png", "blend": "translucent",
                      "tile": True, "alpha": 0.35, "scroll": [0.05, 0.02],
                      "size": [512, 512], "slot": "weather.fog"}

    ash = Canvas(512, 512)
    for _ in range(500):
        x, y = rng.randrange(512), rng.randrange(512)
        r = rng.choice([1, 1, 2, 2, 3])
        ash.ellipse(x, y, r, r, rng.choice([(120, 110, 100), (190, 120, 80), (255, 160, 80)]),
                    rng.randrange(60, 180))
    write_png(out / "weather_ash.png", ash)
    weather["ash"] = {"image": "weather_ash.png", "blend": "additive",
                      "tile": True, "alpha": 0.65, "scroll": [0.1, 0.25],
                      "size": [512, 512], "slot": "weather.ash"}

    wclouds = Canvas(512, 512)
    for _ in range(60):
        cx, cy = rng.randrange(512), rng.randrange(512)
        wclouds.ellipse(cx, cy, rng.randrange(50, 150), rng.randrange(18, 46),
                        (220, 226, 236), rng.randrange(8, 26))
    write_png(out / "weather_clouds.png", wclouds)
    weather["clouds"] = {"image": "weather_clouds.png", "blend": "translucent",
                         "tile": True, "alpha": 0.45, "scroll": [0.08, 0.05],
                         "size": [512, 512], "slot": "weather.clouds"}

    _sun_moon(out)

    # Canonical runtime manifest (r2d_world_sky_manifest_parse schema).
    layers = [
        {"id": "far_mountains", "texture": "assets/sky/layer_far_mountains.png",
         "tint": "#8fa0b8", "parallax": 0.05, "scroll": 0.001, "alpha": 0.55,
         "offset": 0.02, "scale": 1.2},
        {"id": "hills", "texture": "assets/sky/layer_hills.png",
         "tint": "#5a7a8a", "parallax": 0.12, "scroll": 0.002, "alpha": 0.45,
         "offset": 0.04, "scale": 1.4},
        {"id": "clouds", "texture": "assets/sky/layer_clouds.png",
         "tint": "#d0d8e8", "parallax": 0.22, "scroll": 0.004, "alpha": 0.4,
         "offset": 0.08, "scale": 1.8},
        {"id": "spires", "texture": "assets/sky/layer_spires.png",
         "tint": "#3a3040", "parallax": 0.35, "scroll": 0.006, "alpha": 0.3,
         "offset": -0.02, "scale": 2.2},
    ]
    layers_json = {
        "version": 1,
        "layers": layers,
        "weather": {
            "rain": "assets/sky/weather_rain.png",
            "snow": "assets/sky/weather_snow.png",
            "ash": "assets/sky/weather_ash.png",
            "clouds": "assets/sky/weather_clouds.png",
        },
        "sun": "assets/sky/sun.png",
        "moon": "assets/sky/moon.png",
    }
    write_json(out / "layers.json", layers_json)

    manifest = {
        "format": "r2d-sky-layers",
        "version": 1,
        "size": {"w": w, "h": h},
        "canonicalManifest": "assets/sky/layers.json",
        "base": {"image": "layer_0_sky.png", "blend": "opaque", "note": "optional backdrop; canonical runtime uses the 4 layers below"},
        "slots": {
            "0": "layer_far_mountains.png parallax 0.05 (farthest)",
            "1": "layer_hills.png parallax 0.12",
            "2": "layer_clouds.png parallax 0.22",
            "3": "layer_spires.png parallax 0.35 (nearest)",
            "weather": "weather_*.png tileable cards",
            "distant": "assets/sky/distant/*.png R-06 city cards",
        },
        "layers": [dict(layer) for layer in layers],
        "weather": list(weather.values()),
        "sun": "sun.png",
        "moon": "moon.png",
        "rendererNotes": "layers.json is the canonical r2d_world_sky manifest; bind texture slots 0..3 independently, weather cards separately, then distant cards from assets/sky/distant/manifest.json. No runtime GPU wiring is included in this asset pack.",
    }
    write_json(out / "manifest.json", manifest)
    return manifest


# --- distant city -----------------------------------------------------------
def skyline(canvas, seed, color, window_color, base, scale, landmark=False):
    rng = random.Random(seed)
    w, h = canvas.w, canvas.h
    x = 0
    buildings = []
    while x < w:
        bw = rng.randrange(18, 70) * scale
        bh = rng.randrange(40, 150) * scale
        if landmark and x > w * 0.6 and x < w * 0.7:
            bh = 200 * scale
            bw = 28 * scale
        buildings.append((x, bh, bw))
        x += bw + rng.randrange(2, 12)
    for bx, bh, bw in buildings:
        top = base - bh
        canvas.rect(bx, top, bx + bw, h, color)
        if landmark and bw <= 30 * scale and bh > 180 * scale:
            canvas.rect(bx + bw * 0.35, top - 26 * scale, bx + bw * 0.65, top, color)
            canvas.line(bx + bw * 0.5, top - 26 * scale, bx + bw * 0.5, top - 50 * scale,
                        max(1, int(2 * scale)), color)
        # windows
        cols = max(1, int(bw / (8 * scale)))
        rows = max(1, int(bh / (12 * scale)))
        for c in range(cols):
            for r in range(rows):
                if rng.random() < 0.45:
                    wx = bx + 3 * scale + c * (bw - 4 * scale) / cols
                    wy = top + 5 * scale + r * (bh - 8 * scale) / rows
                    canvas.rect(wx, wy, wx + 2 * scale, wy + 3 * scale, window_color,
                                90 + rng.randrange(0, 120))


def build_distant(root: Path):
    out = root / "assets" / "sky" / "distant"
    out.mkdir(parents=True, exist_ok=True)
    w, h = 1024, 256
    cards = [
        ("city_far", 0x111, (74, 84, 112), (190, 200, 220), 0.35, 0.9, "#8fa0c0"),
        ("city_mid", 0x222, (52, 60, 82), (220, 190, 140), 0.55, 1.0, "#6f7f9f"),
        ("city_near", 0x333, (30, 34, 48), (240, 180, 110), 0.75, 1.2, "#4f5f7f"),
        ("city_landmark", 0x444, (22, 26, 38), (255, 170, 90), 0.95, 1.35, "#3f4f6f"),
    ]
    manifest_cards = []
    for name, seed, color, windows, parallax, scale, tint in cards:
        canvas = Canvas(w, h)
        skyline(canvas, seed, color, windows, h, scale, landmark=(name == "city_landmark"))
        write_png(out / (name + ".png"), canvas)
        manifest_cards.append({
            "slot": name,
            "name": name,
            "image": name + ".png",
            "parallax": parallax,
            "scale": scale,
            "tint": tint,
            "blend": "translucent",
            "tile": True,
            "height": h,
        })
    manifest = {
        "format": "r2d-distant-cards",
        "version": 1,
        "size": {"w": w, "h": h},
        "cards": manifest_cards,
        "rendererNotes": "R-06 distant scene: draw cards behind the R-02 sky layers, farthest (city_far) first. Parallax is a multiplier of camera yaw/translation; tint is a color hint, not a material.",
    }
    write_json(out / "manifest.json", manifest)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate P5 visual asset packs")
    parser.add_argument("--root", default=None, help="repo root (default: parent of tools/)")
    parser.add_argument("--check", action="store_true", help="generate to a temp dir and compare")
    args = parser.parse_args(argv)
    root = Path(args.root).resolve() if args.root else Path(__file__).resolve().parents[1]
    if args.check:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = Path(tmp)
            build_ultra16(tmp_root)
            build_sky(tmp_root)
            build_distant(tmp_root)
            failures = []
            for rel in [
                "assets/sprites/ultra16/pack.json",
                "assets/sky/manifest.json",
                "assets/sky/distant/manifest.json",
            ]:
                src = root / rel
                dst = tmp_root / rel
                if not src.exists() or src.read_bytes() != dst.read_bytes():
                    failures.append(rel)
            if failures:
                print("check failed: " + ", ".join(failures))
                return 1
            print("check ok: generated assets match the repo")
            return 0

    ultra = build_ultra16(root)
    sky = build_sky(root)
    distant = build_distant(root)
    print("ultra16 sets: %d, frames: %d" % (
        len(ultra["sets"]), sum(s["rows"] * 16 for s in ultra["sets"])))
    print("sky layers: %d, weather cards: %d" % (
        len(sky["layers"]), len(sky["weather"])))
    print("distant cards: %d" % len(distant["cards"]))
    print("root: %s" % root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
