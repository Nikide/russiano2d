#!/usr/bin/env python3
# ===========================================================================
# DevTools, §20 ENTITY 2.0 и §21 World Picking (docs/PRODUCTION_POLISH.md).
#
# Проверяется на реальном движке:
#   * поиск по selector/ID/tag/class/state/prefab и фильтры visible/physics/
#     active/room — по списку $.devtools.list(), который показывает панель;
#   * пять секций инспектора (Identity/Transform/Gameplay/Physics/Presentation)
#     — их разметка сравнивается с тем, что реально лежит в документе RmlUi;
#   * выбор кликом по миру: подсветка bounds через $.debug.draw.rect (счётчик
#     навешивается на сам вызов), выбор узла в F2, показ selector/source и три
#     действия копирования — с проверкой того, что ушло в буфер обмена.
#
# Фикстура tests/fixtures/within: hero + три врага + два спрайта; камера
# ставится так, чтобы цель клика была ВНЕ панели (клик по панели не выбирает).
#
# Запуск после сборки:
#   python3 tests/agent/devtools_pick_test.py
# ===========================================================================

import json
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "tools"))
from agent_client import Agent, ROOT   # noqa: E402

GAME = os.path.join("tests", "fixtures", "within")
FAILURES = []


def check(condition, message):
    print(("  ok   " if condition else "  FAIL ") + message)
    if not condition:
        FAILURES.append(message)


def panel(a):
    return a.eval("$.devtools.panel()")


def selectors(a):
    return [row["selector"] for row in a.eval("$.devtools.list()")]


def click(a, doc, element_id):
    r = a.eval("engine.ui.rect(%s,%r)" % (doc, element_id))
    a.mouse_move(x=r["x"] + r["w"] / 2, y=r["y"] + r["h"] / 2)
    a.step(3)
    a.mouse(button=1, action="click")
    a.step(3)


def text(a, doc, element_id):
    return a.eval("engine.ui.getText(%s,%r)" % (doc, element_id))


def section_rows(info, name):
    return {k: v for k, v in info["sections"][name]["rows"]}


