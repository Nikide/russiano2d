#!/usr/bin/env python3
# ===========================================================================
# Re2D boomer lab (P0-A): нативные flat directional atlas world sprites.
#
# Проверяется живым прогоном:
#   * сцена грузит скомпилированный мир и регистрирует 4 узла как atlas sprites;
#   * спрайты реально видны на кадре (а не ui.image-оверлей);
#   * направление (колонка атласа) выбирает нативный C: поворот актёра меняет
#     картинку при неподвижной камере;
#   * за внутренней стеной спрайт скрывается попиксельно нативным depth-тестом:
#     перенос пробы за стену меняет кадр, хотя мир/камера не менялись;
#   * нет ошибок игрового кода и JS-проекционного цикла.
#
# Запуск: python3 tests/agent/re2d_boomer_lab_test.py
# ===========================================================================

import os
import sys

from PIL import Image, ImageChops

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent   # noqa: E402
from re2d_skip import skip_without_re2d   # noqa: E402

GAME = "demos"
SCENE = "re2d_boomer_lab"
SHOTS = os.path.join("build", "shots")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def state(a):
    return a.state().get("re2dBoomerLab") or {}


def green_pixels(path):
    img = Image.open(path).convert("RGB")
    n = 0
    for y in range(0, img.size[1], 2):
        for x in range(0, img.size[0], 2):
            r, g, b = img.getpixel((x, y))
            if g > r + 18 and g > b + 18 and g > 60:
                n += 1
    return n


def changed_pixels(a_path, b_path, threshold=20):
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    diff = ImageChops.difference(a, b)
    return sum(1 for px in diff.getdata() if px[0] + px[1] + px[2] > threshold), diff.getbbox()


def main():
    with Agent(game=GAME, scene=SCENE, seed=5) as a:
        if skip_without_re2d(a):
            return 0
        a.step(20)

        check(a.eval("$.scene.current()") == SCENE,
              f"сцена загружена: {a.eval('$.scene.current()')}")
        st = state(a)
        info = st.get("info") or {}
        check(info.get("atlasSprites") == 4,
              f"4 узла зарегистрированы как atlas sprites: {info}")
        check(info.get("visibleAtlasSprites", 0) >= 3,
              f"нативный проход видит спрайты: {info.get('visibleAtlasSprites')}")
        check(st.get("nativeWorldSprite") is True,
              "сцена подтверждает нативный путь world sprite")
        check(st.get("uiEnemyOverlays") == 0, "ui.image-оверлея врагов нет")
        check(a.eval("$.findNodes('#enemy-view-probe').length") == 0,
              "устаревших enemy-view узлов нет")

        os.makedirs(SHOTS, exist_ok=True)
        shot = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab.png"))
        check(green_pixels(shot) > 300,
              f"актёры видны на кадре (зелёных пикселей {green_pixels(shot)})")

        # Направление выбирает C: тот же актёр, другая сторона — другая колонка.
        a.eval("boomerLab.setProbeAngle(Math.PI/2)"); a.step(3)
        turned = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_turned.png"))
        n, box = changed_pixels(shot, turned)
        check(n > 4000 and box is not None,
              f"поворот актёра меняет нативный кадр (изменено {n} px, bbox={box})")
        a.eval("boomerLab.setProbeAngle(-Math.PI/2)"); a.step(3)

        # Нативный depth test: тот же спрайт за внутренней стеной не рисуется.
        a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_clear.png"))
        a.eval("boomerLab.moveProbe(800,500)"); a.step(4)
        occluded = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_occluded.png"))
        n2, box2 = changed_pixels(
            os.path.join(SHOTS, "re2d_boomer_lab_clear.png"), occluded)
        check(n2 > 4000 and box2 is not None,
              f"за стеной спрайт скрыт попиксельно (изменено {n2} px, bbox={box2})")

        # Вернули на место — снова видно.
        a.eval("boomerLab.moveProbe(800,900)"); a.step(4)
        back = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_back.png"))
        n3, _ = changed_pixels(os.path.join(SHOTS, "re2d_boomer_lab_clear.png"), back)
        check(n3 < 2000, f"после возврата кадр совпадает (изменено {n3} px)")

        # CPU reference backend даёт тот же нативный атлас (parity пути, не пиксель).
        a.eval("boomerLab.backend('cpu')"); a.step(6)
        cpu_shot = a.screenshot(os.path.join(SHOTS, "re2d_boomer_lab_cpu.png"))
        check(green_pixels(cpu_shot) > 300,
              f"CPU-backend тоже рисует атласные спрайты (зелёных пикселей {green_pixels(cpu_shot)})")
        check((state(a).get("backend") or "").startswith("cpu"),
              f"бэкенд переключился: {state(a).get('backend')}")
        a.eval("boomerLab.backend('gpu')"); a.step(4)

        # --- Unified world+actor trace (P0-B) через $ high-level API ---------
        check(a.eval("typeof $.re2dWorld.load") == "function"
              and a.eval("typeof $.re2dWorld.fromJSON") == "function"
              and a.eval("$.re2dEnabled") is True,
              "$.re2dWorld и $.re2dEnabled — публичный вход")
        enemy_hit = a.eval("JSON.stringify(boomerLab.trace({x:800,y:900,h:75},['enemy']))")
        check(enemy_hit and "lab-probe" in enemy_hit and '"type":2' in enemy_hit,
              f"world.trace находит actor proxy: {enemy_hit}")
        check(a.eval("boomerLab.trace({x:800,y:900,h:75},['world'])") is None,
              "маска world не задевает actor proxy")
        both = a.eval("JSON.stringify(boomerLab.traceAll({x:800,y:0,h:75}))")
        check(both is not None and both.index('"type":2') < both.index('"type":1'),
              f"traceAll сортирует actor перед стеной: {both}")
        wall_only = a.eval("JSON.stringify(boomerLab.trace({x:800,y:0,h:75},['world']))")
        check(wall_only and '"type":1' in wall_only and '"surface":6' in wall_only,
              f"world.trace возвращает surface/span стены: {wall_only}")
        check(a.eval("boomerLab.trace({x:800,y:900,h:75},['enemy'],boomerLab.probeNode())") is None,
              "ignore узла исключает его прокси")
        a.eval("boomerLab.moveProbe(800,500)"); a.step(3)
        behind = a.eval("JSON.stringify(boomerLab.trace({x:800,y:500,h:75},['world','enemy']))")
        check(behind and '"type":1' in behind,
              f"за стеной trace возвращает стену, а не дальний proxy: {behind}")
        a.eval("boomerLab.moveProbe(800,900)"); a.step(3)

        check("[]" == a.eval("JSON.stringify($.debug.errors())"),
              f"ошибок игрового кода нет: {a.eval('JSON.stringify($.debug.errors())')}")

    print()
    if FAILURES:
        print("ПРОВАЛОВ:", len(FAILURES))
        for f in FAILURES:
            print("  -", f)
        return 1
    print("Все проверки пройдены")
    return 0


if __name__ == "__main__":
    sys.exit(main())
