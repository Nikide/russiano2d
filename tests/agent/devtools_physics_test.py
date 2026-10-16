#!/usr/bin/env python3
# ===========================================================================
# DevTools §25: вкладка PHYS — таблица тел и оверлей форм поверх кадра.
#
# Проверяется на живом движке:
#   * таблица тел = данные (тип, масса, скорость, sleep, фильтры, формы);
#   * оверлей реально рисует формы (счётчик вызовов $.debug.draw.* и пиксели
#     кадра), режимы «все / только выбранный / выключить» переключаются
#     кнопками панели, а выключенный режим не рисует вообще ничего;
#   * неизмеримое честно: без тел в панели «Тел в мире нет.»
#
# Запуск после сборки:
#   python3 tests/agent/devtools_physics_test.py
# ===========================================================================

import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "within")
FAILURES = []

DYNAMIC_COLOR = (74, 212, 122)   # #4ad47a — динамическое тело
STATIC_COLOR = (111, 143, 168)   # #6f8fa8 — статическое
SELECTED_COLOR = (255, 90, 74)   # #ff5a4a — выбранный узел


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def ui(a, doc, element_id):
    """Текст элемента панели с раскодированием RML-экранирования."""
    raw = a.eval("engine.ui.getText(%s,%r)" % (doc, element_id)) or ""
    return (raw.replace("&quot;", '"').replace("&lt;", "<")
               .replace("&gt;", ">").replace("&amp;", "&"))


def click(a, doc, element_id):
    r = a.eval("engine.ui.rect(%s,%r)" % (doc, element_id))
    a.mouse_move(x=r["x"] + r["w"] / 2, y=r["y"] + r["h"] / 2)
    a.step(3)
    a.mouse(button=1, action="click")
    a.step(3)


def count_pixels(image, box, color, tol=14):
    x, y, w, h = int(box["x"]), int(box["y"]), int(box["w"]), int(box["h"])
    found = 0
    for px in range(max(0, x), min(image.width, x + w)):
        for py in range(max(0, y), min(image.height, y + h)):
            c = image.getpixel((px, py))
            if all(abs(c[i] - color[i]) <= tol for i in range(3)):
                found += 1
    return found


