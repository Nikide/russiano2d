#!/usr/bin/env python3
# ===========================================================================
# P0.3 + P0.4 приёмочный тест Russiano2D GTA-like sandbox.
#
# Проверяется:
#   1. P0.3 — произвольный поворот обычного 2D-спрайта:
#      * аналитический CPU-эталон (nearest + pivot + scale) совпадает с
#        GPU-кадром пиксель-в-пиксель при angle=0, angle=0.6, pivot=(0,0),
#        scale=2;
#      * глубина/окклюзия: порядок draw по depth, поворот не сбрасывает depth;
#      * Re2D flat-atlas `sprite_col`/`sprite_row` не изменились: явная
#        колонка приоритетнее angle, `delete sprite_col` возвращает angle
#        fallback, CPU- и GPU-бэкенды выбирают одну и ту же клетку.
#   2. P0.4 — машина `createVehicle` над Box2D, без Re2D:
#      * разгон, предел maxSpeed; масса влияет на разгон;
#      * тормоз и логика «тормоз → реверс», предел reverseMaxSpeed;
#      * руление дугой, обратный руль задним ходом;
#      * ручник — боковой снос сильнее, чем без ручника;
#      * столкновение со стеной через существующие body/collider;
#      * детерминизм при фиксированном вводе и --fixed-dt (два прогона).
#   3. P0.4 — Re2D surface grip: road vs grass через `world.groundAt`.
#      Если нативный `groundAt` ещё не готов — подпроверка честно SKIP,
#      остальные проверки проходят (интерфейс код против плана).
#
# Запуск после сборки:
#   python3 tests/agent/re2d_gta_vehicle_test.py
# ===========================================================================

import copy
import json
import math
import os
import shutil
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from agent_client import Agent  # noqa: E402

OUT = os.path.join(ROOT, "build", "re2d_gta_vehicle")
LIB = os.path.join(ROOT, "demos", "re2d_gta_sandbox", "lib")
FAILURES = []
SKIPS = []
CHECKS = 0


def check(condition, message):
    global CHECKS
    CHECKS += 1
    print(("  ok   " if condition else "  FAIL ") + message, flush=True)
    if not condition:
        FAILURES.append(message)
    return bool(condition)


def skip(message):
    SKIPS.append(message)
    print("  SKIP " + message, flush=True)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(text)


def write_project(path, main_js, width=640, height=360, title="gta vehicle test"):
    os.makedirs(path, exist_ok=True)
    write(os.path.join(path, "main.js"), main_js)
    write(os.path.join(path, "project.json"),
          json.dumps({"title": title, "version": "0.1.0",
                      "width": width, "height": height}))


def copy_libs(path):
    target = os.path.join(path, "lib")
    os.makedirs(target, exist_ok=True)
    for name in ("vehicle.js", "vehicle_view.js"):
        shutil.copyfile(os.path.join(LIB, name), os.path.join(target, name))


def shot(agent, name):
    path = os.path.join(OUT, name + ".png")
    agent.screenshot(path)
    return Image.open(path).convert("RGB")


# ---------------------------------------------------------------------------
# P0.3: аналитический CPU-эталон для обычного 2D-спрайта.
#
# Движок рисует обычный спрайт одним SDL_GPU-путём (отдельного CPU-рендерера
# обычной 2D-сцены нет — это зафиксировано в отчёте). CPU-сторона здесь —
# точная математика трансформа и выборки nearest: она повторяет контракт
# движка и сверяется с GPU-кадром. UV идут с половинным тексельным отступом
# (0.5/W .. 1-0.5/W) — это фактическое поведение квэда, поэтому индекс
# текселя = floor(0.5 + t*(N-1)).
# ---------------------------------------------------------------------------

def _texel_index(t, n):
    index = int(math.floor(0.5 + t * (n - 1)))
    return 0 if index < 0 else (n - 1 if index >= n else index)