def main():
    with Agent(game=GAME, seed=17, fixed_dt=1.0 / 60.0) as a:
        a.step(3)
        check(a.eval("$.devtools.open()") is True, "инспектор F2 открылся")
        doc = panel(a)["doc"]
        check(doc >= 0, "документ RmlUi создан: id=%s" % doc)
        check(a.eval("$.devtools.sectionName()") == "identity",
              "секция по умолчанию — Identity")
        a.step(4)

        # --- §20: поиск --------------------------------------------------------
        check(a.eval("$.devtools.search('#hero')") == "#hero", "поиск по ID: #hero")
        p = panel(a)
        check(p["search_kind"] == "selector" and p["entities"] == 1,
              "поиск селектором дал одну сущность")
        check(selectors(a) == ["#hero"], "список показывает именно её")
        check(a.eval("$.devtools.search('enemy')") == "enemy", "поиск по подстроке: enemy")
        check(panel(a)["entities"] == 3 and panel(a)["search_kind"] == "text",
              "поиск текстом нашёл три узла")
        check(a.eval("$.devtools.search('goblin')") == "goblin", "поиск по классу: goblin")
        check(sorted(selectors(a)) == ["#enemy0", "#enemy1", "#enemy2", "#marker"],
              "класс goblin найден у врагов и маркера")
        check(a.eval("$.devtools.search('player')") == "player", "поиск по тегу: player")
        check(selectors(a) == ["#hero"], "тег player — это герой")

        # state — свободный атрибут игры; prefab — имя, из которого узел создан.
        a.eval("$('<rect>', { id: 'door', state: 'open', script: 'src/door.js' })"
               ".at(700, 500).appendTo($.world)")
        a.eval("$.prefab.register('gob', $.prefab.save('#enemy0'))")
        a.eval("$.prefab.instantiate('gob', { id: 'gob_copy', x: 600, y: 400 })")
        a.step(2)
        a.eval("$.devtools.search('2d')")
        check(panel(a)["entities"] >= 8, "поиск по kind видит все 2D-узлы мира")
        a.eval("$.devtools.search('open')")
        check(selectors(a) == ["#door"], "поиск по state нашёл дверь")
        a.eval("$.devtools.search('gob')")
        check("#gob_copy" in selectors(a), "поиск по имени prefab нашёл инстанс")
        check(a.eval("$.devtools.search('')") == "", "пустой поиск снимает фильтр")
        check(panel(a)["entities"] >= 8, "без поиска видно все узлы мира: %s" % panel(a)["entities"])

        # --- §20: фильтры ------------------------------------------------------
        a.eval("$.devtools.search('')")
        total = panel(a)["entities"]
        a.eval("$('#far').hide()")
        check(a.eval("$.devtools.filter('visible')") is True, "фильтр visible включён")
        check("#far" not in selectors(a) and panel(a)["entities"] == total - 1,
              "скрытый узел выпал из списка (visible)")
        a.eval("$('#far').show()")
        a.eval("$.devtools.filter('visible', false)")

        a.eval("$.devtools.filter('physics')")
        phys = a.eval("$.devtools.list()")
        check(len(phys) == a.eval("engine.bodyCount()"),
              "фильтр physics: ровно столько, сколько тел в движке")
        check(all(r["body"] is not None and r["body"] >= 0 for r in phys),
              "у всех выбранных узлов есть тело")
        a.eval("$.devtools.filter('physics', false)")

        a.eval("$('#enemy1').active(false)")
        a.eval("$.devtools.filter('active')")
        check("#enemy1" not in selectors(a), "выключенный обработкой узел выпал (active)")
        check(all(r["active"] is True for r in a.eval("$.devtools.list()")),
              "в списке остались только активные")
        a.eval("$.devtools.filter('active', false)")
        a.eval("$('#enemy1').active(true)")

        # Комната в фикстуре не публикуется — фильтр обязан честно дать пусто.
        a.eval("$.devtools.filter('room')")
        check(panel(a)["entities"] == 0 and selectors(a) == [],
              "фильтр current room без опубликованной комнаты даёт пусто (не выдумывает)")
        a.eval("$.devtools.filter('room', false)")
        check(panel(a)["entities"] == total, "снятие фильтров возвращает весь список")

        # --- §20.1–20.5: секции инспектора -------------------------------------
        hero_uid = a.eval("$('#hero').get(0).uid")
        check(a.eval("$.devtools.selectBy('#hero')") == "#hero", "выбран герой")
        info = a.eval("$.devtools.inspect()")
        check(info["found"] is True and info["selector"] == "#hero", "инспектор нашёл узел")
        check(set(info["sections"]) == {"identity", "transform", "gameplay", "physics", "presentation"},
              "есть все пять секций §20")
        ident = section_rows(info, "identity")
        check(ident["selector"] == "#hero" and ident["nid"] and ident["uid"] == str(hero_uid),
              "Identity: selector/nid/uid")
        check(ident["kind"] == "2d" and ident["tag"] == "player", "Identity: kind/tag")
        trans = section_rows(info, "transform")
        check(trans["позиция (мир)"] == "100, 100", "Transform: мировая позиция")
        check("родитель" in trans and trans["детей"] == "0", "Transform: родитель и дети")
        game = section_rows(info, "gameplay")
        check(game["hp (exposed)"] == "100 / 100", "Gameplay: здоровье (exposed)")
        phys = section_rows(info, "physics")
        check(phys["body"].startswith("0"), "Physics: тело героя")
        check(phys["слой (layer bits)"] == "0x1", "Physics: слой коллизий")
        check("маска (mask)" in phys and "опора (floor)" in phys, "Physics: маска и опора")
        pres = section_rows(info, "presentation")
        check(pres["visible"] == "да" and "ключ сортировки" in pres, "Presentation: видимость и порядок")
        check("маска света" in pres, "Presentation: маска света")

        # Разметка секций в документе — ровно то, что отдаёт inspect().
        check(text(a, doc, "tab-identity") == info["sections"]["identity"]["html"],
              "секция Identity в панели = данные inspect()")
        check("#hero" in text(a, doc, "tab-identity"), "селектор виден в панели")
        # В панели отрисованы все пять секций: проверяем, что каждая строка
        # каждой секции действительно попала в документ RmlUi.
        for name in ["identity", "transform", "gameplay", "physics", "presentation"]:
            body = text(a, doc, "tab-" + name)
            missing = [k for k, _ in info["sections"][name]["rows"] if (k + ": ") not in body]
            check(not missing, "секция %s отрисована полностью (нет: %s)" % (name, missing or "—"))

        a.screenshot(os.path.join(ROOT, "build", "devtools_f2_identity.png"))

        # Переключение секций: кнопкой мышью и через API.
        click(a, doc, "dt-secbtn-physics")
        check(a.eval("$.devtools.sectionName()") == "physics", "клик переключил секцию на Physics")
        check(a.eval("engine.ui.rect(%s,'tab-physics')" % doc)["w"] > 0,
              "секция Physics показана (до этого её бокс был нулевым)")
        check(a.eval("$.devtools.section('presentation')") is True, "section() принимает имя")
        check(a.eval("$.devtools.section('nope')") is False, "неизвестная секция отклонена")
        check("маска света" in text(a, doc, "tab-presentation"), "секция Presentation заполнена")
        a.eval("$.devtools.section('identity')")

        # source/prefab в Identity: script из attrs и имя prefab.
        a.eval("$.devtools.selectBy('#door')")
        door_id = section_rows(a.eval("$.devtools.inspect()"), "identity")
        check(door_id["source"] == "src/door.js", "Identity: source = script из attrs")
        check(door_id["ассет ($.reload)"] == "—",
              "Identity: без ассета под наблюдением — честное «—»")
        a.eval("$.reload.watch('src/door.js', { kind: 'json', path: 'src/door.js' })")
        a.step(2)
        door_id = section_rows(a.eval("$.devtools.inspect()"), "identity")
        check(door_id["ассет ($.reload)"].startswith("src/door.js v0 (registered)"),
              "Identity: связь с ассетом §27 из $.reload.list: %s" % door_id["ассет ($.reload)"])
        a.eval("$.devtools.selectBy('#gob_copy')")
        check(section_rows(a.eval("$.devtools.inspect()"), "identity")["prefab"] == "gob",
              "Identity: prefab инстанса назван")

        # --- §21: world picking ------------------------------------------------
        # Цель — enemy0 (300, 100). Ставим камеру так, чтобы он оказался справа
        # от панели, иначе клик принадлежал бы панели.
        dt_rect = a.eval("engine.ui.rect(%s,'dt')" % doc)
        target = {"x": dt_rect["x"] + dt_rect["w"] + 14, "y": 560}
        # Камера хранит центр вида, поэтому сдвигаем её на разницу между
        # текущим и желаемым положением цели на экране — без догадок о формуле.
        cam = a.eval("$.camera.pos()")
        screen0 = a.eval("$.camera.worldToScreen({x: 300, y: 100})")
        a.eval("$.camera.at(%f, %f)" % (cam["x"] - (target["x"] - screen0["x"]),
                                        cam["y"] - (target["y"] - screen0["y"])))
        a.step(2)
        screen = a.eval("$.camera.worldToScreen({x: 300, y: 100})")
        check(abs(screen["x"] - target["x"]) < 0.5 and abs(screen["y"] - target["y"]) < 0.5,
              "цель клика переведена в экранные координаты: %s" % screen)
        check(target["x"] > dt_rect["x"] + dt_rect["w"],
              "точка клика вне панели (панель кончается на %s)" % (dt_rect["x"] + dt_rect["w"]))

        # Подсветка bounds — считаем реальные вызовы $.debug.draw.rect.
        a.eval("globalThis.__hl = 0; const __orig = $.debug.draw.rect;"
               " $.debug.draw.rect = (...args) => { globalThis.__hl++; return __orig(...args); }")
        check(a.eval("$.devtools.pickOn()") is False, "сначала режим Pick entity выключен")
        a.mouse_move(x=target["x"], y=target["y"])
        a.step(4)
        check(a.eval("globalThis.__hl") == 0, "без режима Pick подсветки нет")
        check(a.eval("$.devtools.pickMode(true)") is True, "режим Pick entity включён")
        check(panel(a)["pick"] is True, "panel() видит режим")
        a.step(4)
        hover = a.eval("$.devtools.pickHover()")
        enemy0_uid = a.eval("$('#enemy0').get(0).uid")
        check(hover == enemy0_uid, "подсвечен узел под курсором (#enemy0)")
        check(a.eval("globalThis.__hl") > 0, "подсветка bounds рисуется через $.debug.draw.rect")

        a.mouse(button=1, action="click")
        a.step(3)
        picked = a.eval("$.devtools.picked()")
        check(picked and picked["selector"] == "#enemy0",
              "клик по миру выбрал узел: %s" % (picked or {}).get("selector"))
        check(picked["nid"] == a.eval("$('#enemy0').get(0).nid"), "picked() несёт стабильный nid")
        check("source" in picked and "world" in picked, "picked() несёт source и мировые координаты")
        check(panel(a)["selected"] == enemy0_uid, "узел выбран в F2 (panel().selected)")
        check(a.eval("$.devtools.inspect()")["selector"] == "#enemy0", "инспектор показывает выбранный узел")
        check("#enemy0" in text(a, doc, "tab-identity"), "Identity выбранного узла видна в панели")
        check("#enemy0" in text(a, doc, "dt-status") and "источник" in text(a, doc, "dt-status"),
              "панель показывает selector и source выбранного кликом узла")
        # Подсветка bounds обязана быть НА ЭКРАНЕ вокруг узла: $.debug.draw.*
        # работает в координатах окна, поэтому проверяем пиксели кадра.
        shot = a.screenshot(os.path.join(ROOT, "build", "devtools_pick_enemy0.png"))
        image = Image.open(shot).convert("RGB")
        center = a.eval("$.camera.worldToScreen({x: 300, y: 100})")
        lit = 0
        for px in range(max(0, int(center["x"]) - 12), min(image.width, int(center["x"]) + 13)):
            for py in range(max(0, int(center["y"]) - 12), min(image.height, int(center["y"]) + 13)):
                c = image.getpixel((px, py))
                if abs(c[0] - 255) <= 12 and abs(c[1] - 90) <= 12 and abs(c[2] - 74) <= 12:
                    lit += 1
        check(lit > 0, "подсветка bounds нарисована вокруг узла на экране (%d пикселей)" % lit)

        # Клик по панели не выбирает в мире, даже если под ней есть узел.
        a.eval("const c = $.camera.screenToWorld({ x: %f, y: %f });"
               " $('<rect>', { id: 'under_panel' }).at(c.x, c.y).appendTo($.world);" %
               (dt_rect["x"] + dt_rect["w"] / 2, dt_rect["y"] + dt_rect["h"] / 2))
        a.step(2)
        a.mouse_move(x=dt_rect["x"] + dt_rect["w"] / 2, y=dt_rect["y"] + dt_rect["h"] / 2)
        a.step(2)
        a.mouse(button=1, action="click")
        a.step(3)
        check(a.eval("$.devtools.inspect()")["selector"] == "#enemy0",
              "клик по панели не перехватывает выбор в мире")

        # --- §21: Copy selector / Copy node ID / Copy JS -----------------------
        a.eval("globalThis.__clip = ''; const __set = engine.setClipboard;"
               " engine.setClipboard = (t) => { globalThis.__clip = String(t); return __set(t); }")
        click(a, doc, "dt-copy")
        check(a.eval("globalThis.__clip") == "#enemy0", "Copy selector положил селектор в буфер")
        check(a.eval("$.devtools.lastCopied()")["what"] == "selector", "факт копирования записан")
        click(a, doc, "dt-copy-nid")
        nid = a.eval("$('#enemy0').get(0).nid")
        check(a.eval("globalThis.__clip") == nid, "Copy node ID положил стабильный nid (%s)" % nid)
        click(a, doc, "dt-copy-js")
        check(a.eval("globalThis.__clip") == "$('#enemy0')",
              "Copy JS положил выражение $() — как в §21")
        check("Скопировано" in text(a, doc, "dt-status"), "панель подтвердила копирование")

        # --- возврат в исходное состояние --------------------------------------
        a.eval("$.devtools.pickMode(false)")
        check(a.eval("$.devtools.pickOn()") is False, "режим Pick entity выключен")
        a.eval("$('#under_panel').remove()")
        a.eval("$.camera.at(0, 0)")
        a.step(4)
        before = a.eval("globalThis.__hl")
        a.step(4)
        check(a.eval("globalThis.__hl") == before, "без режима Pick подсветка не рисуется")
        check(a.eval("$.devtools.close()") is True, "инспектор закрылся")
        a.step(3)
        check(a.eval("$('#hero').pos().x") == 100, "игра продолжает работать")
        # 4 тела фикстуры + одно у инстанса prefab (gob_copy); дверь — без тела.
        check(a.eval("engine.bodyCount()") == 5, "тела на месте (4 фикстуры + инстанс prefab)")

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