def main():
    with Agent(game=GAME, seed=17, fixed_dt=1.0 / 60.0) as a:
        a.step(4)
        check(a.eval("$.devtools.openRuntime()") is True, "панель F1 открылась документом RmlUi")
        doc = a.eval("$.devtools.runtimePanel().doc")
        click(a, doc, "rt-tab-physics")
        check(a.eval("$.devtools.tabName()") == "physics", "клик открыл вкладку PHYS")
        a.step(6)

        # --- §25: таблица тел = данные -----------------------------------------
        phys = a.eval("$.devtools.physics()")
        check(phys["mode"] == "off", "оверлей по умолчанию выключен")
        check(len(phys["bodies"]) == a.eval("engine.bodyCount()"),
              "в таблице столько тел, сколько engine.bodyCount() (%s)" % len(phys["bodies"]))
        check(ui(a, doc, "rt-phys-table") == phys["text"], "таблица в панели = данные physics()")
        by_sel = {b["selector"]: b for b in phys["bodies"]}
        check("#hero" in by_sel and by_sel["#hero"]["body"] == a.eval("$('#hero').get(0).body"),
              "тело героя найдено по селектору")
        hero = by_sel["#hero"]
        check(hero["type"] == "static" and hero["mass"] is not None,
              "тип и масса тела взяты из движка (static, m=%s)" % hero["mass"])
        check(hero["layer"] == 1 and hero["mask"] == 4294967295,
              "фильтры коллизий показаны как есть (0x1/0xffffffff)")
        check(hero["sleeping"] is True, "состояние сна взято из engine.isSleeping")
        check(hero["shapes"] == 1 and hero["kinds"] == "box", "форма тела названа (box)")

        dynam = a.eval(
            "(() => { $('<rect>', {id: 'pbox', x: 380, y: 260, w: 40, h: 24})"
            ".body('dynamic').appendTo($.world);"
            " $('<circle>', {id: 'pball', x: 440, y: 260, r: 14})"
            ".body('dynamic').appendTo($.world); return engine.bodyCount(); })()")
        a.step(4)
        phys = a.eval("$.devtools.physics()")
        dyn = {b["selector"]: b for b in phys["bodies"]}
        check(dynam == a.eval("engine.bodyCount()") and "#pbox" in dyn and "#pball" in dyn,
              "новые тела появились в таблице (%s тел)" % len(phys["bodies"]))
        check(dyn["#pbox"]["type"] == "dynamic" and dyn["#pball"]["kinds"] == "circle",
              "динамическое тело и форма-круг описаны верно")
        check(ui(a, doc, "rt-phys-table") == phys["text"], "таблица в панели обновилась")

        # --- §25: оверлей рисует формы -----------------------------------------
        # Считаем реальные вызовы $.debug.draw.* — оверлей обязан их делать.
        a.eval("globalThis.__dl = 0; globalThis.__dr = 0;"
               " const __l = $.debug.draw.line, __r = $.debug.draw.ring;"
               " $.debug.draw.line = (...x) => { globalThis.__dl++; return __l(...x); };"
               " $.debug.draw.ring = (...x) => { globalThis.__dr++; return __r(...x); };")
        a.step(4)
        check(a.eval("globalThis.__dl") == 0 and a.eval("globalThis.__dr") == 0,
              "в режиме off оверлей не рисует ничего")
        click(a, doc, "rt-phys-all")
        check(a.eval("$.devtools.physicsOverlay()") == "all", "кнопка «Все» включила режим all")
        a.step(3)
        # Замер за ОДИН кадр: счётчик сбрасываем непосредственно перед шагом.
        a.eval("globalThis.__dl = 0; globalThis.__dr = 0")
        a.step(1)
        all_calls = a.eval("globalThis.__dl + globalThis.__dr")
        check(all_calls > 0, "оверлей all рисует формы (%s вызовов draw.* за кадр)" % all_calls)

        # Пиксельная проверка: контур динамического тела видно на кадре.
        panel = a.eval("engine.ui.rect(%s,'rt')" % doc)
        target = {"x": panel["x"] + panel["w"] + 12, "y": 300}
        cam = a.eval("$.camera.pos()")
        screen0 = a.eval("$.camera.worldToScreen({x: 380, y: 260})")
        a.eval("$.camera.at(%f, %f)" % (cam["x"] - (target["x"] - screen0["x"]),
                                        cam["y"] - (target["y"] - screen0["y"])))
        a.step(4)
        screen = a.eval("$.camera.worldToScreen({x: 380, y: 260})")
        check(abs(screen["x"] - target["x"]) < 1.0 and abs(screen["y"] - target["y"]) < 1.0,
              "тело выведено из-под панели (экран %s)" % screen)
        box = {"x": target["x"] - 30, "y": target["y"] - 24, "w": 60, "h": 48}
        shot_all = a.screenshot(os.path.join(ROOT, "build", "devtools_physics_overlay.png"))
        green = count_pixels(Image.open(shot_all).convert("RGB"), box, DYNAMIC_COLOR)
        check(green > 0, "контур динамического тела виден на кадре (%d пикселей)" % green)

        click(a, doc, "rt-phys-sel")
        check(a.eval("$.devtools.physicsOverlay()") == "selected",
              "кнопка «Только выбранный» включила режим selected")
        a.eval("$.devtools.selectBy('#pbox')")
        a.step(3)
        a.eval("globalThis.__dl = 0; globalThis.__dr = 0")
        a.step(1)
        sel_calls = a.eval("globalThis.__dl + globalThis.__dr")
        check(0 < sel_calls < all_calls,
              "режим selected рисует меньше форм, чем all (%s < %s за кадр)" % (sel_calls, all_calls))
        shot_sel = a.screenshot(os.path.join(ROOT, "build", "devtools_physics_selected.png"))
        sel_red = count_pixels(Image.open(shot_sel).convert("RGB"), box, SELECTED_COLOR)
        check(sel_red > 0, "выбранное тело подсвечено красным в режиме selected (%d пикселей)" % sel_red)

        click(a, doc, "rt-phys-off")
        check(a.eval("$.devtools.physicsOverlay()") == "off", "кнопка «Выключить» сняла оверлей")
        before = a.eval("globalThis.__dl + globalThis.__dr")
        a.step(5)
        check(a.eval("globalThis.__dl + globalThis.__dr") == before,
              "в режиме off вызовов draw.* больше не появляется")
        shot_off = a.screenshot(os.path.join(ROOT, "build", "devtools_physics_off.png"))
        off_green = count_pixels(Image.open(shot_off).convert("RGB"), box, DYNAMIC_COLOR)
        check(off_green == 0, "после выключения контура на кадре нет")

        check(a.eval("$.devtools.physicsOverlay('nope')") is False,
              "неизвестный режим оверлея отклонён")

        # --- «Тел в мире нет» — честный пустой случай ---------------------------
        a.eval("(() => { for (const node of $.find('*')) {"
               " if (!node.removed && node.body >= 0) $(node).remove(); } return true; })()")
        a.step(4)
        empty = a.eval("$.devtools.physics()")
        check(len(empty["bodies"]) == 0 and "Тел в мире нет." in empty["text"],
              "без тел панель честно говорит «Тел в мире нет.»")
        check(a.eval("engine.bodyCount()") == 0, "движок подтверждает: тел нет")

        a.eval("$.camera.at(0, 0); $.devtools.physicsOverlay('off')")
        a.step(3)
        check(a.eval("$.devtools.closeRuntime()") is True, "панель закрылась")
        check(a.eval("engine.bodyCount()") == 0, "состояние мира не изменилось после закрытия")

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