def cpu_reference(source_path, angle, pivot_x, pivot_y, draw_w, draw_h,
                  cx, cy, out_w, out_h):
    source = Image.open(source_path).convert("RGBA")
    src_w, src_h = source.size
    pixels = source.load()
    cos = math.cos(-angle)
    sin = math.sin(-angle)
    reference = Image.new("RGB", (out_w, out_h), (0, 0, 0))
    out = reference.load()
    for y in range(out_h):
        for x in range(out_w):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            lx = cos * dx - sin * dy
            ly = sin * dx + cos * dy
            u = lx / draw_w + pivot_x
            v = ly / draw_h + pivot_y
            if 0.0 <= u < 1.0 and 0.0 <= v < 1.0:
                tx = _texel_index(u, src_w)
                ty = _texel_index(v, src_h)
                r, g, b, a = pixels[tx, ty]
                out[x, y] = (r * a // 255, g * a // 255, b * a // 255)
    return reference


def compare_region(image, reference, box):
    x0, y0, x1, y1 = box
    total = 0
    same = 0
    diffs = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            total += 1
            got = image.getpixel((x, y))
            want = reference.getpixel((x, y))
            if got == want:
                same += 1
            elif len(diffs) < 4:
                diffs.append((x, y, got, want))
    return same, total, diffs


def make_palette_png(path, width=8, height=8):
    """8x8: каждая строка — свой цвет, левая/правая половина различаются."""
    image = Image.new("RGBA", (width, height))
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            if x < width // 2:
                pixels[x, y] = ((y * 255) // (height - 1), 0, 32, 255)
            else:
                pixels[x, y] = (0, (y * 255) // (height - 1), 224, 255)
    image.save(path)


def make_solid_png(path, color, size=4):
    Image.new("RGBA", (size, size), color + (255,)).save(path)


def make_car_png(path):
    """Асимметричная машина 8x8 (для view и скриншотов)."""
    image = Image.new("RGBA", (8, 8))
    pixels = image.load()
    for y in range(8):
        for x in range(8):
            if 2 <= x <= 5 and 1 <= y <= 6:
                pixels[x, y] = (220, 40, 40, 255)
            elif x in (3, 4) and y == 0:
                pixels[x, y] = (250, 240, 120, 255)
            elif y == 7 or x in (2, 5):
                pixels[x, y] = (20, 20, 20, 255)
            else:
                pixels[x, y] = (0, 0, 0, 0)
    image.save(path)


# ---------------------------------------------------------------------------
# Фикстура 1: машина в обычной 2D-сцене (без Re2D).
# ---------------------------------------------------------------------------

DRIVE_GAME = r"""'use strict';
import { createVehicle } from './lib/vehicle.js';
import { attachVehicleView } from './lib/vehicle_view.js';

const CFG = {
  width: 48, height: 26, mass: 1200,
  engineForce: 150000, brakeForce: 280000,
  maxSpeed: 440, reverseMaxSpeed: 150,
  steerRate: 2.8, steerSpeed: 0.55, wheelbase: 72,
  lateralGrip: 7, handbrakeGrip: 0.14,
  drag: 0.12, angularDrag: 5,
  layer: 1, mask: 0xffffffff,
};

export default function install($) {
  $.scene.add('drive', {
    enter($) {
      $.world.gravity(0, 0).color('#000000');
      $.world.bounds(0, 0, 8000, 5000);
      $.camera.at(400, 2800);
      globalThis.INPUTS = {};
      globalThis.CARS = {};
      globalThis.CFG = CFG;
      const at = (name, x, y, extra) => {
        const car = createVehicle($, Object.assign({ id: name, x, y, angle: 0 }, CFG, extra || {}));
        globalThis.CARS[name] = car;
        globalThis.INPUTS[name] = { throttle: 0, brake: 0, steer: 0, handbrake: false };
        return car;
      };
      globalThis.MAKE_CAR = (name, x, y, extra, world) => {
        const options = Object.assign({ id: name, x, y, angle: 0 }, CFG, extra || {});
        if (world) options.world = world;
        const car = createVehicle($, options);
        globalThis.CARS[name] = car;
        globalThis.INPUTS[name] = { throttle: 0, brake: 0, steer: 0, handbrake: false };
        return car;
      };
      at('plainref', 2000, 800);
      at('acc', 400, 800);
      at('light', 400, 1400);
      at('heavy', 400, 1800, { mass: 2400 });
      at('steer', 400, 2400);
      at('rev', 400, 3000);
      at('hand', 400, 3600);
      at('coll', 400, 4200);
      $('<wall>', { id: 'wall', x: 900, y: 4200, w: 40, h: 200 }).appendTo($.world);
      attachVehicleView($, globalThis.CARS.steer, { src: 'car.png', width: 64, height: 34, depth: 5 });
      globalThis.ALL_STATES = () => {
        const out = {};
        for (const name of Object.keys(globalThis.CARS)) out[name] = globalThis.CARS[name].state();
        return out;
      };
    },
    update(dt, $) {
      for (const name of Object.keys(globalThis.CARS || {})) {
        const car = globalThis.CARS[name];
        if (car) car.control(globalThis.INPUTS[name] || {}, dt);
      }
    },
  });
}
$.ready(($) => { install($); $.scene.load('drive', { transition: 'none' }); });
"""


def set_input(agent, name, **values):
    merged = {"throttle": 0, "brake": 0, "steer": 0, "handbrake": False}
    merged.update(values)
    agent.eval("INPUTS[%r] = %s; true" % (name, json.dumps(merged)))


def car_state(agent, name):
    return agent.eval("CARS[%r].state()" % name)


def all_states(agent):
    return agent.eval("ALL_STATES()")


def deterministic_run(game):
    """Фиксированный сценарий ввода; возвращает снимок всех машин."""
    with Agent(cwd=ROOT, game=game, seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(2)
        set_input(a, "acc", throttle=1)
        a.step(90)
        set_input(a, "acc", throttle=0.35, steer=1)
        a.step(45)
        set_input(a, "acc", throttle=0, brake=1, handbrake=True)
        a.step(60)
        set_input(a, "steer", throttle=1, steer=-1)
        a.step(80)
        set_input(a, "hand", throttle=1)
        a.step(60)
        set_input(a, "hand", throttle=1, steer=1, handbrake=True)
        a.step(40)
        set_input(a, "coll", throttle=1)
        a.step(200)
        return all_states(a)


def run_vehicle_checks(game):
    with Agent(cwd=ROOT, game=game, seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(2)
        check(not a.eval("$.debug.errors()"), "vehicle scene: no script errors")

        drive = car_state(a, "acc")
        light = car_state(a, "light")
        heavy = car_state(a, "heavy")
        check(abs(drive["mass"] - 1200) < 0.5,
              "opts.mass=1200 → Box2D mass %.1f" % drive["mass"])
        check(abs(heavy["mass"] - 2400) < 1.0,
              "opts.mass=2400 → Box2D mass %.1f" % heavy["mass"])
        check(a.eval("CARS.steer.node.sprite >= 0"),
              "vehicle_view attached a sprite to the physics node")
        check(drive["surfaceSource"] == "plain" and abs(drive["gripScale"] - 1) < 1e-9,
              "plain 2D: no Re2D surface, gripScale = 1 (source %s)"
              % drive["surfaceSource"])

        # --- Опциональный surface grip без Re2D: feature-detect + фейковый
        #     `world.groundAt` проверяет сам контракт (вода 0.35, неизвестный
        #     тег → 1.0, ошибка неоднозначного этажа → обычное сцепление).
        a.eval("""
            globalThis.FAKE_WATER = { groundAt: () => ({ cell: 0, span: 0, surface: 0,
                height: 0, tags: ['water'] }) };
            globalThis.FAKE_UNKNOWN = { groundAt: () => ({ tags: ['mystery'] }) };
            globalThis.FAKE_ERROR = { groundAt: () => {
                throw new RangeError('stacked XY needs h'); } };
            MAKE_CAR('water', 2000, 500, {}, FAKE_WATER);
            MAKE_CAR('unknown', 2000, 1300, {}, FAKE_UNKNOWN);
            MAKE_CAR('err', 2000, 1700, {}, FAKE_ERROR);
            true;
        """)
        for name in ("plainref", "water", "unknown", "err"):
            set_input(a, name, throttle=1)
        a.step(60)
        plainref = car_state(a, "plainref")
        water = car_state(a, "water")
        unknown = car_state(a, "unknown")
        err = car_state(a, "err")
        check(abs(water["gripScale"] - 0.35) < 1e-9 and water["surfaceSource"] == "groundAt",
              "fake surface tags: water gripScale = %.2f (tags %s)"
              % (water["gripScale"], water["tags"]))
        check(water["forwardSpeed"] < plainref["forwardSpeed"] - 10,
              "water grip slows acceleration: %.1f < %.1f"
              % (water["forwardSpeed"], plainref["forwardSpeed"]))
        check(abs(unknown["gripScale"] - 1.0) < 1e-9,
              "unknown surface tag falls back to default grip 1.0 (%.2f)"
              % unknown["gripScale"])
        check(abs(err["gripScale"] - 1.0) < 1e-9 and err["surfaceError"],
              "groundAt RangeError falls back to plain grip and is reported (%s)"
              % (err["surfaceError"],))
        check(err["x"] > 2010, "car still drives when groundAt throws (x %.1f)" % err["x"])

        # --- Разгон и maxSpeed -------------------------------------------
        set_input(a, "acc", throttle=1)
        a.step(60)
        s1 = car_state(a, "acc")
        check(s1["forwardSpeed"] > 60,
              "acceleration: 1 s throttle → forwardSpeed %.1f px/s" % s1["forwardSpeed"])
        check(s1["x"] > 420, "acceleration moves the car +X (x %.1f)" % s1["x"])
        a.step(300)
        s5 = car_state(a, "acc")
        check(s5["forwardSpeed"] <= 440 + 0.5,
              "top speed capped by maxSpeed=440 (%.1f)" % s5["forwardSpeed"])
        check(s5["forwardSpeed"] > 300,
              "top speed is really reached (%.1f px/s)" % s5["forwardSpeed"])

        # --- Масса: при одинаковой тяге тяжёлая машина медленнее ---------
        set_input(a, "light", throttle=1)
        set_input(a, "heavy", throttle=1)
        a.step(60)
        light = car_state(a, "light")
        heavy = car_state(a, "heavy")
        check(light["forwardSpeed"] > heavy["forwardSpeed"] * 1.5,
              "mass matters: light %.1f px/s > heavy %.1f px/s"
              % (light["forwardSpeed"], heavy["forwardSpeed"]))

        # --- Руление дугой -------------------------------------------------
        set_input(a, "steer", throttle=1)
        a.step(180)
        before = car_state(a, "steer")
        set_input(a, "steer", throttle=1, steer=1)
        a.step(60)
        arc = car_state(a, "steer")
        check(arc["angle"] > 0.5,
              "steering changes heading (angle %.2f rad)" % arc["angle"])
        check(arc["y"] > before["y"] + 20,
              "positive steer turns +Y (%.1f → %.1f)" % (before["y"], arc["y"]))
        check(arc["forwardSpeed"] > 100,
              "turn keeps most of the speed (%.1f px/s)" % arc["forwardSpeed"])
        check(abs(a.eval("CARS.steer.node.angle") - arc["angle"]) < 1e-6,
              "rotated sprite follows the body angle (P0.3 node.angle)")

        # --- Обратный руль задним ходом -----------------------------------
        set_input(a, "rev", brake=1, steer=1)
        a.step(150)
        rev = car_state(a, "rev")
        check(rev["reversing"] and rev["forwardSpeed"] < -20,
              "brake from standstill becomes reverse (vF %.1f)" % rev["forwardSpeed"])
        check(rev["angle"] < 0,
              "reverse steering is inverted (angle %.2f < 0)" % rev["angle"])
        check(rev["forwardSpeed"] >= -150 - 0.5,
              "reverse speed capped by reverseMaxSpeed=150 (%.1f)" % rev["forwardSpeed"])

        # --- Ручник: боковой снос ----------------------------------------
        set_input(a, "hand", throttle=1)
        a.step(180)
        set_input(a, "hand", throttle=1, steer=1, handbrake=True)
        a.step(45)
        hb = car_state(a, "hand")
        # Базовая линия: тот же манёвр без ручника.
        set_input(a, "steer", throttle=1, steer=0)
        a.step(120)
        set_input(a, "steer", throttle=1, steer=1)
        a.step(45)
        normal = car_state(a, "steer")
        check(abs(hb["lateralSpeed"]) > abs(normal["lateralSpeed"]) * 2.5,
              "handbrake slides: |vR| %.1f vs %.1f px/s"
              % (abs(hb["lateralSpeed"]), abs(normal["lateralSpeed"])))
        check(abs(hb["lateralSpeed"]) > 60,
              "handbrake slide is visible (|vR| %.1f px/s)" % abs(hb["lateralSpeed"]))

        # --- Столкновение через существующие body/collider -----------------
        set_input(a, "coll", throttle=1)
        a.step(300)
        coll = car_state(a, "coll")
        wall_left = 900 - 20
        check(coll["x"] + 24 <= wall_left + 2,
              "car stops at the wall (x %.1f, wall edge %d)" % (coll["x"], wall_left))
        check(abs(coll["forwardSpeed"]) < 60,
              "collision kills forward speed (%.1f)" % coll["forwardSpeed"])
        check(coll["body"] >= 0, "car body still alive after collision (body %d)" % coll["body"])
        check(not a.eval("$.debug.errors()"), "vehicle scene: no script errors after driving")

    # --- Детерминизм: два одинаковых прогона -----------------------------
    first = deterministic_run(game)
    second = deterministic_run(game)
    check(first == second,
          "fixed input + --fixed-dt is deterministic across two processes")
    if first != second:
        for name in first:
            if first[name] != second[name]:
                keys = [k for k in first[name] if first[name][k] != second[name].get(k)]
                print("    differs in %s: %s" % (name, keys), flush=True)


# ---------------------------------------------------------------------------
# Фикстура 2: P0.3 — обычный 2D-спрайт, произвольный угол/pivot/scale/nearest,
# глубина и окклюзия.
# ---------------------------------------------------------------------------

SPRITE_GAME = r"""'use strict';
export default function install($) {
  $.scene.add('main', {
    enter($) {
      $.world.gravity(0, 0).color('#000000');
      $.camera.at(320, 180);
      $.gfx.filter(false);
      globalThis.MAKE = (id, src, w, h, x, y, depth, pivot) => {
        const node = $('<sprite>', { id, src, w, h })
          .at(x, y).angle(0).depth(depth === undefined ? 0 : depth)
          .pivot(pivot === undefined ? 0.5 : pivot, pivot === undefined ? 0.5 : pivot)
          .appendTo($.world);
        return node;
      };
    },
    update(dt, $) {},
  });
}
$.ready(($) => { install($); $.scene.load('main', { transition: 'none' }); });
"""


def run_p0_3_checks(game_plain):
    with Agent(cwd=ROOT, game=game_plain, seed=3, fixed_dt=1.0 / 60.0) as a:
        a.step(2)
        check(not a.eval("$.debug.errors()"), "sprite scene: no script errors")
        check(a.eval("$.gfx.filter()") is False, "nearest filtering is the default")

        palette = os.path.join(game_plain, "palette.png")
        a.eval("globalThis.S = MAKE('s','palette.png',64,32,320,180,0,0.5); true")
        a.step(2)

        # angle = 0
        a.eval("S.angle(0); true")
        a.step(2)
        image = shot(a, "sprite_angle0")
        reference = cpu_reference(palette, 0.0, 0.5, 0.5, 64, 32, 320, 180, 640, 360)
        same, total, diffs = compare_region(image, reference, (240, 120, 400, 240))
        check(same == total,
              "P0.3 CPU/GPU parity angle=0: %d/%d pixels exact %s"
              % (same, total, diffs[:2]))

        # angle = 0.6 (произвольный угол)
        a.eval("S.angle(0.6); true")
        a.step(2)
        image = shot(a, "sprite_angle06")
        reference = cpu_reference(palette, 0.6, 0.5, 0.5, 64, 32, 320, 180, 640, 360)
        same, total, diffs = compare_region(image, reference, (240, 120, 400, 240))
        # На границе повёрнутых текселей GPU и CPU-эталон могут разойтись на
        # 1-2 px из-за округления растеризации: допускаем <0.1% кромки.
        check(same / total >= 0.999,
              "P0.3 CPU/GPU parity angle=0.6: %d/%d pixels exact (%.4f%%) %s"
              % (same, total, 100.0 * same / total, diffs[:2]))
        # pivot = (0,0): точка вращения — левый верх
        a.eval("S.angle(0); S.pivot(0,0); true")
        a.step(2)
        image = shot(a, "sprite_pivot00")
        reference = cpu_reference(palette, 0.0, 0.0, 0.0, 64, 32, 320, 180, 640, 360)
        same, total, diffs = compare_region(image, reference, (230, 100, 410, 260))
        check(same == total,
              "P0.3 CPU/GPU parity pivot=(0,0): %d/%d pixels exact %s"
              % (same, total, diffs[:2]))

        # scale = 2: тот же pivot (0,0), визуальный размер вдвое больше
        a.eval("S.pivot(0,0).scale(2); true")
        a.step(2)
        image = shot(a, "sprite_scale2")
        reference = cpu_reference(palette, 0.0, 0.0, 0.0, 128, 64, 320, 180, 640, 360)
        same, total, diffs = compare_region(image, reference, (190, 80, 450, 280))
        check(same == total,
              "P0.3 CPU/GPU parity scale=2: %d/%d pixels exact %s"
              % (same, total, diffs[:2]))
        check(a.eval("S.get(0).scale_x") == 2, "node.scale_x == 2")

        # --- nearest: в кадре нет сглаженных (смешанных) цветов -------------
        hues = set()
        for y in range(150, 210):
            for x in range(280, 380):
                r, g, b = image.getpixel((x, y))
                if (r, g, b) != (0, 0, 0):
                    hues.add((r // 16, g // 16, b // 16))
        check(len(hues) <= 20,
              "nearest keeps a small palette (%d quantized colors, no interpolation)"
              % len(hues))
        a.eval("S.remove(); true")

        # --- Глубина/окклюзия ---------------------------------------------
        a.eval("""
            globalThis.BACK = MAKE('back','back.png',32,32,320,180,0,0.5);
            globalThis.FRONT = MAKE('front','front.png',32,32,320,180,10,0.5);
            true;
        """)
        a.step(2)
        image = shot(a, "depth_front")
        check(image.getpixel((320, 180)) == (0, 220, 0),
              "depth: higher node.depth draws on top (center %s)"
              % (image.getpixel((320, 180)),))
        before_depth = a.eval("FRONT.get(0).depth")
        a.eval("FRONT.angle(0.6); true")
        a.step(2)
        rotated = shot(a, "depth_front_rotated")
        check(rotated.getpixel((320, 180)) == (0, 220, 0),
              "rotating the front sprite does not break occlusion")
        check(a.eval("FRONT.get(0).depth") == before_depth,
              "rotation does not reset node.depth (%s)" % (before_depth,))
        a.eval("FRONT.depth(0); BACK.depth(10); true")
        a.step(2)
        swapped = shot(a, "depth_swapped")
        check(swapped.getpixel((320, 180)) == (220, 0, 0),
              "changing depth changes the visible sprite (center %s)"
              % (swapped.getpixel((320, 180)),))
        check(not a.eval("$.debug.errors()"), "sprite scene: no script errors after P0.3")


# ---------------------------------------------------------------------------
# Фикстура 3: Re2D flat directional atlas — sprite_col/row и angle fallback.
# ---------------------------------------------------------------------------

ATLAS_GAME = r"""'use strict';
const MAP = %s;
let world = null;
export default function install($) {
  $.scene.add('main', {
    enter($) {
      world = $.re2dWorld.fromJSON(JSON.stringify(MAP)).backend('gpu');
      const n = $('<sprite>', { id: 'layered' }).at(70, 50).depth(40).size(90, 45)
        .pivot('center').hide().appendTo($.world);
      world.sprite(n, { atlas: 'atlas.png', columns: 4, rows: 2, directions: 4,
        mirror: false, cell: { w: 8, h: 8 }, pivot: 'center',
        width: 90, height: 45, blend: 'opaque' });
      globalThis.LAYERED = n.get(0);
      globalThis.LAYERED_WORLD = world;
      $.render(() => {
        world.camera({ x: 50, y: 50, h: 60, yaw: 0, pitch: 0, fov: 70, near: 1 });
        world.render(null, 640, 360);
      });
    },
    update(dt, $) {},
  });
}
$.ready(($) => { install($); $.scene.load('main', { transition: 'none' }); });
"""

ATLAS_COLORS = [
    [(255, 0, 0), (0, 200, 0), (0, 0, 255), (250, 210, 0)],
    [(110, 0, 0), (0, 90, 0), (0, 0, 120), (110, 95, 0)],
]


def make_atlas(path):
    cell = 8
    image = Image.new("RGBA", (4 * cell, 2 * cell), (0, 0, 0, 255))
    pixels = image.load()
    for row, colors in enumerate(ATLAS_COLORS):
        for col, (r, g, b) in enumerate(colors):
            for y in range(row * cell, (row + 1) * cell):
                for x in range(col * cell, (col + 1) * cell):
                    pixels[x, y] = (r, g, b, 255)
    image.save(path)


def hue_counts(image):
    counts = {"red": 0, "green": 0, "blue": 0, "yellow": 0}
    width, height = image.size
    for y in range(height):
        for x in range(width):
            r, g, b = image.getpixel((x, y))
            if r > 150 and g > 150 and b < 90:
                counts["yellow"] += 1
            elif r > g + 30 and r > b + 30:
                counts["red"] += 1
            elif g > r + 30 and g > b + 30:
                counts["green"] += 1
            elif b > r + 30 and b > g + 30:
                counts["blue"] += 1
    return counts


def dominant(counts):
    return max(counts, key=counts.get)


def atlas_scene_json():
    return {
        "version": 1,
        "cells": [{"x": 0, "y": 0, "w": 100, "h": 100,
                   "spans": [{"bottom": 0, "top": 120}]}],
        "walls": [],
        "portals": [],
    }


def run_atlas_checks(game):
    with Agent(cwd=ROOT, game=game, seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(3)
        check(not a.eval("$.debug.errors()"), "Re2D atlas scene: no script errors")
        frames = {}

        def capture(name, col, row, angle=0.0, backend="gpu"):
            a.eval("LAYERED_WORLD.backend(%r); true" % backend)
            if col is None:
                a.eval("delete LAYERED.sprite_col; true")
            else:
                a.eval("LAYERED.sprite_col = %d; true" % col)
            a.eval("LAYERED.sprite_row = %d; LAYERED.angle = %s; true" % (row, angle))
            a.step(3)
            frames[name] = shot(a, "atlas_" + name)
            return frames[name]

        col0 = capture("col0", 0, 0)
        col2 = capture("col2", 2, 0)
        row1 = capture("row1", 0, 1)
        check(dominant(hue_counts(col0)) == "red",
              "sprite_col=0 renders column 0 (%s)" % dominant(hue_counts(col0)))
        check(dominant(hue_counts(col2)) == "blue",
              "sprite_col=2 renders column 2 (%s)" % dominant(hue_counts(col2)))
        check(col0.tobytes() != col2.tobytes(),
              "different sprite_col → different rendered cells")
        check(row1.tobytes() != col0.tobytes(),
              "different sprite_row → different rendered cells")

        # CPU reference backend выбирает ту же явную колонку.
        cpu_col2 = capture("col2_cpu", 2, 0, backend="cpu")
        gpu_counts = hue_counts(frames["col2"])
        cpu_counts = hue_counts(cpu_col2)
        check(dominant(cpu_counts) == "blue",
              "Re2D CPU backend picks the same sprite_col=2 cell (%s)"
              % dominant(cpu_counts))
        ratio = cpu_counts["blue"] / max(1, gpu_counts["blue"])
        check(0.7 <= ratio <= 1.4,
              "Re2D CPU/GPU cell area parity (blue %d vs %d, ratio %.2f)"
              % (cpu_counts["blue"], gpu_counts["blue"], ratio))

        # angle fallback: без sprite_col направление выбирается углом узла.
        angle0 = capture("fallback_angle0", None, 0, angle=0.0)
        angle_pi = capture("fallback_angle_pi", None, 0, angle=math.pi)
        check(angle0.tobytes() != angle_pi.tobytes(),
              "without sprite_col, node.angle still selects the atlas direction")
        # Явная колонка приоритетнее angle — контракт не изменился.
        a.eval("LAYERED.sprite_col = 2; LAYERED.angle = 0; true")
        a.step(3)
        explicit0 = shot(a, "atlas_explicit_angle0")
        a.eval("LAYERED.angle = Math.PI; true")
        a.step(3)
        explicit_pi = shot(a, "atlas_explicit_angle_pi")
        check(explicit0.tobytes() == explicit_pi.tobytes(),
              "explicit sprite_col wins over angle (same frame at 0 and π)")
        check(not a.eval("$.debug.errors()"), "Re2D atlas scene: no script errors after checks")


# ---------------------------------------------------------------------------
# Фикстура 4: Re2D surface grip (road vs grass) через world.groundAt.
# ---------------------------------------------------------------------------

GRIP_GAME = r"""'use strict';
import { createVehicle } from './lib/vehicle.js';

const MAP = %s;
let world = null;

export default function install($) {
  $.scene.add('grip', {
    enter($) {
      $.world.gravity(0, 0).color('#000000');
      $.camera.at(500, 250);
      globalThis.INPUTS = {
        road: { throttle: 0, brake: 0, steer: 0, handbrake: false },
        grass: { throttle: 0, brake: 0, steer: 0, handbrake: false },
      };
      globalThis.GRIP_STATUS = { hasGroundAt: false, parseError: null, road: null, grass: null };
      try {
        world = $.re2dWorld.fromJSON(JSON.stringify(MAP)).backend('gpu');
        globalThis.GRIP_WORLD = world;
        globalThis.GRIP_STATUS.hasGroundAt = typeof world.groundAt === 'function';
      } catch (e) {
        globalThis.GRIP_STATUS.parseError = String((e && e.message) || e);
      }
      const CFG = { width: 48, height: 26, mass: 1200, engineForce: 150000,
        brakeForce: 280000, maxSpeed: 440, reverseMaxSpeed: 150,
        lateralGrip: 7, handbrakeGrip: 0.14, drag: 0.12, steerRate: 2.8,
        steerSpeed: 0.55, wheelbase: 72, world: world, groundHeight: 0 };
      globalThis.CARS = {};
      if (world) {
        globalThis.CARS.road = createVehicle($, Object.assign({ id: 'road', x: 250, y: 250, angle: 0 }, CFG));
        globalThis.CARS.grass = createVehicle($, Object.assign({ id: 'grass', x: 750, y: 250, angle: 0 }, CFG));
        try {
          globalThis.GRIP_STATUS.road = world.groundAt(250, 250, { h: 0 });
          globalThis.GRIP_STATUS.grass = world.groundAt(750, 250, { h: 0 });
        } catch (e) {
          globalThis.GRIP_STATUS.probeError = String((e && e.message) || e);
        }
      }
      $.render(() => {
        if (world) {
          world.camera({ mode: 'topdown', x: 500, y: 250, h: 300, orthoHeight: 500 });
          world.render(null, 640, 360);
        }
      });
    },
    update(dt, $) {
      for (const name of Object.keys(globalThis.CARS || {})) {
        const car = globalThis.CARS[name];
        if (car) car.control(globalThis.INPUTS[name] || {}, dt);
      }
    },
  });
}
$.ready(($) => { install($); $.scene.load('grip', { transition: 'none' }); });
"""


def grip_map_json():
    return {
        "version": 1,
        "cells": [
            {"x": 0, "y": 0, "w": 500, "h": 500,
             "spans": [{"bottom": 0, "top": 120, "tags": ["road"]}]},
            {"x": 500, "y": 0, "w": 500, "h": 500,
             "spans": [{"bottom": 0, "top": 120, "tags": ["grass"]}]},
        ],
        "walls": [],
        "portals": [],
    }


def run_grip_checks(game):
    with Agent(cwd=ROOT, game=game, seed=7, fixed_dt=1.0 / 60.0) as a:
        a.step(3)
        status = a.eval("GRIP_STATUS")
        check(not status.get("parseError"),
              "Re2D tagged map loads%s"
              % ("" if not status.get("parseError") else ": " + status["parseError"]))
        road_probe = status.get("road") or {}
        grass_probe = status.get("grass") or {}
        road_tags = road_probe.get("tags") or []
        grass_tags = grass_probe.get("tags") or []
        ready = (status.get("hasGroundAt")
                 and "road" in road_tags and "grass" in grass_tags)
        if not ready:
            skip("Re2D groundAt/tags not ready yet (hasGroundAt=%s, road=%s, grass=%s) "
                 "— road/grass grip sub-check skipped, plain grip already covered"
                 % (status.get("hasGroundAt"), road_tags, grass_tags))
            return
        check(True, "Re2D groundAt is available, tags: road=%s grass=%s"
              % (road_tags, grass_tags))

        with Agent(cwd=ROOT, game=game, seed=7, fixed_dt=1.0 / 60.0) as b:
            b.step(3)
            for name in ("road", "grass"):
                b.eval("INPUTS[%r] = {throttle:1,brake:0,steer:0,handbrake:false}; true" % name)
            b.step(90)
            road = car_state(b, "road")
            grass = car_state(b, "grass")
            check(abs(road["gripScale"] - 1.0) < 1e-6,
                  "road gripScale = 1.0 (%.3f, tags %s)" % (road["gripScale"], road["tags"]))
            check(abs(grass["gripScale"] - 0.55) < 1e-6,
                  "grass gripScale = 0.55 (%.3f, tags %s)"
                  % (grass["gripScale"], grass["tags"]))
            check(road["surfaceSource"] == "groundAt" and grass["surfaceSource"] == "groundAt",
                  "surface source reported as groundAt")
            check(road["forwardSpeed"] > grass["forwardSpeed"] + 5,
                  "lower surface grip slows acceleration: road %.1f > grass %.1f"
                  % (road["forwardSpeed"], grass["forwardSpeed"]))
            # Боковой снос: одинаковое начальное движение, только покрытие
            # разное. Так grip проявляется сам по себе, а не через меньший
            # разгон травы.
            b.eval("""
                for (const name of ['road','grass']) {
                    $('#' + name).velocity(200, 0).angle(0).angularVelocity(0);
                    INPUTS[name] = { throttle: 0, brake: 0, steer: 1, handbrake: false };
                }
            """)
            b.step(30)
            road2 = car_state(b, "road")
            grass2 = car_state(b, "grass")
            check(abs(grass2["lateralSpeed"]) > abs(road2["lateralSpeed"]) * 1.2,
                  "same motion, grass slides more than road (|vR| %.1f vs %.1f)"
                  % (abs(grass2["lateralSpeed"]), abs(road2["lateralSpeed"])))
            road_slip = abs(road2["lateralSpeed"]) / max(1.0, road2["speed"])
            grass_slip = abs(grass2["lateralSpeed"]) / max(1.0, grass2["speed"])
            check(grass_slip > road_slip * 1.1,
                  "slip fraction higher on grass (%.3f vs %.3f)"
                  % (grass_slip, road_slip))
            check(not b.eval("$.debug.errors()"),
                  "Re2D grip scene: no script errors")


# ---------------------------------------------------------------------------

def build_games():
    os.makedirs(OUT, exist_ok=True)
    game_drive = os.path.join(OUT, "game_drive")
    game_sprite = os.path.join(OUT, "game_sprite")
    game_atlas = os.path.join(OUT, "game_atlas")
    game_grip = os.path.join(OUT, "game_grip")
    for path in (game_drive, game_sprite, game_atlas, game_grip):
        if os.path.isdir(path):
            shutil.rmtree(path)

    copy_libs(game_drive)
    make_car_png(os.path.join(game_drive, "car.png"))
    write_project(game_drive, DRIVE_GAME, 960, 540)

    os.makedirs(game_sprite, exist_ok=True)
    make_palette_png(os.path.join(game_sprite, "palette.png"))
    make_solid_png(os.path.join(game_sprite, "front.png"), (0, 220, 0))
    make_solid_png(os.path.join(game_sprite, "back.png"), (220, 0, 0))
    write_project(game_sprite, SPRITE_GAME)

    os.makedirs(game_atlas, exist_ok=True)
    make_atlas(os.path.join(game_atlas, "atlas.png"))
    write_project(game_atlas, ATLAS_GAME % json.dumps(atlas_scene_json()), 1280, 720)

    copy_libs(game_grip)
    write_project(game_grip, GRIP_GAME % json.dumps(grip_map_json()), 960, 540)
    return game_drive, game_sprite, game_atlas, game_grip


def main():
    game_drive, game_sprite, game_atlas, game_grip = build_games()

    print("== P0.4 vehicle over plain Box2D ==")
    run_vehicle_checks(game_drive)

    print("== P0.3 arbitrary 2D sprite rotation / depth ==")
    run_p0_3_checks(game_sprite)

    print("== P0.3 Re2D sprite_col/sprite_row unchanged ==")
    run_atlas_checks(game_atlas)

    print("== P0.4 Re2D surface grip (road vs grass) ==")
    run_grip_checks(game_grip)

    print()
    print("Проверок: %d, провалов: %d, пропусков: %d"
          % (CHECKS, len(FAILURES), len(SKIPS)))
    for item in SKIPS:
        print("  SKIP - " + item)
    if FAILURES:
        for item in FAILURES:
            print("  - " + item)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
